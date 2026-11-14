import jStat from 'jstat';
import {
  MonteCarloSummary,
  RegressionModelResult,
  ScenarioOutcome,
  ScenarioRecommendation,
  SensitivityItem,
  VariableControlType,
  VariableScenarioConfig,
} from '../types/regression';
import { buildEntityLabels } from '../utils/entityNoun';
import {
  formatIntegerES,
  formatNumberES,
  formatSignedPctES,
  resolveYUnit,
} from '../utils/formatters';
import { choleskyDecomposition, createMulberry32, sampleNormal } from '../utils/prng';

export function classifyScenarioVariable(varName: string): 'income' | 'population' | 'other' {
  const lower = varName.toLowerCase();
  if (/(gnp|gdp|pib|income|ingreso|renta|salario|sueldo)/.test(lower)) {
    return 'income';
  }
  if (/(pop|pob|population|poblacion|habitantes)/.test(lower)) {
    return 'population';
  }
  return 'other';
}

export function buildDefaultScenarioConfigs(
  model: RegressionModelResult,
  dummySet: Set<string> = new Set(),
  controlTypes: Record<string, VariableControlType> = {},
  horizonYears = 3
): VariableScenarioConfig[] {
  const betaMap = new Map(
    model.coefficients.filter((c) => !c.isIntercept).map((c) => [c.name, c.estimate])
  );
  const h = Math.max(1, horizonYears);

  return model.predictors
    .filter((variable) => !dummySet.has(variable))
    .map((variable) => {
      const category = classifyScenarioVariable(variable);
      const beta = betaMap.get(variable) ?? 0;
      const favorableDir = beta >= 0 ? 1 : -1;

      if (category === 'income') {
        if (favorableDir >= 0) {
          return {
            variable,
            category,
            method: 'fixed_rate',
            pessimisticRatePct: -2.0,
            baseRatePct: 1.5,
            optimisticRatePct: 3.5,
            mcMeanRatePct: 1.5,
            mcStdRatePct: 1.4,
            manualChangePct: 4.5,
          };
        }
        return {
          variable,
          category,
          method: 'fixed_rate',
          pessimisticRatePct: 2.0,
          baseRatePct: 0.0,
          optimisticRatePct: -3.5,
          mcMeanRatePct: 0.0,
          mcStdRatePct: 1.4,
          manualChangePct: -4.5,
        };
      }
      if (category === 'population') {
        if (favorableDir >= 0) {
          return {
            variable,
            category,
            method: 'fixed_rate',
            pessimisticRatePct: 0.0,
            baseRatePct: 0.2,
            optimisticRatePct: 0.4,
            mcMeanRatePct: 0.2,
            mcStdRatePct: 0.15,
            manualChangePct: 0.6,
          };
        }
        return {
          variable,
          category,
          method: 'fixed_rate',
          pessimisticRatePct: 0.4,
          baseRatePct: 0.2,
          optimisticRatePct: 0.0,
          mcMeanRatePct: 0.2,
          mcStdRatePct: 0.15,
          manualChangePct: -0.6,
        };
      }

      const controlType = controlTypes[variable] ?? 'external';
      if (controlType === 'controllable') {
        // Optimista: +10% total in direction that increases Y; Pesimista: -5% total in unfavorable direction; Base: 0%
        const optRate = Number(((Math.pow(1 + favorableDir * 0.1, 1 / h) - 1) * 100).toFixed(2));
        const pesRate = Number(((Math.pow(1 - favorableDir * 0.05, 1 / h) - 1) * 100).toFixed(2));
        const stdRate = Number((Math.abs(optRate - pesRate) / 3.65).toFixed(2));
        return {
          variable,
          category,
          method: 'fixed_rate',
          pessimisticRatePct: pesRate,
          baseRatePct: 0.0,
          optimisticRatePct: optRate,
          mcMeanRatePct: 0.0,
          mcStdRatePct: stdRate,
          manualChangePct: favorableDir * 10.0,
        };
      }

      // External non-income / non-population variable: orient Optimista/Pesimista by sign of beta
      return {
        variable,
        category,
        method: 'fixed_rate',
        pessimisticRatePct: -3.0 * favorableDir,
        baseRatePct: 0.0,
        optimisticRatePct: 3.0 * favorableDir,
        mcMeanRatePct: 0.0,
        mcStdRatePct: 1.6,
        manualChangePct: 3.0 * favorableDir,
      };
    });
}

function getGrowthMultiplier(
  cfg: VariableScenarioConfig,
  scenarioId: 'pesimista' | 'base' | 'optimista',
  horizonYears: number,
  beta = 1
): number {
  if (cfg.method === 'manual_value') {
    return Math.max(0.01, 1 + cfg.manualChangePct / 100);
  }
  if (cfg.method === 'normal_mc') {
    // Deterministic center for scenario cards: base uses mcMean, pes/opt use ±1 SD oriented by beta sign
    const favorableDir = beta >= 0 ? 1 : -1;
    const rate =
      scenarioId === 'base'
        ? cfg.mcMeanRatePct
        : scenarioId === 'pesimista'
          ? cfg.mcMeanRatePct - favorableDir * cfg.mcStdRatePct
          : cfg.mcMeanRatePct + favorableDir * cfg.mcStdRatePct;
    return Math.max(0.01, Math.pow(1 + rate / 100, horizonYears));
  }
  const annualPct =
    scenarioId === 'pesimista'
      ? cfg.pessimisticRatePct
      : scenarioId === 'base'
        ? cfg.baseRatePct
        : cfg.optimisticRatePct;
  return Math.max(0.01, Math.pow(1 + annualPct / 100, horizonYears));
}

export function runScenarioProjections(
  model: RegressionModelResult,
  rows: Record<string, unknown>[],
  configs: VariableScenarioConfig[],
  horizonYears: number,
  dummySet: Set<string>
): ScenarioOutcome[] {
  const n = model.n;
  const k = model.k;
  const df = n - k - 1;
  const tCrit = jStat.studentt.inv(0.975, df);
  const betas = model.coefficients.map((c) => c.estimate);
  const currentTotal = model.rows.reduce((acc, r) => acc + r.yActual, 0);

  const scenarios: { id: 'pesimista' | 'base' | 'optimista'; label: string }[] = [
    { id: 'pesimista', label: 'Pesimista' },
    { id: 'base', label: 'Base' },
    { id: 'optimista', label: 'Optimista' },
  ];

  const cfgMap = new Map(configs.map((c) => [c.variable, c]));

  return scenarios.map(({ id, label }) => {
    const multipliers = model.predictors.map((predName, j) => {
      if (dummySet.has(predName)) return 1;
      const cfg = cfgMap.get(predName);
      return cfg ? getGrowthMultiplier(cfg, id, horizonYears, betas[j + 1] ?? 1) : 1;
    });

    let projectedTotal = 0;
    let totalVarSum = 0;

    const rowProjections = model.rows.map((diag, rowIdx) => {
      const rawRow = rows[rowIdx];
      let yFuturo = diag.yActual;

      // Build future design vector x_fut in model space for PI width
      const xFut = [1];
      let deltaModelLog = 0;
      let yHatCurrentLin = betas[0];
      let yHatFutLin = betas[0];

      for (let j = 0; j < model.predictors.length; j++) {
        const predName = model.predictors[j];
        const xCurr = Number(rawRow[predName]);
        const mult = multipliers[j] ?? 1;
        const isDummy = dummySet.has(predName);
        const betaJ = betas[j + 1];

        if (model.transform === 'log-log') {
          if (!isDummy) {
            const xNew = Math.max(xCurr * mult, 1e-12);
            xFut.push(Math.log(xNew));
            deltaModelLog += betaJ * Math.log(mult);
          } else {
            xFut.push(xCurr);
          }
        } else {
          const xNew = isDummy ? xCurr : xCurr * mult;
          xFut.push(xNew);
          yHatCurrentLin += betaJ * xCurr;
          yHatFutLin += betaJ * xNew;
        }
      }

      if (model.transform === 'log-log') {
        const factor = Math.exp(deltaModelLog);
        yFuturo = diag.yActual * factor;
      } else {
        const factor =
          Math.abs(yHatCurrentLin) > 1e-9 && yHatCurrentLin > 0
            ? yHatFutLin / yHatCurrentLin
            : 1 + (yHatFutLin - yHatCurrentLin) / Math.max(Math.abs(diag.yActual), 1e-9);
        yFuturo = diag.yActual * factor;
      }

      // Prediction variance for row i in model space: MSE * (1 + x_fut^T (X^T X)^-1 x_fut)
      let xVx = 0;
      for (let a = 0; a < xFut.length; a++) {
        let s = 0;
        for (let b = 0; b < xFut.length; b++) {
          s += model.xtXInv[a][b] * xFut[b];
        }
        xVx += xFut[a] * s;
      }
      const seModel = Math.sqrt(Math.max(model.mse * (1 + xVx), 0));

      // Approximate variance in original units around yFuturo
      const rowSdOrig =
        model.transform === 'log-log'
          ? yFuturo * seModel
          : seModel;
      totalVarSum += rowSdOrig * rowSdOrig;

      projectedTotal += yFuturo;
      const changeAbs = yFuturo - diag.yActual;
      const changePct = Math.abs(diag.yActual) > 1e-9 ? (changeAbs / diag.yActual) * 100 : 0;

      return {
        rowLabel: diag.rowLabel,
        currentY: diag.yActual,
        projectedY: yFuturo,
        changeAbs,
        changePct,
        gapBase: diag.gap,
      };
    });

    const changeAbs = projectedTotal - currentTotal;
    const changePct = Math.abs(currentTotal) > 1e-9 ? (changeAbs / currentTotal) * 100 : 0;
    const totalSe = Math.sqrt(totalVarSum);
    const piLower = Math.max(0, projectedTotal - tCrit * totalSe);
    const piUpper = projectedTotal + tCrit * totalSe;

    return {
      id,
      label,
      currentTotal,
      projectedTotal,
      changeAbs,
      changePct,
      piLower,
      piUpper,
      rowProjections,
    };
  });
}

export function runMonteCarloSimulation(
  model: RegressionModelResult,
  rows: Record<string, unknown>[],
  configs: VariableScenarioConfig[],
  horizonYears: number,
  dummySet: Set<string>,
  iterations = 10000,
  seed = 42
): MonteCarloSummary {
  const rng = createMulberry32(seed);
  const p = model.coefficients.length;
  const betaHat = model.coefficients.map((c) => c.estimate);
  const L = choleskyDecomposition(model.covMatrix);
  const k = model.predictors.length;

  // Pre-extract numeric values for speed across 10,000 iterations
  const yActualVec = model.rows.map((r) => r.yActual);
  const xMat = rows.map((r) => model.predictors.map((pred) => Number(r[pred])));
  const isDummyFlags = model.predictors.map((pred) => dummySet.has(pred));

  const cfgMap = new Map(configs.map((c) => [c.variable, c]));
  const totals = new Float64Array(iterations);

  for (let iter = 0; iter < iterations; iter++) {
    // Sample beta ~ N(betaHat, Cov(beta)) via Cholesky
    const zBeta = new Array(p);
    for (let i = 0; i < p; i++) zBeta[i] = sampleNormal(rng);

    const betaSim = new Array(p);
    for (let i = 0; i < p; i++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += L[i][j] * zBeta[j];
      }
      betaSim[i] = betaHat[i] + sum;
    }

    // Sample ONE annual growth rate per variable per iteration (common macroeconomic shock across all rows)
    const mults = new Array(k);
    for (let j = 0; j < k; j++) {
      const predName = model.predictors[j];
      const cfg = cfgMap.get(predName);
      if (isDummyFlags[j] || !cfg) {
        mults[j] = 1;
      } else if (cfg.method === 'manual_value') {
        mults[j] = Math.max(0.05, 1 + cfg.manualChangePct / 100);
      } else if (cfg.method === 'normal_mc') {
        const rate = cfg.mcMeanRatePct + cfg.mcStdRatePct * sampleNormal(rng);
        mults[j] = Math.max(0.05, Math.pow(1 + rate / 100, horizonYears));
      } else {
        // Fixed rate mode: single common annual rate around Base with macro std derived from Pesimista–Optimista range
        const macroSd = Math.abs(cfg.optimisticRatePct - cfg.pessimisticRatePct) / 3.65;
        const rate = cfg.baseRatePct + (macroSd > 0 ? macroSd * sampleNormal(rng) : 0);
        mults[j] = Math.max(0.05, Math.pow(1 + rate / 100, horizonYears));
      }
    }

    let totalIter = 0;
    if (model.transform === 'log-log') {
      let deltaLog = 0;
      for (let j = 0; j < k; j++) {
        if (!isDummyFlags[j]) {
          deltaLog += betaSim[j + 1] * Math.log(mults[j]);
        }
      }
      const factor = Math.exp(deltaLog);
      for (let i = 0; i < yActualVec.length; i++) {
        totalIter += yActualVec[i] * factor;
      }
    } else {
      for (let i = 0; i < yActualVec.length; i++) {
        let yHatCurr = betaSim[0];
        let yHatFut = betaSim[0];
        for (let j = 0; j < k; j++) {
          const xv = xMat[i][j];
          const xNew = isDummyFlags[j] ? xv : xv * mults[j];
          yHatCurr += betaSim[j + 1] * xv;
          yHatFut += betaSim[j + 1] * xNew;
        }
        const factor =
          Math.abs(yHatCurr) > 1e-9 && yHatCurr > 0
            ? yHatFut / yHatCurr
            : 1 + (yHatFut - yHatCurr) / Math.max(Math.abs(yActualVec[i]), 1e-9);
        totalIter += Math.max(0, yActualVec[i] * factor);
      }
    }
    totals[iter] = totalIter;
  }

  const sorted = Array.from(totals).sort((a, b) => a - b);
  const p5 = sorted[Math.floor(0.05 * (iterations - 1))];
  const p50 = sorted[Math.floor(0.5 * (iterations - 1))];
  const p95 = sorted[Math.floor(0.95 * (iterations - 1))];
  const mean = sorted.reduce((a, b) => a + b, 0) / iterations;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / iterations;
  const sd = Math.sqrt(variance);

  // Build 24 histogram bins between p0.5 and p99.5 to avoid extreme visual tails
  const lowBound = sorted[Math.floor(0.005 * (iterations - 1))];
  const highBound = sorted[Math.floor(0.995 * (iterations - 1))];
  const numBins = 24;
  const width = Math.max((highBound - lowBound) / numBins, 1e-6);

  const bins = Array.from({ length: numBins }, (_, i) => {
    const start = lowBound + i * width;
    const end = start + width;
    return {
      rangeLabel: formatIntegerES((start + end) / 2),
      midpoint: (start + end) / 2,
      count: 0,
    };
  });

  for (const val of sorted) {
    if (val < lowBound || val > highBound) continue;
    let idx = Math.floor((val - lowBound) / width);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }

  return {
    iterations,
    seed,
    p5,
    p50,
    p95,
    mean,
    sd,
    bins,
  };
}

export function runSensitivityTornado(
  model: RegressionModelResult,
  rows: Record<string, unknown>[],
  dummySet: Set<string>
): SensitivityItem[] {
  const currentTotal = model.rows.reduce((acc, r) => acc + r.yActual, 0);
  const betas = model.coefficients.map((c) => c.estimate);

  const items: SensitivityItem[] = model.predictors
    .filter((predName) => !dummySet.has(predName))
    .map((predName) => {
      const j = model.predictors.indexOf(predName);
      const betaJ = betas[j + 1];

      const evalWithMultiplier = (mult: number): number => {
        if (model.transform === 'log-log') {
          const factor = Math.pow(mult, betaJ);
          return currentTotal * factor;
        }
        let total = 0;
        for (let i = 0; i < model.n; i++) {
          let yHatCurr = betas[0];
          let yHatNew = betas[0];
          for (let m = 0; m < model.predictors.length; m++) {
            const xv = Number(rows[i][model.predictors[m]]);
            const b = betas[m + 1];
            yHatCurr += b * xv;
            yHatNew += b * (m === j ? xv * mult : xv);
          }
          const factor =
            Math.abs(yHatCurr) > 1e-9 && yHatCurr > 0
              ? yHatNew / yHatCurr
              : 1 + (yHatNew - yHatCurr) / Math.max(Math.abs(model.rows[i].yActual), 1e-9);
          total += model.rows[i].yActual * factor;
        }
        return total;
      };

      const lowYTotal = evalWithMultiplier(0.9);
      const highYTotal = evalWithMultiplier(1.1);
      const lowDelta = lowYTotal - currentTotal;
      const highDelta = highYTotal - currentTotal;

      return {
        variable: predName,
        lowYTotal,
        highYTotal,
        lowDelta,
        highDelta,
        lowDeltaPct: currentTotal > 0 ? (lowDelta / currentTotal) * 100 : 0,
        highDeltaPct: currentTotal > 0 ? (highDelta / currentTotal) * 100 : 0,
        swing: Math.abs(highDelta - lowDelta),
      };
    });

  return items.sort((a, b) => b.swing - a.swing);
}

interface ScenarioMover {
  variable: string;
  label: string;
  beta: number;
  controlType: VariableControlType;
  deltaPct: number;
  annualRatePct: number | null;
  yImpactAbs: number;
  multiplier: number;
}

function formatMoverChange(m: ScenarioMover, horizonYears: number): string {
  if (m.annualRatePct !== null) {
    return `${m.label} (${formatSignedPctES(m.annualRatePct, 1)}/año; ${formatSignedPctES(m.deltaPct, 1)} en ${horizonYears} años)`;
  }
  return `${m.label} (${formatSignedPctES(m.deltaPct, 1)} en ${horizonYears} años)`;
}

function getNumericColumnMean(rows: Record<string, unknown>[], col: string): number {
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const v = Number(r[col]);
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function getMedianNumeric(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function describeControllableMove(
  model: RegressionModelResult,
  rows: Record<string, unknown>[],
  variable: string,
  varLabel: string,
  yLabel: string,
  beta: number,
  unitLabel: string,
  deltaPctTarget: number,
  entitySingular: string,
  mode: 'pesimista' | 'base' | 'optimista'
): string {
  const meanX = getNumericColumnMean(rows, variable);
  const effectivePct = Math.abs(deltaPctTarget) >= 0.05 ? deltaPctTarget : beta >= 0 ? 10 : -10;
  const mult = Math.max(0.05, 1 + effectivePct / 100);
  const signPct = formatSignedPctES(effectivePct, 1);

  if (model.transform === 'log-log') {
    const yPct = (Math.pow(mult, beta) - 1) * 100;
    const prefix =
      mode === 'pesimista'
        ? `Proteger margen y eficiencia frente a ${varLabel}`
        : mode === 'base'
          ? `Optimizar ${varLabel}`
          : `Invertir en ${varLabel}`;
    return `${prefix} (${signPct}; elasticidad = ${formatNumberES(beta, 2)}): efecto estimado de ${formatSignedPctES(yPct, 1)} en ${yLabel}.`;
  }

  const deltaX = meanX * (effectivePct / 100);
  const deltaYPerEntity = beta * deltaX;
  const totalDeltaY = deltaYPerEntity * model.n;
  const signedYPerEntity = `${deltaYPerEntity >= 0 ? '+' : '−'}${formatNumberES(Math.abs(deltaYPerEntity), 1)}`;
  const signedTotalY = `${totalDeltaY >= 0 ? '+' : '−'}${formatIntegerES(Math.abs(totalDeltaY))}`;

  if (mode === 'pesimista') {
    if (deltaYPerEntity < 0) {
      return `Proteger margen y eficiencia ante ${varLabel} (${signPct}, ${deltaX >= 0 ? '+' : '−'}${formatNumberES(Math.abs(deltaX), 1)} sobre su media): según β = ${formatNumberES(beta, 3)}, implica ${signedYPerEntity} ${unitLabel} por ${entitySingular} (${signedTotalY} ${unitLabel} en total); compensar recortando gasto improductivo y evitando descuentos generalizados.`;
    }
    return `Proteger margen ajustando ${varLabel} (${signPct}, ${deltaX >= 0 ? '+' : '−'}${formatNumberES(Math.abs(deltaX), 1)} sobre su media): aporta ${signedYPerEntity} ${unitLabel} por ${entitySingular} (${signedTotalY} ${unitLabel} en total, β = ${formatNumberES(beta, 3)}).`;
  }

  if (mode === 'base') {
    return `Optimizar ${varLabel} (${signPct}, ${deltaX >= 0 ? '+' : '−'}${formatNumberES(Math.abs(deltaX), 1)} sobre su media): según β = ${formatNumberES(beta, 3)}, suma ${signedYPerEntity} ${unitLabel} por ${entitySingular} (${signedTotalY} ${unitLabel} en total).`;
  }

  return `Invertir en mover ${varLabel} (${signPct}, ${deltaX >= 0 ? '+' : '−'}${formatNumberES(Math.abs(deltaX), 1)} sobre su media): según β = ${formatNumberES(beta, 3)}, genera ${signedYPerEntity} ${unitLabel} por ${entitySingular} (${signedTotalY} ${unitLabel} en total).`;
}

export function generateScenarioRecommendations(
  model: RegressionModelResult,
  scenarios: ScenarioOutcome[],
  sensitivity: SensitivityItem[],
  horizonYears: number,
  yUnit: string,
  configs: VariableScenarioConfig[] = [],
  rows: Record<string, unknown>[] = [],
  controlTypes: Record<string, VariableControlType> = {},
  dummyColumns: { name: string; sourceColumn: string; level: string; referenceLevel: string }[] = [],
  displayNames: Record<string, string> = {},
  entitySingular = 'registro'
): ScenarioRecommendation[] {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const ent = buildEntityLabels(entitySingular);
  const yFriendly = fn(model.yName);
  const unitLabel = resolveYUnit(yUnit, yFriendly);

  const sortedByNegGap = [...model.rows].sort((a, b) => a.gap - b.gap);
  const topOpportunities = sortedByNegGap.filter((r) => r.gap < 0).slice(0, 3);
  const topOverperformers = [...model.rows]
    .sort((a, b) => b.gap - a.gap)
    .filter((r) => r.gap > 0)
    .slice(0, 3);

  const oppNames =
    topOpportunities.length > 0
      ? topOpportunities.map((r) => `${r.rowLabel} (${formatIntegerES(r.gap)} ${unitLabel})`).join(', ')
      : `los ${ent.plural} con menor desempeño relativo`;
  const oppOnlyNames =
    topOpportunities.length > 0
      ? topOpportunities.map((r) => r.rowLabel).join(', ')
      : `los ${ent.plural} con brecha negativa`;
  const protNames =
    topOverperformers.length > 0
      ? topOverperformers.map((r) => `${r.rowLabel} (+${formatIntegerES(r.gap)} ${unitLabel})`).join(', ')
      : `los ${ent.plural} líderes actuales`;
  const protOnlyNames =
    topOverperformers.length > 0
      ? topOverperformers.map((r) => r.rowLabel).join(', ')
      : `los ${ent.plural} líderes`;

  const cfgMap = new Map(configs.map((c) => [c.variable, c]));
  const dummyMap = new Map(dummyColumns.map((d) => [d.name, d]));
  const betaMap = new Map(
    model.coefficients.filter((c) => !c.isIntercept).map((c) => [c.name, c.estimate])
  );

  const continuousPredictors = model.predictors.filter((p) => !dummyMap.has(p));

  const getMoversForScenario = (scenarioId: 'pesimista' | 'base' | 'optimista'): ScenarioMover[] => {
    const pool = continuousPredictors.length > 0 ? continuousPredictors : model.predictors;
    const list: ScenarioMover[] = pool.map((variable) => {
      const cfg = cfgMap.get(variable);
      const beta = betaMap.get(variable) ?? 0;
      const controlType: VariableControlType = controlTypes[variable] ?? 'external';
      const mult = cfg ? getGrowthMultiplier(cfg, scenarioId, horizonYears, beta) : 1;
      const deltaPct = (mult - 1) * 100;

      let annualRatePct: number | null = null;
      if (cfg && cfg.method === 'fixed_rate') {
        annualRatePct =
          scenarioId === 'pesimista'
            ? cfg.pessimisticRatePct
            : scenarioId === 'base'
              ? cfg.baseRatePct
              : cfg.optimisticRatePct;
      } else if (cfg && cfg.method === 'normal_mc') {
        const favorableDir = beta >= 0 ? 1 : -1;
        annualRatePct =
          scenarioId === 'base'
            ? cfg.mcMeanRatePct
            : scenarioId === 'pesimista'
              ? cfg.mcMeanRatePct - favorableDir * cfg.mcStdRatePct
              : cfg.mcMeanRatePct + favorableDir * cfg.mcStdRatePct;
      }

      let yImpactAbs = 0;
      if (model.transform === 'log-log') {
        yImpactAbs = Math.abs(beta * Math.log(Math.max(0.01, mult)));
      } else {
        const meanX = getNumericColumnMean(rows, variable);
        const absBase = Math.abs(meanX) > 1e-9 ? meanX : 1;
        yImpactAbs = Math.abs(beta * (mult - 1) * absBase);
      }

      return {
        variable,
        label: fn(variable),
        beta,
        controlType,
        deltaPct,
        annualRatePct,
        yImpactAbs,
        multiplier: mult,
      };
    });

    const active = list.filter((m) => Math.abs(m.deltaPct) > 1e-6);
    if (active.length > 0) {
      return active.sort(
        (a, b) => b.yImpactAbs - a.yImpactAbs || Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
      );
    }

    const sensRank = new Map(sensitivity.map((s, idx) => [s.variable, idx]));
    return list.sort((a, b) => {
      const ra = sensRank.get(a.variable) ?? 999;
      const rb = sensRank.get(b.variable) ?? 999;
      if (ra !== rb) return ra - rb;
      return Math.abs(b.beta) - Math.abs(a.beta);
    });
  };

  const controllablePredictors = continuousPredictors
    .filter((p) => controlTypes[p] === 'controllable')
    .map((p) => {
      const beta = betaMap.get(p) ?? 0;
      const meanX = getNumericColumnMean(rows, p);
      const scaleImpact =
        model.transform === 'log-log' ? Math.abs(beta) : Math.abs(beta * (Math.abs(meanX) > 1e-9 ? meanX : 1));
      return { variable: p, label: fn(p), beta, scaleImpact };
    })
    .sort((a, b) => b.scaleImpact - a.scaleImpact);
  const hasControllable = controllablePredictors.length > 0;

  // Categorical dummy insights
  const dummyInsights = model.predictors
    .filter((p) => dummyMap.has(p))
    .map((p) => {
      const info = dummyMap.get(p)!;
      const beta = betaMap.get(p) ?? 0;
      const pctDiff = model.transform === 'log-log' ? (Math.exp(beta) - 1) * 100 : null;
      return { ...info, sourceLabel: fn(info.sourceColumn), beta, pctDiff };
    })
    .sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta));

  const posDummy = dummyInsights.find((d) => d.beta > 0);
  const negDummy = dummyInsights.find((d) => d.beta < 0);

  const formatDummyAction = (
    d: (typeof dummyInsights)[number],
    focus: 'expand' | 'review' | 'protect'
  ): string => {
    const diffText =
      d.pctDiff !== null
        ? formatSignedPctES(d.pctDiff, 1)
        : `${d.beta >= 0 ? '+' : '−'}${formatNumberES(Math.abs(d.beta), 1)} ${unitLabel}`;
    if (d.beta >= 0) {
      if (focus === 'protect') {
        if (ent.domain === 'client') {
          return `En ${d.sourceLabel}, "${d.level}" supera a "${d.referenceLevel}" en ${diffText}: blindar la retención y experiencia de servicio en este segmento de ${ent.plural}.`;
        }
        if (ent.domain === 'product') {
          return `En ${d.sourceLabel}, "${d.level}" supera a "${d.referenceLevel}" en ${diffText}: asegurar disponibilidad y posicionamiento prioritario para estos ${ent.plural}.`;
        }
        return `En ${d.sourceLabel}, "${d.level}" supera a "${d.referenceLevel}" en ${diffText}: blindar inventario y nivel de servicio en este segmento de ${ent.plural}.`;
      }
      if (ent.domain === 'location') {
        return `En ${d.sourceLabel}, "${d.level}" obtiene ${diffText} más que "${d.referenceLevel}": priorizar "${d.level}" en nuevas aperturas y expansión.`;
      }
      if (ent.domain === 'client') {
        return `En ${d.sourceLabel}, "${d.level}" obtiene ${diffText} más que "${d.referenceLevel}": priorizar captar y migrar de segmento hacia "${d.level}" a ${ent.plural} afines.`;
      }
      if (ent.domain === 'product') {
        return `En ${d.sourceLabel}, "${d.level}" obtiene ${diffText} más que "${d.referenceLevel}": impulsar y escalar los ${ent.plural} del grupo "${d.level}".`;
      }
      return `En ${d.sourceLabel}, "${d.level}" obtiene ${diffText} más que "${d.referenceLevel}": priorizar "${d.level}" en la asignación de recursos.`;
    }
    if (ent.domain === 'location') {
      return `En ${d.sourceLabel}, "${d.level}" rinde ${diffText} frente a "${d.referenceLevel}": revisar la propuesta comercial y estructura de costos antes de expandirse allí.`;
    }
    if (ent.domain === 'client') {
      return `En ${d.sourceLabel}, "${d.level}" rinde ${diffText} frente a "${d.referenceLevel}": diseñar acciones para retener y migrar de segmento hacia categorías de mayor aporte.`;
    }
    if (ent.domain === 'product') {
      return `En ${d.sourceLabel}, "${d.level}" rinde ${diffText} frente a "${d.referenceLevel}": evaluar si conviene reposicionar precio/propuesta o descontinuar los ${ent.plural} de menor rendimiento.`;
    }
    return `En ${d.sourceLabel}, "${d.level}" rinde ${diffText} frente a "${d.referenceLevel}": revisar la propuesta comercial y estructura de costos en este grupo de ${ent.plural}.`;
  };

  const pes = scenarios.find((s) => s.id === 'pesimista')!;
  const base = scenarios.find((s) => s.id === 'base')!;
  const opt = scenarios.find((s) => s.id === 'optimista')!;

  const isFlat = (pct: number) => Math.abs(pct) < 0.05;
  const formatSignedInt = (v: number) => `${v > 0 ? '+' : ''}${formatIntegerES(v)}`;

  const pesMovers = getMoversForScenario('pesimista');
  const baseMovers = getMoversForScenario('base');
  const optMovers = getMoversForScenario('optimista');

  const pesMain = pesMovers[0];
  const baseMain = baseMovers[0];
  const optMain = optMovers[0];

  const getScenarioDeltaForVar = (
    varName: string,
    scenarioId: 'pesimista' | 'base' | 'optimista'
  ): number => {
    const cfg = cfgMap.get(varName);
    if (!cfg) return 0;
    const beta = betaMap.get(varName) ?? 1;
    return (getGrowthMultiplier(cfg, scenarioId, horizonYears, beta) - 1) * 100;
  };

  const formatMovesWithExternalScope = (
    movers: ScenarioMover[],
    externalLabelSingular: string,
    externalLabelPlural: string,
    fallbackText: string
  ): string => {
    const active = movers.filter((m) => Math.abs(m.deltaPct) > 1e-6);
    if (active.length === 0) return fallbackText;

    const extMovers = active.filter((m) => m.controlType === 'external');
    const ctrlMovers = active.filter((m) => m.controlType === 'controllable');

    const extText =
      extMovers.length > 0
        ? `${extMovers.map((m) => formatMoverChange(m, horizonYears)).join(' y ')} (${
            extMovers.length === 1 ? externalLabelSingular : externalLabelPlural
          })`
        : '';
    const ctrlText =
      ctrlMovers.length > 0
        ? ctrlMovers.map((m) => formatMoverChange(m, horizonYears)).join(' y ')
        : '';

    if (extText && ctrlText) {
      return `${extText}, junto con los ajustes en ${ctrlText}`;
    }
    return extText || ctrlText;
  };

  // --- PESIMISTA ---
  const pesMovesDesc = formatMovesWithExternalScope(
    pesMovers,
    'variable externa fuera del control directo de la empresa',
    'variables externas fuera del control directo de la empresa',
    pesMain ? `${pesMain.label} sin variación proyectada` : 'sin variación en predictores'
  );

  const pesMeaning = isFlat(pes.changePct)
    ? `Con los supuestos actuales (0,0 %), ${yFriendly} total se mantendría sin cambios en torno a ${formatIntegerES(pes.projectedTotal)} ${unitLabel}.`
    : pes.changePct > 0
      ? `La variación en este escenario proviene principalmente de ${pesMovesDesc}, situando ${yFriendly} total en ${formatIntegerES(pes.projectedTotal)} ${unitLabel} (${formatSignedInt(pes.changeAbs)} ${unitLabel} frente al nivel actual de ${formatIntegerES(pes.currentTotal)}).`
      : `La variación en este escenario proviene principalmente de ${pesMovesDesc}, llevando ${yFriendly} total a ${formatIntegerES(pes.projectedTotal)} ${unitLabel} (${formatSignedInt(pes.changeAbs)} ${unitLabel} frente al nivel actual de ${formatIntegerES(pes.currentTotal)}).`;

  const pesActionLead =
    ent.domain === 'client'
      ? `Retener y proteger el valor de los ${ent.plural} que hoy rinden por encima de su potencial (${protNames}) mediante programas de fidelización, atención prioritaria y seguimiento preventivo.`
      : ent.domain === 'product'
        ? `Proteger margen y disponibilidad en los ${ent.plural} que hoy rinden por encima de su potencial (${protNames}), evitando quiebres de inventario o erosión de precio.`
        : `Proteger retención, margen y participación en los ${ent.plural} que hoy rinden por encima de su potencial (${protNames}) mediante acuerdos de permanencia y servicio prioritario.`;

  const pesActions: string[] = [pesActionLead];

  if (pesMain && pesMain.controlType === 'external') {
    pesActions.push(
      `Adaptar la operación ante la dinámica externa de ${pesMain.label}: ajustar inventarios, controlar costos fijos y orientar el portafolio hacia opciones de mayor rotación y margen.`
    );
  }
  if (hasControllable) {
    const topCtrl = controllablePredictors[0];
    const deltaPes = getScenarioDeltaForVar(topCtrl.variable, 'pesimista');
    pesActions.push(
      describeControllableMove(
        model,
        rows,
        topCtrl.variable,
        topCtrl.label,
        yFriendly,
        topCtrl.beta,
        unitLabel,
        deltaPes,
        ent.singular,
        'pesimista'
      )
    );
  } else {
    if (ent.domain === 'client') {
      pesActions.push(
        `Concentrar acciones de retención y contención en ${oppOnlyNames} para evitar pérdida de ${ent.plural} y descuentos generalizados que erosionen el margen.`
      );
    } else if (ent.domain === 'product') {
      pesActions.push(
        `Revisar precios y rentabilidad en ${oppOnlyNames}: priorizar las referencias sostenibles y reposicionar o descontinuar las que destruyen margen en escenarios adversos.`
      );
    } else {
      pesActions.push(
        `Focalizar la defensa comercial y el gasto en canales más rentables para ${oppOnlyNames} y evitar descuentos generalizados que erosionen el margen.`
      );
    }
  }
  if (negDummy) {
    pesActions.push(formatDummyAction(negDummy, 'review'));
  }

  // --- BASE ---
  const baseMovesDesc =
    baseMovers
      .filter((m) => Math.abs(m.deltaPct) > 1e-6)
      .map((m) => formatMoverChange(m, horizonYears))
      .join(' y ') || (baseMain ? `${baseMain.label} estable` : 'sin variación en predictores');

  const baseMeaning = isFlat(base.changePct)
    ? `Bajo los supuestos base (0,0 %), ${yFriendly} se mantendría estable en ${formatIntegerES(base.projectedTotal)} ${unitLabel}; mantener la inercia actual no cierra las brechas existentes.`
    : `Con la trayectoria esperada encabezada por ${baseMovesDesc}, ${yFriendly} alcanzaría ${formatIntegerES(base.projectedTotal)} ${unitLabel} (${formatSignedInt(base.changeAbs)} ${unitLabel}). El impulso tendencial por sí solo no corrige las brechas estructurales actuales.`;

  const baseActionLead =
    ent.domain === 'client'
      ? `Priorizar el cierre de brecha en los ${ent.plural} con mayor potencial sin capturar (${oppNames}), combinando tácticas para retener, captar perfiles similares y migrar de segmento.`
      : ent.domain === 'product'
        ? `Priorizar el cierre de brecha en los ${ent.plural} con mayor déficit frente a su potencial (${oppNames}), decidiendo cuáles impulsar, reposicionar o descontinuar según su margen.`
        : `Priorizar la captura de brecha comercial en los ${ent.plural} con mayor déficit frente a su potencial (${oppNames}), asignando ahí el presupuesto incremental de cobertura y ejecución.`;

  const baseActions: string[] = [baseActionLead];
  if (hasControllable) {
    for (const ctrl of controllablePredictors.slice(0, 2)) {
      const optSuggestionPct = ctrl.beta >= 0 ? 10 : -5;
      baseActions.push(
        describeControllableMove(
          model,
          rows,
          ctrl.variable,
          ctrl.label,
          yFriendly,
          ctrl.beta,
          unitLabel,
          optSuggestionPct,
          ent.singular,
          'base'
        )
      );
    }
  } else {
    baseActions.push(
      `Adaptar portafolio, precios y canales en ${oppOnlyNames} replicando las buenas prácticas observadas en los ${ent.plural} referentes positivos (${topOverperformers[0]?.rowLabel ?? 'líderes actuales'}).`,
      `Dado que las variables del modelo son externas, medir a los equipos por cierre gradual de brecha por ${ent.singular} y avance frente al potencial en lugar de esperar solo el impulso de ${baseMain?.label ?? fn(model.predictors[0])}.`
    );
  }
  if (posDummy) {
    baseActions.push(formatDummyAction(posDummy, 'expand'));
  } else if (negDummy) {
    baseActions.push(formatDummyAction(negDummy, 'review'));
  }

  // --- OPTIMISTA ---
  const optMovesDesc = formatMovesWithExternalScope(
    optMovers,
    'dinámica externa a la que la empresa debe adaptarse, no una palanca directa',
    'dinámicas externas a la que la empresa debe adaptarse, no palancas directas',
    optMain ? `${optMain.label} estable` : 'sin variación en predictores'
  );

  const optIsExternalIncome =
    optMain != null &&
    optMain.controlType === 'external' &&
    classifyScenarioVariable(optMain.variable) === 'income';

  // Rank rows where optMain growth creates highest incremental unit potential (potencial × sensibilidad)
  const optImpactPerRow = model.rows.map((r, idx) => {
    const rawRow = rows[idx] ?? {};
    const xVal = optMain ? Number(rawRow[optMain.variable]) : NaN;
    const beta = optMain?.beta ?? 0;
    let incrementalUnitsPotential = 0;
    if (model.transform === 'log-log' && optMain) {
      incrementalUnitsPotential = r.yPredicted * Math.abs(beta);
    } else if (optMain && Number.isFinite(xVal)) {
      incrementalUnitsPotential = Math.abs(beta * (optMain.multiplier - 1) * xVal);
    } else {
      incrementalUnitsPotential = r.yPredicted;
    }
    return {
      rowLabel: r.rowLabel,
      yPredicted: r.yPredicted,
      gap: r.gap,
      xVal: Number.isFinite(xVal) ? xVal : 0,
      incrementalScore: incrementalUnitsPotential,
    };
  });

  const topScaleEntities = [...optImpactPerRow]
    .sort((a, b) => b.incrementalScore - a.incrementalScore)
    .slice(0, 3);
  const scaleEntityLabels = topScaleEntities.map((m) => m.rowLabel).join(', ');

  // Lower-income early-entry bets when optMain is an external income variable
  let earlyBetNames = '';
  if (optIsExternalIncome) {
    const validXValues = optImpactPerRow.map((r) => r.xVal).filter((v) => Number.isFinite(v));
    const medianMainX = getMedianNumeric(validXValues);
    const earlyEntryBets = optImpactPerRow
      .filter((r) => r.xVal < medianMainX && r.gap < 0)
      .sort((a, b) => a.xVal - b.xVal)
      .slice(0, 3);
    earlyBetNames = earlyEntryBets.map((e) => e.rowLabel).join(', ');
  }

  const optMeaning = isFlat(opt.changePct)
    ? `Con los supuestos actuales (0,0 %), ${yFriendly} total se mantendría sin variación en ${formatIntegerES(opt.projectedTotal)} ${unitLabel}; ajusta las tasas del Paso 8 si deseas modelar un escenario favorable.`
    : `En el escenario optimista, ${yFriendly} alcanzaría ${formatIntegerES(opt.projectedTotal)} ${unitLabel} (${formatSignedPctES(opt.changePct, 1)}), impulsado principalmente por ${optMovesDesc}.`;

  const optActions: string[] = [];
  if (optMain && optMain.controlType === 'external') {
    if (optIsExternalIncome) {
      optActions.push(
        `Priorizar capacidad comercial, inventario y canales en los ${ent.plural} donde el avance de ${optMain.label} genera más ${yFriendly} adicional (potencial × sensibilidad): ${scaleEntityLabels}.`
      );
      if (earlyBetNames) {
        if (ent.domain === 'location') {
          optActions.push(
            `Posicionar apuestas de entrada temprana en economías de menor nivel en ${optMain.label} y brecha negativa (${earlyBetNames}) usando formatos livianos, alianzas locales y portafolio de entrada.`
          );
        } else {
          optActions.push(
            `Capturar crecimiento temprano en los ${ent.plural} con menor nivel actual en ${optMain.label} y brecha negativa (${earlyBetNames}) mediante propuestas de entrada y migración gradual.`
          );
        }
      }
      optActions.push(
        `Ajustar el mix hacia gamas de mayor margen y asegurar disponibilidad operativa antes de que se materialice la mayor demanda.`
      );
    } else if (ent.domain === 'client') {
      optActions.push(
        `Enfocar campañas para captar nuevos ${ent.plural} similares y migrar de segmento hacia planes de mayor valor a ${scaleEntityLabels}, aprovechando la evolución favorable de ${optMain.label}.`
      );
      optActions.push(
        `Acompañar el entorno favorable de ${optMain.label} reforzando programas para retener a los ${ent.plural} de alto potencial y elevar su recurrencia.`
      );
    } else if (ent.domain === 'product') {
      optActions.push(
        `Impulsar los ${ent.plural} de mayor potencial absoluto (${scaleEntityLabels}) con stock preferente y visibilidad comercial para capitalizar el cambio en ${optMain.label}.`
      );
      optActions.push(
        `Aprovechar la tendencia favorable en ${optMain.label} para reposicionar el portafolio hacia gamas de mayor margen y revisar referencias rezagadas.`
      );
    } else if (ent.domain === 'location') {
      optActions.push(
        `Concentrar capacidad operativa, inventario y cobertura en los ${ent.plural} de mayor potencial absoluto (${scaleEntityLabels}) para aprovechar la evolución favorable de ${optMain.label}, evaluando nuevas aperturas o expansión.`
      );
      optActions.push(
        `Acompañar el escenario favorable en ${optMain.label} ajustando el mix hacia gamas de mayor margen y fortaleciendo los canales con mejor conversión.`
      );
    } else {
      optActions.push(
        `Concentrar capacidad operativa y comercial en los ${ent.plural} de mayor potencial absoluto (${scaleEntityLabels}) para aprovechar la evolución favorable de ${optMain.label}.`
      );
      optActions.push(
        `Acompañar el escenario favorable en ${optMain.label} ajustando la oferta hacia segmentos de mayor margen y canales con mejor conversión.`
      );
    }
  }
  if (hasControllable) {
    for (const ctrl of controllablePredictors.slice(0, 2)) {
      const deltaOpt = getScenarioDeltaForVar(ctrl.variable, 'optimista');
      const movePct = Math.abs(deltaOpt) >= 0.05 ? deltaOpt : ctrl.beta >= 0 ? 10 : -10;
      optActions.push(
        describeControllableMove(
          model,
          rows,
          ctrl.variable,
          ctrl.label,
          yFriendly,
          ctrl.beta,
          unitLabel,
          movePct,
          ent.singular,
          'optimista'
        )
      );
    }
    if (optMain?.controlType === 'controllable') {
      const supportText =
        ent.domain === 'client'
          ? `Asegurar capacidad de atención, captación y migración de segmento en ${scaleEntityLabels} para retener el incremento de demanda.`
          : ent.domain === 'product'
            ? `Asegurar abastecimiento y exhibición preferente para impulsar ${scaleEntityLabels} sin quiebres de inventario.`
            : `Asegurar inventario, capacidad operativa y cobertura en ${scaleEntityLabels} para sostener el incremento comercial sin quiebres de stock.`;
      optActions.push(supportText);
    }
  }
  if (posDummy && optActions.length < 4) {
    optActions.push(formatDummyAction(posDummy, 'expand'));
  }
  if (negDummy && optActions.length < 4 && !optIsExternalIncome) {
    optActions.push(formatDummyAction(negDummy, 'review'));
  }

  return [
    {
      scenarioId: 'pesimista',
      title: `Escenario Pesimista (${formatSignedPctES(pes.changePct, 1)} en ${horizonYears} años)`,
      meaning: pesMeaning,
      actions: pesActions,
      kpi: `Retención de ${yFriendly} en los ${ent.plural} defendidos (${protOnlyNames}, meta ≥ 97 % del nivel actual) y margen bruto / eficiencia operativa.`,
      risks: isFlat(pes.changePct)
        ? `Riesgo de inacción si los supuestos del escenario se dejan en 0 % sin incorporar sensibilidad operativa o de contexto.`
        : `Erosión de márgenes por sobrestock o descuentos reactivos si el entorno de ${pesMain?.label ?? fn(model.predictors[0])} resulta más adverso de lo previsto.`,
    },
    {
      scenarioId: 'base',
      title: `Escenario Base (${formatSignedPctES(base.changePct, 1)} en ${horizonYears} años)`,
      meaning: baseMeaning,
      actions: baseActions,
      kpi: `Cierre porcentual de la brecha negativa en ${oppOnlyNames} (meta: recuperar ≥ 25 % anual en ${unitLabel}) y avance por ${ent.singular}.`,
      risks: `Dispersión del esfuerzo comercial en ${ent.plural} ya saturados o ejecución homogénea que ignore diferencias de canales, formato y precios entre segmentos.`,
    },
    {
      scenarioId: 'optimista',
      title: `Escenario Optimista (${formatSignedPctES(opt.changePct, 1)} en ${horizonYears} años)`,
      meaning: optMeaning,
      actions: optActions,
      kpi:
        `Aporte incremental de ${yFriendly} (${unitLabel}) y tracción en los ${ent.plural} prioritarios (${scaleEntityLabels})` +
        (earlyBetNames ? `, junto con conversión en ${earlyBetNames}.` : '.'),
      risks: isFlat(opt.changePct)
        ? `Sin tasas diferenciadas en las variables continuas, el escenario optimista no captura potencial adicional frente al estado actual.`
        : ent.domain === 'location'
          ? `Quiebres de inventario o sobrecostos de expansión en ${scaleEntityLabels} si la ejecución comercial o la demanda difieren de lo proyectado.`
          : `Sobrecostos operativos o saturación de capacidad en ${scaleEntityLabels} si la ejecución o la respuesta difieren de lo proyectado.`,
    },
  ];
}
