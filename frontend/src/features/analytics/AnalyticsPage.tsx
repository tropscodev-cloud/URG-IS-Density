import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import { Info } from 'lucide-react';
import { useCameras, useZones } from '@/features/cameras/api';
import { useAnalyticsHistoryStore } from '@/lib/state/analyticsHistoryStore';
import { formatLocalWithZone } from '@/lib/utils/time';

// Theme-token colors resolved as CSS color functions (not hardcoded hex) — these render correctly
// as SVG fill/stroke values and flip automatically with the light/dark data-theme attribute.
const COLOR_ACCENT = 'rgb(var(--color-accent))';
const COLOR_ONLINE = 'rgb(var(--color-status-online))';
const COLOR_WARNING = 'rgb(var(--color-severity-warning))';
const COLOR_CRITICAL = 'rgb(var(--color-severity-critical))';
const COLOR_MUTED = 'rgb(var(--color-fg-muted))';
const COLOR_BORDER = 'rgb(var(--color-border))';

function riskBucket(risk: number): 'Low' | 'Moderate' | 'Critical' {
  if (risk >= 0.8) return 'Critical';
  if (risk >= 0.55) return 'Moderate';
  return 'Low';
}

export function AnalyticsPage(): React.JSX.Element {
  const samples = useAnalyticsHistoryStore((s) => s.samples);
  const { data: camerasData } = useCameras();
  const { data: zonesData } = useZones();

  const trend = useMemo(
    () => samples.map((s) => ({ ts: s.ts, label: formatLocalWithZone(s.ts, 'HH:mm'), headcount: s.totalHeadcount })),
    [samples],
  );

  const latest = samples[samples.length - 1];

  const riskDistribution = useMemo(() => {
    const buckets = { Low: 0, Moderate: 0, Critical: 0 };
    const rows = latest?.perCamera ?? [];
    for (const c of rows) buckets[riskBucket(c.densityRisk)] += 1;
    const total = rows.length || 1;
    return [
      { name: 'Low', value: buckets.Low, pct: Math.round((buckets.Low / total) * 100), color: COLOR_ONLINE },
      { name: 'Moderate', value: buckets.Moderate, pct: Math.round((buckets.Moderate / total) * 100), color: COLOR_WARNING },
      { name: 'Critical', value: buckets.Critical, pct: Math.round((buckets.Critical / total) * 100), color: COLOR_CRITICAL },
    ];
  }, [latest]);

  const movingVsStatic = useMemo(() => {
    const rows = latest?.perCamera ?? [];
    const avgMoving = rows.length > 0 ? rows.reduce((sum, c) => sum + c.movementPct, 0) / rows.length : 0;
    return [
      { name: 'Moving', value: Math.round(avgMoving), color: COLOR_ACCENT },
      { name: 'Static', value: Math.round(100 - avgMoving), color: COLOR_MUTED },
    ];
  }, [latest]);

  const criticalZones = useMemo(() => {
    const zoneNameById = new Map((zonesData?.items ?? []).map((z) => [z.id, z.name] as const));
    const byZone = new Map<string, { flowSum: number; riskSum: number; n: number }>();
    // "Sustained" = averaged across every recorded sample, not just the latest instant.
    for (const snap of samples) {
      for (const c of snap.perCamera) {
        const entry = byZone.get(c.zoneId) ?? { flowSum: 0, riskSum: 0, n: 0 };
        entry.flowSum += c.flowRate;
        entry.riskSum += c.densityRisk;
        entry.n += 1;
        byZone.set(c.zoneId, entry);
      }
    }
    return Array.from(byZone.entries())
      .map(([zoneId, { flowSum, riskSum, n }]) => ({
        zone: zoneNameById.get(zoneId) ?? zoneId,
        avgFlowRate: n > 0 ? Math.round(flowSum / n) : 0,
        avgDensityRisk: n > 0 ? Math.round((riskSum / n) * 100) : 0,
      }))
      .sort((a, b) => b.avgFlowRate + b.avgDensityRisk - (a.avgFlowRate + a.avgDensityRisk))
      .slice(0, 10);
  }, [samples, zonesData]);

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-canvas p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-fg-primary">Analytics</h1>
        </div>
        <div className="mb-6 flex items-start gap-2 rounded-md border border-border bg-bg-card px-3 py-2 text-xs text-fg-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            These charts are derived live, client-side, from the same WebSocket feed the operator console reads —
            the backend&apos;s <code className="font-mono">/reports</code> endpoints are canned example data, not
            real aggregation, so they aren&apos;t used here. The buffer is in-memory (resets on page reload) and
            samples once per minute, so trend depth reflects how long this tab has been open, not a full 12h
            history yet on a fresh session. {camerasData?.items.length ?? 0} cameras, {zonesData?.items.length ?? 0}{' '}
            zones in this deployment.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="System Headcount Trend" subtitle="Total global headcount, last 12h (or since this tab opened)">
            {trend.length < 2 ? (
              <EmptyState message="Collecting samples — check back in a minute." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="headcountFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLOR_ACCENT} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={COLOR_ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} />
                  <XAxis dataKey="label" stroke={COLOR_MUTED} fontSize={11} tickLine={false} />
                  <YAxis stroke={COLOR_MUTED} fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-bg-surface))', border: `1px solid ${COLOR_BORDER}`, fontSize: 12 }} />
                  <Area type="monotone" dataKey="headcount" stroke={COLOR_ACCENT} fill="url(#headcountFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Density Risk Distribution" subtitle="% of cameras currently Low / Moderate / Critical">
            {!latest ? (
              <EmptyState message="Collecting samples — check back in a minute." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskDistribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {riskDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend
                    formatter={(name: string) => {
                      const row = riskDistribution.find((r) => r.name === name);
                      return `${name} (${row?.pct ?? 0}%)`;
                    }}
                  />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-bg-surface))', border: `1px solid ${COLOR_BORDER}`, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Moving vs Static" subtitle="Facility-wide, averaged across all cameras">
            {!latest ? (
              <EmptyState message="Collecting samples — check back in a minute." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={movingVsStatic} dataKey="value" nameKey="name" innerRadius={0} outerRadius={80}>
                    {movingVsStatic.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend formatter={(name: string) => `${name} (${movingVsStatic.find((r) => r.name === name)?.value ?? 0}%)`} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-bg-surface))', border: `1px solid ${COLOR_BORDER}`, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Top Critical Zones" subtitle="By sustained flow rate + density risk (averaged across the buffer)">
            {criticalZones.length === 0 ? (
              <EmptyState message="Collecting samples — check back in a minute." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={criticalZones} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} />
                  <XAxis type="number" stroke={COLOR_MUTED} fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="zone" stroke={COLOR_MUTED} fontSize={11} tickLine={false} width={140} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-bg-surface))', border: `1px solid ${COLOR_BORDER}`, fontSize: 12 }} />
                  <Bar dataKey="avgFlowRate" name="Avg flow rate" fill={COLOR_ACCENT} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="avgDensityRisk" name="Avg density risk %" fill={COLOR_CRITICAL} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h2 className="text-sm font-semibold text-fg-primary">{title}</h2>
      <p className="mb-2 text-[11px] text-fg-muted">{subtitle}</p>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
  return <div className="flex h-[220px] items-center justify-center text-xs text-fg-muted">{message}</div>;
}
