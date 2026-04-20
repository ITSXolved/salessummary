import { NextRequest, NextResponse } from 'next/server';
import { fetchAllTimeSeries } from '@/lib/timeSeriesParser';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'startDate and endDate are required (format: YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  try {
    const data = await fetchAllTimeSeries(startDate, endDate);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching time series data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch time series data' },
      { status: 500 }
    );
  }
}
