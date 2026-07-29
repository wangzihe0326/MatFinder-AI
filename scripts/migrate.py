import runpy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run(script, *arguments):
    previous_arguments = sys.argv
    try:
        sys.argv = [str(SCRIPTS / script), *arguments]
        runpy.run_path(str(SCRIPTS / script), run_name="__main__")
    finally:
        sys.argv = previous_arguments


def main():
    database = str(ROOT / "matfinder.db")
    run("migrate-evidence-schema.py", database)
    run("migrate-import-schema.py", database)
    run("migrate-catalog-layer.py", database)
    print("Schema migrations completed. npm start does not run this command.")


if __name__ == "__main__":
    main()
