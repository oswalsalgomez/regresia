import React from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';
import { CandidateXInfo, VariableControlType } from '../../types/regression';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step5VariablesProps {
  numericColumns: string[];
  targetY: string;
  targetYReason: string;
  onChangeTargetY: (col: string) => void;
  candidatesX: CandidateXInfo[];
  selectedX: string[];
  onToggleX: (name: string) => void;
  onChangeControlType: (name: string, controlType: VariableControlType) => void;
  tryLogTransform: boolean;
  onToggleLogTransform: (val: boolean) => void;
  canLogTransformY: boolean;
  isTargetYBinary?: boolean;
  displayNames?: Record<string, string>;
  onPrev: () => void;
  onNext: () => void;
}

export const Step5Variables: React.FC<Step5VariablesProps> = ({
  numericColumns,
  targetY,
  targetYReason,
  onChangeTargetY,
  candidatesX,
  selectedX,
  onToggleX,
  onChangeControlType,
  tryLogTransform,
  onToggleLogTransform,
  canLogTransformY,
  isTargetYBinary = false,
  displayNames = {},
  onPrev,
  onNext,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const blockedCount = candidatesX.filter((c) => c.blockedByLeakage).length;
  const externalCount = candidatesX.filter(
    (c) => selectedX.includes(c.name) && c.controlType === 'external'
  ).length;
  const controllableCount = selectedX.length - externalCount;

  const conclusionText =
    `Se definió "${fn(targetY)}" como variable dependiente (Y) y ${selectedX.length} variable(s) independiente(s) candidatas (${controllableCount} controlable(s) y ${externalCount} externa(s) / de contexto)` +
    (blockedCount > 0 ? `, excluyendo ${blockedCount} por riesgo de fuga de información` : '') +
    `. ${tryLogTransform && canLogTransformY ? 'Se probarán modelos tanto en escala lineal como log-log.' : 'La búsqueda se realizará en escala lineal.'}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">5. Selección de variables del modelo</h1>
        <p className="text-sm text-slate-600 mt-1">
          Confirma la variable objetivo (Y), las variables explicativas candidatas (X), su tipo (controlable o externa) y si deseas evaluar transformaciones logarítmicas.
        </p>
      </div>

      {/* Y selection */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Variable dependiente (Y)</h2>
            <p className="text-xs text-slate-500 mt-0.5">{targetYReason}</p>
          </div>
          <select
            value={targetY}
            onChange={(e) => onChangeTargetY(e.target.value)}
            className="px-3.5 py-2 text-sm font-medium border border-slate-300 rounded-lg bg-white text-slate-900"
          >
            {numericColumns.map((col) => (
              <option key={col} value={col}>
                {fn(col)}
              </option>
            ))}
          </select>
        </div>

        {isTargetYBinary && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2.5 text-xs sm:text-sm font-medium text-[#e34948]">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              Y es binaria: se recomienda regresión logística; los resultados de la regresión lineal pueden no ser válidos
            </span>
          </div>
        )}
      </div>

      {/* Log-log toggle */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Probar transformaciones logarítmicas (log-log)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {canLogTransformY
              ? 'Activado por defecto cuando existen variables con asimetría > 1 y valores estrictamente positivos (> 0). Permite estimar elasticidades.'
              : `No disponible porque ${fn(targetY)} contiene valores menores o iguales a cero.`}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            disabled={!canLogTransformY}
            checked={tryLogTransform && canLogTransformY}
            onChange={(e) => onToggleLogTransform(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-[#2a78d6]"
          />
          <span className="text-sm font-medium text-slate-800">
            {tryLogTransform && canLogTransformY ? 'Activado' : 'Desactivado'}
          </span>
        </label>
      </div>

      {/* Candidate X table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Variables explicativas candidatas (X)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Todas las numéricas y dummies excepto Y, identificadores y variables con fuga de información
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            {selectedX.length} seleccionada(s)
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {candidatesX.map((cand) => {
            const isChecked = selectedX.includes(cand.name);
            return (
              <div
                key={cand.name}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 transition-colors ${
                  cand.blockedByLeakage ? 'bg-red-50/50' : 'hover:bg-slate-50'
                }`}
              >
                <label
                  className={`flex items-start gap-3.5 flex-1 min-w-0 ${
                    cand.blockedByLeakage ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={cand.blockedByLeakage}
                    checked={isChecked}
                    onChange={() => onToggleX(cand.name)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#2a78d6] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {fn(cand.name)}
                      </span>
                      {fn(cand.name) !== cand.name && (
                        <span className="font-mono text-xs text-slate-400">({cand.name})</span>
                      )}
                      {cand.isDummy && (
                        <span className="text-xs text-slate-500">· Dummy</span>
                      )}
                      {cand.isBinary && !cand.isDummy && (
                        <span className="text-xs text-[#2a78d6]">· Binaria (0/1)</span>
                      )}
                      {cand.isDateFeature && (
                        <span className="text-xs text-[#2a78d6]">· Derivada de fecha</span>
                      )}
                      {cand.blockedByLeakage && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#e34948]">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Bloqueada por fuga de información
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{cand.reason}</p>
                  </div>
                </label>

                {!cand.blockedByLeakage && (
                  <div className="flex items-center gap-2 sm:pl-4 shrink-0">
                    <label
                      htmlFor={`ctrl-${cand.name}`}
                      className="text-xs text-slate-500 whitespace-nowrap"
                    >
                      Tipo de variable:
                    </label>
                    <select
                      id={`ctrl-${cand.name}`}
                      value={cand.controlType}
                      onChange={(e) =>
                        onChangeControlType(cand.name, e.target.value as VariableControlType)
                      }
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
                    >
                      <option value="external">Externa / de contexto</option>
                      <option value="controllable">Controlable por la empresa</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedX.length === 0 && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-[#e34948]">
          Selecciona al menos una variable independiente (X) para estimar los modelos.
        </div>
      )}

      <ConclusionBanner stepNumber={5} text={conclusionText} />

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
          disabled={selectedX.length === 0}
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          <span>Estimar y seleccionar mejor modelo</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
