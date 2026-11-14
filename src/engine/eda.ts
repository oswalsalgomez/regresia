import { BusinessRule, DerivedVariableAlert, DescriptiveStat } from '../types/regression';
import { formatNumberES } from '../utils/formatters';

function getNumericColumnValues(rows: Record<string, unknown>[], col: string): number[] {
  const vals: number[] = [];
  for (const r of rows) {
    const v = Number(r[col]);
    if (Number.isFinite(v)) vals.push(v);
  }
  return vals;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export function computeDescriptiveStats(
  rows: Record<string, unknown>[],
  numericColumns: string[]
): DescriptiveStat[] {
  return numericColumns.map((col) => {
    const vals = getNumericColumnValues(rows, col);
    const n = vals.length;
    if (n === 0) {
      return {
        column: col,
        n: 0,
        mean: 0,
        sd: 0,
        min: 0,
        q1: 0,
        median: 0,
        q3: 0,
        max: 0,
        skewness: 0,
        isAllPositive: false,
        isBinary: false,
      };
    }

    const sorted = [...vals].sort((a, b) => a - b);
    const distinctCount = new Set(vals).size;
    const isBinary = distinctCount <= 2;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);

    // Adjusted Fisher-Pearson sample skewness
    let skewness = 0;
    if (n >= 3 && sd > 1e-12) {
      const m3 = vals.reduce((acc, v) => acc + ((v - mean) / sd) ** 3, 0);
      skewness = (n / ((n - 1) * (n - 2))) * m3;
    }

    return {
      column: col,
      n,
      mean,
      sd,
      min: sorted[0],
      q1: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      q3: quantile(sorted, 0.75),
      max: sorted[n - 1],
      skewness,
      isAllPositive: sorted[0] > 0,
      isBinary,
    };
  });
}

export interface HistogramBin {
  label: string;
  start: number;
  end: number;
  count: number;
}

export function buildHistogram(rows: Record<string, unknown>[], col: string): HistogramBin[] {
  const vals = getNumericColumnValues(rows, col);
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (Math.abs(max - min) < 1e-12) {
    return [{ label: formatNumberES(min, 2), start: min, end: max, count: vals.length }];
  }
  const numBins = Math.min(12, Math.max(5, Math.ceil(1 + 3.322 * Math.log10(vals.length))));
  const width = (max - min) / numBins;
  const bins: HistogramBin[] = Array.from({ length: numBins }, (_, i) => {
    const s = min + i * width;
    const e = s + width;
    return {
      label: `${formatNumberES(s, max >= 100 ? 0 : 1)}–${formatNumberES(e, max >= 100 ? 0 : 1)}`,
      start: s,
      end: e,
      count: 0,
    };
  });

  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }
  return bins;
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? num / denom : 0;
}

function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length < 2 || y.length < 2) return 0;
  return pearsonCorrelation(rankArray(x), rankArray(y));
}

export function computeCorrelationMatrix(
  rows: Record<string, unknown>[],
  columns: string[],
  method: 'pearson' | 'spearman'
): number[][] {
  const vectors = columns.map((col) => rows.map((r) => Number(r[col])));
  const m = columns.length;
  const matrix: number[][] = Array.from({ length: m }, () => new Array(m).fill(1));

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const validX: number[] = [];
      const validY: number[] = [];
      for (let r = 0; r < rows.length; r++) {
        if (Number.isFinite(vectors[i][r]) && Number.isFinite(vectors[j][r])) {
          validX.push(vectors[i][r]);
          validY.push(vectors[j][r]);
        }
      }
      const corr =
        method === 'pearson'
          ? pearsonCorrelation(validX, validY)
          : spearmanCorrelation(validX, validY);
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }
  return matrix;
}

export function generateBusinessRules(
  rows: Record<string, unknown>[],
  numericColumns: string[],
  targetY: string,
  leakageOrAlerts: Set<string> | DerivedVariableAlert[],
  derivedAlertsList: DerivedVariableAlert[] = [],
  displayNames: Record<string, string> = {},
  dateDerivedSourceMap: Record<string, string> = {}
): BusinessRule[] {
  const alerts: DerivedVariableAlert[] = Array.isArray(leakageOrAlerts)
    ? leakageOrAlerts
    : derivedAlertsList;

  const isDerivedPair = (a: string, b: string): boolean => {
    // Exclude algebraically derived triplets (derivedCol with colA or colB)
    for (const al of alerts) {
      if (
        (al.derivedCol === a && (al.colA === b || al.colB === b)) ||
        (al.derivedCol === b && (al.colA === a || al.colB === a))
      ) {
        return true;
      }
    }
    // Exclude pairs derived from the same date column (e.g. fecha_anio vs fecha_antiguedad_dias)
    if (dateDerivedSourceMap[a] && dateDerivedSourceMap[a] === dateDerivedSourceMap[b]) {
      return true;
    }
    return false;
  };

  const labelOf = (col: string) => displayNames[col]?.trim() || col;
  const rules: BusinessRule[] = [];

  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      let c1 = numericColumns[i];
      let c2 = numericColumns[j];
      if (isDerivedPair(c1, c2)) continue;

      // Put targetY as target when present in the pair for readability
      if (c1 === targetY) {
        c1 = c2;
        c2 = targetY;
      }

      const v1: number[] = [];
      const v2: number[] = [];
      for (const r of rows) {
        const a = Number(r[c1]);
        const b = Number(r[c2]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          v1.push(a);
          v2.push(b);
        }
      }
      if (v1.length < 3) continue;

      const rVal = pearsonCorrelation(v1, v2);
      if (Math.abs(rVal) < 0.3) continue;

      const direction: 'mayor' | 'menor' = rVal >= 0 ? 'mayor' : 'menor';
      rules.push({
        variable: c1,
        target: c2,
        r: rVal,
        direction,
        text: `Si ${labelOf(c1)} es mayor, ${labelOf(c2)} tiende a ser ${direction} (r = ${formatNumberES(rVal, 2)})`,
      });
    }
  }

  rules.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return rules.slice(0, 8);
}
