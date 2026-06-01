export interface Extracted {
  raw: string;
  normalized: string;
}

const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g;
const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
const MONTH_DATE_RE = new RegExp(
  "\\b(" + Object.keys(MONTHS).join("|") + ")\\s+(\\d{1,2}),\\s*(\\d{4})\\b",
  "gi",
);

/** Strip currency formatting to a bare numeric string with no trailing zeros (e.g. "1500", "1500.5"). */
export function normalizeMoney(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? String(n) : raw.trim();
}

export function normalizePercent(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? String(n) : raw.trim();
}

/** Normalize a single date string to ISO YYYY-MM-DD, or null if unrecognized. */
export function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (slash) return `${slash[3]!}-${pad(slash[1]!)}-${pad(slash[2]!)}`;
  const month = new RegExp(
    "^(" + Object.keys(MONTHS).join("|") + ")\\s+(\\d{1,2}),\\s*(\\d{4})$",
    "i",
  ).exec(raw.trim());
  if (month) {
    const mm = MONTHS[month[1]!.toLowerCase()]!;
    return `${month[3]}-${mm}-${pad(month[2]!)}`;
  }
  return null;
}

function pad(s: string): string {
  return s.length === 1 ? "0" + s : s;
}

function matchAll(text: string, re: RegExp): string[] {
  return text.match(re) ?? [];
}

export function extractMoney(text: string): Extracted[] {
  return matchAll(text, MONEY_RE).map((raw) => ({ raw, normalized: normalizeMoney(raw) }));
}

export function extractPercentages(text: string): Extracted[] {
  return matchAll(text, PERCENT_RE).map((raw) => ({ raw, normalized: normalizePercent(raw) }));
}

export function extractDates(text: string): Extracted[] {
  const out: Extracted[] = [];
  for (const re of [ISO_DATE_RE, SLASH_DATE_RE, MONTH_DATE_RE]) {
    for (const raw of matchAll(text, re)) {
      const normalized = normalizeDate(raw);
      if (normalized) out.push({ raw, normalized });
    }
  }
  return out;
}

export function extractPattern(text: string, pattern: string): string[] {
  return matchAll(text, new RegExp(pattern, "g"));
}
