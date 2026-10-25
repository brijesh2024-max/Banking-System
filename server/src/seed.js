import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { User, Account, Transaction, LedgerEntry } from './models.js';
import { moveMoney } from './banking.js';
import { transactionOptions } from './db.js';

export async function seedDemo() {
  if (await User.exists({})) throw new Error('Demo seed requires an empty, isolated database.');
  const passwordHash = await bcrypt.hash('VaultDemo123!', 12);
  const openedAt = new Date(Date.now() - 30 * 86_400_000);
  const users = await mongoose.connection.transaction(async session => {
    const [brijesh, ananya] = await User.create([
      { name: 'Brijesh Gaur', email: 'brijesh@vault.demo', passwordHash, accountCount: 2, createdAt: openedAt },
      { name: 'Ananya Sharma', email: 'ananya@vault.demo', passwordHash, accountCount: 1, createdAt: openedAt },
    ], { session, ordered: true });
    const accounts = await Account.create([
      { ownerId: brijesh._id, accountNumber: '100000000001', name: 'Everyday savings', createdAt: openedAt },
      { ownerId: ananya._id, accountNumber: '100000000002', name: 'Everyday savings', createdAt: openedAt },
      { ownerId: brijesh._id, accountNumber: '100000000003', name: 'The bigger picture', createdAt: openedAt },
    ], { session, ordered: true });
    return { brijesh, ananya, accounts };
  }, transactionOptions);
  const { brijesh, ananya, accounts } = users;
  async function entry(actor, kind, payload, daysAgo) {
    const result = await moveMoney(actor._id, kind, payload, randomUUID());
    const date = new Date(); date.setUTCDate(date.getUTCDate() - daysAgo);
    await mongoose.connection.transaction(async session => {
      await Transaction.updateOne({ _id: result.transaction.id }, { $set: { createdAt: date } }, { session });
      await LedgerEntry.updateMany({ transactionId: result.transaction.id }, { $set: { createdAt: date } }, { session });
    }, transactionOptions);
  }
  await entry(brijesh, 'deposit', { accountId: String(accounts[0]._id), amount: '75000.00' }, 6);
  await entry(ananya, 'deposit', { accountId: String(accounts[1]._id), amount: '20000.00' }, 6);
  await entry(brijesh, 'transfer', { fromAccountId: String(accounts[0]._id), toAccountNumber: '100000000003', amount: '15000.00', description: 'A little closer to the next adventure' }, 4);
  await entry(brijesh, 'transfer', { fromAccountId: String(accounts[0]._id), toAccountNumber: '100000000002', amount: '2450.00', description: 'Weekend dinner' }, 3);
  await entry(ananya, 'transfer', { fromAccountId: String(accounts[1]._id), toAccountNumber: '100000000001', amount: '1250.00', description: 'Our coffee catch-up' }, 2);
  await entry(brijesh, 'deposit', { accountId: String(accounts[0]._id), amount: '8500.00' }, 1);
  await entry(brijesh, 'transfer', { fromAccountId: String(accounts[0]._id), toAccountNumber: '100000000002', amount: '799.00', description: 'Shared subscriptions' }, 0);
  console.log('Synthetic demo users, accounts and balanced ledger entries created.');
}
