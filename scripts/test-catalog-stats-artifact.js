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
} else ((process.argv.includes("--fa004-only") || process.argv.includes("--fa004-r1-only")) ? normalizedSourceParityCases() : main()).catch((error) => { console.error(error); process.exitCode = 1; });

function createSchema(file) {
  require("./schema-test-fixtures").bootstrapFixture(file);
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
      verifiedPropertyDataPoints: 10, materialsAwaitingVerification: 5 });
    assert.equal(artifact.policyDigest, await policyDigest());
    assert.equal(HASH_BUFFER_BYTES, 65536);
    assert.deepEqual(POLICY_MANIFEST, ["material-quality.js", "evidence-model.js", "material-repository.js", "property-projection-policy.js"]);
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
        // Independent eligibility oracle: H four, M two, normalized N four; all others zero.
        assert.equal(member.aggregates.verifiedPropertyDataPoints, ({ H: 4, M: 2, N: 4 })[item.id] || 0, item.id + " point contribution");
      }
    } finally { repository.close(); }
    await withServer(file, async (server) => {
      const before = await diagnostics(server.child);
      for (let index = 0; index < 3; index++) assert.equal((await request(server, "/api/catalog-stats")).status, 200);
      const after = await diagnostics(server.child);
      assert.deepEqual(after.repository, before.repository, "Stats route must not scan, hydrate or evaluate");
      assert.equal(before.repository.hydratedCalls, 0, "Startup never evaluates materials");
      assert.equal(before.repository.evaluatorCalls, 0);
      assert.equal(before.repository.fileHashReads, 5, "One DB hash and the four semantic policy files at startup");
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
    await normalizedSourceParityCases();
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
    // The canonical runtime gate now rejects this unsealed target before AD-08
    // initialization. The existing fail-closed generation assertion is stronger:
    // no repository can expose a generation from it at all.
    await assert.rejects(runtime(empty), error => error.code === "SCHEMA_UNREADABLE");
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
    repository._hydrateDetailedRows = function (rows, read, withProjection) {
      // The reused hydration method itself chunks pages at 30; inspect its reader IDs.
      assert.equal(typeof read, "function");
      return hydrate.call(this, rows, (sql, params, tag) => {
        if (tag === "property_evidence") sizes.push(params.length);
        return read(sql, params, tag);
      }, withProjection);
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
  for (const file of [...POLICY_MANIFEST, "schema-contract.js", "database-schema-contract.json"]) fs.copyFileSync(path.join(root, file), path.join(policyRoot, file));
  const digest = await policyDigest(policyRoot);
  fs.writeFileSync(path.join(policyRoot, "unrelated.txt"), "not a policy input");
  assert.equal(await policyDigest(policyRoot), digest);
  for (const name of ["evidence-model.js", "property-projection-policy.js"]) {
    const source=path.join(policyRoot,name), original=fs.readFileSync(source);
    fs.appendFileSync(source,"\n// changed bytes\n");
    assert.notEqual(await policyDigest(policyRoot),digest,name+" is a semantic digest input");
    fs.writeFileSync(source,original);
  }
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
  for (const relative of [...POLICY_MANIFEST, "catalog-policy.js", "catalog-stats-artifact.js", "schema-contract.js", "database-schema-contract.json", "scripts/build-catalog-stats.js"])
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
  const projectionFile=path.join(isolated,"property-projection-policy.js");
  const projectionSource=fs.readFileSync(projectionFile);
  child(`const assert=require('node:assert/strict'),fs=require('node:fs');
    const bound=require('./catalog-policy').loadCanonicalPolicy();
    fs.appendFileSync(${JSON.stringify(projectionFile)},'\\n// changed projection policy\\n');
    assert.throws(()=>bound.assertCurrentSources(),/no longer matches/);`);
  fs.writeFileSync(projectionFile,projectionSource);
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

// FA-004 R-A/I-A/A-A/T1-A/T2-A/S-A permanent real-repository regression.
async function normalizedSourceParityCases() {
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;
const { buildCatalogStats } = require("./build-catalog-stats");
const { bootstrapFixture } = require("./schema-test-fixtures");

function insert(database, table, row) {
  const keys = Object.keys(row);
  return database.prepare("INSERT INTO " + table + " (" + keys.join(",") + ") VALUES (" +
    keys.map(() => "?").join(",") + ")").run(...keys.map(key => row[key]));
}
function addMaterial(database, id, { manufacturer = "FA004 Fixture", grade = id, family = "PC", ...fields } = {}) {
  insert(database, "materials", { material_id: id, name: id, name_en: id, name_zh: id,
    abbreviation: family, category: "Plastics", category_en: "Plastics", category_zh: "Plastics",
    record_type: "commercial_grade", record_origin: "imported", scope_status: "in_scope", catalog_visibility: "public",
    applications: "[]", applications_en: "[]", applications_zh: "[]", limitations: "[]", alternatives: "[]",
    typical_applications: "[]", advantages: "[]", disadvantages: "[]", tags_en: "[]", tags_zh: "[]",
    translation_quality: "partial", translation_status: "partial", processing_methods: "[]",
    source_note: "Explicit synthetic regression fixture; not real material evidence", summary: "Fixture",
    description_en: "", description_zh: "", notes: "", ...fields });
  insert(database, "real_material_identities", { material_id: id, manufacturer, commercial_grade: grade,
    material_family: family, manufacturer_key: manufacturer.toLowerCase(), commercial_grade_key: grade.toLowerCase(),
    material_family_key: family.toLowerCase(), created_at: "2026-01-01", active: 1 });
  insert(database, "material_evidence", { material_id: id, manufacturer, commercial_grade: grade, material_family: family,
    source_type: "manufacturer", source_title: "Synthetic identity fixture", source_url: "https://example.invalid/identity",
    verification_status: "verified", confidence_level: "high" });
}
function addSource(database, id, grade, extra = {}) {
  insert(database, "evidence_sources", { source_id: id, source_fingerprint: "fa004-fixture-" + id,
    created_at: "2026-01-01", source_type: "manufacturer", source_title: "Synthetic property fixture",
    source_url: "https://example.invalid/property", manufacturer: "FA004 Fixture", commercial_grade: grade,
    material_family: "PC", ...extra });
}
function addProperty(database, id, key, value, extra = {}) {
  return Number(insert(database, "material_property_evidence", { material_id: id, property_key: key, position: 0,
    value_numeric: value, unit: key === "density" ? "g/cm3" : key === "tensile_strength" ? "MPa" : "degC",
    test_standard: "ASTM fixture", test_condition: "23 C", value_type: "typical",
    manufacturer: "FA004 Fixture", commercial_grade: id, material_family: "PC",
    source_type: "manufacturer", source_title: "Synthetic property fixture",
    source_url: "https://example.invalid/property", verification_status: "verified",
    confidence_level: "high", conflict_status: "none", ...extra }).lastInsertRowid);
}
async function observe(file, id) {
  const artifact = await buildCatalogStats(file);
  const repository = new MaterialRepository(file);
  try {
    await repository.initializeCatalogStats();
    const detail = repository.getMaterialById(id, { audit: true });
    const admin = repository.listMaterials({ audit: true, limit: 200 }).items.find(item => item.id === id);
    const publicDetail=repository.getMaterialById(id);
    if(publicDetail) {
      assertQualityParity(publicDetail.data_quality,detail.data_quality,id+" public/detail");
      assert.equal("audit_state" in publicDetail,false,"Public repository material must not expose private audit state");
      const candidate=repository.getRecommendationCandidates().find(item=>item.id===id);
      assert.ok(candidate,id+" remains in unchanged candidate universe");
      assertQualityParity(candidate.data_quality,detail.data_quality,id+" candidate/detail");
      assert.equal("audit_state" in candidate,false,"Recommendation response must not gain private audit state");
      if(detail.evidence.properties.density?.every(claim=>claim.verificationStatus==="partially_verified"))
        assert.equal(publicDetail.propertyProjections.density.queryKey,null,"Partial Stats points do not enable FA-003 numeric querying");
    }
    return { id, canonical: detail.data_quality, admin: admin.data_quality, audit_state: admin.audit_state,
      points: artifact.aggregates.verifiedPropertyDataPoints, artifact };
  } finally { repository.close(); }
}
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-fa004-regression-"));
  try {
    const file = path.join(directory, "normalized-medium.db");
    bootstrapFixture(file);
    const database = new DatabaseSync(file);
    try {
      addMaterial(database, "FA004-MEDIUM");
      addSource(database, 1, "FA004-MEDIUM");
      for (const [key, value] of [["density", 1.2], ["tensile_strength", 40]])
        addProperty(database, "FA004-MEDIUM", key, value, { source_id: 1,
          source_type: "unknown", source_title: null, source_url: null, confidence_level: "medium" });
    } finally { database.close(); }
    const result = await observe(file, "FA004-MEDIUM");
    console.log("FA-004 test-first observation: " + JSON.stringify(result));
    assert.equal(result.canonical.level, "medium");
    assert.equal(result.admin.level, "medium", "S-A: normalized-only Admin quality must equal existing canonical quality");
    assert.equal(result.points, 2, "S-A: two qualified normalized claims must count as two points");
    await sourceMatrix(directory);
    await pilotCases(directory);
    await rawAuditCounterCases(directory);
    await identityAndBoundedCases(directory);
    await adminHighFanoutCases(directory);
    await adminR1CapacityCases(directory);
    console.log("FA-004 S-A normalized-source permanent regression passed; S-B global source relation changes remain deferred.");
  } finally {
    const relative = path.relative(os.tmpdir(), directory);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) &&
        path.basename(directory).startsWith("matfinder-fa004-regression-"))
      fs.rmSync(directory, { recursive: true, force: true });
  }
}


function patchRows(db, table, id, changes) {
  const keys = Object.keys(changes);
  db.prepare("UPDATE " + table + " SET " + keys.map(key => key + "=?").join(",") + " WHERE material_id=?")
    .run(...keys.map(key => changes[key]), id);
}
function patchSource(db, changes, id = 1) {
  const keys = Object.keys(changes);
  db.prepare("UPDATE evidence_sources SET " + keys.map(key => key + "=?").join(",") + " WHERE source_id=?")
    .run(...keys.map(key => changes[key]), id);
}
function fixture(db, id, normalized = true) {
  addMaterial(db, id);
  addSource(db, 1, id);
  for (const [key, value] of [["density", 1.2], ["tensile_strength", 40], ["hdt", 125], ["continuous_use_temperature", 110]])
    addProperty(db, id, key, value, normalized ? { source_id: 1, source_type: "unknown", source_title: null, source_url: null } : {});
}
function assertQualityParity(actual, expected, name) {
  for (const key of ["level", "confidence_level", "verification_status", "recommendation_eligible", "reference_only"])
    assert.equal(actual[key], expected[key], name + " quality." + key);
  if ("factory_ready" in actual) assert.equal(actual.factory_ready,expected.factory_ready,name+" quality.factory_ready");
}
const MATRIX = [
  { id: "T01", name: "inline only", inline: true, points: 4, grade: "high" },
  { id: "T02", name: "normalized only", points: 4, grade: "high" },
  { id: "T03", name: "both matching", points: 4, grade: "high", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{source_type:"manufacturer",source_title:"Synthetic property fixture",source_url:"https://example.invalid/property"});
  }},
  { id: "T04", name: "metadata conflicting", points: 4, grade: "high", reason:"source_metadata_conflict", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{source_type:"unknown",source_title:"Old title",source_url:"ftp://old.invalid/"});
  }},
  { id: "T05", name: "missing source", points: 0, grade: "low", reason:"source_metadata_missing", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{source_id:null});
  }},
  { id: "T06", name: "orphan source ID", points: 0, reason:"invalid_source_reference", deferred:true, inline:true, orphan:true, mutate(db,id) {
    db.exec("PRAGMA foreign_keys=OFF");
    patchRows(db,"material_property_evidence",id,{source_id:999999});
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,4,"Only deliberate property orphan violations");
  }},
  ...["source_title","source_url","source_type"].map(field=>({id:"T07",name:"missing metadata "+field,points:0,grade:"low",
    reason:field==="source_type"?"source_type_untrusted":"source_metadata_missing",mutate(db) { patchSource(db,{[field]:field==="source_type"?"unknown":null}); }})),
  { id: "T08", name: "partially verified", points: 4, grade:"medium", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{verification_status:"partially_verified",confidence_level:"medium"});
  }},
  { id: "T09", name: "unverified", points: 0, grade:"low", reason:"claim_unverified", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{verification_status:"unverified"});
  }},
  { id: "T10", name: "resolved generated", points: 0, grade:"quarantined", hold:"quarantined", mutate(db) {
    patchSource(db,{source_type:"generated"});
  }},
  { id: "T10", name: "raw generated lineage cannot be washed", points: 0, hold:"quarantined", access:"audit_only", reason:"raw_generated_source", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{source_type:"generated"});
  }},
  { id: "T11", name: "quarantined verification", points: 0, grade:"low", hold:"quarantined", access:"audit_only", reason:"claim_quarantined", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{verification_status:"quarantined"});
  }},
  { id: "T12", name: "quarantined confidence", points: 0, grade:"high", hold:"quarantined", access:"audit_only", reason:"claim_quarantined", mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{confidence_level:"quarantined"});
  }},
  { id: "T13", name: "explicit conflict", points: 0, grade:"quarantined", hold:"quarantined", reason:"explicit_property_conflict", mutate(db,id) {
    db.prepare("UPDATE material_property_evidence SET conflict_status='conflicting' WHERE material_id=? AND property_key='density'").run(id);
  }},
  { id: "T14", name: "same source multiple properties", points:4, grade:"high" },
  { id:"T14", name:"non-query textual claim with no test condition",points:5,grade:"high",mutate(db,id) {
    addProperty(db,id,"flame_retardancy",null,{value_text:"V-0",unit:"class",test_standard:null,test_condition:null,
      source_id:1,source_type:"unknown",source_title:null,source_url:null});
  }},
  { id:"T14", name:"zero-valued non-key claim is present",points:5,grade:"high",mutate(db,id) {
    addProperty(db,id,"water_absorption",0,{unit:"%",source_id:1,source_type:"unknown",source_title:null,source_url:null});
  }},
  { id:"T11",name:"certification quarantine independent of property points",points:4,grade:"high",hold:"quarantined",reason:"claim_quarantined",mutate(db,id) {
    insert(db,"material_certifications",{material_id:id,certification_name:"UL fixture",certification_status:"unknown",
      source_type:"manufacturer",source_title:"Synthetic certification fixture",source_url:"https://example.invalid/certificate",
      verification_status:"quarantined",confidence_level:"medium"});
  }},
  { id: "T15", name: "two batch references per evidence", points:4, grade:"high", mutate(db) {
    for(const batch of ["first","second"]) {
      insert(db,"import_batches",{import_batch_id:batch,imported_at:"2026-01-01",input_file_hash:batch,input_file_name:batch+".json",
        imported_record_count:1,rejected_record_count:0,status:"committed",report_json:"{}"});
      for(const row of db.prepare("SELECT id FROM material_property_evidence").all())
        insert(db,"import_entity_links",{import_batch_id:batch,entity_type:"property_evidence",entity_id:String(row.id),created_by_batch:Number(batch==="first")});
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_entity_links").get().n,8);
  }},
  { id:"T16",name:"duplicate fact different evidence ID",points:5,grade:"high",mutate(db,id) {
    const row={...db.prepare("SELECT * FROM material_property_evidence WHERE material_id=? AND property_key='density'").get(id)};
    delete row.id; row.position=1; insert(db,"material_property_evidence",row);
  }},
  { id:"T17",name:"same property different conditions",points:5,grade:"high",mutate(db,id) {
    addProperty(db,id,"density",1.2,{position:1,test_condition:"80 C",source_id:1,source_type:"unknown",source_title:null,source_url:null});
  }},
  { id:"T18",name:"multiple distinct sources",points:4,grade:"high",mutate(db,id) {
    let sid=1; for(const row of db.prepare("SELECT id FROM material_property_evidence").all()) {
      sid++; addSource(db,sid,id,{source_url:"https://example.invalid/source/"+sid});
      db.prepare("UPDATE material_property_evidence SET source_id=? WHERE id=?").run(sid,row.id);
    }
  }},
  { id:"T19",name:"shared document explicit per-material claims",points:8,grade:"high",mutate(db,id) {
    patchSource(db,{manufacturer:null,commercial_grade:null,material_family:null});
    addMaterial(db,id+"B");
    for (const [key,value] of [["density",1.2],["tensile_strength",40],["hdt",125],["continuous_use_temperature",110]])
      addProperty(db,id+"B",key,value,{source_id:1,source_type:"unknown",source_title:null,source_url:null});
  }},
  { id:"T20",name:"identity source explicitly belongs to other grade",points:0,deferred:true,reason:"source_identity_context_mismatch",mutate(db,id) {
    patchSource(db,{commercial_grade:"Another Grade"});
    patchRows(db,"material_evidence",id,{source_id:1,source_type:"unknown",source_title:null,source_url:null});
  }},
  { id:"T21",name:"property source explicitly belongs to other grade",points:0,deferred:true,reason:"source_identity_context_mismatch",mutate(db) {
    patchSource(db,{commercial_grade:"Another Grade"});
  }},
  { id:"T22",name:"shared source coverage unresolved",points:0,deferred:true,reason:"unresolved_source_identity_context",mutate(db,id) {
    patchSource(db,{manufacturer:null,commercial_grade:null,material_family:null});
    patchRows(db,"material_property_evidence",id,{manufacturer:null,commercial_grade:null,material_family:null});
  }},
  { id:"T23",name:"NULL normalized fields fallback",points:4,grade:"high",inline:true,mutate(db,id) {
    patchSource(db,{source_title:null,source_url:null});
    patchRows(db,"material_property_evidence",id,{source_id:1});
  }},
  ...["source_title","source_url"].map(field=>({id:"T23",name:"empty "+field+" blocks fallback",points:0,grade:"low",inline:true,mutate(db,id) {
    patchSource(db,{[field]:""}); patchRows(db,"material_property_evidence",id,{source_id:1});
  }})),
  ...["https://?","https://#","https:///x","https://"," http://example.invalid","https://example.invalid ","https://example.invalid/\tpath",
     "https://example.invalid/\npath","https://example.invalid/\rpath","https://example.invalid/\u0000path","https://example.invalid/\u007fpath",
     "\uFEFFhttps://example.invalid/property"]
    .map((url,i)=>({id:"T24",name:"raw malformed URL "+i,points:0,deferred:true,reason:"source_url_invalid",mutate(db) { patchSource(db,{source_url:url}); }})),
  { id:"T25",name:"one missing value",points:3,grade:"medium",reason:"property_value_missing",mutate(db,id) {
    db.prepare("UPDATE material_property_evidence SET value_numeric=NULL,value_text=NULL WHERE material_id=? AND property_key='density'").run(id);
  }},
  { id:"T26",name:"one missing unit",points:3,grade:"high",reason:"property_unit_missing",mutate(db,id) {
    db.prepare("UPDATE material_property_evidence SET unit=NULL WHERE material_id=? AND property_key='density'").run(id);
  }},
  { id:"T27",name:"low confidence",points:0,grade:"high",reason:"claim_confidence_insufficient",mutate(db,id) {
    patchRows(db,"material_property_evidence",id,{confidence_level:"low"});
  }},
  ...[["record_type","legacy","legacy_record"],["record_origin","generated","generated_record"],["catalog_visibility","admin_only","admin_only"],
      ["scope_status","out_of_scope","out_of_scope"]].map(([field,value,reason])=>({id:"T28",name:value,points:0,grade:"high",access:"audit_only",reason,mutate(db,id) {
    patchRows(db,"materials",id,{[field]:value});
  }}))
];

async function sourceMatrix(directory) {
  const results=[];
  for (const [index,test] of MATRIX.entries()) {
    const file=path.join(directory,"matrix-"+index+".db"), id="FA004-"+test.id+"-"+index;
    bootstrapFixture(file);
    const db=new DatabaseSync(file);
    try {
      fixture(db,id,!test.inline);
      if(test.mutate) test.mutate(db,id);
      if(!test.orphan) assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    } finally { db.close(); }
    const observed=await observe(file,id), name=test.id+" "+test.name;
    assert.equal(observed.points,test.points,name+" scoped points");
    assertQualityParity(observed.admin,observed.canonical,name);
    if(test.grade) assert.equal(observed.canonical.level,test.grade,name+" approved existing canonical oracle");
    assert.equal(observed.audit_state.access,test.access||"catalog_boundary_eligible",name+" boundary");
    if(test.hold) assert.equal(observed.audit_state.hold,test.hold,name+" safety hold");
    if(test.reason) assert.ok(observed.audit_state.reasons.includes(test.reason),name+" reason "+test.reason+" in "+JSON.stringify(observed.audit_state));
    assert.equal(observed.artifact.formatVersion,1);
    assert.equal(observed.artifact.aggregates.verifiedCommercialGrades+observed.artifact.aggregates.materialsAwaitingVerification,
      observed.artifact.publicMaterialTotal,name+" preserved T2-A partition");
    results.push({test:test.id,name:test.name,scope:"S-A scoped verification",
      deferred:test.deferred?"S-B deferred global behavior: no new global grade/identity/FA-003/recommendation oracle asserted":null,
      canonical:observed.canonical.level,admin:observed.admin.level,points:observed.points,audit_state:observed.audit_state});
  }
  console.log("FA-004 source representation matrix: "+JSON.stringify(results));
  return results;
}

async function pilotCases(directory) {
  // Exact archived SEC-02B1 input facts; test-only restoration, not production approval.
  // Source: pilot-materials.candidate.json, SHA256
  // 31cf708d12ee631444eb6cbd4f4930fce8ac52f83084a94f0848c878f8c61bd0.
  const { spawnSync }=require("node:child_process");
  const source=path.join(directory,"archived-real-pilot.json");
  fs.writeFileSync(source,JSON.stringify(ARCHIVED_PILOT));
  assert.equal(ARCHIVED_PILOT.productionApproved,false);
  const candidates=[process.env.PYTHON,path.join(process.env.USERPROFILE||"",".cache","codex-runtimes","codex-primary-runtime","dependencies","python","python.exe"),"python","py"].filter(Boolean);
  const python=candidates.find(exe=>spawnSync(exe,["--version"],{encoding:"utf8",windowsHide:true}).status===0);
  assert.ok(python,"Python required for actual real-material importer");
  const file=path.join(directory,"real-pilot.db");
  bootstrapFixture(file);
  const imported=spawnSync(python,["-B",path.join(__dirname,"import-real-materials.py"),"--database",file,"--file",source,
    "--operator","FA-004 permanent isolated regression","--source","archived SEC-02B1, not production-approved"],
    {encoding:"utf8",windowsHide:true});
  assert.equal(imported.status,0,imported.stdout+imported.stderr);
  const artifact=await buildCatalogStats(file);
  assert.equal(artifact.aggregates.verifiedPropertyDataPoints,9,"T29/T30 real archived eligible facts 4+5");
  const expectations=[["T29","REAL-B298D3147EBA26C9FDEA36CC",4],["T30","REAL-80BD014401930A3B62E81176",5]];
  for(const [test,id,points] of expectations) {
    const single=path.join(directory,test+".db");
    fs.copyFileSync(file,single);
    const db=new DatabaseSync(single);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_property_evidence WHERE material_id=?").get(id).n,points);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_property_evidence WHERE material_id=? AND source_id IS NOT NULL AND source_title IS NULL AND source_url IS NULL").get(id).n,points);
      assert.equal(db.prepare("SELECT active FROM real_material_identities WHERE material_id=?").get(id).active,1);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
      db.prepare("UPDATE materials SET catalog_visibility='admin_only' WHERE material_id!=?").run(id);
    } finally { db.close(); }
    const observed=await observe(single,id);
    assert.equal(observed.canonical.level,"medium",test);
    assertQualityParity(observed.admin,observed.canonical,test);
    assert.equal(observed.canonical.factory_ready,false,test+" is not release approval");
    assert.equal(observed.points,points,test+" independent contribution");
    assert.equal(observed.audit_state.access,"catalog_boundary_eligible");
    console.log(test+" real archived pilot: "+JSON.stringify({id,canonical:observed.canonical.level,admin:observed.admin.level,
      points:observed.points,audit_state:observed.audit_state,factory_ready:false,productionApproved:false}));
  }
}
async function rawAuditCounterCases(directory) {
  const file=path.join(directory,"T31.db");
  bootstrapFixture(file);
  let db=new DatabaseSync(file);
  try { fixture(db,"FA004-T31"); } finally { db.close(); }
  let repository=new MaterialRepository(file);
  let original;
  try { original=repository.getAuditStats(); } finally { repository.close(); }
  assert.deepEqual(original,{legacyMaterialRecords:0,legacyPropertyRecords:0,generatedRecords:0,quarantinedRecords:0,
    quarantinedMaterialRecords:0,outOfScopeRecords:0});
  db=new DatabaseSync(file);
  try { patchSource(db,{source_type:"generated"}); } finally { db.close(); }
  repository=new MaterialRepository(file);
  try {
    assert.deepEqual(repository.getAuditStats(),original,"T31 derived source alerts do not rewrite raw counters");
    const admin=repository.listMaterials({audit:true}).items[0];
    assert.equal(admin.data_quality.level,"quarantined");
    assert.equal(admin.audit_state.hold,"quarantined");
  } finally { repository.close(); }
  db=new DatabaseSync(file);
  try {
    patchRows(db,"material_property_evidence","FA004-T31",{verification_status:"quarantined"});
    patchRows(db,"materials","FA004-T31",{record_type:"legacy",record_origin:"generated",scope_status:"out_of_scope",catalog_visibility:"admin_only"});
  } finally { db.close(); }
  repository=new MaterialRepository(file);
  try {
    assert.deepEqual(repository.getAuditStats(),{legacyMaterialRecords:1,legacyPropertyRecords:4,generatedRecords:1,
      quarantinedRecords:4,quarantinedMaterialRecords:1,outOfScopeRecords:1},"T31 all raw counters retain their definitions");
  } finally { repository.close(); }
}
async function identityAndBoundedCases(directory) {
  const additional=[
    {label:"exact Unicode identity",manufacturer:"制造商",raw:"制造商",points:4},
    {label:"ASCII case/whitespace identity",manufacturer:"FA004 Fixture",raw:"  fa004\tFIXTURE ",points:4},
    {label:"Unicode casefold unproved",manufacturer:"Straße",raw:"STRASSE",points:0,reason:"unresolved_source_identity_context"},
    {label:"NFKC compatibility unproved",manufacturer:"ＡＣＭＥ",raw:"ACME",points:0,reason:"unresolved_source_identity_context"},
    {label:"leading BOM identity is not silently decoded away",manufacturer:"FA004 Fixture",raw:"\uFEFFFA004 Fixture",points:0,reason:"unresolved_source_identity_context"}
  ];
  for(const [i,test] of additional.entries()) {
    const file=path.join(directory,"identity-"+i+".db");
    bootstrapFixture(file);
    const db=new DatabaseSync(file),id="FA004-UNICODE-"+i;
    try {
      fixture(db,id);
      patchRows(db,"real_material_identities",id,{manufacturer:test.manufacturer,manufacturer_key:test.manufacturer.toLowerCase()});
      patchRows(db,"material_evidence",id,{manufacturer:test.manufacturer});
      patchRows(db,"material_property_evidence",id,{manufacturer:test.manufacturer});
      patchSource(db,{manufacturer:test.raw});
    } finally { db.close(); }
    const result=await observe(file,id);
    assert.equal(result.points,test.points,test.label);
    assertQualityParity(result.admin,result.canonical,test.label);
    if(test.reason) assert.ok(result.audit_state.reasons.includes(test.reason),test.label);
  }
  const file=path.join(directory,"bounded.db");
  bootstrapFixture(file);
  const db=new DatabaseSync(file);
  try {
    db.exec("BEGIN");
    for(let i=0;i<205;i++) {
      const id="BOUND-"+String(i).padStart(3,"0"),sid=i+1;
      addMaterial(db,id);addSource(db,sid,id);
      for(const [key,value] of [["density",1.2],["tensile_strength",40],["hdt",125],["continuous_use_temperature",110]])
        addProperty(db,id,key,value,{source_id:sid,source_type:"unknown",source_title:null,source_url:null});
    }
    // Sources without claims cannot inflate counts; distinct source PKs exercise high cardinality.
    for(let i=10000;i<11000;i++) addSource(db,i,"Unused");
    db.exec("COMMIT");
  } finally { db.close(); }
  const original=MaterialRepository.prototype._hydrateDetailedRows;
  const batches=[];
  MaterialRepository.prototype._hydrateDetailedRows=function(rows,...args) { batches.push(rows.length);return original.call(this,rows,...args); };
  let repository;
  try {
    const artifact=await buildCatalogStats(file);
    assert.equal(artifact.aggregates.verifiedPropertyDataPoints,820);
    assert.ok(batches.length>=7&&Math.max(...batches)<=30,"Stats offline keyset hydration stays at batch <=30");
    batches.length=0;
    repository=new MaterialRepository(file);
    const first=repository.listMaterials({audit:true,limit:10000,offset:0}),second=repository.listMaterials({audit:true,limit:200,offset:200});
    assert.equal(first.total,205);assert.equal(first.items.length,200);assert.equal(second.items.length,5);
    assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,205,"SQL pagination no duplicates/lost items");
    assert.ok(Math.max(...batches)<=30,"Admin canonical hydration stays within 30 selected rows per batch");
    assert.equal(batches.reduce((sum,size)=>sum+size,0),205,"Only the 200 + 5 selected Admin rows are canonically hydrated");
    for(const item of [...first.items,...second.items]) {
      assert.equal(item.data_quality.level,"high");assert.equal(item.audit_state.access,"catalog_boundary_eligible");
    }
  } finally { if(repository)repository.close();MaterialRepository.prototype._hydrateDetailedRows=original; }
  console.log("FA-004 identity exactness/Unicode held, source PK cardinality and bounded Admin/stats traversal passed.");
}


async function adminHighFanoutCases(directory) {
  const file=path.join(directory,"admin-high-fanout.db");
  bootstrapFixture(file);
  const db=new DatabaseSync(file);
  const ids=Array.from({length:30},(_,i)=>"FANOUT-"+String(i).padStart(2,"0"));
  try {
    db.exec("BEGIN");
    for (const [i,id] of ids.entries()) {
      const sid=i+1;
      addMaterial(db,id); addSource(db,sid,id);
      for(const [key,value] of [["density",1.2],["tensile_strength",40],["hdt",125],["continuous_use_temperature",110]])
        addProperty(db,id,key,value,{source_id:sid,source_type:"unknown",source_title:null,source_url:null});
      // Distinct IDs are legitimate T1-A records; identical values avoid a fabricated material conflict.
      const extra=i===0?902:2;
      for(let position=1;position<=extra;position++)
        addProperty(db,id,"density",1.2,{position,source_id:sid,source_type:"unknown",source_title:null,source_url:null});
    }
    db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_property_evidence WHERE material_id=?").get(ids[0]).n,906);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM material_property_evidence").get().n,1080);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally { db.close(); }
  const repository=new MaterialRepository(file);
  const read=repository._adminReadChunk;
  let limitFailures=0;
  const successfulRows=[],materialGroups=[];
  repository._adminReadChunk=function(sql,params,tag,...args) {
    if(["property_evidence","scoped_source_evidence"].includes(tag)) materialGroups.push(params.length);
    try {
      const rows=read.call(this,sql,params,tag,...args);
      successfulRows.push(rows.length);
      return rows;
    } catch(error) {
      if(/bounded evidence read exceeded row limit/.test(error.message)) limitFailures++;
      throw error;
    }
  };
  try {
    const page=repository.listMaterials({audit:true,limit:30});
    assert.equal(page.total,30);
    assert.deepEqual(page.items.map(item=>item.id),ids,"Bounded hydration preserves SQL-selected ordering and count");
    assert.equal(new Set(page.items.map(item=>item.id)).size,30,"Keyset hydration cannot duplicate materials");
    assert.equal(page.hasMore,false);
    assert.equal(limitFailures,0,"R1 must not use failing reads and adaptive retries as its normal paging mechanism");
    assert.ok(successfulRows.length>0 && Math.max(...successfulRows)<=1000,"Actual Admin chunks must preserve the per-read cap");
    assert.ok(materialGroups.length>0 && Math.max(...materialGroups)<=3,"Evidence queries bind one material and at most its raw keyset cursor");
    for(const item of page.items) {
      assert.equal(item.data_quality.level,"high");
      assert.equal(item.audit_state.access,"catalog_boundary_eligible");
      assert.equal(item.audit_state.hold,"none");
    }
    const split=[];
    for(let offset=0;offset<30;offset+=7) {
      const part=repository.listMaterials({audit:true,limit:7,offset});
      assert.equal(part.total,30);
      split.push(...part.items.map(item=>item.id));
    }
    assert.deepEqual(split,ids,"SQL pagination and order match before/after bounded hydration");
  } finally { repository.close(); }

  const excessFile=path.join(directory,"admin-single-material-over-cap.db");
  bootstrapFixture(excessFile);
  const excess=new DatabaseSync(excessFile);
  try {
    fixture(excess,"FANOUT-EXCESS");
    for(let position=1;position<=997;position++)
      addProperty(excess,"FANOUT-EXCESS","density",1.2,{position,source_id:1,source_type:"unknown",source_title:null,source_url:null});
    assert.equal(excess.prepare("SELECT COUNT(*) AS n FROM material_property_evidence").get().n,1001);
  } finally { excess.close(); }
  const limited=new MaterialRepository(excessFile);
  try {
    assert.throws(()=>limited._readAd08Rows("SELECT id FROM material_property_evidence ORDER BY id",[],"property_evidence"),
      /bounded evidence read exceeded row limit/,
      "The original direct per-query 1000 guard is unchanged; an unbounded 1001-row read must still fail");
    assert.equal(limited.ad08Statements.size,0,"Direct guard failure closes its iterator owner");
    const complete=limited.listMaterials({audit:true,limit:30});
    assert.equal(Object.values(complete.items[0].evidence.properties).flat().length,1001,
      "Approved R1 paginates complete evidence without relaxing the direct guard");
  } finally { limited.close(); }
  console.log("FA-004 Admin 906 + 29*6 and complete 1001 pass; original single-query 1000 guard remains fail-closed.");
}

// FA-004B-R1 fixed formal-v1 fixtures are test-only. The complete oracle below
// delegates to the unchanged canonical hydration/normalizer/evaluator and reads
// the full fixed fixture directly; it never uses the candidate keyset adapter.
async function adminR1CapacityCases(directory) {
  const exports=require("../catalog-policy").loadCanonicalPolicy().repository;
  const {AdminCapacityContext,AdminCapacityError,AdminRequestCancelledError,ADMIN_CAPACITY_LIMITS,jsonEncodedByteLength}=exports;
  const rowsOf=item=>Object.values(item.evidence.properties).flat();
  const summary=[];
  let sequence=0;
  function make(name,count=2506,options={}) {
    const file=path.join(directory,"r1-"+(sequence++)+"-"+name+".db");
    bootstrapFixture(file);
    const db=new DatabaseSync(file);
    const size=options.size||1,high=options.high||[0],ids=Array.from({length:size},(_,i)=>"R1-"+String(i).padStart(3,"0"));
    try {
      db.exec("BEGIN");
      for(const [i,id] of ids.entries()) {
        addMaterial(db,id);addSource(db,i+1,id,{source_title:"T",source_url:"https://example.invalid/p"});
        const n=high.includes(i)?count:6;
        if(options.noIdentity) db.prepare("DELETE FROM material_evidence WHERE material_id=?").run(id);
        const properties=[["density",1.2],["tensile_strength",40],["hdt",125],["continuous_use_temperature",110]];
        for(let j=0;j<Math.min(n,4);j++) addProperty(db,id,...properties[j],{source_id:i+1,source_type:"unknown",source_title:null,source_url:null,test_standard:"ISO",test_condition:"23 C"});
        for(let j=4;j<n;j++) addProperty(db,id,"density",1.2,{position:j-3,source_id:i+1,source_type:"unknown",source_title:null,source_url:null,test_standard:"ISO",test_condition:"23 C"});
      }
      if(options.mutate)options.mutate(db,ids);
      db.exec("COMMIT");
    } catch(error) {try{db.exec("ROLLBACK");}catch{} throw error;} finally {db.close();}
    return {file,ids};
  }
  function oracle(file,options) {
    const repo=new MaterialRepository(file);
    const read=(sql,params)=>repo.database.prepare(sql).all(...params);
    repo._readAd08Rows=read;
    repo._hydrateAuditRows=function(rows) {
      const items=rows.flatMap(row=>this._hydrateDetailedRows([row],read));
      this._attachAuditState(rows,items);
      return items;
    };
    try {return repo.listMaterials({...options,audit:true});} finally {repo.close();}
  }
  function check(file,options={},expectedLevel) {
    const expected=oracle(file,options),repo=new MaterialRepository(file);
    const context=AdminCapacityContext?new AdminCapacityContext():undefined;
    const delivered=new Map(),nativeChunk=repo._adminReadChunk;
    if(nativeChunk)repo._adminReadChunk=function(sql,params,tag,...args) {
      const rows=nativeChunk.call(this,sql,params,tag,...args);
      if(/LIMIT 1000/.test(sql)) {
        const table=sql.match(/FROM (material_tags|material_uses|material_sources|material_evidence|material_property_evidence|material_certifications|real_material_identities)\b/)?.[1];
        assert.ok(table,"Bounded evidence SQL has a known real schema table");
        assert.ok(rows.length<=1000,"Every chunk respects 1000 SQL deliveries");
        const key=tag+"|"+table+"|"+params[0];
        if(!delivered.has(key))delivered.set(key,[]);
        for(const row of rows) {
          assert.equal(row.material_id,params[0],"Every JOIN row belongs to selected material");
          delivered.get(key).push(row.__admin_cursor??row.material_id);
        }
      }
      return rows;
    };
    try {
      const page=repo.listMaterials({...options,audit:true,adminCapacity:context});
      assert.deepEqual(page,expected,"Complete canonical object, issues, audit state, SQL page and all evidence must equal independent full-input oracle");
      if(expectedLevel)assert.equal(page.items[0].data_quality.level,expectedLevel);
      for(const [key,actual] of delivered) {
        const [tag,table,id]=key.split("|");
        const field=["material_tags","material_uses"].includes(table)?"position":table==="real_material_identities"?"material_id":"id";
        const order=tag==="property_evidence"?"property_key,position,evidence_version":field;
        const expectedIds=repo.database.prepare("SELECT "+field+" AS cursor FROM "+table+" WHERE material_id=?"+
          (table==="real_material_identities"?" AND active=1":"")+" ORDER BY "+order).all(id).map(x=>x.cursor);
        assert.deepEqual(actual,expectedIds,"Actual raw SQL ID/position order and completeness: "+key);
        assert.equal(new Set(actual).size,actual.length,"No repeated evidence IDs or JOIN multiplication: "+key);
      }
      if(repo.adminStatements)assert.ok(repo.adminStatements.size<=64,"Fixed prepared statement cache remains bounded");
      assert.equal(repo.ad08Statements.size,0,"All normal iterators release owner references");
      repo.database.exec("BEGIN");repo.database.exec("ROLLBACK");
      if(context) {
        assert.ok(context.metrics.maxChunkRows<=1000);
        assert.ok(context.metrics.sqlAttempts<=4096);
        assert.ok(context.metrics.deliveredRows<=20000);
      }
      summary.push({case:options.label||path.basename(file),limit:page.limit,total:page.total,items:page.items.length,
        claims:page.items.map(x=>rowsOf(x).length),quality:page.items.map(x=>x.data_quality.level),metrics:context?.metrics});
      return page;
    } finally {repo.close();}
  }
  function reject(file,options={},metric) {
    const repo=new MaterialRepository(file),context=new AdminCapacityContext();
    try {
      let rejectedBudget;
      assert.throws(()=>repo.listMaterials({...options,audit:true,adminCapacity:context}),error=>{
        if(!(error instanceof AdminCapacityError))return false;rejectedBudget=error.budget;return true;
      },"Only the approved typed request capacity rejection is accepted");
      if(metric)assert.equal(rejectedBudget,metric,"Actual gate must identify the intended approved resource");
      assert.equal(repo.ad08Statements.size,0);repo.database.exec("BEGIN");repo.database.exec("ROLLBACK");
      assert.ok(context.metrics.sqlAttempts>0,"Rejected work is accounted");
      summary.push({case:options.label||path.basename(file),rejected:true,budget:rejectedBudget,metrics:context.metrics});
      return context.metrics;
    } finally {repo.close();}
  }
  // First assertion is the permanent pre-implementation RED (2506 was HTTP500).
  const initial=make("initial-2506");
  for(const limit of [48,200])assert.equal(rowsOf(check(initial.file,{limit,label:"2506 required"},"high").items[0]).length,2506);
  assert.equal(typeof AdminCapacityContext,"function");
  for(const count of [0,1,999,1000,1001,5001]) {
    const item=make("count-"+count,count);
    for(const limit of [48,200]) {
      const page=check(item.file,{limit,label:"count "+count},count<2?"low":"high");
      assert.equal(rowsOf(page.items[0]).length,count);
    }
  }
  check(make("empty-identity",0,{noIdentity:true}).file,{limit:48},"quarantined");
  const oversized=make("count-10000",10000);for(const limit of [48,200])reject(oversized.file,{limit,label:"10000 approved budgets"});
  // SQL pages contain real normal peers, including the next page. No JS repaging.
  for(const limit of [48,200])for(const index of [0,Math.floor(limit/2),limit-1]) {
    const sample=make("position-"+limit+"-"+index,2506,{size:205,high:[index]});
    const page=check(sample.file,{limit,label:"2506 at "+index});
    assert.equal(page.total,205);assert.equal(page.hasMore,true);assert.equal(page.items.length,limit);
    assert.deepEqual(page.items.map(x=>x.id),sample.ids.slice(0,limit));assert.equal(rowsOf(page.items[index]).length,2506);
    check(sample.file,{limit:7,offset:index,query:"R1",label:"offset/search position "+index});
    check(sample.file,{limit:200,offset:205,label:"empty last page"});
  }
  check(make("two",2506,{size:205,high:[0,199]}).file,{limit:200,label:"two 2506"});
  reject(make("four",2506,{size:205,high:[0,47,100,199]}).file,{limit:200,label:"four 2506 exceed page"});
  // Every necessary stream crosses 1000, independently of the property stream.
  const all=make("all-streams",4,{mutate(db,ids){const id=ids[0];
    const original=db.prepare("SELECT * FROM material_evidence WHERE material_id=?").get(id);delete original.id;
    for(let n=0;n<1001;n++) {
      if(n)insert(db,"material_evidence",{...original,id:n===1?-1:undefined,...(n===1?{}:{id:n+100})});
      insert(db,"material_tags",{material_id:id,position:n,tag:"tag-"+n});
      insert(db,"material_uses",{material_id:id,position:n,use:"use-"+n});
      insert(db,"material_sources",{material_id:id,source_title:"L"+n,source_url:"https://example.invalid/l",source_type:"manufacturer",notes:"N"+n});
      insert(db,"material_certifications",{material_id:id,certification_name:"C"+n,certification_status:"unknown",
        source_type:"manufacturer",source_title:"C",source_url:"https://example.invalid/c",verification_status:"verified",confidence_level:"high"});
    }
  }});
  const complete=check(all.file,{limit:200,label:"all streams 1001"}).items[0];
  assert.equal(complete.tags.length,1001);assert.equal(complete.uses.length,1001);assert.equal(complete.sources.length,1001);
  assert.equal(complete.evidence.identity.sources.length,1001);assert.equal(complete.evidence.certifications.length,1001);
  const tail=new DatabaseSync(all.file);try {
    tail.prepare("UPDATE material_evidence SET commercial_grade='OTHER' WHERE id=(SELECT MAX(id) FROM material_evidence)").run();
    tail.prepare("UPDATE material_certifications SET verification_status='quarantined' WHERE id=(SELECT MAX(id) FROM material_certifications)").run();
  }finally{tail.close();}
  const lateIdentity=check(all.file,{limit:48,label:"1001st identity conflict and certification quarantine"},"quarantined").items[0];
  assert.equal(lateIdentity.audit_state.hold,"quarantined");
  // Literal identical UNIQUE tuple must still be rejected by actual formal schema.
  const unique=new DatabaseSync(initial.file);try {assert.throws(()=>addProperty(unique,"R1-000","density",1.2,{position:0}),/UNIQUE/);}finally{unique.close();}
  await lateCases();
  await lifecycleCases();
  await budgetCases();
  console.log("FA-004B-R1 permanent repository matrix: "+JSON.stringify(summary));

  async function lateCases() {
    const variants=[
      {name:"late explicit conflict",changes:{conflict_status:"conflicting"},grade:"quarantined",hold:"quarantined"},
      {name:"late numeric conflict",changes:{value_numeric:2},grade:"quarantined",hold:"quarantined"},
      {name:"late generated",changes:{source_id:null,source_type:"generated",source_title:"G",source_url:"https://example.invalid/g"},grade:"quarantined",hold:"quarantined"},
      {name:"late verification quarantine",changes:{verification_status:"quarantined"},grade:"high",hold:"quarantined"},
      {name:"late confidence quarantine",changes:{confidence_level:"quarantined"},grade:"high",hold:"quarantined"},
      {name:"late malformed URL",changes:{source_id:null,source_type:"manufacturer",source_title:"X",source_url:"https://example.invalid/x\0tail"},grade:"high",reason:"source_url_invalid"},
      {name:"late BOM URL",changes:{source_id:null,source_type:"manufacturer",source_title:"X",source_url:"\uFEFFhttps://example.invalid/x"},grade:"high",reason:"source_url_invalid"},
      {name:"late missing conditions",changes:{test_standard:null,test_condition:null},grade:"high"},
      {name:"late different condition",changes:{test_condition:"80 C",value_numeric:1.4},grade:"high"}
    ];
    for(const variant of variants) {
      const sample=make(variant.name.replace(/ /g,"-"),1005,{mutate(db,ids){const keys=Object.keys(variant.changes);
        db.prepare("UPDATE material_property_evidence SET "+keys.map(k=>k+"=?").join(",")+" WHERE material_id=? AND property_key='density' AND position=1001")
          .run(...keys.map(k=>variant.changes[k]),ids[0]);
      }});
      const item=check(sample.file,{limit:48,label:variant.name},variant.grade).items[0];
      if(variant.hold)assert.equal(item.audit_state.hold,variant.hold);
      if(variant.reason)assert.ok(item.audit_state.reasons.includes(variant.reason),variant.name);
    }
    const fourth=make("late-fourth-key",1001,{mutate(db,ids){
      db.prepare("DELETE FROM material_property_evidence WHERE material_id=? AND property_key='tensile_strength'").run(ids[0]);
      addProperty(db,ids[0],"tensile_strength",40,{position:1});
    }});
    const high=check(fourth.file,{limit:48,label:"late verified fourth key"},"high");
    assert.equal(rowsOf(high.items[0]).length,1001);
    const prefixFile=path.join(directory,"fourth-key-prefix.db");fs.copyFileSync(fourth.file,prefixFile);
    const prefixDb=new DatabaseSync(prefixFile);try{prefixDb.prepare("DELETE FROM material_property_evidence WHERE property_key='tensile_strength'").run();}finally{prefixDb.close();}
    assert.equal(oracle(prefixFile,{limit:48}).items[0].data_quality.level,"medium","Prefix is independently medium; the late fourth key is necessary for high");
    const orphan=make("late-orphan",1005),orphanDb=new DatabaseSync(orphan.file);
    try {orphanDb.exec("PRAGMA foreign_keys=OFF");orphanDb.prepare("UPDATE material_property_evidence SET source_id=999999,source_type='manufacturer',source_title='Own',source_url='https://example.invalid/own' WHERE property_key='density' AND position=1001").run();
      assert.equal(orphanDb.prepare("PRAGMA foreign_key_check").all().length,1);
    }finally{orphanDb.close();}
    const orphanItem=check(orphan.file,{limit:48,label:"late orphan S-A qualification"}).items[0];
    assert.ok(orphanItem.audit_state.reasons.includes("invalid_source_reference"));
    const unicode=make("unicode-order",4,{mutate(db,ids){
      db.prepare("UPDATE material_property_evidence SET id=-4 WHERE id=1").run();
      db.prepare("UPDATE material_property_evidence SET id=0 WHERE id=2").run();
      const keys=["z","\uFEFFa","a\0b","a\0c","é","e\u0301","中","\uE000","😀"];
      for(let i=0;i<1001;i++)addProperty(db,ids[0],keys[i%keys.length],i,{position:1001-i,test_condition:"Unicode "+i,value_type:"typical"});
      addProperty(db,ids[0],"hdt",140,{position:1,test_condition:"0.45 MPa"});
      addProperty(db,ids[0],"hdt",120,{position:2,test_condition:"1.8 MPa"});
      addProperty(db,ids[0],"tensile_strength",85,{position:1,test_condition:"dry"});
      addProperty(db,ids[0],"tensile_strength",50,{position:2,test_condition:"conditioned"});
    }});
    check(unicode.file,{limit:48,label:"NUL BOM Unicode BINARY order, HDT dry conditioned"});
    const shared=make("shared-distinct",1001,{mutate(db,ids){
      for(let i=1;i<=997;i++){addSource(db,100+i,ids[0]);db.prepare("UPDATE material_property_evidence SET source_id=? WHERE material_id=? AND property_key='density' AND position=?").run(100+i,ids[0],i);}
    }});check(shared.file,{limit:48,label:"1001 distinct normalized sources PK join"},"high");
  }
  async function lifecycleCases() {
    const sample=make("lifecycle",2506),repo=new MaterialRepository(sample.file);
    try {
      const original=repo._evaluateAdminMaterial;assert.equal(typeof original,"function");
      repo._evaluateAdminMaterial=()=>{throw Error("R1_EVALUATOR_FAILURE");};
      const context=new AdminCapacityContext();
      assert.throws(()=>repo.listMaterials({audit:true,limit:48,adminCapacity:context}),error=>error.message==="R1_EVALUATOR_FAILURE"&&!(error instanceof AdminCapacityError));
      repo._evaluateAdminMaterial=original;
      assert.ok(context.metrics.deliveredRows>=2506);assert.equal(repo.ad08Statements.size,0);
      assert.equal(rowsOf(repo.listMaterials({audit:true,limit:48}).items[0]).length,2506);
      summary.push({case:"evaluator failure and reuse",metrics:context.metrics});
    } finally {repo.close();}
    // Real SQLite prepare failure after a complete first property chunk.
    const sqlRepo=new MaterialRepository(sample.file),nativeChunk=sqlRepo._adminReadChunk;
    const sqlContext=new AdminCapacityContext();let failed=false;
    sqlRepo._adminReadChunk=function(sql,params,tag,...args) {
      if(!failed && tag==="property_evidence" && params.length>1) {failed=true;sql="SELECT id FROM r1_deliberately_missing_table LIMIT 1000";}
      return nativeChunk.call(this,sql,params,tag,...args);
    };
    try {
      assert.throws(()=>sqlRepo.listMaterials({audit:true,limit:48,adminCapacity:sqlContext}),error=>error.code==="ERR_SQLITE_ERROR"&&!(error instanceof AdminCapacityError));
      assert.equal(failed,true);assert.ok(sqlContext.metrics.deliveredRows>=1000);assert.ok(sqlContext.metrics.sqlFailures>=1);
      assert.equal(sqlRepo.ad08Statements.size,0);sqlRepo._adminReadChunk=nativeChunk;
      assert.equal(rowsOf(sqlRepo.listMaterials({audit:true,limit:48}).items[0]).length,2506);
      summary.push({case:"real SQL second chunk failure and reuse",metrics:sqlContext.metrics});
    } finally {sqlRepo.close();}
    // Iterator step failure must run return while its statement owner is alive.
    const iteratorRepo=new MaterialRepository(sample.file),prepare=iteratorRepo.database.prepare;
    let injected=false,returned=false,ownerAtReturn=false;
    iteratorRepo.database.prepare=function(sql) {
      const statement=prepare.call(this,sql);
      if(injected||!sql.includes("FROM material_property_evidence evidence_row")||!sql.includes("LIMIT 1000"))return statement;
      injected=true;
      let proxy;
      proxy=new Proxy(statement,{get(target,key){
        if(key!=="iterate"){const value=target[key];return typeof value==="function"?value.bind(target):value;}
        return (...params)=>{const iterator=target.iterate(...params);let rows=0;return {
          [Symbol.iterator](){return this;},
          next(){if(rows++===999)throw Error("R1_ITERATOR_STEP_FAILURE");return iterator.next();},
          return(){returned=true;ownerAtReturn ||= iteratorRepo.ad08Statements.has(proxy);return iterator.return();}
        };};
      }});return proxy;
    };
    const iteratorContext=new AdminCapacityContext();
    try {
      assert.throws(()=>iteratorRepo.listMaterials({audit:true,limit:48,adminCapacity:iteratorContext}),/R1_ITERATOR_STEP_FAILURE/);
      assert.ok(injected&&returned&&ownerAtReturn);assert.ok(iteratorContext.metrics.deliveredRows>=999);
      assert.equal(iteratorRepo.ad08Statements.size,0);iteratorRepo.database.prepare=prepare;iteratorRepo.adminStatements.clear();
      assert.equal(rowsOf(iteratorRepo.listMaterials({audit:true,limit:48}).items[0]).length,2506);
      summary.push({case:"iterator failure return owner cleanup reuse",metrics:iteratorContext.metrics});
    } finally {iteratorRepo.database.prepare=prepare;iteratorRepo.close();}
    // Invalid/private cursor is a programming/data error, never normal EOF or K1.
    for(const corrupt of ["missing","duplicate","foreign-material"]) {
      const cursorRepo=new MaterialRepository(sample.file),read=cursorRepo._adminReadChunk;let changed=false;
      cursorRepo._adminReadChunk=function(sql,params,tag,...args) {
        const rows=read.call(this,sql,params,tag,...args);
        if(!changed&&tag==="property_evidence"&&rows.length===1000){changed=true;
          if(corrupt==="foreign-material")rows[0].material_id="OTHER";
          else rows[rows.length-1].__admin_cursor=corrupt==="duplicate"?rows[0].__admin_cursor:-999999;
        }return rows;
      };
      try {assert.throws(()=>cursorRepo.listMaterials({audit:true,limit:48}),error=>!(error instanceof AdminCapacityError)&&/Admin stream/.test(error.message));
        assert.equal(changed,true);assert.equal(cursorRepo.ad08Statements.size,0);cursorRepo._adminReadChunk=read;
        assert.equal(rowsOf(cursorRepo.listMaterials({audit:true,limit:48}).items[0]).length,2506);
      }finally{cursorRepo.close();}
    }
    const decode=make("invalid-utf8",1005),decodeDb=new DatabaseSync(decode.file);
    try {decodeDb.prepare("UPDATE material_property_evidence SET source_id=NULL,source_url=CAST(X'ff' AS TEXT) WHERE property_key='density' AND position=1001").run();}finally{decodeDb.close();}
    const decodeRepo=new MaterialRepository(decode.file),decodeContext=new AdminCapacityContext();
    try {
      assert.throws(()=>decodeRepo.listMaterials({audit:true,limit:48,adminCapacity:decodeContext}),error=>!(error instanceof AdminCapacityError)&&error.code==="ERR_ENCODING_INVALID_ENCODED_DATA");
      assert.equal(decodeRepo.ad08Statements.size,0);decodeRepo.database.exec("BEGIN");decodeRepo.database.exec("ROLLBACK");
      assert.ok(decodeContext.metrics.deliveredRows>1000);summary.push({case:"late scoped fatal decode",metrics:decodeContext.metrics});
    }finally{decodeRepo.close();}
    for(const mode of ["deadline","cancelled"]) {
      const r=new MaterialRepository(sample.file),read=r._adminReadChunk;let now=0,cancelled=false,changed=false;
      const context=new AdminCapacityContext({now:()=>now,isCancelled:()=>cancelled});
      r._adminReadChunk=function(sql,params,tag,...args){const rows=read.call(this,sql,params,tag,...args);
        if(!changed&&tag==="property_evidence"){changed=true;if(mode==="deadline")now=4001;else cancelled=true;}return rows;};
      try {
        assert.throws(()=>r.listMaterials({audit:true,limit:48,adminCapacity:context}),error=>mode==="deadline"
          ? error instanceof AdminCapacityError&&error.budget==="requestMs"
          : error instanceof AdminRequestCancelledError&&!(error instanceof AdminCapacityError));
        assert.ok(changed);assert.equal(r.ad08Statements.size,0);r._adminReadChunk=read;
        assert.equal(rowsOf(r.listMaterials({audit:true,limit:48}).items[0]).length,2506);
        summary.push({case:"cooperative "+mode+" cleanup/reuse",metrics:context.metrics});
      }finally{r.close();}
    }
    // Open through sealed gate first; only then enable WAL on this disposable file.
    const wal=make("wal",2506),reader=new MaterialRepository(wal.file),writer=new DatabaseSync(wal.file);
    try {
      assert.equal(writer.prepare("PRAGMA journal_mode=WAL").get().journal_mode,"wal");
      const before=reader.listMaterials({audit:true,limit:48}),get=reader._adminReadChunk;let committed=false;
      reader._adminReadChunk=function(sql,params,tag,...args){const row=get.call(this,sql,params,tag,...args);if(tag==="count"&&!committed){
        writer.exec("BEGIN IMMEDIATE");writer.prepare("UPDATE materials SET name='Changed after count' WHERE material_id='R1-000'").run();
        writer.prepare("UPDATE material_property_evidence SET value_numeric=2 WHERE material_id='R1-000' AND property_key='density' AND position=2502").run();
        writer.prepare("UPDATE evidence_sources SET source_title='After source' WHERE source_id=1").run();writer.exec("COMMIT");committed=true;
      }return row;};
      assert.deepEqual(reader.listMaterials({audit:true,limit:48}),before,"Count/base/admission/all chunks/source use one WAL snapshot");
      assert.equal(committed,true);reader._adminReadChunk=get;
      const after=reader.listMaterials({audit:true,limit:48});assert.equal(after.items[0].name,"Changed after count");
      assert.equal(after.items[0].data_quality.level,"quarantined");assert.equal(after.items[0].evidence.properties.density[0].source.sourceTitle,"After source");
      assert.equal(reader.ad08Statements.size,0);summary.push({case:"WAL complete old/new snapshot",pass:true});
    } finally {reader.close();assert.equal(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,0);writer.close();}
  }
  async function budgetCases() {
    for(const field of ["name","summary","description_en"]) {
      const sample=make("huge-base-"+field,4,{mutate(db,ids){db.prepare("UPDATE materials SET "+field+"=? WHERE material_id=?").run("中".repeat(32768),ids[0]);}});
      const metrics=reject(sample.file,{limit:48,label:"base admission "+field},"rowRawBytes");
      assert.equal(metrics.deliveredRows,2,"Only count and scalar admission precede base rejection; huge field never enters a material row");
      assert.equal(metrics.retainedRows,0);
    }
    const huge=make("huge-property",4,{mutate(db,ids){db.prepare("UPDATE material_property_evidence SET test_condition=? WHERE material_id=?").run("中".repeat(32768),ids[0]);}});
    reject(huge.file,{limit:48,label:"property raw row admission"});
    const wide=make("wide-material",2506,{mutate(db,ids){db.prepare("UPDATE material_property_evidence SET test_condition=? WHERE material_id=?").run("中".repeat(500),ids[0]);}});
    reject(wide.file,{limit:48,label:"material raw admission"});
    const exactMaterial=make("material-rows-exact",5998,{mutate(db,ids){insert(db,"material_tags",{material_id:ids[0],position:0,tag:"one"});}});
    check(exactMaterial.file,{limit:48,label:"actual N_material exactly 12000"});
    const extraMaterial=new DatabaseSync(exactMaterial.file);try{insert(extraMaterial,"material_uses",{material_id:"R1-000",position:0,use:"one"});}finally{extraMaterial.close();}
    reject(exactMaterial.file,{limit:48,label:"actual N_material 12001"},"materialRows");
    const exactPage=make("page-rows-exact",3998,{size:2,high:[0,1],mutate(db,ids){for(const id of ids)insert(db,"material_tags",{material_id:id,position:0,tag:"one"});}});
    check(exactPage.file,{limit:48,label:"actual N_page exactly 16000"});
    const extraPage=new DatabaseSync(exactPage.file);try{insert(extraPage,"material_uses",{material_id:"R1-000",position:0,use:"one"});}finally{extraPage.close();}
    reject(exactPage.file,{limit:48,label:"actual N_page 16001"},"pageRows");
    const widePage=make("page-raw-budget",4,{size:200,high:Array.from({length:200},(_,i)=>i),mutate(db){db.prepare("UPDATE materials SET summary=?").run("x".repeat(22000));}});
    reject(widePage.file,{limit:200,label:"actual page raw bytes exceed 4MiB"},"pageRawBytes");
    // Equality is allowed for every approved numerical checker; +1 is typed K1.
    for(const [name,limit] of Object.entries(ADMIN_CAPACITY_LIMITS)) {
      if(typeof limit!=="number")continue;
      const context=new AdminCapacityContext({now:()=>0});
      assert.equal(context.check(name,limit),limit,name+" exact threshold");
      assert.throws(()=>context.check(name,limit+1),error=>error instanceof AdminCapacityError&&error.budget===name);
    }
    // Actual projection bytes: tune just one field to exactly the original SQL
    // raw-row boundary, then one byte above; do not merely test the checker.
    const boundary=make("row-exact-boundary",4),boundaryRepo=new MaterialRepository(boundary.file);
    let contract;
    try {contract=boundaryRepo._adminStreamContracts().get("material_sources");}finally{boundaryRepo.close();}
    const boundaryDb=new DatabaseSync(boundary.file);
    try {
      insert(boundaryDb,"material_sources",{material_id:"R1-000",source_title:"L",source_url:"https://example.invalid/l",source_type:"manufacturer",notes:""});
      const bytes=boundaryDb.prepare(contract.admission).get("R1-000").max_row;
      boundaryDb.prepare("UPDATE material_sources SET notes=?").run("x".repeat(32768-bytes));
      assert.equal(boundaryDb.prepare(contract.admission).get("R1-000").max_row,32768);
    }finally{boundaryDb.close();}
    check(boundary.file,{limit:48,label:"actual raw SQL row exactly 32KiB"});
    const increment=new DatabaseSync(boundary.file);try{increment.prepare("UPDATE material_sources SET notes=notes||'x'").run();}finally{increment.close();}
    reject(boundary.file,{limit:48,label:"actual raw SQL row 32KiB+1"});
    for(const metric of ["sqlAttempts","deliveredRows","logicalWork"]) {
      const repo=new MaterialRepository(initial.file);try {
        const context=new AdminCapacityContext({now:()=>0});context.metrics[metric]=ADMIN_CAPACITY_LIMITS[metric];
        assert.throws(()=>repo.listMaterials({audit:true,limit:48,adminCapacity:context}),error=>error instanceof AdminCapacityError&&error.budget===metric);
        assert.ok(context.metrics[metric]>ADMIN_CAPACITY_LIMITS[metric],"Attempt that crosses budget is counted");
        assert.equal(repo.ad08Statements.size,0);repo.database.exec("BEGIN");repo.database.exec("ROLLBACK");
        summary.push({case:metric+" cumulative work gate",metrics:context.metrics});
      }finally{repo.close();}
    }
    // A derived canonical object can be larger than its raw input. Fault
    // injection uses the real post-evaluator material/object guard, not a
    // replacement evaluator policy or test-specific budget.
    const small=make("object-limits",4,{size:3,high:[0,1,2]});
    for(const mode of ["materialObjectBytes","pageObjectBytes"]) {
      const repo=new MaterialRepository(small.file),attach=repo._attachAuditState;
      repo._attachAuditState=function(rows,items,...args){attach.call(this,rows,items,...args);
        for(const item of items){item.testOnlyPadding="";const before=jsonEncodedByteLength(item);
          const target=mode==="materialObjectBytes"?4*1048576+1:3*1048576;
          item.testOnlyPadding="x".repeat(target-before);assert.equal(jsonEncodedByteLength(item),target);}
      };
      const context=new AdminCapacityContext();try {
        assert.throws(()=>repo.listMaterials({audit:true,limit:48,adminCapacity:context}),error=>error instanceof AdminCapacityError&&error.budget===mode);
        assert.equal(repo.ad08Statements.size,0);repo._attachAuditState=attach;
        assert.equal(repo.listMaterials({audit:true,limit:48}).items.length,3);
        summary.push({case:mode+" real output guard",metrics:context.metrics});
      }finally{repo.close();}
    }
  }
}

const ARCHIVED_PILOT = {
  "preparationStatus": "first-pass prepared; final second-person approval pending",
  "preparer": "Codex data preparer / first-pass reviewer",
  "productionApproved": false,
  "materials": [
    {
      "manufacturer": "Covestro",
      "brand": "Makrolon",
      "commercialGrade": "Makrolon 2405",
      "materialFamily": "PC",
      "materialId": null,
      "officialTdsLinks": [],
      "identitySources": [
        {
          "sourceType": "manufacturer",
          "sourceTitle": "Makrolon® 2405 | Covestro",
          "sourceUrl": "https://solutions.covestro.com/en/products/makrolon/makrolon-2405_000000000000945088",
          "sourceDate": null,
          "verificationStatus": "verified",
          "confidenceLevel": "medium",
          "lastVerifiedAt": "2026-10-07",
          "notes": "Codex first-pass source transcription checked; second human reviewer pending. Not production-approved."
        }
      ],
      "properties": [
        {
          "propertyKey": "density",
          "measurements": [
            {
              "sourceType": "manufacturer",
              "sourceTitle": "Makrolon® 2405 | Covestro",
              "sourceUrl": "https://solutions.covestro.com/en/products/makrolon/makrolon-2405_000000000000945088",
              "sourceDate": null,
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 1.2,
              "unit": "g/cm3",
              "testStandard": "ISO 1183-1",
              "testCondition": "23 °C",
              "valueType": "typical",
              "transcriptionNote": "Official 1200 kg/m³; exact unit conversion /1000 = 1.2 g/cm3; no inferred measurement. Temperature from Other properties (23 °C) section heading."
            }
          ]
        },
        {
          "propertyKey": "tensile_strength",
          "measurements": [
            {
              "sourceType": "manufacturer",
              "sourceTitle": "Makrolon® 2405 | Covestro",
              "sourceUrl": "https://solutions.covestro.com/en/products/makrolon/makrolon-2405_000000000000945088",
              "sourceDate": null,
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 65,
              "unit": "MPa",
              "testStandard": "ISO 527-1/-2",
              "testCondition": "yield stress; 50 mm/min; 23 °C; 50% r.h.",
              "valueType": "typical",
              "transcriptionNote": "Source standard typography ISO 527-1,-2 normalized to ISO 527-1/-2; yield stress explicitly retained, not generic ultimate tensile strength."
            }
          ]
        },
        {
          "propertyKey": "hdt",
          "measurements": [
            {
              "sourceType": "manufacturer",
              "sourceTitle": "Makrolon® 2405 | Covestro",
              "sourceUrl": "https://solutions.covestro.com/en/products/makrolon/makrolon-2405_000000000000945088",
              "sourceDate": null,
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 124,
              "unit": "degC",
              "testStandard": "ISO 75-1/-2",
              "testCondition": "1.80 MPa",
              "valueType": "typical",
              "transcriptionNote": "Source standard typography ISO 75-1,-2 normalized to ISO 75-1/-2."
            },
            {
              "sourceType": "manufacturer",
              "sourceTitle": "Makrolon® 2405 | Covestro",
              "sourceUrl": "https://solutions.covestro.com/en/products/makrolon/makrolon-2405_000000000000945088",
              "sourceDate": null,
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 137,
              "unit": "degC",
              "testStandard": "ISO 75-1/-2",
              "testCondition": "0.45 MPa",
              "valueType": "typical",
              "transcriptionNote": "Source standard typography ISO 75-1,-2 normalized to ISO 75-1/-2."
            }
          ]
        }
      ],
      "certifications": []
    },
    {
      "manufacturer": "BASF SE",
      "brand": "Ultramid",
      "commercialGrade": "Ultramid A3K",
      "materialFamily": "PA66",
      "materialId": null,
      "officialTdsLinks": [
        "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf"
      ],
      "identitySources": [
        {
          "sourceType": "official_datasheet",
          "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
          "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
          "sourceDate": "2026-02",
          "verificationStatus": "verified",
          "confidenceLevel": "medium",
          "lastVerifiedAt": "2026-10-07",
          "notes": "Codex first-pass source transcription checked; second human reviewer pending. Not production-approved."
        }
      ],
      "properties": [
        {
          "propertyKey": "density",
          "measurements": [
            {
              "sourceType": "official_datasheet",
              "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
              "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
              "sourceDate": "2026-02",
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 1.13,
              "unit": "g/cm3",
              "testStandard": "ISO 1183",
              "testCondition": "23 °C; uncoloured product",
              "valueType": "typical",
              "transcriptionNote": "Official 1130 kg/m³; exact unit conversion /1000 = 1.13 g/cm3."
            }
          ]
        },
        {
          "propertyKey": "tensile_strength",
          "measurements": [
            {
              "sourceType": "official_datasheet",
              "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
              "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
              "sourceDate": "2026-02",
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 85,
              "unit": "MPa",
              "testStandard": "ISO 527-1/-2",
              "testCondition": "yield stress; dry; 50 mm/min; 23 °C; uncoloured product",
              "valueType": "typical"
            },
            {
              "sourceType": "official_datasheet",
              "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
              "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
              "sourceDate": "2026-02",
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 50,
              "unit": "MPa",
              "testStandard": "ISO 527-1/-2",
              "testCondition": "yield stress; conditioned; 50 mm/min; 23 °C; uncoloured product",
              "valueType": "typical"
            }
          ]
        },
        {
          "propertyKey": "hdt",
          "measurements": [
            {
              "sourceType": "official_datasheet",
              "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
              "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
              "sourceDate": "2026-02",
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 75,
              "unit": "degC",
              "testStandard": "ISO 75-1/-2",
              "testCondition": "1.8 MPa; uncoloured product",
              "valueType": "typical"
            },
            {
              "sourceType": "official_datasheet",
              "sourceTitle": "Ultramid® A3K - Product Information (02/2026)",
              "sourceUrl": "https://download.basf.com/p1/8a8082587fd4b608017fd64108ab6d3b/en/ULTRAMID%3Csup%3E%C2%AE%3Csup%3E_A3K_Product_Data_Sheet_Asia_PacificEurope_English.pdf",
              "sourceDate": "2026-02",
              "verificationStatus": "verified",
              "confidenceLevel": "medium",
              "lastVerifiedAt": "2026-10-07",
              "value": 220,
              "unit": "degC",
              "testStandard": "ISO 75-1/-2",
              "testCondition": "0.45 MPa; uncoloured product",
              "valueType": "typical"
            }
          ]
        }
      ],
      "certifications": []
    }
  ]
};
if (process.argv.includes("--fa004-r1-only")) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"matfinder-fa004-r1-regression-"));
  try { await adminR1CapacityCases(directory); }
  finally {
    const relative=path.relative(os.tmpdir(),directory);
    if(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(directory).startsWith("matfinder-fa004-r1-regression-"))
      fs.rmSync(directory,{recursive:true,force:true});
  }
} else await main();

}
