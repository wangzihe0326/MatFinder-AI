const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const families = require("../public/polymer-families");

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const startup = app.lastIndexOf("\ninit().catch(");
assert.ok(startup > 0, "The browser startup call must be isolated from this test.");

// Serialize DOM text for existing HTML assertions, matching browser escaping.
const htmlText = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.classList = { toggle() {} };
    this.hidden = false;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
  }
  get innerHTML() {
    return this.markup + this.children.map((node) => node.tag === "#text" ? htmlText(node.textContent)
      : `<${node.tag}>${node.innerHTML}</${node.tag}>`).join("");
  }
  set innerHTML(value) { this.markup = value; this.text = ""; this.children = []; }
  get textContent() { return (this.text || "") + this.children.map((node) => node.textContent).join(""); }
  set textContent(value) { this.innerHTML = htmlText(value); this.text = String(value ?? ""); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  emit(name, target = this) {
    const handler = this.listeners.get(name);
    assert.ok(handler, `Missing ${name} handler on ${this.tag}`);
    return handler({ target, preventDefault() {} });
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) {
    this.markup = ""; this.text = "";
    this.children = nodes.flatMap((node) => node.tag === "fragment" ? node.children : [node]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || new Element("button"); }
  querySelectorAll(selector) {
    if (this.queryMarkup !== this.innerHTML) {
      this.queryMarkup = this.innerHTML;
      this.queryNodes = new Map();
    }
    if (this.queryNodes.has(selector)) return this.queryNodes.get(selector);
    const buttons = [...this.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter(([, attributes]) => selector.startsWith(".")
        ? (attributes.match(/class="([^"]*)"/)?.[1] || "").split(/\s+/).includes(selector.slice(1))
        : selector.startsWith("[") && attributes.includes(selector.slice(1, -1) + "="))
      .map(([, attributes, text]) => {
        const button = new Element("button");
        button.textContent = text;
        for (const [, key, value] of attributes.matchAll(/data-([\w-]+)="([^"]*)"/g)) {
          button.dataset[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        }
        return button;
      });
    this.queryNodes.set(selector, buttons);
    return buttons;
  }
  showModal() { this.open = true; }
  close() {
    this.open = false;
    if (this.listeners.has("close")) this.emit("close");
  }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  closest() { return this; }
}

const nodes = new Map();
const document = {
  body: new Element("body"),
  documentElement: new Element("html"),
  querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector));
    return nodes.get(selector);
  },
  querySelectorAll: () => [],
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => { const node = new Element("#text"); node.textContent = text; return node; },
  createDocumentFragment: () => new Element("fragment")
};
let queuedTimer = null;
let fetchHandler = () => { throw new Error("Unexpected fetch"); };
const paths = [];
const context = vm.createContext({
  document, URL, URLSearchParams,
  fetch: (url, options) => { paths.push(url); return fetchHandler(url, options); },
  window: {
    MatFinderConfig: { apiBaseUrl: "" },
    MatFinderPolymerFamilies: families,
    MatFinderCatalogSearch: {
      matchesMaterial() { throw new Error("Commercial q filter ran in the browser"); },
      scoreMaterial() { throw new Error("Commercial relevance sort ran in the browser"); }
    },
    matchMedia: () => ({ matches: true }),
    clearTimeout: () => { queuedTimer = null; },
    setTimeout: (callback) => { queuedTimer = callback; return 1; },
    addEventListener() {},
    location: { pathname: "/materials" },
    history: { replaceState() {}, pushState() {} }
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "recommendation-engine.js"), "utf8"), context);
vm.runInContext(app.slice(0, startup), context, { filename: "public/app.js" });
const read = (expression) => vm.runInContext(expression, context);
const run = (expression) => vm.runInContext(expression, context);
const node = (selector) => document.querySelector(selector);
const descendants = (root) => [root, ...root.children.flatMap(descendants)];
const facetPayload = {
  categories: { all: 97, options: [{ value: "Metals", count: 9 }] },
  performance: { all: 97, groups: [{ id: "thermal", count: 7 }], options: [{ id: "heat-resistant", count: 5 }] },
  domains: { all: 97, options: [{ id: "automotive", count: 4 }] }
};
const grade = (id, temperature, maxTemp, quality = "high") => ({
  id, name: id, abbr: id, category: "Metals", summary: "Visible compact summary",
  tags: [], uses: [], continuous_use_temperature: temperature, maxTemp,
  tensile: 60, density: 1.2, tg: null, tm: null,
  data_quality: { level: quality }
});
const payload = (items, total = items.length, facets = facetPayload) => ({ items, total, facets });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fixedResponse = (body) => { fetchHandler = async () => ok(body); };

async function main() {
  await catalogStatsDegradationChecks();
  const state = read("state");
  state.route = "materials";
  state.language = "en";

  // 34–35: canonical mapping, inactive controls, and offset.
  let params = read("catalogQueryParams(1)");
  assert.deepEqual([...params.keys()].sort(), ["limit", "offset", "sort"]);
  assert.equal(params.get("limit"), "48");
  assert.equal(params.get("offset"), "0");
  state.query = "PA & PEEK";
  state.category = "Metals";
  state.property = "heat-resistant";
  state.domain = "automotive";
  state.minTemp = 100;
  state.minStrength = 25;
  state.recyclableOnly = true;
  state.sort = "temperature";
  params = read("catalogQueryParams(3)");
  assert.deepEqual(Object.fromEntries(params), {
    q: "PA & PEEK", category: "Metals", performance: "heat-resistant",
    domain: "automotive", minTempC: "100", minTensileMpa: "25",
    recyclable: "true", sort: "temperature", limit: "48", offset: "96"
  });

  // 37–45 and the historical false-zero case: use deliberately nonmatching page items.
  fixedResponse(payload([
    grade("SERVER-FIRST", 200, 220, "low"),
    grade("SERVER-SECOND", null, 180, "high")
  ], 97));
  state.recommendations = [{ material: { id: "SERVER-SECOND" }, score: 10000 }];
  await read("loadPublicMaterialPage(1)");
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("q"), "PA & PEEK");
  assert.equal(read("materialCatalogTotal"), 97);
  assert.equal(node("#resultTitle").textContent.endsWith("97"), true);
  assert.equal(node("#emptyState").hidden, true);
  assert.equal(node("#materialsPagination").children[0].textContent, "1-48 / 97");
  const cards = () => node("#materialsGrid").children.filter((child) => child.tag === "article");
  assert.deepEqual(cards().map((card) => card.innerHTML.match(/data-id="([^"]+)"/)[1]),
    ["SERVER-FIRST", "SERVER-SECOND"], "Server order must survive mixed quality and recommendation scores.");
  assert.ok(cards()[0].innerHTML.includes("<strong>200 deg C</strong>"));
  assert.ok(!cards()[0].innerHTML.includes("<strong>220 deg C</strong>"));
  assert.ok(cards()[1].innerHTML.includes("<span>Continuous use</span><strong>none</strong>") ||
    cards()[1].innerHTML.includes("<span>Continuous use</span><strong>None</strong>"));
  assert.ok(!cards()[1].innerHTML.includes("<strong>180 deg C</strong>"));

  // 42–44: all facet counts are server supplied, with fixed zero options retained.
  assert.equal(read('getPerformanceFilterCounts().get("heat-resistant")'), 5);
  assert.equal(read('getPerformanceFilterCounts().get("flame-retardant")') || 0, 0);
  assert.equal(read('getApplicationDomainCounts().get("automotive")'), 4);
  assert.equal(read('getApplicationDomainCounts().get("medical")') || 0, 0);
  assert.ok(descendants(node("#propertyFacetFilter")).some((entry) =>
    entry.dataset.property === "flame-retardant" && entry.innerHTML.endsWith("<strong>0</strong>")));
  assert.ok(descendants(node("#domainFacetFilter")).some((entry) =>
    entry.dataset.domain === "medical" && entry.innerHTML.endsWith("<strong>0</strong>")));
  assert.ok(descendants(node("#categoryFilter")).some((entry) =>
    entry.value === "Metals" && entry.selected));
  state.category = "SelectedZero";
  run("renderCategoryOptions()");
  assert.ok(descendants(node("#categoryFilter")).some((entry) =>
    entry.value === "SelectedZero" && entry.selected));

  // 45: total remains authoritative when a requested page has moved beyond the last page.
  fetchHandler = async (url) => ok(new URL(url, "http://test").searchParams.get("offset") === "48"
    ? payload([], 1)
    : payload([grade("RECOVERED-FIRST", 100, 130)], 1));
  await read("loadPublicMaterialPage(2)");
  assert.equal(state.materialsPage, 1);
  assert.equal(read("materialCatalogTotal"), 1);
  assert.equal(cards()[0].innerHTML.includes("RECOVERED-FIRST"), true);
  assert.equal(node("#emptyState").hidden, true);
  fixedResponse(payload([], 0));
  await read("loadPublicMaterialPage(1)");
  assert.equal(node("#emptyState").hidden, false);

  // 36 and 41: controls reset before fetch; page navigation retains the target page.
  run("bindEvents()");
  fixedResponse(payload([grade("PAGE", 100, 130)], 97));
  state.materialsPage = 3;
  node("#categoryFilter").emit("change", { value: "Metals" });
  assert.equal(state.materialsPage, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "0");
  node("#materialsPagination").children[2].emit("change", { value: "3" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.materialsPage, 3);
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "96");
  for (const [selector, event, target] of [
    ["#propertyFilter", "change", { value: "high-strength" }],
    ["#tempRange", "input", { value: "150" }],
    ["#strengthRange", "input", { value: "30" }],
    ["#recyclableOnly", "change", { checked: true }],
    ["#sortSelect", "change", { value: "name" }]
  ]) {
    state.materialsPage = 3;
    node(selector).emit(event, target);
    assert.equal(state.materialsPage, 1, `${selector} must reset page before fetching.`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "0");
  }
  for (const [selector, key, value] of [
    ["#propertyFacetFilter", "property", "flame-retardant"],
    ["#domainFacetFilter", "domain", "medical"]
  ]) {
    state.materialsPage = 3;
    node(selector).emit("click", { closest: () => ({ dataset: { [key]: value } }) });
    assert.equal(state.materialsPage, 1, `${key} facet must reset page before fetching.`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "0");
  }
  state.materialsPage = 3;
  node("#searchInput").emit("input", { value: "ABS" });
  assert.equal(state.materialsPage, 1);
  assert.ok(queuedTimer);
  queuedTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("q"), "abs");

  // 46: B wins even if A completes afterward; changing controls invalidates A before debounce.
  const pending = [];
  fetchHandler = () => new Promise((resolve) => pending.push(resolve));
  state.query = "PA";
  const requestA = read("loadPublicMaterialPage(1)");
  state.query = "PEEK";
  run("resetMaterialsPage(true)");
  const requestB = read("loadPublicMaterialPage(1)");
  pending[1](ok(payload([grade("NEW", 100, 120)], 1)));
  await requestB;
  pending[0](ok(payload([grade("OLD", 100, 120)], 1)));
  await requestA;
  assert.equal(read("materials[0].id"), "NEW");
  assert.equal(cards()[0].innerHTML.includes("NEW"), true);

  const delayed = [];
  fetchHandler = () => new Promise((resolve) => delayed.push(resolve));
  state.query = "PA";
  const pendingOld = read("loadPublicMaterialPage(1)");
  node("#searchInput").emit("input", { value: "PEEK" });
  delayed[0](ok(payload([grade("OBSOLETE", 100, 120)], 1)));
  await pendingOld;
  assert.equal(read("materials[0].id"), "NEW",
    "A control edit must invalidate an older request even during search debounce.");
  queuedTimer();
  delayed[1](ok(payload([grade("CURRENT", 100, 120)], 1)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read("materials[0].id"), "CURRENT");

  // 47: family learning still uses its own matcher and the shared search text.
  run("polymerFamilies = window.MatFinderPolymerFamilies.families");
  state.query = "ABS";
  run("renderFamilySearchResults()");
  assert.ok(node("#familySearchResults").innerHTML.includes("ABS"));
  state.query = "absorption";
  run("renderFamilySearchResults()");
  assert.ok(!node("#familySearchResults").innerHTML.includes("ABS"));

  // 49: 400 and network errors show fixed user-safe text, never raw internals.
  for (const failure of [
    async () => ({ ok: false, status: 400, json: async () => ({ error: "SQL secret path C:\\private" }) }),
    async () => { throw new Error("C:\\private\\database.sql stack trace"); }
  ]) {
    fetchHandler = failure;
    await read("loadPublicMaterialPage(1)");
    assert.equal(node("#emptyState").hidden, false);
    assert.equal(node("#emptyState").textContent, "Unavailable");
    assert.ok(!node("#emptyState").textContent.includes("private"));
  }

  // Newest failure must retire the previous page, pagination and facet counts.
  const oldFacets = {
    categories: { all: 73, options: [{ value: "Metals", count: 73 }] },
    performance: { all: 73, groups: [], options: [{ id: "heat-resistant", count: 37 }] },
    domains: { all: 73, options: [{ id: "automotive", count: 29 }] }
  };
  fixedResponse(payload([grade("STALE-GRADE", 100, 130)], 73, oldFacets));
  state.category = "all";
  await read("loadPublicMaterialPage(1)");
  assert.equal(cards().length, 1);
  assert.equal(node("#materialsPagination").children.length, 4);
  fetchHandler = async () => ({ ok: false, status: 400, json: async () => ({ error: "SQL path C:\\private" }) });
  node("#categoryFilter").emit("change", { value: "Plastics" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cards().length, 0);
  assert.equal(read("materialCatalogTotal"), 0);
  assert.equal(node("#materialsPagination").children.length, 0);
  assert.equal(node("#emptyState").textContent, "Unavailable");
  assert.equal(node("#emptyState").hidden, false);
  assert.ok(!node("#emptyState").textContent.includes("private"));
  assert.ok(!descendants(node("#categoryFilter")).some((entry) => entry.tag === "option" && entry.value === "Metals"));
  assert.ok(descendants(node("#propertyFacetFilter")).some((entry) =>
    entry.dataset.property === "heat-resistant" && entry.innerHTML.endsWith("<strong>0</strong>")));
  assert.ok(descendants(node("#domainFacetFilter")).some((entry) =>
    entry.dataset.domain === "automotive" && entry.innerHTML.endsWith("<strong>0</strong>")));

  // A failure completed off-route must still retire old cards when Materials is reopened.
  fixedResponse(payload([grade("OFF-ROUTE-OLD", 100, 130)], 73, oldFacets));
  await read("loadPublicMaterialPage(1)");
  const offRoute = [];
  fetchHandler = () => new Promise((resolve) => offRoute.push(resolve));
  node("#categoryFilter").emit("change", { value: "Ceramics" });
  run('setRoute("home")');
  offRoute[0]({ ok: false, status: 400 });
  await new Promise((resolve) => setImmediate(resolve));
  run('setRoute("materials")');
  assert.equal(cards().length, 0);
  assert.equal(node("#materialsPagination").children.length, 0);
  assert.equal(node("#emptyState").textContent, "Unavailable");

  // A stale failure after a newer success must not clear the successful page.
  const failures = [];
  fetchHandler = () => new Promise((resolve, reject) => failures.push({ resolve, reject }));
  const staleFailure = read("loadPublicMaterialPage(1)");
  state.query = "fresh";
  run("resetMaterialsPage(true)");
  const freshSuccess = read("loadPublicMaterialPage(1)");
  failures[1].resolve(ok(payload([grade("FRESH-GRADE", 100, 130)], 1)));
  await freshSuccess;
  failures[0].reject(new Error("SQL private path"));
  await staleFailure;
  assert.equal(cards()[0].innerHTML.includes("FRESH-GRADE"), true);
  assert.equal(read("materialCatalogTotal"), 1);
  assert.equal(read("catalogLoadError"), false);
  assert.equal(node("#emptyState").hidden, true);

  // An old pagination control cannot supersede a pending sort-reset request.
  fixedResponse(payload([grade("PAGE-THREE", 100, 130)], 192));
  await read("loadPublicMaterialPage(3)");
  const oldNext = node("#materialsPagination").children[3];
  const oldSelect = node("#materialsPagination").children[2];
  const resetRequests = [];
  fetchHandler = () => new Promise((resolve) => resetRequests.push(resolve));
  const beforeReset = paths.length;
  node("#sortSelect").emit("change", { value: "strength" });
  assert.equal(state.materialsPage, 1);
  assert.equal(node("#materialsPagination").children.length, 0);
  oldNext.emit("click");
  oldSelect.emit("change", { value: "4" });
  assert.equal(paths.length, beforeReset + 1, "Old controls must not issue a newer page request.");
  assert.equal(resetRequests.length, 1);
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "0");
  resetRequests[0](ok(payload([grade("RESET-PAGE-ONE", 100, 130)], 96)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.materialsPage, 1);
  assert.equal(cards()[0].innerHTML.includes("RESET-PAGE-ONE"), true);
  fixedResponse(payload([grade("RESET-PAGE-TWO", 100, 130)], 96));
  node("#materialsPagination").children[3].emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.materialsPage, 2, "New pagination must operate after the reset succeeds.");
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "48");

  // A page beyond response.total is re-fetched at the last valid page.
  const recoveryOffsets = [];
  fetchHandler = async (url) => {
    const offset = new URL(url, "http://test").searchParams.get("offset");
    recoveryOffsets.push(offset);
    return ok(offset === "96" ? payload([], 50) : payload([
      grade("LAST-49", 100, 130), grade("LAST-50", 100, 130)
    ], 50));
  };
  await read("loadPublicMaterialPage(3)");
  assert.deepEqual(recoveryOffsets, ["96", "48"]);
  assert.equal(state.materialsPage, 2);
  assert.equal(cards().length, 2);
  assert.equal(node("#materialsPagination").children[0].textContent, "49-50 / 50");
  fixedResponse(payload([], 0));
  await read("loadPublicMaterialPage(3)");
  assert.equal(state.materialsPage, 1);
  assert.equal(cards().length, 0);
  assert.equal(node("#emptyState").hidden, false);
  assert.equal(node("#materialsPagination").children.length, 0);

  // Recommendation actions change presentation, never the independent catalog page.
  fixedResponse(payload([grade("RECOMMENDATION-PAGE-THREE", 100, 130)], 192));
  await read("loadPublicMaterialPage(3)");
  state.route = "home";
  node("#requirementInput").value = "cached requirement";
  state.recommendationCache.set("cached requirement", {
    recommendations: [], criteria: [], status: "empty",
    groups: { verifiedMatches: [], potentialMatches: [], rejectedMaterials: [] }
  });
  const beforeRecommendation = paths.length;
  await node("#recommendButton").emit("click");
  assert.equal(state.materialsPage, 3);
  node("#clearRecommendationButton").emit("click");
  assert.equal(state.materialsPage, 3);
  assert.equal(paths.length, beforeRecommendation, "Cached recommendation actions must not query the catalog.");
  run('setRoute("materials")');
  assert.equal(cards()[0].innerHTML.includes("RECOMMENDATION-PAGE-THREE"), true);
  assert.equal(node("#materialsPagination").children[2].children[2].selected, true);
  fixedResponse(payload([grade("RECOMMENDATION-PAGE-FOUR", 100, 130)], 192));
  node("#materialsPagination").children[3].emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "144");
  assert.equal(state.materialsPage, 4);
  fixedResponse(payload([grade("RECOMMENDATION-PAGE-THREE", 100, 130)], 192));
  node("#materialsPagination").children[1].emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(paths.at(-1), "http://test").searchParams.get("offset"), "96");
  assert.equal(state.materialsPage, 3);

  await recommendationFrontendChecks();
  await entityFrontendChecks();
  await comparisonFrontendChecks();
  await assertDensityTagConsumers(densityConsumerFixturePages());
  process.stdout.write("AD-04 frontend catalog regressions 34–49 passed.\n");
}

async function catalogStatsDegradationChecks() {
  const generation = { formatVersion: 1, datasetDigest: "a".repeat(64), policyDigest: "b".repeat(64) };
  const aggregate = { polymerFamilies: 7, verifiedCommercialGrades: 3, verifiedPropertyDataPoints: 6,
    materialsAwaitingVerification: 5, generation };
  const page = { ...payload([grade("AD08-BROWSE", 110, 120)]), generation };
  let statsMode = "good";
  const mainPaths = [];
  fetchHandler = async (url) => {
    mainPaths.push(url);
    if (url === "/api/catalog-stats") {
      if (statsMode === "network") throw new Error("Stats unavailable");
      if (statsMode === "503") return { ok: false, status: 503 };
      if (statsMode === "json") return { ok: true, json: async () => { throw new Error("Malformed JSON"); } };
      return { ok: true, json: async () => statsMode === "mismatch"
        ? { ...aggregate, generation: { ...generation, datasetDigest: "c".repeat(64) } }
        : statsMode === "malformed" ? { ...aggregate, verifiedCommercialGrades: -1 }
          : statsMode === "zero" ? { ...aggregate, verifiedCommercialGrades: 0, verifiedPropertyDataPoints: 0, materialsAwaitingVerification: 0 }
            : aggregate };
    }
    return { ok: true, json: async () => url.startsWith("/api/materials") ? page
      : url === "/api/polymer-families" ? [] : { target: 0 } };
  };
  for (statsMode of ["good", "network", "503", "json", "mismatch", "malformed", "zero"]) {
    mainPaths.length = 0;
    await read("loadMaterials()");
    assert.equal(read("materials[0].id"), "AD08-BROWSE", statsMode);
    assert.equal(read("materialCatalogTotal"), 1);
    assert.equal(mainPaths.length, 4, "No polling/rebuilding");
    read("renderCatalogStats()");
    if (["good", "zero"].includes(statsMode)) {
      assert.equal(String(node("#homeVerifiedGradeCount").textContent), statsMode === "zero" ? "0" : "3");
      assert.notEqual(read("catalogLayerStats"), null);
    } else {
      assert.equal(read("catalogLayerStats"), null, statsMode);
      assert.equal(node("#homeVerifiedGradeCount").textContent, read('t("unavailable")'));
    }
  }
  statsMode = "good"; await read("loadMaterials()");
  let releaseStats;
  const pendingStats = new Promise((resolve) => { releaseStats = resolve; });
  fetchHandler = async (url) => ({ ok: true, json: async () => url === "/api/catalog-stats"
    ? pendingStats : url.startsWith("/api/materials") ? page : url === "/api/polymer-families" ? [] : { target: 0 } });
  await read("loadMaterials()");
  assert.equal(read("materials[0].id"), "AD08-BROWSE", "Delayed stats never block core loading");
  assert.equal(read("catalogLayerStats"), null);
  read("renderCatalogStats()");
  assert.equal(node("#homeVerifiedGradeCount").textContent, read('t("unavailable")'));
  releaseStats(aggregate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(String(node("#homeVerifiedGradeCount").textContent), "3", "Late matching stats can render");
  fixedResponse({ ...page, generation: null });
  await read("loadPublicMaterialPage(1)");
  assert.equal(read("catalogLayerStats"), null, "Invalid page generation clears old stats");
  for (const newerGeneration of [null, { ...generation, datasetDigest: "d".repeat(64) }]) {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    fetchHandler = async (url) => ({ ok: true, json: async () => url === "/api/catalog-stats"
      ? pending : url.startsWith("/api/materials") ? page : url === "/api/polymer-families" ? [] : { target: 0 } });
    await read("loadMaterials()");
    fixedResponse({ ...page, generation: newerGeneration });
    await read("loadPublicMaterialPage(1)");
    release(aggregate);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(read("catalogLayerStats"), null, "Late old stats cannot overwrite newer null/different page G");
    read("renderCatalogStats()");
    assert.equal(node("#homeVerifiedGradeCount").textContent, read('t("unavailable")'));
  }
  statsMode = "good";
  fetchHandler = async (url) => url === "/api/catalog-stats"
    ? { ok: false, status: 503 } : { ok: false, status: 500 };
  await assert.rejects(read("loadMaterials()"), /Failed to load/, "Core loader failures remain fatal");
  console.log("AD-08 frontend stats degradation, real zeroes and generation mismatch regressions passed.");
}

function recommendationGrade(id, tensile = 40) {
  const claim = (key, value, unit) => ({
    propertyKey: key, value, unit, testStandard: "ASTM D638", testCondition: "23 C",
    valueType: "typical", verificationStatus: "verified", confidenceLevel: "high",
    conflictStatus: "none", source: {
      sourceType: "manufacturer", sourceTitle: "FRONTEND TEST FIXTURE ONLY",
      sourceUrl: "https://example.invalid/frontend-fixture", sourceDate: "2026-01-01"
    }
  });
  return {
    id, name: id, name_en: id, name_zh: id, abbr: "PC", category: "Plastics",
    category_en: "Plastics", category_zh: "Plastics", summary: "Frontend fixture",
    description_en: "Frontend fixture", description_zh: "Frontend fixture",
    record_type: "commercial_grade", entityType: "commercial_grade", uses: [],
    applications_en: [], applications_zh: [], tags: [], disadvantages: [], recyclable: true,
    maxTemp: 110, continuous_use_temperature: 110, tensile, density: 1.2,
    elongation: null, tg: null, tm: null, dielectric: null, notes: null,
    data_quality: {
      level: "high", recommendation_eligible: true, reference_only: false,
      verification_status: "verified", confidence_level: "high", issues: []
    },
    evidence: { properties: {
      tensile_strength: [claim("tensile_strength", tensile, "MPa")],
      density: [claim("density", 1.2, "g/cm3")],
      hdt: [claim("hdt", 125, "degC")],
      continuous_use_temperature: [claim("continuous_use_temperature", 110, "degC")]
    }, certifications: [] }
  };
}

async function recommendationFrontendChecks() {
  const state = read("state");
  state.route = "home";
  state.language = "en";
  const query = "tensile strength at least 50 MPa";
  const items = [...Array.from({ length: 200 }, (_, index) => recommendationGrade("A" + index)),
    recommendationGrade("Z999-BEST", 80)];
  const envelope = (entries = items) => ({
    items: entries, total: entries.length,
    eligibleTotal: entries.filter((item) => item.data_quality.recommendation_eligible).length,
    referenceTotal: entries.filter((item) => item.data_quality.reference_only).length,
    complete: true, bounded: false
  });
  const engine = context.window.MatFinderAI;
  const factory = engine.createRecommendationService;
  let ranked = 0;
  let supplied;
  engine.createRecommendationService = function (options) {
    supplied = options.materials;
    const service = factory(options);
    return { async recommend(description, options) { ranked += 1; return service.recommend(description, options); } };
  };
  try {
    state.recommendationCache.clear();
    node("#requirementInput").value = query;
    fixedResponse(envelope());
    await read("runRecommendation()");
    assert.equal(paths.at(-1), "/api/recommendation-candidates");
    assert.strictEqual(supplied, items, "Pass the full array directly to the existing engine.");
    assert.equal(ranked, 1);
    assert.equal(state.recommendationResult.provider, "evidence-rules-v3");
    assert.equal(state.recommendationResult.groups.verifiedMatches[0].material.id, "Z999-BEST");
    assert.ok(node("#recommendationResults").innerHTML.includes("Z999-BEST"));
    const cachedFetches = paths.length;
    node("#requirementInput").value = "  " + query + "  ";
    await read("runRecommendation()");
    assert.equal(paths.length, cachedFetches);
    assert.equal(ranked, 1);

    // Isolate total/items completeness: every other envelope constraint is valid.
    state.recommendationCache.clear();
    const mismatchedTotal = { ...envelope(), total: items.length + 1 };
    assert.equal(mismatchedTotal.total, 202);
    assert.equal(mismatchedTotal.items.length, 201);
    assert.equal(new Set(mismatchedTotal.items.map((item) => item.id)).size, 201);
    assert.equal(mismatchedTotal.eligibleTotal + mismatchedTotal.referenceTotal, 201);
    const beforeTotalMismatch = ranked;
    const mismatchFetches = paths.length;
    fixedResponse(mismatchedTotal);
    await read("runRecommendation()");
    assert.equal(ranked, beforeTotalMismatch, "An otherwise valid total mismatch must not reach the engine.");
    assert.equal(state.recommendationResult, null);
    assert.equal(state.recommendations.length, 0);
    assert.equal(state.recommendationLoadError, true);
    assert.equal(state.recommendationLoading, false);
    assert.equal(state.recommendationCache.size, 0);
    assert.ok(node("#recommendationResults").innerHTML.includes('role="alert"'));
    fixedResponse(envelope());
    await read("runRecommendation()");
    assert.equal(paths.length, mismatchFetches + 2, "The same requirement must fetch again after total mismatch.");
    assert.equal(ranked, beforeTotalMismatch + 1);
    assert.equal(state.recommendationLoadError, false);
    assert.equal(state.recommendationResult.provider, "evidence-rules-v3");
    assert.equal(state.recommendationCache.size, 1);

    const malformed = [null, [], "invalid", { ...envelope(), complete: false },
      { ...envelope(), bounded: true }, { ...envelope(), total: 200 },
      { ...envelope(), items: undefined }, { ...envelope(), items: {} },
      ...["total", "eligibleTotal", "referenceTotal"].flatMap((key) =>
        [-1, 0.5, "201", null].map((value) => ({ ...envelope(), [key]: value }))),
      { ...envelope(), eligibleTotal: 202 }, { ...envelope(), referenceTotal: 202 },
      { ...envelope(), referenceTotal: 1 }, { ...envelope(), eligibleTotal: 200 },
      envelope([items[0], items[0]]), { ...envelope([]), items: [null], total: 1 },
      { ...envelope([]), items: [{}], total: 1 }];
    for (const body of malformed) {
      state.recommendationCache.clear();
      fixedResponse(body);
      const before = ranked;
      await read("runRecommendation()");
      assert.equal(ranked, before, "Malformed/incomplete candidates must not be ranked.");
      assert.equal(state.recommendationResult, null);
      assert.equal(state.recommendationLoadError, true);
      assert.equal(state.recommendationLoading, false);
      assert.equal(state.recommendationCache.size, 0);
      assert.ok(node("#recommendationResults").innerHTML.includes('role="alert"'));
      assert.ok(!node("#recommendationResults").innerHTML.includes("No trustworthy candidate"));
    }

    const reference = recommendationGrade("L-REFERENCE");
    reference.data_quality = { ...reference.data_quality, level: "low", recommendation_eligible: false, reference_only: true };
    const quarantined = recommendationGrade("Q-NONRANKING");
    quarantined.data_quality = { ...quarantined.data_quality, level: "quarantined", recommendation_eligible: false, reference_only: false };
    fixedResponse(envelope([items.at(-1), reference, quarantined]));
    const beforeQ = ranked;
    await read("runRecommendation()");
    assert.equal(ranked, beforeQ + 1, "E + L may be less than total because Q exists.");

    for (const failure of [
      async () => ({ ok: false, status: 500, json: async () => { throw new Error("PRIVATE_SQL_PATH_STACK"); } }),
      async () => { throw new Error("PRIVATE_SQL_PATH_STACK"); },
      async () => ({ ok: true, status: 200, json: async () => { throw new Error("PRIVATE_SQL_PATH_STACK"); } }),
      async () => ({ ok: true, status: 206, json: async () => envelope() })
    ]) {
      state.recommendationCache.clear();
      fetchHandler = failure;
      const before = ranked;
      await read("runRecommendation()");
      assert.equal(ranked, before);
      assert.equal(state.recommendationResult, null);
      assert.equal(state.recommendationCache.size, 0);
      assert.equal(state.recommendationLoadError, true);
      assert.equal(node("#recommendationResults")["aria-busy"], "false");
      assert.ok(!node("#recommendationResults").innerHTML.includes("PRIVATE_SQL_PATH_STACK"));
      state.language = "zh";
      read("renderRecommendations()");
      assert.ok(node("#recommendationResults").innerHTML.includes("\u8bf7\u91cd\u8bd5"));
      state.language = "en";
      fixedResponse(envelope());
      await read("runRecommendation()");
      assert.equal(ranked, before + 1, "The same requirement must be retryable after failure.");
      assert.equal(state.recommendationLoadError, false);
    }

    state.recommendationCache.clear();
    fixedResponse(envelope([]));
    const beforeEmpty = ranked;
    await read("runRecommendation()");
    assert.equal(ranked, beforeEmpty + 1);
    assert.equal(state.recommendationResult.status, "no_safe_match");
    assert.equal(state.recommendationLoadError, false);
    assert.ok(!node("#recommendationResults").innerHTML.includes('role="alert"'));
    assert.equal(state.recommendationCache.size, 1, "Complete empty success is cacheable.");

    // Latest request wins; duplicate clicks do not create another evaluation.
    for (const staleFails of [true, false]) {
      state.recommendationCache.clear();
      const pending = [];
      fetchHandler = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
      node("#requirementInput").value = query + " old";
      const old = read("runRecommendation()");
      const duplicate = read("runRecommendation()");
      const requests = [old, duplicate];
      let duplicateChecksCompleted = false;
      try {
        // Inspect synchronously before awaiting a potentially unsuppressed fetch.
        assert.equal(pending.length, 1, "A duplicate trigger must not queue a second fetch.");
        assert.equal(node("#recommendationResults")["aria-busy"], "true");
        node("#requirementInput").value = query + " new";
        const latest = read("runRecommendation()");
        requests.push(latest);
        assert.equal(pending.length, 2);
        pending[1].resolve(ok(envelope()));
        await latest;
        const result = state.recommendationResult;
        const afterLatest = ranked;
        if (staleFails) pending[0].reject(new Error("PRIVATE_STALE_FAILURE"));
        else pending[0].resolve(ok(envelope([])));
        await Promise.all([old, duplicate]);
        assert.strictEqual(state.recommendationResult, result);
        assert.equal(state.recommendationQuery, query + " new");
        assert.equal(ranked, afterLatest);
        assert.equal(state.recommendationLoadError, false);
        assert.equal(state.recommendationLoading, false);
        assert.equal(state.recommendationCache.has(query + " old"), false);
        duplicateChecksCompleted = true;
      } finally {
        // Drain even when the queue assertion fails under a negative control.
        for (const request of pending) request.resolve(ok(envelope([])));
        await Promise.allSettled(requests);
      }
      assert.equal(duplicateChecksCompleted, true, "Duplicate-trigger assertions must complete.");
    }

    // Also reject stale results/failures after a request has reached evaluation.
    for (const evaluationFails of [true, false]) {
      state.recommendationCache.clear();
      let releaseEvaluation;
      engine.createRecommendationService = function (options) {
        const service = factory(options);
        return { async recommend(description, options) {
          ranked += 1;
          const result = await service.recommend(description, options);
          if (description.endsWith(" old evaluation")) {
            return new Promise((resolve, reject) => { releaseEvaluation = { resolve, reject, result }; });
          }
          return result;
        } };
      };
      fixedResponse(envelope());
      node("#requirementInput").value = query + " old evaluation";
      const oldEvaluation = read("runRecommendation()");
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(releaseEvaluation);
      node("#requirementInput").value = query + " new evaluation";
      await read("runRecommendation()");
      const newest = state.recommendationResult;
      if (evaluationFails) releaseEvaluation.reject(new Error("PRIVATE_EVALUATION_FAILURE"));
      else releaseEvaluation.resolve(releaseEvaluation.result);
      await oldEvaluation;
      assert.strictEqual(state.recommendationResult, newest);
      assert.equal(state.recommendationLoadError, false);
      assert.equal(state.recommendationLoading, false);
      assert.equal(state.recommendationCache.has(query + " old evaluation"), false);
    }
    state.recommendationCache.clear();
    engine.createRecommendationService = () => ({ recommend: async () => { throw new Error("PRIVATE_EVALUATION_FAILURE"); } });
    fixedResponse(envelope());
    await read("runRecommendation()");
    assert.equal(state.recommendationResult, null);
    assert.equal(state.recommendationLoadError, true);
    assert.equal(state.recommendationCache.size, 0);
    assert.ok(!node("#recommendationResults").innerHTML.includes("PRIVATE_EVALUATION_FAILURE"));
    engine.createRecommendationService = factory;

    state.recommendationCache.clear();
    let release;
    fetchHandler = () => new Promise((resolve) => { release = resolve; });
    const cleared = read("runRecommendation()");
    node("#clearRecommendationButton").emit("click");
    release(ok(envelope()));
    await cleared;
    assert.equal(state.recommendationResult, null);
    assert.equal(state.recommendationQuery, "");
    assert.equal(state.recommendationLoading, false);
    assert.equal(state.recommendationLoadError, false);
    assert.equal(state.recommendationCache.size, 0);
    process.stdout.write("AD-05 frontend integration passed: canonical complete 201, unchanged evidence-rules-v3, malformed rejection, E/L/Q counts, safe retry, complete empty, cache and stale/clear safety.\n");
  } finally { engine.createRecommendationService = factory; }
}

async function entityFrontendChecks() {
  const state = read("state");
  let passed = 0;
  const selectedIds = () => Array.from(read("getSelectedMaterials()"), (item) => item.id);
  const analysis = (id, language) => ({
    overview: `ANALYSIS-${id}-${language}`, advantages: [], limitations: [], recommendedApplications: []
  });
  const full = (id, tensile = 80) => {
    for (const language of ["en", "zh"]) state.analysisCache.set(`${language}:${id}`, analysis(id, language));
    return {
      ...recommendationGrade(id, tensile), name: `FULL-${id}`, name_en: `FULL-${id}`, name_zh: `FULL-${id}-ZH`,
      notes: `FULL-NOTES-${id}`, manufacturer: "ENTITY TEST FIXTURE ONLY",
      evidence: { ...recommendationGrade(id, tensile).evidence, identity: { sources: [] } }
    };
  };
  const reset = () => {
    run("closeDetail(); materialDetailCache.clear(); selectedMaterialEntities.clear(); compareSelectionIntents.clear()");
    assert.equal(read("materialDetailRequests.size"), 0, "Every prior request must finish before reset.");
    state.selected.clear(); state.compareErrors.clear(); state.analysisCache.clear();
    state.selectedMaterialId = null; state.activeMaterial = null; state.activeMaterialError = null;
    state.recommendations = []; state.recommendationResult = null; state.recommendationCache.clear();
    state.recommendationCriteria = []; state.recommendationLoading = false; state.recommendationLoadError = false;
    state.route = "home"; state.language = "en";
    node("#requirementInput").value = "";
    paths.length = 0;
    fetchHandler = () => { throw new Error("Unexpected entity-test request"); };
  };
  const check = async (name, action) => {
    reset();
    await action();
    passed++;
    process.stdout.write(`AD-06 PASS ${passed}: ${name}\n`);
  };
  const page = async (items, pageNumber = 1, total = 96) => {
    fixedResponse(payload(items, total));
    await read(`loadPublicMaterialPage(${pageNumber})`);
  };
  const respondDetails = (entries) => {
    fetchHandler = async (url, options) => {
      assert.equal(options, undefined, "Entity tests must never invoke an AI POST.");
      const id = decodeURIComponent(url.slice("/api/materials/".length));
      assert.ok(url.startsWith("/api/materials/") && entries.has(id), `Unexpected detail request ${url}`);
      return ok(entries.get(id));
    };
  };
  const deferredDetails = () => {
    const pending = new Map();
    fetchHandler = (url, options) => {
      assert.equal(options, undefined, "Only mocked detail GETs are allowed.");
      assert.ok(url.startsWith("/api/materials/"));
      assert.equal(pending.has(url), false, `Concurrent request was not deduplicated: ${url}`);
      return new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
    };
    return pending;
  };
  const complete = (pending, id, item) => pending.get(`/api/materials/${encodeURIComponent(id)}`).resolve(ok(item));
  const recommendB = async () => {
    const A = recommendationGrade("A", 40), B = recommendationGrade("B", 80);
    await page([A]);
    state.route = "home";
    node("#requirementInput").value = "tensile strength at least 50 MPa";
    fixedResponse({ items: [A, B], total: 2, eligibleTotal: 2, referenceTotal: 0, complete: true, bounded: false });
    await read("runRecommendation()");
    assert.equal(state.recommendations[0].material.id, "B");
    return { A, B };
  };
  const recommendationAction = (attribute, id) => {
    const button = node("#recommendationResults").querySelectorAll(`[data-${attribute}]`)
      .find((entry) => entry.dataset[attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === id);
    assert.ok(button, `Missing real recommendation ${attribute} action for ${id}`);
    return button.emit("click");
  };

  await check("cross-page recommendation detail uses full entity without mutating either snapshot", async () => {
    const { A, B } = await recommendB();
    const snapshots = [JSON.stringify(A), JSON.stringify(B)];
    const detailB = full("B"); respondDetails(new Map([["B", detailB]])); paths.length = 0;
    await recommendationAction("detail-id", "B");
    assert.deepEqual(paths, ["/api/materials/B"]);
    assert.equal(state.selectedMaterialId, "B"); assert.equal(state.activeMaterial, detailB);
    assert.ok(node("#detailContent").innerHTML.includes("FULL-B"));
    assert.equal(node("#detailDialog").open, true);
    assert.deepEqual(Array.from(read("materials"), (item) => item.id), ["A"]);
    assert.deepEqual([JSON.stringify(A), JSON.stringify(B)], snapshots);
  });

  await check("recommendation compare and cross-page A/B pair follow selection order", async () => {
    await recommendB();
    respondDetails(new Map([["A", full("A")], ["B", full("B")]]));
    await recommendationAction("compare-id", "B"); await read('toggleCompare("A")');
    read('setRoute("compare")');
    assert.deepEqual(selectedIds(), ["B", "A"]);
    assert.deepEqual(Array.from(read("getAiComparePair()"), (item) => item.id), ["B", "A"]);
    const table = node("#compareTableWrap").children[0].innerHTML;
    assert.ok(table.indexOf("FULL-B") < table.indexOf("FULL-A"));
    assert.equal(Number(node("#selectedCount").textContent), 2);
    assert.ok(node("#recommendationResults").innerHTML.includes('aria-pressed="true"'));
  });

  await check("pagination and zero-result filtering preserve selected entity and removal", async () => {
    respondDetails(new Map([["A", full("A")]])); await read('toggleCompare("A")');
    state.route = "compare"; await page([recommendationGrade("C")], 2);
    assert.deepEqual(selectedIds(), ["A"]);
    assert.ok(node("#compareTableWrap").children[0].innerHTML.includes("FULL-A"));
    await page([], 1, 0);
    assert.deepEqual([...state.selected], ["A"]); assert.deepEqual(selectedIds(), ["A"]);
    assert.equal(Number(node("#selectedCount").textContent), 1);
    fetchHandler = () => { throw new Error("Removal must not fetch"); };
    const remove = node("#compareSelection").querySelectorAll("[data-remove-compare]")[0];
    await remove.emit("click");
    assert.equal(state.selected.size, 0); assert.equal(Number(node("#selectedCount").textContent), 0);
  });

  await check("active entity survives page replacement, language rerender and cache eviction", async () => {
    const detailA = full("A"); respondDetails(new Map([["A", detailA]]));
    await read('showDetail("A")'); await read('toggleCompare("A")');
    state.recommendations = [{ material: recommendationGrade("B"), score: 90 }];
    await page([recommendationGrade("C")], 2);
    node("#languageSelect").value = "zh"; node("#languageSelect").emit("change");
    assert.equal(state.activeMaterial, detailA); assert.equal(read("getCopilotContext().item.id"), "A");
    assert.ok(node("#analysisTitle").textContent.includes("FULL-A-ZH"));
    assert.ok(node("#analysisContent").innerHTML.includes("ANALYSIS-A-zh"));
    const entries = new Map(Array.from({ length: 31 }, (_, index) => [`E${index}`, full(`E${index}`)]));
    respondDetails(entries);
    for (const id of entries.keys()) await read(`resolveMaterialById(${JSON.stringify(id)})`);
    assert.equal(read("materialDetailCache.size"), 30); assert.equal(read('materialDetailCache.has("A")'), false);
    assert.equal(state.activeMaterial, detailA); assert.equal(read("getSelectedMaterials()[0]"), detailA);
    read("rerenderActiveAnalysis(); renderCompare()");
    assert.equal(read("getCopilotContext().item.id"), "A"); assert.deepEqual(selectedIds(), ["A"]);
  });

  await check("existing catalog buttons still open full detail and add/remove compare", async () => {
    const compactA = recommendationGrade("A"); state.route = "materials"; await page([compactA]);
    respondDetails(new Map([["A", full("A")]]));
    const card = node("#materialsGrid").children.find((item) => item.tag === "article");
    await card.querySelector(".detail-button").emit("click");
    await card.querySelector(".compare-button").emit("click");
    assert.deepEqual(selectedIds(), ["A"]); assert.ok(node("#detailContent").innerHTML.includes("FULL-A"));
    await read('toggleCompare("A")'); assert.equal(state.selected.size, 0);
    assert.equal(compactA.name, "A"); assert.equal(compactA.notes, null);
    assert.equal(read("materials[0]"), compactA);
  });

  await check("same-ID page replacement keeps full resolver entity independent", async () => {
    const detailA = full("A"); const firstA = recommendationGrade("A");
    await page([firstA]); respondDetails(new Map([["A", detailA]])); await read('showDetail("A")');
    const nextA = recommendationGrade("A"); await page([nextA]);
    fetchHandler = () => { throw new Error("Full entity should be cached"); };
    await read('showDetail("A")');
    assert.equal(await read('resolveMaterialById("A")'), detailA);
    assert.equal(state.activeMaterial, detailA); assert.notEqual(state.activeMaterial, nextA);
    assert.equal(firstA.notes, null); assert.equal(nextA.notes, null);
    assert.ok(node("#detailContent").innerHTML.includes("FULL-A"));
  });

  await check("same-ID detail/compare deduplicate and pending dedup survives cache pressure", async () => {
    const detailB = full("B"); const pending = deferredDetails();
    const detail = read('showDetail("B")'), compare = read('toggleCompare("B")');
    assert.deepEqual(paths, ["/api/materials/B"]);
    complete(pending, "B", detailB); await Promise.all([detail, compare]);
    assert.equal(state.activeMaterial, read("getSelectedMaterials()[0]"));
    const delayed = read('resolveMaterialById("DELAYED")');
    const delayedEntity = full("DELAYED");
    const requests = Array.from({ length: 31 }, (_, index) => ({ id: `P${index}`, entity: full(`P${index}`) }));
    const resolutions = requests.map(({ id }) => read(`resolveMaterialById(${JSON.stringify(id)})`));
    for (const { id, entity } of requests) complete(pending, id, entity);
    await Promise.all(resolutions);
    const again = read('resolveMaterialById("DELAYED")');
    assert.equal(paths.filter((url) => url === "/api/materials/DELAYED").length, 1);
    complete(pending, "DELAYED", delayedEntity);
    assert.equal(await delayed, delayedEntity); assert.equal(await again, delayedEntity);
    assert.ok(read("materialDetailCache.size") <= 30);
  });

  await check("detail A/B reverse response order cannot overwrite B", async () => {
    const A = full("A"), B = full("B"); const pending = deferredDetails();
    const first = read('showDetail("A")'), second = read('showDetail("B")');
    complete(pending, "B", B); await second;
    const visibleB = node("#detailContent").innerHTML;
    complete(pending, "A", A); await first;
    assert.equal(state.activeMaterial, B); assert.equal(state.selectedMaterialId, "B");
    assert.equal(node("#detailContent").innerHTML, visibleB);
    assert.ok(node("#analysisContent").innerHTML.includes("ANALYSIS-B-en"));
    read('materialDetailCache.delete("A")');
    const failing = deferredDetails(), staleFailure = read('showDetail("A")');
    await read('showDetail("B")');
    const currentContent = node("#detailContent").innerHTML;
    failing.get("/api/materials/A").reject(new Error("STALE-DETAIL-FAILURE"));
    await staleFailure;
    assert.equal(state.activeMaterial, B); assert.equal(state.activeMaterialError, null);
    assert.equal(node("#detailContent").innerHTML, currentContent);
  });

  await check("button, backdrop, Escape and native close invalidate pending detail", async () => {
    for (const [index, close] of [
      () => node("#closeDialogButton").emit("click"),
      () => node("#detailDialog").emit("click"),
      () => node("#detailDialog").emit("cancel"),
      () => node("#detailDialog").close()
    ].entries()) {
      const id = `CLOSE${index}`, entity = full(id), pending = deferredDetails();
      const opening = read(`showDetail(${JSON.stringify(id)})`); close();
      const closedContent = node("#detailContent").innerHTML;
      complete(pending, id, entity); await opening;
      assert.equal(node("#detailDialog").open, false); assert.equal(state.activeMaterial, null);
      assert.equal(state.selectedMaterialId, null); assert.equal(node("#detailContent").innerHTML, closedContent);
    }
    const B = full("REOPEN"), pending = deferredDetails(), opening = read('showDetail("REOPEN")');
    node("#detailDialog").emit("close"); // Old browser close event, queued before this session opened.
    complete(pending, "REOPEN", B); await opening;
    assert.equal(state.activeMaterial, B); assert.equal(node("#detailDialog").open, true);
  });

  await check("pending compare cancellation is per ID and does not cancel C", async () => {
    const B = full("B"), C = full("C"), pending = deferredDetails();
    const addB = read('toggleCompare("B")'), addC = read('toggleCompare("C")');
    await read('toggleCompare("B")');
    complete(pending, "B", B); complete(pending, "C", C); await Promise.all([addB, addC]);
    assert.deepEqual([...state.selected], ["C"]); assert.deepEqual(selectedIds(), ["C"]);
  });

  await check("clear cancels all pending adds without cancelling later new intent", async () => {
    const B = full("B"), C = full("C"), pending = deferredDetails();
    const oldB = read('toggleCompare("B")'), oldC = read('toggleCompare("C")');
    node("#clearCompareButton").emit("click");
    complete(pending, "B", B); complete(pending, "C", C); await Promise.all([oldB, oldC]);
    assert.equal(state.selected.size, 0); assert.equal(read("selectedMaterialEntities.size"), 0);
    read('materialDetailCache.delete("B")'); const freshPending = deferredDetails();
    const cancelled = read('toggleCompare("B")'); node("#clearCompareButton").emit("click");
    const current = read('toggleCompare("B")'); complete(freshPending, "B", B);
    await Promise.all([cancelled, current]); assert.deepEqual(selectedIds(), ["B"]);
  });

  await check("concurrent completion preserves intent order and maximum three", async () => {
    const entries = new Map(["A", "B", "C", "D"].map((id) => [id, full(id)]));
    const pending = deferredDetails();
    const adds = [...entries.keys()].map((id) => read(`toggleCompare(${JSON.stringify(id)})`));
    for (const id of ["D", "C", "B", "A"]) { complete(pending, id, entries.get(id)); await Promise.resolve(); }
    await Promise.all(adds);
    assert.deepEqual([...state.selected], ["B", "C", "D"]); assert.deepEqual(selectedIds(), ["B", "C", "D"]);
    assert.equal(read("selectedMaterialEntities.size"), 3); assert.equal(read("compareSelectionIntents.size"), 3);
  });

  await check("404, network failure and mismatched ID are visible and retryable", async () => {
    const good = full("GOOD"); respondDetails(new Map([["GOOD", good]])); await read('showDetail("GOOD")');
    state.recommendations = [{ material: recommendationGrade("FALLBACK"), score: 90 }];
    for (const [id, failure, message] of [
      ["MISSING", async () => ({ ok: false, status: 404, json: async () => ({ error: "Material not found" }) }), "Material not found"],
      ["NETWORK", async () => { throw new Error("NETWORK-FAIL"); }, "NETWORK-FAIL"],
      ["MISMATCH", async () => ok(full("OTHER")), "Invalid material detail response."]
    ]) {
      fetchHandler = failure; await read(`showDetail(${JSON.stringify(id)})`);
      assert.equal(state.activeMaterial, null); assert.equal(read("getCopilotContext().item"), null);
      assert.ok(node("#detailContent").innerHTML.includes(message));
      assert.ok(!node("#detailContent").innerHTML.includes("FULL-GOOD"));
      assert.equal(read(`materialDetailCache.has(${JSON.stringify(id)})`), false);
      assert.equal(read("materialDetailRequests.size"), 0);
      await read(`toggleCompare(${JSON.stringify(id)})`);
      assert.equal(state.selected.size, 0); assert.equal(state.compareErrors.get(id), message);
      read('setRoute("compare")'); assert.ok(node("#compareSelection").innerHTML.includes(message));
      respondDetails(new Map([[id, full(id)]])); await read(`toggleCompare(${JSON.stringify(id)})`);
      assert.deepEqual(selectedIds(), [id]); assert.equal(state.compareErrors.has(id), false);
      await read(`toggleCompare(${JSON.stringify(id)})`);
      await read(`showDetail(${JSON.stringify(id)})`); assert.equal(state.activeMaterial.id, id);
    }
  });

  await check("malformed nested detail fails visibly, then corrected retry fetches and caches full entity", async () => {
    const { A, B } = await recommendB();
    const snapshots = [JSON.stringify(A), JSON.stringify(B)];
    const malformed = full("B"); malformed.evidence.identity.sources = [null];
    const corrected = full("B");
    corrected.evidence.identity.sources = [{
      sourceTitle: "RETRY TEST SOURCE", sourceUrl: "https://example.invalid/retry-fixture"
    }];
    paths.length = 0; let attempts = 0;
    fetchHandler = async (url, options) => {
      assert.equal(url, "/api/materials/B"); assert.equal(options, undefined);
      return ok(++attempts === 1 ? malformed : corrected);
    };
    await recommendationAction("detail-id", "B");
    assert.ok(node("#detailContent").innerHTML.includes("Failed to load the complete material record"));
    assert.ok(node("#detailContent").innerHTML.includes("Invalid material detail response."));
    assert.equal(state.activeMaterial, null); assert.equal(state.selectedMaterialId, "B");
    assert.equal(read("getCopilotContext().item"), null);
    assert.equal(read('materialDetailCache.has("B")'), false);
    assert.equal(read("materialDetailRequests.size"), 0);
    assert.deepEqual([JSON.stringify(A), JSON.stringify(B)], snapshots);
    assert.deepEqual(Array.from(read("materials"), (item) => item.id), ["A"]);
    await recommendationAction("detail-id", "B");
    assert.deepEqual(paths, ["/api/materials/B", "/api/materials/B"]);
    assert.equal(state.activeMaterial, corrected); assert.equal(state.selectedMaterialId, "B");
    assert.equal(read('materialDetailCache.get("B")'), corrected);
    assert.ok(node("#detailContent").innerHTML.includes("FULL-B"));
    assert.ok(node("#detailContent").innerHTML.includes("RETRY TEST SOURCE"));
    await recommendationAction("detail-id", "B");
    assert.equal(attempts, 2); assert.equal(state.activeMaterial, corrected);
    assert.deepEqual([JSON.stringify(A), JSON.stringify(B)], snapshots);
  });

  await check("unexpected cached-detail render failure evicts the entity before active publication and permits retry", async () => {
    const cached = full("B"), corrected = full("B");
    respondDetails(new Map([["B", cached]]));
    await read('resolveMaterialById("B")');
    // Fault injection: an already cached object becomes unusable after validation.
    cached.evidence.identity.sources = [null];
    await read('showDetail("B")');
    assert.equal(state.activeMaterial, null);
    assert.equal(read('materialDetailCache.has("B")'), false);
    assert.ok(node("#detailContent").innerHTML.includes("Failed to load the complete material record"));
    assert.ok(state.activeMaterialError.includes("sourceUrl"));
    assert.ok(!node("#analysisContent").innerHTML.includes("ANALYSIS-B-en"));
    respondDetails(new Map([["B", corrected]]));
    await read('showDetail("B")');
    assert.deepEqual(paths, ["/api/materials/B", "/api/materials/B"]);
    assert.equal(state.activeMaterial, corrected);
    assert.ok(node("#detailContent").innerHTML.includes("FULL-B"));
  });

  await check("optional detail metadata stays optional and malformed compare detail cannot replace retained selection", async () => {
    const A = full("A");
    delete A.evidence; delete A.data_quality.issues;
    A.processing_methods = null; A.notes = null;
    respondDetails(new Map([["A", A]]));
    await read('showDetail("A")'); await read('toggleCompare("A")');
    assert.equal(state.activeMaterial, A); assert.deepEqual(selectedIds(), ["A"]);
    const badA = full("A"); badA.evidence.certifications = [null];
    const badB = full("B"); badB.data_quality.issues = [null];
    read('materialDetailCache.delete("A")');
    respondDetails(new Map([["A", badA], ["B", badB]]));
    await read('showDetail("A")');
    assert.equal(state.activeMaterial, null); assert.equal(read("getSelectedMaterials()[0]"), A);
    assert.equal(read('materialDetailCache.has("A")'), false);
    await read('toggleCompare("B")');
    assert.deepEqual(selectedIds(), ["A"]); assert.equal(read("getSelectedMaterials()[0]"), A);
    assert.equal(read('materialDetailCache.has("B")'), false);
    assert.equal(state.compareErrors.get("B"), "Invalid material detail response.");
    assert.equal(read("materialDetailRequests.size"), 0);
  });

  await check("authoritative quarantine blocks compare, existing low/reference comparison remains allowed", async () => {
    const Q = full("Q"), L = full("L");
    Q.data_quality = { ...Q.data_quality, level: "quarantined", recommendation_eligible: false };
    L.data_quality = { ...L.data_quality, level: "low", recommendation_eligible: false, reference_only: true };
    respondDetails(new Map([["Q", Q], ["L", L]]));
    await read('toggleCompare("Q")'); assert.equal(state.selected.has("Q"), false);
    assert.ok(state.compareErrors.get("Q").includes("quarantined"));
    await read('toggleCompare("L")'); assert.deepEqual(selectedIds(), ["L"]);
    await read('showDetail("Q")'); assert.equal(state.activeMaterial, Q);
    assert.ok(node("#analysisContent").innerHTML.includes("Untrusted record"));
    read("rerenderActiveAnalysis()");
    assert.ok(node("#analysisContent").innerHTML.includes("Untrusted record"));
  });

  await check("compare table renders changed retained entity without stale derived HTML", async () => {
    const A = full("A"); respondDetails(new Map([["A", A]])); await read('toggleCompare("A")');
    read('setRoute("compare")'); const first = node("#compareTableWrap").children[0].innerHTML;
    A.name_en = "UPDATED-RETAINED-A"; A.density = 1.8; read("renderCompare()");
    const second = node("#compareTableWrap").children[0].innerHTML;
    assert.notEqual(second, first); assert.ok(second.includes("UPDATED-RETAINED-A"));
    assert.ok(second.includes("1.8 g/cm3"));
  });

  await check("late mocked analysis response cannot change the new active material", async () => {
    const A = full("A"), B = full("B"), pendingAnalysis = new Map();
    state.analysisCache.delete("en:A"); state.analysisCache.delete("en:B");
    fetchHandler = async (url, options) => {
      if (url === "/api/material-analysis") {
        assert.equal(options.method, "POST");
        const id = JSON.parse(options.body).materialId;
        return new Promise((resolve) => pendingAnalysis.set(id, resolve));
      }
      assert.equal(options, undefined);
      assert.ok(["/api/materials/A", "/api/materials/B"].includes(url));
      return ok(url.endsWith("/A") ? A : B);
    };
    await read('showDetail("A")'); await read('showDetail("B")');
    assert.deepEqual([...pendingAnalysis.keys()], ["A", "B"]);
    pendingAnalysis.get("B")(ok({ analysis: analysis("B", "en") }));
    await new Promise((resolve) => setImmediate(resolve));
    const visible = node("#analysisContent").innerHTML;
    pendingAnalysis.get("A")(ok({ analysis: analysis("A", "en") }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.activeMaterial, B); assert.equal(node("#analysisContent").innerHTML, visible);
    assert.ok(visible.includes("ANALYSIS-B-en"));
  });

  await check("closing resolved detail retains active analysis without reopening modal", async () => {
    const A = full("A"); state.analysisCache.delete("en:A");
    let finishAnalysis;
    fetchHandler = async (url, options) => {
      if (url === "/api/materials/A") { assert.equal(options, undefined); return ok(A); }
      assert.equal(url, "/api/material-analysis"); assert.equal(options.method, "POST");
      return new Promise((resolve) => { finishAnalysis = resolve; });
    };
    await read('showDetail("A")'); node("#closeDialogButton").emit("click");
    assert.equal(state.activeMaterial, A);
    const closedDetail = node("#detailContent").innerHTML;
    finishAnalysis(ok({ analysis: analysis("A", "en") }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(node("#detailDialog").open, false); assert.equal(state.activeMaterial, A);
    assert.equal(node("#detailContent").innerHTML, closedDetail);
    assert.ok(node("#analysisContent").innerHTML.includes("ANALYSIS-A-en"));
  });

  reset();
  process.stdout.write(`AD-06 frontend entity regressions: ${passed}/${passed} PASS; all network/AI calls mocked.\n`);
}

async function comparisonFrontendChecks() {
  const state = read("state");
  let passed = 0;
  let posts;
  let fixtures;
  const key = (ids, language = "en") => JSON.stringify([language, ids]);
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
    return { promise, resolve, reject };
  };
  const comparison = (marker) => ({
    selectionAdvice: marker, keyDifferences: [marker + " difference"],
    strengthsAndWeaknesses: [], recommendedUseCases: []
  });
  const reply = (post, marker, ids = post.body.materialIds) => post.resolve(ok({
    materialIds: ids, comparison: comparison(marker)
  }));
  const invoke = () => node("#runAiCompareButton").emit("click");
  const select = (id) => read(`toggleCompare(${JSON.stringify(id)})`);
  const selected = () => Array.from(read("getSelectedMaterials()"), (item) => item.id);
  const panel = () => ({
    title: node("#aiCompareTitle").textContent,
    status: node("#aiCompareStatus").textContent,
    html: node("#aiCompareContent").innerHTML
  });
  const language = (value) => node("#languageSelect").emit("change", { value });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const setup = async (ids = ["A", "B"]) => {
    node("#clearCompareButton").emit("click");
    state.aiCompareCache.clear();
    run("materialDetailCache.clear()");
    state.selectedMaterialId = null; state.activeMaterial = null; state.activeMaterialError = null;
    language("en");
    read('setRoute("compare")');
    fixtures = new Map(["A", "B", "C", "D"].map((id) => [id, {
      ...recommendationGrade(id), abbr: id,
      evidence: { ...recommendationGrade(id).evidence, identity: { sources: [] } }
    }]));
    for (const id of fixtures.keys()) {
      for (const lang of ["en", "zh"]) state.analysisCache.set(`${lang}:${id}`, {
        overview: `ANALYSIS-${id}-${lang}`, advantages: [], limitations: [], recommendedApplications: []
      });
    }
    posts = [];
    fetchHandler = (url, options) => {
      if (url.startsWith("/api/materials/")) {
        assert.equal(options, undefined);
        const id = decodeURIComponent(url.slice("/api/materials/".length));
        assert.ok(fixtures.has(id), `Unexpected comparison fixture detail ${id}`);
        return Promise.resolve(ok(fixtures.get(id)));
      }
      if (url.startsWith("/api/materials?")) {
        assert.equal(options, undefined);
        return Promise.resolve(ok(payload([fixtures.get("D")], 96)));
      }
      assert.equal(url, "/api/material-comparison", "Only mocked comparison POSTs are allowed.");
      assert.equal(options.method, "POST");
      const post = { ...deferred(), body: JSON.parse(options.body) };
      posts.push(post);
      return post.promise;
    };
    for (const id of ids) await select(id);
  };
  const check = async (name, action) => {
    await setup();
    await action();
    passed++;
    process.stdout.write(`AD-07 PASS ${passed}: ${name}\n`);
  };
  const changeToAC = async () => {
    await select("B"); await select("C");
    assert.deepEqual(selected(), ["A", "C"]);
  };

  await check("A normal success and same-context cache reuse", async () => {
    const request = invoke();
    assert.deepEqual(posts[0].body, { materialIds: ["A", "B"], language: "en" });
    reply(posts[0], "CURRENT-AB"); await request;
    assert.equal(panel().title, "A vs B");
    assert.ok(panel().html.includes("CURRENT-AB"));
    assert.equal(state.aiCompareCache.get(key(["A", "B"])).selectionAdvice, "CURRENT-AB");
    await invoke();
    assert.equal(posts.length, 1);
    assert.equal(panel().status, read('t("cachedComparison")'));
  });

  await check("B obsolete AB success cannot overwrite current AC", async () => {
    const old = invoke(); await changeToAC();
    const current = invoke(); reply(posts[1], "CURRENT-AC"); await current;
    const visible = panel();
    reply(posts[0], "OBSOLETE-AB"); await old;
    assert.deepEqual(panel(), visible);
    assert.equal(panel().title, "A vs C");
    assert.equal(state.aiCompareCache.has(key(["A", "B"])), false);
    assert.equal(state.aiCompareCache.get(key(["A", "C"])).selectionAdvice, "CURRENT-AC");
  });

  await check("C obsolete AB failure cannot overwrite successful AC", async () => {
    const old = invoke(); await changeToAC();
    const current = invoke(); reply(posts[1], "CURRENT-AC"); await current;
    const visible = panel();
    posts[0].reject(new Error("OBSOLETE-AB-ERROR")); await old;
    assert.deepEqual(panel(), visible);
    assert.equal(state.aiCompareCache.has(key(["A", "B"])), false);
  });

  for (const fails of [false, true]) {
    await check(`D delayed obsolete response body ${fails ? "failure" : "success"}`, async () => {
      const old = invoke(), body = deferred();
      let reads = 0;
      posts[0].resolve({ ok: true, status: 200, json() { reads++; return body.promise; } });
      await settle(); assert.equal(reads, 1, "The old request must enter real response.json().");
      await changeToAC();
      const current = invoke(); reply(posts[1], "CURRENT-AC"); await current;
      const visible = panel();
      if (fails) body.reject(new Error("OBSOLETE-BODY-ERROR"));
      else body.resolve({ materialIds: ["A", "B"], comparison: comparison("OBSOLETE-BODY") });
      await old;
      assert.deepEqual(panel(), visible);
      assert.equal(state.aiCompareCache.has(key(["A", "B"])), false);
    });
  }

  for (const fails of [false, true]) {
    await check(`E real clear invalidates pending ${fails ? "failure" : "success"}`, async () => {
      const old = invoke(); node("#clearCompareButton").emit("click");
      const visible = panel();
      if (fails) posts[0].reject(new Error("OBSOLETE-CLEAR-ERROR"));
      else reply(posts[0], "OBSOLETE-CLEARED-AB");
      await old;
      assert.deepEqual(selected(), []); assert.deepEqual(panel(), visible);
      assert.equal(node("#runAiCompareButton").disabled, true);
      assert.equal(state.aiCompareCache.size, 0);
    });
    await check(`F fewer than two invalidates pending ${fails ? "failure" : "success"}`, async () => {
      const old = invoke(); await select("B");
      const visible = panel();
      if (fails) posts[0].reject(new Error("OBSOLETE-NO-PAIR-ERROR"));
      else reply(posts[0], "OBSOLETE-NO-PAIR-AB");
      await old;
      assert.deepEqual(selected(), ["A"]); assert.deepEqual(panel(), visible);
      assert.equal(state.aiCompareCache.size, 0);
    });
    await check(`G real language change invalidates EN ${fails ? "failure" : "success"}`, async () => {
      const old = invoke(); language("zh");
      const current = invoke();
      assert.equal(posts[1].body.language, "zh");
      reply(posts[1], "CURRENT-ZH-AB"); await current;
      const visible = panel();
      if (fails) posts[0].reject(new Error("OBSOLETE-EN-ERROR"));
      else reply(posts[0], "OBSOLETE-EN-AB");
      await old;
      assert.equal(state.language, "zh"); assert.deepEqual(panel(), visible);
      assert.equal(state.aiCompareCache.has(key(["A", "B"], "en")), false);
      assert.equal(state.aiCompareCache.get(key(["A", "B"], "zh")).selectionAdvice, "CURRENT-ZH-AB");
    });
  }

  for (const transition of ["clear", "pair", "language"]) {
    await check(`H same tuple cannot restore ownership after ${transition}`, async () => {
      const old = invoke();
      // Exercise invalidation even when no comparison-route render observes intermediate states.
      read('setRoute("home")');
      if (transition === "clear") {
        node("#clearCompareButton").emit("click"); await select("A"); await select("B");
      } else if (transition === "pair") {
        await changeToAC(); await select("C"); await select("B");
      } else {
        language("zh"); language("en");
      }
      read('setRoute("compare")');
      const current = invoke();
      assert.equal(posts.length, 2, "A restored tuple must own a new request.");
      reply(posts[1], "NEW-LIFECYCLE-AB"); await current;
      await invoke(); // A cache hit belongs to the new lifecycle, not the old request.
      const visible = panel();
      reply(posts[0], "OLD-LIFECYCLE-AB"); await old;
      assert.deepEqual(panel(), visible); assert.equal(posts.length, 2);
      assert.equal(state.aiCompareCache.get(key(["A", "B"])).selectionAdvice, "NEW-LIFECYCLE-AB");
    });
  }

  await check("I ordered AB and BA caches remain independent", async () => {
    const ab = invoke(); reply(posts[0], "ORDER-AB"); await ab;
    await select("A"); await select("A");
    assert.deepEqual(selected(), ["B", "A"]);
    const ba = invoke(); assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].body.materialIds, ["B", "A"]);
    reply(posts[1], "ORDER-BA"); await ba; await invoke();
    assert.equal(panel().title, "B vs A"); assert.ok(panel().html.includes("ORDER-BA"));
    assert.equal(posts.length, 2);
    assert.equal(state.aiCompareCache.get(key(["A", "B"])).selectionAdvice, "ORDER-AB");
    assert.equal(state.aiCompareCache.get(key(["B", "A"])).selectionAdvice, "ORDER-BA");
  });

  await check("J pending deduplicates and failure permits a fresh retry", async () => {
    const first = invoke(), duplicate = invoke();
    assert.equal(posts.length, 1);
    posts[0].resolve({ ok: false, status: 503, json: async () => ({ error: "CURRENT-FAILURE" }) });
    await Promise.all([first, duplicate]);
    assert.ok(panel().html.includes("CURRENT-FAILURE")); assert.equal(state.aiCompareCache.size, 0);
    const error = panel(); read("render()"); assert.deepEqual(panel(), error);
    const retry = invoke(); assert.equal(posts.length, 2);
    assert.equal(panel().status, read('t("generating")'));
    reply(posts[1], "RETRIED-AB"); await retry;
    assert.ok(panel().html.includes("RETRIED-AB"));
  });

  await check("K render, catalog page, detail and unchanged third item preserve AB pending", async () => {
    const request = invoke(); const loading = panel();
    read("render()"); assert.deepEqual(panel(), loading);
    await read("loadPublicMaterialPage(2)"); assert.deepEqual(panel(), loading);
    await read('showDetail("D")'); await settle();
    assert.deepEqual(panel(), loading);
    await select("C"); assert.deepEqual(selected(), ["A", "B", "C"]);
    assert.deepEqual(panel(), loading);
    const duplicate = invoke(); assert.equal(posts.length, 1);
    reply(posts[0], "STILL-CURRENT-AB"); await Promise.all([request, duplicate]);
    assert.ok(panel().html.includes("STILL-CURRENT-AB"));
    assert.equal(state.aiCompareCache.get(key(["A", "B"])).selectionAdvice, "STILL-CURRENT-AB");
  });

  await check("L max-three eviction actually changes AB to BC and invalidates AB", async () => {
    const old = invoke(); await select("C"); await select("D");
    assert.deepEqual(selected(), ["B", "C", "D"]);
    const current = invoke(); assert.deepEqual(posts[1].body.materialIds, ["B", "C"]);
    reply(posts[1], "CURRENT-BC"); await current;
    const visible = panel(); reply(posts[0], "OBSOLETE-EVICTED-AB"); await old;
    assert.deepEqual(panel(), visible); assert.equal(state.aiCompareCache.has(key(["A", "B"])), false);
  });

  for (const ids of [["B", "A"], ["A", "C"], undefined]) {
    await check(`M invalid response IDs ${JSON.stringify(ids)} fail safely and retry`, async () => {
      const invalid = invoke();
      posts[0].resolve(ok({ materialIds: ids, comparison: comparison("INVALID-IDENTITY") }));
      await invalid;
      assert.equal(panel().status, read('t("unavailable")'));
      assert.ok(!panel().html.includes("INVALID-IDENTITY")); assert.equal(state.aiCompareCache.size, 0);
      const retry = invoke(); assert.equal(posts.length, 2);
      reply(posts[1], "VALID-RETRY-AB"); await retry;
      assert.ok(panel().html.includes("VALID-RETRY-AB"));
    });
  }

  for (const fails of [false, true]) {
    await check(`N obsolete ${fails ? "failure" : "success"} cannot release newer pending request`, async () => {
      const old = invoke(); await changeToAC();
      const current = invoke(); const loading = panel();
      if (fails) posts[0].reject(new Error("OBSOLETE-PENDING-ERROR"));
      else reply(posts[0], "OBSOLETE-PENDING-AB");
      await old;
      assert.deepEqual(panel(), loading); assert.equal(state.aiCompareCache.size, 0);
      const duplicate = invoke(); assert.equal(posts.length, 2, "Old cleanup must not release current pending.");
      reply(posts[1], "CURRENT-PENDING-AC"); await Promise.all([current, duplicate]);
      assert.ok(panel().html.includes("CURRENT-PENDING-AC"));
    });
  }

  await check("O tuple encoding avoids delimiter collisions", async () => {
    assert.notEqual(read('getAiCompareCacheKey([{id:"A::B"},{id:"C"}], "en")'),
      read('getAiCompareCacheKey([{id:"A"},{id:"B::C"}], "en")'));
    assert.notEqual(read('getAiCompareCacheKey([{id:"A"},{id:"B"}], "en")'),
      read('getAiCompareCacheKey([{id:"A"},{id:"B"}], "zh")'));
  });

  node("#clearCompareButton").emit("click");
  process.stdout.write(`AD-07 comparison regressions: ${passed}/${passed} PASS; all network/AI calls mocked.\n`);
}

function assertReportCompatibility(detailed, compact) {
  const state = read("state");
  const priorLanguage = state.language;
  const priorMaterials = read("materials");
  context.reportMaterials = detailed;
  read("materials = reportMaterials");
  const output = {};
  try {
    assert.equal(compact.length, detailed.length);
    for (const language of ["en", "zh"]) {
      state.language = language;
      for (let index = 0; index < detailed.length; index += 1) {
        context.reportDetailed = detailed[index];
        context.reportCompact = compact[index];
        const disadvantages = read("JSON.stringify(materialDisadvantageList(reportDetailed))");
        assert.equal(read("JSON.stringify(materialDisadvantageList(reportCompact))"), disadvantages,
          language + ": disadvantage fallbacks must match for " + detailed[index].id);
        context.reportCandidate = { material: detailed[index], score: 90, reasons: [], warnings: [] };
        const fullHtml = read("renderReportMaterial(reportCandidate, 0)");
        context.reportCandidate = { material: compact[index], score: 90, reasons: [], warnings: [] };
        const compactHtml = read("renderReportMaterial(reportCandidate, 0)");
        assert.equal(compactHtml, fullHtml, language + ": exact existing report HTML for " + detailed[index].id);
        output[language + ":" + detailed[index].id] = compactHtml;
      }
    }
    return output;
  } finally {
    state.language = priorLanguage;
    context.reportMaterials = priorMaterials;
    read("materials = reportMaterials");
    for (const key of ["reportMaterials", "reportDetailed", "reportCompact", "reportCandidate"]) delete context[key];
  }
}

// Test actual app consumers with paginated repository responses, not a second
// browser filter. A qualitative tag match must not invent a density measurement.
async function assertDensityTagConsumers(pages) {
  const state=read('state'),savedState={...state},savedFetch=fetchHandler;
  const saved=read('({materials,materialCatalogTotal,catalogFacets,categories,catalogPageGeneration,catalogLayerStats,catalogLoadError,catalogQueryResetPending})');
  try {
    Object.assign(state,{route:'materials',language:'en',query:'',category:'all',
      property:'low-density-lightweight',domain:'all',sort:'density',materialsPageSize:1,
      minTemp:read('DEFAULT_MIN_TEMP'),minStrength:read('DEFAULT_MIN_STRENGTH'),recyclableOnly:false});
    fetchHandler=async url=>{
      const params=new URL(url,'http://test').searchParams;
      assert.equal(params.get('performance'),'low-density-lightweight');
      assert.equal(params.get('sort'),'density');assert.equal(params.get('limit'),'1');
      return ok(pages[Number(params.get('offset'))]);
    };
    for(let index=0;index<pages.length;index++) {
      await read(`loadPublicMaterialPage(${index+1})`);
      const expected=pages[index],item=expected.items[0];
      assert.equal(read('materialCatalogTotal'),expected.total);
      assert.equal(read('materials[0].id'),item.id);
      assert.equal(read('materials[0].density'),item.density);
      const expectedCount=expected.facets.performance.options.find(x=>x.id==='low-density-lightweight').count;
      assert.equal(read('getPerformanceFilterCounts().get("low-density-lightweight")'),expectedCount);
      assert.ok(descendants(node('#propertyFacetFilter')).some(entry=>
        entry.dataset.property==='low-density-lightweight'&&entry.innerHTML.includes(`<strong>${expectedCount}</strong>`)));
      const cards=node('#materialsGrid').children.filter(x=>x.tag==='article');
      assert.equal(cards.length,1);assert.ok(cards[0].innerHTML.includes(item.id));
      context.densityConsumerItem=item;
      const rendered=read('formatCanonicalProperty(densityConsumerItem,"density","density")');
      assert.ok(cards[0].innerHTML.includes(rendered));
      if(item.density!==null)assert.ok(rendered.includes(String(item.density)));
      else assert.ok(!/1\.13|1\.2/.test(rendered),'text match must not invent verified numeric density');
    }
    console.log('PILOT-D5 frontend: server tag/sort parameters, cross-page density cards and global facet counts PASS.');
  } finally {
    Object.assign(state,savedState);fetchHandler=savedFetch;context.densitySaved=saved;
    read('({materials,materialCatalogTotal,catalogFacets,categories,catalogPageGeneration,catalogLayerStats,catalogLoadError,catalogQueryResetPending}=densitySaved)');
    delete context.densitySaved;delete context.densityConsumerItem;
  }
}
function densityConsumerFixturePages() {
  const facets={categories:{all:3,options:[]},performance:{all:3,groups:[],
    options:[{id:'low-density-lightweight',count:3}]},domains:{all:3,options:[]}};
  const policy=require('../property-projection-policy');
  return [1.13,1.2,null].map((density,index)=>{
    const id='D5-UI-'+index;
    const claims=density===null?[]:[{material_id:id,property_key:'density',value_numeric:density,
      unit:'g/cm3',test_standard:'TEST STANDARD',test_condition:'TEST CONDITION',value_type:'typical',
      source_type:'manufacturer',source_title:'TEST ONLY',source_url:'https://example.invalid/d5',
      verification_status:'verified',confidence_level:'medium',conflict_status:'none'}];
    const projection=policy.projectProperty(id,'density',claims);
    return {items:[{...grade(id,null,null),density:projection.queryKey,
      summary:index===2?'lightweight':'TEST ONLY',propertyProjections:{density:projection}}],total:3,facets};
  });
}

function assertProjectionConsumers(items) {
  context.projectionItems = items;
  const state = read("state"), oldLanguage = state.language;
  const oldSelected = read("[...selectedMaterialEntities.entries()]");
  const oldIds = [...state.selected];
  try {
    state.language = "en";
    const pc = items[0], pa = items[1], partial = items[2];
    assert.ok(read('formatCanonicalProperty(projectionItems[0], "tensile_strength", "tensile", " MPa")').includes("65 MPa"));
    assert.ok(read('formatCanonicalProperty(projectionItems[2], "tensile_strength", "tensile", " MPa")').includes("Partially verified"));
    read('renderCards(projectionItems)');
    const cards = node("#materialsGrid").innerHTML;
    assert.ok(cards.includes("65 MPa"));assert.ok(cards.includes("Multiple conditions"));
    assert.ok(cards.includes("Partially verified"));
    read('state.selected.clear(); selectedMaterialEntities.clear(); projectionItems.forEach(item => {state.selected.add(item.id); selectedMaterialEntities.set(item.id,item);}); renderCompare()');
    const compared = node("#compareTableWrap").innerHTML;
    for(const value of ["65 MPa","85 MPa","50 MPa","dry","conditioned","Partially verified","TEST ONLY property"])
      assert.ok(compared.includes(value),value+' must reach actual compare renderer');
    assert.equal(pc.propertyProjections.continuous_use_temperature.queryKey,null);
    assert.equal(partial.tensile,null,'partial display must not manufacture a numeric alias');
    assert.equal(pa.propertyProjections.tensile_strength.queryKey,null);
    const missing = read('renderCanonicalCompareCell(projectionItems[0], "continuous_use_temperature", "maxTemp", " deg C")').innerHTML;
    assert.ok(missing.includes("Not specified"));
    assert.ok(!missing.includes("260"));
    console.log('FA-003 actual card/compare DOM consumers: single/partial/multiple/missing PASS.');
  } finally {
    state.language=oldLanguage; state.selected.clear();for(const id of oldIds)state.selected.add(id);
    context.savedProjectionEntities=oldSelected;
    read('selectedMaterialEntities.clear(); savedProjectionEntities.forEach(([id,item]) => selectedMaterialEntities.set(id,item))');
    delete context.savedProjectionEntities;delete context.projectionItems;
  }
}
// Read actual app renderers for isolated real-pilot and adversarial contracts.
function snapshotProjectionConsumers(items) {
  const state=read("state"), language=state.language, output={};
  try {
    state.language="en";
    for(const item of items) {
      context.projectionSnapshotItem=item;
      output[item.id]={};
      for(const [key,field] of [["density","density"],["tensile_strength","tensile"],
        ["hdt","hdt"],["continuous_use_temperature","maxTemp"]]) {
        context.projectionSnapshotKey=key;context.projectionSnapshotField=field;
        output[item.id][key]={
          summary:read('formatCanonicalProperty(projectionSnapshotItem,projectionSnapshotKey,projectionSnapshotField)'),
          compareHtml:read('renderCanonicalCompareCell(projectionSnapshotItem,projectionSnapshotKey,projectionSnapshotField)').innerHTML
        };
      }
    }
    return output;
  } finally {
    state.language=language;
    for(const key of ["projectionSnapshotItem","projectionSnapshotKey","projectionSnapshotField"])delete context[key];
  }
}
module.exports = { assertReportCompatibility, assertProjectionConsumers, snapshotProjectionConsumers, assertDensityTagConsumers };
if (require.main === module) {
  let completed = false;
  let watchdog;
  const timeout = new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error("Frontend test watchdog: async assertions did not complete within 10 seconds.")), 10_000);
  });
  Promise.race([main().then(() => { completed = true; }), timeout]).then(() => {
    assert.equal(completed, true, "The complete frontend regression must finish before success.");
    process.stdout.write("Frontend regression TEST COMPLETED.\n");
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => clearTimeout(watchdog));
}
