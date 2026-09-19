import { mkdir, copyFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Build Output API v3: copy only explicitly public files, never the whole repo.
const root = resolve('.vercel/output');
const publicFiles = ['index.html', 'styles.css', 'src/api.js', 'src/app.js', 'src/render.js'];
const functionFiles = ['api/index.js', 'backend/public-proxy.js'];
const expected = new Set(['config.json', ...publicFiles.map((p) => `static/${p}`),
  'functions/api.func/package.json', 'functions/api.func/.vc-config.json',
  ...functionFiles.map((p) => `functions/api.func/${p}`)]);
async function checkExisting(path, prefix = '') {
  for (const item of await readdir(path, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) await checkExisting(join(path, item.name), `${relative}/`);
    else if (item.isSymbolicLink() || !expected.has(relative)) throw new Error(`Unexpected build artifact ${relative}. Build in a clean checkout; refusing to publish stale files.`);
  }
}
await checkExisting(root);
const emit = async (path, body) => { await mkdir(resolve(root, path, '..'), { recursive: true }); await writeFile(join(root, path), JSON.stringify(body, null, 2)); };
for (const name of publicFiles) {
  const destination = join(root, 'static', name);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await copyFile(join('frontend', name), destination);
}
for (const name of functionFiles) {
  const destination = join(root, 'functions/api.func', name);
  await mkdir(resolve(destination, '..'), { recursive: true }); await copyFile(name, destination);
}
await emit('functions/api.func/package.json', { type: 'module' });
await emit('functions/api.func/.vc-config.json', { runtime: 'nodejs22.x', handler: 'api/index.js', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 });
await emit('config.json', { version: 3, routes: [
  { src: '/(.*)', headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }, continue: true },
  { src: '/api(?:/.*)?', dest: '/api' },
  { handle: 'filesystem' },
] });
console.log('Vercel build ready: five public assets and one private API function. No secrets or fixture reports included.');
