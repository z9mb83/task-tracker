/**
 * Minimal OAuth 2.1 for the ChatGPT plugin (MCP server at /api/mcp).
 * Stateless: client IDs, codes and tokens are HMAC-signed blobs, so nothing is stored.
 * Signing key: MCP_TOKEN_SECRET if set, otherwise derived from API_SECRET.
 * Change MCP_TOKEN_SECRET (or API_SECRET) to sign everyone out of ChatGPT.
 */
const crypto = require('crypto');

const ACCESS_SECONDS = 3600;              // 1 hour
const REFRESH_SECONDS = 30 * 24 * 3600;   // 30 days, then the admin signs in again
const CODE_SECONDS = 300;                 // 5 minutes
const DEFAULT_REDIRECT_HOSTS = ['chatgpt.com', 'chat.openai.com'];

function signingKey() {
  const own = (process.env.MCP_TOKEN_SECRET || '').trim();
  if (own) return own;
  const api = (process.env.API_SECRET || '').replace(/\s+/g, '');
  if (!api) throw Object.assign(new Error('API_SECRET missing in Vercel.'), { status: 500 });
  return crypto.createHmac('sha256', api).update('task-tracker-mcp-oauth-v1').digest('hex');
}

const b64u = buf => Buffer.from(buf).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return body + '.' + mac;
}

/** Returns the payload if the signature is right, the type matches and it has not expired; else null. */
function verify(token, typ) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const want = crypto.createHmac('sha256', signingKey()).update(parts[0]).digest();
  let got;
  try { got = Buffer.from(parts[1], 'base64url'); } catch (e) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || p.typ !== typ) return null;
  if (p.exp && p.exp < now()) return null;
  return p;
}

function redirectHosts() {
  const extra = (process.env.MCP_REDIRECT_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_REDIRECT_HOSTS.concat(extra);
}

/** Only ChatGPT's own callback pages may receive codes. */
function allowedRedirect(uri) {
  let u;
  try { u = new URL(String(uri)); } catch (e) { return false; }
  const hosts = redirectHosts();
  const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && hosts.includes(u.hostname);
  return (u.protocol === 'https:' || local) && hosts.includes(u.hostname) && !u.username && !u.password;
}

/** client_id is either one we signed at registration, or a ChatGPT-hosted URL (client metadata document). */
function clientRedirects(clientId) {
  const c = verify(clientId, 'client');
  if (c) return c.ru;
  try {
    const u = new URL(String(clientId));
    if (u.protocol === 'https:' && redirectHosts().includes(u.hostname)) return null;   // any allowed ChatGPT redirect
  } catch (e) { /* not a URL */ }
  return false;
}

/** True when the redirect URI is allowed for this client. */
function redirectOk(clientId, redirectUri) {
  if (!allowedRedirect(redirectUri)) return false;
  const list = clientRedirects(clientId);
  if (list === false) return false;
  return list === null || list.includes(redirectUri);
}

function pkceOk(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const v = crypto.createHash('sha256').update(String(verifier)).digest('base64url');
  return v.length === String(challenge).length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(String(challenge)));
}

function baseUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() : 'https';
  return proto + '://' + host;
}

function newTokens(clientId) {
  const t = now();
  return {
    access_token: sign({ typ: 'at', cid: clientId, iat: t, exp: t + ACCESS_SECONDS }),
    token_type: 'Bearer',
    expires_in: ACCESS_SECONDS,
    refresh_token: sign({ typ: 'rt', cid: clientId, iat: t, exp: t + REFRESH_SECONDS }),
    scope: 'tasks'
  };
}

/** Parses a JSON or form body that Vercel may hand over as an object or a string. */
function bodyOf(req) {
  let b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  b = Buffer.isBuffer(b) ? b.toString('utf8') : String(b || '');
  if (!b) return {};
  try { return JSON.parse(b); } catch (e) { /* form */ }
  return Object.fromEntries(new URLSearchParams(b));
}

module.exports = { sign, verify, now, redirectOk, allowedRedirect, pkceOk, baseUrl, newTokens, bodyOf, CODE_SECONDS };
