/**
 * TASK TRACKER - Web dashboard (admin + employee)
 * ------------------------------------------------------------
 * Backend for the Vercel dashboard (called through Api.gs).
 *   Employee dashboard:  <Vercel URL>/employee
 *   Admin dashboard:     <Vercel URL>/admin
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
const APPROVALS = ['Pending', 'Approved', 'Rejected', 'On Hold', 'Cancelled'];
const STAFF = ['admin', 'manager'];
const DECISION_DAYS = 7;          // email approve/reject links stay valid this long

// ---------- Web app entry ----------
// The dashboard lives on Vercel. Opening the Apps Script URL directly only shows a pointer to it;
// Vercel talks to this project through doPost (Api.gs).
function doGet() {
  let link = '';
  try { link = String(getSettings_()['Dashboard URL'] || '').trim(); } catch (err) { /* settings missing */ }
  return ContentService.createTextOutput('Task Tracker API. Open the dashboard' + (link ? ': ' + link : ' on Vercel.'));
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
  const ui = SpreadsheetApp.getUi();
  const link = String(getSettings_()['Dashboard URL'] || '').trim().replace(/\/+$/, '');
  if (!link) { ui.alert('Add your Vercel link next to "Dashboard URL" in the Settings tab first.'); return; }
  ui.alert('Dashboard links\n\nSign-in page (all roles):\n' + link + '\n\nAdmin:\n' + link + '/admin\n\nTask managers:\n' + link + '/task-manager\n\nEmployees:\n' + link + '/employee');
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
  const allowed = Array.isArray(role) ? role : (role ? [role] : null);
  if (allowed && !allowed.includes(s.role)) throw new Error('Not allowed.');
  if (s.role === 'employee') {
    // Re-check the employee is still active on every call
    const m = getTeamAll_().find(x => x.name === s.name);
    if (!m || !m.active) throw new Error('SESSION_EXPIRED');
  }
  return s;
}

/**
 * Task manager login. Called only by the Vercel proxy, which checks the shared
 * task-manager PIN (stored in Vercel) and passes the result as pinOk.
 */
function managerLogin(name, pinOk) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fail_manager') || 0);
  if (fails >= 10) throw new Error('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  if (pinOk !== true) {
    cache.put('fail_manager', String(fails + 1), LOCK_MINUTES * 60);
    throw new Error('Wrong PIN.');
  }
  if (!name || name.length > 40) throw new Error('Enter your name (up to 40 characters).');
  cache.remove('fail_manager');
  const token = Utilities.getUuid();
  cache.put('sess_' + token, JSON.stringify({ role: 'manager', name: name }), SESSION_HOURS * 3600);
  return { token: token, name: name, role: 'manager' };
}

// ---------- Admin + task manager API ----------
function adminData(token) {
  const sess = requireSession_(token, STAFF);
  const s = getSettings_();
  const todayKey = dayKey_(new Date());
  const since = Date.now() - 86400000;
  const tasks = readTasksForWeb_();
  const props = PropertiesService.getScriptProperties();
  let team = getTeamAll_().map(m => ({
    name: m.name, email: m.email, role: m.role, active: m.active,
    hasPin: !!props.getProperty('PIN_' + m.email.toLowerCase())
  }));
  const open = t => t.approval === 'Approved' && t.status !== 'Done';
  const stats = {
    pending: tasks.filter(t => t.approval === 'Pending').length,
    open: tasks.filter(open).length,
    overdue: tasks.filter(t => t.overdue).length,
    blocked: tasks.filter(t => open(t) && t.status === 'Blocked').length,
    doneToday: tasks.filter(t => t.completedMs && t.completedMs >= since).length,
    changes: tasks.filter(t => t.changeReq).length
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
  // Task managers see employee names only: no emails, PINs or admins
  if (sess.role === 'manager') {
    team = team.filter(m => m.role === 'Employee').map(m => ({ name: m.name, role: m.role, active: m.active }));
  }
  return {
    role: sess.role, me: sess.name,
    brand: String(s['Company name'] || ''), today: todayKey,
    tasks: tasks, team: team, stats: stats, perEmployee: perEmployee
  };
}

function adminAddTask(token, t) {
  const sess = requireSession_(token, STAFF);
  t = t || {};
  const task = String(t.task || '').trim();
  if (!task) throw new Error('Task title is required.');
  const assignee = String(t.assignee || '');
  if (!getTeamAll_().some(m => m.name === assignee && m.active && m.role === 'Employee')) {
    throw new Error('Pick an active employee.');
  }
  const priority = PRIORITIES.includes(t.priority) ? t.priority : 'Medium';
  const isAdmin = sess.role === 'admin';
  // Task managers can only submit for approval
  const approval = isAdmin && (t.approveNow || t.sendNow) ? 'Approved' : 'Pending';
  const due = parseDay_(t.due);
  if (!due) throw new Error('Pick a date.');
  const start = normStart_(t.startTime);
  if (!start) throw new Error('Pick a start time.');
  const limit = timeLimit_(t.limit);
  const createdBy = isAdmin ? 'Admin' : sess.name;

  const sh = tasksSheet_();
  const row = firstEmptyTaskRow_(sh);
  sh.getRange(row, C.TASK, 1, 6).setValues([[task, String(t.details || '').trim(), assignee, priority, due, approval]]);
  sh.getRange(row, T.START).setNumberFormat('@');
  sh.getRange(row, T.CREATED_BY, 1, 3).setValues([[createdBy, start, limit]]);
  syncNow();
  const vals = sh.getRange(row, 1, 1, ALL_COLS).getValues()[0];
  let emailed = 0;
  if (isAdmin && t.sendNow && vals[C.ID - 1]) emailed = sendNewTaskEmails_([vals], getSettings_());
  if (!isAdmin && vals[C.ID - 1]) notifyAdminsNewTask_(vals, createdBy);
  const data = adminData(token);
  data.emailed = emailed;
  return data;
}

// ---------- Editing rules ----------
// Pending / On Hold      -> admin and task managers edit freely
// Approved, not Done     -> admin edits directly; task managers send a change (or cancel) request
// Done / Rejected / Cancelled -> locked for everyone (admin can Reopen a Done task)
const CHANGE_FIELDS = ['task', 'details', 'assignee', 'priority', 'due', 'startTime', 'limit'];
const FIELD_LABELS = { task: 'Task', details: 'Details', assignee: 'Employee', priority: 'Priority',
                       due: 'Date', startTime: 'Start time', limit: 'Time limit' };

function taskState_(approval, status) {
  if (status === 'Done' || approval === 'Rejected' || approval === 'Cancelled') return 'locked';
  if (approval === 'Approved') return 'live';
  return 'pending';
}

function lockedMessage_(id, approval, status) {
  return id + ' is ' + (status === 'Done' ? 'Done' : approval) + ' and locked.' +
    (status === 'Done' ? ' The admin can reopen it if it really needs changing.' : '');
}

/** Current editable values of a task row, in the same shape the dashboard sends. */
function currentFields_(sh, row) {
  const v = sh.getRange(row, 1, 1, ALL_COLS).getValues()[0];
  return {
    vals: v,
    f: {
      task: String(v[C.TASK - 1]), details: String(v[C.DETAILS - 1] || ''), assignee: String(v[C.ASSIGNEE - 1] || ''),
      priority: String(v[C.PRIORITY - 1] || ''), due: v[C.DUE - 1] instanceof Date ? dayKey_(v[C.DUE - 1]) : '',
      startTime: normStart_(v[T.START - 1]), limit: limitVal_(v[T.LIMIT - 1]) || ''
    }
  };
}

/** Field-by-field differences between the current task and the requested values. */
function diffFields_(cur, t) {
  const out = {};
  CHANGE_FIELDS.forEach(k => {
    if (t[k] === undefined) return;
    let to = t[k];
    if (k === 'startTime') to = normStart_(to);
    if (k === 'limit') to = timeLimit_(to);
    if (k === 'task' || k === 'details') to = String(to).trim();
    if (String(to) !== String(cur[k])) out[k] = [cur[k], to];
  });
  return out;
}

/**
 * Edit a task (dashboard). Admin: applies directly; with t.sendNow a task that becomes Approved is
 * emailed straight away. Task manager: edits Pending tasks directly; on Approved tasks the edit
 * (or a cancel) becomes a change request for the admin.
 */
function adminUpdateTask(token, id, t) {
  const sess = requireSession_(token, STAFF);
  t = t || {};
  const sh = tasksSheet_();
  const row = findTaskRow_(sh, id);
  if (!row) throw new Error('Task ' + id + ' not found.');
  const cur = currentFields_(sh, row);
  const approval = cur.vals[C.APPROVAL - 1], status = cur.vals[C.STATUS - 1];
  const state = taskState_(approval, status);
  if (state === 'locked') throw new Error(lockedMessage_(id, approval, status));

  if (sess.role === 'manager') {
    if (t.approval !== undefined && t.approval !== 'Cancelled') throw new Error('Only the admin can approve or reject tasks.');
    if (state === 'live') {
      requestChange_(sh, row, cur, t, sess.name);
      const data = adminData(token);
      data.requested = true;
      return data;
    }
  }
  const res = applyTaskUpdate_(id, t);
  const data = adminData(token);
  data.emailed = res.emailed;
  return data;
}

/** Writes the edit to the Tasks tab. Callers check the editing rules first. */
function applyTaskUpdate_(id, t) {
  const sh = tasksSheet_();
  const row = findTaskRow_(sh, id);
  if (!row) throw new Error('Task ' + id + ' not found.');
  const before = currentFields_(sh, row);
  const cur = sh.getRange(row, C.TASK, 1, 6).getValues()[0];
  if (t.assignee !== undefined && !getTeamAll_().some(m => m.name === t.assignee && m.role === 'Employee')) {
    throw new Error('Unknown employee.');
  }
  if (t.approval !== undefined && !APPROVALS.includes(t.approval)) throw new Error('Unknown approval value.');
  if (t.priority !== undefined && !PRIORITIES.includes(t.priority)) throw new Error('Unknown priority.');
  if (t.startTime !== undefined && !normStart_(t.startTime)) throw new Error('Pick a valid start time.');
  const wasApproved = cur[5] === 'Approved';
  const next = [
    t.task !== undefined ? String(t.task).trim() || cur[0] : cur[0],
    t.details !== undefined ? String(t.details).trim() : cur[1],
    t.assignee !== undefined ? t.assignee : cur[2],
    t.priority !== undefined ? t.priority : cur[3],
    t.due !== undefined ? (parseDay_(t.due) || '') : cur[4],
    t.approval !== undefined ? t.approval : cur[5]
  ];
  sh.getRange(row, C.TASK, 1, 6).setValues([next]);
  if (t.startTime !== undefined) sh.getRange(row, T.START).setNumberFormat('@').setValue(normStart_(t.startTime));
  if (t.limit !== undefined) sh.getRange(row, T.LIMIT).setValue(timeLimit_(t.limit));
  syncNow();
  const after = sh.getRange(row, 1, 1, ALL_COLS).getValues()[0];
  let emailed = 0;
  if (t.sendNow && next[5] === 'Approved' && !wasApproved) {
    emailed = sendNewTaskEmails_([after], getSettings_());
  } else if (wasApproved) {
    // Already-approved task changed: tell the employee if timing, assignee or approval changed
    emailed = notifyEmployeeOfChange_(before, after, diffFields_(before.f, t));
  }
  return { emailed: emailed };
}

// ---------- Change requests (task manager -> admin) ----------
function requestChange_(sh, row, cur, t, byName) {
  const wantsCancel = t.approval === 'Cancelled';
  const changes = wantsCancel ? {} : diffFields_(cur.f, t);
  if (!wantsCancel && !Object.keys(changes).length) throw new Error('Nothing was changed.');
  if (changes.assignee && !getTeamAll_().some(m => m.name === changes.assignee[1] && m.active && m.role === 'Employee')) {
    throw new Error('Pick an active employee.');
  }
  const req = { by: byName, at: Date.now(), cancel: wantsCancel, changes: changes };
  sh.getRange(row, T.CHANGE_REQ).setNumberFormat('@').setValue(JSON.stringify(req));
  notifyAdminsChange_(cur.vals, req);
}

function readChangeReq_(v) {
  if (!v) return null;
  try { const r = JSON.parse(String(v)); return r && r.at ? r : null; } catch (e) { return null; }
}

function describeValue_(k, v) {
  if (v === '' || v == null) return '(none)';
  if (k === 'due') { const d = parseDay_(v); return d ? Utilities.formatDate(d, TZ, 'dd MMM yyyy') : String(v); }
  if (k === 'limit') return v + ' min';
  if (k === 'startTime') { const p = parseStart_(v); return p ? Utilities.formatDate(Utilities.parseDate('2000-01-01 ' + p.h + ':' + p.m, TZ, 'yyyy-MM-dd H:m'), TZ, 'h:mm a') : String(v); }
  return String(v);
}

/** [{label, from, to}] for display in emails and the dashboard. */
function changeLines_(req) {
  if (!req) return [];
  if (req.cancel) return [{ label: 'Cancel task', from: '', to: 'Cancelled' }];
  return Object.keys(req.changes).map(k => ({
    label: FIELD_LABELS[k] || k, from: describeValue_(k, req.changes[k][0]), to: describeValue_(k, req.changes[k][1])
  }));
}

/** Admin approves or rejects a pending change request. */
function adminDecideChange(token, id, approve) {
  requireSession_(token, 'admin');
  const res = decideChange_(id, approve === true);
  const data = adminData(token);
  data.emailed = res.emailed;
  return data;
}

function decideChange_(id, approve, expectAt) {
  const sh = tasksSheet_();
  const row = findTaskRow_(sh, id);
  if (!row) throw new Error('Task ' + id + ' not found.');
  const cur = currentFields_(sh, row);
  const req = readChangeReq_(cur.vals[T.CHANGE_REQ - 1]);
  if (!req || (expectAt && Number(expectAt) !== Number(req.at))) {
    return { already: true, emailed: 0 };
  }
  sh.getRange(row, T.CHANGE_REQ).setValue('');
  if (!approve) return { already: false, approved: false, emailed: 0 };
  const approval = cur.vals[C.APPROVAL - 1], status = cur.vals[C.STATUS - 1];
  if (taskState_(approval, status) === 'locked') {
    throw new Error(lockedMessage_(id, approval, status) + ' The change request was cleared.');
  }
  const t = {};
  if (req.cancel) t.approval = 'Cancelled';
  else Object.keys(req.changes).forEach(k => { t[k] = req.changes[k][1]; });
  const res = applyTaskUpdate_(id, t);
  return { already: false, approved: true, emailed: res.emailed };
}

/** Email to the admins with the requested change and signed approve / reject links. */
function notifyAdminsChange_(vals, req) {
  const s = getSettings_();
  const to = approvalRecipients_(s);
  if (!to) return;
  const base = String(s['Dashboard URL'] || '').trim().replace(/\/+$/, '');
  const id = String(vals[C.ID - 1]);
  const tok = makeDecisionToken_(id, 'c' + req.at);
  const link = a => base + '/approve?t=' + encodeURIComponent(tok) + '&a=' + a;
  const btn = (label, a, bg) => '<a href="' + link(a) + '" style="background:' + bg +
    ';color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;display:inline-block;margin:0 6px 6px 0">' + label + '</a>';
  const brand = s['Company name'] ? s['Company name'] + ' ' : '';
  const rows = changeLines_(req).map(l => '<tr><td style="padding:4px 12px 4px 0;color:#6b7487">' + esc_(l.label) + '</td>' +
    (req.cancel ? '<td><b style="color:#c0392b">Cancel this task</b></td>' :
      '<td><span style="text-decoration:line-through;color:#999">' + esc_(l.from) + '</span> &rarr; <b>' + esc_(l.to) + '</b></td>') + '</tr>').join('');
  let html = '<p><b>' + esc_(req.by) + '</b> wants to ' + (req.cancel ? 'cancel' : 'change') + ' an approved task.</p>' +
    '<div style="border:1px solid #e3e7ef;border-left:4px solid #2c5fb3;border-radius:8px;padding:12px 14px;margin:10px 0">' +
    '<div style="font-size:15px;font-weight:bold">' + esc_(id) + ': ' + esc_(vals[C.TASK - 1]) + '</div>' +
    '<div style="color:#6b7487;font-size:13px;margin:4px 0 8px">For ' + esc_(vals[C.ASSIGNEE - 1]) + ' &nbsp;|&nbsp; Status: ' + esc_(vals[C.STATUS - 1] || '-') +
    ' &nbsp;|&nbsp; Due: ' + (fmtDue_(vals[T.DUE_AT - 1], vals[C.DUE - 1]) || '-') + '</div>' +
    '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table></div>';
  if (base) {
    html += '<p>' + btn(req.cancel ? 'Approve cancel' : 'Approve change', 'approve_change', '#1e8e4e') +
      btn('Reject', 'reject_change', '#c0392b') + '</p>' +
      '<p style="color:#6b7487;font-size:12px">Each button opens a confirm page. Or use the <a href="' + base + '/admin">admin dashboard</a>.</p>';
  }
  try {
    sendMail_({ to: to, subject: brand + (req.cancel ? 'Cancel request: ' : 'Change request: ') + id + ' (by ' + req.by + ')', htmlBody: wrap_(html) });
  } catch (e) { Logger.log('Change notification failed: ' + e); }
}

function approvalRecipients_(s) {
  let list = listEmails_(s['Approval emails']);
  if (!list.length) list = listEmails_(s['Admin emails'])
    .concat(getTeam_().filter(m => m.role === 'Admin' && m.email).map(m => m.email));
  return [...new Set(list.map(e => e.toLowerCase()))].join(',');
}

/** Approved task changed: email the employee when the date, time, limit or employee changed, or it was cancelled. */
function notifyEmployeeOfChange_(before, after, diff) {
  const s = getSettings_();
  const team = getTeam_();
  const emailOf = n => { const m = team.find(x => x.name === n && x.role === 'Employee'); return m && m.email; };
  const brand = s['Company name'] ? s['Company name'] + ' ' : '';
  const id = String(after[C.ID - 1]);
  const title = String(after[C.TASK - 1]);
  const link = employeeLink_(s);
  const oldWho = before.f.assignee, newWho = String(after[C.ASSIGNEE - 1]);
  let sent = 0;
  const send = (to, subject, body) => {
    if (!to) return;
    try { sendMail_({ to: to, subject: brand + subject, htmlBody: wrap_(body +
      '<p><a href="' + link + '">Open my tasks</a></p>') }); sent++; } catch (e) { Logger.log(e); }
  };
  if (after[C.APPROVAL - 1] === 'Cancelled' && before.vals[C.APPROVAL - 1] !== 'Cancelled') {
    send(emailOf(oldWho), id + ' cancelled', '<p><b>' + esc_(id) + ': ' + esc_(title) + '</b> has been cancelled. You don\'t need to work on it.</p>');
    return sent;
  }
  if (diff.assignee) {
    send(emailOf(oldWho), id + ' reassigned', '<p><b>' + esc_(id) + ': ' + esc_(title) + '</b> has been moved to someone else. It is no longer on your list.</p>');
    sent += sendNewTaskEmails_([after], s);
    return sent;
  }
  if (diff.due || diff.startTime || diff.limit) {
    const was = fmtDue_(before.vals[T.DUE_AT - 1], before.vals[C.DUE - 1]) + (before.f.limit ? ' · ' + before.f.limit + ' min' : '');
    const now = fmtDue_(after[T.DUE_AT - 1], after[C.DUE - 1]) + (limitVal_(after[T.LIMIT - 1]) ? ' · ' + limitVal_(after[T.LIMIT - 1]) + ' min' : '');
    send(emailOf(newWho), id + ' time changed: due ' + now,
      '<p>The timing of <b>' + esc_(id) + ': ' + esc_(title) + '</b> has changed.</p>' +
      '<p>Now due: <b>' + esc_(now) + '</b><br><span style="color:#999;text-decoration:line-through">Was: ' + esc_(was) + '</span></p>');
  }
  return sent;
}

// ---------- Reopen (admin only) ----------
function adminReopen(token, id) {
  requireSession_(token, 'admin');
  const sh = tasksSheet_();
  const row = findTaskRow_(sh, id);
  if (!row) throw new Error('Task ' + id + ' not found.');
  const v = sh.getRange(row, 1, 1, ALL_COLS).getValues()[0];
  if (v[C.STATUS - 1] !== 'Done') throw new Error(id + ' is not Done.');
  const when = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a');
  const log = String(v[T.REOPENED - 1] || '');
  sh.getRange(row, T.REOPENED).setNumberFormat('@').setValue((log ? log + '; ' : '') + 'Reopened by Admin ' + when);
  // Remember the time worked so far; after the rework, Time Taken = this + the rework only
  const workedSoFar = typeof v[T.TAKEN - 1] === 'number' ? v[T.TAKEN - 1] : (Number(minutesTaken_(v)) || 0);
  const now = new Date();
  PropertiesService.getScriptProperties().setProperty('REOPEN_' + id, JSON.stringify({ min: workedSoFar, at: now.getTime() }));
  sh.getRange(row, C.STATUS).setValue('In Progress');
  sh.getRange(row, C.COMPLETED).setValue('');
  sh.getRange(row, T.TAKEN).setValue('');
  sh.getRange(row, T.STARTED_AT).setValue(now);   // rework clock starts at the reopen
  // The employee tab still says Done; switch it back so the next sync doesn't re-close the task
  const tab = SpreadsheetApp.openById(getSettings_()['Employee sheet ID']).getSheetByName(String(v[C.ASSIGNEE - 1]));
  if (tab && tab.getLastRow() > 1) {
    const ids = tab.getRange(2, E.ID, tab.getLastRow() - 1, 1).getValues().map(r => r[0]);
    const i = ids.indexOf(id);
    if (i >= 0) tab.getRange(i + 2, E.STATUS).setValue('In Progress');
  }
  syncNow();
  return adminData(token);
}

// ---------- Approve / reject from email ----------
/** Email to admins when a task manager submits a task, with signed decision links. */
function notifyAdminsNewTask_(vals, createdBy) {
  const s = getSettings_();
  const to = approvalRecipients_(s);
  if (!to) return;
  const base = String(s['Dashboard URL'] || '').trim().replace(/\/+$/, '');
  const id = String(vals[C.ID - 1]);
  const tok = makeDecisionToken_(id);
  const link = a => base + '/approve?t=' + encodeURIComponent(tok) + '&a=' + a;
  const btn = (label, a, bg) => '<a href="' + link(a) + '" style="background:' + bg +
    ';color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;display:inline-block;margin:0 6px 6px 0">' + label + '</a>';
  const brand = s['Company name'] ? s['Company name'] + ' ' : '';
  let html = '<p><b>' + esc_(createdBy) + '</b> added a task that needs your approval.</p>' +
    '<div style="border:1px solid #e3e7ef;border-left:4px solid #a86a00;border-radius:8px;padding:12px 14px;margin:10px 0">' +
    '<div style="font-size:15px;font-weight:bold">' + esc_(vals[C.TASK - 1]) + '</div>' +
    (vals[C.DETAILS - 1] ? '<div style="color:#444;margin-top:6px;white-space:pre-wrap">' + esc_(vals[C.DETAILS - 1]) + '</div>' : '') +
    '<div style="color:#6b7487;font-size:13px;margin-top:8px">' + esc_(id) + ' &nbsp;|&nbsp; For: <b>' + esc_(vals[C.ASSIGNEE - 1]) + '</b>' +
    ' &nbsp;|&nbsp; Priority: <b>' + esc_(vals[C.PRIORITY - 1]) + '</b> &nbsp;|&nbsp; Due: <b>' + (fmtDue_(vals[T.DUE_AT - 1], vals[C.DUE - 1]) || 'No due date') + '</b>' +
    (vals[T.LIMIT - 1] ? ' &nbsp;|&nbsp; Time limit: <b>' + vals[T.LIMIT - 1] + ' min</b>' : '') + '</div></div>';
  if (base) {
    html += '<p>' + btn('Approve &amp; send now', 'approve_now', '#1e8e4e') + btn('Approve (evening summary)', 'approve', '#2c5fb3') +
      btn('Reject', 'reject', '#c0392b') + '</p>' +
      '<p style="color:#6b7487;font-size:12px">Each button opens a confirm page. Links work for ' + DECISION_DAYS + ' days. ' +
      'Or use the <a href="' + base + '/admin">admin dashboard</a>.</p>';
  } else {
    html += '<p>Open the admin dashboard to approve it. (Add "Dashboard URL" in Settings to get approve buttons here.)</p>';
  }
  try {
    sendMail_({ to: to, subject: brand + 'Approve task ' + id + ': ' + String(vals[C.TASK - 1]).slice(0, 70) + ' (by ' + createdBy + ')',
      htmlBody: wrap_(html) });
  } catch (e) { Logger.log('Admin notification failed: ' + e); }
}

/** Signed link token: "<id>.<kind>.<expiry>.<signature>"; kind is "t" (new task) or "c<requestTime>" (change). */
function makeDecisionToken_(id, kind) {
  const exp = Date.now() + DECISION_DAYS * 86400000;
  const payload = id + '.' + (kind || 't') + '.' + exp;
  return payload + '.' + sign_(payload);
}

function readDecisionToken_(tok) {
  const parts = String(tok || '').split('.');
  let id, kind, exp, sig, payload;
  if (parts.length === 3) { [id, exp, sig] = parts; kind = 't'; payload = id + '.' + exp; }   // links sent before change requests existed
  else if (parts.length === 4) { [id, kind, exp, sig] = parts; payload = id + '.' + kind + '.' + exp; }
  else throw new Error('This link is not valid.');
  if (sign_(payload) !== sig) throw new Error('This link is not valid.');
  if (Number(exp) < Date.now()) throw new Error('This link has expired. Use the admin dashboard instead.');
  return { id: id, kind: kind };
}

function sign_(text) {
  const key = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!key) throw new Error('Vercel connection is not set up.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, key)).replace(/=+$/, '');
}

/** Shown on the confirm page opened from the email. */
function decisionInfo(tok) {
  const d = readDecisionToken_(tok);
  const t = readTasksForWeb_().find(x => x.id === d.id);
  if (!t) throw new Error('This task no longer exists.');
  const info = { id: t.id, task: t.task, details: t.details, assignee: t.assignee, priority: t.priority,
                 dueLabel: t.dueLabel, limit: t.limit, createdBy: t.createdBy, approval: t.approval, status: t.status,
                 kind: d.kind.charAt(0) === 'c' ? 'change' : 'task' };
  if (info.kind === 'change') {
    const live = t.changeReq && String(t.changeReq.at) === d.kind.slice(1);
    info.change = live ? t.changeReq : null;   // null = already decided or replaced by a newer request
  }
  return info;
}

function decide(tok, action) {
  const d = readDecisionToken_(tok);
  if (d.kind.charAt(0) === 'c') {
    if (action !== 'approve_change' && action !== 'reject_change') throw new Error('Unknown action.');
    const r = decideChange_(d.id, action === 'approve_change', d.kind.slice(1));
    return { id: d.id, kind: 'change', already: r.already, approved: !!r.approved, emailed: r.emailed || 0 };
  }
  const map = { approve_now: 'Approved', approve: 'Approved', hold: 'On Hold', reject: 'Rejected' };
  if (!map[action]) throw new Error('Unknown action.');
  const t = readTasksForWeb_().find(x => x.id === d.id);
  if (!t) throw new Error('This task no longer exists.');
  if (t.approval !== 'Pending' && t.approval !== 'On Hold') {
    return { id: d.id, approval: t.approval, already: true, emailed: 0 };
  }
  const res = applyTaskUpdate_(d.id, { approval: map[action], sendNow: action === 'approve_now' });
  return { id: d.id, approval: map[action], already: false, emailed: res.emailed };
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
  data.newPin = pin ? { name: name, email: email, pin: pin, emailed: sendPinEmail_(name, email, pin, true) } : null;
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

/**
 * Removes a team member completely: PIN, Team row (name + email), access to the
 * Employees sheet and their tab there. Their tasks stay in the Admin sheet as history.
 * Any open session stops working on the next request (requireSession_ re-checks the Team tab).
 */
function adminRemoveEmployee(token, name) {
  requireSession_(token, 'admin');
  const m = getTeamAll_().find(x => x.name === name);
  if (!m) throw new Error('Team member not found.');

  syncNow();   // pull their latest updates into the Admin sheet before the tab goes

  const props = PropertiesService.getScriptProperties();
  if (m.email) props.deleteProperty('PIN_' + m.email.toLowerCase());

  const s = getSettings_();
  if (m.role === 'Employee') {
    const empSS = SpreadsheetApp.openById(s['Employee sheet ID']);
    if (m.email) {
      try { DriveApp.getFileById(empSS.getId()).removeEditor(m.email); } catch (e) { Logger.log('removeEditor: ' + e); }
      try { DriveApp.getFileById(empSS.getId()).removeViewer(m.email); } catch (e) { /* was not a viewer */ }
    }
    const tab = empSS.getSheetByName(m.name);
    if (tab && empSS.getSheets().length > 1) empSS.deleteSheet(tab);
  }

  // Find the row again right before deleting, in case the sheet changed
  const fresh = getTeamAll_().find(x => x.name === name && x.email === m.email);
  if (fresh) SpreadsheetApp.getActive().getSheetByName(TEAM_TAB).deleteRow(fresh.row);

  const data = adminData(token);
  data.removed = m.name;
  return data;
}

function adminResetPin(token, name) {
  requireSession_(token, 'admin');
  const m = getTeamAll_().find(x => x.name === name);
  if (!m || m.role !== 'Employee') throw new Error('Employee not found.');
  const data = adminData(token);
  const pin = newPin_(m.email);
  data.newPin = { name: m.name, email: m.email, pin: pin, emailed: sendPinEmail_(m.name, m.email, pin, false) };
  data.team.forEach(x => { if (x.name === m.name) x.hasPin = true; });
  return data;
}

function adminSyncNow(token) {
  requireSession_(token, STAFF);
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
      const l = t.status === 'Done' ? null : live[t.id];   // Done tickets are locked
      if (l) { t.status = l.status; t.progress = typeof l.progress === 'number' ? l.progress : t.progress; t.remarks = l.remarks; }
      return t;
    })
    .filter(t => t.status !== 'Done' || !t.completedMs || t.completedMs >= cutoff);
  return { name: sess.name, brand: String(s['Company name'] || ''), today: dayKey_(new Date()), tasks: tasks };
}

function empUpdateTask(token, id, status, progress, remarks, links) {
  const sess = requireSession_(token, 'employee');
  if (!STATUSES.includes(status)) throw new Error('Pick a valid status.');
  let p = Number(progress);
  if (isNaN(p)) p = 0;
  if (p > 1) p = p / 100;
  p = Math.max(0, Math.min(1, p));
  if (status === 'Done') p = 1;

  const master = readTasksForWeb_().find(x => x.id === id && x.assignee === sess.name);
  if (master && master.status === 'Done') throw new Error('This ticket is already Done and locked.');
  const cleanLinks = cleanLinks_(links);   // null = not sent (older page)
  const s = getSettings_();
  const tab = SpreadsheetApp.openById(s['Employee sheet ID']).getSheetByName(sess.name);
  if (!tab) throw new Error('Your task tab was not found. Ask the admin to run a sync.');
  const last = tab.getLastRow();
  if (last < 2) throw new Error('Task not found on your list.');
  const ids = tab.getRange(2, E.ID, last - 1, 1).getValues().map(r => r[0]);
  const idx = ids.indexOf(id);
  if (idx < 0) throw new Error('Task not found on your list. It may have been reassigned.');
  tab.getRange(idx + 2, E.STATUS, 1, 3).setValues([[status, p, String(remarks || '').slice(0, 2000)]]);
  if (cleanLinks) {
    const sh = tasksSheet_();
    const row = findTaskRow_(sh, id);
    if (row) sh.getRange(row, T.LINKS).setNumberFormat('@').setValue(cleanLinks.join('\n'));
  }
  syncNow();
  return empData(token);
}

/** Emails the employee their dashboard link and PIN. Returns true if sent. */
function sendPinEmail_(name, email, pin, isNew) {
  try {
    const s = getSettings_();
    const brand = String(s['Company name'] || '');
    const link = String(s['Dashboard URL'] || '').trim() ? employeeLink_(s) : '';
    const first = esc_(String(name).split(' ')[0]);
    let html = '<p>Hi ' + first + ',</p>' +
      (isNew ? '<p>You have been added to the ' + esc_(brand ? brand + ' ' : '') + 'task tracker. ' +
               'Your tasks will appear on your dashboard, and you will get a summary email every evening.</p>'
             : '<p>Your task dashboard PIN has been reset.</p>') +
      '<table style="border-collapse:collapse;margin:12px 0">' +
      (link ? '<tr><td style="padding:4px 12px 4px 0;color:#6b7487">Dashboard</td><td><a href="' + link + '">' + esc_(link) + '</a></td></tr>' : '') +
      '<tr><td style="padding:4px 12px 4px 0;color:#6b7487">Email</td><td><b>' + esc_(email) + '</b></td></tr>' +
      '<tr><td style="padding:4px 12px 4px 0;color:#6b7487">PIN</td><td style="font-size:20px;letter-spacing:3px"><b>' + pin + '</b></td></tr>' +
      '</table>' +
      (link ? '<p><a href="' + link + '" style="background:#1f3864;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open my tasks</a></p>' : '') +
      '<p style="color:#6b7487;font-size:12px">Keep this PIN private. Ask your admin to reset it if you think someone else knows it.</p>';
    sendMail_({ to: email,
      subject: (brand ? brand + ' ' : '') + (isNew ? 'Your task dashboard login' : 'Your new task dashboard PIN'),
      htmlBody: wrap_(html) });
    return true;
  } catch (e) {
    Logger.log('PIN email to ' + email + ' failed: ' + e);
    return false;
  }
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
  const nowMs = Date.now();
  const cols = Math.min(sh.getMaxColumns(), ALL_COLS);
  return sh.getRange(2, 1, last - 1, cols).getValues()
    .map(r => { while (r.length < ALL_COLS) r.push(''); return r; })
    .filter(r => r[C.ID - 1] && String(r[C.TASK - 1]).trim())
    .map(r => {
      const due = r[C.DUE - 1];
      const dueAt = r[T.DUE_AT - 1] instanceof Date ? r[T.DUE_AT - 1]
        : computeDueAt_(due, r[T.START - 1], r[T.LIMIT - 1]);
      const startedAt = r[T.STARTED_AT - 1];
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
        dueLabel: fmtDue_(dueAt, due),
        startTime: normStart_(r[T.START - 1]),
        limit: limitVal_(r[T.LIMIT - 1]),
        dueAtMs: dueAt instanceof Date ? dueAt.getTime() : 0,
        startedAtMs: startedAt instanceof Date ? startedAt.getTime() : 0,
        taken: typeof r[T.TAKEN - 1] === 'number' ? r[T.TAKEN - 1] : '',
        approval: approval,
        approvedOn: dt(r[C.APPROVED_ON - 1]),
        status: status,
        progress: typeof r[C.PROGRESS - 1] === 'number' ? r[C.PROGRESS - 1] : 0,
        remarks: String(r[C.REMARKS - 1] || ''),
        updated: dt(r[C.UPDATED - 1]),
        completed: dt(completed),
        completedMs: completed instanceof Date ? completed.getTime() : 0,
        overdue: approval === 'Approved' && status !== 'Done' &&
          (dueAt instanceof Date ? dueAt.getTime() < nowMs : due instanceof Date && dayKey_(due) < todayKey),
        createdBy: String(r[T.CREATED_BY - 1] || ''),
        changeReq: (function (req) { return req ? { by: req.by, at: req.at, cancel: !!req.cancel, lines: changeLines_(req) } : null; })(readChangeReq_(r[T.CHANGE_REQ - 1])),
        reopened: String(r[T.REOPENED - 1] || ''),
        links: parseLinks_(r[T.LINKS - 1]),
        state: taskState_(approval, status)
      };
    });
}

/** Tasks tab, with the Created By and timing columns added if they are missing. */
function tasksSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TASKS_TAB);
  ensureTaskCols_(sh);
  return sh;
}

function timeLimit_(v) {
  const n = Number(v);
  return LIMITS.includes(n) ? n : DEFAULT_LIMIT;
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
