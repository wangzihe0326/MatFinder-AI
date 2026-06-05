const fs = require("node:fs");

function readMaterials(databasePath) {
  const database = new SQLiteDatabase(fs.readFileSync(databasePath));
  const tables = database.readTableMap();

  const materials = database.readTable(tables.materials).map((row) => ({
    id: row.id,
    name: row.name,
    abbr: row.abbr,
    category: row.category,
    density: row.density,
    tg: row.tg,
    tm: row.tm,
    maxTemp: row.maxTemp,
    tensile: row.tensile,
    elongation: row.elongation,
    dielectric: row.dielectric,
    recyclable: Boolean(row.recyclable),
    tags: [],
    uses: [],
    sources: [],
    summary: row.summary,
    notes: row.notes
  }));

  const byId = new Map(materials.map((material) => [material.id, material]));

  database
    .readTable(tables.material_tags)
    .sort((a, b) => a.position - b.position)
    .forEach((row) => byId.get(row.material_id)?.tags.push(row.tag));

  database
    .readTable(tables.material_uses)
    .sort((a, b) => a.position - b.position)
    .forEach((row) => byId.get(row.material_id)?.uses.push(row.use));

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
