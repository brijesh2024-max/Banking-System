import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { before, after, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { connectDatabase, disconnectDatabase } from '../src/db.js';
import { Account, Transaction, LedgerEntry } from '../src/models.js';

// Keep the real MongoDB test server and its downloaded binary inside the project.
process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(new URL('../../.local/mongodb-binaries/', import.meta.url));
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

const PASSWORD = 'VaultTest123!';
const ORIGIN = 'http://localhost:5173';
let database;
let app;
let config;

before(async () => {
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ ip: '127.0.0.1' }],
  });
  config = readConfig({
    nodeEnv: 'test',
    clientOrigin: ORIGIN,
    mongodbUri: database.getUri('vault_integration'),
    jwtSecret: 'test-only-secret-with-at-least-sixty-four-characters-for-integration-tests',
    sandboxFunding: true,
    disableRateLimit: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
  });
  await connectDatabase(config.mongodbUri);
  await Promise.all([Account.init(), Transaction.init(), LedgerEntry.init()]);
  app = createApp(config);
}, { timeout: 900_000 });

after(async () => {
  await disconnectDatabase();
  if (database) await database.stop();
}, { timeout: 30_000 });

function cookieFrom(response) {
  const cookies = response.headers['set-cookie'];
  assert.ok(cookies?.length, 'A successful sign-in must set a session cookie');
  return cookies.map(value => value.split(';')[0]).join('; ');
}

async function newUser(name = 'Test Customer', target = app) {
  const email = `test-${randomUUID()}@example.com`;
  const response = await request(target).post('/api/auth/register').send({ name, email, password: PASSWORD });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const cookie = cookieFrom(response);
  const result = await request(target).get('/api/accounts').set('Cookie', cookie);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.accounts.length, 1);
  return { ...response.body.user, email, cookie, account: result.body.accounts[0], response };
}

async function accounts(user) {
  const response = await request(app).get('/api/accounts').set('Cookie', user.cookie);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.accounts;
}

async function balance(user, id = user.account.id) {
  const result = await accounts(user);
  const account = result.find(value => value.id === id);
  assert.ok(account, 'The account must remain accessible to its owner');
  assert.equal(Number.isSafeInteger(account.balancePaise), true);
  return account.balancePaise;
}

function deposit(user, amount, key = randomUUID(), target = app, accountId = user.account.id) {
  return request(target).post(`/api/accounts/${accountId}/fund`)
    .set('Cookie', user.cookie).set('Idempotency-Key', key).send({ amount });
}

async function fund(user, amount) {
  const response = await deposit(user, amount);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response;
}

function transfer(sender, recipient, amount, { key = randomUUID(), description = 'Integration test transfer', fromAccountId = sender.account.id } = {}) {
  return request(app).post('/api/transfers').set('Cookie', sender.cookie).set('Idempotency-Key', key)
    .send({ fromAccountId, toAccountNumber: recipient.account.accountNumber, amount, description });
}

async function history(user, filters = {}) {
  const response = await request(app).get('/api/transactions').set('Cookie', user.cookie).query(filters);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function assertRejected(response, statuses = [400, 422]) {
  assert.ok(statuses.includes(response.status), `Expected ${statuses.join('/')} but received ${response.status}: ${JSON.stringify(response.body)}`);
  assert.equal(typeof response.body.error?.code, 'string');
  assert.equal(typeof response.body.error?.message, 'string');
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if (character === '\n' && !quoted) {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  assert.equal(quoted, false, 'CSV quote escaping must produce complete cells');
  return rows;
}

describe('Sandbox initialization', { concurrency: false }, () => {
  it('handles simultaneous first deposits with one balanced clearing account', async () => {
    const customers = await Promise.all([newUser(), newUser(), newUser()]);
    const results = await Promise.all(customers.map(customer => deposit(customer, '10.00')));
    for (const result of results) assert.equal(result.status, 201, JSON.stringify(result.body));
    const clearingAccounts = await Account.find({ internal: true }).lean();
    assert.equal(clearingAccounts.length, 1);
    assert.equal(clearingAccounts[0].balancePaise, -3000);
    for (const customer of customers) assert.equal(await balance(customer), 1000);
    const ledger = await LedgerEntry.find().lean();
    assert.equal(ledger.length, 6);
    assert.equal(ledger.reduce((sum, row) => sum + row.signedAmountPaise, 0), 0);
  });
});

describe('Authentication and account isolation', { concurrency: false }, () => {
  it('reports the database state and creates a signed-in user with a zero-balance account', async () => {
    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.database, 'connected');
    assert.equal(health.body.sandbox, true);
    const user = await newUser();
    assert.equal(user.account.balancePaise, 0);
    assert.equal(user.account.currency, 'INR');
    assert.equal(user.account.type, 'SAVINGS');
    assert.equal(user.response.body.user.password, undefined);
    assert.equal(user.response.body.user.passwordHash, undefined);
    assert.match(user.response.headers['set-cookie'].join(';'), /HttpOnly/i);
    assert.match(user.response.headers['set-cookie'].join(';'), /SameSite=(Lax|Strict)/i);
    const me = await request(app).get('/api/auth/me').set('Cookie', user.cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, user.id);
  });

  it('validates registration, refuses duplicate identities, and rejects invalid passwords', async () => {
    for (const fields of [
      { name: '', email: 'invalid', password: 'short' },
      { name: 'Test User', email: 'bad-email', password: PASSWORD },
      { name: 'Test User', email: `weak-${randomUUID()}@example.com`, password: '123' },
    ]) {
      assertRejected(await request(app).post('/api/auth/register').send(fields));
    }
    const user = await newUser();
    assertRejected(await request(app).post('/api/auth/register').send({ name: user.name, email: user.email, password: PASSWORD }), [409]);
    assertRejected(await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPassword123!' }), [401]);
  });

  it('logs in and revokes the original cookie on logout, including copied cookies', async () => {
    const user = await newUser();
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    assert.equal(logout.status, 200);
    const oldCookie = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assertRejected(oldCookie, [401]);
  });

  it('requires authentication for private data and money mutations', async () => {
    for (const endpoint of ['/api/auth/me', '/api/accounts', '/api/dashboard', '/api/transactions', '/api/transactions/export']) {
      assertRejected(await request(app).get(endpoint), [401]);
    }
    assertRejected(await request(app).get('/api/auth/me').set('Cookie', 'vault_session=invalid.cookie.signature'), [401]);
    assertRejected(await request(app).post('/api/transfers').send({}), [401]);
  });

  it('rejects cross-site cookie mutations while allowing the configured browser origin', async () => {
    const user = await newUser();
    const blocked = await request(app).post('/api/accounts').set('Cookie', user.cookie)
      .set('Origin', 'https://attacker.example').send({ name: 'Unwanted account' });
    assertRejected(blocked, [403]);
    assert.equal((await accounts(user)).length, 1);
    const allowed = await request(app).post('/api/accounts').set('Cookie', user.cookie)
      .set('Origin', ORIGIN).send({ name: 'Travel savings' });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
  });

  it('allows at most five accounts and always creates them with zero funds', async () => {
    const user = await newUser();
    for (let index = 2; index <= 5; index += 1) {
      const response = await request(app).post('/api/accounts').set('Cookie', user.cookie).send({ name: `Savings ${index}` });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.account.balancePaise, 0);
    }
    assertRejected(await request(app).post('/api/accounts').set('Cookie', user.cookie).send({ name: 'Sixth account' }), [400, 409, 422]);
    assert.equal((await accounts(user)).length, 5);
  });

  it('preserves the five-account limit during concurrent account creation', async () => {
    const user = await newUser();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => request(app)
      .post('/api/accounts').set('Cookie', user.cookie).send({ name: `Parallel savings ${index}` })));
    assert.equal(results.filter(result => result.status === 201).length, 4, JSON.stringify(results.map(result => result.body)));
    assert.equal(results.filter(result => result.status === 409).length, 2);
    assert.equal((await accounts(user)).length, 5);
  });

  it('looks up the recipient’s name without exposing private account data', async () => {
    const sender = await newUser();
    const recipient = await newUser('Recipient Full Name');
    const response = await request(app).get('/api/recipients/lookup').set('Cookie', sender.cookie)
      .query({ accountNumber: recipient.account.accountNumber });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { recipient: { accountNumber: recipient.account.accountNumber, name: 'Recipient Full Name' } });
    assertRejected(await request(app).get('/api/recipients/lookup').set('Cookie', sender.cookie).query({ accountNumber: '000000000000' }), [404]);
  });

  it('does not expose or mutate another customer’s accounts or transactions', async () => {
    const owner = await newUser('Private Customer');
    const outsider = await newUser('Other Customer');
    const funded = await fund(owner, '50.00');
    const transactionId = funded.body.transaction.id;
    assertRejected(await request(app).get(`/api/transactions/${transactionId}`).set('Cookie', outsider.cookie), [403, 404]);
    assertRejected(await request(app).get('/api/transactions').set('Cookie', outsider.cookie).query({ accountId: owner.account.id }), [403, 404]);
    assertRejected(await request(app).get('/api/transactions/export').set('Cookie', outsider.cookie).query({ accountId: owner.account.id }), [403, 404]);
    assertRejected(await deposit(outsider, '10.00', randomUUID(), app, owner.account.id), [403, 404]);
    assertRejected(await transfer(outsider, outsider, '10.00', { fromAccountId: owner.account.id }), [403, 404]);
    assert.equal(await balance(owner), 5000);
    assert.equal(await balance(outsider), 0);
    assert.equal((await history(outsider)).transactions.length, 0);
  });
});

describe('Atomic money movement', { concurrency: false }, () => {
  it('conserves transferred funds, creates two ledger entries, and exposes both sides correctly', async () => {
    const sender = await newUser('Sender Customer');
    const recipient = await newUser('Recipient Customer');
    await fund(sender, '150.00');
    const entriesBefore = await LedgerEntry.countDocuments();
    const result = await transfer(sender, recipient, '55.25', { description: 'Lunch split' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.transaction.amountPaise, 5525);
    assert.equal(result.body.replayed, false);
    assert.equal(await balance(sender), 9475);
    assert.equal(await balance(recipient), 5525);
    assert.equal((await balance(sender)) + (await balance(recipient)), 15000);
    assert.equal(await LedgerEntry.countDocuments(), entriesBefore + 2);
    const ledger = await LedgerEntry.find({ transactionId: result.body.transaction.id }).lean();
    assert.equal(ledger.length, 2);
    assert.deepEqual(ledger.map(row => row.signedAmountPaise).sort((left, right) => left - right), [-5525, 5525]);
    assert.deepEqual(ledger.map(row => String(row.accountId)).sort(), [sender.account.id, recipient.account.id].sort());
    const sent = (await history(sender, { direction: 'debit' })).transactions;
    const received = (await history(recipient, { direction: 'credit' })).transactions;
    assert.equal(sent.length, 1);
    assert.equal(received.length, 1);
    assert.equal(sent[0].id, result.body.transaction.id);
    assert.equal(received[0].id, result.body.transaction.id);
    assert.equal(sent[0].direction, 'debit');
    assert.equal(received[0].direction, 'credit');
    for (const participant of [sender, recipient]) {
      const detail = await request(app).get(`/api/transactions/${result.body.transaction.id}`).set('Cookie', participant.cookie);
      assert.equal(detail.status, 200);
    }
    for (const [customer, expected] of [[sender, 9475], [recipient, 5525]]) {
      const stored = await Account.findById(customer.account.id).lean();
      assert.equal(stored.balancePaise, expected, 'Materialized balance and displayed ledger balance must agree');
    }
  });

  it('creates both entries for transfers between the same customer’s accounts', async () => {
    const user = await newUser();
    await fund(user, '100.00');
    const second = await request(app).post('/api/accounts').set('Cookie', user.cookie).send({ name: 'Holiday' });
    assert.equal(second.status, 201);
    const result = await transfer(user, { account: second.body.account }, '25.00', { description: 'My holiday fund' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const ownEntries = (await history(user, { search: 'My holiday fund' })).transactions;
    assert.equal(ownEntries.length, 2);
    assert.deepEqual(ownEntries.map(row => row.direction).sort(), ['credit', 'debit']);
    assert.equal(new Set(ownEntries.map(row => row.accountId)).size, 2);
    assert.equal(await balance(user), 7500);
    assert.equal(await balance(user, second.body.account.id), 2500);
  });

  it('rejects invalid money representations without changing balances', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '100.00');
    for (const amount of ['-1.00', '0', '1.001', '1e3', 'NaN', 'Infinity', '999999999999999999999999.99', 12.50, null]) {
      assertRejected(await transfer(sender, recipient, amount));
    }
    assert.equal(await balance(sender), 10000);
    assert.equal(await balance(recipient), 0);
    assert.equal((await history(sender)).pagination.total, 1);
  });

  it('requires a valid idempotency key before moving money', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '10.00');
    const body = { fromAccountId: sender.account.id, toAccountNumber: recipient.account.accountNumber, amount: '1.00', description: 'Missing key' };
    assertRejected(await request(app).post('/api/transfers').set('Cookie', sender.cookie).send(body));
    assertRejected(await request(app).post('/api/transfers').set('Cookie', sender.cookie).set('Idempotency-Key', 'not-a-uuid').send(body));
    assert.equal(await balance(sender), 1000);
  });

  it('rolls back insufficient-funds transfers without adding transaction or ledger records', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '10.00');
    const transactionsBefore = await Transaction.countDocuments();
    const entriesBefore = await LedgerEntry.countDocuments();
    assertRejected(await transfer(sender, recipient, '10.01'), [400, 409, 422]);
    assert.equal(await balance(sender), 1000);
    assert.equal(await balance(recipient), 0);
    assert.equal(await Transaction.countDocuments(), transactionsBefore);
    assert.equal(await LedgerEntry.countDocuments(), entriesBefore);
  });

  it('replays an identical request and rejects changing its payload', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '100.00');
    const key = randomUUID();
    const first = await transfer(sender, recipient, '10.00', { key });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const replay = await transfer(sender, recipient, '10.00', { key });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.transaction.id, first.body.transaction.id);
    assertRejected(await transfer(sender, recipient, '11.00', { key }), [409]);
    assert.equal(await balance(sender), 9000);
    assert.equal(await balance(recipient), 1000);
  });

  it('handles simultaneous retries without transferring twice', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '100.00');
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => transfer(sender, recipient, '25.00', { key })));
    for (const result of results) assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
    assert.equal(results.filter(result => result.status === 201).length, 1);
    assert.equal(new Set(results.map(result => result.body.transaction.id)).size, 1);
    assert.equal(await balance(sender), 7500);
    assert.equal(await balance(recipient), 2500);
    assert.equal((await history(sender, { direction: 'debit' })).pagination.total, 1);
  });

  it('prevents two parallel withdrawals from overspending the same account', async () => {
    const sender = await newUser();
    const firstRecipient = await newUser();
    const secondRecipient = await newUser();
    await fund(sender, '100.00');
    const results = await Promise.all([
      transfer(sender, firstRecipient, '80.00'),
      transfer(sender, secondRecipient, '80.00'),
    ]);
    assert.equal(results.filter(result => result.status === 201).length, 1, JSON.stringify(results.map(result => result.body)));
    assert.equal(results.filter(result => [400, 409, 422].includes(result.status)).length, 1);
    assert.equal(await balance(sender), 2000);
    assert.equal((await balance(firstRecipient)) + (await balance(secondRecipient)), 8000);
    assert.equal((await history(sender, { direction: 'debit' })).pagination.total, 1);
  });

  it('replays deposits only once and disables them when sandbox funding is off', async () => {
    const user = await newUser();
    const key = randomUUID();
    const original = await deposit(user, '20.00', key);
    assert.equal(original.status, 201, JSON.stringify(original.body));
    const replay = await deposit(user, '20.00', key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.transaction.id, original.body.transaction.id);
    assertRejected(await deposit(user, '21.00', key), [409]);
    const disabledApp = createApp({ ...config, sandboxFunding: false });
    assertRejected(await deposit(user, '50.00', randomUUID(), disabledApp), [403, 404]);
    assert.equal(await balance(user), 2000);
    const dashboard = await request(disabledApp).get('/api/dashboard').set('Cookie', user.cookie);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.sandbox, false);
  });
});

describe('History, reporting, and CSV safety', { concurrency: false }, () => {
  it('rejects invalid pagination and calendar-date filters', async () => {
    const user = await newUser();
    for (const query of [
      { page: 0 }, { page: 1.5 }, { limit: 0 }, { limit: 101 },
      { from: '2026-02-31' }, { from: '2026-02-02', to: '2026-02-01' },
      { accountId: 'not-an-account-id' }, { direction: 'sideways' },
    ]) {
      assertRejected(await request(app).get('/api/transactions').set('Cookie', user.cookie).query(query));
    }
  });

  it('supports literal search, direction, account, inclusive date filters, and pagination', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '100.00');
    for (const description of ['Rent [October]', 'Rent October', 'Groceries']) {
      const response = await transfer(sender, recipient, '5.00', { description });
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    const literal = await history(sender, { search: '[' });
    assert.equal(literal.pagination.total, 1);
    assert.equal(literal.transactions[0].description, 'Rent [October]');
    const first = await history(sender, { direction: 'debit', accountId: sender.account.id, page: 1, limit: 2 });
    const second = await history(sender, { direction: 'debit', accountId: sender.account.id, page: 2, limit: 2 });
    assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 3, pages: 2 });
    assert.equal(first.transactions.length, 2);
    assert.equal(second.transactions.length, 1);
    assert.equal(new Set([...first.transactions, ...second.transactions].map(row => row.id)).size, 3);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await history(sender, { from: today, to: today })).pagination.total, 4);
    assert.equal((await history(sender, { from: '2000-01-01', to: '2000-01-02' })).pagination.total, 0);
  });

  it('reports dashboard values derived from the customer’s ledger', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '90.00');
    const result = await transfer(sender, recipient, '12.34');
    assert.equal(result.status, 201);
    const response = await request(app).get('/api/dashboard').set('Cookie', sender.cookie);
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.totalBalancePaise, 7766);
    assert.equal(response.body.summary.incomePaise, 9000);
    assert.equal(response.body.summary.expensePaise, 1234);
    assert.equal(response.body.summary.transactionCount, 2);
    assert.equal(response.body.recentTransactions.length, 2);
    assert.equal(response.body.activity.length, 7);
    assert.equal(response.body.activity.reduce((sum, day) => sum + day.incomePaise, 0), 9000);
    assert.equal(response.body.activity.reduce((sum, day) => sum + day.expensePaise, 0), 1234);
  });

  it('exports filtered CSV with escaped commas, quotes, and spreadsheet formulas', async () => {
    const sender = await newUser();
    const recipient = await newUser();
    await fund(sender, '100.00');
    const descriptions = ['=HYPERLINK("https://example.com","x")', '+SUM(1,2)', '-2+3', '@SUM(1,2)', 'Dinner, "thank you"'];
    for (const description of descriptions) {
      const response = await transfer(sender, recipient, '1.00', { description });
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    const response = await request(app).get('/api/transactions/export').set('Cookie', sender.cookie).query({ direction: 'debit' });
    assert.equal(response.status, 200, response.text);
    assert.match(response.headers['content-type'], /text\/csv/i);
    assert.match(response.headers['content-disposition'], /attachment/i);
    const [headers, ...rows] = csvRows(response.text.replace(/^\uFEFF/, ''));
    const descriptionIndex = headers.findIndex(header => /description/i.test(header));
    assert.notEqual(descriptionIndex, -1);
    assert.equal(rows.length, descriptions.length);
    for (const row of rows) assert.equal(row.length, headers.length, 'Comma and quote characters must stay inside their CSV cell');
    const actual = rows.map(row => row[descriptionIndex]);
    for (const dangerous of descriptions.slice(0, 4)) assert.ok(actual.includes(`'${dangerous}`), `Formula must be neutralized: ${dangerous}`);
    assert.ok(actual.includes('Dinner, "thank you"'));
  });
});

describe('Ledger reconciliation', { concurrency: false }, () => {
  it('balances every transaction and reconciles all stored account balances after the suite', async () => {
    const [accountRows, transactionRows, entries] = await Promise.all([
      Account.find().lean(), Transaction.find().lean(), LedgerEntry.find().lean(),
    ]);
    assert.ok(transactionRows.length > 0);
    for (const transaction of transactionRows) {
      const pair = entries.filter(entry => String(entry.transactionId) === String(transaction._id));
      assert.equal(pair.length, 2, `Transaction ${transaction.reference} must have exactly two ledger entries`);
      assert.deepEqual(pair.map(entry => entry.direction).sort(), ['credit', 'debit']);
      assert.equal(new Set(pair.map(entry => String(entry.accountId))).size, 2);
      assert.equal(pair.reduce((sum, entry) => sum + entry.signedAmountPaise, 0), 0);
      for (const entry of pair) {
        assert.equal(entry.amountPaise, transaction.amountPaise);
        assert.equal(entry.signedAmountPaise, entry.direction === 'credit' ? entry.amountPaise : -entry.amountPaise);
      }
    }
    for (const account of accountRows) {
      const ledgerBalance = entries.filter(entry => String(entry.accountId) === String(account._id))
        .reduce((sum, entry) => sum + entry.signedAmountPaise, 0);
      assert.equal(account.balancePaise, ledgerBalance, `Account ${account.accountNumber} must match its ledger`);
      if (!account.internal) assert.ok(account.balancePaise >= 0, 'Customer balances cannot become negative');
    }
    assert.equal(entries.length, transactionRows.length * 2);
    assert.equal(accountRows.reduce((sum, account) => sum + account.balancePaise, 0), 0);
  });
});
