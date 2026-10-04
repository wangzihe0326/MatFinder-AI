# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS db-prepare

WORKDIR /prepare
COPY database-schema-contract.json ./
COPY scripts/migrate.py ./scripts/migrate.py
COPY matfinder.db /source/matfinder.db

# Only the independent output is writable by the canonical lifecycle.
RUN python -B - /source/matfinder.db /out/matfinder.db /out/prepared-db.json <<'PY_COPY'
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path("scripts").resolve()))
from migrate import inspect_database, load_contract

source, output, proof_path = map(Path, sys.argv[1:4])
def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

source_digest = digest(source)
info = inspect_database(source, load_contract())
if info["classification"] not in ("legacy_current", "current"):
    raise RuntimeError("unsupported build source: " + info["classification"])
output.parent.mkdir(parents=True, exist_ok=True)
with source.open("rb") as reader, output.open("xb") as writer:
    shutil.copyfileobj(reader, writer, 1024 * 1024)
if not output.is_file() or output.is_symlink() or os.path.samefile(source, output):
    raise RuntimeError("build output is not an independent regular file")
before, copied = source.stat(), output.stat()
if before.st_ino and copied.st_ino and (before.st_dev, before.st_ino) == (copied.st_dev, copied.st_ino):
    raise RuntimeError("build source/output share a file entity")
if digest(source) != source_digest or digest(output) != source_digest:
    raise RuntimeError("source changed or byte copy is incomplete")
with proof_path.open("x", encoding="utf-8") as stream:
    json.dump({"sourceDigest": source_digest, "sourceVersion": info["userVersion"],
               "sourceClassification": info["classification"]}, stream)
PY_COPY

RUN python -B scripts/migrate.py prepare --database /out/matfinder.db

# inspect/prepare exit 0 alone does not certify integrity or an already-v1 input.
RUN python -B - /source/matfinder.db /out/matfinder.db /out/prepared-db.json <<'PY_VALIDATE'
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path("scripts").resolve()))
from migrate import classify_connection, load_contract, readonly_connection, validate_target

source, output, proof_path = map(Path, sys.argv[1:4])
proof = json.loads(proof_path.read_text(encoding="utf-8"))
contract = load_contract()
with closing(readonly_connection(output)) as conn:
    conn.execute("BEGIN")
    info = classify_connection(conn, contract)
    if info["userVersion"] != 1 or info["classification"] != "current" or info["compatible"] is not True:
        raise RuntimeError("prepared database is not formal v1")
    validate_target(conn, contract)
def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
if digest(source) != proof["sourceDigest"] or os.path.samefile(source, output):
    raise RuntimeError("build source changed or output became aliased")
prepared_digest = digest(output)
if proof["sourceVersion"] == 0 and prepared_digest == proof["sourceDigest"]:
    raise RuntimeError("v0 adoption did not change database bytes")
proof.update({"preparedDigest": prepared_digest, "userVersion": info["userVersion"],
              "classification": info["classification"], "compatible": info["compatible"]})
proof_path.write_text(json.dumps(proof), encoding="utf-8")
print(json.dumps({"status": "prepared-v1-verified", **proof}))
PY_VALIDATE

FROM node:22-bookworm-slim AS node-base
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    MATFINDER_DB_PATH=/app/matfinder.db

FROM node-base AS node-finalize
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=db-prepare /out/matfinder.db /app/matfinder.db
COPY --from=db-prepare /out/prepared-db.json /build/prepared-db.json

# Freeze D* at the runtime path, then generate and hard-verify the matching set.
RUN node - /app/matfinder.db /build/prepared-db.json <<'JS_FINALIZE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadCanonicalPolicy } = require("./catalog-policy");
const { digestFile, FORMAT_VERSION } = require("./catalog-stats-artifact");
const { buildCatalogStats } = require("./scripts/build-catalog-stats");

async function main() {
  const [databasePath, proofPath] = process.argv.slice(2);
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const frozenDigest = await digestFile(databasePath);
  assert.equal(frozenDigest, proof.preparedDigest, "Prepared bytes changed during placement");
  const policy = loadCanonicalPolicy();
  await buildCatalogStats(databasePath);
  assert.equal(await digestFile(databasePath), frozenDigest, "Stats builder changed DB bytes");
  const repository = new policy.repository.MaterialRepository(databasePath);
  try {
    const generation = await repository.initializeCatalogStats();
    assert.ok(generation, "Build requires a verified catalog generation");
    assert.equal(generation.datasetDigest, frozenDigest);
    assert.equal(generation.policyDigest, policy.digest);
    assert.equal(generation.formatVersion, FORMAT_VERSION);
    assert.equal(await digestFile(databasePath), frozenDigest, "DB changed during verification");
    console.log(JSON.stringify({ status: "finalized-artifact-verified", ...generation }));
  } finally { repository.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
JS_FINALIZE

FROM node-base AS runtime
COPY --from=node-finalize /app /app

# Verify the final COPY using the runtime's own Node APIs, with no Python step.
RUN node - /app/matfinder.db <<'JS_VERIFY'
const assert = require("node:assert/strict");
const { loadCanonicalPolicy } = require("./catalog-policy");
const { digestFile, FORMAT_VERSION } = require("./catalog-stats-artifact");

async function main() {
  const databasePath = process.argv[2];
  const policy = loadCanonicalPolicy();
  const frozenDigest = await digestFile(databasePath);
  const repository = new policy.repository.MaterialRepository(databasePath);
  try {
    const generation = await repository.initializeCatalogStats();
    assert.ok(generation, "Final image requires a verified catalog generation");
    assert.equal(generation.datasetDigest, frozenDigest);
    assert.equal(generation.policyDigest, policy.digest);
    assert.equal(generation.formatVersion, FORMAT_VERSION);
    assert.equal(await digestFile(databasePath), frozenDigest, "Final verification changed DB bytes");
    console.log(JSON.stringify({ status: "runtime-artifact-verified", ...generation }));
  } finally { repository.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
JS_VERIFY

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
