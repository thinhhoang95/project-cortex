import type { Trajectory } from "@/lib/models";

export type Point2D = [number, number];

export interface RerouteSegment {
  start: Point2D;
  end: Point2D;
}

export interface RerouteObstacle {
  id: string;
  vertices: Point2D[];
}

export interface RerouteFunnel {
  id: string;
  center: Point2D;
  radiusNm: number;
}

export interface RerouteFlightResult {
  flightId: string;
  originalPath: Point2D[];
  reroutedPath: Point2D[];
  oldSegments: RerouteSegment[];
  newSegments: RerouteSegment[];
  extraNm: number;
  warnings: string[];
}

export interface RerouteGeometryResult {
  generatedAtEpochMs: number;
  selectedFlightIds: string[];
  obstacleCount: number;
  funnelCount: number;
  changedFlightCount: number;
  totalExtraNm: number;
  flights: RerouteFlightResult[];
}

export interface ComputeRerouteGeometryParams {
  trajectories: Trajectory[];
  selectedFlightIds: Iterable<string>;
  obstacles: RerouteObstacle[];
  funnels: RerouteFunnel[];
}

export interface ComputeRerouteGeometryAsyncOptions {
  signal?: AbortSignal | null;
  batchSize?: number;
  maxBlockingMs?: number;
}

interface WorkingFlight {
  flightId: string;
  originalPoints: Point2D[];
  points: Point2D[];
  oldSegments: RerouteSegment[];
  newSegments: RerouteSegment[];
  extraNm: number;
  warnings: string[];
}

const EPS = 1e-7;

export function computeRerouteGeometry(params: ComputeRerouteGeometryParams): RerouteGeometryResult {
  const prepared = prepareRerouteGeometry(params);
  processWorkingFlights(prepared.flights, prepared.obstacles, prepared.funnels);
  return finalizeRerouteGeometryResult(prepared);
}

export async function computeRerouteGeometryAsync(
  params: ComputeRerouteGeometryParams,
  options: ComputeRerouteGeometryAsyncOptions = {},
): Promise<RerouteGeometryResult> {
  const prepared = prepareRerouteGeometry(params);
  const signal = options.signal ?? null;
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 8));
  const maxBlockingMs = Math.max(4, Number.isFinite(options.maxBlockingMs) ? Number(options.maxBlockingMs) : 12);
  let lastYieldAt = nowMs();

  for (let index = 0; index < prepared.flights.length; index += 1) {
    throwIfAborted(signal);
    const flight = prepared.flights[index];
    applyObstacles(flight, prepared.obstacles);
    applyFunnelsInAlongPathOrder(flight, prepared.funnels);

    const shouldYield =
      (index + 1) % batchSize === 0 ||
      nowMs() - lastYieldAt >= maxBlockingMs;
    if (shouldYield && index < prepared.flights.length - 1) {
      await yieldToMainThread();
      lastYieldAt = nowMs();
    }
  }

  throwIfAborted(signal);
  return finalizeRerouteGeometryResult(prepared);
}

function prepareRerouteGeometry(params: ComputeRerouteGeometryParams) {
  const selectedFlightIds = normalizeIds(params.selectedFlightIds);
  const obstacles = normalizeObstacles(params.obstacles);
  const funnels = normalizeFunnels(params.funnels);

  const byFlight = new Map<string, Trajectory>();
  for (const trajectory of params.trajectories || []) {
    const flightId = String(trajectory?.flightId ?? "").trim();
    if (!flightId || byFlight.has(flightId)) continue;
    byFlight.set(flightId, trajectory);
  }

  const flights: WorkingFlight[] = [];
  for (const flightId of selectedFlightIds) {
    const trajectory = byFlight.get(flightId);
    if (!trajectory) continue;
    const points = toUniquePointList(trajectory.coords || []);
    if (points.length < 2) continue;
    flights.push({
      flightId,
      originalPoints: clonePointList(points),
      points: clonePointList(points),
      oldSegments: [],
      newSegments: [],
      extraNm: 0,
      warnings: [],
    });
  }

  return {
    selectedFlightIds,
    obstacles,
    funnels,
    flights,
  };
}

function processWorkingFlights(
  flights: WorkingFlight[],
  obstacles: RerouteObstacle[],
  funnels: RerouteFunnel[],
) {
  for (const flight of flights) {
    applyObstacles(flight, obstacles);
    applyFunnelsInAlongPathOrder(flight, funnels);
  }
}

function finalizeRerouteGeometryResult(prepared: {
  selectedFlightIds: string[];
  obstacles: RerouteObstacle[];
  funnels: RerouteFunnel[];
  flights: WorkingFlight[];
}): RerouteGeometryResult {
  const { selectedFlightIds, obstacles, funnels, flights } = prepared;
  const changedFlights: RerouteFlightResult[] = flights
    .filter((flight) => flight.oldSegments.length > 0)
    .map((flight) => ({
      flightId: flight.flightId,
      originalPath: clonePointList(flight.originalPoints),
      reroutedPath: clonePointList(flight.points),
      oldSegments: flight.oldSegments,
      newSegments: flight.newSegments,
      extraNm: roundTo3(flight.extraNm),
      warnings: dedupeStrings(flight.warnings),
    }));

  const totalExtraNm = roundTo3(
    changedFlights.reduce((sum, flight) => sum + (Number.isFinite(flight.extraNm) ? flight.extraNm : 0), 0)
  );

  return {
    generatedAtEpochMs: Date.now(),
    selectedFlightIds,
    obstacleCount: obstacles.length,
    funnelCount: funnels.length,
    changedFlightCount: changedFlights.length,
    totalExtraNm,
    flights: changedFlights,
  };
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function throwIfAborted(signal: AbortSignal | null | undefined) {
  if (!signal?.aborted) return;
  const error = new Error("Reroute geometry computation aborted.");
  error.name = "AbortError";
  throw error;
}

function applyObstacles(flight: WorkingFlight, obstacles: RerouteObstacle[]) {
  for (const obstacle of obstacles) {
    const polygon = ensureClosedPolygon(obstacle.vertices);
    if (polygon.length < 4) continue;
    flight.points = buildObstacleDetourPoints(flight, obstacle.id, polygon);
  }
}

function buildObstacleDetourPoints(
  flight: WorkingFlight,
  obstacleId: string,
  polygon: Point2D[],
): Point2D[] {
  const sourcePoints = flight.points;
  if (sourcePoints.length < 2) return sourcePoints;

  const nextPoints: Point2D[] = [sourcePoints[0]];
  let cursor = 0;

  while (cursor < sourcePoints.length - 1) {
    const span = findNextObstacleSpan(sourcePoints, polygon, cursor);
    if (!span) {
      appendPointRange(nextPoints, sourcePoints, cursor + 1, sourcePoints.length - 1);
      break;
    }

    appendPointRange(nextPoints, sourcePoints, cursor + 1, span.startIndex);
    const a = sourcePoints[span.startIndex];
    const b = sourcePoints[span.endIndex];

    if (!pointStrictlyOutsideObstacle(a, polygon) || !pointStrictlyOutsideObstacle(b, polygon)) {
      flight.warnings.push(
        `Obstacle ${obstacleId}: cannot bypass blocked span ${span.startIndex}-${span.endIndex}.`
      );
      appendPointRange(nextPoints, sourcePoints, span.startIndex + 1, span.endIndex);
      cursor = span.endIndex;
      continue;
    }

    const candidate = chooseBestDetourVertex(a, b, polygon);
    if (!candidate) {
      flight.warnings.push(
        `Obstacle ${obstacleId}: no valid 1-vertex detour for blocked span ${span.startIndex}-${span.endIndex}.`
      );
      appendPointRange(nextPoints, sourcePoints, span.startIndex + 1, span.endIndex);
      cursor = span.endIndex;
      continue;
    }

    let oldPathNm = 0;
    for (let idx = span.startIndex; idx < span.endIndex; idx += 1) {
      const from = sourcePoints[idx];
      const to = sourcePoints[idx + 1];
      oldPathNm += distanceNm(from, to);
      flight.oldSegments.push({ start: from, end: to });
    }

    const newPathNm = distanceNm(a, candidate.vertex) + distanceNm(candidate.vertex, b);
    flight.newSegments.push({ start: a, end: candidate.vertex });
    flight.newSegments.push({ start: candidate.vertex, end: b });
    flight.extraNm += Math.max(0, newPathNm - oldPathNm);

    appendPoint(nextPoints, candidate.vertex);
    appendPoint(nextPoints, b);
    cursor = span.endIndex;
  }

  return nextPoints;
}

function findNextObstacleSpan(
  points: Point2D[],
  polygon: Point2D[],
  searchFrom: number,
): { startIndex: number; endIndex: number } | null {
  for (let segIdx = searchFrom; segIdx < points.length - 1; segIdx += 1) {
    const a = points[segIdx];
    const b = points[segIdx + 1];
    if (!segmentRequiresObstacleDetour(a, b, polygon)) continue;

    let startIndex = segIdx;
    while (startIndex > searchFrom && !pointStrictlyOutsideObstacle(points[startIndex], polygon)) {
      startIndex -= 1;
    }

    let endIndex = segIdx + 1;
    while (endIndex < points.length - 1 && !pointStrictlyOutsideObstacle(points[endIndex], polygon)) {
      endIndex += 1;
    }

    return { startIndex, endIndex };
  }

  return null;
}

function applyFunnelsInAlongPathOrder(flight: WorkingFlight, funnels: RerouteFunnel[]) {
  const remaining = new Set(funnels.map((funnel) => funnel.id));

  while (remaining.size > 0) {
    let chosen:
      | {
          segmentIndex: number;
          funnel: RerouteFunnel;
          projectedParam: number;
          addedNm: number;
        }
      | null = null;

    for (const funnel of funnels) {
      if (!remaining.has(funnel.id)) continue;
      const hit = findEarliestFunnelHit(flight.points, funnel);
      if (!hit) continue;

      if (
        !chosen ||
        hit.segmentIndex < chosen.segmentIndex ||
        (hit.segmentIndex === chosen.segmentIndex && hit.projectedParam < chosen.projectedParam - EPS)
      ) {
        chosen = {
          segmentIndex: hit.segmentIndex,
          funnel,
          projectedParam: hit.projectedParam,
          addedNm: hit.addedNm,
        };
      }
    }

    if (!chosen) break;

    const segmentIndex = chosen.segmentIndex;
    const a = flight.points[segmentIndex];
    const b = flight.points[segmentIndex + 1];
    const center = chosen.funnel.center;

    flight.points.splice(segmentIndex + 1, 0, center);
    flight.oldSegments.push({ start: a, end: b });
    flight.newSegments.push({ start: a, end: center });
    flight.newSegments.push({ start: center, end: b });
    flight.extraNm += chosen.addedNm;

    remaining.delete(chosen.funnel.id);
  }
}

function findEarliestFunnelHit(
  points: Point2D[],
  funnel: RerouteFunnel,
): { segmentIndex: number; projectedParam: number; addedNm: number } | null {
  for (let segIdx = 0; segIdx < points.length - 1; segIdx += 1) {
    const a = points[segIdx];
    const b = points[segIdx + 1];
    const nearest = nearestPointParamOnSegmentNm(funnel.center, a, b);
    if (nearest.distanceNm > funnel.radiusNm + EPS) continue;

    const oldNm = distanceNm(a, b);
    const newNm = distanceNm(a, funnel.center) + distanceNm(funnel.center, b);
    return {
      segmentIndex: segIdx,
      projectedParam: nearest.param,
      addedNm: Math.max(0, newNm - oldNm),
    };
  }
  return null;
}

function chooseBestDetourVertex(a: Point2D, b: Point2D, polygon: Point2D[]) {
  let best: { vertex: Point2D; addedNm: number } | null = null;

  for (let i = 0; i < polygon.length - 1; i += 1) {
    const vertex = polygon[i];
    if (pointsEqual(vertex, a) || pointsEqual(vertex, b)) continue;
    if (!detourSegmentIsValid(a, vertex, polygon) || !detourSegmentIsValid(vertex, b, polygon)) {
      continue;
    }

    const oldNm = distanceNm(a, b);
    const newNm = distanceNm(a, vertex) + distanceNm(vertex, b);
    const addedNm = Math.max(0, newNm - oldNm);

    if (!best || addedNm < best.addedNm - EPS) {
      best = { vertex, addedNm };
    }
  }

  return best;
}

function detourSegmentIsValid(a: Point2D, b: Point2D, polygon: Point2D[]): boolean {
  if (segmentLengthSq(a, b) <= EPS * EPS) return false;
  if (pointInPolygonStrict(midpoint(a, b), polygon)) return false;

  const intersections = segmentPolygonIntersections(a, b, polygon);
  for (const point of intersections) {
    if (pointsEqual(point, a) || pointsEqual(point, b)) continue;
    return false;
  }

  return true;
}

function segmentRequiresObstacleDetour(a: Point2D, b: Point2D, polygon: Point2D[]): boolean {
  if (!segmentHitsPolygon(a, b, polygon)) return false;

  const intersections = segmentPolygonIntersections(a, b, polygon);
  if (intersections.length === 0) {
    return pointInPolygonStrict(midpoint(a, b), polygon);
  }

  const nonEndpointHits = intersections.some((point) => !pointsEqual(point, a) && !pointsEqual(point, b));
  if (nonEndpointHits) return true;

  return pointInPolygonStrict(midpoint(a, b), polygon);
}

function segmentHitsPolygon(a: Point2D, b: Point2D, polygon: Point2D[]): boolean {
  if (pointInPolygonOrBoundary(a, polygon) || pointInPolygonOrBoundary(b, polygon)) return true;
  if (pointInPolygonStrict(midpoint(a, b), polygon)) return true;

  for (let i = 0; i < polygon.length - 1; i += 1) {
    const p = polygon[i];
    const q = polygon[i + 1];
    if (segmentsIntersect(a, b, p, q)) return true;
  }

  return false;
}

function segmentPolygonIntersections(a: Point2D, b: Point2D, polygon: Point2D[]): Point2D[] {
  const out: Point2D[] = [];

  for (let i = 0; i < polygon.length - 1; i += 1) {
    const p = polygon[i];
    const q = polygon[i + 1];
    const intersection = segmentIntersectionPoint(a, b, p, q);
    if (!intersection) continue;
    if (!out.some((existing) => pointsEqual(existing, intersection))) {
      out.push(intersection);
    }
  }

  return out;
}

function segmentIntersectionPoint(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  if (!segmentsIntersect(a, b, c, d)) return null;

  const r: Point2D = [b[0] - a[0], b[1] - a[1]];
  const s: Point2D = [d[0] - c[0], d[1] - c[1]];
  const denom = cross(r, s);

  if (Math.abs(denom) <= EPS) {
    for (const point of [a, b, c, d]) {
      if (onSegment(a, b, point) && onSegment(c, d, point)) return point;
    }
    return null;
  }

  const t = cross([c[0] - a[0], c[1] - a[1]], s) / denom;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true;

  return false;
}

function pointInPolygonOrBoundary(point: Point2D, polygon: Point2D[]): boolean {
  if (pointOnPolygonBoundary(point, polygon)) return true;
  return pointInPolygonStrict(point, polygon);
}

function pointStrictlyOutsideObstacle(point: Point2D, polygon: Point2D[]): boolean {
  return !pointInPolygonOrBoundary(point, polygon);
}

function pointInPolygonStrict(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 4) return false;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];

    const intersects =
      ((pi[1] > point[1]) !== (pj[1] > point[1])) &&
      (point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / (pj[1] - pi[1] + EPS) + pi[0]);

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointOnPolygonBoundary(point: Point2D, polygon: Point2D[]): boolean {
  for (let i = 0; i < polygon.length - 1; i += 1) {
    if (onSegment(polygon[i], polygon[i + 1], point)) return true;
  }
  return false;
}

function nearestPointParamOnSegmentNm(point: Point2D, a: Point2D, b: Point2D): { param: number; distanceNm: number } {
  const refLat = (point[1] + a[1] + b[1]) / 3;
  const pa = toXYNm(point, refLat);
  const aa = toXYNm(a, refLat);
  const bb = toXYNm(b, refLat);
  const abx = bb[0] - aa[0];
  const aby = bb[1] - aa[1];
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= EPS) {
    const dx = pa[0] - aa[0];
    const dy = pa[1] - aa[1];
    return { param: 0, distanceNm: Math.sqrt(dx * dx + dy * dy) };
  }

  let t = ((pa[0] - aa[0]) * abx + (pa[1] - aa[1]) * aby) / abLenSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const projX = aa[0] + t * abx;
  const projY = aa[1] + t * aby;
  const dx = pa[0] - projX;
  const dy = pa[1] - projY;

  return { param: t, distanceNm: Math.sqrt(dx * dx + dy * dy) };
}

function distanceNm(a: Point2D, b: Point2D): number {
  const refLat = (a[1] + b[1]) / 2;
  const aa = toXYNm(a, refLat);
  const bb = toXYNm(b, refLat);
  const dx = bb[0] - aa[0];
  const dy = bb[1] - aa[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function toXYNm(point: Point2D, refLat: number): Point2D {
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  return [point[0] * 60 * cosLat, point[1] * 60];
}

function normalizeObstacles(obstacles: RerouteObstacle[]): RerouteObstacle[] {
  const out: RerouteObstacle[] = [];
  const seen = new Set<string>();

  for (const obstacle of obstacles || []) {
    const id = String(obstacle?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    const vertices = (obstacle?.vertices || []).filter(isPoint);
    if (vertices.length < 3) continue;
    seen.add(id);
    out.push({ id, vertices });
  }

  return out;
}

function normalizeFunnels(funnels: RerouteFunnel[]): RerouteFunnel[] {
  const out: RerouteFunnel[] = [];
  const seen = new Set<string>();

  for (const funnel of funnels || []) {
    const id = String(funnel?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    if (!isPoint(funnel?.center)) continue;
    const radiusNm = Number(funnel?.radiusNm);
    if (!Number.isFinite(radiusNm) || radiusNm <= 0) continue;
    seen.add(id);
    out.push({ id, center: funnel.center, radiusNm });
  }

  return out;
}

function normalizeIds(ids: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawId of ids || []) {
    const id = String(rawId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function toUniquePointList(coords: Array<[number, number, number?]>): Point2D[] {
  const out: Point2D[] = [];
  for (const coord of coords || []) {
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
    const point: Point2D = [Number(coord[0]), Number(coord[1])];
    if (out.length === 0 || !pointsEqual(out[out.length - 1], point)) {
      out.push(point);
    }
  }
  return out;
}

function clonePointList(points: Point2D[]): Point2D[] {
  return (points || []).map((point) => [point[0], point[1]]);
}

function appendPoint(points: Point2D[], point: Point2D) {
  if (points.length === 0 || !pointsEqual(points[points.length - 1], point)) {
    points.push(point);
  }
}

function appendPointRange(points: Point2D[], source: Point2D[], startIndex: number, endIndex: number) {
  if (startIndex > endIndex) return;
  for (let idx = startIndex; idx <= endIndex; idx += 1) {
    appendPoint(points, source[idx]);
  }
}

function ensureClosedPolygon(vertices: Point2D[]): Point2D[] {
  const points = vertices.filter(isPoint);
  if (points.length < 3) return points;
  if (pointsEqual(points[0], points[points.length - 1])) return points;
  return [...points, points[0]];
}

function dedupeStrings(values: string[]): string[] {
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

function roundTo3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  if (Math.abs(orientation(a, b, p)) > EPS) return false;
  return (
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS
  );
}

function cross(a: Point2D, b: Point2D): number {
  return a[0] * b[1] - a[1] * b[0];
}

function segmentLengthSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
}

function isPoint(value: unknown): value is Point2D {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}
