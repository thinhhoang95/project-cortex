import { fetchCached } from "./cache";

export async function loadSectors(url: string): Promise<GeoJSON.FeatureCollection> {
  const resp = await fetchCached(url);
  return resp.json();
}
