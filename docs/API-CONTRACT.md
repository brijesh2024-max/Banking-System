# Vault API contract

All API responses are JSON except CSV exports. Amounts are integer paise in responses; mutation input `amount` is a decimal INR **string** (e.g. `"1250.50"`). Errors: `{error:{code,message,fields?}}`. Auth uses an HttpOnly JWT cookie; client requests use `credentials: 'include'`. Requests from the browser go through Vite's `/api` proxy. No browser token storage.

## DTOs
- User: `{id,name,email,createdAt}`
- Account: `{id,accountNumber,name,currency:'INR',type:'SAVINGS',balancePaise,createdAt}`
- Transaction: `{id,reference,type:'transfer'|'deposit',direction:'credit'|'debit',amountPaise,description,createdAt,status:'completed',from:{accountNumber,name}|null,to:{accountNumber,name},accountId}`. Transfers between a user's own accounts have one row per ledger entry, with distinct accountId and direction. References and IDs identify the shared transaction.

## Routes
- `GET /api/health` -> `{status:'ok',database:'connected',sandbox:boolean,demo:boolean}` (503 when unavailable). `demo` is true only in the isolated seeded demo; the demo sign-in shortcut is shown only then.
- `POST /api/auth/register` `{name,email,password}` -> 201 `{user}`; creates a zero-balance Savings account atomically, signs in.
- `POST /api/auth/login` `{email,password}` -> `{user}`.
- `GET /api/auth/me` -> `{user}` or 401.
- `POST /api/auth/logout` -> `{message}`; blacklist JWT until expiry and clear cookie.
- `GET /api/accounts` -> `{accounts}`.
- `POST /api/accounts` `{name}` -> 201 `{account}` (maximum 5 accounts).
- `GET /api/dashboard` -> `{accounts,summary:{totalBalancePaise,incomePaise,expensePaise,transactionCount},recentTransactions,activity:[{date,label,incomePaise,expensePaise}],sandbox}`. Income/expense/activity refer to last 7 calendar days, including today; UTC grouping. Most recent 5 ledger entries.
- `GET /api/recipients/lookup?accountNumber=...` -> `{recipient:{accountNumber,name}}` (account owner name).
- `POST /api/transfers` `{fromAccountId,toAccountNumber,amount,description}` plus `Idempotency-Key` (UUID) -> 201 `{transaction,replayed:false}`; replay 200 same transaction with `replayed:true`.
- `POST /api/accounts/:id/fund` `{amount}` plus `Idempotency-Key` -> same response as transfer, only when sandbox funding is enabled. Uses description `Sandbox deposit`.
- `GET /api/transactions?accountId=&search=&direction=all|credit|debit&page=1&limit=10&from=YYYY-MM-DD&to=YYYY-MM-DD` -> `{transactions,pagination:{page,limit,total,pages}}`. Filters optional. Search literal text in description, reference and counterparty. Dates inclusive, UTC.
- `GET /api/transactions/export` with same filters -> CSV attachment of matching ledger entries (maximum 10000, return clear error above limit). Safe spreadsheet cells.
- `GET /api/transactions/:id` -> `{transaction}` for participant only.

Frontend views: Overview, Accounts, Transactions, Settings. Transfer modal with account lookup and review before submit; sandbox add-money modal. Global toast, loading/empty/error states. Settings shows actual user and logout, no nonfunctional controls. Demo user `brijesh@vault.demo`, password `VaultDemo123!`; second demo user `ananya@vault.demo` with same password. Demo recipient account `100000000002`; main `100000000001`, optional personal second `100000000003`. No payment provider; sandbox balances only.

## Backend integration contract
`server/src/app.js` exports `createApp(config)` (does not listen/connect); `server/src/db.js` exports `connectDatabase(uri)` / `disconnectDatabase()`; `server/src/models.js` exports `User`, `Account`, `Transaction`, `LedgerEntry`, `RevokedToken` (and any further models). `server/src/config.js` exports `readConfig(overrides={})`. `server/src/seed.js` exports `seedDemo()` only invoked explicitly by demo launcher. Tests use real isolated MongoDB replica sets via mongodb-memory-server. `config` keys: `nodeEnv`, `port`, `clientOrigin`, `mongodbUri`, `jwtSecret`, `sandboxFunding`, `disableRateLimit`, `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPass`, `smtpFrom`.

Transactions are atomic: guarded sender balance debit, receiver credit, transaction and double-entry ledger rows share one Mongo session. Session operations sequential. Unique (actorId,idempotencyKey) prevents duplication; request fingerprint detects payload changes. A per-account materialized balance provides concurrency guard; ledger aggregation is the source of displayed balances. Balances must match and never be negative. Sandbox funds pair with an internal clearing ledger account. Ownership enforced on every account route. No insecure fallback if database absent.
