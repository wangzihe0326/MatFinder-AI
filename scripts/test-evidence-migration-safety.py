import sqlite3
import io
import gc
import runpy
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from migrate import bootstrap_database, load_contract


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "scripts" / "migrate-evidence-schema.py"


def create_legacy_database(path):
    bootstrap_database(path)
    with sqlite3.connect(path) as connection:
        required = {col["name"]: "" for table in load_contract()["structure"]["tables"]
                    if table["name"] == "materials" for col in table["columns"]
                    if col["notNull"] and col["default"] is None}
        fields = ("material_id", "manufacturer", "grade_name", "material_family", "family",
                  "density", "tensile_strength", "continuous_use_temperature")
        for values in [
                (
                    "LEGACY-UNSOURCED",
                    "TEST ONLY - LEGACY MANUFACTURER FIELD",
                    "TEST-LEGACY-GRADE",
                    "PC",
                    "PC",
                    1.2,
                    60,
                    100,
                ),
                (
                    "LEGACY-GENERATED",
                    "TEST ONLY - GENERATED MANUFACTURER FIELD",
                    "TEST-GENERATED-GRADE",
                    "ABS",
                    "ABS",
                    1.05,
                    40,
                    80,
                ),
            ]:
            row = {**required, **dict(zip(fields, values))}
            keys = list(row)
            connection.execute("INSERT INTO materials (" + ",".join(keys) + ") VALUES (" +
                               ",".join("?" for _ in keys) + ")", [row[key] for key in keys])
        connection.execute(
            """
            INSERT INTO material_sources (
              material_id, source_type, source_title, source_url, notes
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                "LEGACY-GENERATED",
                "generated_commercial_catalog",
                "TEST ONLY - GENERATED CATALOG",
                "local:scripts/generated-test-fixture",
                "Test fixture; not a real source.",
            ),
        )


with tempfile.TemporaryDirectory() as directory:
    database = Path(directory) / "legacy.db"
    create_legacy_database(database)
    original_argv = sys.argv
    try:
        sys.argv = [str(MIGRATION), str(database)]
        with redirect_stdout(io.StringIO()):
            runpy.run_path(str(MIGRATION), run_name="__main__")
    finally:
        sys.argv = original_argv
        gc.collect()

    connection = sqlite3.connect(database)
    try:
        connection.row_factory = sqlite3.Row
        identity_rows = connection.execute(
            "SELECT * FROM material_evidence ORDER BY material_id"
        ).fetchall()
        property_rows = connection.execute(
            "SELECT * FROM material_property_evidence ORDER BY material_id, property_key"
        ).fetchall()

        assert identity_rows, "Migration should create conservative identity evidence."
        assert property_rows, "Migration should create conservative property evidence."
        assert not any(
            row["confidence_level"] in {"high", "medium"}
            or row["verification_status"] in {"verified", "partially_verified"}
            for row in [*identity_rows, *property_rows]
        ), "Moving legacy fields into evidence tables must never upgrade confidence."

        generated_identity = next(
            row for row in identity_rows if row["material_id"] == "LEGACY-GENERATED"
        )
        assert generated_identity["source_type"] == "generated"
        assert generated_identity["verification_status"] == "quarantined"
        assert generated_identity["confidence_level"] == "quarantined"
        assert generated_identity["manufacturer"] is None
        assert generated_identity["commercial_grade"] is None
        assert generated_identity["source_url"] is None

        unsourced_claims = [
            row
            for row in property_rows
            if row["material_id"] == "LEGACY-UNSOURCED"
        ]
        assert all(row["source_url"] is None for row in unsourced_claims)
        assert all(row["source_title"] is None for row in unsourced_claims)
        assert all(row["test_standard"] is None for row in unsourced_claims)
        assert all(row["test_condition"] is None for row in unsourced_claims)
        assert all(row["confidence_level"] == "low" for row in unsourced_claims)
        assert connection.execute(
            "SELECT COUNT(*) FROM material_certifications"
        ).fetchone()[0] == 0
    finally:
        connection.close()

print("Evidence migration safety tests passed.")
