"use client";
import { useState, useEffect } from "react";
import SelectChevron from "@/components/SelectChevron";
import ScenarioEditorDialog from "./ScenarioEditorDialog";
import { Scenario } from "@/types/scenarios";
import { authFetch } from "@/lib/auth";

type PredictionSettingsPanelProps = {
  embedded?: boolean;
};

export default function PredictionSettingsPanel({
  embedded = true,
}: PredictionSettingsPanelProps) {
  const [model, setModel] = useState("Silver Drizzle 2023");
  const [regulationScenario, setRegulationScenario] = useState("Default");
  const [alphaThreshold, setAlphaThreshold] = useState(0.85);
  const [reportingValue, setReportingValue] = useState("Expectation");

  // Scenario State
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("default");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    const savedScenarios = localStorage.getItem("regulation_scenarios");
    if (savedScenarios) {
      try {
        setScenarios(JSON.parse(savedScenarios));
      } catch (e) {
        console.error("Failed to parse scenarios", e);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedScenarioId !== "default") {
      authFetch(`/api/select_scenario_demand_without_create?id=${selectedScenarioId}`)
        .catch((e) => console.error("Failed to select scenario:", e));
    }
  }, [selectedScenarioId]);

  const handleSaveScenario = (scenario: Scenario) => {
    let newScenarios;
    if (scenarios.some((s) => s.id === scenario.id)) {
      newScenarios = scenarios.map((s) => (s.id === scenario.id ? scenario : s));
    } else {
      newScenarios = [...scenarios, scenario];
    }
    setScenarios(newScenarios);
    localStorage.setItem("regulation_scenarios", JSON.stringify(newScenarios));
    setSelectedScenarioId(scenario.id);
  };

  const handleDeleteScenario = () => {
    if (selectedScenarioId === "default") return;
    if (confirm("Are you sure you want to delete this scenario?")) {
      const newScenarios = scenarios.filter((s) => s.id !== selectedScenarioId);
      setScenarios(newScenarios);
      localStorage.setItem("regulation_scenarios", JSON.stringify(newScenarios));
      setSelectedScenarioId("default");
    }
  };

  const handleEditScenario = () => {
    const scenario = scenarios.find((s) => s.id === selectedScenarioId);
    if (scenario) {
      setEditingScenario(scenario);
      setIsEditorOpen(true);
    }
  };

  const handleNewScenario = () => {
    setEditingScenario(null);
    setIsEditorOpen(true);
  };

  const reportingOptions = [
    "Expectation",
    "Mode",
    "z-5",
    "z-15",
    "z-30",
    "z-45",
    "z-60",
    "z-75",
    "z-90",
    "z-95",
  ];

  return (
    <>
      <div
        className={
          embedded
            ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
            : "absolute top-20 left-4 z-50 min-w-[280px] max-w-[420px] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
        }
      >
        <div className="p-4 space-y-4">
          {/* Model Section */}
          <div className="bg-white/5 rounded-lg p-4">
            <h2 className="font-semibold mb-3">Simulation Settings</h2>
            <div className="space-y-3">
              <FormField label="Prediction Model">
                <div className="relative">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full appearance-none pl-3 pr-10 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent [&>option]:bg-slate-800 [&>option]:text-white"
                  >
                    <option value="SilverDrizzle 2023">
                      silver_drizzle_2023
                    </option>
                  </select>
                  <SelectChevron />
                </div>
              </FormField>

              <FormField label="Operational Scenario">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      value={selectedScenarioId}
                      onChange={(e) => setSelectedScenarioId(e.target.value)}
                      className="w-full appearance-none pl-3 pr-10 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent [&>option]:bg-slate-800 [&>option]:text-white"
                    >
                      <option value="default">-</option>
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                  <button
                    onClick={handleNewScenario}
                    className="flex items-center justify-center w-10 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 transition-colors"
                    title="New Scenario"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  {selectedScenarioId !== "default" && (
                    <>
                      <button
                        onClick={handleEditScenario}
                        className="flex items-center justify-center w-10 rounded-lg bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors"
                        title="Edit Scenario"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={handleDeleteScenario}
                        className="flex items-center justify-center w-10 rounded-lg bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors"
                        title="Delete Scenario"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </FormField>
            </div>
          </div>

          {/* Parametric Settings Section */}
          <div className="bg-white/5 rounded-lg p-4">
            <h2 className="font-semibold mb-3">Parametric Settings</h2>

            {/* Warnings Subsection */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2 opacity-90">Warnings</h3>
              <div className="space-y-3 bg-white/5 rounded-lg p-3">
                <FormField
                  label="α threshold"
                  description="Critical threshold in confidence to be considered as a credible hotspot"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={alphaThreshold}
                      onChange={(e) => setAlphaThreshold(parseFloat(e.target.value))}
                      className="flex-1 appearance-none h-1.5 rounded-full bg-white/20 accent-sky-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
                    />
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={alphaThreshold}
                      onChange={(e) => setAlphaThreshold(parseFloat(e.target.value))}
                      className="w-16 px-2 py-1 rounded-lg bg-white/10 border border-white/20 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                    />
                  </div>
                </FormField>

                <FormField label="Reporting value">
                  <div className="relative">
                    <select
                      value={reportingValue}
                      onChange={(e) => setReportingValue(e.target.value)}
                      className="w-full appearance-none pl-3 pr-10 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent [&>option]:bg-slate-800 [&>option]:text-white"
                    >
                      {reportingOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                </FormField>
              </div>
            </div>


          </div>
        </div>
      </div>
      <ScenarioEditorDialog
        open={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveScenario}
        initialScenario={editingScenario}
      />
    </>
  );
}

function FormField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1 opacity-90">{label}</label>
      {description && <div className="text-xs opacity-70 mb-1.5">{description}</div>}
      {children}
    </div>
  );
}
