import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
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
} from '../types/regression';
import { buildEntityLabels } from '../utils/entityNoun';
import {
  formatIntegerES,
  formatNumberES,
  formatPValueES,
  formatSignedPctES,
  resolveYUnit,
} from '../utils/formatters';
import { buildShortEquationText } from './linkedinCanvas';

export interface WordChartImages {
  edaHeatmap?: string;
  diagnostics?: string;
  gapChart?: string;
  monteCarlo?: string;
  tornado?: string;
}

export interface WordReportParams {
  businessQuestion: string;
  yUnit: string;
  fileName: string;
  mappings: ColumnMapping[];
  quality: DataQualityReport;
  profiles: ColumnProfile[];
  stats: DescriptiveStat[];
  rules: BusinessRule[];
  candidatesX: CandidateXInfo[];
  allModels: RegressionModelResult[];
  bestModel: RegressionModelResult;
  selectionExplanation: string;
  selectionMethodReason?: string;
  scenarios: ScenarioOutcome[];
  monteCarlo: MonteCarloSummary;
  horizonYears: number;
  recommendations: ScenarioRecommendation[];
  pythonCode: string;
  rCode: string;
  charts: WordChartImages;
  displayNames?: Record<string, string>;
  entitySingular?: string;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function headingBlue(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 140 },
    children: [
      new TextRun({
        text,
        font: 'Arial',
        size: 28,
        bold: true,
        color: '1D4ED8',
      }),
    ],
  });
}

function subHeadingBlue(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 100 },
    children: [
      new TextRun({
        text,
        font: 'Arial',
        size: 23,
        bold: true,
        color: '2A78D6',
      }),
    ],
  });
}

function bodyPara(text: string, boldPrefix?: string): Paragraph {
  const children: TextRun[] = [];
  if (boldPrefix) {
    children.push(
      new TextRun({
        text: boldPrefix,
        font: 'Arial',
        size: 22,
        bold: true,
        color: '0F172A',
      })
    );
  }
  children.push(
    new TextRun({
      text,
      font: 'Arial',
      size: 22,
      color: '1E293B',
    })
  );
  return new Paragraph({
    spacing: { after: 110 },
    children,
  });
}

function bulletPara(text: string, boldPrefix?: string): Paragraph {
  const children: TextRun[] = [];
  if (boldPrefix) {
    children.push(
      new TextRun({
        text: boldPrefix,
        font: 'Arial',
        size: 22,
        bold: true,
        color: '0F172A',
      })
    );
  }
  children.push(
    new TextRun({
      text,
      font: 'Arial',
      size: 22,
      color: '1E293B',
    })
  );
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children,
  });
}

function buildStyledTable(
  headers: string[],
  rows: string[][],
  options?: { fontSizeHalfPts?: number; colWidthsDxa?: number[] }
): Table {
  const fontSize = options?.fontSizeHalfPts ?? 19;
  const colWidths = options?.colWidthsDxa;
  const totalDxa = colWidths ? colWidths.reduce((a, b) => a + b, 0) : undefined;

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h, idx) =>
        new TableCell({
          width: colWidths ? { size: colWidths[idx], type: WidthType.DXA } : undefined,
          shading: { type: ShadingType.CLEAR, fill: '1D4ED8' },
          margins: { top: 75, bottom: 75, left: 85, right: 85 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: h,
                  font: 'Arial',
                  size: fontSize,
                  bold: true,
                  color: 'FFFFFF',
                }),
              ],
            }),
          ],
        })
    ),
  });

  const bodyRows = rows.map(
    (r, rIdx) =>
      new TableRow({
        children: r.map(
          (cell, cIdx) =>
            new TableCell({
              width: colWidths ? { size: colWidths[cIdx], type: WidthType.DXA } : undefined,
              shading:
                rIdx % 2 === 1
                  ? { type: ShadingType.CLEAR, fill: 'F8FAFC' }
                  : undefined,
              margins: { top: 60, bottom: 60, left: 85, right: 85 },
              borders: {
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      font: 'Arial',
                      size: fontSize,
                      color: '0F172A',
                    }),
                  ],
                }),
              ],
            })
        ),
      })
  );

  return new Table({
    width: totalDxa
      ? { size: totalDxa, type: WidthType.DXA }
      : { size: 100, type: WidthType.PERCENTAGE },
    layout: colWidths ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  });
}

function imagePara(dataUrl: string | undefined, caption: string, widthPx = 560, heightPx = 300): Paragraph[] {
  if (!dataUrl) return [];
  try {
    const bytes = dataUrlToUint8Array(dataUrl);
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 140, after: 60 },
        children: [
          new ImageRun({
            data: bytes,
            transformation: { width: widthPx, height: heightPx },
            type: 'png',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: caption,
            font: 'Arial',
            size: 18,
            italics: true,
            color: '475569',
          }),
        ],
      }),
    ];
  } catch {
    return [];
  }
}

export function buildWordDocument(params: WordReportParams): Document {
  const {
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
    displayNames = {},
    entitySingular = 'registro',
  } = params;

  const fn = (col: string) => displayNames[col]?.trim() || col;
  const ent = buildEntityLabels(entitySingular);
  const today = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date());
  const yFriendly = fn(bestModel.yName);
  const rawUnitLabel = resolveYUnit(yUnit, bestModel.yName);
  const unitLabel = resolveYUnit(yUnit, yFriendly);
  const equation = buildShortEquationText(bestModel);

  const baseEsc = scenarios.find((s) => s.id === 'base');
  const pesEsc = scenarios.find((s) => s.id === 'pesimista');
  const optEsc = scenarios.find((s) => s.id === 'optimista');

  const topNegGap = [...bestModel.rows]
    .sort((a, b) => a.gap - b.gap)
    .filter((r) => r.gap < 0)
    .slice(0, 3);

  const codeParagraphs = (code: string) =>
    code.split('\n').map(
      (line) =>
        new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({
              text: line || ' ',
              font: 'Courier New',
              size: 16,
              color: '1E293B',
            }),
          ],
        })
    );

  // Comparison table: top 10 models, proportional widths (Predictores 40% of 9360 DXA), 8 pt font (size 16)
  const cvHeader = bestModel.cvMethod === 'kfold10' ? 'RMSE 10-fold' : 'RMSE LOOCV';
  const comparisonColWidths = [655, 749, 3744, 749, 749, 1030, 842, 842]; // sums to 9360 DXA (US Letter content width)

  // Scenarios P5-P95 column from Monte Carlo on Base scenario
  const mcRangeText = `[${formatIntegerES(monteCarlo.p5)} ; ${formatIntegerES(monteCarlo.p95)}]`;

  const influentialRowsSection = bestModel.reestimatedWithoutInfluential
    ? [
        subHeadingBlue(
          `Sensibilidad sin observaciones influyentes (Cook > 4/n: ${bestModel.influentialRows
            .slice(0, 8)
            .map((r) => r.rowLabel)
            .join(', ')}${bestModel.influentialRows.length > 8 ? ` y ${bestModel.influentialRows.length - 8} más` : ''})`
        ),
        bodyPara(
          `Al reestimar el modelo excluyendo las ${bestModel.influentialRows.length} observación(es) influyentes (n restante = ${bestModel.reestimatedWithoutInfluential.nRemaining}), el R² ajustado resultante es ${formatNumberES(bestModel.reestimatedWithoutInfluential.adjR2, 3)}.`
        ),
        buildStyledTable(
          ['Término', 'Original', 'Sin influyentes', 'Variación'],
          bestModel.reestimatedWithoutInfluential.coefficients.map((c) => [
            c.name,
            formatNumberES(c.original, 3),
            formatNumberES(c.withoutInfluential, 3),
            formatSignedPctES(c.pctDiff, 1),
          ])
        ),
      ]
    : [];

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          // PORTADA
          new Paragraph({
            spacing: { before: 1800, after: 200 },
            children: [
              new TextRun({
                text: 'RegresIA – Regresión Múltiple para Negocios',
                font: 'Arial',
                size: 44,
                bold: true,
                color: '1D4ED8',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: 'Informe Ejecutivo de Modelado Econométrico, Brechas y Simulación de Escenarios',
                font: 'Arial',
                size: 26,
                color: '334155',
              }),
            ],
          }),
          bodyPara(businessQuestion, 'Pregunta de negocio: '),
          bodyPara(`${fileName} (${quality.totalRows} ${ent.plural} × ${quality.totalCols} columnas)`, 'Fuente de datos: '),
          bodyPara(today, 'Fecha de emisión: '),
          new Paragraph({ children: [new PageBreak()] }),

          // 1. RESUMEN EJECUTIVO
          headingBlue('1. Resumen Ejecutivo'),
          bulletPara(
            `El modelo seleccionado (${equation}) explica el ${formatNumberES(bestModel.adjR2 * 100, 1)} % de la varianza ajustada de ${yFriendly} (R² ajustado = ${formatNumberES(bestModel.adjR2, 3)}, p global ${formatPValueES(bestModel.fPValue)}).`
          ),
          bulletPara(
            `Todos los predictores incluidos son estadísticamente significativos (p < 0,05), mantienen baja colinealidad (VIF máximo = ${formatNumberES(bestModel.maxVif, 2)}) y fueron validados mediante ${bestModel.cvMethod === 'kfold10' ? 'validación cruzada 10-fold (semilla 42)' : 'validación cruzada Leave-One-Out (LOOCV)'}.`
          ),
          bulletPara(
            `Las mayores oportunidades de mejora (brecha negativa respecto al potencial) se concentran en: ${topNegGap.map((r) => `${r.rowLabel} (${formatIntegerES(r.gap)} ${unitLabel})`).join(', ') || 'sin brechas negativas relevantes'}.`
          ),
          bulletPara(
            `A ${horizonYears} años, los escenarios proyectan un total de ${formatIntegerES(pesEsc?.projectedTotal ?? 0)} ${unitLabel} en Pesimista (${formatSignedPctES(pesEsc?.changePct ?? 0, 1)}), ${formatIntegerES(baseEsc?.projectedTotal ?? 0)} en Base (${formatSignedPctES(baseEsc?.changePct ?? 0, 1)}) y ${formatIntegerES(optEsc?.projectedTotal ?? 0)} en Optimista (${formatSignedPctES(optEsc?.changePct ?? 0, 1)}).`
          ),
          bulletPara(
            `La simulación Monte Carlo (10.000 iteraciones, semilla 42) sitúa el percentil P50 en ${formatIntegerES(monteCarlo.p50)} ${unitLabel}, con rango P5–P95 de ${formatIntegerES(monteCarlo.p5)} a ${formatIntegerES(monteCarlo.p95)} ${unitLabel}.`
          ),

          // 2. DATOS Y CALIDAD
          headingBlue('2. Datos y Calidad'),
          bodyPara(
            `El conjunto analizado consta de ${quality.cleanedRows.length} ${ent.plural} válidos y ${mappings.length - quality.droppedColumns.length} columnas activas. Duplicados exactos detectados: ${quality.duplicateCount}. Atípicos por regla IQR (1,5×): ${quality.outliers.length} registros (conservados para análisis de influencia).`
          ),
          bodyPara(
            quality.hasAnyMissing
              ? 'Resumen de valores faltantes e imputación aplicada:'
              : 'Sin datos faltantes: no se requiere imputación.'
          ),
          buildStyledTable(
            ['Original', 'Normalizado', 'Presentación', 'Tipo detectado', 'Faltantes (%)'],
            profiles.map((p) => {
              const m = quality.missingSummary.find((x) => x.column === p.name);
              const typeLabel =
                p.selectedType === 'numeric'
                  ? p.isBinary
                    ? 'Binaria (0/1)'
                    : p.isDateFeature
                      ? 'Numérica (derivada fecha)'
                      : 'Numérica'
                  : p.selectedType === 'identifier'
                    ? 'Identificador'
                    : p.selectedType === 'date'
                      ? 'Fecha (genera año, mes, antigüedad)'
                      : 'Categórica';
              return [
                p.originalName,
                p.name,
                fn(p.name),
                typeLabel,
                m ? `${m.missingCount} (${formatNumberES(m.missingPct, 1)} %)` : '0 (0,0 %)',
              ];
            })
          ),

          // 3. ANÁLISIS EXPLORATORIO
          headingBlue('3. Análisis Exploratorio y Reglas de Negocio'),
          buildStyledTable(
            ['Variable', 'Media', 'Desv. est.', 'Mínimo', 'Mediana', 'Máximo', 'Asimetría'],
            stats.map((s) => [
              fn(s.column),
              formatNumberES(s.mean, 2),
              formatNumberES(s.sd, 2),
              formatNumberES(s.min, 2),
              formatNumberES(s.median, 2),
              formatNumberES(s.max, 2),
              formatNumberES(s.skewness, 2),
            ])
          ),
          subHeadingBlue('Reglas de negocio detectadas (correlación no implica causalidad)'),
          ...rules.map((r) => bulletPara(r.text)),
          ...imagePara(charts.edaHeatmap, 'Figura 1. Matriz de correlaciones.', 540, 340),

          // 4. VARIABLES DEL MODELO
          headingBlue('4. Variables del Modelo'),
          bodyPara(`Variable dependiente (Y): ${yFriendly} [${bestModel.yName}] (${unitLabel}).`),
          buildStyledTable(
            ['Variable candidata', 'Estado', 'Justificación'],
            candidatesX.map((c) => [
              fn(c.name),
              bestModel.predictors.includes(c.name)
                ? 'Incluida en modelo final'
                : c.blockedByLeakage
                  ? 'Bloqueada (fuga)'
                  : 'Evaluada',
              c.reason,
            ])
          ),

          // 5. SELECCIÓN DEL MODELO
          headingBlue('5. Selección del Mejor Modelo'),
          ...(selectionMethodReason ? [bodyPara(selectionMethodReason, 'Método de búsqueda: ')] : []),
          bodyPara(selectionExplanation),
          buildStyledTable(
            ['Elegido', 'Escala', 'Predictores', 'R² aj.', 'AIC', cvHeader, 'p máx.', 'VIF máx.'],
            allModels.slice(0, 10).map((m) => [
              m.id === bestModel.id ? 'SÍ' : 'No',
              m.transform,
              m.predictorDisplayNames.join(' + '),
              formatNumberES(m.adjR2, 3),
              formatNumberES(m.aic, 1),
              formatNumberES(m.loocvRmse, 3),
              formatPValueES(m.maxPValuePredictors),
              formatNumberES(m.maxVif, 2),
            ]),
            { fontSizeHalfPts: 16, colWidthsDxa: comparisonColWidths }
          ),

          // 6. VALIDACIÓN DE SUPUESTOS
          headingBlue('6. Validación de Supuestos Estadísticos'),
          buildStyledTable(
            ['Supuesto', 'Prueba', 'Resultado', 'Semáforo', 'Interpretación'],
            bestModel.assumptions.map((a) => {
              const statFormatted =
                a.id === 'influential'
                  ? formatIntegerES(a.statisticValue)
                  : formatNumberES(a.statisticValue, 3);
              return [
                a.name,
                a.testName,
                `${a.statisticLabel} = ${statFormatted}${a.pValue !== undefined ? ` (p = ${formatPValueES(a.pValue)})` : ''}`,
                a.status.toUpperCase(),
                a.summary,
              ];
            })
          ),
          ...influentialRowsSection,
          ...imagePara(
            charts.diagnostics,
            'Figura 2. Diagnóstico gráfico del modelo seleccionado (Real vs. Predicho, Residuos vs. Ajustados y Q-Q de residuos).',
            560,
            230
          ),

          // 7. FÓRMULA E INTERPRETACIÓN
          headingBlue('7. Fórmula e Interpretación de Coeficientes'),
          bodyPara(equation, 'Ecuación estimada: '),
          buildStyledTable(
            ['Término', 'Coeficiente', 'Error est.', 'IC 95 %', 'p-value', 'Beta est.'],
            bestModel.coefficients.map((c) => [
              c.isTransformedLog ? `ln(${c.name})` : c.name,
              formatNumberES(c.estimate, 4),
              formatNumberES(c.stdError, 4),
              `[${formatNumberES(c.ciLower, 3)}; ${formatNumberES(c.ciUpper, 3)}]`,
              formatPValueES(c.pValue),
              c.standardizedBeta !== null ? formatNumberES(c.standardizedBeta, 3) : '—',
            ])
          ),
          ...bestModel.coefficients
            .filter((c) => !c.isIntercept)
            .map((c) => {
              const text = c.interpretation
                .split(rawUnitLabel).join(unitLabel)
                .split(bestModel.yName).join(yFriendly)
                .split(c.name).join(fn(c.name));
              return bulletPara(text, `${fn(c.name)}: `);
            }),

          // 8. BRECHA REAL VS POTENCIAL
          headingBlue('8. Brecha Real vs. Potencial'),
          bodyPara(
            bestModel.transform === 'log-log'
              ? `Para retransformar desde escala logarítmica sin sesgo se aplicó el factor smearing de Duan = ${formatNumberES(bestModel.smearingFactor, 4)}.`
              : 'Los valores potenciales corresponden a la predicción directa del modelo lineal.'
          ),
          buildStyledTable(
            [ent.singularCap, 'Real', 'Potencial', 'Brecha (unidades)', 'Brecha (%)'],
            [...bestModel.rows]
              .sort((a, b) => a.gap - b.gap)
              .slice(0, 60)
              .map((r) => [
                r.rowLabel,
                formatNumberES(r.yActual, 1),
                formatNumberES(r.yPredicted, 1),
                formatNumberES(r.gap, 1),
                formatSignedPctES(r.gapPct, 1),
              ])
          ),
          ...(bestModel.rows.length > 60
            ? [
                bodyPara(
                  `Nota: se muestran los 60 ${ent.plural} con mayor oportunidad (de ${bestModel.rows.length} totales); la tabla completa está disponible en el archivo CSV de brechas.`
                ),
              ]
            : []),
          ...imagePara(charts.gapChart, 'Figura 3. Brecha real frente al potencial estimado.', 550, 340),

          // 9. ESCENARIOS Y MONTE CARLO
          headingBlue('9. Simulación de Escenarios y Monte Carlo'),
          buildStyledTable(
            ['Escenario', 'Total Actual', 'Proyectado', 'Cambio', 'Rango P5–P95 (MC)'],
            scenarios.map((s) => [
              s.label,
              formatIntegerES(s.currentTotal),
              formatIntegerES(s.projectedTotal),
              `${formatIntegerES(s.changeAbs)} (${formatSignedPctES(s.changePct, 1)})`,
              s.id === 'base' ? mcRangeText : '—',
            ])
          ),
          bodyPara(
            `Simulación Monte Carlo (${monteCarlo.iterations} iteraciones, semilla ${monteCarlo.seed}): P5 = ${formatIntegerES(monteCarlo.p5)}, P50 = ${formatIntegerES(monteCarlo.p50)}, P95 = ${formatIntegerES(monteCarlo.p95)} ${unitLabel}.`
          ),
          ...imagePara(charts.monteCarlo, 'Figura 4. Distribución Monte Carlo a futuro.', 550, 290),
          ...imagePara(charts.tornado, 'Figura 5. Análisis de sensibilidad (±10 % por variable).', 550, 260),

          // 10. RECOMENDACIONES
          headingBlue('10. Recomendaciones Estratégicas por Escenario'),
          ...recommendations.flatMap((rec) => [
            subHeadingBlue(rec.title),
            bodyPara(rec.meaning, 'Lectura estratégica: '),
            ...rec.actions.map((act) => bulletPara(act)),
            bodyPara(rec.kpi, 'KPI clave: '),
            bodyPara(rec.risks, 'Riesgos a vigilar: '),
          ]),

          // 11. LIMITACIONES
          headingBlue('11. Limitaciones del Análisis'),
          bulletPara(
            bestModel.n < 100
              ? `Tamaño muestral de ${bestModel.n} observaciones (muestra pequeña, n < 100): amplía los intervalos de confianza en coeficientes y proyecciones.`
              : `Tamaño muestral adecuado de ${bestModel.n} observaciones (n ≥ 100), lo que brinda estabilidad a las estimaciones.`
          ),
          bulletPara('Asociación estadística no implica causalidad directa; valide intervenciones mediante experimentos o conocimiento del negocio.'),
          bulletPara(`Error porcentual medio absoluto (MAPE) del modelo en unidades originales: ${formatNumberES(bestModel.mape, 2)} %.`),
          bulletPara(`Todas las cifras y brechas deben interpretarse en la unidad declarada (${unitLabel}).`),

          // 12. ANEXOS DE CÓDIGO
          new Paragraph({ children: [new PageBreak()] }),
          headingBlue('Anexo A. Código Reproducible en Python (regresion.py)'),
          ...codeParagraphs(pythonCode),
          new Paragraph({ children: [new PageBreak()] }),
          headingBlue('Anexo B. Código Reproducible en R (regresion.R)'),
          ...codeParagraphs(rCode),
        ],
      },
    ],
  });
}

export async function generateWordReport(params: WordReportParams) {
  const doc = buildWordDocument(params);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, 'RegresIA_Informe_Ejecutivo.docx');
}
