export const HUB_NAME: Record<string, string> = { UBC: "UBC", WF: "Waterfront", PR: "Park Royal" };
export const HUB_COLOR: Record<string, [number, number, number]> = { UBC: [0, 114, 178], WF: [230, 159, 0], PR: [0, 158, 115] };
export const HUB_HEX: Record<string, string> = { UBC: "#0072B2", WF: "#E69F00", PR: "#009E73" };
export const DAY_TYPE_LABEL: Record<string, string> = { MF: "Weekday", Sat: "Saturday", "Sun/Hol": "Sunday / holiday" };
export const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const INITIAL_VIEW = { longitude: -122.98, latitude: 49.235, zoom: 9.85, pitch: 0, bearing: 0 };

export const GOOD: [number, number, number] = [46, 158, 91];
export const WARN: [number, number, number] = [242, 169, 59];
export const BAD: [number, number, number] = [214, 69, 69];
export const NODATA: [number, number, number] = [170, 176, 184];

export function loadColor(pct: number | null | undefined): [number, number, number] {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return NODATA;
  if (pct <= 85) return GOOD;
  if (pct <= 100) return WARN;
  return BAD;
}

export const rgb = (c: number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const nf0 = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
export const n0 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : nf0.format(v));
export const n1 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : nf1.format(v));
export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`);
export const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

export function fmtDate(d: string) {
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString("en-CA", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

/** Point on a path closest to (lon, lat), equirectangular distance — fine at city scale. */
export function nearestPoint(path: number[][], lon: number, lat: number): number[] {
  let best = path[0], bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const p of path) {
    const d = ((p[0] - lon) * k) ** 2 + (p[1] - lat) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
