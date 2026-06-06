import json
import sqlite3
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: write-materials-sqlite.py <database-path>")

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
              abbreviation TEXT NOT NULL,
              category TEXT NOT NULL,
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
              continuous_use_temperature REAL,
              thermal_conductivity REAL,
              dielectric_constant REAL,
              chemical_resistance TEXT,
              water_absorption REAL,
              flammability TEXT,
              recyclability TEXT,
              cost_level TEXT,
              processing_methods TEXT NOT NULL,
              typical_applications TEXT NOT NULL,
              advantages TEXT NOT NULL,
              disadvantages TEXT NOT NULL,
              summary TEXT NOT NULL,
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
                  material_id, name, abbreviation, category, family, manufacturer,
                  trade_name, density, tensile_strength, flexural_strength,
                  impact_strength, hardness, elongation, glass_transition_temperature,
                  melting_temperature, continuous_use_temperature, thermal_conductivity,
                  dielectric_constant, chemical_resistance, water_absorption,
                  flammability, recyclability, cost_level, processing_methods,
                  typical_applications, advantages, disadvantages, summary, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    material_id(item),
                    item["name"],
                    item.get("abbreviation", item.get("abbr")),
                    item["category"],
                    item.get("family"),
                    item.get("manufacturer"),
                    item.get("trade_name"),
                    item.get("density"),
                    item.get("tensile_strength", item.get("tensile")),
                    item.get("flexural_strength"),
                    item.get("impact_strength"),
                    item.get("hardness"),
                    item.get("elongation"),
                    item.get("glass_transition_temperature", item.get("tg")),
                    item.get("melting_temperature", item.get("tm")),
                    item.get("continuous_use_temperature", item.get("maxTemp")),
                    item.get("thermal_conductivity"),
                    item.get("dielectric_constant", item.get("dielectric")),
                    item.get("chemical_resistance"),
                    item.get("water_absorption"),
                    item.get("flammability"),
                    item.get("recyclability", legacy_recyclability(item)),
                    item.get("cost_level"),
                    json.dumps(list_value(item, "processing_methods"), ensure_ascii=False),
                    json.dumps(list_value(item, "typical_applications", "uses"), ensure_ascii=False),
                    json.dumps(list_value(item, "advantages"), ensure_ascii=False),
                    json.dumps(list_value(item, "disadvantages"), ensure_ascii=False),
                    item["summary"],
                    item["notes"],
                ),
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


if __name__ == "__main__":
    main()
