import mongoose from 'mongoose';

const { Schema } = mongoose;
const objectId = Schema.Types.ObjectId;
export const MAX_BALANCE_PAISE = 1_000_000_000_000;
const amount = { type: Number, required: true, min: 1, max: 10_000_000_000, validate: Number.isSafeInteger };

const userSchema = new Schema({
  name: { type: String, required: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  accountCount: { type: Number, required: true, default: 0, min: 0, max: 5 },
}, { timestamps: true, versionKey: false });

const accountSchema = new Schema({
  ownerId: { type: objectId, ref: 'User', default: null, index: true },
  accountNumber: { type: String, required: true, unique: true },
  name: { type: String, required: true, maxlength: 60 },
  currency: { type: String, default: 'INR', enum: ['INR'] },
  type: { type: String, default: 'SAVINGS', enum: ['SAVINGS'] },
  internal: { type: Boolean, default: false },
  balancePaise: { type: Number, required: true, default: 0, min: -MAX_BALANCE_PAISE, max: MAX_BALANCE_PAISE, validate: Number.isSafeInteger },
}, { timestamps: true, versionKey: false });
accountSchema.pre('validate', function () {
  if (!this.internal && (!this.ownerId || this.balancePaise < 0)) this.invalidate('balancePaise', 'Customer accounts require an owner and a non-negative balance.');
});

const partySchema = new Schema({ accountNumber: { type: String, required: true }, name: { type: String, required: true } }, { _id: false });
const transactionSchema = new Schema({
  actorId: { type: objectId, ref: 'User', required: true },
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  reference: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['deposit', 'transfer'] },
  amountPaise: amount,
  description: { type: String, required: true, maxlength: 200 },
  fromAccountId: { type: objectId, ref: 'Account', default: null },
  toAccountId: { type: objectId, ref: 'Account', required: true },
  from: { type: partySchema, default: null },
  to: { type: partySchema, required: true },
  status: { type: String, default: 'completed', enum: ['completed'] },
  createdAt: { type: Date, default: Date.now, required: true },
}, { versionKey: false });
transactionSchema.index({ actorId: 1, idempotencyKey: 1 }, { unique: true });

const ledgerSchema = new Schema({
  transactionId: { type: objectId, ref: 'Transaction', required: true },
  accountId: { type: objectId, ref: 'Account', required: true },
  direction: { type: String, required: true, enum: ['credit', 'debit'] },
  amountPaise: amount,
  signedAmountPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });
ledgerSchema.index({ transactionId: 1, accountId: 1 }, { unique: true });
ledgerSchema.index({ accountId: 1, createdAt: -1, _id: -1 });

const revokedSchema = new Schema({
  jti: { type: String, unique: true, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { versionKey: false });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);
export const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
export const LedgerEntry = mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerSchema);
export const RevokedToken = mongoose.models.RevokedToken || mongoose.model('RevokedToken', revokedSchema);
