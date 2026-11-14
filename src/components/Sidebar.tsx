import React from 'react';
import { Check, Lock, Menu, X } from 'lucide-react';

export interface StepDefinition {
  id: number;
  title: string;
  shortDesc: string;
}

export const STEPS: StepDefinition[] = [
  { id: 1, title: 'Carga', shortDesc: 'Archivo y pregunta' },
  { id: 2, title: 'Calidad de datos', shortDesc: 'Faltantes y atípicos' },
  { id: 3, title: 'Tipos de variables', shortDesc: 'Dummies y fuga' },
  { id: 4, title: 'Análisis exploratorio', shortDesc: 'Estadísticas y reglas' },
  { id: 5, title: 'Variables del modelo', shortDesc: 'Selección de Y y X' },
  { id: 6, title: 'Mejor modelo', shortDesc: 'OLS y supuestos' },
  { id: 7, title: 'Fórmula y brechas', shortDesc: 'Elasticidad y potencial' },
  { id: 8, title: 'Escenarios', shortDesc: 'Monte Carlo y tornado' },
  { id: 9, title: 'Recomendaciones', shortDesc: 'Acciones y límites' },
  { id: 10, title: 'Descargas', shortDesc: 'Word, código y PNG' },
];

interface SidebarProps {
  currentStep: number;
  maxUnlockedStep: number;
  onSelectStep: (step: number) => void;
  datasetInfo: { fileName: string; rows: number; cols: number } | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentStep,
  maxUnlockedStep,
  onSelectStep,
  datasetInfo,
  mobileOpen,
  onCloseMobile,
}) => {
  const navContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-5 border-b border-slate-200 flex items-center justify-between">
        <div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">
            RegresIA
          </span>
          <p className="text-xs text-slate-500 mt-0.5">Regresión múltiple para negocios</p>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
          aria-label="Cerrar menú"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {datasetInfo && (
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70">
          <p className="text-xs font-medium text-slate-800 truncate" title={datasetInfo.fileName}>
            {datasetInfo.fileName}
          </p>
          <p className="text-xs text-slate-500 tabular-nums mt-0.5">
            {datasetInfo.rows} filas · {datasetInfo.cols} columnas
          </p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Pasos del análisis">
        {STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isUnlocked = step.id <= maxUnlockedStep;
          const isCompleted = step.id < currentStep && isUnlocked;

          return (
            <button
              key={step.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => {
                if (isUnlocked) {
                  onSelectStep(step.id);
                  onCloseMobile();
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                isActive
                  ? 'bg-[#2a78d6] text-white'
                  : isUnlocked
                    ? 'text-slate-700 hover:bg-slate-100'
                    : 'text-slate-400 cursor-not-allowed'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-md text-xs font-mono font-semibold flex items-center justify-center shrink-0 tabular-nums ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : isCompleted
                      ? 'bg-slate-100 text-[#2a78d6]'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" />
                ) : !isUnlocked ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  step.id
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight truncate">{step.title}</div>
                <div
                  className={`text-xs truncate mt-0.5 ${
                    isActive ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  {step.shortDesc}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-slate-200 text-xs text-slate-500">
        Procesamiento local en navegador
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{navContent}</div>
        </div>
      )}
    </>
  );
};

export const MobileMenuButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="lg:hidden inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
  >
    <Menu className="w-4 h-4" />
    <span>Pasos</span>
  </button>
);
