"""Permanent R2-09..13 integration gates. All writable targets are OS Temp."""
import contextlib
import hashlib
import importlib.util
import io
import json
import runpy
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from migrate import bootstrap_database, inspect_database, load_contract, logical_snapshot
from material_import_schema import ensure_import_schema
from real_material_importer import execute_import, rollback_import

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cli(script, database, payload=None):
    return subprocess.run(["python", "-B", str(ROOT / "scripts" / script), str(database)],
                          input=json.dumps(payload) if payload is not None else None,
                          capture_output=True, text=True)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="matfinder-p2-writers-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def database(self, name, version=None):
        path = self.root / (name + ".db")
        bootstrap_database(path)
        if version is not None:
            with contextlib.closing(sqlite3.connect(path)) as db:
                db.execute(f"PRAGMA user_version={version}")
        return path

    def test_R2_09_importer_rejects_legacy_before_mutation(self):
        database = self.database("legacy", 0)
        source = self.root / "unread-input.json"  # Preflight must precede even input parsing.
        before = sha(database)
        for dry in (False, True):
            with self.assertRaisesRegex(RuntimeError, "legacy_current"):
                execute_import(database, source, dry_run=dry)
        with self.assertRaisesRegex(RuntimeError, "legacy_current"):
            rollback_import(database, "missing")
        self.assertEqual(sha(database), before)
        for suffix in ("-wal", "-shm", "-journal"):
            self.assertFalse(Path(str(database) + suffix).exists())
        for version in (999,):
            target = self.database("future", version)
            before = sha(target)
            with self.assertRaisesRegex(RuntimeError, "future_version"):
                execute_import(target, source)
            self.assertEqual(sha(target), before)
        target = self.database("drift")
        with contextlib.closing(sqlite3.connect(target)) as db:
            db.execute("DROP INDEX idx_materials_catalog_layer")
            db.commit()
        before = sha(target)
        with self.assertRaisesRegex(RuntimeError, "structural_drift"):
            execute_import(target, source)
        self.assertEqual(sha(target), before)

    def test_R2_10_v1_preflight_and_business_regressions(self):
        # Execute the existing full importer suite, with its own canonical Temp
        # adoption and unchanged normalization/evidence/identity/rollback assertions.
        before = sha(ROOT / "matfinder.db")
        result = subprocess.run(["python", "-B", str(ROOT / "scripts/test-real-material-importer.py")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sha(ROOT / "matfinder.db"), before)
        print(result.stdout.strip())

    def test_R2_11_writer_delegates_to_canonical_bootstrap(self):
        spec = importlib.util.spec_from_file_location("writer", ROOT / "scripts/write-materials-sqlite.py")
        writer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(writer)
        target = self.root / "generated.db"
        # Data-only values; required text fields supplied by the ordinary writer.
        material = {"id": "TEST-WRITER", "name": "Fixture", "abbreviation": "PC", "category": "Plastics",
                    "summary": "Test only", "notes": "Test only", "source_note": "Test only"}
        with patch.object(writer, "bootstrap_database", wraps=bootstrap_database) as bootstrap, \
             patch.object(sys, "argv", ["writer", str(target)]), \
             patch.object(sys, "stdin", io.StringIO(json.dumps([material]))), \
             contextlib.redirect_stdout(io.StringIO()):
            writer.main()
            bootstrap.assert_called_once_with(target.absolute(), load_contract())
        self.assertEqual(inspect_database(target)["classification"], "current")
        with contextlib.closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute("SELECT name FROM materials").fetchone()[0], "Fixture")
            ensure_import_schema(db)
            db.execute("BEGIN")
            ensure_import_schema(db)
            self.assertTrue(db.in_transaction, "Historical ensure must never implicitly commit")
            db.rollback()
        # Exercise the unchanged aggregation -> writer -> summary workflow from
        # an isolated Temp checkout; neither DB nor summary may land in the repo.
        isolated = self.root / "generation-workflow"
        paths = ["database-schema-contract.json", "evidence-model.js", "data/materials.js",
                 "scripts/migrate.py", "scripts/write-materials-sqlite.py",
                 "scripts/migrate-materials-to-sqlite.js", "scripts/generate-database-summary.js",
                 "scripts/read-materials-sqlite.js", "scripts/additional-materials.js",
                 "scripts/matweb-style-expansion.js", "scripts/generated-material-expansion.js",
                 "scripts/commercial-grade-expansion.js", "scripts/bilingual-material-rules.js"]
        for name in paths:
            destination = isolated / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, destination)
        generated = isolated / "generated.db"
        result = subprocess.run(["node", str(isolated / "scripts/migrate-materials-to-sqlite.js"),
                                 str(generated)], capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(inspect_database(generated)["classification"], "current")
        with contextlib.closing(sqlite3.connect(generated)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM materials").fetchone()[0], 7531)
        summary = json.loads((isolated / "data/database-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["total_materials"], 7531)

    def test_R2_12_writer_refuses_every_existing_target(self):
        arbitrary = self.root / "arbitrary.db"
        with contextlib.closing(sqlite3.connect(arbitrary)) as db:
            db.execute("CREATE TABLE unrelated (value TEXT)")
            db.execute("INSERT INTO unrelated VALUES ('preserve')")
            db.commit()
        formal = self.database("formal")
        empty = self.root / "existing-empty.db"
        empty.write_bytes(b"")
        for target in (arbitrary, formal, empty):
            before = sha(target)
            result = cli("write-materials-sqlite.py", target, [])
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertEqual(sha(target), before)
        result = subprocess.run(["node", str(ROOT / "scripts/migrate-materials-to-sqlite.js")],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("new-disposable-database-path", result.stderr)
        result = subprocess.run(["node", str(ROOT / "scripts/migrate-materials-to-sqlite.js"), str(arbitrary)],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not already exist", result.stderr)

    def test_R2_13_legacy_entrypoints_fail_closed(self):
        for name, sql in (("drift", "DROP INDEX idx_materials_catalog_layer"),
                          ("unknown", "CREATE TABLE surprise(value TEXT)")):
            database = self.database(name)
            with contextlib.closing(sqlite3.connect(database)) as db:
                db.execute(sql)
                db.commit()
            before = sha(database)
            for script in ("migrate-import-schema.py", "migrate-catalog-layer.py", "migrate-evidence-schema.py"):
                result = cli(script, database)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertEqual(sha(database), before)
            with contextlib.closing(sqlite3.connect(database)) as db:
                with self.assertRaisesRegex(RuntimeError, "structural_drift"):
                    ensure_import_schema(db)
            self.assertEqual(sha(database), before)
        # Historical preparation aliases may only adopt the exact supported profile.
        for script in ("migrate-import-schema.py", "migrate-catalog-layer.py"):
            database = self.database(script, 0)
            with contextlib.closing(sqlite3.connect(database)) as db:
                before = logical_snapshot(db)
            result = cli(script, database)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(inspect_database(database)["classification"], "current")
            with contextlib.closing(sqlite3.connect(database)) as db:
                self.assertEqual(logical_snapshot(db), before)
            before = sha(database)
            result = cli(script, database)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sha(database), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
