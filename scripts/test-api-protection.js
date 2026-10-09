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
const { MaterialRepository, AdminCapacityError } = require("../catalog-policy").loadCanonicalPolicy().repository;

const root = path.resolve(__dirname, "..");
const adminFixture = "AD02_TEST_ADMIN_TOKEN_ONLY";
const openAiFixture = "AD02_TEST_OPENAI_KEY_ONLY";
let testDatabasePath;

if (process.argv.includes("--fake-server")) {
  runFakeServer();
} else if (process.argv.includes("--admin-output-only")) {
  testAdminOutputBudgets().catch((error) => { console.error(error); process.exitCode = 1; });
} else if (process.argv.includes("--admin-capacity-only")) {
  testAdminCapacityResponse().catch((error) => { console.error(error); process.exitCode = 1; });
} else if (process.argv.includes("--audit-source-only")) {
  testAuditSourceResponse().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function runFakeServer() {
  // Test transport never loads developer env files or makes provider network calls.
  const exists = fs.existsSync;
  fs.existsSync = function(file) {
    if ([".env", ".env.local"].includes(path.basename(String(file)))) return false;
    return exists.apply(this, arguments);
  };
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
    assertNoAuditState(prompt);
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
  // Failure/backpressure injection belongs exclusively to this fake transport.
  // No production test flag or API hook is installed.
  const list = MaterialRepository.prototype.listMaterials;
  MaterialRepository.prototype.listMaterials = function(options) {
    if (options?.audit && mode === "admin-sql-error")
      this.database.prepare("SELECT missing_r1_test_column FROM materials").get();
    if (options?.audit && mode === "admin-plain-error")
      throw new Error("Admin request exceeds capacity");
    const result = list.apply(this, arguments);
    if (options?.audit && mode === "admin-response-overflow")
      result.items[0].summary = "X".repeat(4 * 1048576);
    if (options?.audit && mode === "admin-json-error")
      result.items[0].summary = { toJSON() { throw new Error("TEST ONLY JSON failure"); } };
    return result;
  };
  const seenAdminResponses = new WeakSet();
  const writeHead = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function(status) {
    if(this.req.url.includes("audit=1") && mode==="admin-head-throw")
      throw new Error("TEST ONLY persistent writeHead failure");
    return writeHead.apply(this,arguments);
  };
  const end = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function() {
    if(this.req.url.includes("audit=1") && this.statusCode===200 && mode==="admin-end-throw")
      throw new Error("TEST ONLY end failure");
    return end.apply(this,arguments);
  };
  const write = http.ServerResponse.prototype.write;
  http.ServerResponse.prototype.write = function(chunk, encoding, callback) {
    const cb = typeof encoding === "function" ? encoding : callback;
    if(this.req.url.includes("audit=1") && !seenAdminResponses.has(this)) {
      seenAdminResponses.add(this);
      this.once("finish",()=>process.send({type:"admin-finished"}));
    }
    if(this.req.url.includes("audit=1") && this.statusCode===200 && mode==="admin-write-throw")
      throw new Error("TEST ONLY write failure");
    if (mode === "admin-hold" && this.statusCode === 200 && this.req.url.includes("audit=1")) {
      const id=++sequence;
      return write.call(this,chunk,error=>{
        if(error)return cb?.(error);
        pending.set(id,()=>{pending.delete(id);cb?.();});
        this.once("close",()=>pending.delete(id));
        process.send({type:"admin-held",id,bytes:chunk.length});
      });
    }
    if (this.req.url.includes("audit=1") && this.statusCode === 200 &&
        ["admin-write-stall", "admin-write-progress", "admin-write-error"].includes(mode)) {
      const selected = mode;
      return write.call(this, chunk, error => {
        if (error) return cb?.(error);
        if (selected === "admin-write-stall") {
          process.send({type:"admin-write-stalled",bytes:chunk.length});
          return; // controlled missing completion; real paused socket is tested separately
        }
        if (selected === "admin-write-error") return cb?.(new Error("TEST ONLY write error"));
        setTimeout(() => { process.send({type:"admin-write-progress"}); cb?.(); }, 300);
      });
    }
    return write.apply(this, arguments);
  };
  require("../server");
}

async function main() {
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad02-"));
  testDatabasePath = path.join(testDirectory, "fixture.db");
  let primaryError;
  try {
    require("./schema-test-fixtures").copyPreparedFixture(testDatabasePath);
    addPublicTestMaterials(testDatabasePath);
    await require("./build-catalog-stats").buildCatalogStats(testDatabasePath);
    const repository = new MaterialRepository(testDatabasePath);
    let publicIds, auditOnly;
    try {
      const publicMaterials = repository.getRecommendationCandidates({ limit: 20 });
      assert.ok(publicMaterials.length >= 8, "Need public material fixtures for distinct AI cache keys.");
      assert.ok(publicMaterials.slice(0, 8).every((item) => item.data_quality.recommendation_eligible));
      publicIds = publicMaterials.map((item) => item.id);
      // The existing AI oversized-prompt fixture deliberately has a 128KiB
      // summary. Preserve it and its AI tests; the approved Admin row budget
      // must reject a page containing it before decoding the base material.
      assert.throws(() => repository.listMaterials({ audit: true, limit: 200 }),
        error => error instanceof AdminCapacityError && error.budget === "rowRawBytes");
      const auditId = repository.database.prepare("SELECT material_id FROM materials " +
        "WHERE record_origin='generated' AND catalog_visibility='admin_only' " +
        "ORDER BY material_id LIMIT 1").get()?.material_id;
      assert.ok(auditId, "Need an existing generated audit fixture");
      auditOnly = repository.getMaterialById(auditId, { audit: true });
      assert.equal(auditOnly?.data_quality?.level, "quarantined");
      assert.equal(repository.getMaterialById(auditId), null,
        "The audit fixture must remain outside the public boundary");
    } finally { repository.close(); }

    await testAdminCapacityResponse();
    await testAuditSourceResponse();
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
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    assert.equal(path.dirname(path.resolve(testDirectory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(testDirectory).startsWith("matfinder-ad02-"));
    try { fs.rmSync(testDirectory, { recursive: true, force: true }); }
    catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError],
        "API test failed and temporary fixture cleanup also failed");
      throw cleanupError;
    }
  }
}

// FA-004 S-A regression uses a separate empty formal-v1 DB and real HTTP consumers.
function assertNoAuditState(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.hasOwn(value, "audit_state"), false, "Public/AI contract excludes audit_state");
  for (const child of Object.values(value)) assertNoAuditState(child);
}
async function testAuditSourceResponse() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-fa004-audit-http-"));
  const databasePath = path.join(directory, "test-only.db");
  const previousDatabase = testDatabasePath;
  const publicIds = ["FA004-HTTP-A", "FA004-HTTP-B"];
  const adminId = "FA004-HTTP-ADMIN", quarantinedId = "FA004-HTTP-QUARANTINED";
  let repository;
  try {
    require("./schema-test-fixtures").bootstrapFixture(databasePath);
    const { insertMaterial, insertClaim } = require("./test-property-projection");
    const db = new DatabaseSync(databasePath);
    try {
      for (const [index, id] of [...publicIds, adminId, quarantinedId].entries()) {
        insertMaterial(db, id, id, "FA-004 HTTP TEST ONLY");
        const sourceId = index + 1;
        db.prepare("INSERT INTO evidence_sources (source_id,source_fingerprint,source_type," +
          "source_title,source_url,manufacturer,commercial_grade,material_family,created_at) " +
          "VALUES (?,?,'manufacturer','TEST ONLY normalized document',?,'TEST ONLY',?,'PC','2026-01-01')")
          .run(sourceId, "http-fixture-" + id, "https://example.invalid/" + id, id);
        db.prepare("UPDATE material_evidence SET source_id=?,source_title=NULL,source_url=NULL " +
          "WHERE material_id=?").run(sourceId, id);
        for (const [key, value] of [["density", 1.2], ["tensile_strength", 65]]) {
          insertClaim(db, id, key, value, {
            source_id: sourceId, source_title: null, source_url: null,
            manufacturer: "TEST ONLY", commercial_grade: id, material_family: "PC"
          });
        }
      }
      db.prepare("UPDATE materials SET catalog_visibility='admin_only' WHERE material_id=?").run(adminId);
      db.prepare("UPDATE material_property_evidence SET verification_status='quarantined' " +
        "WHERE material_id=? AND property_key='tensile_strength'").run(quarantinedId);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
    await require("./build-catalog-stats").buildCatalogStats(databasePath);
    repository = new MaterialRepository(databasePath);
    await repository.initializeCatalogStats();
    testDatabasePath = databasePath;
    await withServer({}, async (server) => {
      let ip = 100;
      const get = async (route, authorized = false, extra = {}) => {
        const response = await send(server, route, {
          ip: "198.51.100." + (++ip),
          headers: authorized ? { Authorization: "Bearer " + adminFixture } : {}, ...extra
        });
        return { ...response, json: JSON.parse(response.body) };
      };
      for (const route of ["/api/materials?audit=1", "/api/materials/" + adminId + "?audit=1",
        "/api/admin/audit-summary"]) {
        const denied = await get(route);
        assert.equal(denied.status, 401);
        assert.equal(denied.headers["www-authenticate"], "Bearer");
        assert.equal(denied.headers["cache-control"], "no-store");
        assert.deepEqual(denied.json, { error: "Administrator authentication required" });
      }
      const audit = await get("/api/materials?audit=1&limit=200", true);
      assert.equal(audit.status, 200);
      assert.equal(audit.headers["cache-control"], "no-store");
      assert.equal(audit.headers["x-total-count"], "4");
      assert.equal(audit.json.total, 4);
      const byId = new Map(audit.json.items.map(item => [item.id, item]));
      assert.equal(byId.size, 4);
      const canonical = repository.getMaterialById(publicIds[0]);
      const stats = await get("/api/catalog-stats");
      console.log(JSON.stringify({ scope: "S-A scoped verification", phase: "HTTP observed",
        canonicalQuality: canonical.data_quality.level,
        adminQuality: byId.get(publicIds[0]).data_quality.level,
        verifiedPropertyDataPoints: stats.json.verifiedPropertyDataPoints,
        auditStatePresent: Object.hasOwn(byId.get(publicIds[0]), "audit_state") }));
      assert.equal(canonical.data_quality.level, "medium");
      assert.equal(byId.get(publicIds[0]).data_quality.level, "medium",
        "FA-004 normalized-only Admin list must equal canonical medium");
      assert.equal(stats.status, 200);
      assert.equal(stats.json.verifiedPropertyDataPoints, 4);
      for (const id of [...publicIds, adminId, quarantinedId]) {
        const detail = await get("/api/materials/" + id + "?audit=1", true);
        assert.equal(detail.status, 200);
        assert.equal(detail.headers["cache-control"], "no-store");
        const expected = repository.getMaterialById(id, { audit: true });
        assert.deepEqual(detail.json.data_quality, expected.data_quality);
        for (const [key, value] of Object.entries(expected.data_quality)) {
          if (key !== "issues") assert.deepEqual(byId.get(id).data_quality[key], value);
        }
        assert.deepEqual(detail.json.audit_state, byId.get(id).audit_state);
        assert.deepEqual(Object.keys(detail.json).sort(), Object.keys(expected).sort(),
          "Audit detail preserves the prior detail contract");
        const state = byId.get(id).audit_state;
        assert.ok(state, "Authorized compact audit DTO preserves derived state");
        assert.deepEqual(Object.keys(state).sort(), ["access", "hold", "reasons"]);
        assert.equal(new Set(state.reasons).size, state.reasons.length);
        for (const reason of state.reasons) assert.match(reason, /^[a-z][a-z0-9_]*$/);
        if (publicIds.includes(id)) assert.deepEqual(state, {
          access: "catalog_boundary_eligible", hold: "none", reasons: []
        });
        else {
          assert.equal(state.access, "audit_only");
          assert.equal(state.hold, "quarantined");
          assert.ok(state.reasons.includes(id === adminId ? "admin_only" : "claim_quarantined"));
        }
      }
      assert.equal(byId.get(adminId).data_quality.level, "medium");
      assert.equal(byId.get(quarantinedId).data_quality.level, "low");
      assert.ok(byId.get(quarantinedId).audit_state.reasons.includes("insufficient_quality_evidence"));
      const pageIds = [];
      for (let offset = 0; offset < 4; offset++) {
        const page = await get("/api/materials?audit=1&limit=1&offset=" + offset, true);
        assert.equal(page.status, 200); assert.equal(page.json.total, 4);
        assert.equal(page.json.items.length, 1); pageIds.push(page.json.items[0].id);
      }
      assert.deepEqual(pageIds, audit.json.items.map(item => item.id));
      for (const route of ["/api/materials?limit=200", "/api/materials/" + publicIds[0],
        "/api/recommendation-candidates"]) {
        const response = await get(route, true);
        assert.equal(response.status, 200); assertNoAuditState(response.json);
      }
      for (const id of [adminId, quarantinedId]) {
        assert.equal((await get("/api/materials/" + id)).status, 404);
      }
      const injected = await get("/api/materials/" + adminId +
        "?audit=1&audit_state=none&hold=none&access=catalog_boundary_eligible", true);
      assert.deepEqual(injected.json.audit_state, byId.get(adminId).audit_state);
      assert.equal((await get("/api/materials/" + adminId + "?audit=1", true, {
        method: "POST", body: JSON.stringify({ audit_state: { hold: "none" } })
      })).status, 405);
      assert.deepEqual((await get("/api/materials/" + adminId + "?audit=1", true)).json.audit_state,
        byId.get(adminId).audit_state);
      assert.deepEqual((await get("/api/admin/audit-summary", true)).json, repository.getAuditStats());
      const analysis = await sendAi(server, "/api/material-analysis",
        { materialId: publicIds[0], language: "en" }, 1);
      assert.equal(analysis.status, 200); assertNoAuditState(JSON.parse(analysis.body));
      assert.deepEqual(Object.keys(JSON.parse(analysis.body)).sort(), ["analysis", "materialId", "materialName"]);
      const comparison = await sendAi(server, "/api/material-comparison",
        { materialIds: publicIds, language: "en" }, 2);
      assert.equal(comparison.status, 200); assertNoAuditState(JSON.parse(comparison.body));
      assert.deepEqual(Object.keys(JSON.parse(comparison.body)).sort(), ["comparison", "materialIds", "materialNames"]);
      assert.equal((await sendAi(server, "/api/material-analysis", {
        materialId: publicIds[0], language: "en", audit_state: { hold: "none" }
      }, 3)).status, 400);
    });
    console.log("FA-004 S-A audit HTTP canonical parity, audit-only DTO, auth, pagination, public/AI isolation and no write contract PASS.");
    console.log("S-B deferred global source qualification is not corrected or claimed by this S-A test.");
  } finally {
    testDatabasePath = previousDatabase;
    repository?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("matfinder-fa004-audit-http-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// FA-004B-R1: permanent HTTP regression. The first 2506/48 expectation was
// recorded red against the unchanged FA-004B server/repository before R1.
async function testAdminCapacityResponse() {
  testAdminJsonByteCount();
  await testAdminOutputBudgets();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-fa004-r1-http-"));
  const databasePath = path.join(directory, "test-only.db");
  const previousDatabase = testDatabasePath;
  const { insertMaterial, insertClaim } = require("./test-property-projection");
  const idAt = i => "R1-HTTP-" + String(i).padStart(3, "0");
  let ip = 10;
  const authorized = () => ({ ip:"198.18." + Math.floor(++ip/250) + "." + (ip%250+1),
    headers:{Authorization:"Bearer "+adminFixture} });
  const route = limit => "/api/materials?audit=1&limit="+limit;
  async function populateHigh(highIndices, count=2506, rowText) {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("BEGIN");
      db.prepare("DELETE FROM material_property_evidence").run();
      for (let i=0;i<200;i++) {
        const n=highIndices.includes(i) ? count : 2;
        if (n) insertClaim(db,idAt(i),"density",1.2);
        if (n>1) insertClaim(db,idAt(i),"tensile_strength",65);
        for (let j=1;j<=n-2;j++) insertClaim(db,idAt(i),"density",1.2,{
          position:j,test_condition:"TEST ONLY condition "+j,
          ...(rowText ? {source_title:rowText} : {})
        });
      }
      db.exec("COMMIT");
    } finally { db.close(); }
    // All fixture materials are audit-only: this regression does not widen the
    // independent offline Stats builder's original single-read contract.
    await require("./build-catalog-stats").buildCatalogStats(databasePath);
  }
  function checkPage(response,limit,highIndices,count=2506) {
    console.log(JSON.stringify({scope:"FA-004B-R1 Admin HTTP",limit,highIndices,count,
      status:response.status,bodyBytes:Buffer.byteLength(response.body),
      error:response.status===200 ? undefined : JSON.parse(response.body)}));
    assert.equal(response.status,200,"A supported complete Admin page must succeed");
    const page=JSON.parse(response.body);
    assert.equal(page.total,200);assert.equal(page.limit,limit);assert.equal(page.offset,0);
    assert.equal(page.hasMore,limit<200);assert.equal(page.items.length,limit);
    assert.deepEqual(page.items.map(item=>item.id),Array.from({length:limit},(_,i)=>idAt(i)));
    for (const index of highIndices.filter(i=>i<limit)) {
      const material=page.items[index];
      assert.equal(material.data_quality.level,count>=2?"medium":"low");
      const claims=Object.values(material.evidence.properties).flat();
      assert.equal(claims.length,count);
      if(count>2) assert.equal(material.evidence.properties.density[count-2].testCondition,
        "TEST ONLY condition "+(count-2));
      assert.equal(material.audit_state.access,"audit_only");
      assert.equal(material.audit_state.hold,"quarantined");
      assert.ok(material.audit_state.reasons.includes("admin_only"));
    }
    assert.equal(response.headers["cache-control"],"no-store");
    assert.equal(response.headers["x-total-count"],"200");
    const {jsonEncodedByteLength}=require("../material-repository");
    assert.equal(jsonEncodedByteLength(page),Buffer.byteLength(response.body));
    return page;
  }
  function checkK1(response) {
    assert.equal(response.status,503);assert.equal(response.headers["cache-control"],"no-store");
    assert.deepEqual(JSON.parse(response.body),{
      error:"Admin request exceeds capacity",code:"admin_capacity_exceeded"});
    assert.equal(response.headers["x-total-count"],undefined);
  }
  try {
    require("./schema-test-fixtures").bootstrapFixture(databasePath);
    const db=new DatabaseSync(databasePath);
    try {
      db.exec("BEGIN");
      for(let i=0;i<200;i++) insertMaterial(db,idAt(i),idAt(i),"R1 HTTP TEST ONLY");
      db.prepare("UPDATE materials SET catalog_visibility='admin_only'").run();
      db.exec("COMMIT");
    } finally {db.close();}
    testDatabasePath=databasePath;
    for(const limit of [48,200]) for(const position of [0,Math.floor(limit/2),limit-1]) {
      await populateHigh([position]);
      await withServer({},async server=>checkPage(await send(server,route(limit),authorized()),limit,[position]));
    }
    for(const count of [0,1,999,1000,1001,5001,10000]) {
      await populateHigh([0],count);
      await withServer({},async server=>{
        for(const limit of [48,200]) {
          const response=await send(server,route(limit),authorized());
          if(count===10000) checkK1(response); else checkPage(response,limit,[0],count);
        }
      });
    }
    await populateHigh([0,199]);
    await withServer({},async server=>{
      checkPage(await send(server,route(200),authorized()),200,[0,199]);
      const wave=await Promise.all(Array.from({length:4},()=>send(server,route(200),authorized())));
      assert.ok(wave.some(response=>response.status===200));
      for(const response of wave) response.status===200 ? checkPage(response,200,[0,199]) : checkK1(response);
      console.log(JSON.stringify({scope:"R1 real arriving concurrency",requests:4,statuses:wave.map(r=>r.status)}));
      const raw=net.connect(server.port,"127.0.0.1");
      raw.on("error",()=>{});
      await new Promise(resolve=>raw.once("connect",resolve));
      raw.pause();
      raw.write("GET "+route(200)+" HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer "+adminFixture+
        "\r\nX-Forwarded-For: 198.18.10.1\r\nConnection: close\r\n\r\n");
      await new Promise(resolve=>setTimeout(resolve,100));
      const whilePaused=await send(server,route(48),authorized());
      assert.ok([200,503].includes(whilePaused.status));
      if(whilePaused.status===503) checkK1(whilePaused);
      console.log(JSON.stringify({scope:"R1 real paused socket",secondStatus:whilePaused.status,
        note:"finish can occur after kernel buffering; this is not proof of client delivery"}));
      raw.destroy();
      await new Promise(resolve=>setTimeout(resolve,100));
      checkPage(await send(server,route(200),authorized()),200,[0,199]);
    });
    await populateHigh([0,50,100,199]);
    await withServer({},async server=>checkK1(await send(server,route(200),authorized())));
    await populateHigh([0],3,"汉".repeat(12000));
    await withServer({},async server=>checkK1(await send(server,route(48),authorized())));
    await populateHigh([0]);
    await withServer({},async server=>{
      // Authentication and existing rate limit run before ticket/admission.
      assert.equal((await send(server,route(48))).status,401);
      await server.setMode("admin-hold");
      const first=beginRequest(server,route(48),authorized());
      await waitUntil(()=>server.messages().some(m=>m.type==="admin-held"),5000);
      checkK1(await send(server,route(48),authorized()));
      assert.equal((await send(server,route(48))).status,401);
      const limitedOptions={ip:"198.18.20.20",headers:{Authorization:"Bearer "+adminFixture}};
      for(let attempt=0;attempt<10;attempt++) checkK1(await send(server,route(48),limitedOptions));
      assertRateLimit(await send(server,route(48),limitedOptions));
      const held=server.messages().find(m=>m.type==="admin-held");
      await server.setMode("success");
      server.child.send({type:"release",id:held.id});
      checkPage(await first.promise,48,[0]);
      checkPage(await send(server,route(48),authorized()),48,[0]);
      await server.setMode("admin-hold");
      const disconnected=beginRequest(server,route(48),authorized());
      const disconnectedResult=disconnected.promise.catch(()=>null);
      await waitUntil(()=>server.messages().filter(m=>m.type==="admin-held").length===2,5000);
      disconnected.abort();await disconnectedResult;
      await server.setMode("success");
      await new Promise(resolve=>setTimeout(resolve,100));
      checkPage(await send(server,route(48),authorized()),48,[0]);
      for(const mode of ["admin-sql-error","admin-plain-error","admin-json-error"]) {
        await server.setMode(mode);
        const error=await send(server,route(48),authorized());
        assert.equal(error.status,500,mode+" must not be reclassified as capacity");
        assert.equal(JSON.parse(error.body).code,undefined);
        if(mode==="admin-sql-error") assert.match(JSON.parse(error.body).detail,/no such column: missing_r1_test_column/);
        await server.setMode("success");
        checkPage(await send(server,route(48),authorized()),48,[0]);
      }
      await server.setMode("admin-response-overflow");
      checkK1(await send(server,route(48),authorized()));
      await server.setMode("success");
      checkPage(await send(server,route(48),authorized()),48,[0]);
      await server.setMode("admin-write-stall");
      const stalledStart=performance.now();
      const stalled=observePartialResponse(server,route(48),authorized());
      await waitUntil(()=>server.messages().some(m=>m.type==="admin-write-stalled"),5000);
      checkK1(await send(server,route(48),authorized()));
      const stalledResult=await stalled;
      const stalledMs=performance.now()-stalledStart;
      assert.equal(stalledResult.status,200);
      assert.equal(stalledResult.complete,false,"Headers-sent idle timeout closes, never appends K1");
      assert.ok(stalledResult.bytes>0 && stalledResult.bytes<1165013);
      assert.ok(!stalledResult.text.includes("admin_capacity_exceeded"));
      assert.ok(stalledMs>=3900 && stalledMs<9000);
      await server.setMode("success");
      checkPage(await send(server,route(48),authorized()),48,[0]);
      console.log(JSON.stringify({scope:"R1 deterministic transport stall",elapsedMs:stalledMs,
        status:stalledResult.status,bytes:stalledResult.bytes,complete:stalledResult.complete}));
      await server.setMode("admin-write-progress");
      const finishedBefore=server.messages().filter(m=>m.type==="admin-finished").length;
      const progressStart=performance.now();
      checkPage(await send(server,route(48),authorized()),48,[0]);
      await waitUntil(()=>server.messages().filter(m=>m.type==="admin-finished").length>finishedBefore,3000);
      const progressMs=performance.now()-progressStart;
      assert.ok(progressMs>4000,"Continuous transport progress must outlive the separate 4s idle interval");
      assert.ok(server.messages().filter(m=>m.type==="admin-write-progress").length>=17);
      await server.setMode("success");
      checkPage(await send(server,route(48),authorized()),48,[0]);
      console.log(JSON.stringify({scope:"R1 ongoing write progress",elapsedMs:progressMs,status:200}));
      await server.setMode("admin-write-error");
      const broken=await observePartialResponse(server,route(48),authorized());
      assert.equal(broken.status,200);assert.equal(broken.complete,false);
      await server.setMode("success");
      checkPage(await send(server,route(48),authorized()),48,[0]);
      for(const fault of ["admin-head-throw","admin-write-throw","admin-end-throw"]) {
        await server.setMode(fault);
        const outcome=await observePartialResponse(server,route(48),authorized()).catch(error=>({error:error.code}));
        assert.ok(outcome.error || outcome.status===200);
        assert.ok(!outcome.text?.includes("admin_capacity_exceeded"));
        await server.setMode("success");
        checkPage(await send(server,route(48),authorized()),48,[0]);
        console.log(JSON.stringify({scope:"R1 transport synchronous failure",fault,
          status:outcome.status,error:outcome.error,complete:outcome.complete}));
      }
    });
    console.log("FA-004B-R1 Admin HTTP completeness, K1, auth, byte admission and ticket cleanup PASS.");
  } finally {
    testDatabasePath=previousDatabase;
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("matfinder-fa004-r1-http-"));
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

// Exercise the exact production Admin serializer, with an in-memory writable
// transport. This isolates numerical equality/overflow from repository budgets.
async function testAdminOutputBudgets() {
  const capacity = require("../material-repository");
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const helpers = source.slice(source.indexOf("function acquireAdminTicket("), source.indexOf("function publicApiWeight("));
  let protectedPayload;
  const sandbox = { ...capacity, Buffer, setTimeout, clearTimeout, setImmediate, clearImmediate,
    zlib:require("node:zlib"), JSON:{stringify(value) {
      if(value===protectedPayload) throw new Error("Oversized response reached full serialization");
      return JSON.stringify(value);
    }} };
  vm.runInNewContext("let activeAdminTicket=null;\n" + helpers +
    "\nthis.output={acquireAdminTicket,sendAdminJson};", sandbox);
  class Response extends EventEmitter {
    constructor(gzip=false) {super();this.headers=new Map();this.acceptsGzip=gzip;this.destroyed=false;this.headersSent=false;this.bytes=0;}
    setHeader(name,value) {this.headers.set(name.toLowerCase(),value);}
    getHeader(name) {return this.headers.get(name.toLowerCase());}
    writeHead(status) {this.status=status;this.headersSent=true;}
    write(chunk,callback) {this.bytes+=chunk.length;setImmediate(callback);return true;}
    end() {this.emit("finish");}
    destroy() {this.destroyed=true;this.emit("close");}
  }
  const cancelledRequest=new EventEmitter();cancelledRequest.aborted=true;
  const cancelledResponse=new Response();cancelledResponse.destroyed=true;
  assert.throws(()=>sandbox.output.acquireAdminTicket(cancelledRequest,cancelledResponse),capacity.AdminRequestCancelledError);
  // The already-dispatched close event cannot rescue a leaked ticket.
  const retryRequest=new EventEmitter();retryRequest.aborted=false;
  const retryResponse=new Response();
  const retryTicket=sandbox.output.acquireAdminTicket(retryRequest,retryResponse);
  retryResponse.destroy();assert.equal(retryTicket.released,true);
  const MiB=1048576;
  for(const [label,responseBytes,pageBytes,accepted,gzip] of [
    ["response equals 4MiB",4*MiB,2,true,false],
    ["response exceeds 4MiB",4*MiB+1,2,false,false],
    ["gzip never discounts raw overflow",4*MiB+1,2,false,true],
    ["inflight equals 32MiB",4*MiB,4*MiB,true,false],
    ["inflight exceeds 32MiB",4*MiB,4*MiB+1,false,false]
  ]) {
    const payload={text:"X".repeat(responseBytes-11)};
    assert.equal(Buffer.byteLength(JSON.stringify(payload)),responseBytes);
    const request=new EventEmitter();request.aborted=false;
    const response=new Response(gzip);
    const ticket=sandbox.output.acquireAdminTicket(request,response);
    ticket.context.metrics.pageObjectBytes=pageBytes;
    if(accepted) {
      const finished=new Promise(resolve=>response.once("finish",resolve));
      sandbox.output.sendAdminJson(response,200,payload,ticket);
      await finished;
      assert.equal(response.bytes,responseBytes);assert.equal(ticket.released,true);
      assert.equal(ticket.accountedBytes,0);
    } else {
      protectedPayload=payload;
      assert.throws(()=>sandbox.output.sendAdminJson(response,200,payload,ticket),capacity.AdminCapacityError,label);
      assert.equal(response.headersSent,false);assert.equal(response.bytes,0);
      response.destroy();assert.equal(ticket.released,true);
      protectedPayload=undefined;
    }
    console.log(JSON.stringify({scope:"R1 output budget boundary",label,responseBytes,pageBytes,accepted,gzip}));
  }
}

function observePartialResponse(server, requestPath, options) {
  return new Promise((resolve,reject) => {
    const request=http.get({hostname:"127.0.0.1",port:server.port,path:requestPath,
      headers:{...options.headers,"X-Forwarded-For":options.ip}}, response=>{
      const chunks=[];
      let settled=false;
      const finish=()=>{
        if(settled)return;settled=true;
        const body=Buffer.concat(chunks);
        resolve({status:response.statusCode,complete:response.complete,bytes:body.length,text:body.toString("utf8")});
      };
      response.on("data",chunk=>chunks.push(chunk));
      response.on("end",finish);response.on("aborted",finish);response.on("error",finish);
    });
    request.on("error",reject);
    request.setTimeout(10000,()=>request.destroy(new Error("Response lifecycle probe timed out")));
  });
}

function testAdminJsonByteCount() {
  const {jsonEncodedByteLength}=require("../material-repository");
  const fixtures=[null,true,false,0,-0,1.2345,1e40,NaN,Infinity,-Infinity,
    "汉字😀e\u0301\ufeff\u0000\b\f\n\r\t\"\\", "\ud800", "\udfff", "\ud800x\udfff",
    [],{},[undefined,()=>0,Symbol("x"),null,,"x"],
    {a:undefined,b:()=>0,c:Symbol("x"),d:null,e:[1,{s:"汉😀"}]},
    new Date("2026-01-01T00:00:00.000Z"),new Number(3),new String("汉"),new Boolean(false),
    {toJSON(key){return {key,value:"normalized"};}},
    {nested:{toJSON(key){return key;}}}];
  for(const value of fixtures) assert.equal(jsonEncodedByteLength(value),Buffer.byteLength(JSON.stringify(value)));
  for(const value of [undefined,()=>0,Symbol("x")]) assert.equal(jsonEncodedByteLength(value),undefined);
  assert.throws(()=>jsonEncodedByteLength(1n),TypeError);
  assert.throws(()=>jsonEncodedByteLength(Object(1n)),TypeError);
  const cycle={};cycle.self=cycle;assert.throws(()=>jsonEncodedByteLength(cycle),TypeError);
  console.log("R1 independent preallocation JSON bytes equal native serialization for JSON types/Unicode/omissions PASS.");
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
    windowsHide: true,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC"].includes(key.toUpperCase()))),
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
    messages: () => [...messages],
    waitForCalls: (count) => waitUntil(() => messages.filter((item) => item.type === "provider-call").length >= count, 10_000),
    waitForAbort: (count) => waitUntil(() => messages.filter((item) => item.type === "provider-abort").length >= count, 10_000),
    async setMode(value) {
      const prior = messages.filter(item => item.type === "mode-set" && item.value === value).length;
      child.send({ type: "mode", value });
      await waitUntil(() => messages.filter(item => item.type === "mode-set" && item.value === value).length > prior, 5000);
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
