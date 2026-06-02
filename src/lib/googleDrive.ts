// src/lib/googleDrive.ts
import { google } from 'googleapis';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// The bookings file is a native Google Sheet, so we export it to xlsx for
// parsing (alt:media download only works for binary/uploaded files, not for
// Google-native documents). Writing happens via the Sheets API (googleSheets.ts).
export async function downloadExcelFile(fileId: string | undefined): Promise<Buffer> {
  if (!fileId) throw new Error('Missing GOOGLE_SPREADSHEET_ID');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.export(
    { fileId, mimeType: XLSX_MIME },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(res.data as ArrayBuffer);
}
