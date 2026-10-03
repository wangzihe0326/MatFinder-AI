// Test setup glue only. All schema creation/adoption is delegated to P1 Python.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function tempTarget(file) {
  const absolute = path.resolve(file);
  const relative = path.relative(os.tmpdir(), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Schema test fixtures must be under OS Temp");
  return absolute;
}
function lifecycle(command, file) {
  const result = spawnSync(findPython(), ["-B", path.join(__dirname, "migrate.py"), command,
    "--database", tempTarget(file)], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return JSON.parse(result.stdout);
}
function findPython() {
  const candidates = [process.env.PYTHON,
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime",
      "dependencies", "python", "python.exe"), "python", "py"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("Python with sqlite3 is required for canonical fixture preparation");
}
function bootstrapFixture(file) { return lifecycle("bootstrap", file); }
function copyPreparedFixture(file, source = path.join(root, "matfinder.db")) {
  const target = tempTarget(file);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return lifecycle("prepare", target);
}
module.exports = { bootstrapFixture, copyPreparedFixture };
