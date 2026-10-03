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
const { inspectConnection } = require("./schema-contract");

const DEFAULT_PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 200;
const DETAIL_BATCH_SIZE = 30;
const READINESS_BATCH_SIZE = DETAIL_BATCH_SIZE;
const FAMILY_CODES = Object.freeze(["ABS", "PC", "PA66", "POM", "PP", "PEEK", "TPU"]);
const CATALOG_JOINS = `
  LEFT JOIN real_material_identities identity_row
    ON identity_row.material_id = m.material_id
   AND identity_row.active = 1
`;
const GRADE_TRIM_CHARACTERS = [
  9, 10, 11, 12, 13, 32, 160, 5760,
  ...Array.from({ length: 11 }, (_, index) => 8192 + index),
  8232, 8233, 8239, 8287, 12288, 65279
].map((codepoint) => `CHAR(${codepoint})`).join(" || ");
const EFFECTIVE_GRADE_SQL =
  `COALESCE(NULLIF(TRIM(m.grade_name, ${GRADE_TRIM_CHARACTERS}), ''), m.trade_name)`;

// These are the signals available in the existing compact public catalog, not
// the larger set of fields available on a material detail or audit record.
const CATALOG_EFFECTIVE_IDENTITY_FIELDS = [
  "m.name", "m.name_zh", "m.abbreviation", "m.family",
  "COALESCE(m.grade_name, m.trade_name)"
];
const CATALOG_IDENTITY_FIELDS = [...CATALOG_EFFECTIVE_IDENTITY_FIELDS, "m.trade_name"];
const CATALOG_BROAD_FIELDS = [
  ...CATALOG_IDENTITY_FIELDS,
  "m.category", "m.category_zh", "m.subcategory",
  "COALESCE(m.supplier_or_brand, m.manufacturer)", "m.manufacturer",
  "m.summary", "m.chemical_resistance",
  "COALESCE(m.flame_rating, m.flammability)", "m.electrical_insulation", "m.transparency",
  "m.flexibility", "m.waterproof_sealing", "m.flammability",
  "m.recyclability", "m.cost_level"
];
const CATALOG_SIGNAL_FIELDS = [
  "m.name", "m.name_zh", "m.abbreviation",
  "m.category", "m.category_zh", "m.subcategory",
  "m.family", EFFECTIVE_GRADE_SQL,
  "COALESCE(m.supplier_or_brand, m.manufacturer)", "m.summary",
  "COALESCE(m.flame_rating, m.flammability)", "m.electrical_insulation",
  "m.chemical_resistance", "m.transparency", "m.flexibility",
  "m.waterproof_sealing", "m.recyclability"
];

// Keep the current catalog facet IDs and keyword branches intact. Browser
// definitions remain in place until the separately reviewed frontend phase.
const PERFORMANCE_GROUPS = [
  { id: "thermal", options: [
    { id: "heat-resistant", signals: ["heat resistant", "high temperature", "thermal", "耐热", "高温"] },
    { id: "flame-retardant", signals: ["flame retardant", "fire resistant", "ul 94", "v-0", "noncombustible", "阻燃", "防火"] },
    { id: "low-temperature-resistant", signals: ["low temperature", "cryogenic", "cold resistant", "耐低温", "低温"] }
  ] },
  { id: "mechanical", options: [
    { id: "high-strength", signals: ["high strength", "reinforced", "structural", "高强度", "增强"] },
    { id: "high-toughness", signals: ["tough", "toughened", "high toughness", "韧性", "增韧"] },
    { id: "wear-resistant", signals: ["wear resistant", "abrasion resistant", "low friction", "bearing", "耐磨", "低摩擦"] },
    { id: "impact-resistant", signals: ["impact resistant", "impact modified", "energy absorption", "抗冲击", "抗冲"] }
  ] },
  { id: "chemical", options: [
    { id: "chemical-resistant", signals: ["chemical resistant", "chemical resistance", "good to excellent", "耐化学", "化工"] },
    { id: "acid-resistant", signals: ["acid resistant", "acid", "硫酸", "盐酸", "耐酸"] },
    { id: "alkali-resistant", signals: ["alkali resistant", "alkaline", "caustic", "耐碱", "碱"] },
    { id: "oil-resistant", signals: ["oil resistant", "fuel resistant", "hydrocarbon", "耐油", "燃油"] }
  ] },
  { id: "electrical", options: [
    { id: "electrical-insulation", signals: ["electrical insulation", "dielectric", "insulator", "connector", "电绝缘", "绝缘"] },
    { id: "high-dielectric", signals: ["high dielectric", "dielectric constant", "高介电"] },
    { id: "low-dielectric", signals: ["low dielectric", "rf", "radome", "低介电"] },
    { id: "conductive-antistatic", signals: ["conductive", "antistatic", "esd", "emi shielding", "导电", "防静电", "电磁屏蔽"] }
  ] },
  { id: "optical", options: [
    { id: "transparent", signals: ["transparent", "clear", "透明"] },
    { id: "optical-clarity", signals: ["optical", "lens", "light guide", "clarity", "光学", "透镜"] },
    { id: "uv-resistant", signals: ["uv resistant", "uv stabilized", "weather resistant", "抗紫外", "耐候"] }
  ] },
  { id: "sealing-elastomer", options: [
    { id: "elastomer", signals: ["elastomer", "rubber", "弹性体", "橡胶"] },
    { id: "flexible", signals: ["flexible", "soft", "flexibility", "柔性", "柔韧"] },
    { id: "waterproof-sealing", signals: ["waterproof", "sealing", "sealant", "gasket", "low moisture", "防水", "密封"] },
    { id: "gasket-seal", signals: ["gasket", "o-ring", "seal", "flange", "垫片", "密封圈"] }
  ] },
  { id: "sustainability", options: [
    { id: "recyclable", signals: ["recyclable", "recycling", "可回收"] },
    { id: "bio-based", signals: ["bio-based", "biobased", "renewable", "生物基"] },
    { id: "compostable", signals: ["compostable", "biodegradable", "可堆肥", "可降解"] },
    { id: "low-density-lightweight", signals: ["lightweight", "low density", "轻量", "低密度"] }
  ] }
];
const PERFORMANCE_OPTIONS = new Map(PERFORMANCE_GROUPS.flatMap((group) =>
  group.options.map((option) => [option.id, option])));
const PERFORMANCE_IDS = Object.freeze([...PERFORMANCE_OPTIONS.keys()]);
const PERFORMANCE_ALIASES = Object.freeze({
  "high-temp": "heat-resistant", strength: "high-strength",
  chemical: "chemical-resistant", sustainable: "recyclable",
  electrical: "electrical-insulation"
});
const DOMAIN_KEYWORDS = Object.freeze({
  automotive: ["automotive", "vehicle", "under-hood", "bumper", "interior trim", "fuel system", "mirror housings", "汽车", "车身", "内饰"],
  "ev-battery": ["ev battery", "battery", "battery pack", "battery packs", "cell", "thermal gap", "thermal interface", "fire barrier", "power electronics", "电池", "动力电池", "电池包"],
  electronics: ["electronics", "electronic", "electrical", "connector", "connectors", "circuit", "pcb", "semiconductor", "potting", "wire", "cable", "relay", "switch", "电气", "电子", "连接器", "半导体"],
  aerospace: ["aerospace", "aircraft", "radome", "satellite", "turbine", "rocket", "aircraft interiors", "flight", "航空", "航天", "飞机"],
  medical: ["medical", "healthcare", "biocompatible", "sterilizable", "surgical", "diagnostic", "implant", "medical devices", "医疗", "医用", "植入"],
  construction: ["construction", "building", "architectural", "roofing", "flooring", "window", "profiles", "pipe", "plumbing", "concrete", "建筑", "施工", "屋面", "管道"],
  "industrial-sealing": ["seal", "seals", "sealing", "gasket", "gaskets", "o-ring", "o-rings", "valve", "flange", "pump", "chemical seal", "weather seals", "密封", "垫片", "阀门", "泵"],
  "consumer-electronics": ["consumer electronics", "phone", "laptop", "tablet", "wearable", "display", "clear cover", "housings", "keyboard", "speaker", "消费电子", "手机", "显示"]
});
const DOMAIN_IDS = Object.freeze(Object.keys(DOMAIN_KEYWORDS));

const LIST_COLUMNS = `
  m.material_id,
  m.name,
  m.name_en,
  m.name_zh,
  m.abbreviation,
  m.material_family,
  m.grade_name,
  ${EFFECTIVE_GRADE_SQL} AS effective_grade_name,
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
      const error = new Error("SCHEMA_UNREADABLE: database file is missing; prepare the deployment artifact offline.");
      error.code = "SCHEMA_UNREADABLE";
      throw error;
    }
    this.databasePath = databasePath;
    try { this.databaseFileState = require("./catalog-stats-artifact").fileState(databasePath); }
    catch (cause) {
      const error = new Error("SCHEMA_UNREADABLE: database file is unreadable or unsupported; inspect it offline.");
      error.code = "SCHEMA_UNREADABLE";
      error.cause = cause;
      throw error;
    }
    this.metrics = {
      queries: 0,
      rowsReturned: 0,
      propertyEvidenceRowsRead: 0,
      maximumRowsInSingleQuery: 0,
      fullEvidenceTableReads: 0,
      recommendationRecallCalls: 0,
      recommendationBatches: 0,
      maximumRecommendationBatchSize: 0
    };
    this.readinessCache = null;
    this.catalogGeneration = null;
    this.ad08Statements = new Set();
    try {
      this.database = new DatabaseSync(databasePath, { readOnly: true });
      this.database.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA query_only = ON; PRAGMA foreign_keys = ON;"
      );
      // Every repository consumer crosses the gate before its first business query.
      this.checkSchema();
    } catch (error) {
      if (this.database) this.database.close();
      if (error.code?.startsWith("SCHEMA_")) throw error;
      const failure = new Error("SCHEMA_UNREADABLE: corrupt or unreadable database; inspect it offline.");
      failure.code = "SCHEMA_UNREADABLE";
      failure.cause = error;
      throw failure;
    }
  }

  checkSchema() {
    if (this.schemaInfo) return this.schemaInfo;
    const result = inspectConnection(this.database, this.databasePath);
    if (!result.compatible || result.classification !== "current") {
      const failures = {
        blank: ["SCHEMA_OFFLINE_PREPARATION", "database requires offline lifecycle preparation"],
        legacy_current: ["SCHEMA_OFFLINE_PREPARATION", "database requires offline lifecycle preparation"],
        future_version: ["SCHEMA_UNSUPPORTED_VERSION", "unsupported schema version"],
        version_mismatch: ["SCHEMA_UNSUPPORTED_VERSION", "unsupported schema version"],
        structural_drift: ["SCHEMA_STRUCTURAL_DRIFT", "database structure differs from the canonical contract"],
        unsupported: ["SCHEMA_UNSUPPORTED_STRUCTURE", "unsupported database structure; inspect it offline"]
      };
      const [code, message] = failures[result.classification] || ["SCHEMA_UNREADABLE", "corrupt or unreadable database"];
      const error = new Error(code + ": " + message);
      error.code = code;
      error.classification = result.classification;
      throw error;
    }
    this.schemaInfo = {
      compatible: true, classification: result.classification, version: result.userVersion,
      requiredTableCount: result.structure.tables.length,
      verifiedIndexes: result.structure.indexes.map(index => index.name)
    };
    return this.schemaInfo;
  }

  checkSearchIndexes() {
    // Operational metric only: definitions were already validated by the contract.
    return { verified: [...this.checkSchema().verifiedIndexes] };
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

  checkTechnicalHealth() {
    // Exercise the read-only connection and a required core table without a count scan.
    this._get("SELECT 1 AS available FROM materials LIMIT 1", [], "health");
  }

  hasReadyPublicCommercialGrade() {
    const now = Date.now();
    if (this.readinessCache && now < this.readinessCache.expiresAt) {
      return this.readinessCache.value;
    }
    let afterId = "";
    let value = false;
    while (true) {
      const candidateIds = this._all(
        `
          SELECT m.material_id
            FROM materials m
            JOIN real_material_identities identity_row
              ON identity_row.material_id = m.material_id
           WHERE ${PUBLIC_BOUNDARY}
             AND m.record_origin = 'imported'
             AND NULLIF(TRIM(identity_row.manufacturer), '') IS NOT NULL
             AND NULLIF(TRIM(identity_row.commercial_grade), '') IS NOT NULL
             AND NULLIF(TRIM(identity_row.material_family), '') IS NOT NULL
             AND m.material_id > ?
           ORDER BY m.material_id
           LIMIT ?
        `,
        [afterId, READINESS_BATCH_SIZE],
        "readiness_candidates"
      );
      if (!candidateIds.length) break;
      afterId = candidateIds[candidateIds.length - 1].material_id;
      const ids = candidateIds.map((row) => row.material_id);
      const rows = this._all(
        `
          SELECT ${LIST_COLUMNS}, NULL AS quality_level
            FROM materials m
            JOIN real_material_identities identity_row
              ON identity_row.material_id = m.material_id
           WHERE m.material_id IN (${placeholders(ids.length)})
        `,
        ids,
        "readiness_materials"
      );
      // The normal candidate path uses this same hydration and quality authority.
      value = this._hydrateDetailedRows(rows).some((material) =>
        material.data_quality.recommendation_eligible === true);
      if (value || candidateIds.length < READINESS_BATCH_SIZE) break;
    }
    // Bound public probe cost while still noticing offline data changes shortly after they occur.
    this.readinessCache = { value, expiresAt: Date.now() + 5_000 };
    return value;
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

  async initializeCatalogStats() {
    if (this.catalogStatsInitialized) return this.getCatalogGeneration();
    this.catalogStatsInitialized = true;
    const { verifyRuntimeArtifact } = require("./catalog-stats-artifact");
    let executedPolicy;
    try { executedPolicy = require("./catalog-policy").loadedPolicyDigest(module); }
    catch { return null; } // Unbound/preloaded code cannot claim a verified generation.
    this.catalogGeneration = await verifyRuntimeArtifact(this.databasePath, this.database, this.databaseFileState, executedPolicy);
    return this.getCatalogGeneration();
  }

  getCatalogGeneration() {
    return this.catalogGeneration?.current() || null;
  }

  getCatalogStats() {
    const generation = this.getCatalogGeneration();
    if (!generation) return null;
    return { ...this.catalogGeneration.artifact.aggregates,
      generation };
  }

  // Offline only: bounded keyset traversal, no retained catalog/eligible-ID array.
  buildCanonicalCatalogAggregates() {
    const aggregates = { polymerFamilies: this.getPolymerFamilyCount(),
      verifiedCommercialGrades: 0, verifiedPropertyDataPoints: 0,
      materialsAwaitingVerification: 0 };
    let lastId = null;
    let publicMaterialTotal = 0;
    for (;;) {
      const rows = this._readAd08Rows(`SELECT ${LIST_COLUMNS}, NULL AS quality_level
        FROM materials m ${CATALOG_JOINS}
        WHERE ${PUBLIC_BOUNDARY} AND (? IS NULL OR m.material_id > ?)
        ORDER BY m.material_id LIMIT ?`, [lastId, lastId, DETAIL_BATCH_SIZE], "ad08_batch");
      if (!rows.length) break;
      const materials = this._hydrateDetailedRows(rows, this._readAd08Rows.bind(this));
      publicMaterialTotal += materials.length;
      const eligibleIds = materials.filter((item) => item.data_quality.recommendation_eligible)
        .map((item) => item.id);
      aggregates.verifiedCommercialGrades += eligibleIds.length;
      aggregates.materialsAwaitingVerification += materials.length - eligibleIds.length;
      if (eligibleIds.length) aggregates.verifiedPropertyDataPoints += Number(this._get(`
        SELECT COUNT(*) AS count FROM material_property_evidence
        WHERE material_id IN (${placeholders(eligibleIds.length)})
          AND confidence_level IN ('high', 'medium')
          AND verification_status IN ('verified', 'partially_verified')
          AND source_type IN ('manufacturer', 'official_datasheet', 'academic', 'distributor')
          AND NULLIF(TRIM(source_title), '') IS NOT NULL
          AND (source_url LIKE 'http://%' OR source_url LIKE 'https://%')`, eligibleIds, "count").count);
      lastId = rows[rows.length - 1].material_id;
    }
    return { aggregates, publicMaterialTotal };
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
    if (options.audit === true) return this._listAuditMaterials(options);
    const generation = this.getCatalogGeneration();
    this.database.exec("BEGIN");
    try {
      const result = this._listPublicMaterials(options);
      this.database.exec("COMMIT");
      result.generation = generation && this.getCatalogGeneration() ? generation : null;
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  _listPublicMaterials(options) {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const offset = options.offset ?? 0;
    const predicate = buildPublicCatalogPredicate(options);
    const total = Number(this._get(
      `SELECT COUNT(DISTINCT m.material_id) AS count
         FROM materials m ${CATALOG_JOINS}
        WHERE ${predicate.sql}`,
      predicate.params, "catalog_count"
    )?.count || 0);
    const facets = this._catalogFacets(options);
    const order = buildCatalogOrder(options);
    const rows = this._all(
      `SELECT ${LIST_COLUMNS}, NULL AS quality_level
         FROM materials m ${CATALOG_JOINS}
        WHERE ${predicate.sql}
        ORDER BY ${order.sql}
        LIMIT ? OFFSET ?`,
      [...predicate.params, ...order.params, limit, offset], "material_list"
    );
    const hydrated = this._hydrateDetailedRows(rows, this._readAd08Rows.bind(this));
    const items = rows.map((row, index) => {
      const canonical = hydrated[index];
      const item = materialFromListRow({ ...row, quality_level: canonical.data_quality.level });
      item.data_quality = canonical.data_quality;
      for (const field of ["tags", "uses", "tags_en", "tags_zh", "applications_en", "applications_zh"])
        item[field] = canonical[field];
      return item;
    });
    return { items, total, limit, offset, hasMore: offset + limit < total, facets };
  }

  _listAuditMaterials(options) {
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

  _catalogFacets(options) {
    const categoryBase = buildPublicCatalogPredicate(options, "category");
    const categoryAll = Number(this._get(
      `SELECT COUNT(DISTINCT m.material_id) AS count
         FROM materials m ${CATALOG_JOINS} WHERE ${categoryBase.sql}`,
      categoryBase.params, "catalog_category_count"
    )?.count || 0);
    const categoryRows = this._all(
      `SELECT m.category AS value, COUNT(DISTINCT m.material_id) AS count
         FROM materials m ${CATALOG_JOINS}
        WHERE ${categoryBase.sql}
          AND NULLIF(TRIM(m.category), '') IS NOT NULL
        GROUP BY m.category
        ORDER BY count DESC, m.category ASC`,
      categoryBase.params, "catalog_categories"
    );
    return {
      categories: {
        all: categoryAll,
        options: categoryRows.map((row) => ({ value: row.value, count: Number(row.count) }))
      },
      performance: this._catalogOptionFacets(options, "performance"),
      domains: this._catalogOptionFacets(options, "domain")
    };
  }

  _catalogOptionFacets(options, dimension) {
    const base = buildPublicCatalogPredicate(options, dimension);
    const ids = dimension === "performance" ? PERFORMANCE_IDS : DOMAIN_IDS;
    const candidateFields = dimension === "performance" ? [
      "m.material_id", "m.max_temperature", "m.continuous_use_temperature",
      "m.glass_transition_temperature", "m.tensile_strength", "m.flexural_strength",
      "m.elongation", "m.chemical_resistance", "m.dielectric_constant",
      "m.category", "m.water_absorption", "m.recyclability", "m.density"
    ] : ["m.material_id"];
    const signal = dimension === "performance"
      ? catalogPerformanceSignalText() : catalogDomainSignalText();
    const predicates = ids.map((id) => dimension === "performance"
      ? buildPerformancePredicate(id, "m.catalog_signal")
      : buildDomainPredicate(id, "m.catalog_signal"));
    const flags = predicates.map((predicate, index) =>
      `CASE WHEN ${predicate.sql} THEN 1 ELSE 0 END AS flag${index}`);
    const sums = ids.map((id, index) =>
      `COALESCE(SUM(flag${index}), 0) AS option${index}`);
    const groupSums = dimension === "performance" ? PERFORMANCE_GROUPS.map((group, index) => {
      const flagsInGroup = group.options.map((option) =>
        `flag${ids.indexOf(option.id)} = 1`).join(" OR ");
      return `COALESCE(SUM(CASE WHEN ${flagsInGroup} THEN 1 ELSE 0 END), 0) AS group${index}`;
    }) : [];
    const row = this._get(
      `WITH candidates AS MATERIALIZED (
         SELECT ${candidateFields.join(", ")}, ${signal} AS catalog_signal
           FROM materials m ${CATALOG_JOINS}
          WHERE ${base.sql}
       ), flags AS MATERIALIZED (
         SELECT ${flags.join(", ")}
           FROM candidates m
       )
       SELECT COUNT(*) AS all_count, ${[...sums, ...groupSums].join(", ")}
         FROM flags`,
      [...base.params, ...predicates.flatMap((predicate) => predicate.params)],
      `catalog_${dimension}_facets`
    );
    const result = {
      all: Number(row?.all_count || 0),
      options: ids.flatMap((id, index) => {
        const count = Number(row?.[`option${index}`] || 0);
        return count > 0 ? [{ id, count }] : [];
      })
    };
    if (dimension === "performance") {
      result.groups = PERFORMANCE_GROUPS.flatMap((group, index) => {
        const count = Number(row?.[`group${index}`] || 0);
        return count > 0 ? [{ id: group.id, count }] : [];
      });
      return { all: result.all, groups: result.groups, options: result.options };
    }
    return result;
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

  getRecommendationCandidates() {
    this.metrics.recommendationRecallCalls += 1;
    // One explicit read transaction covers enumeration and every evidence read.
    // Keep only the compact universe; detailed objects live for one batch.
    this.database.exec("BEGIN");
    let iterator;
    // Node 22.13 iterators do not retain their StatementSync. Keep an explicit
    // strong owner until cursor cleanup and COMMIT/ROLLBACK have finished.
    const statementReferences = new Set();
    try {
      this.metrics.queries += 1;
      const statement = this.database.prepare(`
        SELECT m.material_id
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
      `);
      statementReferences.add(statement);
      iterator = statement.iterate();
      const candidates = [];
      let ids = [];
      for (const row of iterator) {
        this.metrics.rowsReturned += 1;
        this.metrics.maximumRowsInSingleQuery = Math.max(this.metrics.maximumRowsInSingleQuery, 1);
        ids.push(row.material_id);
        if (ids.length === DETAIL_BATCH_SIZE) {
          this._appendRecommendationBatch(ids, candidates);
          ids = [];
        }
      }
      if (ids.length) this._appendRecommendationBatch(ids, candidates);
      iterator.return();
      iterator = null;
      this.database.exec("COMMIT");
      return candidates;
    } catch (error) {
      // Close the cursor before releasing its transaction, including failures
      // after earlier batches have already produced compact candidates.
      try { iterator?.return(); } catch {}
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      statementReferences.clear();
    }
  }

  _appendRecommendationBatch(ids, candidates) {
    this.metrics.recommendationBatches += 1;
    this.metrics.maximumRecommendationBatchSize = Math.max(
      this.metrics.maximumRecommendationBatchSize, ids.length
    );
    const rows = this._all(`
      SELECT ${LIST_COLUMNS}
        FROM materials m
        JOIN real_material_identities identity_row
          ON identity_row.material_id = m.material_id
         AND identity_row.active = 1
       WHERE m.material_id IN (${placeholders(ids.length)})
    `, ids, "recommendation_materials");
    const byId = new Map(this._hydrateDetailedRows(rows).map((item) => [item.id, item]));
    if (byId.size !== ids.length) throw new Error("Incomplete recommendation batch");
    // IN queries need not preserve order. The cursor is the ordering authority.
    for (const id of ids) {
      const material = byId.get(id);
      if (!material) throw new Error("Missing recommendation material");
      candidates.push(recommendationCandidateFromMaterial(material));
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  close() {
    this.database.close();
  }

  _hydrateDetailedRows(rows, read = this._all.bind(this)) {
    const hydrated = [];
    for (const rowBatch of chunks(rows, DETAIL_BATCH_SIZE)) {
      const materials = rowBatch.map(materialFromListRow);
      const byId = new Map(materials.map((material) => [material.id, material]));
      this._attachTagsAndUses(materials, read);
      this._attachLegacySources(byId, read);
      this._attachEvidence(byId, read);
      for (const material of materials) {
        if (!material.evidence) material.evidence = buildLegacyEvidence(material);
        hydrated.push(annotateMaterialQuality(material));
      }
    }
    return hydrated;
  }

  _attachTagsAndUses(materials, read = this._all.bind(this)) {
    if (!materials.length) return;
    const byId = new Map(materials.map((material) => [material.id, material]));
    for (const idBatch of chunks([...byId.keys()], 100)) {
      const tags = read(
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
      const uses = read(
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

  _attachLegacySources(byId, read = this._all.bind(this)) {
    if (!byId.size) return;
    const ids = [...byId.keys()];
    const rows = read(
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

  _attachEvidence(byId, read = this._all.bind(this)) {
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
    const identityRows = read(
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

    const propertyRows = read(
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

    const certificationRows = read(
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

  _readAd08Rows(sql, params, tag, limit = 1000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Invalid AD-08 row limit");
    const statement = this.database.prepare(sql);
    this.ad08Statements.add(statement);
    let iterator;
    const rows = [];
    this.metrics.queries += 1;
    try {
      iterator = statement.iterate(...params);
      for (const row of iterator) {
        if (rows.length === limit) throw new Error("AD-08 bounded evidence read exceeded row limit");
        rows.push(row);
      }
      this.metrics.rowsReturned += rows.length;
      this.metrics.maximumRowsInSingleQuery = Math.max(this.metrics.maximumRowsInSingleQuery, rows.length);
      if (tag === "property_evidence") this.metrics.propertyEvidenceRowsRead += rows.length;
      return rows;
    } finally {
      try { iterator?.return?.(); } finally { this.ad08Statements.delete(statement); }
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
    grade_name: row.effective_grade_name,
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
    continuous_use_temperature: row.continuous_use_temperature,
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

// These are the property keys used by evidence-rules-v3. Quality is assessed
// BEFORE projection using ALL hydrated claims, including other property keys.
const RECOMMENDATION_PROPERTY_KEYS = Object.freeze([
  "continuous_use_temperature", "hdt", "tensile_strength", "impact_strength",
  "density", "transparency", "chemical_resistance", "flexibility",
  "flame_rating", "dielectric_constant", "water_absorption"
]);

function recommendationCandidateFromMaterial(material) {
  const candidate = {};
  // description_en/zh are the current recommendation card's text; retain them
  // without truncation. Other detail descriptions and import metadata are omitted.
  for (const field of [
    "id", "name", "name_en", "name_zh", "abbr", "category", "category_en",
    "category_zh", "summary", "description_en", "description_zh",
    "continuous_use_temperature", "record_type", "entityType",
    // Existing export limitations/fallbacks and alternative-material scores.
    // notes is the rendered selection note; import source_note remains excluded.
    "recyclable", "maxTemp", "tensile", "elongation", "density", "tg", "tm", "dielectric", "notes"
  ]) candidate[field] = material[field];
  for (const field of ["uses", "applications_en", "applications_zh", "disadvantages", "tags"])
    candidate[field] = [...material[field]];
  const quality = material.data_quality;
  candidate.data_quality = {
    level: quality.level,
    confidence_level: quality.confidence_level,
    verification_status: quality.verification_status,
    recommendation_eligible: quality.recommendation_eligible,
    reference_only: quality.reference_only,
    // Keep runtime rejection diagnostics without retaining the detailed evidence.
    issues: quality.issues.map((entry) => ({ ...entry }))
  };
  const properties = {};
  for (const key of RECOMMENDATION_PROPERTY_KEYS) {
    const claims = material.evidence.properties[key];
    if (!claims) continue;
    properties[key] = claims.map((claim) => ({
      propertyKey: claim.propertyKey,
      value: claim.value,
      unit: claim.unit,
      testStandard: claim.testStandard,
      testCondition: claim.testCondition,
      valueType: claim.valueType,
      verificationStatus: claim.verificationStatus,
      confidenceLevel: claim.confidenceLevel,
      conflictStatus: claim.conflictStatus,
      source: recommendationSource(claim.source)
    }));
  }
  candidate.evidence = {
    properties,
    certifications: material.evidence.certifications.map((claim) => ({
      certificationName: claim.certificationName,
      certificationStatus: claim.certificationStatus,
      scope: claim.scope,
      verificationStatus: claim.verificationStatus,
      confidenceLevel: claim.confidenceLevel,
      source: recommendationSource(claim.source)
    }))
  };
  return candidate;
}

function recommendationSource(source) {
  return {
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate: source.sourceDate
  };
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

function combinePredicates(operator, predicates) {
  if (!predicates.length) return { sql: "1 = 1", params: [] };
  return {
    sql: `(${predicates.map((predicate) => `(${predicate.sql})`).join(` ${operator} `)})`,
    params: predicates.flatMap((predicate) => predicate.params)
  };
}

function combinedText(fields) {
  return fields.map((field) => `COALESCE(CAST(${field} AS TEXT), '')`).join(" || ' ' || ");
}

function containsText(expression, value) {
  // SQLite LOWER handles the existing ASCII technical codes and literal CJK
  // text. It does not implement JavaScript's full Unicode case folding.
  return {
    sql: `LOWER(${expression}) LIKE ? ESCAPE '\\'`,
    params: [`%${escapeLike(value)}%`]
  };
}

function processingMethodContains(value) {
  const pattern = `%${escapeLike(value)}%`;
  const array = `CASE WHEN json_valid(m.processing_methods)
    THEN CASE WHEN json_type(m.processing_methods) = 'array'
      THEN m.processing_methods ELSE '[]' END
    ELSE '[]' END`;
  return {
    sql: `(EXISTS (
      SELECT 1 FROM json_each(${array}) method
       WHERE LOWER(CAST(method.value AS TEXT)) LIKE ? ESCAPE '\\'
    ) OR (
      NOT json_valid(m.processing_methods)
      AND LOWER(REPLACE(REPLACE(REPLACE(
        COALESCE(m.processing_methods, ''), ',', ' '), ';', ' '), '|', ' '))
        LIKE ? ESCAPE '\\'
    ))`,
    params: [pattern, pattern]
  };
}

function compactTextContains(fields, value, { tags = true, uses = true, methods = true } = {}) {
  const predicates = [containsText(combinedText(fields), value)];
  if (tags) predicates.push({
    sql: `EXISTS (SELECT 1 FROM material_tags tag
      WHERE tag.material_id = m.material_id
        AND LOWER(tag.tag) LIKE ? ESCAPE '\\')`,
    params: [`%${escapeLike(value)}%`]
  });
  if (uses) predicates.push({
    sql: `EXISTS (SELECT 1 FROM material_uses material_use
      WHERE material_use.material_id = m.material_id
        AND LOWER(material_use.use) LIKE ? ESCAPE '\\')`,
    params: [`%${escapeLike(value)}%`]
  });
  if (methods) predicates.push(processingMethodContains(value));
  return combinePredicates("OR", predicates);
}

function catalogOrderedTagsText() {
  return `(SELECT GROUP_CONCAT(tag.tag, ' ' ORDER BY tag.position)
    FROM material_tags tag WHERE tag.material_id = m.material_id AND tag.tag <> '')`;
}

function catalogOrderedUsesText() {
  return `(SELECT GROUP_CONCAT(material_use.use, ' ' ORDER BY material_use.position)
    FROM material_uses material_use
    WHERE material_use.material_id = m.material_id AND material_use.use <> '')`;
}

function catalogProcessingMethodsText() {
  return `CASE WHEN json_valid(m.processing_methods) THEN
    CASE WHEN json_type(m.processing_methods) = 'array' THEN
      (SELECT GROUP_CONCAT(CAST(method.value AS TEXT), ' '
        ORDER BY CAST(method.key AS INTEGER))
       FROM json_each(m.processing_methods) method
       WHERE method.type NOT IN ('null', 'false')
         AND NOT (method.type IN ('integer', 'real') AND method.value = 0)
         AND NOT (method.type = 'text' AND method.value = ''))
    ELSE NULL END
  ELSE REPLACE(REPLACE(REPLACE(COALESCE(m.processing_methods, ''),
    ',', ' '), ';', ' '), '|', ' ') END`;
}

function catalogVisibleText(parts) {
  return `CONCAT_WS(' ', ${parts.map((part) =>
    `NULLIF(CAST(${part} AS TEXT), '')`).join(", ")})`;
}

function normalizeCatalogWhitespace(expression) {
  let normalized = `REPLACE(REPLACE(REPLACE(${expression}, CHAR(9), ' '),
    CHAR(10), ' '), CHAR(13), ' ')`;
  // Thirty fixed passes cover runs up to 2^30 characters, beyond the usual
  // SQLite TEXT length limit, without an extension or per-character recursion.
  for (let pass = 0; pass < 30; pass += 1) {
    normalized = `REPLACE(${normalized}, '  ', ' ')`;
  }
  return `TRIM(${normalized})`;
}

function catalogPerformanceSignalText() {
  return catalogVisibleText([
    ...CATALOG_SIGNAL_FIELDS, catalogOrderedTagsText(), catalogOrderedUsesText(),
    catalogProcessingMethodsText()
  ]);
}

function catalogDomainSignalText() {
  return catalogVisibleText([catalogOrderedUsesText(), "m.summary"]);
}

function catalogBroadPhraseText() {
  // Keep the compact browser index order; aggregate only the current material.
  return normalizeCatalogWhitespace(catalogVisibleText([
    ...CATALOG_BROAD_FIELDS, catalogOrderedTagsText(), catalogOrderedUsesText(),
    catalogProcessingMethodsText()
  ]));
}

function identityComparison(value, kind) {
  const pattern = kind === "prefix" ? `${escapeLike(value)}%` :
    kind === "substring" ? `%${escapeLike(value)}%` : value;
  return combinePredicates("OR", CATALOG_IDENTITY_FIELDS.map((field) => ({
    sql: kind === "exact"
      ? `LOWER(TRIM(COALESCE(${field}, ''))) = ?`
      : `LOWER(TRIM(COALESCE(${field}, ''))) LIKE ? ESCAPE '\\'`,
    params: [pattern]
  })));
}

function identityToken(value) {
  if (!/^[a-z0-9]+$/.test(value)) return { sql: "0 = 1", params: [] };
  // JS catalog-search splits identity on non-ASCII-alphanumeric/non-CJK
  // characters. Padded GLOB boundaries prevent PC from matching NPC.
  const pattern = `*[^a-z0-9㐀-鿿]${value}[^a-z0-9㐀-鿿]*`;
  return combinePredicates("OR", CATALOG_IDENTITY_FIELDS.map((field) => ({
    sql: `(' ' || LOWER(COALESCE(${field}, '')) || ' ') GLOB ?`,
    params: [pattern]
  })));
}

function buildCatalogSearchWhere(query) {
  if (!query) return { sql: "1 = 1", params: [] };
  if (/^[a-z0-9+.-]{1,4}$/.test(query) && /[a-z]/.test(query)) {
    return combinePredicates("OR", [identityComparison(query, "exact"), identityToken(query)]);
  }
  return combinePredicates("AND", query.split(/\s+/).map((token) =>
    compactTextContains(CATALOG_BROAD_FIELDS, token)));
}

function knownNumeric(expression, comparison, threshold) {
  return {
    sql: `(typeof(${expression}) IN ('integer', 'real') AND ${expression} ${comparison} ?)`,
    params: [threshold]
  };
}

function recyclablePredicate() {
  const text = "LOWER(COALESCE(m.recyclability, ''))";
  return {
    sql: `((' ' || ${text} || ' ') GLOB '*[^a-z0-9_]recyclable[^a-z0-9_]*'
      AND INSTR(${text}, 'not typically recyclable') = 0)`,
    params: []
  };
}

function signalKeywords(keywords, signalExpression) {
  return combinePredicates("OR", keywords.map((keyword) =>
    containsText(signalExpression, keyword)));
}

function buildPerformancePredicate(id, signalExpression = catalogPerformanceSignalText()) {
  const option = PERFORMANCE_OPTIONS.get(id);
  if (!option) throw new RangeError(`Unknown catalog performance ID: ${id}`);
  const branches = [signalKeywords(option.signals, signalExpression)];
  switch (id) {
    case "heat-resistant": {
      const temperature = "CASE WHEN m.max_temperature IS NOT NULL THEN m.max_temperature ELSE m.continuous_use_temperature END";
      branches.push(knownNumeric(temperature, ">=", 150));
      break;
    }
    case "low-temperature-resistant":
      branches.push(knownNumeric("m.glass_transition_temperature", "<=", -30));
      break;
    case "high-strength":
      branches.push(knownNumeric("m.tensile_strength", ">=", 70));
      branches.push(knownNumeric("m.flexural_strength", ">=", 100));
      break;
    case "high-toughness":
      branches.push(knownNumeric("m.elongation", ">=", 80));
      break;
    case "acid-resistant":
    case "alkali-resistant":
      branches.push(combinePredicates("OR", ["excellent", "good", "resistant"].map(
        (word) => containsText("COALESCE(m.chemical_resistance, '')", word))));
      break;
    case "high-dielectric":
      branches.push(knownNumeric("m.dielectric_constant", ">=", 4));
      break;
    case "low-dielectric":
      branches.push(combinePredicates("AND", [
        knownNumeric("m.dielectric_constant", ">", 0),
        knownNumeric("m.dielectric_constant", "<=", 2.8)
      ]));
      break;
    case "elastomer":
      branches.push({
        sql: "m.category IN ('Elastomer', 'Elastomers', 'Rubber', 'Sealants')",
        params: []
      });
      break;
    case "flexible":
      branches.push(knownNumeric("m.elongation", ">=", 150));
      break;
    case "waterproof-sealing":
      branches.push(knownNumeric("m.water_absorption", "<=", 0.2));
      break;
    case "recyclable":
      branches.push(recyclablePredicate());
      break;
    case "low-density-lightweight":
      branches.push(combinePredicates("AND", [
        knownNumeric("m.density", ">", 0), knownNumeric("m.density", "<=", 1.2)
      ]));
      break;
  }
  return combinePredicates("OR", branches);
}

function buildDomainPredicate(id, signalExpression = catalogDomainSignalText()) {
  const keywords = DOMAIN_KEYWORDS[id];
  if (!keywords) throw new RangeError(`Unknown catalog domain ID: ${id}`);
  return combinePredicates("OR", keywords.map((keyword) =>
    containsText(signalExpression, keyword)));
}

function buildPublicCatalogPredicate(options, excludedDimension) {
  const predicates = [{ sql: PUBLIC_BOUNDARY, params: [] }];
  if (options.query) predicates.push(buildCatalogSearchWhere(options.query));
  if (excludedDimension !== "category" && options.category) {
    predicates.push({ sql: "m.category = ?", params: [options.category] });
  }
  if (excludedDimension !== "performance" && options.performance) {
    predicates.push(buildPerformancePredicate(options.performance));
  }
  if (excludedDimension !== "domain" && options.domain) {
    predicates.push(buildDomainPredicate(options.domain));
  }
  if (options.minTempC !== undefined) {
    predicates.push(knownNumeric("m.continuous_use_temperature", ">=", options.minTempC));
  }
  if (options.minTensileMpa !== undefined) {
    predicates.push(knownNumeric("m.tensile_strength", ">=", options.minTensileMpa));
  }
  if (options.recyclable === true) predicates.push(recyclablePredicate());
  return combinePredicates("AND", predicates);
}

function buildCatalogOrder(options) {
  const nameAndId = "LOWER(COALESCE(m.name, '')) ASC, m.material_id ASC";
  if (options.sort === "match" && options.query) {
    const relevance = [
      [100, identityComparison(options.query, "exact")],
      [60, identityToken(options.query)],
      [30, identityComparison(options.query, "prefix")],
      [15, identityComparison(options.query, "substring")],
      [5, containsText(catalogBroadPhraseText(), options.query)]
    ];
    return {
      sql: `${relevance.map(([score, predicate]) =>
        `(CASE WHEN ${predicate.sql} THEN ${score} ELSE 0 END)`).join(" + ")} DESC, ${nameAndId}`,
      params: relevance.flatMap(([, predicate]) => predicate.params)
    };
  }
  const numericSorts = {
    temperature: ["m.continuous_use_temperature", "DESC"],
    strength: ["m.tensile_strength", "DESC"],
    density: ["m.density", "ASC"]
  };
  if (numericSorts[options.sort]) {
    const [field, direction] = numericSorts[options.sort];
    const known = `typeof(${field}) IN ('integer', 'real')`;
    return {
      sql: `CASE WHEN ${known} THEN 0 ELSE 1 END ASC,
        CASE WHEN ${known} THEN ${field} ELSE NULL END ${direction}, ${nameAndId}`,
      params: []
    };
  }
  return { sql: nameAndId, params: [] };
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
  DOMAIN_IDS,
  FAMILY_CODES,
  MAX_PAGE_SIZE,
  MaterialRepository,
  PERFORMANCE_ALIASES,
  PERFORMANCE_IDS,
  buildPublicCatalogPredicate,
  buildSearchWhere,
  dataQualityFromLevel,
  materialFromListRow
};
