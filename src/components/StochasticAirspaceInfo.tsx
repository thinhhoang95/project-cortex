"use client";
import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, Area } from 'recharts';
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";

interface DemandData {
    rolling_window_size: number;
    rolling_hour: boolean;
    traffic_volumes: {
        [tvId: string]: {
            time_bins: number[];
            demand_mean: number[];
            demand_var: number[];
            capacity: number[];
        };
    };
    metadata: {
        count: number;
        sorting: string;
        time_bin_minutes: number;
    };
}

interface ChartDataPoint {
    time: string;
    timeSeconds: number;
    mean: number;
    variance: number;
    stdDev: number;
    capacity: number;
    upperBound: number;
    lowerBound: number;
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

export default function StochasticAirspaceInfo() {
    const { selectedTrafficVolume, selectedTrafficVolumeData, t, flights, focusMode, setFocusMode, setFocusFlightIds, setT, setFlowPreviewFlightId } = useSimStore();
    const [demandData, setDemandData] = useState<DemandData | null>(null);
    const [flightIdentifiersData, setFlightIdentifiersData] = useState<FlightIdentifiersData | null>(null);
    const [orderedFlightsData, setOrderedFlightsData] = useState<OrderedFlightsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [flightListLoading, setFlightListLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flightListError, setFlightListError] = useState<string | null>(null);
    const [interestWindowLength, setInterestWindowLength] = useState<string>('1h');
    const [expanded, setExpanded] = useState(false);
    const MAX_VISIBLE = 20;

    // Fetch data when traffic volume selection changes or time changes
    useEffect(() => {
        if (selectedTrafficVolume) {
            fetchDemandData(selectedTrafficVolume);
            fetchFlightIdentifiers(selectedTrafficVolume);
        } else {
            setDemandData(null);
            setFlightIdentifiersData(null);
            setOrderedFlightsData(null);
            setError(null);
            setFlightListError(null);
        }
    }, [selectedTrafficVolume, t]);

    // Clear flight preview on unmount or when TV changes
    useEffect(() => {
        return () => { setFlowPreviewFlightId(null); };
    }, [setFlowPreviewFlightId]);

    const fetchDemandData = async (trafficVolumeId: string) => {
        setLoading(true);
        setError(null);

        try {
            const response = await authFetch(`/api/demand?limit_tv=1&rolling_hour=true&tv_filter=${trafficVolumeId}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Failed to fetch demand data: ${response.statusText}`);
            }

            const data: DemandData = await response.json();
            setDemandData(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch demand data');
            setDemandData(null);
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
            const response = await authFetch(`/api/tv_flights?traffic_volume_id=${trafficVolumeId}&ref_time_str=${currentTimeStr}`);

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

    // Transform demand data for chart
    const chartData: ChartDataPoint[] = useMemo(() => {
        if (!demandData || !selectedTrafficVolume || !demandData.traffic_volumes[selectedTrafficVolume]) return [];

        const tvData = demandData.traffic_volumes[selectedTrafficVolume];
        const timeBinMinutes = demandData.metadata.time_bin_minutes || 15;

        return tvData.time_bins.map((binIndex, idx) => {
            const timeSeconds = binIndex * timeBinMinutes * 60; // Assuming binIndex starts from 0 and represents time from start of day? Or is it absolute?
            // Actually, usually time_bins are indices. Let's assume they map to time of day.
            // If the API returns absolute time bins, we need to know the reference.
            // Based on AirspaceInfo, it seems we work with HH:MM strings.
            // Let's convert seconds to HH:MM for display.

            const hours = Math.floor(timeSeconds / 3600);
            const minutes = Math.floor((timeSeconds % 3600) / 60);
            const timeLabel = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

            const mean = tvData.demand_mean[idx] || 0;
            const variance = tvData.demand_var[idx] || 0;
            const capacity = tvData.capacity[idx] || 0;
            const stdDev = Math.sqrt(variance);

            return {
                time: timeLabel,
                timeSeconds: timeSeconds,
                mean,
                variance,
                stdDev,
                capacity,
                upperBound: mean + stdDev,
                lowerBound: Math.max(0, mean - stdDev)
            };
        });
    }, [demandData, selectedTrafficVolume]);

    // Convert current simulation time (seconds) to hours for the reference line
    // We need to match the x-axis which is categorical (time strings).
    // So we find the closest bin.

    const currentXAxisCategory = useMemo(() => {
        if (chartData.length === 0) return undefined;
        // Find the bin that contains the current time t
        // Assuming chartData is sorted by time
        // We want the bin where binStart <= t < binEnd
        // But here we have discrete points. Let's find the closest one or the one just before.
        const timeBinMinutes = demandData?.metadata.time_bin_minutes || 15;
        const binDuration = timeBinMinutes * 60;

        const match = chartData.find(d => d.timeSeconds <= t && t < d.timeSeconds + binDuration);
        return match ? match.time : undefined;
    }, [chartData, t, demandData]);


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

    // Visible subset with expand/collapse toggle
    const visibleFlightTableData = useMemo(() => {
        if (!flightTableData) return [] as ReturnType<typeof formatFlightData>;
        if (!expanded && flightTableData.length > MAX_VISIBLE) return flightTableData.slice(0, MAX_VISIBLE);
        return flightTableData;
    }, [flightTableData, expanded]);

    // Reset expansion when the underlying dataset changes materially
    useEffect(() => {
        setExpanded(false);
    }, [selectedTrafficVolume, focusMode, interestWindowLength, orderedFlightsData, flightIdentifiersData]);

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
        if (!focusMode || !demandData) {
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
            return dataPoint.timeSeconds >= t && dataPoint.timeSeconds <= windowEndTime;
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
                };
            }).slice(0, 500);
        }

        return {
            chartData: filteredChartData,
            flightTableData: filteredFlightTableData,
            filteredFlightIds
        };
    }, [focusMode, demandData, chartData, flightTableData, interestWindowLength, t, flightIdentifiersData, orderedFlightsData, flights]);

    const hiddenFlightCount = Math.max(0, displayFlightTableData.length - MAX_VISIBLE);

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

    // Custom tick formatter for x-axis - show every 3 hours
    const formatXAxisTick = (tickItem: string, index: number) => {
        if (index % 12 === 0) { // Show every 12th item (3 hours if 15-min intervals)
            const [hours] = tickItem.split(':').map(Number);
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
                        Mean Demand: <span className="font-medium">{data?.mean.toFixed(1)}</span>
                    </p>
                    <p className="text-blue-200 text-xs">
                        Std Dev: <span className="font-medium">{data?.stdDev.toFixed(1)}</span>
                    </p>
                    {data?.capacity !== undefined && (
                        <p className="text-yellow-300">
                            Capacity: <span className="font-medium">{Math.round(data.capacity)}</span>
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
                    <p className="text-sm">Click on a traffic volume to view demand data</p>
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
                                className={`flex flex-col items-center px-3 py-2 rounded-lg backdrop-blur-sm border transition-all duration-200 min-w-[70px] ${focusMode
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
                                        className={`px-3 py-2 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${interestWindowLength === duration
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
                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
                            <span className="ml-2 text-sm opacity-70">Loading...</span>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3">
                            <p className="text-sm text-red-200">Error: {error}</p>
                        </div>
                    )}

                    {demandData && !loading && !error && (
                        <div className="space-y-4">
                            {/* Chart */}
                            <div className="bg-white/5 rounded-lg p-4">
                                <h4 className="font-medium text-sm mb-3 opacity-90">Rolling Hour Demand (Mean & Variance)</h4>
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

                                            {/* Variance Area */}
                                            <Area
                                                type="monotone"
                                                dataKey="upperBound"
                                                stroke="none"
                                                fill="#ff5722"
                                                fillOpacity={0.2}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="lowerBound"
                                                stroke="none"
                                                fill="#ff5722"
                                                fillOpacity={0.2}
                                            />

                                            {/* Mean Demand Bar */}
                                            <Bar
                                                dataKey="mean"
                                                fill="#06b6d4"
                                                radius={[2, 2, 0, 0]}
                                                onClick={(_, index) => {
                                                    const point = displayChartData[index];
                                                    if (point) {
                                                        setT(point.timeSeconds);
                                                    }
                                                }}
                                                style={{ cursor: 'pointer' }}
                                            />

                                            {/* Capacity Line */}
                                            <Line
                                                type="linear"
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
                                        <span>Mean Demand</span>
                                    </div>
                                    <div className="flex items-center">
                                        <div className="w-3 h-3 rounded mr-1" style={{ backgroundColor: '#ff5722', opacity: 0.2 }}></div>
                                        <span>Variance (Std Dev)</span>
                                    </div>
                                    <div className="flex items-center">
                                        <div className="w-3 h-0.5 bg-yellow-400 mr-1"></div>
                                        <span>Capacity</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Flight List */}
                    <div className="bg-white/5 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <h4 className="font-medium text-sm opacity-90">Flight List</h4>
                                <FlightStatisticsButton
                                    flightIds={displayFlightTableData.map((flight) => flight.flightId)}
                                    buttonClassName="border-white/20 text-white/80"
                                />
                            </div>
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
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
                                <span className="ml-2 text-xs opacity-70">Loading flights...</span>
                            </div>
                        )}

                        {flightListError && (
                            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3">
                                <p className="text-xs text-red-200">Error: {flightListError}</p>
                            </div>
                        )}

                        {displayFlightTableData.length > 0 && !flightListLoading && (
                            <div className="rounded-lg border border-white/10 overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-white/10">
                                            <th className="text-left p-2 font-semibold">CS</th>
                                            <th className="text-left p-2 font-semibold">Ori.</th>
                                            <th className="text-left p-2 font-semibold">Des.</th>
                                            <th className="text-left p-2 font-semibold">T/O</th>
                                            {orderedFlightsData && <th className="text-left p-2 font-semibold">TV Arr.</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleFlightTableData.map((flight, index) => (
                                            <tr
                                                key={flight.flightId}
                                                className={`border-t border-white/10 ${index % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10 cursor-pointer`}
                                                onMouseEnter={() => setFlowPreviewFlightId(String(flight.flightId))}
                                                onMouseLeave={() => setFlowPreviewFlightId(null)}
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
                                                <td className="p-2 text-right font-mono">{flight.takeoffTime}</td>
                                                {orderedFlightsData && <td className="p-2 text-right font-mono">{flight.arrivalTime}</td>}
                                            </tr>
                                        ))}
                                        {displayFlightTableData.length > MAX_VISIBLE && (
                                            <tr
                                                className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                                                onClick={() => setExpanded(!expanded)}
                                            >
                                                <td colSpan={orderedFlightsData ? 5 : 4} className="p-2 text-center text-blue-300 hover:text-blue-200 transition-colors">
                                                    {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenFlightCount)}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {displayFlightTableData.length === 0 && !flightListLoading && !flightListError && (
                            <div className="text-center py-4 opacity-50 text-xs">
                                No flights found in this window
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
