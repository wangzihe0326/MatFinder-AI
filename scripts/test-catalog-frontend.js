const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const families = require("../public/polymer-families");

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const startup = app.lastIndexOf("\ninit().catch(");
assert.ok(startup > 0, "The browser startup call must be isolated from this test.");

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
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  emit(name, target = this) {
    const handler = this.listeners.get(name);
    assert.ok(handler, `Missing ${name} handler on ${this.tag}`);
    return handler({ target, preventDefault() {} });
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) {
    this.children = nodes.flatMap((node) => node.tag === "fragment" ? node.children : [node]);
  }
  querySelector() { return new Element("button"); }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  closest() { return this; }
}

const nodes = new Map();
const document = {
  body: new Element("body"),
  querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector));
    return nodes.get(selector);
  },
  querySelectorAll: () => [],
  createElement: (tag) => new Element(tag),
  createDocumentFragment: () => new Element("fragment")
};
let queuedTimer = null;
let fetchHandler = () => { throw new Error("Unexpected fetch"); };
const paths = [];
const context = vm.createContext({
  document, URLSearchParams,
  fetch: (url) => { paths.push(url); return fetchHandler(url); },
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
const ok = (body) => ({ ok: true, json: async () => body });
const fixedResponse = (body) => { fetchHandler = async () => ok(body); };

async function main() {
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

  process.stdout.write("AD-04 frontend catalog regressions 34–49 passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
