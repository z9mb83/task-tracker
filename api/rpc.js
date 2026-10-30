/**
 * POST /api/rpc  { fn: "adminData", args: [...] }
 *
 * Forwards dashboard requests to the Apps Script web app, adding the shared
 * API secret. The browser never sees the Apps Script URL or the secret.
 *
 * Environment variables (Vercel > Project > Settings > Environment Variables):
 *   APPS_SCRIPT_URL  the Apps Script web app URL (ends in /exec)
 *   API_SECRET       from the Admin sheet: Task System > Set up Vercel connection
 */

const ALLOWED = new Set([
  'publicInfo', 'login', 'logout',
  'adminData', 'adminAddTask', 'adminUpdateTask', 'adminAddEmployee',
  'adminSetEmployeeActive', 'adminResetPin', 'adminRemoveEmployee', 'adminSyncNow',
  'empData', 'empUpdateTask'
]);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = (process.env.API_SECRET || '').replace(/\s+/g, '');
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'Dashboard is not configured yet (APPS_SCRIPT_URL / API_SECRET missing in Vercel).' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const fn = body && body.fn;
  const args = body && Array.isArray(body.args) ? body.args : [];
  if (!ALLOWED.has(fn)) return res.status(400).json({ ok: false, error: 'Unknown action.' });
  if (JSON.stringify(args).length > 20000) return res.status(413).json({ ok: false, error: 'Request too large.' });

  try {
    // Apps Script answers a POST with a redirect; fetch follows it and returns the JSON.
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key, fn, args }),
      redirect: 'follow'
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      console.error('Apps Script returned non-JSON', r.status, text.slice(0, 300));
      return res.status(502).json({ ok: false, error: 'Google Apps Script did not respond correctly. Check the deployment URL and that access is set to Anyone.' });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('Apps Script request failed', err);
    return res.status(502).json({ ok: false, error: 'Could not reach Google Apps Script. Try again in a moment.' });
  }
};
