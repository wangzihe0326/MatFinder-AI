# MatFinder database lifecycle plan

## Current safety boundary

`matfinder.db` remains in the repository for this release so the existing
deployment is not broken. This change does not delete the database, rewrite Git
history, or change the active Render storage path.

The current file is already above GitHub's recommended 50 MB threshold. A
mutable production database must not remain a long-term version-controlled
artifact, because every data update creates another large Git object and a
future revision could exceed GitHub's 100 MB single-file limit.

## Target architecture

1. Keep schema changes in ordered, idempotent migration scripts.
2. Keep only small, reviewed seed files in Git:
   - polymer-family learning records;
   - empty import templates;
   - configuration and controlled vocabularies;
   - no production evidence rows.
3. Store commercial grades and evidence in a production database outside Git.
4. Rebuild a blank environment by creating the schema, applying every
   migration, loading the family seed, and importing separately backed-up,
   reviewed commercial-grade batches.

`scripts/migrate-catalog-layer.py`, `scripts/migrate-import-schema.py`, and the
real-material importer are the initial migration/import chain. Before removing
the database from Git, add a clean-database bootstrap test that proves this
chain can reconstruct the complete empty schema.

## Backup and restore

- Take an application-consistent database backup before every migration or
  committed import.
- Store backups outside the repository and outside the active database volume.
- Record file size, SHA-256 checksum, UTC timestamp, schema version, and the
  latest import batch ID with each backup.
- Retain at least one pre-migration backup and a rolling set of daily backups.
- Test restoration into a separate path. A backup is not considered valid
  until `PRAGMA integrity_check`, table counts, and a read-only application
  smoke test pass.
- Never copy a SQLite file during an uncoordinated write. Use SQLite's backup
  API or pause writes and copy the database plus any required WAL state.

## Render deployment

Render's ordinary service filesystem is ephemeral. Two safe production choices
are:

1. **Recommended:** migrate production data to managed PostgreSQL. Run schema
   migrations at deploy time, keep credentials in Render environment secrets,
   and use provider backups plus an independent export schedule.
2. **Transitional single-instance option:** attach a Render persistent disk and
   place SQLite at the mounted path through `MATFINDER_DB_PATH`. Run only one
   writer instance, enable WAL and busy timeouts, and copy backups to durable
   object storage. A persistent disk does not replace off-site backup.

Do not deploy SQLite on an ephemeral path and do not scale the SQLite writer to
multiple instances.

## Git transition

After the external database is live and a restore drill passes:

1. Add `matfinder.db`, SQLite WAL/SHM files, database backups, and import
   scratch files to `.gitignore`.
2. Remove only the tracked working-tree database in a normal forward commit.
   Do not rewrite history during the deployment migration.
3. Add a pre-push or CI check that fails when a newly tracked file is above
   50 MB and treats 100 MB as a hard stop.
4. Document the bootstrap and restore commands in deployment runbooks.
5. Consider a coordinated `git filter-repo` history cleanup only as a separate
   maintenance event after all collaborators have been warned and old clones
   can be replaced.

Git LFS is not recommended for the mutable production database: it versions
large snapshots but does not provide database transactions, query access,
backups, or multi-instance coordination. It may be used only for immutable,
approved archival artifacts. Managed PostgreSQL or another external database
is the production destination.
