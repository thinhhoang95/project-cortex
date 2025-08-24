export function parseCompactHMS(s: string): number {
  // "754" -> 00:07:54, "50007" -> 05:00:07
  const p = s.trim();
  const sec = parseInt(p.slice(-2) || "0", 10);
  const min = parseInt(p.slice(-4, -2) || "0", 10);
  const hr  = parseInt(p.slice(0, -4) || "0", 10);
  return hr * 3600 + min * 60 + sec;
}

export function parseYYMMDD(d: string): Date {
  const y = 2000 + parseInt(d.slice(0, 2), 10);
  const m = parseInt(d.slice(2, 4), 10) - 1;
  const day = parseInt(d.slice(4, 6), 10);
  return new Date(Date.UTC(y, m, day));
}