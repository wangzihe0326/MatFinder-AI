"""Compatibility adapter only; the lifecycle contract owns all schema semantics."""
from migrate import classify_connection, inspect_database, load_contract


def require_current(result):
    if result["classification"] != "current" or not result["compatible"]:
        raise RuntimeError(
            "Formal current schema required before import; "
            f"{result['classification']}. Prepare a supported copy offline with scripts/migrate.py."
        )
    return result


def require_formal_schema(connection):
    return require_current(classify_connection(connection, load_contract()))


def preflight_database(path):
    # Read-only before any writable connection; refuses nonexistent/sidecar targets.
    return require_current(inspect_database(path))


def ensure_import_schema(connection):
    """Historical API name: validation only, no DDL, DML, commit or preparation."""
    return require_formal_schema(connection)
