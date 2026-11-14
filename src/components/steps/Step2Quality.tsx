import React from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { DataQualityReport, ImputationMethod } from '../../types/regression';
import { formatNumberES } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step2QualityProps {
  quality: DataQualityReport;
  methodOverrides: Record<string, ImputationMethod>;
  onChangeMethod: (column: string, method: ImputationMethod) => void;
  removeDuplicates: boolean;
  onToggleRemoveDuplicates: (val: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
}

const METHOD_LABELS: Record<ImputationMethod, string> = {
  none: 'No aplica',
  median: 'Mediana',
  mean: 'Media',
  mode: 'Moda',
  drop_rows: 'Eliminar filas',
  drop_column: 'Eliminar columna (>30 %)',
};

export const Step2Quality: React.FC<Step2QualityProps> = ({
  quality,
  methodOverrides,
  onChangeMethod,
  removeDuplicates,
  onToggleRemoveDuplicates,
  onPrev,
  onNext,
}) => {
  const conclusionText = !quality.hasAnyMissing
    ? `Sin datos faltantes: no se requiere imputación. Se revisaron ${quality.totalRows} filas (${quality.duplicateCount} duplicadas) y se detectaron ${quality.outliers.length} valores atípicos por regla IQR (1,5×), los cuales se conservan sin eliminación automática para evaluar su influencia real en el modelo.`
    : `Se detectaron datos faltantes y se aplicó la estrategia configurada, dejando ${quality.cleanedRows.length} filas listas para tipado. Además se identificaron ${quality.duplicateCount} duplicados y ${quality.outliers.length} valores atípicos por IQR (1,5×) que permanecen en la muestra.`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">2. Calidad de datos</h1>
        <p className="text-sm text-slate-600 mt-1">
          Auditoría de valores faltantes, registros duplicados y detección de atípicos mediante rango intercuartílico (IQR 1,5×).
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Filas resultantes</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {quality.cleanedRows.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Columnas con faltantes</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#2a78d6] mt-1">
            {quality.missingSummary.filter((m) => m.missingCount > 0).length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Filas duplicadas</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              quality.duplicateCount > 0 ? 'text-[#e34948]' : 'text-slate-900'
            }`}
          >
            {quality.duplicateCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Valores atípicos (IQR 1,5×)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 mt-1">
            {quality.outliers.length}
          </div>
        </div>
      </div>

      {/* Missing Values Section */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Análisis de valores faltantes e imputación
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sugerencia automática: mediana (numérica), moda (categórica) o eliminar columna si supera 30 %
            </p>
          </div>
          {!quality.hasAnyMissing && (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>Sin datos faltantes: no se requiere imputación</span>
            </div>
          )}
        </div>

        <div className="max-h-72 overflow-auto table-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Columna</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Faltantes</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">%</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Sugerido</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Método aplicado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quality.missingSummary.map((m) => (
                <tr key={m.column} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-900">{m.column}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {m.missingCount}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                      m.missingPct > 30 ? 'text-[#e34948] font-semibold' : 'text-slate-700'
                    }`}
                  >
                    {formatNumberES(m.missingPct, 1)} %
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {METHOD_LABELS[m.suggestedMethod]}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.missingCount === 0 ? (
                      <span className="text-xs text-slate-400">Sin faltantes</span>
                    ) : (
                      <select
                        value={methodOverrides[m.column] ?? m.selectedMethod}
                        onChange={(e) =>
                          onChangeMethod(m.column, e.target.value as ImputationMethod)
                        }
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white"
                      >
                        {m.inferredKind === 'numeric' && (
                          <>
                            <option value="median">Mediana (sugerido)</option>
                            <option value="mean">Media</option>
                          </>
                        )}
                        {m.inferredKind === 'categorical' && (
                          <option value="mode">Moda (sugerido)</option>
                        )}
                        <option value="drop_rows">Eliminar filas</option>
                        <option value="drop_column">Eliminar columna</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Duplicates */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-800">
            <span className="font-semibold">Filas duplicadas exactas:</span>{' '}
            <span className="font-mono tabular-nums">{quality.duplicateCount}</span>
          </div>
        </div>
        {quality.duplicateCount > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={removeDuplicates}
              onChange={(e) => onToggleRemoveDuplicates(e.target.checked)}
              className="rounded border-slate-300 text-[#2a78d6]"
            />
            <span>Eliminar filas duplicadas automáticamente</span>
          </label>
        )}
      </div>

      {/* Outliers Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Detección de valores atípicos (IQR 1,5×)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Se informan para transparencia diagnóstica; no se eliminan automáticamente
            </p>
          </div>
        </div>

        {quality.outliers.length === 0 ? (
          <div className="p-5 text-sm text-slate-600">
            No se encontraron valores atípicos fuera de los límites [Q1 − 1,5·IQR, Q3 + 1,5·IQR].
          </div>
        ) : (
          <div className="max-h-72 overflow-auto table-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Fila</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Etiqueta</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Variable</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Valor</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Límite inferior</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Límite superior</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Extremo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quality.outliers.map((o, i) => (
                  <tr key={`${o.rowIndex}-${o.column}-${i}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono tabular-nums text-slate-600">#{o.rowIndex}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{o.rowLabel}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{o.column}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-[#e34948]">
                      {formatNumberES(o.value, 2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                      {formatNumberES(o.lowerFence, 2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                      {formatNumberES(o.upperFence, 2)}
                    </td>
                    <td className="px-4 py-2 text-xs text-amber-700 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Atípico {o.side}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConclusionBanner stepNumber={2} text={conclusionText} />

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
          <span>Continuar a Tipos de variables</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
