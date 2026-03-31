"use client";

import maplibregl, { type LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";

import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { loadSectors } from "@/lib/airspace";
import {
  getAirspaceDisplayFilter,
  getHourBin,
  getMinuteOfDay,
  normalizeCollapsedSectors,
} from "@/lib/airspaceDisplay";
import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";
import type { ComplexityOverlayCollections } from "@/lib/csComplexity";
import {
  clearComplexityTraceLayers,
  syncComplexityTraceLayers,
} from "@/lib/csComplexityTraceLayer";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { deriveVisibleFlightLineIds } from "@/lib/flightCatcherPolicy";
import { setFlightLineLabelFilters } from "@/lib/flightLineLabels";
import { syncFlightLevelLabelLayer } from "@/lib/flightLineLabelLayer";
import { loadTrajectories } from "@/lib/flights";
import { getFlightLineVisibilitySnapshot } from "@/lib/flightVisibility";
import { createMapStyle } from "@/lib/mapStyle";
import type { SectorFeatureProps, Trajectory } from "@/lib/models";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeHighlight,
  applyTrafficVolumeHover,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "@/lib/trafficVolumeLayers";
import { buildTrajectoryLineFeatureCollection } from "@/lib/trajectoryRender";
import { loadWaypoints } from "@/lib/waypoints";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";

type ComplexityCanvasProps = {
  overlay: ComplexityOverlayCollections;
};

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

async function loadImage(map: maplibregl.Map, url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function segmentIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tMid = times[mid];
    const tNext = times[mid + 1];
    if (t < tMid) hi = mid - 1;
    else if (t > tNext) lo = mid + 1;
    else return mid;
  }
  if (times.length <= 1) return 0;
  return Math.max(0, Math.min(times.length - 2, lo));
}

function fastBearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRadians = Math.PI / 180;
  const phi1 = lat1 * toRadians;
  const phi2 = lat2 * toRadians;
  const deltaLambda = (lon2 - lon1) * toRadians;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = (Math.atan2(y, x) * 180) / Math.PI;
  return (theta + 360) % 360;
}

function updatePlanePositions(map: maplibregl.Map | null) {
  if (!map) return;
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        updatePlanePositions(map);
      });
    } catch {
      // no-op
    }
    return;
  }

  const sim = useSimStore.getState();
  const tracks = (map as maplibregl.Map & { __trajectories?: Trajectory[] }).__trajectories;
  if (!tracks) return;

  const planesCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  for (const trajectory of tracks) {
    if (sim.t < trajectory.t0 || sim.t > trajectory.t1) continue;
    if (!Array.isArray(trajectory.times) || trajectory.times.length < 2) continue;
    if (!Array.isArray(trajectory.coords) || trajectory.coords.length < 2) continue;

    const index = segmentIndex(trajectory.times, sim.t);
    const t0 = trajectory.times[index];
    const t1 = trajectory.times[index + 1];
    const p0 = trajectory.coords[index];
    const p1 = trajectory.coords[index + 1];
    const ratio = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0] - p0[0]) * ratio;
    const lat = p0[1] + (p1[1] - p0[1]) * ratio;
    const altitudeFeet =
      p0[2] !== undefined && p1[2] !== undefined ? p0[2] + (p1[2] - p0[2]) * ratio : 0;
    const flightLevel = Math.round(altitudeFeet / 100);
    if (flightLevel < sim.flLowerBound || flightLevel > sim.flUpperBound) continue;

    const altitudeLabel = `FL${String(flightLevel).padStart(3, "0")}`;
    planesCollection.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        flightId: trajectory.flightId,
        callSign: trajectory.callSign ?? trajectory.flightId,
        bearing: fastBearing(p0[0], p0[1], p1[0], p1[1]),
        labelText: `${trajectory.callSign ?? trajectory.flightId} · ${altitudeLabel}`,
      },
    });
  }

  const planeSource = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (planeSource) {
    planeSource.setData(planesCollection);
  }

  const visibilitySnapshot = getFlightLineVisibilitySnapshot(
    tracks,
    sim.t,
    sim.flLowerBound,
    sim.flUpperBound,
  );
  const visibleFlightIds = deriveVisibleFlightLineIds({
    activeInsideRangeFlightIds: visibilitySnapshot.activeInsideRangeIds,
    listDrivenEligibleFlightIds: visibilitySnapshot.listDrivenEligibleIds,
    focusMode: sim.focusMode,
    focusFlightIds: sim.focusFlightIds,
  });
  const filterExpression =
    visibleFlightIds.length === 0
      ? ["==", ["to-string", ["get", "flightId"]], "__no_match__"]
      : ["in", ["to-string", ["get", "flightId"]], ["literal", visibleFlightIds]];

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpression as maplibregl.FilterSpecification);
    syncFlightLevelLabelLayer({
      map,
      tracks,
      visibleFlightIds,
      showFlightLineLabels: sim.showFlightLineLabels,
      flightLineLabelMode: sim.flightLineLabelMode,
    });
    setFlightLineLabelFilters(map, filterExpression);
    if (map.getLayer("plane-icons")) {
      map.setFilter("plane-icons", filterExpression as maplibregl.FilterSpecification);
    }

    const inFocusContext = sim.focusMode || !!sim.selectedCollapsedSector;
    const nextLineOpacity = sim.showFlightLines || inFocusContext ? (sim.focusMode ? 0.8 : 0.1) : 0;
    const previousLineOpacity = (map as maplibregl.Map & { __prevLineOpacity?: number }).__prevLineOpacity;
    if (previousLineOpacity !== nextLineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", nextLineOpacity);
      (map as maplibregl.Map & { __prevLineOpacity?: number }).__prevLineOpacity = nextLineOpacity;
    }
  }
}

export default function ComplexityCanvas({ overlay }: ComplexityCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTsRef = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(performance.now());
  const collapsedSectorOpenRangeCountRef = useRef<number>(0);

  const {
    t,
    resourceDate,
    weatherOverlay,
    tick,
    flights,
    showFlightLineLabels,
    flightLineLabelMode,
    showCallsigns,
    showFlightLines,
    showWaypoints,
    showTrafficVolumes,
    setBaselineFlights,
    selectedCollapsedSector,
    setSelectedCollapsedSector,
    focusMode,
    focusFlightIds,
    setFocusMode,
    setFocusFlightIds,
    flLowerBound,
    flUpperBound,
    playing,
  } = useSimStore();
  const theme = useThemeStore((state) => state.theme);

  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );
  const currentMinuteOfDay = useMemo(() => getMinuteOfDay(t), [t]);
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);

  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);

  useEffect(() => {
    if (!resourcePaths || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(theme, 512),
      center: [3, 45],
      zoom: 4,
    });
    mapRef.current = map;
    const loadGuard = createAsyncLoadGuard(
      () => mapRef.current === map && useSimStore.getState().resourceDate === resourceDate,
    );

    map.on("load", async () => {
      setBaseDataLoading(true);
      try {
        const [collapsedSectorsRaw, trajectories, waypoints] = await Promise.all([
          loadSectors(resourcePaths.collapsedSectorsGeojson),
          loadTrajectories(resourcePaths.flightsCsv),
          loadWaypoints("/data/Waypoints.txt", [-12, 33, 22, 62]),
        ]);
        if (!loadGuard.isActive()) return;

        const normalizedCollapsedSectors = normalizeCollapsedSectors(collapsedSectorsRaw);
        collapsedSectorOpenRangeCountRef.current = normalizedCollapsedSectors.maxOpenRangeCount;
        addTrafficVolumeSources(map, normalizedCollapsedSectors.collection);
        addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });

        const filterExpression = getAirspaceDisplayFilter({
          mode: "es",
          flLowerBound: useSimStore.getState().flLowerBound,
          flUpperBound: useSimStore.getState().flUpperBound,
          currentTrafficVolumeBin: getHourBin(useSimStore.getState().t),
          currentMinuteOfDay: getMinuteOfDay(useSimStore.getState().t),
          csOpenRangeCount: collapsedSectorOpenRangeCountRef.current,
        });
        applyTrafficVolumeFilters(map, filterExpression);
        applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);

        const activeTrajectories = setBaselineFlights(trajectories);
        const lineCollection = buildTrajectoryLineFeatureCollection(activeTrajectories);
        map.addSource("flight-lines", { type: "geojson", data: lineCollection });
        map.addLayer({
          id: "flight-lines",
          type: "line",
          source: "flight-lines",
          paint: {
            "line-color": ["get", "lineColor"],
            "line-width": 1,
            "line-opacity": 0.1,
          },
        });
        map.addLayer({
          id: "flight-line-labels",
          type: "symbol",
          source: "flight-lines",
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "callSign"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
          },
          paint: {
            "text-color": "#34d399",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2,
          },
        });

        map.addSource("waypoints", { type: "geojson", data: waypoints });
        const waypointImportanceThreshold: any = [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          3,
          5,
          3,
          7,
          2,
          9,
          1,
          11,
          0,
        ];
        map.addLayer({
          id: "wp-points",
          type: "circle",
          source: "waypoints",
          filter: [">=", ["get", "importance"], waypointImportanceThreshold],
          paint: {
            "circle-color": "#f59e0b",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 3, 12, 4, 16, 6],
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 0.8, 12, 0.9],
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1,
          },
        });
        map.addLayer({
          id: "wp-labels",
          type: "symbol",
          source: "waypoints",
          minzoom: 6,
          filter: [">=", ["get", "importance"], waypointImportanceThreshold],
          layout: {
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 12, 11, 16, 13],
            "text-offset": [0, -1.2],
            "text-anchor": "bottom",
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: {
            "text-color": "#fbbf24",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 10, 0.9, 14, 1],
          },
        });

        const planeImage = await loadImage(map, "/plane.svg");
        if (!loadGuard.isActive()) return;
        map.addImage("plane", planeImage, { pixelRatio: 2 });
        map.addSource("planes", { type: "geojson", data: emptyFeatureCollection() });
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
            "text-size": 11,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2,
          },
        });

        try {
          const currentSim = useSimStore.getState();
          map.setLayoutProperty("wp-points", "visibility", currentSim.showWaypoints ? "visible" : "none");
          map.setLayoutProperty("wp-labels", "visibility", currentSim.showWaypoints ? "visible" : "none");
          map.setPaintProperty("plane-icons", "text-opacity", currentSim.showCallsigns ? 1 : 0);
          map.setPaintProperty("plane-icons", "text-halo-width", currentSim.showCallsigns ? 2 : 0);
        } catch {
          // no-op
        }

        (map as maplibregl.Map & { __trajectories?: Trajectory[] }).__trajectories = activeTrajectories;

        const handleFlightClick = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const flightId = String(feature?.properties?.flightId ?? "").trim();
          if (!flightId) return;
          const tracks =
            (map as maplibregl.Map & { __trajectories?: Trajectory[] }).__trajectories ?? [];
          const clickedFlight = tracks.find((trajectory) => String(trajectory.flightId) === flightId);
          if (!clickedFlight) return;
          setSelectedFlight(clickedFlight);
          setPopupPosition({ x: event.point.x, y: event.point.y });
          setFocusMode(true);
          setFocusFlightIds(new Set([clickedFlight.flightId]));
        };

        map.on("click", "flight-lines", handleFlightClick);
        map.on("click", "plane-icons", handleFlightClick);
        map.on("mouseenter", "flight-lines", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "flight-lines", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseenter", "plane-icons", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "plane-icons", () => {
          map.getCanvas().style.cursor = "";
        });

        const getCollapsedSectorIdFromEvent = (event: maplibregl.MapLayerMouseEvent): string | null => {
          const feature = event.features?.[0];
          const rawId = feature?.properties?.traffic_volume_id ?? feature?.properties?.label;
          return rawId != null ? String(rawId) : null;
        };

        const handleCollapsedSectorClick = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const sectorId = getCollapsedSectorIdFromEvent(event);
          if (!sectorId) return;
          const sectorData = feature
            ? { properties: (feature.properties as unknown as SectorFeatureProps) }
            : null;
          setSelectedCollapsedSector(sectorId, sectorData);
        };

        const handleCollapsedSectorHover = (event: maplibregl.MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = "pointer";
          const sectorId = getCollapsedSectorIdFromEvent(event);
          setHoveredTrafficVolume(sectorId);
        };

        const handleCollapsedSectorLeave = () => {
          map.getCanvas().style.cursor = "";
          setHoveredTrafficVolume(null);
        };

        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.label, handleCollapsedSectorClick);
        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleCollapsedSectorClick);
        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.point, handleCollapsedSectorClick);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.label, handleCollapsedSectorHover);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleCollapsedSectorHover);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.point, handleCollapsedSectorHover);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.label, handleCollapsedSectorLeave);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleCollapsedSectorLeave);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.point, handleCollapsedSectorLeave);

        const bounds = new maplibregl.LngLatBounds();
        lineCollection.features.forEach((feature) => {
          const coordinates = (feature.geometry as GeoJSON.LineString | null)?.coordinates ?? [];
          coordinates.forEach(([lon, lat]) => bounds.extend([lon, lat]));
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds as LngLatBoundsLike, { padding: 60, duration: 0 });
        }

        map.once("idle", () => {
          updatePlanePositions(map);
        });
        setBaseDataLoading(false);
      } catch (error) {
        console.error("Failed to load complexity canvas data", error);
        if (loadGuard.isActive()) {
          setBaseDataLoading(false);
        }
      }
    });

    return () => {
      loadGuard.cancel();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
      clearComplexityTraceLayers(map);
      map.remove();
      mapRef.current = null;
    };
  }, [resourceDate, resourcePaths, setBaselineFlights, setFocusFlightIds, setFocusMode, setSelectedCollapsedSector, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("flight-lines") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(buildTrajectoryLineFeatureCollection(flights));
    (map as maplibregl.Map & { __trajectories?: Trajectory[] }).__trajectories = flights;
    updatePlanePositions(map);
    if (selectedFlight) {
      setSelectedFlight(flights.find((flight) => flight.flightId === selectedFlight.flightId) ?? null);
    }
  }, [flights, selectedFlight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (playing) {
      lastTsRef.current = performance.now();
      lastUpdateRef.current = lastTsRef.current;
      const targetFrameMs = 1000 / 30;
      const loop = () => {
        const now = performance.now();
        const dt = now - lastTsRef.current;
        lastTsRef.current = now;
        if (now - lastUpdateRef.current >= targetFrameMs) {
          tick(dt);
          updatePlanePositions(mapRef.current);
          lastUpdateRef.current = now;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    updatePlanePositions(map);
  }, [playing, tick]);

  useEffect(() => {
    if (!playing) {
      updatePlanePositions(mapRef.current);
    }
  }, [playing, t]);

  useEffect(() => {
    updatePlanePositions(mapRef.current);
  }, [
    flLowerBound,
    flUpperBound,
    focusFlightIds,
    focusMode,
    selectedCollapsedSector,
    showFlightLineLabels,
    flightLineLabelMode,
    showFlightLines,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("plane-icons")) {
      map.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
      map.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
    }
  }, [showCallsigns]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = showWaypoints ? "visible" : "none";
    if (map.getLayer("wp-points")) map.setLayoutProperty("wp-points", "visibility", visibility);
    if (map.getLayer("wp-labels")) map.setLayoutProperty("wp-labels", "visibility", visibility);
  }, [showWaypoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getSource("sectors")) return;
      const filterExpression = getAirspaceDisplayFilter({
        mode: "es",
        flLowerBound,
        flUpperBound,
        currentTrafficVolumeBin,
        currentMinuteOfDay,
        csOpenRangeCount: collapsedSectorOpenRangeCountRef.current,
      });
      applyTrafficVolumeFilters(map, filterExpression);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      map.off("render", waitForReady);
      if (!cancelled) apply();
    };
    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
    };
  }, [currentMinuteOfDay, currentTrafficVolumeBin, flLowerBound, flUpperBound]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeVisibility(map, showTrafficVolumes);
  }, [showTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlight(map, selectedCollapsedSector, flLowerBound, flUpperBound, true);
  }, [flLowerBound, flUpperBound, selectedCollapsedSector]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHover(map, hoveredTrafficVolume, flLowerBound, flUpperBound, true);
  }, [flLowerBound, flUpperBound, hoveredTrafficVolume]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!selectedCollapsedSector) {
        clearComplexityTraceLayers(map);
        return;
      }
      syncComplexityTraceLayers(map, overlay);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      map.off("render", waitForReady);
      if (!cancelled) apply();
    };
    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
    };
  }, [overlay, selectedCollapsedSector]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (weatherOverlay !== "surface-precip") {
      hideSurfacePrecipLayer(map);
      return;
    }

    const targetHour = isoHourFrom(resourceDate ?? "1970-01-01", t);
    const apply = () => {
      try {
        ensureSurfacePrecipHour(map, targetHour);
      } catch {
        // no-op
      }
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      map.off("render", waitForReady);
      if (!cancelled) apply();
    };
    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
    };
  }, [resourceDate, t, weatherOverlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleFlightSearchSelect = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<{ flight?: Trajectory }>).detail;
      const flight = detail?.flight;
      if (!flight) return;
      const tracks =
        (map as maplibregl.Map & { __trajectories?: Trajectory[] }).__trajectories ?? [];
      const matchedFlight = tracks.find((trajectory) => trajectory.flightId === flight.flightId);
      if (!matchedFlight) return;
      const firstCoordinate = matchedFlight.coords?.[0];
      if (firstCoordinate) {
        map.flyTo({ center: [firstCoordinate[0], firstCoordinate[1]], zoom: Math.max(map.getZoom(), 6), duration: 1200 });
      }
      setSelectedFlight(matchedFlight);
      if (firstCoordinate) {
        const projected = map.project([firstCoordinate[0], firstCoordinate[1]]);
        setPopupPosition({ x: projected.x, y: projected.y });
      }
    };

    const handleTrafficVolumeSearchSelect = (
      rawEvent: Event,
    ) => {
      const detail = (rawEvent as CustomEvent<{
        trafficVolume?: GeoJSON.Feature;
        trafficVolumeId?: string;
      }>).detail;
      const trafficVolume = detail?.trafficVolume;
      const trafficVolumeId = String(
        detail?.trafficVolumeId ??
          (trafficVolume?.properties as Record<string, unknown> | undefined)?.traffic_volume_id ??
          "",
      ).trim();
      if (!trafficVolumeId) return;

      const normalizedSectorData = trafficVolume?.properties
        ? { properties: trafficVolume.properties as unknown as SectorFeatureProps }
        : null;
      setSelectedCollapsedSector(trafficVolumeId, normalizedSectorData);

      const geometryCenter =
        trafficVolume?.geometry ? getTrafficVolumeCenter(trafficVolume.geometry) : null;
      const center = geometryCenter ?? getTrafficVolumeCenterFromMap(map, trafficVolumeId);
      if (center) {
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 7), duration: 1200 });
      }
    };

    window.addEventListener("flight-search-select", handleFlightSearchSelect as EventListener);
    window.addEventListener("traffic-volume-search-select", handleTrafficVolumeSearchSelect as EventListener);
    return () => {
      window.removeEventListener("flight-search-select", handleFlightSearchSelect as EventListener);
      window.removeEventListener("traffic-volume-search-select", handleTrafficVolumeSearchSelect as EventListener);
    };
  }, [setSelectedCollapsedSector]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <FlightDetailsPopup
        flight={selectedFlight}
        position={popupPosition}
        onClose={() => {
          setSelectedFlight(null);
          setPopupPosition(null);
          setFocusMode(false);
          setFocusFlightIds(new Set<string>());
        }}
      />
      <PageLoadingIndicator visible={baseDataLoading} />
    </>
  );
}
