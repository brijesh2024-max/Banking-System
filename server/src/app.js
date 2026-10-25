import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { User, Account, LedgerEntry, RevokedToken } from './models.js';
import { databaseConnected, transactionOptions } from './db.js';
import { AppError, notFound, errorHandler } from './errors.js';
import { validate, registerSchema, loginSchema, accountSchema, accountId, accountNumber, transferSchema, fundSchema, idempotencySchema, filterSchema } from './validation.js';
import { userDto, accountDto, transactionDto, newAccountNumber, listAccounts, moveMoney, history, dashboard } from './banking.js';
import { createReceipts } from './receipts.js';

const COOKIE = 'vault_session';
const SESSION_SECONDS = 8 * 60 * 60;
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const csvCell = value => `"${String(value).replace(/^[\s]*[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;

export function createApp(config) {
  if (config.disableRateLimit && config.nodeEnv !== 'test') throw new Error('Rate limits may only be disabled in tests.');
  if (typeof config.jwtSecret !== 'string' || config.jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  const app = express();
  const receipts = createReceipts(config);
  const cookieOptions = { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' };
  const limiter = (limit, windowMs) => rateLimit({ limit, windowMs, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => config.disableRateLimit, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many requests. Please try again later.' } }) });
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', limiter(600, 15 * 60 * 1000));
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && ((req.get('Origin') && req.get('Origin') !== config.clientOrigin) || req.get('Sec-Fetch-Site') === 'cross-site')) return next(new AppError(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.'));
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  function signIn(res, user) {
    const token = jwt.sign({}, config.jwtSecret, { algorithm: 'HS256', subject: String(user._id), jwtid: randomUUID(), expiresIn: SESSION_SECONDS, issuer: 'vault-bank', audience: 'vault-client' });
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
  }
  async function authenticated(req, _res, next) {
    let token;
    try { token = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret, { algorithms: ['HS256'], issuer: 'vault-bank', audience: 'vault-client' }); }
    catch { throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'); }
    if (!token.jti || !mongoose.isValidObjectId(token.sub) || await RevokedToken.exists({ jti: token.jti })) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    const user = await User.findById(token.sub);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    req.user = user;
    req.sessionToken = token;
    next();
  }
  const filters = req => validate(filterSchema, Object.fromEntries(Object.entries(req.query).filter(([, value]) => value !== '')));

  app.get('/api/health', (_req, res) => res.status(databaseConnected() ? 200 : 503).json({ status: databaseConnected() ? 'ok' : 'unavailable', database: databaseConnected() ? 'connected' : 'disconnected', sandbox: config.sandboxFunding, demo: config.demoMode === true }));
  app.use('/api/auth', limiter(40, 15 * 60 * 1000));
  app.post('/api/auth/register', async (req, res) => {
    const input = validate(registerSchema, req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await mongoose.connection.transaction(async session => {
      const [created] = await User.create([{ name: input.name, email: input.email, passwordHash, accountCount: 1 }], { session });
      await Account.create([{ ownerId: created._id, accountNumber: newAccountNumber(), name: 'Everyday savings' }], { session });
      return created;
    }, transactionOptions);
    signIn(res, user);
    res.status(201).json({ user: userDto(user) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const input = validate(loginSchema, req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    // Always run a password comparison to avoid a quick unknown-email response.
    const valid = await bcrypt.compare(input.password, user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    if (!user || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    signIn(res, user);
    res.json({ user: userDto(user) });
  });
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: userDto(req.user) }));
  app.post('/api/auth/logout', authenticated, async (req, res) => {
    await RevokedToken.updateOne({ jti: req.sessionToken.jti }, { $setOnInsert: { expiresAt: new Date(req.sessionToken.exp * 1000) } }, { upsert: true });
    res.clearCookie(COOKIE, cookieOptions).json({ message: 'Signed out.' });
  });
  app.use('/api', authenticated);
  app.get('/api/accounts', async (req, res) => res.json({ accounts: await listAccounts(req.user._id) }));
  app.post('/api/accounts', async (req, res) => {
    const input = validate(accountSchema, req.body);
    const account = await mongoose.connection.transaction(async session => {
      const increment = await User.updateOne({ _id: req.user._id, accountCount: { $lt: 5 } }, { $inc: { accountCount: 1 } }, { session });
      if (!increment.modifiedCount) throw new AppError(409, 'ACCOUNT_LIMIT', 'You can open up to five savings accounts.');
      const [created] = await Account.create([{ ownerId: req.user._id, accountNumber: newAccountNumber(), name: input.name }], { session });
      return created;
    }, transactionOptions);
    res.status(201).json({ account: accountDto(account) });
  });
  app.get('/api/dashboard', async (req, res) => res.json(await dashboard(req.user._id, config.sandboxFunding)));
  app.get('/api/recipients/lookup', limiter(60, 15 * 60 * 1000), async (req, res) => {
    const number = validate(accountNumber, req.query.accountNumber);
    const account = await Account.findOne({ accountNumber: number, internal: false }).populate('ownerId', 'name');
    if (!account?.ownerId) throw notFound('Recipient account not found.');
    res.json({ recipient: { accountNumber: account.accountNumber, name: account.ownerId.name } });
  });
  async function mutation(req, res, kind, payload) {
    const key = validate(idempotencySchema, req.get('Idempotency-Key'));
    const result = await moveMoney(req.user._id, kind, payload, key);
    res.status(result.replayed ? 200 : 201).json(result);
    if (!result.replayed) void receipts(req.user, result.transaction);
  }
  app.post('/api/transfers', async (req, res) => mutation(req, res, 'transfer', validate(transferSchema, req.body)));
  app.post('/api/accounts/:id/fund', async (req, res) => {
    if (!config.sandboxFunding) throw new AppError(403, 'SANDBOX_DISABLED', 'Test funding is disabled.');
    const id = validate(accountId, req.params.id);
    return mutation(req, res, 'deposit', { accountId: id, ...validate(fundSchema, req.body) });
  });
  app.get('/api/transactions', async (req, res) => res.json(await history(req.user._id, filters(req))));
  app.get('/api/transactions/export', async (req, res) => {
    const result = await history(req.user._id, filters(req), true);
    const rows = [['Reference', 'Date (UTC)', 'Account', 'Direction', 'Amount (INR)', 'Description', 'From', 'To', 'Status'], ...result.transactions.map(row => [row.reference, row.createdAt.toISOString(), row.accountId, row.direction, (row.amountPaise / 100).toFixed(2), row.description, row.from?.name || '', row.to.name, row.status])];
    res.type('text/csv').attachment('vault-transactions.csv').send('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  });
  app.get('/api/transactions/:id', async (req, res) => {
    const id = validate(accountId, req.params.id);
    const accounts = await Account.find({ ownerId: req.user._id, internal: false }).select('_id');
    const entry = await LedgerEntry.findOne({ transactionId: id, accountId: { $in: accounts.map(account => account._id) } }).populate('transactionId');
    if (!entry?.transactionId) throw notFound('Transaction not found.');
    res.json({ transaction: transactionDto(entry.transactionId, entry) });
  });
  app.use('/api', (_req, _res, next) => next(notFound()));
  if (existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
