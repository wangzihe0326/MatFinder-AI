"""Permanent Phase-1 tests. Every writable database is an OS-temp fixture."""
from contextlib import closing
import copy
import hashlib
import importlib.util
import inspect
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("lifecycle", ROOT / "scripts/migrate.py")
LIFECYCLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIFECYCLE)
ALLOWED = {"database-schema-contract.json", "schema-contract.js", "scripts/test-schema-lifecycle.py",
           "scripts/migrate.py", "package.json"}
COMMANDS, EVIDENCE = [], {}


def run(command, cwd=ROOT, input_text=None, *, binary=False):
    env = os.environ.copy()
    env["GIT_OPTIONAL_LOCKS"] = "0"
    result = subprocess.run(command, cwd=cwd, capture_output=True,
                            text=not binary, encoding=None if binary else "utf-8",
                            errors=None if binary else "replace",
                            input=input_text, env=env)
    COMMANDS.append({"command": command, "cwd": str(cwd), "exitCode": result.returncode})
    return result


def git(root, *args):
    result = run(["git", "-c", "safe.directory=" + root.as_posix(), *args], cwd=root)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


BASE_SHA = "85f6c17340d10cd52505498960fa3196bebd1b2c"
RETIRED_WRITER = "scripts/__pycache__/write-materials-sqlite.cpython-312.pyc"
APPROVED_FEATURE_DELETIONS = frozenset({RETIRED_WRITER})
APPROVED_ABSENT = "approved-feature-deletion:" + RETIRED_WRITER
# These are the already-authorized Phase-1/2 edits, not missing-file exceptions.
FEATURE_MODIFICATIONS = frozenset({
    "material-repository.js", "package.json", "server.js",
    "scripts/material_import_schema.py", "scripts/migrate-catalog-layer.py",
    "scripts/migrate-evidence-schema.py", "scripts/migrate-import-schema.py",
    "scripts/migrate-materials-to-sqlite.js", "scripts/migrate.py",
    "scripts/real_material_importer.py", "scripts/write-materials-sqlite.py",
    "scripts/test-api-protection.js", "scripts/test-catalog-layer.js",
    "scripts/test-catalog-search.js", "scripts/test-catalog-stats-artifact.js",
    "scripts/test-evidence-migration-safety.py", "scripts/test-evidence-schema.py",
    "scripts/test-material-query.js", "scripts/test-readiness.js",
    "scripts/test-real-material-importer.py", "scripts/test-recommendation-recall.js",
    "scripts/test-startup-memory.js", "scripts/test-static-security.js"})
FEATURE_SOURCES = frozenset({"database-schema-contract.json", "schema-contract.js",
    "scripts/schema-test-fixtures.js", "scripts/test-schema-lifecycle.py",
    "scripts/test-schema-integration.js", "scripts/test-schema-integration.py",
    "scripts/schema-authority-guard.js", "scripts/schema-authority-policy.json"})
ALLOWED.update(FEATURE_SOURCES)


def baseline_inventory(root=ROOT):
    """Immutable AD-09 provenance, independent of the current HEAD/index."""
    result = {}
    for record in git(root, "ls-tree", "-r", "-z", BASE_SHA).split("\0"):
        if not record:
            continue
        metadata, name = record.split("\t", 1)
        mode, kind, oid = metadata.split()
        assert kind == "blob" and mode in ("100644", "100755"), "unclassified baseline entry"
        result[name] = oid
    assert RETIRED_WRITER in result and "matfinder.db" in result
    return result


def copy_baseline(name, destination, root=ROOT):
    result = run(["git", "-c", "safe.directory=" + root.as_posix(),
                  "cat-file", "blob", baseline_inventory(root)[name]], cwd=root, binary=True)
    assert result.returncode == 0, result.stderr
    Path(destination).write_bytes(result.stdout)


def current_inventory(root):
    """Read the current index, including exact object identities, from Git."""
    result = {}
    for record in git(root, "ls-files", "--stage", "-z").split("\0"):
        if not record:
            continue
        metadata, name = record.split("\t", 1)
        mode, oid, stage = metadata.split()
        assert stage == "0" and mode in ("100644", "100755"), "unclassified current tracked entry: " + name
        result[name] = (mode, oid)
    return result


def current_manifest(root, *, feature):
    """Current Git inventory defines capture; it does not authorize SQL owners.

    Before the feature is staged, only the historically proven writer deletion
    may be absent from an old index. After commit it is absent from that index.
    Required AD-09 sources are captured even while intentionally untracked.
    Historical object hashes are used only for the approved bytecode identities,
    never to freeze unrelated current source contents or HEAD indefinitely.
    """
    root = Path(root)
    historical, tracked = baseline_inventory(root), current_inventory(root)
    missing = set(historical) - set(tracked) - APPROVED_FEATURE_DELETIONS
    assert not missing, "unapproved historical path deletion: " + ", ".join(sorted(missing))
    retired = root / RETIRED_WRITER
    if feature:
        assert not retired.exists(), "retired writer bytecode restored: " + RETIRED_WRITER
        if RETIRED_WRITER in tracked:
            assert tracked[RETIRED_WRITER][1] == historical[RETIRED_WRITER], "retired writer index identity changed"
    hashes = {}
    for name in sorted(tracked):
        if feature and name == RETIRED_WRITER:
            hashes[name] = APPROVED_ABSENT
            continue
        assert (root / name).is_file(), "required current tracked path missing: " + name
        hashes[name] = sha(root / name)
    if feature:
        for name in sorted(FEATURE_SOURCES):
            assert (root / name).is_file(), "required feature source missing: " + name
            hashes[name] = sha(root / name)
    reader = "scripts/__pycache__/read-materials-sqlite.cpython-312.pyc"
    allowed = {reader} | ({RETIRED_WRITER} if not feature and RETIRED_WRITER in tracked else set())
    bytecode = {n for n in tracked if Path(n).suffix.lower() in (".pyc", ".pyo", ".pyz")
                and not (feature and n == RETIRED_WRITER)}
    for directory, folders, files in os.walk(root):
        folders[:] = [n for n in folders if n not in (".git", ".agents", ".codex", "node_modules")]
        bytecode.update((Path(directory) / n).relative_to(root).as_posix()
                        for n in files if Path(n).suffix.lower() in (".pyc", ".pyo", ".pyz"))
    assert bytecode == allowed, "unauthorized executable bytecode: " + ", ".join(sorted(bytecode ^ allowed))
    for name in allowed:
        assert name in tracked and (root / name).is_file(), "approved bytecode missing: " + name
        actual = git(root, "hash-object", "--", str(root / name))
        assert actual == historical[name], "approved bytecode identity changed: " + name
    assert not sidefiles(root / "matfinder.db"), "tracked DB sidecar present"
    return {"head": git(root, "rev-parse", "HEAD"), "tracked": tracked,
            "files": hashes, "staged": git(root, "diff", "--cached", "--name-status")}


def original_checkout():
    common = Path(git(ROOT, "rev-parse", "--git-common-dir"))
    return (ROOT / common).resolve().parent if not common.is_absolute() else common.parent


def capture_required(root, inventory, *, feature):
    """Separate required baseline identity from run-local raw mutation hashes.

    Temp regression copies use subsets of the same real Git-tree inventory.
    The feature exception is the one fixed retired path; callers cannot widen it.
    """
    root = Path(root)
    result, consistent = {}, []
    for name in sorted(inventory):
        target = root / name
        if feature and name in APPROVED_FEATURE_DELETIONS:
            assert not target.exists(), "retired writer bytecode restored: " + name
            result[name] = APPROVED_ABSENT
            continue
        assert target.is_file(), "required baseline path missing: " + name
        result[name] = sha(target)
        if not feature or name not in FEATURE_MODIFICATIONS:
            consistent.append(name)
    # Git's clean filtering accounts for checkout CRLF without changing Git
    # config or normalizing any repository bytes. Compare to baseline blob OIDs.
    if consistent:
        paths = "".join(json.dumps((root / n).as_posix()) + "\n" for n in consistent)
        check = run(["git", "-c", "safe.directory=" + ROOT.as_posix(),
                     "hash-object", "--stdin-paths"], input_text=paths)
        assert check.returncode == 0, check.stderr
        identities = check.stdout.splitlines()
        assert len(identities) == len(consistent)
        for name, actual in zip(consistent, identities):
            assert actual == inventory[name], "baseline object identity changed: " + name
    return result


def assert_unchanged(before, after, label):
    assert after == before, label + " changed during tests"


def manifest(root):
    root = Path(root).resolve()
    original = original_checkout().resolve()
    assert root in (ROOT, original), "real repository capture needs explicit original/feature identity"
    return current_manifest(root, feature=root == ROOT)


class RepositorySafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = baseline_inventory()
        cls.original = original_checkout()
        cls.before_feature, cls.before_original = manifest(ROOT), manifest(cls.original)

    @classmethod
    def tearDownClass(cls):
        assert manifest(ROOT) == cls.before_feature
        assert manifest(cls.original) == cls.before_original

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="matfinder-p2-safety-")
        self.addCleanup(self.temp.cleanup)
        self.copy = Path(self.temp.name)
        assert not self.copy.is_relative_to(ROOT)
        names = ("public/styles.css", "package.json", RETIRED_WRITER)
        self.required = {n: self.inventory[n] for n in names}
        for name in names:
            target = self.copy / name
            target.parent.mkdir(parents=True, exist_ok=True)
            copy_baseline(name, target)

    def feature_capture(self):
        return capture_required(self.copy, self.required, feature=True)

    def retire(self):
        (self.copy / RETIRED_WRITER).unlink()

    def test_P2_BR_01_approved_deletion_and_feature_edit(self):
        self.retire()
        (self.copy / "package.json").write_text('{"intentionalFeatureEdit":true}', encoding="utf-8")
        before = self.feature_capture()
        self.assertEqual(before[RETIRED_WRITER], APPROVED_ABSENT)
        self.assertEqual(self.feature_capture(), before)
        self.assertNotIn(None, before.values())

    def test_P2_BR_01_missing_before_capture(self):
        self.retire()
        (self.copy / "public/styles.css").unlink()
        with self.assertRaisesRegex(AssertionError, "required baseline path missing"):
            self.feature_capture()

    def test_P2_BR_01_deleted_after_capture(self):
        self.retire()
        self.feature_capture()
        (self.copy / "public/styles.css").unlink()
        with self.assertRaisesRegex(AssertionError, "required baseline path missing"):
            self.feature_capture()

    def test_P2_BR_01_modified_after_capture(self):
        self.retire()
        before = self.feature_capture()
        (self.copy / "package.json").write_text('{"changedDuringTest":true}', encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "changed during tests"):
            assert_unchanged(before, self.feature_capture(), "feature capture")

    def test_P2_BR_01_stale_restoration(self):
        self.retire()
        self.feature_capture()
        copy_baseline(RETIRED_WRITER, self.copy / RETIRED_WRITER)
        with self.assertRaisesRegex(AssertionError, "retired writer bytecode restored"):
            self.feature_capture()

    def test_P2_BR_01_original_missing(self):
        capture_required(self.copy, self.required, feature=False)
        (self.copy / RETIRED_WRITER).unlink()
        with self.assertRaisesRegex(AssertionError, "required baseline path missing"):
            capture_required(self.copy, self.required, feature=False)

    def test_P2_BR_01_replaced_before_capture(self):
        self.retire()
        (self.copy / "public/styles.css").write_text("replacement", encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "baseline object identity changed"):
            self.feature_capture()

    def test_P2_BR_01_original_replaced(self):
        (self.copy / "package.json").write_text("replacement", encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "baseline object identity changed"):
            capture_required(self.copy, self.required, feature=False)



class CommitStateTests(unittest.TestCase):
    """Real isolated Temp Git commits; never stage or commit either checkout."""
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="matfinder-pc-01-commit-")
        cls.copy = Path(cls.temp.name) / "checkout"
        assert not cls.copy.is_relative_to(ROOT)
        cls.copy.mkdir()
        git(cls.copy, "init", "--quiet")
        # Read-only object sharing avoids cloning an ownership-sensitive Windows
        # worktree. All index/ref/commit writes remain in this Temp repository.
        common = Path(git(ROOT, "rev-parse", "--git-common-dir"))
        common = (ROOT / common).resolve() if not common.is_absolute() else common.resolve()
        (cls.copy / ".git/objects/info/alternates").write_bytes(
            ((common / "objects").as_posix() + "\n").encode("utf-8"))
        git(cls.copy, "checkout", "--quiet", "--detach", git(ROOT, "rev-parse", "HEAD"))
        current = set(current_inventory(ROOT)) | set(FEATURE_SOURCES)
        for name in sorted(current - APPROVED_FEATURE_DELETIONS):
            target = cls.copy / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        (cls.copy / RETIRED_WRITER).unlink(missing_ok=True)
        git(cls.copy, "add", "--all")
        git(cls.copy, "-c", "user.name=Schema lifecycle fixture", "-c", "user.email=fixture@example.invalid",
            "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "Disposable AD-09 committed-tree fixture")
        cls.before = current_manifest(cls.copy, feature=True)
        status = git(cls.copy, "status", "--porcelain")
        assert not status, "intended committed-tree fixture is dirty: " + status
        safety = run(["python", "-B", "scripts/test-schema-lifecycle.py", "--p2-br-01"], cwd=cls.copy)
        assert safety.returncode == 0, safety.stdout + safety.stderr
        authority = run(["node", "scripts/test-schema-integration.js", "--authority-only"], cwd=cls.copy)
        assert authority.returncode == 0, authority.stdout + authority.stderr
        EVIDENCE["PC-01-post-commit"] = {"historicalBase": BASE_SHA, "head": cls.before["head"],
            "tempRoot": cls.copy.as_posix(), "workingTreeStatus": status,
            "trackedPathCount": len(cls.before["tracked"]), "addedSourcesTracked": sorted(FEATURE_SOURCES),
            "intendedModificationsTracked": sorted(FEATURE_MODIFICATIONS & set(cls.before["tracked"])),
            "trackedDatabaseSHA256": sha(cls.copy / "matfinder.db"),
            "retiredWriterTracked": RETIRED_WRITER in cls.before["tracked"],
            "permanentSafetyExit": safety.returncode, "permanentAuthorityExit": authority.returncode,
            "safetyOutput": safety.stdout + safety.stderr, "authorityOutput": authority.stdout + authority.stderr}

    @classmethod
    def tearDownClass(cls):
        try:
            assert_unchanged(cls.before, current_manifest(cls.copy, feature=True), "Temp committed tree")
        finally:
            cls.temp.cleanup()

    def capture(self):
        return current_manifest(self.copy, feature=True)

    def test_PC_01_01_advanced_head(self):
        self.assertNotEqual(git(self.copy, "rev-parse", "HEAD"), BASE_SHA)
        self.assertEqual(self.capture(), self.before)

    def test_PC_01_02_additions_tracked(self):
        self.assertTrue(FEATURE_SOURCES <= set(current_inventory(self.copy)))
        self.assertNotIn(RETIRED_WRITER, current_inventory(self.copy))
        self.assertEqual(self.capture(), self.before)

    def test_PC_01_03_missing_current_path_before_capture(self):
        target = self.copy / "schema-contract.js"
        content = target.read_bytes()
        try:
            target.unlink()
            with self.assertRaisesRegex(AssertionError, "required current tracked path missing"):
                self.capture()
        finally:
            target.write_bytes(content)

    def test_PC_01_04_modification_during_run(self):
        target = self.copy / "public/styles.css"
        content = target.read_bytes()
        before = self.capture()
        try:
            target.write_bytes(content + b"\n/* unexpected test mutation */\n")
            with self.assertRaisesRegex(AssertionError, "changed during tests"):
                assert_unchanged(before, self.capture(), "current tracked bytes")
        finally:
            target.write_bytes(content)

    def test_PC_01_05_retired_writer_restored(self):
        target = self.copy / RETIRED_WRITER
        try:
            copy_baseline(RETIRED_WRITER, target, self.copy)
            with self.assertRaisesRegex(AssertionError, "retired writer bytecode restored"):
                self.capture()
        finally:
            target.unlink(missing_ok=True)

    def test_PC_01_06_unauthorized_tracked_bytecode(self):
        target = self.copy / "scripts/__pycache__/unapproved.PYC"
        try:
            target.write_bytes(b"unauthorized executable fixture")
            git(self.copy, "add", "--", target.relative_to(self.copy).as_posix())
            with self.assertRaisesRegex(AssertionError, "unauthorized executable bytecode"):
                self.capture()
            guard = run(["node", "scripts/schema-authority-guard.js"], cwd=self.copy)
            self.assertEqual(guard.returncode, 1)
            self.assertIn("Unauthorized executable bytecode", guard.stderr)
        finally:
            git(self.copy, "restore", "--staged", "--", target.relative_to(self.copy).as_posix())
            target.unlink(missing_ok=True)

    def test_PC_01_07_unclassified_tracked_source(self):
        target = self.copy / "scripts/unclassified.JS"
        try:
            target.write_text('module.exports = db => db.exec(["CREATE", " TABLE rogue(id INTEGER)"].join(""));', encoding="utf-8")
            git(self.copy, "add", "--", target.relative_to(self.copy).as_posix())
            guard = run(["node", "scripts/schema-authority-guard.js"], cwd=self.copy)
            self.assertEqual(guard.returncode, 1)
            self.assertIn("Unclassified tracked production source", guard.stderr)
        finally:
            git(self.copy, "restore", "--staged", "--", target.relative_to(self.copy).as_posix())
            target.unlink(missing_ok=True)

    def test_PC_01_08_committed_tree_permanent_gates(self):
        proof = EVIDENCE["PC-01-post-commit"]
        self.assertEqual(proof["permanentSafetyExit"], 0)
        self.assertEqual(proof["permanentAuthorityExit"], 0)
        self.assertEqual(self.capture(), self.before)

    def test_PC_01_09_index_addition_during_run(self):
        target = self.copy / "unexpected-tracked.txt"
        before = self.capture()
        try:
            target.write_text("unexpected index addition", encoding="utf-8")
            git(self.copy, "add", "--", target.name)
            with self.assertRaisesRegex(AssertionError, "changed during tests"):
                assert_unchanged(before, self.capture(), "current Git inventory")
        finally:
            git(self.copy, "restore", "--staged", "--", target.name)
            target.unlink(missing_ok=True)

    def test_PC_01_10_database_sidecar(self):
        target = self.copy / "matfinder.db-wal"
        try:
            target.write_bytes(b"unexpected sidecar")
            with self.assertRaisesRegex(AssertionError, "tracked DB sidecar present"):
                self.capture()
        finally:
            target.unlink(missing_ok=True)

    def test_PC_01_11_current_tracked_removal_after_capture(self):
        target = self.copy / "schema-contract.js"
        content = target.read_bytes()
        before = self.capture()
        self.assertIn("schema-contract.js", before["tracked"])
        try:
            target.unlink()
            with self.assertRaisesRegex(AssertionError,
                    r"^required current tracked path missing: schema-contract\.js$"):
                assert_unchanged(before, self.capture(), "current tracked path")
        finally:
            target.write_bytes(content)


def snapshot(path):
    conn = LIFECYCLE.readonly_connection(path)
    try:
        return LIFECYCLE.logical_snapshot(conn)
    finally:
        conn.close()


def sidefiles(path):
    return [suffix for suffix in ("-wal", "-shm", "-journal") if Path(str(path) + suffix).exists()]


class SchemaLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="matfinder-schema-lifecycle-")
        cls.directory = Path(cls.temp.name).resolve()
        if cls.directory.is_relative_to(ROOT):
            raise AssertionError("test fixtures must be outside repository")
        cls.contract = LIFECYCLE.load_contract()
        common = Path(git(ROOT, "rev-parse", "--git-common-dir"))
        cls.original = (ROOT / common).resolve().parent if not common.is_absolute() else common.parent
        cls.before_worktree = manifest(ROOT)
        cls.before_original = manifest(cls.original)
        cls.before_sources = {name: sha(ROOT / name) for name in ALLOWED}
        cls.source = ROOT / "matfinder.db"
        cls.source_sha = sha(cls.source)
        cls.fixture = cls.directory / "current.db"
        LIFECYCLE.bootstrap_database(cls.fixture, cls.contract)
        cls.adopted = cls.directory / "adopted.db"
        cls.parity_fixtures = []
        EVIDENCE.update({"nodeVersion": run(["node", "--version"]).stdout.strip(),
                         "pythonVersion": run(["python", "--version"]).stdout.strip(),
                         "pythonSQLiteVersion": sqlite3.sqlite_version,
                         "branch": git(ROOT, "branch", "--show-current"),
                         "head": git(ROOT, "rev-parse", "HEAD"), "databaseShaBefore": cls.source_sha})

    @classmethod
    def tearDownClass(cls):
        try:
            cls.verify_repository()
            EVIDENCE["parityFixtures"] = cls.parity_fixtures.copy()
        finally:
            cls.temp.cleanup()

    @classmethod
    def verify_repository(cls):
        after_worktree, after_original = manifest(ROOT), manifest(cls.original)
        assert_unchanged(cls.before_worktree, after_worktree, "tracked worktree files")
        assert_unchanged(cls.before_original, after_original, "original tracked files")
        assert {n: sha(ROOT / n) for n in ALLOWED} == cls.before_sources, "Phase-1 source changed during tests"
        assert not sidefiles(cls.source) and not sidefiles(cls.original / "matfinder.db")
        assert sha(cls.source) == sha(cls.original / "matfinder.db") == cls.source_sha
        EVIDENCE.update({"databaseShaAfter": sha(cls.source), "trackedFileCount": len(after_original["tracked"]),
                         "worktreeManifestBefore": cls.before_worktree, "worktreeManifestAfter": after_worktree,
                         "originalManifestBefore": cls.before_original, "originalManifestAfter": after_original,
                         "databaseSidefiles": [], "repositorySafety": "PASS"})

    def fixture_copy(self, name):
        result = self.directory / (name + ".db")
        shutil.copyfile(self.fixture, result)
        return result

    def both(self, path, expected):
        before = sha(path)
        py = LIFECYCLE.inspect_database(path, self.contract)
        result = run(["node", str(ROOT / "schema-contract.js"), "inspect", "--database", str(path)])
        self.assertEqual(result.returncode, 0 if expected in ("current", "legacy_current", "blank") else 1, result.stderr)
        node = json.loads(result.stdout)
        self.assertEqual(py, node, str(path))
        self.assertEqual(py["classification"], expected, py["differences"])
        self.assertEqual(sha(path), before)
        self.assertEqual(sidefiles(path), [])
        self.parity_fixtures.append({"name": path.name, "classification": expected, "equal": True})
        return py

    def reject_prepare(self, path):
        before = sha(path)
        # Unsupported classification must never acquire a writable connection.
        original_connect = sqlite3.connect
        def only_readonly(*args, **kwargs):
            self.assertIn("mode=ro", str(args[0]))
            return original_connect(*args, **kwargs)
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=only_readonly):
            with self.assertRaises(LIFECYCLE.LifecycleError):
                LIFECYCLE.prepare_database(path, self.contract)
        self.assertEqual(sha(path), before)
        self.assertEqual(sidefiles(path), [])

    def test_P1_01_blank_bootstrap(self):
        blank = self.directory / "blank.db"
        blank.touch()
        self.both(blank, "blank")
        result = LIFECYCLE.prepare_database(blank, self.contract)
        self.assertEqual(result["result"], "bootstrap_v1")
        inspected = self.both(blank, "current")
        self.assertEqual(inspected["structure"], self.contract["structure"])
        self.assertTrue(all(t["count"] == 0 for t in snapshot(blank)["tables"].values()))
        cli_target = self.directory / "cli-bootstrap.db"
        cli = run(["python", "-B", str(ROOT / "scripts/migrate.py"), "bootstrap", "--database", str(cli_target)])
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertEqual(json.loads(cli.stdout)["result"], "bootstrap_v1")
        self.both(cli_target, "current")
        EVIDENCE["bootstrap"] = {"tables": len(inspected["structure"]["tables"]),
                                  "indexes": len(inspected["structure"]["indexes"]), "applicationRows": 0}

    def test_P1_02_legacy_recognition(self):
        self.both(self.source, "legacy_current")
        self.assertEqual(sha(self.source), self.source_sha)

    def test_P1_03_legacy_adoption(self):
        shutil.copyfile(self.source, self.adopted)
        self.assertEqual(sha(self.adopted), self.source_sha)
        before = snapshot(self.adopted)
        result = LIFECYCLE.prepare_database(self.adopted, self.contract)
        self.assertEqual(result["result"], "adopt_v1")
        self.assertEqual(snapshot(self.adopted), before)
        self.both(self.adopted, "current")
        EVIDENCE["adoption"] = {"before": before, "after": snapshot(self.adopted), "userVersion": 1,
                                 "shaAfter": sha(self.adopted), "logicalSchemaAndDataEqual": True}

    def test_P1_04_current_noop(self):
        before, logical = sha(self.adopted), snapshot(self.adopted)
        original_connect = sqlite3.connect
        def only_readonly(*args, **kwargs):
            self.assertIn("mode=ro", str(args[0]))
            return original_connect(*args, **kwargs)
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=only_readonly):
            result = LIFECYCLE.prepare_database(self.adopted, self.contract)
        self.assertEqual(result["result"], "already_current")
        self.assertEqual(sha(self.adopted), before)
        self.assertEqual(snapshot(self.adopted), logical)
        self.assertEqual(sidefiles(self.adopted), [])
        EVIDENCE["currentNoop"] = {"shaBefore": before, "shaAfter": sha(self.adopted),
                                   "writableConnections": 0, "logicalAndSchemaEqual": True}

    def test_P1_05_arbitrary_v0(self):
        target = self.directory / "unrelated.db"
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("CREATE TABLE unrelated (name TEXT)")
            conn.execute("INSERT INTO unrelated VALUES ('unchanged')")
        self.both(target, "structural_drift")
        self.reject_prepare(target)
        missing = self.directory / "typo.db"
        for command in ("inspect", "prepare"):
            result = run(["python", "-B", str(ROOT / "scripts/migrate.py"), command, "--database", str(missing)])
            self.assertEqual(result.returncode, 1)
            self.assertFalse(missing.exists())
        result = run(["python", "-B", str(ROOT / "scripts/migrate.py")])
        self.assertEqual(result.returncode, 2)
        with self.assertRaisesRegex(LIFECYCLE.LifecycleError, "invalid blank target"):
            LIFECYCLE.bootstrap_database(target, self.contract)

    def test_P1_06_missing_column(self):
        target = self.fixture_copy("missing-column")
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute('ALTER TABLE materials DROP COLUMN name_zh')
        inspected = self.both(target, "structural_drift")
        self.assertTrue(any("columns" in d["path"] for d in inspected["differences"]))
        self.reject_prepare(target)

    def test_P1_07_wrong_same_name_index(self):
        target = self.fixture_copy("wrong-index")
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("DROP INDEX idx_materials_catalog_layer")
            conn.execute("CREATE INDEX idx_materials_catalog_layer ON materials(record_origin COLLATE NOCASE DESC)")
        self.both(target, "structural_drift")
        self.reject_prepare(target)

    def test_P1_08_wrong_partial_predicate(self):
        target = self.fixture_copy("wrong-predicate")
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("DROP INDEX idx_import_batches_active_hash")
            conn.execute("CREATE UNIQUE INDEX idx_import_batches_active_hash ON import_batches(input_file_hash) WHERE status='rolled_back'")
        inspected = self.both(target, "structural_drift")
        self.assertTrue(any(d["path"].endswith("predicate") for d in inspected["differences"]))
        self.reject_prepare(target)

    def test_P1_09_future_version(self):
        target = self.fixture_copy("future")
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("PRAGMA user_version=999")
        self.both(target, "future_version")
        self.reject_prepare(target)
        cli = run(["python", "-B", str(ROOT / "scripts/migrate.py"), "prepare", "--database", str(target)])
        self.assertEqual(cli.returncode, 1)
        rejected = json.loads(cli.stderr)
        self.assertEqual((rejected["code"], rejected["userVersion"]), ("future_version", 999))

    def test_P1_10_v1_drift(self):
        target = self.fixture_copy("v1-drift")
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("CREATE TABLE extra (id INTEGER)")
        self.both(target, "structural_drift")
        self.reject_prepare(target)

    def test_P1_11_fk_enforcement(self):
        target = self.directory / "fk-rollback.db"
        target.touch()
        original_action = LIFECYCLE.bootstrap_action
        observed = {}
        def invalid_fk(conn, contract):
            observed["foreignKeys"] = conn.execute("PRAGMA foreign_keys").fetchone()[0]
            observed["inTransaction"] = conn.in_transaction
            original_action(conn, contract)
            conn.execute("INSERT INTO material_tags(material_id,tag,position) VALUES ('absent','test',0)")
        with mock.patch.object(LIFECYCLE, "bootstrap_action", side_effect=invalid_fk):
            with self.assertRaisesRegex(LIFECYCLE.LifecycleError, "FOREIGN KEY constraint failed"):
                LIFECYCLE.prepare_database(target, self.contract)
        self.assertEqual(observed, {"foreignKeys": 1, "inTransaction": True})
        self.both(target, "blank")
        EVIDENCE["foreignKeys"] = {**observed, "invalidInsertRejected": True, "ddlRolledBack": True}

    def test_P1_12_transaction_rollback(self):
        target = self.directory / "ddl-rollback.db"
        target.touch()
        original_action = LIFECYCLE.bootstrap_action
        def fail_after_ddl(conn, contract):
            original_action(conn, contract)
            raise LIFECYCLE.LifecycleError("injected test failure after DDL")
        with mock.patch.object(LIFECYCLE, "bootstrap_action", side_effect=fail_after_ddl):
            with self.assertRaisesRegex(LIFECYCLE.LifecycleError, "injected test failure"):
                LIFECYCLE.prepare_database(target, self.contract)
        self.both(target, "blank")
        # Fail after the version stamp on an existing data-bearing legacy copy.
        legacy = self.directory / "stamp-rollback.db"
        shutil.copyfile(self.source, legacy)
        before, byte_before = snapshot(legacy), sha(legacy)
        classify = LIFECYCLE.classify_connection
        def fail_post_stamp(conn, contract):
            result = classify(conn, contract)
            if conn.in_transaction and result["userVersion"] == 1:
                raise LIFECYCLE.LifecycleError("injected test failure after stamp")
            return result
        with mock.patch.object(LIFECYCLE, "classify_connection", side_effect=fail_post_stamp):
            with self.assertRaisesRegex(LIFECYCLE.LifecycleError, "after stamp"):
                LIFECYCLE.prepare_database(legacy, self.contract)
        self.both(legacy, "legacy_current")
        self.assertEqual(snapshot(legacy), before)
        self.assertEqual(sha(legacy), byte_before)
        EVIDENCE["rollback"] = {"afterDdl": "blank_v0", "afterStamp": "legacy_current_v0",
                                 "logicalAndSchemaEqual": True, "byteHashEqualAfterStampRollback": True}

    def test_P1_13_contract_parity(self):
        # Cosmetic SQL differences round-trip; literal/collation/constraint drift
        # remains visible. Author fixtures from the JSON, never source DB DDL.
        cosmetic = self.directory / "cosmetic.db"
        identifiers = {"binary"}
        for table in self.contract["structure"]["tables"]:
            identifiers.add(table["name"])
            identifiers.update(c["name"] for c in table["columns"])
        identifiers.update(i["name"] for i in self.contract["structure"]["indexes"])
        def cosmetic_sql(sql):
            cur, values = LIFECYCLE.Cursor(LIFECYCLE.tokens(sql)), []
            while cur.peek() is not None:
                value = cur.pop()
                if value == "check":
                    values.extend(["check", "(", "(", *cur.group(), ")", ")"])
                elif value == "default":
                    values.extend(["default", "(", cur.pop(), ")"])
                elif value == "where":
                    values.extend(["where", "(", "(", *cur.values[cur.pos:], ")", ")"])
                    cur.pos = len(cur.values)
                else:
                    values.append(value)
            return "\n ".join("[" + v + "]" if v in identifiers else v for v in values)
        with closing(sqlite3.connect(cosmetic)) as conn, conn:
            for sql in LIFECYCLE.ddl_statements(self.contract):
                conn.execute(cosmetic_sql(sql))
            conn.execute("PRAGMA user_version=1")
        self.both(cosmetic, "current")
        # A changed literal is semantically significant.
        modified = copy.deepcopy(self.contract)
        materials = next(t for t in modified["structure"]["tables"] if t["name"] == "materials")
        next(c for c in materials["columns"] if c["name"] == "record_origin")["default"] = "'LEGACY'"
        literal = self.directory / "literal.db"
        LIFECYCLE.bootstrap_database(literal, modified)
        self.both(literal, "structural_drift")
        variants = []
        def variant(name, change, expected="structural_drift"):
            altered = copy.deepcopy(self.contract)
            change(altered["structure"])
            target = self.directory / (name + ".db")
            with closing(sqlite3.connect(target)) as conn, conn:
                for statement in LIFECYCLE.ddl_statements(altered):
                    conn.execute(statement)
                conn.execute("PRAGMA user_version=1")
            self.both(target, expected)
            self.reject_prepare(target)
            variants.append(name)
        table = lambda s, name: next(t for t in s["tables"] if t["name"] == name)
        variant("declared-type", lambda s: table(s, "materials")["columns"][1].update(type="REAL"))
        variant("not-null", lambda s: table(s, "materials")["columns"][1].update(notNull=False))
        variant("check-added", lambda s: table(s, "materials")["checks"].append("record_type in ( 'legacy' )"))
        variant("check-removed", lambda s: table(s, "import_batches")["checks"].clear())
        variant("unique-removed", lambda s: table(s, "evidence_sources")["unique"].clear())
        variant("pk-order", lambda s: table(s, "material_tags")["primaryKey"].reverse())
        variant("autoincrement-removed", lambda s: table(s, "material_sources").update(autoincrement=None))
        variant("fk-action", lambda s: table(s, "material_tags")["foreignKeys"][0].update(onDelete="RESTRICT"))
        variant("fk-deferrable", lambda s: table(s, "material_tags")["foreignKeys"][0].update(deferrable=True, initiallyDeferred=True))
        variant("unknown-check", lambda s: table(s, "materials")["checks"].append("length(name) > 0"), "unsupported")
        EVIDENCE["additionalDriftFixtures"] = variants
        # Explicit unsupported constructs must not be accepted via metadata alone.
        unsupported = self.fixture_copy("unsupported-trigger")
        with closing(sqlite3.connect(unsupported)) as conn, conn:
            conn.execute("CREATE TRIGGER forbidden AFTER INSERT ON material_tags BEGIN SELECT 1; END")
        self.both(unsupported, "unsupported")
        self.reject_prepare(unsupported)
        mismatch = self.fixture_copy("version-mismatch")
        with closing(sqlite3.connect(mismatch)) as conn, conn:
            conn.execute("PRAGMA user_version=-1")
        self.both(mismatch, "version_mismatch")
        self.reject_prepare(mismatch)
        # WAL mode is rejected before either inspector can create side artifacts.
        wal = self.fixture_copy("wal")
        conn = sqlite3.connect(wal)
        conn.execute("PRAGMA journal_mode=WAL"); conn.close()
        before = sha(wal)
        with self.assertRaisesRegex(LIFECYCLE.LifecycleError, "header/journal mode"):
            LIFECYCLE.inspect_database(wal, self.contract)
        node = run(["node", str(ROOT / "schema-contract.js"), "inspect", "--database", str(wal)])
        self.assertEqual(node.returncode, 1)
        self.assertIn("header/journal mode", node.stderr)
        self.assertEqual(sha(wal), before); self.assertEqual(sidefiles(wal), [])
        EVIDENCE["parityFixtures"] = self.parity_fixtures.copy()

    def test_P1_14_ddl_roundtrip(self):
        inspected = self.both(self.fixture, "current")
        self.assertEqual(inspected["structure"], self.contract["structure"])
        another = self.directory / "deterministic.db"
        LIFECYCLE.bootstrap_database(another, self.contract)
        self.assertEqual(sha(self.fixture), sha(another))
        before = sha(another)
        self.assertEqual(LIFECYCLE.prepare_database(another, self.contract)["result"], "already_current")
        self.assertEqual(sha(another), before)
        EVIDENCE["finalizationInput"] = {"independentBootstrapsByteEqual": True, "finalShaStableOnNoop": True,
                                          "schemaVersion": 1, "sha": before}

    def test_P1_15_repository_safety(self):
        self.verify_repository()

    def test_P1_16_no_bootstrap_cloning(self):
        # Disconnect the runner from the repository DB entirely and observe
        # writable SQL. This is a behavioral assertion, not just a source grep.
        isolated_contract = self.directory / "contract.json"
        isolated_contract.write_text(json.dumps(self.contract), encoding="utf-8")
        target = self.directory / "no-clone.db"
        connect, trace = sqlite3.connect, []
        def only_target(database, *args, **kwargs):
            self.assertIn(target.as_uri(), str(database))
            conn = connect(database, *args, **kwargs)
            conn.set_trace_callback(trace.append)
            return conn
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=only_target):
            LIFECYCLE.bootstrap_database(target, LIFECYCLE.load_contract(isolated_contract))
        expected = list(LIFECYCLE.ddl_statements(self.contract))
        created = [sql for sql in trace if sql.startswith("CREATE ")]
        self.assertEqual(created, expected)
        self.assertEqual(len(created), 24)
        self.assertNotIn("executescript", inspect.getsource(LIFECYCLE.atomic_transition))
        self.both(target, "current")
        EVIDENCE["noBootstrapCloning"] = {"onlyTargetConnected": True, "ddlMatchesJson": True, "ddlStatements": len(created)}



class BlockerFixTests(unittest.TestCase):
    """Independent blocker expectations, with no dependence on P1 test order."""
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="matfinder-blocker-regression-")
        cls.directory = Path(cls.temp.name).resolve()
        assert not cls.directory.is_relative_to(ROOT)
        cls.contract = LIFECYCLE.load_contract()
        cls.fixture = cls.directory / "current.db"
        LIFECYCLE.bootstrap_database(cls.fixture, cls.contract)
        cls.cli_root = cls.directory / "isolated-cli"
        (cls.cli_root / "scripts").mkdir(parents=True)
        # Byte-identical consumers exercise their real CLI/default-contract path.
        for name in ("schema-contract.js", "scripts/migrate.py"):
            shutil.copyfile(ROOT / name, cls.cli_root / name)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def node(self, target, contract):
        contract_path = self.directory / "selected-contract.json"
        contract_path.write_text(json.dumps(contract), encoding="utf-8")
        script = ("const m=require(process.argv[1]); try {"
                  "console.log(JSON.stringify(m.inspectDatabase(process.argv[2],m.loadContract(process.argv[3]))));"
                  "} catch(e) { console.error(e.message);process.exitCode=1; }")
        result = run(["node", "-e", script, str(ROOT / "schema-contract.js"), str(target), str(contract_path)])
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def copy_fixture(self, name):
        target = self.directory / (name + ".db")
        shutil.copyfile(self.fixture, target)
        return target

    def test_BR_01_json_version_and_registry_authority(self):
        changed = copy.deepcopy(self.contract)
        changed["currentSchemaVersion"] = 7
        changed["profiles"]["formal_current"]["userVersion"] = 7
        # Change input versions too: a hard-coded 0->1 matrix cannot pass.
        for name in ("blank", "legacy_current"):
            changed["profiles"][name]["userVersion"] = 3
        for tr in changed["transitions"]:
            tr.update(fromVersion=3, toVersion=7)
        contract_path = self.directory / "version-7.json"
        contract_path.write_text(json.dumps(changed), encoding="utf-8")
        changed = LIFECYCLE.load_contract(contract_path)
        target = self.copy_fixture("authority")
        classifications = []
        for version, expected in ((1, "version_mismatch"), (3, "legacy_current"),
                                  (6, "version_mismatch"), (7, "current"), (8, "future_version")):
            with closing(sqlite3.connect(target)) as conn, conn:
                conn.execute("PRAGMA user_version=" + str(version))
            self.assertEqual(LIFECYCLE.inspect_database(target, changed)["classification"], expected)
            self.assertEqual(self.node(target, changed)["classification"], expected)
            classifications.append([version, expected])
        with closing(sqlite3.connect(target)) as conn, conn:
            conn.execute("PRAGMA user_version=3")
        trace, connect = [], sqlite3.connect
        def traced(*args, **kwargs):
            conn = connect(*args, **kwargs); conn.set_trace_callback(trace.append); return conn
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=traced):
            result = LIFECYCLE.prepare_database(target, changed)
        self.assertEqual(result["result"], "adopt_v1")
        self.assertEqual(result["userVersion"], 7)
        self.assertIn("PRAGMA user_version=7", trace)
        self.assertEqual(self.node(target, changed)["classification"], "current")
        blank = self.directory / "authority-blank.db"
        with closing(sqlite3.connect(blank)) as conn, conn:
            conn.execute("PRAGMA user_version=3")
        self.assertEqual(LIFECYCLE.prepare_database(blank, changed)["userVersion"], 7)
        absent = copy.deepcopy(changed)
        absent["transitions"] = []
        no_transition = self.copy_fixture("no-transition")
        with closing(sqlite3.connect(no_transition)) as conn, conn:
            conn.execute("PRAGMA user_version=3")
        before = sha(no_transition)
        def readonly_only(*args, **kwargs):
            self.assertIn("mode=ro", str(args[0])); return connect(*args, **kwargs)
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=readonly_only):
            with self.assertRaises(LIFECYCLE.LifecycleError):
                LIFECYCLE.prepare_database(no_transition, absent)
        self.assertEqual(sha(no_transition), before)
        # Removing only bootstrap must not cause a fallback to synthesize it.
        absent["transitions"] = [changed["transitions"][1]]
        empty = self.directory / "missing-bootstrap.db"
        with closing(sqlite3.connect(empty)) as conn, conn:
            conn.execute("PRAGMA user_version=3")
        before_empty = sha(empty)
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=readonly_only):
            with self.assertRaises(LIFECYCLE.LifecycleError):
                LIFECYCLE.prepare_database(empty, absent)
        self.assertEqual(sha(empty), before_empty)
        EVIDENCE["BR-01"] = {"contractCurrent": 7, "inputVersion": 3, "classifications": classifications,
                             "stamp": 7, "bootstrapStamp": 7, "absentTransitionsRejected": True}

    def test_BR_02_semantic_oracle_and_bad_adoption(self):
        oracle = []
        candidates = [('evidence_fingerprint IS NOT "null"', "unsupported", [1, 0, 1, 1]),
                      ('evidence_fingerprint IS NOT "NULL"', "unsupported", [1, 1, 0, 1]),
                      ("evidence_fingerprint IS NOT 'NULL'", "unsupported", [1, 1, 0, 1]),
                      ('"evidence_fingerprint" IS NOT NULL', "current", [0, 1, 1, 1]),
                      ("evidence_fingerprint IS NOT NULL", "current", [0, 1, 1, 1]),
                      ("evidence_fingerprint IS NOT 'word NULL here'", "unsupported", [1, 1, 1, 0]),
                      ("  EVIDENCE_FINGERPRINT  iS  nOt  NuLl ", "current", [0, 1, 1, 1])]
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.execute("CREATE TABLE oracle(evidence_fingerprint TEXT)")
            conn.executemany("INSERT INTO oracle VALUES (?)", [(None,), ("null",), ("NULL",), ("word NULL here",)])
            baseline = [r[0] for r in conn.execute("SELECT evidence_fingerprint IS NOT NULL FROM oracle ORDER BY rowid")]
            self.assertEqual(baseline, [0, 1, 1, 1])
            for i, (predicate, expected, truth) in enumerate(candidates):
                actual = [r[0] for r in conn.execute("SELECT " + predicate + " FROM oracle ORDER BY rowid")]
                self.assertEqual(actual, truth)  # independent SQL truth table, not consumer agreement
                self.assertEqual(actual == baseline, expected == "current")
                target = self.copy_fixture("predicate-" + str(i))
                with closing(sqlite3.connect(target)) as db, db:
                    db.execute("DROP INDEX idx_material_evidence_fingerprint")
                    db.execute("CREATE UNIQUE INDEX idx_material_evidence_fingerprint "
                               "ON material_evidence(evidence_fingerprint) WHERE " + predicate)
                before = sha(target)
                py, node = LIFECYCLE.inspect_database(target, self.contract), self.node(target, self.contract)
                self.assertEqual(py["classification"], expected)
                self.assertEqual(node["classification"], expected)
                self.assertEqual(sha(target), before)
                oracle.append({"predicate": predicate, "truth": actual, "expected": expected})
        bad = self.copy_fixture("bad-v0")
        with closing(sqlite3.connect(bad)) as conn, conn:
            conn.execute("DROP INDEX idx_material_evidence_fingerprint")
            conn.execute('CREATE UNIQUE INDEX idx_material_evidence_fingerprint '
                         'ON material_evidence(evidence_fingerprint) WHERE evidence_fingerprint IS NOT "null"')
            conn.execute("PRAGMA user_version=0")
        before, trace, connections, connect = sha(bad), [], [], sqlite3.connect
        def readonly_only(*args, **kwargs):
            self.assertIn("mode=ro", str(args[0]))
            connections.append(str(args[0]))
            conn = connect(*args, **kwargs); conn.set_trace_callback(trace.append); return conn
        self.assertEqual(LIFECYCLE.inspect_database(bad, self.contract)["classification"], "unsupported")
        self.assertEqual(self.node(bad, self.contract)["classification"], "unsupported")
        with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=readonly_only):
            with self.assertRaises(LIFECYCLE.LifecycleError):
                LIFECYCLE.prepare_database(bad, self.contract)
        self.assertFalse(any(sql.upper().startswith(("BEGIN", "COMMIT", "ROLLBACK", "CREATE", "UPDATE",
                                                    "INSERT", "DELETE", "PRAGMA USER_VERSION=")) for sql in trace))
        cli = run(["python", "-B", str(ROOT / "scripts/migrate.py"), "prepare", "--database", str(bad)])
        self.assertEqual(cli.returncode, 1, cli.stdout + cli.stderr)
        with closing(LIFECYCLE.readonly_connection(bad)) as conn:
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 0)
        self.assertEqual(sha(bad), before); self.assertEqual(sidefiles(bad), [])
        EVIDENCE["BR-02"] = {"oracle": oracle, "badV0Version": 0, "badV0HashUnchanged": True,
                             "connections": connections, "transactionOrMutation": False, "prepareExit": cli.returncode}

    def test_TR_01_column_level_check_parity(self):
        table = next(t for t in self.contract["structure"]["tables"] if t["name"] == "import_batches")
        check = next(v for v in table["checks"] if v.startswith("status "))
        canonical = self.contract["structure"]
        for result in (LIFECYCLE.inspect_database(self.fixture, self.contract), self.node(self.fixture, self.contract)):
            self.assertEqual(result["classification"], "current")
            self.assertEqual(result["structure"], canonical)
        outcomes = []

        def fixture(name, predicate, on_column):
            target = self.directory / (name + ".db")
            with closing(sqlite3.connect(target)) as conn, conn:
                for statement in LIFECYCLE.ddl_statements(self.contract):
                    if statement.startswith('CREATE TABLE "import_batches"'):
                        removed = ", CHECK (" + check + ")"
                        self.assertEqual(statement.count(removed), 1)
                        statement = statement.replace(removed, "", 1)
                        col = next(c for c in table["columns"] if c["name"] == on_column)
                        declaration = LIFECYCLE.quote(on_column) + " " + col["type"]
                        self.assertEqual(statement.count(declaration), 1)
                        statement = statement.replace(declaration, declaration + " CHECK (" + predicate + ")", 1)
                    conn.execute(statement)
                conn.execute("PRAGMA user_version=1")
            return target

        # Same supported CHECK on its own column, on an earlier column (so the
        # referenced column is not known yet), and using quoted known identifiers.
        for name, predicate, column in [
            ("inline-own", check, "status"),
            ("inline-forward-reference", check, table["columns"][0]["name"]),
            ("inline-quoted", check.replace("status", '"status"', 1), "status"),
        ]:
            with self.subTest(name=name):
                target = fixture(name, predicate, column)
                for version, expected in [(1, "current"), (0, "legacy_current")]:
                    with closing(sqlite3.connect(target)) as conn, conn:
                        conn.execute("PRAGMA user_version=" + str(version))
                    before = sha(target)
                    py = LIFECYCLE.inspect_database(target, self.contract)
                    node = self.node(target, self.contract)  # independent Node process
                    self.assertEqual(py["classification"], expected)
                    self.assertEqual(node["classification"], expected)
                    self.assertEqual(py["structure"], canonical)
                    self.assertEqual(node["structure"], canonical)
                    self.assertEqual(py["structure"], node["structure"])
                    self.assertEqual(sha(target), before)
                    outcomes.append({"fixture": name, "version": version, "python": expected, "node": expected,
                                     "canonicalChecksEqual": True})
                logical = snapshot(target)
                receipt = LIFECYCLE.prepare_database(target, self.contract)
                self.assertEqual((receipt["result"], receipt["userVersion"]), ("adopt_v1", 1))
                self.assertEqual(snapshot(target), logical)
                self.assertEqual(LIFECYCLE.inspect_database(target, self.contract)["classification"], "current")
                self.assertEqual(self.node(target, self.contract)["classification"], "current")
                self.assertEqual(sidefiles(target), [])

        # Only the known identifier can normalize to the contract CHECK. None of
        # these keyword-like/unknown/literal tokens may be silently treated as it.
        for i, token in enumerate(['"unknown_column"', '"null"', '"NULL"', "'NULL'", "NULL"]):
            target = fixture("inline-unsafe-" + str(i), check.replace("status", token, 1), "status")
            before = sha(target)
            for version in (1, 0):
                with closing(sqlite3.connect(target)) as conn, conn:
                    conn.execute("PRAGMA user_version=" + str(version))
                before = sha(target)
                py, node = LIFECYCLE.inspect_database(target, self.contract), self.node(target, self.contract)
                self.assertEqual(py["classification"], "unsupported")
                self.assertEqual(node["classification"], "unsupported")
                self.assertEqual(sha(target), before)
                connect = sqlite3.connect
                def readonly_only(*args, **kwargs):
                    self.assertIn("mode=ro", str(args[0]))
                    return connect(*args, **kwargs)
                with mock.patch.object(LIFECYCLE.sqlite3, "connect", side_effect=readonly_only):
                    with self.assertRaises(LIFECYCLE.LifecycleError):
                        LIFECYCLE.prepare_database(target, self.contract)
                self.assertEqual(sha(target), before)
                self.assertEqual(sidefiles(target), [])
                outcomes.append({"token": token, "version": version, "python": "unsupported",
                                 "node": "unsupported", "hashUnchanged": True})
        EVIDENCE["TR-01"] = {"fixtures": outcomes, "adoptionLogicalPreservation": True,
                             "sameNormalizerAndCompleteColumnContext": True}

    def test_BR_03_malformed_contract_fails_before_mutation(self):
        variants = []
        def variant(name, change):
            c = copy.deepcopy(self.contract); change(c); variants.append((name, c))
        # Preserve JSON numeric lexemes with json.dumps (1.0 must not become 1).
        for field in ("contractFormatVersion", "currentSchemaVersion"):
            for value in (True, False, "1", 1.0, None):
                variant(field + "-" + repr(value), lambda c, f=field, v=value: c.update({f: v}))
        for field in ("fromVersion", "toVersion"):
            for value in (True, False, "1", 1.0, None):
                variant(field + "-" + repr(value), lambda c, f=field, v=value: c["transitions"][0].update({f: v}))
        variant("missing-action", lambda c: c["transitions"][0].pop("action"))
        # The request also names formatVersion; it is not this contract's format field.
        # Reject that alias rather than silently accepting or translating it.
        variant("formatVersion-boolean-alias", lambda c: c.update(formatVersion=True))
        variant("unknown-profile", lambda c: c["transitions"][0].update(inputProfile="unknown"))
        variant("unknown-structure", lambda c: c["transitions"][0].update(structureRef="unknown"))
        variant("unknown-action", lambda c: c["transitions"][0].update(action="unknown"))
        variant("duplicate-transition", lambda c: c["transitions"].append(copy.deepcopy(c["transitions"][0])))
        variant("conflicting-transition", lambda c: c["transitions"].append(dict(c["transitions"][0], action="adopt_v1")))
        variant("wrong-target", lambda c: c["transitions"][0].update(toVersion=2))
        variant("missing-registry", lambda c: c.pop("transitions"))
        variant("missing-tables", lambda c: c["structure"].pop("tables"))
        variant("invalid-index", lambda c: c["structure"]["indexes"][0].update(keys={}))
        variant("invalid-column", lambda c: c["structure"]["tables"][0]["columns"][0].update(notNull=1))
        variant("profile-boolean-version", lambda c: c["profiles"]["formal_current"].update(userVersion=True))
        variant("ordinal-boolean", lambda c: c["structure"]["tables"][0]["columns"][0].update(primaryKeyOrder=True))
        variants.extend([("top-list", []), ("top-null", None)])
        target = self.copy_fixture("malformed-target")
        results = []
        for i, (name, c) in enumerate(variants):
            with self.subTest(name=name):
                before = sha(target)
                missing = self.directory / ("malformed-new-" + str(i) + ".db")
                contract_path = self.cli_root / "database-schema-contract.json"
                contract_path.write_text(json.dumps(c), encoding="utf-8")
                # Public mutation APIs also validate caller-supplied objects.
                if c is not None:  # None denotes "load default" at the API, malformed null is covered via real CLI.
                    with mock.patch.object(LIFECYCLE.sqlite3, "connect") as connect:
                        with self.assertRaises(LIFECYCLE.LifecycleError):
                            LIFECYCLE.prepare_database(target, c)
                        with self.assertRaises(LIFECYCLE.LifecycleError):
                            LIFECYCLE.bootstrap_database(missing, c)
                        connect.assert_not_called()
                commands = [
                    ["python", "-B", str(self.cli_root / "scripts/migrate.py"), "prepare", "--database", str(target)],
                    ["python", "-B", str(self.cli_root / "scripts/migrate.py"), "bootstrap", "--database", str(missing)],
                    ["node", str(self.cli_root / "schema-contract.js"), "inspect", "--database", str(target)]]
                exits = []
                for command in commands:
                    result = run(command); self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    exits.append(result.returncode)
                self.assertEqual(sha(target), before); self.assertFalse(missing.exists())
                self.assertEqual(sidefiles(target), [])
                results.append({"variant": name, "prepareBootstrapNodeExit": exits,
                                "hashUnchanged": True, "newTargetAbsent": True})
        EVIDENCE["BR-03"] = {"variants": results, "beforeWritableOpen": True}


if __name__ == "__main__":
    if sys.argv[1:] == ["--tr-01"]:
        suite = unittest.TestSuite(BlockerFixTests(name) for name in
                                   ("test_TR_01_column_level_check_parity", "test_BR_02_semantic_oracle_and_bad_adoption"))
    else:
        classes = ([RepositorySafetyTests, CommitStateTests] if sys.argv[1:] == ["--pc-01"] else
                   [RepositorySafetyTests] if sys.argv[1:] == ["--p2-br-01"] else
                   [BlockerFixTests] if sys.argv[1:] == ["--blockers"] else
                   [RepositorySafetyTests, CommitStateTests, SchemaLifecycleTests, BlockerFixTests])
        suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    result = unittest.TextTestRunner(verbosity=2, failfast=sys.argv[1:] in (["--blockers"], ["--tr-01"], ["--p2-br-01"], ["--pc-01"])).run(suite)
    evidence_dir = Path(tempfile.mkdtemp(prefix="matfinder-schema-lifecycle-evidence-"))
    EVIDENCE.update({"commands": COMMANDS, "testsRun": result.testsRun,
                     "failures": len(result.failures), "errors": len(result.errors), "passed": result.wasSuccessful()})
    (evidence_dir / "report.json").write_text(json.dumps(EVIDENCE, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"evidenceDirectory": str(evidence_dir), "testsRun": result.testsRun, "passed": result.wasSuccessful()}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
