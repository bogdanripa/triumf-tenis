import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { makeReservation } from '@/lib/reserve';
import { importSchedule } from '@/lib/schedule';

export const runtime = 'nodejs';
export const maxDuration = 60;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const { date, time, duration, name, email, phone, dryRun } = body || {};

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return bad('Missing or invalid "date" (expected YYYY-MM-DD)');
  }
  if (!time || !/^\d{1,2}(:\d{2})?$/.test(String(time))) {
    return bad('Missing or invalid "time" (expected HH or HH:MM)');
  }
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return bad('Missing or invalid "duration" (minutes, must be > 0)');
  }
  if (!name || !String(name).trim()) {
    return bad('Missing "name"');
  }

  try {
    const result = await makeReservation({
      date: String(date),
      time: String(time),
      duration: dur,
      name: String(name),
      email: email ? String(email) : '',
      phone: phone ? String(phone) : '',
      dryRun: Boolean(dryRun),
    });

    // Refresh MongoDB + home page cache from the just-written workbook so the
    // reservation is reflected immediately (skipped on dryRun).
    if (!dryRun && result.buffer) {
      const wb = XLSX.read(result.buffer, { type: 'buffer' });
      await importSchedule(wb);
    }

    return NextResponse.json({
      ok: true,
      dryRun: Boolean(dryRun),
      court: result.location + 1, // 1 = Teren 1, 2 = Teren 2
      slots: result.slots,
    });
  } catch (e: any) {
    const msg = e?.message || 'Reservation failed';
    // Business-rule rejections -> 409; everything else (Drive/permission/etc.) -> 500.
    const isConflict = /already booked|No matching|No schedule|Invalid (date|time)/i.test(msg);
    return bad(msg, isConflict ? 409 : 500);
  }
}
