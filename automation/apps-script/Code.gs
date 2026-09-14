/**
 * OverWork auto-logger.
 *
 * Receives "arrive" / "leave" pings (e.g. from an iPhone Shortcuts location
 * automation) and logs them to a "Punches" sheet. Whenever a "leave" ping
 * is matched to the same day's "arrive" ping, the hours worked outside the
 * standard workday window are computed and appended to an "Overtime" sheet.
 *
 * Also tracks Belgian public holidays, vacation days, ADV hours, and
 * overtime as spendable balances, and emails you once a day if a scheduled
 * workday passes with no punch logged, so you can say whether you worked,
 * took a vacation day, used ADV hours, or used overtime.
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
const SHEET_ABSENCES = 'Absences';
const SHEET_ADJUSTMENTS = 'Adjustments';
const SHEET_CONFIG = 'Config';

// Keyed by JS Date#getDay() (0 = Sunday … 6 = Saturday). A day with no entry
// has no standard hours, so any time logged that day counts fully as
// overtime — edit this (or the SCHEDULE_JSON script property, once set) to
// change your actual work hours.
const DEFAULT_SCHEDULE = {
  '1': '08:00-16:30', // Monday
  '2': '08:00-16:30', // Tuesday
  '3': '08:00-16:30', // Wednesday
  '4': '08:00-16:30', // Thursday
  '5': '08:00-15:00', // Friday
};

const DEFAULT_VACATION_DAYS_PER_YEAR = 20;
const DEFAULT_ADV_HOURS_PER_YEAR = 24;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ABSENCE_TYPES = { worked: 'Worked', vacation: 'Vacation', adv: 'ADV', overtime: 'Overtime' };

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
  if (!props.getProperty('SCHEDULE_JSON')) {
    props.setProperty('SCHEDULE_JSON', JSON.stringify(DEFAULT_SCHEDULE));
  }
  if (!props.getProperty('VACATION_DAYS_PER_YEAR')) {
    props.setProperty('VACATION_DAYS_PER_YEAR', String(DEFAULT_VACATION_DAYS_PER_YEAR));
  }
  if (!props.getProperty('ADV_HOURS_PER_YEAR')) {
    props.setProperty('ADV_HOURS_PER_YEAR', String(DEFAULT_ADV_HOURS_PER_YEAR));
  }
  props.deleteProperty('STANDARD_START'); // superseded by SCHEDULE_JSON
  props.deleteProperty('STANDARD_END');

  getOrCreateSheet(SHEET_PUNCHES, ['Timestamp', 'Event', 'Matched']);
  getOrCreateSheet(SHEET_OVERTIME, ['Date', 'Arrive', 'Leave', 'Hours Worked', 'Overtime Hours', 'Notes']);
  getOrCreateSheet(SHEET_ABSENCES, ['Date', 'Type', 'Hours', 'Notes']);
  getOrCreateSheet(SHEET_ADJUSTMENTS, ['Date', 'Type', 'Amount', 'Notes']);

  ensureDailyTrigger();

  const config = getOrCreateSheet(SHEET_CONFIG, ['Key', 'Value']);
  const schedule = getSchedule();
  const rows = [['Webhook Token', token]];
  for (let day = 0; day <= 6; day++) {
    rows.push([WEEKDAY_NAMES[day], schedule[String(day)] || 'Not a workday — any hours logged count fully as overtime']);
  }
  rows.push(['Vacation Days / Year', props.getProperty('VACATION_DAYS_PER_YEAR')]);
  rows.push(['ADV Hours / Year', props.getProperty('ADV_HOURS_PER_YEAR')]);
  config.getRange(2, 1, rows.length, 2).setValues(rows);

  try {
    SpreadsheetApp.getUi().alert(
      'Setup complete. Copy the webhook token from the Config tab, then deploy this ' +
        'script as a web app (Deploy > New deployment > Web app) and use that URL in Shortcuts. ' +
        'A daily check now emails you if a workday passes with no punch logged.'
    );
  } catch (e) {
    // getUi() is unavailable when setup() is run from the script editor directly
    // rather than the sheet's menu — that's fine, the Config tab still has everything.
  }
}

function ensureDailyTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'checkForMissingDay';
  });
  if (!exists) {
    ScriptApp.newTrigger('checkForMissingDay').timeBased().everyDays(1).atHour(19).create();
  }
}

function getSchedule() {
  const raw = PropertiesService.getScriptProperties().getProperty('SCHEDULE_JSON');
  return raw ? JSON.parse(raw) : DEFAULT_SCHEDULE;
}

function scheduledHoursForDay(dateStr) {
  const window = getSchedule()[String(new Date(dateStr + 'T12:00:00').getDay())];
  if (!window) return 0;
  const [startStr, endStr] = window.split('-');
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  return round2(((eh * 60 + em) - (sh * 60 + sm)) / 60);
}

/* ---------------------------------------------------------------------- */
/* Belgian public holidays                                                */
/* ---------------------------------------------------------------------- */

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday.
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Belgium's 10 national holidays for a given year, each flagged if it falls
// on a weekend (per the user's own rule, those convert into an extra
// vacation day since there's no workday to take off).
function getBelgianHolidays(year) {
  const easter = getEasterSunday(year);
  const tz = Session.getScriptTimeZone();
  const raw = [
    { date: new Date(year, 0, 1), name: 'Nieuwjaar' },
    { date: addDays(easter, 1), name: 'Paasmaandag' },
    { date: new Date(year, 4, 1), name: 'Dag van de Arbeid' },
    { date: addDays(easter, 39), name: 'O.L.H. Hemelvaart' },
    { date: addDays(easter, 50), name: 'Pinkstermaandag' },
    { date: new Date(year, 6, 21), name: 'Nationale feestdag' },
    { date: new Date(year, 7, 15), name: 'O.L.V. Hemelvaart' },
    { date: new Date(year, 10, 1), name: 'Allerheiligen' },
    { date: new Date(year, 10, 11), name: 'Wapenstilstand' },
    { date: new Date(year, 11, 25), name: 'Kerstmis' },
  ];
  return raw.map(function (h) {
    const dow = h.date.getDay();
    return {
      date: Utilities.formatDate(h.date, tz, 'yyyy-MM-dd'),
      name: h.name,
      isWeekend: dow === 0 || dow === 6,
    };
  });
}

function isBelgianHoliday(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  return getBelgianHolidays(year).some(function (h) {
    return h.date === dateStr;
  });
}

/* ---------------------------------------------------------------------- */
/* Daily "were you at work" check                                         */
/* ---------------------------------------------------------------------- */

function checkForMissingDay() {
  const dateStr = dateKey(new Date());
  const dow = new Date(dateStr + 'T12:00:00').getDay();

  if (!getSchedule()[String(dow)]) return; // not a scheduled workday
  if (isBelgianHoliday(dateStr)) return; // public holiday, nothing to ask

  const punchesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PUNCHES);
  if (punchesSheet && punchesSheet.getLastRow() > 1) {
    const data = punchesSheet.getRange(2, 1, punchesSheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][1] === 'arrive' && dateKey(new Date(data[i][0])) === dateStr) return; // they were at work
    }
  }

  const absencesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ABSENCES);
  if (absencesSheet && absencesSheet.getLastRow() > 1) {
    const data = absencesSheet.getRange(2, 1, absencesSheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === dateStr) return; // already resolved
    }
  }

  sendMissingDayEmail(dateStr);
}

function sendMissingDayEmail(dateStr) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  const url = ScriptApp.getService().getUrl();
  const base = url + '?token=' + encodeURIComponent(token) + '&confirm=' + encodeURIComponent(dateStr) + '&type=';

  const html =
    '<p>No arrival was logged for <b>' + dateStr + '</b>. What happened?</p>' +
    '<p>' +
    '<a href="' + base + 'worked">I worked (forgot to trigger Shortcuts)</a><br>' +
    '<a href="' + base + 'vacation">Use a vacation day</a><br>' +
    '<a href="' + base + 'adv">Use ADV hours</a><br>' +
    '<a href="' + base + 'overtime">Use overtime</a>' +
    '</p>' +
    '<p style="color:#888;font-size:12px">Each link opens a confirmation page before anything is recorded.</p>';

  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: 'OverWork: no punch logged for ' + dateStr,
    htmlBody: html,
  });
}

/* ---------------------------------------------------------------------- */
/* Web app                                                                */
/* ---------------------------------------------------------------------- */

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.resolve) return handleResolve(params);
  if (params.confirm) return handleConfirm(params);
  if (params.action === 'updateSettings') return handleUpdateSettings(params);
  if (params.action === 'addAdjustment') return handleAddAdjustment(params);
  if (params.format === 'json') return jsonResponse({ ok: true, message: 'OverWork webhook is running.' });

  return renderDashboard(params);
}

function checkToken(params) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !!token && params.token === token;
}

// Shows a one-click confirmation page before anything is written, so an
// email client's link-preview/safe-link scanner opening the link doesn't by
// itself record anything.
function handleConfirm(params) {
  if (!checkToken(params)) return HtmlService.createHtmlOutput(simpleMessage('Invalid or missing token.', true));

  const date = params.confirm;
  const type = String(params.type || '').toLowerCase();
  if (!ABSENCE_TYPES[type]) return HtmlService.createHtmlOutput(simpleMessage('Unknown type.', true));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return HtmlService.createHtmlOutput(simpleMessage('Invalid date.', true));

  const resolveUrl =
    ScriptApp.getService().getUrl() +
    '?token=' + encodeURIComponent(params.token) +
    '&resolve=' + encodeURIComponent(date) +
    '&type=' + encodeURIComponent(type);

  const label = ABSENCE_TYPES[type];
  return HtmlService.createHtmlOutput(
    simpleMessage(
      'Mark <b>' + esc(date) + '</b> as <b>' + esc(label) + '</b>?<br><br>' +
        '<a href="' + resolveUrl + '" style="display:inline-block;padding:10px 18px;background:#A9662A;color:#fff;' +
        'border-radius:6px;text-decoration:none;font-weight:600">Confirm</a>',
      false
    )
  );
}

function handleResolve(params) {
  if (!checkToken(params)) return HtmlService.createHtmlOutput(simpleMessage('Invalid or missing token.', true));

  const date = params.resolve;
  const type = String(params.type || '').toLowerCase();
  if (!ABSENCE_TYPES[type]) return HtmlService.createHtmlOutput(simpleMessage('Unknown type.', true));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return HtmlService.createHtmlOutput(simpleMessage('Invalid date.', true));

  const absencesSheet = getOrCreateSheet(SHEET_ABSENCES, ['Date', 'Type', 'Hours', 'Notes']);
  const existing = absencesSheet.getLastRow() > 1 ? absencesSheet.getRange(2, 1, absencesSheet.getLastRow() - 1, 2).getValues() : [];
  for (let i = 0; i < existing.length; i++) {
    if (String(existing[i][0]) === date) {
      return HtmlService.createHtmlOutput(simpleMessage('That day was already resolved as "' + esc(String(existing[i][1])) + '".', false));
    }
  }

  const label = ABSENCE_TYPES[type];
  const hours = type === 'adv' || type === 'overtime' ? scheduledHoursForDay(date) : 0;
  absencesSheet.appendRow([date, label, hours, 'Resolved via email link']);

  return HtmlService.createHtmlOutput(
    simpleMessage('Marked ' + esc(date) + ' as ' + esc(label) + (hours ? ' (' + hours + 'h)' : '') + '. You can close this tab.', false)
  );
}

function handleUpdateSettings(params) {
  if (!checkToken(params)) return HtmlService.createHtmlOutput(simpleMessage('Invalid or missing token.', true));

  const vacationDays = Number(params.vacationDaysPerYear);
  const advHours = Number(params.advHoursPerYear);
  if (!Number.isFinite(vacationDays) || vacationDays < 0 || !Number.isFinite(advHours) || advHours < 0) {
    return HtmlService.createHtmlOutput(simpleMessage('Vacation days and ADV hours must be numbers of 0 or more.', true));
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('VACATION_DAYS_PER_YEAR', String(vacationDays));
  props.setProperty('ADV_HOURS_PER_YEAR', String(advHours));

  const backUrl = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(params.token);
  return HtmlService.createHtmlOutput(
    simpleMessage(
      'Updated: ' + vacationDays + ' vacation days/year, ' + advHours + ' ADV hours/year.<br><br>' + backLink(backUrl),
      false
    )
  );
}

function handleAddAdjustment(params) {
  if (!checkToken(params)) return HtmlService.createHtmlOutput(simpleMessage('Invalid or missing token.', true));

  const type = String(params.type || '').toLowerCase();
  const typeLabels = { vacation: 'Vacation', adv: 'ADV', overtime: 'Overtime' };
  if (!typeLabels[type]) return HtmlService.createHtmlOutput(simpleMessage('Unknown balance type.', true));

  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return HtmlService.createHtmlOutput(simpleMessage('Amount must be a non-zero number (negative to subtract).', true));
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : dateKey(new Date());
  const notes = String(params.notes || 'Manual adjustment');

  const adjustmentsSheet = getOrCreateSheet(SHEET_ADJUSTMENTS, ['Date', 'Type', 'Amount', 'Notes']);
  adjustmentsSheet.appendRow([date, typeLabels[type], amount, notes]);

  const backUrl = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(params.token);
  const unit = type === 'vacation' ? 'day(s)' : 'hour(s)';
  return HtmlService.createHtmlOutput(
    simpleMessage(
      'Added ' + (amount > 0 ? '+' : '') + amount + ' ' + unit + ' to ' + typeLabels[type] + '.<br><br>' + backLink(backUrl),
      false
    )
  );
}

function backLink(url) {
  return (
    '<a href="' + url + '" style="display:inline-block;padding:10px 18px;background:#A9662A;color:#fff;' +
    'border-radius:6px;text-decoration:none;font-weight:600">Back to dashboard</a>'
  );
}

function simpleMessage(text, isError) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:system-ui,sans-serif;background:#E9ECE3;color:#1C2420;padding:40px 20px;' +
    'text-align:center}.card{max-width:420px;margin:0 auto;background:#FBFBF8;border:1px solid #D2D7C7;' +
    'border-radius:8px;padding:24px;' + (isError ? 'border-left:4px solid #A23D3D' : 'border-left:4px solid #A9662A') + '}</style>' +
    '</head><body><div class="card">' + text + '</div></body></html>'
  );
}

/* ---------------------------------------------------------------------- */
/* Balances                                                                */
/* ---------------------------------------------------------------------- */

function computeBalances(year) {
  const props = PropertiesService.getScriptProperties();
  const vacationPerYear = Number(props.getProperty('VACATION_DAYS_PER_YEAR')) || DEFAULT_VACATION_DAYS_PER_YEAR;
  const advPerYear = Number(props.getProperty('ADV_HOURS_PER_YEAR')) || DEFAULT_ADV_HOURS_PER_YEAR;

  const holidays = getBelgianHolidays(year);
  const weekendHolidayCount = holidays.filter(function (h) { return h.isWeekend; }).length;
  const vacationTotal = vacationPerYear + weekendHolidayCount;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const absencesSheet = ss.getSheetByName(SHEET_ABSENCES);
  const absences = absencesSheet && absencesSheet.getLastRow() > 1
    ? absencesSheet.getRange(2, 1, absencesSheet.getLastRow() - 1, 4).getValues()
    : [];

  let vacationUsed = 0;
  let advUsed = 0;
  let overtimeUsed = 0;
  absences.forEach(function (row) {
    if (String(row[0]).slice(0, 4) !== String(year)) return;
    const type = row[1];
    const hours = Number(row[2]) || 0;
    if (type === 'Vacation') vacationUsed += 1;
    if (type === 'ADV') advUsed += hours;
    if (type === 'Overtime') overtimeUsed += hours;
  });

  const overtimeSheet = ss.getSheetByName(SHEET_OVERTIME);
  const overtimeRows = overtimeSheet && overtimeSheet.getLastRow() > 1
    ? overtimeSheet.getRange(2, 1, overtimeSheet.getLastRow() - 1, 6).getValues()
    : [];
  let overtimeEarned = 0;
  overtimeRows.forEach(function (row) {
    if (String(row[0]).slice(0, 4) !== String(year)) return;
    overtimeEarned += Number(row[4]) || 0;
  });

  // Manual corrections: positive adds to that balance's remaining amount,
  // negative subtracts — e.g. -1 vacation day for time taken before this
  // system existed, or +3 overtime hours granted directly by an employer.
  const adjustmentsSheet = ss.getSheetByName(SHEET_ADJUSTMENTS);
  const adjustments = adjustmentsSheet && adjustmentsSheet.getLastRow() > 1
    ? adjustmentsSheet.getRange(2, 1, adjustmentsSheet.getLastRow() - 1, 4).getValues()
    : [];

  let vacationAdjust = 0;
  let advAdjust = 0;
  let overtimeAdjust = 0;
  adjustments.forEach(function (row) {
    if (String(row[0]).slice(0, 4) !== String(year)) return;
    const type = row[1];
    const amount = Number(row[2]) || 0;
    if (type === 'Vacation') vacationAdjust += amount;
    if (type === 'ADV') advAdjust += amount;
    if (type === 'Overtime') overtimeAdjust += amount;
  });

  return {
    year: year,
    vacationPerYear: vacationPerYear,
    vacationTotal: vacationTotal,
    vacationUsed: vacationUsed,
    vacationRemaining: round2(vacationTotal - vacationUsed + vacationAdjust),
    advTotal: advPerYear,
    advUsed: round2(advUsed),
    advRemaining: round2(advPerYear - advUsed + advAdjust),
    overtimeEarned: round2(overtimeEarned),
    overtimeUsed: round2(overtimeUsed),
    overtimeRemaining: round2(overtimeEarned - overtimeUsed + overtimeAdjust),
    upcomingHolidays: holidays.filter(function (h) { return h.date >= dateKey(new Date()); }),
  };
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                               */
/* ---------------------------------------------------------------------- */

function renderDashboard(params) {
  params = params || {};
  const year = Number(params.year) || new Date().getFullYear();
  const balances = computeBalances(year);
  const editMode = checkToken(params);
  const webAppUrl = ScriptApp.getService().getUrl();

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
            '<tr><td class="mono">' + esc(row.date) + '</td><td class="mono">' + esc(row.arrive) + '–' + esc(row.leave) +
            '</td><td class="mono">' + row.hoursWorked.toFixed(2) + '</td><td class="mono ot">' + row.overtimeHours.toFixed(2) +
            '</td><td>' + esc(row.notes) + '</td></tr>'
          );
        })
        .join('')
    : '<tr><td colspan="5" class="empty">No overtime logged yet.</td></tr>';

  const holidaysHtml = balances.upcomingHolidays.length
    ? balances.upcomingHolidays
        .map(function (h) {
          return '<li><span class="mono">' + esc(h.date) + '</span> — ' + esc(h.name) + (h.isWeekend ? ' <span class="tag">weekend</span>' : '') + '</li>';
        })
        .join('')
    : '<li class="empty">No holidays left this year.</li>';

  const editHtml = editMode
    ? `
  <section class="ledger-body">
    <h2>Edit balances</h2>
    <form class="edit-form" method="GET" action="${webAppUrl}">
      <input type="hidden" name="token" value="${esc(params.token)}">
      <input type="hidden" name="action" value="updateSettings">
      <div class="edit-row">
        <label>Vacation days / year<input type="number" name="vacationDaysPerYear" value="${balances.vacationPerYear}" min="0" step="1"></label>
        <label>ADV hours / year<input type="number" name="advHoursPerYear" value="${balances.advTotal}" min="0" step="0.5"></label>
        <button type="submit">Save</button>
      </div>
    </form>

    <form class="edit-form" method="GET" action="${webAppUrl}">
      <input type="hidden" name="token" value="${esc(params.token)}">
      <input type="hidden" name="action" value="addAdjustment">
      <div class="edit-row">
        <label>Type
          <select name="type">
            <option value="vacation">Vacation (days)</option>
            <option value="adv">ADV (hours)</option>
            <option value="overtime">Overtime (hours)</option>
          </select>
        </label>
        <label>Amount<input type="number" name="amount" step="0.25" placeholder="-1 or +2.5" required></label>
        <label>Date<input type="date" name="date" value="${dateKey(new Date())}"></label>
        <button type="submit">Add adjustment</button>
      </div>
      <label class="notes-label">Notes<input type="text" name="notes" placeholder="e.g. carried over from last year"></label>
    </form>
    <p class="hint">Positive adds to the remaining balance, negative subtracts. This link (with your token) is bookmarkable for future edits — the plain dashboard link stays read-only.</p>
  </section>`
    : '';

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
  .page { max-width: 760px; margin: 0 auto; }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  h1 { font-family: "IBM Plex Serif", Georgia, serif; font-size: 24px; margin: 0; }
  .mark { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 2px 6px; }
  .tagline { font-size: 13px; color: var(--ink-soft); margin: 4px 0 20px; }
  .balances { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 22px; }
  @media (max-width: 560px) { .balances { grid-template-columns: 1fr; } }
  .balance-card { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 14px 16px; }
  .balance-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-faint); margin-bottom: 6px; }
  .balance-value { font-family: "IBM Plex Mono", monospace; font-size: 22px; font-weight: 600; }
  .balance-sub { font-size: 11.5px; color: var(--ink-soft); font-family: "IBM Plex Mono", monospace; }
  .ledger-strip { display: flex; gap: 28px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 16px 20px; margin-bottom: 22px; }
  .stat-value { display: block; font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 600; }
  .stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-faint); }
  .ledger-body { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin-bottom: 22px; }
  .ledger-body h2 { font-family: "IBM Plex Serif", Georgia, serif; font-size: 16px; margin: 0 0 12px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); font-weight: 500; padding: 0 8px 6px; border-bottom: 1px solid var(--line-strong); }
  td { padding: 8px; border-bottom: 1px solid var(--line); }
  tr:nth-child(even) td { background: var(--surface-alt); }
  .mono { font-family: "IBM Plex Mono", monospace; white-space: nowrap; }
  .ot { color: var(--accent); font-weight: 600; }
  .empty { text-align: center; color: var(--ink-faint); padding: 20px 0; }
  ul.holidays { list-style: none; margin: 0; padding: 0; font-size: 13.5px; }
  ul.holidays li { padding: 6px 0; border-top: 1px solid var(--line); }
  ul.holidays li:first-child { border-top: none; }
  .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 1px 5px; margin-left: 4px; }
  .edit-form { margin-bottom: 16px; }
  .edit-form:last-of-type { margin-bottom: 0; }
  .edit-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
  .edit-row label, .notes-label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--ink-soft); flex: 1; min-width: 120px; }
  .notes-label { margin-top: 10px; }
  .edit-row input, .edit-row select, .notes-label input {
    font: inherit; font-size: 14px; padding: 7px 9px; border: 1px solid var(--line-strong);
    border-radius: 5px; background: var(--bg); color: var(--ink);
  }
  .edit-row button {
    font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 16px; border: none;
    border-radius: 5px; background: var(--accent); color: #fff; cursor: pointer; flex: none;
  }
  .hint { font-size: 11.5px; color: var(--ink-faint); margin: 14px 0 0; }
  footer { text-align: center; font-size: 11.5px; color: var(--ink-faint); margin-top: 16px; }
</style>
</head>
<body>
<div class="page">
  <div class="brand"><h1>OverWork</h1><span class="mark">${editMode ? 'Edit Mode' : 'Live Ledger'}</span></div>
  <p class="tagline">Auto-logged from your Shortcuts automations. Balances for ${balances.year}.</p>

  <div class="balances">
    <div class="balance-card">
      <div class="balance-title">Vacation days</div>
      <div class="balance-value">${balances.vacationRemaining}</div>
      <div class="balance-sub">${balances.vacationUsed} used / ${balances.vacationTotal} total</div>
    </div>
    <div class="balance-card">
      <div class="balance-title">ADV hours</div>
      <div class="balance-value">${balances.advRemaining}</div>
      <div class="balance-sub">${balances.advUsed} used / ${balances.advTotal} total</div>
    </div>
    <div class="balance-card">
      <div class="balance-title">Overtime hours</div>
      <div class="balance-value">${balances.overtimeRemaining}</div>
      <div class="balance-sub">${balances.overtimeUsed} used / ${balances.overtimeEarned} earned</div>
    </div>
  </div>
${editHtml}

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

  <section class="ledger-body">
    <h2>Remaining Belgian holidays this year</h2>
    <ul class="holidays">${holidaysHtml}</ul>
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

/* ---------------------------------------------------------------------- */
/* Webhook (Shortcuts)                                                     */
/* ---------------------------------------------------------------------- */

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TOKEN');

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
      overtimeHours = matchAndLogOvertime(punchesSheet, timestamp);
    }

    return jsonResponse({ ok: true, event: event, overtimeHours: overtimeHours });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function matchAndLogOvertime(punchesSheet, leaveTime) {
  const data = punchesSheet.getDataRange().getValues();
  const leaveDay = dateKey(leaveTime);

  // Walk backward, skipping the header row and the leave punch just appended.
  for (let row = data.length - 2; row >= 1; row--) {
    const [ts, event, matched] = data[row];
    const arriveTime = new Date(ts);
    if (event === 'arrive' && !matched && dateKey(arriveTime) === leaveDay) {
      punchesSheet.getRange(row + 1, 3).setValue(true);

      const overtimeHours = computeOvertimeHours(arriveTime, leaveTime);
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

// Overtime only counts once the early/late total reaches a full 15-minute
// block, and only in whole 15-minute blocks after that (rounded down, not
// to the nearest) — e.g. 13 minutes early counts as 0, but 20 minutes early
// plus 46 minutes late (66 total) counts as 1 hour, not 1h06.
const OVERTIME_INCREMENT_MINUTES = 15;

function computeOvertimeHours(arriveTime, leaveTime) {
  const day = new Date(arriveTime.getFullYear(), arriveTime.getMonth(), arriveTime.getDate());
  const window = getSchedule()[String(arriveTime.getDay())];

  let earlyMs;
  let lateMs;
  if (window) {
    const [startStr, endStr] = window.split('-');
    const stdStart = withTime(day, startStr);
    const stdEnd = withTime(day, endStr);
    earlyMs = Math.max(0, Math.min(stdStart.getTime(), leaveTime.getTime()) - arriveTime.getTime());
    lateMs = Math.max(0, leaveTime.getTime() - Math.max(stdEnd.getTime(), arriveTime.getTime()));
  } else {
    // No standard hours for this day (e.g. a weekend) — everything worked counts.
    earlyMs = 0;
    lateMs = Math.max(0, leaveTime.getTime() - arriveTime.getTime());
  }

  const totalMinutes = (earlyMs + lateMs) / 60000;
  const roundedMinutes = Math.floor(totalMinutes / OVERTIME_INCREMENT_MINUTES) * OVERTIME_INCREMENT_MINUTES;
  return round2(roundedMinutes / 60);
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
