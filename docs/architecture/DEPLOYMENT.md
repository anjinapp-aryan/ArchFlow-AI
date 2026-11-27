# Deployment (Cloudflare Workers Static Assets)

Status: **deployed 2026-11-27** on the owner's explicit instruction: <https://archflow-ai.rentora-app-7k3q.workers.dev> (Worker `archflow-ai`, first version `552a2afb-6c49-4fe2-a72a-7a1f157eda10`). Redeploying publishes changes immediately, so it still needs the owner's go-ahead.

## What is deployed

`apps/web/dist` only: static files, no Worker script. Static asset requests are free and unlimited on Cloudflare's free plan; the largest file is 0.4 MB (limit 25 MiB). Configuration: `wrangler.jsonc` (repo root).

```jsonc
{
  "name": "archflow-ai",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./apps/web/dist", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash" }
}
```

Security and caching headers come from `apps/web/dist/_headers`, which `npm run web:build` writes:
- strict CSP plus `nosniff`, no-referrer, `DENY` framing, COOP and a permissions policy;
- `index.html` is never cached;
- `/assets/*` is cached for one year (immutable, because names are content-hashed).

## Verified locally

The site ran under `wrangler dev` with `wrangler` 4.168.0 and the real `workerd` runtime. Results:

- `/` returns 200 with every header from `_headers`.
- Hashed assets return `Cache-Control: public, max-age=31536000, immutable`.
- An unknown path returns 404 with the `404.html` page.
- A headless Chrome run against workerd reported no console errors or CSP violations, and the WebM export worked.

## Steps for the owner

1. `npm ci && npm run engine:build && npm run build && npm run ci`. All tests must pass.
2. `npm run web:build`.
3. ~~Confirm the copyright holder in `LICENSE`.~~ Done: Anjinappa N (MIT).
4. `npx wrangler@4.168.0 login`, then `npx wrangler@4.168.0 deploy`. This publishes to `archflow-ai.<account>.workers.dev`.
5. Smoke-test the live site with the full end-to-end suite (page load, playback, every example, error display, JSON/WebM/MP4 export):
   `ARCHFLOW_BASE_URL=https://archflow-ai.rentora-app-7k3q.workers.dev npm run smoke:live`. Without the variable it runs against a local production build.
6. Optional: attach a custom domain in the Cloudflare dashboard.

Alternative: the CI workflow uploads `apps/web/dist` as the `archflow-web-dist` artifact on every run, so any static host can serve it. The host must apply `_headers`; on hosts without `_headers` support, configure the same headers there.

## Status of owner-gated steps

- Repository pushed to <https://github.com/anjinapp-aryan/ArchFlow-AI>; CI is green on ubuntu-latest and windows-latest.
- Deployed with `wrangler deploy` (see Status above); `smoke:live` passed 8/8 against the live URL.
- Custom domain, analytics: there are none by design.
