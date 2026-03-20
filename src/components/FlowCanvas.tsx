"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { buildTrajectoryLineFeatureCollection } from "@/lib/trajectoryRender";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { Trajectory } from "@/lib/models";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import { getHourBin, getTrafficVolumeFilter } from "@/lib/airspaceDisplay";
import { getCurrentActiveFlightIdsInFlRange } from "@/lib/flightVisibility";
import { captureFlightsByRerouteCatcher } from "@/lib/rerouteCatcher";
import {
  applyCatcherToRegulationTargets,
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
  type FlightCatcherGateSnapshot,
} from "@/lib/flightCatcherPolicy";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeHighlightList,
  applyTrafficVolumeHover,
  applyTrafficVolumeHotspots,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "@/lib/trafficVolumeLayers";
import { formatSecondsToHHMM } from "@/lib/time";

const FLOW_CATCHER_SOURCE_ID = "flow-catcher-source";
const FLOW_CATCHER_DRAFT_LAYER_ID = "flow-catcher-draft";
const FLOW_CATCHER_PREVIEW_LAYER_ID = "flow-catcher-preview";
const FLOW_CATCHER_POINTS_LAYER_ID = "flow-catcher-points";
const SLACK_LAYER_ID = "sector-slack";

export default function FlowCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const flowCatcherDraftPointsRef = useRef<Array<[number, number]>>([]);
  const flowCatcherPreviewPointRef = useRef<[number, number] | null>(null);
  const flowGateSnapshotRef = useRef<FlightCatcherGateSnapshot | null>(null);
  const lastTs = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(performance.now());
  const {
    t,
    resourceDate,
    weatherOverlay,
    tick,
    flights,
    showFlightLineLabels,
    showTrafficVolumes,
    setBaselineFlights,
    setSelectedTrafficVolume,
    toggleSelectedTrafficVolume,
    flLowerBound,
    flUpperBound,
    showHotspots,
    hotspots,
    getActiveHotspots,
    flowViewEnabled,
    flowCommunities,
    flowGroups,
    flowPreviewGroupId,
    flowPreviewFlightId,
    flightLinePreviewFlightIds,
    regulationCatcherActive,
    regulationCatcherMode,
    cancelRegulationCatcher,
    proposalPreviewActive,
    proposalPreviewFlightIds,
    playing,
    focusMode,
    focusFlightIds,
    showFlightLines,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    slackMode,
    setSlackMode,
    slackSign,
    deltaMin,
    setIsFetchingSlack,
  } = useSimStore();

  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);
  const [slackMetaByTv, setSlackMetaByTv] = useState<Record<string, { time_window: string; slack: number; occupancy: number }>>({});
  const [hoverLabelPoint, setHoverLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const lastSlackKeyRef = useRef<string | null>(null);

  const theme = useThemeStore((state) => state.theme);
  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);
  const isCatcherDrawing = regulationCatcherActive && regulationCatcherMode !== "off";
  const selectedTvHighlightIds = useMemo(
    () =>
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [],
    [selectedTrafficVolumes, selectedTrafficVolume],
  );
  const slackSourceTrafficVolumeId = selectedTvHighlightIds.length === 1 ? selectedTvHighlightIds[0] ?? null : null;
  const slackEligible = !!slackSourceTrafficVolumeId;

  const syncFlowCatcherOverlay = () => {
    const map = mapRef.current;
    if (!map) return;
    updateFlowCatcherSource(map, flowCatcherDraftPointsRef.current, flowCatcherPreviewPointRef.current);
  };

  // init map
  useEffect(() => {
    if (!resourcePaths) return;

    const map = new maplibregl.Map({
      container: "map",
      style: createMapStyle(theme, 256),
      center: [3, 45],
      zoom: 4
    });
    mapRef.current = map;

    map.on("load", async () => {
      setBaseDataLoading(true);
      try {
        // Data
        const [sectors, tracks] = await Promise.all([
          loadSectors(resourcePaths.airspaceGeojson),
          loadTrajectories(resourcePaths.flightsCsv)
        ]);

        const activeTracks = setBaselineFlights(tracks);

        // --- Airspace polygons + labels ---
        addTrafficVolumeSources(map, sectors);
        addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });
        if (!map.getLayer(SLACK_LAYER_ID)) {
          map.addLayer({
            id: SLACK_LAYER_ID,
            type: "fill",
            source: "sectors",
            layout: { visibility: "none" },
            paint: { "fill-color": "#22c55e", "fill-opacity": 0 },
          }, TRAFFIC_VOLUME_LAYER_IDS.point);
        }

        applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes, { includeSlack: true });
        const sim = useSimStore.getState();
        applyTrafficVolumeFilters(map, getTrafficVolumeFilter(sim.flLowerBound, sim.flUpperBound, sim.t), { includeSlack: true });

        // --- Flight lines (static geometry) ---
        const lineFC = buildTrajectoryLineFeatureCollection(activeTracks);
        map.addSource("flight-lines", { type: "geojson", data: lineFC });
        map.addLayer({ id: "flight-lines", type: "line", source: "flight-lines", paint: { "line-color": ["get", "lineColor"], "line-width": 1.0, "line-opacity": 0.15 } });
        map.addLayer({
          id: "flight-line-labels",
          type: "symbol",
          source: "flight-lines",
          layout: { "symbol-placement": "line", "text-field": ["get", "callSign"], "text-size": 11, "text-font": ["Noto Sans Regular"] },
          paint: { "text-color": "#34d399", "text-halo-color": "#0f172a", "text-halo-width": 2 }
        });

        // Apply initial visibility based on store defaults
        try {
          const { showFlightLineLabels } = useSimStore.getState();
          map.setPaintProperty("flight-line-labels", "text-opacity", showFlightLineLabels ? 1 : 0);
          map.setPaintProperty("flight-line-labels", "text-halo-width", showFlightLineLabels ? 2 : 0);
        } catch { }

        // (Regulation target lines removed in FlowCanvas)

        // Save trajectories on map for the animation step
        (map as any).__trajectories = activeTracks;

        if (!map.getSource(FLOW_CATCHER_SOURCE_ID)) {
          map.addSource(FLOW_CATCHER_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
        }
        if (!map.getLayer(FLOW_CATCHER_DRAFT_LAYER_ID)) {
          map.addLayer({
            id: FLOW_CATCHER_DRAFT_LAYER_ID,
            type: "line",
            source: FLOW_CATCHER_SOURCE_ID,
            filter: ["==", ["get", "kind"], "draft"],
            paint: {
              "line-color": "#22c55e",
              "line-width": 2.5,
              "line-opacity": 0.95,
            },
          });
        }
        if (!map.getLayer(FLOW_CATCHER_PREVIEW_LAYER_ID)) {
          map.addLayer({
            id: FLOW_CATCHER_PREVIEW_LAYER_ID,
            type: "line",
            source: FLOW_CATCHER_SOURCE_ID,
            filter: ["==", ["get", "kind"], "preview"],
            paint: {
              "line-color": "#22c55e",
              "line-width": 2,
              "line-dasharray": [2, 2],
              "line-opacity": 0.85,
            },
          });
        }
        if (!map.getLayer(FLOW_CATCHER_POINTS_LAYER_ID)) {
          map.addLayer({
            id: FLOW_CATCHER_POINTS_LAYER_ID,
            type: "circle",
            source: FLOW_CATCHER_SOURCE_ID,
            filter: ["==", ["get", "kind"], "point"],
            paint: {
              "circle-color": "#ffffff",
              "circle-radius": 3.5,
              "circle-stroke-color": "#0f172a",
              "circle-stroke-width": 1.2,
            },
          });
        }
        applyFlowCatcherLayerColors(map, useSimStore.getState().regulationCatcherMode);
        updateFlowCatcherSource(map, flowCatcherDraftPointsRef.current, flowCatcherPreviewPointRef.current);

        // (Regulation flight-line click behavior removed in FlowCanvas)

        // Change cursor to pointer when hovering over flight lines
        map.on('mouseenter', 'flight-lines', () => {
          if (useSimStore.getState().regulationCatcherActive) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'flight-lines', () => {
          if (useSimStore.getState().regulationCatcherActive) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = '';
        });

        // Helper to select traffic volume by id
        const selectTrafficVolume = (trafficVolumeId: string) => {
          const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', trafficVolumeId] });
          const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
          const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
          toggleSelectedTrafficVolume(trafficVolumeId, tvData);
        };

        const pickClosestTrafficVolumeId = (e: maplibregl.MapLayerMouseEvent) => {
          const candidates = (e.features as any[]) || [];
          if (!candidates.length) return null;
          let chosen = candidates[0];
          if (candidates.length > 1) {
            let minDist2 = Infinity;
            for (const f of candidates) {
              const geom: any = f.geometry;
              if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
                const p = map.project({ lng: geom.coordinates[0], lat: geom.coordinates[1] } as any);
                const dx = p.x - e.point.x;
                const dy = p.y - e.point.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < minDist2) { minDist2 = d2; chosen = f; }
              }
            }
          }
          const rawId = (chosen as any)?.properties?.traffic_volume_id ?? (chosen as any)?.properties?.label;
          return rawId != null ? String(rawId) : null;
        };

        const handleTrafficVolumeClick = (e: maplibregl.MapLayerMouseEvent) => {
          if (useSimStore.getState().regulationCatcherActive) return;
          const lineHits = map.queryRenderedFeatures(e.point, { layers: ['flight-lines'] });
          if (lineHits && lineHits.length > 0) return;
          const trafficVolumeId = pickClosestTrafficVolumeId(e);
          if (trafficVolumeId) selectTrafficVolume(String(trafficVolumeId));
        };

        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);

        const handleTrafficVolumeHover = (e: maplibregl.MapLayerMouseEvent) => {
          if (useSimStore.getState().regulationCatcherActive) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = 'pointer';
          const trafficVolumeId = pickClosestTrafficVolumeId(e);
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
          if (e.point && useSimStore.getState().slackMode !== 'off') {
            setHoverLabelPoint({ x: (e.point as any).x, y: (e.point as any).y });
          }
        };

        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);

        const handleTrafficVolumeHoverExit = () => {
          if (useSimStore.getState().regulationCatcherActive) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor = '';
          setHoveredTrafficVolume(null);
          setHoverLabelPoint(null);
        };

        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);
        const handleFlowCatcherMapClick = (event: maplibregl.MapMouseEvent) => {
          const sim = useSimStore.getState();
          if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
          if (flowCatcherDraftPointsRef.current.length === 0) {
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
              flowViewEnabled: sim.flowViewEnabled,
              showAllFlowCommunitiesWhenEnabled: true,
              proposalPreviewActive: sim.proposalPreviewActive,
              proposalPreviewFlightIds: sim.proposalPreviewFlightIds,
              regulationPreviewActive: sim.regulationPreviewActive,
              regulationTargetFlightIds: sim.regulationTargetFlightIds,
              clampToActiveSet: true,
            });
            flowGateSnapshotRef.current = freezeGateSnapshot({
              createdAtSimTime: sim.t,
              contextMode: "tv_baseline",
              visibleFlightIds,
              baselineFlightIds: sim.regulationListedFlightIds,
            });
          }
          const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
          flowCatcherDraftPointsRef.current = [...flowCatcherDraftPointsRef.current, point];
          flowCatcherPreviewPointRef.current = point;
          updateFlowCatcherSource(map, flowCatcherDraftPointsRef.current, flowCatcherPreviewPointRef.current);
        };

        const handleFlowCatcherMouseMove = (event: maplibregl.MapMouseEvent) => {
          const sim = useSimStore.getState();
          if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
          if (flowCatcherDraftPointsRef.current.length === 0) return;
          flowCatcherPreviewPointRef.current = [event.lngLat.lng, event.lngLat.lat];
          updateFlowCatcherSource(map, flowCatcherDraftPointsRef.current, flowCatcherPreviewPointRef.current);
        };

        const handleFlowCatcherDoubleClick = (event: maplibregl.MapMouseEvent) => {
          const sim = useSimStore.getState();
          if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
          if (flowCatcherDraftPointsRef.current.length < 2) return;

          event.preventDefault();

          const gateSnapshot =
            flowGateSnapshotRef.current ??
            freezeGateSnapshot({
              createdAtSimTime: sim.t,
              contextMode: "tv_baseline",
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
                flowViewEnabled: sim.flowViewEnabled,
                showAllFlowCommunitiesWhenEnabled: true,
                proposalPreviewActive: sim.proposalPreviewActive,
                proposalPreviewFlightIds: sim.proposalPreviewFlightIds,
                regulationPreviewActive: sim.regulationPreviewActive,
                regulationTargetFlightIds: sim.regulationTargetFlightIds,
                clampToActiveSet: true,
              }),
              baselineFlightIds: sim.regulationListedFlightIds,
            });

          const result = captureFlightsByRerouteCatcher({
            trajectories: tracks,
            catcherPolyline: flowCatcherDraftPointsRef.current,
            timeframe: sim.regulationCatcherTimeframe,
            currentTimeSeconds: gateSnapshot.createdAtSimTime,
          });

          const filtered = filterCapturedToGate(result.flightIds, gateSnapshot);
          if (filtered.length > 0) {
            const next = applyCatcherToRegulationTargets({
              currentTargetFlightIds: sim.regulationTargetFlightIds,
              capturedFlightIds: filtered,
              catcherMode: sim.regulationCatcherMode,
            });
            sim.setRegulationTargetFlightIds(next);
          }

          flowGateSnapshotRef.current = null;
          flowCatcherDraftPointsRef.current = [];
          flowCatcherPreviewPointRef.current = null;
          updateFlowCatcherSource(map, flowCatcherDraftPointsRef.current, flowCatcherPreviewPointRef.current);
        };

        map.on("click", handleFlowCatcherMapClick);
        map.on("mousemove", handleFlowCatcherMouseMove);
        map.on("dblclick", handleFlowCatcherDoubleClick);
        // Fills and overlays are not clickable; keep default cursor

        // Fit to data
        const b = new maplibregl.LngLatBounds();
        lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x, y]: [number, number]) => b.extend([x, y])));
        if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });
        // Ensure first render after sources are fully ready
        map.once("idle", () => {
          try {
            updateFlightLineFilters(mapRef.current);
            updateFlowRendering(mapRef.current);
          } catch (e) {
            console.error("Error during initial updates:", e);
          }
        });
      } catch (err) {
        console.error('Failed to load base data', err);
      } finally {
        setBaseDataLoading(false);
      }
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
    updateFlightLineFilters(map);
    updateFlowRendering(map);
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
          updateFlightLineFilters(mapRef.current);
          lastUpdateRef.current = now;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = undefined; }
      // Render once when pausing to ensure view is up to date
      updateFlightLineFilters(mapRef.current);
    }
  }, [playing, tick]);

  // on t change from UI (drag), update filters immediately when paused
  useEffect(() => { if (!playing) updateFlightLineFilters(mapRef.current); }, [t, playing]);

  // When a single-flight or group preview is toggled via hover, update filters immediately
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowPreviewFlightId]);
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flightLinePreviewFlightIds]);

  // Also react to group preview changes from FlowRegulationPanel header hover
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowPreviewGroupId]);

  // Refresh filters on focus/visibility/selection changes
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [focusMode, focusFlightIds, selectedTrafficVolume, selectedTrafficVolumes, showFlightLines]);

  // Refresh line visibility immediately when altitude range changes
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flLowerBound, flUpperBound]);

  // When flow view state changes, update rendering
  useEffect(() => { updateFlowRendering(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups, showTrafficVolumes, selectedTrafficVolumes]);

  // Ensure filters also react to flow mapping toggles (e.g., Flow Basket eye button)
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups]);

  useEffect(() => {
    updateFlightLineFilters(mapRef.current);
    updateFlowRendering(mapRef.current);
  }, [proposalPreviewActive, proposalPreviewFlightIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyFlowCatcherLayerColors(map, regulationCatcherMode);
    syncFlowCatcherOverlay();
  }, [regulationCatcherMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isCatcherDrawing) {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = "crosshair";
      return;
    }
    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = "";
    flowGateSnapshotRef.current = null;
    flowCatcherDraftPointsRef.current = [];
    flowCatcherPreviewPointRef.current = null;
    syncFlowCatcherOverlay();
  }, [isCatcherDrawing]);

  useEffect(() => {
    if (!isCatcherDrawing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      flowGateSnapshotRef.current = null;
      flowCatcherDraftPointsRef.current = [];
      flowCatcherPreviewPointRef.current = null;
      cancelRegulationCatcher();
      syncFlowCatcherOverlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isCatcherDrawing, cancelRegulationCatcher]);

  // Weather overlay integration (Surface Precipitation)
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
      try { map.off("render", waitForReady); } catch { }
      if (!cancelled) apply();
    };

    map.on("render", waitForReady);
    return () => {
      cancelled = true;
      try { map.off("render", waitForReady); } catch { }
    };
  }, [resourceDate, t, weatherOverlay]);

  // on showFlightLineLabels change, toggle visibility
  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer("flight-line-labels")) {
      mapRef.current.setPaintProperty("flight-line-labels", "text-opacity", showFlightLineLabels ? 1 : 0);
      mapRef.current.setPaintProperty("flight-line-labels", "text-halo-width", showFlightLineLabels ? 2 : 0);
    }
  }, [showFlightLineLabels]);

  // on FL range change or time change, filter traffic volumes based on vertical intersection AND capacity
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getSource("sectors")) return;
      const filterExpression = getTrafficVolumeFilter(flLowerBound, flUpperBound, currentTrafficVolumeBin);
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
  }, [flLowerBound, flUpperBound, currentTrafficVolumeBin]);

  // Update highlight/hover layers when state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlightList(map, selectedTvHighlightIds, flLowerBound, flUpperBound, true);
  }, [selectedTvHighlightIds, flLowerBound, flUpperBound]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHover(map, hoveredTrafficVolume, flLowerBound, flUpperBound, true);
  }, [hoveredTrafficVolume, flLowerBound, flUpperBound]);

  // Update hotspot layers when hotspots/time/FL range changes
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

  // Listen for traffic volume search selection events to pan and select
  useEffect(() => {
    const handleTrafficVolumeSearchSelect = (event: any) => {
      const { trafficVolume, trafficVolumeId } = event.detail || {};
      const map = mapRef.current;
      if (!map) return;
      let tvId: string | null = null;
      let tvGeometry: any = null;
      if (trafficVolume && trafficVolume.properties?.traffic_volume_id) {
        tvId = trafficVolume.properties.traffic_volume_id;
        tvGeometry = trafficVolume.geometry;
      } else if (trafficVolumeId) {
        tvId = trafficVolumeId;
        const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', trafficVolumeId] });
        if (sectorFeatures.length > 0) tvGeometry = sectorFeatures[0].geometry;
      }
      if (!tvId) return;
      // Select TV
      const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', tvId] });
      const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
      const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
      setSelectedTrafficVolume(tvId, tvData);
      const center = tvGeometry
        ? getTrafficVolumeCenter(tvGeometry)
        : getTrafficVolumeCenterFromMap(map, tvId);
      if (center) {
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 7), duration: 1500 });
      }
    };
    window.addEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect);
    return () => { window.removeEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect); };
  }, [setSelectedTrafficVolume]);

  return (
    <>
      <div id="map" className="absolute inset-0" />
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
    </>
  );
}

function updateFlightLineFilters(map: maplibregl.Map | null) {
  if (!map) {
    return;
  }
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        try { updateFlightLineFilters(map); } catch (e) { console.error("Deferred updateFlightLineFilters error:", e); }
      });
    } catch { }
    return;
  }
  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as Trajectory[] | undefined;
  if (!tracks) return;
  const insideRangeActiveSet = getCurrentActiveFlightIdsInFlRange(
    tracks,
    sim.t,
    sim.flLowerBound,
    sim.flUpperBound
  );

  const lineIdsToShow = deriveVisibleFlightLineIds({
    insideRangeActiveFlightIds: insideRangeActiveSet,
    focusMode: sim.focusMode,
    focusFlightIds: sim.focusFlightIds,
    flightLinePreviewFlightIds: sim.flightLinePreviewFlightIds,
    flowPreviewFlightId: sim.flowPreviewFlightId,
    flowPreviewGroupId: sim.flowPreviewGroupId,
    flowCommunities: sim.flowCommunities,
    flowGroups: sim.flowGroups,
    flowViewEnabled: sim.flowViewEnabled,
    showAllFlowCommunitiesWhenEnabled: true,
    proposalPreviewActive: sim.proposalPreviewActive,
    proposalPreviewFlightIds: sim.proposalPreviewFlightIds,
    regulationPreviewActive: sim.regulationPreviewActive,
    regulationTargetFlightIds: sim.regulationTargetFlightIds,
    clampToActiveSet: true,
  });

  let filterExpr: any;
  if (lineIdsToShow.length === 0) {
    filterExpr = ["==", ["to-string", ["get", "flightId"]], "__no_match__"];
  } else {
    filterExpr = [
      "in",
      ["to-string", ["get", "flightId"]],
      ["literal", lineIdsToShow]
    ];
  }

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpr as any);
    const hasFlightLinePreview = sim.flightLinePreviewFlightIds.size > 0;
    const inFocusContext = sim.focusMode || !!sim.selectedTrafficVolume || !!sim.flowPreviewFlightId || hasFlightLinePreview;
    const baseOpacity = (sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.15) : 0;
    const lineOpacity = (sim.flowPreviewFlightId || hasFlightLinePreview) ? 0.8 : (sim.flowViewEnabled ? 0.8 : baseOpacity);
    const prevOpacity = (map as any).__prevLineOpacity;
    if (prevOpacity !== lineOpacity) {
      map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
      (map as any).__prevLineOpacity = lineOpacity;
    }
  }
  if (map.getLayer("flight-line-labels")) {
    map.setFilter("flight-line-labels", filterExpr as any);
  }
}

// (Regulation highlight removed in FlowCanvas)

function updateFlowCatcherSource(
  map: maplibregl.Map,
  draftPoints: Array<[number, number]>,
  previewPoint: [number, number] | null,
) {
  const source = map.getSource(FLOW_CATCHER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
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

function applyFlowCatcherLayerColors(
  map: maplibregl.Map,
  mode: "off" | "include" | "exclude",
) {
  const color = mode === "exclude" ? "#fb7185" : "#22c55e";
  if (map.getLayer(FLOW_CATCHER_DRAFT_LAYER_ID)) {
    map.setPaintProperty(FLOW_CATCHER_DRAFT_LAYER_ID, "line-color", color);
  }
  if (map.getLayer(FLOW_CATCHER_PREVIEW_LAYER_ID)) {
    map.setPaintProperty(FLOW_CATCHER_PREVIEW_LAYER_ID, "line-color", color);
  }
}

// Apply flow-based coloring to flight lines
function updateFlowRendering(map: maplibregl.Map | null) {
  if (!map) {
    return;
  }
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        try {
          updateFlowRendering(map);
        } catch (err) {
          console.error("Deferred updateFlowRendering error:", err);
        }
      });
    } catch { }
    return;
  }
  const sim = useSimStore.getState();
  if (!map.getLayer('flight-lines')) return;

  if (
    !sim.proposalPreviewActive &&
    !sim.regulationPreviewActive &&
    sim.flowViewEnabled &&
    sim.flowCommunities &&
    Object.keys(sim.flowCommunities).length > 0
  ) {
    // Only apply flow coloring when regulation preview is off
    const colorByCommunity = new Map<string, string>(
      Object.entries(sim.flowColorByCommunity || {})
    );

    // Group flight ids by assigned color
    const gray = '#9ca3af';
    const colorToIds: Record<string, string[]> = {};
    for (const [fid, cidAny] of Object.entries(sim.flowCommunities)) {
      const cid = String(cidAny);
      const color = colorByCommunity.get(cid) || gray;
      if (!colorToIds[color]) colorToIds[color] = [];
      colorToIds[color].push(String(fid));
    }

    // Build a 'case' expression using 'in' checks to avoid validator issues with 'match' branch labels
    const caseExpr: any[] = ['case'];
    for (const [color, ids] of Object.entries(colorToIds)) {
      if (!ids || ids.length === 0) continue;
      caseExpr.push(
        ['in', ['to-string', ['get', 'flightId']], ['literal', ids.map(String)]],
        color
      );
    }
    // Default color for flights not in mapping during flow view
    caseExpr.push(gray);

    try {
      map.setPaintProperty('flight-lines', 'line-color', caseExpr as any);
    } catch (err) {
      // Diagnostic log to help track down invalid expression shapes
      console.error('Failed to set flow line-color expression', { err, caseExpr, colorToIds });
    }
  } else {
    // Restore base coloring
    map.setPaintProperty('flight-lines', 'line-color', ['get', 'lineColor'] as any);
  }

  // (No regulation overlay in FlowCanvas)

  applyTrafficVolumeVisibility(map, sim.showTrafficVolumes, { includeSlack: true });
  if (!sim.showTrafficVolumes) {
    return;
  }

  // Dim/Hide traffic volume backgrounds when Flow View is enabled
  // Goal: make non-selected/non-hotspot sectors disappear to declutter the map
  const sectorFillId = 'sector-fill';
  const sectorOutlineId = 'sector-outline';
  const sectorLabelsId = 'sector-labels';
  const sectorPointId = TRAFFIC_VOLUME_LAYER_IDS.point;
  const sectorPointLabelsId = TRAFFIC_VOLUME_LAYER_IDS.pointLabel;

  if (sim.flowViewEnabled && !sim.regulationPreviewActive && !sim.proposalPreviewActive) {
    // Keep base sector visuals hidden only when flow view has priority
    if (map.getLayer(sectorFillId)) {
      map.setPaintProperty(sectorFillId, 'fill-opacity', 0);
    }
    if (map.getLayer(sectorOutlineId)) {
      map.setPaintProperty(sectorOutlineId, 'line-opacity', 0);
    }
    if (map.getLayer(sectorPointId)) {
      map.setPaintProperty(sectorPointId, 'circle-opacity', 0);
    }

    // Show labels only for selected TV or active hotspots at current time
    if (map.getLayer(sectorLabelsId)) {
      const activeHotspots = sim.getActiveHotspots ? sim.getActiveHotspots() : [];
      const hotspotIds = activeHotspots.map((h: any) => String(h.traffic_volume_id));
      const allowedIds: string[] = [];
      const selectedTvIds = Array.isArray(sim.selectedTrafficVolumes) && sim.selectedTrafficVolumes.length > 0
        ? sim.selectedTrafficVolumes
        : (sim.selectedTrafficVolume ? [sim.selectedTrafficVolume] : []);
      for (const tvId of selectedTvIds) {
        const normalized = String(tvId);
        if (!allowedIds.includes(normalized)) allowedIds.push(normalized);
      }
      for (const id of hotspotIds) if (!allowedIds.includes(id)) allowedIds.push(id);

      if (allowedIds.length === 0) {
        // If nothing is selected or a hotspot, hide all labels to minimize clutter
        map.setPaintProperty(sectorLabelsId, 'text-opacity', 0 as any);
        if (map.getLayer(sectorPointLabelsId)) {
          map.setPaintProperty(sectorPointLabelsId, 'text-opacity', 0 as any);
        }
      } else {
        // Data-driven opacity: 1 for selected/hotspot labels, 0 otherwise
        const labelOpacityExpr: any = [
          'case',
          ['in', ['to-string', ['get', 'label']], ['literal', allowedIds]],
          1,
          0
        ];
        map.setPaintProperty(sectorLabelsId, 'text-opacity', labelOpacityExpr as any);
        if (map.getLayer(sectorPointLabelsId)) {
          map.setPaintProperty(sectorPointLabelsId, 'text-opacity', labelOpacityExpr as any);
        }
      }
    }
  } else {
    // Restore base sector visuals when Flow View is disabled
    if (map.getLayer(sectorFillId)) {
      map.setPaintProperty(sectorFillId, 'fill-opacity', 0.01);
    }
    if (map.getLayer(sectorOutlineId)) {
      map.setPaintProperty(sectorOutlineId, 'line-opacity', 0.05);
    }
    if (map.getLayer(sectorLabelsId)) {
      map.setPaintProperty(sectorLabelsId, 'text-opacity', 1 as any);
    }
    if (map.getLayer(sectorPointId)) {
      map.setPaintProperty(sectorPointId, 'circle-opacity', 0.9);
    }
    if (map.getLayer(sectorPointLabelsId)) {
      map.setPaintProperty(sectorPointLabelsId, 'text-opacity', 1 as any);
    }
  }
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
  const source = map.getSource("sectors") as maplibregl.GeoJSONSource | undefined;
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
