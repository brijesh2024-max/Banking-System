import { readConfig } from '../src/config.js';
import { connectDatabase, disconnectDatabase } from '../src/db.js';
import { startupErrorMessage } from '../src/errors.js';
try {
  const config = readConfig();
  await connectDatabase(config.mongodbUri);
  console.log('Database connected. Replica-set transactions and required indexes are ready.');
} catch (error) {
  console.error('Database check failed:', startupErrorMessage(error));
  console.error('Check server/.env and docs/CONNECT-MONGODB.md.');
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
