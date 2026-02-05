import type { FilterSpecification } from "maplibre-gl";

/**
 * Helper to get "HH:00-HH+1:00" bin from seconds t
 */
export function getHourBin(t: number): string {
    const h = Math.floor(t / 3600) % 24;
    const nextH = h + 1;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:00-${pad(nextH)}:00`;
}

export function getTrafficVolumeFlIntersectionFilter(flLowerBound: number, flUpperBound: number): FilterSpecification {
    const minFl = ["to-number", ["coalesce", ["get", "min_fl"], 0], 0];
    const maxFl = ["to-number", ["coalesce", ["get", "max_fl"], 9999], 9999];
    return [
        "all",
        [">=", maxFl, flLowerBound],
        ["<=", minFl, flUpperBound]
    ] as unknown as FilterSpecification;
}

/**
 * Returns a MapLibre filter expression for traffic volumes based on:
 * 1. Flight Level (FL) range intersection
 * 2. Capacity availability for the current time bin (capacity not equal to 999/9999)
 */
export function getTrafficVolumeFilter(flLowerBound: number, flUpperBound: number, tOrHourBin: number | string): FilterSpecification {
    const hourBin = typeof tOrHourBin === "string" ? tOrHourBin : getHourBin(tOrHourBin);
    const formatCapacityKey = (bin: string) => {
        if (bin.startsWith("capacity_")) return bin; // already flattened

        const [start, end] = bin.split("-");
        const toHHMM = (s: string) => s.replace(":", "");
        return `capacity_${toHHMM(start)}_${toHHMM(end)}`;
    };

    const capRaw = [
        "coalesce",
        ["get", formatCapacityKey(hourBin)],
        ["get", hourBin, ["get", "capacity"]]
    ];

    // null/missing -> 9999, numeric strings -> number, other junk -> 9999
    const cap = [
        "case",
        ["==", capRaw, null],
        9999,
        ["to-number", capRaw, 9999]
    ];

    const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
    return ["all", flFilter, ["<", cap, 999]] as unknown as FilterSpecification;

}
