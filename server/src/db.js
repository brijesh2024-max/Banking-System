import mongoose from 'mongoose';
import { User, Account, Transaction, LedgerEntry, RevokedToken } from './models.js';
import { ConfigurationError } from './errors.js';

mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);

export const transactionOptions = Object.freeze({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

export async function connectDatabase(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 });
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new ConfigurationError('MongoDB must support transactions. Use a replica set (MongoDB Atlas works) or the local demo command.');
    await Promise.all([User.init(), Account.init(), Transaction.init(), LedgerEntry.init(), RevokedToken.init()]);
    return mongoose.connection;
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}

export async function disconnectDatabase() { await mongoose.disconnect(); }
export function databaseConnected() { return mongoose.connection.readyState === 1; }
