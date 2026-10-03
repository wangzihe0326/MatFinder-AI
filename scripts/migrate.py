"""Explicit offline lifecycle; the JSON contract is the only schema source."""
import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "database-schema-contract.json"
INTERNAL_TABLES = {"sqlite_sequence", "sqlite_stat1"}


class LifecycleError(ValueError):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


def stable(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def tokens(sql):
    """Lexer for frozen DDL forms, not a general SQL parser."""
    result = []
    i = 0
    while i < len(sql):
        c = sql[i]
        if c.isspace():
            i += 1
        elif sql.startswith("--", i):
            end = sql.find("\n", i)
            i = len(sql) if end < 0 else end + 1
        elif sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            if end < 0:
                raise LifecycleError("unterminated SQL comment")
            i = end + 2
        elif c in "'\"`[":
            closing = "]" if c == "[" else c
            start = i
            i += 1
            value = ""
            while i < len(sql):
                if sql[i] == closing:
                    if closing != "]" and i + 1 < len(sql) and sql[i + 1] == closing:
                        value += closing
                        i += 2
                        continue
                    i += 1
                    break
                value += sql[i]
                i += 1
            else:
                raise LifecycleError("unterminated SQL quote")
            if c == "'":
                result.append(sql[start:i])  # literal contents are never lowercased
            elif re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", value):
                result.append(sql[start:i])  # retain quote category until an identifier context
            else:
                raise LifecycleError("unsupported quoted identifier")
        else:
            match = re.match(r"[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(),=;]", sql[i:])
            if not match:
                raise LifecycleError("unsupported SQL token at " + sql[i:i + 24])
            result.append(match[0].lower())
            i += len(match[0])
    return result


class Cursor:
    def __init__(self, values):
        self.values, self.pos = values, 0

    def peek(self):
        return self.values[self.pos] if self.pos < len(self.values) else None

    def pop(self):
        value = self.peek()
        if value is None:
            raise LifecycleError("unexpected end of SQL")
        self.pos += 1
        return value

    def take(self, word):
        if self.peek() == word:
            self.pos += 1
            return True
        return False

    def need(self, word):
        if not self.take(word):
            raise LifecycleError("expected SQL token " + word)

    def group(self):
        self.need("(")
        start, depth = self.pos, 1
        while depth:
            value = self.pop()
            depth += (value == "(") - (value == ")")
        return self.values[start:self.pos - 1]

    def done(self):
        self.take(";")
        if self.peek() is not None:
            raise LifecycleError("unsupported SQL clause: " + str(self.peek()))


def strip_outer(values):
    while values and values[0] == "(":
        cur = Cursor(values)
        group = cur.group()
        if cur.peek() is not None:
            break
        values = group
    return values


def scalar(value):
    return bool(re.fullmatch(r"[0-9]+", value) or value.startswith("'"))


def expression(values, default=False, columns=()):
    values = strip_outer(values)
    if default:
        if len(values) != 1 or not (scalar(values[0]) or values[0] == "null"):
            raise LifecycleError("unsupported default expression")
    else:
        cur = Cursor(values)
        column = identifier(cur.pop())
        if column not in columns:
            raise LifecycleError("expression references unknown column")
        values = [column, *values[1:]]
        if cur.take("in"):
            items = cur.group()
            if not items or any(not scalar(v) if i % 2 == 0 else v != ","
                                for i, v in enumerate(items)) or len(items) % 2 == 0:
                raise LifecycleError("unsupported IN expression")
        elif cur.take("is"):
            cur.need("not")
            cur.need("null")
        elif cur.take("="):
            if not scalar(cur.pop()):
                raise LifecycleError("unsupported equality expression")
        else:
            raise LifecycleError("unsupported expression operator")
        cur.done()
    return " ".join(values)


def identifier(value):
    # Only callers in a syntactic identifier position may remove quoting.
    if value and value[0] in '\"\x60[':
        value = value[1:-1].lower()
    if not re.fullmatch(r"[a-z_][a-z_0-9]*", value):
        raise LifecycleError("unsupported identifier " + value)
    return value


def split_items(values):
    items, start, depth = [], 0, 0
    for i, value in enumerate(values):
        depth += (value == "(") - (value == ")")
        if value == "," and depth == 0:
            items.append(values[start:i])
            start = i + 1
    items.append(values[start:])
    return items


def key_list(values):
    result = []
    for item in split_items(values):
        cur = Cursor(item)
        column = identifier(cur.pop())
        collation = identifier(cur.pop()) if cur.take("collate") else "binary"
        descending = cur.take("desc")
        if not descending:
            cur.take("asc")
        cur.done()
        result.append({"column": column, "collation": collation, "descending": descending})
    return result


def foreign_clause(cur, columns):
    cur.need("references")
    table = identifier(cur.pop())
    refs = [k["column"] for k in key_list(cur.group())]
    fk = {"columns": columns, "table": table, "references": refs,
          "onUpdate": "NO ACTION", "onDelete": "NO ACTION", "match": "NONE",
          "deferrable": False, "initiallyDeferred": False}
    seen = set()
    while cur.peek() in ("on", "match", "deferrable", "not"):
        if cur.take("on"):
            event = cur.pop()
            if event not in ("delete", "update") or event in seen:
                raise LifecycleError("unsupported FK action")
            seen.add(event)
            action = cur.pop()
            if action in ("no", "set"):
                action += " " + cur.pop()
            if action not in ("no action", "cascade", "restrict", "set null", "set default"):
                raise LifecycleError("unsupported FK action")
            fk["on" + event.title()] = action.upper()
        elif cur.take("match"):
            if "match" in seen:
                raise LifecycleError("duplicate FK match")
            seen.add("match")
            fk["match"] = identifier(cur.pop()).upper()
        else:
            if "deferrable" in seen:
                raise LifecycleError("duplicate FK deferrability")
            seen.add("deferrable")
            negative = cur.take("not")
            cur.need("deferrable")
            fk["deferrable"] = not negative
            if cur.take("initially"):
                timing = cur.pop()
                if timing not in ("deferred", "immediate"):
                    raise LifecycleError("unsupported FK timing")
                fk["initiallyDeferred"] = timing == "deferred"
    return fk


def parse_table(sql, name):
    cur = Cursor(tokens(sql))
    cur.need("create")
    cur.need("table")
    if cur.take("if"):
        cur.need("not"); cur.need("exists")
    if identifier(cur.pop()) != name:
        raise LifecycleError("table SQL name mismatch")
    entries = split_items(cur.group())
    # STRICT, WITHOUT ROWID, virtual/generated columns and conflict clauses are
    # outside the frozen forms; their presence fails closed rather than vanishing.
    cur.done()
    checks, fks, columns, primary, unique, autoincrement = [], [], {}, [], [], None
    for entry in entries:
        cur = Cursor(entry)
        if cur.take("check"):
            checks.append(cur.group())
        elif cur.take("foreign"):
            cur.need("key")
            keys = [k["column"] for k in key_list(cur.group())]
            fks.append(foreign_clause(cur, keys))
        elif cur.take("primary"):
            cur.need("key")
            if primary:
                raise LifecycleError("duplicate primary key")
            primary = key_list(cur.group())
        elif cur.take("unique"):
            unique.append(key_list(cur.group()))
        else:
            col = identifier(cur.pop())
            declared = cur.pop()
            if declared not in ("integer", "real", "text") or col in columns:
                raise LifecycleError("unsupported column declaration")
            info = {"type": declared.upper(), "notNull": False, "default": None,
                    "collation": "binary"}
            inline_pk, inline_unique, seen = None, False, set()
            while cur.peek() is not None:
                clause = cur.peek()
                if clause in seen:
                    raise LifecycleError("duplicate column clause")
                seen.add(clause)
                if cur.take("not"):
                    cur.need("null"); info["notNull"] = True
                elif cur.take("primary"):
                    cur.need("key")
                    descending = cur.take("desc")
                    if not descending:
                        cur.take("asc")
                    inline_pk = {"column": col, "collation": "binary", "descending": descending}
                    if cur.take("autoincrement"):
                        autoincrement = col
                elif cur.take("unique"):
                    inline_unique = True
                elif cur.take("collate"):
                    info["collation"] = identifier(cur.pop())
                elif cur.take("default"):
                    value = ["(", *cur.group(), ")"] if cur.peek() == "(" else [cur.pop()]
                    info["default"] = expression(value, default=True)
                elif cur.peek() == "references":
                    fks.append(foreign_clause(cur, [col]))
                elif cur.take("check"):
                    checks.append(cur.group())
                else:
                    raise LifecycleError("unsupported column clause " + str(cur.peek()))
            if inline_pk:
                if primary:
                    raise LifecycleError("duplicate primary key")
                inline_pk["collation"] = info["collation"]
                primary = [inline_pk]
            if inline_unique:
                unique.append([{"column": col, "collation": info["collation"], "descending": False}])
            columns[col] = info
        cur.done()
    # A table constraint inherits each column's collation unless specified.
    for keys in [primary, *unique]:
        for key in keys:
            if key["column"] not in columns:
                raise LifecycleError("constraint references unknown column")
            if key["collation"] == "binary":
                key["collation"] = columns[key["column"]]["collation"]
    return {"columns": columns, "primaryKey": primary, "unique": sorted(unique, key=stable),
            "checks": sorted(expression(v, columns=columns) for v in checks), "foreignKeys": sorted(fks, key=stable), "autoincrement": autoincrement}


def parse_index(sql, name, table, columns):
    cur = Cursor(tokens(sql))
    cur.need("create")
    unique = cur.take("unique")
    cur.need("index")
    if cur.take("if"):
        cur.need("not"); cur.need("exists")
    if identifier(cur.pop()) != name:
        raise LifecycleError("index SQL name mismatch")
    cur.need("on")
    if identifier(cur.pop()) != table:
        raise LifecycleError("index SQL table mismatch")
    keys = key_list(cur.group())
    predicate = None
    if cur.take("where"):
        remaining = cur.values[cur.pos:]
        if remaining and remaining[-1] == ";":
            remaining = remaining[:-1]
        predicate = expression(remaining, columns=columns)
        cur.pos = len(cur.values)
    cur.done()
    return {"name": name, "table": table, "unique": unique, "keys": keys, "predicate": predicate}


def pragma(conn, command, name):
    return conn.execute("PRAGMA " + command + "(" + quote(name) + ")").fetchall()


def inspect_structure(conn):
    rows = conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").fetchall()
    objects, tables, indexes = [], [], []
    auto_names = set()
    for kind, name, table, sql in rows:
        if name.startswith("sqlite_"):
            continue
        objects.append({"type": kind, "name": name, "table": table})
        if kind != "table":
            if kind != "index":
                raise LifecycleError("unsupported schema object " + kind + ": " + name)
            continue
        parsed = parse_table(sql, name)
        columns = []
        for cid, col, declared, not_null, default, pk, hidden in pragma(conn, "table_xinfo", name):
            if hidden or cid != len(columns) or col not in parsed["columns"]:
                raise LifecycleError("unsupported hidden/ordered column")
            columns.append({"name": col, "type": declared.upper(), "notNull": bool(not_null),
                            "default": None if default is None else expression(tokens(default), True),
                            "primaryKeyOrder": pk, "collation": parsed["columns"][col]["collation"]})
        declared_columns = [{"name": col, **info} for col, info in parsed["columns"].items()]
        for actual, declared in zip(columns, declared_columns):
            if any(actual[k] != declared[k] for k in ("name", "type", "notNull", "default", "collation")):
                raise LifecycleError("SQL/PRAGMA column mismatch: " + name + "." + actual["name"])
        unique, pk_keys, explicit = [], None, {}
        for seq, idx, is_unique, origin, partial in pragma(conn, "index_list", name):
            keys = []
            for seqno, cid, col, desc, coll, key in pragma(conn, "index_xinfo", idx):
                if not key:
                    continue
                if cid < 0 or col is None:
                    raise LifecycleError("unsupported expression index " + idx)
                keys.append({"column": col, "collation": coll.lower(), "descending": bool(desc)})
            if origin in ("pk", "u"):
                auto_names.add(idx)
                if not is_unique or partial:
                    raise LifecycleError("invalid automatic constraint index")
                if origin == "pk":
                    pk_keys = keys
                else:
                    unique.append(keys)
            elif origin == "c":
                explicit[idx] = (bool(is_unique), bool(partial), keys)
            else:
                raise LifecycleError("unsupported index origin")
        primary = parsed["primaryKey"]
        if pk_keys is not None and pk_keys != primary:
            raise LifecycleError("SQL/PRAGMA primary key mismatch")
        if sorted(unique, key=stable) != parsed["unique"]:
            raise LifecycleError("SQL/PRAGMA UNIQUE mismatch")
        pk_order = {k["column"]: i + 1 for i, k in enumerate(primary)}
        if any(c["primaryKeyOrder"] != pk_order.get(c["name"], 0) for c in columns):
            raise LifecycleError("SQL/PRAGMA primary order mismatch")
        foreign_rows = pragma(conn, "foreign_key_list", name)
        fk_groups = {}
        for fid, seq, ref_table, col, ref, on_update, on_delete, match in foreign_rows:
            fk_groups.setdefault(fid, []).append((seq, ref_table, col, ref, on_update, on_delete, match))
        fk_metadata = []
        for group in fk_groups.values():
            group.sort()
            fk_metadata.append({"columns": [r[2] for r in group], "table": group[0][1],
                                "references": [r[3] for r in group], "onUpdate": group[0][4], "onDelete": group[0][5]})
        sql_fk_metadata = [{k: f[k] for k in ("columns", "table", "references", "onUpdate", "onDelete")}
                           for f in parsed["foreignKeys"]]
        if sorted(fk_metadata, key=stable) != sorted(sql_fk_metadata, key=stable):
            raise LifecycleError("SQL/PRAGMA FK mismatch")
        alias = primary[0]["column"] if (len(primary) == 1 and pk_keys is None
                 and parsed["columns"][primary[0]["column"]]["type"] == "INTEGER") else None
        tables.append({"name": name, "columns": columns, "primaryKey": primary, "rowidAlias": alias,
                       "autoincrement": parsed["autoincrement"], "withoutRowid": False, "strict": False,
                       "unique": parsed["unique"], "checks": parsed["checks"], "foreignKeys": parsed["foreignKeys"]})
        for idx, (is_unique, partial, keys) in explicit.items():
            sql_row = next((r for r in rows if r[0] == "index" and r[1] == idx), None)
            if sql_row is None:
                raise LifecycleError("missing index SQL")
            definition = parse_index(sql_row[3], idx, name, parsed["columns"])
            # Omitted index COLLATE inherits the table column's collation.
            for key in definition["keys"]:
                if key["column"] not in parsed["columns"]:
                    raise LifecycleError("index references unknown column")
                if key["collation"] == "binary":
                    key["collation"] = parsed["columns"][key["column"]]["collation"]
            if (definition["unique"] != is_unique or (definition["predicate"] is not None) != partial
                    or definition["keys"] != keys):
                raise LifecycleError("SQL/PRAGMA index mismatch: " + idx)
            indexes.append(definition)
    for kind, name, table, sql in rows:
        if name.startswith("sqlite_") and name not in INTERNAL_TABLES and name not in auto_names:
            raise LifecycleError("unsupported internal schema object " + name)
    return {"objects": objects, "tables": sorted(tables, key=lambda t: t["name"]),
            "indexes": sorted(indexes, key=lambda i: i["name"])}


def validate_contract(c):
    """Validate consumer protocol and references, never a second app/version matrix."""
    def require(ok):
        if not ok:
            raise LifecycleError("invalid schema contract")
    def obj(v, fields, optional=()):
        require(type(v) is dict and set(fields) <= set(v) <= set(fields) | set(optional))
    def integer(v, minimum=0):
        require(type(v) is int and minimum <= v <= 2147483647)
    def name(v):
        require(type(v) is str and re.fullmatch(r"[a-z_][a-z_0-9]*", v) is not None)
    def array(v):
        require(type(v) is list)
    def boolean(v):
        require(type(v) is bool)
    def names(v, available):
        array(v); require(bool(v) and len(v) == len(set(v)) if all(type(x) is str for x in v) else False)
        for n in v:
            name(n); require(n in available)
    def keys(v, available, allow_empty=False):
        array(v); require(allow_empty or bool(v))
        seen = set()
        for k in v:
            obj(k, ("column", "collation", "descending"))
            name(k["column"]); name(k["collation"]); boolean(k["descending"])
            require(k["column"] in available and k["column"] not in seen)
            seen.add(k["column"])
    def expr(v, available, default=False):
        require(type(v) is str and bool(v))
        require(expression(tokens(v), default, available) == v)

    obj(c, ("contractFormatVersion", "currentSchemaVersion", "profiles", "structure", "transitions"))
    integer(c["contractFormatVersion"], 1); require(c["contractFormatVersion"] in (1,))
    integer(c["currentSchemaVersion"], 1)
    s = c["structure"]; obj(s, ("objects", "tables", "indexes"))
    for field in s:
        array(s[field])
    require(bool(s["tables"]))
    tables = {}
    for t in s["tables"]:
        obj(t, ("name", "columns", "primaryKey", "rowidAlias", "autoincrement", "withoutRowid",
                "strict", "unique", "checks", "foreignKeys"))
        name(t["name"]); require(t["name"] not in tables); tables[t["name"]] = t
        array(t["columns"]); require(bool(t["columns"]))
        cols = {}
        for col in t["columns"]:
            obj(col, ("name", "type", "notNull", "default", "primaryKeyOrder", "collation"))
            name(col["name"]); require(col["name"] not in cols); cols[col["name"]] = col
            require(type(col["type"]) is str and col["type"] in ("INTEGER", "REAL", "TEXT"))
            boolean(col["notNull"]); integer(col["primaryKeyOrder"]); name(col["collation"])
            if col["default"] is not None:
                expr(col["default"], cols, True)
        for flag in ("withoutRowid", "strict"):
            boolean(t[flag]); require(t[flag] is False)  # unsupported by frozen parser/generator
        keys(t["primaryKey"], cols, True)
        for field in ("rowidAlias", "autoincrement"):
            if t[field] is not None:
                name(t[field]); require(t[field] in cols)
        if t["rowidAlias"] is not None:
            alias = t["rowidAlias"]
            require(len(t["primaryKey"]) == 1 and t["primaryKey"][0]["column"] == alias
                    and not t["primaryKey"][0]["descending"] and cols[alias]["type"] == "INTEGER")
        require(t["autoincrement"] is None or t["autoincrement"] == t["rowidAlias"])
        array(t["unique"])
        for unique in t["unique"]:
            keys(unique, cols)
        array(t["checks"])
        for check in t["checks"]:
            expr(check, cols)
        array(t["foreignKeys"])
    for t in s["tables"]:
        cols = {v["name"] for v in t["columns"]}
        for fk in t["foreignKeys"]:
            obj(fk, ("columns", "table", "references", "onUpdate", "onDelete", "match",
                     "deferrable", "initiallyDeferred"))
            name(fk["table"]); require(fk["table"] in tables)
            names(fk["columns"], cols)
            names(fk["references"], {v["name"] for v in tables[fk["table"]]["columns"]})
            require(len(fk["columns"]) == len(fk["references"]))
            for field in ("onUpdate", "onDelete"):
                require(type(fk[field]) is str and fk[field] in
                        ("NO ACTION", "CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT"))
            require(fk["match"] == "NONE")
            boolean(fk["deferrable"]); boolean(fk["initiallyDeferred"])
    indexes = set()
    for idx in s["indexes"]:
        obj(idx, ("name", "table", "unique", "keys", "predicate"))
        name(idx["name"]); name(idx["table"]); boolean(idx["unique"])
        require(idx["name"] not in indexes and idx["name"] not in tables and idx["table"] in tables)
        indexes.add(idx["name"])
        cols = {v["name"] for v in tables[idx["table"]]["columns"]}
        keys(idx["keys"], cols)
        if idx["predicate"] is not None:
            expr(idx["predicate"], cols)
    for o in s["objects"]:
        obj(o, ("type", "name", "table")); name(o["name"]); name(o["table"])
        require(o["type"] in ("table", "index"))
    inventory = [{"type": "table", "name": t["name"], "table": t["name"]} for t in s["tables"]]
    inventory += [{"type": "index", "name": i["name"], "table": i["table"]} for i in s["indexes"]]
    require(sorted(s["objects"], key=stable) == sorted(inventory, key=stable))

    p = c["profiles"]
    require(type(p) is dict and "formal_current" in p and bool(p))
    for profile, definition in p.items():
        require(profile in ("blank", "legacy_current", "formal_current"))  # classifier protocol IDs
        obj(definition, ("userVersion", "structureRef"), ("sqliteSchemaMustBeEmpty",))
        integer(definition["userVersion"])
        require(definition["structureRef"] in ("blank", "current"))
        if "sqliteSchemaMustBeEmpty" in definition:
            boolean(definition["sqliteSchemaMustBeEmpty"])
        require((definition["structureRef"] == "blank") ==
                (definition.get("sqliteSchemaMustBeEmpty") is True))
        if profile == "formal_current":
            require(definition["userVersion"] == c["currentSchemaVersion"]
                    and definition["structureRef"] == "current")
        else:
            require(definition["userVersion"] < c["currentSchemaVersion"])
    array(c["transitions"]); seen = set()
    for tr in c["transitions"]:
        obj(tr, ("fromVersion", "inputProfile", "structureRef", "toVersion", "action"))
        integer(tr["fromVersion"]); integer(tr["toVersion"], 1)
        name(tr["inputProfile"]); name(tr["action"])
        require(tr["inputProfile"] in p and tr["inputProfile"] != "formal_current")
        profile = p[tr["inputProfile"]]
        require(tr["structureRef"] == profile["structureRef"])
        require(tr["fromVersion"] == profile["userVersion"]
                and tr["fromVersion"] < tr["toVersion"] == c["currentSchemaVersion"])
        require(tr["action"] in ("bootstrap_v1", "adopt_v1"))
        # Handler preconditions describe operations, not a profile/version matrix.
        require((tr["action"] == "bootstrap_v1") == (tr["structureRef"] == "blank"))
        key = (tr["fromVersion"], tr["inputProfile"])
        require(key not in seen); seen.add(key)
    return c


def load_contract(path=CONTRACT_PATH):
    def reject_float(value):
        raise LifecycleError("contract integer fields cannot contain JSON floats")
    return validate_contract(json.loads(Path(path).read_text(encoding="utf-8"), parse_float=reject_float))


def differences(actual, expected, path="structure", result=None):
    if result is None:
        result = []
    if len(result) >= 32:
        return result
    if type(actual) != type(expected):
        result.append({"path": path, "expected": expected, "actual": actual})
    elif isinstance(actual, dict):
        for key in sorted(set(actual) | set(expected)):
            if key not in actual or key not in expected:
                result.append({"path": path + "." + key, "expected": expected.get(key), "actual": actual.get(key)})
            else:
                differences(actual[key], expected[key], path + "." + key, result)
    elif isinstance(actual, list):
        if len(actual) != len(expected):
            result.append({"path": path + ".length", "expected": len(expected), "actual": len(actual)})
        for i, (a, e) in enumerate(zip(actual, expected)):
            differences(a, e, path + "[" + str(i) + "]", result)
    elif actual != expected:
        result.append({"path": path, "expected": expected, "actual": actual})
    return result[:32]


def classify_connection(conn, contract):
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    current = contract["currentSchemaVersion"]
    try:
        structure = inspect_structure(conn)
    except (LifecycleError, sqlite3.Error) as error:
        return {"classification": "future_version" if version > current else "unsupported", "userVersion": version,
                "compatible": False, "differences": [{"path": "structure.sql", "error": str(error)}], "structure": None}
    drift = differences(structure, contract["structure"])
    empty = not conn.execute("SELECT 1 FROM sqlite_schema LIMIT 1").fetchone()
    profiles = contract["profiles"]
    matched = next((name for name, p in profiles.items() if version == p["userVersion"]
                    and (empty if p["structureRef"] == "blank" else not drift)), None)
    if version > current:
        kind = "future_version"
    elif version not in {p["userVersion"] for p in profiles.values()}:
        kind = "version_mismatch"
    elif matched is None:
        kind = "structural_drift"
    else:
        kind = "current" if matched == "formal_current" else matched
    return {"classification": kind, "userVersion": version, "compatible": kind == "current",
            "differences": [] if matched and profiles[matched]["structureRef"] == "blank" else drift,
            "structure": structure}


def check_target(path):
    path = Path(path).absolute()
    if not path.is_file() or path.is_symlink():
        raise LifecycleError("database must be an existing regular file: " + str(path))
    if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise LifecycleError("unsupported database side artifacts; close/checkpoint it offline first")
    with path.open("rb") as stream:
        header = stream.read(100)
    if header and (len(header) < 100 or header[:16] != b"SQLite format 3\0" or header[18:20] != b"\1\1"):
        raise LifecycleError("unsupported database header/journal mode; require rollback-journal SQLite")
    return path


def readonly_connection(path):
    path = check_target(path)
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, isolation_level=None)
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def inspect_database(path, contract=None):
    contract = load_contract() if contract is None else validate_contract(contract)
    conn = readonly_connection(path)
    try:
        return classify_connection(conn, contract)
    finally:
        conn.close()


def ddl_statements(contract):
    """Mechanical generation exclusively from declarative JSON, never DB SQL."""
    for table in contract["structure"]["tables"]:
        parts = []
        for col in table["columns"]:
            clause = quote(col["name"]) + " " + col["type"]
            if table["rowidAlias"] == col["name"]:
                clause += " PRIMARY KEY"
                if table["autoincrement"] == col["name"]:
                    clause += " AUTOINCREMENT"
            if col["notNull"]:
                clause += " NOT NULL"
            if col["collation"] != "binary":
                clause += " COLLATE " + quote(col["collation"])
            if col["default"] is not None:
                clause += " DEFAULT " + col["default"]
            parts.append(clause)
        def keys_sql(keys):
            return ", ".join(quote(k["column"]) + " COLLATE " + quote(k["collation"])
                             + (" DESC" if k["descending"] else " ASC") for k in keys)
        if table["primaryKey"] and table["rowidAlias"] is None:
            parts.append("PRIMARY KEY (" + keys_sql(table["primaryKey"]) + ")")
        for keys in table["unique"]:
            parts.append("UNIQUE (" + keys_sql(keys) + ")")
        for fk in table["foreignKeys"]:
            clause = "FOREIGN KEY (" + ", ".join(map(quote, fk["columns"])) + ") REFERENCES "
            clause += quote(fk["table"]) + " (" + ", ".join(map(quote, fk["references"])) + ")"
            clause += " ON UPDATE " + fk["onUpdate"] + " ON DELETE " + fk["onDelete"]
            if fk["match"] != "NONE":
                clause += " MATCH " + fk["match"]
            if fk["deferrable"] or fk["initiallyDeferred"]:
                clause += (" DEFERRABLE" if fk["deferrable"] else " NOT DEFERRABLE")
                clause += " INITIALLY " + ("DEFERRED" if fk["initiallyDeferred"] else "IMMEDIATE")
            parts.append(clause)
        parts.extend("CHECK (" + check + ")" for check in table["checks"])
        yield "CREATE TABLE " + quote(table["name"]) + " (" + ", ".join(parts) + ")"
    for index in contract["structure"]["indexes"]:
        clause = "CREATE " + ("UNIQUE " if index["unique"] else "") + "INDEX " + quote(index["name"])
        clause += " ON " + quote(index["table"]) + " (" + keys_sql(index["keys"]) + ")"
        if index["predicate"] is not None:
            clause += " WHERE " + index["predicate"]
        yield clause


def logical_snapshot(conn):
    """Include all rows, timestamps, internal sequence/stats and original SQL."""
    schema = conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").fetchall()
    tables = {}
    for kind, name, table, sql in schema:
        if kind != "table":
            continue
        digest, count = hashlib.sha256(), 0
        for row in conn.execute("SELECT rowid,* FROM " + quote(name) + " ORDER BY rowid"):
            encoded = [({"blob": v.hex()} if isinstance(v, bytes) else v) for v in row]
            digest.update(stable(encoded).encode("utf-8") + b"\n")
            count += 1
        tables[name] = {"count": count, "sha256": digest.hexdigest()}
    return {"schema": schema, "tables": tables}


def validate_target(conn, contract):
    drift = differences(inspect_structure(conn), contract["structure"])
    if drift:
        raise LifecycleError("target structural drift: " + stable(drift))
    integrity = conn.execute("PRAGMA integrity_check").fetchall()
    if integrity != [("ok",)] or conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise LifecycleError("target integrity/FK check failed")


def bootstrap_action(conn, contract):
    for statement in ddl_statements(contract):
        conn.execute(statement)


def atomic_transition(conn, contract, transition):
    """Caller owns the connection; this function owns exactly one transaction."""
    validate_contract(contract)
    if transition not in contract["transitions"] or transition["toVersion"] != contract["currentSchemaVersion"]:
        raise LifecycleError("unregistered lifecycle transition")
    if conn.in_transaction:
        raise LifecycleError("outer transaction is not allowed")
    conn.execute("PRAGMA foreign_keys=ON")
    if conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        raise LifecycleError("foreign_keys enforcement unavailable")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("BEGIN IMMEDIATE")
    try:
        protected = classify_connection(conn, contract)
        if (transition not in contract["transitions"] or protected["userVersion"] != transition["fromVersion"]
                or protected["classification"] != transition["inputProfile"]):
            raise LifecycleError("input changed or unregistered transition")
        before = logical_snapshot(conn) if transition["action"] == "adopt_v1" else None
        if transition["action"] == "bootstrap_v1":
            bootstrap_action(conn, contract)
        elif transition["action"] != "adopt_v1":
            raise LifecycleError("unregistered lifecycle action")
        validate_target(conn, contract)
        if before is not None and logical_snapshot(conn) != before:
            raise LifecycleError("adoption changed logical data/schema")
        if before is None and any(conn.execute("SELECT 1 FROM " + quote(t["name"]) + " LIMIT 1").fetchone()
                                  for t in contract["structure"]["tables"]):
            raise LifecycleError("bootstrap unexpectedly seeded application data")
        conn.execute("PRAGMA user_version=" + str(transition["toVersion"]))  # last mutation
        final = classify_connection(conn, contract)
        if final["classification"] != "current":
            raise LifecycleError("post-stamp target validation failed")
        conn.execute("COMMIT")
        return {"result": transition["action"], **final}
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def prepare_database(path, contract=None):
    contract = load_contract() if contract is None else validate_contract(contract)
    path = check_target(path)
    inspected = inspect_database(path, contract)
    if inspected["classification"] == "current":
        return {"result": "already_current", **inspected}
    transition = next((t for t in contract["transitions"] if t["inputProfile"] == inspected["classification"]
                       and t["fromVersion"] == inspected["userVersion"]), None)
    if transition is None:
        code = ("unsupported_v0_profile" if inspected["userVersion"] == 0 else
                "unsupported_version" if inspected["classification"] == "version_mismatch" else inspected["classification"])
        raise LifecycleError("rejected " + code + "; user_version=" + str(inspected["userVersion"]),
                             {"code": code, "classification": inspected["classification"],
                              "userVersion": inspected["userVersion"], "differences": inspected["differences"]})
    # mode=rw never creates a typo target. Recheck under BEGIN IMMEDIATE.
    conn = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, isolation_level=None)
    try:
        return atomic_transition(conn, contract, transition)
    except (sqlite3.Error, LifecycleError) as error:
        raise LifecycleError("transaction failure: " + str(error)) from error
    finally:
        conn.close()


def bootstrap_database(path, contract=None):
    contract = load_contract() if contract is None else validate_contract(contract)
    path = Path(path).absolute()
    if path.exists() or any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise LifecycleError("invalid blank target: bootstrap requires a new path")
    # Exclusive creation is explicit; classification still happens read-only
    # before any SQLite writable connection is opened.
    with path.open("xb"):
        pass
    return prepare_database(path, contract)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("intent", choices=("inspect", "prepare", "bootstrap"))
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    try:
        contract = load_contract()
        runner = {"inspect": inspect_database, "prepare": prepare_database, "bootstrap": bootstrap_database}[args.intent]
        result = runner(args.database, contract)
        print(stable(result))
        if args.intent == "inspect" and result["classification"] not in ("current", "legacy_current", "blank"):
            return 1
        return 0
    except (LifecycleError, OSError, sqlite3.Error) as error:
        print(stable({"error": str(error), **getattr(error, "details", {})}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
