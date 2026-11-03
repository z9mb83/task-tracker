// End-to-end: mock Apps Script (POST -> 302 -> JSON, like Google) + Vercel-like server + jsdom browser
const http = require('http'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = require('path').resolve(__dirname, '..');
const SECRET = 'test-secret';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- mock Apps Script ----
const state = { tasks: [], team: [{ name: 'Riya', email: 'r@x.com', role: 'Employee', active: true, hasPin: true }], n: 0 };
const pending = {};
function adminData() {
  const t = state.tasks;
  return { brand: 'Acme', today: '2026-10-30', tasks: t, team: state.team,
    stats: { pending: t.filter(x => x.approval === 'Pending').length, open: t.filter(x => x.approval === 'Approved' && x.status !== 'Done').length, overdue: 0, blocked: 0, doneToday: 0 },
    perEmployee: state.team.map(m => ({ name: m.name, notStarted: 0, inProgress: 0, blocked: 0, overdue: 0, done: 0, pending: 0 })) };
}
const fns = {
  publicInfo: () => ({ brand: 'Acme' }),
  login: (role, id, pw) => { if ((role === 'admin' && pw === 'adminpass1') || (role === 'employee' && id === 'r@x.com' && pw === '123456')) return { token: role + '-tok', name: 'x', role }; throw new Error('Wrong password.'); },
  logout: () => true,
  adminData: tok => { if (tok !== 'admin-tok') throw new Error('SESSION_EXPIRED'); return adminData(); },
  adminAddTask: (tok, t) => { state.lastAdd = t; state.n++; state.tasks.push({ id: 'T-000' + state.n, task: t.task, details: t.details, assignee: t.assignee, priority: t.priority, due: '', dueLabel: '', approval: t.approveNow ? 'Approved' : 'Pending', status: t.approveNow ? 'Not Started' : '', progress: 0, remarks: '', overdue: false }); return adminData(); },
  adminAddEmployee: (tok, e) => { state.team.push({ name: e.name, email: e.email, role: e.role, active: true, hasPin: true }); const d = adminData(); d.newPin = { name: e.name, email: e.email, pin: '999111' }; return d; },
  empData: tok => ({ name: 'Riya Sharma', brand: 'Acme', today: '2026-10-30', tasks: state.tasks.filter(t => t.assignee === 'Riya' && t.approval === 'Approved') }),
  adminRemoveEmployee: (tok, n) => { state.team = state.team.filter(m => m.name !== n); return adminData(); },
  empUpdateTask: (tok, id, st, p, rm) => { const t = state.tasks.find(x => x.id === id); Object.assign(t, { status: st, progress: p, remarks: rm }); return fns.empData(tok); }
};
const gas = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let out; try { const r = JSON.parse(b); if (r.key !== SECRET) throw new Error('Not authorised.');
        if (!fns[r.fn]) throw new Error('Unknown action.'); out = { ok: true, result: fns[r.fn](...r.args) }; }
      catch (e) { out = { ok: false, error: e.message }; }
      const id = Math.random().toString(36).slice(2); pending[id] = out;
      res.writeHead(302, { Location: 'http://127.0.0.1:4101/echo?id=' + id }); res.end();
    });
  } else { const id = new URL(req.url, 'http://x').searchParams.get('id'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending[id])); }
});

// ---- Vercel-like server ----
process.env.APPS_SCRIPT_URL = 'http://127.0.0.1:4101/exec'; process.env.API_SECRET = SECRET;
const handler = require(ROOT + '/api/rpc.js');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const site = http.createServer((req, res) => {
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/rpc') { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { req.body = JSON.parse(b); } catch (e) { req.body = b; } handler(req, res); }); return; }
  let p = u.pathname === '/' ? '/index.html' : u.pathname; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, 'public', p);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', types[path.extname(f)]); res.end(fs.readFileSync(f));
});

async function browse(url) {
  const dom = await JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.__errors = []; w.addEventListener('error', e => w.__errors.push(e.message));
      w.fetch = (u, o) => fetch(new URL(u, url), o); w.localStorage.clear(); } });
  await new Promise(r => dom.window.addEventListener('load', r)); await sleep(150);
  return dom.window;
}
const submit = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event('submit', { cancelable: true }));

(async () => {
  await new Promise(r => gas.listen(4101, r)); await new Promise(r => site.listen(4102, r));
  const out = [];
  // direct API checks
  let r = await fetch('http://127.0.0.1:4102/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'deleteEverything', args: [] }) });
  out.push('blocked unknown fn: ' + r.status + ' ' + (await r.text()));
  r = await fetch('http://127.0.0.1:4102/api/rpc'); out.push('GET rejected: ' + r.status);

  // admin
  let w = await browse('http://127.0.0.1:4102/admin'); let d = w.document;
  out.push('admin login title: ' + d.getElementById('loginTitle').textContent);
  d.getElementById('loginSecret').value = 'wrong'; submit(w, 'loginForm'); await sleep(150);
  out.push('wrong pw error: ' + d.getElementById('loginErr').textContent);
  d.getElementById('loginSecret').value = 'adminpass1'; submit(w, 'loginForm'); await sleep(200);
  out.push('admin app shown: ' + !d.getElementById('appView').classList.contains('hidden') + ', title: ' + d.getElementById('appTitle').textContent);
  out.push('fab visible for admin: ' + !d.getElementById('fab').classList.contains('hidden'));
  out.push('no New task tab for admin: ' + !d.querySelector('.tab[data-tab="newtask"]'));
  d.getElementById('fab').click(); await sleep(30);
  out.push('plus menu: ' + [...d.querySelectorAll('#fabMenu b')].map(b => b.textContent).join(' | ') + ', chatgpt link: ' + d.getElementById('fabGpt').href + ' ' + d.getElementById('fabGpt').target);
  d.getElementById('fabManual').click(); await sleep(30);
  out.push('menu closed after choosing: ' + !d.getElementById('fabMenu'));
  d.getElementById('qtTask').value = 'Quick task from plus'; d.getElementById('qtEmp').value = 'Riya';
  const sb=d.querySelector('#qtForm button[data-mode="now"]'); const ev=new w.Event('submit',{cancelable:true}); ev.submitter=sb; d.getElementById('qtForm').dispatchEvent(ev); await sleep(200);
  out.push('sendNow flag sent: ' + state.lastAdd.sendNow);
  out.push('fab task created + modal closed: ' + state.tasks.some(t => t.task === 'Quick task from plus') + ' ' + !d.getElementById('ov'));
  d.querySelector('.tab[data-tab="team"]').click(); await sleep(30);
  d.getElementById('teName').value = 'Neha'; d.getElementById('teEmail').value = 'n@x.com'; submit(w, 'teForm'); await sleep(200);
  out.push('new employee PIN modal: ' + (d.querySelector('.pin') || {}).textContent);
  d.getElementById('okPin').click();
  d.querySelector('button[data-remove="Neha"]').click(); await sleep(20);
  out.push('remove btn disabled before typing: ' + d.getElementById('rmGo').disabled);
  const rc=d.getElementById('rmConfirm'); rc.value='Neha'; rc.dispatchEvent(new w.Event('input')); 
  d.getElementById('rmGo').click(); await sleep(200);
  out.push('Neha removed: ' + !state.team.some(m => m.name === 'Neha') + ', row gone in UI: ' + !d.querySelector('button[data-remove="Neha"]'));
  d.getElementById('fab').click(); await sleep(30); d.getElementById('fabManual').click(); await sleep(30);
  d.getElementById('qtTask').value = 'Shoot property reel'; d.getElementById('qtEmp').value = 'Riya';
  { const sb2 = d.querySelector('#qtForm button[type=submit]'); const ev2 = new w.Event('submit', { cancelable: true }); ev2.submitter = sb2; d.getElementById('qtForm').dispatchEvent(ev2); } await sleep(200);
  d.querySelector('.tab[data-tab="tasks"]').click(); await sleep(30);
  out.push('task in list: ' + d.getElementById('main').textContent.includes('Shoot property reel'));
  out.push('token persisted: ' + w.localStorage.getItem('tt_admin'));
  out.push('admin errors: ' + JSON.stringify(w.__errors));

  // employee
  w = await browse('http://127.0.0.1:4102/employee'); d = w.document;
  d.getElementById('loginEmail').value = 'r@x.com'; d.getElementById('loginSecret').value = '123456'; submit(w, 'loginForm'); await sleep(200);
  out.push('fab hidden for employee: ' + d.getElementById('fab').classList.contains('hidden'));
  out.push('employee cards: ' + d.querySelectorAll('[data-card]').length + ', greeting: ' + d.getElementById('appTitle').textContent);
  d.querySelector('[data-st="In Progress"]').click(); d.querySelector('[data-pr]').value = 60; d.querySelector('[data-rm]').value = 'Script done';
  d.querySelector('[data-save]').click(); await sleep(200);
  out.push('saved to backend: ' + JSON.stringify(state.tasks[0] && { status: state.tasks[0].status, progress: state.tasks[0].progress, remarks: state.tasks[0].remarks }));
  out.push('employee errors: ' + JSON.stringify(w.__errors));

  // wrong secret
  process.env.API_SECRET = 'nope';
  r = await fetch('http://127.0.0.1:4102/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'publicInfo', args: [] }) });
  out.push('wrong secret: ' + await r.text());
  console.log(out.join('\n')); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
