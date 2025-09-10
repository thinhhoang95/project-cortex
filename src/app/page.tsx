'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSimStore } from "@/components/useSimStore";
import MapCanvas from "@/components/MapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";

export default function Page() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (hydrated && !user) {
      router.push('/login');
    }
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <MapCanvas />
      {/* Left-side wrapper: full-height, scrolls; panel inside does not */}
      <div className="absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <LeftControl1 embedded />
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div className="absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none">
        <div className="pointer-events-auto">
          <RightControl1 embedded />
        </div>
      </div>
      <ViewOptionsControl />
    </main>
  );
}
