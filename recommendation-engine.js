(function () {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const normalize = (value, min, max) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
    return clamp((Number(value) - min) / (max - min));
  };
  const requirementParseCache = new Map();
  const scoreCache = new Map();

  const zh = {
    lightweight: ["\u8f7b\u91cf", "\u4f4e\u5bc6\u5ea6", "\u8f7b\u8d28", "\u51cf\u91cd"],
    heat: ["\u8010\u70ed", "\u9ad8\u6e29", "\u6e29\u5ea6", "\u70ed"],
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

    const parsed = [...matches.values()].sort((a, b) => {
      const aIndex = priority.indexOf(a.criterion.id);
      const bIndex = priority.indexOf(b.criterion.id);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    const criteria = parsed.map((entry) => entry.criterion);
    const parsedRequirement = {
      query,
      requirements: criteria.map((criterion) => criterion.label),
      criteria,
      sources: parsed.map((entry) => ({ id: entry.criterion.id, label: entry.criterion.label, source: entry.source }))
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
    const criteria = parsedRequirement.criteria;
    const similarity = textSimilarity(`${description} ${parsedRequirement.requirements.join(" ")}`, item);

    if (!criteria.length) {
      const fallbackScore = Math.round(clamp(0.35 + similarity * 0.65) * 100);
      const fallbackResult = {
        material: item,
        score: fallbackScore,
        reasons: similarity > 0 ? ["closest local text match"] : ["balanced fallback from local dataset"],
        warnings: ["no recognized requirement terms; ranked by local text similarity"],
        matchedCriteria: []
      };
      scoreCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }

    let weightedTotal = 0;
    let maxTotal = 0;
    const reasonCandidates = [];
    const warningCandidates = [];
    let matchedCount = 0;

    criteria.forEach((criterion) => {
      const fit = clamp(criterion.evaluate(item));
      const contribution = fit * criterion.weight;
      weightedTotal += contribution;
      maxTotal += criterion.weight;
      if (fit >= 0.58) {
        matchedCount += 1;
        reasonCandidates.push({
          fit,
          text: criterion.reason(item),
          label: criterion.label
        });
      }
      if (fit < 0.5) {
        warningCandidates.push({
          fit,
          text: typeof criterion.warning === "function" ? criterion.warning(item) : criterionWarning(criterion),
          label: criterion.label
        });
      }
    });

    const criteriaScore = weightedTotal / maxTotal;
    const coverageBonus = (matchedCount / criteria.length) * 0.08;
    const warningPenalty = (warningCandidates.length / criteria.length) * 0.12;
    const finalScore = Math.round(clamp(criteriaScore * 0.82 + similarity * 0.1 + coverageBonus - warningPenalty) * 100);
    const reasons = reasonCandidates
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 3)
      .map((reason) => reason.text);
    const warnings = warningCandidates
      .sort((a, b) => a.fit - b.fit)
      .slice(0, 3)
      .map((warning) => warning.text);

    if (!reasons.length) reasons.push("partial match against stated requirements");
    if (!warnings.length) warnings.push("no major unmatched requirement warnings");

    const result = {
      material: item,
      score: finalScore,
      reasons,
      warnings,
      matchedCriteria: parsedRequirement.requirements
    };
    scoreCache.set(cacheKey, result);
    return result;
  }

  function enforceUniqueDescendingScores(recommendations) {
    let previousScore = 101;
    return recommendations.map((entry) => {
      const score = Math.max(0, Math.min(entry.score, previousScore - 1));
      previousScore = score;
      return { ...entry, score };
    });
  }

  function createLocalRecommendationProvider() {
    return {
      id: "local-rules-v2",
      async recommend({ description, materials, limit = 5 }) {
        const trimmed = description.trim();
        const parsedRequirement = parseRequirement(trimmed);
        if (!trimmed) {
          return {
            provider: this.id,
            query: "",
            criteria: [],
            parsedRequirement,
            recommendations: []
          };
        }

        const recommendations = enforceUniqueDescendingScores(
          materials
          .map((item) => scoreMaterial(trimmed, item))
          .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
          .slice(0, limit)
        );

        return {
          provider: this.id,
          query: trimmed,
          criteria: parsedRequirement.requirements,
          parsedRequirement,
          recommendations
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
    extractCriteria
  };
})();
