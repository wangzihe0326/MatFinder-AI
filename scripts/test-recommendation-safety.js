const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { annotateMaterialQuality } = require("../material-quality");

const rootDir = path.resolve(__dirname, "..");
const browserContext = { window: {} };

vm.createContext(browserContext);
vm.runInContext(
  fs.readFileSync(path.join(rootDir, "recommendation-engine.js"), "utf8"),
  browserContext,
  { filename: "recommendation-engine.js" }
);

function claim(propertyKey, value, unit, overrides = {}) {
  return {
    propertyKey,
    value,
    unit,
    testStandard: overrides.testStandard ?? "ASTM D638",
    testCondition: overrides.testCondition ?? "23 degC; dry specimen",
    valueType: overrides.valueType || "typical",
    verificationStatus: overrides.verificationStatus || "verified",
    confidenceLevel: overrides.confidenceLevel || "high",
    lastVerifiedAt: "2026-07-29",
    source: {
      sourceType: overrides.sourceType || "official_datasheet",
      sourceTitle: overrides.sourceTitle || "TEST FIXTURE ONLY — NOT A REAL DATASHEET",
      sourceUrl: overrides.sourceUrl || "https://example.invalid/test-fixture-only",
      sourceDate: "2026-07-29"
    }
  };
}

function fixture(id, overrides = {}) {
  const officialSource = {
    manufacturer: "TEST ONLY — NOT A REAL MANUFACTURER",
    brand: null,
    commercialGrade: `TEST-FIXTURE-${id}`,
    materialFamily: "PC",
    sourceType: overrides.sourceType || "official_datasheet",
    sourceTitle: "TEST FIXTURE ONLY — NOT A REAL DATASHEET",
    sourceUrl: "https://example.invalid/test-fixture-only",
    sourceDate: "2026-07-29",
    verificationStatus: overrides.verificationStatus || "verified",
    confidenceLevel: overrides.confidenceLevel || "high",
    lastVerifiedAt: "2026-07-29"
  };
  const properties = {
    density: [claim("density", 1.2, "g/cm3", { testStandard: "ASTM D792" })],
    tensile_strength: [claim("tensile_strength", overrides.tensile ?? 70, "MPa")],
    hdt: [claim("hdt", 125, "degC", { testStandard: "ASTM D648", testCondition: "1.8 MPa; method A" })],
    continuous_use_temperature: [claim("continuous_use_temperature", overrides.temperature ?? 110, "degC", {
      testStandard: "UL 746B",
      testCondition: "Long-term thermal aging"
    })]
  };
  if (overrides.tensileConditionMissing) {
    properties.tensile_strength[0].testCondition = null;
  }
  if (overrides.tensileMissing) {
    properties.tensile_strength[0].value = null;
  }
  if (overrides.generated) {
    officialSource.sourceType = "generated";
    officialSource.verificationStatus = "quarantined";
    officialSource.confidenceLevel = "quarantined";
    Object.values(properties).flat().forEach((propertyClaim) => {
      propertyClaim.valueType = "estimated";
      propertyClaim.verificationStatus = "quarantined";
      propertyClaim.confidenceLevel = "quarantined";
      propertyClaim.source.sourceType = "generated";
    });
  }
  if (overrides.medium) {
    officialSource.sourceType = "distributor";
    officialSource.verificationStatus = "partially_verified";
    officialSource.confidenceLevel = "medium";
    Object.values(properties).flat().forEach((propertyClaim, index) => {
      propertyClaim.source.sourceType = "distributor";
      propertyClaim.verificationStatus = "partially_verified";
      propertyClaim.confidenceLevel = "medium";
      if (index > 1) propertyClaim.value = null;
    });
  }
  if (overrides.low) {
    officialSource.sourceType = "secondary_reference";
    officialSource.verificationStatus = "unverified";
    officialSource.confidenceLevel = "low";
    Object.values(properties).flat().forEach((propertyClaim) => {
      propertyClaim.source.sourceType = "secondary_reference";
      propertyClaim.verificationStatus = "unverified";
      propertyClaim.confidenceLevel = "low";
    });
  }
  const certifications = overrides.certificationEvidence
    ? [{
        certificationName: "RoHS",
        certificationStatus: "compliant",
        scope: "TEST FIXTURE ONLY - NOT A REAL CERTIFICATION SCOPE",
        verificationStatus: overrides.certificationVerified === false ? "unverified" : "verified",
        confidenceLevel: overrides.certificationVerified === false ? "low" : "high",
        source: {
          sourceType: overrides.certificationVerified === false ? "secondary_reference" : "manufacturer",
          sourceTitle: "TEST FIXTURE ONLY - NOT A REAL CERTIFICATION RECORD",
          sourceUrl: "https://example.invalid/test-fixture-certification",
          sourceDate: "2026-07-29"
        }
      }]
    : [];

  return annotateMaterialQuality({
    id,
    name: `TEST FIXTURE ${id}`,
    abbr: "TEST",
    category: "Plastics",
    family: "PC",
    evidence: {
      identity: {
        manufacturer: officialSource.manufacturer,
        brand: null,
        commercialGrade: officialSource.commercialGrade,
        materialFamily: "PC",
        verificationStatus: officialSource.verificationStatus,
        confidenceLevel: officialSource.confidenceLevel,
        lastVerifiedAt: "2026-07-29",
        sources: [officialSource]
      },
      properties,
      certifications
    }
  });
}

async function run() {
  const high = fixture("HIGH", { certificationEvidence: true });
  const belowMinimum = fixture("BELOW", {
    tensile: 40,
    certificationEvidence: true,
    certificationVerified: false
  });
  const unknown = fixture("UNKNOWN", { tensileMissing: true });
  const mediumMissingCondition = fixture("MEDIUM", { medium: true, tensileConditionMissing: true });
  const low = fixture("LOW", { low: true });
  const generated = fixture("GENERATED", { generated: true });
  const multipleConditions = fixture("MULTI-CONDITION");
  multipleConditions.evidence.properties.tensile_strength.push(
    claim("tensile_strength", 80, "MPa", {
      testStandard: "ASTM D638",
      testCondition: "50 degC; dry specimen"
    })
  );
  const materials = [
    high,
    belowMinimum,
    unknown,
    mediumMissingCondition,
    low,
    generated,
    multipleConditions
  ];

  assert.equal(high.data_quality.level, "high");
  assert.equal(mediumMissingCondition.data_quality.level, "medium");
  assert.equal(low.data_quality.level, "low");
  assert.equal(generated.data_quality.level, "quarantined");
  assert.equal(generated.data_quality.recommendation_eligible, false);

  const service = browserContext.window.MatFinderAI.createRecommendationService({ materials });
  const result = await service.recommend("拉伸强度至少50 MPa，长期100°C耐热");

  assert.equal(result.status, "verified_matches");
  assert.deepEqual(Array.from(result.groups.verifiedMatches, (entry) => entry.material.id), ["HIGH"]);
  assert.ok(
    result.groups.rejectedMaterials.some((entry) => entry.material.id === "BELOW"),
    "A failed hard tensile condition must reject the material."
  );
  assert.ok(
    result.groups.rejectedMaterials.some((entry) => entry.material.id === "GENERATED"),
    "Generated records must be rejected."
  );

  const unknownEntry = result.groups.potentialMatches.find((entry) => entry.material.id === "UNKNOWN");
  assert.ok(unknownEntry, "A missing critical value must remain a potential match.");
  assert.equal(
    unknownEntry.requirementResults.find((entry) => entry.propertyKey === "tensile_strength").status,
    "unknown",
    "Unknown must never be treated as satisfied."
  );

  const unverifiableEntry = result.groups.potentialMatches.find((entry) => entry.material.id === "MEDIUM");
  assert.ok(unverifiableEntry, "A condition-missing claim must remain a potential match.");
  assert.equal(
    unverifiableEntry.requirementResults.find((entry) => entry.propertyKey === "tensile_strength").status,
    "unverifiable"
  );
  assert.ok(
    result.groups.verifiedMatches.every((entry) =>
      entry.requirementResults.every((requirement) => requirement.status === "satisfied")
    ),
    "Verified matches may contain only satisfied requirement rows."
  );
  const lowEntry = result.groups.potentialMatches.find((entry) => entry.material.id === "LOW");
  assert.ok(lowEntry, "Low-confidence data may appear only as a potential reference result.");
  assert.equal(lowEntry.referenceOnly, true);

  const ambiguousConditionResult = await service.recommend(
    "tensile strength at least 50 MPa"
  );
  const ambiguousConditionEntry = ambiguousConditionResult.groups.potentialMatches
    .find((entry) => entry.material.id === "MULTI-CONDITION");
  assert.ok(
    ambiguousConditionEntry,
    "Multiple incompatible test conditions must not be silently mixed."
  );
  assert.equal(
    ambiguousConditionEntry.requirementResults
      .find((entry) => entry.propertyKey === "tensile_strength").status,
    "unverifiable"
  );

  const explicitConditionResult = await service.recommend(
    "tensile strength at least 50 MPa; test condition: 23 degC; ASTM D638"
  );
  const explicitConditionEntry = explicitConditionResult.groups.verifiedMatches
    .find((entry) => entry.material.id === "MULTI-CONDITION");
  assert.ok(
    explicitConditionEntry,
    "An explicitly requested condition should select only the applicable record."
  );
  assert.match(
    explicitConditionEntry.requirementResults
      .find((entry) => entry.propertyKey === "tensile_strength").materialValue,
    /^70 MPa$/
  );

  const certificationResult = await service.recommend("RoHS required");
  assert.ok(
    certificationResult.groups.verifiedMatches.some(
      (entry) => entry.material.id === "HIGH"
    ),
    "Independent verified certification evidence should satisfy the requirement."
  );
  const unverifiedCertification = certificationResult.groups.potentialMatches
    .find((entry) => entry.material.id === "BELOW");
  assert.ok(
    unverifiedCertification,
    "An unverified certification claim must remain a potential match."
  );
  assert.equal(
    unverifiedCertification.requirementResults
      .find((entry) => entry.requirement === "RoHS").status,
    "unverifiable"
  );
  assert.ok(
    certificationResult.groups.verifiedMatches.every((entry) =>
      entry.requirementResults
        .filter((requirement) => requirement.requirement === "RoHS")
        .every((requirement) => requirement.status === "satisfied")
    )
  );

  const hdtResult = await service.recommend("HDT 至少 130°C");
  assert.equal(hdtResult.parsedRequirement.hardConstraints.minimumHdtC, 130);
  assert.equal(hdtResult.parsedRequirement.hardConstraints.minimumTemperatureC, null);
  const highHdtResult = hdtResult.groups.rejectedMaterials.find((entry) => entry.material.id === "HIGH");
  assert.equal(
    highHdtResult.requirementResults.find((entry) => entry.propertyKey === "hdt").status,
    "not_satisfied",
    "An HDT requirement must be evaluated against HDT evidence, not continuous-use temperature."
  );

  const bomResult = await service.recommend(
    "生产10000个保温杯，给出完整BOM、每个部件材料和用量。"
  );
  assert.equal(bomResult.status, "needs_clarification");
  assert.equal(bomResult.recommendations.length, 0);
  assert.ok(
    Array.from(bomResult.parsedRequirement.unsupportedConstraints, (item) => item.code).includes("bom")
  );

  process.stdout.write("Recommendation evidence safety tests passed.\n");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
