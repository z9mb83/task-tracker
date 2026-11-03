/* ChatGPT plugin: OAuth sign-in + MCP tools, over real HTTP with a Vercel-like router and a mock Apps Script. */
const http = require('http'), crypto = require('crypto'), assert = require('assert'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const calls = [];
// ---- mock Apps Script (POST -> 302 -> GET result, like the real web app) ----
const pending = {};
const gas = http.createServer((req, res) => {
  if (req.method === 'GET') { const id = new URL(req.url, 'http://x').searchParams.get('id'); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(pending[id])); }
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const r = JSON.parse(b); calls.push(r); let out;
    if (r.key !== 'apisecret') out = { ok: false, error: 'Not authorised.' };
    else if (r.fn === 'login') out = r.args[2] === 'right-pass' ? { ok: true, result: { token: 'sess1', role: 'admin' } } : { ok: false, error: 'Wrong password.' };
    else if (r.fn === 'logout') out = { ok: true, result: true };
    else if (r.fn === 'gptContext') out = { ok: true, result: { today: '2026-11-03', timeZone: 'Asia/Kolkata', employees: ['Aryan', 'Neha'] } };
    else if (r.fn === 'gptAddTasks') out = { ok: true, result: r.args[0].map((t, i) => t.assignee === 'Ghost' ? { ok: false, task: t.task, employee: t.assignee, error: 'Pick an active employee.' } : { ok: true, id: 'T-00' + (40 + i), task: t.task, employee: t.assignee, due: t.due }) };
    else out = { ok: false, error: 'Unknown action.' };
    const id = Math.random().toString(36).slice(2); pending[id] = out;
    res.writeHead(302, { Location: 'http://127.0.0.1:4501/r?id=' + id }); res.end();
  });
});

// ---- Vercel-like site: rewrites + helpers (req.query, req.body, res.status/json) ----
process.env.APPS_SCRIPT_URL = 'http://127.0.0.1:4501/exec'; process.env.API_SECRET = 'apisecret';
process.env.MCP_REDIRECT_HOSTS = 'localhost';
const vercel = require(path.join(ROOT, 'vercel.json'));
const fn = p => require(path.join(ROOT, p));
const routes = { '/api/mcp': fn('api/mcp.js'), '/api/oauth/metadata': fn('api/oauth/metadata.js'), '/api/oauth/register': fn('api/oauth/register.js'),
  '/api/oauth/authorize': fn('api/oauth/authorize.js'), '/api/oauth/token': fn('api/oauth/token.js') };
const site = http.createServer((req, res) => {
  let u = new URL(req.url, 'http://localhost');
  for (const r of vercel.rewrites) {
    const re = new RegExp('^' + r.source.replace(/\./g, '\\.').replace(/\/:path\*$/, '(/.*)?') + '$');
    if (re.test(u.pathname)) { u = new URL(r.destination, 'http://localhost'); break; }
  }
  const h = routes[u.pathname]; if (!h) { res.statusCode = 404; return res.end(); }
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  req.query = Object.fromEntries(u.searchParams);
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const ct = String(req.headers['content-type'] || '');
    req.body = !b ? {} : ct.includes('json') ? JSON.parse(b) : ct.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(b)) : b;
    Promise.resolve(h(req, res)).catch(e => { res.statusCode = 500; res.end(String(e)); });
  });
});
const BASE = 'http://localhost:4502';
const form = o => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString(), redirect: 'manual' });
const json = (o, tok) => ({ method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: JSON.stringify(o) });

(async () => {
  await new Promise(r => gas.listen(4501, r)); await new Promise(r => site.listen(4502, r));
  console.log('ChatGPT plugin (OAuth + MCP)');

  // 1. Unauthenticated MCP call points to the resource metadata
  let r = await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  ok(r.status === 401 && /resource_metadata="http:\/\/localhost:4502\/\.well-known\/oauth-protected-resource"/.test(r.headers.get('www-authenticate')), 'no token: 401 with resource_metadata link');
  const prm = await (await fetch(BASE + '/.well-known/oauth-protected-resource')).json();
  ok(prm.resource === BASE + '/api/mcp' && prm.authorization_servers[0] === BASE, 'protected resource metadata names /api/mcp and this server');
  ok((await (await fetch(BASE + '/.well-known/oauth-protected-resource/api/mcp')).json()).resource === BASE + '/api/mcp', 'path-suffixed metadata URL works too');
  const as = await (await fetch(BASE + '/.well-known/oauth-authorization-server')).json();
  ok(as.issuer === BASE && as.code_challenge_methods_supported.includes('S256') && as.registration_endpoint.endsWith('/api/oauth/register'), 'authorization server metadata (PKCE S256, registration)');

  // 2. Registration: only ChatGPT redirect URLs
  r = await fetch(BASE + '/api/oauth/register', json({ client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] }));
  ok(r.status === 400, 'registration with a non-ChatGPT redirect is refused');
  const REDIRECT = 'http://localhost/connector/oauth/cb';
  const reg = await (await fetch(BASE + '/api/oauth/register', json({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] }))).json();
  ok(reg.client_id && reg.token_endpoint_auth_method === 'none', 'ChatGPT registers and gets a client_id');

  // 3. Authorize page
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, state: 'st<1>', code_challenge: challenge, code_challenge_method: 'S256', scope: 'tasks' };
  r = await fetch(BASE + '/api/oauth/authorize?' + new URLSearchParams(q));
  let html = await r.text();
  ok(r.status === 200 && /Admin dashboard password/.test(html) && html.includes('value="st&lt;1&gt;"'), 'sign-in page shows, values escaped');
  r = await fetch(BASE + '/api/oauth/authorize?' + new URLSearchParams(Object.assign({}, q, { redirect_uri: 'https://evil.example/cb' })), { redirect: 'manual' });
  ok(r.status === 400 && !r.headers.get('location'), 'a different redirect URL is refused, no redirect');
  r = await fetch(BASE + '/api/oauth/authorize?' + new URLSearchParams(Object.assign({}, q, { code_challenge: '' })));
  ok(r.status === 400, 'missing PKCE challenge is refused');

  r = await fetch(BASE + '/api/oauth/authorize', form(Object.assign({}, q, { password: 'wrong' })));
  html = await r.text();
  ok(r.status === 401 && /Wrong password/.test(html) && !r.headers.get('location'), 'wrong password: page shows the error, no code');
  r = await fetch(BASE + '/api/oauth/authorize', form(Object.assign({}, q, { password: 'right-pass' })));
  const loc = new URL(r.headers.get('location'));
  ok(r.status === 302 && loc.origin + loc.pathname === REDIRECT && loc.searchParams.get('state') === 'st<1>' && loc.searchParams.get('code'), 'right password: redirect to ChatGPT with code and state');
  await new Promise(x => setTimeout(x, 100));
  ok(calls.some(c => c.fn === 'login' && c.args[0] === 'admin') && calls.some(c => c.fn === 'logout' && c.args[0] === 'sess1'), 'password checked by Apps Script login; the session is dropped');
  const code = loc.searchParams.get('code');

  // 4. Token exchange
  r = await fetch(BASE + '/api/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' }));
  ok(r.status === 400 && (await r.json()).error === 'invalid_grant', 'wrong PKCE verifier is refused');
  r = await fetch(BASE + '/api/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost/other', client_id: reg.client_id, code_verifier: verifier }));
  ok(r.status === 400, 'different redirect_uri at token step is refused');
  let tok = await (await fetch(BASE + '/api/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }))).json();
  ok(tok.access_token && tok.refresh_token && tok.token_type === 'Bearer' && tok.expires_in === 3600, 'code + verifier give access and refresh tokens');
  r = await fetch(BASE + '/api/oauth/token', form({ grant_type: 'authorization_code', code: tok.access_token, code_verifier: verifier }));
  ok(r.status === 400, 'an access token cannot be used as a code');

  // 5. MCP with the token
  const AT = tok.access_token;
  let m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chatgpt' } } }, AT))).json();
  ok(m.result.protocolVersion === '2025-06-18' && m.result.capabilities.tools && /get_context first/.test(m.result.instructions), 'initialize: tools capability and instructions');
  r = await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', method: 'notifications/initialized' }, AT));
  ok(r.status === 202, 'notification answered with 202');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, AT))).json();
  ok(m.result.tools.map(t => t.name).join() === 'get_context,add_tasks' && m.result.tools[0].annotations.readOnlyHint === true, 'tools/list: get_context (read-only) and add_tasks');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_context', arguments: {} } }, AT))).json();
  ok(/Today is 2026-11-03/.test(m.result.content[0].text) && m.result.structuredContent.employees.join() === 'Aryan,Neha', 'get_context returns date and employees');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_tasks', arguments: { tasks: [
    { task: 'Mohali visit report', assignee: 'Aryan', due: '2026-11-04', startTime: '15:00', limit: 99, priority: 'Urgent' },
    { task: 'Ghost task', assignee: 'Ghost', due: '2026-11-04', startTime: '11:00' }] } } }, AT))).json();
  const sent = calls.filter(c => c.fn === 'gptAddTasks').pop().args[0];
  ok(sent[0].limit === 45 && sent[0].priority === 'Medium' && sent[0].sendNow === false, 'bad limit/priority fall back to 45 min / Medium; no email by default');
  ok(/✓ T-0040 · Aryan · Mohali visit report/.test(m.result.content[0].text) && /✗ Ghost · Ghost task: Pick an active employee/.test(m.result.content[0].text) && !m.result.isError,
     'add_tasks reports the ticket ID and the failed one');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'add_tasks', arguments: { tasks: [] } } }, AT))).json();
  ok(m.result.isError === true, 'empty task list is a tool error');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } }, AT))).json();
  ok(m.error && m.error.code === -32602, 'unknown tool is refused');
  m = await (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, AT))).json();
  ok(m.error && m.error.code === -32601, 'unknown method: -32601');

  // 6. Refresh + bad tokens
  r = await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, tok.refresh_token));
  ok(r.status === 401 && /invalid_token/.test(r.headers.get('www-authenticate')), 'a refresh token cannot call the MCP server');
  const forged = AT.split('.')[0] + '.' + Buffer.from('x'.repeat(32)).toString('base64url');
  ok((await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, forged))).status === 401, 'a forged signature is refused');
  const { sign } = require(path.join(ROOT, 'lib/oauth.js'));
  const expired = sign({ typ: 'at', cid: reg.client_id, exp: Math.floor(Date.now() / 1000) - 5 });
  ok((await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 10, method: 'tools/list' }, expired))).status === 401, 'an expired token is refused');
  const t2 = await (await fetch(BASE + '/api/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
  ok(t2.access_token && (await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 11, method: 'ping' }, t2.access_token))).status === 200, 'refresh token gives a working new access token');
  process.env.MCP_TOKEN_SECRET = 'rotated';
  ok((await fetch(BASE + '/api/mcp', json({ jsonrpc: '2.0', id: 12, method: 'ping' }, t2.access_token))).status === 401, 'setting MCP_TOKEN_SECRET signs ChatGPT out');
  delete process.env.MCP_TOKEN_SECRET;
  ok((await fetch(BASE + '/api/mcp', { method: 'GET' })).status === 405, 'GET /api/mcp: 405 (no SSE stream)');

  console.log(pass + ' ChatGPT plugin checks passed');
  gas.close(); site.close();
})().catch(e => { console.error(e); process.exit(1); });
