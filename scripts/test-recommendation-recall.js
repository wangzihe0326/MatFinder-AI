const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;
const root = path.resolve(__dirname, "..");
const privateMarker = "PRIVATE_SQL_PATH_STACK_AD05";
const failureBody = '{"error":"Recommendation candidate recall failed"}';
const invalidBody = '{"error":"Invalid recommendation candidate query"}';
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "public/recommendation-engine.js"), "utf8"), context);
const engine = context.window.MatFinderAI;
const strengthQuery = "tensile strength at least 50 MPa";
let wholeTestCompleted = false;
let wholeTestTimedOut = false;
let wholeTestFailureRecorded = false;
let wholeTestFailure;
const wholeTestServers = new Set();
let wholeTestFixtureCleanup;

if (process.argv.includes("--probe-server")) {
  const exists = fs.existsSync;
  fs.existsSync = function (file) {
    if (typeof file === "string" && [".env", ".env.local"].includes(path.basename(file))) return false;
    return exists.apply(this, arguments);
  };
  // The independent AD-02 suite exercises rate limiting. Isolate this matrix.
  const protection = require("../api-protection");
  const create = protection.createApiProtection;
  protection.createApiProtection = (options) => ({ ...create(options), publicGet: () => 0 });
  const hydrate = MaterialRepository.prototype._hydrateDetailedRows;
  let batches = 0;
  MaterialRepository.prototype._hydrateDetailedRows = function (rows) {
    batches += 1;
    if (process.argv.includes("--fail-hydration") && batches === 2) throw new Error(privateMarker);
    const result = hydrate.call(this, rows);
    if (process.argv.includes("--fail-projection") && batches === 2) result[0].data_quality.issues = null;
    return result;
  };
  if (process.argv.includes("--fail-enumeration") || process.argv.includes("--fail-snapshot")) {
    const recall = MaterialRepository.prototype.getRecommendationCandidates;
    let injected = false;
    MaterialRepository.prototype.getRecommendationCandidates = function () {
      if (injected) return recall.call(this);
      injected = true;
      const database = this.database;
      const method = process.argv.includes("--fail-enumeration") ? "prepare" : "exec";
      const original = database[method];
      database[method] = function (sql, ...args) {
        if ((method === "exec" && sql === "BEGIN") ||
            (method === "prepare" && sql.includes("SELECT m.material_id"))) throw new Error(privateMarker);
        return original.call(this, sql, ...args);
      };
      try { return recall.call(this); } finally { database[method] = original; }
    };
  }
  if (process.argv.includes("--gc-regression")) installGcProbe();
  require("../server");
} else {
  runWholeRecallTest().catch((error) => { console.error(error); process.exitCode = 1; });
}

function rememberWholeTestFailure(error) {
  if (!wholeTestFailureRecorded) {
    wholeTestFailureRecorded = true;
    wholeTestFailure = error;
  }
  return wholeTestFailure;
}

function throwIfWholeTestTimedOut() {
  if (wholeTestTimedOut) throw wholeTestFailure;
}

async function runWholeRecallTest() {
  let operationSettled = false;
  let watchdog;
  let emergencyStop;
  const timeoutError = new Error("Whole recall test watchdog: main did not finish within 60 seconds; wholeTestCompleted=false");
  function clearEmergencyWhenFinished() {
    if (operationSettled && [...wholeTestServers].every((resources) => resources.idle())) clearTimeout(emergencyStop);
  }
  // Test infrastructure only. Leave headroom above F3-C's 10s guard + 4s cleanup.
  const timeout = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      wholeTestTimedOut = true;
      process.exitCode = 1;
      const failure = rememberWholeTestFailure(timeoutError);
      reject(failure);
      emergencyStop = setTimeout(() => {
        console.error(wholeTestFailure);
        console.error("Whole recall timeout cleanup grace expired; wholeTestCompleted=" + wholeTestCompleted);
        for (const resources of wholeTestServers) {
          try { resources.forceStop(); } catch (error) { console.error("Whole recall emergency cleanup:", error); }
        }
        process.exit(1);
      }, 4000);
    }, 60_000);
  });
  const operation = (async () => {
    try {
      await main(); // Includes every regression and main's final fixture cleanup.
      throwIfWholeTestTimedOut();
      assert.equal(wholeTestTimedOut, false, "The whole recall lifecycle must finish before timeout.");
      assert.equal(wholeTestServers.size, 0, "Every test server must be stopped before completion.");
      wholeTestCompleted = true;
      assert.equal(wholeTestCompleted, true, "Every recall assertion and cleanup must complete.");
    } catch (error) { throw rememberWholeTestFailure(error); }
    finally {
      operationSettled = true;
      if (wholeTestTimedOut) clearEmergencyWhenFinished();
    }
  })();
  try {
    await Promise.race([operation, timeout]);
    console.log("AD-05 recommendation recall regressions passed: historical 201, application-owned statement lifetime/GC and rollback, boundary/legacy, E/L/Q, projection parity, query rejection, four injected failures, row guard, snapshot, empty/singleton universe, inferior insertion invariance, complete 201 detailed oracle, independent quarantine conditions, bounded hydration/startup.");
    console.log("Whole recall TEST COMPLETED: wholeTestCompleted=true; wholeTestTimedOut=false.");
  } catch (error) {
    const failure = rememberWholeTestFailure(error);
    if (wholeTestTimedOut) {
      await Promise.allSettled([...wholeTestServers].map((resources) => resources.cleanup()));
      try { await wholeTestFixtureCleanup?.(); }
      catch (cleanupError) { console.error("Whole recall timeout fixture cleanup:", cleanupError); }
    }
    throw failure;
  } finally {
    clearTimeout(watchdog);
    if (!wholeTestTimedOut) clearTimeout(emergencyStop);
    else clearEmergencyWhenFinished();
  }
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad05-recall-"));
  const databasePath = path.join(directory, "recall.db");
  let fixtureCleaning;
  wholeTestFixtureCleanup = () => {
    if (!fixtureCleaning) fixtureCleaning = Promise.resolve().then(() => {
      if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("matfinder-ad05-recall-"))
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return fixtureCleaning;
  };
  try {
    createSchema(databasePath);
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec("BEGIN");
      for (let index = 0; index < 200; index += 1) addMaterial(writer, "A" + String(index).padStart(3, "0"));
      addMaterial(writer, "Z999-BEST", { tensile: 80 });
      writer.exec("COMMIT");
    } finally { writer.close(); }
    await historicalChecks(databasePath);
    await fullDetailedOracleChecks(databasePath);
    for (const [name, check] of [
      ["singleton", singletonChecks], ["invariance", poorCandidateInvarianceChecks],
      ["independent-quarantine", independentQuarantineChecks]
    ]) {
      const fixturePath = path.join(directory, name + ".db");
      createSchema(fixturePath);
      await check(fixturePath);
    }
    await gcChecks(databasePath);
    for (const mode of ["--fail-hydration", "--fail-projection", "--fail-enumeration", "--fail-snapshot"]) {
      await withServer(databasePath, async (server) => {
        const failed = await request(server);
        assert.equal(failed.status, 500, mode);
        assert.equal(failed.body, failureBody, mode);
        assert.equal(failed.headers.get("cache-control"), "no-store");
        assert.ok(!failed.body.includes(privateMarker));
        assert.ok(!("items" in failed.json) && !("complete" in failed.json));
        // The cursor and failed read transaction must not poison the connection.
        const recovered = await request(server);
        assert.equal(recovered.status, 200, mode);
        assertEnvelope(recovered.json, 201, 201, 0);
      }, mode);
    }
    const reportPath = path.join(directory, "report.db");
    createSchema(reportPath);
    reportCompatibilityChecks(reportPath);
    snapshotChecks(databasePath);
    const mixedPath = path.join(directory, "mixed.db");
    createSchema(mixedPath);
    await boundaryAndParityChecks(mixedPath);
    const emptyPath = path.join(directory, "empty.db");
    createSchema(emptyPath);
    await withServer(emptyPath, async (server) => {
      const response = await request(server);
      assert.equal(response.status, 200);
      assertEnvelope(response.json, 0, 0, 0);
    });
    const guardPath = path.join(directory, "row-guard.db");
    createSchema(guardPath);
    const guardWriter = new DatabaseSync(guardPath);
    try {
      guardWriter.exec("BEGIN");
      for (let index = 0; index < 30; index += 1) {
        const id = "GUARD" + index;
        addMaterial(guardWriter, id);
        for (let claim = 1; claim <= 34; claim += 1)
          addProperty(guardWriter, id, "tensile_strength", 40, { position: claim });
      }
      guardWriter.exec("COMMIT");
    } finally { guardWriter.close(); }
    await withServer(guardPath, async (server) => {
      const response = await request(server);
      assert.equal(response.status, 500);
      assert.equal(response.body, failureBody, "The existing row guard must fail closed.");
    });
  } catch (error) { throw rememberWholeTestFailure(error); }
  finally {
    await wholeTestFixtureCleanup();
    wholeTestFixtureCleanup = undefined;
  }
}

function createSchema(file) {
  require("./schema-test-fixtures").bootstrapFixture(file);
}

function insert(database, table, row) {
  const keys = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

function addMaterial(database, id, options = {}) {
  insert(database, "materials", {
    material_id: id, name: id, name_en: "English " + id, name_zh: "Chinese " + id,
    abbreviation: "PC", category: "Plastics", category_en: "Plastics", category_zh: "Plastics",
    record_type: "commercial_grade", record_origin: options.origin || "imported",
    scope_status: options.scope || "in_scope", catalog_visibility: options.visibility || "public",
    applications: '[]', applications_en: '["housing"]', applications_zh: '["fixture use"]',
    limitations: '[]', alternatives: '[]', typical_applications: '[]', advantages: '[]',
    disadvantages: '[]', tags_en: '[]', tags_zh: '[]', translation_quality: "partial",
    translation_status: "partial", processing_methods: '[]', summary: "Recommendation summary",
    description_en: "Current English card text", description_zh: "Current Chinese card text",
    notes: "DETAIL_ONLY_NOT_IN_COMPACT", source_note: "IMPORT_ONLY_NOT_IN_COMPACT",
    continuous_use_temperature: 110
  });
  if (options.identity !== false) insert(database, "real_material_identities", {
    material_id: id, manufacturer: "AD05 Fixture", commercial_grade: id, material_family: "PC",
    manufacturer_key: "ad05-fixture", commercial_grade_key: id.toLowerCase(), material_family_key: "pc",
    created_at: "2026-01-01", active: options.active ?? 1
  });
  insert(database, "material_evidence", {
    material_id: id, manufacturer: "AD05 Fixture", commercial_grade: id, material_family: "PC",
    source_type: options.identityGenerated ? "generated" : "manufacturer",
    source_title: "AD05 identity fixture", source_url: "https://example.invalid/ad05/identity",
    verification_status: options.identityQuarantine ? "quarantined" : "verified",
    confidence_level: options.identityQuarantine ? "quarantined" : "high"
  });
  // Low fixtures still have a real confirmed identity, but no property evidence.
  if (options.quality === "low") return;
  const medium = options.quality === "medium";
  const sourceOptions = medium ? { sourceType: "distributor", verification: "partially_verified", confidence: "medium" } : {};
  addProperty(database, id, "density", 1.2, { unit: "g/cm3", ...sourceOptions });
  addProperty(database, id, "tensile_strength", options.tensile ?? 40, sourceOptions);
  if (!medium) {
    addProperty(database, id, "hdt", 125, { unit: "degC" });
    addProperty(database, id, "continuous_use_temperature", 110, { unit: "degC" });
  }
  if (options.propertyQuarantine) addProperty(database, id, "impact_strength", 10, { verification: "quarantined", confidence: "quarantined" });
  if (options.propertyGenerated) addProperty(database, id, "impact_strength", 10, { sourceType: "generated" });
}

function addProperty(database, id, key, value, options = {}) {
  insert(database, "material_property_evidence", {
    material_id: id, property_key: key, position: options.position ?? 0,
    value_numeric: typeof value === "number" ? value : null, value_text: typeof value === "string" ? value : null,
    unit: options.unit || "MPa", test_standard: options.standard || "ASTM D638",
    test_condition: options.condition || "23 C", value_type: options.valueType || "typical",
    manufacturer: "AD05 Fixture", commercial_grade: id, material_family: "PC",
    source_type: options.sourceType || "manufacturer", source_title: "AD05 property fixture",
    source_url: "https://example.invalid/ad05/" + key, source_date: "2026-01-01",
    verification_status: options.verification || "verified", confidence_level: options.confidence || "high",
    conflict_status: options.conflict || "none"
  });
}

function installGcProbe() {
  assert.equal(typeof global.gc, "function", "The dedicated probe requires --expose-gc.");
  const { queryObjects } = require("node:v8");
  // The native iterator may retain the inner statement on newer Node versions.
  // It never retains this test-owned wrapper, so its survival proves that the
  // application holds the prepare() result independently of native behavior.
  class EnumerationStatement {
    constructor(statement) { this.statement = statement; }
    iterate() { return monitorIterator(this.statement.iterate()); }
  }
  function checkLifetime() {
    const pressure = Array.from({ length: 4096 }, (_, index) => ({ index, value: "gc-" + index }));
    global.gc();
    assert.equal(queryObjects(EnumerationStatement, { format: "count" }), 1,
      "Application must retain the enumeration statement through GC and cleanup.");
    assert.equal(pressure.length, 4096);
  }
  let injected = false;
  function monitorIterator(iterator) {
    let rows = 0;
    return {
      [Symbol.iterator]() { return this; },
      next() {
        if (rows === 1) checkLifetime(); // Cursor started; enumeration not complete.
        if (rows === 35 && !injected && process.argv.includes("--fail-iterator")) {
          injected = true;
          throw new Error(privateMarker);
        }
        rows += 1;
        return iterator.next();
      },
      return() { checkLifetime(); return iterator.return(); }
    };
  }
  // A control confirms the wrapper itself is collectible when only its iterator
  // remains. Use a JS iterator here, avoiding the unsafe old native lifetime.
  const unowned = new EnumerationStatement({ iterate: () => [1][Symbol.iterator]() }).iterate();
  assert.equal(queryObjects(EnumerationStatement, { format: "count" }), 0,
    "The GC probe must detect the old inline prepare().iterate() ownership pattern.");
  assert.equal(typeof unowned.next, "function");

  const recall = MaterialRepository.prototype.getRecommendationCandidates;
  MaterialRepository.prototype.getRecommendationCandidates = function () {
    const database = this.database;
    const prepare = database.prepare;
    const exec = database.exec;
    const hydrate = this._hydrateDetailedRows;
    database.prepare = function (sql, ...args) {
      const statement = prepare.call(this, sql, ...args);
      return sql.includes("SELECT m.material_id") ? new EnumerationStatement(statement) : statement;
    };
    database.exec = function (sql, ...args) {
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        checkLifetime();
        try {
          if (sql === "COMMIT" && !injected && process.argv.includes("--fail-commit")) {
            injected = true;
            throw new Error(privateMarker);
          }
          return exec.call(this, sql, ...args);
        } finally { checkLifetime(); }
      }
      return exec.call(this, sql, ...args);
    };
    this._hydrateDetailedRows = function (rows) {
      checkLifetime(); // Includes the second and later hydration/projection batches.
      return hydrate.call(this, rows);
    };
    try { return recall.call(this); } finally {
      database.prepare = prepare;
      database.exec = exec;
      this._hydrateDetailedRows = hydrate;
      assert.equal(queryObjects(EnumerationStatement, { format: "count" }), 0,
        "Release the statement owner after transaction cleanup.");
    }
  };
}

async function gcChecks(databasePath) {
  for (const mode of [undefined, "--fail-iterator", "--fail-hydration", "--fail-projection", "--fail-commit"]) {
    await withServer(databasePath, async (server) => {
      if (mode) {
        const failed = await request(server);
        assert.equal(failed.status, 500, mode);
        assert.equal(failed.body, failureBody, mode);
        assert.ok(!("items" in failed.json) && !("complete" in failed.json));
      }
      const response = await request(server);
      assert.equal(response.status, 200, "GC regression: " + (mode || "normal exhaustion"));
      assertEnvelope(response.json, 201, 201, 0);
      assert.deepEqual(response.json.items.map((item) => item.id), [
        ...Array.from({ length: 200 }, (_, index) => "A" + String(index).padStart(3, "0")), "Z999-BEST"
      ]);
      const result = await recommend(response.json.items, strengthQuery);
      assert.equal(result.groups.verifiedMatches[0].material.id, "Z999-BEST");
      const diagnostic = await diagnostics(server.child);
      assert.equal(diagnostic.repository.maximumRecommendationBatchSize, 30);
      assert.ok(diagnostic.repository.recommendationBatches >= 7);
    }, mode, true);
  }
  console.log("GC statement ownership passed: 201 unique candidates, seven batches, historical winner, normal exhaustion, iterator/hydration/projection failures and COMMIT failure/ROLLBACK.");
}

async function historicalChecks(databasePath) {
  const repository = new MaterialRepository(databasePath);
  try {
    assert.equal(repository.getMetrics().recommendationRecallCalls, 0);
    assert.throws(() => repository.database.exec("DELETE FROM materials"), /readonly|read.only/i);
    const hydrate = repository._hydrateDetailedRows;
    let maximumHydratedBatch = 0;
    repository._hydrateDetailedRows = function (rows) {
      maximumHydratedBatch = Math.max(maximumHydratedBatch, rows.length);
      return hydrate.call(this, rows);
    };
    const started = performance.now();
    const items = repository.getRecommendationCandidates();
    assert.equal(items.length, 201);
    assert.deepEqual(items.map((item) => item.id), [
      ...Array.from({ length: 200 }, (_, index) => "A" + String(index).padStart(3, "0")), "Z999-BEST"
    ]);
    assert.equal(repository.getMetrics().recommendationBatches, 7);
    assert.equal(maximumHydratedBatch, 30);
    assert.equal(repository.getMetrics().maximumRecommendationBatchSize, 30);
    assert.equal(repository.getMetrics().fullEvidenceTableReads, 0);
    assert.ok(repository.getMetrics().maximumRowsInSingleQuery <= 1000);
    console.log(JSON.stringify({ fixtureCandidates: 201, recallMs: Math.round(performance.now() - started), compactBytes: Buffer.byteLength(JSON.stringify(items)), maximumHydratedBatch }));
  } finally { repository.close(); }
  await withServer(databasePath, async (server) => {
    const startup = await diagnostics(server.child);
    assert.equal(startup.repository.recommendationRecallCalls, 0);
    assert.equal(startup.repository.propertyEvidenceRowsRead, 0);
    const canonical = await request(server);
    assert.equal(canonical.status, 200);
    assertEnvelope(canonical.json, 201, 201, 0);
    const limited = await recommend(canonical.json.items.slice(0, 200), strengthQuery);
    assert.equal(limited.status, "no_safe_match", "Reproduce the old 200-row defect.");
    const complete = await recommend(canonical.json.items, strengthQuery);
    assert.equal(complete.status, "verified_matches");
    assert.equal(complete.groups.verifiedMatches[0].material.id, "Z999-BEST");
    assert.equal(complete.groups.verifiedMatches[0].score, 100);
    const bare = await request(server, "/api/recommendation-candidates?");
    assert.equal(bare.status, 200);
    assert.deepEqual(bare.json, canonical.json);
    const beforeInvalid = await diagnostics(server.child);
    for (const query of ["limit=200", "limit=1", "limit=1.5", "offset=0", "q=test", "unknown=x", "limit=1&limit=200", "limit=%ZZ", "=", "q", "q=%00", "q=bad%FF", "audit=1", "%6cimit=200", "unknown=x&unknown=y"]) {
      const response = await request(server, "/api/recommendation-candidates?" + query);
      assert.equal(response.status, 400, query);
      assert.equal(response.body, invalidBody, query);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const afterInvalid = await diagnostics(server.child);
    assert.equal(afterInvalid.repository.recommendationRecallCalls, beforeInvalid.repository.recommendationRecallCalls);
    assert.equal(afterInvalid.repository.recommendationRecallCalls, 2);
    assert.equal(afterInvalid.repository.maximumRecommendationBatchSize, 30);
  });
}

async function singletonChecks(databasePath) {
  const writer = new DatabaseSync(databasePath);
  try { addMaterial(writer, "SINGLE-VALID", { tensile: 80 }); } finally { writer.close(); }
  await withServer(databasePath, async (server) => {
    const response = await request(server);
    assert.equal(response.status, 200);
    assertEnvelope(response.json, 1, 1, 0);
    const candidate = response.json.items[0];
    assert.equal(candidate.id, "SINGLE-VALID");
    assert.equal(response.json.eligibleTotal, Number(candidate.data_quality.recommendation_eligible));
    assert.equal(response.json.referenceTotal, Number(candidate.data_quality.reference_only));
    const result = await recommend(response.json.items, strengthQuery);
    assert.equal(result.status, "verified_matches");
    assert.deepEqual(Array.from(result.groups.verifiedMatches, (entry) => entry.material.id), ["SINGLE-VALID"]);
    assert.equal(result.groups.verifiedMatches[0].score, 100);
  });
  console.log("F3-A singleton passed: complete one-candidate endpoint, runtime counts and existing engine verified winner.");
}

async function poorCandidateInvarianceChecks(databasePath) {
  const winnerId = "M500-WINNER";
  const baseIds = [winnerId, "Z900-BASE-POOR", "A000-BASE-REFERENCE"];
  const writer = new DatabaseSync(databasePath);
  try {
    addMaterial(writer, winnerId, { tensile: 80 });
    addMaterial(writer, baseIds[1], { tensile: 40 });
    addMaterial(writer, baseIds[2], { quality: "low" });
  } finally { writer.close(); }
  await withServer(databasePath, async (server) => {
    const base = await request(server);
    assert.equal(base.status, 200);
    assertEnvelope(base.json, 3, 2, 1);
    const baseline = await recommend(base.json.items, strengthQuery);
    assert.equal(baseline.status, "verified_matches");
    assert.equal(baseline.groups.verifiedMatches[0].material.id, winnerId);
    const expectedWinner = semanticResult(baseline).groups.verifiedMatches[0];
    const beforePosition = base.json.items.findIndex((item) => item.id === winnerId);
    const poor = [
      ...Array.from({ length: 201 }, (_, index) => ["A100-POOR-" + String(index).padStart(3, "0"), { tensile: 40 }]),
      ...Array.from({ length: 5 }, (_, index) => ["0M-MEDIUM-" + index, { quality: "medium", tensile: 20 }]),
      ...Array.from({ length: 3 }, (_, index) => ["0L-REFERENCE-" + index, { quality: "low" }]),
      ["Z999-AFTER-WINNER", { tensile: 30 }]
    ];
    const mutationWriter = new DatabaseSync(databasePath);
    try {
      mutationWriter.exec("BEGIN");
      // Reverse physical insertion, while IDs straddle the winner and quality groups.
      for (const [id, options] of [...poor].reverse()) addMaterial(mutationWriter, id, options);
      mutationWriter.exec("COMMIT");
    } finally { mutationWriter.close(); }
    const mutated = await request(server);
    assert.equal(mutated.status, 200);
    assert.ok(mutated.json.items.some((item) => item.id === winnerId),
      "F3-B: inferior insertion must not lose the winner to an arbitrary recall window.");
    assertEnvelope(mutated.json, baseIds.length + poor.length, 209, 4);
    for (const id of [...baseIds, ...poor.map(([id]) => id)])
      assert.ok(mutated.json.items.some((item) => item.id === id), "Full mutated universe: " + id);
    const afterPosition = mutated.json.items.findIndex((item) => item.id === winnerId);
    assert.ok(afterPosition > beforePosition, "Inserted high-quality inferior IDs move enumeration before the winner.");
    assert.ok(mutated.json.items.findIndex((item) => item.id === "0M-MEDIUM-0") > afterPosition,
      "Quality ordering overrides lexical ID order for the inserted medium candidate.");
    const result = await recommend(mutated.json.items, strengthQuery);
    assert.equal(result.status, baseline.status);
    assert.deepEqual(Array.from(result.groups.verifiedMatches, (entry) => entry.material.id), [winnerId]);
    const actualWinner = semanticResult(result).groups.verifiedMatches[0];
    assert.deepEqual(actualWinner, expectedWinner,
      "F3-B: winner group, score, reasons, warnings and selected requirement evidence must be invariant.");
    assert.equal(result.groups.potentialMatches.some((entry) => entry.material.id === winnerId), false);
    assert.equal(result.groups.rejectedMaterials.some((entry) => entry.material.id === winnerId), false);
  });
  console.log("F3-B insertion invariance passed: BASE 3 to MUTATED 213, inferior IDs/quality positions reordered, identical winner semantics.");
}

async function fullDetailedOracleChecks(databasePath) {
  let completed = false;
  let timedOut = false;
  let operationSettled = false;
  let hasFailure = false;
  let primaryFailure;
  let watchdog;
  let emergencyStop;
  let serverResources;
  const controller = new AbortController();
  const timeoutError = new Error(
    "F3-C whole-lifecycle watchdog: oracle did not finish within 10 seconds; completed=false"
  );
  function rememberFailure(error) {
    if (!hasFailure) { hasFailure = true; primaryFailure = error; }
    return primaryFailure;
  }
  function clearEmergencyWhenFinished() {
    if (operationSettled && (!serverResources || serverResources.idle())) clearTimeout(emergencyStop);
  }
  // Test completion guard only; this is not a production latency contract.
  const timeout = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      timedOut = true;
      process.exitCode = 1;
      const failure = rememberFailure(timeoutError);
      controller.abort(failure);
      reject(failure);
      // Only a timed-out test may hard-stop, after a bounded cleanup grace period.
      emergencyStop = setTimeout(() => {
        console.error(primaryFailure);
        console.error("F3-C timeout cleanup grace expired; completed=" + completed);
        try { serverResources?.forceStop(); } catch (error) { console.error("F3-C emergency cleanup:", error); }
        process.exit(1);
      }, 4000);
    }, 10_000);
  });
  const operation = (async () => {
    try {
      const repository = new MaterialRepository(databasePath);
      let detailed;
      try {
        // Read the fixture's entire material universe independently of compact projection.
        const ids = repository.database.prepare("SELECT material_id FROM materials ORDER BY material_id").all()
          .map((row) => row.material_id);
        assert.equal(ids.length, 201);
        detailed = ids.map((id) => repository.getMaterialById(id));
        assert.ok(detailed.every(Boolean));
      } catch (error) { throw rememberFailure(error); }
      finally { repository.close(); }
      const expected = await recommend(detailed, strengthQuery);
      controller.signal.throwIfAborted();
      await withServer(databasePath, async (server) => {
        const response = await request(server);
        controller.signal.throwIfAborted();
        assert.equal(response.status, 200);
        assertEnvelope(response.json, 201, 201, 0);
        assert.deepEqual(response.json.items.map((item) => item.id).sort(), detailed.map((item) => item.id).sort());
        const actual = await recommend(response.json.items, strengthQuery);
        controller.signal.throwIfAborted();
        assert.deepEqual(semanticResult(actual), semanticResult(expected),
          "F3-C: complete compact/detailed evidence semantics must match.");
        assert.equal(actual.status, "verified_matches");
        assert.equal(actual.groups.verifiedMatches[0].material.id, "Z999-BEST");
        assert.equal(actual.groups.verifiedMatches[0].score, 100);
        assert.ok(actual.groups.verifiedMatches[0].requirementResults[0].evidenceSource);
      }, undefined, false, {
        signal: controller.signal,
        recordFailure: rememberFailure,
        register: (resources) => { serverResources = resources; }
      });
      if (timedOut) throw rememberFailure(timeoutError);
      assert.equal(timedOut, false, "F3-C must finish its entire lifecycle before timeout.");
      completed = true;
      assert.equal(completed, true, "F3-C detailed evaluation, compact evaluation and semantic assertions must complete.");
    } catch (error) { throw rememberFailure(error); }
    finally {
      operationSettled = true;
      if (timedOut) clearEmergencyWhenFinished();
    }
  })();
  try {
    // Startup, evaluations, semantic assertions, cleanup and completion share one guard.
    await Promise.race([operation, timeout]);
    console.log("F3-C detailed oracle passed: same 201 IDs, full semantic status/groups/order/winner/reasons/warnings/requirement evidence parity.");
  } catch (error) {
    const failure = rememberFailure(error);
    if (timedOut && serverResources) {
      try { await serverResources.cleanup(); }
      catch (cleanupError) { console.error("F3-C timeout cleanup:", cleanupError); }
    }
    throw failure;
  } finally {
    clearTimeout(watchdog);
    if (!timedOut) clearTimeout(emergencyStop);
    else clearEmergencyWhenFinished();
  }
}

async function independentQuarantineChecks(databasePath) {
  const cases = [
    ["identity-verification-only", "material_evidence", "verification_status", "quarantined", "identity.verification_status"],
    ["identity-confidence-only", "material_evidence", "confidence_level", "quarantined", "identity.confidence_level"],
    ["property-verification-only", "material_property_evidence", "verification_status", "quarantined", "property.verification_status"],
    ["property-confidence-only", "material_property_evidence", "confidence_level", "quarantined", "property.confidence_level"],
    ["identity-generated-only", "material_evidence", "source_type", "generated", "identity.source_type"],
    ["property-generated-only", "material_property_evidence", "source_type", "generated", "property.source_type"],
    ["origin-generated-only", "materials", "record_origin", "generated", "material.record_origin"]
  ];
  const writer = new DatabaseSync(databasePath);
  try {
    writer.exec("BEGIN");
    for (const [id, table, field, value] of cases) {
      addMaterial(writer, id, { tensile: 80 });
      const propertyOnly = table === "material_property_evidence" ? " AND property_key='tensile_strength'" : "";
      writer.prepare("UPDATE " + table + " SET " + field + "=? WHERE material_id=?" + propertyOnly).run(value, id);
    }
    addMaterial(writer, "PUBLIC-CONTROL", { tensile: 80 });
    addMaterial(writer, "RUNTIME-CONFLICT", { tensile: 80 });
    // A single explicit conflict flag is NOT a PUBLIC_BOUNDARY exclusion.
    writer.prepare("UPDATE material_property_evidence SET conflict_status='conflicting' WHERE material_id=? AND property_key='tensile_strength'")
      .run("RUNTIME-CONFLICT");
    writer.exec("COMMIT");
    for (const [id, , , , target] of [...cases, ["PUBLIC-CONTROL"], ["RUNTIME-CONFLICT"]]) {
      const material = writer.prepare("SELECT * FROM materials WHERE material_id=?").get(id);
      assert.equal(material.record_type, "commercial_grade");
      assert.equal(material.catalog_visibility, "public");
      assert.equal(material.scope_status, "in_scope");
      assert.equal(writer.prepare("SELECT active FROM real_material_identities WHERE material_id=?").get(id).active, 1);
      const triggers = material.record_origin === "generated" ? ["material.record_origin"] : [];
      for (const [table, label] of [["material_evidence", "identity"], ["material_property_evidence", "property"]]) {
        const rows = writer.prepare("SELECT source_type, verification_status, confidence_level FROM " + table + " WHERE material_id=?").all(id);
        assert.equal(rows.length, label === "identity" ? 1 : 4);
        for (const row of rows) {
          for (const [field, blocked, normal] of [
            ["source_type", "generated", "manufacturer"],
            ["verification_status", "quarantined", "verified"],
            ["confidence_level", "quarantined", "high"]
          ]) {
            if (row[field] === blocked) triggers.push(label + "." + field);
            else assert.equal(row[field], normal);
          }
        }
      }
      assert.deepEqual(triggers, target ? [target] : [], "Only the intended PUBLIC_BOUNDARY trigger: " + id);
    }
  } finally { writer.close(); }
  await withServer(databasePath, async (server) => {
    const response = await request(server);
    assert.equal(response.status, 200);
    for (const [id] of cases) assert.equal(response.json.items.some((item) => item.id === id), false,
      "F4 " + id + ": PUBLIC_BOUNDARY must independently exclude this material.");
    assertEnvelope(response.json, 2, 1, 0);
    assert.deepEqual(response.json.items.map((item) => item.id).sort(), ["PUBLIC-CONTROL", "RUNTIME-CONFLICT"]);
    const runtime = response.json.items.find((item) => item.id === "RUNTIME-CONFLICT");
    assert.equal(runtime.data_quality.level, "quarantined");
    assert.equal(runtime.data_quality.recommendation_eligible, false);
    assert.equal(runtime.data_quality.reference_only, false);
    const result = await recommend(response.json.items, strengthQuery);
    assert.deepEqual(Array.from(result.groups.verifiedMatches, (entry) => entry.material.id), ["PUBLIC-CONTROL"]);
    assert.deepEqual(Array.from(result.groups.rejectedMaterials, (entry) => entry.material.id), ["RUNTIME-CONFLICT"]);
  });
  console.log("F4 independent quarantine passed: four separate status/confidence exclusions, two generated-source exclusions, generated origin and distinct included runtime conflict Q.");
}

function snapshotChecks(databasePath) {
  // Cross the formal sealed-v1 gate first. The disposable writer then switches
  // journal mode solely to exercise the existing concurrent snapshot assertions.
  const repository = new MaterialRepository(databasePath);
  const writer = new DatabaseSync(databasePath);
  writer.exec("PRAGMA journal_mode = WAL");
  const hydrate = repository._hydrateDetailedRows;
  let changed = false;
  repository._hydrateDetailedRows = function (rows) {
    const result = hydrate.call(this, rows);
    if (!changed) {
      changed = true;
      writer.exec("BEGIN");
      addMaterial(writer, "Z998-ADDED", { tensile: 90 });
      writer.prepare("UPDATE material_property_evidence SET value_numeric=80 WHERE material_id='A199' AND property_key='tensile_strength'").run();
      writer.exec("COMMIT");
    }
    return result;
  };
  try {
    const first = repository.getRecommendationCandidates();
    assert.equal(first.length, 201);
    assert.ok(!first.some((item) => item.id === "Z998-ADDED"));
    assert.equal(first.find((item) => item.id === "A199").evidence.properties.tensile_strength[0].value, 40);
    const second = repository.getRecommendationCandidates();
    assert.equal(second.length, 202);
    assert.equal(second.find((item) => item.id === "A199").evidence.properties.tensile_strength[0].value, 80);
    assert.ok(second.some((item) => item.id === "Z998-ADDED"));
    assert.throws(() => repository.database.exec("DELETE FROM materials"), /readonly|read.only/i);
  } finally { repository.close(); writer.close(); }
}

function reportCompatibilityChecks(databasePath) {
  const writer = new DatabaseSync(databasePath);
  const cases = [
    ["REPORT-LIST", ["Fixture restriction <limited>."], "Not typically recyclable", 110, 70, 100, 1.2, 70, 150, 3, ""],
    ["REPORT-RECYCLED", [], "Recyclable", null, null, null, null, null, null, null, ""],
    ["REPORT-NONRECYCLED", [], "Not typically recyclable", null, null, null, null, null, null, null, ""],
    ["REPORT-PROFILE", [], "Recyclable", 60, 20, 5, 1.8, null, null, null, ""],
    ["REPORT-NOTE", [], "Recyclable", 110, 70, 100, 1.2, 70, 150, 3, "Existing report selection note. More detail."]
  ];
  try {
    writer.exec("BEGIN");
    for (const [id, disadvantages, ...profile] of cases) {
      addMaterial(writer, id, { tensile: 70 });
      writer.prepare(`UPDATE materials SET disadvantages=?, recyclability=?, max_temperature=?,
        tensile_strength=?, elongation=?, density=?, glass_transition_temperature=?,
        melting_temperature=?, dielectric_constant=?, notes=? WHERE material_id=?`)
        .run(JSON.stringify(disadvantages), ...profile, id);
      insert(writer, "material_tags", { material_id: id, tag: id === "REPORT-LIST" ? "optical" : "housing", position: 0 });
      insert(writer, "material_uses", { material_id: id, use: "housing", position: 0 });
    }
    writer.exec("COMMIT");
  } finally { writer.close(); }
  const repository = new MaterialRepository(databasePath);
  try {
    const compact = repository.getRecommendationCandidates();
    const detailed = compact.map((item) => repository.getMaterialById(item.id));
    const { assertReportCompatibility } = require("./test-catalog-frontend");
    const html = assertReportCompatibility(detailed, compact);
    assert.ok(html["en:REPORT-LIST"].includes("Fixture restriction &lt;limited&gt;."));
    assert.ok(!html["en:REPORT-RECYCLED"].includes("Not listed as recyclable"));
    assert.ok(html["en:REPORT-NONRECYCLED"].includes("Not listed as recyclable"));
    assert.ok(html["en:REPORT-PROFILE"].includes("Continuous use temperature is limited"));
    assert.ok(html["en:REPORT-PROFILE"].includes("Low elongation suggests"));
    assert.ok(html["en:REPORT-NOTE"].includes("Selection note: Existing report selection note."));
    for (let index = 0; index < compact.length; index += 1) {
      for (const field of ["disadvantages", "recyclable", "maxTemp", "tensile", "elongation", "density", "tg", "tm", "dielectric", "notes", "tags"])
        assert.deepEqual(compact[index][field], detailed[index][field], "report field: " + field);
      assert.ok(!("source_note" in compact[index]) && !("sources" in compact[index]) && !("identity" in compact[index].evidence));
    }
    console.log("F2 report compatibility passed: five real detailed/compact profiles, exact EN/ZH export HTML, explicit/fallback disadvantages, recyclable, numeric/null values, selection note and alternative scores.");
  } finally { repository.close(); }
}

async function boundaryAndParityChecks(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN");
    addMaterial(database, "H-HIGH", { tensile: 70 });
    addMaterial(database, "M-MEDIUM", { quality: "medium", tensile: 70 });
    addMaterial(database, "L-LOW", { quality: "low" });
    addMaterial(database, "Q-CONFLICT", { tensile: 40 });
    addProperty(database, "Q-CONFLICT", "tensile_strength", 80, { position: 1 });
    addMaterial(database, "Q-EXPLICIT", { tensile: 70 });
    addProperty(database, "Q-EXPLICIT", "tensile_strength", 70, { position: 1, conflict: "conflicting" });
    addMaterial(database, "LEGACY", { origin: "legacy", tensile: 70 });
    addMaterial(database, "MULTI", { tensile: 70, visibility: "review" });
    addProperty(database, "MULTI", "tensile_strength", 80, { position: 1, condition: "50 C", valueType: "minimum" });
    addProperty(database, "MULTI", "impact_strength", 12, { unit: "kJ/m2" });
    addProperty(database, "MULTI", "transparency", "transparent", { unit: "%" });
    addProperty(database, "MULTI", "chemical_resistance", "good resistance");
    addProperty(database, "MULTI", "flexibility", "flexible");
    addProperty(database, "MULTI", "flame_rating", "V-0");
    addProperty(database, "MULTI", "dielectric_constant", 3.2, { unit: "1" });
    addProperty(database, "MULTI", "water_absorption", 0.1, { unit: "%" });
    insert(database, "material_certifications", {
      material_id: "MULTI", certification_name: "RoHS", certification_status: "compliant", scope: "fixture grade",
      verification_status: "verified", confidence_level: "high", source_type: "manufacturer",
      source_title: "AD05 certification", source_url: "https://example.invalid/ad05/rohs", source_date: "2026-01-01"
    });
    // This unprojected property still participates in runtime physical conflict checks.
    addMaterial(database, "Q-NONRANKING", { tensile: 70 });
    addProperty(database, "Q-NONRANKING", "melting_temperature", 10, { unit: "degC" });
    for (const [id, options] of [
      ["X-ADMIN", { visibility: "admin_only" }], ["X-GENERATED", { origin: "generated" }],
      ["X-OUT", { scope: "out_of_scope" }], ["X-NO-ID", { identity: false }], ["X-INACTIVE", { active: 0 }],
      ["X-ID-Q", { identityQuarantine: true }], ["X-PROP-Q", { propertyQuarantine: true }],
      ["X-ID-GEN", { identityGenerated: true }], ["X-PROP-GEN", { propertyGenerated: true }]
    ]) addMaterial(database, id, options);
    database.exec("COMMIT");
  } finally { database.close(); }
  const repository = new MaterialRepository(databasePath);
  // SQL high then medium then other, material_id within each group. Q is NOT excluded by SQL quality.
  const expectedIds = ["H-HIGH", "LEGACY", "MULTI", "Q-CONFLICT", "Q-NONRANKING", "M-MEDIUM", "L-LOW", "Q-EXPLICIT"];
  try {
    const compact = repository.getRecommendationCandidates();
    assert.deepEqual(compact.map((item) => item.id), expectedIds);
    const full = expectedIds.map((id) => repository.getMaterialById(id));
    const byId = new Map(compact.map((item) => [item.id, item]));
    for (const id of ["H-HIGH", "LEGACY", "MULTI"]) assert.equal(byId.get(id).data_quality.level, "high");
    assert.equal(byId.get("M-MEDIUM").data_quality.level, "medium");
    assert.equal(byId.get("L-LOW").data_quality.reference_only, true);
    for (const id of ["Q-CONFLICT", "Q-NONRANKING", "Q-EXPLICIT"]) {
      assert.equal(byId.get(id).data_quality.level, "quarantined");
      assert.equal(byId.get(id).data_quality.recommendation_eligible, false);
      assert.equal(byId.get(id).data_quality.reference_only, false);
    }
    assert.equal(byId.get("MULTI").evidence.properties.tensile_strength.length, 2);
    for (let index = 0; index < full.length; index += 1) {
      for (const field of ["id", "name", "name_en", "name_zh", "abbr", "category", "category_en", "category_zh", "summary", "description_en", "description_zh", "uses", "applications_en", "applications_zh", "continuous_use_temperature", "record_type", "entityType", "disadvantages", "recyclable", "maxTemp", "tensile", "elongation", "density", "tg", "tm", "dielectric", "notes", "tags"])
        assert.deepEqual(compact[index][field], full[index][field], field);
      for (const field of ["level", "confidence_level", "verification_status", "recommendation_eligible", "reference_only", "issues"])
        assert.deepEqual(compact[index].data_quality[field], full[index].data_quality[field], field);
      assert.ok(!("source_note" in compact[index]) && !("sources" in compact[index]) && !("record_origin" in compact[index]));
      assert.ok(!("identity" in compact[index].evidence));
      for (const [key, claims] of Object.entries(compact[index].evidence.properties)) {
        const fields = ["propertyKey", "value", "unit", "testStandard", "testCondition", "valueType", "verificationStatus", "confidenceLevel", "conflictStatus"];
        assert.deepEqual(claims.map((claim) => fields.map((field) => claim[field])),
          full[index].evidence.properties[key].map((claim) => fields.map((field) => claim[field])), key);
        assert.deepEqual(claims.map((claim) => claim.source),
          full[index].evidence.properties[key].map((claim) => ({
            sourceType: claim.source.sourceType, sourceTitle: claim.source.sourceTitle,
            sourceUrl: claim.source.sourceUrl, sourceDate: claim.source.sourceDate
          })), key);
      }
      assert.deepEqual(Object.keys(compact[index].evidence.properties).sort(),
        Object.keys(full[index].evidence.properties).filter((key) => key !== "melting_temperature").sort());
    }
    for (const query of [strengthQuery, "tensile strength at least 50 MPa ASTM D638 test condition: 23 C", "tensile strength at least 50 MPa ASTM D638 test condition: 50 C", "tensile strength at least 50 MPa ASTM D638 test condition: 100 C", "RoHS compliant", "transparent chemical resistant flexible flame retardant electrical insulation waterproof impact resistant lightweight heat resistant"]) {
      assert.deepEqual(semanticResult(await recommend(compact, query)), semanticResult(await recommend(full, query)), query);
    }
    const contextual = await recommend([byId.get("MULTI")], "tensile strength at least 50 MPa ASTM D638 test condition: 23 C");
    assert.equal(contextual.status, "verified_matches");
    assert.equal(contextual.groups.verifiedMatches[0].requirementResults[0].materialValue, "70 MPa");
    const ambiguous = await recommend([byId.get("MULTI")], strengthQuery);
    assert.equal(ambiguous.status, "potential_matches");
    const certification = await recommend([byId.get("MULTI")], "RoHS compliant");
    assert.equal(certification.status, "verified_matches");
    const rejected = await recommend([byId.get("Q-CONFLICT"), byId.get("Q-NONRANKING"), byId.get("Q-EXPLICIT")], strengthQuery);
    assert.equal(rejected.status, "no_safe_match");
    assert.equal(rejected.recommendations.length, 0);
    const low = await recommend([byId.get("L-LOW")], strengthQuery);
    assert.equal(low.status, "potential_matches");
    assert.equal(low.groups.potentialMatches[0].referenceOnly, true);
    console.log(JSON.stringify({ fullHydratedBytes: Buffer.byteLength(JSON.stringify(full)), compactBytes: Buffer.byteLength(JSON.stringify(compact)), parityQueries: 6 }));
  } finally { repository.close(); }
  await withServer(databasePath, async (server) => {
    const response = await request(server);
    assert.equal(response.status, 200);
    assertEnvelope(response.json, 8, 4, 1);
    assert.deepEqual(response.json.items.map((item) => item.id), expectedIds);
  });
}

function assertEnvelope(payload, total, eligible, reference) {
  assert.deepEqual(Object.keys(payload).sort(), ["items", "total", "eligibleTotal", "referenceTotal", "complete", "bounded"].sort());
  assert.equal(payload.total, total);
  assert.equal(payload.items.length, total);
  assert.equal(payload.eligibleTotal, eligible);
  assert.equal(payload.referenceTotal, reference);
  assert.equal(payload.complete, true);
  assert.equal(payload.bounded, false);
  assert.equal(new Set(payload.items.map((item) => item.id)).size, total);
}

function recommend(materials, description) {
  return engine.createRecommendationService({ materials }).recommend(description);
}

function semanticResult(result) {
  // Only the material representation differs. Everything ranking and evidence
  // selection produces must be exactly equal, including stable tie order.
  return JSON.parse(JSON.stringify(result, (key, value) => key === "material" ? { id: value.id } : value));
}

async function withServer(databasePath, callback, mode, gcRegression = false, lifecycle) {
  const port = await freePort();
  throwIfWholeTestTimedOut();
  lifecycle?.signal.throwIfAborted();
  const env = { ...process.env, NODE_ENV: "test", PORT: String(port), MATFINDER_DB_PATH: databasePath, MATFINDER_TRUST_PROXY: "" };
  delete env.OPENAI_API_KEY;
  delete env.MATFINDER_ADMIN_TOKEN;
  const child = spawn(process.execPath, [
    ...(gcRegression ? ["--expose-gc"] : []), __filename, "--probe-server",
    ...(mode ? [mode] : []), ...(gcRegression ? ["--gc-regression"] : [])
  ], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const idle = () => child.exitCode !== null || child.signalCode !== null;
  let stopping;
  function cleanup() {
    // Timeout cleanup and the ordinary finally share the same stop operation.
    if (!stopping) stopping = (async () => {
      if (!idle()) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        let grace;
        try {
          child.kill();
          await Promise.race([exited, new Promise((resolve) => { grace = setTimeout(resolve, 3000); })]);
          if (!idle()) { child.kill("SIGKILL"); await exited; }
        } finally { clearTimeout(grace); }
      }
    })();
    return stopping;
  }
  const resources = { cleanup, idle, forceStop: () => { if (!idle()) child.kill("SIGKILL"); } };
  wholeTestServers.add(resources);
  lifecycle?.register(resources);
  try {
    for (let index = 0; index < 400 && !stdout.includes('"phase":"after_http_listen"') &&
        child.exitCode === null && !lifecycle?.signal.aborted && !wholeTestTimedOut; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
    throwIfWholeTestTimedOut();
    lifecycle?.signal.throwIfAborted();
    assert.equal(child.exitCode, null, stderr);
    assert.ok(stdout.includes('"phase":"after_http_listen"'), "Server did not listen: " + stderr);
    await callback({ port, child });
  } catch (error) { throw rememberWholeTestFailure(lifecycle ? lifecycle.recordFailure(error) : error); }
  finally {
    await cleanup();
    wholeTestServers.delete(resources);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

async function request(server, requestPath = "/api/recommendation-candidates") {
  const response = await fetch(`http://127.0.0.1:${server.port}${requestPath}`);
  const body = await response.text();
  return { status: response.status, headers: response.headers, body, json: JSON.parse(body) };
}

function diagnostics(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", onMessage); reject(new Error("Diagnostics timeout")); }, 5000);
    function onMessage(message) {
      if (message?.type !== "test-diagnostics-response") return;
      clearTimeout(timer); child.off("message", onMessage); resolve(message);
    }
    child.on("message", onMessage);
    child.send({ type: "test-diagnostics-request" });
  });
}
