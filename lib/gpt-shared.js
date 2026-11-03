/**
 * Shared by /api/gpt/* (ChatGPT custom GPT actions). Not an endpoint itself.
 *
 * Environment variables (Vercel):
 *   GPT_API_KEY   a long random key you create; paste it into the GPT's Action authentication
 *                 (only the GPT knows it; it is separate from the dashboard's API_SECRET)
 *   APPS_SCRIPT_URL, API_SECRET   same as /api/rpc
 */
const crypto = require('crypto');

function sameKey(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Returns an error message, or null when the request carries the right key. */
function checkKey(req) {
  const want = (process.env.GPT_API_KEY || '').trim();
  if (!want) return { status: 500, error: 'The ChatGPT connection is not set up yet (GPT_API_KEY missing in Vercel).' };
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!got || !sameKey(got, want)) return { status: 401, error: 'Wrong or missing API key.' };
  return null;
}

/** Calls one allowed Apps Script function and returns its result (throws on failure). */
async function callAppsScript(fn, args) {
  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = (process.env.API_SECRET || '').replace(/\s+/g, '');
  if (!url || !key) throw Object.assign(new Error('Task Tracker is not configured (APPS_SCRIPT_URL / API_SECRET missing in Vercel).'), { status: 500 });
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key, fn, args }),
    redirect: 'follow'
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw Object.assign(new Error('Google Apps Script did not respond correctly.'), { status: 502 });
  }
  if (!data.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: 400 });
  return data.result;
}

function fail(res, err) {
  const status = err.status || 502;
  if (status >= 500) console.error('ChatGPT endpoint error', err);
  return res.status(status).json({ ok: false, error: err.message || 'Something went wrong.' });
}

module.exports = { checkKey, callAppsScript, fail };
