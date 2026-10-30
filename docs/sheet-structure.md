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

### Dashboard
Formulas only: pending approval, overdue, done today, and a per-employee table.

## Task Tracker - Employees

- **How to use** tab with instructions (read only).
- One tab per active employee, created by the script, columns:
  Task ID, Task, Details, Priority, Due Date, Assigned On, **Status**, **Progress %**, **Remarks**.
  Only the bold columns are editable, and only by that employee.
