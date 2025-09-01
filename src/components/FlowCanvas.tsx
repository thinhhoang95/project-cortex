"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import * as turf from "@turf/turf";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";

export default function FlowCanvas() {
  const mapRef = useRef<maplibregl.Map|null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const { t, tick, setRange, showFlightLineLabels, setFlights, setSelectedTrafficVolume, flLowerBound, flUpperBound, showHotspots, hotspots, getActiveHotspots, flowViewEnabled, flowCommunities, flowGroups } = useSimStore();
  
  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);

  // init map
  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          "raster-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          },
          "countries": {
            type: "vector",
            url: "https://demotiles.maplibre.org/tiles/tiles.json"
          }
        },
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#1e293b" } },
          {
            id: "raster-layer",
            type: "raster",
            source: "raster-tiles",
            paint: {
              "raster-opacity": 0.4,
              "raster-brightness-min": 0,
              "raster-brightness-max": 0.3,
              "raster-contrast": 0.3,
              "raster-saturation": -0.7
            }
          },
          {
            id: "countries-fill",
            type: "fill",
            source: "countries",
            "source-layer": "countries",
            paint: { "fill-color": "#334155", "fill-opacity": 0.3 }
          },
          {
            id: "countries-border",
            type: "line",
            source: "countries",
            "source-layer": "countries",
            paint: { "line-color": "#64748b", "line-width": 1.5, "line-opacity": 0.8 }
          }
        ]
      },
      center: [3, 45],
      zoom: 4
    });
    mapRef.current = map;

    map.on("load", async () => {
      // Data
      const [sectors, tracks] = await Promise.all([
        loadSectors("/data/airspace.geojson"),
        loadTrajectories("/data/flights_20230801.csv")
      ]);

      // Store flights in global store and compute global time range
      setFlights(tracks);
      const minT = Math.min(...tracks.map((track: any) => track.t0));
      const maxT = Math.max(...tracks.map((track: any) => track.t1));
      setRange([minT, maxT], minT);

      // --- Airspace polygons + labels ---
      map.addSource("sectors", { type: "geojson", data: sectors });
      (map as any).__sectors = sectors;

      map.addLayer({ id: "sector-fill", type: "fill", source: "sectors", paint: { "fill-color": "#3b82f6", "fill-opacity": 0.01 } });
      map.addLayer({ id: "sector-outline", type: "line", source: "sectors", paint: { "line-color": "#3b82f6", "line-width": 1.5, "line-opacity": 0.05 } });
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
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#60a5fa", "text-halo-color": "#0f172a", "text-halo-width": 2 }
      });

      // Add highlight and hover layers for traffic volumes
      map.addLayer({ id: "sector-highlight", type: "fill", source: "sectors", paint: { "fill-color": "#fbbf24", "fill-opacity": 0.3 }, filter: ["==", ["get", "traffic_volume_id"], ""] });
      map.addLayer({ id: "sector-highlight-outline", type: "line", source: "sectors", paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.8 }, filter: ["==", ["get", "traffic_volume_id"], ""] });
      map.addLayer({ id: "sector-hover", type: "fill", source: "sectors", paint: { "fill-color": "#06b6d4", "fill-opacity": 0.2 }, filter: ["==", ["get", "traffic_volume_id"], ""] });
      map.addLayer({ id: "sector-hover-outline", type: "line", source: "sectors", paint: { "line-color": "#06b6d4", "line-width": 2, "line-opacity": 0.6 }, filter: ["==", ["get", "traffic_volume_id"], ""] });

      // (Slack overlay removed in FlowCanvas)

      // Add hotspot layers for traffic volumes
      map.addLayer({ id: "sector-hotspot", type: "fill", source: "sectors", paint: { "fill-color": "#ef4444", "fill-opacity": 0.4 }, filter: ["==", ["get", "traffic_volume_id"], ""] });
      map.addLayer({ id: "sector-hotspot-outline", type: "line", source: "sectors", paint: { "line-color": "#ef4444", "line-width": 3, "line-opacity": 0.9 }, filter: ["==", ["get", "traffic_volume_id"], ""] });

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

      // Click handler: only labels select a TV (disallow fills/overlays)
      map.on('click', 'sector-labels', (e) => {
        // If a flight line (including highlighted) is under the cursor, let that take precedence
        const lineHits = map.queryRenderedFeatures(e.point, { layers: ['flight-lines'] });
        if (lineHits && lineHits.length > 0) return;
        if (e.features && e.features.length > 0) {
          // Choose the closest label feature to the click point to avoid wrong selection when labels overlap
          const candidates = e.features as any[];
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
          const trafficVolumeId = (chosen as any)?.properties?.label;
          if (trafficVolumeId) selectTrafficVolume(String(trafficVolumeId));
        }
      });

      // Hover effects for sector labels and fills
      map.on('mouseenter', 'sector-labels', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const trafficVolumeId = feature.properties?.label;
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
        }
      });
      map.on('mousemove', 'sector-labels', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const trafficVolumeId = feature.properties?.label;
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
        }
        // no-op
      });
      map.on('mouseleave', 'sector-labels', () => { map.getCanvas().style.cursor = ''; setHoveredTrafficVolume(null); });
      // Fills and slack overlay are not clickable; keep default cursor

      // Fit to data
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x,y]: [number, number]) => b.extend([x,y])));
      if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });
    });

    // RAF loop (time progression + layer updates)
    const loop = () => {
      const now = performance.now();
      const dt = now - lastTs.current;
      lastTs.current = now;
      tick(dt);
      updateFlightLineFilters(mapRef.current);
      updateFlowRendering(mapRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // on t change from UI (drag), update filters immediately
  useEffect(() => { updateFlightLineFilters(mapRef.current); }, [t]);

  // When flow view state changes, update rendering
  useEffect(() => { updateFlowRendering(mapRef.current); }, [flowViewEnabled, flowCommunities, flowGroups]);

  // on showFlightLineLabels change, toggle visibility
  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer("flight-line-labels")) {
      mapRef.current.setPaintProperty("flight-line-labels", "text-opacity", showFlightLineLabels ? 1 : 0);
      mapRef.current.setPaintProperty("flight-line-labels", "text-halo-width", showFlightLineLabels ? 2 : 0);
    }
  }, [showFlightLineLabels]);

  // on FL range change, filter traffic volumes
  useEffect(() => {
    if (mapRef.current && mapRef.current.getSource("sectors")) {
      const filterExpression: any = [
        "all",
        [">=", ["get", "max_fl"], flLowerBound],
        ["<=", ["get", "min_fl"], flUpperBound]
      ];
      if (mapRef.current.getLayer("sector-fill")) mapRef.current.setFilter("sector-fill", filterExpression);
      if (mapRef.current.getLayer("sector-outline")) mapRef.current.setFilter("sector-outline", filterExpression);
      if (mapRef.current.getLayer("sector-labels")) mapRef.current.setFilter("sector-labels", filterExpression);
      // (Slack layer removed) no sector-slack filter
      // Ensure highlight and hover layers are also absolutely filtered by FL range
      const hlFilter: any = highlightedTrafficVolume
        ? ["all", ["==", ["get", "traffic_volume_id"], highlightedTrafficVolume], [">=", ["get", "max_fl"], flLowerBound], ["<=", ["get", "min_fl"], flUpperBound]]
        : ["==", ["get", "traffic_volume_id"], ""];
      const hvFilter: any = hoveredTrafficVolume
        ? ["all", ["==", ["get", "traffic_volume_id"], hoveredTrafficVolume], [">=", ["get", "max_fl"], flLowerBound], ["<=", ["get", "min_fl"], flUpperBound]]
        : ["==", ["get", "traffic_volume_id"], ""];
      if (mapRef.current.getLayer("sector-highlight")) mapRef.current.setFilter("sector-highlight", hlFilter as any);
      if (mapRef.current.getLayer("sector-highlight-outline")) mapRef.current.setFilter("sector-highlight-outline", hlFilter as any);
      if (mapRef.current.getLayer("sector-hover")) mapRef.current.setFilter("sector-hover", hvFilter as any);
      if (mapRef.current.getLayer("sector-hover-outline")) mapRef.current.setFilter("sector-hover-outline", hvFilter as any);
    }
  }, [flLowerBound, flUpperBound]);

  // Update highlight/hover layers when state changes
  useEffect(() => {
    if (!mapRef.current) return;
    const highlightFilter = highlightedTrafficVolume
      ? ["all", ["==", ["get", "traffic_volume_id"], highlightedTrafficVolume], [">=", ["get", "max_fl"], flLowerBound], ["<=", ["get", "min_fl"], flUpperBound]]
      : ["==", ["get", "traffic_volume_id"], ""];
    if (mapRef.current.getLayer("sector-highlight")) mapRef.current.setFilter("sector-highlight", highlightFilter as any);
    if (mapRef.current.getLayer("sector-highlight-outline")) mapRef.current.setFilter("sector-highlight-outline", highlightFilter as any);
  }, [highlightedTrafficVolume]);

  useEffect(() => {
    if (!mapRef.current) return;
    const hoverFilter = hoveredTrafficVolume
      ? ["all", ["==", ["get", "traffic_volume_id"], hoveredTrafficVolume], [">=", ["get", "max_fl"], flLowerBound], ["<=", ["get", "min_fl"], flUpperBound]]
      : ["==", ["get", "traffic_volume_id"], ""];
    if (mapRef.current.getLayer("sector-hover")) mapRef.current.setFilter("sector-hover", hoverFilter as any);
    if (mapRef.current.getLayer("sector-hover-outline")) mapRef.current.setFilter("sector-hover-outline", hoverFilter as any);
  }, [hoveredTrafficVolume]);

  // Update hotspot layers when hotspots/time/FL range changes
  useEffect(() => {
    if (!mapRef.current) return;
    const activeHotspots = getActiveHotspots();
    const hotspotTrafficVolumeIds = activeHotspots.map(h => h.traffic_volume_id);
    const hotspotFilter = hotspotTrafficVolumeIds.length > 0 
      ? [ "all", ["in", ["get", "traffic_volume_id"], ["literal", hotspotTrafficVolumeIds]], [">=", ["get", "max_fl"], flLowerBound], ["<=", ["get", "min_fl"], flUpperBound] ]
      : ["==", ["get", "traffic_volume_id"], ""];
    if (mapRef.current.getLayer("sector-hotspot")) mapRef.current.setFilter("sector-hotspot", hotspotFilter as any);
    if (mapRef.current.getLayer("sector-hotspot-outline")) mapRef.current.setFilter("sector-hotspot-outline", hotspotFilter as any);
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
      if (tvGeometry && tvGeometry.type === 'Polygon') {
        const coords = (tvGeometry as any).coordinates[0];
        let centerLon = 0, centerLat = 0;
        for (const coord of coords) { centerLon += coord[0]; centerLat += coord[1]; }
        const center: [number, number] = [centerLon / coords.length, centerLat / coords.length];
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
    </>
  );
}

function updateFlightLineFilters(map: maplibregl.Map | null) {
  if (!map || !map.isStyleLoaded()) return;
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
  if (sim.flowPreviewFlightId) {
    lineIdsToShow = [String(sim.flowPreviewFlightId)];
  } else if (sim.flowViewEnabled && sim.flowCommunities && Object.keys(sim.flowCommunities).length > 0) {
    const previewGroupId = sim.flowPreviewGroupId ? String(sim.flowPreviewGroupId) : null;
    if (previewGroupId) {
      // Preview mode: show only flights that belong to the hovered flow group
      let previewIds: string[] = [];
      if (sim.flowGroups && sim.flowGroups[previewGroupId]) {
        previewIds = (sim.flowGroups[previewGroupId] || []).map(String);
      } else {
        // Fallback: derive from communities mapping
        previewIds = Object.entries(sim.flowCommunities)
          .filter(([, cid]) => String(cid) === previewGroupId)
          .map(([fid]) => String(fid));
      }
      const previewSet = new Set(previewIds);
      lineIdsToShow = activeFlightIds.filter(fid => previewSet.has(String(fid)));
    } else {
      // No preview: show all flights included in any community (flow extraction)
      const communityIds = new Set<string>(Object.keys(sim.flowCommunities).map(String));
      lineIdsToShow = activeFlightIds.filter(fid => communityIds.has(String(fid)));
    }
  } else {
    lineIdsToShow = (sim.focusMode ? Array.from(sim.focusFlightIds) : activeFlightIds).map(String);
  }

  const filterExpr: any = [
    "match",
    ["to-string", ["get", "flightId"]],
    lineIdsToShow,
    true,
    false
  ];

  if (map.getLayer("flight-lines")) {
    map.setFilter("flight-lines", filterExpr as any);
    const inFocusContext = sim.focusMode || !!sim.selectedTrafficVolume;
    const baseOpacity = (sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.15) : 0;
    const lineOpacity = sim.flowViewEnabled ? 0.8 : baseOpacity;
    map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
  }
  if (map.getLayer("flight-line-labels")) {
    map.setFilter("flight-line-labels", filterExpr as any);
  }
}

// (Regulation highlight removed in FlowCanvas)

// Apply flow-based coloring to flight lines
function updateFlowRendering(map: maplibregl.Map | null) {
  if (!map || !map.isStyleLoaded()) return;
  const sim = useSimStore.getState();
  if (!map.getLayer('flight-lines')) return;

  if (sim.flowViewEnabled && sim.flowCommunities && Object.keys(sim.flowCommunities).length > 0) {
    // Use centralized community -> color mapping from store for consistency with UI
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

  // Dim/Hide traffic volume backgrounds when Flow View is enabled
  // Goal: make non-selected/non-hotspot sectors disappear to declutter the map
  const sectorFillId = 'sector-fill';
  const sectorOutlineId = 'sector-outline';
  const sectorLabelsId = 'sector-labels';

  if (sim.flowViewEnabled) {
    // Hide base sector fill/outline completely
    if (map.getLayer(sectorFillId)) {
      map.setPaintProperty(sectorFillId, 'fill-opacity', 0);
    }
    if (map.getLayer(sectorOutlineId)) {
      map.setPaintProperty(sectorOutlineId, 'line-opacity', 0);
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
      } else {
        // Data-driven opacity: 1 for selected/hotspot labels, 0 otherwise
        const labelOpacityExpr: any = [
          'case',
          ['in', ['to-string', ['get', 'label']], ['literal', allowedIds]],
          1,
          0
        ];
        map.setPaintProperty(sectorLabelsId, 'text-opacity', labelOpacityExpr as any);
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
  }
}

// (Slack overlay and helpers removed in FlowCanvas)
