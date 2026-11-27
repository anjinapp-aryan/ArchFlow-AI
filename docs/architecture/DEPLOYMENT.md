# Deployment (Cloudflare Workers Static Assets)

**Target URL:** <https://app.archflow-ai.workers.dev>. **Status:** migration prepared but not yet carried out. Nothing changes on Cloudflare until the owner completes the manual steps below.

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

## Deploying: always `npm run deploy`

`scripts/deploy-web.mjs` builds the site and runs `wrangler deploy`. It refuses to run when:

- `wrangler.jsonc` `name` is not `app`;
- `account_id` is missing;
- `account_id` is the shared account.

After a real deploy, it exits with code 2 if wrangler did not report `https://app.archflow-ai.workers.dev`. `npm run deploy -- --dry-run` validates the build and upload without publishing anything.

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

- [ ] Steps 1–4 above done; new Account ID noted.
- [ ] `wrangler.jsonc`: uncomment `account_id` and set it to the new Account ID.
- [ ] Let wrangler reach the new account. Either option works:
  - **Same login:** `npx wrangler whoami` lists both accounts; the pinned `account_id` selects the right one.
  - **Separate login:** `npx wrangler logout`, then `npx wrangler login` as the new user.
  - **Alternative:** an API token limited to that account, with "Edit Cloudflare Workers" permission, in `CLOUDFLARE_API_TOKEN`.
- [ ] `npm run ci` passes.
- [ ] `npm run deploy -- --dry-run` passes.
- [ ] **Owner approval for the real deploy**, then `npm run deploy`.
- [ ] Validation below passes against `https://app.archflow-ai.workers.dev`.
- [ ] Update the URL wherever it was shared.
- [ ] **Separate owner approval:** delete the interim Worker. Logged in to the shared account, run `npx wrangler delete --name archflow-ai`, which removes only that Worker. Re-check the other project's Worker still serves afterwards.
- [ ] Optional, for CI deploys later: GitHub repository secrets `CLOUDFLARE_API_TOKEN` (scoped as above) and `CLOUDFLARE_ACCOUNT_ID`. CI does not deploy today.

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
