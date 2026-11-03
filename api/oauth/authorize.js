/**
 * GET  /api/oauth/authorize: sign-in page (admin dashboard password) for the ChatGPT plugin.
 * POST /api/oauth/authorize: checks the password in Apps Script (same lockout as the dashboard),
 *                            then redirects back to ChatGPT with a short-lived code.
 */
const { sign, now, redirectOk, bodyOf, CODE_SECONDS } = require('../../lib/oauth.js');
const { callAppsScript } = require('../../lib/apps.js');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];

function page(res, status, p, error) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  const hidden = FIELDS.map(k => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('');
  res.status(status).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Task Tracker sign-in</title><style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#1c2230;--muted:#636b7a;--line:#dfe2e8;--brand:#1f3a5f;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--ink:#e8ebf0;--muted:#9aa3b2;--line:#2c3340;--brand:#7aa7e0;--bad:#f97066}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;box-sizing:border-box}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px;max-width:380px;width:100%;box-sizing:border-box}
h1{font-size:19px;margin:0 0 6px}p{margin:0 0 16px;color:var(--muted);font-size:13.5px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);font-size:15px}
button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--brand);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.err{color:var(--bad);font-size:13.5px;margin:0 0 12px}</style></head><body>
<form class="card" method="post" action="/api/oauth/authorize">
<h1>Connect ChatGPT to Task Tracker</h1>
<p>ChatGPT will be able to see employee names and add tasks for them. It cannot change or delete tasks.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<label for="pw">Admin dashboard password</label>
<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
${hidden}<button type="submit">Allow</button></form></body></html>`);
}

function checkParams(p) {
  if (p.response_type && p.response_type !== 'code') return 'Unsupported response type.';
  if (!p.client_id || !p.redirect_uri) return 'Missing client details.';
  if (!redirectOk(p.client_id, p.redirect_uri)) return 'This sign-in link is not from ChatGPT.';
  if (!p.code_challenge || (p.code_challenge_method || 'S256') !== 'S256') return 'Missing PKCE code challenge.';
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const p = req.method === 'POST' ? bodyOf(req) : (req.query || {});
  const bad = checkParams(p);
  if (bad) return page(res, 400, {}, bad);   // never redirect to an unchecked URL

  if (req.method === 'GET') return page(res, 200, p, '');
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }

  const pw = String(p.password || '');
  if (!pw) return page(res, 400, p, 'Enter the admin password.');
  try {
    const s = await callAppsScript('login', ['admin', '', pw]);
    if (s && s.token) callAppsScript('logout', [s.token]).catch(() => {});   // only the check was needed
  } catch (err) {
    return page(res, err.status === 400 ? 401 : 502, p, err.message || 'Sign-in failed.');
  }
  const code = sign({ typ: 'code', cid: p.client_id, ru: p.redirect_uri, cc: p.code_challenge, exp: now() + CODE_SECONDS });
  const to = new URL(p.redirect_uri);
  to.searchParams.set('code', code);
  if (p.state) to.searchParams.set('state', p.state);
  res.setHeader('Location', to.toString());
  return res.status(302).end();
};
