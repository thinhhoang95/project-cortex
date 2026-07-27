"use client";
import React from "react";
import { createPortal } from "react-dom";
import PanelCloseButton from "@/components/PanelCloseButton";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  height?: string;
  dismissible?: boolean;
}

export default function ModalDialog({
  open,
  onClose,
  title,
  description,
  headerActions,
  children,
  width = "w-[min(1080px,95vw)]",
  height = "h-[min(860px,92vh)]",
  dismissible = true,
}: ModalDialogProps) {
  if (!open) return null;
  const content = (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "var(--modal-overlay)" }}
        onClick={dismissible ? onClose : undefined}
      />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div
          className={`${width} ${height} rounded-2xl border overflow-hidden relative flex flex-col isolate backdrop-blur-2xl`}
          style={{
            background: "var(--modal-surface)",
            borderColor: "var(--panel-border)",
            color: "var(--foreground)",
            boxShadow: "0 32px 90px -28px rgba(2, 6, 23, 0.78), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
            <div>
              <div className="text-lg font-semibold">{title}</div>
              {description && (
                <p className="text-xs mt-0.5" style={{ color: "var(--panel-text-muted)" }}>{description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerActions}
              {dismissible && (
                <PanelCloseButton
                  onClick={onClose}
                  ariaLabel="Close dialog"
                  title="Close dialog"
                />
              )}
            </div>
          </div>
          <div className="modal-scrollbar overflow-y-auto flex-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
