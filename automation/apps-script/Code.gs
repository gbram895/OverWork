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

function doGet() {
  return jsonResponse({ ok: true, message: 'OverWork webhook is running.' });
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
