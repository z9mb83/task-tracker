/* Office holidays (admin) and the ChatGPT task endpoints, against in-memory sheets (no Google services). */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../apps-script');
const IST = 330 * 60000, pad = n => String(n).padStart(2, '0');

const Utilities = {
  parseDate(str) { const m = str.match(/^(\d+)-(\d+)-(\d+)(?: (\d+):(\d+))?$/); return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - IST); },
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    if (fmt === 'yyyy-MM-dd') return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
    return x.toISOString(); },
  getUuid: () => 'uuid' + Math.random().toString(16).slice(2)
};

// Generic in-memory sheet: enough of the Sheets API for these functions.
function makeSheet(rows, cols) {
  const data = rows; let maxCols = cols;
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1] === undefined ? '' : data[r - 1][c - 1]; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    getValue: () => cell(r, c),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cell(r + i, c + j); data[r + i - 1][c + j - 1] = x; })); return this; },
    setValue(x) { return this.setValues([[x]]); },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontColor() { return this; },
    setBackground() { return this; }, setWrap() { return this; }
  });
  return { data, getRange: range, getLastRow: () => data.length, getMaxRows: () => 1000, getMaxColumns: () => maxCols,
    appendRow(r) { data.push(r.slice()); }, insertColumnsAfter(a, n) { maxCols += n; },
    setFrozenRows() {}, setColumnWidth() {} };
}

const settings = makeSheet([['Setting', 'Value'], ['Employee sheet ID', 'x'], ['Office radius (m)', 150],
  ['Office start', '10:00'], ['Office end', '18:00'], ['Buffer (min)', 20], ['Weekly off', 'Sunday']], 2);
const tasks = makeSheet([Array(26).fill('h')], 26);
const props = {};
const ctx = {
  Utilities, console, Math, Number, String, JSON, Date, Logger: { log() {} }, Object, Array, Set, Map, Error,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => n === 'Settings' ? settings : tasks, getUrl: () => '' }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
};
ctx.settings = settings; ctx.tasks = tasks;
vm.createContext(ctx);
vm.runInContext(['Code.gs', 'WebApp.gs', 'Attendance.gs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + `
  requireSession_ = t => { if (t === 'A') return { role: 'admin', name: 'Admin' }; throw new Error('Not allowed.'); };
  getTeamAll_ = () => [{ name: 'Aryan', email: 'a@x.com', role: 'Employee', active: true },
                       { name: 'Neha', email: 'n@x.com', role: 'Employee', active: false }];
  // Stand-in for the sheet formula that numbers tickets: give each new task row an ID.
  syncNow = () => { let n = 0; tasksRows().forEach(r => { if (!r[0]) r[0] = 'T-' + String(++n).padStart(4, '0'); }); };
  function tasksRows() { return tasks.data.slice(1).filter(r => r[C.TASK - 1]); }
  adminData = () => ({ ok: 1 });
  getSettings_ = () => { const o = {}; settings.data.slice(1).forEach(r => { if (r[0]) o[String(r[0]).trim()] = r[1]; }); return o; };
  this.__x = { adminHolidays, adminSetHoliday, adminRemoveHoliday, gptContext, gptAddTasks, adminAddTask, ensureAttendanceSettings_ };`, ctx);
const x = ctx.__x;
x.ensureAttendanceSettings_();
const throwsMsg = fn => { try { fn(); return 'NO ERROR'; } catch (e) { return e.message; } };
const holidaysCell = () => settings.data.find(r => String(r[0]).trim() === 'Holidays')[1];
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };

console.log('holidays (admin)');
ok(settings.data.some(r => r[0] === 'Holidays'), 'Settings has a Holidays row');
ok(JSON.stringify(x.adminHolidays('A')) === '[]', 'no holidays to start with');
let list = x.adminSetHoliday('A', '2026-12-25', 'Christmas');
ok(list.length === 1 && list[0].date === '2026-12-25' && list[0].label === 'Christmas', 'adds Christmas');
list = x.adminSetHoliday('A', '2026-11-08', 'Diwali, festival!: day one');
ok(list.map(h => h.date).join() === '2026-11-08,2026-12-25', 'list is sorted by date');
ok(list[0].label === 'Diwali festival! day one', 'commas, colons stripped from the name so the Settings row stays readable');
ok(holidaysCell() === '2026-11-08: Diwali festival! day one, 2026-12-25: Christmas', 'Settings Holidays cell holds the exact text the attendance rules read');
list = x.adminSetHoliday('A', '2026-11-08', 'Diwali');
ok(list.length === 2 && list[0].label === 'Diwali', 'adding an existing date renames it');
ok(/Pick a valid date/.test(throwsMsg(() => x.adminSetHoliday('A', '08-11-2026', 'Diwali'))), 'wrong date format is refused');
ok(/Pick a valid date/.test(throwsMsg(() => x.adminSetHoliday('A', '2026-02-30', 'Nope'))), 'impossible date is refused');
ok(/Enter the holiday/.test(throwsMsg(() => x.adminSetHoliday('A', '2026-11-14', '   '))), 'a name is required');
ok(/Not allowed/.test(throwsMsg(() => x.adminSetHoliday('Aryan', '2026-11-14', 'Test'))), 'employees cannot add holidays');
ok(/Not allowed/.test(throwsMsg(() => x.adminRemoveHoliday('Aryan', '2026-12-25'))), 'employees cannot remove holidays');
list = x.adminRemoveHoliday('A', '2026-12-25');
ok(list.length === 1 && list[0].date === '2026-11-08' && holidaysCell() === '2026-11-08: Diwali', 'removes Christmas; Settings updated');
x.adminRemoveHoliday('A', '2026-11-08');
ok(holidaysCell() === '', 'removing the last holiday leaves the cell empty');

console.log('ChatGPT tasks');
const ctxInfo = x.gptContext();
ok(ctxInfo.employees.join() === 'Aryan' && ctxInfo.priorities.join() === 'High,Medium,Low' && ctxInfo.timeLimits.join() === '30,45,60',
   'context lists active employees only, plus priorities and time limits');
let res = x.gptAddTasks([{ task: 'Send Mohali visit report', assignee: 'Aryan', due: '2026-11-05', startTime: '15:00', limit: 45, priority: 'High' }]);
ok(res.length === 1 && res[0].ok === true && res[0].id === 'T-0001' && res[0].employee === 'Aryan', 'one task added with its ticket ID');
const row = tasks.data[1];
ok(row.includes('Send Mohali visit report') && row.includes('Aryan') && row.includes('Approved') && row.includes('High'),
   'row written as an approved High task for Aryan');
res = x.gptAddTasks([{ task: 'Call the vendor', assignee: 'Neha', due: '2026-11-05', startTime: '11:00' }, { task: 'Stock check', assignee: 'Aryan', due: '2026-11-06', startTime: '11:00' }]);
ok(res[0].ok === false && /active employee/.test(res[0].error) && res[1].ok === true, 'inactive employee fails for that task only; the rest are added');
ok(/at least one|No tasks/.test(throwsMsg(() => x.gptAddTasks([]))), 'an empty list is refused');
ok(/at most 20/.test(throwsMsg(() => x.gptAddTasks(Array.from({ length: 21 }, (_, i) => ({ task: 'T' + i, assignee: 'Aryan', due: '2026-11-05', startTime: '10:00' }))))),
   'more than 20 tasks in one call is refused');
ok(tasks.data.length === 3, 'refused calls wrote no rows (header + 2 added)');
const sent = x.gptAddTasks([{ task: 'Urgent visit', assignee: 'Aryan', due: '2026-11-05', startTime: '09:30', sendNow: true, approveNow: false }]);
ok(sent[0].ok && tasks.data[3].includes('Approved'), 'approved even when the request says approveNow false (ChatGPT tasks are always approved)');
console.log(pass + ' holiday and ChatGPT checks passed');
