const fs = require("node:fs");
const path = require("node:path");

const { readMaterials } = require("./read-materials-sqlite");

const rootDir = path.join(__dirname, "..");
const databasePath = process.argv[2] || path.join(rootDir, "matfinder.db");
const reportJsonPath = path.join(rootDir, "data", "bilingual-validation-report.json");
const reportMdPath = path.join(rootDir, "data", "bilingual-validation-report.md");
const materials = readMaterials(databasePath);

const longEnglishPattern = /\b[A-Za-z][A-Za-z-]{7,}\b/g;
const allowedLongEnglish = new Set([
  "Polymer",
  "Material",
  "Generic"
]);

function longEnglishWords(value) {
  return [...String(value || "").matchAll(longEnglishPattern)]
    .map((match) => match[0])
    .filter((word) => !allowedLongEnglish.has(word))
    .filter((word) => !isMaterialCode(word));
}

function isMaterialCode(value) {
  const text = String(value || "").trim();
  return (
    /^[A-Z0-9]{2,}(?:-[A-Z0-9]{1,8})+$/.test(text) ||
    /^[A-Z0-9]{4,}$/.test(text) ||
    /^[A-Za-z]{1,5}(?:-[A-Za-z0-9]{1,6}){1,3}$/.test(text)
  );
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

const records = materials.map((material) => {
  const displayFields = [
    material.name_zh,
    material.category_zh,
    material.description_zh,
    ...(material.applications_zh || []),
    ...(material.tags_zh || [])
  ];
  const nameWords = longEnglishWords(material.name_zh);
  const descriptionWords = longEnglishWords(material.description_zh);
  const displayWords = displayFields.flatMap(longEnglishWords);
  return {
    id: material.id,
    name_en: material.name_en || material.name,
    name_zh: material.name_zh,
    translation_quality: material.translation_quality || material.translation_status || "partial",
    name_has_long_english: nameWords.length > 0,
    description_has_long_english: descriptionWords.length > 0,
    display_has_long_english: displayWords.length > 0,
    chinese_first_name: hasChinese(material.name_zh) && nameWords.length === 0,
    chinese_first_description: hasChinese(material.description_zh) && descriptionWords.length === 0,
    untranslated_words: displayWords
  };
});

const total = materials.length;
const quality = countBy(records, (record) => record.translation_quality);
const recordsWithLongEnglishNames = records.filter((record) => record.name_has_long_english);
const recordsWithLongEnglishDescriptions = records.filter((record) => record.description_has_long_english);
const recordsWithLongEnglishDisplay = records.filter((record) => record.display_has_long_english);
const chineseFirstNameCount = records.filter((record) => record.chinese_first_name).length;
const chineseFirstDescriptionCount = records.filter((record) => record.chinese_first_description).length;
const phraseCounts = countBy(records.flatMap((record) => record.untranslated_words), (word) => word.toLowerCase());
const topUntranslatedPhrases = Object.entries(phraseCounts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 30)
  .map(([phrase, count]) => ({ phrase, count }));

const report = {
  ok: chineseFirstNameCount / total >= 0.9 && chineseFirstDescriptionCount / total >= 0.9,
  database: databasePath,
  total_materials: total,
  translation_quality: quality,
  chinese_first_name: {
    count: chineseFirstNameCount,
    percentage: roundPercent(chineseFirstNameCount, total)
  },
  chinese_first_description: {
    count: chineseFirstDescriptionCount,
    percentage: roundPercent(chineseFirstDescriptionCount, total)
  },
  long_english_residue: {
    records_with_long_english_names: recordsWithLongEnglishNames.length,
    records_with_long_english_descriptions: recordsWithLongEnglishDescriptions.length,
    records_with_long_english_display_fields: recordsWithLongEnglishDisplay.length,
    untranslated_display_percentage: roundPercent(recordsWithLongEnglishDisplay.length, total)
  },
  top_untranslated_phrases: topUntranslatedPhrases,
  sample_problem_records: recordsWithLongEnglishDisplay.slice(0, 25).map((record) => ({
    id: record.id,
    name_en: record.name_en,
    name_zh: record.name_zh,
    translation_quality: record.translation_quality,
    untranslated_words: [...new Set(record.untranslated_words)]
  }))
};

fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(reportMdPath, markdownReport(report), "utf8");
console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function roundPercent(count, totalCount) {
  return Number(((count / Math.max(totalCount, 1)) * 100).toFixed(2));
}

function markdownReport(reportData) {
  const topPhrases = reportData.top_untranslated_phrases
    .map((item) => `- ${item.phrase}: ${item.count}`)
    .join("\n") || "- None";
  const samples = reportData.sample_problem_records
    .map((item) => `- ${item.id}: ${item.name_zh} (${item.untranslated_words.join(", ")})`)
    .join("\n") || "- None";

  return `# MatFinder Bilingual Validation Report

- Total materials: ${reportData.total_materials}
- Validation status: ${reportData.ok ? "PASS" : "FAIL"}
- Chinese-first names: ${reportData.chinese_first_name.count} (${reportData.chinese_first_name.percentage}%)
- Chinese-first descriptions: ${reportData.chinese_first_description.count} (${reportData.chinese_first_description.percentage}%)
- Records with long English in display fields: ${reportData.long_english_residue.records_with_long_english_display_fields} (${reportData.long_english_residue.untranslated_display_percentage}%)

## Translation Quality

\`\`\`json
${JSON.stringify(reportData.translation_quality, null, 2)}
\`\`\`

## Top Untranslated Phrases

${topPhrases}

## Sample Problem Records

${samples}
`;
}
