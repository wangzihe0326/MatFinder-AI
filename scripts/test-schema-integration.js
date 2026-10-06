const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { bootstrapFixture } = require("./schema-test-fixtures");
const { inspectDatabase } = require("../schema-contract");
const root = path.resolve(__dirname, "..");

if (process.argv.includes("--gate-server")) {
  // Fail immediately if runtime tries to reach an offline subprocess/provider.
  const processes = require("node:child_process");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
    processes[name] = () => { throw new Error("R2-07: runtime attempted a subprocess"); };
  global.fetch = () => { throw new Error("No provider calls in schema integration"); };
  const exists = fs.existsSync;
  fs.existsSync = function (file) {
    if ([".env", ".env.local"].includes(path.basename(String(file)))) return false;
    return exists.apply(this, arguments);
  };
  const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;
  const families = MaterialRepository.prototype.getPolymerFamilyCount;
  MaterialRepository.prototype.getPolymerFamilyCount = function (...args) {
    console.log("R2_BUSINESS_INITIALIZATION");
    return families.apply(this, args);
  };
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    for (const statement of sql.split(";").map(value => value.trim()).filter(Boolean))
      assert.match(statement, /^(PRAGMA (?:busy_timeout|query_only|foreign_keys)\s*=|BEGIN|COMMIT|ROLLBACK)/i,
        "Runtime may not execute schema/data mutation");
    return exec.call(this, sql);
  };
  require("../server");
} else if (["--authority-only", "--authority-source-only", "--authority-bytecode-only"].some(flag => process.argv.includes(flag))) {
  singleAuthority({ sourceOnly: process.argv.includes("--authority-source-only"),
    bytecodeOnly: process.argv.includes("--authority-bytecode-only") });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
function digest(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function change(file, sql) {
  const db = new DatabaseSync(file);
  try { db.exec(sql); } finally { db.close(); }
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function startup(file, expectedCode) {
  const address = await port(), before = digest(file);
  const child = spawn(process.execPath, [__filename, "--gate-server"], {
    cwd: root, windowsHide: true,
    env: { ...process.env, NODE_ENV: "test", PORT: String(address), MATFINDER_DB_PATH: file,
      OPENAI_API_KEY: "", MATFINDER_ADMIN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const ended = new Promise(resolve => child.once("exit", resolve));
  try {
    if (expectedCode) {
      const code = await Promise.race([ended, new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Incompatible server did not exit")), 10000).unref())]);
      assert.equal(code, 1, stderr);
      assert.ok(stderr.includes(expectedCode), stderr);
      assert.ok(!stdout.includes("R2_BUSINESS_INITIALIZATION"), stdout);
      assert.ok(!stdout.includes("after_http_listen"), stdout);
    } else {
      const until = Date.now() + 15000;
      while (!stdout.includes("after_http_listen")) {
        if (child.exitCode !== null || Date.now() > until) throw new Error(stderr || stdout || "Startup timeout");
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.ok(stdout.includes("R2_BUSINESS_INITIALIZATION"));
      for (const [endpoint, status] of [["live", 200], ["health", 200], ["ready", 503]]) {
        const response = await fetch("http://127.0.0.1:" + address + "/api/" + endpoint);
        assert.equal(response.status, status);
        if (endpoint === "ready") assert.match(await response.text(), /no_verified_public_grades/);
      }
    }
  } finally {
    if (child.exitCode === null) child.kill();
    await ended;
    assert.equal(digest(file), before, "R2-06/08: runtime changed database bytes");
    for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(fs.existsSync(file + suffix), false);
  }
}
function singleAuthority({ sourceOnly = false, bytecodeOnly = false } = {}) {
  const guard = require("./schema-authority-guard");
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "schema-authority-policy.json"), "utf8"));
  const result = guard.audit(root);
  assert.equal(policy.owners.filter(o => o.classification === "canonical")
    .every(o => o.file === "scripts/migrate.py"), true);
  assert.ok(policy.owners.some(o => o.owner === "bootstrap_action" && o.classification === "canonical"));
  assert.ok(policy.owners.some(o => o.file === "scripts/real_material_importer.py" && o.classification === "business-DML"));
  assert.deepEqual(policy.owners.filter(o => o.classification === "maintenance")
    .map(o => o.file + ":" + o.owner), ["scripts/optimize-database-indexes.py:main"]);
  // Preserve the separate existing bootstrap/fixture assertions.
  assert.ok(fs.readFileSync(path.join(root, "scripts/write-materials-sqlite.py"), "utf8")
    .includes("bootstrap_database(db_path, contract)"));
  for (const file of ["test-material-query.js", "test-readiness.js",
    "test-recommendation-recall.js", "test-catalog-stats-artifact.js"])
    assert.doesNotMatch(fs.readFileSync(path.join(root, "scripts", file), "utf8"),
      /destination\.exec\((?:row|definition)\.sql\)/, "Fixture cloned schema as authority");
  console.log("Single-authority existing/canonical/business-DML/optimizer: PASS " + JSON.stringify(result));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-p2-authority-"));
  assert.ok(!path.relative(root, directory).split(path.sep).every(part => part !== ".."), "OS Temp required");
  const checked = [];
  function fixture(name) {
    const copy = path.join(directory, name);
    for (const file of [...policy.productionFiles, guard.READER]) {
      const target = path.join(copy, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
    }
    return copy;
  }
  const trackedPaths = spawnSync("git", ["-c", "safe.directory=" + root.replaceAll("\\", "/"),
    "ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(trackedPaths.status, 0, trackedPaths.stderr);
  const tracked = trackedPaths.stdout.split("\0").filter(Boolean);
  const audit = copy => guard.audit(copy, { trackedPaths: tracked });
  function write(copy, file, text) {
    const target = path.join(copy, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  function reject(name, modify, expected) {
    const copy = fixture(name);
    modify(copy);
    assert.throws(() => audit(copy), expected, name + " bypass passed");
    checked.push(name);
    console.log("Authority adversarial " + name + ": REJECT");
  }
  function rejectSourceCase(name, file, source, owner, api, proveTable = null) {
    const copy = fixture(name);
    write(copy, file, source);
    const inventory = guard.inventorySources(copy, policy.excluded);
    assert.ok(inventory.files.includes(file), "Source case missing from inventory: " + file);
    const discovered = inventory.groups.find(group => group.file === file && group.owner === owner);
    assert.ok(discovered, "SQL execution owner not reached: " + file);
    assert.ok(discovered.sites.some(site => site.api === api), "SQL sink not reached: " + file);
    assert.ok(!policy.owners.some(group => group.file === file && group.owner === owner),
      "Extension classification must not authorize a new path");
    assert.throws(() => audit(copy),
      { message: "Unclassified SQL execution owner: " + file + ":" + owner });
    if (proveTable) {
      // Only this explicitly authored Temp fixture is executed for DDL proof.
      // The authority guard itself does not execute repository modules.
      const known = { exports: null };
      require("node:vm").runInNewContext(source, { module: known });
      const db = new DatabaseSync(path.join(directory, name + "-proof.db"));
      try {
        known.exports(db);
        assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(proveTable));
      } finally { db.close(); }
    }
    checked.push(name);
    console.log("Authority source case " + file + ": inventory/owner/sink reached, REJECT");
  }

  try {
    const copy = fixture("approved-copy");
    assert.deepEqual(audit(copy), result);
    if (!bytecodeOnly) {
    // Exercise the frozen boundSources check on a real production-source copy,
    // not just a helper string. Only checkout EOL representation may vary.
    const sourceFile = "data/materials.js";
    const sourceLF = fs.readFileSync(path.join(root, sourceFile), "utf8").replace(/\r\n?/g, "\n");
    assert.ok(sourceLF.includes("\n"), "EOL proof requires a multiline bound source");
    const expectedDigest = policy.boundSources[sourceFile];
    const eolCopy = fixture("canonical-source-eol");
    const rawDigests = new Set();
    for (const [name, eol] of [["LF", "\n"], ["CRLF", "\r\n"], ["lone CR", "\r"]]) {
      const bytes = Buffer.from(sourceLF.replace(/\n/g, eol), "utf8");
      rawDigests.add(createHash("sha256").update(bytes).digest("hex"));
      assert.equal(guard.canonicalSourceDigest(bytes), expectedDigest, name + " canonical identity");
      write(eolCopy, sourceFile, bytes);
      assert.deepEqual(audit(eolCopy), result, name + " bound source must pass the actual guard");
    }
    assert.equal(rawDigests.size, 3, "EOL fixtures must have different raw bytes");
    assert.throws(() => guard.canonicalSourceDigest(Buffer.from([0xc3, 0x28])),
      "Invalid UTF-8 must not be silently replaced");
    assert.notEqual(guard.canonicalSourceDigest(Buffer.from("\ufeff" + sourceLF, "utf8")), expectedDigest,
      "BOM content is not an EOL representation change");
    console.log("Canonical bound source LF/CRLF/lone CR: 3/3 actual authority audits PASS");
    reject("canonical-source-content-mutation", c => {
      const mutated = sourceLF + "\nmodule.exports.__authorityPortabilityMutation = true;\n";
      new (require("node:vm").Script)(mutated, { filename: sourceFile });
      assert.notEqual(guard.canonicalSourceDigest(Buffer.from(mutated, "utf8")), expectedDigest,
        "Actual exported content mutation must change canonical identity");
      write(c, sourceFile, mutated);
    }, { message: "Frozen authority/maintenance source changed: " + sourceFile });
    const dynamicJavaScript = 'module.exports = db => db.exec(["CREATE", " TABLE rogue(id INTEGER)"].join(""));';
    for (const [index, extension] of [".js", ".JS", ".Js", ".jS"].entries())
      rejectSourceCase("JS-case-" + index, "scripts/rogue" + extension,
        dynamicJavaScript, "exports", "exec");
    const dynamicPython = 'def rogue(conn):\n sql = "".join(["CREATE", " TABLE rogue(id INTEGER)"])\n conn.execute(sql)\n';
    for (const [index, extension] of [".py", ".PY", ".Py", ".pY"].entries())
      rejectSourceCase("Python-case-" + index, "scripts/rogue" + extension,
        dynamicPython, "rogue", "execute");
    rejectSourceCase("exact-uppercase-bypass", "scripts/uppercase-rogue.JS",
      'module.exports = db => db.exec(["CREATE", " TABLE scope_rogue(id INTEGER)"].join(""));',
      "exports", "exec", "scope_rogue");
    rejectSourceCase("nested-uppercase-owner", "scripts/subdir/rogue.JS",
      dynamicJavaScript, "exports", "exec");

    reject("literal-JS", c => write(c, "scripts/rogue.js",
      'module.exports = db => db.exec("CREATE TABLE rogue(id INTEGER)");'), /Unclassified SQL execution owner/);
    reject("dynamic-JS-exact-review", c => write(c, "scripts/rogue.js",
      'module.exports = db => db.exec(["CREATE", " TABLE rogue(id INTEGER)"].join(""));'), /Unclassified SQL execution owner/);
    reject("nested-directory-JS", c => write(c, "runtime/nested/rogue.js",
      'module.exports = { run(db) { const callback = () => db.exec("CREATE TABLE rogue(id INTEGER)"); callback(); } };'), /Unclassified SQL execution owner/);
    reject("indirect-variable-JS", c => write(c, "scripts/rogue.js",
      'module.exports = db => { const sql = ["CREATE", " TABLE rogue(id INTEGER)"].join(""); db.exec(sql); };'), /Unclassified SQL execution owner/);
    reject("bracket-alias-JS", c => write(c, "scripts/rogue.js",
      'module.exports = db => { const run = db["exec"].bind(db); run(["CREATE", " TABLE rogue(id INTEGER)"].join("")); };'), /Unclassified SQL execution owner/);
    reject("computed-alias-JS", c => write(c, "scripts/rogue.js",
      'module.exports = db => { const method = "ex" + "ec"; db[method]("CREATE TABLE rogue(id INTEGER)"); };'), /Unclassified SQL execution owner/);
    reject("template-interpolation-JS", c => write(c, "scripts/rogue.js",
      'module.exports = db => `${db.exec("CREATE TABLE rogue(id INTEGER)")}`;'), /Unclassified SQL execution owner/);
    reject("dynamic-Python", c => write(c, "scripts/rogue.py",
      'def rogue(conn):\n sql = "".join(["CREATE", " TABLE rogue(id INTEGER)"])\n conn.execute(sql)\n'), /Unclassified SQL execution owner/);
    reject("existing-owner-new-sink", c => {
      const file = "scripts/write-materials-sqlite.py", source = fs.readFileSync(path.join(c, file), "utf8");
      write(c, file, source.replace("def main():", 'def main():\n    connection.execute("CREATE TABLE rogue(id INTEGER)")'));
    }, /Reviewed SQL execution function\/callsite changed/);
    reject("optimizer-new-DDL", c => {
      const file = "scripts/optimize-database-indexes.py", source = fs.readFileSync(path.join(c, file), "utf8");
      write(c, file, source.replace("def main():", 'def main():\n    connection.execute("CREATE INDEX rogue ON materials(material_id)")'));
    }, /Reviewed SQL execution function\/callsite changed/);
    reject("outside-owner-new-producer", c => {
      const file = "scripts/optimize-database-indexes.py", source = fs.readFileSync(path.join(c, file), "utf8");
      write(c, file, source.replace('"idx_property_evidence_context"', '"another_index"'));
    }, /Frozen authority\/maintenance source changed/);
    reject("unknown-source-with-obscured-sink", c => write(c, "scripts/rogue.js",
      'module.exports = (db, name, sql) => Reflect.apply(Reflect.get(db, name), db, [sql]);'), { message: "Unclassified SQL execution owner: scripts/rogue.js:exports" });
    reject("missing-production-source", c => {
      assert.ok(tracked.includes("evidence-validator.js"), "Missing-source fixture must be Git tracked");
      const target = path.join(c, "evidence-validator.js");
      assert.ok(fs.existsSync(target), "Missing-source fixture must exist before removal");
      fs.unlinkSync(target);
      assert.equal(fs.existsSync(target), false);
    }, { message: "Tracked production source missing: evidence-validator.js" });
    reject("optimizer-new-table", c => {
      const file = "scripts/optimize-database-indexes.py", source = fs.readFileSync(path.join(c, file), "utf8");
      write(c, file, source.replace("def main():", 'def main():\n    connection.execute("CREATE TABLE rogue(id INTEGER)")'));
    }, /Reviewed SQL execution function\/callsite changed/);
    }
    if (!sourceOnly) {
    reject("unauthorized-new-pyc", c => fs.copyFileSync(path.join(c, guard.READER),
      path.join(c, "scripts/__pycache__/unknown.pyc")),
      { message: "Unauthorized executable bytecode inventory: scripts/__pycache__/unknown.pyc" });
    reject("arbitrary-cache-pyo", c => {
      const target = path.join(c, "runtime/__pycache__/arbitrary.pyo");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(c, guard.READER), target);
    }, { message: "Unauthorized executable bytecode inventory: runtime/__pycache__/arbitrary.pyo" });
    for (const [index, extension] of [".PYC", ".PyC", ".PYO"].entries()) {
      const file = "scripts/__pycache__/case-rogue" + extension;
      reject("bytecode-case-" + index,
        c => fs.copyFileSync(path.join(c, guard.READER), path.join(c, file)),
        { message: "Unauthorized executable bytecode inventory: " + file });
    }
    reject("reader-missing", c => fs.unlinkSync(path.join(c, guard.READER)), /Approved reader bytecode missing\/changed/);
    reject("reader-changed", c => fs.appendFileSync(path.join(c, guard.READER), "changed"), /Approved reader bytecode missing\/changed/);
    reject("retired-writer-restored", c => {
      const binary = spawnSync("git", ["-c", "safe.directory=" + root.replaceAll("\\", "/"),
        "show", guard.BASE_SHA + ":" + guard.RETIRED], { cwd: root, windowsHide: true });
      assert.equal(binary.status, 0, String(binary.stderr));
      fs.writeFileSync(path.join(c, guard.RETIRED), binary.stdout);
    }, /Retired executable writer bytecode restored/);
    // This is a deliberately authored Temp fixture, never repository code.
    // Compile to opaque bytecode, prove actual DDL capability only on a Temp DB,
    // and obtain its tracked identity from a disposable Temp index (no commit).
    const binaryCopy = fixture("dynamic-binary"), binaryName = "scripts/__pycache__/binary-rogue.pyc";
    const fixtureSource = path.join(directory, "binary-fixture.py");
    fs.writeFileSync(fixtureSource, 'import sqlite3\ndef run(target):\n conn=sqlite3.connect(target)\n try:\n  conn.execute(" ".join(("CREATE", "TABLE", "binary_rogue(id INTEGER)")))\n finally:\n  conn.close()\n');
    const compiled = path.join(binaryCopy, binaryName), database = path.join(directory, "binary-proof.db");
    const compile = spawnSync(guard.python(), ["-B", "-c", "import py_compile,sys;py_compile.compile(sys.argv[1],cfile=sys.argv[2],doraise=True)", fixtureSource, compiled], { encoding: "utf8", windowsHide: true });
    assert.equal(compile.status, 0, compile.stderr);
    assert.ok(!fs.readFileSync(compiled).includes(Buffer.from("CREATE TABLE")));
    for (const args of [["init", "--quiet"], ["add", "--", guard.READER, binaryName]]) {
      const git = spawnSync("git", ["-c", "safe.directory=" + binaryCopy.replaceAll("\\", "/"), ...args], { cwd: binaryCopy, encoding: "utf8", windowsHide: true });
      assert.equal(git.status, 0, git.stderr);
    }
    const index = spawnSync("git", ["-c", "safe.directory=" + binaryCopy.replaceAll("\\", "/"), "ls-files", "-z"], { cwd: binaryCopy, encoding: "utf8", windowsHide: true });
    assert.equal(index.status, 0, index.stderr);
    assert.ok(index.stdout.split("\0").includes(binaryName));
    assert.throws(() => guard.audit(binaryCopy, { trackedPaths: index.stdout.split("\0").filter(Boolean) }), /Unauthorized executable bytecode inventory/);
    checked.push("tracked-dynamic-binary");
    const proof = spawnSync(guard.python(), ["-B", "-c",
      'import importlib.machinery,sqlite3,sys; m=importlib.machinery.SourcelessFileLoader("known_temp_fixture",sys.argv[1]).load_module();m.run(sys.argv[2]);c=sqlite3.connect(sys.argv[2]);assert c.execute("SELECT name FROM sqlite_schema WHERE name=?",("binary_rogue",)).fetchone();c.close()',
      compiled, database], { encoding: "utf8", windowsHide: true });
    assert.equal(proof.status, 0, proof.stderr);
    console.log("Authority tracked dynamic bytecode: REJECT; independent Temp DDL capability: PROVEN");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log((sourceOnly ? "Source" : bytecodeOnly ? "Bytecode" : "Authority") + " adversarial regressions: " + checked.length + "/" + checked.length + " PASS");
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-p2-runtime-"));
  try {
    const formal = path.join(directory, "formal.db");
    bootstrapFixture(formal);
    await require("./build-catalog-stats").buildCatalogStats(formal);
    const { MaterialRepository } = require("../material-repository");
    const repo = new MaterialRepository(formal);
    try {
      assert.equal(repo.checkSchema().compatible, true);
      assert.equal(repo.checkSchema().classification, "current");
      assert.equal(repo.database.prepare("PRAGMA query_only").get().query_only, 1);
      assert.throws(() => repo.database.exec("PRAGMA user_version=99"), /readonly|read.only/i);
    } finally { repo.close(); }
    await startup(formal);
    console.log("R2-01, R2-06, R2-07, R2-08: PASS (real server, RO gate, unchanged bytes)");

    const cases = [
      ["R2-02", "PRAGMA user_version=0", "SCHEMA_OFFLINE_PREPARATION", "legacy_current"],
      ["R2-03", "PRAGMA user_version=999", "SCHEMA_UNSUPPORTED_VERSION", "future_version"],
      ["R2-04", "ALTER TABLE materials DROP COLUMN name_zh", "SCHEMA_STRUCTURAL_DRIFT"],
      ["R2-05", "DROP INDEX idx_materials_catalog_layer; CREATE INDEX idx_materials_catalog_layer ON materials(record_origin)", "SCHEMA_STRUCTURAL_DRIFT"]
    ];
    for (const [id, sql, error, classification] of cases) {
      const file = path.join(directory, id + ".db");
      fs.copyFileSync(formal, file);
      change(file, sql);
      if (classification) assert.equal(inspectDatabase(file).classification, classification);
      await startup(file, error);
      console.log(id + ": PASS (reject before business initialization)");
    }
    const blank = path.join(directory, "blank.db"); fs.writeFileSync(blank, "");
    await startup(blank, "SCHEMA_OFFLINE_PREPARATION");
    const corrupt = path.join(directory, "corrupt.db"); fs.writeFileSync(corrupt, "not SQLite");
    await startup(corrupt, "SCHEMA_UNREADABLE");
    const wal = path.join(directory, "wal.db"); fs.copyFileSync(formal, wal);
    change(wal, "PRAGMA journal_mode=WAL");
    await startup(wal, "SCHEMA_UNREADABLE");
    console.log("Blank/corrupt/unsealed startup errors: PASS");
    singleAuthority();
    console.log("Runtime compatibility regressions: 8/8 PASS; additional 4 guards PASS");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
