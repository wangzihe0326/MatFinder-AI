import json
import sqlite3
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: write-materials-sqlite.py <database-path>")

    db_path = Path(sys.argv[1])
    materials = json.load(sys.stdin)

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            DROP TABLE IF EXISTS material_tags;
            DROP TABLE IF EXISTS material_uses;
            DROP TABLE IF EXISTS material_sources;
            DROP TABLE IF EXISTS materials;

            CREATE TABLE materials (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              abbr TEXT NOT NULL,
              category TEXT NOT NULL,
              density REAL,
              tg REAL,
              tm REAL,
              maxTemp REAL,
              tensile REAL,
              elongation REAL,
              dielectric REAL,
              recyclable INTEGER NOT NULL CHECK (recyclable IN (0, 1)),
              summary TEXT NOT NULL,
              notes TEXT NOT NULL
            );

            CREATE TABLE material_tags (
              material_id TEXT NOT NULL,
              tag TEXT NOT NULL,
              position INTEGER NOT NULL,
              PRIMARY KEY (material_id, position),
              FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
            );

            CREATE TABLE material_uses (
              material_id TEXT NOT NULL,
              use TEXT NOT NULL,
              position INTEGER NOT NULL,
              PRIMARY KEY (material_id, position),
              FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
            );

            CREATE TABLE material_sources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              material_id TEXT NOT NULL,
              source_title TEXT NOT NULL,
              source_url TEXT NOT NULL,
              source_type TEXT NOT NULL,
              notes TEXT NOT NULL,
              FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
            );
            """
        )

        for item in materials:
            connection.execute(
                """
                INSERT INTO materials (
                  id, name, abbr, category, density, tg, tm, maxTemp, tensile,
                  elongation, dielectric, recyclable, summary, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["name"],
                    item["abbr"],
                    item["category"],
                    item["density"],
                    item.get("tg"),
                    item.get("tm"),
                    item["maxTemp"],
                    item["tensile"],
                    item["elongation"],
                    item["dielectric"],
                    1 if item["recyclable"] else 0,
                    item["summary"],
                    item["notes"],
                ),
            )

            connection.executemany(
                "INSERT INTO material_tags (material_id, tag, position) VALUES (?, ?, ?)",
                [(item["id"], tag, index) for index, tag in enumerate(item.get("tags", []))],
            )
            connection.executemany(
                "INSERT INTO material_uses (material_id, use, position) VALUES (?, ?, ?)",
                [(item["id"], use, index) for index, use in enumerate(item.get("uses", []))],
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
                        item["id"],
                        source["source_title"],
                        source["source_url"],
                        source["source_type"],
                        source["notes"],
                    )
                    for source in item.get("sources", default_sources(item["id"]))
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


if __name__ == "__main__":
    main()
