import { AccessStore } from '../backend/sharing/access.js';
import { writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const access = new AccessStore();
try {
  const [action, value] = process.argv.slice(2);
  if (action === 'create') {
    const { id, token } = access.create(value);
    // Explicit credential issuance: exclusive file creation, never stdout or Git.
    const path = resolve(`.runtime/invite-${id}.txt`);
    writeFileSync(path, `Teammate: ${value}\nAccess code (expires in 24 hours):\n${token}\n\nShare privately. Revocation ID: ${id}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(path, 0o600);
    console.log(`Access code written to ${path}\nShare it privately, not in Git or the URL.`);
  } else if (action === 'revoke' && /^[a-f0-9]{24}$/.test(value ?? '')) {
    access.revoke(value); console.log('Access revoked, including existing browser sessions and queued work.');
  } else if (action === 'list') console.log(access.list());
  else throw new Error('Usage: npm run team:access -- create NAME | list | revoke ID');
} finally { access.close(); }
