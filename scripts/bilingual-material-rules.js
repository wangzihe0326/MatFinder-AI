// Offline Chinese dataset enrichment for MatFinder.
// This is a deterministic local workflow, not a frontend display dictionary and
// not an external translation API. It preserves English source fields and creates
// persistent Chinese display fields that can be manually improved over time.

const CATEGORY_ZH = {
  Plastics: "塑料",
  Metals: "金属",
  Elastomers: "弹性体",
  Fibers: "纤维",
  Thermosets: "热固性材料",
  Ceramics: "陶瓷",
  Composites: "复合材料",
  Adhesives: "胶粘剂",
  Coatings: "涂层",
  Foams: "泡沫材料",
  Glasses: "玻璃",
  Sealants: "密封胶",
  "General materials": "工程材料"
};

const EXACT_TRANSLATIONS = new Map(
  Object.entries({
    plastics: "塑料",
    plastic: "塑料",
    metals: "金属",
    metal: "金属",
    elastomers: "弹性体",
    elastomer: "弹性体",
    fibers: "纤维",
    fiber: "纤维",
    thermosets: "热固性材料",
    thermoset: "热固性材料",
    ceramics: "陶瓷",
    ceramic: "陶瓷",
    composites: "复合材料",
    composite: "复合材料",
    adhesives: "胶粘剂",
    adhesive: "胶粘剂",
    coatings: "涂层",
    coating: "涂层",
    sealants: "密封胶",
    sealant: "密封胶",
    foams: "泡沫材料",
    foam: "泡沫材料",
    glasses: "玻璃",
    glass: "玻璃",
    gears: "齿轮",
    gear: "齿轮",
    bearings: "轴承",
    bearing: "轴承",
    valves: "阀门",
    valve: "阀门",
    springs: "弹簧",
    spring: "弹簧",
    rollers: "滚轮",
    roller: "滚轮",
    "automotive seals": "汽车密封件",
    "transmission seals": "传动密封件",
    hoses: "软管",
    hose: "软管",
    "electronic housings": "电子外壳",
    "electronics housings": "电子外壳",
    "consumer products": "消费品",
    electronics: "电子产品",
    "automotive trim": "汽车内饰件",
    "office equipment": "办公设备",
    pipes: "管材",
    pipe: "管材",
    containers: "容器",
    container: "容器",
    film: "薄膜",
    tubing: "管材",
    profiles: "型材",
    "cable jackets": "电缆护套",
    connectors: "连接器",
    "relay housings": "继电器外壳",
    "protective windows": "防护视窗",
    "optical lenses": "光学镜片",
    "light guides": "导光件",
    signage: "标识件",
    "under-hood parts": "发动机舱部件",
    fasteners: "紧固件",
    sliders: "滑块",
    seals: "密封件",
    liners: "衬里",
    "chemical piping": "化工管路",
    "battery binder": "电池粘结剂",
    aerospace: "航空航天部件",
    "medical implants": "医疗植入件",
    "automotive pump parts": "汽车泵部件",
    "electronic connectors": "电子连接器",
    "flex circuits": "柔性电路",
    "aerospace insulation": "航空绝缘件",
    "sterilizable medical parts": "可灭菌医疗部件",
    "food equipment": "食品设备部件",
    packaging: "包装",
    "3d printing filament": "3D 打印丝材",
    footwear: "鞋材",
    "shoe foam": "鞋用泡棉",
    "solar encapsulant": "光伏封装材料",
    "roofing membranes": "屋面防水膜",
    "medical tubing": "医疗管材",
    "wire insulation": "电线绝缘层",
    "chemical tubing": "化工管材",
    "semiconductor tubing": "半导体管材",
    "chemical liners": "化工衬里",
    "architectural film": "建筑膜材",
    "wire coating": "线缆涂层",
    "chemical linings": "化工衬层",
    "wire jackets": "电线护套",
    "cryogenic seals": "低温密封件",
    "barrier films": "阻隔膜",
    labware: "实验室器皿",
    "microwave parts": "微波部件",
    syringes: "注射器",
    "diagnostic packaging": "诊断包装",
    "low friction": "低摩擦",
    "wear resistant": "耐磨",
    "wear resistance": "耐磨",
    "dimensional stability": "尺寸稳定",
    machinable: "易加工",
    "high stiffness": "高刚性",
    "fatigue resistant": "耐疲劳",
    "oil resistant": "耐油",
    "heat resistant": "耐热",
    "weather resistant": "耐候",
    conductive: "导电",
    antistatic: "抗静电",
    "anti-static": "抗静电",
    "flame retardant": "阻燃",
    "impact resistant": "抗冲击",
    "surface finish": "表面质量",
    platable: "可电镀",
    tough: "高韧性",
    lightweight: "轻量化",
    "easy processing": "易加工",
    transparent: "透明",
    rigid: "刚性",
    "rigid or flexible": "刚柔可调",
    barrier: "阻隔性",
    recyclable: "可回收",
    "electrical insulation": "电绝缘",
    "chemical resistant": "耐化学",
    "chemical resistance": "耐化学",
    "low moisture": "低吸湿",
    "low temperature": "耐低温",
    "high temperature": "耐高温",
    "fast crystallization": "快速结晶",
    "hydrolysis resistant": "耐水解",
    "transparent amber": "琥珀透明",
    optical: "光学级",
    "bio-based": "生物基",
    "bio based": "生物基",
    compostable: "可堆肥",
    "3d printing": "3D 打印",
    flexible: "柔性",
    foamable: "可发泡",
    "heat seal": "热封",
    ozone: "耐臭氧",
    "ozone resistant": "耐臭氧",
    biocompatible: "生物相容",
    "low dielectric": "低介电",
    medical: "医疗级",
    aerospace: "航空航天级",
    automotive: "汽车级",
    construction: "建筑级",
    industrial: "工业级",
    sealing: "密封级",
    "food contact": "食品接触级",
    "general purpose": "通用级",
    "under hood": "发动机舱",
    "hot melt": "热熔",
    "cold weather": "耐寒",
    "load bearing": "承载",
    "high purity": "高纯度",
    "hot water": "耐热水",
    "water soluble": "水溶性",
    "loose fill": "缓冲填充",
    "front end": "前端模块",
    "wood filled": "木粉填充",
    "glass to metal": "玻璃-金属封接",
    "acrylonitrile butadiene styrene": "ABS",
    "acrylonitrile styrene acrylate": "ASA",
    "acetal copolymer": "POM-C 共聚甲醛",
    "acetal homopolymer": "POM-H 均聚甲醛",
    "acrylic rubber": "ACM 丙烯酸酯橡胶",
    "abs resin": "ABS 树脂",
    abs: "ABS"
  })
);

const COMMON_MATERIAL_NAMES = new Map(
  Object.entries({
    "high density polyethylene": "HDPE 高密度聚乙烯",
    "low density polyethylene": "LDPE 低密度聚乙烯",
    "linear low density polyethylene": "LLDPE 线性低密度聚乙烯",
    polypropylene: "PP 聚丙烯",
    "polyvinyl chloride": "PVC 聚氯乙烯",
    polystyrene: "PS 聚苯乙烯",
    "high impact polystyrene": "HIPS 高抗冲聚苯乙烯",
    "polyethylene terephthalate": "PET 聚对苯二甲酸乙二醇酯",
    "polybutylene terephthalate": "PBT 聚对苯二甲酸丁二醇酯",
    polycarbonate: "PC 聚碳酸酯",
    "polymethyl methacrylate": "PMMA 聚甲基丙烯酸甲酯",
    "polyamide 6": "PA6 聚酰胺 6",
    "polyamide 66": "PA66 聚酰胺 66",
    polyamide: "PA 聚酰胺",
    nylon: "PA 尼龙",
    polyoxymethylene: "POM 聚甲醛",
    "acetal copolymer": "POM-C 共聚甲醛",
    "acetal homopolymer": "POM-H 均聚甲醛",
    polytetrafluoroethylene: "PTFE 聚四氟乙烯",
    "polyvinylidene fluoride": "PVDF 聚偏氟乙烯",
    "polyether ether ketone": "PEEK 聚醚醚酮",
    "polyphenylene sulfide": "PPS 聚苯硫醚",
    polyimide: "PI 聚酰亚胺",
    polysulfone: "PSU 聚砜",
    "polyetherimide": "PEI 聚醚酰亚胺",
    "liquid crystal polymer": "LCP 液晶聚合物",
    "polylactic acid": "PLA 聚乳酸",
    "thermoplastic polyurethane": "TPU 热塑性聚氨酯",
    "ethylene vinyl acetate": "EVA 乙烯-醋酸乙烯共聚物",
    "ethylene propylene diene rubber": "EPDM 三元乙丙橡胶",
    "silicone rubber": "VMQ 硅橡胶",
    "nitrile butadiene rubber": "NBR 丁腈橡胶",
    "styrene butadiene rubber": "SBR 丁苯橡胶",
    "natural rubber": "NR 天然橡胶",
    "chloroprene rubber": "CR 氯丁橡胶",
    "butyl rubber": "IIR 丁基橡胶",
    fluoroelastomer: "FKM 氟橡胶",
    perfluoroelastomer: "FFKM 全氟醚橡胶",
    "acrylic rubber": "ACM 丙烯酸酯橡胶",
    "epichlorohydrin rubber": "ECO 氯醚橡胶",
    "chlorosulfonated polyethylene": "CSM 氯磺化聚乙烯",
    "fluorinated ethylene propylene": "FEP 氟化乙烯丙烯",
    "perfluoroalkoxy alkane": "PFA 可熔性聚四氟乙烯",
    "ethylene tetrafluoroethylene": "ETFE 乙烯-四氟乙烯共聚物",
    "ethylene chlorotrifluoroethylene": "ECTFE 乙烯-三氟氯乙烯共聚物",
    polychlorotrifluoroethylene: "PCTFE 聚三氟氯乙烯",
    polymethylpentene: "PMP 聚甲基戊烯",
    "cyclo olefin copolymer": "COC 环烯烃共聚物",
    "acrylonitrile butadiene styrene": "ABS",
    "acrylonitrile styrene acrylate": "ASA",
    epoxy: "环氧树脂",
    "epoxy resin": "环氧树脂",
    "phenolic resin": "酚醛树脂",
    "vinyl ester resin": "乙烯基酯树脂",
    "melamine formaldehyde": "三聚氰胺甲醛树脂"
  })
);

const COMPONENT_REPLACEMENTS = [
  ["glass fiber reinforced", "玻纤增强"],
  ["carbon fiber reinforced", "碳纤增强"],
  ["glass fiber", "玻纤"],
  ["carbon fiber", "碳纤"],
  ["mineral filled", "矿物填充"],
  ["talc filled", "滑石粉填充"],
  ["mica filled", "云母填充"],
  ["flame retardant", "阻燃"],
  ["electrical grade", "电气级"],
  ["impact grade", "抗冲击级"],
  ["high stiffness grade", "高刚性级"],
  ["high stiffness", "高刚性"],
  ["unfilled molding grade", "未填充注塑级"],
  ["unfilled", "未填充"],
  ["molding grade", "注塑级"],
  ["uv stabilized outdoor grade", "UV 稳定户外级"],
  ["uv stabilized", "UV 稳定"],
  ["outdoor grade", "户外级"],
  ["conductive", "导电"],
  ["antistatic", "抗静电"],
  ["anti-static", "抗静电"],
  ["toughened", "增韧"],
  ["transparent", "透明"],
  ["optical", "光学"],
  ["medical", "医疗"],
  ["food contact", "食品接触"],
  ["wear resistant", "耐磨"],
  ["heat stabilized", "热稳定"],
  ["heat resistant", "耐热"],
  ["chemical resistant", "耐化学"],
  ["oil resistant", "耐油"],
  ["weather resistant", "耐候"],
  ["woven fabric", "编织织物"],
  ["unidirectional", "单向"],
  ["prepreg", "预浸料"],
  ["film", "薄膜"],
  ["foam", "发泡"],
  ["coating", "涂层"],
  ["sealant", "密封"],
  ["adhesive", "粘接"],
  ["grade", "级"]
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

function hasHan(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function hasLongEnglish(value) {
  return [...String(value || "").matchAll(/\b[A-Za-z][A-Za-z-]{7,}\b/g)]
    .map((match) => match[0])
    .some((word) => !isMaterialCodeToken(word));
}

function isMaterialCodeToken(value) {
  const text = String(value || "").trim();
  return (
    /^[A-Z0-9]{2,}(?:-[A-Z0-9]{1,8})+$/.test(text) ||
    /^[A-Z0-9]{4,}$/.test(text) ||
    /^[A-Za-z]{1,5}(?:-[A-Za-z0-9]{1,6}){1,3}$/.test(text)
  );
}

function isAbbreviation(value) {
  const text = String(value || "").trim();
  return /^[A-Z0-9][A-Z0-9+./-]{1,}$/.test(text);
}

function materialCode(material) {
  const candidates = [
    material.abbreviation,
    material.abbr,
    material.trade_name,
    material.material_id,
    material.id
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (/^[A-Z0-9][A-Z0-9+./-]{1,24}$/.test(text)) return text;
  }
  const fromName = String(material.name || "")
    .match(/\b[A-Z0-9][A-Z0-9+./-]{1,24}\b/)?.[0];
  return fromName || "";
}

function translateExact(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (hasHan(text) || isAbbreviation(text)) return text;
  return EXACT_TRANSLATIONS.get(normalizeKey(text)) || "";
}

function replaceKnownComponents(value) {
  let translated = String(value || "").trim();
  if (!translated) return "";
  for (const [source, target] of COMPONENT_REPLACEMENTS) {
    translated = translated.replace(new RegExp(escapeRegExp(source), "gi"), target);
  }
  return translated.replace(/\s+/g, " ").trim();
}

function genericPhrase(value, mode = "tag") {
  const text = normalizeKey(value);
  if (!text) return "";
  if (/housing|enclosure|cover/.test(text)) return "外壳件";
  if (/connector|terminal|relay/.test(text)) return "连接器部件";
  if (/pipe|piping|tube|tubing|hose/.test(text)) return "管材";
  if (/seal|gasket|o-ring|liner/.test(text)) return "密封件";
  if (/film|membrane|sheet/.test(text)) return "薄膜片材";
  if (/gear|bearing|slider|roller/.test(text)) return "传动耐磨件";
  if (/valve|pump/.test(text)) return "阀泵部件";
  if (/cable|wire|insulation|jacket/.test(text)) return "线缆绝缘件";
  if (/medical|implant|steriliz|syringe/.test(text)) return "医疗器械部件";
  if (/automotive|under hood|trim/.test(text)) return "汽车部件";
  if (/aerospace|aircraft/.test(text)) return "航空航天部件";
  if (/battery|ev|cell/.test(text)) return "电池部件";
  if (/electronic|electrical|circuit/.test(text)) return "电子电气部件";
  if (/food|packaging|bottle|container/.test(text)) return "包装容器";
  if (/coating|paint|surface/.test(text)) return "表面保护";
  if (/adhesive|bond|assembly/.test(text)) return "装配粘接";
  if (/foam|cushion|insulation/.test(text)) return "缓冲隔热";
  if (/structural|panel|bracket|component|part/.test(text)) return "结构部件";
  if (/transparent|optical|lens|window/.test(text)) return "光学透明";
  if (/conductive|static|dielectric/.test(text)) return "电性能";
  if (/chemical|corrosion|solvent|acid|alkali/.test(text)) return "耐化学";
  if (/heat|thermal|temperature|flame|fire/.test(text)) return "热性能";
  if (/wear|friction|fatigue|impact|stiff|strength|tough/.test(text)) return "机械性能";
  return mode === "application" ? "工程应用" : "专用级";
}

function translatePhrase(value, mode = "tag") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (hasHan(text)) return text;
  const exact = translateExact(text);
  if (exact) return exact;
  const replaced = replaceKnownComponents(text);
  if (replaced && !hasLongEnglish(replaced)) return normalizeChineseSpacing(replaced);
  return genericPhrase(text, mode);
}

function translateList(values, mode) {
  return listValue(values).map((value) => translatePhrase(value, mode));
}

function baseChineseName(material) {
  const exact = COMMON_MATERIAL_NAMES.get(normalizeKey(material.name));
  if (exact) return exact;
  const code = materialCode(material);
  const category = CATEGORY_ZH[material.category] || "工程材料";
  return code ? `${code} ${category}` : `${category}材料`;
}

function nameModifiers(material) {
  const primaryText = [
    material.name,
    material.grade_name,
    material.trade_name,
    material.material_family,
    material.subcategory
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const secondaryText = [
    ...(material.tags || []),
    ...(material.applications || []),
    ...(material.typical_applications || []),
    ...(material.uses || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const primary = collectNameModifiers(primaryText);
  return (primary.length ? primary : collectNameModifiers(secondaryText)).slice(0, 3);
}

function collectNameModifiers(text) {
  const modifiers = [];
  const add = (value) => {
    if (value && !modifiers.includes(value)) modifiers.push(value);
  };

  const gf = text.match(/glass\s*fib(?:er|re)?\s*(\d{1,2})\s*%|gf\s*(\d{1,2})/i);
  const cf = text.match(/carbon\s*fib(?:er|re)?\s*(\d{1,2})\s*%|cf\s*(\d{1,2})/i);
  const mineral = text.match(/mineral\s*(?:filled\s*)?(\d{1,2})\s*%/i);
  if (gf) add(`玻纤增强 ${gf[1] || gf[2]}%`);
  else if (/glass\s*fib(?:er|re)|\bgf\b/.test(text)) add("玻纤增强");
  if (cf) add(`碳纤增强 ${cf[1] || cf[2]}%`);
  else if (/carbon\s*fib(?:er|re)|\bcf\b/.test(text)) add("碳纤增强");
  if (mineral) add(`矿物填充 ${mineral[1]}%`);
  else if (/mineral filled/.test(text)) add("矿物填充");
  if (/\btalc\b/.test(text)) add("滑石粉填充");
  if (/\bmica\b/.test(text)) add("云母填充");
  if (/flame retardant.*electrical|electrical.*flame retardant|fr\b.*electrical/.test(text)) add("阻燃电气级");
  else if (/flame retardant|\bfr\b|ul ?94|v-0|v0/.test(text)) add("阻燃");
  if (!modifiers.some((item) => item.includes("电气")) && /electrical grade|electrical insulation|dielectric|connector/.test(text)) add("电气级");
  if (/unfilled molding grade|unfilled.*molding/.test(text)) add("未填充注塑级");
  else if (/unfilled/.test(text)) add("未填充");
  if (/uv stabilized outdoor|outdoor.*uv/.test(text)) add("UV 稳定户外级");
  else if (/uv stabilized|uv resistant/.test(text)) add("UV 稳定级");
  else if (/outdoor|weather/.test(text)) add("户外级");
  if (/impact grade|high impact|impact modified|impact resistant/.test(text)) add("抗冲击级");
  if (/high stiffness|stiffness|high modulus/.test(text)) add("高刚性级");
  if (/toughened|tough/.test(text)) add("增韧级");
  if (/conductive/.test(text)) add("导电级");
  if (/antistatic|anti-static|static dissipative/.test(text)) add("抗静电级");
  if (/heat stabilized|heat resistant|high temperature/.test(text)) add("耐热级");
  if (/wear resistant|low friction|lubricated|ptfe filled/.test(text)) add("耐磨低摩擦级");
  if (/transparent|optical|clear/.test(text)) add("透明级");
  if (/medical|biocompatible/.test(text)) add("医疗级");
  if (/food contact/.test(text)) add("食品接触级");
  if (/film/.test(text)) add("薄膜级");
  if (/foam|foamable/.test(text)) add("发泡级");
  if (/woven fabric/.test(text)) add("编织织物");
  if (/unidirectional/.test(text)) add("单向增强");
  if (/prepreg/.test(text)) add("预浸料");
  if (/coating/.test(text)) add("涂层级");
  if (/sealant|sealing|gasket/.test(text)) add("密封级");
  if (/adhesive|bond/.test(text)) add("粘接级");

  return modifiers;
}

function translateMaterialName(material) {
  const code = materialCode(material);
  const modifiers = nameModifiers(material);
  const exactBase = COMMON_MATERIAL_NAMES.get(normalizeKey(material.name));
  if (modifiers.length && code) {
    return normalizeChineseSpacing(`${code} ${finalizeGradeName(modifiers.join(" "))}`);
  }
  if (exactBase) return exactBase;
  if (code) return `${code} 通用级`;
  return `${CATEGORY_ZH[material.category] || "工程材料"}通用级`;
}

function finalizeGradeName(value) {
  const text = normalizeChineseSpacing(value);
  if (/级$|织物$|增强$|料$/.test(text)) return text;
  return `${text} 级`;
}

function buildChineseDescription(material, fields) {
  const applications = fields.applications_zh.length ? fields.applications_zh.slice(0, 3).join("、") : "工程应用";
  const tags = fields.tags_zh.length ? fields.tags_zh.slice(0, 3).join("、") : "专用级";
  const maxTemperature = material.max_temperature || material.continuous_use_temperature || material.maxTemp;
  const thermal = maxTemperature !== undefined && maxTemperature !== null ? `，连续使用温度约 ${maxTemperature} deg C` : "";
  return `${fields.name_zh}属于${fields.category_zh || fields.category_en}，典型应用包括${applications}，主要特征包括${tags}${thermal}。`;
}

function translationQuality(fields, material) {
  const display = [
    fields.name_zh,
    fields.category_zh,
    fields.description_zh,
    ...fields.applications_zh,
    ...fields.tags_zh
  ].join(" ");
  if (hasLongEnglish(display)) return "partial";
  if (!materialCode(material)) return "fallback";
  if (COMMON_MATERIAL_NAMES.has(normalizeKey(material.name))) return "exact";
  return "generated";
}

function generateBilingualMaterial(material) {
  const applicationsEn = listValue(material.applications, material.typical_applications, material.uses);
  const tagsEn = listValue(material.tags, material.features);
  const fields = {
    name_en: material.name || "",
    name_zh: translateMaterialName(material),
    category_en: material.category || "",
    category_zh: CATEGORY_ZH[material.category] || translatePhrase(material.category || ""),
    description_en: material.description || material.summary || "",
    applications_en: applicationsEn,
    applications_zh: translateList(applicationsEn, "application"),
    tags_en: tagsEn,
    tags_zh: translateList(tagsEn, "tag")
  };
  fields.description_zh = buildChineseDescription(material, fields);
  const quality = translationQuality(fields, material);

  return {
    ...material,
    ...fields,
    translation_quality: quality,
    translation_status: quality === "partial" || quality === "fallback" ? "partial" : "complete"
  };
}

function generateBilingualMaterials(materials) {
  return materials.map(generateBilingualMaterial);
}

function normalizeChineseSpacing(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+级/g, "级")
    .replace(/(\d+%)级/g, "$1 级")
    .replace(/级级/g, "级")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  CATEGORY_ZH,
  EXACT_TRANSLATIONS,
  generateBilingualMaterial,
  generateBilingualMaterials,
  hasLongEnglish,
  listValue,
  normalizeKey,
  translatePhrase
};
