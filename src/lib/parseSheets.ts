// Google Sheets CSV export URLs - these fetch LIVE data each time
const SHEETS = {
  nawazin: {
    url: 'https://docs.google.com/spreadsheets/d/1WMnvxF_YC0KogCb_iRtuKkbspfAqm9gBK9nYw3EdcrQ/gviz/tq?tqx=out:csv&gid=1665492496',
    dateCol: 'DATE',
    nameCol: 'CSDO NAME',
  },
  ayadi: {
    url: 'https://docs.google.com/spreadsheets/d/1Nwk3hwVHejt0_jVeclaEODbPn9ihNZDLwmv35g5vwmw/gviz/tq?tqx=out:csv&gid=1984417025',
    dateCol: 'date522',
    nameCol: 'CSDO NAME',
  },
  manager: {
    url: 'https://docs.google.com/spreadsheets/d/1YKJtyAdkIZWCPu6g4TjzI-opOgdsQmQS7KzMHQog9Yc/gviz/tq?tqx=out:csv&gid=1975625652',
    dateCol: 'DATE',
    nameCol: 'MANAGER NAME',
  },
};

export interface SheetData {
  todayAdmission: number;
  todayIncome: number;
  todayPoint: number;
  monthAdmission: number;
  monthIncome: number;
  monthPoint: number;
  totalSDO: number;
  activeSDO: number;
  totalSO: number;
  activeSO: number;
  totalMSO: number;
  activeMSO: number;
  raihanAdmission: number;
  zealyAdmission: number;
  agsAdmission: number;
}

export interface ReportData {
  nawazin: SheetData | null;
  ayadi: SheetData | null;
  manager: SheetData | null;
  date: string;
  endDate?: string;
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

// Normalize a date string from various formats to M/D/YYYY for comparison
function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  // Handle M/D/YYYY format from Google Sheets
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    return `${month}/${day}/${year}`;
  }
  return dateStr;
}

// Convert user input date (YYYY-MM-DD) to M/D/YYYY format for matching
export function inputDateToSheetFormat(inputDate: string): string {
  const parts = inputDate.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    return `${month}/${day}/${year}`;
  }
  return inputDate;
}

// Fetch and parse a single sheet, returning the subtotal row for a given date
async function fetchSheetData(
  sheetKey: keyof typeof SHEETS,
  targetDate: string,
  endDate?: string
): Promise<SheetData | null> {
  const sheet = SHEETS[sheetKey];

  try {
    const response = await fetch(sheet.url, {
      cache: 'no-store', // Always fetch live data
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${sheetKey}: ${response.status}`);
      return null;
    }

    const csvText = await response.text();
    const lines = csvText.split('\n').filter((l) => l.trim());

    if (lines.length < 2) return null;

    const headers = parseCSVLine(lines[0]);

    // Find column indexes
    const dateIdx = headers.findIndex(
      (h) => h.toUpperCase() === sheet.dateCol.toUpperCase()
    );
    const nameIdx = headers.findIndex(
      (h) => h.toUpperCase() === sheet.nameCol.toUpperCase()
    );

    const getColIdx = (partialName: string): number =>
      headers.findIndex((h) =>
        h.toUpperCase().includes(partialName.toUpperCase())
      );

    const todayAdmIdx = getColIdx('TODAY ADMISSION');
    const todayIncIdx = getColIdx('TODAY INCOME');
    const todayPtIdx = getColIdx('TODAY POINT');
    const monthAdmIdx = getColIdx('MONTH ADMISSION');
    const monthIncIdx = getColIdx('MONTH INCOME');
    const monthPtIdx = getColIdx('MONTH POINT');
    const totalSOIdx = getColIdx('TOTAL SO');
    const activeSOIdx = getColIdx('ACTIVE SO');
    const raihanIdx = getColIdx('RAIHAN');
    const zealyIdx = getColIdx('ZEALY');
    const agsIdx = getColIdx('AGS');

    // SDO/MSO columns (Nawazin has SDO, Ayadi has SDO/MSO)
    let totalSDOIdx = headers.findIndex(
      (h) => h.toUpperCase().includes('TOTAL SDO') && !h.toUpperCase().includes('MSO')
    );
    let activeSDOIdx = headers.findIndex(
      (h) => h.toUpperCase().includes('ACTIVE SDO') && !h.toUpperCase().includes('MSO')
    );

    // Check for combined SDO/MSO column (Ayadi style)
    const totalSDOMSOIdx = headers.findIndex(
      (h) => h.toUpperCase().includes('TOTAL SDO') && h.toUpperCase().includes('MSO')
    );
    const activeSDOMSOIdx = headers.findIndex(
      (h) => h.toUpperCase().includes('ACTIVE SDO') && h.toUpperCase().includes('MSO')
    );

    if (totalSDOIdx === -1) totalSDOIdx = totalSDOMSOIdx;
    if (activeSDOIdx === -1) activeSDOIdx = activeSDOMSOIdx;

    const normalizedTarget = normalizeDate(targetDate);
    const val = (cols: string[], idx: number) =>
      idx >= 0 && cols[idx] ? parseFloat(cols[idx]) || 0 : 0;

    // Step 1: Group parsed rows by date
    // Each date group = rows from when a date appears until the next date appears
    interface DateGroup {
      date: string;
      rows: string[][];
    }

    const dateGroups: DateGroup[] = [];
    let currentGroup: DateGroup | null = null;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const rowDate = dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '';

      if (rowDate !== '') {
        // New date group starts
        currentGroup = { date: normalizeDate(rowDate), rows: [] };
        dateGroups.push(currentGroup);
      }

      if (currentGroup) {
        currentGroup.rows.push(cols);
      }
      // else: rows before any date (header area/empty rows) — skip
    }

    // Step 2: Find the date groups matching our target (or target range)
    const normalizedEnd = normalizeDate(endDate || '');

    const targetTime = new Date(normalizedTarget).getTime();
    const endTime = normalizedEnd ? new Date(normalizedEnd).getTime() : targetTime;

    const targetGroups = dateGroups.filter((g) => {
      const gTime = new Date(g.date).getTime();
      return gTime >= targetTime && gTime <= endTime;
    });

    if (targetGroups.length === 0) return null;

    // Sort target groups by date so the last one in the array is the most recent
    targetGroups.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Step 3: Find the subtotal row for each group and aggregate
    const extractSubtotal = (group: DateGroup): string[] | null => {
      let subtotalRow: string[] | null = null;
      let hasSeenNamedRow = false;
      const namedRows: string[][] = [];
      for (let i = 0; i < group.rows.length; i++) {
        const cols = group.rows[i];
        const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '';
        if (name !== '') {
          hasSeenNamedRow = true;
          namedRows.push(cols);
        } else if (hasSeenNamedRow) {
          subtotalRow = cols;
          break;
        }
      }

      if (!subtotalRow && namedRows.length === 0) return null;

      if (!subtotalRow && namedRows.length === 1) {
        subtotalRow = namedRows[0];
      } else if (!subtotalRow && namedRows.length > 1) {
        const summed = [...namedRows[0]];
        for (let r = 1; r < namedRows.length; r++) {
          for (let c = 0; c < summed.length; c++) {
            if (c === dateIdx || c === nameIdx) continue;
            const existing = parseFloat(summed[c]) || 0;
            const toAdd = parseFloat(namedRows[r][c]) || 0;
            summed[c] = String(existing + toAdd);
          }
        }
        subtotalRow = summed;
      }
      return subtotalRow;
    };

    let result: SheetData | null = null;

    for (let i = 0; i < targetGroups.length; i++) {
      const group = targetGroups[i];
      const subtotalRow = extractSubtotal(group);
      if (!subtotalRow) continue;

      const isLastGroup = i === targetGroups.length - 1;

      const data: SheetData = {
        todayAdmission: val(subtotalRow, todayAdmIdx),
        todayIncome: val(subtotalRow, todayIncIdx),
        todayPoint: val(subtotalRow, todayPtIdx),
        monthAdmission: val(subtotalRow, monthAdmIdx),
        monthIncome: val(subtotalRow, monthIncIdx),
        monthPoint: val(subtotalRow, monthPtIdx),
        totalSDO: sheetKey === 'manager' ? 0 : val(subtotalRow, totalSDOIdx),
        activeSDO: sheetKey === 'manager' ? 0 : val(subtotalRow, activeSDOIdx),
        totalSO: val(subtotalRow, totalSOIdx),
        activeSO: val(subtotalRow, activeSOIdx),
        totalMSO: sheetKey === 'ayadi' ? val(subtotalRow, totalSDOMSOIdx) : 0,
        activeMSO: sheetKey === 'ayadi' ? val(subtotalRow, activeSDOMSOIdx) : 0,
        raihanAdmission: val(subtotalRow, raihanIdx),
        zealyAdmission: val(subtotalRow, zealyIdx),
        agsAdmission: val(subtotalRow, agsIdx),
      };

      if (!result) {
        result = data;
      } else {
        // Aggregate daily/source metrics across the date range
        result.todayAdmission += data.todayAdmission;
        result.todayIncome += data.todayIncome;
        result.todayPoint += data.todayPoint;
        result.raihanAdmission += data.raihanAdmission;
        result.zealyAdmission += data.zealyAdmission;
        result.agsAdmission += data.agsAdmission;

        // For cumulative/point-in-time metrics, override with the latest value
        if (isLastGroup) {
          result.monthAdmission = data.monthAdmission;
          result.monthIncome = data.monthIncome;
          result.monthPoint = data.monthPoint;
          result.totalSDO = data.totalSDO;
          result.activeSDO = data.activeSDO;
          result.totalSO = data.totalSO;
          result.activeSO = data.activeSO;
          result.totalMSO = data.totalMSO;
          result.activeMSO = data.activeMSO;
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`Error fetching ${sheetKey}:`, error);
    return null;
  }
}

// Fetch data from all 3 sheets for a given date or range
export async function fetchAllSheets(targetDate: string, endDate?: string): Promise<ReportData> {
  const [nawazin, ayadi, manager] = await Promise.all([
    fetchSheetData('nawazin', targetDate, endDate),
    fetchSheetData('ayadi', targetDate, endDate),
    fetchSheetData('manager', targetDate, endDate),
  ]);

  return { nawazin, ayadi, manager, date: targetDate, endDate };
}

// Format number with commas (Indian style)
export function formatNumber(num: number): string {
  if (num === 0) return '0';
  const str = Math.round(num).toString();
  // Indian numbering: last 3 digits, then groups of 2
  if (str.length <= 3) return str;
  const last3 = str.slice(-3);
  const remaining = str.slice(0, -3);
  const groups = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return groups + ',' + last3;
}

// Generate WhatsApp-formatted report text
export function generateReportText(data: ReportData): string {
  const { nawazin, ayadi, manager } = data;

  // Format date as DD/MM/YY
  const dateParts = data.date.split('/');
  let formattedDate = data.date;
  if (dateParts.length === 3) {
    const yy = dateParts[2].slice(-2);
    formattedDate = `${dateParts[1].padStart(2, '0')}/${dateParts[0].padStart(2, '0')}/${yy}`;
  }

  if (data.endDate) {
    const endParts = data.endDate.split('/');
    if (endParts.length === 3) {
      const yy = endParts[2].slice(-2);
      formattedDate += ` to ${endParts[1].padStart(2, '0')}/${endParts[0].padStart(2, '0')}/${yy}`;
    } else {
      formattedDate += ` to ${data.endDate}`;
    }
  }

  let text = `*Daily Report: ${formattedDate}*\n\n`;

  // Nawazin section
  if (nawazin) {
    text += `*Nawazin*\n\n`;
    text += `Admission: *${nawazin.todayAdmission}*\n`;
    text += `Income: *${formatNumber(nawazin.todayIncome)}*\n`;
    text += `Point: *${nawazin.todayPoint}*\n\n`;
    text += `Month Admission: *${nawazin.monthAdmission}*\n`;
    text += `Month Income: *${formatNumber(nawazin.monthIncome)}*\n`;
    text += `Month Point: *${nawazin.monthPoint}*\n\n`;
    text += `Total Raihan admission- ${nawazin.raihanAdmission}\n`;
    text += `Total Zealy admission -${nawazin.zealyAdmission}\n`;
    text += `Total Ags admission - ${nawazin.agsAdmission}\n\n`;
    text += `Total SO :${nawazin.totalSO}\n`;
    text += `Active SO : ${nawazin.activeSO}\n\n`;
    text += `Total SDO:${nawazin.totalSDO}\n`;
    text += `Active SDO : ${nawazin.activeSDO}\n\n`;
  } else {
    text += `*Nawazin*\n\nNo data available for this date.\n\n`;
  }

  // Ayadi & Elite section
  if (ayadi) {
    text += `*AYADI*  & *ELITE*\n\n`;
    text += `Admission: *${ayadi.todayAdmission}*\n`;
    text += `Income: *${formatNumber(ayadi.todayIncome)}*\n`;
    text += `Point: *${ayadi.todayPoint}*\n\n`;
    text += `Month Admission: *${ayadi.monthAdmission}*\n`;
    text += `Month Income: *${formatNumber(ayadi.monthIncome)}*\n`;
    text += `Month Point: *${ayadi.monthPoint}*\n\n`;
    text += `Total Raihan admission- ${ayadi.raihanAdmission}\n`;
    text += `Total Zealy admission -${ayadi.zealyAdmission}\n`;
    text += `Total Ags admission - ${ayadi.agsAdmission}\n\n`;
    text += `Total  SO :${ayadi.totalSO}\n`;
    text += `Active SO :${ayadi.activeSO}\n\n`;
    text += `Total SDO: ${ayadi.totalSDO}\n`;
    text += `Active SDO : ${ayadi.activeSDO}\n\n`;
    text += `Total  MSO :${ayadi.totalMSO}\n`;
    text += `Active MSO :${ayadi.activeMSO}\n\n`;
  } else {
    text += `*AYADI*  & *ELITE*\n\nNo data available for this date.\n\n`;
  }

  // Manager section
  if (manager) {
    text += `*Manager*\n\n`;
    text += `Admission: *${manager.todayAdmission}*\n`;
    text += `Point  : *${manager.todayPoint}*\n`;
    text += `income : *${formatNumber(manager.todayIncome)}*\n\n`;
    text += `Month admission: *${manager.monthAdmission}*\n`;
    text += `Month point: *${manager.monthPoint}*\n`;
    text += `Month income *${formatNumber(manager.monthIncome)}*\n\n`;
    text += `Total Raihan admission- *${manager.raihanAdmission}*\n`;
    text += `Total Zealy admission - *${manager.zealyAdmission}*\n`;
    text += `Total Ags admission - *${manager.agsAdmission}*\n\n`;
    text += `Total  SO :${manager.totalSO}\n`;
    text += `Active SO :${manager.activeSO}\n`;
  } else {
    text += `*Manager*\n\nNo data available for this date.\n\n`;
  }

  // Totals
  const totalIncome =
    (nawazin?.monthIncome || 0) +
    (ayadi?.monthIncome || 0) +
    (manager?.monthIncome || 0);
  const totalAdmission =
    (nawazin?.monthAdmission || 0) +
    (ayadi?.monthAdmission || 0) +
    (manager?.monthAdmission || 0);
  const totalMonthPoint =
    (nawazin?.monthPoint || 0) +
    (ayadi?.monthPoint || 0) +
    (manager?.monthPoint || 0);
  const totalRaihan =
    (nawazin?.raihanAdmission || 0) +
    (ayadi?.raihanAdmission || 0) +
    (manager?.raihanAdmission || 0);
  const totalZealy =
    (nawazin?.zealyAdmission || 0) +
    (ayadi?.zealyAdmission || 0) +
    (manager?.zealyAdmission || 0);
  const totalAgs =
    (nawazin?.agsAdmission || 0) +
    (ayadi?.agsAdmission || 0) +
    (manager?.agsAdmission || 0);

  text += `\n-------------------------------------------------------------\n`;
  text += `Total Income: *${formatNumber(totalIncome)}*\n`;
  text += `Total Admission: *${totalAdmission}*\n`;
  text += `Total Month Point: *${totalMonthPoint}*\n`;
  text += `---------------------------------------------------------------\n`;
  text += `Total Raihan admission- *${totalRaihan}*\n`;
  text += `Total Zealy admission - *${totalZealy}*\n`;
  text += `Total Ags admission - *${totalAgs}*\n`;

  return text;
}
