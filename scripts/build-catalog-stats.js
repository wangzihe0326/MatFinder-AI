const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { loadCanonicalPolicy } = require("../catalog-policy");
const { FORMAT_VERSION, MAX_ARTIFACT_BYTES, artifactPath, assertNoSideFiles, assertSealed, fileState,
  digestFile, policyDigest, loadArtifact } = require("../catalog-stats-artifact");

async function buildCatalogStats(databasePath) {
  const policyBinding = loadCanonicalPolicy();
  const { MaterialRepository } = policyBinding.repository;
  databasePath = path.resolve(databasePath);
  const before = fileState(databasePath);
  assertNoSideFiles(databasePath); // Refuse a hot journal before opening a recovery-capable writer.
  const databaseFd = fs.openSync(databasePath, "r");
  let guard;
  let guardClosed = false;
  let reserved = false;
  let repository;
  let snapshot = false;
  let temporaryPath;
  let previousPath;
  let published = false;
  const destination = artifactPath(databasePath);
  const assertDatabaseIdentity = () => {
    const stat = fs.fstatSync(databaseFd, { bigint: true });
    const descriptorState = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    if (descriptorState !== before || fileState(databasePath) !== before)
      throw new Error("Finalization database identity changed");
    assertNoSideFiles(databasePath);
  };
  const finalDigest = () => {
    assertDatabaseIdentity();
    const hash = crypto.createHash("sha256");
    const bytes = Buffer.alloc(64 * 1024);
    let position = 0;
    for (;;) {
      const length = fs.readSync(databaseFd, bytes, 0, bytes.length, position);
      if (!length) break;
      hash.update(bytes.subarray(0, length));
      position += length;
    }
    assertDatabaseIdentity();
    return hash.digest("hex");
  };
  try {
    assertDatabaseIdentity();
    guard = new DatabaseSync(databasePath); // Reservation only; no DDL/DML or PRAGMA writes.
    assertSealed(databasePath, guard);
    guard.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    reserved = true;
    assertSealed(databasePath, guard);
    assertDatabaseIdentity();
    const policy = await policyDigest();
    if (policy !== policyBinding.digest) throw new Error("Executed policy differs from source");
    assertDatabaseIdentity();
    repository = new MaterialRepository(databasePath);
    repository.checkSchema();
    repository.database.exec("BEGIN");
    snapshot = true;
    assertDatabaseIdentity();
    const { aggregates, publicMaterialTotal } = repository.buildCanonicalCatalogAggregates();
    const datasetDigest = await digestFile(databasePath);
    if (await policyDigest() !== policy)
      throw new Error("Finalization inputs changed");
    assertDatabaseIdentity();
    assertSealed(databasePath, guard);
    const artifact = { formatVersion: FORMAT_VERSION, datasetDigest, policyDigest: policy,
      aggregates, publicMaterialTotal, computedAt: new Date().toISOString() };
    const contents = JSON.stringify(artifact) + "\n";
    if (Buffer.byteLength(contents) > MAX_ARTIFACT_BYTES) throw new Error("Artifact exceeds size cap");
    temporaryPath = `${destination}.tmp-${crypto.randomUUID()}`;
    const fd = fs.openSync(temporaryPath, "wx");
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    loadArtifact(temporaryPath);
    repository.database.exec("COMMIT");
    snapshot = false;
    repository.close();
    repository = null;
    // Preserve the previous complete sidecar for explicit post-replace rollback.
    if (fs.existsSync(destination)) {
      previousPath = `${destination}.tmp-${crypto.randomUUID()}.previous`;
      fs.copyFileSync(destination, previousPath, fs.constants.COPYFILE_EXCL);
    }
    const verifyFinalState = () => {
      policyBinding.assertCurrentSources();
      if (!guardClosed) assertSealed(databasePath, guard);
      if (finalDigest() !== datasetDigest) throw new Error("Finalization database digest changed");
    };
    // No await after this point. Rehash actual held-file bytes after all async work.
    verifyFinalState();
    // Same-directory rename: readers see the old complete file or the new complete file.
    fs.renameSync(temporaryPath, destination);
    published = true;
    temporaryPath = null;
    verifyFinalState();
    guard.exec("ROLLBACK");
    reserved = false;
    guard.close();
    guardClosed = true;
    // Also reject a change observed at guard release before reporting success.
    verifyFinalState();
    return artifact;
  } catch (error) {
    if (published) {
      try {
        if (previousPath) {
          fs.renameSync(previousPath, destination);
          previousPath = null;
        } else fs.rmSync(destination, { force: true });
      } catch (restorationError) {
        // Never leave the newly published mismatching artifact available.
        fs.rmSync(destination, { force: true });
        throw new AggregateError([error, restorationError], "Publication failed; sidecar unavailable");
      }
    }
    throw error;
  } finally {
    try {
      if (repository) {
        try { if (snapshot) repository.database.exec("ROLLBACK"); }
        finally { repository.close(); }
      }
    } finally {
      try {
        if (guard && !guardClosed) {
          try { if (reserved) guard.exec("ROLLBACK"); } finally { guard.close(); }
        }
      } finally {
        try {
          if (temporaryPath) fs.rmSync(temporaryPath, { force: true });
          if (previousPath) fs.rmSync(previousPath, { force: true });
        } finally { fs.closeSync(databaseFd); }
      }
    }
  }
}

if (require.main === module) {
  buildCatalogStats(process.argv[2] || path.join(__dirname, "..", "matfinder.db"))
    .then((artifact) => console.log(JSON.stringify({ status: "published", ...artifact })))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { buildCatalogStats };
