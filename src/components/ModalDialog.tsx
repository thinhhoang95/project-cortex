import React from "react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  height?: string;
}

export default function ModalDialog({
  open,
  onClose,
  title,
  children,
  width = "w-[min(1080px,95vw)]",
  height = "h-[min(860px,92vh)]",
}: ModalDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[14px]" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div 
          className={`${width} ${height} rounded-2xl border border-white/20 bg-slate-800/70 backdrop-blur-2xl shadow-2xl text-white overflow-hidden relative flex flex-col`}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5 shrink-0">
            <div className="text-2xl font-semibold">{title}</div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 border border-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18"></path>
                <path d="M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
