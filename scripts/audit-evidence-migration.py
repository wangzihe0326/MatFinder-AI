import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse


EVIDENCE_TABLES = (
    "material_evidence",
    "material_property_evidence",
    "material_certifications",
)
KEY_PROPERTIES = (
    "density",
    "tensile_strength",
    "hdt",
    "continuous_use_temperature",
)
RELIABLE_SOURCE_TYPES = {
    "manufacturer",
    "official_datasheet",
    "academic",
    "distributor",
}
OFFICIAL_SOURCE_TYPES = {"manufacturer", "official_datasheet"}
VERIFIABLE_STATUSES = {"verified", "partially_verified"}


def text(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def valid_external_url(value):
    candidate = text(value)
    if not candidate:
        return False
    parsed = urlparse(candidate)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def qualified_source(row):
    return (
        row["source_type"] in RELIABLE_SOURCE_TYPES
        and bool(text(row["source_title"]))
        and valid_external_url(row["source_url"])
    )


def qualified_claim(row, official=False):
    allowed_sources = OFFICIAL_SOURCE_TYPES if official else RELIABLE_SOURCE_TYPES
    return (
        row["source_type"] in allowed_sources
        and row["verification_status"] in VERIFIABLE_STATUSES
        and bool(text(row["source_title"]))
        and valid_external_url(row["source_url"])
    )


def table_profile(connection, table):
    rows = connection.execute(
        f"""
        SELECT source_type, source_title, source_url, verification_status,
               confidence_level
          FROM {table}
        """
    ).fetchall()
    verification = Counter(row["verification_status"] for row in rows)
    confidence = Counter(row["confidence_level"] for row in rows)
    valid_urls = sum(valid_external_url(row["source_url"]) for row in rows)
    qualified_urls = sum(qualified_source(row) for row in rows)
    return {
        "row_count": len(rows),
        "valid_http_url_count": valid_urls,
        "qualified_source_url_count": qualified_urls,
        "missing_or_invalid_url_count": len(rows) - valid_urls,
        "missing_or_unqualified_source_count": len(rows) - qualified_urls,
        "generated_source_count": sum(
            row["source_type"] == "generated" for row in rows
        ),
        "verification_status": dict(sorted(verification.items())),
        "confidence_level": dict(sorted(confidence.items())),
    }


def material_quality_rollup(connection):
    identity_by_material = defaultdict(list)
    for row in connection.execute(
        """
        SELECT material_id, manufacturer, commercial_grade, source_type,
               source_title, source_url, verification_status, confidence_level
          FROM material_evidence
        """
    ):
        identity_by_material[row["material_id"]].append(row)

    properties_by_material = defaultdict(lambda: defaultdict(list))
    for row in connection.execute(
        """
        SELECT material_id, property_key, value_numeric, value_text, unit,
               test_standard, test_condition, source_type, source_title,
               source_url, verification_status, confidence_level
          FROM material_property_evidence
        """
    ):
        properties_by_material[row["material_id"]][row["property_key"]].append(row)

    result = Counter()
    for row in connection.execute("SELECT material_id FROM materials"):
        material_id = row["material_id"]
        identities = identity_by_material[material_id]
        properties = properties_by_material[material_id]
        generated_or_quarantined = any(
            claim["source_type"] == "generated"
            or claim["verification_status"] == "quarantined"
            or claim["confidence_level"] == "quarantined"
            for claim in identities
        ) or any(
            claim["source_type"] == "generated"
            or claim["verification_status"] == "quarantined"
            or claim["confidence_level"] == "quarantined"
            for claims in properties.values()
            for claim in claims
        )
        identity_confirmed = any(
            text(claim["manufacturer"]) and text(claim["commercial_grade"])
            for claim in identities
        )
        official_identity = any(
            qualified_claim(claim, official=True)
            and claim["verification_status"] == "verified"
            for claim in identities
        )

        complete_official_keys = 0
        reliable_keys = 0
        for property_key in KEY_PROPERTIES:
            claims = properties[property_key]
            if any(
                (claim["value_numeric"] is not None or text(claim["value_text"]))
                and text(claim["test_standard"])
                and text(claim["test_condition"])
                and qualified_claim(claim, official=True)
                and claim["verification_status"] == "verified"
                for claim in claims
            ):
                complete_official_keys += 1
            if any(
                (claim["value_numeric"] is not None or text(claim["value_text"]))
                and qualified_claim(claim)
                for claim in claims
            ):
                reliable_keys += 1

        if generated_or_quarantined or not identity_confirmed:
            result["quarantined"] += 1
        elif official_identity and complete_official_keys == len(KEY_PROPERTIES):
            result["high"] += 1
        elif reliable_keys >= 2:
            result["medium"] += 1
        else:
            result["low"] += 1

    return {
        level: result[level]
        for level in ("low", "medium", "high", "quarantined")
    }


def legacy_copy_indicators(connection):
    property_total = connection.execute(
        "SELECT COUNT(*) FROM material_property_evidence"
    ).fetchone()[0]
    identity_total = connection.execute(
        "SELECT COUNT(*) FROM material_evidence"
    ).fetchone()[0]
    exact_identity_source_copies = connection.execute(
        """
        SELECT COUNT(*)
          FROM material_evidence evidence
         WHERE EXISTS (
               SELECT 1
                 FROM material_sources legacy
                WHERE legacy.material_id = evidence.material_id
                  AND COALESCE(TRIM(legacy.source_title), '') =
                      COALESCE(TRIM(evidence.source_title), '')
                  AND COALESCE(TRIM(legacy.source_url), '') =
                      COALESCE(TRIM(evidence.source_url), '')
             )
        """
    ).fetchone()[0]
    return {
        "identity_rows_matching_legacy_material_sources": exact_identity_source_copies,
        "identity_row_count": identity_total,
        "property_row_count": property_total,
        "property_rows_without_source_title": connection.execute(
            """
            SELECT COUNT(*) FROM material_property_evidence
             WHERE source_title IS NULL OR TRIM(source_title) = ''
            """
        ).fetchone()[0],
        "property_rows_without_source_url": connection.execute(
            """
            SELECT COUNT(*) FROM material_property_evidence
             WHERE source_url IS NULL OR TRIM(source_url) = ''
            """
        ).fetchone()[0],
        "property_rows_without_test_standard": connection.execute(
            """
            SELECT COUNT(*) FROM material_property_evidence
             WHERE test_standard IS NULL OR TRIM(test_standard) = ''
            """
        ).fetchone()[0],
        "property_rows_without_test_condition": connection.execute(
            """
            SELECT COUNT(*) FROM material_property_evidence
             WHERE test_condition IS NULL OR TRIM(test_condition) = ''
            """
        ).fetchone()[0],
        "property_rows_marked_unknown_or_estimated": connection.execute(
            """
            SELECT COUNT(*) FROM material_property_evidence
             WHERE value_type IN ('unknown', 'estimated')
            """
        ).fetchone()[0],
    }


def build_report(database_path):
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        table_profiles = {
            table: table_profile(connection, table)
            for table in EVIDENCE_TABLES
        }
        combined = {
            "row_count": sum(item["row_count"] for item in table_profiles.values()),
            "valid_http_url_count": sum(
                item["valid_http_url_count"] for item in table_profiles.values()
            ),
            "qualified_source_url_count": sum(
                item["qualified_source_url_count"] for item in table_profiles.values()
            ),
            "missing_or_invalid_url_count": sum(
                item["missing_or_invalid_url_count"] for item in table_profiles.values()
            ),
            "missing_or_unqualified_source_count": sum(
                item["missing_or_unqualified_source_count"]
                for item in table_profiles.values()
            ),
            "generated_source_count": sum(
                item["generated_source_count"] for item in table_profiles.values()
            ),
            "verification_status": dict(
                sum(
                    (
                        Counter(item["verification_status"])
                        for item in table_profiles.values()
                    ),
                    Counter(),
                )
            ),
            "confidence_level": dict(
                sum(
                    (
                        Counter(item["confidence_level"])
                        for item in table_profiles.values()
                    ),
                    Counter(),
                )
            ),
        }
        combined["verification_status"] = dict(
            sorted(combined["verification_status"].items())
        )
        combined["confidence_level"] = dict(
            sorted(combined["confidence_level"].items())
        )
        return {
            "database": str(database_path.resolve()),
            "definitions": {
                "valid_http_url": "Non-empty HTTP(S) URL with a network host.",
                "qualified_source_url": (
                    "Valid HTTP(S) URL plus source title and a manufacturer, "
                    "official_datasheet, academic, or distributor source type. "
                    "This is a structural audit and does not claim the linked page "
                    "was independently authenticated."
                ),
                "material_quality_rollup": (
                    "Conservative rules-based recomputation; migration table "
                    "membership is ignored as a trust signal."
                ),
            },
            "materials": connection.execute(
                "SELECT COUNT(*) FROM materials"
            ).fetchone()[0],
            "table_profiles": table_profiles,
            "all_evidence": combined,
            "material_quality_rollup": material_quality_rollup(connection),
            "legacy_copy_indicators": legacy_copy_indicators(connection),
        }


def markdown(report):
    evidence = report["all_evidence"]
    levels = report["material_quality_rollup"]
    verification = evidence["verification_status"]
    confidence = evidence["confidence_level"]
    legacy = report["legacy_copy_indicators"]
    return "\n".join(
        [
            "# Legacy evidence migration audit",
            "",
            f"- Database: `{report['database']}`",
            f"- Materials: {report['materials']:,}",
            f"- Evidence rows: {evidence['row_count']:,}",
            f"- Structurally qualified source URLs: {evidence['qualified_source_url_count']:,}",
            f"- Missing or unqualified sources: {evidence['missing_or_unqualified_source_count']:,}",
            f"- Generated-source rows: {evidence['generated_source_count']:,}",
            f"- Unverified rows: {verification.get('unverified', 0):,}",
            f"- Low-confidence evidence rows: {confidence.get('low', 0):,}",
            f"- Medium-confidence evidence rows: {confidence.get('medium', 0):,}",
            f"- High-confidence evidence rows: {confidence.get('high', 0):,}",
            f"- Quarantined evidence rows: {confidence.get('quarantined', 0):,}",
            "",
            "## Conservative material-level rollup",
            "",
            f"- Low: {levels['low']:,}",
            f"- Medium: {levels['medium']:,}",
            f"- High: {levels['high']:,}",
            f"- Quarantined: {levels['quarantined']:,}",
            "",
            "## Migration-copy indicators",
            "",
            f"- Identity rows matching legacy material_sources: {legacy['identity_rows_matching_legacy_material_sources']:,}",
            f"- Property rows without source URL: {legacy['property_rows_without_source_url']:,}",
            f"- Property rows without source title: {legacy['property_rows_without_source_title']:,}",
            f"- Property rows without test standard: {legacy['property_rows_without_test_standard']:,}",
            f"- Property rows without test condition: {legacy['property_rows_without_test_condition']:,}",
            f"- Property rows marked unknown/estimated: {legacy['property_rows_marked_unknown_or_estimated']:,}",
            "",
            "A row being present in an evidence table is not counted as verification.",
            "No URL, standard, condition, manufacturer, grade, or certification was inferred.",
            "",
        ]
    )


def main():
    parser = argparse.ArgumentParser(
        description="Audit evidence migrated from the legacy MatFinder schema."
    )
    parser.add_argument(
        "--database",
        default=Path(__file__).resolve().parents[1] / "matfinder.db",
        type=Path,
    )
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--markdown-output", type=Path)
    args = parser.parse_args()

    report = build_report(args.database)
    rendered_json = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(rendered_json, end="")
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(rendered_json, encoding="utf-8")
    if args.markdown_output:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(markdown(report), encoding="utf-8")


if __name__ == "__main__":
    main()
