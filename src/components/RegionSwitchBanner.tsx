"use client";

import { ChevronDown } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const DISMISS_STORAGE_KEY = "flow-kitchen-region-banner-dismissed";

export default function RegionSwitchBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const regionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!regionMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!regionMenuRef.current?.contains(event.target as Node)) {
        setRegionMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRegionMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [regionMenuOpen]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
  };

  if (dismissed) return null;

  return (
    <div className="relative z-[3000] border-b border-cyan-300/20 bg-[linear-gradient(90deg,rgba(8,47,73,0.94)_0%,rgba(15,23,42,0.98)_45%,rgba(30,41,59,0.96)_100%)] shadow-[0_16px_40px_-28px_rgba(34,211,238,0.45)]">
      <div className="mx-auto flex min-h-11 max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 pr-12 text-center text-sm text-slate-100">
        <span className="inline-flex items-center gap-2">
          <Image
            src="/assets/eu.svg"
            alt="European Union flag"
            width={28}
            height={20}
            className="mr-2 inline-block align-middle"
          />
          <span className="text-slate-100/92">
            You are using the European version of Flow&apos;s Kitchen.
          </span>
        </span>
        <div ref={regionMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setRegionMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={regionMenuOpen}
            className="inline-flex items-center gap-1 font-medium text-cyan-200 underline decoration-cyan-300/50 underline-offset-4 transition-colors hover:text-white hover:decoration-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          >
            Change
            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${regionMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {regionMenuOpen && (
            <div
              role="menu"
              aria-label="Choose a Flow's Kitchen region"
              className="absolute left-1/2 top-full z-10 mt-3 w-56 -translate-x-1/2 overflow-hidden rounded-lg border border-white/15 bg-slate-900/95 p-1.5 text-left shadow-2xl backdrop-blur-xl"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-slate-100 transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  🇺🇸
                </span>
                <span>United States</span>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close region banner"
          className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center text-base text-white/60 transition-colors hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
