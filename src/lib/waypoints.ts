export interface Waypoint {
  name: string;
  latitude: number;
  longitude: number;
  extra?: string;
  importance?: number; // 0-3, higher = more important
}

// Load waypoints from a simple CSV-like text file with lines:
// NAME,LAT,LON[,EXTRA]
// Returns a GeoJSON FeatureCollection of Point features with importance-based filtering.
export async function loadWaypoints(
  url: string,
  bbox?: [number, number, number, number]
): Promise<GeoJSON.FeatureCollection> {
  const text = await fetch(url).then(r => r.text());
  const lines = text.split(/\r?\n/);

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const name = parts[0];
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (bbox) {
      const [minX, minY, maxX, maxY] = bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    }

    // Assign importance based on waypoint characteristics
    // Higher importance for: shorter names (major waypoints), specific patterns
    const importance = calculateWaypointImportance(name);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { name, importance }
    });
  }

  return { type: "FeatureCollection", features };
}

// Calculate waypoint importance (0-3, higher = more important)
// Uses deterministic random sampling based on waypoint name hash
function calculateWaypointImportance(name: string): number {
  // Create a simple hash from the waypoint name for deterministic randomness
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Use the hash to assign importance levels with distribution:
  // ~2% importance 3 (most important) - very few at coarse zoom
  // ~8% importance 2 
  // ~20% importance 1
  // ~70% importance 0 (least important)
  const absHash = Math.abs(hash);
  const normalized = absHash % 100;
  
  if (normalized < 2) return 3;       // 2% get highest importance
  if (normalized < 10) return 2;      // 8% get high importance  
  if (normalized < 30) return 1;      // 20% get medium importance
  return 0;                           // 70% get lowest importance
}


