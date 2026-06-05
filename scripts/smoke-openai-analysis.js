const fs = require("node:fs");
const path = require("node:path");
const { readMaterials } = require("./read-materials-sqlite");

loadEnvFile(".env.local");

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured");
}

const materials = loadMaterialsFromSqlite();
const material = materials.find((item) => item.id === "peek");

fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  },
  body: JSON.stringify({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "Return strict JSON with keys overview, advantages, limitations, recommendedApplications. Use only provided data."
      },
      {
        role: "user",
        content: JSON.stringify({ material })
      }
    ]
  })
})
  .then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || "OpenAI request failed");
    }

    const parsed = JSON.parse(payload.choices[0].message.content);
    console.log(
      JSON.stringify({
        ok: true,
        keys: Object.keys(parsed),
        overviewLength: String(parsed.overview || "").length,
        advantages: Array.isArray(parsed.advantages) ? parsed.advantages.length : 0
      })
    );
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) return;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    });
}

function loadMaterialsFromSqlite() {
  const rootDir = path.join(__dirname, "..");
  return readMaterials(path.join(rootDir, "matfinder.db"));
}
