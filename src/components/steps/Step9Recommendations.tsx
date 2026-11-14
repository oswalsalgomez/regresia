import React from 'react';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { RegressionModelResult, ScenarioRecommendation } from '../../types/regression';
import { buildEntityLabels, EntityLabels } from '../../utils/entityNoun';
import { formatNumberES, resolveYUnit } from '../../utils/formatters';
import { ConclusionBanner } from '../ConclusionBanner';

interface Step9RecommendationsProps {
  model: RegressionModelResult;
  yUnit: string;
  recommendations: ScenarioRecommendation[];
  displayNames?: Record<string, string>;
  entityLabels?: EntityLabels;
  onPrev: () => void;
  onNext: () => void;
}

export const Step9Recommendations: React.FC<Step9RecommendationsProps> = ({
  model,
  yUnit,
  recommendations,
  displayNames = {},
  entityLabels,
  onPrev,
  onNext,
}) => {
  const fn = (col: string) => displayNames[col]?.trim() || col;
  const ent = entityLabels ?? buildEntityLabels('registro');
  const unitLabel = resolveYUnit(yUnit, fn(model.yName));
  const sortedNeg = [...model.rows].sort((a, b) => a.gap - b.gap).filter((r) => r.gap < 0);
  const topOppNames = sortedNeg.slice(0, 3).map((r) => r.rowLabel).join(', ');
  const oppFallback = `los ${ent.plural} con potencial`;

  const conclusionText =
    ent.domain === 'client'
      ? `El plan de acción responde a las variables que cambian en cada escenario: retener y proteger a los ${ent.plural} líderes (Pesimista), captar, retener o migrar de segmento en ${topOppNames || oppFallback} (Base), y escalar campañas donde el modelo muestra mayor tracción (Optimista).`
      : ent.domain === 'product'
        ? `El plan de acción responde a las variables que cambian en cada escenario: proteger margen y rotación en los ${ent.plural} líderes (Pesimista), impulsar, reposicionar o descontinuar según brecha en ${topOppNames || oppFallback} (Base), y concentrar inventario donde hay mayor tracción (Optimista).`
        : ent.domain === 'location'
          ? `El plan de acción responde a las variables que cambian en cada escenario: proteger margen y retención en los ${ent.plural} líderes (Pesimista), optimizar palancas y cerrar brechas en ${topOppNames || oppFallback} (Base), e invertir o expandir capacidad donde el modelo muestra mayor tracción (Optimista).`
          : `El plan de acción responde a las variables que cambian en cada escenario: proteger el desempeño en los ${ent.plural} líderes (Pesimista), cerrar brechas en ${topOppNames || oppFallback} (Base), y concentrar recursos donde el modelo muestra mayor tracción (Optimista).`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">9. Recomendaciones y limitaciones</h1>
        <p className="text-sm text-slate-600 mt-1">
          Hoja de ruta operativa por escenario generada a partir de las brechas, elasticidades y supuestos del modelo.
        </p>
      </div>

      {/* Scenario recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {recommendations.map((rec) => {
          const accent =
            rec.scenarioId === 'pesimista'
              ? 'text-[#e34948]'
              : rec.scenarioId === 'base'
                ? 'text-[#2a78d6]'
                : 'text-emerald-700';

          return (
            <div
              key={rec.scenarioId}
              className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <h2 className={`text-sm font-bold ${accent}`}>{rec.title}</h2>
                <p className="text-xs text-slate-700 leading-relaxed">{rec.meaning}</p>

                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-1.5">
                    Acciones concretas
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-700 list-disc list-inside">
                    {rec.actions.map((act, i) => (
                      <li key={i} className="leading-relaxed">
                        {act}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">KPI sugerido: </span>
                  <span className="text-slate-700">{rec.kpi}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Riesgos: </span>
                  <span className="text-slate-700">{rec.risks}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed Limitations Section */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck className="w-4 h-4 text-[#2a78d6]" />
          <span>Limitaciones metodológicas a considerar</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-700">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="font-semibold text-slate-900">1. Tamaño de muestra</div>
            <p className="mt-1 leading-relaxed">
              El modelo se estimó con <span className="font-mono font-semibold">{model.n}</span> observaciones y{' '}
              <span className="font-mono font-semibold">{model.k}</span> predictores.{' '}
              {model.n < 100
                ? 'Se trata de una muestra pequeña (n < 100), lo que amplía el margen de incertidumbre en coeficientes y proyecciones.'
                : 'El tamaño muestral es adecuado (n ≥ 100), lo que otorga buena estabilidad a los coeficientes y proyecciones.'}
            </p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="font-semibold text-slate-900">2. Asociación no es causalidad</div>
            <p className="mt-1 leading-relaxed">
              La regresión mide covariación estadística condicional; antes de ejecutar cambios de política o inversión conviene validar mecanismos causales en terreno.
            </p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="font-semibold text-slate-900">3. Error medio porcentual (MAPE)</div>
            <p className="mt-1 leading-relaxed">
              El MAPE del modelo en escala original es{' '}
              <span className="font-mono font-semibold">{formatNumberES(model.mape, 2)} %</span> (RMSE ={' '}
              <span className="font-mono font-semibold">{formatNumberES(model.rmseOriginal, 1)}</span> {unitLabel}).
            </p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="font-semibold text-slate-900">4. Unidades de medida</div>
            <p className="mt-1 leading-relaxed">
              Todas las brechas, predicciones y escenarios están expresados en <span className="font-semibold">{unitLabel}</span> y asumen definiciones homogéneas entre {ent.plural}.
            </p>
          </div>
        </div>
      </div>

      <ConclusionBanner stepNumber={9} text={conclusionText} />

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Anterior</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#2a78d6] rounded-lg hover:bg-blue-700"
        >
          <span>Ir a Descargas y entregables</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
