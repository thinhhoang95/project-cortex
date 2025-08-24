"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import * as turf from "@turf/turf";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";
import RegulationPlanPanel from "@/components/RegulationPlanPanel";

export default function RegulationCanvas() {
  const mapRef = useRef<maplibregl.Map|null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTs = useRef<number>(performance.now());
  const { t, tick, setRange, showFlightLineLabels, setFlights, setSelectedTrafficVolume, flLowerBound, flUpperBound, showHotspots, hotspots, getActiveHotspots, regulationTargetFlightIds, addRegulationTargetFlight, selectedTrafficVolume, isRegulationPanelOpen } = useSimStore();
  
  const [highlightedTrafficVolume, setHighlightedTrafficVolume] = useState<string | null>(null);
  const [hoveredTrafficVolume, setHoveredTrafficVolume] = useState<string | null>(null);
  const [slackSign, setSlackSign] = useState<"minus" | "plus">("minus");
  const [slackMode, setSlackMode] = useState<"off" | "minus" | "plus">("off");
  const [isFetchingSlack, setIsFetchingSlack] = useState<boolean>(false);
  const [deltaMin, setDeltaMin] = useState<number>(0);
  const [slackMetaByTv, setSlackMetaByTv] = useState<Record<string, { time_window: string; slack: number; occupancy: number }>>({});
  const [hoverLabelPoint, setHoverLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const lastSlackKeyRef = useRef<string | null>(null);
  const slackSignRef = useRef<"minus" | "plus">("minus");
  const slackModeRef = useRef<"off" | "minus" | "plus">("off");
  const deltaMinRef = useRef<number>(0);

  useEffect(() => { slackSignRef.current = slackSign; }, [slackSign]);
  useEffect(() => { slackModeRef.current = slackMode; }, [slackMode]);
  useEffect(() => { deltaMinRef.current = deltaMin; }, [deltaMin]);

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

      // Slack overlay layer (initially hidden). Place BELOW labels so clicks work.
      if (!map.getLayer("sector-slack")) {
        map.addLayer({
          id: "sector-slack",
          type: "fill",
          source: "sectors",
          layout: { visibility: "none" },
          paint: { "fill-color": "#facc15", "fill-opacity": 0.03 }
        }, "sector-labels");
      }

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

      // Click handler for flight lines: add to regulation target list when a TV is selected
      map.on('click', 'flight-lines', (e) => {
        const sim = useSimStore.getState();
        if (!sim.selectedTrafficVolume) return;
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
      map.on('mouseenter', 'flight-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'flight-lines', () => { map.getCanvas().style.cursor = ''; });

      // Helper to select traffic volume by id
      const selectTrafficVolume = (trafficVolumeId: string) => {
        const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', trafficVolumeId] });
        const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
        const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
        setSelectedTrafficVolume(trafficVolumeId, tvData);
        setHighlightedTrafficVolume(prev => prev === trafficVolumeId ? null : trafficVolumeId);
        // Trigger slack fetch immediately on selection (even if TV id unchanged)
        const simT = useSimStore.getState().t;
        const refStr = formatSecondsToHHMM(simT);
        const sign = slackSignRef.current;
        lastSlackKeyRef.current = `${trafficVolumeId}|${refStr}|${sign}|${deltaMinRef.current}`;
        const showNow = slackModeRef.current !== 'off';
        fetchAndApplySlack(map, trafficVolumeId, refStr, sign, deltaMinRef.current, setIsFetchingSlack, setSlackMetaByTv, showNow);
      };

      // Click handler: only labels select a TV (disallow fills/overlays)
      map.on('click', 'sector-labels', (e) => {
        // If a flight line (including highlighted) is under the cursor, let that take precedence
        const lineHits = map.queryRenderedFeatures(e.point, { layers: ['reg-target-lines', 'flight-lines'] });
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
          if (e.point && slackModeRef.current !== 'off') {
            setHoverLabelPoint({ x: (e.point as any).x, y: (e.point as any).y });
          }
        }
      });
      map.on('mousemove', 'sector-labels', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const trafficVolumeId = feature.properties?.label;
          if (trafficVolumeId) setHoveredTrafficVolume(trafficVolumeId);
        }
        if (e.point && slackModeRef.current !== 'off') {
          setHoverLabelPoint({ x: (e.point as any).x, y: (e.point as any).y });
        }
      });
      map.on('mouseleave', 'sector-labels', () => { map.getCanvas().style.cursor = ''; setHoveredTrafficVolume(null); setHoverLabelPoint(null); });
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
      updateRegulationHighlight(mapRef.current);
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
      if (mapRef.current.getLayer("sector-slack")) mapRef.current.setFilter("sector-slack", filterExpression);
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

  // Listen for dialog close events to clear highlighting and hide slack overlay
  useEffect(() => {
    const handleClearHighlight = () => {
      setHighlightedTrafficVolume(null);
      setSlackMode('off');
      if (mapRef.current) hideSlackOverlay(mapRef.current);
      lastSlackKeyRef.current = null;
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
      // Select TV and trigger slack fetch immediately
      const sectorFeatures = map.querySourceFeatures('sectors', { filter: ['==', 'traffic_volume_id', tvId] });
      const fullSectorFeature = sectorFeatures.length > 0 ? sectorFeatures[0] : null;
      const tvData = fullSectorFeature ? { properties: (fullSectorFeature.properties as any) as import("@/lib/models").SectorFeatureProps } : null;
      setSelectedTrafficVolume(tvId, tvData);
      setHighlightedTrafficVolume(tvId);
      const simT = useSimStore.getState().t;
      const refStr = formatSecondsToHHMM(simT);
      const sign = slackSignRef.current;
      lastSlackKeyRef.current = `${tvId}|${refStr}|${sign}|${deltaMinRef.current}`;
      const showNow = slackModeRef.current !== 'off';
      fetchAndApplySlack(map, tvId, refStr, sign, deltaMinRef.current, setIsFetchingSlack, setSlackMetaByTv, showNow);
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

  // Fetch and display slack distribution when TV is selected, highlighted, and sign/time changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedTrafficVolume || !highlightedTrafficVolume) { hideSlackOverlay(map); setSlackMode('off'); return; }
    const refStr = formatSecondsToHHMM(t);
    const key = `${selectedTrafficVolume}|${refStr}|${slackSign}|${deltaMin}`;
    if (lastSlackKeyRef.current === key) return;
    lastSlackKeyRef.current = key;
    const showNow = slackModeRef.current !== 'off';
    fetchAndApplySlack(map, selectedTrafficVolume, refStr, slackSign, deltaMin, setIsFetchingSlack, setSlackMetaByTv, showNow);
  }, [selectedTrafficVolume, highlightedTrafficVolume, slackSign, deltaMin, t]);

  // Show/hide slack overlay based on mode (Off/Minus/Plus)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (slackMode === 'off') {
      hideSlackOverlay(map);
    } else if (map.getLayer('sector-slack')) {
      map.setLayoutProperty('sector-slack', 'visibility', 'visible');
    }
  }, [slackMode]);

  return (
    <>
      <div id="map" className="absolute inset-0" />
      {/* Regulation Plan Panel */}
      <RegulationPlanPanel isRegulationPanelOpen={!!selectedTrafficVolume} />
      {/* Slack mode toggle: Off / Minus / Plus */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 transform bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-1 text-xs text-gray-200 flex items-center gap-1 shadow-md">
        <span className="px-2 text-gray-300">Slack View</span>
        <div className="w-px h-4 bg-white/30"></div>
        <button
          onClick={() => setSlackMode('off')}
          className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'off' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
          title="Turn off slack overlay"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>
          <span>Off</span>
        </button>
        <button
          onClick={() => { setSlackSign('minus'); setSlackMode('minus'); }}
          className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'minus' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
          title="Shift backward in time (minus)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path></svg>
          <span>Minus</span>
        </button>
        <button
          onClick={() => { setSlackSign('plus'); setSlackMode('plus'); }}
          className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'plus' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
          title="Shift forward in time (plus)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
          <span>Plus</span>
        </button>
        <div className="w-px h-4 bg-white/30"></div>
        <span className="px-2 text-gray-300">Delay</span>
        <select
          value={deltaMin}
          onChange={(e) => setDeltaMin(Number(e.target.value))}
          className="bg-transparent text-white text-xs focus:outline-none pl-3 pr-1 py-1 rounded-md hover:bg-white/10"
          title="Additional shift in minutes"
        >
          {(() => {
            const opts: number[] = [];
            for (let m = -90; m <= 90; m += 10) opts.push(m);
            for (let m = -25; m <= 25; m += 5) opts.push(m); // fill in -25,-20,-15,-10,-5,0,5,10,15,20,25 (with -30 and 30 already covered)
            const uniqueSorted = Array.from(new Set(opts)).sort((a,b) => a - b);
            return uniqueSorted.map((m) => (
              <option key={m} value={m} className="bg-slate-800 text-white">{m}</option>
            ));
          })()}
        </select>
        {isFetchingSlack && (
          <div className="ml-2 h-2 w-2 rounded-full bg-white/70 animate-pulse" title="Loading slack..." />
        )}
      </div>
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
      <div className="absolute bottom-4 left-4 bg-white-600/30 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2 text-xs text-gray-400 pointer-events-none">
        Regulation Design Mode
      </div>
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

  const lineIdsToShow: string[] = (sim.focusMode ? Array.from(sim.focusFlightIds) : activeFlightIds).map(String);

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
    const lineOpacity = (sim.showFlightLines || inFocusContext) ? (sim.focusMode ? 0.8 : 0.15) : 0;
    map.setPaintProperty("flight-lines", "line-opacity", lineOpacity);
  }
  if (map.getLayer("flight-line-labels")) {
    map.setFilter("flight-line-labels", filterExpr as any);
  }
}

function updateRegulationHighlight(map: maplibregl.Map | null) {
  if (!map || !map.isStyleLoaded()) return;
  const sim = useSimStore.getState();
  const ids = Array.from(sim.regulationTargetFlightIds).map(String);
  const filterExpr: any = ids.length > 0 ? ["in", ["to-string", ["get", "flightId"]], ["literal", ids]] : ["==", ["get", "flightId"], "__none__"];
  if (map.getLayer("reg-target-lines")) {
    map.setFilter("reg-target-lines", filterExpr as any);
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
    const resp = await fetch(url.toString());
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
    if (showImmediately) {
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
    }, 'sector-highlight');
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


