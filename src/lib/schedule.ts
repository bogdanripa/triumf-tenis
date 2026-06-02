import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { clearSchedule, addToSchedule } from '@/lib/db';
import { downloadExcelFile } from '@/lib/googleDrive';

export const months = ["IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE", "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE"];
export const days = ["DUMINICA", "LUNI", "MARTI", "MIERCURI", "JOI", "VINERI", "SAMBATA"];

// Remove bidi/zero-width formatting marks that sneak into copy-pasted cells.
export function stripFormatting(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if ((c >= 0x202A && c <= 0x202E) || c === 0x200E || c === 0x200F || (c >= 0x2066 && c <= 0x2069)) continue;
    out += ch;
  }
  return out;
}

export function cellText(ws: ExcelJS.Worksheet, r: number, c: number): string {
  const v = ws.getCell(r, c).value as any;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return stripFormatting(v.richText.map((t: any) => t.text).join('')).trim();
    if (v.text != null) return stripFormatting(String(v.text)).trim();
    if (v.result != null) return stripFormatting(String(v.result)).trim();
    return stripFormatting(String(v)).trim();
  }
  return stripFormatting(String(v)).trim();
}

// A cell (a player name, or empty) counts as free when it's blank or ends in a
// trailing "x" (the cancellation marker).
export function isFreeCell(text: string): boolean {
  const t = text.trim();
  return t === '' || /x$/i.test(t);
}

export type DaySlot = { row: number; start: number; court1Col: number; court2Col: number; c1free: boolean; c2free: boolean };
export type DayGrid = { court1Col: number; court2Col: number; slots: DaySlot[] };

// Read a single day's grid: the day occupies two columns (Teren 1 / Teren 2)
// under a header like "MARTI 02" in the header row; the "Ora" column holds the
// 30-minute time slots. Each cell is a player name (booked) or blank/trailing-x
// (free).
export function readDay(ws: ExcelJS.Worksheet, dayOfWeek: string, day: string): DayGrid | null {
  const padded = `${dayOfWeek} ${day}`;
  const plain = `${dayOfWeek} ${parseInt(day, 10)}`;

  // The sheet stacks weekly blocks vertically, each with its own header row and
  // "Ora" column, so find the day header ANYWHERE (not just the first block).
  let headerRow = 0;
  let court1Col = 0;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (court1Col) return;
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      if (court1Col) return;
      const v = cell.value;
      if (typeof v !== 'string') return;
      const t = stripFormatting(v).trim();
      if (t === padded || t === plain) { headerRow = rn; court1Col = cn; }
    });
  });
  if (!court1Col) return null;

  // "Ora" (time) column for this block: in the same header row, else column A.
  let oraCol = 0;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, c) => {
    if (oraCol) return;
    const v = cell.value;
    if (typeof v === 'string' && stripFormatting(v).trim().toLowerCase() === 'ora') oraCol = c;
  });
  if (!oraCol) oraCol = 1;

  const court2Col = court1Col + 1;
  const slots: DaySlot[] = [];
  for (let r = headerRow + 1; r <= headerRow + 400; r++) {
    const ot = cellText(ws, r, oraCol);
    if (ot === '') break;                 // blank row = end of this block
    const m = ot.match(/(\d{1,2}):(\d{2})/);
    if (!m) break;                        // non-time (next block's header/"Ora") = end of block
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    slots.push({
      row: r,
      start,
      court1Col,
      court2Col,
      c1free: isFreeCell(cellText(ws, r, court1Col)),
      c2free: isFreeCell(cellText(ws, r, court2Col)),
    });
  }
  return { court1Col, court2Col, slots };
}

// Find a day on its month sheet, falling back to the adjacent month sheet
// (some boundary weeks live there).
export function readDayWithFallback(wb: ExcelJS.Workbook, d: Date): DayGrid | null {
  const dayOfWeek = days[d.getDay()];
  const day = `${d.getDate()}`.padStart(2, '0');
  const tryMonth = (mi: number, y: number): DayGrid | null => {
    if (mi < 0 || mi > 11) return null;
    const ws = wb.getWorksheet(`${months[mi]} ${y}`);
    if (!ws) return null;
    return readDay(ws, dayOfWeek, day);
  };
  let grid = tryMonth(d.getMonth(), d.getFullYear());
  if (grid) return grid;
  let nm = d.getMonth(), ny = d.getFullYear();
  if (d.getDate() < 15) { nm--; if (nm < 0) { nm = 11; ny--; } }
  else { nm++; if (nm > 11) { nm = 0; ny++; } }
  return tryMonth(nm, ny);
}

// Parse today + the next 2 days, replace the MongoDB schedule, revalidate.
export async function importSchedule(workbook: ExcelJS.Workbook) {
  const schedule: Array<{ dayIdx: number; location: number; dayOfWeek: string; time: number; state: number }> = [];

  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dayOfWeek = days[d.getDay()];
    const grid = readDayWithFallback(workbook, d);
    if (!grid) {
      console.error(`No schedule found for ${dayOfWeek} ${d.getDate()}`);
      continue;
    }
    for (const s of grid.slots) {
      schedule.push({ dayIdx: i, location: 0, dayOfWeek, time: s.start, state: s.c1free ? 0 : 1 });
      schedule.push({ dayIdx: i, location: 1, dayOfWeek, time: s.start, state: s.c2free ? 0 : 1 });
    }
  }

  await clearSchedule();
  await addToSchedule(schedule);
  revalidatePath('/');
}

// Download the latest sheet from Drive and re-import it into MongoDB.
export async function refreshSchedule() {
  const buffer = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  await importSchedule(wb);
}
