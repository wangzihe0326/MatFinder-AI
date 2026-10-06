"use strict";
// HOST/STATIC gates only. Execute Docker's orchestration on OS Temp fixtures;
// all schema and AD-08 decisions remain in the existing canonical APIs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { digestFile, artifactPath, loadArtifact } = require("../catalog-stats-artifact");
const { bootstrapFixture } = require("./schema-test-fixtures");
const guard = require("./schema-authority-guard");
const root = path.resolve(__dirname, "..");

if (process.argv.includes("--runtime-probe")) {
  // These hooks run before server imports: any subprocess/provider or mutation
  // attempt is an immediate host-runtime failure, including Python execution.
  const processes = require("node:child_process");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
    processes[name] = () => { throw Error("P3 runtime attempted an offline subprocess"); };
  global.fetch = () => { throw Error("P3 runtime attempted a provider request"); };
  const exists = fs.existsSync;
  fs.existsSync = function (file) {
    if ([".env", ".env.local"].includes(path.basename(String(file)))) return false;
    return exists.apply(this, arguments);
  };
  const execute = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    for (const statement of sql.split(";").map(value => value.trim()).filter(Boolean))
      assert.match(statement, /^(PRAGMA (?:busy_timeout|query_only|foreign_keys)\s*=|BEGIN|COMMIT|ROLLBACK)/i,
        "P3 runtime attempted schema/data mutation");
    return execute.call(this, sql);
  };
  const policy = require(path.join(process.cwd(), "catalog-policy")).loadCanonicalPolicy();
  const prototype = policy.repository.MaterialRepository.prototype;
  const initialize = prototype.initializeCatalogStats;
  prototype.initializeCatalogStats = async function (...args) {
    const generation = await initialize.apply(this, args);
    assert.ok(generation, "Host runtime requires the prepared matching artifact");
    assert.equal(this.checkSchema().version, 1);
    assert.equal(this.database.prepare("PRAGMA query_only").get().query_only, 1);
    console.log(JSON.stringify({ status: "host-runtime-verified", ...generation }));
    return generation;
  };
  require(path.join(process.cwd(), "server"));
} else main().catch(error => { console.error(error); process.exitCode = 1; });

function contract(condition, message) {
  if (!condition) throw Error("P3A invocation contract: " + message);
}
function words(text) {
  // Literal shell words only: no expansions, operators, escapes or exec-form RUN.
  const result = [], token = /"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\]+)/y;
  let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset])) { offset++; continue; }
    token.lastIndex = offset;
    const match = token.exec(text);
    contract(match, "unsupported command token near " + text.slice(offset));
    const value = match[1] ?? match[2] ?? match[3];
    contract(!/[\0$`;|&<>]/.test(value), "unsupported shell expansion/operator: " + value);
    result.push(value); offset = token.lastIndex;
  }
  return result;
}
function dockerPath(value, cwd) {
  contract(value && !/[\\\0$]/.test(value) && !value.split("/").includes(".."), "unsupported path: " + value);
  contract(value.startsWith("/") || cwd, "relative path requires an established WORKDIR: " + value);
  return path.posix.resolve(cwd || "/", value);
}
function dockerInstructions(text) {
  const lines = text.split(/\r?\n/), instructions = [], stages = new Map();
  let stage = null;
  for (let i = 0; i < lines.length; i++) {
    const startLine = i;
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    while (line.endsWith("\\")) {
      contract(i + 1 < lines.length, "unterminated instruction continuation");
      line = line.slice(0, -1) + " " + lines[++i].trim();
    }
    const headerEndLine = i, match = /^(\w+)\s+(.*)$/.exec(line);
    contract(match, "unsupported instruction: " + line);
    const op = match[1].toUpperCase();
    contract(["FROM", "WORKDIR", "ENV", "COPY", "RUN", "EXPOSE", "HEALTHCHECK", "CMD"].includes(op), "unsupported instruction " + op);
    let args = match[2], body = null, suffix = "";
    const heredoc = /\s+<<(['"]?)([A-Za-z_][\w]*)\1\s*$/.exec(args);
    if (heredoc) {
      contract(op === "RUN", "heredoc supported only for RUN");
      suffix = args.slice(heredoc.index); args = args.slice(0, heredoc.index);
      const contents = [];
      while (++i < lines.length && lines[i] !== heredoc[2]) contents.push(lines[i]);
      contract(i < lines.length, "unterminated Docker heredoc");
      body = contents.join("\n");
    }
    if (op === "FROM") {
      const parts = words(args);
      contract(parts.length === 3 && parts[1].toUpperCase() === "AS", "FROM requires one explicit stage alias");
      contract(/^[A-Za-z][\w-]*$/.test(parts[2]) && !stages.has(parts[2]), "invalid/duplicate stage alias");
      const parent = stages.get(parts[0]);
      stage = { name: parts[2], base: parts[0], cwd: parent?.cwd || null,
        env: { ...parent?.env }, instructions: [] };
      stages.set(stage.name, stage);
    }
    contract(stage, "instruction precedes FROM");
    if (op === "WORKDIR") {
      const values = words(args);
      contract(values.length === 1, "WORKDIR requires one literal path");
      stage.cwd = dockerPath(values[0], stage.cwd);
    }
    if (op === "ENV") for (const value of words(args)) {
      const assignment = /^([A-Z_][A-Z_0-9]*)=(.+)$/.exec(value);
      contract(assignment, "ENV requires literal KEY=value assignments");
      stage.env[assignment[1]] = assignment[2];
    }
    const instruction = { op, args, body, suffix, stage, cwd: stage.cwd, env: { ...stage.env },
      index: instructions.length, startLine, headerEndLine };
    if (op === "RUN") instruction.argv = words(args);
    stage.instructions.push(instruction); instructions.push(instruction);
  }
  return instructions;
}
function copy(instruction) {
  const tokens = words(instruction.args);
  const from = tokens[0]?.startsWith("--from=") ? tokens.shift().slice(7) : undefined;
  contract(tokens.length === 2 && !tokens.some(value => value.startsWith("--") || value.startsWith("[")),
    "COPY supports one literal source/destination and only --from=stage");
  const [source, destination] = tokens;
  contract(from || source === "." || source === "package*.json" || !/[?*[\]]/.test(source), "unsupported context COPY glob");
  const directory = source === "." || destination === "." || destination.endsWith("/") || source === "package*.json";
  const destinationRoot = dockerPath(destination, instruction.cwd);
  const resolvedSource = from ? dockerPath(source, "/") : path.posix.normalize(source);
  contract(from || (!resolvedSource.startsWith("/") && !resolvedSource.split("/").includes("..")), "context COPY escapes its root");
  return { from, source: resolvedSource, destination: destinationRoot,
    target: directory && source !== "." && source !== "package*.json"
      ? path.posix.join(destinationRoot, path.posix.basename(resolvedSource)) : destinationRoot, directory };
}
function inlinePaths(instruction, language, count) {
  const prefix = language === "python" ? ["python", "-B", "-"] : ["node", "-"];
  contract(instruction.body && instruction.cwd && instruction.argv.length === prefix.length + count &&
    prefix.every((value, i) => instruction.argv[i] === value), "unsupported " + language + " heredoc invocation");
  instruction.pathArguments = instruction.argv.map((_, i) => i).slice(prefix.length);
  return instruction.pathArguments.map(i => dockerPath(instruction.argv[i], instruction.cwd));
}
function bodyPaths(instruction, modules) {
  const imports = [...instruction.body.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  contract(imports.filter(value => !value.startsWith("node:")).sort().join("|") === modules.slice().sort().join("|"),
    "unexpected relative module/import path in " + instruction.stage.name);
}
function databaseCalls(instruction, name) {
  const calls = [...instruction.body.matchAll(new RegExp("\\b" + name + "\\s*\\(([^()]*)\\)", "g"))];
  contract(calls.length && calls.every(match => match[1].trim() === "databasePath"), name + " must consume the RUN database argument");
}
function dockerPlan(text) {
  const instructions = dockerInstructions(text), stages = [...new Set(instructions.map(item => item.stage))];
  contract(stages.length === 4, "unsupported stage graph");
  const python = stages.find(stage => /^python:3\.12(?:\.\d+)?-slim-bookworm(?:@sha256:[a-f0-9]+)?$/.test(stage.base));
  contract(python, "approved Python preparation stage required");
  const preparation = python.instructions.filter(item => item.op === "RUN");
  const copying = preparation.find(item => item.body?.includes("shutil.copyfileobj"));
  const prepare = preparation.find(item => item.argv.includes("prepare"));
  const validate = preparation.find(item => item.body?.includes("validate_target("));
  contract(preparation.length === 3 && copying && prepare && validate && copying.index < prepare.index && prepare.index < validate.index,
    "exact copy/prepare/full-validation order required");
  const [sourceDB, outputDB, outputProof] = inlinePaths(copying, "python", 3);
  const validationPaths = inlinePaths(validate, "python", 3);
  contract(validationPaths.join("|") === [sourceDB, outputDB, outputProof].join("|"), "post-validation paths differ from copy producer");
  contract(new Set([sourceDB, outputDB, outputProof]).size === 3, "source/output/proof paths must be distinct");
  for (const instruction of [copying, validate]) {
    contract(/source\s*,\s*output\s*,\s*proof_path\s*=\s*map\(\s*Path\s*,\s*sys\.argv\[1:4\]\s*\)/.test(instruction.body), "unsupported Python argv binding");
    contract(!/CREATE\s+TABLE|PRAGMA\s+user_version\s*=/i.test(instruction.body), "parallel schema mutation in heredoc");
  }
  for (const expression of [/inspect_database\(/, /legacy_current/, /current/, /\.open\(["']xb["']\)/, /samefile\(/, /st_dev/, /st_ino/])
    contract(expression.test(copying.body), "missing independent-copy/canonical source gate");
  contract(/readonly_connection\(/.test(validate.body) && /classify_connection\(/.test(validate.body), "missing canonical read-only validation");
  const inputCopies = python.instructions.filter(item => item.op === "COPY"), inputs = inputCopies.map(copy);
  contract(inputs.length === 3 && inputs.every(item => !item.from) &&
    inputs.map(item => item.source).sort().join("|") === ["database-schema-contract.json", "matfinder.db", "scripts/migrate.py"].sort().join("|"), "preparation COPY inputs changed");
  contract(inputCopies.every(item => item.index < copying.index), "preparation COPY after execution");
  const sourceCopy = inputs.find(item => item.source === "matfinder.db");
  const runnerCopy = inputs.find(item => item.source === "scripts/migrate.py");
  const contractCopy = inputs.find(item => item.source === "database-schema-contract.json");
  contract(sourceCopy.target === sourceDB, "source DB COPY destination differs from copy RUN argument");
  contract(prepare.argv.length === 6 && prepare.argv[0] === "python" && prepare.argv[1] === "-B" &&
    prepare.argv[3] === "prepare" && prepare.argv[4] === "--database", "unsupported canonical prepare invocation");
  prepare.pathArguments = [2, 5];
  contract(dockerPath(prepare.argv[2], prepare.cwd) === runnerCopy.target, "prepare RUN cannot resolve copied migrate runner");
  contract(dockerPath(prepare.argv[5], prepare.cwd) === outputDB, "prepare database differs from independent output");
  contract(contractCopy.target === path.posix.join(path.posix.dirname(path.posix.dirname(runnerCopy.target)), "database-schema-contract.json"),
    "contract COPY destination differs from canonical runner CONTRACT_PATH");
  for (const instruction of [copying, validate]) {
    const scriptDirectory = /sys\.path\.insert\(\s*0\s*,\s*str\(\s*Path\(["']([^"']+)["']\)\.resolve\(\)\s*\)\s*\)/.exec(instruction.body);
    contract(scriptDirectory && dockerPath(scriptDirectory[1], instruction.cwd) === path.posix.dirname(runnerCopy.target),
      "Python WORKDIR/import path cannot resolve copied migrate runner");
  }
  const finalize = instructions.find(item => item.op === "RUN" && item.body?.includes("await buildCatalogStats("));
  contract(finalize, "existing stats finalizer required");
  const node = finalize.stage, [finalDB, finalProof] = inlinePaths(finalize, "node", 2);
  const nodeCopies = node.instructions.filter(item => item.op === "COPY");
  const applicationCopy = nodeCopies.find(item => !copy(item).from && copy(item).source === ".");
  const packageCopy = nodeCopies.find(item => !copy(item).from && copy(item).source === "package*.json");
  const preparedCopy = nodeCopies.find(item => copy(item).from === python.name && copy(item).source === outputDB);
  const proofCopy = nodeCopies.find(item => copy(item).from === python.name && copy(item).source === outputProof);
  const install = node.instructions.find(item => item.op === "RUN" && item.argv[0] === "npm");
  contract(nodeCopies.length === 4 && applicationCopy && packageCopy && preparedCopy && proofCopy && install, "missing/ambiguous application, prepared DB or proof COPY source");
  contract(install.argv.join("|") === "npm|install|--omit=dev" && node.instructions.filter(item => item.op === "RUN").length === 2, "unsupported install/finalization command");
  const app = copy(applicationCopy).target;
  contract(copy(packageCopy).target === app && install.cwd === app && finalize.cwd === app, "Node WORKDIR differs from application/package COPY destination");
  contract(copy(preparedCopy).target === finalDB, "prepared DB COPY destination differs from finalizer DB argument");
  contract(copy(proofCopy).target === finalProof, "proof COPY destination differs from finalizer proof argument");
  contract(finalize.env.MATFINDER_DB_PATH && dockerPath(finalize.env.MATFINDER_DB_PATH, finalize.cwd) === finalDB, "finalizer DB argument differs from runtime DB environment");
  contract(packageCopy.index < install.index && install.index < applicationCopy.index && applicationCopy.index < preparedCopy.index &&
    applicationCopy.index < proofCopy.index && preparedCopy.index < finalize.index && proofCopy.index < finalize.index, "application/DB/proof placement order changed");
  contract(!node.instructions.some(item => item.index > finalize.index && ["COPY", "RUN"].includes(item.op)), "mutation after finalization");
  contract(/const\s*\[\s*databasePath\s*,\s*proofPath\s*\]\s*=\s*process\.argv\.slice\(\s*2\s*\)/.test(finalize.body), "unsupported finalizer argv binding");
  databaseCalls(finalize, "digestFile"); databaseCalls(finalize, "buildCatalogStats"); databaseCalls(finalize, "MaterialRepository");
  contract(/readFileSync\(\s*proofPath\s*,/.test(finalize.body), "proof reader must consume the RUN proof argument");
  bodyPaths(finalize, ["./catalog-policy", "./catalog-stats-artifact", "./scripts/build-catalog-stats"]);
  const runtime = stages.at(-1), runtimeCopies = runtime.instructions.filter(item => item.op === "COPY");
  const runtimeRuns = runtime.instructions.filter(item => item.op === "RUN"), verify = runtimeRuns[0];
  contract(runtimeCopies.length === 1 && runtimeRuns.length === 1 && verify, "runtime requires one artifact COPY and one verification RUN");
  const runtimeCopy = runtimeCopies[0], finalSet = copy(runtimeCopy);
  contract(finalSet.from === node.name && finalSet.source === app, "runtime COPY must consume the actual finalized application stage/path");
  const runtimeApp = finalSet.target, [runtimeDB] = inlinePaths(verify, "node", 1);
  const relativeDB = path.posix.relative(app, finalDB);
  contract(relativeDB && !relativeDB.startsWith("../") && !path.posix.isAbsolute(relativeDB), "final DB is outside finalized artifact set");
  contract(verify.cwd === runtimeApp, "runtime WORKDIR differs from copied application root");
  contract(runtimeDB === path.posix.join(runtimeApp, relativeDB), "runtime verification DB argument differs from copied final DB");
  contract(verify.env.MATFINDER_DB_PATH && dockerPath(verify.env.MATFINDER_DB_PATH, verify.cwd) === runtimeDB, "runtime DB environment differs from verification argument");
  contract(verify.index > runtimeCopy.index && /const\s+databasePath\s*=\s*process\.argv\[2\]/.test(verify.body), "runtime copy/argv order changed");
  databaseCalls(verify, "digestFile"); databaseCalls(verify, "MaterialRepository");
  bodyPaths(verify, ["./catalog-policy", "./catalog-stats-artifact"]);
  for (const instruction of [finalize, verify]) contract(/initializeCatalogStats\(/.test(instruction.body) &&
    /assert\.ok\(generation/.test(instruction.body) && /process\.exitCode\s*=\s*1/.test(instruction.body), "missing hard artifact/failure gate");
  contract(!/buildCatalogStats|migrate\.py|child_process|PRAGMA\s+user_version\s*=/i.test(verify.body), "runtime verification must remain read-only");
  const commands = runtime.instructions.filter(item => item.op === "CMD");
  contract(commands.length === 1 && commands[0].cwd === runtimeApp && JSON.stringify(JSON.parse(commands[0].args)) === '["node","server.js"]', "runtime startup command/WORKDIR changed");
  contract(node.base === runtime.base, "finalizer/runtime must share Node base");
  const base = stages.find(stage => stage.name === runtime.base);
  contract(base && /^node:22(?:\.\d+)*-bookworm-slim(?:@sha256:[a-f0-9]+)?$/.test(base.base) &&
    !base.instructions.some(item => ["RUN", "COPY"].includes(item.op)), "unsupported Node base/inheritance");
  contract(base.env.NODE_ENV === "production" && base.env.PORT === "3000", "required runtime environment changed");
  return { copying, prepare, validate, finalize, verify, python, node, runtime, inputCopies,
    packageCopy, applicationCopy, preparedCopy, proofCopy, runtimeCopy, sourceDB, outputDB, outputProof,
    finalDB, finalProof, runtimeDB, app, runtimeApp, stages: stages.map(stage => stage.name) };
}
function changeHeader(text, instruction, args) {
  const lines = text.split(/\r?\n/);
  lines.splice(instruction.startLine, instruction.headerEndLine - instruction.startLine + 1,
    instruction.op + " " + args + instruction.suffix);
  return lines.join("\n");
}
function contractCases(text, plan) {
  const different = file => path.posix.join(path.posix.dirname(file), "missing-" + path.posix.basename(file));
  const argument = (instruction, index, value) => {
    const tokens = words(instruction.args); tokens[index] = value;
    return changeHeader(text, instruction, tokens.join(" "));
  };
  const insertBefore = (instruction, line) => {
    const lines = text.split(/\r?\n/); lines.splice(instruction.startLine, 0, line); return lines.join("\n");
  };
  const input = source => plan.inputCopies.find(item => copy(item).source === source);
  const cases = [
    ["M1-wrong-final-DB-argument", argument(plan.finalize, 2, path.posix.join(path.posix.dirname(plan.finalDB), "missing-final-db.db"))],
    ["M2-wrong-prepared-COPY-destination", argument(plan.preparedCopy, 2, different(plan.finalDB))],
    ["M3-wrong-prepared-COPY-source", argument(plan.preparedCopy, 1, different(plan.outputDB))],
    ["M4-wrong-finalizer-proof-argument", argument(plan.finalize, 3, different(plan.finalProof))],
    ["M5-wrong-proof-COPY-destination", argument(plan.proofCopy, 2, different(plan.finalProof))],
    ["M6-wrong-Python-WORKDIR", insertBefore(plan.copying, "WORKDIR /missing-python-import-root")],
    ["M7-wrong-contract-COPY-destination", argument(input("database-schema-contract.json"), 1, "/unusable/")],
    ["M8-wrong-runner-COPY-destination", argument(input("scripts/migrate.py"), 1, "/unusable/migrate.py")],
    ["M9-wrong-stats-builder-DB-argument", text.replace(/await\s+buildCatalogStats\(databasePath\)/, 'await buildCatalogStats("/missing-stats-db.db")')],
    ["M10-wrong-runtime-artifact-source", argument(plan.runtimeCopy, 1, different(plan.app))],
    ["A1-wrong-source-RUN-argument", argument(plan.copying, 3, different(plan.sourceDB))],
    ["A2-wrong-post-validation-DB-argument", argument(plan.validate, 4, different(plan.outputDB))],
    ["A3-wrong-produced-proof-path", argument(plan.copying, 5, different(plan.outputProof))],
    ["A4-wrong-runtime-verify-DB-argument", argument(plan.verify, 2, different(plan.runtimeDB))],
    ["A5-unsupported-shell-chain", changeHeader(text, plan.prepare, plan.prepare.args + " && echo ignored")],
    ["A6-unsupported-COPY-option", changeHeader(text, plan.preparedCopy, "--link " + plan.preparedCopy.args)],
    ["A7-wrong-Node-WORKDIR", insertBefore(plan.finalize, "WORKDIR /missing-node-import-root")],
    ["A8-wrong-runtime-WORKDIR", insertBefore(plan.verify, "WORKDIR /missing-runtime-import-root")],
    ["A9-prepared-COPY-removed", changeHeader(text, plan.preparedCopy, plan.preparedCopy.args).split(/\r?\n/).filter((_, i) => i !== plan.preparedCopy.startLine).join("\n")],
    ["A10-late-application-overwrite", insertBefore(plan.runtime.instructions[0], "COPY . .")],
    ["A11-Python-startup", text.replace(/CMD\s+\["node",\s*"server\.js"\]/, 'CMD ["python","scripts/migrate.py"]')],
    ["A12-prepare-source-path", argument(plan.prepare, 5, plan.sourceDB)],
    ["A13-runtime-context-COPY", changeHeader(text, plan.runtimeCopy, ". .")],
    ["A14-lifecycle-COPY-removed", changeHeader(text, input("scripts/migrate.py"), "missing-migrate.py ./scripts/migrate.py")]
  ];
  let renamed = text;
  plan.stages.forEach((name, index) => {
    renamed = renamed.replace(new RegExp("(\\bAS\\s+|--from=|\\bFROM\\s+)" + name + "(?=\\s|$)", "g"), "$1renamed-stage-" + index);
  });
  const positives = [text, text.replace(/\r?\n/g, "\r\n"), "# Harmless comment\n" + text.replace(/^COPY /gm, "  COPY   "),
    changeHeader(text, plan.finalize, words(plan.finalize.args).join(" \\\n  ")), renamed];
  positives.forEach(value => dockerPlan(value));
  for (const [name, variant] of cases) {
    assert.notEqual(variant, text, "Mutation did not alter Dockerfile: " + name);
    assert.throws(() => dockerPlan(variant), /P3A invocation contract:/, "Mutation escaped contract gate: " + name);
    console.log("P3A-BR-01 " + name + ": REJECT");
  }
  console.log(`P3A-BR-01 contract: ${positives.length}/${positives.length} positive controls PASS; ${cases.length}/${cases.length} mutations REJECT; no skips`);
}

// Focused Dockerignore evaluator: repository rules use glob stars, character
// classes, directory ancestry and last-match negation. No Docker dependency.
function glob(pattern) {
  let result = "";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { i++; result += "(?:.*/)?"; } else result += ".*";
    } else if (character === "*") result += "[^/]*";
    else if (character === "?") result += "[^/]";
    else if (character === "[") {
      const end = pattern.indexOf("]", i + 1);
      assert.ok(end > i, "Unsupported Dockerignore character class");
      result += pattern.slice(i, end + 1); i = end;
    } else result += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + result + "$");
}
function ignored(file, text) {
  const normalized = file.replaceAll("\\", "/");
  const pieces = normalized.split("/"), ancestors = pieces.map((_, index) => pieces.slice(0, index + 1).join("/"));
  let excluded = false;
  for (let rule of text.split(/\r?\n/).map(line => line.trim())) {
    if (!rule || rule.startsWith("#")) continue;
    const negate = rule.startsWith("!");
    if (negate) rule = rule.slice(1);
    const matches = glob(rule.replace(/^\/+|\/+$/g, ""));
    if (ancestors.some(name => matches.test(name))) excluded = !negate;
  }
  return excluded;
}
function contextGate(text) {
  for (const file of ["PROJECT_STATE.md", "scripts/__pycache__/write-materials-sqlite.cpython-312.pyc",
    "nested/new.pyc", "nested/NEW.PYC", "runtime/unknown.pyo", "nested/archive.pyz",
    "matfinder.db-wal", "nested/copy.db-shm", "nested/copy.db-journal", "nested/output.db",
    "matfinder.db.catalog-stats.json", "nested/copy.db.catalog-stats.json",
    "nested/copy.db.catalog-stats.json.tmp-1", "server.log", ".codex/local.json",
    ".agents/local.json", "worktrees/copy/Dockerfile", "review-output/results.json"])
    assert.equal(ignored(file, text), true, "Context leaked: " + file);
  const policy = JSON.parse(fs.readFileSync(path.join(root, "scripts/schema-authority-policy.json"), "utf8"));
  for (const file of ["matfinder.db", "database-schema-contract.json", "package.json", "package-lock.json",
    "scripts/migrate.py", "scripts/build-catalog-stats.js", ...policy.productionFiles])
    assert.equal(ignored(file, text), false, "Required context input excluded: " + file);
}
function execute(command, args, input, cwd = root, env = {}) {
  return spawnSync(command, args, { cwd, input, encoding: "utf8", windowsHide: true,
    timeout: 120000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env, PYTHONDONTWRITEBYTECODE: "1" } });
}
function successful(result, label) {
  assert.equal(result.status, 0, label + " failed: " + (result.stderr || result.stdout || result.error));
  return result;
}
function lastJSON(output) {
  return JSON.parse(output.trim().split(/\r?\n/).at(-1));
}
function mutation(file, sql) {
  const database = new DatabaseSync(file);
  try { database.exec(sql); } finally { database.close(); }
}
function tempBoundary(directory) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "OS Temp descendant required");
}
async function repositoryArtifacts() {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if ([".git", ".codex", ".agents", "node_modules", "PROJECT_STATE.md"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && (/\.(db|sqlite|sqlite3|pyc|pyo|pyz)$/i.test(entry.name) ||
        /-wal$|-shm$|-journal$|\.catalog-stats\.json/.test(entry.name))) files.push(file);
    }
  }
  visit(root);
  const result = {};
  for (const file of files.sort()) result[path.relative(root, file).replaceAll("\\", "/")] = await digestFile(file);
  return result;
}
async function hostRuntime(file, expectedDigest, cwd) {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const beforeStats = await digestFile(artifactPath(file));
  const child = spawn(process.execPath, [__filename, "--runtime-probe"], {
    cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), MATFINDER_DB_PATH: file,
      OPENAI_API_KEY: "", MATFINDER_ADMIN_TOKEN: "" }
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  const ended = new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  try {
    const deadline = Date.now() + 15000;
    while (!stdout.includes("after_http_listen")) {
      if (child.exitCode !== null || Date.now() > deadline) throw Error(stderr || stdout || "Host startup timeout");
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const proof = stdout.split(/\r?\n/).filter(line => line.startsWith('{"status":"host-runtime-verified"')).map(JSON.parse)[0];
    assert.equal(proof?.datasetDigest, expectedDigest);
    for (const endpoint of ["live", "health", "catalog-stats"])
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/${endpoint}`)).status, 200);
    const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
    if (loadArtifact(artifactPath(file)).publicMaterialTotal === 0) {
      assert.equal(ready.status, 503);
      assert.equal((await ready.json()).reason, "no_verified_public_grades");
    } else assert.ok([200, 503].includes(ready.status));
  } finally {
    if (child.exitCode === null) child.kill();
    await ended;
    assert.equal(await digestFile(file), expectedDigest, "Host runtime changed DB");
    assert.equal(await digestFile(artifactPath(file)), beforeStats, "Host runtime changed stats");
    for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(fs.existsSync(file + suffix), false);
  }
}

function mappedPath(stageRoot, dockerFile) {
  tempBoundary(stageRoot);
  contract(path.posix.isAbsolute(dockerFile) && dockerPath(dockerFile, "/") === dockerFile, "mapping requires a resolved Docker path");
  const mapped = path.resolve(stageRoot, ...path.posix.relative("/", dockerFile).split("/"));
  const relative = path.relative(stageRoot, mapped);
  contract(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), "mapped path escaped stage root");
  tempBoundary(mapped);
  return mapped;
}
function contextFiles(ignore) {
  const files = [];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
      // Never read the carrier, even through a caller-supplied Dockerfile variant.
      if (entry.name === "PROJECT_STATE.md" || ignored(file, ignore)) continue;
      contract(!entry.isSymbolicLink(), "host context mapping does not support symlinks: " + file);
      if (entry.isDirectory()) visit(file);
      else { contract(entry.isFile(), "context requires ordinary files"); files.push(file); }
    }
  }
  visit("");
  return files.sort();
}
function makeHarness(plan, directory, ignore, python, steps) {
  const contexts = contextFiles(ignore), cases = new Map();
  function paths(name) {
    contract(/^[a-z0-9-]+$/.test(name), "invalid fixture name");
    if (!cases.has(name)) {
      const roots = new Map(plan.stages.map((stage, index) => [stage, path.join(directory, name, "stage-" + index)]));
      const at = (stage, file) => mappedPath(roots.get(stage.name), file);
      cases.set(name, { roots, at, output: at(plan.python, plan.outputDB), proof: at(plan.python, plan.outputProof),
        sourceCopy: at(plan.python, plan.sourceDB), finalDB: at(plan.node, plan.finalDB),
        finalProof: at(plan.node, plan.finalProof), runtimeDB: at(plan.runtime, plan.runtimeDB),
        runtimeCwd: at(plan.runtime, plan.verify.cwd) });
    }
    return cases.get(name);
  }
  function copyFile(source, destination) {
    tempBoundary(destination); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  function contextCopy(instruction, target) {
    const item = copy(instruction), selected = item.source === "." ? contexts : item.source === "package*.json"
      ? contexts.filter(file => /^package[^/]*\.json$/.test(file)) : [item.source];
    contract(selected.length && selected.every(file => contexts.includes(file)), "mapped COPY input absent/excluded");
    for (const file of selected) {
      const destination = item.source === "." ? path.posix.join(item.target, file) : item.source === "package*.json"
        ? path.posix.join(item.target, path.posix.basename(file)) : item.target;
      copyFile(file === "matfinder.db" ? target.input : path.join(root, file), target.at(instruction.stage, destination));
    }
  }
  function stageCopy(instruction, target) {
    const item = copy(instruction), sourceRoot = target.roots.get(item.from);
    contract(sourceRoot, "mapped COPY source stage missing");
    const source = mappedPath(sourceRoot, item.source), destination = target.at(instruction.stage, item.target);
    if (instruction === plan.runtimeCopy) {
      contract(fs.statSync(source).isDirectory(), "finalized application root absent");
      fs.mkdirSync(destination, { recursive: true }); fs.cpSync(source, destination, { recursive: true });
    } else copyFile(source, destination);
  }
  function run(instruction, target, label, requireSuccess = true) {
    if (label) steps.push(label);
    // Translate only path positions proven by dockerPlan; all other literal argv
    // and the exact heredoc body come from this actual Docker RUN instruction.
    const argv = instruction.argv.map((value, index) => instruction.pathArguments.includes(index)
      ? target.at(instruction.stage, dockerPath(value, instruction.cwd)) : value);
    const command = argv[0] === "python" ? python : process.execPath;
    const env = { ...instruction.env };
    if (env.MATFINDER_DB_PATH) env.MATFINDER_DB_PATH = target.at(instruction.stage, dockerPath(env.MATFINDER_DB_PATH, instruction.cwd));
    const result = execute(command, argv.slice(1), instruction.body ?? undefined, target.at(instruction.stage, instruction.cwd), env);
    return requireSuccess ? successful(result, label || "mapped RUN") : result;
  }
  function prepare(input, name) {
    const target = paths(name);
    if (!target.input) {
      target.input = input;
      plan.inputCopies.forEach(instruction => contextCopy(instruction, target));
    } else assert.equal(target.input, input);
    run(plan.copying, target, "copy");
    const prepared = run(plan.prepare, target, "prepare");
    run(plan.validate, target, "validate");
    target.evidence = JSON.parse(fs.readFileSync(target.proof, "utf8"));
    target.runner = lastJSON(prepared.stdout);
    return target;
  }
  function placeFinal(target) {
    if (target.placed) return;
    for (const instruction of plan.node.instructions.filter(item => item.op === "COPY")) {
      if (copy(instruction).from) stageCopy(instruction, target); else contextCopy(instruction, target);
    }
    target.placed = true;
  }
  function finalize(target) {
    placeFinal(target);
    const finalized = lastJSON(run(plan.finalize, target, "finalize").stdout);
    stageCopy(plan.runtimeCopy, target);
    const verified = lastJSON(run(plan.verify, target, "verify").stdout);
    return { finalized, verified };
  }
  return { paths, prepare, placeFinal, finalize, run };
}
function requestedDockerfile() {
  const args = process.argv.slice(2), known = new Set(["--contract-only", "--dockerfile"]);
  let file = path.join(root, "Dockerfile");
  for (let i = 0; i < args.length; i++) {
    contract(known.has(args[i]), "unsupported test argument: " + args[i]);
    if (args[i] === "--dockerfile") {
      contract(args[i + 1], "--dockerfile requires a Temp fixture");
      file = path.resolve(args[++i]); tempBoundary(file);
      const stat = fs.lstatSync(file);
      contract(stat.isFile() && !stat.isSymbolicLink(), "Dockerfile override must be an ordinary Temp file");
    }
  }
  return fs.readFileSync(file, "utf8");
}

async function main() {
  const docker = requestedDockerfile();
  const ignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
  const plan = dockerPlan(docker);
  contractCases(docker, plan);
  contextGate(ignore);
  assert.throws(() => contextGate(ignore + "\n!matfinder.db.catalog-stats.json\n"), /Context leaked/);
  assert.throws(() => contextGate(ignore + "\nmatfinder.db\n"), /Required context input excluded/);
  if (process.argv.includes("--contract-only")) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:schema-build"], "node scripts/test-schema-build.js");
  assert.match(pkg.scripts["test:acceptance"], /test:schema-integration\s*&&\s*npm run test:schema-build\s*&&/);
  // No host npm installation: the current application uses only built-ins.
  // A future dependency requires a reviewed host mapping, rather than bypassing it.
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.deepEqual(pkg.devDependencies || {}, {});
  const policy = JSON.parse(fs.readFileSync(path.join(root, "scripts/schema-authority-policy.json"), "utf8"));
  assert.equal(policy.excluded.filter(file => file === "scripts/test-schema-build.js").length, 1);
  assert.ok(!policy.productionFiles.includes("scripts/test-schema-build.js"));
  const authority = guard.audit(root);
  console.log("P3-05/10/13 STATIC: PASS; context/acceptance/authority: PASS " + JSON.stringify(authority));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-p3-build-"));
  tempBoundary(directory);
  const originalArtifacts = await repositoryArtifacts();
  const python = guard.python(), source = path.join(root, "matfinder.db");
  const sourceDigest = await digestFile(source);
  const steps = [];
  const { paths, prepare, placeFinal, finalize, run } = makeHarness(plan, directory, ignore, python, steps);
  const failureCases = [];
  async function rejectSource(name, input, expected, expectedSteps) {
    const before = await digestFile(input), start = steps.length;
    assert.throws(() => { const target = prepare(input, name); finalize(target); }, expected);
    assert.deepEqual(steps.slice(start), expectedSteps);
    assert.equal(fs.existsSync(artifactPath(paths(name).output)), false);
    assert.equal(await digestFile(input), before);
    failureCases.push(name);
  }
  try {
    const current = prepare(source, "tracked-source");
    assert.equal(current.evidence.sourceDigest, sourceDigest);
    assert.equal(current.evidence.userVersion, 1);
    assert.equal(current.evidence.classification, "current");
    assert.equal(current.evidence.compatible, true);
    const sourceStat = fs.statSync(source), outputStat = fs.statSync(current.output);
    if (sourceStat.ino && outputStat.ino) assert.notDeepEqual([sourceStat.dev, sourceStat.ino], [outputStat.dev, outputStat.ino]);
    if (current.evidence.sourceVersion === 0) assert.notEqual(current.evidence.preparedDigest, sourceDigest);
    const before = await digestFile(current.output), identity = finalize(current);
    assert.equal(await digestFile(current.output), before);
    assert.equal(identity.finalized.datasetDigest, before);
    assert.deepEqual({ ...identity.finalized, status: "runtime-artifact-verified" }, identity.verified);
    await hostRuntime(current.runtimeDB, before, current.runtimeCwd);
    console.log("P3-01/02/03/04/06/09 HOST: PASS " + JSON.stringify({ ...current.evidence,
      policyDigest: identity.verified.policyDigest, formatVersion: identity.verified.formatVersion }));

    const formal = path.join(directory, "formal-source.db");
    bootstrapFixture(formal);
    const already = prepare(formal, "already-v1");
    assert.equal(already.runner.result, "already_current");
    assert.equal(already.evidence.sourceDigest, already.evidence.preparedDigest);
    finalize(already);
    console.log("Already-v1 independent copy / full validation / fresh stats: PASS");

    const legacy = path.join(directory, "legacy-source.db");
    fs.copyFileSync(formal, legacy); mutation(legacy, "PRAGMA user_version=0");
    const negative = prepare(legacy, "old-stats");
    finalize(negative);
    const sidecar = artifactPath(negative.runtimeDB), valid = fs.readFileSync(sidecar);
    const artifact = loadArtifact(sidecar);
    for (const [name, change] of [
      ["source-v0-digest", value => { value.datasetDigest = negative.evidence.sourceDigest; }],
      ["wrong-policy", value => { value.policyDigest = "0".repeat(64); }],
      ["wrong-format", value => { value.formatVersion += 1; }]
    ]) {
      const wrong = structuredClone(artifact); change(wrong);
      fs.writeFileSync(sidecar, JSON.stringify(wrong));
      if (name !== "wrong-format") loadArtifact(sidecar); // Prove valid-format negative fixture.
      const result = run(plan.verify, negative, null, false);
      assert.equal(result.status, 1, name);
      assert.ok(!result.stdout.includes('"status":"runtime-artifact-verified"'));
      failureCases.push(name);
    }
    fs.unlinkSync(sidecar);
    assert.equal(run(plan.verify, negative, null, false).status, 1);
    failureCases.push("missing-stats");
    fs.writeFileSync(sidecar, valid);
    run(plan.verify, negative, "verify");
    console.log("P3-07 HOST: valid-format source-v0 identity REJECT; policy/format/missing artifact REJECT");

    for (const [name, sql, expected] of [
      ["drift-source", "ALTER TABLE materials ADD COLUMN p3_rogue TEXT", /structural_drift/],
      ["future-source", "PRAGMA user_version=999", /future_version/],
      ["unsupported-source", "PRAGMA user_version=-1", /version_mismatch/],
      ["prepare-fk-failure", "PRAGMA foreign_keys=OFF; PRAGMA user_version=0; INSERT INTO material_evidence(material_id,source_type,verification_status,confidence_level) VALUES('p3-orphan','unknown','unverified','low')", /integrity\/FK check failed/],
      ["already-v1-fk-failure", "PRAGMA foreign_keys=OFF; INSERT INTO material_evidence(material_id,source_type,verification_status,confidence_level) VALUES('p3-orphan','unknown','unverified','low')", /integrity\/FK check failed/]
    ]) {
      const input = path.join(directory, name + ".db"); fs.copyFileSync(formal, input); mutation(input, sql);
      await rejectSource(name, input, expected,
        name === "prepare-fk-failure" ? ["copy", "prepare"] : name === "already-v1-fk-failure" ? ["copy", "prepare", "validate"] : ["copy"]);
    }
    for (const [name, contents] of [["blank-source", ""], ["corrupt-source", "not SQLite"]]) {
      const input = path.join(directory, name + ".db"); fs.writeFileSync(input, contents);
      await rejectSource(name, input, /unsupported build source|unsupported database header/, ["copy"]);
    }
    const alias = paths("hardlink-output"); fs.mkdirSync(path.dirname(alias.output), { recursive: true });
    fs.linkSync(formal, alias.output);
    const formalDigest = await digestFile(formal);
    assert.throws(() => prepare(formal, "hardlink-output"), /FileExistsError/);
    assert.equal(await digestFile(formal), formalDigest);
    assert.equal(fs.existsSync(alias.proof), false);
    failureCases.push("preexisting-hardlink-output");

    const statsFailure = prepare(formal, "stats-failure");
    placeFinal(statsFailure);
    fs.writeFileSync(statsFailure.finalDB + "-journal", "");
    assert.throws(() => finalize(statsFailure), /side|journal/i);
    assert.equal(fs.existsSync(artifactPath(statsFailure.finalDB)), false);
    fs.unlinkSync(statsFailure.finalDB + "-journal");
    assert.equal(await digestFile(statsFailure.finalDB), statsFailure.evidence.preparedDigest);
    assert.equal(await digestFile(statsFailure.output), statsFailure.evidence.preparedDigest);
    failureCases.push("stats-generation-failure");
    const placementFailure = prepare(formal, "placement-failure");
    const wrongProof = { ...placementFailure.evidence, preparedDigest: "0".repeat(64) };
    fs.writeFileSync(placementFailure.proof, JSON.stringify(wrongProof));
    assert.throws(() => finalize(placementFailure), /Prepared bytes changed during placement/);
    assert.equal(fs.existsSync(artifactPath(placementFailure.finalDB)), false);
    failureCases.push("prepared-placement-mismatch");
    console.log("P3-11/12 HOST failure paths: PASS " + JSON.stringify(failureCases));
    const versions = successful(execute(python, ["-B", "-c", 'import json,sqlite3,sys; print(json.dumps({"python":sys.version.split()[0],"sqlite":sqlite3.sqlite_version}))']), "host versions");
    console.log("HOST versions only: " + versions.stdout.trim() + "; Node " + process.version);
  } finally {
    assert.equal(await digestFile(source), sourceDigest, "P3-01: tracked source modified");
    assert.deepEqual(await repositoryArtifacts(), originalArtifacts, "P3-14: repository DB/stats/bytecode inventory changed");
    tempBoundary(directory); // Validate the resolved target before recursive removal.
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("P3A-BR-01 mapped stage filesystem / actual RUN argv+cwd / downstream COPY: PASS");
  console.log("P3-14 HOST: PASS; P3A HOST/STATIC REGRESSIONS: PASS");
  console.log("P3B IMAGE GATES: NOT EXECUTED — HOST/STATIC SUITE DOES NOT RUN DOCKER");
}
