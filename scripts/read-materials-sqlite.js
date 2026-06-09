const fs = require("node:fs");

function readMaterials(databasePath) {
  const database = new SQLiteDatabase(fs.readFileSync(databasePath));
  const tables = database.readTableMap();

  const materials = database.readTable(tables.materials).map((row) => {
    const tags = [];
    const uses = [];
    const material = {
      id: row.material_id ?? row.id,
      material_id: row.material_id ?? row.id,
      name: row.name,
      name_en: row.name_en ?? row.name,
      name_zh: row.name_zh ?? row.name,
      abbr: row.abbreviation ?? row.abbr,
      abbreviation: row.abbreviation ?? row.abbr,
      material_family: row.material_family ?? row.family,
      grade_name: row.grade_name ?? row.trade_name ?? "Generic",
      supplier_or_brand: row.supplier_or_brand ?? row.manufacturer ?? "Generic / multiple suppliers",
      category: row.category,
      category_en: row.category_en ?? row.category,
      category_zh: row.category_zh ?? row.category,
      subcategory: row.subcategory,
      state: row.state,
      family: row.family,
      manufacturer: row.manufacturer,
      trade_name: row.trade_name,
      density: row.density,
      tensile_strength: row.tensile_strength ?? row.tensile,
      flexural_strength: row.flexural_strength,
      impact_strength: row.impact_strength,
      hardness: row.hardness,
      tg: row.glass_transition_temperature ?? row.tg,
      glass_transition_temperature: row.glass_transition_temperature ?? row.tg,
      tm: row.melting_temperature ?? row.tm,
      melting_temperature: row.melting_temperature ?? row.tm,
      maxTemp: row.max_temperature ?? row.continuous_use_temperature ?? row.maxTemp,
      max_temperature: row.max_temperature ?? row.continuous_use_temperature ?? row.maxTemp,
      continuous_use_temperature: row.continuous_use_temperature ?? row.max_temperature ?? row.maxTemp,
      tensile: row.tensile_strength ?? row.tensile,
      elongation: row.elongation,
      thermal_conductivity: row.thermal_conductivity,
      dielectric: row.dielectric_constant ?? row.dielectric,
      dielectric_constant: row.dielectric_constant ?? row.dielectric,
      flame_rating: row.flame_rating ?? row.flammability,
      electrical_insulation: row.electrical_insulation,
      chemical_resistance: row.chemical_resistance,
      transparency: row.transparency,
      flexibility: row.flexibility,
      waterproof_sealing: row.waterproof_sealing,
      water_absorption: row.water_absorption,
      flammability: row.flammability,
      recyclability: row.recyclability ?? (row.recyclable ? "recyclable" : "not typically recyclable"),
      recyclable: row.recyclable !== undefined && row.recyclable !== null ? Boolean(row.recyclable) : isRecyclable(row.recyclability),
      cost_level: row.cost_level,
      processing_methods: parseJsonList(row.processing_methods),
      typical_applications: parseJsonList(row.typical_applications),
      applications: parseJsonList(row.applications),
      applications_en: parseJsonList(row.applications_en ?? row.applications),
      applications_zh: parseJsonList(row.applications_zh ?? row.applications),
      limitations: parseJsonList(row.limitations),
      alternatives: parseJsonList(row.alternatives),
      source_note: row.source_note,
      advantages: parseJsonList(row.advantages),
      disadvantages: parseJsonList(row.disadvantages),
      tags_en: parseJsonList(row.tags_en),
      tags_zh: parseJsonList(row.tags_zh),
      tags,
      features: tags,
      uses,
      sources: [],
      summary: row.summary,
      description: row.summary,
      description_en: row.description_en ?? row.summary,
      description_zh: row.description_zh ?? row.summary,
      translation_quality: row.translation_quality ?? row.translation_status ?? "partial",
      translation_status: row.translation_status ?? "partial",
      notes: row.notes
    };
    material.state = material.state || inferState(material);
    return material;
  });

  const byId = new Map(materials.map((material) => [material.id, material]));

  database
    .readTable(tables.material_tags)
    .sort((a, b) => a.position - b.position)
    .forEach((row) => byId.get(row.material_id)?.tags.push(row.tag));

  database
    .readTable(tables.material_uses)
    .sort((a, b) => a.position - b.position)
    .forEach((row) => byId.get(row.material_id)?.uses.push(row.use));

  materials.forEach((material) => {
    if (!material.tags_en.length) material.tags_en = [...material.tags];
    if (!material.tags_zh.length) material.tags_zh = [...material.tags];
    if (!material.applications_en.length) material.applications_en = [...material.applications];
    if (!material.applications_zh.length) material.applications_zh = [...material.applications];
  });

  database.readTable(tables.material_sources).forEach((row) => {
    byId.get(row.material_id)?.sources.push({
      source_title: row.source_title,
      source_url: row.source_url,
      source_type: row.source_type,
      notes: row.notes
    });
  });

  return materials;
}

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch (error) {
    return [String(value)];
  }
}

function isRecyclable(value) {
  const text = String(value || "").toLowerCase();
  if (!text || text.includes("not ") || text.includes("non-recycl")) return false;
  return text.includes("recyclable") || text.includes("recycling");
}

function inferState(material) {
  const text = [material.category, material.family, material.name, material.summary, ...(material.tags || [])].join(" ").toLowerCase();
  if (text.includes("adhesive") || text.includes("sealant") || text.includes("coating")) {
    return "liquid or paste before cure, solid after cure";
  }
  if (text.includes("foam")) return "cellular solid";
  if (text.includes("elastomer") || text.includes("rubber")) return "flexible solid";
  if (text.includes("liquid")) return "liquid";
  return "solid";
}

class SQLiteDatabase {
  constructor(buffer) {
    this.buffer = buffer;
    this.pageSize = buffer.readUInt16BE(16) || 65536;
  }

  readTableMap() {
    const schemaRows = this.readRows(1, ["type", "name", "tbl_name", "rootpage", "sql"]);
    const tables = {};

    schemaRows
      .filter((row) => row.type === "table")
      .forEach((row) => {
        tables[row.name] = {
          name: row.name,
          rootPage: row.rootpage,
          columns: parseColumns(row.sql)
        };
      });

    return tables;
  }

  readTable(table) {
    if (!table) return [];
    return this.readRows(table.rootPage, table.columns);
  }

  readRows(rootPage, columns) {
    return this.readPageRows(rootPage).map((values) => {
      const row = {};
      columns.forEach((column, index) => {
        row[column] = values[index] ?? null;
      });
      return row;
    });
  }

  readPageRows(pageNumber) {
    const pageStart = this.pageStart(pageNumber);
    const headerOffset = pageStart + (pageNumber === 1 ? 100 : 0);
    const pageType = this.buffer[headerOffset];

    if (pageType === 0x0d) {
      return this.readLeafTablePage(pageStart, headerOffset);
    }

    if (pageType === 0x05) {
      return this.readInteriorTablePage(pageStart, headerOffset);
    }

    throw new Error(`Unsupported SQLite page type 0x${pageType.toString(16)} on page ${pageNumber}.`);
  }

  readLeafTablePage(pageStart, headerOffset) {
    const cellCount = this.buffer.readUInt16BE(headerOffset + 3);
    const rows = [];

    for (let index = 0; index < cellCount; index += 1) {
      const cellPointer = this.buffer.readUInt16BE(headerOffset + 8 + index * 2);
      rows.push(this.readTableLeafCell(pageStart + cellPointer));
    }

    return rows;
  }

  readInteriorTablePage(pageStart, headerOffset) {
    const cellCount = this.buffer.readUInt16BE(headerOffset + 3);
    const rightmostPage = this.buffer.readUInt32BE(headerOffset + 8);
    const childPages = [];

    for (let index = 0; index < cellCount; index += 1) {
      const cellPointer = this.buffer.readUInt16BE(headerOffset + 12 + index * 2);
      childPages.push(this.buffer.readUInt32BE(pageStart + cellPointer));
    }

    childPages.push(rightmostPage);
    return childPages.flatMap((pageNumber) => this.readPageRows(pageNumber));
  }

  readTableLeafCell(offset) {
    const payloadSize = readVarint(this.buffer, offset);
    const rowid = readVarint(this.buffer, payloadSize.nextOffset);
    const payloadOffset = rowid.nextOffset;
    const payload = this.buffer.subarray(payloadOffset, payloadOffset + Number(payloadSize.value));
    return parseRecord(payload);
  }

  pageStart(pageNumber) {
    return (pageNumber - 1) * this.pageSize;
  }
}

function parseColumns(sql) {
  const body = sql.slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"));
  const definitions = splitSqlList(body);

  return definitions
    .map((definition) => definition.trim())
    .filter((definition) => definition && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(definition))
    .map((definition) => definition.match(/^"([^"]+)"|^`([^`]+)`|^\[([^\]]+)\]|^(\S+)/))
    .filter(Boolean)
    .map((match) => match[1] || match[2] || match[3] || match[4]);
}

function splitSqlList(value) {
  const items = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }

  items.push(value.slice(start));
  return items;
}

function parseRecord(payload) {
  const headerSize = readVarint(payload, 0);
  let headerOffset = headerSize.nextOffset;
  let bodyOffset = Number(headerSize.value);
  const serialTypes = [];

  while (headerOffset < Number(headerSize.value)) {
    const serialType = readVarint(payload, headerOffset);
    serialTypes.push(Number(serialType.value));
    headerOffset = serialType.nextOffset;
  }

  return serialTypes.map((serialType) => {
    const value = readSerialValue(payload, bodyOffset, serialType);
    bodyOffset += serialTypeSize(serialType);
    return value;
  });
}

function readSerialValue(buffer, offset, serialType) {
  if (serialType === 0) return null;
  if (serialType === 1) return buffer.readInt8(offset);
  if (serialType === 2) return buffer.readInt16BE(offset);
  if (serialType === 3) return buffer.readIntBE(offset, 3);
  if (serialType === 4) return buffer.readInt32BE(offset);
  if (serialType === 5) return buffer.readIntBE(offset, 6);
  if (serialType === 6) return Number(buffer.readBigInt64BE(offset));
  if (serialType === 7) return buffer.readDoubleBE(offset);
  if (serialType === 8) return 0;
  if (serialType === 9) return 1;
  if (serialType >= 12 && serialType % 2 === 0) return buffer.subarray(offset, offset + serialTypeSize(serialType));
  if (serialType >= 13 && serialType % 2 === 1) {
    return buffer.toString("utf8", offset, offset + serialTypeSize(serialType));
  }
  throw new Error(`Unsupported SQLite serial type ${serialType}.`);
}

function serialTypeSize(serialType) {
  if (serialType === 0 || serialType === 8 || serialType === 9) return 0;
  if (serialType === 1) return 1;
  if (serialType === 2) return 2;
  if (serialType === 3) return 3;
  if (serialType === 4) return 4;
  if (serialType === 5) return 6;
  if (serialType === 6 || serialType === 7) return 8;
  if (serialType >= 12) return Math.floor((serialType - 12) / 2);
  throw new Error(`Unsupported SQLite serial type ${serialType}.`);
}

function readVarint(buffer, offset) {
  let value = 0n;

  for (let index = 0; index < 9; index += 1) {
    const byte = buffer[offset + index];
    if (index === 8) {
      return { value: (value << 8n) | BigInt(byte), nextOffset: offset + 9 };
    }

    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset + index + 1 };
    }
  }

  throw new Error("Invalid SQLite varint.");
}

if (require.main === module) {
  const databasePath = process.argv[2];
  if (!databasePath) {
    console.error("Usage: read-materials-sqlite.js <database-path>");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(readMaterials(databasePath)));
}

module.exports = { readMaterials };
