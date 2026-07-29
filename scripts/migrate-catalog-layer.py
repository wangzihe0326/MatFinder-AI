import json
import sqlite3
import sys
from pathlib import Path

from material_import_schema import ensure_import_schema


def main():
    database_path = Path(sys.argv[1] if len(sys.argv) > 1 else "matfinder.db")
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        ensure_import_schema(connection)
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Database integrity check failed: {integrity}")
        counts = dict(
            connection.execute(
                "SELECT record_origin, COUNT(*) FROM materials GROUP BY record_origin"
            )
        )
        report = {
            "database": str(database_path.resolve()),
            "materials": connection.execute("SELECT COUNT(*) FROM materials").fetchone()[0],
            "recordOrigins": counts,
            "commercialGrades": connection.execute(
                "SELECT COUNT(*) FROM materials WHERE record_type = 'commercial_grade'"
            ).fetchone()[0],
            "legacyRecords": connection.execute(
                "SELECT COUNT(*) FROM materials WHERE record_type = 'legacy'"
            ).fetchone()[0],
            "adminOnly": connection.execute(
                "SELECT COUNT(*) FROM materials WHERE catalog_visibility = 'admin_only'"
            ).fetchone()[0],
            "outOfScope": connection.execute(
                "SELECT COUNT(*) FROM materials WHERE scope_status = 'out_of_scope'"
            ).fetchone()[0],
            "integrityCheck": integrity,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
