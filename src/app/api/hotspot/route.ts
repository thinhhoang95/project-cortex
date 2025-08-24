import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get threshold parameter from URL
    const { searchParams } = new URL(request.url);
    const threshold = searchParams.get('threshold') || '0.0';
    
    // Make API call to real backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'; // Adjust as needed
    const apiUrl = `${backendUrl}/hotspots?threshold=${threshold}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add authentication headers if needed
        // 'Authorization': `Bearer ${process.env.API_TOKEN}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Return the hotspots array sorted by z_max (highest to lowest)
    const sortedHotspots = data.hotspots?.sort((a: any, b: any) => b.z_max - a.z_max) || [];
    
    return NextResponse.json({
      hotspots: sortedHotspots,
      count: data.count || sortedHotspots.length,
      metadata: data.metadata || {}
    });
  } catch (error) {
    console.error('Error fetching hotspots:', error);
    
    // Return fallback mock data in case of error
    const mockHotspots = [
      {
        traffic_volume_id: "MASB5KL",
        time_bin: "06:00-07:00",
        z_max: 12.5,
        z_sum: 45.2,
        hourly_occupancy: 67.0,
        hourly_capacity: 55.0,
        is_overloaded: true
      },
      {
        traffic_volume_id: "TV001",
        time_bin: "08:00-09:00",
        z_max: 8.3,
        z_sum: 32.1,
        hourly_occupancy: 43.0,
        hourly_capacity: 35.0,
        is_overloaded: true
      }
    ];
    
    return NextResponse.json({
      hotspots: mockHotspots,
      count: 2,
      metadata: {
        threshold: parseFloat(threshold),
        time_bin_minutes: 15,
        analysis_type: "hourly_excess_capacity"
      },
      error: 'Using fallback data due to backend connection error'
    });
  }
}