(function () {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const normalize = (value, min, max) => clamp((value - min) / (max - min));

  const synonymGroups = [
    {
      id: "lightweight",
      label: "lightweight",
      weight: 1.15,
      keywords: ["lightweight", "light weight", "low density", "weight saving", "light", "lighter", "轻量", "低密度", "轻质", "减重"],
      evaluate: (item) => {
        if (item.density <= 1) return 1;
        if (item.density <= 1.25) return 0.85;
        if (item.density <= 1.4) return 0.68;
        if (item.density <= 1.8) return 0.35;
        return 0.1;
      },
      reason: (item) => `low density (${item.density} g/cm3)`
    },
    {
      id: "heat",
      label: "heat resistance",
      weight: 1.25,
      keywords: ["heat", "hot", "thermal", "temperature", "high temp", "heat-resistant", "heat resistant", "耐热", "高温", "温度", "热"],
      evaluate: (item) => normalize(item.maxTemp, 70, 260),
      reason: (item) => `continuous use up to ${item.maxTemp} deg C`
    },
    {
      id: "electrical",
      label: "electrical insulation",
      weight: 1.1,
      keywords: ["electrical", "electric", "insulating", "insulation", "dielectric", "electronics", "connector", "电绝缘", "绝缘", "介电", "电气", "电子", "连接器"],
      evaluate: (item) => {
        const text = materialText(item);
        const explicitFit =
          text.includes("electrical insulation") ||
          text.includes("insulator") ||
          text.includes("connector") ||
          text.includes("electronic") ||
          text.includes("cable");
        return clamp(0.5 + (explicitFit ? 0.3 : 0) + normalize(item.dielectric, 2.1, 8.4) * 0.2);
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
      keywords: ["strong", "strength", "load", "structural", "stiff", "rigid", "mechanical", "强度", "高强", "承载", "结构", "刚性", "机械"],
      evaluate: (item) => normalize(item.tensile, 10, 120),
      reason: (item) => `tensile strength of ${item.tensile} MPa`
    },
    {
      id: "chemical",
      label: "chemical resistance",
      weight: 1.15,
      keywords: ["chemical", "solvent", "corrosion", "acid", "alkali", "fluid", "fuel", "化学", "耐腐蚀", "溶剂", "酸", "碱", "燃油"],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("chemical resistant") || text.includes("fluoropolymer") ? 1 : 0.35;
      },
      reason: () => "strong chemical resistance profile"
    },
    {
      id: "transparent",
      label: "transparency",
      weight: 1,
      keywords: ["transparent", "clear", "optical", "clarity", "window", "lens", "透明", "光学", "透光", "窗口", "镜片"],
      evaluate: (item) => (positiveMaterialText(item).includes("transparent") || positiveMaterialText(item).includes("optical") ? 1 : 0.15),
      reason: () => "transparent or optical-use material"
    },
    {
      id: "impact",
      label: "impact resistance",
      weight: 1,
      keywords: ["impact", "tough", "shock", "protective", "drop", "抗冲击", "冲击", "韧性", "防护", "跌落"],
      evaluate: (item) => {
        const text = positiveMaterialText(item);
        return text.includes("impact resistant") || text.includes("tough") || text.includes("protective") ? 1 : 0.25;
      },
      reason: () => "good toughness or impact resistance"
    },
    {
      id: "flexible",
      label: "flexibility",
      weight: 0.95,
      keywords: ["flexible", "soft", "elastic", "rubber", "elastomer", "stretch", "seal", "gasket", "柔性", "柔软", "弹性", "橡胶", "密封", "垫圈"],
      evaluate: (item) => {
        const text = materialText(item);
        const tagScore = text.includes("elastomer") || text.includes("flexible") || text.includes("rubber") ? 0.65 : 0.1;
        return clamp(tagScore + normalize(item.elongation, 50, 750) * 0.35);
      },
      reason: (item) => `flexible behavior with ${item.elongation}% elongation`
    },
    {
      id: "wear",
      label: "wear resistance",
      weight: 0.95,
      keywords: ["wear", "abrasion", "friction", "bearing", "gear", "sliding", "耐磨", "摩擦", "轴承", "齿轮", "滑动"],
      evaluate: (item) => {
        const text = materialText(item);
        if (text.includes("low friction") || text.includes("wear resistant")) return 1;
        if (text.includes("bearing") || text.includes("gear")) return 0.75;
        return 0.2;
      },
      reason: () => "wear or low-friction use profile"
    },
    {
      id: "weather",
      label: "weather resistance",
      weight: 0.9,
      keywords: ["weather", "outdoor", "uv", "ozone", "sunlight", "耐候", "户外", "紫外", "臭氧", "阳光"],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("weather resistant") || text.includes("ozone resistant") ? 1 : 0.25;
      },
      reason: () => "weathering resistance is represented in the dataset"
    },
    {
      id: "flame",
      label: "flame resistance",
      weight: 0.95,
      keywords: ["flame", "fire", "self extinguishing", "flame retardant", "阻燃", "防火", "自熄"],
      evaluate: (item) => (materialText(item).includes("flame retardant") ? 1 : 0.2),
      reason: () => "flame-retardant profile"
    },
    {
      id: "sustainable",
      label: "sustainability",
      weight: 0.85,
      keywords: ["sustainable", "recyclable", "recycled", "bio", "compostable", "renewable", "可持续", "可回收", "生物基", "可堆肥", "可再生"],
      evaluate: (item) => (item.recyclable ? 0.75 : 0.15) + (materialText(item).includes("bio-based") ? 0.25 : 0),
      reason: (item) => (item.recyclable ? "recyclable material family" : "bio-based or specialty sustainability fit")
    },
    {
      id: "medical",
      label: "medical suitability",
      weight: 0.85,
      keywords: ["medical", "implant", "biocompatible", "sterilizable", "sterile", "医疗", "植入", "生物相容", "灭菌", "无菌"],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("medical") || text.includes("biocompatible") || text.includes("sterilizable") ? 1 : 0.2;
      },
      reason: () => "medical-related uses are present in the local dataset"
    },
    {
      id: "food",
      label: "food contact",
      weight: 0.75,
      keywords: ["food", "food contact", "packaging", "bottle", "食品", "食品接触", "包装", "瓶"],
      evaluate: (item) => {
        const text = materialText(item);
        return text.includes("food") || text.includes("packaging") || text.includes("bottle") ? 1 : 0.25;
      },
      reason: () => "common food or packaging applications"
    }
  ];

  function materialText(item) {
    return [item.name, item.abbr, item.category, item.summary, item.notes, ...item.tags, ...item.uses]
      .join(" ")
      .toLowerCase();
  }

  function positiveMaterialText(item) {
    return [item.name, item.abbr, item.category, item.summary, ...item.tags, ...item.uses].join(" ").toLowerCase();
  }

  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9.+\-\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2);
  }

  function extractCriteria(description) {
    const text = description.toLowerCase();
    return synonymGroups.filter((group) => group.keywords.some((keyword) => text.includes(keyword)));
  }

  function textSimilarity(description, item) {
    const queryTokens = tokenize(description);
    if (!queryTokens.length) return 0;
    const searchable = materialText(item);
    const hits = queryTokens.filter((token) => searchable.includes(token)).length;
    return hits / queryTokens.length;
  }

  function scoreMaterial(description, item) {
    const criteria = extractCriteria(description);
    const similarity = textSimilarity(description, item);

    if (!criteria.length) {
      const fallbackScore = Math.round(clamp(0.35 + similarity * 0.65) * 100);
      return {
        material: item,
        score: fallbackScore,
        reasons: similarity > 0 ? ["closest local text match"] : ["balanced fallback from local dataset"],
        matchedCriteria: []
      };
    }

    let weightedTotal = 0;
    let maxTotal = 0;
    const reasonCandidates = [];

    criteria.forEach((criterion) => {
      const fit = clamp(criterion.evaluate(item));
      const contribution = fit * criterion.weight;
      weightedTotal += contribution;
      maxTotal += criterion.weight;
      if (fit >= 0.52) {
        reasonCandidates.push({
          fit,
          text: criterion.reason(item),
          label: criterion.label
        });
      }
    });

    const criteriaScore = weightedTotal / maxTotal;
    const finalScore = Math.round(clamp(criteriaScore * 0.88 + similarity * 0.12) * 100);
    const reasons = reasonCandidates
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 3)
      .map((reason) => reason.text);

    if (!reasons.length) {
      reasons.push("partial match against stated requirements");
    }

    return {
      material: item,
      score: finalScore,
      reasons,
      matchedCriteria: criteria.map((criterion) => criterion.label)
    };
  }

  function createLocalRecommendationProvider() {
    return {
      id: "local-rules-v1",
      async recommend({ description, materials, limit = 5 }) {
        const trimmed = description.trim();
        if (!trimmed) {
          return {
            provider: this.id,
            query: "",
            criteria: [],
            recommendations: []
          };
        }

        const recommendations = materials
          .map((item) => scoreMaterial(trimmed, item))
          .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
          .slice(0, limit);

        return {
          provider: this.id,
          query: trimmed,
          criteria: extractCriteria(trimmed).map((criterion) => criterion.label),
          recommendations
        };
      }
    };
  }

  function createOpenAIRecommendationProviderPlaceholder() {
    return {
      id: "openai-provider-placeholder",
      async recommend() {
        throw new Error("OpenAI recommendation provider is not configured. Phase 1 uses the local provider only.");
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
    scoreMaterial,
    extractCriteria
  };
})();
