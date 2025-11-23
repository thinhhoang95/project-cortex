export interface JitterParameters {
    p_hurdle?: number;
    mean?: number;
    std?: number;
    mu?: number;
    sigma?: number;
    threshold?: number;
    tail_scale?: number;
    shift?: number;
}

export interface GroundJitterConfig {
    [airport: string]: {
        [timeWindow: string]: JitterParameters;
    };
}

export interface GroundHoldWindow {
    start: string; // ISO timestamp
    end: string; // ISO timestamp
    rate_fph: number;
    airport: string;
    regulation_id?: string;
}

export interface GroundHoldConfig {
    windows_by_airport: {
        [airport: string]: GroundHoldWindow[];
    };
    version?: string;
}

export interface TrafficVolumeRegulation {
    traffic_volume_id: string;
    start_time: string; // HH:MM
    end_time: string; // HH:MM
    rate_fph: number;
}

export interface Scenario {
    id: string;
    name: string;
    jitter: GroundJitterConfig;
    hold: GroundHoldConfig;
    regulations: TrafficVolumeRegulation[];
}
