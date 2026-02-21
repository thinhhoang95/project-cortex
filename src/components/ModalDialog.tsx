"use client";
import React from "react";
import { createPortal } from "react-dom";
import PanelCloseButton from "@/components/PanelCloseButton";

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
          className={`${width} ${height} rounded-2xl border border-white/15 bg-slate-900/95 text-white shadow-[0_24px_80px_-32px_rgba(59,130,246,0.8)] overflow-hidden relative flex flex-col isolate`}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <div>
              <div className="text-lg font-semibold">{title}</div>
              {description && (
                <p className="text-xs text-white/60 mt-0.5">{description}</p>
              )}
            </div>
            <PanelCloseButton
              onClick={onClose}
              ariaLabel="Close dialog"
              title="Close dialog"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
