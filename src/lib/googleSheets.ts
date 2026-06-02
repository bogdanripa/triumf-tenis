// src/lib/googleSheets.ts
import { google } from 'googleapis';

export async function getSpreadsheetValues(range: string) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return res.data.values;
}

// A1 column letter from a 1-based column index (1 -> A, 27 -> AA).
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Quote a sheet/tab name for use in an A1 range (e.g. "IUNIE 2026" -> 'IUNIE 2026').
export function a1Range(sheetName: string, a1: string): string {
  return "'" + sheetName.replace(/'/g, "''") + "'!" + a1;
}

// Write one or more individual cells. Uses RAW so values are stored verbatim
// (no date/number re-coercion). Requires the read-write spreadsheets scope and
// Editor access to the file. Surgical: never rewrites the whole document, so
// formatting and other cells are untouched.
export async function batchUpdateCells(
  spreadsheetId: string | undefined,
  updates: Array<{ range: string; value: string }>
): Promise<void> {
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SPREADSHEET_ID');
  if (!updates.length) return;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });
}
