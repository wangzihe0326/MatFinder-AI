import argparse
import json
import sqlite3
from pathlib import Path


REDUNDANT_INDEXES = (
    "idx_property_evidence_material_property",
    "idx_property_evidence_context",
    "idx_property_evidence_conflict",
    "idx_material_certifications_material",
)
COUNTED_TABLES = (
    "materials",
    "material_evidence",
    "material_property_evidence",
    "material_certifications",
    "material_sources",
    "material_tags",
    "material_uses",
    "import_batches",
    "evidence_sources",
    "real_material_identities",
    "import_entity_links",
)


def counts(connection):
    return {
        table: connection.execute(
            f"SELECT COUNT(*) FROM {table}"
        ).fetchone()[0]
        for table in COUNTED_TABLES
    }


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Losslessly drop indexes covered by stronger indexes, compact free "
            "pages, and verify every table count."
        )
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "matfinder.db",
    )
    args = parser.parse_args()
    database = args.database.resolve()
    size_before = database.stat().st_size
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        before = counts(connection)
        indexes_before = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )
        }
        dropped = [
            index for index in REDUNDANT_INDEXES if index in indexes_before
        ]
        for index in dropped:
            connection.execute(f'DROP INDEX "{index}"')
        connection.commit()
        connection.execute("VACUUM")
        connection.execute("PRAGMA optimize")
        after = counts(connection)
        integrity = connection.execute(
            "PRAGMA integrity_check"
        ).fetchone()[0]
        foreign_key_issues = connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchall()
        if before != after:
            raise RuntimeError(
                "Table counts changed during index optimization."
            )
        if integrity != "ok" or foreign_key_issues:
            raise RuntimeError(
                "Database integrity failed after index optimization."
            )
    finally:
        connection.close()
    print(
        json.dumps(
            {
                "database": str(database),
                "droppedIndexes": dropped,
                "sizeBeforeBytes": size_before,
                "sizeAfterBytes": database.stat().st_size,
                "tableCountsUnchanged": True,
                "integrityCheck": "ok",
                "foreignKeyIssueCount": 0,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
