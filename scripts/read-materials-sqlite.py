import json
import sqlite3
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: read-materials-sqlite.py <database-path>")

    db_path = Path(sys.argv[1])

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, name, abbr, category, density, tg, tm, maxTemp, tensile,
                   elongation, dielectric, recyclable, summary, notes
            FROM materials
            ORDER BY rowid
            """
        ).fetchall()

        materials = []
        for row in rows:
            material_id = row["id"]
            tags = [
                item["tag"]
                for item in connection.execute(
                    "SELECT tag FROM material_tags WHERE material_id = ? ORDER BY position",
                    (material_id,),
                )
            ]
            uses = [
                item["use"]
                for item in connection.execute(
                    "SELECT use FROM material_uses WHERE material_id = ? ORDER BY position",
                    (material_id,),
                )
            ]
            materials.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "abbr": row["abbr"],
                    "category": row["category"],
                    "density": row["density"],
                    "tg": row["tg"],
                    "tm": row["tm"],
                    "maxTemp": row["maxTemp"],
                    "tensile": row["tensile"],
                    "elongation": row["elongation"],
                    "dielectric": row["dielectric"],
                    "recyclable": bool(row["recyclable"]),
                    "tags": tags,
                    "uses": uses,
                    "summary": row["summary"],
                    "notes": row["notes"],
                }
            )

    print(json.dumps(materials, ensure_ascii=False))


if __name__ == "__main__":
    main()
