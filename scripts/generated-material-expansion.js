const source = {
  source_title: "MatFinder generated engineering catalog expansion",
  source_url: "local:scripts/generated-material-expansion.js",
  source_type: "generated_reference_catalog",
  notes:
    "Representative engineering-property estimates generated from material family ranges for search, recommendation, and early screening. Verify grade-specific datasheets before final design."
};

const sharedNote =
  "Generated representative screening record. Values are realistic family-level estimates, not design allowables; exact properties depend on grade, filler, process, heat treatment, cure, porosity, and test method.";

const zhTags = {
  heat: ["heat resistant", "耐热", "高温"],
  chemical: ["chemical resistant", "耐化学", "耐腐蚀"],
  electrical: ["electrical insulation", "电绝缘", "介电"],
  lightweight: ["lightweight", "轻量", "低密度"],
  transparent: ["transparent", "透明", "光学"],
  impact: ["impact resistant", "抗冲击", "韧性"],
  flexible: ["flexible", "柔性", "弹性"],
  weather: ["weather resistant", "耐候", "抗紫外"],
  flame: ["flame retardant", "阻燃", "防火"],
  waterproof: ["waterproof", "防水", "低吸水"],
  wear: ["wear resistant", "耐磨", "低摩擦"],
  strength: ["high strength", "高强度", "承载"],
  conductive: ["conductive", "导电", "电磁屏蔽"],
  bonding: ["adhesive", "粘接", "结构胶"],
  sealing: ["sealant", "密封", "防渗"],
  coating: ["coating", "涂层", "表面保护"],
  thermal: ["thermal management", "导热", "散热"]
};

const zhUses = {
  electronics: ["electronic housings", "electronics", "电子外壳"],
  automotive: ["automotive components", "automotive", "汽车部件"],
  aerospace: ["aerospace components", "aerospace", "航空航天"],
  medical: ["medical devices", "medical", "医疗器械"],
  chemical: ["chemical equipment", "chemical service", "化工设备"],
  seals: ["seals", "gaskets", "密封件"],
  electrical: ["connectors", "electrical parts", "电气部件"],
  structural: ["structural parts", "load-bearing parts", "结构件"],
  thermal: ["thermal insulation", "heat shields", "隔热件"],
  packaging: ["packaging", "containers", "包装容器"],
  marine: ["marine parts", "offshore equipment", "海工部件"],
  tooling: ["tooling", "fixtures", "工装夹具"]
};

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function materialState(category, tags = []) {
  const text = `${category} ${tags.join(" ")}`.toLowerCase();
  if (text.includes("adhesive") || text.includes("sealant") || text.includes("coating")) return "liquid or paste before cure, solid after cure";
  if (text.includes("foam")) return "cellular solid";
  if (text.includes("elastomer") || text.includes("rubber")) return "flexible solid";
  if (text.includes("metal") || text.includes("ceramic") || text.includes("composite")) return "solid";
  return "solid";
}

function makeEntry(base, variant, categoryOverride = null) {
  const category = categoryOverride || base.category;
  const name = `${base.name} ${variant.label}`;
  const abbr = `${base.abbr}-${variant.code}`;
  const tags = uniq([...(base.tags || []), ...(variant.tags || [])]);
  const uses = uniq([...(base.uses || []), ...(variant.uses || [])]).slice(0, 8);
  const density = round((base.density + (variant.densityAdd || 0)) * (variant.densityMult || 1), 2);
  const tensile = round(base.tensile * (variant.tensileMult || 1) + (variant.tensileAdd || 0), 1);
  const flexural = round((base.flexural || base.tensile * 1.45) * (variant.flexuralMult || variant.tensileMult || 1), 1);
  const elongation = round(clamp(base.elongation * (variant.elongationMult || 1), 1, 900), 1);
  const maxTemp = round(base.maxTemp + (variant.tempAdd || 0), 0);
  const dielectric = round(base.dielectric === null ? null : base.dielectric + (variant.dielectricAdd || 0), 2);
  const state = variant.state || materialState(category, tags);
  const features = tags.slice(0, 10);
  const applications = uses.slice(0, 8);
  const description = `${name} is a ${category.toLowerCase()} screening material with ${features.slice(0, 3).join(", ")} characteristics for ${applications.slice(0, 2).join(" and ")}.`;

  return {
    id: `gen-${slug(category)}-${slug(name)}`,
    material_id: `gen-${slug(category)}-${slug(name)}`,
    name,
    abbr,
    abbreviation: abbr,
    category,
    family: base.family || category,
    manufacturer: null,
    trade_name: null,
    state,
    density,
    tensile_strength: tensile,
    tensile,
    flexural_strength: flexural,
    impact_strength: variant.impact || base.impact || null,
    hardness: variant.hardness || base.hardness || null,
    elongation,
    glass_transition_temperature: base.tg,
    tg: base.tg,
    melting_temperature: base.tm,
    tm: base.tm,
    continuous_use_temperature: maxTemp,
    maxTemp,
    max_temperature: maxTemp,
    thermal_conductivity: round((base.thermal || 0.22) * (variant.thermalMult || 1), 2),
    dielectric_constant: dielectric,
    dielectric,
    chemical_resistance: variant.chemical || base.chemical || "grade dependent",
    water_absorption: round(clamp((base.waterAbsorption ?? 0.4) * (variant.waterMult || 1), 0.01, 8), 2),
    flammability: variant.flammability || base.flammability || "grade dependent",
    recyclability: variant.recyclability || base.recyclability || "grade dependent",
    recyclable: Boolean(variant.recyclable ?? base.recyclable ?? false),
    cost_level: variant.cost || base.cost || "medium",
    processing_methods: uniq([...(base.processing || []), ...(variant.processing || [])]),
    typical_applications: applications,
    applications,
    features,
    advantages: [
      `Representative ${category.toLowerCase()} option for ${applications[0] || "engineering use"}.`,
      `Feature coverage includes ${features.slice(0, 3).join(", ")}.`
    ],
    disadvantages: [
      "Representative values require grade-specific validation.",
      "Processing, reinforcement, additives, and environment can materially change performance."
    ],
    tags,
    uses: applications,
    summary: description,
    description,
    notes: sharedNote,
    sources: [source]
  };
}

const polymerVariants = [
  { label: "unfilled molding grade", code: "UF", tags: ["general purpose", "注塑"], processing: ["injection molding", "extrusion"], tensileMult: 1, elongationMult: 1 },
  { label: "glass fiber 10% reinforced grade", code: "GF10", tags: [...zhTags.strength, "glass fiber reinforced", "玻纤增强"], tensileMult: 1.45, flexuralMult: 1.6, densityAdd: 0.08, elongationMult: 0.45, tempAdd: 5 },
  { label: "glass fiber 20% reinforced grade", code: "GF20", tags: [...zhTags.strength, "glass fiber reinforced", "玻纤增强"], tensileMult: 1.85, flexuralMult: 2.1, densityAdd: 0.16, elongationMult: 0.28, tempAdd: 10 },
  { label: "glass fiber 30% reinforced grade", code: "GF30", tags: [...zhTags.strength, "glass fiber reinforced", "玻纤增强"], tensileMult: 2.25, flexuralMult: 2.6, densityAdd: 0.24, elongationMult: 0.18, tempAdd: 15 },
  { label: "carbon fiber 20% reinforced grade", code: "CF20", tags: [...zhTags.strength, ...zhTags.conductive, "carbon fiber reinforced", "碳纤增强"], tensileMult: 2.05, flexuralMult: 2.35, densityAdd: 0.12, elongationMult: 0.2, thermalMult: 1.8, tempAdd: 15 },
  { label: "mineral filled dimensional-stability grade", code: "MF", tags: ["dimensional stability", "mineral filled", "尺寸稳定"], tensileMult: 1.25, flexuralMult: 1.55, densityAdd: 0.22, elongationMult: 0.35, tempAdd: 8 },
  { label: "flame retardant electrical grade", code: "FR", tags: [...zhTags.flame, ...zhTags.electrical], uses: [...zhUses.electrical], flammability: "flame retardant grade dependent", dielectricAdd: 0.15, tempAdd: 5 },
  { label: "impact modified tough grade", code: "IM", tags: [...zhTags.impact, "toughened", "增韧"], tensileMult: 0.9, elongationMult: 1.8, impact: "improved impact, grade dependent" },
  { label: "UV stabilized outdoor grade", code: "UV", tags: [...zhTags.weather, "UV stabilized"], uses: [...zhUses.automotive], tempAdd: 3 },
  { label: "conductive antistatic grade", code: "ESD", tags: [...zhTags.conductive, "antistatic", "防静电"], uses: [...zhUses.electronics], tensileMult: 1.05, densityAdd: 0.05, dielectricAdd: 1.8, recyclability: "specialty stream" }
];

const polymerBases = [
  ["Polycarbonate", "PC", "Engineering plastic", 1.2, 147, null, 125, 65, 110, 3.0, [...zhTags.transparent, ...zhTags.impact, ...zhTags.heat], [...zhUses.electronics, ...zhUses.medical], "good"],
  ["Polybutylene terephthalate", "PBT", "Engineering plastic", 1.31, 50, 225, 130, 58, 80, 3.2, [...zhTags.electrical, "dimensional stability"], [...zhUses.electrical, ...zhUses.automotive], "good"],
  ["Polyamide 6", "PA6", "Engineering plastic", 1.14, 50, 220, 120, 75, 90, 3.8, [...zhTags.strength, ...zhTags.wear], [...zhUses.automotive, ...zhUses.structural], "moderate"],
  ["Polyamide 66", "PA66", "Engineering plastic", 1.14, 55, 260, 140, 82, 70, 3.9, [...zhTags.strength, ...zhTags.wear, ...zhTags.heat], [...zhUses.automotive, ...zhUses.electrical], "moderate"],
  ["Polyoxymethylene", "POM", "Engineering plastic", 1.41, -60, 175, 105, 70, 40, 3.7, [...zhTags.wear, "low friction", "尺寸稳定"], ["gears", "bearings", "precision parts", "齿轮"], "good"],
  ["Polyphenylene sulfide", "PPS", "High-performance plastic", 1.35, 90, 285, 220, 80, 3, 3.2, [...zhTags.heat, ...zhTags.chemical, ...zhTags.flame], [...zhUses.chemical, ...zhUses.electrical], "excellent"],
  ["Polyether ether ketone", "PEEK", "High-performance plastic", 1.3, 143, 343, 250, 100, 35, 3.3, [...zhTags.heat, ...zhTags.chemical, ...zhTags.strength], [...zhUses.aerospace, ...zhUses.medical], "excellent"],
  ["Polyetherimide", "PEI", "High-performance plastic", 1.27, 217, null, 170, 105, 60, 3.15, [...zhTags.heat, ...zhTags.flame, ...zhTags.electrical], [...zhUses.aerospace, ...zhUses.medical], "good"],
  ["Polysulfone", "PSU", "High-performance plastic", 1.24, 185, null, 160, 75, 50, 3.1, [...zhTags.heat, "hydrolysis resistant", "透明琥珀"], [...zhUses.medical, "hot water parts", "热水部件"], "good"],
  ["Polyphenylsulfone", "PPSU", "High-performance plastic", 1.29, 220, null, 180, 75, 70, 3.4, [...zhTags.heat, ...zhTags.impact, "hydrolysis resistant"], [...zhUses.medical, "sterilizable trays", "可灭菌托盘"], "good"],
  ["Polyethersulfone", "PESU", "High-performance plastic", 1.37, 225, null, 180, 85, 40, 3.5, [...zhTags.heat, "hydrolysis resistant", "membrane"], ["membranes", "medical trays", "过滤膜"], "good"],
  ["Liquid crystal polymer", "LCP", "High-performance plastic", 1.4, 120, 280, 240, 150, 3, 3.4, [...zhTags.heat, ...zhTags.strength, ...zhTags.electrical], ["fine-pitch connectors", "coil forms", "精密连接器"], "good"],
  ["Polyamide-imide", "PAI", "High-performance plastic", 1.42, 280, null, 250, 150, 8, 4.2, [...zhTags.heat, ...zhTags.wear, ...zhTags.strength], ["bearings", "bushings", "semiconductor fixtures", "轴承"], "excellent"],
  ["Thermoplastic polyimide", "TPI", "High-performance plastic", 1.34, 250, 388, 240, 100, 40, 3.2, [...zhTags.heat, ...zhTags.electrical, ...zhTags.wear], [...zhUses.aerospace, "high-temperature films", "耐高温薄膜"], "excellent"],
  ["Polybenzimidazole", "PBI", "High-performance plastic", 1.3, 425, null, 300, 160, 3, 3.9, [...zhTags.heat, ...zhTags.wear, ...zhTags.chemical], ["hot glass handling", "semiconductor parts", "高温夹具"], "excellent"],
  ["Polyethylene terephthalate", "PET", "Thermoplastics", 1.38, 76, 255, 120, 60, 130, 3.2, [...zhTags.transparent, "barrier", "recyclable"], [...zhUses.packaging, "films", "纤维"], "good"],
  ["Polypropylene", "PP", "Thermoplastics", 0.9, -10, 165, 105, 35, 500, 2.2, [...zhTags.lightweight, ...zhTags.chemical, "food contact"], [...zhUses.packaging, ...zhUses.automotive], "good"],
  ["High-density polyethylene", "HDPE", "Thermoplastics", 0.95, -120, 130, 90, 31, 700, 2.3, [...zhTags.chemical, ...zhTags.waterproof, ...zhTags.lightweight], ["pipes", "chemical tanks", "管道"], "good"],
  ["Acrylonitrile butadiene styrene", "ABS", "Engineering plastic", 1.05, 105, null, 90, 43, 25, 2.8, [...zhTags.impact, "surface finish", "易加工"], [...zhUses.electronics, ...zhUses.automotive], "moderate"],
  ["Acrylonitrile styrene acrylate", "ASA", "Engineering plastic", 1.07, 105, null, 95, 45, 25, 2.8, [...zhTags.weather, ...zhTags.impact], ["outdoor housings", "automotive trim", "户外外壳"], "moderate"],
  ["Polymethyl methacrylate", "PMMA", "Engineering plastic", 1.18, 105, null, 90, 70, 5, 3.2, [...zhTags.transparent, ...zhTags.weather, "surface finish"], ["lenses", "light guides", "光学件"], "moderate"],
  ["Cyclo olefin polymer", "COP", "Engineering plastic", 1.02, 138, null, 125, 60, 30, 2.35, [...zhTags.transparent, ...zhTags.waterproof, "medical"], [...zhUses.medical, "microfluidics", "微流控"], "good"],
  ["Thermoplastic polyurethane", "TPU", "Elastomers", 1.18, -40, 165, 90, 35, 500, 6.0, [...zhTags.flexible, ...zhTags.wear, ...zhTags.impact], [...zhUses.seals, "wheels", "软管"], "moderate"],
  ["Ethylene tetrafluoroethylene", "ETFE", "Fluoropolymer", 1.7, 110, 270, 150, 45, 300, 2.6, [...zhTags.chemical, ...zhTags.weather, ...zhTags.electrical], ["architectural film", "wire coating", "耐候薄膜"], "excellent"],
  ["Perfluoroalkoxy alkane", "PFA", "Fluoropolymer", 2.15, 90, 305, 260, 25, 300, 2.1, [...zhTags.chemical, ...zhTags.heat, ...zhTags.electrical], [...zhUses.chemical, "semiconductor tubing", "半导体管路"], "excellent"]
].map(([name, abbr, category, density, tg, tm, maxTemp, tensile, elongation, dielectric, tags, uses, chemical]) => ({
  name,
  abbr,
  category,
  family: category,
  density,
  tg,
  tm,
  maxTemp,
  tensile,
  elongation,
  dielectric,
  tags,
  uses,
  chemical,
  recyclable: category !== "Fluoropolymer",
  processing: ["injection molding", "extrusion", "注塑", "挤出"],
  waterAbsorption: tags.includes("low moisture") ? 0.08 : 0.4,
  thermal: 0.25,
  cost: category === "High-performance plastic" ? "high" : "medium"
}));

const thermosetBases = [
  ["Epoxy resin", "EP", 1.2, 130, 70, 4, [...zhTags.bonding, ...zhTags.chemical, ...zhTags.electrical], ["structural adhesive", "composite matrix", "电子灌封"]],
  ["Phenolic resin", "PF", 1.35, 180, 55, 2, [...zhTags.heat, ...zhTags.flame, "low smoke"], ["brake components", "electrical laminates", "刹车部件"]],
  ["Melamine formaldehyde", "MF", 1.5, 140, 60, 2, [...zhTags.heat, "hard surface", "耐划伤"], ["laminates", "tableware", "装饰层压板"]],
  ["Urea formaldehyde", "UF", 1.45, 100, 45, 2, ["rigid", "low cost", "低成本"], ["wood adhesives", "molded parts", "木材胶"]],
  ["Unsaturated polyester resin", "UPR", 1.25, 120, 65, 3, [...zhTags.chemical, "composite matrix"], ["FRP panels", "boat hulls", "玻璃钢"]],
  ["Vinyl ester resin", "VE", 1.12, 140, 75, 4, [...zhTags.chemical, ...zhTags.strength], ["chemical tanks", "marine composites", "防腐储罐"]],
  ["Bismaleimide resin", "BMI", 1.28, 230, 95, 2, [...zhTags.heat, ...zhTags.strength, ...zhUses.aerospace], ["aerospace composites", "radomes", "航空复材"]],
  ["Cyanate ester resin", "CE", 1.22, 220, 85, 2, [...zhTags.heat, ...zhTags.electrical, "low dielectric"], ["radomes", "printed circuit boards", "雷达罩"]],
  ["Polyurethane thermoset", "PUR-TS", 1.15, 100, 45, 80, [...zhTags.flexible, ...zhTags.bonding], ["potting compounds", "elastomeric parts", "灌封胶"]],
  ["Silicone thermoset", "SI-TS", 1.1, 180, 7, 250, [...zhTags.flexible, ...zhTags.heat, ...zhTags.electrical], ["encapsulation", "gaskets", "硅胶密封"]]
].map(([name, abbr, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category: "Thermosets",
  family: "Thermosets",
  density,
  tg: maxTemp - 20,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: 3.8,
  tags,
  uses,
  chemical: tags.includes("chemical resistant") ? "good" : "grade dependent",
  recyclable: false,
  processing: ["casting", "compression molding", "curing", "固化"],
  waterAbsorption: 0.5,
  thermal: 0.22,
  cost: maxTemp >= 200 ? "high" : "medium"
}));

const thermosetVariants = [
  { label: "general casting grade", code: "CAST", tags: ["casting", "浇注"], processing: ["casting"], tensileMult: 1 },
  { label: "glass filled molding grade", code: "GF", tags: [...zhTags.strength, "glass filled"], tensileMult: 1.6, flexuralMult: 1.8, densityAdd: 0.18, elongationMult: 0.45, tempAdd: 10 },
  { label: "mineral filled low-shrink grade", code: "LS", tags: ["low shrink", "dimensional stability", "低收缩"], tensileMult: 1.25, densityAdd: 0.25, elongationMult: 0.55 },
  { label: "flame retardant electrical grade", code: "FR", tags: [...zhTags.flame, ...zhTags.electrical], uses: [...zhUses.electrical], tempAdd: 8 },
  { label: "high temperature post-cured grade", code: "HT", tags: [...zhTags.heat], tensileMult: 1.1, tempAdd: 35, cost: "high" },
  { label: "toughened adhesive grade", code: "TA", tags: [...zhTags.impact, ...zhTags.bonding], uses: ["bonded joints", "粘接接头"], tensileMult: 0.95, elongationMult: 2 },
  { label: "low viscosity infusion grade", code: "INF", tags: ["low viscosity", "infusion", "灌注"], uses: ["vacuum infusion", "复材灌注"], tensileMult: 0.92 },
  { label: "thermally conductive potting grade", code: "TC", tags: [...zhTags.thermal, ...zhTags.electrical], uses: ["power electronics potting", "电源灌封"], densityAdd: 0.35, thermalMult: 5, dielectricAdd: 0.5 }
];

const elastomerBases = [
  ["Natural rubber", "NR", "Rubber", 0.93, 70, 25, 650, [...zhTags.flexible, ...zhTags.impact], ["vibration mounts", "tires", "减震件"]],
  ["Styrene butadiene rubber", "SBR", "Rubber", 0.94, 80, 18, 550, [...zhTags.flexible, "abrasion resistant", "耐磨"], ["tires", "shoe soles", "轮胎"]],
  ["Nitrile rubber", "NBR", "Rubber", 1.0, 110, 18, 400, [...zhTags.flexible, "oil resistant", "耐油"], [...zhUses.seals, "fuel hoses", "燃油管"]],
  ["Hydrogenated nitrile rubber", "HNBR", "Rubber", 1.0, 150, 24, 350, [...zhTags.heat, "oil resistant", "耐油"], [...zhUses.seals, ...zhUses.automotive]],
  ["Ethylene propylene diene rubber", "EPDM", "Rubber", 0.86, 150, 12, 500, [...zhTags.weather, ...zhTags.waterproof, ...zhTags.flexible], [...zhUses.seals, "roofing membranes", "屋面防水"]],
  ["Fluoroelastomer", "FKM", "Elastomers", 1.85, 200, 14, 250, [...zhTags.chemical, ...zhTags.heat, "fuel resistant"], [...zhUses.seals, ...zhUses.chemical]],
  ["Perfluoroelastomer", "FFKM", "Elastomers", 1.95, 300, 12, 160, [...zhTags.chemical, ...zhTags.heat], ["semiconductor seals", "chemical seals", "半导体密封"]],
  ["Silicone rubber", "VMQ", "Rubber", 1.12, 200, 9, 450, [...zhTags.heat, ...zhTags.flexible, ...zhTags.electrical], ["medical tubing", "gaskets", "医疗管路"]],
  ["Fluorosilicone rubber", "FVMQ", "Rubber", 1.45, 175, 9, 220, [...zhTags.heat, "fuel resistant", "low temperature"], ["aerospace seals", "fuel system seals", "燃油密封"]],
  ["Chloroprene rubber", "CR", "Rubber", 1.23, 120, 18, 400, [...zhTags.weather, ...zhTags.flame, ...zhTags.flexible], ["hoses", "belts", "胶管"]],
  ["Butyl rubber", "IIR", "Rubber", 0.92, 120, 12, 650, [...zhTags.waterproof, "barrier", "气密"], ["inner tubes", "pharmaceutical stoppers", "气密塞"]],
  ["Thermoplastic vulcanizate", "TPV", "Elastomers", 0.97, 125, 8, 450, [...zhTags.flexible, ...zhTags.weather], ["automotive seals", "grips", "汽车密封条"]],
  ["Thermoplastic elastomer styrenic", "TPS", "Elastomers", 0.93, 80, 6, 700, [...zhTags.flexible, "soft touch", "软触感"], ["grips", "overmolding", "包胶"]],
  ["Polyether block amide", "PEBA", "Elastomers", 1.02, 100, 35, 400, [...zhTags.flexible, ...zhTags.lightweight], ["sports goods", "medical tubing", "运动器材"]]
].map(([name, abbr, category, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category,
  family: category,
  density,
  tg: -45,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: 4.5,
  tags,
  uses,
  chemical: tags.includes("chemical resistant") ? "good to excellent" : "grade dependent",
  recyclable: category === "Elastomers",
  processing: ["compression molding", "extrusion", "injection molding", "模压"],
  waterAbsorption: 0.5,
  thermal: 0.18,
  cost: maxTemp >= 180 ? "high" : "medium"
}));

const elastomerVariants = [
  { label: "standard hardness grade", code: "STD", tags: ["standard hardness", "标准硬度"], hardness: "60 Shore A" },
  { label: "soft 40 Shore A grade", code: "S40", tags: ["soft", "软质"], tensileMult: 0.8, elongationMult: 1.25, hardness: "40 Shore A" },
  { label: "hard 80 Shore A grade", code: "H80", tags: ["hard", "高硬度"], tensileMult: 1.15, elongationMult: 0.65, hardness: "80 Shore A" },
  { label: "fabric reinforced diaphragm grade", code: "FAB", tags: [...zhTags.strength, "fabric reinforced"], uses: ["diaphragms", "隔膜"], tensileMult: 1.5, elongationMult: 0.45 },
  { label: "conductive ESD grade", code: "ESD", tags: [...zhTags.conductive], uses: ["ESD seals", "防静电密封"], densityAdd: 0.08, elongationMult: 0.8, dielectricAdd: 8 },
  { label: "food contact sealing grade", code: "FC", tags: ["food contact", "食品接触", ...zhTags.sealing], uses: ["food seals", "食品密封"], tensileMult: 0.95 },
  { label: "low temperature flexible grade", code: "LT", tags: ["low temperature", "低温柔性"], uses: ["cold-weather seals", "低温密封"], tempAdd: -5, elongationMult: 1.15 },
  { label: "high temperature post-cured grade", code: "HT", tags: [...zhTags.heat], uses: ["high-temperature seals", "高温密封"], tempAdd: 25, elongationMult: 0.85, cost: "high" }
];

const metalBases = [
  ["Aluminum 1050", "Al1050", 2.71, 120, 90, 35, 660, ["lightweight", "conductive", "可回收"], ["heat exchangers", "electrical busbars", "换热器"]],
  ["Aluminum 2024", "Al2024", 2.78, 150, 470, 18, 500, [...zhTags.strength, ...zhTags.lightweight], [...zhUses.aerospace, "airframe parts"]],
  ["Aluminum 5052", "Al5052", 2.68, 150, 230, 12, 607, [...zhTags.lightweight, "marine corrosion resistant", "耐海水"], [...zhUses.marine, "sheet metal"]],
  ["Aluminum 6061", "Al6061", 2.7, 150, 310, 12, 582, [...zhTags.lightweight, "machinable", "可焊"], ["machine frames", "brackets", "机架"]],
  ["Aluminum 7075", "Al7075", 2.81, 120, 570, 11, 477, [...zhTags.strength, ...zhTags.lightweight], [...zhUses.aerospace, "high strength brackets"]],
  ["Magnesium AZ31B", "MgAZ31B", 1.78, 120, 260, 15, 630, [...zhTags.lightweight, "machinable"], ["lightweight housings", "电子壳体"]],
  ["Titanium Grade 2", "TiG2", 4.51, 315, 345, 20, 1668, [...zhTags.chemical, "biocompatible", "生物相容"], [...zhUses.medical, ...zhUses.chemical]],
  ["Titanium Grade 5 Ti-6Al-4V", "Ti64", 4.43, 350, 950, 14, 1604, [...zhTags.strength, ...zhTags.chemical], [...zhUses.aerospace, ...zhUses.medical]],
  ["Stainless steel 304", "SS304", 8.0, 425, 515, 40, 1400, [...zhTags.chemical, "corrosion resistant", "耐腐蚀"], ["food equipment", "chemical vessels", "食品设备"]],
  ["Stainless steel 316L", "SS316L", 8.0, 425, 485, 40, 1375, [...zhTags.chemical, "marine corrosion resistant", "耐氯离子"], [...zhUses.medical, ...zhUses.marine]],
  ["Stainless steel 17-4PH", "SS174", 7.75, 315, 1100, 10, 1400, [...zhTags.strength, "corrosion resistant"], ["shafts", "aerospace fittings", "轴类"]],
  ["Carbon steel A36", "CSA36", 7.85, 400, 400, 20, 1450, [...zhTags.strength, "weldable", "可焊"], ["structural beams", "frames", "钢结构"]],
  ["Alloy steel 4140", "AISI4140", 7.85, 425, 900, 18, 1415, [...zhTags.strength, ...zhTags.wear], ["shafts", "gears", "齿轮轴"]],
  ["Tool steel D2", "D2", 7.7, 450, 1900, 2, 1420, [...zhTags.wear, "high hardness", "高硬度"], ["dies", "cutting tools", "模具"]],
  ["Copper C110", "Cu110", 8.94, 200, 220, 35, 1085, ["conductive", ...zhTags.thermal, "导电"], ["busbars", "heat spreaders", "母排"]],
  ["Brass C360", "Brass360", 8.5, 200, 360, 25, 900, ["machinable", "corrosion resistant", "易切削"], ["fittings", "valves", "接头"]],
  ["Bronze C932", "Bronze932", 8.8, 250, 240, 10, 950, [...zhTags.wear, "bearing alloy", "轴承合金"], ["bushings", "bearings", "轴套"]],
  ["Nickel alloy 625", "In625", 8.44, 650, 930, 30, 1290, [...zhTags.heat, ...zhTags.chemical], [...zhUses.chemical, "turbine parts"]],
  ["Nickel alloy 718", "In718", 8.19, 650, 1240, 12, 1260, [...zhTags.heat, ...zhTags.strength], [...zhUses.aerospace, "turbine disks"]],
  ["Zinc alloy ZA-8", "ZA8", 6.3, 100, 280, 8, 390, ["die casting", "压铸", "surface finish"], ["die cast housings", "五金件"]]
].map(([name, abbr, density, maxTemp, tensile, elongation, tm, tags, uses]) => ({
  name,
  abbr,
  category: "Metals",
  family: "Metals",
  density,
  tg: null,
  tm,
  maxTemp,
  tensile,
  elongation,
  dielectric: null,
  tags,
  uses,
  chemical: tags.includes("chemical resistant") || tags.includes("corrosion resistant") ? "good" : "environment dependent",
  recyclable: true,
  processing: ["machining", "forming", "welding", "机加工"],
  waterAbsorption: 0,
  thermal: density > 8.5 ? 200 : 80,
  cost: name.includes("Nickel") || name.includes("Titanium") ? "high" : "medium"
}));

const metalVariants = [
  { label: "annealed sheet grade", code: "ANN", tags: ["annealed", "板材"], tensileMult: 0.8, elongationMult: 1.6 },
  { label: "cold worked high strength grade", code: "CW", tags: [...zhTags.strength, "cold worked"], tensileMult: 1.25, elongationMult: 0.55 },
  { label: "precision machined bar grade", code: "BAR", tags: ["machinable", "bar stock"], uses: [...zhUses.tooling], tensileMult: 1 },
  { label: "welded fabrication grade", code: "WLD", tags: ["weldable", "焊接"], uses: ["welded frames", "焊接结构"], tensileMult: 0.95 },
  { label: "additive manufacturing powder grade", code: "AM", tags: ["3D printing", "additive manufacturing", "增材制造"], uses: ["3D printed parts", "增材零件"], tensileMult: 1.05, elongationMult: 0.85, cost: "high" },
  { label: "corrosion resistant passivated grade", code: "CR", tags: [...zhTags.chemical, "passivated"], uses: [...zhUses.chemical], tensileMult: 0.98 }
];

const ceramicBases = [
  ["Alumina 96%", "Al2O3-96", 3.75, 1500, 300, 8.8, [...zhTags.heat, ...zhTags.electrical, ...zhTags.wear], ["insulators", "wear plates", "陶瓷绝缘件"]],
  ["Alumina 99.5%", "Al2O3-995", 3.9, 1600, 330, 9.4, [...zhTags.heat, ...zhTags.electrical, ...zhTags.wear], ["semiconductor parts", "laser tubes", "半导体陶瓷"]],
  ["Zirconia Y-TZP", "YTZP", 6.05, 1000, 900, 28, [...zhTags.wear, ...zhTags.strength, "tough ceramic"], ["cutting tools", "dental parts", "齿科陶瓷"]],
  ["Silicon nitride", "Si3N4", 3.25, 1200, 750, 7.8, [...zhTags.heat, ...zhTags.wear, ...zhTags.strength], ["bearings", "turbine parts", "陶瓷轴承"]],
  ["Silicon carbide", "SiC", 3.15, 1400, 450, 9.7, [...zhTags.heat, ...zhTags.wear, ...zhTags.thermal], ["mechanical seals", "kiln furniture", "机械密封"]],
  ["Boron carbide", "B4C", 2.52, 1000, 350, 10, [...zhTags.lightweight, ...zhTags.wear, "armor"], ["armor tiles", "abrasives", "防弹陶瓷"]],
  ["Aluminum nitride", "AlN", 3.3, 1000, 300, 8.9, [...zhTags.thermal, ...zhTags.electrical], ["power electronics substrates", "散热基板"]],
  ["Mullite ceramic", "Mullite", 2.8, 1400, 180, 6.5, [...zhTags.heat, "thermal shock resistant"], ["furnace parts", "窑具"]],
  ["Cordierite ceramic", "Cord", 2.5, 1200, 120, 5.0, [...zhTags.heat, "low expansion"], ["catalyst supports", "蜂窝陶瓷"]],
  ["Macor machinable glass ceramic", "Macor", 2.52, 800, 94, 6.0, [...zhTags.electrical, "machinable", "可机加工"], ["vacuum fixtures", "绝缘夹具"]],
  ["Fused silica", "SiO2", 2.2, 1000, 50, 3.8, [...zhTags.transparent, ...zhTags.heat, "low expansion"], ["optical windows", "quartzware", "石英窗口"]],
  ["Porcelain electrical ceramic", "Porcelain", 2.4, 1000, 80, 6.0, [...zhTags.electrical, ...zhTags.weather], ["line insulators", "电力绝缘子"]]
].map(([name, abbr, density, maxTemp, tensile, dielectric, tags, uses]) => ({
  name,
  abbr,
  category: "Ceramics",
  family: "Ceramics",
  density,
  tg: null,
  tm: maxTemp + 500,
  maxTemp,
  tensile,
  elongation: 1,
  dielectric,
  tags,
  uses,
  chemical: "good to excellent",
  recyclable: false,
  processing: ["sintering", "pressing", "grinding", "烧结"],
  waterAbsorption: 0.02,
  thermal: tags.includes("thermal management") ? 120 : 20,
  cost: "high"
}));

const ceramicVariants = [
  { label: "dense sintered grade", code: "DS", tags: ["dense", "sintered"], tensileMult: 1 },
  { label: "porous thermal insulation grade", code: "POR", tags: ["porous", ...zhTags.heat], uses: [...zhUses.thermal], tensileMult: 0.25, densityMult: 0.55, thermalMult: 0.15 },
  { label: "precision ground wear grade", code: "PG", tags: [...zhTags.wear, "precision ground"], uses: ["wear guides", "耐磨导轨"], tensileMult: 1.1 },
  { label: "metallized electrical grade", code: "MET", tags: [...zhTags.electrical, "metallized"], uses: ["electrical feedthroughs", "电气馈通"], tensileMult: 0.95 },
  { label: "thermal shock resistant grade", code: "TS", tags: ["thermal shock resistant", "抗热震"], uses: ["furnace fixtures", "炉具"], tensileMult: 0.9 }
];

const compositeBases = [
  ["Carbon fiber epoxy laminate", "CFRP-EP", 1.55, 150, 900, 1.5, [...zhTags.lightweight, ...zhTags.strength], [...zhUses.aerospace, "robot arms"]],
  ["Glass fiber epoxy laminate", "GFRP-EP", 1.9, 140, 450, 2, [...zhTags.strength, ...zhTags.electrical], ["electrical panels", "structural panels"]],
  ["Aramid fiber epoxy laminate", "AFRP-EP", 1.38, 130, 650, 2.5, [...zhTags.impact, ...zhTags.lightweight], ["armor panels", "impact structures"]],
  ["Carbon fiber PEEK composite", "CFRP-PEEK", 1.45, 250, 1000, 1.2, [...zhTags.heat, ...zhTags.strength, ...zhTags.chemical], [...zhUses.aerospace, ...zhUses.medical]],
  ["Glass mat thermoplastic composite", "GMT", 1.25, 120, 180, 3, [...zhTags.lightweight, ...zhTags.impact], [...zhUses.automotive, "underbody shields"]],
  ["Sheet molding compound", "SMC", 1.85, 160, 150, 1.5, [...zhTags.strength, ...zhTags.flame], ["body panels", "electrical enclosures"]],
  ["Bulk molding compound", "BMC", 1.9, 160, 100, 1, [...zhTags.electrical, ...zhTags.flame], ["motor housings", "connectors"]],
  ["Basalt fiber composite", "BFRP", 1.95, 180, 550, 2, [...zhTags.heat, ...zhTags.chemical], [...zhUses.marine, "rebars"]],
  ["Wood plastic composite", "WPC", 1.15, 90, 35, 2, [...zhTags.weather, "wood filled"], ["decking", "outdoor profiles"]],
  ["Ceramic matrix composite", "CMC", 2.6, 1000, 250, 0.5, [...zhTags.heat, ...zhTags.lightweight], ["turbine shrouds", "heat shields"]]
].map(([name, abbr, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category: "Composites",
  family: "Composites",
  density,
  tg: null,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: tags.includes("electrical insulation") ? 4.5 : 8,
  tags,
  uses,
  chemical: tags.includes("chemical resistant") ? "good" : "matrix dependent",
  recyclable: false,
  processing: ["lamination", "compression molding", "autoclave", "铺层"],
  waterAbsorption: 0.3,
  thermal: 0.5,
  cost: maxTemp >= 240 ? "high" : "medium"
}));

const compositeVariants = [
  { label: "quasi-isotropic laminate", code: "QI", tags: ["quasi-isotropic", "准各向同性"], tensileMult: 0.9 },
  { label: "unidirectional high stiffness grade", code: "UD", tags: [...zhTags.strength, "unidirectional"], tensileMult: 1.35, elongationMult: 0.8 },
  { label: "woven fabric impact grade", code: "WVN", tags: [...zhTags.impact, "woven fabric"], tensileMult: 0.85, elongationMult: 1.2 },
  { label: "fire retardant rail grade", code: "FR", tags: [...zhTags.flame, "low smoke"], uses: ["rail interiors", "轨道交通"], tensileMult: 0.82 },
  { label: "marine corrosion resistant grade", code: "MAR", tags: [...zhTags.chemical, "marine"], uses: [...zhUses.marine], tensileMult: 0.88 },
  { label: "high temperature tooling grade", code: "HT", tags: [...zhTags.heat, ...zhUses.tooling], uses: [...zhUses.tooling], tempAdd: 50, cost: "high" }
];

const foamBases = [
  ["Rigid polyurethane foam", "PUF", "Foams", 0.06, 110, 1.2, 5, [...zhTags.lightweight, ...zhTags.thermal], ["insulation panels", "冷库保温"]],
  ["Flexible polyurethane foam", "FPUF", "Foams", 0.04, 90, 0.5, 120, [...zhTags.flexible, ...zhTags.lightweight], ["cushioning", "seating", "缓冲垫"]],
  ["Expanded polystyrene foam", "EPS", "Foams", 0.03, 75, 0.7, 5, [...zhTags.lightweight, ...zhTags.thermal], ["packaging", "建筑保温"]],
  ["Extruded polystyrene foam", "XPS", "Foams", 0.04, 75, 1.0, 5, [...zhTags.lightweight, ...zhTags.waterproof, ...zhTags.thermal], ["insulation boards", "地暖保温"]],
  ["PVC structural foam", "PVCF", "Foams", 0.12, 80, 3, 15, [...zhTags.lightweight, ...zhTags.waterproof], ["sandwich cores", "船舶夹芯"]],
  ["PMI structural foam", "PMIF", "Foams", 0.08, 180, 2.5, 10, [...zhTags.lightweight, ...zhTags.heat], ["aerospace sandwich cores", "航空夹芯"]],
  ["Silicone foam", "SIF", "Foams", 0.25, 200, 1.0, 80, [...zhTags.heat, ...zhTags.sealing, ...zhTags.flame], ["fire seals", "电池缓冲"]],
  ["Aluminum foam", "ALF", "Foams", 0.45, 300, 6, 5, [...zhTags.lightweight, "energy absorption"], ["crash absorbers", "吸能结构"]]
].map(([name, abbr, category, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category,
  family: category,
  density,
  tg: null,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: 2.5,
  tags,
  uses,
  chemical: "grade dependent",
  recyclable: false,
  processing: ["foaming", "molding", "cutting", "发泡"],
  waterAbsorption: tags.includes("waterproof") ? 0.2 : 2.0,
  thermal: 0.04,
  cost: "medium"
}));

const foamVariants = [
  { label: "low density grade", code: "LD", tags: [...zhTags.lightweight], densityMult: 0.65, tensileMult: 0.55 },
  { label: "medium density grade", code: "MD", tags: ["medium density"], densityMult: 1 },
  { label: "high density load-bearing grade", code: "HD", tags: [...zhTags.strength], densityMult: 1.8, tensileMult: 2.2 },
  { label: "flame retardant grade", code: "FR", tags: [...zhTags.flame], flammability: "flame retardant grade dependent", tempAdd: 5 },
  { label: "closed cell waterproof grade", code: "CC", tags: [...zhTags.waterproof, "closed cell"], waterMult: 0.2 },
  { label: "thermally insulating grade", code: "TI", tags: [...zhTags.thermal], thermalMult: 0.75 }
];

const adhesiveSealantCoatingBases = [
  ["Two-part epoxy adhesive", "2K-EP-ADH", "Adhesives", 1.18, 120, 35, 4, [...zhTags.bonding, ...zhTags.chemical], ["structural bonding", "结构粘接"]],
  ["Toughened acrylic adhesive", "ACR-ADH", "Adhesives", 1.05, 100, 25, 30, [...zhTags.bonding, ...zhTags.impact], ["metal bonding", "塑料金属粘接"]],
  ["Cyanoacrylate adhesive", "CA-ADH", "Adhesives", 1.1, 80, 20, 3, [...zhTags.bonding, "fast cure", "快固"], ["small part bonding", "快速固定"]],
  ["Anaerobic threadlocker", "AN-ADH", "Adhesives", 1.08, 150, 12, 5, [...zhTags.bonding, ...zhTags.sealing], ["thread locking", "螺纹锁固"]],
  ["Silicone sealant", "SI-SEAL", "Sealants", 1.15, 200, 3, 250, [...zhTags.sealing, ...zhTags.flexible, ...zhTags.heat], ["weather seals", "幕墙密封"]],
  ["Polyurethane sealant", "PU-SEAL", "Sealants", 1.2, 90, 5, 400, [...zhTags.sealing, ...zhTags.flexible], ["construction joints", "车身密封"]],
  ["Polysulfide sealant", "PS-SEAL", "Sealants", 1.45, 120, 3, 250, [...zhTags.sealing, ...zhTags.chemical], ["fuel tank seals", "油箱密封"]],
  ["Butyl sealant tape", "IIR-SEAL", "Sealants", 1.35, 90, 2, 500, [...zhTags.sealing, ...zhTags.waterproof], ["roofing seams", "防水搭接"]],
  ["Epoxy powder coating", "EP-COAT", "Coatings", 1.45, 120, 25, 5, [...zhTags.coating, ...zhTags.chemical], ["appliance coating", "电器涂层"]],
  ["Polyurethane coating", "PU-COAT", "Coatings", 1.2, 110, 20, 80, [...zhTags.coating, ...zhTags.weather], ["topcoats", "面漆"]],
  ["Fluoropolymer coating", "FP-COAT", "Coatings", 1.6, 200, 18, 50, [...zhTags.coating, ...zhTags.chemical, ...zhTags.weather], ["nonstick coatings", "防粘涂层"]],
  ["Ceramic thermal barrier coating", "TBC", "Coatings", 3.2, 1000, 30, 1, [...zhTags.coating, ...zhTags.heat, ...zhTags.thermal], ["turbine coatings", "热障涂层"]]
].map(([name, abbr, category, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category,
  family: category,
  density,
  tg: category === "Coatings" ? maxTemp - 40 : null,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: 4,
  tags,
  uses,
  chemical: tags.includes("chemical resistant") ? "good" : "grade dependent",
  recyclable: false,
  processing: category === "Coatings" ? ["spraying", "curing", "喷涂"] : ["dispensing", "curing", "点胶"],
  waterAbsorption: 0.4,
  thermal: tags.includes("thermal management") ? 1.5 : 0.25,
  cost: maxTemp >= 200 ? "high" : "medium"
}));

const adhesiveSealantCoatingVariants = [
  { label: "general purpose grade", code: "GP", tags: ["general purpose", "通用"], tensileMult: 1 },
  { label: "fast cure production grade", code: "FC", tags: ["fast cure", "快固"], uses: ["production assembly", "产线装配"], tensileMult: 0.95 },
  { label: "high temperature grade", code: "HT", tags: [...zhTags.heat], uses: ["high-temperature joints", "高温接头"], tempAdd: 45, cost: "high" },
  { label: "flexible movement grade", code: "FLEX", tags: [...zhTags.flexible], uses: ["moving joints", "位移接缝"], tensileMult: 0.75, elongationMult: 2.5 },
  { label: "chemical resistant grade", code: "CR", tags: [...zhTags.chemical], uses: [...zhUses.chemical], chemical: "good to excellent" },
  { label: "electrically insulating grade", code: "EI", tags: [...zhTags.electrical], uses: [...zhUses.electrical], dielectricAdd: 1 },
  { label: "thermally conductive grade", code: "TC", tags: [...zhTags.thermal], uses: ["battery packs", "电池包"], densityAdd: 0.5, thermalMult: 8 },
  { label: "flame retardant grade", code: "FR", tags: [...zhTags.flame], flammability: "flame retardant grade dependent" }
];

const specialtyBases = [
  ["Aerogel blanket", "AEROGEL", "Specialty materials", 0.16, 650, 0.5, 5, [...zhTags.thermal, ...zhTags.lightweight], ["thermal insulation", "管道保温"]],
  ["Graphite sheet thermal spreader", "GRAPH", "Specialty materials", 1.8, 400, 20, 2, [...zhTags.thermal, "anisotropic", "各向异性"], ["phone heat spreaders", "电子散热片"]],
  ["Mica electrical insulation sheet", "MICA", "Specialty materials", 2.8, 600, 150, 1, [...zhTags.electrical, ...zhTags.heat], ["slot insulation", "云母片"]],
  ["PTC ceramic heater material", "PTC", "Specialty materials", 5.0, 250, 60, 1, [...zhTags.electrical, ...zhTags.thermal], ["self-regulating heaters", "自控温加热"]],
  ["Phase change thermal pad", "PCM-PAD", "Specialty materials", 1.6, 120, 2, 80, [...zhTags.thermal, ...zhTags.flexible], ["electronics thermal interface", "导热垫"]],
  ["EMI shielding fabric", "EMI-FAB", "Specialty materials", 0.35, 120, 40, 15, [...zhTags.conductive, ...zhTags.flexible], ["shielding gaskets", "电磁屏蔽"]],
  ["Syntactic epoxy buoyancy material", "SYN-EPP", "Specialty materials", 0.65, 100, 35, 3, [...zhTags.lightweight, ...zhTags.waterproof], ["deepwater buoyancy", "深海浮力"]],
  ["Intumescent fire protection material", "INT-FP", "Specialty materials", 1.25, 300, 5, 20, [...zhTags.flame, ...zhTags.coating], ["fire stops", "防火封堵"]],
  ["Shape memory polymer", "SMP", "Specialty materials", 1.1, 90, 35, 100, ["shape memory", "形状记忆", ...zhTags.flexible], ["deployable structures", "智能结构"]],
  ["Magnetorheological elastomer", "MRE", "Specialty materials", 2.2, 120, 4, 80, ["magnetic response", "磁响应", ...zhTags.flexible], ["adaptive mounts", "智能减振"]]
].map(([name, abbr, category, density, maxTemp, tensile, elongation, tags, uses]) => ({
  name,
  abbr,
  category,
  family: category,
  density,
  tg: null,
  tm: null,
  maxTemp,
  tensile,
  elongation,
  dielectric: tags.includes("electrical insulation") ? 5 : null,
  tags,
  uses,
  chemical: "application dependent",
  recyclable: false,
  processing: ["converting", "assembly", "复合加工"],
  waterAbsorption: 0.5,
  thermal: tags.includes("thermal management") ? 5 : 0.3,
  cost: "high"
}));

const specialtyVariants = [
  { label: "standard grade", code: "STD", tags: ["standard", "标准"], tensileMult: 1 },
  { label: "thin film grade", code: "FILM", tags: ["film", "薄膜"], uses: ["films", "薄膜件"], densityMult: 0.9, tensileMult: 0.8 },
  { label: "high temperature grade", code: "HT", tags: [...zhTags.heat], uses: ["high temperature service", "高温工况"], tempAdd: 80, cost: "high" },
  { label: "flexible sheet grade", code: "SHT", tags: [...zhTags.flexible], uses: ["flexible sheets", "柔性片材"], elongationMult: 2 },
  { label: "electrical insulation grade", code: "EI", tags: [...zhTags.electrical], uses: [...zhUses.electrical], dielectricAdd: 2 },
  { label: "water resistant encapsulated grade", code: "WR", tags: [...zhTags.waterproof], uses: ["outdoor assemblies", "户外组件"], waterMult: 0.25 }
];

const generated = [
  ...polymerBases.flatMap((base) => polymerVariants.map((variant) => makeEntry(base, variant))),
  ...thermosetBases.flatMap((base) => thermosetVariants.map((variant) => makeEntry(base, variant))),
  ...elastomerBases.flatMap((base) => elastomerVariants.map((variant) => makeEntry(base, variant))),
  ...metalBases.flatMap((base) => metalVariants.map((variant) => makeEntry(base, variant))),
  ...ceramicBases.flatMap((base) => ceramicVariants.map((variant) => makeEntry(base, variant))),
  ...compositeBases.flatMap((base) => compositeVariants.map((variant) => makeEntry(base, variant))),
  ...foamBases.flatMap((base) => foamVariants.map((variant) => makeEntry(base, variant))),
  ...adhesiveSealantCoatingBases.flatMap((base) => adhesiveSealantCoatingVariants.map((variant) => makeEntry(base, variant))),
  ...specialtyBases.flatMap((base) => specialtyVariants.map((variant) => makeEntry(base, variant)))
];

module.exports = generated;
