"use client";
import React, { useState, useEffect } from "react";
import ModalDialog from "./ModalDialog";
import ShimmeringText from "./ShimmeringText";
import { authFetch } from "@/lib/auth";
import { Scenario, GroundJitterConfig, GroundHoldConfig, JitterParameters, GroundHoldWindow, TrafficVolumeRegulation } from "@/types/scenarios";
import TVRegulationsTab from "./TVRegulationsTab";

interface ScenarioEditorDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: (scenario: Scenario) => void;
    initialScenario: Scenario | null;
}

const DEFAULT_JITTER_PARAMS: JitterParameters = {
    p_hurdle: 0.05,
    mean: 4.0,
    std: 2.0,
};

const DEFAULT_SCENARIO: Scenario = {
    id: "",
    name: "New Scenario",
    jitter: {
        default: {
            "00:00-24:00": DEFAULT_JITTER_PARAMS,
        },
    },
    hold: {
        windows_by_airport: {},
        version: new Date().toISOString().split("T")[0],
    },
    regulations: [],
};

function ensureJitterConfig(config?: GroundJitterConfig | null): GroundJitterConfig {
    if (config && Object.keys(config).length > 0) {
        return config;
    }

    return JSON.parse(JSON.stringify(DEFAULT_SCENARIO.jitter));
}

function sanitizeScenarioData(scenario: Scenario): Scenario {
    const windowsByAirport = scenario.hold?.windows_by_airport || {};

    const sanitizedWindows = Object.fromEntries(
        Object.entries(windowsByAirport).map(([airport, windows]) => [
            airport,
            windows.map((window) => {
                const parsedRate = Number(window.rate_fph);
                const safeRate = Number.isFinite(parsedRate) ? parsedRate : 0;

                return { ...window, rate_fph: safeRate };
            }),
        ])
    );

    const safeJitter = ensureJitterConfig(scenario.jitter);
    const safeRegulations = Array.isArray(scenario.regulations) ? scenario.regulations : [];

    return {
        ...scenario,
        jitter: safeJitter,
        hold: {
            ...scenario.hold,
            windows_by_airport: sanitizedWindows,
            version: scenario.hold?.version || new Date().toISOString().split("T")[0],
        },
        regulations: safeRegulations,
    };
}

function prepareScenarioForEditing(source?: Scenario): Scenario {
    const base = source ? JSON.parse(JSON.stringify(source)) : JSON.parse(JSON.stringify(DEFAULT_SCENARIO));

    return sanitizeScenarioData({
        ...base,
        id: crypto.randomUUID(),
    });
}

export default function ScenarioEditorDialog({
    open,
    onClose,
    onSave,
    initialScenario,
}: ScenarioEditorDialogProps) {
    const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
    const [activeTab, setActiveTab] = useState<"jitter" | "hold" | "regulations">("jitter");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setScenario(prepareScenarioForEditing(initialScenario || undefined));
        }
    }, [open, initialScenario]);

    const handleSave = async () => {
        setLoading(true);
        try {
            const response = await authFetch("/api/select_scenario_demand", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(scenario),
            });

            if (!response.ok) {
                throw new Error(`Failed to save scenario: ${response.statusText}`);
            }

            const savedScenario = await response.json();
            onSave(savedScenario);
            onClose();
        } catch (error) {
            console.error("Error saving scenario:", error);
            alert("Failed to save scenario. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModalDialog
            open={open}
            onClose={onClose}
            title="Edit Operational Scenario"
            width="w-[min(1200px,95vw)]"
            height="h-[min(900px,92vh)]"
        >
            <div className="flex flex-col h-full">
                {/* Header Inputs */}
                <div className="p-6 border-b border-white/10 space-y-4">
                    <div>
                        <label className="block text-xs font-medium mb-1 opacity-90">Scenario Name</label>
                        <input
                            type="text"
                            value={scenario.name}
                            onChange={(e) => setScenario({ ...scenario, name: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                            placeholder="Enter scenario name"
                        />
                    </div>

                    {/* Tabs */}
                    <div className="flex space-x-1 bg-white/5 p-1 rounded-lg w-fit">
                        <button
                            onClick={() => setActiveTab("jitter")}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "jitter"
                                ? "bg-blue-500/20 text-blue-200 shadow-sm"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            Ground Operations (Jitter)
                        </button>
                        <button
                            onClick={() => setActiveTab("hold")}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "hold"
                                ? "bg-blue-500/20 text-blue-200 shadow-sm"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            Ground Hold
                        </button>
                        <button
                            onClick={() => setActiveTab("regulations")}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "regulations"
                                ? "bg-blue-500/20 text-blue-200 shadow-sm"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            TV Regulations
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === "jitter" ? (
                        <JitterEditor
                            config={scenario.jitter}
                            onChange={(newConfig) => setScenario({ ...scenario, jitter: newConfig })}
                        />
                    ) : activeTab === "hold" ? (
                        <HoldEditor
                            config={scenario.hold}
                            onChange={(newConfig) => setScenario({ ...scenario, hold: newConfig })}
                        />
                    ) : (
                        <TVRegulationsTab
                            regulations={scenario.regulations || []}
                            onChange={(newRegs) => setScenario({ ...scenario, regulations: newRegs })}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 flex justify-end gap-3 shrink-0 bg-slate-900/50 items-center">
                    {loading && (
                        <div className="mr-auto pl-2">
                            <ShimmeringText text="Computing Moments..." className="text-sm" />
                        </div>
                    )}
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors text-sm font-medium shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {loading ? (
                            <>
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Saving...
                            </>
                        ) : (
                            "Save Scenario"
                        )}
                    </button>
                </div>
            </div>
        </ModalDialog>
    );
}

// --- Sub-components ---

function JitterEditor({
    config,
    onChange,
}: {
    config: GroundJitterConfig;
    onChange: (config: GroundJitterConfig) => void;
}) {
    const [isAdding, setIsAdding] = useState(false);

    const handleAddAirport = (airport: string) => {
        if (config[airport]) {
            return;
        }
        onChange({
            ...config,
            [airport]: {
                "00:00-24:00": { ...DEFAULT_JITTER_PARAMS },
            },
        });
        setIsAdding(false);
    };

    const removeAirport = (airport: string) => {
        if (confirm(`Delete configuration for ${airport}?`)) {
            const newConfig = { ...config };
            delete newConfig[airport];
            onChange(newConfig);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between h-9">
                <h3 className="text-lg font-medium text-white/90">Jitter Configuration</h3>
                {isAdding ? (
                    <AddAirportForm onAdd={handleAddAirport} onCancel={() => setIsAdding(false)} />
                ) : (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 text-xs font-medium border border-blue-500/30 transition-colors"
                    >
                        + Add Airport Override
                    </button>
                )}
            </div>
            <p className="text-sm text-white/60 leading-relaxed">
                Jitter configuration models stochastic delays affecting flights due to ground operations. It uses a Hurdle-Bulk Lognormal-Generalized Pareto Distribution Tail (HBT) to represent these variations.
            </p>

            <div className="space-y-4">
                {Object.entries(config).map(([airport, windows]) => (
                    <div key={airport} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                            <div className="font-mono font-semibold text-blue-200">{airport}</div>
                            {airport !== "default" && (
                                <button
                                    onClick={() => removeAirport(airport)}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                        <div className="p-4 space-y-4">
                            {Object.entries(windows).map(([timeWindow, params]) => (
                                <JitterWindowRow
                                    key={timeWindow}
                                    timeWindow={timeWindow}
                                    params={params}
                                    onUpdate={(newWindow, newParams) => {
                                        const newWindows = { ...windows };
                                        if (newWindow !== timeWindow) {
                                            delete newWindows[timeWindow];
                                        }
                                        newWindows[newWindow] = newParams;
                                        onChange({ ...config, [airport]: newWindows });
                                    }}
                                    onDelete={() => {
                                        const newWindows = { ...windows };
                                        delete newWindows[timeWindow];
                                        onChange({ ...config, [airport]: newWindows });
                                    }}
                                />
                            ))}
                            <button
                                onClick={() => {
                                    const newWindows = { ...windows, "00:00-00:00": { ...DEFAULT_JITTER_PARAMS } };
                                    onChange({ ...config, [airport]: newWindows });
                                }}
                                className="w-full py-2 rounded-lg border border-dashed border-white/20 text-white/40 hover:text-white/60 hover:border-white/30 text-xs transition-colors"
                            >
                                + Add Time Window
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function JitterWindowRow({
    timeWindow,
    params,
    onUpdate,
    onDelete,
}: {
    timeWindow: string;
    params: JitterParameters;
    onUpdate: (newWindow: string, newParams: JitterParameters) => void;
    onDelete: () => void;
}) {
    const handleParamChange = (key: keyof JitterParameters, value: string) => {
        const numValue = parseFloat(value);
        onUpdate(timeWindow, { ...params, [key]: isNaN(numValue) ? undefined : numValue });
    };

    return (
        <div className="grid grid-cols-12 gap-4 items-start bg-black/20 p-3 rounded-lg">
            <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Time Window</label>
                <input
                    type="text"
                    value={timeWindow}
                    onChange={(e) => onUpdate(e.target.value, params)}
                    className="w-full bg-transparent border-b border-white/20 text-sm font-mono focus:border-blue-400 focus:outline-none py-1"
                    placeholder="HH:MM-HH:MM"
                />
            </div>

            <div className="col-span-9 grid grid-cols-4 gap-x-4 gap-y-2">
                {["p_hurdle", "mean", "std", "mu", "sigma", "threshold", "tail_scale", "shift"].map((key) => (
                    <div key={key}>
                        <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">{key}</label>
                        <input
                            type="number"
                            step="0.1"
                            value={params[key as keyof JitterParameters] ?? ""}
                            onChange={(e) => handleParamChange(key as keyof JitterParameters, e.target.value)}
                            className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none"
                            placeholder="-"
                        />
                    </div>
                ))}
            </div>

            <div className="col-span-1 flex justify-end pt-4">
                <button onClick={onDelete} className="text-white/20 hover:text-red-400 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
        </div>
    );
}

function HoldEditor({
    config,
    onChange,
}: {
    config: GroundHoldConfig;
    onChange: (config: GroundHoldConfig) => void;
}) {
    const [isAdding, setIsAdding] = useState(false);

    const handleAddAirport = (airport: string) => {
        if (config.windows_by_airport[airport]) {
            return;
        }
        onChange({
            ...config,
            windows_by_airport: {
                ...config.windows_by_airport,
                [airport]: [],
            },
        });
        setIsAdding(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between h-9">
                <h3 className="text-lg font-medium text-white/90">Ground Hold Configuration</h3>
                {isAdding ? (
                    <AddAirportForm onAdd={handleAddAirport} onCancel={() => setIsAdding(false)} />
                ) : (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 text-xs font-medium border border-blue-500/30 transition-colors"
                    >
                        + Add Airport
                    </button>
                )}
            </div>
            <p className="text-sm text-white/60 leading-relaxed">
                Ground Hold configuration specifies the deterministic delays applied to flights before takeoff, typically used to manage traffic flow and capacity constraints.
            </p>

            <div className="space-y-4">
                {Object.entries(config.windows_by_airport).map(([airport, windows]) => (
                    <div key={airport} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                            <div className="font-mono font-semibold text-blue-200">{airport}</div>
                            <button
                                onClick={() => {
                                    const newConfig = { ...config };
                                    delete newConfig.windows_by_airport[airport];
                                    onChange(newConfig);
                                }}
                                className="text-red-400 hover:text-red-300 text-xs"
                            >
                                Remove Airport
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {windows.map((window, idx) => (
                                <HoldWindowRow
                                    key={idx}
                                    window={window}
                                    onUpdate={(newWindow) => {
                                        const newWindows = [...windows];
                                        newWindows[idx] = newWindow;
                                        onChange({
                                            ...config,
                                            windows_by_airport: {
                                                ...config.windows_by_airport,
                                                [airport]: newWindows,
                                            },
                                        });
                                    }}
                                    onDelete={() => {
                                        const newWindows = windows.filter((_, i) => i !== idx);
                                        onChange({
                                            ...config,
                                            windows_by_airport: {
                                                ...config.windows_by_airport,
                                                [airport]: newWindows,
                                            },
                                        });
                                    }}
                                />
                            ))}
                            <button
                                onClick={() => {
                                    const newWindows = [
                                        ...windows,
                                        {
                                            start: new Date().toISOString(),
                                            end: new Date(Date.now() + 3600000).toISOString(),
                                            rate_fph: 30,
                                            airport: airport,
                                        },
                                    ];
                                    onChange({
                                        ...config,
                                        windows_by_airport: {
                                            ...config.windows_by_airport,
                                            [airport]: newWindows,
                                        },
                                    });
                                }}
                                className="w-full py-2 rounded-lg border border-dashed border-white/20 text-white/40 hover:text-white/60 hover:border-white/30 text-xs transition-colors"
                            >
                                + Add Hold Window
                            </button>
                        </div>
                    </div>
                ))}
                {Object.keys(config.windows_by_airport).length === 0 && (
                    <div className="text-center py-12 text-white/30 text-sm border border-dashed border-white/10 rounded-xl">
                        No ground hold configurations. Add an airport to start.
                    </div>
                )}
            </div>
        </div>
    );
}

function HoldWindowRow({
    window,
    onUpdate,
    onDelete,
}: {
    window: GroundHoldWindow;
    onUpdate: (window: GroundHoldWindow) => void;
    onDelete: () => void;
}) {
    return (
        <div className="grid grid-cols-12 gap-4 items-end bg-black/20 p-3 rounded-lg">
            <div className="col-span-4">
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Start Time (ISO)</label>
                <input
                    type="text"
                    value={window.start}
                    onChange={(e) => onUpdate({ ...window, start: e.target.value })}
                    className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none font-mono"
                />
            </div>
            <div className="col-span-4">
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">End Time (ISO)</label>
                <input
                    type="text"
                    value={window.end}
                    onChange={(e) => onUpdate({ ...window, end: e.target.value })}
                    className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none font-mono"
                />
            </div>
            <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Rate (FPH)</label>
                <input
                    type="number"
                    value={Number.isFinite(window.rate_fph) ? window.rate_fph : ""}
                    onChange={(e) => {
                        const parsedRate = Number(e.target.value);
                        onUpdate({ ...window, rate_fph: Number.isFinite(parsedRate) ? parsedRate : 0 });
                    }}
                    className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none"
                />
            </div>
            <div className="col-span-2 flex items-center justify-between gap-2">
                <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Reg ID</label>
                    <input
                        type="text"
                        value={window.regulation_id || ""}
                        onChange={(e) => onUpdate({ ...window, regulation_id: e.target.value })}
                        className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10 focus:border-blue-400 focus:outline-none"
                        placeholder="Optional"
                    />
                </div>
                <button onClick={onDelete} className="text-white/20 hover:text-red-400 transition-colors mb-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
        </div>
    );
}

function AddAirportForm({
    onAdd,
    onCancel,
}: {
    onAdd: (code: string) => void;
    onCancel: () => void;
}) {
    const [code, setCode] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (code.trim()) {
            onAdd(code.trim().toUpperCase());
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/30 animate-in fade-in zoom-in-95 duration-200"
        >
            <input
                autoFocus
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ICAO"
                className="bg-transparent border-none focus:ring-0 text-white text-xs placeholder-white/30 w-12 uppercase font-mono p-0 focus:outline-none"
                maxLength={4}
            />
            <div className="h-3 w-px bg-white/10 mx-1" />
            <button
                type="submit"
                disabled={!code.trim()}
                className="text-green-400 hover:text-green-300 disabled:opacity-50 disabled:cursor-not-allowed p-0.5 hover:bg-green-500/10 rounded transition-colors"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
            <button
                type="button"
                onClick={onCancel}
                className="text-red-400 hover:text-red-300 p-0.5 hover:bg-red-500/10 rounded transition-colors"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
        </form>
    );
}
