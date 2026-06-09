const source = {
  source_title: "MatFinder commercial-style engineering material expansion",
  source_url: "local:scripts/commercial-grade-expansion.js",
  source_type: "generated_commercial_catalog",
  notes:
    "Deterministic commercial-style screening entries based on representative material-family ranges, common supplier/brand families, and grade modifiers. Verify actual supplier datasheets before engineering use."
};

const zh = {
  automotive: "\u6c7d\u8f66\u90e8\u4ef6",
  aerospace: "\u822a\u7a7a\u822a\u5929",
  electronics: "\u7535\u5b50\u7535\u6c14",
  medical: "\u533b\u7597\u5668\u68b0",
  chemical: "\u5316\u5de5\u8bbe\u5907",
  packaging: "\u5305\u88c5",
  structural: "\u7ed3\u6784\u4ef6",
  sealing: "\u5bc6\u5c01",
  coating: "\u6d82\u5c42",
  fiber: "\u7ea4\u7ef4",
  reinforcement: "\u589e\u5f3a",
  insulation: "\u7edd\u7f18",
  waterproof: "\u9632\u6c34",
  heat: "\u8010\u70ed",
  flame: "\u963b\u71c3",
  transparent: "\u900f\u660e",
  flexible: "\u67d4\u6027",
  highStrength: "\u9ad8\u5f3a\u5ea6",
  corrosion: "\u8010\u8150\u8680",
  wear: "\u8010\u78e8",
  lightweight: "\u8f7b\u91cf",
  adhesive: "\u7c98\u63a5",
  tooling: "\u5de5\u88c5",
  marine: "\u6d77\u5de5"
};

const brandPools = {
  commodityPlastics: [
    b("Dow", "DOWLEX/ELITE", "DW"),
    b("LyondellBasell", "Hostalen/Moplen", "LB"),
    b("SABIC", "PE/PP portfolio", "SP"),
    b("Braskem", "I'm green/Maxio", "BK")
  ],
  engineeringPlastics: [
    b("SABIC", "LEXAN/VALOX/NORYL", "LX"),
    b("BASF", "Ultramid/Ultradur", "UF"),
    b("Celanese", "Celanex/Hostaform/Vectra", "CX"),
    b("DuPont", "Zytel/Delrin/Hytrel", "DP")
  ],
  highPerformancePlastics: [
    b("Solvay", "KetaSpire/AvaSpire/Radel", "SV"),
    b("Victrex", "VICTREX PEEK", "VX"),
    b("SABIC", "ULTEM/EXTEM", "UT"),
    b("Arkema", "Kynar/Rilsan/Pebax", "AK")
  ],
  elastomers: [
    b("Dow", "SILASTIC/NORDEL", "DW"),
    b("DuPont", "Viton/Kalrez", "VT"),
    b("Kuraray", "SEPTON/KURARITY", "KR"),
    b("Teknor Apex", "Sarlink/Monprene", "TA")
  ],
  thermosets: [
    b("Huntsman", "Araldite", "AR"),
    b("Hexcel", "HexPly", "HX"),
    b("Hexion", "EPIKOTE/BAKELITE", "HE"),
    b("Olin", "D.E.R./D.E.N.", "OL")
  ],
  composites: [
    b("Hexcel", "HexPly/HexTow", "HX"),
    b("Toray", "Torayca", "TR"),
    b("Solvay", "CYCOM/APC", "SV"),
    b("SGL Carbon", "SIGRAPREG", "SG")
  ],
  foams: [
    b("Evonik", "ROHACELL", "RH"),
    b("Diab", "Divinycell", "DV"),
    b("3M", "Scotchlite/K15", "TM"),
    b("Armacell", "ArmaFlex", "AF")
  ],
  ceramics: [
    b("CoorsTek", "AD/TTZ/Silicon Carbide", "CT"),
    b("Kyocera", "Fineceramics", "KY"),
    b("CeramTec", "Alunit/Alotec", "CE"),
    b("Morgan Advanced Materials", "Haldenwanger", "MG")
  ],
  metals: [
    b("Ryerson", "commercial metals", "RY"),
    b("thyssenkrupp Materials", "materials portfolio", "TK"),
    b("Kloeckner Metals", "metals distribution", "KM"),
    b("ASTM/UNS", "standard alloy designation", "UN")
  ],
  coatings: [
    b("PPG", "PPG coatings", "PP"),
    b("AkzoNobel", "Interpon/International", "AK"),
    b("Sherwin-Williams", "Powdura/Macropoxy", "SW"),
    b("Axalta", "Alesta/Imron", "AX")
  ],
  adhesives: [
    b("3M", "Scotch-Weld", "TM"),
    b("Henkel", "LOCTITE/TEROSON", "HK"),
    b("Sika", "Sikaflex/SikaPower", "SK"),
    b("H.B. Fuller", "Swift/Fuller", "HF")
  ],
  sealants: [
    b("Dow", "DOWSIL", "DS"),
    b("Sika", "Sikaflex", "SK"),
    b("Henkel", "TEROSON", "HK"),
    b("Bostik", "Simson/ISR", "BK")
  ],
  fibers: [
    b("Toray", "TORAYCA", "TR"),
    b("DuPont", "Kevlar/Nomex", "KV"),
    b("Owens Corning", "Advantex", "OC"),
    b("Teijin", "Twaron/Tenax", "TJ")
  ]
};

const profiles = {
  commodityPlastic: p("solid", 1.02, 28, 220, -20, 155, 95, 2.4, 0.22, "good", 0.3, "low"),
  engineeringPlastic: p("solid", 1.25, 70, 80, 100, 240, 135, 3.2, 0.26, "good", 0.45, "medium"),
  highPerformancePlastic: p("solid", 1.38, 105, 35, 185, 335, 230, 3.5, 0.31, "excellent", 0.25, "high"),
  elastomer: p("flexible solid", 1.12, 16, 450, -45, null, 130, 5.0, 0.2, "grade dependent", 0.7, "medium"),
  thermoset: p("solid after cure", 1.25, 65, 6, 145, null, 160, 4.2, 0.24, "good", 0.5, "medium"),
  composite: p("solid laminate", 1.55, 480, 2, 130, null, 160, 4.5, 0.55, "matrix dependent", 0.25, "high"),
  foam: p("cellular solid", 0.08, 1.4, 20, null, null, 95, 2.3, 0.04, "grade dependent", 1.0, "medium"),
  ceramic: p("solid", 3.6, 260, 1, null, 1700, 1000, 8.0, 14, "excellent", 0.02, "high"),
  metal: p("solid", 7.8, 520, 18, null, 1450, 450, null, 35, "environment dependent", 0, "medium"),
  coating: p("solid film after cure", 1.35, 24, 35, 70, null, 150, 4.0, 0.3, "good", 0.2, "medium"),
  adhesive: p("liquid or paste before cure, solid after cure", 1.18, 28, 8, 80, null, 120, 4.2, 0.25, "grade dependent", 0.4, "medium"),
  sealant: p("liquid or paste before cure, flexible solid after cure", 1.22, 4, 350, -45, null, 120, 4.5, 0.22, "grade dependent", 0.35, "medium"),
  fiber: p("solid fiber", 1.44, 1800, 3, null, null, 180, 4.0, 1.2, "grade dependent", 0.1, "medium")
};

const variants = [
  v("standard processing grade", "STD", 1, 1, 1, 0, ["general purpose", "\u901a\u7528"], []),
  v("high strength reinforced grade", "HS", 1.28, 0.55, 1.08, 10, ["high strength", zh.highStrength, "reinforced", zh.reinforcement], [zh.structural]),
  v("flame retardant electrical grade", "FR", 0.95, 0.8, 1.02, 5, ["flame retardant", zh.flame, "electrical insulation", zh.insulation], [zh.electronics]),
  v("chemical resistant process grade", "CR", 0.9, 0.9, 1.04, 8, ["chemical resistant", zh.chemical, "corrosion resistant", zh.corrosion], [zh.chemical]),
  v("outdoor UV weatherable grade", "UV", 0.92, 1.05, 1.01, 3, ["weather resistant", "UV stabilized", "\u8010\u5019"], [zh.automotive]),
  v("medical contact screening grade", "MED", 0.88, 1.1, 1.0, 0, ["medical", zh.medical, "clean processing"], [zh.medical])
];

const categoryApplications = {
  Plastics: ["molded housings", zh.electronics, "connectors", zh.automotive, "fluid parts", zh.packaging],
  Elastomers: ["gaskets", zh.sealing, "boots", "vibration isolation", zh.automotive, "hoses"],
  Thermosets: ["encapsulation", "electrical laminates", zh.insulation, "composite matrix", zh.adhesive],
  Composites: ["sandwich panels", zh.aerospace, zh.structural, "radomes", zh.marine, zh.tooling],
  Foams: ["thermal insulation", zh.lightweight, "cushioning", "sandwich cores", zh.packaging],
  Ceramics: ["wear parts", zh.insulation, "furnace fixtures", "pump seals", zh.heat],
  Metals: ["machined parts", zh.structural, "fasteners", "heat exchangers", zh.automotive],
  Coatings: ["corrosion protection", zh.coating, "appliance finishes", "industrial topcoats", zh.marine],
  Adhesives: ["structural bonding", zh.adhesive, "electronics assembly", "panel bonding", zh.automotive],
  Sealants: ["joint sealing", zh.sealing, "weatherproofing", "fuel tank seams", zh.waterproof],
  Fibers: ["textile reinforcement", zh.fiber, "composite reinforcement", zh.reinforcement, "protective fabrics"]
};

const familyRows = [
  ...rows("Plastics", "Commodity plastic", "commodityPlastic", brandPools.commodityPlastics, [
    ["Low-density polyethylene", "LDPE"], ["Linear low-density polyethylene", "LLDPE"], ["High-density polyethylene", "HDPE"], ["Medium-density polyethylene", "MDPE"], ["Polypropylene homopolymer", "PP-H"], ["Polypropylene impact copolymer", "PP-ICP"], ["Polypropylene random copolymer", "PP-R"], ["General purpose polystyrene", "GPPS"], ["High impact polystyrene", "HIPS"], ["Polyvinyl chloride rigid", "PVC-U"], ["Flexible polyvinyl chloride", "PVC-P"], ["Acrylonitrile butadiene styrene", "ABS"], ["Styrene acrylonitrile", "SAN"], ["Acrylonitrile styrene acrylate", "ASA"], ["Polyethylene terephthalate bottle grade", "PET-B"]
  ]),
  ...rows("Plastics", "Engineering plastic", "engineeringPlastic", brandPools.engineeringPlastics, [
    ["Polycarbonate", "PC"], ["Polybutylene terephthalate", "PBT"], ["Polyethylene terephthalate engineering grade", "PET-E"], ["Polyamide 6", "PA6"], ["Polyamide 66", "PA66"], ["Polyamide 12", "PA12"], ["Polyamide 46", "PA46"], ["Polyamide 6T", "PA6T"], ["Polyoxymethylene copolymer", "POM-C"], ["Polyoxymethylene homopolymer", "POM-H"], ["Modified polyphenylene ether", "mPPE"], ["Polyphenylene oxide blend", "PPO"], ["Thermoplastic polyurethane", "TPU"], ["Thermoplastic polyester elastomer", "TPEE"], ["Polycarbonate ABS blend", "PC-ABS"], ["Polycarbonate PBT blend", "PC-PBT"], ["PETG copolyester", "PETG"], ["PCTG copolyester", "PCTG"], ["Cyclo olefin copolymer", "COC"], ["Cyclo olefin polymer", "COP"]
  ]),
  ...rows("Plastics", "High-performance plastic", "highPerformancePlastic", brandPools.highPerformancePlastics, [
    ["Polyether ether ketone", "PEEK"], ["Polyether ketone ketone", "PEKK"], ["Polyphenylene sulfide", "PPS"], ["Polyetherimide", "PEI"], ["Polyphenylsulfone", "PPSU"], ["Polyethersulfone", "PESU"], ["Polysulfone", "PSU"], ["Liquid crystal polymer", "LCP"], ["Polyamide-imide", "PAI"], ["Polyimide thermoplastic", "TPI"], ["Polybenzimidazole", "PBI"], ["Polytetrafluoroethylene", "PTFE"], ["Perfluoroalkoxy alkane", "PFA"], ["Fluorinated ethylene propylene", "FEP"], ["Polyvinylidene fluoride", "PVDF"], ["Ethylene tetrafluoroethylene", "ETFE"], ["Polyphenylene sulfide sulfone", "PPSS"], ["Polyaryletherketone", "PAEK"]
  ]),
  ...rows("Elastomers", "Rubber and TPE", "elastomer", brandPools.elastomers, [
    ["Natural rubber", "NR"], ["Styrene butadiene rubber", "SBR"], ["Nitrile butadiene rubber", "NBR"], ["Hydrogenated nitrile rubber", "HNBR"], ["Ethylene propylene diene rubber", "EPDM"], ["Chloroprene rubber", "CR"], ["Butyl rubber", "IIR"], ["Silicone rubber", "VMQ"], ["Liquid silicone rubber", "LSR"], ["Fluoroelastomer", "FKM"], ["Perfluoroelastomer", "FFKM"], ["Fluorosilicone rubber", "FVMQ"], ["Thermoplastic vulcanizate", "TPV"], ["Styrene block copolymer", "SBC"], ["SEBS elastomer", "SEBS"], ["Thermoplastic polyolefin", "TPO"], ["Acrylic rubber", "ACM"], ["Epichlorohydrin rubber", "ECO"], ["Polyurethane elastomer", "PUR-E"], ["Polyether block amide", "PEBA"], ["Thermoplastic copolyester elastomer", "COPE"], ["Ethylene acrylic elastomer", "AEM"], ["Millable polyurethane rubber", "MPU"], ["Chlorosulfonated polyethylene", "CSM"]
  ]),
  ...rows("Thermosets", "Thermoset resin", "thermoset", brandPools.thermosets, [
    ["Bisphenol A epoxy resin", "DGEBA"], ["Novolac epoxy resin", "EPN"], ["Cycloaliphatic epoxy resin", "CAE"], ["Phenolic molding compound", "PF"], ["Melamine formaldehyde", "MF"], ["Urea formaldehyde", "UF"], ["Unsaturated polyester resin", "UPR"], ["Vinyl ester resin", "VE"], ["Bismaleimide resin", "BMI"], ["Cyanate ester resin", "CE"], ["Benzoxazine resin", "BZ"], ["Diallyl phthalate resin", "DAP"], ["Thermoset polyurethane", "PUR-TS"], ["Silicone encapsulant", "SI-ENC"], ["Epoxy molding compound", "EMC"], ["Polyester bulk molding compound", "BMC"], ["Sheet molding compound", "SMC"], ["Furan resin", "FUR"]
  ]),
  ...rows("Composites", "Fiber reinforced composite", "composite", brandPools.composites, [
    ["Carbon fiber epoxy laminate", "CF-EP"], ["Glass fiber epoxy laminate", "GF-EP"], ["Carbon fiber BMI composite", "CF-BMI"], ["Carbon fiber PEEK composite", "CF-PEEK"], ["Glass mat thermoplastic composite", "GMT"], ["Long glass fiber polypropylene", "LGF-PP"], ["Short carbon fiber nylon", "SCF-PA"], ["Basalt fiber epoxy composite", "BF-EP"], ["Aramid fiber phenolic composite", "AF-PF"], ["Quartz fiber cyanate ester composite", "QF-CE"], ["Carbon carbon composite", "C-C"], ["Silicon carbide ceramic matrix composite", "SiC-SiC"], ["Glass fiber polyester laminate", "GF-UPR"], ["Natural fiber polypropylene composite", "NF-PP"], ["Carbon fiber PPS composite", "CF-PPS"], ["Glass fiber PPS composite", "GF-PPS"], ["Hybrid carbon glass laminate", "CG-HYB"], ["Flax fiber bio-epoxy composite", "FLAX-EP"]
  ]),
  ...rows("Foams", "Engineering foam", "foam", brandPools.foams, [
    ["Rigid polyurethane foam", "PUR-F"], ["Flexible polyurethane foam", "FPUF"], ["Expanded polystyrene foam", "EPS"], ["Extruded polystyrene foam", "XPS"], ["Expanded polypropylene foam", "EPP"], ["Expanded polyethylene foam", "EPE"], ["PVC structural foam", "PVC-F"], ["PET structural foam", "PET-F"], ["PMI structural foam", "PMI-F"], ["Phenolic foam", "PF-F"], ["Silicone foam", "SI-F"], ["Melamine foam", "MF-F"], ["Aluminum foam", "AL-F"], ["Syntactic epoxy foam", "SYN-F"], ["Aerogel blanket foam", "AER-F"]
  ]),
  ...rows("Ceramics", "Technical ceramic", "ceramic", brandPools.ceramics, [
    ["Alumina 96 ceramic", "Al2O3-96"], ["Alumina 99.5 ceramic", "Al2O3-995"], ["Zirconia Y-TZP", "YTZP"], ["Partially stabilized zirconia", "PSZ"], ["Silicon carbide sintered", "SSiC"], ["Reaction bonded silicon carbide", "RBSiC"], ["Silicon nitride", "Si3N4"], ["Aluminum nitride", "AlN"], ["Boron nitride", "BN"], ["Boron carbide", "B4C"], ["Titanium diboride", "TiB2"], ["Mullite ceramic", "MUL"], ["Cordierite ceramic", "CORD"], ["Steatite ceramic", "STE"], ["Macor machinable glass ceramic", "MAC"], ["Fused silica", "FS"], ["Soda lime glass", "SLG"], ["Borosilicate glass", "BSG"], ["Hydroxyapatite bioceramic", "HA"], ["Sialon ceramic", "SiAlON"]
  ]),
  ...rows("Metals", "Ferrous and nonferrous alloy", "metal", brandPools.metals, [
    ["Low carbon steel AISI 1018", "1018"], ["Medium carbon steel AISI 1045", "1045"], ["Alloy steel AISI 4140", "4140"], ["Alloy steel AISI 4340", "4340"], ["Tool steel A2", "A2"], ["Tool steel D2", "D2"], ["Tool steel H13", "H13"], ["Stainless steel 304", "SS304"], ["Stainless steel 316L", "SS316L"], ["Stainless steel 17-4PH", "17-4PH"], ["Duplex stainless steel 2205", "DSS2205"], ["Super duplex stainless steel 2507", "SDSS2507"], ["Aluminum alloy 6061", "AA6061"], ["Aluminum alloy 7075", "AA7075"], ["Aluminum alloy 2024", "AA2024"], ["Aluminum alloy 5052", "AA5052"], ["Aluminum alloy 5083", "AA5083"], ["Aluminum alloy 6082", "AA6082"], ["Titanium grade 2", "Ti-G2"], ["Titanium alloy Ti-6Al-4V", "Ti64"], ["Copper C110", "C110"], ["Brass C360", "C360"], ["Bronze C932", "C932"], ["Beryllium copper C172", "C172"], ["Magnesium AZ31B", "AZ31B"], ["Magnesium AZ91D", "AZ91D"], ["Nickel alloy 625", "IN625"], ["Nickel alloy 718", "IN718"], ["Hastelloy C276", "C276"], ["Monel 400", "M400"], ["Incoloy 800H", "800H"], ["Cobalt chrome alloy", "CoCr"], ["Tungsten heavy alloy", "WHA"], ["Molybdenum TZM", "TZM"], ["Tantalum R05200", "Ta"], ["Zinc alloy Zamak 3", "Zamak3"], ["Cast iron gray", "GI"], ["Ductile iron 65-45-12", "DI"], ["Maraging steel 300", "MS300"], ["Invar 36", "INVAR36"], ["Kovar alloy", "KOV"], ["Electrical steel", "ES"], ["Lead free solder SAC305", "SAC305"], ["Silver alloy contact material", "AgC"], ["Nitinol shape memory alloy", "NiTi"]
  ]),
  ...rows("Coatings", "Industrial coating", "coating", brandPools.coatings, [
    ["Epoxy powder coating", "EP-PC"], ["Polyester powder coating", "PE-PC"], ["Polyurethane topcoat", "PU-TC"], ["Fluoropolymer architectural coating", "PVDF-C"], ["Acrylic coating", "AC-C"], ["Alkyd enamel coating", "ALK-C"], ["Zinc rich epoxy primer", "ZRE"], ["Ceramic thermal barrier coating", "TBC"], ["PTFE nonstick coating", "PTFE-C"], ["Parylene conformal coating", "PAR-C"], ["Silicone high temperature coating", "SI-C"], ["Polyurea coating", "PUA-C"], ["Epoxy phenolic lining", "EP-PH"], ["Waterborne polyurethane coating", "WB-PU"], ["UV cured acrylate coating", "UV-A"], ["Intumescent fireproofing coating", "INT-C"], ["Anodized aluminum coating", "ANOD"], ["Electroless nickel coating", "EN"]
  ]),
  ...rows("Adhesives", "Engineering adhesive", "adhesive", brandPools.adhesives, [
    ["Two part epoxy adhesive", "2K-EP"], ["Toughened epoxy adhesive", "TGH-EP"], ["Acrylic structural adhesive", "ACR-SA"], ["Methyl methacrylate adhesive", "MMA"], ["Cyanoacrylate adhesive", "CA"], ["Anaerobic threadlocker", "AN-TL"], ["Anaerobic retaining compound", "AN-RC"], ["Polyurethane adhesive", "PU-AD"], ["Silicone adhesive", "SI-AD"], ["Hot melt polyamide adhesive", "HM-PA"], ["Hot melt EVA adhesive", "HM-EVA"], ["Pressure sensitive acrylic adhesive", "PSA-AC"], ["Conductive silver epoxy", "Ag-EP"], ["Thermally conductive epoxy", "TC-EP"], ["Medical UV adhesive", "UV-MED"], ["Flexible epoxy adhesive", "FLEX-EP"], ["Phenolic adhesive", "PF-AD"], ["Rubber contact adhesive", "CR-AD"]
  ]),
  ...rows("Sealants", "Industrial sealant", "sealant", brandPools.sealants, [
    ["Neutral cure silicone sealant", "NCS"], ["Acetoxy silicone sealant", "ACS"], ["Polyurethane construction sealant", "PU-CS"], ["MS polymer sealant", "MS-S"], ["Polysulfide aerospace sealant", "PS-S"], ["Butyl rubber sealant tape", "IIR-T"], ["Acrylic latex sealant", "AL-S"], ["Firestop intumescent sealant", "FS-S"], ["Fluorosilicone fuel sealant", "FVMQ-S"], ["Epoxy seam sealer", "EP-SS"], ["Anaerobic flange sealant", "AN-FS"], ["Thermal gap filler sealant", "TGF-S"], ["Marine deck sealant", "MAR-S"], ["Battery pack silicone sealant", "BAT-S"]
  ]),
  ...rows("Fibers", "Technical fiber", "fiber", brandPools.fibers, [
    ["Carbon fiber standard modulus tow", "CF-SM"], ["Carbon fiber intermediate modulus tow", "CF-IM"], ["Carbon fiber high modulus tow", "CF-HM"], ["E-glass fiber roving", "E-GF"], ["S-glass fiber roving", "S-GF"], ["Basalt fiber roving", "BF"], ["Aramid para fiber", "P-ARAMID"], ["Aramid meta fiber", "M-ARAMID"], ["UHMWPE fiber", "UHMWPE-F"], ["PBO fiber", "PBO-F"], ["Polyester technical fiber", "PET-FIB"], ["Nylon 66 industrial fiber", "PA66-FIB"], ["Polypropylene fiber", "PP-FIB"], ["Ceramic alumina fiber", "ALFIB"], ["Silica fiber", "SiO2-FIB"], ["Stainless steel fiber", "SSF"], ["Copper conductive fiber", "CuF"], ["PTFE fiber", "PTFE-F"], ["PPS filter fiber", "PPS-F"], ["LCP fiber", "LCP-F"]
  ])
];

const generated = dedupe(familyRows.flatMap((family, index) => {
  return family.brands.flatMap((brand, brandIndex) => {
    return variants.map((variant, variantIndex) => makeEntry(family, brand, variant, index, brandIndex, variantIndex));
  });
}));

module.exports = generated;

function makeEntry(family, brand, variant, familyIndex, brandIndex, variantIndex) {
  const profile = profiles[family.profileKey];
  const code = `${brand.code}${String(100 + familyIndex).slice(-3)}${variant.code}`;
  const materialId = `comm-${slug(family.category)}-${slug(family.abbr)}-${slug(brand.supplier)}-${variant.code}-${brandIndex}`;
  const density = round((profile.density + densityAdjustment(family.category, variant.code)) * variant.densityMult, 2);
  const tensile = round(profile.tensile * variant.tensileMult * categoryStrengthFactor(family.category, variant.code), 1);
  const elongation = round(clamp(profile.elongation * variant.elongationMult, 0.5, 850), 1);
  const maxTemp = round(profile.maxTemp + variant.temperatureAdd + categoryTemperatureBonus(family.category, variant.code), 0);
  const tags = uniq([...family.tags, ...variant.tags, family.category.toLowerCase(), family.subcategory.toLowerCase()]);
  const applications = uniq([...categoryApplications[family.category], ...variant.applications]).slice(0, 8);
  const limitations = [
    "Representative commercial-style screening entry; verify supplier datasheet before design release.",
    "\u4ee3\u8868\u6027\u5546\u4e1a\u724c\u53f7\u7b5b\u9009\u6570\u636e\uff0c\u91cf\u4ea7\u8bbe\u8ba1\u524d\u9700\u6838\u5bf9\u4f9b\u5e94\u5546\u6570\u636e\u8868\u3002",
    limitationFor(family.category)
  ];

  return {
    id: materialId,
    material_id: materialId,
    name: `${brand.brand} ${code} ${family.name} ${variant.label}`,
    abbr: `${family.abbr}-${variant.code}`,
    abbreviation: `${family.abbr}-${variant.code}`,
    material_family: family.name,
    grade_name: `${brand.brand} ${code}`,
    supplier_or_brand: `${brand.supplier} ${brand.brand}`,
    category: family.category,
    subcategory: family.subcategory,
    state: profile.state,
    family: family.name,
    manufacturer: brand.supplier,
    trade_name: brand.brand,
    density,
    tensile_strength: tensile,
    tensile,
    flexural_strength: round(tensile * flexuralFactor(family.category), 1),
    impact_strength: impactFor(family.category, variant.code),
    hardness: hardnessFor(family.category, variant.code),
    elongation,
    glass_transition_temperature: profile.tg,
    tg: profile.tg,
    melting_temperature: profile.tm,
    tm: profile.tm,
    max_temperature: maxTemp,
    continuous_use_temperature: maxTemp,
    maxTemp,
    thermal_conductivity: round(profile.thermal * thermalFactor(family.category, variant.code), 2),
    dielectric_constant: profile.dielectric === null ? null : round(profile.dielectric + dielectricAdjustment(family.category, variant.code), 2),
    dielectric: profile.dielectric === null ? null : round(profile.dielectric + dielectricAdjustment(family.category, variant.code), 2),
    flame_rating: flameRating(family.category, variant.code),
    electrical_insulation: electricalInsulation(family.category, variant.code),
    chemical_resistance: chemicalResistance(profile.chemical, variant.code),
    transparency: transparencyFor(family.name, variant.code),
    flexibility: flexibilityFor(family.category, variant.code),
    waterproof_sealing: waterproofFor(family.category, variant.code),
    water_absorption: round(clamp(profile.waterAbsorption * waterFactor(family.category, variant.code), 0, 8), 2),
    flammability: flameRating(family.category, variant.code),
    recyclability: recyclabilityFor(family.category),
    recyclable: ["Metals", "Plastics", "Fibers"].includes(family.category),
    cost_level: costFor(profile.cost, variant.code),
    processing_methods: processingFor(family.category),
    typical_applications: applications,
    applications,
    advantages: [
      `${family.name} ${variant.label} supports ${applications.slice(0, 2).join(" and ")} screening workflows.`,
      `Commercial-style grade metadata includes supplier/brand, grade name, family, alternatives, and bilingual search terms.`
    ],
    disadvantages: limitations,
    limitations,
    alternatives: alternativesFor(family.category, family.name),
    tags,
    uses: applications,
    summary: `${brand.supplier} ${brand.brand} ${code} is a representative ${family.subcategory.toLowerCase()} entry for ${applications.slice(0, 2).join(" and ")} with ${tags.slice(0, 3).join(", ")} characteristics.`,
    description: `${brand.supplier} ${brand.brand} ${code} is a representative ${family.subcategory.toLowerCase()} entry for ${applications.slice(0, 2).join(" and ")} with ${tags.slice(0, 3).join(", ")} characteristics.`,
    notes: source.notes,
    source_note: "Generated commercial-style MatFinder screening record with bilingual English/Chinese search terms; verify exact commercial datasheet values before engineering use.",
    sources: [source]
  };
}

function rows(category, subcategory, profileKey, brands, values) {
  return values.map(([name, abbr]) => ({
    category,
    subcategory,
    profileKey,
    brands,
    name,
    abbr,
    tags: tagsFor(category, subcategory, name)
  }));
}

function tagsFor(category, subcategory, name) {
  const text = `${category} ${subcategory} ${name}`.toLowerCase();
  const tags = [category.toLowerCase(), subcategory.toLowerCase()];
  if (/transparent|glass|polycarbonate|pmma|cop|coc/.test(text)) tags.push("transparent", zh.transparent);
  if (/flame|phenolic|pps|pei|ceramic|silicone|intumescent/.test(text)) tags.push("flame retardant", zh.flame);
  if (/chemical|fluoro|pvdf|ptfe|pfa|fep|stainless|nickel|vinyl ester/.test(text)) tags.push("chemical resistant", zh.chemical);
  if (/fiber|composite|metal|aramid|carbon|steel|titanium/.test(text)) tags.push("high strength", zh.highStrength);
  if (/seal|rubber|elastomer|silicone|butyl|foam/.test(text)) tags.push("flexible", zh.flexible);
  if (/electrical|ceramic|mica|epoxy|polyimide|pps|pei|pbt/.test(text)) tags.push("electrical insulation", zh.insulation);
  if (/foam|aluminum|magnesium|polypropylene|polyethylene|fiber|composite/.test(text)) tags.push("lightweight", zh.lightweight);
  if (/coating|paint|topcoat|primer|lining/.test(text)) tags.push("coating", zh.coating);
  return uniq(tags);
}

function b(supplier, brand, code) {
  return { supplier, brand, code };
}

function p(state, density, tensile, elongation, tg, tm, maxTemp, dielectric, thermal, chemical, waterAbsorption, cost) {
  return { state, density, tensile, elongation, tg, tm, maxTemp, dielectric, thermal, chemical, waterAbsorption, cost };
}

function v(label, code, tensileMult, elongationMult, densityMult, temperatureAdd, tags, applications) {
  return { label, code, tensileMult, elongationMult, densityMult, temperatureAdd, tags, applications };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value, digits = 2) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name.toLowerCase()}|${item.grade_name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryStrengthFactor(category, code) {
  if (category === "Foams" && code === "HS") return 1.8;
  if (category === "Fibers" && code === "HS") return 1.35;
  if (category === "Adhesives" && code === "MED") return 0.8;
  return 1;
}

function densityAdjustment(category, code) {
  if (code === "HS" && ["Plastics", "Composites"].includes(category)) return 0.12;
  if (code === "FR") return 0.08;
  if (code === "CR" && category === "Metals") return 0.2;
  return 0;
}

function categoryTemperatureBonus(category, code) {
  if (code === "FR") return 5;
  if (code === "CR" && ["Metals", "Ceramics", "Coatings"].includes(category)) return 20;
  return 0;
}

function flexuralFactor(category) {
  if (category === "Metals") return 1.05;
  if (category === "Ceramics") return 1.25;
  if (category === "Fibers") return 0.9;
  if (category === "Foams") return 1.2;
  return 1.45;
}

function thermalFactor(category, code) {
  if (category === "Metals") return code === "CR" ? 0.85 : 1;
  if (category === "Ceramics") return code === "HS" ? 1.15 : 1;
  if (category === "Fibers") return code === "HS" ? 1.8 : 1;
  if (category === "Foams") return code === "FR" ? 0.9 : 1;
  return code === "HS" ? 1.25 : 1;
}

function dielectricAdjustment(category, code) {
  if (category === "Metals") return 0;
  if (code === "FR") return 0.2;
  if (code === "HS" && category === "Fibers") return 0.4;
  return 0;
}

function waterFactor(category, code) {
  if (code === "CR") return 0.65;
  if (["Sealants", "Coatings"].includes(category)) return 0.55;
  if (category === "Foams") return code === "UV" ? 0.45 : 1.2;
  return 1;
}

function flameRating(category, code) {
  if (code === "FR") return "flame-retardant grade; verify UL 94 or sector rating";
  if (["Ceramics", "Metals"].includes(category)) return "noncombustible";
  if (["Thermosets", "Coatings"].includes(category)) return "grade dependent flame performance";
  return "grade dependent; not specified";
}

function electricalInsulation(category, code) {
  if (category === "Metals") return "not electrically insulating";
  if (code === "FR" || ["Ceramics", "Thermosets", "Plastics", "Coatings"].includes(category)) return "electrical insulation potential; verify grade";
  if (category === "Fibers") return "fiber chemistry dependent";
  return "grade dependent";
}

function chemicalResistance(base, code) {
  if (code === "CR") return "good to excellent, verify media and temperature";
  return base;
}

function transparencyFor(name, code) {
  if (/polycarbonate|pmma|cop|coc|glass|silicone/.test(name.toLowerCase())) return code === "FR" ? "transparent grades may be formulation dependent" : "transparent grades available";
  if (/coating|adhesive|sealant/.test(name.toLowerCase())) return "clear or pigmented grades available";
  return "opaque or grade dependent";
}

function flexibilityFor(category, code) {
  if (["Elastomers", "Sealants"].includes(category)) return "flexible";
  if (category === "Foams") return code === "HS" ? "semi-rigid cellular" : "flexible or rigid by foam grade";
  if (category === "Fibers") return "flexible filament or textile form";
  if (["Ceramics", "Metals"].includes(category)) return "rigid";
  return code === "MED" ? "grade dependent" : "semi-rigid or rigid";
}

function waterproofFor(category, code) {
  if (["Sealants", "Coatings", "Elastomers"].includes(category)) return "suitable for sealing or waterproofing by joint design";
  if (code === "CR" || code === "UV") return "improved moisture or outdoor resistance by grade";
  return "grade dependent; verify water absorption and interface design";
}

function recyclabilityFor(category) {
  if (category === "Metals") return "commonly recyclable";
  if (category === "Plastics") return "resin-code and grade dependent";
  if (category === "Fibers") return "specialty stream or composite dependent";
  return "not typically recyclable or specialty stream";
}

function costFor(base, code) {
  if (code === "MED" || code === "FR" || code === "CR") return base === "low" ? "medium" : "high";
  return base;
}

function impactFor(category, code) {
  if (code === "HS" && ["Ceramics", "Composites"].includes(category)) return "notch and layup dependent";
  if (["Elastomers", "Foams", "Sealants"].includes(category)) return "energy absorption grade dependent";
  return "grade dependent";
}

function hardnessFor(category, code) {
  if (category === "Elastomers" || category === "Sealants") return code === "HS" ? "70 Shore A typical range" : "40-60 Shore A typical range";
  if (category === "Ceramics") return "Mohs 7-9 typical range";
  if (category === "Metals") return "temper and heat treatment dependent";
  if (category === "Foams") return "density dependent";
  return "Rockwell or Shore grade dependent";
}

function processingFor(category) {
  return {
    Plastics: ["injection molding", "extrusion", "\u6ce8\u5851", "\u6324\u51fa"],
    Elastomers: ["compression molding", "injection molding", "extrusion", "\u786b\u5316"],
    Thermosets: ["casting", "compression molding", "transfer molding", "\u56fa\u5316"],
    Composites: ["prepreg layup", "compression molding", "pultrusion", "\u94fa\u5c42"],
    Foams: ["foaming", "molding", "cutting", "\u53d1\u6ce1"],
    Ceramics: ["pressing", "sintering", "grinding", "\u70e7\u7ed3"],
    Metals: ["machining", "forming", "casting", "heat treatment", "\u673a\u52a0\u5de5"],
    Coatings: ["spraying", "powder coating", "curing", "\u6d82\u88c5"],
    Adhesives: ["dispensing", "mixing", "curing", "\u70b9\u80f6"],
    Sealants: ["dispensing", "tooling", "curing", "\u5bc6\u5c01\u65bd\u5de5"],
    Fibers: ["spinning", "weaving", "braiding", "pultrusion", "\u7eba\u4e1d"]
  }[category] || ["processing method grade dependent"];
}

function alternativesFor(category, name) {
  const defaults = {
    Plastics: ["ABS", "polycarbonate", "polypropylene"],
    Elastomers: ["EPDM", "silicone rubber", "TPU"],
    Thermosets: ["epoxy resin", "phenolic resin", "vinyl ester resin"],
    Composites: ["carbon fiber epoxy", "glass fiber polyester", "aluminum alloy"],
    Foams: ["PU foam", "PVC foam", "PET foam"],
    Ceramics: ["alumina", "zirconia", "silicon carbide"],
    Metals: ["stainless steel", "aluminum alloy", "titanium alloy"],
    Coatings: ["epoxy coating", "polyurethane coating", "fluoropolymer coating"],
    Adhesives: ["epoxy adhesive", "acrylic adhesive", "polyurethane adhesive"],
    Sealants: ["silicone sealant", "polyurethane sealant", "butyl sealant"],
    Fibers: ["carbon fiber", "glass fiber", "aramid fiber"]
  };
  return uniq([...(defaults[category] || ["engineering alternative"]), name]).slice(0, 4);
}

function limitationFor(category) {
  return {
    Plastics: "Properties vary with filler, additives, moisture, crystallinity, and molding history.",
    Elastomers: "Compound formulation, cure system, hardness, and fluid exposure dominate performance.",
    Thermosets: "Cure schedule, filler loading, and post-cure strongly affect final properties.",
    Composites: "Fiber architecture, layup, matrix, void content, and test direction dominate properties.",
    Foams: "Density, cell structure, temperature, and compression set must be validated.",
    Ceramics: "Brittleness, flaw population, porosity, and surface finish control design strength.",
    Metals: "Temper, heat treatment, product form, weld condition, and corrosion environment must be checked.",
    Coatings: "Surface preparation, film thickness, cure, and substrate compatibility control field performance.",
    Adhesives: "Joint design, surface preparation, bondline thickness, and cure conditions are critical.",
    Sealants: "Movement capability, adhesion, cure depth, and environmental exposure must be verified.",
    Fibers: "Filament count, sizing, twist, weave, and matrix compatibility control application performance."
  }[category] || "Representative values require project-specific validation.";
}
