import React from 'react';
import { ArrowLeft, ArrowRight, Globe2, AlertTriangle } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  MonteCarloSummary,
  RegressionModelResult,
  ScenarioGrowthMethod,
  ScenarioOutcome,
  SensitivityItem,
  VariableScenarioConfig,
} from '../../types/regression';
import {
  formatIntegerES,
  formatNumberES,
  formatSignedPctES,
  resolveYUnit,
} from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step8ScenariosProps {
  model: RegressionModelResult;
  yUnit: string;
  horizonYears: number;
  onChangeHorizon: (years: number) => void;
  configs: VariableScenarioConfig[];
  onUpdateConfig: (variable: string, patch: Partial<VariableScenarioConfig>) => void;
  scenarios: ScenarioOutcome[];
  monteCarlo: MonteCarloSummary;
  sensitivity: SensitivityItem[];
  displayNames?: Record<string, string>;
  entitySingular?: string;
  onPrev: () => void;
  onNext: () => void;
}

export const Step8Scenarios: React.FC<Step8ScenariosProps> = ({
  model,
  yUnit,
  horizonYears,
  onChangeHorizon,
  configs,
  onUpdateConfig,
  scenarios,
  monteCarlo,
  sensitivity,
  displayNames = {},
  entitySingular = 'registro',
  onPrev,
  onNext,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const unitLabel = resolveYUnit(yUnit, fn(model.yName));
  const pes = scenarios.find((s) => s.id === 'pesimista')!;
  const base = scenarios.find((s) => s.id === 'base')!;
  const opt = scenarios.find((s) => s.id === 'optimista')!;
  const allScenariosEqual =
    Math.abs(pes.projectedTotal - base.projectedTotal) < 1e-4 &&
    Math.abs(opt.projectedTotal - base.projectedTotal) < 1e-4;

  const tornadoData = sensitivity.map((s) => ({
    variable: fn(s.variable),
    menos10: Number(s.lowDeltaPct.toFixed(2)),
    mas10: Number(s.highDeltaPct.toFixed(2)),
  }));

  const maxAbsTornado = Math.max(
    ...tornadoData.flatMap((d) => [Math.abs(d.menos10), Math.abs(d.mas10)]),
    1
  );
  const stepTornado =
    maxAbsTornado <= 6 ? 2 : maxAbsTornado <= 15 ? 4 : maxAbsTornado <= 30 ? 10 : 20;
  const axisBound = Math.ceil((maxAbsTornado * 1.2) / stepTornado) * stepTornado;
  const tornadoTicks = [-axisBound, -axisBound / 2, 0, axisBound / 2, axisBound];

  const findClosestBinLabel = (target: number): string | undefined => {
    if (monteCarlo.bins.length === 0) return undefined;
    let best = monteCarlo.bins[0];
    let bestDiff = Math.abs(best.midpoint - target);
    for (const b of monteCarlo.bins) {
      const diff = Math.abs(b.midpoint - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = b;
      }
    }
    return best.rangeLabel;
  };

  const pesBin = findClosestBinLabel(pes.projectedTotal);
  const baseBin = findClosestBinLabel(base.projectedTotal);
  const optBin = findClosestBinLabel(opt.projectedTotal);

  const renderTornadoLabel = (props: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
    viewBox?: unknown;
    value?: unknown;
  }) => {
    const numVal = Number(props.value);
    if (!Number.isFinite(numVal) || Math.abs(numVal) < 0.005) return <g />;
    const vb = props.viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
    const x = Number(vb?.x ?? props.x ?? 0);
    const y = Number(vb?.y ?? props.y ?? 0);
    const w = Number(vb?.width ?? props.width ?? 0);
    const h = Number(vb?.height ?? props.height ?? 0);
    const leftEdge = Math.min(x, x + w);
    const rightEdge = Math.max(x, x + w);
    const cy = y + h / 2 + 4;
    const isNeg = numVal < 0;
    return (
      <text
        x={isNeg ? leftEdge - 6 : rightEdge + 6}
        y={cy}
        textAnchor={isNeg ? 'end' : 'start'}
        fill={isNeg ? '#b91c1c' : '#1d4ed8'}
        fontSize={11}
        fontWeight={600}
        fontFamily="JetBrains Mono, monospace"
      >
        {formatSignedPctES(numVal, 1)}
      </text>
    );
  };

  const topSens = sensitivity[0];
  const conclusionText =
    `A ${horizonYears} años sobre un total actual de ${formatIntegerES(base.currentTotal)} ${unitLabel}, el escenario Pesimista proyecta ${formatIntegerES(pes.projectedTotal)} (${formatSignedPctES(pes.changePct, 1)}), el Base ${formatIntegerES(base.projectedTotal)} (${formatSignedPctES(base.changePct, 1)}) y el Optimista ${formatIntegerES(opt.projectedTotal)} (${formatSignedPctES(opt.changePct, 1)}). ` +
    `El análisis Monte Carlo (10.000 simulaciones, semilla 42) ubica la mediana en ${formatIntegerES(monteCarlo.p50)} ${unitLabel} (P5–P95: ${formatIntegerES(monteCarlo.p5)} a ${formatIntegerES(monteCarlo.p95)}).` +
    (topSens ? ` La variable con mayor sensibilidad (±10 %) es ${fn(topSens.variable)}.` : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">8. Simulación de escenarios y Monte Carlo</h1>
          <p className="text-sm text-slate-600 mt-1">
            Proyección a futuro conservando el residuo propio de cada {entitySingular}, con incertidumbre en coeficientes vía Cholesky.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <label htmlFor="horizon-input" className="text-xs font-medium text-slate-700 whitespace-nowrap">
            Horizonte (años):
          </label>
          <input
            id="horizon-input"
            type="number"
            min={1}
            max={20}
            value={horizonYears}
            onChange={(e) => onChangeHorizon(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="w-16 px-2 py-1 text-sm font-mono tabular-nums border border-slate-300 rounded text-right"
          />
        </div>
      </div>

      {/* External sources note */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-center gap-2.5 text-xs text-slate-700">
        <Globe2 className="w-4 h-4 text-[#2a78d6] shrink-0" />
        <span>
          Sugerencia de calibración: contrasta las tasas anuales esperadas con proyecciones oficiales externas (FMI, ONU, Banco Mundial, DANE o bancos centrales).
        </span>
      </div>

      {/* Variable assumptions editor */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Parámetros futuros por variable predictora
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Elige cómo generar los valores futuros de cada X: tasa anual fija, distribución normal para Monte Carlo o cambio manual
          </p>
        </div>
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Variable X</th>
                <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Método</th>
                <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Pesimista (%/año)</th>
                <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Base (%/año)</th>
                <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Optimista (%/año)</th>
                <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Parámetros adicionales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.map((cfg) => (
                <tr key={cfg.variable} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {fn(cfg.variable)}
                    <div className="text-[11px] font-sans font-normal text-slate-500">
                      {cfg.category === 'income'
                        ? 'Tipo ingreso'
                        : cfg.category === 'population'
                          ? 'Tipo población'
                          : 'Otra variable'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={cfg.method}
                      onChange={(e) =>
                        onUpdateConfig(cfg.variable, {
                          method: e.target.value as ScenarioGrowthMethod,
                        })
                      }
                      className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-xs"
                    >
                      <option value="fixed_rate">(a) Tasa anual fija</option>
                      <option value="normal_mc">(b) Distribución normal (MC)</option>
                      <option value="manual_value">(c) Valor manual (% total)</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step={0.01}
                      disabled={cfg.method !== 'fixed_rate'}
                      value={cfg.pessimisticRatePct}
                      onChange={(e) =>
                        onUpdateConfig(cfg.variable, {
                          pessimisticRatePct: Number(e.target.value),
                        })
                      }
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-mono tabular-nums disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step={0.01}
                      disabled={cfg.method !== 'fixed_rate'}
                      value={cfg.baseRatePct}
                      onChange={(e) =>
                        onUpdateConfig(cfg.variable, { baseRatePct: Number(e.target.value) })
                      }
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-mono tabular-nums disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step={0.01}
                      disabled={cfg.method !== 'fixed_rate'}
                      value={cfg.optimisticRatePct}
                      onChange={(e) =>
                        onUpdateConfig(cfg.variable, {
                          optimisticRatePct: Number(e.target.value),
                        })
                      }
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-mono tabular-nums disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {cfg.method === 'normal_mc' ? (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-slate-500">μ:</span>
                        <input
                          type="number"
                          step={0.01}
                          value={cfg.mcMeanRatePct}
                          onChange={(e) =>
                            onUpdateConfig(cfg.variable, {
                              mcMeanRatePct: Number(e.target.value),
                            })
                          }
                          className="w-16 px-1.5 py-1 border border-slate-300 rounded text-right font-mono tabular-nums"
                        />
                        <span className="text-slate-500">σ:</span>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          value={cfg.mcStdRatePct}
                          onChange={(e) =>
                            onUpdateConfig(cfg.variable, {
                              mcStdRatePct: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-16 px-1.5 py-1 border border-slate-300 rounded text-right font-mono tabular-nums"
                        />
                      </div>
                    ) : cfg.method === 'manual_value' ? (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-slate-500">Cambio total %:</span>
                        <input
                          type="number"
                          step={0.5}
                          value={cfg.manualChangePct}
                          onChange={(e) =>
                            onUpdateConfig(cfg.variable, {
                              manualChangePct: Number(e.target.value),
                            })
                          }
                          className="w-20 px-1.5 py-1 border border-slate-300 rounded text-right font-mono tabular-nums"
                        />
                      </div>
                    ) : (
                      <span className="text-slate-400">Tasa compuesta {horizonYears} años</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Equal scenarios alert */}
      {allScenariosEqual && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3.5 flex items-center gap-2.5 text-xs font-medium text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Los escenarios son iguales: define tasas distintas en la tabla</span>
        </div>
      )}

      {/* 3 Scenario KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {scenarios.map((sc) => {
          const isNeg = sc.changePct < 0;
          return (
            <div key={sc.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Escenario {sc.label}</span>
                <span
                  className={`font-mono text-sm font-bold tabular-nums ${
                    isNeg ? 'text-[#e34948]' : 'text-[#2a78d6]'
                  }`}
                >
                  {formatSignedPctES(sc.changePct, 1)}
                </span>
              </div>
              <div className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                {formatIntegerES(sc.projectedTotal)}
              </div>
              <div className="text-xs text-slate-500 tabular-nums">
                Actual: {formatIntegerES(sc.currentTotal)} {unitLabel} · Diferencia:{' '}
                <span className={isNeg ? 'text-[#e34948]' : 'text-[#2a78d6]'}>
                  {sc.changeAbs > 0 ? '+' : ''}
                  {formatIntegerES(sc.changeAbs)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 tabular-nums">
                IC predicción 95 %: [{formatIntegerES(sc.piLower)} – {formatIntegerES(sc.piUpper)}]
              </div>
            </div>
          );
        })}
      </div>

      {/* Monte Carlo + Tornado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Simulación Monte Carlo (10.000 iteraciones · semilla 42)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Muestreo normal multivariado de β vía descomposición de Cholesky
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
              <div className="text-[11px] text-slate-500">Percentil P5</div>
              <div className="font-mono text-sm font-bold tabular-nums text-[#e34948] mt-0.5">
                {formatIntegerES(monteCarlo.p5)}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
              <div className="text-[11px] text-slate-500">Mediana P50</div>
              <div className="font-mono text-sm font-bold tabular-nums text-slate-900 mt-0.5">
                {formatIntegerES(monteCarlo.p50)}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
              <div className="text-[11px] text-slate-500">Percentil P95</div>
              <div className="font-mono text-sm font-bold tabular-nums text-[#2a78d6] mt-0.5">
                {formatIntegerES(monteCarlo.p95)}
              </div>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monteCarlo.bins} margin={{ top: 18, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="rangeLabel" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={45} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: unknown) => [`${v} simulaciones`, 'Frecuencia']}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
                />
                <Bar dataKey="count" fill="#2a78d6" radius={[2, 2, 0, 0]} />
                {pesBin && (
                  <ReferenceLine
                    x={pesBin}
                    stroke="#e34948"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    label={{ value: 'Pes.', position: 'top', fill: '#e34948', fontSize: 10 }}
                  />
                )}
                {baseBin && (
                  <ReferenceLine
                    x={baseBin}
                    stroke="#0f172a"
                    strokeWidth={2}
                    label={{ value: 'Base', position: 'top', fill: '#0f172a', fontSize: 10 }}
                  />
                )}
                {optBin && (
                  <ReferenceLine
                    x={optBin}
                    stroke="#16a34a"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    label={{ value: 'Opt.', position: 'top', fill: '#16a34a', fontSize: 10 }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 tabular-nums">
            <span className="text-[#e34948] font-medium">Pesimista: {formatIntegerES(pes.projectedTotal)}</span>
            <span>·</span>
            <span className="text-slate-900 font-medium">Base: {formatIntegerES(base.projectedTotal)}</span>
            <span>·</span>
            <span className="text-emerald-700 font-medium">Optimista: {formatIntegerES(opt.projectedTotal)}</span>
          </div>
        </div>

        {/* Sensitivity Tornado */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Análisis de sensibilidad (gráfico tornado ±10 %)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Impacto porcentual en {fn(model.yName)} total al mover cada X en −10 % o +10 %
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#e34948]" />
                <span>−10 % en X</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#2a78d6]" />
                <span>+10 % en X</span>
              </span>
            </div>
          </div>
          <div className="h-72">
            {tornadoData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center px-4">
                El modelo actual solo contiene variables categóricas (dummies), que representan características fijas de cada {entitySingular} y no varían por tasa de crecimiento.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tornadoData}
                  layout="vertical"
                  stackOffset="sign"
                  margin={{ top: 10, right: 48, bottom: 10, left: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[-axisBound, axisBound]}
                    ticks={tornadoTicks}
                    tickFormatter={(v) => `${formatNumberES(Number(v), 0)} %`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis type="category" dataKey="variable" width={115} tick={{ fontSize: 11 }} />
                  <ReferenceLine x={0} stroke="#334155" strokeWidth={1.5} />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [
                      formatSignedPctES(Number(v), 2),
                      name === 'menos10' ? '−10 % en X' : '+10 % en X',
                    ]}
                    contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
                  />
                  <Bar dataKey="menos10" name="menos10" stackId="t" fill="#e34948" barSize={28} isAnimationActive={false}>
                    <LabelList dataKey="menos10" content={renderTornadoLabel} />
                  </Bar>
                  <Bar dataKey="mas10" name="mas10" stackId="t" fill="#2a78d6" barSize={28} isAnimationActive={false}>
                    <LabelList dataKey="mas10" content={renderTornadoLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <ConclusionBanner stepNumber={8} text={conclusionText} />

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Anterior</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700"
        >
          <span>Continuar a Recomendaciones</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
