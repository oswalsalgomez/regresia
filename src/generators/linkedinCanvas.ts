import { RegressionModelResult, ScenarioOutcome } from '../types/regression';
import { buildEntityLabels } from '../utils/entityNoun';
import { formatIntegerES, formatNumberES, formatSignedPctES, resolveYUnit } from '../utils/formatters';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trim(), x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

function fitLabelToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 3 && ctx.measureText(cut + '…').width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.length < text.length ? cut + '…' : cut;
}

function layoutEquationLines(
  ctx: CanvasRenderingContext2D,
  equation: string,
  maxWidth: number
): { fontSize: number; lines: string[] } {
  for (const size of [20, 18, 16, 15]) {
    ctx.font = `600 ${size}px "JetBrains Mono", monospace`;
    if (ctx.measureText(equation).width <= maxWidth) {
      return { fontSize: size, lines: [equation] };
    }
  }

  // Split cleanly at + / - operators to wrap without ever truncating with "…"
  const tokens = equation.split(/(?=\s[+−-]\s)/g);
  for (const size of [15, 14, 13, 12]) {
    ctx.font = `600 ${size}px "JetBrains Mono", monospace`;
    const lines: string[] = [];
    let cur = '';
    for (const tok of tokens) {
      const candidate = cur ? cur + tok : tok;
      if (ctx.measureText(candidate).width <= maxWidth || !cur) {
        cur = candidate;
      } else {
        lines.push(cur.trimEnd());
        cur = tok.trimStart();
      }
    }
    if (cur) lines.push(cur.trimEnd());
    if (lines.length <= 4 || size === 12) {
      return { fontSize: size, lines };
    }
  }

  return { fontSize: 12, lines: [equation] };
}

export function buildShortEquationText(model: RegressionModelResult): string {
  const intercept = model.coefficients[0];
  const preds = model.coefficients.slice(1);
  const lhs = model.transform === 'log-log' ? `ln(${model.yName})` : model.yName;
  const parts = [formatNumberES(intercept.estimate, 2)];

  for (const c of preds) {
    const sign = c.estimate >= 0 ? ' + ' : ' − ';
    const termName = c.isTransformedLog ? `ln(${c.name})` : c.name;
    parts.push(`${sign}${formatNumberES(Math.abs(c.estimate), 2)}·${termName}`);
  }
  return `${lhs} = ${parts.join('')}`;
}

export interface DummyCardInfo {
  name: string;
  sourceColumn: string;
  level: string;
  referenceLevel: string;
}

export function buildLinkedInGraphicMeta(
  model: RegressionModelResult,
  displayNames: Record<string, string> = {},
  dummyColumns: DummyCardInfo[] = []
) {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const dummyMap = new Map(dummyColumns.map((d) => [d.name, d]));
  const predCoefs = model.coefficients
    .filter((c) => !c.isIntercept)
    .sort((a, b) => Math.abs(b.standardizedBeta ?? 0) - Math.abs(a.standardizedBeta ?? 0));

  const p1 = predCoefs[0];
  const p2 = predCoefs[1];
  const pctExplained = Math.round(model.adjR2 * 100);
  const yFriendly = fn(model.yName);
  const p1Friendly = p1 ? fn(p1.name) : '';
  const p2Friendly = p2 ? fn(p2.name) : '';

  const headline = `El modelo explica el ${pctExplained} % de ${yFriendly}`;
  const factorsSubtitle = p2
    ? `Factores clave: ${p1Friendly} y ${p2Friendly}`
    : p1
    ? `Factor clave: ${p1Friendly}`
    : '';

  const buildCardLabel = (coef: typeof p1, friendlyName: string, fallback: string) => {
    if (!coef) return fallback;
    const dummyInfo = dummyMap.get(coef.name);
    if (dummyInfo) return `${friendlyName} (vs. ${dummyInfo.referenceLevel})`;
    if (coef.isTransformedLog) return `${friendlyName} (+10 %)`;
    return `${friendlyName} (+1 u.)`;
  };

  const formatEffect = (c: typeof p1) => {
    if (!c) return '—';
    if (c.isTransformedLog) {
      const pct10 = (Math.pow(1.1, c.estimate) - 1) * 100;
      return `${formatSignedPctES(pct10, 1)}`;
    }
    return `${c.estimate >= 0 ? '+' : '−'}${formatNumberES(Math.abs(c.estimate), 2)}`;
  };

  const p1Dummy = p1 ? dummyMap.get(p1.name) : undefined;
  const p2Dummy = p2 ? dummyMap.get(p2.name) : undefined;

  const kpis = [
    {
      label: 'R² ajustado',
      value: `${formatNumberES(model.adjR2 * 100, 1)} %`,
      sub: 'Varianza explicada',
      color: '#2a78d6',
    },
    {
      label: buildCardLabel(p1, p1Friendly, 'Factor 1'),
      value: formatEffect(p1),
      sub: p1Dummy ? 'Efecto categórico' : p1?.isTransformedLog ? 'Elasticidad' : 'Efecto directo',
      color: (p1?.estimate ?? 0) >= 0 ? '#2a78d6' : '#e34948',
    },
    {
      label: p2 ? buildCardLabel(p2, p2Friendly, 'Factor 2') : 'Error MAPE',
      value: p2 ? formatEffect(p2) : `${formatNumberES(model.mape, 1)} %`,
      sub: p2
        ? p2Dummy
          ? 'Efecto categórico'
          : p2.isTransformedLog
          ? 'Elasticidad'
          : 'Efecto directo'
        : 'Error medio',
      color: p2 ? ((p2.estimate ?? 0) >= 0 ? '#2a78d6' : '#e34948') : '#0f172a',
    },
  ];

  return { headline, factorsSubtitle, yFriendly, predCoefs, kpis };
}

export function drawLinkedInGraphic(
  canvas: HTMLCanvasElement,
  model: RegressionModelResult,
  yUnit: string,
  displayNames: Record<string, string> = {},
  dummyColumns: DummyCardInfo[] = []
) {
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Light clean background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 1080, 1350);

  // Outer card surface
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  roundRect(ctx, 48, 48, 984, 1254, 20);
  ctx.fill();
  ctx.stroke();

  // Top accent bar
  ctx.fillStyle = '#2a78d6';
  roundRect(ctx, 48, 48, 984, 12, 6);
  ctx.fill();

  // Quiet brand label
  ctx.fillStyle = '#2a78d6';
  ctx.font = '700 26px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('RegresIA', 96, 118);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 22px "DM Sans", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Análisis de Regresión Múltiple', 984, 118);
  ctx.textAlign = 'left';

  const { headline, factorsSubtitle, yFriendly, kpis } = buildLinkedInGraphicMeta(
    model,
    displayNames,
    dummyColumns
  );

  // Main headline
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 44px "Plus Jakarta Sans", Arial, sans-serif';
  const afterTitleY = wrapText(ctx, headline, 96, 192, 888, 52);

  // Key factors subtitle (top 2 by |standardizedBeta|)
  let nextY = afterTitleY;
  if (factorsSubtitle) {
    ctx.fillStyle = '#334155';
    ctx.font = '600 24px "DM Sans", Arial, sans-serif';
    nextY = wrapText(ctx, factorsSubtitle, 96, afterTitleY + 4, 888, 32);
  }

  // 3 Key Figures cards
  const kpiY = Math.max(nextY + 18, 298);
  const cardW = 280;
  const cardGap = 24;

  kpis.forEach((k, idx) => {
    const cx = 96 + idx * (cardW + cardGap);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    roundRect(ctx, cx, kpiY, cardW, 152, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#475569';
    const maxLabelW = cardW - 40;
    let labelFontSize = 19;
    for (const sz of [19, 17, 15, 13]) {
      ctx.font = `600 ${sz}px "DM Sans", Arial, sans-serif`;
      labelFontSize = sz;
      if (ctx.measureText(k.label).width <= maxLabelW) break;
    }
    ctx.font = `600 ${labelFontSize}px "DM Sans", Arial, sans-serif`;
    ctx.fillText(fitLabelToWidth(ctx, k.label, maxLabelW), cx + 20, kpiY + 42);

    ctx.fillStyle = k.color;
    ctx.font = '700 42px "JetBrains Mono", monospace';
    ctx.fillText(k.value, cx + 20, kpiY + 98);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 18px "DM Sans", Arial, sans-serif';
    ctx.fillText(k.sub, cx + 20, kpiY + 132);
  });

  // Footer equation layout first so plot height fits cleanly above it
  const eq = buildShortEquationText(model);
  const eqLayout = layoutEquationLines(ctx, eq, 840);
  const lineH = eqLayout.fontSize + 8;
  const footerH = Math.max(66, 26 + eqLayout.lines.length * lineH);
  const footerY = 1272 - footerH;

  // Gap Chart section
  const chartTop = kpiY + 190;
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 28px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('Brecha real vs. potencial', 96, chartTop);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 20px "DM Sans", Arial, sans-serif';
  ctx.fillText(
    `Rojo: oportunidad · Azul: sobre desempeño (${resolveYUnit(yUnit, yFriendly)})`,
    96,
    chartTop + 34
  );

  // Pick up to 12 most extreme rows (6 most negative, 6 most positive)
  const sortedRows = [...model.rows].sort((a, b) => a.gap - b.gap);
  let displayRows = sortedRows;
  if (sortedRows.length > 12) {
    displayRows = [...sortedRows.slice(0, 6), ...sortedRows.slice(-6)];
  }

  const plotTop = chartTop + 58;
  const plotHeight = Math.max(280, Math.min(520, footerY - 24 - plotTop));
  const rowH = plotHeight / Math.max(1, displayRows.length);

  // Fixed left margin for row labels + measured value padding so negative labels never collide with row names
  const labelW = 196;
  const labelRightX = 96 + labelW - 14;
  ctx.font = '600 17px "JetBrains Mono", monospace';
  const maxValW = Math.max(
    ...displayRows.map((r) => {
      const txt = `${r.gap > 0 ? '+' : ''}${formatIntegerES(r.gap)}`;
      return ctx.measureText(txt).width;
    }),
    60
  );
  const valuePad = Math.min(165, Math.ceil(maxValW) + 18);
  const barPlotLeft = 96 + labelW + valuePad;
  const barPlotRight = 984 - valuePad;
  const barPlotWidth = Math.max(160, barPlotRight - barPlotLeft);
  const zeroX = barPlotLeft + barPlotWidth / 2;
  const maxAbsGap = Math.max(...displayRows.map((r) => Math.abs(r.gap)), 1);

  // Center zero line
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(zeroX, plotTop - 4);
  ctx.lineTo(zeroX, plotTop + plotHeight);
  ctx.stroke();

  displayRows.forEach((r, i) => {
    const cy = plotTop + i * rowH + rowH / 2;
    const isNeg = r.gap < 0;
    const barW = (Math.abs(r.gap) / maxAbsGap) * (barPlotWidth / 2 - 4);
    const barH = Math.min(25, rowH * 0.62);

    // Row label strictly inside left margin [96 .. 96 + labelW - 14]
    ctx.fillStyle = '#1e293b';
    ctx.font = '500 19px "DM Sans", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fitLabelToWidth(ctx, r.rowLabel, labelW - 18), labelRightX, cy + 6);

    // Bar strictly inside [barPlotLeft .. barPlotRight]
    ctx.fillStyle = isNeg ? '#e34948' : '#2a78d6';
    const drawW = Math.max(barW, 3);
    const bx = isNeg ? zeroX - drawW : zeroX;
    roundRect(ctx, bx, cy - barH / 2, drawW, barH, 4);
    ctx.fill();

    // Numeric value strictly outside bar end inside reserved padding
    ctx.fillStyle = isNeg ? '#b91c1c' : '#1d4ed8';
    ctx.font = '600 17px "JetBrains Mono", monospace';
    ctx.textAlign = isNeg ? 'right' : 'left';
    const valTxt = `${r.gap > 0 ? '+' : ''}${formatIntegerES(r.gap)}`;
    const vx = isNeg ? bx - 10 : bx + drawW + 10;
    ctx.fillText(valTxt, vx, cy + 6);
  });
  ctx.textAlign = 'left';

  // Footer with complete equation (never truncated with "…")
  ctx.fillStyle = '#f1f5f9';
  roundRect(ctx, 96, footerY, 888, footerH, 12);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.font = `600 ${eqLayout.fontSize}px "JetBrains Mono", monospace`;
  const totalTextH = eqLayout.lines.length * lineH;
  const startTextY = footerY + (footerH - totalTextH) / 2 + eqLayout.fontSize;
  eqLayout.lines.forEach((line, idx) => {
    ctx.fillText(line, 120, startTextY + idx * lineH);
  });
}

export function generateLinkedInPostText(
  businessQuestion: string,
  model: RegressionModelResult,
  scenarios: ScenarioOutcome[],
  horizonYears: number,
  yUnit: string,
  displayNames: Record<string, string> = {},
  entitySingular = 'registro'
): string {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const ent = buildEntityLabels(entitySingular);
  const yFriendly = fn(model.yName);
  const unit = resolveYUnit(yUnit, yFriendly);
  const adjPct = Math.round(model.adjR2 * 100);
  const preds = model.coefficients
    .filter((c) => !c.isIntercept)
    .sort((a, b) => Math.abs(b.standardizedBeta ?? 0) - Math.abs(a.standardizedBeta ?? 0));
  const topPred = preds[0];
  const secondPred = preds[1];

  const sortedNeg = [...model.rows].sort((a, b) => a.gap - b.gap).filter((r) => r.gap < 0);
  const topOpp = sortedNeg.slice(0, 3).map((r) => r.rowLabel).join(', ');
  const base = scenarios.find((s) => s.id === 'base');
  const opt = scenarios.find((s) => s.id === 'optimista');

  const factorLine = secondPred
    ? `Los dos impulsores principales son ${fn(topPred.name)} y ${fn(secondPred.name)}, ambos estadísticamente significativos (p < 0,05) y sin colinealidad (VIF = ${formatNumberES(model.maxVif, 2)}).`
    : `El impulsor principal identificado es ${fn(topPred.name)} (VIF = ${formatNumberES(model.maxVif, 2)}).`;

  const oppLine = topOpp
    ? `Al comparar el desempeño real frente al potencial esperado por el modelo, los ${ent.plural} con mayor oportunidad de mejora en ${unit} son: ${topOpp}.`
    : `El análisis de brechas permite identificar con precisión en qué ${ent.plural} existe potencial capturable.`;

  const scenLine =
    base && opt
      ? `Al proyectar a ${horizonYears} años, el escenario Base apunta a un cambio de ${formatSignedPctES(base.changePct, 1)}, mientras que un entorno Optimista llevaría el total hasta ${formatIntegerES(opt.projectedTotal)} ${unit} (${formatSignedPctES(opt.changePct, 1)}).`
      : '';

  return `¿${businessQuestion.replace(/^¿|\?$/g, '')}?

Analizamos los datos con un modelo de regresión múltiple (${model.transform === 'log-log' ? 'especificación log-log de elasticidades' : 'especificación lineal'}) y encontramos que el modelo explica el ${adjPct} % de la variación en ${yFriendly} (R² ajustado = ${formatNumberES(model.adjR2, 3)}).

${factorLine}

${oppLine}

${scenLine}

Más allá de mirar promedios históricos, modelar elasticidades, validar supuestos estadísticos y cuantificar brechas frente al potencial permite priorizar recursos con evidencia cuantitativa.

¿Qué variables considerarías clave en tu industria antes de decidir dónde invertir?

#AnalíticaDeNegocios #RegresiónMúltiple #CienciaDeDatos #EstrategiaComercial #TomaDeDecisiones`;
}
