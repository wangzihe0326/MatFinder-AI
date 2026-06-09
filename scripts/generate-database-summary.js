const fs = require("node:fs");
const path = require("node:path");
const { readMaterials } = require("./read-materials-sqlite");

const rootDir = path.join(__dirname, "..");
const databasePath = path.resolve(rootDir, process.argv[2] || "matfinder.db");
const jsonPath = path.join(rootDir, "data", "database-summary.json");
const markdownPath = path.join(rootDir, "data", "database-summary.md");

if (!fs.existsSync(databasePath)) {
  console.error(`Database not found: ${databasePath}`);
  process.exit(1);
}

const materials = readMaterials(databasePath);
const summary = {
  database: databasePath,
  generated_at: new Date().toISOString(),
  total_materials: materials.length,
  category_statistics: countBy(materials, "category"),
  subcategory_statistics: countBy(materials, "subcategory"),
  state_statistics: countBy(materials, "state"),
  commercial_coverage: {
    supplier_or_brand: countPresent(materials, "supplier_or_brand"),
    non_generic_supplier_or_brand: materials.filter((material) => present(material.supplier_or_brand) && !/generic|multiple suppliers/i.test(material.supplier_or_brand)).length,
    grade_name: countPresent(materials, "grade_name"),
    non_generic_grade_name: materials.filter((material) => present(material.grade_name) && !/generic/i.test(material.grade_name)).length,
    alternatives: countPresent(materials, "alternatives"),
    source_note: countPresent(materials, "source_note")
  },
  top_suppliers_or_brands: topCounts(materials, "supplier_or_brand", 20),
  representative_entries_by_category: representativeEntries(materials)
};

fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(markdownPath, markdown(summary), "utf8");

console.log(JSON.stringify({ json: jsonPath, markdown: markdownPath, total_materials: materials.length }));

function markdown(report) {
  return [
    "# MatFinder Database Summary",
    "",
    `Generated: ${report.generated_at}`,
    `Database: ${path.basename(report.database)}`,
    `Total materials: ${report.total_materials}`,
    "",
    "## Category Statistics",
    "",
    table(["Category", "Count"], Object.entries(report.category_statistics).sort((a, b) => b[1] - a[1])),
    "",
    "## Commercial Coverage",
    "",
    table(["Field", "Count"], Object.entries(report.commercial_coverage)),
    "",
    "## Top Suppliers Or Brands",
    "",
    table(["Supplier or brand", "Count"], report.top_suppliers_or_brands.map((item) => [item.value, item.count])),
    "",
    "## Representative Entries",
    "",
    ...Object.entries(report.representative_entries_by_category).flatMap(([category, entries]) => [
      `### ${category}`,
      "",
      table(["Material", "Grade", "Supplier/brand", "Applications"], entries.map((entry) => [
        entry.name,
        entry.grade_name,
        entry.supplier_or_brand,
        entry.applications.join("; ")
      ])),
      ""
    ])
  ].join("\n");
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((value) => escapeCell(value)).join(" | ")} |`)
  ].join("\n");
}

function representativeEntries(materials) {
  const categories = [...new Set(materials.map((material) => material.category))].sort();
  return Object.fromEntries(categories.map((category) => [
    category,
    materials
      .filter((material) => material.category === category)
      .slice(0, 5)
      .map((material) => ({
        id: material.id,
        name: material.name,
        grade_name: material.grade_name,
        supplier_or_brand: material.supplier_or_brand,
        applications: (material.applications || material.uses || []).slice(0, 4)
      }))
  ]));
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "not specified";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function topCounts(items, field, limit) {
  return Object.entries(countBy(items, field))
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function countPresent(items, field) {
  return items.filter((item) => present(item[field])).length;
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
