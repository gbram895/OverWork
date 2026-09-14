# Automatic overtime logging (iPhone Shortcuts + Google Sheets)

Two location-triggered Shortcuts automations (arrive at work / leave work) ping a
Google Apps Script webhook, which logs the punch to a Sheet and, on "leave,"
computes hours worked outside your standard workday and appends them to an
"Overtime" tab.

Nothing here needs installing on your computer — the script lives in your own
Google Drive and the automation lives in the Shortcuts app on your phone.

## 1. Create the Sheet + script

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank
   spreadsheet. Name it something like "OverWork Ledger".
2. **Extensions > Apps Script**. Delete the boilerplate `myFunction` code and
   paste in the contents of [`apps-script/Code.gs`](./apps-script/Code.gs).
3. Save the script (Ctrl/Cmd+S), then reload the Google Sheet tab in your
   browser. A new **OverWork** menu should appear next to Extensions.
4. Click **OverWork > Run setup**. The first run will ask you to authorize
   the script (it only touches this one spreadsheet) — approve it, then run
   **Run setup** again if the alert didn't show.
5. Open the new **Config** tab in the sheet and copy the **Webhook Token**
   value — you'll paste it into Shortcuts below. The Config tab also shows
   your standard hours for each day of the week (default: Monday–Thursday
   08:00–16:30, Friday 08:00–15:00, weekends not a workday). To change these,
   edit the `SCHEDULE_JSON` script property under **Project Settings > Script
   Properties** in the Apps Script editor — it's a JSON object keyed `"0"`
   (Sunday) through `"6"` (Saturday), each value `"HH:MM-HH:MM"`; omit a day
   entirely to make any time logged that day count fully as overtime. Re-run
   setup afterward so the Config tab reflects the change.

## 2. Deploy it as a web app

1. In the Apps Script editor: **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me**, **Who has access: Anyone** (this is what lets your
   phone reach it — the webhook token is what keeps it private, so keep that
   token secret).
4. Click **Deploy**, authorize again if prompted, and copy the **Web app
   URL** — you'll need it in Shortcuts.

## 3. Set up the Shortcuts automations on your iPhone

Create two **personal automations** (Shortcuts app > Automation tab > "+" >
Create Personal Automation):

### "Arrive at Work"

1. Trigger: **Arrive** > choose your work location (set a sensible radius).
2. Turn off **"Ask Before Running"** so it fires silently in the background.
3. Add action **Get Contents of URL**:
   - URL: the web app URL from step 2 above
   - Method: `POST`
   - Headers: `Content-Type` = `application/json`
   - Request Body: **JSON**, with fields:
     - `token`: your webhook token from the Config tab
     - `event`: `arrive`
     - `timestamp`: add a **Format Date** action above (Date Format: **ISO 8601**, input: Current Date) and reference its output here

### "Leave Work"

Same as above, but trigger on **Leave** your work location, and set
`event` to `leave`.

## What you get

- A **Punches** tab with a raw log of every arrive/leave ping.
- An **Overtime** tab that only gets a new row when a leave is later (or an
  arrive is earlier) than your standard workday — with date, arrive/leave
  times, total hours worked, and the overtime portion. The early+late total
  has to reach a full 15 minutes to count at all, and only counts in whole
  15-minute blocks after that (rounded down, not to the nearest) — e.g. 13
  minutes early counts as 0, but 20 minutes early plus 46 minutes late (66
  total) counts as 1 hour, not 1h06.
- A live dashboard: open the **web app URL** from step 2 in any browser (or
  add it to your iPhone home screen for an app-like icon) to see three
  balances — **vacation days**, **ADV hours**, and **overtime hours** — plus
  overtime history and the Belgian holidays still coming up this year.
- A daily check (7pm) that emails you if a day that should've been a workday
  passes with no arrival logged, so you can say what actually happened.

If you already deployed before these features existed, you'll need to push
the updated script: **Deploy > Manage deployments**, pick the pencil icon on
your existing deployment, set **Version: New version**, and **Deploy** again
(the URL stays the same). Editing the code alone doesn't update a live
deployment — it has to be redeployed. Re-running **OverWork > Run setup**
afterward will also ask you to re-authorize, this time for permission to
send email (that's the daily check) — approve it.

## Vacation, ADV, and overtime balances

- **Vacation**: 20 days/year by default, plus one extra day for every
  Belgian public holiday that falls on a weekend that year (e.g. 2026 has
  two — Aug 15 and Nov 1 — so the 2026 total is 22).
- **ADV**: 24 hours/year by default ("Aanvullende Vrije Dagen" / ADV
  compensation hours).
- **Overtime**: whatever's been auto-logged to the Overtime tab, minus
  whatever you've used.

Change the yearly amounts via the `VACATION_DAYS_PER_YEAR` / `ADV_HOURS_PER_YEAR`
script properties (**Project Settings > Script Properties**), then re-run setup.

Belgium's 10 national holidays (Nieuwjaar, Paasmaandag, Dag van de Arbeid,
O.L.H. Hemelvaart, Pinkstermaandag, Nationale feestdag, O.L.V. Hemelvaart,
Allerheiligen, Wapenstilstand, Kerstmis) are calculated automatically each
year — including the Easter-based ones — so you're never expected to work on
them, and the daily check skips them too.

## The daily "were you at work" check

Every evening at 7pm, the script checks whether today was a scheduled
workday (per your weekday hours) that wasn't a Belgian holiday, and whether
any arrival was actually logged. If not, it emails you a choice of four
links:

- **I worked** (you forgot to trigger Shortcuts — no balance is touched)
- **Use a vacation day** (−1 vacation day)
- **Use ADV hours** (−that day's scheduled hours from your ADV balance)
- **Use overtime** (−that day's scheduled hours from your overtime balance)

Each link opens a confirmation page first — nothing is recorded until you
tap **Confirm** there, so the email client merely opening a link preview
won't accidentally log anything. Every day only gets asked about once; once
resolved it's added to the **Absences** tab and won't be asked again.

This runs independently of the [OverWork Ledger artifact](../README.md) (which
is a manual, browser-only log) — think of the Sheet as the automatic record
and the artifact as the quick manual one for anything the location trigger
misses (e.g. working late from home).

## Troubleshooting

- **Nothing shows up in the Sheet**: open the Apps Script editor's
  **Executions** panel (left sidebar) to see recent runs and any errors.
- **`Invalid or missing token`**: the token in your Shortcut doesn't match
  the Config tab — re-copy it.
- **Overtime tab stays empty but Punches has both an arrive and a leave**:
  the leave has to arrive *after* the matching arrive on the same calendar
  day, and only the portion outside that day's standard window counts as
  overtime — a normal, on-schedule day correctly logs 0. Also check the
  Config tab shows the schedule you expect for that day of the week.
- **No daily email arrives**: open the Apps Script editor's **Triggers**
  panel (clock icon, left sidebar) and confirm a `checkForMissingDay` trigger
  exists — if not, re-run **OverWork > Run setup**, which installs it. Also
  check the **Executions** panel for errors (a missing "send email" scope
  authorization is the most common cause — re-run setup and approve it).
- **Balances look wrong**: they're scoped to the calendar year in the URL
  (`?year=2026`, defaulting to the current year) — double check you're not
  comparing across years, and that the Absences tab has the entries you
  expect.
