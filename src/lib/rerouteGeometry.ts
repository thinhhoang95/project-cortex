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
  affinityPoint: Point2D;
  selectionPolyline: Point2D[];
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

export interface RerouteFlightDiagnostic {
  flightId: string;
  changed: boolean;
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
  diagnostics: RerouteFlightDiagnostic[];
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

interface ObstacleSpan {
  startIndex: number;
  endIndex: number;
}

interface BoundaryContact {
  point: Point2D;
  edgeStartIndex: number;
  edgeParam: number;
  segmentIndex: number;
  segmentParam: number;
}

interface BoundaryContactsResult {
  entryContact: BoundaryContact;
  exitContact: BoundaryContact;
}

interface BoundaryDetourCandidate {
  viaPoints: Point2D[];
  newPathNm: number;
}

interface BoundaryDetourFailure {
  warning: string;
}

type GeometryBudget = {
  signal: AbortSignal | null;
  maxBlockingMs: number;
  lastYieldAt: number;
  opCounter: number;
  maybeYield: () => Promise<void>;
};

const EPS = 1e-7;
const MAX_MULTICORNER_POLYGON_VERTICES = 64;
const MAX_DETOUR_POINTS_PER_SPAN = 66;
const YIELD_CHECK_EVERY_OPS = 64;

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
  const budget = createGeometryBudget(signal, maxBlockingMs);
  let lastYieldAt = nowMs();

  for (let index = 0; index < prepared.flights.length; index += 1) {
    throwIfAborted(signal);
    const flight = prepared.flights[index];
    await applyObstaclesAsync(flight, prepared.obstacles, budget);
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
      oldSegments: flight.oldSegments.map(cloneSegment),
      newSegments: flight.newSegments.map(cloneSegment),
      extraNm: roundTo3(flight.extraNm),
      warnings: dedupeStrings(flight.warnings),
    }));
  const diagnostics: RerouteFlightDiagnostic[] = flights
    .filter((flight) => flight.warnings.length > 0)
    .map((flight) => ({
      flightId: flight.flightId,
      changed: flight.oldSegments.length > 0,
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
    diagnostics,
  };
}

function createGeometryBudget(signal: AbortSignal | null, maxBlockingMs: number): GeometryBudget {
  const budget: GeometryBudget = {
    signal,
    maxBlockingMs,
    lastYieldAt: nowMs(),
    opCounter: 0,
    maybeYield: async () => {
      budget.opCounter += 1;
      if (budget.opCounter % YIELD_CHECK_EVERY_OPS !== 0) return;
      throwIfAborted(signal);
      if (nowMs() - budget.lastYieldAt < maxBlockingMs) return;
      await yieldToMainThread();
      budget.lastYieldAt = nowMs();
      throwIfAborted(signal);
    },
  };
  return budget;
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

async function applyObstaclesAsync(
  flight: WorkingFlight,
  obstacles: RerouteObstacle[],
  budget: GeometryBudget,
) {
  for (const obstacle of obstacles) {
    const polygon = ensureClosedPolygon(obstacle.vertices);
    if (polygon.length < 4) continue;
    flight.points = await buildObstacleDetourPointsAsync(flight, obstacle.id, polygon, budget);
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

    const oneCornerCandidate = chooseBestDetourVertex(a, b, polygon);
    if (oneCornerCandidate) {
      applyDetourCandidate(
        flight,
        nextPoints,
        sourcePoints,
        span,
        [oneCornerCandidate.vertex],
        distanceNm(a, oneCornerCandidate.vertex) + distanceNm(oneCornerCandidate.vertex, b),
      );
      cursor = span.endIndex;
      continue;
    }

    const fallback = chooseBestBoundaryDetour(
      obstacleId,
      a,
      b,
      sourcePoints,
      span,
      polygon,
    );
    if (!("viaPoints" in fallback)) {
      flight.warnings.push(fallback.warning);
      appendPointRange(nextPoints, sourcePoints, span.startIndex + 1, span.endIndex);
      cursor = span.endIndex;
      continue;
    }

    applyDetourCandidate(flight, nextPoints, sourcePoints, span, fallback.viaPoints, fallback.newPathNm);
    cursor = span.endIndex;
  }

  return nextPoints;
}

async function buildObstacleDetourPointsAsync(
  flight: WorkingFlight,
  obstacleId: string,
  polygon: Point2D[],
  budget: GeometryBudget,
): Promise<Point2D[]> {
  const sourcePoints = flight.points;
  if (sourcePoints.length < 2) return sourcePoints;

  const nextPoints: Point2D[] = [sourcePoints[0]];
  let cursor = 0;

  while (cursor < sourcePoints.length - 1) {
    await budget.maybeYield();
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

    const oneCornerCandidate = chooseBestDetourVertex(a, b, polygon);
    if (oneCornerCandidate) {
      applyDetourCandidate(
        flight,
        nextPoints,
        sourcePoints,
        span,
        [oneCornerCandidate.vertex],
        distanceNm(a, oneCornerCandidate.vertex) + distanceNm(oneCornerCandidate.vertex, b),
      );
      cursor = span.endIndex;
      continue;
    }

    const fallback = await chooseBestBoundaryDetourAsync(
      obstacleId,
      a,
      b,
      sourcePoints,
      span,
      polygon,
      budget,
    );
    if (!("viaPoints" in fallback)) {
      flight.warnings.push(fallback.warning);
      appendPointRange(nextPoints, sourcePoints, span.startIndex + 1, span.endIndex);
      cursor = span.endIndex;
      continue;
    }

    applyDetourCandidate(flight, nextPoints, sourcePoints, span, fallback.viaPoints, fallback.newPathNm);
    cursor = span.endIndex;
  }

  return nextPoints;
}

function applyDetourCandidate(
  flight: WorkingFlight,
  nextPoints: Point2D[],
  sourcePoints: Point2D[],
  span: ObstacleSpan,
  viaPoints: Point2D[],
  newPathNm: number,
) {
  let oldPathNm = 0;
  for (let idx = span.startIndex; idx < span.endIndex; idx += 1) {
    const from = sourcePoints[idx];
    const to = sourcePoints[idx + 1];
    oldPathNm += distanceNm(from, to);
    flight.oldSegments.push({ start: from, end: to });
  }

  const segmentPoints = [sourcePoints[span.startIndex], ...viaPoints, sourcePoints[span.endIndex]];
  for (let idx = 0; idx < segmentPoints.length - 1; idx += 1) {
    flight.newSegments.push({
      start: segmentPoints[idx],
      end: segmentPoints[idx + 1],
    });
  }
  flight.extraNm += Math.max(0, newPathNm - oldPathNm);

  for (const point of viaPoints) {
    appendPoint(nextPoints, point);
  }
  appendPoint(nextPoints, sourcePoints[span.endIndex]);
}

function findNextObstacleSpan(
  points: Point2D[],
  polygon: Point2D[],
  searchFrom: number,
): ObstacleSpan | null {
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

function chooseBestBoundaryDetour(
  obstacleId: string,
  a: Point2D,
  b: Point2D,
  sourcePoints: Point2D[],
  span: ObstacleSpan,
  polygon: Point2D[],
): BoundaryDetourCandidate | BoundaryDetourFailure {
  const ring = polygon.slice(0, -1);
  if (!pointStrictlyOutsideObstacle(a, polygon) || !pointStrictlyOutsideObstacle(b, polygon)) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; endpoints are not outside polygon.`,
    };
  }
  if (ring.length > MAX_MULTICORNER_POLYGON_VERTICES) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; polygon exceeds ${MAX_MULTICORNER_POLYGON_VERTICES} vertices.`,
    };
  }
  if (polygonRingSelfIntersects(ring)) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; polygon self-intersects.`,
    };
  }

  const contacts = findObstacleSpanBoundaryContacts(sourcePoints, span, ring);
  if (!contacts) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; could not determine boundary contacts.`,
    };
  }

  const forwardChain = buildBoundaryChainForward(contacts.entryContact, contacts.exitContact, ring);
  const reverseChain = buildBoundaryChainReverse(contacts.entryContact, contacts.exitContact, ring);
  const forwardTooLong = dedupeAdjacentPoints(forwardChain).length > MAX_DETOUR_POINTS_PER_SPAN;
  const reverseTooLong = dedupeAdjacentPoints(reverseChain).length > MAX_DETOUR_POINTS_PER_SPAN;
  if (forwardTooLong && reverseTooLong) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; detour exceeds ${MAX_DETOUR_POINTS_PER_SPAN} points.`,
    };
  }
  const forward = forwardTooLong ? null : evaluateBoundaryDetourCandidate(a, b, forwardChain, ring, polygon);
  const reverse = reverseTooLong ? null : evaluateBoundaryDetourCandidate(a, b, reverseChain, ring, polygon);
  return chooseBestBoundaryCandidate(obstacleId, span, forward, reverse);
}

async function chooseBestBoundaryDetourAsync(
  obstacleId: string,
  a: Point2D,
  b: Point2D,
  sourcePoints: Point2D[],
  span: ObstacleSpan,
  polygon: Point2D[],
  budget: GeometryBudget,
): Promise<BoundaryDetourCandidate | BoundaryDetourFailure> {
  const ring = polygon.slice(0, -1);
  if (!pointStrictlyOutsideObstacle(a, polygon) || !pointStrictlyOutsideObstacle(b, polygon)) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; endpoints are not outside polygon.`,
    };
  }
  if (ring.length > MAX_MULTICORNER_POLYGON_VERTICES) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; polygon exceeds ${MAX_MULTICORNER_POLYGON_VERTICES} vertices.`,
    };
  }
  if (await polygonRingSelfIntersectsAsync(ring, budget)) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; polygon self-intersects.`,
    };
  }

  const contacts = await findObstacleSpanBoundaryContactsAsync(sourcePoints, span, ring, budget);
  if (!contacts) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; could not determine boundary contacts.`,
    };
  }

  const forwardChain = buildBoundaryChainForward(contacts.entryContact, contacts.exitContact, ring);
  const reverseChain = buildBoundaryChainReverse(contacts.entryContact, contacts.exitContact, ring);
  const forwardTooLong = dedupeAdjacentPoints(forwardChain).length > MAX_DETOUR_POINTS_PER_SPAN;
  const reverseTooLong = dedupeAdjacentPoints(reverseChain).length > MAX_DETOUR_POINTS_PER_SPAN;
  if (forwardTooLong && reverseTooLong) {
    return {
      warning: `Obstacle ${obstacleId}: multicorner fallback skipped for blocked span ${span.startIndex}-${span.endIndex}; detour exceeds ${MAX_DETOUR_POINTS_PER_SPAN} points.`,
    };
  }
  const forward = forwardTooLong
    ? null
    : await evaluateBoundaryDetourCandidateAsync(a, b, forwardChain, ring, polygon, budget);
  const reverse = reverseTooLong
    ? null
    : await evaluateBoundaryDetourCandidateAsync(a, b, reverseChain, ring, polygon, budget);
  return chooseBestBoundaryCandidate(obstacleId, span, forward, reverse);
}

function chooseBestBoundaryCandidate(
  obstacleId: string,
  span: ObstacleSpan,
  forward: BoundaryDetourCandidate | null,
  reverse: BoundaryDetourCandidate | null,
): BoundaryDetourCandidate | BoundaryDetourFailure {
  if (forward && reverse) {
    if (forward.newPathNm < reverse.newPathNm - EPS) return forward;
    if (reverse.newPathNm < forward.newPathNm - EPS) return reverse;
    return forward.viaPoints.length <= reverse.viaPoints.length ? forward : reverse;
  }
  if (forward) return forward;
  if (reverse) return reverse;
  return {
    warning: `Obstacle ${obstacleId}: no valid boundary detour for blocked span ${span.startIndex}-${span.endIndex}.`,
  };
}

function findObstacleSpanBoundaryContacts(
  points: Point2D[],
  span: ObstacleSpan,
  ring: Point2D[],
): BoundaryContactsResult | null {
  const contacts: BoundaryContact[] = [];
  for (let segIdx = span.startIndex; segIdx < span.endIndex; segIdx += 1) {
    const a = points[segIdx];
    const b = points[segIdx + 1];
    const segmentContacts = collectSegmentBoundaryContacts(a, b, segIdx, ring);
    for (const contact of segmentContacts) {
      pushUniqueBoundaryContact(contacts, contact);
    }
  }
  return contactsToBoundarySpan(contacts);
}

async function findObstacleSpanBoundaryContactsAsync(
  points: Point2D[],
  span: ObstacleSpan,
  ring: Point2D[],
  budget: GeometryBudget,
): Promise<BoundaryContactsResult | null> {
  const contacts: BoundaryContact[] = [];
  for (let segIdx = span.startIndex; segIdx < span.endIndex; segIdx += 1) {
    await budget.maybeYield();
    const a = points[segIdx];
    const b = points[segIdx + 1];
    const segmentContacts = await collectSegmentBoundaryContactsAsync(a, b, segIdx, ring, budget);
    for (const contact of segmentContacts) {
      pushUniqueBoundaryContact(contacts, contact);
    }
  }
  return contactsToBoundarySpan(contacts);
}

function contactsToBoundarySpan(contacts: BoundaryContact[]): BoundaryContactsResult | null {
  if (contacts.length < 2) return null;
  contacts.sort(compareBoundaryContacts);
  const uniqueContacts = dedupeBoundaryContacts(contacts);
  if (uniqueContacts.length < 2) return null;
  const entryContact = uniqueContacts[0];
  const exitContact = uniqueContacts[uniqueContacts.length - 1];
  if (pointsEqual(entryContact.point, exitContact.point)) return null;
  return { entryContact, exitContact };
}

function buildBoundaryChainForward(
  entryContact: BoundaryContact,
  exitContact: BoundaryContact,
  ring: Point2D[],
): Point2D[] {
  if (ring.length === 0) return [];
  if (
    entryContact.edgeStartIndex === exitContact.edgeStartIndex &&
    exitContact.edgeParam >= entryContact.edgeParam - EPS
  ) {
    return dedupeAdjacentPoints([entryContact.point, exitContact.point]);
  }

  const points: Point2D[] = [entryContact.point];
  const n = ring.length;
  let edgeIndex = entryContact.edgeStartIndex;

  for (let steps = 0; steps < n; steps += 1) {
    appendPoint(points, ring[(edgeIndex + 1) % n]);
    edgeIndex = (edgeIndex + 1) % n;
    if (edgeIndex === exitContact.edgeStartIndex) {
      appendPoint(points, exitContact.point);
      return dedupeAdjacentPoints(points);
    }
  }

  return dedupeAdjacentPoints(points);
}

function buildBoundaryChainReverse(
  entryContact: BoundaryContact,
  exitContact: BoundaryContact,
  ring: Point2D[],
): Point2D[] {
  return dedupeAdjacentPoints(
    buildBoundaryChainForward(exitContact, entryContact, ring).slice().reverse()
  );
}

function collectSegmentBoundaryContacts(
  a: Point2D,
  b: Point2D,
  segmentIndex: number,
  ring: Point2D[],
): BoundaryContact[] {
  const contacts: BoundaryContact[] = [];
  for (let edgeIdx = 0; edgeIdx < ring.length; edgeIdx += 1) {
    const p = ring[edgeIdx];
    const q = ring[(edgeIdx + 1) % ring.length];
    const rawContacts = segmentIntersectionContacts(a, b, p, q);
    for (const rawContact of rawContacts) {
      const contact = normalizeBoundaryContact(rawContact.point, edgeIdx, segmentIndex, rawContact.param, ring);
      pushUniqueBoundaryContact(contacts, contact);
    }
  }
  contacts.sort(compareBoundaryContacts);
  return contacts;
}

async function collectSegmentBoundaryContactsAsync(
  a: Point2D,
  b: Point2D,
  segmentIndex: number,
  ring: Point2D[],
  budget: GeometryBudget,
): Promise<BoundaryContact[]> {
  const contacts: BoundaryContact[] = [];
  for (let edgeIdx = 0; edgeIdx < ring.length; edgeIdx += 1) {
    await budget.maybeYield();
    const p = ring[edgeIdx];
    const q = ring[(edgeIdx + 1) % ring.length];
    const rawContacts = segmentIntersectionContacts(a, b, p, q);
    for (const rawContact of rawContacts) {
      const contact = normalizeBoundaryContact(rawContact.point, edgeIdx, segmentIndex, rawContact.param, ring);
      pushUniqueBoundaryContact(contacts, contact);
    }
  }
  contacts.sort(compareBoundaryContacts);
  return contacts;
}

function normalizeBoundaryContact(
  point: Point2D,
  edgeStartIndex: number,
  segmentIndex: number,
  segmentParam: number,
  ring: Point2D[],
): BoundaryContact {
  for (let vertexIndex = 0; vertexIndex < ring.length; vertexIndex += 1) {
    if (!pointsEqual(point, ring[vertexIndex])) continue;
    return {
      point: ring[vertexIndex],
      edgeStartIndex: vertexIndex,
      edgeParam: 0,
      segmentIndex,
      segmentParam,
    };
  }

  const start = ring[edgeStartIndex];
  const end = ring[(edgeStartIndex + 1) % ring.length];
  return {
    point,
    edgeStartIndex,
    edgeParam: pointParamAlongSegment(start, end, point),
    segmentIndex,
    segmentParam,
  };
}

function pushUniqueBoundaryContact(contacts: BoundaryContact[], next: BoundaryContact) {
  if (contacts.some((existing) => sameBoundaryContact(existing, next))) return;
  contacts.push(next);
}

function sameBoundaryContact(a: BoundaryContact, b: BoundaryContact): boolean {
  return (
    a.segmentIndex === b.segmentIndex &&
    Math.abs(a.segmentParam - b.segmentParam) <= EPS &&
    pointsEqual(a.point, b.point)
  );
}

function compareBoundaryContacts(a: BoundaryContact, b: BoundaryContact): number {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
  if (Math.abs(a.segmentParam - b.segmentParam) > EPS) return a.segmentParam < b.segmentParam ? -1 : 1;
  if (a.edgeStartIndex !== b.edgeStartIndex) return a.edgeStartIndex - b.edgeStartIndex;
  return 0;
}

function dedupeBoundaryContacts(contacts: BoundaryContact[]): BoundaryContact[] {
  const out: BoundaryContact[] = [];
  for (const contact of contacts) {
    if (out.some((existing) => sameBoundaryContact(existing, contact))) continue;
    out.push(contact);
  }
  return out;
}

function evaluateBoundaryDetourCandidate(
  a: Point2D,
  b: Point2D,
  chain: Point2D[],
  ring: Point2D[],
  polygon: Point2D[],
): BoundaryDetourCandidate | null {
  const viaPoints = normalizeBoundaryViaPoints(chain, a, b);
  if (!viaPoints) return null;
  if (viaPoints.length < 2) return null;
  const entryPoint = viaPoints[0];
  const exitPoint = viaPoints[viaPoints.length - 1];
  if (!segmentTouchesPolygonOnlyAtEndpoint(a, entryPoint, polygon, entryPoint)) return null;
  if (!segmentTouchesPolygonOnlyAtEndpoint(exitPoint, b, polygon, exitPoint)) return null;
  if (!boundaryChainIsValid(viaPoints, ring)) return null;

  const fullPath = dedupeAdjacentPoints([a, ...viaPoints, b]);
  if (fullPath.length < 4) return null;
  if (pathHasSelfIntersection(fullPath)) return null;
  return {
    viaPoints,
    newPathNm: sumPathNm(fullPath),
  };
}

async function evaluateBoundaryDetourCandidateAsync(
  a: Point2D,
  b: Point2D,
  chain: Point2D[],
  ring: Point2D[],
  polygon: Point2D[],
  budget: GeometryBudget,
): Promise<BoundaryDetourCandidate | null> {
  const viaPoints = normalizeBoundaryViaPoints(chain, a, b);
  if (!viaPoints) return null;
  if (viaPoints.length < 2) return null;
  const entryPoint = viaPoints[0];
  const exitPoint = viaPoints[viaPoints.length - 1];
  await budget.maybeYield();
  if (!segmentTouchesPolygonOnlyAtEndpoint(a, entryPoint, polygon, entryPoint)) return null;
  await budget.maybeYield();
  if (!segmentTouchesPolygonOnlyAtEndpoint(exitPoint, b, polygon, exitPoint)) return null;
  if (!(await boundaryChainIsValidAsync(viaPoints, ring, budget))) return null;

  const fullPath = dedupeAdjacentPoints([a, ...viaPoints, b]);
  if (fullPath.length < 4) return null;
  if (await pathHasSelfIntersectionAsync(fullPath, budget)) return null;
  return {
    viaPoints,
    newPathNm: sumPathNm(fullPath),
  };
}

function normalizeBoundaryViaPoints(chain: Point2D[], a: Point2D, b: Point2D): Point2D[] | null {
  const normalized = dedupeAdjacentPoints(chain).filter((point) => !pointsEqual(point, a) && !pointsEqual(point, b));
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_DETOUR_POINTS_PER_SPAN) return null;
  return normalized;
}

function segmentTouchesPolygonOnlyAtEndpoint(
  a: Point2D,
  b: Point2D,
  polygon: Point2D[],
  allowedEndpoint: Point2D,
): boolean {
  if (segmentLengthSq(a, b) <= EPS * EPS) return false;
  if (pointInPolygonStrict(midpoint(a, b), polygon)) return false;
  const contacts = segmentPolygonContacts(a, b, polygon);
  if (contacts.length === 0) return false;
  for (const contact of contacts) {
    if (pointsEqual(contact.point, allowedEndpoint)) continue;
    return false;
  }
  return true;
}

function boundaryChainIsValid(points: Point2D[], ring: Point2D[]): boolean {
  if (points.length < 2) return false;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    if (!segmentLiesOnPolygonBoundary(points[idx], points[idx + 1], ring)) {
      return false;
    }
  }
  return true;
}

async function boundaryChainIsValidAsync(
  points: Point2D[],
  ring: Point2D[],
  budget: GeometryBudget,
): Promise<boolean> {
  if (points.length < 2) return false;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    await budget.maybeYield();
    if (!segmentLiesOnPolygonBoundary(points[idx], points[idx + 1], ring)) {
      return false;
    }
  }
  return true;
}

function segmentLiesOnPolygonBoundary(a: Point2D, b: Point2D, ring: Point2D[]): boolean {
  if (segmentLengthSq(a, b) <= EPS * EPS) return false;
  for (let edgeIdx = 0; edgeIdx < ring.length; edgeIdx += 1) {
    const p = ring[edgeIdx];
    const q = ring[(edgeIdx + 1) % ring.length];
    if (onSegment(p, q, a) && onSegment(p, q, b)) return true;
  }
  return false;
}

function pathHasSelfIntersection(points: Point2D[]): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length - 1; j += 1) {
      if (Math.abs(i - j) <= 1) continue;
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

async function pathHasSelfIntersectionAsync(points: Point2D[], budget: GeometryBudget): Promise<boolean> {
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length - 1; j += 1) {
      await budget.maybeYield();
      if (Math.abs(i - j) <= 1) continue;
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

function sumPathNm(points: Point2D[]): number {
  let total = 0;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    total += distanceNm(points[idx], points[idx + 1]);
  }
  return total;
}

function polygonRingSelfIntersects(ring: Point2D[]): boolean {
  const n = ring.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

async function polygonRingSelfIntersectsAsync(ring: Point2D[], budget: GeometryBudget): Promise<boolean> {
  const n = ring.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      await budget.maybeYield();
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function applyFunnelsInAlongPathOrder(flight: WorkingFlight, funnels: RerouteFunnel[]) {
  const remaining = new Set(funnels.map((funnel) => funnel.id));

  while (remaining.size > 0) {
    let chosen:
      | {
          funnel: RerouteFunnel;
          hit: {
            segmentIndex: number;
            startIndex: number;
            endIndex: number;
            polygon: Point2D[];
            projectedParam: number;
          };
        }
      | null = null;

    for (const funnel of funnels) {
      if (!remaining.has(funnel.id)) continue;
      const hit = findEarliestFunnelHit(flight.points, funnel);
      if (!hit) continue;

      if (
        !chosen ||
        hit.segmentIndex < chosen.hit.segmentIndex ||
        (hit.segmentIndex === chosen.hit.segmentIndex && hit.projectedParam < chosen.hit.projectedParam - EPS)
      ) {
        chosen = {
          funnel,
          hit,
        };
      }
    }

    if (!chosen) break;

    const { startIndex, endIndex, polygon } = chosen.hit;
    if (startIndex < 0 || endIndex >= flight.points.length || startIndex >= endIndex) {
      flight.warnings.push(
        `Funnel ${chosen.funnel.id}: cannot dissolve invalid span ${startIndex}-${endIndex}.`
      );
      remaining.delete(chosen.funnel.id);
      continue;
    }

    const a = flight.points[startIndex];
    const b = flight.points[endIndex];
    if (!pointStrictlyOutsideObstacle(a, polygon) || !pointStrictlyOutsideObstacle(b, polygon)) {
      flight.warnings.push(
        `Funnel ${chosen.funnel.id}: cannot dissolve span ${startIndex}-${endIndex}; endpoints not outside polygon.`
      );
      remaining.delete(chosen.funnel.id);
      continue;
    }

    let oldPathNm = 0;
    for (let idx = startIndex; idx < endIndex; idx += 1) {
      const from = flight.points[idx];
      const to = flight.points[idx + 1];
      oldPathNm += distanceNm(from, to);
      flight.oldSegments.push({ start: from, end: to });
    }

    const affinityPoint: Point2D = [chosen.funnel.affinityPoint[0], chosen.funnel.affinityPoint[1]];
    const newPathNm = distanceNm(a, affinityPoint) + distanceNm(affinityPoint, b);
    flight.points.splice(startIndex + 1, endIndex - startIndex - 1, affinityPoint);
    flight.newSegments.push({ start: a, end: affinityPoint });
    flight.newSegments.push({ start: affinityPoint, end: b });
    flight.extraNm += Math.max(0, newPathNm - oldPathNm);
    remaining.delete(chosen.funnel.id);
  }
}

function findEarliestFunnelHit(
  points: Point2D[],
  funnel: RerouteFunnel,
): {
  segmentIndex: number;
  startIndex: number;
  endIndex: number;
  polygon: Point2D[];
  projectedParam: number;
} | null {
  const polygon = buildFunnelPolygon(funnel);
  if (polygon.length < 4) return null;

  for (let segIdx = 0; segIdx < points.length - 1; segIdx += 1) {
    const a = points[segIdx];
    const b = points[segIdx + 1];
    const projectedParam = earliestSegmentPolygonContactParam(a, b, polygon);
    if (projectedParam === null) continue;

    let startIndex = segIdx;
    while (startIndex > 0 && !pointStrictlyOutsideObstacle(points[startIndex], polygon)) {
      startIndex -= 1;
    }

    let endIndex = segIdx + 1;
    while (endIndex < points.length - 1 && !pointStrictlyOutsideObstacle(points[endIndex], polygon)) {
      endIndex += 1;
    }

    return {
      segmentIndex: segIdx,
      startIndex,
      endIndex,
      polygon,
      projectedParam,
    };
  }
  return null;
}

function buildFunnelPolygon(funnel: RerouteFunnel): Point2D[] {
  if (!isPoint(funnel?.affinityPoint)) return [];
  const vertices = (funnel.selectionPolyline || []).filter(isPoint);
  if (vertices.length < 3) return [];
  return ensureClosedPolygon(vertices);
}

function earliestSegmentPolygonContactParam(a: Point2D, b: Point2D, polygon: Point2D[]): number | null {
  let best: number | null = pointInPolygonOrBoundary(a, polygon) ? 0 : null;

  for (let i = 0; i < polygon.length - 1; i += 1) {
    const p = polygon[i];
    const q = polygon[i + 1];
    const params = segmentIntersectionParams(a, b, p, q);
    for (const param of params) {
      if (best === null || param < best - EPS) {
        best = param;
      }
    }
  }

  if (best !== null) return best;
  if (pointInPolygonStrict(midpoint(a, b), polygon)) return 0.5;
  if (pointInPolygonOrBoundary(b, polygon)) return 1;
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
  return segmentPolygonContacts(a, b, polygon).map((contact) => contact.point);
}

function segmentPolygonContacts(a: Point2D, b: Point2D, polygon: Point2D[]): Array<{ point: Point2D; param: number }> {
  const out: Array<{ point: Point2D; param: number }> = [];

  for (let i = 0; i < polygon.length - 1; i += 1) {
    const p = polygon[i];
    const q = polygon[i + 1];
    const contacts = segmentIntersectionContacts(a, b, p, q);
    for (const contact of contacts) {
      if (!out.some((existing) => pointsEqual(existing.point, contact.point))) {
        out.push(contact);
      }
    }
  }

  out.sort((left, right) => left.param - right.param);
  return out;
}

function segmentIntersectionPoint(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const contacts = segmentIntersectionContacts(a, b, c, d);
  return contacts.length > 0 ? contacts[0].point : null;
}

function segmentIntersectionContacts(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): Array<{ point: Point2D; param: number }> {
  if (!segmentsIntersect(a, b, c, d)) return [];

  const r: Point2D = [b[0] - a[0], b[1] - a[1]];
  const s: Point2D = [d[0] - c[0], d[1] - c[1]];
  const denom = cross(r, s);

  if (Math.abs(denom) <= EPS) {
    const contacts: Array<{ point: Point2D; param: number }> = [];
    for (const point of [a, b, c, d]) {
      if (!onSegment(a, b, point) || !onSegment(c, d, point)) continue;
      const param = pointParamAlongSegment(a, b, point);
      if (!contacts.some((existing) => pointsEqual(existing.point, point))) {
        contacts.push({ point, param });
      }
    }
    contacts.sort((left, right) => left.param - right.param);
    return contacts;
  }

  const t = cross([c[0] - a[0], c[1] - a[1]], s) / denom;
  return [{
    point: [a[0] + t * r[0], a[1] + t * r[1]],
    param: Math.min(1, Math.max(0, t)),
  }];
}

function segmentIntersectionParams(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number[] {
  return segmentIntersectionContacts(a, b, c, d).map((contact) => contact.param);
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
    if (!isPoint(funnel?.affinityPoint)) continue;
    const selectionPolyline = toUniquePointList(
      (funnel?.selectionPolyline || [])
        .filter(isPoint)
        .map((point) => [point[0], point[1]] as [number, number]),
    );
    if (selectionPolyline.length < 3) continue;
    seen.add(id);
    out.push({ id, affinityPoint: funnel.affinityPoint, selectionPolyline });
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

function cloneSegment(segment: RerouteSegment): RerouteSegment {
  return {
    start: [segment.start[0], segment.start[1]],
    end: [segment.end[0], segment.end[1]],
  };
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

function pointParamAlongSegment(a: Point2D, b: Point2D, p: Point2D): number {
  const lenSq = segmentLengthSq(a, b);
  if (lenSq <= EPS) return 0;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const param = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  return Math.min(1, Math.max(0, param));
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
}

function dedupeAdjacentPoints(points: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const point of points) {
    appendPoint(out, point);
  }
  return out;
}

function isPoint(value: unknown): value is Point2D {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}
