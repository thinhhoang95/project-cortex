import type { Trajectory } from "./models";
import {
  computeRerouteGeometryAsync,
  type ComputeRerouteGeometryAsyncOptions,
  type Point2D,
  type RerouteFlightDiagnostic,
  type RerouteFlightResult,
  type RerouteFunnel,
  type RerouteGeometryResult,
  type RerouteObstacle,
} from "./rerouteGeometry";

export type RerouteMoveDefinition = {
  id: string;
  flightIds: string[];
  obstacles: RerouteObstacle[];
  funnels: RerouteFunnel[];
};

export type RerouteProgramComputationResult = {
  programResult: RerouteGeometryResult | null;
  draftResult: RerouteGeometryResult | null;
  moveResultsById: Record<string, RerouteGeometryResult | null>;
};

export type ComputeRerouteProgramParams = {
  trajectories: Trajectory[];
  moves: RerouteMoveDefinition[];
  draftMove?: RerouteMoveDefinition | null;
};

type FlightContribution = {
  oldSegments: RerouteFlightResult["oldSegments"];
  newSegments: RerouteFlightResult["newSegments"];
  extraNm: number;
  warnings: string[];
};

type FlightDiagnosticContribution = {
  changed: boolean;
  warnings: string[];
};

export async function computeRerouteProgramAsync(
  params: ComputeRerouteProgramParams,
  options: ComputeRerouteGeometryAsyncOptions = {},
): Promise<RerouteProgramComputationResult> {
  const baseTrajectoryById = new Map<string, Trajectory>();
  for (const trajectory of params.trajectories || []) {
    const flightId = String(trajectory?.flightId ?? "").trim();
    if (!flightId || baseTrajectoryById.has(flightId)) continue;
    baseTrajectoryById.set(flightId, trajectory);
  }

  const normalizedMoves = normalizeMoves(params.moves);
  const draftMove = normalizeMove(params.draftMove ?? null);
  const relevantFlightIds = collectRelevantFlightIds(normalizedMoves, draftMove, baseTrajectoryById);
  if (relevantFlightIds.length === 0) {
    return {
      programResult: null,
      draftResult: null,
      moveResultsById: {},
    };
  }

  const currentPathById = new Map<string, Point2D[]>();
  const basePathById = new Map<string, Point2D[]>();
  for (const flightId of relevantFlightIds) {
    const trajectory = baseTrajectoryById.get(flightId);
    if (!trajectory) continue;
    const path = toPointList(trajectory.coords || []);
    if (path.length < 2) continue;
    basePathById.set(flightId, clonePointList(path));
    currentPathById.set(flightId, clonePointList(path));
  }

  const moveResultsById: Record<string, RerouteGeometryResult | null> = {};
  const contributionsByFlight = new Map<string, FlightContribution>();
  const diagnosticsByFlight = new Map<string, FlightDiagnosticContribution>();

  for (const move of normalizedMoves) {
    throwIfAborted(options.signal);
    const stageResult = await computeMoveAgainstCurrentPaths(
      move,
      baseTrajectoryById,
      currentPathById,
      options,
    );
    moveResultsById[move.id] = stageResult;
    applyStageResult(stageResult, currentPathById, contributionsByFlight, diagnosticsByFlight);
  }

  let draftResult: RerouteGeometryResult | null = null;
  if (draftMove) {
    throwIfAborted(options.signal);
    draftResult = await computeMoveAgainstCurrentPaths(
      draftMove,
      baseTrajectoryById,
      currentPathById,
      options,
    );
    applyStageResult(draftResult, currentPathById, contributionsByFlight, diagnosticsByFlight);
  }

  const changedFlightIds = relevantFlightIds.filter((flightId) => contributionsByFlight.has(flightId));
  const diagnostics = relevantFlightIds
    .map((flightId) => {
      const diagnostic = diagnosticsByFlight.get(flightId);
      if (!diagnostic || diagnostic.warnings.length === 0) return null;
      return {
        flightId,
        changed: diagnostic.changed,
        warnings: dedupeStrings(diagnostic.warnings),
      } satisfies RerouteFlightDiagnostic;
    })
    .filter((diagnostic): diagnostic is RerouteFlightDiagnostic => diagnostic !== null);
  if (changedFlightIds.length === 0 && diagnostics.length === 0) {
    return {
      programResult: null,
      draftResult,
      moveResultsById,
    };
  }

  const obstacleCount =
    normalizedMoves.reduce((sum, move) => sum + move.obstacles.length, 0) + (draftMove?.obstacles.length ?? 0);
  const funnelCount =
    normalizedMoves.reduce((sum, move) => sum + move.funnels.length, 0) + (draftMove?.funnels.length ?? 0);

  const flights = changedFlightIds.map((flightId) => {
    const contribution = contributionsByFlight.get(flightId)!;
    return {
      flightId,
      originalPath: clonePointList(basePathById.get(flightId) || []),
      reroutedPath: clonePointList(currentPathById.get(flightId) || []),
      oldSegments: contribution.oldSegments.map(cloneSegment),
      newSegments: contribution.newSegments.map(cloneSegment),
      extraNm: roundTo3(contribution.extraNm),
      warnings: dedupeStrings(contribution.warnings),
    };
  });

  const totalExtraNm = roundTo3(flights.reduce((sum, flight) => sum + flight.extraNm, 0));

  return {
    programResult: {
      generatedAtEpochMs: Date.now(),
      selectedFlightIds: relevantFlightIds,
      obstacleCount,
      funnelCount,
      changedFlightCount: flights.length,
      totalExtraNm,
      flights,
      diagnostics,
    },
    draftResult,
    moveResultsById,
  };
}

async function computeMoveAgainstCurrentPaths(
  move: RerouteMoveDefinition,
  baseTrajectoryById: Map<string, Trajectory>,
  currentPathById: Map<string, Point2D[]>,
  options: ComputeRerouteGeometryAsyncOptions,
): Promise<RerouteGeometryResult | null> {
  const stageFlightIds = move.flightIds.filter((flightId) => currentPathById.has(flightId));
  const hasGeometry = move.obstacles.length > 0 || move.funnels.length > 0;
  if (stageFlightIds.length === 0 || !hasGeometry) {
    return null;
  }

  const trajectories = stageFlightIds
    .map((flightId) => buildStageTrajectory(baseTrajectoryById.get(flightId), currentPathById.get(flightId), flightId))
    .filter((trajectory): trajectory is Trajectory => trajectory !== null);

  if (trajectories.length === 0) return null;

  return computeRerouteGeometryAsync(
    {
      trajectories,
      selectedFlightIds: stageFlightIds,
      obstacles: move.obstacles,
      funnels: move.funnels,
    },
    options,
  );
}

function buildStageTrajectory(
  baseTrajectory: Trajectory | undefined,
  points: Point2D[] | undefined,
  flightId: string,
): Trajectory | null {
  if (!baseTrajectory || !points || points.length < 2) return null;
  return {
    ...baseTrajectory,
    flightId,
    coords: points.map((point) => [point[0], point[1]] as [number, number]),
    times: points.map((_, index) => index),
    t0: 0,
    t1: Math.max(0, points.length - 1),
  };
}

function applyStageResult(
  result: RerouteGeometryResult | null,
  currentPathById: Map<string, Point2D[]>,
  contributionsByFlight: Map<string, FlightContribution>,
  diagnosticsByFlight: Map<string, FlightDiagnosticContribution>,
) {
  for (const flight of result?.flights || []) {
    currentPathById.set(flight.flightId, clonePointList(flight.reroutedPath));
    const existing = contributionsByFlight.get(flight.flightId) || {
      oldSegments: [],
      newSegments: [],
      extraNm: 0,
      warnings: [],
    };
    existing.oldSegments.push(...flight.oldSegments.map(cloneSegment));
    existing.newSegments.push(...flight.newSegments.map(cloneSegment));
    existing.extraNm += Number.isFinite(flight.extraNm) ? flight.extraNm : 0;
    existing.warnings.push(...(flight.warnings || []));
    contributionsByFlight.set(flight.flightId, existing);
  }

  for (const diagnostic of result?.diagnostics || []) {
    const existing = diagnosticsByFlight.get(diagnostic.flightId) || {
      changed: false,
      warnings: [],
    };
    existing.changed = existing.changed || diagnostic.changed;
    existing.warnings.push(...(diagnostic.warnings || []));
    diagnosticsByFlight.set(diagnostic.flightId, existing);
  }
}

function collectRelevantFlightIds(
  moves: RerouteMoveDefinition[],
  draftMove: RerouteMoveDefinition | null,
  baseTrajectoryById: Map<string, Trajectory>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addFlightId = (rawId: string) => {
    const flightId = String(rawId ?? "").trim();
    if (!flightId || seen.has(flightId) || !baseTrajectoryById.has(flightId)) return;
    seen.add(flightId);
    out.push(flightId);
  };

  for (const move of moves) {
    for (const flightId of move.flightIds) addFlightId(flightId);
  }
  for (const flightId of draftMove?.flightIds || []) addFlightId(flightId);
  return out;
}

function normalizeMoves(moves: RerouteMoveDefinition[]): RerouteMoveDefinition[] {
  const out: RerouteMoveDefinition[] = [];
  const seen = new Set<string>();
  for (const move of moves || []) {
    const normalized = normalizeMove(move);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

function normalizeMove(move: RerouteMoveDefinition | null): RerouteMoveDefinition | null {
  if (!move) return null;
  const id = String(move.id ?? "").trim();
  if (!id) return null;
  const flightIds = dedupeStrings(move.flightIds || []);
  const obstacles = (move.obstacles || []).map(cloneObstacle).filter((obstacle) => obstacle.vertices.length >= 3);
  const funnels = (move.funnels || [])
    .map(cloneFunnel)
    .filter((funnel) => funnel.selectionPolyline.length >= 3);
  if (flightIds.length === 0) return null;
  if (obstacles.length === 0 && funnels.length === 0) return null;
  return { id, flightIds, obstacles, funnels };
}

function toPointList(coords: Array<[number, number, number?]>): Point2D[] {
  const out: Point2D[] = [];
  for (const coord of coords || []) {
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
    out.push([Number(coord[0]), Number(coord[1])]);
  }
  return out;
}

function cloneObstacle(obstacle: RerouteObstacle): RerouteObstacle {
  return {
    id: String(obstacle.id),
    vertices: clonePointList(obstacle.vertices || []),
  };
}

function cloneFunnel(funnel: RerouteFunnel): RerouteFunnel {
  return {
    id: String(funnel.id),
    affinityPoint: [funnel.affinityPoint[0], funnel.affinityPoint[1]],
    selectionPolyline: clonePointList(funnel.selectionPolyline || []),
  };
}

function cloneSegment(segment: RerouteFlightResult["oldSegments"][number]) {
  return {
    start: [segment.start[0], segment.start[1]] as Point2D,
    end: [segment.end[0], segment.end[1]] as Point2D,
  };
}

function clonePointList(points: Point2D[]): Point2D[] {
  return (points || []).map((point) => [point[0], point[1]]);
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

function throwIfAborted(signal: AbortSignal | null | undefined) {
  if (!signal?.aborted) return;
  const error = new Error("Reroute program computation aborted.");
  error.name = "AbortError";
  throw error;
}
