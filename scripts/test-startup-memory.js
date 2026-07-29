const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");

async function main() {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      MATFINDER_DB_PATH: path.join(root, "matfinder.db")
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

  try {
    await waitForListening(child, () => stdout, 20_000);
    const base = `http://127.0.0.1:${port}`;
    const startupHealth = await requestJson(`${base}/api/health`);
    assert.equal(startupHealth.status, "ok");
    assert.ok(
      startupHealth.startupPeak.heapUsed < 120,
      `Startup heapUsed must stay below 120 MB; got ${startupHealth.startupPeak.heapUsed} MB.`
    );
    assert.ok(
      startupHealth.startupPeak.rss < 300,
      `Startup RSS must stay below 300 MB; got ${startupHealth.startupPeak.rss} MB.`
    );
    assert.equal(startupHealth.repository.propertyEvidenceRowsRead, 0);
    assert.equal(startupHealth.repository.fullEvidenceTableReads, 0);

    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /MatFinder AI/);

    const publicSearch = await requestJson(
      `${base}/api/materials?limit=20&offset=0&q=ABS`
    );
    assert.ok(Array.isArray(publicSearch.items));
    assert.ok(publicSearch.items.length <= 20);

    const auditSearch = await requestJson(
      `${base}/api/materials?audit=1&limit=20&offset=0&q=ABS`
    );
    assert.ok(auditSearch.items.length > 0);
    assert.ok(auditSearch.items.length <= 20);
    const auditId = auditSearch.items[0].id;

    const detail = await requestJson(
      `${base}/api/materials/${encodeURIComponent(auditId)}?audit=1`
    );
    assert.equal(detail.id, auditId);
    assert.ok(detail.evidence?.properties);

    const candidates = await requestJson(
      `${base}/api/recommendation-candidates?limit=200`
    );
    assert.ok(Array.isArray(candidates.items));
    assert.ok(candidates.items.length <= 200);

    const beforeRepeatedReads = await requestJson(`${base}/api/health`);
    for (let index = 0; index < 25; index += 1) {
      const page = await requestJson(
        `${base}/api/materials?audit=1&limit=20&offset=0&q=ABS`
      );
      assert.ok(page.items.length <= 20);
      const repeatedDetail = await requestJson(
        `${base}/api/materials/${encodeURIComponent(auditId)}?audit=1`
      );
      assert.equal(repeatedDetail.id, auditId);
    }
    const afterRepeatedReads = await requestJson(`${base}/api/health`);

    assert.equal(afterRepeatedReads.repository.fullEvidenceTableReads, 0);
    assert.ok(
      afterRepeatedReads.repository.propertyEvidenceRowsRead < 1_000,
      "Repeated detail reads must remain bounded and never read the full property table."
    );
    assert.ok(
      afterRepeatedReads.repository.maximumRowsInSingleQuery <= 1_000,
      "Every JavaScript result batch must contain at most 1,000 rows."
    );
    assert.ok(
      afterRepeatedReads.memory.heapUsed < 120,
      `Post-request heapUsed must stay below 120 MB; got ${afterRepeatedReads.memory.heapUsed} MB.`
    );
    assert.ok(
      afterRepeatedReads.memory.rss < 300,
      `Post-request RSS must stay below 300 MB; got ${afterRepeatedReads.memory.rss} MB.`
    );
    assert.ok(
      afterRepeatedReads.memory.heapUsed - beforeRepeatedReads.memory.heapUsed < 32,
      "Repeated search and detail reads must not show unbounded heap growth."
    );
    assert.ok(
      afterRepeatedReads.memory.rss - beforeRepeatedReads.memory.rss < 64,
      "Repeated search and detail reads must not show unbounded RSS growth."
    );

    process.stdout.write(
      JSON.stringify({
        startupPeakMb: startupHealth.startupPeak,
        afterRepeatedReadsMb: afterRepeatedReads.memory,
        propertyEvidenceRowsRead:
          afterRepeatedReads.repository.propertyEvidenceRowsRead,
        maximumRowsInSingleQuery:
          afterRepeatedReads.repository.maximumRowsInSingleQuery,
        fullEvidenceTableReads:
          afterRepeatedReads.repository.fullEvidenceTableReads
      }) + "\n"
    );
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    if (!child.killed) child.kill("SIGKILL");
  }

  if (stderr && !/SQLite is an experimental feature/.test(stderr)) {
    process.stderr.write(stderr);
  }
}

function requestJson(url) {
  return fetch(url).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${response.status} ${url}: ${JSON.stringify(payload)}`);
    }
    return payload;
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
