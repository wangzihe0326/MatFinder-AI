const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const apiBaseUrl = String(process.env.MATFINDER_API_BASE_URL || "").replace(/\/$/, "");
const configPath = path.join(rootDir, "config.js");

const content = `window.MatFinderConfig = ${JSON.stringify({ apiBaseUrl }, null, 2)};\n`;
fs.writeFileSync(configPath, content, "utf8");

console.log(`Wrote ${path.relative(rootDir, configPath)} with ${apiBaseUrl || "same-origin API"}.`);
