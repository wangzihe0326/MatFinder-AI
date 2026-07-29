const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const {
  buildLegacyEvidence,
  normalizeMaterialEvidenceRow,
  normalizePropertyEvidence,
  normalizeSourceType,
  normalizeVerificationStatus,
  normalizeConfidenceLevel,
  nullableText
} = require("./evidence-model");
const { annotateMaterialQuality } = require("./material-quality");

const DEFAULT_PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 200;
const DETAIL_BATCH_SIZE = 30;
const FAMILY_CODES = Object.freeze(["ABS", "PC", "PA66", "POM", "PP", "PEEK", "TPU"]);

const LIST_COLUMNS = `
  m.material_id,
  m.name,
  m.name_en,
  m.name_zh,
  m.abbreviation,
  m.material_family,
  m.grade_name,
  m.supplier_or_brand,
  m.category,
  m.category_en,
  m.category_zh,
  m.subcategory,
  m.state,
  m.family,
  m.manufacturer,
  m.trade_name,
  m.density,
  m.tensile_strength,
  m.flexural_strength,
  m.impact_strength,
  m.hardness,
  m.elongation,
  m.glass_transition_temperature,
  m.melting_temperature,
  m.max_temperature,
  m.continuous_use_temperature,
  m.thermal_conductivity,
  m.dielectric_constant,
  m.flame_rating,
  m.electrical_insulation,
  m.chemical_resistance,
  m.transparency,
  m.flexibility,
  m.waterproof_sealing,
  m.water_absorption,
  m.flammability,
  m.recyclability,
  m.cost_level,
  m.processing_methods,
  m.applications,
  m.applications_en,
  m.applications_zh,
  m.limitations,
  m.alternatives,
  m.source_note,
  m.typical_applications,
  m.advantages,
  m.disadvantages,
  m.tags_en,
  m.tags_zh,
  m.summary,
  m.description_en,
  m.description_zh,
  m.translation_quality,
  m.translation_status,
  m.notes,
  m.record_type,
  m.record_origin,
  m.scope_status,
  m.catalog_visibility,
  identity_row.manufacturer AS identity_manufacturer,
  identity_row.commercial_grade AS identity_commercial_grade,
  identity_row.material_family AS identity_material_family
`;

const PUBLIC_BOUNDARY = `
  m.record_type = 'commercial_grade'
  AND m.catalog_visibility IN ('public', 'review')
  AND m.scope_status <> 'out_of_scope'
  AND m.record_origin <> 'generated'
  AND identity_row.active = 1
  AND NOT EXISTS (
    SELECT 1
      FROM material_evidence blocked_identity
     WHERE blocked_identity.material_id = m.material_id
       AND (
         blocked_identity.source_type = 'generated'
         OR blocked_identity.verification_status = 'quarantined'
         OR blocked_identity.confidence_level = 'quarantined'
       )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM material_property_evidence blocked_property
     WHERE blocked_property.material_id = m.material_id
       AND (
         blocked_property.source_type = 'generated'
         OR blocked_property.verification_status = 'quarantined'
         OR blocked_property.confidence_level = 'quarantined'
       )
  )
`;

function qualityLevelSql() {
  return `
    CASE
      WHEN m.catalog_visibility = 'admin_only'
        OR m.record_origin = 'generated'
        OR identity_row.material_id IS NULL
        OR EXISTS (
          SELECT 1 FROM material_evidence quarantined_identity
           WHERE quarantined_identity.material_id = m.material_id
             AND (
               quarantined_identity.source_type = 'generated'
               OR quarantined_identity.verification_status = 'quarantined'
               OR quarantined_identity.confidence_level = 'quarantined'
             )
        )
        OR EXISTS (
          SELECT 1 FROM material_property_evidence quarantined_property
           WHERE quarantined_property.material_id = m.material_id
             AND (
               quarantined_property.source_type = 'generated'
               OR quarantined_property.verification_status = 'quarantined'
               OR quarantined_property.confidence_level = 'quarantined'
               OR quarantined_property.conflict_status = 'conflicting'
             )
        )
      THEN 'quarantined'
      WHEN EXISTS (
        SELECT 1 FROM material_evidence official_identity
         WHERE official_identity.material_id = m.material_id
           AND official_identity.source_type IN ('manufacturer', 'official_datasheet')
           AND official_identity.verification_status = 'verified'
           AND NULLIF(TRIM(official_identity.source_title), '') IS NOT NULL
           AND (
             official_identity.source_url LIKE 'http://%'
             OR official_identity.source_url LIKE 'https://%'
           )
      )
      AND 4 = (
        SELECT COUNT(DISTINCT complete_property.property_key)
          FROM material_property_evidence complete_property
         WHERE complete_property.material_id = m.material_id
           AND complete_property.property_key IN (
             'density', 'tensile_strength', 'hdt', 'continuous_use_temperature'
           )
           AND complete_property.source_type IN ('manufacturer', 'official_datasheet')
           AND complete_property.verification_status = 'verified'
           AND NULLIF(TRIM(complete_property.test_standard), '') IS NOT NULL
           AND NULLIF(TRIM(complete_property.test_condition), '') IS NOT NULL
           AND NULLIF(TRIM(complete_property.source_title), '') IS NOT NULL
           AND (
             complete_property.source_url LIKE 'http://%'
             OR complete_property.source_url LIKE 'https://%'
           )
      )
      THEN 'high'
      WHEN EXISTS (
        SELECT 1 FROM material_evidence reliable_identity
         WHERE reliable_identity.material_id = m.material_id
           AND reliable_identity.source_type IN (
             'manufacturer', 'official_datasheet', 'academic', 'distributor'
           )
           AND reliable_identity.verification_status IN ('verified', 'partially_verified')
           AND NULLIF(TRIM(reliable_identity.source_title), '') IS NOT NULL
           AND (
             reliable_identity.source_url LIKE 'http://%'
             OR reliable_identity.source_url LIKE 'https://%'
           )
      )
      AND 2 <= (
        SELECT COUNT(DISTINCT reliable_property.property_key)
          FROM material_property_evidence reliable_property
         WHERE reliable_property.material_id = m.material_id
           AND reliable_property.property_key IN (
             'density', 'tensile_strength', 'hdt', 'continuous_use_temperature'
           )
           AND reliable_property.source_type IN (
             'manufacturer', 'official_datasheet', 'academic', 'distributor'
           )
           AND reliable_property.verification_status IN ('verified', 'partially_verified')
           AND NULLIF(TRIM(reliable_property.source_title), '') IS NOT NULL
           AND (
             reliable_property.source_url LIKE 'http://%'
             OR reliable_property.source_url LIKE 'https://%'
           )
      )
      THEN 'medium'
      ELSE 'low'
    END
  `;
}

class MaterialRepository {
  constructor(databasePath) {
    if (!fs.existsSync(databasePath)) {
      throw new Error(
        `SQLite database was not found at ${databasePath}. Ensure matfinder.db is included in the deployment artifact.`
      );
    }
    this.databasePath = databasePath;
    this.metrics = {
      queries: 0,
      rowsReturned: 0,
      propertyEvidenceRowsRead: 0,
      maximumRowsInSingleQuery: 0,
      fullEvidenceTableReads: 0
    };
    this.database = new DatabaseSync(databasePath, {
      readOnly: true
    });
    this.database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA query_only = ON; PRAGMA foreign_keys = ON;"
    );
  }

  checkSchema() {
    const requiredTables = [
      "materials",
      "material_tags",
      "material_uses",
      "material_sources",
      "evidence_sources",
      "material_evidence",
      "material_property_evidence",
      "material_certifications",
      "real_material_identities"
    ];
    const rows = this._all(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${placeholders(requiredTables.length)})`,
      requiredTables,
      "schema"
    );
    const found = new Set(rows.map((row) => row.name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length) {
      throw new Error(
        `Database schema is not ready. Run npm run migrate. Missing: ${missing.join(", ")}`
      );
    }
    const version = Number(this._get("PRAGMA user_version", [], "schema")?.user_version || 0);
    return { version, requiredTableCount: requiredTables.length };
  }

  checkSearchIndexes() {
    const expected = [
      "idx_materials_catalog_layer",
      "idx_real_material_identity_key",
      "idx_material_evidence_material"
    ];
    const rows = this._all(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'index'
          AND name IN (${placeholders(expected.length)})`,
      expected,
      "schema"
    );
    const present = new Set(rows.map((row) => row.name));
    const missing = expected.filter((name) => !present.has(name));
    if (missing.length) {
      throw new Error(
        `Database search indexes are not ready. Run npm run migrate. Missing: ${missing.join(", ")}`
      );
    }
    return { verified: expected };
  }

  getDatabaseCounts() {
    return {
      materials: Number(
        this._get("SELECT COUNT(*) AS count FROM materials", [], "count")?.count || 0
      ),
      propertyEvidence: Number(
        this._get(
          "SELECT COUNT(*) AS count FROM material_property_evidence",
          [],
          "count"
        )?.count || 0
      )
    };
  }

  getPolymerFamilyCount() {
    const row = this._get(
      `
        SELECT COUNT(*) AS count
          FROM (
            SELECT UPPER(COALESCE(NULLIF(material_family, ''), NULLIF(family, ''), abbreviation)) AS family_code
              FROM materials
             WHERE UPPER(COALESCE(NULLIF(material_family, ''), NULLIF(family, ''), abbreviation))
                   IN (${placeholders(FAMILY_CODES.length)})
             GROUP BY UPPER(COALESCE(NULLIF(material_family, ''), NULLIF(family, ''), abbreviation))
            UNION
            SELECT value AS family_code
              FROM json_each(?)
             GROUP BY value
          )
      `,
      [...FAMILY_CODES, JSON.stringify(FAMILY_CODES)],
      "family"
    );
    return Number(row?.count || 0);
  }

  getCatalogStats() {
    const familyCount = this.getPolymerFamilyCount();
    const gradeRows = this._all(
      `
        SELECT m.material_id, ${qualityLevelSql()} AS quality_level
          FROM materials m
          JOIN real_material_identities identity_row
            ON identity_row.material_id = m.material_id
         WHERE ${PUBLIC_BOUNDARY}
      `,
      [],
      "catalog_stats"
    );
    const verifiedIds = gradeRows
      .filter((row) => ["high", "medium"].includes(row.quality_level))
      .map((row) => row.material_id);
    let verifiedPropertyDataPoints = 0;
    for (const idBatch of chunks(verifiedIds, 500)) {
      verifiedPropertyDataPoints += Number(
        this._get(
          `
            SELECT COUNT(*) AS count
              FROM material_property_evidence
             WHERE material_id IN (${placeholders(idBatch.length)})
               AND confidence_level IN ('high', 'medium')
               AND verification_status IN ('verified', 'partially_verified')
               AND source_type IN (
                 'manufacturer', 'official_datasheet', 'academic', 'distributor'
               )
               AND NULLIF(TRIM(source_title), '') IS NOT NULL
               AND (
                 source_url LIKE 'http://%'
                 OR source_url LIKE 'https://%'
               )
          `,
          idBatch,
          "count"
        )?.count || 0
      );
    }
    return {
      polymerFamilies: familyCount,
      verifiedCommercialGrades: verifiedIds.length,
      verifiedPropertyDataPoints,
      materialsAwaitingVerification: gradeRows.length - verifiedIds.length
    };
  }

  getAuditStats() {
    const row = this._get(
      `
        SELECT
          (SELECT COUNT(*) FROM materials WHERE record_type = 'legacy')
            AS legacy_material_records,
          (
            SELECT COUNT(*)
              FROM material_property_evidence property_evidence
              JOIN materials legacy_material
                ON legacy_material.material_id = property_evidence.material_id
             WHERE legacy_material.record_type = 'legacy'
          ) AS legacy_property_records,
          (SELECT COUNT(*) FROM materials WHERE record_origin = 'generated')
            AS generated_records,
          (
            SELECT COUNT(*) FROM material_evidence
             WHERE verification_status = 'quarantined'
                OR confidence_level = 'quarantined'
          ) + (
            SELECT COUNT(*) FROM material_property_evidence
             WHERE verification_status = 'quarantined'
                OR confidence_level = 'quarantined'
          ) + (
            SELECT COUNT(*) FROM material_certifications
             WHERE verification_status = 'quarantined'
                OR confidence_level = 'quarantined'
          ) AS quarantined_records,
          (
            SELECT COUNT(*)
              FROM materials material
             WHERE material.catalog_visibility = 'admin_only'
                OR material.record_origin = 'generated'
                OR EXISTS (
                  SELECT 1 FROM material_evidence identity_evidence
                   WHERE identity_evidence.material_id = material.material_id
                     AND (
                       identity_evidence.verification_status = 'quarantined'
                       OR identity_evidence.confidence_level = 'quarantined'
                     )
                )
                OR EXISTS (
                  SELECT 1 FROM material_property_evidence property_evidence
                   WHERE property_evidence.material_id = material.material_id
                     AND (
                       property_evidence.verification_status = 'quarantined'
                       OR property_evidence.confidence_level = 'quarantined'
                     )
                )
          ) AS quarantined_material_records,
          (SELECT COUNT(*) FROM materials WHERE scope_status = 'out_of_scope')
            AS out_of_scope_records
      `,
      [],
      "audit_stats"
    );
    return {
      legacyMaterialRecords: Number(row?.legacy_material_records || 0),
      legacyPropertyRecords: Number(row?.legacy_property_records || 0),
      generatedRecords: Number(row?.generated_records || 0),
      quarantinedRecords: Number(row?.quarantined_records || 0),
      quarantinedMaterialRecords: Number(row?.quarantined_material_records || 0),
      outOfScopeRecords: Number(row?.out_of_scope_records || 0)
    };
  }

  listMaterials(options = {}) {
    const audit = options.audit === true;
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(options.limit) || DEFAULT_PAGE_SIZE)
    );
    const offset = Math.max(0, Number(options.offset) || 0);
    const search = buildSearchWhere(options.query);
    const boundary = audit ? "1 = 1" : PUBLIC_BOUNDARY;
    const where = `${boundary} AND ${search.sql}`;
    const joins = `
      LEFT JOIN real_material_identities identity_row
        ON identity_row.material_id = m.material_id
       AND identity_row.active = 1
    `;
    const total = Number(
      this._get(
        `SELECT COUNT(*) AS count FROM materials m ${joins} WHERE ${where}`,
        search.params,
        "count"
      )?.count || 0
    );
    const exactQuery = String(options.query || "").trim().toLowerCase();
    const rows = this._all(
      `
        SELECT ${LIST_COLUMNS}, ${qualityLevelSql()} AS quality_level
          FROM materials m
          ${joins}
         WHERE ${where}
         ORDER BY
           CASE
             WHEN LOWER(COALESCE(m.abbreviation, '')) = ? THEN 0
             WHEN LOWER(COALESCE(m.material_family, '')) = ? THEN 1
             WHEN LOWER(COALESCE(m.grade_name, '')) = ? THEN 2
             ELSE 3
           END,
           LOWER(COALESCE(m.name, '')),
           m.material_id
         LIMIT ? OFFSET ?
      `,
      [...search.params, exactQuery, exactQuery, exactQuery, limit, offset],
      "material_list"
    );
    const items = rows.map(materialFromListRow);
    this._attachTagsAndUses(items);
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }

  getMaterialById(materialId, options = {}) {
    const boundary = options.audit === true ? "1 = 1" : PUBLIC_BOUNDARY;
    const row = this._get(
      `
        SELECT ${LIST_COLUMNS}, ${qualityLevelSql()} AS quality_level
          FROM materials m
          LEFT JOIN real_material_identities identity_row
            ON identity_row.material_id = m.material_id
           AND identity_row.active = 1
         WHERE m.material_id = ?
           AND ${boundary}
         LIMIT 1
      `,
      [materialId],
      "material_detail"
    );
    if (!row) return null;
    return this._hydrateDetailedRows([row])[0] || null;
  }

  getRecommendationCandidates(options = {}) {
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.limit) || 100));
    const rows = this._all(
      `
        SELECT ${LIST_COLUMNS}, ${qualityLevelSql()} AS quality_level
          FROM materials m
          JOIN real_material_identities identity_row
            ON identity_row.material_id = m.material_id
           AND identity_row.active = 1
         WHERE ${PUBLIC_BOUNDARY}
         ORDER BY
           CASE ${qualityLevelSql()}
             WHEN 'high' THEN 0
             WHEN 'medium' THEN 1
             ELSE 2
           END,
           m.material_id
         LIMIT ?
      `,
      [limit],
      "recommendation_candidates"
    );
    return this._hydrateDetailedRows(rows);
  }

  getMetrics() {
    return { ...this.metrics };
  }

  close() {
    this.database.close();
  }

  _hydrateDetailedRows(rows) {
    const hydrated = [];
    for (const rowBatch of chunks(rows, DETAIL_BATCH_SIZE)) {
      const materials = rowBatch.map(materialFromListRow);
      const byId = new Map(materials.map((material) => [material.id, material]));
      this._attachTagsAndUses(materials);
      this._attachLegacySources(byId);
      this._attachEvidence(byId);
      for (const material of materials) {
        if (!material.evidence) material.evidence = buildLegacyEvidence(material);
        hydrated.push(annotateMaterialQuality(material));
      }
    }
    return hydrated;
  }

  _attachTagsAndUses(materials) {
    if (!materials.length) return;
    const byId = new Map(materials.map((material) => [material.id, material]));
    for (const idBatch of chunks([...byId.keys()], 100)) {
      const tags = this._all(
        `
          SELECT material_id, tag
            FROM material_tags
           WHERE material_id IN (${placeholders(idBatch.length)})
           ORDER BY material_id, position
        `,
        idBatch,
        "material_tags"
      );
      for (const row of tags) byId.get(row.material_id)?.tags.push(row.tag);
      const uses = this._all(
        `
          SELECT material_id, use
            FROM material_uses
           WHERE material_id IN (${placeholders(idBatch.length)})
           ORDER BY material_id, position
        `,
        idBatch,
        "material_uses"
      );
      for (const row of uses) byId.get(row.material_id)?.uses.push(row.use);
    }
    for (const material of materials) {
      if (!material.tags_en.length) material.tags_en = [...material.tags];
      if (!material.tags_zh.length) material.tags_zh = [...material.tags];
      if (!material.applications_en.length) material.applications_en = [...material.applications];
      if (!material.applications_zh.length) material.applications_zh = [...material.applications];
    }
  }

  _attachLegacySources(byId) {
    if (!byId.size) return;
    const ids = [...byId.keys()];
    const rows = this._all(
      `
        SELECT material_id, source_title, source_url, source_type, notes
          FROM material_sources
         WHERE material_id IN (${placeholders(ids.length)})
         ORDER BY material_id, id
      `,
      ids,
      "material_sources"
    );
    for (const row of rows) {
      byId.get(row.material_id)?.sources.push({
        source_title: row.source_title,
        source_url: row.source_url,
        source_type: row.source_type,
        notes: row.notes
      });
    }
  }

  _attachEvidence(byId) {
    if (!byId.size) return;
    for (const material of byId.values()) {
      material.evidence = {
        identity: {
          manufacturer: null,
          brand: null,
          commercialGrade: null,
          materialFamily: material.material_family || material.family || null,
          verificationStatus: "unverified",
          confidenceLevel: "low",
          lastVerifiedAt: null,
          sources: []
        },
        properties: {},
        certifications: []
      };
    }
    const ids = [...byId.keys()];
    const sourceFields = `
      COALESCE(normalized_source.source_type, evidence_row.source_type) AS source_type,
      COALESCE(normalized_source.source_title, evidence_row.source_title) AS source_title,
      COALESCE(normalized_source.source_url, evidence_row.source_url) AS source_url,
      COALESCE(normalized_source.source_date, evidence_row.source_date) AS source_date,
      COALESCE(normalized_source.manufacturer, evidence_row.manufacturer) AS manufacturer,
      COALESCE(normalized_source.brand, evidence_row.brand) AS brand,
      COALESCE(normalized_source.commercial_grade, evidence_row.commercial_grade) AS commercial_grade,
      COALESCE(normalized_source.material_family, evidence_row.material_family) AS material_family
    `;
    const identityRows = this._all(
      `
        SELECT
          evidence_row.material_id,
          evidence_row.verification_status,
          evidence_row.confidence_level,
          evidence_row.last_verified_at,
          evidence_row.notes,
          evidence_row.evidence_version,
          evidence_row.import_batch_id,
          evidence_row.imported_at,
          ${sourceFields}
          FROM material_evidence evidence_row
          LEFT JOIN evidence_sources normalized_source
            ON normalized_source.source_id = evidence_row.source_id
         WHERE evidence_row.material_id IN (${placeholders(ids.length)})
         ORDER BY evidence_row.material_id, evidence_row.id
      `,
      ids,
      "identity_evidence"
    );
    for (const row of identityRows) {
      const material = byId.get(row.material_id);
      if (!material) continue;
      const normalized = normalizeMaterialEvidenceRow(row);
      const identity = material.evidence.identity;
      identity.manufacturer ??= normalized.manufacturer;
      identity.brand ??= normalized.brand;
      identity.commercialGrade ??= normalized.commercialGrade;
      identity.materialFamily ??= normalized.materialFamily;
      identity.verificationStatus = strongestVerificationStatus(
        identity.verificationStatus,
        normalized.verificationStatus
      );
      identity.confidenceLevel = strongestConfidenceLevel(
        identity.confidenceLevel,
        normalized.confidenceLevel
      );
      identity.lastVerifiedAt = latestIsoDate(
        identity.lastVerifiedAt,
        normalized.lastVerifiedAt
      );
      identity.sources.push(normalized);
    }

    const propertyRows = this._all(
      `
        SELECT
          evidence_row.material_id,
          evidence_row.property_key,
          evidence_row.value_numeric,
          evidence_row.value_text,
          evidence_row.unit,
          evidence_row.test_standard,
          evidence_row.test_condition,
          evidence_row.value_type,
          evidence_row.verification_status,
          evidence_row.confidence_level,
          evidence_row.last_verified_at,
          evidence_row.evidence_version,
          evidence_row.conflict_group_id,
          evidence_row.conflict_status,
          evidence_row.import_batch_id,
          evidence_row.imported_at,
          ${sourceFields}
          FROM material_property_evidence evidence_row
          LEFT JOIN evidence_sources normalized_source
            ON normalized_source.source_id = evidence_row.source_id
         WHERE evidence_row.material_id IN (${placeholders(ids.length)})
         ORDER BY evidence_row.material_id, evidence_row.property_key,
                  evidence_row.position, evidence_row.evidence_version
      `,
      ids,
      "property_evidence"
    );
    for (const row of propertyRows) {
      const material = byId.get(row.material_id);
      if (!material) continue;
      const claim = normalizePropertyEvidence(row, material.evidence.identity);
      material.evidence.properties[claim.propertyKey] ||= [];
      material.evidence.properties[claim.propertyKey].push(claim);
    }

    const certificationRows = this._all(
      `
        SELECT
          evidence_row.material_id,
          evidence_row.certification_name,
          evidence_row.certification_status,
          evidence_row.scope,
          evidence_row.verification_status,
          evidence_row.confidence_level,
          evidence_row.last_verified_at,
          evidence_row.evidence_version,
          evidence_row.import_batch_id,
          evidence_row.imported_at,
          COALESCE(normalized_source.source_type, evidence_row.source_type) AS source_type,
          COALESCE(normalized_source.source_title, evidence_row.source_title) AS source_title,
          COALESCE(normalized_source.source_url, evidence_row.source_url) AS source_url,
          COALESCE(normalized_source.source_date, evidence_row.source_date) AS source_date,
          normalized_source.manufacturer AS manufacturer,
          normalized_source.brand AS brand,
          normalized_source.commercial_grade AS commercial_grade,
          normalized_source.material_family AS material_family
          FROM material_certifications evidence_row
          LEFT JOIN evidence_sources normalized_source
            ON normalized_source.source_id = evidence_row.source_id
         WHERE evidence_row.material_id IN (${placeholders(ids.length)})
         ORDER BY evidence_row.material_id, evidence_row.id
      `,
      ids,
      "certification_evidence"
    );
    for (const row of certificationRows) {
      const material = byId.get(row.material_id);
      if (!material) continue;
      material.evidence.certifications.push({
        certificationName: nullableText(row.certification_name),
        certificationStatus: nullableText(row.certification_status) || "unknown",
        scope: nullableText(row.scope),
        sourceType: normalizeSourceType(row.source_type),
        sourceTitle: nullableText(row.source_title),
        sourceUrl: nullableText(row.source_url),
        sourceDate: nullableText(row.source_date),
        verificationStatus: normalizeVerificationStatus(row.verification_status),
        confidenceLevel: normalizeConfidenceLevel(row.confidence_level),
        lastVerifiedAt: nullableText(row.last_verified_at),
        evidenceVersion: Number(row.evidence_version || 1),
        importBatchId: nullableText(row.import_batch_id),
        importedAt: nullableText(row.imported_at),
        source: {
          sourceType: normalizeSourceType(row.source_type),
          sourceTitle: nullableText(row.source_title),
          sourceUrl: nullableText(row.source_url),
          sourceDate: nullableText(row.source_date)
        }
      });
    }
  }

  _get(sql, params, tag) {
    this.metrics.queries += 1;
    const row = this.database.prepare(sql).get(...params);
    if (row) {
      this.metrics.rowsReturned += 1;
      this.metrics.maximumRowsInSingleQuery = Math.max(
        this.metrics.maximumRowsInSingleQuery,
        1
      );
    }
    return row;
  }

  _all(sql, params, tag) {
    this.metrics.queries += 1;
    const rows = this.database.prepare(sql).all(...params);
    this.metrics.rowsReturned += rows.length;
    this.metrics.maximumRowsInSingleQuery = Math.max(
      this.metrics.maximumRowsInSingleQuery,
      rows.length
    );
    if (tag === "property_evidence") {
      this.metrics.propertyEvidenceRowsRead += rows.length;
    }
    if (
      tag === "property_evidence" &&
      !/\bmaterial_id\s+IN\s*\(/i.test(sql) &&
      !/\bmaterial_id\s*=\s*\?/i.test(sql)
    ) {
      this.metrics.fullEvidenceTableReads += 1;
    }
    if (rows.length > 1_000 && tag !== "schema") {
      throw new Error(
        `Query '${tag}' returned ${rows.length} rows; the maximum batch size is 1000.`
      );
    }
    return rows;
  }
}

function materialFromListRow(row) {
  const material = {
    id: row.material_id,
    material_id: row.material_id,
    name: row.name,
    name_en: row.name_en ?? row.name,
    name_zh: row.name_zh ?? row.name,
    abbr: row.abbreviation,
    abbreviation: row.abbreviation,
    material_family: row.material_family ?? row.family,
    grade_name: row.grade_name ?? row.trade_name ?? null,
    supplier_or_brand: row.supplier_or_brand ?? row.manufacturer ?? null,
    category: row.category,
    category_en: row.category_en ?? row.category,
    category_zh: row.category_zh ?? row.category,
    subcategory: row.subcategory,
    state: row.state,
    family: row.family,
    manufacturer: row.manufacturer,
    trade_name: row.trade_name,
    density: row.density,
    tensile_strength: row.tensile_strength,
    tensile: row.tensile_strength,
    flexural_strength: row.flexural_strength,
    impact_strength: row.impact_strength,
    hardness: row.hardness,
    elongation: row.elongation,
    tg: row.glass_transition_temperature,
    glass_transition_temperature: row.glass_transition_temperature,
    tm: row.melting_temperature,
    melting_temperature: row.melting_temperature,
    maxTemp: row.max_temperature ?? row.continuous_use_temperature,
    max_temperature: row.max_temperature ?? row.continuous_use_temperature,
    continuous_use_temperature: row.continuous_use_temperature ?? row.max_temperature,
    thermal_conductivity: row.thermal_conductivity,
    dielectric: row.dielectric_constant,
    dielectric_constant: row.dielectric_constant,
    flame_rating: row.flame_rating ?? row.flammability,
    electrical_insulation: row.electrical_insulation,
    chemical_resistance: row.chemical_resistance,
    transparency: row.transparency,
    flexibility: row.flexibility,
    waterproof_sealing: row.waterproof_sealing,
    water_absorption: row.water_absorption,
    flammability: row.flammability,
    recyclability: row.recyclability,
    recyclable: isRecyclable(row.recyclability),
    cost_level: row.cost_level,
    processing_methods: parseJsonList(row.processing_methods),
    applications: parseJsonList(row.applications),
    applications_en: parseJsonList(row.applications_en ?? row.applications),
    applications_zh: parseJsonList(row.applications_zh ?? row.applications),
    limitations: parseJsonList(row.limitations),
    alternatives: parseJsonList(row.alternatives),
    source_note: row.source_note,
    typical_applications: parseJsonList(row.typical_applications),
    advantages: parseJsonList(row.advantages),
    disadvantages: parseJsonList(row.disadvantages),
    tags_en: parseJsonList(row.tags_en),
    tags_zh: parseJsonList(row.tags_zh),
    tags: [],
    features: [],
    uses: [],
    sources: [],
    summary: row.summary,
    description: row.summary,
    description_en: row.description_en ?? row.summary,
    description_zh: row.description_zh ?? row.summary,
    translation_quality: row.translation_quality ?? row.translation_status ?? "partial",
    translation_status: row.translation_status ?? "partial",
    notes: row.notes,
    record_type: row.record_type ?? "legacy",
    record_origin: row.record_origin ?? "legacy",
    scope_status: row.scope_status ?? "in_scope",
    catalog_visibility: row.catalog_visibility ?? "admin_only",
    entityType: row.record_type === "commercial_grade" ? "commercial_grade" : "legacy_record",
    evidence: {
      identity: {
        manufacturer: row.identity_manufacturer ?? null,
        brand: row.trade_name ?? row.supplier_or_brand ?? null,
        commercialGrade: row.identity_commercial_grade ?? null,
        materialFamily: row.identity_material_family ?? row.material_family ?? null,
        verificationStatus: qualityVerificationStatus(row.quality_level),
        confidenceLevel: row.quality_level || "low",
        lastVerifiedAt: null,
        sources: []
      },
      properties: {},
      certifications: []
    },
    data_quality: dataQualityFromLevel(row.quality_level)
  };
  material.features = material.tags;
  return material;
}

function dataQualityFromLevel(level) {
  const normalized = ["high", "medium", "low", "quarantined"].includes(level)
    ? level
    : "low";
  return {
    level: normalized,
    confidence_level: normalized,
    verification_status: qualityVerificationStatus(normalized),
    recommendation_eligible: normalized === "high" || normalized === "medium",
    reference_only: normalized === "low",
    factory_ready: normalized === "high",
    issues: []
  };
}

function qualityVerificationStatus(level) {
  if (level === "high") return "verified";
  if (level === "medium") return "partially_verified";
  if (level === "quarantined") return "quarantined";
  return "unverified";
}

function buildSearchWhere(queryValue) {
  const query = String(queryValue || "").trim().toLowerCase();
  if (!query) return { sql: "1 = 1", params: [] };
  const identityToken = /^[a-z0-9][a-z0-9/+.-]{0,11}$/i.test(query);
  if (identityToken) {
    return {
      sql: `
        (
          LOWER(COALESCE(m.abbreviation, '')) = ?
          OR LOWER(COALESCE(m.material_family, '')) = ?
          OR LOWER(COALESCE(m.family, '')) = ?
          OR LOWER(COALESCE(m.grade_name, '')) = ?
          OR LOWER(COALESCE(m.trade_name, '')) = ?
          OR (
            ' ' || LOWER(
              REPLACE(REPLACE(REPLACE(COALESCE(m.name, ''), '/', ' '), '-', ' '), '_', ' ')
            ) || ' '
          ) LIKE ?
        )
      `,
      params: [query, query, query, query, query, `% ${escapeLike(query)} %`]
    };
  }
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const tokenSql = tokens.map(() => `
    LOWER(
      COALESCE(m.name, '') || ' ' ||
      COALESCE(m.name_en, '') || ' ' ||
      COALESCE(m.name_zh, '') || ' ' ||
      COALESCE(m.abbreviation, '') || ' ' ||
      COALESCE(m.material_family, '') || ' ' ||
      COALESCE(m.grade_name, '') || ' ' ||
      COALESCE(m.trade_name, '') || ' ' ||
      COALESCE(m.summary, '')
    ) LIKE ? ESCAPE '\\'
  `);
  return {
    sql: `(${tokenSql.join(" AND ")})`,
    params: tokens.map((token) => `%${escapeLike(token)}%`)
  };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    return String(value)
      .split(/\s*[;,|]\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isRecyclable(value) {
  return /\brecyclable\b/i.test(String(value || "")) &&
    !/not typically recyclable/i.test(String(value || ""));
}

function strongestVerificationStatus(left, right) {
  const rank = {
    unverified: 0,
    partially_verified: 1,
    verified: 2,
    quarantined: 3
  };
  return rank[right] > rank[left] ? right : left;
}

function strongestConfidenceLevel(left, right) {
  const rank = { low: 0, medium: 1, high: 2, quarantined: 3 };
  return rank[right] > rank[left] ? right : left;
}

function latestIsoDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return String(right) > String(left) ? right : left;
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  FAMILY_CODES,
  MAX_PAGE_SIZE,
  MaterialRepository,
  buildSearchWhere,
  dataQualityFromLevel,
  materialFromListRow
};
