# Task Tracker

A ticketing system for a small team, built on Google Sheets and Google Apps Script.

- **Admins** add tasks, assign them to employees and approve them.
- **Employees** see only their approved tasks and update status, progress and remarks.
- **Everyone** gets a daily email. Employees get their open tasks; admins get a summary.
- **Web dashboard** with a password-protected admin page and a PIN login for employees.

No servers or paid hosting. Everything runs inside your Google account.

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
               - web app: admin + employee dashboards
```

The Admin sheet is the single source of truth. Employees write only to their own
tab (in the sheet or through the dashboard), and the script copies their updates back.

## Files

| File | What it is |
|---|---|
| `apps-script/Code.gs` | Sync between the two sheets, daily emails, sheet menu, employee tab setup and protection |
| `apps-script/WebApp.gs` | Dashboard backend: logins, admin and employee actions |
| `apps-script/Index.html` | Dashboard page (admin and employee views) |
| `apps-script/appsscript.json` | Project manifest (IST time zone, web app settings) |
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
4. **+ > HTML**, name it `Index` (exactly), paste `apps-script/Index.html`.
5. Project Settings (gear icon): set the time zone to **(GMT+05:30) India Standard Time**.
6. Save. Pick `setup` in the function dropdown and click **Run**. Approve the permissions
   (on personal Gmail: Advanced > Go to project > Allow).

### 3. Dashboard
1. In Apps Script: **Deploy > New deployment > Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
2. Copy the web app URL.
   - Employees: `<URL>`
   - Admin: `<URL>?page=admin`
3. Back in the Admin sheet: **Task System > Set dashboard admin password**.
4. Add employees from the dashboard's **Team** tab. Each one gets a 6-digit PIN. Share it with them
   together with the employee URL.

After changing the code later, use **Deploy > Manage deployments > Edit > Version: New version**
so the same URL serves the new code.

## Security notes

- The admin password and employee PINs are stored only as salted SHA-256 hashes in Script Properties.
- After 5 wrong attempts, logins for that account are locked for 15 minutes.
- Sessions expire after 8 hours.
- The web app runs as the sheet owner, so keep the Admin sheet shared with admins only.
- Employees can edit only columns G to I on their own tab in the Employees sheet.
- This repo contains no sheet IDs, passwords or emails. Those live in the sheets and Script Properties.

## Daily use

| Who | Where | What |
|---|---|---|
| Admin | Dashboard > New task | Pick employee, priority, due date. Tick "Approve now" to send it straight away. |
| Admin | Dashboard > Approvals | Approve, hold or reject tasks added by other admins in the sheet. |
| Admin | Dashboard > Team | Add or deactivate people, reset PINs. |
| Employee | Dashboard or their sheet tab | Set status, progress and remarks. |
| Everyone | Email, daily at the hour in Settings | Open tasks and summary. |
