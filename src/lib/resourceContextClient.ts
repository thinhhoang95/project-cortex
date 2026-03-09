"use client";

import { authFetch } from "@/lib/auth";
import type { ResourceContextResponse } from "@/lib/resourceDates";

async function parseJsonResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as Record<string, unknown>)?.error || `Request failed (${response.status})`;
    throw new Error(String(message));
  }
  return payload;
}

export async function fetchResourceContext(): Promise<ResourceContextResponse> {
  const response = await authFetch("/api/resource_context");
  return parseJsonResponse(response) as Promise<ResourceContextResponse>;
}

export async function selectResourceDate(date: string): Promise<ResourceContextResponse> {
  const response = await authFetch("/api/resource_context/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  return parseJsonResponse(response) as Promise<ResourceContextResponse>;
}
