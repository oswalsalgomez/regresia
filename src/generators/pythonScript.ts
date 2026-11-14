import {
  ColumnProfile,
  ImputationMethod,
  RegressionModelResult,
  VariableScenarioConfig,
} from '../types/regression';

export interface ScriptGeneratorParams {
  businessQuestion: string;
  model: RegressionModelResult;
  identifierCol: string | null;
  dummySet: Set<string>;
  dummyColumns: { name: string; sourceColumn: string; level: string; referenceLevel: string }[];
  imputationSummary: { column: string; method: ImputationMethod }[];
  droppedColumns: string[];
  dropRowsColumns: string[];
  removeDuplicates: boolean;
  profiles: ColumnProfile[];
  selectedSheet?: string;
  scenarioConfigs: VariableScenarioConfig[];
  horizonYears: number;
  dateColumns?: { column: string; anioCol: string; mesCol: string; diasCol: string }[];
}

function normalizeLevelJS(level: string): string {
  return level
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function generatePythonScript(params: ScriptGeneratorParams): string {
  const {
    businessQuestion,
    model,
    identifierCol,
    dummySet,
    dummyColumns,
    imputationSummary,
    droppedColumns,
    dropRowsColumns,
    removeDuplicates,
    profiles,
    selectedSheet,
    scenarioConfigs,
    horizonYears,
  } = params;

  const isLogLog = model.transform === 'log-log';
  const yCol = model.yName;
  const preds = model.predictors;
  const predsPy = JSON.stringify(preds);
  const contPreds = preds.filter((p) => !dummySet.has(p));
  const contPredsPy = JSON.stringify(contPreds);
  const numericColsStep3 = profiles.filter((p) => p.selectedType === 'numeric' && !p.isDateFeature).map((p) => p.name);
  const catColsStep3 = profiles.filter((p) => p.selectedType === 'categorical').map((p) => p.name);
  const derivedDateSpecs =
    params.dateColumns && params.dateColumns.length > 0
      ? params.dateColumns
      : profiles
          .filter((p) => p.selectedType === 'date' && p.dateDerivedNames && p.dateDerivedNames.length === 3)
          .map((p) => ({
            column: p.name,
            anioCol: p.dateDerivedNames![0],
            mesCol: p.dateDerivedNames![1],
            diasCol: p.dateDerivedNames![2],
          }));
  const allNumericAfterDates = profiles.filter((p) => p.selectedType === 'numeric').map((p) => p.name);

  const imputationMap: Record<string, ImputationMethod> = {};
  for (const item of imputationSummary) {
    if (
      item.method === 'median' ||
      item.method === 'mean' ||
      item.method === 'mode'
    ) {
      imputationMap[item.column] = item.method;
    }
  }

  // Group dummy specs by sourceColumn in order of appearance
  const dummyGroups = new Map<
    string,
    { referenceLevel: string; levels: { level: string; normLevel: string; dummyName: string }[] }
  >();
  for (const d of dummyColumns) {
    if (!dummyGroups.has(d.sourceColumn)) {
      dummyGroups.set(d.sourceColumn, {
        referenceLevel: d.referenceLevel,
        levels: [],
      });
    }
    dummyGroups.get(d.sourceColumn)!.levels.push({
      level: d.level,
      normLevel: normalizeLevelJS(d.level),
      dummyName: d.name,
    });
  }

  const dummySpecsPy = Array.from(dummyGroups.entries()).map(([src, info]) => ({
    source: src,
    ref_norm: normalizeLevelJS(info.referenceLevel),
    ref_original: info.referenceLevel,
    dummies: info.levels.map((l, idx) => ({
      name: l.dummyName,
      norm_level: l.normLevel || `niv_${idx + 1}`,
    })),
  }));

  const scenarioRatesPy = scenarioConfigs
    .filter((c) => contPreds.includes(c.variable))
    .map(
      (c) =>
        `    "${c.variable}": {"pesimista": ${c.pessimisticRatePct / 100}, "base": ${c.baseRatePct / 100}, "optimista": ${c.optimisticRatePct / 100}, "mc_mean": ${c.mcMeanRatePct / 100}, "mc_sd": ${c.mcStdRatePct / 100}, "method": "${c.method}", "manual_pct": ${c.manualChangePct / 100}}`
    )
    .join(',\n');

  const formulaRhs = isLogLog
    ? preds.map((p) => (!dummySet.has(p) ? `ln_${p}` : p)).join(' + ')
    : preds.join(' + ');
  const formulaLhs = isLogLog ? `ln_${yCol}` : yCol;

  return `# -*- coding: utf-8 -*-
"""
RegresIA – Script reproducible de Regresión Lineal Múltiple y Simulación
Pregunta de negocio: ${businessQuestion.replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}

Instalación de dependencias:
pip install pandas numpy statsmodels scipy matplotlib openpyxl
Uso:
python regresion.py ruta_al_archivo.csv
"""

import os
import re
import sys
import unicodedata
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.stattools import durbin_watson, jarque_bera
import matplotlib.pyplot as plt

np.random.seed(42)

# ==============================================================================
# PASO 1: CARGA Y NORMALIZACIÓN DE COLUMNAS
# ==============================================================================
if len(sys.argv) < 2:
    print("Uso: python regresion.py <ruta_archivo.csv|txt|xlsx>")
    sys.exit(1)

ruta_archivo = sys.argv[1]
os.makedirs("salidas", exist_ok=True)

ext = os.path.splitext(ruta_archivo)[1].lower()
if ext in [".xlsx", ".xls"]:
    xl = pd.ExcelFile(ruta_archivo)
    hoja_objetivo = ${selectedSheet ? JSON.stringify(selectedSheet) : 'None'}
    hoja = hoja_objetivo if hoja_objetivo and hoja_objetivo in xl.sheet_names else xl.sheet_names[0]
    df = pd.read_excel(ruta_archivo, sheet_name=hoja)
else:
    try:
        with open(ruta_archivo, "r", encoding="utf-8-sig") as f:
            muestra = f.read(4096)
        enc = "utf-8-sig"
    except UnicodeDecodeError:
        with open(ruta_archivo, "r", encoding="latin-1") as f:
            muestra = f.read(4096)
        enc = "latin-1"
    sep = ";" if muestra.count(";") > muestra.count(",") else ("\\t" if muestra.count("\\t") > muestra.count(",") else ",")
    df = pd.read_csv(ruta_archivo, sep=sep, encoding=enc)

def normalizar_nombre(nombre, idx=0):
    texto = unicodedata.normalize("NFD", str(nombre).strip()).encode("ascii", "ignore").decode("ascii")
    texto = re.sub(r"[^a-zA-Z0-9_]+", "_", texto)
    texto = re.sub(r"_+", "_", texto).strip("_")
    if not texto:
        texto = f"col_{idx + 1}"
    if texto[0].isdigit():
        texto = f"v_{texto}"
    return texto

usados = set()
cols_norm = []
for idx, c in enumerate(df.columns):
    base = normalizar_nombre(c, idx)
    cand = base
    sufijo = 2
    while cand in usados:
        cand = f"{base}_{sufijo}"
        sufijo += 1
    usados.add(cand)
    cols_norm.append(cand)
df.columns = cols_norm
print(f"Dimensiones iniciales: {df.shape[0]} filas x {df.shape[1]} columnas")

# ==============================================================================
# PASO 2: CALIDAD DE DATOS (REPRODUCE EXACTAMENTE LA CONFIGURACIÓN DE LA APP)
# ==============================================================================
eliminar_duplicados = ${removeDuplicates ? 'True' : 'False'}
if eliminar_duplicados:
    df = df.drop_duplicates().reset_index(drop=True)

cols_eliminadas = ${JSON.stringify(droppedColumns)}
if cols_eliminadas:
    df = df.drop(columns=[c for c in cols_eliminadas if c in df.columns])

def limpiar_celda_vacia(val):
    if pd.isna(val):
        return np.nan
    if isinstance(val, str):
        s = val.strip()
        if s == "" or s.lower() in {"na", "n/a", "null", "nan", "-"}:
            return np.nan
        return s
    return val

for col in df.columns:
    df[col] = df[col].apply(limpiar_celda_vacia)

cols_eliminar_filas = ${JSON.stringify(dropRowsColumns)}
if cols_eliminar_filas:
    cols_presentes = [c for c in cols_eliminar_filas if c in df.columns]
    if cols_presentes:
        df = df.dropna(subset=cols_presentes).reset_index(drop=True)

def parsear_numero(val):
    if pd.isna(val):
        return np.nan
    if isinstance(val, (int, float, np.number)):
        return float(val) if np.isfinite(val) else np.nan
    s = str(val).strip()
    if not s or s.lower() in {"na", "n/a", "null", "nan", "-"}:
        return np.nan
    if re.match(r"^[+-]?\\d+(\\.\\d+)?([eE][+-]?\\d+)?$", s):
        return float(s)
    if re.match(r"^[+-]?\\d+,\\d+$", s):
        return float(s.replace(",", "."))
    if re.match(r"^[+-]?\\d{1,3}(\\.\\d{3})+,\\d+$", s):
        return float(s.replace(".", "").replace(",", "."))
    if re.match(r"^[+-]?\\d{1,3}(,\\d{3})+(\\.\\d+)?$", s):
        return float(s.replace(",", ""))
    return np.nan

cols_numericas_modelo = ${JSON.stringify(numericColsStep3)}
cols_categoricas_modelo = ${JSON.stringify(catColsStep3)}

for col in cols_numericas_modelo:
    if col in df.columns:
        df[col] = df[col].apply(parsear_numero)

# Imputación exacta elegida por columna en la app
imputacion_config = ${JSON.stringify(imputationMap)}
for col, metodo in imputacion_config.items():
    if col not in df.columns or not df[col].isna().any():
        continue
    if metodo == "median":
        df[col] = df[col].fillna(df[col].median())
    elif metodo == "mean":
        df[col] = df[col].fillna(df[col].mean())
    elif metodo == "mode":
        moda = df[col].mode(dropna=True)
        if not moda.empty:
            df[col] = df[col].fillna(moda.iloc[0])

# Respaldo ante posibles faltantes nuevos en otros archivos
for col in df.columns:
    if df[col].isna().any():
        if pd.api.types.is_numeric_dtype(df[col]):
            df[col] = df[col].fillna(df[col].median())
        else:
            moda = df[col].mode(dropna=True)
            if not moda.empty:
                df[col] = df[col].fillna(moda.iloc[0])

# ==============================================================================
# PASO 3: VARIABLES DE FECHA, TIPOS Y DUMMIES (MISMA REFERENCIA Y NOMBRES NORMALIZADOS)
# ==============================================================================
def parsear_fecha_serie(serie):
    hoy = pd.Timestamp.today().normalize()
    fechas = []
    for val in serie:
        if pd.isna(val):
            fechas.append(pd.NaT)
            continue
        if isinstance(val, (pd.Timestamp, np.datetime64)):
            fechas.append(pd.Timestamp(val).normalize())
            continue
        if isinstance(val, (int, float, np.number)) and np.isfinite(val) and 1000 <= float(val) <= 100000:
            fechas.append((pd.Timestamp("1899-12-30") + pd.to_timedelta(float(val), unit="D")).normalize())
            continue
        s = str(val).strip()
        if re.match(r"^\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}", s):
            dt = pd.to_datetime(s, format="mixed", yearfirst=True, errors="coerce")
        elif re.match(r"^\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}", s):
            dt = pd.to_datetime(s, format="mixed", dayfirst=True, errors="coerce")
        else:
            dt = pd.to_datetime(s, errors="coerce")
        fechas.append(dt.normalize() if pd.notna(dt) else pd.NaT)
    out = pd.Series(fechas, index=serie.index)
    if out.isna().any():
        validas = out.dropna().sort_values()
        relleno = validas.iloc[len(validas) // 2] if len(validas) > 0 else hoy
        out = out.fillna(relleno)
    return out, hoy

date_specs = ${JSON.stringify(derivedDateSpecs)}
for dspec in date_specs:
    col_f = dspec["column"]
    if col_f in df.columns:
        dt_s, hoy_ts = parsear_fecha_serie(df[col_f])
        df[dspec["anioCol"]] = dt_s.dt.year.astype(int)
        df[dspec["mesCol"]] = dt_s.dt.month.astype(int)
        df[dspec["diasCol"]] = np.maximum(0, (hoy_ts - dt_s).dt.days.astype(int))

def normalizar_nivel(val):
    if pd.isna(val):
        return ""
    texto = unicodedata.normalize("NFD", str(val).strip()).encode("ascii", "ignore").decode("ascii")
    texto = re.sub(r"[^a-zA-Z0-9_]+", "_", texto)
    texto = re.sub(r"_+", "_", texto).strip("_")
    return texto

dummy_specs = ${JSON.stringify(dummySpecsPy, null, 2)}
for spec in dummy_specs:
    src = spec["source"]
    if src not in df.columns:
        raise KeyError(f"Columna categórica '{src}' no encontrada tras normalizar encabezados: {list(df.columns)}")
    # Normalizar niveles ("Orinoquía" -> "Orinoquia", "Centro comercial" -> "Centro_comercial")
    serie_norm = df[src].apply(normalizar_nivel)
    categorias_ord = [spec["ref_norm"]] + [d["norm_level"] for d in spec["dummies"]]
    cat_serie = pd.Series(
        pd.Categorical(serie_norm, categories=categorias_ord, ordered=True),
        index=df.index,
    )
    dummies_df = pd.get_dummies(cat_serie, prefix=src, drop_first=True).astype(int)
    for d in spec["dummies"]:
        col_generada = f"{src}_{d['norm_level']}"
        if col_generada in dummies_df.columns:
            df[d["name"]] = dummies_df[col_generada].values
        else:
            df[d["name"]] = (serie_norm == d["norm_level"]).astype(int).values

id_col = ${identifierCol ? `"${identifierCol}"` : 'None'}
etiquetas = df[id_col].astype(str).tolist() if id_col and id_col in df.columns else [f"Fila_{i+1}" for i in range(len(df))]

# ==============================================================================
# PASO 4: ANÁLISIS EXPLORATORIO
# ==============================================================================
cols_numericas_eda = ${JSON.stringify(allNumericAfterDates)}
num_cols = [c for c in cols_numericas_eda if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
if num_cols:
    desc = df[num_cols].describe().T
    desc["skewness"] = df[num_cols].skew()
    desc.to_csv("salidas/estadisticos_descriptivos.csv")
    corr_pearson = df[num_cols].corr(method="pearson")
    corr_pearson.to_csv("salidas/correlaciones_pearson.csv")

# ==============================================================================
# PASO 5 y 6: VARIABLES Y ESTIMACIÓN DEL MODELO ELEGIDO (OLS)
# ==============================================================================
y_col = "${yCol}"
predictores = ${predsPy}
predictores_continuos = ${contPredsPy}
es_log_log = ${isLogLog ? 'True' : 'False'}

df_mod = df.copy()
if es_log_log:
    df_mod[f"ln_{y_col}"] = np.log(df_mod[y_col].astype(float))
    for p in predictores_continuos:
        df_mod[f"ln_{p}"] = np.log(df_mod[p].astype(float))

formula = "${formulaLhs} ~ ${formulaRhs}"
modelo = smf.ols(formula=formula, data=df_mod).fit()
print(modelo.summary())
print(modelo.get_robustcov_results(cov_type="HC3").summary())

# Intervalos de confianza al 95% y tabla de coeficientes
ic = modelo.conf_int(alpha=0.05)
tabla_coef = pd.DataFrame({
    "coeficiente": modelo.params,
    "error_estandar": modelo.bse,
    "t_stat": modelo.tvalues,
    "p_value": modelo.pvalues,
    "ic_95_inf": ic[0],
    "ic_95_sup": ic[1],
})
tabla_coef.to_csv("salidas/coeficientes_modelo.csv")

# VIF
X_mat = modelo.model.exog
vifs = []
for idx in range(1, X_mat.shape[1]):
    vifs.append(variance_inflation_factor(X_mat, idx) if X_mat.shape[1] > 2 else 1.0)
print("VIF predictores:", dict(zip(predictores, vifs)))

# Validación cruzada: 10-fold (semilla 42) si n > 500; LOOCV si n <= 500
n = len(df_mod)
target_cv_col = f"ln_{y_col}" if es_log_log else y_col
if n > 500:
    rng_cv = np.random.RandomState(42)
    idx_perm = rng_cv.permutation(n)
    folds = np.array_split(idx_perm, 10)
    cv_errs = []
    for test_idx in folds:
        train_idx = np.setdiff1d(np.arange(n), test_idx)
        m_cv = smf.ols(formula=formula, data=df_mod.iloc[train_idx]).fit()
        preds_cv = m_cv.predict(df_mod.iloc[test_idx]).values
        actuals_cv = df_mod[target_cv_col].iloc[test_idx].values
        cv_errs.extend(((actuals_cv - preds_cv) ** 2).tolist())
    cv_rmse = float(np.sqrt(np.mean(cv_errs)))
    print(f"RMSE 10-fold CV (semilla 42): {cv_rmse:.4f}")
else:
    loocv_errs = []
    for i in range(n):
        train = df_mod.drop(df_mod.index[i])
        test = df_mod.iloc[[i]]
        m_i = smf.ols(formula=formula, data=train).fit()
        pred_i = m_i.predict(test).iloc[0]
        actual_i = df_mod[target_cv_col].iloc[i]
        loocv_errs.append((actual_i - pred_i) ** 2)
    loocv_rmse = float(np.sqrt(np.mean(loocv_errs)))
    print(f"RMSE LOOCV: {loocv_rmse:.4f}")

# Pruebas de supuestos
residuos = modelo.resid.values
jb_stat, jb_p, _, _ = jarque_bera(residuos)
bp_lm, bp_p, _, _ = het_breuschpagan(residuos, X_mat)
dw_stat = durbin_watson(residuos)
cooks_d = modelo.get_influence().cooks_distance[0]
print(f"Jarque-Bera p={jb_p:.4f} | Breusch-Pagan p={bp_p:.4f} | Durbin-Watson={dw_stat:.3f}")
print(f"Casos influyentes (Cook > 4/n): {np.sum(cooks_d > 4/n)}")

# ==============================================================================
# PASO 7: BRECHA REAL VS. POTENCIAL (SMEARING DE DUAN SI LOG-LOG)
# ==============================================================================
y_real = df_mod[y_col].astype(float).values
if es_log_log:
    smearing_duan = float(np.mean(np.exp(residuos)))
    y_potencial = np.exp(modelo.fittedvalues.values) * smearing_duan
else:
    smearing_duan = 1.0
    y_potencial = modelo.fittedvalues.values

brecha = y_real - y_potencial
df_brecha = pd.DataFrame({
    "fila": etiquetas,
    "y_real": y_real,
    "y_potencial": y_potencial,
    "brecha": brecha,
    "brecha_pct": (brecha / y_potencial) * 100,
    "cook_d": cooks_d,
}).sort_values("brecha")
df_brecha.to_csv("salidas/resultados_brecha.csv", index=False)

# Gráfico de brechas
fig_h = max(6.0, min(18.0, len(df_brecha) * 0.22))
fig, ax = plt.subplots(figsize=(9, fig_h))
colores = ["#e34948" if b < 0 else "#2a78d6" for b in df_brecha["brecha"]]
ax.barh(df_brecha["fila"], df_brecha["brecha"], color=colores)
ax.axvline(0, color="#334155", linewidth=1)
ax.set_title(f"Brecha real vs. potencial: {y_col}")
ax.set_xlabel("Brecha en unidades (Real - Potencial)")
plt.tight_layout()
plt.savefig("salidas/brecha_real_potencial.png", dpi=150)
plt.close()

# ==============================================================================
# PASO 8: ESCENARIOS Y MONTE CARLO (10.000 ITERACIONES, SEMILLA 42)
# ==============================================================================
horizonte = ${horizonYears}
config_escenarios = {
${scenarioRatesPy}
}

def obtener_multiplicador(cfg, nombre_esc):
    if cfg["method"] == "manual_value":
        return max(0.01, 1.0 + cfg["manual_pct"])
    if cfg["method"] == "normal_mc":
        if nombre_esc == "base":
            tasa = cfg["mc_mean"]
        elif nombre_esc == "pesimista":
            tasa = cfg["mc_mean"] - cfg["mc_sd"]
        else:
            tasa = cfg["mc_mean"] + cfg["mc_sd"]
        return max(0.01, (1.0 + tasa) ** horizonte)
    return max(0.01, (1.0 + cfg[nombre_esc]) ** horizonte)

def proyectar_escenario(nombre_esc):
    if es_log_log:
        delta_log = 0.0
        for p in predictores_continuos:
            if p in config_escenarios:
                mult = obtener_multiplicador(config_escenarios[p], nombre_esc)
                beta_p = modelo.params[f"ln_{p}"]
                delta_log += beta_p * np.log(mult)
        y_fut = y_real * np.exp(delta_log)
    else:
        df_fut = df_mod.copy()
        for p in predictores_continuos:
            if p in config_escenarios:
                mult = obtener_multiplicador(config_escenarios[p], nombre_esc)
                df_fut[p] = df_fut[p].astype(float) * mult
        pred_curr = modelo.predict(df_mod).values
        pred_fut = modelo.predict(df_fut).values
        factor = np.where(
            (np.abs(pred_curr) > 1e-9) & (pred_curr > 0),
            pred_fut / pred_curr,
            1.0 + (pred_fut - pred_curr) / np.maximum(np.abs(y_real), 1e-9),
        )
        y_fut = y_real * factor
    return float(np.sum(y_fut))

actual_total = float(np.sum(y_real))
res_esc = []
for esc in ["pesimista", "base", "optimista"]:
    tot = proyectar_escenario(esc)
    res_esc.append({"escenario": esc, "total": tot, "cambio_pct": (tot / actual_total - 1) * 100})
pd.DataFrame(res_esc).to_csv("salidas/escenarios.csv", index=False)

# Monte Carlo con Cholesky de la matriz de covarianzas de los coeficientes (lineal y log-log)
n_mc = 10000
beta_hat = modelo.params.values
cov_beta = modelo.cov_params().values
cov_sym = 0.5 * (cov_beta + cov_beta.T)
L_chol = np.linalg.cholesky(cov_sym)
X_curr_mat = df_mod[predictores].values.astype(float)

mc_totales = np.zeros(n_mc)
for it in range(n_mc):
    z = np.random.normal(size=len(beta_hat))
    beta_sim = beta_hat + L_chol @ z

    mults = np.ones(len(predictores), dtype=float)
    for idx_p, p in enumerate(predictores):
        if p in predictores_continuos and p in config_escenarios:
            cfg = config_escenarios[p]
            if cfg["method"] == "normal_mc":
                tasa = float(np.random.normal(cfg["mc_mean"], cfg["mc_sd"]))
                mults[idx_p] = max((1.0 + tasa) ** horizonte, 0.05)
            elif cfg["method"] == "manual_value":
                mults[idx_p] = max(1.0 + cfg["manual_pct"], 0.05)
            else:
                spread = abs(cfg["optimista"] - cfg["pesimista"]) / 3.65
                tasa = float(np.random.normal(cfg["base"], spread)) if spread > 0 else cfg["base"]
                mults[idx_p] = max((1.0 + tasa) ** horizonte, 0.05)

    if es_log_log:
        delta_log = 0.0
        for idx_p, p in enumerate(predictores):
            if p in predictores_continuos:
                delta_log += beta_sim[idx_p + 1] * np.log(mults[idx_p])
        mc_totales[it] = np.sum(y_real * np.exp(delta_log))
    else:
        X_fut_mat = X_curr_mat * mults
        y_hat_curr = beta_sim[0] + X_curr_mat @ beta_sim[1:]
        y_hat_fut = beta_sim[0] + X_fut_mat @ beta_sim[1:]
        factor = np.where(
            (np.abs(y_hat_curr) > 1e-9) & (y_hat_curr > 0),
            y_hat_fut / y_hat_curr,
            1.0 + (y_hat_fut - y_hat_curr) / np.maximum(np.abs(y_real), 1e-9),
        )
        mc_totales[it] = float(np.sum(np.maximum(0.0, y_real * factor)))

p5, p50, p95 = np.percentile(mc_totales, [5, 50, 95])
print(f"Monte Carlo (10.000 iter): P5={p5:,.1f} | P50={p50:,.1f} | P95={p95:,.1f}")

plt.figure(figsize=(8, 5))
plt.hist(mc_totales, bins=30, color="#2a78d6", alpha=0.75, edgecolor="white")
plt.axvline(p5, color="#e34948", linestyle="--", label=f"P5: {p5:,.0f}")
plt.axvline(p50, color="#0f172a", linestyle="-", label=f"P50: {p50:,.0f}")
plt.axvline(p95, color="#16a34a", linestyle="--", label=f"P95: {p95:,.0f}")
plt.legend()
plt.title(f"Simulación Monte Carlo a {horizonte} años ({y_col})")
plt.tight_layout()
plt.savefig("salidas/monte_carlo.png", dpi=150)
plt.close()
print("Análisis completo guardado en la carpeta 'salidas/'.")
`;
}
