"use client";

import { useEffect, useState } from "react";

type RegionSwitchBannerProps = {
  usAppUrl?: string;
};

const DISMISS_STORAGE_KEY = "flow-kitchen-region-banner-dismissed";

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function deriveUsUrl(currentHref: string, overrideBaseUrl?: string): string {
  const currentUrl = new URL(currentHref);

  if (overrideBaseUrl) {
    const baseUrl = new URL(overrideBaseUrl);
    baseUrl.pathname = currentUrl.pathname;
    baseUrl.search = currentUrl.search;
    baseUrl.hash = currentUrl.hash;
    return baseUrl.toString();
  }

  if (isLocalHost(currentUrl.hostname)) {
    return currentUrl.pathname + currentUrl.search + currentUrl.hash;
  }

  const nextUrl = new URL(currentHref);
  if (nextUrl.hostname.startsWith("eu.")) {
    nextUrl.hostname = `us.${nextUrl.hostname.slice(3)}`;
    return nextUrl.toString();
  }
  if (nextUrl.hostname.includes(".eu.")) {
    nextUrl.hostname = nextUrl.hostname.replace(".eu.", ".us.");
    return nextUrl.toString();
  }
  if (!nextUrl.hostname.startsWith("us.")) {
    nextUrl.hostname = `us.${nextUrl.hostname}`;
  }
  return nextUrl.toString();
}

export default function RegionSwitchBanner({
  usAppUrl = process.env.NEXT_PUBLIC_US_APP_URL,
}: RegionSwitchBannerProps) {
  const [targetHref, setTargetHref] = useState<string>(usAppUrl || "/");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setTargetHref(deriveUsUrl(window.location.href, usAppUrl));
    setDismissed(window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1");
  }, [usAppUrl]);

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
          <span className="text-xl leading-none">
            <svg width="28" height="20" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-label="Vietnam Flag" className="inline-block mr-2 align-middle">
              <rect width="28" height="20" fill="#da251d"/>
              <polygon
                points="14,4.5 15.755,10.14 21.82,10.14 16.84,13.54 18.595,19.18 14,15.6 9.405,19.18 11.16,13.54 6.18,10.14 12.245,10.14"
                fill="#ff0"
              />
            </svg>
          </span>
          <span className="text-slate-100/92">
            Nhiệt liệt chào mừng Ngày bầu cử đại biểu Quốc hội khóa XVI và đại biểu Hội đồng nhân dân các cấp nhiệm kỳ 2026 - 2031
          </span>
        </span>
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
