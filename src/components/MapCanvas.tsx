"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { loadWaypoints } from "@/lib/waypoints";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import {
  setFlightLineLabelFilters,
} from "@/lib/flightLineLabels";
import { syncFlightLevelBinPreviewLayer } from "@/lib/flightLevelBinPreviewLayer";
import { syncFlightLevelLabelLayer } from "@/lib/flightLineLabelLayer";
import { buildTrajectoryLineFeatureCollection } from "@/lib/trajectoryRender";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { SectorFeatureProps, Trajectory } from "@/lib/models";
import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import {
  getAirspaceDisplayFilter,
  getHourBin,
  getMinuteOfDay,
  normalizeCollapsedSectors,
} from "@/lib/airspaceDisplay";
import { deriveVisibleFlightLineIds } from "@/lib/flightCatcherPolicy";
import { getFlightLineVisibilitySnapshot } from "@/lib/flightVisibility";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  buildTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeHighlightList,
  applyTrafficVolumeHover,
  applyTrafficVolumeHotspots,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
  TRAFFIC_VOLUME_LAYER_IDS,
  TRAFFIC_VOLUME_SOURCE_ID,
} from "@/lib/trafficVolumeLayers";
import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";
import { formatSecondsToHHMM, formatSecondsToHHMMSS } from "@/lib/time";
import {
  getSummaryTimeBinMinutes,
  type TvDcbGlanceResponse,
  type TvDcbGlanceSummary,
} from "@/lib/tvDcbGlance";
import {
  type AirspaceSources,
  areStringArraysEqual,
  buildTvDcbGlanceCacheKey,
  buildTvDcbGlanceSourceData,
  collectVisibleTrafficVolumeIdsForGlance,
  emptyPointFC,
  ensureTrafficVolumeDcbGlanceLayer,
  setDcbGlanceSourceData,
  TV_DCB_GLANCE_DEFAULT_BIN_MINUTES,
  TV_DCB_GLANCE_LAYER_ID,
  TV_DCB_GLANCE_MIN_ZOOM,
} from "@/lib/trafficVolumeDcbGlanceMap";

const SLACK_LAYER_ID = "sector-slack";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const tvSourcesRef = useRef<AirspaceSources | null>(null);
  const csSourcesRef = useRef<AirspaceSources | null>(null);
  const csOpenRangeCountRef = useRef<number>(0);
  const lastTs = useRef<number>(performance.now());
  const {
    t,
    resourceDate,
    weatherOverlay,
    tick,
    flights,
    showFlightLineLabels,
    flightLineLabelMode,
    showCallsigns,
    showTrafficVolumes,
    airspaceDisplayMode,
    setAirspaceDisplayMode,
    setBaselineFlights,
    setSelectedTrafficVolume,
    toggleSelectedTrafficVolumeWithMode,
    setSelectedCollapsedSector,
    flLowerBound,
    flUpperBound,
    setFocusMode,
    setFocusFlightIds,
    showHotspots,
    hotspots,
    getActiveHotspots,
    flowPreviewFlightId,
    flightLinePreviewFlightIds,
    flightLevelBinPreviewSegments,
    playing,
    focusMode,
    focusFlightIds,
    showFlightLines,
    showWaypoints,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    selectedCollapsedSector,
    slackMode,
    setSlackMode,
    slackSign,
    deltaMin,
    setIsFetchingSlack,
    resourceStateEpoch,
    glanceHorizonMinutes,
  } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);
  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );

  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [slackMetaByTv, setSlackMetaByTv] = useState<Record<string, { time_window: string; slack: number; occupancy: number }>>({});
  const [hoverLabelPoint, setHoverLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);
  const [visibleGlanceTvIds, setVisibleGlanceTvIds] = useState<string[]>([]);
  const [glanceCacheVersion, setGlanceCacheVersion] = useState(0);
  const [glanceTimeBinMinutes, setGlanceTimeBinMinutes] = useState(TV_DCB_GLANCE_DEFAULT_BIN_MINUTES);
  const lastSlackKeyRef = useRef<string | null>(null);
  const glanceCacheRef = useRef<Map<string, TvDcbGlanceSummary | null>>(new Map());
  const glanceFetchSeqRef = useRef(0);
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);
  const currentMinuteOfDay = useMemo(() => getMinuteOfDay(t), [t]);
  const currentMinuteTick = useMemo(() => Math.floor(t / 60), [t]);
  const glanceReferenceBinSeconds = useMemo(() => {
    const safeBinMinutes = Math.max(1, Math.round(glanceTimeBinMinutes || TV_DCB_GLANCE_DEFAULT_BIN_MINUTES));
    const binSeconds = safeBinMinutes * 60;
    return Math.floor(Math.max(0, t) / binSeconds) * binSeconds;
  }, [glanceTimeBinMinutes, t]);
  const selectedTvIds = useMemo(
    () =>
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [],
    [selectedTrafficVolume, selectedTrafficVolumes],
  );
  const slackSourceTrafficVolumeId = airspaceDisplayMode === "tv" && selectedTvIds.length === 1
    ? selectedTvIds[0] ?? null
    : null;
  const slackEligible = !!slackSourceTrafficVolumeId;

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
    const loadGuard = createAsyncLoadGuard(
      () => mapRef.current === map && useSimStore.getState().resourceDate === resourceDate,
    );

    map.on("load", async () => {
      setBaseDataLoading(true);
      try {
        // Data
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

        // --- Airspace polygons + labels ---
        tvSourcesRef.current = addTrafficVolumeSources(map, sectors);
        if (collapsedSectorsRaw) {
          const normalizedCs = normalizeCollapsedSectors(collapsedSectorsRaw);
          csOpenRangeCountRef.current = normalizedCs.maxOpenRangeCount;
          csSourcesRef.current = buildTrafficVolumeSources(normalizedCs.collection);
        } else {
          csOpenRangeCountRef.current = 0;
          csSourcesRef.current = null;
        }
        addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });
        ensureTrafficVolumeDcbGlanceLayer(map, theme);
        if (!map.getLayer(SLACK_LAYER_ID)) {
          map.addLayer({
            id: SLACK_LAYER_ID,
            type: "fill",
            source: TRAFFIC_VOLUME_SOURCE_ID,
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#22c55e",
              "fill-opacity": 0,
            },
          }, TRAFFIC_VOLUME_LAYER_IDS.point);
        }

        applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes, { includeSlack: true });
        const sim = useSimStore.getState();
        if (sim.airspaceDisplayMode === "es" && !csSourcesRef.current) {
          console.error("Collapsed sectors are unavailable; reverting map mode to traffic volumes.");
          setAirspaceDisplayMode("tv");
        }
        const activeMode = setActiveAirspaceSources(map, sim.airspaceDisplayMode, tvSourcesRef.current, csSourcesRef.current);
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
        if (!loadGuard.isActive()) return;

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
        const planeImage = await loadImage(map, "/plane.svg");
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
            "text-size": 11
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2
          }
        });
        // Apply initial waypoint visibility based on store defaults
        try {
          const { showWaypoints } = useSimStore.getState();
          map.setLayoutProperty("wp-points", "visibility", showWaypoints ? "visible" : "none");
          map.setLayoutProperty("wp-labels", "visibility", showWaypoints ? "visible" : "none");
        } catch { }

        // Apply initial plane label visibility based on store defaults
        try {
          const { showCallsigns } = useSimStore.getState();
          map.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
          map.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
        } catch { }

        // Save trajectories on map for the animation step
        (map as any).__trajectories = activeTracks;

      // Add click handlers for flight lines
      map.on('click', 'flight-lines', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          const activeTrajectories = ((map as any).__trajectories as Trajectory[] | undefined) ?? [];
          const clickedFlight = activeTrajectories.find((trajectory) => trajectory.flightId === flightId);

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
          const activeTrajectories = ((map as any).__trajectories as Trajectory[] | undefined) ?? [];
          const clickedFlight = activeTrajectories.find((trajectory) => trajectory.flightId === flightId);

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

      const selectTrafficVolume = (trafficVolumeId: string, mode: "and" | "or") => {
        const sectorFeatures = map.querySourceFeatures('sectors', {
          filter: ['==', 'traffic_volume_id', trafficVolumeId]
        });
        const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
        const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
        toggleSelectedTrafficVolumeWithMode(trafficVolumeId, tvData, mode);
      };

      const getTrafficVolumeIdFromEvent = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features && e.features.length > 0 ? e.features[0] : null;
        const rawId = feature?.properties?.traffic_volume_id ?? feature?.properties?.label;
        return rawId != null ? String(rawId) : null;
      };

      const handleTrafficVolumeClick = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features && e.features.length > 0 ? e.features[0] : null;
        const trafficVolumeId = getTrafficVolumeIdFromEvent(e);
        if (!trafficVolumeId) return;
        const { airspaceDisplayMode } = useSimStore.getState();
        if (airspaceDisplayMode === "es") {
          const collapsedSectorData = feature
            ? { properties: (feature.properties as any) as SectorFeatureProps }
            : null;
          setSelectedCollapsedSector(trafficVolumeId, collapsedSectorData);
          return;
        }
        const mode =
          e.originalEvent && ("ctrlKey" in e.originalEvent) && (e.originalEvent.ctrlKey || e.originalEvent.metaKey)
            ? "or"
            : "and";
        selectTrafficVolume(trafficVolumeId, mode);
      };

      // Add click handlers for traffic volumes (labels + points)
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
      map.on('click', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);

      const handleTrafficVolumeHover = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const trafficVolumeId = getTrafficVolumeIdFromEvent(e);
        if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
        if (e.point && useSimStore.getState().slackMode !== 'off') {
          setHoverLabelPoint({ x: (e.point as any).x, y: (e.point as any).y });
        }
      };

      const handleTrafficVolumeHoverExit = () => {
        map.getCanvas().style.cursor = '';
        setHoveredTrafficVolume(null);
        setHoverLabelPoint(null);
      };

      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
      map.on('mouseenter', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);

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
      } catch (error) {
        console.error("Failed to load base map data", error);
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
    if (selectedFlight) {
      const nextSelectedFlight = flights.find((flight) => flight.flightId === selectedFlight.flightId) ?? null;
      setSelectedFlight(nextSelectedFlight);
    }
  }, [flights, selectedFlight]);

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
  useEffect(() => {
    updatePlanePositions(mapRef.current);
  }, [flowPreviewFlightId, flightLinePreviewFlightIds, flightLevelBinPreviewSegments]);

  // Refresh filters on focus/visibility changes
  useEffect(() => { updatePlanePositions(mapRef.current); }, [focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume, selectedCollapsedSector]);

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
      } catch {
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
    if (!mapRef.current) return;
    updatePlanePositions(mapRef.current);
  }, [flightLineLabelMode, showFlightLineLabels]);

  // on showCallsigns change, toggle plane text visibility via paint properties
  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer("plane-icons")) {
      mapRef.current.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
      mapRef.current.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
    }
  }, [showCallsigns]);

  // on showWaypoints change, toggle waypoint layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = showWaypoints ? "visible" : "none";
    if (map.getLayer("wp-points")) map.setLayoutProperty("wp-points", "visibility", visibility);
    if (map.getLayer("wp-labels")) map.setLayoutProperty("wp-labels", "visibility", visibility);
  }, [showWaypoints]);

  // Apply TV/ES map filters when FL range, time bin, or display mode changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getSource("sectors")) return;
      const filterExpression = getAirspaceDisplayFilter({
        mode: airspaceDisplayMode,
        flLowerBound,
        flUpperBound,
        currentTrafficVolumeBin,
        currentMinuteOfDay,
        csOpenRangeCount: csOpenRangeCountRef.current,
        tvCapacityRangeCount: tvSourcesRef.current?.maxCapacityRangeCount ?? 0,
      });
      applyTrafficVolumeFilters(map, filterExpression, { includeSlack: true });
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
  }, [airspaceDisplayMode, flLowerBound, flUpperBound, currentTrafficVolumeBin, currentMinuteOfDay]);

  // on traffic volume visibility change, toggle sector layers once map is ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        applyTrafficVolumeVisibility(map, showTrafficVolumes, { includeSlack: true });
        if (map.getLayer(TV_DCB_GLANCE_LAYER_ID)) {
          map.setLayoutProperty(
            TV_DCB_GLANCE_LAYER_ID,
            "visibility",
            showTrafficVolumes && airspaceDisplayMode === "tv" ? "visible" : "none",
          );
        }
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
  }, [airspaceDisplayMode, showTrafficVolumes]);

  useEffect(() => {
    glanceCacheRef.current.clear();
    glanceFetchSeqRef.current += 1;
    setGlanceCacheVersion((version) => version + 1);
    setGlanceTimeBinMinutes(TV_DCB_GLANCE_DEFAULT_BIN_MINUTES);
    setVisibleGlanceTvIds([]);
    setDcbGlanceSourceData(mapRef.current, emptyPointFC());
  }, [resourceStateEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refreshVisibleIds = () => {
      const nextIds = collectVisibleTrafficVolumeIdsForGlance(map, {
        enabled: showTrafficVolumes && airspaceDisplayMode === "tv",
        minZoom: TV_DCB_GLANCE_MIN_ZOOM,
      });
      setVisibleGlanceTvIds((current) => (areStringArraysEqual(current, nextIds) ? current : nextIds));
    };

    if (map.isStyleLoaded()) {
      refreshVisibleIds();
    } else {
      const waitForReady = () => {
        if (!map.isStyleLoaded()) return;
        try { map.off("render", waitForReady); } catch { }
        refreshVisibleIds();
      };
      map.on("render", waitForReady);
    }

    map.on("moveend", refreshVisibleIds);
    map.on("zoomend", refreshVisibleIds);
    map.on("resize", refreshVisibleIds);

    return () => {
      try { map.off("moveend", refreshVisibleIds); } catch { }
      try { map.off("zoomend", refreshVisibleIds); } catch { }
      try { map.off("resize", refreshVisibleIds); } catch { }
    };
  }, [airspaceDisplayMode, currentMinuteOfDay, currentTrafficVolumeBin, flLowerBound, flUpperBound, resourceStateEpoch, showTrafficVolumes]);

  useEffect(() => {
    if (!showTrafficVolumes || airspaceDisplayMode !== "tv" || visibleGlanceTvIds.length === 0) {
      return;
    }

    const requestRefTimeStr = formatSecondsToHHMMSS(glanceReferenceBinSeconds);
    const missingIds = visibleGlanceTvIds.filter((tvId) => {
      const cacheKey = buildTvDcbGlanceCacheKey(tvId, resourceStateEpoch, glanceReferenceBinSeconds, glanceHorizonMinutes);
      return !glanceCacheRef.current.has(cacheKey);
    });
    if (missingIds.length === 0) {
      return;
    }

    const requestSeq = ++glanceFetchSeqRef.current;

    void authFetch("/api/tv_dcb_glance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        traffic_volume_ids: missingIds,
        ref_time_str: requestRefTimeStr,
        glance_horizon_minutes: glanceHorizonMinutes,
        max_extrema_per_tv: 2,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `tv_dcb_glance failed: ${response.status}`);
        }
        return response.json() as Promise<TvDcbGlanceResponse>;
      })
      .then((payload) => {
        if (requestSeq !== glanceFetchSeqRef.current) return;

        const results = payload?.results || {};
        let nextBinMinutes = glanceTimeBinMinutes;

        for (const tvId of missingIds) {
          const cacheKey = buildTvDcbGlanceCacheKey(tvId, resourceStateEpoch, glanceReferenceBinSeconds, glanceHorizonMinutes);
          const summary = results[tvId] ?? null;
          glanceCacheRef.current.set(cacheKey, summary);
          nextBinMinutes = getSummaryTimeBinMinutes(summary, nextBinMinutes);
        }

        if (nextBinMinutes !== glanceTimeBinMinutes) {
          setGlanceTimeBinMinutes(nextBinMinutes);
        }
        setGlanceCacheVersion((version) => version + 1);
      })
      .catch((error) => {
        if (requestSeq !== glanceFetchSeqRef.current) return;
        console.error("Failed to fetch TV DCB glance summaries:", error);
      });
  }, [
    airspaceDisplayMode,
    glanceHorizonMinutes,
    glanceReferenceBinSeconds,
    glanceTimeBinMinutes,
    resourceStateEpoch,
    showTrafficVolumes,
    visibleGlanceTvIds,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showTrafficVolumes || airspaceDisplayMode !== "tv" || visibleGlanceTvIds.length === 0) {
      setDcbGlanceSourceData(map, emptyPointFC());
      return;
    }

    const nextSourceData = buildTvDcbGlanceSourceData({
      centroids: tvSourcesRef.current?.centroids,
      visibleTvIds: visibleGlanceTvIds,
      getSummary: (tvId) =>
        glanceCacheRef.current.get(
          buildTvDcbGlanceCacheKey(tvId, resourceStateEpoch, glanceReferenceBinSeconds, glanceHorizonMinutes),
        ) ?? null,
      referenceSeconds: currentMinuteTick * 60,
    });

    setDcbGlanceSourceData(map, nextSourceData);
  }, [
    airspaceDisplayMode,
    currentMinuteTick,
    glanceCacheVersion,
    glanceHorizonMinutes,
    glanceReferenceBinSeconds,
    resourceStateEpoch,
    showTrafficVolumes,
    visibleGlanceTvIds,
  ]);

  // When entering ES mode, clear TV-specific selection and focus state.
  useEffect(() => {
    if (airspaceDisplayMode !== "es") return;
    if (selectedTrafficVolume) {
      setSelectedTrafficVolume(null);
    }
    setFocusMode(false);
    setFocusFlightIds(new Set());
    setHoveredTrafficVolume(null);
  }, [airspaceDisplayMode, selectedTrafficVolume, setFocusMode, setFocusFlightIds, setSelectedTrafficVolume]);

  useEffect(() => {
    if (airspaceDisplayMode !== "tv") return;
    setSelectedCollapsedSector(null);
  }, [airspaceDisplayMode, setSelectedCollapsedSector]);

  // Swap between TV and ES datasets while keeping source IDs stable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const tvSources = tvSourcesRef.current;
      if (!tvSources) return;
      const csSources = csSourcesRef.current;
      if (airspaceDisplayMode === "es" && !csSources) {
        console.error("Collapsed sectors are unavailable; reverting map mode to traffic volumes.");
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
      try { map.off("render", waitForReady); } catch { }
      if (!cancelled) apply();
    };

    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try { map.off("render", waitForReady); } catch { }
    };
  }, [airspaceDisplayMode, setAirspaceDisplayMode]);


  // Update selected highlight layers when selected traffic volume set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlightList(map, selectedTrafficVolumes);
  }, [selectedTrafficVolumes]);

  // Update hover layer when hovered traffic volume changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHover(map, hoveredTrafficVolume);
  }, [hoveredTrafficVolume]);

  // Update hotspot layers when hotspots change, FL range changes, or time changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeHotspots = getActiveHotspots();
    const hotspotTrafficVolumeIds = activeHotspots.map(h => h.traffic_volume_id);
    applyTrafficVolumeHotspots(map, hotspotTrafficVolumeIds, flLowerBound, flUpperBound, true);
  }, [showHotspots, hotspots, flLowerBound, flUpperBound, t, getActiveHotspots]);

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

  // Listen for dialog close events to clear highlighting
  useEffect(() => {
    const handleClearHighlight = () => {
      // Persistent selection highlight is store-driven; closing the panel clears selection.
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
      const { trafficVolume, trafficVolumeId, selectionApplied } = event.detail || {};
      const map = mapRef.current;
      if (!map) return;

      // If we only received an ID, try to retrieve the feature from the map source
      let tvId: string | null = null;
      let tvGeometry: any = null;
      let fullSectorFeature: any = null;

      if (trafficVolume && trafficVolume.properties?.traffic_volume_id) {
        tvId = trafficVolume.properties.traffic_volume_id;
        tvGeometry = trafficVolume.geometry;
        fullSectorFeature = trafficVolume;
      } else if (trafficVolumeId) {
        tvId = trafficVolumeId;
        // Query the sector feature by id
        const sectorFeatures = map.querySourceFeatures('sectors', {
          filter: ['==', 'traffic_volume_id', trafficVolumeId]
        });
        if (sectorFeatures.length > 0) {
          fullSectorFeature = sectorFeatures[0];
          tvGeometry = sectorFeatures[0].geometry;
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
          sim.appendSelectedTrafficVolume(tvId, tvData);
        }
      }

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
      {slackMode !== 'off' && hoveredTrafficVolume && hoverLabelPoint && (slackMetaByTv as any)[hoveredTrafficVolume] && (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: hoverLabelPoint.x + 12, top: hoverLabelPoint.y - 12 }}
        >
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-3 py-2 shadow-lg">
            <div className="text-[10px] uppercase tracking-wide text-gray-300 mb-1">{hoveredTrafficVolume}</div>
            <div className="text-xs text-gray-200 flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Window</span>
                <span className="font-semibold text-white">{(slackMetaByTv as any)[hoveredTrafficVolume].time_window}</span>
              </div>
              <div className="w-px h-4 bg-white/20" />
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Slack</span>
                <span className="font-semibold text-emerald-300">{Number((slackMetaByTv as any)[hoveredTrafficVolume].slack).toFixed(1)}</span>
              </div>
              <div className="w-px h-4 bg-white/20" />
              <div className="flex items-baseline gap-1">
                <span className="text-gray-300">Occup.</span>
                <span className="font-semibold text-sky-300">{Number((slackMetaByTv as any)[hoveredTrafficVolume].occupancy).toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

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

function setActiveAirspaceSources(
  map: maplibregl.Map,
  mode: "tv" | "es",
  tvSources: AirspaceSources,
  esSources: AirspaceSources | null
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

  }

  const src = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(planesFC);

  const visibilitySnapshot = getFlightLineVisibilitySnapshot(
    tracks,
    sim.t,
    sim.flLowerBound,
    sim.flUpperBound
  );
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

  let filterExpr: any;
  if (hasFlightLevelBinPreview || lineIdsToShow.length === 0) {
    // Use a no-match predicate instead of a constant false expression for MapLibre filter compatibility.
    filterExpr = ["==", ["to-string", ["get", "flightId"]], "__no_match__"];
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
    const lineOpacity =
      hasFlightLevelBinPreview
        ? 0
        : sim.flowPreviewFlightId || hasFlightLinePreview
        ? 0.8
        : ((sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.1) : 0);
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

async function fetchAndApplySlack(
  map: maplibregl.Map,
  trafficVolumeId: string,
  refTimeStr: string,
  sign: "minus" | "plus",
  deltaMin: number,
  setIsFetching: (value: boolean) => void,
  setSlackMetaByTv: React.Dispatch<React.SetStateAction<Record<string, { time_window: string; slack: number; occupancy: number }>>>,
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
    const { authFetch } = await import("@/lib/auth");
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
      const opacity = !hasData
        ? 0
        : slack <= 0
          ? 0.12 + intensity * 0.24
          : 0.08 + intensity * 0.2;
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
