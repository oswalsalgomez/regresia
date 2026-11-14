import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  ColumnMapping,
  ColumnProfile,
  DataQualityReport,
  DerivedVariableAlert,
  ImputationMethod,
  MissingColumnInfo,
  OutlierRecord,
  VariableType,
} from '../types/regression';
import {
  computeDateFeatures,
  formatIsoDateUTC,
  getTodayMidnightUTC,
  isEmptyCell,
  normalizeColumnNames,
  parseFlexibleDate,
  parseFlexibleNumber,
} from '../utils/formatters';

export interface ParsedDatasetRaw {
  fileName: string;
  delimiterUsed?: string;
  sheetNames?: string[];
  selectedSheet?: string;
  mappings: ColumnMapping[];
  rows: Record<string, unknown>[];
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [',', ';', '\t'];
  let bestDelim = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const parsed = Papa.parse<string[]>(firstLines, { delimiter: delim, skipEmptyLines: true });
    if (parsed.data.length === 0) continue;
    const widths = parsed.data.map((r) => r.length);
    const firstW = widths[0];
    if (firstW <= 1) continue;
    const consistent = widths.filter((w) => w === firstW).length;
    const score = consistent * 100 + firstW;
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }
  return bestDelim;
}

export function parseCsvText(text: string, fileName: string): ParsedDatasetRaw {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const delimiter = detectDelimiter(cleanText);
  const parsed = Papa.parse<Record<string, unknown>>(cleanText, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rawHeaders = parsed.meta.fields ?? [];
  const mappings = normalizeColumnNames(rawHeaders);
  const headerMap = new Map(mappings.map((m) => [m.original, m.normalized]));

  const rows = parsed.data.map((row) => {
    const out: Record<string, unknown> = {};
    for (const orig of rawHeaders) {
      const norm = headerMap.get(orig) ?? orig;
      out[norm] = row[orig];
    }
    return out;
  });

  const delimLabel = delimiter === '\t' ? 'Tabulación (\\t)' : delimiter === ';' ? 'Punto y coma (;)' : 'Coma (,)';
  return {
    fileName,
    delimiterUsed: delimLabel,
    mappings,
    rows,
  };
}

export function getExcelSheetNames(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames;
}

export function parseExcelBuffer(buffer: ArrayBuffer, fileName: string, sheetName?: string): ParsedDatasetRaw {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const chosenSheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[chosenSheet];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const rawHeaders = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  const mappings = normalizeColumnNames(rawHeaders);
  const headerMap = new Map(mappings.map((m) => [m.original, m.normalized]));

  const rows = rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const orig of rawHeaders) {
      const norm = headerMap.get(orig) ?? orig;
      const cell = row[orig];
      out[norm] = cell instanceof Date && Number.isFinite(cell.getTime()) ? formatIsoDateUTC(cell) : cell;
    }
    return out;
  });

  return {
    fileName,
    sheetNames: wb.SheetNames,
    selectedSheet: chosenSheet,
    mappings,
    rows,
  };
}

function isDateHintName(col: string): boolean {
  const low = col.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /(fecha|date|registro|alta|baja|nacimiento|created|updated|fec_)/.test(low);
}

function inferDateColumn(rows: Record<string, unknown>[], col: string): boolean {
  let nonEmpty = 0;
  let dateOk = 0;
  const allowSerial = isDateHintName(col);
  for (const row of rows) {
    const val = row[col];
    if (isEmptyCell(val)) continue;
    nonEmpty++;
    if (parseFlexibleDate(val, allowSerial) !== null) dateOk++;
  }
  return nonEmpty > 0 && dateOk / nonEmpty >= 0.8;
}

function inferNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  if (inferDateColumn(rows, col)) return false;
  let nonEmpty = 0;
  let numericOk = 0;
  for (const row of rows) {
    const val = row[col];
    if (isEmptyCell(val)) continue;
    nonEmpty++;
    if (parseFlexibleNumber(val).value !== null) numericOk++;
  }
  return nonEmpty > 0 && numericOk / nonEmpty >= 0.8;
}

function computeMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeQuantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function computeMode(values: unknown[]): unknown {
  const counts = new Map<string, { val: unknown; count: number }>();
  for (const v of values) {
    if (isEmptyCell(v)) continue;
    const key = String(v).trim();
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { val: v, count: 1 });
  }
  let best: { val: unknown; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best ? best.val : '';
}

export function analyzeDataQuality(
  rawRows: Record<string, unknown>[],
  columns: string[],
  methodOverrides: Record<string, ImputationMethod>,
  removeDuplicates = false
): DataQualityReport {
  const totalRows = rawRows.length;
  const totalCols = columns.length;

  // Duplicate count
  const seen = new Set<string>();
  let duplicateCount = 0;
  const dedupedRows: Record<string, unknown>[] = [];
  for (const r of rawRows) {
    const sig = JSON.stringify(columns.map((c) => (r[c] === undefined || r[c] === null ? '' : String(r[c]).trim())));
    if (seen.has(sig)) {
      duplicateCount++;
      if (!removeDuplicates) dedupedRows.push({ ...r });
    } else {
      seen.add(sig);
      dedupedRows.push({ ...r });
    }
  }

  const workingRows = dedupedRows.map((r) => ({ ...r }));

  // Missing summary
  const missingSummary: MissingColumnInfo[] = columns.map((col) => {
    let missingCount = 0;
    for (const r of workingRows) {
      if (isEmptyCell(r[col])) missingCount++;
    }
    const missingPct = workingRows.length > 0 ? (missingCount / workingRows.length) * 100 : 0;
    const inferredKind = inferNumericColumn(workingRows, col) ? 'numeric' : 'categorical';

    let suggestedMethod: ImputationMethod = 'none';
    if (missingCount > 0) {
      if (missingPct > 30) {
        suggestedMethod = 'drop_column';
      } else if (inferredKind === 'numeric') {
        suggestedMethod = 'median';
      } else {
        suggestedMethod = 'mode';
      }
    }

    const selectedMethod =
      missingCount === 0
        ? 'none'
        : methodOverrides[col] && methodOverrides[col] !== 'none'
          ? methodOverrides[col]
          : suggestedMethod;

    return {
      column: col,
      missingCount,
      missingPct,
      inferredKind,
      suggestedMethod,
      selectedMethod,
    };
  });

  const hasAnyMissing = missingSummary.some((m) => m.missingCount > 0);
  const droppedColumns = missingSummary
    .filter((m) => m.selectedMethod === 'drop_column')
    .map((m) => m.column);

  // Drop rows if any column uses 'drop_rows'
  const dropRowsCols = new Set(
    missingSummary.filter((m) => m.selectedMethod === 'drop_rows').map((m) => m.column)
  );

  let cleanedRows = workingRows.filter((r) => {
    for (const c of dropRowsCols) {
      if (isEmptyCell(r[c])) return false;
    }
    return true;
  });
  const droppedRowsCount = workingRows.length - cleanedRows.length;

  // Remove dropped columns from cleanedRows
  if (droppedColumns.length > 0) {
    cleanedRows = cleanedRows.map((r) => {
      const copy: Record<string, unknown> = {};
      for (const c of columns) {
        if (!droppedColumns.includes(c)) copy[c] = r[c];
      }
      return copy;
    });
  }

  // Impute remaining missing values
  for (const info of missingSummary) {
    if (info.missingCount === 0 || info.selectedMethod === 'none' || info.selectedMethod === 'drop_column' || info.selectedMethod === 'drop_rows') {
      continue;
    }
    const col = info.column;
    if (info.selectedMethod === 'median' || info.selectedMethod === 'mean') {
      const nums: number[] = [];
      for (const r of cleanedRows) {
        if (!isEmptyCell(r[col])) {
          const parsed = parseFlexibleNumber(r[col]).value;
          if (parsed !== null) nums.push(parsed);
        }
      }
      const fillVal =
        info.selectedMethod === 'median'
          ? computeMedian(nums)
          : nums.length > 0
            ? nums.reduce((a, b) => a + b, 0) / nums.length
            : 0;
      for (const r of cleanedRows) {
        if (isEmptyCell(r[col])) r[col] = fillVal;
      }
    } else if (info.selectedMethod === 'mode') {
      const fillVal = computeMode(cleanedRows.map((r) => r[col]));
      for (const r of cleanedRows) {
        if (isEmptyCell(r[col])) r[col] = fillVal;
      }
    }
  }

  // Detect IQR outliers (1.5x) WITHOUT removing them
  const activeCols = columns.filter((c) => !droppedColumns.includes(c));
  // Find best row label column (first non-numeric column or row index)
  const labelCol = activeCols.find((c) => !inferNumericColumn(cleanedRows, c));

  const outliers: OutlierRecord[] = [];
  for (const col of activeCols) {
    if (!inferNumericColumn(cleanedRows, col)) continue;
    const vals: { idx: number; val: number }[] = [];
    cleanedRows.forEach((r, idx) => {
      const num = parseFlexibleNumber(r[col]).value;
      if (num !== null) vals.push({ idx, val: num });
    });
    if (vals.length < 4) continue;
    const sorted = vals.map((v) => v.val).sort((a, b) => a - b);
    const q1 = computeQuantile(sorted, 0.25);
    const q3 = computeQuantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;

    for (const item of vals) {
      if (item.val < lowerFence || item.val > upperFence) {
        const rowLabel = labelCol ? String(cleanedRows[item.idx][labelCol] ?? `Fila ${item.idx + 1}`) : `Fila ${item.idx + 1}`;
        outliers.push({
          rowIndex: item.idx + 1,
          rowLabel,
          column: col,
          value: item.val,
          lowerFence,
          upperFence,
          side: item.val < lowerFence ? 'bajo' : 'alto',
        });
      }
    }
  }

  return {
    totalRows,
    totalCols,
    duplicateCount,
    missingSummary,
    hasAnyMissing,
    outliers,
    cleanedRows,
    droppedRowsCount,
    droppedColumns,
  };
}

export interface VariableTypingResult {
  profiles: ColumnProfile[];
  processedRows: Record<string, unknown>[];
  dummyColumns: { name: string; sourceColumn: string; level: string; referenceLevel: string }[];
  rowLabels: string[];
  identifierColumn: string | null;
  derivedAlerts: DerivedVariableAlert[];
}

export function processVariableTypes(
  cleanedRows: Record<string, unknown>[],
  mappings: ColumnMapping[],
  droppedColumns: string[],
  typeOverrides: Record<string, VariableType>
): VariableTypingResult {
  const activeMappings = mappings.filter((m) => !droppedColumns.includes(m.normalized));
  const n = cleanedRows.length;

  const processedRows: Record<string, unknown>[] = cleanedRows.map((r) => ({ ...r }));
  const profiles: ColumnProfile[] = [];

  for (const map of activeMappings) {
    const col = map.normalized;
    let nonNullCount = 0;
    let numericOk = 0;
    let dateOk = 0;
    const allowSerial = isDateHintName(col);
    const distinctSet = new Set<string>();

    for (const r of processedRows) {
      const raw = r[col];
      if (isEmptyCell(raw)) continue;
      nonNullCount++;
      distinctSet.add(String(raw).trim());
      if (parseFlexibleDate(raw, allowSerial) !== null) {
        dateOk++;
      }
      const parsed = parseFlexibleNumber(raw);
      if (parsed.value !== null) {
        numericOk++;
      }
    }

    const isDateCandidate = nonNullCount > 0 && dateOk / nonNullCount >= 0.8;
    const isNumericCandidate = !isDateCandidate && nonNullCount > 0 && numericOk === nonNullCount;
    let detectedType: VariableType = 'categorical';

    if (isDateCandidate) {
      detectedType = 'date';
    } else if (isNumericCandidate) {
      detectedType = 'numeric';
    } else if (nonNullCount > 0 && distinctSet.size === nonNullCount) {
      detectedType = 'identifier';
    } else {
      detectedType = 'categorical';
    }

    const selectedType = typeOverrides[col] ?? detectedType;

    // Normalize numeric values in processedRows if numeric
    let actualCommaFixed = 0;
    const numericDistinct = new Set<number>();
    if (selectedType === 'numeric') {
      for (const r of processedRows) {
        const parsed = parseFlexibleNumber(r[col]);
        if (parsed.value !== null) {
          r[col] = parsed.value;
          numericDistinct.add(parsed.value);
          if (parsed.wasCommaDecimal) actualCommaFixed++;
        }
      }
    }

    const isBinary =
      selectedType === 'numeric' &&
      numericDistinct.size === 2 &&
      numericDistinct.has(0) &&
      numericDistinct.has(1);

    const levels =
      selectedType === 'categorical'
        ? Array.from(distinctSet).sort((a, b) => a.localeCompare(b, 'es'))
        : undefined;

    profiles.push({
      name: col,
      originalName: map.original,
      detectedType,
      selectedType,
      uniqueCount: distinctSet.size,
      nonNullCount,
      commaDecimalFixedCount: actualCommaFixed,
      isBinary,
      levels,
      referenceLevel: levels && levels.length > 0 ? levels[0] : undefined,
      dummyNames: [],
    });
  }

  const usedNames = new Set(profiles.map((p) => p.name));

  // Create derived numeric variables (year, month, age in days until today) for date columns
  const todayUTC = getTodayMidnightUTC();
  const extraDateProfiles: ColumnProfile[] = [];
  for (const prof of profiles) {
    if (prof.selectedType !== 'date') continue;
    const allowSerial = true; // Explicit date type allows Excel serial numbers too
    const parsedDates: (Date | null)[] = processedRows.map((r) =>
      parseFlexibleDate(r[prof.name], allowSerial)
    );
    const validTimes = parsedDates
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime())
      .sort((a, b) => a - b);
    const fallbackDate =
      validTimes.length > 0
        ? new Date(validTimes[Math.floor(validTimes.length / 2)])
        : new Date(todayUTC);

    const makeUniqueName = (base: string) => {
      let cand = base;
      let s = 2;
      while (usedNames.has(cand)) cand = `${base}_${s++}`;
      usedNames.add(cand);
      return cand;
    };

    const yearCol = makeUniqueName(`${prof.name}_anio`);
    const monthCol = makeUniqueName(`${prof.name}_mes`);
    const ageCol = makeUniqueName(`${prof.name}_antiguedad_dias`);

    const yearSet = new Set<number>();
    const monthSet = new Set<number>();
    const ageSet = new Set<number>();

    for (let i = 0; i < processedRows.length; i++) {
      const d = parsedDates[i] ?? fallbackDate;
      const feats = computeDateFeatures(d, todayUTC);
      processedRows[i][yearCol] = feats.year;
      processedRows[i][monthCol] = feats.month;
      processedRows[i][ageCol] = feats.ageDays;
      yearSet.add(feats.year);
      monthSet.add(feats.month);
      ageSet.add(feats.ageDays);
    }

    prof.dateDerivedNames = [yearCol, monthCol, ageCol];

    extraDateProfiles.push(
      {
        name: yearCol,
        originalName: `${prof.originalName} (año)`,
        detectedType: 'numeric',
        selectedType: 'numeric',
        uniqueCount: yearSet.size,
        nonNullCount: processedRows.length,
        commaDecimalFixedCount: 0,
        isDateFeature: true,
        sourceColumn: prof.name,
      },
      {
        name: monthCol,
        originalName: `${prof.originalName} (mes)`,
        detectedType: 'numeric',
        selectedType: 'numeric',
        uniqueCount: monthSet.size,
        nonNullCount: processedRows.length,
        commaDecimalFixedCount: 0,
        isDateFeature: true,
        sourceColumn: prof.name,
      },
      {
        name: ageCol,
        originalName: `${prof.originalName} (antigüedad días)`,
        detectedType: 'numeric',
        selectedType: 'numeric',
        uniqueCount: ageSet.size,
        nonNullCount: processedRows.length,
        commaDecimalFixedCount: 0,
        isDateFeature: true,
        sourceColumn: prof.name,
      }
    );
  }
  profiles.push(...extraDateProfiles);

  // Create dummies for categoricals with <= 10 levels (first category as reference)
  const dummyColumns: { name: string; sourceColumn: string; level: string; referenceLevel: string }[] = [];

  for (const prof of profiles) {
    if (prof.selectedType === 'categorical' && prof.levels && prof.levels.length >= 2 && prof.levels.length <= 10) {
      const ref = prof.levels[0];
      prof.referenceLevel = ref;
      const created: string[] = [];

      for (let i = 1; i < prof.levels.length; i++) {
        const lvl = prof.levels[i];
        const cleanLvl = lvl
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9_]+/g, '_')
          .replace(/^_+|_+$/g, '') || `niv_${i}`;
        let dummyName = `${prof.name}_${cleanLvl}`;
        let k = 2;
        while (usedNames.has(dummyName)) {
          dummyName = `${prof.name}_${cleanLvl}_${k++}`;
        }
        usedNames.add(dummyName);
        created.push(dummyName);
        dummyColumns.push({
          name: dummyName,
          sourceColumn: prof.name,
          level: lvl,
          referenceLevel: ref,
        });

        for (const r of processedRows) {
          const val = isEmptyCell(r[prof.name]) ? '' : String(r[prof.name]).trim();
          r[dummyName] = val === lvl ? 1 : 0;
        }
      }
      prof.dummyNames = created;
    }
  }

  // Row labels from first identifier (never a date column; fallback to Fila #)
  const idProfile = profiles.find((p) => p.selectedType === 'identifier') ?? null;
  const rowLabels = Array.from({ length: n }, (_, i) =>
    idProfile ? String(processedRows[i][idProfile.name] ?? `Fila ${i + 1}`) : `Fila ${i + 1}`
  );

  // Detect derived variables (A = B * C or A = B / C with < 1% relative error)
  const numericCols = profiles.filter((p) => p.selectedType === 'numeric').map((p) => p.name);
  const derivedAlerts: DerivedVariableAlert[] = [];
  const seenRelations = new Set<string>();

  for (const target of numericCols) {
    for (let i = 0; i < numericCols.length; i++) {
      const colA = numericCols[i];
      if (colA === target) continue;
      for (let j = 0; j < numericCols.length; j++) {
        const colB = numericCols[j];
        if (colB === target || colB === colA) continue;

        // Check target ≈ colA / colB
        let validCount = 0;
        let maxErrQuot = 0;
        let okQuot = true;
        for (const r of processedRows) {
          const t = Number(r[target]);
          const a = Number(r[colA]);
          const b = Number(r[colB]);
          if (!Number.isFinite(t) || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-12) {
            okQuot = false;
            break;
          }
          const pred = a / b;
          const relErr = Math.abs(t - pred) / Math.max(Math.abs(t), Math.abs(pred), 1e-9);
          if (relErr > maxErrQuot) maxErrQuot = relErr;
          validCount++;
        }
        if (okQuot && validCount >= 3 && maxErrQuot < 0.01) {
          const key = `div:${target}:${colA}:${colB}`;
          if (!seenRelations.has(key)) {
            seenRelations.add(key);
            derivedAlerts.push({
              derivedCol: target,
              colA,
              colB,
              operation: 'quotient',
              maxRelError: maxErrQuot * 100,
              formulaText: `${target} ≈ ${colA} / ${colB}`,
            });
          }
        }

        // Check target ≈ colA * colB (only once for i < j)
        if (i < j) {
          let validProd = 0;
          let maxErrProd = 0;
          let okProd = true;
          for (const r of processedRows) {
            const t = Number(r[target]);
            const a = Number(r[colA]);
            const b = Number(r[colB]);
            if (!Number.isFinite(t) || !Number.isFinite(a) || !Number.isFinite(b)) {
              okProd = false;
              break;
            }
            const pred = a * b;
            const relErr = Math.abs(t - pred) / Math.max(Math.abs(t), Math.abs(pred), 1e-9);
            if (relErr > maxErrProd) maxErrProd = relErr;
            validProd++;
          }
          if (okProd && validProd >= 3 && maxErrProd < 0.01) {
            const key = `mul:${target}:${colA}:${colB}`;
            if (!seenRelations.has(key)) {
              seenRelations.add(key);
              derivedAlerts.push({
                derivedCol: target,
                colA,
                colB,
                operation: 'product',
                maxRelError: maxErrProd * 100,
                formulaText: `${target} ≈ ${colA} × ${colB}`,
              });
            }
          }
        }
      }
    }
  }

  // Deduplicate algebraic rearrangements so each triplet {A, B, C} emits ONE alert,
  // choosing the true derived column (ratio/product name heuristic, then lower error, then later column).
  const derivedNameScore = (name: string): number => {
    const low = name.toLowerCase();
    let score = 0;
    if (/(per_|_per_|capita|ratio|rate|tasa|pct|share|cuota|margin|margen|avg|mean|index|total)/.test(low)) {
      score += 10;
    }
    if (low.includes('_')) score += 1;
    return score;
  };

  const colIndexMap = new Map(numericCols.map((c, idx) => [c, idx]));
  const bestByTriplet = new Map<string, DerivedVariableAlert>();

  for (const alert of derivedAlerts) {
    const tripletKey = [alert.derivedCol, alert.colA, alert.colB].sort().join('|');
    const existing = bestByTriplet.get(tripletKey);
    if (!existing) {
      bestByTriplet.set(tripletKey, alert);
      continue;
    }

    const scoreNew = derivedNameScore(alert.derivedCol);
    const scoreOld = derivedNameScore(existing.derivedCol);
    if (scoreNew > scoreOld) {
      bestByTriplet.set(tripletKey, alert);
    } else if (scoreNew === scoreOld) {
      // Prefer quotient over product if same score, or later column index
      if (alert.operation === 'quotient' && existing.operation !== 'quotient') {
        bestByTriplet.set(tripletKey, alert);
      } else if (alert.operation === existing.operation) {
        const idxNew = colIndexMap.get(alert.derivedCol) ?? 0;
        const idxOld = colIndexMap.get(existing.derivedCol) ?? 0;
        if (idxNew > idxOld) bestByTriplet.set(tripletKey, alert);
      }
    }
  }

  return {
    profiles,
    processedRows,
    dummyColumns,
    rowLabels,
    identifierColumn: idProfile ? idProfile.name : null,
    derivedAlerts: Array.from(bestByTriplet.values()),
  };
}
