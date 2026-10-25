const PREFIX = 'vault.pending-payment.';
const OBJECT_ID = /^[a-f\d]{24}$/i;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const STORAGE_ERROR = 'Vault cannot safely save this payment in your browser. Allow session storage, then try again. No new payment was sent.';

function storageKey(userId) {
  if (!OBJECT_ID.test(userId)) throw new Error('Sign in again before making a payment.');
  return `${PREFIX}${userId}`;
}

export function validatePendingPayment(value, userId) {
  const amount = typeof value?.amount === 'string' ? value.amount : '';
  const [whole, fraction = ''] = amount.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!value || value.version !== 1 || value.userId !== userId || !OBJECT_ID.test(userId)
    || !['transfer', 'fund'].includes(value.kind) || !UUID.test(value.key)
    || !OBJECT_ID.test(value.fromAccountId) || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(amount)
    || !Number.isSafeInteger(paise) || paise < 1 || paise > 10_000_000_000
    || typeof value.description !== 'string' || value.description.length > 200
    || /[\u0000-\u001f\u007f]/.test(value.description)
    || typeof value.recipientName !== 'string' || value.recipientName.length > 80
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || (value.kind === 'transfer' && !/^\d{12}$/.test(value.toAccountNumber))
    || (value.kind === 'fund' && value.toAccountNumber !== '')) {
    throw new Error('A saved payment could not be read safely. Check your transaction history before starting another payment in this tab.');
  }
  return Object.freeze({ version: 1, userId, kind: value.kind, key: value.key, fromAccountId: value.fromAccountId,
    toAccountNumber: value.toAccountNumber, recipientName: value.recipientName, amount,
    description: value.description, createdAt: value.createdAt });
}

export function readPendingPayment(storage, userId) {
  let saved;
  try { saved = storage.getItem(storageKey(userId)); }
  catch { throw new Error(STORAGE_ERROR); }
  if (saved === null) return null;
  let parsed;
  try { parsed = JSON.parse(saved); }
  catch { throw new Error('A saved payment could not be read safely. Check your transaction history before starting another payment in this tab.'); }
  return validatePendingPayment(parsed, userId);
}

export function savePendingPayment(storage, payment) {
  const validated = validatePendingPayment(payment, payment.userId);
  const existing = readPendingPayment(storage, payment.userId);
  const encoded = JSON.stringify(validated);
  if (existing && JSON.stringify(existing) !== encoded) throw new Error('Confirm the saved payment before starting another one.');
  try {
    storage.setItem(storageKey(payment.userId), encoded);
    if (storage.getItem(storageKey(payment.userId)) !== encoded) throw new Error('Storage did not retain the payment.');
  } catch { throw new Error(STORAGE_ERROR); }
  return validated;
}

export function clearPendingPayment(storage, userId, key) {
  const existing = readPendingPayment(storage, userId);
  if (!existing) return;
  if (existing.key !== key) throw new Error('A different payment is still awaiting confirmation.');
  try {
    storage.removeItem(storageKey(userId));
    if (storage.getItem(storageKey(userId)) !== null) throw new Error('Storage did not clear the payment.');
  } catch { throw new Error('The payment was confirmed, but its saved reference could not be cleared. Retry with the same details to safely check it.'); }
}

export function isDefinitivePaymentFailure(status, code, wasAlreadyPending) {
  // These business failures happen only after the server checks the saved key.
  if (['INSUFFICIENT_FUNDS', 'BALANCE_LIMIT', 'SAME_ACCOUNT'].includes(code)) return true;
  // Authentication/rate-limit/validation failures on a retry do not establish
  // whether an earlier attempt committed. Keep its reference for reconciliation.
  return !wasAlreadyPending && [400, 403, 404, 409, 429].includes(status) && code !== 'IDEMPOTENCY_CONFLICT';
}
