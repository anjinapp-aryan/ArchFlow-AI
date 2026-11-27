# Deployment (Cloudflare Workers Static Assets)

**Target URL:** <https://app.archflow-ai.workers.dev>. **Status:** the dedicated account exists (ID `cd9e6a7f…`, pinned in `wrangler.jsonc`), and GitHub Actions deploys `main` to it after the owner's approval. The first deploy is waiting for the owner steps in the [migration checklist](#migration-checklist).

| | Current (interim) | Target |
| --- | --- | --- |
| URL | `https://archflow-ai.<shared-subdomain>.workers.dev` | `https://app.archflow-ai.workers.dev` |
| Worker name | `archflow-ai` | `app` |
| Cloudflare account | shared with another project (ID `1cbccc56…`) | dedicated ArchFlow account |
| workers.dev subdomain (account setting) | belongs to the other project | `archflow-ai` |

The interim Worker stays live and untouched until the target is verified (see [Rollback](#rollback)).

## Why a dedicated account is required

A workers.dev URL is `<worker-name>.<account-subdomain>.workers.dev`. The two parts are separate settings:

- **The Worker name** is per Worker. It is `name` in `wrangler.jsonc`, now `"app"`.
- **The workers.dev subdomain** is one value for the **whole account**. Every Worker on the account shares it.

Inspection of the current account on 2026-11-27 (read-only API calls):

- The account hosts two Workers: `archflow-ai` (this app) and a Worker that belongs to another project.
- The subdomain is named after that other project.
- So renaming the Worker alone gives `app.<other-project-subdomain>.workers.dev`.
- Renaming the account subdomain to `archflow-ai` would change the **other project's** URL too, breaking it.

**Do not change the shared account's subdomain.** ArchFlow moves to its own account instead.

The ArchFlow Worker has nothing else to migrate:

- no bindings;
- no secrets;
- no environment variables;
- no routes or custom domains;
- no KV, D1 or R2.

It is static assets only: `apps/web/dist` plus `_headers`, configured entirely by `wrangler.jsonc`.

## What is deployed

`apps/web/dist` only: static files, no Worker script. Static asset requests are free and unlimited on the free plan. The largest file is 0.4 MB; the limit is 25 MiB.

Security and caching headers come from `apps/web/dist/_headers`, which `npm run web:build` writes:

- strict CSP plus `nosniff`, no-referrer, `DENY` framing, COOP and a permissions policy;
- `index.html` is never cached;
- `/assets/*` is cached for one year (immutable, because names are content-hashed).

## How deployment works

**Normal path: GitHub Actions.** The `deploy` job in `.github/workflows/ci.yml` runs on every push to `main`, in this order:

1. It waits until every CI job has passed, including the engine build and the browser tests on ubuntu.
2. It waits for an approval in the GitHub environment **`production`**. The required reviewer is the repository owner, and only `main` may deploy.
3. It downloads the exact `apps/web/dist` the ubuntu job built and tested (artifact `archflow-web-dist`).
4. It runs `npm run deploy -- --skip-build` with the `CLOUDFLARE_API_TOKEN` secret.
5. It runs the full end-to-end suite against the live URL.

**Do not use Cloudflare's own Git integration (Workers Builds).**
- It runs `wrangler deploy` on an unbuilt checkout. `apps/web/dist` is not in git: it needs the WASM engine build (Emscripten, pinned upstream), which Workers Builds does not do.
- It fails with `The directory specified by the "assets.directory" field ... does not exist: /opt/buildhome/repo/apps/web/dist`.

**The guard: `npm run deploy` (`scripts/deploy-web.mjs`).** CI and manual deploys both go through it.
- It runs the exact wrangler version 4.168.0.
- It refuses to run when the `name` is not `app`, when `account_id` is missing, or when `account_id` is the shared account.
- After a real deploy, it exits with code 2 if wrangler did not report `https://app.archflow-ai.workers.dev`.
- `--dry-run` validates the build and upload without publishing.
- `--skip-build` deploys the existing `dist`.
- For a manual deploy from a PC, wrangler must be logged in to the dedicated account (`npx wrangler login`, then `npx wrangler whoami` lists it), or `CLOUDFLARE_API_TOKEN` must be set.

## Manual Cloudflare dashboard steps (owner)

1. **Create the dedicated account.**
   - Sign in at <https://dash.cloudflare.com>.
   - If Account Home offers to create or add another account, create one named "ArchFlow AI". It is then reachable with the same login.
   - Otherwise, sign up again with a separate email address. That gives a separate login, and wrangler must log in as that user.
2. **Open the new account:** Account Home → "ArchFlow AI" → **Workers & Pages**.
   - New accounts are asked to choose a workers.dev subdomain on first visit; enter **`archflow-ai`**.
   - If it was already set, use **Workers & Pages → Overview → Subdomain (right-hand panel) → Change**. Exact labels can differ between dashboard versions.
   - Subdomains are global: if `archflow-ai` is taken, pick another name (for example `archflow`) and update `EXPECTED_URL` in `scripts/deploy-web.mjs`.
   - On 2026-11-27, `*.archflow-ai.workers.dev` did not resolve in DNS. That suggests the name is unclaimed, but it is not proof.
3. **Copy the Account ID:** Workers & Pages → Overview → right-hand panel, or the 32-hex value in the dashboard URL.
4. **Wait for the subdomain to go live.** A new workers.dev subdomain can take a few minutes, sometimes longer, to become reachable.
5. **Do not touch the shared account:** not its subdomain, its other Workers, or its settings.

## Migration checklist

- [x] Dedicated account created (2026-11-27); `account_id` `cd9e6a7f8d05ccfc5de8d27f3e33c53b` pinned in `wrangler.jsonc`.
- [x] GitHub environment `production` created: the owner must approve each deploy, and only `main` may deploy.
- [x] `npm run deploy -- --dry-run` passes for the new account.
- [ ] **Disconnect Workers Builds** in the new account. In the Worker created by the Git import: **Settings → Build → Disconnect**. Delete that Worker too if it never deployed.
- [ ] **Set the workers.dev subdomain** of the new account to `archflow-ai` (dashboard step 2 above).
- [ ] **Create an API token.** Go to My Profile → **API Tokens** → Create Token, use the template **"Edit Cloudflare Workers"**, and set Account Resources to *Include → the ArchFlow account only*.
- [ ] **Store it in GitHub, never in chat or the repo.** Use repo **Settings → Environments → production → Add environment secret**, name `CLOUDFLARE_API_TOKEN`. Or run `gh secret set CLOUDFLARE_API_TOKEN --env production -R anjinapp-aryan/ArchFlow-AI`, which prompts for the value.
- [ ] Re-run the latest CI run on `main` (or push), then **approve** the `deploy` job when GitHub asks.
- [ ] The `deploy` job's smoke test passes; repeat the validation below by hand if wanted.
- [ ] Update the URL wherever it was shared.
- [ ] **Separate owner approval:** delete the interim Worker. Logged in to the shared account, run `npx wrangler delete --name archflow-ai`, which removes only that Worker. Re-check the other project's Worker still serves afterwards.

Secrets, bindings and environment variables to migrate: **none**. Static assets configuration: `wrangler.jsonc` `assets` block plus `_headers`, both in the repo.

## Validation commands

```sh
npx wrangler whoami                         # the new account is listed
npm run deploy -- --dry-run                 # guard + build + upload check, publishes nothing
curl -sI https://app.archflow-ai.workers.dev/ | grep -iE "^HTTP|content-security-policy|x-frame-options"
curl -s -o /dev/null -w "%{http_code}\n" https://app.archflow-ai.workers.dev/missing   # expect 404
ARCHFLOW_BASE_URL=https://app.archflow-ai.workers.dev npm run smoke:live              # expect 8/8
```

`smoke:live` runs the full web app end-to-end suite against the URL: page load, playback, every example, error display, and JSON/WebM/MP4 export. Without `ARCHFLOW_BASE_URL` it tests a local production build.

## Rollback

- **New deploy fails or misbehaves:** nothing to undo on the shared account. The interim Worker keeps serving the old URL throughout.
  - Fix and redeploy.
  - Or roll the new Worker back to an earlier version with `npx wrangler rollback` in the new account.
- **Subdomain `archflow-ai` unavailable:** choose another subdomain and update `EXPECTED_URL` in `scripts/deploy-web.mjs` and this document. Nothing else changes.
- **Abandon the migration:** keep using the interim URL. The repo guard blocks deploys to the shared account. Redeploying there would need `name` set back to `archflow-ai` and the guard removed, as a deliberate, reviewed change.
- **Never** roll back by changing the shared account's subdomain.

## Verified locally

The site ran under `wrangler dev` with `wrangler` 4.168.0 and the real `workerd` runtime:

- `/` returns 200 with every header from `_headers`.
- Hashed assets return `Cache-Control: public, max-age=31536000, immutable`.
- An unknown path returns 404 with the `404.html` page.
- No console errors or CSP violations in headless Chrome, and the WebM export worked.

## History

- 2026-11-27: first deployment, on the owner's instruction, as Worker `archflow-ai` in the shared account.
  - Version `552a2afb-6c49-4fe2-a72a-7a1f157eda10`.
  - `smoke:live` passed 8/8.
- 2026-11-27: the URL was rejected because it carried another project's name. Migration to a dedicated account was prepared.
- 2026-11-27: dedicated account created by the owner. A deploy through Cloudflare Workers Builds failed (no build of `apps/web/dist`). Deployment moved to the GitHub Actions `deploy` job, behind the `production` environment approval.
