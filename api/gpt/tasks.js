/**
 * POST /api/gpt/tasks  (ChatGPT action "addTasks")
 * Body: { "tasks": [ { "task": "...", "assignee": "Aryan", "due": "2026-11-05", "startTime": "10:00",
 *                      "limit": 45, "priority": "High", "details": "...", "sendNow": false } ] }
 * Adds the tasks to the Admin sheet as approved tasks, the same as the dashboard's "New task".
 */
const { checkKey, callAppsScript, fail } = require('../../lib/gpt-shared.js');

const PRIORITIES = ['High', 'Medium', 'Low'];
const LIMITS = [30, 45, 60];
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function clean(t) {
  if (!t || typeof t !== 'object') throw Object.assign(new Error('Each task must be an object.'), { status: 400 });
  const out = {
    task: str(t.task, 200),
    details: str(t.details, 2000),
    assignee: str(t.assignee, 80),
    due: str(t.due, 10),
    startTime: str(t.startTime, 8),
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'Medium',
    limit: LIMITS.includes(Number(t.limit)) ? Number(t.limit) : 45,
    sendNow: t.sendNow === true
  };
  if (!out.task) throw Object.assign(new Error('Every task needs a title.'), { status: 400 });
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Use POST.' }); }
  const bad = checkKey(req);
  if (bad) return res.status(bad.status).json({ ok: false, error: bad.error });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  try {
    const list = body && Array.isArray(body.tasks) ? body.tasks : null;
    if (!list || !list.length) throw Object.assign(new Error('Send a "tasks" list with at least one task.'), { status: 400 });
    if (list.length > 20) throw Object.assign(new Error('Add at most 20 tasks per request.'), { status: 400 });
    const results = await callAppsScript('gptAddTasks', [list.map(clean)]);
    return res.status(200).json({ ok: true, results });
  } catch (err) { return fail(res, err); }
};
