import { useEffect, useMemo, useRef, useState } from 'react';
import { MobileMenuButton, Sidebar, STEPS } from './components/Sidebar';
import { Step1Upload } from './components/steps/Step1Upload';
import { Step2Quality } from './components/steps/Step2Quality';
import { Step3Types } from './components/steps/Step3Types';
import { Step4EDA } from './components/steps/Step4EDA';
import { Step5Variables } from './components/steps/Step5Variables';
import { Step6ModelSelection } from './components/steps/Step6ModelSelection';
import { Step7FormulaGap } from './components/steps/Step7FormulaGap';
import { Step8Scenarios } from './components/steps/Step8Scenarios';
import { Step9Recommendations } from './components/steps/Step9Recommendations';
import { Step10Downloads } from './components/steps/Step10Downloads';
import {
  SAMPLE_BUSINESS_QUESTION,
  SAMPLE_EUROPE_CSV,
  SAMPLE_Y_UNIT,
} from './data/sampleEurope';
import {
  analyzeDataQuality,
  ParsedDatasetRaw,
  parseCsvText,
  parseExcelBuffer,
  processVariableTypes,
} from './engine/dataPrep';
import { computeCorrelationMatrix, computeDescriptiveStats, generateBusinessRules } from './engine/eda';
import {
  buildCandidateXList,
  getLeakageBlockedForY,
  runModelSelection,
  suggestTargetY,
} from './engine/ols';
import {
  buildDefaultScenarioConfigs,
  generateScenarioRecommendations,
  runMonteCarloSimulation,
  runScenarioProjections,
  runSensitivityTornado,
} from './engine/simulation';
import { generatePythonScript } from './generators/pythonScript';
import { generateRScript } from './generators/rScript';
import {
  ImputationMethod,
  ModelSelectionOutput,
  VariableControlType,
  VariableScenarioConfig,
  VariableType,
} from './types/regression';
import { buildEntityLabels, suggestEntitySingular } from './utils/entityNoun';
import type { ModelWorkerRequest, ModelWorkerResponse } from './workers/modelSelection.worker';

export default function App() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [maxUnlockedStep, setMaxUnlockedStep] = useState<number>(1);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  const [businessQuestion, setBusinessQuestion] = useState<string>('');
  const [yUnit, setYUnit] = useState<string>('');
  const [manualEntitySingular, setManualEntitySingular] = useState<string | null>(null);
  const [rawDataset, setRawDataset] = useState<ParsedDatasetRaw | null>(null);
  const [excelBuffer, setExcelBuffer] = useState<ArrayBuffer | null>(null);

  const [methodOverrides, setMethodOverrides] = useState<Record<string, ImputationMethod>>({});
  const [removeDuplicates, setRemoveDuplicates] = useState<boolean>(false);
  const [typeOverrides, setTypeOverrides] = useState<Record<string, VariableType>>({});
  const [displayNameOverrides, setDisplayNameOverrides] = useState<Record<string, string>>({});

  const [manualTargetY, setManualTargetY] = useState<string | null>(null);
  const [manualSelectedX, setManualSelectedX] = useState<string[] | null>(null);
  const [manualLogTransform, setManualLogTransform] = useState<boolean | null>(null);
  const [controlTypeOverrides, setControlTypeOverrides] = useState<Record<string, VariableControlType>>({});

  const [horizonYears, setHorizonYears] = useState<number>(3);
  const [scenarioConfigs, setScenarioConfigs] = useState<VariableScenarioConfig[]>([]);

  const [modelSelection, setModelSelection] = useState<ModelSelectionOutput | null>(null);
  const [isSelectingModel, setIsSelectingModel] = useState<boolean>(false);
  const [modelProgress, setModelProgress] = useState<{
    completed: number;
    total: number;
    message: string;
  } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReqIdRef = useRef<number>(0);
  const lastComputedSignatureRef = useRef<string>('');

  const resetDownstreamOverrides = () => {
    setManualEntitySingular(null);
    setMethodOverrides({});
    setRemoveDuplicates(false);
    setTypeOverrides({});
    setDisplayNameOverrides({});
    setManualTargetY(null);
    setManualSelectedX(null);
    setManualLogTransform(null);
    setControlTypeOverrides({});
    setScenarioConfigs([]);
    setModelSelection(null);
    setModelProgress(null);
    setModelError(null);
    lastComputedSignatureRef.current = '';
  };

  const handleLoadSample = () => {
    const parsed = parseCsvText(SAMPLE_EUROPE_CSV, 'europa_ventas_computadores.csv');
    resetDownstreamOverrides();
    setExcelBuffer(null);
    setRawDataset(parsed);
    setBusinessQuestion(SAMPLE_BUSINESS_QUESTION);
    setYUnit(SAMPLE_Y_UNIT);
    setMaxUnlockedStep(2);
    setCurrentStep(1);
  };

  const handleUploadFile = async (file: File) => {
    const name = file.name;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    resetDownstreamOverrides();

    if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      setExcelBuffer(buf);
      const parsed = parseExcelBuffer(buf, name);
      if (parsed.rows.length < 5) {
        throw new Error('El archivo Excel debe contener al menos 5 filas de datos.');
      }
      setRawDataset(parsed);
      setMaxUnlockedStep(2);
    } else if (ext === 'csv' || ext === 'txt') {
      const text = await file.text();
      setExcelBuffer(null);
      const parsed = parseCsvText(text, name);
      if (parsed.rows.length < 5) {
        throw new Error('El archivo debe contener al menos 5 filas de datos.');
      }
      setRawDataset(parsed);
      setMaxUnlockedStep(2);
    } else {
      throw new Error('Formato no soportado. Sube un archivo .csv, .txt, .xlsx o .xls.');
    }
  };

  const handleSelectSheet = (sheetName: string) => {
    if (!excelBuffer || !rawDataset) return;
    resetDownstreamOverrides();
    const parsed = parseExcelBuffer(excelBuffer, rawDataset.fileName, sheetName);
    setRawDataset(parsed);
  };

  // Step 2: Quality
  const quality = useMemo(() => {
    if (!rawDataset) return null;
    const cols = rawDataset.mappings.map((m) => m.normalized);
    return analyzeDataQuality(rawDataset.rows, cols, methodOverrides, removeDuplicates);
  }, [rawDataset, methodOverrides, removeDuplicates]);

  // Step 3: Typing
  const typing = useMemo(() => {
    if (!rawDataset || !quality) return null;
    return processVariableTypes(
      quality.cleanedRows,
      rawDataset.mappings,
      quality.droppedColumns,
      typeOverrides
    );
  }, [rawDataset, quality, typeOverrides]);

  const suggestedEntitySingular = useMemo(() => {
    const colNames = rawDataset?.mappings.map((m) => m.normalized) ?? [];
    return suggestEntitySingular(typing?.identifierColumn ?? null, colNames);
  }, [typing?.identifierColumn, rawDataset]);

  const activeEntityInputValue =
    manualEntitySingular !== null
      ? manualEntitySingular
      : rawDataset
        ? suggestedEntitySingular
        : '';

  const entityLabels = useMemo(
    () => buildEntityLabels(activeEntityInputValue.trim() || suggestedEntitySingular || 'registro'),
    [activeEntityInputValue, suggestedEntitySingular]
  );

  const numericColumns = useMemo(
    () => (typing ? typing.profiles.filter((p) => p.selectedType === 'numeric').map((p) => p.name) : []),
    [typing]
  );

  const dummySet = useMemo(
    () => new Set(typing ? typing.dummyColumns.map((d) => d.name) : []),
    [typing]
  );

  const dateDerivedSourceMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!typing) return map;
    for (const p of typing.profiles) {
      if (p.isDateFeature && p.sourceColumn) {
        map[p.name] = p.sourceColumn;
      }
    }
    return map;
  }, [typing]);

  const dateFeatureSet = useMemo(
    () => new Set(Object.keys(dateDerivedSourceMap)),
    [dateDerivedSourceMap]
  );

  const displayNamesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (rawDataset) {
      for (const m of rawDataset.mappings) {
        map[m.normalized] = (displayNameOverrides[m.normalized] ?? m.displayName).trim() || m.displayName;
      }
    }
    if (typing) {
      for (const p of typing.profiles) {
        if (p.isDateFeature && p.sourceColumn) {
          const parentFriendly = map[p.sourceColumn] ?? p.sourceColumn;
          if (p.name.endsWith('_anio')) map[p.name] = `${parentFriendly} (año)`;
          else if (p.name.endsWith('_mes')) map[p.name] = `${parentFriendly} (mes)`;
          else if (p.name.endsWith('_antiguedad_dias')) map[p.name] = `${parentFriendly} (antigüedad días)`;
          else map[p.name] = p.originalName;
        }
      }
      for (const d of typing.dummyColumns) {
        const parentFriendly = map[d.sourceColumn] ?? d.sourceColumn;
        map[d.name] = `${parentFriendly}: ${d.level}`;
      }
    }
    return map;
  }, [rawDataset, displayNameOverrides, typing]);

  // Step 4: EDA Stats
  const stats = useMemo(() => {
    if (!typing) return [];
    return computeDescriptiveStats(typing.processedRows, numericColumns);
  }, [typing, numericColumns]);

  // Target Y suggestion (never suggests binary columns or derived date features)
  const ySuggestion = useMemo(() => {
    if (!typing) return { suggestedY: '', reason: '' };
    return suggestTargetY(businessQuestion, numericColumns, stats, typing.derivedAlerts, dateFeatureSet);
  }, [typing, businessQuestion, numericColumns, stats, dateFeatureSet]);

  const targetY =
    manualTargetY && numericColumns.includes(manualTargetY)
      ? manualTargetY
      : ySuggestion.suggestedY;

  const leakageMap = useMemo(() => {
    if (!typing || !targetY) return new Map<string, string>();
    return getLeakageBlockedForY(targetY, typing.derivedAlerts);
  }, [typing, targetY]);

  const leakageSet = useMemo(() => new Set(leakageMap.keys()), [leakageMap]);

  // Step 5: Candidates X
  const candidatesX = useMemo(() => {
    if (!typing || !targetY) return [];
    return buildCandidateXList(
      targetY,
      numericColumns,
      typing.dummyColumns,
      stats,
      typing.derivedAlerts,
      controlTypeOverrides,
      dateDerivedSourceMap
    );
  }, [typing, targetY, numericColumns, stats, controlTypeOverrides, dateDerivedSourceMap]);

  const controlTypesMap = useMemo(() => {
    const map: Record<string, VariableControlType> = {};
    for (const c of candidatesX) {
      map[c.name] = c.controlType;
    }
    return map;
  }, [candidatesX]);

  const defaultSelectedX = useMemo(
    () => candidatesX.filter((c) => c.suggestedInclude && !c.blockedByLeakage).map((c) => c.name),
    [candidatesX]
  );

  const selectedX = useMemo(() => {
    if (!manualSelectedX) return defaultSelectedX;
    const allowed = new Set(candidatesX.filter((c) => !c.blockedByLeakage).map((c) => c.name));
    return manualSelectedX.filter((x) => allowed.has(x));
  }, [manualSelectedX, defaultSelectedX, candidatesX]);

  const yStat = stats.find((s) => s.column === targetY);
  const isTargetYBinary = Boolean(yStat?.isBinary);
  const canLogTransformY = Boolean(yStat?.isAllPositive);

  const defaultLogTransform = useMemo(() => {
    if (!canLogTransformY) return false;
    const involvedStats = stats.filter(
      (s) => s.column === targetY || selectedX.includes(s.column)
    );
    const hasSkewGt1 = involvedStats.some((s) => Math.abs(s.skewness) > 1);
    const allPositiveInvolved = involvedStats.every((s) => s.isAllPositive);
    return hasSkewGt1 && allPositiveInvolved;
  }, [canLogTransformY, stats, targetY, selectedX]);

  const tryLogTransform = manualLogTransform !== null ? manualLogTransform : defaultLogTransform;

  // Step 6 & 7: Asynchronous Web Worker Model Selection
  const activeModelSignature = useMemo(() => {
    if (!typing || !targetY || selectedX.length === 0) return '';
    return JSON.stringify({
      n: typing.processedRows.length,
      yName: targetY,
      selectedX,
      tryLog: tryLogTransform && canLogTransformY,
      yUnit,
      dummies: typing.dummyColumns.map((d) => d.name),
      cols: typing.profiles.map((p) => `${p.name}:${p.selectedType}`).join(','),
      drop: quality?.droppedColumns.join(',') ?? '',
      rmDup: removeDuplicates,
      methods: JSON.stringify(methodOverrides),
    });
  }, [
    typing,
    targetY,
    selectedX,
    tryLogTransform,
    canLogTransformY,
    yUnit,
    quality?.droppedColumns,
    removeDuplicates,
    methodOverrides,
  ]);

  // Clear stale model selection when upstream model inputs change
  useEffect(() => {
    if (activeModelSignature !== lastComputedSignatureRef.current) {
      setModelSelection(null);
      setModelError(null);
    }
  }, [activeModelSignature]);

  useEffect(() => {
    if (currentStep < 6) return;
    if (!typing || !targetY || selectedX.length === 0 || !activeModelSignature) return;
    if (activeModelSignature === lastComputedSignatureRef.current && modelSelection) return;

    const reqId = ++workerReqIdRef.current;
    setIsSelectingModel(true);
    setModelError(null);
    setModelProgress({ completed: 0, total: 100, message: 'Iniciando búsqueda de modelos...' });

    if (typeof Worker === 'undefined') {
      try {
        const out = runModelSelection(
          typing.processedRows,
          typing.rowLabels,
          targetY,
          selectedX,
          dummySet,
          tryLogTransform && canLogTransformY,
          yUnit,
          typing.dummyColumns,
          (completed, total, message) => {
            setModelProgress({ completed, total, message });
          }
        );
        lastComputedSignatureRef.current = activeModelSignature;
        setModelSelection(out);
      } catch (err) {
        setModelError(
          err instanceof Error ? err.message : 'Error al estimar los modelos.'
        );
      } finally {
        setIsSelectingModel(false);
      }
      return;
    }

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    const worker = new Worker(
      new URL('./workers/modelSelection.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ModelWorkerResponse>) => {
      const msg = event.data;
      if (msg.requestId !== workerReqIdRef.current) return;
      if (msg.type === 'progress') {
        setModelProgress({ completed: msg.completed, total: msg.total, message: msg.message });
      } else if (msg.type === 'result') {
        lastComputedSignatureRef.current = activeModelSignature;
        setModelSelection(msg.output);
        setIsSelectingModel(false);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else if (msg.type === 'error') {
        setModelError(msg.message);
        setIsSelectingModel(false);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    worker.onerror = () => {
      if (reqId !== workerReqIdRef.current) return;
      setModelError('El proceso en segundo plano falló inesperadamente.');
      setIsSelectingModel(false);
    };

    const payload: ModelWorkerRequest = {
      requestId: reqId,
      rows: typing.processedRows,
      rowLabels: typing.rowLabels,
      yName: targetY,
      selectedX,
      dummySetArray: Array.from(dummySet),
      tryLogTransform: tryLogTransform && canLogTransformY,
      yUnit,
      dummyColumns: typing.dummyColumns.map((d) => ({
        name: d.name,
        sourceColumn: d.sourceColumn,
      })),
    };
    worker.postMessage(payload);

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [
    currentStep,
    activeModelSignature,
    typing,
    targetY,
    selectedX,
    dummySet,
    tryLogTransform,
    canLogTransformY,
    yUnit,
    modelSelection,
  ]);

  const bestModel = modelSelection?.bestModel ?? null;

  // Reset manual scenario edits whenever bestModel changes
  useEffect(() => {
    setScenarioConfigs([]);
  }, [bestModel?.id]);

  const activeScenarioConfigs = useMemo(() => {
    if (!bestModel) return [];
    const map = new Map(scenarioConfigs.map((c) => [c.variable, c]));
    return buildDefaultScenarioConfigs(bestModel, dummySet, controlTypesMap, horizonYears).map(
      (def) => map.get(def.variable) ?? def
    );
  }, [bestModel, scenarioConfigs, dummySet, controlTypesMap, horizonYears]);

  // Step 8: Scenarios, Monte Carlo & Tornado
  const scenarios = useMemo(() => {
    if (!bestModel || !typing) return [];
    return runScenarioProjections(
      bestModel,
      typing.processedRows,
      activeScenarioConfigs,
      horizonYears,
      dummySet
    );
  }, [bestModel, typing, activeScenarioConfigs, horizonYears, dummySet]);

  const monteCarlo = useMemo(() => {
    if (!bestModel || !typing) return null;
    return runMonteCarloSimulation(
      bestModel,
      typing.processedRows,
      activeScenarioConfigs,
      horizonYears,
      dummySet,
      10000,
      42
    );
  }, [bestModel, typing, activeScenarioConfigs, horizonYears, dummySet]);

  const sensitivity = useMemo(() => {
    if (!bestModel || !typing) return [];
    return runSensitivityTornado(bestModel, typing.processedRows, dummySet);
  }, [bestModel, typing, dummySet]);

  // Step 9: Recommendations
  const recommendations = useMemo(() => {
    if (!bestModel || !typing || scenarios.length === 0) return [];
    return generateScenarioRecommendations(
      bestModel,
      scenarios,
      sensitivity,
      horizonYears,
      yUnit,
      activeScenarioConfigs,
      typing.processedRows,
      controlTypesMap,
      typing.dummyColumns,
      displayNamesMap,
      entityLabels.singular
    );
  }, [
    bestModel,
    typing,
    scenarios,
    sensitivity,
    horizonYears,
    yUnit,
    activeScenarioConfigs,
    controlTypesMap,
    displayNamesMap,
    entityLabels.singular,
  ]);

  // Step 4 helpers for Step 10 Word report
  const pearsonMatrix = useMemo(() => {
    if (!typing || numericColumns.length === 0) return [];
    return computeCorrelationMatrix(typing.processedRows, numericColumns, 'pearson');
  }, [typing, numericColumns]);

  const businessRules = useMemo(() => {
    if (!typing || !targetY) return [];
    return generateBusinessRules(
      typing.processedRows,
      numericColumns,
      targetY,
      leakageSet,
      typing.derivedAlerts,
      displayNamesMap,
      dateDerivedSourceMap
    );
  }, [typing, numericColumns, targetY, leakageSet, displayNamesMap, dateDerivedSourceMap]);

  // Step 10: Python & R code
  const scriptParams = useMemo(() => {
    if (!bestModel || !typing || !quality) return null;
    const dateColumns = typing.profiles
      .filter((p) => p.selectedType === 'date' && p.dateDerivedNames && p.dateDerivedNames.length === 3)
      .map((p) => ({
        column: p.name,
        anioCol: p.dateDerivedNames![0],
        mesCol: p.dateDerivedNames![1],
        diasCol: p.dateDerivedNames![2],
      }));
    return {
      businessQuestion,
      model: bestModel,
      identifierCol: typing.identifierColumn,
      dummySet,
      dummyColumns: typing.dummyColumns,
      imputationSummary: quality.missingSummary.map((m) => ({
        column: m.column,
        method: m.selectedMethod,
      })),
      droppedColumns: quality.droppedColumns,
      dropRowsColumns: quality.missingSummary
        .filter((m) => m.selectedMethod === 'drop_rows')
        .map((m) => m.column),
      removeDuplicates,
      profiles: typing.profiles,
      selectedSheet: rawDataset?.selectedSheet,
      scenarioConfigs: activeScenarioConfigs,
      horizonYears,
      dateColumns,
    };
  }, [
    bestModel,
    typing,
    quality,
    businessQuestion,
    dummySet,
    removeDuplicates,
    rawDataset?.selectedSheet,
    activeScenarioConfigs,
    horizonYears,
  ]);

  const pythonCode = useMemo(() => {
    if (!scriptParams) return '';
    return generatePythonScript(scriptParams);
  }, [scriptParams]);

  const rCode = useMemo(() => {
    if (!scriptParams) return '';
    return generateRScript(scriptParams);
  }, [scriptParams]);

  const goToStep = (step: number) => {
    setMaxUnlockedStep((prev) => Math.max(prev, step));
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentStepMeta = STEPS.find((s) => s.id === currentStep);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        currentStep={currentStep}
        maxUnlockedStep={maxUnlockedStep}
        onSelectStep={(s) => setCurrentStep(s)}
        datasetInfo={
          rawDataset
            ? {
                fileName: rawDataset.fileName,
                rows: quality?.cleanedRows.length ?? rawDataset.rows.length,
                cols: rawDataset.mappings.length - (quality?.droppedColumns.length ?? 0),
              }
            : null
        }
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <MobileMenuButton onClick={() => setMobileOpen(true)} />
            <div className="text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900">
                Paso {currentStep} de 10
              </span>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              <span>{currentStepMeta?.title}</span>
            </div>
          </div>

          {businessQuestion.trim() && (
            <div
              className="hidden md:block text-xs text-slate-500 truncate max-w-md"
              title={businessQuestion}
            >
              {businessQuestion}
            </div>
          )}
        </header>

        {/* Main Workspace */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {currentStep === 1 && (
            <Step1Upload
              businessQuestion={businessQuestion}
              onChangeBusinessQuestion={setBusinessQuestion}
              yUnit={yUnit}
              onChangeYUnit={setYUnit}
              entitySingular={activeEntityInputValue}
              entityPlural={entityLabels.plural}
              onChangeEntitySingular={setManualEntitySingular}
              fileName={rawDataset?.fileName ?? null}
              delimiterUsed={rawDataset?.delimiterUsed}
              sheetNames={rawDataset?.sheetNames}
              selectedSheet={rawDataset?.selectedSheet}
              onSelectSheet={handleSelectSheet}
              mappings={rawDataset?.mappings ?? []}
              displayNameOverrides={displayNameOverrides}
              onChangeDisplayName={(norm, val) =>
                setDisplayNameOverrides((prev) => ({ ...prev, [norm]: val }))
              }
              rows={rawDataset?.rows ?? []}
              onUploadFile={handleUploadFile}
              onLoadSample={handleLoadSample}
              onNext={() => goToStep(2)}
            />
          )}

          {currentStep === 2 && quality && (
            <Step2Quality
              quality={quality}
              methodOverrides={methodOverrides}
              onChangeMethod={(col, method) =>
                setMethodOverrides((prev) => ({ ...prev, [col]: method }))
              }
              removeDuplicates={removeDuplicates}
              onToggleRemoveDuplicates={setRemoveDuplicates}
              onPrev={() => goToStep(1)}
              onNext={() => goToStep(3)}
            />
          )}

          {currentStep === 3 && typing && (
            <Step3Types
              typing={typing}
              typeOverrides={typeOverrides}
              onChangeType={(col, t) => {
                setTypeOverrides((prev) => ({ ...prev, [col]: t }));
                setManualSelectedX(null);
              }}
              entitySingular={entityLabels.singular}
              onPrev={() => goToStep(2)}
              onNext={() => goToStep(4)}
            />
          )}

          {currentStep === 4 && typing && (
            <Step4EDA
              rows={typing.processedRows}
              rowLabels={typing.rowLabels}
              numericColumns={numericColumns}
              stats={stats}
              targetY={targetY}
              onChangeTargetY={(col) => {
                setManualTargetY(col);
                setManualSelectedX(null);
              }}
              leakageBlockedForY={leakageSet}
              derivedAlerts={typing.derivedAlerts}
              displayNames={displayNamesMap}
              dateDerivedSourceMap={dateDerivedSourceMap}
              isTargetYBinary={isTargetYBinary}
              onPrev={() => goToStep(3)}
              onNext={() => goToStep(5)}
            />
          )}

          {currentStep === 5 && typing && (
            <Step5Variables
              numericColumns={numericColumns}
              targetY={targetY}
              targetYReason={
                manualTargetY
                  ? `Seleccionada manualmente por el usuario (${displayNamesMap[manualTargetY] ?? manualTargetY}).`
                  : ySuggestion.reason
              }
              onChangeTargetY={(col) => {
                setManualTargetY(col);
                setManualSelectedX(null);
              }}
              candidatesX={candidatesX}
              selectedX={selectedX}
              onToggleX={(name) => {
                const current = new Set(selectedX);
                if (current.has(name)) current.delete(name);
                else current.add(name);
                setManualSelectedX(Array.from(current));
              }}
              onChangeControlType={(name, controlType) => {
                setControlTypeOverrides((prev) => ({ ...prev, [name]: controlType }));
                setScenarioConfigs((prev) => prev.filter((c) => c.variable !== name));
              }}
              tryLogTransform={tryLogTransform}
              onToggleLogTransform={(v) => setManualLogTransform(v)}
              canLogTransformY={canLogTransformY}
              isTargetYBinary={isTargetYBinary}
              displayNames={displayNamesMap}
              onPrev={() => goToStep(4)}
              onNext={() => goToStep(6)}
            />
          )}

          {currentStep === 6 && (
            <Step6ModelSelection
              selection={modelSelection}
              isCalculating={isSelectingModel}
              progress={modelProgress}
              errorMsg={modelError}
              onPrev={() => goToStep(5)}
              onNext={() => goToStep(7)}
            />
          )}

          {currentStep === 7 && bestModel && (
            <Step7FormulaGap
              model={bestModel}
              yUnit={yUnit}
              displayNames={displayNamesMap}
              entityLabels={entityLabels}
              onPrev={() => goToStep(6)}
              onNext={() => goToStep(8)}
            />
          )}

          {currentStep === 8 && bestModel && monteCarlo && (
            <Step8Scenarios
              model={bestModel}
              yUnit={yUnit}
              horizonYears={horizonYears}
              onChangeHorizon={setHorizonYears}
              configs={activeScenarioConfigs}
              onUpdateConfig={(variable, patch) => {
                setScenarioConfigs((prev) => {
                  const baseObj =
                    prev.find((c) => c.variable === variable) ??
                    activeScenarioConfigs.find((c) => c.variable === variable);
                  if (!baseObj) return prev;
                  const updated = { ...baseObj, ...patch };
                  const exists = prev.some((c) => c.variable === variable);
                  return exists
                    ? prev.map((c) => (c.variable === variable ? updated : c))
                    : [...prev, updated];
                });
              }}
              scenarios={scenarios}
              monteCarlo={monteCarlo}
              sensitivity={sensitivity}
              displayNames={displayNamesMap}
              entitySingular={entityLabels.singular}
              onPrev={() => goToStep(7)}
              onNext={() => goToStep(9)}
            />
          )}

          {currentStep === 9 && bestModel && (
            <Step9Recommendations
              model={bestModel}
              yUnit={yUnit}
              recommendations={recommendations}
              displayNames={displayNamesMap}
              entityLabels={entityLabels}
              onPrev={() => goToStep(8)}
              onNext={() => goToStep(10)}
            />
          )}

          {currentStep === 10 &&
            bestModel &&
            modelSelection &&
            quality &&
            typing &&
            rawDataset &&
            monteCarlo && (
              <Step10Downloads
                businessQuestion={businessQuestion}
                yUnit={yUnit}
                fileName={rawDataset.fileName}
                mappings={rawDataset.mappings}
                quality={quality}
                profiles={typing.profiles}
                stats={stats}
                rules={businessRules}
                numericColumns={numericColumns}
                corrMatrix={pearsonMatrix}
                candidatesX={candidatesX}
                allModels={modelSelection.allModels}
                bestModel={bestModel}
                selectionExplanation={modelSelection.selectionExplanation}
                selectionMethodReason={modelSelection.selectionMethodReason}
                displayNames={displayNamesMap}
                entitySingular={entityLabels.singular}
                dummyColumns={typing.dummyColumns}
                scenarios={scenarios}
                monteCarlo={monteCarlo}
                sensitivity={sensitivity}
                horizonYears={horizonYears}
                recommendations={recommendations}
                pythonCode={pythonCode}
                rCode={rCode}
                onPrev={() => goToStep(9)}
              />
            )}
        </main>
      </div>
    </div>
  );
}
