'use client';

import { useState } from 'react';
import { SheetData, formatNumber, generateReportText, ReportData } from '@/lib/parseSheets';

function MetricRow({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${highlight ? 'highlight' : ''}`}>{value}</span>
    </div>
  );
}

function ReportSection({
  title,
  data,
  variant,
  showSDO,
  showMSO,
  showIncome,
}: {
  title: string;
  data: SheetData | null;
  variant: string;
  showSDO?: boolean;
  showMSO?: boolean;
  showIncome?: boolean;
}) {
  if (!data) {
    return (
      <div className={`report-card ${variant}`}>
        <h2>{title}</h2>
        <p className="no-data">No data available for this date</p>
      </div>
    );
  }

  return (
    <div className={`report-card ${variant}`}>
      <h2>{title}</h2>

      <div className="metrics-group">
        <div className="metrics-group-title">Today</div>
        <MetricRow label="Today Admission" value={data.todayAdmission} highlight />
        {showIncome !== false && (
          <MetricRow label="Today Income" value={formatNumber(data.todayIncome)} highlight />
        )}
        <MetricRow label="Today Point" value={data.todayPoint} highlight />
      </div>

      <div className="divider" />

      <div className="metrics-group">
        <div className="metrics-group-title">Month</div>
        <MetricRow label="Month Admission" value={data.monthAdmission} highlight />
        <MetricRow label="Month Income" value={formatNumber(data.monthIncome)} highlight />
        <MetricRow label="Month Point" value={data.monthPoint} highlight />
      </div>

      <div className="divider" />

      <div className="metrics-group">
        <div className="metrics-group-title">Admissions by Source</div>
        <MetricRow label="Raihan Admission" value={data.raihanAdmission} />
        <MetricRow label="Zealy Admission" value={data.zealyAdmission} />
        <MetricRow label="AGS Admission" value={data.agsAdmission} />
      </div>

      <div className="divider" />

      <div className="metrics-group">
        <div className="metrics-group-title">Team</div>
        <MetricRow label="Total SO" value={data.totalSO} />
        <MetricRow label="Active SO" value={data.activeSO} />
        {showSDO && (
          <>
            <MetricRow label="Total SDO" value={data.totalSDO} />
            <MetricRow label="Active SDO" value={data.activeSDO} />
          </>
        )}
        {showMSO && (
          <>
            <MetricRow label="Total MSO" value={data.totalMSO} />
            <MetricRow label="Active MSO" value={data.activeMSO} />
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchReport = async () => {
    if (!date) return;
    setLoading(true);
    setError('');
    setReport(null);

    try {
      let url = `/api/sheets?date=${date}`;
      if (endDate) {
        url += `&endDate=${endDate}`;
      }
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch report data');
      const data: ReportData = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fetchReport();
  };

  const getWhatsAppUrl = () => {
    if (!report) return '#';
    const text = generateReportText(report);
    return `https://wa.me/919037984958?text=${encodeURIComponent(text)}`;
  };

  const copyReport = async () => {
    if (!report) return;
    const text = generateReportText(report);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalIncome =
    (report?.nawazin?.monthIncome || 0) +
    (report?.ayadi?.monthIncome || 0) +
    (report?.manager?.monthIncome || 0);
  const totalAdmission =
    (report?.nawazin?.monthAdmission || 0) +
    (report?.ayadi?.monthAdmission || 0) +
    (report?.manager?.monthAdmission || 0);
  const totalMonthPoint =
    (report?.nawazin?.monthPoint || 0) +
    (report?.ayadi?.monthPoint || 0) +
    (report?.manager?.monthPoint || 0);
  const totalRaihan =
    (report?.nawazin?.raihanAdmission || 0) +
    (report?.ayadi?.raihanAdmission || 0) +
    (report?.manager?.raihanAdmission || 0);
  const totalZealy =
    (report?.nawazin?.zealyAdmission || 0) +
    (report?.ayadi?.zealyAdmission || 0) +
    (report?.manager?.zealyAdmission || 0);
  const totalAgs =
    (report?.nawazin?.agsAdmission || 0) +
    (report?.ayadi?.agsAdmission || 0) +
    (report?.manager?.agsAdmission || 0);

  // Format display date
  const formatDisplayDate = (d: string) => {
    const parts = d.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0].slice(-2)}`;
    }
    return d;
  };

  const getDisplayDateRange = () => {
    if (!report) return '';
    let text = formatDisplayDate(report.date);
    if (report.endDate) {
      text += ` to ${formatDisplayDate(report.endDate)}`;
    }
    return text;
  };

  return (
    <main className="container">
      <header className="header">
        <h1>Daily Report Generator</h1>
        <p>Live data from Google Sheets</p>
        <a
          href="/dashboard"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            marginTop: '1rem',
            padding: '0.5rem 1.25rem',
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: '20px',
            color: '#a78bfa',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            textDecoration: 'none',
            letterSpacing: '0.01em',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(99,102,241,0.22)';
            (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(99,102,241,0.12)';
            (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
          }}
        >
          📈 Growth Dashboard
        </a>
      </header>

      <div className="date-section">
        <label>Select Report Date(s)</label>
        <div className="date-row">
          <div className="date-input-group">
             <label htmlFor="report-date" style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.2rem', display: 'block' }}>From Date</label>
             <input
               id="report-date"
               type="date"
               value={date}
               onChange={(e) => setDate(e.target.value)}
               onKeyDown={handleKeyDown}
             />
          </div>
          <div className="date-input-group">
             <label htmlFor="end-date" style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.2rem', display: 'block' }}>To Date (Optional)</label>
             <input
               id="end-date"
               type="date"
               value={endDate}
               onChange={(e) => setEndDate(e.target.value)}
               onKeyDown={handleKeyDown}
             />
          </div>
          <button
            className="btn-generate"
            onClick={fetchReport}
            disabled={!date || loading}
          >
            {loading ? 'Fetching...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading">
          <div className="loading-spinner" />
          <p>Fetching live data from Google Sheets...</p>
        </div>
      )}

      {error && (
        <div className="error">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {report && (
        <div className="report">
          <div className="report-date">
            <div className="live-badge">
              <span className="live-dot" />
              Live Data
            </div>
            <h2>
              Daily Report: <span>{getDisplayDateRange()}</span>
            </h2>
          </div>

          <ReportSection
            title="Nawazin"
            data={report.nawazin}
            variant="nawazin"
            showSDO
          />

          <ReportSection
            title="AYADI & ELITE"
            data={report.ayadi}
            variant="ayadi"
            showSDO
            showMSO
          />

          <ReportSection
            title="Manager"
            data={report.manager}
            variant="manager"
          />

          {/* Totals */}
          <div className="report-card totals">
            <h2>📊 Grand Totals</h2>
            <div className="metrics-group">
              <MetricRow label="Total Income" value={formatNumber(totalIncome)} highlight />
              <MetricRow label="Total Admission" value={totalAdmission} highlight />
              <MetricRow label="Total Month Point" value={totalMonthPoint} highlight />
            </div>
            <div className="divider" />
            <div className="metrics-group">
              <div className="metrics-group-title">Combined Admissions by Source</div>
              <MetricRow label="Total Raihan Admission" value={totalRaihan} />
              <MetricRow label="Total Zealy Admission" value={totalZealy} />
              <MetricRow label="Total AGS Admission" value={totalAgs} />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="whatsapp-section">
            <a
              href={getWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-whatsapp"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Send to WhatsApp
            </a>
            <button
              className={`btn-copy ${copied ? 'copied' : ''}`}
              onClick={copyReport}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
