"use client";

import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { authFetch } from "@/lib/auth";
import { loadSectors } from "@/lib/airspace";
import {
  getAirspaceDisplayFilter,
  getHourBin,
  getMinuteOfDay,
  normalizeCollapsedSectors,
} from "@/lib/airspaceDisplay";
import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { deriveVisibleFlightLineIds } from "@/lib/flightCatcherPolicy";
import { setFlightLineLabelFilters } from "@/lib/flightLineLabels";
import { syncFlightLevelBinPreviewLayer } from "@/lib/flightLevelBinPreviewLayer";
import { syncFlightLevelLabelLayer } from "@/lib/flightLineLabelLayer";
import { loadTrajectories } from "@/lib/flights";
import { getFlightLineVisibilitySnapshot } from "@/lib/flightVisibility";
import { createMapStyle } from "@/lib/mapStyle";
import type { SectorFeatureProps, Trajectory } from "@/lib/models";
import type { RadLegitimacyFlag } from "@/lib/radPreview";
import { formatSecondsToHHMM } from "@/lib/time";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeHighlightList,
  applyTrafficVolumeHotspots,
  applyTrafficVolumeHover,
  applyTrafficVolumeVisibility,
  buildTrafficVolumeSources,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
  TRAFFIC_VOLUME_LAYER_IDS,
  TRAFFIC_VOLUME_SOURCE_ID,
} from "@/lib/trafficVolumeLayers";
import type { AirspaceSources } from "@/lib/trafficVolumeDcbGlanceMap";
import { buildTrajectoryLineFeatureCollection } from "@/lib/trajectoryRender";
import { loadWaypoints } from "@/lib/waypoints";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";

type RadPreviewCanvasProps = {
  selectedFlightIds: string[];
  hoveredFlightId: string | null;
  legitimacyFlag: RadLegitimacyFlag;
};

const RAD_SELECTED_SOURCE_ID = "rad-preview-selected-flights";
const RAD_SELECTED_LAYER_ID = "rad-preview-selected-lines";
const RAD_HOVER_SOURCE_ID = "rad-preview-hover-flight";
const RAD_HOVER_LAYER_ID = "rad-preview-hover-line";
const SLACK_LAYER_ID = "sector-slack";

export default function RadPreviewCanvas({
  selectedFlightIds,
  hoveredFlightId,
  legitimacyFlag,
}: RadPreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const tvSourcesRef = useRef<AirspaceSources | null>(null);
  const csSourcesRef = useRef<AirspaceSources | null>(null);
  const csOpenRangeCountRef = useRef<number>(0);
  const lastTs = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(performance.now());
  const lastSlackKeyRef = useRef<string | null>(null);
  const latestRadOverlayRef = useRef<{
    selectedFlightIds: string[];
    hoveredFlightId: string | null;
    legitimacyFlag: RadLegitimacyFlag;
  }>({
    selectedFlightIds,
    hoveredFlightId,
    legitimacyFlag,
  });

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
    showHotspots,
    airspaceDisplayMode,
    setAirspaceDisplayMode,
    setBaselineFlights,
    setSelectedTrafficVolume,
    setSelectedCollapsedSector,
    flLowerBound,
    flUpperBound,
    focusMode,
    focusFlightIds,
    setFocusMode,
    setFocusFlightIds,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    selectedCollapsedSector,
    hotspots,
    getActiveHotspots,
    flowPreviewFlightId,
    flightLinePreviewFlightIds,
    flightLevelBinPreviewSegments,
    playing,
    slackMode,
    setSlackMode,
    slackSign,
    deltaMin,
    setIsFetchingSlack,
  } = useSimStore();
  const theme = useThemeStore((state) => state.theme);

  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);
  const currentMinuteOfDay = useMemo(() => getMinuteOfDay(t), [t]);
  const selectedTvIds = useMemo(
    () =>
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [],
    [selectedTrafficVolume, selectedTrafficVolumes],
  );
  const slackSourceTrafficVolumeId =
    airspaceDisplayMode === "tv" && selectedTvIds.length === 1 ? selectedTvIds[0] ?? null : null;
  const slackEligible = !!slackSourceTrafficVolumeId;

  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [hoverLabelPoint, setHoverLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [slackMetaByTv, setSlackMetaByTv] = useState<
    Record<string, { time_window: string; slack: number; occupancy: number }>
  >({});
  const [baseDataLoading, setBaseDataLoading] = useState(true);

  useEffect(() => {
    latestRadOverlayRef.current = {
      selectedFlightIds,
      hoveredFlightId,
      legitimacyFlag,
    };
  }, [hoveredFlightId, legitimacyFlag, selectedFlightIds]);

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
        const [sectors, tracks, collapsedSectorsRaw] = await Promise.all([
          loadSectors(resourcePaths.airspaceGeojson),
          loadTrajectories(resourcePaths.flightsCsv),
          loadSectors(resourcePaths.collapsedSectorsGeojson).catch((error) => {
            console.error("Failed to preload collapsed sectors:", error);
            return null;
          }),
        ]);
        if (!loadGuard.isActive()) return;

        const activeTracks = setBaselineFlights(tracks);

        tvSourcesRef.current = addTrafficVolumeSources(map, sectors);
        if (collapsedSectorsRaw) {
          const normalized = normalizeCollapsedSectors(collapsedSectorsRaw);
          csSourcesRef.current = buildTrafficVolumeSources(normalized.collection);
          csOpenRangeCountRef.current = normalized.maxOpenRangeCount;
        } else {
          csSourcesRef.current = null;
          csOpenRangeCountRef.current = 0;
        }
        addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });
        if (!map.getLayer(SLACK_LAYER_ID)) {
          map.addLayer(
            {
              id: SLACK_LAYER_ID,
              type: "fill",
              source: TRAFFIC_VOLUME_SOURCE_ID,
              layout: { visibility: "none" },
              paint: {
                "fill-color": "#22c55e",
                "fill-opacity": 0,
              },
            },
            TRAFFIC_VOLUME_LAYER_IDS.point,
          );
        }

        applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes, { includeSlack: true });
        const sim = useSimStore.getState();
        if (sim.airspaceDisplayMode === "es" && !csSourcesRef.current) {
          setAirspaceDisplayMode("tv");
        }
        const activeMode = setActiveAirspaceSources(
          map,
          sim.airspaceDisplayMode,
          tvSourcesRef.current,
          csSourcesRef.current,
        );
        const initialFilter = getAirspaceDisplayFilter({
          mode: activeMode,
          flLowerBound: sim.flLowerBound,
          flUpperBound: sim.flUpperBound,
          currentTrafficVolumeBin: getHourBin(sim.t),
          currentMinuteOfDay: getMinuteOfDay(sim.t),
          csOpenRangeCount: csOpenRangeCountRef.current,
          tvCapacityRangeCount: tvSourcesRef.current?.maxCapacityRangeCount ?? 0,
        });
        applyTrafficVolumeFilters(map, initialFilter, { includeSlack: true });

        const lineFC = buildTrajectoryLineFeatureCollection(activeTracks);
        map.addSource("flight-lines", { type: "geojson", data: lineFC });
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

        map.addSource(RAD_SELECTED_SOURCE_ID, { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: RAD_SELECTED_LAYER_ID,
          type: "line",
          source: RAD_SELECTED_SOURCE_ID,
          paint: {
            "line-color": legitimacyFlag === "I" ? "#fb7185" : "#34d399",
            "line-width": 2.5,
            "line-opacity": 0.92,
          },
        });
        map.addSource(RAD_HOVER_SOURCE_ID, { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: RAD_HOVER_LAYER_ID,
          type: "line",
          source: RAD_HOVER_SOURCE_ID,
          paint: {
            "line-color": "#f8fafc",
            "line-width": 4,
            "line-opacity": 0.95,
          },
        });

        const [minX, minY, maxX, maxY] = [-10, 35, 20, 60];
        const margin = 2;
        const filteredWaypoints = await loadWaypoints("/data/Waypoints.txt", [
          minX - margin,
          minY - margin,
          maxX + margin,
          maxY + margin,
        ]);
        if (!loadGuard.isActive()) return;
        map.addSource("waypoints", { type: "geojson", data: filteredWaypoints });

        const importanceThresholdExpr: any = [
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
          filter: [">=", ["get", "importance"], importanceThresholdExpr],
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
          filter: [">=", ["get", "importance"], importanceThresholdExpr],
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

        const planeImage = await loadImage("/plane.svg");
        if (!loadGuard.isActive()) return;
        map.addImage("plane", planeImage, { pixelRatio: 2 });
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
            "text-size": 11,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2,
          },
        });

        try {
          const current = useSimStore.getState();
          map.setLayoutProperty("wp-points", "visibility", current.showWaypoints ? "visible" : "none");
          map.setLayoutProperty("wp-labels", "visibility", current.showWaypoints ? "visible" : "none");
          map.setPaintProperty("plane-icons", "text-opacity", current.showCallsigns ? 1 : 0);
          map.setPaintProperty("plane-icons", "text-halo-width", current.showCallsigns ? 2 : 0);
        } catch {
          // no-op
        }

        (map as any).__trajectories = activeTracks;

        const handleFlightLayerClick = (event: maplibregl.MapLayerMouseEvent) => {
          const flight = flightFromMapEvent(map, event);
          if (!flight) return;
          openFlightPopup(map, flight, event.point.x, event.point.y, setSelectedFlight, setPopupPosition);
          setFocusMode(true);
          setFocusFlightIds(new Set([flight.flightId]));
        };

        map.on("click", "flight-lines", handleFlightLayerClick);
        map.on("click", "plane-icons", handleFlightLayerClick);
        map.on("click", RAD_SELECTED_LAYER_ID, handleFlightLayerClick);
        map.on("click", RAD_HOVER_LAYER_ID, handleFlightLayerClick);

        const setPointer = () => {
          map.getCanvas().style.cursor = "pointer";
        };
        const clearPointer = () => {
          map.getCanvas().style.cursor = "";
        };
        map.on("mouseenter", "flight-lines", setPointer);
        map.on("mouseleave", "flight-lines", clearPointer);
        map.on("mouseenter", "plane-icons", setPointer);
        map.on("mouseleave", "plane-icons", clearPointer);
        map.on("mouseenter", RAD_SELECTED_LAYER_ID, setPointer);
        map.on("mouseleave", RAD_SELECTED_LAYER_ID, clearPointer);
        map.on("mouseenter", RAD_HOVER_LAYER_ID, setPointer);
        map.on("mouseleave", RAD_HOVER_LAYER_ID, clearPointer);

        const getTrafficVolumeIdFromEvent = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features && event.features.length > 0 ? event.features[0] : null;
          const rawId = feature?.properties?.traffic_volume_id ?? feature?.properties?.label;
          return rawId != null ? String(rawId) : null;
        };
        const selectTrafficVolume = (trafficVolumeId: string) => {
          const sectorFeatures = map.querySourceFeatures("sectors", {
            filter: ["==", "traffic_volume_id", trafficVolumeId],
          });
          const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
          const tvData = fullSectorFeature
            ? { properties: (fullSectorFeature.properties as any) as SectorFeatureProps }
            : null;
          setSelectedTrafficVolume(trafficVolumeId, tvData);
        };
        const handleTrafficVolumeClick = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features && event.features.length > 0 ? event.features[0] : null;
          const trafficVolumeId = getTrafficVolumeIdFromEvent(event);
          if (!trafficVolumeId) return;
          const current = useSimStore.getState();
          if (current.airspaceDisplayMode === "es") {
            const collapsedSectorData = feature
              ? { properties: (feature.properties as any) as SectorFeatureProps }
              : null;
            setSelectedCollapsedSector(trafficVolumeId, collapsedSectorData);
            return;
          }
          selectTrafficVolume(trafficVolumeId);
        };
        const handleTrafficVolumeHover = (event: maplibregl.MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = "pointer";
          const trafficVolumeId = getTrafficVolumeIdFromEvent(event);
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
          if (event.point && useSimStore.getState().slackMode !== "off") {
            setHoverLabelPoint({ x: event.point.x, y: event.point.y });
          }
        };
        const handleTrafficVolumeHoverExit = () => {
          map.getCanvas().style.cursor = "";
          setHoveredTrafficVolume(null);
          setHoverLabelPoint(null);
        };

        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
        map.on("click", TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
        map.on("mouseenter", TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
        map.on("mouseleave", TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);

        setBaseDataLoading(false);

        const bounds = new maplibregl.LngLatBounds();
        lineFC.features.forEach((feature) =>
          (feature.geometry as any).coordinates.forEach(([x, y]: [number, number]) => bounds.extend([x, y])),
        );
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds as LngLatBoundsLike, { padding: 60, duration: 0 });
        }

        map.once("idle", () => {
          const latest = latestRadOverlayRef.current;
          updatePlanePositions(map);
          updateRadOverlay(
            map,
            latest.selectedFlightIds,
            latest.hoveredFlightId,
            latest.legitimacyFlag,
          );
        });
      } catch (error) {
        console.error("Failed to load RAD preview map data", error);
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
      map.remove();
      mapRef.current = null;
    };
  }, [
    resourceDate,
    resourcePaths,
    setAirspaceDisplayMode,
    setBaselineFlights,
    setFocusFlightIds,
    setFocusMode,
    setSelectedCollapsedSector,
    theme,
    setSelectedTrafficVolume,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("flight-lines") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(buildTrajectoryLineFeatureCollection(flights));
    (map as any).__trajectories = flights;
    updatePlanePositions(map);
    updateRadOverlay(map, selectedFlightIds, hoveredFlightId, legitimacyFlag);
    if (selectedFlight) {
      const next = flights.find((flight) => flight.flightId === selectedFlight.flightId) ?? null;
      setSelectedFlight(next);
    }
  }, [flights, hoveredFlightId, legitimacyFlag, selectedFlight, selectedFlightIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateRadOverlay(map, selectedFlightIds, hoveredFlightId, legitimacyFlag);
  }, [hoveredFlightId, legitimacyFlag, selectedFlightIds]);

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
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    updatePlanePositions(mapRef.current);
  }, [playing, tick]);

  useEffect(() => {
    if (!playing) updatePlanePositions(mapRef.current);
  }, [playing, t]);

  useEffect(() => {
    updatePlanePositions(mapRef.current);
  }, [
    flowPreviewFlightId,
    flightLinePreviewFlightIds,
    flightLevelBinPreviewSegments,
    focusMode,
    focusFlightIds,
    showFlightLines,
    selectedTrafficVolume,
    selectedCollapsedSector,
    flLowerBound,
    flUpperBound,
    showFlightLineLabels,
    flightLineLabelMode,
  ]);

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
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
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
      const filter = getAirspaceDisplayFilter({
        mode: airspaceDisplayMode,
        flLowerBound,
        flUpperBound,
        currentTrafficVolumeBin,
        currentMinuteOfDay,
        csOpenRangeCount: csOpenRangeCountRef.current,
        tvCapacityRangeCount: tvSourcesRef.current?.maxCapacityRangeCount ?? 0,
      });
      applyTrafficVolumeFilters(map, filter, { includeSlack: true });
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
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
  }, [airspaceDisplayMode, currentMinuteOfDay, currentTrafficVolumeBin, flLowerBound, flUpperBound]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      applyTrafficVolumeVisibility(map, showTrafficVolumes, { includeSlack: true });
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
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
  }, [showTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlightList(map, selectedTrafficVolumes);
  }, [selectedTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHover(map, hoveredTrafficVolume);
  }, [hoveredTrafficVolume]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeHotspots = getActiveHotspots();
    applyTrafficVolumeHotspots(map, activeHotspots, flLowerBound, flUpperBound, true);
  }, [showHotspots, hotspots, flLowerBound, flUpperBound, t, getActiveHotspots]);

  useEffect(() => {
    if (airspaceDisplayMode !== "es") return;
    if (selectedTrafficVolume) {
      setSelectedTrafficVolume(null);
    }
    setFocusMode(false);
    setFocusFlightIds(new Set());
    setHoveredTrafficVolume(null);
  }, [airspaceDisplayMode, selectedTrafficVolume, setFocusFlightIds, setFocusMode, setSelectedTrafficVolume]);

  useEffect(() => {
    if (airspaceDisplayMode !== "tv") return;
    setSelectedCollapsedSector(null);
  }, [airspaceDisplayMode, setSelectedCollapsedSector]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const tvSources = tvSourcesRef.current;
      if (!tvSources) return;
      const csSources = csSourcesRef.current;
      if (airspaceDisplayMode === "es" && !csSources) {
        setAirspaceDisplayMode("tv");
        return;
      }
      setActiveAirspaceSources(map, airspaceDisplayMode, tvSources, csSources);
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      try {
        map.off("render", waitForReady);
      } catch {
        // no-op
      }
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
  }, [airspaceDisplayMode, setAirspaceDisplayMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (slackEligible) return;
    hideSlackOverlay(map);
    setHoverLabelPoint(null);
    lastSlackKeyRef.current = null;
    if (slackMode !== "off") {
      setSlackMode("off");
    }
  }, [slackEligible, slackMode, setSlackMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showTrafficVolumes || !slackEligible || slackMode === "off") {
      hideSlackOverlay(map);
      return;
    }
    if (map.getLayer(SLACK_LAYER_ID)) {
      map.setLayoutProperty(SLACK_LAYER_ID, "visibility", "visible");
    }
  }, [showTrafficVolumes, slackEligible, slackMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showTrafficVolumes || !slackEligible || slackMode === "off" || !slackSourceTrafficVolumeId) {
      return;
    }
    const refStr = formatSecondsToHHMM(t);
    const key = `${slackSourceTrafficVolumeId}|${refStr}|${slackSign}|${deltaMin}`;
    if (lastSlackKeyRef.current === key) return;
    lastSlackKeyRef.current = key;
    void fetchAndApplySlack(
      map,
      slackSourceTrafficVolumeId,
      refStr,
      slackSign,
      deltaMin,
      setIsFetchingSlack,
      setSlackMetaByTv,
      true,
    ).then((success) => {
      if (!success && lastSlackKeyRef.current === key) {
        lastSlackKeyRef.current = null;
      }
    });
  }, [
    deltaMin,
    setIsFetchingSlack,
    showTrafficVolumes,
    slackEligible,
    slackMode,
    slackSign,
    slackSourceTrafficVolumeId,
    t,
  ]);

  useEffect(() => {
    const handleFlightSearchSelect = (event: Event) => {
      const detail = (event as CustomEvent<{ flight?: Trajectory }>).detail;
      if (!detail?.flight) return;
      const map = mapRef.current;
      if (!map) return;
      const flight = detail.flight;
      const point = resolveFlightPointAtCurrentTime(flight, useSimStore.getState().t);
      if (!point) return;
      map.flyTo({
        center: point,
        zoom: Math.max(map.getZoom(), 8),
        duration: 1200,
      });
      const projected = map.project(point as [number, number]);
      openFlightPopup(map, flight, projected.x, projected.y, setSelectedFlight, setPopupPosition);
      setFocusMode(true);
      setFocusFlightIds(new Set([flight.flightId]));
    };
    window.addEventListener("flight-search-select", handleFlightSearchSelect as EventListener);
    return () => {
      window.removeEventListener("flight-search-select", handleFlightSearchSelect as EventListener);
    };
  }, [setFocusFlightIds, setFocusMode]);

  useEffect(() => {
    const handleTrafficVolumeSearchSelect = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      const { trafficVolume, trafficVolumeId, selectionApplied } = detail;
      const map = mapRef.current;
      if (!map) return;

      let tvId: string | null = null;
      let tvGeometry: GeoJSON.Geometry | null = null;
      let fullSectorFeature: any = null;

      if (trafficVolume && trafficVolume.properties?.traffic_volume_id) {
        tvId = trafficVolume.properties.traffic_volume_id;
        tvGeometry = trafficVolume.geometry;
        fullSectorFeature = trafficVolume;
      } else if (trafficVolumeId) {
        tvId = trafficVolumeId;
        const sectorFeatures = map.querySourceFeatures("sectors", {
          filter: ["==", "traffic_volume_id", trafficVolumeId],
        });
        if (sectorFeatures.length > 0) {
          fullSectorFeature = sectorFeatures[0];
          tvGeometry = sectorFeatures[0].geometry as GeoJSON.Geometry;
        }
      }

      if (!tvId) return;
      if (!selectionApplied) {
        const sim = useSimStore.getState();
        if (sim.airspaceDisplayMode === "es") {
          const collapsedSectorData = fullSectorFeature
            ? { properties: (fullSectorFeature.properties as any) as SectorFeatureProps }
            : null;
          sim.setSelectedCollapsedSector(tvId, collapsedSectorData);
        } else {
          const tvData = fullSectorFeature
            ? { properties: (fullSectorFeature.properties as any) as SectorFeatureProps }
            : null;
          sim.setSelectedTrafficVolume(tvId, tvData);
        }
      }

      const center = tvGeometry
        ? getTrafficVolumeCenter(tvGeometry)
        : getTrafficVolumeCenterFromMap(map, tvId);
      if (center) {
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 7), duration: 1200 });
      }
    };
    window.addEventListener("traffic-volume-search-select", handleTrafficVolumeSearchSelect as EventListener);
    return () => {
      window.removeEventListener(
        "traffic-volume-search-select",
        handleTrafficVolumeSearchSelect as EventListener,
      );
    };
  }, []);

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
          setFocusFlightIds(new Set());
        }}
      />
      <PageLoadingIndicator visible={baseDataLoading} />
      {slackMode !== "off" && hoveredTrafficVolume && hoverLabelPoint && slackMetaByTv[hoveredTrafficVolume] && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{ left: hoverLabelPoint.x + 12, top: hoverLabelPoint.y - 12 }}
        >
          <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-md">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-300">{hoveredTrafficVolume}</div>
            <div className="flex items-center gap-3 text-xs text-gray-200">
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Window</span>
                <span className="font-semibold text-white">{slackMetaByTv[hoveredTrafficVolume].time_window}</span>
              </div>
              <div className="h-4 w-px bg-white/20" />
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Slack</span>
                <span className="font-semibold text-emerald-300">
                  {Number(slackMetaByTv[hoveredTrafficVolume].slack).toFixed(1)}
                </span>
              </div>
              <div className="h-4 w-px bg-white/20" />
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Occup.</span>
                <span className="font-semibold text-sky-300">
                  {Number(slackMetaByTv[hoveredTrafficVolume].occupancy).toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function updatePlanePositions(map: maplibregl.Map | null) {
  if (!map) return;
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        try {
          updatePlanePositions(map);
        } catch (error) {
          console.error("Deferred updatePlanePositions error:", error);
        }
      });
    } catch {
      // no-op
    }
    return;
  }

  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as Trajectory[] | undefined;
  if (!tracks) return;

  const planesFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const trajectory of tracks) {
    if (sim.t < trajectory.t0 || sim.t > trajectory.t1) continue;

    const idx = segmentIndex(trajectory.times, sim.t);
    const t0 = trajectory.times[idx];
    const t1 = trajectory.times[idx + 1];
    const p0 = trajectory.coords[idx];
    const p1 = trajectory.coords[idx + 1];
    const u = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0] - p0[0]) * u;
    const lat = p0[1] + (p1[1] - p0[1]) * u;
    const alt = p0[2] !== undefined && p1[2] !== undefined ? p0[2] + (p1[2] - p0[2]) * u : 0;
    const flightLevel = Math.round(alt / 100);
    if (flightLevel < sim.flLowerBound || flightLevel > sim.flUpperBound) continue;

    const altitudeLabel = `FL${flightLevel.toString().padStart(3, "0")}`;
    planesFC.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        flightId: trajectory.flightId,
        callSign: trajectory.callSign ?? trajectory.flightId,
        bearing: fastBearing(p0[0], p0[1], p1[0], p1[1]),
        altitude: altitudeLabel,
        labelText: `${trajectory.callSign ?? trajectory.flightId} · ${altitudeLabel}`,
      },
    });
  }

  const planeSource = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (planeSource) planeSource.setData(planesFC);

  const visibilitySnapshot = getFlightLineVisibilitySnapshot(tracks, sim.t, sim.flLowerBound, sim.flUpperBound);
  const lineIdsToShow = deriveVisibleFlightLineIds({
    activeInsideRangeFlightIds: visibilitySnapshot.activeInsideRangeIds,
    listDrivenEligibleFlightIds: visibilitySnapshot.listDrivenEligibleIds,
    focusMode: sim.focusMode,
    focusFlightIds: sim.focusFlightIds,
    flightLinePreviewFlightIds: sim.flightLinePreviewFlightIds,
    flowPreviewFlightId: sim.flowPreviewFlightId,
  });
  const hasFlightLevelBinPreview = sim.flightLevelBinPreviewSegments.length > 0;
  const hasFlightLinePreview = sim.flightLinePreviewFlightIds.size > 0;
  const filterExpr: any =
    hasFlightLevelBinPreview || lineIdsToShow.length === 0
      ? ["==", ["to-string", ["get", "flightId"]], "__no_match__"]
      : ["in", ["to-string", ["get", "flightId"]], ["literal", lineIdsToShow]];

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpr as any);
    syncFlightLevelLabelLayer({
      map,
      tracks,
      visibleFlightIds: hasFlightLevelBinPreview ? [] : lineIdsToShow,
      showFlightLineLabels: sim.showFlightLineLabels,
      flightLineLabelMode: sim.flightLineLabelMode,
    });
    setFlightLineLabelFilters(map, filterExpr);
    if (map.getLayer("plane-icons")) map.setFilter("plane-icons", filterExpr as any);
    const inFocusContext =
      sim.focusMode ||
      !!sim.selectedTrafficVolume ||
      !!sim.selectedCollapsedSector ||
      !!sim.flowPreviewFlightId ||
      hasFlightLinePreview;
    const lineOpacity = hasFlightLevelBinPreview
      ? 0
      : sim.flowPreviewFlightId || hasFlightLinePreview
        ? 0.8
        : sim.showFlightLines || inFocusContext
          ? sim.focusMode
            ? 0.8
            : 0.1
          : 0;
    const prevOpacity = (map as any).__prevLineOpacity;
    if (prevOpacity !== lineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
      (map as any).__prevLineOpacity = lineOpacity;
    }
  }

  syncFlightLevelBinPreviewLayer({
    map,
    segments: sim.flightLevelBinPreviewSegments,
    showFlightLineLabels: sim.showFlightLineLabels,
    flightLineLabelMode: sim.flightLineLabelMode,
  });
}

function updateRadOverlay(
  map: maplibregl.Map | null,
  selectedFlightIds: string[],
  hoveredFlightId: string | null,
  legitimacyFlag: RadLegitimacyFlag,
) {
  if (!map) return;
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        try {
          updateRadOverlay(map, selectedFlightIds, hoveredFlightId, legitimacyFlag);
        } catch (error) {
          console.error("Deferred updateRadOverlay error:", error);
        }
      });
    } catch {
      // no-op
    }
    return;
  }

  const tracks = (map as any).__trajectories as Trajectory[] | undefined;
  if (!tracks) return;
  const byId = new Map<string, Trajectory>();
  for (const track of tracks) {
    byId.set(String(track.flightId), track);
  }

  const selectedTracks = selectedFlightIds
    .map((flightId) => byId.get(String(flightId)))
    .filter((track): track is Trajectory => !!track);
  const hoverTracks =
    hoveredFlightId && byId.has(String(hoveredFlightId)) ? [byId.get(String(hoveredFlightId)) as Trajectory] : [];

  const selectedSource = map.getSource(RAD_SELECTED_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (selectedSource) {
    selectedSource.setData(buildTrajectoryLineFeatureCollection(selectedTracks));
  }
  const hoverSource = map.getSource(RAD_HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (hoverSource) {
    hoverSource.setData(buildTrajectoryLineFeatureCollection(hoverTracks));
  }

  if (map.getLayer(RAD_SELECTED_LAYER_ID)) {
    map.setPaintProperty(
      RAD_SELECTED_LAYER_ID,
      "line-color",
      legitimacyFlag === "I" ? "#fb7185" : "#34d399",
    );
    map.setPaintProperty(RAD_SELECTED_LAYER_ID, "line-opacity", selectedTracks.length > 0 ? 0.92 : 0);
  }
  if (map.getLayer(RAD_HOVER_LAYER_ID)) {
    map.setPaintProperty(RAD_HOVER_LAYER_ID, "line-opacity", hoverTracks.length > 0 ? 0.95 : 0);
  }
}

function flightFromMapEvent(map: maplibregl.Map, event: maplibregl.MapLayerMouseEvent): Trajectory | null {
  const feature = event.features && event.features.length > 0 ? event.features[0] : null;
  const flightId = String(feature?.properties?.flightId ?? "").trim();
  if (!flightId) return null;
  const activeTrajectories = ((map as any).__trajectories as Trajectory[] | undefined) ?? [];
  return activeTrajectories.find((trajectory) => trajectory.flightId === flightId) ?? null;
}

function openFlightPopup(
  map: maplibregl.Map,
  flight: Trajectory,
  x: number,
  y: number,
  setSelectedFlight: (flight: Trajectory | null) => void,
  setPopupPosition: (point: { x: number; y: number } | null) => void,
) {
  setSelectedFlight(flight);
  setPopupPosition({ x, y });
  const position = resolveFlightPointAtCurrentTime(flight, useSimStore.getState().t);
  if (position) {
    map.flyTo({
      center: position,
      zoom: Math.max(map.getZoom(), 8),
      duration: 1200,
    });
  }
}

function resolveFlightPointAtCurrentTime(
  flight: Trajectory,
  currentTime: number,
): [number, number] | null {
  const clampedTime = Math.max(currentTime, flight.t0);
  for (let index = 0; index < flight.times.length - 1; index += 1) {
    if (clampedTime < flight.times[index] || clampedTime > flight.times[index + 1]) continue;
    const t1 = flight.times[index];
    const t2 = flight.times[index + 1];
    const ratio = t2 === t1 ? 0 : (clampedTime - t1) / (t2 - t1);
    const [lon1, lat1] = flight.coords[index];
    const [lon2, lat2] = flight.coords[index + 1];
    return [lon1 + (lon2 - lon1) * ratio, lat1 + (lat2 - lat1) * ratio];
  }
  if (flight.coords.length > 0) {
    return [flight.coords[0][0], flight.coords[0][1]];
  }
  return null;
}

function setActiveAirspaceSources(
  map: maplibregl.Map,
  mode: "tv" | "es",
  tvSources: AirspaceSources,
  esSources: AirspaceSources | null,
): "tv" | "es" {
  const activeMode = mode === "es" && esSources ? "es" : "tv";
  const activeSources = activeMode === "es" && esSources ? esSources : tvSources;
  const sectorSource = map.getSource(TRAFFIC_VOLUME_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (sectorSource) {
    sectorSource.setData(activeSources.sectors);
  }
  const centroidSource = map.getSource(TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (centroidSource) {
    centroidSource.setData(activeSources.centroids);
  }
  (map as any).__sectors = activeSources.sectors;
  return activeMode;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
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
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = (Math.atan2(y, x) * 180) / Math.PI;
  return (theta + 360) % 360;
}

async function fetchAndApplySlack(
  map: maplibregl.Map,
  trafficVolumeId: string,
  refTimeStr: string,
  sign: "minus" | "plus",
  deltaMin: number,
  setIsFetching: (value: boolean) => void,
  setSlackMetaByTv: Dispatch<
    SetStateAction<Record<string, { time_window: string; slack: number; occupancy: number }>>
  >,
  showImmediately?: boolean,
): Promise<boolean> {
  if (!map || !map.isStyleLoaded()) return false;
  setIsFetching(true);
  try {
    const url = new URL("/api/slack_distribution", window.location.origin);
    url.searchParams.set("traffic_volume_id", trafficVolumeId);
    url.searchParams.set("ref_time_str", refTimeStr);
    url.searchParams.set("sign", sign);
    url.searchParams.set("tv_kind", "any");
    if (!Number.isNaN(deltaMin)) {
      url.searchParams.set("delta_min", String(deltaMin));
    }
    const response = await authFetch(url.toString());
    if (!response.ok) throw new Error(`Slack API error ${response.status}`);
    const data = await response.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const metaRecord: Record<string, { time_window: string; slack: number; occupancy: number }> = {};
    for (const result of results) {
      const tvId = String(result?.traffic_volume_id ?? "");
      const slackValue = typeof result?.slack === "number" ? result.slack : Number(result?.slack) || 0;
      if (tvId) {
        metaRecord[tvId] = {
          time_window: String(result?.time_window ?? ""),
          slack: Number(slackValue),
          occupancy: Number(result?.occupancy ?? 0),
        };
      }
    }
    setSlackMetaByTv(metaRecord);
    applySlackOverlay(map, results);
    const showTraffic = useSimStore.getState().showTrafficVolumes;
    if (showImmediately && showTraffic && map.getLayer(SLACK_LAYER_ID)) {
      map.setLayoutProperty(SLACK_LAYER_ID, "visibility", "visible");
    } else {
      hideSlackOverlay(map);
    }
    return true;
  } catch (error) {
    console.error("Failed to fetch/apply slack:", error);
    hideSlackOverlay(map);
    return false;
  } finally {
    setIsFetching(false);
  }
}

function applySlackOverlay(map: maplibregl.Map, results: any[]) {
  if (!map || !map.isStyleLoaded()) return;
  const source = map.getSource(TRAFFIC_VOLUME_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  const base = (map as any).__sectors as GeoJSON.FeatureCollection | undefined;
  if (!source || !base) return;

  const slackByTv = new Map<string, { slack: number; capacity: number }>();
  for (const result of results) {
    const tvId = String(result?.traffic_volume_id ?? "").trim();
    if (!tvId) continue;
    const slackValue = typeof result?.slack === "number" ? result.slack : Number(result?.slack);
    const capacityValue =
      typeof result?.capacity_per_bin === "number"
        ? result.capacity_per_bin
        : Number(result?.capacity_per_bin);
    slackByTv.set(tvId, {
      slack: Number.isFinite(slackValue) ? slackValue : 0,
      capacity: Number.isFinite(capacityValue) ? capacityValue : 0,
    });
  }

  const updated: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: (base.features as any[]).map((feature: any) => {
      const tvId = String(feature?.properties?.traffic_volume_id ?? "");
      const slackInfo = slackByTv.get(tvId);
      const capacity = slackInfo?.capacity ?? 0;
      const slack = slackInfo?.slack ?? 0;
      const hasData = !!slackInfo;
      const ratio = hasData && capacity > 0 ? slack / capacity : 0;
      const intensity = clamp01(Math.min(Math.abs(ratio), 1));
      const opacity = !hasData ? 0 : slack <= 0 ? 0.12 + intensity * 0.24 : 0.08 + intensity * 0.2;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          slack_value: slack,
          slack_capacity: capacity,
          slack_missing: !hasData,
          slack_hotspot: hasData ? slack <= 0 : false,
          slack_fill_opacity: opacity,
        },
      };
    }),
  } as any;

  source.setData(updated);
  (map as any).__sectors = updated;

  if (!map.getLayer(SLACK_LAYER_ID)) return;
  map.setPaintProperty(
    SLACK_LAYER_ID,
    "fill-color",
    [
      "case",
      ["boolean", ["get", "slack_missing"], true],
      "#22c55e",
      ["boolean", ["get", "slack_hotspot"], false],
      "#ef4444",
      "#22c55e",
    ] as any,
  );
  map.setPaintProperty(
    SLACK_LAYER_ID,
    "fill-opacity",
    [
      "case",
      ["boolean", ["get", "slack_missing"], true],
      0,
      ["to-number", ["coalesce", ["get", "slack_fill_opacity"], 0]],
    ] as any,
  );
}

function hideSlackOverlay(map: maplibregl.Map) {
  if (!map || !map.isStyleLoaded()) return;
  if (map.getLayer(SLACK_LAYER_ID)) {
    map.setLayoutProperty(SLACK_LAYER_ID, "visibility", "none");
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
