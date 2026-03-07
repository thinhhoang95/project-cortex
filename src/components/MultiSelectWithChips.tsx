"use client";
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ChipOption = {
  id: string;
  label: string;
  description?: string;
};

type MultiSelectWithChipsProps = {
  options: ChipOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxMenuHeight?: number | string;
  renderOptionLabel?: (opt: ChipOption) => React.ReactNode;
};

const VIRTUALIZE_THRESHOLD = 150;
const VIRTUAL_OPTION_HEIGHT = 44;
const VIRTUAL_OVERSCAN = 6;

export default function MultiSelectWithChips({
  options,
  selectedIds,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "",
  maxMenuHeight = 240,
  renderOptionLabel,
}: MultiSelectWithChipsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuScrollTop, setMenuScrollTop] = useState(0);
  const [menuRect, setMenuRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxH: number | string;
  } | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const container = containerRef.current;
      const menu = menuRef.current;
      const insideContainer = !!(container && container.contains(target));
      const insideMenu = !!(menu && menu.contains(target));
      if (insideContainer || insideMenu) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Position dropdown in a portal so it can overflow parent containers
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 8;
      const viewportH = window.innerHeight;
      const spaceBelow = viewportH - r.bottom - gap;
      const desired = typeof maxMenuHeight === "number" ? maxMenuHeight : 240;
      const placeBelow = spaceBelow >= Math.min(120, Number(desired));
      if (placeBelow) {
        setMenuRect({ left: r.left, width: r.width, top: r.bottom + gap, maxH: Math.min(spaceBelow, Number(desired)) });
      } else {
        const spaceAbove = r.top - gap;
        setMenuRect({ left: r.left, width: r.width, bottom: Math.max(viewportH - r.top + gap, 0), maxH: Math.min(spaceAbove, Number(desired)) });
      }
    };
    update();
    const opts: AddEventListenerOptions = { passive: true, capture: true } as any;
    window.addEventListener("resize", update, opts);
    window.addEventListener("scroll", update, opts);
    document.addEventListener("scroll", update, opts);
    return () => {
      window.removeEventListener("resize", update, opts as any);
      window.removeEventListener("scroll", update, opts as any);
      document.removeEventListener("scroll", update, opts as any);
    };
  }, [open, maxMenuHeight]);

  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const optionsById = useMemo(() => {
    const next = new Map<string, ChipOption>();
    options.forEach((option) => {
      next.set(option.id, option);
    });
    return next;
  }, [options]);
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
    );
  }, [options, deferredQuery]);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  };

  const remove = (id: string) => {
    if (!selectedSet.has(id)) return;
    const next = selectedIds.filter((x) => x !== id);
    onChange(next);
  };

  const clearAll = () => onChange([]);

  const selectedOptions = useMemo(
    () => selectedIds.map((id) => optionsById.get(String(id))).filter((opt): opt is ChipOption => Boolean(opt)),
    [selectedIds, optionsById]
  );
  const virtualized = filtered.length >= VIRTUALIZE_THRESHOLD;
  const resolvedMenuHeight = useMemo(() => {
    const fallbackHeight = typeof maxMenuHeight === "number" ? maxMenuHeight : Number(maxMenuHeight) || 240;
    if (!menuRect) return fallbackHeight;
    return typeof menuRect.maxH === "number" ? menuRect.maxH : fallbackHeight;
  }, [maxMenuHeight, menuRect]);
  const visibleCount = Math.max(1, Math.ceil(resolvedMenuHeight / VIRTUAL_OPTION_HEIGHT));
  const startIndex = virtualized
    ? Math.max(0, Math.floor(menuScrollTop / VIRTUAL_OPTION_HEIGHT) - VIRTUAL_OVERSCAN)
    : 0;
  const endIndex = virtualized
    ? Math.min(filtered.length, startIndex + visibleCount + VIRTUAL_OVERSCAN * 2)
    : filtered.length;
  const renderedOptions = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );
  const topSpacerHeight = virtualized ? startIndex * VIRTUAL_OPTION_HEIGHT : 0;
  const bottomSpacerHeight = virtualized
    ? Math.max(0, (filtered.length - endIndex) * VIRTUAL_OPTION_HEIGHT)
    : 0;

  useEffect(() => {
    if (!open) {
      setMenuScrollTop(0);
      return;
    }
    setMenuScrollTop(0);
    if (menuRef.current) {
      menuRef.current.scrollTop = 0;
    }
  }, [open, deferredQuery]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`w-full min-h-[42px] px-3 py-2 rounded-lg border backdrop-blur-sm flex flex-wrap items-center gap-2 cursor-text
          ${disabled ? "opacity-60 cursor-not-allowed" : ""}
          border-white/20 text-white hover:bg-white/15 focus-within:border-white/40 ${className}`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <svg
          className="w-5 h-5 text-white/60 flex-shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        {selectedOptions.map((opt) => (
          <span
            key={opt.id}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-white/20 border border-white/30"
            title={opt.description || opt.label}
          >
            <span className="font-mono">{opt.id}</span>
            <button
              type="button"
              className="hover:text-red-200"
              onClick={(e) => { e.stopPropagation(); remove(opt.id); }}
              aria-label={`Remove ${opt.label}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && query === "" && selectedIds.length > 0) {
              // Remove last chip
              onChange(selectedIds.slice(0, -1));
            }
            if (e.key === "Enter" && filtered.length > 0) {
              // toggle the first filtered item
              e.preventDefault();
              toggle(filtered[0].id);
              setQuery("");
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder={selectedOptions.length > 0 ? "" : placeholder}
          disabled={disabled}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-white placeholder-white/60 text-[12pt]"
        />
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); clearAll(); }}
            className="ml-auto px-2 py-1 text-[11px] rounded-md border border-white/20 bg-white/10 hover:bg-white/20"
          >
            Clear
          </button>
        )}
      </div>

      {open && !disabled && menuRect && createPortal(
        <div
          ref={menuRef}
          onMouseDown={(e) => e.stopPropagation()}
          onScroll={(e) => setMenuScrollTop(e.currentTarget.scrollTop)}
          className="fixed glass-menu rounded-lg shadow-xl z-[9999] overflow-hidden"
          style={{ left: menuRect.left, width: menuRect.width, top: menuRect.top, bottom: menuRect.bottom, maxHeight: typeof menuRect.maxH === "number" ? `${menuRect.maxH}px` : menuRect.maxH, overflowY: "auto" }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm glass-menu-muted">No options</div>
          ) : (
            <ul className="py-1">
              {topSpacerHeight > 0 && <li aria-hidden="true" style={{ height: `${topSpacerHeight}px` }} />}
              {renderedOptions.map((opt) => {
                const isSelected = selectedSet.has(opt.id);
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => { toggle(opt.id); setQuery(""); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b last:border-b-0 border-[var(--menu-border)] transition-colors hover:bg-[var(--menu-hover-bg)] ${isSelected ? "bg-[var(--menu-hover-bg)]" : "bg-transparent"}`}
                    >
                      <span
                        className={`inline-flex w-4 h-4 items-center justify-center rounded-sm border ${isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-[var(--menu-border)] text-[var(--menu-text)]"}`}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium text-[var(--menu-text)]">
                          {renderOptionLabel ? renderOptionLabel(opt) : opt.label}
                        </div>
                        {opt.description && (
                          <div className="text-xs glass-menu-muted">{opt.description}</div>
                        )}
                      </div>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--panel-bg-muted)] border border-[var(--menu-border)] text-[var(--menu-text-muted)] font-mono">
                        {opt.id}
                      </span>
                    </button>
                  </li>
                );
              })}
              {bottomSpacerHeight > 0 && <li aria-hidden="true" style={{ height: `${bottomSpacerHeight}px` }} />}
            </ul>
          )}
        </div>, document.body
      )}
    </div>
  );
}
