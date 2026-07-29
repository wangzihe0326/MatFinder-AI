import hashlib
import json
import re
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


SOURCE_TYPES = {
    "manufacturer",
    "official_datasheet",
    "academic",
    "distributor",
    "secondary_reference",
    "generated",
    "unknown",
}
TRUSTED_SOURCE_TYPES = {
    "manufacturer",
    "official_datasheet",
    "academic",
    "distributor",
}
OFFICIAL_SOURCE_TYPES = {"manufacturer", "official_datasheet"}
VERIFICATION_STATUSES = {
    "verified",
    "partially_verified",
    "unverified",
    "quarantined",
}
CONFIDENCE_LEVELS = {"high", "medium", "low", "quarantined"}
VALUE_TYPES = {"typical", "minimum", "maximum", "estimated", "unknown"}
VALID_UNITS = {
    "g/cm3",
    "kg/m3",
    "MPa",
    "GPa",
    "%",
    "degC",
    "K",
    "W/mK",
    "kV/mm",
    "ohm.cm",
    "kJ/m2",
    "J/m",
    "1",
}
PROPERTY_KEYS = {
    "density",
    "tensile_strength",
    "flexural_strength",
    "impact_strength",
    "elongation",
    "glass_transition_temperature",
    "melting_temperature",
    "hdt",
    "continuous_use_temperature",
    "thermal_conductivity",
    "dielectric_constant",
    "water_absorption",
    "flame_rating",
    "chemical_resistance",
    "transparency",
    "flexibility",
}
TEST_STANDARD_PATTERN = re.compile(
    r"^(ASTM|ISO|IEC|DIN|GB/T|UL|SAE|JIS|EN)"
    r"(?:\s+[A-Z0-9][A-Z0-9./:+-]*)+(?:\s*[\(\[].*[\)\]])?$",
    re.IGNORECASE,
)
FAMILY_RANGES = {
    "ABS": {
        "density": (0.8, 1.6),
        "tensile_strength": (5, 150),
        "hdt": (20, 180),
        "continuous_use_temperature": (-50, 160),
    },
    "PC": {
        "density": (0.9, 1.7),
        "tensile_strength": (10, 180),
        "hdt": (40, 220),
        "continuous_use_temperature": (-50, 180),
    },
    "PC/ABS": {
        "density": (0.8, 1.7),
        "tensile_strength": (5, 180),
        "hdt": (30, 210),
        "continuous_use_temperature": (-50, 170),
    },
    "PA6": {
        "density": (0.8, 2.2),
        "tensile_strength": (5, 350),
        "hdt": (30, 300),
        "continuous_use_temperature": (-50, 240),
    },
    "PA66": {
        "density": (0.8, 2.3),
        "tensile_strength": (5, 400),
        "hdt": (30, 320),
        "continuous_use_temperature": (-50, 260),
    },
    "POM": {
        "density": (0.9, 1.8),
        "tensile_strength": (5, 200),
        "hdt": (30, 220),
        "continuous_use_temperature": (-50, 180),
    },
    "PP": {
        "density": (0.6, 1.8),
        "tensile_strength": (1, 200),
        "hdt": (20, 220),
        "continuous_use_temperature": (-50, 170),
    },
    "HDPE": {
        "density": (0.7, 1.3),
        "tensile_strength": (1, 120),
        "hdt": (20, 160),
        "continuous_use_temperature": (-100, 130),
    },
    "PET": {
        "density": (0.9, 2.2),
        "tensile_strength": (5, 350),
        "hdt": (30, 300),
        "continuous_use_temperature": (-50, 220),
    },
    "PBT": {
        "density": (0.9, 2.2),
        "tensile_strength": (5, 350),
        "hdt": (30, 300),
        "continuous_use_temperature": (-50, 230),
    },
    "TPU": {
        "density": (0.7, 1.7),
        "tensile_strength": (1, 150),
        "hdt": (20, 180),
        "continuous_use_temperature": (-80, 170),
    },
    "PMMA": {
        "density": (0.9, 1.6),
        "tensile_strength": (5, 180),
        "hdt": (30, 180),
        "continuous_use_temperature": (-50, 150),
    },
    "PPS": {
        "density": (1, 2.6),
        "tensile_strength": (10, 400),
        "hdt": (50, 350),
        "continuous_use_temperature": (-50, 300),
    },
    "PEEK": {
        "density": (1, 2.2),
        "tensile_strength": (10, 450),
        "hdt": (80, 400),
        "continuous_use_temperature": (-50, 350),
    },
}
PLACEHOLDER_PATTERN = re.compile(
    r"placeholder|test only|not a real|example\.invalid|\.invalid(?:/|$)",
    re.IGNORECASE,
)


class ImportValidationError(Exception):
    def __init__(self, report):
        super().__init__("Input contains severe validation errors.")
        self.report = report


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value):
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def identity_key(value):
    value = clean_text(value)
    if not value:
        return None
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.casefold().split())


def valid_url(value):
    candidate = clean_text(value)
    if not candidate:
        return False
    parsed = urlparse(candidate)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def normalized_url(value):
    candidate = clean_text(value)
    if not candidate:
        return None
    parsed = urlparse(candidate)
    return parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        fragment="",
    ).geturl()


def hash_payload(value):
    rendered = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def issue(code, message, path, severity="error"):
    return {
        "code": code,
        "message": message,
        "path": path,
        "severity": severity,
    }


def normalize_source(raw, identity):
    raw = raw or {}
    return {
        "sourceType": clean_text(raw.get("sourceType")) or "unknown",
        "sourceTitle": clean_text(raw.get("sourceTitle")),
        "sourceUrl": clean_text(raw.get("sourceUrl")),
        "sourceDate": clean_text(raw.get("sourceDate")),
        "manufacturer": clean_text(raw.get("manufacturer"))
        or identity["manufacturer"],
        "brand": clean_text(raw.get("brand")) or identity["brand"],
        "commercialGrade": clean_text(raw.get("commercialGrade"))
        or identity["commercialGrade"],
        "materialFamily": clean_text(raw.get("materialFamily"))
        or identity["materialFamily"],
    }


def normalize_record(raw, index):
    identity = {
        "manufacturer": clean_text(raw.get("manufacturer")),
        "brand": clean_text(raw.get("brand")),
        "commercialGrade": clean_text(raw.get("commercialGrade")),
        "materialFamily": clean_text(raw.get("materialFamily")),
    }
    identity_sources = [
        {
            **normalize_source(source, identity),
            "verificationStatus": clean_text(source.get("verificationStatus"))
            or "unverified",
            "confidenceLevel": clean_text(source.get("confidenceLevel")) or "low",
            "lastVerifiedAt": clean_text(source.get("lastVerifiedAt")),
            "notes": clean_text(source.get("notes")),
        }
        for source in (raw.get("identitySources") or [])
    ]
    measurements = []
    for property_index, group in enumerate(raw.get("properties") or []):
        property_key = clean_text(group.get("propertyKey"))
        for measurement_index, measurement in enumerate(
            group.get("measurements") or []
        ):
            measurements.append(
                {
                    "propertyKey": property_key,
                    "value": measurement.get("value"),
                    "unit": clean_text(measurement.get("unit")),
                    "testStandard": clean_text(
                        measurement.get("testStandard")
                    ),
                    "testCondition": clean_text(
                        measurement.get("testCondition")
                    ),
                    "valueType": clean_text(measurement.get("valueType"))
                    or "unknown",
                    "verificationStatus": clean_text(
                        measurement.get("verificationStatus")
                    )
                    or "unverified",
                    "confidenceLevel": clean_text(
                        measurement.get("confidenceLevel")
                    )
                    or "low",
                    "lastVerifiedAt": clean_text(
                        measurement.get("lastVerifiedAt")
                    ),
                    "source": normalize_source(measurement, identity),
                    "_path": (
                        f"materials[{index}].properties[{property_index}]"
                        f".measurements[{measurement_index}]"
                    ),
                }
            )
    certifications = []
    for certification_index, certification in enumerate(
        raw.get("certifications") or []
    ):
        certifications.append(
            {
                "certificationName": clean_text(
                    certification.get("certificationName")
                ),
                "certificationStatus": clean_text(
                    certification.get("certificationStatus")
                )
                or "unknown",
                "scope": clean_text(certification.get("scope")),
                "verificationStatus": clean_text(
                    certification.get("verificationStatus")
                )
                or "unverified",
                "confidenceLevel": clean_text(
                    certification.get("confidenceLevel")
                )
                or "low",
                "lastVerifiedAt": clean_text(
                    certification.get("lastVerifiedAt")
                ),
                "source": normalize_source(certification, identity),
                "_path": f"materials[{index}].certifications[{certification_index}]",
            }
        )
    return {
        **identity,
        "officialTdsLinks": raw.get("officialTdsLinks") or [],
        "identitySources": identity_sources,
        "measurements": measurements,
        "certifications": certifications,
        "placeholder": raw.get("placeholder") is True,
        "_path": f"materials[{index}]",
    }


def validate_source(source, path, errors, allow_test_fixtures=False):
    source_type = source["sourceType"]
    if source_type not in SOURCE_TYPES:
        errors.append(
            issue(
                "source_type_invalid",
                f"Unsupported source type: {source_type}.",
                f"{path}.sourceType",
            )
        )
    if source_type in {"generated", "unknown"}:
        errors.append(
            issue(
                "source_type_not_importable",
                "Generated or unknown sources cannot enter the real-material library.",
                f"{path}.sourceType",
            )
        )
    if not source["sourceTitle"]:
        errors.append(
            issue(
                "source_title_missing",
                "A real evidence source title is required.",
                f"{path}.sourceTitle",
            )
        )
    if not valid_url(source["sourceUrl"]):
        errors.append(
            issue(
                "source_url_invalid",
                "A non-empty HTTP(S) evidence URL is required.",
                f"{path}.sourceUrl",
            )
        )
    if not allow_test_fixtures and any(
        PLACEHOLDER_PATTERN.search(str(source.get(field) or ""))
        for field in ("sourceTitle", "sourceUrl")
    ):
        errors.append(
            issue(
                "placeholder_source_forbidden",
                "PLACEHOLDER or test-only sources cannot be imported.",
                path,
            )
        )


def validate_record(record, allow_test_fixtures=False):
    errors = []
    warnings = []
    path = record["_path"]
    if record["placeholder"] and not allow_test_fixtures:
        errors.append(
            issue(
                "placeholder_record_forbidden",
                "This record is explicitly marked as a non-importable placeholder.",
                path,
            )
        )
    for field in ("manufacturer", "commercialGrade", "materialFamily"):
        if not record[field]:
            errors.append(
                issue(
                    f"{field}_missing",
                    f"{field} is required for exact material identity.",
                    f"{path}.{field}",
                )
            )
        elif (
            not allow_test_fixtures
            and PLACEHOLDER_PATTERN.search(record[field])
        ):
            errors.append(
                issue(
                    f"{field}_placeholder",
                    f"{field} contains a placeholder marker.",
                    f"{path}.{field}",
                )
            )
    if not record["identitySources"]:
        errors.append(
            issue(
                "identity_source_missing",
                "At least one independent identity source is required.",
                f"{path}.identitySources",
            )
        )

    for source_index, source in enumerate(record["identitySources"]):
        source_path = f"{path}.identitySources[{source_index}]"
        validate_source(
            source, source_path, errors, allow_test_fixtures
        )
        if source["verificationStatus"] not in VERIFICATION_STATUSES:
            errors.append(
                issue(
                    "verification_status_invalid",
                    "Invalid verification status.",
                    f"{source_path}.verificationStatus",
                )
            )
        if source["confidenceLevel"] not in CONFIDENCE_LEVELS:
            errors.append(
                issue(
                    "confidence_level_invalid",
                    "Invalid confidence level.",
                    f"{source_path}.confidenceLevel",
                )
            )
        if source["confidenceLevel"] == "high" and not (
            source["sourceType"] in OFFICIAL_SOURCE_TYPES
            and source["verificationStatus"] == "verified"
        ):
            errors.append(
                issue(
                    "identity_high_overclaim",
                    "High identity confidence requires a verified official source.",
                    source_path,
                )
            )

    for link_index, link in enumerate(record["officialTdsLinks"]):
        if not valid_url(link) or (
            not allow_test_fixtures
            and PLACEHOLDER_PATTERN.search(str(link))
        ):
            errors.append(
                issue(
                    "official_tds_url_invalid",
                    "Official TDS links must be real HTTP(S) URLs.",
                    f"{path}.officialTdsLinks[{link_index}]",
                )
            )
        elif not any(
            source["sourceType"] == "official_datasheet"
            and source["sourceUrl"] == link
            for source in record["identitySources"]
        ):
            warnings.append(
                issue(
                    "official_tds_not_identity_source",
                    "The TDS URL is not represented by a full identity source record.",
                    f"{path}.officialTdsLinks[{link_index}]",
                    "warning",
                )
            )

    for measurement in record["measurements"]:
        measurement_path = measurement["_path"]
        property_key = measurement["propertyKey"]
        if property_key not in PROPERTY_KEYS:
            errors.append(
                issue(
                    "property_key_invalid",
                    f"Unsupported property key: {property_key}.",
                    f"{measurement_path}.propertyKey",
                )
            )
        if measurement["value"] in (None, ""):
            errors.append(
                issue(
                    "property_value_missing",
                    "Property evidence must contain a value.",
                    f"{measurement_path}.value",
                )
            )
        if not measurement["unit"] or measurement["unit"] not in VALID_UNITS:
            errors.append(
                issue(
                    "unit_invalid",
                    f"Unsupported or missing unit: {measurement['unit']}.",
                    f"{measurement_path}.unit",
                )
            )
        if measurement["valueType"] not in VALUE_TYPES:
            errors.append(
                issue(
                    "value_type_invalid",
                    "Invalid value type.",
                    f"{measurement_path}.valueType",
                )
            )
        if measurement["valueType"] == "estimated":
            errors.append(
                issue(
                    "estimated_value_forbidden",
                    "Estimated values cannot enter the real-material importer.",
                    f"{measurement_path}.valueType",
                )
            )
        if (
            measurement["testStandard"]
            and not TEST_STANDARD_PATTERN.match(measurement["testStandard"])
        ):
            errors.append(
                issue(
                    "test_standard_invalid",
                    "Test standard format is invalid.",
                    f"{measurement_path}.testStandard",
                )
            )
        if not measurement["testStandard"]:
            warnings.append(
                issue(
                    "test_standard_missing",
                    "Test standard is unavailable; this claim cannot be High confidence.",
                    f"{measurement_path}.testStandard",
                    "warning",
                )
            )
        if not measurement["testCondition"]:
            warnings.append(
                issue(
                    "test_condition_missing",
                    "Test condition is unavailable; this claim cannot be High confidence.",
                    f"{measurement_path}.testCondition",
                    "warning",
                )
            )
        if measurement["verificationStatus"] not in VERIFICATION_STATUSES:
            errors.append(
                issue(
                    "verification_status_invalid",
                    "Invalid verification status.",
                    f"{measurement_path}.verificationStatus",
                )
            )
        if measurement["confidenceLevel"] not in CONFIDENCE_LEVELS:
            errors.append(
                issue(
                    "confidence_level_invalid",
                    "Invalid confidence level.",
                    f"{measurement_path}.confidenceLevel",
                )
            )
        validate_source(
            measurement["source"],
            f"{measurement_path}.source",
            errors,
            allow_test_fixtures,
        )
        if measurement["confidenceLevel"] == "high" and not (
            measurement["source"]["sourceType"] in OFFICIAL_SOURCE_TYPES
            and measurement["verificationStatus"] == "verified"
            and measurement["testStandard"]
            and measurement["testCondition"]
        ):
            errors.append(
                issue(
                    "property_high_overclaim",
                    "High property confidence requires verified official evidence, a test standard, and a test condition.",
                    measurement_path,
                )
            )
        if measurement["confidenceLevel"] == "medium" and not (
            measurement["source"]["sourceType"] in TRUSTED_SOURCE_TYPES
            and measurement["verificationStatus"]
            in {"verified", "partially_verified"}
        ):
            errors.append(
                issue(
                    "property_medium_overclaim",
                    "Medium confidence requires a verified or partially verified trusted source.",
                    measurement_path,
                )
            )
        try:
            numeric = float(measurement["value"])
        except (TypeError, ValueError):
            numeric = None
        family = (record["materialFamily"] or "").upper().replace(" ", "")
        plausible = FAMILY_RANGES.get(family, {}).get(property_key)
        if numeric is not None and plausible and not (
            plausible[0] <= numeric <= plausible[1]
        ):
            errors.append(
                issue(
                    "family_range_violation",
                    f"{property_key} value {numeric} is outside the broad plausibility range for {family}.",
                    measurement_path,
                )
            )

    for certification in record["certifications"]:
        certification_path = certification["_path"]
        if not certification["certificationName"]:
            errors.append(
                issue(
                    "certification_name_missing",
                    "Certification name is required.",
                    f"{certification_path}.certificationName",
                )
            )
        if not certification["scope"]:
            warnings.append(
                issue(
                    "certification_scope_missing",
                    "Certification scope is unavailable.",
                    f"{certification_path}.scope",
                    "warning",
                )
            )
        if certification["verificationStatus"] not in VERIFICATION_STATUSES:
            errors.append(
                issue(
                    "verification_status_invalid",
                    "Invalid verification status.",
                    f"{certification_path}.verificationStatus",
                )
            )
        if certification["confidenceLevel"] not in CONFIDENCE_LEVELS:
            errors.append(
                issue(
                    "confidence_level_invalid",
                    "Invalid confidence level.",
                    f"{certification_path}.confidenceLevel",
                )
            )
        validate_source(
            certification["source"],
            f"{certification_path}.source",
            errors,
            allow_test_fixtures,
        )
        if certification["confidenceLevel"] == "high" and not (
            certification["source"]["sourceType"] in OFFICIAL_SOURCE_TYPES
            and certification["verificationStatus"] == "verified"
        ):
            errors.append(
                issue(
                    "certification_high_overclaim",
                    "High certification confidence requires verified official evidence.",
                    certification_path,
                )
            )
    return errors, warnings


def source_fingerprint(source):
    return hash_payload(
        {
            "sourceType": source.get("sourceType"),
            "sourceUrl": normalized_url(source.get("sourceUrl")),
            "sourceDate": source.get("sourceDate"),
        }
    )


def identity_evidence_fingerprint(material_id, source):
    return hash_payload(
        {
            "kind": "identity",
            "materialId": material_id,
            "manufacturer": source["manufacturer"],
            "brand": source["brand"],
            "commercialGrade": source["commercialGrade"],
            "materialFamily": source["materialFamily"],
            "source": source_fingerprint(source),
            "verificationStatus": source["verificationStatus"],
            "confidenceLevel": source["confidenceLevel"],
            "lastVerifiedAt": source["lastVerifiedAt"],
        }
    )


def property_evidence_fingerprint(material_id, measurement):
    return hash_payload(
        {
            "kind": "property",
            "materialId": material_id,
            "propertyKey": measurement["propertyKey"],
            "value": measurement["value"],
            "unit": measurement["unit"],
            "testStandard": measurement["testStandard"],
            "testCondition": measurement["testCondition"],
            "valueType": measurement["valueType"],
            "source": source_fingerprint(measurement["source"]),
            "verificationStatus": measurement["verificationStatus"],
            "confidenceLevel": measurement["confidenceLevel"],
            "lastVerifiedAt": measurement["lastVerifiedAt"],
        }
    )


def certification_fingerprint(material_id, certification):
    return hash_payload(
        {
            "kind": "certification",
            "materialId": material_id,
            "certificationName": certification["certificationName"],
            "certificationStatus": certification["certificationStatus"],
            "scope": certification["scope"],
            "source": source_fingerprint(certification["source"]),
            "verificationStatus": certification["verificationStatus"],
            "confidenceLevel": certification["confidenceLevel"],
            "lastVerifiedAt": certification["lastVerifiedAt"],
        }
    )


def deterministic_material_id(record):
    key = "|".join(
        identity_key(record[field])
        for field in ("manufacturer", "commercialGrade", "materialFamily")
    )
    return f"REAL-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:24].upper()}"


def require_schema(connection):
    required_tables = {
        "import_batches",
        "evidence_sources",
        "real_material_identities",
        "import_entity_links",
    }
    actual_tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    missing = required_tables - actual_tables
    if missing:
        raise RuntimeError(
            "Import schema is missing. Run npm run migrate:import-schema first. "
            f"Missing: {', '.join(sorted(missing))}"
        )


def load_input(file_path):
    raw_bytes = file_path.read_bytes()
    payload = json.loads(raw_bytes.decode("utf-8-sig"))
    if not isinstance(payload, dict) or not isinstance(payload.get("materials"), list):
        raise ValueError("Input JSON must contain a materials array.")
    records = [
        normalize_record(record, index)
        for index, record in enumerate(payload["materials"])
    ]
    return raw_bytes, records


def find_material(connection, record):
    keys = tuple(
        identity_key(record[field])
        for field in ("manufacturer", "commercialGrade", "materialFamily")
    )
    row = connection.execute(
        """
        SELECT material_id
          FROM real_material_identities
         WHERE manufacturer_key = ?
           AND commercial_grade_key = ?
           AND material_family_key = ?
           AND active = 1
        """,
        keys,
    ).fetchone()
    return row[0] if row else None


def fingerprint_exists(connection, table, fingerprint):
    return (
        connection.execute(
            f"SELECT 1 FROM {table} WHERE evidence_fingerprint = ?",
            (fingerprint,),
        ).fetchone()
        is not None
    )


def plan_import(
    connection, records, input_hash, allow_test_fixtures=False
):
    prior_batch = connection.execute(
        """
        SELECT import_batch_id
          FROM import_batches
         WHERE input_file_hash = ? AND status = 'committed'
        """,
        (input_hash,),
    ).fetchone()
    errors = []
    warnings = []
    seen_identities = set()
    actions = []
    entity_counts = CounterLike()
    for record in records:
        error_count_before_record = len(errors)
        record_errors, record_warnings = validate_record(
            record, allow_test_fixtures
        )
        errors.extend(record_errors)
        warnings.extend(record_warnings)
        key = tuple(
            identity_key(record[field])
            for field in ("manufacturer", "commercialGrade", "materialFamily")
        )
        if key in seen_identities:
            errors.append(
                issue(
                    "duplicate_material_identity_in_file",
                    "The same manufacturer + commercialGrade + materialFamily appears more than once.",
                    record["_path"],
                )
            )
        seen_identities.add(key)

        material_id = find_material(connection, record)
        if not material_id:
            material_id = deterministic_material_id(record)
        if len(errors) > error_count_before_record:
            actions.append(
                {
                    "identity": {
                        "manufacturer": record["manufacturer"],
                        "commercialGrade": record["commercialGrade"],
                        "materialFamily": record["materialFamily"],
                    },
                    "materialId": material_id,
                    "action": "reject",
                    "newEvidenceCount": 0,
                }
            )
            continue
        new_entities = 0
        for source in record["identitySources"]:
            if not fingerprint_exists(
                connection,
                "material_evidence",
                identity_evidence_fingerprint(material_id, source),
            ):
                new_entities += 1
                entity_counts["identityEvidence"] += 1
        for measurement in record["measurements"]:
            if not fingerprint_exists(
                connection,
                "material_property_evidence",
                property_evidence_fingerprint(material_id, measurement),
            ):
                new_entities += 1
                entity_counts["propertyEvidence"] += 1
        for certification in record["certifications"]:
            if not fingerprint_exists(
                connection,
                "material_certifications",
                certification_fingerprint(material_id, certification),
            ):
                new_entities += 1
                entity_counts["certifications"] += 1

        if prior_batch:
            action = "skip"
        elif find_material(connection, record):
            action = "update" if new_entities else "skip"
        else:
            action = "add"
        actions.append(
            {
                "identity": {
                    "manufacturer": record["manufacturer"],
                    "commercialGrade": record["commercialGrade"],
                    "materialFamily": record["materialFamily"],
                },
                "materialId": material_id,
                "action": action,
                "newEvidenceCount": new_entities,
            }
        )

    counts = {
        "add": sum(action["action"] == "add" for action in actions),
        "update": sum(action["action"] == "update" for action in actions),
        "skip": sum(action["action"] == "skip" for action in actions),
        "reject": sum(action["action"] == "reject" for action in actions),
    }
    if errors and not counts["reject"]:
        counts["reject"] = len(records)
    return {
        "priorBatchId": prior_batch[0] if prior_batch else None,
        "counts": counts,
        "entityCounts": dict(entity_counts),
        "actions": actions,
        "errors": errors,
        "warnings": warnings,
    }


class CounterLike(dict):
    def __missing__(self, key):
        return 0


def link_entity(connection, batch_id, entity_type, entity_id, created):
    connection.execute(
        """
        INSERT OR IGNORE INTO import_entity_links (
          import_batch_id, entity_type, entity_id, created_by_batch
        )
        VALUES (?, ?, ?, ?)
        """,
        (batch_id, entity_type, str(entity_id), 1 if created else 0),
    )


def get_or_create_source(connection, batch_id, source, imported_at):
    fingerprint = source_fingerprint(source)
    row = connection.execute(
        "SELECT source_id FROM evidence_sources WHERE source_fingerprint = ?",
        (fingerprint,),
    ).fetchone()
    created = row is None
    if created:
        cursor = connection.execute(
            """
            INSERT INTO evidence_sources (
              source_fingerprint, source_type, source_title, source_url,
              source_date, manufacturer, brand, commercial_grade,
              material_family, created_by_batch_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fingerprint,
                source["sourceType"],
                source["sourceTitle"],
                source["sourceUrl"],
                source["sourceDate"],
                source["manufacturer"],
                source["brand"],
                source["commercialGrade"],
                source["materialFamily"],
                batch_id,
                imported_at,
            ),
        )
        source_id = cursor.lastrowid
    else:
        source_id = row[0]
    link_entity(connection, batch_id, "source", source_id, created)
    return source_id


def create_material_shell(connection, batch_id, record, material_id, imported_at):
    list_json = "[]"
    label = record["commercialGrade"]
    connection.execute(
        """
        INSERT INTO materials (
          material_id, name, name_en, name_zh, abbreviation,
          material_family, grade_name, supplier_or_brand, category,
          category_en, category_zh, subcategory, state, family,
          manufacturer, trade_name, density, tensile_strength,
          flexural_strength, impact_strength, hardness, elongation,
          glass_transition_temperature, melting_temperature, max_temperature,
          continuous_use_temperature, thermal_conductivity,
          dielectric_constant, flame_rating, electrical_insulation,
          chemical_resistance, transparency, flexibility, waterproof_sealing,
          water_absorption, flammability, recyclability, cost_level,
          processing_methods, applications, applications_en, applications_zh,
          limitations, alternatives, source_note, typical_applications,
          advantages, disadvantages, tags_en, tags_zh, summary,
          description_en, description_zh, translation_quality,
          translation_status, notes
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, 'Plastics', 'Plastics', 'Plastics',
          NULL, 'unknown', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?,
          'Evidence sources are stored in normalized evidence tables.', ?, ?, ?,
          ?, ?, ?, ?, ?, 'source', 'untranslated',
          'Imported shell; engineering claims are stored only in evidence records.'
        )
        """,
        (
            material_id,
            label,
            label,
            label,
            record["materialFamily"],
            record["materialFamily"],
            record["commercialGrade"],
            record["brand"] or record["manufacturer"],
            record["materialFamily"],
            record["manufacturer"],
            record["brand"],
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            list_json,
            label,
            label,
            label,
        ),
    )
    keys = tuple(
        identity_key(record[field])
        for field in ("manufacturer", "commercialGrade", "materialFamily")
    )
    connection.execute(
        """
        INSERT INTO real_material_identities (
          material_id, manufacturer, commercial_grade, material_family,
          manufacturer_key, commercial_grade_key, material_family_key,
          created_by_batch_id, created_at, active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            material_id,
            record["manufacturer"],
            record["commercialGrade"],
            record["materialFamily"],
            *keys,
            batch_id,
            imported_at,
        ),
    )
    link_entity(connection, batch_id, "material", material_id, True)
    link_entity(connection, batch_id, "material_identity", material_id, True)


def ensure_material_link(connection, batch_id, record, material_id):
    created = find_material(connection, record) is None
    if created:
        create_material_shell(
            connection, batch_id, record, material_id, now_iso()
        )
    else:
        link_entity(connection, batch_id, "material", material_id, False)
        link_entity(
            connection, batch_id, "material_identity", material_id, False
        )
    return created


def insert_identity_evidence(
    connection, batch_id, material_id, source, imported_at
):
    fingerprint = identity_evidence_fingerprint(material_id, source)
    row = connection.execute(
        "SELECT id FROM material_evidence WHERE evidence_fingerprint = ?",
        (fingerprint,),
    ).fetchone()
    if row:
        link_entity(connection, batch_id, "identity_evidence", row[0], False)
        return False
    source_id = get_or_create_source(
        connection, batch_id, source, imported_at
    )
    version = connection.execute(
        "SELECT COALESCE(MAX(evidence_version), 0) + 1 FROM material_evidence WHERE material_id = ?",
        (material_id,),
    ).fetchone()[0]
    cursor = connection.execute(
        """
        INSERT INTO material_evidence (
          material_id, manufacturer, brand, commercial_grade, material_family,
          source_type, source_title, source_url, source_date,
          verification_status, confidence_level, last_verified_at, notes,
          source_id, evidence_fingerprint, import_batch_id, imported_at,
          evidence_version
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            material_id,
            source["manufacturer"],
            source["brand"],
            source["commercialGrade"],
            source["materialFamily"],
            source["sourceType"],
            source["verificationStatus"],
            source["confidenceLevel"],
            source["lastVerifiedAt"],
            source["notes"],
            source_id,
            fingerprint,
            batch_id,
            imported_at,
            version,
        ),
    )
    link_entity(
        connection, batch_id, "identity_evidence", cursor.lastrowid, True
    )
    return True


def context_group_id(material_id, measurement):
    return hash_payload(
        {
            "materialId": material_id,
            "propertyKey": measurement["propertyKey"],
            "testStandard": measurement["testStandard"],
            "testCondition": measurement["testCondition"],
            "unit": measurement["unit"],
            "valueType": measurement["valueType"],
        }
    )


def values_conflict(left_numeric, left_text, right_value):
    try:
        right_numeric = float(right_value)
    except (TypeError, ValueError):
        right_numeric = None
    if left_numeric is not None and right_numeric is not None:
        denominator = max(abs(left_numeric), abs(right_numeric), 1.0)
        return abs(left_numeric - right_numeric) / denominator > 0.30
    left_value = clean_text(left_text)
    right_text = clean_text(right_value)
    return bool(
        left_value
        and right_text
        and identity_key(left_value) != identity_key(right_text)
    )


def insert_property_evidence(
    connection, batch_id, material_id, record, measurement, imported_at
):
    fingerprint = property_evidence_fingerprint(material_id, measurement)
    row = connection.execute(
        """
        SELECT id
          FROM material_property_evidence
         WHERE evidence_fingerprint = ?
        """,
        (fingerprint,),
    ).fetchone()
    if row:
        link_entity(connection, batch_id, "property_evidence", row[0], False)
        return False

    source_id = get_or_create_source(
        connection, batch_id, measurement["source"], imported_at
    )
    group_id = context_group_id(material_id, measurement)
    context_rows = connection.execute(
        """
        SELECT id, value_numeric, value_text
          FROM material_property_evidence
         WHERE material_id = ?
           AND property_key = ?
           AND test_standard IS ?
           AND test_condition IS ?
           AND unit IS ?
           AND value_type = ?
        """,
        (
            material_id,
            measurement["propertyKey"],
            measurement["testStandard"],
            measurement["testCondition"],
            measurement["unit"],
            measurement["valueType"],
        ),
    ).fetchall()
    conflicting_ids = [
        existing["id"]
        for existing in context_rows
        if values_conflict(
            existing["value_numeric"],
            existing["value_text"],
            measurement["value"],
        )
    ]
    if conflicting_ids:
        placeholders = ",".join("?" for _ in conflicting_ids)
        connection.execute(
            f"""
            UPDATE material_property_evidence
               SET conflict_group_id = ?, conflict_status = 'conflicting'
             WHERE id IN ({placeholders})
            """,
            (group_id, *conflicting_ids),
        )
    try:
        value_numeric = float(measurement["value"])
        value_text = None
    except (TypeError, ValueError):
        value_numeric = None
        value_text = clean_text(measurement["value"])
    position = connection.execute(
        """
        SELECT COALESCE(MAX(position), -1) + 1
          FROM material_property_evidence
         WHERE material_id = ? AND property_key = ?
        """,
        (material_id, measurement["propertyKey"]),
    ).fetchone()[0]
    version = len(context_rows) + 1
    cursor = connection.execute(
        """
        INSERT INTO material_property_evidence (
          material_id, property_key, position, value_numeric, value_text, unit,
          test_standard, test_condition, value_type, manufacturer, brand,
          commercial_grade, material_family, source_type, source_title,
          source_url, source_date, verification_status, confidence_level,
          last_verified_at, source_id, evidence_fingerprint, import_batch_id,
          imported_at, evidence_version, conflict_group_id, conflict_status
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        (
            material_id,
            measurement["propertyKey"],
            position,
            value_numeric,
            value_text,
            measurement["unit"],
            measurement["testStandard"],
            measurement["testCondition"],
            measurement["valueType"],
            record["manufacturer"],
            record["brand"],
            record["commercialGrade"],
            record["materialFamily"],
            measurement["source"]["sourceType"],
            measurement["verificationStatus"],
            measurement["confidenceLevel"],
            measurement["lastVerifiedAt"],
            source_id,
            fingerprint,
            batch_id,
            imported_at,
            version,
            group_id,
            "conflicting" if conflicting_ids else "none",
        ),
    )
    link_entity(
        connection, batch_id, "property_evidence", cursor.lastrowid, True
    )
    return True


def insert_certification(
    connection, batch_id, material_id, certification, imported_at
):
    fingerprint = certification_fingerprint(material_id, certification)
    row = connection.execute(
        "SELECT id FROM material_certifications WHERE evidence_fingerprint = ?",
        (fingerprint,),
    ).fetchone()
    if row:
        link_entity(connection, batch_id, "certification", row[0], False)
        return False
    source_id = get_or_create_source(
        connection, batch_id, certification["source"], imported_at
    )
    version = connection.execute(
        """
        SELECT COALESCE(MAX(evidence_version), 0) + 1
          FROM material_certifications
         WHERE material_id = ? AND certification_name = ?
        """,
        (material_id, certification["certificationName"]),
    ).fetchone()[0]
    cursor = connection.execute(
        """
        INSERT INTO material_certifications (
          material_id, certification_name, certification_status, scope,
          source_type, source_title, source_url, source_date,
          verification_status, confidence_level, last_verified_at, source_id,
          evidence_fingerprint, import_batch_id, imported_at, evidence_version
        )
        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            material_id,
            certification["certificationName"],
            certification["certificationStatus"],
            certification["scope"],
            certification["source"]["sourceType"],
            certification["verificationStatus"],
            certification["confidenceLevel"],
            certification["lastVerifiedAt"],
            source_id,
            fingerprint,
            batch_id,
            imported_at,
            version,
        ),
    )
    link_entity(
        connection, batch_id, "certification", cursor.lastrowid, True
    )
    return True


def execute_import(
    database_path,
    file_path,
    dry_run=False,
    operator=None,
    import_source=None,
    fail_after_entities=None,
    allow_test_fixtures=False,
):
    raw_bytes, records = load_input(file_path)
    input_hash = hashlib.sha256(raw_bytes).hexdigest()
    uri = f"{database_path.resolve().as_uri()}?mode=ro"
    if dry_run:
        connection = sqlite3.connect(uri, uri=True)
    else:
        connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        require_schema(connection)
        plan = plan_import(
            connection, records, input_hash, allow_test_fixtures
        )
        report = {
            "mode": "dry-run" if dry_run else "import",
            "database": str(database_path.resolve()),
            "inputFile": str(file_path.resolve()),
            "inputFileHash": input_hash,
            "recordCount": len(records),
            **plan,
        }
        if plan["errors"]:
            report["status"] = "rejected"
            if dry_run:
                return report
            raise ImportValidationError(report)
        if dry_run:
            report["status"] = (
                "already_imported" if plan["priorBatchId"] else "ready"
            )
            return report
        if plan["priorBatchId"]:
            report["status"] = "already_imported"
            report["importBatchId"] = plan["priorBatchId"]
            return report

        imported_at = now_iso()
        batch_id = f"IMP-{uuid.uuid4()}"
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            INSERT INTO import_batches (
              import_batch_id, imported_at, input_file_hash, input_file_name,
              imported_record_count, rejected_record_count, operator,
              import_source, status, rolled_back_at, report_json
            )
            VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'committed', NULL, '{}')
            """,
            (
                batch_id,
                imported_at,
                input_hash,
                file_path.name,
                clean_text(operator),
                clean_text(import_source),
            ),
        )
        entity_insertions = 0
        for record in records:
            material_id = find_material(connection, record)
            if not material_id:
                material_id = deterministic_material_id(record)
                create_material_shell(
                    connection, batch_id, record, material_id, imported_at
                )
                entity_insertions += 1
            else:
                link_entity(
                    connection, batch_id, "material", material_id, False
                )
                link_entity(
                    connection,
                    batch_id,
                    "material_identity",
                    material_id,
                    False,
                )
            for source in record["identitySources"]:
                entity_insertions += int(
                    insert_identity_evidence(
                        connection, batch_id, material_id, source, imported_at
                    )
                )
                if (
                    fail_after_entities is not None
                    and entity_insertions >= fail_after_entities
                ):
                    raise RuntimeError("Injected importer rollback test failure.")
            for measurement in record["measurements"]:
                entity_insertions += int(
                    insert_property_evidence(
                        connection,
                        batch_id,
                        material_id,
                        record,
                        measurement,
                        imported_at,
                    )
                )
                if (
                    fail_after_entities is not None
                    and entity_insertions >= fail_after_entities
                ):
                    raise RuntimeError("Injected importer rollback test failure.")
            for certification in record["certifications"]:
                entity_insertions += int(
                    insert_certification(
                        connection,
                        batch_id,
                        material_id,
                        certification,
                        imported_at,
                    )
                )
                if (
                    fail_after_entities is not None
                    and entity_insertions >= fail_after_entities
                ):
                    raise RuntimeError("Injected importer rollback test failure.")

        report.update(
            {
                "status": "committed",
                "importBatchId": batch_id,
                "importedAt": imported_at,
                "operator": clean_text(operator),
                "importSource": clean_text(import_source),
            }
        )
        imported_records = plan["counts"]["add"] + plan["counts"]["update"]
        connection.execute(
            """
            UPDATE import_batches
               SET imported_record_count = ?, rejected_record_count = 0,
                   report_json = ?
             WHERE import_batch_id = ?
            """,
            (
                imported_records,
                json.dumps(report, ensure_ascii=False, sort_keys=True),
                batch_id,
            ),
        )
        connection.commit()
        return report
    except Exception:
        if not dry_run:
            connection.rollback()
        raise
    finally:
        connection.close()


def rollback_import(database_path, batch_id, operator=None):
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        require_schema(connection)
        batch = connection.execute(
            """
            SELECT * FROM import_batches
             WHERE import_batch_id = ? AND status = 'committed'
            """,
            (batch_id,),
        ).fetchone()
        if not batch:
            raise ValueError(
                f"Committed import batch not found: {batch_id}"
            )
        connection.execute("BEGIN IMMEDIATE")
        links = connection.execute(
            """
            SELECT entity_type, entity_id, created_by_batch
              FROM import_entity_links
             WHERE import_batch_id = ?
            """,
            (batch_id,),
        ).fetchall()
        connection.execute(
            "DELETE FROM import_entity_links WHERE import_batch_id = ?",
            (batch_id,),
        )
        deleted = CounterLike()
        retained = CounterLike()
        table_by_type = {
            "identity_evidence": ("material_evidence", "id"),
            "property_evidence": (
                "material_property_evidence",
                "id",
            ),
            "certification": ("material_certifications", "id"),
        }

        def transfer_ownership(entity_type, entity_id, table=None, key=None):
            replacement = connection.execute(
                """
                SELECT import_batch_id
                  FROM import_entity_links
                 WHERE entity_type = ? AND entity_id = ?
                 ORDER BY import_batch_id
                 LIMIT 1
                """,
                (entity_type, str(entity_id)),
            ).fetchone()
            if not replacement:
                return False
            replacement_batch = replacement[0]
            connection.execute(
                """
                UPDATE import_entity_links
                   SET created_by_batch = CASE
                     WHEN import_batch_id = ? THEN 1 ELSE 0 END
                 WHERE entity_type = ? AND entity_id = ?
                """,
                (replacement_batch, entity_type, str(entity_id)),
            )
            if table and key:
                connection.execute(
                    f"UPDATE {table} SET import_batch_id = ? WHERE {key} = ?",
                    (replacement_batch, entity_id),
                )
            return True

        for entity_type in (
            "identity_evidence",
            "property_evidence",
            "certification",
        ):
            for link in [
                item for item in links if item["entity_type"] == entity_type
            ]:
                if not link["created_by_batch"]:
                    retained[entity_type] += 1
                    continue
                shared = connection.execute(
                    """
                    SELECT 1 FROM import_entity_links
                     WHERE entity_type = ? AND entity_id = ?
                    """,
                    (entity_type, link["entity_id"]),
                ).fetchone()
                if shared:
                    table, key = table_by_type[entity_type]
                    transfer_ownership(
                        entity_type, link["entity_id"], table, key
                    )
                    retained[entity_type] += 1
                    continue
                table, key = table_by_type[entity_type]
                connection.execute(
                    f"DELETE FROM {table} WHERE {key} = ?",
                    (link["entity_id"],),
                )
                deleted[entity_type] += 1

        for link in [
            item for item in links if item["entity_type"] == "source"
        ]:
            if not link["created_by_batch"]:
                retained["source"] += 1
                continue
            source_id = int(link["entity_id"])
            in_use = any(
                connection.execute(
                    f"SELECT 1 FROM {table} WHERE source_id = ? LIMIT 1",
                    (source_id,),
                ).fetchone()
                for table in (
                    "material_evidence",
                    "material_property_evidence",
                    "material_certifications",
                )
            )
            if in_use:
                transfer_ownership("source", source_id)
                replacement = connection.execute(
                    """
                    SELECT import_batch_id
                      FROM import_entity_links
                     WHERE entity_type = 'source' AND entity_id = ?
                       AND created_by_batch = 1
                    """,
                    (str(source_id),),
                ).fetchone()
                if replacement:
                    connection.execute(
                        """
                        UPDATE evidence_sources
                           SET created_by_batch_id = ?
                         WHERE source_id = ?
                        """,
                        (replacement[0], source_id),
                    )
                retained["source"] += 1
            else:
                connection.execute(
                    "DELETE FROM evidence_sources WHERE source_id = ?",
                    (source_id,),
                )
                deleted["source"] += 1

        material_links = [
            item
            for item in links
            if item["entity_type"] == "material"
            and item["created_by_batch"]
        ]
        for link in material_links:
            material_id = link["entity_id"]
            shared = connection.execute(
                """
                SELECT 1 FROM import_entity_links
                 WHERE entity_type = 'material' AND entity_id = ?
                """,
                (material_id,),
            ).fetchone()
            has_evidence = any(
                connection.execute(
                    f"SELECT 1 FROM {table} WHERE material_id = ? LIMIT 1",
                    (material_id,),
                ).fetchone()
                for table in (
                    "material_evidence",
                    "material_property_evidence",
                    "material_certifications",
                )
            )
            if shared or has_evidence:
                if shared:
                    transfer_ownership("material", material_id)
                    transfer_ownership(
                        "material_identity", material_id
                    )
                    replacement = connection.execute(
                        """
                        SELECT import_batch_id
                          FROM import_entity_links
                         WHERE entity_type = 'material'
                           AND entity_id = ?
                           AND created_by_batch = 1
                        """,
                        (material_id,),
                    ).fetchone()
                    if replacement:
                        connection.execute(
                            """
                            UPDATE real_material_identities
                               SET created_by_batch_id = ?
                             WHERE material_id = ?
                            """,
                            (replacement[0], material_id),
                        )
                retained["material"] += 1
            else:
                connection.execute(
                    "DELETE FROM real_material_identities WHERE material_id = ?",
                    (material_id,),
                )
                connection.execute(
                    "DELETE FROM materials WHERE material_id = ?",
                    (material_id,),
                )
                deleted["material"] += 1

        rolled_back_at = now_iso()
        report = {
            "status": "rolled_back",
            "importBatchId": batch_id,
            "rolledBackAt": rolled_back_at,
            "operator": clean_text(operator),
            "deleted": dict(deleted),
            "retainedBecauseSharedOrPreexisting": dict(retained),
        }
        connection.execute(
            """
            UPDATE import_batches
               SET status = 'rolled_back', rolled_back_at = ?, report_json = ?
             WHERE import_batch_id = ?
            """,
            (
                rolled_back_at,
                json.dumps(report, ensure_ascii=False, sort_keys=True),
                batch_id,
            ),
        )
        connection.commit()
        return report
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
