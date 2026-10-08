const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  DOMAIN_IDS, MaterialRepository, PERFORMANCE_ALIASES, PERFORMANCE_IDS,
  buildPublicCatalogPredicate
} = require("../catalog-policy").loadCanonicalPolicy().repository;
const catalogSearch = require("../public/catalog-search");

const root = path.resolve(__dirname, "..");
const fakeAdminToken = "AD04_FIXTURE_ADMIN_TOKEN_ONLY";
const FROZEN_PERFORMANCE_IDS = Object.freeze([
  "heat-resistant", "flame-retardant", "low-temperature-resistant",
  "high-strength", "high-toughness", "wear-resistant", "impact-resistant",
  "chemical-resistant", "acid-resistant", "alkali-resistant", "oil-resistant",
  "electrical-insulation", "high-dielectric", "low-dielectric", "conductive-antistatic",
  "transparent", "optical-clarity", "uv-resistant", "elastomer", "flexible",
  "waterproof-sealing", "gasket-seal", "recyclable", "bio-based", "compostable",
  "low-density-lightweight"
]);
const FROZEN_DOMAIN_IDS = Object.freeze([
  "automotive", "ev-battery", "electronics", "aerospace", "medical",
  "construction", "industrial-sealing", "consumer-electronics"
]);
const FROZEN_PERFORMANCE_ALIASES = Object.freeze({
  "high-temp": "heat-resistant", strength: "high-strength",
  chemical: "chemical-resistant", sustainable: "recyclable",
  electrical: "electrical-insulation"
});
const PHRASE_CASES = Object.freeze([
  { id: "TAG", category: "ZT", field: "tags", words: ["heat", "resistant"] },
  { id: "USE", category: "ZU", field: "uses", words: ["thermal", "seal"] },
  { id: "METHOD", category: "ZM", field: "processing_methods", words: ["injection", "molding"] }
]);
const WHITESPACE_CASES = Object.freeze([
  { id: "SPACE", category: "ZWS", value: "heat   resistant" },
  { id: "TAB", category: "ZWT", value: "heat\tresistant" },
  { id: "NEWLINE", category: "ZWN", value: "heat\nresistant" }
]);

if (process.argv.includes("--probe-server")) {
  // The child must not read a developer's local environment files.
  const originalExistsSync = fs.existsSync;
  fs.existsSync = function (filePath) {
    if (typeof filePath === "string" &&
        [".env", ".env.local"].includes(path.basename(filePath))) return false;
    return originalExistsSync.apply(this, arguments);
  };
  // AD-02 has its own limiter regressions. Keep its admin authentication real,
  // but isolate this large catalog validation matrix from the public GET bucket.
  const protection = require("../api-protection");
  const createApiProtection = protection.createApiProtection;
  protection.createApiProtection = function (options) {
    return { ...createApiProtection(options), publicGet: () => 0 };
  };
  require("../server");
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  assert.equal(FROZEN_PERFORMANCE_IDS.length, 26);
  assert.equal(FROZEN_DOMAIN_IDS.length, 8);
  assert.deepEqual([...PERFORMANCE_IDS].sort(), [...FROZEN_PERFORMANCE_IDS].sort());
  assert.deepEqual([...DOMAIN_IDS].sort(), [...FROZEN_DOMAIN_IDS].sort());
  assert.deepEqual({ ...PERFORMANCE_ALIASES }, FROZEN_PERFORMANCE_ALIASES);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-ad04-query-"));
  const databasePath = path.join(directory, "catalog-fixture.db");
  try {
    createEmptySchemaDatabase(path.join(root, "matfinder.db"), databasePath);
    populateFixtures(databasePath);
    const repository = new MaterialRepository(databasePath);
    try {
      repositoryChecks(repository);
      queryPlanChecks(repository);
    } finally {
      repository.close();
    }
    await withServer(databasePath, httpChecks);
    frontendCardChecks();
    process.stdout.write("AD-04 backend material query regressions passed.\n");
  } finally {
    if (path.dirname(directory) === os.tmpdir() &&
        path.basename(directory).startsWith("matfinder-ad04-query-")) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function createEmptySchemaDatabase(_sourcePath, destinationPath) {
  require("./schema-test-fixtures").bootstrapFixture(destinationPath);
}

function populateFixtures(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN");
    for (let index = 0; index < 48; index += 1) {
      insertMaterial(database, `PAGE-A-${index}`, {
        name: `A ${String(index).padStart(2, "0")}`, category: "PageA"
      });
    }
    insertMaterial(database, "PAGE-B", { name: "Z Page B", category: "PageB" });
    insertMaterial(database, "PAGE-B-PADDED", {
      name: "Z Padded Page B", category: " PageB "
    });

    insertMaterial(database, "S-EXACT", {
      category: "Search", name: "Exact polymer", abbreviation: "PC"
    });
    insertMaterial(database, "S-TOKEN", {
      category: "Search", name: "PC/ABS candidate", abbreviation: "TOKEN"
    });
    insertMaterial(database, "S-LONG", {
      category: "Search", name: "NPCX candidate", abbreviation: "NPCX"
    });
    insertMaterial(database, "S-CJK", {
      category: "Search", name: "中PC文", abbreviation: "CJK"
    });
    insertMaterial(database, "S-BROAD", {
      category: "Search", name: "Material B", summary: "transparent protective panel",
      uses: ["impact housing"], tags: ["clear device"],
      processing_methods: '["injection molding"]'
    });
    insertMaterial(database, "S-HIDDEN", {
      category: "Search", name: "Hidden field case", applications: '["secretneedle"]',
      description_en: "secretneedle", notes: "secretneedle", source_note: "secretneedle"
    });
    insertMaterial(database, "S-LITERAL", {
      category: "Search", name: "Literal symbols", summary: "literal%_\\ marker"
    });
    insertMaterial(database, "S-RANK-EXACT", {
      category: "Search", name: "alpha", abbreviation: "ALPHA", summary: "alpha"
    });
    insertMaterial(database, "S-RANK-TOKEN", {
      category: "Search", name: "X alpha Y"
    });
    insertMaterial(database, "S-RANK-PREFIX", {
      category: "Search", name: "alphabeta"
    });
    insertMaterial(database, "S-RANK-SUBSTR", {
      category: "Search", name: "zzalphazz"
    });
    insertMaterial(database, "S-RANK-BROAD", {
      category: "Search", name: "Broad ranking", summary: "alpha topic"
    });

    insertMaterial(database, "N-HIGH", {
      category: "Numeric", name: "N High", continuous_use_temperature: 200,
      max_temperature: 220, tensile_strength: 100, density: 1.5
    });
    insertMaterial(database, "N-LOW", {
      category: "Numeric", name: "N Low", continuous_use_temperature: 50,
      max_temperature: 250, tensile_strength: 20, density: 0.9
    });
    insertMaterial(database, "N-MISSING", {
      category: "Numeric", name: "N Missing", continuous_use_temperature: null,
      max_temperature: 180, tensile_strength: null, density: null
    });
    insertMaterial(database, "N-UNKNOWN", {
      category: "Numeric", name: "N Unknown", continuous_use_temperature: "N/A",
      tensile_strength: "unknown", density: "N/A"
    });

    for (const [index, id] of FROZEN_PERFORMANCE_IDS.entries()) {
      insertMaterial(database, `P-${id}`, {
        category: "ZP", category_zh: "ZP", name: `Z positive ${index}`,
        name_zh: `Z positive ${index}`, abbreviation: `P${index}`,
        summary: performanceSignal(id)
      });
      insertMaterial(database, `P-HIDDEN-${id}`, {
        category: "ZN", category_zh: "ZN", name: `Z hidden ${index}`,
        name_zh: `Z hidden ${index}`, abbreviation: `H${index}`,
        applications: JSON.stringify([performanceSignal(id)]),
        description_en: performanceSignal(id), notes: performanceSignal(id),
        source_note: performanceSignal(id)
      });
    }
    for (const [index, id] of FROZEN_DOMAIN_IDS.entries()) {
      insertMaterial(database, `D-${id}`, {
        category: "ZD", category_zh: "ZD", name: `Z domain ${index}`,
        name_zh: `Z domain ${index}`, abbreviation: `D${index}`,
        uses: [domainSignal(id)]
      });
      insertMaterial(database, `D-HIDDEN-${id}`, {
        category: "ZX", category_zh: "ZX", name: `Z hidden domain ${index}`,
        name_zh: `Z hidden domain ${index}`, abbreviation: `X${index}`,
        applications: JSON.stringify([domainSignal(id)]),
        description_en: domainSignal(id), source_note: domainSignal(id)
      });
    }
    for (const [id, gradeName, tradeName] of [
      ["G-EFFECTIVE", "heat resistant grade", "ordinary trade"],
      ["G-SEPARATE", "ordinary grade", "heat resistant trade"],
      ["G-FALLBACK", null, "heat resistant trade"],
      ["G-EMPTY", "", "heat resistant trade"],
      ["G-SPACES", "   ", "heat resistant trade"],
      ["G-TABNEWLINE", "\t\n", "heat resistant trade"],
      ["G-INTERNAL", "Grade  A", "heat resistant trade"]
    ]) {
      insertMaterial(database, id, {
        category: "ZG", category_zh: "ZG", name: "Z grade",
        name_zh: "Z grade", abbreviation: "ZG",
        grade_name: gradeName, trade_name: tradeName
      });
    }
    for (const { id, category, field, words } of PHRASE_CASES) {
      for (const [suffix, name, values] of [
        ["ADJ", "Zulu", words], ["GAP", "Alpha", [words[0], "between", words[1]]]
      ]) {
        insertMaterial(database, `PH-${id}-${suffix}`, {
          category, category_zh: category, name, name_zh: name,
          abbreviation: `PH${id}${suffix}`,
          [field]: field === "processing_methods" ? JSON.stringify(values) : values
        });
      }
    }
    for (const [id, category, name, tags] of [
      ["PS-TAG-ADJ", "ZPS", "Zulu tag", ["heat", "resistant"]],
      ["PS-TAG-GAP", "ZPS", "Alpha tag", ["heat", "unrelated", "resistant"]],
      ["PS-TAG-REPEAT", "ZPS", "Zeta tag", ["heat", "resistant", "heat", "resistant"]]
    ]) insertMaterial(database, id, { category, name, tags });
    insertMaterial(database, "PS-CROSS", {
      category: "ZPS", name: "Ypsilon cross", tags: ["heat"], uses: ["resistant"]
    });
    insertMaterial(database, "PS-CROSS-GAP", {
      category: "ZPS", name: "Beta cross gap", tags: ["heat"],
      uses: ["unrelated", "resistant"]
    });
    for (const [id, name, methods] of [
      ["PS-METHOD-ADJ", "Zulu method", ["chemical", "resistant"]],
      ["PS-METHOD-GAP", "Alpha method", ["chemical", "unrelated", "resistant"]]
    ]) insertMaterial(database, id, {
      category: "ZPM", name, processing_methods: JSON.stringify(methods)
    });
    for (const [id, name, uses] of [
      ["DU-ADJ", "Zulu use", ["consumer", "electronics"]],
      ["DU-GAP", "Alpha use", ["consumer", "unrelated", "electronics"]],
      ["DU-REPEAT", "Zeta use", ["consumer", "electronics", "consumer", "electronics"]]
    ]) insertMaterial(database, id, { category: "ZDU", name, uses });
    insertMaterial(database, "DU-CROSS", {
      category: "ZDU", name: "Ypsilon cross", uses: ["consumer"], summary: "electronics"
    });
    insertMaterial(database, "DU-CROSS-GAP", {
      category: "ZDU", name: "Beta cross gap", uses: ["consumer", "unrelated"],
      summary: "electronics"
    });
    insertMaterial(database, "DU-HIDDEN", {
      category: "ZDU", name: "Hidden use", applications: '["consumer electronics"]',
      description_en: "consumer electronics", source_note: "consumer electronics"
    });
    for (const { id, category, value } of WHITESPACE_CASES) {
      insertMaterial(database, `WS-${id}-PHRASE`, {
        category, name: "Zulu phrase", summary: value
      });
      insertMaterial(database, `WS-${id}-GAP`, {
        category, name: "Alpha gap", summary: "heat unrelated resistant"
      });
    }
    insertMaterial(database, "F-OVERLAP", {
      category: "FacetOverlap", name: "Overlap", summary: "heat resistant flame retardant"
    });
    insertMaterial(database, "F-OTHER", { category: "FacetOverlap", name: "Other" });

    let numericIndex = 0;
    for (const [id, column, value] of [
      ["PN-HEAT", "max_temperature", 160],
      ["PN-COLD", "glass_transition_temperature", -35],
      ["PN-STRENGTH", "tensile_strength", 70],
      ["PN-FLEXURAL", "flexural_strength", 100],
      ["PN-TOUGH", "elongation", 80],
      ["PN-HIGH-DIELECTRIC", "dielectric_constant", 4],
      ["PN-LOW-DIELECTRIC", "dielectric_constant", 2.5],
      ["PN-FLEXIBLE", "elongation", 150],
      ["PN-LIGHT", "density", 1.1]
    ]) {
      insertMaterial(database, id, {
        category: "ZNUM", category_zh: "ZNUM", name: `Z numeric ${numericIndex}`,
        name_zh: `Z numeric ${numericIndex}`, abbreviation: `N${numericIndex}`,
        [column]: value
      });
      numericIndex += 1;
    }
    for (const [index, [id, values]] of [
      ["PN-HEAT", { max_temperature: 149 }],
      ["PN-COLD", { glass_transition_temperature: -29 }],
      ["PN-STRENGTH", { tensile_strength: 69, flexural_strength: 99 }],
      ["PN-TOUGH", { elongation: 79 }],
      ["PN-HIGH-DIELECTRIC", { dielectric_constant: 3.9 }],
      ["PN-LOW-DIELECTRIC", { dielectric_constant: 2.9 }],
      ["PN-FLEXIBLE", { elongation: 149 }],
      ["PN-LIGHT", { density: 1.21 }]
    ].entries()) {
      insertMaterial(database, `NEG-${id}`, {
        category: "ZNEG", category_zh: "ZNEG", name: `Z threshold ${index}`,
        name_zh: `Z threshold ${index}`, abbreviation: `T${index}`, ...values
      });
    }
    insertMaterial(database, "TIE-B", { category: "NameTie", name: "Same name" });
    insertMaterial(database, "TIE-A", { category: "NameTie", name: "Same name" });

    insertMaterial(database, "W-MISSING", { category: "Water", name: "Water missing" });
    insertMaterial(database, "W-KNOWN", {
      category: "Water", name: "Water known", water_absorption: 0.1
    });
    insertMaterial(database, "W-BELOW", {
      category: "Water", name: "Water below threshold", water_absorption: 0.21
    });
    insertMaterial(database, "W-TEXT", {
      category: "Water", name: "Water text", summary: "waterproof layer"
    });
    for (const [id, value] of [
      ["R-YES", "recyclable"], ["R-NOT", "not typically recyclable"],
      ["R-JOINED", "nonrecyclable"], ["R-HYPHEN", "non-recyclable"],
      ["R-UNKNOWN", null]
    ]) insertMaterial(database, id, { category: "Recycle", name: id, recyclability: value });

    insertMaterial(database, "C-MATCH", {
      category: "Combined", name: "Combined row", summary: "high strength panel",
      uses: ["automotive housing"], continuous_use_temperature: 150,
      tensile_strength: 80, recyclability: "recyclable"
    });
    for (let index = 0; index < 20; index += 1) {
      insertMaterial(database, `G-${index}`, {
        category: "GeneratedFixture", name: `Generated fixture ${String(index).padStart(2, "0")}`,
        continuous_use_temperature: index % 3 ? index * 10 : null,
        tensile_strength: index % 4 ? index * 5 : null,
        uses: index === 1 ? ["automotive", "automotive"] : index % 2 ? ["automotive"] : [],
        tags: index === 1 ? ["repeated", "repeated"] : []
      });
    }

    insertMaterial(database, "X-GENERATED", { record_origin: "generated" });
    insertMaterial(database, "X-LEGACY", { record_type: "legacy", record_origin: "legacy" });
    insertMaterial(database, "X-ADMIN", { catalog_visibility: "admin_only" });
    insertMaterial(database, "X-OUT", { scope_status: "out_of_scope" });
    insertMaterial(database, "X-NO-ID", { identity: false });
    insertMaterial(database, "X-INACTIVE", { active: 0 });
    insertMaterial(database, "X-QUARANTINED", { quarantined: true });
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    database.close();
  }
}

function insertMaterial(database, id, overrides = {}) {
  const base = {
    material_id: id, name: id, name_en: id, name_zh: id,
    abbreviation: id, category: "Fixtures", category_en: "Fixtures",
    category_zh: "Fixtures", processing_methods: "[]", applications: "[]",
    applications_en: "[]", applications_zh: "[]", limitations: "[]",
    alternatives: "[]", source_note: "", typical_applications: "[]", advantages: "[]",
    disadvantages: "[]", tags_en: "[]", tags_zh: "[]", summary: "",
    description_en: "", description_zh: "", translation_quality: "partial",
    translation_status: "partial", notes: "", record_type: "commercial_grade",
    record_origin: "imported", scope_status: "in_scope", catalog_visibility: "public"
  };
  const { identity = true, active = 1, quarantined = false, tags = [], uses = [],
    ...columnsOverride } = overrides;
  const row = { ...base, ...columnsOverride };
  const columns = Object.keys(row);
  database.prepare(`INSERT INTO materials (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => row[column]));
  if (identity) database.prepare(
    "INSERT INTO real_material_identities (material_id, manufacturer, commercial_grade, " +
    "material_family, manufacturer_key, commercial_grade_key, material_family_key, " +
    "created_at, active) VALUES (?, ?, ?, 'PC', ?, ?, 'pc', '2026-01-01', ?)"
  ).run(id, "AD04 FIXTURE", id, id.toLowerCase(), id.toLowerCase(), active);
  const insertTag = database.prepare("INSERT INTO material_tags (material_id, tag, position) VALUES (?, ?, ?)");
  tags.forEach((tag, index) => insertTag.run(id, tag, index));
  const insertUse = database.prepare("INSERT INTO material_uses (material_id, use, position) VALUES (?, ?, ?)");
  uses.forEach((use, index) => insertUse.run(id, use, index));
  if (quarantined) database.prepare(
    "INSERT INTO material_evidence (material_id, source_type, verification_status, " +
    "confidence_level) VALUES (?, 'unknown', 'quarantined', 'quarantined')"
  ).run(id);
}

function performanceSignal(id) {
  const signals = {
    "heat-resistant": "heat resistant", "flame-retardant": "flame retardant",
    "low-temperature-resistant": "cryogenic", "high-strength": "high strength",
    "high-toughness": "toughened", "wear-resistant": "abrasion resistant",
    "impact-resistant": "impact modified", "chemical-resistant": "chemical resistance",
    "acid-resistant": "acid resistant", "alkali-resistant": "alkaline",
    "oil-resistant": "fuel resistant", "electrical-insulation": "electrical insulation",
    "high-dielectric": "high dielectric", "low-dielectric": "low dielectric",
    "conductive-antistatic": "antistatic", transparent: "transparent",
    "optical-clarity": "light guide", "uv-resistant": "uv stabilized",
    elastomer: "elastomer", flexible: "flexibility",
    "waterproof-sealing": "waterproof", "gasket-seal": "gasket",
    recyclable: "recycling", "bio-based": "bio-based",
    compostable: "compostable", "low-density-lightweight": "low density"
  };
  assert.ok(signals[id], id);
  return signals[id];
}

function domainSignal(id) {
  const signals = {
    automotive: "vehicle", "ev-battery": "battery pack", electronics: "pcb",
    aerospace: "satellite", medical: "surgical", construction: "roofing",
    "industrial-sealing": "flange", "consumer-electronics": "wearable"
  };
  assert.ok(signals[id], id);
  return signals[id];
}

function repositoryChecks(repository) {
  const list = (options = {}) => repository.listMaterials({ limit: 200, ...options });
  const ids = (options = {}) => list(options).items.map((item) => item.id);
  const defaultPage = repository.listMaterials();
  assert.equal(defaultPage.limit, 48);
  assert.equal(defaultPage.offset, 0);
  assert.equal(defaultPage.items.length, 48);
  assert.ok(defaultPage.total > 48);
  assert.equal(defaultPage.hasMore, true);
  assert.ok(!defaultPage.items.some((item) => item.id === "PAGE-B"),
    "Page B must sit beyond the initial page.");
  assert.deepEqual(ids({ category: "PageB" }), ["PAGE-B"]);
  assert.equal(list({ category: "absent-category" }).total, 0);

  assert.deepEqual(ids({ category: "Search", query: "pc" }), ["S-EXACT", "S-TOKEN"]);
  assert.ok(!ids({ category: "Search", query: "pc" }).includes("S-LONG"));
  assert.ok(!ids({ category: "Search", query: "pc" }).includes("S-CJK"),
    "Adjacent CJK letters are part of the same identity token.");
  assert.deepEqual(ids({ category: "Search", query: "transparent impact" }), ["S-BROAD"]);
  assert.deepEqual(ids({ category: "Search", query: "clear device" }), ["S-BROAD"]);
  assert.deepEqual(ids({ category: "Search", query: "molding" }), ["S-BROAD"]);
  assert.deepEqual(ids({ category: "Search", query: "secretneedle" }), []);
  for (const symbol of ["%", "_", "\\"]) {
    assert.deepEqual(ids({ category: "Search", query: symbol }), ["S-LITERAL"]);
  }
  assert.deepEqual(ids({ category: "Search", query: "' OR 1=1 --" }), []);
  assert.deepEqual(ids({ category: "Search", query: "alpha", sort: "match" }), [
    "S-RANK-EXACT", "S-RANK-TOKEN", "S-RANK-PREFIX",
    "S-RANK-SUBSTR", "S-RANK-BROAD"
  ]);
  assert.deepEqual(ids({ category: "Search", sort: "match" }),
    ids({ category: "Search", sort: "name" }));

  for (const id of FROZEN_PERFORMANCE_IDS) {
    assert.ok(ids({ category: "ZP", performance: id }).includes(`P-${id}`), id);
    assert.equal(list({ category: "ZN", performance: id }).total, 0,
      `${id} must not match its keyword only in hidden fields.`);
  }
  for (const [id, facet] of [
    ["PN-HEAT", "heat-resistant"], ["PN-COLD", "low-temperature-resistant"],
    ["PN-STRENGTH", "high-strength"], ["PN-FLEXURAL", "high-strength"],
    ["PN-TOUGH", "high-toughness"], ["PN-HIGH-DIELECTRIC", "high-dielectric"],
    ["PN-LOW-DIELECTRIC", "low-dielectric"], ["PN-FLEXIBLE", "flexible"],
    ["PN-LIGHT", "low-density-lightweight"]
  ]) assert.ok(ids({ category: "ZNUM", performance: facet }).includes(id), id);
  for (const [id, facet] of [
    ["PN-HEAT", "heat-resistant"], ["PN-COLD", "low-temperature-resistant"],
    ["PN-STRENGTH", "high-strength"], ["PN-TOUGH", "high-toughness"],
    ["PN-HIGH-DIELECTRIC", "high-dielectric"],
    ["PN-LOW-DIELECTRIC", "low-dielectric"],
    ["PN-FLEXIBLE", "flexible"], ["PN-LIGHT", "low-density-lightweight"]
  ]) assert.ok(!ids({ category: "ZNEG", performance: facet }).includes(`NEG-${id}`), id);
  for (const id of FROZEN_DOMAIN_IDS) {
    assert.ok(ids({ category: "ZD", domain: id }).includes(`D-${id}`), id);
    assert.equal(list({ category: "ZX", domain: id }).total, 0,
      `${id} must not match its keyword only in hidden fields.`);
  }
  const effectiveGradeResult = list({ category: "ZG", performance: "heat-resistant" });
  assert.deepEqual(effectiveGradeResult.items.map((item) => item.id),
    ["G-EFFECTIVE", "G-EMPTY", "G-FALLBACK", "G-SPACES", "G-TABNEWLINE"],
    "Only the compact effective grade-name value is a performance signal.");
  assert.equal(effectiveGradeResult.total, 5);
  assert.equal(effectiveGradeResult.facets.performance.all, 7);
  assert.equal(effectiveGradeResult.facets.performance.options.find(
    (option) => option.id === "heat-resistant").count, 5);
  const effectiveGradePage = list({
    category: "ZG", performance: "heat-resistant", limit: 2, offset: 2
  });
  assert.equal(effectiveGradePage.total, 5);
  assert.deepEqual(effectiveGradePage.items.map((item) => item.id),
    ["G-FALLBACK", "G-SPACES"]);
  const gradeById = new Map(list({ category: "ZG" }).items.map((item) => [item.id, item]));
  for (const id of ["G-FALLBACK", "G-EMPTY", "G-SPACES", "G-TABNEWLINE"]) {
    assert.equal(gradeById.get(id).grade_name, "heat resistant trade", id);
    assert.equal(gradeById.get(id).trade_name, "heat resistant trade", id);
  }
  assert.equal(gradeById.get("G-SEPARATE").grade_name, "ordinary grade");
  assert.equal(gradeById.get("G-INTERNAL").grade_name, "Grade  A");
  assert.deepEqual(ids({ category: "ZG", query: "heat resistant" }).sort(),
    ["G-EFFECTIVE", "G-EMPTY", "G-FALLBACK", "G-INTERNAL", "G-SEPARATE",
      "G-SPACES", "G-TABNEWLINE"],
    "The separate trade name remains searchable by the unchanged q contract.");
  assert.deepEqual(ids({ category: "ZPS", performance: "heat-resistant" }).sort(),
    ["PS-CROSS", "PS-TAG-ADJ", "PS-TAG-REPEAT"],
    "A performance phrase spans adjacent tags, but not an unrelated tag.");
  const tagSignal = list({ category: "ZPS", performance: "heat-resistant" });
  assert.equal(tagSignal.total, 3);
  assert.equal(new Set(tagSignal.items.map((item) => item.id)).size, 3);
  assert.equal(tagSignal.facets.performance.options.find(
    (option) => option.id === "heat-resistant").count, 3,
    "Repeated matching tags must not inflate a performance facet.");
  assert.deepEqual(ids({ category: "ZPM", performance: "chemical-resistant" }),
    ["PS-METHOD-ADJ"],
    "A performance phrase spans adjacent processing methods only.");
  assert.deepEqual(ids({ category: "ZDU", domain: "consumer-electronics" }).sort(),
    ["DU-ADJ", "DU-CROSS", "DU-REPEAT"],
    "A domain phrase spans adjacent uses, not unrelated or hidden fields.");
  const domainSignal = list({ category: "ZDU", domain: "consumer-electronics" });
  assert.equal(domainSignal.total, 3);
  assert.equal(new Set(domainSignal.items.map((item) => item.id)).size, 3);
  assert.equal(domainSignal.facets.domains.options.find(
    (option) => option.id === "consumer-electronics").count, 3,
    "Repeated matching uses must not inflate a domain facet.");
  for (const { id, category, field, words } of PHRASE_CASES) {
    const query = words.join(" ");
    const ranked = ids({ category, query, sort: "match" });
    assert.deepEqual(ranked, [`PH-${id}-ADJ`, `PH-${id}-GAP`],
      `${field} adjacent entries must receive the +5 phrase score before pagination.`);
    assert.deepEqual(ids({ category, query, sort: "name" }),
      [`PH-${id}-GAP`, `PH-${id}-ADJ`]);
    assert.equal(catalogSearch.scoreMaterial({ [field]: words }, query), 5);
    assert.equal(list({ category, query, sort: "match" }).total,
      list({ category, query, sort: "name" }).total,
      "The score fix must not broaden q membership.");
    assert.deepEqual(ids({
      category, query, sort: "match",
      recommendations: [{ material: { id: `PH-${id}-GAP` }, score: 10000 }]
    }), ranked, "Recommendation scores must not affect catalog ordering.");
  }
  for (const { id, category, value } of WHITESPACE_CASES) {
    const query = "heat resistant";
    assert.equal(catalogSearch.scoreMaterial({ summary: value }, query), 5,
      `${id}: the independent browser oracle collapses internal whitespace.`);
    assert.deepEqual(ids({ category, query, sort: "match" }),
      [`WS-${id}-PHRASE`, `WS-${id}-GAP`],
      `${id}: +5 phrase relevance must sort before the alphabetic gap.`);
    assert.deepEqual(ids({ category, query, sort: "name" }),
      [`WS-${id}-GAP`, `WS-${id}-PHRASE`]);
    assert.equal(list({ category, query, sort: "match" }).total,
      list({ category, query, sort: "name" }).total,
      `${id}: ranking normalization must not change q membership.`);
  }
  assert.deepEqual(ids({
    category: "Combined", query: "high strength", performance: "high-strength",
    domain: "automotive", minTempC: 100, minTensileMpa: 0, recyclable: true
  }), ["C-MATCH"]);
  assert.equal(list({ category: "Combined", domain: "medical" }).total, 0);

  assert.deepEqual(ids({ category: "Numeric", minTempC: 100 }), ["N-HIGH"]);
  const numericItems = list({ category: "Numeric" }).items;
  const numericById = new Map(numericItems.map((item) => [item.id, item]));
  assert.equal(numericById.get("N-HIGH").continuous_use_temperature, 200);
  assert.equal(numericById.get("N-HIGH").max_temperature, 220);
  assert.equal(numericById.get("N-LOW").continuous_use_temperature, 50);
  assert.equal(numericById.get("N-LOW").max_temperature, 250);
  assert.equal(numericById.get("N-MISSING").continuous_use_temperature, null,
    "A missing continuous-use value must not inherit max_temperature.");
  assert.equal(numericById.get("N-MISSING").max_temperature, 180);
  assert.deepEqual(ids({ category: "Numeric", minTempC: -200 }).sort(),
    ["N-HIGH", "N-LOW"]);
  assert.deepEqual(ids({ category: "Numeric", minTensileMpa: 0 }).sort(),
    ["N-HIGH", "N-LOW"]);
  assert.equal(list({ category: "Numeric" }).total, 4);
  assert.deepEqual(ids({ category: "Water", performance: "waterproof-sealing" }).sort(),
    ["W-KNOWN", "W-TEXT"]);
  assert.deepEqual(ids({ category: "Recycle", recyclable: true }).sort(),
    ["R-HYPHEN", "R-YES"]);
  assert.ok(ids({ category: "Recycle", performance: "recyclable" }).includes("R-NOT"),
    "The existing performance text signal is distinct from the checkbox heuristic.");

  assert.deepEqual(ids({ category: "Numeric", sort: "temperature" }),
    ["N-HIGH", "N-LOW", "N-MISSING", "N-UNKNOWN"]);
  assert.deepEqual(ids({ category: "Numeric", sort: "strength" }),
    ["N-HIGH", "N-LOW", "N-MISSING", "N-UNKNOWN"]);
  assert.deepEqual(ids({ category: "Numeric", sort: "density" }),
    ["N-LOW", "N-HIGH", "N-MISSING", "N-UNKNOWN"]);
  assert.deepEqual(ids({ category: "NameTie", sort: "name" }), ["TIE-A", "TIE-B"]);
  for (const sort of ["match", "temperature", "strength", "density", "name"]) {
    assert.deepEqual(ids({ category: "NameTie", query: sort === "match" ? "same" : "", sort }),
      ["TIE-A", "TIE-B"], `${sort} must end with material_id ASC.`);
  }

  const categoryFacet = list({ category: "PageB" }).facets.categories;
  assert.ok(categoryFacet.all > 48);
  assert.equal(categoryFacet.options.find((option) => option.value === "PageA").count, 48);
  assert.equal(categoryFacet.options.find((option) => option.value === "PageB").count, 1);
  const overlap = list({ category: "FacetOverlap", performance: "heat-resistant" });
  assert.equal(overlap.total, 1);
  assert.equal(overlap.facets.performance.all, 2,
    "Performance facets must exclude the active performance dimension.");
  assert.equal(overlap.facets.performance.options.find((option) => option.id === "heat-resistant").count, 1);
  assert.equal(overlap.facets.performance.options.find((option) => option.id === "flame-retardant").count, 1);
  assert.equal(overlap.facets.performance.groups.find((group) => group.id === "thermal").count, 1,
    "The group is a union, not 1 + 1.");
  const domainFacet = list({ category: "ZD", domain: "automotive" }).facets.domains;
  assert.equal(domainFacet.all, 8);
  assert.ok(domainFacet.options.find((option) => option.id === "aerospace").count > 0);

  const generatedFixture = list({ category: "GeneratedFixture", sort: "name" });
  assert.equal(generatedFixture.total, 20);
  assert.equal(new Set(generatedFixture.items.map((item) => item.id)).size, 20,
    "Repeated relation values must not multiply materials.");
  assert.equal(list({ category: "GeneratedFixture", query: "repeated" }).total, 1,
    "Repeated tags must not multiply the matching material.");
  assert.equal(list({ category: "GeneratedFixture", domain: "automotive" }).total, 10,
    "Repeated uses must not multiply the matching material.");
  const concatenated = [];
  for (let offset = 0; offset < 20; offset += 3) {
    const page = repository.listMaterials({
      category: "GeneratedFixture", sort: "name", limit: 3, offset
    });
    assert.equal(page.total, 20, "Changing pagination must not change total.");
    concatenated.push(...page.items.map((item) => item.id));
  }
  assert.deepEqual(concatenated, generatedFixture.items.map((item) => item.id));
  assert.deepEqual(ids({ category: "GeneratedFixture", sort: "name" }),
    ids({ category: "GeneratedFixture", sort: "name" }),
    "Identical requests must be deterministic.");
  assert.ok(list({ category: "GeneratedFixture", minTensileMpa: 0 }).total <= 20);
  assert.ok(list({ category: "GeneratedFixture", domain: "automotive" }).total <= 20);
  const beyond = repository.listMaterials({ category: "GeneratedFixture", limit: 3, offset: 100 });
  assert.equal(beyond.total, 20);
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.offset, 100);

  const publicIds = new Set(list().items.map((item) => item.id));
  for (const id of [
    "X-GENERATED", "X-LEGACY", "X-ADMIN", "X-OUT", "X-NO-ID",
    "X-INACTIVE", "X-QUARANTINED"
  ]) {
    assert.ok(!publicIds.has(id), id);
    assert.equal(list({ query: id }).total, 0, `${id} must not appear through q.`);
  }
  assert.equal(list({ category: "Fixtures" }).total, 0);
  assert.ok(!list().facets.categories.options.some((option) => option.value === "Fixtures"),
    "Excluded rows must not contribute to public facets.");
  assert.ok(list({ audit: true }).total > list().total,
    "The existing authenticated audit list remains separate.");
  assert.equal(repository.getMetrics().propertyEvidenceRowsRead, 0);
  assert.equal(repository.getMetrics().fullEvidenceTableReads, 0);
  assert.ok(repository.getMetrics().maximumRowsInSingleQuery <= 200);
}

function queryPlanChecks(repository) {
  const predicate = buildPublicCatalogPredicate({
    query: "transparent impact", category: "Search", domain: "automotive"
  });
  const rows = repository.database.prepare(
    "EXPLAIN QUERY PLAN SELECT m.material_id FROM materials m " +
    "LEFT JOIN real_material_identities identity_row " +
    "ON identity_row.material_id = m.material_id AND identity_row.active = 1 " +
    `WHERE ${predicate.sql} ORDER BY LOWER(m.name), m.material_id LIMIT ? OFFSET ?`
  ).all(...predicate.params, 48, 0);
  assert.ok(rows.length > 0);
  assert.ok(!rows.some((row) => /SCAN (?:material_tags|material_uses|material_property_evidence)\b/i.test(row.detail)),
    "Representative plan must not add unrestricted relation/evidence scans.");
}

async function httpChecks(server) {
  const get = (suffix, headers = {}) => request(server, "/api/materials" + suffix, headers);
  const baseline = await get("");
  assert.equal(baseline.status, 200);
  assert.equal(baseline.json.limit, 48);
  assert.equal(baseline.json.items.length, 48);
  assert.equal(Number(baseline.headers.get("x-total-count")), baseline.json.total);
  assert.ok(baseline.json.facets.categories);
  assert.ok(baseline.json.facets.performance);
  assert.ok(baseline.json.facets.domains);
  const inactiveFilters = await get(
    "?category=all&performance=all&domain=all&recyclable=false&sort=name&q="
  );
  assert.equal(inactiveFilters.status, 200);
  assert.equal(inactiveFilters.json.total, baseline.json.total);
  assert.deepEqual(inactiveFilters.json.items.map((item) => item.id),
    baseline.json.items.map((item) => item.id));
  const filtered = await get("?category=PageB&limit=1");
  assert.equal(filtered.status, 200);
  assert.equal(filtered.json.total, 1);
  assert.equal(filtered.json.items[0].id, "PAGE-B");
  assert.equal(Number(filtered.headers.get("x-total-count")), 1);
  const paddedCategory = await get("?category=%20PageB%20&limit=1");
  assert.equal(paddedCategory.status, 200);
  assert.equal(paddedCategory.json.total, 1);
  assert.equal(paddedCategory.json.items[0].id, "PAGE-B-PADDED",
    "A valid category must retain its exact stored value.");
  assert.equal((await get("?category=missing")).json.total, 0);
  assert.deepEqual((await get("?category=Search&q=transparent%20impact")).json.items.map(
    (item) => item.id), ["S-BROAD"]);
  assert.deepEqual((await get("?category=Search&q=TRANSPARENT%20IMPACT")).json.items.map(
    (item) => item.id), ["S-BROAD"]);
  assert.deepEqual((await get("?category=Search&q=%25")).json.items.map(
    (item) => item.id), ["S-LITERAL"]);
  assert.equal((await get("?category=Numeric&minTempC=100")).json.total, 1);
  const numericResponse = await get("?category=Numeric&sort=temperature&limit=10");
  assert.equal(numericResponse.status, 200);
  const compactById = new Map(numericResponse.json.items.map((item) => [item.id, item]));
  assert.equal(compactById.get("N-HIGH").continuous_use_temperature, 200);
  assert.equal(compactById.get("N-LOW").continuous_use_temperature, 50);
  assert.equal(compactById.get("N-MISSING").continuous_use_temperature, null);
  assert.equal(compactById.get("N-HIGH").maxTemp, 220,
    "The existing maximum-temperature alias remains distinct.");
  assert.equal(compactById.get("N-MISSING").maxTemp, 180);
  assert.deepEqual(numericResponse.json.items.map((item) => item.id),
    ["N-HIGH", "N-LOW", "N-MISSING", "N-UNKNOWN"],
    "Temperature sorting still uses continuous-use values.");
  assert.deepEqual((await get("?category=Numeric&minTempC=100")).json.items.map(
    (item) => item.id), ["N-HIGH"],
    "Filtering must reject missing continuous-use values despite a known maximum.");
  assert.equal((await get("?category=Numeric&minTensileMpa=0")).json.total, 2);
  assert.equal((await get("?category=Recycle&recyclable=true")).json.total, 2);
  const effectiveGradeResponse = await get("?category=ZG&performance=heat-resistant");
  assert.equal(effectiveGradeResponse.status, 200);
  assert.deepEqual(effectiveGradeResponse.json.items.map((item) => item.id),
    ["G-EFFECTIVE", "G-EMPTY", "G-FALLBACK", "G-SPACES", "G-TABNEWLINE"]);
  assert.equal(effectiveGradeResponse.json.total, 5);
  assert.equal(effectiveGradeResponse.json.facets.performance.all, 7);
  assert.equal(effectiveGradeResponse.json.facets.performance.options.find(
    (option) => option.id === "heat-resistant").count, 5);
  for (const item of effectiveGradeResponse.json.items.filter((row) => row.id !== "G-EFFECTIVE")) {
    assert.equal(item.grade_name, "heat resistant trade", item.id);
    assert.equal(item.trade_name, "heat resistant trade", item.id);
  }
  const effectiveGradeHttpPage = await get(
    "?category=ZG&performance=heat-resistant&limit=2&offset=2");
  assert.equal(effectiveGradeHttpPage.status, 200);
  assert.equal(effectiveGradeHttpPage.json.total, 5);
  assert.deepEqual(effectiveGradeHttpPage.json.items.map((item) => item.id),
    ["G-FALLBACK", "G-SPACES"]);
  const tagSignal = await get("?category=ZPS&performance=heat-resistant");
  assert.equal(tagSignal.status, 200);
  assert.deepEqual(tagSignal.json.items.map((item) => item.id).sort(),
    ["PS-CROSS", "PS-TAG-ADJ", "PS-TAG-REPEAT"]);
  assert.equal(tagSignal.json.total, 3);
  assert.equal(tagSignal.json.facets.performance.options.find(
    (option) => option.id === "heat-resistant").count, 3);
  const methodSignal = await get("?category=ZPM&performance=chemical-resistant");
  assert.equal(methodSignal.status, 200);
  assert.deepEqual(methodSignal.json.items.map((item) => item.id), ["PS-METHOD-ADJ"]);
  const domainSignal = await get("?category=ZDU&domain=consumer-electronics");
  assert.equal(domainSignal.status, 200);
  assert.deepEqual(domainSignal.json.items.map((item) => item.id).sort(),
    ["DU-ADJ", "DU-CROSS", "DU-REPEAT"]);
  assert.equal(domainSignal.json.total, 3);
  assert.equal(domainSignal.json.facets.domains.options.find(
    (option) => option.id === "consumer-electronics").count, 3);
  for (const { id, category } of WHITESPACE_CASES) {
    const suffix = `?category=${category}&q=heat%20resistant`;
    const ranked = await get(`${suffix}&sort=match`);
    const named = await get(`${suffix}&sort=name`);
    assert.equal(ranked.status, 200);
    assert.deepEqual(ranked.json.items.map((item) => item.id),
      [`WS-${id}-PHRASE`, `WS-${id}-GAP`]);
    assert.equal(ranked.json.total, named.json.total);
  }
  assert.deepEqual((await get("?category=Search&q=pc")).json.items.map(
    (item) => item.id), ["S-EXACT", "S-TOKEN"]);
  assert.deepEqual((await get("?category=ZT&q=heat%20resistant&sort=match")).json.items.map(
    (item) => item.id), ["PH-TAG-ADJ", "PH-TAG-GAP"]);
  for (const [alias, canonical] of Object.entries(FROZEN_PERFORMANCE_ALIASES)) {
    const response = await get(`?category=ZP&performance=${encodeURIComponent(alias)}`);
    assert.equal(response.status, 200, alias);
    assert.ok(response.json.items.some((item) => item.id === `P-${canonical}`), alias);
  }
  assert.equal((await get("?category=ZD&domain=automotive")).status, 200);
  assert.equal((await get("?view=compact&unknown=ignored&limit=1")).status, 200);

  const invalidCases = [
    ["?limit=1.5", "limit"], ["?limit=0", "limit"], ["?limit=201", "limit"],
    ["?limit=", "limit"], ["?limit=0x10", "limit"], ["?limit=1&limit=2", "limit"],
    ["?offset=-1", "offset"], ["?offset=0.5", "offset"],
    ["?offset=9007199254740792", "offset"], ["?offset=1e2", "offset"],
    ["?minTempC=NaN", "minTempC"], ["?minTempC=1e2", "minTempC"],
    ["?minTempC=261", "minTempC"], ["?minTensileMpa=Infinity", "minTensileMpa"],
    ["?minTensileMpa=-1", "minTensileMpa"], ["?performance=unknown", "performance"],
    ["?domain=unknown", "domain"], ["?sort=unknown", "sort"],
    ["?recyclable=1", "recyclable"], ["?category=", "category"],
    ["?category=%20%20", "category"],
    ["?category=%09PageB", "category"], ["?category=%0APageB", "category"],
    ["?category=PageB%09", "category"], ["?category=PageB%0A", "category"],
    ["?category=Pa%09geB", "category"], ["?category=Pa%0AgeB", "category"],
    ["?q=one&\u0071=two", "q"], ["?q=" + "a".repeat(257), "q"],
    ["?q=" + Array.from({ length: 17 }, (_, index) => `word${index}`).join("%20"), "q"],
    ["?q=%00", "q"]
  ];
  for (const [suffix, parameter] of invalidCases) {
    const response = await get(suffix);
    assert.equal(response.status, 400, suffix);
    assert.deepEqual(response.json, {
      error: "Invalid catalog query parameter", parameter
    }, suffix);
  }

  const beyond = await get("?category=PageB&limit=1&offset=100");
  assert.equal(beyond.status, 200);
  assert.equal(beyond.json.total, 1);
  assert.deepEqual(beyond.json.items, []);
  assert.equal(beyond.json.hasMore, false);
  assert.equal(beyond.json.offset, 100);
  assert.equal((await get("?audit=1")).status, 401);
  const audit = await get("?audit=1&category=PageB", {
    authorization: "Bearer " + fakeAdminToken
  });
  assert.equal(audit.status, 200);
  assert.ok(audit.json.total > baseline.json.total,
    "Admin audit behavior must remain independent of public filters.");
  const recommendationCandidates = await request(server, "/api/recommendation-candidates");
  assert.equal(recommendationCandidates.status, 200);
  assert.equal(recommendationCandidates.json.complete, true);
  assert.equal(recommendationCandidates.json.bounded, false);
  assert.equal(recommendationCandidates.json.total, recommendationCandidates.json.items.length);
  assert.equal(recommendationCandidates.json.eligibleTotal,
    recommendationCandidates.json.items.filter((item) => item.data_quality.recommendation_eligible).length);
  assert.equal(recommendationCandidates.json.referenceTotal,
    recommendationCandidates.json.items.filter((item) => item.data_quality.reference_only).length);
}

function frontendCardChecks() {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const sliceFunction = (name, nextName) => {
    const start = app.indexOf(`function ${name}(`);
    const end = app.indexOf(`\nfunction ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, `${name} must remain testable.`);
    return app.slice(start, end);
  };
  const cards = [];
  const context = {
    state: { language: "zh", recommendations: [], selected: new Set() },
    elements: { materialsGrid: { replaceChildren() {} } },
    document: {
      createDocumentFragment: () => ({ append(node) { if (node.tag === "article") cards.push(node); } }),
      createElement: (tag) => ({ tag, innerHTML: "", querySelector: () => ({ addEventListener() {} }) })
    },
    t: (key) => key === "none" ? "Unknown" : key === "continuousUse" ? "Continuous use" : key,
    materialCategory: (item) => item.category,
    materialName: (item) => item.name,
    materialUses: () => [],
    materialTags: () => [],
    dataQualityMeta: () => ({ tone: "high", label: "Verified" }),
    showDetail() {}, toggleCompare() {}
  };
  const source = [
    // Use the same escaping dependencies as the real browser renderer.
    sliceFunction("escapeHtml", "parseExternalSourceUrl"),
    sliceFunction("escapeAttribute", "getSearchText"),
    sliceFunction("formatValue", "escapeHtml"),
    sliceFunction("materialSummary", "localizeRecommendationReason"),
    sliceFunction("formatQualityCheckedValue", "getRecommendationForMaterial"),
    sliceFunction("renderCards", "resetMaterialsPage")
  ].join("\n");
  const renderCards = vm.runInNewContext(`${source}\nrenderCards`, context);
  const specialId = "N-HIGH '\"<&>`";
  renderCards([
    { id: specialId, name: "N High", category: "Numeric", maxTemp: 220,
      continuous_use_temperature: 200, tags: [], data_quality: { level: "high" } },
    { id: "N-MISSING", name: "N Missing", category: "Numeric", maxTemp: 180,
      continuous_use_temperature: null, tags: [], data_quality: { level: "high" } }
  ]);
  assert.equal(cards.length, 2);
  assert.equal((cards[0].innerHTML.match(/data-id="N-HIGH &#039;&quot;&lt;&amp;&gt;&#096;"/g) || []).length, 2,
    "Detail and compare IDs must use the real attribute escaping contract");
  assert.ok(cards[0].innerHTML.includes("<span>Continuous use</span><strong>200 deg C</strong>"));
  assert.ok(!cards[0].innerHTML.includes("<strong>220 deg C</strong>"));
  assert.ok(cards[0].innerHTML.includes("200 deg C"));
  assert.ok(!cards[0].innerHTML.includes("220 deg C"));
  assert.ok(cards[1].innerHTML.includes("<span>Continuous use</span><strong>Unknown</strong>"));
  assert.ok(!cards[1].innerHTML.includes("180 deg C"));
}

async function withServer(databasePath, callback) {
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: "test", PORT: String(port),
    MATFINDER_DB_PATH: databasePath, MATFINDER_ADMIN_TOKEN: fakeAdminToken,
    MATFINDER_TRUST_PROXY: ""
  };
  delete env.OPENAI_API_KEY;
  const child = spawn(process.execPath, [__filename, "--probe-server"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (stdout.includes('"phase":"after_http_listen"') || child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(child.exitCode, null, "Test server startup failed: " + stderr);
    assert.ok(stdout.includes('"phase":"after_http_listen"'), "Test server did not listen.");
    await callback({ port, child });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function request(server, requestPath, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${server.port}${requestPath}`, { headers });
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch {}
  return { status: response.status, headers: response.headers, json };
}
