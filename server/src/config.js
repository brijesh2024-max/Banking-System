import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationError } from './errors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
dotenv.config({ path: path.join(root, 'server/.env'), quiet: true });

export function readConfig(overrides = {}) {
  const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    trustProxy: Number(process.env.TRUST_PROXY || 0),
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    mongodbUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    sandboxFunding: process.env.SANDBOX_FUNDING === 'true',
    demoMode: process.env.DEMO_MODE === 'true',
    disableRateLimit: false,
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || '',
    ...overrides,
  };
  if (!config.mongodbUri) throw new ConfigurationError('MONGODB_URI is required. Connect a MongoDB Atlas replica set or run the local demo.');
  if (typeof config.jwtSecret !== 'string' || config.jwtSecret.length < 32) throw new ConfigurationError('JWT_SECRET must contain at least 32 characters.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new ConfigurationError('PORT must be an integer from 1 to 65535.');
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.host)) throw new ConfigurationError('HOST must be a supported local or all-interface bind address.');
  if (!Number.isInteger(config.trustProxy) || config.trustProxy < 0 || config.trustProxy > 8) throw new ConfigurationError('TRUST_PROXY must be a proxy hop count from 0 to 8.');
  let origin;
  try { origin = new URL(config.clientOrigin); } catch { throw new ConfigurationError('CLIENT_ORIGIN must be a valid HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.clientOrigin) throw new ConfigurationError('CLIENT_ORIGIN must be an HTTP(S) origin without a path or trailing slash.');
  if (config.nodeEnv === 'production' && origin.protocol !== 'https:') throw new ConfigurationError('Production CLIENT_ORIGIN must use HTTPS.');
  if (config.disableRateLimit && config.nodeEnv !== 'test') throw new ConfigurationError('Rate limits may only be disabled in tests.');
  if (config.smtpHost && !config.smtpFrom) throw new ConfigurationError('SMTP_FROM is required when SMTP_HOST is configured.');
  if (config.smtpHost && (!Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535)) throw new ConfigurationError('SMTP_PORT must be an integer from 1 to 65535.');
  if (config.smtpHost && Boolean(config.smtpUser) !== Boolean(config.smtpPass)) throw new ConfigurationError('Configure both SMTP_USER and SMTP_PASS together, or leave both blank.');
  return Object.freeze(config);
}
