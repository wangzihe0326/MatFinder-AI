const genericSources = {
  matweb: (name) => ({
    source_title: "MatWeb material search reference",
    source_url: `https://www.matweb.com/search/QuickText.aspx?SearchText=${encodeURIComponent(name)}`,
    source_type: "reference_database",
    notes:
      "Material-specific reference lookup. MatFinder stores null for quantitative fields where a reliable generic value is not defensible; verify grade-specific datasheets before engineering use."
  }),
  azom: (name) => ({
    source_title: "AZoM materials reference",
    source_url: `https://www.azom.com/search.aspx?q=${encodeURIComponent(name)}`,
    source_type: "technical_reference",
    notes:
      "Used for broad material identity and application context. Numeric values are not populated unless a grade-level value is curated separately."
  })
};

const uncertaintyNote =
  "Expanded MatWeb-style catalog record. Numerical properties are null when reliable generic values are unavailable because properties vary by alloy, grade, filler, cure system, processing route, heat treatment, porosity, and test method.";

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function entry(name, abbreviation, category, family, tags, typical_applications, processing_methods, options = {}) {
  const materialId = options.id || slug(`${category}-${name}`);
  const recyclability = options.recyclability || (category === "Metals" ? "commonly recyclable" : "grade dependent");
  return {
    material_id: materialId,
    id: materialId,
    name,
    abbreviation,
    abbr: abbreviation,
    category,
    family,
    manufacturer: options.manufacturer || null,
    trade_name: options.trade_name || null,
    density: null,
    tensile_strength: null,
    flexural_strength: null,
    impact_strength: null,
    hardness: null,
    elongation: null,
    glass_transition_temperature: null,
    melting_temperature: null,
    continuous_use_temperature: null,
    thermal_conductivity: null,
    dielectric_constant: null,
    chemical_resistance: options.chemical_resistance || null,
    water_absorption: null,
    flammability: options.flammability || null,
    recyclability,
    recyclable: /recyclable/i.test(recyclability),
    cost_level: options.cost_level || null,
    processing_methods,
    typical_applications,
    advantages: options.advantages || defaultAdvantages(category, tags),
    disadvantages: options.disadvantages || defaultDisadvantages(category),
    tags,
    uses: typical_applications,
    summary: options.summary || `${name} is a ${family.toLowerCase()} material used in ${typical_applications.slice(0, 2).join(" and ")}.`,
    notes: options.notes || uncertaintyNote,
    sources: [genericSources.matweb(name), genericSources.azom(name)]
  };
}

function defaultAdvantages(category, tags) {
  const advantages = [];
  if (tags.includes("heat resistant")) advantages.push("Heat resistance is indicated at the family or application level.");
  if (tags.includes("chemical resistant")) advantages.push("Chemical resistance is represented in the material family profile.");
  if (tags.includes("lightweight")) advantages.push("Lightweight design potential is indicated by the material family.");
  if (tags.includes("electrical insulation")) advantages.push("Electrical insulation suitability is indicated by the material family or applications.");
  if (category === "Metals") advantages.push("Broad industrial availability and recyclability are typical metal-family advantages.");
  if (category === "Ceramics") advantages.push("High hardness, heat resistance, or wear resistance are typical ceramic-family advantages.");
  if (category === "Composites") advantages.push("Composite architecture can be tailored for stiffness, strength, or weight reduction.");
  if (!advantages.length) advantages.push("Useful application fit is represented by the local material catalog entry.");
  return advantages;
}

function defaultDisadvantages(category) {
  if (category === "Metals") return ["Properties depend strongly on alloy chemistry, temper, heat treatment, and product form."];
  if (category === "Ceramics") return ["Brittleness, porosity, and processing route must be verified for structural design."];
  if (category === "Composites") return ["Properties depend strongly on fiber, matrix, layup, orientation, and processing quality."];
  if (category === "Thermosets") return ["Cured properties depend strongly on resin chemistry, filler, and cure schedule."];
  if (category === "Elastomers") return ["Compound formulation and cure system dominate final mechanical and chemical performance."];
  return ["Grade, additives, crystallinity, moisture, and processing can materially change final properties."];
}

const thermoplastics = [
  ["Linear low-density polyethylene", "LLDPE", "Polyolefin", ["lightweight", "flexible", "film", "packaging"], ["stretch film", "bags", "liners", "flexible tubing"], ["film extrusion", "blown film", "injection molding"]],
  ["Ultra-high molecular weight polyethylene", "UHMWPE", "Polyolefin", ["wear resistant", "low friction", "impact resistant", "chemical resistant"], ["wear strips", "liners", "medical bearings", "conveyor parts"], ["ram extrusion", "compression molding", "machining"]],
  ["Medium-density polyethylene", "MDPE", "Polyolefin", ["lightweight", "chemical resistant", "pipe", "tough"], ["gas pipe", "water pipe", "film", "containers"], ["extrusion", "blow molding", "injection molding"]],
  ["Chlorinated polyethylene", "CPE", "Polyolefin elastomer", ["flexible", "weather resistant", "flame retardant", "impact modifier"], ["wire jackets", "roofing membranes", "impact modifiers", "hose covers"], ["compounding", "extrusion", "calendering"]],
  ["Ethylene acrylic acid copolymer", "EAA", "Ionomer precursor", ["adhesive", "film", "packaging", "sealant"], ["tie layers", "packaging film", "coatings", "lamination"], ["extrusion coating", "film extrusion", "lamination"]],
  ["Ethylene methyl acrylate", "EMA", "Ethylene copolymer", ["flexible", "impact modifier", "film", "sealant"], ["films", "wire coating", "impact modification", "hot-melt blends"], ["extrusion", "film extrusion", "compounding"]],
  ["Ethylene butyl acrylate", "EBA", "Ethylene copolymer", ["flexible", "sealant", "impact modifier", "film"], ["seal layers", "flexible packaging", "polymer modification", "wire coating"], ["extrusion", "film extrusion", "compounding"]],
  ["Polyisobutylene", "PIB", "Polyolefin", ["gas barrier", "flexible", "adhesive", "sealant"], ["sealants", "adhesives", "fuel additives", "barrier layers"], ["compounding", "solution coating", "extrusion"]],
  ["Polybutene-1", "PB-1", "Polyolefin", ["pipe", "flexible", "creep resistant", "hot water"], ["plumbing pipe", "film", "hot-melt blends", "seal layers"], ["pipe extrusion", "film extrusion", "injection molding"]],
  ["Polyketone", "PK", "Engineering thermoplastic", ["chemical resistant", "wear resistant", "barrier", "tough"], ["fuel system parts", "gears", "barrier tubing", "industrial components"], ["injection molding", "extrusion", "compounding"]],
  ["Polymethyl methacrylimide foam", "PMI foam", "Structural foam", ["lightweight", "stiff", "composite core", "heat resistant"], ["aerospace sandwich cores", "radomes", "marine panels", "sports equipment"], ["foam molding", "machining", "bonding"]],
  ["Cellulose acetate", "CA", "Cellulosic", ["transparent", "bio-based", "moldable", "film"], ["eyewear frames", "films", "handles", "consumer goods"], ["injection molding", "extrusion", "film casting"]],
  ["Cellulose acetate butyrate", "CAB", "Cellulosic", ["transparent", "weather resistant", "tough", "coating"], ["tool handles", "coatings", "clear parts", "consumer products"], ["injection molding", "extrusion", "solution coating"]],
  ["Cellulose propionate", "CP", "Cellulosic", ["transparent", "tough", "moldable", "decorative"], ["eyewear", "tool handles", "decorative parts", "film"], ["injection molding", "extrusion"]],
  ["Thermoplastic starch", "TPS", "Bio-based thermoplastic", ["bio-based", "compostable", "flexible", "packaging"], ["compostable packaging", "loose-fill foam", "bags", "blends"], ["compounding", "film extrusion", "thermoforming"]],
  ["Polyhydroxyalkanoate", "PHA", "Bio-based polyester", ["bio-based", "biodegradable", "compostable", "packaging"], ["packaging", "agricultural films", "medical devices", "consumer goods"], ["injection molding", "film extrusion", "compounding"]],
  ["Polytrimethylene terephthalate", "PTT", "Polyester", ["fiber", "elastic recovery", "chemical resistant", "textile"], ["carpet fibers", "textiles", "films", "molded parts"], ["fiber spinning", "injection molding", "extrusion"]],
  ["Polyethylene naphthalate", "PEN", "Polyester", ["barrier", "heat resistant", "film", "electrical insulation"], ["films", "electronics", "bottles", "capacitor film"], ["film extrusion", "biaxial orientation", "injection molding"]],
  ["Polycyclohexylene dimethylene terephthalate", "PCT", "Polyester", ["heat resistant", "chemical resistant", "electrical", "dimensional stability"], ["electrical connectors", "automotive parts", "LED reflectors", "switches"], ["injection molding", "compounding"]],
  ["Polyaryletherketone", "PAEK", "High-performance thermoplastic", ["heat resistant", "chemical resistant", "high strength", "aerospace"], ["aerospace brackets", "medical devices", "oilfield components", "electrical parts"], ["injection molding", "extrusion", "additive manufacturing"]],
  ["Polyetherketone", "PEK", "High-performance thermoplastic", ["heat resistant", "chemical resistant", "high strength", "wear resistant"], ["high-temperature parts", "bearings", "electrical components", "aerospace"], ["injection molding", "extrusion", "machining"]],
  ["Polyphenylene ether", "PPE", "Engineering thermoplastic", ["dimensional stability", "electrical insulation", "low moisture", "heat resistant"], ["electronics housings", "automotive parts", "appliance components", "connectors"], ["injection molding", "blending", "extrusion"]],
  ["Modified polyphenylene ether", "mPPE", "Engineering thermoplastic", ["electrical insulation", "dimensional stability", "flame retardant", "low moisture"], ["battery components", "electrical housings", "connectors", "fluid parts"], ["injection molding", "compounding"]],
  ["Polyvinyl butyral", "PVB", "Vinyl polymer", ["transparent", "adhesive", "tough", "film"], ["laminated safety glass", "photovoltaic encapsulants", "coatings", "films"], ["film extrusion", "lamination", "solution coating"]],
  ["Polyvinyl formal", "PVF", "Vinyl acetal", ["film", "adhesive", "electrical insulation", "coating"], ["wire enamel", "coatings", "films", "adhesives"], ["solution coating", "film casting"]],
  ["Polyvinyl fluoride", "PVF", "Fluoropolymer film", ["weather resistant", "film", "chemical resistant", "protective"], ["architectural films", "solar backsheets", "aircraft interiors", "protective laminates"], ["film extrusion", "lamination"]],
  ["Polyvinylidene chloride", "PVDC", "Barrier polymer", ["barrier", "film", "food packaging", "chemical resistant"], ["food wrap", "barrier coatings", "pharmaceutical packaging", "films"], ["film extrusion", "coating", "coextrusion"]],
  ["Chlorinated polyvinyl chloride", "CPVC", "Chlorinated vinyl", ["heat resistant", "chemical resistant", "pipe", "flame retardant"], ["hot water pipe", "chemical piping", "fire sprinkler pipe", "fittings"], ["extrusion", "injection molding"]],
  ["Thermoplastic vulcanizate", "TPV", "Thermoplastic elastomer", ["elastomer", "weather resistant", "flexible", "automotive"], ["weather seals", "air ducts", "gaskets", "grips"], ["injection molding", "extrusion", "blow molding"]],
  ["Thermoplastic olefin", "TPO", "Thermoplastic elastomer", ["lightweight", "impact resistant", "weather resistant", "automotive"], ["bumper fascia", "roofing membranes", "interior trim", "skins"], ["injection molding", "extrusion", "thermoforming"]]
];

const engineeringPlastics = [
  ["Glass-filled nylon 6", "GF-PA6", "Polyamide compound", ["high strength", "stiff", "wear resistant", "heat resistant"], ["structural brackets", "gears", "housings", "automotive parts"], ["injection molding", "compounding"]],
  ["Glass-filled nylon 66", "GF-PA66", "Polyamide compound", ["high strength", "heat resistant", "electrical insulation", "stiff"], ["under-hood parts", "connectors", "fasteners", "pump parts"], ["injection molding", "compounding"]],
  ["Carbon-filled nylon", "CF-PA", "Polyamide compound", ["stiff", "wear resistant", "electrically conductive", "lightweight"], ["antistatic parts", "gears", "brackets", "jigs"], ["injection molding", "compounding", "additive manufacturing"]],
  ["Mineral-filled polypropylene", "MF-PP", "Polyolefin compound", ["stiff", "lightweight", "low cost", "dimensional stability"], ["automotive trim", "appliance parts", "furniture", "housings"], ["injection molding", "compounding"]],
  ["Talc-filled polypropylene", "TF-PP", "Polyolefin compound", ["stiff", "lightweight", "automotive", "dimensional stability"], ["instrument panels", "trim panels", "appliance housings", "interior parts"], ["injection molding", "compounding"]],
  ["Glass-filled polycarbonate", "GF-PC", "Polycarbonate compound", ["stiff", "impact resistant", "heat resistant", "dimensional stability"], ["structural housings", "electrical parts", "frames", "brackets"], ["injection molding", "compounding"]],
  ["PC/ABS blend", "PC/ABS", "Polycarbonate blend", ["impact resistant", "surface finish", "heat resistant", "moldable"], ["electronics housings", "automotive interiors", "medical housings", "enclosures"], ["injection molding", "compounding"]],
  ["PC/PBT blend", "PC/PBT", "Polyester blend", ["chemical resistant", "impact resistant", "automotive", "dimensional stability"], ["bumper parts", "connectors", "housings", "exterior trim"], ["injection molding", "compounding"]],
  ["PBT/ASA blend", "PBT/ASA", "Polyester blend", ["weather resistant", "dimensional stability", "surface finish", "automotive"], ["exterior trim", "mirror housings", "appliance panels", "outdoor parts"], ["injection molding", "compounding"]],
  ["PETG copolyester", "PETG", "Copolyester", ["transparent", "tough", "thermoformable", "medical"], ["displays", "medical trays", "packaging", "guards"], ["sheet extrusion", "thermoforming", "injection molding"]],
  ["PCTG copolyester", "PCTG", "Copolyester", ["transparent", "impact resistant", "chemical resistant", "moldable"], ["medical devices", "consumer goods", "containers", "clear housings"], ["injection molding", "extrusion", "blow molding"]],
  ["TRITAN copolyester", "Tritan", "Copolyester", ["transparent", "tough", "medical", "consumer"], ["drinkware", "medical components", "appliance parts", "containers"], ["injection molding", "extrusion"]],
  ["Acetal copolymer", "POM-C", "Acetal", ["low friction", "wear resistant", "dimensional stability", "machinable"], ["gears", "bearings", "valves", "precision parts"], ["injection molding", "extrusion", "machining"]],
  ["Acetal homopolymer", "POM-H", "Acetal", ["high stiffness", "low friction", "wear resistant", "fatigue resistant"], ["gears", "springs", "rollers", "pump parts"], ["injection molding", "extrusion", "machining"]],
  ["Glass-filled PBT", "GF-PBT", "Polyester compound", ["electrical insulation", "stiff", "heat resistant", "dimensional stability"], ["connectors", "bobbin coils", "switches", "sensors"], ["injection molding", "compounding"]],
  ["Glass-filled PET", "GF-PET", "Polyester compound", ["stiff", "heat resistant", "dimensional stability", "electrical"], ["electrical components", "appliance parts", "automotive brackets", "housings"], ["injection molding", "compounding"]],
  ["Long glass fiber polypropylene", "LGF-PP", "Polyolefin compound", ["lightweight", "stiff", "impact resistant", "automotive"], ["front-end modules", "seat structures", "carrier panels", "underbody shields"], ["injection molding", "compression molding"]],
  ["Polyamide 6T", "PA6T", "High-temperature polyamide", ["heat resistant", "stiff", "electrical", "low moisture"], ["connectors", "LED reflectors", "automotive electronics", "switches"], ["injection molding", "compounding"]],
  ["Polyamide 9T", "PA9T", "High-temperature polyamide", ["heat resistant", "chemical resistant", "low moisture", "electrical"], ["connectors", "fuel system parts", "electrical components", "automotive parts"], ["injection molding", "compounding"]],
  ["Polyamide 10T", "PA10T", "High-temperature polyamide", ["heat resistant", "bio-based", "electrical", "dimensional stability"], ["connectors", "automotive electronics", "LED parts", "precision components"], ["injection molding", "compounding"]],
  ["Semi-aromatic polyamide", "PPA", "Polyamide", ["heat resistant", "stiff", "chemical resistant", "electrical"], ["under-hood parts", "connectors", "fluid handling", "structural components"], ["injection molding", "compounding"]],
  ["Glass-filled PPS", "GF-PPS", "High-performance compound", ["heat resistant", "chemical resistant", "flame retardant", "dimensional stability"], ["pump parts", "connectors", "coil bobbins", "valves"], ["injection molding", "compounding"]],
  ["Glass-filled PEI", "GF-PEI", "High-temperature compound", ["heat resistant", "stiff", "flame retardant", "electrical insulation"], ["aerospace interiors", "electrical frames", "medical fixtures", "structural housings"], ["injection molding", "compounding"]],
  ["Glass-filled PSU", "GF-PSU", "Sulfone compound", ["heat resistant", "stiff", "hydrolysis resistant", "electrical"], ["hot-water components", "insulators", "medical devices", "food equipment"], ["injection molding", "compounding"]],
  ["Conductive ABS", "C-ABS", "Styrenic compound", ["electrically conductive", "impact resistant", "surface finish", "housings"], ["ESD housings", "electronics packaging", "fixtures", "covers"], ["injection molding", "compounding"]]
];

const highPerformance = [
  ["Carbon-filled PEEK", "CF-PEEK", "PAEK compound", ["heat resistant", "high strength", "wear resistant", "lightweight"], ["aerospace brackets", "medical instruments", "oilfield parts", "bearings"], ["injection molding", "machining", "additive manufacturing"]],
  ["Glass-filled PEEK", "GF-PEEK", "PAEK compound", ["heat resistant", "stiff", "chemical resistant", "electrical insulation"], ["connectors", "pump parts", "semiconductor fixtures", "structural parts"], ["injection molding", "machining"]],
  ["Bearing-grade PEEK", "BG-PEEK", "PAEK compound", ["wear resistant", "low friction", "heat resistant", "chemical resistant"], ["bearings", "bushings", "wear pads", "valve seats"], ["injection molding", "machining"]],
  ["Carbon-filled PTFE", "CF-PTFE", "Fluoropolymer compound", ["low friction", "wear resistant", "chemical resistant", "heat resistant"], ["seals", "bearings", "wear rings", "valve seats"], ["compression molding", "skiving", "machining"]],
  ["Glass-filled PTFE", "GF-PTFE", "Fluoropolymer compound", ["chemical resistant", "creep resistant", "low friction", "heat resistant"], ["gaskets", "seals", "bearings", "insulators"], ["compression molding", "machining"]],
  ["Bronze-filled PTFE", "Bz-PTFE", "Fluoropolymer compound", ["wear resistant", "low friction", "thermal conductivity", "bearing"], ["bearings", "bushings", "wear strips", "thrust washers"], ["compression molding", "machining"]],
  ["Graphite-filled PTFE", "G-PTFE", "Fluoropolymer compound", ["low friction", "wear resistant", "chemical resistant", "seal"], ["seals", "bearings", "piston rings", "gaskets"], ["compression molding", "machining"]],
  ["Mica-filled PTFE", "M-PTFE", "Fluoropolymer compound", ["electrical insulation", "heat resistant", "chemical resistant", "dimensional stability"], ["insulators", "seals", "gaskets", "electrical components"], ["compression molding", "machining"]],
  ["Polyimide film", "PI film", "Imide film", ["heat resistant", "electrical insulation", "film", "flex circuit"], ["flex circuits", "thermal insulation", "tapes", "electronics"], ["film casting", "lamination"]],
  ["Polyimide molding compound", "PI-MC", "Imide compound", ["heat resistant", "wear resistant", "high strength", "electrical insulation"], ["bushings", "insulators", "aerospace parts", "semiconductor fixtures"], ["compression molding", "sintering", "machining"]],
  ["Meldin-type polyimide", "PI stock", "Imide stock shape", ["heat resistant", "wear resistant", "machinable", "high strength"], ["bearings", "thrust washers", "insulators", "hot fixtures"], ["compression molding", "machining"]],
  ["Vespel-type polyimide", "PI shape", "Imide stock shape", ["heat resistant", "wear resistant", "aerospace", "machinable"], ["aerospace bushings", "semiconductor parts", "valve seats", "thermal isolators"], ["compression molding", "machining"]],
  ["Torlon-type PAI", "PAI shape", "Polyamide-imide stock", ["high strength", "wear resistant", "heat resistant", "dimensional stability"], ["gears", "bearings", "test sockets", "aerospace parts"], ["injection molding", "compression molding", "machining"]],
  ["PBI blend", "PBI blend", "Imidazole blend", ["ultra high temperature", "wear resistant", "chemical resistant", "machinable"], ["semiconductor fixtures", "glass handling", "thermal isolators", "aerospace"], ["compression molding", "machining"]],
  ["PEEK film", "PEEK film", "PAEK film", ["heat resistant", "chemical resistant", "film", "electrical insulation"], ["electrical films", "medical packaging", "speaker diaphragms", "insulation"], ["film extrusion", "orientation", "lamination"]],
  ["PEEK composite tape", "PEEK tape", "Thermoplastic composite", ["aerospace", "high strength", "heat resistant", "lightweight"], ["aerospace laminates", "consolidated panels", "brackets", "reinforcements"], ["tape laying", "thermoforming", "consolidation"]],
  ["PEKK composite tape", "PEKK tape", "Thermoplastic composite", ["aerospace", "heat resistant", "chemical resistant", "lightweight"], ["aircraft structures", "clips", "brackets", "laminates"], ["automated fiber placement", "consolidation", "thermoforming"]],
  ["PPS composite tape", "PPS tape", "Thermoplastic composite", ["chemical resistant", "flame retardant", "aerospace", "lightweight"], ["aircraft interiors", "panels", "ducting", "brackets"], ["tape laying", "compression molding", "thermoforming"]],
  ["LCP film", "LCP film", "Liquid crystal polymer film", ["film", "low dielectric", "heat resistant", "electrical"], ["flex circuits", "antenna substrates", "electronics", "high-frequency films"], ["film extrusion", "lamination"]],
  ["Low-dielectric LCP", "LD-LCP", "Liquid crystal polymer", ["low dielectric", "heat resistant", "electrical", "dimensional stability"], ["5G antennas", "connectors", "electronics", "high-frequency parts"], ["injection molding", "film extrusion"]],
  ["FEP film", "FEP film", "Fluoropolymer film", ["film", "chemical resistant", "electrical insulation", "heat resistant"], ["release films", "wire insulation", "chemical liners", "solar films"], ["film extrusion", "lamination"]],
  ["PFA tubing grade", "PFA tube", "Fluoropolymer", ["chemical resistant", "high purity", "heat resistant", "tubing"], ["semiconductor tubing", "chemical transfer", "labware", "fluid handling"], ["tube extrusion", "injection molding"]],
  ["ETFE film", "ETFE film", "Fluoropolymer film", ["weather resistant", "film", "tough", "lightweight"], ["architectural cushions", "solar films", "wire insulation", "protective films"], ["film extrusion", "lamination"]],
  ["ECTFE coating grade", "ECTFE coat", "Fluoropolymer coating", ["chemical resistant", "barrier", "coating", "flame retardant"], ["chemical vessel linings", "coatings", "wire jackets", "films"], ["powder coating", "extrusion", "rotolining"]],
  ["PVDF membrane grade", "PVDF membrane", "Fluoropolymer membrane", ["chemical resistant", "membrane", "battery", "filtration"], ["filtration membranes", "battery binders", "chemical processing", "sensors"], ["solution casting", "extrusion", "coating"]]
];

const thermosets = [
  ["Bisphenol A epoxy", "DGEBA epoxy", "Epoxy resin", ["thermoset", "adhesive", "composite matrix", "electrical insulation"], ["adhesives", "composites", "potting", "coatings"], ["casting", "layup", "filament winding", "resin transfer molding"]],
  ["Novolac epoxy", "Novolac EP", "Epoxy resin", ["thermoset", "chemical resistant", "heat resistant", "coating"], ["chemical coatings", "laminates", "adhesives", "encapsulation"], ["casting", "coating", "lamination"]],
  ["Cycloaliphatic epoxy", "CAE", "Epoxy resin", ["thermoset", "electrical insulation", "weather resistant", "low viscosity"], ["electrical casting", "LED encapsulation", "coatings", "adhesives"], ["casting", "potting", "coating"]],
  ["Bismaleimide resin", "BMI", "High-temperature thermoset", ["heat resistant", "aerospace", "composite matrix", "high strength"], ["aerospace composites", "radomes", "engine components", "adhesives"], ["prepreg layup", "autoclave cure", "resin transfer molding"]],
  ["Cyanate ester resin", "CE", "High-temperature thermoset", ["low dielectric", "heat resistant", "aerospace", "composite matrix"], ["radomes", "printed circuit boards", "aerospace composites", "adhesives"], ["prepreg layup", "lamination", "resin transfer molding"]],
  ["Benzoxazine resin", "BZ", "High-temperature thermoset", ["heat resistant", "low shrinkage", "flame retardant", "composite matrix"], ["composites", "electronics", "adhesives", "coatings"], ["prepreg", "casting", "lamination"]],
  ["Polyurethane thermoset", "PUR TS", "Polyurethane", ["thermoset", "flexible", "foam", "coating"], ["foams", "cast elastomers", "coatings", "adhesives"], ["reaction molding", "casting", "foaming"]],
  ["Rigid polyurethane foam", "Rigid PUR", "Polyurethane foam", ["insulation", "lightweight", "foam", "thermal"], ["building insulation", "refrigeration panels", "sandwich panels", "buoyancy"], ["foaming", "spray foam", "panel molding"]],
  ["Flexible polyurethane foam", "Flex PUR", "Polyurethane foam", ["flexible", "cushioning", "foam", "comfort"], ["seating", "mattresses", "packaging foam", "acoustic foam"], ["foaming", "slabstock", "molded foam"]],
  ["Silicone resin", "Si resin", "Silicone thermoset", ["heat resistant", "electrical insulation", "coating", "weather resistant"], ["high-temperature coatings", "electrical varnish", "mold release", "binders"], ["coating", "curing", "casting"]],
  ["Alkyd resin", "Alkyd", "Coating resin", ["coating", "adhesive", "decorative", "film forming"], ["paints", "varnishes", "coatings", "inks"], ["coating", "curing"]],
  ["Diallyl phthalate", "DAP", "Thermoset molding compound", ["electrical insulation", "dimensional stability", "thermoset", "moldable"], ["electrical connectors", "switchgear", "potting", "molded components"], ["compression molding", "transfer molding"]],
  ["Furan resin", "Furan", "Thermoset resin", ["chemical resistant", "foundry", "thermoset", "coating"], ["foundry binders", "chemical-resistant linings", "mortars", "coatings"], ["casting", "curing", "coating"]],
  ["Polyester gelcoat", "Gelcoat", "Thermoset coating", ["coating", "composite surface", "weather resistant", "decorative"], ["marine hulls", "composite panels", "sanitary ware", "vehicle bodies"], ["spray-up", "hand layup", "curing"]],
  ["Vinyl ester novolac", "VE novolac", "Thermoset resin", ["chemical resistant", "heat resistant", "composite matrix", "corrosion"], ["chemical tanks", "pipes", "scrubbers", "linings"], ["filament winding", "hand layup", "resin transfer molding"]],
  ["Epoxy molding compound", "EMC", "Electronics thermoset", ["electrical insulation", "encapsulation", "moldable", "electronics"], ["semiconductor packages", "encapsulation", "sensors", "electronic modules"], ["transfer molding", "compression molding"]],
  ["Sheet molding compound", "SMC", "Composite thermoset", ["composite", "moldable", "automotive", "stiff"], ["body panels", "electrical boxes", "structural covers", "truck parts"], ["compression molding"]],
  ["Bulk molding compound", "BMC", "Composite thermoset", ["composite", "moldable", "electrical insulation", "dimensional stability"], ["electrical housings", "automotive parts", "pump parts", "appliance components"], ["compression molding", "injection molding", "transfer molding"]],
  ["Phenolic molding compound", "PF compound", "Phenolic resin", ["heat resistant", "flame retardant", "moldable", "electrical insulation"], ["switchgear", "handles", "brake parts", "appliance components"], ["compression molding", "transfer molding"]],
  ["Epoxy glass laminate", "G10/FR4", "Thermoset laminate", ["electrical insulation", "composite", "flame retardant", "stiff"], ["circuit boards", "insulators", "fixtures", "structural laminates"], ["lamination", "press curing", "machining"]]
];

const elastomers = [
  ["Hydrogenated nitrile rubber", "HNBR", "Specialty rubber", ["elastomer", "oil resistant", "heat resistant", "fuel resistant"], ["seals", "belts", "hoses", "oilfield parts"], ["mixing", "molding", "extrusion", "vulcanization"]],
  ["Carboxylated nitrile rubber", "XNBR", "Specialty rubber", ["elastomer", "abrasion resistant", "oil resistant", "tough"], ["roll covers", "seals", "belts", "gaskets"], ["mixing", "molding", "vulcanization"]],
  ["Fluorosilicone rubber", "FVMQ", "Specialty rubber", ["elastomer", "fuel resistant", "low temperature", "aerospace"], ["fuel system seals", "aerospace gaskets", "o-rings", "diaphragms"], ["molding", "extrusion", "vulcanization"]],
  ["Liquid silicone rubber", "LSR", "Silicone elastomer", ["elastomer", "medical", "low temperature", "moldable"], ["medical parts", "seals", "keypads", "baby products"], ["liquid injection molding", "compression molding"]],
  ["High consistency silicone rubber", "HCR", "Silicone elastomer", ["elastomer", "heat resistant", "electrical insulation", "flexible"], ["tubing", "seals", "cable insulation", "profiles"], ["extrusion", "compression molding", "calendering"]],
  ["Room-temperature vulcanizing silicone", "RTV silicone", "Silicone elastomer", ["sealant", "elastomer", "adhesive", "electrical insulation"], ["sealants", "potting", "gaskets", "adhesives"], ["room temperature cure", "casting", "dispensing"]],
  ["Polyether polyurethane elastomer", "EU", "Polyurethane rubber", ["elastomer", "wear resistant", "hydrolysis resistant", "flexible"], ["wheels", "rollers", "seals", "bushings"], ["casting", "injection molding", "reaction molding"]],
  ["Polyester polyurethane elastomer", "AU", "Polyurethane rubber", ["elastomer", "oil resistant", "wear resistant", "tough"], ["wheels", "couplings", "seals", "belts"], ["casting", "molding", "extrusion"]],
  ["Thermoplastic copolyester elastomer", "TPC", "TPE", ["elastomer", "chemical resistant", "fatigue resistant", "flexible"], ["boots", "hoses", "cable jackets", "automotive parts"], ["injection molding", "extrusion", "blow molding"]],
  ["Polyamide elastomer", "PEBA", "TPE", ["elastomer", "low temperature", "lightweight", "flexible"], ["sports equipment", "medical tubing", "film", "footwear"], ["injection molding", "extrusion", "film extrusion"]],
  ["Olefin block copolymer", "OBC", "TPE", ["elastomer", "lightweight", "flexible", "polyolefin"], ["films", "foams", "automotive parts", "flexible packaging"], ["extrusion", "injection molding", "foaming"]],
  ["Ethylene propylene rubber", "EPM", "Rubber", ["elastomer", "weather resistant", "ozone resistant", "electrical insulation"], ["cable insulation", "seals", "hoses", "gaskets"], ["mixing", "extrusion", "vulcanization"]],
  ["Halobutyl rubber", "XIIR", "Rubber", ["elastomer", "gas barrier", "weather resistant", "pharmaceutical"], ["inner liners", "pharmaceutical stoppers", "seals", "membranes"], ["mixing", "molding", "vulcanization"]],
  ["Bromobutyl rubber", "BIIR", "Rubber", ["elastomer", "gas barrier", "pharmaceutical", "low permeability"], ["tire inner liners", "stoppers", "seals", "medical closures"], ["mixing", "molding", "vulcanization"]],
  ["Chlorobutyl rubber", "CIIR", "Rubber", ["elastomer", "gas barrier", "weather resistant", "pharmaceutical"], ["inner liners", "stoppers", "seals", "liners"], ["mixing", "molding", "vulcanization"]],
  ["Polysulfide rubber", "T", "Specialty rubber", ["sealant", "fuel resistant", "chemical resistant", "elastomer"], ["aircraft sealants", "construction sealants", "fuel tank sealants", "gaskets"], ["mixing", "curing", "dispensing"]],
  ["Polyacrylate elastomer", "ACM", "Specialty rubber", ["oil resistant", "heat resistant", "elastomer", "automotive"], ["transmission seals", "hoses", "gaskets", "o-rings"], ["mixing", "molding", "vulcanization"]],
  ["Ethylene acrylic elastomer", "AEM", "Specialty rubber", ["heat resistant", "oil resistant", "automotive", "elastomer"], ["turbo hoses", "seals", "gaskets", "air ducts"], ["mixing", "molding", "extrusion"]],
  ["Polyphosphazene elastomer", "PNF", "Specialty rubber", ["low temperature", "flame retardant", "oil resistant", "elastomer"], ["aerospace seals", "specialty gaskets", "fuel system parts", "low-temperature seals"], ["molding", "vulcanization"]],
  ["Thermoplastic silicone vulcanizate", "TPSiV", "TPE", ["elastomer", "silicone", "moldable", "soft touch"], ["wearables", "grips", "medical parts", "consumer goods"], ["injection molding", "extrusion"]]
];

const composites = [
  ["Carbon fiber epoxy composite", "CF/EP", "Fiber-reinforced polymer", ["composite", "high strength", "lightweight", "aerospace"], ["aircraft structures", "sporting goods", "robot arms", "automotive panels"], ["prepreg layup", "resin transfer molding", "filament winding"]],
  ["Glass fiber epoxy composite", "GF/EP", "Fiber-reinforced polymer", ["composite", "electrical insulation", "stiff", "corrosion resistant"], ["electrical laminates", "tooling", "structural panels", "marine parts"], ["layup", "pultrusion", "resin transfer molding"]],
  ["Aramid fiber epoxy composite", "AF/EP", "Fiber-reinforced polymer", ["composite", "impact resistant", "lightweight", "tough"], ["ballistic panels", "aerospace parts", "sporting goods", "protective structures"], ["prepreg layup", "compression molding"]],
  ["Carbon fiber PEEK composite", "CF/PEEK", "Thermoplastic composite", ["composite", "heat resistant", "lightweight", "aerospace"], ["aircraft brackets", "clips", "medical devices", "oilfield components"], ["thermoforming", "automated fiber placement", "compression molding"]],
  ["Glass fiber PPS composite", "GF/PPS", "Thermoplastic composite", ["composite", "chemical resistant", "flame retardant", "lightweight"], ["aircraft interiors", "ducting", "electrical parts", "panels"], ["thermoforming", "compression molding", "tape laying"]],
  ["Carbon fiber PPS composite", "CF/PPS", "Thermoplastic composite", ["composite", "lightweight", "chemical resistant", "aerospace"], ["aircraft panels", "brackets", "clips", "structural parts"], ["compression molding", "automated tape laying"]],
  ["Carbon fiber PEKK composite", "CF/PEKK", "Thermoplastic composite", ["composite", "heat resistant", "aerospace", "lightweight"], ["aircraft structures", "brackets", "clips", "stiffened panels"], ["automated fiber placement", "consolidation"]],
  ["Glass mat thermoplastic polypropylene", "GMT-PP", "Thermoplastic composite", ["composite", "lightweight", "automotive", "impact resistant"], ["underbody shields", "seat structures", "load floors", "bumper beams"], ["compression molding", "thermoforming"]],
  ["Long fiber thermoplastic polypropylene", "LFT-PP", "Thermoplastic composite", ["composite", "lightweight", "stiff", "automotive"], ["front-end modules", "instrument panels", "door carriers", "structural supports"], ["injection molding", "compression molding"]],
  ["Sheet molding compound polyester", "SMC-UP", "Thermoset composite", ["composite", "moldable", "automotive", "stiff"], ["body panels", "electrical enclosures", "truck parts", "covers"], ["compression molding"]],
  ["Bulk molding compound polyester", "BMC-UP", "Thermoset composite", ["composite", "electrical insulation", "moldable", "dimensional stability"], ["switchgear", "motor housings", "pump parts", "appliance parts"], ["compression molding", "transfer molding"]],
  ["Pultruded glass fiber polyester", "GFRP-UP", "Pultruded composite", ["composite", "corrosion resistant", "structural", "electrical insulation"], ["grating", "profiles", "ladders", "cable trays"], ["pultrusion"]],
  ["Pultruded glass fiber vinyl ester", "GFRP-VE", "Pultruded composite", ["composite", "chemical resistant", "corrosion resistant", "structural"], ["chemical grating", "handrails", "profiles", "tank supports"], ["pultrusion"]],
  ["Carbon fiber vinyl ester composite", "CF/VE", "Thermoset composite", ["composite", "corrosion resistant", "lightweight", "stiff"], ["marine structures", "industrial parts", "sporting goods", "reinforcements"], ["layup", "infusion", "resin transfer molding"]],
  ["Basalt fiber epoxy composite", "BF/EP", "Fiber-reinforced polymer", ["composite", "corrosion resistant", "stiff", "thermal"], ["rebars", "panels", "pipes", "automotive parts"], ["pultrusion", "layup", "filament winding"]],
  ["Natural fiber polypropylene composite", "NF/PP", "Bio-composite", ["composite", "lightweight", "bio-based", "automotive"], ["door panels", "trim", "consumer goods", "packaging"], ["compression molding", "injection molding"]],
  ["Wood plastic composite polyethylene", "WPC-PE", "Wood plastic composite", ["composite", "outdoor", "wood-filled", "decking"], ["decking", "fencing", "profiles", "landscape products"], ["extrusion", "compression molding"]],
  ["Wood plastic composite polypropylene", "WPC-PP", "Wood plastic composite", ["composite", "stiff", "wood-filled", "automotive"], ["trim panels", "decking", "furniture", "profiles"], ["extrusion", "injection molding"]],
  ["Glass fiber phenolic composite", "GF/PF", "Thermoset composite", ["composite", "flame retardant", "heat resistant", "electrical insulation"], ["electrical laminates", "brake components", "insulators", "handles"], ["lamination", "compression molding"]],
  ["Carbon carbon composite", "C/C", "Carbon composite", ["ultra high temperature", "lightweight", "aerospace", "friction"], ["aircraft brakes", "rocket nozzles", "furnace fixtures", "thermal shields"], ["carbonization", "densification", "machining"]]
];

const metals = [
  ["Commercially pure aluminum", "Al 1100", "Metals", "Aluminum alloy", ["lightweight", "corrosion resistant", "formable", "recyclable"], ["sheet metal", "heat exchangers", "chemical equipment", "reflectors"], ["rolling", "forming", "welding"]],
  ["Aluminum 2024", "Al 2024", "Metals", "Aluminum alloy", ["lightweight", "high strength", "aerospace", "machinable"], ["aircraft structures", "rivets", "truck wheels", "fittings"], ["rolling", "extrusion", "machining"]],
  ["Aluminum 3003", "Al 3003", "Metals", "Aluminum alloy", ["formable", "corrosion resistant", "lightweight", "recyclable"], ["ductwork", "cookware", "tanks", "sheet parts"], ["rolling", "forming", "welding"]],
  ["Aluminum 5052", "Al 5052", "Metals", "Aluminum alloy", ["corrosion resistant", "marine", "formable", "lightweight"], ["marine panels", "fuel tanks", "enclosures", "sheet metal"], ["rolling", "forming", "welding"]],
  ["Aluminum 6061", "Al 6061", "Metals", "Aluminum alloy", ["lightweight", "machinable", "weldable", "structural"], ["frames", "fixtures", "machine parts", "extrusions"], ["extrusion", "machining", "welding"]],
  ["Aluminum 7075", "Al 7075", "Metals", "Aluminum alloy", ["high strength", "lightweight", "aerospace", "machinable"], ["aircraft parts", "molds", "sporting goods", "high-stress components"], ["machining", "forging", "extrusion"]],
  ["Austenitic stainless steel 304", "SS 304", "Metals", "Stainless steel", ["corrosion resistant", "formable", "food", "recyclable"], ["food equipment", "tanks", "fasteners", "architectural parts"], ["rolling", "forming", "welding"]],
  ["Austenitic stainless steel 316", "SS 316", "Metals", "Stainless steel", ["corrosion resistant", "marine", "medical", "recyclable"], ["marine hardware", "chemical equipment", "medical devices", "fasteners"], ["machining", "forming", "welding"]],
  ["Ferritic stainless steel 430", "SS 430", "Metals", "Stainless steel", ["corrosion resistant", "magnetic", "decorative", "recyclable"], ["appliance trim", "automotive trim", "kitchen equipment", "panels"], ["rolling", "forming"]],
  ["Martensitic stainless steel 420", "SS 420", "Metals", "Stainless steel", ["hard", "wear resistant", "corrosion resistant", "recyclable"], ["cutlery", "surgical instruments", "shafts", "valves"], ["machining", "heat treatment"]],
  ["Precipitation hardening stainless steel 17-4 PH", "17-4PH", "Metals", "Stainless steel", ["high strength", "corrosion resistant", "aerospace", "recyclable"], ["shafts", "valves", "aircraft fittings", "fasteners"], ["machining", "heat treatment", "forging"]],
  ["Low carbon steel A36", "A36", "Metals", "Carbon steel", ["structural", "weldable", "low cost", "recyclable"], ["beams", "plates", "frames", "structural parts"], ["rolling", "welding", "machining"]],
  ["Low carbon steel 1018", "1018 steel", "Metals", "Carbon steel", ["machinable", "weldable", "structural", "recyclable"], ["shafts", "pins", "fixtures", "machine parts"], ["cold drawing", "machining", "welding"]],
  ["Medium carbon steel 1045", "1045 steel", "Metals", "Carbon steel", ["strength", "machinable", "wear resistant", "recyclable"], ["shafts", "gears", "axles", "studs"], ["machining", "forging", "heat treatment"]],
  ["Alloy steel 4140", "4140 steel", "Metals", "Alloy steel", ["high strength", "tough", "machinable", "recyclable"], ["shafts", "gears", "tooling", "bolts"], ["forging", "machining", "heat treatment"]],
  ["Tool steel D2", "D2", "Metals", "Tool steel", ["wear resistant", "hard", "tooling", "recyclable"], ["dies", "cutting tools", "punches", "wear plates"], ["machining", "heat treatment", "grinding"]],
  ["Tool steel H13", "H13", "Metals", "Tool steel", ["heat resistant", "tooling", "tough", "wear resistant"], ["die casting dies", "hot work tooling", "extrusion dies", "molds"], ["machining", "heat treatment", "grinding"]],
  ["Copper C110", "C110", "Metals", "Copper alloy", ["electrical conductivity", "thermal conductivity", "recyclable", "ductile"], ["bus bars", "electrical conductors", "heat exchangers", "connectors"], ["rolling", "drawing", "machining"]],
  ["Brass C260", "C260", "Metals", "Copper alloy", ["formable", "corrosion resistant", "decorative", "recyclable"], ["cartridge cases", "radiator cores", "decorative parts", "springs"], ["rolling", "forming", "stamping"]],
  ["Bronze C932", "C932", "Metals", "Copper alloy", ["bearing", "wear resistant", "machinable", "recyclable"], ["bearings", "bushings", "thrust washers", "pump parts"], ["casting", "machining"]],
  ["Titanium Grade 2", "Ti Gr 2", "Metals", "Titanium alloy", ["corrosion resistant", "lightweight", "medical", "recyclable"], ["chemical equipment", "medical devices", "marine parts", "heat exchangers"], ["forming", "machining", "welding"]],
  ["Titanium Grade 5", "Ti-6Al-4V", "Metals", "Titanium alloy", ["high strength", "lightweight", "aerospace", "medical"], ["aircraft parts", "implants", "fasteners", "sporting goods"], ["forging", "machining", "additive manufacturing"]],
  ["Magnesium AZ31", "AZ31", "Metals", "Magnesium alloy", ["lightweight", "machinable", "castable", "recyclable"], ["aerospace panels", "electronics housings", "automotive parts", "sheet parts"], ["casting", "rolling", "machining"]],
  ["Magnesium AZ91", "AZ91", "Metals", "Magnesium alloy", ["lightweight", "die casting", "automotive", "recyclable"], ["die cast housings", "automotive brackets", "electronics cases", "power tools"], ["die casting", "machining"]],
  ["Nickel 200", "Ni 200", "Metals", "Nickel alloy", ["corrosion resistant", "chemical resistant", "electrical", "recyclable"], ["chemical equipment", "battery parts", "electrodes", "heat exchangers"], ["rolling", "forming", "welding"]],
  ["Inconel 625", "IN625", "Metals", "Nickel superalloy", ["heat resistant", "corrosion resistant", "high strength", "aerospace"], ["turbine parts", "chemical processing", "marine components", "exhaust systems"], ["forging", "machining", "additive manufacturing"]],
  ["Inconel 718", "IN718", "Metals", "Nickel superalloy", ["heat resistant", "high strength", "aerospace", "corrosion resistant"], ["turbine disks", "rocket parts", "fasteners", "oilfield components"], ["forging", "machining", "additive manufacturing"]],
  ["Monel 400", "Monel 400", "Metals", "Nickel copper alloy", ["marine", "corrosion resistant", "chemical resistant", "recyclable"], ["marine hardware", "chemical equipment", "valves", "pump shafts"], ["machining", "forging", "welding"]],
  ["Zinc alloy Zamak 3", "Zamak 3", "Metals", "Zinc alloy", ["die casting", "low cost", "decorative", "recyclable"], ["die cast housings", "hardware", "toys", "decorative parts"], ["die casting", "plating"]],
  ["Lead-free solder SAC305", "SAC305", "Metals", "Solder alloy", ["electronics", "low melting", "recyclable", "joining"], ["PCB solder joints", "electronics assembly", "surface mount", "rework"], ["soldering", "reflow", "wave soldering"]]
];

const ceramics = [
  ["Alumina 96 percent", "Al2O3 96", "Ceramics", "Oxide ceramic", ["electrical insulation", "wear resistant", "heat resistant", "hard"], ["insulators", "wear parts", "substrates", "tubes"], ["pressing", "sintering", "machining"]],
  ["Alumina 99.5 percent", "Al2O3 99.5", "Ceramics", "Oxide ceramic", ["electrical insulation", "high purity", "wear resistant", "heat resistant"], ["semiconductor parts", "insulators", "labware", "wear components"], ["pressing", "sintering", "grinding"]],
  ["Zirconia partially stabilized", "PSZ", "Ceramics", "Oxide ceramic", ["tough", "wear resistant", "thermal barrier", "hard"], ["valves", "bearings", "dental parts", "cutting tools"], ["pressing", "sintering", "grinding"]],
  ["Yttria-stabilized zirconia", "YSZ", "Ceramics", "Oxide ceramic", ["thermal barrier", "ionic conductor", "heat resistant", "wear resistant"], ["thermal barrier coatings", "fuel cells", "sensors", "dental ceramics"], ["sintering", "coating", "grinding"]],
  ["Silicon carbide", "SiC", "Ceramics", "Carbide ceramic", ["wear resistant", "thermal conductivity", "heat resistant", "hard"], ["seals", "bearings", "armor", "kiln furniture"], ["sintering", "reaction bonding", "hot pressing"]],
  ["Reaction bonded silicon carbide", "RB-SiC", "Ceramics", "Carbide ceramic", ["wear resistant", "thermal shock", "hard", "chemical resistant"], ["mechanical seals", "burner nozzles", "kiln furniture", "armor"], ["reaction bonding", "machining"]],
  ["Silicon nitride", "Si3N4", "Ceramics", "Nitride ceramic", ["thermal shock", "wear resistant", "high strength", "bearing"], ["bearings", "cutting tools", "engine parts", "welding pins"], ["sintering", "hot pressing", "grinding"]],
  ["Aluminum nitride", "AlN", "Ceramics", "Nitride ceramic", ["thermal conductivity", "electrical insulation", "electronics", "heat resistant"], ["power electronics substrates", "heat spreaders", "LED packages", "semiconductor parts"], ["sintering", "metallization"]],
  ["Boron nitride", "BN", "Ceramics", "Nitride ceramic", ["thermal shock", "electrical insulation", "lubricious", "heat resistant"], ["crucibles", "insulators", "release coatings", "furnace parts"], ["hot pressing", "machining"]],
  ["Boron carbide", "B4C", "Ceramics", "Carbide ceramic", ["armor", "hard", "wear resistant", "lightweight"], ["armor plates", "blast nozzles", "abrasives", "wear parts"], ["hot pressing", "sintering", "grinding"]],
  ["Tungsten carbide cobalt", "WC-Co", "Ceramics", "Cemented carbide", ["wear resistant", "hard", "tooling", "high strength"], ["cutting tools", "dies", "wear inserts", "mining tools"], ["powder metallurgy", "sintering", "grinding"]],
  ["Titanium carbide", "TiC", "Ceramics", "Carbide ceramic", ["hard", "wear resistant", "tooling", "heat resistant"], ["cutting tools", "cermets", "wear coatings", "dies"], ["sintering", "hot pressing"]],
  ["Mullite", "Mullite", "Ceramics", "Aluminosilicate ceramic", ["thermal shock", "refractory", "electrical insulation", "heat resistant"], ["kiln furniture", "refractories", "tubes", "insulators"], ["sintering", "extrusion", "casting"]],
  ["Cordierite", "Cordierite", "Ceramics", "Magnesium aluminosilicate", ["thermal shock", "low expansion", "refractory", "insulation"], ["catalyst substrates", "kiln furniture", "cookware", "honeycombs"], ["extrusion", "sintering"]],
  ["Steatite ceramic", "Steatite", "Ceramics", "Magnesium silicate ceramic", ["electrical insulation", "low cost", "heat resistant", "moldable"], ["electrical insulators", "switch parts", "terminal blocks", "bushings"], ["pressing", "sintering"]],
  ["Porcelain ceramic", "Porcelain", "Ceramics", "Silicate ceramic", ["electrical insulation", "weather resistant", "hard", "low cost"], ["insulators", "sanitary ware", "tiles", "labware"], ["forming", "glazing", "firing"]],
  ["Fused silica", "SiO2", "Ceramics", "Glass ceramic", ["low expansion", "transparent", "heat resistant", "optical"], ["optics", "furnace tubes", "semiconductor parts", "windows"], ["melting", "forming", "machining"]],
  ["Borosilicate glass", "Boro glass", "Ceramics", "Glass", ["thermal shock", "transparent", "chemical resistant", "labware"], ["labware", "sight glasses", "lighting", "cookware"], ["glass forming", "blowing", "molding"]],
  ["Soda lime glass", "SL glass", "Ceramics", "Glass", ["transparent", "low cost", "rigid", "recyclable"], ["windows", "containers", "bottles", "flat glass"], ["float glass", "molding", "forming"]],
  ["Glass ceramic", "LAS", "Ceramics", "Glass ceramic", ["low expansion", "thermal shock", "cooktop", "heat resistant"], ["cooktops", "telescope mirrors", "heat-resistant panels", "windows"], ["glass forming", "controlled crystallization"]],
  ["Macor machinable glass ceramic", "Macor", "Ceramics", "Machinable glass ceramic", ["machinable", "electrical insulation", "vacuum", "heat resistant"], ["fixtures", "insulators", "vacuum components", "prototypes"], ["machining", "firing"]],
  ["Ferrite ceramic", "Ferrite", "Ceramics", "Magnetic ceramic", ["magnetic", "electrical", "electronics", "hard"], ["magnets", "inductors", "transformer cores", "antennas"], ["powder pressing", "sintering"]],
  ["Piezoelectric PZT ceramic", "PZT", "Ceramics", "Piezoelectric ceramic", ["piezoelectric", "sensor", "actuator", "electronics"], ["ultrasonic transducers", "actuators", "sensors", "buzzers"], ["powder processing", "sintering", "poling"]],
  ["Hydroxyapatite", "HA", "Ceramics", "Bioceramic", ["biocompatible", "medical", "coating", "bone"], ["bone grafts", "implant coatings", "biomedical scaffolds", "dental parts"], ["sintering", "coating", "additive manufacturing"]],
  ["Tricalcium phosphate", "TCP", "Ceramics", "Bioceramic", ["biocompatible", "resorbable", "medical", "bone"], ["bone grafts", "scaffolds", "dental materials", "implant fillers"], ["sintering", "additive manufacturing"]],
  ["Zirconia toughened alumina", "ZTA", "Ceramics", "Composite ceramic", ["wear resistant", "tough", "hard", "medical"], ["wear parts", "cutting tools", "medical implants", "valves"], ["sintering", "hot pressing", "grinding"]],
  ["Alumina toughened zirconia", "ATZ", "Ceramics", "Composite ceramic", ["tough", "wear resistant", "hard", "biomedical"], ["dental parts", "wear components", "valves", "bearings"], ["sintering", "grinding"]],
  ["Sialon ceramic", "SiAlON", "Ceramics", "Nitride ceramic", ["thermal shock", "wear resistant", "cutting tool", "high temperature"], ["cutting inserts", "molten metal handling", "wear parts", "welding pins"], ["sintering", "hot pressing"]],
  ["Refractory firebrick", "Firebrick", "Ceramics", "Refractory ceramic", ["refractory", "insulation", "heat resistant", "low cost"], ["furnaces", "kilns", "fireplaces", "thermal linings"], ["forming", "firing"]],
  ["Ceramic matrix composite silicon carbide", "SiC/SiC", "Ceramics", "Ceramic matrix composite", ["ultra high temperature", "lightweight", "aerospace", "oxidation resistant"], ["turbine components", "thermal protection", "aerospace hot structures", "brake parts"], ["chemical vapor infiltration", "melt infiltration", "sintering"]]
];

const extraMaterials = [
  ["Acrylonitrile styrene acrylate weatherable grade", "ASA-W", "Engineering plastics", "Styrenic compound", ["weather resistant", "impact resistant", "uv resistant", "outdoor"], ["outdoor enclosures", "automotive trim", "roofing accessories", "garden equipment"], ["injection molding", "extrusion"]],
  ["Flame-retardant ABS", "FR-ABS", "Engineering plastics", "Styrenic compound", ["flame retardant", "impact resistant", "electrical", "housings"], ["electronics housings", "control panels", "enclosures", "appliance parts"], ["injection molding", "compounding"]],
  ["Glass-filled ABS", "GF-ABS", "Engineering plastics", "Styrenic compound", ["stiff", "impact resistant", "dimensional stability", "housings"], ["structural housings", "brackets", "frames", "appliance parts"], ["injection molding", "compounding"]],
  ["High-heat ABS", "HH-ABS", "Engineering plastics", "Styrenic compound", ["heat resistant", "impact resistant", "surface finish", "automotive"], ["automotive interiors", "electronics housings", "appliance parts", "covers"], ["injection molding", "compounding"]],
  ["Flame-retardant polycarbonate", "FR-PC", "Engineering plastics", "Polycarbonate compound", ["flame retardant", "impact resistant", "transparent", "electrical"], ["electrical covers", "lighting parts", "electronics housings", "guards"], ["injection molding", "extrusion"]],
  ["UV-stabilized polycarbonate", "UV-PC", "Engineering plastics", "Polycarbonate compound", ["transparent", "weather resistant", "impact resistant", "outdoor"], ["outdoor glazing", "guards", "lenses", "covers"], ["extrusion", "injection molding"]],
  ["Antistatic polycarbonate", "AS-PC", "Engineering plastics", "Polycarbonate compound", ["antistatic", "impact resistant", "transparent", "electronics"], ["ESD covers", "cleanroom panels", "electronics guards", "fixtures"], ["injection molding", "sheet extrusion"]],
  ["Medical-grade polycarbonate", "Med-PC", "Engineering plastics", "Polycarbonate compound", ["medical", "transparent", "impact resistant", "sterilizable"], ["medical housings", "connectors", "fluid components", "diagnostic devices"], ["injection molding", "extrusion"]],
  ["Food-grade polypropylene", "FG-PP", "Thermoplastics", "Polyolefin", ["food", "lightweight", "chemical resistant", "recyclable"], ["food containers", "closures", "kitchenware", "packaging"], ["injection molding", "thermoforming", "extrusion"]],
  ["Glass-filled polypropylene", "GF-PP", "Engineering plastics", "Polyolefin compound", ["lightweight", "stiff", "automotive", "dimensional stability"], ["brackets", "housings", "automotive carriers", "appliance parts"], ["injection molding", "compounding"]],
  ["Flame-retardant polypropylene", "FR-PP", "Engineering plastics", "Polyolefin compound", ["flame retardant", "lightweight", "electrical", "moldable"], ["electrical housings", "battery parts", "appliance components", "connectors"], ["injection molding", "compounding"]],
  ["Nucleated polypropylene", "Nuc-PP", "Thermoplastics", "Polyolefin", ["stiff", "clarified", "fast crystallization", "packaging"], ["thin-wall packaging", "housewares", "caps", "containers"], ["injection molding", "extrusion"]],
  ["Crosslinked polyethylene", "PEX", "Thermoplastics", "Crosslinked polyolefin", ["pipe", "hot water", "chemical resistant", "tough"], ["plumbing pipe", "radiant heating pipe", "cable insulation", "tubing"], ["extrusion", "crosslinking"]],
  ["Rotomolding polyethylene", "RM-PE", "Thermoplastics", "Polyolefin", ["tough", "chemical resistant", "tank", "moldable"], ["storage tanks", "playground equipment", "bins", "kayaks"], ["rotational molding"]],
  ["High-molecular-weight polyethylene", "HMWPE", "Thermoplastics", "Polyolefin", ["tough", "film", "chemical resistant", "lightweight"], ["films", "liners", "drums", "containers"], ["blow molding", "film extrusion"]],
  ["Nickel alloy C276", "C276", "Metals", "Nickel superalloy", ["chemical resistant", "corrosion resistant", "high strength", "recyclable"], ["chemical reactors", "scrubbers", "valves", "heat exchangers"], ["forging", "machining", "welding"]],
  ["Hastelloy X", "HX", "Metals", "Nickel superalloy", ["heat resistant", "oxidation resistant", "aerospace", "recyclable"], ["gas turbine parts", "combustors", "afterburners", "furnace parts"], ["forming", "welding", "machining"]],
  ["Incoloy 800", "IN800", "Metals", "Nickel iron chromium alloy", ["heat resistant", "oxidation resistant", "chemical resistant", "recyclable"], ["heat exchangers", "furnace parts", "process piping", "heater sheaths"], ["forming", "welding", "machining"]],
  ["Invar 36", "Invar 36", "Metals", "Nickel iron alloy", ["low expansion", "precision", "tooling", "recyclable"], ["precision fixtures", "molds", "metrology frames", "aerospace tools"], ["machining", "forming", "welding"]],
  ["Kovar", "Kovar", "Metals", "Nickel cobalt iron alloy", ["low expansion", "electronics", "glass sealing", "recyclable"], ["hermetic seals", "electronic packages", "feedthroughs", "glass-to-metal seals"], ["stamping", "machining", "brazing"]],
  ["Molybdenum", "Mo", "Metals", "Refractory metal", ["high temperature", "thermal conductivity", "electrical", "recyclable"], ["furnace parts", "electrodes", "heat sinks", "semiconductor parts"], ["powder metallurgy", "machining", "sintering"]],
  ["Tungsten", "W", "Metals", "Refractory metal", ["high temperature", "high density", "wear resistant", "electrical"], ["electrodes", "counterweights", "furnace parts", "radiation shielding"], ["powder metallurgy", "sintering", "machining"]],
  ["Tantalum", "Ta", "Metals", "Refractory metal", ["chemical resistant", "medical", "high temperature", "recyclable"], ["chemical equipment", "capacitors", "medical implants", "heat exchangers"], ["forming", "machining", "welding"]],
  ["Niobium", "Nb", "Metals", "Refractory metal", ["superconducting", "corrosion resistant", "alloying", "recyclable"], ["superconducting magnets", "alloy additions", "chemical equipment", "electronics"], ["forming", "machining", "welding"]],
  ["Cobalt chrome alloy", "CoCr", "Metals", "Cobalt alloy", ["wear resistant", "medical", "corrosion resistant", "high strength"], ["orthopedic implants", "dental parts", "valve seats", "turbine parts"], ["casting", "forging", "additive manufacturing"]],
  ["Cobalt alloy 6", "Stellite 6", "Metals", "Cobalt alloy", ["wear resistant", "corrosion resistant", "hardfacing", "high temperature"], ["valve seats", "cutting tools", "pump sleeves", "hardfacing"], ["welding", "casting", "machining"]],
  ["Ductile iron", "DI", "Metals", "Cast iron", ["castable", "tough", "wear resistant", "structural"], ["pipes", "gears", "housings", "automotive parts"], ["casting", "machining"]],
  ["Gray cast iron", "Gray iron", "Metals", "Cast iron", ["castable", "damping", "machinable", "low cost"], ["machine bases", "engine blocks", "brake rotors", "housings"], ["casting", "machining"]],
  ["White cast iron", "White iron", "Metals", "Cast iron", ["wear resistant", "hard", "abrasion resistant", "castable"], ["mill liners", "crushers", "wear plates", "slurry pumps"], ["casting", "heat treatment"]],
  ["Austempered ductile iron", "ADI", "Metals", "Cast iron", ["strength", "wear resistant", "tough", "castable"], ["gears", "suspension parts", "brackets", "wear components"], ["casting", "austempering", "machining"]],
  ["Carbon fiber vinyl ester pultrusion", "CF-VE pultrusion", "Composites", "Pultruded composite", ["composite", "lightweight", "corrosion resistant", "structural"], ["profiles", "beams", "reinforcement bars", "chemical structures"], ["pultrusion"]],
  ["Aramid honeycomb core", "Aramid honeycomb", "Composites", "Sandwich core", ["lightweight", "impact resistant", "aerospace", "core"], ["aircraft panels", "interior panels", "radomes", "sandwich structures"], ["paper impregnation", "expansion", "bonding"]],
  ["Aluminum honeycomb core", "Al honeycomb", "Composites", "Metallic core", ["lightweight", "stiff", "aerospace", "sandwich"], ["aircraft panels", "doors", "floors", "energy absorbers"], ["foil bonding", "expansion", "machining"]],
  ["Foam core PVC composite", "PVC foam core", "Composites", "Sandwich core", ["lightweight", "marine", "core", "closed cell"], ["boat hulls", "wind blades", "panels", "transport structures"], ["foaming", "machining", "bonding"]],
  ["PET foam core", "PET foam", "Composites", "Sandwich core", ["lightweight", "recyclable", "core", "structural"], ["wind blades", "marine panels", "transport panels", "building panels"], ["foaming", "thermoforming", "bonding"]],
  ["Balsa wood core composite", "Balsa core", "Composites", "Natural core", ["lightweight", "stiff", "sandwich", "bio-based"], ["wind blades", "marine panels", "floor panels", "transport structures"], ["cutting", "bonding", "infusion"]],
  ["Quartz fiber epoxy composite", "QF/EP", "Composites", "Fiber-reinforced polymer", ["low dielectric", "radome", "composite", "heat resistant"], ["radomes", "antenna windows", "aerospace panels", "electronics"], ["prepreg layup", "autoclave cure"]],
  ["Ultra-high molecular weight polyethylene fiber composite", "UHMWPE fiber composite", "Composites", "Ballistic composite", ["impact resistant", "lightweight", "ballistic", "tough"], ["armor panels", "helmets", "protective inserts", "marine rope parts"], ["lamination", "compression molding"]],
  ["Ceramic armor composite", "Ceramic armor", "Composites", "Hybrid composite", ["armor", "impact resistant", "hard", "lightweight"], ["vehicle armor", "body armor", "protective panels", "ballistic tiles"], ["sintering", "bonding", "lamination"]],
  ["Carbon fiber cyanate ester composite", "CF/CE", "Composites", "High-temperature composite", ["low dielectric", "aerospace", "lightweight", "heat resistant"], ["radomes", "satellite structures", "antenna supports", "aerospace panels"], ["prepreg layup", "autoclave cure"]],
  ["Magnesia ceramic", "MgO", "Ceramics", "Oxide ceramic", ["refractory", "electrical insulation", "heat resistant", "chemical resistant"], ["crucibles", "furnace linings", "insulators", "refractory bricks"], ["pressing", "sintering"]],
  ["Calcia-stabilized zirconia", "CSZ", "Ceramics", "Oxide ceramic", ["thermal barrier", "refractory", "ionic conductor", "heat resistant"], ["oxygen sensors", "thermal barriers", "refractory parts", "fuel cells"], ["sintering", "coating"]],
  ["Spinel ceramic", "MgAl2O4", "Ceramics", "Oxide ceramic", ["transparent ceramic", "armor", "heat resistant", "hard"], ["transparent armor", "windows", "optics", "refractories"], ["hot pressing", "sintering", "polishing"]],
  ["Transparent alumina", "PCA", "Ceramics", "Oxide ceramic", ["transparent ceramic", "high purity", "heat resistant", "hard"], ["lamp envelopes", "optical windows", "armor", "sensor windows"], ["sintering", "hot isostatic pressing", "polishing"]],
  ["Silicon oxynitride", "SiON", "Ceramics", "Oxynitride ceramic", ["electronics", "barrier", "insulation", "thin film"], ["semiconductor films", "optical coatings", "barrier layers", "electronics"], ["chemical vapor deposition", "sputtering"]],
  ["Lanthanum strontium manganite", "LSM", "Ceramics", "Conductive ceramic", ["fuel cell", "electrode", "high temperature", "ceramic"], ["solid oxide fuel cells", "electrodes", "sensors", "research components"], ["powder processing", "sintering"]],
  ["Indium tin oxide", "ITO", "Ceramics", "Conductive oxide", ["transparent conductor", "electronics", "coating", "optical"], ["touchscreens", "displays", "solar cells", "transparent electrodes"], ["sputtering", "coating"]],
  ["Zinc oxide ceramic", "ZnO", "Ceramics", "Oxide ceramic", ["semiconductor", "varistor", "electronics", "ceramic"], ["varistors", "sensors", "transparent conductors", "ceramic components"], ["sintering", "pressing"]],
  ["Titanium dioxide ceramic", "TiO2", "Ceramics", "Oxide ceramic", ["dielectric", "pigment", "ceramic", "electronics"], ["dielectric ceramics", "coatings", "pigments", "sensors"], ["sintering", "coating"]],
  ["Lead zirconate titanate hard grade", "Hard PZT", "Ceramics", "Piezoelectric ceramic", ["piezoelectric", "actuator", "sensor", "electronics"], ["ultrasonic transducers", "actuators", "sonar", "industrial sensors"], ["powder processing", "sintering", "poling"]],
  ["Lead zirconate titanate soft grade", "Soft PZT", "Ceramics", "Piezoelectric ceramic", ["piezoelectric", "sensor", "actuator", "electronics"], ["microphones", "actuators", "medical ultrasound", "sensors"], ["powder processing", "sintering", "poling"]]
];

function buildEntries(rows, category) {
  return rows.map(([name, abbr, family, tags, applications, methods]) => entry(name, abbr, category, family, tags, applications, methods));
}

module.exports = [
  ...buildEntries(thermoplastics, "Thermoplastics"),
  ...buildEntries(engineeringPlastics, "Engineering plastics"),
  ...buildEntries(highPerformance, "High-performance polymers"),
  ...buildEntries(thermosets, "Thermosets"),
  ...buildEntries(elastomers, "Elastomers"),
  ...buildEntries(composites, "Composites"),
  ...metals.map(([name, abbr, category, family, tags, applications, methods]) => entry(name, abbr, category, family, tags, applications, methods)),
  ...ceramics.map(([name, abbr, category, family, tags, applications, methods]) => entry(name, abbr, category, family, tags, applications, methods)),
  ...extraMaterials.map(([name, abbr, category, family, tags, applications, methods]) => entry(name, abbr, category, family, tags, applications, methods))
];
