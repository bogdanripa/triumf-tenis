// src/lib/googleDrive.ts
import { google } from 'googleapis';
import { Readable } from 'stream';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadExcelFile(fileId: string | undefined): Promise<Buffer> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(res.data as ArrayBuffer);
}

// Replaces the contents of the Drive file with the given xlsx buffer.
// Requires the service account to have Editor access on the file and the
// read-write 'drive' scope (download only needs drive.readonly).
export async function uploadExcelFile(fileId: string | undefined, buffer: Buffer): Promise<void> {
  if (!fileId) throw new Error('Missing GOOGLE_SPREADSHEET_ID');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  const drive = google.drive({ version: 'v3', auth });

  await drive.files.update({
    fileId,
    media: { mimeType: XLSX_MIME, body: Readable.from(buffer) },
    fields: 'id',
  });
}
