const fs = require("node:fs");
const path = require("node:path");
const { readMaterials } = require("./read-materials-sqlite");
const { assessMaterialQuality } = require("../material-quality");

const rootDir = path.join(__dirname, "..");
const databasePath = path.resolve(rootDir, process.argv[2] || "matfinder.db");
const minimumMaterialCount = Number(process.env.MATFINDER_MIN_MATERIALS || 5000);

const requiredFields = [
  "material_family",
  "grade_name",
  "supplier_or_brand",
  "category",
  "subcategory",
  "state",
  "density",
  "tensile_strength",
  "elongation",
  "max_temperature",
  "glass_transition_temperature",
  "melting_temperature",
  "flame_rating",
  "electrical_insulation",
  "chemical_resistance",
  "transparency",
  "flexibility",
  "waterproof_sealing",
  "applications",
  "limitations",
  "alternatives",
  "source_note"
];

const normalizedCategories = new Set([
  "Adhesives",
  "Ceramics",
  "Coatings",
  "Composites",
  "Elastomers",
  "Fibers",
  "Foams",
  "General materials",
  "Metals",
  "Plastics",
  "Sealants",
  "Thermosets"
]);

function main() {
  if (!fs.existsSync(databasePath)) {
    console.error(JSON.stringify({ ok: false, error: `Database not found: ${databasePath}` }, null, 2));
    process.exit(1);
  }

  const materials = readMaterials(databasePath);
  const report = {
    ok: true,
    database: databasePath,
    target_material_count: minimumMaterialCount,
    material_count_summary: countSummary(materials),
    duplicate_detection: duplicateReport(materials),
    missing_field_report: missingFieldReport(materials),
    category_normalization: categoryReport(materials),
    material_quality: materialQualityReport(materials),
    encoding_check: encodingReport()
  };

  const hardFailures = [
    report.duplicate_detection.duplicates_by_id.length,
    report.duplicate_detection.duplicates_by_name.length,
    report.duplicate_detection.duplicates_by_commercial_identity.length,
    report.missing_field_report.materials_with_absent_fields,
    report.category_normalization.non_normalized_records,
    report.material_quality.rejected_records,
    report.encoding_check.files.filter((file) => !file.ok).length,
    materials.length < minimumMaterialCount
  ].some(Boolean);

  report.ok = !hardFailures;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

function materialQualityReport(materials) {
  const assessed = materials.map((material) => ({
    id: material.id,
    name: material.name,
    quality: assessMaterialQuality(material)
  }));
  const byLevel = assessed.reduce((counts, item) => {
    counts[item.quality.level] = (counts[item.quality.level] || 0) + 1;
    return counts;
  }, {});
  const rejected = assessed.filter((item) => item.quality.level === "rejected");
  const issueCounts = {};
  assessed.forEach((item) => {
    item.quality.issues.forEach((issue) => {
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    });
  });

  return {
    by_level: byLevel,
    recommendation_eligible_records: assessed.filter((item) => item.quality.recommendation_eligible).length,
    factory_ready_records: assessed.filter((item) => item.quality.factory_ready).length,
    records_with_test_conditions: assessed.filter((item) => item.quality.has_test_conditions).length,
    rejected_records: rejected.length,
    issues_by_code: issueCounts,
    rejected_sample_records: rejected.slice(0, 25).map((item) => ({
      id: item.id,
      name: item.name,
      issues: item.quality.issues.map((issue) => issue.code)
    })),
    note: "Rejected records fail validation and are excluded from recommendation. Synthetic and quarantined records are visible only in administrator audit mode."
  };
}

function countSummary(materials) {
  return {
    total_materials: materials.length,
    by_category: countBy(materials, "category"),
    by_state: countBy(materials, "state"),
    with_supplier_or_brand: materials.filter((material) => hasValue(material.supplier_or_brand)).length,
    with_non_generic_supplier_or_brand: materials.filter((material) => hasValue(material.supplier_or_brand) && !/generic|multiple suppliers/i.test(material.supplier_or_brand)).length,
    with_grade_name: materials.filter((material) => hasValue(material.grade_name)).length,
    with_non_generic_grade_name: materials.filter((material) => hasValue(material.grade_name) && !/generic/i.test(material.grade_name)).length,
    with_source_note: materials.filter((material) => hasValue(material.source_note)).length
  };
}

function duplicateReport(materials) {
  return {
    duplicates_by_id: duplicateValues(materials, (material) => material.id),
    duplicates_by_name: duplicateValues(materials, (material) => normalize(material.name)),
    duplicates_by_commercial_identity: duplicateValues(materials, commercialIdentity),
    duplicates_by_commercial_key: duplicateValues(materials, (material) =>
      normalize([material.supplier_or_brand, material.grade_name, material.name].join(" "))
    )
  };
}

function missingFieldReport(materials) {
  const absentRecords = materials
    .map((material) => ({
      id: material.id,
      name: material.name,
      missing: requiredFields.filter((field) => !Object.prototype.hasOwnProperty.call(material, field))
    }))
    .filter((record) => record.missing.length);

  const unpopulatedRecords = materials
    .map((material) => ({
      id: material.id,
      name: material.name,
      unpopulated: requiredFields.filter((field) => !hasValue(material[field]))
    }))
    .filter((record) => record.unpopulated.length);

  const absentByField = {};
  absentRecords.forEach((record) => {
    record.missing.forEach((field) => {
      absentByField[field] = (absentByField[field] || 0) + 1;
    });
  });

  const unpopulatedByField = {};
  unpopulatedRecords.forEach((record) => {
    record.unpopulated.forEach((field) => {
      unpopulatedByField[field] = (unpopulatedByField[field] || 0) + 1;
    });
  });

  return {
    required_fields: requiredFields,
    materials_with_absent_fields: absentRecords.length,
    absent_by_field: absentByField,
    absent_sample_records: absentRecords.slice(0, 25),
    materials_with_unpopulated_values: unpopulatedRecords.length,
    unpopulated_by_field: unpopulatedByField,
    unpopulated_sample_records: unpopulatedRecords.slice(0, 25),
    note: "Null numeric values are allowed when a family-level value is not defensible or a transition is not applicable; absent fields fail validation."
  };
}

function categoryReport(materials) {
  const nonNormalized = materials
    .filter((material) => !normalizedCategories.has(material.category))
    .map((material) => ({ id: material.id, name: material.name, category: material.category }))
    .slice(0, 50);

  return {
    allowed_categories: [...normalizedCategories].sort(),
    categories_present: Object.keys(countBy(materials, "category")).sort(),
    non_normalized_records: nonNormalized.length,
    sample_records: nonNormalized
  };
}

function encodingReport() {
  const files = [
    path.join(rootDir, "data", "materials.js"),
    path.join(rootDir, "scripts", "additional-materials.js"),
    path.join(rootDir, "scripts", "matweb-style-expansion.js"),
    path.join(rootDir, "scripts", "generated-material-expansion.js"),
    path.join(rootDir, "scripts", "commercial-grade-expansion.js")
  ];

  return {
    files: files.map((filePath) => {
      const text = fs.readFileSync(filePath, "utf8");
      const replacementCharacters = countMatches(text, /\uFFFD/g);
      const controlCharacters = countMatches(text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
      const possibleMojibake = countMatches(
        text,
        /(?:[ÃÂ][\u0080-\u00BF]|â[\u0080-\u00BF]{2})/g
      );
      return {
        file: path.relative(rootDir, filePath),
        utf8_readable: true,
        replacement_characters: replacementCharacters,
        control_characters: controlCharacters,
        possible_mojibake_markers: possibleMojibake,
        ok: replacementCharacters === 0 && controlCharacters === 0 && possibleMojibake === 0
      };
    })
  };
}

function duplicateValues(items, keyFn) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id: item.id, name: item.name });
  });
  return [...byKey.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, records: values }));
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "not specified";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function commercialIdentity(material) {
  const supplier = material.supplier_or_brand || "";
  const grade = material.grade_name || "";
  const generic = /generic|multiple suppliers/i.test(`${supplier} ${grade}`);
  const family = generic ? material.name : material.material_family;
  return normalize([supplier, grade, family, material.subcategory].join(" "));
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

main();
