const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
let evaluatorCalls = 0;
let fileHashReads = 0;
const Module = require("node:module");
const originalLoad = Module._load;
if (process.argv.includes("--probe-server")) {
  // Instrument during bootstrap, before repository destructures the REAL evaluator.
  let instrumented = false;
  Module._load = function (request, ...args) {
    const exports = originalLoad.call(this, request, ...args);
    if (request === "./material-quality" && !instrumented) {
      const annotate = exports.annotateMaterialQuality;
      exports.annotateMaterialQuality = (...values) => { evaluatorCalls++; return annotate(...values); };
      instrumented = true;
    }
    return exports;
  };
  const stream = fs.createReadStream;
  fs.createReadStream = (...args) => { fileHashReads++; return stream(...args); };
}
let MaterialRepository;
try { ({ MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository); }
finally { Module._load = originalLoad; }
const { buildCatalogStats } = require("./build-catalog-stats");
const { artifactPath, loadArtifact, digestFile, policyDigest, POLICY_MANIFEST,
  MAX_ARTIFACT_BYTES, HASH_BUFFER_BYTES } = require("../catalog-stats-artifact");
const root = path.resolve(__dirname, "..");
const EXPECTED = Object.freeze({ H: "high", M: "medium", L: "low", Q: "quarantined",
  T: "quarantined", C: "quarantined", V: "low", N: "high" });

if (process.argv.includes("--probe-server")) {
  const exists = fs.existsSync;
  fs.existsSync = function (file) {
    if ([".env", ".env.local"].includes(path.basename(String(file)))) return false;
    return exists.apply(this, arguments);
  };
  // Neither startup nor the stats request may classify or hydrate any material.
  const hydrate = MaterialRepository.prototype._hydrateDetailedRows;
  let hydratedCalls = 0;
  MaterialRepository.prototype._hydrateDetailedRows = function (...args) {
    hydratedCalls++;
    return hydrate.apply(this, args);
  };
  const metrics = MaterialRepository.prototype.getMetrics;
  MaterialRepository.prototype.getMetrics = function () {
    return { ...metrics.call(this), hydratedCalls, evaluatorCalls, fileHashReads };
  };
  MaterialRepository.prototype.buildCanonicalCatalogAggregates = () => {
    throw new Error("HTTP process must never build catalog stats");
  };
  const protection = require("../api-protection");
  const createProtection = protection.createApiProtection;
  protection.createApiProtection = (...args) => {
    const instance = createProtection(...args);
    instance.publicGet = () => 0; // Bulk parity requests; rate limits have their own permanent suite.
    return instance;
  };
  require("../server");
} else main().catch((error) => { console.error(error); process.exitCode = 1; });

function createSchema(file) {
  const source = new DatabaseSync(path.join(root, "matfinder.db"), { readOnly: true });
  const destination = new DatabaseSync(file);
  try {
    for (const row of source.prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY CASE WHEN type='table' THEN 0 ELSE 1 END, name").all())
      destination.exec(row.sql);
    destination.exec("PRAGMA user_version = " + source.prepare("PRAGMA user_version").get().user_version);
  } finally { destination.close(); source.close(); }
}
function insert(database, table, row) {
  const keys = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}
function addProperty(database, id, key, value, extra = {}) {
  insert(database, "material_property_evidence", {
    material_id: id, property_key: key, position: 0,
    value_numeric: value, unit: key === "density" ? "g/cm3" : key === "tensile_strength" ? "MPa" : "degC",
    test_standard: "ASTM fixture", test_condition: "23 C", value_type: "typical",
    manufacturer: "AD08 Fixture", commercial_grade: id, material_family: "PC",
    source_type: "manufacturer", source_title: "AD08 property fixture",
    source_url: "https://example.invalid/ad08/property", verification_status: "verified",
    confidence_level: "high", conflict_status: "none", ...extra
  });
}
function addMaterial(database, id, level = "high") {
  insert(database, "materials", {
    material_id: id, name: id, name_en: id, name_zh: id, abbreviation: "PC",
    category: "Plastics", category_en: "Plastics", category_zh: "Plastics",
    record_type: "commercial_grade", record_origin: "imported", scope_status: "in_scope",
    catalog_visibility: "public", applications: "[]", applications_en: "[]", applications_zh: "[]",
    limitations: "[]", alternatives: "[]", typical_applications: "[]", advantages: "[]",
    disadvantages: "[]", tags_en: "[]", tags_zh: "[]", translation_quality: "partial",
    translation_status: "partial", processing_methods: "[]", continuous_use_temperature: 110,
    source_note: "AD08 fixture", summary: "Fixture", description_en: "", description_zh: "", notes: ""
  });
  insert(database, "real_material_identities", {
    material_id: id, manufacturer: "AD08 Fixture", commercial_grade: id, material_family: "PC",
    manufacturer_key: "ad08-fixture", commercial_grade_key: id.toLowerCase(), material_family_key: "pc",
    created_at: "2026-01-01", active: 1
  });
  insert(database, "material_evidence", {
    material_id: id, manufacturer: "AD08 Fixture", commercial_grade: id, material_family: "PC",
    source_type: "manufacturer", source_title: "AD08 identity fixture",
    source_url: "https://example.invalid/ad08/identity", verification_status: "verified", confidence_level: "high"
  });
  if (level === "low") return;
  const extra = level === "medium" ? { source_type: "distributor", verification_status: "partially_verified", confidence_level: "medium" } : {};
  addProperty(database, id, "density", 1.2, extra);
  addProperty(database, id, "tensile_strength", 40, extra);
  if (level !== "medium") {
    addProperty(database, id, "hdt", 125);
    addProperty(database, id, "continuous_use_temperature", 110);
  }
}
function eightFixtures(file) {
  createSchema(file);
  const database = new DatabaseSync(file);
  try {
    database.exec("BEGIN");
    for (const [id, level] of Object.entries(EXPECTED)) addMaterial(database, id, ["M", "L"].includes(id) ? level : "high");
    database.prepare("UPDATE material_property_evidence SET conflict_status='conflicting' WHERE material_id='Q' AND property_key='tensile_strength'").run();
    addProperty(database, "T", "tensile_strength", 80, { position: 1 });
    addProperty(database, "C", "melting_temperature", 10);
    database.prepare("UPDATE material_property_evidence SET value_numeric=NULL,value_text=NULL WHERE material_id='V'").run();
    insert(database, "evidence_sources", { source_id: 9001, source_fingerprint: "normalized-ad08", created_at: "2026-01-01", source_type: "manufacturer",
      source_title: "Normalized only", source_url: "https://example.invalid/normalized",
      manufacturer: "AD08 Fixture", commercial_grade: "N", material_family: "PC" });
    for (const table of ["material_evidence", "material_property_evidence"])
      database.prepare(`UPDATE ${table} SET source_id=9001,source_type='unknown',source_title=NULL,source_url=NULL WHERE material_id='N'`).run();
    database.exec("COMMIT");
  } finally { database.close(); }
}
async function runtime(file) {
  const repository = new MaterialRepository(file);
  await repository.initializeCatalogStats();
  return repository;
}
function qualityParity(actual, expected) {
  for (const key of ["level", "confidence_level", "verification_status", "recommendation_eligible", "reference_only"])
    assert.equal(actual[key], expected[key], key);
  if ("factory_ready" in actual) assert.equal(actual.factory_ready, expected.factory_ready);
}
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad08-"));
  try {
    const file = path.join(directory, "eight.db");
    eightFixtures(file);
    const originalDigest = await digestFile(file);
    const artifact = await buildCatalogStats(file);
    assert.equal(await digestFile(file), originalDigest, "Builder must not write the database");
    assert.equal(artifact.publicMaterialTotal, 8);
    assert.deepEqual(artifact.aggregates, { polymerFamilies: 7, verifiedCommercialGrades: 3,
      verifiedPropertyDataPoints: 6, materialsAwaitingVerification: 5 });
    assert.equal(artifact.policyDigest, await policyDigest());
    assert.equal(HASH_BUFFER_BYTES, 65536);
    assert.deepEqual(POLICY_MANIFEST, ["material-quality.js", "evidence-model.js", "material-repository.js"]);
    const repository = await runtime(file);
    try {
      const page = repository.listMaterials({ limit: 30 });
      assert.equal(page.total, 8);
      const candidates = repository.getRecommendationCandidates();
      assert.equal(candidates.length, 8);
      for (const item of page.items) {
        const detail = repository.getMaterialById(item.id);
        assert.equal(detail.data_quality.level, EXPECTED[item.id], item.id);
        qualityParity(item.data_quality, detail.data_quality);
        qualityParity(candidates.find((candidate) => candidate.id === item.id).data_quality, detail.data_quality);
        // Single-ID offline aggregates prove membership, not just the eight-ID total.
        const single = path.join(directory, `single-${item.id}.db`);
        fs.copyFileSync(file, single);
        const db = new DatabaseSync(single);
        try { db.prepare("UPDATE materials SET catalog_visibility='admin_only' WHERE material_id != ?").run(item.id); }
        finally { db.close(); }
        const member = await buildCatalogStats(single);
        assert.equal(member.publicMaterialTotal, 1);
        assert.equal(member.aggregates.verifiedCommercialGrades, Number(detail.data_quality.recommendation_eligible), item.id);
        assert.equal(member.aggregates.materialsAwaitingVerification, Number(!detail.data_quality.recommendation_eligible), item.id);
      }
    } finally { repository.close(); }
    await withServer(file, async (server) => {
      const before = await diagnostics(server.child);
      for (let index = 0; index < 3; index++) assert.equal((await request(server, "/api/catalog-stats")).status, 200);
      const after = await diagnostics(server.child);
      assert.deepEqual(after.repository, before.repository, "Stats route must not scan, hydrate or evaluate");
      assert.equal(before.repository.hydratedCalls, 0, "Startup never evaluates materials");
      assert.equal(before.repository.evaluatorCalls, 0);
      assert.equal(before.repository.fileHashReads, 4, "One DB hash and the three semantic policy files at startup");
      const page = (await request(server, "/api/materials?limit=30")).body;
      const evaluated = await diagnostics(server.child);
      assert.ok(evaluated.repository.evaluatorCalls > before.repository.evaluatorCalls,
        "Positive control: actual page quality evaluation is observed by the same counter");
      const stats = (await request(server, "/api/catalog-stats")).body;
      assert.deepEqual(page.generation, stats.generation);
      const recall = (await request(server, "/api/recommendation-candidates")).body.items;
      for (const item of page.items) {
        const detail = (await request(server, `/api/materials/${item.id}`)).body;
        qualityParity(item.data_quality, detail.data_quality);
        qualityParity(recall.find((candidate) => candidate.id === item.id).data_quality, detail.data_quality);
        assert.equal(item.data_quality.level, EXPECTED[item.id]);
        assert.equal("issues" in item.data_quality, false);
      }
      await liveInvalidation(file, server, directory);
    });
    await generationCases(file, directory);
    await independentTripwireCases(file, directory);
    await boundedCases(directory);
    await policyCases(directory);
    await finalizationBindingCases(file, directory);
    await latePublicationCases(file, directory);
    await executedPolicyCases(file, directory);
    console.log("AD-08 artifact/generation, eight-ID cross-path membership, bounded hydration and publication regressions passed.");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function liveInvalidation(file, server, directory) {
  const backup = path.join(directory, "before-live.db");
  fs.copyFileSync(file, backup);
  const database = new DatabaseSync(file);
  try { database.exec("UPDATE materials SET name='changed' WHERE material_id='H'"); }
  finally { database.close(); }
  const page = await request(server, "/api/materials?limit=30");
  assert.equal(page.status, 200);
  assert.equal(page.body.items.find((item) => item.id === "H").name, "changed");
  assert.equal(page.body.generation, null, "Page cannot stamp old G on new data");
  assert.equal((await request(server, "/api/catalog-stats")).status, 503);
  assert.deepEqual((await request(server, "/api/ready")).body, { status: "not_ready", reason: "catalog_stats_unavailable" });
  fs.copyFileSync(backup, file);
  assert.equal((await request(server, "/api/catalog-stats")).status, 503, "Restore cannot revive process generation");
}

async function generationCases(file, directory) {
  await withServer(file, async (server) => assert.equal((await request(server, "/api/catalog-stats")).status, 200));
  const original = fs.readFileSync(artifactPath(file));
  const good = JSON.parse(original);
  for (const [name, contents] of [
    ["missing", null], ["malformed", "{"], ["oversized", " ".repeat(MAX_ARTIFACT_BYTES + 1)],
    ["db", JSON.stringify({ ...good, datasetDigest: "0".repeat(64) })],
    ["policy", JSON.stringify({ ...good, policyDigest: "0".repeat(64) })],
    ["format", JSON.stringify({ ...good, formatVersion: 999 })],
    ["digest type", JSON.stringify({ ...good, datasetDigest: [good.datasetDigest] })],
    ["aggregate type", JSON.stringify({ ...good, aggregates: { ...good.aggregates, verifiedCommercialGrades: "3" } })],
    ["invalid date", JSON.stringify({ ...good, computedAt: "2026-02-31T00:00:00.000Z" })],
    ["shape", JSON.stringify({ ...good, materials: [] })]
  ]) {
    if (contents === null) fs.rmSync(artifactPath(file)); else fs.writeFileSync(artifactPath(file), contents);
    const repository = await runtime(file);
    try { assert.equal(repository.getCatalogStats(), null, name); assert.equal(repository.listMaterials().generation, null); }
    finally { repository.close(); }
    await withServer(file, async (server) => {
      assert.equal((await request(server, "/api/health")).status, 200);
      assert.equal((await request(server, "/api/materials?limit=30")).body.total, 8);
      const stats = await request(server, "/api/catalog-stats");
      assert.equal(stats.status, 503, name);
      assert.equal("verifiedCommercialGrades" in stats.body, false);
      assert.equal((await request(server, "/api/ready")).body.reason, "catalog_stats_unavailable");
    });
    fs.writeFileSync(artifactPath(file), original);
  }
  const newer = path.join(directory, "new.db");
  fs.copyFileSync(file, newer);
  const database = new DatabaseSync(newer);
  try { database.exec("UPDATE materials SET name='new generation' WHERE material_id='H'"); }
  finally { database.close(); }
  fs.writeFileSync(artifactPath(newer), original);
  let repo = await runtime(newer);
  try { assert.equal(repo.getCatalogStats(), null, "New DB + old sidecar"); } finally { repo.close(); }
  const newArtifact = await buildCatalogStats(newer);
  fs.writeFileSync(artifactPath(file), JSON.stringify(newArtifact));
  repo = await runtime(file);
  try { assert.equal(repo.getCatalogStats(), null, "Old DB + new sidecar"); } finally { repo.close(); }
  fs.writeFileSync(artifactPath(file), original);

  // Observe complete old contents at the exact rename boundary; inject rename failure.
  const rename = fs.renameSync;
  let reached = false;
  fs.renameSync = function (source, destination) {
    if (destination === artifactPath(file)) {
      reached = true;
      assert.deepEqual(fs.readFileSync(destination), original);
      assert.equal(loadArtifact(source).datasetDigest, good.datasetDigest);
      throw new Error("Injected publish failure");
    }
    return rename.apply(this, arguments);
  };
  try { await assert.rejects(buildCatalogStats(file), /Injected publish failure/); }
  finally { fs.renameSync = rename; }
  assert.ok(reached);
  assert.deepEqual(fs.readFileSync(artifactPath(file)), original);
  assert.equal(fs.readdirSync(directory).some((name) => name.includes(".tmp-")), false);
  await buildCatalogStats(file);
  assert.equal(loadArtifact(artifactPath(file)).datasetDigest, good.datasetDigest);
  // Reservation rejects a concurrent SQLite writer during the build.
  const hash = fs.createReadStream;
  let blocked = false;
  fs.createReadStream = function (filename, options) {
    if (filename === file && !blocked) {
      const writer = new DatabaseSync(file);
      try { assert.throws(() => writer.exec("UPDATE materials SET name='writer' WHERE material_id='H'"), /locked/); blocked = true; }
      finally { writer.close(); }
    }
    return hash.call(this, filename, options);
  };
  try { await buildCatalogStats(file); } finally { fs.createReadStream = hash; }
  assert.ok(blocked);

  const empty = path.join(directory, "empty.db"); createSchema(empty);
  const emptyArtifact = await buildCatalogStats(empty);
  assert.deepEqual(emptyArtifact.aggregates, { polymerFamilies: 7, verifiedCommercialGrades: 0,
    verifiedPropertyDataPoints: 0, materialsAwaitingVerification: 0 });
  await withServer(empty, async (server) => {
    assert.equal((await request(server, "/api/catalog-stats")).body.verifiedCommercialGrades, 0);
    assert.equal((await request(server, "/api/ready")).body.reason, "no_verified_public_grades");
  });
  const wal = new DatabaseSync(empty);
  try {
    wal.exec("PRAGMA journal_mode=WAL");
    await assert.rejects(buildCatalogStats(empty), /sealed/);
    const unsealed = await runtime(empty);
    try { assert.equal(unsealed.getCatalogStats(), null); } finally { unsealed.close(); }
  } finally { wal.close(); }
}

async function boundedCases(directory) {
  const file = path.join(directory, "bounded.db"); createSchema(file);
  const database = new DatabaseSync(file);
  try {
    database.exec("BEGIN");
    for (let i = 0; i < 201; i++) addMaterial(database, `B-${String(i).padStart(3, "0")}`);
    // Same key, different conditions: retain legitimate multiple measurements.
    addProperty(database, "B-000", "tensile_strength", 80, { test_condition: "80 C", position: 1 });
    insert(database, "evidence_sources", { source_id: 9002, source_fingerprint: "precedence", created_at: "2026-01-01", source_type: "manufacturer",
      source_title: "Normalized wins", source_url: "https://example.invalid/precedence" });
    database.prepare("UPDATE material_property_evidence SET source_id=9002,source_type='distributor',source_title='Inline ignored' WHERE material_id='B-001'").run();
    database.exec("COMMIT");
  } finally { database.close(); }
  await buildCatalogStats(file);
  const repository = await runtime(file);
  try {
    const hydrate = repository._hydrateDetailedRows;
    const sizes = [];
    repository._hydrateDetailedRows = function (rows, read) {
      // The reused hydration method itself chunks pages at 30; inspect its reader IDs.
      assert.equal(typeof read, "function");
      return hydrate.call(this, rows, (sql, params, tag) => {
        if (tag === "property_evidence") sizes.push(params.length);
        return read(sql, params, tag);
      });
    };
    for (const limit of [30, 31, 48, 49, 200]) {
      sizes.length = 0;
      const seen = [];
      for (let offset = 0; offset < 201; offset += limit) {
        const page = repository.listMaterials({ limit, offset, sort: "name" });
        assert.equal(page.total, 201);
        seen.push(...page.items.map((item) => item.id));
      }
      assert.equal(seen.length, 201); assert.equal(new Set(seen).size, 201);
      assert.deepEqual(seen, Array.from({ length: 201 }, (_, i) => `B-${String(i).padStart(3, "0")}`),
        "SQL page order survives hydration and projection");
      assert.ok(sizes.length > 0, "Batch instrumentation must observe actual evidence queries");
      assert.ok(sizes.every((size) => size > 0 && size <= 30));
    }
    assert.equal(repository.listMaterials().items.length, 48);
    repository._hydrateDetailedRows = hydrate;
    assert.equal(repository.getMaterialById("B-000").data_quality.level, "high");
    const normalized = repository.getMaterialById("B-001");
    assert.equal(normalized.data_quality.level, "high");
    assert.equal(normalized.evidence.properties.density[0].source.sourceTitle, "Normalized wins");
    // Default detail uses _all, unchanged; restore instrumentation for assertions below.
    repository._hydrateDetailedRows = hydrate;
  } finally { repository.close(); }
}

async function policyCases(directory) {
  const policyRoot = path.join(directory, "policy"); fs.mkdirSync(policyRoot); fs.mkdirSync(path.join(policyRoot, "scripts"));
  for (const file of POLICY_MANIFEST) fs.copyFileSync(path.join(root, file), path.join(policyRoot, file));
  const digest = await policyDigest(policyRoot);
  fs.writeFileSync(path.join(policyRoot, "unrelated.txt"), "not a policy input");
  assert.equal(await policyDigest(policyRoot), digest);
  fs.appendFileSync(path.join(policyRoot, "evidence-model.js"), "\n// changed bytes\n");
  assert.notEqual(await policyDigest(policyRoot), digest);
  const file = path.join(directory, "overflow.db"); createSchema(file);
  const database = new DatabaseSync(file);
  try {
    addMaterial(database, "overflow");
    for (let i = 0; i < 997; i++) addProperty(database, "overflow", "impact_strength", i, { position: i });
  } finally { database.close(); }
  const repository = new MaterialRepository(file);
  try {
    assert.throws(() => repository.listMaterials(), /row limit/);
    assert.equal(repository.ad08Statements.size, 0);
    assert.equal(repository.database.prepare("SELECT 1 AS ok").get().ok, 1);
    assert.equal(repository._readAd08Rows("SELECT value FROM json_each(?) ORDER BY value DESC",
      [JSON.stringify(Array.from({ length: 1000 }, (_, i) => i))], "bound").length, 1000);
    assert.equal(repository.ad08Statements.size, 0);
    assert.throws(() => repository.getMaterialById("overflow"), /maximum batch size/,
      "Generic _all still rejects over-1000 rows with its existing behavior");
    // Force iterator-next failure and prove strong owner through iterator cleanup.
    const prepare = repository.database.prepare;
    let returned = false;
    repository.database.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      if (!sql.includes("AD08_ITERATOR_PROBE")) return statement;
      const wrapper = { iterate(...params) {
        const inner = statement.iterate(...params);
        return { [Symbol.iterator]() { return this; }, next() { throw new Error("Injected cursor failure"); },
          return() { assert.ok(repository.ad08Statements.has(wrapper)); returned = true; return inner.return(); } };
      } };
      return wrapper;
    };
    assert.throws(() => repository._readAd08Rows("SELECT 1 /* AD08_ITERATOR_PROBE */", [], "probe"), /Injected cursor/);
    assert.ok(returned); assert.equal(repository.ad08Statements.size, 0);
    repository.database.prepare = prepare;
  } finally { repository.close(); }
  const destination = artifactPath(file); fs.writeFileSync(destination, "previous complete artifact");
  await assert.rejects(buildCatalogStats(file), /row limit/);
  assert.equal(fs.readFileSync(destination, "utf8"), "previous complete artifact");
  const db = new DatabaseSync(file);
  try { db.exec("UPDATE materials SET name='usable after failure'"); } finally { db.close(); }
}

async function independentTripwireCases(file, directory) {
  const testFile = path.join(directory, "tripwires.db");
  fs.copyFileSync(file, testFile);
  await buildCatalogStats(testFile);
  let repository = await runtime(testFile);
  const stat = fs.statSync;
  const frozenState = stat(testFile, { bigint: true });
  try {
    fs.statSync = function (filename, options) {
      if (filename === testFile && options?.bigint) return frozenState;
      return stat.apply(this, arguments);
    };
    const database = new DatabaseSync(testFile);
    try { database.exec("UPDATE materials SET name='data version only' WHERE material_id='H'"); }
    finally { database.close(); }
    assert.equal(repository.getCatalogStats(), null, "Same-connection data_version catches writes even with frozen file stats");
  } finally { fs.statSync = stat; repository.close(); }
  await buildCatalogStats(testFile);
  repository = await runtime(testFile);
  try {
    const before = repository.database.prepare("PRAGMA data_version").get().data_version;
    const state = fs.statSync(testFile);
    fs.utimesSync(testFile, state.atime, new Date(state.mtimeMs + 2000));
    assert.equal(repository.database.prepare("PRAGMA data_version").get().data_version, before);
    assert.equal(repository.getCatalogStats(), null, "File-state changes independently invalidate G");
    fs.utimesSync(testFile, state.atime, state.mtime);
    await repository.initializeCatalogStats();
    assert.equal(repository.getCatalogStats(), null, "Same process cannot rebind/revalidate");
  } finally { repository.close(); }
  repository = await runtime(testFile);
  try { assert.ok(repository.getCatalogStats(), "Fresh process/connection validates matching restored bytes"); }
  finally { repository.close(); }
  // A file changed between connection opening and startup verification is unavailable.
  repository = new MaterialRepository(testFile);
  try {
    const state = fs.statSync(testFile);
    fs.utimesSync(testFile, state.atime, new Date(state.mtimeMs + 2000));
    await repository.initializeCatalogStats();
    assert.equal(repository.getCatalogStats(), null);
  } finally { repository.close(); }
  const missing = path.join(directory, "missing.db");
  await assert.rejects(buildCatalogStats(missing), /ENOENT/);
  assert.equal(fs.existsSync(missing), false);
  const before = await digestFile(testFile);
  fs.writeFileSync(testFile + "-journal", "unsealed fixture");
  await assert.rejects(buildCatalogStats(testFile), /sealed/);
  assert.equal(await digestFile(testFile), before, "Reject side files before opening any recovery-capable writer");
  fs.rmSync(testFile + "-journal");
}

async function finalizationBindingCases(file, directory) {
  const sourceDigest = await digestFile(file);
  for (const stage of ["before-initialization", "reservation-metadata"]) {
    const target = path.join(directory, `benign-${stage}.db`);
    fs.copyFileSync(file, target);
    const before = fs.statSync(target, { bigint: true });
    const replacement = target + ".replacement";
    if (stage === "before-initialization") fs.copyFileSync(target, replacement);
    const open = fs.openSync, exec = DatabaseSync.prototype.exec;
    let transitioned = false;
    fs.openSync = function (filename, flags, ...args) {
      if (stage === "before-initialization" && filename === target && flags === "r+" && !transitioned) {
        fs.renameSync(replacement, target); transitioned = true;
        assert.notEqual(fs.statSync(target, { bigint: true }).ino, before.ino,
          "Positive control: identical bytes really acquired a different file identity");
      }
      return open.call(this, filename, flags, ...args);
    };
    DatabaseSync.prototype.exec = function (sql) {
      const result = exec.call(this, sql);
      if (stage === "reservation-metadata" && sql.includes("BEGIN IMMEDIATE") && !transitioned) {
        const stat = fs.statSync(target);
        fs.utimesSync(target, stat.atime, new Date(stat.mtimeMs + 2000));
        transitioned = true;
        assert.notEqual(fs.statSync(target, { bigint: true }).mtimeNs, before.mtimeNs);
      }
      return result;
    };
    let artifact;
    try { artifact = await buildCatalogStats(target); }
    finally { fs.openSync = open; DatabaseSync.prototype.exec = exec; }
    assert.ok(transitioned, stage);
    assert.equal(await digestFile(target), sourceDigest, "Benign initialization never changes DB bytes");
    assert.equal(artifact.datasetDigest, sourceDigest);
    const accepted = await runtime(target);
    try {
      assert.ok(accepted.getCatalogGeneration(), "Artifact validates after pre-baseline identity transition");
      assert.equal(accepted.getCatalogStats().verifiedCommercialGrades, artifact.aggregates.verifiedCommercialGrades);
    } finally { accepted.close(); }
  }
  const different = path.join(directory, "binding-different.db"); fs.copyFileSync(file, different);
  const writer = new DatabaseSync(different);
  try { writer.exec("UPDATE materials SET name='changed before binding' WHERE material_id='H'"); }
  finally { writer.close(); }
  for (const stage of ["after-initialization-replacement", "reservation-content", "descriptor-path-disagreement"]) {
    const target = path.join(directory, `hostile-binding-${stage}.db`);
    fs.copyFileSync(file, target); await buildCatalogStats(target);
    const previous = fs.readFileSync(artifactPath(target));
    const replacement = target + ".replacement";
    if (stage === "after-initialization-replacement") fs.copyFileSync(target, replacement);
    const open = fs.openSync, close = fs.closeSync, exec = DatabaseSync.prototype.exec, stat = fs.statSync;
    let initializationFd, changed = false;
    fs.openSync = function (filename, flags, ...args) {
      const fd = open.call(this, filename, flags, ...args);
      if (filename === target && flags === "r+") initializationFd = fd;
      return fd;
    };
    fs.closeSync = function (fd) {
      const result = close.call(this, fd);
      if (stage === "after-initialization-replacement" && fd === initializationFd && !changed) {
        changed = true; fs.renameSync(replacement, target);
      }
      return result;
    };
    DatabaseSync.prototype.exec = function (sql) {
      const result = exec.call(this, sql);
      if (sql.includes("BEGIN IMMEDIATE") && !changed && stage !== "after-initialization-replacement") {
        changed = true;
        if (stage === "reservation-content") fs.copyFileSync(different, target);
      }
      return result;
    };
    fs.statSync = function (filename, options) {
      const value = stat.call(this, filename, options);
      // Portable binding-level injection: simulate path DB-B while descriptor remains DB-A.
      if (stage === "descriptor-path-disagreement" && changed && filename === target && options?.bigint)
        return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { ino: value.ino + 1n });
      return value;
    };
    try { await assert.rejects(buildCatalogStats(target), /Finalization database identity changed/, stage); }
    finally { fs.openSync = open; fs.closeSync = close; DatabaseSync.prototype.exec = exec; fs.statSync = stat; }
    assert.ok(changed, stage);
    assert.deepEqual(fs.readFileSync(artifactPath(target)), previous, "Binding failure preserves predecessor");
    if (stage === "reservation-content") {
      const rejected = await runtime(target);
      try { assert.equal(rejected.getCatalogGeneration(), null); } finally { rejected.close(); }
    }
    await buildCatalogStats(target);
    const clean = await runtime(target);
    try { assert.ok(clean.getCatalogGeneration(), "Clean rebuild after binding failure works"); }
    finally { clean.close(); }
    assert.equal(fs.readdirSync(directory).some((name) => name.includes(".tmp-")), false);
  }
  console.log("AD08-G2 binding: benign byte-identical pre-baseline transitions accepted; inode/content/descriptor binding failures reject.");
}

async function latePublicationCases(file, directory) {
  const replacement = path.join(directory, "replacement.db");
  fs.copyFileSync(file, replacement);
  const change = new DatabaseSync(replacement);
  try { change.exec("UPDATE materials SET name='late DB replacement' WHERE material_id='H'"); }
  finally { change.close(); }
  const replacementDigest = await digestFile(replacement);
  for (const stage of ["second-policy-hash", "temporary-fsync", "after-rename", "guard-release"]) {
    const target = path.join(directory, `late-${stage}.db`);
    fs.copyFileSync(file, target);
    await buildCatalogStats(target);
    const previous = fs.readFileSync(artifactPath(target));
    let mutated = false;
    const mutate = () => { fs.copyFileSync(replacement, target); mutated = true; };
    if (stage === "second-policy-hash") {
      // Actual fresh production CLI; only deterministic filesystem scheduling is injected.
      const hook = path.join(directory, "late-db-hook.cjs");
      fs.writeFileSync(hook, `const fs=require('node:fs');const stream=fs.createReadStream;let passes=0;
        fs.createReadStream=function(file,...args){if(file===${JSON.stringify(path.join(root, "material-quality.js"))} && ++passes===2)
          fs.copyFileSync(${JSON.stringify(replacement)},${JSON.stringify(target)});return stream.call(this,file,...args)};`);
      const result = spawnSync(process.execPath, ["--require", hook, path.join(root, "scripts/build-catalog-stats.js"), target],
        { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Finalization database identity changed/);
      mutated = (await digestFile(target)) === replacementDigest;
    } else {
      const sync = fs.fsyncSync, rename = fs.renameSync, exec = DatabaseSync.prototype.exec;
      fs.fsyncSync = function (...args) {
        const result = sync.apply(this, args);
        if (stage === "temporary-fsync" && !mutated) mutate();
        return result;
      };
      fs.renameSync = function (source, destination) {
        const result = rename.call(this, source, destination);
        if (stage === "after-rename" && destination === artifactPath(target) && !mutated) mutate();
        return result;
      };
      DatabaseSync.prototype.exec = function (sql) {
        const result = exec.call(this, sql);
        if (stage === "guard-release" && sql === "ROLLBACK" && !mutated) mutate();
        return result;
      };
      try { await assert.rejects(buildCatalogStats(target), /Finalization database identity changed/); }
      finally { fs.fsyncSync = sync; fs.renameSync = rename; DatabaseSync.prototype.exec = exec; }
    }
    assert.ok(mutated, stage);
    assert.equal(await digestFile(target), replacementDigest, "Changed DB remains the target");
    assert.deepEqual(fs.readFileSync(artifactPath(target)), previous, "Previous artifact preserved byte-for-byte");
    const unavailable = await runtime(target);
    try { assert.equal(unavailable.getCatalogGeneration(), null, "Old artifact cannot validate changed DB"); }
    finally { unavailable.close(); }
    await buildCatalogStats(target);
    const clean = await runtime(target);
    try { assert.ok(clean.getCatalogGeneration(), "Later clean rebuild works"); }
    finally { clean.close(); }
    assert.equal(fs.readdirSync(directory).some((name) => name.includes(".tmp-")), false);
  }
  // Post-replace failure without a predecessor removes the new sidecar.
  const target = path.join(directory, "late-without-previous.db"); fs.copyFileSync(file, target);
  const rename = fs.renameSync;
  fs.renameSync = function (source, destination) {
    const result = rename.call(this, source, destination);
    if (destination === artifactPath(target)) fs.copyFileSync(replacement, target);
    return result;
  };
  try { await assert.rejects(buildCatalogStats(target), /Finalization database identity changed/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(artifactPath(target)), false);
  console.log("AD08-P2-01: CLI late hash, temp write, post-rename, guard-release and no-predecessor failures pass.");
}

async function executedPolicyCases(file, directory) {
  const isolated = path.join(directory, "executed-policy");
  fs.mkdirSync(path.join(isolated, "scripts"), { recursive: true });
  for (const relative of [...POLICY_MANIFEST, "catalog-policy.js", "catalog-stats-artifact.js", "scripts/build-catalog-stats.js"])
    fs.copyFileSync(path.join(root, relative), path.join(isolated, relative));
  const target = path.join(isolated, "fixture.db"); fs.copyFileSync(file, target);
  const qualityFile = path.join(isolated, "material-quality.js");
  const p1 = fs.readFileSync(qualityFile, "utf8");
  const rule = 'recommendation_eligible: level === "high" || level === "medium",';
  assert.ok(p1.includes(rule));
  const p2 = p1.replace(rule, "recommendation_eligible: false,");
  const cli = (...preload) => spawnSync(process.execPath,
    [...preload, path.join(isolated, "scripts/build-catalog-stats.js"), target],
    { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const child = (code) => {
    const result = spawnSync(process.execPath, ["-e", code], { cwd: isolated, encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const runtimeResult = () => JSON.parse(child(`(async()=>{
    const {MaterialRepository}=require('./catalog-policy').loadCanonicalPolicy().repository;
    const r=new MaterialRepository(${JSON.stringify(target)});await r.initializeCatalogStats();
    console.log(JSON.stringify({accepted:!!r.getCatalogGeneration(),stats:r.getCatalogStats()?.verifiedCommercialGrades,
      eligible:r.listMaterials({limit:200}).items.filter(x=>x.data_quality.recommendation_eligible).length}));r.close()
  })().catch(e=>{console.error(e);process.exitCode=1});`));
  let result = cli(); assert.equal(result.status, 0, result.stderr);
  const oldArtifact = fs.readFileSync(artifactPath(target));
  assert.deepEqual(runtimeResult(), { accepted: true, stats: 3, eligible: 3 });
  fs.writeFileSync(qualityFile, p2);
  assert.equal(runtimeResult().accepted, false, "Old builder / new runtime rejected");
  result = cli(); assert.equal(result.status, 0, result.stderr);
  const newArtifact = fs.readFileSync(artifactPath(target));
  assert.notEqual(JSON.parse(newArtifact).policyDigest, JSON.parse(oldArtifact).policyDigest);
  assert.deepEqual(runtimeResult(), { accepted: true, stats: 0, eligible: 0 });
  fs.writeFileSync(qualityFile, p1);
  assert.equal(runtimeResult().accepted, false, "New builder / old runtime rejected");
  for (const bound of [false, true]) {
    fs.writeFileSync(qualityFile, p1);
    child(`const assert=require('node:assert/strict'),fs=require('node:fs');
      const {MaterialRepository}=${bound ? "require('./catalog-policy').loadCanonicalPolicy().repository" : "require('./material-repository')"};
      fs.writeFileSync(${JSON.stringify(qualityFile)},${JSON.stringify(p2)});
      (async()=>{await assert.rejects(require('./scripts/build-catalog-stats').buildCatalogStats(${JSON.stringify(target)}),/policy/i);
        const r=new MaterialRepository(${JSON.stringify(target)});await r.initializeCatalogStats();
        assert.equal(r.getCatalogGeneration(),null);assert.equal(r.listMaterials().items.filter(x=>x.data_quality.recommendation_eligible).length,3);
        r.close();console.log('loaded-old/disk-new rejected')})().catch(e=>{console.error(e);process.exitCode=1});`);
    assert.deepEqual(fs.readFileSync(artifactPath(target)), newArtifact);
  }
  fs.writeFileSync(qualityFile, p1);
  // Persistent mutation while Node reads the module, after identity capture.
  child(`const assert=require('node:assert/strict'),fs=require('node:fs'),read=fs.readFileSync;let changed=false;
    fs.readFileSync=function(file,...args){const data=read.call(this,file,...args);
      if(file===${JSON.stringify(qualityFile)}&&!changed){changed=true;fs.writeFileSync(file,${JSON.stringify(p2)})}return data};
    assert.throws(()=>require('./catalog-policy').loadCanonicalPolicy(),/changed while loading/);assert.ok(changed);`);
  for (const stage of ["during-hash", "after-rename"]) {
    fs.writeFileSync(qualityFile, p1); fs.writeFileSync(artifactPath(target), oldArtifact);
    const hook = path.join(isolated, `policy-${stage}.cjs`);
    fs.writeFileSync(hook, `const fs=require('node:fs');let changed=false;
      const stream=fs.createReadStream,rename=fs.renameSync;
      fs.createReadStream=function(file,...args){if(${JSON.stringify(stage)}==='during-hash'&&file===${JSON.stringify(qualityFile)}&&!changed){
        changed=true;fs.writeFileSync(file,${JSON.stringify(p2)})}return stream.call(this,file,...args)};
      fs.renameSync=function(source,destination){const result=rename.call(this,source,destination);
        if(${JSON.stringify(stage)}==='after-rename'&&destination===${JSON.stringify(artifactPath(target))}&&!changed){
          changed=true;fs.writeFileSync(${JSON.stringify(qualityFile)},${JSON.stringify(p2)})}return result};`);
    result = cli("--require", hook); assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readFileSync(qualityFile, "utf8"), p2);
    assert.deepEqual(fs.readFileSync(artifactPath(target)), oldArtifact);
  }
  fs.writeFileSync(qualityFile, p1);
  result = cli(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(runtimeResult(), { accepted: true, stats: 3, eligible: 3 });
  console.log("AD08-P2-02: real P1/P2 CLI/runtime equivalence, bound/unbound CommonJS and load/hash/publication races pass.");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function withServer(file, callback) {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "test", PORT: String(port), MATFINDER_DB_PATH: file, MATFINDER_TRUST_PROXY: "" };
  delete env.OPENAI_API_KEY; delete env.MATFINDER_ADMIN_TOKEN;
  const child = spawn(process.execPath, [__filename, "--probe-server"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let logs = ""; child.stdout.on("data", (bytes) => { logs += bytes; }); child.stderr.on("data", (bytes) => { logs += bytes; });
  const server = { child, base: `http://127.0.0.1:${port}` };
  try {
    for (let attempt = 0;; attempt++) {
      if (child.exitCode !== null || attempt > 100) throw new Error("Fixture server failed: " + logs);
      try { if ((await fetch(server.base + "/api/live")).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await callback(server);
  } finally {
    if (child.exitCode === null) {
      const exit = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exit;
    }
  }
}
async function request(server, route) {
  const response = await fetch(server.base + route);
  return { status: response.status, body: await response.json() };
}
async function diagnostics(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Diagnostics timeout")), 3000);
    const listener = (message) => { if (message.type === "test-diagnostics-response") {
      clearTimeout(timer); child.off("message", listener); resolve(message);
    } };
    child.on("message", listener); child.send({ type: "test-diagnostics-request" });
  });
}
