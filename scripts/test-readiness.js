const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;

const root = path.resolve(__dirname, "..");
const privateFailureMarker = "INTERNAL_SQL_OR_PATH_DO_NOT_EXPOSE";

if (process.argv.includes("--probe-server")) {
  // Do not load a developer's local .env files into this test child.
  const originalExistsSync = fs.existsSync;
  fs.existsSync = function (filePath) {
    if (typeof filePath === "string" &&
        [".env", ".env.local"].includes(path.basename(filePath))) return false;
    return originalExistsSync.apply(this, arguments);
  };
  for (const heavyMethod of [
    "getDatabaseCounts", "getCatalogStats", "getRecommendationCandidates"
  ]) {
    MaterialRepository.prototype[heavyMethod] = () => {
      throw new Error("Probes must not call " + heavyMethod);
    };
  }
  if (process.argv.includes("--technical-failure")) {
    MaterialRepository.prototype.checkTechnicalHealth = () => {
      throw new Error(privateFailureMarker);
    };
  }
  if (process.argv.includes("--technical-failure-after-ready")) {
    const checkTechnicalHealth = MaterialRepository.prototype.checkTechnicalHealth;
    let checks = 0;
    MaterialRepository.prototype.checkTechnicalHealth = function () {
      if (++checks > 1) throw new Error(privateFailureMarker);
      return checkTechnicalHealth.call(this);
    };
  }
  if (process.argv.includes("--readiness-failure")) {
    MaterialRepository.prototype.hasReadyPublicCommercialGrade = () => {
      throw new Error(privateFailureMarker);
    };
  }
  require("../server");
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad03-"));
  const databasePath = path.join(directory, "readiness-fixture.db");
  const emptyDatabasePath = path.join(directory, "empty-fixture.db");
  try {
    createEmptySchemaDatabase(path.join(root, "matfinder.db"), emptyDatabasePath);
    await withServer(emptyDatabasePath, {}, async (server) => {
      await expectProbe(server, "/api/live", 200, { status: "alive" });
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
    });

    fs.copyFileSync(path.join(root, "matfinder.db"), databasePath);
    assert.equal(readinessFrom(databasePath), false, "The baseline has no eligible public grade.");

    await withServer(databasePath, {}, async (server) => {
      const beforeLive = await diagnostics(server.child);
      await expectProbe(server, "/api/live", 200, { status: "alive" });
      const afterLive = await diagnostics(server.child);
      assert.equal(afterLive.repository.queries, beforeLive.repository.queries,
        "Liveness must not query SQLite.");
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
      const beforeCachedRead = await diagnostics(server.child);
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
      const afterCachedRead = await diagnostics(server.child);
      assert.equal(afterCachedRead.repository.queries - beforeCachedRead.repository.queries, 1,
        "Repeated readiness must reuse its bounded data-existence result.");
      assert.equal((await request(server, "/api/materials?limit=1")).status, 200);
      assert.equal((await request(server, "/api/polymer-families")).status, 200);

      let limited = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await request(server, "/api/polymer-families");
        if (response.status === 429) {
          limited = true;
          break;
        }
        assert.equal(response.status, 200);
      }
      assert.ok(limited, "Normal public GET routes must still be rate limited.");
      assert.equal((await request(server, "/api/polymer-families")).status, 429);
      await expectProbe(server, "/api/live", 200, { status: "alive" });
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
    });

    const ineligible = [
      { id: "AD03-GENERATED", recordOrigin: "generated" },
      { id: "AD03-LEGACY", recordType: "legacy" },
      { id: "AD03-LEGACY-ORIGIN", recordOrigin: "legacy" },
      { id: "AD03-ADMIN", visibility: "admin_only" },
      { id: "AD03-QUARANTINED", quarantined: true },
      { id: "AD03-NO-IDENTITY", identity: false },
      { id: "AD03-BLANK-IDENTITY", blankIdentity: true },
      { id: "AD03-LOW-QUALITY", quality: "low" }
    ];
    for (const fixture of ineligible) {
      addFixture(databasePath, fixture);
      assert.equal(readinessFrom(databasePath), false,
        fixture.id + " must not make the product ready.");
    }
    await withServer(databasePath, {}, async (server) => {
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
    });

    const inactiveId = "AD03-INACTIVE-IDENTITY";
    addFixture(databasePath, { id: inactiveId, inactiveIdentity: true });
    const identityDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(identityDatabase.prepare(
        "SELECT active FROM real_material_identities WHERE material_id = ?"
      ).get(inactiveId).active, 0);
    } finally {
      identityDatabase.close();
    }
    const inactiveRepository = new MaterialRepository(databasePath);
    try {
      assert.equal(inactiveRepository.hasReadyPublicCommercialGrade(), false);
      assert.equal(inactiveRepository.getRecommendationCandidates({ limit: 200 })
        .some((item) => item.id === inactiveId), false);
    } finally {
      inactiveRepository.close();
    }
    await withServer(databasePath, {}, async (server) => {
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
    });

    addFixture(databasePath, {
      id: "AD03-TEMPERATURE-CONFLICT", temperatureConflict: true
    });
    const conflictingRepository = new MaterialRepository(databasePath);
    try {
      const conflicting = conflictingRepository.getRecommendationCandidates({ limit: 200 })
        .find((item) => item.id === "AD03-TEMPERATURE-CONFLICT");
      assert.ok(conflicting, "The conflicting grade must enter the normal public candidate path.");
      assert.equal(conflicting.data_quality.level, "quarantined");
      assert.equal(conflicting.data_quality.recommendation_eligible, false);
      assert.ok(conflicting.data_quality.issues.some((issue) =>
        issue.code === "temperature_inconsistency"));
    } finally {
      conflictingRepository.close();
    }
    await withServer(databasePath, {}, async (server) => {
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "no_verified_public_grades"
      });
    });
    assert.equal(readinessFrom(databasePath), false,
      "A grade rejected by normal engineering quality must not make the catalog ready.");

    // A valid grade after more than 200 coarse candidates must still be found.
    for (let index = 0; index < 201; index += 1) {
      addFixture(databasePath, {
        id: "AD03-COARSE-" + String(index).padStart(3, "0"), quality: "low"
      });
    }
    assert.equal(readinessFrom(databasePath), false);

    addFixture(databasePath, { id: "AD03-READY" });
    assert.equal(readinessFrom(databasePath), true);
    const repository = new MaterialRepository(databasePath);
    try {
      const selected = repository.getRecommendationCandidates({ limit: 20 })
        .find((item) => item.id === "AD03-READY");
      assert.ok(selected, "The ready fixture must enter the normal public candidate path.");
      assert.equal(selected.data_quality.recommendation_eligible, true);
    } finally {
      repository.close();
    }
    await withServer(databasePath, {}, async (server) => {
      await expectProbe(server, "/api/live", 200, { status: "alive" });
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 200, { status: "ready" });
    });
    await withServer(databasePath, { failure: "--technical-failure-after-ready" }, async (server) => {
      await expectProbe(server, "/api/ready", 200, { status: "ready" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "database_unavailable"
      });
    });
    await withServer(databasePath, { credentials: true }, async (server) => {
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 200, { status: "ready" });
    });
    await withServer(databasePath, { failure: "--technical-failure" }, async (server) => {
      await expectProbe(server, "/api/live", 200, { status: "alive" });
      await expectProbe(server, "/api/health", 503, {
        status: "unhealthy", reason: "database_unavailable"
      });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "database_unavailable"
      });
    });
    await withServer(databasePath, { failure: "--readiness-failure" }, async (server) => {
      await expectProbe(server, "/api/health", 200, { status: "ok" });
      await expectProbe(server, "/api/ready", 503, {
        status: "not_ready", reason: "database_unavailable"
      });
    });
    process.stdout.write("AD-03 readiness tests passed (temporary SQLite; no provider calls).\n");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readinessFrom(databasePath) {
  const repository = new MaterialRepository(databasePath);
  try {
    repository.checkTechnicalHealth();
    return repository.hasReadyPublicCommercialGrade();
  } finally {
    repository.close();
  }
}

function createEmptySchemaDatabase(sourcePath, destinationPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const destination = new DatabaseSync(destinationPath);
  try {
    const definitions = source.prepare(
      "SELECT sql FROM sqlite_master WHERE type IN ('table', 'index') " +
      "AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL " +
      "ORDER BY CASE WHEN type = 'table' THEN 0 ELSE 1 END, name"
    ).all();
    for (const definition of definitions) destination.exec(definition.sql);
    const version = Number(source.prepare("PRAGMA user_version").get().user_version);
    destination.exec("PRAGMA user_version = " + version);
    assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM materials").get().count, 0);
  } finally {
    destination.close();
    source.close();
  }
}

function addFixture(databasePath, options) {
  const database = new DatabaseSync(databasePath);
  const id = options.id;
  const grade = "GRADE-" + id;
  const manufacturer = "AD-03 TEST ONLY";
  try {
    const template = database.prepare("SELECT * FROM materials LIMIT 1").get();
    assert.ok(template);
    const row = {
      ...template,
      material_id: id,
      name: id,
      name_en: id,
      name_zh: id,
      abbreviation: id,
      material_family: "PC",
      family: "PC",
      grade_name: grade,
      manufacturer,
      category: "Plastics",
      record_type: options.recordType || "commercial_grade",
      record_origin: options.recordOrigin || "imported",
      scope_status: "in_scope",
      catalog_visibility: options.visibility || "public",
      density: 1.2,
      tensile_strength: 50,
      max_temperature: null,
      continuous_use_temperature: options.temperatureConflict ? 160 : null,
      melting_temperature: options.temperatureConflict ? 100 : null,
      glass_transition_temperature: null,
      summary: "AD-03 temporary test fixture."
    };
    const columns = Object.keys(row);
    database.exec("BEGIN");
    database.prepare("INSERT INTO materials (" + columns.join(", ") + ") VALUES (" +
      columns.map(() => "?").join(", ") + ")")
      .run(...columns.map((column) => row[column]));

    if (options.identity !== false) {
      database.prepare(
        "INSERT INTO real_material_identities (" +
        "material_id, manufacturer, commercial_grade, material_family, " +
        "manufacturer_key, commercial_grade_key, material_family_key, created_at, active" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id,
        options.blankIdentity ? "" : manufacturer,
        options.blankIdentity ? "" : grade,
        options.blankIdentity ? "" : "PC",
        id.toLowerCase(), grade.toLowerCase(), "pc", "2026-01-01",
        options.inactiveIdentity ? 0 : 1
      );
    }
    if (options.quality !== "low") {
      database.prepare(
        "INSERT INTO material_evidence (" +
        "material_id, manufacturer, commercial_grade, material_family, " +
        "source_type, source_title, source_url, verification_status, confidence_level" +
        ") VALUES (?, ?, ?, 'PC', 'manufacturer', 'AD-03 TEST ONLY', " +
        "'https://example.invalid/ad03', ?, ?)"
      ).run(id, manufacturer, grade,
        options.quarantined ? "quarantined" : "verified",
        options.quarantined ? "quarantined" : "high");
      const insertProperty = database.prepare(
        "INSERT INTO material_property_evidence (" +
        "material_id, property_key, position, value_numeric, unit, test_standard, " +
        "test_condition, value_type, manufacturer, commercial_grade, material_family, " +
        "source_type, source_title, source_url, verification_status, confidence_level" +
        ") VALUES (?, ?, 0, ?, ?, 'AD-03 TEST', 'AD-03 TEST', 'typical', ?, ?, 'PC', " +
        "'manufacturer', 'AD-03 TEST ONLY', 'https://example.invalid/ad03', 'verified', 'high')"
      );
      insertProperty.run(id, "density", 1.2, "g/cm3", manufacturer, grade);
      insertProperty.run(id, "tensile_strength", 50, "MPa", manufacturer, grade);
      if (options.temperatureConflict) {
        insertProperty.run(id, "continuous_use_temperature", 160, "degC", manufacturer, grade);
        insertProperty.run(id, "melting_temperature", 100, "degC", manufacturer, grade);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    database.close();
  }
}

async function withServer(databasePath, options, callback) {
  await require("./build-catalog-stats").buildCatalogStats(databasePath);
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    MATFINDER_DB_PATH: databasePath,
    MATFINDER_TRUST_PROXY: ""
  };
  delete env.OPENAI_API_KEY;
  delete env.MATFINDER_ADMIN_TOKEN;
  if (options.credentials) {
    env.OPENAI_API_KEY = "AD03_FAKE_KEY_ONLY";
    env.MATFINDER_ADMIN_TOKEN = "AD03_FAKE_ADMIN_TOKEN_ONLY";
  }
  const args = [__filename, "--probe-server"];
  if (options.failure) args.push(options.failure);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitUntil(() => stdout.includes('"phase":"after_http_listen"') ||
      child.exitCode !== null, 20_000);
    assert.equal(child.exitCode, null, "Test server exited before listening: " + stderr);
    await callback({ child, port });
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function expectProbe(server, requestPath, expectedStatus, expectedBody) {
  const response = await request(server, requestPath);
  assert.equal(response.status, expectedStatus, requestPath);
  assert.deepEqual(response.json, expectedBody, requestPath + " must have a minimal payload.");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!response.body.includes(privateFailureMarker));
  assert.ok(!response.body.includes(server.child.spawnargs[0]));
}

async function request(server, requestPath) {
  const response = await fetch("http://127.0.0.1:" + server.port + requestPath);
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch {}
  return { status: response.status, headers: response.headers, body, json };
}

function diagnostics(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error("Timed out waiting for test-process diagnostics"));
    }, 5_000);
    const onMessage = (message) => {
      if (message?.type !== "test-diagnostics-response") return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message);
    };
    child.on("message", onMessage);
    child.send({ type: "test-diagnostics-request" }, (error) => {
      if (!error) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      reject(error);
    });
  });
}

function waitUntil(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for readiness test server"));
      }
    }, 20);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
}
