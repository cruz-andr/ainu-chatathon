# Public demo: Vercel + Mac mini

Visitors open Vercel, describe an idea and consent to external processing. No
visitor key, account, SSH target or Tailscale is required. Vercel serves the static
frontend and a short-lived proxy function; the always-on Mac mini owns the queue,
patent API, reports and local Codex CLI. The MacBook is not part of this path.

## Deploy

1. Import `cruz-andr/ainu-chatathon`, branch `main`, in Vercel. Keep the repository
   root as Root Directory, Framework Preset **Other**, Node.js **22.x**. The checked-in
   configuration runs `npm run build`; leave Output Directory override disabled.
2. Add two **server-only** environment variables in Vercel's project settings:
   `MAC_MINI_API_URL` and `MAC_MINI_PROXY_KEY`. The host's private
   `.runtime/vercel-settings.env` contains their values. Never add a `PUBLIC_` or
   `VITE_` prefix, commit this file, or paste its contents into chat.
3. Deploy. Open the production URL in a private browser window. `/api/health`
   should return `status: ok`, `searchConfigured: true`, `aiConfigured: true`.
   Submit a fictional idea, review the generated queries, then explicitly opt in
   to patent search. A second browser must not be able to read the first's job URL.
4. If Vercel itself asks visitors to log in, check project Deployment Protection;
   the intended public production deployment must permit unauthenticated access.

The build emits Vercel Build Output API v3. Only five frontend assets and the
isolated proxy module are deployed. No `.env`, fixture reports, SQLite database,
Codex executable or login files are included. See
[Vercel Build Output API](https://vercel.com/docs/build-output-api) and
[environment variables](https://vercel.com/docs/environment-variables).

## Host operation

On the mini, `node scripts/setup-vercel.js` creates a dedicated private proxy key
once and exports the current tunnel URL with that key. Restart the host after
first creating the key; run the setup script again after the tunnel is ready.
The launchd job `com.ainu.patent-demo` keeps the backend and tunnel running, using
`CODEX_MODE=local`. The mini must stay powered, online and logged into its host user.
The LaunchAgent starts at login after a reboot; it is not a pre-login system daemon.

**Current tunnel is temporary.** A tunnel/host restart can change its URL. Update
`MAC_MINI_API_URL` in Vercel and redeploy after any change. A stable custom-domain
Cloudflare Tunnel is the next step for unattended, durable hosting; it requires
the owner's domain/Cloudflare account setup. Never tunnel unauthenticated port 3001.

PDF download additionally requires `pdflatex` on the mini (optionally set
`PDFLATEX_BINARY` to its absolute path in the mini's `.env`). Without it, PDF
returns an explicit configuration error; Markdown and LaTeX still work.

## Privacy and limits

Anonymous browsers receive an eight-hour signed HttpOnly/Secure/SameSite cookie.
The mini accepts anonymous identities only with the dedicated server credential.
Jobs/reports are owner-scoped and expire one hour after completion or on restart.
Losing the cookie loses access; no report recovery/account system is implemented.
Founder/patent content is processed by the hosting path, patent provider and model
provider after consent; do not submit confidential inventions to this demo.

Persistent UTC budgets: per visitor 6 jobs/hour, 8 AI calls/day, 24 patent calls/day;
per network 10 jobs/hour, 20 AI calls/day, 60 patent calls/day; global 60 AI and 120
patent calls/day, shared with teammate access. Patent requests reserve their
worst-case search/detail calls, even if a job fails. Only keyed IP digests (not raw
addresses), visitor IDs and counters are saved by the application. These limits
bound worker usage, not Vercel traffic/billing or provider subscription quotas.
Shared Wi-Fi shares the network limit; deleting cookies does not reset it.
No CAPTCHA is implemented: distributed abuse can exhaust the daily demo budget.

One model job runs at a time; queue max five pending, two per owner. Polling keeps
long-running model work off Vercel function execution time. PDF compilation is
serialized separately and bounded. Public responses are capped at 4 MB.

To disable public access, remove `.runtime/vercel-proxy-key` on the mini and restart
the host (keep a private backup if desired). To rotate, replace it with a fresh
32-byte random hex secret, restart, update the Vercel key and redeploy. Rotation
invalidates browser sessions. Never reuse a teammate invite as the service key.
