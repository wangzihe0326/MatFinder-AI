const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
require("./catalog-policy").loadCanonicalPolicy();
const {
  DEFAULT_PAGE_SIZE,
  DOMAIN_IDS,
  MAX_PAGE_SIZE,
  MaterialRepository,
  PERFORMANCE_ALIASES,
  PERFORMANCE_IDS
} = require("./material-repository");
const { readPilotStatus } = require("./pilot-status");
const {
  ApiError,
  AiCoordinator,
  MAX_PROMPT_BYTES,
  createApiProtection,
  readJsonBody,
  validateAiBody
} = require("./api-protection");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const realPublicDir = fs.realpathSync(publicDir);
loadEnvFile(path.join(rootDir, ".env"));
loadEnvFile(path.join(rootDir, ".env.local"));

const nodeEnv = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const allowedAiModels = new Set(["gpt-4.1-mini"]);
const databasePath = path.resolve(rootDir, process.env.MATFINDER_DB_PATH || "matfinder.db");
const allowedOrigins = parseList(process.env.MATFINDER_ALLOWED_ORIGINS);

const startupMemorySamples = [];
logMemory("before_sqlite_connection");
let repository;
try { repository = new MaterialRepository(databasePath); }
catch (error) {
  console.error(error.message);
  process.exit(1);
}
logMemory("after_sqlite_connection");
const schemaInfo = repository.checkSchema();
logMemory("after_schema_version_check", {
  migrationExecuted: false,
  schemaVersion: schemaInfo.version
});
const apiProtection = createApiProtection({
  adminToken: process.env.MATFINDER_ADMIN_TOKEN,
  trustProxy: process.env.MATFINDER_TRUST_PROXY
});
const aiCoordinator = new AiCoordinator({ protection: apiProtection });

const { families: polymerFamilies } = require("./public/polymer-families");
const polymerFamilyCount = repository.getPolymerFamilyCount();
logMemory("after_polymer_family_initialization", { polymerFamilyCount });
const searchIndexInfo = repository.checkSearchIndexes();
logMemory("after_search_index_check", {
  indexBuildExecuted: false,
  verifiedIndexCount: searchIndexInfo.verified.length
});
const pilotStatus = readPilotStatus();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const appRoutes = new Set([
  "/",
  "/materials",
  "/families",
  "/pilot",
  "/audit",
  "/compare",
  "/copilot",
  "/about"
]);

const publicFiles = new Set([
  "/index.html",
  "/styles.css",
  "/config.js",
  "/catalog-search.js",
  "/polymer-families.js",
  "/catalog-layer.js",
  "/recommendation-engine.js",
  "/app.js"
]);

const publicCatalogParameters = [
  "q", "category", "performance", "domain", "minTempC", "minTensileMpa",
  "recyclable", "sort", "limit", "offset"
];
const catalogSorts = new Set(["match", "temperature", "strength", "density", "name"]);
const catalogPerformanceIds = new Set(PERFORMANCE_IDS);
const catalogDomainIds = new Set(DOMAIN_IDS);

class CatalogQueryError extends Error {
  constructor(parameter) {
    super("Invalid catalog query parameter");
    this.parameter = parameter;
  }
}

function parsePublicCatalogQuery(searchParams) {
  for (const parameter of publicCatalogParameters) {
    if (searchParams.getAll(parameter).length > 1) throw new CatalogQueryError(parameter);
  }
  const has = (parameter) => searchParams.has(parameter);
  const read = (parameter) => searchParams.get(parameter);
  const hasControl = (value) => /[\u0000-\u001f\u007f-\u009f]/u.test(value);

  let query = "";
  if (has("q")) {
    const raw = read("q");
    if (hasControl(raw)) throw new CatalogQueryError("q");
    query = raw.trim().toLowerCase().replace(/\s+/gu, " ");
    if ([...query].length > 256 || (query && query.split(" ").length > 16)) {
      throw new CatalogQueryError("q");
    }
  }

  let category;
  if (has("category")) {
    const raw = read("category");
    if (hasControl(raw) || !raw.trim() || [...raw].length > 256) {
      throw new CatalogQueryError("category");
    }
    category = raw;
    if (category === "all") category = undefined;
  }

  let performance;
  if (has("performance")) {
    const raw = read("performance");
    performance = PERFORMANCE_ALIASES[raw] || raw;
    if (performance === "all") performance = undefined;
    else if (!catalogPerformanceIds.has(performance)) throw new CatalogQueryError("performance");
  }

  let domain;
  if (has("domain")) {
    domain = read("domain");
    if (domain === "all") domain = undefined;
    else if (!catalogDomainIds.has(domain)) throw new CatalogQueryError("domain");
  }

  const plainDecimal = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
  const threshold = (parameter, minimum, maximum) => {
    if (!has(parameter)) return undefined;
    const raw = read(parameter);
    if (!plainDecimal.test(raw)) throw new CatalogQueryError(parameter);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new CatalogQueryError(parameter);
    }
    return value;
  };

  let recyclable = false;
  if (has("recyclable")) {
    const raw = read("recyclable");
    if (raw !== "true" && raw !== "false") throw new CatalogQueryError("recyclable");
    recyclable = raw === "true";
  }

  const sort = has("sort") ? read("sort") : "match";
  if (!catalogSorts.has(sort)) throw new CatalogQueryError("sort");
  const integer = (parameter, defaultValue, minimum, maximum) => {
    if (!has(parameter)) return defaultValue;
    const raw = read(parameter);
    if (!/^\d+$/u.test(raw)) throw new CatalogQueryError(parameter);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new CatalogQueryError(parameter);
    }
    return value;
  };

  return {
    query,
    category,
    performance,
    domain,
    minTempC: threshold("minTempC", -200, 260),
    minTensileMpa: threshold("minTensileMpa", 0, 180),
    recyclable,
    sort,
    limit: integer("limit", DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    offset: integer("offset", 0, 0, Number.MAX_SAFE_INTEGER - MAX_PAGE_SIZE)
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://localhost:${port}`);
    const requestPath = requestUrl.pathname;
    response.acceptsGzip = /\bgzip\b/i.test(String(request.headers["accept-encoding"] || ""));
    attachCorsHeaders(request, response, requestPath);

    if (request.method === "OPTIONS" && requestPath.startsWith("/api/")) {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && requestPath === "/api/live") {
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, { status: "alive" });
      return;
    }

    if (request.method === "GET" &&
        (requestPath === "/api/health" || requestPath === "/api/ready")) {
      response.setHeader("Cache-Control", "no-store");
      try {
        repository.checkTechnicalHealth();
        if (requestPath === "/api/health") {
          sendJson(response, 200, { status: "ok" });
        } else if (!repository.getCatalogGeneration()) {
          sendJson(response, 503, { status: "not_ready", reason: "catalog_stats_unavailable" });
        } else {
          const ready = repository.hasReadyPublicCommercialGrade();
          if (!repository.getCatalogGeneration()) {
            sendJson(response, 503, { status: "not_ready", reason: "catalog_stats_unavailable" });
          } else if (ready) sendJson(response, 200, { status: "ready" });
          else sendJson(response, 503, {
            status: "not_ready",
            reason: "no_verified_public_grades"
          });
        }
      } catch {
        sendJson(response, 503, requestPath === "/api/health"
          ? { status: "unhealthy", reason: "database_unavailable" }
          : { status: "not_ready", reason: "database_unavailable" });
      }
      return;
    }

    const auditMode = requestUrl.searchParams.get("audit") === "1";
    const auditRoute = request.method === "GET" && (
      requestPath === "/api/admin/audit-summary" ||
      (auditMode && (requestPath === "/api/materials" || requestPath.startsWith("/api/materials/")))
    );
    const identity = apiProtection.identity(request);
    if (auditRoute) {
      response.setHeader("Cache-Control", "no-store");
      const access = apiProtection.admin(identity, request.headers.authorization);
      if (access.status === 401) {
        response.setHeader("WWW-Authenticate", "Bearer");
        response.setHeader("Cache-Control", "no-store");
        sendJson(response, 401, { error: "Administrator authentication required" });
        return;
      }
      if (access.status === 429) {
        sendRateLimit(response, access.retryAfterSeconds);
        return;
      }
    } else if (request.method === "GET" && requestPath.startsWith("/api/")) {
      const retryAfterSeconds = apiProtection.publicGet(identity, publicApiWeight(requestPath));
      if (retryAfterSeconds) {
        sendRateLimit(response, retryAfterSeconds);
        return;
      }
    }

    if (request.method === "GET" && requestPath === "/api/materials") {
      response.setHeader("Cache-Control", "no-store");
      const result = repository.listMaterials(auditMode ? {
        audit: true,
        query: String(requestUrl.searchParams.get("q") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
        offset: requestUrl.searchParams.get("offset")
      } : parsePublicCatalogQuery(requestUrl.searchParams));
      response.setHeader("X-Total-Count", String(result.total));
      sendJson(response, 200, {
        ...result,
        items: result.items.map(toCompactMaterial)
      });
      return;
    }

    if (request.method === "GET" && requestPath === "/api/polymer-families") {
      sendJson(response, 200, polymerFamilies);
      return;
    }

    if (request.method === "GET" && requestPath === "/api/catalog-stats") {
      response.setHeader("Cache-Control", "no-store");
      const stats = repository.getCatalogStats();
      sendJson(response, stats ? 200 : 503, stats || { status: "unavailable", reason: "catalog_stats_unavailable" });
      return;
    }

    if (request.method === "GET" && requestPath === "/api/pilot-status") {
      sendJson(response, 200, pilotStatus);
      return;
    }

    if (request.method === "GET" && requestPath === "/api/admin/audit-summary") {
      sendJson(response, 200, repository.getAuditStats());
      return;
    }

    if (request.method === "GET" && requestPath === "/api/recommendation-candidates") {
      response.setHeader("Cache-Control", "no-store");
      if (requestUrl.searchParams.size > 0) {
        sendJson(response, 400, { error: "Invalid recommendation candidate query" });
        return;
      }
      try {
        const candidates = repository.getRecommendationCandidates();
        sendJson(response, 200, {
          items: candidates,
          total: candidates.length,
          eligibleTotal: candidates.filter((item) => item.data_quality.recommendation_eligible).length,
          referenceTotal: candidates.filter((item) => item.data_quality.reference_only).length,
          complete: true,
          bounded: false
        });
      } catch {
        sendJson(response, 500, { error: "Recommendation candidate recall failed" });
      }
      return;
    }

    if (request.method === "GET" && requestPath.startsWith("/api/materials/")) {
      const materialId = decodeURIComponent(requestPath.slice("/api/materials/".length));
      const material = repository.getMaterialById(materialId, {
        audit: auditMode
      });
      if (!material) {
        sendJson(response, 404, { error: "Material not found" });
        return;
      }
      sendJson(response, 200, material);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/material-analysis") {
      await handleMaterialAnalysis(request, response, identity);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/material-comparison") {
      await handleMaterialComparison(request, response, identity);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (error instanceof CatalogQueryError) {
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 400, {
        error: "Invalid catalog query parameter", parameter: error.parameter
      });
      return;
    }
    if (error instanceof ApiError) {
      if (error.status === 499) return;
      if (error.status === 429) {
        sendRateLimit(response, error.retryAfterSeconds || 5);
        return;
      }
      if (error.status === 413) response.setHeader("Connection", "close");
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, error.status, { error: error.message });
      return;
    }
    sendJson(response, 500, { error: "Server error", detail: error.message });
  }
});

function publicApiWeight(requestPath) {
  if (requestPath === "/api/catalog-stats" || requestPath === "/api/recommendation-candidates") return 5;
  if (requestPath === "/api/materials" || requestPath.startsWith("/api/materials/")) return 2;
  return 1;
}

function sendRateLimit(response, retryAfterSeconds) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  response.setHeader("Retry-After", String(seconds));
  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 429, { error: "Rate limit exceeded", retryAfterSeconds: seconds });
}

repository.initializeCatalogStats().then(() => {
  logMemory("after_catalog_generation_verification", { catalogStatsAvailable: Boolean(repository.getCatalogGeneration()) });
  server.listen(port, () => {
    logMemory("after_http_listen");
    console.log(`MatFinder AI running in ${nodeEnv} mode at http://localhost:${port}`);
  });
}).catch(() => {
  console.error("Catalog generation initialization failed");
  process.exitCode = 1;
});

// Test-process IPC keeps memory/query assertions available without a public diagnostics API.
if (nodeEnv === "test" && typeof process.send === "function") {
  process.on("message", (message) => {
    if (message?.type !== "test-diagnostics-request") return;
    process.send({
      type: "test-diagnostics-response",
      memory: memoryUsageInMegabytes(),
      startupPeak: startupPeakInMegabytes(),
      repository: repository.getMetrics()
    });
  });
}

function logMemory(phase, metadata = {}) {
  const usage = process.memoryUsage();
  startupMemorySamples.push({ phase, ...usage });
  console.log(JSON.stringify({
    type: "startup_memory",
    phase,
    bytes: usage,
    megabytes: memoryUsageInMegabytes(usage),
    ...metadata
  }));
}

function memoryUsageInMegabytes(usage = process.memoryUsage()) {
  return Object.fromEntries(
    ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"].map((field) => [
      field,
      Number((usage[field] / 1024 / 1024).toFixed(2))
    ])
  );
}

function startupPeakInMegabytes() {
  return Object.fromEntries(
    ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"].map((field) => [
      field,
      Number((
        Math.max(0, ...startupMemorySamples.map((sample) => sample[field] || 0)) /
        1024 /
        1024
      ).toFixed(2))
    ])
  );
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  });
}

function toCompactMaterial(material) {
  const fields = [
    "id",
    "name",
    "name_zh",
    "abbr",
    "category",
    "category_zh",
    "subcategory",
    "family",
    "grade_name",
    "supplier_or_brand",
    "manufacturer",
    "trade_name",
    "density",
    "tensile",
    "flexural_strength",
    "impact_strength",
    "hardness",
    "tg",
    "tm",
    "maxTemp",
    "continuous_use_temperature",
    "elongation",
    "thermal_conductivity",
    "dielectric",
    "flame_rating",
    "electrical_insulation",
    "chemical_resistance",
    "transparency",
    "flexibility",
    "waterproof_sealing",
    "water_absorption",
    "flammability",
    "recyclability",
    "recyclable",
    "cost_level",
    "processing_methods",
    "tags",
    "uses",
    "summary",
    "record_type",
    "record_origin",
    "scope_status",
    "catalog_visibility",
    "entityType"
  ];
  const compact = {};
  fields.forEach((field) => {
    if (material[field] !== undefined) compact[field] = material[field];
  });
  compact.data_quality = Object.fromEntries(
    Object.entries(material.data_quality || {}).filter(([key]) => key !== "issues")
  );
  compact.evidence = toCompactEvidence(material);
  return compact;
}

function toCompactEvidence(material) {
  const identity = material.evidence?.identity || {};
  const compact = {
    identity: {
      manufacturer: identity.manufacturer ?? null,
      brand: identity.brand ?? null,
      commercialGrade: identity.commercialGrade ?? null,
      materialFamily: identity.materialFamily ?? null,
      verificationStatus: identity.verificationStatus || "unverified",
      confidenceLevel: identity.confidenceLevel || "low",
      lastVerifiedAt: identity.lastVerifiedAt ?? null,
      sources: (identity.sources || []).map(compactSource)
    },
    properties: {},
    certifications: []
  };

  // Quarantined records are never recommendable or comparable. Keeping only
  // their identity evidence prevents the compact catalog from carrying a large
  // block of unusable legacy property claims.
  if (material.data_quality?.level === "quarantined") return compact;

  for (const [propertyKey, claims] of Object.entries(material.evidence?.properties || {})) {
    compact.properties[propertyKey] = claims.map((claim) => ({
      value: claim.value ?? null,
      unit: claim.unit ?? null,
      testStandard: claim.testStandard ?? null,
      testCondition: claim.testCondition ?? null,
      valueType: claim.valueType || "unknown",
      verificationStatus: claim.verificationStatus || "unverified",
      confidenceLevel: claim.confidenceLevel || "low",
      lastVerifiedAt: claim.lastVerifiedAt ?? null,
      evidenceVersion: claim.evidenceVersion || 1,
      conflictGroupId: claim.conflictGroupId ?? null,
      conflictStatus: claim.conflictStatus || "none",
      source: compactSource(claim.source || claim)
    }));
  }
  compact.certifications = (material.evidence?.certifications || []).map((certification) => ({
    certificationName: certification.certificationName ?? null,
    certificationStatus: certification.certificationStatus || "unknown",
    scope: certification.scope ?? null,
    verificationStatus: certification.verificationStatus || "unverified",
    confidenceLevel: certification.confidenceLevel || "low",
    lastVerifiedAt: certification.lastVerifiedAt ?? null,
    evidenceVersion: certification.evidenceVersion || 1,
    source: compactSource(certification.source || certification)
  }));
  return compact;
}

function compactSource(source) {
  return {
    sourceType: source.sourceType || "unknown",
    sourceTitle: source.sourceTitle ?? null,
    sourceUrl: source.sourceUrl ?? null,
    sourceDate: source.sourceDate ?? null
  };
}

async function handleMaterialAnalysis(request, response, identity) {
  const retryAfterSeconds = apiProtection.aiClient(identity);
  if (retryAfterSeconds) return sendRateLimit(response, retryAfterSeconds);
  const { materialIds, language } = validateAiBody("analysis", await readJsonBody(request));
  const material = repository.getMaterialById(materialIds[0]);

  if (!material) {
    sendJson(response, 404, { error: "Material not found" });
    return;
  }
  if (material.data_quality?.recommendation_eligible === false) {
    sendJson(response, 422, {
      error: "Material data failed quality checks",
      issues: material.data_quality.issues
    });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" });
    return;
  }
  if (!allowedAiModels.has(model)) {
    sendJson(response, 503, { error: "AI model is unavailable" });
    return;
  }

  const providerBody = buildProviderBody(buildAnalysisPrompt(material, language), 700);
  const key = JSON.stringify(["analysis", model, language, material.id]);
  const analysis = await aiCoordinator.run({
    key,
    identity,
    response,
    task: async (signal) => {
      const parsed = parseJsonObject(await requestOpenAIJson(providerBody, signal));
      validateProviderResult("analysis", parsed);
      return normalizeAnalysis(parsed);
    }
  });
  if (response.destroyed) return;
  sendJson(response, 200, { materialId: material.id, materialName: material.name, analysis });
}

async function handleMaterialComparison(request, response, identity) {
  const retryAfterSeconds = apiProtection.aiClient(identity);
  if (retryAfterSeconds) return sendRateLimit(response, retryAfterSeconds);
  const { materialIds, language } = validateAiBody("comparison", await readJsonBody(request));
  const pair = materialIds.map((id) => repository.getMaterialById(id));

  if (pair.length !== 2 || pair.some((item) => !item)) {
    sendJson(response, 400, { error: "Exactly two valid materialIds are required" });
    return;
  }

  if (pair[0].id === pair[1].id) {
    sendJson(response, 400, { error: "Choose two different materials" });
    return;
  }
  if (pair.some((item) => item.data_quality?.level === "quarantined")) {
    sendJson(response, 422, {
      error: "One or more material records failed quality checks",
      materialIds: pair
        .filter((item) => item.data_quality?.level === "quarantined")
        .map((item) => item.id)
    });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" });
    return;
  }
  if (!allowedAiModels.has(model)) {
    sendJson(response, 503, { error: "AI model is unavailable" });
    return;
  }

  const providerBody = buildProviderBody(buildComparisonPrompt(pair, language), 900);
  const key = JSON.stringify(["comparison", model, language, ...pair.map((item) => item.id)]);
  const comparison = await aiCoordinator.run({
    key,
    identity,
    response,
    task: async (signal) => {
      const parsed = parseJsonObject(await requestOpenAIJson(providerBody, signal));
      validateProviderResult("comparison", parsed);
      return normalizeComparison(parsed);
    }
  });
  if (response.destroyed) return;
  sendJson(response, 200, {
    materialIds: pair.map((item) => item.id),
    materialNames: pair.map((item) => item.name),
    comparison
  });
}

function buildAnalysisPrompt(material, language) {
  return {
    targetLanguage: language === "zh" ? "Simplified Chinese" : "English",
    task: "Explain this polymer material using only the supplied local database fields. Do not invent properties, standards, certifications, numeric values, grades, or applications that are not supported by the provided object. If something is not specified, say so plainly.",
    requiredJsonShape: {
      overview: "one concise paragraph",
      advantages: ["3 to 5 bullets grounded in provided fields"],
      limitations: ["2 to 4 bullets grounded in provided fields or notes"],
      recommendedApplications: ["3 to 5 applications supported by uses, tags, and properties"]
    },
    material
  };
}

function buildComparisonPrompt(pair, language) {
  return {
    targetLanguage: language === "zh" ? "Simplified Chinese" : "English",
    task: "Compare these two polymer materials using only the supplied local database profiles. Do not invent properties, standards, certifications, numeric values, grades, or applications that are not supported by the provided objects. If a difference is not supported by the fields, say it is not specified.",
    requiredJsonShape: {
      keyDifferences: ["3 to 5 bullets comparing provided properties or tags"],
      strengthsAndWeaknesses: ["4 to 6 bullets covering both materials"],
      recommendedUseCases: ["3 to 5 bullets mapping each material to supported uses"],
      selectionAdvice: "one concise paragraph explaining when to choose each material"
    },
    materials: pair
  };
}

function buildProviderBody(prompt, maxCompletionTokens) {
  const body = JSON.stringify({
    model,
    temperature: 0.2,
    max_completion_tokens: maxCompletionTokens,
    messages: [
      {
        role: "system",
        content:
          "You are a cautious polymer materials assistant. Explain only from provided source data. Return strict JSON in the requested targetLanguage and do not include markdown."
      },
      {
        role: "user",
        content: JSON.stringify(prompt)
      }
    ]
  });
  if (Buffer.byteLength(body) > MAX_PROMPT_BYTES) {
    throw new ApiError(422, "AI input exceeds size limit");
  }
  return body;
}

async function requestOpenAIJson(body, signal) {
  const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body
  });

  const payload = await apiResponse.json();

  if (!apiResponse.ok) {
    throw new Error("OpenAI request failed");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Malformed AI response");
  return content;
}

function validateProviderResult(type, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Malformed AI response");
  }
  const textField = type === "analysis" ? "overview" : "selectionAdvice";
  const listFields = type === "analysis"
    ? ["advantages", "limitations", "recommendedApplications"]
    : ["keyDifferences", "strengthsAndWeaknesses", "recommendedUseCases"];
  if (typeof result[textField] !== "string" || !result[textField].trim() ||
      listFields.some((field) => !Array.isArray(result[field]))) {
    throw new Error("Malformed AI response");
  }
}

function normalizeAnalysis(analysis) {
  return {
    overview: String(analysis.overview || "No overview returned."),
    advantages: normalizeList(analysis.advantages),
    limitations: normalizeList(analysis.limitations),
    recommendedApplications: normalizeList(analysis.recommendedApplications)
  };
}

function normalizeComparison(comparison) {
  return {
    keyDifferences: normalizeList(comparison.keyDifferences),
    strengthsAndWeaknesses: normalizeList(comparison.strengthsAndWeaknesses),
    recommendedUseCases: normalizeList(comparison.recommendedUseCases),
    selectionAdvice: String(comparison.selectionAdvice || "No selection advice returned.")
  };
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function attachCorsHeaders(request, response, requestPath) {
  if (!requestPath.startsWith("/api/")) return;

  const origin = request.headers.origin;
  if (!origin) return;

  if (allowedOrigins.includes("*")) {
    response.setHeader("Access-Control-Allow-Origin", "*");
  } else if (allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  } else {
    return;
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean).slice(0, 6);
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (appRoutes.has(url.pathname)) {
    servePublicFile(path.join(publicDir, "index.html"), response);
    return;
  }

  const filePath = resolvePublicFile(url.pathname);
  if (!filePath) {
    sendNotFound(response);
    return;
  }

  servePublicFile(filePath, response);
}

function resolvePublicFile(requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath).replace(/\\/g, "/");
  } catch {
    return null;
  }

  if (!decodedPath.startsWith("/") || decodedPath.includes("\0")) return null;
  if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  if (publicFiles.has(decodedPath)) {
    return path.join(publicDir, decodedPath.slice(1));
  }

  if (!decodedPath.startsWith("/assets/")) return null;
  const filePath = path.resolve(publicDir, `.${decodedPath}`);
  const relativePath = path.relative(publicDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return filePath;
}

function servePublicFile(filePath, response) {
  try {
    if (!fs.statSync(filePath).isFile()) {
      sendNotFound(response);
      return;
    }

    const realFilePath = fs.realpathSync(filePath);
    const relativePath = path.relative(realPublicDir, realFilePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      sendNotFound(response);
      return;
    }

    serveFile(realFilePath, response);
  } catch {
    sendNotFound(response);
  }
}

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function serveFile(filePath, response) {
  const ext = path.extname(filePath);
  response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  const json = JSON.stringify(payload);
  const body = response.acceptsGzip && Buffer.byteLength(json) > 1024
    ? zlib.gzipSync(json, { level: zlib.constants.Z_BEST_SPEED })
    : Buffer.from(json);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const vary = String(response.getHeader("Vary") || "");
  response.setHeader("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  if (response.acceptsGzip && Buffer.byteLength(json) > 1024) {
    response.setHeader("Content-Encoding", "gzip");
  }
  response.setHeader("Content-Length", String(body.length));
  response.writeHead(status);
  response.end(body);
}
