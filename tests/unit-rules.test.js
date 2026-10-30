const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const ROOT = path.resolve(__dirname, '../apps-script');
const IST = 330 * 60000, pad = n => String(n).padStart(2, '0');
const Utilities = {
  parseDate(str) { const m = str.match(/^(\d+)-(\d+)-(\d+)(?: (\d+):(\d+))?$/); return new Date(Date.UTC(+m[1], m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)) - IST); },
  formatDate(d, tz, fmt) { const x = new Date(d.getTime() + IST);
    if (fmt === 'yyyy-MM-dd') return x.getUTCFullYear() + '-' + pad(x.getUTCMonth()+1) + '-' + pad(x.getUTCDate());
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getUTCMonth()];
    let h = x.getUTCHours(); const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 || 12;
    if (fmt === 'h:mm a') return h12 + ':' + pad(x.getUTCMinutes()) + ' ' + ap;
    if (fmt === 'dd MMM yyyy') return pad(x.getUTCDate()) + ' ' + mon + ' ' + x.getUTCFullYear();
    return pad(x.getUTCDate()) + ' ' + mon + ', ' + h12 + ':' + pad(x.getUTCMinutes()) + ' ' + ap; },
  computeHmacSha256Signature(t, k) { return [...crypto.createHmac('sha256', k).update(t).digest()]; },
  base64EncodeWebSafe(b) { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); }
};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => k === 'API_SECRET' ? 'sekret' : null }) };
const ctx = { Utilities, PropertiesService, console, Date, Math, Number, String, JSON, Logger: { log(){} } };
vm.createContext(ctx);
vm.runInContext(['Code.gs', 'WebApp.gs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') +
  '\nthis.__x = { taskState_, diffFields_, changeLines_, makeDecisionToken_, readDecisionToken_, readChangeReq_ };', ctx);
const x = ctx.__x, out = [];
out.push('states: ' + [['Pending',''],['On Hold',''],['Approved','In Progress'],['Approved','Done'],['Rejected',''],['Cancelled','']].map(a => a.join('/') + '=' + x.taskState_(...a)).join(', '));
const cur = { task: 'Chrome Extension', details: 'x', assignee: 'Aryan', priority: 'Medium', due: '2026-10-30', startTime: '13:15', limit: 45 };
const d = x.diffFields_(cur, { task: 'Chrome Extension ', details: 'x', assignee: 'Aryan', priority: 'Medium', due: '2026-10-30', startTime: '14:15', limit: 60 });
out.push('diff (only changed fields): ' + JSON.stringify(d));
out.push('lines: ' + JSON.stringify(x.changeLines_({ changes: Object.assign(d, { due: ['2026-10-30', '2026-10-31'] }) })));
out.push('cancel lines: ' + JSON.stringify(x.changeLines_({ cancel: true, changes: {} })));
const tk = x.makeDecisionToken_('T-0002', 'c1730275200000');
out.push('change token reads as: ' + JSON.stringify(x.readDecisionToken_(tk)));
out.push('task token reads as: ' + JSON.stringify(x.readDecisionToken_(x.makeDecisionToken_('T-0003'))));
const old = 'T-0004.' + (Date.now() + 1e6); const oldTok = old + '.' + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(old, 'sekret')).replace(/=+$/, '');
out.push('old-format link still works: ' + JSON.stringify(x.readDecisionToken_(oldTok)));
try { x.readDecisionToken_(tk.replace('c1730', 'c9999')); out.push('tampered: ACCEPTED (bad)'); } catch (e) { out.push('tampered: ' + e.message); }
out.push('bad JSON change req: ' + x.readChangeReq_('{oops'));
console.log(out.join('\n'));
