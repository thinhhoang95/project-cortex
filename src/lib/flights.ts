import Papa from "papaparse";
import * as turf from "@turf/turf";
import { FlightSegment, Trajectory } from "./models";
import { parseCompactHMS } from "./time";

// Load & group CSV into trajectories
export async function loadTrajectories(csvUrl: string): Promise<Trajectory[]> {
  const text = await fetch(csvUrl).then(r => r.text());
  const { data } = Papa.parse<FlightSegment>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });

  const byFlight = new Map<string, FlightSegment[]>();
  for (const row of data as FlightSegment[]) {
    if (!row?.flight_identifier) continue;
    const arr = byFlight.get(row.flight_identifier) ?? [];
    arr.push(row);
    byFlight.set(row.flight_identifier, arr);
  }

  const trajectories: Trajectory[] = [];
  for (const [flightId, segs] of byFlight) {
    segs.sort((a, b) => a.sequence - b.sequence);
    const coords: [number, number, number?][] = [];
    const times: number[] = [];

    for (const s of segs) {
      const t0 = parseCompactHMS(String(s.time_begin_segment));
      const t1 = parseCompactHMS(String(s.time_end_segment));
      // push begin & end points (avoid duplicate when contiguous)
      const p0: [number, number, number?] = [s.longitude_begin, s.latitude_begin, s.flight_level_begin * 100];
      const p1: [number, number, number?] = [s.longitude_end, s.latitude_end, s.flight_level_end * 100];

      if (coords.length === 0 || coords.at(-1)![0] !== p0[0] || coords.at(-1)![1] !== p0[1]) {
        coords.push(p0);
        times.push(t0);
      }
      coords.push(p1);
      times.push(t1);
    }

    trajectories.push({
      flightId,
      callSign: segs[0]?.call_sign,
      origin: segs[0]?.origin_aerodrome,
      destination: segs[0]?.destination_aerodrome,
      coords,
      t0: times[0] ?? 0,
      t1: times.at(-1) ?? 0,
      times
    });
  }
  return trajectories;
}