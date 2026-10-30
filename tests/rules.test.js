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
  login: (role, id, pw) => { state.sessions.A = { role: 'admin', name: 'Admin' }; return { token: 'A' }; },
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
      const id = Math.random().toString(36).slice(2); pending[id] = out; res.writeHead(302, { Location: 'http://127.0.0.1:4301/echo?id=' + id }); res.end(); });
  } else { const id = new URL(req.url, 'http://x').searchParams.get('id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending[id])); }
});
process.env.APPS_SCRIPT_URL = 'http://127.0.0.1:4301/exec'; process.env.API_SECRET = SECRET; process.env.TASK_MANAGER_PIN = TM_PIN;
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
  await new Promise(r => gas.listen(4301, r)); await new Promise(r => site.listen(4302, r));
  const out = [];
  // Task manager
  let w = await browse('http://127.0.0.1:4302/task-manager'); let d = w.document;
  d.getElementById('loginEmail').value = 'Simran'; d.getElementById('loginSecret').value = TM_PIN; submit(w, 'loginForm'); await sleep(250);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  d.querySelector('tr[data-id="T-0002"]').click(); await sleep(30);
  out.push('TM opens Done task -> inputs: ' + d.querySelectorAll('#modalRoot input,#modalRoot select,#modalRoot textarea').length + ', reopen btn: ' + !!d.getElementById('etReopen') + ', note: ' + d.querySelector('.locked-note').textContent.trim());
  d.getElementById('etClose').click();
  d.querySelector('tr[data-id="T-0001"]').click(); await sleep(30);
  out.push('TM opens live task -> title: ' + d.querySelector('#modalRoot h3').textContent + ' | save: ' + d.getElementById('etSave').textContent + ' | cancel: ' + d.getElementById('etCancelTask').textContent);
  d.getElementById('etStart').value = '15:00'; d.getElementById('etStart').dispatchEvent(new w.Event('input'));
  d.getElementById('etSave').click(); await sleep(250);
  out.push('TM change -> toast: ' + d.getElementById('toast').textContent + ' | task unchanged: ' + state.tasks[0].startTime + ' | request: ' + JSON.stringify(state.tasks[0].changeReq.lines.map(l => l.label + ' ' + l.from + '->' + l.to)));
  out.push('TM list shows tag: ' + d.getElementById('main').textContent.includes('Change pending'));
  d.querySelector('tr[data-id="T-0003"]').click(); await sleep(30);
  out.push('TM opens pending task -> save: ' + d.getElementById('etSave').textContent + ' | cancel: ' + d.getElementById('etCancelTask').textContent);
  d.getElementById('etClose').click();
  out.push('TM errors: ' + JSON.stringify(w.__errors));

  // Admin
  w = await browse('http://127.0.0.1:4302/admin'); d = w.document;
  d.getElementById('loginSecret').value = 'x'; submit(w, 'loginForm'); await sleep(250);
  const cards = [...d.querySelectorAll('.approvals-top h3')].map(h => h.textContent.trim());
  out.push('admin overview cards: ' + JSON.stringify(cards) + ' | badge: ' + d.getElementById('pendingCount').textContent);
  out.push('change card lines: ' + [...d.querySelectorAll('.approvals-top .cb-line')].map(x => x.textContent.trim()).join(' / '));
  d.querySelector('button[data-chg="1"][data-id="T-0001"]').click(); await sleep(250);
  out.push('after approve: startTime=' + state.tasks[0].startTime + ', request cleared=' + !state.tasks[0].changeReq + ', employee emailed=' + state.sent.includes('T-0001') + ' | toast: ' + d.getElementById('toast').textContent);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  d.querySelector('tr[data-id="T-0002"]').click(); await sleep(30);
  out.push('admin opens Done task -> inputs: ' + d.querySelectorAll('#modalRoot input,#modalRoot select,#modalRoot textarea').length + ', reopen btn: ' + !!d.getElementById('etReopen'));
  d.getElementById('etReopen').click(); out.push('reopen confirm: ' + d.getElementById('etReopen').textContent);
  d.getElementById('etReopen').click(); await sleep(250);
  out.push('after reopen: ' + state.tasks[1].status + ' / ' + state.tasks[1].reopened);
  d.querySelector('tr[data-id="T-0001"]').click(); await sleep(30);
  out.push('admin live task approval options: ' + [...d.getElementById('etApp').options].map(o => o.value).join('/') + ' | email note: ' + d.getElementById('modalRoot').textContent.includes('employee is emailed'));
  d.getElementById('etClose').click();
  out.push('admin errors: ' + JSON.stringify(w.__errors));

  // Email confirm page for a change request
  state.tasks[0].changeReq = { by: 'Simran', at: 2, cancel: false, lines: [{ label: 'Time limit', from: '45 min', to: '60 min' }], raw: { limit: 60 } };
  w = await browse('http://127.0.0.1:4302/approve?t=T-0001.c2.9.sig&a=approve_change'); d = w.document;
  out.push('email page: ' + d.getElementById('content').textContent.replace(/\s+/g, ' ').slice(0, 120));
  d.querySelector('[data-a="approve_change"]').click(); await sleep(250);
  out.push('email approve -> ' + d.getElementById('content').textContent.replace(/\s+/g, ' ').trim().slice(0, 70) + ' | limit now ' + state.tasks[0].limit);
  w = await browse('http://127.0.0.1:4302/approve?t=T-0001.c2.9.sig'); d = w.document;
  out.push('reopen same link: ' + d.getElementById('content').textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
  out.push('email page errors: ' + JSON.stringify(w.__errors));
  console.log(out.join('\n')); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
