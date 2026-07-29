import sqlite3


SOURCE_TYPES = (
    "manufacturer",
    "official_datasheet",
    "academic",
    "distributor",
    "secondary_reference",
    "generated",
    "unknown",
)


def table_columns(connection, table):
    return {
        row[1]
        for row in connection.execute(f"PRAGMA table_info({table})")
    }


def add_column(connection, table, definition):
    name = definition.split()[0]
    if name not in table_columns(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def ensure_import_schema(connection):
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS import_batches (
          import_batch_id TEXT PRIMARY KEY,
          imported_at TEXT NOT NULL,
          input_file_hash TEXT NOT NULL,
          input_file_name TEXT NOT NULL,
          imported_record_count INTEGER NOT NULL,
          rejected_record_count INTEGER NOT NULL,
          operator TEXT,
          import_source TEXT,
          status TEXT NOT NULL,
          rolled_back_at TEXT,
          report_json TEXT NOT NULL,
          CHECK (status IN ('committed', 'rolled_back'))
        );

        CREATE TABLE IF NOT EXISTS evidence_sources (
          source_id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_fingerprint TEXT NOT NULL UNIQUE,
          source_type TEXT NOT NULL,
          source_title TEXT,
          source_url TEXT,
          source_date TEXT,
          manufacturer TEXT,
          brand TEXT,
          commercial_grade TEXT,
          material_family TEXT,
          created_by_batch_id TEXT,
          created_at TEXT NOT NULL,
          CHECK (source_type IN (
            'manufacturer', 'official_datasheet', 'academic', 'distributor',
            'secondary_reference', 'generated', 'unknown'
          ))
        );

        CREATE TABLE IF NOT EXISTS real_material_identities (
          material_id TEXT PRIMARY KEY,
          manufacturer TEXT NOT NULL,
          commercial_grade TEXT NOT NULL,
          material_family TEXT NOT NULL,
          manufacturer_key TEXT NOT NULL,
          commercial_grade_key TEXT NOT NULL,
          material_family_key TEXT NOT NULL,
          created_by_batch_id TEXT,
          created_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE CASCADE,
          CHECK (active IN (0, 1))
        );

        CREATE TABLE IF NOT EXISTS import_entity_links (
          import_batch_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          created_by_batch INTEGER NOT NULL,
          PRIMARY KEY (import_batch_id, entity_type, entity_id),
          FOREIGN KEY (import_batch_id)
            REFERENCES import_batches(import_batch_id) ON DELETE CASCADE,
          CHECK (created_by_batch IN (0, 1)),
          CHECK (entity_type IN (
            'material', 'material_identity', 'source', 'identity_evidence',
            'property_evidence', 'certification'
          ))
        );
        """
    )

    common_columns = (
        "source_id INTEGER REFERENCES evidence_sources(source_id)",
        "evidence_fingerprint TEXT",
        "import_batch_id TEXT",
        "imported_at TEXT",
        "evidence_version INTEGER NOT NULL DEFAULT 1",
    )
    for table in (
        "material_evidence",
        "material_property_evidence",
        "material_certifications",
    ):
        for definition in common_columns:
            add_column(connection, table, definition)

    for definition in (
        "conflict_group_id TEXT",
        "conflict_status TEXT NOT NULL DEFAULT 'none'",
    ):
        add_column(connection, "material_property_evidence", definition)

    for definition in (
        "record_type TEXT NOT NULL DEFAULT 'legacy'",
        "record_origin TEXT NOT NULL DEFAULT 'legacy'",
        "scope_status TEXT NOT NULL DEFAULT 'in_scope'",
        "catalog_visibility TEXT NOT NULL DEFAULT 'admin_only'",
    ):
        add_column(connection, "materials", definition)

    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    connection.execute(
        """
        UPDATE materials
           SET record_type = CASE
             WHEN EXISTS (
               SELECT 1 FROM real_material_identities identity_row
                WHERE identity_row.material_id = materials.material_id
                  AND identity_row.active = 1
             ) THEN 'commercial_grade'
             ELSE 'legacy'
           END
        """
    )
    generated_clauses = [
        """
        EXISTS (
          SELECT 1 FROM material_evidence identity_evidence
           WHERE identity_evidence.material_id = materials.material_id
             AND identity_evidence.source_type = 'generated'
        )
        """,
        """
        EXISTS (
          SELECT 1 FROM material_property_evidence property_evidence
           WHERE property_evidence.material_id = materials.material_id
             AND property_evidence.source_type = 'generated'
        )
        """,
    ]
    material_columns = table_columns(connection, "materials")
    if "translation_quality" in material_columns:
        generated_clauses.append(
            "LOWER(COALESCE(materials.translation_quality, '')) = 'generated'"
        )
    if "source_note" in material_columns:
        generated_clauses.append(
            "LOWER(COALESCE(materials.source_note, '')) LIKE '%generated%'"
        )
    if "material_sources" in tables:
        generated_clauses.append(
            """
            EXISTS (
              SELECT 1 FROM material_sources legacy_source
               WHERE legacy_source.material_id = materials.material_id
                 AND LOWER(COALESCE(legacy_source.source_type, ''))
                     LIKE '%generated%'
            )
            """
        )
    connection.execute(
        f"""
        UPDATE materials
           SET record_origin = CASE
             WHEN record_type = 'commercial_grade' THEN 'imported'
             WHEN {' OR '.join(generated_clauses)} THEN 'generated'
             ELSE 'legacy'
           END
        """
    )
    connection.execute(
        """
        UPDATE materials
           SET scope_status = CASE
             WHEN category IN ('Metals', 'Ceramics', 'Glasses')
               THEN 'out_of_scope'
             ELSE 'in_scope'
           END,
               catalog_visibility = CASE
             WHEN record_type = 'commercial_grade' THEN 'review'
             ELSE 'admin_only'
           END
        """
    )

    connection.executescript(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_active_hash
          ON import_batches(input_file_hash)
          WHERE status = 'committed';

        CREATE UNIQUE INDEX IF NOT EXISTS idx_real_material_identity_key
          ON real_material_identities(
            manufacturer_key, commercial_grade_key, material_family_key
          )
          WHERE active = 1;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_material_evidence_fingerprint
          ON material_evidence(evidence_fingerprint)
          WHERE evidence_fingerprint IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_property_evidence_fingerprint
          ON material_property_evidence(evidence_fingerprint)
          WHERE evidence_fingerprint IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_certification_fingerprint
          ON material_certifications(evidence_fingerprint)
          WHERE evidence_fingerprint IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_evidence_sources_url
          ON evidence_sources(source_url, source_type);

        CREATE INDEX IF NOT EXISTS idx_import_links_entity
          ON import_entity_links(entity_type, entity_id);

        CREATE INDEX IF NOT EXISTS idx_material_evidence_source
          ON material_evidence(source_id);

        CREATE INDEX IF NOT EXISTS idx_property_evidence_source
          ON material_property_evidence(source_id);

        CREATE INDEX IF NOT EXISTS idx_material_certifications_name
          ON material_certifications(material_id, certification_name);

        CREATE INDEX IF NOT EXISTS idx_materials_identity_lookup
          ON materials(manufacturer, grade_name, material_family);

        CREATE INDEX IF NOT EXISTS idx_materials_catalog_layer
          ON materials(
            record_type, catalog_visibility, scope_status, record_origin
          );
        """
    )
