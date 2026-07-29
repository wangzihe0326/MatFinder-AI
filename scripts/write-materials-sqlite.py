import json
import sqlite3
import sys
from pathlib import Path

from material_import_schema import ensure_import_schema

from material_import_schema import ensure_import_schema


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: write-materials-sqlite.py <database-path>")

    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    db_path = Path(sys.argv[1])
    materials = clean_value(json.load(sys.stdin))

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            DROP TABLE IF EXISTS material_tags;
            DROP TABLE IF EXISTS material_uses;
            DROP TABLE IF EXISTS material_certifications;
            DROP TABLE IF EXISTS material_property_evidence;
            DROP TABLE IF EXISTS material_evidence;
            DROP TABLE IF EXISTS material_sources;
            DROP TABLE IF EXISTS materials;

            CREATE TABLE materials (
              material_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              name_en TEXT NOT NULL,
              name_zh TEXT NOT NULL,
              abbreviation TEXT NOT NULL,
              material_family TEXT,
              grade_name TEXT,
              supplier_or_brand TEXT,
              category TEXT NOT NULL,
              category_en TEXT NOT NULL,
              category_zh TEXT NOT NULL,
              subcategory TEXT,
              state TEXT,
              family TEXT,
              manufacturer TEXT,
              trade_name TEXT,
              density REAL,
              tensile_strength REAL,
              flexural_strength REAL,
              impact_strength REAL,
              hardness TEXT,
              elongation REAL,
              glass_transition_temperature REAL,
              melting_temperature REAL,
              max_temperature REAL,
              continuous_use_temperature REAL,
              thermal_conductivity REAL,
              dielectric_constant REAL,
              flame_rating TEXT,
              electrical_insulation TEXT,
              chemical_resistance TEXT,
              transparency TEXT,
              flexibility TEXT,
              waterproof_sealing TEXT,
              water_absorption REAL,
              flammability TEXT,
              recyclability TEXT,
              cost_level TEXT,
              processing_methods TEXT NOT NULL,
              applications TEXT NOT NULL,
              applications_en TEXT NOT NULL,
              applications_zh TEXT NOT NULL,
              limitations TEXT NOT NULL,
              alternatives TEXT NOT NULL,
              source_note TEXT,
              typical_applications TEXT NOT NULL,
              advantages TEXT NOT NULL,
              disadvantages TEXT NOT NULL,
              tags_en TEXT NOT NULL,
              tags_zh TEXT NOT NULL,
              summary TEXT NOT NULL,
              description_en TEXT NOT NULL,
              description_zh TEXT NOT NULL,
              translation_quality TEXT NOT NULL,
              translation_status TEXT NOT NULL,
              notes TEXT NOT NULL,
              record_type TEXT NOT NULL DEFAULT 'legacy'
                CHECK (record_type IN ('legacy', 'commercial_grade')),
              record_origin TEXT NOT NULL DEFAULT 'legacy'
                CHECK (record_origin IN ('legacy', 'generated', 'imported')),
              scope_status TEXT NOT NULL DEFAULT 'in_scope'
                CHECK (scope_status IN ('in_scope', 'out_of_scope')),
              catalog_visibility TEXT NOT NULL DEFAULT 'admin_only'
                CHECK (catalog_visibility IN ('public', 'review', 'admin_only'))
            );

            CREATE TABLE material_tags (
              material_id TEXT NOT NULL,
              tag TEXT NOT NULL,
              position INTEGER NOT NULL,
              PRIMARY KEY (material_id, position),
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE
            );

            CREATE TABLE material_uses (
              material_id TEXT NOT NULL,
              use TEXT NOT NULL,
              position INTEGER NOT NULL,
              PRIMARY KEY (material_id, position),
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE
            );

            CREATE TABLE material_sources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              material_id TEXT NOT NULL,
              source_title TEXT NOT NULL,
              source_url TEXT NOT NULL,
              source_type TEXT NOT NULL,
              notes TEXT NOT NULL,
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE
            );

            CREATE TABLE material_evidence (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              material_id TEXT NOT NULL,
              manufacturer TEXT,
              brand TEXT,
              commercial_grade TEXT,
              material_family TEXT,
              source_type TEXT NOT NULL,
              source_title TEXT,
              source_url TEXT,
              source_date TEXT,
              verification_status TEXT NOT NULL,
              confidence_level TEXT NOT NULL,
              last_verified_at TEXT,
              notes TEXT,
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE,
              CHECK (source_type IN ('manufacturer', 'official_datasheet', 'academic', 'distributor', 'secondary_reference', 'generated', 'unknown')),
              CHECK (verification_status IN ('verified', 'partially_verified', 'unverified', 'quarantined')),
              CHECK (confidence_level IN ('high', 'medium', 'low', 'quarantined'))
            );

            CREATE TABLE material_property_evidence (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              material_id TEXT NOT NULL,
              property_key TEXT NOT NULL,
              position INTEGER NOT NULL,
              value_numeric REAL,
              value_text TEXT,
              unit TEXT,
              test_standard TEXT,
              test_condition TEXT,
              value_type TEXT NOT NULL,
              manufacturer TEXT,
              brand TEXT,
              commercial_grade TEXT,
              material_family TEXT,
              source_type TEXT NOT NULL,
              source_title TEXT,
              source_url TEXT,
              source_date TEXT,
              verification_status TEXT NOT NULL,
              confidence_level TEXT NOT NULL,
              last_verified_at TEXT,
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE,
              UNIQUE (material_id, property_key, position),
              CHECK (value_type IN ('typical', 'minimum', 'maximum', 'estimated', 'unknown')),
              CHECK (source_type IN ('manufacturer', 'official_datasheet', 'academic', 'distributor', 'secondary_reference', 'generated', 'unknown')),
              CHECK (verification_status IN ('verified', 'partially_verified', 'unverified', 'quarantined')),
              CHECK (confidence_level IN ('high', 'medium', 'low', 'quarantined'))
            );

            CREATE TABLE material_certifications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              material_id TEXT NOT NULL,
              certification_name TEXT,
              certification_status TEXT NOT NULL,
              scope TEXT,
              source_type TEXT NOT NULL,
              source_title TEXT,
              source_url TEXT,
              source_date TEXT,
              verification_status TEXT NOT NULL,
              confidence_level TEXT NOT NULL,
              last_verified_at TEXT,
              FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE,
              CHECK (source_type IN ('manufacturer', 'official_datasheet', 'academic', 'distributor', 'secondary_reference', 'generated', 'unknown')),
              CHECK (verification_status IN ('verified', 'partially_verified', 'unverified', 'quarantined')),
              CHECK (confidence_level IN ('high', 'medium', 'low', 'quarantined'))
            );

            CREATE INDEX idx_material_evidence_material ON material_evidence(material_id);
            """
        )
        ensure_import_schema(connection)
        ensure_import_schema(connection)

        for item in materials:
            connection.execute(
                """
                INSERT INTO materials (
                  material_id, name, name_en, name_zh, abbreviation,
                  material_family, grade_name, supplier_or_brand, category,
                  category_en, category_zh, subcategory, state, family,
                  manufacturer, trade_name, density, tensile_strength, flexural_strength,
                  impact_strength, hardness, elongation, glass_transition_temperature,
                  melting_temperature, max_temperature, continuous_use_temperature,
                  thermal_conductivity, dielectric_constant, flame_rating,
                  electrical_insulation, chemical_resistance, transparency,
                  flexibility, waterproof_sealing, water_absorption,
                  flammability, recyclability, cost_level, processing_methods,
                  applications, applications_en, applications_zh,
                  limitations, alternatives, source_note,
                  typical_applications, advantages, disadvantages, summary, notes,
                  tags_en, tags_zh, description_en, description_zh,
                  translation_quality, translation_status
                )
                VALUES (
                  :material_id, :name, :name_en, :name_zh, :abbreviation,
                  :material_family, :grade_name, :supplier_or_brand, :category,
                  :category_en, :category_zh, :subcategory, :state, :family,
                  :manufacturer, :trade_name, :density, :tensile_strength,
                  :flexural_strength, :impact_strength, :hardness, :elongation,
                  :glass_transition_temperature, :melting_temperature,
                  :max_temperature, :continuous_use_temperature,
                  :thermal_conductivity, :dielectric_constant, :flame_rating,
                  :electrical_insulation, :chemical_resistance, :transparency,
                  :flexibility, :waterproof_sealing, :water_absorption,
                  :flammability, :recyclability, :cost_level, :processing_methods,
                  :applications, :applications_en, :applications_zh,
                  :limitations, :alternatives, :source_note,
                  :typical_applications, :advantages, :disadvantages, :summary,
                  :notes, :tags_en, :tags_zh, :description_en, :description_zh,
                  :translation_quality, :translation_status
                )
                """,
                {
                    "material_id": material_id(item),
                    "name": item["name"],
                    "name_en": item.get("name_en", item["name"]),
                    "name_zh": item.get("name_zh", item["name"]),
                    "abbreviation": item.get("abbreviation", item.get("abbr")),
                    "material_family": item.get("material_family", item.get("family")),
                    "grade_name": item.get("grade_name", item.get("trade_name")),
                    "supplier_or_brand": item.get("supplier_or_brand", item.get("manufacturer")),
                    "category": item["category"],
                    "category_en": item.get("category_en", item["category"]),
                    "category_zh": item.get("category_zh", item["category"]),
                    "subcategory": item.get("subcategory"),
                    "state": item.get("state"),
                    "family": item.get("family"),
                    "manufacturer": item.get("manufacturer"),
                    "trade_name": item.get("trade_name"),
                    "density": item.get("density"),
                    "tensile_strength": item.get("tensile_strength", item.get("tensile")),
                    "flexural_strength": item.get("flexural_strength"),
                    "impact_strength": item.get("impact_strength"),
                    "hardness": item.get("hardness"),
                    "elongation": item.get("elongation"),
                    "glass_transition_temperature": item.get("glass_transition_temperature", item.get("tg")),
                    "melting_temperature": item.get("melting_temperature", item.get("tm")),
                    "max_temperature": item.get("max_temperature", item.get("continuous_use_temperature", item.get("maxTemp"))),
                    "continuous_use_temperature": item.get("continuous_use_temperature", item.get("maxTemp")),
                    "thermal_conductivity": item.get("thermal_conductivity"),
                    "dielectric_constant": item.get("dielectric_constant", item.get("dielectric")),
                    "flame_rating": item.get("flame_rating", item.get("flammability")),
                    "electrical_insulation": item.get("electrical_insulation"),
                    "chemical_resistance": item.get("chemical_resistance"),
                    "transparency": item.get("transparency"),
                    "flexibility": item.get("flexibility"),
                    "waterproof_sealing": item.get("waterproof_sealing"),
                    "water_absorption": item.get("water_absorption"),
                    "flammability": item.get("flammability"),
                    "recyclability": item.get("recyclability", legacy_recyclability(item)),
                    "cost_level": item.get("cost_level"),
                    "processing_methods": json.dumps(list_value(item, "processing_methods"), ensure_ascii=False),
                    "applications": json.dumps(list_value(item, "applications", "typical_applications"), ensure_ascii=False),
                    "applications_en": json.dumps(list_value(item, "applications_en", "applications"), ensure_ascii=False),
                    "applications_zh": json.dumps(list_value(item, "applications_zh", "applications"), ensure_ascii=False),
                    "limitations": json.dumps(list_value(item, "limitations", "disadvantages"), ensure_ascii=False),
                    "alternatives": json.dumps(list_value(item, "alternatives"), ensure_ascii=False),
                    "source_note": item.get("source_note"),
                    "typical_applications": json.dumps(list_value(item, "typical_applications", "uses"), ensure_ascii=False),
                    "advantages": json.dumps(list_value(item, "advantages"), ensure_ascii=False),
                    "disadvantages": json.dumps(list_value(item, "disadvantages"), ensure_ascii=False),
                    "summary": item["summary"],
                    "notes": item["notes"],
                    "tags_en": json.dumps(list_value(item, "tags_en", "tags"), ensure_ascii=False),
                    "tags_zh": json.dumps(list_value(item, "tags_zh", "tags"), ensure_ascii=False),
                    "description_en": item.get("description_en", item.get("description", item["summary"])),
                    "description_zh": item.get("description_zh", item.get("description", item["summary"])),
                    "translation_quality": item.get("translation_quality", item.get("translation_status", "partial")),
                    "translation_status": item.get("translation_status", "partial"),
                },
            )

            connection.executemany(
                "INSERT INTO material_tags (material_id, tag, position) VALUES (?, ?, ?)",
                [(material_id(item), tag, index) for index, tag in enumerate(item.get("tags", []))],
            )
            connection.executemany(
                "INSERT INTO material_uses (material_id, use, position) VALUES (?, ?, ?)",
                [(material_id(item), use, index) for index, use in enumerate(list_value(item, "typical_applications", "uses"))],
            )
            connection.executemany(
                """
                INSERT INTO material_sources (
                  material_id, source_title, source_url, source_type, notes
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        material_id(item),
                        source["source_title"],
                        source["source_url"],
                        source["source_type"],
                        source["notes"],
                    )
                    for source in item.get("sources", [])
                    if source.get("source_title") and source.get("source_url")
                ],
            )

            insert_evidence(connection, item)

        connection.commit()

    print(json.dumps({"database": str(db_path), "materials": len(materials)}))


def insert_evidence(connection, item):
    evidence = item.get("evidence") or {}
    identity = evidence.get("identity") or {}
    identity_sources = identity.get("sources") or [{}]
    material_identifier = material_id(item)

    for source in identity_sources:
        connection.execute(
            """
            INSERT INTO material_evidence (
              material_id, manufacturer, brand, commercial_grade, material_family,
              source_type, source_title, source_url, source_date,
              verification_status, confidence_level, last_verified_at, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material_identifier,
                identity.get("manufacturer"),
                identity.get("brand"),
                identity.get("commercialGrade"),
                identity.get("materialFamily", item.get("material_family")),
                source.get("sourceType", "unknown"),
                source.get("sourceTitle"),
                source.get("sourceUrl"),
                source.get("sourceDate"),
                identity.get("verificationStatus", source.get("verificationStatus", "unverified")),
                identity.get("confidenceLevel", source.get("confidenceLevel", "low")),
                identity.get("lastVerifiedAt", source.get("lastVerifiedAt")),
                source.get("notes"),
            ),
        )

    for property_key, claims in (evidence.get("properties") or {}).items():
        for position, claim in enumerate(claims or []):
            source = claim.get("source") or {}
            value = claim.get("value")
            numeric_value = value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
            text_value = None if numeric_value is not None or value is None else str(value)
            connection.execute(
                """
                INSERT INTO material_property_evidence (
                  material_id, property_key, position, value_numeric, value_text, unit,
                  test_standard, test_condition, value_type, manufacturer, brand,
                  commercial_grade, material_family, source_type, source_title,
                  source_url, source_date, verification_status, confidence_level,
                  last_verified_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    material_identifier,
                    property_key,
                    position,
                    numeric_value,
                    text_value,
                    claim.get("unit"),
                    claim.get("testStandard"),
                    claim.get("testCondition"),
                    claim.get("valueType", "unknown"),
                    source.get("manufacturer", identity.get("manufacturer")),
                    source.get("brand", identity.get("brand")),
                    source.get("commercialGrade", identity.get("commercialGrade")),
                    source.get("materialFamily", identity.get("materialFamily")),
                    source.get("sourceType", "unknown"),
                    source.get("sourceTitle"),
                    source.get("sourceUrl"),
                    source.get("sourceDate"),
                    claim.get("verificationStatus", "unverified"),
                    claim.get("confidenceLevel", "low"),
                    claim.get("lastVerifiedAt"),
                ),
            )

    for certification in evidence.get("certifications") or []:
        connection.execute(
            """
            INSERT INTO material_certifications (
              material_id, certification_name, certification_status, scope,
              source_type, source_title, source_url, source_date,
              verification_status, confidence_level, last_verified_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material_identifier,
                certification.get("certificationName"),
                certification.get("certificationStatus", "unknown"),
                certification.get("scope"),
                certification.get("sourceType", "unknown"),
                certification.get("sourceTitle"),
                certification.get("sourceUrl"),
                certification.get("sourceDate"),
                certification.get("verificationStatus", "unverified"),
                certification.get("confidenceLevel", "low"),
                certification.get("lastVerifiedAt"),
            ),
        )


def clean_value(value):
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_value(item) for key, item in value.items()}
    return value


def material_id(item):
    return item.get("material_id", item.get("id"))


def list_value(item, primary, fallback=None):
    value = item.get(primary)
    if value is None and fallback:
        value = item.get(fallback)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [str(value)]


def legacy_recyclability(item):
    if "recyclable" not in item:
        return None
    return "recyclable" if item["recyclable"] else "not typically recyclable"


if __name__ == "__main__":
    main()
