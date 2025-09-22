export function hhmmToMinutesSafe(hhmm?: string): number {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  const total = Math.max(0, Math.min(1439, hh * 60 + mm));
  return total;
}

export function minutesToHHMM(totalMinutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function binIndexToRangeLabel(binIdx: number, minutesPerBin: number): string {
  const startMin = binIdx * minutesPerBin;
  const endMin = startMin + minutesPerBin;
  return `${minutesToHHMM(startMin)}-${minutesToHHMM(endMin)}`;
}

// Parse compact HMS strings like "754" => 00:07:54, "50007" => 05:00:07
export function parseCompactHMS(s: string): number {
  const str = String(s || "").trim();
  if (!/^\d+$/.test(str)) return 0;
  const len = str.length;
  const ss = Number(str.slice(-2));
  const mm = len > 2 ? Number(str.slice(-4, -2) || 0) : 0;
  const hh = len > 4 ? Number(str.slice(0, -4) || 0) : 0;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const H = clamp(Number.isFinite(hh) ? hh : 0, 0, 99);
  const M = clamp(Number.isFinite(mm) ? mm : 0, 0, 59);
  const S = clamp(Number.isFinite(ss) ? ss : 0, 0, 59);
  return H * 3600 + M * 60 + S;
}

export function formatSecondsToHHMMSS(totalSeconds: number): string {
  const seconds = Math.max(0, Math.min(24 * 3600 - 1, Math.floor(totalSeconds)));
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
