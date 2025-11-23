import React, { useState, useEffect, useMemo } from "react";
import MultiSelectWithChips, { ChipOption } from "./MultiSelectWithChips";
import TrafficVolumeMiniMap from "./TrafficVolumeMiniMap";
import { TrafficVolumeRegulation } from "@/types/scenarios";
import { loadSectors } from "@/lib/airspace";
import { AIRSPACE_GEOJSON_PATH } from "@/lib/dataPaths";

interface TVRegulationsTabProps {
    regulations: TrafficVolumeRegulation[];
    onChange: (regulations: TrafficVolumeRegulation[]) => void;
}

export default function TVRegulationsTab({
    regulations,
    onChange,
}: TVRegulationsTabProps) {
    const [options, setOptions] = useState<ChipOption[]>([]);
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [selectedTVs, setSelectedTVs] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoadingOptions(true);
            try {
                const fc = await loadSectors(AIRSPACE_GEOJSON_PATH);
                if (cancelled) return;
                const opts: ChipOption[] = (fc.features || [])
                    .map((f: any) => {
                        const id = f?.properties?.traffic_volume_id;
                        if (!id) return null;
                        const minFL = f?.properties?.min_fl;
                        const maxFL = f?.properties?.max_fl;
                        return {
                            id: String(id),
                            label: String(id),
                            description:
                                minFL != null && maxFL != null
                                    ? `FL${String(minFL).padStart(3, "0")}-FL${String(maxFL).padStart(3, "0")}`
                                    : undefined,
                        } as ChipOption;
                    })
                    .filter(Boolean) as ChipOption[];
                const seen = new Set<string>();
                const dedup = opts
                    .filter((o) => {
                        if (seen.has(o.id)) return false;
                        seen.add(o.id);
                        return true;
                    })
                    .sort((a, b) => a.id.localeCompare(b.id));
                setOptions(dedup);
            } catch (e: any) {
                console.error("Failed to load traffic volumes", e);
            } finally {
                if (!cancelled) setLoadingOptions(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleAddRegulation = (tvId: string) => {
        // Check if already exists to avoid duplicates if desired, 
        // but user might want multiple regulations for same TV at different times.
        // For now, just add a new one.
        const newReg: TrafficVolumeRegulation = {
            traffic_volume_id: tvId,
            start_time: "00:00",
            end_time: "23:59",
            rate_fph: 0,
        };
        onChange([...regulations, newReg]);
    };

    const handleUpdateRegulation = (index: number, updated: TrafficVolumeRegulation) => {
        const newRegs = [...regulations];
        newRegs[index] = updated;
        onChange(newRegs);
    };

    const handleDeleteRegulation = (index: number) => {
        const newRegs = regulations.filter((_, i) => i !== index);
        onChange(newRegs);
    };

    // When selecting TVs from the search bar, we add a default regulation for them
    const handleSelectionChange = (ids: string[]) => {
        // Find which ones are new
        const currentIds = new Set(regulations.map(r => r.traffic_volume_id));
        const newIds = ids.filter(id => !currentIds.has(id));

        if (newIds.length > 0) {
            const newRegs = [...regulations];
            newIds.forEach(id => {
                newRegs.push({
                    traffic_volume_id: id,
                    start_time: "00:00",
                    end_time: "23:59",
                    rate_fph: 0,
                });
            });
            onChange(newRegs);
        }

        setSelectedTVs([]); // Clear selection after adding
    };

    const mapHighlightedIds = useMemo(() => {
        return [...new Set(regulations.map(r => r.traffic_volume_id))];
    }, [regulations]);

    return (
        <div className="flex h-full gap-4">
            {/* Left Pane: List & Controls */}
            <div className="w-1/2 flex flex-col gap-4">
                <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                    <label className="block text-xs font-medium mb-2 opacity-90">Add Traffic Volume Regulation</label>
                    <MultiSelectWithChips
                        options={options}
                        selectedIds={selectedTVs}
                        onChange={handleSelectionChange}
                        placeholder={loadingOptions ? "Loading traffic volumes…" : "Search traffic volumes..."}
                        disabled={loadingOptions}
                        renderOptionLabel={(opt) => (
                            <div className="flex items-center gap-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                                <span>{opt.label}</span>
                            </div>
                        )}
                    />
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {regulations.length === 0 && (
                        <div className="text-center py-12 text-white/30 text-sm border border-dashed border-white/10 rounded-xl">
                            No regulations added. Search and select a traffic volume to start.
                        </div>
                    )}
                    {regulations.map((reg, idx) => (
                        <div key={`${reg.traffic_volume_id}-${idx}`} className="bg-white/5 rounded-xl border border-white/10 p-3 space-y-3">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div className="font-mono font-semibold text-blue-200">{reg.traffic_volume_id}</div>
                                <button
                                    onClick={() => handleDeleteRegulation(idx)}
                                    className="text-red-400 hover:text-red-300 text-xs transition-colors"
                                >
                                    Remove
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Start (HH:MM)</label>
                                    <input
                                        type="time"
                                        value={reg.start_time}
                                        onChange={(e) => handleUpdateRegulation(idx, { ...reg, start_time: e.target.value })}
                                        className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none font-mono text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">End (HH:MM)</label>
                                    <input
                                        type="time"
                                        value={reg.end_time}
                                        onChange={(e) => handleUpdateRegulation(idx, { ...reg, end_time: e.target.value })}
                                        className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none font-mono text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Rate (FPH)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={reg.rate_fph}
                                        onChange={(e) => handleUpdateRegulation(idx, { ...reg, rate_fph: Number(e.target.value) })}
                                        className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none font-mono text-white"
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Pane: Map */}
            <div className="w-1/2 bg-black/20 rounded-xl border border-white/10 overflow-hidden relative">
                <TrafficVolumeMiniMap
                    trafficVolumeIds={mapHighlightedIds}
                    className="w-full h-full"
                />
                <div className="absolute top-3 right-3 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg text-xs text-white/80 border border-white/10 pointer-events-none">
                    {mapHighlightedIds.length} Selected
                </div>
            </div>
        </div>
    );
}
