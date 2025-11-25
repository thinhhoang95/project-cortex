"use client";

import { useEffect, useState } from "react";
import ModalDialog from "./ModalDialog";
import { APP_VERSION } from "@/lib/version";

const RELEASE_NOTES_VERSION = APP_VERSION;
const LOCAL_STORAGE_KEY = "release-notes-version";

const RELEASE_NOTES_CONTENT = `
  <h2 class="text-2xl font-bold mb-4">Highlights</h2>
  
  <p class="mb-4"> We have fixed some bugs and added some new features as usual.</p>

  <h4 class="font-bold mb-4">Tue. 25/11/2025</h4>

  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Entry counts.</strong> We have refactored all demands to entry counts (compared to occupancy count as previously). This is more in line with ETFMS/NEST implementation.</li>
    <li><strong>Agent's Result summary.</strong> The Agent's Result summary now lets you choose between the whole-plan view and per-episode view before retrieving data.</li>
    <li><strong>Prediction results.</strong> Prediction results are now available following the GA status of Project Silverdrizzle.</li>
  </ul>

  <h4 class="font-bold mb-4">Tue. 14/10/2025</h4>

  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Regulation Planner.</strong> The Regulation Planner is now fully functional. You can use it to find a regulation set that achieves network-wide Dynamic Capacity Balance (DCB). The planner uses a variant of Monte Carlo Tree Search (MCTS) to find the ordered regulations to achieve network-wide DCB. By default, four runs with slightly varying hyperparameters are used to find the best regulation set. Time to run ranges from 30 minutes to 2 hours.</li>
  </ul>

  <h4 class="font-bold mb-4">Wed. 08/10/2025</h4>

  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Sub-hourly capacity support (WIP).</strong> As Tailwind now provides sub-hourly capacity data, we have added the ability to see the capacity for each sub-hour.</li>
    <li><strong>Harmonizing color bar.</strong> The traffic overload color bar is now harmonized across all charts: Green for under capacity, Orange for slightly overloaded, Red for overloaded.</li>
    <li><strong>A more compact spacetime control.</strong> We made the spacetime control more compact for small screens. You can now do ATFM even from your iPad.</li>
    </ul>

  <h4 class="font-bold mb-4">Other October Updates</h4>
  
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
