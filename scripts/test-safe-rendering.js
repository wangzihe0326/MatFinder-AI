"use strict";
// SEC-01B: real browser regression. Install dev dependencies with npm ci.
// Runtime: Playwright Chromium (npx playwright install chromium), or an installed
// Chrome selected by PLAYWRIGHT_CHANNEL=chrome. Missing binaries FAIL, never skip.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once, EventEmitter } = require("node:events");
const { chromium } = require("playwright");
const { bootstrapFixture } = require("./schema-test-fixtures");
const { python } = require("./schema-authority-guard");
const root = path.resolve(__dirname, "..");
const marker = `TEST ONLY <img src="/audit-test-missing.png" onerror="document.body.dataset.auditXss='executed'">`;
const hostile = `TEST ONLY 中文 English ' " & < > &lt; ${"long material ".repeat(18)}<img data-sec01-injected src="/sec01-missing" onerror="document.body.dataset.auditXss='executed'"><svg data-sec01-injected onload="document.body.dataset.auditXss='executed'"></svg>`;
const boundaryId = `OUTPUT-BOUNDARY-ONLY ' " ><img data-sec01-injected onerror="document.body.dataset.auditXss='executed'"> &lt;`;
const pass = (name) => console.log(`PASS ${name}`);

function runtimeEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|HOME|LOCALAPPDATA|APPDATA)$/i.test(key)));
  return { ...env, NODE_ENV: "test", OPENAI_API_KEY: "", MATFINDER_ADMIN_TOKEN: "", PYTHONDONTWRITEBYTECODE: "1" };
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, env: runtimeEnvironment(), encoding: "utf8", windowsHide: true, ...options });
  assert.equal(result.status, 0, `${executable}: ${result.error || result.stderr || result.stdout}`);
  return result.stdout;
}

function inputMaterial(commercialGrade) {
  const source = { sourceType: "official_datasheet", sourceTitle: "TEST ONLY - NOT A REAL DATASHEET",
    sourceUrl: "https://example.invalid/test-only-identity", sourceDate: "2026-07-29",
    verificationStatus: "verified", confidenceLevel: "high", lastVerifiedAt: "2026-07-29" };
  return { manufacturer: "TEST ONLY - NOT A REAL MANUFACTURER", brand: null, commercialGrade,
    materialFamily: "PC", officialTdsLinks: [source.sourceUrl], identitySources: [source],
    properties: [["density", 1.2, "g/cm3", "ASTM D792", "23 degC; dry"],
      ["tensile_strength", 65, "MPa", "ASTM D638", "23 degC; dry"],
      ["hdt", 130, "degC", "ASTM D648", "1.8 MPa"],
      ["continuous_use_temperature", 110, "degC", "IEC 60216", "20,000 h criterion"]]
      .map(([propertyKey, value, unit, testStandard, testCondition]) => ({ propertyKey,
        measurements: [{ ...source, sourceUrl: `https://example.invalid/test-only-${propertyKey}`,
          value, unit, testStandard, testCondition, valueType: "typical" }] })),
    certifications: [{ ...source, sourceType: "manufacturer", certificationName: "RoHS",
      certificationStatus: "compliant", scope: "TEST ONLY - NOT A REAL CERTIFICATION SCOPE" }] };
}

function prepareRuntime(runtime) {
  // Copy reviewed runtime sources only, using working-tree bytes for the candidate.
  // Include explicitly bound policy additions before staging; no DB, .env,
  // arbitrary untracked files, handoff carrier, or production material dataset.
  const tracked = command("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "ls-files", "-z"]).split("\0");
  const scripts = new Set(["scripts/migrate.py", "scripts/real_material_importer.py",
    "scripts/material_import_schema.py", "scripts/build-catalog-stats.js"]);
  const sources = [...new Set([...tracked, ...require("../catalog-policy").POLICY_MANIFEST])];
  for (const file of sources.filter((file) => file !== "PROJECT_STATE.md" &&
    (/^[^/]+\.js$/.test(file) || /^public\/.*\.(js|html|css|svg)$/.test(file) ||
      file === "database-schema-contract.json" || scripts.has(file)))) {
    const target = path.join(runtime, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  fs.mkdirSync(path.join(runtime, "data", "pilot"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "data", "pilot", "pilot-plan.json"), JSON.stringify({
    target: 0, families: [], slots: [], note: "TEST ONLY isolated empty pilot plan" }));
  const database = path.join(runtime, "test-only.db");
  bootstrapFixture(database); // Canonical empty schema; never copy a production DB.
  const input = path.join(runtime, "test-only-input.json");
  fs.writeFileSync(input, JSON.stringify({ templateVersion: "TEST-ONLY", materials:
    [marker, "TEST ONLY 中文 English ' \" & < > &lt;", "TEST ONLY THIRD", "TEST ONLY FOURTH"].map(inputMaterial) }));
  const report = JSON.parse(command(python(), ["-B", "-c",
    "import sys,json; from pathlib import Path; sys.path.insert(0,str(Path('scripts').resolve())); from real_material_importer import execute_import; print(json.dumps(execute_import(Path(sys.argv[1]),Path(sys.argv[2]),allow_test_fixtures=True,operator='TEST ONLY',import_source='SEC-01B browser regression')))",
    database, input], { cwd: runtime }));
  assert.equal(report.status, "committed");
  command(process.execPath, ["scripts/build-catalog-stats.js", database], { cwd: runtime });
  pass("A: production importer committed four TEST ONLY records into canonical empty Temp DB");
  return database;
}

async function startServer(runtime, database) {
  const preload = path.join(runtime, "loopback-only.cjs");
  fs.writeFileSync(preload, `const net = require('node:net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(port, callback) {
  this.once('listening', () => process.send({ port: this.address().port, host: this.address().address }));
  return listen.call(this, 0, '127.0.0.1', callback);
};
const deny = () => { console.error('SEC01_UNEXPECTED_OUTBOUND'); throw Error('SEC-01B server outbound networking forbidden'); };
net.Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:http').request = deny;
require('node:https').request = deny;
global.fetch = deny;
`);
  const env = { ...runtimeEnvironment(), PORT: "0", MATFINDER_DB_PATH: database };
  const server = spawn(process.execPath, ["--require", preload, "server.js"], {
    cwd: runtime, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Isolated server startup timed out: ${logs}`)), 15000);
      server.once("message", (message) => { clearTimeout(timer); resolve(message); });
      server.once("error", (error) => { clearTimeout(timer); reject(error); });
      server.once("exit", () => { clearTimeout(timer); reject(Error(`Isolated server exited: ${logs}`)); });
    });
    assert.equal(address.host, "127.0.0.1");
    return { server, origin: `http://127.0.0.1:${address.port}`, logs: () => logs };
  } catch (error) {
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit"); server.kill(); await exited;
    }
    throw error;
  }
}

async function noExecution(page, label) {
  const result = await page.evaluate(() => ({ marker: document.body.dataset.auditXss || null,
    injected: document.querySelectorAll("[data-sec01-injected], img[src='/audit-test-missing.png']").length,
    handlers: [...document.querySelectorAll("*")].flatMap((node) => [...node.attributes])
      .filter((attribute) => /^on/i.test(attribute.name)).map((attribute) => attribute.name) }));
  assert.deepEqual(result, { marker: null, injected: 0, handlers: [] }, label);
}
async function contains(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
}
async function exactText(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector, text });
}
const analysisPayload = { overview: hostile, advantages: [hostile], limitations: [hostile], recommendedApplications: [hostile] };
const comparisonPayload = { selectionAdvice: hostile, keyDifferences: [hostile], strengthsAndWeaknesses: [hostile], recommendedUseCases: [hostile] };

async function browserChecks(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 720 } });
  context.setDefaultTimeout(10000);
  const errors = [], unexpected = [], details = [], externalClicks = [];
  let mocked = null, analysisMode = "success", comparisonMode = "success";
  let analysisCalls = 0, comparisonCalls = 0;
  const pending = [];
  const heldRequests = new EventEmitter();
  async function releaseHeldRequest() {
    if (!pending.length) await once(heldRequests, "request", { signal: AbortSignal.timeout(10000) });
    assert.equal(pending.length, 1, "Exactly one explicit AI mock request must be pending");
    await pending.shift()();
  }
  const allowedLinks = new Set();
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.addInitScript(() => { window.print = () => { document.body.dataset.testPrint = "called"; }; });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== origin) {
      if (allowedLinks.has(url.href)) { externalClicks.push(url.href); return route.fulfill({ contentType: "text/plain", body: "TEST ONLY intercepted evidence link" }); }
      unexpected.push(url.href); return route.abort();
    }
    if (url.pathname.includes("missing")) { unexpected.push(url.href); return route.abort(); }
    if (["/api/material-analysis", "/api/material-comparison"].includes(url.pathname)) {
      const body = route.request().postDataJSON();
      const comparison = url.pathname.endsWith("comparison");
      if (comparison) comparisonCalls++; else analysisCalls++;
      const mode = comparison ? comparisonMode : analysisMode;
      const fulfill = () => json(comparison ? { materialIds: body.materialIds, comparison: comparisonPayload }
        : { materialId: body.materialId, analysis: analysisPayload });
      if (mode === "hold") { pending.push(fulfill); heldRequests.emit("request"); return; }
      return mode === "error" ? json({ error: hostile }, 503) : fulfill();
    }
    if (mocked && url.pathname === "/api/admin/audit-summary") return json({});
    if (mocked && url.pathname === "/api/materials") {
      if (url.searchParams.has("audit")) return json({ items: mocked.items, total: mocked.items.length });
      const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 48);
      return json({ ...mocked.catalog, items: mocked.items.slice(offset, offset + limit), total: mocked.items.length });
    }
    if (mocked && url.pathname.startsWith("/api/materials/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/materials/".length));
      details.push(id);
      const item = mocked.items.find((entry) => entry.id === id);
      assert.ok(item, `Unexpected fixture detail ID: ${id}`);
      return json(item);
    }
    if (mocked && url.pathname === "/api/recommendation-candidates") return json({ items: mocked.items,
      total: mocked.items.length, eligibleTotal: mocked.items.length, referenceTotal: 0, complete: true, bounded: false });
    return route.continue();
  });
  // WebSockets are not used by this application. Block them before any page loads.
  await context.routeWebSocket("**/*", (socket) => { unexpected.push(socket.url()); socket.close(); });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/materials`);
    await page.locator(".material-card").first().waitFor();
    const catalog = await page.evaluate(async () => (await fetch("/api/materials?limit=48&offset=0&sort=match")).json());
    assert.equal(catalog.total, 4);
    const imported = catalog.items.find((item) => item.name === marker);
    assert.ok(imported, "Importer must preserve the complete historical marker name");
    const importedCard = page.locator(".material-card").filter({ has: page.locator("h3", { hasText: marker }) });
    assert.equal(await importedCard.locator("h3").textContent(), marker);
    await importedCard.locator(".detail-button").click();
    await contains(page, "#detailContent h2", marker);
    await exactText(page, "#analysisContent .analysis-block p", hostile);
    await page.keyboard.press("Escape");
    await importedCard.locator(".compare-button").click();
    await page.waitForFunction(() => state.selected.size === 1);
    await page.locator('a[data-route-link="compare"]').click();
    await contains(page, "#compareTableWrap", marker);
    await noExecution(page, "actual importer -> catalog/detail/compare");
    pass("A: historical marker inert; complete card/name, detail and compare work in Chromium");

    const detail = await page.evaluate(async (id) => (await fetch(`/api/materials/${encodeURIComponent(id)}`)).json(), imported.id);
    // Output-boundary response fixtures: these IDs are NOT importer-generated IDs.
    const items = [boundaryId, "MOCK-SECOND", "MOCK-THIRD", "MOCK-FOURTH"].map((id, index) => ({ ...detail, id,
      name: `${hostile} ${index}`, name_en: `${hostile} English ${index}`, name_zh: `${hostile} 中文 ${index}`,
      category: hostile, category_en: hostile, category_zh: hostile, abbr: hostile,
      summary: hostile, description_en: hostile, description_zh: hostile,
      tags: [hostile], uses: [hostile], applications_en: [hostile], applications_zh: [hostile],
      record_type: hostile, record_origin: hostile, scope_status: hostile, material_family: hostile }));
    mocked = { catalog, items };
    analysisMode = "hold";
    await page.goto(`${origin}/materials`);
    await page.locator(".material-card").first().waitFor();
    await page.locator("#languageSelect").selectOption("en");
    await page.evaluate(async () => { state.materialsPageSize = 2; await loadPublicMaterialPage(1); setRoute("materials"); });
    assert.equal(await page.locator(".material-card h3").first().textContent(), items[0].name_en);
    for (const selector of [".category", ".abbr", ".summary", ".tag"]) {
      assert.equal(await page.locator(".material-card").first().locator(selector).first().textContent(), hostile);
    }
    assert.equal(await page.locator(".detail-button").first().getAttribute("data-id"), boundaryId);
    await page.locator(".detail-button").first().click();
    await contains(page, "#detailContent h2", items[0].name_en);
    await contains(page, "#analysisContent", items[0].name_en);
    assert.ok(details.includes(boundaryId), "Exact special ID must reach the detail endpoint");
    assert.equal(await page.evaluate(() => state.activeMaterial.id), boundaryId);
    await noExecution(page, "catalog, ID and analysis loading");
    await page.waitForFunction(() => document.querySelector("#analysisStatus").textContent.length > 0);
    await releaseHeldRequest();
    await exactText(page, "#analysisContent .analysis-block p", hostile);
    assert.equal(await page.locator("#analysisContent .analysis-block p").first().textContent(), hostile);
    assert.equal(await page.locator("#analysisContent li").count(), 3);
    for (const value of await page.locator("#analysisContent li").allTextContents()) assert.equal(value, hostile);
    await contains(page, "#analysisContent .analysis-grid .analysis-block:last-child", items[0].name_en);
    await noExecution(page, "analysis success and source");
    const cachedCalls = analysisCalls;
    await page.keyboard.press("Escape");
    await page.locator(".detail-button").first().click();
    await exactText(page, "#analysisContent .analysis-block p", hostile);
    assert.equal(analysisCalls, cachedCalls, "Analysis cache replay must avoid a provider request");
    await page.keyboard.press("Escape");
    analysisMode = "success";
    // SEC01C-B01: long text must not widen a card's grid or let a hovered
    // sibling's actions cover this button. Keep the real pointer interaction.
    const secondCard = page.locator(".material-card").filter({
      has: page.locator('.detail-button[data-id="MOCK-SECOND"]')
    });
    const secondDetail = secondCard.locator(".detail-button");
    await page.locator(".material-card .card-actions").first().hover();
    await secondDetail.scrollIntoViewIfNeeded();
    const geometry = await secondDetail.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { id: button.dataset.id, receivesPointer: hit === button || button.contains(hit),
        cards: [...document.querySelectorAll(".material-card")].map((card) => {
          const bounds = card.getBoundingClientRect();
          const badge = card.querySelector(".abbr");
          return { id: card.querySelector(".detail-button").dataset.id,
            childrenContained: [...card.children].every((child) => {
              const box = child.getBoundingClientRect();
              return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 &&
                box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
            }),
            badgeContained: badge.scrollWidth <= badge.clientWidth + 1 && badge.scrollHeight <= badge.clientHeight + 1 };
        }) };
    });
    assert.equal(geometry.id, "MOCK-SECOND");
    for (const card of geometry.cards) {
      assert.equal(card.childrenContained, true, `Card content/actions overflow: ${card.id}`);
      assert.equal(card.badgeContained, true, `Long abbreviation overflows fixed badge: ${card.id}`);
    }
    assert.equal(geometry.receivesPointer, true, "MOCK-SECOND must receive the center-point pointer hit");
    await secondDetail.click();
    await contains(page, "#detailContent h2", items[1].name_en);
    pass("SEC01C-B01: 1280x720 long-text card geometry, sibling hover, hit-test and real detail click");
    const alternative = page.locator("#detailContent [data-profile-id]").first();
    assert.equal(await alternative.getAttribute("data-profile-id"), boundaryId);
    await alternative.click();
    await contains(page, "#detailContent h2", items[0].name_en);
    assert.equal(await page.evaluate(() => state.activeMaterial.id), boundaryId);
    await noExecution(page, "ranked alternative exact ID and click");
    await page.keyboard.press("Escape");
    await page.locator(".compare-button").nth(0).click();
    await page.waitForFunction(() => state.selected.size === 1);
    await page.locator(".compare-button").nth(1).click();
    await page.waitForFunction(() => state.selected.size === 2);
    await page.locator('a[data-route-link="compare"]').click();
    await contains(page, "#compareTableWrap", items[0].name_en);
    await contains(page, "#aiCompareContent", items[0].name_en);
    assert.equal(await page.locator("#compareTableWrap td").first().textContent(), hostile);
    await noExecution(page, "compare and comparison waiting status");
    comparisonMode = "hold";
    await page.locator("#runAiCompareButton").click();
    await contains(page, "#aiCompareContent", items[0].name_en);
    await page.waitForFunction(() => aiComparisonInteraction.pending !== null);
    await noExecution(page, "comparison loading");
    await releaseHeldRequest();
    await exactText(page, "#aiCompareContent .analysis-block p", hostile);
    assert.equal(await page.locator("#aiCompareContent li").count(), 3);
    for (const value of await page.locator("#aiCompareContent li").allTextContents()) assert.equal(value, hostile);
    await contains(page, "#aiCompareContent .analysis-grid .analysis-block:last-child", items[0].name_en);
    await noExecution(page, "comparison success and source");
    const compareCached = comparisonCalls;
    await page.locator("#runAiCompareButton").click();
    await exactText(page, "#aiCompareContent .analysis-block p", hostile);
    assert.equal(comparisonCalls, compareCached, "Comparison cache replay");
    analysisMode = "error"; comparisonMode = "error";
    await page.locator("#languageSelect").selectOption("zh");
    await page.locator("#runAiCompareButton").click();
    await exactText(page, "#aiCompareContent .analysis-block p", `${hostile}.`);
    await noExecution(page, "AI comparison error");
    comparisonMode = "success";
    await page.locator("#runAiCompareButton").click();
    await exactText(page, "#aiCompareContent .analysis-block p", hostile);
    await page.locator("#compareSelection [data-detail-id]").first().click();
    await exactText(page, "#analysisContent .analysis-block p", `${hostile}.`);
    await noExecution(page, "AI analysis error");
    await page.keyboard.press("Escape");
    analysisMode = "success";
    await page.locator("#compareSelection [data-detail-id]").first().click();
    await exactText(page, "#analysisContent .analysis-block p", hostile);
    await page.keyboard.press("Escape");
    await page.locator('a[data-route-link="materials"]').click();
    await page.locator("#materialsPagination select").selectOption("2");
    await page.waitForFunction(() => state.materialsPage === 2);
    assert.deepEqual(await page.evaluate(() => [...state.selected]), items.slice(0, 2).map((item) => item.id));
    await page.locator(".compare-button").nth(0).click();
    await page.waitForFunction(() => state.selected.size === 3);
    await page.locator(".compare-button").nth(1).click();
    await page.waitForFunction(() => state.selected.has("MOCK-FOURTH"));
    assert.deepEqual(await page.evaluate(() => [...state.selected]), items.slice(1).map((item) => item.id));
    await page.locator('a[data-route-link="compare"]').click();
    await page.locator("#compareSelection [data-remove-compare]").first().click();
    await page.waitForFunction(() => state.selected.size === 2);
    pass("B/C/D/F: catalog/compare fidelity, exact mock ID clicks, AI success/error/loading/waiting/source, retry/cache, language, max/add/remove and cross-page retention");

    await page.locator('a[data-route-link="home"]').click();
    await page.locator("#requirementInput").fill("lightweight");
    await page.locator("#recommendButton").click();
    await page.waitForFunction(() => !state.recommendationLoading);
    assert.equal(await page.evaluate(() => state.recommendationLoadError), false, "Mock candidate envelope must be accepted");
    assert.ok(await page.evaluate(() => state.recommendations.length > 0), "Existing engine must return test candidates");
    await page.locator(".recommendation-card").first().waitFor();
    await contains(page, "#recommendationResults", hostile);
    const specialRecommendation = page.locator(".recommendation-card").filter({ has: page.locator("h3", { hasText: items[0].name_zh }) });
    assert.equal(await specialRecommendation.locator("[data-detail-id]").getAttribute("data-detail-id"), boundaryId);
    await specialRecommendation.locator("[data-detail-id]").click();
    await contains(page, "#detailContent h2", items[0].name_zh);
    assert.equal(await page.evaluate(() => state.activeMaterial.id), boundaryId);
    await page.keyboard.press("Escape");
    await specialRecommendation.locator("[data-compare-id]").click();
    await page.waitForFunction((id) => state.selected.has(id), boundaryId);
    await noExecution(page, "recommendation UI and attribute boundaries");
    pass("C/D/F: recommendation actual recall/engine/result/detail/compare UI");

    // Exercise the four real renderers in Chromium with the same URL matrix.
    const valid = ["http://example.invalid/plain", "https://example.invalid/a%20b?q=%3Ctag%3E&quote=%22#part", "  HTTPS://EXAMPLE.INVALID/中文?q='\"&x=1#片段  "];
    const invalid = [null, 42, "", "javascript:alert(1)", "data:text/html,test", "/relative", "//example.invalid/a",
      "https://", "https:///path", "https://?query", "https://[bad", "https://exa mple.invalid", "http ://example.invalid",
      "https://exa%20mple.invalid", "https://example.invalid\\@misleading.invalid", "https://example.invalid/\u0085path",
      "https://example.in\nvalid/x", "https://example.invalid/\tpath", "https://example.invalid/\u0000", "java\tscript:alert(1)"];
    for (const value of [...valid, ...invalid]) {
      const expected = valid.includes(value) ? new URL(value.trim()).href : null;
      if (expected) allowedLinks.add(expected.split("#")[0]);
      await page.evaluate(({ value, text }) => {
        const source = { sourceTitle: text, sourceUrl: value };
        const host = document.getElementById("sec01-url-probe") || document.body.appendChild(document.createElement("section"));
        host.id = "sec01-url-probe";
        host.innerHTML = [renderPropertyEvidence({ evidence: { properties: { density: [{ value: text, unit: text, source }] } } }),
          renderIdentityEvidence({ evidence: { identity: { sources: [source] } } }),
          renderCertificationEvidence({ evidence: { certifications: [{ certificationName: text, source }] } }),
          renderRequirementEvidenceTable([{ requirement: text, explanation: text, evidenceSource: source }])]
          .map((html, index) => `<section data-consumer="${index}">${html}</section>`).join("");
      }, { value, text: hostile });
      for (let consumer = 0; consumer < 4; consumer++) {
        const links = page.locator(`#sec01-url-probe [data-consumer="${consumer}"] a`);
        assert.equal(await links.count(), expected ? 1 : 0, `URL consumer ${consumer}: ${JSON.stringify(value)}`);
        if (expected) {
          assert.equal(await links.getAttribute("href"), expected);
          assert.equal(await links.getAttribute("target"), "_blank");
          assert.equal(await links.getAttribute("rel"), "noopener noreferrer");
          const popupPromise = context.waitForEvent("page");
          await links.click();
          const popup = await popupPromise;
          await popup.waitForLoadState();
          assert.equal(await popup.locator("body").textContent(), "TEST ONLY intercepted evidence link");
          assert.equal(await popup.evaluate(() => window.opener), null);
          await popup.close();
        }
      }
      await noExecution(page, "four evidence URL consumers");
    }
    await page.locator("#sec01-url-probe").evaluate((node) => node.remove());
    assert.equal(externalClicks.length, valid.length * 4);
    pass(`E: four consumers x ${valid.length + invalid.length} URL cases; ${externalClicks.length} real clicks intercepted, zero outbound`);

    await page.locator('a[data-route-link="materials"]').click();
    await page.locator("#searchInput").fill(hostile);
    await page.waitForFunction((text) => state.query === text.toLowerCase(), hostile);
    await contains(page, "#activeFilters", hostile.toLowerCase());
    await noExecution(page, "search echo");
    await page.evaluate(() => setRoute("copilot"));
    await page.locator("#copilotInput").fill(hostile);
    await page.locator('#copilotForm button[type="submit"]').click();
    assert.equal((await page.locator(".copilot-message.is-user").last().textContent()).trim(), hostile);
    await noExecution(page, "Copilot echo");
    await page.evaluate(() => setRoute("audit"));
    await page.locator("#auditAdminToken").fill("TEST ONLY MOCK TOKEN");
    await page.locator('#auditAuthForm button[type="submit"]').click();
    await contains(page, "#auditRecordsGrid", hostile);
    await noExecution(page, "mock admin audit UI");
    // The real print action receives a verified test candidate, with hostile
    // display fields. No production eligibility or recommendation logic changes.
    await page.evaluate(({ item, text }) => {
      state.recommendationQuery = text;
      state.recommendationResult = { groups: { verifiedMatches: [{ material: item, bucket: "verified", score: 90,
        requirementResults: [{ requirement: text, materialValue: text, explanation: text, status: "satisfied" }], reasons: [text], warnings: [] }] } };
    }, { item: items[0], text: hostile });
    const printPromise = context.waitForEvent("page");
    await page.evaluate(() => exportMaterialSelectionReport());
    const report = await printPromise;
    await contains(report, "body", hostile);
    await report.waitForFunction(() => document.body.dataset.testPrint === "called");
    await noExecution(report, "actual HTML print popup");
    await report.close();
    pass("G: search/Copilot/admin echo and actual print popup preserve inert hostile text");

    // Formatted values are output-boundary fixtures, not importer numeric claims.
    await page.evaluate((text) => {
      const item = { ...materials[0], tg: text, tm: text, density: text, tensile: text, continuous_use_temperature: text };
      delete item.propertyProjections; // Retain the original legacy output-boundary coverage.
      renderCards([item]);
      selectedMaterialEntities.set(item.id, item); state.selected = new Set([item.id]); renderCompare();
    }, hostile);
    await contains(page, "#materialsGrid .metrics", hostile);
    assert.deepEqual(await page.locator("#materialsGrid .metric strong").allTextContents(),
      [`${hostile} deg C`, `${hostile} MPa`, `${hostile} g/cm3`, `${hostile} deg C / ${hostile} deg C`]);
    await contains(page, "#compareTableWrap", hostile);
    await noExecution(page, "formatted metric text");
    // Canonical projection output must independently preserve hostile context
    // and provenance as text; legacy scalar injection must not mask this path.
    await page.evaluate((text) => {
      const item=structuredClone(materials[0]);
      for(const projection of Object.values(item.propertyProjections)) {
        projection.standard=text;projection.condition=text;
        for(const entry of projection.entries) {
          entry.standard=text;entry.condition=text;
          for(const source of entry.supportingClaimRefs) {
            source.sourceTitle=text;source.sourceUrl="javascript:document.body.dataset.auditXss='executed'";
          }
        }
      }
      renderCards([item]);
      selectedMaterialEntities.set(item.id,item);state.selected=new Set([item.id]);renderCompare();
    },hostile);
    await contains(page,"#materialsGrid .metrics",hostile);
    await contains(page,"#materialsGrid .metrics","65 MPa");
    await contains(page,"#compareTableWrap",hostile);
    await contains(page,"#compareTableWrap","65 MPa");
    assert.equal(await page.locator('#compareTableWrap a[href^="javascript:"]').count(),0);
    await noExecution(page,"canonical projection context/source text");
    pass("FA-003: canonical measurement/context/provenance rendering inert in real Chromium");
    // FA-003 R1: actual Chrome rendering of full counts versus bounded references.
    // Policy creates metadata from complete TEST ONLY collections; the browser does not invent counts.
    const projectionPolicy = require("../property-projection-policy");
    for (const [count, oneSource] of [[0,false],[1,false],[8,false],[9,false],[12,false],[17,false],[12,true]]) {
      const rows=Array.from({length:count},(_,i)=>({material_id:items[0].id,property_key:"tensile_strength",
        id:i+1,position:i,value_numeric:65,unit:"MPa",value_type:"typical",test_standard:"TEST STANDARD",
        test_condition:"TEST CONDITION",verification_status:"verified",confidence_level:"medium",conflict_status:"none",
        source_type:"manufacturer",source_title:hostile,source_url:`https://example.invalid/r1/${i}`,
        source_id:oneSource?901:null,resolved_source_id:oneSource?901:null}));
      const projection=projectionPolicy.projectProperty(items[0].id,"tensile_strength",rows);
      for (const language of ["en","zh"]) {
        await page.evaluate(({item,projection,language})=>{
          const candidate=structuredClone(item);candidate.propertyProjections={tensile_strength:projection};
          selectedMaterialEntities.set(candidate.id,candidate);state.selected=new Set([candidate.id]);
          state.language=language;renderCompare();setRoute("compare");
        },{item:items[0],projection,language});
        const shown=Math.min(count,8), remaining=count-shown, sources=oneSource?1:count;
        await contains(page,"#compareTableWrap", count ? (language==="en"
          ? `Source records: ${sources}; evidence claims: ${count}; distinct reported values: 1.`
          : `来源记录：${sources}；证据条目：${count}；不同报告值：1。`) : (language==="en"
          ? "0 source references shown" : "已显示 0 项来源引用"));
        if(count) {
          await contains(page,"#compareTableWrap",language==="en"
            ? `Source references: ${shown} / ${count} shown; ${remaining} more in details.`
            : `来源引用：已显示 ${shown} / 共 ${count}；另有 ${remaining} 项可在详情查看。`);
          await contains(page,"#compareTableWrap",hostile);
        }
        assert.equal(await page.locator("#compareTableWrap a").count(),shown);
        await noExecution(page,`R1 ${count} reference count ${language}`);
      }
    }
    await page.evaluate(item=>{
      selectedMaterialEntities.set(item.id,item);state.selected.add(item.id);renderCompare();
    },items[1]);
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:720});
      const columns=await page.locator("#compareTableWrap tbody tr").first().locator("td")
        .evaluateAll(cells=>cells.map(el=>el.getBoundingClientRect().width));
      assert.equal(columns.length,2);
      assert.ok(Math.max(...columns)/Math.min(...columns)<1.1,
        "Long provenance must not squeeze the adjacent material column: "+JSON.stringify(columns));
    }
    await page.setViewportSize({width:1280,height:720});
    pass("FA-003 R1: EN/ZH 0/1/8/9/12/17 full/preview/remaining counts; 12 claims versus one source; hostile text inert in Chrome");
    assert.deepEqual(errors, [], "Browser JavaScript errors");
    assert.deepEqual(unexpected, [], "Unexpected requests must fail the test, even when blocked");
    pass("C: formatted values inert; no unexpected DOM handlers, JavaScript errors or network requests");
  } finally { await context.close(); }
}

async function main() {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-sec01-"));
  const relativeToRepo = path.relative(root, runtime);
  assert.ok(relativeToRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRepo), "Runtime must be outside repository");
  let child, browser;
  try {
    const database = prepareRuntime(runtime);
    child = await startServer(runtime, database);
    browser = await chromium.launch({ headless: true, env: runtimeEnvironment(),
      ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    console.log(`Browser: ${browser.version()}; channel=${process.env.PLAYWRIGHT_CHANNEL || "playwright-chromium"}`);
    await browserChecks(browser, child.origin);
    assert.ok(!child.logs().includes("SEC01_UNEXPECTED_OUTBOUND"), "Server attempted unexpected outbound network");
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      if (child && child.server.exitCode === null && child.server.signalCode === null) {
        const exited = once(child.server, "exit"); child.server.kill(); await exited;
      }
      const relative = path.relative(os.tmpdir(), runtime);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Cleanup must stay within Temp");
      fs.rmSync(runtime, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    }
  }
  pass("SEC-01B browser security regression; isolated runtime cleaned");
}
if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
