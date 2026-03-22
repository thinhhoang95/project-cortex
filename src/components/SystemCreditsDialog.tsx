"use client";

import ModalDialog from "./ModalDialog";

const SYSTEM_COMPONENTS = [
  {
    category: "Data Sources",
    active: "EUROCONTROL DDR2",
    supported: ["EUROCONTROL DDR2", "FAA ASPM/TFMSC"],
    logoFile: "eurocontrol.svg",
    logoPadding: "px-5 py-4",
  },
  {
    category: "Behavior Route Prediction",
    active: "Tailwind Predict Inverse RL",
    supported: ["Tailwind Predict Inverse RL", "Tailwind Neural Network"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
  {
    category: "Aircraft Performance",
    active: "Tailwind Predict",
    supported: ["Tailwind Predict", "BADA 3", "OpenAP (coming soon)"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
  {
    category: "Airspace Demand",
    active: "Tailwind Predict",
    supported: ["Tailwind Predict", "IFPS"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
  {
    category: "Weather Data",
    active: "ECMWF ERA5",
    supported: ["ECMWF ERA5", "NOAA HRRR"],
    logoFile: "ecmwf.svg",
    logoPadding: "px-5 py-4",
  },
  {
    category: "Optimization Engine",
    active: "Tailwind Heuristics Suite",
    supported: ["Tailwind RegulationZero", "Tailwind SA", "Tailwind NSGA-II"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
  {
    category: "LLM Provider",
    active: "OpenAI GPT-5.4",
    supported: ["OpenAI GPT-5.4", "Anthropic Claude 4.6 Sonnet"],
    logoFile: "openai.svg",
    logoPadding: "px-8 py-5",
  },
  {
    category: "Slot Allocation Algorithm",
    active: "Tailwind Computer Assisted Slot Allocation with Sequential Action (CASA²)",
    supported: ["CASA²", "EUROCONTROL CASA"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
  {
    category: "Posthoc Analysis",
    active: "Tailwind Posthoc",
    supported: ["Tailwind Posthoc", "FAA PDARS"],
    logoFile: "tailwind.svg",
    logoPadding: "px-6 py-5",
  },
];

type SystemCreditsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function SystemCreditsDialog({ open, onClose }: SystemCreditsDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="System Components"
      description="Active data sources, models, and services powering Flow's Kitchen"
      width="w-[min(1060px,95vw)]"
      height="h-[min(800px,92vh)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-3 gap-3">
            {SYSTEM_COMPONENTS.map((component) => {
              return (
                <div
                  key={component.category}
                  className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-white/20 hover:bg-white/[0.05] transition-all duration-200"
                >
                  {/* Logo zone */}
                  <div
                    className={`flex h-[88px] shrink-0 items-center justify-center bg-white/[0.04] ${component.logoPadding}`}
                  >
                    <img
                      src={`/assets/components/${component.logoFile}`}
                      alt={component.active}
                      className="max-h-full max-w-full object-contain brightness-0 invert opacity-75 group-hover:opacity-95 transition-opacity duration-200"
                      draggable={false}
                    />
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-white/8" />

                  {/* Info zone */}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                        {component.category}
                      </p>
                      <p className="text-[13px] font-semibold leading-snug text-white/90">
                        {component.active}
                      </p>
                    </div>

                    <div className="mt-auto flex flex-wrap gap-1">
                      {component.supported.map((item) => {
                        const cleanItem = item.replace(" (coming soon)", "");
                        const isActive = component.active === cleanItem || component.active.includes(cleanItem);
                        const isComingSoon = item.includes("(coming soon)");
                        return (
                          <span
                            key={item}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              isActive && !isComingSoon
                                ? "border-sky-500/30 bg-sky-500/10 text-sky-300/85"
                                : "border-white/[0.07] bg-white/[0.03] text-white/35"
                            }`}
                          >
                            {isActive && !isComingSoon && (
                              <span className="h-1 w-1 shrink-0 rounded-full bg-sky-400" />
                            )}
                            {item}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs text-white/25">
            Data Centers: <span className="text-sky-400">{`Lauterbourg, France · Bucharest, Romania · Reykjavik, Iceland · Prague, Czech Republic.`}</span>
          </p>
        </div>

        <div className="px-6 py-4 flex justify-end" style={{ borderTop: "1px solid var(--panel-divider)", backgroundColor: "var(--modal-footer-bg)" }}>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 shadow-sm transition hover:bg-sky-500/30"
          >
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
