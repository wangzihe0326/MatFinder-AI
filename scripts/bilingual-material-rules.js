// Rule-based bilingual material enrichment for MatFinder.
// This intentionally avoids external translation APIs. The mappings are deterministic
// and can be manually expanded over time as the commercial material database matures.

const EXACT_TRANSLATIONS = new Map(
  Object.entries({
    "plastics": "塑料",
    "plastic": "塑料",
    "metals": "金属",
    "metal": "金属",
    "elastomers": "弹性体",
    "elastomer": "弹性体",
    "fibers": "纤维",
    "fiber": "纤维",
    "thermosets": "热固性材料",
    "thermoset": "热固性材料",
    "ceramics": "陶瓷",
    "ceramic": "陶瓷",
    "composites": "复合材料",
    "composite": "复合材料",
    "adhesives": "胶粘剂",
    "adhesive": "胶粘剂",
    "coatings": "涂层",
    "coating": "涂层",
    "sealants": "密封胶",
    "sealant": "密封胶",
    "foams": "泡沫材料",
    "foam": "泡沫材料",
    "glasses": "玻璃",
    "glass": "玻璃",
    "gears": "齿轮",
    "gear": "齿轮",
    "bearings": "轴承",
    "bearing": "轴承",
    "valves": "阀门",
    "valve": "阀门",
    "springs": "弹簧",
    "spring": "弹簧",
    "rollers": "滚轮",
    "roller": "滚轮",
    "automotive seals": "汽车密封件",
    "transmission seals": "传动密封件",
    "hoses": "软管",
    "hose": "软管",
    "electronic housings": "电子外壳",
    "electronics housings": "电子外壳",
    "consumer products": "消费品",
    "electronics": "电子产品",
    "automotive trim": "汽车内饰件",
    "office equipment": "办公设备",
    "low friction": "低摩擦",
    "wear resistant": "耐磨",
    "wear resistance": "耐磨",
    "dimensional stability": "尺寸稳定",
    "machinable": "易加工",
    "high stiffness": "高刚性",
    "fatigue resistant": "耐疲劳",
    "oil resistant": "耐油",
    "heat resistant": "耐热",
    "weather resistant": "耐候",
    "conductive": "导电",
    "antistatic": "抗静电",
    "anti-static": "抗静电",
    "flame retardant": "阻燃",
    "impact resistant": "抗冲击",
    "surface finish": "表面质量",
    "platable": "可电镀",
    "tough": "高韧性",
    "acrylonitrile butadiene styrene": "丙烯腈-丁二烯-苯乙烯",
    "abs resin": "ABS 树脂",
    "abs": "ABS",
    "acetal copolymer": "共聚甲醛",
    "acetal homopolymer": "均聚甲醛",
    "acrylic rubber": "丙烯酸酯橡胶",
    "glass fiber reinforced": "玻纤增强",
    "carbon fiber reinforced": "碳纤增强",
    "electrical grade": "电气级",
    "impact grade": "抗冲击级",
    "high stiffness grade": "高刚性级",
    "woven fabric": "编织织物",
    "unidirectional": "单向",
    "toughened": "增韧",
    "general purpose": "通用级",
    "food contact": "食品接触",
    "medical": "医疗",
    "aerospace": "航空航天",
    "automotive": "汽车",
    "construction": "建筑",
    "industrial": "工业",
    "sealing": "密封",
    "electrical insulation": "电绝缘",
    "chemical resistant": "耐化学",
    "chemical resistance": "耐化学",
    "transparent": "透明",
    "flexible": "柔性",
    "rigid": "刚性",
    "waterproof": "防水",
    "high temperature": "高温",
    "low temperature": "低温"
  })
);

const COMPONENT_TRANSLATIONS = [
  ["Acrylonitrile butadiene styrene", "丙烯腈-丁二烯-苯乙烯"],
  ["Acetal copolymer", "共聚甲醛"],
  ["Acetal homopolymer", "均聚甲醛"],
  ["Acrylic rubber", "丙烯酸酯橡胶"],
  ["Glass fiber reinforced", "玻纤增强"],
  ["Carbon fiber reinforced", "碳纤增强"],
  ["Flame retardant", "阻燃"],
  ["Electrical grade", "电气级"],
  ["Impact grade", "抗冲击级"],
  ["High stiffness grade", "高刚性级"],
  ["Woven fabric", "编织织物"],
  ["Unidirectional", "单向"],
  ["Toughened", "增韧"],
  ["Conductive", "导电"],
  ["Antistatic", "抗静电"],
  ["ABS resin", "ABS 树脂"],
  ["ABS", "ABS"]
];

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[_/,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value.filter(Boolean).map(String);
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
      } catch (error) {
        return value
          .split(/[,;|]/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
  }
  return [];
}

function isAbbreviation(value) {
  const text = String(value || "").trim();
  return /^[A-Z0-9][A-Z0-9+./-]{1,}$/.test(text);
}

function translateExact(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (isAbbreviation(text)) return text;
  return EXACT_TRANSLATIONS.get(normalizeKey(text)) || "";
}

function translatePhrase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const exact = translateExact(text);
  if (exact) return exact;

  let translated = text;
  let changed = false;
  for (const [source, target] of COMPONENT_TRANSLATIONS) {
    const pattern = new RegExp(escapeRegExp(source), "gi");
    if (pattern.test(translated)) {
      translated = translated.replace(pattern, target);
      changed = true;
    }
  }

  return changed ? translated : text;
}

function translateList(values) {
  return listValue(values).map((value) => translatePhrase(value));
}

function translateMaterialName(material) {
  const name = String(material.name || "").trim();
  if (!name) return "";
  const abbr = material.abbreviation || material.abbr;
  const exact = translateExact(name);
  if (exact) return exact;

  const translated = translatePhrase(name);
  if (translated !== name) return translated;

  if (abbr && isAbbreviation(abbr) && normalizeKey(name).includes(normalizeKey(abbr))) {
    return name;
  }
  return name;
}

function buildChineseDescription(material, fields) {
  const applications = fields.applications_zh.length ? fields.applications_zh.slice(0, 3).join("、") : "";
  const tags = fields.tags_zh.length ? fields.tags_zh.slice(0, 3).join("、") : "";
  const parts = [`${fields.name_zh || fields.name_en}属于${fields.category_zh || fields.category_en}`];
  if (applications) parts.push(`典型应用包括${applications}`);
  if (tags) parts.push(`主要特征包括${tags}`);
  const maxTemperature = material.max_temperature || material.continuous_use_temperature || material.maxTemp;
  if (maxTemperature !== undefined && maxTemperature !== null) {
    parts.push(`连续使用温度约 ${maxTemperature} deg C`);
  }
  return `${parts.join("，")}。`;
}

function hasFallback(source, translated) {
  const sourceText = String(source || "").trim();
  const translatedText = String(translated || "").trim();
  return Boolean(sourceText) && sourceText === translatedText && !isAbbreviation(sourceText);
}

function generateBilingualMaterial(material) {
  const applicationsEn = listValue(material.applications, material.typical_applications, material.uses);
  const tagsEn = listValue(material.tags, material.features);
  const fields = {
    name_en: material.name || "",
    name_zh: translateMaterialName(material),
    category_en: material.category || "",
    category_zh: translatePhrase(material.category || ""),
    description_en: material.description || material.summary || "",
    applications_en: applicationsEn,
    applications_zh: translateList(applicationsEn),
    tags_en: tagsEn,
    tags_zh: translateList(tagsEn)
  };
  fields.description_zh = buildChineseDescription(material, fields);

  const partial =
    hasFallback(fields.name_en, fields.name_zh) ||
    hasFallback(fields.category_en, fields.category_zh) ||
    fields.applications_en.some((value, index) => hasFallback(value, fields.applications_zh[index])) ||
    fields.tags_en.some((value, index) => hasFallback(value, fields.tags_zh[index]));

  return {
    ...material,
    ...fields,
    translation_status: partial ? "partial" : "complete"
  };
}

function generateBilingualMaterials(materials) {
  return materials.map(generateBilingualMaterial);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  EXACT_TRANSLATIONS,
  generateBilingualMaterial,
  generateBilingualMaterials,
  listValue,
  translatePhrase
};
