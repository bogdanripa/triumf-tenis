import ClientPage from '@/components/ClientPage';
import { getSchedule } from '@/lib/db';

export default async function Page() {
  const scheduleData = await getSchedule();
  const days = Array.from(new Set(scheduleData.map((item:any) => item.dayOfWeek))) as string[];
  // We'll make this part client-side for interactivity:
  return <ClientPage days={days} scheduleData={scheduleData} />;
}

export const revalidate = 60*24; // enables caching and revalidation