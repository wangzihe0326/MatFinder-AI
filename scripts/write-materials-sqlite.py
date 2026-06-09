import json
import sqlite3
import sys
from pathlib import Path


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
              source_note TEXT NOT NULL,
              typical_applications TEXT NOT NULL,
              advantages TEXT NOT NULL,
              disadvantages TEXT NOT NULL,
              tags_en TEXT NOT NULL,
              tags_zh TEXT NOT NULL,
              summary TEXT NOT NULL,
              description_en TEXT NOT NULL,
              description_zh TEXT NOT NULL,
              translation_status TEXT NOT NULL,
              notes TEXT NOT NULL
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
            """
        )

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
                  translation_status
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
                  :translation_status
                )
                """,
                {
                    "material_id": material_id(item),
                    "name": item["name"],
                    "name_en": item.get("name_en", item["name"]),
                    "name_zh": item.get("name_zh", item["name"]),
                    "abbreviation": item.get("abbreviation", item.get("abbr")),
                    "material_family": item.get("material_family", item.get("family")),
                    "grade_name": item.get("grade_name", item.get("trade_name", "Generic")),
                    "supplier_or_brand": item.get("supplier_or_brand", item.get("manufacturer", "Generic / multiple suppliers")),
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
                    "source_note": item.get("source_note", source_note(item)),
                    "typical_applications": json.dumps(list_value(item, "typical_applications", "uses"), ensure_ascii=False),
                    "advantages": json.dumps(list_value(item, "advantages"), ensure_ascii=False),
                    "disadvantages": json.dumps(list_value(item, "disadvantages"), ensure_ascii=False),
                    "summary": item["summary"],
                    "notes": item["notes"],
                    "tags_en": json.dumps(list_value(item, "tags_en", "tags"), ensure_ascii=False),
                    "tags_zh": json.dumps(list_value(item, "tags_zh", "tags"), ensure_ascii=False),
                    "description_en": item.get("description_en", item.get("description", item["summary"])),
                    "description_zh": item.get("description_zh", item.get("description", item["summary"])),
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
                    for source in item.get("sources", default_sources(material_id(item)))
                ],
            )

        connection.commit()

    print(json.dumps({"database": str(db_path), "materials": len(materials)}))


def default_sources(material_id):
    return [
        {
            "source_title": "MatFinder seed dataset",
            "source_url": "local:data/materials.js",
            "source_type": "internal_seed",
            "notes": f"Original MatFinder seed record for {material_id}; grade-specific values should be verified before engineering use.",
        }
    ]


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


def source_note(item):
    if item.get("source_note"):
        return item["source_note"]
    sources = item.get("sources") or default_sources(material_id(item))
    titles = [source.get("source_title") for source in sources if source.get("source_title")]
    if not titles:
        return "MatFinder local material database; verify grade-specific datasheets before engineering use."
    return "Representative MatFinder record based on: " + "; ".join(titles[:3]) + "."


if __name__ == "__main__":
    main()
