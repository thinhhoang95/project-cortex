"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pin, Search, Trash2, X } from "lucide-react";
import { useGlobalTVBasket } from "@/components/useGlobalTVBasket";
import { useGlobalTVBasketStore } from "@/components/useGlobalTVBasketStore";
import { buildGlobalTvBasketScope } from "@/lib/globalTvBasket";

const ROW_HEIGHT = 38;
const MENU_HEIGHT = 266;
const OVERSCAN = 5;

export type GlobalTVBasketProps = {
  contextTvIds?: readonly string[];
  className?: string;
  compact?: boolean;
};

export default function GlobalTVBasket({
  contextTvIds = [],
  className = "",
  compact = false,
}: GlobalTVBasketProps) {
  const {
    catalogIds,
    catalogLoading,
    catalogError,
    pinnedTvIds,
    searchQuery,
  } = useGlobalTVBasket(contextTvIds);
  const setSearchQuery = useGlobalTVBasketStore((state) => state.setSearchQuery);
  const togglePin = useGlobalTVBasketStore((state) => state.togglePin);
  const pinAll = useGlobalTVBasketStore((state) => state.pinAll);
  const clearPins = useGlobalTVBasketStore((state) => state.clearPins);
  const unpinTv = useGlobalTVBasketStore((state) => state.unpinTv);
  const [open, setOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [draftQuery, setDraftQuery] = useState(searchQuery);
  const deferredDraftQuery = useDeferredValue(draftQuery);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [menuRect, setMenuRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    height: number;
  } | null>(null);
  const previewScope = useMemo(
    () => buildGlobalTvBasketScope({
      catalogIds,
      contextIds: contextTvIds,
      pinnedIds: pinnedTvIds,
      query: deferredDraftQuery,
    }),
    [catalogIds, contextTvIds, deferredDraftQuery, pinnedTvIds],
  );
  const {
    activePinnedIds,
    dormantPinnedIds,
    matchedCatalogIds,
    orderedContextIds,
    isFiltering,
  } = previewScope;
  const commitSearchQuery = useCallback(() => {
    if (draftQuery !== useGlobalTVBasketStore.getState().searchQuery) {
      setSearchQuery(draftQuery);
    }
  }, [draftQuery, setSearchQuery]);

  const pinnedKeys = useMemo(
    () => new Set(pinnedTvIds.map((id) => id.toLocaleUpperCase())),
    [pinnedTvIds],
  );
  const visibleCount = Math.ceil(MENU_HEIGHT / ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    matchedCatalogIds.length,
    startIndex + visibleCount + OVERSCAN * 2,
  );
  const renderedMatches = matchedCatalogIds.slice(startIndex, endIndex);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    setScrollTop(0);
  }, [deferredDraftQuery]);

  useEffect(() => {
    setDraftQuery((current) => current === searchQuery ? current : searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (draftQuery === searchQuery) return;
    const timeoutId = window.setTimeout(() => setSearchQuery(draftQuery), 250);
    return () => window.clearTimeout(timeoutId);
  }, [draftQuery, searchQuery, setSearchQuery]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const desiredHeight = Math.min(
        MENU_HEIGHT,
        Math.max(48, matchedCatalogIds.length * ROW_HEIGHT),
      );
      const gap = 6;
      const spaceBelow = Math.max(48, window.innerHeight - rect.bottom - gap);
      const spaceAbove = Math.max(48, rect.top - gap);
      if (spaceBelow >= Math.min(120, desiredHeight) || spaceBelow >= spaceAbove) {
        setMenuRect({
          left: rect.left,
          top: rect.bottom + gap,
          width: rect.width,
          height: Math.min(desiredHeight, spaceBelow),
        });
      } else {
        setMenuRect({
          left: rect.left,
          bottom: window.innerHeight - rect.top + gap,
          width: rect.width,
          height: Math.min(desiredHeight, spaceAbove),
        });
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [matchedCatalogIds.length, open]);

  return (
    <div
      ref={rootRef}
      className={`rounded-xl border border-white/10 bg-black/20 ${compact ? "p-3" : "p-4"} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-300/20 bg-sky-500/10 text-sky-200">
            <Pin className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/65">
              Global TV Basket
            </div>
            <div className="mt-0.5 text-xs text-white/55">
              {activePinnedIds.length} active pin{activePinnedIds.length === 1 ? "" : "s"}
              {dormantPinnedIds.length > 0
                ? ` · ${dormantPinnedIds.length} unavailable for this date`
                : ""}
              {isFiltering
                ? ` · ${matchedCatalogIds.length} catalog match${matchedCatalogIds.length === 1 ? "" : "es"}`
                : ""}
              {contextTvIds.length > 0
                ? ` · ${orderedContextIds.length} shown in this context`
                : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pinnedTvIds.length > 0 && (
            <button
              type="button"
              onClick={clearPins}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/70 transition hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear pins
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-3">
        <div className="flex min-h-[42px] items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 focus-within:border-sky-300/60">
          <Search className="h-4 w-4 shrink-0 text-white/45" aria-hidden="true" />
          <input
            ref={inputRef}
            value={draftQuery}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setDraftQuery(event.currentTarget.value);
              setOpen(true);
            }}
            onBlur={commitSearchQuery}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter") commitSearchQuery();
            }}
            placeholder={catalogLoading ? "Loading traffic volumes…" : "Filter TVs (supports * and ?)"}
            aria-label="Search global traffic volume basket"
            className="min-w-[180px] flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/40"
          />
          {draftQuery && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraftQuery("");
                setSearchQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear traffic volume search"
              title="Clear search"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            disabled={!isFiltering || matchedCatalogIds.length === 0}
            onClick={() => {
              commitSearchQuery();
              pinAll(matchedCatalogIds);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-sky-300/30 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
            Pin all matches
          </button>
        </div>

        {open && isFiltering && menuRect && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] overflow-auto rounded-lg border border-white/15 bg-slate-950/95 shadow-2xl backdrop-blur-xl"
            style={{
              left: menuRect.left,
              top: menuRect.top,
              bottom: menuRect.bottom,
              width: menuRect.width,
              height: menuRect.height,
            }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {matchedCatalogIds.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-white/55">
                <Search className="h-4 w-4 opacity-60" aria-hidden="true" />
                No matching traffic volumes.
              </div>
            ) : (
              <div style={{ height: matchedCatalogIds.length * ROW_HEIGHT, position: "relative" }}>
                <div style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
                  {renderedMatches.map((id) => {
                    const isPinned = pinnedKeys.has(id.toLocaleUpperCase());
                    return (
                      <button
                        type="button"
                        key={id}
                        onClick={() => {
                          commitSearchQuery();
                          togglePin(id);
                        }}
                        className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-3 text-left text-sm text-white/85 hover:bg-white/10"
                        style={{ height: ROW_HEIGHT }}
                        aria-label={`${isPinned ? "Unpin" : "Pin"} ${id}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Pin
                            className={`h-3.5 w-3.5 shrink-0 ${isPinned ? "fill-current text-emerald-300" : "text-white/35"}`}
                            aria-hidden="true"
                          />
                          <span className="truncate font-mono">{id}</span>
                        </span>
                        <span className={`text-[11px] ${isPinned ? "text-emerald-300" : "text-white/45"}`}>
                          {isPinned ? "Pinned" : "Pin"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
      </div>

      {catalogError && (
        <div className="mt-2 text-xs text-rose-300">{catalogError}</div>
      )}

      {pinnedTvIds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pinnedTvIds.map((id) => {
            const dormant = dormantPinnedIds.some(
              (candidate) => candidate.toLocaleUpperCase() === id.toLocaleUpperCase(),
            );
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                  dormant
                    ? "border-amber-300/30 bg-amber-500/10 text-amber-100/75"
                    : "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                }`}
                title={dormant ? "Unavailable for the active resource date" : "Pinned traffic volume"}
              >
                <Pin
                  className={`h-3 w-3 shrink-0 opacity-80 ${dormant ? "" : "fill-current"}`}
                  aria-hidden="true"
                />
                <span className="font-mono">{id}</span>
                <button
                  type="button"
                  onClick={() => unpinTv(id)}
                  aria-label={`Unpin ${id}`}
                  title={`Unpin ${id}`}
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-current opacity-55 transition hover:bg-black/20 hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
