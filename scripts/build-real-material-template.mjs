import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outputDir = path.join(rootDir, "data", "templates");
const workbookOutputDir = path.join(rootDir, "outputs", "019fad27-72f8-7cb0-bfca-e5e24c1519dc");
const previewDir = path.join(workbookOutputDir, ".previews");

const families = [
  "ABS", "PC", "PC/ABS", "PA6", "PA66", "POM", "PP",
  "HDPE", "PET", "PBT", "TPU", "PMMA", "PPS", "PEEK"
];
const propertyKeys = [
  "density",
  "tensile_strength",
  "flexural_strength",
  "impact_strength",
  "elongation",
  "glass_transition_temperature",
  "melting_temperature",
  "hdt",
  "continuous_use_temperature",
  "thermal_conductivity",
  "dielectric_constant",
  "water_absorption",
  "flame_rating",
  "chemical_resistance",
  "transparency",
  "flexibility"
];
const units = ["g/cm3", "kg/m3", "MPa", "GPa", "%", "degC", "K", "W/mK", "kV/mm", "ohm.cm", "kJ/m2", "J/m", "1"];
const sourceTypes = ["manufacturer", "official_datasheet", "academic", "distributor", "generated", "unknown"];
const verificationStatuses = ["verified", "partially_verified", "unverified", "quarantined"];
const confidenceLevels = ["high", "medium", "low", "quarantined"];
const valueTypes = ["typical", "minimum", "maximum", "estimated", "unknown"];

const materialHeaders = [
  "materialId",
  "manufacturer",
  "brand",
  "commercialGrade",
  "materialFamily",
  "officialTdsUrl",
  "sourceType",
  "sourceTitle",
  "sourceUrl",
  "sourceDate",
  "verificationStatus",
  "confidenceLevel",
  "lastVerifiedAt",
  "notes"
];
const propertyHeaders = [
  "materialId",
  "propertyKey",
  "conditionId",
  "value",
  "unit",
  "testStandard",
  "testCondition",
  "valueType",
  "manufacturer",
  "commercialGrade",
  "sourceType",
  "sourceTitle",
  "sourceUrl",
  "sourceDate",
  "verificationStatus",
  "confidenceLevel",
  "lastVerifiedAt"
];
const certificationHeaders = [
  "materialId",
  "certificationName",
  "certificationStatus",
  "scope",
  "sourceType",
  "sourceTitle",
  "sourceUrl",
  "sourceDate",
  "verificationStatus",
  "confidenceLevel",
  "lastVerifiedAt"
];
const csvHeaders = [
  "recordType",
  ...new Set([
    ...materialHeaders,
    ...propertyHeaders,
    ...certificationHeaders
  ])
];

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(workbookOutputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const workbook = Workbook.create();
const instructions = workbook.worksheets.add("Instructions");
const materials = workbook.worksheets.add("Materials");
const properties = workbook.worksheets.add("Properties");
const certifications = workbook.worksheets.add("Certifications");
const allowed = workbook.worksheets.add("Allowed Values");

instructions.showGridLines = false;
instructions.getRange("A1:F1").merge();
instructions.getRange("A1:F1").values = [["MatFinder AI — Real Material Core Import Template"]];
instructions.getRange("A1:F1").format = {
  fill: "#0F766E",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  rowHeight: 32
};
instructions.getRange("A3:B13").values = [
  ["Target", "Manually enter 50–100 real commercial grades across the listed material families."],
  ["No fabrication", "Do not enter generated manufacturers, grades, certifications, test standards, or URLs."],
  ["Missing values", "Leave a non-record row empty. For an actual record, use null in JSON or unknown in an enum field; never enter 0 as a placeholder."],
  ["Materials sheet", "One row per commercial grade. officialTdsUrl must point to the actual official TDS when available."],
  ["Properties sheet", "One row per property claim and test condition. Reuse materialId and create a distinct conditionId for multiple conditions."],
  ["Property sources", "Every property row carries its own source; never assume all properties share the material identity source."],
  ["Certifications sheet", "One row per certification claim and scope. Missing or unverified certification evidence must not be marked verified."],
  ["Source URLs", "Verified and partially verified property claims require a non-empty HTTP(S) source URL and source title."],
  ["High confidence", "Requires confirmed manufacturer and commercial grade, official manufacturer TDS, complete key-property standards and conditions, and no physical conflict."],
  ["Recommendation", "Only High and Medium confidence may enter normal recommendation. Low is reference-only; Quarantined is blocked."],
  ["CSV usage", "The companion CSV is header-only. Use recordType = material, property, or certification; repeat materialId to represent one-to-many records."]
];
instructions.getRange("A3:A13").format = {
  fill: "#DFF3EF",
  font: { bold: true, color: "#115E59" },
  verticalAlignment: "top",
  wrapText: true
};
instructions.getRange("B3:B13").format = { wrapText: true, verticalAlignment: "top" };
instructions.getRange("A3:B13").format.borders = { preset: "all", style: "thin", color: "#C9D8D4" };
instructions.getRange("A1:A13").format.columnWidth = 22;
instructions.getRange("B1:B13").format.columnWidth = 86;

writeHeader(materials, materialHeaders, 101);
writeHeader(properties, propertyHeaders, 501);
writeHeader(certifications, certificationHeaders, 301);

materials.getRange("E2:E101").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$A$2:$A$15" } };
materials.getRange("G2:G101").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$D$2:$D$7" } };
materials.getRange("K2:K101").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$E$2:$E$5" } };
materials.getRange("L2:L101").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$F$2:$F$5" } };

properties.getRange("B2:B501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$B$2:$B$17" } };
properties.getRange("E2:E501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$C$2:$C$14" } };
properties.getRange("H2:H501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$G$2:$G$6" } };
properties.getRange("K2:K501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$D$2:$D$7" } };
properties.getRange("O2:O501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$E$2:$E$5" } };
properties.getRange("P2:P501").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$F$2:$F$5" } };

certifications.getRange("E2:E301").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$D$2:$D$7" } };
certifications.getRange("I2:I301").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$E$2:$E$5" } };
certifications.getRange("J2:J301").dataValidation = { rule: { type: "list", formula1: "'Allowed Values'!$F$2:$F$5" } };

const allowedRows = [["Material family", "Property key", "Unit", "Source type", "Verification status", "Confidence level", "Value type"]];
const maxAllowedLength = Math.max(
  families.length,
  propertyKeys.length,
  units.length,
  sourceTypes.length,
  verificationStatuses.length,
  confidenceLevels.length,
  valueTypes.length
);
for (let index = 0; index < maxAllowedLength; index += 1) {
  allowedRows.push([
    families[index] ?? null,
    propertyKeys[index] ?? null,
    units[index] ?? null,
    sourceTypes[index] ?? null,
    verificationStatuses[index] ?? null,
    confidenceLevels[index] ?? null,
    valueTypes[index] ?? null
  ]);
}
allowed.getRange(`A1:G${allowedRows.length}`).values = allowedRows;
styleHeader(allowed, "A1:G1");
allowed.freezePanes.freezeRows(1);
allowed.getRange(`A1:G${allowedRows.length}`).format.borders = { preset: "all", style: "thin", color: "#DCE5E2" };
allowed.getRange(`A1:G${allowedRows.length}`).format.wrapText = true;
["A", "B", "C", "D", "E", "F", "G"].forEach((column) => {
  allowed.getRange(`${column}1:${column}${allowedRows.length}`).format.columnWidth = column === "B" ? 34 : 24;
});

for (const sheet of [materials, properties, certifications]) {
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
}
setWidths(materials, [20, 24, 20, 24, 18, 42, 22, 34, 42, 16, 22, 18, 18, 42]);
setWidths(properties, [20, 32, 18, 14, 14, 22, 42, 16, 24, 24, 22, 34, 42, 16, 22, 18, 18]);
setWidths(certifications, [20, 28, 20, 32, 22, 34, 42, 16, 22, 18, 18]);

const csvText = `${csvHeaders.map(csvEscape).join(",")}\r\n`;
const csvPath = path.join(outputDir, "real-material-core-template.csv");
await fs.writeFile(csvPath, csvText, "utf8");
const csvWorkbook = await Workbook.fromCSV(csvText, { sheetName: "Flat Import" });
const csvInspection = await csvWorkbook.inspect({
  kind: "region",
  sheetId: "Flat Import",
  range: `A1:${excelColumn(csvHeaders.length)}2`,
  maxChars: 5000
});

const xlsxPath = path.join(workbookOutputDir, "real-material-core-template.xlsx");
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(xlsxPath);

const workbookInspection = await workbook.inspect({
  kind: "workbook,sheet",
  maxChars: 8000,
  tableMaxRows: 4,
  tableMaxCols: 20
});
const formulaErrorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan"
});
const keyRangeInspections = [];
for (const [sheetName, range] of [
  ["Instructions", "A1:B13"],
  ["Materials", `A1:${excelColumn(materialHeaders.length)}2`],
  ["Properties", `A1:${excelColumn(propertyHeaders.length)}2`],
  ["Certifications", `A1:${excelColumn(certificationHeaders.length)}2`],
  ["Allowed Values", `A1:G${allowedRows.length}`]
]) {
  keyRangeInspections.push(await workbook.inspect({
    kind: "region",
    sheetId: sheetName,
    range,
    maxChars: 6000
  }));
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png"
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName.toLowerCase().replace(/\s+/g, "-")}.png`),
    new Uint8Array(await preview.arrayBuffer())
  );
}

console.log(JSON.stringify({
  xlsxPath,
  csvPath,
  previewDir,
  workbookInspection: workbookInspection.ndjson,
  formulaErrorScan: formulaErrorScan.ndjson,
  csvInspection: csvInspection.ndjson,
  keyRangeInspections: keyRangeInspections.map((inspection) => inspection.ndjson)
}, null, 2));

function writeHeader(sheet, headers, maxRows) {
  const endColumn = excelColumn(headers.length);
  sheet.getRange(`A1:${endColumn}1`).values = [headers];
  styleHeader(sheet, `A1:${endColumn}1`);
  sheet.getRange(`A1:${endColumn}${maxRows}`).format.wrapText = true;
}

function styleHeader(sheet, range) {
  sheet.getRange(range).format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF" },
    rowHeight: 28,
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#0A5B55" }
  };
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    const column = excelColumn(index + 1);
    sheet.getRange(`${column}1:${column}2`).format.columnWidth = width;
  });
}

function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function excelColumn(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
