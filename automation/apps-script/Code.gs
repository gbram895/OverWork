/**
 * OverWork auto-logger.
 *
 * Receives "arrive" / "leave" pings (e.g. from an iPhone Shortcuts location
 * automation) and logs them to a "Punches" sheet. Whenever a "leave" ping
 * is matched to the same day's "arrive" ping, the hours worked outside the
 * standard workday window are computed and appended to an "Overtime" sheet.
 *
 * Setup:
 *   1. Create a Google Sheet, open Extensions > Apps Script, paste this file in.
 *   2. Reload the sheet, use the "OverWork" menu > "Run setup".
 *   3. Deploy > New deployment > Web app > Execute as Me > Who has access: Anyone.
 *   4. Copy the webhook token from the "Config" tab and the deployment URL
 *      into your Shortcuts automations.
 */

const SHEET_PUNCHES = 'Punches';
const SHEET_OVERTIME = 'Overtime';
const SHEET_CONFIG = 'Config';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('OverWork')
    .addItem('Run setup', 'setup')
    .addToUi();
}

function setup() {
  const props = PropertiesService.getScriptProperties();

  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('TOKEN', token);
  }
  if (!props.getProperty('STANDARD_START')) props.setProperty('STANDARD_START', '09:00');
  if (!props.getProperty('STANDARD_END')) props.setProperty('STANDARD_END', '17:00');

  getOrCreateSheet(SHEET_PUNCHES, ['Timestamp', 'Event', 'Matched']);
  getOrCreateSheet(SHEET_OVERTIME, ['Date', 'Arrive', 'Leave', 'Hours Worked', 'Overtime Hours', 'Notes']);

  const config = getOrCreateSheet(SHEET_CONFIG, ['Key', 'Value']);
  config.getRange('A2:B4').setValues([
    ['Webhook Token', token],
    ['Standard Start', props.getProperty('STANDARD_START')],
    ['Standard End', props.getProperty('STANDARD_END')],
  ]);

  try {
    SpreadsheetApp.getUi().alert(
      'Setup complete. Copy the webhook token from the Config tab, then deploy this ' +
        'script as a web app (Deploy > New deployment > Web app) and use that URL in Shortcuts.'
    );
  } catch (e) {
    // getUi() is unavailable when setup() is run from the script editor directly
    // rather than the sheet's menu — that's fine, the Config tab still has the token.
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.format === 'json') {
    return jsonResponse({ ok: true, message: 'OverWork webhook is running.' });
  }
  return renderDashboard();
}

function renderDashboard() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_OVERTIME);
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
  const tz = Session.getScriptTimeZone();
  const monthPrefix = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  let totalOvertime = 0;
  let monthOvertime = 0;

  const entries = rows
    .map(function (r) {
      const date = String(r[0]);
      const overtimeHours = Number(r[4]) || 0;
      totalOvertime += overtimeHours;
      if (date.indexOf(monthPrefix) === 0) monthOvertime += overtimeHours;
      return {
        date: date,
        arrive: formatTime(r[1], tz),
        leave: formatTime(r[2], tz),
        hoursWorked: Number(r[3]) || 0,
        overtimeHours: overtimeHours,
        notes: String(r[5] || ''),
      };
    })
    .sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

  const rowsHtml = entries.length
    ? entries
        .map(function (row) {
          return (
            '<tr><td class="mono">' +
            esc(row.date) +
            '</td><td class="mono">' +
            esc(row.arrive) +
            '–' +
            esc(row.leave) +
            '</td><td class="mono">' +
            row.hoursWorked.toFixed(2) +
            '</td><td class="mono ot">' +
            row.overtimeHours.toFixed(2) +
            '</td><td>' +
            esc(row.notes) +
            '</td></tr>'
          );
        })
        .join('')
    : '<tr><td colspan="5" class="empty">No overtime logged yet.</td></tr>';

  const html = `<!DOCTYPE html>
<html>
<head>
<base target="_top">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OverWork Ledger</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>
  :root {
    --bg: #E9ECE3; --surface: #FBFBF8; --surface-alt: #F0F2E9;
    --ink: #1C2420; --ink-soft: #5B665A; --ink-faint: #8B9488;
    --line: #D2D7C7; --line-strong: #B7BEA9; --accent: #A9662A;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14170F; --surface: #1C2017; --surface-alt: #23281B;
      --ink: #ECEEE4; --ink-soft: #AAB29E; --ink-faint: #737B6B;
      --line: #343A28; --line-strong: #454C34; --accent: #E0A159;
    }
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", system-ui, sans-serif; margin: 0; padding: 28px 16px 60px; }
  .page { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  h1 { font-family: "IBM Plex Serif", Georgia, serif; font-size: 24px; margin: 0; }
  .mark { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 2px 6px; }
  .tagline { font-size: 13px; color: var(--ink-soft); margin: 4px 0 20px; }
  .ledger-strip { display: flex; gap: 28px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 16px 20px; margin-bottom: 22px; }
  .stat-value { display: block; font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 600; }
  .stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-faint); }
  .ledger-body { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
  .ledger-body h2 { font-family: "IBM Plex Serif", Georgia, serif; font-size: 16px; margin: 0 0 12px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); font-weight: 500; padding: 0 8px 6px; border-bottom: 1px solid var(--line-strong); }
  td { padding: 8px; border-bottom: 1px solid var(--line); }
  tr:nth-child(even) td { background: var(--surface-alt); }
  .mono { font-family: "IBM Plex Mono", monospace; white-space: nowrap; }
  .ot { color: var(--accent); font-weight: 600; }
  .empty { text-align: center; color: var(--ink-faint); padding: 20px 0; }
  footer { text-align: center; font-size: 11.5px; color: var(--ink-faint); margin-top: 16px; }
</style>
</head>
<body>
<div class="page">
  <div class="brand"><h1>OverWork</h1><span class="mark">Live Ledger</span></div>
  <p class="tagline">Auto-logged from your Shortcuts automations.</p>
  <div class="ledger-strip">
    <div><span class="stat-value">${totalOvertime.toFixed(1)}</span><span class="stat-label">Total overtime hours</span></div>
    <div><span class="stat-value">${monthOvertime.toFixed(1)}</span><span class="stat-label">This month</span></div>
    <div><span class="stat-value">${entries.length}</span><span class="stat-label">Entries logged</span></div>
  </div>
  <section class="ledger-body">
    <h2>History</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>Date</th><th>Arrive–Leave</th><th>Worked</th><th>Overtime</th><th>Notes</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </section>
  <footer>Reload any time — this always reads the live sheet.</footer>
</div>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html).setTitle('OverWork Ledger');
}

function formatTime(d, tz) {
  return d instanceof Date ? Utilities.formatDate(d, tz, 'HH:mm') : '';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TOKEN');
    const standardStart = props.getProperty('STANDARD_START') || '09:00';
    const standardEnd = props.getProperty('STANDARD_END') || '17:00';

    if (!e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Missing request body' });
    }
    const body = JSON.parse(e.postData.contents);

    if (!token || body.token !== token) {
      return jsonResponse({ ok: false, error: 'Invalid or missing token' });
    }

    const event = body.event;
    if (event !== 'arrive' && event !== 'leave') {
      return jsonResponse({ ok: false, error: "event must be 'arrive' or 'leave'" });
    }

    const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();
    if (isNaN(timestamp.getTime())) {
      return jsonResponse({ ok: false, error: 'Invalid timestamp' });
    }

    const punchesSheet = getOrCreateSheet(SHEET_PUNCHES, ['Timestamp', 'Event', 'Matched']);
    punchesSheet.appendRow([timestamp, event, false]);

    let overtimeHours = 0;
    if (event === 'leave') {
      overtimeHours = matchAndLogOvertime(punchesSheet, timestamp, standardStart, standardEnd);
    }

    return jsonResponse({ ok: true, event: event, overtimeHours: overtimeHours });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function matchAndLogOvertime(punchesSheet, leaveTime, standardStart, standardEnd) {
  const data = punchesSheet.getDataRange().getValues();
  const leaveDay = dateKey(leaveTime);

  // Walk backward, skipping the header row and the leave punch just appended.
  for (let row = data.length - 2; row >= 1; row--) {
    const [ts, event, matched] = data[row];
    const arriveTime = new Date(ts);
    if (event === 'arrive' && !matched && dateKey(arriveTime) === leaveDay) {
      punchesSheet.getRange(row + 1, 3).setValue(true);

      const overtimeHours = computeOvertimeHours(arriveTime, leaveTime, standardStart, standardEnd);
      if (overtimeHours > 0) {
        const hoursWorked = (leaveTime.getTime() - arriveTime.getTime()) / 3600000;
        const overtimeSheet = getOrCreateSheet(SHEET_OVERTIME, [
          'Date',
          'Arrive',
          'Leave',
          'Hours Worked',
          'Overtime Hours',
          'Notes',
        ]);
        overtimeSheet.appendRow([
          leaveDay,
          arriveTime,
          leaveTime,
          round2(hoursWorked),
          round2(overtimeHours),
          'Auto-logged from location',
        ]);
      }
      return overtimeHours;
    }
  }
  return 0; // no matching arrive punch found for today
}

function computeOvertimeHours(arriveTime, leaveTime, standardStart, standardEnd) {
  const day = new Date(arriveTime.getFullYear(), arriveTime.getMonth(), arriveTime.getDate());
  const stdStart = withTime(day, standardStart);
  const stdEnd = withTime(day, standardEnd);

  const earlyMs = Math.max(0, Math.min(stdStart.getTime(), leaveTime.getTime()) - arriveTime.getTime());
  const lateMs = Math.max(0, leaveTime.getTime() - Math.max(stdEnd.getTime(), arriveTime.getTime()));
  return round2((earlyMs + lateMs) / 3600000);
}

function withTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function dateKey(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
