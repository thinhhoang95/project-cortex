"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { loadWaypoints } from "@/lib/waypoints";
import { AIRSPACE_GEOJSON_PATH, FLIGHTS_CSV_PATH } from "@/lib/dataPaths";
import * as turf from "@turf/turf";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { Trajectory } from "@/lib/models";
import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map|null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const { t, date, weatherOverlay, tick, setRange, showFlightLineLabels, showCallsigns, showWaypoints, showTrafficVolumes, setFlights, setSelectedTrafficVolume, flLowerBound, flUpperBound, setFocusMode, setFocusFlightIds, showHotspots, hotspots, getActiveHotspots, flowPreviewFlightId, playing, focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);
  
  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);

  // init map
  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: createMapStyle(theme, 512),
      center: [3, 45],
      zoom: 4
    });
    mapRef.current = map;

    map.on("load", async () => {
      setBaseDataLoading(true);
      // Data
      const [sectors, tracks] = await Promise.all([
        loadSectors(AIRSPACE_GEOJSON_PATH),
        loadTrajectories(FLIGHTS_CSV_PATH)
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

      // Add hotspot layers for traffic volumes
      map.addLayer({
        id: "sector-hotspot",
        type: "fill",
        source: "sectors",
        paint: {
          "fill-color": "#ef4444",
          "fill-opacity": 0.1
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });
      
      map.addLayer({
        id: "sector-hotspot-outline",
        type: "line",
        source: "sectors",
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-opacity": 0.9
        },
        filter: ["==", ["get", "traffic_volume_id"], ""]
      });

      applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);

      // --- Flight lines (static geometry) ---
      const lineFC: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: tracks.map((tr: any) => {
          // Determine dominant direction based on first and last coordinates
          const firstCoord = tr.coords[0];
          const lastCoord = tr.coords[tr.coords.length - 1];
          const deltaLon = lastCoord[0] - firstCoord[0];
          const deltaLat = lastCoord[1] - firstCoord[1];
          
          // Determine which direction is dominant by comparing absolute changes
          const absLonChange = Math.abs(deltaLon);
          const absLatChange = Math.abs(deltaLat);
          
          let color = "#10b981"; // default green
          if (absLonChange > absLatChange) {
            // Longitude change is dominant
            color = deltaLon < 0 ? "#ec4899" : "#10b981"; // West: pink, East: green
          } else {
            // Latitude change is dominant
            color = deltaLat > 0 ? "#ec4899" : "#10b981"; // North: pink, South: green
          }
          
          return {
            type: "Feature",
            geometry: { type: "LineString", coordinates: tr.coords.map((c: any)=>[c[0], c[1]]) },
            properties: { 
              flightId: tr.flightId, 
              callSign: tr.callSign ?? tr.flightId,
              lineColor: color
            }
          };
        })
      };
      map.addSource("flight-lines", { type: "geojson", data: lineFC });
      map.addLayer({
        id: "flight-lines",
        type: "line",
        source: "flight-lines",
        paint: { 
          "line-color": ["get", "lineColor"], 
          "line-width": 1.0, 
          "line-opacity": 0.1 
        }
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
      // Apply initial visibility based on store defaults
      try {
        const { showFlightLineLabels } = useSimStore.getState();
        map.setPaintProperty("flight-line-labels", "text-opacity", showFlightLineLabels ? 1 : 0);
        map.setPaintProperty("flight-line-labels", "text-halo-width", showFlightLineLabels ? 2 : 0);
      } catch {}

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
      // Apply initial plane label visibility based on store defaults
      try {
        const { showCallsigns } = useSimStore.getState();
        map.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
        map.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
      } catch {}

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
            // Focus on this flight only
            setFocusMode(true);
            setFocusFlightIds(new Set([clickedFlight.flightId]));
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
            // Focus on this flight only
            setFocusMode(true);
            setFocusFlightIds(new Set([clickedFlight.flightId]));
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
            // Query the full sector feature to get flight level data
            const sectorFeatures = map.querySourceFeatures('sectors', {
              filter: ['==', 'traffic_volume_id', trafficVolumeId]
            });
            const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
            // Store only the typed properties for the selected TV data
            const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
            setSelectedTrafficVolume(trafficVolumeId, tvData);
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

      // Base airspace and flight data are loaded; hide the page-loading indicator
      setBaseDataLoading(false);

      // Fit to data (optional)
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x,y]: [number, number]) => b.extend([x,y])));
      if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });

      // Wait until the map is fully idle (all sources loaded) before the first render
      map.once("idle", () => {
        try {
          updatePlanePositions(mapRef.current);
        } catch (e) {
          console.error("Error during initial updatePlanePositions call:", e);
        }
      });
    });

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Control RAF loop based on playing; throttle to ~30 FPS
  useEffect(() => {
    if (!mapRef.current) return;
    if (playing) {
      lastTs.current = performance.now();
      lastUpdateRef.current = lastTs.current;
      const targetFrameMs = 1000 / 30;
      const loop = () => {
        const now = performance.now();
        const dt = now - lastTs.current;
        lastTs.current = now;
        const sinceUpdate = now - lastUpdateRef.current;
        if (sinceUpdate >= targetFrameMs) {
          tick(dt);
          updatePlanePositions(mapRef.current);
          lastUpdateRef.current = now;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = undefined; }
      // Render once when pausing to ensure view is up to date
      updatePlanePositions(mapRef.current);
    }
  }, [playing, tick]);

  // on t change from UI (drag), update plane positions immediately when paused
  useEffect(() => { if (!playing) updatePlanePositions(mapRef.current); }, [t, playing]);

  // When a single-flight preview is toggled via hover, update filters immediately
  useEffect(() => { updatePlanePositions(mapRef.current); }, [flowPreviewFlightId]);

  // Refresh filters on focus/visibility changes
  useEffect(() => { updatePlanePositions(mapRef.current); }, [focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume]);

  // Weather overlay integration (Surface Precipitation)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // If overlay is disabled, hide any existing precip layers
    if (weatherOverlay !== 'surface-precip') {
      hideSurfacePrecipLayer(map);
      return;
    }

    const targetHour = isoHourFrom(date, t);

    const apply = () => {
      try {
        ensureSurfacePrecipHour(map, targetHour);
      } catch (e) {
        // no-op
      }
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    // Fallback: wait for the next render tick where the style reports as loaded.
    // Using 'idle' is unreliable while the RAF loop is active (map never becomes idle).
    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      try { map.off('render', waitForReady); } catch {}
      if (!cancelled) apply();
    };

    map.on('render', waitForReady);
    return () => {
      cancelled = true;
      try { map.off('render', waitForReady); } catch {}
    };
  }, [weatherOverlay, t, date]);

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

  // on traffic volume visibility change, toggle sector layers once map is ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        applyTrafficVolumeVisibility(map, showTrafficVolumes);
      } catch (err) {
        console.error("Failed to update traffic volume visibility", err);
      }
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      try { map.off("render", waitForReady); } catch {}
      if (!cancelled) apply();
    };

    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try { map.off("render", waitForReady); } catch {}
    };
  }, [showTrafficVolumes]);

  // on showWaypoints change, toggle waypoint visibility via paint properties
  useEffect(() => {
    if (mapRef.current) {
      if (mapRef.current.getLayer("wp-points")) {
        mapRef.current.setPaintProperty("wp-points", "circle-opacity", showWaypoints ? [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0.6,
          8, 0.8,
          12, 0.9
        ] : 0);
      }
      if (mapRef.current.getLayer("wp-labels")) {
        mapRef.current.setPaintProperty("wp-labels", "text-opacity", showWaypoints ? [
          "interpolate",
          ["linear"],
          ["zoom"],
          6, 0.7,
          10, 0.9,
          14, 1
        ] : 0);
        mapRef.current.setPaintProperty("wp-labels", "text-halo-width", showWaypoints ? 2 : 0);
      }
    }
  }, [showWaypoints]);

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

  // Also refresh plane positions and line/icon filters when FL range changes
  useEffect(() => {
    updatePlanePositions(mapRef.current);
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

  // Update hotspot layers when hotspots change, FL range changes, or time changes
  useEffect(() => {
    if (mapRef.current) {
      // Get only the active hotspots for the current time
      const activeHotspots = getActiveHotspots();
      const hotspotTrafficVolumeIds = activeHotspots.map(h => h.traffic_volume_id);
      
      const hotspotFilter = hotspotTrafficVolumeIds.length > 0 
        ? [
            "all",
            ["in", ["get", "traffic_volume_id"], ["literal", hotspotTrafficVolumeIds]],
            [">=", ["get", "max_fl"], flLowerBound],
            ["<=", ["get", "min_fl"], flUpperBound]
          ]
        : ["==", ["get", "traffic_volume_id"], ""];

      if (mapRef.current.getLayer("sector-hotspot")) {
        mapRef.current.setFilter("sector-hotspot", hotspotFilter as any);
      }
      if (mapRef.current.getLayer("sector-hotspot-outline")) {
        mapRef.current.setFilter("sector-hotspot-outline", hotspotFilter as any);
      }
    }
  }, [showHotspots, hotspots, flLowerBound, flUpperBound, t, getActiveHotspots]);

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
      }
    };

    window.addEventListener('flight-search-select', handleFlightSearchSelect);
    return () => {
      window.removeEventListener('flight-search-select', handleFlightSearchSelect);
    };
  }, []);

  // Listen for traffic volume search selection events
  useEffect(() => {
    const handleTrafficVolumeSearchSelect = (event: any) => {
      const { trafficVolume, trafficVolumeId } = event.detail || {};
      const map = mapRef.current;
      if (!map) return;

      // If we only received an ID, try to retrieve the feature from the map source
      let tvId: string | null = null;
      let tvGeometry: any = null;

      if (trafficVolume && trafficVolume.properties?.traffic_volume_id) {
        tvId = trafficVolume.properties.traffic_volume_id;
        tvGeometry = trafficVolume.geometry;
      } else if (trafficVolumeId) {
        tvId = trafficVolumeId;
        // Query the sector feature by id
        const sectorFeatures = map.querySourceFeatures('sectors', {
          filter: ['==', 'traffic_volume_id', trafficVolumeId]
        });
        if (sectorFeatures.length > 0) {
          tvGeometry = sectorFeatures[0].geometry;
        }
      }

      if (!tvId) return;

      // Highlight the traffic volume (same as clicking on it)
      setHighlightedTrafficVolume(tvId);

      // If we have geometry, pan to its centroid
      if (tvGeometry && tvGeometry.type === 'Polygon') {
        const coords = (tvGeometry as any).coordinates[0];
        let centerLon = 0, centerLat = 0;
        for (const coord of coords) { centerLon += coord[0]; centerLat += coord[1]; }
        const center: [number, number] = [centerLon / coords.length, centerLat / coords.length];
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 7), duration: 1500 });
      }
    };

    window.addEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect);
    return () => {
      window.removeEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect);
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
          // Restore default view - show all trajectories
          setFocusMode(false);
          setFocusFlightIds(new Set());
        }}
      />
      
      <PageLoadingIndicator visible={baseDataLoading} />
      
      {/* <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 w-96">
        <div className="relative bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-4 py-3 shadow-lg flex items-center space-x-3">
          <input
            type="text"
            placeholder="Message Flow Assistant..."
            className="flex-1 bg-transparent text-white placeholder-gray-300 text-sm focus:outline-none"
          />
          <select className="bg-transparent text-white text-xs focus:outline-none border-l border-white/20 pl-3">
            <option value="openai-o4-mini" className="bg-slate-800 text-white">ramen-0821</option>
            <option value="gpt-5-mini" className="bg-slate-800 text-white">GPT-5 mini</option>
            <option value="claude-4-sonnet" className="bg-slate-800 text-white">Claude 4 Sonnet</option>
          </select>
          <button className="text-gray-300 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div> */}
    </>
  );
}

function applyTrafficVolumeVisibility(map: maplibregl.Map, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  const layerIds = [
    "sector-fill",
    "sector-outline",
    "sector-labels",
    "sector-highlight",
    "sector-highlight-outline",
    "sector-hover",
    "sector-hover-outline",
    "sector-hotspot",
    "sector-hotspot-outline",
  ];

  for (const layerId of layerIds) {
    if (!map.getLayer(layerId)) continue;
    try {
      map.setLayoutProperty(layerId, "visibility", visibility);
    } catch (err) {
      console.warn(`Unable to update visibility for layer ${layerId}`, err);
    }
  }
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

// Binary search for current segment index such that times[i] <= t <= times[i+1]
function segmentIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 2; // compare against i+1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tMid = times[mid];
    const tNext = times[mid + 1];
    if (t < tMid) hi = mid - 1; else if (t > tNext) lo = mid + 1; else return mid;
  }
  // clamp
  if (times.length <= 1) return 0;
  return Math.max(0, Math.min(times.length - 2, lo));
}

// Fast bearing calculation (deg)
function fastBearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x) * 180 / Math.PI;
  return (theta + 360) % 360;
}

// Interpolate each trajectory at current sim time and update the "planes" source
function updatePlanePositions(map: maplibregl.Map | null) {
  if (!map){
    return;
  }
  if (!map.isStyleLoaded()){
    // Defer this update until the map is idle to avoid dropping filter/paint changes
    try {
      map.once("idle", () => {
        try { updatePlanePositions(map); } catch (e) { console.error("Deferred updatePlanePositions error:", e); }
      });
    } catch {}
    return;
  }


  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as any[] | undefined;
  if (!tracks) return;

  const planesFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  const activeFlightIds: string[] = [];
  const insideRangeActiveSet = new Set<string>();

  for (const tr of tracks) {
    if (sim.t < tr.t0 || sim.t > tr.t1) continue;

    // find segment i such that times[i] <= t <= times[i+1]
    const idx = segmentIndex(tr.times, sim.t);
    const t0 = tr.times[idx], t1 = tr.times[idx+1];
    const p0 = tr.coords[idx], p1 = tr.coords[idx+1];
    const u = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0]-p0[0]) * u;
    const lat = p0[1] + (p1[1]-p0[1]) * u;
    const alt = p0[2] !== undefined && p1[2] !== undefined ? p0[2] + (p1[2] - p0[2]) * u : 0;

    // bearing for icon rotation
    const bearing = fastBearing(p0[0], p0[1], p1[0], p1[1]);

    // Format altitude as flight level (divide by 100 and prefix with FL)
    const flightLevel = Math.round(alt / 100);
    const altitudeLabel = `FL${flightLevel.toString().padStart(3, '0')}`;

    // Filter by current flight level range
    if (!(flightLevel >= sim.flLowerBound && flightLevel <= sim.flUpperBound)) {
      continue;
    }

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
    insideRangeActiveSet.add(String(tr.flightId));
  }

  const src = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(planesFC);

  // Filter flight line + label layers
  // If focus mode is enabled, show only focus-filtered flights; otherwise show active flights at current time
  let lineIdsToShow: string[];
  if (sim.flowPreviewFlightId) {
    const pid = String(sim.flowPreviewFlightId);
    // Only show if currently active and within FL range
    lineIdsToShow = insideRangeActiveSet.has(pid) ? [pid] : [];
  } else if (sim.focusMode) {
    lineIdsToShow = Array.from(sim.focusFlightIds)
      .map(String)
      .filter((id) => insideRangeActiveSet.has(id));
  } else {
    lineIdsToShow = Array.from(insideRangeActiveSet);
  }

  let filterExpr: any;
  if (lineIdsToShow.length === 0) {
    // Always-false filter when nothing should be shown
    filterExpr = ["==", 1, 0];
  } else {
    // Robust membership check for a dynamic list of ids
    filterExpr = [
      "in",
      ["to-string", ["get", "flightId"]],
      ["literal", lineIdsToShow]
    ];
  }

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpr as any);
    if (map.getLayer("flight-line-labels")) map.setFilter("flight-line-labels", filterExpr as any);
    if (map.getLayer("plane-icons")) map.setFilter("plane-icons", filterExpr as any);
    const inFocusContext = sim.focusMode || !!sim.selectedTrafficVolume || !!sim.flowPreviewFlightId;
    const lineOpacity = sim.flowPreviewFlightId ? 0.8 : ((sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.1) : 0);
    const prevOpacity = (map as any).__prevLineOpacity;
    if (prevOpacity !== lineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
      (map as any).__prevLineOpacity = lineOpacity;
    }
  }
}

