"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { loadWaypoints } from "@/lib/waypoints";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { buildTrajectoryLineFeatureCollection } from "@/lib/trajectoryRender";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeHighlight,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "@/lib/trafficVolumeLayers";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const { t, resourceDate, weatherOverlay, tick, flights, showFlightLineLabels, showCallsigns, showWaypoints, showTrafficVolumes, setBaselineFlights, flLowerBound, flUpperBound, showHotspots, hotspots, getActiveHotspots, flowPreviewFlightId, playing, focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume, setSelectedTrafficVolume, setSelectedFlightForAnalysis, selectedFlightForAnalysis, alternativeRoutes, isAlternativeRoutesPanelOpen, hoveredAlternativeRoute } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);
  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );

  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);

  // init map
  useEffect(() => {
    if (!resourcePaths) return;

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
        loadSectors(resourcePaths.airspaceGeojson),
        loadTrajectories(resourcePaths.flightsCsv)
      ]);

      const activeTracks = setBaselineFlights(tracks);

      // --- Airspace polygons + labels ---
      addTrafficVolumeSources(map, sectors);
      addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });

      applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);

      // --- Flight lines (static geometry) ---
      const lineFC = buildTrajectoryLineFeatureCollection(activeTracks);
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
      } catch { }

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
      } catch { }

      // Save trajectories on map for the animation step
      (map as any).__trajectories = activeTracks;

      const selectTrafficVolume = (trafficVolumeId: string) => {
        const sectorFeatures = map.querySourceFeatures('sectors', {
          filter: ['==', 'traffic_volume_id', trafficVolumeId]
        });
        const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
        const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
        setSelectedTrafficVolume(trafficVolumeId, tvData);
        setHighlightedTrafficVolume(prev => (prev === trafficVolumeId ? null : trafficVolumeId));
      };

      const getTrafficVolumeIdFromEvent = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features && e.features.length > 0 ? e.features[0] : null;
        const rawId = feature?.properties?.traffic_volume_id ?? feature?.properties?.label;
        return rawId != null ? String(rawId) : null;
      };

      const handleTrafficVolumeClick = (e: maplibregl.MapLayerMouseEvent) => {
        const trafficVolumeId = getTrafficVolumeIdFromEvent(e);
        if (trafficVolumeId) selectTrafficVolume(trafficVolumeId);
      };

      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);

      map.on('click', 'plane-icons', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          if (flightId != null) {
            setSelectedFlightForAnalysis(String(flightId));
          }
        }
      });

      const handleTrafficVolumeHover = () => {
        map.getCanvas().style.cursor = 'pointer';
      };

      const handleTrafficVolumeHoverExit = () => {
        map.getCanvas().style.cursor = '';
      };

      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);

      map.on('mouseenter', 'plane-icons', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'plane-icons', () => {
        map.getCanvas().style.cursor = '';
      });

      // Base airspace and flight data are loaded; hide the page-loading indicator
      setBaseDataLoading(false);

      // Fit to data (optional)
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x, y]: [number, number]) => b.extend([x, y])));
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
  }, [resourcePaths, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("flight-lines") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(buildTrajectoryLineFeatureCollection(flights));
    (map as any).__trajectories = flights;
    updatePlanePositions(map);
  }, [flights]);

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

  // Refresh flight symbols/lines immediately when altitude range changes
  useEffect(() => { updatePlanePositions(mapRef.current); }, [flLowerBound, flUpperBound]);

  // Weather overlay integration (Surface Precipitation)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // If overlay is disabled, hide any existing precip layers
    if (weatherOverlay !== 'surface-precip') {
      hideSurfacePrecipLayer(map);
      return;
    }

    const targetHour = isoHourFrom(resourceDate ?? "1970-01-01", t);

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
      try { map.off('render', waitForReady); } catch { }
      if (!cancelled) apply();
    };

    map.on('render', waitForReady);
    return () => {
      cancelled = true;
      try { map.off('render', waitForReady); } catch { }
    };
  }, [resourceDate, t, weatherOverlay]);

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
      try { map.off("render", waitForReady); } catch { }
      if (!cancelled) apply();
    };

    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try { map.off("render", waitForReady); } catch { }
    };
  }, [showTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlight(map, highlightedTrafficVolume);
  }, [highlightedTrafficVolume]);

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



  // Render alternative route overlays when panel is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "alternative-routes";
    const lineLayerId = "alternative-routes-lines";

    const cleanup = () => {
      if (map.getLayer(lineLayerId)) {
        map.removeLayer(lineLayerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    };

    if (!isAlternativeRoutesPanelOpen || !alternativeRoutes || !selectedFlightForAnalysis) {
      cleanup();
      return;
    }

    const buildGeoJson = () => {
      const features: GeoJSON.Feature[] = [];

      Object.entries(alternativeRoutes).forEach(([routeStr, segments]) => {
        // If a route is hovered, only show that one
        if (hoveredAlternativeRoute && routeStr !== hoveredAlternativeRoute) {
          return;
        }

        if (!segments || segments.length === 0) {
          return;
        }

        const sortedSegments = [...segments].sort(
          (a, b) => a.time_begin_segment - b.time_begin_segment
        );
        const coords: [number, number][] = [];

        sortedSegments.forEach((segment, idx) => {
          if (idx === 0) {
            coords.push([segment.longitude_begin, segment.latitude_begin]);
          }
          coords.push([segment.longitude_end, segment.latitude_end]);
        });

        if (coords.length < 2) return;

        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            route: routeStr,
            isHovered: hoveredAlternativeRoute === routeStr,
          },
        } as GeoJSON.Feature);
      });

      return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
    };

    const applyVisualization = () => {
      const geoJsonData = buildGeoJson();
      if (!geoJsonData) {
        cleanup();
        return;
      }

      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geoJsonData as any);
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data: geoJsonData as any,
        });

        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": [
              "case",
              ["boolean", ["get", "isHovered"], false],
              "#3b82f6",
              "#fbbf24",
            ],
            "line-width": [
              "case",
              ["boolean", ["get", "isHovered"], false],
              4,
              2,
            ],
            "line-opacity": 0.9,
            "line-dasharray": [2, 2],
          },
        });
      }

      if (map.getLayer("plane-icons")) {
        map.moveLayer(lineLayerId, "plane-icons");
      }
    };

    if (map.isStyleLoaded()) {
      applyVisualization();
      return cleanup;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      map.off("styledata", waitForReady);
      if (!cancelled) {
        applyVisualization();
      }
    };

    map.on("styledata", waitForReady);
    return () => {
      cancelled = true;
      map.off("styledata", waitForReady);
      cleanup();
    };
  }, [alternativeRoutes, hoveredAlternativeRoute, isAlternativeRoutesPanelOpen, selectedFlightForAnalysis]);

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

      const center = tvGeometry
        ? getTrafficVolumeCenter(tvGeometry)
        : getTrafficVolumeCenterFromMap(map, tvId);
      if (center) {
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
  if (!map) {
    return;
  }
  if (!map.isStyleLoaded()) {
    // Defer this update until the map is idle to avoid dropping filter/paint changes
    try {
      map.once("idle", () => {
        try { updatePlanePositions(map); } catch (e) { console.error("Deferred updatePlanePositions error:", e); }
      });
    } catch { }
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
    const t0 = tr.times[idx], t1 = tr.times[idx + 1];
    const p0 = tr.coords[idx], p1 = tr.coords[idx + 1];
    const u = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0] - p0[0]) * u;
    const lat = p0[1] + (p1[1] - p0[1]) * u;
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
    // In focus mode, preserve full trajectories for qualifying flights but gate visibility by current activity + FL.
    lineIdsToShow = Array.from(sim.focusFlightIds).map(String).filter((id) => insideRangeActiveSet.has(id));
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
