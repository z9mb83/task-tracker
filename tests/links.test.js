// Edit rules: locked tasks, task-manager change requests, admin approval (dashboard + email page), reopen
const http = require('http'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const SECRET = 's3cret', TM_PIN = '4321';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = { details: '', priority: 'Medium', due: '2026-10-30', startTime: '13:15', limit: 45, dueLabel: '30 Oct, 2:00 PM',
  dueAtMs: Date.now() + 3600e3, progress: 0, remarks: '', overdue: false, createdBy: 'Admin', taken: '' };
const state = { sessions: {}, sent: [], tasks: [
  Object.assign({}, base, { id: 'T-0001', task: 'Live task', assignee: 'Aryan', approval: 'Approved', status: 'In Progress' }),
  Object.assign({}, base, { id: 'T-0002', task: 'Done task', assignee: 'Aryan', approval: 'Approved', status: 'Done', taken: 40 }),
  Object.assign({}, base, { id: 'T-0003', task: 'Pending task', assignee: 'Aryan', approval: 'Pending', status: '' }) ] };
const stateOf = t => (t.status === 'Done' || ['Rejected', 'Cancelled'].includes(t.approval)) ? 'locked' : t.approval === 'Approved' ? 'live' : 'pending';
const team = [{ name: 'Aryan', email: 'a@x.com', role: 'Employee', active: true, hasPin: true }, { name: 'Riya', email: 'r@x.com', role: 'Employee', active: true, hasPin: true }];
function sess(tok, roles) { const s = state.sessions[tok]; if (!s) throw new Error('SESSION_EXPIRED'); if (roles && !roles.includes(s.role)) throw new Error('Not allowed.'); return s; }
function data(tok) { const s = sess(tok, ['admin', 'manager']); state.tasks.forEach(t => t.state = stateOf(t));
  return { role: s.role, me: s.name, today: '2026-10-30', tasks: JSON.parse(JSON.stringify(state.tasks)), team,
    stats: { pending: state.tasks.filter(t => t.approval === 'Pending').length, changes: state.tasks.filter(t => t.changeReq).length, open: 0, overdue: 0, blocked: 0, doneToday: 0 },
    perEmployee: [] }; }
const fns = {
  publicInfo: () => ({ brand: '' }),
  login: (role, id, pw) => { if (role === 'employee') { state.sessions.E = { role: 'employee' }; return { token: 'E' }; } state.sessions.A = { role: 'admin', name: 'Admin' }; return { token: 'A' }; },
  managerLogin: (name, ok) => { if (!ok) throw new Error('Wrong PIN.'); state.sessions.M = { role: 'manager', name }; return { token: 'M', name, role: 'manager' }; },
  adminData: tok => data(tok), adminSyncNow: tok => data(tok),
  adminUpdateTask: (tok, id, t) => { const s = sess(tok, ['admin', 'manager']); const x = state.tasks.find(y => y.id === id); const st = stateOf(x);
    if (st === 'locked') throw new Error(id + ' is locked.');
    if (s.role === 'manager' && st === 'live') {
      const lines = []; if (t.approval === 'Cancelled') lines.push({ label: 'Cancel task', from: '', to: 'Cancelled' });
      else Object.keys(t).forEach(k => { if (String(t[k]) !== String(x[k])) lines.push({ label: k, from: String(x[k]), to: String(t[k]) }); });
      if (!lines.length) throw new Error('Nothing was changed.');
      x.changeReq = { by: s.name, at: 1, cancel: t.approval === 'Cancelled', lines, raw: t }; const d = data(tok); d.requested = true; return d; }
    Object.assign(x, t); delete x.sendNow; return data(tok); },
  adminDecideChange: (tok, id, ok) => { sess(tok, ['admin']); const x = state.tasks.find(y => y.id === id); const r = x.changeReq; delete x.changeReq;
    if (ok) { if (r.cancel) x.approval = 'Cancelled'; else Object.assign(x, r.raw); state.sent.push(id); } const d = data(tok); d.emailed = ok ? 1 : 0; return d; },
  empData: tok => ({ name: 'Aryan', tasks: JSON.parse(JSON.stringify(state.tasks.filter(t => t.assignee === 'Aryan' && t.approval === 'Approved'))) }),
  empUpdateTask: (tok, id, st, p, rm, links) => { const x = state.tasks.find(y => y.id === id); if (x.status === 'Done') throw new Error('locked');
    Object.assign(x, { status: st, progress: p, remarks: rm }); if (links) x.links = links; state.lastLinks = links; return fns.empData(tok); },
  adminReopen: (tok, id) => { sess(tok, ['admin']); const x = state.tasks.find(y => y.id === id); x.status = 'In Progress'; x.reopened = 'Reopened by Admin'; return data(tok); },
  decisionInfo: tok => { const x = state.tasks.find(y => y.id === 'T-0001'); return Object.assign({}, x, { kind: 'change', change: x.changeReq || null }); },
  decide: (tok, a) => { const x = state.tasks.find(y => y.id === 'T-0001'); if (!x.changeReq) return { id: x.id, kind: 'change', already: true };
    const r = x.changeReq; delete x.changeReq; if (a === 'approve_change') { Object.assign(x, r.raw); state.sent.push(x.id); }
    return { id: x.id, kind: 'change', already: false, approved: a === 'approve_change', emailed: a === 'approve_change' ? 1 : 0 }; }
};
const pending = {};
const gas = http.createServer((req, res) => {
  if (req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let out; try { const r = JSON.parse(b); if (r.key !== SECRET) throw new Error('Not authorised.'); if (!fns[r.fn]) throw new Error('Unknown action.');
        out = { ok: true, result: fns[r.fn](...r.args) }; } catch (e) { out = { ok: false, error: e.message }; }
      const id = Math.random().toString(36).slice(2); pending[id] = out; res.writeHead(302, { Location: 'http://127.0.0.1:4401/echo?id=' + id }); res.end(); });
  } else { const id = new URL(req.url, 'http://x').searchParams.get('id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending[id])); }
});
process.env.APPS_SCRIPT_URL = 'http://127.0.0.1:4401/exec'; process.env.API_SECRET = SECRET; process.env.TASK_MANAGER_PIN = TM_PIN;
const handler = require(ROOT + '/api/rpc.js');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const site = http.createServer((req, res) => {
  res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/rpc') { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { req.body = JSON.parse(b); } catch (e) { req.body = b; } handler(req, res); }); return; }
  let p = u.pathname === '/' ? '/index.html' : u.pathname; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, 'public', p); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', types[path.extname(f)]); res.end(fs.readFileSync(f));
});
async function browse(url) {
  const dom = await JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.__errors = []; w.addEventListener('error', e => w.__errors.push(e.message)); w.fetch = (u, o) => fetch(new URL(u, url), o); w.localStorage.clear(); } });
  await new Promise(r => dom.window.addEventListener('load', r)); await sleep(150); return dom.window;
}
const submit = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event('submit', { cancelable: true }));
(async () => {
  await new Promise(r => gas.listen(4401, r)); await new Promise(r => site.listen(4402, r));
  const out = [];
  state.tasks[1].links = ['https://drive.google.com/drive/folders/abc'];
  // Employee adds links to the live task
  let w = await browse('http://127.0.0.1:4402/employee'); let d = w.document;
  d.getElementById('loginEmail').value = 'a@x.com'; d.getElementById('loginSecret').value = '1'; submit(w, 'loginForm'); await sleep(250);
  const card = d.querySelector('[data-card="T-0001"]');
  out.push('link editor present: ' + !!card.querySelector('[data-newlink]') + ' | done card links: ' + d.querySelector('[data-card="T-0002"] .links').textContent.trim());
  const inp = card.querySelector('[data-newlink]');
  inp.value = 'not a link'; card.querySelector('[data-addlink]').click(); await sleep(20);
  out.push('bad link toast: ' + d.getElementById('toast').textContent);
  inp.value = 'https://www.canva.com/design/XYZ/view'; card.querySelector('[data-addlink]').click();
  inp.value = 'https://drive.google.com/drive/folders/posts'; inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
  inp.value = 'https://i.imgur.com/shot.png';   // typed but not added: Save should include it
  out.push('listed before save: ' + [...card.querySelectorAll('.link-row a')].map(a => a.textContent.trim()).join(', '));
  card.querySelector('[data-rmlink="0"]').click();
  out.push('after remove: ' + [...card.querySelectorAll('.link-row a')].map(a => a.textContent.trim()).join(', '));
  card.querySelector('[data-save]').click(); await sleep(250);
  out.push('saved links: ' + JSON.stringify(state.lastLinks));
  out.push('employee errors: ' + JSON.stringify(w.__errors));
  // Admin sees links in the list and in the task popup
  w = await browse('http://127.0.0.1:4402/admin'); d = w.document;
  d.getElementById('loginSecret').value = 'x'; submit(w, 'loginForm'); await sleep(250);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  out.push('admin list links: ' + [...d.querySelectorAll('tr[data-id="T-0001"] .links a')].map(a => a.textContent.trim() + ' -> ' + a.getAttribute('href') + ' [' + a.target + ']').join(' | '));
  d.querySelector('tr[data-id="T-0001"]').click(); await sleep(30);
  out.push('popup has work links: ' + d.getElementById('modalRoot').textContent.includes('Work links'));
  d.getElementById('etClose').click();
  // Auto refresh: data changes on the server, page updates without a reload
  state.tasks[0].status = 'Done'; state.tasks[0].taken = 12;
  await w.eval('quietRefresh()'); await sleep(250);
  out.push('auto-refresh picked up Done: ' + d.querySelector('tr[data-id="T-0001"] .st').textContent.replace(/\s+/g, ' ').trim());
  // ...but not while a popup is open
  d.querySelector('tr[data-id="T-0003"]').click(); await sleep(30);
  state.tasks[2].task = 'Renamed on server';
  await w.eval('quietRefresh()'); await sleep(250);
  out.push('popup kept open during refresh: ' + !!d.getElementById('ov'));
  out.push('admin errors: ' + JSON.stringify(w.__errors));
  console.log(out.join('\n')); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
