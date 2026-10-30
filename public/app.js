/* Task Tracker dashboard (Vercel). Talks to Apps Script through /api/rpc. */
const PAGE = ['admin','manager'].includes(window.PAGE) ? window.PAGE : 'employee';
const STAFF = PAGE !== 'employee';     // admin or task manager
const IS_ADMIN = PAGE === 'admin';
let BRAND = '';

// Phone layout: .m on <html> below 700px. ?phone=1 previews it on a desktop browser.
const PHONE_PREVIEW = /[?&]phone=1\b/.test(location.search);
const mq = window.matchMedia ? window.matchMedia('(max-width: 700px)') : { matches: window.innerWidth <= 700 };
function setMobile(){ document.documentElement.classList.toggle('m', mq.matches || PHONE_PREVIEW); }
setMobile();
if (mq.addEventListener) mq.addEventListener('change', setMobile);
if (PHONE_PREVIEW) document.documentElement.classList.add('phone-preview');
const STATUSES = ['Not Started','In Progress','Blocked','Done'];
const PRIORITIES = ['High','Medium','Low'];
const APPROVALS = ['Pending','Approved','Rejected','On Hold','Cancelled'];
const LIMITS = [30, 45, 60];
const DEFAULT_LIMIT = 45;

let token = null, data = null, currentTab = 'overview';
const filters = { q:'', emp:'', approval:'', status:'' };
const store = {
  get(){ try{ return localStorage.getItem('tt_'+PAGE); }catch(e){ return null; } },
  set(v){ try{ v ? localStorage.setItem('tt_'+PAGE, v) : localStorage.removeItem('tt_'+PAGE); }catch(e){} }
};

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(fn, ...args){
  $('busy').classList.remove('hidden');
  let j;
  try {
    const r = await fetch('/api/rpc', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fn, args }) });
    j = await r.json().catch(() => ({ ok:false, error:'Server error (' + r.status + '). Try again.' }));
  } catch (e) {
    j = { ok:false, error:'Network error. Check your connection and try again.' };
  } finally {
    $('busy').classList.add('hidden');
  }
  if (j.ok) return j.result;
  const msg = j.error || 'Something went wrong.';
  if (msg.indexOf('SESSION_EXPIRED') >= 0) { signOut(true); throw new Error('Your session expired. Please sign in again.'); }
  throw new Error(msg);
}
function toast(msg, bad){
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}
function statusPill(s){
  const cls = {'Done':'p-ok','Blocked':'p-bad','In Progress':'p-info','Not Started':'p-grey'}[s] || 'p-grey';
  return s ? `<span class="pill ${cls}">${esc(s)}</span>` : '<span class="muted">-</span>';
}
function approvalPill(a){
  const cls = {'Approved':'p-ok','Rejected':'p-bad','Pending':'p-warn','On Hold':'p-grey'}[a] || 'p-grey';
  return `<span class="pill ${cls}">${esc(a || '-')}</span>`;
}
function prioPill(p){
  const cls = {'High':'p-bad','Medium':'p-warn','Low':'p-grey'}[p] || 'p-grey';
  return p ? `<span class="pill ${cls}">${esc(p)}</span>` : '';
}
function bar(p){ const v = Math.round((p||0)*100); return `<div class="muted" style="font-size:12px">${v}%</div><div class="bar"><i style="width:${v}%"></i></div>`; }
function options(list, sel, blank){ return (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + list.map(x => `<option ${x===sel?'selected':''}>${esc(x)}</option>`).join(''); }
function modal(html){ $('modalRoot').innerHTML = `<div class="overlay" id="ov"><div class="modal">${html}</div></div>`;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeModal(); }); }
function closeModal(){ stopCamera(); $('modalRoot').innerHTML = ''; }

// ---------- login ----------
const PAGE_TITLE = { admin: 'Admin dashboard', manager: 'Task manager', employee: 'My tasks' };
function loginText(){
  $('loginTitle').textContent = (BRAND ? BRAND + ' ' : '') + PAGE_TITLE[PAGE];
  document.title = (BRAND ? BRAND + ' ' : '') + PAGE_TITLE[PAGE];
}
function setupLogin(){
  loginText();
  $('loginRole').textContent = { admin: 'Admin', manager: 'Task manager', employee: 'Employee' }[PAGE];
  $('loginSub').textContent = {
    admin: 'Enter the admin password to manage tasks and your team.',
    manager: 'Enter your name and the task manager PIN. Tasks you add go to the admin for approval.',
    employee: 'Sign in with your work email and the PIN your admin gave you.'
  }[PAGE];
  $('emailField').classList.toggle('hidden', PAGE === 'admin');
  if (PAGE === 'manager') {
    $('emailField').querySelector('label').textContent = 'Your name';
    const n = $('loginEmail'); n.type = 'text'; n.autocomplete = 'name'; n.maxLength = 40;
    try { n.value = localStorage.getItem('tt_manager_name') || ''; } catch (e) {}
  }
  $('secretLabel').textContent = { admin: 'Admin password', manager: 'Task manager PIN', employee: 'PIN' }[PAGE];
  if (PAGE !== 'admin') $('loginSecret').setAttribute('inputmode','numeric');
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginErr').textContent = ''; $('loginBtn').disabled = true;
    try {
      let r;
      if (PAGE === 'manager') {
        const name = $('loginEmail').value.trim();
        if (!name) throw new Error('Enter your name.');
        r = await call('tmLogin', name, $('loginSecret').value);
        try { localStorage.setItem('tt_manager_name', name); } catch (e) {}
      } else {
        r = await call('login', PAGE, $('loginEmail').value, $('loginSecret').value);
      }
      token = r.token; store.set(token); $('loginSecret').value = '';
      await startApp();
    } catch (err) { $('loginErr').textContent = err.message; }
    $('loginBtn').disabled = false;
  });
}
async function signOut(silent){
  if (token && !silent) { try { await call('logout', token); } catch(e){} }
  token = null; data = null; store.set(null);
  $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden');
  $('fab').classList.add('hidden'); closeModal();
  if (silent) $('loginErr').textContent = 'Your session expired. Please sign in again.';
}
async function startApp(){
  $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('adminTabs').classList.toggle('hidden', !STAFF);
  $('fab').classList.toggle('hidden', !STAFF);
  document.querySelectorAll('.tab[data-tab="approvals"], .tab[data-tab="team"], .tab[data-tab="attendance"]').forEach(b => b.classList.toggle('hidden', !IS_ADMIN));
  await reload();
}
async function reload(){
  try {
    data = await call(STAFF ? 'adminData' : 'empData', token);
    lastLoad = Date.now();
    render();
  } catch (err) { toast(err.message, true); }
}

// ---------- render ----------
function render(){
  dirty = false;
  renderInner();
  tickCountdowns();
}
function renderInner(){
  if (STAFF) {
    if (!IS_ADMIN && ['approvals','team','attendance'].includes(currentTab)) currentTab = 'overview';
    $('appTitle').textContent = (data.brand ? data.brand + ' ' : '') + (IS_ADMIN ? 'Admin dashboard' : 'Task manager · ' + (data.me || ''));
    $('appSub').textContent = data.stats.pending + ' waiting for approval · ' + data.stats.overdue + ' overdue';
    const waiting = data.stats.pending + (data.stats.changes || 0);
    const pc = $('pendingCount'); pc.textContent = waiting; pc.classList.toggle('hidden', !waiting);
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
    $('fab').classList.toggle('hidden', currentTab === 'attendance');
    ({overview:renderOverview, tasks:renderTasks, approvals:renderApprovals, newtask:renderNewTask, team:renderTeam, attendance:renderAttendance})[currentTab]();
  } else {
    renderEmployee();
  }
}

function renderOverview(){
  const s = data.stats;
  const rows = data.perEmployee.map(e => `<tr class="click" data-emp="${esc(e.name)}">
    <td class="t-title primary">${esc(e.name)}</td><td class="num" data-label="Not started">${e.notStarted}</td><td class="num" data-label="In progress">${e.inProgress}</td>
    <td class="num" data-label="Blocked">${e.blocked ? `<span class="pill p-bad">${e.blocked}</span>` : 0}</td>
    <td class="num" data-label="Overdue">${e.overdue ? `<span class="overdue">${e.overdue}</span>` : 0}</td>
    <td class="num" data-label="Done">${e.done}</td><td class="num" data-label="Pending">${e.pending}</td></tr>`).join('');
  const attention = data.tasks.filter(t => t.overdue || (t.approval==='Approved' && t.status==='Blocked'));
  const pending = IS_ADMIN ? data.tasks.filter(t => t.approval === 'Pending') : [];
  const changes = IS_ADMIN ? data.tasks.filter(t => t.changeReq) : [];
  $('main').innerHTML = `
    ${pending.length ? `<div class="card approvals-top">
      <h3>Waiting for your approval <span class="count-pill">${pending.length}</span></h3>
      ${approvalsTable(pending)}
    </div>` : ''}
    ${changes.length ? `<div class="card approvals-top">
      <h3>Change requests <span class="count-pill">${changes.length}</span></h3>
      ${changeList(changes)}
    </div>` : ''}
    <div class="stats">
      <div class="stat warn ${IS_ADMIN ? 'click' : ''}" ${IS_ADMIN ? 'data-goto="approvals" title="Open Approvals"' : ''}><div class="n">${s.pending}</div><div class="l">Waiting for approval</div></div>
      <div class="stat"><div class="n">${s.open}</div><div class="l">Open tasks</div></div>
      <div class="stat bad"><div class="n">${s.overdue}</div><div class="l">Overdue</div></div>
      <div class="stat bad"><div class="n">${s.blocked}</div><div class="l">Blocked</div></div>
      <div class="stat ok"><div class="n">${s.doneToday}</div><div class="l">Done in last 24h</div></div>
    </div>
    <div class="card"><h3>By employee</h3><div class="table-wrap"><table class="rt">
      <tr><th>Employee</th><th>Not started</th><th>In progress</th><th>Blocked</th><th>Overdue</th><th>Done</th><th>Pending approval</th></tr>
      ${rows || '<tr><td colspan="7" class="empty">No active employees yet. Add them in the Team tab.</td></tr>'}
    </table></div></div>
    <div class="card"><h3>Needs attention</h3>${taskTable(attention, 'Nothing overdue or blocked.')}</div>`;
  document.querySelectorAll('tr[data-emp]').forEach(tr => tr.onclick = () => { filters.emp = tr.dataset.emp; currentTab = 'tasks'; render(); });
  document.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => { currentTab = el.dataset.goto; render(); window.scrollTo(0, 0); });
  bindTaskRows();
  bindApprovalButtons();
  bindChangeButtons();
}

function taskTable(list, emptyMsg){
  if (!list.length) return `<div class="empty">${esc(emptyMsg)}</div>`;
  return `<div class="table-wrap"><table class="rt">
    <tr><th>ID</th><th>Task</th><th>Employee</th><th>Due</th><th>Priority</th><th>Approval</th><th>Status</th><th class="hide-sm">Remarks</th></tr>
    ${list.map(t => `<tr class="click" data-id="${esc(t.id)}">
      <td class="muted tid">${esc(t.id)}</td>
      <td class="primary"><div class="t-title">${esc(t.task)}</div>${t.details ? `<div class="t-sub clamp">${esc(t.details)}</div>` : ''}${addedBy(t)}${linksHtml(t, true)}</td>
      <td data-label="For">${esc(t.assignee)}</td>
      <td data-label="Due" class="${t.overdue ? 'overdue' : ''}">${esc(dueText(t))}${countdownHtml(t)}</td>
      <td>${prioPill(t.priority)}</td>
      <td>${approvalPill(t.approval)}${t.changeReq ? ' <span class="pill p-info">Change pending</span>' : ''}</td>
      <td class="st">${statusPill(t.status)}${t.status === 'Done' ? takenHtml(t) : t.approval==='Approved' ? bar(t.progress) : ''}</td>
      <td class="hide-sm full">${t.remarks ? `<div class="t-sub">${esc(t.remarks)}</div>` : ''}</td>
    </tr>`).join('')}
  </table></div>`;
}
// ---------- ticket timing ----------
function pad2(n){ return String(n).padStart(2, '0'); }
function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function nextSlot(){ const d = new Date(Date.now() + 15*60000); const m = Math.ceil(d.getMinutes()/15)*15; d.setMinutes(m, 0, 0); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtClock(hhmm){ const [h, m] = hhmm.split(':').map(Number); return (h % 12 || 12) + ':' + pad2(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
function fmtMins(n){ n = Math.round(n); if (n < 60) return n + ' min'; const h = Math.floor(n/60), m = n % 60; return h + ' h' + (m ? ' ' + m + ' min' : ''); }
function dueText(t){ return (t.dueLabel || 'No due date') + (t.limit > 0 && t.limit <= 600 ? ' · ' + t.limit + ' min' : ''); }
function takenHtml(t){
  if (t.status !== 'Done' || t.taken === '' || t.taken == null) return '';
  const over = t.limit && t.taken > t.limit;
  return `<span class="taken ${over ? 'over' : 'ok'}">Took ${fmtMins(t.taken)}${t.limit ? ' / ' + t.limit : ''}</span>`;
}
function countdownHtml(t){
  if (!t.dueAtMs || t.dueAtMs < 1577836800000 || t.status === 'Done' || t.approval !== 'Approved') return '';   // ignore dates before 2020
  return `<span class="cd" data-due="${t.dueAtMs}"></span>`;
}
function tickCountdowns(){
  const now = Date.now();
  document.querySelectorAll('.cd[data-due]').forEach(el => {
    const diff = (Number(el.dataset.due) - now) / 60000;
    el.textContent = diff >= 0 ? (diff < 1 ? 'due now' : fmtMins(Math.ceil(diff)) + ' left') : 'late by ' + fmtMins(Math.ceil(-diff));
    el.classList.toggle('late', diff < 0);
    el.classList.toggle('soon', diff >= 0 && diff <= 15);
  });
}
setInterval(tickCountdowns, 30000);

/** Date + start time + time limit fields (prefix keeps ids unique per form). */
function timeFields(p, t){
  const date = t && t.due ? t.due : todayStr();
  const start = t && t.startTime ? t.startTime : nextSlot();
  const limit = t && t.limit ? Number(t.limit) : DEFAULT_LIMIT;
  return `<div class="row time-row">
      <div class="field"><label>Date</label><input type="date" id="${p}Due" value="${esc(date)}" required></div>
      <div class="field"><label>Start time</label><input type="time" id="${p}Start" value="${esc(start)}" step="300" required></div>
      <div class="field"><label>Time limit</label><select id="${p}Limit">${LIMITS.map(l => `<option value="${l}" ${l===limit?'selected':''}>${l} min</option>`).join('')}</select></div>
    </div>
    <div class="due-preview" id="${p}Prev"></div>`;
}
function bindTimeFields(p){
  const upd = () => {
    const st = $(p+'Start').value, lim = Number($(p+'Limit').value), d = $(p+'Due').value;
    if (!st || !d) { $(p+'Prev').textContent = ''; return; }
    const [h, m] = st.split(':').map(Number); const end = h*60 + m + lim;
    const endStr = pad2(Math.floor(end/60) % 24) + ':' + pad2(end % 60);
    const dt = new Date(d + 'T00:00'); const label = dt.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    $(p+'Prev').innerHTML = `Due by <b>${esc(fmtClock(endStr))}</b>, ${esc(label)}${end >= 1440 ? ' (next day)' : ''}`;
  };
  ['Start','Limit','Due'].forEach(k => $(p+k).addEventListener('input', upd));
  upd();
}
function timeValues(p){ return { due: $(p+'Due').value, startTime: $(p+'Start').value, limit: Number($(p+'Limit').value) }; }

// ---------- work links ----------
function linkLabel(u){
  try { const x = new URL(u); const host = x.hostname.replace(/^www\./, '');
    const kind = /drive\.google|docs\.google/.test(host) ? 'Drive' : /canva\./.test(host) ? 'Canva' : /figma\./.test(host) ? 'Figma'
      : /\.(png|jpe?g|gif|webp)$/i.test(x.pathname) ? 'Image' : host;
    return kind; } catch (e) { return 'Link'; }
}
function safeUrl(u){ return /^https?:\/\//i.test(u) ? u : '#'; }
function linksHtml(t, small){
  if (!t.links || !t.links.length) return '';
  return `<div class="links ${small ? 'small' : ''}">${t.links.map((u, i) =>
    `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="${esc(u)}">🔗 ${esc(linkLabel(u))}${t.links.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('')}</div>`;
}

function addedBy(t){ return t.createdBy ? `<div class="t-sub" style="font-size:11.5px">Added by <b>${esc(t.createdBy)}</b></div>` : ''; }
function bindTaskRows(){ document.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => openTask(tr.dataset.id)); }

function renderTasks(){
  const emps = [...new Set(data.team.filter(m => m.role==='Employee').map(m => m.name))];
  const q = filters.q.toLowerCase();
  const list = data.tasks.filter(t =>
    (!filters.emp || t.assignee === filters.emp) &&
    (!filters.approval || t.approval === filters.approval) &&
    (!filters.status || (filters.status === 'Overdue' ? t.overdue : t.status === filters.status)) &&
    (!q || (t.task + ' ' + t.details + ' ' + t.id + ' ' + t.remarks + ' ' + t.createdBy).toLowerCase().includes(q))
  ).reverse();
  $('main').innerHTML = `<div class="card">
    <div class="row filters" style="margin-bottom:12px">
      <div class="field search"><label>Search</label><input type="text" id="fq" value="${esc(filters.q)}" placeholder="Task, ID, remark or who added it"></div>
      <div class="field"><label>Employee</label><select id="femp">${options(emps, filters.emp, 'All employees')}</select></div>
      <div class="field"><label>Approval</label><select id="fapp">${options(APPROVALS, filters.approval, 'Any')}</select></div>
      <div class="field"><label>Status</label><select id="fst">${options(STATUSES.concat(['Overdue']), filters.status, 'Any')}</select></div>
    </div>
    <div class="muted" style="margin-bottom:8px">${list.length} task(s). Click a task to edit it.</div>
    ${taskTable(list, 'No tasks match these filters.')}
  </div>`;
  $('fq').oninput = e => { filters.q = e.target.value; clearTimeout(renderTasks._t); renderTasks._t = setTimeout(() => { renderTasks(); const el=$('fq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
  $('femp').onchange = e => { filters.emp = e.target.value; renderTasks(); };
  $('fapp').onchange = e => { filters.approval = e.target.value; renderTasks(); };
  $('fst').onchange = e => { filters.status = e.target.value; renderTasks(); };
  bindTaskRows();
}

/** Approve / Hold / Reject table, shared by the Overview card and the Approvals tab. */
function approvalsTable(list){
  return `<div class="table-wrap"><table class="rt">
      <tr><th>ID</th><th>Task</th><th>Employee</th><th>Due</th><th>Priority</th><th>Approval</th><th></th></tr>
      ${list.map(t => `<tr>
        <td class="muted tid">${esc(t.id)}</td>
        <td class="primary"><div class="t-title">${esc(t.task)}</div>${t.details ? `<div class="t-sub clamp">${esc(t.details)}</div>` : ''}${addedBy(t)}</td>
        <td data-label="For">${esc(t.assignee)}</td><td data-label="Due">${esc(dueText(t))}</td><td>${prioPill(t.priority)}</td><td>${approvalPill(t.approval)}</td>
        <td class="btns full">
          <button class="btn ok small" data-act="Approved" data-send="1" data-id="${esc(t.id)}" title="Approve and email the employee now">Approve &amp; send now</button>
          <button class="btn ghost small" data-act="Approved" data-id="${esc(t.id)}" title="Approve; the employee sees it in tonight's summary">Approve</button>
          ${t.approval !== 'On Hold' ? `<button class="btn ghost small" data-act="On Hold" data-id="${esc(t.id)}">Hold</button>` : ''}
          <button class="btn bad small" data-act="Rejected" data-id="${esc(t.id)}">Reject</button>
        </td></tr>`).join('')}
    </table></div>`;
}
function bindApprovalButtons(){
  document.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
    document.querySelectorAll(`button[data-act][data-id="${b.dataset.id}"]`).forEach(x => x.disabled = true);
    const sendNow = b.dataset.send === '1';
    try {
      data = await call('adminUpdateTask', token, b.dataset.id, { approval: b.dataset.act, sendNow });
      toast(b.dataset.id + ': ' + b.dataset.act + (sendNow ? (data.emailed ? ', emailed to employee' : ', but the email could not be sent') : b.dataset.act === 'Approved' ? ', in tonight\'s summary' : ''));
      render();
    } catch (err) {
      toast(err.message, true);
      document.querySelectorAll(`button[data-act][data-id="${b.dataset.id}"]`).forEach(x => x.disabled = false);
    }
  });
}
function renderApprovals(){
  const list = data.tasks.filter(t => t.approval === 'Pending' || t.approval === 'On Hold');
  const changes = data.tasks.filter(t => t.changeReq);
  $('main').innerHTML = `<div class="card"><h3>Waiting for approval</h3>${
    !list.length ? '<div class="empty">Nothing waiting for approval.</div>' : approvalsTable(list)}</div>
    <div class="card"><h3>Change requests</h3>${
    !changes.length ? '<div class="empty">No change requests from task managers.</div>' : changeList(changes)}</div>`;
  bindApprovalButtons();
  bindChangeButtons();
}
function changeList(list){
  return list.map(t => `<div class="change-item">
    <div class="t-title">${esc(t.id)} · ${esc(t.task)}</div>
    <div class="t-sub">For ${esc(t.assignee)} · ${esc(dueText(t))} · ${statusPill(t.status)}</div>
    ${changeBox(t, true)}</div>`).join('');
}

function activeEmployees(){ return data.team.filter(m => m.role === 'Employee' && m.active).map(m => m.name); }

function renderNewTask(){
  const emps = activeEmployees();
  $('main').innerHTML = `<div class="card" style="max-width:720px"><h3>Assign a new task</h3>
    ${!emps.length ? `<div class="empty">${IS_ADMIN ? 'Add an employee in the Team tab first.' : 'No active employees yet. Ask the admin to add them.'}</div>` : `
    <form id="ntForm">
      <div class="field"><label>Task</label><input type="text" id="ntTask" maxlength="200" required placeholder="What needs to be done"></div>
      <div class="field"><label>Details</label><textarea id="ntDetails" placeholder="Instructions, links, expected result"></textarea></div>
      <div class="row">
        <div class="field"><label>Employee</label><select id="ntEmp" required>${options(emps, emps.length === 1 ? emps[0] : '', 'Select employee')}</select></div>
        <div class="field"><label>Priority</label><select id="ntPrio">${options(PRIORITIES, 'Medium')}</select></div>
      </div>
      ${timeFields('nt')}
      ${addButtons('nt', false)}
    </form>`}</div>`;
  const f = $('ntForm'); if (!f) return;
  bindTimeFields('nt');
  f.onsubmit = async e => {
    e.preventDefault();
    if (!$('ntEmp').value) { toast('Pick an employee.', true); return; }
    const sendNow = !!(e.submitter && e.submitter.dataset.mode === 'now');
    const btns = f.querySelectorAll('button[type=submit]'); btns.forEach(b => b.disabled = true);
    const who = $('ntEmp').value;
    try {
      data = await call('adminAddTask', token, Object.assign({ task:$('ntTask').value, details:$('ntDetails').value, assignee:who,
        priority:$('ntPrio').value, approveNow:IS_ADMIN, sendNow }, timeValues('nt')));
      toast(addedMsg(who, sendNow));
      renderNewTask(); $('pendingCount').textContent = data.stats.pending;
    } catch (err) { toast(err.message, true); btns.forEach(b => b.disabled = false); }
  };
}

function renderTeam(){
  const rows = data.team.map(m => `<tr>
    <td class="t-title primary">${esc(m.name)}</td><td class="full muted-m">${esc(m.email)}</td><td>${esc(m.role)}</td>
    <td>${m.active ? '<span class="pill p-ok">Active</span>' : '<span class="pill p-grey">Inactive</span>'}</td>
    <td data-label="PIN">${m.role === 'Employee' ? (m.hasPin ? 'Set' : '<span class="muted">Not set</span>') : '-'}</td>
    <td class="btns full">
      ${m.role === 'Employee' ? `<button class="btn ghost small" data-pin="${esc(m.name)}">${m.hasPin ? 'Reset PIN' : 'Create PIN'}</button>` : ''}
      <button class="btn ghost small" data-toggle="${esc(m.name)}" data-on="${m.active ? '0' : '1'}">${m.active ? 'Deactivate' : 'Activate'}</button>
      <button class="btn bad small" data-remove="${esc(m.name)}">Remove</button>
    </td></tr>`).join('');
  $('main').innerHTML = `
    <div class="card" style="max-width:820px"><h3>Add a team member</h3>
      <form id="teForm"><div class="row">
        <div class="field"><label>Full name</label><input type="text" id="teName" maxlength="60" required></div>
        <div class="field"><label>Email</label><input type="email" id="teEmail" required></div>
        <div class="field role-f"><label>Role</label><select id="teRole">${options(['Employee','Admin'],'Employee')}</select></div>
        <div class="field add-f"><button class="btn" type="submit" id="teBtn">Add</button></div>
      </div>
      <div class="muted">Employees get their own tab in the Employees sheet, edit access to it, and a login PIN for this dashboard.</div></form>
    </div>
    <div class="card"><h3>Team</h3><div class="table-wrap"><table class="rt">
      <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Dashboard PIN</th><th></th></tr>
      ${rows || '<tr><td colspan="6" class="empty">No team members yet.</td></tr>'}
    </table></div></div>`;
  $('teForm').onsubmit = async e => {
    e.preventDefault(); $('teBtn').disabled = true;
    try {
      data = await call('adminAddEmployee', token, { name:$('teName').value, email:$('teEmail').value, role:$('teRole').value });
      renderTeam(); toast('Team member added');
      if (data.newPin) showPin(data.newPin);
    } catch (err) { toast(err.message, true); $('teBtn').disabled = false; }
  };
  document.querySelectorAll('button[data-pin]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { data = await call('adminResetPin', token, b.dataset.pin); renderTeam(); showPin(data.newPin); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  });
  document.querySelectorAll('button[data-remove]').forEach(b => b.onclick = () => confirmRemove(b.dataset.remove));
  document.querySelectorAll('button[data-toggle]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { data = await call('adminSetEmployeeActive', token, b.dataset.toggle, b.dataset.on === '1'); renderTeam(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  });
}

function confirmRemove(name){
  const m = data.team.find(x => x.name === name); if (!m) return;
  const open = data.tasks.filter(t => t.assignee === name && t.approval === 'Approved' && t.status !== 'Done').length;
  modal(`<h3>Remove ${esc(name)}?</h3>
    <p>This will permanently:</p>
    <ul style="margin:0 0 12px 18px;padding:0;line-height:1.7">
      <li>delete their dashboard PIN and sign them out</li>
      <li>delete their name and email (${esc(m.email)}) from the Team list</li>
      ${m.role === 'Employee' ? '<li>remove their access to the Employees sheet and delete their tab</li>' : ''}
    </ul>
    <p class="muted">Their tasks stay in the Admin sheet as history.${open ? ` <b style="color:var(--bad)">${open} open task(s)</b> are still assigned to them; reassign them from All tasks.` : ''}</p>
    <div class="field"><label>Type <b>${esc(name)}</b> to confirm</label><input type="text" id="rmConfirm" autocomplete="off"></div>
    <div class="actions"><button class="btn ghost" id="rmCancel">Cancel</button><button class="btn bad" id="rmGo" disabled>Remove permanently</button></div>`);
  $('rmConfirm').focus();
  $('rmConfirm').oninput = e => { $('rmGo').disabled = e.target.value.trim() !== name; };
  $('rmCancel').onclick = closeModal;
  $('rmGo').onclick = async () => {
    $('rmGo').disabled = true;
    try { data = await call('adminRemoveEmployee', token, name); closeModal(); renderTeam(); toast(name + ' removed'); }
    catch (err) { toast(err.message, true); $('rmGo').disabled = false; }
  };
}

function showPin(p){
  const msg = `Your task dashboard login\nEmail: ${p.email}\nPIN: ${p.pin}`;
  modal(`<h3>Login PIN for ${esc(p.name)}</h3>
    <p class="muted">${p.emailed ? `Emailed to ${esc(p.email)} with the dashboard link. ` : `<b style="color:var(--bad)">The email could not be sent</b>, so share it with ${esc(p.name)} yourself. `}It is shown only once; you can reset it later from the Team tab.</p>
    <div class="pin">${esc(p.pin)}</div>
    <div class="muted" style="margin-bottom:12px">Email: ${esc(p.email)}</div>
    <div class="actions"><button class="btn ghost" id="cpPin">Copy login details</button><button class="btn" id="okPin">Done</button></div>`);
  $('okPin').onclick = closeModal;
  $('cpPin').onclick = () => { navigator.clipboard.writeText(msg).then(() => toast('Copied'), () => toast('Copy failed, select the PIN manually', true)); };
}

function taskStateOf(t){
  if (t.state) return t.state;
  if (t.status === 'Done' || t.approval === 'Rejected' || t.approval === 'Cancelled') return 'locked';
  return t.approval === 'Approved' ? 'live' : 'pending';
}
function changeBox(t, withButtons){
  const r = t.changeReq; if (!r) return '';
  return `<div class="change-box">
    <div class="cb-head"><span class="pill p-info">${r.cancel ? 'Cancel requested' : 'Change requested'}</span> by <b>${esc(r.by)}</b></div>
    ${r.cancel ? '<div class="cb-line"><b style="color:var(--bad)">Cancel this task</b></div>' :
      r.lines.map(l => `<div class="cb-line"><span class="muted">${esc(l.label)}:</span> <s>${esc(l.from)}</s> &rarr; <b>${esc(l.to)}</b></div>`).join('')}
    ${withButtons ? `<div class="btns" style="margin-top:8px">
      <button class="btn ok small" data-chg="1" data-id="${esc(t.id)}">${r.cancel ? 'Approve cancel' : 'Approve change'}</button>
      <button class="btn bad small" data-chg="0" data-id="${esc(t.id)}">Reject</button></div>` : ''}
  </div>`;
}
function bindChangeButtons(after){
  document.querySelectorAll('button[data-chg]').forEach(b => b.onclick = async () => {
    document.querySelectorAll(`button[data-chg][data-id="${b.dataset.id}"]`).forEach(x => x.disabled = true);
    const ok = b.dataset.chg === '1';
    try {
      data = await call('adminDecideChange', token, b.dataset.id, ok);
      toast(b.dataset.id + (ok ? ': change approved' + (data.emailed ? ', employee emailed' : '') : ': change rejected'));
      if (after) after(); render();
    } catch (err) {
      toast(err.message, true);
      document.querySelectorAll(`button[data-chg][data-id="${b.dataset.id}"]`).forEach(x => x.disabled = false);
    }
  });
}
function infoBox(t){
  return `<div class="card" style="background:var(--bg);box-shadow:none;padding:12px">
      <div><b>Employee status:</b> ${statusPill(t.status)} ${t.approval==='Approved' && t.status !== 'Done' ? Math.round(t.progress*100)+'%' : ''} ${takenHtml(t)}</div>
      ${t.remarks ? `<div style="margin-top:6px"><b>Remarks:</b> ${esc(t.remarks)}</div>` : ''}
      ${t.links && t.links.length ? `<div style="margin-top:6px"><b>Work links:</b>${linksHtml(t)}</div>` : ''}
      <div class="muted" style="margin-top:6px;font-size:12px">${t.createdBy ? 'Added by ' + esc(t.createdBy) + ' · ' : ''}Created ${esc(t.created||'-')}${t.approvedOn ? ' · Approved '+esc(t.approvedOn) : ''}${t.updated ? ' · Updated '+esc(t.updated) : ''}${t.completed ? ' · Completed '+esc(t.completed) : ''}${t.reopened ? ' · ' + esc(t.reopened) : ''}</div>
    </div>`;
}

function openTask(id){
  const t = data.tasks.find(x => x.id === id); if (!t) return;
  const state = taskStateOf(t);
  const emps = data.team.filter(m => m.role === 'Employee').map(m => m.name);

  // Done / Rejected / Cancelled: read-only
  if (state === 'locked') {
    const why = t.status === 'Done' ? 'Done' : t.approval;
    modal(`<h3>${esc(t.id)} · ${esc(t.task)}</h3>
      <div class="locked-note">${approvalPill(t.approval)} ${t.status === 'Done' ? statusPill('Done') : ''} <span>This task is ${esc(why)} and locked.</span></div>
      ${t.details ? `<div class="t-sub" style="max-width:none;margin:10px 0;white-space:pre-wrap">${esc(t.details)}</div>` : ''}
      <div class="meta" style="display:flex;gap:8px 14px;flex-wrap:wrap;font-size:13px;margin-bottom:10px">
        <span><span class="muted">For</span> ${esc(t.assignee)}</span><span><span class="muted">Due</span> ${esc(dueText(t))}</span>${prioPill(t.priority)}</div>
      ${infoBox(t)}
      <div class="actions">
        ${IS_ADMIN && t.status === 'Done' ? '<button class="btn ghost" id="etReopen" style="margin-right:auto">Reopen</button>' : ''}
        <button class="btn" id="etClose">Close</button></div>`);
    $('etClose').onclick = closeModal;
    if ($('etReopen')) $('etReopen').onclick = async () => {
      const b = $('etReopen');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to reopen ' + id; b.classList.add('bad'); return; }
      b.disabled = true;
      try { data = await call('adminReopen', token, id); closeModal(); render(); toast(id + ' reopened (In Progress)'); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    };
    return;
  }

  const live = state === 'live';
  const managerRequest = !IS_ADMIN && live;   // task manager editing an approved task -> change request
  modal(`<h3>${esc(t.id)} · ${managerRequest ? 'Request a change' : 'Edit task'}</h3>
    ${managerRequest ? '<div class="locked-note info">This task is approved and with the employee. Your changes go to the admin for approval before they apply.</div>' : ''}
    ${changeBox(t, IS_ADMIN)}
    <div class="field"><label>Task</label><input type="text" id="etTask" value="${esc(t.task)}"></div>
    <div class="field"><label>Details</label><textarea id="etDetails">${esc(t.details)}</textarea></div>
    <div class="row">
      <div class="field"><label>Employee</label><select id="etEmp">${options(emps, t.assignee)}</select></div>
      <div class="field"><label>Priority</label><select id="etPrio">${options(PRIORITIES, t.priority)}</select></div>
    </div>
    ${timeFields('et', t)}
    <div class="row">
      <div class="field"><label>Approval</label>${IS_ADMIN
        ? `<select id="etApp">${options(live ? ['Approved', 'Cancelled'] : APPROVALS, t.approval)}</select>`
        : `<div style="padding:8px 0">${approvalPill(t.approval)}</div>`}</div>
    </div>
    ${IS_ADMIN && !live ? '<div class="field"><label class="switch"><input type="checkbox" id="etSend"> If approving, email the employee now</label></div>' : ''}
    ${IS_ADMIN && live ? '<div class="muted" style="font-size:12px;margin:-4px 0 10px">The employee is emailed if you change the date, time, limit or employee, or cancel the task.</div>' : ''}
    ${infoBox(t)}
    <div class="actions">
      ${!IS_ADMIN ? `<button class="btn bad" id="etCancelTask" style="margin-right:auto">${live ? 'Request cancel' : 'Cancel task'}</button>` : ''}
      <button class="btn ghost" id="etClose">Close</button><button class="btn" id="etSave">${managerRequest ? 'Request change' : 'Save changes'}</button></div>`);
  bindTimeFields('et');
  bindChangeButtons(closeModal);
  $('etClose').onclick = closeModal;
  if ($('etCancelTask')) $('etCancelTask').onclick = async () => {
    const b = $('etCancelTask');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = live ? 'Click again to send cancel request' : 'Click again to cancel ' + id; return; }
    b.disabled = true;
    try {
      data = await call('adminUpdateTask', token, id, { approval: 'Cancelled' });
      closeModal(); render(); toast(data.requested ? 'Cancel request sent to the admin' : id + ' cancelled');
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  $('etSave').onclick = async () => {
    $('etSave').disabled = true;
    try {
      const upd = Object.assign({ task:$('etTask').value, details:$('etDetails').value, assignee:$('etEmp').value,
        priority:$('etPrio').value }, timeValues('et'));
      if (IS_ADMIN) { upd.approval = $('etApp').value; upd.sendNow = !!($('etSend') && $('etSend').checked); }
      data = await call('adminUpdateTask', token, id, upd);
      closeModal(); render();
      toast(data.requested ? 'Change sent to the admin for approval' : id + ' saved' + (data.emailed ? ', employee emailed' : ''));
    } catch (err) { toast(err.message, true); $('etSave').disabled = false; }
  };
}

// ---------- employee view ----------
function renderEmployee(){
  $('appTitle').textContent = 'Hi ' + data.name.split(' ')[0];
  const open = data.tasks.filter(t => t.status !== 'Done');
  const overdue = data.tasks.filter(t => t.overdue);
  $('appSub').textContent = open.length + ' open' + (overdue.length ? ' · ' + overdue.length + ' overdue' : '');
  const order = t => (t.status === 'Done' ? 2 : 0) + (t.overdue ? -1 : 0);
  const list = data.tasks.slice().sort((a,b) => order(a) - order(b) || (a.dueAtMs || 9e15) - (b.dueAtMs || 9e15) || (a.due||'9999').localeCompare(b.due||'9999'));
  $('main').innerHTML = `
    ${attendanceCard()}
    <div id="myAtt"></div>
    <div class="stats">
      <div class="stat"><div class="n">${open.length}</div><div class="l">Open tasks</div></div>
      <div class="stat bad"><div class="n">${overdue.length}</div><div class="l">Overdue</div></div>
      <div class="stat ok"><div class="n">${data.tasks.filter(t => t.status==='Done').length}</div><div class="l">Recently done</div></div>
    </div>
    ${!list.length ? '<div class="card empty">No tasks assigned to you right now.</div>' :
    `<div class="tasks-grid">${list.map(t => `
      <div class="tcard ${t.overdue ? 'is-overdue' : ''} ${t.status==='Done' ? 'is-done' : ''}" data-card="${esc(t.id)}">
        <div class="t-title">${esc(t.task)}</div>
        ${t.details ? `<div class="t-sub" style="margin-top:4px">${esc(t.details)}</div>` : ''}
        <div class="meta"><span>${esc(t.id)}</span>${prioPill(t.priority)}
          <span class="${t.overdue ? 'overdue' : ''}">${t.dueLabel ? 'Due ' + esc(dueText(t)) : 'No due date'}</span>${countdownHtml(t)}${takenHtml(t)}</div>
        ${t.status === 'Done' ? `
        <div class="done-lock"><span class="pill p-ok">Done</span><span class="muted">${t.completed ? 'Completed ' + esc(t.completed) + ' · ' : ''}locked</span></div>
        ${t.remarks ? `<div class="t-sub" style="margin-top:8px;max-width:none"><b>Remarks:</b> ${esc(t.remarks)}</div>` : ''}
        ${linksHtml(t)}` : `
        <div class="seg">${STATUSES.map(s => `<button type="button" data-st="${esc(s)}" class="${s===t.status?'on':''}">${esc(s)}</button>`).join('')}</div>
        <div class="field"><label>Progress: <span data-pv>${Math.round(t.progress*100)}</span>%</label>
          <input type="range" min="0" max="100" step="10" value="${Math.round(t.progress*100)}" data-pr></div>
        <div class="field"><label>Remarks</label><textarea data-rm placeholder="What's done, what's blocking you">${esc(t.remarks)}</textarea></div>
        <div class="field"><label>Work links <span class="muted" style="font-weight:400">(Drive folder, Canva, screenshot…)</span></label>
          <div class="link-list" data-links></div>
          <div class="link-add"><input type="url" data-newlink placeholder="Paste a link, e.g. https://drive.google.com/…" inputmode="url">
            <button type="button" class="btn ghost small" data-addlink>Add</button></div></div>
        <button class="btn small" data-save>Save update</button>
        <div class="muted lock-note hidden" style="font-size:12px;margin-top:6px">Marking Done locks this ticket. It can't be changed after saving.</div>`}
      </div>`).join('')}</div>`}`;
  bindAttendanceCard();
  renderMyAttendance();
  document.querySelectorAll('[data-card]').forEach(card => {
    if (!card.querySelector('[data-save]')) return;   // Done tickets are read-only
    const task = data.tasks.find(t => t.id === card.dataset.card);
    let links = (task.links || []).slice();
    const listEl = card.querySelector('[data-links]'), newEl = card.querySelector('[data-newlink]');
    const drawLinks = () => {
      listEl.innerHTML = links.map((u, i) => `<div class="link-row"><a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">🔗 ${esc(linkLabel(u))}</a>
        <span class="link-url">${esc(u)}</span><button type="button" class="link-x" data-rmlink="${i}" aria-label="Remove link">×</button></div>`).join('');
      listEl.querySelectorAll('[data-rmlink]').forEach(b => b.onclick = () => { links.splice(Number(b.dataset.rmlink), 1); drawLinks(); markDirty(); });
    };
    const addLink = () => {
      const u = newEl.value.trim(); if (!u) return;
      if (!/^https?:\/\/\S+$/i.test(u)) { toast('Paste a full link starting with https://', true); return; }
      if (links.length >= 10) { toast('Up to 10 links per task.', true); return; }
      if (!links.includes(u)) links.push(u);
      newEl.value = ''; drawLinks(); markDirty();
    };
    card.querySelector('[data-addlink]').onclick = addLink;
    newEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
    drawLinks();
    let status = data.tasks.find(t => t.id === card.dataset.card).status || 'Not Started';
    const pr = card.querySelector('[data-pr]'), pv = card.querySelector('[data-pv]');
    card.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      status = b.dataset.st;
      card.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b));
      if (status === 'Done') { pr.value = 100; pv.textContent = 100; }
      pr.disabled = status === 'Done';
      card.querySelector('[data-save]').textContent = status === 'Done' ? 'Save & mark Done' : 'Save update';
      card.querySelector('.lock-note').classList.toggle('hidden', status !== 'Done');
    });
    pr.oninput = () => pv.textContent = pr.value;
    card.querySelector('[data-save]').onclick = async e => {
      const btn = e.target; btn.disabled = true;
      try {
        if (newEl.value.trim()) addLink();   // a pasted link that wasn't added yet
        data = await call('empUpdateTask', token, card.dataset.card, status, Number(pr.value)/100, card.querySelector('[data-rm]').value, links);
        dirty = false;
        dirty = false; renderEmployee(); tickCountdowns(); toast('Update saved');
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    };
  });
}

/** Submit buttons for the add-task forms: admin chooses how to send, task manager submits for approval. */
function addButtons(prefix, withCancel){
  const cancel = withCancel ? `<button class="btn ghost" type="button" id="${prefix}Cancel">Cancel</button>` : '';
  if (!IS_ADMIN) return `<div class="actions" style="justify-content:${withCancel ? 'flex-end' : 'flex-start'}">${cancel}
      <button class="btn" type="submit" data-mode="submit">Submit for approval</button></div>
    <div class="muted" style="font-size:12px;margin-top:8px">The admin gets an email to approve it. You'll see the status under All tasks.</div>`;
  return `<div class="actions" style="justify-content:${withCancel ? 'flex-end' : 'flex-start'}">${cancel}
      <button class="btn ghost" type="submit" data-mode="summary">Approve, add to daily summary</button>
      <button class="btn" type="submit" data-mode="now">Approve &amp; send now</button></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Send now emails the employee straight away. Otherwise it appears in tonight's summary email for tomorrow.</div>`;
}

function addedMsg(who, sendNow){
  if (!IS_ADMIN) return 'Task sent to the admin for approval.';
  if (sendNow) return data && data.emailed ? 'Task sent to ' + who + ' by email' : 'Task created for ' + who + ', but the email could not be sent (check their email in Team)';
  return 'Task added. ' + who + ' will see it in tonight\'s summary.';
}

// ---------- attendance (employee) ----------
function attendanceCard(){
  const a = data.attendance;
  if (!a) return '';
  let body, btn = '';
  if (a.state === 'none') {
    body = a.closed ? `<div class="att-big">Office hours are over for today</div><div class="muted">You did not check in today.</div>`
      : `<div class="att-big">You haven't checked in yet</div><div class="muted">Office ${esc(a.officeStart)} – ${esc(a.officeEnd)} · late after ${esc(a.lateAfter)}</div>`;
    if (!a.closed) btn = `<button class="btn ok att-btn" data-check="in">📷 Check in</button>`;
  } else if (a.state === 'in') {
    body = `<div class="att-big">Checked in at ${esc(a.inLabel)}${a.late ? ' <span class="pill p-warn">Late</span>' : ''}</div>
      <div class="muted"><span data-worked="${a.inMs}" data-cap="${esc(a.autoOutLabel)}">${esc(fmtMins(a.workedMin))}</span> so far · auto check-out at ${esc(a.autoOutLabel)}</div>`;
    btn = `<button class="btn bad att-btn" data-check="out">📷 Check out</button>`;
  } else {
    body = `<div class="att-big">Worked ${esc(fmtMins(a.workedMin))} today</div>
      <div class="muted">In ${esc(a.inLabel)} · Out ${esc(a.outLabel)}${a.late ? ' · <span class="pill p-warn">Late</span>' : ''}${/Auto check-out/.test(a.flags) ? ' · auto checked out' : ''}</div>`;
  }
  return `<div class="card att-card att-${a.state}"><div class="att-info">${body}</div>${btn}</div>`;
}
function tickWorked(){
  document.querySelectorAll('[data-worked]').forEach(el => {
    const a = data && data.attendance; if (!a || a.state !== 'in') return;
    el.textContent = fmtMins(Math.max(0, (Date.now() - Number(el.dataset.worked)) / 60000));
  });
}
setInterval(tickWorked, 30000);
function bindAttendanceCard(){
  document.querySelectorAll('[data-check]').forEach(b => b.onclick = () => openCamera(b.dataset.check));
}
function getLocation(){
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: 'This browser cannot share location.' });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => resolve({ error: e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get your location. Try again near a window.' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
let camStream = null;
function stopCamera(){ if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }
async function openCamera(kind){
  modal(`<h3>${kind === 'in' ? 'Check in' : 'Check out'}</h3>
    <div class="cam-box"><video id="camVid" playsinline autoplay muted></video><img id="camShot" class="hidden" alt="Your photo"></div>
    <div class="muted" id="camMsg" style="font-size:12.5px;margin:8px 0">Starting the camera… also getting your location.</div>
    <div class="actions" style="justify-content:flex-end">
      <button class="btn ghost" type="button" id="camCancel">Cancel</button>
      <button class="btn ghost hidden" type="button" id="camRetake">Retake</button>
      <button class="btn" type="button" id="camSnap" disabled>Take photo</button>
      <button class="btn ok hidden" type="button" id="camSend">${kind === 'in' ? 'Check in' : 'Check out'}</button>
    </div>`);
  const close = () => { stopCamera(); closeModal(); };
  $('camCancel').onclick = close;
  const locP = getLocation();
  let photo = '';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
    $('camVid').srcObject = camStream;
    $('camSnap').disabled = false;
    $('camMsg').textContent = 'Look at the camera and take a photo.';
  } catch (e) {
    $('camMsg').textContent = 'Camera is blocked or not available. Allow camera access for this site and try again.';
    return;
  }
  $('camSnap').onclick = () => {
    const v = $('camVid'); const w = v.videoWidth || 640, h = v.videoHeight || 480;
    const scale = Math.min(1, 640 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(v, 0, 0, c.width, c.height);
    photo = c.toDataURL('image/jpeg', 0.7);
    $('camShot').src = photo; $('camShot').classList.remove('hidden'); v.classList.add('hidden');
    ['camSnap'].forEach(id => $(id).classList.add('hidden')); ['camRetake','camSend'].forEach(id => $(id).classList.remove('hidden'));
    $('camMsg').textContent = 'Happy with the photo?';
  };
  $('camRetake').onclick = () => {
    photo = ''; $('camShot').classList.add('hidden'); $('camVid').classList.remove('hidden');
    $('camSnap').classList.remove('hidden'); ['camRetake','camSend'].forEach(id => $(id).classList.add('hidden'));
  };
  $('camSend').onclick = async () => {
    $('camSend').disabled = true; $('camRetake').disabled = true;
    $('camMsg').textContent = 'Checking your location…';
    const loc = await locP;
    if (loc.error && data.attendance && data.attendance.needsLocation) {
      $('camMsg').textContent = loc.error; $('camSend').disabled = false; $('camRetake').disabled = false; return;
    }
    try {
      data = await call('empCheck', token, kind, photo, loc.lat, loc.lng, loc.acc);
      myAttAt = 0; close(); renderEmployee(); tickCountdowns();
      toast(kind === 'in' ? 'Checked in at ' + data.attendance.inLabel : 'Checked out. Worked ' + fmtMins(data.attendance.workedMin) + ' today');
    } catch (err) {
      $('camMsg').textContent = err.message; $('camSend').disabled = false; $('camRetake').disabled = false;
    }
  };
}

// ---------- attendance (employee's own month) ----------
let myAtt = null, myAttMonth = '', myAttAt = 0;
async function renderMyAttendance(force){
  const box = $('myAtt'); if (!box || !data.attendance) return;
  if (!myAtt || force || Date.now() - myAttAt > 5 * 60000) {
    if (myAtt) drawMyAttendance();
    try { myAtt = await quietCall('empAttendance', token, myAttMonth); myAttAt = Date.now(); }
    catch (e) { if (!myAtt) box.innerHTML = ''; return; }
  }
  drawMyAttendance();
}
function drawMyAttendance(){
  const box = $('myAtt'); if (!box || !myAtt) return;
  const s = myAtt.summary || { workingDays: 0, present: 0, leaves: 0, pct: null, late: 0, early: 0, totalMin: 0, avgMin: 0, leaveDates: [], extraDays: 0 };
  const months = []; { const d = new Date(); for (let i = 0; i < 6; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(x.getFullYear() + '-' + pad2(x.getMonth() + 1)); } }
  box.innerHTML = `<div class="card my-att">
    <div class="row" style="align-items:center;margin-bottom:10px">
      <h3 style="margin:0;flex:1">My attendance</h3>
      <select id="myAttMonth" class="mini-select">${months.map(m => `<option value="${m}" ${m === myAtt.month ? 'selected' : ''}>${esc(new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))}</option>`).join('')}</select>
    </div>
    <div class="cal-stats">
      <div><b>${s.present}${s.extraDays ? `<small> +${s.extraDays}</small>` : ''} / ${s.workingDays}</b><span>Days present</span></div>
      <div class="${s.leaves ? 'bad' : ''}"><b>${s.leaves}</b><span>Leaves</span></div>
      <div><b>${s.pct == null ? '-' : s.pct + '%'}</b><span>Attendance</span></div>
      <div class="${s.late ? 'warn' : ''}"><b>${s.late}</b><span>Late</span></div>
      <div><b>${s.early}</b><span>Left early</span></div>
      <div><b>${esc(fmtMins(s.totalMin))}</b><span>Total hours</span></div>
      <div><b>${esc(fmtMins(s.avgMin))}</b><span>Avg / day</span></div>
      <div class="click" id="myCal" style="background:var(--info-bg)"><b style="color:var(--info)">📅</b><span style="color:var(--info)">View calendar</span></div>
    </div></div>`;
  $('myAttMonth').onchange = e => { myAttMonth = e.target.value; renderMyAttendance(true); };
  $('myCal').onclick = () => showEmpMonth(data.name, {
    summary: [Object.assign({}, s, { name: data.name })], month: myAtt.month, calendar: myAtt.calendar,
    monthRows: myAtt.monthRows.map(r => Object.assign({ name: data.name }, r)) });
}
/** Like call() but without the full-screen busy overlay. */
async function quietCall(fn, ...args){
  const r = await fetch('/api/rpc', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fn, args }) });
  const j = await r.json().catch(() => ({ ok:false, error:'Server error.' }));
  if (!j.ok) throw new Error(j.error || 'Something went wrong.');
  return j.result;
}

// ---------- attendance (admin) ----------
let att = null, attMonth = '';
const photoCache = {};
async function renderAttendance(){
  if (!att || att._stale) {
    $('main').innerHTML = '<div class="card empty">Loading attendance…</div>';
    try { att = await call('adminAttendance', token, attMonth); } catch (err) { $('main').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    if (currentTab !== 'attendance') return;
  }
  attMonth = att.month;
  const o = att.office;
  const present = att.todayRows.filter(r => !r.absent);
  const inNow = att.todayRows.filter(r => r.open);
  const monthLabel = new Date(att.month + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const notes = r => [r.late ? '<span class="pill p-warn">Late</span>' : '', r.flags ? `<span class="t-sub">${esc(r.flags)}</span>` : ''].join(' ');
  const thumb = (id, label) => id ? `<button type="button" class="att-thumb" data-photo="${esc(id)}" data-thumb="${esc(id)}" title="Open photo">
      <span class="ph">📷</span><span class="cap">${esc(label)}</span></button>` : '';
  const photoBtn = (id, label) => id ? `<button type="button" class="photo-chip" data-photo="${esc(id)}">${esc(label)}</button>` : '';
  const months = []; { const d = new Date(); for (let i = 0; i < 6; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(x.getFullYear() + '-' + pad2(x.getMonth() + 1)); } }
  $('main').innerHTML = `
    ${o.lat == null || !o.confirmed ? `<div class="card approvals-top"><h3>Set the office location</h3>
      <p class="muted" style="margin:0 0 10px">${o.lat == null ? 'No office location saved yet, so check-ins are not location-checked.' : 'The saved office location has not been confirmed.'}
      Open this page on your phone <b>inside the office</b> and tap the button. Check-ins then need to be within ${o.radius} m.</p>
      <button class="btn" id="setOffice">📍 Use my current location as the office</button></div>` : ''}
    <div class="stats">
      <div class="stat ok"><div class="n">${inNow.length}</div><div class="l">In the office now</div></div>
      <div class="stat"><div class="n">${present.length} / ${att.todayRows.length}</div><div class="l">Checked in today</div></div>
      <div class="stat warn"><div class="n">${present.filter(r => r.late).length}</div><div class="l">Late today</div></div>
      <div class="stat bad"><div class="n">${att.todayRows.filter(r => r.absent).length}</div><div class="l">Not checked in</div></div>
    </div>
    <div class="card"><h3>Today</h3><div class="table-wrap"><table class="rt">
      <tr><th>Employee</th><th>In</th><th>Out</th><th>Worked</th><th>Photos</th><th>Notes</th></tr>
      ${att.todayRows.map(r => r.absent ? `<tr><td class="primary t-title">${esc(r.name)}</td><td colspan="5" class="muted full">Not checked in</td></tr>` : `<tr>
        <td class="primary t-title">${esc(r.name)} ${r.open ? '<span class="pill p-ok">In</span>' : ''}</td>
        <td data-label="In">${esc(r.inLabel)}</td><td data-label="Out">${esc(r.outLabel || '-')}</td>
        <td data-label="Worked">${esc(fmtMins(r.workedMin))}</td>
        <td data-label="Photos" class="thumbs">${thumb(r.inPhoto, 'In ' + r.inLabel)}${thumb(r.outPhoto, 'Out ' + r.outLabel)}</td>
        <td class="full">${notes(r)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No active employees.</td></tr>'}
    </table></div></div>
    <div class="card"><div class="row" style="align-items:flex-end;margin-bottom:10px">
        <h3 style="margin:0;flex:1">Monthly report · ${esc(monthLabel)}</h3>
        <div class="field" style="margin:0;max-width:180px"><label>Month</label><select id="attMonth">${months.map(m => `<option value="${m}" ${m === att.month ? 'selected' : ''}>${esc(new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))}</option>`).join('')}</select></div></div>
      <div class="muted" style="font-size:12.5px;margin:-4px 0 10px">${att.calendar.filter(d => d.type === 'work').length} working days this month${
        att.calendar.some(d => d.type === 'holiday') ? ' · holidays: ' + esc(att.calendar.filter(d => d.type === 'holiday').map(d => shortDate(d.date) + (d.label ? ' ' + d.label : '')).join(', ')) : ''}.
        Tap an employee for their calendar.</div>
      <div class="table-wrap"><table class="rt">
      <tr><th>Employee</th><th>Working days</th><th>Present</th><th>Leaves</th><th>Attendance</th><th>Late</th><th>Left early</th><th>Total hours</th><th>Avg / day</th></tr>
      ${att.summary.map(r => `<tr class="click" data-empcal="${esc(r.name)}"><td class="primary t-title">${esc(r.name)}</td>
        <td class="num" data-label="Working days">${r.workingDays}</td>
        <td class="num" data-label="Present">${r.present}${r.extraDays ? ` <span class="muted">+${r.extraDays}</span>` : ''}</td>
        <td class="num" data-label="Leaves">${r.leaves ? `<span class="pill p-bad">${r.leaves}</span>` : 0}</td>
        <td class="num" data-label="Attendance">${r.pct == null ? '-' : r.pct + '%'}</td>
        <td class="num" data-label="Late">${r.late ? `<span class="pill p-warn">${r.late}</span>` : 0}</td>
        <td class="num" data-label="Left early">${r.early}</td>
        <td class="num" data-label="Total">${esc(fmtMins(r.totalMin))}</td><td class="num" data-label="Avg / day">${esc(fmtMins(r.avgMin))}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No attendance this month.</td></tr>'}
    </table></div>
    <div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn ghost small" id="attCsv">⬇ Download month (CSV)</button></div>
    <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Day by day (${att.monthRows.length})</summary>
      <div class="table-wrap"><table class="rt">
      <tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th>Worked</th><th>Photos</th><th>Notes</th></tr>
      ${att.monthRows.map(r => `<tr><td class="muted">${esc(new Date(r.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
        <td class="primary t-title">${esc(r.name)}</td><td data-label="In">${esc(r.inLabel)}</td><td data-label="Out">${esc(r.outLabel || '-')}</td>
        <td data-label="Worked">${esc(fmtMins(r.workedMin))}</td>
        <td data-label="Photos">${r.photosDeleted ? '<span class="muted">Deleted</span>' : photoBtn(r.inPhoto, 'In') + ' ' + photoBtn(r.outPhoto, 'Out')}</td>
        <td class="full">${notes(r)}</td></tr>`).join('')}
      </table></div></details>
    <div class="muted" style="font-size:12px;margin-top:10px">Working days count up to today; holidays and the weekly off are set in the Settings tab. "+1" = came on a day off. Office ${esc(o.hours)} · late after ${esc(o.lateAfter)} · auto check-out ${esc(o.autoOut)} · photos are deleted on the 15th of the next month.</div></div>`;
  $('attMonth').onchange = async e => { attMonth = e.target.value; att._stale = true; renderAttendance(); };
  document.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => showPhoto(b.dataset.photo, b.closest('tr').querySelector('.t-title').firstChild.textContent.trim()));
  document.querySelectorAll('[data-empcal]').forEach(tr => tr.onclick = () => showEmpMonth(tr.dataset.empcal));
  $('attCsv').onclick = downloadAttCsv;
  loadThumbs();
  if ($('setOffice')) $('setOffice').onclick = async () => {
    const loc = await getLocation();
    if (loc.error) { toast(loc.error, true); return; }
    if (loc.acc > 100) { toast('Location is not precise yet (±' + Math.round(loc.acc) + ' m). Try again near a window.', true); return; }
    try { att = await call('adminSetOffice', token, loc.lat, loc.lng, loc.acc); toast('Office location saved'); renderAttendance(); }
    catch (err) { toast(err.message, true); }
  };
}
function shortDate(d){ return new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
/** One employee's month as a calendar. */
function showEmpMonth(name, src){
  src = src || att;
  const s = src.summary.find(x => x.name === name); if (!s) return;
  const recs = {}; src.monthRows.filter(r => r.name === name).forEach(r => { recs[r.date] = r; });
  const leave = new Set(s.leaveDates);
  const first = src.calendar[0].dow, lead = (first + 6) % 7;   // weeks start Monday
  const cells = Array(lead).fill('<div class="cal-d empty"></div>').concat(src.calendar.map(d => {
    const r = recs[d.date], n = Number(d.date.slice(8));
    let cls = 'future', body = '';
    if (r) { cls = r.late ? 'late' : 'present'; body = `<div class="cal-t">${esc(r.inLabel.replace(' ', ''))}–${esc((r.outLabel || '…').replace(' ', ''))}</div><div class="cal-h">${esc(fmtMins(r.workedMin))}</div>`;
             if (d.type !== 'work') cls += ' extra'; }
    else if (d.type === 'holiday') { cls = 'off'; body = `<div class="cal-t">${esc(d.label || 'Holiday')}</div>`; }
    else if (d.type === 'off') { cls = 'off'; body = '<div class="cal-t">Off</div>'; }
    else if (leave.has(d.date)) { cls = 'leave'; body = '<div class="cal-t">Leave</div>'; }
    const tags = r ? [r.late ? 'Late' : '', /Left early/.test(r.flags) ? 'Early' : '', /Auto check-out/.test(r.flags) ? 'Auto out' : ''].filter(Boolean) : [];
    const pick = IS_ADMIN && r && (r.inPhoto || r.outPhoto || r.photosDeleted);
    return `<div class="cal-d ${cls}${pick ? ' pick' : ''}" title="${esc(d.date)}${pick ? ' · tap for photos' : ''}" ${pick ? `data-day="${esc(d.date)}"` : ''}><div class="cal-n">${n}</div>${body}${tags.length ? `<div class="cal-tag">${esc(tags.join(' · '))}</div>` : ''}</div>`;
  }));
  const monthLabel = new Date(src.month + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  modal(`<h3>${esc(name)} · ${esc(monthLabel)}</h3>
    <div class="cal-stats">
      <div><b>${s.workingDays}</b><span>Working days</span></div><div><b>${s.present}</b><span>Present</span></div>
      <div class="bad"><b>${s.leaves}</b><span>Leaves</span></div><div><b>${s.pct == null ? '-' : s.pct + '%'}</b><span>Attendance</span></div>
      <div class="warn"><b>${s.late}</b><span>Late</span></div><div><b>${s.early}</b><span>Left early</span></div>
      <div><b>${esc(fmtMins(s.totalMin))}</b><span>Total hours</span></div><div><b>${esc(fmtMins(s.avgMin))}</b><span>Avg / day</span></div>
    </div>
    <div class="cal">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="cal-w">${d}</div>`).join('')}${cells.join('')}</div>
    <div class="cal-key"><span class="k present"></span>Present <span class="k late"></span>Late <span class="k leave"></span>Leave <span class="k off"></span>Off / holiday</div>
    ${s.leaveDates.length ? `<div class="muted" style="font-size:12.5px;margin-top:8px">Leaves: ${esc(s.leaveDates.map(shortDate).join(', '))}</div>` : ''}
    <div class="actions" style="justify-content:flex-end"><button class="btn ghost" type="button" onclick="closeModal()">Close</button></div>`);
  document.querySelector('.modal').classList.add('wide');
  document.querySelectorAll('.cal-d[data-day]').forEach(el => el.onclick = () => showDayPhotos(name, recs[el.dataset.day], () => showEmpMonth(name, src)));
}
/** Admin: one employee's check-in / check-out photos for one day. */
function showDayPhotos(name, r, back){
  const day = new Date(r.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const slot = (id, label, time) => `<div class="day-ph"><div class="cam-box">${id ? `<div class="muted" data-ph="${esc(id)}" style="padding:30px;text-align:center">Loading…</div>`
      : `<div class="muted" style="padding:30px;text-align:center">${r.photosDeleted ? 'Photo deleted<br><small>(kept until the 15th of next month)</small>' : 'No photo'}</div>`}</div>
    <div class="day-cap"><b>${esc(label)}</b> ${esc(time || '-')}</div></div>`;
  modal(`<h3>${esc(name)} · ${esc(day)}</h3>
    <div class="day-phs">${slot(r.inPhoto, 'Check in', r.inLabel)}${slot(r.outPhoto, 'Check out', r.outLabel)}</div>
    <div class="muted" style="font-size:12.5px;margin-top:10px">Worked ${esc(fmtMins(r.workedMin))}${r.late ? ' · <span class="pill p-warn">Late</span>' : ''}${r.flags ? ' · ' + esc(r.flags) : ''}</div>
    <div class="actions" style="justify-content:space-between"><button class="btn ghost" type="button" id="dayBack">← Back to calendar</button>
      <button class="btn ghost" type="button" onclick="closeModal()">Close</button></div>`);
  document.querySelector('.modal').classList.add('wide');
  $('dayBack').onclick = back;
  document.querySelectorAll('[data-ph]').forEach(async el => {
    try { const p = await fetchPhoto(el.dataset.ph); if (el.isConnected) el.outerHTML = `<img src="${p.dataUrl}" alt="${esc(name)} photo">`; }
    catch (e) { if (el.isConnected) el.textContent = e.message; }
  });
}
function downloadAttCsv(){
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Employee','Working days','Present','Leaves','Attendance %','Late','Left early','Auto check-out','Extra days','Total hours','Avg per day','Leave dates'].map(q).join(',')];
  att.summary.forEach(s => lines.push([s.name, s.workingDays, s.present, s.leaves, s.pct == null ? '' : s.pct, s.late, s.early, s.auto, s.extraDays,
    (s.totalMin / 60).toFixed(2), (s.avgMin / 60).toFixed(2), s.leaveDates.join(' ')].map(q).join(',')));
  lines.push('');
  lines.push(['Date','Employee','Check in','Check out','Worked (h)','Late','Notes'].map(q).join(','));
  att.monthRows.slice().reverse().forEach(r => lines.push([r.date, r.name, r.inLabel, r.outLabel, (r.workedMin / 60).toFixed(2), r.late ? 'Yes' : '', r.flags].map(q).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = 'attendance-' + att.month + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
/** Fetches a photo without the full-screen busy overlay (used for thumbnails). */
async function fetchPhoto(id){
  if (photoCache[id]) return photoCache[id];
  const r = await fetch('/api/rpc', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fn:'adminAttPhoto', args:[token, id] }) });
  const j = await r.json().catch(() => ({ ok:false }));
  if (!j.ok) throw new Error(j.error || 'Could not load the photo.');
  return (photoCache[id] = j.result);
}
async function loadThumbs(){
  const els = [...document.querySelectorAll('[data-thumb]')];
  const next = async () => {
    const el = els.shift(); if (!el) return;
    try { const p = await fetchPhoto(el.dataset.thumb); if (el.isConnected) el.querySelector('.ph').outerHTML = `<img src="${p.dataUrl}" alt="">`; }
    catch (e) { if (el.isConnected) el.querySelector('.ph').textContent = '⚠'; }
    return next();
  };
  await Promise.all([next(), next(), next()]);   // three at a time
}
async function showPhoto(id, who){
  modal(`<h3>${esc(who)}</h3><div class="cam-box"><div class="muted" id="phMsg" style="padding:40px;text-align:center">Loading photo…</div><img id="phImg" class="hidden" alt="Attendance photo"></div>
    <div class="muted" id="phName" style="font-size:12px;margin-top:6px"></div>
    <div class="actions" style="justify-content:flex-end"><button class="btn ghost" type="button" onclick="closeModal()">Close</button></div>`);
  try {
    const p = photoCache[id] || await fetchPhoto(id);
    if (!$('phImg')) return;
    $('phImg').src = p.dataUrl; $('phImg').classList.remove('hidden'); $('phMsg').remove(); $('phName').textContent = p.name;
  } catch (err) { delete photoCache[id]; if ($('phMsg')) $('phMsg').textContent = err.message; }
}

// ---------- quick "+" task modal ----------
function openNewTaskModal(preEmp){
  const emps = activeEmployees();
  if (!emps.length) {
    if (IS_ADMIN) { toast('Add an employee in the Team tab first.', true); currentTab = 'team'; render(); }
    else toast('No active employees yet. Ask the admin to add them.', true);
    return;
  }
  modal(`<h3>${IS_ADMIN ? 'Assign a new task' : 'Add a task for approval'}</h3>
    <form id="qtForm">
      <div class="field"><label>Task</label><input type="text" id="qtTask" maxlength="200" required placeholder="What needs to be done"></div>
      <div class="field"><label>Details</label><textarea id="qtDetails" placeholder="Instructions, links, expected result"></textarea></div>
      <div class="row">
        <div class="field"><label>Employee</label><select id="qtEmp" required>${options(emps, emps.includes(preEmp) ? preEmp : (emps.length === 1 ? emps[0] : ''), 'Select employee')}</select></div>
        <div class="field"><label>Priority</label><select id="qtPrio">${options(PRIORITIES, 'Medium')}</select></div>
      </div>
      ${timeFields('qt')}
      ${addButtons('qt', true)}
    </form>`);
  bindTimeFields('qt');
  $('qtTask').focus();
  $('qtCancel').onclick = closeModal;
  $('qtForm').onsubmit = async e => {
    e.preventDefault();
    if (!$('qtEmp').value) { toast('Pick an employee.', true); return; }
    const sendNow = !!(e.submitter && e.submitter.dataset.mode === 'now');
    const btns = $('qtForm').querySelectorAll('button[type=submit]'); btns.forEach(b => b.disabled = true);
    const who = $('qtEmp').value;
    try {
      data = await call('adminAddTask', token, Object.assign({ task:$('qtTask').value, details:$('qtDetails').value, assignee:who,
        priority:$('qtPrio').value, approveNow:IS_ADMIN, sendNow }, timeValues('qt')));
      closeModal(); render(); toast(addedMsg(who, sendNow));
    } catch (err) { toast(err.message, true); btns.forEach(b => b.disabled = false); }
  };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('ov')) closeModal(); });

// ---------- auto refresh ----------
// Keeps every open dashboard current (e.g. the task manager sees an employee's Done without reloading).
let dirty = false, lastLoad = 0;
function markDirty(){ dirty = true; }
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#main')) markDirty(); });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-card] [data-st]')) markDirty(); });
async function quietRefresh(){
  if (!token || !data || document.visibilityState !== 'visible') return;
  if ($('ov') || dirty) return;                                  // popup open or unsaved edits on screen
  if (STAFF && currentTab === 'attendance') return;              // attendance loads on its own
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#main')) return;
  try {
    const fresh = await call(STAFF ? 'adminData' : 'empData', token);
    if ($('ov') || dirty) return;
    data = fresh; lastLoad = Date.now();
    const y = window.scrollY; render(); window.scrollTo(0, y);
  } catch (e) { /* stay quiet; the next try may work */ }
}
setInterval(quietRefresh, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastLoad > 15000) quietRefresh(); });

// ---------- boot ----------
$('fab').onclick = () => { if (data) openNewTaskModal(currentTab === 'tasks' ? filters.emp : ''); };
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; if (currentTab === 'attendance' && att) att._stale = true; if (data) render(); });
$('logoutBtn').onclick = () => signOut(false);
$('refreshBtn').onclick = async () => {
  if (STAFF) { try { data = await call('adminSyncNow', token); if (att) att._stale = true; render(); toast('Synced with the sheets'); } catch (err) { toast(err.message, true); } }
  else reload();
};
setupLogin();
call('publicInfo').then(i => { BRAND = (i && i.brand) || ''; loginText(); }).catch(() => {});
token = store.get();
if (token) startApp();
