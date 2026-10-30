/* Manager review of Done tickets, against an in-memory Tasks sheet (no Google services). */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../apps-script');
const IST = 330 * 60000, pad = n => String(n).padStart(2, '0');
const Utilities = {
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    if (fmt === 'yyyy-MM-dd') return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
    return pad(x.getUTCDate()) + ' Oct, ' + (x.getUTCHours() % 12 || 12) + ':' + pad(x.getUTCMinutes()); }
};
function makeSheet(rows, cols) {
  const data = rows; let maxCols = cols;
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1] === undefined ? '' : data[r - 1][c - 1]; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    getValue: () => cell(r, c),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cell(r + i, c + j); data[r + i - 1][c + j - 1] = x; })); return this; },
    setValue(x) { return this.setValues([[x]]); }, setNumberFormat() { return this; }
  });
  return { data, getRange: range, getLastRow: () => data.length, getMaxRows: () => 100, getMaxColumns: () => maxCols,
    insertColumnsAfter(a, n) { maxCols += n; } };
}
// Tasks: A ID, J Status, E Assignee, N Completed, H Approval, C Task
const row = (id, status) => { const r = Array(23).fill(''); r[0] = id; r[2] = 'Canva posts ' + id; r[4] = 'Aryan'; r[7] = 'Approved'; r[9] = status;
  if (status === 'Done') { r[13] = new Date(Date.now() - 3600e3); r[18] = new Date(Date.now() - 7200e3); r[19] = 60; } return r; };
const tasks = makeSheet([Array(23).fill('h'), row('T-0001', 'Done'), row('T-0002', 'Done'), row('T-0003', 'In Progress')], 23);
const props = {}, mails = [];
const ctx = {
  Utilities, console, Math, Number, String, JSON, Date, Logger: { log() {} },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => n === 'Tasks' ? tasks : null }), openById: () => ({ getSheetByName: () => null }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
};
vm.createContext(ctx);
vm.runInContext(['Code.gs', 'WebApp.gs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + `
  requireSession_ = (t) => t === 'A' ? { role: 'admin', name: 'Admin' } : t === 'M' ? { role: 'manager', name: 'Rahul' } : (() => { throw new Error('Not allowed.'); })();
  adminData = () => ({ ok: 1 }); syncNow = () => {};
  getSettings_ = () => ({ 'Employee sheet ID': 'x', 'Company name': '' });
  getTeam_ = () => [{ name: 'Aryan', email: 'a@x.com', role: 'Employee' }];
  sendMail_ = o => { __mails.push(o); };
  this.__x = { reviewTask, readTasksForWeb_ };`, Object.assign(ctx, { __mails: mails }));
const x = ctx.__x;
const throwsMsg = fn => { try { fn(); return 'NO ERROR'; } catch (e) { return e.message; } };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const t = id => x.readTasksForWeb_().find(r => r.id === id);

console.log('review');
ok(t('T-0001').review === 'awaiting' && t('T-0003').review === '', 'Done tickets start as Awaiting review; open ones have no review');

x.reviewTask('M', 'T-0001', 'approve', '');
ok(tasks.getMaxColumns() >= 26 && tasks.data[0][23] === 'Reviewed By', 'review columns X:Z added with headers');
ok(t('T-0001').review === 'reviewed' && t('T-0001').reviewedBy === 'Rahul' && t('T-0001').reviewedOn, 'task manager marks T-0001 Reviewed ✓ (name + time saved)');
ok(/already reviewed by Rahul/.test(throwsMsg(() => x.reviewTask('A', 'T-0001', 'approve', ''))), 'reviewing twice is refused');
ok(/Write what needs to change/.test(throwsMsg(() => x.reviewTask('A', 'T-0002', 'sendback', '  '))), 'send back needs a note');
ok(/not Done/.test(throwsMsg(() => x.reviewTask('A', 'T-0003', 'approve', ''))), 'only Done tickets can be reviewed');

const d = x.reviewTask('A', 'T-0002', 'sendback', 'Logo too small on post 2');
const r2 = t('T-0002');
ok(r2.status === 'In Progress' && r2.review === '' && /Admin: sent back: Logo too small/.test(r2.reviewNotes), 'admin sends T-0002 back: In Progress, note logged');
ok(/Sent back by Admin/.test(r2.reopened) && JSON.parse(props['REOPEN_T-0002']).min === 60, 'reopen log written and 60 min already worked is kept');
ok(d.emailed && mails.length === 1 && mails[0].to === 'a@x.com' && /sent back for changes/.test(mails[0].subject) && /Logo too small/.test(mails[0].htmlBody),
   'employee emailed with the note');
ok(/Not allowed/.test(throwsMsg(() => x.reviewTask('E', 'T-0001', 'approve', ''))), 'employees cannot review');

// Employee fixes it and marks Done again: needs a fresh review
tasks.data[2][9] = 'Done'; tasks.data[2][13] = new Date();
ok(t('T-0002').review === 'awaiting' && /sent back/.test(t('T-0002').reviewNotes), 'after re-Done it waits for review again, history kept');
x.reviewTask('M', 'T-0002', 'approve', 'Looks good now');
ok(t('T-0002').review === 'reviewed' && /reviewed ✓ Looks good now/.test(t('T-0002').reviewNotes), 'accepted with an optional note');
console.log(pass + ' review checks passed');
