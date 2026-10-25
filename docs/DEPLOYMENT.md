# Deploy Vault

The frontend and API are designed to run together on one HTTPS origin. MongoDB Atlas is the external database; SMTP is optional. Use a Node-capable service or a container host, not static-only hosting.

## Standard Node service

- Node version: **22.12 or later**.
- Install: `npm ci`.
- Build: `npm run build`.
- Start: `npm start`.
- Health check: `/api/health`.
- Public port: the host-provided `PORT`, or 4000 by default.

Configure the following in the host's private environment settings:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` on a managed host/container; `127.0.0.1` behind a same-machine reverse proxy |
| `PORT` | Host-provided value, or `4000` |
| `CLIENT_ORIGIN` | The exact public HTTPS origin, with no path or trailing slash |
| `MONGODB_URI` | Your private Atlas URI, including the `vault_bank` database |
| `JWT_SECRET` | A private random value of at least 32 characters; use a separate value from local development |
| `SANDBOX_FUNDING` | `true` for an interactive portfolio sandbox, otherwise `false` |
| `DEMO_MODE` | `false` or unset; the public service does not seed known demo credentials |
| `TRUST_PROXY` | `0` with no proxy; `1` only if every request passes through exactly one trusted proxy and clients cannot bypass it |

If your provider has a different proxy topology, configure the actual trusted hop count. Do not blindly enable proxy trust: client IP rate limits depend on it. Allow your deployment host's egress addresses in the Atlas IP access list. Set optional SMTP values only when you have a mail provider ready.

## Container option

The Dockerfile builds the React client, installs runtime dependencies, runs as an unprivileged user and exposes port 4000. Secrets are supplied when running the container, never embedded in the image.

```sh
docker build -t vault-bank .
docker run --rm --env-file server/.env -e NODE_ENV=production -e HOST=0.0.0.0 -e CLIENT_ORIGIN=https://your-domain.example -p 127.0.0.1:4000:4000 vault-bank
```

Replace the example origin with your domain and terminate HTTPS at your reverse proxy. For a managed container service, use its private environment settings rather than uploading `server/.env`. Docker execution requires Docker to be installed; the ordinary Node build is the primary local verification path.

## Release check

Run `npm run check` before uploading the project. Keep `.env`, `.local`, `node_modules` and local test data out of the repository. After deployment, verify `/api/health`, register a new user, sign in and sign out, and test a sandbox transfer using two accounts you control. Email should be verified separately with the configured provider.

No external payment service is required: balances and transfers remain simulated inside Vault. Do not present the site as a real bank or accept customer funds.
