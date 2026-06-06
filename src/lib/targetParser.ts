import https from 'node:https';

const SPREADSHEETS = {
  nawazin: {
    id: '1WMnvxF_YC0KogCb_iRtuKkbspfAqm9gBK9nYw3EdcrQ',
    source: 'Nawazin',
  },
  ayadi: {
    id: '1Nwk3hwVHejt0_jVeclaEODbPn9ihNZDLwmv35g5vwmw',
    source: 'Ayadi & Elite',
  },
  manager: {
    id: '1YKJtyAdkIZWCPu6g4TjzI-opOgdsQmQS7KzMHQog9Yc',
    source: 'Manager',
  },
} as const;

export interface TargetEntry {
  name: string;
  source: string;
  soTarget: number;
  pointTarget: number;
  month: string;      // format YYYY-MM (e.g. 2026-05)
  monthName: string;  // e.g. "May", "June"
}

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

function normalizeMonthToNumber(monthStr: string): string {
  const m = monthStr.trim().toLowerCase();
  if (m.startsWith('jan')) return '01';
  if (m.startsWith('feb')) return '02';
  if (m.startsWith('mar')) return '03';
  if (m.startsWith('apr')) return '04';
  if (m.startsWith('may')) return '05';
  if (m.startsWith('jun')) return '06';
  if (m.startsWith('jul')) return '07';
  if (m.startsWith('aug')) return '08';
  if (m.startsWith('sep')) return '09';
  if (m.startsWith('oct')) return '10';
  if (m.startsWith('nov')) return '11';
  if (m.startsWith('dec')) return '12';
  return '';
}

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
        await new Promise((r) => setTimeout(r, 1500 * n)); // Exponential backoff
        return attempt(n + 1);
      }
      throw err;
    });

  return attempt(1);
}

async function fetchSheetTargets(sheetKey: keyof typeof SPREADSHEETS): Promise<TargetEntry[]> {
  const info = SPREADSHEETS[sheetKey];
  const url = `https://docs.google.com/spreadsheets/d/${info.id}/gviz/tq?tqx=out:csv&sheet=Target`;
  const results: TargetEntry[] = [];

  try {
    const csvText = await fetchTextWithRetry(url);
    if (!csvText) return results;

    const lines = csvText.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return results;

    // First column is name, second is SO target, third is POINT target, fourth is Month
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 4) continue;

      const name = cols[0].trim();
      // Skip empty or header/total rows
      if (
        !name ||
        name.toUpperCase().includes('TOTAL') ||
        name.toUpperCase().includes('SUBTOTAL') ||
        name.toUpperCase() === 'TARGET' ||
        name.toUpperCase() === 'DATE'
      ) {
        continue;
      }

      const soTarget = parseFloat(cols[1]) || 0;
      const pointTarget = parseFloat(cols[2]) || 0;
      const monthRaw = cols[3].trim();
      const monthNum = normalizeMonthToNumber(monthRaw);

      if (!monthNum) continue;

      // Map to 2026 as that is our active dataset year
      const monthKey = `2026-${monthNum}`;
      const monthName = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).toLowerCase();

      results.push({
        name,
        source: info.source,
        soTarget,
        pointTarget,
        month: monthKey,
        monthName,
      });
    }
  } catch (error) {
    console.error(`Error fetching target for ${sheetKey}:`, error);
  }

  return results;
}

export async function fetchAllTargets(): Promise<TargetEntry[]> {
  const [nawazin, ayadi, manager] = await Promise.all([
    fetchSheetTargets('nawazin'),
    fetchSheetTargets('ayadi'),
    fetchSheetTargets('manager'),
  ]);

  return [...nawazin, ...ayadi, ...manager];
}
