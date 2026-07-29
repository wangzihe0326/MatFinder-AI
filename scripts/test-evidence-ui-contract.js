const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");

[
  "Property data unavailable",
  "Test condition unavailable",
  "Source not verified",
  "Evidence version",
  "Conflict status",
  "Independent certification evidence"
].forEach((requiredMessage) => {
  assert.ok(
    appSource.includes(requiredMessage),
    `Material detail UI must visibly render: ${requiredMessage}`
  );
});

assert.ok(
  appSource.includes("${renderPropertyEvidence(item)}"),
  "Material detail must use the property-level evidence renderer."
);
assert.ok(
  appSource.includes("${renderCertificationEvidence(item)}"),
  "Material detail must render independent certification evidence."
);
assert.ok(
  appSource.includes("${renderRequirementEvidenceTable(candidate.requirementResults || [])}"),
  "Recommendation cards must render requirement-by-requirement evidence."
);
assert.ok(
  appSource.includes("Comparison and AI analysis blocked"),
  "Rejected recommendations must visibly block comparison and AI analysis."
);
assert.ok(
  serverSource.includes('material.data_quality?.recommendation_eligible === false'),
  "Server-side AI analysis must reject non-eligible evidence."
);
assert.ok(
  serverSource.includes('pair.some((item) => item.data_quality?.level === "quarantined")'),
  "Server-side comparison must reject quarantined materials."
);

process.stdout.write("Evidence UI contract tests passed.\n");
