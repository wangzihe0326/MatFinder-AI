const assert = require("node:assert/strict");
const path = require("node:path");
const { readMaterials } = require("./read-materials-sqlite");
const { matchesMaterial, scoreMaterial } = require("../catalog-search");

const materials = readMaterials(path.resolve(__dirname, "..", "matfinder.db"));
const absMatches = materials.filter((item) => matchesMaterial(item, "ABS"));

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

const exactAbs = materials.find((item) => String(item.abbr || "").toLowerCase() === "abs");
if (exactAbs) {
  assert.ok(scoreMaterial(exactAbs, "ABS") >= 100, "Exact abbreviation should receive top rank.");
}

const naturalLanguageMatches = materials.filter((item) => matchesMaterial(item, "transparent impact"));
assert.ok(naturalLanguageMatches.length > 0, "Multi-word property search should remain available.");

process.stdout.write(
  `Catalog search tests passed: ABS ${absMatches.length} matches, ` +
  `transparent impact ${naturalLanguageMatches.length} matches.\n`
);
