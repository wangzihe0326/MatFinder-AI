const GENERATED_SOURCE_TYPES = new Set([
  "generated_reference_catalog",
  "generated_commercial_catalog"
]);

const CATEGORY_LIMITS = {
  Plastics: { density: [0.4, 3], tensile: [0, 600], maxTemperature: [-100, 400], meltingTemperature: [-100, 500] },
  Elastomers: { density: [0.5, 3], tensile: [0, 120], maxTemperature: [-100, 350], meltingTemperature: [-150, 450] },
  Thermosets: { density: [0.5, 4], tensile: [0, 500], maxTemperature: [-100, 500], meltingTemperature: null },
  Adhesives: { density: [0.3, 4], tensile: [0, 300], maxTemperature: [-100, 400], meltingTemperature: null },
  Sealants: { density: [0.3, 4], tensile: [0, 120], maxTemperature: [-100, 400], meltingTemperature: null },
  Foams: { density: [0.005, 2], tensile: [0, 150], maxTemperature: [-200, 500], meltingTemperature: [-200, 500] },
  Fibers: { density: [0.5, 25], tensile: [0, 8000], maxTemperature: [-200, 2500], meltingTemperature: [-200, 4000] },
  Composites: { density: [0.05, 25], tensile: [0, 5000], maxTemperature: [-200, 2500], meltingTemperature: [-200, 4000] },
  Coatings: { density: [0.1, 10], tensile: [0, 1000], maxTemperature: [-200, 1500], meltingTemperature: [-200, 4000] },
  Ceramics: { density: [0.1, 25], tensile: [0, 5000], maxTemperature: [-200, 3500], meltingTemperature: [-200, 5000] },
  Metals: { density: [0.1, 25], tensile: [0, 5000], maxTemperature: [-200, 2500], meltingTemperature: [-200, 4000] }
};

function assessMaterialQuality(material) {
  const sources = Array.isArray(material.sources) ? material.sources : [];
  const sourceTypes = sources.map((source) => String(source.source_type || "").toLowerCase());
  const externalSources = sources.filter((source) => /^https?:\/\//i.test(String(source.source_url || "")));
  const generated = sourceTypes.some((sourceType) => GENERATED_SOURCE_TYPES.has(sourceType));
  const manufacturerBacked = sourceTypes.includes("manufacturer_manual");
  const evidenceText = [
    material.test_method,
    material.test_standard,
    material.specimen_condition,
    material.conditioning,
    ...sources.flatMap((source) => [
      source.test_method,
      source.test_standard,
      source.specimen_condition,
      source.notes
    ])
  ]
    .filter(Boolean)
    .join(" ");
  const hasTestConditions =
    /\b(?:ASTM|ISO|IEC|DIN|GB\/?T|UL)\s*[-A-Z0-9]*/i.test(evidenceText) &&
    /(?:test|method|specimen|condition|temperature|试验|测试|试样|条件|温度)/i.test(evidenceText);
  const issues = [];

  if (!sources.length) issues.push(issue("missing_source", "No source record is attached.", "缺少来源记录。"));
  if (!externalSources.length) issues.push(issue("no_external_source", "No external source can be opened.", "没有可打开的外部来源。"));
  if (generated) {
    issues.push(
      issue(
        "generated_record",
        "This is a generated screening record, not a verified supplier grade.",
        "这是程序生成的筛选记录，不是已核实的供应商牌号。"
      )
    );
  }
  if (!hasTestConditions) {
    issues.push(
      issue(
        "missing_test_conditions",
        "No test standard, specimen condition, and test temperature are attached to the numeric values.",
        "数值没有附带测试标准、试样状态和测试温度，不能直接用于设计放行。"
      )
    );
  }

  const limits = CATEGORY_LIMITS[material.category];
  if (limits) {
    checkRange(issues, "density", material.density, limits.density, "density");
    checkRange(issues, "tensile", material.tensile ?? material.tensile_strength, limits.tensile, "tensile strength");
    checkRange(
      issues,
      "max_temperature",
      material.maxTemp ?? material.max_temperature ?? material.continuous_use_temperature,
      limits.maxTemperature,
      "continuous use temperature"
    );
    if (limits.meltingTemperature) {
      checkRange(
        issues,
        "melting_temperature",
        material.tm ?? material.melting_temperature,
        limits.meltingTemperature,
        "melting temperature"
      );
    }
  }

  const maxTemperature = finiteNumber(
    material.maxTemp ?? material.max_temperature ?? material.continuous_use_temperature
  );
  const meltingTemperature = finiteNumber(material.tm ?? material.melting_temperature);
  if (
    ["Plastics", "Elastomers", "Foams"].includes(material.category) &&
    maxTemperature !== null &&
    meltingTemperature !== null &&
    maxTemperature > meltingTemperature + 25
  ) {
    issues.push(
      issue(
        "temperature_inconsistency",
        "Continuous use temperature is implausibly above the listed melting temperature.",
        "连续使用温度明显高于所列熔点，数据相互矛盾。"
      )
    );
  }

  if (
    ["Plastics", "Elastomers"].includes(material.category) &&
    /noncombustible/i.test(String(material.flammability || material.flame_rating || ""))
  ) {
    issues.push(
      issue(
        "flammability_inconsistency",
        "A polymer record is marked noncombustible and requires correction.",
        "高分子材料被标记为不可燃，需要校正。"
      )
    );
  }

  const blockingIssues = issues.filter((entry) =>
    ["density_out_of_range", "tensile_out_of_range", "max_temperature_out_of_range", "melting_temperature_out_of_range", "temperature_inconsistency", "flammability_inconsistency"].includes(entry.code)
  );
  const recommendationEligible = !generated && externalSources.length > 0 && blockingIssues.length === 0;
  const supplier = String(material.supplier_or_brand || material.manufacturer || "").toLowerCase();
  const grade = String(material.grade_name || material.trade_name || "").toLowerCase();
  const hasSpecificCommercialIdentity =
    supplier &&
    grade &&
    !supplier.includes("generic") &&
    !grade.includes("generic") &&
    !grade.includes("screening");
  const factoryReady = recommendationEligible && manufacturerBacked && hasSpecificCommercialIdentity;

  let level = "low";
  if (blockingIssues.length) level = "rejected";
  else if (generated) level = "synthetic";
  else if (factoryReady) level = "high";
  else if (recommendationEligible) level = "medium";

  return {
    level,
    recommendation_eligible: recommendationEligible,
    factory_ready: factoryReady,
    generated,
    source_count: sources.length,
    external_source_count: externalSources.length,
    primary_source_type: sourceTypes[0] || "unknown",
    manufacturer_backed: manufacturerBacked,
    has_test_conditions: hasTestConditions,
    issues
  };
}

function annotateMaterialQuality(material) {
  return {
    ...material,
    data_quality: assessMaterialQuality(material)
  };
}

function checkRange(issues, field, value, range, label) {
  const number = finiteNumber(value);
  if (number === null || !range) return;
  if (number < range[0] || number > range[1]) {
    issues.push(
      issue(
        `${field}_out_of_range`,
        `${label} (${number}) is outside the plausible range for this material category.`,
        `${label}（${number}）超出该材料类别的合理范围。`
      )
    );
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function issue(code, en, zh) {
  return { code, en, zh };
}

module.exports = {
  GENERATED_SOURCE_TYPES,
  assessMaterialQuality,
  annotateMaterialQuality
};
