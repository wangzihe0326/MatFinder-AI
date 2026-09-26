(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MatFinderPolymerFamilies = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const RANGE_NOTICE = {
    en: "No source-reviewed numeric range has been entered. Typical family ranges must not be used as commercial-grade values.",
    zh: "尚未录入经来源复核的数值范围。材料家族典型范围不得作为具体商业牌号数值使用。"
  };

  const commonTypicalProperties = [
    "density",
    "tensile_strength",
    "glass_transition_temperature",
    "melting_temperature",
    "heat_deflection_temperature",
    "continuous_use_temperature"
  ].map((propertyKey) => ({
    propertyKey,
    range: null,
    unit: null,
    source: null,
    verificationStatus: "unverified",
    note: RANGE_NOTICE
  }));

  const families = [
    {
      familyId: "PF-ABS",
      canonicalName: "Acrylonitrile Butadiene Styrene",
      chineseName: "丙烯腈-丁二烯-苯乙烯共聚物",
      abbreviations: ["ABS"],
      polymerType: "Thermoplastic",
      description: {
        en: "A thermoplastic family made from acrylonitrile, butadiene, and styrene components.",
        zh: "由丙烯腈、丁二烯和苯乙烯组分构成的热塑性高分子材料家族。"
      },
      advantages: ["Balanced toughness and processability", "Commonly modified for appearance or impact performance"],
      limitations: ["Performance depends strongly on formulation and grade", "Weathering performance requires grade-specific verification"],
      commonApplications: ["Housings", "Consumer products", "Interior components"],
      processingMethods: ["Injection molding", "Extrusion"],
      modificationMethods: ["Impact modification", "Flame-retardant formulation", "Reinforcement"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-PC",
      canonicalName: "Polycarbonate",
      chineseName: "聚碳酸酯",
      abbreviations: ["PC"],
      polymerType: "Thermoplastic",
      description: {
        en: "A thermoplastic family whose polymer backbone contains carbonate groups.",
        zh: "分子主链含碳酸酯基团的热塑性高分子材料家族。"
      },
      advantages: ["Known for toughness", "Transparent grades are available"],
      limitations: ["Chemical compatibility is grade- and environment-dependent", "Processing and moisture control require grade-specific guidance"],
      commonApplications: ["Protective components", "Optical parts", "Electrical housings"],
      processingMethods: ["Injection molding", "Extrusion", "Thermoforming"],
      modificationMethods: ["UV stabilization", "Flame-retardant formulation", "Glass-fiber reinforcement"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-PA66",
      canonicalName: "Polyamide 66",
      chineseName: "聚酰胺66",
      abbreviations: ["PA66", "Nylon 66"],
      polymerType: "Thermoplastic",
      description: {
        en: "A polyamide family commonly identified by the 66 monomer carbon-number convention.",
        zh: "按单体碳原子数命名的聚酰胺材料家族，通常称为聚酰胺66。"
      },
      advantages: ["Mechanical and wear performance can be useful in engineering parts", "Reinforced grades are widely used"],
      limitations: ["Moisture conditioning can change properties", "All design values require grade-specific conditioning and test evidence"],
      commonApplications: ["Mechanical components", "Electrical parts", "Under-hood components"],
      processingMethods: ["Injection molding", "Extrusion"],
      modificationMethods: ["Glass-fiber reinforcement", "Impact modification", "Heat stabilization"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-POM",
      canonicalName: "Polyoxymethylene",
      chineseName: "聚甲醛",
      abbreviations: ["POM", "Acetal"],
      polymerType: "Thermoplastic",
      description: {
        en: "An acetal thermoplastic family based on repeating oxymethylene units.",
        zh: "以重复氧亚甲基单元为基础的缩醛类热塑性高分子材料家族。"
      },
      advantages: ["Often selected for dimensional and sliding applications", "Good processability for precision parts"],
      limitations: ["Chemical and thermal limits must be checked for the exact grade", "Combustion and processing controls require supplier guidance"],
      commonApplications: ["Gears", "Bearings", "Precision mechanisms"],
      processingMethods: ["Injection molding", "Extrusion"],
      modificationMethods: ["Lubricated formulation", "Impact modification", "Reinforcement"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-PP",
      canonicalName: "Polypropylene",
      chineseName: "聚丙烯",
      abbreviations: ["PP"],
      polymerType: "Thermoplastic",
      description: {
        en: "A polyolefin thermoplastic family produced from propylene.",
        zh: "以丙烯为单体制得的聚烯烃热塑性高分子材料家族。"
      },
      advantages: ["Low-density family", "Broad processing and modification options"],
      limitations: ["Impact, weathering, and heat performance vary substantially by grade", "Compliance claims require independent grade-level evidence"],
      commonApplications: ["Packaging", "Household products", "Automotive components"],
      processingMethods: ["Injection molding", "Extrusion", "Blow molding", "Thermoforming"],
      modificationMethods: ["Mineral filling", "Glass-fiber reinforcement", "Impact modification", "UV stabilization"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-PEEK",
      canonicalName: "Polyether Ether Ketone",
      chineseName: "聚醚醚酮",
      abbreviations: ["PEEK"],
      polymerType: "High-performance thermoplastic",
      description: {
        en: "An aromatic high-performance thermoplastic family containing ether and ketone linkages.",
        zh: "主链含芳香环、醚键和酮键的高性能热塑性高分子材料家族。"
      },
      advantages: ["Designed for demanding thermal and mechanical environments", "Reinforced and unreinforced grades exist"],
      limitations: ["Processing requirements are demanding", "Suitability and compliance must be established from the exact grade evidence"],
      commonApplications: ["Aerospace components", "Electrical components", "Industrial parts"],
      processingMethods: ["Injection molding", "Extrusion", "Compression molding"],
      modificationMethods: ["Carbon-fiber reinforcement", "Glass-fiber reinforcement", "Bearing formulations"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    },
    {
      familyId: "PF-TPU",
      canonicalName: "Thermoplastic Polyurethane",
      chineseName: "热塑性聚氨酯弹性体",
      abbreviations: ["TPU"],
      polymerType: "Thermoplastic elastomer",
      description: {
        en: "A thermoplastic elastomer family based on polyurethane chemistry.",
        zh: "基于聚氨酯化学体系的热塑性弹性体材料家族。"
      },
      advantages: ["Elastic grades with thermoplastic processing are available", "Formulations cover different hardness and application needs"],
      limitations: ["Hydrolysis, weathering, and temperature behavior depend on chemistry and grade", "Hardness alone does not establish full performance"],
      commonApplications: ["Flexible components", "Cable jackets", "Seals", "Footwear"],
      processingMethods: ["Injection molding", "Extrusion"],
      modificationMethods: ["Hardness adjustment", "Hydrolysis stabilization", "UV stabilization", "Reinforcement"],
      typicalProperties: commonTypicalProperties,
      learningSources: [],
      verificationStatus: "unverified"
    }
  ].map((family) => ({
    ...family,
    entityType: "polymer_family",
    recommendationEligible: false,
    typicalRangeWarning: RANGE_NOTICE
  }));

  const thermalTerms = {
    tg: {
      label: "Tg",
      en: "Glass transition temperature describes a transition in amorphous regions; it is not a melting temperature or a load-bearing limit.",
      zh: "Tg（玻璃化转变温度）描述非晶区域的转变，不等同于熔点，也不等同于承载条件下的耐热上限。"
    },
    tm: {
      label: "Tm",
      en: "Melting temperature applies to crystalline regions; fully amorphous polymers do not have a crystalline melting point.",
      zh: "Tm（熔融温度）对应结晶区域的熔融；完全非晶聚合物不存在结晶熔点。"
    },
    hdt: {
      label: "HDT",
      en: "Heat deflection temperature is a test result measured under a specified load and method, so the standard and condition are essential.",
      zh: "HDT（热变形温度）是在规定载荷和方法下得到的测试结果，因此测试标准与条件不可缺失。"
    }
  };

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function matchesFamily(family, rawQuery) {
    const query = normalize(rawQuery);
    if (!query) return true;
    const identityTokens = new Set([
      family.canonicalName,
      family.chineseName,
      ...(family.abbreviations || [])
    ].flatMap((value) => normalize(value).split(/[^a-z0-9\u3400-\u9fff]+/i)).filter(Boolean));
    if (/^[a-z0-9+.-]{1,6}$/i.test(query)) return identityTokens.has(query);
    const text = normalize([
      family.canonicalName,
      family.chineseName,
      ...(family.abbreviations || []),
      family.polymerType,
      family.description?.en,
      family.description?.zh,
      ...(family.commonApplications || [])
    ].join(" "));
    return query.split(/\s+/).every((token) => text.includes(token));
  }

  return { families, thermalTerms, matchesFamily, RANGE_NOTICE };
});
