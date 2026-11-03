/**
 * POST /api/mcp: MCP server (Streamable HTTP, JSON responses) for the ChatGPT plugin.
 * Every request needs an OAuth access token (see lib/oauth.js); without one ChatGPT is told
 * where to sign in. Tools: get_context (today + employee names) and add_tasks.
 */
const { verify, baseUrl } = require('../lib/oauth.js');
const { callAppsScript } = require('../lib/apps.js');

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const LIMITS = [30, 45, 60];
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const INSTRUCTIONS = 'Task Tracker adds tasks for office employees. Call get_context first for today\'s date (India time) and the exact employee names. ' +
  'Each task needs a short title, an employee from get_context, a due date (yyyy-MM-dd) and a 24-hour start time (HH:MM); work out "tomorrow" or "Friday" from today. ' +
  'Ask one short question if anything is missing or a name is unclear; never guess. Defaults: 45-minute limit, Medium priority, no email now. ' +
  'Before calling add_tasks, show the admin the list (employee, title, due, start, limit) and wait for a clear yes. Then report each ticket ID or the reason it failed.';

const TOOLS = [
  {
    name: 'get_context',
    title: 'Get date and employees',
    description: "Today's date (India time) and the exact names of active employees, plus allowed priorities and time limits. Call this before add_tasks.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'add_tasks',
    title: 'Add tasks',
    description: 'Adds tasks to the Task Tracker sheet as approved tasks for the named employees (max 20). Only call after the admin has confirmed the list.',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      additionalProperties: false,
      properties: {
        tasks: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            required: ['task', 'assignee', 'due', 'startTime'],
            additionalProperties: false,
            properties: {
              task: { type: 'string', maxLength: 200, description: 'Short task title' },
              details: { type: 'string', maxLength: 2000 },
              assignee: { type: 'string', description: 'Employee name exactly as returned by get_context' },
              due: { type: 'string', description: 'Due date, yyyy-MM-dd' },
              startTime: { type: 'string', description: 'Start time, 24-hour HH:MM' },
              limit: { type: 'integer', enum: LIMITS, description: 'Minutes to finish (default 45)' },
              priority: { type: 'string', enum: PRIORITIES, description: 'Default Medium' },
              sendNow: { type: 'boolean', description: 'Email the employee now (default false; the daily email covers it)' }
            }
          }
        }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
];

function cleanTask(t) {
  t = t && typeof t === 'object' ? t : {};
  return {
    task: str(t.task, 200), details: str(t.details, 2000), assignee: str(t.assignee, 80),
    due: str(t.due, 10), startTime: str(t.startTime, 8),
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'Medium',
    limit: LIMITS.includes(Number(t.limit)) ? Number(t.limit) : 45,
    sendNow: t.sendNow === true
  };
}

const textResult = (text, structured, isError) => Object.assign({ content: [{ type: 'text', text }] },
  structured ? { structuredContent: structured } : {}, isError ? { isError: true } : {});

async function callTool(name, args) {
  args = args || {};
  if (name === 'get_context') {
    const c = await callAppsScript('gptContext', []);
    return textResult(`Today is ${c.today} (${c.timeZone}). Active employees: ${(c.employees || []).join(', ') || 'none'}.`, c);
  }
  if (name === 'add_tasks') {
    const list = Array.isArray(args.tasks) ? args.tasks : [];
    if (!list.length) return textResult('Give at least one task.', null, true);
    if (list.length > 20) return textResult('Add at most 20 tasks at a time.', null, true);
    const tasks = list.map(cleanTask);
    if (tasks.some(t => !t.task)) return textResult('Every task needs a title.', null, true);
    const results = await callAppsScript('gptAddTasks', [tasks]);
    const lines = results.map(r => r.ok ? `✓ ${r.id || '(new)'} · ${r.employee} · ${r.task} · due ${r.due}` : `✗ ${r.employee || '?'} · ${r.task}: ${r.error}`);
    return textResult(lines.join('\n'), { results }, results.every(r => !r.ok));
  }
  throw Object.assign(new Error('Unknown tool: ' + name), { rpc: -32602 });
}

async function handle(msg) {
  const { method, params } = msg || {};
  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return {
      protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'task-tracker', title: 'Task Tracker', version: '1.0.0' },
      instructions: INSTRUCTIONS
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') {
    try { return await callTool(params && params.name, params && params.arguments); }
    catch (err) {
      if (err.rpc) throw err;
      return textResult('Task Tracker error: ' + (err.message || 'something went wrong'), null, true);
    }
  }
  throw Object.assign(new Error('Method not found: ' + method), { rpc: -32601 });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST (Streamable HTTP, JSON responses).' }); }

  const auth = String(req.headers.authorization || '');
  const token = /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!verify(token, 'at')) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"` + (token ? ', error="invalid_token"' : ''));
    return res.status(401).json({ error: 'Sign in to Task Tracker first.' });
  }

  let msg = req.body;
  if (typeof msg === 'string' || Buffer.isBuffer(msg)) { try { msg = JSON.parse(String(msg)); } catch (e) { msg = null; } }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Send one JSON-RPC message.' } });
  }
  if (msg.id === undefined || msg.id === null) return res.status(202).end();   // notification, e.g. notifications/initialized
  try {
    const result = await handle(msg);
    return res.status(200).json({ jsonrpc: '2.0', id: msg.id, result });
  } catch (err) {
    return res.status(200).json({ jsonrpc: '2.0', id: msg.id, error: { code: err.rpc || -32603, message: err.message || 'Internal error' } });
  }
};
