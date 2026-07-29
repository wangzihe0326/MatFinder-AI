const {
  PROPERTY_DEFINITIONS,
  buildLegacyEvidence,
  finiteNumber
} = require("./evidence-model");

const CATEGORY_LIMITS = {
  Plastics: { density: [0.4, 3], tensile_strength: [0, 600], continuous_use_temperature: [-100, 400], melting_temperature: [-100, 500], hdt: [-100, 400] },
  Elastomers: { density: [0.5, 3], tensile_strength: [0, 120], continuous_use_temperature: [-100, 350], melting_temperature: [-150, 450], hdt: null },
  Thermosets: { density: [0.5, 4], tensile_strength: [0, 500], continuous_use_temperature: [-100, 500], melting_temperature: null, hdt: [-100, 500] },
  Adhesives: { density: [0.3, 4], tensile_strength: [0, 300], continuous_use_temperature: [-100, 400], melting_temperature: null, hdt: null },
  Sealants: { density: [0.3, 4], tensile_strength: [0, 120], continuous_use_temperature: [-100, 400], melting_temperature: null, hdt: null },
  Foams: { density: [0.005, 2], tensile_strength: [0, 150], continuous_use_temperature: [-200, 500], melting_temperature: [-200, 500], hdt: [-200, 500] },
  Fibers: { density: [0.5, 25], tensile_strength: [0, 8000], continuous_use_temperature: [-200, 2500], melting_temperature: [-200, 4000], hdt: null },
  Composites: { density: [0.05, 25], tensile_strength: [0, 5000], continuous_use_temperature: [-200, 2500], melting_temperature: [-200, 4000], hdt: [-200, 2500] },
  Coatings: { density: [0.1, 10], tensile_strength: [0, 1000], continuous_use_temperature: [-200, 1500], melting_temperature: [-200, 4000], hdt: null },
  Ceramics: { density: [0.1, 25], tensile_strength: [0, 5000], continuous_use_temperature: [-200, 3500], melting_temperature: [-200, 5000], hdt: null },
  Metals: { density: [0.1, 25], tensile_strength: [0, 5000], continuous_use_temperature: [-200, 2500], melting_temperature: [-200, 4000], hdt: null }
};

const KEY_PROPERTIES = [
  "density",
  "tensile_strength",
  "hdt",
  "continuous_use_temperature"
];

function assessMaterialQuality(material) {
  const evidence = material.evidence || buildLegacyEvidence(material);
  const identity = evidence.identity || {};
  const materialSources = identity.sources || [];
  const propertyClaims = Object.values(evidence.properties || {}).flat();
  const allSources = [
    ...materialSources,
    ...propertyClaims.map((claim) => claim.source || {})
  ];
  const sourceTypes = allSources.map((source) => source.sourceType || "unknown");
  const generated = sourceTypes.includes("generated") ||
    propertyClaims.some((claim) => claim.valueType === "estimated" && claim.verificationStatus === "quarantined");
  const hasConfirmedIdentity = Boolean(identity.manufacturer && identity.commercialGrade);
  const officialSources = allSources.filter((source) =>
    ["manufacturer", "official_datasheet"].includes(source.sourceType) &&
    hasValue(source.sourceTitle) &&
    validHttpUrl(source.sourceUrl)
  );
  const officialIdentitySources = materialSources.filter((source) =>
    ["manufacturer", "official_datasheet"].includes(source.sourceType) &&
    source.verificationStatus === "verified" &&
    hasValue(source.sourceTitle) &&
    validHttpUrl(source.sourceUrl)
  );
  const reliableSources = allSources.filter((source) =>
    ["manufacturer", "official_datasheet", "academic", "distributor"].includes(source.sourceType) &&
    hasValue(source.sourceTitle) &&
    validHttpUrl(source.sourceUrl)
  );
  const externalSources = allSources.filter((source) => validHttpUrl(source.sourceUrl));
  const issues = [];

  if (generated) {
    issues.push(issue(
      "generated_record",
      "Generated or estimated catalog data cannot establish a real commercial grade.",
      "程序生成或估算的目录数据不能证明真实商业牌号。"
    ));
  }
  if (!identity.manufacturer) {
    issues.push(issue(
      "manufacturer_unconfirmed",
      "Manufacturer identity is not confirmed.",
      "制造商身份尚未确认。"
    ));
  }
  if (!identity.commercialGrade) {
    issues.push(issue(
      "commercial_grade_unconfirmed",
      "Commercial grade is not confirmed.",
      "商业牌号尚未确认。"
    ));
  }
  if (!externalSources.length) {
    issues.push(issue(
      "source_not_verified",
      "No verifiable external evidence URL is attached.",
      "没有附带可核验的外部证据链接。"
    ));
  }

  const physicalIssues = physicalConflictIssues(material, evidence);
  issues.push(...physicalIssues);
  const conflictIssues = evidenceConflictIssues(evidence);
  issues.push(...conflictIssues);

  const keyClaims = KEY_PROPERTIES.map((propertyKey) => ({
    propertyKey,
    claims: evidence.properties?.[propertyKey] || []
  }));
  const completeKeyClaims = keyClaims.filter(({ claims }) =>
    claims.some(isCompleteOfficialPropertyClaim)
  );
  const sourcedKeyClaims = keyClaims.filter(({ claims }) =>
    claims.some(isReliablySourcedPropertyClaim)
  );
  const claimsWithTestConditions = propertyClaims.filter((claim) =>
    hasValue(claim.testStandard) && hasValue(claim.testCondition)
  );

  propertyClaims.forEach((claim) => {
    if (!hasValue(claim.value)) return;
    if (!hasValue(claim.testStandard)) {
      issues.push(issue(
        `missing_test_standard:${claim.propertyKey}`,
        `${propertyLabel(claim.propertyKey)} has no test standard.`,
        `${propertyLabel(claim.propertyKey)} 缺少测试标准。`
      ));
    }
    if (!hasValue(claim.testCondition)) {
      issues.push(issue(
        `missing_test_condition:${claim.propertyKey}`,
        `${propertyLabel(claim.propertyKey)} has no test condition.`,
        `${propertyLabel(claim.propertyKey)} 缺少测试条件。`
      ));
    }
    if (!validHttpUrl(claim.source?.sourceUrl)) {
      issues.push(issue(
        `missing_property_source:${claim.propertyKey}`,
        `${propertyLabel(claim.propertyKey)} has no verified property-level source URL.`,
        `${propertyLabel(claim.propertyKey)} 缺少已验证的物性级来源链接。`
      ));
    }
  });

  const seriousConflict = physicalIssues.length > 0 || conflictIssues.length > 0;
  let level = "low";
  let verificationStatus = "unverified";

  if (generated || !hasConfirmedIdentity || seriousConflict) {
    level = "quarantined";
    verificationStatus = "quarantined";
  } else if (
    officialIdentitySources.length > 0 &&
    completeKeyClaims.length === KEY_PROPERTIES.length
  ) {
    level = "high";
    verificationStatus = "verified";
  } else if (
    reliableSources.length > 0 &&
    sourcedKeyClaims.length >= 2
  ) {
    level = "medium";
    verificationStatus = "partially_verified";
  }

  return {
    level,
    confidence_level: level,
    verification_status: verificationStatus,
    recommendation_eligible: level === "high" || level === "medium",
    reference_only: level === "low",
    factory_ready: level === "high",
    generated,
    identity_confirmed: hasConfirmedIdentity,
    source_count: allSources.length,
    external_source_count: externalSources.length,
    official_source_count: officialSources.length,
    official_identity_source_count: officialIdentitySources.length,
    reliable_source_count: reliableSources.length,
    primary_source_type: sourceTypes.find((type) => type !== "unknown") || "unknown",
    manufacturer_backed: officialSources.some((source) => source.sourceType === "manufacturer" || source.sourceType === "official_datasheet"),
    has_test_conditions: claimsWithTestConditions.length > 0,
    complete_key_property_count: completeKeyClaims.length,
    sourced_key_property_count: sourcedKeyClaims.length,
    last_verified_at: identity.lastVerifiedAt || null,
    issues: dedupeIssues(issues)
  };
}

function annotateMaterialQuality(material) {
  const withEvidence = material.evidence ? material : { ...material, evidence: buildLegacyEvidence(material) };
  return {
    ...withEvidence,
    data_quality: assessMaterialQuality(withEvidence)
  };
}

function physicalConflictIssues(material, evidence) {
  const issues = [];
  const limits = CATEGORY_LIMITS[material.category];
  if (limits) {
    Object.entries(limits).forEach(([propertyKey, range]) => {
      if (!range) return;
      const value = numericProperty(evidence, propertyKey);
      if (value !== null && (value < range[0] || value > range[1])) {
        issues.push(issue(
          `${propertyKey}_out_of_range`,
          `${propertyLabel(propertyKey)} (${value}) is outside the plausible range for ${material.category}.`,
          `${propertyLabel(propertyKey)}（${value}）超出 ${material.category} 的合理范围。`
        ));
      }
    });
  }

  const continuous = numericProperty(evidence, "continuous_use_temperature");
  const melting = numericProperty(evidence, "melting_temperature");
  if (
    ["Plastics", "Elastomers", "Foams"].includes(material.category) &&
    continuous !== null &&
    melting !== null &&
    continuous > melting + 25
  ) {
    issues.push(issue(
      "temperature_inconsistency",
      "Continuous use temperature is implausibly above the listed melting temperature.",
      "连续使用温度明显高于所列熔融温度，数据相互矛盾。"
    ));
  }

  const flameClaim = firstClaim(evidence, "flame_rating");
  if (
    ["Plastics", "Elastomers"].includes(material.category) &&
    /noncombustible/i.test(String(flameClaim?.value || ""))
  ) {
    issues.push(issue(
      "flammability_inconsistency",
      "A polymer record is marked noncombustible and requires correction.",
      "高分子材料被标记为不可燃，需要校正。"
    ));
  }

  return issues;
}

function evidenceConflictIssues(evidence) {
  const issues = [];
  const identity = evidence.identity || {};
  const identitySources = identity.sources || [];
  const manufacturers = distinct([
    identity.manufacturer,
    ...identitySources.map((source) => source.manufacturer)
  ]);
  const grades = distinct([
    identity.commercialGrade,
    ...identitySources.map((source) => source.commercialGrade)
  ]);

  if (manufacturers.length > 1) {
    issues.push(issue(
      "manufacturer_source_conflict",
      "Material evidence contains conflicting manufacturer identities.",
      "材料证据中存在相互冲突的制造商身份。"
    ));
  }
  if (grades.length > 1) {
    issues.push(issue(
      "commercial_grade_source_conflict",
      "Material evidence contains conflicting commercial grades.",
      "材料证据中存在相互冲突的商业牌号。"
    ));
  }

  Object.entries(evidence.properties || {}).forEach(([propertyKey, claims]) => {
    if (claims.some((claim) => claim.conflictStatus === "conflicting")) {
      issues.push(issue(
        `property_source_conflict:${propertyKey}`,
        `${propertyLabel(propertyKey)} has explicitly flagged conflicting evidence under the same stated conditions.`,
        `${propertyLabel(propertyKey)} 在相同标注条件下存在已标记的冲突证据。`
      ));
      return;
    }
    const grouped = new Map();
    claims.forEach((claim) => {
      const number = finiteNumber(claim.value);
      if (number === null) return;
      const key = [
        claim.unit || "unknown",
        normalizeText(claim.testStandard),
        normalizeText(claim.testCondition)
      ].join("|");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(number);
    });
    for (const values of grouped.values()) {
      if (values.length < 2) continue;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const denominator = Math.max(Math.abs(min), 1);
      if ((max - min) / denominator > 0.3) {
        issues.push(issue(
          `property_source_conflict:${propertyKey}`,
          `${propertyLabel(propertyKey)} has materially conflicting values under the same stated conditions.`,
          `${propertyLabel(propertyKey)} 在相同标注条件下存在显著冲突的数值。`
        ));
        break;
      }
    }
  });

  return issues;
}

function isCompleteOfficialPropertyClaim(claim) {
  return hasValue(claim.value) &&
    hasValue(claim.testStandard) &&
    hasValue(claim.testCondition) &&
    ["manufacturer", "official_datasheet"].includes(claim.source?.sourceType) &&
    hasValue(claim.source?.sourceTitle) &&
    validHttpUrl(claim.source?.sourceUrl) &&
    claim.verificationStatus === "verified";
}

function isReliablySourcedPropertyClaim(claim) {
  return hasValue(claim.value) &&
    ["manufacturer", "official_datasheet", "academic", "distributor"].includes(claim.source?.sourceType) &&
    hasValue(claim.source?.sourceTitle) &&
    validHttpUrl(claim.source?.sourceUrl) &&
    ["verified", "partially_verified"].includes(claim.verificationStatus);
}

function numericProperty(evidence, propertyKey) {
  const claims = evidence.properties?.[propertyKey] || [];
  for (const claim of claims) {
    const number = finiteNumber(claim.value);
    if (number !== null) return number;
  }
  return null;
}

function firstClaim(evidence, propertyKey) {
  return evidence.properties?.[propertyKey]?.[0] || null;
}

function propertyLabel(propertyKey) {
  return PROPERTY_DEFINITIONS.find((item) => item.key === propertyKey)?.label || propertyKey;
}

function validHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || ""));
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function distinct(values) {
  return [...new Set(values.filter(Boolean).map(normalizeText))];
}

function issue(code, en, zh) {
  return { code, en, zh };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    if (seen.has(entry.code)) return false;
    seen.add(entry.code);
    return true;
  });
}

module.exports = {
  CATEGORY_LIMITS,
  KEY_PROPERTIES,
  assessMaterialQuality,
  annotateMaterialQuality
};
