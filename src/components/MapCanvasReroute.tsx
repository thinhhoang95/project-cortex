"use client";
import maplibregl, { FilterSpecification, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { loadWaypoints } from "@/lib/waypoints";
import {
  AIRSPACE_GEOJSON_PATH,
  COLLAPSED_SECTORS_GEOJSON_PATH,
  FLIGHTS_CSV_PATH,
} from "@/lib/dataPaths";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { SectorFeatureProps, Trajectory } from "@/lib/models";
import FlightDetailsPopup from "@/components/FlightDetailsPopup";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import { getHourBin, getTrafficVolumeFilter, getTrafficVolumeFlIntersectionFilter } from "@/lib/mapUtils";
import { captureFlightsByRerouteCatcher } from "@/lib/rerouteCatcher";
import {
  type Point2D,
  type RerouteFunnel,
  type RerouteGeometryResult,
  type RerouteObstacle,
} from "@/lib/rerouteGeometry";
import { getCurrentActiveFlightIdsInFlRange } from "@/lib/flightVisibility";
import {
  applyCatcherToRerouteState,
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
import type { RerouteCommittedMove } from "@/components/useSimStore";

type AirspaceSources = {
  sectors: GeoJSON.FeatureCollection;
  centroids: GeoJSON.FeatureCollection;
};

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
    date,
    weatherOverlay,
    tick,
    setRange,
    showFlightLineLabels,
    showCallsigns,
    showTrafficVolumes,
    airspaceDisplayMode,
    setAirspaceDisplayMode,
    flights,
    setFlights,
    setSelectedTrafficVolume,
    toggleSelectedTrafficVolume,
    setSelectedCollapsedSector,
    flLowerBound,
    flUpperBound,
    setFocusMode,
    setFocusFlightIds,
    showHotspots,
    hotspots,
    getActiveHotspots,
    flowPreviewGroupId,
    flowGroups,
    flowPreviewFlightId,
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
    setRerouteSelectedShape,
  } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);

  const [selectedFlight, setSelectedFlight] = useState<Trajectory | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);
  const currentMinuteOfDay = useMemo(() => getMinuteOfDay(t), [t]);
  const isCatcherDrawing = rerouteCatcherActive && rerouteCatcherMode !== "off";
  const isShapeDrawing = rerouteShapeToolMode !== "off";
  const isAnyDrawingActive = isCatcherDrawing || isShapeDrawing;
  const renderRerouteObstacles = useMemo(
    () => buildRenderableObstacles(rerouteCommittedMoves, rerouteObstacles),
    [rerouteCommittedMoves, rerouteObstacles],
  );
  const renderRerouteFunnels = useMemo(
    () => buildRenderableFunnels(rerouteCommittedMoves, rerouteFunnels),
    [rerouteCommittedMoves, rerouteFunnels],
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
      const [sectors, tracks, collapsedSectorsRaw] = await Promise.all([
        loadSectors(AIRSPACE_GEOJSON_PATH),
        loadTrajectories(FLIGHTS_CSV_PATH),
        loadSectors(COLLAPSED_SECTORS_GEOJSON_PATH).catch((error) => {
          console.error("Failed to preload collapsed sectors:", error);
          return null;
        }),
      ]);

      // Store flights in global store and compute global time range
      setFlights(tracks);
      const minT = Math.min(...tracks.map((track: any) => track.t0));
      const maxT = Math.max(...tracks.map((track: any) => track.t1));
      setRange([minT, maxT], minT);

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

      applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);
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
      });
      applyTrafficVolumeFilters(map, initialFilter);

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
            geometry: { type: "LineString", coordinates: tr.coords.map((c: any) => [c[0], c[1]]) },
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
      (map as any).__trajectories = tracks;
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
        initialSim.reroutePreviewMode
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
        if (isRerouteDrawingLocked()) return;
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

      const selectTrafficVolume = (trafficVolumeId: string) => {
        const sectorFeatures = map.querySourceFeatures('sectors', {
          filter: ['==', 'traffic_volume_id', trafficVolumeId]
        });
        const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
        const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
        toggleSelectedTrafficVolume(trafficVolumeId, tvData);
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
        selectTrafficVolume(trafficVolumeId);
      };

      // Add click handlers for traffic volumes (labels + points)
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
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
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
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
          const insideRangeActiveSet = getCurrentActiveFlightIdsInFlRange(
            tracks,
            sim.t,
            sim.flLowerBound,
            sim.flUpperBound
          );
          const visibleFlightIds = deriveVisibleFlightLineIds({
            insideRangeActiveFlightIds: insideRangeActiveSet,
            focusMode: sim.focusMode,
            focusFlightIds: sim.focusFlightIds,
            flowPreviewFlightId: sim.flowPreviewFlightId,
            flowPreviewGroupId: sim.flowPreviewGroupId,
            flowCommunities: sim.flowCommunities,
            flowGroups: sim.flowGroups,
            showAllFlowCommunitiesWhenEnabled: false,
            clampToActiveSet: false,
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
            visibleFlightIds: deriveVisibleFlightLineIds({
              insideRangeActiveFlightIds: getCurrentActiveFlightIdsInFlRange(
                tracks,
                sim.t,
                sim.flLowerBound,
                sim.flUpperBound
              ),
              focusMode: sim.focusMode,
              focusFlightIds: sim.focusFlightIds,
              flowPreviewFlightId: sim.flowPreviewFlightId,
              flowPreviewGroupId: sim.flowPreviewGroupId,
              flowCommunities: sim.flowCommunities,
              flowGroups: sim.flowGroups,
              showAllFlowCommunitiesWhenEnabled: false,
              clampToActiveSet: false,
            }),
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

  // When a single-flight/group preview is toggled, update filters immediately
  useEffect(() => { updatePlanePositions(mapRef.current); }, [flowPreviewFlightId, flowPreviewGroupId, flowGroups]);

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

    const targetHour = isoHourFrom(date, t);

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
    updateReroutePreviewSource(map, rerouteProgramGeometryResult, reroutePreviewMode);
  }, [rerouteProgramGeometryResult, reroutePreviewMode]);

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

type OpenTimeRange = {
  startMinute: number;
  endMinute: number;
};

type NormalizedCollapsedSectors = {
  collection: GeoJSON.FeatureCollection;
  maxOpenRangeCount: number;
};

type AirspaceFilterParams = {
  mode: "tv" | "es";
  flLowerBound: number;
  flUpperBound: number;
  currentTrafficVolumeBin: string;
  currentMinuteOfDay: number;
  csOpenRangeCount: number;
};

function normalizeCollapsedSectors(collection: GeoJSON.FeatureCollection): NormalizedCollapsedSectors {
  const rawFeatures = (collection.features || []).filter((feature) => feature?.geometry != null);
  const parsedRangesByFeature = rawFeatures.map((feature) => {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    return parseOpenTimeRanges(properties.open_times);
  });
  const maxOpenRangeCount = parsedRangesByFeature.reduce((max, ranges) => Math.max(max, ranges.length), 0);

  const features = rawFeatures.map((feature, index) => {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const collapsedSectorId = String(properties.collapsed_sector ?? "").trim();
    const id = collapsedSectorId || `CS_${String(index + 1).padStart(4, "0")}`;
    const openRanges = parsedRangesByFeature[index] || [];
    const openRangeProps: Record<string, number> = {
      open_range_count: openRanges.length,
    };
    for (let i = 0; i < maxOpenRangeCount; i += 1) {
      const range = openRanges[i];
      openRangeProps[`open_start_min_${i}`] = range ? range.startMinute : -1;
      openRangeProps[`open_end_min_${i}`] = range ? range.endMinute : -1;
    }
    return {
      ...feature,
      properties: {
        ...properties,
        traffic_volume_id: id,
        label: properties.label != null ? String(properties.label) : id,
        ...openRangeProps,
      },
    };
  });

  return {
    collection: { ...collection, features },
    maxOpenRangeCount,
  };
}

function parseOpenTimeRanges(value: unknown): OpenTimeRange[] {
  if (!Array.isArray(value)) return [];
  const ranges: OpenTimeRange[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    const [startRaw, endRaw] = trimmed.split("-");
    const startMinute = parseHhMmToMinute(startRaw);
    const endMinute = parseHhMmToMinute(endRaw);
    if (startMinute == null || endMinute == null) continue;
    ranges.push({ startMinute, endMinute });
  }
  return ranges;
}

function parseHhMmToMinute(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getMinuteOfDay(seconds: number): number {
  const secondsInDay = 24 * 3600;
  const wholeSeconds = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  const normalized = ((wholeSeconds % secondsInDay) + secondsInDay) % secondsInDay;
  return Math.floor(normalized / 60);
}

function getAirspaceDisplayFilter({
  mode,
  flLowerBound,
  flUpperBound,
  currentTrafficVolumeBin,
  currentMinuteOfDay,
  csOpenRangeCount,
}: AirspaceFilterParams): FilterSpecification {
  if (mode === "tv") {
    return getTrafficVolumeFilter(flLowerBound, flUpperBound, currentTrafficVolumeBin);
  }

  const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
  const openNowFilter = buildCollapsedSectorOpenNowFilter(currentMinuteOfDay, csOpenRangeCount);
  return ["all", flFilter, openNowFilter] as FilterSpecification;
}

function buildCollapsedSectorOpenNowFilter(currentMinuteOfDay: number, maxOpenRangeCount: number): FilterSpecification {
  if (maxOpenRangeCount <= 0) {
    return ["==", 1, 1] as FilterSpecification;
  }
  const current = Math.max(0, Math.min(1439, Math.floor(currentMinuteOfDay)));
  const conditions: FilterSpecification[] = [];
  for (let i = 0; i < maxOpenRangeCount; i += 1) {
    const startExpr = ["to-number", ["get", `open_start_min_${i}`], -1];
    const endExpr = ["to-number", ["get", `open_end_min_${i}`], -1];
    const inNonWrapRange: FilterSpecification = [
      "all",
      ["<=", startExpr, endExpr],
      [">=", current, startExpr],
      ["<=", current, endExpr],
    ] as unknown as FilterSpecification;
    const inWrapRange: FilterSpecification = [
      "all",
      [">", startExpr, endExpr],
      ["any", [">=", current, startExpr], ["<=", current, endExpr]],
    ] as unknown as FilterSpecification;
    conditions.push([
      "all",
      [">=", startExpr, 0],
      [">=", endExpr, 0],
      ["any", inNonWrapRange, inWrapRange],
    ] as unknown as FilterSpecification);
  }
  return ["any", ...conditions] as FilterSpecification;
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
) {
  const source = map.getSource(REROUTE_PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

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

  source.setData({
    type: "FeatureCollection",
    features,
  });
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
  const lineIdsToShow = deriveVisibleFlightLineIds({
    insideRangeActiveFlightIds: insideRangeActiveSet,
    focusMode: sim.focusMode,
    focusFlightIds: sim.focusFlightIds,
    flowPreviewFlightId: sim.flowPreviewFlightId,
    flowPreviewGroupId: sim.flowPreviewGroupId,
    flowCommunities: sim.flowCommunities,
    flowGroups: sim.flowGroups,
    showAllFlowCommunitiesWhenEnabled: false,
    clampToActiveSet: false,
  });

  let filterExpr: any;
  if (lineIdsToShow.length === 0) {
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
    if (map.getLayer("flight-line-labels")) map.setFilter("flight-line-labels", filterExpr as any);
    if (map.getLayer("plane-icons")) map.setFilter("plane-icons", filterExpr as any);
    const inFocusContext =
      sim.focusMode ||
      !!sim.selectedTrafficVolume ||
      !!sim.selectedCollapsedSector ||
      !!sim.flowPreviewFlightId ||
      !!sim.flowPreviewGroupId;
    const lineOpacity =
      sim.flowPreviewFlightId || sim.flowPreviewGroupId
        ? 0.8
        : ((sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.1) : 0);
    const prevOpacity = (map as any).__prevLineOpacity;
    if (prevOpacity !== lineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
      (map as any).__prevLineOpacity = lineOpacity;
    }
  }
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
