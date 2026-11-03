/** GET /api/gpt/context: today's date and the active employee names (for the ChatGPT action). */
const { checkKey, callAppsScript, fail } = require('../../lib/gpt-shared.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'Use GET.' }); }
  const bad = checkKey(req);
  if (bad) return res.status(bad.status).json({ ok: false, error: bad.error });
  try {
    const result = await callAppsScript('gptContext', []);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) { return fail(res, err); }
};
