# MatFinder-AI Development Log

> Earlier historical entries were retrospectively reconstructed from Git history, repository artifacts, and available development records. Dates primarily reflect recorded commits rather than the exact time work originally began.

## About This Log

Entries before the formal development-log process are retrospective. Git commits and repository artifacts are the primary evidence for code changes; available development conversations provide context where a diff cannot explain intent. A conversation record is not a substitute for a commit, test result, or deployment record. Details unsupported by those sources remain explicitly unknown. All dates below use the recorded commit date unless otherwise noted.

## Project Overview

MatFinder-AI is a polymer-material information, retrieval, deterministic recommendation, comparison, and AI-assisted analysis platform. Its current architecture is a native HTML/CSS/JavaScript frontend served by a Node.js built-in HTTP server, which uses `MaterialRepository` to query a read-only SQLite runtime database. Data maintenance runs separately through validation, migrations, and a transactional offline import workflow.

Candidate selection is a deterministic evidence/rule process. GPT does **not** rank candidate materials: the OpenAI integration provides optional explanation, material analysis, and comparison of material records already admitted by the public data boundary.

```text
Native HTML / CSS / JavaScript
            ↓
Node.js built-in HTTP server
            ↓
MaterialRepository
            ↓
Read-only SQLite runtime database
```

## Phase 0 — Project Concept and Pre-Git Development

**Period:** Approximately March 2026 to early June 2026. **Evidence:** Retrospective development-conversation context; Git does not establish the implementation sequence in this period.

The initial concept combined material search, requirement-based recommendation, comparison, and AI-assisted interpretation. Early discussions considered frontend/backend communication, localhost deployment, API calls, database use, LLM integration, and the difference between an AI-assisted application and an autonomous agent. A conceptual stack was roughly HTML/CSS/JavaScript → backend service → OpenAI API → JSON/SQLite data. This describes discussions, not a dated implementation milestone.

The first recoverable commit already contains a full-stack application. Consequently, the exact dates when SQLite, search, recommendation, and AI analysis/comparison first appeared—and whether a purely static prototype existed—cannot be established from Git. This phase must not be read as proof of a specific code sequence.

## Phase 1 — First Recoverable Full-Stack Baseline

**Date:** 2026-06-05. **Git evidence:** `703bed1` (`Initial commit`), `1d44990` (`Add project README`), `6499995` (`Fix Docker deployment to use shipped SQLite database`).

The earliest recoverable Git baseline includes `index.html`, `app.js`, `server.js`, `recommendation-engine.js`, `matfinder.db`, Docker and platform configuration, and database/data migration tooling. The code already supports browser search and filtering, local deterministic recommendation, and optional server-side OpenAI material analysis and comparison. The native frontend talks to a Node built-in HTTP server backed by SQLite; it was not a browser-only initial commit.

The README documented this architecture. Commit `6499995` then changed Docker to use the SQLite artifact shipped with the repository rather than regenerating it during image construction, and replaced the production Python reader with a Node reader. The diff proves the deployment-path change; it does not by itself prove a particular production outage. This is the **earliest recoverable Git baseline**, not the absolute beginning of development.

## Phase 2 — Material Experience, Recommendation and AI UI

**Period:** 2026-06-05 to 2026-06-06. **Git evidence:** `4833854`, `0bedc80`, `80520f1`, `4e66cc0`, `86fdd92`, `589ba4e`, `cd3b968`, `9149a82`, `56d32f2`, `9047196`, `5c03a67`, `6cc35ce`, `ca22944`.

This sequence added responsive layouts, richer material details, MatWeb-style catalog presentation, and a catalog expansion described by its commit as approximately 333 entries. It also added an AI panel in material details, a Copilot-style contextual UI, print/PDF reporting, client-side routes, and navigation/onboarding refinements. The Copilot UI drew on local material and recommendation context; its name alone should not be taken as evidence of a new autonomous agent or a separate LLM ranking path.

Commit `4e66cc0` adjusted recommendation scoring to express requirement coverage and weak matches more clearly. The ranking remained local and deterministic; OpenAI remained an analysis/explanation layer. Commit `9047196` introduced roughly 48-item frontend pagination and caching to reduce unnecessary rendering. Commit `cd3b968` adjusted SQLite writing/data generation for Chinese text encoding and regenerated the database snapshot. These diffs show implementation changes, not undocumented user-facing incidents or measured traffic.

## Phase 3 — Schema and Generated Catalog Expansion

**Date:** 2026-06-09. **Git evidence:** `3e0146e` (`Upgrade material database schema`), `b2b06e2` (`Expand database to 7531 commercial material entries`), `f6b8882` (`Add application domain filtering`).

Material fields and classifications expanded, structural database validation was introduced, and application-domain filtering was added. The catalog reached **7,531 material records following a commercial-style generated screening expansion**. The expansion script identifies its source type as `generated_commercial_catalog` and says supplier datasheets must be checked before engineering use. The larger catalog improved search breadth; it did not establish manufacturer-grade identity or reliable provenance for every property. This distinction became a significant later data-governance concern.

## Phase 4 — Bilingual Data and Polymer-Focused Positioning

**Period:** 2026-06-09 to 2026-06-10. **Git evidence:** `fdb5510`, `d9a79ed`, `198db03`, `db83a94`, `7c96839`, `23db397`, `4c37973`, `47379a7`, `305329d`.

The material page received scrolling/layout corrections and several style and hierarchy revisions. Deterministic Chinese mapping rules grew into bilingual JSON/SQLite persistence and structural validation. The mapping code explicitly avoids an external translation API; structural coverage does not, on its own, establish specialist translation accuracy.

Commit `47379a7` shifted UI wording and category grouping toward a polymer-focused materials platform. It primarily changed frontend presentation, not the evidence status of existing database rows. The detail view also gained a clearer empty-input state. Product direction was increasingly polymer-focused, while trust in the generated catalog remained a separate issue.

## Phase 5 — Data Trustworthiness

**Date:** 2026-07-29. **Git evidence:** `b05785b` (`Harden material recommendations and data validation`) and historical review context.

Review of the expanded data exposed a recurring ambiguity among material records, property/evidence records, polymer families, commercial grades, generated rows, and verified rows. Later database audits counted 7,531 material records, 120,496 property-evidence rows, and 7,818 identity-evidence rows. The 120,496 figure counts **property evidence**, not materials.

The emphasis shifted from “How much data do we have?” to “Can this data be trusted for engineering selection?” Commit `b05785b` added `material-quality.js` and `catalog-search.js`, strengthened recommendation/search validation, and added safety tests. Generated sources were identified as screening data; missing external sources, testing context, and implausible properties were surfaced rather than silently treated as design evidence. The core distinction became: a generated record is not a verified supplier commercial grade.

## Phase 6 — Evidence, Provenance and Controlled Import

**Date:** 2026-07-29. **Git evidence:** `a3ba234` (`Add audited real-material import workflow`), `docs/material-evidence-model.md`, `data/audits/evidence-migration-audit.md`, and importer tests.

The project introduced property-level evidence, source records, separate certification claims, quality states, provenance, conflict preservation, reviewed templates, and batch/entity links. The audit found 120,496 legacy property rows without a source URL, test standard, or test condition. Old records were retained but conservatively isolated, not promoted to verified engineering evidence. Data may be retained without being granted verified engineering status.

The importer established an offline controlled write path:

```text
Reviewed input → validation → dry run → exact identity check
               → BEGIN IMMEDIATE transaction
               → material/evidence/source writes → batch tracking
               → commit or rollback
```

It rejects placeholder claims, hashes input for idempotency, preserves conflicting evidence, and supports scoped batch rollback. Import tests cover dry-run immutability, duplicate input, conflicts, transaction failure, and rollback. The workflow's existence does **not** prove that real manufacturer grades had already been imported; the pilot materials in this commit were explicitly placeholders.

## Phase 7 — Polymer Family / Commercial Grade Separation

**Date:** 2026-07-30. **Git evidence:** `96b8251` (`Separate polymer families from commercial grades`), `docs/catalog-layer-model.md`, and `docs/database-lifecycle-plan.md`.

This change distinguished a polymer family such as ABS, PC, PA66, POM, or PP from a specific **manufacturer + commercial grade + material family** identity. The Polymer Family layer became educational/reference material, with `recommendationEligible: false`; family-level typical properties are not substitutes for a commercial-grade technical data sheet. The Commercial Grade layer carries engineering identity and evidence needed for public search, recommendation, comparison, and AI analysis.

Legacy, generated, out-of-scope, admin-only, and quarantined data were separated from the default trusted public catalog rather than deleted. This made the public-versus-audit data boundary explicit, although the audit API still required an authorization fix later.

## Phase 8 — Startup Memory and On-Demand SQLite

**Date:** 2026-07-30. **Git evidence:** `e441d7f` (`Fix startup memory with on-demand SQLite queries`), `docs/render-startup-memory.md`, `material-repository.js`, and `scripts/test-startup-memory.js`.

Before this change, startup decoded large material/evidence sets and retained multiple JavaScript arrays. Historical code directly shows that mechanism. Repository documentation associates it with Render startup memory/OOM trouble and records an intermediate state around **350 MB RSS**. The commit replaced startup-wide loading with `MaterialRepository`: read-only `node:sqlite`, on-demand SQL, pagination, bounded hydration, and lazy detail/property evidence reads. Startup no longer performs migrations, imports, evidence audits, or full database reads.

The repository document records roughly **59 MB RSS** at HTTP listen after the fix. A later architecture-audit regression recorded approximately **50.1 MiB startup-peak RSS** and **56.9 MiB after repeated access**. These are different historical runs/stages, not interchangeable benchmark figures. The code mechanism and fix are recoverable; original Render platform logs and exact production incident details are not fully preserved in the reviewed Git history. The outcome supported by code is removal of full-dataset startup loading.

## Phase 9 — Formal Architecture Audit

**Period:** September 2026. **Evidence:** Historical architecture-audit record and the subsequent AD-01/AD-02 Git and PR workflow; this audit was not itself a feature commit.

The review characterized MatFinder-AI as a single-repository, single-process **modular monolith**: native frontend, Node HTTP server, `MaterialRepository`, read-only SQLite runtime, offline imports, deterministic recommendation, and optional OpenAI explanation/comparison. It identified concrete correctness, security, data-lifecycle, and test/deployment debts before selecting fixes.

The recorded workflow became more explicit: architecture audit → evidence and debt register → isolated fix branch → implementation and regression tests → read-only review → commit and PR → final review → squash merge → production verification → closure. This describes the documented AD-01/AD-02 process, not a claim that every earlier change followed it. The audit found no demonstrated need at the then-current scope for a premature move to React, Express/NestJS, an ORM, microservices, Redis, a vector database, or PostgreSQL; this was not a permanent prohibition on future architectural change.

## Architecture Debt Register

| ID | Priority | Finding | Status after AD-02 |
| --- | --- | --- | --- |
| AD-01 | Critical | Repository-root static serving could expose internal files | CLOSED |
| AD-02 | High | Audit authorization and public AI API cost/abuse boundary | CLOSED |
| AD-03 | High | Health endpoint does not express business/data readiness | PENDING |
| AD-04 | High | Server pagination precedes some browser-side filters | PENDING |
| AD-05 | High | Recommendation reads at most the first 200 candidates | PENDING |

Other recorded debt categories include the deployment artifact/database lifecycle, parity among quality rules in different layers, schema versioning/bootstrap, concentration of responsibilities in `app.js`, logging/error handling, and CI. This log records those findings; it does not implement them.

## Phase 10 — AD-01 Static Asset Boundary

**Date:** 2026-09-27. **Branch:** `fix/ad-01-static-file-exposure`. **PR:** #1. **Main squash commit:** `91f7ae09ac0e269fe0ab11fada441124d57bf17b` (`Fix AD-01: Secure static asset boundary`). **Status:** CLOSED.

The old Node static handler resolved request paths within the repository root. “Inside the repository” was treated as sufficient for downloading a file. The architecture investigation directly observed HTTP 200 for `/.env.local` and `/server.js` before the fix; their contents are not reproduced here.

The fix moved browser resources into `public/`, introduced an explicit top-level file allowlist and `public/assets/` restriction, limited SPA routes, checked traversal and real paths, and changed Vercel output from the repository root to `public/`. New HTTP-level regression tests cover public and sensitive paths. Historical validation recorded `npm test`, the static-security suite, and production startup as passing. Production checks found public assets available and sensitive/traversal paths safely denied. This was a static-publication boundary fix, not a search, recommendation, or UI redesign.

## Phase 11 — AD-02 Audit and AI API Protection

**Period:** 2026-09-27 to 2026-09-28. **Branch:** `fix/ad-02-api-access-control`. **PR:** #2. **Reviewed commit:** `e98e72c3a7c13e2b3d226da04256b84fc8a42e1f`. **Main squash commit:** `2fd6f3e5dbfd2ff9d718d19118f942301a6a023c` (`fix: protect audit and AI API boundaries`). **Status:** CLOSED.

Before AD-02, `GET /api/admin/audit-summary`, `GET /api/materials?audit=1`, and audit-mode material detail requests did not require administrator authentication. Public `POST /api/material-analysis` and `POST /api/material-comparison` lacked meaningful rate, concurrency, provider-timeout, completion-cost, and server-side cache boundaries. Git establishes these pre-fix code properties; it does not establish an actual abuse or billing incident.

The approved policy made audit data admin-only while leaving public catalog APIs anonymous and public AI analysis/comparison available for eligible public materials. `MATFINDER_ADMIN_TOKEN` is a backend environment secret; requests use `Authorization: Bearer <token>`. The credential is held only in frontend JavaScript memory—not in Git, `public/config.js`, local/session storage, or cookies. The server compares SHA-256 digests with `timingSafeEqual` and fails closed when no token is configured.

AI input is restricted to `application/json`, 8 KiB maximum body size checked both by `Content-Length` and streaming bytes, a strict field whitelist, `zh`/`en`, valid material IDs, and exactly two distinct comparison IDs. The server resolves materials within the public catalog; callers cannot choose the prompt, model, or completion cap. The server allows its configured model only if it is on the allowlist, caps analysis/comparison completion at 700/900 tokens and provider input at 128 KiB, and aborts the provider call after 20 seconds or on downstream disconnect. Provider errors are handled without returning internal details.

| Bucket or bound | Implemented policy |
| --- | --- |
| Public per-client GET | Capacity 30; refill 2/second |
| Public global GET | Capacity 200; refill 20/second |
| AI per client | Capacity 3; refill 1/120 seconds |
| AI global | Capacity 6; refill 1/60 seconds |
| Authenticated admin | Capacity 10; refill 1/second |
| Failed admin authentication | Capacity 3; refill 1/60 seconds |
| Provider concurrency | At most 1 active call per client; 2 process-wide |
| Tracked client identities | Maximum 5,000, with expiry, lazy cleanup, and LRU eviction |
| Successful AI response cache | Maximum 250 entries; 15-minute TTL; in-flight duplicate requests share work |

Render proxy handling is opt-in via `MATFINDER_TRUST_PROXY=render`. Automated verification recorded `npm test`, `npm run test:api-protection`, `npm run test:static-security`, `node --check`, and `git diff --check` as passing. The API protection tests use simulated OpenAI transport, not a live provider call.

Recorded manual production verification found that anonymous `/audit` displayed a credential prompt, invalid credentials were rejected, valid credentials loaded audit summary and isolated records, and public Materials and Learn pages remained functional. With Render autoscaling off in that deployment, three invalid attempts returned 401 and the fourth returned 429. Changing a client-supplied `X-Forwarded-For` prefix after reaching the limit still returned 429. **The tested XFF change did not bypass the production limiter identity**; that is not a proof against every possible proxy/header attack.

The live OpenAI production call was deferred because the public catalog then contained zero verified commercial grades, and the AI endpoints require an eligible public material before invoking the provider. No audit, legacy, or quarantined record was used to bypass this boundary. The deferred action is to perform one controlled live OpenAI request **after** the first verified public commercial grade is imported. AD-02 remains CLOSED; the deferred check does not authorize an import or another feature task.

## Current Data State

The following is the **historically audited snapshot**, not a guarantee about later production data:

| Measure | Audited value |
| --- | ---: |
| Material records | 7,531 |
| Property-evidence records | 120,496 |
| Identity-evidence records | 7,818 |
| `real_material_identities` | 0 |
| Public verified commercial grades | 0 |
| Public recommendation candidates | 0 |

Most old records were combinations of `legacy`, `generated`, `admin_only`, and `quarantined`. Retaining them supports reference, audit, migration, and historical analysis. Retention does not admit them automatically into trusted public recommendation, comparison, or AI analysis. The database counts come from the repository's evidence/storage audits and the later architecture-audit snapshot; current deployment state requires a separate check.

## Current Engineering Principles

| Area | Principle |
| --- | --- |
| Recommendation | Deterministic evidence/rule engine |
| GPT | Explanation, analysis, and comparison only—not candidate ranking |
| Runtime database | Read-only SQLite |
| Data writes | Offline validated, transactional importer |
| Evidence model | Preserve sources, provenance, historical versions, and conflicts |
| Legacy data | Quarantine rather than destructive deletion |
| Polymer family | Educational/reference layer |
| Commercial grade | Evidence-backed engineering-selection layer |
| Security | Explicit public/static, public API, and admin boundaries |
| Development | Branch → tests → review → PR → merge → production verification |
| Architecture | Modular monolith; avoid premature distributed architecture |

## Remaining Architecture Debt

AD-01 and AD-02 are **CLOSED**. AD-03, AD-04, and AD-05 are **PENDING**; this documentation task does not start them.

- **AD-03:** A technically healthy process/database connection does not necessarily mean the public catalog is ready for its intended recommendation workflow.
- **AD-04:** The server handles query/pagination before some browser-side category, property, domain, temperature, strength, and recyclability filters. As the public catalog grows, filtering only the received page can produce false negatives and totals that do not describe the user's full filter set.
- **AD-05:** Recommendation currently retrieves at most 200 candidates before local deterministic ranking. Once more than 200 eligible public materials exist, a suitable material may fall outside that candidate window.

Deployment artifact/database lifecycle, rule parity, schema versioning, frontend responsibility concentration, logging/error handling, and CI also remain recorded topics. Their prioritization and implementation require separate decisions.

## Development Lessons

**Build First.** The early recoverable history emphasizes an end-to-end application: search, deterministic recommendation, comparison, deployment, and optional AI assistance. Its first commit already bundled these layers, so this is a retrospective description of emphasis, not a claim that they appeared in a known sequence.

**Data Trust.** The question moved from “How much data do we have?” to “Can this material data be trusted for engineering decisions?” Generated catalog breadth did not confer verified identity or property evidence. Provenance, quality states, quarantine, exact grade identity, a controlled importer, and family/grade separation addressed that distinction.

**Engineering Discipline.** The later documented workflow asked whether the existing system was correct, secure, maintainable, and verifiable before adding more features. A formal architecture audit and debt register preceded isolated AD-01/AD-02 branches, regression tests, read-only reviews, PRs, squash merges, and production verification. This is evidence of a later process change, not a claim of an uninterrupted practice throughout the project.

## Evidence Limitations

1. Git cannot reconstruct the exact implementation sequence before the first commit. That commit already contains frontend, backend, SQLite, recommendation, and OpenAI integration.
2. Original Render OOM platform logs are not preserved in the currently reviewed Git history. The high-memory mechanism and its fix are visible in code and repository measurements, but precise production-incident details are not independently recoverable.
3. Binary SQLite history proves that database snapshots changed; it does not establish the provenance or verification status of every row.
4. Some historical development conversations survive only as contextual records rather than exact full transcripts. Their interpretations are marked retrospective, not converted into dated Git events.
5. Commit timestamps record Git events, not necessarily when design or implementation work began. Production observations in this log are historical verification records, not new checks performed while writing it.

Known facts are recorded as facts.

Supported interpretation is labelled as reconstruction.

Unknown history remains unknown.
