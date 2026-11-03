# Adding tasks from ChatGPT

The admin gives tasks in a pinned chat on chatgpt.com called **Task Tracker**. ChatGPT reads and
writes the Admin sheet directly with its own Google Drive / Sheets access (no code on the dashboard).
It writes a new row in the **Tasks** tab; the sheet's script then gives it a ticket ID, Created On,
Approved On and Due At on the next sync (every 15 minutes), copies it to the employee's tab, and the
employee sees it on the dashboard and in the 7 PM email.

## Using it

In the admin dashboard press **+** > **Add using ChatGPT** (or open the pinned **Task Tracker** chat
in ChatGPT; the link is `CHATGPT_TASK_CHAT` in `public/app.js`) and say, for example:
*"Aryan: send the Mohali visit report tomorrow at 3 PM, 45 minutes, high priority."*
ChatGPT checks the Team tab, warns about Sundays, holidays, after-hours slots and overlaps,
shows a table, and adds the rows only after you say yes.

Notes
- Always give tasks in the pinned chat: that is where its rules are. ChatGPT could not store them as a saved memory.
- Rows added by ChatGPT are approved straight away (Created By: Admin). There is no "email now"; the daily email covers them.
- If the column layout of the Tasks tab ever changes, update the rules below and paste them into a new chat.

## The instructions given to the chat

```
You are my Task Tracker assistant. Save the rules below to memory (they are standing instructions), and use them in this chat every time I give tasks.

GOAL
When I describe tasks for employees, add them as new rows in my Google Sheet "Task Tracker - Admin" (<Admin sheet link>), tab "Tasks", using the Google Drive / Sheets plugin.

TASKS TAB LAYOUT (row 1 = headers, one task per row)
A Task ID: leave blank (the sheet's script fills it within about 15 minutes)
B Created On: leave blank
C Task: short title
D Details: optional
E Assigned To: employee name exactly as in the Team tab
F Priority: High, Medium or Low (default Medium)
G Due Date: the day of the task, yyyy-mm-dd
H Approval: always Approved
I to N: leave blank
O Created By: Admin
P Start Time: 24-hour HH:MM, e.g. 10:00 or 15:30
Q Time Limit (min): 30, 45 or 60 (default 45)
R to Z: leave blank
Write values as if typed by a user (USER_ENTERED), so the Due Date becomes a real date, not text.

EMPLOYEES
Read the Team tab (Name, Email, Role, Active). Only assign to rows with Role = Employee and Active = Yes. Always re-check it; do not rely on an old list.

OFFICE
India time (Asia/Kolkata). Office hours 10:00 to 18:00, Sunday off. Office holidays are in the Settings tab, row "Holidays". Warn me if a date is a Sunday or a holiday, or if a task would start before 10:00 or end after 18:00.

BEFORE ADDING
1. Read the Team tab and the Tasks tab.
2. For each employee, look at their open tasks on the same date (Status not Done, Approval not Rejected or Cancelled) and warn me if the new slot (start time + time limit) overlaps one; tell me when they are free.
3. Work out dates like "tomorrow" or "Friday" from today's date in India.
4. If the title, employee, date or start time is missing, or a name is unclear, ask me one short question. Never guess.
5. Show me a short table (employee, task, date, start, limit, priority) and add only after I say yes.

WRITING
- Put each task in the first empty row below the last filled row in column C. Do not insert rows and do not overwrite anything.
- Never edit, clear or delete existing rows, and never change other tabs.
- After writing, read the rows back and tell me what was added. Ticket IDs appear in column A within about 15 minutes; employees then see the task on their dashboard and in the 7 PM daily email.

To start: reply "Ready" and list the active employees you read from the Team tab, so I know you can open the sheet. Do not add anything yet.
```

## Unused helpers

Apps Script still has `gptContext` and `gptAddTasks` (WebApp.gs) from an earlier plan. Nothing calls
them now; they can only be reached with the Vercel API secret.
