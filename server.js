const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { MaterialRepository } = require("./material-repository");
const { readPilotStatus } = require("./pilot-status");

const rootDir = __dirname;
loadEnvFile(path.join(rootDir, ".env"));
loadEnvFile(path.join(rootDir, ".env.local"));

const nodeEnv = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const databasePath = path.resolve(rootDir, process.env.MATFINDER_DB_PATH || "matfinder.db");
const allowedOrigins = parseList(process.env.MATFINDER_ALLOWED_ORIGINS);

const startupMemorySamples = [];
logMemory("before_sqlite_connection");
const repository = new MaterialRepository(databasePath);
logMemory("after_sqlite_connection");
const schemaInfo = repository.checkSchema();
logMemory("after_schema_version_check", {
  migrationExecuted: false,
  schemaVersion: schemaInfo.version
});
const { families: polymerFamilies } = require("./polymer-families");
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

    if (request.method === "GET" && requestPath === "/api/health") {
      const counts = repository.getDatabaseCounts();
      sendJson(response, 200, {
        status: "ok",
        environment: nodeEnv,
        materials: counts.materials,
        propertyEvidence: counts.propertyEvidence,
        database: path.basename(databasePath),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        memory: memoryUsageInMegabytes(),
        startupPeak: startupPeakInMegabytes(),
        repository: repository.getMetrics()
      });
      return;
    }

    if (request.method === "GET" && requestPath === "/api/materials") {
      const auditMode = requestUrl.searchParams.get("audit") === "1";
      const query = String(requestUrl.searchParams.get("q") || "").trim();
      const result = repository.listMaterials({
        audit: auditMode,
        query,
        limit: requestUrl.searchParams.get("limit"),
        offset: requestUrl.searchParams.get("offset")
      });
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
      sendJson(response, 200, repository.getCatalogStats());
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
      const candidates = repository.getRecommendationCandidates({
        limit: requestUrl.searchParams.get("limit")
      });
      sendJson(response, 200, {
        items: candidates,
        total: candidates.length,
        bounded: true
      });
      return;
    }

    if (request.method === "GET" && requestPath.startsWith("/api/materials/")) {
      const materialId = decodeURIComponent(requestPath.slice("/api/materials/".length));
      const material = repository.getMaterialById(materialId, {
        audit: requestUrl.searchParams.get("audit") === "1"
      });
      if (!material) {
        sendJson(response, 404, { error: "Material not found" });
        return;
      }
      sendJson(response, 200, material);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/material-analysis") {
      await handleMaterialAnalysis(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/material-comparison") {
      await handleMaterialComparison(request, response);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(port, () => {
  logMemory("after_http_listen");
  console.log(`MatFinder AI running in ${nodeEnv} mode at http://localhost:${port}`);
});

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

async function handleMaterialAnalysis(request, response) {
  const body = await readJsonBody(request);
  const language = normalizeLanguage(body.language);
  const material = repository.getMaterialById(body.materialId);

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

  const analysis = await generateMaterialAnalysis(material, language);
  sendJson(response, 200, { materialId: material.id, materialName: material.name, analysis });
}

async function handleMaterialComparison(request, response) {
  const body = await readJsonBody(request);
  const language = normalizeLanguage(body.language);
  const requestedIds = Array.isArray(body.materialIds) ? body.materialIds.slice(0, 2) : [];
  const pair = requestedIds.map((id) => repository.getMaterialById(id));

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

  const comparison = await generateMaterialComparison(pair, language);
  sendJson(response, 200, {
    materialIds: pair.map((item) => item.id),
    materialNames: pair.map((item) => item.name),
    comparison
  });
}

async function generateMaterialAnalysis(material, language) {
  const prompt = {
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

  const content = await requestOpenAIJson(prompt);
  return normalizeAnalysis(parseJsonObject(content));
}

async function generateMaterialComparison(pair, language) {
  const prompt = {
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

  const content = await requestOpenAIJson(prompt);
  return normalizeComparison(parseJsonObject(content));
}

async function requestOpenAIJson(prompt) {
  const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
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
    })
  });

  const payload = await apiResponse.json();

  if (!apiResponse.ok) {
    const message = payload.error?.message || "OpenAI request failed";
    throw new Error(message);
  }

  return payload.choices?.[0]?.message?.content || "{}";
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

function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh";
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
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
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
    const acceptsHtml = String(request.headers.accept || "").includes("text/html");
    const hasExtension = Boolean(path.extname(requestedPath));
    if ((acceptsHtml && !hasExtension) || appRoutes.has(url.pathname)) {
      serveFile(path.join(rootDir, "index.html"), response);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  serveFile(filePath, response);
}

function serveFile(filePath, response) {
  const ext = path.extname(filePath);
  response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function sendJson(response, status, payload) {
  const json = JSON.stringify(payload);
  const body = response.acceptsGzip && Buffer.byteLength(json) > 1024
    ? zlib.gzipSync(json, { level: zlib.constants.Z_BEST_SPEED })
    : Buffer.from(json);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Vary", "Accept-Encoding");
  if (response.acceptsGzip && Buffer.byteLength(json) > 1024) {
    response.setHeader("Content-Encoding", "gzip");
  }
  response.setHeader("Content-Length", String(body.length));
  response.writeHead(status);
  response.end(body);
}
