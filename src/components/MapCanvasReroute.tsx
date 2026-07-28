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
import { useFlowTracePreviewSync } from "@/components/useFlowTracePreviewSync";
import { SectorFeatureProps, Trajectory } from "@/lib/models";
import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import RerouteImpactResults from "@/components/RerouteImpactResults";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import {
  getAirspaceDisplayFilter,
  getHourBin,
  getMinuteOfDay,
  normalizeCollapsedSectors,
} from "@/lib/airspaceDisplay";
import { captureFlightsByRerouteCatcher } from "@/lib/rerouteCatcher";
import {
  type Point2D,
  type RerouteFunnel,
  type RerouteGeometryResult,
  type RerouteObstacle,
} from "@/lib/rerouteGeometry";
import { getFlightLineVisibilitySnapshot } from "@/lib/flightVisibility";
import {
  applyCatcherToRerouteState,
  buildFlowLineColorExpression,
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
  type FlightCatcherGateSnapshot,
} from "@/lib/flightCatcherPolicy";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  buildTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeFlowTraceWithHotspots,
  applyTrafficVolumeHighlightList,
  applyTrafficVolumeHover,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
  TRAFFIC_VOLUME_LAYER_IDS,
  TRAFFIC_VOLUME_SOURCE_ID,
} from "@/lib/trafficVolumeLayers";
import type { RerouteCommittedMove } from "@/components/useSimStore";
import {
  buildRerouteImpactScenarioSignature,
  extractRerouteImpactOverlayFeatures,
  type RerouteImpactResponse,
} from "@/lib/rerouteImpact";
import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";
import {
  getSlackSourceTrafficVolumeId,
  isSlackOverlayEligible,
  setSlackOverlayVisibility,
  SLACK_LAYER_ID,
  syncSlackOverlayVisibility,
} from "@/lib/slackOverlay";
import { formatSecondsToHHMM, formatSecondsToHHMMSS } from "@/lib/time";
import { getSummaryTimeBinMinutes, type TvDcbGlanceResponse, type TvDcbGlanceSummary } from "@/lib/tvDcbGlance";
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

const REROUTE_CATCHER_SOURCE_ID = "reroute-catcher-source";
const REROUTE_CATCHER_DRAFT_LAYER_ID = "reroute-catcher-draft";
const REROUTE_CATCHER_PREVIEW_LAYER_ID = "reroute-catcher-preview";
const REROUTE_CATCHER_POINTS_LAYER_ID = "reroute-catcher-points";
const REROUTE_SHAPES_SOURCE_ID = "reroute-shapes-source";
const REROUTE_SHAPES_DRAFT_SOURCE_ID = "reroute-shapes-draft-source";
const REROUTE_PREVIEW_SOURCE_ID = "reroute-preview-source";
const REROUTE_OBSTACLE_FILL_LAYER_ID = "reroute-obstacle-fill";
const REROUTE_OBSTACLE_OUTLINE_LAYER_ID = "reroute-obstacle-outline";
const REROUTE_FUNNEL_FILL_LAYER_ID = "reroute-funnel-fill";
const REROUTE_FUNNEL_LINE_LAYER_ID = "reroute-funnel-line";
const REROUTE_FUNNEL_POINT_LAYER_ID = "reroute-funnel-point";
const REROUTE_DRAFT_SOLID_LINE_LAYER_ID = "reroute-draft-solid-line";
const REROUTE_DRAFT_DASHED_LINE_LAYER_ID = "reroute-draft-dashed-line";
const REROUTE_DRAFT_POINT_LAYER_ID = "reroute-draft-point";
const REROUTE_PREVIEW_LAYER_ID = "reroute-preview-line";
type RenderRerouteObstacle = RerouteObstacle & { locked?: boolean };
type RenderRerouteFunnel = RerouteFunnel & { locked?: boolean };

export default function MapCanvasReroute() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const tvSourcesRef = useRef<AirspaceSources | null>(null);
  const csSourcesRef = useRef<AirspaceSources | null>(null);
  const csOpenRangeCountRef = useRef<number>(0);
  const rerouteDraftPointsRef = useRef<Array<[number, number]>>([]);
  const reroutePreviewPointRef = useRef<[number, number] | null>(null);
  const rerouteGateSnapshotRef = useRef<FlightCatcherGateSnapshot | null>(null);
  const obstacleDraftPointsRef = useRef<Point2D[]>([]);
  const obstaclePreviewPointRef = useRef<Point2D | null>(null);
  const funnelDraftAffinityPointRef = useRef<Point2D | null>(null);
  const funnelDraftSelectionPointsRef = useRef<Point2D[]>([]);
  const funnelPreviewPointRef = useRef<Point2D | null>(null);
  const lastTs = useRef<number>(performance.now());
  const {
    t,
    resourceDate,
    weatherOverlay,
    tick,
    setBaselineFlights,
    showFlightLineLabels,
    flightLineLabelMode,
    showCallsigns,
    showTrafficVolumes,
    airspaceDisplayMode,
    setAirspaceDisplayMode,
    flights,
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
    flowViewEnabled,
    flowColorByCommunity,
    flowPreviewGroupId,
    flowGroups,
    flowPreviewFlightId,
    flowTraceVolumeIds,
    flightLinePreviewFlightIds,
    flightLevelBinPreviewSegments,
    proposalPreviewActive,
    regulationPreviewActive,
    playing,
    focusMode,
    focusFlightIds,
    showFlightLines,
    showWaypoints,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    selectedCollapsedSector,
    rerouteCatcherActive,
    rerouteCatcherMode,
    rerouteShapeToolMode,
    rerouteObstacles,
    rerouteFunnels,
    rerouteCommittedMoves,
    rerouteSelectedShape,
    rerouteProgramGeometryResult,
    reroutePreviewMode,
    rerouteImpactResult,
    isRerouteImpactResultsOpen,
    rerouteImpactScenarioSignature,
    slackMode,
    setSlackMode,
    slackSign,
    deltaMin,
    setIsFetchingSlack,
    setRerouteSelectedShape,
    setRerouteImpactResult,
    setIsRerouteImpactResultsOpen,
    setRerouteImpactScenarioSignature,
    resourceStateEpoch,
    glanceHorizonMinutes,
  } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);
  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );
  useFlowTracePreviewSync();

  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
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
  const isCatcherDrawing = rerouteCatcherActive && rerouteCatcherMode !== "off";
  const isShapeDrawing = rerouteShapeToolMode !== "off";
  const isAnyDrawingActive = isCatcherDrawing || isShapeDrawing;
  const slackSourceTrafficVolumeId = getSlackSourceTrafficVolumeId({
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
  });
  const slackEligible = !!slackSourceTrafficVolumeId;
  const renderRerouteObstacles = useMemo(
    () => buildRenderableObstacles(rerouteCommittedMoves, rerouteObstacles),
    [rerouteCommittedMoves, rerouteObstacles],
  );
  const renderRerouteFunnels = useMemo(
    () => buildRenderableFunnels(rerouteCommittedMoves, rerouteFunnels),
    [rerouteCommittedMoves, rerouteFunnels],
  );
  const currentImpactScenarioSignature = useMemo(
    () => buildRerouteImpactScenarioSignature(rerouteCommittedMoves),
    [rerouteCommittedMoves],
  );

  const syncRerouteCatcherOverlay = () => {
    const map = mapRef.current;
    if (!map) return;
    updateRerouteCatcherSource(
      map,
      rerouteDraftPointsRef.current,
      reroutePreviewPointRef.current
    );
  };

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

        const sim = useSimStore.getState();
        applyTrafficVolumeVisibility(map, sim.showTrafficVolumes);
        syncSlackOverlayVisibility(map, {
          showTrafficVolumes: sim.showTrafficVolumes,
          slackEligible: isSlackOverlayEligible(sim),
          slackMode: sim.slackMode,
        });
        if (map.getLayer(TV_DCB_GLANCE_LAYER_ID)) {
          map.setLayoutProperty(
            TV_DCB_GLANCE_LAYER_ID,
            "visibility",
            useSimStore.getState().showTrafficVolumes && useSimStore.getState().airspaceDisplayMode === "tv"
              ? "visible"
              : "none",
          );
        }
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
      if (!map.getSource(REROUTE_CATCHER_SOURCE_ID)) {
        map.addSource(REROUTE_CATCHER_SOURCE_ID, {
          type: "geojson",
          data: emptyFC(),
        });
      }

      if (!map.getLayer(REROUTE_CATCHER_DRAFT_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_CATCHER_DRAFT_LAYER_ID,
          type: "line",
          source: REROUTE_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "draft"],
          paint: {
            "line-color": "#22c55e",
            "line-width": 2.5,
            "line-opacity": 0.95,
          },
        });
      }

      if (!map.getLayer(REROUTE_CATCHER_PREVIEW_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_CATCHER_PREVIEW_LAYER_ID,
          type: "line",
          source: REROUTE_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "preview"],
          paint: {
            "line-color": "#22c55e",
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.85,
          },
        });
      }

      if (!map.getLayer(REROUTE_CATCHER_POINTS_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_CATCHER_POINTS_LAYER_ID,
          type: "circle",
          source: REROUTE_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "point"],
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 3.5,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1.2,
          },
        });
      }

      applyRerouteCatcherLayerColors(map, rerouteCatcherMode);
      updateRerouteCatcherSource(map, rerouteDraftPointsRef.current, reroutePreviewPointRef.current);
      if (!map.getSource(REROUTE_SHAPES_SOURCE_ID)) {
        map.addSource(REROUTE_SHAPES_SOURCE_ID, { type: "geojson", data: emptyFC() });
      }
      if (!map.getSource(REROUTE_SHAPES_DRAFT_SOURCE_ID)) {
        map.addSource(REROUTE_SHAPES_DRAFT_SOURCE_ID, { type: "geojson", data: emptyFC() });
      }
      if (!map.getSource(REROUTE_PREVIEW_SOURCE_ID)) {
        map.addSource(REROUTE_PREVIEW_SOURCE_ID, { type: "geojson", data: emptyFC() });
      }
      if (!map.getLayer(REROUTE_OBSTACLE_FILL_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_OBSTACLE_FILL_LAYER_ID,
          type: "fill",
          source: REROUTE_SHAPES_SOURCE_ID,
          filter: ["==", ["get", "kind"], "obstacle"],
          paint: {
            "fill-color": ["case", ["==", ["get", "selected"], true], "#facc15", "#f59e0b"],
            "fill-opacity": ["case", ["==", ["get", "locked"], true], 0.08, 0.16],
          },
        });
      }
      if (!map.getLayer(REROUTE_OBSTACLE_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_OBSTACLE_OUTLINE_LAYER_ID,
          type: "line",
          source: REROUTE_SHAPES_SOURCE_ID,
          filter: ["==", ["get", "kind"], "obstacle"],
          paint: {
            "line-color": ["case", ["==", ["get", "selected"], true], "#fde68a", "#f59e0b"],
            "line-width": ["case", ["==", ["get", "selected"], true], 2.8, ["==", ["get", "locked"], true], 1.2, 1.6],
            "line-opacity": ["case", ["==", ["get", "locked"], true], 0.68, 0.95],
          },
        });
      }
      if (!map.getLayer(REROUTE_FUNNEL_FILL_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_FUNNEL_FILL_LAYER_ID,
          type: "fill",
          source: REROUTE_SHAPES_SOURCE_ID,
          filter: ["==", ["get", "kind"], "funnel-polygon"],
          paint: {
            "fill-color": ["case", ["==", ["get", "selected"], true], "#67e8f9", "#22d3ee"],
            "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.2, ["==", ["get", "locked"], true], 0.08, 0.12],
          },
        });
      }
      if (!map.getLayer(REROUTE_FUNNEL_LINE_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_FUNNEL_LINE_LAYER_ID,
          type: "line",
          source: REROUTE_SHAPES_SOURCE_ID,
          filter: ["==", ["get", "kind"], "funnel-outline"],
          paint: {
            "line-color": ["case", ["==", ["get", "selected"], true], "#67e8f9", "#22d3ee"],
            "line-width": ["case", ["==", ["get", "selected"], true], 2.8, ["==", ["get", "locked"], true], 1.4, 1.8],
            "line-opacity": ["case", ["==", ["get", "locked"], true], 0.68, 0.95],
          },
        });
      }
      if (!map.getLayer(REROUTE_FUNNEL_POINT_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_FUNNEL_POINT_LAYER_ID,
          type: "circle",
          source: REROUTE_SHAPES_SOURCE_ID,
          filter: ["==", ["get", "kind"], "funnel-affinity"],
          paint: {
            "circle-color": ["case", ["==", ["get", "selected"], true], "#67e8f9", "#22d3ee"],
            "circle-radius": ["case", ["==", ["get", "selected"], true], 5, ["==", ["get", "locked"], true], 3.2, 4],
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1.2,
          },
        });
      }
      if (!map.getLayer(REROUTE_DRAFT_SOLID_LINE_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_DRAFT_SOLID_LINE_LAYER_ID,
          type: "line",
          source: REROUTE_SHAPES_DRAFT_SOURCE_ID,
          filter: ["in", ["get", "kind"], ["literal", ["obstacle-draft", "obstacle-preview", "funnel-draft-path"]]],
          paint: {
            "line-color": "#93c5fd",
            "line-width": 2.2,
            "line-opacity": 0.95,
          },
        });
      }
      if (!map.getLayer(REROUTE_DRAFT_DASHED_LINE_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_DRAFT_DASHED_LINE_LAYER_ID,
          type: "line",
          source: REROUTE_SHAPES_DRAFT_SOURCE_ID,
          filter: ["==", ["get", "kind"], "funnel-draft-outline"],
          paint: {
            "line-color": "#93c5fd",
            "line-width": 2.2,
            "line-opacity": 0.95,
            "line-dasharray": [2, 2],
          },
        });
      }
      if (!map.getLayer(REROUTE_DRAFT_POINT_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_DRAFT_POINT_LAYER_ID,
          type: "circle",
          source: REROUTE_SHAPES_DRAFT_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 3.8,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1.2,
          },
        });
      }
      if (!map.getLayer(REROUTE_PREVIEW_LAYER_ID)) {
        map.addLayer({
          id: REROUTE_PREVIEW_LAYER_ID,
          type: "line",
          source: REROUTE_PREVIEW_SOURCE_ID,
          paint: {
            "line-color": "#2dd4bf",
            "line-width": 2.6,
            "line-opacity": 0.9,
          },
        });
      }
      applyReroutePreviewLayerStyle(map, useSimStore.getState().reroutePreviewMode);
      const initialSim = useSimStore.getState();
      updateRerouteShapeSource(
        map,
        buildRenderableObstacles(initialSim.rerouteCommittedMoves, initialSim.rerouteObstacles),
        buildRenderableFunnels(initialSim.rerouteCommittedMoves, initialSim.rerouteFunnels),
        initialSim.rerouteSelectedShape
      );
      updateRerouteShapeDraftSource(
        map,
        obstacleDraftPointsRef.current,
        obstaclePreviewPointRef.current,
        funnelDraftAffinityPointRef.current,
        funnelDraftSelectionPointsRef.current,
        funnelPreviewPointRef.current
      );
      updateReroutePreviewSource(
        map,
        initialSim.rerouteProgramGeometryResult,
        initialSim.reroutePreviewMode,
        initialSim.rerouteImpactResult,
        initialSim.isRerouteImpactResultsOpen,
      );
      const isRerouteDrawingLocked = () => {
        const sim = useSimStore.getState();
        return (sim.rerouteCatcherActive && sim.rerouteCatcherMode !== "off") || sim.rerouteShapeToolMode !== "off";
      };

      // Add click handlers for flight lines
      map.on('click', 'flight-lines', (e) => {
        if (isRerouteDrawingLocked()) return;
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
        if (isRerouteDrawingLocked()) return;
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
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'flight-lines', () => {
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        map.getCanvas().style.cursor = '';
      });

      // Change cursor to pointer when hovering over plane icons
      map.on('mouseenter', 'plane-icons', () => {
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'plane-icons', () => {
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
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
        if (isRerouteDrawingLocked()) return;
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
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
        const trafficVolumeId = getTrafficVolumeIdFromEvent(e);
        if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
      };

      const handleTrafficVolumeHoverExit = () => {
        if (isRerouteDrawingLocked()) {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        map.getCanvas().style.cursor = '';
        setHoveredTrafficVolume(null);
      };

      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
      map.on('mouseenter', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);
      const shapeSelectableLayerIds = [
        REROUTE_OBSTACLE_FILL_LAYER_ID,
        REROUTE_OBSTACLE_OUTLINE_LAYER_ID,
        REROUTE_FUNNEL_FILL_LAYER_ID,
        REROUTE_FUNNEL_LINE_LAYER_ID,
        REROUTE_FUNNEL_POINT_LAYER_ID,
      ];
      const trySelectShape = (feature: maplibregl.MapGeoJSONFeature | null | undefined) => {
        if (!feature) return false;
        const rawKind = String(feature.properties?.kind ?? "");
        const isLocked = feature.properties?.locked === true || feature.properties?.locked === "true";
        const id = String(feature.properties?.id ?? "").trim();
        if (!id || isLocked) return false;
        if (rawKind === "obstacle") {
          setRerouteSelectedShape({ kind: "obstacle", id });
          return true;
        }
        if (rawKind === "funnel-polygon" || rawKind === "funnel-outline" || rawKind === "funnel-affinity") {
          setRerouteSelectedShape({ kind: "funnel", id });
          return true;
        }
        return false;
      };
      for (const layerId of shapeSelectableLayerIds) {
        map.on("click", layerId, (event) => {
          const feature = event.features && event.features.length > 0 ? event.features[0] : null;
          trySelectShape(feature as maplibregl.MapGeoJSONFeature | null);
        });
        map.on("mouseenter", layerId, () => {
          if (isRerouteDrawingLocked()) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          if (isRerouteDrawingLocked()) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = "";
        });
      }
      const handleRerouteMapClick = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        const clickPoint: Point2D = [event.lngLat.lng, event.lngLat.lat];
        const shapeFeatures = map.queryRenderedFeatures(event.point, {
          layers: shapeSelectableLayerIds,
        });
        if (shapeFeatures.length > 0) {
          trySelectShape(shapeFeatures[0] as maplibregl.MapGeoJSONFeature);
          return;
        }
        if (sim.rerouteSelectedShape) {
          sim.setRerouteSelectedShape(null);
        }

        if (sim.rerouteShapeToolMode === "obstacle") {
          obstacleDraftPointsRef.current = [...obstacleDraftPointsRef.current, clickPoint];
          obstaclePreviewPointRef.current = clickPoint;
          updateRerouteShapeDraftSource(
            map,
            obstacleDraftPointsRef.current,
            obstaclePreviewPointRef.current,
            funnelDraftAffinityPointRef.current,
            funnelDraftSelectionPointsRef.current,
            funnelPreviewPointRef.current
          );
          return;
        }

        if (sim.rerouteShapeToolMode === "funnel") {
          if (!funnelDraftAffinityPointRef.current) {
            funnelDraftAffinityPointRef.current = clickPoint;
            funnelDraftSelectionPointsRef.current = [];
            funnelPreviewPointRef.current = null;
          } else {
            funnelDraftSelectionPointsRef.current = [...funnelDraftSelectionPointsRef.current, clickPoint];
            funnelPreviewPointRef.current = clickPoint;
          }
          updateRerouteShapeDraftSource(
            map,
            obstacleDraftPointsRef.current,
            obstaclePreviewPointRef.current,
            funnelDraftAffinityPointRef.current,
            funnelDraftSelectionPointsRef.current,
            funnelPreviewPointRef.current
          );
          return;
        }

        if (!sim.rerouteCatcherActive || sim.rerouteCatcherMode === "off") return;
        if (rerouteDraftPointsRef.current.length === 0) {
          const visibilitySnapshot = getFlightLineVisibilitySnapshot(
            tracks,
            sim.t,
            sim.flLowerBound,
            sim.flUpperBound
          );
          const visibleFlightIds = deriveVisibleFlightLineIds({
            activeInsideRangeFlightIds: visibilitySnapshot.activeInsideRangeIds,
            listDrivenEligibleFlightIds: visibilitySnapshot.listDrivenEligibleIds,
            focusMode: sim.focusMode,
            focusFlightIds: sim.focusFlightIds,
            flowPreviewFlightId: sim.flowPreviewFlightId,
            flowPreviewGroupId: sim.flowPreviewGroupId,
            flowGroups: sim.flowGroups,
            showAllFlowGroupsWhenEnabled: false,
          });
          const hasTvSelection =
            (Array.isArray(sim.selectedTrafficVolumes) && sim.selectedTrafficVolumes.length > 0) ||
            !!sim.selectedTrafficVolume;
          rerouteGateSnapshotRef.current = freezeGateSnapshot({
            createdAtSimTime: sim.t,
            contextMode: hasTvSelection ? "tv_baseline" : "visible_only",
            visibleFlightIds,
            baselineFlightIds: sim.rerouteBaseFlightIds,
          });
        }
        rerouteDraftPointsRef.current = [...rerouteDraftPointsRef.current, clickPoint];
        reroutePreviewPointRef.current = clickPoint;
        updateRerouteCatcherSource(map, rerouteDraftPointsRef.current, reroutePreviewPointRef.current);
      };

      const handleRerouteMouseMove = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        const point: Point2D = [event.lngLat.lng, event.lngLat.lat];

        if (sim.rerouteShapeToolMode === "obstacle") {
          if (obstacleDraftPointsRef.current.length === 0) return;
          obstaclePreviewPointRef.current = point;
          updateRerouteShapeDraftSource(
            map,
            obstacleDraftPointsRef.current,
            obstaclePreviewPointRef.current,
            funnelDraftAffinityPointRef.current,
            funnelDraftSelectionPointsRef.current,
            funnelPreviewPointRef.current
          );
          return;
        }

        if (sim.rerouteShapeToolMode === "funnel") {
          if (!funnelDraftAffinityPointRef.current) return;
          funnelPreviewPointRef.current = point;
          updateRerouteShapeDraftSource(
            map,
            obstacleDraftPointsRef.current,
            obstaclePreviewPointRef.current,
            funnelDraftAffinityPointRef.current,
            funnelDraftSelectionPointsRef.current,
            funnelPreviewPointRef.current
          );
          return;
        }

        if (!sim.rerouteCatcherActive || sim.rerouteCatcherMode === "off") return;
        if (rerouteDraftPointsRef.current.length === 0) return;
        reroutePreviewPointRef.current = point;
        updateRerouteCatcherSource(map, rerouteDraftPointsRef.current, reroutePreviewPointRef.current);
      };

      const handleRerouteDoubleClick = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        if (sim.rerouteShapeToolMode === "obstacle") {
          if (obstacleDraftPointsRef.current.length >= 3) {
            event.preventDefault();
            sim.addRerouteObstacle(obstacleDraftPointsRef.current);
            obstacleDraftPointsRef.current = [];
            obstaclePreviewPointRef.current = null;
            updateRerouteShapeDraftSource(
              map,
              obstacleDraftPointsRef.current,
              obstaclePreviewPointRef.current,
              funnelDraftAffinityPointRef.current,
              funnelDraftSelectionPointsRef.current,
              funnelPreviewPointRef.current
            );
          }
          return;
        }
        if (sim.rerouteShapeToolMode === "funnel") {
          if (funnelDraftAffinityPointRef.current && funnelDraftSelectionPointsRef.current.length >= 3) {
            event.preventDefault();
            sim.addRerouteFunnel(
              funnelDraftAffinityPointRef.current,
              funnelDraftSelectionPointsRef.current
            );
            funnelDraftAffinityPointRef.current = null;
            funnelDraftSelectionPointsRef.current = [];
            funnelPreviewPointRef.current = null;
            updateRerouteShapeDraftSource(
              map,
              obstacleDraftPointsRef.current,
              obstaclePreviewPointRef.current,
              funnelDraftAffinityPointRef.current,
              funnelDraftSelectionPointsRef.current,
              funnelPreviewPointRef.current
            );
          }
          return;
        }
        if (!sim.rerouteCatcherActive || sim.rerouteCatcherMode === "off") return;
        if (rerouteDraftPointsRef.current.length < 2) return;

        event.preventDefault();

        const hasTvSelection =
          (Array.isArray(sim.selectedTrafficVolumes) && sim.selectedTrafficVolumes.length > 0) ||
          !!sim.selectedTrafficVolume;
        const gateSnapshot =
          rerouteGateSnapshotRef.current ??
          freezeGateSnapshot({
            createdAtSimTime: sim.t,
            contextMode: hasTvSelection ? "tv_baseline" : "visible_only",
            visibleFlightIds: (() => {
              const visibilitySnapshot = getFlightLineVisibilitySnapshot(
                tracks,
                sim.t,
                sim.flLowerBound,
                sim.flUpperBound
              );
              return deriveVisibleFlightLineIds({
                activeInsideRangeFlightIds: visibilitySnapshot.activeInsideRangeIds,
                listDrivenEligibleFlightIds: visibilitySnapshot.listDrivenEligibleIds,
                focusMode: sim.focusMode,
                focusFlightIds: sim.focusFlightIds,
                flowPreviewFlightId: sim.flowPreviewFlightId,
                flowPreviewGroupId: sim.flowPreviewGroupId,
                flowGroups: sim.flowGroups,
                showAllFlowGroupsWhenEnabled: false,
              });
            })(),
            baselineFlightIds: sim.rerouteBaseFlightIds,
          });

        const result = captureFlightsByRerouteCatcher({
          trajectories: tracks,
          catcherPolyline: rerouteDraftPointsRef.current,
          timeframe: sim.rerouteCatcherTimeframe,
          currentTimeSeconds: gateSnapshot.createdAtSimTime,
        });
        const filtered = filterCapturedToGate(result.flightIds, gateSnapshot);
        if (filtered.length > 0) {
          const next = applyCatcherToRerouteState({
            contextMode: gateSnapshot.contextMode,
            currentBaseFlightIds: sim.rerouteBaseFlightIds,
            currentSelectedFlightIds: sim.rerouteBaseSelectedFlightIds,
            capturedFlightIds: filtered,
            catcherMode: sim.rerouteCatcherMode,
          });
          if (!areStringArraysEqual(sim.rerouteBaseFlightIds, next.nextBaseFlightIds)) {
            sim.setRerouteBaseFlightIds(next.nextBaseFlightIds, "catcher");
          }
          sim.setRerouteBaseSelectedFlightIds(next.nextSelectedFlightIds);
        }

        rerouteGateSnapshotRef.current = null;
        rerouteDraftPointsRef.current = [];
        reroutePreviewPointRef.current = null;
        updateRerouteCatcherSource(map, rerouteDraftPointsRef.current, reroutePreviewPointRef.current);
      };

      map.on("click", handleRerouteMapClick);
      map.on("mousemove", handleRerouteMouseMove);
        map.on("dblclick", handleRerouteDoubleClick);

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
        console.error("Failed to load reroute map data", error);
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

  // When a single-flight/group preview is toggled, update filters immediately
  useEffect(() => {
    updatePlanePositions(mapRef.current);
  }, [flowViewEnabled, flowColorByCommunity, flowPreviewFlightId, flowPreviewGroupId, flowGroups, flightLinePreviewFlightIds, flightLevelBinPreviewSegments, proposalPreviewActive, regulationPreviewActive]);

  // Refresh filters on focus/visibility changes
  useEffect(() => { updatePlanePositions(mapRef.current); }, [focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume, selectedCollapsedSector]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateRerouteShapeSource(map, renderRerouteObstacles, renderRerouteFunnels, rerouteSelectedShape);
  }, [renderRerouteFunnels, renderRerouteObstacles, rerouteSelectedShape]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyReroutePreviewLayerStyle(map, reroutePreviewMode);
    updateReroutePreviewSource(
      map,
      rerouteProgramGeometryResult,
      reroutePreviewMode,
      rerouteImpactResult,
      isRerouteImpactResultsOpen,
    );
  }, [
    isRerouteImpactResultsOpen,
    rerouteImpactResult,
    rerouteProgramGeometryResult,
    reroutePreviewMode,
  ]);

  useEffect(() => {
    if (!isRerouteImpactResultsOpen || !rerouteImpactResult) return;
    if (rerouteImpactScenarioSignature === currentImpactScenarioSignature) return;
    setIsRerouteImpactResultsOpen(false);
    setRerouteImpactResult(null);
    setRerouteImpactScenarioSignature(null);
  }, [
    currentImpactScenarioSignature,
    isRerouteImpactResultsOpen,
    rerouteImpactResult,
    rerouteImpactScenarioSignature,
    setIsRerouteImpactResultsOpen,
    setRerouteImpactResult,
    setRerouteImpactScenarioSignature,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyRerouteCatcherLayerColors(map, rerouteCatcherMode);
    syncRerouteCatcherOverlay();
  }, [rerouteCatcherMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isAnyDrawingActive) {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = "crosshair";
      return;
    }

    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = "";
    rerouteGateSnapshotRef.current = null;
    rerouteDraftPointsRef.current = [];
    reroutePreviewPointRef.current = null;
    obstacleDraftPointsRef.current = [];
    obstaclePreviewPointRef.current = null;
    funnelDraftAffinityPointRef.current = null;
    funnelDraftSelectionPointsRef.current = [];
    funnelPreviewPointRef.current = null;
    syncRerouteCatcherOverlay();
    const sim = useSimStore.getState();
    updateRerouteShapeSource(
      map,
      buildRenderableObstacles(sim.rerouteCommittedMoves, sim.rerouteObstacles),
      buildRenderableFunnels(sim.rerouteCommittedMoves, sim.rerouteFunnels),
      sim.rerouteSelectedShape,
    );
    updateRerouteShapeDraftSource(
      map,
      obstacleDraftPointsRef.current,
      obstaclePreviewPointRef.current,
      funnelDraftAffinityPointRef.current,
      funnelDraftSelectionPointsRef.current,
      funnelPreviewPointRef.current
    );
  }, [isAnyDrawingActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (rerouteShapeToolMode !== "obstacle") {
      obstacleDraftPointsRef.current = [];
      obstaclePreviewPointRef.current = null;
    }
    if (rerouteShapeToolMode !== "funnel") {
      funnelDraftAffinityPointRef.current = null;
      funnelDraftSelectionPointsRef.current = [];
      funnelPreviewPointRef.current = null;
    }
    updateRerouteShapeDraftSource(
      map,
      obstacleDraftPointsRef.current,
      obstaclePreviewPointRef.current,
      funnelDraftAffinityPointRef.current,
      funnelDraftSelectionPointsRef.current,
      funnelPreviewPointRef.current
    );
  }, [rerouteShapeToolMode]);

  useEffect(() => {
    if (!isAnyDrawingActive && !rerouteSelectedShape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const sim = useSimStore.getState();
      const map = mapRef.current;

      if (event.key === "Escape") {
        if (sim.rerouteShapeToolMode === "obstacle" && obstacleDraftPointsRef.current.length > 0) {
          event.preventDefault();
          obstacleDraftPointsRef.current = [];
          obstaclePreviewPointRef.current = null;
          if (map) {
            updateRerouteShapeDraftSource(
              map,
              obstacleDraftPointsRef.current,
              obstaclePreviewPointRef.current,
              funnelDraftAffinityPointRef.current,
              funnelDraftSelectionPointsRef.current,
              funnelPreviewPointRef.current
            );
          }
          return;
        }
        if (
          sim.rerouteShapeToolMode === "funnel" &&
          (funnelDraftAffinityPointRef.current || funnelDraftSelectionPointsRef.current.length > 0)
        ) {
          event.preventDefault();
          funnelDraftAffinityPointRef.current = null;
          funnelDraftSelectionPointsRef.current = [];
          funnelPreviewPointRef.current = null;
          if (map) {
            updateRerouteShapeDraftSource(
              map,
              obstacleDraftPointsRef.current,
              obstaclePreviewPointRef.current,
              funnelDraftAffinityPointRef.current,
              funnelDraftSelectionPointsRef.current,
              funnelPreviewPointRef.current
            );
          }
          return;
        }
        if (sim.rerouteShapeToolMode !== "off") {
          event.preventDefault();
          sim.setRerouteShapeToolMode("off");
          return;
        }
        if (sim.rerouteCatcherActive) {
          event.preventDefault();
          rerouteGateSnapshotRef.current = null;
          rerouteDraftPointsRef.current = [];
          reroutePreviewPointRef.current = null;
          sim.cancelRerouteCatcher();
          if (map) {
            updateRerouteCatcherSource(map, rerouteDraftPointsRef.current, reroutePreviewPointRef.current);
          }
          return;
        }
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !isKeyboardTargetEditable(event.target)) {
        if (!sim.rerouteSelectedShape) return;
        event.preventDefault();
        sim.removeRerouteSelectedShape();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isAnyDrawingActive, rerouteSelectedShape]);

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
        applyTrafficVolumeVisibility(map, showTrafficVolumes);
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

  // Update flow trace + hotspot layers when hotspots/time/FL range changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeHotspots = getActiveHotspots();
    applyTrafficVolumeFlowTraceWithHotspots(map, {
      activeHotspots,
      flowTraceVolumeIds,
      flLowerBound,
      flUpperBound,
      includeFlRange: true,
    });
  }, [showHotspots, hotspots, flLowerBound, flUpperBound, t, getActiveHotspots, flowTraceVolumeIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (slackEligible) return;
    hideSlackOverlay(map);
    lastSlackKeyRef.current = null;
    if (slackMode !== "off") {
      setSlackMode("off");
    }
  }, [slackEligible, slackMode, setSlackMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncSlackOverlayVisibility(map, {
      showTrafficVolumes,
      slackEligible,
      slackMode,
    });
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
      <RerouteImpactResults
        open={isRerouteImpactResultsOpen}
        result={rerouteImpactResult}
        onClose={() => {
          setIsRerouteImpactResultsOpen(false);
          setRerouteImpactResult(null);
          setRerouteImpactScenarioSignature(null);
        }}
      />

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

function updateRerouteCatcherSource(
  map: maplibregl.Map,
  draftPoints: Array<[number, number]>,
  previewPoint: [number, number] | null,
) {
  const source = map.getSource(REROUTE_CATCHER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: GeoJSON.Feature[] = [];
  const validDraft = draftPoints.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));

  if (validDraft.length >= 2) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: validDraft,
      },
      properties: { kind: "draft" },
    });
  }

  if (validDraft.length >= 1 && previewPoint && Number.isFinite(previewPoint[0]) && Number.isFinite(previewPoint[1])) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [...validDraft, previewPoint],
      },
      properties: { kind: "preview" },
    });
  }

  for (const point of validDraft) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: point,
      },
      properties: { kind: "point" },
    });
  }

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function applyRerouteCatcherLayerColors(
  map: maplibregl.Map,
  mode: "off" | "include" | "exclude"
) {
  const color = mode === "exclude" ? "#fb7185" : "#22c55e";
  if (map.getLayer(REROUTE_CATCHER_DRAFT_LAYER_ID)) {
    map.setPaintProperty(REROUTE_CATCHER_DRAFT_LAYER_ID, "line-color", color);
  }
  if (map.getLayer(REROUTE_CATCHER_PREVIEW_LAYER_ID)) {
    map.setPaintProperty(REROUTE_CATCHER_PREVIEW_LAYER_ID, "line-color", color);
  }
}

function buildRenderableObstacles(
  committedMoves: RerouteCommittedMove[],
  draftObstacles: RerouteObstacle[],
): RenderRerouteObstacle[] {
  const committed = (committedMoves || []).flatMap((move) =>
    (move.obstacles || []).map((obstacle) => ({
      ...obstacle,
      locked: true,
    })),
  );
  const draft = (draftObstacles || []).map((obstacle) => ({
    ...obstacle,
    locked: false,
  }));
  return [...committed, ...draft];
}

function buildRenderableFunnels(
  committedMoves: RerouteCommittedMove[],
  draftFunnels: RerouteFunnel[],
): RenderRerouteFunnel[] {
  const committed = (committedMoves || []).flatMap((move) =>
    (move.funnels || []).map((funnel) => ({
      ...funnel,
      locked: true,
    })),
  );
  const draft = (draftFunnels || []).map((funnel) => ({
    ...funnel,
    locked: false,
  }));
  return [...committed, ...draft];
}

function updateRerouteShapeSource(
  map: maplibregl.Map,
  obstacles: RenderRerouteObstacle[],
  funnels: RenderRerouteFunnel[],
  selectedShape: { kind: "obstacle" | "funnel"; id: string } | null,
) {
  const source = map.getSource(REROUTE_SHAPES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: GeoJSON.Feature[] = [];

  for (const obstacle of obstacles || []) {
    const vertices = (obstacle.vertices || []).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (vertices.length < 3) continue;
    const ring = closeRing(vertices);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        kind: "obstacle",
        id: obstacle.id,
        selected: selectedShape?.kind === "obstacle" && selectedShape.id === obstacle.id,
        locked: obstacle.locked === true,
      },
    });
  }

  for (const funnel of funnels || []) {
    if (
      !Array.isArray(funnel.affinityPoint) ||
      !Number.isFinite(funnel.affinityPoint[0]) ||
      !Number.isFinite(funnel.affinityPoint[1])
    ) {
      continue;
    }
    const polygonCoords = buildFunnelPolygonCoordinates(funnel.selectionPolyline);
    if (polygonCoords.length < 4) continue;
    const isSelected = selectedShape?.kind === "funnel" && selectedShape.id === funnel.id;

    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [polygonCoords] },
      properties: {
        kind: "funnel-polygon",
        id: funnel.id,
        selected: isSelected,
        locked: funnel.locked === true,
      },
    });
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: polygonCoords },
      properties: {
        kind: "funnel-outline",
        id: funnel.id,
        selected: isSelected,
        locked: funnel.locked === true,
      },
    });
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: funnel.affinityPoint },
      properties: {
        kind: "funnel-affinity",
        id: funnel.id,
        selected: isSelected,
        locked: funnel.locked === true,
      },
    });
  }

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function updateRerouteShapeDraftSource(
  map: maplibregl.Map,
  obstacleDraftPoints: Point2D[],
  obstaclePreviewPoint: Point2D | null,
  funnelDraftAffinityPoint: Point2D | null,
  funnelDraftSelectionPoints: Point2D[],
  funnelPreviewPoint: Point2D | null,
) {
  const source = map.getSource(REROUTE_SHAPES_DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: GeoJSON.Feature[] = [];
  const validObstaclePoints = (obstacleDraftPoints || []).filter(
    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );

  if (validObstaclePoints.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: validObstaclePoints },
      properties: { kind: "obstacle-draft" },
    });
  }

  if (
    validObstaclePoints.length >= 1 &&
    obstaclePreviewPoint &&
    Number.isFinite(obstaclePreviewPoint[0]) &&
    Number.isFinite(obstaclePreviewPoint[1])
  ) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [...validObstaclePoints, obstaclePreviewPoint] },
      properties: { kind: "obstacle-preview" },
    });
  }

  for (const point of validObstaclePoints) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: point },
      properties: { kind: "obstacle-draft-point" },
    });
  }

  if (
    funnelDraftAffinityPoint &&
    Number.isFinite(funnelDraftAffinityPoint[0]) &&
    Number.isFinite(funnelDraftAffinityPoint[1])
  ) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: funnelDraftAffinityPoint },
      properties: { kind: "funnel-draft-affinity-point" },
    });
  }

  const validSelectionPoints = (funnelDraftSelectionPoints || []).filter(
    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  for (const point of validSelectionPoints) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: point },
      properties: { kind: "funnel-draft-selection-point" },
    });
  }

  const hasPreviewPoint =
    !!funnelPreviewPoint &&
    Number.isFinite(funnelPreviewPoint[0]) &&
    Number.isFinite(funnelPreviewPoint[1]);
  if (hasPreviewPoint) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: funnelPreviewPoint as Point2D },
      properties: { kind: "funnel-draft-preview-point" },
    });
  }

  if (funnelDraftAffinityPoint) {
    const draftPath = hasPreviewPoint
      ? [...validSelectionPoints, funnelPreviewPoint as Point2D]
      : validSelectionPoints;

    if (draftPath.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: draftPath },
        properties: { kind: "funnel-draft-path" },
      });
    }

    if (draftPath.length >= 3) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: buildFunnelPolygonCoordinates(draftPath),
        },
        properties: { kind: "funnel-draft-outline" },
      });
    }
  }

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function updateReroutePreviewSource(
  map: maplibregl.Map,
  result: RerouteGeometryResult | null,
  previewMode: "current" | "rerouted",
  rerouteImpactResult: RerouteImpactResponse | null,
  isRerouteImpactResultsOpen: boolean,
) {
  const source = map.getSource(REROUTE_PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: GeoJSON.Feature[] =
    previewMode === "rerouted" && isRerouteImpactResultsOpen && rerouteImpactResult
      ? extractRerouteImpactOverlayFeatures(rerouteImpactResult)
      : buildReroutePreviewFeatures(result, previewMode);

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function buildReroutePreviewFeatures(
  result: RerouteGeometryResult | null,
  previewMode: "current" | "rerouted",
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const flight of result?.flights || []) {
    const path = previewMode === "current" ? flight.originalPath : flight.reroutedPath;
    const coordinates = (path || []).filter(
      (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    );
    if (coordinates.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        flightId: flight.flightId,
        previewMode,
      },
    });
  }
  return features;
}

function applyReroutePreviewLayerStyle(
  map: maplibregl.Map,
  mode: "current" | "rerouted",
) {
  if (!map.getLayer(REROUTE_PREVIEW_LAYER_ID)) return;
  map.setPaintProperty(REROUTE_PREVIEW_LAYER_ID, "line-color", mode === "rerouted" ? "#2dd4bf" : "#f59e0b");
  map.setPaintProperty(REROUTE_PREVIEW_LAYER_ID, "line-width", mode === "rerouted" ? 2.6 : 2.3);
  map.setPaintProperty(REROUTE_PREVIEW_LAYER_ID, "line-opacity", mode === "rerouted" ? 0.9 : 0.84);
}

async function fetchAndApplySlack(
  map: maplibregl.Map,
  trafficVolumeId: string,
  refTimeStr: string,
  sign: "minus" | "plus",
  deltaMin: number,
  setIsFetching: (value: boolean) => void,
): Promise<boolean> {
  if (!map.isStyleLoaded()) return false;
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
    if (!response.ok) {
      throw new Error(`Slack API error ${response.status}`);
    }
    const data = await response.json();
    applySlackOverlay(map, Array.isArray(data?.results) ? data.results : []);
    const sim = useSimStore.getState();
    syncSlackOverlayVisibility(map, {
      showTrafficVolumes: sim.showTrafficVolumes,
      slackEligible: isSlackOverlayEligible(sim),
      slackMode: sim.slackMode,
    });
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
  if (!map.isStyleLoaded()) return;
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
    features: (base.features as GeoJSON.Feature[]).map((feature) => {
      const tvId = String((feature.properties as Record<string, unknown> | undefined)?.traffic_volume_id ?? "");
      const slackInfo = slackByTv.get(tvId);
      const capacity = slackInfo?.capacity ?? 0;
      const slack = slackInfo?.slack ?? 0;
      const hasData = !!slackInfo;
      const ratio = hasData && capacity > 0 ? slack / capacity : 0;
      const intensity = hasData
        ? clamp01(Math.min(Math.abs(ratio), 1))
        : 0;
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
  };

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
  setSlackOverlayVisibility(map, false);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function closeRing(vertices: Point2D[]): Point2D[] {
  if (vertices.length === 0) return [];
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) {
    return vertices;
  }
  return [...vertices, first];
}

function buildFunnelPolygonCoordinates(selectionPolyline: Point2D[]): Point2D[] {
  const vertices = (selectionPolyline || []).filter(
    (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (vertices.length < 3) return [];
  return closeRing(vertices);
}

function isKeyboardTargetEditable(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (target.isContentEditable) return true;
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

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

  // Filter flight line + label layers
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
    flowPreviewGroupId: sim.flowPreviewGroupId,
    flowGroups: sim.flowGroups,
    showAllFlowGroupsWhenEnabled: false,
  });
  const hasFlightLevelBinPreview = sim.flightLevelBinPreviewSegments.length > 0;

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
      !!sim.flowPreviewGroupId ||
      sim.flightLinePreviewFlightIds.size > 0;
    const lineOpacity =
      hasFlightLevelBinPreview
        ? 0
        : sim.flowPreviewFlightId || sim.flowPreviewGroupId || sim.flightLinePreviewFlightIds.size > 0
        ? 0.8
        : ((sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.1) : 0);
    const prevOpacity = (map as any).__prevLineOpacity;
    if (prevOpacity !== lineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
      (map as any).__prevLineOpacity = lineOpacity;
    }
    map.setPaintProperty("flight-lines", "line-color", buildFlowLineColorExpression({
      flowViewEnabled: sim.flowViewEnabled,
      flowPreviewGroupId: sim.flowPreviewGroupId,
      flowGroups: sim.flowGroups,
      flowColorByCommunity: sim.flowColorByCommunity,
      proposalPreviewActive: sim.proposalPreviewActive,
      regulationPreviewActive: sim.regulationPreviewActive,
    }) as any);
  }

  syncFlightLevelBinPreviewLayer({
    map,
    segments: sim.flightLevelBinPreviewSegments,
    showFlightLineLabels: sim.showFlightLineLabels,
    flightLineLabelMode: sim.flightLineLabelMode,
  });
}
