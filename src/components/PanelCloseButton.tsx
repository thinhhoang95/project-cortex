"use client";

import { X } from "lucide-react";
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
      <X className="w-5 h-5" />
    </button>
  );
}

