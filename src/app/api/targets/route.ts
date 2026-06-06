import { NextResponse } from 'next/server';
import { fetchAllTargets } from '@/lib/targetParser';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await fetchAllTargets();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching target data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch target data' },
      { status: 500 }
    );
  }
}
