// FA-003P property-projection-v1. Evidence is authority; no storage/HTTP/DOM owner.
const POLICY_VERSION = "property-projection-v1";
const PROPERTIES = Object.freeze({
  density: Object.freeze({ unit: "g/cm3", units: Object.freeze(["g/cm3", "kg/m3"]), sort: "ASC" }),
  tensile_strength: Object.freeze({ unit: "MPa", units: Object.freeze(["MPa", "GPa"]), sort: "DESC" }),
  hdt: Object.freeze({ unit: "degC", units: Object.freeze(["degC", "K"]), genericKey: false }),
  continuous_use_temperature: Object.freeze({ unit: "degC", units: Object.freeze(["degC", "K"]), sort: "DESC" })
});
const PROPERTY_KEYS = Object.freeze(Object.keys(PROPERTIES));
const RELIABLE_SOURCES = Object.freeze(["manufacturer", "official_datasheet", "academic", "distributor"]);
const USABLE_TYPES = Object.freeze(["typical", "minimum", "maximum"]);
const MAX_CONTEXT_PREVIEW = 12;
const MAX_SUPPORT_PREVIEW = 8;
const normalizeContext = value => String(value ?? "").replace(/^ +| +$/g, "")
  .replace(/[A-Z]/g, letter => letter.toLowerCase());
const binaryCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// One eligibility definition, evaluated by two small adapters. SQL does not carry
// a separately maintained copy of source/confidence/unit/verification policy.
function eligibilityRules(a, f) {
  const propertyRules = Object.entries(PROPERTIES);
  return [
    ["E", "quarantined", a.or(a.eq(f.source_type, "generated"),
      a.eq(f.verification_status, "quarantined"), a.eq(f.confidence_level, "quarantined"))],
    ["D", "conflicting", a.eq(f.conflict_status, "conflicting")],
    ["F", "unusable_claim", a.or(a.not(a.eq(f.relation_ok, 1)), a.not(a.eq(f.source_ok, 1)),
      a.not(a.finite(f.value_numeric)), a.not(a.oneOf(f.property_key, PROPERTY_KEYS)),
      a.not(a.oneOf(a.coalesce(f.conflict_status, "none"), ["none", ""])),
      a.not(a.oneOf(a.coalesce(f.verification_status, "unknown"), ["verified", "partially_verified", "unverified", "unknown", "quarantined"])),
      a.not(a.oneOf(a.coalesce(f.confidence_level, "unknown"), ["high", "medium", "low", "unknown", "quarantined"])),
      a.not(a.oneOf(a.coalesce(f.value_type, "unknown"), [...USABLE_TYPES, "estimated", "unknown"])),
      a.not(a.or(...propertyRules.map(([key, spec]) => a.and(a.eq(f.property_key, key), a.oneOf(f.unit, spec.units))))),
      a.and(a.eq(f.property_key, "density"), a.not(a.gt(f.value_numeric, 0))),
      a.and(a.eq(f.property_key, "tensile_strength"), a.lt(f.value_numeric, 0)),
      a.and(a.oneOf(f.property_key, ["hdt", "continuous_use_temperature"]), a.eq(f.unit, "degC"), a.lt(f.value_numeric, -273.15)))],
    ["C", "unsupported_unit", a.not(a.or(...propertyRules.map(([key, spec]) =>
      a.and(a.eq(f.property_key, key), a.eq(f.unit, spec.unit)))))],
    ["C", "reference_only", a.or(a.not(a.oneOf(f.source_type, RELIABLE_SOURCES)),
      a.blank(f.source_title), a.not(a.http(f.source_url)), a.blank(f.test_standard), a.blank(f.test_condition),
      a.not(a.oneOf(f.verification_status, ["verified", "partially_verified"])),
      a.not(a.oneOf(f.confidence_level, ["high", "medium"])), a.not(a.oneOf(f.value_type, USABLE_TYPES)))],
    ["A", null, a.eq(f.verification_status, "verified")]
  ];
}
const js = {
  eq: (v, x) => v === x, oneOf: (v, xs) => xs.includes(v),
  and: (...xs) => xs.every(Boolean), or: (...xs) => xs.some(Boolean), not: x => !x,
  finite: x => typeof x === "number" && Number.isFinite(x),
  coalesce: (v, fallback) => v ?? fallback,
  gt: (v, x) => v > x, lt: (v, x) => v < x,
  blank: v => normalizeContext(v) === "",
  http: v => typeof v === "string" && /^https?:\/\/[^/?#]/i.test(v) && !/[\x00-\x20\x7f]/.test(v)
};
const literal = value => typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sql = {
  eq: (v, x) => `COALESCE(${v} = ${literal(x)}, 0)`,
  oneOf: (v, xs) => `COALESCE(${v} IN (${xs.map(literal).join(",")}), 0)`,
  and: (...xs) => `(${xs.join(" AND ")})`, or: (...xs) => `(${xs.join(" OR ")})`, not: x => `(NOT (${x}))`,
  finite: v => `(typeof(${v}) IN ('integer','real') AND ABS(${v}) <= ${Number.MAX_VALUE})`,
  coalesce: (v, fallback) => `COALESCE(${v}, ${literal(fallback)})`,
  gt: (v, x) => `COALESCE(${v} > ${literal(x)}, 0)`, lt: (v, x) => `COALESCE(${v} < ${literal(x)}, 0)`,
  blank: v => `TRIM(COALESCE(${v}, '')) = ''`,
  http: v => `COALESCE(((LOWER(SUBSTR(${v},1,8))='https://' AND LENGTH(${v})>8 AND SUBSTR(${v},9,1) NOT IN ('/','?','#'))
    OR (LOWER(SUBSTR(${v},1,7))='http://' AND LENGTH(${v})>7 AND SUBSTR(${v},8,1) NOT IN ('/','?','#')))
    AND INSTR(${v},CHAR(0))=0 AND ${v} NOT GLOB ('*[' || CHAR(1) || '-' || CHAR(32) || CHAR(127) || ']*'),0)`
};
function classifyClaim(row, materialId = row.material_id) {
  const fields = { ...row, relation_ok: row.material_id === materialId ? 1 : 0,
    source_ok: row.source_id == null || row.resolved_source_id != null ? 1 : 0 };
  const match = eligibilityRules(js, fields).find(rule => rule[2]);
  return match ? { tier: match[0], reason: match[1] } : { tier: "B", reason: null };
}
function queryDecision(a, f) {
  return a.and(a.eq(f.blocked, 0), a.eq(f.contextCount, 1), a.eq(f.valueCount, 1),
    a.gt(f.verifiedCount, 0), a.eq(f.valueType, "typical"), a.eq(f.genericKey, 1));
}
function queryEligibility({ blocked, contextCount, valueCount, verifiedCount, valueType, propertyKey }) {
  return queryDecision(js, { blocked: blocked ? 1 : 0, contextCount, valueCount, verifiedCount, valueType,
    genericKey: PROPERTIES[propertyKey]?.genericKey === false ? 0 : 1 });
}
function claimReference(row, tier) {
  return { id: row.id ?? null, position: row.position ?? null, sourceId: row.source_id ?? null,
    evidenceVersion: row.evidence_version ?? null, lastVerifiedAt: row.last_verified_at ?? null,
    verificationStatus: row.verification_status, confidenceLevel: row.confidence_level,
    sourceType: row.source_type, sourceTitle: row.source_title, sourceUrl: row.source_url,
    conflictGroupId: row.conflict_group_id ?? null, tier };
}
// Count recorded source identities, not publishers, physical measurements or claims.
// Registered source IDs are authoritative; legacy inline sources use their exact
// resolved type/title/URL tuple. No URL/title equivalence is inferred across IDs.
function sourceIdentity(ref) {
  return ref.sourceId != null ? JSON.stringify(["registered", ref.sourceId])
    : JSON.stringify(["inline", ref.sourceType, ref.sourceTitle, ref.sourceUrl]);
}
function projectProperty(materialId, propertyKey, rows) {
  if (!PROPERTIES[propertyKey]) throw new RangeError("Unsupported projection property");
  const claims = rows.filter(row => row.property_key === propertyKey);
  const groups = new Map();
  const reasons = new Set();
  let verifiedCount = 0, partialCount = 0, excludedCount = 0, conflict = false, quarantine = false;
  for (const row of claims) {
    const { tier, reason } = classifyClaim(row, materialId);
    if (reason) reasons.add(reason);
    conflict ||= tier === "D"; quarantine ||= tier === "E";
    if (tier !== "A" && tier !== "B") { excludedCount++; continue; }
    verifiedCount += tier === "A" ? 1 : 0; partialCount += tier === "B" ? 1 : 0;
    const standard = normalizeContext(row.test_standard), condition = normalizeContext(row.test_condition);
    const tuple = [row.unit, standard, condition, row.value_type];
    const key = JSON.stringify(tuple);
    if (!groups.has(key)) groups.set(key, { key, unit: row.unit, standard, condition,
      valueType: row.value_type, values: new Set(), supportingClaimRefs: [], verifiedCount: 0, partialCount: 0 });
    const group = groups.get(key);
    group.values.add(row.value_numeric);
    group.supportingClaimRefs.push(claimReference(row, tier));
    group.verifiedCount += tier === "A" ? 1 : 0; group.partialCount += tier === "B" ? 1 : 0;
  }
  const ordered = [...groups.values()].sort((a, b) => binaryCompare(a.key, b.key));
  const valueCount = ordered.reduce((sum, group) => sum + group.values.size, 0);
  const only = ordered.length === 1 ? ordered[0] : null;
  const blocked = conflict || quarantine;
  const queryEligible = queryEligibility({ blocked, contextCount: ordered.length, valueCount,
    verifiedCount, valueType: only?.valueType, propertyKey });
  const projectionState = quarantine ? "unknown" : conflict ? "conflicting" : !ordered.length ? "unknown"
    : ordered.length > 1 ? "multiple" : valueCount > 1 ? "range" : "single";
  if (!claims.length) reasons.add("missing");
  if (ordered.length > 1) reasons.add("multiple_contexts");
  if (only && valueCount > 1) reasons.add("multiple_values");
  if (!verifiedCount && partialCount) reasons.add("partial_only");
  if (only && only.valueType !== "typical") reasons.add("non_typical_value_type");
  if (propertyKey === "hdt") reasons.add("hdt_requires_context");
  const sourceState = blocked ? "blocked" : verifiedCount && partialCount ? "mixed" : verifiedCount ? "verified"
    : partialCount ? "partially_verified" : claims.length ? "reference_only" : "missing";
  let complete = ordered.length <= MAX_CONTEXT_PREVIEW;
  const entries = blocked ? [] : ordered.slice(0, MAX_CONTEXT_PREVIEW).map(group => {
    const values = [...group.values].sort((a, b) => a - b);
    const refs = group.supportingClaimRefs.sort((a, b) => binaryCompare(JSON.stringify(a), JSON.stringify(b)));
    const entryComplete = values.length <= MAX_SUPPORT_PREVIEW && refs.length <= MAX_SUPPORT_PREVIEW;
    complete &&= entryComplete;
    return { unit: group.unit, standard: group.standard, condition: group.condition, valueType: group.valueType,
      values: values.slice(0, MAX_SUPPORT_PREVIEW), distinctValueCount: values.length,
      observedRange: values.length > 1 ? [values[0], values.at(-1)] : null,
      sourceState: group.verifiedCount && group.partialCount ? "mixed" : group.verifiedCount ? "verified" : "partially_verified",
      claimCount: refs.length, sourceReferenceCount: refs.length,
      sourceCount: new Set(refs.map(sourceIdentity)).size, supportingClaimRefs: refs.slice(0, MAX_SUPPORT_PREVIEW), complete: entryComplete };
  });
  const value = projectionState === "single" ? [...only.values][0] : null;
  return { policyVersion: POLICY_VERSION, propertyKey, projectionState, sourceState,
    value, unit: PROPERTIES[propertyKey].unit, valueType: only?.valueType ?? null,
    standard: only?.standard ?? null, condition: only?.condition ?? null,
    contextScope: "recorded_condition", contextCount: ordered.length, distinctValueCount: valueCount,
    claimCount: claims.length, excludedCount, queryEligible, queryKey: queryEligible ? value : null,
    observedRange: projectionState === "range" ? entries[0].observedRange : null,
    reasonCodes: [...reasons].sort(), entries, detailAvailable: true, complete };
}
function projectProperties(materialId, rows) {
  return Object.fromEntries(PROPERTY_KEYS.map(key => [key, projectProperty(materialId, key, rows)]));
}
function compactProjections(projections) {
  return Object.fromEntries(PROPERTY_KEYS.map(key => {
    const p = projections[key];
    const entries = p.projectionState === "single" ? p.entries.slice(0, 1) : [];
    return [key, { ...p, entries, complete: p.complete && entries.length === p.entries.length }];
  }));
}
function applyPublicProjection(material, projections) {
  material.propertyProjections = projections;
  material.density = projections.density.queryKey;
  material.tensile = projections.tensile_strength.queryKey;
  material.continuous_use_temperature = projections.continuous_use_temperature.queryKey;
  return material;
}
function evaluateThreshold(projection, threshold) {
  if (!projection.queryEligible) return "UNKNOWN";
  return projection.queryKey >= threshold ? "PASS" : "FAIL";
}
function sqlFields(propertyAlias = "p", sourceAlias = "s") {
  for (const alias of [propertyAlias, sourceAlias]) if (!/^[a-z_][a-z_0-9]*$/i.test(alias)) throw new TypeError("Invalid SQL alias");
  const fields = Object.fromEntries(["property_key", "value_numeric", "unit", "test_standard", "test_condition",
    "value_type", "verification_status", "confidence_level", "conflict_status"].map(k => [k, `${propertyAlias}.${k}`]));
  for (const key of ["source_type", "source_title", "source_url"])
    fields[key] = `COALESCE(${sourceAlias}.${key},${propertyAlias}.${key})`;
  fields.relation_ok = "1"; // The correlated material identity equality enforces the relation.
  fields.source_ok = `CASE WHEN ${propertyAlias}.source_id IS NULL OR ${sourceAlias}.source_id IS NOT NULL THEN 1 ELSE 0 END`;
  return fields;
}
// JSON escapes embedded NUL before node:sqlite decodes TEXT. Only page/detail
// claims cross this boundary; SQL page selection still reads the original rows.
function claimJsonSql(propertyAlias = "p", sourceAlias = "s") {
  const resolved = sqlFields(propertyAlias, sourceAlias);
  const keys = ["id", "material_id", "property_key", "position", "source_id", "unit", "test_standard",
    "test_condition", "value_type", "verification_status", "confidence_level", "conflict_status",
    "conflict_group_id", "evidence_version", "last_verified_at"];
  const fields = keys.flatMap(key => [literal(key), `${propertyAlias}.${key}`]);
  fields.push("'value_numeric'", `CASE WHEN typeof(${propertyAlias}.value_numeric) IN ('integer','real') THEN ${propertyAlias}.value_numeric ELSE NULL END`,
    "'resolved_source_id'", `${sourceAlias}.source_id`);
  for (const key of ["source_type", "source_title", "source_url"]) fields.push(literal(key), resolved[key]);
  return `json_object(${fields.join(",")})`;
}
function eligibilitySql(fields = sqlFields()) {
  return `CASE ${eligibilityRules(sql, fields).map(([tier, , predicate]) => `WHEN ${predicate} THEN '${tier}'`).join("\n")} ELSE 'B' END`;
}
// The material relation is supplied by the repository's unpaginated public scope.
// One material/property key row is reused by thresholds and sort, within one SELECT.
function queryRelationSql(materialRelation, propertyKeys) {
  if (!/^[a-z_][a-z_0-9]*$/i.test(materialRelation)) throw new TypeError("Invalid material relation");
  const keys = [...new Set(propertyKeys)];
  if (!keys.length || keys.some(key => !PROPERTIES[key] || PROPERTIES[key].genericKey === false))
    throw new RangeError("Unsupported query projection properties");
  return `pp_claims AS MATERIALIZED (
    SELECT p.material_id, p.property_key, p.value_numeric AS value, p.unit, p.value_type,
      LOWER(TRIM(COALESCE(p.test_standard,''))) AS standard,
      LOWER(TRIM(COALESCE(p.test_condition,''))) AS condition,
      ${eligibilitySql()} AS tier
    FROM ${materialRelation} scope
    CROSS JOIN material_property_evidence p ON p.material_id=scope.material_id
    LEFT JOIN evidence_sources s ON s.source_id=p.source_id
    WHERE p.property_key IN (${keys.map(literal).join(",")})
  ), pp_contexts AS MATERIALIZED (
    SELECT material_id,property_key,unit,standard,condition,value_type,
      MAX(tier IN ('A','B')) AS usable_context,
      COUNT(DISTINCT CASE WHEN tier IN ('A','B') THEN value END) AS value_count,
      MIN(CASE WHEN tier IN ('A','B') THEN value END) AS unique_candidate,
      SUM(tier='A') AS verified_count, MAX(tier IN ('D','E')) AS blocked
    FROM pp_claims GROUP BY material_id,property_key,unit,standard,condition,value_type
  ), pp_keys AS MATERIALIZED (
    SELECT material_id,property_key,
      CASE WHEN ${queryDecision(sql, {
        blocked: "MAX(blocked)", contextCount: "SUM(usable_context)",
        valueCount: "SUM(value_count)", verifiedCount: "SUM(verified_count)",
        valueType: "MIN(CASE WHEN usable_context THEN value_type END)", genericKey: "1"
      })} THEN MIN(unique_candidate) ELSE NULL END AS query_key
    FROM pp_contexts GROUP BY material_id,property_key
  )`;
}
function queryKeySql(materialExpression, propertyKey) {
  if (!/^[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*$/i.test(materialExpression)) throw new TypeError("Invalid material expression");
  if (!PROPERTIES[propertyKey]) throw new RangeError("Unsupported projection property");
  if (PROPERTIES[propertyKey].genericKey === false) return "NULL";
  return `(WITH pp_scope AS MATERIALIZED (SELECT ${materialExpression} AS material_id),
    ${queryRelationSql("pp_scope", [propertyKey])}
    SELECT query_key FROM pp_keys)`;
}
module.exports = { POLICY_VERSION, PROPERTIES, PROPERTY_KEYS, RELIABLE_SOURCES, MAX_CONTEXT_PREVIEW,
  normalizeContext, classifyClaim, projectProperty, projectProperties, compactProjections,
  applyPublicProjection, evaluateThreshold, eligibilitySql, claimJsonSql, queryKeySql, queryRelationSql };
