'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const config = {
  prayed: { label: 'Prayed', color: 'var(--chart-1)' },
  notFinished: { label: 'Covered, not finished', color: 'var(--chart-2)' },
  open: { label: 'Open', color: 'var(--chart-3)' },
} satisfies ChartConfig;

/** Slots per day: prayed, covered but not finished, and still open (docs/04 A23, "a small chart where helpful"). */
export function PrayerDaysChart({ days }: { days: { label: string; slots: number; covered: number; prayed: number }[] }) {
  const data = days.map((day) => ({
    label: day.label,
    prayed: day.prayed,
    notFinished: day.covered - day.prayed,
    open: day.slots - day.covered,
  }));

  return (
    <figure className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <figcaption className="sr-only">Prayer slots per day. The table below has the same numbers.</figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={data} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="prayed" stackId="slots" fill="var(--color-prayed)" />
          <Bar dataKey="notFinished" stackId="slots" fill="var(--color-notFinished)" />
          <Bar dataKey="open" stackId="slots" fill="var(--color-open)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
