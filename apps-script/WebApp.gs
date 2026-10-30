/**
 * TASK TRACKER - Web dashboard (admin + employee)
 * ------------------------------------------------------------
 * Serves the dashboard from the same Apps Script project as Code.gs.
 *   Employee dashboard:  <web app URL>
 *   Admin dashboard:     <web app URL>?page=admin
 *
 * Admin login:    one shared admin password (set from the sheet menu:
 *                 Task System > Set dashboard admin password)
 * Employee login: work email + 6-digit PIN (created when the admin adds
 *                 the employee from the dashboard, or with "Reset PIN")
 *
 * Passwords and PINs are stored only as salted SHA-256 hashes in
 * Script Properties, never in the spreadsheet.
 */

const SESSION_HOURS = 8;
const MAX_FAILS = 5;            // failed logins before a 15-minute lockout
const LOCK_MINUTES = 15;
const PRIORITIES = ['High', 'Medium', 'Low'];
const APPROVALS = ['Pending', 'Approved', 'Rejected', 'On Hold'];

// ---------- Web app entry ----------
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.page = (e && e.parameter && e.parameter.page === 'admin') ? 'admin' : 'employee';
  let brand = '';
  try { brand = String(getSettings_()['Company name'] || ''); } catch (err) { /* settings missing */ }
  t.brand = brand;
  return t.evaluate()
    .setTitle((brand ? brand + ' ' : '') + (t.page === 'admin' ? 'Admin Dashboard' : 'My Tasks'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ---------- Menu helpers (called from the sheet menu in Code.gs) ----------
function setDashboardPassword() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Dashboard admin password',
    'Enter a new password for the admin dashboard (at least 8 characters).',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pw = r.getResponseText();
  if (!pw || pw.length < 8) { ui.alert('Password must be at least 8 characters. Nothing was changed.'); return; }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PW_HASH', hash_(pw));
  ui.alert('Admin dashboard password saved.');
}

function showDashboardLinks() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('The dashboard is not deployed yet.\n\nIn Apps Script: Deploy > New deployment > Web app,\n' +
      'Execute as: Me, Who has access: Anyone.');
    return;
  }
  ui.alert('Dashboard links\n\nAdmin:\n' + url + '?page=admin\n\nEmployees:\n' + url);
}

// ---------- Auth ----------
function login(role, identifier, secret) {
  identifier = String(identifier || '').trim().toLowerCase();
  secret = String(secret || '');
  const failKey = 'fail_' + role + '_' + identifier;
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');

  const props = PropertiesService.getScriptProperties();
  let session = null;

  if (role === 'admin') {
    const stored = props.getProperty('ADMIN_PW_HASH');
    if (!stored) throw new Error('Admin password is not set yet. In the Admin sheet use Task System > Set dashboard admin password.');
    if (stored === hash_(secret)) session = { role: 'admin', name: 'Admin' };
  } else {
    const m = getTeamAll_().find(x => x.email.toLowerCase() === identifier);
    const stored = props.getProperty('PIN_' + identifier);
    if (m && m.active && m.role === 'Employee' && stored && stored === hash_(secret)) {
      session = { role: 'employee', name: m.name, email: m.email };
    }
  }

  if (!session) {
    cache.put(failKey, String(fails + 1), LOCK_MINUTES * 60);
    throw new Error(role === 'admin' ? 'Wrong password.' : 'Wrong email or PIN, or your account is not active.');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid();
  cache.put('sess_' + token, JSON.stringify(session), SESSION_HOURS * 3600);
  return { token: token, name: session.name, role: session.role };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

function requireSession_(token, role) {
  const raw = token ? CacheService.getScriptCache().get('sess_' + token) : null;
  if (!raw) throw new Error('SESSION_EXPIRED');
  const s = JSON.parse(raw);
  if (role && s.role !== role) throw new Error('Not allowed.');
  if (s.role === 'employee') {
    // Re-check the employee is still active on every call
    const m = getTeamAll_().find(x => x.name === s.name);
    if (!m || !m.active) throw new Error('SESSION_EXPIRED');
  }
  return s;
}

// ---------- Admin API ----------
function adminData(token) {
  requireSession_(token, 'admin');
  const s = getSettings_();
  const todayKey = dayKey_(new Date());
  const since = Date.now() - 86400000;
  const tasks = readTasksForWeb_();
  const team = getTeamAll_().map(m => ({
    name: m.name, email: m.email, role: m.role, active: m.active,
    hasPin: !!PropertiesService.getScriptProperties().getProperty('PIN_' + m.email.toLowerCase())
  }));
  const open = t => t.approval === 'Approved' && t.status !== 'Done';
  const stats = {
    pending: tasks.filter(t => t.approval === 'Pending').length,
    open: tasks.filter(open).length,
    overdue: tasks.filter(t => t.overdue).length,
    blocked: tasks.filter(t => open(t) && t.status === 'Blocked').length,
    doneToday: tasks.filter(t => t.completedMs && t.completedMs >= since).length
  };
  const perEmployee = team.filter(m => m.role === 'Employee' && m.active).map(m => {
    const mine = tasks.filter(t => t.assignee === m.name);
    return {
      name: m.name,
      notStarted: mine.filter(t => open(t) && t.status === 'Not Started').length,
      inProgress: mine.filter(t => open(t) && t.status === 'In Progress').length,
      blocked: mine.filter(t => open(t) && t.status === 'Blocked').length,
      overdue: mine.filter(t => t.overdue).length,
      done: mine.filter(t => t.status === 'Done').length,
      pending: mine.filter(t => t.approval === 'Pending').length
    };
  });
  return {
    brand: String(s['Company name'] || ''), today: todayKey,
    tasks: tasks, team: team, stats: stats, perEmployee: perEmployee,
    sheetUrl: SpreadsheetApp.getActive().getUrl()
  };
}

function adminAddTask(token, t) {
  requireSession_(token, 'admin');
  t = t || {};
  const task = String(t.task || '').trim();
  if (!task) throw new Error('Task title is required.');
  const assignee = String(t.assignee || '');
  if (!getTeamAll_().some(m => m.name === assignee && m.active && m.role === 'Employee')) {
    throw new Error('Pick an active employee.');
  }
  const priority = PRIORITIES.includes(t.priority) ? t.priority : 'Medium';
  const approval = t.approveNow ? 'Approved' : 'Pending';
  const due = parseDay_(t.due);

  const sh = SpreadsheetApp.getActive().getSheetByName(TASKS_TAB);
  const row = firstEmptyTaskRow_(sh);
  sh.getRange(row, C.TASK, 1, 6).setValues([[task, String(t.details || '').trim(), assignee, priority, due || '', approval]]);
  syncNow();
  return adminData(token);
}

function adminUpdateTask(token, id, t) {
  requireSession_(token, 'admin');
  const sh = SpreadsheetApp.getActive().getSheetByName(TASKS_TAB);
  const row = findTaskRow_(sh, id);
  if (!row) throw new Error('Task ' + id + ' not found.');
  const cur = sh.getRange(row, C.TASK, 1, 6).getValues()[0];
  t = t || {};
  if (t.assignee !== undefined && !getTeamAll_().some(m => m.name === t.assignee && m.role === 'Employee')) {
    throw new Error('Unknown employee.');
  }
  if (t.approval !== undefined && !APPROVALS.includes(t.approval)) throw new Error('Unknown approval value.');
  if (t.priority !== undefined && !PRIORITIES.includes(t.priority)) throw new Error('Unknown priority.');
  const next = [
    t.task !== undefined ? String(t.task).trim() || cur[0] : cur[0],
    t.details !== undefined ? String(t.details).trim() : cur[1],
    t.assignee !== undefined ? t.assignee : cur[2],
    t.priority !== undefined ? t.priority : cur[3],
    t.due !== undefined ? (parseDay_(t.due) || '') : cur[4],
    t.approval !== undefined ? t.approval : cur[5]
  ];
  sh.getRange(row, C.TASK, 1, 6).setValues([next]);
  syncNow();
  return adminData(token);
}

function adminAddEmployee(token, e) {
  requireSession_(token, 'admin');
  e = e || {};
  const name = String(e.name || '').trim();
  const email = String(e.email || '').trim();
  const role = e.role === 'Admin' ? 'Admin' : 'Employee';
  if (!name) throw new Error('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (/[\[\]\*\?\/\\:]/.test(name)) throw new Error('Name cannot contain [ ] * ? / \\ or : (it becomes a tab name).');
  const all = getTeamAll_();
  if (all.some(m => m.name.toLowerCase() === name.toLowerCase())) throw new Error('Someone with that name already exists.');
  if (all.some(m => m.email.toLowerCase() === email.toLowerCase())) throw new Error('That email is already on the team.');

  SpreadsheetApp.getActive().getSheetByName(TEAM_TAB).appendRow([name, email, role, 'Yes', 'Added from dashboard']);
  let pin = null;
  if (role === 'Employee') {
    const s = getSettings_();
    const empSS = SpreadsheetApp.openById(s['Employee sheet ID']);
    const sh = getOrCreateEmpTab_(empSS, name);
    setUpNewEmployee_(empSS, sh, { name: name, email: email, role: role }, s);
    pin = newPin_(email);
  }
  const data = adminData(token);
  data.newPin = pin ? { name: name, email: email, pin: pin } : null;
  return data;
}

function adminSetEmployeeActive(token, name, active) {
  requireSession_(token, 'admin');
  const sh = SpreadsheetApp.getActive().getSheetByName(TEAM_TAB);
  const m = getTeamAll_().find(x => x.name === name);
  if (!m) throw new Error('Employee not found.');
  sh.getRange(m.row, 4).setValue(active ? 'Yes' : 'No');
  if (active) syncNow();
  return adminData(token);
}

function adminResetPin(token, name) {
  requireSession_(token, 'admin');
  const m = getTeamAll_().find(x => x.name === name);
  if (!m || m.role !== 'Employee') throw new Error('Employee not found.');
  const data = adminData(token);
  data.newPin = { name: m.name, email: m.email, pin: newPin_(m.email) };
  data.team.forEach(x => { if (x.name === m.name) x.hasPin = true; });
  return data;
}

function adminSyncNow(token) {
  requireSession_(token, 'admin');
  syncNow();
  return adminData(token);
}

// ---------- Employee API ----------
function empData(token) {
  const sess = requireSession_(token, 'employee');
  const s = getSettings_();
  const keepDays = Number(s['Keep done tasks visible (days)']) || 3;
  const cutoff = Date.now() - keepDays * 86400000;
  const empSS = SpreadsheetApp.openById(s['Employee sheet ID']);
  const tab = empSS.getSheetByName(sess.name);
  const live = tab ? readEmpTab_(tab) : {};   // newest values the employee typed

  const tasks = readTasksForWeb_()
    .filter(t => t.assignee === sess.name && t.approval === 'Approved')
    .map(t => {
      const l = live[t.id];
      if (l) { t.status = l.status; t.progress = typeof l.progress === 'number' ? l.progress : t.progress; t.remarks = l.remarks; }
      return t;
    })
    .filter(t => t.status !== 'Done' || !t.completedMs || t.completedMs >= cutoff);
  return { name: sess.name, brand: String(s['Company name'] || ''), today: dayKey_(new Date()), tasks: tasks };
}

function empUpdateTask(token, id, status, progress, remarks) {
  const sess = requireSession_(token, 'employee');
  if (!STATUSES.includes(status)) throw new Error('Pick a valid status.');
  let p = Number(progress);
  if (isNaN(p)) p = 0;
  if (p > 1) p = p / 100;
  p = Math.max(0, Math.min(1, p));
  if (status === 'Done') p = 1;

  const s = getSettings_();
  const tab = SpreadsheetApp.openById(s['Employee sheet ID']).getSheetByName(sess.name);
  if (!tab) throw new Error('Your task tab was not found. Ask the admin to run a sync.');
  const last = tab.getLastRow();
  if (last < 2) throw new Error('Task not found on your list.');
  const ids = tab.getRange(2, E.ID, last - 1, 1).getValues().map(r => r[0]);
  const idx = ids.indexOf(id);
  if (idx < 0) throw new Error('Task not found on your list. It may have been reassigned.');
  tab.getRange(idx + 2, E.STATUS, 1, 3).setValues([[status, p, String(remarks || '').slice(0, 2000)]]);
  syncNow();
  return empData(token);
}

// ---------- Helpers ----------
function getTeamAll_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TEAM_TAB);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .map((r, i) => ({
      row: i + 2, name: String(r[0]).trim(), email: String(r[1]).trim(),
      role: r[2] || 'Employee', active: String(r[3]).toLowerCase() === 'yes'
    }))
    .filter(m => m.name);
}

function readTasksForWeb_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TASKS_TAB);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const todayKey = dayKey_(new Date());
  const dt = d => d instanceof Date ? Utilities.formatDate(d, TZ, 'dd MMM yyyy, hh:mm a') : '';
  return sh.getRange(2, 1, last - 1, ADMIN_COLS).getValues()
    .filter(r => r[C.ID - 1] && String(r[C.TASK - 1]).trim())
    .map(r => {
      const due = r[C.DUE - 1];
      const status = String(r[C.STATUS - 1] || '');
      const approval = String(r[C.APPROVAL - 1] || '');
      const completed = r[C.COMPLETED - 1];
      return {
        id: String(r[C.ID - 1]),
        created: dt(r[C.CREATED - 1]),
        task: String(r[C.TASK - 1]),
        details: String(r[C.DETAILS - 1] || ''),
        assignee: String(r[C.ASSIGNEE - 1] || ''),
        priority: String(r[C.PRIORITY - 1] || ''),
        due: due instanceof Date ? dayKey_(due) : '',
        dueLabel: fmtDate_(due),
        approval: approval,
        approvedOn: dt(r[C.APPROVED_ON - 1]),
        status: status,
        progress: typeof r[C.PROGRESS - 1] === 'number' ? r[C.PROGRESS - 1] : 0,
        remarks: String(r[C.REMARKS - 1] || ''),
        updated: dt(r[C.UPDATED - 1]),
        completed: dt(completed),
        completedMs: completed instanceof Date ? completed.getTime() : 0,
        overdue: approval === 'Approved' && status !== 'Done' && due instanceof Date && dayKey_(due) < todayKey
      };
    });
}

function firstEmptyTaskRow_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 2;
  const col = sh.getRange(2, C.TASK, last - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).trim()) return i + 3;
  }
  return 2;
}

function findTaskRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, C.ID, last - 1, 1).getValues().map(r => String(r[0]));
  const i = ids.indexOf(String(id));
  return i < 0 ? 0 : i + 2;
}

function parseDay_(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  return Utilities.parseDate(String(s), TZ, 'yyyy-MM-dd');
}

function newPin_(email) {
  let pin = '';
  for (let i = 0; i < 6; i++) pin += Math.floor(Math.random() * 10);
  PropertiesService.getScriptProperties().setProperty('PIN_' + email.toLowerCase(), hash_(pin));
  return pin;
}

function hash_(secret) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('PW_SALT');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('PW_SALT', salt); }
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + secret, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
