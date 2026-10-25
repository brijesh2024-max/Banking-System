import { createHash, randomInt, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Account, User, Transaction, LedgerEntry, MAX_BALANCE_PAISE } from './models.js';
import { AppError, notFound } from './errors.js';
import { toPaise } from './validation.js';
import { transactionOptions } from './db.js';

export const newAccountNumber = () => String(randomInt(100_000_000_000, 999_999_999_999));
export const userDto = user => ({ id: String(user._id), name: user.name, email: user.email, createdAt: user.createdAt });
export const accountDto = account => ({ id: String(account._id), accountNumber: account.accountNumber, name: account.name, currency: account.currency, type: account.type, balancePaise: account.balancePaise, createdAt: account.createdAt });
export function transactionDto(transaction, entry) {
  return { id: String(transaction._id), reference: transaction.reference, type: transaction.type, direction: entry.direction, amountPaise: transaction.amountPaise, description: transaction.description, createdAt: transaction.createdAt, status: transaction.status, from: transaction.type === 'deposit' ? null : transaction.from, to: transaction.to, accountId: String(entry.accountId) };
}

async function ensureClearingAccount() {
  try {
    await Account.updateOne(
      { accountNumber: '000000000000', internal: true, ownerId: null },
      { $setOnInsert: { name: 'Sandbox clearing', balancePaise: 0 } },
      { upsert: true },
    );
  } catch (error) {
    // Two first deposits may attempt this insert together. The unique account
    // number selects one winner; both callers can then use that same account.
    if (error.code !== 11000 || !await Account.exists({ accountNumber: '000000000000', internal: true, ownerId: null })) throw error;
  }
}

export async function ownedAccount(ownerId, id, session = null) {
  const account = await Account.findOne({ _id: id, ownerId, internal: false }).session(session);
  if (!account) throw notFound('Account not found.');
  return account;
}

export async function listAccounts(ownerId) {
  const accounts = await Account.find({ ownerId, internal: false }).sort({ createdAt: 1, _id: 1 }).lean();
  const balances = await LedgerEntry.aggregate([
    { $match: { accountId: { $in: accounts.map(account => account._id) } } },
    { $group: { _id: '$accountId', balance: { $sum: '$signedAmountPaise' } } },
  ]);
  const totals = new Map(balances.map(row => [String(row._id), row.balance]));
  return accounts.map(account => accountDto({ ...account, balancePaise: totals.get(String(account._id)) || 0 }));
}

// MongoDB retries transient write conflicts; the unique actor/key index also
// protects retries arriving on different server instances.
export async function moveMoney(actorId, kind, payload, key) {
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind, ...payload })).digest('hex');
  const replay = transaction => {
    if (transaction.fingerprint !== fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used with different details.');
    return { transaction: transactionDto(transaction, { accountId: kind === 'deposit' ? transaction.toAccountId : transaction.fromAccountId, direction: kind === 'deposit' ? 'credit' : 'debit' }), replayed: true };
  };
  const previous = await Transaction.findOne({ actorId, idempotencyKey: key });
  if (previous) return replay(previous);
  if (kind === 'deposit') await ensureClearingAccount();
  try {
    return await mongoose.connection.transaction(async session => {
      const existing = await Transaction.findOne({ actorId, idempotencyKey: key }).session(session);
      if (existing) return replay(existing);
      const amountPaise = toPaise(payload.amount);
      let sender;
      let receiver;
      if (kind === 'deposit') {
        receiver = await ownedAccount(actorId, payload.accountId, session);
        sender = await Account.findOne({ accountNumber: '000000000000', internal: true }).session(session);
      } else {
        sender = await ownedAccount(actorId, payload.fromAccountId, session);
        receiver = await Account.findOne({ accountNumber: payload.toAccountNumber, internal: false }).session(session);
        if (!receiver) throw notFound('Recipient account not found.');
        if (sender._id.equals(receiver._id)) throw new AppError(400, 'SAME_ACCOUNT', 'Choose a different recipient account.');
      }
      const debit = await Account.updateOne({ _id: sender._id, balancePaise: { $gte: sender.internal ? -MAX_BALANCE_PAISE + amountPaise : amountPaise } }, { $inc: { balancePaise: -amountPaise } }, { session });
      if (!debit.modifiedCount) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'There is not enough available balance for this transfer.');
      const credit = await Account.updateOne({ _id: receiver._id, balancePaise: { $lte: MAX_BALANCE_PAISE - amountPaise } }, { $inc: { balancePaise: amountPaise } }, { session });
      if (!credit.modifiedCount) throw new AppError(409, 'BALANCE_LIMIT', 'The recipient account has reached its balance limit.');
      const senderOwner = sender.internal ? null : await User.findById(sender.ownerId).session(session);
      const receiverOwner = await User.findById(receiver.ownerId).session(session);
      const [transaction] = await Transaction.create([{
        actorId, idempotencyKey: key, fingerprint, reference: `VLT-${randomUUID().toUpperCase()}`,
        type: kind, amountPaise, description: kind === 'deposit' ? 'Sandbox deposit' : payload.description || 'Bank transfer',
        fromAccountId: sender._id, toAccountId: receiver._id,
        from: { accountNumber: sender.accountNumber, name: senderOwner?.name || 'Sandbox clearing' },
        to: { accountNumber: receiver.accountNumber, name: receiverOwner.name },
      }], { session });
      await LedgerEntry.create([
        { transactionId: transaction._id, accountId: sender._id, direction: 'debit', amountPaise, signedAmountPaise: -amountPaise, createdAt: transaction.createdAt },
        { transactionId: transaction._id, accountId: receiver._id, direction: 'credit', amountPaise, signedAmountPaise: amountPaise, createdAt: transaction.createdAt },
      ], { session, ordered: true });
      return { transaction: transactionDto(transaction, { accountId: kind === 'deposit' ? receiver._id : sender._id, direction: kind === 'deposit' ? 'credit' : 'debit' }), replayed: false };
    }, transactionOptions);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Transaction.findOne({ actorId, idempotencyKey: key });
      if (existing) return replay(existing);
    }
    throw error;
  }
}

export async function historyPipeline(ownerId, filters) {
  const accounts = filters.accountId ? [await ownedAccount(ownerId, filters.accountId)] : await Account.find({ ownerId, internal: false }).select('_id');
  const match = { accountId: { $in: accounts.map(account => account._id) } };
  if (filters.direction && filters.direction !== 'all') match.direction = filters.direction;
  if (filters.from || filters.to) {
    match.createdAt = {};
    if (filters.from) match.createdAt.$gte = new Date(`${filters.from}T00:00:00.000Z`);
    if (filters.to) match.createdAt.$lt = new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000);
  }
  const pipeline = [{ $match: match }, { $lookup: { from: 'transactions', localField: 'transactionId', foreignField: '_id', as: 'transaction' } }, { $unwind: '$transaction' }];
  if (filters.search) {
    const literal = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pipeline.push({ $addFields: { counterparty: { $cond: [{ $eq: ['$direction', 'credit'] }, '$transaction.from', '$transaction.to'] } } });
    pipeline.push({ $match: { $or: ['transaction.description', 'transaction.reference', 'counterparty.name', 'counterparty.accountNumber'].map(field => ({ [field]: { $regex: literal, $options: 'i' } })) } });
  }
  pipeline.push({ $sort: { createdAt: -1, _id: -1 } });
  return pipeline;
}

export async function history(ownerId, filters, exporting = false) {
  const pipeline = await historyPipeline(ownerId, filters);
  const [result] = await LedgerEntry.aggregate([...pipeline, { $facet: { count: [{ $count: 'total' }], rows: exporting ? [{ $limit: 10001 }] : [{ $skip: (filters.page - 1) * filters.limit }, { $limit: filters.limit }] } }]);
  const total = result.count[0]?.total || 0;
  if (exporting && total > 10000) throw new AppError(400, 'EXPORT_LIMIT', 'Narrow your filters to export at most 10,000 transactions.');
  return { transactions: result.rows.map(row => transactionDto(row.transaction, row)), pagination: { page: filters.page, limit: filters.limit, total, pages: Math.ceil(total / filters.limit) } };
}

export async function dashboard(ownerId, sandbox) {
  const accounts = await listAccounts(ownerId);
  const ids = accounts.map(account => new mongoose.Types.ObjectId(account.id));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 6 * 86_400_000);
  const daily = await LedgerEntry.aggregate([
    { $match: { accountId: { $in: ids }, createdAt: { $gte: start, $lt: new Date(today.getTime() + 86_400_000) } } },
    { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, direction: '$direction' }, total: { $sum: '$amountPaise' } } },
  ]);
  const activity = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), incomePaise: daily.find(row => row._id.date === key && row._id.direction === 'credit')?.total || 0, expensePaise: daily.find(row => row._id.date === key && row._id.direction === 'debit')?.total || 0 };
  });
  const recent = await history(ownerId, { page: 1, limit: 5 });
  return { accounts, sandbox, activity, recentTransactions: recent.transactions, summary: { totalBalancePaise: accounts.reduce((sum, account) => sum + account.balancePaise, 0), incomePaise: activity.reduce((sum, day) => sum + day.incomePaise, 0), expensePaise: activity.reduce((sum, day) => sum + day.expensePaise, 0), transactionCount: recent.pagination.total } };
}
