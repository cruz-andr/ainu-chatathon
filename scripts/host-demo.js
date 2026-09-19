// Run under launchd on the Mac mini. No SSH session or laptop process is required.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.CODEX_MODE !== 'local') throw new Error('The standalone Mac mini host requires CODEX_MODE=local.');
mkdirSync('.runtime', { recursive: true, mode: 0o700 });
const binary = resolve('.runtime/bin/cloudflared');
const tunnel = spawn(binary, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3002'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
let backend, stopping = false, output = '';
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  backend?.kill('SIGTERM');
  tunnel.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000);
}
function inspect(chunk) {
  output = (output + chunk.toString()).slice(-16000);
  const origin = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!origin || backend || stopping) return;
  // Persist only a public URL, not provider traffic or connector credentials.
  writeFileSync('.runtime/public-url.txt', `${origin}\n`, { mode: 0o600 });
  console.log(`Shared Mac mini website: ${origin}`);
  backend = spawn(process.execPath, ['--env-file-if-exists=.env', 'backend/sharing/server.js'], {
    env: { ...process.env, PUBLIC_ORIGIN: origin, SHARE_PORT: '3002', CODEX_MODE: 'local' },
    stdio: ['ignore', 'inherit', 'inherit'], shell: false,
  });
  backend.on('error', () => { console.error('Shared backend could not start.'); shutdown(1); });
  backend.on('exit', () => shutdown(1));
}
tunnel.stdout.on('data', inspect);
tunnel.stderr.on('data', inspect);
tunnel.on('error', () => { console.error('Tunnel executable could not start.'); shutdown(1); });
tunnel.on('exit', () => { console.error('Tunnel stopped.'); shutdown(1); });
setTimeout(() => { if (!backend) { console.error('Tunnel URL was not available within 90 seconds.'); shutdown(1); } }, 90_000).unref();
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
