// infra/azure/router/tenant-router.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

// clients/shared/identity-registry/registry.ts
import { readFileSync } from "node:fs";

// clients/shared/identity-registry/guid.ts
var CANONICAL_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isCanonicalGuid(value) {
  return CANONICAL_GUID_PATTERN.test(value);
}

// clients/shared/identity-registry/registry-config.ts
import { z } from "zod";
var HOST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var rawTenantEntrySchema = z.object({
  home: z.string(),
  hostId: z.string(),
  entraOid: z.string().nullable().optional(),
  traycerUserId: z.string().nullable().optional()
});
var rawRegistryConfigSchema = z.object({
  tenants: z.array(rawTenantEntrySchema)
});
function isCleanNonEmpty(value) {
  return value.length > 0 && value === value.trim();
}
function loadRegistryConfig(raw) {
  const parsed = rawRegistryConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "refused",
      reason: `config does not match the expected shape: ${parsed.error.message}`
    };
  }
  const rawTenants = parsed.data.tenants;
  if (rawTenants.length === 0) {
    return {
      kind: "refused",
      reason: "registry is empty — refusing to load rather than let every principal through unmapped"
    };
  }
  const seenHomeLowercase = new Set;
  const seenHostId = new Set;
  const seenEntraOid = new Set;
  const seenTraycerUserId = new Set;
  const tenants = [];
  for (let index = 0;index < rawTenants.length; index += 1) {
    const entry = rawTenants[index];
    const { home, hostId } = entry;
    const entraOid = entry.entraOid ?? null;
    const traycerUserId = entry.traycerUserId ?? null;
    if (!isCleanNonEmpty(home)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].home is empty or has leading/trailing whitespace`
      };
    }
    if (!isCleanNonEmpty(hostId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].hostId is empty or has leading/trailing whitespace`
      };
    }
    if (!HOST_ID_PATTERN.test(hostId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].hostId must match ${HOST_ID_PATTERN.source} — it is exposed downstream as a git branch name segment`
      };
    }
    if (entraOid !== null && !isCleanNonEmpty(entraOid)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].entraOid is empty or has leading/trailing whitespace`
      };
    }
    if (traycerUserId !== null && !isCleanNonEmpty(traycerUserId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].traycerUserId is empty or has leading/trailing whitespace`
      };
    }
    if (entraOid === null && traycerUserId === null) {
      return {
        kind: "refused",
        reason: `tenant[${index}] has neither entraOid nor traycerUserId — an entry must carry at least one alias`
      };
    }
    if (entraOid !== null && !isCanonicalGuid(entraOid)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].entraOid is not a canonical lowercase GUID`
      };
    }
    if (seenHomeLowercase.has(home.toLowerCase())) {
      return {
        kind: "refused",
        reason: `duplicate home at tenant[${index}] (case-insensitive match) — refusing rather than silently merging two tenants onto one directory`
      };
    }
    if (seenHostId.has(hostId)) {
      return { kind: "refused", reason: `duplicate hostId at tenant[${index}]` };
    }
    if (entraOid !== null && seenEntraOid.has(entraOid)) {
      return {
        kind: "refused",
        reason: `duplicate entraOid at tenant[${index}] — the same alias cannot resolve to two tenants`
      };
    }
    if (traycerUserId !== null && seenTraycerUserId.has(traycerUserId)) {
      return {
        kind: "refused",
        reason: `duplicate traycerUserId at tenant[${index}] — the same alias cannot resolve to two tenants`
      };
    }
    seenHomeLowercase.add(home.toLowerCase());
    seenHostId.add(hostId);
    if (entraOid !== null)
      seenEntraOid.add(entraOid);
    if (traycerUserId !== null)
      seenTraycerUserId.add(traycerUserId);
    tenants.push({
      home,
      hostId,
      entraOid: entraOid === null ? null : entraOid,
      traycerUserId: traycerUserId === null ? null : traycerUserId
    });
  }
  return { kind: "loaded", tenants };
}

// clients/shared/identity-registry/audit-log.ts
var MAX_LOGGED_INPUT_LENGTH = 64;
function sanitizeForLog(raw) {
  let stripped = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) {
      stripped += ch;
    }
  }
  return stripped.length > MAX_LOGGED_INPUT_LENGTH ? `${stripped.slice(0, MAX_LOGGED_INPUT_LENGTH)}...(truncated)` : stripped;
}
function emitAuditLine(sink, entry) {
  const safeInput = entry.outcome === "refused" ? sanitizeForLog(entry.input) : entry.input;
  sink(JSON.stringify({ ...entry, input: safeInput }));
}

// clients/shared/identity-registry/registry.ts
class IdentityRegistry {
  byEntraOid = new Map;
  byTraycerUserId = new Map;
  byHostId = new Map;
  auditSink;
  constructor(tenants, auditSink) {
    for (const tenant of tenants) {
      if (tenant.entraOid !== null) {
        this.byEntraOid.set(tenant.entraOid, tenant);
      }
      if (tenant.traycerUserId !== null) {
        this.byTraycerUserId.set(tenant.traycerUserId, tenant);
      }
      this.byHostId.set(tenant.hostId, tenant);
    }
    this.auditSink = auditSink;
  }
  static fromConfig(raw, auditSink) {
    const result = loadRegistryConfig(raw);
    if (result.kind === "refused") {
      throw new Error(`identity registry: refusing to load — ${result.reason}`);
    }
    return new IdentityRegistry(result.tenants, auditSink);
  }
  static fromFile(path, auditSink) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(`identity registry: refusing to load — could not read/parse "${path}": ${describeError(err)}`);
    }
    return IdentityRegistry.fromConfig(raw, auditSink);
  }
  resolveTenant(principal) {
    if (principal.kind === "traycer") {
      const userId = principal.userId;
      if (userId.length === 0) {
        this.audit("forward", "refused", "malformed_principal", userId);
        return { kind: "refused", reason: "malformed_principal" };
      }
      const tenant2 = this.byTraycerUserId.get(userId);
      if (tenant2 === undefined) {
        this.audit("forward", "refused", "unmapped_principal", userId);
        return { kind: "refused", reason: "unmapped_principal" };
      }
      this.audit("forward", "resolved", null, userId);
      return { kind: "resolved", tenant: tenant2 };
    }
    const oid = principal.oid;
    if (!isCanonicalGuid(oid)) {
      this.audit("forward", "refused", "malformed_principal", oid);
      return { kind: "refused", reason: "malformed_principal" };
    }
    const tenant = this.byEntraOid.get(oid);
    if (tenant === undefined) {
      this.audit("forward", "refused", "unmapped_principal", oid);
      return { kind: "refused", reason: "unmapped_principal" };
    }
    this.audit("forward", "resolved", null, oid);
    return { kind: "resolved", tenant };
  }
  resolveIdentity(hostId) {
    const tenant = this.byHostId.get(hostId);
    if (tenant === undefined) {
      this.audit("reverse", "refused", "unmapped_host_id", hostId);
      return { kind: "refused", reason: "unmapped_host_id" };
    }
    this.audit("reverse", "resolved", null, hostId);
    return { kind: "resolved", tenant };
  }
  audit(direction, outcome, reason, input) {
    emitAuditLine(this.auditSink, {
      direction,
      outcome,
      reason,
      input,
      timestampMs: Date.now()
    });
  }
}
function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}

// clients/shared/identity-registry/traycer-principal.ts
var DEFAULT_TRAYCER_VERIFY_TIMEOUT_MS = 1e4;
var DEFAULT_MAX_CONCURRENT_VERIFICATIONS = 32;
var inFlightVerifications = 0;
async function verifyTraycerPrincipal(params) {
  const { bearer, authnBaseUrl, timeoutMs, fetchImpl, maxConcurrent } = params;
  if (bearer.length === 0) {
    return { kind: "failed", reason: "rejected" };
  }
  if (inFlightVerifications >= maxConcurrent) {
    return { kind: "failed", reason: "capacity_exhausted" };
  }
  inFlightVerifications += 1;
  try {
    return await verifyAgainstAuthn(bearer, authnBaseUrl, timeoutMs, fetchImpl);
  } finally {
    inFlightVerifications -= 1;
  }
}
async function verifyAgainstAuthn(bearer, authnBaseUrl, timeoutMs, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(userEndpoint(authnBaseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { kind: "failed", reason: "network_error" };
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return { kind: "failed", reason: "rejected" };
  }
  if (response.status < 200 || response.status >= 300) {
    return { kind: "failed", reason: "network_error" };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { kind: "failed", reason: "malformed_response" };
  }
  const userId = readUserId(body);
  if (userId === null) {
    return { kind: "failed", reason: "malformed_response" };
  }
  return {
    kind: "verified",
    principal: { kind: "traycer", userId }
  };
}
function readUserId(body) {
  if (body === null || typeof body !== "object")
    return null;
  const user = body.user;
  if (user === null || typeof user !== "object")
    return null;
  const id = user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
function userEndpoint(authnBaseUrl) {
  return new URL("api/v3/user", authnBaseUrl.endsWith("/") ? authnBaseUrl : `${authnBaseUrl}/`).toString();
}

// infra/azure/router/tenant-router.ts
function loadConfig(argv, env) {
  const listenPort = Number(argv[2]);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error(`tenant-router: argv[2] must be a valid listen port, got "${argv[2]}"`);
  }
  const registryPath = argv[3];
  if (registryPath === undefined || registryPath.length === 0) {
    throw new Error("tenant-router: argv[3] must be the identity-registry config path");
  }
  const authnBaseUrl = env.TRAYCER_AUTHN_BASE_URL;
  if (authnBaseUrl === undefined || authnBaseUrl.length === 0) {
    throw new Error("tenant-router: TRAYCER_AUTHN_BASE_URL is required (the authn service that vouches for inbound bearers) — refusing to start without it.");
  }
  return {
    listenPort,
    registryPath,
    authnBaseUrl,
    openFrameTimeoutMs: Number(env.TRAYCER_OPEN_FRAME_TIMEOUT_MS ?? 15000)
  };
}
var config = loadConfig(process.argv, process.env);
var registry = IdentityRegistry.fromFile(config.registryPath, (line) => process.stderr.write(`${line}
`));
function hostPortFor(tenant) {
  const pidPath = `${tenant.home}/.traycer/host/pid.json`;
  const raw = JSON.parse(readFileSync2(pidPath, "utf8"));
  if (raw === null || typeof raw !== "object") {
    throw new Error(`pid.json at ${pidPath} is not an object`);
  }
  const websocketUrl = raw.websocketUrl;
  if (typeof websocketUrl !== "string") {
    throw new Error(`pid.json at ${pidPath} has no websocketUrl`);
  }
  const port = Number(new URL(websocketUrl).port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`pid.json at ${pidPath} advertised an unusable port`);
  }
  return port;
}
var httpOrigin = (port) => `http://127.0.0.1:${port}`;
var wsUrl = (port, path) => `ws://127.0.0.1:${port}${path}`;
function bearerFromOpenFrame(data, isBinary) {
  if (isBinary)
    return null;
  let parsed;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object")
    return null;
  const frame = parsed;
  if (frame.kind !== "open")
    return null;
  const token = frame.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}
var CLOSE_POLICY = 1008;
var CLOSE_UNAVAILABLE = 1011;
function auditRefusal(reason, detail) {
  process.stderr.write(`${JSON.stringify({ component: "tenant-router", outcome: "refused", reason, detail, at: new Date().toISOString() })}
`);
}
var server = createServer((_req, res) => {
  res.writeHead(426, { "content-type": "text/plain" });
  res.end(`upgrade required
`);
});
var wss = new WebSocketServer({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6, memLevel: 8 },
    threshold: 1024,
    concurrencyLimit: 10
  }
});
wss.on("connection", (client, req) => {
  const requestPath = req.url ?? "/rpc";
  let upstream = null;
  let routed = false;
  const pending = [];
  let upstreamOpen = false;
  const openFrameTimer = setTimeout(() => {
    if (!routed) {
      auditRefusal("open_frame_timeout", requestPath);
      client.close(CLOSE_POLICY, "no open frame");
    }
  }, config.openFrameTimeoutMs);
  client.on("message", (data, isBinary) => {
    if (routed) {
      if (upstreamOpen && upstream !== null)
        upstream.send(data, { binary: isBinary });
      else
        pending.push({ data, isBinary });
      return;
    }
    routed = true;
    clearTimeout(openFrameTimer);
    const bearer = bearerFromOpenFrame(data, isBinary);
    if (bearer === null) {
      auditRefusal("first_frame_not_open", requestPath);
      client.close(CLOSE_POLICY, "expected open frame");
      return;
    }
    pending.push({ data, isBinary });
    routeConnection(bearer);
  });
  async function routeConnection(bearer) {
    const verification = await verifyTraycerPrincipal({
      bearer,
      authnBaseUrl: config.authnBaseUrl,
      timeoutMs: DEFAULT_TRAYCER_VERIFY_TIMEOUT_MS,
      fetchImpl: fetch,
      maxConcurrent: DEFAULT_MAX_CONCURRENT_VERIFICATIONS
    });
    if (verification.kind !== "verified") {
      auditRefusal(`token_${verification.reason}`, requestPath);
      client.close(CLOSE_POLICY, "unauthorized");
      return;
    }
    const resolution = registry.resolveTenant(verification.principal);
    if (resolution.kind !== "resolved") {
      auditRefusal(`registry_${resolution.reason}`, requestPath);
      client.close(CLOSE_POLICY, "unauthorized");
      return;
    }
    const tenant = resolution.tenant;
    let port;
    try {
      port = hostPortFor(tenant);
    } catch (err) {
      auditRefusal("tenant_host_unavailable", `${tenant.hostId}: ${describe(err)}`);
      client.close(CLOSE_UNAVAILABLE, "host unavailable");
      return;
    }
    process.stderr.write(`${JSON.stringify({ component: "tenant-router", outcome: "routed", hostId: tenant.hostId, port, path: requestPath, at: new Date().toISOString() })}
`);
    upstream = new WebSocket(wsUrl(port, requestPath), {
      perMessageDeflate: false,
      headers: { origin: httpOrigin(port) }
    });
    upstream.on("open", () => {
      upstreamOpen = true;
      for (const frame of pending.splice(0)) {
        upstream?.send(frame.data, { binary: frame.isBinary });
      }
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN)
        client.send(data, { binary: isBinary });
    });
    upstream.on("close", (code) => {
      try {
        client.close(code >= 1000 && code <= 4999 ? code : CLOSE_UNAVAILABLE);
      } catch {}
    });
    upstream.on("error", (err) => {
      process.stderr.write(`[tenant-router] upstream ${tenant.hostId}: ${describe(err)}
`);
      try {
        client.close(CLOSE_UNAVAILABLE, "upstream error");
      } catch {}
    });
  }
  client.on("close", () => {
    clearTimeout(openFrameTimer);
    try {
      upstream?.close();
    } catch {}
  });
  client.on("error", () => {
    clearTimeout(openFrameTimer);
    try {
      upstream?.close();
    } catch {}
  });
});
function describe(err) {
  return err instanceof Error ? err.message : String(err);
}
server.listen(config.listenPort, "127.0.0.1", () => {
  process.stderr.write(`[tenant-router] listening on 127.0.0.1:${String(config.listenPort)}, registry ${config.registryPath}, authn ${config.authnBaseUrl}
`);
});
