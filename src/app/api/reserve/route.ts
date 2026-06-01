import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { makeReservation } from '@/lib/reserve';
import { importSchedule } from '@/lib/schedule';
import { corsHeaders, isAllowedOrigin } from '@/lib/cors';

export const runtime = 'nodejs';
export const maxDuration = 60;

function reply(body: any, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

// CORS preflight (the browser sends this before a JSON POST).
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');

  // If a browser presents an Origin, it must be on the allowlist. (CORS already
  // blocks disallowed origins from reading the response and, since this is a
  // preflighted JSON POST, from being sent at all — this is defense in depth.
  // Non-browser callers send no Origin and are not blocked here.)
  if (origin && !isAllowedOrigin(origin)) {
    return reply({ ok: false, error: 'Origin not allowed' }, 403, origin);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: 'Invalid JSON body' }, 400, origin);
  }

  const { date, time, duration, name, email, phone, court, dryRun } = body || {};

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return reply({ ok: false, error: 'Missing or invalid "date" (expected YYYY-MM-DD)' }, 400, origin);
  }
  if (!time || !/^\d{1,2}(:\d{2})?$/.test(String(time))) {
    return reply({ ok: false, error: 'Missing or invalid "time" (expected HH or HH:MM)' }, 400, origin);
  }
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return reply({ ok: false, error: 'Missing or invalid "duration" (minutes, must be > 0)' }, 400, origin);
  }
  if (!name || !String(name).trim()) {
    return reply({ ok: false, error: 'Missing "name"' }, 400, origin);
  }
  let courtNum: number | undefined;
  if (court !== undefined && court !== null && court !== '') {
    courtNum = Number(court);
    if (courtNum !== 1 && courtNum !== 2) {
      return reply({ ok: false, error: 'Invalid "court" (must be 1 or 2)' }, 400, origin);
    }
  }

  try {
    const result = await makeReservation({
      date: String(date),
      time: String(time),
      duration: dur,
      name: String(name),
      email: email ? String(email) : '',
      phone: phone ? String(phone) : '',
      court: courtNum,
      dryRun: Boolean(dryRun),
    });

    // Refresh MongoDB + home page cache from the just-written workbook so the
    // reservation is reflected immediately (skipped on dryRun).
    if (!dryRun && result.buffer) {
      const wb = XLSX.read(result.buffer, { type: 'buffer' });
      await importSchedule(wb);
    }

    return reply(
      { ok: true, dryRun: Boolean(dryRun), court: result.location + 1, slots: result.slots },
      200,
      origin
    );
  } catch (e: any) {
    const msg = e?.message || 'Reservation failed';
    // Business-rule rejections -> 409; everything else (Drive/permission/etc.) -> 500.
    const isConflict = /already booked|No matching|No schedule|Invalid (date|time)/i.test(msg);
    return reply({ ok: false, error: msg }, isConflict ? 409 : 500, origin);
  }
}
