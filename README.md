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

- Cleaning requires the `write_themes` scope; Shopify additionally requires
  the developer to be approved for [protected theme-file access](https://shopify.dev/docs/apps/launch/protected-customer-data)
  before `themeFilesUpsert` calls succeed. The dashboard surfaces this
  state with a link to Shopify's exemption request form.
- The in-memory rate limiter is per-instance; swap it for Redis when
  running multiple instances (see docs/ARCHITECTURE.md).
