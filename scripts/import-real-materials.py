import argparse
import json
import sys
from pathlib import Path

from real_material_importer import (
    ImportValidationError,
    execute_import,
    rollback_import,
)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Transactionally import reviewed real-material JSON or roll back "
            "one import batch."
        )
    )
    parser.add_argument("--file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", metavar="IMPORT_BATCH_ID")
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "matfinder.db",
    )
    parser.add_argument("--operator")
    parser.add_argument("--source", dest="import_source")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    if bool(args.file) == bool(args.rollback):
        parser.error("Specify exactly one of --file or --rollback.")
    if args.rollback and args.dry_run:
        parser.error("--dry-run is only valid with --file.")

    try:
        if args.rollback:
            report = rollback_import(
                args.database.resolve(), args.rollback, args.operator
            )
        else:
            if not args.file.is_file():
                parser.error(f"Input file does not exist: {args.file}")
            report = execute_import(
                args.database.resolve(),
                args.file.resolve(),
                dry_run=args.dry_run,
                operator=args.operator,
                import_source=args.import_source,
            )
    except ImportValidationError as error:
        report = error.report
        rendered = json.dumps(report, ensure_ascii=False, indent=2)
        print(rendered)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(rendered + "\n", encoding="utf-8")
        raise SystemExit(2)

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    if report.get("status") == "rejected":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
