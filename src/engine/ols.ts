import jStat from 'jstat';
import {
  AssumptionCheck,
  CandidateXInfo,
  CoefficientDetail,
  DerivedVariableAlert,
  DescriptiveStat,
  ModelSelectionOutput,
  ModelTransform,
  RegressionModelResult,
  RowDiagnostic,
  VariableControlType,
} from '../types/regression';
import { formatNumberES, formatPValueES, formatSignedPctES, resolveYUnit } from '../utils/formatters';
import { createMulberry32 } from '../utils/prng';

const KEYWORD_SYNONYMS: Record<string, string[]> = {
  ventas: ['sales', 'venta', 'ventas', 'revenue', 'turnover', 'facturacion', 'clv', 'valor', 'gasto'],
  venta: ['sales', 'venta', 'ventas', 'revenue'],
  computadores: ['computer', 'pc', 'laptop', 'computador', 'computadores'],
  ingreso: ['income', 'gnp', 'gdp', 'pib', 'ingreso', 'ingresos', 'renta', 'salario'],
  ingresos: ['income', 'gnp', 'gdp', 'pib', 'ingreso', 'ingresos', 'revenue', 'sales'],
  poblacion: ['pop', 'population', 'poblacion', 'habitantes'],
  precio: ['price', 'precio', 'precios', 'tarifa', 'valor'],
  costo: ['cost', 'costo', 'costos', 'gasto', 'gastos'],
  desempleo: ['unemployment', 'desempleo', 'paro'],
  educacion: ['edu', 'education', 'educacion', 'gasto_edu'],
  utilidad: ['profit', 'utilidad', 'ganancia', 'margen', 'ebitda'],
  demanda: ['demand', 'demanda', 'cantidad', 'unidades', 'units'],
  produccion: ['production', 'output', 'produccion'],
  consumo: ['consumption', 'consumo'],
  clientes: ['customers', 'clients', 'clientes'],
};

function tokenizeSpanish(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

export function suggestTargetY(
  businessQuestion: string,
  numericColumns: string[],
  stats: DescriptiveStat[],
  derivedAlerts: DerivedVariableAlert[],
  dateFeatureSet: Set<string> = new Set()
): { suggestedY: string; reason: string } {
  if (numericColumns.length === 0) {
    return { suggestedY: '', reason: 'No hay columnas numéricas disponibles.' };
  }

  const statMap = new Map(stats.map((s) => [s.column, s]));
  const nonBinaryCols = numericColumns.filter((c) => !statMap.get(c)?.isBinary);
  const candidatePool = nonBinaryCols.length > 0 ? nonBinaryCols : numericColumns;
  const nonDatePool = candidatePool.filter((c) => !dateFeatureSet.has(c));
  const searchPool = nonDatePool.length > 0 ? nonDatePool : candidatePool;

  const derivedSet = new Set(derivedAlerts.map((d) => d.derivedCol));
  const qTokens = tokenizeSpanish(businessQuestion);
  const expandedTokens = new Set<string>();
  for (const tok of qTokens) {
    expandedTokens.add(tok);
    if (KEYWORD_SYNONYMS[tok]) {
      for (const syn of KEYWORD_SYNONYMS[tok]) expandedTokens.add(syn);
    }
  }

  let bestCol = '';
  let bestScore = 0;

  for (const col of searchPool) {
    const colTokens = col
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    let score = 0;
    for (const ct of colTokens) {
      for (const qt of expandedTokens) {
        if (ct === qt) score += 3;
        else if (ct.includes(qt) || qt.includes(ct)) score += 1.5;
      }
    }
    if (score > 0 && !derivedSet.has(col)) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  if (bestCol && bestScore > 0) {
    return {
      suggestedY: bestCol,
      reason: `Coincidencia directa con palabras clave de la pregunta de negocio ("${bestCol}").`,
    };
  }

  const nonDerivedStats = stats.filter(
    (s) => searchPool.includes(s.column) && !derivedSet.has(s.column)
  );
  const pool =
    nonDerivedStats.length > 0
      ? nonDerivedStats
      : stats.filter((s) => searchPool.includes(s.column));
  let bestCV = -1;
  let cvCol = pool[0]?.column ?? searchPool[0];
  for (const s of pool) {
    const cv = Math.abs(s.mean) > 1e-9 ? s.sd / Math.abs(s.mean) : s.sd;
    if (cv > bestCV) {
      bestCV = cv;
      cvCol = s.column;
    }
  }
  return {
    suggestedY: cvCol,
    reason: `Sin coincidencia textual directa en la pregunta; se eligió "${cvCol}" por tener la mayor varianza relativa entre variables continuas (CV = ${formatNumberES(bestCV, 2)}).`,
  };
}

export function getLeakageBlockedForY(
  targetY: string,
  derivedAlerts: DerivedVariableAlert[]
): Map<string, string> {
  const blocked = new Map<string, string>();
  for (const alert of derivedAlerts) {
    if (alert.derivedCol === targetY) {
      blocked.set(
        alert.colA,
        `Fuga de información: ${alert.derivedCol} se calcula directamente con ${alert.colA} (${alert.formulaText}).`
      );
      blocked.set(
        alert.colB,
        `Fuga de información: ${alert.derivedCol} se calcula directamente con ${alert.colB} (${alert.formulaText}).`
      );
    } else if (alert.colA === targetY || alert.colB === targetY) {
      blocked.set(
        alert.derivedCol,
        `Fuga de información: ${alert.derivedCol} contiene a ${targetY} en su fórmula (${alert.formulaText}).`
      );
    }
  }
  return blocked;
}

export function suggestVariableControlType(colName: string): VariableControlType {
  const low = colName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (
    /(precio|price|tarifa|pauta|publicidad|marketing|promo|descuento|discount|canal|channel|tienda|store|sucursal|vendedor|fuerza_venta|presupuesto|budget|inversion|capex|opex|stock|inventario|comision|envio|delivery|ad_spend|ads)/.test(
      low
    )
  ) {
    return 'controllable';
  }

  return 'external';
}

export function buildCandidateXList(
  targetY: string,
  numericColumns: string[],
  dummyColumns: { name: string; sourceColumn: string; level: string; referenceLevel: string }[],
  stats: DescriptiveStat[],
  derivedAlerts: DerivedVariableAlert[],
  controlTypeOverrides: Record<string, VariableControlType> = {},
  dateFeatureSourceMap: Record<string, string> = {}
): CandidateXInfo[] {
  const statsMap = new Map(stats.map((s) => [s.column, s]));
  const leakageMap = getLeakageBlockedForY(targetY, derivedAlerts);
  const derivedElsewhere = new Map<string, DerivedVariableAlert>();
  for (const alert of derivedAlerts) {
    if (!leakageMap.has(alert.derivedCol) && alert.derivedCol !== targetY) {
      derivedElsewhere.set(alert.derivedCol, alert);
    }
  }

  const list: CandidateXInfo[] = [];

  for (const col of numericColumns) {
    if (col === targetY) continue;
    const st = statsMap.get(col);
    const leakReason = leakageMap.get(col);
    const otherDerived = derivedElsewhere.get(col);
    const dateSrc = dateFeatureSourceMap[col];
    const suggestedControlType = suggestVariableControlType(col);
    const controlType = controlTypeOverrides[col] ?? suggestedControlType;

    if (leakReason) {
      list.push({
        name: col,
        isDummy: false,
        isDateFeature: Boolean(dateSrc),
        sourceColumn: dateSrc ?? col,
        suggestedInclude: false,
        reason: leakReason,
        blockedByLeakage: true,
        leakageReason: leakReason,
        isAllPositive: st?.isAllPositive ?? false,
        skewness: st?.skewness ?? 0,
        suggestedControlType,
        controlType,
      });
    } else if (otherDerived) {
      list.push({
        name: col,
        isDummy: false,
        isDateFeature: Boolean(dateSrc),
        sourceColumn: dateSrc ?? col,
        suggestedInclude: false,
        reason: `Excluida por defecto porque es derivada (${otherDerived.formulaText}); evitar redundancia exacta.`,
        blockedByLeakage: false,
        isAllPositive: st?.isAllPositive ?? false,
        skewness: st?.skewness ?? 0,
        suggestedControlType,
        controlType,
      });
    } else if (dateSrc) {
      list.push({
        name: col,
        isDummy: false,
        isDateFeature: true,
        sourceColumn: dateSrc,
        suggestedInclude: true,
        reason: `Variable numérica derivada automáticamente de la fecha "${dateSrc}".`,
        blockedByLeakage: false,
        isAllPositive: st?.isAllPositive ?? false,
        skewness: st?.skewness ?? 0,
        suggestedControlType: 'external',
        controlType: controlTypeOverrides[col] ?? 'external',
      });
    } else {
      const isBinaryZeroOne = Boolean(st?.isBinary && st.min === 0 && st.max === 1);
      const skewNote =
        !isBinaryZeroOne && st && Math.abs(st.skewness) > 1 && st.isAllPositive
          ? ` (asimetría ${formatNumberES(st.skewness, 2)}: candidata a log)`
          : '';
      list.push({
        name: col,
        isDummy: false,
        isBinary: isBinaryZeroOne || Boolean(st?.isBinary),
        sourceColumn: col,
        suggestedInclude: true,
        reason: isBinaryZeroOne
          ? 'Variable binaria (0/1): pertenecer a la categoría 1 frente a 0.'
          : `Variable numérica independiente válida${skewNote}.`,
        blockedByLeakage: false,
        isAllPositive: st?.isAllPositive ?? false,
        skewness: st?.skewness ?? 0,
        suggestedControlType,
        controlType,
      });
    }
  }

  for (const d of dummyColumns) {
    const suggestedControlType = suggestVariableControlType(d.sourceColumn);
    const controlType = controlTypeOverrides[d.name] ?? suggestedControlType;
    list.push({
      name: d.name,
      isDummy: true,
      sourceColumn: d.sourceColumn,
      suggestedInclude: true,
      reason: `Variable indicadora (dummy) para "${d.sourceColumn} = ${d.level}" vs. referencia "${d.referenceLevel}".`,
      blockedByLeakage: false,
      isAllPositive: false,
      skewness: 0,
      suggestedControlType,
      controlType,
    });
  }

  return list;
}

/**
 * Fast symmetric/general Gauss-Jordan matrix inversion with partial pivoting.
 */
function invertSquareMatrix(mat: number[][]): number[][] | null {
  const m = mat.length;
  const aug: number[][] = Array.from({ length: m }, (_, i) => {
    const row = new Array<number>(2 * m).fill(0);
    for (let j = 0; j < m; j++) row[j] = mat[i][j];
    row[m + i] = 1;
    return row;
  });

  for (let col = 0; col < m; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(aug[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-13 || !Number.isFinite(maxVal)) return null;

    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const diag = aug[col][col];
    for (let j = col; j < 2 * m; j++) aug[col][j] /= diag;

    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = col; j < 2 * m; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(m));
}

function solveOLSBasic(
  X: number[][],
  y: number[]
): { beta: number[]; xtXInv: number[][]; yHat: number[]; residuals: number[] } | null {
  const n = X.length;
  if (n === 0) return null;
  const p = X[0].length;
  if (n <= p) return null;

  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);

  for (let i = 0; i < n; i++) {
    const xi = X[i];
    const yi = y[i];
    for (let a = 0; a < p; a++) {
      const xia = xi[a];
      Xty[a] += xia * yi;
      for (let b = a; b < p; b++) {
        XtX[a][b] += xia * xi[b];
      }
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) {
      XtX[a][b] = XtX[b][a];
    }
  }

  const xtXInv = invertSquareMatrix(XtX);
  if (!xtXInv) return null;

  const beta = new Array<number>(p).fill(0);
  for (let a = 0; a < p; a++) {
    let sum = 0;
    for (let b = 0; b < p; b++) {
      sum += xtXInv[a][b] * Xty[b];
    }
    if (!Number.isFinite(sum)) return null;
    beta[a] = sum;
  }

  const yHat = new Array<number>(n);
  const residuals = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    let pred = 0;
    for (let a = 0; a < p; a++) pred += xi[a] * beta[a];
    yHat[i] = pred;
    residuals[i] = y[i] - pred;
  }

  return { beta, xtXInv, yHat, residuals };
}

function computeVifFromDesign(XNoIntercept: number[][], n: number, k: number): number[] {
  if (k <= 1) return new Array(k).fill(1);
  // Compute full XtX of [1, X1..Xk] and invert ONCE! Diagonal of R^{-1} when using correlation matrix equals VIF!
  // Compute correlation matrix of XNoIntercept (exact algebraic identity: VIF_j = (R^{-1})_{jj}):
  const means = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) means[j] += XNoIntercept[i][j];
  }
  for (let j = 0; j < k; j++) means[j] /= n;

  const sds = new Array<number>(k).fill(0);
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < n; i++) {
    const row = XNoIntercept[i];
    for (let a = 0; a < k; a++) {
      const da = row[a] - means[a];
      for (let b = a; b < k; b++) {
        cov[a][b] += da * (row[b] - means[b]);
      }
    }
  }
  for (let j = 0; j < k; j++) sds[j] = Math.sqrt(Math.max(cov[j][j], 0));

  const corr: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const denom = sds[a] * sds[b];
      const r = denom > 1e-12 ? cov[a][b] / denom : a === b ? 1 : 0;
      corr[a][b] = r;
      corr[b][a] = r;
    }
  }

  const corrInv = invertSquareMatrix(corr);
  if (corrInv) {
    return corrInv.map((row, j) => {
      const v = row[j];
      return Number.isFinite(v) && v >= 1 ? v : 999;
    });
  }

  // Fallback per-predictor if correlation matrix is near-singular
  const vifs: number[] = [];
  for (let j = 0; j < k; j++) {
    const yj = XNoIntercept.map((row) => row[j]);
    const XOthers = XNoIntercept.map((row) => {
      const out = [1];
      for (let m = 0; m < k; m++) {
        if (m !== j) out.push(row[m]);
      }
      return out;
    });
    const res = solveOLSBasic(XOthers, yj);
    if (!res) {
      vifs.push(999);
      continue;
    }
    const yMean = means[j];
    const sst = cov[j][j];
    const sse = res.residuals.reduce((acc, e) => acc + e * e, 0);
    const r2j = sst > 1e-12 ? Math.max(0, Math.min(1, 1 - sse / sst)) : 0;
    vifs.push(1 / Math.max(1 - r2j, 1e-6));
  }
  return vifs;
}

function compute10FoldCVRmse(XModel: number[][], yModel: number[], n: number): number {
  const rng = createMulberry32(42);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  const folds = 10;
  let totalSqErr = 0;
  let countErr = 0;

  for (let f = 0; f < folds; f++) {
    const start = Math.floor((f * n) / folds);
    const end = Math.floor(((f + 1) * n) / folds);
    const inVal = new Uint8Array(n);
    for (let idx = start; idx < end; idx++) inVal[indices[idx]] = 1;

    const XTrain: number[][] = [];
    const yTrain: number[] = [];
    const valIndices: number[] = [];

    for (let i = 0; i < n; i++) {
      if (inVal[i]) valIndices.push(i);
      else {
        XTrain.push(XModel[i]);
        yTrain.push(yModel[i]);
      }
    }

    const fit = solveOLSBasic(XTrain, yTrain);
    if (!fit) continue;

    for (const i of valIndices) {
      const xi = XModel[i];
      let pred = 0;
      for (let c = 0; c < xi.length; c++) pred += xi[c] * fit.beta[c];
      const err = yModel[i] - pred;
      totalSqErr += err * err;
      countErr++;
    }
  }

  return countErr > 0 ? Math.sqrt(totalSqErr / countErr) : 0;
}

export function fitSingleOLSModel(
  rows: Record<string, unknown>[],
  rowLabels: string[],
  yName: string,
  predictors: string[],
  dummySet: Set<string>,
  transform: ModelTransform,
  yUnit: string,
  includeReestimation = true
): RegressionModelResult | null {
  const n = rows.length;
  const k = predictors.length;
  if (n <= k + 2 || k === 0) return null;

  const yOrig: number[] = [];
  const yModel: number[] = [];
  const XModel: number[][] = [];
  const XNoInt: number[][] = [];
  const predTransformedFlags = predictors.map((p) => transform === 'log-log' && !dummySet.has(p));

  for (let i = 0; i < n; i++) {
    const rawY = Number(rows[i][yName]);
    if (!Number.isFinite(rawY)) return null;
    if (transform === 'log-log' && rawY <= 0) return null;
    yOrig.push(rawY);
    yModel.push(transform === 'log-log' ? Math.log(rawY) : rawY);

    const rowX = [1];
    const rowXNoInt: number[] = [];
    for (let j = 0; j < k; j++) {
      const val = Number(rows[i][predictors[j]]);
      if (!Number.isFinite(val)) return null;
      if (predTransformedFlags[j] && val <= 0) return null;
      const tVal = predTransformedFlags[j] ? Math.log(val) : val;
      rowX.push(tVal);
      rowXNoInt.push(tVal);
    }
    XModel.push(rowX);
    XNoInt.push(rowXNoInt);
  }

  const ols = solveOLSBasic(XModel, yModel);
  if (!ols) return null;

  const { beta, xtXInv, yHat, residuals } = ols;
  const df = n - k - 1;
  const sse = residuals.reduce((acc, e) => acc + e * e, 0);
  const yMean = yModel.reduce((a, b) => a + b, 0) / n;
  const sst = yModel.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const mse = sse / df;
  const rmse = Math.sqrt(mse);

  const r2 = sst > 1e-12 ? 1 - sse / sst : 0;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / df;

  const logTerm = Math.log(Math.max(sse / n, 1e-15));
  const aic = n * Math.log(2 * Math.PI) + n * logTerm + n + 2 * (k + 2);
  const bic = n * Math.log(2 * Math.PI) + n * logTerm + n + (k + 2) * Math.log(n);

  const ssr = Math.max(0, sst - sse);
  const fStat = mse > 1e-15 ? (ssr / k) / mse : 0;
  const fPValue = fStat > 0 ? Math.max(0, 1 - jStat.centralF.cdf(fStat, k, df)) : 1;

  const vifs = computeVifFromDesign(XNoInt, n, k);
  const maxVif = Math.max(...vifs);

  const covMatrix = xtXInv.map((row) => row.map((v) => v * mse));

  const leverages: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = XModel[i];
    let h = 0;
    for (let a = 0; a < xi.length; a++) {
      let rowSum = 0;
      for (let b = 0; b < xi.length; b++) {
        rowSum += xtXInv[a][b] * xi[b];
      }
      h += xi[a] * rowSum;
    }
    leverages.push(Math.min(Math.max(h, 0), 0.999999));
  }

  const cvMethod: 'loocv' | 'kfold10' = n > 500 ? 'kfold10' : 'loocv';
  let loocvRmse = 0;
  if (cvMethod === 'kfold10') {
    loocvRmse = compute10FoldCVRmse(XModel, yModel, n);
  } else {
    let loocvSqSum = 0;
    for (let i = 0; i < n; i++) {
      const looErr = residuals[i] / Math.max(1 - leverages[i], 1e-6);
      loocvSqSum += looErr * looErr;
    }
    loocvRmse = Math.sqrt(loocvSqSum / n);
  }

  const smearingFactor =
    transform === 'log-log'
      ? residuals.reduce((acc, e) => acc + Math.exp(e), 0) / n
      : 1;

  const ySd = Math.sqrt(sst / (n - 1));
  const xSds = predictors.map((_, j) => {
    const vals = XNoInt.map((row) => row[j]);
    const mx = vals.reduce((a, b) => a + b, 0) / n;
    const vx = vals.reduce((acc, v) => acc + (v - mx) ** 2, 0) / (n - 1);
    return Math.sqrt(vx);
  });

  const tCrit = jStat.studentt.inv(0.975, df);
  const unitLabel = resolveYUnit(yUnit, yName);

  const coefficients: CoefficientDetail[] = beta.map((est, idx) => {
    const varEst = Math.max(covMatrix[idx][idx], 0);
    const stdError = Math.sqrt(varEst);
    const tStat = stdError > 1e-15 ? est / stdError : 0;
    const pValue = Math.max(0, Math.min(1, 2 * (1 - jStat.studentt.cdf(Math.abs(tStat), df))));
    const ciLower = est - tCrit * stdError;
    const ciUpper = est + tCrit * stdError;

    if (idx === 0) {
      return {
        name: '(Intercepto)',
        isIntercept: true,
        isTransformedLog: false,
        estimate: est,
        stdError,
        tStat,
        pValue,
        ciLower,
        ciUpper,
        standardizedBeta: null,
        vif: null,
        interpretation:
          transform === 'log-log'
            ? `Valor base en escala logarítmica (${formatNumberES(est, 2)}); en unidades originales corresponde a un factor base de ${formatNumberES(Math.exp(est), 4)}.`
            : `Valor esperado de ${yName} cuando todas las variables X valen cero.`,
      };
    }

    const pIdx = idx - 1;
    const predName = predictors[pIdx];
    const isLogX = predTransformedFlags[pIdx];
    const standardizedBeta = ySd > 1e-12 ? est * (xSds[pIdx] / ySd) : 0;

    let isBinaryZeroOne = false;
    if (!dummySet.has(predName) && !isLogX) {
      const distinctVals = new Set<number>();
      let onlyZeroOne = true;
      for (let i = 0; i < n; i++) {
        const v = Number(rows[i][predName]);
        if (v !== 0 && v !== 1) {
          onlyZeroOne = false;
          break;
        }
        distinctVals.add(v);
      }
      isBinaryZeroOne = onlyZeroOne && distinctVals.size === 2;
    }

    let interpretation = '';
    if (transform === 'log-log' && isLogX) {
      const pctChange10 = (Math.pow(1.1, est) - 1) * 100;
      interpretation = `Si ${predName} aumenta 10 %, ${yName} cambia ${formatSignedPctES(pctChange10, 2)} (elasticidad = ${formatNumberES(est, 2)}).`;
    } else if (transform === 'log-log' && !isLogX) {
      const pctChangeUnit = (Math.exp(est) - 1) * 100;
      interpretation = isBinaryZeroOne
        ? `Pertenecer a la categoría 1 de ${predName} (frente a 0) se asocia con un cambio de ${formatSignedPctES(pctChangeUnit, 2)} en ${yName}.`
        : `Cuando ${predName} cambia de 0 a 1, ${yName} cambia ${formatSignedPctES(pctChangeUnit, 2)}.`;
    } else if (isBinaryZeroOne) {
      const dirText = est >= 0 ? 'un aumento de' : 'una disminución de';
      interpretation = `Manteniendo lo demás constante, pertenecer a la categoría 1 de ${predName} (frente a 0) se asocia con ${dirText} ${formatNumberES(Math.abs(est), 3)} ${unitLabel} en ${yName}.`;
    } else {
      const directionWord = est >= 0 ? 'aumenta' : 'disminuye';
      interpretation = `Manteniendo lo demás constante, si ${predName} aumenta 1 unidad, ${yName} ${directionWord} ${formatNumberES(Math.abs(est), 3)} ${unitLabel}.`;
    }

    return {
      name: predName,
      isIntercept: false,
      isTransformedLog: isLogX,
      estimate: est,
      stdError,
      tStat,
      pValue,
      ciLower,
      ciUpper,
      standardizedBeta,
      vif: vifs[pIdx],
      interpretation,
    };
  });

  const predictorCoefs = coefficients.filter((c) => !c.isIntercept);
  const maxPValuePredictors = Math.max(...predictorCoefs.map((c) => c.pValue));
  const maxPValueAll = Math.max(...coefficients.map((c) => c.pValue));

  const cookThreshold = 4 / n;
  let origSqErrSum = 0;
  let apeSum = 0;

  const rowDiagnostics: RowDiagnostic[] = [];
  for (let i = 0; i < n; i++) {
    const e = residuals[i];
    const h = leverages[i];
    const denom = Math.max(1 - h, 1e-6);
    const stdRes = mse > 1e-15 ? e / Math.sqrt(mse * denom) : 0;
    const cooksD = mse > 1e-15 ? ((e * e) / ((k + 1) * mse)) * (h / (denom * denom)) : 0;

    const yPredOrig = transform === 'log-log' ? Math.exp(yHat[i]) * smearingFactor : yHat[i];
    const yActOrig = yOrig[i];
    const gap = yActOrig - yPredOrig;
    const gapPct = Math.abs(yPredOrig) > 1e-9 ? (gap / yPredOrig) * 100 : 0;

    origSqErrSum += (yActOrig - yPredOrig) ** 2;
    apeSum += Math.abs(yActOrig - yPredOrig) / Math.max(Math.abs(yActOrig), 1e-9);

    rowDiagnostics.push({
      rowIndex: i + 1,
      rowLabel: rowLabels[i] ?? `Fila ${i + 1}`,
      yActual: yActOrig,
      yPredicted: yPredOrig,
      yPredictedModelSpace: yHat[i],
      yActualModelSpace: yModel[i],
      residualModelSpace: e,
      standardizedResidual: stdRes,
      leverage: h,
      cooksDistance: cooksD,
      isInfluential: cooksD > cookThreshold,
      gap,
      gapPct,
    });
  }

  const rmseOriginal = Math.sqrt(origSqErrSum / n);
  const mape = (apeSum / n) * 100;

  const influentialRows = rowDiagnostics.filter((r) => r.isInfluential);
  let reestimatedWithoutInfluential: RegressionModelResult['reestimatedWithoutInfluential'];

  if (includeReestimation && influentialRows.length > 0 && n - influentialRows.length > k + 2) {
    const infSet = new Set(influentialRows.map((r) => r.rowIndex));
    const filteredRows = rows.filter((_, idx) => !infSet.has(idx + 1));
    const filteredLabels = rowLabels.filter((_, idx) => !infSet.has(idx + 1));
    const refit = fitSingleOLSModel(
      filteredRows,
      filteredLabels,
      yName,
      predictors,
      dummySet,
      transform,
      yUnit,
      false
    );
    if (refit) {
      reestimatedWithoutInfluential = {
        nRemaining: filteredRows.length,
        adjR2: refit.adjR2,
        coefficients: coefficients.map((c, idx) => {
          const newEst = refit.coefficients[idx]?.estimate ?? c.estimate;
          const pctDiff = Math.abs(c.estimate) > 1e-9 ? ((newEst - c.estimate) / Math.abs(c.estimate)) * 100 : 0;
          return {
            name: c.name,
            original: c.estimate,
            withoutInfluential: newEst,
            pctDiff,
          };
        }),
      };
    }
  }

  const assumptions = buildAssumptionChecks(
    residuals,
    XModel,
    n,
    k,
    maxVif,
    rowDiagnostics,
    reestimatedWithoutInfluential
  );

  const predictorDisplayNames = predictors.map((p, idx) =>
    predTransformedFlags[idx] ? `ln(${p})` : p
  );

  return {
    id: `${transform}::${predictors.join('+')}`,
    transform,
    yName,
    predictors,
    predictorDisplayNames,
    n,
    k,
    r2,
    adjR2,
    rmse,
    rmseOriginal,
    mape,
    aic,
    bic,
    fStat,
    fPValue,
    maxPValuePredictors,
    maxPValueAll,
    maxVif,
    cvMethod,
    loocvRmse,
    smearingFactor,
    sse,
    mse,
    covMatrix,
    xtXInv,
    coefficients,
    rows: rowDiagnostics,
    assumptions,
    influentialRows,
    reestimatedWithoutInfluential,
    allPredictorsSignificant: maxPValuePredictors < 0.05,
    vifAcceptable: maxVif < 5,
  };
}

function buildAssumptionChecks(
  residuals: number[],
  XModel: number[][],
  n: number,
  k: number,
  maxVif: number,
  rowDiagnostics: RowDiagnostic[],
  reestimatedWithoutInfluential?: RegressionModelResult['reestimatedWithoutInfluential']
): AssumptionCheck[] {
  const meanE = residuals.reduce((a, b) => a + b, 0) / n;
  const m2 = residuals.reduce((acc, e) => acc + (e - meanE) ** 2, 0) / n;
  const m3 = residuals.reduce((acc, e) => acc + (e - meanE) ** 3, 0) / n;
  const m4 = residuals.reduce((acc, e) => acc + (e - meanE) ** 4, 0) / n;
  const skew = m2 > 1e-15 ? m3 / Math.pow(m2, 1.5) : 0;
  const kurt = m2 > 1e-15 ? m4 / (m2 * m2) : 3;
  const jb = (n / 6) * (skew * skew + ((kurt - 3) * (kurt - 3)) / 4);
  const jbP = Math.max(0, 1 - jStat.chisquare.cdf(jb, 2));

  let jbStatus: AssumptionCheck['status'];
  let jbSummary: string;
  if (n > 500) {
    if (jbP >= 0.05) {
      jbStatus = 'verde';
      jbSummary = `Los residuos siguen una distribución compatible con la normal (p = ${formatPValueES(jbP)}).`;
    } else {
      const sortedStdRes = [...rowDiagnostics.map((r) => r.standardizedResidual)].sort((a, b) => a - b);
      const qqTheo = sortedStdRes.map((_, idx) => jStat.normal.inv((idx + 0.5) / n, 0, 1));
      const meanEmp = sortedStdRes.reduce((a, b) => a + b, 0) / n;
      const meanTheo = qqTheo.reduce((a, b) => a + b, 0) / n;
      let covQQ = 0;
      let varEmp = 0;
      let varTheo = 0;
      let madSum = 0;
      for (let i = 0; i < n; i++) {
        const de = sortedStdRes[i] - meanEmp;
        const dt = qqTheo[i] - meanTheo;
        covQQ += de * dt;
        varEmp += de * de;
        varTheo += dt * dt;
        madSum += Math.abs(sortedStdRes[i] - qqTheo[i]);
      }
      const qqCorr = varEmp > 1e-15 && varTheo > 1e-15 ? covQQ / Math.sqrt(varEmp * varTheo) : 1;
      const qqMad = madSum / n;
      const hasStrongQQDeviation = qqCorr < 0.9 || qqMad >= 0.35;
      if (hasStrongQQDeviation) {
        jbStatus = 'rojo';
        jbSummary = `Desviación fuerte en el gráfico Q-Q (p = ${formatPValueES(jbP)}); evaluar transformación de variables o regresión robusta.`;
      } else {
        jbStatus = 'amarillo';
        jbSummary = `p = ${formatPValueES(jbP)} sin desviaciones fuertes en el gráfico Q-Q; con muestras grandes las pruebas detectan desviaciones mínimas; por el teorema central del límite, la inferencia sigue siendo válida.`;
      }
    }
  } else {
    jbStatus = jbP >= 0.05 ? 'verde' : jbP >= 0.01 ? 'amarillo' : 'rojo';
    jbSummary =
      jbStatus === 'verde'
        ? `Los residuos siguen una distribución compatible con la normal (p = ${formatPValueES(jbP)}).`
        : `Desviación respecto a normalidad perfecta (p = ${formatPValueES(jbP)}); revisar gráfico Q-Q.`;
  }

  const e2 = residuals.map((e) => e * e);
  const bpOls = solveOLSBasic(XModel, e2);
  let bpStat = 0;
  let bpP = 1;
  if (bpOls) {
    const e2Mean = e2.reduce((a, b) => a + b, 0) / n;
    const sstE2 = e2.reduce((acc, v) => acc + (v - e2Mean) ** 2, 0);
    const sseE2 = bpOls.residuals.reduce((acc, v) => acc + v * v, 0);
    const r2Aux = sstE2 > 1e-15 ? Math.max(0, 1 - sseE2 / sstE2) : 0;
    bpStat = n * r2Aux;
    bpP = Math.max(0, 1 - jStat.chisquare.cdf(bpStat, k));
  }
  const bpStatus: AssumptionCheck['status'] =
    bpP >= 0.05 ? 'verde' : bpP >= 0.01 ? 'amarillo' : 'rojo';

  let dwNum = 0;
  for (let i = 1; i < n; i++) {
    const diff = residuals[i] - residuals[i - 1];
    dwNum += diff * diff;
  }
  const dwDenom = residuals.reduce((acc, e) => acc + e * e, 0);
  const dw = dwDenom > 1e-15 ? dwNum / dwDenom : 2;
  const dwStatus: AssumptionCheck['status'] =
    dw >= 1.5 && dw <= 2.5 ? 'verde' : (dw >= 1.0 && dw < 1.5) || (dw > 2.5 && dw <= 3.0) ? 'amarillo' : 'rojo';

  const vifStatus: AssumptionCheck['status'] =
    maxVif < 5 ? 'verde' : maxVif < 10 ? 'amarillo' : 'rojo';

  const infCount = rowDiagnostics.filter((r) => r.isInfluential).length;
  const cookMax = Math.max(...rowDiagnostics.map((r) => r.cooksDistance));
  const maxCoefChangePct = reestimatedWithoutInfluential
    ? Math.max(...reestimatedWithoutInfluential.coefficients.map((c) => Math.abs(c.pctDiff)), 0)
    : 0;
  const hasHighCook = cookMax > 0.5;
  const hasLargeCoefShift = maxCoefChangePct > 20;
  const infStatus: AssumptionCheck['status'] =
    infCount === 0 ? 'verde' : hasHighCook || hasLargeCoefShift ? 'rojo' : 'amarillo';

  return [
    {
      id: 'normality',
      name: 'Normalidad de residuos',
      testName: 'Prueba de Jarque-Bera',
      statisticLabel: 'JB',
      statisticValue: jb,
      pValue: jbP,
      status: jbStatus,
      summary: jbSummary,
    },
    {
      id: 'homoscedasticity',
      name: 'Homocedasticidad (varianza constante)',
      testName: 'Prueba de Breusch-Pagan',
      statisticLabel: 'LM',
      statisticValue: bpStat,
      pValue: bpP,
      status: bpStatus,
      summary:
        bpStatus === 'verde'
          ? `No se detecta heterocedasticidad significativa (p = ${formatPValueES(bpP)}).`
          : `Posible varianza desigual en residuos (p = ${formatPValueES(bpP)}); interpretar errores estándar con cautela.`,
    },
    {
      id: 'independence',
      name: 'Independencia de residuos',
      testName: 'Estadístico Durbin-Watson',
      statisticLabel: 'DW',
      statisticValue: dw,
      status: dwStatus,
      summary:
        dwStatus === 'verde'
          ? `DW = ${formatNumberES(dw, 2)} dentro del rango óptimo [1,50 – 2,50].`
          : `DW = ${formatNumberES(dw, 2)} fuera del rango ideal [1,50 – 2,50]; revisar posible autocorrelación o agrupamiento.`,
    },
    {
      id: 'multicollinearity',
      name: 'No multicolinealidad',
      testName: 'Factor de Inflación de Varianza (VIF)',
      statisticLabel: 'VIF máx.',
      statisticValue: maxVif,
      status: vifStatus,
      summary:
        vifStatus === 'verde'
          ? `VIF máximo = ${formatNumberES(maxVif, 2)} (< 5,0): predictores independientes entre sí.`
          : `VIF máximo = ${formatNumberES(maxVif, 2)}: existe colinealidad moderada o alta entre predictores.`,
    },
    {
      id: 'influential',
      name: 'Observaciones influyentes',
      testName: `Distancia de Cook (> 4/n = ${formatNumberES(4 / n, 3)})`,
      statisticLabel: 'Casos influyentes',
      statisticValue: infCount,
      status: infStatus,
      summary:
        infCount === 0
          ? `Ninguna observación supera 4/n (máx. Cook = ${formatNumberES(cookMax, 3)}).`
          : infStatus === 'rojo'
          ? `${infCount} fila(s) superan 4/n con impacto relevante (máx. Cook = ${formatNumberES(cookMax, 3)}, variación máx. de coeficientes = ${formatNumberES(maxCoefChangePct, 1)} %); abajo se muestra la reestimación sin ellas.`
          : `${infCount} fila(s) superan 4/n, pero con impacto acotado (máx. Cook = ${formatNumberES(cookMax, 3)} ≤ 0,5 y variación máx. de coeficientes = ${formatNumberES(maxCoefChangePct, 1)} % ≤ 20 %); abajo se muestra la reestimación sin ellas.`,
    },
  ];
}

export interface PredictorGroup {
  id: string;
  label: string;
  isDummyGroup: boolean;
  predictors: string[];
}

function buildPredictorGroups(
  selectedX: string[],
  dummyColumns: { name: string; sourceColumn: string }[]
): PredictorGroup[] {
  const dummyToSource = new Map(dummyColumns.map((d) => [d.name, d.sourceColumn]));
  const groups: PredictorGroup[] = [];
  const dummyGroupMap = new Map<string, PredictorGroup>();

  for (const x of selectedX) {
    const src = dummyToSource.get(x);
    if (src) {
      let grp = dummyGroupMap.get(src);
      if (!grp) {
        grp = {
          id: `grp::${src}`,
          label: `${src} (dummies)`,
          isDummyGroup: true,
          predictors: [],
        };
        dummyGroupMap.set(src, grp);
        groups.push(grp);
      }
      grp.predictors.push(x);
    } else {
      groups.push({
        id: `var::${x}`,
        label: x,
        isDummyGroup: false,
        predictors: [x],
      });
    }
  }
  return groups;
}

interface LightweightEval {
  id: string;
  transform: ModelTransform;
  predictors: string[];
  activeGroupIds: string[];
  n: number;
  k: number;
  sse: number;
  mse: number;
  df: number;
  adjR2: number;
  aic: number;
  vifs: number[];
  maxVif: number;
  pValues: number[];
  maxPValuePredictors: number;
  allPredictorsSignificant: boolean;
  allGroupsSignificant: boolean;
  vifAcceptable: boolean;
  groupPValues: Map<string, number>;
}

interface PreparedDesignData {
  n: number;
  yModel: number[];
  xCols: Map<string, number[]>;
  validPredictors: Set<string>;
}

function prepareDesignData(
  rows: Record<string, unknown>[],
  yName: string,
  allPredictors: string[],
  dummySet: Set<string>,
  transform: ModelTransform
): PreparedDesignData | null {
  const n = rows.length;
  const yModel = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const rawY = Number(rows[i][yName]);
    if (!Number.isFinite(rawY)) return null;
    if (transform === 'log-log' && rawY <= 0) return null;
    yModel[i] = transform === 'log-log' ? Math.log(rawY) : rawY;
  }

  const xCols = new Map<string, number[]>();
  const validPredictors = new Set<string>();
  for (const p of allPredictors) {
    const isLogX = transform === 'log-log' && !dummySet.has(p);
    const vec = new Array<number>(n);
    let ok = true;
    for (let i = 0; i < n; i++) {
      const v = Number(rows[i][p]);
      if (!Number.isFinite(v) || (isLogX && v <= 0)) {
        ok = false;
        break;
      }
      vec[i] = isLogX ? Math.log(v) : v;
    }
    if (ok) {
      xCols.set(p, vec);
      validPredictors.add(p);
    }
  }

  return { n, yModel, xCols, validPredictors };
}

function fitLightweightGroups(
  data: PreparedDesignData,
  groups: PredictorGroup[],
  transform: ModelTransform,
  computeGroupFTests: boolean
): LightweightEval | null {
  const predictors = groups.flatMap((g) => g.predictors);
  const k = predictors.length;
  const n = data.n;
  if (k === 0 || n <= k + 2) return null;

  const colArrays = predictors.map((p) => data.xCols.get(p)!);
  if (colArrays.some((a) => !a)) return null;

  const XModel: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(k + 1);
    row[0] = 1;
    for (let j = 0; j < k; j++) row[j + 1] = colArrays[j][i];
    return row;
  });

  const ols = solveOLSBasic(XModel, data.yModel);
  if (!ols) return null;

  const df = n - k - 1;
  const sse = ols.residuals.reduce((acc, e) => acc + e * e, 0);
  const yMean = data.yModel.reduce((a, b) => a + b, 0) / n;
  const sst = data.yModel.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const mse = sse / df;
  const r2 = sst > 1e-12 ? 1 - sse / sst : 0;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / df;
  const logTerm = Math.log(Math.max(sse / n, 1e-15));
  const aic = n * Math.log(2 * Math.PI) + n * logTerm + n + 2 * (k + 2);

  const XNoInt = XModel.map((row) => row.slice(1));
  const vifs = computeVifFromDesign(XNoInt, n, k);
  const maxVif = Math.max(...vifs);

  const pValues: number[] = [];
  for (let j = 0; j < k; j++) {
    const idx = j + 1;
    const se = Math.sqrt(Math.max(ols.xtXInv[idx][idx] * mse, 0));
    const tStat = se > 1e-15 ? ols.beta[idx] / se : 0;
    const pVal = Math.max(0, Math.min(1, 2 * (1 - jStat.studentt.cdf(Math.abs(tStat), df))));
    pValues.push(pVal);
  }
  const maxPValuePredictors = Math.max(...pValues);

  const groupPValues = new Map<string, number>();
  let offset = 0;
  for (const grp of groups) {
    const m = grp.predictors.length;
    if (m === 1) {
      groupPValues.set(grp.id, pValues[offset]);
    } else if (computeGroupFTests) {
      // Partial F-test dropping all dummies of this categorical group together
      const redIndices: number[] = [0];
      for (let c = 0; c < k; c++) {
        if (c < offset || c >= offset + m) redIndices.push(c + 1);
      }
      const XRed = XModel.map((row) => redIndices.map((idx) => row[idx]));
      const redOls = solveOLSBasic(XRed, data.yModel);
      if (redOls && mse > 1e-15) {
        const sseRed = redOls.residuals.reduce((acc, e) => acc + e * e, 0);
        const fGroup = Math.max(0, (sseRed - sse) / m) / mse;
        const pGroup = Math.max(0, 1 - jStat.centralF.cdf(fGroup, m, df));
        groupPValues.set(grp.id, pGroup);
      } else {
        groupPValues.set(grp.id, Math.min(...pValues.slice(offset, offset + m)));
      }
    } else {
      groupPValues.set(grp.id, Math.min(...pValues.slice(offset, offset + m)));
    }
    offset += m;
  }

  const allGroupsSignificant = Array.from(groupPValues.values()).every((pv) => pv < 0.05);

  return {
    id: `${transform}::${predictors.join('+')}`,
    transform,
    predictors,
    activeGroupIds: groups.map((g) => g.id),
    n,
    k,
    sse,
    mse,
    df,
    adjR2,
    aic,
    vifs,
    maxVif,
    pValues,
    maxPValuePredictors,
    allPredictorsSignificant: maxPValuePredictors < 0.05,
    allGroupsSignificant,
    vifAcceptable: maxVif < 5,
    groupPValues,
  };
}

function generateGroupSubsets(groups: PredictorGroup[], maxPredictors: number): PredictorGroup[][] {
  const results: PredictorGroup[][] = [];
  const p = groups.length;

  const backtrack = (start: number, current: PredictorGroup[], currentPredCount: number) => {
    if (current.length > 0) {
      results.push([...current]);
    }
    for (let i = start; i < p; i++) {
      const nextCount = currentPredCount + groups[i].predictors.length;
      if (nextCount <= maxPredictors) {
        current.push(groups[i]);
        backtrack(i + 1, current, nextCount);
        current.pop();
      }
    }
  };

  backtrack(0, [], 0);
  // Sort subsets nicely by size then order so smaller subsets come first (cleaner tie-breaking)
  results.sort((a, b) => a.length - b.length);
  return results;
}

export function runModelSelection(
  rows: Record<string, unknown>[],
  rowLabels: string[],
  yName: string,
  selectedX: string[],
  dummySet: Set<string>,
  tryLogTransform: boolean,
  yUnit: string,
  dummyColumns: { name: string; sourceColumn: string }[] = [],
  onProgress?: (completed: number, total: number, message: string) => void
): ModelSelectionOutput {
  const n = rows.length;
  const maxPredictors = Math.max(1, Math.floor(n / 7));

  // Derive dummyColumns fallback if caller didn't pass dummyColumns list (e.g. legacy tests)
  const effectiveDummyCols =
    dummyColumns.length > 0
      ? dummyColumns.filter((d) => selectedX.includes(d.name))
      : selectedX
          .filter((x) => dummySet.has(x))
          .map((x) => ({ name: x, sourceColumn: x.split('_')[0] || x }));

  const groups = buildPredictorGroups(selectedX, effectiveDummyCols);
  const candidateGroupsCount = groups.length;
  const useStepwise = candidateGroupsCount > 12;

  const yAllPositive = rows.every((r) => {
    const v = Number(r[yName]);
    return Number.isFinite(v) && v > 0;
  });

  const transformsToTry: ModelTransform[] =
    tryLogTransform && yAllPositive ? ['linear', 'log-log'] : ['linear'];

  const lightweightByKey = new Map<string, LightweightEval>();
  const stepwiseLogs: string[] = [];

  if (!useStepwise) {
    const groupSubsets = generateGroupSubsets(groups, maxPredictors);
    const totalSteps = groupSubsets.length * transformsToTry.length;
    let doneSteps = 0;

    onProgress?.(0, Math.max(totalSteps, 1), `Evaluando búsqueda exhaustiva (${candidateGroupsCount} grupos candidatos)...`);

    for (const transform of transformsToTry) {
      const prepared = prepareDesignData(rows, yName, selectedX, dummySet, transform);
      if (!prepared) {
        doneSteps += groupSubsets.length;
        continue;
      }

      for (const grpSubset of groupSubsets) {
        doneSteps++;
        if (doneSteps % 40 === 0 || doneSteps === totalSteps) {
          onProgress?.(
            doneSteps,
            totalSteps,
            `Evaluando modelo ${doneSteps} de ${totalSteps}...`
          );
        }

        const allValid = grpSubset.every((g) =>
          g.predictors.every((p) => prepared.validPredictors.has(p))
        );
        if (!allValid) continue;
        if (transform === 'log-log' && grpSubset.every((g) => g.isDummyGroup)) continue;

        const ev = fitLightweightGroups(prepared, grpSubset, transform, grpSubset.some((g) => g.isDummyGroup));
        if (ev) lightweightByKey.set(ev.id, ev);
      }
    }
  } else {
    const totalStepsEstimate = candidateGroupsCount * transformsToTry.length * 2;
    let doneSteps = 0;
    onProgress?.(
      0,
      Math.max(totalStepsEstimate, 1),
      `Ejecutando selección stepwise hacia atrás (${candidateGroupsCount} grupos candidatos)...`
    );

    for (const transform of transformsToTry) {
      const prepared = prepareDesignData(rows, yName, selectedX, dummySet, transform);
      if (!prepared) continue;

      let activeGroups = groups.filter((g) =>
        g.predictors.every((p) => prepared.validPredictors.has(p))
      );
      if (transform === 'log-log' && activeGroups.every((g) => g.isDummyGroup)) continue;

      // Trim if predictors exceed n - 3
      while (
        activeGroups.length > 1 &&
        activeGroups.reduce((s, g) => s + g.predictors.length, 0) > Math.min(maxPredictors, n - 3)
      ) {
        activeGroups.pop();
      }

      const famLabel = transform === 'log-log' ? 'log-log' : 'lineal';

      // Phase 1: Remove collinear groups (VIF >= 5) starting with highest p-value among collinear predictors
      while (activeGroups.length > 1) {
        doneSteps++;
        onProgress?.(
          Math.min(doneSteps, totalStepsEstimate - 1),
          totalStepsEstimate,
          `Stepwise (${famLabel}): verificando colinealidad (VIF < 5)...`
        );

        const ev = fitLightweightGroups(prepared, activeGroups, transform, true);
        if (!ev) {
          activeGroups = activeGroups.slice(0, -1);
          continue;
        }
        lightweightByKey.set(ev.id, ev);

        if (ev.maxVif < 5) break;

        // Map collinear predictors (VIF >= 5) back to their groups
        const collinearGroupIds = new Set<string>();
        let offset = 0;
        for (const grp of activeGroups) {
          for (let j = 0; j < grp.predictors.length; j++) {
            if (ev.vifs[offset + j] >= 5) {
              collinearGroupIds.add(grp.id);
            }
          }
          offset += grp.predictors.length;
        }

        if (collinearGroupIds.size === 0) break;

        let dropGrp: PredictorGroup | null = null;
        let maxDropP = -1;
        for (const grp of activeGroups) {
          if (!collinearGroupIds.has(grp.id)) continue;
          const pv = ev.groupPValues.get(grp.id) ?? 1;
          if (pv > maxDropP) {
            maxDropP = pv;
            dropGrp = grp;
          }
        }
        if (!dropGrp) break;

        stepwiseLogs.push(
          `[${famLabel}] Eliminada por colinealidad (VIF máx. = ${formatNumberES(ev.maxVif, 2)} ≥ 5): ${dropGrp.label} (p = ${formatPValueES(maxDropP)}).`
        );
        activeGroups = activeGroups.filter((g) => g.id !== dropGrp!.id);
      }

      // Phase 2: Backward elimination of non-significant groups (p >= 0.05) one by one
      while (activeGroups.length > 1) {
        doneSteps++;
        onProgress?.(
          Math.min(doneSteps, totalStepsEstimate - 1),
          totalStepsEstimate,
          `Stepwise (${famLabel}): depurando significancia (p < 0,05)...`
        );

        const ev = fitLightweightGroups(prepared, activeGroups, transform, true);
        if (!ev) {
          activeGroups = activeGroups.slice(0, -1);
          continue;
        }
        lightweightByKey.set(ev.id, ev);

        let worstGrp: PredictorGroup | null = null;
        let worstP = -1;
        for (const grp of activeGroups) {
          const pv = ev.groupPValues.get(grp.id) ?? 1;
          if (pv > worstP) {
            worstP = pv;
            worstGrp = grp;
          }
        }

        if (!worstGrp || worstP < 0.05) break;

        stepwiseLogs.push(
          `[${famLabel}] Eliminada por falta de significancia (p = ${formatPValueES(worstP)} ≥ 0,05): ${worstGrp.label}.`
        );
        activeGroups = activeGroups.filter((g) => g.id !== worstGrp!.id);
      }

      // Record final step
      const finalEv = fitLightweightGroups(prepared, activeGroups, transform, true);
      if (finalEv) {
        lightweightByKey.set(finalEv.id, finalEv);
      }
    }
  }

  const evalPool = Array.from(lightweightByKey.values());
  if (evalPool.length === 0) {
    throw new Error('No se pudo estimar ningún modelo válido con las variables seleccionadas.');
  }

  // Selection criteria using lightweight results (exact R2, adjR2, AIC, VIF, group significance):
  const filterTierLight = (models: LightweightEval[]) => {
    const pAndVifStrict = models.filter((m) => m.allPredictorsSignificant && m.vifAcceptable);
    if (pAndVifStrict.length > 0) return { pool: pAndVifStrict, relaxed: '' };
    const groupPAndVif = models.filter((m) => m.allGroupsSignificant && m.vifAcceptable);
    if (groupPAndVif.length > 0) return { pool: groupPAndVif, relaxed: '' };
    const pOnly = models.filter((m) => m.allGroupsSignificant || m.allPredictorsSignificant);
    if (pOnly.length > 0) return { pool: pOnly, relaxed: 'Ningún modelo cumplió VIF < 5 y p < 0,05 a la vez; se priorizó p < 0,05.' };
    const vifOnly = models.filter((m) => m.vifAcceptable);
    if (vifOnly.length > 0) return { pool: vifOnly, relaxed: 'Ningún modelo tuvo todos los predictores con p < 0,05; se seleccionó entre los modelos con VIF < 5.' };
    return { pool: models, relaxed: 'Se seleccionó por mejor ajuste global tras no cumplirse simultáneamente p < 0,05 y VIF < 5.' };
  };

  const linearLight = evalPool.filter((m) => m.transform === 'linear');
  const logLight = evalPool.filter((m) => m.transform === 'log-log');

  const bestLightPerGroup: LightweightEval[] = [];
  const relaxedNotes: string[] = [];

  for (const grp of [linearLight, logLight]) {
    if (grp.length === 0) continue;
    const { pool, relaxed } = filterTierLight(grp);
    if (relaxed) relaxedNotes.push(relaxed);
    const sortedByAic = [...pool].sort((a, b) => a.aic - b.aic || b.adjR2 - a.adjR2);
    bestLightPerGroup.push(sortedByAic[0]);
  }

  bestLightPerGroup.sort((a, b) => b.adjR2 - a.adjR2);
  const winnerLight = bestLightPerGroup[0];

  const sortedLightAll = [...evalPool].sort((a, b) => {
    if (a.id === winnerLight.id) return -1;
    if (b.id === winnerLight.id) return 1;
    const aValid = (a.allGroupsSignificant || a.allPredictorsSignificant) && a.vifAcceptable ? 1 : 0;
    const bValid = (b.allGroupsSignificant || b.allPredictorsSignificant) && b.vifAcceptable ? 1 : 0;
    if (aValid !== bValid) return bValid - aValid;
    return b.adjR2 - a.adjR2;
  });

  // Compute full OLS models (with diagnostics, CV, and Cook's reestimation)
  // For small candidate sets (<= 40), compute all; for larger sets, compute winner + top 25 ranked models
  const modelsToFullFit = sortedLightAll.length <= 40 ? sortedLightAll : sortedLightAll.slice(0, 25);

  onProgress?.(1, 1, 'Calculando validación cruzada y supuestos del modelo ganador...');

  const fullModels: RegressionModelResult[] = [];
  for (const item of modelsToFullFit) {
    const isWinnerOrRunner = fullModels.length < 3;
    const full = fitSingleOLSModel(
      rows,
      rowLabels,
      yName,
      item.predictors,
      dummySet,
      item.transform,
      yUnit,
      isWinnerOrRunner
    );
    if (full) {
      // Preserve group-level significance approval if multi-dummy group passed F-test
      if (item.allGroupsSignificant && item.vifAcceptable) {
        full.allPredictorsSignificant = item.allPredictorsSignificant || item.allGroupsSignificant;
      }
      fullModels.push(full);
    }
  }

  if (fullModels.length === 0) {
    throw new Error('No se pudo completar el ajuste OLS del modelo seleccionado.');
  }

  const bestModel = fullModels.find((m) => m.id === winnerLight.id) ?? fullModels[0];

  fullModels.forEach((m, i) => {
    m.selectionScoreRank = i + 1;
  });

  const runnersUp = fullModels.filter((m) => m.id !== bestModel.id).slice(0, 2);

  const reasonsRunner = runnersUp.map((r, idx) => {
    const label = `${r.transform === 'log-log' ? `ln(${r.yName})` : r.yName} ~ ${r.predictorDisplayNames.join(' + ')}`;
    if (!r.allPredictorsSignificant) {
      return `Alternativa ${idx + 1} (${label}): descartada porque incluye al menos un predictor no significativo (p máx. = ${formatPValueES(r.maxPValuePredictors)} ≥ 0,05).`;
    }
    if (!r.vifAcceptable) {
      return `Alternativa ${idx + 1} (${label}): descartada por multicolinealidad elevada (VIF = ${formatNumberES(r.maxVif, 2)} ≥ 5,0).`;
    }
    if (r.transform === bestModel.transform && r.aic > bestModel.aic) {
      return `Alternativa ${idx + 1} (${label}): cumplió p < 0,05 y VIF < 5, pero obtuvo un AIC mayor (${formatNumberES(r.aic, 1)} vs. ${formatNumberES(bestModel.aic, 1)}) en la misma escala de Y.`;
    }
    return `Alternativa ${idx + 1} (${label}): fue el mejor candidato de la escala ${r.transform}, pero logró un R² ajustado inferior (${formatNumberES(r.adjR2, 3)} vs. ${formatNumberES(bestModel.adjR2, 3)}).`;
  });

  const selectionMethod: 'exhaustive' | 'stepwise' = useStepwise ? 'stepwise' : 'exhaustive';
  const selectionMethodReason = useStepwise
    ? `Se aplicó selección stepwise hacia atrás porque existen ${candidateGroupsCount} variables/grupos candidatos (> 12, lo que superaría las 4.096 combinaciones). Primero se depuró la colinealidad eliminando predictores con VIF ≥ 5 de mayor p-value, y luego se retiraron uno a uno los predictores con p ≥ 0,05 manteniendo juntas las dummies de cada variable categórica.`
    : `Se ejecutó búsqueda exhaustiva sobre los ${candidateGroupsCount} variables/grupos candidatos (≤ 12 grupos; ${evalPool.length} modelos evaluados manteniendo juntas las dummies de cada variable categórica).`;

  const bestLabel = `${bestModel.transform === 'log-log' ? `ln(${bestModel.yName})` : bestModel.yName} ~ ${bestModel.predictorDisplayNames.join(' + ')}`;
  const selectionExplanation =
    `Ganó "${bestLabel}" porque cumplió todos los criterios estadísticos (p máx. = ${formatPValueES(bestModel.maxPValuePredictors)}, VIF = ${formatNumberES(bestModel.maxVif, 2)} < 5), obtuvo el menor AIC dentro de su familia (${formatNumberES(bestModel.aic, 1)}) y el mayor R² ajustado global (${formatNumberES(bestModel.adjR2, 3)}).` +
    (relaxedNotes.length > 0 ? ` Nota: ${relaxedNotes[0]}` : '') +
    (reasonsRunner.length > 0 ? ` ${reasonsRunner.join(' ')}` : '');

  return {
    allModels: fullModels,
    bestModel,
    runnersUp,
    selectionExplanation,
    selectionMethod,
    selectionMethodReason,
    candidateGroupsCount,
    stepwiseRemovedLog: stepwiseLogs.length > 0 ? stepwiseLogs : undefined,
    maxPredictorsEvaluated: Math.min(maxPredictors, selectedX.length),
    totalEvaluated: evalPool.length,
  };
}

