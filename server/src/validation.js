import { z } from 'zod';
import { AppError } from './errors.js';

export const accountId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Choose a valid account.');
export const accountNumber = z.string().regex(/^\d{12}$/, 'Enter a 12-digit account number.');
const name = z.string().trim().min(2).max(80).regex(/^[^\u0000-\u001f\u007f]+$/u, 'Remove control characters.');
const password = z.string().min(10, 'Use at least 10 characters.').max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must use at most 72 UTF-8 bytes.').regex(/[a-z]/, 'Include a lowercase letter.').regex(/[A-Z]/, 'Include an uppercase letter.').regex(/\d/, 'Include a number.');
const email = z.string().trim().toLowerCase().email().max(254);
export const registerSchema = z.object({ name, email, password }).strict();
export const profileSchema = z.object({ name }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must use at most 72 UTF-8 bytes.') }).strict();
export const accountSchema = z.object({ name: name.max(60) }).strict();
export const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/, 'Enter a positive INR amount with at most two decimal places.').refine(value => {
  const [whole, fraction = ''] = value.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise >= 1 && paise <= 10_000_000_000;
}, 'Amount must be between ₹0.01 and ₹10,00,00,000.');
export const transferSchema = z.object({ fromAccountId: accountId, toAccountNumber: accountNumber, amount: amountSchema, description: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/u).optional().default('Bank transfer') }).strict();
export const fundSchema = z.object({ amount: amountSchema }).strict();
export const idempotencySchema = z.string().uuid('Send a valid UUID in the Idempotency-Key header.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');
export const filterSchema = z.object({
  accountId: accountId.optional(), search: z.string().trim().max(100).optional(),
  direction: z.enum(['all', 'credit', 'debit']).default('all'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: date.optional(), to: date.optional(),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Start date must be before the end date.', path: ['from'] });

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) fields[issue.path.join('.') || 'request'] ??= issue.message;
    throw new AppError(400, 'VALIDATION_ERROR', 'Please check the supplied information.', fields);
  }
  return result.data;
}

export function toPaise(value) {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
