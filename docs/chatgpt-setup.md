# Task Tracker in ChatGPT

The admin talks to a custom GPT. It asks for any missing details, shows a summary, and on
approval adds the tasks to the Admin sheet for the right employee, exactly as the dashboard does.
The GPT never sees the sheet directly; it calls two endpoints on your dashboard (`/api/gpt/*`).

## 1. Set the key in Vercel

1. Make a long random key (for example `openssl rand -hex 32`).
2. Vercel > your project > Settings > Environment Variables: add **GPT_API_KEY** with that value.
3. Redeploy. Keep this key private; anyone with it can add tasks.

## 2. Create the custom GPT (ChatGPT, paid plan)

1. ChatGPT > Explore GPTs > **Create**, then **Configure**.
2. Name: `Task Tracker`. Description: `Adds tasks for employees to the office task sheet.`
3. **Instructions**: paste the text in section 4 below.
4. **Actions** > **Create new action**:
   - Schema: paste the whole of `docs/chatgpt-action.yaml`, after replacing `YOUR-DASHBOARD.vercel.app` with your dashboard domain.
   - Authentication: **API Key**, Auth Type **Bearer**, and paste the `GPT_API_KEY` value.
5. Save, and set **Only me** (or share only with the admins) under Share.

## 3. Use it

Say something like: *"Tell Aryan to send the Mohali visit report by 5 PM tomorrow, 45 minutes, starting 3 PM."*
The GPT checks names and dates, shows you the tasks, and adds them only after you confirm.
Each task appears in the sheet as approved with its own ticket ID, and the employee gets it in the daily email.

## 4. Instructions to paste into the GPT

```
You add tasks for employees in the office Task Tracker. Use the Actions only.

Before anything else, call getContext to get today's date and the exact employee names.

For each task you need: a short title, the employee (must match a name from getContext),
a due date (yyyy-MM-dd), and a start time (24-hour HH:MM). Work out "tomorrow", "Friday" and
similar from today's date. If a detail is missing or the employee name is unclear, ask one
short question. Do not guess names or dates.

Defaults if the admin does not say: 45-minute limit, Medium priority, no details, sendNow false.

Before adding anything, show the admin a short list of the tasks (employee, title, due, start, limit)
and wait for a clear yes. Then call addTasks once with all the tasks.

Report the result: for each task, the ticket ID, or the reason it failed. Keep replies short.
Never add tasks the admin did not ask for. Do not change or delete existing tasks; you can only add.
```

## Notes

- Tasks from the GPT are approved immediately, like an admin's own tasks.
- The GPT can only add tasks. Holidays, employees, and attendance stay in the dashboard.
- To stop access, delete the **GPT_API_KEY** variable in Vercel (or change it) and redeploy.
