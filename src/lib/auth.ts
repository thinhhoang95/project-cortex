"use client";

import { useSimStore } from "@/components/useSimStore";

export function getAuthHeader(): Record<string, string> {
  const token = useSimStore.getState().user?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const baseHeaders: Record<string, string> = {};
  const provided = init?.headers;
  if (provided instanceof Headers) {
    provided.forEach((v, k) => { baseHeaders[k] = v as string; });
  } else if (Array.isArray(provided)) {
    for (const [k, v] of provided) baseHeaders[String(k)] = String(v);
  } else if (provided && typeof provided === 'object') {
    Object.assign(baseHeaders, provided as Record<string, string>);
  }
  const headers = { ...baseHeaders, ...getAuthHeader() } as HeadersInit;
  return fetch(input as any, { ...(init || {}), headers });
}

