const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.join(__dirname, "..");
const databasePath = path.join(rootDir, "matfinder.db");
const sourcePath = path.join(rootDir, "data", "materials.js");
const writerPath = path.join(__dirname, "write-materials-sqlite.py");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });

const additionalMaterials = require("./additional-materials");
const materials = [...sandbox.window.MatFinderData.materials, ...additionalMaterials];
const result = spawnSync(findPython(), [writerPath, databasePath], {
  cwd: rootDir,
  input: JSON.stringify(materials),
  encoding: "utf8"
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

process.stdout.write(result.stdout);

function findPython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
    "python",
    "py"
  ].filter(Boolean);

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status === 0) return candidate;
  }

  throw new Error("Python runtime with sqlite3 is required to create matfinder.db.");
}
