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
function closeModal(){ $('modalRoot').innerHTML = ''; }

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
  document.querySelectorAll('.tab[data-tab="approvals"], .tab[data-tab="team"]').forEach(b => b.classList.toggle('hidden', !IS_ADMIN));
  await reload();
}
async function reload(){
  try {
    data = await call(STAFF ? 'adminData' : 'empData', token);
    render();
  } catch (err) { toast(err.message, true); }
}

// ---------- render ----------
function render(){
  if (STAFF) {
    if (!IS_ADMIN && (currentTab === 'approvals' || currentTab === 'team')) currentTab = 'overview';
    $('appTitle').textContent = (data.brand ? data.brand + ' ' : '') + (IS_ADMIN ? 'Admin dashboard' : 'Task manager · ' + (data.me || ''));
    $('appSub').textContent = data.stats.pending + ' waiting for approval · ' + data.stats.overdue + ' overdue';
    const pc = $('pendingCount'); pc.textContent = data.stats.pending; pc.classList.toggle('hidden', !data.stats.pending);
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
    ({overview:renderOverview, tasks:renderTasks, approvals:renderApprovals, newtask:renderNewTask, team:renderTeam})[currentTab]();
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
  $('main').innerHTML = `
    <div class="stats">
      <div class="stat warn"><div class="n">${s.pending}</div><div class="l">Waiting for approval</div></div>
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
  bindTaskRows();
}

function taskTable(list, emptyMsg){
  if (!list.length) return `<div class="empty">${esc(emptyMsg)}</div>`;
  return `<div class="table-wrap"><table class="rt">
    <tr><th>ID</th><th>Task</th><th>Employee</th><th>Due</th><th>Priority</th><th>Approval</th><th>Status</th><th class="hide-sm">Remarks</th></tr>
    ${list.map(t => `<tr class="click" data-id="${esc(t.id)}">
      <td class="muted tid">${esc(t.id)}</td>
      <td class="primary"><div class="t-title">${esc(t.task)}</div>${t.details ? `<div class="t-sub clamp">${esc(t.details)}</div>` : ''}${addedBy(t)}</td>
      <td data-label="For">${esc(t.assignee)}</td>
      <td data-label="Due" class="${t.overdue ? 'overdue' : ''}">${esc(t.dueLabel || '-')}</td>
      <td>${prioPill(t.priority)}</td>
      <td>${approvalPill(t.approval)}</td>
      <td class="st">${statusPill(t.status)}${t.approval==='Approved' ? bar(t.progress) : ''}</td>
      <td class="hide-sm full">${t.remarks ? `<div class="t-sub">${esc(t.remarks)}</div>` : ''}</td>
    </tr>`).join('')}
  </table></div>`;
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

function renderApprovals(){
  const list = data.tasks.filter(t => t.approval === 'Pending' || t.approval === 'On Hold');
  $('main').innerHTML = `<div class="card"><h3>Waiting for approval</h3>${
    !list.length ? '<div class="empty">Nothing waiting for approval.</div>' :
    `<div class="table-wrap"><table class="rt">
      <tr><th>ID</th><th>Task</th><th>Employee</th><th>Due</th><th>Priority</th><th>Approval</th><th></th></tr>
      ${list.map(t => `<tr>
        <td class="muted tid">${esc(t.id)}</td>
        <td class="primary"><div class="t-title">${esc(t.task)}</div>${t.details ? `<div class="t-sub">${esc(t.details)}</div>` : ''}${addedBy(t)}</td>
        <td data-label="For">${esc(t.assignee)}</td><td data-label="Due">${esc(t.dueLabel || '-')}</td><td>${prioPill(t.priority)}</td><td>${approvalPill(t.approval)}</td>
        <td class="btns full">
          <button class="btn ok small" data-act="Approved" data-send="1" data-id="${esc(t.id)}" title="Approve and email the employee now">Approve &amp; send now</button>
          <button class="btn ghost small" data-act="Approved" data-id="${esc(t.id)}" title="Approve; the employee sees it in tonight's summary">Approve</button>
          <button class="btn ghost small" data-act="On Hold" data-id="${esc(t.id)}">Hold</button>
          <button class="btn bad small" data-act="Rejected" data-id="${esc(t.id)}">Reject</button>
        </td></tr>`).join('')}
    </table></div>`}</div>`;
  document.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const sendNow = b.dataset.send === '1';
    try {
      data = await call('adminUpdateTask', token, b.dataset.id, { approval: b.dataset.act, sendNow });
      toast(b.dataset.id + ': ' + b.dataset.act + (sendNow ? (data.emailed ? ', emailed to employee' : ', but the email could not be sent') : b.dataset.act === 'Approved' ? ', in tonight\'s summary' : ''));
      render();
    }
    catch (err) { toast(err.message, true); b.disabled = false; }
  });
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
        <div class="field"><label>Employee</label><select id="ntEmp" required>${options(emps, '', 'Select employee')}</select></div>
        <div class="field"><label>Priority</label><select id="ntPrio">${options(PRIORITIES, 'Medium')}</select></div>
        <div class="field"><label>Due date</label><input type="date" id="ntDue" min="${esc(data.today)}"></div>
      </div>
      ${addButtons('nt', false)}
    </form>`}</div>`;
  const f = $('ntForm'); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    if (!$('ntEmp').value) { toast('Pick an employee.', true); return; }
    const sendNow = !!(e.submitter && e.submitter.dataset.mode === 'now');
    const btns = f.querySelectorAll('button[type=submit]'); btns.forEach(b => b.disabled = true);
    const who = $('ntEmp').value;
    try {
      data = await call('adminAddTask', token, { task:$('ntTask').value, details:$('ntDetails').value, assignee:who,
        priority:$('ntPrio').value, due:$('ntDue').value, approveNow:IS_ADMIN, sendNow });
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

function openTask(id){
  const t = data.tasks.find(x => x.id === id); if (!t) return;
  const emps = data.team.filter(m => m.role === 'Employee').map(m => m.name);
  modal(`<h3>${esc(t.id)} · Edit task</h3>
    <div class="field"><label>Task</label><input type="text" id="etTask" value="${esc(t.task)}"></div>
    <div class="field"><label>Details</label><textarea id="etDetails">${esc(t.details)}</textarea></div>
    <div class="row">
      <div class="field"><label>Employee</label><select id="etEmp">${options(emps, t.assignee)}</select></div>
      <div class="field"><label>Priority</label><select id="etPrio">${options(PRIORITIES, t.priority)}</select></div>
    </div>
    <div class="row">
      <div class="field"><label>Due date</label><input type="date" id="etDue" value="${esc(t.due)}"></div>
      <div class="field"><label>Approval</label>${IS_ADMIN
        ? `<select id="etApp">${options(APPROVALS, t.approval)}</select>`
        : `<div style="padding:8px 0">${approvalPill(t.approval)}</div>`}</div>
    </div>
    ${IS_ADMIN && t.approval !== 'Approved' ? '<div class="field"><label class="switch"><input type="checkbox" id="etSend"> If approving, email the employee now</label></div>' : ''}
    <div class="card" style="background:var(--bg);box-shadow:none;padding:12px">
      <div><b>Employee status:</b> ${statusPill(t.status)} ${t.approval==='Approved' ? Math.round(t.progress*100)+'%' : ''}</div>
      ${t.remarks ? `<div style="margin-top:6px"><b>Remarks:</b> ${esc(t.remarks)}</div>` : ''}
      <div class="muted" style="margin-top:6px;font-size:12px">${t.createdBy ? 'Added by ' + esc(t.createdBy) + ' · ' : ''}Created ${esc(t.created||'-')}${t.approvedOn ? ' · Approved '+esc(t.approvedOn) : ''}${t.updated ? ' · Updated '+esc(t.updated) : ''}${t.completed ? ' · Completed '+esc(t.completed) : ''}</div>
    </div>
    <div class="actions">
      ${!IS_ADMIN && t.approval !== 'Cancelled' ? '<button class="btn bad" id="etCancelTask" style="margin-right:auto">Cancel task</button>' : ''}
      <button class="btn ghost" id="etClose">Close</button><button class="btn" id="etSave">Save changes</button></div>`);
  $('etClose').onclick = closeModal;
  if ($('etCancelTask')) $('etCancelTask').onclick = async () => {
    const b = $('etCancelTask');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to cancel ' + id; return; }
    b.disabled = true;
    try { data = await call('adminUpdateTask', token, id, { approval: 'Cancelled' }); closeModal(); render(); toast(id + ' cancelled'); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
  $('etSave').onclick = async () => {
    $('etSave').disabled = true;
    try {
      const upd = { task:$('etTask').value, details:$('etDetails').value, assignee:$('etEmp').value,
        priority:$('etPrio').value, due:$('etDue').value };
      if (IS_ADMIN) { upd.approval = $('etApp').value; upd.sendNow = !!($('etSend') && $('etSend').checked); }
      data = await call('adminUpdateTask', token, id, upd);
      closeModal(); render(); toast(id + ' saved' + (upd.sendNow && data.emailed ? ', emailed to employee' : ''));
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
  const list = data.tasks.slice().sort((a,b) => order(a) - order(b) || (a.due||'9999').localeCompare(b.due||'9999'));
  $('main').innerHTML = `
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
          <span class="${t.overdue ? 'overdue' : ''}">${t.dueLabel ? 'Due ' + esc(t.dueLabel) : 'No due date'}${t.overdue ? ' (overdue)' : ''}</span></div>
        <div class="seg">${STATUSES.map(s => `<button type="button" data-st="${esc(s)}" class="${s===t.status?'on':''}">${esc(s)}</button>`).join('')}</div>
        <div class="field"><label>Progress: <span data-pv>${Math.round(t.progress*100)}</span>%</label>
          <input type="range" min="0" max="100" step="10" value="${Math.round(t.progress*100)}" data-pr></div>
        <div class="field"><label>Remarks</label><textarea data-rm placeholder="What's done, what's blocking you">${esc(t.remarks)}</textarea></div>
        <button class="btn small" data-save>Save update</button>
      </div>`).join('')}</div>`}`;
  document.querySelectorAll('[data-card]').forEach(card => {
    let status = data.tasks.find(t => t.id === card.dataset.card).status || 'Not Started';
    const pr = card.querySelector('[data-pr]'), pv = card.querySelector('[data-pv]');
    card.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      status = b.dataset.st;
      card.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b));
      if (status === 'Done') { pr.value = 100; pv.textContent = 100; }
    });
    pr.oninput = () => pv.textContent = pr.value;
    card.querySelector('[data-save]').onclick = async e => {
      const btn = e.target; btn.disabled = true;
      try {
        data = await call('empUpdateTask', token, card.dataset.card, status, Number(pr.value)/100, card.querySelector('[data-rm]').value);
        renderEmployee(); toast('Update saved');
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
      <div class="row">
        <div class="field"><label>Due date</label><input type="date" id="qtDue" min="${esc(data.today)}"></div>
      </div>
      ${addButtons('qt', true)}
    </form>`);
  $('qtTask').focus();
  $('qtCancel').onclick = closeModal;
  $('qtForm').onsubmit = async e => {
    e.preventDefault();
    if (!$('qtEmp').value) { toast('Pick an employee.', true); return; }
    const sendNow = !!(e.submitter && e.submitter.dataset.mode === 'now');
    const btns = $('qtForm').querySelectorAll('button[type=submit]'); btns.forEach(b => b.disabled = true);
    const who = $('qtEmp').value;
    try {
      data = await call('adminAddTask', token, { task:$('qtTask').value, details:$('qtDetails').value, assignee:who,
        priority:$('qtPrio').value, due:$('qtDue').value, approveNow:IS_ADMIN, sendNow });
      closeModal(); render(); toast(addedMsg(who, sendNow));
    } catch (err) { toast(err.message, true); btns.forEach(b => b.disabled = false); }
  };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('ov')) closeModal(); });

// ---------- boot ----------
$('fab').onclick = () => openNewTaskModal(currentTab === 'tasks' ? filters.emp : '');
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; if (data) render(); });
$('logoutBtn').onclick = () => signOut(false);
$('refreshBtn').onclick = async () => {
  if (STAFF) { try { data = await call('adminSyncNow', token); render(); toast('Synced with the sheets'); } catch (err) { toast(err.message, true); } }
  else reload();
};
setupLogin();
call('publicInfo').then(i => { BRAND = (i && i.brand) || ''; loginText(); }).catch(() => {});
token = store.get();
if (token) startApp();
