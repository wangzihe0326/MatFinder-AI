import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path


EVIDENCE_TABLES = (
    "material_evidence",
    "material_property_evidence",
    "material_certifications",
)


def scalar(connection, sql, parameters=()):
    return connection.execute(sql, parameters).fetchone()[0]


def duplicate_profile(connection, table, columns):
    group_columns = ", ".join(
        f"COALESCE(CAST({column} AS TEXT), '<NULL>')" for column in columns
    )
    rows = connection.execute(
        f"""
        SELECT COUNT(*) AS copies
          FROM {table}
         GROUP BY {group_columns}
        HAVING COUNT(*) > 1
        """
    ).fetchall()
    return {
        "duplicate_groups": len(rows),
        "excess_rows": sum(row[0] - 1 for row in rows),
    }


def index_columns(connection, index_name):
    return [
        row[2]
        for row in connection.execute(
            f"PRAGMA index_info('{index_name}')"
        )
    ]


def index_inventory(connection):
    inventory = []
    for table_row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ):
        table = table_row[0]
        for row in connection.execute(f"PRAGMA index_list('{table}')"):
            inventory.append(
                {
                    "table": table,
                    "name": row[1],
                    "unique": bool(row[2]),
                    "origin": row[3],
                    "partial": bool(row[4]),
                    "columns": index_columns(connection, row[1]),
                }
            )
    return inventory


def redundant_indexes(inventory):
    findings = []
    by_table = defaultdict(list)
    for index in inventory:
        by_table[index["table"]].append(index)
    for table, indexes in by_table.items():
        for candidate in indexes:
            if candidate["origin"] != "c":
                continue
            for covering in indexes:
                if candidate["name"] == covering["name"]:
                    continue
                prefix = covering["columns"][: len(candidate["columns"])]
                if (
                    candidate["columns"]
                    and candidate["columns"] == prefix
                    and not candidate["partial"]
                    and not covering["partial"]
                ):
                    findings.append(
                        {
                            "index": candidate["name"],
                            "covered_by": covering["name"],
                            "reason": (
                                "The candidate columns are a left prefix of "
                                "another non-partial index."
                            ),
                        }
                    )
                    break
    return findings


def query_plan(connection, label, sql, parameters):
    return {
        "label": label,
        "sql": sql,
        "plan": [
            row[3]
            for row in connection.execute(
                f"EXPLAIN QUERY PLAN {sql}", parameters
            )
        ],
    }


def approximate_table_payload(connection, tables):
    payloads = []
    for table in tables:
        columns = [
            row[1]
            for row in connection.execute(f"PRAGMA table_info('{table}')")
        ]
        if not columns:
            continue
        expression = " + ".join(
            f"COALESCE(LENGTH(CAST(\"{column}\" AS BLOB)), 0)"
            for column in columns
        )
        payloads.append(
            {
                "table": table,
                "row_count": scalar(
                    connection, f'SELECT COUNT(*) FROM "{table}"'
                ),
                "approximate_payload_bytes": scalar(
                    connection,
                    f'SELECT COALESCE(SUM({expression}), 0) FROM "{table}"',
                ),
            }
        )
    return sorted(
        payloads,
        key=lambda item: item["approximate_payload_bytes"],
        reverse=True,
    )


def source_text_profile(connection):
    total_bytes = 0
    unique_pairs = set()
    nonempty_rows = 0
    repeated_rows = 0
    pair_counts = defaultdict(int)
    for table in EVIDENCE_TABLES:
        for title, url, source_type in connection.execute(
            f"SELECT source_title, source_url, source_type FROM {table}"
        ):
            title = (title or "").strip()
            url = (url or "").strip()
            source_type = (source_type or "").strip()
            total_bytes += len(title.encode("utf-8"))
            total_bytes += len(url.encode("utf-8"))
            total_bytes += len(source_type.encode("utf-8"))
            if title or url:
                nonempty_rows += 1
                pair = (source_type, title, url)
                pair_counts[pair] += 1
                unique_pairs.add(pair)
    repeated_rows = sum(count - 1 for count in pair_counts.values())
    unique_bytes = sum(
        len(source_type.encode("utf-8"))
        + len(title.encode("utf-8"))
        + len(url.encode("utf-8"))
        for source_type, title, url in unique_pairs
    )
    return {
        "inline_source_text_bytes": total_bytes,
        "rows_with_inline_title_or_url": nonempty_rows,
        "distinct_inline_source_tuples": len(unique_pairs),
        "repeated_inline_source_rows": repeated_rows,
        "estimated_repeated_title_url_bytes": max(total_bytes - unique_bytes, 0),
        "normalized_source_rows": scalar(
            connection,
            "SELECT COUNT(*) FROM evidence_sources",
        )
        if scalar(
            connection,
            """
            SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name = 'evidence_sources'
            """,
        )
        else 0,
    }


def build_report(database):
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        page_size = scalar(connection, "PRAGMA page_size")
        page_count = scalar(connection, "PRAGMA page_count")
        freelist_count = scalar(connection, "PRAGMA freelist_count")
        sizes = []
        dbstat_available = True
        try:
            sizes = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages
                      FROM dbstat
                     GROUP BY name
                     ORDER BY bytes DESC
                    """
                )
            ]
        except sqlite3.OperationalError:
            dbstat_available = False

        tables = [
            row[0]
            for row in connection.execute(
                """
                SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name
                """
            )
        ]
        table_counts = {
            table: scalar(connection, f"SELECT COUNT(*) FROM {table}")
            for table in tables
        }
        inventory = index_inventory(connection)
        duplicate_profiles = {
            "material_evidence": duplicate_profile(
                connection,
                "material_evidence",
                (
                    "material_id",
                    "manufacturer",
                    "brand",
                    "commercial_grade",
                    "material_family",
                    "source_type",
                    "source_title",
                    "source_url",
                    "source_date",
                    "verification_status",
                    "confidence_level",
                    "last_verified_at",
                ),
            ),
            "material_property_evidence": duplicate_profile(
                connection,
                "material_property_evidence",
                (
                    "material_id",
                    "property_key",
                    "value_numeric",
                    "value_text",
                    "unit",
                    "test_standard",
                    "test_condition",
                    "value_type",
                    "source_type",
                    "source_title",
                    "source_url",
                    "source_date",
                    "verification_status",
                    "confidence_level",
                    "last_verified_at",
                ),
            ),
            "material_certifications": duplicate_profile(
                connection,
                "material_certifications",
                (
                    "material_id",
                    "certification_name",
                    "certification_status",
                    "scope",
                    "source_type",
                    "source_title",
                    "source_url",
                    "source_date",
                    "verification_status",
                    "confidence_level",
                    "last_verified_at",
                ),
            ),
        }
        plans = [
            query_plan(
                connection,
                "property detail lookup",
                """
                SELECT * FROM material_property_evidence
                 WHERE material_id = ? AND property_key = ?
                """,
                ("audit-material", "density"),
            ),
            query_plan(
                connection,
                "certification lookup",
                """
                SELECT * FROM material_certifications
                 WHERE material_id = ? AND certification_name = ?
                """,
                ("audit-material", "RoHS"),
            ),
            query_plan(
                connection,
                "exact imported identity lookup",
                """
                SELECT material_id FROM real_material_identities
                 WHERE manufacturer_key = ?
                   AND commercial_grade_key = ?
                   AND material_family_key = ?
                   AND active = 1
                """,
                ("audit", "audit", "pc"),
            ),
            query_plan(
                connection,
                "legacy exact identity lookup",
                """
                SELECT material_id FROM materials
                 WHERE manufacturer = ? AND grade_name = ?
                   AND material_family = ?
                """,
                ("audit", "audit", "PC"),
            ),
        ]
        return {
            "database": str(database.resolve()),
            "file_size_bytes": database.stat().st_size,
            "page_size_bytes": page_size,
            "page_count": page_count,
            "freelist_pages": freelist_count,
            "freelist_bytes": freelist_count * page_size,
            "dbstat_available": dbstat_available,
            "largest_objects": sizes[:25],
            "approximate_table_payload": approximate_table_payload(
                connection, tables
            ),
            "table_counts": table_counts,
            "exact_duplicate_profiles": duplicate_profiles,
            "source_text_profile": source_text_profile(connection),
            "indexes": inventory,
            "potentially_redundant_indexes": redundant_indexes(inventory),
            "query_plans": plans,
            "safe_findings": [
                (
                    "Do not delete legacy evidence solely because it is "
                    "duplicated; first determine whether IDs are externally referenced."
                ),
                (
                    "New imports normalize title, URL, date, and source identity "
                    "into evidence_sources while legacy inline columns remain readable."
                ),
                (
                    "Search is currently performed against an in-memory catalog "
                    "loaded at server startup; SQL indexes protect import and detail "
                    "lookups but do not replace that application-level search path."
                ),
            ],
        }
    finally:
        connection.close()


def markdown(report):
    lines = [
        "# Database storage and index audit",
        "",
        f"- Database: `{report['database']}`",
        f"- File size: {report['file_size_bytes']:,} bytes",
        f"- Free-list space: {report['freelist_bytes']:,} bytes",
        "",
        "## Largest objects",
        "",
        "| Object | Bytes | Pages |",
        "| --- | ---: | ---: |",
    ]
    for item in report["largest_objects"][:15]:
        lines.append(
            f"| {item['name']} | {item['bytes']:,} | {item['pages']:,} |"
        )
    lines.extend(
        [
            "",
            "## Approximate table payload",
            "",
            "| Table | Rows | Approximate payload bytes |",
            "| --- | ---: | ---: |",
        ]
    )
    for item in report["approximate_table_payload"][:12]:
        lines.append(
            f"| {item['table']} | {item['row_count']:,} | "
            f"{item['approximate_payload_bytes']:,} |"
        )
    lines.extend(
        [
            "",
            "## Exact duplicate evidence",
            "",
        ]
    )
    for table, profile in report["exact_duplicate_profiles"].items():
        lines.append(
            f"- {table}: {profile['duplicate_groups']:,} duplicate groups, "
            f"{profile['excess_rows']:,} excess rows"
        )
    lines.extend(
        [
            "",
            "## Source text",
            "",
            f"- Inline source-text bytes: {report['source_text_profile']['inline_source_text_bytes']:,}",
            f"- Repeated inline source rows: {report['source_text_profile']['repeated_inline_source_rows']:,}",
            f"- Normalized source rows: {report['source_text_profile']['normalized_source_rows']:,}",
            "",
            "## Potentially redundant indexes",
            "",
        ]
    )
    if report["potentially_redundant_indexes"]:
        for finding in report["potentially_redundant_indexes"]:
            lines.append(
                f"- `{finding['index']}` is covered by "
                f"`{finding['covered_by']}`."
            )
    else:
        lines.append("- None detected by left-prefix analysis.")
    lines.extend(
        [
            "",
            "No material or evidence row was deleted during this audit.",
            "",
        ]
    )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Profile MatFinder SQLite storage, duplicates, and indexes."
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "matfinder.db",
    )
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--markdown-output", type=Path)
    args = parser.parse_args()
    report = build_report(args.database)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(rendered, end="")
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(rendered, encoding="utf-8")
    if args.markdown_output:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(markdown(report), encoding="utf-8")


if __name__ == "__main__":
    main()
