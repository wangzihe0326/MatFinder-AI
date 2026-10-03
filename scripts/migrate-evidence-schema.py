import json
import sqlite3
import sys
from pathlib import Path
from contextlib import closing
from material_import_schema import preflight_database, require_formal_schema


PROPERTY_COLUMNS = [
    ("density", "density", "g/cm3", False),
    ("tensile_strength", "tensile_strength", "MPa", False),
    ("flexural_strength", "flexural_strength", "MPa", False),
    ("impact_strength", "impact_strength", None, True),
    ("elongation", "elongation", "%", False),
    ("glass_transition_temperature", "glass_transition_temperature", "degC", False),
    ("melting_temperature", "melting_temperature", "degC", False),
    ("hdt", None, "degC", False),
    ("continuous_use_temperature", "continuous_use_temperature", "degC", False),
    ("thermal_conductivity", "thermal_conductivity", "W/mK", False),
    ("dielectric_constant", "dielectric_constant", "1", False),
    ("water_absorption", "water_absorption", "%", False),
    ("flame_rating", "flame_rating", None, True),
    ("chemical_resistance", "chemical_resistance", None, True),
    ("transparency", "transparency", None, True),
    ("flexibility", "flexibility", None, True),
]

GENERATED_SOURCE_TYPES = {
    "generated",
    "generated_reference_catalog",
    "generated_commercial_catalog",
    "internal_seed",
}

SOURCE_TYPE_MAP = {
    "manufacturer_manual": "official_datasheet",
    "manufacturer_datasheet": "official_datasheet",
    "tds": "official_datasheet",
    "academic_paper": "academic",
    "journal": "academic",
    "reference_database": "secondary_reference",
    "technical_reference": "secondary_reference",
}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: migrate-evidence-schema.py <database-path>")

    database_path = Path(sys.argv[1]).resolve()
    preflight_database(database_path)
    with closing(sqlite3.connect(database_path.as_uri() + "?mode=rw", uri=True)) as connection, connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        require_formal_schema(connection)
        connection.execute("BEGIN IMMEDIATE")
        require_formal_schema(connection)

        existing = connection.execute(
            "SELECT COUNT(*) FROM material_property_evidence"
        ).fetchone()[0]
        if existing:
            print(json.dumps({
                "database": str(database_path),
                "status": "already_populated",
                "property_evidence_rows": existing,
            }))
            return

        source_rows = connection.execute(
            "SELECT * FROM material_sources ORDER BY material_id, id"
        ).fetchall()
        sources_by_material = {}
        for row in source_rows:
            sources_by_material.setdefault(row["material_id"], []).append(row)

        material_count = 0
        property_count = 0
        identity_count = 0

        for material in connection.execute("SELECT * FROM materials ORDER BY material_id"):
            material_count += 1
            material_id = material["material_id"]
            sources = sources_by_material.get(material_id, [])
            generated = any(is_generated_source(row) for row in sources)
            manufacturer = None if generated else clean_identity(material["manufacturer"])
            commercial_grade = None if generated else clean_identity(material["grade_name"])
            material_family = clean_text(material["material_family"] or material["family"])
            identity_confirmed = bool(manufacturer and commercial_grade)
            status = "quarantined" if generated or not identity_confirmed else "unverified"
            confidence = "quarantined" if status == "quarantined" else "low"

            evidence_sources = sources or [None]
            for source in evidence_sources:
                source_type = normalize_source_type(source["source_type"] if source else None)
                if generated:
                    source_type = "generated"
                connection.execute(
                    """
                    INSERT INTO material_evidence (
                      material_id, manufacturer, brand, commercial_grade, material_family,
                      source_type, source_title, source_url, source_date,
                      verification_status, confidence_level, last_verified_at, notes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)
                    """,
                    (
                        material_id,
                        manufacturer,
                        None,
                        commercial_grade,
                        material_family,
                        source_type,
                        clean_text(source["source_title"]) if source else None,
                        clean_http_url(source["source_url"]) if source else None,
                        status,
                        confidence,
                        clean_text(source["notes"]) if source else None,
                    ),
                )
                identity_count += 1

            for position, (property_key, column, unit, text_allowed) in enumerate(PROPERTY_COLUMNS):
                raw_value = material[column] if column else None
                numeric_value = to_number(raw_value)
                text_value = None
                if numeric_value is None and text_allowed:
                    text_value = clean_text(raw_value)
                connection.execute(
                    """
                    INSERT INTO material_property_evidence (
                      material_id, property_key, position, value_numeric, value_text, unit,
                      test_standard, test_condition, value_type, manufacturer, brand,
                      commercial_grade, material_family, source_type, source_title,
                      source_url, source_date, verification_status, confidence_level,
                      last_verified_at
                    )
                    VALUES (?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, 'unknown',
                            NULL, NULL, NULL, ?, ?, NULL)
                    """,
                    (
                        material_id,
                        property_key,
                        numeric_value,
                        text_value,
                        unit,
                        "estimated" if generated else "unknown",
                        manufacturer,
                        commercial_grade,
                        material_family,
                        status,
                        confidence,
                    ),
                )
                property_count += 1

        connection.commit()

    print(json.dumps({
        "database": str(database_path),
        "status": "migrated",
        "materials": material_count,
        "material_evidence_rows": identity_count,
        "property_evidence_rows": property_count,
        "certification_rows": 0,
    }))


def normalize_source_type(value):
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in GENERATED_SOURCE_TYPES:
        return "generated"
    mapped = SOURCE_TYPE_MAP.get(normalized, normalized)
    allowed = {
        "manufacturer",
        "official_datasheet",
        "academic",
        "distributor",
        "secondary_reference",
        "generated",
        "unknown",
    }
    return mapped if mapped in allowed else "unknown"


def is_generated_source(row):
    source_type = str(row["source_type"] or "").strip().lower()
    source_url = str(row["source_url"] or "").strip().lower()
    return source_type in GENERATED_SOURCE_TYPES or source_url.startswith("local:scripts/")


def clean_identity(value):
    text = clean_text(value)
    if not text:
        return None
    lowered = text.lower()
    if any(marker in lowered for marker in (
        "generic", "multiple suppliers", "screening grade", "not specified", "unknown"
    )):
        return None
    return text


def clean_http_url(value):
    text = clean_text(value)
    if not text or not (text.startswith("http://") or text.startswith("https://")):
        return None
    return text


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def to_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
