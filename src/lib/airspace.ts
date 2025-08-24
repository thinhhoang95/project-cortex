export async function loadSectors(url: string): Promise<GeoJSON.FeatureCollection> {
  return fetch(url).then(r => r.json());
}