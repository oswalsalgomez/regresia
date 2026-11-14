# RegresIA – Regresión Múltiple para Negocios

Aplicación web 100 % en navegador para realizar análisis completo de regresión lineal múltiple, selección automática de modelos, validación estadística de supuestos, análisis de brechas real vs. potencial, simulación de escenarios (incluyendo Monte Carlo con 10.000 iteraciones) y exportación ejecutiva.

## Características principales

- **Procesamiento 100 % local en el navegador**: Sin backend, sin envío de datos a servidores y sin claves de API.
- **Carga flexible**: `.csv`, `.txt` (detección automática de delimitador `,`, `;` o tabulación) y `.xlsx`/`.xls` (selector de hojas). Incluye el conjunto de datos de ejemplo de mercados europeos.
- **Limpieza y tipado inteligente**: Detección de faltantes e imputación editable, detección de duplicados, atípicos por IQR (1,5×), corrección de coma decimal, creación de dummies (≤ 10 niveles), detección de identificadores y alertas de riesgo de fuga de información (variables derivadas).
- **Selección exhaustiva de modelos**: Regresión por mínimos cuadrados (`mathjs`) sobre todas las combinaciones de predictores hasta `floor(n/7)` en versión lineal y log-log, con validación cruzada LOOCV, VIF, AIC, BIC y pruebas de supuestos (Jarque-Bera, Breusch-Pagan, Durbin-Watson, distancia de Cook).
- **Simulación de negocios**: Escenarios Pesimista, Base y Optimista, simulación Monte Carlo con semilla fija (42) y descomposición de Cholesky, y análisis de sensibilidad tipo tornado (±10 %).
- **Descargas completas**: Informe ejecutivo en Word (`.docx`) con gráficos PNG incrustados y anexos de código, scripts reproducibles en Python (`.py`) y R (`.R`), tablas en CSV e imagen lista para LinkedIn (`1080×1350 px`).

## Requisitos para desarrollo local

- Node.js 18 o superior
- npm 9 o superior

## Cómo ejecutar en local

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm run dev
```

La aplicación quedará disponible en `http://localhost:3000`.

## Cómo compilar para producción

```bash
npm run build
npm run preview
```

## Despliegue en Vercel

El proyecto incluye `vercel.json` preconfigurado para Vite:

1. Sube el repositorio a GitHub, GitLab o Bitbucket.
2. Importa el proyecto en [Vercel](https://vercel.com).
3. Vercel detectará automáticamente el framework (`vite`), ejecutará `npm run build` (`tsc && vite build`) y publicará la carpeta `dist`.
4. No se requieren variables de entorno ni funciones serverless.
