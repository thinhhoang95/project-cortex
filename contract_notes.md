## Regulation Plan Simulation API Contract

### Endpoint
- Client calls: `/api/regulation_plan_simulation` (Next.js route)
- Proxies to backend: `${BACKEND_URL || 'http://localhost:8000'}/regulation_plan_simulation`
- Method: POST
- Content-Type: `application/json`

### Request Payload (matches backend spec)
```json
{
  "regulations": [
    "TV_TVA IC__ 3 32",
    {
      "location": "TVA",
      "rate": 1,
      "time_windows": [32],
      "filter_type": "IC",
      "filter_value": "__",
      "target_flight_ids": ["F1", "F2", "F3"]
    }
  ],
  "weights": {"alpha": 1.0, "beta": 0.0, "gamma": 0.0, "delta": 0.0},
  "top_k": 50,
  "include_excess_vector": false
}
```

Client mapping from UI `Regulation`:
- `location` <= `reg.trafficVolume`
- `rate` <= `reg.rate`
- `time_windows` <= 15-min bins between `reg.activeTimeWindowFrom` and `reg.activeTimeWindowTo`
- `target_flight_ids` <= `reg.flightCallsigns`

### Successful Response (example)
```json
{
  "delays_by_flight": {"F1": 5, "F2": 0},
  "delay_stats": {
    "total_delay_seconds": 300.0,
    "mean_delay_seconds": 150.0,
    "max_delay_seconds": 300.0,
    "min_delay_seconds": 0.0,
    "delayed_flights_count": 1,
    "num_flights": 2
  },
  "objective": 12.0,
  "objective_components": {
    "z_sum": 10.0,
    "z_max": 5.0,
    "delay_min": 5.0,
    "num_regs": 2,
    "alpha": 1.0,
    "beta": 2.0,
    "gamma": 0.1,
    "delta": 25.0
  },
  "busiest_pre_anchor": [{
    "traffic_volume_id": "TVA",
    "hour": 8,
    "hour_label": "08:00-09:00",
    "capacity": 1.0,
    "pre_occupancy": 3.0,
    "post_occupancy": 2.0,
    "busy_pre": 2.0,
    "busy_post": 1.0
  }],
  "busiest_post_anchor": [{
    "traffic_volume_id": "TVA",
    "hour": 9,
    "hour_label": "09:00-10:00",
    "capacity": 1.0,
    "pre_occupancy": 1.0,
    "post_occupancy": 2.0,
    "busy_pre": 0.0,
    "busy_post": 1.0
  }],
  "excess_vector_stats": {"sum": 10.0, "max": 3.0, "mean": 0.1, "count": 9600},
  "metadata": {"top_k": 50, "time_bin_minutes": 15, "num_traffic_volumes": 1}
}
```

### Error Responses
- 400: invalid payload
```json
{ "error": "Invalid payload: expected { regulations: [...] }" }
```
- 400: empty regulations
```json
{ "error": "No regulations provided" }
```
- 502: backend proxy error
```json
{ "error": "Backend error: 500", "details": "..." }
```
- 500: server error in route
```json
{ "error": "Failed to process simulation request", "details": "..." }
```

### Frontend Usage Example
```ts
const payload = {
  regulations: regulations.map(r => ({
    location: r.trafficVolume,
    rate: r.rate,
    time_windows: computeTimeWindowBins(r.activeTimeWindowFrom, r.activeTimeWindowTo),
    target_flight_ids: r.flightCallsigns,
  })),
  weights: { alpha: 1.0, beta: 0.0, gamma: 0.0, delta: 0.0 },
  top_k: 25,
  include_excess_vector: false,
};
await fetch('/api/regulation_plan_simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
```

### Edge Cases
- If no regulations exist, the Simulate button is disabled and the client displays: "No regulations available to simulate."
- API returns 400 when regulations array is empty.
