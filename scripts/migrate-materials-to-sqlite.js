const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.join(__dirname, "..");
const databasePath = path.join(rootDir, "matfinder.db");
const sourcePath = path.join(rootDir, "data", "materials.js");
const writerPath = path.join(__dirname, "write-materials-sqlite.py");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });

const additionalMaterials = require("./additional-materials");
const matwebStyleExpansion = require("./matweb-style-expansion");
const generatedMaterialExpansion = require("./generated-material-expansion");
const materials = enrichMaterials(dedupeMaterials([
  ...sandbox.window.MatFinderData.materials,
  ...additionalMaterials,
  ...matwebStyleExpansion,
  ...generatedMaterialExpansion
]));
const result = spawnSync(findPython(), [writerPath, databasePath], {
  cwd: rootDir,
  input: JSON.stringify(materials),
  encoding: "utf8"
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

process.stdout.write(result.stdout);

function findPython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
    "python",
    "py"
  ].filter(Boolean);

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status === 0) return candidate;
  }

  throw new Error("Python runtime with sqlite3 is required to create matfinder.db.");
}

function dedupeMaterials(items) {
  const seenIds = new Set();
  const seenNames = new Set();
  return items.filter((item) => {
    const id = item.material_id || item.id;
    const name = normalizeName(item.name);
    if (seenIds.has(id) || seenNames.has(name)) {
      return false;
    }
    seenIds.add(id);
    seenNames.add(name);
    return true;
  });
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function enrichMaterials(items) {
  return items.map((item) => {
    const profile = estimateProfile(item);
    const tags = listValue(item.tags);
    const uses = listValue(item.typical_applications, item.uses);
    const processing = listValue(item.processing_methods);
    const summary = item.summary || `${item.name} is a ${item.category} material used for ${uses.slice(0, 2).join(" and ") || "engineering applications"}.`;

    return {
      ...item,
      abbr: item.abbr || item.abbreviation || profile.abbr,
      abbreviation: item.abbreviation || item.abbr || profile.abbr,
      density: numericValue(item.density, profile.density),
      tensile: numericValue(item.tensile, numericValue(item.tensile_strength, profile.tensile)),
      tensile_strength: numericValue(item.tensile_strength, numericValue(item.tensile, profile.tensile)),
      flexural_strength: numericValue(item.flexural_strength, profile.flexural),
      impact_strength: item.impact_strength || profile.impact,
      hardness: item.hardness || profile.hardness,
      elongation: numericValue(item.elongation, profile.elongation),
      tg: numericValue(item.tg, numericValue(item.glass_transition_temperature, profile.tg)),
      glass_transition_temperature: numericValue(item.glass_transition_temperature, numericValue(item.tg, profile.tg)),
      tm: numericValue(item.tm, numericValue(item.melting_temperature, profile.tm)),
      melting_temperature: numericValue(item.melting_temperature, numericValue(item.tm, profile.tm)),
      maxTemp: numericValue(item.maxTemp, numericValue(item.continuous_use_temperature, profile.maxTemp)),
      continuous_use_temperature: numericValue(item.continuous_use_temperature, numericValue(item.maxTemp, profile.maxTemp)),
      thermal_conductivity: numericValue(item.thermal_conductivity, profile.thermal),
      dielectric: numericValue(item.dielectric, numericValue(item.dielectric_constant, profile.dielectric)),
      dielectric_constant: numericValue(item.dielectric_constant, numericValue(item.dielectric, profile.dielectric)),
      chemical_resistance: item.chemical_resistance || profile.chemical,
      water_absorption: numericValue(item.water_absorption, profile.waterAbsorption),
      flammability: item.flammability || profile.flammability,
      recyclability: item.recyclability || profile.recyclability,
      recyclable: item.recyclable ?? profile.recyclable,
      cost_level: item.cost_level || profile.cost,
      processing_methods: processing.length ? processing : profile.processing,
      typical_applications: uses.length ? uses : profile.uses,
      uses: uses.length ? uses : profile.uses,
      advantages: listValue(item.advantages).length ? listValue(item.advantages) : profile.advantages,
      disadvantages: listValue(item.disadvantages).length ? listValue(item.disadvantages) : profile.disadvantages,
      tags: tags.length ? tags : profile.tags,
      summary,
      notes: item.notes || profile.notes
    };
  });
}

function estimateProfile(item) {
  const category = String(item.category || "").toLowerCase();
  const text = [
    item.name,
    item.abbr,
    item.abbreviation,
    item.category,
    item.family,
    item.summary,
    ...(item.tags || []),
    ...(item.uses || []),
    ...(item.typical_applications || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const profiles = [
    {
      match: /metal|steel|aluminum|aluminium|titanium|copper|bronze|brass|nickel|magnesium|zinc/,
      values: profile("solid", 7.8, 450, 650, 15, null, 1450, 400, 45, null, 0, "environment dependent", "not classified", "commonly recyclable", true, "medium", ["machining", "forming", "welding"], ["structural parts", "machined components"], ["high strength", "recyclable", "结构件"], "B90")
    },
    {
      match: /ceramic|alumina|zirconia|silicon carbide|nitride|porcelain|glass/,
      values: profile("solid", 3.2, 220, 320, 1, null, 1700, 1000, 15, 7.5, 0.02, "good to excellent", "noncombustible", "not typically recyclable", false, "high", ["sintering", "pressing", "grinding"], ["insulators", "wear parts"], ["heat resistant", "electrical insulation", "耐热"], "Mohs 8")
    },
    {
      match: /composite|fiber|fibre|laminate|frp|cfrp|gfrp/,
      values: profile("solid", 1.65, 350, 520, 2, 120, null, 150, 0.45, 4.5, 0.3, "matrix dependent", "grade dependent", "specialty stream", false, "medium", ["lamination", "compression molding"], ["lightweight structures", "panels"], ["lightweight", "high strength", "轻量"], "D80")
    },
    {
      match: /foam|cellular|sponge/,
      values: profile("cellular solid", 0.08, 1.2, 2, 20, null, null, 90, 0.04, 2.5, 1.2, "grade dependent", "grade dependent", "not typically recyclable", false, "low", ["foaming", "molding", "cutting"], ["thermal insulation", "cushioning"], ["lightweight", "thermal management", "泡沫"], "Shore OO")
    },
    {
      match: /adhesive|glue|epoxy adhesive|acrylic adhesive|bond/,
      values: profile("liquid or paste before cure, solid after cure", 1.15, 22, 35, 8, 80, null, 120, 0.25, 4, 0.4, "grade dependent", "grade dependent", "not typically recyclable", false, "medium", ["dispensing", "curing"], ["structural bonding", "assembly"], ["adhesive", "bonding", "粘接"], "D75")
    },
    {
      match: /sealant|caulk|gasket seal/,
      values: profile("liquid or paste before cure, solid after cure", 1.2, 4, 6, 300, -45, null, 120, 0.22, 4, 0.35, "grade dependent", "grade dependent", "not typically recyclable", false, "medium", ["dispensing", "curing"], ["sealing joints", "waterproofing"], ["sealant", "waterproof", "密封"], "35 Shore A")
    },
    {
      match: /coating|paint|powder coat|plating/,
      values: profile("liquid or powder before cure, solid film after cure", 1.35, 20, 30, 30, 60, null, 150, 0.3, 4, 0.2, "grade dependent", "grade dependent", "not typically recyclable", false, "medium", ["spraying", "curing"], ["surface protection", "corrosion protection"], ["coating", "weather resistant", "涂层"], "D70")
    },
    {
      match: /rubber|elastomer|silicone|epdm|nitrile|fkm|tpu|tpv/,
      values: profile("flexible solid", 1.1, 12, 20, 450, -45, null, 130, 0.2, 4.5, 0.6, "grade dependent", "grade dependent", "specialty stream", false, "medium", ["compression molding", "injection molding", "extrusion"], ["seals", "gaskets"], ["flexible", "sealant", "柔性"], "60 Shore A")
    },
    {
      match: /peek|pps|pei|polyimide|pbi|pai|lcp|high-performance|sulfone/,
      values: profile("solid", 1.35, 95, 140, 25, 180, 330, 220, 0.28, 3.4, 0.25, "good to excellent", "grade dependent", "grade dependent", true, "high", ["injection molding", "machining"], ["high-temperature components", "electrical parts"], ["heat resistant", "high strength", "electrical insulation"], "D85")
    },
    {
      match: /plastic|poly|thermoplastic|resin|nylon|abs|pc|pet|pbt|pp|pe/,
      values: profile("solid", 1.2, 55, 80, 80, 75, 220, 120, 0.24, 3.0, 0.35, "grade dependent", "grade dependent", "grade dependent", true, "medium", ["injection molding", "extrusion"], ["molded parts", "housings"], ["easy processing", "lightweight", "工程塑料"], "D75")
    }
  ];

  const selected = profiles.find((candidate) => candidate.match.test(text) || candidate.match.test(category))?.values || profile(
    "solid",
    1.4,
    45,
    65,
    30,
    80,
    null,
    120,
    0.3,
    3.5,
    0.5,
    "grade dependent",
    "grade dependent",
    "grade dependent",
    false,
    "medium",
    ["forming", "machining"],
    ["engineering applications", "industrial parts"],
    ["general purpose", "engineering material"],
    "grade dependent"
  );

  if (/transparent|optical|clear|透明|光学/.test(text)) selected.tags = [...new Set([...selected.tags, "transparent", "optical", "透明"])];
  if (/flame|fire|阻燃|防火/.test(text)) selected.tags = [...new Set([...selected.tags, "flame retardant", "阻燃"])];
  if (/chemical|corrosion|耐化学|耐腐蚀/.test(text)) selected.tags = [...new Set([...selected.tags, "chemical resistant", "耐化学"])];
  if (/electrical|dielectric|insulat|电绝缘|介电/.test(text)) selected.tags = [...new Set([...selected.tags, "electrical insulation", "电绝缘"])];
  if (/water|moisture|seal|防水|密封/.test(text)) selected.tags = [...new Set([...selected.tags, "waterproof", "low moisture", "防水"])];
  if (/medical|biocompat|医疗/.test(text)) selected.uses = [...new Set([...selected.uses, "medical devices", "医疗器械"])];
  if (/aerospace|aircraft|航空/.test(text)) selected.uses = [...new Set([...selected.uses, "aerospace components", "航空航天"])];

  selected.abbr = item.abbr || item.abbreviation || abbreviationFromName(item.name);
  selected.notes = item.notes || "Representative properties were estimated from material category and keyword context during MatFinder database expansion.";
  return selected;
}

function profile(state, density, tensile, flexural, elongation, tg, tm, maxTemp, thermal, dielectric, waterAbsorption, chemical, flammability, recyclability, recyclable, cost, processing, uses, tags, hardness) {
  return {
    state,
    density,
    tensile,
    flexural,
    elongation,
    tg,
    tm,
    maxTemp,
    thermal,
    dielectric,
    waterAbsorption,
    chemical,
    flammability,
    recyclability,
    recyclable,
    cost,
    processing,
    uses,
    tags,
    hardness,
    impact: "grade dependent",
    advantages: [`Representative ${state} material profile for screening and search.`],
    disadvantages: ["Estimated values require validation against grade-specific datasheets."]
  };
}

function numericValue(value, fallback) {
  return value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? fallback : value;
}

function listValue(primary, fallback = []) {
  const value = primary === undefined || primary === null ? fallback : primary;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function abbreviationFromName(name) {
  return String(name || "MAT")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 8)
    .toUpperCase() || "MAT";
}
