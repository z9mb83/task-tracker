/**
 * TASK TRACKER - Google Sheets ticketing system
 * ------------------------------------------------------------
 * Paste this whole file into: Task Tracker - Admin > Extensions > Apps Script
 * Then run  setup()  once (or use the menu: Task System > Setup).
 *
 * What it does
 *  - Gives every new task on the Admin "Tasks" tab an ID (T-0001, T-0002 ...)
 *  - When a task is Approved, copies it to the assigned employee's tab
 *    in the "Task Tracker - Employees" file
 *  - Pulls each employee's Status / Progress % / Remarks back into the Admin sheet
 *  - Sends a daily email: each employee gets their open tasks,
 *    admins get a summary (pending approvals, overdue, blocked, done today)
 */

// ---------- Layout (1-based column numbers) ----------
const TZ = 'Asia/Kolkata';
const TASKS_TAB = 'Tasks';
const TEAM_TAB = 'Team';
const SETTINGS_TAB = 'Settings';
const HELP_TAB = 'How to use';

const C = {
  ID: 1, CREATED: 2, TASK: 3, DETAILS: 4, ASSIGNEE: 5, PRIORITY: 6, DUE: 7,
  APPROVAL: 8, APPROVED_ON: 9, STATUS: 10, PROGRESS: 11, REMARKS: 12,
  UPDATED: 13, COMPLETED: 14
};
const ADMIN_COLS = 14;
// Ticket timing columns (added after Created By in column O)
const T = { CREATED_BY: 15, START: 16, LIMIT: 17, DUE_AT: 18, STARTED_AT: 19, TAKEN: 20, CHANGE_REQ: 21, REOPENED: 22, LINKS: 23 };
const ALL_COLS = 23;
const TASK_HEADERS_EXTRA = ['Created By', 'Start Time', 'Time Limit (min)', 'Due At', 'Started At', 'Time Taken (min)',
                            'Change Request', 'Reopened', 'Links'];
const MAX_LINKS = 10;
// Columns that are frozen once a task is Done, Rejected or Cancelled
const LOCKED_COLS = [C.TASK, C.DETAILS, C.ASSIGNEE, C.PRIORITY, C.DUE, C.APPROVAL, T.START, T.LIMIT];
const LIMITS = [30, 45, 60];
const DEFAULT_LIMIT = 45;

// Employee tab columns
const EMP_HEADERS = ['Task ID', 'Task', 'Details', 'Priority', 'Due', 'Assigned On',
                     'Status', 'Progress %', 'Remarks'];
const E = { ID: 1, TASK: 2, DETAILS: 3, PRIORITY: 4, DUE: 5, ASSIGNED: 6,
            STATUS: 7, PROGRESS: 8, REMARKS: 9 };
const EMP_COLS = EMP_HEADERS.length;
const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done'];
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

// ---------- Menu ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Task System')
    .addItem('Sync now', 'syncNow')
    .addItem('Send daily emails now', 'sendDailyEmails')
    .addSeparator()
    .addItem('Setup (run once / after changing Settings)', 'setup')
    .addItem('Refresh employee tabs and permissions', 'refreshEmployeeTabs')
    .addSeparator()
    .addItem('Set dashboard admin password', 'setDashboardPassword')
    .addItem('Show dashboard links', 'showDashboardLinks')
    .addItem('Set up Vercel connection', 'setUpVercelConnection')
    .addToUi();
}

// ---------- Setup ----------
function setup() {
  const s = getSettings_();
  // Remove old triggers created by this script
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['syncNow', 'sendDailyEmails', 'onAdminEdit'].includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });

  let mins = Number(s['Sync every (minutes)']) || 15;
  if (![1, 5, 10, 15, 30].includes(mins)) mins = 15;
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(mins).create();

  let hour = Number(s['Daily email hour']);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 19;
  ScriptApp.newTrigger('sendDailyEmails').timeBased()
    .atHour(hour).everyDays(1).inTimezone(TZ).create();

  // Push immediately when an admin approves a task
  ScriptApp.newTrigger('onAdminEdit')
    .forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();

  refreshEmployeeTabs();
  syncNow();
  try {
    SpreadsheetApp.getUi().alert('Setup done.\n\nSync runs every ' + mins +
      ' minutes and the daily email goes out at ' + hour + ':00 IST.');
  } catch (e) { /* no UI when run from the editor */ }
}

/** Creates a tab for every active employee, shares the file, sets protections. */
function refreshEmployeeTabs() {
  const s = getSettings_();
  const empSS = SpreadsheetApp.openById(s['Employee sheet ID']);
  const file = DriveApp.getFileById(empSS.getId());
  const editors = file.getEditors().map(u => u.getEmail().toLowerCase());
  const adminEmails = getTeam_().filter(m => m.role === 'Admin').map(m => m.email)
    .concat(listEmails_(s['Admin emails']));

  getTeam_().filter(m => m.role === 'Employee').forEach(m => {
    const sh = getOrCreateEmpTab_(empSS, m.name);
    if (m.email && !editors.includes(m.email.toLowerCase())) {
      try { file.addEditor(m.email); } catch (e) { Logger.log('Could not share with ' + m.email + ': ' + e); }
    }
    protectEmpTab_(sh, m.email, adminEmails);
  });
  // The help tab is read-only for everyone except the owner/admins
  const help = empSS.getSheetByName(HELP_TAB);
  if (help) protectWholeSheet_(help, adminEmails);
}

/** Installable onEdit: sync as soon as a task is approved or edited after approval. */
function onAdminEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== TASKS_TAB || e.range.getRow() < 2) return;
  const col = e.range.getColumn();
  // Done / Rejected / Cancelled tasks are locked: undo single-cell edits to their task fields
  if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && LOCKED_COLS.includes(col)) {
    const row = sh.getRange(e.range.getRow(), 1, 1, ADMIN_COLS).getValues()[0];
    const approval = col === C.APPROVAL ? e.oldValue : row[C.APPROVAL - 1];
    if (row[C.ID - 1] && (row[C.STATUS - 1] === 'Done' || approval === 'Rejected' || approval === 'Cancelled')) {
      if (e.oldValue !== undefined) e.range.setValue(e.oldValue); else e.range.clearContent();
      SpreadsheetApp.getActive().toast(row[C.ID - 1] + ' is ' + (row[C.STATUS - 1] === 'Done' ? 'Done' : approval) +
        ' and locked. Use Reopen on the admin dashboard if it really needs changing.', 'Locked', 6);
      return;
    }
  }
  if ((col >= C.TASK && col <= C.APPROVAL) || col === T.START || col === T.LIMIT) syncNow();
}

// ---------- Main sync ----------
function syncNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const s = getSettings_();
    const ss = SpreadsheetApp.getActive();
    const tasksSh = ss.getSheetByName(TASKS_TAB);
    const empSS = SpreadsheetApp.openById(s['Employee sheet ID']);
    const now = new Date();
    const keepDays = Number(s['Keep done tasks visible (days)']) || 3;

    ensureTaskCols_(tasksSh);
    const lastRow = tasksSh.getLastRow();
    if (lastRow < 2) return;
    const data = tasksSh.getRange(2, 1, lastRow - 1, ALL_COLS).getValues();

    // 1. IDs and approval timestamps
    let maxId = 0;
    data.forEach(r => {
      const m = String(r[C.ID - 1]).match(/^T-(\d+)$/);
      if (m) maxId = Math.max(maxId, Number(m[1]));
    });
    data.forEach(r => {
      if (!String(r[C.TASK - 1]).trim()) return;
      if (!r[C.ID - 1]) {
        r[C.ID - 1] = 'T-' + String(++maxId).padStart(4, '0');
        r[C.CREATED - 1] = now;
      }
      // Due At = due date + start time + time limit
      r[T.DUE_AT - 1] = computeDueAt_(r[C.DUE - 1], r[T.START - 1], r[T.LIMIT - 1]) || '';
      if (r[C.APPROVAL - 1] === 'Approved' && !r[C.APPROVED_ON - 1]) {
        r[C.APPROVED_ON - 1] = now;
        if (!r[C.STATUS - 1]) r[C.STATUS - 1] = 'Not Started';
        if (r[C.PROGRESS - 1] === '') r[C.PROGRESS - 1] = 0;
      }
    });

    // 2. Pull employee updates (only from the tab of the current assignee)
    const empData = readAllEmpTabs_(empSS);   // { tabName: { taskId: {status, progress, remarks} } }
    data.forEach(r => {
      const id = r[C.ID - 1];
      const who = r[C.ASSIGNEE - 1];
      if (!id || !who || !empData[who] || !empData[who][id]) return;
      if (r[C.STATUS - 1] === 'Done') return;   // Done tickets are locked
      const u = empData[who][id];
      const changed = u.status !== r[C.STATUS - 1] ||
                      !sameNum_(u.progress, r[C.PROGRESS - 1]) ||
                      u.remarks !== r[C.REMARKS - 1];
      if (!changed) return;
      r[C.STATUS - 1] = u.status;
      r[C.PROGRESS - 1] = u.progress;
      r[C.REMARKS - 1] = u.remarks;
      r[C.UPDATED - 1] = now;
      if (u.status === 'In Progress' && !(r[T.STARTED_AT - 1] instanceof Date)) r[T.STARTED_AT - 1] = now;
      if (u.status === 'Not Started') r[T.STARTED_AT - 1] = '';
      if (u.status === 'Done') {
        if (!r[C.COMPLETED - 1]) r[C.COMPLETED - 1] = now;
        if (u.progress === '' || u.progress < 1) r[C.PROGRESS - 1] = 1;
        r[T.TAKEN - 1] = minutesTaken_(r);
      } else {
        r[C.COMPLETED - 1] = '';
        r[T.TAKEN - 1] = '';
      }
    });

    // Write back only the script-owned columns so admin typing is never overwritten
    tasksSh.getRange(2, C.ID, data.length, 2)
      .setValues(data.map(r => [r[C.ID - 1], r[C.CREATED - 1]]));
    tasksSh.getRange(2, C.APPROVED_ON, data.length, ADMIN_COLS - C.APPROVED_ON + 1)
      .setValues(data.map(r => r.slice(C.APPROVED_ON - 1, ADMIN_COLS)));
    tasksSh.getRange(2, T.DUE_AT, data.length, 3)
      .setValues(data.map(r => r.slice(T.DUE_AT - 1, T.TAKEN)));

    // 3. Push approved tasks to each employee tab
    const cutoff = new Date(now.getTime() - keepDays * 86400000);
    getTeam_().filter(m => m.role === 'Employee').forEach(m => {
      const isNew = !empSS.getSheetByName(m.name);
      const sh = getOrCreateEmpTab_(empSS, m.name);
      if (isNew) setUpNewEmployee_(empSS, sh, m, s);
      upgradeEmpTab_(sh);
      // Re-read the tab right before writing so an edit made a moment ago is kept
      const current = readEmpTab_(sh);
      const rows = data
        .filter(r => r[C.ID - 1] && r[C.ASSIGNEE - 1] === m.name && r[C.APPROVAL - 1] === 'Approved')
        .filter(r => r[C.STATUS - 1] !== 'Done' || !r[C.COMPLETED - 1] || r[C.COMPLETED - 1] >= cutoff)
        .map(r => {
          const id = r[C.ID - 1];
          const cur = r[C.STATUS - 1] === 'Done' ? null : current[id];   // locked: always show the final values
          const limit = limitVal_(r[T.LIMIT - 1]);
          return [id, r[C.TASK - 1] + (limit ? ' (' + limit + ' min)' : ''), r[C.DETAILS - 1], r[C.PRIORITY - 1],
                  r[T.DUE_AT - 1] instanceof Date ? r[T.DUE_AT - 1] : r[C.DUE - 1],
                  r[C.APPROVED_ON - 1],
                  cur ? cur.status : r[C.STATUS - 1],
                  cur ? cur.progress : r[C.PROGRESS - 1],
                  cur ? cur.remarks : r[C.REMARKS - 1]];
        })
        .sort(sortEmpRows_);

      const oldLast = sh.getLastRow();
      if (oldLast > 1) sh.getRange(2, 1, oldLast - 1, EMP_COLS).clearContent();
      if (rows.length) sh.getRange(2, 1, rows.length, EMP_COLS).setValues(rows);
    });
  } finally {
    lock.releaseLock();
  }
}

/** Instant email to the assignee (dashboard "Send now"). Returns how many emails went out. */
function sendNewTaskEmails_(rows, s) {
  let sent = 0;
  const team = getTeam_();
  const brand = s['Company name'] ? s['Company name'] + ' ' : '';
  const link = employeeLink_(s);
  const byPerson = {};
  rows.forEach(r => {
    const name = r[C.ASSIGNEE - 1];
    (byPerson[name] = byPerson[name] || []).push(r);
  });
  Object.keys(byPerson).forEach(name => {
    const m = team.find(x => x.name === name && x.role === 'Employee');
    if (!m || !m.email) return;
    const list = byPerson[name];
    let html = '<p>Hi ' + esc_(name.split(' ')[0]) + ',</p><p>' +
      (list.length === 1 ? 'A new task has been assigned to you:' : list.length + ' new tasks have been assigned to you:') + '</p>';
    list.forEach(r => {
      html += '<div style="border:1px solid #e3e7ef;border-left:4px solid #1f3864;border-radius:8px;padding:12px 14px;margin:10px 0">' +
        '<div style="font-size:15px;font-weight:bold">' + esc_(r[C.TASK - 1]) + '</div>' +
        (r[C.DETAILS - 1] ? '<div style="color:#444;margin-top:6px;white-space:pre-wrap">' + esc_(r[C.DETAILS - 1]) + '</div>' : '') +
        '<div style="color:#6b7487;font-size:13px;margin-top:8px">' + esc_(r[C.ID - 1]) +
        (r[C.PRIORITY - 1] ? ' &nbsp;|&nbsp; Priority: <b>' + esc_(r[C.PRIORITY - 1]) + '</b>' : '') +
        ' &nbsp;|&nbsp; Due: <b>' + (fmtDue_(r[T.DUE_AT - 1], r[C.DUE - 1]) || 'No due date') + '</b>' +
        (r[T.LIMIT - 1] ? ' &nbsp;|&nbsp; Time limit: <b>' + r[T.LIMIT - 1] + ' min</b>' : '') + '</div></div>';
    });
    html += '<p><a href="' + link + '" style="background:#1f3864;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open my tasks</a></p>' +
      '<p style="color:#6b7487;font-size:12px">Update the status there as you work on it.</p>';
    const subject = brand + (list.length === 1 ? 'New task: ' + String(list[0][C.TASK - 1]).slice(0, 80) : list.length + ' new tasks assigned to you');
    try {
      sendMail_({ to: m.email, subject: subject, htmlBody: wrap_(html) });
      sent++;
    } catch (e) { Logger.log('New-task email to ' + m.email + ' failed: ' + e); }
  });
  return sent;
}

// ---------- Daily email ----------
function sendDailyEmails() {
  syncNow();
  const s = getSettings_();
  const tasks = getAdminTasks_();
  const team = getTeam_();
  const todayKey = dayKey_(new Date());
  const since = new Date(Date.now() - 86400000);
  const brand = s['Company name'] ? s['Company name'] + ' ' : '';
  const empUrl = employeeLink_(s);
  const tomorrowLabel = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, 'EEE, dd MMM');
  const adminUrl = SpreadsheetApp.getActive().getUrl();
  const dateLabel = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');

  const isOpen = t => t.approval === 'Approved' && t.status !== 'Done';
  const nowMs = Date.now();
  const isOverdue = t => isOpen(t) && (t.dueAt instanceof Date ? t.dueAt.getTime() < nowMs
                                       : t.due instanceof Date && dayKey_(t.due) < todayKey);

  // Employees
  if (String(s['Send employee emails']).toLowerCase() === 'yes') {
    team.filter(m => m.role === 'Employee' && m.email).forEach(m => {
      const mine = tasks.filter(t => t.assignee === m.name);
      const open = mine.filter(isOpen).sort((a, b) => dueVal_(a.dueAt || a.due) - dueVal_(b.dueAt || b.due));
      const doneToday = mine.filter(t => t.completed instanceof Date && t.completed >= since);
      if (!open.length && !doneToday.length) return;

      const overdue = open.filter(isOverdue);
      let html = '<p>Hi ' + esc_(m.name.split(' ')[0]) + ',</p>' +
        '<p>Here is your list for tomorrow. You have <b>' + open.length + '</b> open task(s)' +
        (overdue.length ? ', <b style="color:#c00000">' + overdue.length + ' overdue</b>' : '') + '.</p>';
      if (open.length) {
        html += table_(['ID', 'Task', 'Priority', 'Due', 'Time', 'Status'],
          open.map(t => [t.id, (t.approvedOn instanceof Date && t.approvedOn >= since ? 'NEW: ' : '') + t.task, t.priority,
            fmtDue_(t.dueAt, t.due), t.limit ? t.limit + ' min' : '', t.status]),
          open.map(t => isOverdue(t)));
      }
      if (doneToday.length) {
        html += '<p style="margin-top:16px">Completed in the last 24 hours: ' +
          doneToday.map(t => esc_(t.task)).join(', ') + '</p>';
      }
      html += '<p><a href="' + empUrl + '">Open my tasks</a> and update Status, Progress % and Remarks.</p>';
      sendMail_({ to: m.email, subject: brand + 'Your tasks for tomorrow, ' + tomorrowLabel, htmlBody: wrap_(html) });
    });
  }

  // Admin summary
  const admins = listEmails_(s['Admin emails'])
    .concat(team.filter(m => m.role === 'Admin' && m.email).map(m => m.email));
  const to = [...new Set(admins.map(e => e.toLowerCase()))].join(',');
  if (!to) return;

  const pending = tasks.filter(t => t.approval === 'Pending');
  const overdue = tasks.filter(isOverdue);
  const blocked = tasks.filter(t => isOpen(t) && t.status === 'Blocked');
  const doneToday = tasks.filter(t => t.completed instanceof Date && t.completed >= since);

  const perEmp = team.filter(m => m.role === 'Employee').map(m => {
    const mine = tasks.filter(t => t.assignee === m.name);
    return [m.name,
      mine.filter(t => isOpen(t) && t.status === 'Not Started').length,
      mine.filter(t => isOpen(t) && t.status === 'In Progress').length,
      mine.filter(t => isOpen(t) && t.status === 'Blocked').length,
      mine.filter(isOverdue).length,
      mine.filter(t => t.completed instanceof Date && t.completed >= since).length];
  });

  let html = '<h2 style="margin:0 0 8px">Daily task summary, ' + dateLabel + '</h2>' +
    '<p><b>' + doneToday.length + '</b> done in last 24h &nbsp;|&nbsp; <b style="color:#c00000">' +
    overdue.length + '</b> overdue &nbsp;|&nbsp; <b>' + blocked.length + '</b> blocked &nbsp;|&nbsp; <b>' +
    pending.length + '</b> waiting for your approval</p>';

  html += '<h3>By employee</h3>' + table_(
    ['Employee', 'Not Started', 'In Progress', 'Blocked', 'Overdue', 'Done (24h)'], perEmp);
  if (pending.length) html += '<h3>Waiting for approval</h3>' + table_(
    ['ID', 'Task', 'Assigned To', 'Priority', 'Due', 'Added by'],
    pending.map(t => [t.id, t.task, t.assignee, t.priority, fmtDue_(t.dueAt, t.due), t.createdBy]));
  if (overdue.length) html += '<h3>Overdue</h3>' + table_(
    ['ID', 'Task', 'Assigned To', 'Due', 'Status', 'Remarks'],
    overdue.map(t => [t.id, t.task, t.assignee, fmtDue_(t.dueAt, t.due), t.status, t.remarks]));
  if (blocked.length) html += '<h3>Blocked</h3>' + table_(
    ['ID', 'Task', 'Assigned To', 'Remarks'],
    blocked.map(t => [t.id, t.task, t.assignee, t.remarks]));
  if (doneToday.length) html += '<h3>Completed in the last 24 hours</h3>' + table_(
    ['ID', 'Task', 'Assigned To', 'Completed', 'Time taken', 'Links'],
    doneToday.map(t => [t.id, t.task, t.assignee, Utilities.formatDate(t.completed, TZ, 'dd MMM, hh:mm a'),
      t.taken !== '' && t.taken != null ? t.taken + ' min' + (t.limit ? ' / ' + t.limit : '') : '',
      { html: t.links.map((u, i) => '<a href="' + esc_(u) + '">Link ' + (i + 1) + '</a>').join(' ') }]));
  html += '<p><a href="' + adminUrl + '">Open the admin sheet</a></p>';

  sendMail_({ to: to, subject: brand + 'Daily task summary, ' + dateLabel, htmlBody: wrap_(html) });
}

// ---------- Employee tab helpers ----------
function getOrCreateEmpTab_(empSS, name) {
  let sh = empSS.getSheetByName(name);
  if (sh) return sh;
  sh = empSS.insertSheet(name);
  sh.getRange(1, 1, 1, EMP_COLS).setValues([EMP_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f3864').setWrap(true);
  sh.setFrozenRows(1);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, E.DUE, rows, 1).setNumberFormat('dd-mmm h:mm am/pm');
  sh.getRange(2, E.ASSIGNED, rows, 1).setNumberFormat('dd-mmm-yyyy');
  sh.getRange(2, E.PROGRESS, rows, 1).setNumberFormat('0%').setHorizontalAlignment('center');
  sh.getRange(2, E.STATUS, rows, 3).setBackground('#fff9c4');
  sh.getRange(2, 1, rows, EMP_COLS).setVerticalAlignment('top');
  sh.getRange(2, E.TASK, rows, 2).setWrap(true);
  sh.getRange(2, E.REMARKS, rows, 1).setWrap(true);
  sh.getRange(2, E.STATUS, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  sh.getRange(2, E.PROGRESS, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberBetween(0, 1).setAllowInvalid(false)
      .setHelpText('Enter a percentage, e.g. 50%').build());
  [80, 260, 300, 80, 130, 105, 115, 95, 280].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const all = sh.getRange(2, 1, rows, EMP_COLS);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($E2<>"",$E2<NOW(),$G2<>"Done")')
      .setFontColor('#c00000').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="Done"')
      .setFontColor('#6aa84f').setStrikethrough(true).setRanges([all]).build()
  ];
  sh.setConditionalFormatRules(rules);
  return sh;
}

/** A person added to the Team tab after setup: share the file and lock their tab. */
function setUpNewEmployee_(empSS, sh, m, s) {
  const adminEmails = getTeam_().filter(x => x.role === 'Admin').map(x => x.email)
    .concat(listEmails_(s['Admin emails']));
  if (m.email) {
    try { DriveApp.getFileById(empSS.getId()).addEditor(m.email); } catch (e) { Logger.log(e); }
  }
  protectEmpTab_(sh, m.email, adminEmails);
}

/** Only the employee (and admins) can edit their tab, and only Status / Progress / Remarks. */
function protectEmpTab_(sh, empEmail, adminEmails) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());

  const sheetP = sh.protect().setDescription('Only ' + sh.getName() + ' can edit this tab');
  sheetP.removeEditors(sheetP.getEditors());
  const allowed = adminEmails.concat(empEmail ? [empEmail] : []);
  if (allowed.length) { try { sheetP.addEditors(allowed); } catch (e) { Logger.log(e); } }

  // Inside the tab, the employee may change only columns G to I (below the header)
  const fixed = [sh.getRange(1, 1, 1, EMP_COLS), sh.getRange(2, 1, sh.getMaxRows() - 1, E.ASSIGNED)];
  fixed.forEach(r => {
    const p = r.protect().setDescription('Set by admin');
    p.removeEditors(p.getEditors());
    if (adminEmails.length) { try { p.addEditors(adminEmails); } catch (e) { Logger.log(e); } }
  });
}

function protectWholeSheet_(sh, adminEmails) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  const p = sh.protect().setDescription('Read only');
  p.removeEditors(p.getEditors());
  if (adminEmails.length) { try { p.addEditors(adminEmails); } catch (e) { Logger.log(e); } }
}

function readAllEmpTabs_(empSS) {
  const out = {};
  empSS.getSheets().forEach(sh => {
    if (sh.getName() === HELP_TAB) return;
    out[sh.getName()] = readEmpTab_(sh);
  });
  return out;
}

function readEmpTab_(sh) {
  const map = {};
  const last = sh.getLastRow();
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, EMP_COLS).getValues().forEach(r => {
    const id = r[E.ID - 1];
    if (!id) return;
    let p = r[E.PROGRESS - 1];
    if (typeof p === 'number' && p > 1) p = p / 100;   // someone typed 50 instead of 50%
    map[id] = { status: r[E.STATUS - 1], progress: p, remarks: r[E.REMARKS - 1] };
  });
  return map;
}

function sortEmpRows_(a, b) {
  const doneA = a[E.STATUS - 1] === 'Done' ? 1 : 0;
  const doneB = b[E.STATUS - 1] === 'Done' ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  const d = dueVal_(a[E.DUE - 1]) - dueVal_(b[E.DUE - 1]);
  if (d) return d;
  return (PRIORITY_RANK[a[E.PRIORITY - 1]] ?? 3) - (PRIORITY_RANK[b[E.PRIORITY - 1]] ?? 3);
}

// ---------- Data readers ----------
function getSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  const out = {};
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues()
    .forEach(r => { if (r[0]) out[String(r[0]).trim()] = r[1]; });
  if (!out['Employee sheet ID']) throw new Error('Settings: "Employee sheet ID" is empty.');
  return out;
}

function getTeam_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TEAM_TAB);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter(r => r[0] && String(r[3]).toLowerCase() === 'yes')
    .map(r => ({ name: String(r[0]).trim(), email: String(r[1]).trim(), role: r[2] || 'Employee' }));
}

function getAdminTasks_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TASKS_TAB);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = Math.min(sh.getMaxColumns(), ALL_COLS);
  return sh.getRange(2, 1, last - 1, cols).getValues()
    .map(r => { while (r.length < ALL_COLS) r.push(''); return r; })
    .filter(r => r[C.ID - 1])
    .map(r => ({
      id: r[C.ID - 1], task: r[C.TASK - 1], assignee: r[C.ASSIGNEE - 1], priority: r[C.PRIORITY - 1],
      due: r[C.DUE - 1], approval: r[C.APPROVAL - 1], status: r[C.STATUS - 1],
      progress: r[C.PROGRESS - 1], remarks: r[C.REMARKS - 1], completed: r[C.COMPLETED - 1],
      approvedOn: r[C.APPROVED_ON - 1], createdBy: r[T.CREATED_BY - 1] || '',
      dueAt: r[T.DUE_AT - 1], limit: limitVal_(r[T.LIMIT - 1]), taken: typeof r[T.TAKEN - 1] === 'number' ? r[T.TAKEN - 1] : '',
      links: parseLinks_(r[T.LINKS - 1])
    }));
}

// ---------- Ticket timing ----------
/** Adds the Created By + timing columns (O:T) to the Tasks tab if they are missing. */
function ensureTaskCols_(sh) {
  if (sh.getMaxColumns() < ALL_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), ALL_COLS - sh.getMaxColumns());
    // New columns copy their neighbour's date format; give each the right one
    const n = sh.getMaxRows() - 1;
    sh.getRange(2, T.CREATED_BY, n, 2).setNumberFormat('@');          // Created By, Start Time: text
    sh.getRange(2, T.LIMIT, n, 1).setNumberFormat('0');               // minutes
    sh.getRange(2, T.DUE_AT, n, 2).setNumberFormat('dd-mmm h:mm am/pm');
    sh.getRange(2, T.TAKEN, n, 1).setNumberFormat('0');
    sh.getRange(2, T.CHANGE_REQ, n, 3).setNumberFormat('@');
  }
  const hdr = sh.getRange(1, T.CREATED_BY, 1, TASK_HEADERS_EXTRA.length);
  const cur = hdr.getValues()[0];
  if (cur.some((v, i) => !v)) hdr.setValues([TASK_HEADERS_EXTRA.map((h, i) => cur[i] || h)]);
}

/** Time limit cell -> minutes. Copes with a cell accidentally formatted as a date (45 shown as 13-Feb-1900). */
function limitVal_(v) {
  if (v instanceof Date) v = Math.round((v.getTime() - new Date(1899, 11, 30).getTime()) / 86400000);
  const n = Number(v);
  return n > 0 && n <= 600 ? n : '';
}

/** "11:00", "9:30", "2:15 pm" -> { h, m } (24h), or null. */
function parseStart_(v) {
  if (v instanceof Date) return { h: v.getHours(), m: v.getMinutes() };
  const x = String(v || '').trim().toLowerCase().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/);
  if (!x) return null;
  let h = Number(x[1]); const m = Number(x[2]);
  if (x[3] === 'pm' && h < 12) h += 12;
  if (x[3] === 'am' && h === 12) h = 0;
  return h < 24 && m < 60 ? { h: h, m: m } : null;
}
function normStart_(v) {
  const p = parseStart_(v);
  return p ? String(p.h).padStart(2, '0') + ':' + String(p.m).padStart(2, '0') : '';
}

/** Due date + start time + time limit (minutes) -> Date in IST, or null. */
function computeDueAt_(day, start, limit) {
  const p = parseStart_(start);
  if (!(day instanceof Date) || !p) return null;
  const startAt = Utilities.parseDate(dayKey_(day) + ' ' + p.h + ':' + p.m, TZ, 'yyyy-MM-dd H:m');
  return new Date(startAt.getTime() + (limitVal_(limit) || DEFAULT_LIMIT) * 60000);
}

/** Minutes from start to completion: actual start if the employee pressed In Progress, else the scheduled start. */
function minutesTaken_(r) {
  const done = r[C.COMPLETED - 1];
  if (!(done instanceof Date)) return '';
  let from = r[T.STARTED_AT - 1];
  if (!(from instanceof Date) && r[T.DUE_AT - 1] instanceof Date) {
    from = new Date(r[T.DUE_AT - 1].getTime() - (limitVal_(r[T.LIMIT - 1]) || DEFAULT_LIMIT) * 60000);
  }
  if (!(from instanceof Date) || done < from) return '';
  return Math.max(1, Math.round((done - from) / 60000));
}

function fmtDue_(dueAt, day) {
  return dueAt instanceof Date ? Utilities.formatDate(dueAt, TZ, 'dd MMM, h:mm a') : fmtDate_(day);
}

/** Older employee tabs: show Due as date + time and flag overdue by the clock. */
function upgradeEmpTab_(sh) {
  if (sh.getRange(1, E.DUE).getValue() === 'Due') return;
  sh.getRange(1, E.DUE).setValue('Due');
  sh.getRange(2, E.DUE, sh.getMaxRows() - 1, 1).setNumberFormat('dd-mmm h:mm am/pm');
  sh.setColumnWidth(E.DUE, 130);
  const all = sh.getRange(2, 1, sh.getMaxRows() - 1, EMP_COLS);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($E2<>"",$E2<NOW(),$G2<>"Done")')
      .setFontColor('#c00000').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="Done"')
      .setFontColor('#6aa84f').setStrikethrough(true).setRanges([all]).build()
  ]);
}

// ---------- Work links ----------
/** Links cell (one URL per line) -> array of http(s) URLs. */
function parseLinks_(v) {
  return String(v || '').split(/\s*\n\s*/).map(x => x.trim()).filter(x => /^https?:\/\/\S+$/i.test(x));
}
/** Cleans links sent from the dashboard. */
function cleanLinks_(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  list.forEach(u => {
    u = String(u || '').trim();
    if (!u) return;
    if (!/^https?:\/\/\S+$/i.test(u) || u.length > 500) throw new Error('Not a valid link: ' + u.slice(0, 60));
    if (!out.includes(u)) out.push(u);
  });
  if (out.length > MAX_LINKS) throw new Error('Up to ' + MAX_LINKS + ' links per task.');
  return out;
}

// ---------- Small utilities ----------
/** All emails go through here so they show the sender name from Settings ("Task Tracker" by default). */
function sendMail_(opts) {
  let name = 'Task Tracker';
  try { name = String(getSettings_()['Sender name'] || '').trim() || name; } catch (e) { /* settings missing */ }
  opts.name = name;
  MailApp.sendEmail(opts);
}

/** Employee dashboard link for emails (falls back to the Employees sheet if no Dashboard URL is set). */
function employeeLink_(s) {
  const base = String(s['Dashboard URL'] || '').trim().replace(/\/+$/, '');
  return base ? base + '/employee' : 'https://docs.google.com/spreadsheets/d/' + s['Employee sheet ID'];
}
function listEmails_(v) { return String(v || '').split(/[,;\s]+/).filter(x => x.includes('@')); }
function dayKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function dueVal_(d) { return d instanceof Date ? d.getTime() : Number.MAX_SAFE_INTEGER; }
function fmtDate_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd MMM yyyy') : ''; }
function pct_(p) { return typeof p === 'number' ? Math.round(p * 100) + '%' : ''; }
function sameNum_(a, b) {
  if (a === '' || b === '') return a === b;
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function table_(headers, rows, redRows) {
  const th = 'style="background:#1f3864;color:#fff;padding:6px 10px;text-align:left;font-size:13px"';
  let h = '<table style="border-collapse:collapse;margin:6px 0 14px">' +
    '<tr>' + headers.map(x => '<th ' + th + '>' + esc_(x) + '</th>').join('') + '</tr>';
  rows.forEach((r, i) => {
    const color = redRows && redRows[i] ? 'color:#c00000;' : '';
    h += '<tr>' + r.map(c => '<td style="' + color +
      'border-bottom:1px solid #ddd;padding:6px 10px;font-size:13px">' + (c && c.html !== undefined ? c.html : esc_(c)) + '</td>').join('') + '</tr>';
  });
  return h + '</table>';
}
function wrap_(inner) {
  return '<div style="font-family:Arial,sans-serif;color:#222;max-width:820px">' + inner + '</div>';
}
