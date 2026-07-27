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
import PageLoadingIndicator from "@/components/PageLoadingIndicator";
import { ensureSurfacePrecipHour, hideSurfacePrecipLayer, isoHourFrom } from "@/lib/weatherOverlay";
import { createMapStyle } from "@/lib/mapStyle";
import {
  addTrafficVolumeLayers,
  addTrafficVolumeSources,
  applyTrafficVolumeHighlightList,
  applyTrafficVolumeHotspots,
  applyTrafficVolumeVisibility,
  getTrafficVolumeCenter,
  getTrafficVolumeCenterFromMap,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "@/lib/trafficVolumeLayers";
import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";
import { deriveVisibleFlightLineIds } from "@/lib/flightCatcherPolicy";
import { getFlightLineVisibilitySnapshot } from "@/lib/flightVisibility";
import { formatSecondsToHHMMSS } from "@/lib/time";
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

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const tvSourcesRef = useRef<AirspaceSources | null>(null);
  const lastTs = useRef<number>(performance.now());
  const { t, resourceDate, weatherOverlay, tick, flights, showFlightLineLabels, flightLineLabelMode, showCallsigns, showWaypoints, showTrafficVolumes, setBaselineFlights, flLowerBound, flUpperBound, showHotspots, hotspots, getActiveHotspots, flowPreviewFlightId, flightLevelBinPreviewSegments, playing, focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume, selectedTrafficVolumes, toggleSelectedTrafficVolumeWithMode, setSelectedFlightForAnalysis, selectedFlightForAnalysis, alternativeRoutes, isAlternativeRoutesPanelOpen, hoveredAlternativeRoute, resourceStateEpoch, glanceHorizonMinutes } = useSimStore();
  const lastUpdateRef = useRef<number>(performance.now());

  const theme = useThemeStore((state) => state.theme);
  const resourcePaths = useMemo(
    () => (resourceDate ? getResourcePathsForDate(resourceDate) : null),
    [resourceDate],
  );

  const [baseDataLoading, setBaseDataLoading] = useState(true);
  const [visibleGlanceTvIds, setVisibleGlanceTvIds] = useState<string[]>([]);
  const [glanceCacheVersion, setGlanceCacheVersion] = useState(0);
  const [glanceTimeBinMinutes, setGlanceTimeBinMinutes] = useState(TV_DCB_GLANCE_DEFAULT_BIN_MINUTES);
  const glanceCacheRef = useRef<Map<string, TvDcbGlanceSummary | null>>(new Map());
  const glanceFetchSeqRef = useRef(0);
  const currentMinuteTick = useMemo(() => Math.floor(t / 60), [t]);
  const glanceReferenceBinSeconds = useMemo(() => {
    const safeBinMinutes = Math.max(1, Math.round(glanceTimeBinMinutes || TV_DCB_GLANCE_DEFAULT_BIN_MINUTES));
    const binSeconds = safeBinMinutes * 60;
    return Math.floor(Math.max(0, t) / binSeconds) * binSeconds;
  }, [glanceTimeBinMinutes, t]);

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
        const [sectors, tracks] = await Promise.all([
          loadSectors(resourcePaths.airspaceGeojson),
          loadTrajectories(resourcePaths.flightsCsv)
        ]);
        if (!loadGuard.isActive()) return;

        const activeTracks = setBaselineFlights(tracks);

      // --- Airspace polygons + labels ---
      tvSourcesRef.current = addTrafficVolumeSources(map, sectors);
      addTrafficVolumeLayers(map, theme, { pointLabelMinZoom: 24 });
      ensureTrafficVolumeDcbGlanceLayer(map, theme);

      applyTrafficVolumeVisibility(map, useSimStore.getState().showTrafficVolumes);

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
      // Apply initial plane label visibility based on store defaults
      try {
        const { showCallsigns } = useSimStore.getState();
        map.setPaintProperty("plane-icons", "text-opacity", showCallsigns ? 1 : 0);
        map.setPaintProperty("plane-icons", "text-halo-width", showCallsigns ? 2 : 0);
      } catch { }

      // Save trajectories on map for the animation step
      (map as any).__trajectories = activeTracks;

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
        const trafficVolumeId = getTrafficVolumeIdFromEvent(e);
        if (!trafficVolumeId) return;
        const mode =
          e.originalEvent && ("ctrlKey" in e.originalEvent) && (e.originalEvent.ctrlKey || e.originalEvent.metaKey)
            ? "or"
            : "and";
        selectTrafficVolume(trafficVolumeId, mode);
      };

      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeClick);
      map.on('click', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeClick);
      map.on('click', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeClick);

      map.on('click', 'plane-icons', (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const flightId = feature.properties?.flightId;
          if (flightId != null) {
            setSelectedFlightForAnalysis(String(flightId));
          }
        }
      });

      const handleTrafficVolumeHover = () => {
        map.getCanvas().style.cursor = 'pointer';
      };

      const handleTrafficVolumeHoverExit = () => {
        map.getCanvas().style.cursor = '';
      };

      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHover);
      map.on('mouseenter', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHover);
      map.on('mouseenter', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHover);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.label, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TV_DCB_GLANCE_LAYER_ID, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.pointLabel, handleTrafficVolumeHoverExit);
      map.on('mouseleave', TRAFFIC_VOLUME_LAYER_IDS.point, handleTrafficVolumeHoverExit);

      map.on('mouseenter', 'plane-icons', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'plane-icons', () => {
        map.getCanvas().style.cursor = '';
      });

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
        console.error("Failed to load predictions map data", error);
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
  useEffect(() => { updatePlanePositions(mapRef.current); }, [flowPreviewFlightId, flightLevelBinPreviewSegments]);

  // Refresh filters on focus/visibility changes
  useEffect(() => { updatePlanePositions(mapRef.current); }, [focusMode, focusFlightIds, showFlightLines, selectedTrafficVolume]);

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
      } catch (e) {
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
            showTrafficVolumes ? "visible" : "none",
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
  }, [showTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    glanceCacheRef.current.clear();
    glanceFetchSeqRef.current += 1;
    setGlanceCacheVersion((version) => version + 1);
    setGlanceTimeBinMinutes(TV_DCB_GLANCE_DEFAULT_BIN_MINUTES);
    setVisibleGlanceTvIds([]);
    setDcbGlanceSourceData(map, emptyPointFC());
  }, [resourceStateEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refreshVisibleIds = () => {
      const nextIds = collectVisibleTrafficVolumeIdsForGlance(map, {
        enabled: showTrafficVolumes,
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
  }, [resourceStateEpoch, showTrafficVolumes]);

  useEffect(() => {
    if (!showTrafficVolumes || visibleGlanceTvIds.length === 0) {
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
    if (!showTrafficVolumes || visibleGlanceTvIds.length === 0) {
      setDcbGlanceSourceData(map, emptyPointFC());
      return;
    }

    setDcbGlanceSourceData(
      map,
      buildTvDcbGlanceSourceData({
        centroids: tvSourcesRef.current?.centroids,
        visibleTvIds: visibleGlanceTvIds,
        getSummary: (tvId) =>
          glanceCacheRef.current.get(
            buildTvDcbGlanceCacheKey(tvId, resourceStateEpoch, glanceReferenceBinSeconds, glanceHorizonMinutes),
          ) ?? null,
        referenceSeconds: currentMinuteTick * 60,
      }),
    );
  }, [
    currentMinuteTick,
    glanceCacheVersion,
    glanceHorizonMinutes,
    glanceReferenceBinSeconds,
    resourceStateEpoch,
    showTrafficVolumes,
    visibleGlanceTvIds,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHighlightList(map, selectedTrafficVolumes);
  }, [selectedTrafficVolumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTrafficVolumeHotspots(
      map,
      getActiveHotspots(),
      flLowerBound,
      flUpperBound,
      true,
    );
  }, [flLowerBound, flUpperBound, getActiveHotspots, hotspots, showHotspots, t]);

  // on showWaypoints change, toggle waypoint visibility via paint properties
  useEffect(() => {
    if (mapRef.current) {
      if (mapRef.current.getLayer("wp-points")) {
        mapRef.current.setPaintProperty("wp-points", "circle-opacity", showWaypoints ? [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0.6,
          8, 0.8,
          12, 0.9
        ] : 0);
      }
      if (mapRef.current.getLayer("wp-labels")) {
        mapRef.current.setPaintProperty("wp-labels", "text-opacity", showWaypoints ? [
          "interpolate",
          ["linear"],
          ["zoom"],
          6, 0.7,
          10, 0.9,
          14, 1
        ] : 0);
        mapRef.current.setPaintProperty("wp-labels", "text-halo-width", showWaypoints ? 2 : 0);
      }
    }
  }, [showWaypoints]);



  // Render alternative route overlays when panel is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "alternative-routes";
    const lineLayerId = "alternative-routes-lines";

    const cleanup = () => {
      if (map.getLayer(lineLayerId)) {
        map.removeLayer(lineLayerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    };

    if (!isAlternativeRoutesPanelOpen || !alternativeRoutes || !selectedFlightForAnalysis) {
      cleanup();
      return;
    }

    const buildGeoJson = () => {
      const features: GeoJSON.Feature[] = [];

      Object.entries(alternativeRoutes).forEach(([routeStr, segments]) => {
        // If a route is hovered, only show that one
        if (hoveredAlternativeRoute && routeStr !== hoveredAlternativeRoute) {
          return;
        }

        if (!segments || segments.length === 0) {
          return;
        }

        const sortedSegments = [...segments].sort(
          (a, b) => a.time_begin_segment - b.time_begin_segment
        );
        const coords: [number, number][] = [];

        sortedSegments.forEach((segment, idx) => {
          if (idx === 0) {
            coords.push([segment.longitude_begin, segment.latitude_begin]);
          }
          coords.push([segment.longitude_end, segment.latitude_end]);
        });

        if (coords.length < 2) return;

        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            route: routeStr,
            isHovered: hoveredAlternativeRoute === routeStr,
          },
        } as GeoJSON.Feature);
      });

      return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
    };

    const applyVisualization = () => {
      const geoJsonData = buildGeoJson();
      if (!geoJsonData) {
        cleanup();
        return;
      }

      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geoJsonData as any);
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data: geoJsonData as any,
        });

        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": [
              "case",
              ["boolean", ["get", "isHovered"], false],
              "#3b82f6",
              "#fbbf24",
            ],
            "line-width": [
              "case",
              ["boolean", ["get", "isHovered"], false],
              4,
              2,
            ],
            "line-opacity": 0.9,
            "line-dasharray": [2, 2],
          },
        });
      }

      if (map.getLayer("plane-icons")) {
        map.moveLayer(lineLayerId, "plane-icons");
      }
    };

    if (map.isStyleLoaded()) {
      applyVisualization();
      return cleanup;
    }

    let cancelled = false;
    const waitForReady = () => {
      if (!map.isStyleLoaded()) return;
      map.off("styledata", waitForReady);
      if (!cancelled) {
        applyVisualization();
      }
    };

    map.on("styledata", waitForReady);
    return () => {
      cancelled = true;
      map.off("styledata", waitForReady);
      cleanup();
    };
  }, [alternativeRoutes, hoveredAlternativeRoute, isAlternativeRoutesPanelOpen, selectedFlightForAnalysis]);

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
    flowPreviewFlightId: sim.flowPreviewFlightId,
  });
  const hasFlightLevelBinPreview = sim.flightLevelBinPreviewSegments.length > 0;

  let filterExpr: any;
  if (hasFlightLevelBinPreview || lineIdsToShow.length === 0) {
    // Always-false filter when nothing should be shown
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
    const inFocusContext = sim.focusMode || !!sim.selectedTrafficVolume || !!sim.flowPreviewFlightId;
    const lineOpacity = hasFlightLevelBinPreview
      ? 0
      : sim.flowPreviewFlightId
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
