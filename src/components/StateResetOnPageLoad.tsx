"use client";
import { useEffect } from "react";
import { useSimStore } from "@/components/useSimStore";

export default function StateResetOnPageLoad() {
  useEffect(() => {
    // Reset all app state to defaults when this page mounts
    try {
      useSimStore.getState().resetAll();
    } catch (e) {
      console.error("State reset failed:", e);
    }
  }, []);
  return null;
}

