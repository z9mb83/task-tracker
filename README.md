# Task Tracker

A ticketing system for a small team, built on Google Sheets and Google Apps Script.

- **Admins** add tasks, assign them to employees and approve them.
- **Task managers** add and edit tasks; the admin approves them by email or on the dashboard.
- **Employees** see only their approved tasks and update status, progress and remarks.
- **Everyone** gets a daily email. Employees get their open tasks; admins get a summary.
- **Web dashboard on Vercel** with a password-protected admin page (`/admin`) and a PIN login for employees (`/`).

Google Sheets is the database and Apps Script does the work. Vercel (free plan is enough) only hosts the dashboard pages and a small proxy function.

## How it fits together

```
Task Tracker - Admin (Google Sheet)          Task Tracker - Employees (Google Sheet)
  Tasks      <- master list of all tasks       one tab per employee
  Team       <- employees and admins           (only Status / Progress / Remarks editable)
  Settings   <- email time, sync interval            ^
  Dashboard  <- live counts                          |
       |                                             |
       +---- Apps Script (bound to Admin sheet) -----+
               - every 15 min: push approved tasks, pull employee updates
               - on approval: push immediately
               - daily: email employees and admins
               - JSON API (doPost), protected by a shared secret
                     ^
                     |  POST {key, fn, args}
Vercel  /api/rpc  ---+   (adds the secret; browser never sees it)
        /admin          <- admin dashboard (password)
        /task-manager   <- task manager dashboard (name + shared PIN)
        /approve        <- confirm page for approve/reject links in admin emails
        /               <- employee dashboard (email + PIN)
```

The Admin sheet is the single source of truth. Employees write only to their own
tab (in the sheet or through the dashboard), and the script copies their updates back.

## Files

| File | What it is |
|---|---|
| `apps-script/Code.gs` | Sync between the two sheets, daily emails, sheet menu, employee tab setup and protection |
| `apps-script/WebApp.gs` | Dashboard backend: logins, admin and employee actions |
| `apps-script/Api.gs` | JSON API that the Vercel dashboard calls |
| `apps-script/appsscript.json` | Project manifest (IST time zone, web app settings) |
| `public/` | Vercel dashboard pages (`index.html` employees, `admin.html` admin) |
| `api/rpc.js` | Vercel function that forwards dashboard calls to Apps Script |
| `vercel.json` | Clean URLs, security headers |
| `docs/sheet-structure.md` | Columns of every tab |

## Setup

### 1. Sheets
Create two Google Sheets, **Task Tracker - Admin** and **Task Tracker - Employees**, with the tabs and
columns in `docs/sheet-structure.md`. In the Admin sheet's **Settings** tab, put the Employees sheet's
ID (the long string in its URL) next to `Employee sheet ID`.

### 2. Script
1. In the Admin sheet: **Extensions > Apps Script**.
2. Replace `Code.gs` with `apps-script/Code.gs`.
3. **+ > Script**, name it `WebApp`, paste `apps-script/WebApp.gs`.
4. **+ > Script**, name it `Api`, paste `apps-script/Api.gs`.
5. Project Settings (gear icon): set the time zone to **(GMT+05:30) India Standard Time**.
6. Save. Pick `setup` in the function dropdown and click **Run**. Approve the permissions
   (on personal Gmail: Advanced > Go to project > Allow).

### 3. Apps Script web app (the API)
1. In Apps Script: **Deploy > New deployment > Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (needed so Vercel can call it; every call still needs the secret)
2. Copy the web app URL (ends in `/exec`).
3. In the Admin sheet: **Task System > Set up Vercel connection**. It shows `APPS_SCRIPT_URL` and a new
   `API_SECRET`. Copy both.
4. **Task System > Set dashboard admin password**.

After changing the Apps Script code later, use **Deploy > Manage deployments > Edit > Version: New version**
so the `/exec` URL keeps working.

### 4. Vercel
1. On vercel.com: **Add New > Project**, import this GitHub repo. Framework preset: **Other**. No build command.
2. Add Environment Variables: `APPS_SCRIPT_URL` and `API_SECRET` (from step 3), and `TASK_MANAGER_PIN`
   (the shared PIN for task managers; it is stored only in Vercel).
3. Deploy. Your links:
   - Admin: `https://<project>.vercel.app/admin`
   - Employees: `https://<project>.vercel.app/`
4. Open `/admin`, go to **Team**, and add employees. Each gets a 6-digit PIN to share with the employee link.

If you change the env vars later, redeploy from the Vercel dashboard so they take effect.

## Security notes

- The admin password and employee PINs are stored only as salted SHA-256 hashes in Script Properties.
- After 5 wrong attempts, logins for that account are locked for 15 minutes.
- Sessions expire after 8 hours.
- Approve/reject links in emails are signed with the API secret, expire after 7 days, and open a confirm page (so email link scanners can't approve anything).
- The task manager PIN never reaches the browser or the sheet: Vercel checks it and tells Apps Script only whether it matched.
- The web app runs as the sheet owner, so keep the Admin sheet shared with admins only.
- Employees can edit only columns G to I on their own tab in the Employees sheet.
- The Apps Script URL and API secret live only in Vercel env vars; the browser talks to `/api/rpc`, which only allows the dashboard's own actions.
- This repo contains no sheet IDs, passwords, secrets or emails.

## Daily use

| Who | Where | What |
|---|---|---|
| Admin | Dashboard > New task | Pick employee, priority, due date. Tick "Approve now" to send it straight away. |
| Task manager | `/task-manager` | Add tasks (they go to the admin for approval), edit or cancel any task. |
| Admin | Email or Dashboard > Approvals | Approve & send now, Approve (evening summary), Hold or Reject. |
| Admin | Dashboard > Team | Add or deactivate people, reset PINs. |
| Employee | Dashboard or their sheet tab | Set status, progress and remarks. |
| Everyone | Email, daily at the hour in Settings | Open tasks and summary. |
