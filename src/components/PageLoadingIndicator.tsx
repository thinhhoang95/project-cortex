"use client";

import ShimmeringText from "@/components/ShimmeringText";

type PageLoadingIndicatorProps = {
  visible?: boolean;
  text?: string;
};

export default function PageLoadingIndicator({ visible = false, text = "Sweeping the skies..." }: PageLoadingIndicatorProps) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="flex items-center rounded-xl bg-white/10 backdrop-blur-md border border-white/30 px-3 py-2 shadow-lg">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
        <ShimmeringText text={text} className="ml-2 text-sm opacity-80" />
      </div>
    </div>
  );
}


