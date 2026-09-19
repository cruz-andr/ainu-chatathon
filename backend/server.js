import { createApp } from './app.js';
import { SerpApiProvider } from './providers/serpapi.js';
import { CodexCliProvider } from './providers/codex-cli.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const provider = new SerpApiProvider({ apiKey: process.env.SERPAPI_API_KEY });
const ai = new CodexCliProvider({ mode: process.env.CODEX_MODE || 'ssh', target: process.env.CODEX_SSH_TARGET, binary: process.env.CODEX_BINARY });
const server = createApp({ provider, ai, frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' });
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.on('error', (error) => {
  console.error(`Server could not start (${error.code || 'unknown error'}).`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Patent research API: http://${host}:${port}`);
  console.log(`Live patent search: ${provider.configured ? 'configured; access not yet verified' : 'add SERPAPI_API_KEY to .env'}`);
  console.log(`AI worker: ${ai.configured ? ai.providerName : 'configure CODEX_MODE or CODEX_SSH_TARGET in .env'}`);
});
