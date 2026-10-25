# Connect your MongoDB database

The complete application can run without an Atlas account using `npm run demo`. That command starts a temporary local MongoDB replica set and seeds synthetic accounts. Its data disappears when you stop it; it never reads or modifies your Atlas database.

For persistent data, connect MongoDB Atlas:

1. Create an Atlas project and a cluster at https://www.mongodb.com/cloud/atlas/register. A free cluster is enough to try this project.
2. Under **Database Access**, create a database user. This is separate from your Atlas sign-in. Give it `readWrite` access to the `vault_bank` database. Keep the generated password private.
3. Under **Network Access**, allow your current public IP. If your IP changes, update the allowlist.
4. Select your cluster's **Connect → Drivers → Node.js** option and copy the application connection string.
5. Run `npm run setup` in this folder if you have not already. Open `server/.env` and set `MONGODB_URI`. Include `vault_bank` before the query string. Example shape only:

   ```dotenv
   MONGODB_URI=mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER/vault_bank?retryWrites=true&w=majority
   ```

   Replace every placeholder. Percent-encode special password characters such as `@`, `#`, `:` or `/`. Do not paste the URI in a chat, screenshot, or source control. The `.env` file is ignored by Git.
6. Run `npm run db:check`. It checks connection and transaction support without printing your URI.
7. Stop any running demo with Ctrl+C, then run `npm run dev`. Open http://localhost:5173 and register your own account. New accounts start at ₹0.00. With `SANDBOX_FUNDING=true`, use **Add money** to create simulated funds, then create a second user to test transfers.

An Atlas cluster provides the replica set needed for multi-document transactions. A standalone local MongoDB server does not: use a replica set, Atlas, or the included demo launcher.

## Optional transaction email

Email is optional. No email account is needed for login, account creation, deposits, or transfers. To enable transaction receipts, enter your provider's values for `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `server/.env`, then restart the server. A mail testing service is suitable for development. Do not use a normal account password where the provider requires an app password. Missing SMTP settings disable delivery; failed email must never reverse a committed transfer.

## Common connection problems

| Problem | Check |
| --- | --- |
| Authentication failed | Atlas database username/password; percent-encoding; readWrite permission on vault_bank |
| Connection timeout | Current public IP in Network Access; firewall/VPN; cluster available |
| SRV/DNS error | Connection string copied fully; working DNS; network connection |
| Transaction support missing | Use Atlas or a replica set, not standalone MongoDB |
| Port already in use | Stop the existing preview before starting another |

Official guides: [Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/), [database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/), [IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/), [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/).
