"use client";

import ResourceStateHistoryControl from "@/components/ResourceStateHistoryControl";
import SlackViewControl from "@/components/SlackViewControl";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import { useSimStore } from "@/components/useSimStore";

type BottomControlsGroupProps = {
  showAirspaceDisplayToggle?: boolean;
};

export default function BottomControlsGroup({
  showAirspaceDisplayToggle = false,
}: BottomControlsGroupProps) {
  const viewOptionsMinimized = useSimStore((state) => state.viewOptionsMinimized);
  const setViewOptionsMinimized = useSimStore((state) => state.setViewOptionsMinimized);

  return (
    <>
      <div className="fixed left-1/2 bottom-0 z-40 -translate-x-1/2 pointer-events-none">
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-300 ease-in-out ${
            viewOptionsMinimized
              ? "translate-y-full opacity-0 pointer-events-none"
              : "-translate-y-6 opacity-100 pointer-events-auto"
          }`}
        >
          <ResourceStateHistoryControl embedded />
          <SlackViewControl embedded />
          <ViewOptionsControl embedded showAirspaceDisplayToggle={showAirspaceDisplayToggle} />
        </div>
      </div>
      <BottomPanelToggleButton
        minimized={viewOptionsMinimized}
        onToggle={() => setViewOptionsMinimized(!viewOptionsMinimized)}
      />
    </>
  );
}

function BottomPanelToggleButton({ minimized, onToggle }: { minimized: boolean; onToggle: () => void }) {
  const actionLabel = minimized ? "Expand bottom controls" : "Collapse bottom controls";
  const iconRotationClass = minimized ? "-rotate-90" : "rotate-90";

  return (
    <button
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onClick={onToggle}
      className="fixed left-1/2 bottom-0 z-50 -translate-x-1/2 translate-y-1/2 hover:translate-y-0 focus-visible:translate-y-0 active:translate-y-0 w-10 h-10 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={`h-4 w-4 transition-transform duration-300 ease-in-out ${iconRotationClass}`}
        fill="none"
      >
        <path
          d="M9 5l7 7-7 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
