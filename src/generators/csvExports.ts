import { saveAs } from 'file-saver';
import { RegressionModelResult, ScenarioOutcome } from '../types/regression';

function toCsvBlob(headers: string[], rows: (string | number)[][]): Blob {
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  return new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
}

export function downloadModelsComparisonCsv(models: RegressionModelResult[], bestModelId: string) {
  const headers = [
    'Elegido',
    'Transformacion',
    'Variables_X',
    'Predictores_k',
    'R2',
    'R2_Ajustado',
    'RMSE_Modelo',
    'RMSE_LOOCV',
    'AIC',
    'BIC',
    'F_Estadistico',
    'F_p_value',
    'Max_p_predictores',
    'VIF_Maximo',
    'MAPE_pct',
  ];
  const rows = models.map((m) => [
    m.id === bestModelId ? 'SI' : 'NO',
    m.transform,
    m.predictorDisplayNames.join(' + '),
    m.k,
    m.r2.toFixed(6),
    m.adjR2.toFixed(6),
    m.rmse.toFixed(6),
    m.loocvRmse.toFixed(6),
    m.aic.toFixed(4),
    m.bic.toFixed(4),
    m.fStat.toFixed(4),
    m.fPValue.toExponential(4),
    m.maxPValuePredictors.toExponential(4),
    m.maxVif.toFixed(4),
    m.mape.toFixed(2),
  ]);
  saveAs(toCsvBlob(headers, rows), 'regresia_comparacion_modelos.csv');
}

export function downloadRowGapCsv(model: RegressionModelResult) {
  const headers = [
    'Fila',
    'Etiqueta',
    'Y_Real',
    'Y_Potencial',
    'Brecha_Unidades',
    'Brecha_Pct',
    'Residuo_Estandarizado',
    'Distancia_Cook',
    'Influyente',
  ];
  const sorted = [...model.rows].sort((a, b) => a.gap - b.gap);
  const rows = sorted.map((r) => [
    r.rowIndex,
    r.rowLabel,
    r.yActual.toFixed(4),
    r.yPredicted.toFixed(4),
    r.gap.toFixed(4),
    r.gapPct.toFixed(2),
    r.standardizedResidual.toFixed(4),
    r.cooksDistance.toFixed(6),
    r.isInfluential ? 'SI' : 'NO',
  ]);
  saveAs(toCsvBlob(headers, rows), 'regresia_brecha_por_fila.csv');
}

export function downloadScenariosCsv(scenarios: ScenarioOutcome[], horizonYears: number) {
  const headers = [
    'Escenario',
    'Horizonte_Anios',
    'Y_Actual_Total',
    'Y_Proyectado_Total',
    'Cambio_Absoluto',
    'Cambio_Pct',
    'IC_95_Inferior',
    'IC_95_Superior',
  ];
  const rows = scenarios.map((s) => [
    s.label,
    horizonYears,
    s.currentTotal.toFixed(2),
    s.projectedTotal.toFixed(2),
    s.changeAbs.toFixed(2),
    s.changePct.toFixed(2),
    s.piLower.toFixed(2),
    s.piUpper.toFixed(2),
  ]);
  saveAs(toCsvBlob(headers, rows), 'regresia_escenarios.csv');
}
