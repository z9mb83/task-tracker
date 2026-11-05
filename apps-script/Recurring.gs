/**
 * TASK TRACKER - Repeating tasks
 * ------------------------------------------------------------
 * The admin sets up a task that repeats daily, weekly or monthly. Rules live in the
 * "Recurring" tab of the Admin sheet; every morning (7 AM, India time) a trigger adds
 * that day's copy to the Tasks tab as an approved task, exactly like a task added by hand.
 *
 *  - Daily:   every working day (weekly off and office holidays are skipped)
 *  - Weekly:  on the chosen weekdays; a chosen day that is a holiday is skipped
 *  - Monthly: on day N of the month (the last day in shorter months); if that is a weekly
 *             off or a holiday, the task is created on the next working day instead
 * A rule makes at most one task a day ("Last Created" in the sheet stops duplicates).
 */

const REC_TAB = 'Recurring';
const REC_HEADERS = ['Rule ID', 'Active', 'Task', 'Details', 'Assigned To', 'Priority', 'Repeat', 'Days',
                     'Start Time', 'Time Limit (min)', 'Starts On', 'Ends On', 'Last Created', 'Last Result', 'Created On'];
const R = { ID: 1, ACTIVE: 2, TASK: 3, DETAILS: 4, ASSIGNEE: 5, PRIORITY: 6, REPEAT: 7, DAYS: 8,
            START: 9, LIMIT: 10, STARTS: 11, ENDS: 12, LAST: 13, RESULT: 14, CREATED: 15 };
const REC_COLS = REC_HEADERS.length;
const REPEATS = ['Daily', 'Weekly', 'Monthly'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECURRING_HOUR = 7;

// ---------- Sheet ----------
function recSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(REC_TAB);
  if (!sh) {
    sh = ss.insertSheet(REC_TAB);
    sh.getRange(1, 1, 1, REC_COLS).setValues([REC_HEADERS]).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, REC_COLS).setNumberFormat('@');   // keep dates and times as typed text
  }
  return sh;
}

const recKey_ = v => v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim();

function readRecurring_() {
  const sh = recSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, REC_COLS).getValues().map((r, i) => ({
    row: i + 2,
    id: String(r[R.ID - 1] || ''),
    active: String(r[R.ACTIVE - 1]).toLowerCase() !== 'no',
    task: String(r[R.TASK - 1] || ''),
    details: String(r[R.DETAILS - 1] || ''),
    assignee: String(r[R.ASSIGNEE - 1] || ''),
    priority: String(r[R.PRIORITY - 1] || 'Medium'),
    repeat: String(r[R.REPEAT - 1] || ''),
    days: String(r[R.DAYS - 1] || ''),
    startTime: normStart_(r[R.START - 1]),
    limit: timeLimit_(r[R.LIMIT - 1]),
    startsOn: recKey_(r[R.STARTS - 1]),
    endsOn: recKey_(r[R.ENDS - 1]),
    lastCreated: recKey_(r[R.LAST - 1]),
    lastResult: String(r[R.RESULT - 1] || ''),
    createdOn: recKey_(r[R.CREATED - 1])
  })).filter(x => x.id && x.task);
}

// ---------- Schedule ----------
function dayInfo_(key, cfg) {
  return monthDays_(key.slice(0, 7), cfg).find(d => d.date === key);
}
function addDays_(key, n) {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}
/** 'Mon, Thu' -> [1, 4] */
function weekdaysOf_(v) {
  return String(v || '').split(/[,;\s]+/).map(x => WEEKDAYS.map(w => w.toLowerCase()).indexOf(x.trim().slice(0, 3).toLowerCase())).filter(i => i >= 0);
}
/** Day N of a month, moved forward to the next working day when needed. */
function monthlyTarget_(month, n, cfg) {
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  let key = month + '-' + String(Math.min(n, dim)).padStart(2, '0');
  for (let i = 0; i < 14 && dayInfo_(key, cfg).type !== 'work'; i++) key = addDays_(key, 1);
  return key;
}
/** True when the rule should create a task on this day (ignores Last Created). */
function recDueOn_(rule, key, cfg) {
  if (!rule.active || !REPEATS.includes(rule.repeat)) return false;
  if (rule.startsOn && key < rule.startsOn) return false;
  if (rule.endsOn && key > rule.endsOn) return false;
  const info = dayInfo_(key, cfg);
  if (rule.repeat === 'Daily') return info.type === 'work';
  if (rule.repeat === 'Weekly') return info.type === 'work' && weekdaysOf_(rule.days).includes(info.dow);
  const n = Number(rule.days);
  if (!(n >= 1 && n <= 31)) return false;
  const prev = addDays_(key.slice(0, 7) + '-01', -1).slice(0, 7);   // a target moved over the month end
  return monthlyTarget_(key.slice(0, 7), n, cfg) === key || monthlyTarget_(prev, n, cfg) === key;
}
/** The next day (from `fromKey`, inclusive) this rule creates a task, or '' within a year. */
function nextRun_(rule, fromKey, cfg) {
  let key = fromKey;
  for (let i = 0; i < 400; i++, key = addDays_(key, 1)) {
    if (rule.endsOn && key > rule.endsOn) return '';
    if (key !== rule.lastCreated && recDueOn_(rule, key, cfg)) return key;
  }
  return '';
}
function describeRule_(rule) {
  if (rule.repeat === 'Daily') return 'Every working day';
  if (rule.repeat === 'Weekly') return 'Every ' + weekdaysOf_(rule.days).map(i => WEEKDAYS[i]).join(', ');
  const n = Number(rule.days);
  const sfx = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return 'Monthly on the ' + n + sfx;
}

// ---------- Creating the day's tasks ----------
/**
 * Creates today's tasks for every due rule (or only `onlyId`). Returns the number created.
 * `notStartedOnly`: skip a rule whose start time today has already passed (used right after adding it).
 */
function runRecurring_(onlyId, notStartedOnly) {
  const cfg = attSettings_();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const nowMin = (function () { const p = Utilities.formatDate(new Date(), TZ, 'H:m').split(':'); return Number(p[0]) * 60 + Number(p[1]); })();
  const sh = recSheet_();
  const team = getTeamAll_();
  const sess = { role: 'admin', name: 'Admin' };
  let made = 0;
  readRecurring_().forEach(rule => {
    if (onlyId && rule.id !== onlyId) return;
    if (rule.lastCreated === today || !recDueOn_(rule, today, cfg)) return;
    if (!onlyId && rule.createdOn === today) return;   // added today: handled when it was saved, never back-filled
    if (notStartedOnly) { const p = parseStart_(rule.startTime); if (p && p.h * 60 + p.m <= nowMin) return; }
    let result;
    if (!team.some(m => m.name === rule.assignee && m.active && m.role === 'Employee')) {
      result = today + ': skipped, ' + rule.assignee + ' is not an active employee';
    } else {
      try {
        const r = insertTask_(sess, { task: rule.task, details: rule.details, assignee: rule.assignee, priority: rule.priority,
                                      due: today, startTime: rule.startTime, limit: rule.limit, approveNow: true });
        result = today + ': created ' + (r.id || 'task');
        made++;
      } catch (err) {
        result = today + ': failed, ' + ((err && err.message) || err);
      }
    }
    sh.getRange(rule.row, R.LAST, 1, 2).setNumberFormat('@').setValues([[today, result]]);
  });
  return made;
}

/** Time trigger (daily, 7 AM): adds today's repeating tasks. */
function createRecurringTasks() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try { runRecurring_('', false); } finally { lock.releaseLock(); }
}

/** Adds the daily trigger once (called from setup and when the first rule is added). */
function ensureRecurringTrigger_() {
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'createRecurringTasks')) return;
  ScriptApp.newTrigger('createRecurringTasks').timeBased().atHour(RECURRING_HOUR).everyDays(1).inTimezone(TZ).create();
}

// ---------- Dashboard API (admin only) ----------
function recurringForWeb_() {
  const cfg = attSettings_();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  // Once the morning run window (7-8 AM) has passed, today's copies are already made (or won't be).
  const hour = Number(Utilities.formatDate(new Date(), TZ, 'H:m').split(':')[0]);
  const from = hour < RECURRING_HOUR + 1 ? today : addDays_(today, 1);
  return readRecurring_().map(r => ({
    id: r.id, active: r.active, task: r.task, details: r.details, assignee: r.assignee, priority: r.priority,
    repeat: r.repeat, days: r.days, startTime: r.startTime, limit: r.limit, startsOn: r.startsOn, endsOn: r.endsOn,
    lastCreated: r.lastCreated, lastResult: r.lastResult, schedule: describeRule_(r),
    next: r.active ? nextRun_(r, from, cfg) : ''
  }));
}

function adminRecurring(token) {
  requireSession_(token, 'admin');
  return recurringForWeb_();
}

/** r: { task, details, assignee, priority, repeat, days, startTime, limit, startsOn, endsOn } */
function adminAddRecurring(token, r) {
  requireSession_(token, 'admin');
  r = r || {};
  const task = String(r.task || '').trim().slice(0, 200);
  if (!task) throw new Error('Task title is required.');
  const assignee = String(r.assignee || '');
  if (!getTeamAll_().some(m => m.name === assignee && m.active && m.role === 'Employee')) throw new Error('Pick an active employee.');
  const repeat = REPEATS.includes(r.repeat) ? r.repeat : '';
  if (!repeat) throw new Error('Choose daily, weekly or monthly.');
  const startTime = normStart_(r.startTime);
  if (!startTime) throw new Error('Pick a start time.');
  const startsOn = String(r.startsOn || '').trim();
  const sd = parseDay_(startsOn);
  if (!sd || Utilities.formatDate(sd, TZ, 'yyyy-MM-dd') !== startsOn) throw new Error('Pick a valid start date.');
  const endsOn = String(r.endsOn || '').trim();
  if (endsOn) {
    const ed = parseDay_(endsOn);
    if (!ed || Utilities.formatDate(ed, TZ, 'yyyy-MM-dd') !== endsOn) throw new Error('Pick a valid end date.');
    if (endsOn < startsOn) throw new Error('The end date is before the start date.');
  }
  let days = '';
  if (repeat === 'Weekly') {
    const w = weekdaysOf_(Array.isArray(r.days) ? r.days.join(',') : r.days);
    if (!w.length) throw new Error('Pick at least one weekday.');
    days = [...new Set(w)].sort().map(i => WEEKDAYS[i]).join(', ');
  } else if (repeat === 'Monthly') {
    const n = Number(r.days);
    if (!(n >= 1 && n <= 31 && Math.floor(n) === n)) throw new Error('Pick a day of the month (1 to 31).');
    days = String(n);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Busy, try again in a moment.');
  let id, made = 0;
  try {
    const sh = recSheet_();
    const ids = readRecurring_().map(x => Number(String(x.id).replace(/\D/g, '')) || 0);
    id = 'R-' + String((ids.length ? Math.max.apply(null, ids) : 0) + 1).padStart(3, '0');
    const row = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(row, 1, 1, REC_COLS).setNumberFormat('@').setValues([[
      id, 'Yes', task, String(r.details || '').trim().slice(0, 2000), assignee, PRIORITIES.includes(r.priority) ? r.priority : 'Medium',
      repeat, days, startTime, String(timeLimit_(r.limit)), startsOn, endsOn, '', '',
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')]]);
    made = runRecurring_(id, true);   // today's copy, if today is a repeat day and the start time is still ahead
  } finally { lock.releaseLock(); }
  try { ensureRecurringTrigger_(); } catch (e) { /* setup adds it too */ }
  return { id: id, createdToday: made, recurring: recurringForWeb_() };
}

/** Pause (active = false) or resume a rule. */
function adminSetRecurringActive(token, id, active) {
  requireSession_(token, 'admin');
  const rule = readRecurring_().find(x => x.id === String(id));
  if (!rule) throw new Error('Repeating task not found.');
  recSheet_().getRange(rule.row, R.ACTIVE).setValue(active ? 'Yes' : 'No');
  return recurringForWeb_();
}

/** Deletes a rule. Tasks it already created stay. */
function adminRemoveRecurring(token, id) {
  requireSession_(token, 'admin');
  const rule = readRecurring_().find(x => x.id === String(id));
  if (!rule) throw new Error('Repeating task not found.');
  recSheet_().deleteRow(rule.row);
  return recurringForWeb_();
}
