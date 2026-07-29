const assert = require("node:assert/strict");
const {
  TEST_STANDARD_PATTERN,
  validateMaterialEvidence
} = require("../evidence-validator");

function validFixture() {
  const source = {
    sourceType: "official_datasheet",
    sourceTitle: "TEST FIXTURE ONLY — NOT A REAL DATASHEET",
    sourceUrl: "https://example.invalid/test-fixture-only",
    sourceDate: "2026-07-29"
  };
  return {
    id: "TEST-ONLY",
    evidence: {
      identity: {
        manufacturer: "TEST ONLY — NOT A REAL MANUFACTURER",
        brand: null,
        commercialGrade: "TEST-FIXTURE",
        materialFamily: "PC",
        verificationStatus: "verified",
        confidenceLevel: "high",
        lastVerifiedAt: "2026-07-29",
        sources: [{
          ...source,
          verificationStatus: "verified",
          confidenceLevel: "high"
        }]
      },
      properties: {
        density: [{
          propertyKey: "density",
          value: 1.2,
          unit: "g/cm3",
          testStandard: "ASTM D792",
          testCondition: "23 degC; dry specimen",
          valueType: "typical",
          verificationStatus: "verified",
          confidenceLevel: "high",
          source
        }]
      },
      certifications: []
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCodes(result) {
  return new Set(result.errors.map((entry) => entry.code));
}

const valid = validFixture();
assert.equal(validateMaterialEvidence(valid).valid, true, "A complete fixture should pass validation.");

assert.match("ASTM D638", TEST_STANDARD_PATTERN);
assert.match("ISO 527-1", TEST_STANDARD_PATTERN);
assert.match("GB/T 1040.2", TEST_STANDARD_PATTERN);
assert.doesNotMatch("D638", TEST_STANDARD_PATTERN);

const invalidUnit = clone(valid);
invalidUnit.evidence.properties.density[0].unit = "psi";
assert.ok(errorCodes(validateMaterialEvidence(invalidUnit)).has("unit_invalid"));

const invalidRange = clone(valid);
invalidRange.evidence.properties.density[0].value = 9;
assert.ok(errorCodes(validateMaterialEvidence(invalidRange)).has("family_range_violation"));

const invalidStandard = clone(valid);
invalidStandard.evidence.properties.density[0].testStandard = "D792";
assert.ok(errorCodes(validateMaterialEvidence(invalidStandard)).has("test_standard_invalid"));

const missingUrl = clone(valid);
missingUrl.evidence.properties.density[0].source.sourceUrl = null;
assert.ok(errorCodes(validateMaterialEvidence(missingUrl)).has("source_url_missing"));

const missingIdentity = clone(valid);
missingIdentity.evidence.identity.manufacturer = null;
missingIdentity.evidence.identity.commercialGrade = null;
const identityErrors = errorCodes(validateMaterialEvidence(missingIdentity));
assert.ok(identityErrors.has("manufacturer_missing"));
assert.ok(identityErrors.has("commercial_grade_missing"));

const generated = clone(valid);
generated.evidence.properties.density[0].source.sourceType = "generated";
generated.evidence.properties.density[0].valueType = "estimated";
generated.evidence.properties.density[0].verificationStatus = "quarantined";
generated.evidence.properties.density[0].confidenceLevel = "quarantined";
assert.ok(errorCodes(validateMaterialEvidence(generated)).has("generated_source"));

process.stdout.write("Evidence quality validation tests passed.\n");
