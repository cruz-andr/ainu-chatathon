# Teammate testing without Tailscale or SSH

Use the host's shared HTTPS website and a private, expiring access code. The host
keeps their SSH connection and model login. Teammates receive neither those
credentials nor the patent-provider key. This is an invite-only demo, not a
production public service.

## Ved: use the hosted UI

Open the shared HTTPS URL, enter the access code the host gives you privately,
and submit a fictional idea. The code establishes an HttpOnly browser session;
it is never placed in a URL or bundled into frontend JavaScript.

## Ved: develop your own frontend locally against the shared backend

Pull main, use Node 22.13+ and add only these to your private, ignored `.env`:

```dotenv
SHARED_API_URL=https://THE-HOSTS-TUNNEL.trycloudflare.com
SHARED_API_TOKEN=YOUR-PRIVATE-TEAMMATE-ACCESS-CODE
```

Then run `npm run frontend:shared` and open `http://localhost:5174`. Your local
frontend files are served locally; API requests are forwarded to the host with
the code attached **by the local Node server**. No credentials reach browser JS.
You do not need `SERPAPI_API_KEY`, `CODEX_SSH_TARGET`, a model login, or Tailscale.
Don't use `npm start` on the teammate machine for this workflow.

## Host setup

### Mac mini standalone service (current deployment)

The entire application and Cloudflare tunnel run on the Mac mini, not the laptop.
Its private `.env` uses `CODEX_MODE=local`, `CODEX_BINARY` pointing at its existing
CLI, and the patent-provider key. Codex is spawned directly with stdin input and
the same restricted flags; no runtime SSH or Tailscale connection is required.

`deploy/com.ainu.patent-demo.plist` is the user LaunchAgent for this host. It runs
`scripts/host-demo.js`, which supervises the tunnel and authenticated backend and
writes the current public URL to `.runtime/public-url.txt` on the mini. Launchd
restarts the supervisor if it fails. This user service starts at login, not before
login after a reboot; keep the mini powered, online, awake, and logged in.

On the mini:

```sh
launchctl print gui/501/com.ainu.patent-demo
cat /Users/acruz/projects/ainu-chatathon/.runtime/public-url.txt
```

The service runs independently of Terminal and SSH sessions. A tunnel restart may
change the temporary URL; the supervisor configures the new allowed origin
automatically, but teammates must receive the new URL. For a stable URL, provision
a named tunnel/domain. Logs contain startup information, not request bodies.

To stop this service on the mini:

```sh
launchctl bootout gui/501 /Users/acruz/Library/LaunchAgents/com.ainu.patent-demo.plist
```

To start it again, replace `bootout` with `bootstrap` in that command. Only this
project's LaunchAgent is affected. Codes and usage history remain in SQLite;
in-memory reports and browser sessions do not survive a service restart.

### Manual host setup (alternative)

1. Keep the private `.env` with SerpApi and Mac mini SSH settings on your machine.
2. Run `npm run team:access -- create ved`. It writes a 24-hour code into a
   mode-600 file under `.runtime/`; share that code privately. Do not commit it.
3. Run `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3002`.
4. Copy the printed HTTPS origin and run:

   ```sh
   PUBLIC_ORIGIN=https://YOUR-TUNNEL.trycloudflare.com npm run share
   ```

5. Share the HTTPS URL and the access code separately. Keep this host and the Mac
   mini awake, and keep both processes running. Only the host needs Tailscale.

If the official binary was downloaded locally, use `.runtime/bin/cloudflared`
instead of `cloudflared`. Never tunnel ports 3001 or 5173: those are the old,
unauthenticated local-only servers. Port 3002 serves both the authenticated UI
and the authenticated API. Without PUBLIC_ORIGIN it rejects public hostnames.

Quick Tunnels use a temporary URL and provide no uptime guarantee. Restarting
the tunnel may change the URL: update PUBLIC_ORIGIN and the teammate's
SHARED_API_URL. Use a named tunnel or managed deployment for longer-term use.
[Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

## Stop or revoke

- `npm run team:access -- list` lists nonsecret IDs and expiry times.
- `npm run team:access -- revoke ID` immediately prevents new access and skips
  that user's queued work. Already-running provider work may finish; it cannot
  be retrieved after revocation.
- Stop the tunnel to remove internet access. Stop the shared server to erase
  in-memory jobs, sessions and reports. Usage counts and code hashes persist.
- Don't delete `.runtime/access.sqlite` to restart: that would remove the budget
  history and all access codes. Credential files in `.runtime/invite-*.txt`
  contain plaintext codes for manual handoff; remove them after secure delivery.

## Contract and limits

Existing local endpoints are unchanged. The shared endpoints accept the same
plan/research payloads but return **202** with `{jobId,status}`. Poll
`GET /api/jobs/:jobId` every two seconds. A completed job includes `result`
containing the unchanged plan/report; a failed job includes `error`. The frontend
API client handles both the old synchronous and new queued responses.

For non-browser API clients, send `Authorization: Bearer ACCESS_CODE`. Do not
place codes in query strings. Cross-origin browser requests are rejected; use
the hosted UI or the local development proxy instead.

- One shared job runs at a time; at most five active/queued jobs total and two per
  teammate. Both planning and analysis use the same serialized queue.
- Per teammate: 20 jobs/hour, 20 AI invocations/day, 60 patent requests/day.
- All teammates combined: 60 AI invocations/day, 120 patent requests/day.
- Limits reserve worst-case calls before work starts and do not refund failures.
  Day/hour boundaries are UTC. These are call-count caps, not exact dollar caps;
  provider billing and token use vary.
- Authenticated HTTP requests: 120/minute per code. Login attempts: 30/minute
  globally. The shared anonymous limit is 120/minute. Forwarded IP headers are
  not trusted for bypassing limits.
- Codes expire in 24 hours, browser sessions in eight hours. The same code shares
  one identity, so issue a separate code for each person.
- Jobs/reports are memory-only, capped at 100, and expire one hour after job
  completion. The latest 100 are retained; older completed jobs may be evicted.
- SQLite stores code hashes, expiry/revocation and usage counters, not inventions.
  No request bodies, source text, cookies or tokens are logged by the application.
- The host-to-model SSH path still sends untrusted input over stdin only.
- Use fictional/non-confidential ideas. Cloudflare terminates HTTPS and relays
  request bodies; patent/model providers receive data with user consent.
- This does not grant a general remote shell or general-purpose CLI access: only
  the app's constrained patent planning and comparison tasks are exposed.

Run `npm test` for offline auth/queue/ownership/budget/security regression tests.
Node's built-in SQLite currently emits an experimental warning on Node 22; there
are no new runtime package dependencies.
