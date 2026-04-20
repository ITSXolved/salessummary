'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LabelList,
} from 'recharts';
import { TimeSeriesData } from '@/lib/timeSeriesParser';

// ─── Colour palette for CSDO lines ────────────────────────────────────────────
const PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  '#a855f7', '#eab308', '#3b82f6', '#22c55e', '#fb923c',
];

function csodoColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChartDatum {
  date: string;
  dateLabel: string;
  [csdo: string]: string | number;
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
function CustomTooltip({
  active,
  payload,
  label,
  metric,
  selectedCSDOs,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  metric: string;
  selectedCSDOs: string[];
}) {
  if (!active || !payload || !payload.length) return null;
  const metricLabel = metric === 'point' ? 'Points' : metric === 'admission' ? 'Admissions' : 'Income';

  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      {payload
        .filter((p) => selectedCSDOs.includes(p.name) || selectedCSDOs.length === 0)
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <div key={p.name} className="tooltip-row">
            <span className="tooltip-dot" style={{ background: p.color }} />
            <span className="tooltip-name">{p.name}</span>
            <span className="tooltip-val">
              {metric === 'income' ? `₹${p.value.toLocaleString('en-IN')}` : p.value}
            </span>
          </div>
        ))}
      <div className="tooltip-meta">{metricLabel}</div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState('2026-03-15');
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<TimeSeriesData | null>(null);
  const [selectedCSDOs, setSelectedCSDOs] = useState<string[]>([]);
  const [metric, setMetric] = useState<'point' | 'admission' | 'income'>('point');
  const [chartType, setChartType] = useState<'line' | 'area'>('area');
  const [sourceFilter, setSourceFilter] = useState<string>('All');

  const chartRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    setData(null);
    setSelectedCSDOs([]);
    try {
      const res = await fetch(`/api/timeseries?startDate=${startDate}&endDate=${endDate}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch data');
      const json: TimeSeriesData = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // ── Auto-fetch when dates change (debounced 600 ms) ─────────────────────────
  // This ensures SO/SDO chart + time-series always reflect the selected date range
  // without requiring the user to manually click "Fetch Data" after every date change.
  useEffect(() => {
    if (!startDate || !endDate) return;
    const timer = setTimeout(() => { fetchData(); }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // ── Derived: all unique dates in range (sorted) ──────────────────────────────
  const allDates = useMemo(() => {
    if (!data) return [];
    const dateSet = new Set(data.points.map((p) => p.date));
    return Array.from(dateSet).sort();
  }, [data]);

  // ── Available CSDOs after source filter ──────────────────────────────────────
  const filteredCSDOs = useMemo(() => {
    if (!data) return [];
    const points = sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);
    const nameSet = new Set(points.map((p) => p.csdo));
    return Array.from(nameSet).sort();
  }, [data, sourceFilter]);

  // ── Available sources ─────────────────────────────────────────────────────────
  const sources = useMemo(() => {
    if (!data) return [];
    return ['All', ...Array.from(new Set(data.points.map((p) => p.source))).sort()];
  }, [data]);

  // ── Which CSDOs to actually draw ─────────────────────────────────────────────
  const activeCSDOs = useMemo(() => {
    const pool = filteredCSDOs;
    return selectedCSDOs.length > 0 ? selectedCSDOs.filter((c) => pool.includes(c)) : pool;
  }, [filteredCSDOs, selectedCSDOs]);

  // ── Build chart data ─────────────────────────────────────────────────────────
  // Default (no selection): single summed "Total" line across all CSDOs
  // Filtered (1+ selected):  one line per selected CSDO
  const isAggregateMode = selectedCSDOs.length === 0;

  const chartData: ChartDatum[] = useMemo(() => {
    if (!data || allDates.length === 0) return [];

    // Build lookup: date → csdo → metric value
    const lookup: Record<string, Record<string, number>> = {};
    const filteredPoints =
      sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);

    for (const p of filteredPoints) {
      if (!lookup[p.date]) lookup[p.date] = {};
      lookup[p.date][p.csdo] = (lookup[p.date][p.csdo] || 0) + p[metric];
    }

    return allDates.map((date) => {
      const label = date.slice(8, 10) + '/' + date.slice(5, 7);
      const row: ChartDatum = { date, dateLabel: label };

      if (isAggregateMode) {
        // Sum every CSDO in the filtered pool
        const total = filteredCSDOs.reduce((sum, c) => sum + (lookup[date]?.[c] ?? 0), 0);
        row['__total__'] = total;
      } else {
        // One column per selected CSDO
        for (const csdo of activeCSDOs) {
          row[csdo] = lookup[date]?.[csdo] ?? 0;
        }
      }
      return row;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, allDates, activeCSDOs, filteredCSDOs, metric, sourceFilter, isAggregateMode]);

  // ── Summary stats ────────────────────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    if (!data || activeCSDOs.length === 0) return null;
    const filteredPoints =
      sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);

    const totals: Record<string, number> = {};
    for (const p of filteredPoints) {
      if (!activeCSDOs.includes(p.csdo)) continue;
      totals[p.csdo] = (totals[p.csdo] || 0) + p[metric];
    }

    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const maxEntry = entries[0];
    const minEntry = entries[entries.length - 1];
    const avg = entries.reduce((s, [, v]) => s + v, 0) / Math.max(entries.length, 1);

    return { entries, maxEntry, minEntry, avg: Math.round(avg) };
  }, [data, activeCSDOs, metric, sourceFilter]);

  // ── SO + SDO bar data: latest snapshots per CSDO across the date range ─────
  const soBarData = useMemo(() => {
    if (!data) return [];
    const filteredPoints =
      sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);

    // Collect last (latest date) snapshot per CSDO
    // We also track the MAX seen SDO ever (to detect if a CSDO's sheet tracks SDO at all)
    const latest: Record<string, {
      totalSO: number; activeSO: number;
      totalSDO: number; activeSDO: number;
      maxSDOEver: number; // non-zero means the sheet has SDO data for this CSDO
      date: string;
    }> = {};
    for (const p of filteredPoints) {
      if (!activeCSDOs.includes(p.csdo) && activeCSDOs.length > 0) continue;
      const prev = latest[p.csdo];
      if (!prev || p.date > prev.date) {
        latest[p.csdo] = {
          totalSO: p.totalSO, activeSO: p.activeSO,
          totalSDO: p.totalSDO, activeSDO: p.activeSDO,
          maxSDOEver: Math.max(prev?.maxSDOEver ?? 0, p.totalSDO, p.activeSDO),
          date: p.date,
        };
      } else {
        // Update maxSDOEver even if this isn't the latest date
        prev.maxSDOEver = Math.max(prev.maxSDOEver, p.totalSDO, p.activeSDO);
      }
    }

    return Object.entries(latest)
      .filter(([, v]) => v.totalSO > 0 || v.activeSO > 0 || v.totalSDO > 0 || v.activeSDO > 0)
      .sort((a, b) => b[1].totalSO - a[1].totalSO)
      .map(([csdo, v], idx) => ({
        csdo,
        totalSO:   v.totalSO,
        activeSO:  v.activeSO,
        totalSDO:  v.totalSDO,
        activeSDO: v.activeSDO,
        hasSDO: v.maxSDOEver > 0,  // true only if this CSDO's sheet tracks SDO
        color: csodoColor(filteredCSDOs.indexOf(csdo) >= 0 ? filteredCSDOs.indexOf(csdo) : idx),
      }));
  }, [data, activeCSDOs, filteredCSDOs, sourceFilter]);

  // Whether ANY entry in the bar data has SDO values
  const anyHasSDO = soBarData.some((d) => d.hasSDO);


  // ── Download PNG ──────────────────────────────────────────────────────────────
  const downloadPNG = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#0a0e1a',
        scale: 2,
        useCORS: true,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `csdo-growth-${startDate}-to-${endDate}.png`;
      a.click();
    } catch (e) {
      console.error('PNG export failed', e);
    }
  }, [startDate, endDate]);

  // ── Toggle CSDO selection ─────────────────────────────────────────────────────
  const toggleCSDO = (csdo: string) => {
    setSelectedCSDOs((prev) =>
      prev.includes(csdo) ? prev.filter((c) => c !== csdo) : [...prev, csdo]
    );
  };

  const clearSelection = () => setSelectedCSDOs([]);
  const selectAll = () => setSelectedCSDOs([...filteredCSDOs]);

  const metricLabel = metric === 'point' ? 'Points' : metric === 'admission' ? 'Admissions' : 'Income (₹)';
  const noData = data && data.points.length === 0;
  const chartModeLabel = isAggregateMode
    ? `Total ${metricLabel} (All CSDOs)`
    : `${metricLabel} by CSDO`;

  return (
    <div className="db-root">
      {/* ── Sidebar ── */}
      <aside className="db-sidebar">
        <div className="db-logo">
          <div className="db-logo-icon">📈</div>
          <div>
            <div className="db-logo-title">Growth Analytics</div>
            <div className="db-logo-sub">CSDO Performance</div>
          </div>
        </div>

        {/* Date Range */}
        <div className="db-panel">
          <div className="db-panel-title">📅 Date Range</div>
          <div className="db-input-group">
            <label>From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="db-input" />
          </div>
          <div className="db-input-group">
            <label>To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="db-input" />
          </div>
          <button
            className="db-btn-primary"
            onClick={fetchData}
            disabled={!startDate || !endDate || loading}
          >
            {loading ? (
              <><span className="db-spinner" /> Fetching…</>
            ) : (
              '⚡ Fetch Data'
            )}
          </button>
        </div>

        {/* Source Filter */}
        {data && (
          <div className="db-panel">
            <div className="db-panel-title">🏢 Source</div>
            <div className="db-chips">
              {sources.map((s) => (
                <button
                  key={s}
                  className={`db-chip ${sourceFilter === s ? 'active' : ''}`}
                  onClick={() => { setSourceFilter(s); setSelectedCSDOs([]); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Metric */}
        {data && (
          <div className="db-panel">
            <div className="db-panel-title">📊 Metric</div>
            <div className="db-chips vertical">
              {(['point', 'admission', 'income'] as const).map((m) => (
                <button
                  key={m}
                  className={`db-chip ${metric === m ? 'active' : ''}`}
                  onClick={() => setMetric(m)}
                >
                  {m === 'point' ? '🎯 Points' : m === 'admission' ? '🎓 Admissions' : '💰 Income'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chart Type */}
        {data && (
          <div className="db-panel">
            <div className="db-panel-title">📉 Chart Type</div>
            <div className="db-chips">
              <button className={`db-chip ${chartType === 'area' ? 'active' : ''}`} onClick={() => setChartType('area')}>Area</button>
              <button className={`db-chip ${chartType === 'line' ? 'active' : ''}`} onClick={() => setChartType('line')}>Line</button>
            </div>
          </div>
        )}

        {/* Nav back */}
        <a href="/" className="db-back-link">← Back to Report</a>
      </aside>

      {/* ── Main ── */}
      <main className="db-main">
        {/* Header */}
        <div className="db-header">
          <div>
            <h1 className="db-title">CSDO Growth Dashboard</h1>
            {data && (
              <p className="db-subtitle">
                {data.dateRange.start} → {data.dateRange.end} &nbsp;·&nbsp; {activeCSDOs.length} CSDO{activeCSDOs.length !== 1 ? 's' : ''} &nbsp;·&nbsp; {allDates.length} day{allDates.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {data && chartData.length > 0 && (
            <button className="db-btn-download" onClick={downloadPNG}>
              ⬇ Download PNG
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="db-error">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && (
          <div className="db-empty">
            <div className="db-empty-icon">📊</div>
            <h2>Select a date range to begin</h2>
            <p>Choose a date range and click <strong>Fetch Data</strong> to visualize CSDO growth over time.</p>
          </div>
        )}

        {/* No data */}
        {noData && (
          <div className="db-empty">
            <div className="db-empty-icon">🔍</div>
            <h2>No data found</h2>
            <p>No records were found for the selected date range. Try a wider range.</p>
          </div>
        )}

        {/* ── CSDO Filter Strip ── */}
        {data && filteredCSDOs.length > 0 && (
          <div className="db-csdo-strip">
            <div className="db-csdo-strip-header">
              <span className="db-csdo-strip-title">👤 CSDO Filter</span>
              <div className="db-panel-actions">
                <button className="db-link" onClick={clearSelection}>Show All</button>
                <span style={{ color: 'var(--db-muted)' }}>·</span>
                <button className="db-link" onClick={selectAll}>Select All</button>
              </div>
            </div>
            <div className="db-csdo-chips">
              {filteredCSDOs.map((csdo, idx) => {
                const isActive = selectedCSDOs.length === 0 || selectedCSDOs.includes(csdo);
                return (
                  <button
                    key={csdo}
                    className={`db-csdo-chip ${isActive ? 'active' : 'dim'}`}
                    onClick={() => toggleCSDO(csdo)}
                    style={isActive ? { borderColor: csodoColor(idx), boxShadow: `0 0 0 1px ${csodoColor(idx)}22` } : {}}
                  >
                    <span className="db-csdo-dot" style={{ background: csodoColor(idx) }} />
                    {csdo}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary Stats */}
        {summaryStats && chartData.length > 0 && (
          <div className="db-stats-row">
            <div className="db-stat-card green">
              <div className="db-stat-label">Top Performer</div>
              <div className="db-stat-value">{summaryStats.maxEntry?.[0]}</div>
              <div className="db-stat-sub">{summaryStats.maxEntry?.[1]} {metricLabel}</div>
            </div>
            <div className="db-stat-card purple">
              <div className="db-stat-label">Average {metricLabel}</div>
              <div className="db-stat-value">{summaryStats.avg.toLocaleString('en-IN')}</div>
              <div className="db-stat-sub">across {activeCSDOs.length} CSDOs</div>
            </div>
            <div className="db-stat-card amber">
              <div className="db-stat-label">Total Combined</div>
              <div className="db-stat-value">{summaryStats.entries.reduce((s, [, v]) => s + v, 0).toLocaleString('en-IN')}</div>
              <div className="db-stat-sub">{metricLabel} in range</div>
            </div>
            <div className="db-stat-card red">
              <div className="db-stat-label">Needs Attention</div>
              <div className="db-stat-value">{summaryStats.minEntry?.[0]}</div>
              <div className="db-stat-sub">{summaryStats.minEntry?.[1]} {metricLabel}</div>
            </div>
          </div>
        )}

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="db-chart-card" ref={chartRef}>
            <div className="db-chart-header">
              <div className="db-chart-title">
                {chartModeLabel}
                <span className="db-live-badge">
                  <span className="db-live-dot" />
                  Live
                </span>
                {isAggregateMode && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--db-muted)', fontWeight: 400, marginLeft: '0.25rem' }}>
                    — select CSDOs below to compare individually
                  </span>
                )}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={420}>
              {chartType === 'area' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    {isAggregateMode ? (
                      <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                      </linearGradient>
                    ) : (
                      activeCSDOs.map((csdo, idx) => (
                        <linearGradient key={csdo} id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={csodoColor(idx)} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={csodoColor(idx)} stopOpacity={0.0} />
                        </linearGradient>
                      ))
                    )}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip content={<CustomTooltip metric={metric} selectedCSDOs={activeCSDOs} />} />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '16px', color: '#94a3b8' }} />
                  {isAggregateMode ? (
                    <Area type="monotone" dataKey="__total__" name={`Total ${metricLabel}`}
                      stroke="#6366f1" strokeWidth={2.5} fill="url(#grad-total)" dot={false}
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#6366f1' }}
                    />
                  ) : (
                    activeCSDOs.map((csdo, idx) => (
                      <Area key={csdo} type="monotone" dataKey={csdo} name={csdo}
                        stroke={csodoColor(idx)} strokeWidth={2}
                        fill={`url(#grad-${idx})`} dot={false}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    ))
                  )}
                </AreaChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip content={<CustomTooltip metric={metric} selectedCSDOs={activeCSDOs} />} />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '16px', color: '#94a3b8' }} />
                  {isAggregateMode ? (
                    <Line type="monotone" dataKey="__total__" name={`Total ${metricLabel}`}
                      stroke="#6366f1" strokeWidth={2.5} dot={false}
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#6366f1' }}
                    />
                  ) : (
                    activeCSDOs.map((csdo, idx) => (
                      <Line key={csdo} type="monotone" dataKey={csdo} name={csdo}
                        stroke={csodoColor(idx)} strokeWidth={2} dot={false}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    ))
                  )}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Bottom Row: Pie + Leaderboard ── */}
        {summaryStats && summaryStats.entries.length > 0 && (
          <div className="db-bottom-grid">

            {/* Pie Chart */}
            <div className="db-chart-card db-pie-card">
              <div className="db-chart-title" style={{ marginBottom: '0.5rem' }}>
                🥧 Contribution Share
              </div>
              <p className="db-pie-subtitle">{metricLabel} · {startDate} → {endDate}</p>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={summaryStats.entries.map(([csdo, total], idx) => ({
                      name: csdo,
                      value: total,
                      color: csodoColor(filteredCSDOs.indexOf(csdo) >= 0 ? filteredCSDOs.indexOf(csdo) : idx),
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={110}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {summaryStats.entries.map(([csdo], idx) => (
                      <Cell
                        key={csdo}
                        fill={csodoColor(filteredCSDOs.indexOf(csdo) >= 0 ? filteredCSDOs.indexOf(csdo) : idx)}
                        opacity={0.9}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0];
                      const grand = summaryStats.entries.reduce((s, [, v]) => s + v, 0);
                      const pct = grand > 0 ? (((d.value as number) / grand) * 100).toFixed(1) : '0';
                      return (
                        <div className="chart-tooltip">
                          <div className="tooltip-date">{d.name}</div>
                          <div className="tooltip-row">
                            <span className="tooltip-dot" style={{ background: d.payload.color }} />
                            <span className="tooltip-name">{metricLabel}</span>
                            <span className="tooltip-val">{(d.value as number).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="tooltip-meta">{pct}% of total</div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="db-pie-legend">
                {summaryStats.entries.slice(0, 10).map(([csdo, total], idx) => {
                  const grand = summaryStats.entries.reduce((s, [, v]) => s + v, 0);
                  const pct = grand > 0 ? ((total / grand) * 100).toFixed(1) : '0';
                  const ci = filteredCSDOs.indexOf(csdo);
                  return (
                    <div key={csdo} className="db-pie-legend-row">
                      <span className="db-csdo-dot" style={{ background: csodoColor(ci >= 0 ? ci : idx) }} />
                      <span className="db-pie-legend-name">{csdo}</span>
                      <span className="db-pie-legend-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Leaderboard */}
            <div className="db-table-card">
              <div className="db-chart-title" style={{ marginBottom: '1rem' }}>🏆 Leaderboard</div>
              <table className="db-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>CSDO</th>
                    <th>Total {metricLabel}</th>
                    <th>Share</th>
                    <th>Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryStats.entries.map(([csdo, total], idx) => {
                    const share = Math.round((total / (summaryStats.entries.reduce((s, [, v]) => s + v, 0) || 1)) * 100);
                    const csodoIdx = filteredCSDOs.indexOf(csdo);
                    return (
                      <tr key={csdo} className={idx === 0 ? 'champion' : ''}>
                        <td>
                          <span className={`db-rank ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}`}>
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                          </span>
                        </td>
                        <td>
                          <span className="db-csdo-name-cell">
                            <span className="db-csdo-dot" style={{ background: csodoColor(csodoIdx >= 0 ? csodoIdx : idx) }} />
                            {csdo}
                          </span>
                        </td>
                        <td className="db-val">{total.toLocaleString('en-IN')}</td>
                        <td className="db-share">{share}%</td>
                        <td>
                          <div className="db-bar-track">
                            <div
                              className="db-bar-fill"
                              style={{
                                width: `${share}%`,
                                background: csodoColor(csodoIdx >= 0 ? csodoIdx : idx),
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* ── SO + SDO Comparison Bar Chart ── */}
        {soBarData.length > 0 && (
          <div className="db-chart-card">
            <div className="db-chart-header">
              <div className="db-chart-title">
                👥 {anyHasSDO ? 'SO & SDO Breakdown' : 'SO Breakdown'} per CSDO
                <span style={{ fontSize: '0.7rem', color: 'var(--db-muted)', fontWeight: 400 }}>
                   — as of {soBarData[0] ? endDate : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--db-muted)' }}>
                {[
                  { color: '#6366f1', label: 'Total SO' },
                  { color: '#818cf8', label: 'Active SO' },
                  ...(anyHasSDO ? [
                    { color: '#f59e0b', label: 'Total SDO' },
                    { color: '#34d399', label: 'Active SDO' },
                  ] : []),
                ].map(({ color, label }) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={Math.max(300, soBarData.length * 58)}>
              <BarChart
                data={soBarData}
                layout="vertical"
                margin={{ top: 4, right: 64, left: 8, bottom: 4 }}
                barCategoryGap="22%"
                barGap={3}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="csdo"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const get = (key: string) => (payload.find(p => p.dataKey === key)?.value as number) ?? 0;
                    const tSO  = get('totalSO'),  aSO  = get('activeSO');
                    const tSDO = get('totalSDO'), aSDO = get('activeSDO');
                    return (
                      <div className="chart-tooltip">
                        <div className="tooltip-date">{label}</div>
                        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.3rem', marginBottom: '0.3rem' }}>
                          <div className="tooltip-row">
                            <span className="tooltip-dot" style={{ background: '#6366f1' }} />
                            <span className="tooltip-name">Total SO</span>
                            <span className="tooltip-val">{tSO}</span>
                          </div>
                          <div className="tooltip-row">
                            <span className="tooltip-dot" style={{ background: '#818cf8' }} />
                            <span className="tooltip-name">Active SO</span>
                            <span className="tooltip-val">{aSO}</span>
                          </div>
                          <div className="tooltip-row">
                            <span className="tooltip-dot" style={{ background: 'rgba(99,102,241,0.3)' }} />
                            <span className="tooltip-name">Inactive SO</span>
                            <span className="tooltip-val">{Math.max(0, tSO - aSO)}</span>
                          </div>
                        </div>
                        {anyHasSDO && tSDO > 0 && (
                          <div>
                            <div className="tooltip-row">
                              <span className="tooltip-dot" style={{ background: '#f59e0b' }} />
                              <span className="tooltip-name">Total SDO</span>
                              <span className="tooltip-val">{tSDO}</span>
                            </div>
                            <div className="tooltip-row">
                              <span className="tooltip-dot" style={{ background: '#34d399' }} />
                              <span className="tooltip-name">Active SDO</span>
                              <span className="tooltip-val">{aSDO}</span>
                            </div>
                            <div className="tooltip-row">
                              <span className="tooltip-dot" style={{ background: 'rgba(245,158,11,0.3)' }} />
                              <span className="tooltip-name">Inactive SDO</span>
                              <span className="tooltip-val">{Math.max(0, tSDO - aSDO)}</span>
                            </div>
                          </div>
                        )}
                        <div className="tooltip-meta">
                          SO active: {tSO > 0 ? Math.round((aSO / tSO) * 100) : 0}%
                          {anyHasSDO && tSDO > 0 && <>&nbsp;&nbsp;SDO active: {Math.round((aSDO / tSDO) * 100)}%</>}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="totalSO"  name="Total SO"  fill="#6366f1" radius={[0, 3, 3, 0]} maxBarSize={13}>
                  <LabelList dataKey="totalSO"  position="right" style={{ fill: '#64748b', fontSize: 10 }} />
                </Bar>
                <Bar dataKey="activeSO" name="Active SO" fill="#818cf8" radius={[0, 3, 3, 0]} maxBarSize={13}>
                  <LabelList dataKey="activeSO" position="right" style={{ fill: '#64748b', fontSize: 10 }} />
                </Bar>
                {anyHasSDO && (
                  <>
                    <Bar dataKey="totalSDO"  name="Total SDO"  fill="#f59e0b" radius={[0, 3, 3, 0]} maxBarSize={13}>
                      <LabelList dataKey="totalSDO"  position="right" style={{ fill: '#64748b', fontSize: 10 }} />
                    </Bar>
                    <Bar dataKey="activeSDO" name="Active SDO" fill="#34d399" radius={[0, 3, 3, 0]} maxBarSize={13}>
                      <LabelList dataKey="activeSDO" position="right" style={{ fill: '#64748b', fontSize: 10 }} />
                    </Bar>
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

      </main>
    </div>
  );
}
