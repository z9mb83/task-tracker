# Task Tracker in ChatGPT (plugin)

The admin tells ChatGPT the tasks in plain words. ChatGPT checks the employee names and dates,
shows the list, and after a yes adds the tasks to the Admin sheet for the right employees,
the same as the dashboard's New task. It can only see employee names and add tasks.

ChatGPT custom GPTs are retired on 11 December 2026, so this is a ChatGPT **plugin** that talks to
an MCP server on the dashboard (`/api/mcp`), protected by sign-in with the admin dashboard password.

## How it works

| Part | Where |
| --- | --- |
| MCP server (tools `get_context`, `add_tasks`) | `api/mcp.js` |
| Sign-in (OAuth 2.1 with PKCE, dynamic client registration) | `api/oauth/*.js`, `lib/oauth.js` |
| Discovery | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` (rewrites in `vercel.json`) |
| Sheet writes | Apps Script `gptContext`, `gptAddTasks` (WebApp.gs) |

- The admin password is checked by Apps Script, with the same 5-tries / 15-minute lockout as the dashboard.
- Only ChatGPT's own callback addresses (chatgpt.com, chat.openai.com) can receive sign-in codes.
- Tokens are signed, not stored: access lasts 1 hour, and ChatGPT renews it for up to 30 days, then asks for the password again.
- No extra Vercel variables are needed. Optional: set `MCP_TOKEN_SECRET` to any long random value (or change it) and redeploy to sign ChatGPT out immediately.

## Connect it (once)

1. ChatGPT > **Plugins** > **Add** > **Add custom MCP server**.
2. Name `Task Tracker`; description `Add tasks for employees`.
3. Connection: **Server URL** `https://<your dashboard>/api/mcp`
4. Authentication: **OAuth**. Save.
5. ChatGPT opens the Task Tracker sign-in page: enter the **admin dashboard password** and press **Allow**.

## Use it

In a chat, turn on the Task Tracker plugin and say, for example:
*"Tell Aryan to send the Mohali visit report tomorrow at 3 PM, 45 minutes, high priority."*
ChatGPT confirms the list with you before adding, then replies with the ticket IDs.
Tasks are approved immediately; employees get them in the daily email (or right away if you ask it to email now).
