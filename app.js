let materials = [];
let recommendationService = null;
const materialDetailCache = new Map();
const apiBaseUrl = String(window.MatFinderConfig?.apiBaseUrl || "").replace(/\/$/, "");
const DEFAULT_MIN_TEMP = -200;
const DEFAULT_MIN_STRENGTH = 0;

const i18n = {
  zh: {
    brandEyebrow: "高分子为核心的工程材料数据库 + AI",
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
    allMaterials: "全部记录",
    noMatches: "没有匹配的材料。",
    comparisonLabel: "材料对比",
    performanceSnapshot: "性能速览",
    aiComparisonLabel: "AI 材料对比",
    selectTwoMaterials: "选择两种材料",
    compareWithAi: "AI 对比",
    gptComparison: "GPT 对比",
    aiCompareEmpty: "添加两种材料进行对比，即可基于本地高分子为核心数据集生成 GPT 对比。",
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
    flexuralStrength: "弯曲强度",
    impactStrength: "冲击强度",
    hardness: "硬度",
    density: "密度",
    glassTransition: "玻璃化温度",
    meltingPoint: "熔点",
    elongation: "断裂伸长率",
    thermalConductivity: "导热系数",
    dielectricConstant: "介电常数",
    chemicalResistance: "耐化学性",
    waterAbsorption: "吸水率",
    flammability: "阻燃/燃烧等级",
    costLevel: "成本等级",
    processingMethods: "加工方式",
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
    brandEyebrow: "Polymer-Centered Engineering Materials Database + AI",
    navHome: "Home",
    navMaterials: "Materials",
    navCompare: "Compare",
    navCopilot: "AI Copilot",
    navAbout: "About",
    languageLabel: "Language",
    filtersToggle: "Filters",
    materialsUnit: "materials",
    comparedUnit: "compared",
    homeHeroLabel: "MatFinder AI",
    homeHeroTitle: "AI-powered material selection assistant",
    homeHeroBody: "Focused on polymer engineering materials such as plastics, elastomers, and composites, with selected metals and other engineering materials for comparison.",
    startSelection: "Start Material Selection",
    homeStatMaterials: "materials",
    homeStatScoringValue: "Live",
    homeStatScoring: "Dynamic scoring",
    homeStatCompareValue: "3-way",
    homeStatCompare: "Material comparison",
    homeStatReportValue: "PDF",
    homeStatReport: "Report export",
    workflowRequirement: "Requirement",
    workflowRecommendation: "Recommendation",
    workflowExplanation: "Explanation",
    workflowReport: "Report",
    workflowRequirementHint: "Describe the application",
    workflowRecommendationHint: "Rank suitable materials",
    workflowExplanationHint: "Review reasons and risks",
    workflowReportHint: "Share the selection brief",
    requirementLabel: "Requirement description",
    requirementPlaceholder: "Need a lightweight, heat-resistant, electrically insulating material.",
    recommendButton: "Recommend",
    clearButton: "Clear",
    analysisPanelLabel: "Contextual AI Analysis",
    copilotLabel: "MatFinder AI Copilot",
    copilotTitle: "Ask about the selected material",
    copilotContextEmpty: "No material selected",
    copilotSend: "Ask",
    copilotPlaceholder: "Ask about recommendation reasons, advantages, limitations, or alternatives",
    copilotEmpty: "Open a material detail from Home recommendations or the polymer-centered library, then use Copilot for follow-up questions about that real material record.",
    copilotNoContext: "Open a material detail from Home or the polymer-centered library first so I can answer from a real material record.",
    copilotDefaultQuestion: "How should I evaluate this material?",
    copilotContextPrefix: "Using",
    copilotWhyTitle: "Recommendation rationale",
    copilotAdvantagesTitle: "Advantages",
    copilotLimitationsTitle: "Limitations",
    copilotAlternativesTitle: "Alternatives",
    copilotOverviewTitle: "Material snapshot",
    copilotScore: "Score",
    copilotMatchedRequirements: "Matched requirements",
    copilotNoRecommendation: "This material is not in the current recommendation result, so I am using the material profile only.",
    copilotSourceNote: "Answer based on local material data and the current scoring result.",
    selectMaterial: "Select a material",
    gptExplanation: "GPT explanation",
    analysisEmpty: "Open a material detail to make optional AI analysis available for that selected material.",
    keywordSearch: "Keyword search",
    searchPlaceholder: "Name, abbreviation, use, property",
    materialsPageLabel: "Polymer-centered database",
    materialsPageTitle: "Browse the polymer-centered engineering library",
    materialsPageBody: "Search plastics, elastomers, thermosets, composites, adhesives, coatings, foams, and selected comparison references such as metals and ceramics.",
    catalogTotalMaterials: "Total materials",
    catalogCategories: "Categories",
    catalogTopCategory: "Largest category",
    materialCategory: "Material category",
    allCategories: "All categories",
    polymerCategoryGroup: "Polymer materials",
    otherCategoryGroup: "Other engineering materials",
    performanceFocus: "Performance focus",
    applicationDomain: "Application domain",
    allDomains: "All domains",
    continuousTemp: "Continuous use temperature",
    minimumStrength: "Minimum tensile strength",
    recyclableOnly: "Recyclable only",
    resetButton: "Reset",
    databaseLabel: "Polymer-centered material database",
    sortLabel: "Sort",
    allMaterials: "All records",
    noMatches: "No matching materials.",
    comparisonLabel: "Material Comparison",
    performanceSnapshot: "Performance snapshot",
    comparePageLabel: "Material comparison",
    comparePageTitle: "Build a side-by-side shortlist",
    comparePageBody: "Compare selected materials in one focused table without the database browser in the way.",
    compareGuidance: "Select materials from Home or the polymer-centered library to compare.",
    selectedMaterials: "Selected materials",
    compareEmptyTitle: "No materials selected yet",
    compareEmptyBody: "Select materials from Home recommendation results or the polymer-centered library to build a comparison.",
    openHome: "Open Home",
    browseMaterials: "Browse Library",
    remove: "Remove",
    aiComparisonLabel: "Contextual AI Comparison",
    selectTwoMaterials: "Select two materials",
    compareWithAi: "Compare with AI",
    gptComparison: "GPT comparison",
    aiCompareEmpty: "Add two materials to Compare to generate a GPT comparison from the local polymer-centered dataset.",
    matchingMaterials: "matching materials",
    recommendedMaterials: "Recommended Materials",
    matchedRequirements: "Matched requirements",
    localDatasetMatch: "Local dataset match",
    noRecommendations: "Describe your application to generate recommendations.",
    emptyStateTitle: "Start with a real material challenge",
    emptyStateBody: "Try one of these use cases or write your own requirement in natural language.",
    emptyUseCaseOne: "EV battery sealing ring",
    emptyUseCaseTwo: "Transparent impact-resistant cover",
    emptyUseCaseThree: "Chemical corrosion-resistant seal",
    matchScore: "Match score",
    matchStatusTitle: "Match status",
    matchStatusPendingValue: "Waiting for requirement",
    matchStatusPendingHelper: "Enter selection needs to generate a match score",
    detailsAi: "View explanation",
    askCopilot: "Ask Copilot",
    exportReport: "Export PDF report",
    reportTitle: "Material Selection Report",
    reportRequirementText: "User requirement",
    reportDetectedRequirements: "Detected requirements",
    reportTopMaterials: "Top 5 recommended materials",
    reportWarnings: "Warnings and limitations",
    reportAlternatives: "Alternative materials",
    reportDate: "Date",
    reportProject: "Project",
    reportNoWarnings: "No major unmatched requirement warnings were flagged by the scoring engine.",
    aboutLabel: "About MatFinder AI",
    aboutTitle: "A polymer-centered workflow for early material selection",
    aboutIntro: "MatFinder AI turns polymer-centered engineering requirements into ranked material candidates, explains the match, and produces a report you can review with engineering, sourcing, or suppliers.",
    aboutCategoriesUnit: "categories",
    aboutDatasetTitle: "Dataset",
    aboutProblemTitle: "Problem",
    aboutProblemBody: "Early polymer and engineering material selection is slow because requirements are written in natural language while grade data lives in tables, datasheets, and supplier notes.",
    aboutSolutionTitle: "Solution",
    aboutSolutionBody: "MatFinder AI turns a plain-language requirement into a ranked shortlist for plastics, elastomers, composites, thermosets, adhesives, coatings, and foams, then keeps selected metals and other materials available as comparison references.",
    aboutEngineTitle: "Recommendation Logic",
    aboutEngineBody: "The engine parses Chinese and English requirements, detects performance needs, scores each material, and explains matched reasons and limitations.",
    aboutScoringOne: "Parse the requirement for material, performance, application, and constraint signals.",
    aboutScoringTwo: "Match those signals against polymer-centered tags, properties, uses, and numeric thresholds in the local dataset.",
    aboutScoringThree: "Rank candidates with explainable reasons, warnings, and similar alternatives.",
    aboutFeaturesTitle: "Key features",
    aboutFeatureOne: "Requirement-to-shortlist recommendation workflow.",
    aboutFeatureTwo: "Searchable, filterable polymer-centered material catalog.",
    aboutFeatureThree: "Side-by-side comparison for up to three materials.",
    aboutFeatureFour: "PDF-style report export for selection reviews.",
    aboutTrustTitle: "Current Limitations",
    aboutTrustBody: "MatFinder AI is not trying to be a complete all-materials database. It is a screening aid for polymer-centered engineering materials; selected metal and ceramic records are retained as useful comparison references, and all final choices should be checked against supplier datasheets.",
    aboutValidationTitle: "Before final selection",
    aboutValidationOne: "Confirm grade-level datasheets and supplier availability.",
    aboutValidationTwo: "Validate processing method, environment, and long-term load.",
    aboutValidationThree: "Use the exported report as a selection brief, not a final certification.",
    aboutRoadmapTitle: "Future Roadmap",
    aboutRoadmapOne: "Grade-level datasheet links and supplier records.",
    aboutRoadmapTwo: "More domain presets for automotive, electronics, medical, packaging, and sustainability use cases.",
    aboutRoadmapThree: "Richer export templates for engineering reviews and sourcing conversations.",
    recommendationExplanation: "Recommendation explanation",
    materialSummaryHeading: "Material summary",
    recommendationSummary: "Recommendation summary",
    aiRecommendationSummary: "AI recommendation summary",
    matchReasons: "Match reasons",
    riskLimitations: "Limitations / risk notes",
    scoringReasons: "Scoring engine reasons",
    unmatchedWarnings: "Unmatched warnings / limitations",
    keyProperties: "Key properties",
    alternativeMaterials: "Similar alternatives",
    chineseExplanation: "Chinese explanation",
    englishExplanation: "English explanation",
    similarityScore: "Similarity",
    noAlternativeMaterials: "No ranked similar materials are available in the local dataset.",
    propertyTransparency: "Transparency",
    propertyFlexibility: "Flexibility",
    propertyElectricalInsulation: "Electrical insulation",
    propertyWaterproof: "Waterproof / low moisture",
    propertyFlameRetardant: "Flame retardant",
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
    flexuralStrength: "Flexural strength",
    impactStrength: "Impact strength",
    hardness: "Hardness",
    density: "Density",
    glassTransition: "Glass transition",
    meltingPoint: "Melting point",
    elongation: "Elongation",
    thermalConductivity: "Thermal conductivity",
    dielectricConstant: "Dielectric constant",
    chemicalResistance: "Chemical resistance",
    waterAbsorption: "Water absorption",
    flammability: "Flammability",
    costLevel: "Cost level",
    processingMethods: "Processing methods",
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
    sourceSingle: (name) => `GPT received only the local dataset entry for ${name}. Numeric properties and applications remain sourced from MatFinder's local dataset.`,
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
    examples: ["EV battery seal", "Transparent impact cover", "Chemical-resistant seal"],
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

const zhDetailLabels = {
  navHome: "\u9996\u9875",
  navMaterials: "\u6750\u6599\u5e93",
  navCompare: "\u6750\u6599\u5bf9\u6bd4",
  navCopilot: "AI \u52a9\u624b",
  navAbout: "\u5173\u4e8e",
  brandEyebrow: "\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u5de5\u7a0b\u6750\u6599\u6570\u636e\u5e93 + AI",
  languageLabel: "\u8bed\u8a00",
  filtersToggle: "\u7b5b\u9009",
  materialsUnit: "\u79cd\u6750\u6599",
  comparedUnit: "\u4e2a\u5bf9\u6bd4",
  homeHeroLabel: "MatFinder AI",
  homeHeroTitle: "AI \u6750\u6599\u9009\u578b\u52a9\u624b",
  homeHeroBody: "\u4e13\u6ce8\u5851\u6599\u3001\u5f39\u6027\u4f53\u3001\u590d\u5408\u6750\u6599\u7b49\u9ad8\u5206\u5b50\u5de5\u7a0b\u6750\u6599\uff0c\u5e76\u652f\u6301\u90e8\u5206\u91d1\u5c5e\u4e0e\u5176\u4ed6\u5de5\u7a0b\u6750\u6599\u7684\u5bf9\u6bd4\u5206\u6790\u3002",
  startSelection: "\u5f00\u59cb\u6750\u6599\u9009\u578b",
  homeStatMaterials: "\u6750\u6599\u6570\u636e",
  homeStatScoringValue: "\u52a8\u6001",
  homeStatScoring: "\u5b9e\u65f6\u8bc4\u5206",
  homeStatCompareValue: "3 \u79cd",
  homeStatCompare: "\u6750\u6599\u5bf9\u6bd4",
  homeStatReportValue: "PDF",
  homeStatReport: "\u62a5\u544a\u5bfc\u51fa",
  workflowRequirement: "\u8f93\u5165\u9700\u6c42",
  workflowRecommendation: "\u83b7\u5f97\u63a8\u8350",
  workflowExplanation: "\u67e5\u770b\u89e3\u91ca",
  workflowReport: "\u5bfc\u51fa\u62a5\u544a",
  workflowRequirementHint: "\u63cf\u8ff0\u5e94\u7528\u573a\u666f",
  workflowRecommendationHint: "\u751f\u6210\u6750\u6599\u6392\u540d",
  workflowExplanationHint: "\u67e5\u770b\u7406\u7531\u4e0e\u98ce\u9669",
  workflowReportHint: "\u5bfc\u51fa\u9009\u578b\u7b80\u62a5",
  requirementLabel: "\u9700\u6c42\u63cf\u8ff0",
  requirementPlaceholder: "\u4f8b\u5982\uff1a\u6211\u8981\u505a\u65b0\u80fd\u6e90\u6c7d\u8f66\u7535\u6c60\u5bc6\u5c01\u5708\u3002",
  recommendButton: "\u63a8\u8350\u6750\u6599",
  clearButton: "\u6e05\u7a7a",
  analysisPanelLabel: "\u4e0a\u4e0b\u6587 AI \u5206\u6790",
  selectMaterial: "\u9009\u62e9\u4e00\u79cd\u6750\u6599",
  gptExplanation: "GPT \u89e3\u91ca",
  analysisEmpty: "\u6253\u5f00\u6750\u6599\u8be6\u60c5\u540e\uff0c\u53ef\u4ee5\u5728\u8fd9\u91cc\u67e5\u770b\u8be5\u6750\u6599\u7684\u53ef\u9009 AI \u5206\u6790\u3002",
  keywordSearch: "\u5173\u952e\u8bcd\u641c\u7d22",
  searchPlaceholder: "\u540d\u79f0\u3001\u7f29\u5199\u3001\u7528\u9014\u3001\u6027\u80fd",
  materialsPageLabel: "\u9ad8\u5206\u5b50\u6750\u6599\u6570\u636e\u5e93",
  materialsPageTitle: "\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u5de5\u7a0b\u6750\u6599\u5e93",
  materialsPageBody: "\u641c\u7d22\u3001\u7b5b\u9009\u5e76\u5bf9\u6bd4\u5851\u6599\u3001\u5f39\u6027\u4f53\u3001\u70ed\u56fa\u6027\u6750\u6599\u3001\u590d\u5408\u6750\u6599\u3001\u80f6\u7c98\u5242\u3001\u6d82\u5c42\u548c\u6ce1\u6cab\u6750\u6599\uff0c\u540c\u65f6\u4fdd\u7559\u90e8\u5206\u91d1\u5c5e\u4e0e\u5176\u4ed6\u5de5\u7a0b\u6750\u6599\u4f5c\u4e3a\u6a2a\u5411\u5bf9\u6bd4\u53c2\u8003\u3002",
  catalogTotalMaterials: "\u6750\u6599\u603b\u6570",
  catalogCategories: "\u6750\u6599\u7c7b\u522b",
  catalogTopCategory: "\u6700\u5927\u7c7b\u522b",
  materialCategory: "\u6750\u6599\u7c7b\u522b",
  allCategories: "\u5168\u90e8\u7c7b\u522b",
  polymerCategoryGroup: "\u9ad8\u5206\u5b50\u6750\u6599",
  otherCategoryGroup: "\u5176\u4ed6\u5de5\u7a0b\u6750\u6599",
  performanceFocus: "\u6027\u80fd\u91cd\u70b9",
  applicationDomain: "\u5e94\u7528\u9886\u57df",
  allDomains: "\u5168\u90e8\u9886\u57df",
  continuousTemp: "\u8fde\u7eed\u4f7f\u7528\u6e29\u5ea6",
  minimumStrength: "\u6700\u4f4e\u62c9\u4f38\u5f3a\u5ea6",
  recyclableOnly: "\u4ec5\u53ef\u56de\u6536",
  resetButton: "\u91cd\u7f6e",
  databaseLabel: "\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u5de5\u7a0b\u6750\u6599\u5e93",
  sortLabel: "\u6392\u5e8f",
  allMaterials: "\u5168\u90e8\u8bb0\u5f55",
  noMatches: "\u6ca1\u6709\u5339\u914d\u7684\u6750\u6599\u3002",
  comparisonLabel: "\u6750\u6599\u5bf9\u6bd4",
  performanceSnapshot: "\u6027\u80fd\u901f\u89c8",
  selectTwoMaterials: "\u9009\u62e9\u4e24\u79cd\u6750\u6599",
  compareWithAi: "AI \u5bf9\u6bd4",
  gptComparison: "GPT \u5bf9\u6bd4",
  aiCompareEmpty: "\u6dfb\u52a0\u4e24\u79cd\u6750\u6599\u8fdb\u884c\u5bf9\u6bd4\uff0c\u5373\u53ef\u57fa\u4e8e\u672c\u5730\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u6570\u636e\u96c6\u751f\u6210 GPT \u5bf9\u6bd4\u3002",
  matchingMaterials: "\u4e2a\u5339\u914d\u6750\u6599",
  recommendedMaterials: "\u63a8\u8350\u6750\u6599",
  matchedRequirements: "\u5339\u914d\u9700\u6c42",
  localDatasetMatch: "\u672c\u5730\u6570\u636e\u5339\u914d",
  noRecommendations: "\u8f93\u5165\u5e94\u7528\u9700\u6c42\u540e\u751f\u6210\u63a8\u8350\u6750\u6599\u3002",
  emptyStateTitle: "\u4ece\u4e00\u4e2a\u771f\u5b9e\u9009\u6750\u95ee\u9898\u5f00\u59cb",
  emptyStateBody: "\u9009\u62e9\u4e0b\u65b9\u7528\u4f8b\uff0c\u6216\u76f4\u63a5\u7528\u81ea\u7136\u8bed\u8a00\u5199\u4e0b\u4f60\u7684\u9700\u6c42\u3002",
  emptyUseCaseOne: "\u65b0\u80fd\u6e90\u6c7d\u8f66\u7535\u6c60\u5bc6\u5c01\u5708",
  emptyUseCaseTwo: "\u900f\u660e\u6297\u51b2\u51fb\u9632\u62a4\u7f69",
  emptyUseCaseThree: "\u8010\u5316\u5b66\u8150\u8680\u5bc6\u5c01\u6750\u6599",
  matchScore: "\u5339\u914d\u5206",
  matchStatusTitle: "\u5339\u914d\u72b6\u6001",
  matchStatusPendingValue: "\u5f85\u8f93\u5165\u9700\u6c42",
  matchStatusPendingHelper: "\u8f93\u5165\u9009\u578b\u9700\u6c42\u540e\u751f\u6210\u5339\u914d\u8bc4\u5206",
  detailsAi: "\u67e5\u770b\u89e3\u91ca",
  aiScore: "AI \u5206\u6570",
  added: "\u5df2\u52a0\u5165",
  compare: "\u5bf9\u6bd4",
  keyword: "\u5173\u952e\u8bcd",
  category: "\u7c7b\u522b",
  focus: "\u91cd\u70b9",
  temp: "\u6e29\u5ea6",
  strength: "\u5f3a\u5ea6",
  recyclable: "\u53ef\u56de\u6536",
  none: "\u65e0",
  continuousUse: "\u8fde\u7eed\u4f7f\u7528",
  tensileStrength: "\u62c9\u4f38\u5f3a\u5ea6",
  flexuralStrength: "\u5f2f\u66f2\u5f3a\u5ea6",
  impactStrength: "\u51b2\u51fb\u5f3a\u5ea6",
  hardness: "\u786c\u5ea6",
  density: "\u5bc6\u5ea6",
  glassTransition: "\u73bb\u7483\u5316\u6e29\u5ea6",
  meltingPoint: "\u7194\u70b9",
  elongation: "\u65ad\u88c2\u4f38\u957f\u7387",
  thermalConductivity: "\u5bfc\u70ed\u7cfb\u6570",
  dielectricConstant: "\u4ecb\u7535\u5e38\u6570",
  chemicalResistance: "\u8010\u5316\u5b66\u6027",
  waterAbsorption: "\u5438\u6c34\u7387",
  flammability: "\u963b\u71c3 / \u71c3\u70e7\u7b49\u7ea7",
  costLevel: "\u6210\u672c\u7b49\u7ea7",
  processingMethods: "\u52a0\u5de5\u65b9\u5f0f",
  typicalUses: "\u5178\u578b\u7528\u9014",
  selectionNotes: "\u9009\u6750\u63d0\u793a",
  metric: "\u6307\u6807",
  yes: "\u662f",
  specialtyStream: "\u9700\u4e13\u9879\u56de\u6536\u4f53\u7cfb",
  ready: "\u5c31\u7eea",
  usingFirstTwo: "\u4f7f\u7528\u524d\u4e24\u9879",
  generating: "\u751f\u6210\u4e2d...",
  unavailable: "\u4e0d\u53ef\u7528",
  cachedAnalysis: "\u5df2\u7f13\u5b58\u7684 GPT \u5206\u6790",
  generatedByGpt: "GPT \u5df2\u751f\u6210",
  cachedComparison: "\u5df2\u7f13\u5b58\u7684 GPT \u5bf9\u6bd4",
  materialOverview: "\u6750\u6599\u6982\u89c8",
  materialProfile: "\u6750\u6599\u6863\u6848",
  basicProperties: "\u57fa\u7840\u6027\u80fd",
  advantages: "\u4f18\u52bf",
  disadvantages: "\u52a3\u52bf",
  limitations: "\u9650\u5236",
  recommendedApplications: "\u63a8\u8350\u5e94\u7528",
  similarMaterials: "\u76f8\u4f3c\u6750\u6599",
  materialSources: "\u6750\u6599\u6765\u6e90\u4fe1\u606f",
  sourceType: "\u6765\u6e90\u7c7b\u578b",
  sourceNotes: "\u6765\u6e90\u8bf4\u660e",
  viewSource: "\u67e5\u770b\u6765\u6e90",
  noSources: "\u5f53\u524d\u6750\u6599\u6682\u65e0\u6765\u6e90\u8bb0\u5f55\u3002",
  sourceOfTruth: "\u6570\u636e\u6765\u6e90",
  sourceSingle: (name) => `GPT \u53ea\u63a5\u6536\u4e86\u672c\u5730\u6570\u636e\u96c6\u4e2d ${name} \u7684\u6750\u6599\u6863\u6848\uff1b\u6570\u503c\u5c5e\u6027\u548c\u5e94\u7528\u4ecd\u4ee5 MatFinder \u672c\u5730\u6570\u636e\u5e93\u4e3a\u51c6\u3002`,
  sourcePair: (a, b) => `GPT \u53ea\u63a5\u6536\u4e86\u672c\u5730\u6570\u636e\u96c6\u4e2d ${a} \u548c ${b} \u7684\u6750\u6599\u6863\u6848\uff1b\u6807\u51c6\u5bf9\u6bd4\u8868\u4fdd\u6301\u4e0d\u53d8\u3002`,
  selectReady: (a, b) => `\u5df2\u51c6\u5907\u5bf9\u6bd4 ${a} \u548c ${b}\u3002\u4e0a\u65b9\u73b0\u6709\u5bf9\u6bd4\u8868\u4fdd\u6301\u4e0d\u53d8\u3002`,
  sendingAnalysis: (name) => `\u6b63\u5728\u628a\u672c\u5730\u6570\u636e\u5e93\u4e2d\u7684 ${name} \u5c5e\u6027\u53d1\u9001\u7ed9 GPT \u8fdb\u884c\u89e3\u91ca\u3002`,
  sendingComparison: (a, b) => `\u6b63\u5728\u628a ${a} \u548c ${b} \u7684\u672c\u5730\u6750\u6599\u6863\u6848\u53d1\u9001\u7ed9 GPT \u8fdb\u884c\u5bf9\u6bd4\u3002`,
  analysisFailed: "AI \u5206\u6790\u65e0\u6cd5\u751f\u6210",
  comparisonFailed: "AI \u5bf9\u6bd4\u65e0\u6cd5\u751f\u6210",
  serverHint: " \u8bf7\u8fd0\u884c npm.cmd start \u5e76\u6253\u5f00 http://localhost:3000\u3002",
  notSpecified: "\u7ed9\u5b9a\u6750\u6599\u6570\u636e\u4e2d\u672a\u8bf4\u660e\u3002",
  selectionAdvice: "\u9009\u62e9\u5efa\u8bae",
  keyDifferences: "\u5173\u952e\u5dee\u5f02",
  strengthsWeaknesses: "\u5f3a\u9879\u4e0e\u5f31\u9879",
  recommendedUseCases: "\u63a8\u8350\u4f7f\u7528\u573a\u666f",
  examples: ["\u65b0\u80fd\u6e90\u6c7d\u8f66\u7535\u6c60\u5bc6\u5c01\u5708", "\u900f\u660e\u6297\u51b2\u51fb\u9632\u62a4\u7f69", "\u8010\u5316\u5b66\u8150\u8680\u5bc6\u5c01\u6750\u6599"],
  propertyOptions: {
    all: "\u7efc\u5408",
    "high-temp": "\u8010\u70ed",
    strength: "\u9ad8\u5f3a\u5ea6",
    chemical: "\u8010\u5316\u5b66",
    transparent: "\u900f\u660e",
    elastomer: "\u5f39\u6027\u4f53",
    sustainable: "\u53ef\u6301\u7eed",
    electrical: "\u7535\u7edd\u7f18"
  },
  sortOptions: {
    match: "\u76f8\u5173\u5ea6",
    temperature: "\u4f7f\u7528\u6e29\u5ea6",
    strength: "\u62c9\u4f38\u5f3a\u5ea6",
    density: "\u5bc6\u5ea6",
    name: "\u540d\u79f0"
  },
  recommendationExplanation: "\u63a8\u8350\u89e3\u91ca",
  materialSummaryHeading: "\u6750\u6599\u6458\u8981",
  recommendationSummary: "\u63a8\u8350\u6458\u8981",
  aiRecommendationSummary: "AI \u63a8\u8350\u6458\u8981",
  matchReasons: "\u5339\u914d\u539f\u56e0",
  riskLimitations: "\u9650\u5236 / \u98ce\u9669\u63d0\u793a",
  scoringReasons: "\u8bc4\u5206\u5f15\u64ce\u5339\u914d\u539f\u56e0",
  unmatchedWarnings: "\u672a\u5339\u914d\u8b66\u544a / \u9650\u5236",
  keyProperties: "\u5173\u952e\u5c5e\u6027",
  alternativeMaterials: "\u76f8\u4f3c\u66ff\u4ee3\u6750\u6599",
  chineseExplanation: "\u4e2d\u6587\u89e3\u91ca",
  englishExplanation: "\u82f1\u6587\u89e3\u91ca",
  similarityScore: "\u76f8\u4f3c\u5ea6",
  noAlternativeMaterials: "\u672c\u5730\u6570\u636e\u4e2d\u6682\u65e0\u53ef\u6392\u5e8f\u7684\u76f8\u4f3c\u6750\u6599\u3002",
  propertyTransparency: "\u900f\u660e\u6027",
  propertyFlexibility: "\u67d4\u97e7\u6027",
  propertyElectricalInsulation: "\u7535\u7edd\u7f18",
  propertyWaterproof: "\u9632\u6c34 / \u4f4e\u5438\u6c34",
  propertyFlameRetardant: "\u963b\u71c3",
  copilotLabel: "MatFinder AI \u52a9\u624b",
  copilotTitle: "\u8be2\u95ee\u5f53\u524d\u6750\u6599",
  copilotContextEmpty: "\u5c1a\u672a\u9009\u62e9\u6750\u6599",
  copilotSend: "\u63d0\u95ee",
  copilotPlaceholder: "\u8be2\u95ee\u63a8\u8350\u539f\u56e0\u3001\u4f18\u52bf\u3001\u9650\u5236\u6216\u66ff\u4ee3\u6750\u6599",
  copilotEmpty: "\u5148\u4ece\u9996\u9875\u63a8\u8350\u7ed3\u679c\u6216\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u6750\u6599\u5e93\u6253\u5f00\u4e00\u4e2a\u6750\u6599\u8be6\u60c5\uff0c\u7136\u540e\u7528 Copilot \u8ffd\u95ee\u8be5\u6750\u6599\u7684\u4f18\u52bf\u3001\u9650\u5236\u6216\u66ff\u4ee3\u65b9\u6848\u3002",
  copilotNoContext: "\u8bf7\u5148\u4ece\u9996\u9875\u6216\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u6750\u6599\u5e93\u6253\u5f00\u4e00\u4e2a\u6750\u6599\u8be6\u60c5\uff0c\u6211\u624d\u80fd\u57fa\u4e8e\u771f\u5b9e\u6750\u6599\u6570\u636e\u56de\u7b54\u3002",
  copilotDefaultQuestion: "\u5e94\u8be5\u5982\u4f55\u8bc4\u4f30\u8fd9\u79cd\u6750\u6599\uff1f",
  copilotContextPrefix: "\u5f53\u524d\u6750\u6599",
  copilotWhyTitle: "\u63a8\u8350\u7406\u7531",
  copilotAdvantagesTitle: "\u4f18\u52bf",
  copilotLimitationsTitle: "\u9650\u5236",
  copilotAlternativesTitle: "\u66ff\u4ee3\u6750\u6599",
  copilotOverviewTitle: "\u6750\u6599\u5feb\u7167",
  copilotScore: "\u5206\u6570",
  copilotMatchedRequirements: "\u5339\u914d\u9700\u6c42",
  copilotNoRecommendation: "\u8be5\u6750\u6599\u4e0d\u5728\u5f53\u524d\u63a8\u8350\u7ed3\u679c\u4e2d\uff0c\u56e0\u6b64\u6211\u53ea\u4f7f\u7528\u6750\u6599\u6863\u6848\u56de\u7b54\u3002",
  copilotSourceNote: "\u56de\u7b54\u57fa\u4e8e\u672c\u5730\u6750\u6599\u6570\u636e\u548c\u5f53\u524d\u8bc4\u5206\u7ed3\u679c\u3002",
  exportReport: "\u5bfc\u51fa PDF \u62a5\u544a",
  askCopilot: "\u8be2\u95ee Copilot",
  reportTitle: "\u6750\u6599\u9009\u578b\u62a5\u544a",
  reportRequirementText: "\u7528\u6237\u9700\u6c42",
  reportDetectedRequirements: "\u8bc6\u522b\u9700\u6c42",
  reportTopMaterials: "Top 5 \u63a8\u8350\u6750\u6599",
  reportWarnings: "\u8b66\u544a\u548c\u9650\u5236",
  reportAlternatives: "\u66ff\u4ee3\u6750\u6599",
  reportDate: "\u65e5\u671f",
  reportProject: "\u9879\u76ee",
  reportNoWarnings: "\u8bc4\u5206\u5f15\u64ce\u672a\u6807\u51fa\u4e3b\u8981\u672a\u5339\u914d\u8b66\u544a\u3002",
  comparePageLabel: "\u6750\u6599\u5bf9\u6bd4",
  comparePageTitle: "\u5efa\u7acb\u5e76\u6392\u7684\u6750\u6599\u5019\u9009\u6e05\u5355",
  comparePageBody: "\u5728\u4e13\u95e8\u7684\u8868\u683c\u4e2d\u5bf9\u6bd4\u5df2\u9009\u6750\u6599\uff0c\u4e0d\u518d\u6df7\u5165\u6750\u6599\u5e93\u6d4f\u89c8\u5668\u3002",
  compareGuidance: "\u8bf7\u4ece\u9996\u9875\u6216\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u6750\u6599\u5e93\u9009\u62e9\u6750\u6599\u8fdb\u884c\u5bf9\u6bd4\u3002",
  selectedMaterials: "\u5df2\u9009\u6750\u6599",
  compareEmptyTitle: "\u5c1a\u672a\u9009\u62e9\u6750\u6599",
  compareEmptyBody: "\u4ece\u9996\u9875\u63a8\u8350\u7ed3\u679c\u6216\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u7684\u6750\u6599\u5e93\u9009\u62e9\u6750\u6599\uff0c\u5373\u53ef\u751f\u6210\u5bf9\u6bd4\u8868\u3002",
  openHome: "\u6253\u5f00\u9996\u9875",
  browseMaterials: "\u6d4f\u89c8\u9ad8\u5206\u5b50\u6750\u6599\u5e93",
  remove: "\u79fb\u9664",
  aiComparisonLabel: "\u4e0a\u4e0b\u6587 AI \u5bf9\u6bd4",
  aboutLabel: "\u5173\u4e8e MatFinder AI",
  aboutTitle: "\u4ee5\u9ad8\u5206\u5b50\u6750\u6599\u4e3a\u6838\u5fc3\u7684\u65e9\u671f\u9009\u578b\u5de5\u4f5c\u6d41",
  aboutIntro: "MatFinder AI \u9762\u5411\u9ad8\u5206\u5b50\u5de5\u7a0b\u6750\u6599\u9009\u578b\uff0c\u628a\u4ea7\u54c1\u9700\u6c42\u8f6c\u6210\u5019\u9009\u6750\u6599\u3001\u89e3\u91ca\u5339\u914d\u7406\u7531\uff0c\u5e76\u751f\u6210\u53ef\u4e0e\u5de5\u7a0b\u3001\u91c7\u8d2d\u6216\u4f9b\u5e94\u5546\u8ba8\u8bba\u7684\u9009\u578b\u62a5\u544a\u3002",
  aboutCategoriesUnit: "\u4e2a\u7c7b\u522b",
  aboutDatasetTitle: "\u6570\u636e\u96c6",
  aboutProblemTitle: "\u95ee\u9898",
  aboutProblemBody: "\u65e9\u671f\u9ad8\u5206\u5b50\u6750\u6599\u9009\u578b\u5f80\u5f80\u5f88\u6162\uff1a\u9700\u6c42\u662f\u81ea\u7136\u8bed\u8a00\uff0c\u800c\u5851\u6599\u3001\u5f39\u6027\u4f53\u3001\u590d\u5408\u6750\u6599\u7b49\u6570\u636e\u5206\u6563\u5728\u8868\u683c\u3001\u6570\u636e\u8868\u548c\u4f9b\u5e94\u5546\u8bf4\u660e\u4e2d\u3002",
  aboutSolutionTitle: "\u89e3\u51b3\u65b9\u6848",
  aboutSolutionBody: "MatFinder AI \u805a\u7126\u5851\u6599\u3001\u5f39\u6027\u4f53\u3001\u70ed\u56fa\u6027\u6750\u6599\u3001\u590d\u5408\u6750\u6599\u3001\u80f6\u7c98\u5242\u3001\u6d82\u5c42\u548c\u6ce1\u6cab\u6750\u6599\u7684\u65e9\u671f\u7b5b\u9009\uff0c\u540c\u65f6\u4fdd\u7559\u90e8\u5206\u91d1\u5c5e\u3001\u9676\u74f7\u7b49\u5de5\u7a0b\u6750\u6599\u4f5c\u4e3a\u6a2a\u5411\u5bf9\u6bd4\u53c2\u8003\u3002",
  aboutEngineTitle: "\u63a8\u8350\u903b\u8f91",
  aboutEngineBody: "\u5f15\u64ce\u652f\u6301\u4e2d\u82f1\u6587\u9700\u6c42\u89e3\u6790\uff0c\u8bc6\u522b\u6027\u80fd\u9700\u6c42\uff0c\u4e3a\u6750\u6599\u6253\u5206\uff0c\u5e76\u89e3\u91ca\u5339\u914d\u539f\u56e0\u548c\u9650\u5236\u3002",
  aboutScoringOne: "\u89e3\u6790\u9700\u6c42\u4e2d\u7684\u6750\u6599\u3001\u6027\u80fd\u3001\u5e94\u7528\u548c\u9650\u5236\u4fe1\u53f7\u3002",
  aboutScoringTwo: "\u5c06\u8fd9\u4e9b\u4fe1\u53f7\u4e0e\u672c\u5730\u9ad8\u5206\u5b50\u6750\u6599\u4e3a\u6838\u5fc3\u7684\u6570\u636e\u96c6\u4e2d\u7684\u6807\u7b7e\u3001\u5c5e\u6027\u3001\u7528\u9014\u548c\u6570\u503c\u9608\u503c\u5339\u914d\u3002",
  aboutScoringThree: "\u4f7f\u7528\u53ef\u89e3\u91ca\u7684\u539f\u56e0\u3001\u8b66\u544a\u548c\u76f8\u4f3c\u66ff\u4ee3\u6750\u6599\u5bf9\u5019\u9009\u8fdb\u884c\u6392\u540d\u3002",
  aboutFeaturesTitle: "\u6838\u5fc3\u529f\u80fd",
  aboutFeatureOne: "\u4ece\u9700\u6c42\u5230\u5019\u9009\u6e05\u5355\u7684\u63a8\u8350\u5de5\u4f5c\u6d41\u3002",
  aboutFeatureTwo: "\u53ef\u641c\u7d22\u3001\u53ef\u7b5b\u9009\u7684\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u6750\u6599\u76ee\u5f55\u3002",
  aboutFeatureThree: "\u6700\u591a\u4e09\u79cd\u6750\u6599\u7684\u5e76\u6392\u5bf9\u6bd4\u3002",
  aboutFeatureFour: "\u9762\u5411\u9009\u578b\u8bc4\u5ba1\u7684 PDF \u5f0f\u62a5\u544a\u5bfc\u51fa\u3002",
  aboutTrustTitle: "\u5f53\u524d\u5c40\u9650",
  aboutTrustBody: "MatFinder AI \u4e0d\u662f\u5b8c\u6574\u5168\u6750\u6599\u6570\u636e\u5e93\uff0c\u800c\u662f\u9762\u5411\u9ad8\u5206\u5b50\u4e3a\u6838\u5fc3\u5de5\u7a0b\u6750\u6599\u7684\u7b5b\u9009\u8f85\u52a9\u5de5\u5177\u3002\u73b0\u6709\u91d1\u5c5e\u548c\u9676\u74f7\u7b49\u8bb0\u5f55\u4f1a\u4fdd\u7559\uff0c\u7528\u4f5c\u8de8\u6750\u6599\u5bf9\u6bd4\u53c2\u8003\uff1b\u6700\u7ec8\u9009\u578b\u4ecd\u9700\u6838\u5bf9\u4f9b\u5e94\u5546\u6570\u636e\u8868\u3002",
  aboutValidationTitle: "\u6700\u7ec8\u9009\u578b\u524d",
  aboutValidationOne: "\u786e\u8ba4\u724c\u53f7\u7ea7\u6570\u636e\u8868\u548c\u4f9b\u5e94\u53ef\u5f97\u6027\u3002",
  aboutValidationTwo: "\u9a8c\u8bc1\u52a0\u5de5\u65b9\u5f0f\u3001\u4f7f\u7528\u73af\u5883\u548c\u957f\u671f\u8f7d\u8377\u3002",
  aboutValidationThree: "\u5c06\u5bfc\u51fa\u62a5\u544a\u4f5c\u4e3a\u9009\u6750\u7b80\u62a5\uff0c\u800c\u4e0d\u662f\u6700\u7ec8\u8ba4\u8bc1\u3002",
  aboutRoadmapTitle: "\u672a\u6765\u8def\u7ebf\u56fe",
  aboutRoadmapOne: "\u724c\u53f7\u7ea7\u6570\u636e\u8868\u94fe\u63a5\u548c\u4f9b\u5e94\u5546\u8bb0\u5f55\u3002",
  aboutRoadmapTwo: "\u9762\u5411\u6c7d\u8f66\u3001\u7535\u5b50\u3001\u533b\u7597\u3001\u5305\u88c5\u548c\u53ef\u6301\u7eed\u573a\u666f\u7684\u66f4\u591a\u9886\u57df\u9884\u8bbe\u3002",
  aboutRoadmapThree: "\u9762\u5411\u5de5\u7a0b\u8bc4\u5ba1\u548c\u91c7\u8d2d\u6c9f\u901a\u7684\u66f4\u5b8c\u6574\u5bfc\u51fa\u6a21\u677f\u3002"
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
  Thermoplastics: "热塑性塑料",
  "Engineering plastics": "工程塑料",
  "High-performance polymers": "高性能聚合物",
  Thermosets: "热固性材料",
  Elastomers: "弹性体",
  Composites: "复合材料",
  Metals: "金属",
  Ceramics: "陶瓷",
  Rubber: "橡胶",
  Foams: "泡沫材料",
  Adhesives: "胶粘剂",
  Sealants: "密封剂",
  Coatings: "涂层",
  "Specialty materials": "特种材料",
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
  "UV resistant": "抗紫外",
  "flame resistance": "阻燃",
  "non-solid or soft form": "非固体或软质形态",
  "waterproof or sealing": "防水或密封",
  "waterproof or low moisture": "防水或低吸水",
  sealing: "密封",
  sustainability: "可持续",
  "medical suitability": "医疗适配",
  "food contact": "食品接触"
};

const zhDisplayTermMap = {
  plastics: "\u5851\u6599",
  plastic: "\u5851\u6599",
  metals: "\u91d1\u5c5e",
  metal: "\u91d1\u5c5e",
  elastomers: "\u5f39\u6027\u4f53",
  elastomer: "\u5f39\u6027\u4f53",
  fibers: "\u7ea4\u7ef4",
  fiber: "\u7ea4\u7ef4",
  thermosets: "\u70ed\u56fa\u6027\u6750\u6599",
  thermoset: "\u70ed\u56fa\u6027\u6750\u6599",
  ceramics: "\u9676\u74f7",
  ceramic: "\u9676\u74f7",
  composites: "\u590d\u5408\u6750\u6599",
  composite: "\u590d\u5408\u6750\u6599",
  adhesives: "\u80f6\u7c98\u5242",
  adhesive: "\u80f6\u7c98\u5242",
  coatings: "\u6d82\u5c42",
  coating: "\u6d82\u5c42",
  sealants: "\u5bc6\u5c01\u80f6",
  sealant: "\u5bc6\u5c01\u80f6",
  foams: "\u6ce1\u6cab\u6750\u6599",
  foam: "\u6ce1\u6cab\u6750\u6599",
  glasses: "\u73bb\u7483",
  glass: "\u73bb\u7483",
  gears: "\u9f7f\u8f6e",
  bearings: "\u8f74\u627f",
  valves: "\u9600\u95e8",
  springs: "\u5f39\u7c27",
  rollers: "\u6eda\u8f6e",
  "automotive seals": "\u6c7d\u8f66\u5bc6\u5c01\u4ef6",
  "transmission seals": "\u4f20\u52a8\u5bc6\u5c01\u4ef6",
  hoses: "\u8f6f\u7ba1",
  "electronic housings": "\u7535\u5b50\u5916\u58f3",
  "electronic housing": "\u7535\u5b50\u5916\u58f3",
  "consumer products": "\u6d88\u8d39\u54c1",
  electronics: "\u7535\u5b50\u4ea7\u54c1",
  "automotive trim": "\u6c7d\u8f66\u5185\u9970\u4ef6",
  "low friction": "\u4f4e\u6469\u64e6",
  "wear resistant": "\u8010\u78e8",
  "dimensional stability": "\u5c3a\u5bf8\u7a33\u5b9a",
  machinable: "\u6613\u52a0\u5de5",
  "high stiffness": "\u9ad8\u521a\u6027",
  "fatigue resistant": "\u8010\u75b2\u52b3",
  "oil resistant": "\u8010\u6cb9",
  "heat resistant": "\u8010\u70ed",
  "weather resistant": "\u8010\u5019",
  conductive: "\u5bfc\u7535",
  antistatic: "\u6297\u9759\u7535",
  "flame retardant": "\u963b\u71c3",
  "impact resistant": "\u6297\u51b2\u51fb"
};

const zhMaterialNameMap = {
  "acetal copolymer": "\u5171\u805a\u7532\u919b",
  "acetal homopolymer": "\u5747\u805a\u7532\u919b",
  "acrylic rubber": "\u4e19\u70ef\u9178\u916f\u6a61\u80f6",
  "abs resin": "ABS \u6811\u8102",
  "acrylonitrile butadiene styrene": "\u4e19\u70ef\u8148-\u4e01\u4e8c\u70ef-\u82ef\u4e59\u70ef"
};

const performanceFilterGroups = [
  {
    id: "thermal",
    labels: { en: "Thermal", zh: "热性能" },
    options: [
      { id: "heat-resistant", legacyIds: ["high-temp"], labels: { en: "Heat Resistant", zh: "耐热" }, match: (item) => numberValue(item.maxTemp) >= 150 || hasMaterialSignal(item, ["heat resistant", "high temperature", "thermal", "耐热", "高温"]) },
      { id: "flame-retardant", labels: { en: "Flame Retardant", zh: "阻燃" }, match: (item) => hasMaterialSignal(item, ["flame retardant", "fire resistant", "ul 94", "v-0", "noncombustible", "阻燃", "防火"]) },
      { id: "low-temperature-resistant", labels: { en: "Low Temperature Resistant", zh: "耐低温" }, match: (item) => numberValue(item.tg) <= -30 || hasMaterialSignal(item, ["low temperature", "cryogenic", "cold resistant", "耐低温", "低温"]) }
    ]
  },
  {
    id: "mechanical",
    labels: { en: "Mechanical", zh: "机械性能" },
    options: [
      { id: "high-strength", legacyIds: ["strength"], labels: { en: "High Strength", zh: "高强度" }, match: (item) => numberValue(item.tensile) >= 70 || numberValue(item.tensile_strength) >= 70 || numberValue(item.flexural_strength) >= 100 || hasMaterialSignal(item, ["high strength", "reinforced", "structural", "高强度", "增强"]) },
      { id: "high-toughness", labels: { en: "High Toughness", zh: "高韧性" }, match: (item) => numberValue(item.elongation) >= 80 || hasMaterialSignal(item, ["tough", "toughened", "high toughness", "韧性", "增韧"]) },
      { id: "wear-resistant", labels: { en: "Wear Resistant", zh: "耐磨" }, match: (item) => hasMaterialSignal(item, ["wear resistant", "abrasion resistant", "low friction", "bearing", "耐磨", "低摩擦"]) },
      { id: "impact-resistant", labels: { en: "Impact Resistant", zh: "抗冲击" }, match: (item) => hasMaterialSignal(item, ["impact resistant", "impact modified", "energy absorption", "抗冲击", "抗冲"]) }
    ]
  },
  {
    id: "chemical",
    labels: { en: "Chemical", zh: "化学性能" },
    options: [
      { id: "chemical-resistant", legacyIds: ["chemical"], labels: { en: "Chemical Resistant", zh: "耐化学" }, match: (item) => hasMaterialSignal(item, ["chemical resistant", "chemical resistance", "good to excellent", "耐化学", "化工"]) },
      { id: "acid-resistant", labels: { en: "Acid Resistant", zh: "耐酸" }, match: (item) => hasMaterialSignal(item, ["acid resistant", "acid", "硫酸", "盐酸", "耐酸"]) || hasStrongChemicalResistance(item) },
      { id: "alkali-resistant", labels: { en: "Alkali Resistant", zh: "耐碱" }, match: (item) => hasMaterialSignal(item, ["alkali resistant", "alkaline", "caustic", "耐碱", "碱"]) || hasStrongChemicalResistance(item) },
      { id: "oil-resistant", labels: { en: "Oil Resistant", zh: "耐油" }, match: (item) => hasMaterialSignal(item, ["oil resistant", "fuel resistant", "hydrocarbon", "耐油", "燃油"]) }
    ]
  },
  {
    id: "electrical",
    labels: { en: "Electrical", zh: "电气性能" },
    options: [
      { id: "electrical-insulation", legacyIds: ["electrical"], labels: { en: "Electrical Insulation", zh: "电绝缘" }, match: (item) => hasMaterialSignal(item, ["electrical insulation", "dielectric", "insulator", "connector", "电绝缘", "绝缘"]) },
      { id: "high-dielectric", labels: { en: "High Dielectric", zh: "高介电" }, match: (item) => numberValue(item.dielectric) >= 4 || hasMaterialSignal(item, ["high dielectric", "dielectric constant", "高介电"]) },
      { id: "low-dielectric", labels: { en: "Low Dielectric", zh: "低介电" }, match: (item) => numberValue(item.dielectric) > 0 && numberValue(item.dielectric) <= 2.8 || hasMaterialSignal(item, ["low dielectric", "rf", "radome", "低介电"]) },
      { id: "conductive-antistatic", labels: { en: "Conductive / Antistatic", zh: "导电 / 防静电" }, match: (item) => hasMaterialSignal(item, ["conductive", "antistatic", "esd", "emi shielding", "导电", "防静电", "电磁屏蔽"]) }
    ]
  },
  {
    id: "optical",
    labels: { en: "Optical", zh: "光学性能" },
    options: [
      { id: "transparent", legacyIds: ["transparent"], labels: { en: "Transparent", zh: "透明" }, match: (item) => hasMaterialSignal(item, ["transparent", "clear", "透明"]) },
      { id: "optical-clarity", labels: { en: "Optical Clarity", zh: "光学级" }, match: (item) => hasMaterialSignal(item, ["optical", "lens", "light guide", "clarity", "光学", "透镜"]) },
      { id: "uv-resistant", labels: { en: "UV Resistant", zh: "抗紫外" }, match: (item) => hasMaterialSignal(item, ["uv resistant", "uv stabilized", "weather resistant", "抗紫外", "耐候"]) }
    ]
  },
  {
    id: "sealing-elastomer",
    labels: { en: "Sealing & Elastomer", zh: "密封与弹性体" },
    options: [
      { id: "elastomer", legacyIds: ["elastomer"], labels: { en: "Elastomer", zh: "弹性体" }, match: (item) => ["Elastomer", "Elastomers", "Rubber", "Sealants"].includes(item.category) || hasMaterialSignal(item, ["elastomer", "rubber", "弹性体", "橡胶"]) },
      { id: "flexible", labels: { en: "Flexible", zh: "柔性" }, match: (item) => numberValue(item.elongation) >= 150 || hasMaterialSignal(item, ["flexible", "soft", "flexibility", "柔性", "柔韧"]) },
      { id: "waterproof-sealing", labels: { en: "Waterproof Sealing", zh: "防水密封" }, match: (item) => hasMaterialSignal(item, ["waterproof", "sealing", "sealant", "gasket", "low moisture", "防水", "密封"]) || numberValue(item.water_absorption) <= 0.2 },
      { id: "gasket-seal", labels: { en: "Gasket / O-ring", zh: "垫片 / O 形圈" }, match: (item) => hasMaterialSignal(item, ["gasket", "o-ring", "seal", "flange", "垫片", "密封圈"]) }
    ]
  },
  {
    id: "sustainability",
    labels: { en: "Sustainability", zh: "可持续" },
    options: [
      { id: "recyclable", legacyIds: ["sustainable"], labels: { en: "Recyclable", zh: "可回收" }, match: (item) => Boolean(item.recyclable) || hasMaterialSignal(item, ["recyclable", "recycling", "可回收"]) },
      { id: "bio-based", labels: { en: "Bio-based", zh: "生物基" }, match: (item) => hasMaterialSignal(item, ["bio-based", "biobased", "renewable", "生物基"]) },
      { id: "compostable", labels: { en: "Compostable", zh: "可堆肥" }, match: (item) => hasMaterialSignal(item, ["compostable", "biodegradable", "可堆肥", "可降解"]) },
      { id: "low-density-lightweight", labels: { en: "Lightweight", zh: "轻量" }, match: (item) => numberValue(item.density) > 0 && numberValue(item.density) <= 1.2 || hasMaterialSignal(item, ["lightweight", "low density", "轻量", "低密度"]) }
    ]
  }
];

const performanceFilterOptions = performanceFilterGroups.flatMap((group) => group.options.map((option) => ({ ...option, groupId: group.id })));
const propertyPredicates = Object.fromEntries(
  performanceFilterOptions.flatMap((option) => [[option.id, option.match], ...(option.legacyIds || []).map((id) => [id, option.match])])
);

const applicationDomainFilters = [
  {
    id: "automotive",
    labels: { en: "Automotive", zh: "汽车" },
    keywords: ["automotive", "vehicle", "under-hood", "bumper", "interior trim", "fuel system", "mirror housings", "汽车", "车身", "内饰"]
  },
  {
    id: "ev-battery",
    labels: { en: "EV Battery", zh: "动力电池" },
    keywords: ["ev battery", "battery", "battery pack", "battery packs", "cell", "thermal gap", "thermal interface", "fire barrier", "power electronics", "电池", "动力电池", "电池包"]
  },
  {
    id: "electronics",
    labels: { en: "Electronics", zh: "电子电气" },
    keywords: ["electronics", "electronic", "electrical", "connector", "connectors", "circuit", "pcb", "semiconductor", "potting", "wire", "cable", "relay", "switch", "电气", "电子", "连接器", "半导体"]
  },
  {
    id: "aerospace",
    labels: { en: "Aerospace", zh: "航空航天" },
    keywords: ["aerospace", "aircraft", "radome", "satellite", "turbine", "rocket", "aircraft interiors", "flight", "航空", "航天", "飞机"]
  },
  {
    id: "medical",
    labels: { en: "Medical", zh: "医疗" },
    keywords: ["medical", "healthcare", "biocompatible", "sterilizable", "surgical", "diagnostic", "implant", "medical devices", "医疗", "医用", "植入"]
  },
  {
    id: "construction",
    labels: { en: "Construction", zh: "建筑施工" },
    keywords: ["construction", "building", "architectural", "roofing", "flooring", "window", "profiles", "pipe", "plumbing", "concrete", "建筑", "施工", "屋面", "管道"]
  },
  {
    id: "industrial-sealing",
    labels: { en: "Industrial Sealing", zh: "工业密封" },
    keywords: ["seal", "seals", "sealing", "gasket", "gaskets", "o-ring", "o-rings", "valve", "flange", "pump", "chemical seal", "weather seals", "密封", "垫片", "阀门", "泵"]
  },
  {
    id: "consumer-electronics",
    labels: { en: "Consumer Electronics", zh: "消费电子" },
    keywords: ["consumer electronics", "phone", "laptop", "tablet", "wearable", "display", "clear cover", "housings", "keyboard", "speaker", "消费电子", "手机", "显示"]
  }
];

const state = {
  route: "home",
  language: "zh",
  query: "",
  category: "all",
  property: "all",
  domain: "all",
  minTemp: DEFAULT_MIN_TEMP,
  minStrength: DEFAULT_MIN_STRENGTH,
  recyclableOnly: false,
  sort: "match",
  materialsPage: 1,
  materialsPageSize: 48,
  materialsGridRendered: false,
  filteredMaterialsCache: { key: "", items: [] },
  recommendationCache: new Map(),
  compareTableCache: new Map(),
  selected: new Set(),
  recommendations: [],
  recommendationCriteria: [],
  recommendationQuery: "",
  recommendationResult: null,
  selectedMaterialId: null,
  copilotMessages: [],
  analysisCache: new Map(),
  aiCompareCache: new Map()
};

const elements = {
  totalCount: document.querySelector("#totalCount"),
  selectedCount: document.querySelector("#selectedCount"),
  languageSelect: document.querySelector("#languageSelect"),
  routePanels: document.querySelectorAll("[data-route-pages]"),
  routeLinks: document.querySelectorAll("[data-route-link]"),
  startSelectionButton: document.querySelector("#startSelectionButton"),
  homeMaterialCount: document.querySelector("#homeMaterialCount"),
  catalogStats: document.querySelector("#catalogStats"),
  aboutMaterialCount: document.querySelector("#aboutMaterialCount"),
  aboutCategoryCount: document.querySelector("#aboutCategoryCount"),
  requirementInput: document.querySelector("#requirementInput"),
  recommendButton: document.querySelector("#recommendButton"),
  clearRecommendationButton: document.querySelector("#clearRecommendationButton"),
  recommendationResults: document.querySelector("#recommendationResults"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisStatus: document.querySelector("#analysisStatus"),
  analysisContent: document.querySelector("#analysisContent"),
  copilotContext: document.querySelector("#copilotContext"),
  copilotMessages: document.querySelector("#copilotMessages"),
  copilotForm: document.querySelector("#copilotForm"),
  copilotInput: document.querySelector("#copilotInput"),
  copilotPromptButtons: document.querySelectorAll("[data-copilot-prompt-en]"),
  exampleButtons: document.querySelectorAll("[data-example]"),
  searchInput: document.querySelector("#searchInput"),
  filterToggleButton: document.querySelector("#filterToggleButton"),
  categoryFilter: document.querySelector("#categoryFilter"),
  propertyFilter: document.querySelector("#propertyFilter"),
  propertyFacetFilter: document.querySelector("#propertyFacetFilter"),
  domainFacetFilter: document.querySelector("#domainFacetFilter"),
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
  materialsPagination: document.querySelector("#materialsPagination"),
  emptyState: document.querySelector("#emptyState"),
  compareSelection: document.querySelector("#compareSelection"),
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

const polymerCategoryOrder = [
  "Plastics",
  "Elastomers",
  "Thermosets",
  "Composites",
  "Fibers",
  "Adhesives",
  "Coatings",
  "Foams",
  "Sealants"
];
const comparisonCategoryOrder = ["Metals", "Ceramics", "Glasses"];

function t(key, ...args) {
  if (state.language === "zh" && Object.hasOwn(zhDetailLabels, key)) {
    return zhDetailLabels[key];
  }
  const value = i18n[state.language][key] ?? i18n.en[key] ?? key;
  return typeof value === "function" ? value(...args) : value;
}

function normalizeDisplayKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function localizeTerm(value) {
  return localizeTermFor(value, state.language);
}

function localizeTermFor(value, language) {
  if (language !== "zh") return value;
  if (!value) return value;
  const text = String(value).trim();
  return zhDisplayTermMap[normalizeDisplayKey(text)] || zhTerms[text] || value;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getMaterialSignalText(item) {
  if (item.__signalText) return item.__signalText;
  item.__signalText = [
    item.name,
    item.name_en,
    item.name_zh,
    item.abbr,
    item.abbreviation,
    item.category,
    item.category_en,
    item.category_zh,
    item.subcategory,
    item.family,
    item.material_family,
    item.grade_name,
    item.supplier_or_brand,
    item.summary,
    item.description,
    item.description_en,
    item.description_zh,
    item.notes,
    item.flame_rating,
    item.electrical_insulation,
    item.chemical_resistance,
    item.transparency,
    item.flexibility,
    item.waterproof_sealing,
    item.recyclability,
    ...(item.tags || []),
    ...(item.tags_en || []),
    ...(item.tags_zh || []),
    ...(item.uses || []),
    ...(item.applications || []),
    ...(item.applications_en || []),
    ...(item.applications_zh || []),
    ...(item.typical_applications || []),
    ...(item.processing_methods || []),
    ...(item.advantages || []),
    ...(item.disadvantages || []),
    ...(item.limitations || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return item.__signalText;
}

function hasMaterialSignal(item, signals) {
  const text = getMaterialSignalText(item);
  return signals.some((signal) => text.includes(String(signal).toLowerCase()));
}

function hasStrongChemicalResistance(item) {
  const value = String(item.chemical_resistance || "").toLowerCase();
  return value.includes("excellent") || value.includes("good") || value.includes("resistant");
}

function getApplicationDomain(id) {
  return applicationDomainFilters.find((domain) => domain.id === id);
}

function domainLabel(id) {
  const domain = getApplicationDomain(id);
  return domain ? domain.labels[state.language] || domain.labels.en : id;
}

function getApplicationSignalText(item) {
  if (item.__applicationSignalText) return item.__applicationSignalText;
  item.__applicationSignalText = [
    ...(item.applications || []),
    ...(item.applications_en || []),
    ...(item.applications_zh || []),
    ...(item.uses || []),
    ...(item.typical_applications || []),
    item.summary,
    item.description,
    item.description_en,
    item.description_zh,
    item.source_note
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return item.__applicationSignalText;
}

function matchesApplicationDomain(item, domain) {
  const text = getApplicationSignalText(item);
  return domain.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
}

function getPerformanceOption(id) {
  return performanceFilterOptions.find((option) => option.id === id || option.legacyIds?.includes(id));
}

function getPerformanceGroup(id) {
  return performanceFilterGroups.find((group) => group.id === id);
}

function performanceLabel(id) {
  const option = getPerformanceOption(id);
  return option ? option.labels[state.language] || option.labels.en : t("propertyOptions")[id] || id;
}

function materialName(item) {
  return materialNameFor(item, state.language);
}

function materialNameFor(item, language) {
  if (language !== "zh") return item.name_en || item.name;
  return item.name_zh || zhMaterialNameMap[normalizeDisplayKey(item.name)] || item.name;
}

function materialCategory(item) {
  return materialCategoryFor(item, state.language);
}

function materialCategoryFor(item, language) {
  if (language !== "zh") return item.category_en || item.category;
  return item.category_zh || localizeTermFor(item.category, language);
}

function materialTags(item) {
  const translatedTags = state.language === "zh" ? item.tags_zh : item.tags_en;
  if (Array.isArray(translatedTags) && translatedTags.length) return translatedTags;
  return item.tags.map(localizeTerm);
}

function materialUses(item) {
  return materialUsesFor(item, state.language);
}

function materialUsesFor(item, language) {
  const localizedApplications = language === "zh" ? item.applications_zh : item.applications_en;
  if (Array.isArray(localizedApplications) && localizedApplications.length) return localizedApplications;
  return language === "zh" ? item.uses.map((use) => localizeTermFor(use, language)) : item.uses;
}

function legacyMaterialSummary(item) {
  if (state.language !== "zh") return item.summary;
  const uses = materialUses(item).slice(0, 3).join("、");
  return `${materialName(item)}属于${materialCategory(item)}，典型用途包括${uses || t("notSpecified")}，连续使用温度约 ${formatValue(item.maxTemp, " deg C")}。`;
}

function materialNotes(item) {
  if (state.language !== "zh") return item.notes;
  return `请结合工况、加工方式、长期载荷和环境介质进一步验证；本地数据库备注：${item.notes}`;
}

function materialSummary(item) {
  if (item.data_quality?.level === "rejected") {
    return state.language === "zh"
      ? "该记录包含不合理或相互矛盾的数值，已停止作为材料性能依据。"
      : "This record contains implausible or contradictory values and is blocked as material evidence.";
  }
  if (state.language !== "zh") return item.description_en || item.summary;
  if (item.description_zh) return item.description_zh;
  const uses = materialUses(item).slice(0, 3).join("\u3001");
  return `${materialName(item)}\u5c5e\u4e8e${materialCategory(item)}\uff0c\u5178\u578b\u7528\u9014\u5305\u62ec${uses || t("notSpecified")}\uff0c\u8fde\u7eed\u4f7f\u7528\u6e29\u5ea6\u7ea6 ${formatValue(item.maxTemp, " deg C")}\u3002`;
}

function localizeRecommendationReason(reason) {
  return localizeRecommendationReasonFor(reason, state.language);
}

function localizeRecommendationReasonFor(reason, language) {
  if (language !== "zh") return reason;
  const verificationMatch = String(reason).match(/^requires external verification: (.+)$/);
  if (verificationMatch) {
    const labels = {
      "certification or regulatory compliance": "\u8ba4\u8bc1\u6216\u6cd5\u89c4\u5408\u89c4",
      "chemical identity and concentration compatibility": "\u5177\u4f53\u5316\u5b66\u4ecb\u8d28\u53ca\u6d53\u5ea6\u76f8\u5bb9\u6027",
      "compression-set performance": "\u538b\u7f29\u6c38\u4e45\u53d8\u5f62\u6027\u80fd",
      "supplier, grade, price, availability, or lead time": "\u4f9b\u5e94\u5546\u3001\u724c\u53f7\u3001\u4ef7\u683c\u3001\u5e93\u5b58\u6216\u4ea4\u671f",
      "product BOM and quantity planning": "\u4ea7\u54c1 BOM \u4e0e\u7528\u91cf\u8ba1\u5212",
      "test method and specimen conditions": "\u6d4b\u8bd5\u65b9\u6cd5\u4e0e\u8bd5\u6837\u6761\u4ef6"
    };
    return `\u9700\u5916\u90e8\u6838\u9a8c\uff1a${labels[verificationMatch[1]] || verificationMatch[1]}`;
  }
  if (reason === "no recognized engineering requirement; recommendation withheld") {
    return "\u672a\u8bc6\u522b\u5230\u53ef\u5b89\u5168\u8bc4\u4f30\u7684\u5de5\u7a0b\u9700\u6c42\uff0c\u5df2\u505c\u6b62\u63a8\u8350\u3002";
  }
  if (reason === "no major unmatched requirement warnings within the supported screening fields") {
    return "\u5728\u5f53\u524d\u53ef\u652f\u6301\u7684\u7b5b\u9009\u5b57\u6bb5\u5185\u672a\u53d1\u73b0\u4e3b\u8981\u672a\u5339\u914d\u9879\u3002";
  }
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
    .replace("UV or sunlight resistance is represented in the dataset", "本地数据集中体现了抗紫外或耐日照特征")
    .replace("flame-retardant profile", "具有阻燃特征")
    .replace("recyclable material family", "属于可回收材料体系")
    .replace("bio-based or specialty sustainability fit", "具有生物基或可持续适配特征")
    .replace("medical-related uses are present in the local dataset", "本地数据集中包含医疗相关用途")
    .replace("common food or packaging applications", "常见于食品或包装应用")
    .replace("closest local text match", "最接近的本地文本匹配")
    .replace("balanced fallback from local dataset", "来自本地数据集的综合推荐")
    .replace("soft or non-rigid behavior is indicated by category, tags, or applications", "类别、标签或应用体现出软质或非刚性特征")
    .replace(/^soft or non-rigid fit with (.+) elongation$/, "软质或非刚性适配，断裂伸长率 $1")
    .replace("waterproof or sealing fit is indicated by tags, uses, or description", "标签、用途或描述体现出防水或密封适配")
    .replace("waterproof fit is indicated by tags, uses, or description", "标签、用途或描述体现出防水适配")
    .replace(/^low water absorption \((.+)\) supports waterproof or sealing use$/, "低吸水率（$1）支持防水或密封用途")
    .replace(/^low water absorption \((.+)\) supports waterproof use$/, "低吸水率（$1）支持防水用途")
    .replace("sealing fit is indicated by elastomer, gasket, or seal applications", "弹性体、垫圈或密封应用体现出密封适配")
    .replace("non-solid or soft-form requirement is weakly supported by the local fields", "本地字段对非固体或软质形态需求支持较弱")
    .replace("waterproof or sealing requirement is weakly supported by the local fields", "本地字段对防水或密封需求支持较弱")
    .replace("waterproof requirement is weakly supported by the local fields", "本地字段对防水需求支持较弱")
    .replace("sealing requirement is weakly supported by the local fields", "本地字段对密封需求支持较弱")
    .replace("no recognized requirement terms; ranked by local text similarity", "未识别到明确需求词，按本地文本相似度排序")
    .replace("no major unmatched requirement warnings", "未发现明显未匹配需求警告")
    .replace("requirement is weakly supported by the local fields", "需求在本地字段中支持较弱")
    .replace("partial match against stated requirements", "与需求部分匹配");
}

function applyLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  elements.requirementInput.placeholder = t("requirementPlaceholder");
  elements.searchInput.placeholder = t("searchPlaceholder");
  elements.copilotInput.placeholder = t("copilotPlaceholder");
  elements.languageSelect.value = state.language;
  elements.emptyState.textContent = t("noMatches");
  elements.runAiCompareButton.textContent = t("compareWithAi");

  renderCategoryOptions();

  renderLegacyPropertyOptions();
  renderPropertyFacets();
  renderDomainFacets();

  elements.sortSelect.querySelectorAll("option").forEach((option) => {
    option.textContent = t("sortOptions")[option.value];
  });

  elements.exampleButtons.forEach((button, index) => {
    button.textContent = t("examples")[index];
  });

  elements.copilotPromptButtons.forEach((button) => {
    button.textContent = state.language === "zh" ? button.dataset.copilotPromptZh : button.dataset.copilotPromptEn;
  });

  updateCopilotContext();
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

function renderCategoryOptions() {
  if (!elements.categoryFilter) return;
  const selectedValue = state.category;
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = t("allCategories");
  allOption.selected = selectedValue === "all";
  fragment.append(allOption);

  const remaining = new Set(categories);
  const appendGroup = (label, orderedCategories) => {
    const groupCategories = orderedCategories.filter((category) => remaining.has(category));
    if (!groupCategories.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    groupCategories.forEach((category) => {
      remaining.delete(category);
      group.append(createCategoryOption(category, selectedValue));
    });
    fragment.append(group);
  };

  appendGroup(t("polymerCategoryGroup"), polymerCategoryOrder);
  appendGroup(t("otherCategoryGroup"), comparisonCategoryOrder);

  if (remaining.size) {
    const group = document.createElement("optgroup");
    group.label = t("otherCategoryGroup");
    [...remaining].sort((a, b) => a.localeCompare(b)).forEach((category) => {
      group.append(createCategoryOption(category, selectedValue));
    });
    fragment.append(group);
  }

  elements.categoryFilter.replaceChildren(fragment);
}

function createCategoryOption(category, selectedValue) {
  const option = document.createElement("option");
  option.value = category;
  option.textContent = localizeTerm(category);
  option.selected = selectedValue === category;
  return option;
}

function renderLegacyPropertyOptions() {
  if (!elements.propertyFilter) return;
  const options = [
    { id: "all", label: t("propertyOptions").all },
    ...performanceFilterOptions.map((option) => ({ id: option.id, label: option.labels[state.language] || option.labels.en })),
    ...performanceFilterOptions.flatMap((option) => (option.legacyIds || []).map((id) => ({ id, label: option.labels[state.language] || option.labels.en })))
  ];
  const seen = new Set();
  elements.propertyFilter.replaceChildren(
    ...options
      .filter((option) => {
        if (seen.has(option.id)) return false;
        seen.add(option.id);
        return true;
      })
      .map((option) => {
        const node = document.createElement("option");
        node.value = option.id;
        node.textContent = option.label;
        node.selected = state.property === option.id;
        return node;
      })
  );
}

function renderPropertyFacets() {
  if (!elements.propertyFacetFilter) return;
  const counts = getPerformanceFilterCounts();
  const selectedGroupId = getPerformanceOption(state.property)?.groupId;
  const fragment = document.createDocumentFragment();
  const allButton = createPropertyFacetButton({
    id: "all",
    label: t("propertyOptions").all,
    count: counts.get("all") || 0,
    selected: state.property === "all",
    className: "property-facet-all"
  });
  fragment.append(allButton);

  performanceFilterGroups.forEach((group) => {
    const details = document.createElement("details");
    details.className = "property-group";
    details.open = selectedGroupId === group.id || window.matchMedia("(min-width: 901px)").matches;

    const summary = document.createElement("summary");
    const groupCount = countGroupMatches(group, counts);
    summary.innerHTML = `<span>${escapeHtml(group.labels[state.language] || group.labels.en)}</span><strong>${groupCount}</strong>`;
    details.append(summary);

    const options = document.createElement("div");
    options.className = "property-options";
    group.options.forEach((option) => {
      options.append(
        createPropertyFacetButton({
          id: option.id,
          label: option.labels[state.language] || option.labels.en,
          count: counts.get(option.id) || 0,
          selected: option.id === state.property || option.legacyIds?.includes(state.property)
        })
      );
    });
    details.append(options);
    fragment.append(details);
  });

  elements.propertyFacetFilter.replaceChildren(fragment);
}

function createPropertyFacetButton({ id, label, count, selected, className = "" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `property-facet ${className}`.trim();
  button.dataset.property = id;
  button.setAttribute("aria-pressed", String(selected));
  button.innerHTML = `<span>${escapeHtml(label)}</span><strong>${count}</strong>`;
  return button;
}

function getPerformanceFilterCounts() {
  const counts = new Map();
  const baseItems = materials.filter((item) => matchesCatalogFilters(item, { includeProperty: false }));
  counts.set("all", baseItems.length);
  performanceFilterOptions.forEach((option) => {
    const count = baseItems.filter((item) => option.match(item)).length;
    counts.set(option.id, count);
  });
  performanceFilterGroups.forEach((group) => {
    counts.set(`group:${group.id}`, baseItems.filter((item) => group.options.some((option) => option.match(item))).length);
  });
  return counts;
}

function countGroupMatches(group, counts) {
  return counts.get(`group:${group.id}`) || 0;
}

function renderDomainFacets() {
  if (!elements.domainFacetFilter) return;
  const counts = getApplicationDomainCounts();
  const fragment = document.createDocumentFragment();
  fragment.append(
    createFacetButton({
      id: "all",
      label: t("allDomains"),
      count: counts.get("all") || 0,
      selected: state.domain === "all",
      className: "property-facet-all",
      dataName: "domain"
    })
  );

  applicationDomainFilters.forEach((domain) => {
    fragment.append(
      createFacetButton({
        id: domain.id,
        label: domain.labels[state.language] || domain.labels.en,
        count: counts.get(domain.id) || 0,
        selected: state.domain === domain.id,
        dataName: "domain"
      })
    );
  });

  elements.domainFacetFilter.replaceChildren(fragment);
}

function createFacetButton({ id, label, count, selected, className = "", dataName }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `property-facet ${className}`.trim();
  button.dataset[dataName] = id;
  button.setAttribute("aria-pressed", String(selected));
  button.innerHTML = `<span>${escapeHtml(label)}</span><strong>${count}</strong>`;
  return button;
}

function getApplicationDomainCounts() {
  const counts = new Map();
  const baseItems = materials.filter((item) => matchesCatalogFilters(item, { includeDomain: false }));
  counts.set("all", baseItems.length);
  applicationDomainFilters.forEach((domain) => {
    counts.set(domain.id, baseItems.filter((item) => matchesApplicationDomain(item, domain)).length);
  });
  return counts;
}

async function init() {
  await loadMaterials();
  recommendationService = window.MatFinderAI.createRecommendationService({ materials });
  categories = [...new Set(materials.map((material) => material.category))].sort((a, b) => a.localeCompare(b));
  renderCategoryOptions();

  elements.totalCount.textContent = materials.length;
  elements.homeMaterialCount.textContent = materials.length;
  elements.aboutMaterialCount.textContent = materials.length;
  elements.aboutCategoryCount.textContent = categories.length;
  renderCatalogStats();
  bindEvents();
  applyLanguage();
  setRoute(routeFromPath(window.location.pathname), { replace: true });
  renderRecommendations();
  render();
}

function routeFromPath(pathname) {
  const cleanPath = String(pathname || "/").replace(/\/+$/, "") || "/";
  const routes = {
    "/": "home",
    "/materials": "materials",
    "/compare": "compare",
    "/copilot": "copilot",
    "/about": "about"
  };
  return routes[cleanPath] || "home";
}

function pathFromRoute(route) {
  return {
    home: "/",
    materials: "/materials",
    compare: "/compare",
    copilot: "/copilot",
    about: "/about"
  }[route] || "/";
}

function setRoute(route, options = {}) {
  state.route = routeFromPath(pathFromRoute(route));
  const path = pathFromRoute(state.route);
  if (options.replace) {
    window.history.replaceState({ route: state.route }, "", path);
  } else if (window.location.pathname !== path) {
    window.history.pushState({ route: state.route }, "", path);
  }
  renderRoute();
  if (state.route === "compare") {
    renderCompare();
    renderAiComparePanel();
  }
  if (state.route === "copilot") {
    renderCopilotRoute();
  }
  if (!options.replace && state.route === "materials" && materials.length && !state.materialsGridRendered) {
    render();
  }
}

function renderRoute() {
  document.body.dataset.route = state.route;
  document.body.classList.toggle("route-materials", state.route === "materials");

  const routeTitles = {
    home: "MatFinder AI",
    materials: `${t("navMaterials")} - MatFinder AI`,
    compare: `${t("navCompare")} - MatFinder AI`,
    copilot: `${t("navCopilot")} - MatFinder AI`,
    about: `${t("navAbout")} - MatFinder AI`
  };
  document.title = routeTitles[state.route] || "MatFinder AI";

  elements.routePanels.forEach((panel) => {
    const pages = String(panel.dataset.routePages || "").split(/\s+/);
    const routeVisible = pages.includes(state.route);
    panel.hidden = !routeVisible;
  });

  elements.routeLinks.forEach((link) => {
    const isActive = link.dataset.routeLink === state.route;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

async function loadMaterials() {
  elements.materialsGrid.innerHTML = `<p class="recommendation-empty">${t("generating")}</p>`;
  elements.emptyState.hidden = true;
  const response = await fetch(apiUrl("/api/materials?view=compact"));
  if (!response.ok) {
    throw new Error("Failed to load materials from SQLite.");
  }
  materials = await response.json();
  state.filteredMaterialsCache = { key: "", items: [] };
}

async function loadMaterialDetail(item) {
  if (materialDetailCache.has(item.id)) return materialDetailCache.get(item.id);
  const detailPromise = fetch(apiUrl(`/api/materials/${encodeURIComponent(item.id)}`))
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load material detail.");
      Object.assign(item, payload);
      delete item.__catalogSearchIndex;
      delete item.__signalText;
      delete item.__applicationSignalText;
      return item;
    })
    .catch((error) => {
      materialDetailCache.delete(item.id);
      throw error;
    });
  materialDetailCache.set(item.id, detailPromise);
  return detailPromise;
}

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function focusRequirementInput() {
  elements.requirementInput.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => elements.requirementInput.focus({ preventScroll: true }), 260);
}

function bindEvents() {
  elements.routeLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setRoute(link.dataset.routeLink);
    });
  });

  elements.startSelectionButton.addEventListener("click", focusRequirementInput);

  window.addEventListener("popstate", () => {
    state.route = routeFromPath(window.location.pathname);
    renderRoute();
    if (state.route === "compare") {
      renderCompare();
      renderAiComparePanel();
    }
    if (state.route === "copilot") {
      renderCopilotRoute();
    }
    if (state.route === "materials" && materials.length && !state.materialsGridRendered) {
      render();
    }
  });

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
    if (state.route === "copilot") {
      renderCopilotMessages();
    }
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
    state.recommendationQuery = "";
    state.recommendationResult = null;
    resetMaterialsPage();
    renderRecommendations();
    render();
  });

  elements.exampleButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const useCase = getOnboardingUseCases()[index];
      elements.requirementInput.value = useCase?.query || (state.language === "zh" ? button.dataset.exampleZh : button.dataset.exampleEn);
      runRecommendation();
    });
  });

  elements.copilotPromptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = state.language === "zh" ? button.dataset.copilotPromptZh : button.dataset.copilotPromptEn;
      askCopilot(prompt);
    });
  });

  elements.copilotForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = elements.copilotInput.value.trim();
    if (!prompt) return;
    askCopilot(prompt);
    elements.copilotInput.value = "";
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    resetMaterialsPage();
    render();
  });

  elements.categoryFilter.addEventListener("change", (event) => {
    state.category = event.target.value;
    resetMaterialsPage();
    render();
  });

  elements.propertyFilter.addEventListener("change", (event) => {
    state.property = event.target.value;
    resetMaterialsPage();
    render();
  });

  elements.propertyFacetFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-property]");
    if (!button) return;
    state.property = button.dataset.property;
    resetMaterialsPage();
    syncControls();
    render();
  });

  elements.domainFacetFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-domain]");
    if (!button) return;
    state.domain = button.dataset.domain;
    resetMaterialsPage();
    render();
  });

  elements.tempRange.addEventListener("input", (event) => {
    state.minTemp = Number(event.target.value);
    resetMaterialsPage();
    render();
  });

  elements.strengthRange.addEventListener("input", (event) => {
    state.minStrength = Number(event.target.value);
    resetMaterialsPage();
    render();
  });

  elements.recyclableOnly.addEventListener("change", (event) => {
    state.recyclableOnly = event.target.checked;
    resetMaterialsPage();
    render();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    resetMaterialsPage();
    render();
  });

  elements.resetButton.addEventListener("click", () => {
    state.query = "";
    state.category = "all";
    state.property = "all";
    state.domain = "all";
    state.minTemp = DEFAULT_MIN_TEMP;
    state.minStrength = DEFAULT_MIN_STRENGTH;
    state.recyclableOnly = false;
    state.sort = "match";
    resetMaterialsPage();
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
  state.recommendationQuery = elements.requirementInput.value.trim();
  const cacheKey = `${state.recommendationQuery}::${materials.length}`;
  let result = state.recommendationCache.get(cacheKey);
  if (!result) {
    result = await recommendationService.recommend(elements.requirementInput.value, { limit: 5 });
    state.recommendationCache.set(cacheKey, result);
  }
  state.recommendations = result.recommendations;
  state.recommendationCriteria = result.criteria;
  state.recommendationResult = result;
  resetMaterialsPage();
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
    item.name_en,
    item.name_zh,
    materialName(item),
    item.abbr,
    item.abbreviation,
    item.category,
    item.category_en,
    item.category_zh,
    item.subcategory,
    item.family,
    item.material_family,
    item.grade_name,
    item.supplier_or_brand,
    item.manufacturer,
    item.trade_name,
    materialCategory(item),
    item.summary,
    item.description,
    item.description_en,
    item.description_zh,
    materialSummary(item),
    item.notes,
    item.chemical_resistance,
    item.flame_rating,
    item.electrical_insulation,
    item.transparency,
    item.flexibility,
    item.waterproof_sealing,
    item.source_note,
    item.flammability,
    item.recyclability,
    item.cost_level,
    ...(item.tags || []),
    ...(item.tags_en || []),
    ...(item.tags_zh || []),
    ...materialTags(item),
    ...(item.uses || []),
    ...(item.applications || []),
    ...(item.applications_en || []),
    ...(item.applications_zh || []),
    ...materialUses(item),
    ...(item.processing_methods || []),
    ...(item.typical_applications || []),
    ...(item.advantages || []),
    ...(item.disadvantages || []),
    ...(item.limitations || []),
    ...(item.alternatives || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getMatchScore(item) {
  const recommendation = state.recommendations.find((candidate) => candidate.material.id === item.id);
  if (recommendation) return recommendation.score + 100;
  if (!state.query) return 0;
  return window.MatFinderCatalogSearch.scoreMaterial(item, state.query);
}

function localizedProfileText(en, zh) {
  return state.language === "zh" ? zh : en;
}

function materialAdvantageList(item) {
  if (item.data_quality?.recommendation_eligible === false) {
    return [
      state.language === "zh"
        ? "数据质量未通过，暂不提供该记录的性能优势结论。"
        : "Data quality failed; no performance advantage is asserted for this record."
    ];
  }
  if (Array.isArray(item.advantages) && item.advantages.length) {
    return item.advantages;
  }

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
  if (item.data_quality?.recommendation_eligible === false) {
    const issues = Array.isArray(item.data_quality?.issues) ? item.data_quality.issues : [];
    return issues.length
      ? issues.map((entry) => state.language === "zh" ? entry.zh : entry.en)
      : [
          state.language === "zh"
            ? "该记录没有足够的可验证来源。"
            : "This record lacks sufficient verifiable evidence."
        ];
  }
  if (Array.isArray(item.disadvantages) && item.disadvantages.length) {
    return item.disadvantages;
  }

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
    .filter((candidate) => candidate.id !== item.id && candidate.data_quality?.recommendation_eligible !== false)
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

function dataQualityMeta(item) {
  const level = item.data_quality?.level || "low";
  const labels = {
    high: { zh: "供应商级证据", en: "Supplier-backed evidence", tone: "high" },
    medium: { zh: "仅限初步筛选", en: "Screening evidence only", tone: "medium" },
    synthetic: { zh: "程序生成记录", en: "Generated record", tone: "synthetic" },
    rejected: { zh: "数据异常，已阻断", en: "Rejected data", tone: "rejected" },
    low: { zh: "来源不足", en: "Insufficient evidence", tone: "low" }
  };
  const meta = labels[level] || labels.low;
  return { ...meta, label: state.language === "zh" ? meta.zh : meta.en };
}

function renderDataQuality(item) {
  const quality = item.data_quality || {};
  const meta = dataQualityMeta(item);
  const languageIsZh = state.language === "zh";
  const issues = Array.isArray(quality.issues) ? quality.issues : [];
  const issueItems = issues.length
    ? issues.map((entry) => `<li>${escapeHtml(languageIsZh ? entry.zh : entry.en)}</li>`).join("")
    : `<li>${languageIsZh ? "当前自动检查没有发现明显异常，但仍须核对具体牌号数据表。" : "No obvious automated check failure was found; the grade-specific datasheet still requires review."}</li>`;
  const yes = languageIsZh ? "是" : "Yes";
  const no = languageIsZh ? "否" : "No";

  return `
    <section class="profile-section data-quality-section is-${meta.tone}">
      <div class="data-quality-heading">
        <div>
          <p class="result-label">${languageIsZh ? "证据与不确定性" : "Evidence and uncertainty"}</p>
          <h3>${escapeHtml(meta.label)}</h3>
        </div>
        <span class="quality-badge is-${meta.tone}">${escapeHtml(meta.label)}</span>
      </div>
      <div class="quality-facts">
        <span>${languageIsZh ? "外部来源" : "External sources"}: <strong>${escapeHtml(quality.external_source_count ?? 0)}</strong></span>
        <span>${languageIsZh ? "制造商资料" : "Manufacturer source"}: <strong>${quality.manufacturer_backed ? yes : no}</strong></span>
        <span>${languageIsZh ? "测试条件齐全" : "Test conditions attached"}: <strong>${quality.has_test_conditions ? yes : no}</strong></span>
        <span>${languageIsZh ? "可用于投产放行" : "Factory-release ready"}: <strong>${quality.factory_ready ? yes : no}</strong></span>
      </div>
      <ul class="quality-issues">${issueItems}</ul>
      <p class="profile-muted">${
        languageIsZh
          ? "连续使用温度、强度等数值只有在牌号、试样、测试标准、温度与介质条件一致时才可比较。"
          : "Numeric values are comparable only when grade, specimen, standard, temperature, and media conditions match."
      }</p>
    </section>
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

function materialDataText(item) {
  return [
    item.name,
    item.abbr,
    item.category,
    item.summary,
    item.notes,
    item.chemical_resistance,
    item.flammability,
    item.recyclability,
    ...(item.tags || []),
    ...(item.uses || []),
    ...(item.processing_methods || []),
    ...(item.typical_applications || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasAnyText(item, terms) {
  const text = materialDataText(item);
  return terms.some((term) => text.includes(term));
}

function formatValueFor(value, suffix = "", language = state.language) {
  if (value === null || value === undefined || value === "") {
    return language === "zh" ? "\u672a\u8bf4\u660e" : "Not specified";
  }
  return `${value}${suffix}`;
}

function keyedText(en, zh, language = state.language) {
  return language === "zh" ? zh : en;
}

function keyPropertyRows(item) {
  const tags = new Set((item.tags || []).map((tag) => String(tag).toLowerCase()));
  const text = materialDataText(item);
  const flexibleByData = tags.has("flexible") || tags.has("elastomer") || /elastomer|rubber|seal|gasket/.test(text);
  const transparentByData = hasAnyText(item, ["transparent", "clear", "optical", "window", "lens"]);
  const electricalByData = tags.has("electrical insulation") || /electrical|dielectric|connector|cable/.test(text);
  const waterproofByData = tags.has("low moisture") || hasAnyText(item, ["water resistant", "low water", "low moisture", "seal", "gasket", "pipe", "tank"]);
  const flameByData = tags.has("flame retardant") || hasAnyText(item, ["flame retardant", "fire", "self extinguishing"]);

  return [
    [t("density"), formatQualityCheckedValue(item, "density", item.density, " g/cm3")],
    [t("continuousUse"), formatQualityCheckedValue(item, "maxTemp", item.maxTemp, " deg C")],
    [
      t("propertyTransparency"),
      transparentByData
        ? keyedText("Indicated by local tags, uses, or summary.", "\u672c\u5730\u6807\u7b7e\u3001\u7528\u9014\u6216\u6458\u8981\u663e\u793a\u652f\u6301\u3002")
        : keyedText("Not indicated by local tags or uses.", "\u672c\u5730\u6807\u7b7e\u6216\u7528\u9014\u672a\u663e\u793a\u3002")
    ],
    [
      t("propertyFlexibility"),
      item.elongation !== null && item.elongation !== undefined
        ? `${formatValue(item.elongation, "%")} ${keyedText("elongation", "\u65ad\u88c2\u4f38\u957f\u7387")}`
        : flexibleByData
          ? keyedText("Indicated by local tags, category, or uses.", "\u672c\u5730\u6807\u7b7e\u3001\u7c7b\u522b\u6216\u7528\u9014\u663e\u793a\u652f\u6301\u3002")
          : formatValueFor(null)
    ],
    [
      t("propertyElectricalInsulation"),
      item.dielectric !== null && item.dielectric !== undefined
        ? `${t("dielectricConstant")} ${formatValue(item.dielectric)}`
        : electricalByData
          ? keyedText("Indicated by local tags or uses.", "\u672c\u5730\u6807\u7b7e\u6216\u7528\u9014\u663e\u793a\u652f\u6301\u3002")
          : formatValueFor(null)
    ],
    [
      t("propertyWaterproof"),
      item.water_absorption !== null && item.water_absorption !== undefined
        ? `${t("waterAbsorption")} ${formatValue(item.water_absorption, "%")}`
        : waterproofByData
          ? keyedText("Indicated by low-moisture, sealing, or fluid-handling data.", "\u4f4e\u5438\u6c34\u3001\u5bc6\u5c01\u6216\u6d41\u4f53\u4ecb\u8d28\u6570\u636e\u663e\u793a\u652f\u6301\u3002")
          : formatValueFor(null)
    ],
    [
      t("propertyFlameRetardant"),
      item.flammability ? formatQualityCheckedValue(item, "flammability", item.flammability) : flameByData ? keyedText("Indicated by local tags or uses.", "\u672c\u5730\u6807\u7b7e\u6216\u7528\u9014\u663e\u793a\u652f\u6301\u3002") : formatValueFor(null)
    ],
    [
      t("chemicalResistance"),
      item.chemical_resistance ? formatValue(item.chemical_resistance) : tags.has("chemical resistant") ? keyedText("Indicated by local tags.", "\u672c\u5730\u6807\u7b7e\u663e\u793a\u652f\u6301\u3002") : formatValueFor(null)
    ]
  ];
}

function formatQualityCheckedValue(item, field, value, suffix = "") {
  const issues = item.data_quality?.issues || [];
  const issueCodes = new Set(issues.map((entry) => entry.code));
  const fieldIssues = {
    density: ["density_out_of_range"],
    maxTemp: ["max_temperature_out_of_range", "temperature_inconsistency"],
    tensile: ["tensile_out_of_range"],
    tm: ["melting_temperature_out_of_range", "temperature_inconsistency"],
    flammability: ["flammability_inconsistency"]
  };
  if (
    (item.data_quality?.level === "rejected" && !issues.length) ||
    (fieldIssues[field] || []).some((code) => issueCodes.has(code))
  ) {
    return state.language === "zh" ? "异常值已阻断" : "Invalid value blocked";
  }
  return formatValue(value, suffix);
}

function getRecommendationForMaterial(item) {
  return state.recommendations.find((candidate) => candidate.material.id === item.id) || null;
}

function meaningfulWarnings(candidate) {
  return (candidate?.warnings || []).filter(Boolean);
}

function getActiveRecommendationRequirement() {
  if (elements.requirementInput) {
    return elements.requirementInput.value.trim();
  }
  return String(state.recommendationQuery || "").trim();
}

function getScoredRecommendationForMaterial(item) {
  return getActiveRecommendationRequirement() ? getRecommendationForMaterial(item) : null;
}

function buildMaterialSummary(item, language) {
  if (item.data_quality?.level === "rejected") {
    return language === "zh"
      ? `${materialNameFor(item, language)} 的材料记录存在不合理或相互矛盾的数值，已停止作为选材、比较或投产依据。请先修复数据并核对具体牌号原始资料。`
      : `${materialNameFor(item, language)} contains implausible or contradictory values and is blocked for selection, comparison, and factory release. Correct the data against an original grade-level source first.`;
  }
  const name = materialNameFor(item, language);
  const category = materialCategoryFor(item, language);
  const propertyLabels = language === "zh"
    ? {
        maxTemp: "\u8fde\u7eed\u4f7f\u7528",
        tensile: "\u62c9\u4f38\u5f3a\u5ea6",
        density: "\u5bc6\u5ea6",
        chemical: "\u8010\u5316\u5b66\u6027"
      }
    : {
        maxTemp: "continuous use",
        tensile: "tensile strength",
        density: "density",
        chemical: "chemical resistance"
      };
  const properties = [
    [propertyLabels.maxTemp, item.maxTemp, " deg C"],
    [propertyLabels.tensile, item.tensile, " MPa"],
    [propertyLabels.density, item.density, " g/cm3"],
    [propertyLabels.chemical, item.chemical_resistance, ""]
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 3)
    .map(([label, value, suffix]) => `${label} ${formatValueFor(value, suffix, language)}`)
    .join(language === "zh" ? "\u3001" : "; ");
  const uses = materialUsesFor(item, language).slice(0, 3).join(language === "zh" ? "\u3001" : ", ");

  if (language === "zh") {
    return `${name}\u5c5e\u4e8e${category}\u3002\u6750\u6599\u6863\u6848\u663e\u793a${properties || "\u5176\u5177\u5907\u5e38\u89c4\u5de5\u7a0b\u6750\u6599\u5c5e\u6027"}\u3002\u5178\u578b\u5e94\u7528\u5305\u62ec${uses || "\u6682\u672a\u8bf4\u660e"}\u3002\u53ef\u7ed3\u5408\u5177\u4f53\u724c\u53f7\u3001\u5de5\u827a\u548c\u4f9b\u5e94\u5546\u6570\u636e\u8fdb\u4e00\u6b65\u786e\u8ba4\u3002`;
  }

  return `${name} is a ${category}. The material profile lists ${properties || "standard engineering-material properties"}. Typical applications include ${uses || "not specified"}. Confirm against the specific grade, process, and supplier data before selection.`;
}

function buildRecommendationSummary(item, candidate, language) {
  if (!candidate) {
    return buildMaterialSummary(item, language);
  }

  const name = materialNameFor(item, language);
  const category = materialCategoryFor(item, language);
  const score = candidate ? `${candidate.score}/100` : formatValueFor(null, "", language);
  const reasons = (candidate?.reasons || []).map((reason) => localizeRecommendationReasonFor(reason, language)).filter(Boolean);
  const warnings = meaningfulWarnings(candidate).map((warning) => localizeRecommendationReasonFor(warning, language));
  const uses = materialUsesFor(item, language).slice(0, 3).join(language === "zh" ? "\u3001" : ", ");
  const primaryReason = reasons.length ? reasons.join(language === "zh" ? "\u3001" : "; ") : (language === "zh" ? "\u672c\u5730\u6750\u6599\u6570\u636e\u7684\u7efc\u5408\u5339\u914d" : "the combined local material-data fit");
  const warningText = warnings.length ? warnings[0] : (language === "zh" ? "\u8bc4\u5206\u5f15\u64ce\u672a\u6807\u51fa\u4e3b\u8981\u672a\u5339\u914d\u8b66\u544a" : "the scoring engine did not flag a major unmatched warning");

  if (language === "zh") {
    return `${name}\u5c5e\u4e8e${category}\uff0c\u63a8\u8350\u5206\u6570\u4e3a ${score}\u3002\u4e3b\u8981\u4f9d\u636e\u662f${primaryReason}\u3002\u672c\u5730\u6570\u636e\u96c6\u4e2d\u7684\u5178\u578b\u5e94\u7528\u5305\u62ec${uses || "\u672a\u8bf4\u660e"}\u3002\u9650\u5236\u63d0\u793a\uff1a${warningText}\u3002`;
  }

  return `${name} is a ${category} with a recommendation score of ${score}. The scoring engine favored it for ${primaryReason}. Typical local-dataset applications include ${uses || "not specified"}. Limitation signal: ${warningText}.`;
}

function rankSimilarMaterials(item, limit = 5) {
  return materials
    .filter((candidate) => candidate.id !== item.id && candidate.data_quality?.recommendation_eligible !== false)
    .map((candidate) => {
      const sharedTags = candidate.tags.filter((tag) => item.tags.includes(tag)).length;
      const sharedUses = candidate.uses.filter((use) => item.uses.includes(use)).length;
      const sameCategory = candidate.category === item.category ? 8 : 0;
      const densityFit = item.density && candidate.density ? Math.max(0, 4 - Math.abs(item.density - candidate.density) * 4) : 0;
      const tempFit = item.maxTemp !== null && candidate.maxTemp !== null ? Math.max(0, 5 - Math.abs(item.maxTemp - candidate.maxTemp) / 35) : 0;
      const rawScore = sameCategory + sharedTags * 3 + sharedUses * 2 + densityFit + tempFit;
      return {
        material: candidate,
        score: Math.round(Math.min(100, (rawScore / 24) * 100))
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
    .slice(0, limit);
}

function renderKeyProperties(item) {
  return `
    <div class="key-property-grid">
      ${keyPropertyRows(item)
        .map(
          ([label, value]) => `
            <div class="metric key-property">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRankedAlternatives(item) {
  const alternatives = rankSimilarMaterials(item);
  if (!alternatives.length) {
    return `<p class="profile-muted">${t("noAlternativeMaterials")}</p>`;
  }

  return `
    <div class="similar-grid ranked-alternatives">
      ${alternatives
        .map(
          (entry, index) => `
            <button class="similar-card ranked-alternative" type="button" data-profile-id="${entry.material.id}">
              <span>#${index + 1} ${escapeHtml(entry.material.abbr)} · ${t("similarityScore")} ${entry.score}</span>
              <strong>${escapeHtml(materialName(entry.material))}</strong>
              <small>${escapeHtml(materialCategory(entry.material))}</small>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function getCopilotContext() {
  const selectedItem = state.selectedMaterialId ? materials.find((material) => material.id === state.selectedMaterialId) : null;
  const recommendedItem = state.recommendations[0]?.material || null;
  const item = selectedItem || recommendedItem;
  if (!item) return { item: null, candidate: null };
  return {
    item,
    candidate: getRecommendationForMaterial(item)
  };
}

function updateCopilotContext() {
  if (!elements.copilotContext) return;
  const { item, candidate } = getCopilotContext();
  elements.copilotContext.textContent = item
    ? `${t("copilotContextPrefix")}: ${materialName(item)}${candidate ? ` · ${t("copilotScore")} ${candidate.score}` : ""}`
    : t("copilotContextEmpty");
}

function renderCopilotRoute() {
  updateCopilotContext();
  renderCopilotMessages();
}

function detectCopilotIntent(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (
    /(?:\btg\b.*\btm\b|\btm\b.*\btg\b|glass transition|melting (?:point|temperature)|玻璃化温度|熔点|熔融温度)/i.test(text)
  ) return "thermal_concepts";
  if (
    /source|citation|reference|literature|datasheet|test method|test standard|specimen|原始文献|来源|引用|数据表|测试方法|试验方法|测试标准|试样条件/i.test(text)
  ) return "evidence";
  if (/why|recommend|recommended|推荐|为什么|为何|原因/.test(text)) return "why";
  if (/advantage|strength|benefit|优点|优势|好处|强项/.test(text)) return "advantages";
  if (/limitation|weakness|risk|disadvantage|缺点|限制|风险|不足|弱点/.test(text)) return "limitations";
  if (/alternative|similar|replace|substitute|替代|相似|备选|换/.test(text)) return "alternatives";
  return "overview";
}

function copilotSourceList(item) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  if (!sources.length) {
    return state.language === "zh" ? "- 未附来源记录" : "- No source record is attached";
  }
  return sources
    .map((source, index) => {
      const title = source.source_title || (state.language === "zh" ? "未命名来源" : "Untitled source");
      const type = source.source_type || (state.language === "zh" ? "类型未知" : "unknown type");
      const url = source.source_url || (state.language === "zh" ? "无链接" : "no link");
      return `- ${index + 1}. ${title} [${type}]: ${url}`;
    })
    .join("\n");
}

function copilotQualityIssues(item) {
  const issues = Array.isArray(item.data_quality?.issues) ? item.data_quality.issues : [];
  return issues.map((entry) => state.language === "zh" ? entry.zh : entry.en).filter(Boolean);
}

function buildCopilotEvidenceAnswer(item) {
  const languageIsZh = state.language === "zh";
  const quality = item.data_quality || {};
  const issues = copilotQualityIssues(item);
  const testStatus = quality.has_test_conditions
    ? (languageIsZh ? "记录附有测试标准与条件，但仍需打开原文核对。" : "A test standard and conditions are attached, but the original still requires review.")
    : (languageIsZh ? "记录没有附带测试标准、试样状态或测试温度。" : "The record does not attach a test standard, specimen condition, or test temperature.");
  return [
    languageIsZh ? `证据审查：${materialName(item)} (${item.abbr})` : `Evidence review: ${materialName(item)} (${item.abbr})`,
    `${languageIsZh ? "证据等级" : "Evidence level"}: ${dataQualityMeta(item).label}`,
    `${languageIsZh ? "测试条件" : "Test conditions"}: ${testStatus}`,
    issues.length
      ? `${languageIsZh ? "已发现的问题" : "Detected issues"}:\n${copilotLineList(issues)}`
      : null,
    `${languageIsZh ? "当前记录附带的来源" : "Sources attached to this record"}:\n${copilotSourceList(item)}`,
    languageIsZh
      ? "这些链接只是当前记录声称使用的来源；除非原页面明确给出相同牌号、数值、测试方法和条件，否则不能视为该数值的原始文献。"
      : "These are only the sources claimed by the record. They are not original evidence for a value unless the page states the same grade, value, method, and conditions."
  ].filter(Boolean).join("\n\n");
}

function buildCopilotThermalConceptAnswer(item) {
  const languageIsZh = state.language === "zh";
  const issueText = copilotQualityIssues(item);
  if (languageIsZh) {
    return [
      "Tg 与 Tm 不是同一个概念：",
      "- Tg（玻璃化温度）：非晶区域由硬脆玻璃态逐渐转为高弹态的温区，通常不是一个绝对单点，并受测试方法、升温速率、含水率和配方影响。",
      "- Tm（熔融温度）：结晶区域晶体结构熔化的温区；无定形聚合物通常没有真正的 Tm。",
      "- 两者都不等于“连续使用温度”。连续使用温度还取决于载荷、时间、氧化、介质、阻燃体系和允许变形。",
      "",
      `${materialName(item)} 记录中的数值结论：不能接受为事实。当前记录已被数据质量层阻断。`,
      issueText.length ? copilotLineList(issueText) : "- 缺乏可验证证据。",
      "",
      "1000°C 对 GF-ABS 这类热塑性聚合物是明显异常值；在原始牌号数据表、测试标准和试样条件缺失时，正确做法是撤销该数值，而不是为它编理由。",
      "",
      "常见验证方法：Tg/Tm 可用 DSC 测量，Tg 也常用 DMA；报告时必须同时给出标准、仪器方法、升温频率、试样状态和取值规则。",
      "",
      buildCopilotEvidenceAnswer(item)
    ].join("\n");
  }

  return [
    "Tg and Tm are different concepts:",
    "- Tg is the transition range where amorphous regions change from glassy to rubber-like behavior. It depends on method, rate, moisture, and formulation.",
    "- Tm is the melting range of crystalline regions. Fully amorphous polymers do not have a true Tm.",
    "- Neither value is the continuous-use temperature, which also depends on load, time, oxidation, media, formulation, and allowable deformation.",
    "",
    `The numeric claim in ${materialName(item)} is not acceptable as fact. This record has been blocked by the data-quality layer.`,
    issueText.length ? copilotLineList(issueText) : "- Verifiable evidence is missing.",
    "",
    "A 1000°C continuous-use claim is plainly implausible for a GF-ABS thermoplastic. Without a grade datasheet, method, and specimen conditions, the value must be withdrawn rather than rationalized.",
    "",
    "DSC is commonly used for Tg/Tm and DMA is also common for Tg. A usable report must identify the standard, instrument method, rate or frequency, specimen condition, and interpretation rule.",
    "",
    buildCopilotEvidenceAnswer(item)
  ].join("\n");
}

function buildCopilotBlockedAnswer(item) {
  const languageIsZh = state.language === "zh";
  const issues = copilotQualityIssues(item);
  return [
    languageIsZh
      ? `停止：${materialName(item)} (${item.abbr}) 的记录不可信，不能继续把其中数值当作事实解释。`
      : `Stop: the ${materialName(item)} (${item.abbr}) record is not trustworthy enough to interpret as fact.`,
    issues.length ? copilotLineList(issues) : `- ${languageIsZh ? "缺乏可验证来源。" : "Verifiable evidence is missing."}`,
    "",
    languageIsZh
      ? "你仍可询问材料概念；涉及该记录的性能、优点或推荐时，必须先修复数据并核对具体牌号原始资料。"
      : "You can still ask about material concepts. Record-specific properties, benefits, or recommendations require corrected data and an original grade-level source first.",
    "",
    buildCopilotEvidenceAnswer(item)
  ].join("\n");
}

function copilotLineList(items) {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function formatCopilotAlternatives(item) {
  const alternatives = rankSimilarMaterials(item, 4);
  if (!alternatives.length) return `- ${t("noAlternativeMaterials")}`;
  return alternatives
    .map((entry, index) => {
      const material = entry.material;
      return `- #${index + 1} ${materialName(material)} (${material.abbr}) · ${t("similarityScore")} ${entry.score}: ${materialCategory(material)}, ${materialUses(material).slice(0, 2).join(state.language === "zh" ? "、" : ", ") || t("notSpecified")}`;
    })
    .join("\n");
}

function buildCopilotAnswer(prompt) {
  const { item, candidate } = getCopilotContext();
  if (!item) {
    const parsed = window.MatFinderAI?.parseRequirement?.(prompt);
    if (parsed?.requirements?.length) {
      return `${t("reportDetectedRequirements")}:\n${copilotLineList(parsed.requirements.map(localizeTerm))}\n\n${state.language === "zh" ? "可以把这段需求放到首页推荐框中生成材料候选。" : "Use this requirement text on the Home recommendation panel to generate candidate materials."}`;
    }
    return t("copilotNoContext");
  }

  const intent = detectCopilotIntent(prompt);
  const recommendationNote = candidate ? "" : `\n\n${t("copilotNoRecommendation")}`;
  const sourceNote = `\n\n${t("copilotSourceNote")}`;

  if (intent === "thermal_concepts") {
    return buildCopilotThermalConceptAnswer(item);
  }

  if (intent === "evidence") {
    return buildCopilotEvidenceAnswer(item);
  }

  if (item.data_quality?.recommendation_eligible === false) {
    return buildCopilotBlockedAnswer(item);
  }

  if (intent === "why") {
    const reasons = (candidate?.reasons || []).map(localizeRecommendationReason);
    const warnings = meaningfulWarnings(candidate).map(localizeRecommendationReason);
    const lines = [
      `${t("copilotWhyTitle")}: ${materialName(item)} (${item.abbr})`,
      candidate ? `${t("copilotScore")}: ${candidate.score}/100` : null,
      candidate?.matchedCriteria?.length ? `${t("copilotMatchedRequirements")}: ${candidate.matchedCriteria.map(localizeTerm).join(state.language === "zh" ? "、" : ", ")}` : null,
      reasons.length ? copilotLineList(reasons) : `- ${materialSummary(item)}`,
      warnings.length ? `${t("unmatchedWarnings")}:\n${copilotLineList(warnings)}` : null
    ].filter(Boolean);
    return `${lines.join("\n")}${recommendationNote}${sourceNote}`;
  }

  if (intent === "advantages") {
    return `${t("copilotAdvantagesTitle")}: ${materialName(item)} (${item.abbr})\n${copilotLineList(materialAdvantageList(item))}${sourceNote}`;
  }

  if (intent === "limitations") {
    const limitations = [...meaningfulWarnings(candidate).map(localizeRecommendationReason), ...materialDisadvantageList(item)];
    return `${t("copilotLimitationsTitle")}: ${materialName(item)} (${item.abbr})\n${copilotLineList([...new Set(limitations)])}${recommendationNote}${sourceNote}`;
  }

  if (intent === "alternatives") {
    return `${t("copilotAlternativesTitle")}: ${materialName(item)} (${item.abbr})\n${formatCopilotAlternatives(item)}${sourceNote}`;
  }

  const overview = [
    `${t("copilotOverviewTitle")}: ${materialName(item)} (${item.abbr})`,
    `${t("category")}: ${materialCategory(item)}`,
    candidate ? `${t("copilotScore")}: ${candidate.score}/100` : null,
    `${t("continuousUse")}: ${formatValue(item.maxTemp, " deg C")}`,
    `${t("density")}: ${formatValue(item.density, " g/cm3")}`,
    `${t("typicalUses")}: ${materialUses(item).slice(0, 4).join(state.language === "zh" ? "、" : ", ") || t("notSpecified")}`,
    materialSummary(item)
  ].filter(Boolean);
  return `${overview.join("\n")}${recommendationNote}${sourceNote}`;
}

function askCopilot(prompt) {
  const question = prompt || t("copilotDefaultQuestion");
  state.copilotMessages.push({ role: "user", text: question });
  state.copilotMessages.push({ role: "assistant", text: buildCopilotAnswer(question) });
  renderCopilotMessages();
}

function renderCopilotMessages() {
  if (!elements.copilotMessages) return;

  if (!state.copilotMessages.length) {
    elements.copilotMessages.innerHTML = `<p class="recommendation-empty">${t("copilotEmpty")}</p>`;
    return;
  }

  elements.copilotMessages.innerHTML = state.copilotMessages
    .slice(-8)
    .map(
      (message) => `
        <article class="copilot-message ${message.role === "user" ? "is-user" : "is-assistant"}">
          ${escapeHtml(message.text).replace(/\n/g, "<br>")}
        </article>
      `
    )
    .join("");
  elements.copilotMessages.scrollTop = elements.copilotMessages.scrollHeight;
}

function renderScoringList(items) {
  const list = items.length ? items : [t("notSpecified")];
  return renderProfileList(list);
}

function renderRecommendationDetail(item) {
  const candidate = getScoredRecommendationForMaterial(item);
  const hasRecommendationContext = Boolean(candidate);
  const scoringReasons = (candidate?.reasons || []).map(localizeRecommendationReason);
  const warningsAndLimitations = [
    ...meaningfulWarnings(candidate).map(localizeRecommendationReason),
    ...materialDisadvantageList(item)
  ].filter(Boolean);
  const summaryFor = (language) => hasRecommendationContext
    ? buildRecommendationSummary(item, candidate, language)
    : buildMaterialSummary(item, language);
  const scoreCard = hasRecommendationContext
    ? `
      <div class="detail-score-card">
        <span>${t("matchScore")}</span>
        <strong>${escapeHtml(candidate.score)}</strong>
      </div>
    `
    : `
      <div class="detail-score-card is-pending">
        <span>${t("matchStatusTitle")}</span>
        <strong class="detail-status-value">${t("matchStatusPendingValue")}</strong>
        <small>${t("matchStatusPendingHelper")}</small>
      </div>
    `;
  const contextSections = hasRecommendationContext
    ? `
      <div class="profile-grid">
        <section class="profile-section">
          <h3>${t("matchReasons")}</h3>
          ${renderScoringList(scoringReasons)}
        </section>
        <section class="profile-section">
          <h3>${t("riskLimitations")}</h3>
          ${renderScoringList([...new Set(warningsAndLimitations)])}
        </section>
      </div>
    `
    : `
      <div class="profile-grid">
        <section class="profile-section">
          <h3>${t("advantages")}</h3>
          ${renderProfileList(materialAdvantageList(item))}
        </section>
        <section class="profile-section">
          <h3>${t("processingMethods")}</h3>
          ${renderProfileList(item.processing_methods?.length ? item.processing_methods : [t("notSpecified")])}
        </section>
      </div>
    `;

  elements.detailContent.innerHTML = `
    <div class="profile-hero recommendation-detail-hero">
      <div>
        <span class="category">${escapeHtml(materialCategory(item))}</span>
        <span class="quality-badge is-${dataQualityMeta(item).tone}">${escapeHtml(dataQualityMeta(item).label)}</span>
        <p class="result-label">${hasRecommendationContext ? t("recommendationExplanation") : t("materialProfile")}</p>
        <h2>${escapeHtml(materialName(item))} (${escapeHtml(item.abbr)})</h2>
        <p class="summary">${escapeHtml(materialSummary(item))}</p>
      </div>
      ${scoreCard}
    </div>

    <section class="profile-section detail-summary-section">
      <h3>${hasRecommendationContext ? t("recommendationSummary") : t("materialSummaryHeading")}</h3>
      <p>${escapeHtml(summaryFor(state.language))}</p>
      <div class="profile-actions">
        <button class="secondary-context-button" type="button" data-ask-copilot>${t("askCopilot")}</button>
      </div>
    </section>

    <div class="explanation-grid">
      <section class="profile-section">
        <h3>${t("chineseExplanation")}</h3>
        <p lang="zh-CN">${escapeHtml(summaryFor("zh"))}</p>
      </section>
      <section class="profile-section">
        <h3>${t("englishExplanation")}</h3>
        <p lang="en">${escapeHtml(summaryFor("en"))}</p>
      </section>
    </div>

    ${contextSections}

    ${renderDataQuality(item)}

    <section class="profile-section">
      <h3>${t("typicalUses")}</h3>
      ${renderProfileList(materialUses(item))}
    </section>

    <section class="profile-section">
      <h3>${t("keyProperties")}</h3>
      ${renderKeyProperties(item)}
    </section>

    <section class="profile-section">
      <h3>${hasRecommendationContext ? t("alternativeMaterials") : t("similarMaterials")}</h3>
      ${renderRankedAlternatives(item)}
    </section>

    <section class="profile-section">
      <h3>${t("materialSources")}</h3>
      ${renderSources(item)}
    </section>
  `;

  elements.detailContent.querySelectorAll("[data-profile-id]").forEach((button) => {
    button.addEventListener("click", () => showDetail(button.dataset.profileId));
  });
  elements.detailContent.querySelector("[data-ask-copilot]")?.addEventListener("click", () => {
    elements.detailDialog.close();
    setRoute("copilot");
  });

  if (!elements.detailDialog.open) {
    elements.detailDialog.showModal();
  }
}

function getFilteredMaterials() {
  const cacheKey = JSON.stringify({
    language: state.language,
    query: state.query,
    category: state.category,
    property: state.property,
    domain: state.domain,
    minTemp: state.minTemp,
    minStrength: state.minStrength,
    recyclableOnly: state.recyclableOnly,
    sort: state.sort,
    recommendations: state.recommendations.map((candidate) => `${candidate.material.id}:${candidate.score}`)
  });

  if (state.filteredMaterialsCache.key === cacheKey) {
    return state.filteredMaterialsCache.items;
  }

  const items = materials
    .filter((item) => matchesCatalogFilters(item, { includeProperty: true }))
    .sort(sortMaterials);

  state.filteredMaterialsCache = { key: cacheKey, items };
  return items;
}

function matchesCatalogFilters(item, options = {}) {
  const includeProperty = options.includeProperty !== false;
  const includeDomain = options.includeDomain !== false;
  const propertyPredicate = propertyPredicates[state.property];
  const domain = getApplicationDomain(state.domain);
  return window.MatFinderCatalogSearch.matchesMaterial(item, state.query)
    && (state.category === "all" || item.category === state.category)
    && (!includeProperty || state.property === "all" || (propertyPredicate && propertyPredicate(item)))
    && (!includeDomain || state.domain === "all" || (domain && matchesApplicationDomain(item, domain)))
    && numberValue(item.maxTemp) >= state.minTemp
    && numberValue(item.tensile) >= state.minStrength
    && (!state.recyclableOnly || item.recyclable);
}

function sortMaterials(a, b) {
  const byName = a.name.localeCompare(b.name);
  if (state.sort === "temperature") return b.maxTemp - a.maxTemp || byName;
  if (state.sort === "strength") return b.tensile - a.tensile || byName;
  if (state.sort === "density") return a.density - b.density || byName;
  if (state.sort === "name") return byName;
  return getMatchScore(b) - getMatchScore(a) || byName;
}

function getCategoryCounts() {
  const counts = new Map();
  materials.forEach((item) => {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderCatalogStats() {
  if (!elements.catalogStats || !materials.length) return;
  const categoryCounts = getCategoryCounts();
  const topCategory = categoryCounts[0];
  const topCategories = categoryCounts.slice(0, 5);

  elements.catalogStats.innerHTML = `
    <div class="catalog-stat">
      <span>${t("catalogTotalMaterials")}</span>
      <strong>${materials.length}</strong>
    </div>
    <div class="catalog-stat">
      <span>${t("catalogCategories")}</span>
      <strong>${categories.length}</strong>
    </div>
    <div class="catalog-stat catalog-stat-wide">
      <span>${t("catalogTopCategory")}</span>
      <strong>${topCategory ? `${localizeTerm(topCategory[0])} · ${topCategory[1]}` : t("none")}</strong>
    </div>
    <div class="catalog-category-strip">
      ${topCategories.map(([category, count]) => `<span>${localizeTerm(category)} <strong>${count}</strong></span>`).join("")}
    </div>
  `;
}

function render() {
  const needsMaterialGrid = state.route === "materials";
  const filtered = needsMaterialGrid ? getFilteredMaterials() : state.filteredMaterialsCache.items;
  elements.tempOutput.textContent = state.minTemp === DEFAULT_MIN_TEMP
    ? (state.language === "zh" ? "不限" : "Any")
    : `>= ${state.minTemp} deg C`;
  elements.strengthOutput.textContent = state.minStrength === DEFAULT_MIN_STRENGTH
    ? (state.language === "zh" ? "不限" : "Any")
    : `>= ${state.minStrength} MPa`;
  elements.selectedCount.textContent = state.selected.size;
  renderCatalogStats();
  renderPropertyFacets();
  renderDomainFacets();

  if (needsMaterialGrid) {
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.materialsPageSize));
    if (state.materialsPage > totalPages) state.materialsPage = totalPages;
    const pageStart = (state.materialsPage - 1) * state.materialsPageSize;
    const pageItems = filtered.slice(pageStart, pageStart + state.materialsPageSize);

    elements.resultTitle.textContent = `${filtered.length} ${t("matchingMaterials")}`;
    elements.emptyState.hidden = filtered.length > 0;

    renderChips();
    renderCards(pageItems);
    renderMaterialsPagination(filtered.length, totalPages);
  }

  if (state.route === "compare") {
    renderCompare();
    renderAiComparePanel();
  }
  if (state.route === "copilot") {
    updateCopilotContext();
  }
  renderRoute();
}

function renderRecommendations(result = state.recommendationResult) {
  if (!state.recommendations.length) {
    renderRecommendationEmptyState(result);
    return;
  }

  const criteria = result?.criteria || state.recommendationCriteria;
  const criteriaText = criteria.length
    ? `${t("matchedRequirements")}: ${criteria.map(localizeTerm).join(state.language === "zh" ? "、" : ", ")}`
    : t("localDatasetMatch");
  elements.recommendationResults.innerHTML = `
    ${renderRecommendationSafetyBanner(result)}
    <div class="recommendation-results-header">
      <div>
        <p class="result-label">${t("recommendedMaterials")}</p>
        <h2>${criteriaText}</h2>
      </div>
      <button class="report-export-button" type="button" data-export-report>${t("exportReport")}</button>
    </div>
    ${state.recommendations.map(renderRecommendationCard).join("")}
  `;

  elements.recommendationResults.querySelectorAll("[data-detail-id]").forEach((button) => {
    button.addEventListener("click", () => showDetail(button.dataset.detailId));
  });
  elements.recommendationResults.querySelectorAll("[data-compare-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleCompare(button.dataset.compareId);
      renderRecommendations();
    });
  });
  elements.recommendationResults.querySelector("[data-export-report]")?.addEventListener("click", exportMaterialSelectionReport);
}

function getOnboardingUseCases() {
  return [
    {
      label: t("emptyUseCaseOne"),
      query: state.language === "zh"
        ? "\u6211\u9700\u8981\u4e00\u79cd\u9002\u5408\u65b0\u80fd\u6e90\u6c7d\u8f66\u7535\u6c60\u5305\u5bc6\u5c01\u5708\u7684\u8010\u70ed\u3001\u8010\u5316\u5b66\u8150\u8680\u5f39\u6027\u4f53\u6750\u6599\u3002"
        : "I need a heat-resistant, chemically corrosion-resistant elastomer for an EV battery pack sealing ring."
    },
    {
      label: t("emptyUseCaseTwo"),
      query: state.language === "zh"
        ? "\u6211\u9700\u8981\u4e00\u79cd\u900f\u660e\u3001\u6297\u51b2\u51fb\u7684\u5de5\u7a0b\u5851\u6599\uff0c\u7528\u4e8e\u6237\u5916\u9632\u62a4\u7f69\u3002"
        : "I need a transparent, impact-resistant engineering plastic for an outdoor protective cover."
    },
    {
      label: t("emptyUseCaseThree"),
      query: state.language === "zh"
        ? "\u63a8\u8350\u4e00\u79cd\u9002\u5408\u8150\u8680\u6027\u4ecb\u8d28\u5bc6\u5c01\u4ef6\u7684\u8010\u5316\u5b66\u8150\u8680\u6750\u6599\u3002"
        : "Recommend a chemically corrosion-resistant material for seals exposed to aggressive media."
    }
  ];
}

function renderBomClarificationGuide(languageIsZh) {
  const fields = languageIsZh
    ? [
        ["1. 产品结构", "列出杯体、内胆、杯盖、密封圈、阀件、涂层、包装等每个独立部件及功能。"],
        ["2. 尺寸与数量", "给出每件数量、尺寸/体积、目标净重；仅有“生产 10,000 个”无法计算材料用量。"],
        ["3. 工艺与损耗", "指定注塑、吹塑、冲压、拉深、焊接或涂装工艺，并给出水口、边料、良率和启动损耗。"],
        ["4. 使用工况", "给出冷热温度、接触时间、压力、跌落、洗碗机、化学清洗剂和寿命要求。"],
        ["5. 法规与测试", "明确销售国家/地区及食品接触、迁移、阻燃等标准；必须落实到具体牌号和测试报告。"],
        ["6. 采购边界", "给出采购地区、币种、交期、MOQ、供应商白名单和允许的替代牌号。"]
      ]
    : [
        ["1. Product architecture", "List every independent component and function, such as body, liner, lid, seal, valve, coating, and packaging."],
        ["2. Dimensions and counts", "Provide quantity per unit, dimensions or volume, and target net mass. A 10,000-unit total alone cannot determine material demand."],
        ["3. Process and loss", "Specify molding, blowing, stamping, drawing, welding, or coating, plus runner loss, trim, yield, and start-up scrap."],
        ["4. Service conditions", "State hot/cold temperature, contact time, pressure, drop, dishwasher, cleaning chemistry, and design life."],
        ["5. Regulation and tests", "State the sales region and applicable food-contact, migration, flame, or other standards, tied to a specific grade and report."],
        ["6. Sourcing boundary", "State purchasing region, currency, lead time, MOQ, approved suppliers, and permitted substitute grades."]
      ];
  const columns = languageIsZh
    ? ["部件", "功能", "具体牌号", "工艺", "单件数量", "净重", "损耗率", "采购量", "来源/验证"]
    : ["Component", "Function", "Exact grade", "Process", "Qty/unit", "Net mass", "Scrap %", "Buy quantity", "Source/verification"];

  return `
    <div class="bom-guidance">
      <div>
        <h3>${languageIsZh ? "先补齐以下输入，再生成 BOM" : "Complete these inputs before generating a BOM"}</h3>
        <div class="bom-field-grid">
          ${fields.map(([title, body]) => `
            <article>
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(body)}</p>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="bom-template">
        <h3>${languageIsZh ? "最终 BOM 至少应包含这些列" : "The final BOM must contain at least these columns"}</h3>
        <div class="bom-column-list">${columns.map((column) => `<span>${escapeHtml(column)}</span>`).join("")}</div>
        <p>${
          languageIsZh
            ? "采购量计算应为：单件净用量 × 产量 ÷ 良率，再加启动/换线安全量；没有几何尺寸和工艺损耗时，不输出假数字。"
            : "Purchase quantity should use net use per unit × production quantity ÷ yield, plus start-up or changeover allowance. No geometry and process loss means no invented quantity."
        }</p>
      </div>
    </div>
  `;
}

function renderRecommendationEmptyState(result = null) {
  if (result?.query && result.status && result.status !== "empty") {
    const unsupported = result.parsedRequirement?.unsupportedConstraints || [];
    const hard = result.parsedRequirement?.hardConstraints || {};
    const detected = result.criteria || [];
    const languageIsZh = state.language === "zh";
    const title = result.status === "no_safe_match"
      ? (languageIsZh ? "\u6ca1\u6709\u901a\u8fc7\u786c\u6027\u6761\u4ef6\u7684\u53ef\u4fe1\u5019\u9009" : "No trustworthy candidate passed the hard constraints")
      : (languageIsZh ? "\u5f53\u524d\u9700\u6c42\u65e0\u6cd5\u5b89\u5168\u81ea\u52a8\u63a8\u8350" : "This request cannot be safely auto-recommended");
    const body = result.status === "needs_clarification"
      ? (languageIsZh
          ? "\u8bf7\u5148\u8865\u5145\u90e8\u4ef6\u3001\u5de5\u51b5\u3001\u6e29\u5ea6\u3001\u8f7d\u8377\u548c\u4ecb\u8d28\u7b49\u53ef\u9a8c\u8bc1\u7684\u9009\u6750\u6761\u4ef6\u3002\u7cfb\u7edf\u4e0d\u518d\u4f7f\u7528\u6587\u672c\u76f8\u4f3c\u5ea6\u515c\u5e95\u3002"
          : "Add verifiable part, environment, temperature, load, and media requirements first. Text-similarity fallback has been disabled.")
      : (languageIsZh
          ? "\u53ef\u4fe1\u6570\u636e\u4e2d\u6ca1\u6709\u540c\u65f6\u6ee1\u8db3\u5df2\u8bc6\u522b\u786c\u6761\u4ef6\u7684\u8bb0\u5f55\u3002\u8bf7\u653e\u5bbd\u6761\u4ef6\u6216\u8865\u5145\u5b98\u65b9\u4f9b\u5e94\u5546\u6570\u636e\u3002"
          : "No trustworthy record satisfies every detected hard constraint. Relax the requirement or add official supplier data.");
    const hardItems = [
      hard.minimumTemperatureC !== null && hard.minimumTemperatureC !== undefined
        ? (languageIsZh ? `\u8fde\u7eed\u4f7f\u7528\u6e29\u5ea6 \u2265 ${hard.minimumTemperatureC}\u00b0C` : `Continuous use temperature \u2265 ${hard.minimumTemperatureC}\u00b0C`)
        : null,
      hard.minimumTensileMpa !== null && hard.minimumTensileMpa !== undefined
        ? (languageIsZh ? `\u62c9\u4f38\u5f3a\u5ea6 \u2265 ${hard.minimumTensileMpa} MPa` : `Tensile strength \u2265 ${hard.minimumTensileMpa} MPa`)
        : null
    ].filter(Boolean);
    const unsupportedItems = unsupported.map((entry) => languageIsZh ? entry.zh : entry.label);
    const hasBomRequest = unsupported.some((entry) => entry.code === "bom");

    elements.recommendationResults.innerHTML = `
      <section class="recommendation-empty recommendation-blocked">
        <div>
          <p class="result-label">${languageIsZh ? "\u5b89\u5168\u62e6\u622a" : "Safety stop"}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(body)}</p>
          ${detected.length ? `<p><strong>${t("matchedRequirements")}:</strong> ${escapeHtml(detected.map(localizeTerm).join(languageIsZh ? "\u3001" : ", "))}</p>` : ""}
          ${hardItems.length ? `<p><strong>${languageIsZh ? "\u786c\u6027\u6761\u4ef6" : "Hard constraints"}:</strong> ${escapeHtml(hardItems.join(languageIsZh ? "\u3001" : ", "))}</p>` : ""}
          ${unsupportedItems.length ? `<p><strong>${languageIsZh ? "\u4ecd\u9700\u5916\u90e8\u9a8c\u8bc1" : "External verification still required"}:</strong> ${escapeHtml(unsupportedItems.join(languageIsZh ? "\u3001" : ", "))}</p>` : ""}
        </div>
        ${hasBomRequest ? renderBomClarificationGuide(languageIsZh) : ""}
      </section>
    `;
    return;
  }

  const useCases = getOnboardingUseCases();
  elements.recommendationResults.innerHTML = `
    <section class="recommendation-empty onboarding-empty">
      <div>
        <p class="result-label">${t("noRecommendations")}</p>
        <h2>${t("emptyStateTitle")}</h2>
        <p>${t("emptyStateBody")}</p>
      </div>
      <div class="empty-use-cases">
        ${useCases
          .map(
            (useCase, index) => `
              <button type="button" data-empty-example="${index}">
                <span>${String(index + 1).padStart(2, "0")}</span>
                ${escapeHtml(useCase.label)}
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;

  elements.recommendationResults.querySelectorAll("[data-empty-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const useCase = useCases[Number(button.dataset.emptyExample)];
      if (!useCase) return;
      elements.requirementInput.value = useCase.query;
      runRecommendation();
    });
  });
}

function renderRecommendationSafetyBanner(result) {
  if (!result || result.status !== "needs_verification") return "";
  const unsupported = result.parsedRequirement?.unsupportedConstraints || [];
  const languageIsZh = state.language === "zh";
  const items = unsupported.map((entry) => languageIsZh ? entry.zh : entry.label);
  return `
    <section class="recommendation-safety-banner" role="status">
      <strong>${languageIsZh ? "\u4ec5\u4e3a\u65e9\u671f\u7b5b\u9009\uff0c\u4e0d\u5f97\u7528\u4e8e\u91c7\u8d2d\u6216\u5de5\u7a0b\u653e\u884c" : "Early screening only — not valid for procurement or engineering release"}</strong>
      <p>${languageIsZh ? "\u4ee5\u4e0b\u6761\u4ef6\u672a\u88ab\u672c\u5730\u6570\u636e\u8bc1\u660e" : "The local data does not prove"}: ${escapeHtml(items.join(languageIsZh ? "\u3001" : ", "))}</p>
    </section>
  `;
}

function renderRecommendationCard(candidate, index) {
  const item = candidate.material;
  const quality = dataQualityMeta(item);
  return `
    <article class="recommendation-card">
      <span class="rank">${index + 1}</span>
      <div>
        <div class="recommendation-card-labels">
          <span class="category">${materialCategory(item)}</span>
          <span class="quality-badge is-${quality.tone}">${escapeHtml(quality.label)}</span>
        </div>
        <h3>${materialName(item)} (${item.abbr})</h3>
        <p class="summary">${materialSummary(item)}</p>
        <div class="recommendation-reasons">
          ${candidate.reasons.map((reason) => `<span class="reason">${localizeRecommendationReason(reason)}</span>`).join("")}
          ${(candidate.warnings || []).map((warning) => `<span class="reason${warning === "no major unmatched requirement warnings" ? "" : " warning"}">${localizeRecommendationReason(warning)}</span>`).join("")}
        </div>
      </div>
      <div class="score-box">
        <div class="score-label"><span>${t("matchScore")}</span><strong>${candidate.score}</strong></div>
        <div class="score-track"><div class="score-fill" style="width: ${candidate.score}%"></div></div>
        <button type="button" data-detail-id="${item.id}">${t("detailsAi")}</button>
        <button class="compare-button" type="button" data-compare-id="${item.id}" aria-pressed="${state.selected.has(item.id)}">
          ${state.selected.has(item.id) ? t("added") : t("compare")}
        </button>
      </div>
    </article>
  `;
}

function exportMaterialSelectionReport(event) {
  if (!state.recommendations.length) return;
  const button = event?.currentTarget;
  if (button) {
    button.disabled = true;
    button.textContent = t("generating");
  }

  window.setTimeout(() => {
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      if (button) {
        button.disabled = false;
        button.textContent = t("exportReport");
      }
      return;
    }

    const reportHtml = buildMaterialSelectionReportHtml();
    reportWindow.document.open();
    reportWindow.document.write(reportHtml);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => {
      reportWindow.print();
      if (button) {
        button.disabled = false;
        button.textContent = t("exportReport");
      }
    }, 250);
  }, 0);
}

function buildMaterialSelectionReportHtml() {
  const reportDate = new Date().toLocaleDateString(state.language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const detectedRequirements = state.recommendationCriteria.length
    ? state.recommendationCriteria.map(localizeTerm).join(state.language === "zh" ? "、" : ", ")
    : t("localDatasetMatch");

  return `<!doctype html>
    <html lang="${state.language === "zh" ? "zh-CN" : "en"}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t("reportTitle"))} - MatFinder AI</title>
        <style>
          @page { margin: 18mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #1f2933; font-family: Inter, "Segoe UI", Arial, "Microsoft YaHei", sans-serif; font-size: 12px; line-height: 1.45; }
          h1, h2, h3, p { margin-top: 0; }
          h1 { margin-bottom: 6px; font-size: 26px; }
          h2 { margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #d8dee4; font-size: 15px; color: #115e59; }
          h3 { margin-bottom: 4px; font-size: 13px; }
          .cover { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 14px; border-bottom: 2px solid #115e59; }
          .meta { min-width: 180px; padding: 10px; border: 1px solid #d8dee4; background: #f6f8f9; }
          .meta div { margin-bottom: 5px; }
          .requirement { padding: 12px; border: 1px solid #d8dee4; background: #f8fbfb; }
          .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
          .chip { padding: 4px 7px; border-radius: 999px; background: #e8f3f1; color: #115e59; font-weight: 700; }
          .material { break-inside: avoid; margin: 12px 0; padding: 12px; border: 1px solid #d8dee4; border-radius: 6px; }
          .material-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
          .score { min-width: 72px; padding: 8px; background: #e8f3f1; color: #115e59; text-align: center; font-weight: 800; }
          .score strong { display: block; font-size: 22px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          ul { margin: 0; padding-left: 18px; }
          li { margin-bottom: 4px; }
          .muted { color: #64707d; }
          .alternatives { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d8dee4; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <header class="cover">
          <div>
            <h1>${escapeHtml(t("reportTitle"))}</h1>
            <p class="muted">MatFinder AI</p>
          </div>
          <div class="meta">
            <div><strong>${escapeHtml(t("reportProject"))}:</strong> MatFinder AI</div>
            <div><strong>${escapeHtml(t("reportDate"))}:</strong> ${escapeHtml(reportDate)}</div>
          </div>
        </header>

        <section>
          <h2>${escapeHtml(t("reportRequirementText"))}</h2>
          <div class="requirement">
            <p>${escapeHtml(state.recommendationQuery || elements.requirementInput.value || t("notSpecified"))}</p>
            <strong>${escapeHtml(t("reportDetectedRequirements"))}</strong>
            <div class="chips">${detectedRequirements
              .split(state.language === "zh" ? "、" : ", ")
              .filter(Boolean)
              .map((requirement) => `<span class="chip">${escapeHtml(requirement)}</span>`)
              .join("")}</div>
          </div>
        </section>

        <section>
          <h2>${escapeHtml(t("reportTopMaterials"))}</h2>
          ${state.recommendations.slice(0, 5).map((candidate, index) => renderReportMaterial(candidate, index)).join("")}
        </section>
      </body>
    </html>`;
}

function renderReportMaterial(candidate, index) {
  const item = candidate.material;
  const reasons = candidate.reasons?.length ? candidate.reasons.map(localizeRecommendationReason) : [t("notSpecified")];
  const warnings = meaningfulWarnings(candidate)
    .filter((warning) => warning !== "no major unmatched requirement warnings")
    .map(localizeRecommendationReason);
  const limitations = [...new Set([...(warnings.length ? warnings : [t("reportNoWarnings")]), ...materialDisadvantageList(item).slice(0, 3)])];
  const alternatives = rankSimilarMaterials(item, 3);

  return `
    <article class="material">
      <div class="material-head">
        <div>
          <h3>#${index + 1} ${escapeHtml(materialName(item))} (${escapeHtml(item.abbr)})</h3>
          <p class="muted">${escapeHtml(materialCategory(item))} · ${escapeHtml(materialSummary(item))}</p>
        </div>
        <div class="score">${escapeHtml(t("matchScore"))}<strong>${escapeHtml(candidate.score)}</strong></div>
      </div>
      <div class="grid">
        <div>
          <h3>${escapeHtml(t("scoringReasons"))}</h3>
          <ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
        </div>
        <div>
          <h3>${escapeHtml(t("reportWarnings"))}</h3>
          <ul>${limitations.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="alternatives">
        <h3>${escapeHtml(t("reportAlternatives"))}</h3>
        <ul>${
          alternatives.length
            ? alternatives
                .map((entry) => `<li>${escapeHtml(materialName(entry.material))} (${escapeHtml(entry.material.abbr)}) · ${escapeHtml(t("similarityScore"))} ${escapeHtml(entry.score)}</li>`)
                .join("")
            : `<li>${escapeHtml(t("noAlternativeMaterials"))}</li>`
        }</ul>
      </div>
    </article>
  `;
}

function renderChips() {
  const chips = [];
  if (state.query) chips.push(`${t("keyword")}: ${state.query}`);
  if (state.category !== "all") chips.push(`${t("category")}: ${localizeTerm(state.category)}`);
  if (state.property !== "all") chips.push(`${t("focus")}: ${performanceLabel(state.property)}`);
  if (state.domain !== "all") chips.push(`${t("applicationDomain")}: ${domainLabel(state.domain)}`);
  if (state.minTemp > DEFAULT_MIN_TEMP) chips.push(`${t("temp")} >= ${state.minTemp} deg C`);
  if (state.minStrength > DEFAULT_MIN_STRENGTH) chips.push(`${t("strength")} >= ${state.minStrength} MPa`);
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
          <div class="metric"><span>${t("continuousUse")}</span><strong>${formatQualityCheckedValue(item, "maxTemp", item.maxTemp, " deg C")}</strong></div>
          <div class="metric"><span>${t("tensileStrength")}</span><strong>${formatQualityCheckedValue(item, "tensile", item.tensile, " MPa")}</strong></div>
          <div class="metric"><span>${t("density")}</span><strong>${formatQualityCheckedValue(item, "density", item.density, " g/cm3")}</strong></div>
          <div class="metric"><span>Tg / Tm</span><strong>${formatValue(item.tg, " deg C")} / ${formatQualityCheckedValue(item, "tm", item.tm, " deg C")}</strong></div>
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
  state.materialsGridRendered = true;
}

function resetMaterialsPage() {
  state.materialsPage = 1;
}

function renderMaterialsPagination(totalItems, totalPages) {
  if (!elements.materialsPagination) return;
  if (!totalItems || totalPages <= 1) {
    elements.materialsPagination.replaceChildren();
    return;
  }

  const label = document.createElement("span");
  const pageStart = (state.materialsPage - 1) * state.materialsPageSize + 1;
  const pageEnd = Math.min(totalItems, state.materialsPage * state.materialsPageSize);
  label.textContent = `${pageStart}-${pageEnd} / ${totalItems}`;

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  previous.disabled = state.materialsPage <= 1;
  previous.addEventListener("click", () => {
    state.materialsPage = Math.max(1, state.materialsPage - 1);
    render();
  });

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.disabled = state.materialsPage >= totalPages;
  next.addEventListener("click", () => {
    state.materialsPage = Math.min(totalPages, state.materialsPage + 1);
    render();
  });

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Material page");
  for (let page = 1; page <= totalPages; page += 1) {
    const option = document.createElement("option");
    option.value = String(page);
    option.textContent = `${page} / ${totalPages}`;
    option.selected = page === state.materialsPage;
    select.append(option);
  }
  select.addEventListener("change", (event) => {
    state.materialsPage = Number(event.target.value);
    render();
  });

  elements.materialsPagination.replaceChildren(label, previous, select, next);
}

function toggleCompare(id) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    if (state.selected.size >= 3) {
      const first = state.selected.values().next().value;
      state.selected.delete(first);
    }
    state.selected.add(id);
  }
  render();
}

function renderCompareSelection(selectedItems) {
  if (!elements.compareSelection) return;

  if (!selectedItems.length) {
    elements.compareSelection.innerHTML = `
      <div class="compare-empty-card">
        <p class="result-label">${t("selectedMaterials")}</p>
        <h3>${t("compareEmptyTitle")}</h3>
        <p>${t("compareEmptyBody")}</p>
      </div>
    `;
    return;
  }

  elements.compareSelection.innerHTML = `
    <div class="compare-selection-header">
      <p class="result-label">${t("selectedMaterials")}</p>
      <strong>${selectedItems.length} / 3</strong>
    </div>
    <div class="compare-selected-grid">
      ${selectedItems
        .map(
          (item) => `
            <article class="compare-selected-card">
              <span class="abbr">${escapeHtml(item.abbr)}</span>
              <div>
                <span class="category">${escapeHtml(materialCategory(item))}</span>
                <h3>${escapeHtml(materialName(item))}</h3>
                <p>${escapeHtml(materialSummary(item))}</p>
              </div>
              <div class="compare-selected-actions">
                <button type="button" data-detail-id="${escapeAttribute(item.id)}">${t("detailsAi")}</button>
                <button type="button" data-remove-compare="${escapeAttribute(item.id)}">${t("remove")}</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;

  elements.compareSelection.querySelectorAll("[data-detail-id]").forEach((button) => {
    button.addEventListener("click", () => showDetail(button.dataset.detailId));
  });
  elements.compareSelection.querySelectorAll("[data-remove-compare]").forEach((button) => {
    button.addEventListener("click", () => toggleCompare(button.dataset.removeCompare));
  });
}

function renderCompare() {
  const selectedItems = materials.filter((item) => state.selected.has(item.id));
  renderCompareSelection(selectedItems);
  elements.comparePanel.hidden = false;

  if (!selectedItems.length) {
    elements.compareTableWrap.innerHTML = `
      <div class="compare-empty-card">
        <h3>${t("compareEmptyTitle")}</h3>
        <p>${t("compareGuidance")}</p>
      </div>
    `;
    return;
  }

  const cacheKey = `${state.language}:${selectedItems.map((item) => item.id).join("|")}`;
  if (state.compareTableCache.has(cacheKey)) {
    elements.compareTableWrap.innerHTML = state.compareTableCache.get(cacheKey);
    return;
  }

  const rows = [
    [t("category"), (item) => materialCategory(item)],
    [t("density"), (item) => formatValue(item.density, " g/cm3")],
    [t("glassTransition"), (item) => formatValue(item.tg, " deg C")],
    [t("meltingPoint"), (item) => formatValue(item.tm, " deg C")],
    [t("continuousUse"), (item) => formatValue(item.maxTemp, " deg C")],
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
  state.compareTableCache.set(cacheKey, table.outerHTML);
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

  renderRecommendationDetail(item);
  return;

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

async function showDetail(id) {
  const item = materials.find((material) => material.id === id);
  if (!item) return;

  elements.detailContent.innerHTML = `
    <div class="profile-hero">
      <div>
        <p class="result-label">${state.language === "zh" ? "正在加载完整证据" : "Loading complete evidence"}</p>
        <h2>${escapeHtml(materialName(item))} (${escapeHtml(item.abbr)})</h2>
        <p class="summary">${state.language === "zh" ? "正在读取来源、测试条件与质量问题……" : "Retrieving sources, test conditions, and quality issues\u2026"}</p>
      </div>
    </div>
  `;
  if (!elements.detailDialog.open) {
    elements.detailDialog.showModal();
  }

  try {
    await loadMaterialDetail(item);
  } catch (error) {
    elements.detailContent.innerHTML = `
      <section class="profile-section data-quality-section is-rejected">
        <h2>${state.language === "zh" ? "完整材料记录加载失败" : "Failed to load the complete material record"}</h2>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `;
    return;
  }

  selectMaterialForAnalysis(item);

  renderRecommendationDetail(item);
  return;

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
        <div class="metric"><span>${t("flexuralStrength")}</span><strong>${formatValue(item.flexural_strength, " MPa")}</strong></div>
        <div class="metric"><span>${t("impactStrength")}</span><strong>${formatValue(item.impact_strength)}</strong></div>
        <div class="metric"><span>${t("hardness")}</span><strong>${formatValue(item.hardness)}</strong></div>
        <div class="metric"><span>${t("elongation")}</span><strong>${formatValue(item.elongation, "%")}</strong></div>
        <div class="metric"><span>${t("thermalConductivity")}</span><strong>${formatValue(item.thermal_conductivity, " W/mK")}</strong></div>
        <div class="metric"><span>${t("dielectricConstant")}</span><strong>${formatValue(item.dielectric)}</strong></div>
        <div class="metric"><span>${t("chemicalResistance")}</span><strong>${formatValue(item.chemical_resistance)}</strong></div>
        <div class="metric"><span>${t("waterAbsorption")}</span><strong>${formatValue(item.water_absorption, "%")}</strong></div>
        <div class="metric"><span>${t("flammability")}</span><strong>${formatValue(item.flammability)}</strong></div>
        <div class="metric"><span>${t("recyclable")}</span><strong>${formatValue(item.recyclability || (item.recyclable ? t("yes") : t("specialtyStream")))}</strong></div>
        <div class="metric"><span>${t("costLevel")}</span><strong>${formatValue(item.cost_level)}</strong></div>
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
        <h3>${t("processingMethods")}</h3>
        ${renderProfileList(item.processing_methods?.length ? item.processing_methods : [t("notSpecified")])}
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
  if (state.route === "copilot") {
    updateCopilotContext();
  }

  if (item.data_quality?.recommendation_eligible === false) {
    renderAnalysisQualityBlocked(item);
    return;
  }

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

function renderAnalysisQualityBlocked(item) {
  const languageIsZh = state.language === "zh";
  const issues = Array.isArray(item.data_quality?.issues) ? item.data_quality.issues : [];
  elements.analysisStatus.textContent = languageIsZh ? "数据已阻断" : "Data blocked";
  elements.analysisContent.innerHTML = `
    <div class="analysis-block analysis-quality-blocked">
      <h3>${languageIsZh ? "不会把不可信记录发送给 AI 继续解释" : "Untrusted record is not sent to AI for further interpretation"}</h3>
      <p>${
        languageIsZh
          ? "先修复来源或异常数值，再进行材料分析；否则 AI 只会把错误包装得更流畅。"
          : "Correct the source or implausible values before analysis; otherwise AI would only make the error sound more convincing."
      }</p>
      ${renderProfileList(
        issues.length
          ? issues.map((entry) => languageIsZh ? entry.zh : entry.en)
          : [languageIsZh ? "该记录没有足够的可验证来源。" : "This record lacks sufficient verifiable evidence."]
      )}
    </div>
  `;
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
