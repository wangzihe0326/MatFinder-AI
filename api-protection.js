const crypto = require("node:crypto");
const net = require("node:net");

const MAX_BODY_BYTES = 8192;
const MAX_CLIENTS = 5000;
const CACHE_CAPACITY = 250;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_PROMPT_BYTES = 128 * 1024;
const OPENAI_TIMEOUT_MS = 20 * 1000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class TokenBucket {
  constructor(capacity, refillPerMs, now = Date.now) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  check(cost = 1) {
    this.refill();
    if (this.tokens >= cost) return 0;
    return Math.max(1, Math.ceil((cost - this.tokens) / this.refillPerMs / 1000));
  }

  take(cost = 1) {
    const retryAfterSeconds = this.check(cost);
    if (retryAfterSeconds) return retryAfterSeconds;
    this.tokens -= cost;
    return 0;
  }

  refill() {
    const current = this.now();
    if (current <= this.updatedAt) return;
    this.tokens = Math.min(this.capacity, this.tokens + (current - this.updatedAt) * this.refillPerMs);
    this.updatedAt = current;
  }
}

class ClientRegistry {
  constructor({ now = Date.now, maxClients = MAX_CLIENTS } = {}) {
    this.now = now;
    this.maxClients = maxClients;
    this.entries = new Map();
    this.pinned = new Set();
    this.lastCleanup = now();
  }

  bucket(identity, kind, capacity, refillPerMs) {
    const current = this.now();
    if (current - this.lastCleanup >= 60_000) this.cleanup(current);
    let entry = this.entries.get(identity);
    if (!entry) {
      if (this.entries.size >= this.maxClients) this.cleanup(current);
      while (this.entries.size >= this.maxClients) {
        let oldest;
        for (const key of this.entries.keys()) {
          if (!this.pinned.has(key)) {
            oldest = key;
            break;
          }
        }
        if (!oldest) return null;
        this.entries.delete(oldest);
      }
      entry = {};
    }
    let slot = entry[kind];
    if (!slot) {
      slot = { bucket: new TokenBucket(capacity, refillPerMs, this.now), lastUsed: current };
      entry[kind] = slot;
    }
    slot.lastUsed = current;
    this.entries.delete(identity);
    this.entries.set(identity, entry);
    return slot.bucket;
  }

  pin(identity) {
    this.pinned.add(identity);
  }

  unpin(identity) {
    this.pinned.delete(identity);
  }

  cleanup(current = this.now()) {
    for (const [identity, entry] of this.entries) {
      for (const [kind, slot] of Object.entries(entry)) {
        const ttl = kind === "ai" ? 30 * 60_000 : 15 * 60_000;
        if (current - slot.lastUsed >= ttl && !this.pinned.has(identity)) delete entry[kind];
      }
      if (!Object.keys(entry).length && !this.pinned.has(identity)) this.entries.delete(identity);
    }
    this.lastCleanup = current;
  }

  get size() {
    return this.entries.size;
  }
}

function normalizedIp(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64 || !net.isIP(candidate)) return null;
  const mapped = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped && net.isIP(mapped[1]) === 4 ? mapped[1] : candidate.toLowerCase();
}

function clientIdentity(request, trustProxy) {
  const socket = normalizedIp(request.socket?.remoteAddress) || "unknown";
  if (trustProxy !== "render") return socket;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || Buffer.byteLength(forwarded) > 512) return socket;
  const hops = forwarded.split(",");
  if (!hops.length || hops.length > 8) return socket;
  const parsed = hops.map(normalizedIp);
  if (parsed.some((value) => !value)) return socket;
  return parsed[parsed.length - 1];
}

function createAdminAuthenticator(configuredToken) {
  const expected = configuredToken
    ? crypto.createHash("sha256").update(configuredToken).digest()
    : null;
  return (authorization) => {
    if (!expected || typeof authorization !== "string" || authorization.length > 512) return false;
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return false;
    const supplied = crypto.createHash("sha256").update(match[1]).digest();
    return crypto.timingSafeEqual(expected, supplied);
  };
}

function createApiProtection({ now = Date.now, adminToken, trustProxy } = {}) {
  const registry = new ClientRegistry({ now });
  const globalPublic = new TokenBucket(200, 20 / 1000, now);
  const globalAi = new TokenBucket(6, 1 / 60_000, now);
  const authenticate = createAdminAuthenticator(adminToken);

  function takePair(client, global, cost = 1) {
    if (!client) return 60;
    const retry = Math.max(client.check(cost), global.check(cost));
    if (retry) return retry;
    client.take(cost);
    global.take(cost);
    return 0;
  }

  return {
    registry,
    identity: (request) => clientIdentity(request, trustProxy),
    publicGet(identity, weight) {
      const client = registry.bucket(identity, "public", 30, 2 / 1000);
      return takePair(client, globalPublic, weight);
    },
    admin(identity, authorization) {
      if (!authenticate(authorization)) {
        const failed = registry.bucket(identity, "failed", 3, 1 / 60_000);
        const retryAfterSeconds = failed?.take() || 0;
        return retryAfterSeconds ? { status: 429, retryAfterSeconds } : { status: 401 };
      }
      const client = registry.bucket(identity, "admin", 10, 1 / 1000);
      const retryAfterSeconds = client?.take() || (client ? 0 : 60);
      return retryAfterSeconds ? { status: 429, retryAfterSeconds } : { status: 200 };
    },
    aiClient(identity) {
      const client = registry.bucket(identity, "ai", 3, 1 / 120_000);
      return client?.take() || (client ? 0 : 120);
    },
    aiGlobal() {
      return globalAi.take();
    },
    aiGlobalRetry() {
      return globalAi.check();
    }
  };
}

function readJsonBody(request) {
  const contentType = String(request.headers["content-type"] || "");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new ApiError(415, "Unsupported Content-Type");
  }
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(String(contentLength))) throw new ApiError(400, "Invalid Content-Length");
    if (Number(contentLength) > MAX_BODY_BYTES) throw new ApiError(413, "Request body too large");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      request.pause();
      reject(error);
    };
    request.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) return fail(new ApiError(413, "Request body too large"));
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        settled = true;
        resolve(value);
      } catch {
        fail(new ApiError(400, "Invalid JSON body"));
      }
    });
    request.on("aborted", () => fail(new ApiError(400, "Request aborted")));
    request.on("error", () => fail(new ApiError(400, "Request aborted")));
  });
}

function validateId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && value.trim() === value;
}

function validateAiBody(type, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Invalid JSON body");
  }
  const allowed = type === "analysis" ? ["materialId", "language"] : ["materialIds", "language"];
  if (Object.keys(body).length !== 2 || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "Invalid AI request fields");
  }
  if (body.language !== "zh" && body.language !== "en") {
    throw new ApiError(400, "Invalid language");
  }
  if (type === "analysis") {
    if (!validateId(body.materialId)) throw new ApiError(400, "Invalid materialId");
    return { materialIds: [body.materialId], language: body.language };
  }
  if (!Array.isArray(body.materialIds) || body.materialIds.length !== 2 ||
      !body.materialIds.every(validateId) || body.materialIds[0] === body.materialIds[1]) {
    throw new ApiError(400, "Exactly two distinct materialIds are required");
  }
  return { materialIds: body.materialIds, language: body.language };
}

class AiCoordinator {
  constructor({ now = Date.now, schedule = setTimeout, cancel = clearTimeout, protection } = {}) {
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.protection = protection;
    this.cache = new Map();
    this.inflight = new Map();
    this.activeByClient = new Map();
    this.activeGlobal = 0;
  }

  cached(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (this.now() >= item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  store(key, value) {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: this.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_CAPACITY) this.cache.delete(this.cache.keys().next().value);
  }

  async run({ key, identity, response, task }) {
    if (response.destroyed) throw new ApiError(499, "Client disconnected");
    const cached = this.cached(key);
    if (cached) return cached;
    let entry = this.inflight.get(key);
    const activeKey = this.activeByClient.get(identity);
    if (activeKey && activeKey !== key) throw new ApiError(429, "Rate limit exceeded");
    if (!entry) {
      if (this.activeGlobal >= 2) throw new ApiError(429, "Rate limit exceeded");
      const retryAfterSeconds = this.protection.aiGlobalRetry();
      if (retryAfterSeconds) {
        const error = new ApiError(429, "Rate limit exceeded");
        error.retryAfterSeconds = retryAfterSeconds;
        throw error;
      }
      this.protection.aiGlobal();
      this.activeGlobal++;
      const controller = new AbortController();
      entry = { controller, subscribers: new Set(), reason: null, promise: null, timer: null };
      this.inflight.set(key, entry);
      entry.timer = this.schedule(() => {
        entry.reason = "timeout";
        controller.abort();
      }, OPENAI_TIMEOUT_MS);
      entry.promise = Promise.resolve().then(() => task(controller.signal)).then((result) => {
        if (controller.signal.aborted) throw new Error("OpenAI request aborted");
        this.store(key, result);
        return result;
      }).catch((error) => {
        if (entry.reason === "timeout") throw new ApiError(504, "AI request timed out");
        if (entry.reason === "disconnect") throw new ApiError(499, "Client disconnected");
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "AI service unavailable");
      }).finally(() => {
        this.cancel(entry.timer);
        this.inflight.delete(key);
        this.activeGlobal--;
        for (const subscriber of entry.subscribers) this.protection.registry.unpin(subscriber.identity);
        for (const [client, clientKey] of this.activeByClient) {
          if (clientKey === key) this.activeByClient.delete(client);
        }
      });
    }
    if (entry.subscribers.size >= 32) throw new ApiError(429, "Rate limit exceeded");
    const subscriber = { identity };
    entry.subscribers.add(subscriber);
    this.activeByClient.set(identity, key);
    this.protection.registry.pin(identity);
    const onClose = () => {
      entry.subscribers.delete(subscriber);
      if (![...entry.subscribers].some((item) => item.identity === identity)) {
        this.activeByClient.delete(identity);
        this.protection.registry.unpin(identity);
      }
      if (!entry.subscribers.size && !entry.controller.signal.aborted) {
        entry.reason = "disconnect";
        entry.controller.abort();
      }
    };
    response.once("close", onClose);
    try {
      return await entry.promise;
    } finally {
      response.removeListener("close", onClose);
      entry.subscribers.delete(subscriber);
      if (![...entry.subscribers].some((item) => item.identity === identity)) {
        this.activeByClient.delete(identity);
        this.protection.registry.unpin(identity);
      }
    }
  }
}

module.exports = {
  ApiError,
  AiCoordinator,
  ClientRegistry,
  TokenBucket,
  MAX_BODY_BYTES,
  MAX_PROMPT_BYTES,
  OPENAI_TIMEOUT_MS,
  clientIdentity,
  createAdminAuthenticator,
  createApiProtection,
  readJsonBody,
  validateAiBody
};
