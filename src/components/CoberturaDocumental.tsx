import type { CoberturaDiagnostico } from "@/lib/data/cobertura";

// Cobertura documental por dominio, para la vista ejecutiva.
//
// Se dibuja con barras HTML y no con un gráfico en SVG o JavaScript, igual que el panel
// de avance: el mismo diseño tiene que poder reproducirse en el correo de reporte al
// cliente, y los clientes de correo no ejecutan scripts.
//
// La barra de cada dominio siempre suma sus evidencias mínimas —ni una más— para que no
// se pueda leer un número mayor que el total. Tiene tres tramos:
//
//   verde  cubierta confirmada: alguien declaró que un documento la respalda.
//   ámbar  cobertura potencial: hay documentos cargados que todavía nadie clasificó.
//          Se topa en lo que falta, porque un documento no puede cubrir más de una.
//   gris   sin nada.
//
// Distinguir el ámbar del verde importa: son documentos que existen pero que nadie ha
// contrastado contra el estándar, y presentarlos como cobertura sería afirmar de más.

const VERDE = "#16a34a";
const AMBAR = "#f59e0b";

type Tramos = {
  orden: number;
  nombre: string;
  esperadas: number;
  cubiertas: number;
  potenciales: number;
  documentos: number;
  bloqueantes: number;
  cerrado: boolean;
};

function tramos(cob: CoberturaDiagnostico): Tramos[] {
  return cob.dominios.map((d) => {
    const sinClasificar = d.documentos.filter((doc) => !doc.cubreEvidencia).length;
    return {
      orden: d.orden,
      nombre: d.nombre,
      esperadas: d.esperadas.length,
      cubiertas: d.cubiertas.length,
      potenciales: Math.max(0, Math.min(sinClasificar, d.esperadas.length - d.cubiertas.length)),
      documentos: d.documentos.length,
      bloqueantes: d.faltantesObligatorias.length,
      cerrado: d.cerrado,
    };
  });
}

function pct(parte: number, total: number): number {
  return total === 0 ? 0 : (parte / total) * 100;
}

export function CoberturaDocumental({ datos }: { datos: CoberturaDiagnostico }) {
  const filas = tramos(datos);
  const cobertura = datos.totalEsperadas
    ? Math.round((datos.totalCubiertas / datos.totalEsperadas) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      {/* ── Encabezado ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Cobertura documental
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-slate-900">{cobertura}%</span>
            <span className="text-sm text-slate-500">
              {datos.totalCubiertas} de {datos.totalEsperadas} evidencias mínimas cubiertas
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-5">
          <Dato valor={datos.totalDocumentos} label="Documentos" />
          <Dato
            valor={datos.totalObligatoriasFaltantes}
            label="Bloquean el cierre"
            alerta={datos.totalObligatoriasFaltantes > 0}
          />
          <Dato
            valor={datos.dominiosSinDocumentos}
            label="Dominios sin nada"
            alerta={datos.dominiosSinDocumentos > 0}
          />
        </div>
      </div>

      {/* ── Barras por dominio ── */}
      <ul className="mt-6 space-y-2.5">
        {filas.map((d) => (
          <li key={d.orden} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                {d.orden}
              </span>
              <span className="truncate text-sm text-slate-700">{d.nombre}</span>
              {d.cerrado && (
                <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                  Cerrado
                </span>
              )}
              {d.bloqueantes > 0 && (
                <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                  {d.bloqueantes} sin respaldo
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {d.documentos > 0 && (
                <span className="mr-2 text-slate-400">
                  {d.documentos} {d.documentos === 1 ? "doc" : "docs"}
                </span>
              )}
              {d.cubiertas}/{d.esperadas}
            </span>

            <div className="col-span-2 ml-7 flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                style={{ width: `${pct(d.cubiertas, d.esperadas)}%`, backgroundColor: VERDE }}
                title={`${d.cubiertas} cubiertas`}
              />
              <div
                style={{ width: `${pct(d.potenciales, d.esperadas)}%`, backgroundColor: AMBAR }}
                title={`${d.potenciales} con documento cargado, sin clasificar`}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* ── Leyenda ── */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500">
        <Marca color={VERDE} texto="Cubierta: un documento la respalda" />
        <Marca color={AMBAR} texto="Documento cargado, sin clasificar todavía" />
        <Marca color="#e2e8f0" texto="Sin documento" />
      </div>
      {datos.totalSinClasificar > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {datos.totalSinClasificar}{" "}
          {datos.totalSinClasificar === 1
            ? "documento está cargado pero nadie ha declarado qué evidencia cubre"
            : "documentos están cargados pero nadie ha declarado qué evidencia cubren"}
          . Hasta que se declare, cuentan como cobertura potencial y no como cobertura.
        </p>
      )}
    </div>
  );
}

function Marca({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-4 rounded-full" style={{ backgroundColor: color }} />
      {texto}
    </span>
  );
}

function Dato({
  valor,
  label,
  alerta,
}: {
  valor: number;
  label: string;
  alerta?: boolean;
}) {
  return (
    <div className="text-right">
      <p
        className={`text-xl font-bold tabular-nums ${alerta ? "text-orange-600" : "text-slate-900"}`}
      >
        {valor}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
