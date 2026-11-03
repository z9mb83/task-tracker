# Task Tracker

A ticketing system for a small team, built on Google Sheets and Google Apps Script.

- **Admins** add tasks, assign them to employees and approve them.
- **Tickets are timed:** each task has a date, start time and a 30 / 45 / 60 min limit. Employees see a live countdown; admins see time taken vs limit.
- **Editing rules:** Pending tasks can be edited by admin and task managers. Approved tasks can be edited directly by the admin; task managers send a change (or cancel) request that the admin approves by email or on the dashboard. Done, Rejected and Cancelled tasks are locked (the admin can Reopen a Done task). The employee is emailed when an approved task's date, time, limit or assignee changes, or it is cancelled.
- **Dashboards refresh themselves** every minute (and when you return to the tab), without interrupting an open form.
- **Task managers** add and edit tasks; the admin approves them by email or on the dashboard.
- **Employees** see only their approved tasks and update status, progress, remarks and **work links** (Drive folders, Canva designs, screenshots). A ticket is locked once marked Done.
- **Emails** (sender name "Task Tracker"): instant "Send now" emails, approval requests with Approve / Reject buttons, a PIN welcome email for new employees, and an evening summary (employees get tomorrow's list; admins get a summary).
- **Web dashboard on Vercel** with a sign-in page for three roles, a password-protected admin page, a task manager page and an employee page. Works on phones.

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
        /               <- "Sign in as" page: Admin / Task manager / Employee
        /admin          <- admin dashboard (password)
        /task-manager   <- task manager dashboard (name + shared PIN)
        /approve        <- confirm page for approve/reject links in admin emails
        /employee       <- employee dashboard (email + PIN)
```

The Admin sheet is the single source of truth. Employees write only to their own
tab (in the sheet or through the dashboard), and the script copies their updates back.

## Files

| File | What it is |
|---|---|
| `apps-script/Code.gs` | Sync between the two sheets, daily emails, sheet menu, employee tab setup and protection |
| `apps-script/WebApp.gs` | Dashboard backend: logins, admin and employee actions |
| `apps-script/Attendance.gs` | Check in / out with selfie + location, Attendance tab, auto check-out, photo cleanup |
| `apps-script/Api.gs` | JSON API that the Vercel dashboard calls |
| `apps-script/appsscript.json` | Project manifest (IST time zone, web app settings) |
| `public/index.html` | "Sign in as" page (Admin / Task manager / Employee) |
| `public/admin.html`, `task-manager.html`, `employee.html` | Dashboard pages (all use `app.js` + `style.css`) |
| `public/approve.html` | Confirm page for the Approve / Reject buttons in admin emails |
| `api/rpc.js` | Vercel function that forwards dashboard calls to Apps Script and checks the task manager PIN |
| `api/mcp.js`, `api/oauth/*.js`, `lib/oauth.js`, `lib/apps.js` | ChatGPT plugin: MCP server (get date and employees, add tasks) with admin-password sign-in (OAuth) |
| `docs/chatgpt-setup.md` | How to connect the ChatGPT plugin |
| `vercel.json` | Clean URLs, security headers |
| `docs/sheet-structure.md` | Columns of every tab and every Settings row |
| `tests/` | Offline tests: dashboard flows against a mock Apps Script, and ticket timing logic |

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
   (the shared PIN for task managers; it is stored only in Vercel). For ChatGPT, see `docs/chatgpt-setup.md`
   (no extra variables needed).
3. Deploy. Your links:
   - Everyone: `https://<project>.vercel.app/` (choose Admin, Task manager or Employee)
   - Direct links: `/admin`, `/task-manager`, `/employee`
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
| Admin | Dashboard > + or New task | Pick employee, priority, date, start time and 30 / 45 / 60 min limit. "Approve & send now" emails the employee; "Approve, add to daily summary" waits for the evening email. |
| Task manager | `/task-manager` | Add tasks (they go to the admin for approval), edit or cancel any task. |
| Admin | Email, Overview (top card) or Approvals | Approve & send now, Approve (evening summary), Hold or Reject. |
| Admin | Dashboard > Team | Add (PIN is emailed), deactivate, reset PIN, or remove people (deletes PIN, email and sheet access). |
| Task manager / Admin | Overview > "Done, waiting for your review" | Every Done ticket waits for review: Reviewed ✓, or Send back with a note (reopens it, emails the employee, keeps the time worked). |
| Employee | `/employee` or their sheet tab | Set status, progress and remarks; see a live countdown. Done locks the ticket. |
| Employee | `/employee`, top card | Check in / Check out with a selfie, at the office. Shows hours worked so far. |
| Admin | Dashboard > Attendance | Who's in today (with photos), monthly hours, late / left early / auto check-out. |
| Everyone | Email, daily at the hour in Settings | Open tasks and summary (admin summary includes attendance). |

## Settings you may want to change (Admin sheet > Settings)

| Setting | What it does |
|---|---|
| Daily email hour | When the evening summary goes out (IST) |
| Admin emails | Who gets the admin summary |
| Approval emails | Who gets task-manager approval requests |
| Sender name | Name shown on every email |
| Dashboard URL | Your Vercel link, used in emails |
| Offices | `Mohali: 30.687737, 76.737623; Chandigarh: 30.734315, 76.787665`. Check-in works at any of them and is tagged with the office |
| Office radius (m) | How close to an office a check-in must be (default 150) |
| Location check | Block (default) or Flag only |
| Weekly off | Used for working days and leaves in the monthly report (default: Sunday) |
| Holidays | Office holidays and festivals. Add or remove them in the dashboard's **Attendance** tab (admin); holidays are not working days or leaves |
| Office start / end, Buffer (min) | 10:00 / 18:00 / 20: late after 10:20, left early before 5:40, auto check-out 6:20 PM |

## Notes

- Each employee needs their own email; it is their login and their sheet access. For testing with one
  inbox, use Gmail plus-addresses (`you+aryan@gmail.com`, `you+riya@gmail.com`).
- Free Gmail accounts can email about 100 recipients a day from scripts.

## Running the tests

```
cd tests
npm install
npm test
```

The tests run the real dashboard code in a headless DOM against a mock Apps Script (including Google's
POST-then-redirect behaviour), and check the due-time and time-taken calculations from `Code.gs`.

## Attendance

- Employees check in from the top of `/employee` with a selfie (check-out is one tap, no photo). Both need the
  phone to be within the office radius. Allow camera and location for the site when asked.
- Photos are saved in Google Drive: **Task Tracker Attendance / Employee / yyyy-MM** (private to the owner).
  Admins see them in the dashboard. Each month's photos go to Drive's trash on the **15th of the next month**
  (October photos on 15 November); the Attendance tab keeps the times and marks the photos "Deleted".
- Late = check-in after 10:20. Left early = check-out before 5:40. Anyone not checked out by 6:20 PM is
  auto checked out at 6:20 PM (flagged). Check-in is closed after 6:20 PM.
- Monthly report (Dashboard > Attendance): working days so far, present, leaves, attendance %, late, left early,
  hours, plus a calendar per employee and a CSV download. A working day with no check-in counts as a leave;
  days before an employee's first check-in are not counted.
