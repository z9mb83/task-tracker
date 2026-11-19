# CLAUDE.md - task-tracker

Read this first, then `README.md`, `docs/sheet-structure.md` (every tab, column and Settings row) and `docs/chatgpt-setup.md`.

## What this is
A small-team ticketing and attendance system for the owner's staff, built on two Google Sheets + Apps Script, with dashboards
hosted on **Vercel (free)**.
- Sheets: **Task Tracker - Admin** (Tasks, Team, Settings, Dashboard, Attendance - the single source of truth) and
  **Task Tracker - Employees** (one tab per employee). Apps Script is bound to the Admin sheet (`apps-script/*.gs`).
- Vercel serves `public/*.html` and one function, `api/rpc.js`, which adds the secret and forwards calls to the Apps Script web app.
- Roles: Admin (password), Task manager (name + shared PIN, checked only on Vercel), Employee (email + 6-digit PIN).
- Features: timed tickets (date, start time, 30/45/60 min limit, live countdown), approvals by email or dashboard, edit/cancel
  rules and locking, manager review of Done tickets, work links, recurring tasks (daily/weekly/monthly, `Recurring.gs`),
  attendance with selfie + location for two offices (Mohali, Chandigarh), auto check-out 6:20 PM, monthly reports, holidays,
  evening summary emails (sender name "Task Tracker"), and a pinned ChatGPT chat that adds tasks into the Admin sheet.

## Environment variables (Vercel)
`APPS_SCRIPT_URL` (the `/exec` URL), `API_SECRET` (from the sheet menu *Task System → Set up Vercel connection*), `TASK_MANAGER_PIN`.
The admin password and employee PINs are stored only as salted hashes in Script Properties. Redeploy Vercel after changing variables.

## Working on it
- Apps Script changes: paste into the bound project, then **Deploy → Manage deployments → Edit → New version** (keeps the URL).
  Version 19 was live on 5 Nov 2026 (recurring tasks).
- `tests/` - offline tests against a mock Apps Script (`cd tests && npm test`). Run before every PR.
- The Apps Script-hosted dashboard was removed (30 Oct 2026): Vercel is the only dashboard.
- A ChatGPT plugin (MCP + OAuth) was tried and removed (3 Nov 2026); the pinned ChatGPT chat in `docs/chatgpt-setup.md` is how tasks are added by chat.
- 19 Nov 2026: repo copied to GitHub z9mb83 with full history. If the Vercel project moves too, import it there and copy the three variables.

## Team (context for tasks)
Staff across Shaadi Bells, staffing and property work on content (reels, carousels, scripts), outreach and calling.
Manpreet Singh is Operations Head; Aryan is Head of Tech.

## Owner and how to work with him

- Owner: the 99 group of brands (99 Consulting / 99 Marketing Services). Brand codes used everywhere:
  **SB** Shaadi Bells · **99M** 99 Marketing Services · **99S** 99 Staffing Services · **PE** Property Experts Group · **SC** Skyline Capital (business buying/selling).
- The sheets, Apps Script projects and Gmail senders belong to the owner's main Google account (the 99 Marketing "linkwithmarketing" account).
- GitHub: this repo was copied with its full history from `linkwithmarketing-design/<repo>` to `z9mb83/<repo>` on 19 Nov 2026
  (a fresh copy, not a GitHub transfer). The old copy still exists; new work goes to **z9mb83**.
- The owner is not a programmer. Explain in plain words and give the result, not a list of steps you took.
- He wants a simple internal tool, not a product: only what he asks for, as little code and as few files as possible, no Docker or
  other maintenance-heavy setups. Keep old code (move it to `archive/`) instead of deleting it.
- **He does not pay for anything.** Free tiers only (Apps Script, Vercel Hobby, free Cloud Run/Cloud Shell use). No paid GitHub Actions/Codespaces.
- Update `README.md` (and `TROUBLESHOOTING.md` where there is one) with every change, in plain language.

### Hard rules (from the owner, always in force)
- Never commit or print secrets. Keys live in Apps Script **Script Properties**, **Vercel environment variables** or **Secret Manager** - never in code, git or normal sheet cells.
- Never put raw Meta access tokens, Google OAuth refresh tokens or SMS API secrets in spreadsheet cells.
- The owner types API keys, passwords and OAuth / device codes himself. Claude never does.
- No live emails, WhatsApp or SMS to real customers, no production campaign switched on, and no redeploy of the running email service or its scheduler without a separate, explicit go-live instruction.
- Never overwrite existing leads, statuses, approval values or formulas in the sheets. Never delete sheet tabs the automation reads.
- Never force-push or overwrite unrelated work. Work on a branch and open a pull request; **merge only when the owner says "merge"**.
- Do not rotate or destroy production credentials without his authorization.

### How changes usually reach production
Most logic runs in **Google Apps Script**, which is not connected to git. The usual loop (done through Claude in Chrome, signed in to the owner's main Google account):
1. Make the change in the repo file and test it offline (each repo has a `test/` or `tests/` folder).
2. Apply the same change in the Apps Script editor (exact text replacement in the editor, then the **Save project to Drive** button; reload to check it saved).
3. If the script is a web app: **Deploy → Manage deployments → Edit (pencil) → Version: New version → description → Deploy**. Editing the existing deployment keeps the `/exec` URL the same.
4. Commit, push the branch, open a PR, wait for "merge". The repo must always match what is live.
