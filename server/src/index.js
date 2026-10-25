import { createApp } from './app.js';
import { readConfig } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { startupErrorMessage } from './errors.js';

let server;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  if (server) await new Promise(resolve => server.close(resolve));
  await disconnectDatabase();
  clearTimeout(timeout);
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  const config = readConfig();
  await connectDatabase(config.mongodbUri);
  server = createApp(config).listen(config.port, config.host, () => console.log(`Vault API ready on port ${config.port}`));
  server.on('error', error => { console.error('Server could not start:', error.code || error.name); void stop(1); });
} catch (error) {
  console.error('Startup failed:', startupErrorMessage(error));
  await stop(1);
}
