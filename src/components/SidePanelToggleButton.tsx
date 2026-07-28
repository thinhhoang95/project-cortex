'use client';

import { ChevronRight } from "lucide-react";
interface SidePanelToggleButtonProps {
  side: 'left' | 'right';
  minimized: boolean;
  onToggle: () => void;
  panelGroupLabel: string;
}

export default function SidePanelToggleButton({
  side,
  minimized,
  onToggle,
  panelGroupLabel,
}: SidePanelToggleButtonProps) {
  const isLeft = side === 'left';
  const actionLabel = minimized ? `Expand ${panelGroupLabel}` : `Collapse ${panelGroupLabel}`;
  const iconRotationClass = isLeft
    ? minimized
      ? ''
      : 'rotate-180'
    : minimized
    ? 'rotate-180'
    : '';

  return (
    <button
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onClick={onToggle}
      className={`absolute top-1/2 -translate-y-1/2 z-50 w-10 h-10 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
        isLeft
          ? '-translate-x-1/2 hover:translate-x-0 focus-visible:translate-x-0 left-0'
          : 'translate-x-1/2 hover:translate-x-0 focus-visible:translate-x-0 right-0'
      }`}
    >
      <ChevronRight aria-hidden="true" className={`h-4 w-4 transition-transform duration-300 ease-in-out ${iconRotationClass}`} />
    </button>
  );
}
