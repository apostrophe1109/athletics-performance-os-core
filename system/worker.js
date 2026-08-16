/**
 * Athletics Performance OS - Cloudflare Worker Gateway
 * Version: 1.4.10
 *
 * Required Worker secrets:
 *   APOS_APPS_SCRIPT_URL
 *   APOS_CLIENT_TOKEN
 *   APOS_GATEWAY_HMAC_SECRET
 *   APOS_GITHUB_TOKEN            site UI / source更新時
 *   APOS_WEB_PASSWORD            private web site login password
 *   APOS_WEB_SESSION_SECRET      32+ character session signing secret
 *
 * Optional variables for the private web site:
 *   APOS_ALLOWED_ORIGINS       comma-separated https origins
 *   APOS_ACCESS_TEAM_DOMAIN    example: your-team.cloudflareaccess.com
 *   APOS_ACCESS_AUD            Cloudflare Access application audience
 *   APOS_ALLOWED_EMAILS        comma-separated allowlist
 *   APOS_ENVIRONMENT           production / staging
 *   APOS_GITHUB_OWNER          example: apostrophe1109
 *   APOS_GITHUB_REPO           example: athletics-performance-os-core
 *   APOS_GITHUB_BRANCH         default: main
 *   APOS_SITE_LAYOUT_PATH      default: site/ui-layout.json
 *   APOS_SITE_SOURCE_ROOT      default: site
 *   APOS_SITE_PUBLIC_URL       default: current APOS View URL
 *
 * Never place secret values directly in this source file.
 */

const VERSION = "1.4.10";
const GATEWAY_PROTOCOL = "APOS-HMAC-SHA256-V1";
const MAX_BODY_CHARS = 700000;
const BACKEND_READ_TIMEOUT_MS = 25000;
const BACKEND_WRITE_TIMEOUT_MS = 38000;
const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;
const WEB_LOGIN_MAX_FAILURES = 8;
const WEB_LOGIN_WINDOW_MS = 15 * 60 * 1000;

const webLoginFailures = new Map();
const approvalNonceCache = new Map();
const APPROVAL_NONCE_TTL_MS = 6 * 60 * 60 * 1000;

const ALLOWED_ACTIONS = new Set([
  "health",
  "inventory",
  "validateSchema",
  "getProposalRequirements",
  "getRecords",
  "getRecord",
  "searchExercises",
  "getTrainingContext",
  "getTodaySession",
  "getExerciseGuide",
  "getSiteLayout",
  "previewSiteLayoutChange",
  "applySiteLayoutChange",
  "getSiteSourceTree",
  "getSiteSourceFile",
  "previewSiteSourceChange",
  "applySiteSourceChange",
  "getSiteDeploymentStatus",
  "previewSiteSourceRollback",
  "applySiteSourceRollback",
  "previewMutation",
  "applyMutation",
  "previewBatch",
  "applyBatch",
  "previewRollback",
  "applyRollback",
  "previewBackup",
  "createBackup",
  "getMaintenanceCapabilities",
  "maintenanceRead",
  "maintenancePreview",
  "maintenanceApply",
]);

const READ_ACTIONS = new Set([
  "health",
  "inventory",
  "validateSchema",
  "getProposalRequirements",
  "getRecords",
  "getRecord",
  "searchExercises",
  "getTrainingContext",
  "getTodaySession",
  "getExerciseGuide",
  "getSiteLayout",
  "previewSiteLayoutChange",
  "getSiteSourceTree",
  "getSiteSourceFile",
  "previewSiteSourceChange",
  "getSiteDeploymentStatus",
  "previewSiteSourceRollback",
  "previewMutation",
  "previewBatch",
  "previewRollback",
  "previewBackup",
  "getMaintenanceCapabilities",
  "maintenanceRead",
  "maintenancePreview",
]);

const WEB_READ_ACTIONS = new Set([
  "health",
  "getRecords",
  "getRecord",
  "searchExercises",
  "getTrainingContext",
  "getTodaySession",
  "getExerciseGuide",
  "getSiteLayout",
]);

let accessJwksCache = { domain: null, expiresAt: 0, keys: [] };

export default {
  async fetch(request, env, ctx) {
    const requestId = sanitizeRequestId(request.headers.get("x-request-id")) || `REQ_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env);

    try {
      if (request.method === "OPTIONS") {
        if (origin && !isAllowedOrigin(origin, env)) return json({ success: false, code: "ORIGIN_NOT_ALLOWED" }, 403, requestId, cors);
        return new Response(null, { status: 204, headers: securityHeaders(cors) });
      }

      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/auth/login") {
        if (origin && !isAllowedOrigin(origin, env)) return json({ success: false, code: "ORIGIN_NOT_ALLOWED" }, 403, requestId, cors);
        return handleWebLogin(request, env, requestId, cors);
      }
      if (request.method === "POST" && url.pathname === "/auth/verify") {
        if (origin && !isAllowedOrigin(origin, env)) return json({ success: false, code: "ORIGIN_NOT_ALLOWED" }, 403, requestId, cors);
        const auth = await authenticateWebSession(request, env);
        return auth.ok
          ? json({ success: true, expiresAt: auth.expiresAt }, 200, requestId, cors)
          : json({ success: false, code: "UNAUTHORIZED", error: "セッションが無効です。" }, 401, requestId, cors);
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        const auth = await authenticate(request, env);
        if (!auth.ok) return json({ success: false, code: "UNAUTHORIZED", error: "認証に失敗しました。" }, 401, requestId, cors);
        return handleHealth(env, requestId, cors);
      }
      if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED", error: "POSTを使用してください。" }, 405, requestId, cors);
      if (origin && !isAllowedOrigin(origin, env)) return json({ success: false, code: "ORIGIN_NOT_ALLOWED", error: "許可されていないOriginです。" }, 403, requestId, cors);

      const auth = await authenticate(request, env);
      if (!auth.ok) return json({ success: false, code: "UNAUTHORIZED", error: "認証に失敗しました。" }, 401, requestId, cors);

      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > MAX_BODY_CHARS) return json({ success: false, code: "REQUEST_TOO_LARGE" }, 413, requestId, cors);
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return json({ success: false, code: "REQUEST_TOO_LARGE" }, 413, requestId, cors);
      let body;
      try { body = raw ? JSON.parse(raw) : {}; }
      catch { return json({ success: false, code: "INVALID_JSON", error: "JSONを解析できません。" }, 400, requestId, cors); }
      if (!isPlainObject(body)) return json({ success: false, code: "REQUEST_BODY_INVALID", error: "JSON objectを指定してください。" }, 400, requestId, cors);

      const pathAction = actionFromPath(url.pathname);
      const action = pathAction || String(body.action || "");
      if (!ALLOWED_ACTIONS.has(action)) return json({ success: false, code: "UNKNOWN_ACTION", error: "未対応のactionです。" }, 400, requestId, cors);
      if (auth.source === "WEB_SESSION" && !WEB_READ_ACTIONS.has(action)) {
        return json({ success: false, code: "WEB_READ_ONLY", error: "Webセッションでは読み取り専用操作だけを使用できます。" }, 403, requestId, cors);
      }
      if (action === "health") return handleHealth(env, requestId, cors);

      delete body.action;
      delete body._backendToken;
      delete body._actor;
      delete body._requestId;
      delete body._source;
      delete body.signature;
      delete body.bodyHash;
      if (action === "getSiteLayout") return json(await getSiteLayout(env), 200, requestId, cors);
      if (action === "previewSiteLayoutChange") return json(await previewSiteLayoutChange(body, auth, env), 200, requestId, cors);
      if (action === "applySiteLayoutChange") return json(await applySiteLayoutChange(body, auth, env), 200, requestId, cors);
      if (action === "getSiteSourceTree") return json(await getSiteSourceTree(body, env), 200, requestId, cors);
      if (action === "getSiteSourceFile") return json(await getSiteSourceFile(body, env), 200, requestId, cors);
      if (action === "previewSiteSourceChange") return json(await previewSiteSourceChange(body, auth, env), 200, requestId, cors);
      if (action === "applySiteSourceChange") return json(await applySiteSourceChange(body, auth, env), 200, requestId, cors);
      if (action === "getSiteDeploymentStatus") return json(await getSiteDeploymentStatus(body, env), 200, requestId, cors);
      if (action === "previewSiteSourceRollback") return json(await previewSiteSourceRollback(body, auth, env), 200, requestId, cors);
      if (action === "applySiteSourceRollback") return json(await applySiteSourceRollback(body, auth, env), 200, requestId, cors);
      if (action === "getMaintenanceCapabilities") return json(await getMaintenanceCapabilities(env), 200, requestId, cors);
      if (action === "maintenanceRead") return json(await maintenanceRead(body, auth, env), 200, requestId, cors);
      if (action === "maintenancePreview") return json(await maintenancePreview(body, auth, env), 200, requestId, cors);
      if (action === "maintenanceApply") return json(await maintenanceApply(body, auth, env), 200, requestId, cors);
      const backend = await callAppsScript(action, body, { id: auth.actor, source: auth.source }, env, READ_ACTIONS.has(action), requestId);
      const status = backend.success === false ? backendStatus(backend.code) : 200;
      return json(backend, status, requestId, cors);
    } catch (error) {
      console.error(JSON.stringify({ requestId, code: error.code || "WORKER_ERROR", message: String(error.message || error) }));
      return json({ success: false, code: error.code || "WORKER_ERROR", error: safeErrorMessage(error) }, error.status || 500, requestId, cors);
    }
  },
};

async function handleHealth(env, requestId, cors) {
  const configured = {
    appsScriptUrl: Boolean(env.APOS_APPS_SCRIPT_URL),
    clientToken: typeof env.APOS_CLIENT_TOKEN === "string" && env.APOS_CLIENT_TOKEN.length >= 32,
    gatewayHmac: typeof env.APOS_GATEWAY_HMAC_SECRET === "string" && env.APOS_GATEWAY_HMAC_SECRET.length >= 32,
    access: Boolean(env.APOS_ACCESS_TEAM_DOMAIN && env.APOS_ACCESS_AUD),
    webAuth: Boolean(env.APOS_WEB_PASSWORD && typeof env.APOS_WEB_SESSION_SECRET === "string" && env.APOS_WEB_SESSION_SECRET.length >= 32),
    githubRepository: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO),
    githubWriteToken: Boolean(env.APOS_GITHUB_TOKEN),
    siteLayoutRead: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO),
    siteLayoutWrite: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO && env.APOS_GITHUB_TOKEN),
    siteSourceRead: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO),
    siteSourceWrite: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO && env.APOS_GITHUB_TOKEN),
    siteDeployVerify: Boolean(sitePublicUrl(env)),
    maintenanceRead: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO),
    maintenanceWrite: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO && env.APOS_GITHUB_TOKEN),
    maintenanceDeployObserve: Boolean(env.APOS_GITHUB_OWNER && env.APOS_GITHUB_REPO && env.APOS_GITHUB_TOKEN),
  };
  configured.clientAuth = configured.clientToken || configured.access || configured.webAuth;

  const missingForCore = [];
  if (!configured.appsScriptUrl) missingForCore.push("APOS_APPS_SCRIPT_URL");
  if (!configured.gatewayHmac) missingForCore.push("APOS_GATEWAY_HMAC_SECRET");
  if (!configured.clientAuth) missingForCore.push("APOS_CLIENT_TOKEN_OR_ACCESS_OR_WEB_AUTH");

  const missingForSiteRead = [];
  if (!env.APOS_GITHUB_OWNER) missingForSiteRead.push("APOS_GITHUB_OWNER");
  if (!env.APOS_GITHUB_REPO) missingForSiteRead.push("APOS_GITHUB_REPO");

  const missingForSiteWrite = [...missingForSiteRead];
  if (!env.APOS_GITHUB_TOKEN) missingForSiteWrite.push("APOS_GITHUB_TOKEN");

  const missingConfigurationNames = [...new Set([
    ...missingForCore,
    ...missingForSiteWrite,
  ])];

  const configurationRequirements = {
    coreRequired: ["APOS_APPS_SCRIPT_URL", "APOS_GATEWAY_HMAC_SECRET"],
    clientAuthenticationAnyOf: ["APOS_CLIENT_TOKEN", "APOS_ACCESS_TEAM_DOMAIN+APOS_ACCESS_AUD", "APOS_WEB_PASSWORD+APOS_WEB_SESSION_SECRET"],
    githubRequiredForRead: ["APOS_GITHUB_OWNER", "APOS_GITHUB_REPO"],
    githubRequiredForWrite: ["APOS_GITHUB_OWNER", "APOS_GITHUB_REPO", "APOS_GITHUB_TOKEN"],
    variablesWithDefaults: ["APOS_GITHUB_BRANCH", "APOS_SITE_LAYOUT_PATH", "APOS_SITE_SOURCE_ROOT", "APOS_SITE_PUBLIC_URL", "APOS_MAINTENANCE_SOURCE_ROOT"],
    optionalAccessControls: ["APOS_ALLOWED_ORIGINS", "APOS_ACCESS_TEAM_DOMAIN", "APOS_ACCESS_AUD", "APOS_ALLOWED_EMAILS", "APOS_ENVIRONMENT"],
  };

  const configStatus = {
    core: missingForCore.length ? "INCOMPLETE" : "READY",
    siteRead: missingForSiteRead.length ? "INCOMPLETE" : "READY",
    siteWrite: missingForSiteWrite.length ? "INCOMPLETE" : "READY",
    maintenance: missingForSiteWrite.length ? "INCOMPLETE" : "READY",
  };

  if (missingForCore.length) {
    return json({
      success: false,
      status: "CONFIG_INCOMPLETE",
      workerVersion: VERSION,
      configured,
      configStatus,
      missingConfigurationNames,
      missingFor: { core: missingForCore, siteRead: missingForSiteRead, siteWrite: missingForSiteWrite },
      configurationRequirements,
    }, 503, requestId, cors);
  }

  try {
    const backend = await callAppsScript("health", {}, { id: "worker-health", source: "WORKER_HEALTH" }, env, true, requestId);
    return json({
      success: backend.success !== false,
      status: backend.status || "UNKNOWN",
      workerVersion: VERSION,
      deploymentCommit: typeof env.APOS_DEPLOY_COMMIT === "string" ? env.APOS_DEPLOY_COMMIT : null,
      environment: env.APOS_ENVIRONMENT || "unset",
      configured,
      configStatus,
      missingConfigurationNames,
      missingFor: { core: missingForCore, siteRead: missingForSiteRead, siteWrite: missingForSiteWrite },
      configurationRequirements,
      backend,
    }, backend.success === false ? 502 : 200, requestId, cors);
  } catch (error) {
    return json({
      success: false,
      status: "BACKEND_UNREACHABLE",
      workerVersion: VERSION,
      configured,
      configStatus,
      missingConfigurationNames,
      missingFor: { core: missingForCore, siteRead: missingForSiteRead, siteWrite: missingForSiteWrite },
      configurationRequirements,
      backendError: safeErrorMessage(error),
    }, 502, requestId, cors);
  }
}

function assertApprovalNonceUnused(nonce) {
  const now = Date.now();
  for (const [key, expiresAt] of approvalNonceCache.entries()) {
    if (expiresAt <= now) approvalNonceCache.delete(key);
  }
  const normalized = String(nonce || "");
  if (approvalNonceCache.has(normalized)) {
    throw Object.assign(new Error("nonceは既に使用されています。"), { code: "APPROVAL_NONCE_REUSED", status: 409 });
  }
}

function markApprovalNonceUsed(nonce) {
  approvalNonceCache.set(String(nonce || ""), Date.now() + APPROVAL_NONCE_TTL_MS);
}

async function authenticate(request, env) {
  const token = extractClientToken(request);
  if (token && typeof env.APOS_CLIENT_TOKEN === "string" && env.APOS_CLIENT_TOKEN.length >= 32 && await secureEqual(token, env.APOS_CLIENT_TOKEN)) {
    return { ok: true, actor: sanitizeActor(request.headers.get("x-apos-actor") || "apostrophe"), source: "API_TOKEN" };
  }

  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (jwt && env.APOS_ACCESS_TEAM_DOMAIN && env.APOS_ACCESS_AUD) {
    const identity = await verifyAccessJwt(jwt, env);
    if (identity.ok) return { ok: true, actor: identity.email || "cloudflare-access-user", source: "CLOUDFLARE_ACCESS" };
  }
  const webSession = await authenticateWebSession(request, env);
  if (webSession.ok) return { ok: true, actor: "site-read-view", source: "WEB_SESSION" };
  return { ok: false };
}

async function handleWebLogin(request, env, requestId, cors) {
  if (!env.APOS_WEB_PASSWORD || !env.APOS_WEB_SESSION_SECRET || String(env.APOS_WEB_SESSION_SECRET).length < 32) {
    return json({ success: false, code: "WEB_AUTH_NOT_CONFIGURED", error: "Web認証が設定されていません。" }, 503, requestId, cors);
  }
  const key = clientRateLimitKey(request);
  const current = webLoginFailures.get(key);
  if (current && current.resetAt > Date.now() && current.count >= WEB_LOGIN_MAX_FAILURES) {
    return json({ success: false, code: "TOO_MANY_ATTEMPTS", error: "試行回数が上限に達しました。15分後に再試行してください。" }, 429, requestId, cors);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, code: "INVALID_JSON", error: "JSONを解析できません。" }, 400, requestId, cors); }
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !await secureEqual(password, String(env.APOS_WEB_PASSWORD))) {
    recordLoginFailure(key);
    return json({ success: false, code: "INVALID_CREDENTIALS", error: "パスフレーズが正しくありません。" }, 401, requestId, cors);
  }
  webLoginFailures.delete(key);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + WEB_SESSION_TTL_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ v: 1, iat: now, exp: expiresAt, scope: "site:read" }));
  const signature = await hmacBase64Url(payload, String(env.APOS_WEB_SESSION_SECRET));
  return json({ success: true, token: `${payload}.${signature}`, expiresAt }, 200, requestId, cors);
}

async function authenticateWebSession(request, env) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^WebSession\s+(.+)$/i);
    if (!match || !env.APOS_WEB_SESSION_SECRET) return { ok: false };
    const [payloadPart, signaturePart, extra] = match[1].trim().split(".");
    if (!payloadPart || !signaturePart || extra) return { ok: false };
    const expected = await hmacBase64Url(payloadPart, String(env.APOS_WEB_SESSION_SECRET));
    if (!await secureEqual(signaturePart, expected)) return { ok: false };
    const payload = JSON.parse(base64UrlText(payloadPart));
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || payload.scope !== "site:read" || !payload.exp || payload.exp <= now) return { ok: false };
    return { ok: true, expiresAt: payload.exp };
  } catch {
    return { ok: false };
  }
}

function clientRateLimitKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function recordLoginFailure(key) {
  const now = Date.now();
  const current = webLoginFailures.get(key);
  const next = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + WEB_LOGIN_WINDOW_MS }
    : { count: current.count + 1, resetAt: current.resetAt };
  webLoginFailures.set(key, next);
  if (webLoginFailures.size > 1000) {
    for (const [entryKey, value] of webLoginFailures) if (value.resetAt <= now) webLoginFailures.delete(entryKey);
  }
}

async function hmacBase64Url(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signed));
}

function base64UrlEncode(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function extractClientToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1]?.trim()
    || request.headers.get("x-apos-gateway-token")?.trim()
    || request.headers.get("x-api-key")?.trim()
    || null;
}

async function verifyAccessJwt(jwt, env) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return { ok: false };
    const header = JSON.parse(base64UrlText(parts[0]));
    const payload = JSON.parse(base64UrlText(parts[1]));
    if (header.alg !== "RS256" || !header.kid) return { ok: false };
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now + 60)) return { ok: false };
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(env.APOS_ACCESS_AUD)) return { ok: false };

    const domain = normalizeTeamDomain(env.APOS_ACCESS_TEAM_DOMAIN);
    const expectedIssuer = `https://${domain}`;
    if (!payload.iss || payload.iss.replace(/\/$/, "") !== expectedIssuer) return { ok: false };
    const keys = await accessJwks(domain);
    const jwk = keys.find(key => key.kid === header.kid);
    if (!jwk) return { ok: false };
    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!verified) return { ok: false };
    const email = String(payload.email || payload.common_name || "").toLowerCase();
    const allowed = csv(env.APOS_ALLOWED_EMAILS).map(value => value.toLowerCase());
    if (allowed.length && !allowed.includes(email)) return { ok: false };
    return { ok: true, email };
  } catch {
    return { ok: false };
  }
}

async function accessJwks(domain) {
  if (accessJwksCache.domain === domain && accessJwksCache.expiresAt > Date.now() && accessJwksCache.keys.length) return accessJwksCache.keys;
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw Object.assign(new Error("Cloudflare Access公開鍵を取得できません。"), { code: "ACCESS_CERTS_FAILED", status: 502 });
  const data = await response.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (!keys.length) throw Object.assign(new Error("Cloudflare Access公開鍵が空です。"), { code: "ACCESS_CERTS_EMPTY", status: 502 });
  accessJwksCache = { domain, expiresAt: Date.now() + 3600000, keys };
  return keys;
}

function siteRepositoryConfig(env) {
  return {
    owner: requiredEnv(env, "APOS_GITHUB_OWNER"),
    repo: requiredEnv(env, "APOS_GITHUB_REPO"),
    branch: String(env.APOS_GITHUB_BRANCH || "main"),
    path: String(env.APOS_SITE_LAYOUT_PATH || "site/ui-layout.json").replace(/^\/+/, ""),
  };
}

function githubContentsUrl(config) {
  const path = config.path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
}

function githubHeaders(env, write = false) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "Athletics-Performance-OS/1.4.2",
    "x-github-api-version": "2022-11-28",
  };
  if (env.APOS_GITHUB_TOKEN) headers.authorization = `Bearer ${env.APOS_GITHUB_TOKEN}`;
  if (write && !env.APOS_GITHUB_TOKEN) throw Object.assign(new Error("APOS_GITHUB_TOKENが設定されていません。"), { code: "WORKER_CONFIG_MISSING", status: 503 });
  return headers;
}

async function readGitHubLayout(env) {
  const config = siteRepositoryConfig(env);
  const response = await fetch(githubContentsUrl(config), { headers: githubHeaders(env) });
  if (!response.ok) throw Object.assign(new Error(`GitHub layout取得に失敗しました (${response.status})。`), { code: "SITE_LAYOUT_READ_FAILED", status: 502 });
  const payload = await response.json();
  if (!payload || !payload.sha || !payload.content) throw Object.assign(new Error("GitHub layout応答が不正です。"), { code: "SITE_LAYOUT_RESPONSE_INVALID", status: 502 });
  let layout;
  try { layout = JSON.parse(base64Utf8Decode(String(payload.content).replace(/\s/g, ""))); }
  catch { throw Object.assign(new Error("ui-layout.jsonを解析できません。"), { code: "SITE_LAYOUT_JSON_INVALID", status: 502 }); }
  validateSiteLayout(layout);
  return { config, sha: String(payload.sha), layout };
}

async function getSiteLayout(env) {
  const current = await readGitHubLayout(env);
  return {
    success: true,
    status: "READY",
    layout: current.layout,
    layoutHash: await sha256Hex(canonicalJson(current.layout)),
    repository: { owner: current.config.owner, repo: current.config.repo, branch: current.config.branch, path: current.config.path },
    writePerformed: false,
  };
}

async function previewSiteLayoutChange(body, auth, env) {
  const layout = body.layout;
  validateSiteLayout(layout);
  const current = await readGitHubLayout(env);
  const now = new Date();
  const lockedPreview = {
    previewType: "SITE_LAYOUT",
    previewId: `SITEPREVIEW_${crypto.randomUUID()}`,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    requestedBy: auth.actor,
    repository: { owner: current.config.owner, repo: current.config.repo, branch: current.config.branch, path: current.config.path },
    currentGitHubSha: current.sha,
    currentLayoutHash: await sha256Hex(canonicalJson(current.layout)),
    proposedLayoutHash: await sha256Hex(canonicalJson(layout)),
    proposedLayout: layout,
    changeReason: String(body.changeReason || "").trim(),
  };
  if (!lockedPreview.changeReason) throw Object.assign(new Error("changeReasonが必要です。"), { code: "CHANGE_REASON_REQUIRED", status: 400 });
  const lockedText = canonicalJson(lockedPreview);
  const approvalHash = await hmacSha256Hex(lockedText, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  const lockedPreviewToken = await createLockedPreviewToken(lockedText, env);
  return {
    success: true,
    status: "AWAITING_EXPLICIT_APPROVAL",
    currentLayout: current.layout,
    proposedLayout: layout,
    lockedPreview,
    lockedPreviewToken,
    lockedPreviewTokenVersion: "v2",
    lockedPreviewTokenChars: lockedPreviewToken.length,
    approvalHash,
    finalApprover: "山下祐樹",
    writePerformed: false,
  };
}

async function applySiteLayoutChange(body, auth, env) {
  const resolved = await resolveLockedPreview(body, "SITE_LAYOUT", env);
  const locked = resolved.locked;
  const approval = body.approval || {};
  if (approval.approved !== true || approval.approvedBy !== "山下祐樹") throw Object.assign(new Error("山下祐樹の明示承認が必要です。"), { code: "APPROVER_MISMATCH", status: 401 });
  if (String(approval.changeReason || "").trim().length < 3 || !/^[A-Za-z0-9_-]{16,128}$/.test(String(approval.nonce || ""))) {
    throw Object.assign(new Error("具体的なchangeReasonと16〜128文字のnonceが必要です。"), { code: "APPROVAL_INVALID", status: 400 });
  }
  assertApprovalNonceUnused(approval.nonce);
  const approvedAt = Date.parse(approval.approvedAt || "");
  const requestedAt = Date.parse(locked.requestedAt || "");
  const expiresAt = Date.parse(locked.expiresAt || "");
  if (!Number.isFinite(approvedAt) || approvedAt < requestedAt || approvedAt > expiresAt || Date.now() > expiresAt) throw Object.assign(new Error("承認日時がPreview有効期間外です。"), { code: "APPROVAL_EXPIRED", status: 409 });
  const expectedHash = await hmacSha256Hex(resolved.lockedText, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  if (!approval.approvalHash || !await secureEqual(approval.approvalHash, expectedHash)) throw Object.assign(new Error("approvalHashが一致しません。"), { code: "APPROVAL_HASH_MISMATCH", status: 409 });
  validateSiteLayout(locked.proposedLayout);
  const config = siteRepositoryConfig(env);
  if (canonicalJson(locked.repository) !== canonicalJson({ owner: config.owner, repo: config.repo, branch: config.branch, path: config.path })) {
    throw Object.assign(new Error("Preview後にサイトリポジトリ設定が変更されています。"), { code: "SITE_LAYOUT_REPOSITORY_CHANGED", status: 409 });
  }
  const current = await readGitHubLayout(env);
  if (current.sha !== locked.currentGitHubSha) throw Object.assign(new Error("Preview後にサイト設定が変更されています。"), { code: "SITE_LAYOUT_STATE_CHANGED", status: 409 });
  const putUrl = githubContentsUrl(config).replace(/\?ref=.*$/, "");
  const response = await fetch(putUrl, {
    method: "PUT",
    headers: { ...githubHeaders(env, true), "content-type": "application/json" },
    body: JSON.stringify({
      message: `APOS site layout: ${String(approval.changeReason).slice(0, 120)}`,
      content: base64Utf8Encode(`${JSON.stringify(locked.proposedLayout, null, 2)}\n`),
      sha: current.sha,
      branch: config.branch,
      committer: body.committer || undefined,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`GitHub layout更新に失敗しました (${response.status})。`), { code: "SITE_LAYOUT_WRITE_FAILED", status: 502 });
  markApprovalNonceUsed(approval.nonce);
  return {
    success: true,
    status: "APPLIED",
    layoutHash: locked.proposedLayoutHash,
    commitSha: result.commit?.sha || null,
    contentSha: result.content?.sha || null,
    repository: locked.repository,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    executor: auth.actor,
    deploymentExpected: true,
    rollbackAvailable: true,
    writePerformed: true,
  };
}


const SITE_SOURCE_PREVIEW_TTL_MS = 15 * 60 * 1000;
const SITE_SOURCE_MAX_CHANGE_ITEMS = 8;
const SITE_SOURCE_MAX_LOCKED_CHARS = 70000;
const SITE_SOURCE_MAX_FILE_CHARS = 250000;
const SITE_SOURCE_CHUNK_MAX = 30000;
const SITE_SOURCE_ALLOWED_EXTENSIONS = new Set(["html", "css", "js", "mjs", "gs", "py", "json", "yaml", "yml", "svg", "txt", "md", "webmanifest", "ico"]);

function siteSourceRoot(env) {
  return String(env.APOS_SITE_SOURCE_ROOT || "site").trim().replace(/^\/+|\/+$/g, "");
}

function sitePublicUrl(env) {
  const value = String(env.APOS_SITE_PUBLIC_URL || "https://apostrophe1109.github.io/athletics-performance-os-core/").trim();
  if (!value) return "";
  let url;
  try { url = new URL(value); }
  catch { return ""; }
  if (url.protocol !== "https:") return "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function validateSiteSourcePath(path, env) {
  const raw = String(path || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..") || raw.includes("\0")) {
    throw Object.assign(new Error("site source pathが不正です。"), { code: "SITE_SOURCE_PATH_INVALID", status: 400 });
  }
  const root = siteSourceRoot(env);
  if (root && raw !== root && !raw.startsWith(`${root}/`)) {
    throw Object.assign(new Error(`site source pathは${root}/配下に限定されています。`), { code: "SITE_SOURCE_PATH_OUTSIDE_ROOT", status: 400 });
  }
  const ext = raw.includes(".") ? raw.split(".").pop().toLowerCase() : "";
  if (!SITE_SOURCE_ALLOWED_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error(`未対応のsite source拡張子です: ${ext || "(none)"}`), { code: "SITE_SOURCE_EXTENSION_NOT_ALLOWED", status: 400 });
  }
  return raw;
}

function githubRepoBase(config) {
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
}

async function githubJson(url, env, options = {}) {
  const write = Boolean(options.write);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { ...githubHeaders(env, write), ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub APIに失敗しました (${response.status})。`);
    error.code = options.code || "GITHUB_API_FAILED";
    error.status = response.status === 404 ? 404 : 502;
    error.github = payload && payload.message ? String(payload.message).slice(0, 300) : null;
    throw error;
  }
  return payload;
}

async function currentBranchState(env) {
  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const ref = await githubJson(`${repo}/git/ref/heads/${encodeURIComponent(config.branch)}`, env, { code: "SITE_SOURCE_REF_READ_FAILED" });
  const commitSha = String(ref?.object?.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw Object.assign(new Error("GitHub branch commit SHAを取得できません。"), { code: "SITE_SOURCE_REF_INVALID", status: 502 });
  const commit = await githubJson(`${repo}/git/commits/${commitSha}`, env, { code: "SITE_SOURCE_COMMIT_READ_FAILED" });
  const treeSha = String(commit?.tree?.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(treeSha)) throw Object.assign(new Error("GitHub tree SHAを取得できません。"), { code: "SITE_SOURCE_TREE_INVALID", status: 502 });
  return { config, repo, commitSha, treeSha };
}

async function readGitHubSourceFile(path, env, refOverride = null) {
  const config = siteRepositoryConfig(env);
  const safePath = validateSiteSourcePath(path, env);
  const ref = String(refOverride || config.branch);
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  const url = `${githubRepoBase(config)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers: githubHeaders(env) });
  if (response.status === 404) return { exists: false, path: safePath, sha: null, content: "", size: 0 };
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.type !== "file" || !payload.content) {
    throw Object.assign(new Error(`GitHub source取得に失敗しました (${response.status})。`), { code: "SITE_SOURCE_READ_FAILED", status: 502 });
  }
  const content = base64Utf8Decode(String(payload.content).replace(/\s/g, ""));
  if (content.length > SITE_SOURCE_MAX_FILE_CHARS) {
    throw Object.assign(new Error("site source fileが安全上限を超えています。"), { code: "SITE_SOURCE_FILE_TOO_LARGE", status: 413 });
  }
  return { exists: true, path: safePath, sha: String(payload.sha || ""), content, size: Number(payload.size || content.length) };
}

async function getSiteSourceTree(body, env) {
  const state = await currentBranchState(env);
  const recursive = String(body.recursive ?? "true").toLowerCase() !== "false";
  const payload = await githubJson(`${state.repo}/git/trees/${state.treeSha}${recursive ? "?recursive=1" : ""}`, env, { code: "SITE_SOURCE_TREE_READ_FAILED" });
  const root = siteSourceRoot(env);
  const files = (Array.isArray(payload?.tree) ? payload.tree : [])
    .filter(item => item && item.type === "blob")
    .map(item => ({ path: String(item.path || ""), sha: String(item.sha || ""), size: Number(item.size || 0) }))
    .filter(item => !root || item.path === root || item.path.startsWith(`${root}/`))
    .filter(item => {
      const ext = item.path.includes(".") ? item.path.split(".").pop().toLowerCase() : "";
      return SITE_SOURCE_ALLOWED_EXTENSIONS.has(ext);
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    success: true,
    status: "READY",
    repository: { owner: state.config.owner, repo: state.config.repo, branch: state.config.branch, sourceRoot: root },
    commitSha: state.commitSha,
    fileCount: files.length,
    files,
    writePerformed: false,
  };
}

async function getSiteSourceFile(body, env) {
  const file = await readGitHubSourceFile(body.path, env);
  if (!file.exists) throw Object.assign(new Error("site source fileが見つかりません。"), { code: "SITE_SOURCE_FILE_NOT_FOUND", status: 404 });
  const offset = Math.max(0, Number(body.offset || 0));
  const limit = Math.min(Math.max(Number(body.limit || SITE_SOURCE_CHUNK_MAX), 1), SITE_SOURCE_CHUNK_MAX);
  const chunk = file.content.slice(offset, offset + limit);
  return {
    success: true,
    status: "READY",
    path: file.path,
    gitBlobSha: file.sha,
    contentHash: await sha256Hex(file.content),
    totalChars: file.content.length,
    offset,
    returnedChars: chunk.length,
    hasMore: offset + chunk.length < file.content.length,
    nextOffset: offset + chunk.length < file.content.length ? offset + chunk.length : null,
    content: chunk,
    writePerformed: false,
  };
}

function applyTextPatches(current, patches) {
  let output = String(current);
  if (!Array.isArray(patches) || !patches.length) throw Object.assign(new Error("PATCH_TEXTにはpatchesが必要です。"), { code: "SITE_SOURCE_PATCHES_REQUIRED", status: 400 });
  if (patches.length > 20) throw Object.assign(new Error("1ファイルのpatchは20件以下にしてください。"), { code: "SITE_SOURCE_PATCHES_TOO_MANY", status: 413 });
  for (const patch of patches) {
    const find = String(patch?.find ?? "");
    const replace = String(patch?.replace ?? "");
    const expectedCount = Number(patch?.expectedCount ?? 1);
    if (!find) throw Object.assign(new Error("patch.findが空です。"), { code: "SITE_SOURCE_PATCH_FIND_REQUIRED", status: 400 });
    const count = output.split(find).length - 1;
    if (count !== expectedCount) {
      throw Object.assign(new Error(`patch対象数が一致しません。expected=${expectedCount}, actual=${count}`), { code: "SITE_SOURCE_PATCH_COUNT_MISMATCH", status: 409 });
    }
    output = output.split(find).join(replace);
  }
  return output;
}

async function prepareSiteSourceChange(change, env) {
  const path = validateSiteSourcePath(change?.path, env);
  const mode = String(change?.mode || "REPLACE_FILE").toUpperCase();
  const current = await readGitHubSourceFile(path, env);
  let proposedContent = current.content;
  let operation = "UPSERT";
  let lockedPayload = {};
  if (mode === "REPLACE_FILE") {
    proposedContent = String(change?.content ?? "");
    lockedPayload = { proposedContent };
  } else if (mode === "PATCH_TEXT") {
    if (!current.exists) throw Object.assign(new Error("PATCH_TEXT対象ファイルが存在しません。"), { code: "SITE_SOURCE_PATCH_TARGET_NOT_FOUND", status: 404 });
    const patches = Array.isArray(change?.patches) ? change.patches.map(patch => ({
      find: String(patch?.find ?? ""),
      replace: String(patch?.replace ?? ""),
      expectedCount: Number(patch?.expectedCount ?? 1),
    })) : [];
    proposedContent = applyTextPatches(current.content, patches);
    // PATCH_TEXTは大きいファイルでもPreviewできるよう、全文ではなくpatch仕様だけをlockする。
    // Apply時にcurrent hashを再検証した後でpatchを再適用し、proposed hashも照合する。
    lockedPayload = { patches };
  } else if (mode === "DELETE_FILE") {
    operation = "DELETE";
    proposedContent = "";
    if (!current.exists) throw Object.assign(new Error("削除対象ファイルが存在しません。"), { code: "SITE_SOURCE_DELETE_TARGET_NOT_FOUND", status: 404 });
  } else {
    throw Object.assign(new Error("site source change modeが不正です。"), { code: "SITE_SOURCE_MODE_INVALID", status: 400 });
  }
  if (proposedContent.length > SITE_SOURCE_MAX_FILE_CHARS) throw Object.assign(new Error("提案後ファイルが安全上限を超えています。"), { code: "SITE_SOURCE_FILE_TOO_LARGE", status: 413 });
  if (operation !== "DELETE" && proposedContent === current.content) throw Object.assign(new Error("変更前後が同一です。"), { code: "SITE_SOURCE_NO_CHANGE", status: 400 });
  return {
    path,
    mode,
    operation,
    currentExists: current.exists,
    currentGitBlobSha: current.sha,
    currentContentHash: current.exists ? await sha256Hex(current.content) : null,
    currentChars: current.content.length,
    ...lockedPayload,
    proposedContentHash: operation === "DELETE" ? null : await sha256Hex(proposedContent),
    proposedChars: proposedContent.length,
  };
}

function bytesReadableStream(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}

async function gzipTextToBase64Url(value) {
  const source = bytesReadableStream(new TextEncoder().encode(String(value)));
  const compressed = source.pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(compressed).arrayBuffer();
  return bytesToBase64Url(new Uint8Array(buffer));
}

async function gunzipBase64UrlText(value) {
  const source = bytesReadableStream(base64UrlBytes(value));
  const decompressed = source.pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(decompressed).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

async function createLockedPreviewToken(lockedText, env) {
  // v2: canonical lockedPreview JSONをgzipしてからbase64url化する。
  // 目的はPreview内容を変えずにopaque tokenを短縮し、MyGPT Action経由の
  // 長大token搬送で生じる切断・転記揺れのリスクを下げること。
  const payload = await gzipTextToBase64Url(String(lockedText));
  const signingInput = `v2.${payload}`;
  const signature = await hmacBase64Url(signingInput, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  return `${signingInput}.${signature}`;
}

async function readLockedPreviewFromToken(token, expectedType, env) {
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  const tokenVersion = parts[0];
  if (parts.length !== 3 || !["v1", "v2"].includes(tokenVersion) || !parts[1] || !parts[2]) {
    throw Object.assign(new Error("lockedPreviewTokenが不正です。再Previewしてください。"), { code: "LOCKED_PREVIEW_TOKEN_INVALID", status: 400 });
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = await hmacBase64Url(signingInput, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  if (!await secureEqual(parts[2], expectedSignature)) {
    throw Object.assign(new Error("lockedPreviewToken署名が一致しません。再Previewしてください。"), { code: "LOCKED_PREVIEW_TOKEN_SIGNATURE_MISMATCH", status: 409 });
  }
  let lockedText;
  let locked;
  try {
    lockedText = tokenVersion === "v2"
      ? await gunzipBase64UrlText(parts[1])
      : base64UrlText(parts[1]);
    locked = JSON.parse(lockedText);
  } catch {
    throw Object.assign(new Error("lockedPreviewTokenを復元できません。再Previewしてください。"), { code: "LOCKED_PREVIEW_TOKEN_DECODE_FAILED", status: 400 });
  }
  if (!isPlainObject(locked) || locked.previewType !== expectedType) {
    throw Object.assign(new Error("lockedPreviewTokenのPreview種別が一致しません。"), { code: "LOCKED_PREVIEW_TOKEN_TYPE_MISMATCH", status: 400 });
  }
  if (canonicalJson(locked) !== lockedText) {
    throw Object.assign(new Error("lockedPreviewTokenのcanonical payloadが不正です。"), { code: "LOCKED_PREVIEW_TOKEN_CANONICAL_MISMATCH", status: 409 });
  }
  return { locked, lockedText, tokenVersion };
}

async function resolveLockedPreview(body, expectedType, env) {
  const token = String(body?.lockedPreviewToken || "").trim();
  if (token) return readLockedPreviewFromToken(token, expectedType, env);
  const locked = body?.lockedPreview;
  if (!isPlainObject(locked) || locked.previewType !== expectedType) {
    throw Object.assign(new Error("対応するPreviewが必要です。"), { code: "LOCKED_PREVIEW_REQUIRED", status: 400 });
  }
  return { locked, lockedText: canonicalJson(locked) };
}

async function previewSiteSourceChange(body, auth, env) {
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (!changes.length || changes.length > SITE_SOURCE_MAX_CHANGE_ITEMS) {
    throw Object.assign(new Error(`changesは1〜${SITE_SOURCE_MAX_CHANGE_ITEMS}件で指定してください。`), { code: "SITE_SOURCE_CHANGE_COUNT_INVALID", status: 400 });
  }
  const changeReason = String(body.changeReason || "").trim();
  if (changeReason.length < 3) throw Object.assign(new Error("具体的なchangeReasonが必要です。"), { code: "CHANGE_REASON_REQUIRED", status: 400 });
  const seen = new Set();
  const prepared = [];
  for (const change of changes) {
    const item = await prepareSiteSourceChange(change, env);
    if (seen.has(item.path)) throw Object.assign(new Error("同じpathを1回のPreviewで複数指定できません。"), { code: "SITE_SOURCE_DUPLICATE_PATH", status: 400 });
    seen.add(item.path);
    prepared.push(item);
  }
  const state = await currentBranchState(env);
  const now = new Date();
  const deploymentId = `SITEDEPLOY_${crypto.randomUUID().replaceAll("-", "")}`;
  const lockedPreview = {
    previewType: "SITE_SOURCE",
    previewId: `SITESOURCEPREVIEW_${crypto.randomUUID().replaceAll("-", "")}`,
    deploymentId,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SITE_SOURCE_PREVIEW_TTL_MS).toISOString(),
    requestedBy: auth.actor,
    repository: { owner: state.config.owner, repo: state.config.repo, branch: state.config.branch, sourceRoot: siteSourceRoot(env) },
    baseCommitSha: state.commitSha,
    baseTreeSha: state.treeSha,
    changes: prepared,
    changeReason,
  };
  const lockedText = canonicalJson(lockedPreview);
  if (lockedText.length > SITE_SOURCE_MAX_LOCKED_CHARS) {
    throw Object.assign(new Error("Source Previewが大きすぎます。変更を複数回へ分割してください。"), { code: "SITE_SOURCE_PREVIEW_TOO_LARGE", status: 413 });
  }
  const approvalHash = await hmacSha256Hex(lockedText, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  const lockedPreviewToken = await createLockedPreviewToken(lockedText, env);
  return {
    success: true,
    status: "AWAITING_EXPLICIT_APPROVAL",
    previewId: lockedPreview.previewId,
    deploymentId,
    expiresAt: lockedPreview.expiresAt,
    baseCommitSha: state.commitSha,
    changes: prepared.map(item => ({
      path: item.path,
      mode: item.mode,
      operation: item.operation,
      currentExists: item.currentExists,
      currentContentHash: item.currentContentHash,
      currentChars: item.currentChars,
      proposedContentHash: item.proposedContentHash,
      proposedChars: item.proposedChars,
    })),
    lockedPreview,
    lockedPreviewToken,
    lockedPreviewTokenVersion: "v2",
    lockedPreviewTokenChars: lockedPreviewToken.length,
    approvalHash,
    finalApprover: "山下祐樹",
    writePerformed: false,
  };
}

async function validateSiteSourceApproval(locked, approval, expectedType, env, lockedText = null) {
  if (!isPlainObject(locked) || locked.previewType !== expectedType) throw Object.assign(new Error("対応するSite Source Previewが必要です。"), { code: "SITE_SOURCE_PREVIEW_REQUIRED", status: 400 });
  if (approval.approved !== true || approval.approvedBy !== "山下祐樹") throw Object.assign(new Error("山下祐樹の明示承認が必要です。"), { code: "APPROVER_MISMATCH", status: 401 });
  if (String(approval.changeReason || "").trim().length < 3 || !/^[A-Za-z0-9_-]{16,128}$/.test(String(approval.nonce || ""))) {
    throw Object.assign(new Error("具体的なchangeReasonと16〜128文字のnonceが必要です。"), { code: "APPROVAL_INVALID", status: 400 });
  }
  assertApprovalNonceUnused(approval.nonce);
  const approvedAt = Date.parse(approval.approvedAt || "");
  const requestedAt = Date.parse(locked.requestedAt || "");
  const expiresAt = Date.parse(locked.expiresAt || "");
  if (!Number.isFinite(approvedAt) || approvedAt < requestedAt || approvedAt > expiresAt || Date.now() > expiresAt) {
    throw Object.assign(new Error("承認日時がPreview有効期間外です。"), { code: "APPROVAL_EXPIRED", status: 409 });
  }
  const expectedHash = await hmacSha256Hex(lockedText || canonicalJson(locked), requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  if (!approval.approvalHash || !await secureEqual(approval.approvalHash, expectedHash)) {
    throw Object.assign(new Error("approvalHashが一致しません。"), { code: "APPROVAL_HASH_MISMATCH", status: 409 });
  }
  return true;
}

async function createGitBlob(repo, content, env) {
  const payload = await githubJson(`${repo}/git/blobs`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { content: base64Utf8Encode(content), encoding: "base64" },
    code: "SITE_SOURCE_BLOB_CREATE_FAILED",
  });
  if (!/^[0-9a-f]{40}$/i.test(String(payload?.sha || ""))) throw Object.assign(new Error("GitHub blob作成結果が不正です。"), { code: "SITE_SOURCE_BLOB_INVALID", status: 502 });
  return String(payload.sha);
}

async function createSiteDeployManifestBlob(repo, deploymentId, commitBaseSha, changeReason, fileSummaries, env) {
  const manifest = {
    system: "Athletics Performance OS",
    deploymentId,
    generatedAt: new Date().toISOString(),
    baseCommitSha: commitBaseSha,
    changeReason: String(changeReason).slice(0, 500),
    files: fileSummaries,
  };
  return createGitBlob(repo, `${JSON.stringify(manifest, null, 2)}\n`, env);
}

async function dispatchSiteDeploymentOnce(deploymentId, commitSha, env) {
  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const workflowFile = "deploy-site.yml";
  try {
    await githubJson(`${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, env, {
      write: true,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { ref: config.branch },
      code: "SITE_DEPLOYMENT_DISPATCH_FAILED",
    });
    return {
      attempted: true,
      status: "DISPATCHED",
      workflowFile,
      deploymentId,
      commitSha,
      retryPerformed: false,
    };
  } catch (error) {
    return {
      attempted: true,
      status: "DISPATCH_FAILED",
      workflowFile,
      deploymentId,
      commitSha,
      code: error.code || "SITE_DEPLOYMENT_DISPATCH_FAILED",
      error: safeErrorMessage(error),
      retryPerformed: false,
    };
  }
}

async function applySiteSourceChange(body, auth, env) {
  const resolved = await resolveLockedPreview(body, "SITE_SOURCE", env);
  const locked = resolved.locked;
  const approval = body.approval || {};
  await validateSiteSourceApproval(locked, approval, "SITE_SOURCE", env, resolved.lockedText);
  if (locked.changes.some(item => item.operation === "DELETE") && approval.destructiveApproval !== "SOURCE_DELETE_APPROVED") {
    throw Object.assign(new Error("Source file削除にはdestructiveApproval=SOURCE_DELETE_APPROVEDが必要です。"), { code: "SOURCE_DELETE_APPROVAL_REQUIRED", status: 400 });
  }
  const state = await currentBranchState(env);
  if (state.commitSha !== locked.baseCommitSha) {
    throw Object.assign(new Error("Preview後にGitHub branchが変更されています。再Previewしてください。"), { code: "SITE_SOURCE_STATE_CHANGED", status: 409 });
  }
  const configNow = { owner: state.config.owner, repo: state.config.repo, branch: state.config.branch, sourceRoot: siteSourceRoot(env) };
  if (canonicalJson(configNow) !== canonicalJson(locked.repository)) {
    throw Object.assign(new Error("Preview後にsite repository設定が変更されています。"), { code: "SITE_SOURCE_REPOSITORY_CHANGED", status: 409 });
  }

  const treeEntries = [];
  for (const item of locked.changes) {
    const current = await readGitHubSourceFile(item.path, env);
    if (Boolean(current.exists) !== Boolean(item.currentExists)) {
      throw Object.assign(new Error(`Preview後にファイル存在状態が変わりました: ${item.path}`), { code: "SITE_SOURCE_FILE_STATE_CHANGED", status: 409 });
    }
    const currentHash = current.exists ? await sha256Hex(current.content) : null;
    if (currentHash !== item.currentContentHash) {
      throw Object.assign(new Error(`Preview後にファイル内容が変わりました: ${item.path}`), { code: "SITE_SOURCE_FILE_HASH_CHANGED", status: 409 });
    }
    if (item.operation === "DELETE") {
      treeEntries.push({ path: item.path, mode: "100644", type: "blob", sha: null });
    } else {
      let proposedContent;
      if (item.mode === "PATCH_TEXT") {
        proposedContent = applyTextPatches(current.content, item.patches);
      } else if (item.mode === "REPLACE_FILE") {
        proposedContent = String(item.proposedContent ?? "");
      } else {
        throw Object.assign(new Error(`locked source modeが不正です: ${item.mode}`), { code: "SITE_SOURCE_LOCKED_MODE_INVALID", status: 400 });
      }
      const proposedHash = await sha256Hex(proposedContent);
      if (proposedHash !== item.proposedContentHash || proposedContent.length !== item.proposedChars) {
        throw Object.assign(new Error(`Preview再構成結果が一致しません: ${item.path}`), { code: "SITE_SOURCE_PROPOSED_HASH_MISMATCH", status: 409 });
      }
      const blobSha = await createGitBlob(state.repo, proposedContent, env);
      treeEntries.push({ path: item.path, mode: "100644", type: "blob", sha: blobSha });
    }
  }

  const manifestPath = validateSiteSourcePath(`${siteSourceRoot(env)}/deploy-manifest.json`, env);
  const manifestBlob = await createSiteDeployManifestBlob(
    state.repo,
    locked.deploymentId,
    locked.baseCommitSha,
    approval.changeReason,
    locked.changes.map(item => ({ path: item.path, operation: item.operation, contentHash: item.proposedContentHash })),
    env
  );
  treeEntries.push({ path: manifestPath, mode: "100644", type: "blob", sha: manifestBlob });

  const tree = await githubJson(`${state.repo}/git/trees`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { base_tree: state.treeSha, tree: treeEntries },
    code: "SITE_SOURCE_TREE_CREATE_FAILED",
  });
  const newTreeSha = String(tree?.sha || "");
  const commit = await githubJson(`${state.repo}/git/commits`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      message: `APOS site source: ${String(approval.changeReason).slice(0, 120)}`,
      tree: newTreeSha,
      parents: [state.commitSha],
    },
    code: "SITE_SOURCE_COMMIT_CREATE_FAILED",
  });
  const newCommitSha = String(commit?.sha || "");
  await githubJson(`${state.repo}/git/refs/heads/${encodeURIComponent(state.config.branch)}`, env, {
    write: true,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: { sha: newCommitSha, force: false },
    code: "SITE_SOURCE_REF_UPDATE_FAILED",
  });
  markApprovalNonceUsed(approval.nonce);
  const siteDeploymentDispatch = siteSourceRoot(env) !== maintenanceSourceRoot(env)
    ? await dispatchSiteDeploymentOnce(locked.deploymentId, newCommitSha, env)
    : { attempted: false, status: "NOT_SITE_SOURCE", deploymentId: locked.deploymentId, commitSha: newCommitSha, retryPerformed: false };

  return {
    success: true,
    status: "APPLIED",
    deploymentId: locked.deploymentId,
    previousCommitSha: state.commitSha,
    commitSha: newCommitSha,
    treeSha: newTreeSha,
    changedFiles: locked.changes.map(item => ({ path: item.path, operation: item.operation, contentHash: item.proposedContentHash })),
    repository: locked.repository,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    executor: auth.actor,
    deploymentExpected: true,
    deploymentCheckRecommended: true,
    siteDeploymentDispatch,
    rollbackAvailable: true,
    writePerformed: true,
  };
}

async function getSiteDeploymentStatus(body, env) {
  const deploymentId = String(body.deploymentId || "").trim();
  if (!deploymentId) throw Object.assign(new Error("deploymentIdが必要です。"), { code: "DEPLOYMENT_ID_REQUIRED", status: 400 });
  const publicUrl = sitePublicUrl(env);
  if (!publicUrl) throw Object.assign(new Error("APOS_SITE_PUBLIC_URLを設定してください。"), { code: "SITE_PUBLIC_URL_NOT_CONFIGURED", status: 503 });
  const cacheBust = String(Date.now());
  const manifestUrl = new URL("deploy-manifest.json", publicUrl);
  manifestUrl.searchParams.set("_apos", cacheBust);
  const response = await fetch(manifestUrl.toString(), { headers: { accept: "application/json", "cache-control": "no-cache" } });
  if (!response.ok) {
    return { success: true, status: "DEPLOYMENT_PENDING", deploymentId, publicUrl, httpStatus: response.status, writePerformed: false };
  }
  const manifest = await response.json().catch(() => null);
  const manifestMatched = Boolean(manifest && String(manifest.deploymentId || "") === deploymentId);

  const root = siteSourceRoot(env);
  const criticalRelativePaths = ["index.html", "app.js", "styles.css", "ui-layout.json"];
  const deploymentChecks = [];
  for (const relativePath of criticalRelativePaths) {
    const sourcePath = validateSiteSourcePath(`${root}/${relativePath}`, env);
    const source = await readGitHubSourceFile(sourcePath, env);
    const publicFileUrl = new URL(relativePath, publicUrl);
    publicFileUrl.searchParams.set("_apos", cacheBust);
    const publicResponse = await fetch(publicFileUrl.toString(), { headers: { "cache-control": "no-cache" } });
    const publicContent = publicResponse.ok ? await publicResponse.text() : "";
    const sourceHash = source.exists ? await sha256Hex(source.content) : null;
    const publicHash = publicResponse.ok ? await sha256Hex(publicContent) : null;
    deploymentChecks.push({
      path: relativePath,
      httpStatus: publicResponse.status,
      sourceHash,
      publicHash,
      matched: Boolean(source.exists && publicResponse.ok && sourceHash === publicHash),
    });
  }
  const filesMatched = deploymentChecks.every(item => item.matched);
  const deployed = manifestMatched && filesMatched;
  return {
    success: true,
    status: deployed ? "DEPLOYED" : "DEPLOYMENT_PENDING",
    deploymentId,
    publicUrl,
    observedDeploymentId: manifest?.deploymentId || null,
    manifestMatched,
    filesMatched,
    deploymentChecks,
    manifest: manifestMatched ? manifest : null,
    writePerformed: false,
  };
}

async function previewSiteSourceRollback(body, auth, env) {
  const appliedCommitSha = String(body.appliedCommitSha || "").trim();
  const previousCommitSha = String(body.previousCommitSha || "").trim();
  const changeReason = String(body.changeReason || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(appliedCommitSha) || !/^[0-9a-f]{40}$/i.test(previousCommitSha)) {
    throw Object.assign(new Error("appliedCommitShaとpreviousCommitShaが必要です。"), { code: "SITE_SOURCE_ROLLBACK_SHA_INVALID", status: 400 });
  }
  if (changeReason.length < 3) throw Object.assign(new Error("具体的なchangeReasonが必要です。"), { code: "CHANGE_REASON_REQUIRED", status: 400 });
  const state = await currentBranchState(env);
  if (state.commitSha !== appliedCommitSha) {
    throw Object.assign(new Error("現在のbranchがRollback対象commitと一致しません。後続変更を保護するため停止します。"), { code: "SITE_SOURCE_ROLLBACK_STATE_CHANGED", status: 409 });
  }
  const previous = await githubJson(`${state.repo}/git/commits/${previousCommitSha}`, env, { code: "SITE_SOURCE_ROLLBACK_COMMIT_READ_FAILED" });
  const previousTreeSha = String(previous?.tree?.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(previousTreeSha)) throw Object.assign(new Error("復元元treeを取得できません。"), { code: "SITE_SOURCE_ROLLBACK_TREE_INVALID", status: 502 });
  const now = new Date();
  const lockedPreview = {
    previewType: "SITE_SOURCE_ROLLBACK",
    previewId: `SITESOURCEROLLBACK_${crypto.randomUUID().replaceAll("-", "")}`,
    deploymentId: `SITEDEPLOY_${crypto.randomUUID().replaceAll("-", "")}`,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SITE_SOURCE_PREVIEW_TTL_MS).toISOString(),
    requestedBy: auth.actor,
    repository: { owner: state.config.owner, repo: state.config.repo, branch: state.config.branch, sourceRoot: siteSourceRoot(env) },
    currentCommitSha: state.commitSha,
    rollbackToCommitSha: previousCommitSha,
    rollbackToTreeSha: previousTreeSha,
    changeReason,
  };
  const lockedText = canonicalJson(lockedPreview);
  const approvalHash = await hmacSha256Hex(lockedText, requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  const lockedPreviewToken = await createLockedPreviewToken(lockedText, env);
  return {
    success: true,
    status: "AWAITING_EXPLICIT_APPROVAL",
    currentCommitSha: state.commitSha,
    rollbackToCommitSha: previousCommitSha,
    deploymentId: lockedPreview.deploymentId,
    lockedPreview,
    lockedPreviewToken,
    lockedPreviewTokenVersion: "v2",
    lockedPreviewTokenChars: lockedPreviewToken.length,
    approvalHash,
    finalApprover: "山下祐樹",
    writePerformed: false,
  };
}

async function applySiteSourceRollback(body, auth, env) {
  const resolved = await resolveLockedPreview(body, "SITE_SOURCE_ROLLBACK", env);
  const locked = resolved.locked;
  const approval = body.approval || {};
  await validateSiteSourceApproval(locked, approval, "SITE_SOURCE_ROLLBACK", env, resolved.lockedText);
  const state = await currentBranchState(env);
  if (state.commitSha !== locked.currentCommitSha) {
    throw Object.assign(new Error("Rollback Preview後にbranchが変更されています。再Previewしてください。"), { code: "SITE_SOURCE_ROLLBACK_STATE_CHANGED", status: 409 });
  }
  const manifestPath = validateSiteSourcePath(`${siteSourceRoot(env)}/deploy-manifest.json`, env);
  const manifestBlob = await createSiteDeployManifestBlob(
    state.repo,
    locked.deploymentId,
    state.commitSha,
    approval.changeReason,
    [{ operation: "ROLLBACK", rollbackToCommitSha: locked.rollbackToCommitSha }],
    env
  );
  const tree = await githubJson(`${state.repo}/git/trees`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      base_tree: locked.rollbackToTreeSha,
      tree: [{ path: manifestPath, mode: "100644", type: "blob", sha: manifestBlob }],
    },
    code: "SITE_SOURCE_ROLLBACK_TREE_CREATE_FAILED",
  });
  const commit = await githubJson(`${state.repo}/git/commits`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      message: `APOS site rollback: ${String(approval.changeReason).slice(0, 120)}`,
      tree: String(tree.sha),
      parents: [state.commitSha],
    },
    code: "SITE_SOURCE_ROLLBACK_COMMIT_CREATE_FAILED",
  });
  const newCommitSha = String(commit?.sha || "");
  await githubJson(`${state.repo}/git/refs/heads/${encodeURIComponent(state.config.branch)}`, env, {
    write: true,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: { sha: newCommitSha, force: false },
    code: "SITE_SOURCE_ROLLBACK_REF_UPDATE_FAILED",
  });
  markApprovalNonceUsed(approval.nonce);
  const siteDeploymentDispatch = siteSourceRoot(env) !== maintenanceSourceRoot(env)
    ? await dispatchSiteDeploymentOnce(locked.deploymentId, newCommitSha, env)
    : { attempted: false, status: "NOT_SITE_SOURCE", deploymentId: locked.deploymentId, commitSha: newCommitSha, retryPerformed: false };
  return {
    success: true,
    status: "ROLLED_BACK",
    deploymentId: locked.deploymentId,
    previousCommitSha: state.commitSha,
    commitSha: newCommitSha,
    restoredFromCommitSha: locked.rollbackToCommitSha,
    executor: auth.actor,
    deploymentExpected: true,
    deploymentCheckRecommended: true,
    siteDeploymentDispatch,
    writePerformed: true,
  };
}


function validateSiteLayout(layout) {
  if (!isPlainObject(layout)) throw Object.assign(new Error("layoutはobjectで指定してください。"), { code: "SITE_LAYOUT_INVALID", status: 400 });
  if (!layout.layoutVersion || String(layout.layoutVersion).length > 40) throw Object.assign(new Error("layoutVersionが必要です。"), { code: "SITE_LAYOUT_VERSION_REQUIRED", status: 400 });
  if (!Array.isArray(layout.sections) || !layout.sections.length || layout.sections.length > 30) throw Object.assign(new Error("sectionsは1〜30件で指定してください。"), { code: "SITE_LAYOUT_SECTIONS_INVALID", status: 400 });
  const allowed = new Set(["hero", "today", "week", "month", "exerciseLibrary", "history", "measurements", "customText"]);
  const ids = new Set();
  for (const section of layout.sections) {
    if (!isPlainObject(section) || !section.id || ids.has(section.id)) throw Object.assign(new Error("section.idは一意である必要があります。"), { code: "SITE_LAYOUT_SECTION_ID_INVALID", status: 400 });
    ids.add(section.id);
    if (!allowed.has(section.type)) throw Object.assign(new Error(`未対応のsection.typeです: ${section.type}`), { code: "SITE_LAYOUT_SECTION_TYPE_INVALID", status: 400 });
    if (String(section.title || "").length > 100) throw Object.assign(new Error("section.titleが長すぎます。"), { code: "SITE_LAYOUT_SECTION_TITLE_INVALID", status: 400 });
  }
  const encoded = JSON.stringify(layout);
  if (encoded.length > 100000 || /<script|javascript:/i.test(encoded)) throw Object.assign(new Error("layoutに許可されない内容があります。"), { code: "SITE_LAYOUT_CONTENT_INVALID", status: 400 });
}

function base64Utf8Encode(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Utf8Decode(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const MAINTENANCE_SOURCE_ROOT_DEFAULT = "system";
const MAINTENANCE_READ_OPERATIONS = new Set(["SYSTEM_TREE", "SYSTEM_FILE", "RUNTIME_POLICY", "DEPLOYMENT_STATUS", "DEPLOYMENT_DIAGNOSTIC", "BACKEND_DIAGNOSTIC"]);
const MAINTENANCE_PREVIEW_OPERATIONS = new Set(["SYSTEM_SOURCE_CHANGE", "SYSTEM_SOURCE_ROLLBACK"]);
const MAINTENANCE_APPLY_OPERATIONS = new Set(["SYSTEM_SOURCE_CHANGE", "SYSTEM_SOURCE_ROLLBACK"]);

function maintenanceSourceRoot(env) {
  return String(env.APOS_MAINTENANCE_SOURCE_ROOT || MAINTENANCE_SOURCE_ROOT_DEFAULT).trim().replace(/^\/+|\/+$/g, "") || MAINTENANCE_SOURCE_ROOT_DEFAULT;
}

function maintenanceEnv(env) {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === "APOS_SITE_SOURCE_ROOT") return maintenanceSourceRoot(target);
      return target[prop];
    }
  });
}

function normalizeMaintenanceOperation(value) {
  return String(value || "").trim().toUpperCase();
}

async function getMaintenanceCapabilities(env) {
  return {
    success: true,
    status: "READY",
    sourceRoot: maintenanceSourceRoot(env),
    readOperations: Array.from(MAINTENANCE_READ_OPERATIONS),
    previewOperations: Array.from(MAINTENANCE_PREVIEW_OPERATIONS),
    applyOperations: Array.from(MAINTENANCE_APPLY_OPERATIONS),
    rules: {
      sourceChangesRequirePreview: true,
      applyRequiresExplicitApproval: true,
      approvalHashRequired: true,
      branchRaceProtection: true,
      fileHashRaceProtection: true,
      destructiveSourceDeleteRequires: "SOURCE_DELETE_APPROVED",
      sourceRootRestricted: true,
      writeAutoRetry: false,
    },
    deploymentWorkflows: {
      workerPath: `${maintenanceSourceRoot(env)}/worker.js`,
      appsScriptPath: `${maintenanceSourceRoot(env)}/apps-script/Code.gs`,
      observation: "GitHub Actions",
    },
    writePerformed: false,
  };
}

function redactMaintenanceDiagnostic(value) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/((?:refresh[_-]?token|client[_-]?secret|token|password|secret)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/[A-Za-z0-9._~-]{40,}/g, "[REDACTED_LONG]")
    .slice(-12000);
}

async function getMaintenanceDeploymentDiagnostic(payload, env) {
  const runId = Number(payload.runId);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw Object.assign(new Error("DEPLOYMENT_DIAGNOSTICにはrunIdが必要です。"), { code: "MAINTENANCE_RUN_ID_REQUIRED", status: 400 });
  }
  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const jobsPayload = await githubJson(`${repo}/actions/runs/${runId}/jobs?per_page=100`, env, { code: "MAINTENANCE_DEPLOYMENT_DIAGNOSTIC_FAILED" });
  const jobs = (Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []).map(job => ({
    id: Number(job?.id || 0),
    name: String(job?.name || ""),
    status: String(job?.status || ""),
    conclusion: job?.conclusion || null,
    startedAt: job?.started_at || null,
    completedAt: job?.completed_at || null,
  }));
  const failedJobs = jobs.filter(job => job.id > 0 && job.conclusion && job.conclusion !== "success");
  const failedJobLogs = [];
  for (const job of failedJobs.slice(0, 3)) {
    const logApi = `${repo}/actions/jobs/${job.id}/logs`;
    let response = await fetch(logApi, { headers: githubHeaders(env), redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw Object.assign(new Error("GitHub job log redirect先を取得できません。"), { code: "MAINTENANCE_JOB_LOG_REDIRECT_MISSING", status: 502 });
      response = await fetch(location, { headers: { accept: "text/plain" }, redirect: "follow" });
    }
    if (!response.ok) throw Object.assign(new Error(`GitHub job log取得に失敗しました (${response.status})。`), { code: "MAINTENANCE_JOB_LOG_READ_FAILED", status: 502 });
    const raw = await response.text();
    const errorLines = raw.split(/\r?\n/)
      .filter(line => /(traceback|runtimeerror|error|failed|http\s+\d|forbidden|permission|scope|invalid|mismatch|refusing|exception)/i.test(line))
      .slice(-80)
      .join("\n");
    failedJobLogs.push({
      jobId: job.id,
      name: job.name,
      conclusion: job.conclusion,
      errorLines: redactMaintenanceDiagnostic(errorLines),
    });
  }
  return { success: true, status: "READY", runId, jobs, failedJobLogs, writePerformed: false };
}

async function getMaintenanceBackendDiagnostic(env) {
  const normalizedUrl = normalizeAppsScriptUrl(requiredEnv(env, "APOS_APPS_SCRIPT_URL"));
  const parsedUrl = new URL(normalizedUrl);
  const urlMatch = parsedUrl.pathname.match(/^\/macros\/s\/([^/]+)\/exec\/?$/);
  const urlDeploymentId = urlMatch ? String(urlMatch[1]) : "";

  let repoDeploymentId = "";
  let repoVariableReadable = true;
  let repoVariableError = null;
  try {
    const config = siteRepositoryConfig(env);
    const repo = githubRepoBase(config);
    const variable = await githubJson(`${repo}/actions/variables/APOS_APPS_SCRIPT_DEPLOYMENT_ID`, env, { code: "MAINTENANCE_BACKEND_VARIABLE_READ_FAILED" });
    repoDeploymentId = String(variable?.value || "").trim();
  } catch (error) {
    repoVariableReadable = false;
    repoVariableError = { code: error.code || "MAINTENANCE_BACKEND_VARIABLE_READ_FAILED", error: safeErrorMessage(error) };
  }

  const requestId = `diag_${crypto.randomUUID()}`;
  const envelope = await buildSignedEnvelope("health", {}, { id: "apostrophe", source: "MAINTENANCE" }, requestId, env);
  let response = await fetch(normalizedUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", accept: "application/json" },
    body: JSON.stringify(envelope),
    redirect: "manual",
  });
  const firstHttpStatus = response.status;
  const location = response.headers.get("location");
  let redirectHost = null;
  let redirected = false;
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    redirected = true;
    try { redirectHost = new URL(location).hostname; } catch { redirectHost = "INVALID_REDIRECT_URL"; }
    response = await fetch(location, { headers: { accept: "application/json" }, redirect: "follow" });
  }

  const text = await response.text();
  let bodySummary = null;
  try {
    const parsed = JSON.parse(text);
    bodySummary = {
      json: true,
      success: parsed?.success ?? null,
      status: parsed?.status ?? null,
      code: parsed?.code ?? null,
      error: parsed?.error ? String(parsed.error).slice(0, 240) : null,
    };
  } catch {
    bodySummary = {
      json: false,
      looksHtml: /^\s*(?:<!doctype|<html)/i.test(text),
      chars: text.length,
    };
  }

  return {
    success: true,
    status: "READY",
    urlDeploymentIdSuffix: urlDeploymentId ? urlDeploymentId.slice(-8) : null,
    repoDeploymentIdSuffix: repoDeploymentId ? repoDeploymentId.slice(-8) : null,
    deploymentIdMatches: repoVariableReadable && repoDeploymentId ? urlDeploymentId === repoDeploymentId : null,
    repoVariableReadable,
    repoVariableError,
    firstHttpStatus,
    redirected,
    redirectHost,
    finalHttpStatus: response.status,
    finalContentType: response.headers.get("content-type") || null,
    bodySummary,
    writePerformed: false,
  };
}

async function maintenanceRead(body, auth, env) {
  const operation = normalizeMaintenanceOperation(body.operation);
  if (!MAINTENANCE_READ_OPERATIONS.has(operation)) {
    throw Object.assign(new Error("maintenanceReadのoperationが未対応です。getMaintenanceCapabilitiesで確認してください。"), { code: "MAINTENANCE_OPERATION_UNSUPPORTED", status: 400 });
  }
  const payload = isPlainObject(body.payload) ? body.payload : {};
  const scopedEnv = maintenanceEnv(env);
  if (operation === "SYSTEM_TREE") {
    const result = await getSiteSourceTree({ recursive: payload.recursive !== false }, scopedEnv);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM" };
  }
  if (operation === "SYSTEM_FILE") {
    const result = await getSiteSourceFile({
      path: payload.path,
      offset: payload.offset || 0,
      limit: payload.limit || SITE_SOURCE_CHUNK_MAX,
    }, scopedEnv);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM" };
  }
  if (operation === "RUNTIME_POLICY") {
    const path = `${maintenanceSourceRoot(env)}/runtime-policy.json`;
    const result = await getSiteSourceFile({ path, offset: 0, limit: SITE_SOURCE_CHUNK_MAX }, scopedEnv);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM", policyPath: path };
  }
  if (operation === "DEPLOYMENT_DIAGNOSTIC") {
    const result = await getMaintenanceDeploymentDiagnostic(payload, env);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM" };
  }
  if (operation === "BACKEND_DIAGNOSTIC") {
    const result = await getMaintenanceBackendDiagnostic(env);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM" };
  }
  return getMaintenanceDeploymentStatus(payload, env);
}

async function maintenancePreview(body, auth, env) {
  const operation = normalizeMaintenanceOperation(body.operation);
  if (!MAINTENANCE_PREVIEW_OPERATIONS.has(operation)) {
    throw Object.assign(new Error("maintenancePreviewのoperationが未対応です。getMaintenanceCapabilitiesで確認してください。"), { code: "MAINTENANCE_OPERATION_UNSUPPORTED", status: 400 });
  }
  const payload = isPlainObject(body.payload) ? body.payload : {};
  const scopedEnv = maintenanceEnv(env);
  if (operation === "SYSTEM_SOURCE_CHANGE") {
    const result = await previewSiteSourceChange(payload, auth, scopedEnv);
    return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM", writePerformed: false };
  }
  const result = await previewSiteSourceRollback(payload, auth, scopedEnv);
  return { ...result, maintenanceOperation: operation, maintenanceDomain: "SYSTEM", writePerformed: false };
}

const WORKER_DEPLOY_WORKFLOW_FILE = "apos-deploy-worker.yml";
const APPS_SCRIPT_DEPLOY_WORKFLOW_FILE = "apos-deploy-apps-script.yml";

async function getMaintenanceCommitChangedPaths(commitSha, env) {
  const normalizedSha = String(commitSha || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(normalizedSha)) {
    throw Object.assign(new Error("Maintenance commit SHAが不正です。"), { code: "MAINTENANCE_COMMIT_SHA_INVALID", status: 400 });
  }
  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const commit = await githubJson(`${repo}/commits/${encodeURIComponent(normalizedSha)}`, env, {
    code: "MAINTENANCE_COMMIT_READ_FAILED",
  });
  const files = Array.isArray(commit?.files) ? commit.files : [];
  return files
    .map(file => String(file?.filename || ""))
    .filter(Boolean);
}

function maintenanceDeploymentSpecsForPaths(paths, env) {
  const root = maintenanceSourceRoot(env);
  const changed = new Set(Array.isArray(paths) ? paths.map(path => String(path || "")) : []);
  const specs = [];
  if (changed.has(`${root}/worker.js`)) {
    specs.push({ kind: "WORKER", workflowFile: WORKER_DEPLOY_WORKFLOW_FILE, runTitlePrefix: "APOS Worker deploy @ " });
  }
  if (changed.has(`${root}/apps-script/Code.gs`) || changed.has(`${root}/deploy_apps_script.py`)) {
    specs.push({ kind: "APPS_SCRIPT", workflowFile: APPS_SCRIPT_DEPLOY_WORKFLOW_FILE, runTitlePrefix: "" });
  }
  return specs;
}

async function getDeploymentRunsForSpec(spec, commitSha, env) {
  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const workflowFile = encodeURIComponent(spec.workflowFile);
  const data = await githubJson(
    `${repo}/actions/workflows/${workflowFile}/runs?head_sha=${encodeURIComponent(commitSha)}&event=workflow_dispatch&per_page=20`,
    env,
    { code: "MAINTENANCE_DEPLOYMENT_STATUS_FAILED" }
  );
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  const expectedTitle = spec.runTitlePrefix ? `${spec.runTitlePrefix}${commitSha}` : "";
  return runs
    .filter(run => String(run?.head_sha || "").toLowerCase() === commitSha.toLowerCase())
    .filter(run => !expectedTitle || String(run?.display_title || "") === expectedTitle)
    .sort((a, b) => Date.parse(String(b?.created_at || "")) - Date.parse(String(a?.created_at || "")));
}

async function dispatchWorkerDeploymentOnce(commitSha, env) {
  const spec = { kind: "WORKER", workflowFile: WORKER_DEPLOY_WORKFLOW_FILE, runTitlePrefix: "APOS Worker deploy @ " };
  const existingRuns = await getDeploymentRunsForSpec(spec, commitSha, env);
  if (existingRuns.length) {
    const latest = existingRuns[0];
    const failed = latest.status === "completed" && latest.conclusion && latest.conclusion !== "success";
    return {
      attempted: false,
      status: failed ? "PREVIOUS_DISPATCH_FAILED" : (latest.status === "completed" ? "ALREADY_DEPLOYED" : "ALREADY_DISPATCHED"),
      workflowFile: spec.workflowFile,
      commitSha,
      runId: latest.id || null,
      runNumber: latest.run_number || null,
      runStatus: latest.status || null,
      conclusion: latest.conclusion || null,
      retryPerformed: false,
    };
  }

  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const response = await githubJson(`${repo}/actions/workflows/${encodeURIComponent(spec.workflowFile)}/dispatches`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      ref: config.branch,
      inputs: {
        mode: "deploy",
        expected_commit_sha: commitSha,
      },
    },
    code: "MAINTENANCE_DEPLOYMENT_DISPATCH_FAILED",
  });
  return {
    attempted: true,
    status: "DISPATCHED",
    workflowFile: spec.workflowFile,
    commitSha,
    runId: response?.workflow_run_id || null,
    runUrl: response?.html_url || null,
    retryPerformed: false,
  };
}

async function dispatchAppsScriptDeploymentOnce(commitSha, env) {
  const spec = { kind: "APPS_SCRIPT", workflowFile: APPS_SCRIPT_DEPLOY_WORKFLOW_FILE, runTitlePrefix: "" };
  const existingRuns = await getDeploymentRunsForSpec(spec, commitSha, env);
  if (existingRuns.length) {
    const latest = existingRuns[0];
    const failed = latest.status === "completed" && latest.conclusion && latest.conclusion !== "success";
    return {
      attempted: false,
      status: failed ? "PREVIOUS_DISPATCH_FAILED" : (latest.status === "completed" ? "ALREADY_DEPLOYED" : "ALREADY_DISPATCHED"),
      workflowFile: spec.workflowFile,
      commitSha,
      runId: latest.id || null,
      runNumber: latest.run_number || null,
      runStatus: latest.status || null,
      conclusion: latest.conclusion || null,
      retryPerformed: false,
    };
  }

  const config = siteRepositoryConfig(env);
  const repo = githubRepoBase(config);
  const response = await githubJson(`${repo}/actions/workflows/${encodeURIComponent(spec.workflowFile)}/dispatches`, env, {
    write: true,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      ref: config.branch,
      inputs: {
        mode: "deploy",
      },
    },
    code: "MAINTENANCE_DEPLOYMENT_DISPATCH_FAILED",
  });
  return {
    attempted: true,
    status: "DISPATCHED",
    workflowFile: spec.workflowFile,
    commitSha,
    runId: response?.workflow_run_id || null,
    runUrl: response?.html_url || null,
    retryPerformed: false,
  };
}

async function maintenanceApply(body, auth, env) {
  const operation = normalizeMaintenanceOperation(body.operation);
  if (!MAINTENANCE_APPLY_OPERATIONS.has(operation)) {
    throw Object.assign(new Error("maintenanceApplyのoperationが未対応です。getMaintenanceCapabilitiesで確認してください。"), { code: "MAINTENANCE_OPERATION_UNSUPPORTED", status: 400 });
  }
  const payload = isPlainObject(body.payload) ? body.payload : {};
  const scopedEnv = maintenanceEnv(env);
  let result;
  if (operation === "SYSTEM_SOURCE_CHANGE") result = await applySiteSourceChange(payload, auth, scopedEnv);
  else result = await applySiteSourceRollback(payload, auth, scopedEnv);

  let changedPaths = Array.isArray(result.changedFiles)
    ? result.changedFiles.map(item => String(item.path || "")).filter(Boolean)
    : [];
  let changedPathReadError = null;
  if (!changedPaths.length && /^[0-9a-f]{40}$/i.test(String(result.commitSha || ""))) {
    try {
      changedPaths = await getMaintenanceCommitChangedPaths(result.commitSha, env);
    } catch (error) {
      changedPathReadError = { code: error.code || "MAINTENANCE_COMMIT_READ_FAILED", error: safeErrorMessage(error) };
    }
  }

  const deploymentSpecs = maintenanceDeploymentSpecsForPaths(changedPaths, env);
  const expectedDeployments = deploymentSpecs.map(spec => spec.kind);
  const deploymentDispatches = [];

  if (expectedDeployments.includes("WORKER")) {
    try {
      deploymentDispatches.push(await dispatchWorkerDeploymentOnce(String(result.commitSha || ""), env));
    } catch (error) {
      deploymentDispatches.push({
        attempted: true,
        status: "DISPATCH_FAILED",
        workflowFile: WORKER_DEPLOY_WORKFLOW_FILE,
        commitSha: result.commitSha || null,
        code: error.code || "MAINTENANCE_DEPLOYMENT_DISPATCH_FAILED",
        error: safeErrorMessage(error),
        retryPerformed: false,
      });
    }
  }

  if (expectedDeployments.includes("APPS_SCRIPT")) {
    try {
      deploymentDispatches.push(await dispatchAppsScriptDeploymentOnce(String(result.commitSha || ""), env));
    } catch (error) {
      deploymentDispatches.push({
        attempted: true,
        status: "DISPATCH_FAILED",
        workflowFile: APPS_SCRIPT_DEPLOY_WORKFLOW_FILE,
        commitSha: result.commitSha || null,
        code: error.code || "MAINTENANCE_DEPLOYMENT_DISPATCH_FAILED",
        error: safeErrorMessage(error),
        retryPerformed: false,
      });
    }
  }

  const dispatchFailed = deploymentDispatches.some(item => item.status === "DISPATCH_FAILED" || item.status === "PREVIOUS_DISPATCH_FAILED");
  return {
    ...result,
    maintenanceOperation: operation,
    maintenanceDomain: "SYSTEM",
    changedPaths,
    changedPathReadError,
    expectedDeployments,
    deploymentDispatches,
    deploymentObservation: expectedDeployments.length ? "Call maintenanceRead with operation=DEPLOYMENT_STATUS and commitSha until the exact workflow run completes." : "NO_DEPLOYMENT_REQUIRED",
    requiresManualDeployment: dispatchFailed || deploymentDispatches.some(item => item.status === "MANUAL_GATE_RETAINED"),
  };
}

async function getMaintenanceDeploymentStatus(payload, env) {
  const commitSha = String(payload.commitSha || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw Object.assign(new Error("DEPLOYMENT_STATUSにはcommitShaが必要です。"), { code: "MAINTENANCE_COMMIT_SHA_REQUIRED", status: 400 });
  }

  const changedPaths = await getMaintenanceCommitChangedPaths(commitSha, env);
  const specs = maintenanceDeploymentSpecsForPaths(changedPaths, env);
  if (!specs.length) {
    return {
      success: true,
      status: "DEPLOYMENT_NOT_REQUIRED",
      maintenanceOperation: "DEPLOYMENT_STATUS",
      commitSha,
      changedPaths,
      expectedDeployments: [],
      workflows: [],
      writePerformed: false,
    };
  }

  const workflows = [];
  for (const spec of specs) {
    const runs = await getDeploymentRunsForSpec(spec, commitSha, env);
    const latest = runs[0] || null;
    let deploymentStatus = "DEPLOYMENT_PENDING";
    if (latest?.status === "completed") {
      deploymentStatus = latest.conclusion === "success" ? "DEPLOYED" : "DEPLOYMENT_FAILED";
    }
    workflows.push({
      kind: spec.kind,
      workflowFile: spec.workflowFile,
      deploymentStatus,
      runId: latest?.id || null,
      name: latest?.name || null,
      displayTitle: latest?.display_title || null,
      headSha: latest?.head_sha || null,
      status: latest?.status || null,
      conclusion: latest?.conclusion || null,
      runNumber: latest?.run_number || null,
      updatedAt: latest?.updated_at || null,
    });
  }

  let status = "DEPLOYMENT_PENDING";
  if (workflows.some(item => item.deploymentStatus === "DEPLOYMENT_FAILED")) status = "DEPLOYMENT_FAILED";
  else if (workflows.every(item => item.deploymentStatus === "DEPLOYED")) status = "DEPLOYED";

  return {
    success: status !== "DEPLOYMENT_FAILED",
    status,
    maintenanceOperation: "DEPLOYMENT_STATUS",
    commitSha,
    changedPaths,
    expectedDeployments: specs.map(spec => spec.kind),
    workflows,
    writePerformed: false,
  };
}

async function callAppsScript(action, body, actor, env, retrySafe, requestId) {
  const url = normalizeAppsScriptUrl(requiredEnv(env, "APOS_APPS_SCRIPT_URL"));
  const attempts = retrySafe ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), retrySafe ? BACKEND_READ_TIMEOUT_MS : BACKEND_WRITE_TIMEOUT_MS);
    try {
      const envelope = await buildSignedEnvelope(action, body, actor, requestId, env);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "accept": "application/json" },
        body: JSON.stringify(envelope),
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw Object.assign(new Error(`Apps Script HTTP ${response.status}`), { code: "BACKEND_HTTP_ERROR", status: 502 });
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { throw Object.assign(new Error("Apps ScriptがJSON以外を返しました。"), { code: "BACKEND_NON_JSON", status: 502 }); }
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError?.name === "AbortError") throw Object.assign(new Error("Apps Script応答がタイムアウトしました。"), { code: "BACKEND_TIMEOUT", status: 504 });
  throw Object.assign(new Error("Apps Scriptへ接続できません。"), { code: lastError?.code || "BACKEND_FETCH_FAILED", status: lastError?.status || 502 });
}

async function buildSignedEnvelope(action, body, actor, requestId, env) {
  const timestamp = new Date().toISOString();
  const nonce = `APOS-GW-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const normalizedBody = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const normalizedActor = {
    id: sanitizeActor(actor?.id || "apostrophe"),
    source: sanitizeActor(actor?.source || "UNKNOWN"),
  };
  const bodyHash = await sha256Hex(canonicalJson(normalizedBody));
  const signatureDocument = {
    protocolVersion: GATEWAY_PROTOCOL,
    timestamp,
    nonce,
    action: String(action),
    requestId: String(requestId),
    bodyHash,
    actor: normalizedActor,
  };
  const signature = await hmacSha256Hex(canonicalJson(signatureDocument), requiredEnv(env, "APOS_GATEWAY_HMAC_SECRET"));
  return { ...signatureDocument, body: normalizedBody, signature };
}

function actionFromPath(pathname) {
  const match = pathname.match(/^\/api\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

function isAllowedOrigin(origin, env) {
  const allowed = new Set(csv(env.APOS_ALLOWED_ORIGINS));
  const publicUrl = sitePublicUrl(env);
  if (publicUrl) {
    try {
      allowed.add(new URL(publicUrl).origin);
    } catch {}
  }
  return !origin || allowed.has(origin);
}

function corsHeaders(origin, env) {
  const headers = {};
  if (origin && isAllowedOrigin(origin, env)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "authorization,content-type,x-api-key,x-apos-gateway-token,x-apos-actor,x-request-id,cf-access-jwt-assertion";
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-max-age"] = "600";
  }
  return headers;
}

function securityHeaders(extra = {}) {
  return {
    ...extra,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function json(body, status, requestId, extraHeaders = {}) {
  return new Response(JSON.stringify({ ...body, requestId: body.requestId || requestId, workerVersion: VERSION }), {
    status,
    headers: securityHeaders(extraHeaders),
  });
}

function backendStatus(code) {
  if (!code) return 500;
  if (/AUTH|UNAUTHORIZED|APPROVER/.test(code)) return 401;
  if (/FOREIGN_KEY|REFERENTIAL|REUSE|DUPLICATE|PREVIEW_NOT_AVAILABLE|OUTSIDE_PREVIEW|NOT_AVAILABLE/.test(code)) return 409;
  if (/NOT_FOUND/.test(code)) return 404;
  if (/EXPIRED|MISMATCH|CONCURRENT|STATE_HASH|STATE_CHANGED|REPLAY/.test(code)) return 409;
  if (/TOO_LARGE/.test(code)) return 413;
  if (/CONFIG|TOKEN_NOT_CONFIGURED|BACKUP_FOLDER/.test(code)) return 503;
  if (/REQUIRED|INVALID|UNKNOWN|READ_ONLY|DISABLED|NOT_TABULAR|NOT_ALLOWED|OUT_OF_RANGE/.test(code)) return 400;
  return 500;
}

function requiredEnv(env, key) {
  const value = env[key];
  if (!value) throw Object.assign(new Error(`${key}が設定されていません。`), { code: "WORKER_CONFIG_MISSING", status: 503 });
  return value;
}

function normalizeAppsScriptUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw Object.assign(new Error("APOS_APPS_SCRIPT_URLがURLではありません。"), { code: "WORKER_CONFIG_INVALID", status: 503 }); }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com") {
    throw Object.assign(new Error("Apps Scriptのhttps://script.google.com/macros/s/.../exec URLを設定してください。"), { code: "WORKER_CONFIG_INVALID", status: 503 });
  }
  if (/\/dev\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/dev\/?$/, "/exec");
  if (!/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) {
    throw Object.assign(new Error("APOS_APPS_SCRIPT_URLはWebアプリの/exec URLである必要があります。"), { code: "WORKER_CONFIG_INVALID", status: 503 });
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function csv(value) { return String(value || "").split(",").map(item => item.trim()).filter(Boolean); }
function sanitizeActor(value) { return String(value || "apostrophe").replace(/[^\p{L}\p{N}@._+\- ]/gu, "").slice(0, 120) || "apostrophe"; }
function sanitizeRequestId(value) { return String(value || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 96); }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function normalizeTeamDomain(value) { return String(value || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); }
function safeErrorMessage(error) { return error?.code ? String(error.message || "処理に失敗しました。") : "内部エラーが発生しました。"; }

async function secureEqual(a, b) {
  const encoder = new TextEncoder();
  const [ah, bh] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(a))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(b))),
  ]);
  const av = new Uint8Array(ah); const bv = new Uint8Array(bh);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return bytesToHex(digest);
}

async function hmacSha256Hex(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return bytesToHex(signature);
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlText(value) { return new TextDecoder().decode(base64UrlBytes(value)); }
function base64UrlBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
