# Render startup memory investigation

## Deployment commands

Render uses the Docker service in `render.yaml`.

- Build: Docker copies `package*.json`, runs `npm install --omit=dev`, then copies the application.
- Start: the Docker `CMD` is `node server.js`.
- Health check: `GET /api/health`.
- `scripts/start-production.js` is only a thin wrapper around `server.js`; it does not run migrations.

The production image uses Node 22 or later because the server now uses the
built-in SQLite connection instead of parsing the database file in JavaScript.

## Root cause at commit 96b8251

The failure happened before the HTTP server began listening.

1. `server.js` called `loadMaterials()` at module scope.
2. `scripts/read-materials-sqlite.js` read the complete SQLite file, decoded all
   tables, and attached 120,496 property evidence rows to 7,531 JavaScript
   material objects.
3. `server.js` created additional compact and public arrays.
4. `catalog-layer.js` used `flatMap` to create another array containing all
   128,314 evidence records for audit statistics.

Measured with the production database and a 384 MB diagnostic heap:

| Phase | heapUsed | RSS |
| --- | ---: | ---: |
| Before material load | 5.08 MB | 53.48 MB |
| After `readMaterials()` and quality annotation | 217.79 MB | 321.61 MB |
| After compact-material duplication | 227.45 MB | 342.46 MB |
| After audit `flatMap` | 246.68 MB | 350.47 MB |

This explains the Render failure around the 251–259 MB V8 heap limit. Raising
`--max-old-space-size` would only postpone the same allocation problem.

## Corrected startup contract

`npm start` now performs only:

1. environment configuration;
2. one read-only SQLite connection;
3. a required-table/schema version check;
4. a check that required SQLite indexes already exist;
5. HTTP listener startup.

It does not run migrations, evidence audits, data imports, index rebuilds, or
full database reads. Those remain explicit commands:

```text
npm run migrate
npm run audit:evidence
npm run import:real-materials -- --file <path>
npm start
```

Current production-database startup measurements:

| Phase | heapUsed | RSS |
| --- | ---: | ---: |
| Before SQLite connection | 4.99 MB | 55.46 MB |
| After SQLite connection | 5.05 MB | 56.00 MB |
| After schema version check | 5.07 MB | 56.50 MB |
| After Polymer Family initialization | 5.13 MB | 58.64 MB |
| After search-index check | 5.15 MB | 58.72 MB |
| After HTTP listen | 5.40 MB | 59.27 MB |

The schema phase records `migrationExecuted: false`, and the index phase records
`indexBuildExecuted: false`.

## Query and memory boundaries

- Public and audit lists use SQL filtering with `LIMIT` and `OFFSET`; the default
  page size is 48 and the hard limit is 200.
- Polymer Family count is calculated by a SQL `GROUP BY`.
- Trusted and audit statistics are SQL aggregate queries.
- List responses contain list fields, tags, uses, identity summary, and quality
  summary, but not property evidence.
- Property evidence is loaded only for one detail or for the bounded set of
  recommendation candidates requested by a user.
- Detailed candidate hydration uses batches of 30 materials; no JavaScript
  query result may exceed 1,000 rows.
- The browser detail cache is limited to 30 entries and recommendation results
  to 20 entries.
- No server-side full-material or full-evidence cache exists.

`npm run test:startup-memory` starts the real production database, checks the
home page, SQL search, detail, and recommendation candidate endpoints, then
repeats search and detail access 25 times. The regression test fails if:

- startup heap is 120 MB or higher;
- startup RSS is 300 MB or higher;
- a query reads the complete property evidence table;
- a JavaScript query batch exceeds 1,000 rows;
- repeated access shows more than 32 MB heap or 64 MB RSS growth.

The latest regression result was 5.40 MB startup heap / 59.27 MB startup RSS
and 7.04 MB heap / 66.39 MB RSS after repeated access. It read 416 requested
property rows, with a maximum single query result of 152 rows and zero full
property-table reads.

`NODE_OPTIONS=--max-old-space-size=384` is not configured. It may be used only
as a temporary diagnostic guard after confirming the instance memory limit; it
is not part of the fix.
