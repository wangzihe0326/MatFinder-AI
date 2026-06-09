const fs = require("node:fs");
const path = require("node:path");

const { generateBilingualMaterials } = require("./bilingual-material-rules");
const { readMaterials } = require("./read-materials-sqlite");

// Generates a JSON snapshot with rule-based bilingual fields.
// This does not call external translation services and is safe to rerun after
// database expansion. Human-reviewed terminology can be added to
// bilingual-material-rules.js over time.

const rootDir = path.join(__dirname, "..");
const inputPath = process.argv[2] || path.join(rootDir, "matfinder.db");
const outputPath = process.argv[3] || path.join(rootDir, "data", "materials-bilingual.json");

const materials = readMaterials(inputPath);
const bilingualMaterials = generateBilingualMaterials(materials);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(bilingualMaterials, null, 2)}\n`, "utf8");

const complete = bilingualMaterials.filter((item) => item.translation_status === "complete").length;
const partial = bilingualMaterials.length - complete;

console.log(`Generated bilingual material snapshot: ${outputPath}`);
console.log(`Materials: ${bilingualMaterials.length}`);
console.log(`Translation status: ${complete} complete, ${partial} partial`);
