const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readMaterials } = require("./read-materials-sqlite");
const { annotateMaterialQuality } = require("../material-quality");

const rootDir = path.resolve(__dirname, "..");
const materials = readMaterials(path.join(rootDir, "matfinder.db")).map(annotateMaterialQuality);
const browserContext = { window: {} };

vm.createContext(browserContext);
vm.runInContext(
  fs.readFileSync(path.join(rootDir, "recommendation-engine.js"), "utf8"),
  browserContext,
  { filename: "recommendation-engine.js" }
);

const service = browserContext.window.MatFinderAI.createRecommendationService({ materials });

async function run() {
  const invalidAbs = materials.find((item) => item.name === "Glass-filled ABS");
  assert.ok(invalidAbs, "Expected the known GF-ABS record to exist.");
  assert.equal(
    invalidAbs.data_quality.recommendation_eligible,
    false,
    "Implausible GF-ABS data must be excluded from recommendation."
  );

  const factoryRequest =
    "为长期100°C接触浓硫酸的食品生产泵选择密封圈材料，必须符合FDA食品接触要求、" +
    "压缩永久变形低，并给出可采购的真实供应商牌号和价格。";
  const factoryResult = await service.recommend(factoryRequest);

  assert.equal(
    factoryResult.status,
    "no_safe_match",
    "Factory request must stop when no material satisfies every supported hard constraint."
  );
  assert.equal(factoryResult.recommendations.length, 0);
  assert.deepEqual(
    Array.from(factoryResult.parsedRequirement.unsupportedConstraints, (item) => item.code).sort(),
    ["certification", "commercial", "compression_set", "specific_chemical"].sort(),
    "Externally verifiable factory constraints must be surfaced."
  );

  const bomResult = await service.recommend(
    "生产10000个保温杯，给出完整BOM、每个部件材料和用量。"
  );
  assert.equal(bomResult.status, "needs_clarification");
  assert.equal(bomResult.recommendations.length, 0);
  assert.ok(
    Array.from(bomResult.parsedRequirement.unsupportedConstraints, (item) => item.code).includes("bom")
  );

  const screenedResult = await service.recommend("长期100°C耐热");
  assert.equal(screenedResult.status, "screening_ready");
  assert.ok(screenedResult.recommendations.length > 0);
  screenedResult.recommendations.forEach((entry) => {
    assert.ok(
      Number(entry.material.maxTemp) >= 100,
      `${entry.material.name} does not satisfy the 100°C hard constraint.`
    );
    assert.notEqual(entry.material.data_quality.recommendation_eligible, false);
    assert.ok(entry.score <= 79, "Non-factory-ready evidence must not receive a production-ready score.");
  });

  const exactFitResult = await service.recommend("透明抗冲击户外外壳");
  assert.equal(exactFitResult.status, "screening_ready");
  assert.ok(exactFitResult.recommendations.length > 0);
  exactFitResult.recommendations.forEach((entry) => {
    assert.equal(entry.material.category, "Plastics");
  });

  process.stdout.write(
    `Recommendation safety tests passed (${materials.length} records, ` +
    `${screenedResult.recommendations.length} screened results).\n`
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
