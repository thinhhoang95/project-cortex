"use client";

import type { ComponentPropsWithoutRef } from "react";

type PanelCloseButtonProps = ComponentPropsWithoutRef<"button"> & {
  ariaLabel?: string;
};

export default function PanelCloseButton({
  className = "",
  title = "Close panel",
  ariaLabel,
  ...props
}: PanelCloseButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      className={`p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors ${className}`}
      {...props}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

