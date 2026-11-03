/**
 * Calls the Apps Script web app (same channel as /api/rpc), from server-side code only.
 * Environment variables (Vercel): APPS_SCRIPT_URL, API_SECRET
 */
async function callAppsScript(fn, args) {
  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = (process.env.API_SECRET || '').replace(/\s+/g, '');
  if (!url || !key) throw Object.assign(new Error('Task Tracker is not configured (APPS_SCRIPT_URL / API_SECRET missing in Vercel).'), { status: 500 });
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key, fn, args: args || [] }),
      redirect: 'follow'
    });
  } catch (e) {
    throw Object.assign(new Error('Could not reach Google Apps Script. Try again in a moment.'), { status: 502 });
  }
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw Object.assign(new Error('Google Apps Script did not respond correctly.'), { status: 502 });
  }
  if (!data.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: 400 });
  return data.result;
}

module.exports = { callAppsScript };
