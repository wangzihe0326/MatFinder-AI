const SOURCE_TYPES = Object.freeze([
  "manufacturer",
  "official_datasheet",
  "academic",
  "distributor",
  "secondary_reference",
  "generated",
  "unknown"
]);

const VERIFICATION_STATUSES = Object.freeze([
  "verified",
  "partially_verified",
  "unverified",
  "quarantined"
]);

const CONFIDENCE_LEVELS = Object.freeze([
  "high",
  "medium",
  "low",
  "quarantined"
]);

const VALUE_TYPES = Object.freeze([
  "typical",
  "minimum",
  "maximum",
  "estimated",
  "unknown"
]);

const PROPERTY_DEFINITIONS = Object.freeze([
  { key: "density", label: "Density", unit: "g/cm3", legacyFields: ["density"] },
  { key: "tensile_strength", label: "Tensile strength", unit: "MPa", legacyFields: ["tensile_strength", "tensile"] },
  { key: "flexural_strength", label: "Flexural strength", unit: "MPa", legacyFields: ["flexural_strength"] },
  { key: "impact_strength", label: "Impact strength", unit: null, legacyFields: ["impact_strength"], textAllowed: true },
  { key: "elongation", label: "Elongation at break", unit: "%", legacyFields: ["elongation"] },
  { key: "glass_transition_temperature", label: "Glass transition temperature", unit: "degC", legacyFields: ["glass_transition_temperature", "tg"] },
  { key: "melting_temperature", label: "Melting temperature", unit: "degC", legacyFields: ["melting_temperature", "tm"] },
  { key: "hdt", label: "Heat deflection temperature", unit: "degC", legacyFields: ["hdt"] },
  { key: "continuous_use_temperature", label: "Continuous use temperature", unit: "degC", legacyFields: ["continuous_use_temperature", "max_temperature", "maxTemp"] },
  { key: "thermal_conductivity", label: "Thermal conductivity", unit: "W/mK", legacyFields: ["thermal_conductivity"] },
  { key: "dielectric_constant", label: "Dielectric constant", unit: "1", legacyFields: ["dielectric_constant", "dielectric"] },
  { key: "water_absorption", label: "Water absorption", unit: "%", legacyFields: ["water_absorption"] },
  { key: "flame_rating", label: "Flame rating", unit: null, legacyFields: ["flame_rating", "flammability"], textAllowed: true },
  { key: "chemical_resistance", label: "Chemical resistance", unit: null, legacyFields: ["chemical_resistance"], textAllowed: true },
  { key: "transparency", label: "Transparency", unit: null, legacyFields: ["transparency"], textAllowed: true },
  { key: "flexibility", label: "Flexibility", unit: null, legacyFields: ["flexibility"], textAllowed: true }
]);

const VALID_UNITS = Object.freeze([
  "g/cm3",
  "kg/m3",
  "MPa",
  "GPa",
  "%",
  "degC",
  "K",
  "W/mK",
  "kV/mm",
  "ohm.cm",
  "kJ/m2",
  "J/m",
  "1"
]);

const SOURCE_TYPE_ALIASES = Object.freeze({
  manufacturer_manual: "official_datasheet",
  manufacturer_datasheet: "official_datasheet",
  tds: "official_datasheet",
  official_tds: "official_datasheet",
  academic_paper: "academic",
  journal: "academic",
  reference_database: "secondary_reference",
  technical_reference: "secondary_reference",
  internal_seed: "generated",
  generated_reference_catalog: "generated",
  generated_commercial_catalog: "generated"
});

function normalizeSourceType(value) {
  const normalized = normalizeEnum(value);
  const mapped = SOURCE_TYPE_ALIASES[normalized] || normalized || "unknown";
  return SOURCE_TYPES.includes(mapped) ? mapped : "unknown";
}

function normalizeVerificationStatus(value) {
  const normalized = normalizeEnum(value) || "unverified";
  return VERIFICATION_STATUSES.includes(normalized) ? normalized : "unverified";
}

function normalizeConfidenceLevel(value) {
  const normalized = normalizeEnum(value) || "low";
  return CONFIDENCE_LEVELS.includes(normalized) ? normalized : "low";
}

function normalizeValueType(value) {
  const normalized = normalizeEnum(value) || "unknown";
  return VALUE_TYPES.includes(normalized) ? normalized : "unknown";
}

function buildLegacyEvidence(material) {
  const materialSources = (material.sources || []).map(normalizeMaterialSource);
  const generated = materialSources.some((source) => source.sourceType === "generated");
  const identity = {
    manufacturer: generated ? null : cleanIdentityValue(material.manufacturer),
    brand: generated ? null : cleanIdentityValue(material.trade_name || material.supplier_or_brand),
    commercialGrade: generated ? null : cleanIdentityValue(material.grade_name),
    materialFamily: cleanIdentityValue(material.material_family || material.family),
    verificationStatus: generated ? "quarantined" : "unverified",
    confidenceLevel: generated ? "quarantined" : "low",
    lastVerifiedAt: null,
    sources: materialSources
  };
  const properties = {};

  PROPERTY_DEFINITIONS.forEach((definition) => {
    const rawValue = firstDefined(material, definition.legacyFields);
    const numericValue = finiteNumber(rawValue);
    const value = numericValue !== null ? numericValue : definition.textAllowed && hasValue(rawValue) ? String(rawValue) : null;
    properties[definition.key] = [
      {
        propertyKey: definition.key,
        value,
        unit: definition.unit,
        testStandard: null,
        testCondition: null,
        valueType: generated ? "estimated" : "unknown",
        verificationStatus: generated ? "quarantined" : "unverified",
        confidenceLevel: generated ? "quarantined" : "low",
        lastVerifiedAt: null,
        source: emptyEvidenceSource(identity)
      }
    ];
  });

  return { identity, properties, certifications: [] };
}

function normalizeMaterialSource(source) {
  return {
    manufacturer: cleanIdentityValue(source.manufacturer),
    brand: cleanIdentityValue(source.brand),
    commercialGrade: cleanIdentityValue(source.commercialGrade ?? source.commercial_grade),
    materialFamily: cleanIdentityValue(source.materialFamily ?? source.material_family),
    sourceType: normalizeSourceType(source.sourceType ?? source.source_type),
    sourceTitle: nullableText(source.sourceTitle ?? source.source_title),
    sourceUrl: nullableText(source.sourceUrl ?? source.source_url),
    sourceDate: nullableText(source.sourceDate ?? source.source_date),
    verificationStatus: normalizeVerificationStatus(source.verificationStatus ?? source.verification_status),
    confidenceLevel: normalizeConfidenceLevel(source.confidenceLevel ?? source.confidence_level),
    lastVerifiedAt: nullableText(source.lastVerifiedAt ?? source.last_verified_at),
    notes: nullableText(source.notes)
  };
}

function normalizePropertyEvidence(row, identity = {}) {
  const numeric = finiteNumber(row.value ?? row.value_numeric);
  const text = nullableText(row.value_text);
  return {
    propertyKey: row.propertyKey ?? row.property_key,
    value: numeric !== null ? numeric : text,
    unit: nullableText(row.unit),
    testStandard: nullableText(row.testStandard ?? row.test_standard),
    testCondition: nullableText(row.testCondition ?? row.test_condition),
    valueType: normalizeValueType(row.valueType ?? row.value_type),
    verificationStatus: normalizeVerificationStatus(row.verificationStatus ?? row.verification_status),
    confidenceLevel: normalizeConfidenceLevel(row.confidenceLevel ?? row.confidence_level),
    lastVerifiedAt: nullableText(row.lastVerifiedAt ?? row.last_verified_at),
    evidenceVersion: finiteNumber(row.evidenceVersion ?? row.evidence_version) || 1,
    conflictGroupId: nullableText(row.conflictGroupId ?? row.conflict_group_id),
    conflictStatus: nullableText(row.conflictStatus ?? row.conflict_status) || "none",
    importBatchId: nullableText(row.importBatchId ?? row.import_batch_id),
    importedAt: nullableText(row.importedAt ?? row.imported_at),
    source: {
      manufacturer: cleanIdentityValue(row.manufacturer) ?? identity.manufacturer ?? null,
      brand: cleanIdentityValue(row.brand) ?? identity.brand ?? null,
      commercialGrade: cleanIdentityValue(row.commercialGrade ?? row.commercial_grade) ?? identity.commercialGrade ?? null,
      materialFamily: cleanIdentityValue(row.materialFamily ?? row.material_family) ?? identity.materialFamily ?? null,
      sourceType: normalizeSourceType(row.sourceType ?? row.source_type),
      sourceTitle: nullableText(row.sourceTitle ?? row.source_title),
      sourceUrl: nullableText(row.sourceUrl ?? row.source_url),
      sourceDate: nullableText(row.sourceDate ?? row.source_date)
    }
  };
}

function normalizeMaterialEvidenceRow(row) {
  return {
    manufacturer: cleanIdentityValue(row.manufacturer),
    brand: cleanIdentityValue(row.brand),
    commercialGrade: cleanIdentityValue(row.commercialGrade ?? row.commercial_grade),
    materialFamily: cleanIdentityValue(row.materialFamily ?? row.material_family),
    sourceType: normalizeSourceType(row.sourceType ?? row.source_type),
    sourceTitle: nullableText(row.sourceTitle ?? row.source_title),
    sourceUrl: nullableText(row.sourceUrl ?? row.source_url),
    sourceDate: nullableText(row.sourceDate ?? row.source_date),
    verificationStatus: normalizeVerificationStatus(row.verificationStatus ?? row.verification_status),
    confidenceLevel: normalizeConfidenceLevel(row.confidenceLevel ?? row.confidence_level),
    lastVerifiedAt: nullableText(row.lastVerifiedAt ?? row.last_verified_at),
    notes: nullableText(row.notes),
    evidenceVersion: finiteNumber(row.evidenceVersion ?? row.evidence_version) || 1,
    importBatchId: nullableText(row.importBatchId ?? row.import_batch_id),
    importedAt: nullableText(row.importedAt ?? row.imported_at)
  };
}

function emptyEvidenceSource(identity = {}) {
  return {
    manufacturer: identity.manufacturer ?? null,
    brand: identity.brand ?? null,
    commercialGrade: identity.commercialGrade ?? null,
    materialFamily: identity.materialFamily ?? null,
    sourceType: "unknown",
    sourceTitle: null,
    sourceUrl: null,
    sourceDate: null
  };
}

function firstPropertyClaim(material, propertyKey) {
  return material.evidence?.properties?.[propertyKey]?.[0] || null;
}

function cleanIdentityValue(value) {
  const text = nullableText(value);
  if (!text || /generic|multiple suppliers|screening grade|not specified|unknown/i.test(text)) return null;
  return text;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeEnum(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(object, fields) {
  for (const field of fields) {
    if (hasValue(object[field])) return object[field];
  }
  return null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

module.exports = {
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  CONFIDENCE_LEVELS,
  VALUE_TYPES,
  PROPERTY_DEFINITIONS,
  VALID_UNITS,
  normalizeSourceType,
  normalizeVerificationStatus,
  normalizeConfidenceLevel,
  normalizeValueType,
  normalizeMaterialSource,
  normalizeMaterialEvidenceRow,
  normalizePropertyEvidence,
  buildLegacyEvidence,
  firstPropertyClaim,
  cleanIdentityValue,
  nullableText,
  finiteNumber
};
