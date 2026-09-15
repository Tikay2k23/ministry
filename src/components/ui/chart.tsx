'use client';

import { createContext, useContext, useId, useMemo, type ComponentProps, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import * as RechartsPrimitive from 'recharts';
import type { TooltipValueType } from 'recharts';
import { cn } from '@/lib/cn';

/**
 * Charts (shadcn/ui chart on Recharts, adapted to the GenTouch tokens). Each series colour comes
 * from the chart config as a `--color-<key>` variable set through `style` on the container, rather
 * than an injected <style> tag. Use the palette's `var(--chart-1)`…`var(--chart-5)` (globals.css),
 * and never a design-token name such as "muted" or "line" as a series key.
 *
 * Keep charts few and calm (docs/04): counts and coverage over time, never rankings of people.
 */

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
type TooltipNameType = number | string;

export type ChartConfig = Record<string, { label?: ReactNode; icon?: ComponentType; color?: string }>;

const ChartContext = createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

function ChartContainer({
  id,
  className,
  style,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: ComponentProps<'div'> & {
  config: ChartConfig;
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  initialDimension?: { width: number; height: number };
}) {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;
  const colors = Object.fromEntries(Object.entries(config).flatMap(([key, item]) => (item.color ? [[`--color-${key}`, item.color]] : []))) as CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        style={{ ...colors, ...style }}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-line [&_.recharts-curve.recharts-tooltip-cursor]:stroke-line [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-line [&_.recharts-radial-bar-background-sector]:fill-ground [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-ground [&_.recharts-reference-line_[stroke='#ccc']]:stroke-line [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: ComponentProps<typeof RechartsPrimitive.Tooltip> &
  ComponentProps<'div'> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: 'line' | 'dot' | 'dashed';
    nameKey?: string;
    labelKey?: string;
  } & Omit<RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>, 'accessibilityLayer'>) {
  const { config } = useChart();

  const tooltipLabel = useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;
    if (labelFormatter) return <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>;
    if (!value) return null;
    return <div className={cn('font-medium', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div className={cn('grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-line bg-background px-2.5 py-1.5 text-xs shadow-xl', className)}>
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            return (
              <div
                key={index}
                className={cn('flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted', indicator === 'dot' && 'items-center')}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn('shrink-0 rounded-[2px] border-(--indicator-color) bg-(--indicator-color)', {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          })}
                          style={{ '--indicator-color': indicatorColor } as CSSProperties}
                        />
                      )
                    )}
                    <div className={cn('flex flex-1 justify-between leading-none', nestLabel ? 'items-end' : 'items-center')}>
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value != null && (
                        <span className="tabular font-medium text-ink">
                          {typeof item.value === 'number' ? item.value.toLocaleString('en-PH') : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: ComponentProps<'div'> & { hideIcon?: boolean; nameKey?: string } & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-4', verticalAlign === 'top' ? 'pb-3' : 'pt-3', className)}>
      {payload
        .filter((item) => item.type !== 'none')
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          return (
            <div key={index} className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted">
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

/** The config entry for a tooltip or legend item. */
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) return undefined;

  const payloadPayload = 'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null ? payload.payload : undefined;

  let configLabelKey: string = key;
  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key as keyof typeof payloadPayload] === 'string') {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent };
