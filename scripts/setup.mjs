import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envPath = fileURLToPath(new URL('../server/.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../server/.env.example', import.meta.url));
let content = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8');
if (!/^JWT_SECRET=.+$/m.test(content)) {
  const line = `JWT_SECRET=${randomBytes(48).toString('hex')}`;
  content = /^JWT_SECRET=.*$/m.test(content) ? content.replace(/^JWT_SECRET=.*$/m, line) : `${content}\n${line}\n`;
}
writeFileSync(envPath, content, { mode: 0o600 });
console.log('Local settings are ready in server/.env. Your session secret has been generated privately.');
console.log('Add MONGODB_URI, then run npm run db:check and npm run dev.');
console.log('To try the complete app with isolated test data first, run npm run demo.');
