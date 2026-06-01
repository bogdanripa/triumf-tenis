import ExcelJS from 'exceljs';
import { downloadExcelFile, uploadExcelFile } from '@/lib/googleDrive';
import { months, days, stripFormatting } from '@/lib/schedule';

export type ReserveParams = {
  date: string;       // YYYY-MM-DD
  time: string;       // HH or HH:MM
  duration: number;   // minutes
  name: string;
  email?: string;
  phone?: string;
  dryRun?: boolean;   // if true: compute + validate but do NOT write to Drive
};

export type ReserveResult = {
  buffer: Buffer | null; // the updated workbook (null on dryRun)
  location: number;      // 0 = Teren 1, 1 = Teren 2
  slots: string[];       // the slot labels that were booked, e.g. ["18-19", "19-20"]
};

type Slot = { row: number; col: number; start: number; end: number; free: boolean; timeText: string };

function toMin(s: string): number {
  s = s.trim();
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return 60 * parseInt(h) + parseInt(m);
  }
  return 60 * parseInt(s);
}

function cellText(ws: ExcelJS.Worksheet, r: number, c: number): string {
  const v = ws.getCell(r, c).value as any;
  if (v == null) return '';
  let s: string;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) s = v.richText.map((t: any) => t.text).join('');
    else if (v.text != null) s = String(v.text);
    else if (v.result != null) s = String(v.result);
    else s = String(v); // Date / other: keep non-empty so the day block isn't truncated; won't match the time-slot regex
  } else {
    s = String(v);
  }
  return stripFormatting(s).trim();
}

// Find the cell holding a day header like "LUNI 01" in the given month sheet.
function locateDay(
  wb: ExcelJS.Workbook,
  monthIdx: number,
  year: number,
  dayOfWeek: string,
  day: string
): { ws: ExcelJS.Worksheet; hRow: number; hCol: number } | null {
  if (monthIdx < 0 || monthIdx > 11) return null;
  const ws = wb.getWorksheet(`${months[monthIdx]} ${year}`);
  if (!ws) return null;
  const target = `${dayOfWeek} ${day}`;
  let hRow = 0, hCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const v = cell.value;
      if (!hRow && typeof v === 'string' && stripFormatting(v).trim() === target) {
        hRow = rowNumber;
        hCol = colNumber;
      }
    });
  });
  return hRow ? { ws, hRow, hCol } : null;
}

// Parse the pre-defined time slots of one court column, within the day block.
// The block runs from the row under the header until the Teren 1 column (hCol)
// goes blank — mirroring how the importer (getScheduleFrom) trims the block.
function parseColumn(ws: ExcelJS.Worksheet, hRow: number, hCol: number, col: number): Slot[] {
  const slots: Slot[] = [];
  for (let r = hRow + 1; r <= hRow + 30; r++) {
    if (cellText(ws, r, hCol) === '') break; // end of the day block
    const txt = cellText(ws, r, col);
    const m = txt.match(/^([\d:]+)-([\d:]+)(.*)$/);
    if (!m) continue; // not a time slot (e.g. a stray number/date or empty)
    const rest = m[3].trim();
    const free = rest === '' || /x$/i.test(rest);
    slots.push({ row: r, col, start: toMin(m[1]), end: toMin(m[2]), free, timeText: `${m[1]}-${m[2]}` });
  }
  return slots;
}

// Decide whether [startMin, endMin) can be booked on this column by tiling it
// with free cells that fall entirely within the requested interval.
function coverInterval(slots: Slot[], startMin: number, endMin: number):
  | { ok: true; slots: Slot[] }
  | { ok: false; reason: string } {
  const contained = slots
    .filter((s) => s.start >= startMin && s.end <= endMin)
    .sort((a, b) => a.start - b.start);

  let cursor = startMin;
  const picked: Slot[] = [];
  for (const s of contained) {
    if (s.start !== cursor) break; // gap or overlap — can't tile cleanly
    picked.push(s);
    cursor = s.end;
    if (cursor >= endMin) break;
  }
  if (cursor < endMin) {
    return { ok: false, reason: 'No matching time slot available for that interval' };
  }
  if (picked.some((s) => !s.free)) {
    return { ok: false, reason: 'Time slot is already booked' };
  }
  return { ok: true, slots: picked };
}

export async function makeReservation(p: ReserveParams): Promise<ReserveResult> {
  const d = new Date(`${p.date}T00:00:00`);
  if (isNaN(d.getTime())) throw new Error('Invalid date');

  const startMin = toMin(p.time);
  const endMin = startMin + Math.round(p.duration);
  if (!Number.isFinite(startMin) || !(endMin > startMin)) {
    throw new Error('Invalid time or duration');
  }

  const buf = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);

  const year = d.getFullYear();
  const monthIdx = d.getMonth();
  const day = `${d.getDate()}`.padStart(2, '0');
  const dayOfWeek = days[d.getDay()];

  // Primary month, then the adjacent sheet (some boundary weeks live there).
  let found = locateDay(wb, monthIdx, year, dayOfWeek, day);
  if (!found) {
    let nm = monthIdx, ny = year;
    if (d.getDate() < 15) { nm--; if (nm < 0) { nm = 11; ny--; } }
    else { nm++; if (nm > 11) { nm = 0; ny++; } }
    found = locateDay(wb, nm, ny, dayOfWeek, day);
  }
  if (!found) throw new Error(`No schedule found for ${dayOfWeek} ${day}`);

  const { ws, hRow, hCol } = found;

  // Try Teren 1 (location 0) first, then Teren 2 (location 1).
  let chosen: { location: number; slots: Slot[] } | null = null;
  let lastReason = 'Slot not available';
  for (let loc = 0; loc < 2; loc++) {
    const res = coverInterval(parseColumn(ws, hRow, hCol, hCol + loc), startMin, endMin);
    if (res.ok) { chosen = { location: loc, slots: res.slots }; break; }
    lastReason = res.reason;
  }
  if (!chosen) throw new Error(lastReason);

  // Build the cell text. Phone (digits) goes last so the value never ends in a
  // letter "x" — which the importer treats as a cancellation (=> free).
  let details = [p.name, p.email, p.phone].map((x) => (x || '').trim()).filter(Boolean).join(' ');
  if (/x$/i.test(details)) details += '.';

  for (const s of chosen.slots) {
    ws.getCell(s.row, s.col).value = `${s.timeText} ${details}`;
  }

  const result: ReserveResult = { buffer: null, location: chosen.location, slots: chosen.slots.map((s) => s.timeText) };

  if (!p.dryRun) {
    const out = await wb.xlsx.writeBuffer();
    const outBuf = Buffer.from(out);
    await uploadExcelFile(process.env.GOOGLE_SPREADSHEET_ID, outBuf);
    result.buffer = outBuf;
  }

  return result;
}
