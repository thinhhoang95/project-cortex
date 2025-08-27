"use client";
import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, LineChart } from 'recharts';
import { useSimStore } from "@/components/useSimStore";
import HourGlass from "@/components/HourGlass";

// Use Next.js API route to avoid CORS issues

interface OccupancyData {
  traffic_volume_id: string;
  occupancy_counts: Record<string, number>;
  hourly_capacity: Record<string, number>;
  metadata: {
    time_bin_minutes: number;
    total_time_windows: number;
    total_flights_in_tv: number;
  };
}

interface ChartDataPoint {
  time: string;
  count: number;
  hour: number;
  capacity?: number;
}

interface FlightIdentifiersData {
  [timeWindow: string]: string[];
}

interface OrderedFlightsData {
  traffic_volume_id: string;
  ref_time_str: string;
  ordered_flights: string[];
  details: {
    flight_id: string;
    arrival_time: string;
    arrival_seconds: number;
    delta_seconds: number;
    time_window: string;
  }[];
}

export default function AirspaceInfo() {
  const { selectedTrafficVolume, selectedTrafficVolumeData, t, flights, focusMode, setFocusMode, setFocusFlightIds, setT } = useSimStore();
  const [occupancyData, setOccupancyData] = useState<OccupancyData | null>(null);
  const [flightIdentifiersData, setFlightIdentifiersData] = useState<FlightIdentifiersData | null>(null);
  const [orderedFlightsData, setOrderedFlightsData] = useState<OrderedFlightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [interestWindowLength, setInterestWindowLength] = useState<string>('1h');

  // Fetch data when traffic volume selection changes or time changes
  useEffect(() => {
    if (selectedTrafficVolume) {
      fetchOccupancyData(selectedTrafficVolume);
      fetchFlightIdentifiers(selectedTrafficVolume);
    } else {
      setOccupancyData(null);
      setFlightIdentifiersData(null);
      setOrderedFlightsData(null);
      setError(null);
      setFlightListError(null);
    }
  }, [selectedTrafficVolume, t]);

  const fetchOccupancyData = async (trafficVolumeId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/tv_count_with_capacity?traffic_volume_id=${trafficVolumeId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to fetch data: ${response.statusText}`);
      }
      
      const data: OccupancyData = await response.json();
      setOccupancyData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch occupancy data');
      setOccupancyData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchFlightIdentifiers = async (trafficVolumeId: string) => {
    setFlightListLoading(true);
    setFlightListError(null);
    
    try {
      // Format current time as HHMMSS for the new API
      const currentTimeStr = formatTimeForAPI(t);
      const response = await fetch(`/api/tv_flights?traffic_volume_id=${trafficVolumeId}&ref_time_str=${currentTimeStr}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to fetch flight data: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Check if we got the new ordered format or legacy format
      if (data.ordered_flights && data.details) {
        setOrderedFlightsData(data as OrderedFlightsData);
        setFlightIdentifiersData(null);
      } else {
        setFlightIdentifiersData(data as FlightIdentifiersData);
        setOrderedFlightsData(null);
      }
    } catch (err) {
      setFlightListError(err instanceof Error ? err.message : 'Failed to fetch flight identifiers');
      setFlightIdentifiersData(null);
      setOrderedFlightsData(null);
    } finally {
      setFlightListLoading(false);
    }
  };

  // Transform occupancy data for chart (rolling 60-minute sum)
  // 1) Build base bins sorted by time
  const baseChartData: ChartDataPoint[] = occupancyData ?
    Object.entries(occupancyData.occupancy_counts)
      .map(([timeRange, count]) => {
        const [startTime] = timeRange.split('-');
        const [hours, minutes] = startTime.split(':').map(Number);
        const hour = hours + minutes / 60;

        // Find the capacity for this time bin from hourly_capacity
        // hourly_capacity uses format "HH:00-HH+1:00" so we need to match the hour
        const hourKey = `${hours.toString().padStart(2, '0')}:00-${(hours + 1).toString().padStart(2, '0')}:00`;
        const capacity = occupancyData.hourly_capacity[hourKey];

        return {
          time: timeRange,
          count,
          hour,
          capacity
        };
      })
      .sort((a, b) => a.hour - b.hour)
    : [];

  // 2) Deduce bin length (minutes) from metadata when available, otherwise parse from first bin label
  const timeBinMinutes: number = (() => {
    if (!occupancyData || baseChartData.length === 0) return 60;
    const metaBin = occupancyData.metadata?.time_bin_minutes;
    if (typeof metaBin === 'number' && metaBin > 0) return metaBin;
    try {
      const firstRange = baseChartData[0].time; // e.g., "06:00-06:15"
      const [start, end] = firstRange.split('-');
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      const diff = endMinutes - startMinutes;
      return diff > 0 ? diff : 60;
    } catch (e) {
      return 60;
    }
  })();

  // 3) Compute rolling sum window size (# of bins in 60 minutes)
  const binsPerHour = Math.max(1, Math.round(60 / timeBinMinutes));

  // 4) Produce rolling-sum chart data where count = sum of this bin and the next (binsPerHour-1) bins
  const chartData: ChartDataPoint[] = baseChartData.map((_, idx) => {
    let rollingSum = 0;
    const endIdx = Math.min(idx + binsPerHour, baseChartData.length);
    for (let j = idx; j < endIdx; j++) {
      rollingSum += baseChartData[j].count;
    }
    return { ...baseChartData[idx], count: rollingSum };
  });

  // Convert current simulation time (seconds) to hours for the reference line
  const currentTimeHours = t / 3600;

  // Format flight data for table display
  const formatFlightData = () => {
    if (flights.length === 0) return [];
    
    // Use ordered flights data if available (new API), otherwise fall back to legacy format
    if (orderedFlightsData) {
      return orderedFlightsData.ordered_flights.map(flightId => {
        const flight = flights.find(f => String(f.flightId) === String(flightId));
        const detail = orderedFlightsData.details.find(d => d.flight_id === flightId);
        return {
          flightId,
          callsign: flight?.callSign || 'N/A',
          origin: flight?.origin || 'N/A',
          destination: flight?.destination || 'N/A',
          takeoffTime: flight ? formatTime(flight.t0) : 'N/A',
          arrivalTime: detail?.arrival_time || 'N/A',
          deltaSeconds: detail?.delta_seconds || 0
        };
      }).slice(0, 500); // Limit to 500 flights for performance
    }
    
    // Legacy format fallback
    if (!flightIdentifiersData) return [];
    
    const allFlightIds = new Set<string>();
    Object.values(flightIdentifiersData).forEach(timeWindowFlights => {
      timeWindowFlights.forEach(id => allFlightIds.add(id));
    });
    
    return Array.from(allFlightIds).map(flightId => {
      const flight = flights.find(f => String(f.flightId) === String(flightId));
      return {
        flightId,
        callsign: flight?.callSign || 'N/A',
        origin: flight?.origin || 'N/A',
        destination: flight?.destination || 'N/A',
        takeoffTime: flight ? formatTime(flight.t0) : 'N/A',
        arrivalTime: 'N/A',
        deltaSeconds: 0
      };
    }).slice(0, 50); // Limit to 50 flights for performance
  };

  const flightTableData = formatFlightData();

  

  // Helper function to format seconds to HH:MM format for display
  function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  // Helper function to format seconds to HHMMSS format for API
  function formatTimeForAPI(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}${secs.toString().padStart(2, '0')}`;
  }

  // Helper function to convert interest window length to seconds
  function getInterestWindowSeconds(windowLength: string): number {
    const numValue = parseInt(windowLength);
    if (windowLength.includes('h')) {
      return numValue * 3600;
    }
    return numValue * 60; // minutes
  }

  // Helper to compare Set equality by contents
  function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  // Filter data based on focus mode using useMemo to prevent infinite re-renders
  const { chartData: displayChartData, flightTableData: displayFlightTableData, filteredFlightIds } = useMemo(() => {
    if (!focusMode || !occupancyData) {
      return { 
        chartData, 
        flightTableData, 
        filteredFlightIds: new Set<string>() 
      };
    }

    const windowSeconds = getInterestWindowSeconds(interestWindowLength);
    const windowEndTime = t + windowSeconds;

    // Filter chart data to only show time bins within the interest window
    const filteredChartData = chartData.filter(dataPoint => {
      const pointTimeSeconds = dataPoint.hour * 3600;
      return pointTimeSeconds >= t && pointTimeSeconds <= windowEndTime;
    });

    const filteredFlightIds = new Set<string>();

    // Handle new ordered format
    if (orderedFlightsData) {
      orderedFlightsData.details.forEach(detail => {
        if (detail.arrival_seconds >= t && detail.arrival_seconds <= windowEndTime) {
          filteredFlightIds.add(detail.flight_id);
        }
      });
    } 
    // Handle legacy format
    else if (flightIdentifiersData) {
      Object.entries(flightIdentifiersData).forEach(([timeWindow, flightIds]) => {
        const [startTime] = timeWindow.split('-');
        const [hours, minutes] = startTime.split(':').map(Number);
        const timeWindowSeconds = hours * 3600 + minutes * 60;
        
        if (timeWindowSeconds >= t && timeWindowSeconds <= windowEndTime) {
          flightIds.forEach(id => filteredFlightIds.add(id));
        }
      });
    }

    // Create filtered flight table data; prefer ordering by proximity to current time
    let filteredFlightTableData;
    if (orderedFlightsData) {
      const filteredDetails = orderedFlightsData.details
        .filter(detail => filteredFlightIds.has(detail.flight_id))
        .sort((a, b) => Math.abs(a.delta_seconds) - Math.abs(b.delta_seconds));

      filteredFlightTableData = filteredDetails.slice(0, 500).map(detail => {
        const flightId = detail.flight_id;
        const flight = flights.find(f => String(f.flightId) === String(flightId));
        return {
          flightId,
          callsign: flight?.callSign || 'N/A',
          origin: flight?.origin || 'N/A',
          destination: flight?.destination || 'N/A',
          takeoffTime: flight ? formatTime(flight.t0) : 'N/A',
          arrivalTime: detail.arrival_time || 'N/A',
          deltaSeconds: detail.delta_seconds || 0
        };
      });
    } else {
      filteredFlightTableData = Array.from(filteredFlightIds).map(flightId => {
        const flight = flights.find(f => String(f.flightId) === String(flightId));
        return {
          flightId,
          callsign: flight?.callSign || 'N/A',
          origin: flight?.origin || 'N/A',
          destination: flight?.destination || 'N/A',
          takeoffTime: flight ? formatTime(flight.t0) : 'N/A',
          arrivalTime: 'N/A',
          deltaSeconds: 0
        };
      }).slice(0, 500);
    }

    return { 
      chartData: filteredChartData, 
      flightTableData: filteredFlightTableData, 
      filteredFlightIds 
    };
  }, [focusMode, occupancyData, chartData, flightTableData, interestWindowLength, t, flightIdentifiersData, orderedFlightsData, flights]);

  // Build arrival-time distribution for HourGlass (depends on displayFlightTableData)
  const hourGlassData = useMemo(() => {
    // Prefer ordered format with explicit arrival times
    if (orderedFlightsData && orderedFlightsData.details && displayFlightTableData.length > 0) {
      const want = new Set(displayFlightTableData.map(f => String(f.flightId)));
      const arr: string[] = [];
      for (const d of orderedFlightsData.details) {
        if (want.has(String(d.flight_id)) && d.arrival_time) {
          // Use HH:MM:SS string so HourGlass labels render as time
          arr.push(String(d.arrival_time));
        }
      }
      return arr;
    }
    // Legacy: infer from time-window bins by assigning each flight the window start time
    if (flightIdentifiersData && displayFlightTableData.length > 0) {
      const idToStart = new Map<string, string>();
      for (const [timeWindow, ids] of Object.entries(flightIdentifiersData)) {
        const start = String(timeWindow.split('-')[0] || '').trim();
        for (const id of ids) {
          if (!idToStart.has(String(id))) idToStart.set(String(id), start);
        }
      }
      const arr: string[] = [];
      for (const row of displayFlightTableData) {
        const s = idToStart.get(String(row.flightId));
        if (s) arr.push(s);
      }
      return arr;
    }
    return [] as string[];
  }, [orderedFlightsData, flightIdentifiersData, displayFlightTableData]);

  // Update focus flight IDs in store when they change
  useEffect(() => {
    // Avoid unnecessary updates and infinite loops
    if (!focusMode) return;
    const current = useSimStore.getState().focusFlightIds;
    if (!areSetsEqual(current, filteredFlightIds)) {
      setFocusFlightIds(filteredFlightIds);
    }
  }, [filteredFlightIds, setFocusFlightIds, focusMode]);

  // Find the matching x-axis category for the current time so ReferenceLine aligns with categorical XAxis
  const currentXAxisCategory = displayChartData.length
    ? (displayChartData.find(d => currentTimeHours <= d.hour) ?? displayChartData[displayChartData.length - 1]).time
    : undefined;

  // Generate capacity reference lines - group by hour and create horizontal lines
  const capacityLines = occupancyData ? 
    Object.entries(occupancyData.hourly_capacity).map(([hourRange, capacity]) => {
      const [startHour] = hourRange.split('-')[0].split(':');
      const hourNum = parseInt(startHour);
      return { hour: hourNum, capacity };
    }) : [];

  // Find the current count at the current time bin
  const currentCount = displayChartData.length
    ? (displayChartData.find(d => currentTimeHours <= d.hour) ?? displayChartData[displayChartData.length - 1]).count
    : 0;

  // Custom tick formatter for x-axis - show every 3 hours
  const formatXAxisTick = (tickItem: string, index: number) => {
    if (index % 12 === 0) { // Show every 12th item (3 hours if 15-min intervals)
      const [startTime] = tickItem.split('-');
      const [hours] = startTime.split(':').map(Number);
      return hours.toString();
    }
    return '';
  };

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number, payload?: ChartDataPoint }>; label?: string }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-800/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 text-white text-sm">
          <p className="font-medium">{label}</p>
          <p className="text-blue-300">
            Flights: <span className="font-medium">{payload[0].value}</span>
          </p>
          {data?.capacity !== undefined && (
            <p className="text-yellow-300">
              Capacity: <span className="font-medium">{data.capacity}</span>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {!selectedTrafficVolume ? (
        <div className="text-center py-8 opacity-70">
          <p className="text-sm">Click on a traffic volume to view occupancy data</p>
        </div>
      ) : (
        <>
          <div className="border-b border-white/20 pb-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-sm opacity-90">Selected Traffic Volume</h3>
                <p className="text-lg font-semibold">{selectedTrafficVolume}</p>
                {selectedTrafficVolumeData?.properties && (
                  <p className="text-xs opacity-70 mt-1">
                    FL{selectedTrafficVolumeData.properties.min_fl.toString().padStart(3, '0')}-FL{selectedTrafficVolumeData.properties.max_fl.toString().padStart(3, '0')}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  const newFocusMode = !focusMode;
                  setFocusMode(newFocusMode);
                  if (!newFocusMode) {
                    setFocusFlightIds(new Set());
                  }
                }}
                className={`flex flex-col items-center px-3 py-2 rounded-lg backdrop-blur-sm border transition-all duration-200 min-w-[70px] ${
                  focusMode
                    ? 'bg-blue-500/30 border-blue-400/50 text-blue-200'
                    : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30'
                }`}
              >
                <div className="text-lg mb-1">🎯</div>
                <span className="text-xs font-medium">Focus</span>
              </button>
            </div>
          </div>

          {focusMode && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm opacity-90">Interest Window Length</h4>
              <div className="grid grid-cols-4 gap-2">
                {['15', '30', '45', '1h', '2h', '4h', '6h'].map((duration) => (
                  <button
                    key={duration}
                    onClick={() => setInterestWindowLength(duration)}
                    className={`px-3 py-2 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${
                      interestWindowLength === duration
                        ? 'bg-blue-500/30 border-blue-400/50 text-blue-200'
                        : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30'
                    }`}
                  >
                    {duration}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-white"></div>
              <span className="ml-2 text-sm opacity-70">Loading...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3">
              <p className="text-sm text-red-200">Error: {error}</p>
            </div>
          )}

          {occupancyData && !loading && !error && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Total Movements</p>
                  <p className="text-lg font-semibold">{occupancyData.metadata.total_flights_in_tv}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Current Count</p>
                  <p className="text-lg font-semibold">{currentCount}</p>
                </div>
              </div>

              {/* Histogram */}
              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 opacity-90">Rolling Hour Entrances & Capacity</h4>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={displayChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fill: '#e2e8f0', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                        tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                        tickFormatter={formatXAxisTick}
                        interval={0}
                        tickMargin={0}
                        padding={{ left: 0, right: 0 }}
                        height={16}
                      />
                      <YAxis 
                        tick={{ fill: '#e2e8f0', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                        tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                        tickMargin={0}
                        width={26}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar 
                        dataKey="count" 
                        fill="#06b6d4"
                        radius={[2, 2, 0, 0]}
                        onClick={(_, index) => {
                          const point = displayChartData[index];
                          if (point && point.hour !== undefined) {
                            const newTime = point.hour * 3600;
                            setT(newTime);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <Line 
                        type="stepAfter"
                        dataKey="capacity" 
                        stroke="#fbbf24"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                        name="Capacity"
                        isAnimationActive={false}
                      />
                      
                      {currentXAxisCategory && (
                        <ReferenceLine
                          x={currentXAxisCategory}
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="0"
                          label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center space-x-4 mt-2 text-xs opacity-70">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-cyan-500 rounded mr-1"></div>
                    <span>Entrances</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-0.5 bg-yellow-400 mr-1"></div>
                    <span>Hourly Capacity</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Flight List */}
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-medium text-sm opacity-90">Flight List</h4>
              {focusMode && (
                <span className="text-xs bg-blue-500/20 text-blue-200 px-2 py-1 rounded border border-blue-400/30">
                  Focus Mode: {interestWindowLength}
                </span>
              )}
            </div>
            {hourGlassData.length > 0 && (
              <HourGlass data={hourGlassData} label height={12} className="my-2" />
            )}
            
            {flightListLoading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white"></div>
                <span className="ml-2 text-xs opacity-70">Loading flights...</span>
              </div>
            )}

            {flightListError && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3">
                <p className="text-xs text-red-200">Error: {flightListError}</p>
              </div>
            )}

            {displayFlightTableData.length > 0 && !flightListLoading && (
              <div className="max-h-60 overflow-y-auto no-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-blue-900 text-white">
                      <th className="text-left p-2 font-semibold">Callsign</th>
                      <th className="text-left p-2 font-semibold">Origin</th>
                      <th className="text-left p-2 font-semibold">Destination</th>
                      <th className="text-left p-2 font-semibold">Takeoff</th>
                      {orderedFlightsData && <th className="text-left p-2 font-semibold">TV Arrival</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayFlightTableData.map((flight, index) => (
                      <tr 
                        key={flight.flightId} 
                        className={`border-b border-white/10 hover:bg-white/5 cursor-pointer ${index % 2 === 0 ? 'bg-white/2' : ''}`}
                        onClick={() => {
                          // Find the full flight data from the flights array
                          const fullFlight = flights.find(f => String(f.flightId) === String(flight.flightId));
                          if (fullFlight) {
                            // Dispatch custom event for map to handle flight panning
                            window.dispatchEvent(new CustomEvent('flight-search-select', {
                              detail: { flight: fullFlight }
                            }));
                          }
                        }}
                      >
                        <td className="p-2 font-mono">{flight.callsign}</td>
                        <td className="p-2">{flight.origin}</td>
                        <td className="p-2">{flight.destination}</td>
                        <td className="p-2 font-mono">{flight.takeoffTime}</td>
                        {orderedFlightsData && <td className="p-2 font-mono">{flight.arrivalTime}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {displayFlightTableData.length === 500 && (
                  <p className="text-xs opacity-70 text-center mt-2">Showing first 500 flights</p>
                )}
                {orderedFlightsData && (
                  <p className="text-xs opacity-70 text-center mt-2">
                    Flights ordered by proximity to current time ({formatTime(t)})
                  </p>
                )}
              </div>
            )}

            {displayFlightTableData.length === 0 && !flightListLoading && !flightListError && (
              <p className="text-xs opacity-70 text-center py-4">No flights found for this traffic volume</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}