import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Code2, Copy, Download, FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import { saveAs } from 'file-saver';
import { toPng } from 'html-to-image';
import jStat from 'jstat';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  downloadModelsComparisonCsv,
  downloadRowGapCsv,
  downloadScenariosCsv,
} from '../../generators/csvExports';
import { drawLinkedInGraphic, generateLinkedInPostText } from '../../generators/linkedinCanvas';
import { generateWordReport, WordChartImages } from '../../generators/wordReport';
import {
  BusinessRule,
  CandidateXInfo,
  ColumnMapping,
  ColumnProfile,
  DataQualityReport,
  DescriptiveStat,
  MonteCarloSummary,
  RegressionModelResult,
  ScenarioOutcome,
  ScenarioRecommendation,
  SensitivityItem,
} from '../../types/regression';
import { formatIntegerES, formatNumberES, formatSignedPctES } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step10DownloadsProps {
  businessQuestion: string;
  yUnit: string;
  fileName: string;
  mappings: ColumnMapping[];
  quality: DataQualityReport;
  profiles: ColumnProfile[];
  stats: DescriptiveStat[];
  rules: BusinessRule[];
  numericColumns: string[];
  corrMatrix: number[][];
  candidatesX: CandidateXInfo[];
  allModels: RegressionModelResult[];
  bestModel: RegressionModelResult;
  selectionExplanation: string;
  selectionMethodReason?: string;
  displayNames?: Record<string, string>;
  entitySingular?: string;
  dummyColumns?: { name: string; sourceColumn: string; level: string; referenceLevel: string }[];
  scenarios: ScenarioOutcome[];
  monteCarlo: MonteCarloSummary;
  sensitivity: SensitivityItem[];
  horizonYears: number;
  recommendations: ScenarioRecommendation[];
  pythonCode: string;
  rCode: string;
  onPrev: () => void;
}

export const Step10Downloads: React.FC<Step10DownloadsProps> = ({
  businessQuestion,
  yUnit,
  fileName,
  mappings,
  quality,
  profiles,
  stats,
  rules,
  numericColumns,
  corrMatrix,
  candidatesX,
  allModels,
  bestModel,
  selectionExplanation,
  selectionMethodReason,
  displayNames = {},
  entitySingular = 'registro',
  dummyColumns = [],
  scenarios,
  monteCarlo,
  sensitivity,
  horizonYears,
  recommendations,
  pythonCode,
  rCode,
  onPrev,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edaChartRef = useRef<HTMLDivElement>(null);
  const diagChartRef = useRef<HTMLDivElement>(null);
  const gapChartRef = useRef<HTMLDivElement>(null);
  const mcChartRef = useRef<HTMLDivElement>(null);
  const tornadoChartRef = useRef<HTMLDivElement>(null);

  const [wordBusy, setWordBusy] = useState(false);
  const [copiedPost, setCopiedPost] = useState(false);
  const [activeCodePreview, setActiveCodePreview] = useState<'none' | 'python' | 'r'>('none');

  const linkedInPost = useMemo(
    () =>
      generateLinkedInPostText(
        businessQuestion,
        bestModel,
        scenarios,
        horizonYears,
        yUnit,
        displayNames,
        entitySingular
      ),
    [businessQuestion, bestModel, scenarios, horizonYears, yUnit, displayNames, entitySingular]
  );

  useEffect(() => {
    if (canvasRef.current) {
      drawLinkedInGraphic(canvasRef.current, bestModel, yUnit, displayNames, dummyColumns);
    }
  }, [bestModel, yUnit, displayNames, dummyColumns]);

  const handleDownloadWord = async () => {
    setWordBusy(true);
    try {
      const capture = async (el: HTMLDivElement | null): Promise<string | undefined> => {
        if (!el) return undefined;
        try {
          return await toPng(el, { backgroundColor: '#ffffff', pixelRatio: 2 });
        } catch {
          return undefined;
        }
      };

      const charts: WordChartImages = {
        edaHeatmap: await capture(edaChartRef.current),
        diagnostics: await capture(diagChartRef.current),
        gapChart: await capture(gapChartRef.current),
        monteCarlo: await capture(mcChartRef.current),
        tornado: await capture(tornadoChartRef.current),
      };

      await generateWordReport({
        businessQuestion,
        yUnit,
        fileName,
        mappings,
        quality,
        profiles,
        stats,
        rules,
        candidatesX,
        allModels,
        bestModel,
        selectionExplanation,
        selectionMethodReason,
        scenarios,
        monteCarlo,
        horizonYears,
        recommendations,
        pythonCode,
        rCode,
        charts,
        displayNames,
        entitySingular,
      });
    } finally {
      setWordBusy(false);
    }
  };

  const handleDownloadPython = () => {
    const blob = new Blob([pythonCode], { type: 'text/x-python;charset=utf-8;' });
    saveAs(blob, 'regresion.py');
  };

  const handleDownloadR = () => {
    const blob = new Blob([rCode], { type: 'text/plain;charset=utf-8;' });
    saveAs(blob, 'regresion.R');
  };

  const handleDownloadLinkedInPng = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => {
      if (blob) saveAs(blob, 'RegresIA_LinkedIn_1080x1350.png');
    }, 'image/png');
  };

  const handleCopyPost = async () => {
    try {
      await navigator.clipboard.writeText(linkedInPost);
      setCopiedPost(true);
      setTimeout(() => setCopiedPost(false), 2500);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const sortedGap = useMemo(() => [...bestModel.rows].sort((a, b) => a.gap - b.gap), [bestModel]);
  const gapChartRows = useMemo(
    () =>
      sortedGap.length > 24
        ? [...sortedGap.slice(0, 12), ...sortedGap.slice(-12)]
        : sortedGap,
    [sortedGap]
  );
  const tornadoData = useMemo(
    () =>
      sensitivity.map((s) => ({
        variable: fn(s.variable),
        menos10: Number(s.lowDeltaPct.toFixed(2)),
        mas10: Number(s.highDeltaPct.toFixed(2)),
      })),
    [sensitivity, displayNames]
  );

  const qqData = useMemo(() => {
    const sorted = [...bestModel.rows].sort(
      (a, b) => a.standardizedResidual - b.standardizedResidual
    );
    const n = sorted.length;
    return sorted.map((r, idx) => {
      const p = (idx + 0.5) / n;
      return {
        x: jStat.normal.inv(p, 0, 1),
        y: r.standardizedResidual,
      };
    });
  }, [bestModel]);
  const qqMin = useMemo(() => Math.min(...qqData.map((d) => Math.min(d.x, d.y)), -2), [qqData]);
  const qqMax = useMemo(() => Math.max(...qqData.map((d) => Math.max(d.x, d.y)), 2), [qqData]);

  const conclusionText =
    'Todos los entregables están listos para descargar localmente: informe ejecutivo en Word (.docx) con gráficos y anexos de código, scripts reproducibles en Python y R, tablas CSV y una pieza gráfica optimizada para LinkedIn (1080×1350 px).';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">10. Descargas y entregables ejecutivos</h1>
        <p className="text-sm text-slate-600 mt-1">
          Exporta el informe completo en Word, los scripts equivalentes en Python y R, resultados en CSV e imagen para LinkedIn.
        </p>
      </div>

      {/* Primary Download Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="w-4 h-4 text-[#2a78d6]" />
              <span>Informe en Word</span>
            </div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Documento tamaño carta (Arial 11) con portada, 11 secciones analíticas, gráficos PNG y anexos Python/R.
            </p>
          </div>
          <button
            type="button"
            disabled={wordBusy}
            onClick={() => void handleDownloadWord()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{wordBusy ? 'Generando Word...' : 'Descargar .docx'}</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Code2 className="w-4 h-4 text-[#2a78d6]" />
              <span>Script en Python</span>
            </div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Archivo <span className="font-mono">regresion.py</span> con pandas, statsmodels, scipy y matplotlib (semilla 42).
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDownloadPython}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              <span>regresion.py</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setActiveCodePreview(activeCodePreview === 'python' ? 'none' : 'python')
              }
              className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Ver
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Code2 className="w-4 h-4 text-[#2a78d6]" />
              <span>Script en R</span>
            </div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Archivo <span className="font-mono">regresion.R</span> con lm(), lmtest, car, HC3,{' '}
              {bestModel.cvMethod === 'kfold10' ? '10-fold CV' : 'LOOCV'} y Monte Carlo con Cholesky.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDownloadR}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              <span>regresion.R</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveCodePreview(activeCodePreview === 'r' ? 'none' : 'r')}
              className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Ver
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileSpreadsheet className="w-4 h-4 text-[#2a78d6]" />
              <span>Resultados en CSV</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">Descarga individual por tabla:</p>
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => downloadModelsComparisonCsv(allModels, bestModel.id)}
              className="w-full px-3 py-1.5 text-xs font-medium text-left text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
            >
              1. Comparación de modelos (.csv)
            </button>
            <button
              type="button"
              onClick={() => downloadRowGapCsv(bestModel)}
              className="w-full px-3 py-1.5 text-xs font-medium text-left text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
            >
              2. Real, potencial y brecha (.csv)
            </button>
            <button
              type="button"
              onClick={() => downloadScenariosCsv(scenarios, horizonYears)}
              className="w-full px-3 py-1.5 text-xs font-medium text-left text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100"
            >
              3. Escenarios proyectados (.csv)
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Script Preview */}
      {activeCodePreview !== 'none' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-slate-800">
              {activeCodePreview === 'python' ? 'regresion.py' : 'regresion.R'}
            </span>
            <button
              type="button"
              onClick={() => setActiveCodePreview('none')}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Ocultar
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-50/50 max-h-80 overflow-auto">
            {activeCodePreview === 'python' ? pythonCode : rCode}
          </pre>
        </div>
      )}

      {/* LinkedIn Section */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <ImageIcon className="w-4 h-4 text-[#2a78d6]" />
              <span>Imagen y publicación sugerida para LinkedIn</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Vista previa exacta en 1080×1350 px (fondo claro, máximo 40 palabras en la gráfica)
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadLinkedInPng}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Descargar PNG (1080×1350)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="flex justify-center bg-slate-100 rounded-lg p-4 border border-slate-200">
            <canvas
              ref={canvasRef}
              className="w-full max-w-[380px] h-auto rounded shadow-sm bg-white"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Texto sugerido para el post (120–180 palabras)
              </h3>
              <button
                type="button"
                onClick={() => void handleCopyPost()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                {copiedPost ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              readOnly
              rows={13}
              value={linkedInPost}
              className="w-full p-3.5 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg leading-relaxed focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Hidden offscreen static chart renderers for crisp Word .docx PNG capture */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-12000px',
          top: 0,
          width: '760px',
          backgroundColor: '#ffffff',
          pointerEvents: 'none',
        }}
      >
        <div ref={edaChartRef} style={{ width: 720, padding: 16, background: '#fff' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
            Matriz de correlaciones (Pearson)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #cbd5e1', padding: 4, background: '#f8fafc' }}>
                  Var
                </th>
                {numericColumns.map((c) => (
                  <th
                    key={c}
                    style={{ border: '1px solid #cbd5e1', padding: 4, background: '#f8fafc' }}
                  >
                    {fn(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numericColumns.map((rCol, i) => (
                <tr key={rCol}>
                  <td
                    style={{
                      border: '1px solid #cbd5e1',
                      padding: 4,
                      fontWeight: 600,
                      background: '#f8fafc',
                    }}
                  >
                    {fn(rCol)}
                  </td>
                  {numericColumns.map((cCol, j) => {
                    const v = corrMatrix[i]?.[j] ?? 0;
                    const bg =
                      i === j
                        ? '#f1f5f9'
                        : v >= 0
                          ? `rgba(42,120,214,${(0.1 + Math.abs(v) * 0.4).toFixed(2)})`
                          : `rgba(227,73,72,${(0.1 + Math.abs(v) * 0.4).toFixed(2)})`;
                    return (
                      <td
                        key={cCol}
                        style={{
                          border: '1px solid #cbd5e1',
                          padding: 4,
                          textAlign: 'center',
                          background: bg,
                        }}
                      >
                        {formatNumberES(v, 2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div ref={diagChartRef} style={{ width: 760, padding: 14, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Real vs. Predicho</div>
              <ScatterChart width={236} height={200}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="yActualModelSpace" tick={{ fontSize: 9 }} />
                <YAxis type="number" dataKey="yPredictedModelSpace" tick={{ fontSize: 9 }} />
                <Scatter data={bestModel.rows} fill="#2a78d6" isAnimationActive={false} />
              </ScatterChart>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Residuos vs. Ajustados
              </div>
              <ScatterChart width={236} height={200}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="yPredictedModelSpace" tick={{ fontSize: 9 }} />
                <YAxis type="number" dataKey="residualModelSpace" tick={{ fontSize: 9 }} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Scatter data={bestModel.rows} fill="#2a78d6" isAnimationActive={false} />
              </ScatterChart>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Gráfico Q-Q de residuos
              </div>
              <ScatterChart width={236} height={200}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" domain={[qqMin, qqMax]} tick={{ fontSize: 9 }} />
                <YAxis type="number" dataKey="y" domain={[qqMin, qqMax]} tick={{ fontSize: 9 }} />
                <Scatter data={qqData} fill="#2a78d6" isAnimationActive={false} />
                <ReferenceLine
                  segment={[
                    { x: qqMin, y: qqMin },
                    { x: qqMax, y: qqMax },
                  ]}
                  stroke="#e34948"
                  strokeDasharray="4 4"
                />
              </ScatterChart>
            </div>
          </div>
        </div>

        <div ref={gapChartRef} style={{ width: 720, padding: 16, background: '#fff' }}>
          <BarChart
            width={680}
            height={Math.max(300, gapChartRows.length * 22)}
            data={gapChartRows}
            layout="vertical"
            margin={{ left: 30, right: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="rowLabel" width={100} tick={{ fontSize: 10 }} />
            <ReferenceLine x={0} stroke="#334155" />
            <Bar dataKey="gap" isAnimationActive={false}>
              {gapChartRows.map((r) => (
                <Cell key={r.rowLabel} fill={r.gap < 0 ? '#e34948' : '#2a78d6'} />
              ))}
            </Bar>
          </BarChart>
        </div>

        <div ref={mcChartRef} style={{ width: 720, padding: 16, background: '#fff' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Monte Carlo ({monteCarlo.iterations} iter.) · P5={formatIntegerES(monteCarlo.p5)} | P50=
            {formatIntegerES(monteCarlo.p50)} | P95={formatIntegerES(monteCarlo.p95)}
          </div>
          <BarChart width={680} height={260} data={monteCarlo.bins}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="rangeLabel" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Bar dataKey="count" fill="#2a78d6" isAnimationActive={false} />
          </BarChart>
        </div>

        <div ref={tornadoChartRef} style={{ width: 720, padding: 16, background: '#fff' }}>
          {(() => {
            const maxAbs = Math.max(
              ...tornadoData.flatMap((d) => [Math.abs(d.menos10), Math.abs(d.mas10)]),
              1
            );
            const step = maxAbs <= 6 ? 2 : maxAbs <= 15 ? 4 : maxAbs <= 30 ? 10 : 20;
            const bound = Math.ceil((maxAbs * 1.2) / step) * step;
            const ticks = [-bound, -bound / 2, 0, bound / 2, bound];
            const renderLabel = (props: {
              x?: number | string;
              y?: number | string;
              width?: number | string;
              height?: number | string;
              viewBox?: unknown;
              value?: unknown;
            }) => {
              const v = Number(props.value);
              if (!Number.isFinite(v) || Math.abs(v) < 0.005) return <g />;
              const vb = props.viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
              const x = Number(vb?.x ?? props.x ?? 0);
              const y = Number(vb?.y ?? props.y ?? 0);
              const w = Number(vb?.width ?? props.width ?? 0);
              const h = Number(vb?.height ?? props.height ?? 0);
              const leftE = Math.min(x, x + w);
              const rightE = Math.max(x, x + w);
              return (
                <text
                  x={v < 0 ? leftE - 6 : rightE + 6}
                  y={y + h / 2 + 4}
                  textAnchor={v < 0 ? 'end' : 'start'}
                  fill={v < 0 ? '#b91c1c' : '#1d4ed8'}
                  fontSize={10}
                  fontWeight={600}
                >
                  {formatSignedPctES(v, 1)}
                </text>
              );
            };
            return (
              <BarChart
                width={680}
                height={240}
                data={tornadoData}
                layout="vertical"
                stackOffset="sign"
                margin={{ left: 30, right: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-bound, bound]}
                  ticks={ticks}
                  tickFormatter={(v) => `${formatNumberES(Number(v), 0)} %`}
                  tick={{ fontSize: 10 }}
                />
                <YAxis type="category" dataKey="variable" width={110} tick={{ fontSize: 10 }} />
                <ReferenceLine x={0} stroke="#334155" />
                <Bar dataKey="menos10" stackId="t" fill="#e34948" isAnimationActive={false}>
                  <LabelList dataKey="menos10" content={renderLabel} />
                </Bar>
                <Bar dataKey="mas10" stackId="t" fill="#2a78d6" isAnimationActive={false}>
                  <LabelList dataKey="mas10" content={renderLabel} />
                </Bar>
              </BarChart>
            );
          })()}
        </div>
      </div>

      <ConclusionBanner stepNumber={10} text={conclusionText} />

      <div className="flex justify-start">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a Recomendaciones</span>
        </button>
      </div>
    </div>
  );
};
