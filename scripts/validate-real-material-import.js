const fs = require("node:fs");
const path = require("node:path");
const { validateMaterialEvidence } = require("../evidence-validator");
const { assessMaterialQuality } = require("../material-quality");

const inputPath = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "data", "templates", "real-material-core-template.json")
);
const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const records = Array.isArray(payload) ? payload : payload.materials;

if (!Array.isArray(records)) {
  throw new Error("Import JSON must be an array or contain a materials array.");
}

const results = records.map((record) => {
  const material = normalizeImportRecord(record);
  const validation = validateMaterialEvidence(material);
  const quality = assessMaterialQuality(material);
  return {
    materialId: record.materialId || null,
    manufacturer: record.manufacturer || null,
    commercialGrade: record.commercialGrade || null,
    valid: validation.valid,
    confidenceLevel: quality.level,
    recommendationEligible: quality.recommendation_eligible,
    errors: validation.errors,
    warnings: validation.warnings,
    qualityIssues: quality.issues
  };
});

const invalid = results.filter((result) => !result.valid);
process.stdout.write(`${JSON.stringify({
  inputPath,
  recordCount: records.length,
  validCount: records.length - invalid.length,
  invalidCount: invalid.length,
  results
}, null, 2)}\n`);

if (invalid.length) process.exitCode = 1;

function normalizeImportRecord(record) {
  const identitySources = Array.isArray(record.identitySources) ? record.identitySources : [];
  const properties = {};
  for (const property of record.properties || []) {
    if (!property.propertyKey) continue;
    properties[property.propertyKey] = (property.measurements || []).map((measurement) => ({
      propertyKey: property.propertyKey,
      value: measurement.value ?? null,
      unit: measurement.unit ?? null,
      testStandard: measurement.testStandard ?? null,
      testCondition: measurement.testCondition ?? null,
      valueType: measurement.valueType || "unknown",
      verificationStatus: measurement.verificationStatus || "unverified",
      confidenceLevel: measurement.confidenceLevel || "low",
      lastVerifiedAt: measurement.lastVerifiedAt ?? null,
      source: {
        sourceType: measurement.sourceType || "unknown",
        sourceTitle: measurement.sourceTitle ?? null,
        sourceUrl: measurement.sourceUrl ?? null,
        sourceDate: measurement.sourceDate ?? null
      }
    }));
  }

  return {
    id: record.materialId || null,
    name: record.commercialGrade || null,
    category: "Plastics",
    evidence: {
      identity: {
        manufacturer: record.manufacturer ?? null,
        brand: record.brand ?? null,
        commercialGrade: record.commercialGrade ?? null,
        materialFamily: record.materialFamily ?? null,
        verificationStatus: record.verificationStatus || strongest(identitySources, "verificationStatus", "unverified"),
        confidenceLevel: record.confidenceLevel || strongest(identitySources, "confidenceLevel", "low"),
        lastVerifiedAt: record.lastVerifiedAt ?? null,
        sources: identitySources
      },
      properties,
      certifications: record.certifications || []
    }
  };
}

function strongest(sources, field, fallback) {
  return sources.find((source) => source[field])?.[field] || fallback;
}
