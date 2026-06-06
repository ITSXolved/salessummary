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
  ReferenceLine,
} from 'recharts';
import { TimeSeriesData } from '@/lib/timeSeriesParser';
import { TargetEntry } from '@/lib/targetParser';

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

// ── Snapshot types for SO/SDO per-date fetch ─────────────────────────────────
interface SnapshotCSDO {
  csdo: string;
  source: string;
  totalSO: number;
  activeSO: number;
  totalSDO: number;
  activeSDO: number;
  hasSDO: boolean;
  color: string;
}

export default function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);

  // ── Tab Management ──
  const [activeTab, setActiveTab] = useState<'analytics' | 'targets'>('analytics');

  // ── View 1: Daily Analytics states ──
  const [startDate, setStartDate] = useState('2026-03-15');
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<TimeSeriesData | null>(null);
  const [selectedCSDOs, setSelectedCSDOs] = useState<string[]>([]);
  const [metric, setMetric] = useState<'point' | 'admission' | 'income'>('point');
  const [chartType, setChartType] = useState<'line' | 'area'>('area');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [snapshotData, setSnapshotData] = useState<SnapshotCSDO[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'SO' | 'SDO' | 'both'>('SO');

  // ── View 2: Monthwise Targets states ──
  const [targets, setTargets] = useState<TargetEntry[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState('');
  const [targetTimeseries, setTargetTimeseries] = useState<TimeSeriesData | null>(null);
  const [targetTimeseriesLoading, setTargetTimeseriesLoading] = useState(false);

  const [targetMetric, setTargetMetric] = useState<'point' | 'so'>('point');
  const [targetMonthFilter, setTargetMonthFilter] = useState<string>('All');
  const [selectedTargetRow, setSelectedTargetRow] = useState<{ name: string; month: string; source: string; targetVal: number; achievedVal: number } | null>(null);
  const [drilldownMetric, setDrilldownMetric] = useState<'point' | 'so_total' | 'so_active'>('point');

  const chartRef = useRef<HTMLDivElement>(null);
  const targetChartRef = useRef<HTMLDivElement>(null);

  // ── Fetch daily analytics time-series ────────────────────────────────────────
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

  // ── Fetch SO/SDO snapshot for the selected endDate ───────────────────────────
  const fetchSnapshot = useCallback(async () => {
    if (!endDate) return;
    setSnapshotLoading(true);
    try {
      const res = await fetch(`/api/timeseries?startDate=${endDate}&endDate=${endDate}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json: TimeSeriesData = await res.json();

      // Build per-CSDO SO/SDO from the single-day points
      const map: Record<string, { totalSO: number; activeSO: number; totalSDO: number; activeSDO: number; source: string; maxSDO: number }> = {};
      for (const p of json.points) {
        const prev = map[p.csdo];
        if (!prev || p.totalSO > prev.totalSO) {
          map[p.csdo] = {
            totalSO: p.totalSO, activeSO: p.activeSO,
            totalSDO: p.totalSDO, activeSDO: p.activeSDO,
            source: p.source,
            maxSDO: Math.max(prev?.maxSDO ?? 0, p.totalSDO, p.activeSDO),
          };
        } else if (prev) {
          prev.maxSDO = Math.max(prev.maxSDO, p.totalSDO, p.activeSDO);
        }
      }

      const entries = Object.entries(map)
        .filter(([, v]) => v.totalSO > 0 || v.activeSO > 0 || v.totalSDO > 0 || v.activeSDO > 0)
        .sort((a, b) => b[1].totalSO - a[1].totalSO);

      const allCSDOs = json.csdos;
      setSnapshotData(
        entries.map(([csdo, v], idx) => ({
          csdo,
          source: v.source,
          totalSO: v.totalSO,
          activeSO: v.activeSO,
          totalSDO: v.totalSDO,
          activeSDO: v.activeSDO,
          hasSDO: v.maxSDO > 0,
          color: csodoColor(allCSDOs.indexOf(csdo) >= 0 ? allCSDOs.indexOf(csdo) : idx),
        }))
      );
    } catch {
      // silent — snapshot is supplementary
    } finally {
      setSnapshotLoading(false);
    }
  }, [endDate]);

  // ── Fetch Targets and background target achievements timeseries ───────────────
  const fetchTargetsAndAchievements = useCallback(async () => {
    setTargetsLoading(true);
    setTargetsError('');
    try {
      const res = await fetch('/api/targets', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch target configurations');
      const targetData: TargetEntry[] = await res.json();
      setTargets(targetData);

      if (targetData.length > 0) {
        const months = Array.from(new Set(targetData.map(t => t.month))).sort();
        if (months.length > 0) {
          const firstMonth = months[0];
          const lastMonth = months[months.length - 1];
          const startD = `${firstMonth}-01`;
          
          const lastMonthParts = lastMonth.split('-');
          const year = parseInt(lastMonthParts[0], 10);
          const month = parseInt(lastMonthParts[1], 10);
          const lastDay = new Date(year, month, 0).getDate();
          const endD = `${lastMonth}-${String(lastDay).padStart(2, '0')}`;

          setTargetTimeseriesLoading(true);
          try {
            const tsRes = await fetch(`/api/timeseries?startDate=${startD}&endDate=${endD}`, { cache: 'no-store' });
            if (tsRes.ok) {
              const tsData: TimeSeriesData = await tsRes.json();
              setTargetTimeseries(tsData);
            }
          } catch (e) {
            console.error('Failed to fetch target achievements timeseries', e);
          } finally {
            setTargetTimeseriesLoading(false);
          }
        }
      }
    } catch (e) {
      setTargetsError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  // ── Auto-fetch when dates change (debounced 600 ms) ─────────────────────────
  useEffect(() => {
    if (!startDate || !endDate) return;
    const timer = setTimeout(() => { fetchData(); }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // ── Auto-fetch SO/SDO snapshot whenever endDate changes ─────────────────────
  useEffect(() => {
    if (!endDate) return;
    const timer = setTimeout(() => { fetchSnapshot(); }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endDate]);

  // ── Auto-fetch target data on mount ──────────────────────────────────────────
  useEffect(() => {
    fetchTargetsAndAchievements();
  }, [fetchTargetsAndAchievements]);

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
  const isAggregateMode = selectedCSDOs.length === 0;

  const chartData: ChartDatum[] = useMemo(() => {
    if (!data || allDates.length === 0) return [];

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
        const total = filteredCSDOs.reduce((sum, c) => sum + (lookup[date]?.[c] ?? 0), 0);
        row['__total__'] = total;
      } else {
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

  // ── SO + SDO bar data ────────────────────────────────────────────────────────
  const soBarData = useMemo(() => {
    const snapshotHasSO = snapshotData.some((r) => r.totalSO > 0 || r.activeSO > 0);
    if (snapshotHasSO) {
      let rows = snapshotData;
      if (sourceFilter !== 'All') rows = rows.filter((r) => r.source === sourceFilter);
      if (activeCSDOs.length > 0) rows = rows.filter((r) => activeCSDOs.includes(r.csdo));
      return rows;
    }

    if (!data) return [];
    const filteredPoints =
      sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);

    const latest: Record<string, {
      totalSO: number; activeSO: number;
      totalSDO: number; activeSDO: number;
      maxSDOEver: number;
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
        prev.maxSDOEver = Math.max(prev.maxSDOEver, p.totalSDO, p.activeSDO);
      }
    }

    return Object.entries(latest)
      .filter(([, v]) => v.totalSO > 0 || v.activeSO > 0 || v.totalSDO > 0 || v.activeSDO > 0)
      .sort((a, b) => b[1].totalSO - a[1].totalSO)
      .map(([csdo, v], idx) => ({
        csdo,
        source: '',
        totalSO:   v.totalSO,
        activeSO:  v.activeSO,
        totalSDO:  v.totalSDO,
        activeSDO: v.activeSDO,
        hasSDO: v.maxSDOEver > 0,
        color: csodoColor(filteredCSDOs.indexOf(csdo) >= 0 ? filteredCSDOs.indexOf(csdo) : idx),
      }));
  }, [snapshotData, data, activeCSDOs, filteredCSDOs, sourceFilter]);

  const anyHasSDO = soBarData.some((d) => d.hasSDO);

  // ── Activity Rate Time Series ────────────────────────────────────────────────
  const isActivityAggregate = selectedCSDOs.length === 0;

  const activityChartData = useMemo(() => {
    if (!data || allDates.length === 0) return [];
    const filteredPoints =
      sourceFilter === 'All' ? data.points : data.points.filter((p) => p.source === sourceFilter);

    const lookup: Record<string, Record<string, { tSO: number; aSO: number; tSDO: number; aSDO: number }>> = {};
    for (const p of filteredPoints) {
      if (!isActivityAggregate && !activeCSDOs.includes(p.csdo)) continue;
      if (!lookup[p.date]) lookup[p.date] = {};
      const prev = lookup[p.date][p.csdo];
      if (!prev || p.totalSO > (prev.tSO ?? 0)) {
        lookup[p.date][p.csdo] = { tSO: p.totalSO, aSO: p.activeSO, tSDO: p.totalSDO, aSDO: p.activeSDO };
      }
    }

    const pool = isActivityAggregate ? filteredCSDOs : activeCSDOs;

    return allDates.map((date) => {
      const label = date.slice(8, 10) + '/' + date.slice(5, 7);
      const row: ChartDatum = { date, dateLabel: label };

      if (isActivityAggregate) {
        let sumTSO = 0, sumASO = 0, sumTSDO = 0, sumASDO = 0;
        for (const csdo of pool) {
          const d = lookup[date]?.[csdo];
          if (!d) continue;
          sumTSO  += d.tSO;  sumASO  += d.aSO;
          sumTSDO += d.tSDO; sumASDO += d.aSDO;
        }
        if (activityFilter === 'SO' || activityFilter === 'both') {
          row['Avg SO Active Rate'] = sumTSO > 0
            ? parseFloat(((sumASO / sumTSO) * 100).toFixed(1)) : 0;
        }
        if (activityFilter === 'SDO' || activityFilter === 'both') {
          row['Avg SDO Active Rate'] = sumTSDO > 0
            ? parseFloat(((sumASDO / sumTSDO) * 100).toFixed(1)) : 0;
        }
      } else {
        for (const csdo of pool) {
          const d = lookup[date]?.[csdo];
          if (activityFilter === 'SO' || activityFilter === 'both') {
            const rate = d && d.tSO > 0 ? parseFloat(((d.aSO / d.tSO) * 100).toFixed(1)) : 0;
            row[activityFilter === 'both' ? `${csdo} SO%` : csdo] = rate;
          }
          if (activityFilter === 'SDO' || activityFilter === 'both') {
            const rate = d && d.tSDO > 0 ? parseFloat(((d.aSDO / d.tSDO) * 100).toFixed(1)) : 0;
            row[activityFilter === 'both' ? `${csdo} SDO%` : csdo] = rate;
          }
        }
      }
      return row;
    });
  }, [data, allDates, activeCSDOs, filteredCSDOs, sourceFilter, activityFilter, isActivityAggregate]);

  const activityKeys = useMemo(() => {
    if (isActivityAggregate) {
      if (activityFilter === 'SO')   return ['Avg SO Active Rate'];
      if (activityFilter === 'SDO')  return ['Avg SDO Active Rate'];
      return ['Avg SO Active Rate', 'Avg SDO Active Rate'];
    }
    if (activityFilter === 'both') {
      return activeCSDOs.flatMap((c) => [`${c} SO%`, `${c} SDO%`]);
    }
    return activeCSDOs;
  }, [isActivityAggregate, activeCSDOs, activityFilter]);

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

  const downloadTargetPNG = useCallback(async () => {
    if (!targetChartRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(targetChartRef.current, {
        backgroundColor: '#0a0e1a',
        scale: 2,
        useCORS: true,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `target-vs-achieved-${targetMonthFilter}.png`;
      a.click();
    } catch (e) {
      console.error('PNG export failed', e);
    }
  }, [targetMonthFilter]);

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


  // ── TARGET VS ACHIEVED CALCULATIONS ──────────────────────────────────────────
  
  // 1. Calculate achievements for all targets based on daily time-series
  const targetsWithAchievements = useMemo(() => {
    if (!targets || !targetTimeseries) return [];

    return targets.map(t => {
      // Find daily data points for this person in this target month
      const personPoints = targetTimeseries.points.filter(p => {
        const pName = p.csdo.trim().toUpperCase();
        const tName = t.name.trim().toUpperCase();
        return pName === tName && p.date.substring(0, 7) === t.month;
      });

      let achievedPoint = 0;
      let achievedSOTotal = 0;
      let achievedSOActive = 0;

      if (personPoints.length > 0) {
        // Points: find the maximum cumulative monthPoint, fall back to summing today's points
        const maxMonthPt = Math.max(...personPoints.map(p => p.monthPoint || 0));
        const sumTodayPt = personPoints.reduce((sum, p) => sum + (p.point || 0), 0);
        achievedPoint = Math.max(maxMonthPt, sumTodayPt);

        // SO: take snapshot from the latest chronological date in the month
        const sortedPoints = [...personPoints].sort((a, b) => a.date.localeCompare(b.date));
        const latest = sortedPoints[sortedPoints.length - 1];
        achievedSOTotal = latest ? latest.totalSO : 0;
        achievedSOActive = latest ? latest.activeSO : 0;
      }

      return {
        ...t,
        achievedPoint,
        achievedSOTotal,
        achievedSOActive,
      };
    });
  }, [targets, targetTimeseries]);

  // Unique target months available
  const targetMonths = useMemo(() => {
    return Array.from(new Set(targets.map(t => t.month))).sort();
  }, [targets]);

  // Filter targets by selected Sidebar configurations
  const filteredTargets = useMemo(() => {
    return targetsWithAchievements.filter(t => {
      const matchesSource = sourceFilter === 'All' || t.source === sourceFilter;
      const matchesMonth = targetMonthFilter === 'All' || t.month === targetMonthFilter;
      return matchesSource && matchesMonth;
    });
  }, [targetsWithAchievements, sourceFilter, targetMonthFilter]);

  // Month-wise aggregated metrics ("For All")
  const monthlyAggregates = useMemo(() => {
    const aggregates: Record<string, {
      month: string;
      monthName: string;
      targetPoint: number;
      achievedPoint: number;
      targetSO: number;
      achievedSOTotal: number;
      achievedSOActive: number;
    }> = {};

    const pool = sourceFilter === 'All' ? targetsWithAchievements : targetsWithAchievements.filter(t => t.source === sourceFilter);

    for (const t of pool) {
      if (!aggregates[t.month]) {
        aggregates[t.month] = {
          month: t.month,
          monthName: t.monthName,
          targetPoint: 0,
          achievedPoint: 0,
          targetSO: 0,
          achievedSOTotal: 0,
          achievedSOActive: 0
        };
      }
      aggregates[t.month].targetPoint += t.pointTarget;
      aggregates[t.month].achievedPoint += t.achievedPoint;
      aggregates[t.month].targetSO += t.soTarget;
      aggregates[t.month].achievedSOTotal += t.achievedSOTotal;
      aggregates[t.month].achievedSOActive += t.achievedSOActive;
    }

    return Object.values(aggregates).sort((a, b) => a.month.localeCompare(b.month));
  }, [targetsWithAchievements, sourceFilter]);

  // Calculate target stats summary cards
  const targetSummaryStats = useMemo(() => {
    if (filteredTargets.length === 0) return null;

    let targetTotal = 0;
    let achievedTotal = 0;
    let achievedActiveTotal = 0;

    for (const t of filteredTargets) {
      if (targetMetric === 'point') {
        targetTotal += t.pointTarget;
        achievedTotal += t.achievedPoint;
      } else {
        targetTotal += t.soTarget;
        achievedTotal += t.achievedSOTotal;
        achievedActiveTotal += t.achievedSOActive;
      }
    }

    const progress = targetTotal > 0 ? Math.round((achievedTotal / targetTotal) * 100) : 0;
    const activeProgress = targetTotal > 0 ? Math.round((achievedActiveTotal / targetTotal) * 100) : 0;

    return {
      targetTotal,
      achievedTotal,
      achievedActiveTotal,
      progress,
      activeProgress
    };
  }, [filteredTargets, targetMetric]);

  // Daily detailed progression for drill-down view
  const selectedPersonDailyProgress = useMemo(() => {
    if (!selectedTargetRow || !targetTimeseries) return [];

    const points = targetTimeseries.points.filter(p => {
      const pName = p.csdo.trim().toUpperCase();
      const tName = selectedTargetRow.name.trim().toUpperCase();
      return pName === tName && p.date.substring(0, 7) === selectedTargetRow.month;
    });

    points.sort((a, b) => a.date.localeCompare(b.date));

    let runningSumPoints = 0;
    return points.map(p => {
      runningSumPoints += p.point || 0;
      const currentPoints = p.monthPoint || runningSumPoints;
      
      return {
        date: p.date,
        dateLabel: p.dateLabel,
        point: currentPoints,
        totalSO: p.totalSO,
        activeSO: p.activeSO
      };
    });
  }, [selectedTargetRow, targetTimeseries]);

  return (
    <div className="db-root">
      {/* ─── Sidebar ─── */}
      <aside className="db-sidebar">
        <div className="db-logo">
          <div className="db-logo-icon">📈</div>
          <div>
            <div className="db-logo-title">Growth Analytics</div>
            <div className="db-logo-sub">CSDO Performance</div>
          </div>
        </div>

        {/* View switcher tab */}
        <div className="db-panel">
          <div className="db-panel-title">🧭 View Mode</div>
          <div className="db-chips vertical" style={{ gap: '0.5rem' }}>
            <button
              className={`db-chip ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => { setActiveTab('analytics'); setSelectedTargetRow(null); }}
              style={{ textAlign: 'left', borderRadius: '8px', padding: '0.45rem 0.75rem' }}
            >
              📊 Performance Trends
            </button>
            <button
              className={`db-chip ${activeTab === 'targets' ? 'active' : ''}`}
              onClick={() => { setActiveTab('targets'); setSelectedTargetRow(null); }}
              style={{ textAlign: 'left', borderRadius: '8px', padding: '0.45rem 0.75rem' }}
            >
              🎯 Target vs Achieved
            </button>
          </div>
        </div>

        {/* Dynamic configurations based on selected tab */}
        {activeTab === 'analytics' ? (
          <>
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
                onClick={() => { fetchData(); fetchSnapshot(); }}
                disabled={!startDate || !endDate || loading || snapshotLoading}
              >
                {loading || snapshotLoading ? (
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
          </>
        ) : (
          <>
            {/* Target Metric */}
            <div className="db-panel">
              <div className="db-panel-title">📊 Target Metric</div>
              <div className="db-chips vertical">
                <button
                  className={`db-chip ${targetMetric === 'point' ? 'active' : ''}`}
                  onClick={() => { setTargetMetric('point'); setSelectedTargetRow(null); }}
                >
                  🎯 Points Target
                </button>
                <button
                  className={`db-chip ${targetMetric === 'so' ? 'active' : ''}`}
                  onClick={() => { setTargetMetric('so'); setSelectedTargetRow(null); }}
                >
                  👥 SO Target
                </button>
              </div>
            </div>

            {/* Target Month */}
            <div className="db-panel">
              <div className="db-panel-title">📅 Target Month</div>
              <div className="db-chips vertical">
                <button
                  className={`db-chip ${targetMonthFilter === 'All' ? 'active' : ''}`}
                  onClick={() => { setTargetMonthFilter('All'); setSelectedTargetRow(null); }}
                >
                  All Months
                </button>
                {targetMonths.map(m => (
                  <button
                    key={m}
                    className={`db-chip ${targetMonthFilter === m ? 'active' : ''}`}
                    onClick={() => { setTargetMonthFilter(m); setSelectedTargetRow(null); }}
                  >
                    {m === '2026-05' ? 'May 2026' : m === '2026-06' ? 'June 2026' : m}
                  </button>
                ))}
              </div>
            </div>

            {/* Source filter for targets */}
            <div className="db-panel">
              <div className="db-panel-title">🏢 Source Filter</div>
              <div className="db-chips">
                {['All', 'Nawazin', 'Ayadi & Elite', 'Manager'].map((s) => (
                  <button
                    key={s}
                    className={`db-chip ${sourceFilter === s ? 'active' : ''}`}
                    onClick={() => { setSourceFilter(s); setSelectedTargetRow(null); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Reload targets */}
            <button
              className="db-btn-primary"
              onClick={fetchTargetsAndAchievements}
              disabled={targetsLoading || targetTimeseriesLoading}
              style={{ marginTop: '0.5rem' }}
            >
              {targetsLoading || targetTimeseriesLoading ? (
                <><span className="db-spinner" /> Syncing…</>
              ) : (
                '🔄 Sync Targets'
              )}
            </button>
          </>
        )}

        {/* Nav back */}
        <a href="/" className="db-back-link">← Back to Report</a>
      </aside>

      {/* ─── Main ─── */}
      <main className="db-main">
        {/* ── TAB 1: DAILY PERFORMANCE TRENDS ── */}
        {activeTab === 'analytics' && (
          <>
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

            {/* CSDO Filter Strip */}
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

            {/* Bottom Row: Pie + Leaderboard */}
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

            {/* SO + SDO Comparison Bar Chart */}
            {soBarData.length > 0 && (
              <div className="db-chart-card" style={{ marginTop: '1.5rem' }}>
                <div className="db-chart-header">
                  <div className="db-chart-title">
                    👥 {anyHasSDO ? 'SO & SDO Breakdown' : 'SO Breakdown'} per CSDO
                    <span style={{ fontSize: '0.7rem', color: 'var(--db-muted)', fontWeight: 400 }}>
                       — as of {endDate}{snapshotLoading && <span className="db-spinner" style={{ marginLeft: '0.5rem', verticalAlign: 'middle', width: 10, height: 10 }} />}
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

            {/* SO & SDO Summary Table */}
            {soBarData.length > 0 && (
              <div className="db-chart-card" style={{ marginTop: '1.5rem' }}>
                <div className="db-chart-header" style={{ marginBottom: '1rem' }}>
                  <div className="db-chart-title">
                    📋 SO &amp; SDO Summary
                    <span style={{ fontSize: '0.7rem', color: 'var(--db-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>
                      — {sourceFilter !== 'All' ? `${sourceFilter} · ` : ''}{startDate} → {endDate}
                    </span>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="db-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>#</th>
                        <th style={{ textAlign: 'left' }}>CSDO</th>
                        <th style={{ textAlign: 'center', color: '#818cf8' }}>Total SO</th>
                        <th style={{ textAlign: 'center', color: '#6366f1' }}>Active SO</th>
                        <th style={{ textAlign: 'center', color: 'var(--db-muted)' }}>Inactive SO</th>
                        {anyHasSDO && (
                          <>
                            <th style={{ textAlign: 'center', color: '#f59e0b' }}>Total SDO</th>
                            <th style={{ textAlign: 'center', color: '#34d399' }}>Active SDO</th>
                            <th style={{ textAlign: 'center', color: 'var(--db-muted)' }}>Inactive SDO</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {soBarData.map((row, idx) => {
                        const inactiveSO  = Math.max(0, row.totalSO  - row.activeSO);
                        const inactiveSDO = Math.max(0, row.totalSDO - row.activeSDO);
                        return (
                          <tr key={row.csdo}>
                            <td>
                              <span className={`db-rank ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}`}>
                                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                              </span>
                            </td>
                            <td>
                              <span className="db-csdo-name-cell">
                                <span className="db-csdo-dot" style={{ background: row.color }} />
                                {row.csdo}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 600, color: '#818cf8' }}>{row.totalSO}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600, color: '#6366f1' }}>{row.activeSO}</td>
                            <td style={{ textAlign: 'center', color: 'var(--db-muted)' }}>{inactiveSO}</td>
                            {anyHasSDO && (
                              <>
                                <td style={{ textAlign: 'center', fontWeight: 600, color: '#f59e0b' }}>{row.hasSDO ? row.totalSDO : '—'}</td>
                                <td style={{ textAlign: 'center', fontWeight: 600, color: '#34d399' }}>{row.hasSDO ? row.activeSDO : '—'}</td>
                                <td style={{ textAlign: 'center', color: 'var(--db-muted)' }}>{row.hasSDO ? inactiveSDO : '—'}</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(99,102,241,0.06)' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#e2e8f0', paddingLeft: '0.75rem' }}>
                          Total ({soBarData.length} CSDOs)
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#818cf8' }}>
                          {soBarData.reduce((s, r) => s + r.totalSO, 0)}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#6366f1' }}>
                          {soBarData.reduce((s, r) => s + r.activeSO, 0)}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--db-muted)' }}>
                          {soBarData.reduce((s, r) => s + Math.max(0, r.totalSO - r.activeSO), 0)}
                        </td>
                        {anyHasSDO && (
                          <>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#f59e0b' }}>
                              {soBarData.reduce((s, r) => s + (r.hasSDO ? r.totalSDO : 0), 0)}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#34d399' }}>
                              {soBarData.reduce((s, r) => s + (r.hasSDO ? r.activeSDO : 0), 0)}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--db-muted)' }}>
                              {soBarData.reduce((s, r) => s + (r.hasSDO ? Math.max(0, r.totalSDO - r.activeSDO) : 0), 0)}
                            </td>
                          </>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Active rate badges */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  {(() => {
                    const totSO  = soBarData.reduce((s, r) => s + r.totalSO,  0);
                    const actSO  = soBarData.reduce((s, r) => s + r.activeSO, 0);
                    const totSDO = soBarData.reduce((s, r) => s + (r.hasSDO ? r.totalSDO  : 0), 0);
                    const actSDO = soBarData.reduce((s, r) => s + (r.hasSDO ? r.activeSDO : 0), 0);
                    const soRate  = totSO  > 0 ? Math.round((actSO  / totSO)  * 100) : 0;
                    const sdoRate = totSDO > 0 ? Math.round((actSDO / totSDO) * 100) : 0;
                    return (
                      <>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                          padding: '0.3rem 0.8rem', borderRadius: 20,
                          background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                          fontSize: '0.78rem', color: '#818cf8',
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
                          SO Active Rate: <strong style={{ color: '#e2e8f0' }}>{soRate}%</strong>
                        </span>
                        {anyHasSDO && totSDO > 0 && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.3rem 0.8rem', borderRadius: 20,
                            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                            fontSize: '0.78rem', color: '#f59e0b',
                          }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                            SDO Active Rate: <strong style={{ color: '#e2e8f0' }}>{sdoRate}%</strong>
                          </span>
                        )}
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                          padding: '0.3rem 0.8rem', borderRadius: 20,
                          background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.2)',
                          fontSize: '0.78rem', color: '#5eead4',
                        }}>
                          📅 Data as of {endDate}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Activity Rate Time Series */}
            {data && activityChartData.length > 0 && (
              <div className="db-chart-card" style={{ marginTop: '1.5rem' }}>
                <div className="db-chart-header" style={{ marginBottom: '1rem' }}>
                  <div>
                    <div className="db-chart-title">
                      📈{' '}
                      {activityFilter === 'both'
                        ? 'SO & SDO'
                        : activityFilter === 'SDO' ? 'SDO' : 'SO'}{' '}
                      Activity Rate Over Time
                      <span style={{ fontSize: '0.7rem', color: 'var(--db-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>
                        — Active ÷ Total × 100%
                      </span>
                    </div>
                    <p style={{ fontSize: '0.73rem', color: 'var(--db-muted)', margin: '0.25rem 0 0' }}>
                      {startDate} → {endDate}
                      &nbsp;·&nbsp;
                      {isActivityAggregate
                        ? <span style={{ color: '#6366f1' }}>Avg across all CSDOs — select CSDOs above to compare individually</span>
                        : <span>{activityKeys.length} CSDO series</span>
                      }
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {(['SO', 'SDO', 'both'] as const).map((f) => (
                      <button
                        key={f}
                        className={`db-chip ${activityFilter === f ? 'active' : ''}`}
                        onClick={() => setActivityFilter(f)}
                        style={{ minWidth: 52 }}
                      >
                        {f === 'both' ? 'Both' : f}
                      </button>
                    ))}
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={Math.max(300, activityKeys.length * 22 + 140)}>
                  <LineChart data={activityChartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="chart-tooltip">
                            <div className="tooltip-date">{label}</div>
                            {payload
                              .filter((p) => (p.value as number) > 0)
                              .sort((a, b) => (b.value as number) - (a.value as number))
                              .map((p) => (
                                <div key={p.name} className="tooltip-row">
                                  <span className="tooltip-dot" style={{ background: p.color as string }} />
                                  <span className="tooltip-name">{p.name}</span>
                                  <span className="tooltip-val">{p.value}%</span>
                                </div>
                              ))}
                            <div className="tooltip-meta">Activity Rate</div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', paddingTop: '12px', color: '#94a3b8' }}
                      formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                    />
                    {activityKeys.map((key, idx) => {
                      if (isActivityAggregate) {
                        const isSDO = key === 'Avg SDO Active Rate';
                        return (
                          <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={key}
                            stroke={isSDO ? '#f59e0b' : '#6366f1'}
                            strokeWidth={2.5}
                            strokeDasharray={isSDO && activityFilter === 'both' ? '6 3' : undefined}
                            dot={{ r: 3, fill: isSDO ? '#f59e0b' : '#6366f1', strokeWidth: 0 }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            connectNulls
                          />
                        );
                      }
                      const isSDOKey = key.endsWith(' SDO%') || activityFilter === 'SDO';
                      const csdo = key.replace(/ (SO|SDO)%$/, '');
                      const baseIdx = filteredCSDOs.indexOf(csdo);
                      const baseColor = csodoColor(baseIdx >= 0 ? baseIdx : idx);
                      const color = isSDOKey
                        ? csodoColor((baseIdx >= 0 ? baseIdx : idx) + 7)
                        : baseColor;
                      return (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={key}
                          stroke={color}
                          strokeWidth={activityFilter === 'both' ? (isSDOKey ? 1.5 : 2) : 2}
                          strokeDasharray={isSDOKey && activityFilter === 'both' ? '5 3' : undefined}
                          dot={false}
                          activeDot={{ r: 5, strokeWidth: 0 }}
                          connectNulls
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>

                {/* Legend hint */}
                {activityFilter === 'both' && (
                  <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--db-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ display: 'inline-block', width: 22, height: 2.5, background: '#6366f1', borderRadius: 2 }} />
                      {isActivityAggregate ? 'Avg SO Active Rate' : 'Solid = SO Activity Rate'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{
                        display: 'inline-block', width: 22, height: 0,
                        borderTop: '2px dashed #f59e0b',
                      }} />
                      {isActivityAggregate ? 'Avg SDO Active Rate' : 'Dashed = SDO Activity Rate'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── TAB 2: TARGET VS ACHIEVED ── */}
        {activeTab === 'targets' && (
          <>
            {/* Header */}
            <div className="db-header">
              <div>
                <h1 className="db-title">Monthly Target vs Achieved</h1>
                <p className="db-subtitle">
                  Live target configurations compared against monthly progress &amp; pacing
                </p>
              </div>
              {filteredTargets.length > 0 && (
                <button className="db-btn-download" onClick={downloadTargetPNG}>
                  ⬇ Download PNG
                </button>
              )}
            </div>

            {/* Error or Loading */}
            {targetsError && (
              <div className="db-error">
                <span>⚠️</span> {targetsError}
              </div>
            )}

            {(targetsLoading || targetTimeseriesLoading) && filteredTargets.length === 0 && (
              <div className="db-empty">
                <span className="db-spinner" style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--db-accent)' }} />
                <h2 style={{ marginTop: '1rem' }}>Loading target configurations...</h2>
                <p>Retrieving target metrics and daily achievements from Google Sheets.</p>
              </div>
            )}

            {/* Empty target sheet */}
            {!targetsLoading && !targetTimeseriesLoading && targets.length === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">🎯</div>
                <h2>No targets configured</h2>
                <p>Could not find target definitions in the spreadsheets. Ensure a sheet named <strong>Target</strong> exists.</p>
              </div>
            )}

            {/* Summary Stats Row */}
            {targetSummaryStats && filteredTargets.length > 0 && (
              <div className="db-stats-row">
                <div className="db-stat-card purple">
                  <div className="db-stat-label">Combined Target</div>
                  <div className="db-stat-value">
                    {targetMetric === 'point' 
                      ? targetSummaryStats.targetTotal.toLocaleString('en-IN')
                      : `${targetSummaryStats.targetTotal} SOs`}
                  </div>
                  <div className="db-stat-sub">Across selected months &amp; people</div>
                </div>

                <div className="db-stat-card green">
                  <div className="db-stat-label">Combined Achieved</div>
                  <div className="db-stat-value">
                    {targetMetric === 'point'
                      ? targetSummaryStats.achievedTotal.toLocaleString('en-IN')
                      : `${targetSummaryStats.achievedTotal} Total / ${targetSummaryStats.achievedActiveTotal} Active`}
                  </div>
                  <div className="db-stat-sub">Monthly cumulative achievements</div>
                </div>

                <div className={`db-stat-card ${
                  targetSummaryStats.progress >= 100 ? 'green' : targetSummaryStats.progress >= 70 ? 'amber' : 'red'
                }`}>
                  <div className="db-stat-label">Overall Completion</div>
                  <div className="db-stat-value">
                    {targetSummaryStats.progress}%
                    {targetMetric === 'so' && (
                      <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--db-muted)', marginLeft: '0.5rem' }}>
                        (Active: {targetSummaryStats.activeProgress}%)
                      </span>
                    )}
                  </div>
                  <div className="db-stat-sub">Achieved ÷ Target ratio</div>
                </div>
              </div>
            )}

            {/* Month-wise side-by-side comparison chart */}
            {monthlyAggregates.length > 0 && (
              <div className="db-chart-card" ref={targetChartRef}>
                <div className="db-chart-header">
                  <div className="db-chart-title">
                    📅 Month-wise Target vs Achieved ({targetMetric === 'point' ? 'Points' : 'SOs'})
                    <span className="db-live-badge">
                      <span className="db-live-dot" /> Live Pacing
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--db-muted)' }}>
                    {[
                      { color: '#6366f1', label: 'Target' },
                      ...(targetMetric === 'point' 
                        ? [{ color: '#10b981', label: 'Achieved Points' }]
                        : [
                            { color: '#10b981', label: 'Achieved Total SO' },
                            { color: '#8b5cf6', label: 'Achieved Active SO' }
                          ])
                    ].map(({ color, label }) => (
                      <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyAggregates} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="monthName" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="chart-tooltip">
                            <div className="tooltip-date">{label}</div>
                            {payload.map((p) => (
                              <div key={p.name} className="tooltip-row">
                                <span className="tooltip-dot" style={{ background: p.fill }} />
                                <span className="tooltip-name">{p.name}</span>
                                <span className="tooltip-val">{(p.value as number).toLocaleString('en-IN')}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {targetMetric === 'point' ? (
                      <>
                        <Bar dataKey="targetPoint" name="Target Points" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={45}>
                          <LabelList dataKey="targetPoint" position="top" style={{ fill: '#64748b', fontSize: 10 }} formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString('en-IN') : String(v)} />
                        </Bar>
                        <Bar dataKey="achievedPoint" name="Achieved Points" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={45}>
                          <LabelList dataKey="achievedPoint" position="top" style={{ fill: '#e2e8f0', fontSize: 10, fontWeight: 600 }} formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString('en-IN') : String(v)} />
                        </Bar>
                      </>
                    ) : (
                      <>
                        <Bar dataKey="targetSO" name="Target SOs" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={30}>
                          <LabelList dataKey="targetSO" position="top" style={{ fill: '#64748b', fontSize: 10 }} />
                        </Bar>
                        <Bar dataKey="achievedSOTotal" name="Achieved Total SO" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30}>
                          <LabelList dataKey="achievedSOTotal" position="top" style={{ fill: '#e2e8f0', fontSize: 10, fontWeight: 600 }} />
                        </Bar>
                        <Bar dataKey="achievedSOActive" name="Achieved Active SO" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={30}>
                          <LabelList dataKey="achievedSOActive" position="top" style={{ fill: '#c084fc', fontSize: 10 }} />
                        </Bar>
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Individual Breakdown Grid / Table */}
            {filteredTargets.length > 0 && (
              <div className="db-table-card" style={{ marginTop: '1.5rem' }}>
                <div className="db-chart-header" style={{ marginBottom: '1.25rem' }}>
                  <div className="db-chart-title">
                    👤 Individual Target &amp; Achievements
                    <span style={{ fontSize: '0.72rem', color: 'var(--db-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>
                      — Click any row below to view daily growth trajectory &amp; pacing
                    </span>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="db-table" style={{ minWidth: 650 }}>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Source</th>
                        <th>Month</th>
                        <th style={{ textAlign: 'right' }}>Target</th>
                        {targetMetric === 'point' ? (
                          <th style={{ textAlign: 'right' }}>Achieved</th>
                        ) : (
                          <>
                            <th style={{ textAlign: 'right', color: '#10b981' }}>Achieved Total</th>
                            <th style={{ textAlign: 'right', color: '#a78bfa' }}>Achieved Active</th>
                          </>
                        )}
                        <th style={{ textAlign: 'right' }}>Progress %</th>
                        <th style={{ width: 140 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTargets.map((row) => {
                        const targetVal = targetMetric === 'point' ? row.pointTarget : row.soTarget;
                        const achievedVal = targetMetric === 'point' ? row.achievedPoint : row.achievedSOTotal;
                        const achievedActiveVal = row.achievedSOActive;
                        const progress = targetVal > 0 ? Math.round((achievedVal / targetVal) * 100) : 0;
                        const isSelected = selectedTargetRow?.name === row.name && selectedTargetRow?.month === row.month;

                        // Progress color logic
                        const colorClass = progress >= 100 ? 'text-green' : progress >= 70 ? 'text-amber' : 'text-red';
                        const barColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#f59e0b' : '#ef4444';

                        return (
                          <tr
                            key={`${row.name}-${row.month}`}
                            onClick={() => {
                              setSelectedTargetRow({
                                name: row.name,
                                month: row.month,
                                source: row.source,
                                targetVal,
                                achievedVal
                              });
                              setDrilldownMetric(targetMetric === 'point' ? 'point' : 'so_total');
                            }}
                            className={`db-target-row-interactive ${isSelected ? 'selected' : ''}`}
                            style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                          >
                            <td style={{ fontWeight: 600, color: 'var(--db-text)' }}>
                              <span className="db-csdo-name-cell">
                                <span className="db-csdo-dot" style={{ background: isSelected ? 'var(--db-accent)' : 'var(--db-muted)' }} />
                                {row.name}
                              </span>
                            </td>
                            <td>
                              <span className="db-source-badge">{row.source}</span>
                            </td>
                            <td>
                              <span className="db-month-badge">{row.monthName}</span>
                            </td>
                            <td className="db-val" style={{ textAlign: 'right' }}>{targetVal.toLocaleString('en-IN')}</td>
                            {targetMetric === 'point' ? (
                              <td className="db-val" style={{ textAlign: 'right', color: '#e2e8f0' }}>{achievedVal.toLocaleString('en-IN')}</td>
                            ) : (
                              <>
                                <td className="db-val" style={{ textAlign: 'right', color: '#10b981' }}>{achievedVal}</td>
                                <td className="db-val" style={{ textAlign: 'right', color: '#a78bfa' }}>{achievedActiveVal}</td>
                              </>
                            )}
                            <td className={`db-val ${colorClass}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                              {progress}%
                            </td>
                            <td>
                              <div className="db-bar-track" style={{ background: 'rgba(255,255,255,0.03)', height: 8 }}>
                                <div
                                  className="db-bar-fill"
                                  style={{
                                    width: `${Math.min(100, progress)}%`,
                                    background: barColor,
                                    boxShadow: progress >= 100 ? '0 0 8px rgba(16,185,129,0.3)' : 'none'
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

            {/* Individual Detailed Cumulative Drill-down (Dynamic Chart) */}
            {selectedTargetRow && (
              <div className="db-chart-card" style={{ marginTop: '1.5rem', border: '1px solid var(--db-border-glow)' }}>
                <div className="db-chart-header" style={{ marginBottom: '1rem' }}>
                  <div>
                    <div className="db-chart-title" style={{ fontSize: '1.05rem', color: '#e2e8f0' }}>
                      📈 Daily Pacing Analysis: <strong style={{ color: 'var(--db-accent)' }}>{selectedTargetRow.name}</strong> ({selectedTargetRow.source})
                    </div>
                    <p style={{ fontSize: '0.73rem', color: 'var(--db-muted)', margin: '0.25rem 0 0' }}>
                      Month: {selectedTargetRow.month === '2026-05' ? 'May 2026' : 'June 2026'} &nbsp;·&nbsp; Target: {selectedTargetRow.targetVal.toLocaleString('en-IN')} &nbsp;·&nbsp; Achieved: {selectedTargetRow.achievedVal.toLocaleString('en-IN')}
                    </p>
                  </div>

                  {/* If SO target row, allow toggling drilldown between Total SO and Active SO */}
                  {selectedTargetRow.targetVal === rowForSo(selectedTargetRow.name, selectedTargetRow.month)?.soTarget && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className={`db-chip ${drilldownMetric === 'so_total' ? 'active' : ''}`}
                        onClick={() => setDrilldownMetric('so_total')}
                      >
                        Total SO
                      </button>
                      <button
                        className={`db-chip ${drilldownMetric === 'so_active' ? 'active' : ''}`}
                        onClick={() => setDrilldownMetric('so_active')}
                      >
                        Active SO
                      </button>
                    </div>
                  )}
                </div>

                {selectedPersonDailyProgress.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--db-muted)' }}>
                    No daily points reported for {selectedTargetRow.name} in this month range.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={selectedPersonDailyProgress} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="grad-drilldown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--db-accent)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--db-accent)" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={45} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const val = payload[0].value as number;
                          const targetVal = selectedTargetRow.targetVal;
                          const pct = targetVal > 0 ? ((val / targetVal) * 100).toFixed(1) : '0';
                          return (
                            <div className="chart-tooltip">
                              <div className="tooltip-date">Date: {label}</div>
                              <div className="tooltip-row">
                                <span className="tooltip-dot" style={{ background: 'var(--db-accent)' }} />
                                <span className="tooltip-name">Current Status</span>
                                <span className="tooltip-val">{val.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="tooltip-meta">Progress: {pct}% of monthly target</div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine
                        y={selectedTargetRow.targetVal}
                        stroke="#ef4444"
                        strokeDasharray="4 4"
                        label={{ value: 'Target Line', fill: '#ef4444', position: 'top', fontSize: 10, fontWeight: 600 }}
                      />
                      <Area
                        type="monotone"
                        dataKey={
                          drilldownMetric === 'point' 
                            ? 'point' 
                            : drilldownMetric === 'so_total' 
                              ? 'totalSO' 
                              : 'activeSO'
                        }
                        stroke="var(--db-accent)"
                        strokeWidth={2.5}
                        fill="url(#grad-drilldown)"
                        dot={{ r: 3, strokeWidth: 0, fill: 'var(--db-accent)' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
                <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                  <button className="db-link" style={{ color: 'var(--db-muted)' }} onClick={() => setSelectedTargetRow(null)}>
                    Close Drilldown Close ✕
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );

  // Small helper to lookup target configurations for row metric toggle check
  function rowForSo(name: string, month: string) {
    return targets.find(t => t.name === name && t.month === month);
  }
}
