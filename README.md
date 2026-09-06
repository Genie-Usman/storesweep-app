# StoreSweep

StoreSweep is an embedded [Shopify app](https://shopify.dev/docs/apps/getting-started)
that finds and removes code left behind in a store's published theme by
uninstalled third-party apps — leftover chat widgets, review scripts,
marketing pixels, and `<!-- Begin App -->` blocks that quietly slow stores
down.

## How it works

1. **Scan (read-only).** StoreSweep pages through every text file
   (`.liquid` / `.json`) in the store's published theme via the Admin
   GraphQL API and matches it against a catalog of known app signatures
   (Judge.me, Loox, Tidio, Klaviyo, TikTok Pixel, and ~25 more, each with a
   category and confidence level). Nothing is written to the store.
2. **Review.** Findings are listed with app name, file, line range, a code
   preview, and a confidence hint. A match means *"review this"* — the app
   may still be installed or intentionally used.
3. **Clean (server-authoritative).** The merchant selects exact findings.
   The server re-fetches and re-scans the live theme, verifies the files
   haven't changed since the scan (per-file sha256 checksums), backs up
   every affected file into the theme
   (`sections/header-storesweep-backup.liquid`), and only then writes the
   cleaned files. The browser never sees or submits theme source code.
4. **Restore.** Any completed cleaning run can be undone with one click —
   backups are copied back over the originals.

Every scan, cleaning run, restore, and GDPR event is persisted and auditable
in-app (History and Settings pages). Scans and cleans are rate-limited per
shop. The mandatory GDPR webhooks (`customers/data_request`,
`customers/redact`, `shop/redact`) are implemented; shop records are deleted
30 days after uninstall.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20.19+ (or 22.12+)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)
- A [Shopify partners account](https://partners.shopify.com) and development store

### Local development

> After pulling changes that touch the Prisma schema, run npm run setup and **restart** shopify app dev  — a running dev server keeps the
> previously generated Prisma client in memory and will fail writes with
> confusing errors until restarted.

```shell
npm install
npm run setup   # prisma generate + migrate deploy (SQLite)
npm run dev     # shopify app dev — provides env vars, tunnel, and preview
```

Press `P` in the CLI to open your app, then install it on a development
store.

### Tests, lint, typecheck, build

```shell
npm test        # Node built-in test runner (app/**/*.test.js)
npm run lint
npm run typecheck
npm run build
```

CI (`.github/workflows/ci.yml`) runs all four on every push and pull
request.

## Project layout

```
app/
  services/    theme I/O, scan/clean/restore orchestration, audit
  utils/       scanner + signature catalog, findings, rate limiting, logging
  routes/      dashboard, history, settings, JSON API, webhooks, auth
prisma/        schema + migrations (SQLite by default)
docs/          architecture deep-dive
```

## Deployment

This is the standard [React Router Shopify template](https://shopify.dev/docs/apps/build/cli-for-apps)
deployment flow: provision a production database (SQLite works for a single
instance; use managed Postgres for multi-instance), set the environment
variables from `shopify app env`, then `npm run build` / `npm run start` or
`shopify app deploy`. See the
[deployment guide](https://shopify.dev/docs/apps/launch/deployment) for
hosting options.

Database tables are created with `npm run setup`
(`prisma generate && prisma migrate deploy`).

## Notes

### Before you ship

1. **Protected theme-file access.** Cleaning requires the `write_themes`
   scope plus Shopify's approval of the developer's
   [protected theme-file access exemption](https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform).
   Approval can take weeks — submit the form early. The dashboard surfaces
   this state with a link to the form.
2. **Live smoke test.** Unit tests run against fakes; run
   `shopify app dev` against a development store and exercise a full
   scan → clean → restore cycle on a copy of a real theme before
   deploying. The GraphQL operations are already validated against the
   Admin 2026-07 schema via `npm run graphql-codegen`.
3. **Billing (optional).** Set `BILLING_ENABLED=true` in production to
   require the Pro subscription ($9.99/30 days, 7-day trial) for cleaning
   and restoring. Without the flag, everything is free.
4. **API versions.** Admin calls and webhooks both target `2026-07`
   (`ApiVersion.July26`); bump both together when upgrading.

### Single vs. multi-instance

The in-memory rate limiter is per-instance; swap it for Redis when running
multiple instances (see docs/ARCHITECTURE.md). SQLite works for a single
instance; switch the Prisma datasource to Postgres for multi-instance
deployments.
