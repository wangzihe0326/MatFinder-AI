"""Historical CLI alias for canonical offline preparation; explicit target only."""
import argparse
import json
from pathlib import Path
from migrate import prepare_database


def main():
    parser = argparse.ArgumentParser(description="Prepare an exact supported disposable copy using the canonical lifecycle.")
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare_database(args.database)))


if __name__ == "__main__":
    main()
