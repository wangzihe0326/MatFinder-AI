'use strict';
// Test-only closed inventory of reviewed SQL execution paths. No repository
// module is loaded/executed to classify it, and there is no learn/update mode.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const BASE_SHA = '85f6c17340d10cd52505498960fa3196bebd1b2c';
const RETIRED = 'scripts/__pycache__/write-materials-sqlite.cpython-312.pyc';
const READER = 'scripts/__pycache__/read-materials-sqlite.cpython-312.pyc';
const READER_SHA = '6374cf9e4824aa3559ed105281086c01c263fe928747f76dc62690f40fa370e5';
const METHODS = new Set(['exec', 'prepare', 'run', 'get', 'all', 'iterate', 'execute', 'executemany', 'executescript', '_all', '_get', '_readAd08Rows']);
const WRAPPERS = new Set(['query', 'read']);
const SOURCE_EXTENSIONS = new Set(['.js', '.py']);
// Normalize only language extensions. Actual Git/policy path identities stay
// exact; recognizing source grants no execution-owner approval.
function productionSourceExtension(file) {
  const extension = path.extname(file).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension) ? extension : null;
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Frozen source-text identity only: strict UTF-8, preserving BOM/content;
// normalize CRLF and lone CR to LF without formatting other source bytes.
// Binary/bytecode identities continue to use the separate raw digest above.
function canonicalSourceDigest(sourceBytes) {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
  return digest(Buffer.from(source.replace(/\r\n?/g, '\n'), 'utf8'));
}
const signature = tokens => digest(JSON.stringify(tokens.map(t => [t.kind, t.value])));

function python() {
  for (const candidate of [process.env.PYTHON, path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'), 'python', 'py'].filter(Boolean)) {
    const r = spawnSync(candidate, ['-B', '--version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return candidate;
  }
  throw new Error('Python is required for AST-only production sink inventory');
}
function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || 'Cannot establish Git inventory');
  return r.stdout;
}
function filesUnder(root) {
  const files = [];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Unclassified production filesystem link: ' + name);
      if (entry.isDirectory()) {
        if (!['.git', '.agents', '.codex', 'node_modules', 'docs', 'doc'].includes(entry.name)) visit(name);
      } else if (entry.isFile() && (productionSourceExtension(name) || /\.(?:pyc|pyo|pyz)$/i.test(name))) files.push(name);
    }
  }
  visit('');
  return files.sort();
}

// JavaScript lexical inventory, not an SQL parser. vm.Script syntax-checks
// without executing code. Strings/comments/regex bodies are data; template
// interpolations are recursively scanned as executable expressions.
function lex(source) {
  const result = []; let i = 0;
  const add = (kind, start, end) => result.push({ kind, value: source.slice(start, end), start, end });
  function scan(interpolation = false) {
    let braces = 0;
    while (i < source.length) {
      const start = i, c = source[i], next = source[i + 1];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue; }
      if (c === '/' && next === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unterminated comment'); i = end + 2; continue; }
      if (c === '"' || c === "'") {
        i++; while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === c) break; }
        add('literal', start, i); continue;
      }
      if (c === '`') {
        i++; let segment = start;
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '`') { i++; add('template', segment, i); break; }
          if (source[i] === '$' && source[i + 1] === '{') {
            add('template', segment, i); i++; add('punct', i, i + 1); i++;
            scan(true); segment = i; continue;
          }
          i++;
        }
        continue;
      }
      const previous = result.at(-1);
      const regexPosition = !previous || ['=', '(', '[', '{', ',', ':', ';', '!', '&&', '||', '?', '=>', 'return', 'case', 'throw'].includes(previous.value);
      if (c === '/' && regexPosition) {
        i++; let square = false;
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '[') square = true;
          else if (source[i] === ']') square = false;
          else if (source[i] === '/' && !square) { i++; while (/[a-z]/i.test(source[i] || '')) i++; break; }
          i++;
        }
        add('regex', start, i); continue;
      }
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
      if (identifier) { i += identifier[0].length; add('identifier', start, i); continue; }
      const number = /^(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(source.slice(i));
      if (number) { i += number[0].length; add('number', start, i); continue; }
      const operator = ['=>', '?.', '&&', '||', '??', '===', '!==', '==', '!=', '++', '--', '**', '...'].find(op => source.startsWith(op, i));
      i += operator ? operator.length : 1; add('punct', start, i);
      if (c === '{') braces++;
      if (c === '}') { if (interpolation && braces === 0) return; braces--; }
    }
    if (interpolation) throw Error('Unterminated template interpolation');
  }
  scan(); return result;
}
function jsInventory(file, source) {
  new vm.Script(source, { filename: file }); // parse only
  const tokens = lex(source), pairs = new Map(), stack = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punct') continue;
    const v = tokens[i].value;
    if (['(', '[', '{'].includes(v)) stack.push(i);
    else if ([')', ']', '}'].includes(v)) {
      const open = stack.pop();
      if (open === undefined || tokens[open].value !== { ')': '(', ']': '[', '}': '{' }[v]) throw Error('Unclassified JS lexical boundary: ' + file);
      pairs.set(open, i); pairs.set(i, open);
    }
  }
  if (stack.length) throw Error('Unclassified JS lexical boundary: ' + file);
  const scopes = [], classes = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i].value === 'class' && tokens[i + 1]?.kind === 'identifier') {
    const open = tokens.findIndex((t, k) => k > i && t.value === '{');
    classes.push({ name: tokens[i + 1].value, start: open, end: pairs.get(open) });
  }
  const control = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].value !== '(' || tokens[i - 1].kind !== 'identifier' || control.has(tokens[i - 1].value)) continue;
    const close = pairs.get(i), body = close + 1;
    if (tokens[body]?.value !== '{') continue;
    const before = tokens[i - 2]?.value;
    if (!['function', 'async', '{', '}', ';', ','].includes(before) && tokens[i - 1].value !== 'constructor') continue;
    const cls = classes.filter(c => c.start < i && c.end > body).sort((a, b) => b.start - a.start)[0];
    const declared = before === 'function';
    let start = i - 1; if (declared) { start--; if (tokens[start - 1]?.value === 'async') start--; } else if (before === 'async') start--;
    scopes.push({ name: (cls && !declared ? cls.name + '.' : '') + tokens[i - 1].value, start, end: pairs.get(body) });
  }
  for (let i = 0; i < tokens.length; i++) if (tokens[i].value === '=>') {
    const parameterStart = tokens[i - 1]?.value === ')' ? pairs.get(i - 1) : i - 1;
    let equals = parameterStart - 1; if (tokens[equals]?.value === 'async') equals--;
    if (tokens[equals]?.value !== '=' || tokens[equals - 1]?.kind !== 'identifier') continue;
    let end = i + 1;
    if (tokens[end]?.value === '{') end = pairs.get(end);
    else { while (end < tokens.length && ![';', ','].includes(tokens[end].value)) { if (pairs.has(end) && ['(', '[', '{'].includes(tokens[end].value)) end = pairs.get(end); end++; } }
    scopes.push({ name: tokens[equals - 1].value, start: equals - 1, end });
  }
  const groups = new Map();
  function add(index, api, callEnd) {
    const parents = scopes.filter(s => s.start <= index && s.end >= index).sort((a, b) => a.start - b.start);
    const owner = parents.at(-1), name = parents.map(s => s.name).join('/') || '<module>';
    const body = owner ? tokens.slice(owner.start, owner.end + 1) : tokens;
    const group = groups.get(name) || { file, owner: name, bodySHA256: signature(body), sites: [] };
    group.sites.push({ api, expressionSHA256: signature(tokens.slice(index, callEnd + 1)), line: source.slice(0, tokens[index].start).split('\n').length,
      expression: source.slice(tokens[index].start, tokens[callEnd].end) });
    groups.set(name, group);
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1]?.value, previous = tokens[i - 1]?.value;
    if (token.kind === 'identifier' && METHODS.has(token.value) && ['.', '?.'].includes(previous)) {
      add(i, token.value, next === '(' ? pairs.get(i + 1) : i); // bindings/references also count
    } else if (token.kind === 'identifier' && (WRAPPERS.has(token.value) || token.value === 'DatabaseSync') && next === '(') {
      add(i, token.value, pairs.get(i + 1));
    } else if (token.value === '[' && pairs.has(i)) {
      const close = pairs.get(i), value = tokens[i + 1];
      const property = value?.kind === 'literal' && close === i + 2 ? value.value.slice(1, -1) : null;
      const member = tokens[i - 1] && (tokens[i - 1].kind === 'identifier' || [')', ']'].includes(previous));
      if (member && (METHODS.has(property) || tokens[close + 1]?.value === '(')) add(i, property || '<computed-call>', tokens[close + 1]?.value === '(' ? pairs.get(close + 1) : close);
    }
    // An SQL API binding/destructuring or unqualified execute-like alias is
    // unclassified even if no call is immediately visible.
    if (token.kind === 'identifier' && ['exec', 'prepare', 'execute', 'executemany', 'executescript'].includes(token.value) && !['.', '?.'].includes(previous)) {
      const declaration = scopes.some(s => s.start <= i && tokens[s.start]?.value === token.value);
      if (!declaration) add(i, '<binding:' + token.value + '>', next === '(' ? pairs.get(i + 1) : i);
    }
  }
  return [...groups.values()];
}
const PYTHON_INVENTORY = String.raw`
import ast,hashlib,json,sys
apis={'execute','executemany','executescript','connect'}
output=[]
for file,source in json.load(sys.stdin):
 tree=ast.parse(source,filename=file);groups={};parents=[]
 def walk(node):
  scope=isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))
  if scope:parents.append(node)
  targets=[]
  if isinstance(node,ast.Attribute) and node.attr in apis:targets.append(node.attr)
  if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in apis|{'getattr','exec','eval'}:targets.append('<indirect:'+node.func.id+'>')
  if isinstance(node,ast.ImportFrom) and any(n.name in apis for n in node.names):targets.append('<binding>')
  if targets:
   owner='/'.join(n.name for n in parents) or '<module>';body=parents[-1] if parents else tree
   group=groups.setdefault(owner,{'file':file,'owner':owner,'bodySHA256':hashlib.sha256(ast.dump(body,include_attributes=False).encode()).hexdigest(),'sites':[]})
   for api in targets:
    group['sites'].append({'api':api,'expressionSHA256':hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest(),'line':node.lineno,'expression':ast.get_source_segment(source,node)})
  for child in ast.iter_child_nodes(node):walk(child)
  if scope:parents.pop()
 walk(tree);output.extend(groups.values())
print(json.dumps(output))
`;
function inventorySources(root, excluded) {
  const files = filesUnder(root).filter(file => productionSourceExtension(file) && !excluded.includes(file));
  const javascript = [], pythonFiles = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (productionSourceExtension(file) === '.js') javascript.push(...jsInventory(file, source)); else pythonFiles.push([file, source]);
  }
  const py = spawnSync(python(), ['-B', '-c', PYTHON_INVENTORY], { input: JSON.stringify(pythonFiles), encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (py.status !== 0) throw Error('Unclassified Python syntax/execution path: ' + py.stderr);
  return { files, groups: [...javascript, ...JSON.parse(py.stdout)].sort((a, b) => (a.file + ':' + a.owner).localeCompare(b.file + ':' + b.owner)) };
}
function compact(group) { return { file: group.file, owner: group.owner, bodySHA256: group.bodySHA256, sites: group.sites.map(s => ({ api: s.api, expressionSHA256: s.expressionSHA256 })) }; }
function verifyBinaries(root, trackedPaths) {
  const actual = filesUnder(root).filter(file => /\.(pyc|pyo|pyz)$/i.test(file));
  const tracked = trackedPaths.filter(file => /\.(pyc|pyo|pyz)$/i.test(file));
  for (const file of new Set([...actual, ...tracked])) if (![READER, RETIRED].includes(file)) throw Error('Unauthorized executable bytecode inventory: ' + file);
  if (fs.existsSync(path.join(root, RETIRED))) throw Error('Retired executable writer bytecode restored');
  if (!tracked.includes(READER) || !fs.existsSync(path.join(root, READER)) || digest(fs.readFileSync(path.join(root, READER))) !== READER_SHA) throw Error('Approved reader bytecode missing/changed');
}
function audit(root, options = {}) {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema-authority-policy.json'), 'utf8'));
  if (policy.base !== BASE_SHA) throw Error('Authority policy baseline mismatch');
  const trackedPaths = options.trackedPaths || git(root, 'ls-files', '-z').split('\0').filter(Boolean);
  // BASE_SHA proves retired-writer provenance, not a permanent HEAD pin.
  if (!options.trackedPaths) git(root, 'cat-file', '-e', BASE_SHA + ':' + RETIRED);
  verifyBinaries(root, trackedPaths);
  for (const file of trackedPaths.filter(file => productionSourceExtension(file) && !policy.excluded.includes(file))) {
    if (!policy.productionFiles.includes(file)) throw Error('Unclassified tracked production source: ' + file);
    if (!fs.existsSync(path.join(root, file))) throw Error('Tracked production source missing: ' + file);
  }
  const actual = inventorySources(root, policy.excluded);
  const expected = new Map(policy.owners.map(owner => [owner.file + ':' + owner.owner, owner]));
  if (expected.size !== policy.owners.length) throw Error('Duplicate approved execution owner');
  for (const owner of actual.groups) {
    const key = owner.file + ':' + owner.owner, approved = expected.get(key);
    if (!approved) throw Error('Unclassified SQL execution owner: ' + key);
    if (!approved.purpose || !['read-only', 'business-DML', 'maintenance', 'canonical', 'non-SQL'].includes(approved.classification)) throw Error('Missing execution-path classification: ' + key);
    if (approved.classification === 'canonical' && owner.file !== 'scripts/migrate.py') throw Error('Canonical owner outside lifecycle');
    if (approved.classification === 'maintenance' && owner.file !== 'scripts/optimize-database-indexes.py') throw Error('Unapproved maintenance exception');
    if (JSON.stringify(compact(owner)) !== JSON.stringify(compact(approved))) throw Error('Reviewed SQL execution function/callsite changed: ' + key);
    expected.delete(key);
  }
  if (expected.size) throw Error('Approved SQL execution path disappeared: ' + [...expected.keys()].join(', '));
  if (JSON.stringify(actual.files) !== JSON.stringify(policy.productionFiles)) throw Error('Unclassified/missing production source inventory');
  // Frozen canonical source-text closures include aliases/constants outside sinks.
  // EOL representation is normalized; substantive source changes still require
  // review and fail closed. There is no automatic approval/update or formatter.
  // Dynamic canonical SQL generation and the historical maintenance constants
  // are transitively bound; a new call inside either file inherits no approval.
  for (const file of Object.keys(policy.boundSources)) if (canonicalSourceDigest(fs.readFileSync(path.join(root, file))) !== policy.boundSources[file]) throw Error('Frozen authority/maintenance source changed: ' + file);
  return { productionFiles: actual.files.length, owners: actual.groups.length, sinks: actual.groups.reduce((n, g) => n + g.sites.length, 0), executableBytecode: [READER] };
}
module.exports = { audit, canonicalSourceDigest, inventorySources, compact, jsInventory, verifyBinaries, python, BASE_SHA, RETIRED, READER };
if (require.main === module) {
  try { console.log(JSON.stringify(audit(path.resolve(__dirname, '..')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
