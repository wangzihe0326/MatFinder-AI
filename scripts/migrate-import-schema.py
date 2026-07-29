import argparse
import json
import sqlite3
from pathlib import Path

from material_import_schema import ensure_import_schema


def main():
    parser = argparse.ArgumentParser(
        description="Add lossless real-material import and evidence-version schema."
    )
    parser.add_argument(
        "database",
        nargs="?",
        default=Path(__file__).resolve().parents[1] / "matfinder.db",
        type=Path,
    )
    args = parser.parse_args()
    database = args.database.resolve()

    connection = sqlite3.connect(database)
    try:
        connection.execute("BEGIN IMMEDIATE")
        ensure_import_schema(connection)
        connection.commit()
        tables = [
            "import_batches",
            "evidence_sources",
            "real_material_identities",
            "import_entity_links",
        ]
        print(
            json.dumps(
                {
                    "database": str(database),
                    "status": "ready",
                    "tables": {
                        table: connection.execute(
                            f"SELECT COUNT(*) FROM {table}"
                        ).fetchone()[0]
                        for table in tables
                    },
                },
                ensure_ascii=False,
            )
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
