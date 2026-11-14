export type VariableType = 'numeric' | 'categorical' | 'identifier' | 'date';

export type ImputationMethod =
  | 'none'
  | 'median'
  | 'mean'
  | 'mode'
  | 'drop_rows'
  | 'drop_column';

export interface ColumnMapping {
  original: string;
  normalized: string;
  displayName: string;
}

export interface MissingColumnInfo {
  column: string;
  missingCount: number;
  missingPct: number;
  inferredKind: 'numeric' | 'categorical';
  suggestedMethod: ImputationMethod;
  selectedMethod: ImputationMethod;
}

export interface OutlierRecord {
  rowIndex: number;
  rowLabel: string;
  column: string;
  value: number;
  lowerFence: number;
  upperFence: number;
  side: 'bajo' | 'alto';
}

export interface DataQualityReport {
  totalRows: number;
  totalCols: number;
  duplicateCount: number;
  missingSummary: MissingColumnInfo[];
  hasAnyMissing: boolean;
  outliers: OutlierRecord[];
  cleanedRows: Record<string, unknown>[];
  droppedRowsCount: number;
  droppedColumns: string[];
}

export interface DerivedVariableAlert {
  derivedCol: string;
  colA: string;
  colB: string;
  operation: 'product' | 'quotient';
  maxRelError: number;
  formulaText: string;
}

export interface ColumnProfile {
  name: string;
  originalName: string;
  detectedType: VariableType;
  selectedType: VariableType;
  uniqueCount: number;
  nonNullCount: number;
  commaDecimalFixedCount: number;
  levels?: string[];
  referenceLevel?: string;
  dummyNames?: string[];
  isDummy?: boolean;
  isBinary?: boolean;
  isDateFeature?: boolean;
  dateDerivedNames?: string[];
  sourceColumn?: string;
}

export interface DescriptiveStat {
  column: string;
  n: number;
  mean: number;
  sd: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  skewness: number;
  isAllPositive: boolean;
  isBinary?: boolean;
}

export interface BusinessRule {
  variable: string;
  target: string;
  r: number;
  direction: 'mayor' | 'menor';
  text: string;
}

export type VariableControlType = 'controllable' | 'external';

export interface CandidateXInfo {
  name: string;
  isDummy: boolean;
  isBinary?: boolean;
  isDateFeature?: boolean;
  sourceColumn: string;
  suggestedInclude: boolean;
  reason: string;
  blockedByLeakage: boolean;
  leakageReason?: string;
  isAllPositive: boolean;
  skewness: number;
  suggestedControlType: VariableControlType;
  controlType: VariableControlType;
}

export type ModelTransform = 'linear' | 'log-log';

export interface CoefficientDetail {
  name: string;
  isIntercept: boolean;
  isTransformedLog: boolean;
  estimate: number;
  stdError: number;
  tStat: number;
  pValue: number;
  ciLower: number;
  ciUpper: number;
  standardizedBeta: number | null;
  vif: number | null;
  interpretation: string;
}

export interface RowDiagnostic {
  rowIndex: number;
  rowLabel: string;
  yActual: number;
  yPredicted: number; // in original units (retransformed with Duan smearing if log-log)
  yPredictedModelSpace: number;
  yActualModelSpace: number;
  residualModelSpace: number;
  standardizedResidual: number;
  leverage: number;
  cooksDistance: number;
  isInfluential: boolean;
  gap: number; // yActual - yPredicted
  gapPct: number;
}

export interface AssumptionCheck {
  id: 'normality' | 'homoscedasticity' | 'independence' | 'multicollinearity' | 'influential';
  name: string;
  testName: string;
  statisticLabel: string;
  statisticValue: number;
  pValue?: number;
  status: 'verde' | 'amarillo' | 'rojo';
  summary: string;
}

export interface RegressionModelResult {
  id: string;
  transform: ModelTransform;
  yName: string;
  predictors: string[];
  predictorDisplayNames: string[];
  n: number;
  k: number; // number of predictors
  r2: number;
  adjR2: number;
  rmse: number; // in model space
  rmseOriginal: number;
  mape: number; // %
  aic: number;
  bic: number;
  fStat: number;
  fPValue: number;
  maxPValuePredictors: number;
  maxPValueAll: number;
  maxVif: number;
  cvMethod: 'loocv' | 'kfold10';
  loocvRmse: number;
  smearingFactor: number; // 1 for linear, mean(exp(residuals)) for log-log
  sse: number;
  mse: number;
  covMatrix: number[][]; // (k+1) x (k+1)
  xtXInv: number[][]; // (k+1) x (k+1)
  coefficients: CoefficientDetail[];
  rows: RowDiagnostic[];
  assumptions: AssumptionCheck[];
  influentialRows: RowDiagnostic[];
  reestimatedWithoutInfluential?: {
    nRemaining: number;
    adjR2: number;
    coefficients: { name: string; original: number; withoutInfluential: number; pctDiff: number }[];
  };
  allPredictorsSignificant: boolean;
  vifAcceptable: boolean;
  selectionScoreRank?: number;
}

export interface ModelSelectionOutput {
  allModels: RegressionModelResult[];
  bestModel: RegressionModelResult;
  runnersUp: RegressionModelResult[];
  selectionExplanation: string;
  selectionMethod: 'exhaustive' | 'stepwise';
  selectionMethodReason: string;
  candidateGroupsCount: number;
  stepwiseRemovedLog?: string[];
  maxPredictorsEvaluated: number;
  totalEvaluated: number;
}

export type ScenarioGrowthMethod = 'fixed_rate' | 'normal_mc' | 'manual_value';

export interface VariableScenarioConfig {
  variable: string;
  category: 'income' | 'population' | 'other';
  method: ScenarioGrowthMethod;
  pessimisticRatePct: number; // annual %
  baseRatePct: number; // annual %
  optimisticRatePct: number; // annual %
  mcMeanRatePct: number; // annual % mean for MC
  mcStdRatePct: number; // annual % std dev for MC
  manualChangePct: number; // total % change at horizon
}

export interface ScenarioOutcome {
  id: 'pesimista' | 'base' | 'optimista';
  label: string;
  currentTotal: number;
  projectedTotal: number;
  changeAbs: number;
  changePct: number;
  piLower: number;
  piUpper: number;
  rowProjections: {
    rowLabel: string;
    currentY: number;
    projectedY: number;
    changeAbs: number;
    changePct: number;
    gapBase: number;
  }[];
}

export interface SensitivityItem {
  variable: string;
  lowYTotal: number; // -10% X
  highYTotal: number; // +10% X
  lowDelta: number;
  highDelta: number;
  lowDeltaPct: number;
  highDeltaPct: number;
  swing: number;
}

export interface MonteCarloSummary {
  iterations: number;
  seed: number;
  p5: number;
  p50: number;
  p95: number;
  mean: number;
  sd: number;
  bins: { rangeLabel: string; midpoint: number; count: number }[];
}

export interface ScenarioRecommendation {
  scenarioId: 'pesimista' | 'base' | 'optimista';
  title: string;
  meaning: string;
  actions: string[];
  kpi: string;
  risks: string;
}
