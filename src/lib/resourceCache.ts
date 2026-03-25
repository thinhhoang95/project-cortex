import { clearAppCache } from "@/lib/cache";
import { clearTrafficVolumeCache } from "@/lib/trafficVolumes";
import { clearTvCapacityRangesCache } from "@/lib/tvCapacityRanges";

export async function clearResourceCaches(): Promise<void> {
  await clearAppCache();
  clearTrafficVolumeCache();
  clearTvCapacityRangesCache();
}
