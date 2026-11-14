import React, { useMemo } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildShortEquationText } from '../../generators/linkedinCanvas';
import { RegressionModelResult } from '../../types/regression';
import { buildEntityLabels, EntityLabels } from '../../utils/entityNoun';
import {
  formatIntegerES,
  formatNumberES,
  formatPValueES,
  formatSignedPctES,
  resolveYUnit,
} from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step7FormulaGapProps {
  model: RegressionModelResult;
  yUnit: string;
  displayNames?: Record<string, string>;
  entityLabels?: EntityLabels;
  onPrev: () => void;
  onNext: () => void;
}

export const Step7FormulaGap: React.FC<Step7FormulaGapProps> = ({
  model,
  yUnit,
  displayNames = {},
  entityLabels,
  onPrev,
  onNext,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const ent = entityLabels ?? buildEntityLabels('registro');
  const yFriendly = fn(model.yName);
  const rawUnitLabel = resolveYUnit(yUnit, model.yName);
  const unitLabel = resolveYUnit(yUnit, yFriendly);
  const equationText = buildShortEquationText(model);

  const originalEquationText = useMemo(() => {
    if (model.transform !== 'log-log') return null;
    const b0 = model.coefficients[0].estimate;
    const mult = Math.exp(b0) * model.smearingFactor;
    const terms = model.coefficients
      .slice(1)
      .map((c) =>
        c.isTransformedLog
          ? `${c.name}^(${formatNumberES(c.estimate, 2)})`
          : `exp(${formatNumberES(c.estimate, 2)}·${c.name})`
      );
    return `${model.yName}_potencial = ${formatNumberES(mult, 4)} · ${terms.join(' · ')}`;
  }, [model]);

  const sortedByGap = useMemo(
    () => [...model.rows].sort((a, b) => a.gap - b.gap),
    [model.rows]
  );

  const topNeg = sortedByGap.filter((r) => r.gap < 0).slice(0, 3);
  const topPos = [...model.rows]
    .sort((a, b) => b.gap - a.gap)
    .filter((r) => r.gap > 0)
    .slice(0, 2);

  const conclusionText =
    (topNeg.length > 0
      ? `Las mayores oportunidades sin capturar (brecha negativa en ${unitLabel}) están en ${topNeg.map((r) => `${r.rowLabel} (${formatIntegerES(r.gap)})`).join(', ')}. `
      : `No se observan ${ent.plural} con brecha negativa pronunciada. `) +
    (topPos.length > 0
      ? `En contraste, superan su potencial teórico: ${topPos.map((r) => `${r.rowLabel} (+${formatIntegerES(r.gap)})`).join(', ')}.`
      : '');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">7. Fórmula, interpretación y brechas</h1>
        <p className="text-sm text-slate-600 mt-1">
          Ecuación estimada, elasticidades o pendientes, y comparación entre el valor real y el potencial predicho por el modelo.
        </p>
      </div>

      {/* Large Equation Box */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Ecuación del modelo seleccionado
        </div>
        <div className="font-mono text-xl sm:text-2xl font-bold text-slate-900 break-words">
          {equationText}
        </div>
        {originalEquationText && (
          <div className="pt-3 border-t border-slate-100 space-y-1">
            <div className="text-xs font-medium text-slate-500">
              Equivalente en unidades originales (incluyendo factor smearing de Duan ={' '}
              <span className="font-mono">{formatNumberES(model.smearingFactor, 4)}</span>):
            </div>
            <div className="font-mono text-sm text-[#2a78d6] break-words">
              {originalEquationText}
            </div>
          </div>
        )}
      </div>

      {/* Coefficients Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Tabla de coeficientes e intervalos de confianza (95 %)</h2>
        </div>
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Término</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Valor (β)</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Error est.</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">IC 95 % inf.</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">IC 95 % sup.</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">p-value</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Beta est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {model.coefficients.map((c) => (
                <tr key={c.name} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-900">
                    {c.isTransformedLog ? `ln(${c.name})` : c.name}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-nums font-semibold ${
                      c.estimate >= 0 ? 'text-[#2a78d6]' : 'text-[#e34948]'
                    }`}
                  >
                    {formatNumberES(c.estimate, 4)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {formatNumberES(c.stdError, 4)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                    {formatNumberES(c.ciLower, 3)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                    {formatNumberES(c.ciUpper, 3)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                    {formatPValueES(c.pValue)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {c.standardizedBeta !== null ? formatNumberES(c.standardizedBeta, 3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Automatic interpretation list */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/70 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Interpretación automática de efectos
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-800">
            {model.coefficients
              .filter((c) => !c.isIntercept)
              .map((c) => {
                const text = c.interpretation
                  .split(rawUnitLabel).join(unitLabel)
                  .split(model.yName).join(yFriendly)
                  .split(c.name).join(fn(c.name));
                return (
                  <li key={c.name} className="leading-relaxed">
                    <span className="font-semibold text-slate-900">{fn(c.name)}:</span>{' '}
                    {text}
                  </li>
                );
              })}
          </ul>
        </div>
      </div>

      {/* Horizontal Gap Chart + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Brecha real vs. potencial ({unitLabel})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            Rojo (#e34948): por debajo de su potencial (oportunidad) · Azul (#2a78d6): por encima de su potencial
          </p>
          <div style={{ height: Math.max(320, sortedByGap.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sortedByGap}
                layout="vertical"
                margin={{ top: 6, right: 24, bottom: 6, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="rowLabel" width={105} tick={{ fontSize: 11 }} />
                <ReferenceLine x={0} stroke="#334155" />
                <Tooltip
                  formatter={(v: unknown) => [
                    `${formatIntegerES(Number(v))} ${unitLabel}`,
                    'Brecha (Real − Potencial)',
                  ]}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
                />
                <Bar dataKey="gap" radius={[2, 2, 2, 2]}>
                  {sortedByGap.map((entry) => (
                    <Cell
                      key={entry.rowLabel}
                      fill={entry.gap < 0 ? '#e34948' : '#2a78d6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Detalle de brechas ordenado por oportunidad
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {ent.pluralCap} con mayor brecha negativa en unidades aparecen primero
            </p>
          </div>
          <div className="flex-1 max-h-[540px] overflow-auto table-scroll">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">{ent.singularCap}</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Real</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Potencial</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Brecha</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedByGap.map((r) => (
                  <tr key={r.rowIndex} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{r.rowLabel}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(r.yActual, 1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                      {formatNumberES(r.yPredicted, 1)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${
                        r.gap < 0 ? 'text-[#e34948]' : 'text-[#2a78d6]'
                      }`}
                    >
                      {r.gap > 0 ? '+' : ''}
                      {formatNumberES(r.gap, 1)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.gapPct < 0 ? 'text-[#e34948]' : 'text-[#2a78d6]'
                      }`}
                    >
                      {formatSignedPctES(r.gapPct, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConclusionBanner stepNumber={7} text={conclusionText} />

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
          <span>Continuar a Simulación de escenarios</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
