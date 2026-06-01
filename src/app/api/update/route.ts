import { NextResponse } from 'next/server';
import { downloadExcelFile } from '@/lib/googleDrive';
import { importSchedule } from '@/lib/schedule';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const excelBuffer = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  await importSchedule(workbook);
  return NextResponse.json({ status: "ok" });
}
