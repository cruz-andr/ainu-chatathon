import { createPublicProxy } from '../backend/public-proxy.js';

export default function handler(req, res) {
  return createPublicProxy({ upstream: process.env.MAC_MINI_API_URL,
    key: process.env.MAC_MINI_PROXY_KEY, vercel: process.env.VERCEL === '1' })(req, res);
}
