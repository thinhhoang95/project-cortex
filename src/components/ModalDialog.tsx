"use client";
import React from "react";
import { createPortal } from "react-dom";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  height?: string;
}

export default function ModalDialog({
  open,
  onClose,
  title,
  description,
  children,
  width = "w-[min(1080px,95vw)]",
  height = "h-[min(860px,92vh)]",
}: ModalDialogProps) {
  if (!open) return null;
  const content = (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div
          className={`${width} ${height} rounded-2xl border border-white/15 bg-slate-900/95 text-white shadow-[0_24px_80px_-32px_rgba(59,130,246,0.8)] overflow-hidden relative flex flex-col`}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <div>
              <div className="text-lg font-semibold">{title}</div>
              {description && (
                <p className="text-xs text-white/60 mt-0.5">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
              aria-label="Close dialog"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
