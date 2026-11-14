export function formatNumberES(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatIntegerES(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatSmartES(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0,00';
  if (abs >= 1000) return formatNumberES(value, 1);
  if (abs >= 10) return formatNumberES(value, 2);
  if (abs >= 0.1) return formatNumberES(value, 3);
  return formatNumberES(value, 4);
}

export function formatPValueES(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return '< 0,001';
  return formatNumberES(p, 3);
}

export function formatSignedPctES(pct: number, decimals = 1): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${formatNumberES(Math.abs(pct), decimals)} %`;
}

export function defaultDisplayName(original: string): string {
  const clean = String(original ?? '')
    .trim()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || String(original ?? '').trim();
}

/**
 * Normalize column name: strips accents, replaces spaces/symbols with '_',
 * collapses repeated underscores, ensures valid identifier while preserving
 * existing alphanumeric case (e.g., Country -> Country, Computer_Sales -> Computer_Sales).
 */
export function normalizeColumnNames(
  originals: string[]
): { original: string; normalized: string; displayName: string }[] {
  const used = new Set<string>();
  return originals.map((orig, idx) => {
    const trimmed = String(orig ?? '').trim() || `col_${idx + 1}`;
    const noAccents = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let clean = noAccents
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!clean) clean = `col_${idx + 1}`;
    if (/^[0-9]/.test(clean)) clean = `v_${clean}`;
    let candidate = clean;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${clean}_${suffix}`;
      suffix++;
    }
    used.add(candidate);
    return {
      original: trimmed,
      normalized: candidate,
      displayName: defaultDisplayName(trimmed) || candidate,
    };
  });
}

/**
 * Parses a raw cell into a number if valid, supporting comma decimals like "123,45" or "1.234,56".
 */
export function parseFlexibleNumber(raw: unknown): { value: number | null; wasCommaDecimal: boolean } {
  if (raw === null || raw === undefined) return { value: null, wasCommaDecimal: false };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, wasCommaDecimal: false } : { value: null, wasCommaDecimal: false };
  }
  const s = String(raw).trim();
  if (!s || s === '-' || s.toLowerCase() === 'na' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') {
    return { value: null, wasCommaDecimal: false };
  }

  // Standard number
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    const num = Number(s);
    return Number.isFinite(num) ? { value: num, wasCommaDecimal: false } : { value: null, wasCommaDecimal: false };
  }

  // Comma decimal without thousands dot: e.g. "12,45" or "-0,91"
  if (/^[+-]?\d+,\d+$/.test(s)) {
    const num = Number(s.replace(',', '.'));
    return Number.isFinite(num) ? { value: num, wasCommaDecimal: true } : { value: null, wasCommaDecimal: false };
  }

  // European format with thousands dot and comma decimal: e.g. "1.234,56"
  if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    const num = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) ? { value: num, wasCommaDecimal: true } : { value: null, wasCommaDecimal: false };
  }

  // US format with thousands comma and dot decimal: e.g. "1,234.56"
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    const num = Number(s.replace(/,/g, ''));
    return Number.isFinite(num) ? { value: num, wasCommaDecimal: false } : { value: null, wasCommaDecimal: false };
  }

  return { value: null, wasCommaDecimal: false };
}

function buildValidUTCDate(year: number, month: number, day: number): Date | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  ) {
    return d;
  }
  return null;
}

/**
 * Parses date cells from YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, Date instances, or Excel serial dates.
 */
export function parseFlexibleDate(raw: unknown, allowExcelSerial = false): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) &&
      raw.getUTCFullYear() >= 1900 &&
      raw.getUTCFullYear() <= 2100
      ? new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()))
      : null;
  }
  if (typeof raw === 'number') {
    if (!allowExcelSerial || !Number.isFinite(raw) || raw < 15000 || raw > 75000) {
      return null;
    }
    // Excel serial date (days since 1899-12-30 UTC)
    const utcMs = Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000;
    const d = new Date(utcMs);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD (optionally with time component) or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (isoMatch) {
    return buildValidUTCDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // DD/MM/YYYY or DD-MM-YYYY (optionally with time component)
  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s.*)?$/.exec(s);
  if (dmyMatch) {
    return buildValidUTCDate(Number(dmyMatch[3]), Number(dmyMatch[2]), Number(dmyMatch[1]));
  }

  return null;
}

export function formatIsoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTodayMidnightUTC(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function computeDateFeatures(
  d: Date,
  todayMidnightUTC: number = getTodayMidnightUTC()
): { year: number; month: number; ageDays: number } {
  const dUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    ageDays: Math.floor((todayMidnightUTC - dUtc) / 86400000),
  };
}

export function isEmptyCell(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'number') return !Number.isFinite(raw);
  if (raw instanceof Date) return !Number.isFinite(raw.getTime());
  const s = String(raw).trim();
  return s === '' || s.toLowerCase() === 'na' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan';
}

export function resolveYUnit(yUnit: string, yName?: string): string {
  const manual = yUnit.trim();
  if (manual) return manual;

  const col = (yName ?? '').trim();
  if (!col) return 'unidades';

  const low = col
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const unitRules: [RegExp, string][] = [
    [/(^|[\s_-])millones([\s_-]|$)/, 'millones'],
    [/(^|[\s_-])miles([\s_-]|$)/, 'miles'],
    [/(^|[\s_-])(usd|dolares)([\s_-]|$)/, 'USD'],
    [/(^|[\s_-])(eur|euros)([\s_-]|$)/, 'EUR'],
    [/(^|[\s_-])(cop|pesos)([\s_-]|$)/, 'COP'],
    [/(^|[\s_-])(mxn)([\s_-]|$)/, 'MXN'],
    [/(^|[\s_-])(pct|porcentaje|percent)([\s_-]|$)/, '%'],
    [/(^|[\s_-])(kg|kilos|kilogramos)([\s_-]|$)/, 'kg'],
    [/(^|[\s_-])(ton|toneladas)([\s_-]|$)/, 'toneladas'],
    [/(^|[\s_-])(litros|lt)([\s_-]|$)/, 'litros'],
    [/(^|[\s_-])(horas|hrs)([\s_-]|$)/, 'horas'],
    [/(^|[\s_-])(dias)([\s_-]|$)/, 'días'],
    [/(^|[\s_-])(unidades|units)([\s_-]|$)/, 'unidades'],
  ];

  for (const [regex, unit] of unitRules) {
    if (regex.test(low)) return unit;
  }

  return `unidades de ${col}`;
}

