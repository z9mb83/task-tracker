const fs = require('fs'), vm = require('vm');
const IST = 330 * 60000;
const pad = n => String(n).padStart(2, '0');
const Utilities = {
  parseDate(str, tz, fmt) { const m = str.match(/^(\d+)-(\d+)-(\d+) (\d+):(\d+)$/); return new Date(Date.UTC(+m[1], m[2]-1, +m[3], +m[4], +m[5]) - IST); },
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    if (fmt === 'yyyy-MM-dd') return x.getUTCFullYear() + '-' + pad(x.getUTCMonth()+1) + '-' + pad(x.getUTCDate());
    let h = x.getUTCHours(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
    return pad(x.getUTCDate()) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getUTCMonth()] + (fmt.includes('h:mm a') ? ', ' + h + ':' + pad(x.getUTCMinutes()) + ' ' + ap : ' ' + x.getUTCFullYear()); }
};
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) };
const ctx = { Utilities, PropertiesService, JSON, console, Date, Math, Number, String, Logger: { log(){} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '../apps-script/Code.gs'), 'utf8') + '\nthis.__x = { computeDueAt_, minutesTaken_, normStart_, fmtDue_, C, T };', ctx);
const { computeDueAt_, minutesTaken_, normStart_, fmtDue_, C, T } = ctx.__x;
const day = new Date(Date.UTC(2026, 9, 31) - IST);   // 31 Oct 2026 00:00 IST
const out = [];
out.push('normStart: ' + ['11:00','9:30','2:15 pm','12:05 am','25:00','abc'].map(normStart_).join(' | '));
const due = computeDueAt_(day, '11:00', 45);
out.push('due 31 Oct 11:00 + 45: ' + fmtDue_(due, day));
out.push('due with 60 + 2:30 pm: ' + fmtDue_(computeDueAt_(day, '2:30 pm', 60), day));
out.push('no start time -> date only: ' + fmtDue_(computeDueAt_(day, '', 45), day));
const row = new Array(20).fill('');
row[C.COMPLETED-1] = new Date(due.getTime() - 5*60000); row[T.DUE_AT-1] = due; row[T.LIMIT-1] = 45;
row[T.STARTED_AT-1] = new Date(due.getTime() - 40*60000);
out.push('started 11:05, done 11:40 -> taken: ' + minutesTaken_(row));
row[T.STARTED_AT-1] = '';
out.push('never pressed In Progress, done 11:40 -> taken from scheduled start: ' + minutesTaken_(row));
row[C.COMPLETED-1] = new Date(due.getTime() + 20*60000);
out.push('done 12:05 (over) -> taken: ' + minutesTaken_(row));
// Reopen: worked 6 min first time, reopened 2:37 PM, done again 3:06 PM -> 6 + 29 = 35 (idle time not counted)
const at = (h, m) => new Date(Date.UTC(2026, 9, 30, h, m) - IST);
const r2 = new Array(23).fill(''); r2[C.ID-1] = 'T-0002'; r2[T.LIMIT-1] = 45;
r2[T.DUE_AT-1] = at(14, 0); r2[T.STARTED_AT-1] = at(14, 31); r2[C.COMPLETED-1] = at(14, 37);
out.push('first finish (started 2:31, done 2:37): ' + minutesTaken_(r2));
props['REOPEN_T-0002'] = JSON.stringify({ min: 6, at: at(14, 37).getTime() });
r2[T.STARTED_AT-1] = at(14, 37); r2[C.COMPLETED-1] = at(15, 6);
out.push('after reopen, done 3:06: ' + minutesTaken_(r2) + ' (expected 35)');
r2[T.STARTED_AT-1] = '';   // employee set Not Started after the reopen, then Done
out.push('reopen, no start pressed, done 3:06: ' + minutesTaken_(r2) + ' (expected 35)');
console.log(out.join('\n'));
