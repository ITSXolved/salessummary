import { NextRequest, NextResponse } from 'next/server';
import { fetchAllSheets, inputDateToSheetFormat } from '@/lib/parseSheets';

export const dynamic = 'force-dynamic'; // Always fetch live data

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get('date');
  const endDateRaw = searchParams.get('endDate');

  if (!date) {
    return NextResponse.json(
      { error: 'Date parameter is required (format: YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  try {
    // Convert YYYY-MM-DD to M/D/YYYY for Google Sheets matching
    const sheetDate = inputDateToSheetFormat(date);
    const sheetEndDate = endDateRaw ? inputDateToSheetFormat(endDateRaw) : undefined;
    const data = await fetchAllSheets(sheetDate, sheetEndDate);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data from Google Sheets' },
      { status: 500 }
    );
  }
}
