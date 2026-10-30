/**
 * TASK TRACKER - JSON API for the Vercel dashboard
 * ------------------------------------------------------------
 * The Vercel app's /api/rpc function POSTs here:
 *   { "key": "<API secret>", "fn": "adminData", "args": ["<session token>"] }
 * and gets back:
 *   { "ok": true, "result": ... }   or   { "ok": false, "error": "message" }
 *
 * Only the functions listed in API_FUNCTIONS can be called, and only with the
 * shared API secret (Task System > Set up Vercel connection). The secret lives in
 * Script Properties here and in the Vercel environment variable API_SECRET.
 */

// Names only: resolved at call time, so file load order in Apps Script does not matter.
const API_FUNCTIONS = [
  'publicInfo', 'login', 'logout',
  'adminData', 'adminAddTask', 'adminUpdateTask', 'adminAddEmployee',
  'adminSetEmployeeActive', 'adminResetPin', 'adminRemoveEmployee', 'adminSyncNow',
  'empData', 'empUpdateTask',
  'managerLogin', 'decisionInfo', 'decide',
  'adminDecideChange', 'adminReopen',
  'empCheck', 'empAttendance', 'adminAttendance', 'adminAttPhoto'
];

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || !req.key || req.key !== secret) throw new Error('Not authorised.');
    const fn = API_FUNCTIONS.includes(req.fn) ? globalThis[req.fn] : null;
    if (typeof fn !== 'function') throw new Error('Unknown action.');
    const args = Array.isArray(req.args) ? req.args : [];
    out = { ok: true, result: fn.apply(null, args) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Shown on the login page; no login needed. */
function publicInfo() {
  let brand = '';
  try { brand = String(getSettings_()['Company name'] || ''); } catch (e) { /* settings missing */ }
  return { brand: brand };
}

/** Menu: create (or replace) the secret shared with Vercel. */
function setUpVercelConnection() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('API_SECRET')) {
    const r = ui.alert('Replace the Vercel API secret?',
      'A secret already exists. Making a new one disconnects Vercel until you update API_SECRET there.',
      ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('API_SECRET', secret);
  const url = ScriptApp.getService().getUrl() || '(not deployed yet: Deploy > New deployment > Web app)';
  ui.alert('Vercel connection',
    'Add these two Environment Variables in Vercel (Project > Settings > Environment Variables), then redeploy:\n\n' +
    'APPS_SCRIPT_URL\n' + url + '\n\n' +
    'API_SECRET\n' + secret + '\n\n' +
    'Copy them now; the secret is not shown again.',
    ui.ButtonSet.OK);
}
