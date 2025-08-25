"use client";
import { useEffect, useMemo, useState } from "react";
import { useSimStore } from "@/components/useSimStore";

interface RankedFlightComponentScores {
	multiplicity?: number;
	similarity?: number;
	slack?: number;
	
	// New: NSH component score from ranking API
	nsh?: number;
}

interface RankedFlight {
	flight_id: string;
	arrival_time: string; // HH:MM or HH:MM:SS
	time_window: string; // HH:MM-HH:MM
	delta_seconds: number;
	score: number;
	components?: RankedFlightComponentScores;
}

interface RankedFlightsResponse {
	traffic_volume_id: string;
	ref_time_str: string;
	seed_flight_ids: string[];
	ranked_flights: RankedFlight[];
	metadata?: {
		num_candidates?: number;
		num_ranked?: number;
		time_bin_minutes?: number;
		duration_min?: number;
	};
}

export default function RegulationFlightListLeftPanel2() {
	const { selectedTrafficVolume, t, flights, regulationTimeWindow, regulationTargetFlightIds, addRegulationTargetFlight, setRegulationVisibleFlightIds } = useSimStore();
	const [rankingData, setRankingData] = useState<RankedFlightsResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Compute seed flight identifiers from regulation targets (stored as callsigns)
	const seedFlightIds = useMemo(() => {
		if (!flights || flights.length === 0 || !regulationTargetFlightIds) return [] as string[];
		const seeds = new Set<string>();
		for (const token of Array.from(regulationTargetFlightIds)) {
			// Direct flight identifier match
			const byId = flights.find(f => String(f.flightId) === String(token));
			if (byId?.flightId) { seeds.add(String(byId.flightId)); continue; }
			// Callsign match → convert back to flight identifier
			const byCs = flights.find(f => f.callSign && String(f.callSign) === String(token));
			if (byCs?.flightId) seeds.add(String(byCs.flightId));
		}
		return Array.from(seeds);
	}, [flights, regulationTargetFlightIds]);

	// Fetch ranked flights for the selected TV using only the regulation ranking endpoint
	useEffect(() => {
		let cancelled = false;
		async function load() {
			if (!selectedTrafficVolume) { setRankingData(null); return; }
			setLoading(true);
			setError(null);
			try {
				const ref = formatTimeForAPI(t);
				const topK = 50;
				const [from, to] = regulationTimeWindow;
				const durationSeconds = Math.max(0, (to ?? 0) - (from ?? 0));
				const durationMin = Math.max(1, Math.round(durationSeconds / 60));
				const params = new URLSearchParams({
					traffic_volume_id: String(selectedTrafficVolume),
					ref_time_str: String(ref),
					// When no targeted flights, pass an empty value for seed_flight_ids
					seed_flight_ids: seedFlightIds && seedFlightIds.length > 0 ? seedFlightIds.join(',') : '',
					duration_min: String(durationMin),
					top_k: String(topK)
				});
				const res = await fetch(`/api/regulation_ranking_tv_flights_ordered?${params.toString()}`);
				if (!res.ok) throw new Error('Failed to fetch ranked flights');
				const data: RankedFlightsResponse = await res.json();
				if (cancelled) return;
				setRankingData(data);
			} catch (e: any) {
				if (!cancelled) setError(e?.message || 'Failed to fetch ranked flights');
				setRankingData(null);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		load();
		return () => { cancelled = true; };
	}, [selectedTrafficVolume, t, seedFlightIds, regulationTimeWindow]);

	// Determine relevant ranked flights within the current regulation time window
	const filteredRankedFlights = useMemo(() => {
		if (!rankingData?.ranked_flights) return [] as RankedFlight[];
		const [from, to] = regulationTimeWindow;
		return rankingData.ranked_flights.filter((rf) => {
			const sec = parseHHMMSSToSeconds(rf.arrival_time);
			return sec >= from && sec <= to;
		});
	}, [rankingData, regulationTimeWindow]);

	// Build table rows preserving the ranked order from API
	const rows = useMemo(() => {
		if (!selectedTrafficVolume || flights.length === 0) return [] as Array<any>;
		if (filteredRankedFlights && filteredRankedFlights.length > 0) {
			return filteredRankedFlights.map((rf) => {
				const flight = flights.find(ff => String(ff.flightId) === String(rf.flight_id));
				return {
					flightId: String(rf.flight_id),
					callsign: flight?.callSign || String(rf.flight_id),
					origin: flight?.origin || 'N/A',
					destination: flight?.destination || 'N/A',
					arrivalTime: rf.arrival_time || 'N/A',
					score: rf.score,
					components: rf.components || {}
				};
			});
		}
		return [] as Array<any>;
	}, [selectedTrafficVolume, flights, filteredRankedFlights]);

	// Publish the currently visible flight IDs to the store for bulk actions (e.g., "all")
	useEffect(() => {
		const ids = rows.map(r => String(r.flightId));
		setRegulationVisibleFlightIds(ids);
	}, [rows, setRegulationVisibleFlightIds]);

	if (!selectedTrafficVolume) return null;

	return (
		<div className="w-full max-h-[40vh] min-h-0 flex-shrink-0
						rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
						shadow-xl text-slate-900 text-white flex flex-col overflow-hidden">
			<div className="flex items-center justify-between p-3 border-b border-white/20 flex-shrink-0">
				<h3 className="font-semibold text-sm">Flight List ({rows.length})</h3>
				<span className="text-xs opacity-70">{formatTime(regulationTimeWindow[0])}–{formatTime(regulationTimeWindow[1])}</span>
			</div>
			<div className="px-3 pb-3 flex-1 min-h-0 overflow-y-auto overflow-x-auto">
				{loading ? (
					<div className="flex items-center justify-center py-4">
						<div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white"></div>
						<span className="ml-2 text-xs opacity-70">Loading...</span>
					</div>
				) : error ? (
					<div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3 text-xs">{error}</div>
				) : rows.length > 0 ? (
					<table className="w-full text-xs min-w-max whitespace-nowrap">
						<thead className="sticky top-0 z-20 bg-blue-900">
							<tr className="bg-blue-900 text-white">
								<th className="text-center p-2 font-semibold w-6">✓</th>
								<th className="text-left p-2 font-semibold">Callsign</th>
								<th className="text-left p-2 font-semibold">Origin</th>
								<th className="text-left p-2 font-semibold">Destination</th>
								{rankingData && (
									<th className="text-left p-2 font-semibold">TV Arrival</th>
								)}
								{rankingData && (
									<>
										<th className="text-left p-2 font-semibold">Score</th>
										<th className="text-left p-2 font-semibold">Mult</th>
										<th className="text-left p-2 font-semibold">Sim</th>
										<th className="text-left p-2 font-semibold">Slack</th>
										<th className="text-left p-2 font-semibold">NSH</th>
									</>
								)}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, idx) => {
								const isTargeted = regulationTargetFlightIds.has(String(row.flightId));
								return (
									<tr
										key={row.flightId}
										className={`border-b border-white/10 cursor-pointer ${idx % 2 === 0 ? 'bg-white/2' : ''} ${isTargeted ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-white/5'}`}
										onClick={() => {
											const full = flights.find(f => String(f.flightId) === String(row.flightId));
											if (full) {
												// Pan/zoom to flight on the map (shared behavior with search)
												window.dispatchEvent(new CustomEvent('flight-search-select', { detail: { flight: full } }));
												// Also add to regulation target list
												addRegulationTargetFlight(String(full.flightId));
											}
										}}
									>
										<td className="p-2 text-center w-6">{isTargeted ? '✓' : ''}</td>
										<td className="p-2 font-mono">{row.callsign}</td>
										<td className="p-2">{row.origin}</td>
										<td className="p-2">{row.destination}</td>
										{rankingData && (
											<td className="p-2 font-mono">{row.arrivalTime}</td>
										)}
										{rankingData && (
											<>
												<td className="p-2 font-mono">{formatScore(row.score)}</td>
												<td className="p-2 font-mono">{formatScore(row.components?.multiplicity)}</td>
												<td className="p-2 font-mono">{formatScore(row.components?.similarity)}</td>
												<td className="p-2 font-mono">{formatScore(row.components?.slack)}</td>
												<td className="p-2 font-mono">{formatScore(row.components?.nsh)}</td>
											</>
										)}
									</tr>
								);
							})}
						</tbody>
					</table>
				) : (
					<p className="text-xs opacity-70 text-center py-4">No flights found for this time window</p>
				)}
			</div>
		</div>
	);
}

function formatTime(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

function formatTimeForAPI(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	return `${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}${secs.toString().padStart(2, '0')}`;
}

function parseHHMMSSToSeconds(value: string): number {
	// Accepts HH:MM or HH:MM:SS
	const parts = value.split(":").map(Number);
	const h = parts[0] || 0;
	const m = parts[1] || 0;
	const s = parts[2] || 0;
	return h * 3600 + m * 60 + s;
}

function formatScore(value?: number): string {
	if (value === undefined || value === null || Number.isNaN(value)) return '-';
	return value.toFixed(3);
}
