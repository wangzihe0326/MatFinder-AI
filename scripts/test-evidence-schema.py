import sqlite3
from pathlib import Path


database_path = Path(__file__).resolve().parents[1] / "matfinder.db"
connection = sqlite3.connect(database_path)

expected_columns = {
    "materials": {
        "record_type", "record_origin", "scope_status", "catalog_visibility",
    },
    "material_evidence": {
        "manufacturer", "brand", "commercial_grade", "material_family",
        "source_type", "source_title", "source_url", "source_date",
        "verification_status", "confidence_level", "last_verified_at",
        "source_id", "evidence_fingerprint", "import_batch_id",
        "imported_at", "evidence_version",
    },
    "material_property_evidence": {
        "property_key", "value_numeric", "value_text", "unit",
        "test_standard", "test_condition", "value_type",
        "manufacturer", "brand", "commercial_grade", "material_family",
        "source_type", "source_title", "source_url", "source_date",
        "verification_status", "confidence_level", "last_verified_at",
        "source_id", "evidence_fingerprint", "import_batch_id",
        "imported_at", "evidence_version", "conflict_group_id",
        "conflict_status",
    },
    "material_certifications": {
        "certification_name", "certification_status", "scope",
        "source_type", "source_title", "source_url", "source_date",
        "verification_status", "confidence_level", "last_verified_at",
        "source_id", "evidence_fingerprint", "import_batch_id",
        "imported_at", "evidence_version",
    },
}

for table, required in expected_columns.items():
    actual = {
        row[1]
        for row in connection.execute(f"PRAGMA table_info({table})")
    }
    missing = required - actual
    assert not missing, f"{table} is missing columns: {sorted(missing)}"

material_count = connection.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
identity_count = connection.execute("SELECT COUNT(*) FROM material_evidence").fetchone()[0]
property_count = connection.execute("SELECT COUNT(*) FROM material_property_evidence").fetchone()[0]

assert identity_count >= material_count
assert property_count >= material_count

required_import_tables = {
    "import_batches",
    "evidence_sources",
    "real_material_identities",
    "import_entity_links",
}
actual_tables = {
    row[0]
    for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
}
assert not (
    required_import_tables - actual_tables
), "Formal import tables are missing."

upgraded_legacy_rows = connection.execute(
    """
    SELECT COUNT(*) FROM (
      SELECT confidence_level, verification_status, import_batch_id
        FROM material_evidence
      UNION ALL
      SELECT confidence_level, verification_status, import_batch_id
        FROM material_property_evidence
    )
    WHERE import_batch_id IS NULL
      AND (
        confidence_level IN ('high', 'medium')
        OR verification_status IN ('verified', 'partially_verified')
      )
    """
).fetchone()[0]
assert (
    upgraded_legacy_rows == 0
), "Legacy migration rows must never be upgraded by schema migration."

connection.close()
print(
    f"Evidence schema tests passed: {material_count} materials, "
    f"{identity_count} identity claims, {property_count} property claims."
)
