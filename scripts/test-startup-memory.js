const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const adminFixture = "AD02_STARTUP_TEST_TOKEN_ONLY";
const auditHeaders = (clientNumber) => ({
  Authorization: `Bearer ${adminFixture}`,
  "X-Forwarded-For": `198.51.100.${clientNumber}`
});

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matfinder-startup-generation-"));
  try { await runFinalizedDatabase(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function runFinalizedDatabase(directory) {
  const databasePath = path.join(directory, "fixture.db");
  fs.copyFileSync(path.join(root, "matfinder.db"), databasePath);
  await require("./build-catalog-stats").buildCatalogStats(databasePath);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      MATFINDER_DB_PATH: databasePath,
      MATFINDER_ADMIN_TOKEN: adminFixture,
      MATFINDER_TRUST_PROXY: "render"
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
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
    const startupDiagnostics = await requestDiagnostics(child);
    assert.ok(
      startupDiagnostics.startupPeak.heapUsed < 120,
      `Startup heapUsed must stay below 120 MB; got ${startupDiagnostics.startupPeak.heapUsed} MB.`
    );
    assert.ok(
      startupDiagnostics.startupPeak.rss < 300,
      `Startup RSS must stay below 300 MB; got ${startupDiagnostics.startupPeak.rss} MB.`
    );
    assert.equal(startupDiagnostics.repository.propertyEvidenceRowsRead, 0);
    assert.equal(startupDiagnostics.repository.fullEvidenceTableReads, 0);
    assert.equal(startupDiagnostics.repository.recommendationRecallCalls, 0);
    assert.equal(startupDiagnostics.repository.recommendationBatches, 0);
    const beforeStats = await requestDiagnostics(child);
    const stats = await requestJson(`${base}/api/catalog-stats`);
    assert.equal(stats.verifiedCommercialGrades, 0);
    assert.ok(stats.generation?.datasetDigest);
    const afterStats = await requestDiagnostics(child);
    assert.deepEqual(afterStats.repository, beforeStats.repository,
      "A verified stats request must not scan/evaluate materials.");

    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /MatFinder AI/);

    const publicSearch = await requestJson(
      `${base}/api/materials?limit=20&offset=0&q=ABS`
    );
    assert.ok(Array.isArray(publicSearch.items));
    assert.ok(publicSearch.items.length <= 20);

    const auditSearch = await requestJson(
      `${base}/api/materials?audit=1&limit=20&offset=0&q=ABS`,
      { headers: auditHeaders(1) }
    );
    assert.ok(auditSearch.items.length > 0);
    assert.ok(auditSearch.items.length <= 20);
    const auditId = auditSearch.items[0].id;

    const detail = await requestJson(
      `${base}/api/materials/${encodeURIComponent(auditId)}?audit=1`,
      { headers: auditHeaders(1) }
    );
    assert.equal(detail.id, auditId);
    assert.ok(detail.evidence?.properties);

    const beforeRecall = await requestDiagnostics(child);
    assert.equal(beforeRecall.repository.recommendationRecallCalls, 0);
    const candidates = await requestJson(
      `${base}/api/recommendation-candidates`
    );
    assert.ok(Array.isArray(candidates.items));
    assert.equal(candidates.total, candidates.items.length);
    assert.equal(candidates.complete, true);
    assert.equal(candidates.bounded, false);
    const afterRecall = await requestDiagnostics(child);
    assert.equal(afterRecall.repository.recommendationRecallCalls, 1);
    assert.ok(afterRecall.repository.maximumRecommendationBatchSize <= 30);

    const beforeRepeatedReads = await requestDiagnostics(child);
    for (let index = 0; index < 25; index += 1) {
      const page = await requestJson(
        `${base}/api/materials?audit=1&limit=20&offset=0&q=ABS`,
        { headers: auditHeaders(10 + (index % 10)) }
      );
      assert.ok(page.items.length <= 20);
      const repeatedDetail = await requestJson(
        `${base}/api/materials/${encodeURIComponent(auditId)}?audit=1`,
        { headers: auditHeaders(10 + (index % 10)) }
      );
      assert.equal(repeatedDetail.id, auditId);
    }
    const afterRepeatedReads = await requestDiagnostics(child);

    assert.equal(afterRepeatedReads.repository.fullEvidenceTableReads, 0);
    assert.ok(
      afterRepeatedReads.repository.propertyEvidenceRowsRead -
        beforeRepeatedReads.repository.propertyEvidenceRowsRead < 1_000,
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
        startupPeakMb: startupDiagnostics.startupPeak,
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

function requestJson(url, options) {
  return fetch(url, options).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${response.status} ${url}: ${JSON.stringify(payload)}`);
    }
    return payload;
  });
}

function requestDiagnostics(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error("Timed out waiting for test-process diagnostics"));
    }, 5_000);
    const onMessage = (message) => {
      if (message?.type !== "test-diagnostics-response") return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message);
    };
    child.on("message", onMessage);
    child.send({ type: "test-diagnostics-request" }, (error) => {
      if (!error) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      reject(error);
    });
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
