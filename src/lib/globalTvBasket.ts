export type GlobalTvBasketScope = {
  activePinnedIds: string[];
  dormantPinnedIds: string[];
  matchedCatalogIds: string[];
  requestedCatalogIds: string[];
  orderedContextIds: string[];
  includedContextIds: Set<string>;
  isFiltering: boolean;
};

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

export function dedupeTrafficVolumeIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeId(value);
    if (!normalized) continue;
    const key = normalized.toLocaleUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+.[\]{}()|]/g, "\\$&");
}

export function createTrafficVolumeQueryMatcher(rawQuery: string): (trafficVolumeId: string) => boolean {
  const query = normalizeId(rawQuery);
  if (!query) return (trafficVolumeId) => Boolean(normalizeId(trafficVolumeId));

  if (!query.includes("*") && !query.includes("?")) {
    const normalizedQuery = query.toLocaleUpperCase();
    return (trafficVolumeId) =>
      normalizeId(trafficVolumeId).toLocaleUpperCase().includes(normalizedQuery);
  }

  const pattern = Array.from(query)
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return escapeRegExp(character);
    })
    .join("");

  const matcher = new RegExp(`^${pattern}$`, "iu");
  return (trafficVolumeId) => matcher.test(normalizeId(trafficVolumeId));
}

export function matchesTrafficVolumeQuery(trafficVolumeId: string, rawQuery: string): boolean {
  return createTrafficVolumeQueryMatcher(rawQuery)(trafficVolumeId);
}

export function buildGlobalTvBasketScope({
  catalogIds,
  contextIds,
  pinnedIds,
  query,
}: {
  catalogIds: readonly string[];
  contextIds?: readonly string[];
  pinnedIds: readonly string[];
  query: string;
}): GlobalTvBasketScope {
  const catalog = dedupeTrafficVolumeIds(catalogIds);
  const context = dedupeTrafficVolumeIds(contextIds ?? []);
  const pins = dedupeTrafficVolumeIds(pinnedIds);
  const catalogByKey = new Map(catalog.map((id) => [id.toLocaleUpperCase(), id]));
  const activePinnedIds: string[] = [];
  const dormantPinnedIds: string[] = [];

  for (const pin of pins) {
    const canonical = catalogByKey.get(pin.toLocaleUpperCase());
    if (canonical) activePinnedIds.push(canonical);
    else dormantPinnedIds.push(pin);
  }

  const normalizedQuery = query.trim();
  const isFiltering = normalizedQuery.length > 0;
  const matchesQuery = createTrafficVolumeQueryMatcher(normalizedQuery);
  const matchedCatalogIds = isFiltering
    ? catalog.filter(matchesQuery)
    : [];
  const requestedCatalogIds = dedupeTrafficVolumeIds([
    ...activePinnedIds,
    ...matchedCatalogIds,
  ]);

  const pinKeys = new Set(activePinnedIds.map((id) => id.toLocaleUpperCase()));
  const matchKeys = new Set(matchedCatalogIds.map((id) => id.toLocaleUpperCase()));
  const contextByKey = new Map(context.map((id) => [id.toLocaleUpperCase(), id]));
  const orderedPinnedContext = activePinnedIds
    .map((id) => contextByKey.get(id.toLocaleUpperCase()))
    .filter((id): id is string => Boolean(id));
  const remainingContext = context.filter((id) => {
    const key = id.toLocaleUpperCase();
    if (pinKeys.has(key)) return false;
    return !isFiltering || matchKeys.has(key) || matchesQuery(id);
  });
  const orderedContextIds = dedupeTrafficVolumeIds([
    ...orderedPinnedContext,
    ...remainingContext,
  ]);

  return {
    activePinnedIds,
    dormantPinnedIds,
    matchedCatalogIds,
    requestedCatalogIds,
    orderedContextIds,
    includedContextIds: new Set(orderedContextIds),
    isFiltering,
  };
}

export function filterRecordByTrafficVolume<T>(
  source: Record<string, T> | null | undefined,
  includedIds: ReadonlySet<string>,
): Record<string, T> {
  if (!source) return {};
  const includedKeys = new Set(Array.from(includedIds, (id) => id.toLocaleUpperCase()));
  const result: Record<string, T> = {};
  for (const [id, value] of Object.entries(source)) {
    if (includedKeys.has(id.toLocaleUpperCase())) result[id] = value;
  }
  return result;
}
