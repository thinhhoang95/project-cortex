"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
    );
  }, [options, query]);

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
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`w-full min-h-[42px] px-2 py-2 rounded-lg border backdrop-blur-sm flex flex-wrap items-center gap-2 cursor-text
          ${disabled ? "opacity-60 cursor-not-allowed" : ""}
          bg-white/10 border-white/20 text-white hover:bg-white/15 focus-within:border-white/40`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
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
          ))
        ) : (
          <span className="text-white/60 text-sm ml-1"></span>
        )}
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
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-white placeholder-white/60"
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
          className="fixed bg-white/80 text-slate-900 backdrop-blur-sm border border-white/30 rounded-lg shadow-xl z-[9999]"
          style={{ left: menuRect.left, width: menuRect.width, top: menuRect.top, bottom: menuRect.bottom, maxHeight: typeof menuRect.maxH === "number" ? `${menuRect.maxH}px` : menuRect.maxH, overflowY: "auto" }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-700">No options</div>
          ) : (
            <ul className="py-1">
              {filtered.map((opt) => {
                const isSelected = selectedSet.has(opt.id);
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => { toggle(opt.id); setQuery(""); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b last:border-b-0 border-white/20 hover:bg-white/40 transition-colors ${isSelected ? "bg-white/30" : "bg-transparent"}`}
                    >
                      <span
                        className={`inline-flex w-4 h-4 items-center justify-center rounded-sm border ${isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-slate-400"}`}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium text-slate-900">
                          {renderOptionLabel ? renderOptionLabel(opt) : opt.label}
                        </div>
                        {opt.description && (
                          <div className="text-xs text-slate-700/80">{opt.description}</div>
                        )}
                      </div>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/60 border border-white/80 font-mono">
                        {opt.id}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>, document.body
      )}
    </div>
  );
}
