"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { loadWaypoints } from "@/lib/waypoints";
import * as turf from "@turf/turf";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";
import FlightDetailsPopup from "@/components/FlightDetailsPopup";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map|null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const { t, tick, setRange, showFlightLineLabels, showCallsigns, setFlights, setSelectedTrafficVolume, flLowerBound, flUpperBound } = useSimStore();
  
  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);

  // init map
  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          "raster-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          },
          "countries": {
            type: "vector",
            url: "https://demotiles.maplibre.org/tiles/tiles.json"
          }
        },
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#1e293b" }
          },
          {
            id: "raster-layer",
            type: "raster",
            source: "raster-tiles",
            paint: {
              "raster-opacity": 0.4,
              "raster-brightness-min": 0,
              "raster-brightness-max": 0.3,
              "raster-contrast": 0.3,
              "raster-saturation": -0.7
            }
          },
          {
            id: "countries-fill",
            type: "fill",
            source: "countries",
            "source-layer": "countries",
            paint: {
              "fill-color": "#334155",
              "fill-opacity": 0.3
            }
          },
          {
            id: "countries-border",
            type: "line",
            source: "countries",
            "source-layer": "countries",
            paint: {
              "line-color": "#64748b",
              "line-width": 1.5,
              "line-opacity": 0.8
            }
          }
        ]
      },
      center: [3, 45],
      zoom: 4
    });
    mapRef.current = map;

    map.on("load", async () => {
      // Data
      const [sectors, tracks] = await Promise.all([
        loadSectors("/data/airspace.geojson"),
        loadTrajectories("/data/flights_20230801.csv")
      ]);

      // Store flights in global store and compute global time range
      setFlights(tracks);
      const minT = Math.min(...tracks.map((track: any) => track.t0));
      const maxT = Math.max(...tracks.map((track: any) => track.t1));
      setRange([minT, maxT], minT);

      // --- Airspace polygons + labels ---
      map.addSource("sectors", { type: "geojson", data: sectors });

      map.addLayer({
        id: "sector-fill",
        type: "fill",
        source: "sectors",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.01 }
      });
      map.addLayer({
        id: "sector-outline",
        type: "line",
        source: "sectors",
        paint: { "line-color": "#3b82f6", "line-width": 1.5, "line-opacity": 0.05 }
      });
      // center labels via centroid points
      const centroids = {
        type: "FeatureCollection",
        features: (sectors.features as any[]).map((f) => {
          const c = turf.centroid(f as any);
          c.properties = { ...f.properties, label: f.properties?.traffic_volume_id || "" };
          return c;
        })
      } as GeoJSON.FeatureCollection;
      map.addSource("sector-centroids", { type: "geojson", data: centroids });
      map.addLayer({
        id: "sector-labels",
        type: "symbol",
        source: "sector-centroids",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"]
        },
        paint: { "text-color": "#60a5fa", "text-halo-color": "#0f172a", "text-halo-width": 2 }
      });

      // Add highlight layer for selected traffic volume
      map.addLayer({
        id: "sector-highlight",
        type: "fill",
        source: "sectors",
        paint: {
          "fill-color": "#fbbf24",
          "fill-opacity": 0.3
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });
      
      map.addLayer({
        id: "sector-highlight-outline",
        type: "line",
        source: "sectors",
        paint: {
          "line-color": "#fbbf24",
          "line-width": 3,
          "line-opacity": 0.8
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });

      // Add hover layer for traffic volumes
      map.addLayer({
        id: "sector-hover",
        type: "fill",
        source: "sectors",
        paint: {
          "fill-color": "#06b6d4",
          "fill-opacity": 0.2
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });
      
      map.addLayer({
        id: "sector-hover-outline",
        type: "line",
        source: "sectors",
        paint: {
          "line-color": "#06b6d4",
          "line-width": 2,
          "line-opacity": 0.6
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });

      // --- Flight lines (static geometry) ---
      const lineFC: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: tracks.map((tr: any) => ({
          type: "Feature",
          geometry: { type: "LineString", coordinates: tr.coords.map((c: any)=>[c[0], c[1]]) },
          properties: { flightId: tr.flightId, callSign: tr.callSign ?? tr.flightId }
        }))
      };
      map.addSource("flight-lines", { type: "geojson", data: lineFC });
      map.addLayer({
        id: "flight-lines",
        type: "line",
        source: "flight-lines",
        paint: { "line-color": "#10b981", "line-width": 1.0, "line-opacity": 0.1 }
      });
      // labels along the routes
      map.addLayer({
        id: "flight-line-labels",
        type: "symbol",
        source: "flight-lines",
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "callSign"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"]
        },
        paint: { "text-color": "#34d399", "text-halo-color": "#0f172a", "text-halo-width": 2 }
      });

      // --- Waypoints (zoom-based filtering for better UX) ---
      // Load only waypoints within sector bbox with small margin
      // Western Europe bounding box
      const [minX, minY, maxX, maxY] = [-10, 35, 20, 60];
      const margin = 2; // degrees
      const filteredWaypoints = await loadWaypoints("/data/Waypoints.txt", [
        minX - margin,
        minY - margin,
        maxX + margin,
        maxY + margin
      ]);

      map.addSource("waypoints", {
        type: "geojson",
        data: filteredWaypoints
      });

      // Single importance threshold expression reused by points and labels
      const importanceThresholdExpr: any = [
        "interpolate", ["linear"], ["zoom"],
        3, 3,    // z<=5: only most important
        5, 3,
        7, 2,    // z>=7: importance 2+
        9, 1,    // z>=9: importance 1+
        11, 0    // z>=11: all
      ];

      // Waypoint points with importance-based zoom filtering
      map.addLayer({
        id: "wp-points",
        type: "circle",
        source: "waypoints",
        filter: [">=", ["get", "importance"], importanceThresholdExpr],
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 3, 12, 4, 16, 6],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4, 0.6,
            8, 0.8,
            12, 0.9
          ],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1
        }
      });

      // Waypoint labels with importance-based zoom filtering
      map.addLayer({
        id: "wp-labels",
        type: "symbol",
        source: "waypoints",
        minzoom: 6,
        filter: [">=", ["get", "importance"], importanceThresholdExpr],
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 12, 11, 16, 13],
          "text-offset": [0, -1.2],
          "text-anchor": "bottom",
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": false,
          "text-ignore-placement": false
        },
        paint: { 
          "text-color": "#fbbf24", 
          "text-halo-color": "#0f172a", 
          "text-halo-width": 2,
          "text-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 0.7,
            10, 0.9,
            14, 1
          ]
        }
      });

      // --- Dynamic plane positions (updated each frame) ---
      map.addImage("plane", await loadImage(map, "/plane.svg"), { pixelRatio: 2 });
      map.addSource("planes", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "plane-icons",
        type: "symbol",
        source: "planes",
        layout: {
          "icon-image": "plane",
          "icon-size": 0.6,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "text-field": ["get", "labelText"],
          "text-offset": [0, 1],
          "text-size": 11
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 2
        }
      });

      // Save trajectories on map for the animation step
      (map as any).__trajectories = tracks;

      // Add click handlers for flight lines
      map.on('click', 'flight-lines', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          const clickedFlight = tracks.find((t: any) => t.flightId === flightId);
          
          if (clickedFlight) {
            setSelectedFlight(clickedFlight);
            setPopupPosition({ x: e.point.x, y: e.point.y });
          }
        }
      });

      // Add click handlers for plane icons
      map.on('click', 'plane-icons', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          const clickedFlight = tracks.find((t: any) => t.flightId === flightId);
          
          if (clickedFlight) {
            setSelectedFlight(clickedFlight);
            setPopupPosition({ x: e.point.x, y: e.point.y });
          }
        }
      });

      // Change cursor to pointer when hovering over flight lines
      map.on('mouseenter', 'flight-lines', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      
      map.on('mouseleave', 'flight-lines', () => {
        map.getCanvas().style.cursor = '';
      });

      // Change cursor to pointer when hovering over plane icons
      map.on('mouseenter', 'plane-icons', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      
      map.on('mouseleave', 'plane-icons', () => {
        map.getCanvas().style.cursor = '';
      });

      // Add click handlers for sector labels (traffic volumes)
      map.on('click', 'sector-labels', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const trafficVolumeId = feature.properties?.label;
          if (trafficVolumeId) {
            setSelectedTrafficVolume(trafficVolumeId);
            // Toggle highlighting - if already highlighted, turn off; otherwise turn on
            setHighlightedTrafficVolume(prev => 
              prev === trafficVolumeId ? null : trafficVolumeId
            );
          }
        }
      });

      // Change cursor to pointer when hovering over sector labels
      map.on('mouseenter', 'sector-labels', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const trafficVolumeId = feature.properties?.label;
          if (trafficVolumeId) {
            setHoveredTrafficVolume(trafficVolumeId);
          }
        }
      });
      
      map.on('mouseleave', 'sector-labels', () => {
        map.getCanvas().style.cursor = '';
        setHoveredTrafficVolume(null);
      });

      // Fit to data (optional)
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x,y]: [number, number]) => b.extend([x,y])));
      if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });
    });

    // RAF loop (time progression + plane updates)
    const loop = () => {
      const now = performance.now();
      const dt = now - lastTs.current;
      lastTs.current = now;
      tick(dt);
      updatePlanePositions(mapRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // on t change from UI (drag), update plane positions immediately
  useEffect(() => { updatePlanePositions(mapRef.current); }, [t]);

  // on showFlightLineLabels change, update layer visibility
  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer("flight-line-labels")) {
      // Prefer paint properties over layout visibility to avoid side effects on sibling layers
      mapRef.current.setPaintProperty("flight-line-labels", "text-opacity", showFlightLineLabels ? 1 : 0);
      mapRef.current.setPaintProperty("flight-line-labels", "text-halo-width", showFlightLineLabels ? 2 : 0);
    }
  }, [showFlightLineLabels]);

  // on showCallsigns change, toggle plane text visibility via paint properties
  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer("plane-icons")) {
      mapRef.current.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
      mapRef.current.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
    }
  }, [showCallsigns]);

  // on FL range change, filter traffic volumes based on vertical intersection
  useEffect(() => {
    if (mapRef.current && mapRef.current.getSource("sectors")) {
      // Create filter expression to show only sectors that intersect with FL range
      // A sector intersects if: max_fl >= flLowerBound AND min_fl <= flUpperBound
      const filterExpression: any = [
        "all",
        [">=", ["get", "max_fl"], flLowerBound],
        ["<=", ["get", "min_fl"], flUpperBound]
      ];

      if (mapRef.current.getLayer("sector-fill")) {
        mapRef.current.setFilter("sector-fill", filterExpression);
      }
      if (mapRef.current.getLayer("sector-outline")) {
        mapRef.current.setFilter("sector-outline", filterExpression);
      }
      if (mapRef.current.getLayer("sector-labels")) {
        mapRef.current.setFilter("sector-labels", filterExpression);
      }
    }
  }, [flLowerBound, flUpperBound]);

  // Update highlight layer when highlighted traffic volume changes
  useEffect(() => {
    if (mapRef.current) {
      const highlightFilter = highlightedTrafficVolume 
        ? ["==", ["get", "traffic_volume_id"], highlightedTrafficVolume]
        : ["==", ["get", "traffic_volume_id"], ""];

      if (mapRef.current.getLayer("sector-highlight")) {
        mapRef.current.setFilter("sector-highlight", highlightFilter as any);
      }
      if (mapRef.current.getLayer("sector-highlight-outline")) {
        mapRef.current.setFilter("sector-highlight-outline", highlightFilter as any);
      }
    }
  }, [highlightedTrafficVolume]);

  // Update hover layer when hovered traffic volume changes
  useEffect(() => {
    if (mapRef.current) {
      const hoverFilter = hoveredTrafficVolume 
        ? ["==", ["get", "traffic_volume_id"], hoveredTrafficVolume]
        : ["==", ["get", "traffic_volume_id"], ""];

      if (mapRef.current.getLayer("sector-hover")) {
        mapRef.current.setFilter("sector-hover", hoverFilter as any);
      }
      if (mapRef.current.getLayer("sector-hover-outline")) {
        mapRef.current.setFilter("sector-hover-outline", hoverFilter as any);
      }
    }
  }, [hoveredTrafficVolume]);

  // Listen for dialog close events to clear highlighting
  useEffect(() => {
    const handleClearHighlight = () => {
      setHighlightedTrafficVolume(null);
    };

    window.addEventListener('clearTrafficVolumeHighlight', handleClearHighlight);
    return () => {
      window.removeEventListener('clearTrafficVolumeHighlight', handleClearHighlight);
    };
  }, []);

  // Listen for flight search selection events
  useEffect(() => {
    const handleFlightSearchSelect = (event: any) => {
      const { flight } = event.detail;
      const map = mapRef.current;
      if (!map || !flight) return;

      // Get current flight position at time t
      const { t } = useSimStore.getState();
      const currentTime = Math.max(t, flight.t0); // Use flight start time if current time is before it
      
      // Find the flight position at current time
      let position: [number, number] | null = null;
      for (let i = 0; i < flight.times.length - 1; i++) {
        if (currentTime >= flight.times[i] && currentTime <= flight.times[i + 1]) {
          // Interpolate between the two points
          const t1 = flight.times[i];
          const t2 = flight.times[i + 1];
          const ratio = (currentTime - t1) / (t2 - t1);
          
          const [lon1, lat1] = flight.coords[i];
          const [lon2, lat2] = flight.coords[i + 1];
          
          position = [
            lon1 + (lon2 - lon1) * ratio,
            lat1 + (lat2 - lat1) * ratio
          ];
          break;
        }
      }
      
      // If no position found (flight not active at this time), use the start position
      if (!position && flight.coords.length > 0) {
        position = [flight.coords[0][0], flight.coords[0][1]];
      }
      
      if (position) {
        // Pan to flight location
        map.flyTo({
          center: position,
          zoom: Math.max(map.getZoom(), 8),
          duration: 1500
        });
        
        // Show flight details popup at map center
        setTimeout(() => {
          const centerPoint = map.project(position!);
          setSelectedFlight(flight);
          setPopupPosition({ x: centerPoint.x, y: centerPoint.y });
        }, 1500); // Wait for pan to complete
      }
    };

    window.addEventListener('flight-search-select', handleFlightSearchSelect);
    return () => {
      window.removeEventListener('flight-search-select', handleFlightSearchSelect);
    };
  }, []);

  return (
    <>
      <div id="map" className="absolute inset-0" />
      <FlightDetailsPopup 
        flight={selectedFlight}
        position={popupPosition}
        onClose={() => {
          setSelectedFlight(null);
          setPopupPosition(null);
        }}
      />
    </>
  );
}

function emptyFC(): GeoJSON.FeatureCollection { return { type: "FeatureCollection", features: [] }; }

async function loadImage(map: maplibregl.Map, url: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

// Interpolate each trajectory at current sim time and update the "planes" source
function updatePlanePositions(map: maplibregl.Map | null) {
  if (!map || !map.isStyleLoaded()) return;
  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as any[] | undefined;
  if (!tracks) return;

  const planesFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  const activeFlightIds: string[] = [];

  for (const tr of tracks) {
    if (sim.t < tr.t0 || sim.t > tr.t1) continue;

    // find segment i such that times[i] <= t <= times[i+1]
    const idx = Math.max(0, tr.times.findIndex((tt: number, i: number) => sim.t >= tt && sim.t <= tr.times[i+1]));
    const t0 = tr.times[idx], t1 = tr.times[idx+1];
    const p0 = tr.coords[idx], p1 = tr.coords[idx+1];
    const u = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0]-p0[0]) * u;
    const lat = p0[1] + (p1[1]-p0[1]) * u;
    const alt = p0[2] !== undefined && p1[2] !== undefined ? p0[2] + (p1[2] - p0[2]) * u : 0;

    // bearing for icon rotation
    const bearing = turf.bearing([p0[0], p0[1]], [p1[0], p1[1]]);

    // Format altitude as flight level (divide by 100 and prefix with FL)
    const flightLevel = Math.round(alt / 100);
    const altitudeLabel = `FL${flightLevel.toString().padStart(3, '0')}`;

    planesFC.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { 
        flightId: tr.flightId, 
        callSign: tr.callSign ?? tr.flightId, 
        bearing,
        altitude: altitudeLabel,
        labelText: `${tr.callSign ?? tr.flightId} · ${altitudeLabel}`
      }
    });

    activeFlightIds.push(tr.flightId);
  }

  const src = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(planesFC);

  // Filter flight line + label layers
  // If focus mode is enabled, show only focus-filtered flights; otherwise show active flights at current time
  const lineIdsToShow: string[] = (sim.focusMode ? Array.from(sim.focusFlightIds) : activeFlightIds).map(String);

  const filterExpr: any = [
    "match",
    ["to-string", ["get", "flightId"]],
    lineIdsToShow,
    true,
    false
  ];

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpr as any);
    map.setPaintProperty("flight-lines", "line-opacity", sim.focusMode ? 0.8 : 0.1);
  }
  if (map.getLayer("flight-line-labels")) {
    map.setFilter("flight-line-labels", filterExpr as any);
  }
  if (map.getLayer("plane-icons")) {
    map.setFilter("plane-icons", filterExpr as any);
  }
}