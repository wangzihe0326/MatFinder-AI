'use strict';

// Standalone compatibility inspection. Runtime integration belongs to Phase 2.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const CONTRACT_PATH = path.join(__dirname, 'database-schema-contract.json');
const INTERNAL_TABLES = new Set(['sqlite_sequence', 'sqlite_stat1']);

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const sorted = values => values.sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const fail = message => { throw new Error(message); };
const identifier = token => {
  // Remove quotes only in a syntactic identifier position.
  const value = '"\x60['.includes(token[0]) ? token.slice(1, -1).toLowerCase() : token;
  return /^[a-z_][a-z_0-9]*$/.test(value) ? value : fail('unsupported identifier ' + token);
};
const scalar = value => /^[0-9]+$/.test(value) || value.startsWith("'");

function tokens(sql) {
  const result = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) fail('unterminated SQL comment');
      i = end + 2; continue;
    }
    if ("'\"`[".includes(c)) {
      const closing = c === '[' ? ']' : c, start = i++;
      let value = '', closed = false;
      while (i < sql.length) {
        if (sql[i] === closing) {
          if (closing !== ']' && sql[i + 1] === closing) { value += closing; i += 2; continue; }
          i++; closed = true; break;
        }
        value += sql[i++];
      }
      if (!closed) fail('unterminated SQL quote');
      if (c === "'") result.push(sql.slice(start, i));
      else if (/^[A-Za-z_][A-Za-z_0-9]*$/.test(value)) result.push(sql.slice(start, i)); // quoting survives until an identifier context
      else fail('unsupported quoted identifier');
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z_0-9]*|^[0-9]+|^[(),=;]/.exec(sql.slice(i));
    if (!match) fail('unsupported SQL token at ' + sql.slice(i, i + 24));
    result.push(match[0].toLowerCase()); i += match[0].length;
  }
  return result;
}

class Cursor {
  constructor(values) { this.values = values; this.pos = 0; }
  peek() { return this.values[this.pos]; }
  pop() { if (this.peek() === undefined) fail('unexpected end of SQL'); return this.values[this.pos++]; }
  take(word) { if (this.peek() !== word) return false; this.pos++; return true; }
  need(word) { if (!this.take(word)) fail('expected SQL token ' + word); }
  group() {
    this.need('(');
    const start = this.pos;
    let depth = 1;
    while (depth) { const v = this.pop(); depth += Number(v === '(') - Number(v === ')'); }
    return this.values.slice(start, this.pos - 1);
  }
  done() { this.take(';'); if (this.peek() !== undefined) fail('unsupported SQL clause: ' + this.peek()); }
}

function stripOuter(values) {
  while (values[0] === '(') {
    const cur = new Cursor(values), group = cur.group();
    if (cur.peek() !== undefined) break;
    values = group;
  }
  return values;
}

function expression(values, isDefault = false, columns = []) {
  values = stripOuter(values);
  if (isDefault) {
    if (values.length !== 1 || !(scalar(values[0]) || values[0] === 'null')) fail('unsupported default expression');
  } else {
    const cur = new Cursor(values), column = identifier(cur.pop());
    if (!columns.includes(column)) fail('expression references unknown column');
    values = [column, ...values.slice(1)];
    if (cur.take('in')) {
      const items = cur.group();
      if (!items.length || items.length % 2 === 0 || items.some((v, i) => i % 2 ? v !== ',' : !scalar(v))) {
        fail('unsupported IN expression');
      }
    } else if (cur.take('is')) { cur.need('not'); cur.need('null'); }
    else if (cur.take('=')) { if (!scalar(cur.pop())) fail('unsupported equality expression'); }
    else fail('unsupported expression operator');
    cur.done();
  }
  return values.join(' ');
}

function splitItems(values) {
  const result = []; let start = 0, depth = 0;
  values.forEach((v, i) => {
    depth += Number(v === '(') - Number(v === ')');
    if (v === ',' && depth === 0) { result.push(values.slice(start, i)); start = i + 1; }
  });
  result.push(values.slice(start)); return result;
}

function keyList(values) {
  return splitItems(values).map(item => {
    const cur = new Cursor(item), column = identifier(cur.pop());
    const collation = cur.take('collate') ? identifier(cur.pop()) : 'binary';
    const descending = cur.take('desc'); if (!descending) cur.take('asc'); cur.done();
    return { column, collation, descending };
  });
}

function foreignClause(cur, columns) {
  cur.need('references'); const table = identifier(cur.pop());
  const references = keyList(cur.group()).map(k => k.column);
  const fk = { columns, table, references, onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE',
    deferrable: false, initiallyDeferred: false };
  const seen = new Set();
  while (['on', 'match', 'deferrable', 'not'].includes(cur.peek())) {
    if (cur.take('on')) {
      const event = cur.pop();
      if (!['delete', 'update'].includes(event) || seen.has(event)) fail('unsupported FK action');
      seen.add(event); let action = cur.pop();
      if (['no', 'set'].includes(action)) action += ' ' + cur.pop();
      if (!['no action', 'cascade', 'restrict', 'set null', 'set default'].includes(action)) fail('unsupported FK action');
      fk[event === 'delete' ? 'onDelete' : 'onUpdate'] = action.toUpperCase();
    } else if (cur.take('match')) {
      if (seen.has('match')) fail('duplicate FK match');
      seen.add('match'); fk.match = identifier(cur.pop()).toUpperCase();
    } else {
      if (seen.has('deferrable')) fail('duplicate FK deferrability');
      seen.add('deferrable'); const negative = cur.take('not'); cur.need('deferrable'); fk.deferrable = !negative;
      if (cur.take('initially')) {
        const timing = cur.pop();
        if (!['deferred', 'immediate'].includes(timing)) fail('unsupported FK timing');
        fk.initiallyDeferred = timing === 'deferred';
      }
    }
  }
  return fk;
}

function parseTable(sql, name) {
  let cur = new Cursor(tokens(sql)); cur.need('create'); cur.need('table');
  if (cur.take('if')) { cur.need('not'); cur.need('exists'); }
  if (identifier(cur.pop()) !== name) fail('table SQL name mismatch');
  const entries = splitItems(cur.group()); cur.done();
  const checks = [], foreignKeys = [], columns = {}, unique = [];
  let primaryKey = [], autoincrement = null;
  for (const entry of entries) {
    cur = new Cursor(entry);
    if (cur.take('check')) checks.push(cur.group());
    else if (cur.take('foreign')) {
      cur.need('key'); foreignKeys.push(foreignClause(cur, keyList(cur.group()).map(k => k.column)));
    } else if (cur.take('primary')) {
      cur.need('key'); if (primaryKey.length) fail('duplicate primary key'); primaryKey = keyList(cur.group());
    } else if (cur.take('unique')) unique.push(keyList(cur.group()));
    else {
      const col = identifier(cur.pop()), declared = cur.pop();
      if (!['integer', 'real', 'text'].includes(declared) || Object.hasOwn(columns, col)) fail('unsupported column declaration');
      const info = { type: declared.toUpperCase(), notNull: false, default: null, collation: 'binary' };
      let inlinePk = null, inlineUnique = false; const seen = new Set();
      while (cur.peek() !== undefined) {
        const clause = cur.peek();
        if (seen.has(clause)) fail('duplicate column clause'); seen.add(clause);
        if (cur.take('not')) { cur.need('null'); info.notNull = true; }
        else if (cur.take('primary')) {
          cur.need('key'); const descending = cur.take('desc'); if (!descending) cur.take('asc');
          inlinePk = { column: col, collation: 'binary', descending };
          if (cur.take('autoincrement')) autoincrement = col;
        } else if (cur.take('unique')) inlineUnique = true;
        else if (cur.take('collate')) info.collation = identifier(cur.pop());
        else if (cur.take('default')) {
          const value = cur.peek() === '(' ? ['(', ...cur.group(), ')'] : [cur.pop()];
          info.default = expression(value, true);
        } else if (cur.peek() === 'references') foreignKeys.push(foreignClause(cur, [col]));
        else if (cur.take('check')) checks.push(cur.group());
        else fail('unsupported column clause ' + cur.peek());
      }
      if (inlinePk) {
        if (primaryKey.length) fail('duplicate primary key');
        inlinePk.collation = info.collation; primaryKey = [inlinePk];
      }
      if (inlineUnique) unique.push([{ column: col, collation: info.collation, descending: false }]);
      columns[col] = info;
    }
    cur.done();
  }
  for (const keys of [primaryKey, ...unique]) {
    for (const key of keys) {
      if (!Object.hasOwn(columns, key.column)) fail('constraint references unknown column');
      if (key.collation === 'binary') key.collation = columns[key.column].collation;
    }
  }
  return { columns, primaryKey, unique: sorted(unique), checks: checks.map(v => expression(v, false, Object.keys(columns))).sort(), foreignKeys: sorted(foreignKeys), autoincrement };
}

function parseIndex(sql, name, table, columns) {
  const cur = new Cursor(tokens(sql)); cur.need('create'); const unique = cur.take('unique'); cur.need('index');
  if (cur.take('if')) { cur.need('not'); cur.need('exists'); }
  if (identifier(cur.pop()) !== name) fail('index SQL name mismatch');
  cur.need('on'); if (identifier(cur.pop()) !== table) fail('index SQL table mismatch');
  const keys = keyList(cur.group()); let predicate = null;
  if (cur.take('where')) {
    let remaining = cur.values.slice(cur.pos); if (remaining.at(-1) === ';') remaining = remaining.slice(0, -1);
    predicate = expression(remaining, false, columns); cur.pos = cur.values.length;
  }
  cur.done(); return { name, table, unique, keys, predicate };
}

const query = (db, sql) => db.prepare(sql).all();
const pragma = (db, command, name) => query(db, 'PRAGMA ' + command + '(' + quote(name) + ')');
function inspectStructure(db) {
  const rows = query(db, 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name');
  const objects = [], tables = [], indexes = [], autoNames = new Set();
  for (const { type, name, tbl_name: table, sql } of rows) {
    if (name.startsWith('sqlite_')) continue;
    objects.push({ type, name, table });
    if (type !== 'table') {
      if (type !== 'index') fail('unsupported schema object ' + type + ': ' + name);
      continue;
    }
    const parsed = parseTable(sql, name), columns = [];
    for (const c of pragma(db, 'table_xinfo', name)) {
      if (c.hidden || c.cid !== columns.length || !Object.hasOwn(parsed.columns, c.name)) fail('unsupported hidden/ordered column');
      columns.push({ name: c.name, type: c.type.toUpperCase(), notNull: Boolean(c.notnull),
        default: c.dflt_value === null ? null : expression(tokens(c.dflt_value), true), primaryKeyOrder: c.pk,
        collation: parsed.columns[c.name].collation });
    }
    const declared = Object.entries(parsed.columns).map(([name, info]) => ({ name, ...info }));
    columns.forEach((c, i) => {
      if (['name', 'type', 'notNull', 'default', 'collation'].some(k => c[k] !== declared[i][k])) {
        fail('SQL/PRAGMA column mismatch: ' + name + '.' + c.name);
      }
    });
    const unique = [], explicit = new Map(); let pkKeys = null;
    for (const idx of pragma(db, 'index_list', name)) {
      const keys = [];
      for (const k of pragma(db, 'index_xinfo', idx.name)) {
        if (!k.key) continue;
        if (k.cid < 0 || k.name === null) fail('unsupported expression index ' + idx.name);
        keys.push({ column: k.name, collation: k.coll.toLowerCase(), descending: Boolean(k.desc) });
      }
      if (['pk', 'u'].includes(idx.origin)) {
        autoNames.add(idx.name); if (!idx.unique || idx.partial) fail('invalid automatic constraint index');
        if (idx.origin === 'pk') pkKeys = keys; else unique.push(keys);
      } else if (idx.origin === 'c') explicit.set(idx.name, { unique: Boolean(idx.unique), partial: Boolean(idx.partial), keys });
      else fail('unsupported index origin');
    }
    const primaryKey = parsed.primaryKey;
    if (pkKeys !== null && stable(pkKeys) !== stable(primaryKey)) fail('SQL/PRAGMA primary key mismatch');
    if (stable(sorted(unique)) !== stable(parsed.unique)) fail('SQL/PRAGMA UNIQUE mismatch');
    const pkOrder = Object.fromEntries(primaryKey.map((k, i) => [k.column, i + 1]));
    if (columns.some(c => c.primaryKeyOrder !== (pkOrder[c.name] || 0))) fail('SQL/PRAGMA primary order mismatch');
    const fkGroups = new Map();
    for (const f of pragma(db, 'foreign_key_list', name)) {
      if (!fkGroups.has(f.id)) fkGroups.set(f.id, []); fkGroups.get(f.id).push(f);
    }
    const metadata = [];
    for (const group of fkGroups.values()) {
      group.sort((a, b) => a.seq - b.seq);
      metadata.push({ columns: group.map(f => f.from), table: group[0].table, references: group.map(f => f.to),
        onUpdate: group[0].on_update, onDelete: group[0].on_delete });
    }
    const sqlMetadata = parsed.foreignKeys.map(f => Object.fromEntries(
      ['columns', 'table', 'references', 'onUpdate', 'onDelete'].map(k => [k, f[k]])));
    if (stable(sorted(metadata)) !== stable(sorted(sqlMetadata))) fail('SQL/PRAGMA FK mismatch');
    const rowidAlias = primaryKey.length === 1 && pkKeys === null && parsed.columns[primaryKey[0].column].type === 'INTEGER'
      ? primaryKey[0].column : null;
    tables.push({ name, columns, primaryKey, rowidAlias, autoincrement: parsed.autoincrement,
      withoutRowid: false, strict: false, unique: parsed.unique, checks: parsed.checks, foreignKeys: parsed.foreignKeys });
    for (const [idx, meta] of explicit) {
      const sqlRow = rows.find(r => r.type === 'index' && r.name === idx); if (!sqlRow) fail('missing index SQL');
      const definition = parseIndex(sqlRow.sql, idx, name, Object.keys(parsed.columns));
      for (const key of definition.keys) {
        if (!Object.hasOwn(parsed.columns, key.column)) fail('index references unknown column');
        if (key.collation === 'binary') key.collation = parsed.columns[key.column].collation;
      }
      if (definition.unique !== meta.unique || (definition.predicate !== null) !== meta.partial || stable(definition.keys) !== stable(meta.keys)) {
        fail('SQL/PRAGMA index mismatch: ' + idx);
      }
      indexes.push(definition);
    }
  }
  for (const row of rows) {
    if (row.name.startsWith('sqlite_') && !INTERNAL_TABLES.has(row.name) && !autoNames.has(row.name)) {
      fail('unsupported internal schema object ' + row.name);
    }
  }
  const byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  return { objects, tables: tables.sort(byName), indexes: indexes.sort(byName) };
}

function validateContract(c) {
  // Consumer protocol/shape rules; application versions and registry live in JSON.
  const require = ok => { if (!ok) fail('invalid schema contract'); };
  const object = (v, fields, optional = []) => require(v !== null && typeof v === 'object' && !Array.isArray(v)
    && fields.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...fields, ...optional].includes(k)));
  const integer = (v, minimum = 0) => require(Number.isInteger(v) && v >= minimum && v <= 2147483647);
  const name = v => require(typeof v === 'string' && /^[a-z_][a-z_0-9]*$/.test(v));
  const array = v => require(Array.isArray(v));
  const boolean = v => require(typeof v === 'boolean');
  const names = (v, available) => {
    array(v); require(v.length > 0 && new Set(v).size === v.length);
    for (const n of v) { name(n); require(available.includes(n)); }
  };
  const keys = (v, available, allowEmpty = false) => {
    array(v); require(allowEmpty || v.length > 0); const seen = new Set();
    for (const k of v) {
      object(k, ['column', 'collation', 'descending']);
      name(k.column); name(k.collation); boolean(k.descending);
      require(available.includes(k.column) && !seen.has(k.column)); seen.add(k.column);
    }
  };
  const expr = (v, available, isDefault = false) => {
    require(typeof v === 'string' && v.length > 0);
    require(expression(tokens(v), isDefault, available) === v);
  };
  object(c, ['contractFormatVersion', 'currentSchemaVersion', 'profiles', 'structure', 'transitions']);
  integer(c.contractFormatVersion, 1); require([1].includes(c.contractFormatVersion));
  integer(c.currentSchemaVersion, 1);
  const s = c.structure; object(s, ['objects', 'tables', 'indexes']);
  for (const field of Object.keys(s)) array(s[field]);
  require(s.tables.length > 0); const tables = new Map();
  for (const t of s.tables) {
    object(t, ['name', 'columns', 'primaryKey', 'rowidAlias', 'autoincrement', 'withoutRowid',
      'strict', 'unique', 'checks', 'foreignKeys']);
    name(t.name); require(!tables.has(t.name)); tables.set(t.name, t);
    array(t.columns); require(t.columns.length > 0); const cols = new Map();
    for (const col of t.columns) {
      object(col, ['name', 'type', 'notNull', 'default', 'primaryKeyOrder', 'collation']);
      name(col.name); require(!cols.has(col.name)); cols.set(col.name, col);
      require(['INTEGER', 'REAL', 'TEXT'].includes(col.type));
      boolean(col.notNull); integer(col.primaryKeyOrder); name(col.collation);
      if (col.default !== null) expr(col.default, [...cols.keys()], true);
    }
    const available = [...cols.keys()];
    for (const flag of ['withoutRowid', 'strict']) { boolean(t[flag]); require(t[flag] === false); }
    keys(t.primaryKey, available, true);
    for (const field of ['rowidAlias', 'autoincrement']) {
      if (t[field] !== null) { name(t[field]); require(cols.has(t[field])); }
    }
    if (t.rowidAlias !== null) require(t.primaryKey.length === 1 && t.primaryKey[0].column === t.rowidAlias
      && !t.primaryKey[0].descending && cols.get(t.rowidAlias).type === 'INTEGER');
    require(t.autoincrement === null || t.autoincrement === t.rowidAlias);
    array(t.unique); for (const unique of t.unique) keys(unique, available);
    array(t.checks); for (const check of t.checks) expr(check, available);
    array(t.foreignKeys);
  }
  for (const t of s.tables) {
    const cols = t.columns.map(v => v.name);
    for (const fk of t.foreignKeys) {
      object(fk, ['columns', 'table', 'references', 'onUpdate', 'onDelete', 'match', 'deferrable', 'initiallyDeferred']);
      name(fk.table); require(tables.has(fk.table));
      names(fk.columns, cols); names(fk.references, tables.get(fk.table).columns.map(v => v.name));
      require(fk.columns.length === fk.references.length);
      for (const field of ['onUpdate', 'onDelete'])
        require(['NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'].includes(fk[field]));
      require(fk.match === 'NONE'); boolean(fk.deferrable); boolean(fk.initiallyDeferred);
    }
  }
  const indexes = new Set();
  for (const idx of s.indexes) {
    object(idx, ['name', 'table', 'unique', 'keys', 'predicate']);
    name(idx.name); name(idx.table); boolean(idx.unique);
    require(!indexes.has(idx.name) && !tables.has(idx.name) && tables.has(idx.table)); indexes.add(idx.name);
    const cols = tables.get(idx.table).columns.map(v => v.name); keys(idx.keys, cols);
    if (idx.predicate !== null) expr(idx.predicate, cols);
  }
  for (const o of s.objects) {
    object(o, ['type', 'name', 'table']); name(o.name); name(o.table); require(['table', 'index'].includes(o.type));
  }
  const inventory = [...s.tables.map(t => ({ type: 'table', name: t.name, table: t.name })),
    ...s.indexes.map(i => ({ type: 'index', name: i.name, table: i.table }))];
  require(stable(sorted([...s.objects])) === stable(sorted(inventory)));
  const p = c.profiles; require(p !== null && typeof p === 'object' && !Array.isArray(p)
    && Object.hasOwn(p, 'formal_current'));
  for (const [profile, definition] of Object.entries(p)) {
    require(['blank', 'legacy_current', 'formal_current'].includes(profile)); // classifier protocol IDs
    object(definition, ['userVersion', 'structureRef'], ['sqliteSchemaMustBeEmpty']);
    integer(definition.userVersion); require(['blank', 'current'].includes(definition.structureRef));
    if (Object.hasOwn(definition, 'sqliteSchemaMustBeEmpty')) boolean(definition.sqliteSchemaMustBeEmpty);
    require((definition.structureRef === 'blank') === (definition.sqliteSchemaMustBeEmpty === true));
    if (profile === 'formal_current') require(definition.userVersion === c.currentSchemaVersion
      && definition.structureRef === 'current');
    else require(definition.userVersion < c.currentSchemaVersion);
  }
  array(c.transitions); const seen = new Set();
  for (const tr of c.transitions) {
    object(tr, ['fromVersion', 'inputProfile', 'structureRef', 'toVersion', 'action']);
    integer(tr.fromVersion); integer(tr.toVersion, 1); name(tr.inputProfile); name(tr.action);
    require(Object.hasOwn(p, tr.inputProfile) && tr.inputProfile !== 'formal_current');
    const profile = p[tr.inputProfile]; require(tr.structureRef === profile.structureRef);
    require(tr.fromVersion === profile.userVersion && tr.fromVersion < tr.toVersion
      && tr.toVersion === c.currentSchemaVersion);
    require(['bootstrap_v1', 'adopt_v1'].includes(tr.action));
    require((tr.action === 'bootstrap_v1') === (tr.structureRef === 'blank'));
    const key = stable([tr.fromVersion, tr.inputProfile]); require(!seen.has(key)); seen.add(key);
  }
  return c;
}

function loadContract(contractPath = CONTRACT_PATH) {
  const source = fs.readFileSync(contractPath, 'utf8');
  // JSON.parse erases 1 vs 1.0. Scan JSON lexemes outside strings before parsing;
  // this protocol has only integer numeric fields (including structure ordinals).
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (!match[0].startsWith('"') && /[.eE]/.test(match[0])) fail('contract integer fields cannot contain JSON floats');
  }
  return validateContract(JSON.parse(source));
}

function differences(actual, expected, at = 'structure', result = []) {
  if (result.length >= 32) return result;
  const kind = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (kind(actual) !== kind(expected)) result.push({ path: at, expected, actual });
  else if (kind(actual) === 'object') {
    for (const k of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (!Object.hasOwn(actual, k) || !Object.hasOwn(expected, k)) result.push({ path: at + '.' + k, expected: expected[k] ?? null, actual: actual[k] ?? null });
      else differences(actual[k], expected[k], at + '.' + k, result);
    }
  } else if (Array.isArray(actual)) {
    if (actual.length !== expected.length) result.push({ path: at + '.length', expected: expected.length, actual: actual.length });
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) differences(actual[i], expected[i], at + '[' + i + ']', result);
  } else if (actual !== expected) result.push({ path: at, expected, actual });
  return result.slice(0, 32);
}

function classifyConnection(db, contract) {
  const userVersion = db.prepare('PRAGMA user_version').get().user_version, current = contract.currentSchemaVersion;
  let structure;
  try { structure = inspectStructure(db); }
  catch (error) {
    return { classification: userVersion > current ? 'future_version' : 'unsupported', userVersion, compatible: false,
      differences: [{ path: 'structure.sql', error: error.message }], structure: null };
  }
  const drift = differences(structure, contract.structure);
  const empty = !db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get(), profiles = contract.profiles;
  const matched = Object.keys(profiles).find(name => {
    const p = profiles[name];
    return userVersion === p.userVersion && (p.structureRef === 'blank' ? empty : !drift.length);
  });
  let classification;
  if (userVersion > current) classification = 'future_version';
  else if (!Object.values(profiles).some(p => p.userVersion === userVersion)) classification = 'version_mismatch';
  else if (matched === undefined) classification = 'structural_drift';
  else classification = matched === 'formal_current' ? 'current' : matched;
  return { classification, userVersion, compatible: classification === 'current',
    differences: matched !== undefined && profiles[matched].structureRef === 'blank' ? [] : drift, structure };
}

function checkTarget(databasePath) {
  const target = path.resolve(databasePath), stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('database must be an existing regular file: ' + target);
  if (['-wal', '-shm', '-journal'].some(s => fs.existsSync(target + s))) fail('unsupported database side artifacts; close/checkpoint it offline first');
  const fd = fs.openSync(target, 'r'), header = Buffer.alloc(100); let length;
  try { length = fs.readSync(fd, header, 0, 100, 0); } finally { fs.closeSync(fd); }
  if (length && (length < 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' || header[18] !== 1 || header[19] !== 1)) {
    fail('unsupported database header/journal mode; require rollback-journal SQLite');
  }
  return target;
}

function inspectDatabase(databasePath, contract = loadContract()) {
  validateContract(contract);
  const target = checkTarget(databasePath);
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON'); db.exec('PRAGMA busy_timeout=5000');
    return classifyConnection(db, contract);
  } finally { db.close(); }
}

// Validate the runtime's already-open read-only connection with the same classifier.
// No lifecycle transition or subprocess is reachable through this adapter.
function inspectConnection(db, databasePath, contract = loadContract()) {
  validateContract(contract);
  checkTarget(databasePath);
  return classifyConnection(db, contract);
}

module.exports = { loadContract, validateContract, inspectDatabase, inspectConnection, inspectStructure, differences };

if (require.main === module) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== 'inspect' || process.argv[3] !== '--database') {
      fail('usage: node schema-contract.js inspect --database <existing-path>');
    }
    const result = inspectDatabase(process.argv[4]);
    process.stdout.write(stable(result) + '\n');
    if (!['current', 'legacy_current', 'blank'].includes(result.classification)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1;
  }
}
