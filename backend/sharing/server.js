import { AccessStore } from './access.js';
import { createGateway } from './gateway.js';
import { SerpApiProvider } from '../providers/serpapi.js';
import { CodexCliProvider } from '../providers/codex-cli.js';

const access = new AccessStore();
if (!access.list().some((user) => access.active(user.id))) {
  access.close();
  throw new Error('Create an expiring teammate access code with npm run team:access -- create NAME first.');
}
const server = createGateway({ access,
  provider: new SerpApiProvider({ apiKey: process.env.SERPAPI_API_KEY }),
  ai: new CodexCliProvider({ target: process.env.CODEX_SSH_TARGET, binary: process.env.CODEX_BINARY }),
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
});
const port = Number(process.env.SHARE_PORT || 3002);
server.listen(port, '127.0.0.1', () => {
  console.log(`Authenticated teammate app: http://127.0.0.1:${port}`);
  console.log(process.env.PUBLIC_ORIGIN ? `Allowed public origin: ${process.env.PUBLIC_ORIGIN}` : 'Public hosts are blocked until PUBLIC_ORIGIN is configured.');
});
server.on('error', (error) => { console.error(`Shared server could not start (${error.code || 'unknown'}).`); process.exitCode = 1; });
