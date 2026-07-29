import hashlib
import json
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

from real_material_importer import execute_import, rollback_import


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_DATABASE = ROOT / "matfinder.db"
COUNTED_TABLES = (
    "materials",
    "material_evidence",
    "material_property_evidence",
    "material_certifications",
    "evidence_sources",
    "real_material_identities",
    "import_batches",
    "import_entity_links",
)


def fixture(grade="TEST-ONLY-GRADE", include_second_condition=False):
    identity_source = {
        "sourceType": "official_datasheet",
        "sourceTitle": "TEST ONLY - NOT A REAL DATASHEET",
        "sourceUrl": "https://example.invalid/test-only-identity",
        "sourceDate": "2026-07-29",
        "verificationStatus": "verified",
        "confidenceLevel": "high",
        "lastVerifiedAt": "2026-07-29",
    }

    def measurement(
        property_key,
        value,
        unit,
        standard,
        condition,
        source_suffix,
    ):
        return {
            "propertyKey": property_key,
            "measurements": [
                {
                    "value": value,
                    "unit": unit,
                    "testStandard": standard,
                    "testCondition": condition,
                    "valueType": "typical",
                    "sourceType": "official_datasheet",
                    "sourceTitle": "TEST ONLY - NOT A REAL DATASHEET",
                    "sourceUrl": (
                        f"https://example.invalid/test-only-{source_suffix}"
                    ),
                    "sourceDate": "2026-07-29",
                    "verificationStatus": "verified",
                    "confidenceLevel": "high",
                    "lastVerifiedAt": "2026-07-29",
                }
            ],
        }

    properties = [
        measurement(
            "density", 1.2, "g/cm3", "ASTM D792", "23 degC; dry", "density"
        ),
        measurement(
            "tensile_strength",
            65,
            "MPa",
            "ASTM D638",
            "23 degC; dry",
            "tensile",
        ),
        measurement(
            "hdt", 130, "degC", "ASTM D648", "1.8 MPa", "hdt"
        ),
        measurement(
            "continuous_use_temperature",
            110,
            "degC",
            "IEC 60216",
            "20,000 h criterion",
            "continuous",
        ),
    ]
    if include_second_condition:
        properties[0]["measurements"].append(
            {
                **properties[0]["measurements"][0],
                "value": 1.18,
                "testCondition": "23 degC; conditioned",
                "sourceUrl": (
                    "https://example.invalid/test-only-density-conditioned"
                ),
            }
        )
    return {
        "templateVersion": "TEST-ONLY",
        "materials": [
            {
                "manufacturer": "TEST ONLY - NOT A REAL MANUFACTURER",
                "brand": None,
                "commercialGrade": grade,
                "materialFamily": "PC",
                "officialTdsLinks": [identity_source["sourceUrl"]],
                "identitySources": [identity_source],
                "properties": properties,
                "certifications": [
                    {
                        "certificationName": "RoHS",
                        "certificationStatus": "compliant",
                        "scope": "TEST ONLY - NOT A REAL CERTIFICATION SCOPE",
                        "sourceType": "manufacturer",
                        "sourceTitle": (
                            "TEST ONLY - NOT A REAL CERTIFICATION RECORD"
                        ),
                        "sourceUrl": (
                            "https://example.invalid/test-only-rohs"
                        ),
                        "sourceDate": "2026-07-29",
                        "verificationStatus": "verified",
                        "confidenceLevel": "high",
                        "lastVerifiedAt": "2026-07-29",
                    }
                ],
            }
        ],
    }


def write_fixture(path, payload):
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def counts(database):
    connection = sqlite3.connect(database)
    try:
        return {
            table: connection.execute(
                f"SELECT COUNT(*) FROM {table}"
            ).fetchone()[0]
            for table in COUNTED_TABLES
        }
    finally:
        connection.close()


with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    database = temp / "import-test.db"
    shutil.copy2(PRODUCTION_DATABASE, database)
    input_file = temp / "pilot-test-only.json"
    write_fixture(input_file, fixture())

    legacy_id = "TEST-ONLY-LEGACY-GENERATED-COLLISION"
    connection = sqlite3.connect(database)
    try:
        connection.row_factory = sqlite3.Row
        source_row = connection.execute(
            "SELECT * FROM materials LIMIT 1"
        ).fetchone()
        legacy_row = dict(source_row)
        legacy_row.update(
            {
                "material_id": legacy_id,
                "name": "TEST ONLY LEGACY COLLISION",
                "name_en": "TEST ONLY LEGACY COLLISION",
                "name_zh": "TEST ONLY LEGACY COLLISION",
                "manufacturer": "TEST ONLY - NOT A REAL MANUFACTURER",
                "grade_name": "TEST-ONLY-GRADE",
                "trade_name": "TEST-ONLY-GRADE",
                "material_family": "PC",
                "family": "PC",
                "record_type": "legacy",
                "record_origin": "generated",
                "scope_status": "in_scope",
                "catalog_visibility": "admin_only",
            }
        )
        columns = list(legacy_row)
        connection.execute(
            f"INSERT INTO materials ({', '.join(columns)}) "
            f"VALUES ({', '.join('?' for _ in columns)})",
            [legacy_row[column] for column in columns],
        )
        connection.commit()
    finally:
        connection.close()

    before_hash = hashlib.sha256(database.read_bytes()).hexdigest()
    before_counts = counts(database)
    dry_run = execute_import(
        database,
        input_file,
        dry_run=True,
        operator="automated-test",
        import_source="test fixture",
        allow_test_fixtures=True,
    )
    after_hash = hashlib.sha256(database.read_bytes()).hexdigest()
    assert dry_run["status"] == "ready"
    assert dry_run["counts"] == {
        "add": 1,
        "update": 0,
        "skip": 0,
        "reject": 0,
    }
    assert before_hash == after_hash, "Dry-run must not modify the database."
    assert before_counts == counts(database)

    first = execute_import(
        database,
        input_file,
        operator="automated-test",
        import_source="test fixture",
        allow_test_fixtures=True,
    )
    assert first["status"] == "committed"
    after_first = counts(database)
    assert after_first["materials"] == before_counts["materials"] + 1
    connection = sqlite3.connect(database)
    try:
        exact_rows = connection.execute(
            """
            SELECT material_id, record_type, record_origin
              FROM materials
             WHERE manufacturer = ?
               AND grade_name = ?
               AND material_family = ?
             ORDER BY material_id
            """,
            (
                "TEST ONLY - NOT A REAL MANUFACTURER",
                "TEST-ONLY-GRADE",
                "PC",
            ),
        ).fetchall()
    finally:
        connection.close()
    assert len(exact_rows) == 2
    assert {row[0] for row in exact_rows} != {legacy_id}
    assert any(
        row[1:] == ("commercial_grade", "imported")
        for row in exact_rows
    ), "A real import must create a distinct commercial-grade identity."
    assert (
        after_first["material_property_evidence"]
        == before_counts["material_property_evidence"] + 4
    )
    assert (
        after_first["material_certifications"]
        == before_counts["material_certifications"] + 1
    )
    reader_check = temp / "read-imported-evidence.js"
    reader_check.write_text(
        """
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { readMaterials } = require(process.argv[2]);
const { annotateMaterialQuality } = require(process.argv[4]);
const materials = readMaterials(process.argv[3]);
const item = materials.find((material) =>
  material.evidence?.identity?.commercialGrade === "TEST-ONLY-GRADE"
);
assert.ok(item, "Imported exact identity must be readable by the application.");
assert.equal(item.evidence.identity.sources[0].sourceUrl,
  "https://example.invalid/test-only-identity");
assert.equal(item.evidence.properties.density[0].testStandard, "ASTM D792");
assert.equal(item.evidence.properties.tensile_strength[0].testCondition,
  "23 degC; dry");
assert.equal(item.evidence.certifications[0].certificationName, "RoHS");
assert.equal(item.evidence.certifications[0].source.sourceUrl,
  "https://example.invalid/test-only-rohs");
const reviewed = annotateMaterialQuality(item);
assert.equal(reviewed.data_quality.level, "high");
const browserContext = { window: {} };
vm.createContext(browserContext);
vm.runInContext(fs.readFileSync(process.argv[5], "utf8"), browserContext);
(async () => {
  const service = browserContext.window.MatFinderAI
    .createRecommendationService({ materials: [reviewed] });
  const result = await service.recommend(
    "tensile strength at least 50 MPa; test condition: 23 degC; " +
    "ASTM D638; RoHS required"
  );
  assert.equal(result.groups.verifiedMatches.length, 1);
  assert.ok(result.groups.verifiedMatches[0].requirementResults.every(
    (requirement) => requirement.status === "satisfied"
  ));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
""".strip()
        + "\n",
        encoding="utf-8",
    )
    reader_result = subprocess.run(
        [
            "node",
            str(reader_check),
            str(ROOT / "scripts" / "read-materials-sqlite.js"),
            str(database),
            str(ROOT / "material-quality.js"),
            str(ROOT / "recommendation-engine.js"),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert reader_result.returncode == 0, (
        "Application evidence reader failed after import:\n"
        f"{reader_result.stdout}\n{reader_result.stderr}"
    )

    repeated = execute_import(
        database,
        input_file,
        operator="automated-test",
        import_source="test fixture",
        allow_test_fixtures=True,
    )
    assert repeated["status"] == "already_imported"
    assert repeated["importBatchId"] == first["importBatchId"]
    assert counts(database) == after_first

    second_file = temp / "pilot-test-only-v2.json"
    write_fixture(
        second_file, fixture(include_second_condition=True)
    )
    second = execute_import(
        database,
        second_file,
        operator="automated-test",
        import_source="test fixture update",
        allow_test_fixtures=True,
    )
    assert second["status"] == "committed"
    assert second["counts"]["update"] == 1
    after_second = counts(database)
    assert (
        after_second["material_property_evidence"]
        == after_first["material_property_evidence"] + 1
    )

    conflict_payload = fixture(include_second_condition=True)
    original_tensile = conflict_payload["materials"][0]["properties"][1][
        "measurements"
    ][0]
    conflict_payload["materials"][0]["properties"][1]["measurements"].append(
        {
            **original_tensile,
            "value": 110,
            "sourceUrl": (
                "https://example.invalid/test-only-tensile-conflict"
            ),
        }
    )
    conflict_file = temp / "pilot-test-only-conflict.json"
    write_fixture(conflict_file, conflict_payload)
    conflict_batch = execute_import(
        database,
        conflict_file,
        operator="automated-test",
        import_source="test fixture conflict",
        allow_test_fixtures=True,
    )
    assert conflict_batch["status"] == "committed"
    connection = sqlite3.connect(database)
    try:
        conflicting_claims = connection.execute(
            """
            SELECT COUNT(*)
              FROM material_property_evidence
             WHERE property_key = 'tensile_strength'
               AND conflict_status = 'conflicting'
               AND import_batch_id IN (?, ?)
            """,
            (first["importBatchId"], conflict_batch["importBatchId"]),
        ).fetchone()[0]
    finally:
        connection.close()
    assert (
        conflicting_claims == 2
    ), "Clearly different values under the same context must both be flagged."
    after_conflict = counts(database)

    first_rollback = rollback_import(
        database, first["importBatchId"], "automated-test"
    )
    assert first_rollback["status"] == "rolled_back"
    after_first_rollback = counts(database)
    assert after_first_rollback["materials"] == after_conflict["materials"]
    assert (
        after_first_rollback["material_property_evidence"]
        == after_conflict["material_property_evidence"]
    ), "Evidence referenced by the second batch must survive first-batch rollback."

    second_rollback = rollback_import(
        database, second["importBatchId"], "automated-test"
    )
    assert second_rollback["status"] == "rolled_back"
    after_second_rollback = counts(database)
    assert (
        after_second_rollback["material_property_evidence"]
        == after_conflict["material_property_evidence"]
    ), "Evidence referenced by the conflict batch must survive second-batch rollback."

    conflict_rollback = rollback_import(
        database, conflict_batch["importBatchId"], "automated-test"
    )
    assert conflict_rollback["status"] == "rolled_back"
    after_second_rollback = counts(database)
    assert after_second_rollback["materials"] == before_counts["materials"]
    assert (
        after_second_rollback["material_property_evidence"]
        == before_counts["material_property_evidence"]
    )
    assert (
        after_second_rollback["material_certifications"]
        == before_counts["material_certifications"]
    )

    rollback_file = temp / "pilot-rollback-test-only.json"
    write_fixture(rollback_file, fixture("TEST-ONLY-ROLLBACK-GRADE"))
    before_failure = counts(database)
    try:
        execute_import(
            database,
            rollback_file,
            operator="automated-test",
            import_source="rollback test fixture",
            fail_after_entities=2,
            allow_test_fixtures=True,
        )
        raise AssertionError("Injected failure should abort the import.")
    except RuntimeError as error:
        assert "Injected importer rollback test failure" in str(error)
    assert (
        counts(database) == before_failure
    ), "A severe in-transaction failure must roll back every database change."

print(
    "Real-material import-to-reader-to-recommendation, dry-run, idempotency, "
    "conflict, shared rollback, and transaction tests passed."
)
