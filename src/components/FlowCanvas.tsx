"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import { AIRSPACE_GEOJSON_PATH, FLIGHTS_CSV_PATH } from "@/lib/dataPaths";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import { getHourBin, getTrafficVolumeFilter } from "@/lib/mapUtils";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeFilters,
  applyTrafficVolumeHighlight,
  applyTrafficVolumeHover,
  applyTrafficVolumeHotspots,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "@/lib/trafficVolumeLayers";

export default function FlowCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(performance.now());
  const { t, date, weatherOverlay, tick, setRange, showFlightLineLabels, showTrafficVolumes, setFlights, setSelectedTrafficVolume, flLowerBound, flUpperBound, showHotspots, hotspots, getActiveHotspots, flowViewEnabled, flowCommunities, flowGroups, flowPreviewGroupId, flowPreviewFlightId, regulationTargetFlightIds, regulationPreviewActive, proposalPreviewActive, proposalPreviewFlightIds, playing, focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume } = useSimStore();

  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [baseDataLoading, setBaseDataLoading] = useState(true);

  const theme = useThemeStore((state) => state.theme);
  const currentTrafficVolumeBin = useMemo(() => getHourBin(t), [t]);

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
      try {
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

        applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);
        const sim = useSimStore.getState();
        applyTrafficVolumeFilters(map, getTrafficVolumeFilter(sim.flLowerBound, sim.flUpperBound, sim.t));

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

        // (Regulation target lines removed in FlowCanvas)

        // Save trajectories on map for the animation step
        (map as any).__trajectories = tracks;

        // (Regulation flight-line click behavior removed in FlowCanvas)

        // Change cursor to pointer when hovering over flight lines
        map.on('mouseenter', 'flight-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'flight-lines', () => { map.getCanvas().style.cursor = ''; });

        // Helper to select traffic volume by id
        const selectTrafficVolume = (trafficVolumeId: string) => {
          const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', trafficVolumeId] });
          const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
          const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
          setSelectedTrafficVolume(trafficVolumeId, tvData);
          setHighlightedTrafficVolume(prev => prev === trafficVolumeId ? null : trafficVolumeId);
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
          const lineHits = map.queryRenderedFeatures(e.point, { layers: ['flight-lines'] });
          if (lineHits && lineHits.length > 0) return;
          const trafficVolumeId = pickClosestTrafficVolumeId(e);
          if (trafficVolumeId) selectTrafficVolume(String(trafficVolumeId));
        };

        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
        map.on('click', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);

        const handleTrafficVolumeHover = (e: maplibregl.MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = 'pointer';
          const trafficVolumeId = pickClosestTrafficVolumeId(e);
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
        };

        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
        map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
        map.on('mousemove', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);

        const handleTrafficVolumeHoverExit = () => {
          map.getCanvas().style.cursor = '';
          setHoveredTrafficVolume(null);
        };

        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
        map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);
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

  // Also react to group preview changes from FlowRegulationPanel header hover
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowPreviewGroupId]);

  // Refresh filters on focus/visibility/selection changes
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [focusMode, focusFlightIds, selectedTrafficVolume, showFlightLines]);

  // When flow view state changes, update rendering
  useEffect(() => { updateFlowRendering(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups, showTrafficVolumes]);

  // Ensure filters also react to flow mapping toggles (e.g., Flow Basket eye button)
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups]);

  useEffect(() => {
    updateFlightLineFilters(mapRef.current);
    updateFlowRendering(mapRef.current);
  }, [proposalPreviewActive, proposalPreviewFlightIds]);

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
  }, [flLowerBound, flUpperBound, currentTrafficVolumeBin]);

  // Update highlight/hover layers when state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlight(map, highlightedTrafficVolume, flLowerBound, flUpperBound, true);
  }, [highlightedTrafficVolume, flLowerBound, flUpperBound]);

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

  // Listen for dialog close events to clear highlighting
  useEffect(() => {
    const handleClearHighlight = () => {
      setHighlightedTrafficVolume(null);
    };
    window.addEventListener('clearTrafficVolumeHighlight', handleClearHighlight);
    return () => { window.removeEventListener('clearTrafficVolumeHighlight', handleClearHighlight); };
  }, []);

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
      setHighlightedTrafficVolume(tvId);
      const center = tvGeometry
        ? getTrafficVolumeCenter(tvGeometry)
        : getTrafficVolumeCenterFromMap(map, tvId);
      if (center) {
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 7), duration: 1500 });
      }
    };
    window.addEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect);
    return () => { window.removeEventListener('traffic-volume-search-select', handleTrafficVolumeSearchSelect); };
  }, []);

  // (Slack overlay removed in FlowCanvas)

  return (
    <>
      <div id="map" className="absolute inset-0" />
      {/* Regulation panels and slack controls removed in FlowCanvas */}

      <PageLoadingIndicator visible={baseDataLoading} />
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
  const tracks = (map as any).__trajectories as any[] | undefined;
  if (!tracks) return;

  const activeFlightIds: string[] = [];
  for (const tr of tracks) {
    if (sim.t >= tr.t0 && sim.t <= tr.t1) activeFlightIds.push(String(tr.flightId));
  }

  // When Flow View is enabled and communities are present, restrict to those flights
  let lineIdsToShow: string[];
  // Flight-level preview takes precedence over any group preview or other filters
  if (sim.proposalPreviewActive) {
    lineIdsToShow = Array.from(sim.proposalPreviewFlightIds || []).map(String);
  } else if (sim.regulationPreviewActive) {
    lineIdsToShow = Array.from(sim.regulationTargetFlightIds).map(String);
  } else if (sim.flowPreviewFlightId) {
    // Flow preview hovers are next-highest priority
    lineIdsToShow = [String(sim.flowPreviewFlightId)];
  } else if (sim.flowViewEnabled && sim.flowCommunities && Object.keys(sim.flowCommunities).length > 0) {
    const previewGroupId = sim.flowPreviewGroupId ? String(sim.flowPreviewGroupId) : null;
    if (previewGroupId) {
      // Preview mode: show all flights that belong to the hovered flow group (not time-sliced)
      let previewIds: string[] = [];
      if (sim.flowGroups && sim.flowGroups[previewGroupId]) {
        previewIds = (sim.flowGroups[previewGroupId] || []).map(String);
      } else {
        // Fallback: derive from communities mapping
        previewIds = Object.entries(sim.flowCommunities)
          .filter(([, cid]) => String(cid) === previewGroupId)
          .map(([fid]) => String(fid));
      }
      lineIdsToShow = previewIds.map(String);
    } else {
      // No preview: show all flights included in any community (flow extraction), not time-sliced
      lineIdsToShow = Object.keys(sim.flowCommunities).map(String);
    }
  } else {
    lineIdsToShow = (sim.focusMode ? Array.from(sim.focusFlightIds) : activeFlightIds).map(String);
  }

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

// (Regulation highlight removed in FlowCanvas)

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

  applyTrafficVolumeVisibility(map, sim.showTrafficVolumes);
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
      if (sim.selectedTrafficVolume) allowedIds.push(String(sim.selectedTrafficVolume));
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

// (Slack overlay and helpers removed in FlowCanvas)
