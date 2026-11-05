# Sheet structure

## Task Tracker - Admin

### Tasks
| Col | Header | Filled by |
|---|---|---|
| A | Task ID | Script (T-0001, T-0002 ...) |
| B | Created On | Script |
| C | Task | Admin |
| D | Details | Admin |
| E | Assigned To | Admin (dropdown from Team!A) |
| F | Priority | Admin (High / Medium / Low) |
| G | Due Date | Admin |
| H | Approval | Admin (Pending / Approved / Rejected / On Hold / Cancelled) |
| I | Approved On | Script |
| J | Status | Employee, via script (Not Started / In Progress / Blocked / Done) |
| K | Progress % | Employee, via script |
| L | Employee Remarks | Employee, via script |
| M | Last Updated | Script |
| N | Completed On | Script |
| O | Created By | Dashboard (Admin, or the task manager's name) |
| P | Start Time | Admin / task manager (e.g. 11:00) |
| Q | Time Limit (min) | Admin / task manager (30, 45 or 60; default 45) |
| R | Due At | Script: date + start time + time limit |
| S | Started At | Script: when the employee first sets In Progress |
| T | Time Taken (min) | Script: Done time minus Started At (or the scheduled start) |
| U | Change Request | Script: pending change/cancel request from a task manager (JSON) |
| V | Reopened | Script: log of admin reopens |
| W | Links | Employee, via dashboard: work links (Drive, Canva, screenshots), one per line |
| X | Reviewed By | Dashboard: task manager or Admin who accepted the Done ticket (empty = awaiting review) |
| Y | Reviewed On | Dashboard: when it was accepted |
| Z | Review Notes | Dashboard: log of reviews and send-backs with notes |

### Team
| Col | Header | Values |
|---|---|---|
| A | Name | Also the employee's tab name in the Employees sheet |
| B | Email | Gets the daily email and sheet access |
| C | Role | Employee / Admin |
| D | Active | Yes / No |
| E | Notes | Free text |

### Settings
| Setting (col A) | Value (col B) |
|---|---|
| Employee sheet ID | ID from the Employees sheet URL |
| Admin emails | Comma-separated, get the daily summary |
| Daily email hour | 0-23, IST |
| Sync every (minutes) | 5, 10, 15 or 30 |
| Keep done tasks visible (days) | Days a Done task stays on the employee tab |
| Send employee emails | Yes / No |
| Company name | Shown in email subjects and the dashboard |
| Dashboard URL | Vercel link used in emails |
| Approval emails | Where task-manager tasks needing approval are emailed (falls back to Admin emails) |
| Sender name | Name shown as the sender on every email (default: Task Tracker) |
| Offices | `Mohali: 30.687737, 76.737623; Chandigarh: 30.734315, 76.787665` (name: latitude, longitude; `;` between offices) |
| Office radius (m) | Default 150 |
| Location check | Block / Flag only |
| Office start / Office end | 10:00 / 18:00 |
| Buffer (min) | 20 |
| Weekly off | Sunday (or e.g. "Saturday, Sunday") |
| Holidays | Comma separated: `2026-11-08: Diwali, 2026-12-25: Christmas`. Normally managed from the dashboard's Attendance tab |

### Attendance
One row per employee per day, written by the dashboard.

| Col | Header |
|---|---|
| A | Date (yyyy-MM-dd) |
| B | Employee |
| C / D | Check In / Check Out |
| E / F | Worked (min) / Worked (h min) |
| G | Late (Yes / No) |
| H | Flags: Left early, Auto check-out, Outside office |
| I / J | In Photo / Out Photo (Drive links; "Deleted" after cleanup) |
| K / L | In / Out distance from the nearest office (m) |
| M / N | In / Out office (Mohali / Chandigarh) |

### Dashboard
Formulas only: pending approval, overdue, done today, and a per-employee table.

## Task Tracker - Employees

- **How to use** tab with instructions (read only).
- One tab per active employee, created by the script, columns:
  Task ID, Task (with time limit), Details, Priority, Due (date + time), Assigned On, **Status**, **Progress %**, **Remarks**.
  Only the bold columns are editable, and only by that employee.
- **Recurring** tab (created with the first repeating task): Rule ID, Active (Yes/No), Task, Details, Assigned To, Priority,
  Repeat (Daily / Weekly / Monthly), Days (weekly: `Mon, Thu`; monthly: day number), Start Time, Time Limit (min),
  Starts On, Ends On (optional), Last Created, Last Result, Created On. Edit rules from the dashboard; Active = No pauses a rule.
