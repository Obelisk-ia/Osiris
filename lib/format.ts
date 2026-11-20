import { ConvexError } from "convex/values";

export const MICROS_PER_UNIT = 1_000_000;

export type InventoryUnit = "g" | "ml" | "each";

export const UNIT_SHORT: Record<InventoryUnit, string> = {
  g: "g",
  ml: "ml",
  each: "pza",
};

export const UNIT_LABELS: Record<InventoryUnit, string> = {
  g: "Gramo (g)",
  ml: "Mililitro (ml)",
  each: "Pieza (pza)",
};

export const TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/Mexico_City", label: "Centro (Ciudad de México)" },
  { value: "America/Monterrey", label: "Monterrey" },
  { value: "America/Cancun", label: "Sureste (Cancún)" },
  { value: "America/Mazatlan", label: "Pacífico (Mazatlán)" },
  { value: "America/Tijuana", label: "Noroeste (Tijuana)" },
  { value: "America/Hermosillo", label: "Sonora (Hermosillo)" },
  { value: "America/Chihuahua", label: "Chihuahua" },
];

export function timezoneLabel(tz: string): string {
  return TIMEZONES.find((entry) => entry.value === tz)?.label ?? tz;
}

export function toMicros(value: string | number): number {
  const raw = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").replace("−", "-").trim());
  if (!Number.isFinite(raw)) return NaN;
  const micros = Math.round(raw * MICROS_PER_UNIT);
  return Number.isSafeInteger(micros) ? micros : NaN;
}

export function fromMicros(micros: number): number {
  return Math.round((micros / MICROS_PER_UNIT) * 10000) / 10000;
}

export function formatQty(micros: number, unit: InventoryUnit): string {
  const num = fromMicros(micros);
  return `${num.toLocaleString("es-MX", { maximumFractionDigits: 4 })} ${UNIT_SHORT[unit]}`;
}

export function formatSignedQty(micros: number, unit: InventoryUnit): string {
  const prefix = micros > 0 ? "+" : "";
  return `${prefix}${formatQty(micros, unit)}`;
}

export function parseMoneyCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned || !/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === ".") return NaN;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : NaN;
}

export function formatMoney(cents: number, currencyCode = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatShortDate(date = new Date()): string {
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatIsoDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayIsoDate(timeZone?: string, now = new Date()): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const datePart = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatElapsedMinutes(start: number, end: number) {
  const mins = Math.max(0, Math.floor((end - start) / 60_000));
  if (mins < 1) return { mins, label: "ahora" };
  if (mins < 60) return { mins, label: `${mins} min` };
  return { mins, label: `${Math.floor(mins / 60)} h ${mins % 60} min` };
}

export function toRoman(n: number): string {
  const numerals: Array<[string, number]> = [
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1],
  ];
  let left = n;
  let out = "";
  for (const [roman, value] of numerals) {
    while (left >= value) {
      out += roman;
      left -= value;
    }
  }
  return out || "I";
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function errorMessage(cause: unknown, fallback = "No pudimos guardar el cambio."): string {
  if (cause instanceof ConvexError && typeof cause.data === "string") return cause.data;
  if (cause instanceof Error) {
    const cleaned = cause.message
      .replace(/^\[CONVEX [^\]]+\]\s*/i, "")
      .replace(/^Uncaught ConvexError:\s*/i, "")
      .replace(/^Server Error\s*/i, "")
      .trim();
    if (cleaned) return cleaned;
  }
  return fallback;
}
