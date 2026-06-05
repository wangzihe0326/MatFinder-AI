let materials = [];
let recommendationService = null;
const apiBaseUrl = String(window.MatFinderConfig?.apiBaseUrl || "").replace(/\/$/, "");

const i18n = {
  zh: {
    brandEyebrow: "本地材料数据库 + AI",
    languageLabel: "语言",
    filtersToggle: "筛选",
    materialsUnit: "种材料",
    comparedUnit: "个对比",
    requirementLabel: "需求描述",
    requirementPlaceholder: "需要一种轻量、耐热、并且电绝缘的材料。",
    recommendButton: "推荐材料",
    clearButton: "清空",
    analysisPanelLabel: "AI 材料分析",
    selectMaterial: "选择一种材料",
    gptExplanation: "GPT 解释",
    analysisEmpty: "点击材料的详情按钮，从本地数据集生成 OpenAI 分析。",
    keywordSearch: "关键词搜索",
    searchPlaceholder: "名称、缩写、用途、性能",
    materialCategory: "材料类别",
    allCategories: "全部类别",
    performanceFocus: "性能重点",
    continuousTemp: "连续使用温度",
    minimumStrength: "最低拉伸强度",
    recyclableOnly: "仅可回收",
    resetButton: "重置",
    databaseLabel: "材料数据库",
    sortLabel: "排序",
    allMaterials: "全部材料",
    noMatches: "没有匹配的材料。",
    comparisonLabel: "材料对比",
    performanceSnapshot: "性能速览",
    aiComparisonLabel: "AI 材料对比",
    selectTwoMaterials: "选择两种材料",
    compareWithAi: "AI 对比",
    gptComparison: "GPT 对比",
    aiCompareEmpty: "添加两种材料进行对比，即可基于本地数据集生成 GPT 对比。",
    matchingMaterials: "个匹配材料",
    recommendedMaterials: "推荐材料",
    matchedRequirements: "匹配需求",
    localDatasetMatch: "本地数据匹配",
    noRecommendations: "暂无推荐结果。",
    matchScore: "匹配分",
    detailsAi: "详情 + AI",
    aiScore: "AI 分数",
    added: "已加入",
    compare: "对比",
    keyword: "关键词",
    category: "类别",
    focus: "重点",
    temp: "温度",
    strength: "强度",
    recyclable: "可回收",
    none: "无",
    continuousUse: "连续使用",
    tensileStrength: "拉伸强度",
    density: "密度",
    glassTransition: "玻璃化温度",
    meltingPoint: "熔点",
    elongation: "断裂伸长率",
    dielectricConstant: "介电常数",
    typicalUses: "典型用途",
    selectionNotes: "选材提示",
    metric: "指标",
    yes: "是",
    specialtyStream: "需专项回收体系",
    ready: "就绪",
    usingFirstTwo: "使用前两项",
    generating: "生成中...",
    unavailable: "不可用",
    cachedAnalysis: "已缓存的 GPT 分析",
    generatedByGpt: "GPT 已生成",
    cachedComparison: "已缓存的 GPT 对比",
    materialOverview: "材料概览",
    materialProfile: "材料档案",
    basicProperties: "基础性能",
    advantages: "优势",
    disadvantages: "劣势",
    limitations: "限制",
    recommendedApplications: "推荐应用",
    similarMaterials: "相似材料",
    materialSources: "材料来源信息",
    sourceType: "来源类型",
    sourceNotes: "来源说明",
    viewSource: "查看来源",
    noSources: "当前材料暂无来源记录。",
    sourceOfTruth: "数据来源",
    sourceSingle: (name) => `GPT 只接收了本地数据集中 ${name} 的材料档案；数值属性和应用仍以 MatFinder 本地数据库为准。`,
    sourcePair: (a, b) => `GPT 只接收了本地数据集中 ${a} 和 ${b} 的材料档案；标准对比表保持不变。`,
    selectReady: (a, b) => `已准备对比 ${a} 和 ${b}。上方现有对比表保持不变。`,
    sendingAnalysis: (name) => `正在把本地数据库中的 ${name} 属性发送给 GPT 进行解释。`,
    sendingComparison: (a, b) => `正在把 ${a} 和 ${b} 的本地材料档案发送给 GPT 进行对比。`,
    analysisFailed: "AI 分析无法生成",
    comparisonFailed: "AI 对比无法生成",
    serverHint: " 请运行 npm.cmd start 并打开 http://localhost:3000。",
    analysisNeedsServer: (name) => `本地数据库仍可查看 ${name}；GPT 分析需要本地服务、API key 和可用额度。`,
    comparisonNeedsServer: (a, b) => `本地对比表仍可查看 ${a} 和 ${b}；GPT 对比需要本地服务、API key 和可用额度。`,
    notSpecified: "给定材料数据中未说明。",
    selectionAdvice: "选择建议",
    keyDifferences: "关键差异",
    strengthsWeaknesses: "强项与弱项",
    recommendedUseCases: "推荐使用场景",
    examples: ["轻量耐热绝缘", "透明抗冲击件", "耐化学高温密封"],
    propertyOptions: {
      all: "综合",
      "high-temp": "耐热",
      strength: "高强度",
      chemical: "耐化学",
      transparent: "透明",
      elastomer: "弹性体",
      sustainable: "可持续",
      electrical: "电绝缘"
    },
    sortOptions: {
      match: "相关度",
      temperature: "使用温度",
      strength: "拉伸强度",
      density: "密度",
      name: "名称"
    }
  },
  en: {
    brandEyebrow: "Local Material Database + AI",
    languageLabel: "Language",
    filtersToggle: "Filters",
    materialsUnit: "materials",
    comparedUnit: "compared",
    requirementLabel: "Requirement description",
    requirementPlaceholder: "Need a lightweight, heat-resistant, electrically insulating material.",
    recommendButton: "Recommend",
    clearButton: "Clear",
    analysisPanelLabel: "AI Material Analysis",
    selectMaterial: "Select a material",
    gptExplanation: "GPT explanation",
    analysisEmpty: "Choose a material Details button to generate an OpenAI-backed explanation from the local dataset.",
    keywordSearch: "Keyword search",
    searchPlaceholder: "Name, abbreviation, use, property",
    materialCategory: "Material category",
    allCategories: "All categories",
    performanceFocus: "Performance focus",
    continuousTemp: "Continuous use temperature",
    minimumStrength: "Minimum tensile strength",
    recyclableOnly: "Recyclable only",
    resetButton: "Reset",
    databaseLabel: "Material Database",
    sortLabel: "Sort",
    allMaterials: "All materials",
    noMatches: "No matching materials.",
    comparisonLabel: "Material Comparison",
    performanceSnapshot: "Performance snapshot",
    aiComparisonLabel: "AI Material Comparison",
    selectTwoMaterials: "Select two materials",
    compareWithAi: "Compare with AI",
    gptComparison: "GPT comparison",
    aiCompareEmpty: "Add two materials to Compare to generate a GPT comparison from the local dataset.",
    matchingMaterials: "matching materials",
    recommendedMaterials: "Recommended Materials",
    matchedRequirements: "Matched requirements",
    localDatasetMatch: "Local dataset match",
    noRecommendations: "No recommendations yet.",
    matchScore: "Match score",
    detailsAi: "Details + AI",
    aiScore: "AI score",
    added: "Added",
    compare: "Compare",
    keyword: "Keyword",
    category: "Category",
    focus: "Focus",
    temp: "Temp",
    strength: "Strength",
    recyclable: "Recyclable",
    none: "none",
    continuousUse: "Continuous use",
    tensileStrength: "Tensile strength",
    density: "Density",
    glassTransition: "Glass transition",
    meltingPoint: "Melting point",
    elongation: "Elongation",
    dielectricConstant: "Dielectric constant",
    typicalUses: "Typical uses",
    selectionNotes: "Selection notes",
    metric: "Metric",
    yes: "Yes",
    specialtyStream: "Specialty stream",
    ready: "Ready",
    usingFirstTwo: "Using first two",
    generating: "Generating...",
    unavailable: "Unavailable",
    cachedAnalysis: "Cached GPT analysis",
    generatedByGpt: "Generated by GPT",
    cachedComparison: "Cached GPT comparison",
    materialOverview: "Material overview",
    materialProfile: "Material profile",
    basicProperties: "Basic properties",
    advantages: "Advantages",
    disadvantages: "Disadvantages",
    limitations: "Limitations",
    recommendedApplications: "Recommended applications",
    similarMaterials: "Similar materials",
    materialSources: "Material source information",
    sourceType: "Source type",
    sourceNotes: "Source notes",
    viewSource: "View source",
    noSources: "No source records are available for this material.",
    sourceOfTruth: "Source of truth",
    sourceSingle: (name) => `GPT received only the local dataset entry for ${name}. Numeric properties and applications remain sourced from MatFinder's local material database.`,
    sourcePair: (a, b) => `GPT received only the local dataset profiles for ${a} and ${b}. The standard comparison table remains unchanged.`,
    selectReady: (a, b) => `Ready to compare ${a} and ${b}. The existing comparison table above remains unchanged.`,
    sendingAnalysis: (name) => `Sending ${name} properties from the local database to GPT for explanation.`,
    sendingComparison: (a, b) => `Sending local profiles for ${a} and ${b} to GPT for comparison.`,
    analysisFailed: "AI analysis could not be generated",
    comparisonFailed: "AI comparison could not be generated",
    serverHint: " Start the local server with npm.cmd start and open http://localhost:3000.",
    analysisNeedsServer: (name) => `The local database remains available for ${name}; GPT analysis requires the local server, API key, and available quota.`,
    comparisonNeedsServer: (a, b) => `The local comparison table still works for ${a} and ${b}; GPT comparison requires the local server, API key, and available OpenAI quota.`,
    notSpecified: "Not specified in the provided material data.",
    selectionAdvice: "Selection advice",
    keyDifferences: "Key differences",
    strengthsWeaknesses: "Strengths and weaknesses",
    recommendedUseCases: "Recommended use cases",
    examples: ["Lightweight heat insulator", "Transparent impact part", "Chemical high-temp seal"],
    propertyOptions: {
      all: "Balanced",
      "high-temp": "Heat resistant",
      strength: "High strength",
      chemical: "Chemical resistant",
      transparent: "Transparent",
      elastomer: "Elastomer",
      sustainable: "Sustainable",
      electrical: "Electrical insulation"
    },
    sortOptions: {
      match: "Relevance",
      temperature: "Use temperature",
      strength: "Tensile strength",
      density: "Density",
      name: "Name"
    }
  }
};

const zhNames = {
  hdpe: "高密度聚乙烯",
  ldpe: "低密度聚乙烯",
  pp: "聚丙烯",
  pvc: "聚氯乙烯",
  ps: "聚苯乙烯",
  abs: "ABS 树脂",
  pet: "聚对苯二甲酸乙二醇酯",
  pbt: "聚对苯二甲酸丁二醇酯",
  pc: "聚碳酸酯",
  pmma: "聚甲基丙烯酸甲酯",
  pa6: "聚酰胺 6",
  pa66: "聚酰胺 66",
  pom: "聚甲醛",
  ptfe: "聚四氟乙烯",
  pvdf: "聚偏二氟乙烯",
  peek: "聚醚醚酮",
  pps: "聚苯硫醚",
  pi: "聚酰亚胺",
  psu: "聚砜",
  pla: "聚乳酸",
  tpu: "热塑性聚氨酯",
  eva: "乙烯-醋酸乙烯酯共聚物",
  epdm: "三元乙丙橡胶",
  vmq: "硅橡胶"
};

const zhTerms = {
  "Commodity plastic": "通用塑料",
  "Engineering plastic": "工程塑料",
  Fluoropolymer: "氟塑料",
  "High-performance plastic": "高性能塑料",
  "Bio-based material": "生物基材料",
  Elastomer: "弹性体",
  Rubber: "橡胶",
  "chemical resistant": "耐化学",
  "low moisture": "低吸水",
  lightweight: "轻量",
  "easy processing": "易加工",
  flexible: "柔韧",
  transparent: "透明",
  "low temperature": "耐低温",
  "fatigue resistant": "耐疲劳",
  "food contact": "食品接触",
  "flame retardant": "阻燃",
  "weather resistant": "耐候",
  "rigid or flexible": "可软可硬",
  "electrical insulation": "电绝缘",
  rigid: "刚性",
  "impact resistant": "抗冲击",
  "surface finish": "外观表面",
  platable: "可电镀",
  tough: "韧性",
  barrier: "阻隔",
  recyclable: "可回收",
  "dimensional stability": "尺寸稳定",
  "fast crystallization": "快速结晶",
  "heat resistant": "耐热",
  optical: "光学",
  "wear resistant": "耐磨",
  "high strength": "高强度",
  "low friction": "低摩擦",
  "transparent amber": "琥珀透明",
  "hydrolysis resistant": "耐水解",
  "bio-based": "生物基",
  compostable: "可堆肥",
  "3D printing": "3D 打印",
  elastomer: "弹性体",
  foamable: "可发泡",
  "heat seal": "热封",
  "ozone resistant": "耐臭氧",
  biocompatible: "生物相容",
  film: "薄膜",
  "heat resistance": "耐热",
  "electrical insulation": "电绝缘",
  "high strength": "高强度",
  "chemical resistance": "耐化学",
  transparency: "透明",
  "impact resistance": "抗冲击",
  flexibility: "柔韧性",
  "wear resistance": "耐磨",
  "weather resistance": "耐候",
  "flame resistance": "阻燃",
  sustainability: "可持续",
  "medical suitability": "医疗适配",
  "food contact": "食品接触"
};

const propertyPredicates = {
  "high-temp": (item) => item.maxTemp >= 150,
  strength: (item) => item.tensile >= 70,
  chemical: (item) => item.tags.includes("chemical resistant"),
  transparent: (item) => item.tags.includes("transparent") || item.tags.includes("optical"),
  elastomer: (item) => item.category === "Elastomer" || item.category === "Rubber" || item.tags.includes("elastomer"),
  sustainable: (item) => item.tags.includes("bio-based") || item.tags.includes("compostable") || item.recyclable,
  electrical: (item) => item.tags.includes("electrical insulation") || item.uses.some((use) => use.includes("electrical"))
};

const state = {
  language: "zh",
  query: "",
  category: "all",
  property: "all",
  minTemp: 60,
  minStrength: 5,
  recyclableOnly: false,
  sort: "match",
  selected: new Set(),
  recommendations: [],
  recommendationCriteria: [],
  selectedMaterialId: null,
  analysisCache: new Map(),
  aiCompareCache: new Map()
};

const elements = {
  totalCount: document.querySelector("#totalCount"),
  selectedCount: document.querySelector("#selectedCount"),
  languageSelect: document.querySelector("#languageSelect"),
  requirementInput: document.querySelector("#requirementInput"),
  recommendButton: document.querySelector("#recommendButton"),
  clearRecommendationButton: document.querySelector("#clearRecommendationButton"),
  recommendationResults: document.querySelector("#recommendationResults"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisStatus: document.querySelector("#analysisStatus"),
  analysisContent: document.querySelector("#analysisContent"),
  exampleButtons: document.querySelectorAll("[data-example]"),
  searchInput: document.querySelector("#searchInput"),
  filterToggleButton: document.querySelector("#filterToggleButton"),
  categoryFilter: document.querySelector("#categoryFilter"),
  propertyFilter: document.querySelector("#propertyFilter"),
  tempRange: document.querySelector("#tempRange"),
  tempOutput: document.querySelector("#tempOutput"),
  strengthRange: document.querySelector("#strengthRange"),
  strengthOutput: document.querySelector("#strengthOutput"),
  recyclableOnly: document.querySelector("#recyclableOnly"),
  resetButton: document.querySelector("#resetButton"),
  sortSelect: document.querySelector("#sortSelect"),
  resultTitle: document.querySelector("#resultTitle"),
  activeFilters: document.querySelector("#activeFilters"),
  materialsGrid: document.querySelector("#materialsGrid"),
  emptyState: document.querySelector("#emptyState"),
  comparePanel: document.querySelector("#comparePanel"),
  compareTableWrap: document.querySelector("#compareTableWrap"),
  clearCompareButton: document.querySelector("#clearCompareButton"),
  aiCompareTitle: document.querySelector("#aiCompareTitle"),
  aiCompareStatus: document.querySelector("#aiCompareStatus"),
  aiCompareContent: document.querySelector("#aiCompareContent"),
  runAiCompareButton: document.querySelector("#runAiCompareButton"),
  detailDialog: document.querySelector("#detailDialog"),
  detailContent: document.querySelector("#detailContent"),
  closeDialogButton: document.querySelector("#closeDialogButton")
};

let categories = [];

function t(key, ...args) {
  const value = i18n[state.language][key] ?? i18n.en[key] ?? key;
  return typeof value === "function" ? value(...args) : value;
}

function localizeTerm(value) {
  if (state.language !== "zh") return value;
  return zhTerms[value] || value;
}

function materialName(item) {
  return state.language === "zh" ? zhNames[item.id] || item.name : item.name;
}

function materialCategory(item) {
  return localizeTerm(item.category);
}

function materialTags(item) {
  return item.tags.map(localizeTerm);
}

function materialUses(item) {
  return state.language === "zh" ? item.uses.map(localizeTerm) : item.uses;
}

function materialSummary(item) {
  if (state.language !== "zh") return item.summary;
  const uses = materialUses(item).slice(0, 3).join("、");
  return `${materialName(item)}属于${materialCategory(item)}，典型用途包括${uses}，连续使用温度约 ${item.maxTemp} deg C。`;
}

function materialNotes(item) {
  if (state.language !== "zh") return item.notes;
  return `请结合工况、加工方式、长期载荷和环境介质进一步验证；本地数据库备注：${item.notes}`;
}

function localizeRecommendationReason(reason) {
  if (state.language !== "zh") return reason;
  return reason
    .replace(/^low density \((.+)\)$/, "低密度（$1）")
    .replace(/^continuous use up to (.+)$/, "连续使用温度可达 $1")
    .replace(/^electrical insulation fit with dielectric constant (.+)$/, "电绝缘匹配，介电常数 $1")
    .replace("electrical insulation fit is indicated by tags or uses", "标签或用途体现了电绝缘适配")
    .replace(/^tensile strength of (.+)$/, "拉伸强度 $1")
    .replace("strong chemical resistance profile", "具有较强耐化学特征")
    .replace("transparent or optical-use material", "适合透明或光学用途")
    .replace("good toughness or impact resistance", "具有较好韧性或抗冲击特征")
    .replace(/^flexible behavior with (.+) elongation$/, "柔性表现突出，断裂伸长率 $1")
    .replace("wear or low-friction use profile", "具有耐磨或低摩擦应用特征")
    .replace("weathering resistance is represented in the dataset", "本地数据集中体现了耐候性")
    .replace("flame-retardant profile", "具有阻燃特征")
    .replace("recyclable material family", "属于可回收材料体系")
    .replace("bio-based or specialty sustainability fit", "具有生物基或可持续适配特征")
    .replace("medical-related uses are present in the local dataset", "本地数据集中包含医疗相关用途")
    .replace("common food or packaging applications", "常见于食品或包装应用")
    .replace("closest local text match", "最接近的本地文本匹配")
    .replace("balanced fallback from local dataset", "来自本地数据集的综合推荐")
    .replace("partial match against stated requirements", "与需求部分匹配");
}

function applyLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  elements.requirementInput.placeholder = t("requirementPlaceholder");
  elements.searchInput.placeholder = t("searchPlaceholder");
  elements.languageSelect.value = state.language;
  elements.emptyState.textContent = t("noMatches");
  elements.runAiCompareButton.textContent = t("compareWithAi");

  const categoryOptions = elements.categoryFilter.querySelectorAll("option");
  categoryOptions.forEach((option) => {
    option.textContent = option.value === "all" ? t("allCategories") : localizeTerm(option.value);
  });

  elements.propertyFilter.querySelectorAll("option").forEach((option) => {
    option.textContent = t("propertyOptions")[option.value];
  });

  elements.sortSelect.querySelectorAll("option").forEach((option) => {
    option.textContent = t("sortOptions")[option.value];
  });

  elements.exampleButtons.forEach((button, index) => {
    button.textContent = t("examples")[index];
  });
}

function rerenderActiveAnalysis() {
  if (state.selectedMaterialId) {
    const item = materials.find((material) => material.id === state.selectedMaterialId);
    const analysis = state.analysisCache.get(getLanguageCacheKey(item?.id));
    if (item && analysis) {
      elements.analysisTitle.textContent = `${materialName(item)} (${item.abbr})`;
      renderAnalysis(item, analysis, t("cachedAnalysis"));
    } else if (item) {
      elements.analysisTitle.textContent = `${materialName(item)} (${item.abbr})`;
      elements.analysisStatus.textContent = t("gptExplanation");
      elements.analysisContent.innerHTML = `<p class="recommendation-empty">${t("analysisEmpty")}</p>`;
    }
  } else {
    elements.analysisTitle.textContent = t("selectMaterial");
    elements.analysisStatus.textContent = t("gptExplanation");
    elements.analysisContent.innerHTML = `<p class="recommendation-empty">${t("analysisEmpty")}</p>`;
  }
}

function getLanguageCacheKey(id) {
  return `${state.language}:${id}`;
}

async function init() {
  await loadMaterials();
  recommendationService = window.MatFinderAI.createRecommendationService({ materials });
  categories = [...new Set(materials.map((material) => material.category))].sort((a, b) => a.localeCompare(b));

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = localizeTerm(category);
    elements.categoryFilter.append(option);
  });

  elements.totalCount.textContent = materials.length;
  bindEvents();
  applyLanguage();
  renderRecommendations();
  render();
}

async function loadMaterials() {
  const response = await fetch(apiUrl("/api/materials"));
  if (!response.ok) {
    throw new Error("Failed to load materials from SQLite.");
  }
  materials = await response.json();
}

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function bindEvents() {
  elements.filterToggleButton.addEventListener("click", () => {
    const isOpen = elements.filterToggleButton.getAttribute("aria-expanded") === "true";
    elements.filterToggleButton.setAttribute("aria-expanded", String(!isOpen));
    elements.filterToggleButton.closest(".filters").classList.toggle("is-open", !isOpen);
  });

  elements.languageSelect.addEventListener("change", (event) => {
    state.language = event.target.value;
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    applyLanguage();
    renderRecommendations();
    render();
    rerenderActiveAnalysis();
  });

  elements.recommendButton.addEventListener("click", runRecommendation);
  elements.requirementInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      runRecommendation();
    }
  });

  elements.clearRecommendationButton.addEventListener("click", () => {
    elements.requirementInput.value = "";
    state.recommendations = [];
    state.recommendationCriteria = [];
    renderRecommendations();
    render();
  });

  elements.exampleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      elements.requirementInput.value = state.language === "zh" ? button.dataset.exampleZh : button.dataset.exampleEn;
      runRecommendation();
    });
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  elements.categoryFilter.addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });

  elements.propertyFilter.addEventListener("change", (event) => {
    state.property = event.target.value;
    render();
  });

  elements.tempRange.addEventListener("input", (event) => {
    state.minTemp = Number(event.target.value);
    render();
  });

  elements.strengthRange.addEventListener("input", (event) => {
    state.minStrength = Number(event.target.value);
    render();
  });

  elements.recyclableOnly.addEventListener("change", (event) => {
    state.recyclableOnly = event.target.checked;
    render();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  elements.resetButton.addEventListener("click", () => {
    state.query = "";
    state.category = "all";
    state.property = "all";
    state.minTemp = 60;
    state.minStrength = 5;
    state.recyclableOnly = false;
    state.sort = "match";
    syncControls();
    render();
  });

  elements.clearCompareButton.addEventListener("click", () => {
    state.selected.clear();
    render();
  });

  elements.runAiCompareButton.addEventListener("click", runAiComparison);

  elements.closeDialogButton.addEventListener("click", () => elements.detailDialog.close());
  elements.detailDialog.addEventListener("click", (event) => {
    if (event.target === elements.detailDialog) {
      elements.detailDialog.close();
    }
  });
}

async function runRecommendation() {
  const result = await recommendationService.recommend(elements.requirementInput.value, { limit: 5 });
  state.recommendations = result.recommendations;
  state.recommendationCriteria = result.criteria;
  renderRecommendations(result);
  render();
}

function syncControls() {
  elements.searchInput.value = state.query;
  elements.categoryFilter.value = state.category;
  elements.propertyFilter.value = state.property;
  elements.tempRange.value = state.minTemp;
  elements.strengthRange.value = state.minStrength;
  elements.recyclableOnly.checked = state.recyclableOnly;
  elements.sortSelect.value = state.sort;
}

function formatValue(value, suffix = "") {
  if (value === null || value === undefined) {
    return t("none");
  }
  return `${value}${suffix}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function getSearchText(item) {
  return [
    item.name,
    materialName(item),
    item.abbr,
    item.category,
    materialCategory(item),
    item.summary,
    materialSummary(item),
    item.notes,
    ...item.tags,
    ...materialTags(item),
    ...item.uses,
    ...materialUses(item)
  ]
    .join(" ")
    .toLowerCase();
}

function getMatchScore(item) {
  const recommendation = state.recommendations.find((candidate) => candidate.material.id === item.id);
  if (recommendation) return recommendation.score + 100;
  if (!state.query) return 0;

  const query = state.query;
  let score = 0;
  if (item.name.toLowerCase().includes(query)) score += 8;
  if (item.abbr.toLowerCase().includes(query)) score += 10;
  if (item.tags.some((tag) => tag.toLowerCase().includes(query))) score += 5;
  if (item.uses.some((use) => use.toLowerCase().includes(query))) score += 4;
  if (item.summary.toLowerCase().includes(query)) score += 2;
  return score;
}

function localizedProfileText(en, zh) {
  return state.language === "zh" ? zh : en;
}

function materialAdvantageList(item) {
  const advantages = [];
  const tags = new Set(item.tags);
  const add = (en, zh) => advantages.push(localizedProfileText(en, zh));

  if (item.maxTemp >= 200) add(`High continuous use temperature of ${formatValue(item.maxTemp, " deg C")}.`, `连续使用温度可达 ${formatValue(item.maxTemp, " deg C")}。`);
  else if (item.maxTemp >= 120) add(`Useful heat resistance with continuous use up to ${formatValue(item.maxTemp, " deg C")}.`, `具备较好的耐热性，连续使用温度约 ${formatValue(item.maxTemp, " deg C")}。`);
  if (item.tensile >= 80) add(`High tensile strength for load-bearing applications.`, `拉伸强度较高，适合承载类应用。`);
  if (item.density && item.density <= 1) add(`Low density supports lightweight part design.`, `密度较低，有利于轻量化设计。`);
  if (tags.has("chemical resistant")) add(`Chemical resistance is represented in the local dataset tags.`, `本地数据标签体现出耐化学特征。`);
  if (tags.has("electrical insulation") || (item.dielectric !== null && item.dielectric <= 3.5)) add(`Suitable electrical insulation profile based on dielectric data or tags.`, `基于介电数据或标签，具备电绝缘应用潜力。`);
  if (tags.has("transparent") || tags.has("optical")) add(`Transparency or optical-use fit is indicated by the dataset.`, `数据集中体现出透明或光学用途适配性。`);
  if (tags.has("wear resistant") || tags.has("low friction")) add(`Wear or low-friction behavior is represented in the material profile.`, `材料档案体现出耐磨或低摩擦特征。`);
  if (item.recyclable) add(`Listed as recyclable in the local material database.`, `本地材料数据库中标记为可回收。`);

  if (!advantages.length) {
    add(`Balanced profile for the listed typical applications.`, `对已列出的典型应用具备综合适配性。`);
  }

  return [...new Set(advantages)].slice(0, 6);
}

function materialDisadvantageList(item) {
  const disadvantages = [];
  const add = (en, zh) => disadvantages.push(localizedProfileText(en, zh));

  if (!item.recyclable) add(`Not listed as recyclable in the local material database.`, `本地材料数据库中未标记为可回收。`);
  if (item.maxTemp !== null && item.maxTemp < 90) add(`Continuous use temperature is limited to ${formatValue(item.maxTemp, " deg C")}.`, `连续使用温度较低，约为 ${formatValue(item.maxTemp, " deg C")}。`);
  if (item.tensile !== null && item.tensile < 25) add(`Tensile strength is modest compared with higher-performance engineering plastics.`, `与高性能工程塑料相比，拉伸强度偏低。`);
  if (item.elongation !== null && item.elongation <= 10) add(`Low elongation suggests limited ductility or brittleness risk.`, `断裂伸长率较低，可能存在韧性不足或脆性风险。`);
  if (item.density !== null && item.density >= 1.7) add(`High density may be a drawback for lightweight designs.`, `密度较高，可能不利于轻量化设计。`);

  const missing = [
    item.tg === null ? "Tg" : null,
    item.tm === null ? "Tm" : null,
    item.tensile === null ? t("tensileStrength") : null,
    item.elongation === null ? t("elongation") : null,
    item.dielectric === null ? t("dielectricConstant") : null
  ].filter(Boolean);
  if (missing.length) {
    add(`Some profile values are not specified: ${missing.join(", ")}.`, `部分档案数值未明确：${missing.join("、")}。`);
  }

  if (item.notes) {
    const note = item.notes.split(/[.;。]/).find(Boolean);
    if (note) add(`Selection note: ${note.trim()}.`, `选材提示：${note.trim()}。`);
  }

  if (!disadvantages.length) {
    add(`No major limitation is explicitly called out beyond grade-specific verification.`, `除需按具体牌号验证外，当前数据未明确列出主要限制。`);
  }

  return [...new Set(disadvantages)].slice(0, 6);
}

function similarMaterials(item) {
  return materials
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate) => {
      const sharedTags = candidate.tags.filter((tag) => item.tags.includes(tag)).length;
      const sameCategory = candidate.category === item.category ? 8 : 0;
      const densityFit = item.density && candidate.density ? Math.max(0, 3 - Math.abs(item.density - candidate.density)) : 0;
      const tempFit = item.maxTemp !== null && candidate.maxTemp !== null ? Math.max(0, 4 - Math.abs(item.maxTemp - candidate.maxTemp) / 40) : 0;
      return { material: candidate, score: sameCategory + sharedTags * 3 + densityFit + tempFit };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
    .slice(0, 4)
    .map((entry) => entry.material);
}

function renderProfileList(items) {
  return `<ul class="profile-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderSources(item) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  if (!sources.length) {
    return `<p class="profile-muted">${t("noSources")}</p>`;
  }

  return `
    <div class="source-list">
      ${sources
        .map((source) => {
          const url = String(source.source_url || "");
          const isLink = /^https?:\/\//i.test(url);
          return `
            <article class="source-item">
              <h4>${escapeHtml(source.source_title)}</h4>
              <p><strong>${t("sourceType")}:</strong> ${escapeHtml(source.source_type)}</p>
              <p><strong>${t("sourceNotes")}:</strong> ${escapeHtml(source.notes)}</p>
              ${
                isLink
                  ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${t("viewSource")}</a>`
                  : `<code>${escapeHtml(url)}</code>`
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSimilarMaterials(item) {
  const similar = similarMaterials(item);
  if (!similar.length) {
    return `<p class="profile-muted">${t("notSpecified")}</p>`;
  }

  return `
    <div class="similar-grid">
      ${similar
        .map(
          (candidate) => `
            <button class="similar-card" type="button" data-profile-id="${candidate.id}">
              <span>${candidate.abbr}</span>
              <strong>${materialName(candidate)}</strong>
              <small>${materialCategory(candidate)}</small>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function getFilteredMaterials() {
  return materials
    .filter((item) => !state.query || getSearchText(item).includes(state.query))
    .filter((item) => state.category === "all" || item.category === state.category)
    .filter((item) => state.property === "all" || propertyPredicates[state.property](item))
    .filter((item) => item.maxTemp >= state.minTemp)
    .filter((item) => item.tensile >= state.minStrength)
    .filter((item) => !state.recyclableOnly || item.recyclable)
    .sort(sortMaterials);
}

function sortMaterials(a, b) {
  const byName = a.name.localeCompare(b.name);
  if (state.sort === "temperature") return b.maxTemp - a.maxTemp || byName;
  if (state.sort === "strength") return b.tensile - a.tensile || byName;
  if (state.sort === "density") return a.density - b.density || byName;
  if (state.sort === "name") return byName;
  return getMatchScore(b) - getMatchScore(a) || byName;
}

function render() {
  const filtered = getFilteredMaterials();
  elements.tempOutput.textContent = `>= ${state.minTemp} deg C`;
  elements.strengthOutput.textContent = `>= ${state.minStrength} MPa`;
  elements.selectedCount.textContent = state.selected.size;
  elements.resultTitle.textContent = `${filtered.length} ${t("matchingMaterials")}`;
  elements.emptyState.hidden = filtered.length > 0;

  renderChips();
  renderCards(filtered);
  renderCompare();
  renderAiComparePanel();
}

function renderRecommendations(result = null) {
  if (!state.recommendations.length) {
    elements.recommendationResults.innerHTML = `<p class="recommendation-empty">${t("noRecommendations")}</p>`;
    return;
  }

  const criteria = result?.criteria || state.recommendationCriteria;
  const criteriaText = criteria.length
    ? `${t("matchedRequirements")}: ${criteria.map(localizeTerm).join(state.language === "zh" ? "、" : ", ")}`
    : t("localDatasetMatch");
  elements.recommendationResults.innerHTML = `
    <div>
      <p class="result-label">${t("recommendedMaterials")}</p>
      <h2>${criteriaText}</h2>
    </div>
    ${state.recommendations.map(renderRecommendationCard).join("")}
  `;

  elements.recommendationResults.querySelectorAll("[data-detail-id]").forEach((button) => {
    button.addEventListener("click", () => showDetail(button.dataset.detailId));
  });
}

function renderRecommendationCard(candidate, index) {
  const item = candidate.material;
  return `
    <article class="recommendation-card">
      <span class="rank">${index + 1}</span>
      <div>
        <span class="category">${materialCategory(item)}</span>
        <h3>${materialName(item)} (${item.abbr})</h3>
        <p class="summary">${materialSummary(item)}</p>
        <div class="recommendation-reasons">
          ${candidate.reasons.map((reason) => `<span class="reason">${localizeRecommendationReason(reason)}</span>`).join("")}
        </div>
      </div>
      <div class="score-box">
        <div class="score-label"><span>${t("matchScore")}</span><strong>${candidate.score}</strong></div>
        <div class="score-track"><div class="score-fill" style="width: ${candidate.score}%"></div></div>
        <button type="button" data-detail-id="${item.id}">${t("detailsAi")}</button>
      </div>
    </article>
  `;
}

function renderChips() {
  const chips = [];
  if (state.query) chips.push(`${t("keyword")}: ${state.query}`);
  if (state.category !== "all") chips.push(`${t("category")}: ${localizeTerm(state.category)}`);
  if (state.property !== "all") chips.push(`${t("focus")}: ${elements.propertyFilter.selectedOptions[0].textContent}`);
  if (state.minTemp > 60) chips.push(`${t("temp")} >= ${state.minTemp} deg C`);
  if (state.minStrength > 5) chips.push(`${t("strength")} >= ${state.minStrength} MPa`);
  if (state.recyclableOnly) chips.push(t("recyclable"));

  elements.activeFilters.replaceChildren(
    ...chips.map((label) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = label;
      return chip;
    })
  );
}

function renderCards(items) {
  const recommendedIds = new Set(state.recommendations.map((candidate) => candidate.material.id));
  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const recommendation = state.recommendations.find((candidate) => candidate.material.id === item.id);
    const card = document.createElement("article");
    card.className = `material-card${recommendedIds.has(item.id) ? " is-recommended" : ""}`;
    card.innerHTML = `
      <div class="card-head">
        <div>
          <span class="category">${materialCategory(item)}</span>
          <h3>${materialName(item)}</h3>
        </div>
        <span class="abbr">${item.abbr}</span>
      </div>
      <div>
        ${recommendation ? `<span class="chip">${t("aiScore")} ${recommendation.score}</span>` : ""}
        <p class="summary">${materialSummary(item)}</p>
        <div class="metrics">
          <div class="metric"><span>${t("continuousUse")}</span><strong>${item.maxTemp} deg C</strong></div>
          <div class="metric"><span>${t("tensileStrength")}</span><strong>${formatValue(item.tensile, " MPa")}</strong></div>
          <div class="metric"><span>${t("density")}</span><strong>${formatValue(item.density, " g/cm3")}</strong></div>
          <div class="metric"><span>Tg / Tm</span><strong>${formatValue(item.tg, " deg C")} / ${formatValue(item.tm, " deg C")}</strong></div>
        </div>
        <div class="tag-list">${materialTags(item).map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
      </div>
      <div class="card-actions">
        <button class="primary-button detail-button" type="button" data-id="${item.id}">${t("detailsAi")}</button>
        <button class="compare-button" type="button" data-id="${item.id}" aria-pressed="${state.selected.has(item.id)}">
          ${state.selected.has(item.id) ? t("added") : t("compare")}
        </button>
      </div>
    `;

    card.querySelector(".detail-button").addEventListener("click", () => showDetail(item.id));
    card.querySelector(".compare-button").addEventListener("click", () => toggleCompare(item.id));
    fragment.append(card);
  });

  elements.materialsGrid.replaceChildren(fragment);
}

function toggleCompare(id) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    if (state.selected.size >= 4) {
      const first = state.selected.values().next().value;
      state.selected.delete(first);
    }
    state.selected.add(id);
  }
  render();
}

function renderCompare() {
  const selectedItems = materials.filter((item) => state.selected.has(item.id));
  elements.comparePanel.hidden = selectedItems.length === 0;

  if (!selectedItems.length) {
    elements.compareTableWrap.replaceChildren();
    return;
  }

  const rows = [
    [t("category"), (item) => materialCategory(item)],
    [t("density"), (item) => formatValue(item.density, " g/cm3")],
    [t("glassTransition"), (item) => formatValue(item.tg, " deg C")],
    [t("meltingPoint"), (item) => formatValue(item.tm, " deg C")],
    [t("continuousUse"), (item) => `${item.maxTemp} deg C`],
    [t("tensileStrength"), (item) => formatValue(item.tensile, " MPa")],
    [t("elongation"), (item) => formatValue(item.elongation, "%")],
    [t("dielectricConstant"), (item) => formatValue(item.dielectric)],
    [t("recyclable"), (item) => (item.recyclable ? t("yes") : t("specialtyStream"))],
    [t("typicalUses"), (item) => materialUses(item).join(state.language === "zh" ? "、" : ", ")]
  ];

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>${t("metric")}</th>
        ${selectedItems.map((item) => `<th>${item.abbr}<br>${materialName(item)}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          ([label, getter]) => `
            <tr>
              <th>${label}</th>
              ${selectedItems.map((item) => `<td>${getter(item)}</td>`).join("")}
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  elements.compareTableWrap.replaceChildren(table);
}

function getSelectedMaterials() {
  return [...state.selected].map((id) => materials.find((item) => item.id === id)).filter(Boolean);
}

function getAiComparePair() {
  return getSelectedMaterials().slice(0, 2);
}

function getAiCompareCacheKey(pair) {
  return `${state.language}:${pair.map((item) => item.id).sort().join("::")}`;
}

function renderAiComparePanel() {
  const selectedItems = getSelectedMaterials();
  const pair = selectedItems.slice(0, 2);
  const hasPair = pair.length === 2;

  elements.runAiCompareButton.disabled = !hasPair;

  if (!hasPair) {
    elements.aiCompareTitle.textContent = t("selectTwoMaterials");
    elements.aiCompareStatus.textContent = t("gptComparison");
    elements.aiCompareContent.innerHTML = `<p class="recommendation-empty">${t("aiCompareEmpty")}</p>`;
    return;
  }

  elements.aiCompareTitle.textContent = `${pair[0].abbr} vs ${pair[1].abbr}`;

  const cacheKey = getAiCompareCacheKey(pair);
  if (state.aiCompareCache.has(cacheKey)) {
    renderAiComparison(pair, state.aiCompareCache.get(cacheKey), t("cachedComparison"));
    return;
  }

  elements.aiCompareStatus.textContent = selectedItems.length > 2 ? t("usingFirstTwo") : t("ready");
  elements.aiCompareContent.innerHTML = `
    <p class="recommendation-empty">${t("selectReady", materialName(pair[0]), materialName(pair[1]))}</p>
  `;
}

async function runAiComparison() {
  const pair = getAiComparePair();
  if (pair.length !== 2) return;

  const cacheKey = getAiCompareCacheKey(pair);
  if (state.aiCompareCache.has(cacheKey)) {
    renderAiComparison(pair, state.aiCompareCache.get(cacheKey), t("cachedComparison"));
    return;
  }

  renderAiComparisonLoading(pair);

  try {
    const response = await fetch(apiUrl("/api/material-comparison"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialIds: pair.map((item) => item.id), language: state.language })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || payload.detail || "AI comparison failed");
    }

    state.aiCompareCache.set(cacheKey, payload.comparison);
    renderAiComparison(pair, payload.comparison, t("generatedByGpt"));
  } catch (error) {
    renderAiComparisonError(pair, error);
  }
}

function renderAiComparisonLoading(pair) {
  elements.aiCompareStatus.textContent = t("generating");
  elements.aiCompareContent.innerHTML = `
    <p class="recommendation-empty">${t("sendingComparison", materialName(pair[0]), materialName(pair[1]))}</p>
  `;
}

function renderAiComparison(pair, comparison, status) {
  elements.aiCompareStatus.textContent = status;
  elements.aiCompareContent.innerHTML = `
    <div class="analysis-block">
      <h3>${t("selectionAdvice")}</h3>
      <p>${comparison.selectionAdvice}</p>
    </div>
    <div class="analysis-grid">
      ${renderAnalysisList(t("keyDifferences"), comparison.keyDifferences)}
      ${renderAnalysisList(t("strengthsWeaknesses"), comparison.strengthsAndWeaknesses)}
      ${renderAnalysisList(t("recommendedUseCases"), comparison.recommendedUseCases)}
      <div class="analysis-block">
        <h3>${t("sourceOfTruth")}</h3>
        <p>${t("sourcePair", materialName(pair[0]), materialName(pair[1]))}</p>
      </div>
    </div>
  `;
}

function renderAiComparisonError(pair, error) {
  elements.aiCompareStatus.textContent = t("unavailable");
  const directFileHint = window.location.protocol === "file:" ? t("serverHint") : "";
  elements.aiCompareContent.innerHTML = `
    <div class="analysis-block">
      <h3>${t("comparisonFailed")}</h3>
      <p>${error.message}.${directFileHint}</p>
      <p>${t("comparisonNeedsServer", pair[0].abbr, pair[1].abbr)}</p>
    </div>
  `;
}

function legacyShowDetail(id) {
  const item = materials.find((material) => material.id === id);
  if (!item) return;

  selectMaterialForAnalysis(item);

  elements.detailContent.innerHTML = `
    <span class="category">${materialCategory(item)}</span>
    <h2>${materialName(item)} (${item.abbr})</h2>
    <p class="summary">${materialSummary(item)}</p>
    <div class="detail-grid">
      <div class="metric"><span>${t("density")}</span><strong>${formatValue(item.density, " g/cm3")}</strong></div>
      <div class="metric"><span>Tg / Tm</span><strong>${formatValue(item.tg, " deg C")} / ${formatValue(item.tm, " deg C")}</strong></div>
      <div class="metric"><span>${t("continuousUse")}</span><strong>${formatValue(item.maxTemp, " deg C")}</strong></div>
      <div class="metric"><span>${t("tensileStrength")}</span><strong>${formatValue(item.tensile, " MPa")}</strong></div>
      <div class="metric"><span>${t("elongation")}</span><strong>${formatValue(item.elongation, "%")}</strong></div>
      <div class="metric"><span>${t("dielectricConstant")}</span><strong>${formatValue(item.dielectric)}</strong></div>
    </div>
    <div class="detail-section">
      <h3>${t("typicalUses")}</h3>
      <p>${materialUses(item).join(state.language === "zh" ? "、" : ", ")}</p>
    </div>
    <div class="detail-section">
      <h3>${t("selectionNotes")}</h3>
      <p>${materialNotes(item)}</p>
    </div>
    <div class="tag-list">${materialTags(item).map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
  `;

  elements.detailDialog.showModal();
}

function showDetail(id) {
  const item = materials.find((material) => material.id === id);
  if (!item) return;

  selectMaterialForAnalysis(item);

  elements.detailContent.innerHTML = `
    <div class="profile-hero">
      <div>
        <span class="category">${materialCategory(item)}</span>
        <p class="result-label">${t("materialProfile")}</p>
        <h2>${materialName(item)} (${item.abbr})</h2>
        <p class="summary">${materialSummary(item)}</p>
      </div>
      <span class="profile-abbr">${item.abbr}</span>
    </div>

    <div class="profile-tags">${materialTags(item).map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>

    <section class="profile-section">
      <h3>${t("basicProperties")}</h3>
      <div class="detail-grid">
        <div class="metric"><span>${t("density")}</span><strong>${formatValue(item.density, " g/cm3")}</strong></div>
        <div class="metric"><span>${t("glassTransition")}</span><strong>${formatValue(item.tg, " deg C")}</strong></div>
        <div class="metric"><span>${t("meltingPoint")}</span><strong>${formatValue(item.tm, " deg C")}</strong></div>
        <div class="metric"><span>${t("continuousUse")}</span><strong>${formatValue(item.maxTemp, " deg C")}</strong></div>
        <div class="metric"><span>${t("tensileStrength")}</span><strong>${formatValue(item.tensile, " MPa")}</strong></div>
        <div class="metric"><span>${t("elongation")}</span><strong>${formatValue(item.elongation, "%")}</strong></div>
        <div class="metric"><span>${t("dielectricConstant")}</span><strong>${formatValue(item.dielectric)}</strong></div>
        <div class="metric"><span>${t("recyclable")}</span><strong>${item.recyclable ? t("yes") : t("specialtyStream")}</strong></div>
      </div>
    </section>

    <div class="profile-grid">
      <section class="profile-section">
        <h3>${t("advantages")}</h3>
        ${renderProfileList(materialAdvantageList(item))}
      </section>
      <section class="profile-section">
        <h3>${t("disadvantages")}</h3>
        ${renderProfileList(materialDisadvantageList(item))}
      </section>
      <section class="profile-section">
        <h3>${t("typicalUses")}</h3>
        ${renderProfileList(materialUses(item))}
      </section>
      <section class="profile-section">
        <h3>${t("similarMaterials")}</h3>
        ${renderSimilarMaterials(item)}
      </section>
    </div>

    <section class="profile-section">
      <h3>${t("selectionNotes")}</h3>
      <p>${escapeHtml(materialNotes(item))}</p>
    </section>

    <section class="profile-section">
      <h3>${t("materialSources")}</h3>
      ${renderSources(item)}
    </section>
  `;

  elements.detailContent.querySelectorAll("[data-profile-id]").forEach((button) => {
    button.addEventListener("click", () => showDetail(button.dataset.profileId));
  });

  if (!elements.detailDialog.open) {
    elements.detailDialog.showModal();
  }
}

async function selectMaterialForAnalysis(item) {
  state.selectedMaterialId = item.id;
  elements.analysisTitle.textContent = `${materialName(item)} (${item.abbr})`;

  const cacheKey = getLanguageCacheKey(item.id);
  if (state.analysisCache.has(cacheKey)) {
    renderAnalysis(item, state.analysisCache.get(cacheKey), t("cachedAnalysis"));
    return;
  }

  renderAnalysisLoading(item);

  try {
    const response = await fetch(apiUrl("/api/material-analysis"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: item.id, language: state.language })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || payload.detail || "AI analysis failed");
    }

    state.analysisCache.set(cacheKey, payload.analysis);
    if (state.selectedMaterialId === item.id) {
      renderAnalysis(item, payload.analysis, t("generatedByGpt"));
    }
  } catch (error) {
    if (state.selectedMaterialId === item.id) {
      renderAnalysisError(item, error);
    }
  }
}

function renderAnalysisLoading(item) {
  elements.analysisStatus.textContent = t("generating");
  elements.analysisContent.innerHTML = `
    <p class="recommendation-empty">${t("sendingAnalysis", materialName(item))}</p>
  `;
}

function renderAnalysis(item, analysis, status) {
  elements.analysisStatus.textContent = status;
  elements.analysisContent.innerHTML = `
    <div class="analysis-block">
      <h3>${t("materialOverview")}</h3>
      <p>${analysis.overview}</p>
    </div>
    <div class="analysis-grid">
      ${renderAnalysisList(t("advantages"), analysis.advantages)}
      ${renderAnalysisList(t("limitations"), analysis.limitations)}
      ${renderAnalysisList(t("recommendedApplications"), analysis.recommendedApplications)}
      <div class="analysis-block">
        <h3>${t("sourceOfTruth")}</h3>
        <p>${t("sourceSingle", materialName(item))}</p>
      </div>
    </div>
  `;
}

function renderAnalysisList(title, items) {
  const listItems = items.length ? items.map((item) => `<li>${item}</li>`).join("") : `<li>${t("notSpecified")}</li>`;
  return `
    <div class="analysis-block">
      <h3>${title}</h3>
      <ul>${listItems}</ul>
    </div>
  `;
}

function renderAnalysisError(item, error) {
  elements.analysisStatus.textContent = t("unavailable");
  const directFileHint = window.location.protocol === "file:" ? t("serverHint") : "";
  elements.analysisContent.innerHTML = `
    <div class="analysis-block">
      <h3>${t("analysisFailed")}</h3>
      <p>${error.message}.${directFileHint}</p>
      <p>${t("analysisNeedsServer", materialName(item))}</p>
    </div>
  `;
}

init().catch((error) => {
  elements.recommendationResults.innerHTML = `<p class="recommendation-empty">${error.message}</p>`;
  elements.materialsGrid.innerHTML = "";
  elements.emptyState.hidden = false;
  elements.emptyState.textContent = error.message;
});
