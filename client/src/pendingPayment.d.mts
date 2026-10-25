export type PendingPayment = Readonly<{
  version: 1;
  userId: string;
  kind: 'transfer' | 'fund';
  key: string;
  fromAccountId: string;
  toAccountNumber: string;
  recipientName: string;
  amount: string;
  description: string;
  createdAt: string;
}>;
type PaymentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function validatePendingPayment(value: unknown, userId: string): PendingPayment;
export function readPendingPayment(storage: PaymentStorage, userId: string): PendingPayment | null;
export function savePendingPayment(storage: PaymentStorage, payment: PendingPayment): PendingPayment;
export function clearPendingPayment(storage: PaymentStorage, userId: string, key: string): void;
export function isDefinitivePaymentFailure(status: number, code: string, wasAlreadyPending: boolean): boolean;
