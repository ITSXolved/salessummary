// Time-series parser: extracts per-day, per-CSDO point data for the analytics dashboard
import https from 'node:https';

const SHEETS = {
  nawazin: {
    url: 'https://docs.google.com/spreadsheets/d/1WMnvxF_YC0KogCb_iRtuKkbspfAqm9gBK9nYw3EdcrQ/gviz/tq?tqx=out:csv&gid=1665492496',
    dateCol: 'DATE',
    nameCol: 'CSDO NAME',
    source: 'Nawazin',
  },
  ayadi: {
    url: 'https://docs.google.com/spreadsheets/d/1Nwk3hwVHejt0_jVeclaEODbPn9ihNZDLwmv35g5vwmw/gviz/tq?tqx=out:csv&gid=1984417025',
    dateCol: 'date522',
    nameCol: 'CSDO NAME',
    source: 'Ayadi & Elite',
  },
  manager: {
    url: 'https://docs.google.com/spreadsheets/d/1YKJtyAdkIZWCPu6g4TjzI-opOgdsQmQS7KzMHQog9Yc/gviz/tq?tqx=out:csv&gid=1975625652',
    dateCol: 'DATE',
    nameCol: 'MANAGER NAME',
    source: 'Manager',
  },
} as const;

export interface CSDODayPoint {
  date: string;       // ISO: YYYY-MM-DD
  dateLabel: string;  // Display: DD/MM
  csdo: string;
  source: string;
  point: number;
  admission: number;
  income: number;
  totalSO: number;    // snapshot: total SOs under this CSDO on that day
  activeSO: number;   // snapshot: active SOs under this CSDO on that day
  totalSDO: number;   // snapshot: total SDOs under this CSDO on that day
  activeSDO: number;  // snapshot: active SDOs under this CSDO on that day
}

export interface TimeSeriesData {
  points: CSDODayPoint[];
  csdos: string[];
  dateRange: { start: string; end: string };
}

// Parse a CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Normalize M/D/YYYY or D/M/YYYY sheet format → ISO YYYY-MM-DD
function sheetDateToISO(dateStr: string): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(a) || isNaN(b) || isNaN(y)) return null;
  // Sheets format is M/D/YYYY
  const month = String(a).padStart(2, '0');
  const day = String(b).padStart(2, '0');
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${month}-${day}`;
}

function isoToLabel(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}



// Use Node's built-in https to bypass undici's hardcoded 10 s connect timeout.
// fetch() in Next.js server context uses undici which has an unchangeable
// 10 s TCP connect timeout — https.get() has no such restriction.
function fetchTextWithRetry(
  url: string,
  maxAttempts = 4,
  timeoutMs = 45_000
): Promise<string> {
  const attempt = (n: number): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const req = https.get(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Connect timeout')); });
      req.on('error', reject);
    }).catch(async (err) => {
      if (n < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * n)); // 1.5 s, 3 s, 4.5 s …
        return attempt(n + 1);
      }
      throw err;
    });

  return attempt(1);
}

async function fetchSheetTimeSeries(
  sheetKey: keyof typeof SHEETS,
  startISO: string,
  endISO: string
): Promise<CSDODayPoint[]> {
  const sheet = SHEETS[sheetKey];
  const results: CSDODayPoint[] = [];

  try {
    const csvText = await fetchTextWithRetry(sheet.url);
    if (!csvText) return results;
    const lines = csvText.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return results;

    const headers = parseCSVLine(lines[0]);

    const dateIdx = headers.findIndex((h) => h.toUpperCase() === sheet.dateCol.toUpperCase());
    const nameIdx = headers.findIndex((h) => h.toUpperCase() === sheet.nameCol.toUpperCase());

    const getColIdx = (partial: string) =>
      headers.findIndex((h) => h.toUpperCase().includes(partial.toUpperCase()));

    const todayPtIdx  = getColIdx('TODAY POINT');
    const todayAdmIdx = getColIdx('TODAY ADMISSION');
    const todayIncIdx = getColIdx('TODAY INCOME');
    const totalSOIdx  = headers.findIndex((h) =>
      h.toUpperCase().includes('TOTAL SO') && !h.toUpperCase().includes('MSO') && !h.toUpperCase().includes('SDO')
    );
    const activeSOIdx = headers.findIndex((h) =>
      h.toUpperCase().includes('ACTIVE SO') && !h.toUpperCase().includes('MSO') && !h.toUpperCase().includes('SDO')
    );
    const totalSDOIdx = headers.findIndex((h) =>
      h.toUpperCase().includes('TOTAL SDO') && !h.toUpperCase().includes('MSO')
    );
    const activeSDOIdx = headers.findIndex((h) =>
      h.toUpperCase().includes('ACTIVE SDO') && !h.toUpperCase().includes('MSO')
    );

    const val = (cols: string[], idx: number): number =>
      idx >= 0 && cols[idx] ? parseFloat(cols[idx]) || 0 : 0;

    // Group rows by date
    interface DateGroup { dateISO: string; rows: string[][] }
    const groups: DateGroup[] = [];
    let cur: DateGroup | null = null;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const rawDate = dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '';
      if (rawDate) {
        const iso = sheetDateToISO(rawDate);
        if (iso) {
          cur = { dateISO: iso, rows: [] };
          groups.push(cur);
        }
      }
      if (cur) cur.rows.push(cols);
    }

    // Filter to date range and extract each named CSDO row
    for (const group of groups) {
      if (group.dateISO < startISO || group.dateISO > endISO) continue;

      for (const cols of group.rows) {
        const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '';
        if (!name) continue;
        // Skip subtotal/total rows
        if (
          name.toUpperCase().includes('TOTAL') ||
          name.toUpperCase().includes('SUBTOTAL') ||
          name.toUpperCase() === 'DATE'
        ) continue;

        results.push({
          date: group.dateISO,
          dateLabel: isoToLabel(group.dateISO),
          csdo: name,
          source: sheet.source,
          point:     val(cols, todayPtIdx),
          admission: val(cols, todayAdmIdx),
          income:    val(cols, todayIncIdx),
          totalSO:   val(cols, totalSOIdx),
          activeSO:  val(cols, activeSOIdx),
          totalSDO:  val(cols, totalSDOIdx),
          activeSDO: val(cols, activeSDOIdx),
        });
      }
    }
  } catch (e) {
    console.error(`Error fetching time series for ${sheetKey}:`, e);
  }

  return results;
}

export async function fetchAllTimeSeries(
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<TimeSeriesData> {
  // Sequential fetches — avoids hammering Google with 3 simultaneous TLS connections
  // which causes UND_ERR_SOCKET / connect timeout errors
  const nawazin = await fetchSheetTimeSeries('nawazin', startDate, endDate);
  const ayadi   = await fetchSheetTimeSeries('ayadi',   startDate, endDate);
  const manager  = await fetchSheetTimeSeries('manager', startDate, endDate);

  const allPoints = [...nawazin, ...ayadi, ...manager];

  // Collect unique CSDOs sorted alphabetically
  const csdoSet = new Set(allPoints.map((p) => p.csdo));
  const csdos = Array.from(csdoSet).sort();

  return {
    points: allPoints,
    csdos,
    dateRange: { start: startDate, end: endDate },
  };
}
