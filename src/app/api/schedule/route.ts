import { NextRequest, NextResponse } from 'next/server';
import { getSchedule } from '@/lib/db';
import { corsHeaders } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { dayIdx: number; dayOfWeek: string; location: number; time: number; state: number };

function label(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

// Read-only schedule for the next 3 days, in the same shape the homepage uses.
// Intended to populate the booking UI hosted on another domain.
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const rows = (await getSchedule()) as Row[];

  // Group by day, then by 30-minute time slot, recording each court's state.
  const byDay = new Map<number, { dayIdx: number; dayOfWeek: string; times: Map<number, Record<number, number>> }>();
  for (const r of rows) {
    let day = byDay.get(r.dayIdx);
    if (!day) {
      day = { dayIdx: r.dayIdx, dayOfWeek: r.dayOfWeek, times: new Map() };
      byDay.set(r.dayIdx, day);
    }
    let slot = day.times.get(r.time);
    if (!slot) {
      slot = {};
      day.times.set(r.time, slot);
    }
    slot[r.location] = r.state;
  }

  const days = [...byDay.values()]
    .sort((a, b) => a.dayIdx - b.dayIdx)
    .map((day) => ({
      dayIdx: day.dayIdx,
      dayOfWeek: day.dayOfWeek,
      slots: [...day.times.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, locs]) => ({
          time, // minutes from midnight
          label: label(time),
          court1: locs[0] === 1 ? 'booked' : 'free',
          court2: locs[1] === 1 ? 'booked' : 'free',
        })),
    }));

  return NextResponse.json({ ok: true, days }, { headers: corsHeaders(origin) });
}
