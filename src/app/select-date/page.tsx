"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ResourceDateSelectorPanel from "@/components/ResourceDateSelectorPanel";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";

function getReasonText(reason: string | null): string | null {
  if (reason === "missing") {
    return "Select a supported resource date before entering the application.";
  }
  if (reason === "invalid") {
    return "Your previously saved resource date is no longer supported by both the API and the local manifest. Pick a new one to continue.";
  }
  if (reason === "out_of_sync") {
    return "The server restarted with a different active resource date than the one saved in your browser. Pick a date again to re-synchronize the session.";
  }
  return null;
}

export default function SelectDatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hydrated, ready, user } = useResourceDateGuard({ allowMissingResourceDate: true });
  const reason = useMemo(() => getReasonText(searchParams.get("reason")), [searchParams]);

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.72),rgba(2,6,23,0.96))]" />
      <div className="pointer-events-none absolute -left-12 top-10 h-64 w-64 rounded-full bg-cyan-500/14 blur-3xl" />
      <div className="pointer-events-none absolute bottom-8 right-0 h-80 w-80 rounded-full bg-sky-400/12 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="w-full">
          <div className="mb-8 max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-white">
              Choose the dataset version for this session
            </h1>
            <p className="mt-3 text-base leading-7 text-white/65">
              The app now validates both the backend runtime and local browser resources before loading a date. Pick one supported on both sides, then continue into the workspace.
            </p>
          </div>

          <ResourceDateSelectorPanel
            variant="page"
            reason={reason}
            onComplete={() => {
              router.replace("/");
            }}
          />
        </div>
      </div>
    </main>
  );
}
