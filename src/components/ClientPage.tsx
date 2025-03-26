'use client';

import { useState } from 'react';
import DayNavigator from './DayNavigator';

function minutesToTime(min: number): string {
    const hour = Math.floor(min / 60);
    const minute = min % 60;
    if (minute === 0) {
      return `${hour}-${hour+1}`;
    } else {
      return '';
    }
}
 

export default function ClientPage({ days, scheduleData }: { days: string[]; scheduleData: any[] }) {
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const currentDay = days[currentDayIndex];
  const times = Array.from(new Set(scheduleData.map((item) => item.time))).sort((a, b) => a - b);

  return (
    <div className="p-4">
      <DayNavigator days={days} selectedIndex={currentDayIndex} onChange={setCurrentDayIndex} />

      <table className="w-full border-collapse border text-center text-sm font-sans">
        <thead>
          <tr>
            <th className="border p-1 align-middle bg-gray-100">Ora</th>
            <th className="border p-1 bg-gray-50 border-l-4">Teren 1</th>
            <th className="border p-1 bg-gray-50 border-l-4">Teren 2</th>
          </tr>
        </thead>
        <tbody>
        {times.map((time) => {
            const rows = scheduleData.filter(
                (row) => row.dayOfWeek === currentDay && row.time === time
            );

            const teren1 = rows.find((r) => r.location === 0);
            const teren2 = rows.find((r) => r.location === 1);

            return (
                <tr key={time}>
                  {time % 60 === 0 && (
                    <td className="border p-1 align-middle text-sm text-gray-700 bg-gray-50" rowSpan={2}>
                      {minutesToTime(time)}
                    </td>
                  )}
                  <td className={`p-1 text-xs border-l-4 ${time % 60 === 0?'border-t':'border-b'} ${teren1?.state === 0 ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                    
                  </td>
                  <td className={`p-1 text-xs border-l-4 ${time % 60 === 0?'border-t':'border-b'} ${teren2?.state === 0 ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                  </td>
                </tr>
              );
            
        })}
        </tbody>
      </table>
    </div>
  );
}