const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { loadCanonicalPolicy } = require("../catalog-policy");
const { FORMAT_VERSION, MAX_ARTIFACT_BYTES, artifactPath, assertNoSideFiles, assertSealed, fileState,
  policyDigest, loadArtifact } = require("../catalog-stats-artifact");

async function buildCatalogStats(databasePath) {
  const policyBinding = loadCanonicalPolicy();
  const { MaterialRepository } = policyBinding.repository;
  databasePath = path.resolve(databasePath);
  fileState(databasePath); // Require an existing regular file before writable initialization.
  let before;
  assertNoSideFiles(databasePath); // Refuse a hot journal before opening a recovery-capable writer.
  let databaseFd;
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
  const descriptorDigest = (descriptor) => {
    const hash = crypto.createHash("sha256");
    const bytes = Buffer.alloc(64 * 1024);
    let position = 0;
    for (;;) {
      const length = fs.readSync(descriptor, bytes, 0, bytes.length, position);
      if (!length) break;
      hash.update(bytes.subarray(0, length));
      position += length;
    }
    return hash.digest("hex");
  };
  const finalDigest = () => {
    assertDatabaseIdentity();
    const digest = descriptorDigest(databaseFd);
    assertDatabaseIdentity();
    return digest;
  };
  try {
    // Complete writable-filesystem initialization before anchoring the SQLite open.
    // No bytes are written; close this descriptor before SQLite acquires POSIX locks.
    const initializationFd = fs.openSync(databasePath, "r+");
    let initializedIdentity;
    let initializedDigest;
    try {
      const state = fileState(databasePath);
      const stat = fs.fstatSync(initializationFd, { bigint: true });
      if ([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":") !== state)
        throw new Error("Finalization database identity changed during initialization");
      initializedIdentity = [stat.dev, stat.ino].join(":");
      initializedDigest = descriptorDigest(initializationFd);
      const after = fs.fstatSync(initializationFd, { bigint: true });
      if ([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":") !== state ||
          fileState(databasePath) !== state)
        throw new Error("Finalization database identity changed during initialization");
    } finally { fs.closeSync(initializationFd); }
    assertNoSideFiles(databasePath);
    guard = new DatabaseSync(databasePath); // Reservation only; no DDL/DML or PRAGMA writes.
    assertSealed(databasePath, guard);
    guard.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    reserved = true;
    assertSealed(databasePath, guard);
    // No await across initialization/open/reservation/binding. Freeze full metadata now.
    before = fileState(databasePath);
    databaseFd = fs.openSync(databasePath, "r");
    assertDatabaseIdentity();
    const bound = fs.fstatSync(databaseFd, { bigint: true });
    if ([bound.dev, bound.ino].join(":") !== initializedIdentity ||
        finalDigest() !== initializedDigest)
      throw new Error("Finalization database identity changed before binding");
    const policy = await policyDigest();
    if (policy !== policyBinding.digest) throw new Error("Executed policy differs from source");
    assertDatabaseIdentity();
    repository = new MaterialRepository(databasePath);
    repository.checkSchema();
    repository.database.exec("BEGIN");
    snapshot = true;
    assertDatabaseIdentity();
    const { aggregates, publicMaterialTotal } = repository.buildCanonicalCatalogAggregates();
    // Hash the same bound descriptor used by every final synchronous verification.
    assertDatabaseIdentity();
    const datasetHash = crypto.createHash("sha256");
    for await (const bytes of fs.createReadStream(databasePath, {
      fd: databaseFd, autoClose: false, start: 0, highWaterMark: 64 * 1024
    })) datasetHash.update(bytes);
    const datasetDigest = datasetHash.digest("hex");
    assertDatabaseIdentity();
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
        } finally { if (databaseFd !== undefined) fs.closeSync(databaseFd); }
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
