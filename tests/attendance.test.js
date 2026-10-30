/* Attendance rules against an in-memory sheet and Drive (no Google services). */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../apps-script');
const IST = 330 * 60000, pad = n => String(n).padStart(2, '0');
const ist = s => new Date(Date.parse(s + ':00Z') - IST);            // '2026-10-30T09:50' IST -> Date

let NOW = ist('2026-10-30T09:50');
class FakeDate extends Date {
  constructor(...a) { a.length ? super(...a) : super(NOW.getTime()); }
  static now() { return NOW.getTime(); }
}

const Utilities = {
  parseDate(str) { const m = str.match(/^(\d+)-(\d+)-(\d+)(?: (\d+):(\d+))?$/); return new Date(Date.UTC(+m[1], m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)) - IST); },
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    const Y = x.getUTCFullYear(), M = pad(x.getUTCMonth()+1), D = pad(x.getUTCDate()), h = x.getUTCHours(), mi = x.getUTCMinutes();
    if (fmt === 'yyyy-MM-dd') return Y + '-' + M + '-' + D;
    if (fmt === 'yyyy-MM') return Y + '-' + M;
    if (fmt === 'H:m') return h + ':' + mi;
    if (fmt === 'HH-mm') return pad(h) + '-' + pad(mi);
    if (fmt === 'h:mm a') return (h % 12 || 12) + ':' + pad(mi) + ' ' + (h < 12 ? 'AM' : 'PM');
    return Y + '-' + M + '-' + D + ' ' + h + ':' + pad(mi); },
  base64Decode: s => [...Buffer.from(s, 'base64')], base64Encode: b => Buffer.from(b).toString('base64'),
  newBlob: (bytes, type, name) => ({ bytes, type, name })
};

// ---- in-memory sheet ----
function makeSheet(name, rows) {
  const data = rows || [];
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1] === undefined ? '' : data[r - 1][c - 1]; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cell(r + i, c + j); data[r + i - 1][c + j - 1] = x; })); return this; },
    setValue(x) { return this.setValues([[x]]); },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontColor() { return this; },
    setBackground() { return this; }, setWrap() { return this; }
  });
  return { name, data, getRange: range, getLastRow: () => data.length, getMaxRows: () => 1000,
    appendRow(r) { data.push(r.slice()); }, setFrozenRows() {}, setColumnWidth() {} };
}
const sheets = {
  Settings: makeSheet('Settings', [['Setting', 'Value'], ['Employee sheet ID', 'x'],
    ['Office latitude', 30.7046], ['Office longitude', 76.7179], ['Office radius (m)', 150], ['Location check', 'Block'],
    ['Office start', '10:00'], ['Office end', '18:00'], ['Buffer (min)', 20]]),
  Team: makeSheet('Team', [['Name', 'Email', 'Role', 'Active'], ['Aryan', 'a@x.com', 'Employee', 'Yes'], ['Neha', 'n@x.com', 'Employee', 'Yes']])
};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) };

// ---- in-memory Drive ----
let fid = 0; const files = {};
function folder(name) {
  const kids = [];
  const f = { id: 'fold' + (++fid), name, trashed: false, kids,
    getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, setTrashed(v) { f.trashed = v; },
    getFoldersByName(n) { const m = kids.filter(k => k.name === n && !k.trashed); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    getFolders() { const m = kids.filter(k => !k.trashed); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFolder(n) { const k = folder(n); k.parent = f; kids.push(k); return k; },
    createFile(blob) { const id = 'FILE' + String(++fid).padStart(8, '0'); files[id] = { blob, folder: f };
      return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view' }; }
  };
  return f;
}
const rootFolder = folder('Task Tracker Attendance');
const props = {};
const ctx = {
  Utilities, console, Math, Number, String, JSON, Date: FakeDate, Logger: { log() {} },
  SpreadsheetApp: { getActive: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  DriveApp: { createFolder: () => rootFolder, getFolderById: () => rootFolder,
    getFileById: id => ({ isTrashed: () => false, getBlob: () => ({ getBytes: () => files[id].blob.bytes }), getName: () => files[id].blob.name }) }
};
vm.createContext(ctx);
vm.runInContext(['Code.gs', 'WebApp.gs', 'Attendance.gs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') +
  `\nrequireSession_ = (t, role) => { if (t === 'admin') return { role: 'admin' }; if (role === 'admin') throw new Error('Not allowed.'); return { role: 'employee', name: t }; };
   empData = t => ({ attendance: attendanceToday_(t) });
   ensureAttendanceSettings_(); this.__x = { empCheck, adminAttendance, adminAttPhoto, adminSetOffice, autoCheckout, cleanupAttendancePhotos, attendanceSummaryHtml_, distanceM_ };`, ctx);
const x = ctx.__x;
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
const OFFICE = [30.7046, 76.7179];
const near = [30.7050, 76.7182];          // ~50 m away
const far = [30.7200, 76.7400];           // ~2.7 km away
const throwsMsg = fn => { try { fn(); return 'NO ERROR'; } catch (e) { return e.message; } };
const att = () => sheets.Attendance.data.slice(1);
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };

console.log('attendance');
ok(Math.abs(x.distanceM_(...OFFICE, ...near) - 50) < 15, 'distance helper ~50 m');

// Far from office: blocked
ok(/2\d{3} m from the office/.test(throwsMsg(() => x.empCheck('Aryan', 'in', PHOTO, ...far, 10))), 'check-in 2.7 km away is blocked');
ok(/Location is needed/.test(throwsMsg(() => x.empCheck('Aryan', 'in', PHOTO, undefined, undefined, 0))), 'check-in without location is blocked');
ok(/photo/.test(throwsMsg(() => x.empCheck('Aryan', 'in', 'data:text/html;base64,AAAA', ...near, 10))), 'non-JPEG photo is rejected');

// 9:50 check-in: on time
let r = x.empCheck('Aryan', 'in', PHOTO, ...near, 10).attendance;
ok(r.state === 'in' && r.inLabel === '9:50 AM' && !r.late, 'Aryan checks in 9:50 AM, not late');
ok(/already checked in/.test(throwsMsg(() => x.empCheck('Aryan', 'in', PHOTO, ...near, 10))), 'second check-in is refused');
ok(Object.keys(files).length === 1 && files[Object.keys(files)[0]].folder.name === '2026-10' &&
   files[Object.keys(files)[0]].folder.parent.name === 'Aryan', 'photo saved in Attendance/Aryan/2026-10');

// 10:35 check-in: late (after 10:20)
NOW = ist('2026-10-30T10:35');
r = x.empCheck('Neha', 'in', PHOTO, ...near, 10).attendance;
ok(r.late, 'Neha checks in 10:35 AM and is marked Late');
ok(/not checked in/.test(throwsMsg(() => x.empCheck('Ravi', 'out', PHOTO, ...near, 10))), 'check-out without check-in is refused');

// 5:30 PM Aryan checks out: left early (before 5:40), worked 7 h 40 min
NOW = ist('2026-10-30T17:30');
r = x.empCheck('Aryan', 'out', PHOTO, ...near, 10).attendance;
ok(r.state === 'out' && r.workedMin === 460 && /Left early/.test(r.flags), 'Aryan out 5:30 PM: 460 min, flagged Left early');
ok(/already checked out/.test(throwsMsg(() => x.empCheck('Aryan', 'out', PHOTO, ...near, 10))), 'second check-out is refused');

// Neha forgets; at 6:10 PM still open, at 6:45 PM auto check-out records 6:20 PM
NOW = ist('2026-10-30T18:10');
x.autoCheckout();
ok(!(att()[1][3] instanceof Date), 'auto check-out does nothing before 6:20 PM');
NOW = ist('2026-10-30T18:45');
x.autoCheckout();
const neha = att()[1];
ok(neha[3].getTime() === ist('2026-10-30T18:20').getTime() && neha[4] === 465 && /Auto check-out/.test(neha[7]),
   'auto check-out at 6:20 PM: 7 h 45 min, flagged');
ok(/over for today/.test(throwsMsg(() => x.empCheck('Ravi', 'in', PHOTO, ...near, 10))), 'check-in after 6:20 PM is refused');

// Admin views
const a = x.adminAttendance('admin');
ok(a.todayRows.length === 2 && a.summary.find(s => s.name === 'Neha').late === 1 && a.summary.find(s => s.name === 'Aryan').totalMin === 460,
   'admin report: today rows + monthly totals');
ok(/Not allowed/.test(throwsMsg(() => x.adminAttendance('Aryan'))), 'employees cannot open the admin report');
const pid = a.todayRows[0].inPhoto;
ok(x.adminAttPhoto('admin', pid).dataUrl === PHOTO, 'admin can load a recorded photo');
ok(/Unknown photo/.test(throwsMsg(() => x.adminAttPhoto('admin', 'SomeOtherDriveFile123'))), 'admin cannot load other Drive files');
const html = x.attendanceSummaryHtml_();
ok(/2<\/b> of 2 present/.test(html) && /1<\/b> late/.test(html), 'evening email attendance block');

// Location as "Flag only" lets a far check-in through but flags it
sheets.Settings.data.find(r => r[0] === 'Location check')[1] = 'Flag only';
NOW = ist('2026-10-31T09:55');
r = x.empCheck('Aryan', 'in', PHOTO, ...far, 10).attendance;
ok(r.state === 'in' && /Outside office/.test(r.flags), '"Flag only" mode records a far check-in with a flag');

// Photo cleanup: October folders stay on 14 Nov, go on 15 Nov
NOW = ist('2026-11-14T02:00');
x.cleanupAttendancePhotos();
ok(!rootFolder.kids[0].kids[0].trashed, 'October photos kept on 14 November');
NOW = ist('2026-11-15T02:00');
x.cleanupAttendancePhotos();
ok(rootFolder.kids.every(p => p.kids.filter(m => m.name === '2026-10').every(m => m.trashed)), 'October photos trashed on 15 November');
ok(att().every(r => r[8] === 'Deleted'), 'sheet photo links marked Deleted');
// Auto check-out also closed the 31 Oct open day during the overnight run
ok(att()[2][3] instanceof Date && /Auto check-out/.test(att()[2][7]), 'overnight run closes a missed day');

// Admin sets office location
x.adminSetOffice('admin', 30.70123, 76.71987, 12);
ok(sheets.Settings.data.find(r => r[0] === 'Office latitude')[1] === 30.70123 &&
   sheets.Settings.data.find(r => r[0] === 'Office location confirmed')[1] === 'Yes', 'admin saves office location');

console.log(pass + ' attendance checks passed');

// ---- Monthly report: working days, leaves, holidays ----
(() => {
  const set = (k, v) => { const r = sheets.Settings.data.find(x => x[0] === k); if (r) r[1] = v; else sheets.Settings.data.push([k, v]); };
  set('Weekly off', 'Sunday'); set('Holidays', '2026-11-04: Diwali, 2026-11-05');
  sheets.Attendance.data.length = 1;   // fresh month
  sheets.Settings.data.find(r => r[0] === 'Location check')[1] = 'Block';
  set('Office latitude', OFFICE[0]); set('Office longitude', OFFICE[1]);
  const day = (d, inT, outT) => { NOW = ist(d + 'T' + inT); x.empCheck('Aryan', 'in', PHOTO, ...near, 10); if (outT) { NOW = ist(d + 'T' + outT); x.empCheck('Aryan', 'out', PHOTO, ...near, 10); } };
  day('2026-11-02', '09:55', '18:05');                 // Mon present
  day('2026-11-03', '10:40', '18:00');                 // Tue late
  // Wed 4, Thu 5 holidays; Fri 6 leave
  day('2026-11-07', '09:58', '18:10');                 // Sat present
  day('2026-11-08', '11:00', '15:00');                 // Sun (weekly off) came anyway
  NOW = ist('2026-11-09T19:00');                        // Mon 9 Nov, after hours, no check-in -> leave
  const r = x.adminAttendance('admin', '2026-11');
  const a = r.summary.find(s => s.name === 'Aryan');
  ok(r.calendar.length === 30 && r.calendar.filter(d => d.type === 'holiday').length === 2 && r.calendar.find(d => d.date === '2026-11-04').label === 'Diwali',
     'November calendar: 30 days, 2 holidays (Diwali label)');
  ok(a.workingDays === 5 && a.present === 3 && a.leaves === 2 && a.leaveDates.join() === '2026-11-06,2026-11-09',
     'Aryan: 5 working days so far, 3 present, leaves on 6 and 9 Nov (holidays and Sundays not counted)');
  ok(a.extraDays === 1 && a.late === 1 && a.pct === 60, 'Sunday visit counted as extra day, not late; 1 late, 60% attendance');
  ok(a.monthWorkingDays === 23, 'November has 23 working days (30 - 5 Sundays - 2 holidays)');
  const n = r.summary.find(s => s.name === 'Neha');
  ok(n.workingDays === 0 && n.leaves === 0, 'no leaves counted before an employee first checks in');
  console.log(pass + ' attendance checks passed (with monthly report)');
})();
