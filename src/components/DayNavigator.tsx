'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  days: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
};

export default function DayNavigator({ days, selectedIndex, onChange }: Props) {
  const goLeft = () => onChange(Math.max(selectedIndex - 1, 0));
  const goRight = () => onChange(Math.min(selectedIndex + 1, days.length - 1));

  return (
    <div className="flex items-center justify-center space-x-4 mb-4 text-gray-200">
      <button onClick={goLeft} disabled={selectedIndex === 0} className="p-2">
        <ChevronLeft />
      </button>
      <span className="text-xl font-semibold">{days[selectedIndex]}</span>
      <button onClick={goRight} disabled={selectedIndex === days.length - 1} className="p-2">
        <ChevronRight />
      </button>
    </div>
  );
}