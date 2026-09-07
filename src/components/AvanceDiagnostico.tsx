import type { AvanceDiagnostico as Datos } from "@/lib/data/avance";

// Avance del cuestionario en un solo número: cuánto del cuestionario está completo.
//
// El detalle por dominio vivía aquí y se quitó: el semáforo del panel ejecutivo ya lo
// cubre, y con mejor criterio. La barra de este bloque se llenaba de verde al responder
// todas las preguntas aunque las hubiera contestado una sola persona de cinco, así que
// las dos vistas de la misma página terminaban contradiciéndose.
//
// Sigue dibujado con HTML y no con SVG ni JavaScript: es el bloque que el correo de
// reporte al cliente reproduce, y los clientes de correo no ejecutan scripts.

export function AvanceDiagnostico({ datos }: { datos: Datos }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      {/* ── Avance global ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Avance del levantamiento
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-slate-900">{datos.porcentaje}%</span>
            <span className="text-sm text-slate-500">
              {datos.completas} de {datos.total} preguntas completas
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-5">
          <Dato valor={`${datos.dominiosCerrados}/${datos.dominios.length}`} label="Dominios cerrados" />
          <Dato valor={datos.evidencias} label="Evidencias" />
          <Dato
            valor={`${datos.participantesActivos}/${datos.participantes}`}
            label="Activos en total"
            alerta={datos.participantesActivos < datos.participantes}
          />
        </div>
      </div>

      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-600 transition-all"
          style={{ width: `${datos.porcentaje}%` }}
        />
      </div>

      {/* El detalle por dominio se quitó a propósito: el semáforo del panel ejecutivo
          ya lo cubre, y con mejor criterio. Aquí la barra se llenaba de verde cuando se
          respondían todas las preguntas, aunque las hubiera contestado una sola persona
          de cinco, de modo que las dos vistas de la misma página se contradecían. Queda
          lo único que este bloque aporta y el semáforo no: el avance en un solo número. */}
    </div>
  );
}

function Dato({
  valor,
  label,
  alerta,
}: {
  valor: string | number;
  label: string;
  alerta?: boolean;
}) {
  return (
    <div className="text-right">
      <p className={`text-xl font-bold tabular-nums ${alerta ? "text-orange-600" : "text-slate-900"}`}>
        {valor}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
