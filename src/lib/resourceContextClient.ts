"use client";

import { authFetch } from "@/lib/auth";
import type { ResourceContextResponse } from "@/lib/resourceDates";
import type { ResourceStateHistoryResponse } from "@/lib/resourceStates";

async function parseJsonResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload as Record<string, unknown>;
    const message =
      record?.detail ||
      record?.error ||
      record?.message ||
      `Request failed (${response.status})`;
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

export async function fetchResourceStateHistory(): Promise<ResourceStateHistoryResponse> {
  const response = await authFetch("/api/resource_state_history");
  return parseJsonResponse(response) as Promise<ResourceStateHistoryResponse>;
}

export async function selectResourceState(stateId: string): Promise<unknown> {
  const response = await authFetch("/api/resource_state/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state_id: stateId }),
  });
  return parseJsonResponse(response);
}

export async function fetchResourceStateBundle(): Promise<{
  context: ResourceContextResponse;
  history: ResourceStateHistoryResponse;
}> {
  const [context, history] = await Promise.all([fetchResourceContext(), fetchResourceStateHistory()]);
  return { context, history };
}
