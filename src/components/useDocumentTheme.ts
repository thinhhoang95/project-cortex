"use client";

import { useEffect, useState } from "react";

export type DocumentTheme = "dark" | "light";

function readDocumentTheme(): DocumentTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useDocumentTheme(): DocumentTheme {
  const [theme, setTheme] = useState<DocumentTheme>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setTheme(readDocumentTheme());
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
