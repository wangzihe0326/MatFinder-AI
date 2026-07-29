const assert = require("node:assert/strict");
const path = require("node:path");
const { MaterialRepository } = require("../material-repository");
const { matchesMaterial, scoreMaterial } = require("../catalog-search");

const repository = new MaterialRepository(path.resolve(__dirname, "..", "matfinder.db"));
const absResult = repository.listMaterials({ audit: true, query: "ABS", limit: 200 });
const absMatches = absResult.items;

assert.ok(absMatches.length > 0, "ABS should return relevant material identities.");
assert.ok(absMatches.length < 250, `ABS search is still too broad (${absMatches.length} matches).`);
absMatches.forEach((item) => {
  const identity = [
    item.name,
    item.name_en,
    item.name_zh,
    item.abbr,
    item.abbreviation,
    item.material_family,
    item.family,
    item.grade_name,
    item.trade_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  assert.match(identity, /(?:^|[^a-z0-9])abs(?:$|[^a-z0-9])/i);
});

const exactAbs = absMatches.find((item) => String(item.abbr || "").toLowerCase() === "abs");
if (exactAbs) {
  assert.ok(scoreMaterial(exactAbs, "ABS") >= 100, "Exact abbreviation should receive top rank.");
}

const naturalLanguageMatches = repository.listMaterials({
  audit: true,
  query: "transparent impact",
  limit: 200
}).items;
assert.ok(naturalLanguageMatches.length > 0, "Multi-word property search should remain available.");
assert.equal(
  repository.listMaterials({ audit: true, query: "absorption", limit: 200 }).items
    .some((item) => String(item.abbr || "").toLowerCase() === "abs"),
  false,
  "Searching absorption must not return ABS by abbreviation."
);
assert.equal(repository.getMetrics().propertyEvidenceRowsRead, 0);
repository.close();

process.stdout.write(
  `Catalog search tests passed: ABS ${absMatches.length} matches, ` +
  `transparent impact ${naturalLanguageMatches.length} matches.\n`
);
