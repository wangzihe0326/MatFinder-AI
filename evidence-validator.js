const {
  PROPERTY_DEFINITIONS,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  CONFIDENCE_LEVELS,
  VALUE_TYPES,
  VALID_UNITS,
  finiteNumber
} = require("./evidence-model");

// These are deliberately broad anomaly gates, not substitute datasheet values.
// They reject physically implausible records while leaving grade-specific
// acceptance to the cited test evidence.
const FAMILY_PLAUSIBILITY_RANGES = Object.freeze({
  ABS: ranges(0.8, 1.6, 5, 150, 20, 180, -50, 160),
  PC: ranges(0.9, 1.7, 10, 180, 40, 220, -50, 180),
  "PC/ABS": ranges(0.8, 1.7, 5, 180, 30, 210, -50, 170),
  PA6: ranges(0.8, 2.2, 5, 350, 30, 300, -50, 240),
  PA66: ranges(0.8, 2.3, 5, 400, 30, 320, -50, 260),
  POM: ranges(0.9, 1.8, 5, 200, 30, 220, -50, 180),
  PP: ranges(0.6, 1.8, 1, 200, 20, 220, -50, 170),
  HDPE: ranges(0.7, 1.3, 1, 120, 20, 160, -100, 130),
  PET: ranges(0.9, 2.2, 5, 350, 30, 300, -50, 220),
  PBT: ranges(0.9, 2.2, 5, 350, 30, 300, -50, 230),
  TPU: ranges(0.7, 1.7, 1, 150, 20, 180, -80, 170),
  PMMA: ranges(0.9, 1.6, 5, 180, 30, 180, -50, 150),
  PPS: ranges(1, 2.6, 10, 400, 50, 350, -50, 300),
  PEEK: ranges(1, 2.2, 10, 450, 80, 400, -50, 350)
});

const TEST_STANDARD_PATTERN = /^(ASTM|ISO|IEC|DIN|GB\/T|UL|SAE|JIS|EN)(?:\s+[A-Z0-9][A-Z0-9./:+-]*)+(?:\s*[\(\[].*[\)\]])?$/i;

function ranges(
  densityMin,
  densityMax,
  tensileMin,
  tensileMax,
  hdtMin,
  hdtMax,
  continuousMin,
  continuousMax
) {
  return {
    density: [densityMin, densityMax],
    tensile_strength: [tensileMin, tensileMax],
    hdt: [hdtMin, hdtMax],
    continuous_use_temperature: [continuousMin, continuousMax]
  };
}

function validateMaterialEvidence(material) {
  const errors = [];
  const warnings = [];
  const evidence = material.evidence || {};
  const identity = evidence.identity || {};
  const properties = evidence.properties || {};

  if (!identity.manufacturer) {
    errors.push(problem("manufacturer_missing", "Manufacturer is required for a real commercial grade."));
  }
  if (!identity.commercialGrade) {
    errors.push(problem("commercial_grade_missing", "Commercial grade is required for a real commercial grade."));
  }
  if (!identity.materialFamily) {
    warnings.push(problem("material_family_missing", "Material family is unknown."));
  }
  validateEnum(identity.verificationStatus, VERIFICATION_STATUSES, "verification_status", errors);
  validateEnum(identity.confidenceLevel, CONFIDENCE_LEVELS, "confidence_level", errors);

  const identitySources = Array.isArray(identity.sources) ? identity.sources : [];
  identitySources.forEach((source, index) => {
    validateSource(source, `identity.sources[${index}]`, errors, warnings);
  });

  for (const [propertyKey, claims] of Object.entries(properties)) {
    if (!PROPERTY_DEFINITIONS.some((definition) => definition.key === propertyKey)) {
      warnings.push(problem("property_key_unknown", `Unknown property key: ${propertyKey}.`, propertyKey));
    }
    if (!Array.isArray(claims)) {
      errors.push(problem("property_claims_invalid", `${propertyKey} claims must be an array.`, propertyKey));
      continue;
    }
    claims.forEach((claim, index) => {
      validatePropertyClaim(
        claim,
        identity.materialFamily,
        `${propertyKey}[${index}]`,
        errors,
        warnings
      );
    });
  }

  const certifications = Array.isArray(evidence.certifications) ? evidence.certifications : [];
  certifications.forEach((certification, index) => {
    const path = `certifications[${index}]`;
    if (!certification.certificationName) {
      errors.push(problem("certification_name_missing", "Certification name is required.", path));
    }
    validateEnum(certification.verificationStatus, VERIFICATION_STATUSES, `${path}.verificationStatus`, errors);
    validateEnum(certification.confidenceLevel, CONFIDENCE_LEVELS, `${path}.confidenceLevel`, errors);
    validateSource(certification, path, errors, warnings, Boolean(certification.certificationName));
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validatePropertyClaim(claim, materialFamily, path, errors, warnings) {
  validateEnum(claim.valueType, VALUE_TYPES, `${path}.valueType`, errors);
  validateEnum(claim.verificationStatus, VERIFICATION_STATUSES, `${path}.verificationStatus`, errors);
  validateEnum(claim.confidenceLevel, CONFIDENCE_LEVELS, `${path}.confidenceLevel`, errors);

  if (claim.unit && !VALID_UNITS.includes(claim.unit)) {
    errors.push(problem("unit_invalid", `Unsupported unit: ${claim.unit}.`, path));
  }
  if (claim.testStandard && !TEST_STANDARD_PATTERN.test(claim.testStandard)) {
    errors.push(problem("test_standard_invalid", `Invalid test standard format: ${claim.testStandard}.`, path));
  }

  const hasValue = claim.value !== null && claim.value !== undefined && claim.value !== "";
  if (hasValue && !claim.testStandard) {
    warnings.push(problem("test_standard_missing", "Test standard is unavailable.", path));
  }
  if (hasValue && !claim.testCondition) {
    warnings.push(problem("test_condition_missing", "Test condition is unavailable.", path));
  }

  validateSource(claim.source || {}, `${path}.source`, errors, warnings, hasValue);

  const numeric = finiteNumber(claim.value);
  const propertyKey = claim.propertyKey || path.split("[")[0];
  const range = familyRange(materialFamily, propertyKey);
  if (numeric !== null && range && (numeric < range[0] || numeric > range[1])) {
    errors.push(problem(
      "family_range_violation",
      `${propertyKey} value ${numeric} is outside the broad plausibility range for ${materialFamily}.`,
      path
    ));
  }
}

function validateSource(source, path, errors, warnings, valuePresent = false) {
  validateEnum(source.sourceType, SOURCE_TYPES, `${path}.sourceType`, errors);
  const isGenerated = source.sourceType === "generated";
  const isUnknown = !source.sourceType || source.sourceType === "unknown";
  const hasUrl = /^https?:\/\/\S+$/i.test(String(source.sourceUrl || ""));

  if (valuePresent && !isGenerated && !hasUrl) {
    errors.push(problem("source_url_missing", "A property value must have a non-empty HTTP(S) source URL.", path));
  } else if (source.sourceUrl && !hasUrl) {
    errors.push(problem("source_url_invalid", "Source URL must use HTTP(S).", path));
  }
  if (valuePresent && !isGenerated && !source.sourceTitle) {
    errors.push(problem("source_title_missing", "A property value must name its evidence source.", path));
  }
  if (isUnknown && valuePresent) {
    warnings.push(problem("source_type_unknown", "Property source type is unknown.", path));
  }
  if (isGenerated) {
    errors.push(problem("generated_source", "Generated data cannot enter the verified material library.", path));
  }
}

function validateEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(problem("enum_invalid", `${path} must be one of: ${allowed.join(", ")}.`, path));
  }
}

function familyRange(materialFamily, propertyKey) {
  if (!materialFamily) return null;
  const normalized = String(materialFamily).trim().toUpperCase().replace(/\s+/g, "");
  return FAMILY_PLAUSIBILITY_RANGES[normalized]?.[propertyKey] || null;
}

function problem(code, message, path = null) {
  return { code, message, path };
}

module.exports = {
  FAMILY_PLAUSIBILITY_RANGES,
  TEST_STANDARD_PATTERN,
  validateMaterialEvidence
};
