/* Repeating tasks (daily / weekly / monthly) against in-memory sheets, with a moving clock. */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../apps-script');
const IST = 330 * 60000, pad = n => String(n).padStart(2, '0');
const ist = s => new Date(Date.parse(s + ':00Z') - IST);
let NOW = ist('2026-11-05T09:00');                      // Thu 5 Nov 2026, 9 AM India time
class FakeDate extends Date { constructor(...a) { a.length ? super(...a) : super(NOW.getTime()); } static now() { return NOW.getTime(); } }

const Utilities = {
  parseDate(str) { const m = str.match(/^(\d+)-(\d+)-(\d+)(?: (\d+):(\d+))?$/); return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - IST); },
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    if (fmt === 'yyyy-MM-dd') return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
    if (fmt === 'H:m') return x.getUTCHours() + ':' + x.getUTCMinutes();
    return x.toISOString(); }
};
function makeSheet(rows, cols) {
  const data = rows; let maxCols = cols;
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1] === undefined ? '' : data[r - 1][c - 1]; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    getValue: () => cell(r, c),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cell(r + i, c + j); data[r + i - 1][c + j - 1] = x; })); return this; },
    setValue(x) { return this.setValues([[x]]); },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontColor() { return this; }, setBackground() { return this; }
  });
  return { data, getRange: range, getLastRow: () => data.length, getMaxRows: () => 1000, getMaxColumns: () => maxCols,
    appendRow(r) { data.push(r.slice()); }, deleteRow(r) { data.splice(r - 1, 1); }, setFrozenRows() {}, setColumnWidth() {} };
}
const sheets = {
  Settings: makeSheet([['Setting', 'Value'], ['Employee sheet ID', 'x'], ['Weekly off', 'Sunday'], ['Holidays', '2026-11-09: Diwali']], 2),
  Tasks: makeSheet([Array(26).fill('h')], 26)
};
const triggers = [];
const ctx = {
  Utilities, console, Math, Number, String, JSON, Date: FakeDate, Logger: { log() {} }, Object, Array, Set, Map, Error,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet([], 15)) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })),
    newTrigger: h => { const b = { timeBased: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, create: () => triggers.push(h) }; return b; } },
  sheets
};
vm.createContext(ctx);
vm.runInContext(['Code.gs', 'WebApp.gs', 'Attendance.gs', 'Recurring.gs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + `
  requireSession_ = t => { if (t === 'A') return { role: 'admin', name: 'Admin' }; throw new Error('Not allowed.'); };
  getTeamAll_ = () => [{ name: 'Aryan', role: 'Employee', active: true }, { name: 'Mansi', role: 'Employee', active: true },
                       { name: 'Neha', role: 'Employee', active: false }];
  getSettings_ = () => { const o = {}; sheets.Settings.data.slice(1).forEach(r => { if (r[0]) o[r[0]] = r[1]; }); return o; };
  syncNow = () => { sheets.Tasks.data.slice(1).forEach((r, i) => { if (r[C.TASK - 1] && !r[0]) r[0] = 'T-' + String(i + 1).padStart(4, '0'); }); };
  adminData = () => ({ ok: 1 });
  this.__x = { adminAddRecurring, adminRecurring, adminSetRecurringActive, adminRemoveRecurring, createRecurringTasks };`, ctx);
const x = ctx.__x;
const throwsMsg = fn => { try { fn(); return 'NO ERROR'; } catch (e) { return e.message; } };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const tasks = () => sheets.Tasks.data.slice(1).filter(r => r[2]).map(r => r[2] + '|' + r[4] + '|' + Utilities.formatDate(r[6], 'x', 'yyyy-MM-dd') + '|' + r[15] + '|' + r[7]);
const on = (dayTime, fn) => { NOW = ist(dayTime); fn && fn(); };
const day = d => { on(d + 'T07:00'); const before = tasks().length; x.createRecurringTasks(); return tasks().slice(before); };
const base = { details: '', priority: 'Medium', limit: 45 };

console.log('repeating tasks');
// ---- validation ----
ok(/Not allowed/.test(throwsMsg(() => x.adminAddRecurring('E', {}))), 'only the admin can add repeating tasks');
ok(/active employee/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Neha', repeat: 'Daily', startTime: '10:00', startsOn: '2026-11-05' })))), 'inactive employee refused');
ok(/weekday/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Aryan', repeat: 'Weekly', days: [], startTime: '10:00', startsOn: '2026-11-05' })))), 'weekly needs a weekday');
ok(/day of the month/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Aryan', repeat: 'Monthly', days: 0, startTime: '10:00', startsOn: '2026-11-05' })))), 'monthly needs day 1-31');
ok(/before the start/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Aryan', repeat: 'Daily', startTime: '10:00', startsOn: '2026-11-05', endsOn: '2026-11-01' })))), 'end before start refused');
ok(/valid start date/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Aryan', repeat: 'Daily', startTime: '10:00', startsOn: '2026-02-30' })))), 'impossible start date refused');
ok(/daily, weekly or monthly/.test(throwsMsg(() => x.adminAddRecurring('A', Object.assign({}, base, { task: 'X', assignee: 'Aryan', repeat: 'Yearly', startTime: '10:00', startsOn: '2026-11-05' })))), 'unknown repeat refused');
ok(!sheets.Recurring || sheets.Recurring.data.length <= 1, 'nothing saved for refused rules');

// ---- adding on Thu 5 Nov, 9 AM ----
let r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Daily SMS', assignee: 'Aryan', repeat: 'Daily', startTime: '10:00', startsOn: '2026-11-05' }));
ok(r.id === 'R-001' && r.createdToday === 1 && tasks()[0] === 'Daily SMS|Aryan|2026-11-05|10:00|Approved', "daily rule added before 10:00 creates today's task, approved");
ok(sheets.Recurring.data[0][0] === 'Rule ID' && sheets.Recurring.data[1][12] === '2026-11-05' && /created T-0001/.test(sheets.Recurring.data[1][13]), 'Recurring tab made with headers; Last Created and result written');
ok(triggers.filter(t => t === 'createRecurringTasks').length === 1, 'daily 7 AM trigger added');
r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Early check', assignee: 'Mansi', repeat: 'Daily', startTime: '08:30', startsOn: '2026-11-05' }));
ok(r.createdToday === 0 && r.recurring.find(z => z.id === 'R-002').next === '2026-11-06', 'start time already passed: no task today, next is Fri 6 Nov');
r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Weekly report', assignee: 'Aryan', repeat: 'Weekly', days: ['Mon', 'Thu'], startTime: '16:00', startsOn: '2026-11-05' }));
const wk = r.recurring.find(z => z.id === 'R-003');
ok(r.createdToday === 1 && wk.days === 'Mon, Thu' && wk.schedule === 'Every Mon, Thu', 'weekly Mon + Thu: today is Thursday, so created now');
ok(wk.next === '2026-11-12', 'next weekly copy skips Mon 9 Nov (Diwali) and lands on Thu 12 Nov');
r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Rent invoice', assignee: 'Mansi', repeat: 'Monthly', days: 8, startTime: '11:00', startsOn: '2026-11-05' }));
ok(r.recurring.find(z => z.id === 'R-004').next === '2026-11-10' && r.recurring.find(z => z.id === 'R-004').schedule === 'Monthly on the 8th',
   'monthly on the 8th: Sun 8 Nov and Mon 9 Nov (Diwali) are off, so Tue 10 Nov');
r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Month close', assignee: 'Aryan', repeat: 'Monthly', days: 31, startTime: '12:00', startsOn: '2026-11-05' }));
ok(r.recurring.find(z => z.id === 'R-005').next === '2026-11-30', 'monthly on the 31st: 30 Nov in November');
r = x.adminAddRecurring('A', Object.assign({}, base, { task: 'Short run', assignee: 'Mansi', repeat: 'Daily', startTime: '12:00', startsOn: '2026-11-06', endsOn: '2026-11-06' }));
ok(r.createdToday === 0, 'rule starting tomorrow makes nothing today');

// ---- same day again: no duplicates ----
ok(day('2026-11-05').length === 0, 'running again on 5 Nov creates no duplicates (Early check started 8:30 is not back-filled)');

// ---- following days ----
let made = day('2026-11-06');
ok(made.length === 3 && made.some(t => t.startsWith('Daily SMS|Aryan|2026-11-06')) && made.some(t => t.startsWith('Early check|Mansi|2026-11-06')) && made.some(t => t.startsWith('Short run|Mansi|2026-11-06')),
   'Fri 6 Nov: both daily rules and the one-day rule');
ok(day('2026-11-07').length === 2, 'Sat 7 Nov: daily rules only (Short run ended)');
ok(day('2026-11-08').length === 0, 'Sun 8 Nov: weekly off, nothing');
ok(day('2026-11-09').length === 0, 'Mon 9 Nov: Diwali holiday, nothing (weekly Monday skipped)');
made = day('2026-11-10');
ok(made.length === 3 && made.some(t => t.startsWith('Rent invoice|Mansi|2026-11-10|11:00')), 'Tue 10 Nov: daily rules + the moved monthly invoice');
ok(day('2026-11-11').length === 2, 'Wed 11 Nov: daily rules');
made = day('2026-11-12');
ok(made.length === 3 && made.some(t => t.startsWith('Weekly report|Aryan|2026-11-12|16:00')), 'Thu 12 Nov: weekly report');

// ---- pause / resume / delete ----
x.adminSetRecurringActive('A', 'R-001', false);
made = day('2026-11-13');
ok(made.length === 1 && made[0].startsWith('Early check'), 'paused rule makes nothing');
ok(x.adminRecurring('A').find(z => z.id === 'R-001').next === '', 'a paused rule shows no next date');
x.adminSetRecurringActive('A', 'R-001', true);
const before = tasks().length;
x.adminRemoveRecurring('A', 'R-002');
ok(!x.adminRecurring('A').some(z => z.id === 'R-002') && tasks().length === before, 'deleting a rule keeps the tasks it made');
ok(/not found/.test(throwsMsg(() => x.adminRemoveRecurring('A', 'R-002'))), 'deleting twice says not found');
ok(day('2026-11-14').length === 1, 'Sat 14 Nov: resumed daily rule only');

// ---- inactive employee at run time ----
vm.runInContext("getTeamAll_ = () => [{ name: 'Aryan', role: 'Employee', active: false }, { name: 'Mansi', role: 'Employee', active: true }];", ctx);
ok(day('2026-11-16').length === 0 && /not an active employee/.test(sheets.Recurring.data.find(z => z[0] === 'R-001')[13]), 'employee deactivated later: skipped, reason written');
on('2026-11-30T07:00'); vm.runInContext("getTeamAll_ = () => [{ name: 'Aryan', role: 'Employee', active: true }];", ctx);
const b2 = tasks().length; x.createRecurringTasks();
ok(tasks().slice(b2).some(t => t.startsWith('Month close|Aryan|2026-11-30')), 'Mon 30 Nov: month close created');
console.log(pass + ' repeating task checks passed');
