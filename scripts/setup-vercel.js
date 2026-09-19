// Run on the Mac mini. Never prints the service secret.
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
mkdirSync('.runtime', { recursive: true, mode: 0o700 });
const keyPath = '.runtime/vercel-proxy-key';
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
chmodSync(keyPath, 0o600);
const key = readFileSync(keyPath, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid existing proxy key.');
if (existsSync('.runtime/public-url.txt')) {
  const url = readFileSync('.runtime/public-url.txt', 'utf8').trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(url)) throw new Error('Invalid tunnel origin.');
  writeFileSync('.runtime/vercel-settings.env', `MAC_MINI_API_URL=${url}\nMAC_MINI_PROXY_KEY=${key}\n`, { mode: 0o600 });
  chmodSync('.runtime/vercel-settings.env', 0o600);
  console.log('Private Vercel settings written to .runtime/vercel-settings.env. Do not commit or share publicly.');
} else console.log('Private proxy key ready. Run again after the Mac mini tunnel starts to export Vercel settings.');
