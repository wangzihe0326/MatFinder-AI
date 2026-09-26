(function () {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const normalize = (value, min, max) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
    return clamp((Number(value) - min) / (max - min));
  };
  const requirementParseCache = new Map();
  const scoreCache = new Map();
  const certificationRequirementDefinitions = [
    { code: "FDA", label: "FDA", pattern: /\bfda\b/i },
    { code: "UL 94", label: "UL 94", pattern: /\bul\s*94\b/i },
    { code: "RoHS", label: "RoHS", pattern: /\brohs\b/i },
    { code: "REACH", label: "REACH", pattern: /\breach\b/i }
  ];
  const unsupportedConstraintDefinitions = [
    {
      code: "certification",
      patterns: [/\bcertification\b/i, /\bregulatory compliance\b/i, /食品接触|认证|合规/],
      label: "certification or regulatory compliance",
      zh: "认证或法规合规"
    },
    {
      code: "specific_chemical",
      patterns: [/浓硫酸|硫酸|盐酸|硝酸|氢氟酸|烧碱|氢氧化钠|溶剂浓度|sulfuric acid|hydrochloric acid|nitric acid|hydrofluoric acid|chemical concentration/i],
      label: "chemical identity and concentration compatibility",
      zh: "具体化学介质及浓度相容性"
    },
    {
      code: "compression_set",
      patterns: [/压缩永久变形|压缩形变|compression set|permanent compression/i],
      label: "compression-set performance",
      zh: "压缩永久变形性能"
    },
    {
      code: "commercial",
      patterns: [/价格|报价|成本|供应商|采购|库存|交期|起订量|牌号|price|quote|supplier|availability|lead time|moq|purchas/i],
      label: "supplier, grade, price, availability, or lead time",
      zh: "供应商、牌号、价格、库存或交期"
    },
    {
      code: "bom",
      patterns: [/\bbom\b/i, /物料清单|完整材料清单|每个部件|用量|生产\s*\d+|制造\s*\d+|需要哪些材料/i],
      label: "product BOM and quantity planning",
      zh: "产品 BOM 与用量计划"
    },
    {
      code: "test_method",
      patterns: [/测试方法|试验方法|检测标准|test method|test standard/i],
      label: "test method and specimen conditions",
      zh: "测试方法与试样条件"
    }
  ];

  const zh = {
    lightweight: ["\u8f7b\u91cf", "\u4f4e\u5bc6\u5ea6", "\u8f7b\u8d28", "\u51cf\u91cd"],
    heat: ["\u8010\u70ed", "\u9ad8\u6e29", "\u6e29\u5ea6", "\u70ed"],
    hdt: ["\u70ed\u53d8\u5f62\u6e29\u5ea6"],
    electrical: ["\u7535\u7edd\u7f18", "\u7edd\u7f18", "\u4ecb\u7535", "\u7535\u6c14", "\u7535\u5b50", "\u8fde\u63a5\u5668"],
    strength: ["\u5f3a\u5ea6", "\u9ad8\u5f3a", "\u627f\u8f7d", "\u7ed3\u6784", "\u521a\u6027", "\u673a\u68b0"],
    chemical: ["\u5316\u5b66", "\u8010\u8150\u8680", "\u6eb6\u5242", "\u9178", "\u78b1", "\u71c3\u6cb9"],
    transparent: ["\u900f\u660e", "\u5149\u5b66", "\u900f\u5149", "\u7a97\u53e3", "\u955c\u7247"],
    impact: ["\u6297\u51b2\u51fb", "\u51b2\u51fb", "\u97e7\u6027", "\u9632\u62a4", "\u8dcc\u843d"],
    flexible: ["\u67d4\u6027", "\u67d4\u8f6f", "\u5f39\u6027", "\u6a61\u80f6", "\u5bc6\u5c01", "\u57ab\u5708"],
    wear: ["\u8010\u78e8", "\u6469\u64e6", "\u8f74\u627f", "\u9f7f\u8f6e", "\u6ed1\u52a8"],
    weather: ["\u8010\u5019", "\u6237\u5916", "\u81ed\u6c27", "\u9633\u5149"],
    uv: ["\u7d2b\u5916", "\u6297\u7d2b\u5916", "\u8010\u7d2b\u5916", "\u9632\u7d2b\u5916", "\u9632\u6652"],
    flame: ["\u963b\u71c3", "\u9632\u706b", "\u81ea\u7184"],
    nonSolid: ["\u975e\u56fa\u4f53", "\u975e\u786c\u8d28", "\u8f6f\u8d28", "\u6db2\u6001", "\u6d41\u4f53", "\u53ef\u53d1\u6ce1"],
    waterproof: ["\u9632\u6c34", "\u8010\u6c34", "\u4f4e\u5438\u6c34", "\u9632\u6f6e", "\u9632\u6e17"],
    sealing: ["\u5bc6\u5c01", "\u5bc6\u5c01\u5708", "\u5bc6\u5c01\u4ef6", "\u57ab\u5708", "\u80f6\u5708", "O\u578b\u5708"],
    sustainable: ["\u53ef\u6301\u7eed", "\u53ef\u56de\u6536", "\u751f\u7269\u57fa", "\u53ef\u5806\u80a5", "\u53ef\u518d\u751f"],
    medical: ["\u533b\u7597", "\u690d\u5165", "\u751f\u7269\u76f8\u5bb9", "\u706d\u83cc", "\u65e0\u83cc"],
    food: ["\u98df\u54c1", "\u98df\u54c1\u63a5\u89e6", "\u5305\u88c5", "\u74f6"]
  };

  const synonymGroups = [
    {
      id: "lightweight",
      label: "lightweight",
      weight: 1.15,
      keywords: ["lightweight", "light weight", "low density", "weight saving", "light", "lighter", ...zh.lightweight],
      evaluate: (item) => {
        if (item.density === null || item.density === undefined) return positiveMaterialText(item).includes("lightweight") ? 0.55 : 0.15;
        if (item.density <= 1) return 1;
        if (item.density <= 1.25) return 0.85;
        if (item.density <= 1.4) return 0.68;
        if (item.density <= 1.8) return 0.35;
        return 0.1;
      },
      reason: (item) =>
        item.density === null || item.density === undefined ? "lightweight fit is indicated by tags or uses" : `low density (${item.density} g/cm3)`
    },
    {
      id: "heat",
      label: "heat resistant",
      weight: 1.25,
      keywords: ["heat", "hot", "thermal", "temperature", "high temp", "heat-resistant", "heat resistant", ...zh.heat],
      evaluate: (item) => {
        if (item.maxTemp === null || item.maxTemp === undefined) {
          const text = positiveMaterialText(item);
          return text.includes("heat resistant") || text.includes("high temperature") || text.includes("thermal") ? 0.6 : 0.15;
        }
        return normalize(item.maxTemp, 70, 300);
      },
      reason: (item) =>
        item.maxTemp === null || item.maxTemp === undefined ? "heat resistance is indicated by tags or applications" : `continuous use up to ${item.maxTemp} deg C`
    },
    {
      id: "hdt",
      label: "heat deflection temperature",
      weight: 1.25,
      keywords: ["hdt", "heat deflection temperature", "heat distortion temperature", ...zh.hdt],
      evaluate: () => 0,
      reason: () => "heat deflection temperature evidence is required"
    },
    {
      id: "electrical",
      label: "electrical insulation",
      weight: 1.1,
      keywords: ["electrical", "electric", "insulating", "insulation", "dielectric", "electronics", "connector", ...zh.electrical],
      evaluate: (item) => {
        const text = materialText(item);
        const explicitFit =
          text.includes("electrical insulation") ||
          text.includes("insulator") ||
          text.includes("connector") ||
          text.includes("electronic") ||
          text.includes("cable");
        return clamp(0.45 + (explicitFit ? 0.35 : 0) + normalize(item.dielectric ?? item.dielectric_constant, 2.1, 8.4) * 0.2);
      },
      reason: (item) =>
        item.dielectric === null || item.dielectric === undefined
          ? "electrical insulation fit is indicated by tags or uses"
          : `electrical insulation fit with dielectric constant ${item.dielectric}`
    },
    {
      id: "strength",
      label: "high strength",
      weight: 1.05,
      keywords: ["strong", "strength", "load", "structural", "stiff", "rigid", "mechanical", "flexural", ...zh.strength],
      evaluate: (item) => {
        const strength = item.tensile ?? item.tensile_strength;
        if (strength === null || strength === undefined) {
          const text = positiveMaterialText(item);
          return text.includes("high strength") || text.includes("structural") || text.includes("stiff") ? 0.6 : 0.15;
        }
        return normalize(strength, 10, 160);
      },
      reason: (item) => {
        const strength = item.tensile ?? item.tensile_strength;
        return strength === null || strength === undefined ? "strength fit is indicated by tags or applications" : `tensile strength of ${strength} MPa`;
      }
    },
    {
      id: "chemical",
      label: "chemical resistant",
      weight: 1.15,
      keywords: ["chemical", "solvent", "corrosion", "acid", "alkali", "fluid", "fuel", ...zh.chemical],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("chemical resistant") || text.includes("corrosion resistant") || text.includes("fluoropolymer") ? 1 : 0.35;
      },
      reason: () => "strong chemical resistance profile"
    },
    {
      id: "transparent",
      label: "transparent",
      weight: 1,
      keywords: ["transparent", "clear", "optical", "clarity", "window", "lens", ...zh.transparent],
      evaluate: (item) => (positiveMaterialText(item).includes("transparent") || positiveMaterialText(item).includes("optical") ? 1 : 0.15),
      reason: () => "transparent or optical-use material"
    },
    {
      id: "impact",
      label: "impact resistant",
      weight: 1,
      keywords: ["impact", "tough", "shock", "protective", "drop", "armor", "ballistic", ...zh.impact],
      evaluate: (item) => {
        const text = positiveMaterialText(item);
        return text.includes("impact resistant") || text.includes("tough") || text.includes("protective") || text.includes("armor") ? 1 : 0.25;
      },
      reason: () => "good toughness or impact resistance"
    },
    {
      id: "flexible",
      label: "flexible",
      weight: 0.95,
      keywords: ["flexible", "soft", "elastic", "rubber", "elastomer", "stretch", "seal", "gasket", ...zh.flexible],
      evaluate: (item) => {
        const text = materialText(item);
        const tagScore = text.includes("elastomer") || text.includes("flexible") || text.includes("rubber") ? 0.65 : 0.1;
        return clamp(tagScore + normalize(item.elongation, 50, 750) * 0.35);
      },
      reason: (item) => (item.elongation === null || item.elongation === undefined ? "flexible behavior is indicated by tags or uses" : `flexible behavior with ${item.elongation}% elongation`)
    },
    {
      id: "wear",
      label: "wear resistance",
      weight: 0.95,
      keywords: ["wear", "abrasion", "friction", "bearing", "gear", "sliding", "hardness", ...zh.wear],
      evaluate: (item) => {
        const text = materialText(item);
        if (text.includes("low friction") || text.includes("wear resistant") || text.includes("hard")) return 1;
        if (text.includes("bearing") || text.includes("gear")) return 0.75;
        return 0.2;
      },
      reason: () => "wear or low-friction use profile"
    },
    {
      id: "weather",
      label: "weather resistant",
      weight: 0.9,
      keywords: ["weather", "outdoor", "outdoor use", "outside", "exterior", "ozone", "weathering", ...zh.weather],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("weather resistant") || text.includes("ozone resistant") || text.includes("uv resistant") ? 1 : 0.25;
      },
      reason: () => "weathering resistance is represented in the dataset"
    },
    {
      id: "uv",
      label: "UV resistant",
      weight: 0.9,
      keywords: ["uv", "u.v.", "ultraviolet", "sunlight", "sun exposure", "uv resistant", "uv-resistant", "uv stabilized", "uv-stabilized", ...zh.uv],
      evaluate: (item) => {
        const text = materialText(item);
        if (text.includes("uv resistant") || text.includes("uv stabilized") || text.includes("weather resistant") || text.includes("outdoor")) return 1;
        if (text.includes("sunlight") || text.includes("ozone resistant") || text.includes("fluoropolymer")) return 0.75;
        return 0.2;
      },
      reason: () => "UV or sunlight resistance is represented in the dataset"
    },
    {
      id: "flame",
      label: "flame resistance",
      weight: 0.95,
      keywords: ["flame", "fire", "self extinguishing", "flame retardant", "flammability", ...zh.flame],
      evaluate: (item) => (materialText(item).includes("flame retardant") || materialText(item).includes("fire") ? 1 : 0.2),
      reason: () => "flame-retardant profile"
    },
    {
      id: "nonSolid",
      label: "non-solid or soft form",
      weight: 1.05,
      keywords: ["non-solid", "not solid", "non solid", "soft", "liquid", "fluid", "foam", "foamable", "gel", ...zh.nonSolid],
      evaluate: (item) => {
        const text = materialText(item);
        const category = String(item.category || "").toLowerCase();
        const explicitSoft =
          category.includes("elastomer") ||
          category.includes("rubber") ||
          text.includes("flexible") ||
          text.includes("soft") ||
          text.includes("elastomer") ||
          text.includes("rubber") ||
          text.includes("foam") ||
          text.includes("film") ||
          text.includes("seal") ||
          text.includes("gasket");
        const rigidPenalty = text.includes("rigid") && !text.includes("rigid or flexible") ? -0.2 : 0;
        return clamp((explicitSoft ? 0.72 : 0.18) + normalize(item.elongation, 80, 750) * 0.3 + rigidPenalty);
      },
      reason: (item) =>
        item.elongation === null || item.elongation === undefined
          ? "soft or non-rigid behavior is indicated by category, tags, or applications"
          : `soft or non-rigid fit with ${item.elongation}% elongation`,
      warning: () => "non-solid or soft-form requirement is weakly supported by the local fields"
    },
    {
      id: "waterproof",
      label: "waterproof or low moisture",
      weight: 1.05,
      keywords: ["waterproof", "water resistant", "moisture resistant", "low moisture", "low water absorption", "hydrolysis resistant", ...zh.waterproof],
      evaluate: (item) => {
        const text = materialText(item);
        const waterAbsorption = item.water_absorption ?? item.waterAbsorption;
        const explicitWaterFit =
          text.includes("water resistant") ||
          text.includes("low moisture") ||
          text.includes("low water") ||
          text.includes("hydrolysis resistant") ||
          text.includes("pipe") ||
          text.includes("tank");

        if (waterAbsorption !== null && waterAbsorption !== undefined && !Number.isNaN(Number(waterAbsorption))) {
          return clamp((explicitWaterFit ? 0.45 : 0.15) + (1 - normalize(Number(waterAbsorption), 0.05, 2.5)) * 0.55);
        }

        return explicitWaterFit ? 0.82 : 0.25;
      },
      reason: (item) => {
        const waterAbsorption = item.water_absorption ?? item.waterAbsorption;
        return waterAbsorption === null || waterAbsorption === undefined
          ? "waterproof fit is indicated by tags, uses, or description"
          : `low water absorption (${waterAbsorption}%) supports waterproof use`;
      },
      warning: () => "waterproof requirement is weakly supported by the local fields"
    },
    {
      id: "sealing",
      label: "sealing",
      weight: 1.1,
      keywords: ["seal", "sealing", "sealed", "gasket", "o-ring", "o ring", "oring", "washer seal", "pack seal", ...zh.sealing],
      evaluate: (item) => {
        const text = materialText(item);
        const category = String(item.category || "").toLowerCase();
        const flexibleFit = category.includes("elastomer") || category.includes("rubber") || text.includes("flexible") || text.includes("elastomer") || text.includes("rubber");
        const sealFit = text.includes("seal") || text.includes("gasket") || text.includes("o-ring") || text.includes("o ring") || text.includes("密封");
        const chemicalFit = text.includes("chemical resistant") || text.includes("oil resistant") || text.includes("fuel resistant") || text.includes("耐化学") || text.includes("耐油");
        return clamp((sealFit ? 0.55 : 0.15) + (flexibleFit ? 0.3 : 0) + (chemicalFit ? 0.15 : 0));
      },
      reason: () => "sealing fit is indicated by elastomer, gasket, or seal applications",
      warning: () => "sealing requirement is weakly supported by the local fields"
    },
    {
      id: "sustainable",
      label: "sustainability",
      weight: 0.85,
      keywords: ["sustainable", "recyclable", "recycled", "bio", "compostable", "renewable", ...zh.sustainable],
      evaluate: (item) => (item.recyclable ? 0.75 : 0.15) + (materialText(item).includes("bio-based") ? 0.25 : 0),
      reason: (item) => (item.recyclable ? "recyclable material family" : "bio-based or specialty sustainability fit")
    },
    {
      id: "medical",
      label: "medical suitability",
      weight: 0.85,
      keywords: ["medical", "implant", "biocompatible", "sterilizable", "sterile", ...zh.medical],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("medical") || text.includes("biocompatible") || text.includes("sterilizable") || text.includes("implant") ? 1 : 0.2;
      },
      reason: () => "medical-related uses are present in the local dataset"
    },
    {
      id: "food",
      label: "food contact",
      weight: 0.75,
      keywords: ["food", "food contact", "packaging", "bottle", ...zh.food],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("food") || text.includes("packaging") || text.includes("bottle") ? 1 : 0.25;
      },
      reason: () => "common food or packaging applications"
    }
  ];

  function materialText(item) {
    return [
      item.name,
      item.name_en,
      item.name_zh,
      item.abbr,
      item.abbreviation,
      item.category,
      item.category_en,
      item.category_zh,
      item.family,
      item.manufacturer,
      item.trade_name,
      item.summary,
      item.description,
      item.description_en,
      item.description_zh,
      item.notes,
      item.chemical_resistance,
      item.flammability,
      item.recyclability,
      item.cost_level,
      ...(item.tags || []),
      ...(item.tags_en || []),
      ...(item.tags_zh || []),
      ...(item.uses || []),
      ...(item.applications || []),
      ...(item.applications_en || []),
      ...(item.applications_zh || []),
      ...(item.processing_methods || []),
      ...(item.typical_applications || []),
      ...(item.advantages || []),
      ...(item.disadvantages || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function positiveMaterialText(item) {
    return [
      item.name,
      item.name_en,
      item.name_zh,
      item.abbr,
      item.abbreviation,
      item.category,
      item.category_en,
      item.category_zh,
      item.family,
      item.summary,
      item.description,
      item.description_en,
      item.description_zh,
      item.chemical_resistance,
      item.flammability,
      ...(item.tags || []),
      ...(item.tags_en || []),
      ...(item.tags_zh || []),
      ...(item.uses || []),
      ...(item.applications || []),
      ...(item.applications_en || []),
      ...(item.applications_zh || []),
      ...(item.processing_methods || []),
      ...(item.typical_applications || []),
      ...(item.advantages || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9.+\-\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2);
  }

  function criterionWarning(criterion) {
    return `${criterion.label} requirement is weakly supported by the local fields`;
  }

  function matchesAny(text, patterns) {
    return patterns.some((pattern) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)));
  }

  function addCriterion(matches, id, source = "inferred") {
    const criterion = synonymGroups.find((group) => group.id === id);
    if (!criterion || matches.has(id)) return;
    matches.set(id, { criterion, source });
  }

  function applyRequirementInference(text, matches) {
    const hasBattery = matchesAny(text, [/\b(ev|electric vehicle|new energy vehicle|nev)\b/, "新能源汽车", "新能源车", "电动车", "电动汽车", "电池", "battery", "battery pack", "cell pack"]);
    const hasSeal = matchesAny(text, ["密封", "密封圈", "密封件", "胶圈", "垫圈", "seal", "sealing", "gasket", "o-ring", "o ring", "oring"]);
    const hasOutdoor = matchesAny(text, ["户外", "室外", "露天", "外部", "outdoor", "outside", "exterior", "sunlight", "weather exposure"]);
    const hasTransparent = matchesAny(text, ["透明", "透光", "光学", "transparent", "clear", "optical", "see-through"]);
    const hasProtectiveCover = matchesAny(text, ["防护罩", "保护罩", "护罩", "外罩", "罩壳", "protective cover", "protective housing", "cover", "guard", "shield", "window"]);
    const hasElectricalContext = matchesAny(text, ["电池", "电气", "电控", "电子", "连接器", "battery", "electrical", "electronics", "connector", "busbar"]);
    const hasFluidOrChemicalContext = matchesAny(text, ["电解液", "冷却液", "燃油", "油", "酸", "碱", "化学", "electrolyte", "coolant", "fuel", "oil", "acid", "alkali", "chemical"]);

    if (hasBattery && hasSeal) {
      ["heat", "electrical", "chemical", "sealing", "flexible"].forEach((id) => addCriterion(matches, id, "battery-seal inference"));
    } else if (hasSeal) {
      ["sealing", "flexible"].forEach((id) => addCriterion(matches, id, "seal inference"));
      if (hasElectricalContext) addCriterion(matches, "electrical", "seal electrical-context inference");
      if (hasFluidOrChemicalContext) addCriterion(matches, "chemical", "seal fluid-context inference");
    }

    if (hasBattery && !hasSeal) {
      ["heat", "electrical", "chemical"].forEach((id) => addCriterion(matches, id, "battery inference"));
    }

    if (hasOutdoor) {
      ["weather", "uv"].forEach((id) => addCriterion(matches, id, "outdoor inference"));
    }

    if (hasTransparent) {
      addCriterion(matches, "transparent", "transparent inference");
    }

    if (hasProtectiveCover) {
      addCriterion(matches, "impact", "protective-cover inference");
      if (hasTransparent) addCriterion(matches, "transparent", "transparent-cover inference");
      if (hasOutdoor) ["weather", "uv"].forEach((id) => addCriterion(matches, id, "outdoor-cover inference"));
    }
  }

  function parseRequirement(description) {
    const query = String(description || "").trim();
    if (requirementParseCache.has(query)) return requirementParseCache.get(query);
    const text = query.toLowerCase();
    const matches = new Map();
    const priority = [
      "heat",
      "hdt",
      "electrical",
      "chemical",
      "sealing",
      "flexible",
      "transparent",
      "uv",
      "impact",
      "weather",
      "waterproof",
      "lightweight",
      "strength",
      "wear",
      "flame",
      "nonSolid",
      "sustainable",
      "medical",
      "food"
    ];

    synonymGroups.forEach((group) => {
      if (group.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
        addCriterion(matches, group.id, "keyword");
      }
    });

    applyRequirementInference(text, matches);
    const hardConstraints = extractHardConstraints(query);
    const certificationRequirements = extractCertificationRequirements(query);
    const evidenceContext = extractRequestedEvidenceContext(query);
    if (hardConstraints.minimumTemperatureC !== null) addCriterion(matches, "heat", "numeric temperature");
    if (hardConstraints.minimumHdtC !== null) addCriterion(matches, "hdt", "numeric hdt");
    if (hardConstraints.minimumTensileMpa !== null) addCriterion(matches, "strength", "numeric tensile strength");

    const parsed = [...matches.values()].sort((a, b) => {
      const aIndex = priority.indexOf(a.criterion.id);
      const bIndex = priority.indexOf(b.criterion.id);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    const criteria = parsed.map((entry) => entry.criterion);
    const parsedRequirement = {
      query,
      requirements: [
        ...criteria.map((criterion) => criterion.label),
        ...certificationRequirements.map((requirement) => requirement.label)
      ],
      criteria,
      sources: parsed.map((entry) => ({ id: entry.criterion.id, label: entry.criterion.label, source: entry.source })),
      hardConstraints,
      certificationRequirements,
      evidenceContext,
      unsupportedConstraints: extractUnsupportedConstraints(query)
    };
    requirementParseCache.set(query, parsedRequirement);
    return parsedRequirement;
  }

  function extractCriteria(description) {
    return parseRequirement(description).criteria;
  }

  function textSimilarity(description, item) {
    const queryTokens = tokenize(description);
    if (!queryTokens.length) return 0;
    const searchable = materialText(item);
    const hits = queryTokens.filter((token) => searchable.includes(token)).length;
    return hits / queryTokens.length;
  }

  function scoreMaterial(description, item) {
    const cacheKey = `${description}::${item.id}`;
    if (scoreCache.has(cacheKey)) return scoreCache.get(cacheKey);
    const parsedRequirement = parseRequirement(description);
    if (
      !parsedRequirement.criteria.length &&
      !parsedRequirement.certificationRequirements?.length
    ) {
      const fallbackResult = {
        material: item,
        score: 0,
        reasons: [],
        warnings: ["no recognized engineering requirement; recommendation withheld"],
        matchedCriteria: [],
        requirementResults: [],
        bucket: "rejected"
      };
      scoreCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
    const result = evaluateEvidenceRecommendation(item, parsedRequirement);
    scoreCache.set(cacheKey, result);
    return result;
  }

  const criterionPropertyMap = {
    heat: "continuous_use_temperature",
    hdt: "hdt",
    strength: "tensile_strength",
    impact: "impact_strength",
    lightweight: "density",
    transparent: "transparency",
    chemical: "chemical_resistance",
    flexible: "flexibility",
    sealing: "flexibility",
    flame: "flame_rating",
    electrical: "dielectric_constant",
    waterproof: "water_absorption"
  };

  function evaluateEvidenceRecommendation(item, parsedRequirement) {
    const requirementResults = parsedRequirement.criteria.map((criterion) =>
      evaluateRequirementEvidence(item, criterion, parsedRequirement)
    );
    (parsedRequirement.certificationRequirements || []).forEach((requirement) => {
      requirementResults.push(evaluateCertificationEvidence(item, requirement));
    });
    parsedRequirement.unsupportedConstraints.forEach((constraint) => {
      requirementResults.push({
        requirement: constraint.label,
        detectedConstraint: constraint.label,
        materialValue: null,
        status: "unverifiable",
        evidenceSource: null,
        explanation: "The local evidence model does not contain verified data for this constraint.",
        critical: true,
        propertyKey: null
      });
    });

    const hardFailure = requirementResults.some((result) =>
      result.critical && result.status === "not_satisfied"
    );
    const hardEvidenceGap = requirementResults.some((result) =>
      result.critical && ["unknown", "unverifiable"].includes(result.status)
    );
    const confidence = item.data_quality?.confidence_level || item.data_quality?.level || "quarantined";
    const quarantined = confidence === "quarantined" || item.data_quality?.verification_status === "quarantined";
    const score = calculateEvidenceScore(requirementResults, confidence);
    const reasons = requirementResults
      .filter((result) => result.status === "satisfied")
      .map((result) => `${result.requirement}: ${result.explanation}`)
      .slice(0, 3);
    const warnings = requirementResults
      .filter((result) => result.status !== "satisfied")
      .map((result) => `${result.requirement}: ${result.status} - ${result.explanation}`)
      .slice(0, 5);

    let bucket = "potential";
    if (quarantined || hardFailure) {
      bucket = "rejected";
    } else if (
      ["high", "medium"].includes(confidence) &&
      !hardEvidenceGap &&
      requirementResults.every((result) => result.status === "satisfied")
    ) {
      bucket = "verified";
    }

    return {
      material: item,
      score,
      evidenceScore: score,
      confidenceLevel: confidence,
      verificationStatus: item.data_quality?.verification_status || "unverified",
      referenceOnly: confidence === "low",
      bucket,
      reasons,
      warnings,
      requirementResults,
      matchedCriteria: parsedRequirement.requirements
    };
  }

  function evaluateRequirementEvidence(item, criterion, parsedRequirement) {
    const propertyKey = criterionPropertyMap[criterion.id] || null;
    const selection = bestEvidenceClaim(
      item,
      propertyKey,
      parsedRequirement.evidenceContext?.propertyKey === propertyKey
        ? parsedRequirement.evidenceContext
        : {}
    );
    const claim = selection.claim;
    const critical = isCriticalCriterion(criterion.id, parsedRequirement);
    const numericConstraint = numericConstraintFor(criterion.id, parsedRequirement.hardConstraints);
    const base = {
      requirement: criterion.label,
      detectedConstraint: numericConstraint !== null
        ? `${criterion.label} >= ${numericConstraint}${["heat", "hdt"].includes(criterion.id) ? " degC" : " MPa"}`
        : criterion.label,
      materialValue: formatClaimValue(claim),
      evidenceSource: evidenceSourceFor(claim),
      critical,
      propertyKey
    };

    if (selection.status === "unverifiable") {
      return {
        ...base,
        status: "unverifiable",
        explanation: selection.explanation
      };
    }

    if (!propertyKey || !claim || claim.value === null || claim.value === undefined || claim.value === "") {
      return {
        ...base,
        status: "unknown",
        explanation: "Property data unavailable."
      };
    }

    if (!claimIsVerifiable(claim, propertyKey)) {
      return {
        ...base,
        status: "unverifiable",
        explanation: evidenceGapExplanation(claim, propertyKey)
      };
    }

    if (numericConstraint !== null) {
      const value = finiteNumber(claim.value);
      if (value === null) {
        return {
          ...base,
          status: "unknown",
          explanation: "The material value is not numeric."
        };
      }
      return value >= numericConstraint
        ? {
            ...base,
            status: "satisfied",
            explanation: `${value} ${claim.unit || ""} meets the required minimum of ${numericConstraint}.`.trim()
          }
        : {
            ...base,
            status: "not_satisfied",
            explanation: `${value} ${claim.unit || ""} is below the required minimum of ${numericConstraint}.`.trim()
          };
    }

    const qualitative = evaluateQualitativeClaim(criterion.id, claim);
    return { ...base, ...qualitative };
  }

  function evaluateQualitativeClaim(criterionId, claim) {
    const text = String(claim.value || "").toLowerCase();
    if (criterionId === "transparent") {
      if (/transparent|clear|optical/.test(text)) return { status: "satisfied", explanation: "Verified property evidence indicates transparency." };
      if (/opaque|not transparent/.test(text)) return { status: "not_satisfied", explanation: "Verified property evidence indicates an opaque material." };
    }
    if (criterionId === "chemical") {
      if (/excellent|good|resistant/.test(text)) return { status: "satisfied", explanation: "Verified evidence indicates chemical resistance." };
      if (/poor|limited|not resistant/.test(text)) return { status: "not_satisfied", explanation: "Verified evidence indicates limited chemical resistance." };
    }
    if (criterionId === "flexible" || criterionId === "sealing") {
      if (/flexible|elastomer|rubber/.test(text)) return { status: "satisfied", explanation: "Verified evidence indicates flexible behavior." };
      if (/rigid|brittle/.test(text)) return { status: "not_satisfied", explanation: "Verified evidence indicates rigid behavior." };
    }
    if (criterionId === "flame") {
      if (/v-0|v0|v-1|v1|flame retardant|self extinguish/.test(text)) return { status: "satisfied", explanation: "Verified evidence indicates a flame-rated grade." };
      if (/not rated|combustible/.test(text)) return { status: "not_satisfied", explanation: "Verified evidence does not support the requested flame performance." };
    }
    if (criterionId === "electrical" && finiteNumber(claim.value) !== null) {
      return { status: "satisfied", explanation: "Verified dielectric property evidence is available." };
    }
    return {
      status: "unverifiable",
      explanation: "The requirement has no explicit threshold or decisive verified property value."
    };
  }

  function bestEvidenceClaim(item, propertyKey, evidenceContext = {}) {
    if (!propertyKey) return { claim: null, status: "unknown" };
    const claims = item.evidence?.properties?.[propertyKey] || [];
    if (!claims.length) return { claim: null, status: "unknown" };
    const requestedStandard = normalizeContext(evidenceContext?.testStandard);
    const requestedCondition = normalizeContext(evidenceContext?.testCondition);
    let applicable = [...claims];
    if (requestedStandard) {
      applicable = applicable.filter((claim) =>
        normalizeContext(claim.testStandard) === requestedStandard
      );
    }
    if (requestedCondition) {
      applicable = applicable.filter((claim) => {
        const claimCondition = normalizeContext(claim.testCondition);
        return claimCondition &&
          (claimCondition.includes(requestedCondition) ||
            requestedCondition.includes(claimCondition));
      });
    }
    if (!applicable.length && (requestedStandard || requestedCondition)) {
      return {
        claim: null,
        status: "unverifiable",
        explanation: "No property evidence matches the requested test standard and condition."
      };
    }

    const completeContexts = new Set(
      applicable
        .filter((claim) => claim.testStandard && claim.testCondition)
        .map((claim) => [
          normalizeContext(claim.testStandard),
          normalizeContext(claim.testCondition),
          normalizeContext(claim.unit),
          normalizeContext(claim.valueType)
        ].join("|"))
    );
    if (!requestedStandard && !requestedCondition && completeContexts.size > 1) {
      return {
        claim: null,
        status: "unverifiable",
        explanation: "Multiple test conditions are available and the requested condition is not specific enough."
      };
    }
    if (applicable.some((claim) => claim.conflictStatus === "conflicting")) {
      return {
        claim: null,
        status: "unverifiable",
        explanation: "Conflicting property evidence exists under the same stated test context."
      };
    }
    const claim = applicable.sort((left, right) =>
      claimRank(right) - claimRank(left)
    )[0] || null;
    return { claim, status: claim ? "selected" : "unknown" };
  }

  function normalizeContext(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function claimRank(claim) {
    const confidenceRank = { high: 4, medium: 3, low: 2, quarantined: 0 };
    const verificationRank = { verified: 4, partially_verified: 3, unverified: 1, quarantined: 0 };
    return (confidenceRank[claim.confidenceLevel] || 0) * 10 +
      (verificationRank[claim.verificationStatus] || 0) +
      (claim.source?.sourceUrl ? 1 : 0);
  }

  function claimIsVerifiable(claim, propertyKey) {
    const numericEngineeringProperties = new Set([
      "density",
      "tensile_strength",
      "hdt",
      "continuous_use_temperature",
      "glass_transition_temperature",
      "melting_temperature",
      "flexural_strength",
      "impact_strength",
      "elongation",
      "thermal_conductivity",
      "dielectric_constant",
      "water_absorption"
    ]);
    const source = claim.source || {};
    const sourceVerified =
      ["verified", "partially_verified"].includes(claim.verificationStatus) &&
      ["manufacturer", "official_datasheet", "academic", "distributor"].includes(source.sourceType) &&
      /^https?:\/\/\S+$/i.test(String(source.sourceUrl || "")) &&
      Boolean(source.sourceTitle);
    if (!sourceVerified) return false;
    if (numericEngineeringProperties.has(propertyKey)) {
      return Boolean(claim.testStandard && claim.testCondition);
    }
    return true;
  }

  function evidenceGapExplanation(claim, propertyKey) {
    if (!claim.source?.sourceUrl || !claim.source?.sourceTitle) return "Source not verified.";
    if (!["verified", "partially_verified"].includes(claim.verificationStatus)) return "Property evidence is not verified.";
    if (!claim.testStandard) return "Test standard unavailable.";
    if (!claim.testCondition && propertyKey) return "Test condition unavailable.";
    return "Property evidence is unverifiable.";
  }

  function evidenceSourceFor(claim) {
    if (!claim?.source?.sourceTitle && !claim?.source?.sourceUrl) return null;
    return {
      sourceType: claim.source.sourceType || "unknown",
      sourceTitle: claim.source.sourceTitle || null,
      sourceUrl: claim.source.sourceUrl || null,
      sourceDate: claim.source.sourceDate || null
    };
  }

  function formatClaimValue(claim) {
    if (!claim || claim.value === null || claim.value === undefined || claim.value === "") return null;
    return `${claim.value}${claim.unit ? ` ${claim.unit}` : ""}`;
  }

  function isCriticalCriterion(criterionId, parsedRequirement) {
    if (["heat", "strength"].includes(criterionId) && numericConstraintFor(criterionId, parsedRequirement.hardConstraints) !== null) return true;
    return (parsedRequirement.sources || []).some((source) =>
      source.id === criterionId &&
      (source.source === "keyword" || String(source.source || "").startsWith("numeric"))
    );
  }

  function numericConstraintFor(criterionId, hardConstraints) {
    if (criterionId === "heat") return hardConstraints.minimumTemperatureC;
    if (criterionId === "hdt") return hardConstraints.minimumHdtC;
    if (criterionId === "strength") return hardConstraints.minimumTensileMpa;
    return null;
  }

  function calculateEvidenceScore(results, confidence) {
    if (!results.length || confidence === "quarantined") return 0;
    const statusWeights = {
      satisfied: 1,
      unknown: 0,
      unverifiable: 0,
      not_satisfied: 0
    };
    const qualityWeights = { high: 1, medium: 0.72, low: 0.3, quarantined: 0 };
    const conditionScore = results.reduce((sum, result) => sum + statusWeights[result.status], 0) / results.length;
    const sourceCoverage = results.filter((result) => result.evidenceSource?.sourceUrl).length / results.length;
    const knownCoverage = results.filter((result) => !["unknown", "unverifiable"].includes(result.status)).length / results.length;
    return Math.round((conditionScore * 0.55 + sourceCoverage * 0.2 + knownCoverage * 0.1 + (qualityWeights[confidence] || 0) * 0.15) * 100);
  }

  function createEmptyGroups() {
    return {
      verifiedMatches: [],
      potentialMatches: [],
      rejectedMaterials: []
    };
  }

  function createLocalRecommendationProvider() {
    return {
      id: "evidence-rules-v3",
      async recommend({ description, materials, limit = 5 }) {
        const gradeMaterials = materials.filter((item) =>
          item?.entityType !== "polymer_family" &&
          item?.record_type !== "polymer_family"
        );
        const trimmed = description.trim();
        const parsedRequirement = parseRequirement(trimmed);
        const emptyGroups = createEmptyGroups();
        if (!trimmed) {
          return {
            provider: this.id,
            query: "",
            criteria: [],
            parsedRequirement,
            recommendations: [],
            groups: emptyGroups,
            status: "empty",
            eligibleMaterialCount: 0
          };
        }

        if (
          !parsedRequirement.criteria.length &&
          !parsedRequirement.certificationRequirements?.length
        ) {
          return {
            provider: this.id,
            query: trimmed,
            criteria: [],
            parsedRequirement,
            recommendations: [],
            groups: emptyGroups,
            status: "needs_clarification",
            eligibleMaterialCount: gradeMaterials.filter((item) => item.data_quality?.recommendation_eligible).length
          };
        }

        const evaluated = gradeMaterials
          .map((item) => evaluateEvidenceRecommendation(item, parsedRequirement))
          .sort((left, right) => right.score - left.score || left.material.name.localeCompare(right.material.name));
        const groups = {
          verifiedMatches: evaluated.filter((entry) => entry.bucket === "verified").slice(0, limit),
          potentialMatches: evaluated.filter((entry) => entry.bucket === "potential").slice(0, limit),
          rejectedMaterials: evaluated.filter((entry) => entry.bucket === "rejected").slice(0, limit)
        };
        const recommendations = [...groups.verifiedMatches, ...groups.potentialMatches];

        return {
          provider: this.id,
          query: trimmed,
          criteria: parsedRequirement.requirements,
          parsedRequirement,
          recommendations,
          groups,
          status: groups.verifiedMatches.length
            ? "verified_matches"
            : groups.potentialMatches.length
              ? "potential_matches"
              : "no_safe_match",
          eligibleMaterialCount: gradeMaterials.filter((item) => item.data_quality?.recommendation_eligible).length,
          referenceMaterialCount: gradeMaterials.filter((item) => item.data_quality?.reference_only).length,
          quarantinedMaterialCount: gradeMaterials.filter((item) => item.data_quality?.level === "quarantined").length
        };
      }
    };
  }

  function createOpenAIRecommendationProviderPlaceholder() {
    return {
      id: "openai-provider-placeholder",
      async recommend() {
        throw new Error("OpenAI recommendation provider is not configured. Local recommendation uses the local provider.");
      }
    };
  }

  function createRecommendationService({ provider = createLocalRecommendationProvider(), materials = [] } = {}) {
    return {
      provider,
      async recommend(description, options = {}) {
        return provider.recommend({
          description,
          materials,
          limit: options.limit || 5
        });
      }
    };
  }

  window.MatFinderAI = {
    createLocalRecommendationProvider,
    createOpenAIRecommendationProviderPlaceholder,
    createRecommendationService,
    parseRequirement,
    scoreMaterial,
    extractCriteria,
    evaluateEvidenceRecommendation
  };

  function extractCertificationRequirements(query) {
    const text = String(query || "");
    return certificationRequirementDefinitions
      .filter((definition) => definition.pattern.test(text))
      .map(({ code, label }) => ({ code, label }));
  }

  function extractRequestedEvidenceContext(query) {
    const text = String(query || "");
    const standard = text.match(
      /\b(?:ASTM|ISO|IEC|DIN|GB\/T|UL|SAE|JIS|EN)\s+[A-Z0-9][A-Z0-9./:+-]*/i
    );
    const condition = text.match(
      /(?:test condition|测试条件)\s*[:：]\s*([^,;，。]+)/i
    );
    const propertyKey = /tensile strength|拉伸强度|抗拉强度/i.test(text)
      ? "tensile_strength"
      : /\bhdt\b|heat (?:deflection|distortion) temperature|热变形温度/i.test(text)
        ? "hdt"
        : /\bdensity\b|密度/i.test(text)
          ? "density"
          : /continuous (?:use|service) temperature|连续使用温度|长期使用温度/i.test(text)
            ? "continuous_use_temperature"
            : null;
    return {
      testStandard: standard ? standard[0].trim() : null,
      testCondition: condition ? condition[1].trim() : null,
      propertyKey
    };
  }

  function evaluateCertificationEvidence(item, requirement) {
    const expected = normalizeCertificationName(requirement.code);
    const certifications = (item.evidence?.certifications || [])
      .filter((certification) => {
        const actual = normalizeCertificationName(certification.certificationName);
        return Boolean(actual) &&
          (actual === expected || actual.includes(expected) || expected.includes(actual));
      })
      .sort((left, right) => claimRank(right) - claimRank(left));
    const certification = certifications[0] || null;
    const source = certification?.source || certification || {};
    const base = {
      requirement: requirement.label,
      detectedConstraint: `${requirement.label} certification`,
      materialValue: certification
        ? [
            certification.certificationName,
            certification.certificationStatus,
            certification.scope
          ].filter(Boolean).join(" — ")
        : null,
      evidenceSource: certification ? evidenceSourceFor({ source }) : null,
      critical: true,
      propertyKey: null
    };
    if (!certification) {
      return {
        ...base,
        status: "unknown",
        explanation: "Independent certification evidence is unavailable."
      };
    }

    const status = String(certification.certificationStatus || "").toLowerCase();
    if (/not compliant|not certified|expired|withdrawn|failed|rejected/.test(status)) {
      return {
        ...base,
        status: "not_satisfied",
        explanation: "Independent certification evidence explicitly indicates the requirement is not met."
      };
    }
    const positiveStatus = /certified|compliant|approved|listed|meets|passed/.test(status);
    const independentlyVerified =
      certification.verificationStatus === "verified" &&
      ["high", "medium"].includes(certification.confidenceLevel) &&
      ["manufacturer", "official_datasheet"].includes(source.sourceType) &&
      Boolean(source.sourceTitle) &&
      /^https?:\/\/\S+$/i.test(String(source.sourceUrl || ""));
    if (!positiveStatus || !independentlyVerified) {
      return {
        ...base,
        status: "unverifiable",
        explanation: "A certification claim exists, but independent verified certification evidence is incomplete."
      };
    }
    return {
      ...base,
      status: "satisfied",
      explanation: "Independent verified certification evidence supports this requirement."
    };
  }

  function normalizeCertificationName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function extractHardConstraints(query) {
    const text = String(query || "");
    const constraintText = text.replace(
      /(?:test condition|测试条件)\s*[:：]\s*[^,;，。]+/gi,
      ""
    );
    const hdtMatch =
      constraintText.match(/(?:\bhdt\b|heat (?:deflection|distortion) temperature|热变形温度)[^\d-]{0,16}(-?\d+(?:\.\d+)?)\s*(?:°\s*c|℃|deg(?:rees?)?\s*c|度)?/i);
    const continuousMatch =
      constraintText.match(/(?:continuous use temperature|continuous service temperature|长期使用温度|连续使用温度)[^\d-]{0,16}(-?\d+(?:\.\d+)?)\s*(?:°\s*c|℃|deg(?:rees?)?\s*c|度)?/i);
    const genericCelsiusMatch =
      constraintText.match(/(-?\d+(?:\.\d+)?)\s*(?:°\s*c|℃|deg(?:rees?)?\s*c)\b/i) ||
      constraintText.match(/(-?\d+(?:\.\d+)?)\s*度(?:\s*(?:高温|温度|长期|连续))?/);
    const tensileMatch = constraintText.match(/(?:拉伸强度|抗拉强度|tensile strength)[^\d]{0,12}(\d+(?:\.\d+)?)\s*mpa/i)
      || constraintText.match(/(\d+(?:\.\d+)?)\s*mpa/i);
    const temperature = continuousMatch
      ? Number(continuousMatch[1])
      : hdtMatch
        ? null
        : genericCelsiusMatch
          ? Number(genericCelsiusMatch[1])
          : null;
    const hdt = hdtMatch ? Number(hdtMatch[1]) : null;
    const minimumTemperatureC = temperature !== null && temperature >= 0 ? temperature : null;
    const minimumHdtC = hdt !== null && hdt >= 0 ? hdt : null;
    const unsupportedLowTemperatureC = temperature !== null && temperature < 0 ? temperature : null;

    return {
      minimumTemperatureC,
      minimumHdtC,
      minimumTensileMpa: tensileMatch ? Number(tensileMatch[1]) : null,
      unsupportedLowTemperatureC
    };
  }

  function extractUnsupportedConstraints(query) {
    const text = String(query || "");
    const constraints = unsupportedConstraintDefinitions
      .filter((definition) => definition.patterns.some((pattern) => pattern.test(text)))
      .map(({ code, label, zh }) => ({ code, label, zh }));
    const hardConstraints = extractHardConstraints(text);
    if (hardConstraints.unsupportedLowTemperatureC !== null) {
      constraints.push({
        code: "low_temperature",
        label: `minimum low-temperature service (${hardConstraints.unsupportedLowTemperatureC} deg C)`,
        zh: `最低低温使用要求（${hardConstraints.unsupportedLowTemperatureC}°C）`
      });
    }
    return constraints;
  }

  function evaluateHardConstraints(item, parsedRequirement) {
    const failures = [];
    const constraints = parsedRequirement.hardConstraints || {};
    const maxTemperature = finiteNumber(item.maxTemp ?? item.max_temperature ?? item.continuous_use_temperature);
    const tensile = finiteNumber(item.tensile ?? item.tensile_strength);

    if (constraints.minimumTemperatureC !== null) {
      if (maxTemperature === null) {
        failures.push("continuous use temperature is missing");
      } else if (maxTemperature < constraints.minimumTemperatureC) {
        failures.push(`continuous use temperature ${maxTemperature} deg C is below required ${constraints.minimumTemperatureC} deg C`);
      }
    }
    if (constraints.minimumTensileMpa !== null) {
      if (tensile === null) {
        failures.push("tensile strength is missing");
      } else if (tensile < constraints.minimumTensileMpa) {
        failures.push(`tensile strength ${tensile} MPa is below required ${constraints.minimumTensileMpa} MPa`);
      }
    }

    const criterionIds = new Set(parsedRequirement.criteria.map((criterion) => criterion.id));
    const directlyRequestedCriteria = new Set(
      (parsedRequirement.sources || [])
        .filter((source) => source.source === "keyword" || String(source.source || "").startsWith("numeric"))
        .map((source) => source.id)
    );
    parsedRequirement.criteria.forEach((criterion) => {
      if (!directlyRequestedCriteria.has(criterion.id)) return;
      const fit = clamp(criterion.evaluate(item));
      if (fit < 0.5) {
        failures.push(`${criterion.label} does not meet the minimum directly requested fit`);
      }
    });

    if (criterionIds.has("sealing") || criterionIds.has("flexible")) {
      const text = materialText(item);
      const category = String(item.category || "").toLowerCase();
      const elongation = finiteNumber(item.elongation);
      const sealingFit =
        category.includes("elastomer") ||
        category.includes("sealant") ||
        text.includes("gasket") ||
        text.includes("o-ring") ||
        text.includes("sealing") ||
        text.includes("seal ") ||
        (elongation !== null && elongation >= 50);
      if (!sealingFit) failures.push("material does not meet the minimum flexible/sealing form check");
    }

    return failures;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
})();
