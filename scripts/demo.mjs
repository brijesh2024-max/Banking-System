import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const downloadDir = fileURLToPath(new URL('../.local/mongodb-binaries/', import.meta.url));
await mkdir(downloadDir, { recursive: true });
process.env.MONGOMS_DOWNLOAD_DIR = downloadDir;
process.env.MONGOMS_VERSION ||= '7.0.24';
// Demo always uses an isolated database and never a URI from server/.env.
process.env.NODE_ENV = 'development';
process.env.PORT = '4000';
process.env.HOST = '127.0.0.1';
process.env.TRUST_PROXY = '0';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.SANDBOX_FUNDING = 'true';
process.env.DEMO_MODE = 'true';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

async function assertAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the other Vault preview before starting a new one.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

let replica;
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (replica) await replica.stop();
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
  await assertAvailable(4000);
  await assertAvailable(5173);
  console.log('Starting an isolated MongoDB replica set for the Vault demo.');
  console.log('The first launch downloads MongoDB once. Demo balances are simulated and reset when stopped.');
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replica.getUri('vault_demo');
  const { connectDatabase, disconnectDatabase } = await import('../server/src/db.js');
  const { seedDemo } = await import('../server/src/seed.js');
  await connectDatabase(process.env.MONGODB_URI);
  await seedDemo();
  await disconnectDatabase();
  const api = spawn(process.execPath, [fileURLToPath(new URL('../server/src/index.js', import.meta.url))], { cwd: root, stdio: 'inherit', env: process.env, windowsHide: true });
  children.push(api);
  const web = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1'], { cwd: fileURLToPath(new URL('../client/', import.meta.url)), stdio: 'inherit', env: process.env, windowsHide: true });
  children.push(web);
  for (const child of children) {
    child.on('error', (error) => { console.error(error.message); void stop(1); });
    child.on('exit', (code) => { if (!stopping) void stop(code ?? 1); });
  }
  console.log('\nVault demo: http://localhost:5173');
  console.log('Sign in: brijesh@vault.demo / VaultDemo123!');
  console.log('Recipient: 100000000002 (Ananya). Stop with Ctrl+C.\n');
} catch (error) {
  console.error(`Demo could not start: ${error.message}`);
  await stop(1);
}
