"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { AIRSPACE_GEOJSON_PATH, FLIGHTS_CSV_PATH } from "@/lib/dataPaths";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import { Trajectory } from "@/lib/models";
import RegulationResults from "@/components/RegulationResults";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import { getHourBin, getTrafficVolumeFilter } from "@/lib/mapUtils";
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

const REGULATION_CATCHER_SOURCE_ID = "regulation-catcher-source";
const REGULATION_CATCHER_DRAFT_LAYER_ID = "regulation-catcher-draft";
const REGULATION_CATCHER_PREVIEW_LAYER_ID = "regulation-catcher-preview";
const REGULATION_CATCHER_POINTS_LAYER_ID = "regulation-catcher-points";

export default function RegulationCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const regulationDraftPointsRef = useRef<Array<[number, number]>>([]);
  const regulationPreviewPointRef = useRef<[number, number] | null>(null);
  const regulationGateSnapshotRef = useRef<FlightCatcherGateSnapshot | null>(null);
  const lastTs = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(performance.now());
  const {
    t,
    date,
    weatherOverlay,
    tick,
    setRange,
    showFlightLineLabels,
    showFlightLines,
    setFlights,
    setSelectedTrafficVolume,
    toggleSelectedTrafficVolume,
    flLowerBound,
    flUpperBound,
    showHotspots,
    hotspots,
    getActiveHotspots,
    showTrafficVolumes,
    regulationTargetFlightIds,
    regulationPreviewActive,
    addRegulationTargetFlight,
    setRegulationTargetFlightIds,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    isResultsOpen,
    regulationSimulationResult,
    setIsResultsOpen,
    setRegulationSimulationResult,
    flowViewEnabled,
    flowCommunities,
    flowGroups,
    flowPreviewFlightId,
    flowPreviewGroupId,
    focusMode,
    focusFlightIds,
    slackMode,
    setSlackMode,
    slackSign,
    deltaMin,
    setIsFetchingSlack,
    playing,
    regulationCatcherActive,
    regulationCatcherMode,
    cancelRegulationCatcher,
  } = useSimStore();

  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);
  const [slackMetaByTv, setSlackMetaByTv] = useState<Record<string, { time_window: string; slack: number; occupancy: number }>>({});
  const [hoverLabelPoint, setHoverLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const lastSlackKeyRef = useRef<string | null>(null);

  const theme = useThemeStore((state) => state.theme);
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

  const syncRegulationCatcherOverlay = () => {
    const map = mapRef.current;
    if (!map) return;
    updateRegulationCatcherSource(
      map,
      regulationDraftPointsRef.current,
      regulationPreviewPointRef.current,
    );
  };

  // init map
  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: createMapStyle(theme, 256),
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
      addTrafficVolumeSources(map, sectors);
      addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });

      // Slack overlay layer (initially hidden). Place below points + labels so clicks work.
      if (!map.getLayer("sector-slack")) {
        map.addLayer({
          id: "sector-slack",
          type: "fill",
          source: "sectors",
          layout: { visibility: "none" },
          paint: { "fill-color": "#facc15", "fill-opacity": 0.03 }
        }, TRAFFIC_VOLUME_LAYER_IDS.point);
      }

      applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes, { includeSlack: true });
      const sim = useSimStore.getState();
      applyTrafficVolumeFilters(map, getTrafficVolumeFilter(sim.flLowerBound, sim.flUpperBound, sim.t), { includeSlack: true });

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

      // Highlight layer for regulation target flights (bright red)
      map.addLayer({
        id: "reg-target-lines",
        type: "line",
        source: "flight-lines",
        paint: { "line-color": "#ef4444", "line-width": 2.0, "line-opacity": 0.9 },
        filter: ["==", ["get", "flightId"], "__none__"]
      });

      // Save trajectories on map for the animation step
      (map as any).__trajectories = tracks;
      if (!map.getSource(REGULATION_CATCHER_SOURCE_ID)) {
        map.addSource(REGULATION_CATCHER_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(REGULATION_CATCHER_DRAFT_LAYER_ID)) {
        map.addLayer({
          id: REGULATION_CATCHER_DRAFT_LAYER_ID,
          type: "line",
          source: REGULATION_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "draft"],
          paint: {
            "line-color": "#22c55e",
            "line-width": 2.5,
            "line-opacity": 0.95,
          },
        });
      }
      if (!map.getLayer(REGULATION_CATCHER_PREVIEW_LAYER_ID)) {
        map.addLayer({
          id: REGULATION_CATCHER_PREVIEW_LAYER_ID,
          type: "line",
          source: REGULATION_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "preview"],
          paint: {
            "line-color": "#22c55e",
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.85,
          },
        });
      }
      if (!map.getLayer(REGULATION_CATCHER_POINTS_LAYER_ID)) {
        map.addLayer({
          id: REGULATION_CATCHER_POINTS_LAYER_ID,
          type: "circle",
          source: REGULATION_CATCHER_SOURCE_ID,
          filter: ["==", ["get", "kind"], "point"],
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 3.5,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1.2,
          },
        });
      }
      applyRegulationCatcherLayerColors(map, useSimStore.getState().regulationCatcherMode);
      updateRegulationCatcherSource(map, regulationDraftPointsRef.current, regulationPreviewPointRef.current);

      // Click handler for flight lines: add to regulation target list when a TV is selected
      map.on('click', 'flight-lines', (e) => {
        const sim = useSimStore.getState();
        if (sim.regulationCatcherActive) return;
        if (!sim.selectedTrafficVolume && (!Array.isArray(sim.selectedTrafficVolumes) || sim.selectedTrafficVolumes.length === 0)) return;
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          if (flightId) {
            addRegulationTargetFlight(String(flightId));
            updateRegulationHighlight(mapRef.current);
          }
        }
      });

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
        const lineHits = map.queryRenderedFeatures(e.point, { layers: ['reg-target-lines', 'flight-lines'] });
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
      const handleRegulationMapClick = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
        if (regulationDraftPointsRef.current.length === 0) {
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
            regulationPreviewActive: sim.regulationPreviewActive,
            regulationTargetFlightIds: sim.regulationTargetFlightIds,
            clampToActiveSet: true,
          });
          regulationGateSnapshotRef.current = freezeGateSnapshot({
            createdAtSimTime: sim.t,
            contextMode: "tv_baseline",
            visibleFlightIds,
            baselineFlightIds: sim.regulationListedFlightIds,
          });
        }
        const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        regulationDraftPointsRef.current = [...regulationDraftPointsRef.current, point];
        regulationPreviewPointRef.current = point;
        updateRegulationCatcherSource(map, regulationDraftPointsRef.current, regulationPreviewPointRef.current);
      };

      const handleRegulationMouseMove = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
        if (regulationDraftPointsRef.current.length === 0) return;
        regulationPreviewPointRef.current = [event.lngLat.lng, event.lngLat.lat];
        updateRegulationCatcherSource(map, regulationDraftPointsRef.current, regulationPreviewPointRef.current);
      };

      const handleRegulationDoubleClick = (event: maplibregl.MapMouseEvent) => {
        const sim = useSimStore.getState();
        if (!sim.regulationCatcherActive || sim.regulationCatcherMode === "off") return;
        if (regulationDraftPointsRef.current.length < 2) return;

        event.preventDefault();

        const gateSnapshot =
          regulationGateSnapshotRef.current ??
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
              regulationPreviewActive: sim.regulationPreviewActive,
              regulationTargetFlightIds: sim.regulationTargetFlightIds,
              clampToActiveSet: true,
            }),
            baselineFlightIds: sim.regulationListedFlightIds,
          });

        const result = captureFlightsByRerouteCatcher({
          trajectories: tracks,
          catcherPolyline: regulationDraftPointsRef.current,
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
          setRegulationTargetFlightIds(next);
        }

        regulationGateSnapshotRef.current = null;
        regulationDraftPointsRef.current = [];
        regulationPreviewPointRef.current = null;
        updateRegulationCatcherSource(map, regulationDraftPointsRef.current, regulationPreviewPointRef.current);
      };

      map.on("click", handleRegulationMapClick);
      map.on("mousemove", handleRegulationMouseMove);
      map.on("dblclick", handleRegulationDoubleClick);
      // Fills and slack overlay are not clickable; keep default cursor

      // Fit to data
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x, y]: [number, number]) => b.extend([x, y])));
      if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });
      setBaseDataLoading(false);
      // Ensure first render after sources are fully ready
      map.once("idle", () => {
        try {
          updateFlightLineFilters(mapRef.current);
          updateFlowRendering(mapRef.current);
          updateRegulationHighlight(mapRef.current);
        } catch (e) {
          console.error("Error during initial updates:", e);
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
          updateFlightLineFilters(mapRef.current);
          updateRegulationHighlight(mapRef.current);
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
      updateRegulationHighlight(mapRef.current);
    }
  }, [playing, tick]);

  // on t change from UI (drag), update filters immediately when paused
  useEffect(() => {
    if (!playing) {
      updateFlightLineFilters(mapRef.current);
      updateRegulationHighlight(mapRef.current);
    }
  }, [t, playing]);

  // When a single-flight or group preview is toggled via hover, update filters immediately
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowPreviewFlightId, flowPreviewGroupId]);

  // When focus context changes (focus mode, ids, or TV selection / visibility toggles), update filters immediately
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [focusMode, focusFlightIds, selectedTrafficVolume, showFlightLines]);

  // Refresh line and regulation highlight visibility immediately when altitude range changes
  useEffect(() => {
    updateFlightLineFilters(mapRef.current);
    updateRegulationHighlight(mapRef.current);
  }, [flLowerBound, flUpperBound]);

  // When flow view state changes, update rendering
  useEffect(() => { updateFlowRendering(mapRef.current); updateRegulationHighlight(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups, showTrafficVolumes, selectedTrafficVolumes]);

  // Update regulation highlight when target ids change
  useEffect(() => { updateRegulationHighlight(mapRef.current); }, [regulationTargetFlightIds, flowViewEnabled, regulationPreviewActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyRegulationCatcherLayerColors(map, regulationCatcherMode);
    syncRegulationCatcherOverlay();
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
    regulationGateSnapshotRef.current = null;
    regulationDraftPointsRef.current = [];
    regulationPreviewPointRef.current = null;
    syncRegulationCatcherOverlay();
  }, [isCatcherDrawing]);

  useEffect(() => {
    if (!isCatcherDrawing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      regulationGateSnapshotRef.current = null;
      regulationDraftPointsRef.current = [];
      regulationPreviewPointRef.current = null;
      cancelRegulationCatcher();
      syncRegulationCatcherOverlay();
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
  }, [weatherOverlay, t, date]);

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

  // Listen for dialog close events to clear highlighting and hide slack overlay
  useEffect(() => {
    const handleClearHighlight = () => {
      setSlackMode('off');
      if (mapRef.current) hideSlackOverlay(mapRef.current);
      lastSlackKeyRef.current = null;
    };
    window.addEventListener('clearTrafficVolumeHighlight', handleClearHighlight);
    return () => { window.removeEventListener('clearTrafficVolumeHighlight', handleClearHighlight); };
  }, [setSlackMode]);

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
      // Select TV and trigger slack fetch immediately
      const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', tvId] });
      const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
      const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
      setSelectedTrafficVolume(tvId, tvData);
      lastSlackKeyRef.current = null;
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

  // Fetch and display slack distribution when TV is selected, highlighted, and sign/time changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showTrafficVolumes) { hideSlackOverlay(map); return; }
    if (!selectedTrafficVolume) { hideSlackOverlay(map); setSlackMode('off'); return; }
    const refStr = formatSecondsToHHMM(t);
    const key = `${selectedTrafficVolume}|${refStr}|${slackSign}|${deltaMin}`;
    if (lastSlackKeyRef.current === key) return;
    lastSlackKeyRef.current = key;
    const showNow = slackMode !== 'off';
    fetchAndApplySlack(map, selectedTrafficVolume, refStr, slackSign, deltaMin, setIsFetchingSlack, setSlackMetaByTv, showNow);
  }, [selectedTrafficVolume, slackSign, deltaMin, t, slackMode, setSlackMode, setIsFetchingSlack, showTrafficVolumes]);

  // Show/hide slack overlay based on mode (Off/Minus/Plus)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showTrafficVolumes || slackMode === 'off') {
      hideSlackOverlay(map);
    } else if (map.getLayer('sector-slack')) {
      map.setLayoutProperty('sector-slack', 'visibility', 'visible');
    }
  }, [slackMode, showTrafficVolumes]);

  return (
    <>
      <div id="map" className="absolute inset-0" />
      {/* Results Modal */}
      <RegulationResults
        open={isResultsOpen}
        result={regulationSimulationResult}
        onClose={() => { setIsResultsOpen(false); setRegulationSimulationResult(null); }}
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
    flowPreviewFlightId: sim.flowPreviewFlightId,
    flowPreviewGroupId: sim.flowPreviewGroupId,
    flowCommunities: sim.flowCommunities,
    flowGroups: sim.flowGroups,
    flowViewEnabled: sim.flowViewEnabled,
    showAllFlowCommunitiesWhenEnabled: true,
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
    const inFocusContext = sim.focusMode || !!sim.selectedTrafficVolume || !!sim.flowPreviewFlightId;
    const baseOpacity = (sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.15) : 0;
    const lineOpacity = sim.flowPreviewFlightId ? 0.8 : (sim.flowViewEnabled ? 0.8 : baseOpacity);
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

function updateRegulationHighlight(map: maplibregl.Map | null) {
  if (!map) return;
  if (!map.isStyleLoaded()) {
    try {
      map.once("idle", () => {
        try {
          updateRegulationHighlight(map);
        } catch (err) {
          console.error("Deferred updateRegulationHighlight error:", err);
        }
      });
    } catch { }
    return;
  }
  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as Trajectory[] | undefined;
  const insideRangeActiveSet = getCurrentActiveFlightIdsInFlRange(
    tracks,
    sim.t,
    sim.flLowerBound,
    sim.flUpperBound
  );
  const ids = Array.from(sim.regulationTargetFlightIds)
    .map(String)
    .filter((id) => insideRangeActiveSet.has(id));
  const filterExpr: any = ids.length > 0 ? ["in", ["to-string", ["get", "flightId"]], ["literal", ids]] : ["==", ["get", "flightId"], "__none__"];
  if (map.getLayer("reg-target-lines")) {
    // Flow view normally hides the regulation overlay, but targeted preview should override that
    const vis = sim.flowViewEnabled && !sim.regulationPreviewActive ? 'none' : 'visible';
    map.setLayoutProperty("reg-target-lines", "visibility", vis);
    map.setFilter("reg-target-lines", filterExpr as any);
  }
}

function updateRegulationCatcherSource(
  map: maplibregl.Map,
  draftPoints: Array<[number, number]>,
  previewPoint: [number, number] | null,
) {
  const source = map.getSource(REGULATION_CATCHER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
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

function applyRegulationCatcherLayerColors(
  map: maplibregl.Map,
  mode: "off" | "include" | "exclude",
) {
  const color = mode === "exclude" ? "#fb7185" : "#22c55e";
  if (map.getLayer(REGULATION_CATCHER_DRAFT_LAYER_ID)) {
    map.setPaintProperty(REGULATION_CATCHER_DRAFT_LAYER_ID, "line-color", color);
  }
  if (map.getLayer(REGULATION_CATCHER_PREVIEW_LAYER_ID)) {
    map.setPaintProperty(REGULATION_CATCHER_PREVIEW_LAYER_ID, "line-color", color);
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

  if (!sim.regulationPreviewActive && sim.flowViewEnabled && sim.flowCommunities && Object.keys(sim.flowCommunities).length > 0) {
    // When not previewing regulation targets, apply flow coloring with centralized mapping
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

  // Ensure regulation overlay visibility matches flow precedence
  if (map.getLayer('reg-target-lines')) {
    const vis = sim.flowViewEnabled && !sim.regulationPreviewActive ? 'none' : 'visible';
    map.setLayoutProperty('reg-target-lines', 'visibility', vis);
  }

  applyTrafficVolumeVisibility(map, sim.showTrafficVolumes, { includeSlack: true });
  if (!sim.showTrafficVolumes) {
    if (map.getLayer('sector-slack')) {
      map.setLayoutProperty('sector-slack', 'visibility', 'none');
    }
    return;
  }

  // Dim/Hide traffic volume backgrounds when Flow View is enabled
  // Goal: make non-selected/non-hotspot sectors disappear to declutter the map
  const sectorFillId = 'sector-fill';
  const sectorOutlineId = 'sector-outline';
  const sectorLabelsId = 'sector-labels';
  const sectorPointId = TRAFFIC_VOLUME_LAYER_IDS.point;
  const sectorPointLabelsId = TRAFFIC_VOLUME_LAYER_IDS.pointLabel;

  if (sim.flowViewEnabled && !sim.regulationPreviewActive) {
    // While flow coloring is active (and no regulation preview), hide base sector visuals
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

// Format seconds since midnight to HH:MM
function formatSecondsToHHMM(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function fetchAndApplySlack(
  map: maplibregl.Map,
  trafficVolumeId: string,
  refTimeStr: string,
  sign: "minus" | "plus",
  deltaMin: number,
  setIsFetching: (v: boolean) => void,
  setSlackMetaByTv: React.Dispatch<React.SetStateAction<Record<string, { time_window: string; slack: number; occupancy: number }>>>,
  showImmediately?: boolean
) {
  if (!map || !map.isStyleLoaded()) return;
  setIsFetching(true);
  try {
    const url = new URL(`/api/slack_distribution`, window.location.origin);
    url.searchParams.set('traffic_volume_id', trafficVolumeId);
    url.searchParams.set('ref_time_str', refTimeStr);
    url.searchParams.set('sign', sign);
    if (!Number.isNaN(deltaMin)) {
      url.searchParams.set('delta_min', String(deltaMin));
    }
    const { authFetch } = await import("@/lib/auth");
    const resp = await authFetch(url.toString());
    if (!resp.ok) throw new Error(`Slack API error ${resp.status}`);
    const data = await resp.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const slackByTv = new Map<string, number>();
    const metaRecord: Record<string, { time_window: string; slack: number; occupancy: number }> = {};
    for (const r of results) {
      const tv = String(r?.traffic_volume_id ?? '');
      const sv = typeof r?.slack === 'number' ? r.slack : Number(r?.slack) || 0;
      if (tv) slackByTv.set(tv, sv);
      if (tv) metaRecord[tv] = { time_window: String(r?.time_window ?? ''), slack: Number(sv), occupancy: Number(r?.occupancy ?? 0) };
    }
    setSlackMetaByTv(metaRecord);
    applySlackOverlay(map, slackByTv);
    const showTraffic = useSimStore.getState().showTrafficVolumes;
    if (showImmediately && showTraffic) {
      if (map.getLayer('sector-slack')) {
        map.setLayoutProperty('sector-slack', 'visibility', 'visible');
      }
    } else {
      hideSlackOverlay(map);
    }
  } catch (e) {
    console.error('Failed to fetch/apply slack:', e);
    hideSlackOverlay(map);
  } finally {
    setIsFetching(false);
  }
}

function applySlackOverlay(map: maplibregl.Map, slackByTv: Map<string, number>) {
  if (!map || !map.isStyleLoaded()) return;
  const src = map.getSource('sectors') as maplibregl.GeoJSONSource | undefined;
  const base = (map as any).__sectors as GeoJSON.FeatureCollection | undefined;
  if (!src || !base) return;

  // Merge slack values into sector GeoJSON
  const updated: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: (base.features as any[]).map((f: any) => {
      const tvId = String(f?.properties?.traffic_volume_id ?? '');
      const sv = slackByTv.get(tvId) ?? 0;
      return { ...f, properties: { ...f.properties, slack_value: sv } };
    })
  } as any;

  // Compute max slack for color scaling
  let sMax = 0;
  for (const f of updated.features as any[]) {
    const sv = Number(f?.properties?.slack_value ?? 0);
    if (sv > sMax) sMax = sv;
  }
  if (sMax <= 0) sMax = 1; // avoid divide-by-zero and keep visible scale

  src.setData(updated as any);
  (map as any).__sectors = updated;

  // Ensure layer exists and is visible
  if (!map.getLayer('sector-slack')) {
    map.addLayer({
      id: 'sector-slack',
      type: 'fill',
      source: 'sectors',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#facc15', 'fill-opacity': 0.03 }
    }, TRAFFIC_VOLUME_LAYER_IDS.point);
  }
  if (map.getLayer('sector-slack')) {
    const colorExpr: any = [
      'interpolate', ['linear'], ['to-number', ['coalesce', ['get', 'slack_value'], 0]],
      0, '#a855f7',           // bright purple (congested)
      sMax * 0.25, '#facc15', // yellow
      sMax * 0.5, '#3b82f6',  // blue
      sMax, '#22c55e'         // green (plenty of slack)
    ];
    map.setPaintProperty('sector-slack', 'fill-color', colorExpr as any);
    map.setPaintProperty('sector-slack', 'fill-opacity', 0.05);
  }
}

function hideSlackOverlay(map: maplibregl.Map) {
  if (!map || !map.isStyleLoaded()) return;
  if (map.getLayer('sector-slack')) {
    map.setLayoutProperty('sector-slack', 'visibility', 'none');
  }
}
