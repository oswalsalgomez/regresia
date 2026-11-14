import { ScriptGeneratorParams } from './pythonScript';

function normalizeLevelJS(level: string): string {
  return level
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function generateRScript(params: ScriptGeneratorParams): string {
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
  const contPreds = preds.filter((p) => !dummySet.has(p));
  const numericColsStep3 = profiles.filter((p) => p.selectedType === 'numeric' && !p.isDateFeature).map((p) => p.name);
  const allNumericAfterDates = profiles.filter((p) => p.selectedType === 'numeric').map((p) => p.name);
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
  const dateRBlock = derivedDateSpecs
    .map(
      (ds) =>
        `if ("${ds.column}" %in% names(df)) {\n  dt_${ds.column} <- parsear_fecha_vec(df[["${ds.column}"]])\n  df$${ds.anioCol} <- as.integer(format(dt_${ds.column}, "%Y"))\n  df$${ds.mesCol} <- as.integer(format(dt_${ds.column}, "%m"))\n  df$${ds.diasCol} <- pmax(0L, as.integer(Sys.Date() - dt_${ds.column}))\n}`
    )
    .join('\n');

  const imputationEntries = imputationSummary
    .filter((m) => m.method === 'median' || m.method === 'mean' || m.method === 'mode')
    .map((m) => `  ${m.column} = "${m.method}"`)
    .join(',\n');

  const dummyLines = dummyColumns
    .map((d, idx) => {
      const cleanLvl = normalizeLevelJS(d.level) || `niv_${idx + 1}`;
      return `# ${d.sourceColumn} (referencia: "${d.referenceLevel}"): "${d.level}" -> ${d.name}\ndf$${d.name} <- ifelse(normalizar_nivel(df[["${d.sourceColumn}"]]) == "${cleanLvl}", 1, 0)`;
    })
    .join('\n');

  const formulaLhs = isLogLog ? `log(${yCol})` : yCol;
  const formulaRhs = preds
    .map((p) => (isLogLog && !dummySet.has(p) ? `log(${p})` : p))
    .join(' + ');
  const formulaStr = `${formulaLhs} ~ ${formulaRhs}`;

  const escLines = scenarioConfigs
    .filter((c) => contPreds.includes(c.variable))
    .map(
      (c) =>
        `  ${c.variable} = list(pes = ${c.pessimisticRatePct / 100}, base = ${c.baseRatePct / 100}, opt = ${c.optimisticRatePct / 100}, mc_mean = ${c.mcMeanRatePct / 100}, mc_sd = ${c.mcStdRatePct / 100}, method = "${c.method}", manual = ${c.manualChangePct / 100})`
    )
    .join(',\n');

  const vecR = (arr: string[]) =>
    arr.length > 0 ? `c(${arr.map((s) => `"${s}"`).join(', ')})` : 'character(0)';

  return `# ==============================================================================
# RegresIA – Script reproducible en R (Regresión Múltiple y Simulación)
# Pregunta de negocio: ${businessQuestion.replace(/[\r\n]+/g, ' ')}
#
# Instalación de paquetes necesarios:
# install.packages(c("readxl", "lmtest", "car", "sandwich"))
#
# Uso desde terminal:
# Rscript regresion.R ruta_al_archivo.csv
# ==============================================================================

suppressPackageStartupMessages({
  library(readxl)
  library(lmtest)
  library(car)
  library(sandwich)
})

set.seed(42)

# PASO 1: Carga de datos y normalización de nombres
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) {
  stop("Uso: Rscript regresion.R <ruta_archivo.csv|txt|xlsx>")
}
ruta <- args[1]
dir.create("salidas", showWarnings = FALSE)

ext <- tolower(tools::file_ext(ruta))
if (ext %in% c("xlsx", "xls")) {
  hojas <- excel_sheets(ruta)
  hoja_obj <- ${selectedSheet ? `"${selectedSheet}"` : 'NULL'}
  hoja <- if (!is.null(hoja_obj) && hoja_obj %in% hojas) hoja_obj else 1
  df <- as.data.frame(read_excel(ruta, sheet = hoja))
} else {
  primera <- readLines(ruta, n = 5, warn = FALSE, encoding = "UTF-8")
  texto_m <- paste(primera, collapse = "\\n")
  sep <- if (lengths(regmatches(texto_m, gregexpr(";", texto_m))) > lengths(regmatches(texto_m, gregexpr(",", texto_m)))) ";" else if (lengths(regmatches(texto_m, gregexpr("\\t", texto_m))) > lengths(regmatches(texto_m, gregexpr(",", texto_m)))) "\\t" else ","
  df <- read.delim(ruta, sep = sep, check.names = FALSE, stringsAsFactors = FALSE,
                   fileEncoding = "UTF-8", na.strings = c("", "NA", "N/A", "na", "null", "NaN"))
}

quitar_tildes <- function(x) {
  s <- as.character(x)
  s <- gsub("^\\ufeff", "", s)
  chartr("áéíóúÁÉÍÓÚñÑüÜàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜ",
         "aeiouAEIOUnNuUaeiouAEIOUaeiouAEIOUaeiouAEIOU", s)
}

normalizar <- function(x) {
  res <- character(length(x))
  usados <- character(0)
  for (i in seq_along(x)) {
    t <- quitar_tildes(trimws(x[i]))
    t <- iconv(t, to = "ASCII//TRANSLIT")
    if (is.na(t)) t <- ""
    t <- gsub("[^a-zA-Z0-9_]+", "_", t)
    t <- gsub("_+", "_", t)
    t <- gsub("^_+|_+$", "", t)
    if (t == "") t <- paste0("col_", i)
    if (grepl("^[0-9]", t)) t <- paste0("v_", t)
    cand <- t
    k <- 2
    while (cand %in% usados) {
      cand <- paste0(t, "_", k)
      k <- k + 1
    }
    usados <- c(usados, cand)
    res[i] <- cand
  }
  res
}
names(df) <- normalizar(names(df))

# PASO 2: Calidad de datos (reproduce exactamente la configuración de la app)
eliminar_duplicados <- ${removeDuplicates ? 'TRUE' : 'FALSE'}
if (eliminar_duplicados) {
  df <- df[!duplicated(df), , drop = FALSE]
}

cols_eliminadas <- ${vecR(droppedColumns)}
if (length(cols_eliminadas) > 0) {
  df <- df[, !(names(df) %in% cols_eliminadas), drop = FALSE]
}

for (col in names(df)) {
  if (is.character(df[[col]]) || is.factor(df[[col]])) {
    v <- trimws(as.character(df[[col]]))
    v[v == "" | tolower(v) %in% c("na", "n/a", "null", "nan", "-")] <- NA_character_
    df[[col]] <- v
  }
}

cols_drop_rows <- ${vecR(dropRowsColumns)}
cols_drop_rows <- intersect(cols_drop_rows, names(df))
if (length(cols_drop_rows) > 0) {
  df <- df[complete.cases(df[, cols_drop_rows, drop = FALSE]), , drop = FALSE]
}

parsear_numero <- function(vec) {
  if (is.numeric(vec)) return(as.numeric(vec))
  s <- trimws(as.character(vec))
  out <- rep(NA_real_, length(s))
  for (i in seq_along(s)) {
    val <- s[i]
    if (is.na(val) || val == "" || tolower(val) %in% c("na", "n/a", "null", "nan", "-")) next
    if (grepl("^[+-]?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$", val)) {
      out[i] <- suppressWarnings(as.numeric(val))
    } else if (grepl("^[+-]?[0-9]+,[0-9]+$", val)) {
      out[i] <- suppressWarnings(as.numeric(gsub(",", ".", val)))
    } else if (grepl("^[+-]?[0-9]{1,3}(\\\\.[0-9]{3})+,[0-9]+$", val)) {
      out[i] <- suppressWarnings(as.numeric(gsub(",", ".", gsub("\\\\.", "", val))))
    } else if (grepl("^[+-]?[0-9]{1,3}(,[0-9]{3})+(\\\\.[0-9]+)?$", val)) {
      out[i] <- suppressWarnings(as.numeric(gsub(",", "", val)))
    }
  }
  out
}

cols_numericas_modelo <- ${vecR(numericColsStep3)}
for (col in cols_numericas_modelo) {
  if (col %in% names(df)) {
    df[[col]] <- parsear_numero(df[[col]])
  }
}

imputacion_config <- list(
${imputationEntries}
)
for (col in names(imputacion_config)) {
  if (!(col %in% names(df)) || !any(is.na(df[[col]]))) next
  metodo <- imputacion_config[[col]]
  if (metodo == "median") {
    df[[col]][is.na(df[[col]])] <- median(df[[col]], na.rm = TRUE)
  } else if (metodo == "mean") {
    df[[col]][is.na(df[[col]])] <- mean(df[[col]], na.rm = TRUE)
  } else if (metodo == "mode") {
    moda <- names(sort(table(df[[col]]), decreasing = TRUE))[1]
    if (!is.null(moda) && length(moda) > 0) df[[col]][is.na(df[[col]])] <- moda
  }
}

# Respaldo ante posibles faltantes nuevos en otros archivos
for (col in names(df)) {
  if (any(is.na(df[[col]]))) {
    if (is.numeric(df[[col]])) {
      df[[col]][is.na(df[[col]])] <- median(df[[col]], na.rm = TRUE)
    } else {
      moda <- names(sort(table(df[[col]]), decreasing = TRUE))[1]
      if (!is.null(moda) && length(moda) > 0) df[[col]][is.na(df[[col]])] <- moda
    }
  }
}

# PASO 3: Variables de fecha y dummies con drop-first, misma referencia y nombres normalizados
parsear_fecha_vec <- function(vec) {
  if (inherits(vec, c("Date", "POSIXct", "POSIXlt"))) {
    out <- as.Date(vec)
  } else if (is.numeric(vec)) {
    out <- as.Date(vec, origin = "1899-12-30")
  } else {
    s <- trimws(as.character(vec))
    out <- as.Date(rep(NA, length(s)))
    iso_idx <- grepl("^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}", s)
    dmy_idx <- grepl("^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}", s)
    num_idx <- grepl("^[0-9]+(\\\\.[0-9]+)?$", s)
    if (any(iso_idx)) out[iso_idx] <- suppressWarnings(as.Date(gsub("/", "-", substr(s[iso_idx], 1, 10)), format = "%Y-%m-%d"))
    if (any(dmy_idx)) {
      cand4 <- suppressWarnings(as.Date(gsub("-", "/", substr(s[dmy_idx], 1, 10)), format = "%d/%m/%Y"))
      cand2 <- suppressWarnings(as.Date(gsub("-", "/", substr(s[dmy_idx], 1, 8)), format = "%d/%m/%y"))
      out[dmy_idx] <- ifelse(!is.na(cand4), cand4, cand2)
      out <- as.Date(out, origin = "1970-01-01")
    }
    if (any(num_idx)) {
      nv <- suppressWarnings(as.numeric(s[num_idx]))
      ok <- !is.na(nv) & nv >= 1000 & nv <= 100000
      if (any(ok)) {
        idx_ok <- which(num_idx)[ok]
        out[idx_ok] <- as.Date(nv[ok], origin = "1899-12-30")
      }
    }
  }
  if (any(is.na(out))) {
    valid <- sort(out[!is.na(out)])
    fill_dt <- if (length(valid) > 0) valid[ceiling(length(valid) / 2)] else Sys.Date()
    out[is.na(out)] <- fill_dt
  }
  out
}
${dateRBlock || '# Sin columnas de fecha detectadas'}

normalizar_nivel <- function(x) {
  s <- ifelse(is.na(x), "", quitar_tildes(trimws(as.character(x))))
  s <- gsub("[^a-zA-Z0-9_]+", "_", s)
  s <- gsub("_+", "_", s)
  gsub("^_+|_+$", "", s)
}
${dummyLines || '# Sin variables categóricas convertidas a dummies'}

id_col <- ${identifierCol ? `"${identifierCol}"` : 'NULL'}
etiquetas <- if (!is.null(id_col) && id_col %in% names(df)) as.character(df[[id_col]]) else paste0("Fila_", seq_len(nrow(df)))

# PASO 4: Descriptivos y matriz de correlaciones
cols_numericas_eda <- ${vecR(allNumericAfterDates)}
num_cols <- intersect(cols_numericas_eda, names(df))
num_cols <- num_cols[sapply(df[, num_cols, drop = FALSE], is.numeric)]
if (length(num_cols) >= 2) {
  write.csv(cor(df[, num_cols, drop = FALSE], method = "pearson", use = "complete.obs"), "salidas/correlaciones_pearson.csv")
  write.csv(cor(df[, num_cols, drop = FALSE], method = "spearman", use = "complete.obs"), "salidas/correlaciones_spearman.csv")
}

# PASO 5 y 6: Estimación OLS del modelo elegido
yCol <- "${yCol}"
predictores <- ${vecR(preds)}
pred_cont <- ${vecR(contPreds)}
es_log_log <- ${isLogLog ? 'TRUE' : 'FALSE'}

formula_mod <- as.formula("${formulaStr}")
m <- lm(formula_mod, data = df)
print(summary(m))

# Intervalos de confianza 95% y errores robustos HC3
print(confint(m))
print(coeftest(m, vcov = vcovHC(m, type = "HC3")))

# VIF (multicolinealidad)
if (length(coef(m)) > 2) {
  print(vif(m))
}

# Validación cruzada: 10-fold (semilla 42) si n > 500; LOOCV si n <= 500
n <- nrow(df)
y_target_vec <- ${isLogLog ? `log(df$${yCol})` : `df$${yCol}`}
if (n > 500) {
  set.seed(42)
  folds <- sample(rep(1:10, length.out = n))
  cv_sq <- numeric(n)
  for (fold_id in 1:10) {
    test_idx <- which(folds == fold_id)
    train_idx <- which(folds != fold_id)
    m_cv <- lm(formula_mod, data = df[train_idx, , drop = FALSE])
    pred_cv <- suppressWarnings(predict(m_cv, newdata = df[test_idx, , drop = FALSE]))
    cv_sq[test_idx] <- (y_target_vec[test_idx] - pred_cv)^2
  }
  cat(sprintf("RMSE 10-fold CV (semilla 42): %.4f\\n", sqrt(mean(cv_sq))))
} else {
  loocv_sq <- numeric(n)
  for (i in seq_len(n)) {
    m_i <- lm(formula_mod, data = df[-i, , drop = FALSE])
    pred_i <- suppressWarnings(predict(m_i, newdata = df[i, , drop = FALSE]))
    loocv_sq[i] <- (y_target_vec[i] - pred_i)^2
  }
  cat(sprintf("RMSE LOOCV: %.4f\\n", sqrt(mean(loocv_sq))))
}

# Pruebas de supuestos
res <- residuals(m)
print(shapiro.test(res))
print(bptest(m))
print(dwtest(m))
cook_d <- cooks.distance(m)
cat(sprintf("Casos influyentes (Cook > 4/n): %d\\n", sum(cook_d > 4 / n, na.rm = TRUE)))

# PASO 7: Brecha real vs. potencial (factor smearing de Duan si log-log)
y_real <- df[[yCol]]
if (es_log_log) {
  smearing <- mean(exp(res))
  y_potencial <- exp(fitted(m)) * smearing
} else {
  smearing <- 1.0
  y_potencial <- fitted(m)
}
brecha <- y_real - y_potencial
df_brecha <- data.frame(
  fila = etiquetas,
  y_real = y_real,
  y_potencial = y_potencial,
  brecha = brecha,
  brecha_pct = (brecha / y_potencial) * 100,
  cook_d = cook_d
)
df_brecha <- df_brecha[order(df_brecha$brecha), ]
write.csv(df_brecha, "salidas/resultados_brecha.csv", row.names = FALSE)

# Gráfico de brechas
png("salidas/brecha_real_potencial.png", width = 900, height = 650)
par(mar = c(5, 9, 4, 2))
colores <- ifelse(df_brecha$brecha < 0, "#e34948", "#2a78d6")
barplot(df_brecha$brecha, names.arg = df_brecha$fila, horiz = TRUE, las = 1, col = colores,
        main = paste("Brecha real vs. potencial:", yCol), xlab = "Diferencia en unidades (Real - Potencial)")
abline(v = 0, col = "#334155")
dev.off()

# PASO 8: Escenarios y Monte Carlo con chol(vcov(m))
horizonte <- ${horizonYears}
escenarios_cfg <- list(
${escLines}
)

obtener_mult <- function(cfg, tipo) {
  if (cfg$method == "manual_value") return(max(0.01, 1 + cfg$manual))
  if (cfg$method == "normal_mc") {
    tasa <- if (tipo == "base") cfg$mc_mean else if (tipo == "pes") (cfg$mc_mean - cfg$mc_sd) else (cfg$mc_mean + cfg$mc_sd)
    return(max(0.01, (1 + tasa)^horizonte))
  }
  max(0.01, (1 + cfg[[tipo]])^horizonte)
}

proyectar <- function(tipo) {
  if (es_log_log) {
    delta_log <- 0
    coefs <- coef(m)
    for (p in pred_cont) {
      if (!(p %in% names(escenarios_cfg))) next
      mult <- obtener_mult(escenarios_cfg[[p]], tipo)
      idx <- which(names(coefs) == paste0("log(", p, ")"))
      delta_log <- delta_log + coefs[idx] * log(mult)
    }
    sum(y_real * exp(delta_log))
  } else {
    df_fut <- df
    for (p in pred_cont) {
      if (!(p %in% names(escenarios_cfg))) next
      mult <- obtener_mult(escenarios_cfg[[p]], tipo)
      df_fut[[p]] <- df_fut[[p]] * mult
    }
    p_curr <- predict(m, newdata = df)
    p_fut <- predict(m, newdata = df_fut)
    factor_r <- ifelse(abs(p_curr) > 1e-9 & p_curr > 0, p_fut / p_curr, 1 + (p_fut - p_curr) / pmax(abs(y_real), 1e-9))
    sum(y_real * factor_r)
  }
}

actual_total <- sum(y_real)
esc_out <- data.frame(
  escenario = c("pesimista", "base", "optimista"),
  total = c(proyectar("pes"), proyectar("base"), proyectar("opt"))
)
esc_out$cambio_pct <- (esc_out$total / actual_total - 1) * 100
write.csv(esc_out, "salidas/escenarios.csv", row.names = FALSE)
print(esc_out)

# Simulación Monte Carlo (10.000 iteraciones, semilla 42; lineal y log-log)
n_mc <- 10000
beta_hat <- coef(m)
vc <- vcov(m)
vc_sym <- 0.5 * (vc + t(vc))
R_chol <- chol(vc_sym)
X_curr_mat <- as.matrix(df[, predictores, drop = FALSE])
storage.mode(X_curr_mat) <- "numeric"
mc_totales <- numeric(n_mc)

for (it in seq_len(n_mc)) {
  z <- rnorm(length(beta_hat))
  beta_sim <- beta_hat + as.numeric(t(R_chol) %*% z)

  mults <- rep(1, length(predictores))
  for (j in seq_along(predictores)) {
    p <- predictores[j]
    if (p %in% pred_cont && p %in% names(escenarios_cfg)) {
      cfg <- escenarios_cfg[[p]]
      if (cfg$method == "normal_mc") {
        tasa <- rnorm(1, mean = cfg$mc_mean, sd = cfg$mc_sd)
        mults[j] <- max((1 + tasa)^horizonte, 0.05)
      } else if (cfg$method == "manual_value") {
        mults[j] <- max(1 + cfg$manual, 0.05)
      } else {
        spread <- abs(cfg$opt - cfg$pes) / 3.65
        tasa <- if (spread > 0) rnorm(1, mean = cfg$base, sd = spread) else cfg$base
        mults[j] <- max((1 + tasa)^horizonte, 0.05)
      }
    }
  }

  if (es_log_log) {
    delta_log <- 0
    for (j in seq_along(predictores)) {
      p <- predictores[j]
      if (p %in% pred_cont) {
        idx <- which(names(beta_hat) == paste0("log(", p, ")"))
        delta_log <- delta_log + beta_sim[idx] * log(mults[j])
      }
    }
    mc_totales[it] <- sum(y_real * exp(delta_log))
  } else {
    X_fut_mat <- sweep(X_curr_mat, 2, mults, "*")
    y_hat_curr <- beta_sim[1] + as.numeric(X_curr_mat %*% beta_sim[-1])
    y_hat_fut <- beta_sim[1] + as.numeric(X_fut_mat %*% beta_sim[-1])
    factor_mc <- ifelse(
      abs(y_hat_curr) > 1e-9 & y_hat_curr > 0,
      y_hat_fut / y_hat_curr,
      1 + (y_hat_fut - y_hat_curr) / pmax(abs(y_real), 1e-9)
    )
    mc_totales[it] <- sum(pmax(0, y_real * factor_mc))
  }
}

qs <- quantile(mc_totales, probs = c(0.05, 0.50, 0.95))
cat(sprintf("Monte Carlo P5=%.1f | P50=%.1f | P95=%.1f\\n", qs[1], qs[2], qs[3]))

png("salidas/monte_carlo.png", width = 900, height = 550)
hist(mc_totales, breaks = 30, col = "#2a78d6", border = "white",
     main = paste("Simulación Monte Carlo a", horizonte, "años"), xlab = yCol)
abline(v = qs, col = c("#e34948", "#0f172a", "#16a34a"), lwd = 2, lty = c(2, 1, 2))
dev.off()
`;
}
