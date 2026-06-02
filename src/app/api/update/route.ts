import { NextResponse } from 'next/server';
import { refreshSchedule } from '@/lib/schedule';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  await refreshSchedule();
  return NextResponse.json({ status: "ok" });
}
