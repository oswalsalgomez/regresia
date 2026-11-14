import React from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';
import { VariableTypingResult } from '../../engine/dataPrep';
import { VariableType } from '../../types/regression';
import { formatNumberES } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step3TypesProps {
  typing: VariableTypingResult;
  typeOverrides: Record<string, VariableType>;
  onChangeType: (col: string, type: VariableType) => void;
  entitySingular?: string;
  onPrev: () => void;
  onNext: () => void;
}

export const Step3Types: React.FC<Step3TypesProps> = ({
  typing,
  typeOverrides,
  onChangeType,
  entitySingular = 'registro',
  onPrev,
  onNext,
}) => {
  const numCount = typing.profiles.filter((p) => p.selectedType === 'numeric' && !p.isDateFeature && !p.isBinary).length;
  const binaryCount = typing.profiles.filter((p) => p.selectedType === 'numeric' && p.isBinary).length;
  const dateCount = typing.profiles.filter((p) => p.selectedType === 'date').length;
  const catCount = typing.profiles.filter((p) => p.selectedType === 'categorical').length;
  const idCount = typing.profiles.filter((p) => p.selectedType === 'identifier').length;
  const commaFixedCols = typing.profiles.filter((p) => p.commaDecimalFixedCount > 0);

  const conclusionText =
    `Se clasificaron ${numCount} variables numéricas continuas` +
    (binaryCount > 0 ? `, ${binaryCount} binaria(s) (0/1)` : '') +
    `, ${catCount} categóricas (${typing.dummyColumns.length} dummies generadas)` +
    (dateCount > 0 ? `, ${dateCount} fecha(s) convertida(s) a año, mes y antigüedad en días` : '') +
    ` y ${idCount} identificador(es)` +
    (typing.identifierColumn ? ` ("${typing.identifierColumn}" identificará a cada ${entitySingular})` : '') +
    (typing.derivedAlerts.length > 0
      ? `. Se detectó riesgo de fuga de información en ${typing.derivedAlerts.map((d) => `${d.derivedCol} (${d.formulaText})`).join('; ')}, por lo que se impedirá combinarla con sus componentes en el mismo modelo.`
      : '. No se detectaron variables derivadas con riesgo de fuga de información.');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">3. Tipos de variables y detección de fuga</h1>
        <p className="text-sm text-slate-600 mt-1">
          Clasificación automática en numérica, categórica, fecha o identificador, codificación dummy (≤10 niveles) y detección de relaciones algebraicas exactas.
        </p>
      </div>

      {/* Alerts for Leakage & Comma Decimals */}
      {typing.derivedAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#e34948]">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Alerta: riesgo de fuga de información (variables derivadas detectadas)</span>
          </div>
          <ul className="text-sm text-slate-800 space-y-1 ml-6 list-disc">
            {typing.derivedAlerts.map((alert) => (
              <li key={alert.derivedCol}>
                <span className="font-mono font-semibold">{alert.derivedCol}</span> coincide con{' '}
                <span className="font-mono">
                  {alert.colA} {alert.operation === 'quotient' ? '/' : '×'} {alert.colB}
                </span>{' '}
                (error máx. {formatNumberES(alert.maxRelError, 3)} % &lt; 1 %). La aplicación impedirá que queden juntas en un mismo modelo como Y y X.
              </li>
            ))}
          </ul>
        </div>
      )}

      {commaFixedCols.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-slate-800">
          Se corrigieron números almacenados como texto con coma decimal en:{' '}
          <span className="font-mono font-medium">
            {commaFixedCols.map((c) => `${c.name} (${c.commaDecimalFixedCount} celdas)`).join(', ')}
          </span>
          .
        </div>
      )}

      {/* Variable profiles table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Clasificación de columnas</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Los identificadores no generan dummies y actúan como etiqueta de fila
          </p>
        </div>
        <div className="max-h-96 overflow-auto table-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Columna</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Únicos</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Tipo detectado</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Tipo asignado</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Tratamiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {typing.profiles.map((p) => {
                const isDerived = typing.derivedAlerts.some((d) => d.derivedCol === p.name);
                return (
                  <tr key={p.name} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900">
                      {p.name}
                      {isDerived && (
                        <span className="ml-2 text-[11px] font-sans font-semibold text-[#e34948]">
                          (Derivada)
                        </span>
                      )}
                      {p.isDateFeature && (
                        <span className="ml-2 text-[11px] font-sans font-semibold text-[#2a78d6]">
                          (De fecha)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                      {p.uniqueCount}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {p.detectedType === 'numeric'
                        ? p.isBinary
                          ? 'Binaria (0/1)'
                          : 'Numérica'
                        : p.detectedType === 'identifier'
                          ? 'Identificador'
                          : p.detectedType === 'date'
                            ? 'Fecha'
                            : 'Categórica'}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.isDateFeature ? (
                        <span className="inline-block px-2.5 py-1 text-xs text-slate-700 bg-slate-100 rounded-md">
                          Numérica (auto)
                        </span>
                      ) : (
                        <select
                          value={typeOverrides[p.name] ?? p.selectedType}
                          onChange={(e) => onChangeType(p.name, e.target.value as VariableType)}
                          className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white"
                        >
                          <option value="numeric">{p.isBinary ? 'Binaria (0/1)' : 'Numérica'}</option>
                          <option value="categorical">Categórica</option>
                          <option value="date">Fecha (año, mes, antigüedad)</option>
                          <option value="identifier">Identificador</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {p.selectedType === 'identifier' && `Etiqueta por ${entitySingular} (sin dummies)`}
                      {p.selectedType === 'date' &&
                        `3 variables derivadas: ${p.dateDerivedNames?.join(', ') ?? 'año, mes, antigüedad'}`}
                      {p.selectedType === 'numeric' &&
                        (p.isBinary
                          ? 'Binaria (0/1): pertenecer a categoría 1 frente a 0'
                          : p.isDateFeature
                            ? `Derivada automáticamente de "${p.sourceColumn}"`
                            : 'Escala cuantitativa continua')}
                      {p.selectedType === 'categorical' &&
                        (p.levels && p.levels.length <= 10 && p.levels.length >= 2
                          ? `${p.dummyNames?.length ?? 0} dummy(s) · Ref: "${p.referenceLevel}"`
                          : p.levels && p.levels.length > 10
                            ? `Más de 10 niveles (${p.levels.length}): omitida de dummies`
                            : 'Categoría única')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generated dummies preview */}
      {typing.dummyColumns.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Variables ficticias (dummies) generadas
            </h2>
          </div>
          <div className="max-h-56 overflow-auto table-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Dummy</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Origen</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Nivel (=1)</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Referencia (=0)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {typing.dummyColumns.map((d) => (
                  <tr key={d.name}>
                    <td className="px-4 py-2 font-mono text-xs text-[#2a78d6]">{d.name}</td>
                    <td className="px-4 py-2 text-slate-700">{d.sourceColumn}</td>
                    <td className="px-4 py-2 text-slate-700">{d.level}</td>
                    <td className="px-4 py-2 text-slate-500">{d.referenceLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConclusionBanner stepNumber={3} text={conclusionText} />

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
          <span>Continuar a Análisis exploratorio</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
