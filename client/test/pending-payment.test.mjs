import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPendingPayment, isDefinitivePaymentFailure, readPendingPayment, savePendingPayment } from '../src/pendingPayment.mjs';

const alice = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const bob = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const payment = Object.freeze({ version: 1, userId: alice, kind: 'transfer', key: '0ab185b2-2c67-4a72-9a25-c4951c4b067d', fromAccountId: 'cccccccccccccccccccccccc', toAccountNumber: '100000000002', recipientName: 'Recipient', amount: '125.50', description: 'Shared lunch', createdAt: '2026-10-25T10:00:00.000Z' });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('a lost-response payment retains the exact key and details across dialog and session restoration', () => {
  const session = storage();
  savePendingPayment(session, payment);
  const reopened = readPendingPayment(session, alice);
  assert.deepEqual(reopened, payment);
  assert.equal(Object.isFrozen(reopened), true);
  assert.deepEqual(savePendingPayment(session, reopened), payment);
  assert.equal(readPendingPayment(session, alice).key, payment.key);
});

test('different users cannot see, overwrite, or clear each other’s pending payment', () => {
  const session = storage();
  savePendingPayment(session, payment);
  assert.equal(readPendingPayment(session, bob), null);
  clearPendingPayment(session, bob, payment.key);
  savePendingPayment(session, { ...payment, userId: bob, key: '7d8c14dd-eae7-45f4-956e-4c88a7ba5d56' });
  assert.deepEqual(readPendingPayment(session, alice), payment);
});

test('a distinct payment cannot replace an unresolved transfer or deposit', () => {
  const session = storage();
  savePendingPayment(session, payment);
  assert.throws(() => savePendingPayment(session, { ...payment, amount: '250.00' }), /Confirm the saved payment/);
  assert.throws(() => savePendingPayment(session, { ...payment, kind: 'fund', toAccountNumber: '' }), /Confirm the saved payment/);
  assert.throws(() => clearPendingPayment(session, alice, 'wrong-key'), /different payment/);
  assert.deepEqual(readPendingPayment(session, alice), payment);
  clearPendingPayment(session, alice, payment.key);
  assert.equal(readPendingPayment(session, alice), null);
});

test('unavailable, full, or silently ineffective storage refuses to authorize sending', () => {
  const inaccessible = { getItem() { throw new Error('denied'); } };
  assert.throws(() => readPendingPayment(inaccessible, alice), /cannot safely save/);
  const full = { ...storage(), setItem() { throw new Error('full'); } };
  assert.throws(() => savePendingPayment(full, payment), /cannot safely save/);
  const ineffective = { ...storage(), setItem() {} };
  assert.throws(() => savePendingPayment(ineffective, payment), /cannot safely save/);
});

test('corrupt or mismatched saved data blocks a new payment instead of discarding its reference', () => {
  const session = storage();
  const key = `vault.pending-payment.${alice}`;
  session.setItem(key, '{broken');
  assert.throws(() => readPendingPayment(session, alice), /could not be read safely/);
  session.setItem(key, JSON.stringify({ ...payment, userId: bob }));
  assert.throws(() => savePendingPayment(session, payment), /could not be read safely/);
  session.setItem(key, JSON.stringify({ ...payment, amount: '1.001' }));
  assert.throws(() => readPendingPayment(session, alice), /could not be read safely/);
});

test('a failed cleanup retains the original reference for another safe replay', () => {
  const session = storage();
  savePendingPayment(session, payment);
  session.removeItem = () => {};
  assert.throws(() => clearPendingPayment(session, alice, payment.key), /saved reference could not be cleared/);
  assert.deepEqual(readPendingPayment(session, alice), payment);
});

test('uncertain retries survive authentication, validation, throttling, and server errors', () => {
  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [400, 'VALIDATION_ERROR'], [429, 'RATE_LIMIT'], [500, 'INTERNAL_ERROR'], [409, 'IDEMPOTENCY_CONFLICT']]) {
    assert.equal(isDefinitivePaymentFailure(status, code, true), false);
  }
  assert.equal(isDefinitivePaymentFailure(400, 'VALIDATION_ERROR', false), true);
  assert.equal(isDefinitivePaymentFailure(401, 'UNAUTHENTICATED', false), false);
  assert.equal(isDefinitivePaymentFailure(409, 'INSUFFICIENT_FUNDS', true), true);
});
