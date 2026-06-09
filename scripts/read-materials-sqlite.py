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
        columns = table_columns(connection, "materials")
        rows = connection.execute("SELECT * FROM materials ORDER BY rowid").fetchall()

        materials = []
        for row in rows:
            material_id = get(row, columns, "material_id", "id")
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
            sources = [
                {
                    "source_title": item["source_title"],
                    "source_url": item["source_url"],
                    "source_type": item["source_type"],
                    "notes": item["notes"],
                }
                for item in connection.execute(
                    """
                    SELECT source_title, source_url, source_type, notes
                    FROM material_sources
                    WHERE material_id = ?
                    ORDER BY id
                    """,
                    (material_id,),
                )
            ]
            materials.append(
                {
                    "id": get(row, columns, "material_id", "id"),
                    "material_id": get(row, columns, "material_id", "id"),
                    "name": row["name"],
                    "name_en": get(row, columns, "name_en") or row["name"],
                    "name_zh": get(row, columns, "name_zh") or row["name"],
                    "abbr": get(row, columns, "abbreviation", "abbr"),
                    "abbreviation": get(row, columns, "abbreviation", "abbr"),
                    "category": row["category"],
                    "category_en": get(row, columns, "category_en") or row["category"],
                    "category_zh": get(row, columns, "category_zh") or row["category"],
                    "family": get(row, columns, "family"),
                    "manufacturer": get(row, columns, "manufacturer"),
                    "trade_name": get(row, columns, "trade_name"),
                    "density": row["density"],
                    "tensile_strength": get(row, columns, "tensile_strength", "tensile"),
                    "flexural_strength": get(row, columns, "flexural_strength"),
                    "impact_strength": get(row, columns, "impact_strength"),
                    "hardness": get(row, columns, "hardness"),
                    "tg": get(row, columns, "glass_transition_temperature", "tg"),
                    "glass_transition_temperature": get(row, columns, "glass_transition_temperature", "tg"),
                    "tm": get(row, columns, "melting_temperature", "tm"),
                    "melting_temperature": get(row, columns, "melting_temperature", "tm"),
                    "maxTemp": get(row, columns, "continuous_use_temperature", "maxTemp"),
                    "continuous_use_temperature": get(row, columns, "continuous_use_temperature", "maxTemp"),
                    "tensile": get(row, columns, "tensile_strength", "tensile"),
                    "elongation": row["elongation"],
                    "thermal_conductivity": get(row, columns, "thermal_conductivity"),
                    "dielectric": get(row, columns, "dielectric_constant", "dielectric"),
                    "dielectric_constant": get(row, columns, "dielectric_constant", "dielectric"),
                    "chemical_resistance": get(row, columns, "chemical_resistance"),
                    "water_absorption": get(row, columns, "water_absorption"),
                    "flammability": get(row, columns, "flammability"),
                    "recyclability": get(row, columns, "recyclability") or ("recyclable" if get(row, columns, "recyclable") else "not typically recyclable"),
                    "recyclable": bool(get(row, columns, "recyclable")) if "recyclable" in columns else is_recyclable(get(row, columns, "recyclability")),
                    "cost_level": get(row, columns, "cost_level"),
                    "processing_methods": json_list(get(row, columns, "processing_methods")),
                    "typical_applications": json_list(get(row, columns, "typical_applications")),
                    "applications": json_list(get(row, columns, "applications")),
                    "applications_en": json_list(get(row, columns, "applications_en", "applications")),
                    "applications_zh": json_list(get(row, columns, "applications_zh", "applications")),
                    "limitations": json_list(get(row, columns, "limitations")),
                    "alternatives": json_list(get(row, columns, "alternatives")),
                    "source_note": get(row, columns, "source_note"),
                    "advantages": json_list(get(row, columns, "advantages")),
                    "disadvantages": json_list(get(row, columns, "disadvantages")),
                    "tags": tags,
                    "tags_en": json_list(get(row, columns, "tags_en")) or tags,
                    "tags_zh": json_list(get(row, columns, "tags_zh")) or tags,
                    "uses": uses,
                    "sources": sources,
                    "summary": row["summary"],
                    "description": row["summary"],
                    "description_en": get(row, columns, "description_en") or row["summary"],
                    "description_zh": get(row, columns, "description_zh") or row["summary"],
                    "translation_status": get(row, columns, "translation_status") or "partial",
                    "notes": row["notes"],
                }
            )

    print(json.dumps(materials, ensure_ascii=False))


def table_columns(connection, table_name):
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})")}


def get(row, columns, primary, fallback=None):
    if primary in columns:
        return row[primary]
    if fallback and fallback in columns:
        return row[fallback]
    return None


def json_list(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else [str(parsed)]
    except Exception:
        return [str(value)]


def is_recyclable(value):
    text = str(value or "").lower()
    if not text or "not " in text or "non-recycl" in text:
        return False
    return "recyclable" in text or "recycling" in text


if __name__ == "__main__":
    main()
