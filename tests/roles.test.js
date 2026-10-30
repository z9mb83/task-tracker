// Roles test: task manager, admin approvals, email approve page, employee
const http = require('http'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = require('path').resolve(__dirname, '..');
const SECRET = 's3cret', TM_PIN = '4321';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const state = { tasks: [], n: 0, sessions: {}, seenLogin: [], sent: [], team: [
  { name: 'Aryan', email: 'a@x.com', role: 'Employee', active: true, hasPin: true }] };
function sess(tok, roles) { const s = state.sessions[tok]; if (!s) throw new Error('SESSION_EXPIRED'); if (roles && !roles.includes(s.role)) throw new Error('Not allowed.'); return s; }
function data(tok) {
  const s = sess(tok, ['admin', 'manager']); const t = state.tasks;
  return { role: s.role, me: s.name, brand: '', today: '2026-10-30', tasks: JSON.parse(JSON.stringify(t)),
    team: s.role === 'manager' ? state.team.map(m => ({ name: m.name, role: m.role, active: m.active })) : state.team,
    stats: { pending: t.filter(x => x.approval === 'Pending').length, open: 0, overdue: 0, blocked: 0, doneToday: 0 },
    perEmployee: [{ name: 'Aryan', notStarted: 0, inProgress: 0, blocked: 0, overdue: 0, done: 0, pending: 0 }] };
}
const fns = {
  publicInfo: () => ({ brand: '' }),
  login: (role, id, pw) => { if (role === 'admin' && pw === 'adminpass1') { state.sessions.A = { role: 'admin', name: 'Admin' }; return { token: 'A' }; } throw new Error('Wrong password.'); },
  managerLogin: (name, ok) => { state.seenLogin.push([name, ok]); if (ok !== true) throw new Error('Wrong PIN.'); state.sessions.M = { role: 'manager', name }; return { token: 'M', name, role: 'manager' }; },
  logout: () => true,
  adminData: tok => data(tok),
  adminSyncNow: tok => data(tok),
  adminAddTask: (tok, t) => { const s = sess(tok, ['admin', 'manager']); state.n++;
    const isA = s.role === 'admin';
    state.lastAdd = t;
    state.tasks.push({ id: 'T-000' + state.n, limit: t.limit, startTime: t.startTime, due: t.due, dueAtMs: Date.now() + 32*60000, dueLabel: '31 Oct, 11:45 AM', task: t.task, details: t.details || '', assignee: t.assignee, priority: t.priority, due: '', dueLabel: '',
      approval: isA && (t.approveNow || t.sendNow) ? 'Approved' : 'Pending', status: '', progress: 0, remarks: '', overdue: false,
      createdBy: isA ? 'Admin' : s.name });
    if (isA && t.sendNow) state.sent.push('T-000' + state.n);
    const d = data(tok); d.emailed = isA && t.sendNow ? 1 : 0; return d; },
  adminUpdateTask: (tok, id, t) => { const s = sess(tok, ['admin', 'manager']);
    if (s.role === 'manager' && t.approval !== undefined && t.approval !== 'Cancelled') throw new Error('Only the admin can approve or reject tasks.');
    const x = state.tasks.find(y => y.id === id); const was = x.approval; Object.assign(x, t); delete x.sendNow;
    let em = 0; if (t.sendNow && x.approval === 'Approved' && was !== 'Approved') { state.sent.push(id); em = 1; }
    const d = data(tok); d.emailed = em; return d; },
  decisionInfo: tok => { if (tok !== 'T-0001.999.sig') throw new Error('This link is not valid.'); const t = state.tasks.find(x => x.id === 'T-0001'); return t; },
  decide: (tok, a) => { const t = state.tasks.find(x => x.id === 'T-0001'); if (t.approval !== 'Pending') return { id: t.id, approval: t.approval, already: true };
    t.approval = a === 'reject' ? 'Rejected' : 'Approved'; if (a === 'approve_now') state.sent.push(t.id); return { id: t.id, approval: t.approval, already: false, emailed: a === 'approve_now' ? 1 : 0 }; },
  empData: () => ({ name: 'Aryan', tasks: [
    { id: 'T-0101', task: 'Open ticket', details: '', priority: 'High', approval: 'Approved', status: 'In Progress', progress: 0.3, remarks: '', dueLabel: '31 Oct, 11:45 AM', limit: 45, dueAtMs: Date.now() + 32*60000, overdue: false, taken: '' },
    { id: 'T-0102', task: 'Late ticket', details: '', priority: 'Low', approval: 'Approved', status: 'Not Started', progress: 0, remarks: '', dueLabel: '31 Oct, 10:00 AM', limit: 30, dueAtMs: Date.now() - 7*60000, overdue: true, taken: '' },
    { id: 'T-0103', task: 'Done ticket', details: '', priority: 'Low', approval: 'Approved', status: 'Done', progress: 1, remarks: '', dueLabel: '31 Oct, 9:45 AM', limit: 45, dueAtMs: Date.now() - 90*60000, overdue: false, taken: 52 } ] }),
  login2: () => {}
};
const pending = {};
const gas = http.createServer((req, res) => {
  if (req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let out; try { const r = JSON.parse(b); if (r.key !== SECRET) throw new Error('Not authorised.'); if (!fns[r.fn]) throw new Error('Unknown action.');
        out = { ok: true, result: fns[r.fn](...r.args) }; } catch (e) { out = { ok: false, error: e.message }; }
      const id = Math.random().toString(36).slice(2); pending[id] = out; res.writeHead(302, { Location: 'http://127.0.0.1:4201/echo?id=' + id }); res.end(); });
  } else { const id = new URL(req.url, 'http://x').searchParams.get('id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending[id])); }
});
process.env.APPS_SCRIPT_URL = 'http://127.0.0.1:4201/exec'; process.env.API_SECRET = SECRET; process.env.TASK_MANAGER_PIN = TM_PIN;
delete require.cache[ROOT + '/api/rpc.js'];
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
const submitWith = (w, formId, mode) => { const f = w.document.getElementById(formId); const ev = new w.Event('submit', { cancelable: true });
  ev.submitter = mode ? f.querySelector(`button[data-mode="${mode}"]`) : null; f.dispatchEvent(ev); };
const vis = (d, sel) => { const el = d.querySelector(sel); return !!el && !el.classList.contains('hidden'); };

(async () => {
  await new Promise(r => gas.listen(4201, r)); await new Promise(r => site.listen(4202, r));
  const out = [];
  // ---- task manager ----
  let w = await browse('http://127.0.0.1:4202/task-manager'); let d = w.document;
  out.push('TM login labels: ' + d.getElementById('loginRole').textContent + ' / ' + d.querySelector('#emailField label').textContent + ' / ' + d.getElementById('secretLabel').textContent);
  d.getElementById('loginEmail').value = 'Simran'; d.getElementById('loginSecret').value = '0000'; submitWith(w, 'loginForm'); await sleep(200);
  out.push('wrong PIN: ' + d.getElementById('loginErr').textContent + ' | Apps Script saw: ' + JSON.stringify(state.seenLogin.at(-1)));
  d.getElementById('loginSecret').value = TM_PIN; submitWith(w, 'loginForm'); await sleep(250);
  out.push('right PIN forwards only name+true: ' + JSON.stringify(state.seenLogin.at(-1)));
  out.push('TM title: ' + d.getElementById('appTitle').textContent);
  out.push('TM tabs: approvals visible=' + vis(d, '.tab[data-tab="approvals"]') + ', team visible=' + vis(d, '.tab[data-tab="team"]') + ', tasks visible=' + vis(d, '.tab[data-tab="tasks"]') + ', fab=' + vis(d, '#fab'));
  d.getElementById('fab').click(); await sleep(30);
  out.push('time fields default: date=' + (d.getElementById('qtDue').value.length === 10) + ', start=' + d.getElementById('qtStart').value + ', limit=' + d.getElementById('qtLimit').value + ', options=' + [...d.getElementById('qtLimit').options].map(o => o.textContent).join('/'));
  d.getElementById('qtStart').value = '11:00'; d.getElementById('qtStart').dispatchEvent(new w.Event('input'));
  out.push('preview: ' + d.getElementById('qtPrev').textContent);
  d.getElementById('qtLimit').value = '60'; d.getElementById('qtLimit').dispatchEvent(new w.Event('input'));
  out.push('preview 60: ' + d.getElementById('qtPrev').textContent);
  d.getElementById('qtLimit').value = '45'; d.getElementById('qtLimit').dispatchEvent(new w.Event('input'));
  out.push('TM form buttons: ' + [...d.querySelectorAll('#qtForm button[type=submit]')].map(b => b.textContent.trim()).join(' | '));
  d.getElementById('qtTask').value = 'Design Diwali creatives'; submitWith(w, 'qtForm', 'submit'); await sleep(250);
  out.push('payload time: ' + JSON.stringify({ start: state.lastAdd.startTime, limit: state.lastAdd.limit, dueOk: /^\d{4}-\d{2}-\d{2}$/.test(state.lastAdd.due) }));
  out.push('TM task saved: ' + JSON.stringify({ approval: state.tasks[0].approval, createdBy: state.tasks[0].createdBy }));
  out.push('toast: ' + d.getElementById('toast').textContent);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  out.push('due cell: ' + JSON.stringify([...d.querySelectorAll('td[data-label="Due"]')].map(x => x.textContent)));
  out.push('Added by shown: ' + d.getElementById('main').textContent.includes('Added by Simran'));
  d.querySelector('tr[data-id="T-0001"]').click(); await sleep(30);
  out.push('TM edit: approval select present=' + !!d.getElementById('etApp') + ', cancel btn=' + !!d.getElementById('etCancelTask'));
  d.getElementById('etTask').value = 'Design Diwali creatives (3 sizes)'; d.getElementById('etSave').click(); await sleep(200);
  out.push('TM edited title: ' + state.tasks[0].task + ' | approval unchanged: ' + state.tasks[0].approval);
  // TM tries to approve via API directly -> blocked
  let r = await fetch('http://127.0.0.1:4202/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'adminUpdateTask', args: ['M', 'T-0001', { approval: 'Approved' }] }) });
  out.push('TM approve via API: ' + (await r.json()).error);
  r = await fetch('http://127.0.0.1:4202/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'managerLogin', args: ['x', true] }) });
  out.push('browser calling managerLogin directly: ' + r.status + ' ' + (await r.json()).error);
  // second TM task, then cancel it
  d.getElementById('fab').click(); await sleep(30); d.getElementById('qtTask').value = 'Old idea'; submitWith(w, 'qtForm', 'submit'); await sleep(250);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  d.querySelector('tr[data-id="T-0002"]').click(); await sleep(30);
  d.getElementById('etCancelTask').click(); out.push('cancel asks confirm: ' + d.getElementById('etCancelTask').textContent);
  d.getElementById('etCancelTask').click(); await sleep(200);
  out.push('T-0002 now: ' + state.tasks[1].approval);
  out.push('TM errors: ' + JSON.stringify(w.__errors));

  // ---- email approve page ----
  w = await browse('http://127.0.0.1:4202/approve?t=' + encodeURIComponent('T-0001.999.sig') + '&a=approve_now'); d = w.document;
  out.push('approve page shows task: ' + d.getElementById('content').textContent.includes('Design Diwali creatives (3 sizes)') + ', added by: ' + d.getElementById('content').textContent.includes('Added by Simran'));
  out.push('token removed from URL: ' + !w.location.search.includes('t='));
  out.push('preselected: ' + (d.querySelector('.picked') || {}).dataset?.a);
  d.querySelector('[data-a="approve_now"]').click(); await sleep(200);
  out.push('result: ' + d.getElementById('content').textContent.trim().slice(0, 80) + ' | emailed list: ' + JSON.stringify(state.sent));
  w = await browse('http://127.0.0.1:4202/approve?t=' + encodeURIComponent('T-0001.999.sig')); d = w.document;
  out.push('reopen link: ' + d.getElementById('content').textContent.trim().slice(0, 40));
  w = await browse('http://127.0.0.1:4202/approve?t=bad'); d = w.document;
  out.push('bad link: ' + d.getElementById('content').textContent.trim().slice(0, 40));
  out.push('approve page errors: ' + JSON.stringify(w.__errors));

  // ---- admin ----
  w = await browse('http://127.0.0.1:4202/admin'); d = w.document;
  d.getElementById('loginSecret').value = 'adminpass1'; submitWith(w, 'loginForm'); await sleep(250);
  out.push('admin tabs: approvals=' + vis(d, '.tab[data-tab="approvals"]') + ', team=' + vis(d, '.tab[data-tab="team"]'));
  d.getElementById('fab').click(); await sleep(30);
  out.push('admin form buttons: ' + [...d.querySelectorAll('#qtForm button[type=submit]')].map(b => b.textContent.trim()).join(' | '));
  d.getElementById('qtTask').value = 'Pending one'; submitWith(w, 'qtForm', 'summary'); await sleep(250);
  // make a pending task to approve: TM-created style
  state.tasks.push({ id: 'T-0009', task: 'Needs approval', details: '', assignee: 'Aryan', priority: 'Low', approval: 'Pending', status: '', progress: 0, remarks: '', createdBy: 'Simran' });
  d.querySelector('.tab[data-tab="approvals"]').click(); await sleep(300);
  d.querySelector('.tab[data-tab="approvals"]').click(); await sleep(50);
  // reload data so T-0009 shows
  d.getElementById('refreshBtn').click(); await sleep(250); d.querySelector('.tab[data-tab="approvals"]').click(); await sleep(30);
  d.querySelector('.tab[data-tab="overview"]').click(); await sleep(30);
  const top = d.querySelector('.approvals-top');
  out.push('overview approvals card first: ' + (!!top && d.getElementById('main').firstElementChild === top) + ', buttons: ' + (top ? top.querySelectorAll('button[data-id="T-0009"]').length : 0));
  d.querySelector('.stat[data-goto]').click(); await sleep(30);
  out.push('stat click -> tab: ' + d.querySelector('.tab.active').dataset.tab);
  out.push('approval buttons: ' + [...d.querySelectorAll('button[data-id="T-0009"]')].map(b => b.textContent.trim()).join(' | '));
  d.querySelector('button[data-id="T-0009"][data-send="1"]').click(); await sleep(250);
  out.push('T-0009: ' + state.tasks.find(t => t.id === 'T-0009').approval + ', emailed: ' + state.sent.includes('T-0009') + ' | toast: ' + d.getElementById('toast').textContent);
  out.push('admin errors: ' + JSON.stringify(w.__errors));

  // ---- employee page unchanged ----
  w = await browse('http://127.0.0.1:4202/employee'); d = w.document;
  out.push('employee login role label: ' + d.getElementById('loginRole').textContent + ', email label: ' + d.querySelector('#emailField label').textContent);
  fns.login = (role, id, pw) => { state.sessions.E = { role: 'employee' }; return { token: 'E' }; };
  d.getElementById('loginEmail').value = 'a@x.com'; d.getElementById('loginSecret').value = '1'; submitWith(w, 'loginForm'); await sleep(250);
  out.push('employee cards order: ' + [...d.querySelectorAll('[data-card]')].map(c => c.dataset.card).join(','));
  out.push('countdowns: ' + [...d.querySelectorAll('.cd')].map(e => e.textContent + (e.classList.contains('late') ? '(late)' : '')).join(' | '));
  out.push('taken: ' + [...d.querySelectorAll('.taken')].map(e => e.textContent + (e.classList.contains('over') ? '(over)' : '')).join(' | '));
  out.push('employee errors: ' + JSON.stringify(w.__errors));
  console.log(out.join('\n')); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
