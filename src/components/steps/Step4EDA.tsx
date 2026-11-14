import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildHistogram, computeCorrelationMatrix, generateBusinessRules } from '../../engine/eda';
import { DerivedVariableAlert, DescriptiveStat } from '../../types/regression';
import { formatNumberES } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step4EDAProps {
  rows: Record<string, unknown>[];
  rowLabels: string[];
  numericColumns: string[];
  stats: DescriptiveStat[];
  targetY: string;
  onChangeTargetY: (col: string) => void;
  leakageBlockedForY: Set<string>;
  derivedAlerts?: DerivedVariableAlert[];
  displayNames?: Record<string, string>;
  dateDerivedSourceMap?: Record<string, string>;
  isTargetYBinary?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export const Step4EDA: React.FC<Step4EDAProps> = ({
  rows,
  rowLabels,
  numericColumns,
  stats,
  targetY,
  onChangeTargetY,
  leakageBlockedForY,
  derivedAlerts = [],
  displayNames = {},
  dateDerivedSourceMap = {},
  isTargetYBinary = false,
  onPrev,
  onNext,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman'>('pearson');
  const [histCol, setHistCol] = useState<string>(numericColumns[0] ?? '');
  const otherCols = numericColumns.filter((c) => c !== targetY);
  const [scatterX, setScatterX] = useState<string>(otherCols[0] ?? numericColumns[0] ?? '');

  const activeHistCol = numericColumns.includes(histCol) ? histCol : (numericColumns[0] ?? '');
  const activeScatterX = otherCols.includes(scatterX) ? scatterX : (otherCols[0] ?? targetY);

  const histData = useMemo(() => buildHistogram(rows, activeHistCol), [rows, activeHistCol]);

  const scatterData = useMemo(() => {
    return rows
      .map((r, i) => ({
        x: Number(r[activeScatterX]),
        y: Number(r[targetY]),
        label: rowLabels[i] ?? `Fila ${i + 1}`,
      }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  }, [rows, rowLabels, activeScatterX, targetY]);

  const corrMatrix = useMemo(
    () => computeCorrelationMatrix(rows, numericColumns, corrMethod),
    [rows, numericColumns, corrMethod]
  );

  const highCollinearPairs = useMemo(() => {
    const pairs: { a: string; b: string; r: number }[] = [];
    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const val = corrMatrix[i]?.[j] ?? 0;
        if (Math.abs(val) > 0.8) {
          pairs.push({ a: numericColumns[i], b: numericColumns[j], r: val });
        }
      }
    }
    return pairs;
  }, [corrMatrix, numericColumns]);

  const skewedCols = useMemo(
    () => stats.filter((s) => Math.abs(s.skewness) > 1),
    [stats]
  );

  const businessRules = useMemo(
    () =>
      generateBusinessRules(
        rows,
        numericColumns,
        targetY,
        leakageBlockedForY,
        derivedAlerts,
        displayNames,
        dateDerivedSourceMap
      ),
    [rows, numericColumns, targetY, leakageBlockedForY, derivedAlerts, displayNames, dateDerivedSourceMap]
  );

  const topRule = businessRules[0];
  const conclusionText =
    `El análisis exploratorio muestra ${skewedCols.length} variable(s) con asimetría elevada (> 1), por lo que conviene evaluar transformaciones logarítmicas. ` +
    (topRule
      ? `La relación más fuerte detectada corresponde a "${topRule.variable}" vs "${topRule.target}" (r = ${formatNumberES(topRule.r, 2)}). `
      : '') +
    (highCollinearPairs.length > 0
      ? `Se detectaron ${highCollinearPairs.length} pares con correlación |r| > 0,8 que se vigilarán mediante VIF en el modelado.`
      : 'No se observan pares con correlación extrema |r| > 0,8.');

  const getCellStyle = (val: number, isDiag: boolean): React.CSSProperties => {
    if (isDiag) return { backgroundColor: '#f1f5f9', color: '#475569' };
    const intensity = Math.min(1, Math.abs(val));
    const alpha = 0.08 + intensity * 0.42;
    if (val >= 0) {
      return {
        backgroundColor: `rgba(42, 120, 214, ${alpha.toFixed(2)})`,
        color: intensity > 0.65 ? '#ffffff' : '#0f172a',
      };
    }
    return {
      backgroundColor: `rgba(227, 73, 72, ${alpha.toFixed(2)})`,
      color: intensity > 0.65 ? '#ffffff' : '#0f172a',
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">4. Análisis exploratorio (EDA)</h1>
          <p className="text-sm text-slate-600 mt-1">
            Estadísticos descriptivos, distribuciones, dispersión frente a Y, matriz de correlaciones y reglas de negocio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="eda-y-select" className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Variable Y vista previa:
          </label>
          <select
            id="eda-y-select"
            value={targetY}
            onChange={(e) => onChangeTargetY(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white font-medium text-slate-800"
          >
            {numericColumns.map((c) => (
              <option key={c} value={c}>
                {fn(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isTargetYBinary && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2.5 text-sm font-medium text-[#e34948]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Y es binaria: se recomienda regresión logística; los resultados de la regresión lineal pueden no ser válidos
          </span>
        </div>
      )}

      {/* Alerts */}
      {(highCollinearPairs.length > 0 || skewedCols.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {highCollinearPairs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Alerta de multicolinealidad potencial (|r| &gt; 0,8)</span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {highCollinearPairs.map((p) => (
                  <li key={`${p.a}-${p.b}`}>
                    <span className="font-mono font-medium">{p.a}</span> y{' '}
                    <span className="font-mono font-medium">{p.b}</span>: r ={' '}
                    <span className="font-mono font-semibold">{formatNumberES(p.r, 2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skewedCols.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#2a78d6]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Asimetría alta (&gt; 1): sugerencia de logaritmo</span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {skewedCols.map((s) => (
                  <li key={s.column}>
                    <span className="font-mono font-medium">{s.column}</span> (asimetría ={' '}
                    <span className="font-mono">{formatNumberES(s.skewness, 2)}</span>)
                    {s.isAllPositive
                      ? ' · Todos positivos: apta para transformación ln(x).'
                      : ' · Contiene valores ≤ 0: mantener lineal.'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Descriptive table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Tabla descriptiva de variables numéricas</h2>
        </div>
        <div className="max-h-72 overflow-auto table-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Variable</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Media</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Desv. estándar</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Mínimo</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Mediana</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Máximo</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Asimetría</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((s) => (
                <tr key={s.column} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-900">
                    {fn(s.column)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(s.mean, 2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(s.sd, 2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(s.min, 2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(s.median, 2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(s.max, 2)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                      Math.abs(s.skewness) > 1 ? 'text-[#2a78d6] font-semibold' : 'text-slate-700'
                    }`}
                  >
                    {formatNumberES(s.skewness, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Histogram & Scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Histograma por variable</h2>
            <select
              value={activeHistCol}
              onChange={(e) => setHistCol(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white"
            >
              {numericColumns.map((c) => (
                <option key={c} value={c}>
                  {fn(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={48} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: unknown) => [`${v} filas`, 'Frecuencia']}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
                />
                <Bar dataKey="count" fill="#2a78d6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Dispersión frente a {fn(targetY)}</h2>
            <select
              value={activeScatterX}
              onChange={(e) => setScatterX(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white"
            >
              {otherCols.map((c) => (
                <option key={c} value={c}>
                  {fn(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" name={activeScatterX} tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name={targetY} tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as { x: number; y: number; label: string };
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-xs">
                        <div className="font-semibold text-slate-900">{pt.label}</div>
                        <div className="text-slate-600 mt-0.5 tabular-nums">
                          {activeScatterX}: {formatNumberES(pt.x, 2)}
                        </div>
                        <div className="text-[#2a78d6] font-medium tabular-nums">
                          {targetY}: {formatNumberES(pt.y, 2)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#2a78d6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Correlation Heatmap */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Mapa de calor de correlaciones</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Azul (#2a78d6): relación positiva · Rojo (#e34948): relación negativa
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setCorrMethod('pearson')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                corrMethod === 'pearson'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pearson
            </button>
            <button
              type="button"
              onClick={() => setCorrMethod('spearman')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                corrMethod === 'spearman'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Spearman
            </button>
          </div>
        </div>

        <div className="overflow-x-auto table-scroll">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="p-2 text-left font-semibold text-slate-600 border border-slate-200 bg-slate-50">
                  Variable
                </th>
                {numericColumns.map((col) => (
                  <th
                    key={col}
                    className="p-2 text-center font-mono font-semibold text-slate-700 border border-slate-200 bg-slate-50 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numericColumns.map((rowCol, i) => (
                <tr key={rowCol}>
                  <td className="p-2 font-mono font-semibold text-slate-700 border border-slate-200 bg-slate-50 whitespace-nowrap">
                    {rowCol}
                  </td>
                  {numericColumns.map((colCol, j) => {
                    const val = corrMatrix[i]?.[j] ?? 0;
                    return (
                      <td
                        key={colCol}
                        style={getCellStyle(val, i === j)}
                        className="p-2 text-center font-mono tabular-nums border border-slate-200"
                      >
                        {formatNumberES(val, 2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Business Rules */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          Reglas de negocio detectadas automáticamente
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Ordenadas de mayor a menor fuerza de asociación |r|</p>
        <ol className="mt-3 space-y-2 list-decimal list-inside text-sm text-slate-800">
          {businessRules.map((rule, idx) => (
            <li key={idx} className="leading-relaxed">
              <span className={rule.r >= 0 ? 'text-slate-900' : 'text-slate-900'}>
                {rule.text}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
          Nota: correlación no implica causalidad. La dirección y magnitud definitiva de cada efecto se evalúa en el modelo de regresión múltiple controlando por las demás variables.
        </p>
      </div>

      <ConclusionBanner stepNumber={4} text={conclusionText} />

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
          <span>Continuar a Variables del modelo</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
