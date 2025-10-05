"use client";

import { useEffect, useState } from "react";
import ModalDialog from "./ModalDialog";
import { APP_VERSION } from "@/lib/version";

const RELEASE_NOTES_VERSION = APP_VERSION;
const LOCAL_STORAGE_KEY = "release-notes-version";

const RELEASE_NOTES_CONTENT = `
  <h2 class="text-2xl font-bold mb-4">Highlights</h2>
  
  <p class="mb-4"> We have fixed some bugs and added some new features as usual.</p>
  
  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Color bar feature.</strong> You can now have the usual experience of glancing at the color bar to quickly scan for traffic overloads, similarly in ETFMS/iFlow. The overload color bar is available under everywhere you see a histogram occupancy chart.</li>
    <li><strong>A Smarter Flight Filter.</strong> The intelligent flight querying system is now powered by a more recent checkpoint of a custom fine-tuned model based on Qwen3-32B: faster and more accurate.</li>
    <li><strong>Regulation Proposals.</strong> You can now pick any traffic volume to see automatically generated proposals for regulation.</li>
  </ul>
  
  <h2 class="text-2xl font-bold mb-4">Tell us what you think!</h2>
  <p class="mb-4">We value your feedback and are constantly improving the app. Please share your thoughts with me via dthoang@intuelle.com.</p>
  
  <h2 class="text-2xl font-bold mb-4">Looking ahead</h2>
  <p>A new prediction tab is coming, with the ability to visualize predictions for every single flight, along with confidence intervals for occupancy counts and probability of overloads.</p>

  <p class="mt-8">Happy cooking!</p>
  <p> Yours truly, Thinh.</p>
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
      title="Release Notes"
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
            className="inline-flex items-center rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 shadow-sm transition hover:bg-sky-500/30"
          >
            OK
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
