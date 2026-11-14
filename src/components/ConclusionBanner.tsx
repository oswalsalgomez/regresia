import React from 'react';
import { Lightbulb } from 'lucide-react';

interface ConclusionBannerProps {
  stepNumber: number;
  text: string;
}

export const ConclusionBanner: React.FC<ConclusionBannerProps> = ({ stepNumber, text }) => {
  return (
    <section
      aria-label={`Conclusión del paso ${stepNumber}`}
      className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-3"
    >
      <div className="p-2 rounded-md bg-white border border-slate-200 text-[#2a78d6] shrink-0">
        <Lightbulb className="w-4 h-4" />
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Conclusión en lenguaje sencillo · Paso {stepNumber}
        </h3>
        <p className="text-sm text-slate-800 leading-relaxed mt-1">{text}</p>
      </div>
    </section>
  );
};
