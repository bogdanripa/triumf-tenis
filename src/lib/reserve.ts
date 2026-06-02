import ExcelJS from 'exceljs';
import { downloadExcelFile } from '@/lib/googleDrive';
import { batchUpdateCells, colLetter, a1Range } from '@/lib/googleSheets';
import { months, days, readDay, readDayWithFallback, isFreeCell, cellText, DaySlot } from '@/lib/schedule';

export type ReserveParams = {
  date: string;       // YYYY-MM-DD
  time: string;       // HH or HH:MM (on the hour)
  duration: number;   // minutes (whole hours)
  name: string;
  email?: string;
  phone?: string;
  court?: number;     // 1 = Teren 1, 2 = Teren 2; if omitted, first free court is used
  dryRun?: boolean;
};

export type ReserveResult = {
  location: number;   // 0 = Teren 1, 1 = Teren 2
  slots: string[];    // the 30-min slot start labels booked, e.g. ["18:00", "18:30"]
};

const SLOT = 30; // minutes per row

function toMin(s: string): number {
  s = s.trim();
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return 60 * parseInt(h, 10) + parseInt(m, 10);
  }
  return 60 * parseInt(s, 10);
}

function label(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// The 30-min rows of one court that tile [startMin, endMin), all free.
function cover(slots: DaySlot[], court: number, startMin: number, endMin: number):
  | { ok: true; rows: DaySlot[] }
  | { ok: false; reason: string } {
  const need = (endMin - startMin) / SLOT;
  const inRange = slots
    .filter((s) => s.start >= startMin && s.start < endMin)
    .sort((a, b) => a.start - b.start);
  if (inRange.length < need) return { ok: false, reason: 'No matching time slot available for that interval' };
  for (let i = 0; i < need; i++) {
    if (!inRange[i] || inRange[i].start !== startMin + i * SLOT) {
      return { ok: false, reason: 'No matching time slot available for that interval' };
    }
  }
  const picked = inRange.slice(0, need);
  const free = picked.every((s) => (court === 0 ? s.c1free : s.c2free));
  if (!free) return { ok: false, reason: 'Time slot is already booked' };
  return { ok: true, rows: picked };
}

export async function makeReservation(p: ReserveParams): Promise<ReserveResult> {
  const d = new Date(`${p.date}T00:00:00`);
  if (isNaN(d.getTime())) throw new Error('Invalid date');

  const startMin = toMin(p.time);
  const endMin = startMin + Math.round(p.duration);
  if (!Number.isFinite(startMin) || !(endMin > startMin)) throw new Error('Invalid time or duration');

  const buf = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);

  const grid = readDayWithFallback(wb, d);
  if (!grid) throw new Error(`No schedule found for ${days[d.getDay()]} ${d.getDate()}`);

  // We need the worksheet for A1 ranges; find it again by the day the grid came
  // from. readDayWithFallback already resolved the right sheet — re-resolve to
  // get the worksheet object and its name.
  const ws = resolveSheet(wb, d);
  if (!ws) throw new Error('Sheet not found');

  // Choose the requested court, else first free (Teren 1, then Teren 2).
  const courtsToTry = p.court === 1 || p.court === 2 ? [p.court - 1] : [0, 1];
  let chosen: { location: number; rows: DaySlot[] } | null = null;
  let lastReason = 'Slot not available';
  for (const loc of courtsToTry) {
    const res = cover(grid.slots, loc, startMin, endMin);
    if (res.ok) { chosen = { location: loc, rows: res.rows }; break; }
    lastReason = res.reason;
  }
  if (!chosen) throw new Error(lastReason);

  const col = chosen.location === 0 ? grid.court1Col : grid.court2Col;

  // HARD RULE: re-read every target cell right before writing; abort (writing
  // nothing) if any is no longer a free cell, so an existing reservation can
  // never be overwritten.
  for (const s of chosen.rows) {
    if (!isFreeCell(cellText(ws, s.row, col))) throw new Error('Time slot is already booked');
  }

  // Cell holds just the player's details now (time lives in the "Ora" column).
  const details = [p.name, p.email, p.phone].map((x) => (x || '').trim()).filter(Boolean).join(' ');

  if (!p.dryRun) {
    const updates = chosen.rows.map((s) => ({
      range: a1Range(ws.name, `${colLetter(col)}${s.row}`),
      value: details,
    }));
    await batchUpdateCells(process.env.GOOGLE_SPREADSHEET_ID, updates);
  }

  return { location: chosen.location, slots: chosen.rows.map((s) => label(s.start)) };
}

// Re-resolve the worksheet a date maps to (primary month, else adjacent).
function resolveSheet(wb: ExcelJS.Workbook, d: Date): ExcelJS.Worksheet | undefined {
  const dayOfWeek = days[d.getDay()];
  const day = `${d.getDate()}`.padStart(2, '0');
  const tryMonth = (mi: number, y: number): ExcelJS.Worksheet | undefined => {
    if (mi < 0 || mi > 11) return undefined;
    const ws = wb.getWorksheet(`${months[mi]} ${y}`);
    if (ws && readDay(ws, dayOfWeek, day)) return ws;
    return undefined;
  };
  let ws = tryMonth(d.getMonth(), d.getFullYear());
  if (ws) return ws;
  let nm = d.getMonth(), ny = d.getFullYear();
  if (d.getDate() < 15) { nm--; if (nm < 0) { nm = 11; ny--; } }
  else { nm++; if (nm > 11) { nm = 0; ny++; } }
  return tryMonth(nm, ny);
}
