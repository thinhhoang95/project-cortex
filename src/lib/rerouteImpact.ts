import { authFetch } from "@/lib/auth";
import {
  computeHotspotDiffsFromRollingCounts,
  normalizeHotspotDiffs,
} from "@/lib/hotspotDiffs";
import type { WithHotspotDiffs } from "@/lib/models";
import type { Point2D, RerouteFunnel, RerouteObstacle } from "@/lib/rerouteGeometry";

export type RerouteImpactCommittedMoveLike = {
  id: string;
  affectedFlightIds: string[];
  obstacles: RerouteObstacle[];
  funnels: RerouteFunnel[];
};

export type RerouteImpactGeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      polygon_id: string;
      id: string;
      name: string;
    };
    geometry: {
      type: "Polygon";
      coordinates: number[][][];
    };
  }>;
};

export type RerouteImpactRequestPayload = {
  flight_ids: string[];
  barred_polygons: RerouteImpactGeoJsonFeatureCollection;
  include_capacity?: boolean;
  include_detoured_segments?: boolean;
  sampling_dist_nm?: number;
};

export type RerouteImpactPathPoint = {
  longitude: number;
  latitude: number;
  [extra: string]: unknown;
};

export type RerouteImpactDetouredSegment = {
  start?: RerouteImpactPathPoint;
  end?: RerouteImpactPathPoint;
  start_time?: string;
  end_time?: string;
  altitude_ft?: number;
  distance_nm?: number;
  elapsed_s?: number;
  [extra: string]: unknown;
};

export type RerouteImpactFlightInterval = {
  polygon_ids?: string[];
  original_path?: RerouteImpactPathPoint[];
  detour_path?: RerouteImpactPathPoint[];
  segments?: RerouteImpactDetouredSegment[];
  [extra: string]: unknown;
};

export type RerouteImpactPostTrajectory = {
  path: RerouteImpactPathPoint[];
  segments?: RerouteImpactDetouredSegment[];
  start_time?: string;
  end_time?: string;
  segment_count?: number;
  [extra: string]: unknown;
};

export type RerouteImpactDetouredFlight = {
  status?: string;
  interval_count?: number;
  intervals?: RerouteImpactFlightInterval[];
  post_trajectory?: RerouteImpactPostTrajectory;
  [extra: string]: unknown;
};

export type RerouteImpactDiagnosticsSummary = {
  requested_flight_count?: number;
  found_flight_count?: number;
  missing_flight_ids?: string[];
  processed_flight_count?: number;
  rerouted_flight_count?: number;
  unchanged_flight_count?: number;
  skipped_flight_count?: number;
  requested_polygon_count?: number;
  changed_tv_count?: number;
  [extra: string]: unknown;
};

export type RerouteImpactDiagnosticsFlight = {
  status?: string;
  blocked_interval_count?: number;
  polygons_touched?: string[];
  distance_delta_nm?: number;
  elapsed_delta_s?: number;
  [extra: string]: unknown;
};

export type RerouteImpactSeriesByTv = Record<string, number[]>;

export type RerouteImpactResponse = WithHotspotDiffs & {
  resource_date: string | null;
  time_bin_minutes: number;
  num_bins: number;
  flight_ids: string[];
  barred_polygon_ids: string[];
  tv_ids_order: string[];
  timebins: {
    labels: string[];
  };
  raw: {
    pre_counts: RerouteImpactSeriesByTv;
    post_counts: RerouteImpactSeriesByTv;
    delta_counts: RerouteImpactSeriesByTv;
  };
  rolling_hour: {
    pre_counts: RerouteImpactSeriesByTv;
    post_counts: RerouteImpactSeriesByTv;
    delta_counts: RerouteImpactSeriesByTv;
  };
  detoured_segments?: {
    included?: boolean;
    flight_count?: number;
    rerouted_flight_count?: number;
    flights?: Record<string, RerouteImpactDetouredFlight>;
  };
  diagnostics: {
    summary?: RerouteImpactDiagnosticsSummary;
    flights?: Record<string, RerouteImpactDiagnosticsFlight>;
  };
  capacity?: Record<string, number[]>;
};

export type RerouteImpactValidation = {
  canSimulate: boolean;
  reason: string | null;
  obstacleCount: number;
  affectedFlightCount: number;
  invalidObstacleIds: string[];
  hasFunnels: boolean;
};

export type RerouteImpactScenarioGroup = {
  signature: string;
  flightIds: string[];
  polygonIds: string[];
  requestBody: RerouteImpactRequestPayload;
};

type NormalizedScenarioObstacle = {
  polygonId: string;
  vertices: Point2D[];
};

const EPS = 1e-9;

export function buildRerouteImpactScenarioSignature(
  moves: RerouteImpactCommittedMoveLike[],
): string {
  const normalizedMoves = (moves || []).map((move) => ({
    id: String(move?.id ?? "").trim(),
    affectedFlightIds: normalizeIds(move?.affectedFlightIds || []),
    obstacles: (move?.obstacles || []).map((obstacle) => ({
      id: String(obstacle?.id ?? "").trim(),
      vertices: normalizePolygonVertices(obstacle?.vertices || []).map(formatPointForSignature),
    })),
    funnels: (move?.funnels || []).map((funnel) => ({
      id: String(funnel?.id ?? "").trim(),
      affinityPoint: isPoint(funnel?.affinityPoint)
        ? formatPointForSignature(funnel.affinityPoint)
        : "invalid",
      selectionPolyline: (funnel?.selectionPolyline || [])
        .filter(isPoint)
        .map(formatPointForSignature),
    })),
  }));

  return JSON.stringify(normalizedMoves);
}

export function validateRerouteImpactScenario(
  moves: RerouteImpactCommittedMoveLike[],
): RerouteImpactValidation {
  const invalidObstacleIds: string[] = [];
  let obstacleCount = 0;
  let hasFunnels = false;
  const flightIds = new Set<string>();

  for (const move of moves || []) {
    normalizeIds(move?.affectedFlightIds || []).forEach((flightId) => flightIds.add(flightId));

    if ((move?.funnels || []).length > 0) {
      hasFunnels = true;
    }

    for (const obstacle of move?.obstacles || []) {
      obstacleCount += 1;
      const polygonId = buildPolygonId(String(move?.id ?? ""), String(obstacle?.id ?? ""));
      const vertices = normalizePolygonVertices(obstacle?.vertices || []);
      if (!isConvexSimplePolygon(vertices)) {
        invalidObstacleIds.push(polygonId);
      }
    }
  }

  if ((moves || []).length === 0) {
    return {
      canSimulate: false,
      reason: "No committed reroute moves to simulate.",
      obstacleCount,
      affectedFlightCount: flightIds.size,
      invalidObstacleIds,
      hasFunnels,
    };
  }

  if (obstacleCount === 0) {
    return {
      canSimulate: false,
      reason: hasFunnels
        ? "Simulation is unavailable when committed reroutes contain funnels."
        : "Simulation requires at least one committed obstacle.",
      obstacleCount,
      affectedFlightCount: flightIds.size,
      invalidObstacleIds,
      hasFunnels,
    };
  }

  if (hasFunnels) {
    return {
      canSimulate: false,
      reason: "Simulation is unavailable when committed reroutes contain funnels.",
      obstacleCount,
      affectedFlightCount: flightIds.size,
      invalidObstacleIds,
      hasFunnels,
    };
  }

  if (invalidObstacleIds.length > 0) {
    return {
      canSimulate: false,
      reason: "Simulation is unavailable because one or more committed obstacles are not convex polygons.",
      obstacleCount,
      affectedFlightCount: flightIds.size,
      invalidObstacleIds,
      hasFunnels,
    };
  }

  if (flightIds.size === 0) {
    return {
      canSimulate: false,
      reason: "No affected flights are available to simulate.",
      obstacleCount,
      affectedFlightCount: flightIds.size,
      invalidObstacleIds,
      hasFunnels,
    };
  }

  return {
    canSimulate: true,
    reason: null,
    obstacleCount,
    affectedFlightCount: flightIds.size,
    invalidObstacleIds,
    hasFunnels,
  };
}

export function buildRerouteImpactScenarioGroups(
  moves: RerouteImpactCommittedMoveLike[],
): RerouteImpactScenarioGroup[] {
  const validation = validateRerouteImpactScenario(moves);
  if (!validation.canSimulate) {
    throw new Error(validation.reason || "Reroute impact simulation is unavailable.");
  }

  const polygonsByFlightId = new Map<string, Map<string, NormalizedScenarioObstacle>>();

  for (const move of moves || []) {
    const flightIds = normalizeIds(move?.affectedFlightIds || []);
    const obstacles = normalizeScenarioObstacles(move);
    if (flightIds.length === 0 || obstacles.length === 0) continue;

    for (const flightId of flightIds) {
      let flightPolygons = polygonsByFlightId.get(flightId);
      if (!flightPolygons) {
        flightPolygons = new Map<string, NormalizedScenarioObstacle>();
        polygonsByFlightId.set(flightId, flightPolygons);
      }

      for (const obstacle of obstacles) {
        flightPolygons.set(obstacle.polygonId, obstacle);
      }
    }
  }

  const groupsBySignature = new Map<string, RerouteImpactScenarioGroup>();
  for (const [flightId, polygonMap] of polygonsByFlightId.entries()) {
    const polygons = Array.from(polygonMap.values()).sort((a, b) => a.polygonId.localeCompare(b.polygonId));
    if (polygons.length === 0) continue;

    const polygonIds = polygons.map((polygon) => polygon.polygonId);
    const signature = polygonIds.join("|");
    const existing = groupsBySignature.get(signature);
    if (existing) {
      existing.flightIds.push(flightId);
      continue;
    }

    groupsBySignature.set(signature, {
      signature,
      flightIds: [flightId],
      polygonIds,
      requestBody: {
        flight_ids: [flightId],
        barred_polygons: {
          type: "FeatureCollection",
          features: polygons.map((polygon) => ({
            type: "Feature",
            properties: {
              polygon_id: polygon.polygonId,
              id: polygon.polygonId,
              name: polygon.polygonId,
            },
            geometry: {
              type: "Polygon",
              coordinates: [closeRing(polygon.vertices)],
            },
          })),
        },
        include_capacity: true,
        include_detoured_segments: true,
      },
    });
  }

  const groups = Array.from(groupsBySignature.values());
  for (const group of groups) {
    group.requestBody.flight_ids = [...group.flightIds];
  }
  return groups;
}

export async function simulateRerouteImpactScenario(
  moves: RerouteImpactCommittedMoveLike[],
): Promise<RerouteImpactResponse> {
  const groups = buildRerouteImpactScenarioGroups(moves);
  if (groups.length === 0) {
    throw new Error("No committed obstacle scenario could be built for simulation.");
  }

  const responses = await Promise.all(
    groups.map(async (group) => {
      const response = await authFetch("/api/reroute_impact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(group.requestBody),
      });

      if (!response.ok) {
        throw new Error(await readRerouteImpactError(response));
      }

      return (await response.json()) as RerouteImpactResponse;
    }),
  );

  return mergeGroupedRerouteImpactResponses(groups, responses);
}

export function mergeGroupedRerouteImpactResponses(
  groups: RerouteImpactScenarioGroup[],
  responses: RerouteImpactResponse[],
): RerouteImpactResponse {
  if (groups.length !== responses.length) {
    throw new Error("Grouped reroute impact responses are misaligned.");
  }
  if (responses.length === 0) {
    throw new Error("No reroute impact responses were provided.");
  }

  const first = responses[0];
  const numBins = toFiniteInteger(first.num_bins, "num_bins");
  const labels = normalizeLabels(first.timebins?.labels, numBins);
  const preferredTvOrder: string[] = [];
  const preferredTvSeen = new Set<string>();
  const polygonIds: string[] = [];
  const polygonSeen = new Set<string>();
  const requestedFlightIds: string[] = [];
  const requestedFlightSeen = new Set<string>();
  const mergedRawPre: RerouteImpactSeriesByTv = {};
  const mergedRawPost: RerouteImpactSeriesByTv = {};
  const mergedRawDelta: RerouteImpactSeriesByTv = {};
  const mergedRollingPre: RerouteImpactSeriesByTv = {};
  const mergedRollingPost: RerouteImpactSeriesByTv = {};
  const mergedRollingDelta: RerouteImpactSeriesByTv = {};
  const mergedCapacity: Record<string, number[]> = {};
  const mergedDetouredFlights = new Map<string, RerouteImpactDetouredFlight>();
  const mergedDiagnosticFlights = new Map<string, RerouteImpactDiagnosticsFlight>();
  const missingFlightIds: string[] = [];
  const missingSeen = new Set<string>();
  const summedSummary: Record<string, number> = {};
  const seenSummaryField = new Set<string>();
  let detouredIncluded = false;

  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    const group = groups[index];
    assertCompatibleMetadata(first, response, labels);

    for (const flightId of group.flightIds) {
      if (!requestedFlightSeen.has(flightId)) {
        requestedFlightSeen.add(flightId);
        requestedFlightIds.push(flightId);
      }
    }

    for (const polygonId of group.polygonIds) {
      if (!polygonSeen.has(polygonId)) {
        polygonSeen.add(polygonId);
        polygonIds.push(polygonId);
      }
    }

    collectPreferredTvOrder(preferredTvOrder, preferredTvSeen, response.tv_ids_order || []);
    collectPreferredTvOrder(preferredTvOrder, preferredTvSeen, Object.keys(response.raw?.delta_counts || {}));

    mergeSeriesMap(mergedRawPre, response.raw?.pre_counts || {}, numBins, "raw.pre_counts");
    mergeSeriesMap(mergedRawPost, response.raw?.post_counts || {}, numBins, "raw.post_counts");
    mergeSeriesMap(mergedRawDelta, response.raw?.delta_counts || {}, numBins, "raw.delta_counts");
    mergeSeriesMap(mergedRollingPre, response.rolling_hour?.pre_counts || {}, numBins, "rolling_hour.pre_counts");
    mergeSeriesMap(mergedRollingPost, response.rolling_hour?.post_counts || {}, numBins, "rolling_hour.post_counts");
    mergeSeriesMap(mergedRollingDelta, response.rolling_hour?.delta_counts || {}, numBins, "rolling_hour.delta_counts");
    mergeCapacityMap(mergedCapacity, response.capacity || {}, numBins);

    if (response.detoured_segments?.included) {
      detouredIncluded = true;
    }
    for (const [flightId, detouredFlight] of Object.entries(response.detoured_segments?.flights || {})) {
      if (mergedDetouredFlights.has(flightId)) {
        throw new Error(`Duplicate detoured_segments entry for flight ${flightId}.`);
      }
      mergedDetouredFlights.set(flightId, detouredFlight);
    }

    for (const [flightId, diagnosticFlight] of Object.entries(response.diagnostics?.flights || {})) {
      if (mergedDiagnosticFlights.has(flightId)) {
        throw new Error(`Duplicate diagnostics.flights entry for flight ${flightId}.`);
      }
      mergedDiagnosticFlights.set(flightId, diagnosticFlight);
    }

    const summary = response.diagnostics?.summary;
    for (const missingFlightId of normalizeIds(summary?.missing_flight_ids || [])) {
      if (missingSeen.has(missingFlightId)) continue;
      missingSeen.add(missingFlightId);
      missingFlightIds.push(missingFlightId);
    }

    addSummaryField(summary, "found_flight_count", summedSummary, seenSummaryField);
    addSummaryField(summary, "processed_flight_count", summedSummary, seenSummaryField);
    addSummaryField(summary, "rerouted_flight_count", summedSummary, seenSummaryField);
    addSummaryField(summary, "unchanged_flight_count", summedSummary, seenSummaryField);
    addSummaryField(summary, "skipped_flight_count", summedSummary, seenSummaryField);
  }

  const detouredFlightsObject = Object.fromEntries(mergedDetouredFlights.entries());
  const diagnosticsFlightsObject = Object.fromEntries(mergedDiagnosticFlights.entries());
  const reroutedCountFromStatuses = countFlightStatuses(detouredFlightsObject, diagnosticsFlightsObject, "rerouted");
  const unchangedCountFromStatuses = countFlightStatuses(detouredFlightsObject, diagnosticsFlightsObject, "unchanged");
  const skippedCountFromStatuses = countFlightStatuses(detouredFlightsObject, diagnosticsFlightsObject, "skipped");
  const foundFlightFallback = Math.max(0, requestedFlightIds.length - missingFlightIds.length);
  const processedFlightFallback = Math.max(
    foundFlightFallback,
    Object.keys(detouredFlightsObject).length,
    Object.keys(diagnosticsFlightsObject).length,
  );
  const tvIdsOrder = recomputeTvIdsOrder(mergedRawDelta, preferredTvOrder);
  const mergedHotspotDiffs = computeHotspotDiffsFromRollingCounts({
    preCounts: mergedRollingPre,
    postCounts: mergedRollingPost,
    capacity: mergedCapacity,
    tvOrder: tvIdsOrder,
    binMinutes: toFiniteInteger(first.time_bin_minutes, "time_bin_minutes"),
  });

  const mergedResponse: RerouteImpactResponse = {
    resource_date: first.resource_date ?? null,
    time_bin_minutes: toFiniteInteger(first.time_bin_minutes, "time_bin_minutes"),
    num_bins: numBins,
    flight_ids: requestedFlightIds,
    barred_polygon_ids: polygonIds,
    tv_ids_order: tvIdsOrder,
    timebins: {
      labels,
    },
    raw: {
      pre_counts: mergedRawPre,
      post_counts: mergedRawPost,
      delta_counts: mergedRawDelta,
    },
    rolling_hour: {
      pre_counts: mergedRollingPre,
      post_counts: mergedRollingPost,
      delta_counts: mergedRollingDelta,
    },
    diagnostics: {
      summary: {
        requested_flight_count: requestedFlightIds.length,
        found_flight_count: resolveSummaryField(
          "found_flight_count",
          summedSummary,
          seenSummaryField,
          foundFlightFallback,
        ),
        missing_flight_ids: missingFlightIds,
        processed_flight_count: resolveSummaryField(
          "processed_flight_count",
          summedSummary,
          seenSummaryField,
          processedFlightFallback,
        ),
        rerouted_flight_count: resolveSummaryField(
          "rerouted_flight_count",
          summedSummary,
          seenSummaryField,
          reroutedCountFromStatuses,
        ),
        unchanged_flight_count: resolveSummaryField(
          "unchanged_flight_count",
          summedSummary,
          seenSummaryField,
          unchangedCountFromStatuses,
        ),
        skipped_flight_count: resolveSummaryField(
          "skipped_flight_count",
          summedSummary,
          seenSummaryField,
          skippedCountFromStatuses,
        ),
        requested_polygon_count: polygonIds.length,
        changed_tv_count: tvIdsOrder.length,
      },
      flights: diagnosticsFlightsObject,
    },
    ...normalizeHotspotDiffs(mergedHotspotDiffs),
  };

  if (detouredIncluded || mergedDetouredFlights.size > 0) {
    mergedResponse.detoured_segments = {
      included: detouredIncluded || mergedDetouredFlights.size > 0,
      flight_count: requestedFlightIds.length,
      rerouted_flight_count: reroutedCountFromStatuses,
      flights: detouredFlightsObject,
    };
  }

  if (Object.keys(mergedCapacity).length > 0) {
    mergedResponse.capacity = mergedCapacity;
  }

  return mergedResponse;
}

export function extractRerouteImpactOverlayFeatures(
  result: RerouteImpactResponse | null | undefined,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  const toFiniteLineStringCoordinates = (
    path: RerouteImpactPathPoint[] | null | undefined,
  ): number[][] => {
    const coordinates: number[][] = [];
    for (const point of Array.isArray(path) ? path : []) {
      const longitude = Number(point?.longitude);
      const latitude = Number(point?.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        continue;
      }
      coordinates.push([longitude, latitude]);
    }
    return coordinates;
  };

  for (const [flightId, flight] of Object.entries(result?.detoured_segments?.flights ?? {})) {
    const pathCoordinates = toFiniteLineStringCoordinates(flight?.post_trajectory?.path);
    if (pathCoordinates.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: pathCoordinates,
        },
        properties: {
          source: "reroute_impact",
          kind: "rerouted-flight-path",
          flightId,
          status: typeof flight.status === "string" ? flight.status : "unknown",
        },
      });
      continue;
    }

    // Fallback for older servers that don't return post_trajectory
    for (const interval of flight?.intervals ?? []) {
      const detourCoordinates = toFiniteLineStringCoordinates(interval?.detour_path);
      if (detourCoordinates.length >= 2) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: detourCoordinates,
          },
          properties: {
            source: "reroute_impact",
            kind: "reroute-interval",
            flightId,
            status: typeof flight.status === "string" ? flight.status : "unknown",
          },
        });
      }
    }
  }

  return features;
}

async function readRerouteImpactError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return `Reroute impact request failed: ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text);
    const message = parsed?.details ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (message) {
      return `Reroute impact request failed: ${response.status} ${String(message)}`;
    }
  } catch {
    // Ignore invalid JSON and fall back to raw text.
  }

  return `Reroute impact request failed: ${response.status} ${text}`;
}

function normalizeScenarioObstacles(
  move: RerouteImpactCommittedMoveLike,
): NormalizedScenarioObstacle[] {
  const out: NormalizedScenarioObstacle[] = [];
  for (const obstacle of move?.obstacles || []) {
    const vertices = normalizePolygonVertices(obstacle?.vertices || []);
    if (!isConvexSimplePolygon(vertices)) continue;
    out.push({
      polygonId: buildPolygonId(String(move?.id ?? ""), String(obstacle?.id ?? "")),
      vertices,
    });
  }
  return out;
}

function buildPolygonId(moveId: string, obstacleId: string): string {
  const normalizedMoveId = String(moveId || "").trim() || "MOVE";
  const normalizedObstacleId = String(obstacleId || "").trim() || "OBSTACLE";
  return `${normalizedMoveId}:${normalizedObstacleId}`;
}

function formatPointForSignature(point: Point2D): string {
  return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
}

function normalizeIds(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizePolygonVertices(vertices: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const point of vertices || []) {
    if (!isPoint(point)) continue;
    const normalized: Point2D = [Number(point[0]), Number(point[1])];
    const previous = out[out.length - 1];
    if (previous && pointsEqual(previous, normalized)) continue;
    out.push(normalized);
  }

  while (out.length > 1 && pointsEqual(out[0], out[out.length - 1])) {
    out.pop();
  }

  return out;
}

function closeRing(vertices: Point2D[]): number[][] {
  if (vertices.length === 0) return [];
  const ring = vertices.map((vertex) => [vertex[0], vertex[1]]);
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (!pointsEqual(first, last)) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function isConvexSimplePolygon(vertices: Point2D[]): boolean {
  if (vertices.length < 3) return false;
  if (!isSimplePolygon(vertices)) return false;

  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const c = vertices[(index + 2) % vertices.length];
    const cross = crossProduct(a, b, c);
    if (Math.abs(cross) <= EPS) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
      continue;
    }
    if (sign !== currentSign) return false;
  }

  return sign !== 0;
}

function isSimplePolygon(vertices: Point2D[]): boolean {
  const count = vertices.length;
  if (count < 3) return false;

  for (let index = 0; index < count; index += 1) {
    const a1 = vertices[index];
    const a2 = vertices[(index + 1) % count];

    for (let other = index + 1; other < count; other += 1) {
      const b1 = vertices[other];
      const b2 = vertices[(other + 1) % count];

      if (index === other) continue;
      if ((index + 1) % count === other) continue;
      if (index === (other + 1) % count) continue;

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }

  return polygonArea(vertices) > EPS;
}

function polygonArea(vertices: Point2D[]): number {
  let sum = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(sum) / 2;
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) <= EPS) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point2D, b: Point2D, c: Point2D): boolean {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPS &&
    b[0] + EPS >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + EPS &&
    b[1] + EPS >= Math.min(a[1], c[1])
  );
}

function crossProduct(a: Point2D, b: Point2D, c: Point2D): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

function isPoint(value: unknown): value is Point2D {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
}

function assertCompatibleMetadata(
  base: RerouteImpactResponse,
  next: RerouteImpactResponse,
  expectedLabels: string[],
): void {
  if ((base.resource_date ?? null) !== (next.resource_date ?? null)) {
    throw new Error("Reroute impact responses use different resource dates and cannot be merged.");
  }
  if (toFiniteInteger(base.time_bin_minutes, "time_bin_minutes") !== toFiniteInteger(next.time_bin_minutes, "time_bin_minutes")) {
    throw new Error("Reroute impact responses use different time_bin_minutes and cannot be merged.");
  }
  if (toFiniteInteger(base.num_bins, "num_bins") !== toFiniteInteger(next.num_bins, "num_bins")) {
    throw new Error("Reroute impact responses use different num_bins and cannot be merged.");
  }
  const nextLabels = normalizeLabels(next.timebins?.labels, expectedLabels.length);
  if (nextLabels.length !== expectedLabels.length) {
    throw new Error("Reroute impact responses use different time-bin labels and cannot be merged.");
  }
  for (let index = 0; index < expectedLabels.length; index += 1) {
    if (expectedLabels[index] !== nextLabels[index]) {
      throw new Error("Reroute impact responses use different time-bin labels and cannot be merged.");
    }
  }
}

function normalizeLabels(labels: string[] | undefined, expectedLength: number): string[] {
  if (!Array.isArray(labels)) {
    throw new Error("Reroute impact response is missing time-bin labels.");
  }
  if (labels.length !== expectedLength) {
    throw new Error("Reroute impact response returned an unexpected number of time-bin labels.");
  }
  return labels.map((label) => String(label));
}

function toFiniteInteger(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Reroute impact response field ${fieldName} is not finite.`);
  }
  return Math.trunc(num);
}

function collectPreferredTvOrder(order: string[], seen: Set<string>, tvIds: string[]): void {
  for (const tvId of tvIds || []) {
    const normalized = String(tvId ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    order.push(normalized);
  }
}

function mergeSeriesMap(
  target: RerouteImpactSeriesByTv,
  incoming: RerouteImpactSeriesByTv,
  numBins: number,
  fieldName: string,
): void {
  for (const [tvIdRaw, series] of Object.entries(incoming || {})) {
    const tvId = String(tvIdRaw ?? "").trim();
    if (!tvId) continue;
    const normalizedSeries = normalizeSeries(series, numBins, `${fieldName}.${tvId}`);
    if (!target[tvId]) {
      target[tvId] = normalizedSeries.slice();
      continue;
    }
    for (let index = 0; index < numBins; index += 1) {
      target[tvId][index] += normalizedSeries[index];
    }
  }
}

function normalizeSeries(series: number[], numBins: number, fieldName: string): number[] {
  if (!Array.isArray(series)) {
    throw new Error(`Reroute impact response field ${fieldName} is not an array.`);
  }
  if (series.length !== numBins) {
    throw new Error(`Reroute impact response field ${fieldName} has length ${series.length}, expected ${numBins}.`);
  }

  return series.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Reroute impact response field ${fieldName} contains a non-finite value.`);
    }
    return numeric;
  });
}

function mergeCapacityMap(
  target: Record<string, number[]>,
  incoming: Record<string, number[]>,
  numBins: number,
): void {
  for (const [tvIdRaw, series] of Object.entries(incoming || {})) {
    const tvId = String(tvIdRaw ?? "").trim();
    if (!tvId) continue;
    const normalizedSeries = normalizeSeries(series, numBins, `capacity.${tvId}`);
    const existing = target[tvId];
    if (!existing) {
      target[tvId] = normalizedSeries.slice();
      continue;
    }
    if (!numberArraysEqual(existing, normalizedSeries)) {
      throw new Error(`Capacity mismatch detected for traffic volume ${tvId}.`);
    }
  }
}

function numberArraysEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > EPS) return false;
  }
  return true;
}

function addSummaryField(
  summary: RerouteImpactDiagnosticsSummary | undefined,
  fieldName: keyof RerouteImpactDiagnosticsSummary,
  target: Record<string, number>,
  seenFields: Set<string>,
): void {
  const value = Number(summary?.[fieldName]);
  if (!Number.isFinite(value)) return;
  const key = String(fieldName);
  seenFields.add(key);
  target[key] = (target[key] || 0) + value;
}

function resolveSummaryField(
  fieldName: string,
  summed: Record<string, number>,
  seenFields: Set<string>,
  fallback: number,
): number {
  if (seenFields.has(fieldName)) {
    return Math.trunc(summed[fieldName] || 0);
  }
  return Math.trunc(fallback);
}

function countFlightStatuses(
  detouredFlights: Record<string, RerouteImpactDetouredFlight>,
  diagnosticsFlights: Record<string, RerouteImpactDiagnosticsFlight>,
  status: string,
): number {
  const seen = new Set<string>();
  let count = 0;

  for (const [flightId, detouredFlight] of Object.entries(detouredFlights || {})) {
    if (String(detouredFlight?.status ?? "") !== status) continue;
    seen.add(flightId);
    count += 1;
  }

  for (const [flightId, diagnosticFlight] of Object.entries(diagnosticsFlights || {})) {
    if (seen.has(flightId)) continue;
    if (String(diagnosticFlight?.status ?? "") !== status) continue;
    seen.add(flightId);
    count += 1;
  }

  return count;
}

function recomputeTvIdsOrder(
  deltaCounts: RerouteImpactSeriesByTv,
  preferredOrder: string[],
): string[] {
  const orderIndex = new Map<string, number>();
  preferredOrder.forEach((tvId, index) => orderIndex.set(tvId, index));

  return Object.keys(deltaCounts || {})
    .filter((tvId) => (deltaCounts[tvId] || []).some((value) => Math.abs(Number(value) || 0) > EPS))
    .sort((left, right) => {
      const leftIndex = orderIndex.get(left);
      const rightIndex = orderIndex.get(right);
      if (leftIndex !== undefined && rightIndex !== undefined && leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return left.localeCompare(right);
    });
}

function toCoordinateList(points: RerouteImpactPathPoint[]): number[][] {
  const coordinates: number[][] = [];
  for (const point of points || []) {
    const longitude = Number(point?.longitude);
    const latitude = Number(point?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const candidate = [longitude, latitude];
    const previous = coordinates[coordinates.length - 1];
    if (previous && Math.abs(previous[0] - candidate[0]) <= EPS && Math.abs(previous[1] - candidate[1]) <= EPS) {
      continue;
    }
    coordinates.push(candidate);
  }
  return coordinates;
}
