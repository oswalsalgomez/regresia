import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpDown, CheckCircle2 } from 'lucide-react';
import jStat from 'jstat';
import {
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ModelSelectionOutput, RegressionModelResult } from '../../types/regression';
import { formatIntegerES, formatNumberES, formatPValueES, formatSignedPctES } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step6ModelSelectionProps {
  selection: ModelSelectionOutput | null;
  isCalculating?: boolean;
  progress?: { completed: number; total: number; message: string } | null;
  errorMsg?: string | null;
  onPrev: () => void;
  onNext: () => void;
}

type SortKey = 'rank' | 'adjR2' | 'r2' | 'rmse' | 'loocvRmse' | 'aic' | 'bic' | 'maxVif' | 'maxP';

export const Step6ModelSelection: React.FC<Step6ModelSelectionProps> = ({
  selection,
  isCalculating = false,
  progress = null,
  errorMsg = null,
  onPrev,
  onNext,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const rawAllModels = selection?.allModels ?? [];
  const rawBestModel = selection?.bestModel ?? null;

  const sortedModels = useMemo(() => {
    const copy = [...rawAllModels];
    copy.sort((a, b) => {
      let va = 0;
      let vb = 0;
      switch (sortKey) {
        case 'rank':
          va = a.selectionScoreRank ?? 999;
          vb = b.selectionScoreRank ?? 999;
          break;
        case 'adjR2':
          va = a.adjR2;
          vb = b.adjR2;
          break;
        case 'r2':
          va = a.r2;
          vb = b.r2;
          break;
        case 'rmse':
          va = a.rmse;
          vb = b.rmse;
          break;
        case 'loocvRmse':
          va = a.loocvRmse;
          vb = b.loocvRmse;
          break;
        case 'aic':
          va = a.aic;
          vb = b.aic;
          break;
        case 'bic':
          va = a.bic;
          vb = b.bic;
          break;
        case 'maxVif':
          va = a.maxVif;
          vb = b.maxVif;
          break;
        case 'maxP':
          va = a.maxPValuePredictors;
          vb = b.maxPValuePredictors;
          break;
      }
      return sortAsc ? va - vb : vb - va;
    });
    return copy;
  }, [rawAllModels, sortKey, sortAsc]);

  const realVsPredData = useMemo(
    () =>
      (rawBestModel?.rows ?? []).map((r) => ({
        x: r.yActualModelSpace,
        y: r.yPredictedModelSpace,
        label: r.rowLabel,
      })),
    [rawBestModel]
  );

  const residVsFittedData = useMemo(
    () =>
      (rawBestModel?.rows ?? []).map((r) => ({
        x: r.yPredictedModelSpace,
        y: r.residualModelSpace,
        label: r.rowLabel,
      })),
    [rawBestModel]
  );

  const qqData = useMemo(() => {
    if (!rawBestModel) return [];
    const sorted = [...rawBestModel.rows].sort(
      (a, b) => a.standardizedResidual - b.standardizedResidual
    );
    const n = sorted.length;
    return sorted.map((r, idx) => {
      const p = (idx + 0.5) / n;
      const theo = jStat.normal.inv(p, 0, 1);
      return {
        x: theo,
        y: r.standardizedResidual,
        label: r.rowLabel,
      };
    });
  }, [rawBestModel]);

  if (errorMsg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">6. Selección del mejor modelo y supuestos</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 text-sm text-[#e34948]">
          {errorMsg}
        </div>
        <div className="flex justify-start">
          <button
            type="button"
            onClick={onPrev}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver a Variables</span>
          </button>
        </div>
      </div>
    );
  }

  if (isCalculating || !selection || !rawBestModel) {
    const pct =
      progress && progress.total > 0
        ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
        : 15;
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">6. Selección del mejor modelo y supuestos</h1>
          <p className="text-sm text-slate-600 mt-1">
            Ejecutando la búsqueda de modelos en segundo plano (Web Worker) para mantener fluida la interfaz...
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-900">
              {progress?.message ?? 'Preparando matrices de diseño y estimando modelos OLS...'}
            </span>
            <span className="font-mono font-semibold text-[#2a78d6] tabular-nums">{pct} %</span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2a78d6] transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            Si hay más de 12 variables o grupos candidatos, se aplica automáticamente selección stepwise hacia atrás; si n &gt; 500 se usa validación cruzada 10-fold (semilla 42).
          </p>
        </div>
        <div className="flex justify-start">
          <button
            type="button"
            onClick={onPrev}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>
        </div>
      </div>
    );
  }

  const {
    bestModel,
    selectionExplanation,
    selectionMethod,
    selectionMethodReason,
    stepwiseRemovedLog,
    maxPredictorsEvaluated,
    totalEvaluated,
  } = selection;
  const isKFold = bestModel.cvMethod === 'kfold10';
  const cvShortLabel = isKFold ? '10-fold CV' : 'LOOCV';
  const cvLongLabel = isKFold ? 'RMSE 10-fold CV' : 'RMSE LOOCV';

  const toggleSort = (key: SortKey, defaultAsc = true) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(defaultAsc);
    }
  };

  const minRP = Math.min(...realVsPredData.map((d) => Math.min(d.x, d.y)));
  const maxRP = Math.max(...realVsPredData.map((d) => Math.max(d.x, d.y)));

  const qqMin = Math.min(...qqData.map((d) => Math.min(d.x, d.y)));
  const qqMax = Math.max(...qqData.map((d) => Math.max(d.x, d.y)));

  const greenCount = bestModel.assumptions.filter((a) => a.status === 'verde').length;
  const conclusionText =
    `Se evaluaron ${totalEvaluated} modelos (hasta ${maxPredictorsEvaluated} predictores). El modelo ganador (${bestModel.transform === 'log-log' ? `ln(${bestModel.yName})` : bestModel.yName} ~ ${bestModel.predictorDisplayNames.join(' + ')}) alcanza un R² ajustado de ${formatNumberES(bestModel.adjR2, 3)}, VIF máximo de ${formatNumberES(bestModel.maxVif, 2)} y aprueba ${greenCount} de ${bestModel.assumptions.length} supuestos estadísticos en semáforo verde.`;

  const renderStatusLabel = (status: 'verde' | 'amarillo' | 'rojo') => {
    if (status === 'verde') {
      return <span className="text-xs font-semibold text-emerald-700">VERDE · Cumple</span>;
    }
    if (status === 'amarillo') {
      return <span className="text-xs font-semibold text-amber-700">AMARILLO · Precaución</span>;
    }
    return <span className="text-xs font-semibold text-[#e34948]">ROJO · Alerta</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">6. Selección del mejor modelo y supuestos</h1>
        <p className="text-sm text-slate-600 mt-1">
          {selectionMethod === 'stepwise'
            ? `Selección stepwise hacia atrás por mínimos cuadrados (OLS), ${isKFold ? 'validación cruzada 10-fold (semilla 42)' : 'validación cruzada LOOCV'} y diagnóstico completo.`
            : `Evaluación exhaustiva por mínimos cuadrados (OLS) hasta ${maxPredictorsEvaluated} predictores, ${isKFold ? 'validación cruzada 10-fold (semilla 42)' : 'validación cruzada LOOCV'} y diagnóstico completo.`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">R² ajustado</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#2a78d6] mt-1">
            {formatNumberES(bestModel.adjR2, 3)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">p-value F global</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatPValueES(bestModel.fPValue)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">VIF máximo</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatNumberES(bestModel.maxVif, 2)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">{cvLongLabel}</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatNumberES(bestModel.loocvRmse, 3)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Modelos evaluados</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {totalEvaluated}
          </div>
        </div>
      </div>

      {/* Method explanation + Stepwise trace */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          Método de búsqueda y validación:{' '}
          <span className="text-[#2a78d6]">
            {selectionMethod === 'stepwise' ? 'Stepwise hacia atrás' : 'Búsqueda exhaustiva'} ·{' '}
            {isKFold ? 'Validación cruzada 10-fold (n > 500, semilla 42)' : 'LOOCV (n ≤ 500)'}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">{selectionMethodReason}</p>
        {stepwiseRemovedLog && stepwiseRemovedLog.length > 0 && (
          <details className="text-xs text-slate-700 pt-1">
            <summary className="cursor-pointer font-medium text-[#2a78d6] hover:underline">
              Ver bitácora de eliminación stepwise ({stepwiseRemovedLog.length} pasos)
            </summary>
            <ul className="mt-2 space-y-1 list-disc list-inside text-slate-600">
              {stepwiseRemovedLog.map((entry, idx) => (
                <li key={idx}>{entry}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Winner explanation */}
      <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#2a78d6]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Criterio automático de selección: por qué ganó este modelo</span>
        </div>
        <p className="text-sm text-slate-800 leading-relaxed">{selectionExplanation}</p>
      </div>

      {/* Sortable Comparison Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Tabla comparativa de modelos candidatos
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Orden estricto: (1) p &lt; 0,05 · (2) VIF &lt; 5 · (3) menor AIC en misma Y · (4) mayor R² ajustado
            </p>
          </div>
        </div>
        <div className="max-h-96 overflow-auto table-scroll">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Estado</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Escala</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Predictores</th>
                <th
                  onClick={() => toggleSort('adjR2', false)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    R² aj. <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th
                  onClick={() => toggleSort('r2', false)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  R²
                </th>
                <th
                  onClick={() => toggleSort('rmse', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  RMSE
                </th>
                <th
                  onClick={() => toggleSort('loocvRmse', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  {cvShortLabel}
                </th>
                <th
                  onClick={() => toggleSort('aic', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  AIC
                </th>
                <th
                  onClick={() => toggleSort('bic', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  BIC
                </th>
                <th
                  onClick={() => toggleSort('maxP', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  p máx.
                </th>
                <th
                  onClick={() => toggleSort('maxVif', true)}
                  className="px-3 py-2.5 text-right font-semibold text-slate-600 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                >
                  VIF máx.
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedModels.map((m: RegressionModelResult) => {
                const isWinner = m.id === bestModel.id;
                return (
                  <tr
                    key={m.id}
                    className={isWinner ? 'bg-blue-50/70 font-medium' : 'hover:bg-slate-50'}
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {isWinner ? (
                        <span className="text-[#2a78d6] font-bold">Elegido</span>
                      ) : (
                        <span className="text-slate-400">#{m.selectionScoreRank}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{m.transform}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-900">
                      {m.predictorDisplayNames.join(' + ')}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                      {formatNumberES(m.adjR2, 3)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(m.r2, 3)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(m.rmse, 3)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(m.loocvRmse, 3)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(m.aic, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(m.bic, 1)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        m.maxPValuePredictors < 0.05 ? 'text-[#2a78d6]' : 'text-[#e34948]'
                      }`}
                    >
                      {formatPValueES(m.maxPValuePredictors)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        m.maxVif < 5 ? 'text-slate-700' : 'text-[#e34948]'
                      }`}
                    >
                      {formatNumberES(m.maxVif, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assumption Checks */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Validación de supuestos del modelo elegido (semáforo)
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          {bestModel.assumptions.map((a) => (
            <div
              key={a.id}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-slate-900">
                  {a.name}{' '}
                  <span className="font-normal text-xs text-slate-500">· {a.testName}</span>
                </div>
                <p className="text-xs text-slate-600">{a.summary}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="font-mono text-xs tabular-nums text-slate-700">
                  {a.statisticLabel} ={' '}
                  {a.id === 'influential'
                    ? formatIntegerES(a.statisticValue)
                    : formatNumberES(a.statisticValue, 3)}
                  {a.pValue !== undefined ? ` (p = ${formatPValueES(a.pValue)})` : ''}
                </span>
                {renderStatusLabel(a.status)}
              </div>
            </div>
          ))}
        </div>

        {/* Influential re-estimation */}
        {bestModel.reestimatedWithoutInfluential && (
          <div className="p-5 border-t border-slate-200 bg-amber-50/40 space-y-3">
            <div className="text-xs font-semibold text-amber-900">
              Sensibilidad ante observaciones influyentes (Cook &gt; 4/n:{' '}
              {bestModel.influentialRows.map((r) => r.rowLabel).join(', ')})
            </div>
            <p className="text-xs text-slate-700">
              Reestimando sin esas {bestModel.influentialRows.length} observación(es) (n ={' '}
              {bestModel.reestimatedWithoutInfluential.nRemaining}, R² ajustado ={' '}
              {formatNumberES(bestModel.reestimatedWithoutInfluential.adjR2, 3)}):
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-amber-200">
                    <th className="py-1.5 text-left font-semibold text-slate-700">Coeficiente</th>
                    <th className="py-1.5 text-right font-semibold text-slate-700">Original</th>
                    <th className="py-1.5 text-right font-semibold text-slate-700">Sin influyentes</th>
                    <th className="py-1.5 text-right font-semibold text-slate-700">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {bestModel.reestimatedWithoutInfluential.coefficients.map((c) => (
                    <tr key={c.name} className="border-b border-amber-100/80">
                      <td className="py-1.5 font-mono text-slate-800">{c.name}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatNumberES(c.original, 3)}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatNumberES(c.withoutInfluential, 3)}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatSignedPctES(c.pctDiff, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostic Plots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-900 mb-3">
            Real vs. Predicho (escala del modelo)
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" name="Real" domain={[minRP, maxRP]} tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Predicho" domain={[minRP, maxRP]} tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as { x: number; y: number; label: string };
                    return (
                      <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs shadow-sm">
                        <div className="font-semibold">{pt.label}</div>
                        <div className="tabular-nums">Real: {formatNumberES(pt.x, 2)}</div>
                        <div className="tabular-nums text-[#2a78d6]">Pred: {formatNumberES(pt.y, 2)}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={realVsPredData} fill="#2a78d6" />
                <Line
                  data={[
                    { x: minRP, y: minRP },
                    { x: maxRP, y: maxRP },
                  ]}
                  dataKey="y"
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  dot={false}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-900 mb-3">Residuos vs. Ajustados</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" name="Ajustado" tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Residuo" tick={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 4" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as { x: number; y: number; label: string };
                    return (
                      <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs shadow-sm">
                        <div className="font-semibold">{pt.label}</div>
                        <div className="tabular-nums">Ajustado: {formatNumberES(pt.x, 2)}</div>
                        <div className="tabular-nums">Residuo: {formatNumberES(pt.y, 3)}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={residVsFittedData} fill="#2a78d6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-900 mb-3">Gráfico Q-Q de residuos</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" name="Cuantil teórico" domain={[qqMin, qqMax]} tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Residuo est." domain={[qqMin, qqMax]} tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as { x: number; y: number; label: string };
                    return (
                      <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs shadow-sm">
                        <div className="font-semibold">{pt.label}</div>
                        <div className="tabular-nums">Teórico: {formatNumberES(pt.x, 2)}</div>
                        <div className="tabular-nums">Empírico: {formatNumberES(pt.y, 2)}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={qqData} fill="#2a78d6" />
                <ReferenceLine
                  segment={[
                    { x: qqMin, y: qqMin },
                    { x: qqMax, y: qqMax },
                  ]}
                  stroke="#e34948"
                  strokeDasharray="4 4"
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <ConclusionBanner stepNumber={6} text={conclusionText} />

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
          <span>Continuar a Fórmula y brechas</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
