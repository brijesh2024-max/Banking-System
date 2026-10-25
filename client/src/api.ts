export type User = { id: string; name: string; email: string; createdAt: string };
export type Account = { id: string; accountNumber: string; name: string; currency: 'INR'; type: 'SAVINGS'; balancePaise: number; createdAt: string };
export type Transaction = { id: string; reference: string; type: 'transfer' | 'deposit'; direction: 'credit' | 'debit'; amountPaise: number; description: string; createdAt: string; status: 'completed'; from: { accountNumber: string; name: string } | null; to: { accountNumber: string; name: string }; accountId: string };
export type Dashboard = { accounts: Account[]; summary: { totalBalancePaise: number; incomePaise: number; expensePaise: number; transactionCount: number }; recentTransactions: Transaction[]; activity: { date: string; label: string; incomePaise: number; expensePaise: number }[]; sandbox: boolean };
export type TransactionPage = { transactions: Transaction[]; pagination: { page: number; limit: number; total: number; pages: number } };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'NETWORK_ERROR') { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

export const SESSION_EXPIRED_EVENT = 'vault:session-expired';
export function notifySessionExpired() { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch { throw new ApiError('We could not reach Vault. Check your connection and try again.'); }
  if (response.status === 401 && !['/auth/login', '/auth/register', '/auth/me'].includes(path)) notifySessionExpired();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new ApiError('The banking server is unavailable. Start the server, then try again.', response.status);
  const data = await response.json();
  if (!response.ok) {
    const fieldMessages = data.error?.fields ? Object.values(data.error.fields).filter((value): value is string => typeof value === 'string').join(' ') : '';
    throw new ApiError(fieldMessages || data.error?.message || 'Something went wrong. Please try again.', response.status, data.error?.code || 'REQUEST_FAILED');
  }
  return data as T;
}

export function money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100); }
export function localDate(value: string, withTime = false) { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value)); }
export function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
