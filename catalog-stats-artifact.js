const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { POLICY_MANIFEST } = require("./catalog-policy");

const MAX_ARTIFACT_BYTES = 8192;
const HASH_BUFFER_BYTES = 64 * 1024;
const FORMAT_VERSION = 1;
const AGGREGATE_KEYS = Object.freeze([
  "polymerFamilies", "verifiedCommercialGrades", "verifiedPropertyDataPoints",
  "materialsAwaitingVerification"
]);

function artifactPath(databasePath) { return `${databasePath}.catalog-stats.json`; }
function fileState(databasePath) {
  const stat = fs.statSync(databasePath, { bigint: true });
  if (!stat.isFile()) throw new Error("Database must be a regular file");
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}
function assertNoSideFiles(databasePath) {
  if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(databasePath + suffix)))
    throw new Error("Catalog stats require a sealed DELETE-journal database");
}
function assertSealed(databasePath, database) {
  assertNoSideFiles(databasePath);
  if (database.prepare("PRAGMA journal_mode").get().journal_mode !== "delete")
    throw new Error("Catalog stats require a sealed DELETE-journal database");
}
async function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath, { highWaterMark: HASH_BUFFER_BYTES });
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest("hex");
}
async function policyDigest(root = __dirname) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of POLICY_MANIFEST) {
    const fullPath = path.join(root, relativePath);
    const before = fileState(fullPath);
    const size = fs.statSync(fullPath).size;
    hash.update(`${relativePath}\0${size}\0`);
    for await (const bytes of fs.createReadStream(fullPath, { highWaterMark: HASH_BUFFER_BYTES }))
      hash.update(bytes);
    if (fileState(fullPath) !== before) throw new Error("Policy changed while hashing");
    hash.update("\0");
  }
  return hash.digest("hex");
}
function exactKeys(object, keys) {
  return object && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).sort().join("|") === [...keys].sort().join("|");
}
function validateArtifact(artifact) {
  if (!exactKeys(artifact, ["formatVersion", "datasetDigest", "policyDigest", "aggregates",
    "publicMaterialTotal", "computedAt"]) || artifact.formatVersion !== FORMAT_VERSION ||
    typeof artifact.datasetDigest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.datasetDigest) ||
    typeof artifact.policyDigest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.policyDigest) ||
    !exactKeys(artifact.aggregates, AGGREGATE_KEYS) ||
    !AGGREGATE_KEYS.every((key) => Number.isSafeInteger(artifact.aggregates[key]) && artifact.aggregates[key] >= 0) ||
    !Number.isSafeInteger(artifact.publicMaterialTotal) || artifact.publicMaterialTotal < 0 ||
    artifact.aggregates.verifiedCommercialGrades + artifact.aggregates.materialsAwaitingVerification !== artifact.publicMaterialTotal ||
    typeof artifact.computedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(artifact.computedAt) ||
    !Number.isFinite(Date.parse(artifact.computedAt)) ||
    new Date(artifact.computedAt).toISOString() !== artifact.computedAt)
    throw new Error("Invalid catalog stats artifact");
  return artifact;
}
function loadArtifact(filePath) {
  // Read at most cap + 1 even if the file grows after stat.
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error("Catalog stats artifact exceeds size cap or is not a file");
    const bytes = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let length = 0;
    for (;;) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      length += count;
      if (length > MAX_ARTIFACT_BYTES) throw new Error("Catalog stats artifact exceeds size cap");
      if (!count) break;
    }
    return validateArtifact(JSON.parse(bytes.subarray(0, length).toString("utf8")));
  } finally { fs.closeSync(fd); }
}
function generationOf(artifact) {
  return Object.freeze({ formatVersion: artifact.formatVersion,
    datasetDigest: artifact.datasetDigest, policyDigest: artifact.policyDigest });
}
function dataVersion(database) { return database.prepare("PRAGMA data_version").get().data_version; }

async function verifyRuntimeArtifact(databasePath, database, connectionFileState, executedPolicy) {
  let inTransaction = false;
  try {
    const artifact = loadArtifact(artifactPath(databasePath));
    const beforeState = fileState(databasePath);
    if (connectionFileState && beforeState !== connectionFileState)
      throw new Error("Database file changed after opening the runtime connection");
    const beforeVersion = dataVersion(database);
    assertSealed(databasePath, database);
    database.exec("BEGIN");
    inTransaction = true;
    // Pin the SQLite snapshot/SHARED lock, without hydrating material/evidence rows.
    database.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
    const digest = await digestFile(databasePath);
    const policy = await policyDigest();
    database.exec("COMMIT");
    inTransaction = false;
    assertSealed(databasePath, database);
    if (!executedPolicy || policy !== executedPolicy ||
        digest !== artifact.datasetDigest || executedPolicy !== artifact.policyDigest ||
        fileState(databasePath) !== beforeState || dataVersion(database) !== beforeVersion)
      throw new Error("Catalog stats generation mismatch");
    Object.freeze(artifact.aggregates);
    Object.freeze(artifact);
    const generation = generationOf(artifact);
    let invalid = false;
    return { artifact, current() {
      if (invalid) return null;
      try {
        const version = dataVersion(database);
        assertSealed(databasePath, database);
        if (version !== beforeVersion || fileState(databasePath) !== beforeState ||
            dataVersion(database) !== beforeVersion) invalid = true;
      } catch { invalid = true; }
      return invalid ? null : generation;
    } };
  } catch {
    if (inTransaction) database.exec("ROLLBACK");
    return null;
  }
}

module.exports = { MAX_ARTIFACT_BYTES, HASH_BUFFER_BYTES, FORMAT_VERSION, POLICY_MANIFEST,
  artifactPath, fileState, assertNoSideFiles, assertSealed, digestFile, policyDigest, validateArtifact,
  loadArtifact, generationOf, verifyRuntimeArtifact };
