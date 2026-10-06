const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");

const publicPaths = [
  "/",
  "/index.html",
  "/styles.css",
  "/config.js",
  "/catalog-search.js",
  "/polymer-families.js",
  "/catalog-layer.js",
  "/recommendation-engine.js",
  "/app.js",
  "/assets/polymer-network.svg"
];

const sensitivePaths = [
  "/.env",
  "/.env.local",
  "/server.js",
  "/material-repository.js",
  "/matfinder.db",
  "/data/",
  "/data/materials-bilingual.json",
  "/scripts/",
  "/docs/",
  "/package.json"
];

const traversalPaths = [
  "/../server.js",
  "/%2e%2e/server.js",
  "/..%2fserver.js",
  "/%2e%2e%2fserver.js",
  "/..%5cserver.js",
  "/assets/..%2f..%2fserver.js",
  "/assets/%2e%2e%5cserver.js",
  "/..%252fserver.js"
];

async function main() {
  const fs = require("node:fs");
  const os = require("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-static-security-"));
  const databasePath = path.join(directory, "fixture.db");
  require("./schema-test-fixtures").copyPreparedFixture(databasePath);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      MATFINDER_DB_PATH: databasePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const results = {};
  try {
    await waitForListening(child, () => stdout, 20_000);

    for (const requestPath of publicPaths) {
      const response = await requestPathSafely(port, requestPath);
      assert.equal(response.statusCode, 200, `${requestPath} must be public.`);
      assert.ok(response.body.length > 0, `${requestPath} must not be empty.`);
      results[requestPath] = response.statusCode;
    }

    const health = await requestPathSafely(port, "/api/health");
    assert.equal(health.statusCode, 200, "The public health API must remain available.");
    assert.equal(JSON.parse(health.body).status, "ok");
    results["/api/health"] = health.statusCode;

    for (const requestPath of [...sensitivePaths, ...traversalPaths]) {
      const response = await requestPathSafely(port, requestPath, true);
      assert.ok(
        response.statusCode === 403 || response.statusCode === 404,
        `${requestPath} must return 403 or 404, not ${response.statusCode}.`
      );
      assert.ok(
        response.body === "Forbidden" || response.body === "Not found",
        `${requestPath} must return only a generic denial response.`
      );
      results[requestPath] = response.statusCode;
    }

    process.stdout.write(`${JSON.stringify(results)}\n`);
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    if (!child.killed) child.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  }

  if (stderr && !/SQLite is an experimental feature/.test(stderr)) {
    process.stderr.write(stderr);
  }
}

function requestPathSafely(port, requestPath, rejectSuccessfulResponse = false) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: "GET",
        headers: { Accept: "text/html,*/*" }
      },
      (response) => {
        if (rejectSuccessfulResponse && response.statusCode === 200) {
          response.destroy();
          reject(new Error(`Sensitive path returned HTTP 200: ${requestPath}`));
          return;
        }

        const chunks = [];
        let byteLength = 0;
        response.on("data", (chunk) => {
          byteLength += chunk.length;
          if (byteLength > 2_000_000) {
            response.destroy();
            reject(new Error(`Unexpectedly large response for ${requestPath}.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
        response.on("error", reject);
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function waitForListening(child, stdout, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (stdout().includes('"phase":"after_http_listen"')) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Server exited before listening:\n${stdout()}`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for server startup:\n${stdout()}`));
      }
    }, 50);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
