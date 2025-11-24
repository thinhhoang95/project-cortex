### Goal
Introduce a “magic text box” to search your local flights dataset via an LLM-generated, validated AST that a tiny interpreter runs locally. Plan covers client (this project) and server (hand-off to API team).

## High-level architecture
- Client (React/TS)
  - Ships a small normalized `flights.json`.
  - Sends NL query to your backend, gets an AST back.
  - Validates AST (Zod) and executes locally with a deterministic interpreter.
  - Expands city names to airport codes on-device; renders filter “chips,” supports edits and fallback keyword search.
- Server (FastAPI/Python)
  - Owns canonical AST schema (Pydantic) and field aliases.
  - Calls GPT-5 with Structured Outputs (strict JSON Schema) to return an AST only.
  - Optionally expands city → airport codes before returning; logs usage/telemetry.

## Canonical flight fields (normalized dataset)
Use this as the single source-of-truth across sources (CSV and occupancy JSON), and make the AST target these names.

```yaml
flightId: number                  # from CSV flight_identifier
origin: string                    # ICAO (e.g., LFPG)
destination: string               # ICAO (e.g., EGLL)
originCity: string                # derived via lookup (e.g., Paris)
destinationCity: string           # derived via lookup (e.g., London)
departureDate: string             # ISO yyyy-mm-dd (from date_begin_segment or takeoff_time)
departureTimeMin: number          # 0..1439, local at origin
arrivalTimeMin: number | null     # optional
callSign: string | null
cruiseFL: number | null           # derived from segment FLs (typical or max)
cruiseFLMin: number | null        # optional
cruiseFLMax: number | null        # optional
trafficVolumeIds: number[]        # deduped from occupancy_intervals.tvtw_index
tvOccupancy: object               # { [tvId: string]: { entryTimeMin: number, exitTimeMin: number } } in minutes since midnight at origin local time
distanceNm: number | null         # optional (from occupancy or computed)
status: string | null             # if needed
```

- Data ingestion notes:
  - CSV `origin_aerodrome`/`destination_aerodrome` → `origin`/`destination` (ICAO).
  - `date_begin_segment` (YYMMDD) + `time_begin_segment` → `departureDate` + `departureTimeMin`. If `takeoff_time` exists (ISO), prefer it.
  - Cruise level: derive `cruiseFL` (e.g., max of segment FLs) or average; keep it numeric (e.g., 360).
  - Occupancy JSON: collect `tvtw_index` into `trafficVolumeIds`; keep unique.
  - TV occupancy times: for each `tvtw_index`, compute `entryTimeMin`/`exitTimeMin` by adding `entry_time_s`/`exit_time_s` to `takeoff_time`, then converting to minutes since midnight at the origin local timezone. Store under `tvOccupancy["<tvtw_index>"]`. If a flight crosses the same TV multiple times, keep the earliest entry and the latest exit.
  - City mapping: maintain `CITY_TO_ICAO[cityNameLower] = [ICAO,…]`. Example:
    - Paris → [LFPG, LFPO, LFPB, LFOB]
    - London → [EGLL, EGKK, EGLC, EGGW, EGSS, EGMC]
  - Timezones: store `departureTimeMin` in local origin time; all time-of-day queries operate on this.

## AST (server source-of-truth)
Keep the AST generic and declarative; use the same structure on client and server.

```python
# server/schema.py
from __future__ import annotations
from typing import List, Literal, Optional, Union
from pydantic import BaseModel, Field

Op = Literal[
    "eq","neq","lt","lte","gt","gte",
    "contains","in","between","starts_with","ends_with"
]

class Leaf(BaseModel):
    field: str
    op: Op
    value: Optional[object] = None
    values: Optional[list] = None
    from_: Optional[object] = Field(None, alias="from")
    to: Optional[object] = None
    caseInsensitive: Optional[bool] = False

class All(BaseModel):
    all: List["Node"]

class Any(BaseModel):
    any: List["Node"]

class Not(BaseModel):
    not_: "Node" = Field(..., alias="not")

Node = Union[Leaf, All, Any, Not]

class SortSpec(BaseModel):
    field: str
    dir: Literal["asc","desc"]

class QueryAST(BaseModel):
    where: Optional[Node] = None
    sort: Optional[List[SortSpec]] = None
    select: Optional[List[str]] = None
    limit: Optional[int] = Field(default=50, ge=1, le=500)
    offset: Optional[int] = Field(default=0, ge=0)

def ast_json_schema() -> dict:
    return QueryAST.model_json_schema()
```

### Valid fields and aliases (server)
- Valid fields: `origin`, `destination`, `originCity`, `destinationCity`, `departureDate`, `departureTimeMin`, `arrivalTimeMin`, `callSign`, `cruiseFL`, `cruiseFLMin`, `cruiseFLMax`, `trafficVolumeIds`, `distanceNm`, `status`.
- Dynamic fields (per-TV crossing times): `tvOccupancy.{TV_ID}.entryTimeMin`, `tvOccupancy.{TV_ID}.exitTimeMin` (minutes since midnight at origin local time). Examples: `tvOccupancy.7752.entryTimeMin`, `tvOccupancy.7752.exitTimeMin`.
- Aliases:
  - origin: [from, fromAirport, originAirport, originIcao, departureAirport]
  - destination: [to, toAirport, destinationAirport, destinationIcao, arrivalAirport]
  - originCity/destinationCity: [from city, to city, city of origin/destination]
  - departureTimeMin: [departing at, departure time, dep time, local time]
  - cruiseFL: [cruise level, flight level, FL]
  - trafficVolumeIds: [traffic volume, TV, tvtw_index]
  - callSign: [callsign, airline, carrier, operator]
  - distanceNm: [distance, length]
  - tvOccupancy.*.entryTimeMin: [tv entry time, traffic volume entry time, crossing entry, entry]
  - tvOccupancy.*.exitTimeMin: [tv exit time, traffic volume exit time, crossing exit, exit]

### LLM normalization rules
- Parse times like “08:00–08:30” into minutes 480–510.
- Parse “FL360–FL380” or “360–380” (when FL context implied) into 360..380.
- Expand city names to ICAO airports using a provided list (server can do it, or leave to client post-processing).
- Accept IATA (“CDG”) and map to ICAO (“LFPG”) if your mapping provides it.
- Only emit allowed fields and ops; drop unsupported constraints.
- Traffic volume crossing window: interpret phrases like “crossing TV 7752 between 08:00 and 08:30” as an interval overlap on `tvOccupancy.7752` with window [480,510]. Represent with AST using:
  - `any` of:
    - `tvOccupancy.7752.entryTimeMin between [480,510]`,
    - `tvOccupancy.7752.exitTimeMin between [480,510]`,
    - `all` of `tvOccupancy.7752.entryTimeMin <= 480` and `tvOccupancy.7752.exitTimeMin >= 510`.
- Airline mentions and call signs:
  - If the user says “Air France flights,” map to `callSign starts_with "AF"` (IATA) and/or `"AFR"` (ICAO) with `caseInsensitive: true`. Prefer `starts_with` over `contains` for airline codes.
  - If the user says “call sign contains \"AF\"”, emit `callSign starts_with "AF"` (preferred) or `callSign contains "AF"` with `caseInsensitive: true` when prefix intent is unclear.
  - Maintain a server-side mapping `AIRLINE_TO_PREFIXES` (lowercased keys) with examples: `{"air france":["AF","AFR"], "lufthansa":["LH","DLH"], "british airways":["BA","BAW"], "klm":["KL","KLM"], "ryanair":["FR","RYR"], "easyjet":["U2","EZY"], "turkish airlines":["TK","THY"]}`.

## Server: FastAPI endpoint
- POST `/nl2ast` → returns AST only (validated).
- GET `/schema/ast` → serves JSON Schema for clients.
- Optional: GET `/meta/fields` → valid fields and aliases for UI hints.

```python
# server/app.py
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from schema import ast_json_schema, QueryAST

app = FastAPI(title="Flights NL→AST")
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

VALID_FIELDS = ["origin","destination","originCity","destinationCity",
                "departureDate","departureTimeMin","arrivalTimeMin","callSign",
                "cruiseFL","cruiseFLMin","cruiseFLMax","trafficVolumeIds","distanceNm","status"]

# Dynamic per-TV fields are allowed if they match this pattern, e.g., "tvOccupancy.7752.entryTimeMin"
DYNAMIC_FIELD_PATTERN = r"^tvOccupancy\\.\\d+\\.(entryTimeMin|exitTimeMin)$"

FIELD_ALIASES = {
    "origin": ["from","fromAirport","originAirport","originIcao","departureAirport"],
    "destination": ["to","toAirport","destinationAirport","destinationIcao","arrivalAirport"],
    "originCity": ["from city","origin city"],
    "destinationCity": ["to city","destination city"],
    "departureDate": ["date","on","departing on"],
    "departureTimeMin": ["departing at","departure time","dep time","local time"],
    "arrivalTimeMin": ["arrival time","arr time"],
    "callSign": ["callsign","airline","carrier","operator"],
    "cruiseFL": ["cruise level","flight level","fl"],
    "cruiseFLMin": ["min cruise level","min fl"],
    "cruiseFLMax": ["max cruise level","max fl"],
    "trafficVolumeIds": ["traffic volume","tv","tvtw_index"],
    "distanceNm": ["distance","length"],
    "status": ["state"]
}

AIRLINE_TO_PREFIXES = {
    "air france": ["AF","AFR"],
    "lufthansa": ["LH","DLH"],
    "british airways": ["BA","BAW"],
    "klm": ["KL","KLM"],
    "ryanair": ["FR","RYR"],
    "easyjet": ["U2","EZY"],
    "turkish airlines": ["TK","THY"]
}

SYSTEM = f"""You are a query planner for flights. Return a JSON Query AST that filters/sorts items.
Only use these base fields: {VALID_FIELDS}. You may also use dynamic fields that match {DYNAMIC_FIELD_PATTERN} for per-traffic-volume crossing times (e.g., tvOccupancy.7752.entryTimeMin). Respect these synonyms: {FIELD_ALIASES}.
Normalize:
- Time-of-day like '08:00-08:30' to minutes since midnight local at origin, e.g., 480..510 → field 'departureTimeMin' with 'between'.
- Flight level 'FL360-380' or '360-380' to numeric 360..380 on 'cruiseFL' (or use gte/lte).
- City names are allowed on 'originCity'/'destinationCity'; airport codes on 'origin'/'destination'.
- Traffic volume IDs are integers under 'trafficVolumeIds' (use 'contains' or 'in').
- Traffic volume crossing windows: map 'crossing TV <id> between HH:MM and HH:MM' to an interval overlap on 'tvOccupancy.<id>' using: (entry between) OR (exit between) OR (entry <= from AND exit >= to).
- Airline mentions: if user refers to an airline by name, map to call sign prefixes using {AIRLINE_TO_PREFIXES}. Prefer 'starts_with' with caseInsensitive: true for prefixes (e.g., 'Air France' → callSign starts_with 'AF' and/or 'AFR'). If user says 'call sign contains "AF"', emit a 'starts_with' on 'AF' when plausible, otherwise 'contains'.
Return ONLY a tool call that conforms to the schema; no prose.
"""

class NLRequest(BaseModel):
    query: str

@app.get("/schema/ast")
def schema():
    return ast_json_schema()

@app.post("/nl2ast")
def nl2ast(req: NLRequest):
    schema = ast_json_schema()
    tools = [{
        "type": "function",
        "function": {
            "name": "emit_query_ast",
            "description": "Return the structured QueryAST for filtering/sorting the flights dataset.",
            "strict": True,
            "parameters": schema
        }
    }]
    try:
        resp = client.responses.create(
            model="gpt-5",
            input=[{"role":"system","content":SYSTEM},
                   {"role":"user","content":req.query}],
            tools=tools,
            parallel_tool_calls=False,
        )
    except Exception as e:
        raise HTTPException(500, f"OpenAI error: {e}")

    tool_args = None
    for out in getattr(resp, "output", []) or []:
        if getattr(out, "type", None) == "tool_call" and out.tool_name == "emit_query_ast":
            tool_args = out.arguments
            break
    if tool_args is None:
        raise HTTPException(422, "Model did not return a tool call.")

    ast = QueryAST.model_validate(tool_args)
    return ast.model_dump(by_alias=True)
```

## Client: validation, interpreter, and UI
- Store normalized dataset at `public/data/flights.json`.
- Validate AST with Zod; run interpreter; show chips for inferred filters.
- City → airports expansion can be done:
  - Either instruct LLM to return `originCity`/`destinationCity` constraints and expand client-side; or
  - Ask the model to target `origin`/`destination` directly. Recommend client-side expansion for transparency and control.

```ts
// client/queryEngine.ts
type Dir = 'asc' | 'desc';
type Op =
  | 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'
  | 'contains'|'in'|'between'
  | 'starts_with'|'ends_with';

type Node =
  | { all: Node[] }
  | { any: Node[] }
  | { not: Node }
  | { field: string; op: Op; value?: any; values?: any[]; from?: any; to?: any; caseInsensitive?: boolean };

type Query = { where?: Node; sort?: { field: string; dir: Dir }[]; select?: string[]; limit?: number; offset?: number };

const getByPath = (obj: any, path: string) =>
  path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const cmp = (l: any, r: any) => {
  const ln = Number(l), rn = Number(r);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
  return String(l).localeCompare(String(r), undefined, { numeric: true, sensitivity: 'base' });
};

const testLeaf = (item: any, leaf: Extract<Node,{field:string}>) => {
  let v = getByPath(item, leaf.field);
  const ci = !!(leaf as any).caseInsensitive, norm = (x:any)=> (ci && typeof x==='string') ? x.toLowerCase() : x;
  const A = norm(v), B = norm((leaf as any).value);
  switch ((leaf as any).op) {
    case 'eq': return A===B;
    case 'neq': return A!==B;
    case 'lt': return cmp(A,B)<0;
    case 'lte': return cmp(A,B)<=0;
    case 'gt': return cmp(A,B)>0;
    case 'gte': return cmp(A,B)>=0;
    case 'contains':
      if (Array.isArray(v)) return (leaf as any).value != null && v.map(norm).includes(B);
      return typeof A==='string' && typeof B==='string' && A.includes(B);
    case 'in': return Array.isArray((leaf as any).values) && (leaf as any).values.map(norm).includes(A);
    case 'between': return cmp(A, norm((leaf as any).from))>=0 && cmp(A, norm((leaf as any).to))<=0;
    case 'starts_with': return typeof A==='string' && typeof B==='string' && A.startsWith(B);
    case 'ends_with': return typeof A==='string' && typeof B==='string' && A.endsWith(B);
    default: return false;
  }
};

const evalNode = (node: Node | undefined, item: any): boolean => {
  if (!node) return true;
  if ('all' in node) return node.all.every(n=>evalNode(n,item));
  if ('any' in node) return node.any.some(n=>evalNode(n,item));
  if ('not' in node) return !evalNode((node as any).not,item);
  return testLeaf(item, node as any);
};

export function runQuery<T>(data: T[], q: Query): T[] {
  const filtered = data.filter(d => evalNode(q.where, d));
  const sorted = (q.sort ?? []).reduce((arr, s) => [...arr].sort((a:any,b:any) => {
    const r = cmp(getByPath(a,s.field), getByPath(b,s.field));
    return s.dir==='desc' ? -r : r;
  }), filtered);
  const offset = q.offset ?? 0;
  const paged = typeof q.limit==='number' ? sorted.slice(offset, offset+q.limit) : sorted.slice(offset);
  if (q.select?.length) {
    return paged.map((row:any) => Object.fromEntries(q.select!.map(f => [f, getByPath(row, f)]))) as T[];
  }
  return paged;
}
```

```ts
// client/useNaturalFlightSearch.ts
import { z } from "zod";
import { runQuery } from "./queryEngine";

const NodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({ all: z.array(NodeSchema) }),
    z.object({ any: z.array(NodeSchema) }),
    z.object({ not: NodeSchema }),
    z.object({
      field: z.string(),
      op: z.enum(['eq','neq','lt','lte','gt','gte','contains','in','between','starts_with','ends_with']),
      value: z.any().optional(),
      values: z.array(z.any()).optional(),
      from: z.any().optional(),
      to: z.any().optional(),
      caseInsensitive: z.boolean().optional(),
    }),
  ])
);

export const QuerySchema = z.object({
  where: NodeSchema.optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc','desc']) })).optional(),
  select: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional()
});

export async function nlToAst(nl: string) {
  const res = await fetch("/nl2ast", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ query: nl })
  });
  if (!res.ok) throw new Error("nl2ast failed");
  const raw = await res.json();
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid AST");
  return parsed.data;
}
```

### City expansion (client utility)
- If AST contains `originCity`/`destinationCity`, rewrite to `origin in [ICAO…]`/`destination in [ICAO…]` using your `CITY_TO_ICAO` map, then drop city fields. If no airports found, keep city filters as-is for UI chips but they won’t match.

## Example NL → AST
User: “find flights from Paris to London departing from 08:00 to 08:30, using traffic volume 7701, cruise level between 360 and 380”

Expected AST (pre- or post-expansion):

```json
{
  "where": {
    "all": [
      { "field": "originCity", "op": "eq", "value": "Paris", "caseInsensitive": true },
      { "field": "destinationCity", "op": "eq", "value": "London", "caseInsensitive": true },
      { "field": "departureTimeMin", "op": "between", "from": 480, "to": 510 },
      { "field": "trafficVolumeIds", "op": "contains", "value": 7701 },
      { "field": "cruiseFL", "op": "between", "from": 360, "to": 380 }
    ]
  },
  "sort": [{ "field": "departureTimeMin", "dir": "asc" }],
  "limit": 100,
  "offset": 0
}
```

After client-side city expansion (example airports):
```json
{
  "where": {
    "all": [
      { "field": "origin", "op": "in", "values": ["LFPG","LFPO","LFPB","LFOB"] },
      { "field": "destination", "op": "in", "values": ["EGLL","EGKK","EGLC","EGGW","EGSS","EGMC"] },
      { "field": "departureTimeMin", "op": "between", "from": 480, "to": 510 },
      { "field": "trafficVolumeIds", "op": "contains", "value": 7701 },
      { "field": "cruiseFL", "op": "between", "from": 360, "to": 380 }
    ]
  },
  "sort": [{ "field": "departureTimeMin", "dir": "asc" }]
}
```

### Airline / call sign examples

User: “Air France flights” (or “airline is Air France”)

```json
{
  "where": {
    "any": [
      { "field": "callSign", "op": "starts_with", "value": "AF", "caseInsensitive": true },
      { "field": "callSign", "op": "starts_with", "value": "AFR", "caseInsensitive": true }
    ]
  }
}
```

User: “call sign contains \"AF\"”

```json
{
  "where": {
    "any": [
      { "field": "callSign", "op": "starts_with", "value": "AF", "caseInsensitive": true },
      { "field": "callSign", "op": "contains", "value": "AF", "caseInsensitive": true }
    ]
  }
}
```

## UI/UX
- Magic text box with:
  - Inline chips for interpreted constraints (city, time window, FL, traffic volume).
  - Editable chips → mutate AST then re-run locally.
  - Failure fallback: keyword matches over `origin`, `destination`, `callSign`.
- Results list columns: `departureDate`, `departureTimeMin` (formatted), `origin`, `destination`, `callSign`, `cruiseFL`, `trafficVolumeIds` count.

## ETL outline (for your dataset)
- Script reads:
  - `public/data/flights_20230717_0000-2359.csv`
  - `/Volumes/CrucialX/project-tailwind/output/so6_occupancy_matrix_with_times.json`
- Joins on `flight_identifier` (CSV) ↔ keys in occupancy JSON when available; otherwise heuristics: `(origin, destination, departureDate ~ takeoff_time date, time proximity)`.
- Emits `public/data/flights.json` with the canonical fields above.

## Testing
- Golden tests (server): NL → expected AST snapshots for 15–30 representative queries.
- Interpreter tests (client): Feed ASTs into `runQuery` over a small fixture; assert rows match.
- Schema tests: good/bad ASTs through Pydantic and Zod.
- Fuzz: random ops/fields to ensure interpreter never throws.

## Ops
- Retries and user-friendly errors on `/nl2ast`.
- Log model, tokens, response time, and AST (no PII).
- Cache AST per query string.
- Consider `gpt-5-mini` for low-latency.

## API contract for backend team
- POST `/nl2ast`:
  - Request: `{ "query": string }`
  - Response: `QueryAST` JSON (strict; conforms to `/schema/ast`)
- GET `/schema/ast`: JSON Schema for AST.
- Model: `gpt-5`, Structured Outputs with a single tool `emit_query_ast`, `strict: true`, `parallel_tool_calls: false`.
- System instructions include valid fields, aliases, and normalization rules above.

- - -

- Implemented plan for a client-server NL→AST flight search with a canonical field model; provided AST schema, server endpoint, client interpreter/validation, city-expansion strategy, ETL guidance, and an example AST for the Paris→London query with time window, traffic volume, and cruise FL filters.