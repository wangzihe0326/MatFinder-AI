(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MatFinderCatalogSearch = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const identityFields = [
    "name",
    "name_en",
    "name_zh",
    "abbr",
    "abbreviation",
    "material_family",
    "family",
    "grade_name",
    "trade_name"
  ];
  const broadFields = [
    ...identityFields,
    "category",
    "category_en",
    "category_zh",
    "subcategory",
    "supplier_or_brand",
    "manufacturer",
    "summary",
    "description",
    "description_en",
    "description_zh",
    "notes",
    "chemical_resistance",
    "flame_rating",
    "electrical_insulation",
    "transparency",
    "flexibility",
    "waterproof_sealing",
    "source_note",
    "flammability",
    "recyclability",
    "cost_level"
  ];
  const arrayFields = [
    "tags",
    "tags_en",
    "tags_zh",
    "uses",
    "applications",
    "applications_en",
    "applications_zh",
    "processing_methods",
    "typical_applications",
    "advantages",
    "disadvantages",
    "limitations",
    "alternatives"
  ];

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function identityTokens(values) {
    return new Set(
      values
        .flatMap((value) => normalize(value).split(/[^a-z0-9\u3400-\u9fff]+/i))
        .filter(Boolean)
    );
  }

  function buildIndex(material) {
    if (material.__catalogSearchIndex) return material.__catalogSearchIndex;
    const identity = identityFields.map((field) => material[field]).filter(Boolean);
    const broad = [
      ...broadFields.map((field) => material[field]),
      ...arrayFields.flatMap((field) => Array.isArray(material[field]) ? material[field] : [])
    ].filter(Boolean);
    const index = {
      identity: identity.map(normalize),
      identityTokens: identityTokens(identity),
      broadText: broad.map(normalize).join(" ")
    };
    Object.defineProperty(material, "__catalogSearchIndex", {
      configurable: true,
      enumerable: false,
      value: index
    });
    return index;
  }

  function isShortTechnicalCode(query) {
    return /^[a-z0-9+.-]{1,4}$/i.test(query) && /[a-z]/i.test(query);
  }

  function matchesMaterial(material, rawQuery) {
    const query = normalize(rawQuery);
    if (!query) return true;
    const index = buildIndex(material);

    if (isShortTechnicalCode(query)) {
      return index.identityTokens.has(query) || index.identity.some((value) => value === query);
    }

    const queryTokens = query.split(/\s+/).filter(Boolean);
    return queryTokens.every((token) => index.broadText.includes(token));
  }

  function scoreMaterial(material, rawQuery) {
    const query = normalize(rawQuery);
    if (!query) return 0;
    const index = buildIndex(material);
    let score = 0;
    if (index.identity.some((value) => value === query)) score += 100;
    if (index.identityTokens.has(query)) score += 60;
    if (index.identity.some((value) => value.startsWith(query))) score += 30;
    if (index.identity.some((value) => value.includes(query))) score += 15;
    if (index.broadText.includes(query)) score += 5;
    return score;
  }

  return { matchesMaterial, scoreMaterial };
});
