"use client";

import { useEffect, useState } from "react";
import ModalDialog from "./ModalDialog";

const RELEASE_NOTES_VERSION = "2024.09.01";
const LOCAL_STORAGE_KEY = "release-notes-version";

const RELEASE_NOTES_CONTENT = `
  <h2>Highlights</h2>
  <p>Welcome to the latest Project Cortex update! This release introduces a collection of improvements designed to streamline your operations and give controllers better situational awareness.</p>
  <ul>
    <li><strong>Stability upgrades:</strong> Numerous under-the-hood enhancements reduce latency spikes when ingesting high-volume flow data.</li>
    <li><strong>Visualization refresh:</strong> The tactical map now features clearer altitude coloring, making congested sectors easier to spot.</li>
    <li><strong>Smarter recommendations:</strong> Flight prioritization automatically accounts for arrival bank constraints to keep downstream airports balanced.</li>
  </ul>
  <h2>Quality of life</h2>
  <p>We also addressed several long-standing paper cuts and community requests.</p>
  <ol>
    <li>Copied regulation plans preserve custom titles and sharing permissions.</li>
    <li>When switching scenarios the previously selected airport stays pinned.</li>
    <li>Search remembers your five most recent queries for rapid access.</li>
  </ol>
  <h2>Looking ahead</h2>
  <p>Expect more collaboration tooling and per-flight annotations in upcoming releases. As always, share your feedback directly from the app sidebar.</p>
`;

export default function ReleaseNotesDialog() {
  const [open, setOpen] = useState(false);
  const [checkedVersion, setCheckedVersion] = useState(false);

  useEffect(() => {
    if (checkedVersion) return;

    if (typeof window === "undefined") return;

    const storedVersion = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedVersion !== RELEASE_NOTES_VERSION) {
      setOpen(true);
    }
    setCheckedVersion(true);
  }, [checkedVersion]);

  const handleClose = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, RELEASE_NOTES_VERSION);
    }
    setOpen(false);
  };

  if (!open) {
    return null;
  }

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      title="Project Cortex Release Notes"
      description={`Version ${RELEASE_NOTES_VERSION}`}
      height="h-[min(720px,92vh)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div
            className="prose prose-invert max-w-none text-white/90"
            dangerouslySetInnerHTML={{ __html: RELEASE_NOTES_CONTENT }}
          />
        </div>
        <div className="border-t border-white/10 bg-slate-900/80 px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center rounded-lg border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 shadow-sm transition hover:bg-sky-500/30"
          >
            OK
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
