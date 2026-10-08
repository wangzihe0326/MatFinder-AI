const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Semantic inputs only. Artifact/bootstrap mechanics are governed by the format.
const POLICY_MANIFEST = Object.freeze([
  "material-quality.js", "evidence-model.js", "material-repository.js", "property-projection-policy.js"
]);
const MAX_POLICY_FILE_BYTES = 256 * 1024;
let loadedPolicy;

function policySnapshot(root = __dirname) {
  const hash = crypto.createHash("sha256");
  for (const relative of POLICY_MANIFEST) {
    const fd = fs.openSync(path.join(root, relative), "r");
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_POLICY_FILE_BYTES))
        throw new Error("Policy source exceeds bounded file limit");
      const bytes = Buffer.alloc(MAX_POLICY_FILE_BYTES + 1);
      let size = 0;
      for (;;) {
        const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
        size += count;
        if (size > MAX_POLICY_FILE_BYTES) throw new Error("Policy source exceeds bounded file limit");
        if (!count) break;
      }
      const after = fs.fstatSync(fd, { bigint: true });
      const current = fs.statSync(path.join(root, relative), { bigint: true });
      const identity = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
      if (identity(before) !== identity(after) || identity(after) !== identity(current))
        throw new Error("Policy source changed during capture");
      hash.update(`${relative}\0${size}\0`);
      hash.update(bytes.subarray(0, size));
      hash.update("\0");
    } finally { fs.closeSync(fd); }
  }
  return hash.digest("hex");
}

function loadCanonicalPolicy() {
  if (loadedPolicy) {
    loadedPolicy.assertCurrentSources();
    return loadedPolicy;
  }
  const filenames = POLICY_MANIFEST.map((file) => path.join(__dirname, file));
  if (filenames.some((file) => require.cache[file]))
    throw new Error("Canonical policy was preloaded without an execution binding");
  const digest = policySnapshot();
  // Synchronous capture/load/verify: persistent changes cannot label cached P1 as P2.
  // Supported publication uses stable source files, not hostile mutate-and-restore races.
  const repository = require("./material-repository");
  const modules = filenames.map((file) => require.cache[file]);
  if (modules.some((entry) => !entry?.loaded) || policySnapshot() !== digest)
    throw new Error("Canonical policy changed while loading");
  loadedPolicy = Object.freeze({ digest, repository, assertCurrentSources() {
    if (filenames.some((file, index) => require.cache[file] !== modules[index]) ||
        policySnapshot() !== digest)
      throw new Error("Loaded canonical policy no longer matches published source");
  } });
  return loadedPolicy;
}

function loadedPolicyDigest(repositoryModule) {
  if (!loadedPolicy || require.cache[path.join(__dirname, "material-repository.js")] !== repositoryModule)
    throw new Error("Canonical policy has no execution binding");
  return loadedPolicy.digest;
}

module.exports = { POLICY_MANIFEST, MAX_POLICY_FILE_BYTES, policySnapshot,
  loadCanonicalPolicy, loadedPolicyDigest };
