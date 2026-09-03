# StoreSweep Architecture

StoreSweep is an embedded Shopify app that finds and removes leftover
third-party app code in a store's published theme. This document describes
the system as of the enterprise hardening pass (Phase 2).

## Core invariants

1. **Scanning is read-only.** A scan fetches theme files and stores results;
   it never writes to the store.
2. **The server is authoritative over theme mutations.** The browser only
   ever sends *finding IDs* and the per-file checksums it saw at scan time.
   Theme source code is never sent to the client, and modified theme code is
   never accepted from the client. The server re-fetches, re-scans,
   verifies, backs up, and only then writes.
3. **Every mutation is reversible.** Before a file is modified, its original
   content is written to `<name>-storesweep-backup.<ext>` next to it. The
   original filename, backup filename, and pre-change checksum are recorded
   in the database and used by the restore flow.
4. **Every consequential action is auditable.** Scans, cleaning runs,
   restores, and GDPR events append rows to `AuditEvent`, surfaced in the
   Settings page.

## Data flow

```
Scan (read-only)
  admin GraphQL: themes(roles: MAIN) -> theme.files (paginated)
  -> filter to .liquid/.json text files under 1MB (skip our backups)
  -> scan each file against KNOWN_APP_SIGNATURES
  -> persist Scan + ScanFinding rows, touch Shop counters, append AuditEvent
  -> return findings (id, file, app, category, confidence, lines, code)
     + per-file sha256 checksums; NO theme source

Clean (mutating, server-authoritative)
  client sends: selectedFindingIds, fileChecksums, scanId
  -> re-fetch all text files, re-scan live
  -> 409 if any file checksum drifted since the scan
  -> 409 if any selected finding no longer exists
  -> compute removals per file (exact-range, overlap-merged)
  -> phase 1: write backups for every affected file, await Shopify jobs
  -> phase 2: write cleaned files, await Shopify jobs
  -> persist CleanOperation (with backup map), AuditEvent, Shop counters

Restore (mutating)
  client sends: cleanOperationId
  -> load the operation's backup map
  -> copy each backup file's content back over the original
  -> mark the operation restored; append AuditEvent
```

## Module map

| Module | Responsibility |
| --- | --- |
| `app/services/theme-api.server.js` | All Admin GraphQL theme I/O: theme lookup, paginated file listing, single-file read, text-file write, backup naming |
| `app/services/shopify-job.server.js` | Polls Shopify async `job` objects to completion |
| `app/services/scan-run.server.js` | Scan orchestration + persistence |
| `app/services/clean-run.server.js` | Clean orchestration, conflict detection, backup-then-write |
| `app/services/restore-run.server.js` | Restore orchestration |
| `app/services/audit.server.js` | Audit-event append (never throws) + shop counters |
| `app/utils/scanner.js` | Signature catalog and the per-file matcher |
| `app/utils/findings.js` | Stable finding IDs and exact-range removal with overlap merging |
| `app/utils/checksum.js` | sha256 content fingerprints |
| `app/utils/rate-limit.server.js` | Per-shop, per-action fixed-window limiter |
| `app/utils/api-helpers.server.js` | JSON response/error helpers, body size ceiling, rate-limit gate |
| `app/utils/logger.server.js` | Structured JSON logging with child loggers |
| `app/routes/api.theme.*` | Authenticated endpoints used by the dashboard |
| `app/routes/webhooks.*` | App lifecycle + mandatory GDPR webhook handlers |
| `app/routes/app._index.jsx` | Dashboard (scan, review, clean, restore) |
| `app/routes/app.history.jsx` | Scan/clean history |
| `app/routes/app.settings.jsx` | Store info, data-handling policy, audit trail |

## Signature catalog

`KNOWN_APP_SIGNATURES` in `app/utils/scanner.js` pairs each app with a
`category` (reviews, analytics, marketing, support, personalization,
subscriptions, utility, unknown) and a `confidence`:

- `high` — dedicated app CDN/domain, virtually never hand-written
- `medium` — vendor script tag that may be part of a live stack
- `low` — generic tag that is very often intentional (e.g. Google Analytics)

The catalog was derived from storefront script-footprint research across
~25k Shopify apps (`apps_by_usage.csv` in the repo root). A match always
means "review this", never "this app is uninstalled"; named
`<!-- Begin X --> ... <!-- End X -->` blocks are labeled from the comment
itself.

## Concurrency and scale

- **Rate limiting** is a fixed window per shop per action (scan 10/min,
  clean 5/min, restore 5/min), in-memory per instance. Cleaning is further
  serialized by Shopify's own theme-file job queue. If you run many app
  instances, replace `rate-limit.server.js` with a Redis-backed limiter —
  the call site (`enforceRateLimit`) stays the same.
- **Database**: SQLite via Prisma by default. The schema is portable; for
  multi-instance production use managed Postgres and point
  `prisma/schema.prisma` at it.
- **Shopify jobs**: file writes are asynchronous in the Admin API;
  `waitForShopifyJob` polls `job(id) { done }` with bounded attempts and is
  injected into tests.

## GDPR compliance

`customers/data_request` and `customers/redact` are acknowledged and
audited (StoreSweep stores no customer-level personal data).
`shop/redact`, which arrives 30 days after uninstall, deletes the shop's
scans, cleaning operations, audit events, and the Shop row itself.
`app/uninstalled` marks the Shop uninstalled and drops sessions.

## Testing

`npm test` runs Node's built-in test runner over `app/**/*.test.js`. Admin
GraphQL clients and Prisma are always injected, so every service is tested
against fakes (see `scan-run.server.test.js`, `clean-run.server.test.js`,
`restore-run.server.test.js`). CI (`.github/workflows/ci.yml`) runs lint,
typecheck, tests, and a production build on every push and PR.

## Deliberate scope boundaries (roadmap)

- **Shopify Billing** (free scan / paid clean tiers) — add `billing` config
  to `shopify.server.js` and gate `runClean` on `billing.require`.
- **Redis-backed rate limiting + background scan queue** for large themes
  and high shop counts.
- **Postgres datasource** for multi-instance deployments.
- **Scheduled rescan reminders** via Shopify Flow or app-owned cron.
