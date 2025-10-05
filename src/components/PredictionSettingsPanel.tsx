"use client";
import { useState } from "react";
import SelectChevron from "@/components/SelectChevron";

type PredictionSettingsPanelProps = {
  embedded?: boolean;
};

export default function PredictionSettingsPanel({
  embedded = true,
}: PredictionSettingsPanelProps) {
  const [model, setModel] = useState("Equinox Summer 2023");
  const [regulationScenario, setRegulationScenario] = useState("Default");
  const [alphaThreshold, setAlphaThreshold] = useState(0.85);
  const [reportingValue, setReportingValue] = useState("Expectation");
  const [rerouteWDelay, setRerouteWDelay] = useState(1.0);
  const [rerouteTDelay, setRerouteTDelay] = useState(30);
  const [cancellationWDelay, setCancellationWDelay] = useState(1.5);
  const [cancellationTDelay, setCancellationTDelay] = useState(60);

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
            <FormField label="Behavioural Model">
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full appearance-none pl-3 pr-10 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  <option value="Equinox Summer 2023">
                    Equinox Summer 2023
                  </option>
                </select>
                <SelectChevron />
              </div>
            </FormField>

            <FormField label="Regulation Scenario">
              <div className="relative">
                <select
                  value={regulationScenario}
                  onChange={(e) => setRegulationScenario(e.target.value)}
                  className="w-full appearance-none pl-3 pr-10 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  <option value="Default">Default</option>
                </select>
                <SelectChevron />
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

          {/* AU Reroutes Subsection */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2 opacity-90">AU Reroutes</h3>
            <div className="space-y-3 bg-white/5 rounded-lg p-3">
              <FormField label="w_delay" description="AU's sensitivity to delay that triggers reroutes">
                <input
                  type="number"
                  step="0.1"
                  value={rerouteWDelay}
                  onChange={(e) => setRerouteWDelay(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                />
              </FormField>

              <FormField label="t_delay" description="AU's threshold of sensitivity that triggers reroutes">
                <input
                  type="number"
                  step="1"
                  value={rerouteTDelay}
                  onChange={(e) => setRerouteTDelay(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                />
              </FormField>
            </div>
          </div>

          {/* AU Cancellation Subsection */}
          <div>
            <h3 className="text-sm font-semibold mb-2 opacity-90">AU Cancellation</h3>
            <div className="space-y-3 bg-white/5 rounded-lg p-3">
              <FormField label="w_delay" description="AU's sensitivity to delay that triggers cancellations">
                <input
                  type="number"
                  step="0.1"
                  value={cancellationWDelay}
                  onChange={(e) => setCancellationWDelay(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                />
              </FormField>

              <FormField label="t_delay" description="AU's threshold of sensitivity that triggers cancellations">
                <input
                  type="number"
                  step="1"
                  value={cancellationTDelay}
                  onChange={(e) => setCancellationTDelay(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                />
              </FormField>
            </div>
          </div>
        </div>
      </div>
    </div>
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
