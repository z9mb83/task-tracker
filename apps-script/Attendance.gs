/**
 * TASK TRACKER - Attendance
 * ------------------------------------------------------------
 * Employees check in and out from their dashboard with a selfie and their location.
 *  - Photos: Google Drive > "Task Tracker Attendance" > <Employee> > <yyyy-MM>
 *  - Records: "Attendance" tab in the Admin sheet, one row per employee per day
 *  - Location: check-in/out must be within the office radius (Settings)
 *  - Late: check-in after office start + buffer (10:20 AM by default)
 *  - Auto check-out: open days are closed at office end + buffer (6:20 PM)
 *  - Photos for a month are moved to Drive's trash on the 15th of the next month
 */

const ATT_TAB = 'Attendance';
const ATT_HEADERS = ['Date', 'Employee', 'Check In', 'Check Out', 'Worked (min)', 'Worked', 'Late', 'Flags',
                     'In Photo', 'Out Photo', 'In Distance (m)', 'Out Distance (m)'];
const A = { DATE: 1, NAME: 2, IN: 3, OUT: 4, MIN: 5, HRS: 6, LATE: 7, FLAGS: 8, IN_PHOTO: 9, OUT_PHOTO: 10, IN_DIST: 11, OUT_DIST: 12 };
const ATT_COLS = ATT_HEADERS.length;
const MAX_PHOTO_CHARS = 700000;   // ~500 KB JPEG

// ---------- Settings ----------
function attSettings_() {
  const s = getSettings_();
  const hm = (v, d) => { const p = parseStart_(v); return p ? p.h * 60 + p.m : d; };
  const num = v => (v === '' || v == null) ? NaN : Number(v);
  return {
    lat: num(s['Office latitude']), lng: num(s['Office longitude']),
    radius: Number(s['Office radius (m)']) || 150,
    block: String(s['Location check'] || 'Block').toLowerCase() !== 'flag only',
    start: hm(s['Office start'], 600), end: hm(s['Office end'], 1080),
    buffer: Number(s['Buffer (min)']) || 20,
    confirmed: String(s['Office location confirmed'] || '').toLowerCase() === 'yes',
    weeklyOff: parseWeeklyOff_(s['Weekly off'] === undefined ? 'Sunday' : s['Weekly off']),
    holidays: parseHolidays_(s['Holidays'])
  };
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** 'Sunday' / 'Sat, Sun' -> [0] / [6, 0] */
function parseWeeklyOff_(v) {
  return String(v || '').toLowerCase().split(/[,;/&]+|\band\b/).map(x => DAY_NAMES.indexOf(x.trim().slice(0, 3))).filter(i => i >= 0);
}
/** '2026-11-01, 25-12-2026: Christmas' -> { '2026-11-01': '', '2026-12-25': 'Christmas' } */
function parseHolidays_(v) {
  const out = {};
  String(v || '').split(/[,;\n]+/).forEach(part => {
    const m = part.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (!m) return;
    const key = m[1] ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0')
                     : m[6] + '-' + m[5].padStart(2, '0') + '-' + m[4].padStart(2, '0');
    const i = part.indexOf(':');
    out[key] = i >= 0 ? part.slice(i + 1).trim() : '';
  });
  return out;
}
/** Every day of a month as { date, dow, type: work | off | holiday, label } */
function monthDays_(month, cfg) {
  const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= n; d++) {
    const date = month + '-' + String(d).padStart(2, '0');
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const type = date in cfg.holidays ? 'holiday' : cfg.weeklyOff.includes(dow) ? 'off' : 'work';
    out.push({ date: date, dow: dow, type: type, label: type === 'holiday' ? (cfg.holidays[date] || 'Holiday') : '' });
  }
  return out;
}

/** Minutes since midnight (IST) -> Date on the given day. */
function atMinutes_(dayKey, mins) {
  return Utilities.parseDate(dayKey + ' ' + Math.floor(mins / 60) + ':' + (mins % 60), TZ, 'yyyy-MM-dd H:m');
}
function minutesOfDay_(d) {
  const p = Utilities.formatDate(d, TZ, 'H:m').split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}
function clock_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'h:mm a') : ''; }
function hoursLabel_(min) { min = Math.max(0, Math.round(min || 0)); return Math.floor(min / 60) + ' h ' + (min % 60) + ' min'; }

// ---------- Sheet ----------
function attSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ATT_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(ATT_TAB);
  sh.getRange(1, 1, 1, ATT_COLS).setValues([ATT_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f3864').setWrap(true);
  sh.setFrozenRows(1);
  const n = sh.getMaxRows() - 1;
  sh.getRange(2, A.DATE, n, 1).setNumberFormat('@');
  sh.getRange(2, A.IN, n, 2).setNumberFormat('dd-mmm h:mm am/pm');
  sh.getRange(2, A.MIN, n, 1).setNumberFormat('0');
  sh.getRange(2, A.IN_PHOTO, n, 2).setNumberFormat('@');
  [95, 140, 120, 120, 90, 100, 60, 220, 200, 200, 90, 90].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  return sh;
}

function attRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ATT_COLS).getValues().map((r, i) => ({ row: i + 2, v: r }));
}

function findAttRow_(sh, name, dayKey) {
  return attRows_(sh).find(x => String(x.v[A.DATE - 1]) === dayKey && x.v[A.NAME - 1] === name) || null;
}

// ---------- Location ----------
function distanceM_(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Returns { dist, ok }. Allows for the phone's reported accuracy (up to 100 m). */
function checkLocation_(cfg, lat, lng, acc) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return { dist: null, ok: false };
  if (isNaN(cfg.lat) || isNaN(cfg.lng)) return { dist: null, ok: true };   // office not set: don't block
  const dist = distanceM_(cfg.lat, cfg.lng, lat, lng);
  return { dist: dist, ok: dist <= cfg.radius + Math.min(Math.max(Number(acc) || 0, 0), 100) };
}

// ---------- Photos ----------
function attRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ATT_ROOT');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ }
  }
  const f = DriveApp.createFolder('Task Tracker Attendance');
  props.setProperty('ATT_ROOT', f.getId());
  return f;
}
function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function savePhoto_(name, kind, dataUrl, when) {
  const m = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('The photo did not come through. Please try again.');
  if (dataUrl.length > MAX_PHOTO_CHARS) throw new Error('The photo is too large. Please try again.');
  const month = Utilities.formatDate(when, TZ, 'yyyy-MM');
  const folder = childFolder_(childFolder_(attRootFolder_(), name), month);
  const fname = Utilities.formatDate(when, TZ, 'yyyy-MM-dd') + '_' + kind + '_' + Utilities.formatDate(when, TZ, 'HH-mm') + '.jpg';
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/jpeg', fname));
  return file.getUrl();
}
function photoId_(url) { const m = String(url || '').match(/\/d\/([A-Za-z0-9_-]+)/); return m ? m[1] : ''; }

// ---------- Employee ----------
/** Check in or out. kind: 'in' | 'out'. */
function empCheck(token, kind, photo, lat, lng, acc) {
  const sess = requireSession_(token, 'employee');
  if (kind !== 'in' && kind !== 'out') throw new Error('Unknown action.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Busy, please try again in a moment.');
  try {
    const cfg = attSettings_();
    const now = new Date();
    const day = dayKey_(now);
    const workDay = monthDays_(day.slice(0, 7), cfg).find(d => d.date === day).type === 'work';   // no late / early flags on holidays
    const loc = checkLocation_(cfg, lat, lng, acc);
    if (loc.dist === null && !isNaN(cfg.lat) && cfg.block) {
      throw new Error('Location is needed to check ' + kind + '. Allow location for this site and try again.');
    }
    if (!loc.ok && cfg.block) {
      throw new Error('You seem to be about ' + loc.dist + ' m from the office. Check-' + kind + ' only works at the office.');
    }
    const sh = attSheet_();
    const rec = findAttRow_(sh, sess.name, day);
    const flagOutside = !loc.ok && loc.dist !== null ? 'Outside office (' + loc.dist + ' m)' : '';

    if (kind === 'in') {
      if (rec && rec.v[A.IN - 1] instanceof Date) throw new Error('You already checked in today at ' + clock_(rec.v[A.IN - 1]) + '.');
      if (minutesOfDay_(now) >= cfg.end + cfg.buffer) throw new Error('Office hours are over for today.');
      const url = savePhoto_(sess.name, 'in', photo, now);
      const late = workDay && minutesOfDay_(now) > cfg.start + cfg.buffer;
      sh.appendRow([day, sess.name, now, '', '', '', late ? 'Yes' : 'No', flagOutside, url, '', loc.dist === null ? '' : loc.dist, '']);
      sh.getRange(sh.getLastRow(), A.DATE).setNumberFormat('@').setValue(day);
    } else {
      if (!rec || !(rec.v[A.IN - 1] instanceof Date)) throw new Error('You have not checked in today.');
      if (rec.v[A.OUT - 1] instanceof Date) throw new Error('You already checked out at ' + clock_(rec.v[A.OUT - 1]) + '.');
      const url = savePhoto_(sess.name, 'out', photo, now);
      const worked = Math.round((now - rec.v[A.IN - 1]) / 60000);
      const flags = [rec.v[A.FLAGS - 1], flagOutside, workDay && minutesOfDay_(now) < cfg.end - cfg.buffer ? 'Left early' : '']
        .filter(String).join('; ');
      sh.getRange(rec.row, A.OUT, 1, 5).setValues([[now, worked, hoursLabel_(worked), rec.v[A.LATE - 1], flags]]);
      sh.getRange(rec.row, A.OUT_PHOTO).setValue(url);
      sh.getRange(rec.row, A.OUT_DIST).setValue(loc.dist === null ? '' : loc.dist);
    }
  } finally {
    lock.releaseLock();
  }
  return empData(token);
}

/** Today's attendance for one employee (shown on their dashboard). */
function attendanceToday_(name) {
  const cfg = attSettings_();
  const now = new Date();
  const day = dayKey_(now);
  const base = { officeStart: clock_(atMinutes_(day, cfg.start)), officeEnd: clock_(atMinutes_(day, cfg.end)),
                 lateAfter: clock_(atMinutes_(day, cfg.start + cfg.buffer)),
                 closed: minutesOfDay_(now) >= cfg.end + cfg.buffer, needsLocation: !isNaN(cfg.lat) && cfg.block };
  const sh = SpreadsheetApp.getActive().getSheetByName(ATT_TAB);
  const rec = sh ? findAttRow_(sh, name, day) : null;
  if (!rec || !(rec.v[A.IN - 1] instanceof Date)) return Object.assign(base, { state: 'none' });
  const r = rec.v;
  const out = r[A.OUT - 1] instanceof Date;
  return Object.assign(base, {
    state: out ? 'out' : 'in',
    inMs: r[A.IN - 1].getTime(), inLabel: clock_(r[A.IN - 1]),
    outMs: out ? r[A.OUT - 1].getTime() : 0, outLabel: out ? clock_(r[A.OUT - 1]) : '',
    workedMin: out ? Number(r[A.MIN - 1]) || 0
      : Math.max(0, Math.round((Math.min(now, atMinutes_(day, cfg.end + cfg.buffer)) - r[A.IN - 1]) / 60000)),
    autoOutLabel: clock_(atMinutes_(day, cfg.end + cfg.buffer)),
    late: r[A.LATE - 1] === 'Yes', flags: String(r[A.FLAGS - 1] || '')
  });
}

// ---------- Admin ----------
function adminAttendance(token, month) {
  requireSession_(token, 'admin');
  const cfg = attSettings_();
  const now = new Date();
  const today = dayKey_(now);
  month = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : today.slice(0, 7);
  const sh = attSheet_();
  const rows = attRows_(sh).map(x => x.v);
  const employees = getTeamAll_().filter(m => m.role === 'Employee' && m.active).map(m => m.name);
  const rec = r => {
    const inD = r[A.IN - 1], outD = r[A.OUT - 1];
    return {
      date: String(r[A.DATE - 1]), name: r[A.NAME - 1],
      inLabel: clock_(inD), outLabel: clock_(outD),
      workedMin: outD instanceof Date ? Number(r[A.MIN - 1]) || 0 : (inD instanceof Date && String(r[A.DATE - 1]) === today
        ? Math.max(0, Math.round((Math.min(now, atMinutes_(today, cfg.end + cfg.buffer)) - inD) / 60000)) : 0),
      open: inD instanceof Date && !(outD instanceof Date),
      late: r[A.LATE - 1] === 'Yes', flags: String(r[A.FLAGS - 1] || ''),
      inPhoto: photoId_(r[A.IN_PHOTO - 1]), outPhoto: photoId_(r[A.OUT_PHOTO - 1]),
      photosDeleted: String(r[A.IN_PHOTO - 1]) === 'Deleted'
    };
  };
  const todayRows = employees.map(n => {
    const r = rows.find(x => String(x[A.DATE - 1]) === today && x[A.NAME - 1] === n);
    return r ? rec(r) : { date: today, name: n, absent: true };
  });
  const monthRows = rows.filter(r => String(r[A.DATE - 1]).slice(0, 7) === month).map(rec)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const names = [...new Set(employees.concat(monthRows.map(r => r.name)))];
  // Working days count up to today (today only once check-in has closed or they came in).
  // Days before an employee's first-ever check-in are not counted as leave (they had not joined yet).
  const days = monthDays_(month, cfg);
  const closedToday = minutesOfDay_(now) >= cfg.end + cfg.buffer;
  const firstSeen = {};
  rows.forEach(r => { const n = r[A.NAME - 1], d = String(r[A.DATE - 1]); if (!firstSeen[n] || d < firstSeen[n]) firstSeen[n] = d; });
  const summary = names.map(n => {
    const mine = monthRows.filter(r => r.name === n);
    const total = mine.reduce((t, r) => t + (r.workedMin || 0), 0);
    const came = {}; mine.forEach(r => { came[r.date] = true; });
    const counted = days.filter(d => d.type === 'work' && (d.date < today || (d.date === today && (closedToday || came[d.date]))) &&
                                     firstSeen[n] && d.date >= firstSeen[n]);
    const present = counted.filter(d => came[d.date]).length;
    const leaves = counted.filter(d => !came[d.date]).map(d => d.date);
    const extra = mine.filter(r => days.some(d => d.date === r.date && d.type !== 'work')).length;   // came on a holiday / weekly off
    return { name: n, workingDays: counted.length, present: present, leaves: leaves.length, leaveDates: leaves, extraDays: extra,
             pct: counted.length ? Math.round(present / counted.length * 100) : null,
             monthWorkingDays: days.filter(d => d.type === 'work').length,
             days: mine.length, late: mine.filter(r => r.late).length,
             totalMin: total, avgMin: mine.length ? Math.round(total / mine.length) : 0,
             auto: mine.filter(r => /Auto check-out/.test(r.flags)).length,
             early: mine.filter(r => /Left early/.test(r.flags)).length };
  });
  return {
    today: today, month: month, todayRows: todayRows, monthRows: monthRows, summary: summary, calendar: days,
    office: { lat: isNaN(cfg.lat) ? null : cfg.lat, lng: isNaN(cfg.lng) ? null : cfg.lng, radius: cfg.radius,
              confirmed: cfg.confirmed, block: cfg.block,
              hours: clock_(atMinutes_(today, cfg.start)) + ' - ' + clock_(atMinutes_(today, cfg.end)),
              lateAfter: clock_(atMinutes_(today, cfg.start + cfg.buffer)),
              autoOut: clock_(atMinutes_(today, cfg.end + cfg.buffer)) }
  };
}

/** One attendance photo as a data URL (only photos recorded in the Attendance tab). */
function adminAttPhoto(token, fileId) {
  requireSession_(token, 'admin');
  fileId = String(fileId || '');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) throw new Error('Unknown photo.');
  const known = attRows_(attSheet_()).some(x => photoId_(x.v[A.IN_PHOTO - 1]) === fileId || photoId_(x.v[A.OUT_PHOTO - 1]) === fileId);
  if (!known) throw new Error('Unknown photo.');
  const file = DriveApp.getFileById(fileId);
  if (file.isTrashed()) throw new Error('This photo has been deleted.');
  return { dataUrl: 'data:image/jpeg;base64,' + Utilities.base64Encode(file.getBlob().getBytes()), name: file.getName() };
}

/** Admin stands in the office and saves the current location as the office. */
function adminSetOffice(token, lat, lng, acc) {
  requireSession_(token, 'admin');
  lat = Number(lat); lng = Number(lng);
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Could not read your location.');
  setSetting_('Office latitude', Math.round(lat * 1e6) / 1e6);
  setSetting_('Office longitude', Math.round(lng * 1e6) / 1e6);
  setSetting_('Office location confirmed', 'Yes');
  return adminAttendance(token);
}

function setSetting_(label, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  const vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => String(r[0]).trim());
  const i = vals.indexOf(label);
  if (i >= 0) sh.getRange(i + 1, 2).setValue(value);
  else sh.appendRow([label, value, '']);
}

// ---------- Scheduled jobs (triggers created by setup) ----------
/** Closes days with no check-out at office end + buffer (6:20 PM). Runs daily in the evening and overnight. */
function autoCheckout() {
  const cfg = attSettings_();
  const sh = SpreadsheetApp.getActive().getSheetByName(ATT_TAB);
  if (!sh) return;
  const now = new Date();
  attRows_(sh).forEach(x => {
    const r = x.v;
    if (!(r[A.IN - 1] instanceof Date) || r[A.OUT - 1] instanceof Date) return;
    const closeAt = atMinutes_(String(r[A.DATE - 1]), cfg.end + cfg.buffer);
    if (now < closeAt) return;                          // not yet 6:20 PM on that day
    const outAt = closeAt > r[A.IN - 1] ? closeAt : r[A.IN - 1];
    const worked = Math.round((outAt - r[A.IN - 1]) / 60000);
    const flags = [r[A.FLAGS - 1], 'Auto check-out'].filter(String).join('; ');
    sh.getRange(x.row, A.OUT, 1, 5).setValues([[outAt, worked, hoursLabel_(worked), r[A.LATE - 1], flags]]);
  });
}

/** Moves a month's photos to Drive's trash on the 15th of the next month (October -> 15 November). */
function cleanupAttendancePhotos() {
  autoCheckout();   // also closes any day missed by the evening run
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ATT_ROOT')) return;
  const root = attRootFolder_();
  const today = dayKey_(new Date());
  const removed = [];
  const people = root.getFolders();
  while (people.hasNext()) {
    const months = people.next().getFolders();
    while (months.hasNext()) {
      const f = months.next();
      const m = f.getName().match(/^(\d{4})-(\d{2})$/);
      if (!m) continue;
      const y = Number(m[1]), mo = Number(m[2]);
      const next = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
      if (today >= next + '-15') { f.setTrashed(true); if (!removed.includes(f.getName())) removed.push(f.getName()); }
    }
  }
  if (!removed.length) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(ATT_TAB);
  if (!sh) return;
  attRows_(sh).forEach(x => {
    if (removed.includes(String(x.v[A.DATE - 1]).slice(0, 7)) && x.v[A.IN_PHOTO - 1] && x.v[A.IN_PHOTO - 1] !== 'Deleted') {
      sh.getRange(x.row, A.IN_PHOTO, 1, 2).setValues([['Deleted', x.v[A.OUT_PHOTO - 1] ? 'Deleted' : '']]);
    }
  });
}

/** Adds any missing attendance rows to Settings (values can be changed there later). */
function ensureAttendanceSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  const have = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => String(r[0]).trim());
  [['Office latitude', '', 'Set from the admin dashboard: Attendance > Use my current location (Phase 10, Mohali)'],
   ['Office longitude', '', 'Set together with the latitude'],
   ['Office radius (m)', 150, 'How close to the office a check-in must be'],
   ['Location check', 'Block', 'Block = refuse check-ins away from the office; Flag only = allow but flag'],
   ['Office start', '10:00', 'Late after start + buffer'],
   ['Office end', '18:00', 'Auto check-out at end + buffer'],
   ['Buffer (min)', 20, 'Grace minutes for late / left early / auto check-out'],
   ['Weekly off', 'Sunday', 'Days off every week, e.g. Sunday or Saturday, Sunday'],
   ['Holidays', '', 'Office holidays, comma separated: 2026-11-08: Diwali, 2026-12-25: Christmas']]
    .forEach(r => {
      if (have.includes(r[0])) return;
      sh.appendRow(['', '', '']);
      sh.getRange(sh.getLastRow(), 1, 1, 3).setNumberFormat('@').setValues([r]);
    });
}

/** Adds the attendance triggers (called from setup). */
function setUpAttendanceTriggers_() {
  ensureAttendanceSettings_();
  attSheet_();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['autoCheckout', 'cleanupAttendancePhotos'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  // Apps Script runs "near" the minute (±15 min); 18:40 keeps it safely after 6:20 PM
  ScriptApp.newTrigger('autoCheckout').timeBased().atHour(18).nearMinute(40).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('cleanupAttendancePhotos').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
}

/** Attendance block for the admin's evening summary email. */
function attendanceSummaryHtml_() {
  autoCheckout();
  const sh = SpreadsheetApp.getActive().getSheetByName(ATT_TAB);
  if (!sh) return '';
  const today = dayKey_(new Date());
  const employees = getTeam_().filter(m => m.role === 'Employee').map(m => m.name);
  if (!employees.length) return '';
  const rows = attRows_(sh).map(x => x.v).filter(r => String(r[A.DATE - 1]) === today);
  const line = employees.map(n => {
    const r = rows.find(x => x[A.NAME - 1] === n);
    if (!r) return [n, '-', '-', '-', 'Not checked in'];
    return [n, clock_(r[A.IN - 1]), clock_(r[A.OUT - 1]) || '-', r[A.HRS - 1] || '-',
            [r[A.LATE - 1] === 'Yes' ? 'Late' : '', r[A.FLAGS - 1]].filter(String).join('; ')];
  });
  const present = line.filter(l => l[1] !== '-').length;
  const late = rows.filter(r => r[A.LATE - 1] === 'Yes').length;
  return '<h3>Attendance today</h3><p><b>' + present + '</b> of ' + employees.length + ' present &nbsp;|&nbsp; <b>' + late + '</b> late</p>' +
    table_(['Employee', 'In', 'Out', 'Worked', 'Notes'], line, line.map(l => l[1] === '-'));
}
