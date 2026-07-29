const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readMaterials } = require("./read-materials-sqlite");
const { annotateMaterialQuality } = require("../material-quality");
const { families, matchesFamily } = require("../polymer-families");
const {
  buildAuditStats,
  buildTrustedStats,
  isDefaultVisibleCommercialGrade,
  isPolymerFamily,
  partitionSearchResults
} = require("../catalog-layer");

const root = path.resolve(__dirname, "..");
const materials = readMaterials(path.join(root, "matfinder.db")).map(annotateMaterialQuality);
const absFamily = families.find((family) => family.abbreviations.includes("ABS"));

assert.ok(absFamily, "ABS polymer family must exist.");
assert.equal(matchesFamily(absFamily, "ABS"), true);
assert.equal(
  matchesFamily(absFamily, "absorption"),
  false,
  "ABS must not match the word absorption."
);
assert.equal(isPolymerFamily(absFamily), true);
assert.equal(absFamily.recommendationEligible, false);
assert.ok(
  absFamily.typicalProperties.every(
    (property) => property.range === null && property.source === null
  ),
  "Unsourced family ranges must remain null."
);

const trustedStats = buildTrustedStats(materials, families);
const auditStats = buildAuditStats(materials);
assert.equal(trustedStats.polymerFamilies, 7);
assert.equal(trustedStats.verifiedCommercialGrades, 0);
assert.equal(trustedStats.verifiedPropertyDataPoints, 0);
assert.equal(trustedStats.materialsAwaitingVerification, 0);
assert.equal(auditStats.legacyMaterialRecords, 7531);
assert.equal(auditStats.legacyPropertyRecords, 120496);
assert.equal(auditStats.quarantinedRecords, 128314);
assert.equal(auditStats.quarantinedMaterialRecords, 7531);
assert.ok(auditStats.generatedRecords > 0);
assert.equal(
  materials.some(isDefaultVisibleCommercialGrade),
  false,
  "Quarantined legacy records must not enter the default commercial-grade catalog."
);
assert.equal(
  partitionSearchResults(materials).referenceOrLegacyRecords.length,
  materials.length
);

const browserContext = { window: {} };
vm.createContext(browserContext);
vm.runInContext(
  fs.readFileSync(path.join(root, "recommendation-engine.js"), "utf8"),
  browserContext,
  { filename: "recommendation-engine.js" }
);
const fakeFamilyForBoundaryTest = {
  ...absFamily,
  record_type: "polymer_family",
  data_quality: {
    level: "high",
    recommendation_eligible: true,
    verification_status: "verified"
  },
  evidence: {
    identity: {
      manufacturer: "TEST ONLY",
      commercialGrade: "TEST ONLY",
      materialFamily: "ABS"
    },
    properties: {
      tensile_strength: [{
        propertyKey: "tensile_strength",
        value: 999,
        unit: "MPa",
        testStandard: "TEST ONLY",
        testCondition: "TEST ONLY",
        valueType: "typical",
        verificationStatus: "verified",
        confidenceLevel: "high",
        source: {
          sourceType: "official_datasheet",
          sourceTitle: "TEST ONLY",
          sourceUrl: "https://example.invalid/test-only"
        }
      }]
    },
    certifications: []
  }
};

(async () => {
  const service = browserContext.window.MatFinderAI.createRecommendationService({
    materials: [fakeFamilyForBoundaryTest]
  });
  const result = await service.recommend("tensile strength at least 50 MPa");
  assert.equal(result.groups.verifiedMatches.length, 0);
  assert.equal(result.groups.potentialMatches.length, 0);
  assert.equal(result.groups.rejectedMaterials.length, 0);

  const frontEndSource = [
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    fs.readFileSync(path.join(root, "app.js"), "utf8")
  ].join("\n");
  assert.equal(
    frontEndSource.includes("120,496") || frontEndSource.includes("120496"),
    false,
    "The UI must not hard-code legacy property rows as a material count."
  );
  assert.ok(
    fs.readFileSync(path.join(root, "server.js"), "utf8")
      .includes("isDefaultVisibleCommercialGrade"),
    "The public API must use the commercial-grade visibility boundary."
  );
  process.stdout.write(
    "Catalog layering, family separation, trusted statistics, and recommendation boundary tests passed.\n"
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
