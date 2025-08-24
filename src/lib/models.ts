export type HmsCompact = string; // e.g., "754" => 00:07:54, "50007" => 05:00:07

export interface FlightSegment {
  segment_identifier: string;
  flight_identifier: string;
  call_sign: string;
  origin_aerodrome: string;
  destination_aerodrome: string;
  date_begin_segment: string; // e.g., "230801"
  date_end_segment: string;
  time_begin_segment: HmsCompact;
  time_end_segment: HmsCompact;
  latitude_begin: number;
  longitude_begin: number;
  latitude_end: number;
  longitude_end: number;
  flight_level_begin: number;
  flight_level_end: number;
  sequence: number;
}

export interface Trajectory {
  flightId: string;
  callSign?: string;
  origin?: string;
  destination?: string;
  // coordinates sorted by time
  coords: [number, number, number?][]; // [lon, lat, alt_ft]
  t0: number; // seconds since midnight
  t1: number; // seconds since midnight
  // per-vertex absolute time (sec since midnight)
  times: number[];
}

export interface SectorFeatureProps {
  traffic_volume_id: string;
  name?: string;
  min_fl: number;
  max_fl: number;
  [k: string]: unknown;
}