(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MatFinderCatalogLayer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const TRUSTED_SOURCE_TYPES = new Set([
    "manufacturer",
    "official_datasheet",
    "academic",
    "distributor"
  ]);

  function isPolymerFamily(item) {
    return item?.entityType === "polymer_family" || item?.record_type === "polymer_family";
  }

  function isCommercialGrade(item) {
    return item?.record_type === "commercial_grade" &&
      Boolean(item?.evidence?.identity?.manufacturer) &&
      Boolean(item?.evidence?.identity?.commercialGrade) &&
      Boolean(item?.evidence?.identity?.materialFamily);
  }

  function isQuarantined(item) {
    return item?.data_quality?.level === "quarantined" ||
      item?.data_quality?.verification_status === "quarantined" ||
      item?.catalog_visibility === "admin_only";
  }

  function isDefaultVisibleCommercialGrade(item) {
    return isCommercialGrade(item) &&
      !isPolymerFamily(item) &&
      !isQuarantined(item) &&
      item?.record_origin !== "generated" &&
      item?.scope_status !== "out_of_scope";
  }

  function isVerifiedCommercialGrade(item) {
    return isDefaultVisibleCommercialGrade(item) &&
      ["high", "medium"].includes(item?.data_quality?.level) &&
      item?.data_quality?.recommendation_eligible === true;
  }

  function isVerifiedPropertyClaim(claim) {
    const source = claim?.source || claim || {};
    return claim?.value !== null &&
      claim?.value !== undefined &&
      claim?.value !== "" &&
      Boolean(claim?.unit) &&
      ["high", "medium"].includes(claim?.confidenceLevel) &&
      ["verified", "partially_verified"].includes(claim?.verificationStatus) &&
      TRUSTED_SOURCE_TYPES.has(source?.sourceType) &&
      Boolean(source?.sourceTitle) &&
      /^https?:\/\/\S+$/i.test(String(source?.sourceUrl || ""));
  }

  function propertyClaims(item) {
    return Object.values(item?.evidence?.properties || {}).flat();
  }

  function buildTrustedStats(materials, polymerFamilies) {
    const visibleGrades = materials.filter(isDefaultVisibleCommercialGrade);
    const verifiedGrades = visibleGrades.filter(isVerifiedCommercialGrade);
    return {
      polymerFamilies: polymerFamilies.length,
      verifiedCommercialGrades: verifiedGrades.length,
      verifiedPropertyDataPoints: verifiedGrades.reduce(
        (count, material) => count + propertyClaims(material).filter(isVerifiedPropertyClaim).length,
        0
      ),
      materialsAwaitingVerification: visibleGrades.filter(
        (material) => !isVerifiedCommercialGrade(material)
      ).length
    };
  }

  function buildAuditStats(materials) {
    const legacyMaterials = materials.filter((item) => item.record_type === "legacy");
    const generatedMaterials = materials.filter((item) => item.record_origin === "generated");
    const allEvidence = materials.flatMap((item) => [
      ...(item.evidence?.identity?.sources || []),
      ...propertyClaims(item),
      ...(item.evidence?.certifications || [])
    ]);
    return {
      legacyMaterialRecords: legacyMaterials.length,
      legacyPropertyRecords: legacyMaterials.reduce(
        (count, material) => count + propertyClaims(material).length,
        0
      ),
      generatedRecords: generatedMaterials.length,
      quarantinedRecords: allEvidence.filter(
        (claim) => claim.verificationStatus === "quarantined" ||
          claim.confidenceLevel === "quarantined"
      ).length,
      quarantinedMaterialRecords: materials.filter(isQuarantined).length,
      outOfScopeRecords: materials.filter((item) => item.scope_status === "out_of_scope").length
    };
  }

  function partitionSearchResults(materials) {
    return {
      verifiedCommercialGrades: materials.filter(isVerifiedCommercialGrade),
      potentialCommercialGrades: materials.filter(
        (item) => isDefaultVisibleCommercialGrade(item) && !isVerifiedCommercialGrade(item)
      ),
      referenceOrLegacyRecords: materials.filter(
        (item) => item.record_type === "legacy" || isQuarantined(item)
      )
    };
  }

  return {
    buildAuditStats,
    buildTrustedStats,
    isCommercialGrade,
    isDefaultVisibleCommercialGrade,
    isPolymerFamily,
    isQuarantined,
    isVerifiedCommercialGrade,
    isVerifiedPropertyClaim,
    partitionSearchResults
  };
});
