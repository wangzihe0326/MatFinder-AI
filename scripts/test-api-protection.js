const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  AiCoordinator,
  ClientRegistry,
  MAX_PROMPT_BYTES,
  OPENAI_TIMEOUT_MS,
  clientIdentity,
  createApiProtection
} = require("../api-protection");
const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;

const root = path.resolve(__dirname, "..");
const adminFixture = "AD02_TEST_ADMIN_TOKEN_ONLY";
const openAiFixture = "AD02_TEST_OPENAI_KEY_ONLY";
let testDatabasePath;

if (process.argv.includes("--fake-server")) {
  runFakeServer();
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function runFakeServer() {
  let mode = "success";
  let sequence = 0;
  const pending = new Map();
  process.on("message", (message) => {
    if (message.type === "mode") {
      mode = message.value;
      process.send({ type: "mode-set", value: mode });
    }
    if (message.type === "release") pending.get(message.id)?.();
  });
  global.fetch = (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const providerBody = JSON.parse(options.body);
    const prompt = JSON.parse(providerBody.messages[1].content);
    const kind = prompt.materials ? "comparison" : "analysis";
    const id = ++sequence;
    process.send({
      type: "provider-call",
      id,
      kind,
      maxTokens: providerBody.max_completion_tokens,
      promptBytes: Buffer.byteLength(options.body)
    });
    const success = () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(kind === "analysis" ? {
        overview: "Fixture analysis",
        advantages: ["Supported by fixture"],
        limitations: ["Fixture limitation"],
        recommendedApplications: ["Fixture use"]
      } : {
        keyDifferences: ["Fixture difference"],
        strengthsAndWeaknesses: ["Fixture strength"],
        recommendedUseCases: ["Fixture use"],
        selectionAdvice: "Fixture advice"
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const selectedMode = mode;
    if (selectedMode === "malformed") {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: "{}" } }]
      }), { status: 200 }));
    }
    if (selectedMode === "provider-error") {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "fixture internal detail" } }), {
        status: 500
      }));
    }
    if (selectedMode !== "hold") return Promise.resolve(success());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.delete(id);
        process.send({ type: "provider-abort", id });
        reject(new Error("fixture aborted"));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      pending.set(id, () => {
        pending.delete(id);
        options.signal.removeEventListener("abort", onAbort);
        resolve(success());
      });
      if (options.signal.aborted) onAbort();
    });
  };
  require("../server");
}

async function main() {
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad02-"));
  testDatabasePath = path.join(testDirectory, "fixture.db");
  try {
    fs.copyFileSync(path.join(root, "matfinder.db"), testDatabasePath);
    addPublicTestMaterials(testDatabasePath);
    await require("./build-catalog-stats").buildCatalogStats(testDatabasePath);
    const repository = new MaterialRepository(testDatabasePath);
    const publicMaterials = repository.getRecommendationCandidates({ limit: 20 });
    assert.ok(publicMaterials.length >= 8, "Need public material fixtures for distinct AI cache keys.");
    assert.ok(publicMaterials.slice(0, 8).every((item) => item.data_quality.recommendation_eligible));
    const publicIds = publicMaterials.map((item) => item.id);
    const auditOnly = repository.listMaterials({ audit: true, limit: 200 }).items.find(
      (item) => item.data_quality?.level === "quarantined" && !repository.getMaterialById(item.id)
    );
    assert.ok(auditOnly, "Need one audit-only fixture to verify the public boundary.");
    repository.close();

    await testFrontendStartupContract();
    testBucketsAndRegistry();
    testProxyIdentity();
    await testCoordinator();
    await testPublicAndAuditRoutes(publicIds, auditOnly.id);
    await testFailClosedAudit();
    await testAiValidationAndCache(publicIds, auditOnly.id);
    await testAiClientLimit(publicIds);
    await testAiGlobalLimit(publicIds);
    await testComparisonOrder(publicIds);
    await testHttpConcurrency(publicIds);
    await testHttpDedup(publicIds);
    await testHttpDisconnect(publicIds);
    process.stdout.write("AD-02 API protection tests passed (fake OpenAI transport only).\n");
  } finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
}

function addPublicTestMaterials(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const template = database.prepare("SELECT * FROM materials LIMIT 1").get();
    assert.ok(template);
    const columns = Object.keys(template);
    const insertMaterial = database.prepare(
      `INSERT INTO materials (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    );
    const insertIdentity = database.prepare(`
      INSERT INTO real_material_identities (
        material_id, manufacturer, commercial_grade, material_family,
        manufacturer_key, commercial_grade_key, material_family_key, created_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertEvidence = database.prepare(`
      INSERT INTO material_evidence (
        material_id, manufacturer, commercial_grade, material_family,
        source_type, source_title, source_url, verification_status, confidence_level
      ) VALUES (?, ?, ?, ?, 'manufacturer', 'AD-02 TEST ONLY',
        'https://example.invalid/ad02-test', 'verified', 'high')
    `);
    const insertProperty = database.prepare(`
      INSERT INTO material_property_evidence (
        material_id, property_key, position, value_numeric, unit, test_standard,
        test_condition, value_type, manufacturer, commercial_grade, material_family,
        source_type, source_title, source_url, verification_status, confidence_level
      ) VALUES (?, ?, 0, ?, ?, 'AD-02 TEST', 'AD-02 TEST', 'typical', ?, ?, 'PC',
        'manufacturer', 'AD-02 TEST ONLY', 'https://example.invalid/ad02-test', 'verified', 'high')
    `);
    database.exec("BEGIN");
    for (let i = 0; i < 9; i++) {
      const oversized = i === 8;
      const id = oversized ? "ZZ-AD02-TEST-OVERSIZED" : `AD02-TEST-PUBLIC-${i}`;
      const grade = `AD02-TEST-GRADE-${i}`;
      const row = {
        ...template,
        material_id: id,
        name: `AD-02 TEST ONLY ${i}`,
        name_en: `AD-02 TEST ONLY ${i}`,
        name_zh: `AD-02 TEST ONLY ${i}`,
        abbreviation: `AD02T${i}`,
        material_family: "PC",
        family: "PC",
        grade_name: grade,
        manufacturer: "AD-02 TEST ONLY",
        category: "Plastics",
        category_en: "Plastics",
        category_zh: "Plastics",
        record_type: "commercial_grade",
        record_origin: "imported",
        scope_status: "in_scope",
        catalog_visibility: "public",
        density: 1.2,
        tensile_strength: 50,
        max_temperature: null,
        continuous_use_temperature: null,
        melting_temperature: null,
        glass_transition_temperature: null,
        summary: oversized ? "X".repeat(MAX_PROMPT_BYTES) : "AD-02 TEST ONLY fixture."
      };
      insertMaterial.run(...columns.map((column) => row[column]));
      insertIdentity.run(id, "AD-02 TEST ONLY", grade, "PC", "ad-02 test only", grade.toLowerCase(), "pc", "2026-01-01");
      insertEvidence.run(id, "AD-02 TEST ONLY", grade, "PC");
      insertProperty.run(id, "density", 1.2, "g/cm3", "AD-02 TEST ONLY", grade);
      insertProperty.run(id, "tensile_strength", 50, "MPa", "AD-02 TEST ONLY", grade);
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    database.close();
  }
}

async function testFrontendStartupContract() {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const loadMaterials = app.match(/async function loadMaterials\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(loadMaterials, "Public startup loader exists.");
  const requestedPaths = [];
  const context = {
    elements: { materialsGrid: { innerHTML: "" }, emptyState: { hidden: false } },
    state: { materialsPageSize: 48, filteredMaterialsCache: null },
    materials: [],
    materialCatalogTotal: 0,
    catalogFacets: { categories: { all: 0, options: [] }, performance: { all: 0, groups: [], options: [] }, domains: { all: 0, options: [] } },
    t: () => "Loading",
    // The production render is tested in the complete browser harness.
    renderCatalogStats() {},
    apiUrl: (value) => value,
    fetch: async (requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath.includes("/api/admin/")) return { ok: false, status: 401 };
      const payload = requestPath.startsWith("/api/materials")
        ? { items: [{ id: "AD02-TEST-STARTUP" }], total: 1 }
        : requestPath === "/api/polymer-families" ? []
          : requestPath === "/api/catalog-stats" ? { verifiedCommercialGrades: 1 }
            : { target: 0 };
      return { ok: true, json: async () => payload };
    }
  };
  const generationHelpers = app.slice(app.indexOf("function sameCatalogGeneration("),
    app.indexOf("function renderCatalogStats("));
  const run = vm.runInNewContext(`${generationHelpers}\n${loadMaterials}\nloadMaterials`, context);
  await run();
  assert.equal(context.materials.length, 1, "Public startup loader succeeds without admin token.");
  assert.equal(requestedPaths.length, 4);
  assert.ok(!requestedPaths.some((requestPath) => requestPath.includes("/api/admin/")),
    "Public startup must not depend on audit.");
  assert.ok(app.includes("function authenticateAudit(token)"), "Direct /audit has a credential flow.");
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.ok(!html.includes('href="/audit"'), "Anonymous navigation must not advertise Audit.");
  assert.ok(html.includes('id="auditAuthForm"'), "Direct /audit has a prompt.");
}

function testBucketsAndRegistry() {
  let time = 0;
  const protection = createApiProtection({ now: () => time, adminToken: adminFixture });
  for (let i = 0; i < 6; i++) assert.equal(protection.publicGet("public-client", 5), 0);
  assert.ok(protection.publicGet("public-client", 5) > 0, "Weighted public GET returns 429 delay.");
  time += 2500;
  assert.equal(protection.publicGet("public-client", 5), 0, "Public bucket refills.");
  for (let i = 0; i < 10; i++) assert.equal(protection.admin("admin-client", `Bearer ${adminFixture}`).status, 200);
  assert.equal(protection.admin("admin-client", `Bearer ${adminFixture}`).status, 429);
  time += 1000;
  assert.equal(protection.admin("admin-client", `Bearer ${adminFixture}`).status, 200);
  for (let i = 0; i < 3; i++) assert.equal(protection.admin("bad-client", "Bearer wrong").status, 401);
  assert.equal(protection.admin("bad-client", "Bearer wrong").status, 429);
  time += 60_000;
  assert.equal(protection.admin("bad-client", "Bearer wrong").status, 401);
  for (let i = 0; i < 3; i++) assert.equal(protection.aiClient("ai-client"), 0);
  assert.ok(protection.aiClient("ai-client") > 0);
  time += 120_000;
  assert.equal(protection.aiClient("ai-client"), 0, "AI client bucket refills.");
  for (let i = 0; i < 6; i++) assert.equal(protection.aiGlobal(), 0);
  assert.ok(protection.aiGlobal() > 0, "Global cost bucket cannot be bypassed by IP.");
  time += 60_000;
  assert.equal(protection.aiGlobal(), 0);

  const registry = new ClientRegistry({ now: () => time });
  for (let i = 0; i < 6000; i++) registry.bucket(`fixture-${i}`, "public", 30, 2 / 1000);
  assert.equal(registry.size, 5000, "Client registry must remain bounded.");
  registry.bucket("expires-public", "public", 30, 2 / 1000);
  registry.bucket("expires-ai", "ai", 3, 1 / 120_000);
  time += 16 * 60_000;
  registry.cleanup();
  assert.ok(!registry.entries.has("expires-public"), "Inactive public entry expires in 15 minutes.");
  assert.ok(registry.entries.has("expires-ai"), "AI entry remains for its 30-minute TTL.");
  time += 15 * 60_000;
  registry.cleanup();
  assert.ok(!registry.entries.has("expires-ai"), "Inactive AI entry expires in 30 minutes.");
}

function testProxyIdentity() {
  const request = (xff) => ({
    socket: { remoteAddress: "::ffff:127.0.0.1" },
    headers: { "x-forwarded-for": xff, "x-real-ip": "192.0.2.200" }
  });
  assert.equal(clientIdentity(request("198.51.100.1, 203.0.113.2"), ""), "127.0.0.1");
  assert.equal(clientIdentity(request("198.51.100.1, 203.0.113.2"), "render"), "203.0.113.2");
  assert.equal(clientIdentity(request("2001:db8::1"), "render"), "2001:db8::1");
  assert.equal(clientIdentity(request("198.51.100.1, invalid"), "render"), "127.0.0.1");
  assert.equal(clientIdentity(request("198.51.100.1,".repeat(9)), "render"), "127.0.0.1");
  assert.equal(clientIdentity(request("A".repeat(513)), "render"), "127.0.0.1");
  assert.equal(clientIdentity(request(undefined), "render"), "127.0.0.1");
}

async function testCoordinator() {
  let time = 0;
  const protection = createApiProtection({ now: () => time });
  let scheduled;
  const coordinator = new AiCoordinator({
    now: () => time,
    protection,
    schedule: (fn, ms) => { scheduled = { fn, ms }; return 1; },
    cancel: () => {}
  });
  const response = () => new EventEmitter();
  let calls = 0;
  const first = await coordinator.run({
    key: "cache-key", identity: "a", response: response(),
    task: async () => { calls++; return { result: "ok" }; }
  });
  const cached = await coordinator.run({
    key: "cache-key", identity: "a", response: response(),
    task: async () => { calls++; return { result: "wrong" }; }
  });
  assert.deepEqual(first, cached);
  assert.equal(calls, 1, "Successful result is cached.");
  time += 15 * 60_000;
  await coordinator.run({
    key: "cache-key", identity: "a", response: response(),
    task: async () => { calls++; return { result: "refreshed" }; }
  });
  assert.equal(calls, 2, "Cache expires after 15 minutes.");
  for (let i = 0; i < 251; i++) coordinator.store(`bounded-${i}`, { value: i });
  assert.equal(coordinator.cache.size, 250);

  let release;
  const heldTask = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const a = coordinator.run({ key: "shared", identity: "a", response: response(), task: heldTask });
  const b = coordinator.run({ key: "shared", identity: "b", response: response(), task: heldTask });
  await new Promise(setImmediate);
  assert.equal(coordinator.inflight.size, 1);
  assert.equal(coordinator.activeGlobal, 1);
  release({ result: "shared" });
  assert.deepEqual(await a, await b);
  assert.equal(coordinator.activeGlobal, 0);

  let failureCalls = 0;
  await assert.rejects(coordinator.run({
    key: "failure", identity: "a", response: response(),
    task: async () => { failureCalls++; throw new Error("provider detail"); }
  }), (error) => error.status === 502 && error.message === "AI service unavailable");
  await coordinator.run({
    key: "failure", identity: "a", response: response(),
    task: async () => { failureCalls++; return { result: "recovered" }; }
  });
  assert.equal(failureCalls, 2, "Failures are not cached.");
  assert.equal(coordinator.activeGlobal, 0);

  let aborted = false;
  const timeout = coordinator.run({
    key: "timeout", identity: "a", response: response(),
    task: (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    })
  });
  await new Promise(setImmediate);
  assert.equal(scheduled.ms, OPENAI_TIMEOUT_MS);
  scheduled.fn();
  await assert.rejects(timeout, (error) => error.status === 504 && error.message === "AI request timed out");
  assert.ok(aborted);
  assert.equal(coordinator.activeGlobal, 0, "Timeout releases global semaphore.");

  const disconnectedResponse = response();
  let disconnectAborted = false;
  const disconnected = coordinator.run({
    key: "disconnect", identity: "a", response: disconnectedResponse,
    task: (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { disconnectAborted = true; reject(new Error("aborted")); }, { once: true });
    })
  });
  await new Promise(setImmediate);
  disconnectedResponse.emit("close");
  await assert.rejects(disconnected, (error) => error.status === 499);
  assert.ok(disconnectAborted);
  assert.equal(coordinator.activeGlobal, 0, "Disconnect releases global semaphore.");
}

async function testPublicAndAuditRoutes(publicIds, auditOnlyId) {
  await withServer({}, async (server) => {
    for (const requestPath of [
      "/", "/api/health", "/api/materials?limit=1", "/api/polymer-families",
      "/api/catalog-stats", "/api/pilot-status", "/api/recommendation-candidates",
      `/api/materials/${encodeURIComponent(publicIds[0])}`
    ]) {
      assert.equal((await send(server, requestPath)).status, 200, `${requestPath} stays public.`);
    }
    assert.equal((await send(server, `/api/materials/${encodeURIComponent(auditOnlyId)}`)).status, 404);
    const allowedCors = await send(server, "/api/health", {
      headers: { Origin: "https://frontend.example.test" }
    });
    assert.equal(allowedCors.headers["access-control-allow-origin"], "https://frontend.example.test");
    assert.match(allowedCors.headers.vary, /Origin/);
    const deniedCors = await send(server, "/api/health", {
      headers: { Origin: "https://unapproved.example.test" }
    });
    assert.equal(deniedCors.headers["access-control-allow-origin"], undefined);
    const preflight = await send(server, "/api/admin/audit-summary", {
      method: "OPTIONS", headers: { Origin: "https://frontend.example.test" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-headers"], "Content-Type",
      "Cross-origin admin Authorization is not enabled.");

    const auditPaths = [
      "/api/admin/audit-summary",
      "/api/materials?audit=1&limit=1",
      `/api/materials/${encodeURIComponent(auditOnlyId)}?audit=1`
    ];
    let identity = 20;
    for (const requestPath of auditPaths) {
      const noCredential = await send(server, requestPath, { ip: `198.51.100.${identity++}` });
      assert.equal(noCredential.status, 401, `${requestPath} denies anonymous access.`);
      assert.ok(!noCredential.body.includes("legacyMaterialRecords"));
      const invalid = await send(server, requestPath, {
        ip: `198.51.100.${identity++}`,
        headers: { Authorization: "Bearer wrong-fixture" }
      });
      assert.equal(invalid.status, 401, `${requestPath} denies an invalid token.`);
      const valid = await send(server, requestPath, {
        ip: `198.51.100.${identity++}`,
        headers: { Authorization: `Bearer ${adminFixture}` }
      });
      assert.equal(valid.status, 200, `${requestPath} accepts a valid token.`);
      assert.equal(valid.headers["cache-control"], "no-store");
    }
    const failedIp = "198.51.100.99";
    for (let i = 0; i < 3; i++) {
      assert.equal((await send(server, auditPaths[0], { ip: failedIp })).status, 401);
    }
    const limited = await send(server, auditPaths[0], { ip: failedIp });
    assertRateLimit(limited);

    const publicRateIp = "198.51.100.110";
    for (let i = 0; i < 6; i++) {
      assert.equal((await send(server, "/api/recommendation-candidates", {
        ip: publicRateIp
      })).status, 200);
    }
    assertRateLimit(await send(server, "/api/recommendation-candidates", {
      ip: publicRateIp
    }));

    const adminRateIp = "198.51.100.111";
    let adminLimited;
    for (let i = 0; i < 30; i++) {
      const response = await send(server, auditPaths[0], {
        ip: adminRateIp,
        headers: { Authorization: `Bearer ${adminFixture}` }
      });
      if (response.status === 429) {
        adminLimited = response;
        break;
      }
      assert.equal(response.status, 200);
    }
    assert.ok(adminLimited, "Sustained admin queries must be rate limited.");
    assertRateLimit(adminLimited);
  });
}

async function testFailClosedAudit() {
  await withServer({ adminToken: "" }, async (server) => {
    assert.equal((await send(server, "/api/admin/audit-summary")).status, 401);
    assert.equal((await send(server, "/api/materials?audit=1")).status, 401);
    assert.equal((await send(server, "/api/health")).status, 200);
    assert.equal((await send(server, "/api/materials?limit=1")).status, 200);
  });
}

async function testAiValidationAndCache(publicIds, auditOnlyId) {
  await withServer({}, async (server) => {
    const analysis = { materialId: publicIds[0], language: "en" };
    const first = await sendAi(server, "/api/material-analysis", analysis, 1);
    assert.equal(first.status, 200);
    const second = await sendAi(server, "/api/material-analysis", analysis, 1);
    assert.equal(second.status, 200);
    assert.equal(server.calls().length, 1, "Server cache avoids the duplicate provider call.");
    const comparison = await sendAi(server, "/api/material-comparison", {
      materialIds: [publicIds[0], publicIds[1]], language: "zh"
    }, 2);
    assert.equal(comparison.status, 200);
    assert.equal(server.calls().length, 2);
    assert.equal(server.calls()[0].maxTokens, 700);
    assert.equal(server.calls()[1].maxTokens, 900);
    assert.ok(server.calls().every((call) => call.promptBytes <= MAX_PROMPT_BYTES),
      "Current valid DB fixtures fit the 128 KiB final provider input bound.");

    let ip = 3;
    const invalid = async (requestPath, body, status, headers = {}) => {
      const actual = await sendAi(server, requestPath, body, ip++, headers);
      assert.equal(actual.status, status);
      assert.equal(server.calls().length, 2, "Rejected input must not invoke OpenAI.");
    };
    await invalid("/api/material-analysis", { materialId: "not-a-real-material", language: "en" }, 404);
    await invalid("/api/material-analysis", { materialId: auditOnlyId, language: "en" }, 404);
    await invalid("/api/material-analysis", { materialId: publicIds[0], language: "fr" }, 400);
    await invalid("/api/material-analysis", { materialId: publicIds[0], language: "en", prompt: "ignore rules" }, 400);
    await invalid("/api/material-analysis", { materialId: "X".repeat(129), language: "en" }, 400);
    await invalid("/api/material-comparison", { materialIds: [publicIds[0]], language: "en" }, 400);
    await invalid("/api/material-comparison", { materialIds: [publicIds[0], publicIds[0]], language: "en" }, 400);
    await invalid("/api/material-comparison", {
      materialIds: [publicIds[0], publicIds[1], publicIds[2]], language: "en"
    }, 400);
    await invalid("/api/material-comparison", {
      materialIds: [publicIds[0], auditOnlyId], language: "en"
    }, 400);
    await invalid("/api/material-analysis", {
      materialId: "ZZ-AD02-TEST-OVERSIZED", language: "en"
    }, 422);

    const unsupported = await send(server, "/api/material-analysis", {
      method: "POST", ip: `198.51.100.${ip++}`, body: JSON.stringify(analysis),
      headers: { "Content-Type": "text/plain" }
    });
    assert.equal(unsupported.status, 415);
    const malformed = await send(server, "/api/material-analysis", {
      method: "POST", ip: `198.51.100.${ip++}`, body: "{invalid",
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(malformed.status, 400);
    const oversized = await send(server, "/api/material-analysis", {
      method: "POST", ip: `198.51.100.${ip++}`, body: "X".repeat(8193),
      headers: { "Content-Type": "application/json", "Content-Length": "8193" }
    });
    assert.equal(oversized.status, 413);
    const chunked = await send(server, "/api/material-analysis", {
      method: "POST", ip: `198.51.100.${ip++}`, body: "X".repeat(8193),
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }, chunked: true
    });
    assert.equal(chunked.status, 413);
    const multibyte = await send(server, "/api/material-analysis", {
      method: "POST", ip: `198.51.100.${ip++}`,
      body: JSON.stringify({ materialId: "汉".repeat(3000), language: "en" }),
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }, chunked: true
    });
    assert.equal(multibyte.status, 413, "Body limit is based on UTF-8 bytes, not JS characters.");
    assert.equal(server.calls().length, 2);

    await server.setMode("malformed");
    const badResult = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[2], language: "en"
    }, ip++);
    assert.equal(badResult.status, 502);
    await server.setMode("success");
    const recovered = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[2], language: "en"
    }, ip++);
    assert.equal(recovered.status, 200);
    assert.equal(server.calls().length, 4, "Malformed provider result must not be cached.");

    await server.setMode("provider-error");
    const providerFailure = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[3], language: "en"
    }, ip++);
    assert.equal(providerFailure.status, 502);
    assert.ok(!providerFailure.body.includes("fixture internal detail"), "Provider details stay server-side.");
  });

  await withServer({ model: "not-an-allowed-model" }, async (server) => {
    const rejected = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[0], language: "en", model: "gpt-4.1-mini"
    }, 50);
    assert.equal(rejected.status, 400, "Client model override is an unknown field.");
    const unavailable = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[0], language: "en"
    }, 51);
    assert.equal(unavailable.status, 503, "Disallowed server model fails safely.");
    assert.equal(server.calls().length, 0);
  });
}

async function testAiClientLimit(publicIds) {
  await withServer({}, async (server) => {
    const body = { materialId: publicIds[0], language: "en" };
    for (let i = 0; i < 3; i++) {
      assert.equal((await sendAi(server, "/api/material-analysis", body, 60)).status, 200);
    }
    const limited = await sendAi(server, "/api/material-analysis", body, 60);
    assertRateLimit(limited);
    assert.equal(server.calls().length, 1, "Cache hits still count toward client request limit.");
  });
}

async function testAiGlobalLimit(publicIds) {
  await withServer({}, async (server) => {
    for (let i = 0; i < 6; i++) {
      assert.equal((await sendAi(server, "/api/material-analysis", {
        materialId: publicIds[i], language: "en"
      }, 70 + i)).status, 200);
    }
    const limited = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[6], language: "en"
    }, 76);
    assertRateLimit(limited);
    assert.equal(server.calls().length, 6, "IP rotation cannot exceed process-wide provider budget.");
  });
}

async function testComparisonOrder(publicIds) {
  await withServer({}, async (server) => {
    const first = await sendAi(server, "/api/material-comparison", {
      materialIds: [publicIds[0], publicIds[1]], language: "en"
    }, 77);
    const reversed = await sendAi(server, "/api/material-comparison", {
      materialIds: [publicIds[1], publicIds[0]], language: "en"
    }, 78);
    assert.equal(first.status, 200);
    assert.equal(reversed.status, 200);
    assert.equal(server.calls().length, 2, "Comparison cache key preserves requested order.");
  });
}

async function testHttpConcurrency(publicIds) {
  await withServer({}, async (server) => {
    await server.setMode("hold");
    const first = beginAi(server, publicIds[0], 80);
    await server.waitForCalls(1);
    const sameClient = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[1], language: "en"
    }, 80);
    assertRateLimit(sameClient);
    const second = beginAi(server, publicIds[2], 81);
    await server.waitForCalls(2);
    const globalLimited = await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[3], language: "en"
    }, 82);
    assertRateLimit(globalLimited);
    assert.equal(server.calls().length, 2);
    for (const call of server.calls()) server.child.send({ type: "release", id: call.id });
    assert.equal((await first.promise).status, 200);
    assert.equal((await second.promise).status, 200);
    await server.setMode("success");
    assert.equal((await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[4], language: "en"
    }, 80)).status, 200, "Success releases the semaphore.");
  });
}

async function testHttpDedup(publicIds) {
  await withServer({}, async (server) => {
    await server.setMode("hold");
    const first = beginAi(server, publicIds[0], 90);
    await server.waitForCalls(1);
    const second = beginAi(server, publicIds[0], 91);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(server.calls().length, 1, "Two identical requests share one provider call.");
    server.child.send({ type: "release", id: server.calls()[0].id });
    assert.equal((await first.promise).status, 200);
    assert.equal((await second.promise).status, 200);
  });
}

async function testHttpDisconnect(publicIds) {
  await withServer({}, async (server) => {
    await server.setMode("hold");
    const first = beginAi(server, publicIds[0], 100);
    await server.waitForCalls(1);
    first.abort();
    await first.promise.catch(() => {});
    await server.waitForAbort(1);
    await server.setMode("success");
    assert.equal((await sendAi(server, "/api/material-analysis", {
      materialId: publicIds[1], language: "en"
    }, 100)).status, 200, "Disconnect aborts upstream and releases client/global capacity.");
  });
}

function assertRateLimit(response) {
  assert.equal(response.status, 429);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, "Rate limit exceeded");
  assert.ok(Number.isInteger(payload.retryAfterSeconds) && payload.retryAfterSeconds >= 1);
  assert.equal(response.headers["retry-after"], String(payload.retryAfterSeconds));
  assert.equal(response.headers["cache-control"], "no-store");
}

function sendAi(server, requestPath, body, number, extraHeaders = {}) {
  return send(server, requestPath, {
    method: "POST",
    ip: `198.51.100.${number}`,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body)
  });
}

function beginAi(server, materialId, number) {
  return beginRequest(server, "/api/material-analysis", {
    method: "POST",
    ip: `198.51.100.${number}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materialId, language: "en" })
  });
}

function send(server, requestPath, options = {}) {
  return beginRequest(server, requestPath, options).promise;
}

function beginRequest(server, requestPath, { method = "GET", headers = {}, body, ip, chunked = false } = {}) {
  const requestHeaders = { ...headers };
  if (ip) requestHeaders["X-Forwarded-For"] = ip;
  let request;
  const promise = new Promise((resolve, reject) => {
    request = http.request({
      hostname: "127.0.0.1",
      port: server.port,
      path: requestPath,
      method,
      headers: requestHeaders,
      timeout: 30_000
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Test request timed out")));
    if (body !== undefined && chunked) {
      const middle = Math.floor(body.length / 2);
      request.write(body.slice(0, middle));
      request.write(body.slice(middle));
      request.end();
    } else {
      request.end(body);
    }
  });
  return { promise, abort: () => request.destroy() };
}

async function withServer(options, callback) {
  const server = await startServer(options);
  try {
    await callback(server);
  } finally {
    server.child.kill();
    await Promise.race([
      new Promise((resolve) => server.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
    if (server.child.exitCode === null) server.child.kill("SIGKILL");
  }
}

async function startServer({ adminToken = adminFixture, model = "gpt-4.1-mini", trustProxy = "render" } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [__filename, "--fake-server"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      MATFINDER_DB_PATH: testDatabasePath,
      MATFINDER_ADMIN_TOKEN: adminToken,
      MATFINDER_TRUST_PROXY: trustProxy,
      OPENAI_API_KEY: openAiFixture,
      OPENAI_MODEL: model,
      MATFINDER_ALLOWED_ORIGINS: "https://frontend.example.test"
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let stdout = "";
  let stderr = "";
  const messages = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("message", (message) => messages.push(message));
  await waitUntil(() => stdout.includes('"phase":"after_http_listen"') || child.exitCode !== null, 20_000);
  if (child.exitCode !== null) throw new Error(`Test server exited: ${stderr || stdout}`);
  return {
    child,
    port,
    calls: () => messages.filter((item) => item.type === "provider-call"),
    waitForCalls: (count) => waitUntil(() => messages.filter((item) => item.type === "provider-call").length >= count, 10_000),
    waitForAbort: (count) => waitUntil(() => messages.filter((item) => item.type === "provider-abort").length >= count, 10_000),
    async setMode(value) {
      child.send({ type: "mode", value });
      await waitUntil(() => messages.some((item) => item.type === "mode-set" && item.value === value), 5000);
    }
  };
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
        reject(new Error("Timed out waiting for fake server state"));
      }
    }, 10);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
}
