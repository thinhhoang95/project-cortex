"use client";

import { useEffect, useState } from "react";
import ModalDialog from "./ModalDialog";
import { APP_VERSION } from "@/lib/version";

const RELEASE_NOTES_VERSION = APP_VERSION;
const LOCAL_STORAGE_KEY = "release-notes-version";

const RELEASE_NOTES_CONTENT = `
  <h2 class="text-2xl font-bold mb-4">Highlights</h2>
  
  <p class="mb-4"> We have fixed some bugs and added some new features as usual.</p>

  <h4 class="font-bold mb-4">Fri. 20/03/2026</h4>
  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Slack Overlay for Traffic Volumes.</strong> You can now toggle a slack overlay directly on the map and canvas views (Flow, Regulation, and Reroute) to quickly visualize the slack between demand and capacity across traffic volumes.</li>
    <li><strong>Slack Distribution API Enhancement.</strong> The slack distribution API now accepts a \`tv_kind\` parameter, enabling more granular data retrieval for different traffic volume types.</li>
  </ul>

  <h4 class="font-bold mb-4">Fri. 06/03/2026</h4>
  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Support for multi-date switching.</strong> You can now switch operational datasets by date using a calendar-based selector, with consistent date handling across the app using ISO format (\`YYYY-MM-DD\`).</li>
    <li><strong>Date feasibility validation (client + API).</strong> Dates are enabled only when both sides are ready: local browser artifacts declared in \`resource_manifest.json\` and backend runtime support from \`resource_context\`.</li>
    <li><strong>Server/client date sync guard.</strong> If the backend restarts and the active server date no longer matches the browser-saved date, pages now redirect to date selection to re-synchronize safely.</li>
    <li><strong>First-session date onboarding.</strong> Users without a selected resource date are now routed to a dedicated selection page before entering the workspace.</li>
    <li><strong>Hard cache invalidation on date switch.</strong> Switching date now clears browser storage cache and in-memory preloaded artifact caches so flight lists, traffic volume definitions, and TV capacity ranges are re-downloaded for the selected date.</li>
    <li><strong>Manual cache clear now performs full reset.</strong> The profile menu cache action now clears cache storage, invalidates preloaded artifact caches, clears selected date, and routes back to date selection to prevent stale cross-date data.</li>
  </ul>

  <h4 class="font-bold mb-4">Fri. 27/02/2026</h4>
  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Flight Catcher.</strong> Now you can draw directly on the map to indicate which flights you want to catch. It works across reroutes, regulation and DeepFlow's flight selection.</li>
    <li><strong>Reroute Scenario Design.</strong> It is now possible to use the two Reroute Design Tools (obstacle and funnel) to design reroute scenarios and quickly preview the extra NMs. In future Tailwind's update, we will support regeneration of 4D trajectory and lexicographic optimization of both regulations and reroute scenarios.</li>
    </ul>
  <h4 class="font-bold mb-4">Sat. 21/02/2026</h4>
  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Flow Heuristics.</strong> We now show the flow heuristics by default, with the option to toggle flight lists manually.</li>
    <li><strong>Collapsed Sectors View.</strong> It is now possible to toggle the CS view to further analyze the component of hotspots. This is particularly helpful in inspecting whether it is possible to open more sectors.</li>
    <li><strong>TV Capacity Range.</strong> Capacity range for TV (factoring in the possibility of configuration changes) is now available throughout the platform.</li>
    <li><strong>Pressure Relief Map.</strong> Visualize the effects of regulations with a global view of the traffic volumes.</li>
    <li><strong>Planned but not yet implemented: </strong> Automatic naming of flows by Gemini 3 Pro, and narrating MCTS results to assist operators in natural language.</li> 
  </ul>

  <h4 class="font-bold mb-4">Tue. 25/11/2025</h4>

  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Entry counts.</strong> We have refactored all demands to entry counts (compared to occupancy count as previously). This is more in line with ETFMS/NEST implementation.</li>
    <li><strong>Agent's Result summary.</strong> The Agent's Result summary now lets you choose between the whole-plan view and per-episode view before retrieving data.</li>
    <li><strong>Prediction results.</strong> Prediction results are now available following the GA status of Project Silverdrizzle.</li>
  </ul>

  <h4 class="font-bold mb-4">Tue. 14/10/2025</h4>

  <ul class="list-disc pl-6 space-y-2 mb-4">
    <li><strong>Regulation Planner.</strong> The Regulation Planner is now fully functional. You can use it to find a regulation set that achieves network-wide Demand Capacity Balance (DCB). The planner uses a variant of Monte Carlo Tree Search (MCTS) to find the ordered regulations to achieve network-wide DCB. By default, four runs with slightly varying hyperparameters are used to find the best regulation set. Time to run ranges from 30 minutes to 2 hours.</li>
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

  <p class="mt-8">Happy cooking!</p>
  <p> Yours truly, Thinh.</p>
`;

type ReleaseNotesDialogProps = {
  open?: boolean;
  onClose?: () => void;
};

export default function ReleaseNotesDialog({ open: controlledOpen, onClose }: ReleaseNotesDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [checkedVersion, setCheckedVersion] = useState(false);
  const isControlled = typeof controlledOpen === "boolean";
  const open = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    if (isControlled) return;
    if (checkedVersion) return;

    if (typeof window === "undefined") return;

    const storedVersion = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedVersion !== RELEASE_NOTES_VERSION) {
      setInternalOpen(true);
    }
    setCheckedVersion(true);
  }, [checkedVersion, isControlled]);

  const handleClose = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, RELEASE_NOTES_VERSION);
    }
    if (isControlled) {
      onClose?.();
      return;
    }
    setInternalOpen(false);
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
        <div className="px-6 py-4 flex justify-end" style={{ borderTop: "1px solid var(--panel-divider)", backgroundColor: "var(--modal-footer-bg)" }}>
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
