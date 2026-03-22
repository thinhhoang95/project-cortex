"use client";

import { fetchResourceStateBundle } from "@/lib/resourceContextClient";
import {
  buildResourceStateSyncPayload,
  type ResourceStateSyncPayload,
  validateResourceStateBundleDate,
} from "@/lib/resourceStates";

export class ResourceDateOutOfSyncError extends Error {
  constructor(resourceDate: string | null) {
    super(
      resourceDate
        ? `Active resource date changed to ${resourceDate}`
        : "Active resource date is out of sync",
    );
    this.name = "ResourceDateOutOfSyncError";
  }
}

type RefreshResourceStateFromServerParams = {
  expectedResourceDate: string | null | undefined;
  onOutOfSync: (resourceDate: string | null) => void;
  syncResourceState: (payload: ResourceStateSyncPayload) => void;
};

export async function refreshResourceStateFromServer({
  expectedResourceDate,
  onOutOfSync,
  syncResourceState,
}: RefreshResourceStateFromServerParams): Promise<void> {
  const { context, history } = await fetchResourceStateBundle();
  const bundleDateValidation = validateResourceStateBundleDate(
    expectedResourceDate,
    context,
    history,
  );

  if (!bundleDateValidation.matches) {
    onOutOfSync(bundleDateValidation.bundleDate);
    throw new ResourceDateOutOfSyncError(bundleDateValidation.bundleDate);
  }

  syncResourceState(buildResourceStateSyncPayload(context, history));
}
