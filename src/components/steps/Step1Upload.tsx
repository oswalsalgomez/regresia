import React, { useRef, useState } from 'react';
import { ArrowRight, Database, FileSpreadsheet, Upload } from 'lucide-react';
import { ColumnMapping } from '../../types/regression';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step1UploadProps {
  businessQuestion: string;
  onChangeBusinessQuestion: (val: string) => void;
  yUnit: string;
  onChangeYUnit: (val: string) => void;
  entitySingular: string;
  entityPlural: string;
  onChangeEntitySingular: (val: string) => void;
  fileName: string | null;
  delimiterUsed?: string;
  sheetNames?: string[];
  selectedSheet?: string;
  onSelectSheet: (sheetName: string) => void;
  mappings: ColumnMapping[];
  displayNameOverrides: Record<string, string>;
  onChangeDisplayName: (normalized: string, displayName: string) => void;
  rows: Record<string, unknown>[];
  onUploadFile: (file: File) => Promise<void>;
  onLoadSample: () => void;
  onNext: () => void;
}

export const Step1Upload: React.FC<Step1UploadProps> = ({
  businessQuestion,
  onChangeBusinessQuestion,
  yUnit,
  onChangeYUnit,
  entitySingular,
  entityPlural,
  onChangeEntitySingular,
  fileName,
  delimiterUsed,
  sheetNames,
  selectedSheet,
  onSelectSheet,
  mappings,
  displayNameOverrides,
  onChangeDisplayName,
  rows,
  onUploadFile,
  onLoadSample,
  onNext,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      await onUploadFile(file);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo leer el archivo seleccionado.');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = rows.length >= 5 && mappings.length >= 2 && businessQuestion.trim().length > 0;
  const previewRows = rows.slice(0, 5);
  const cols = mappings.map((m) => m.normalized);

  const conclusionText =
    rows.length > 0
      ? `Se cargó "${fileName}" con ${rows.length} observaciones y ${mappings.length} columnas normalizadas${delimiterUsed ? ` (delimitador detectado: ${delimiterUsed})` : ''}. La pregunta de negocio orientará la selección automática de la variable objetivo.`
      : 'Carga un archivo CSV, TXT o Excel, o pulsa "Usar datos de ejemplo" para iniciar el análisis con el caso de ventas de computadores en Europa.';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">1. Carga de datos y contexto</h1>
          <p className="text-sm text-slate-600 mt-1">
            Importa tu tabla en formato CSV, TXT o Excel y define la pregunta clave del negocio.
          </p>
        </div>
        <button
          type="button"
          onClick={onLoadSample}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#2a78d6] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
        >
          <Database className="w-4 h-4" />
          <span>Usar datos de ejemplo</span>
        </button>
      </div>

      {/* Business Question, Entity Noun & Unit */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-6">
            <label htmlFor="business-question" className="block text-sm font-medium text-slate-800 mb-1.5">
              Pregunta de negocio <span className="text-[#e34948]">*</span>
            </label>
            <input
              id="business-question"
              type="text"
              value={businessQuestion}
              onChange={(e) => onChangeBusinessQuestion(e.target.value)}
              placeholder="Ej.: ¿Qué factores explican las ventas de computadores en Europa y en qué mercados conviene invertir?"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/30 focus:border-[#2a78d6]"
            />
            {businessQuestion.trim().length === 0 && (
              <p className="text-xs text-[#e34948] mt-1">
                Este campo es obligatorio para orientar el modelo y el informe.
              </p>
            )}
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="entity-singular" className="block text-sm font-medium text-slate-800 mb-1.5">
              ¿Qué representa cada fila?
            </label>
            <input
              id="entity-singular"
              type="text"
              value={entitySingular}
              onChange={(e) => onChangeEntitySingular(e.target.value)}
              placeholder="Ej.: país, tienda, cliente, producto"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/30 focus:border-[#2a78d6]"
            />
            <p className="text-xs text-slate-500 mt-1">
              Plural usado en textos: <span className="font-medium text-slate-700">{entityPlural}</span>
            </p>
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="y-unit" className="block text-sm font-medium text-slate-800 mb-1.5">
              Unidad de medida de Y (opcional)
            </label>
            <input
              id="y-unit"
              type="text"
              value={yUnit}
              onChange={(e) => onChangeYUnit(e.target.value)}
              placeholder="Ej.: unidades, USD, miles de €"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/30 focus:border-[#2a78d6]"
            />
          </div>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          void handleFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragging
            ? 'border-[#2a78d6] bg-blue-50/50'
            : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <div className="mx-auto w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 mb-3">
          <Upload className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-slate-900">
          {loading
            ? 'Procesando archivo...'
            : 'Arrastra aquí tu archivo (.csv, .txt, .xlsx, .xls) o haz clic para seleccionarlo'}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Detección automática de delimitador (coma, punto y coma o tabulación) y selector de hojas para Excel.
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-[#e34948]">
          {errorMsg}
        </div>
      )}

      {/* Excel Sheet selector */}
      {sheetNames && sheetNames.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="w-4 h-4 text-[#2a78d6]" />
          <label htmlFor="sheet-select" className="text-sm font-medium text-slate-800">
            Hoja de cálculo seleccionada:
          </label>
          <select
            id="sheet-select"
            value={selectedSheet}
            onChange={(e) => onSelectSheet(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
          >
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Filas (observaciones)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {rows.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Columnas</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {mappings.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Dimensiones</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#2a78d6] mt-1">
                {rows.length} × {mappings.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Formato detectado</div>
              <div className="text-sm font-semibold text-slate-800 mt-2 truncate">
                {delimiterUsed || (selectedSheet ? `Excel (${selectedSheet})` : 'Tabla')}
              </div>
            </div>
          </div>

          {/* Normalization table & Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  Equivalencias y nombres para presentación
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Edita el nombre amigable que se usará en textos, Word y LinkedIn
                </p>
              </div>
              <div className="max-h-72 overflow-auto table-scroll">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                        Original
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                        Normalizado
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                        Nombre para presentación
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mappings.map((m) => (
                      <tr key={m.normalized} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-xs text-slate-700">{m.original}</td>
                        <td className="px-3 py-2 font-mono text-xs text-[#2a78d6]">
                          {m.normalized}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            aria-label={`Nombre para presentación de ${m.normalized}`}
                            value={displayNameOverrides[m.normalized] ?? m.displayName}
                            onChange={(e) => onChangeDisplayName(m.normalized, e.target.value)}
                            className="w-full min-w-[130px] px-2 py-1 text-xs text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-[#2a78d6] focus:border-[#2a78d6]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  Primeras 5 filas del dataset
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Vista previa tras normalización</p>
              </div>
              <div className="overflow-x-auto max-h-72 table-scroll">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr>
                      {cols.map((c) => (
                        <th
                          key={c}
                          className="px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {cols.map((c) => (
                          <td
                            key={c}
                            className="px-3 py-2 text-slate-700 whitespace-nowrap tabular-nums"
                          >
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      <ConclusionBanner stepNumber={1} text={conclusionText} />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canProceed}
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span>Continuar a Calidad de datos</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
