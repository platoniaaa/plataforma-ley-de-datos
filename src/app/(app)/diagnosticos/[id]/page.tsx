import Link from "next/link";
import { requireSession, puedeRevisarDominios } from "@/lib/session";
import { ROLES, TIPO_DIAGNOSTICO, NIVEL_MADUREZ, respuestaCompleta } from "@/lib/constants";
import { fmt } from "@/lib/utils";
import { getDiagnosticoFull, madurezDeDiagnostico } from "@/lib/data/diagnosticos";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { EstadoDiagnosticoBadge, NivelBadge } from "@/components/badges";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";

export default async function DiagnosticoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const diag = await getDiagnosticoFull(id, session);
  // El equipo, sin repetir a quien ya figura a cargo.
  const apoyo = diag.equipo
    .filter((e) => e.userId !== diag.consultorId)
    .map((e) => e.user.nombre);
  const madurez = madurezDeDiagnostico(diag);

  const dominiosIncluidos = diag.dominios.filter((d) => d.incluido);
  const totalPreguntas = dominiosIncluidos.reduce((a, d) => a + d.dominio._count.preguntas, 0);
  const completas = dominiosIncluidos.reduce(
    (a, d) =>
      a +
      d.respuestas.filter((r) =>
        respuestaCompleta({
          valor: r.valor,
          comentario: r.comentario,
          evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
          tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
        })
      ).length,
    0
  );
  const avanceGlobal = totalPreguntas ? Math.round((completas / totalPreguntas) * 100) : 0;

  // Dominios asignados al usuario de la sesión (para destacarlos y orientarlo).
  const misDominios = dominiosIncluidos.filter((d) =>
    d.participantes.some((p) => p.userId === session.user.id)
  );
  // El Responsable de Dominio solo responde su cuestionario: sin pestañas de
  // gestión, sin Configurar y sin entrar a dominios ajenos.
  const esResponsableRol = session.user.role === ROLES.RESPONSABLE_DOMINIO;
  // Quien revisa el levantamiento por parte del cliente sigue sin gestión ni Configurar
  // —no es su trabajo— pero sí abre los diez dominios: no se puede controlar lo que no se
  // puede leer, y controlar es para lo que se le dio el permiso.
  const revisa = await puedeRevisarDominios(diag.empresaId);

  return (
    <>
      <DiagnosticoNav id={id} active="resumen" />
      <PageHeader
        title={diag.nombre}
        subtitle={`${diag.empresa.razonSocial} · ${TIPO_DIAGNOSTICO[diag.tipo as keyof typeof TIPO_DIAGNOSTICO] ?? diag.tipo}`}
        actions={
          esResponsableRol ? undefined : (
            <Link
              href={`/diagnosticos/${id}/configurar`}
              className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Configurar
            </Link>
          )
        }
      />

      {/* Resumen del diagnóstico completo: es gestión del proceso, no tarea del
          Responsable de Dominio (§3.4), así que él no lo ve. */}
      {!esResponsableRol && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Estado">
            <EstadoDiagnosticoBadge estado={diag.estado} />
          </StatCard>
          <StatCard label="Madurez global">
            <span
              className="text-2xl font-bold"
              style={{ color: madurez.nivelGlobal ? NIVEL_MADUREZ[madurez.nivelGlobal].color : "#94a3b8" }}
            >
              {fmt(madurez.global)}
            </span>
            <span className="ml-2">
              <NivelBadge nivel={madurez.nivelGlobal} />
            </span>
          </StatCard>
          <StatCard label="Avance">
            <span className="text-2xl font-bold text-slate-800">{avanceGlobal}%</span>
            <span className="ml-1 text-xs text-slate-400">
              ({completas}/{totalPreguntas})
            </span>
          </StatCard>
          <StatCard label="Consultor">
            <span className="text-sm font-medium text-slate-700">
              {diag.consultor?.nombre ?? "Sin asignar"}
            </span>
            {/* El resto del equipo: si el que está a cargo no está, el cliente tiene que
                saber a quién más puede dirigirse. */}
            {apoyo.length > 0 && (
              <span className="mt-0.5 block text-xs text-slate-400">
                con {apoyo.join(", ")}
              </span>
            )}
          </StatCard>
        </div>
      )}

      {/* Aviso: qué dominios le tocan al usuario */}
      {misDominios.length > 0 && (
        <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-700">
            Te corresponde responder {misDominios.length === 1 ? "este dominio" : "estos dominios"}:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {misDominios.map((d) => {
              const res = madurez.dominios.find((m) => m.dominioId === d.dominioId);
              return (
                <Link
                  key={d.id}
                  href={`/diagnosticos/${id}/dominios/${d.dominio.orden}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
                    {d.dominio.orden}
                  </span>
                  {d.dominio.nombre}
                  <span className="text-xs text-slate-400">({res?.avance ?? 0}%)</span>
                  <span aria-hidden>→</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Dominios */}
      <Card>
        <CardHeader>
          <CardTitle>Dominios de evaluación ({dominiosIncluidos.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {diag.dominios.map((d) => {
              const res = madurez.dominios.find((m) => m.dominioId === d.dominioId);
              const esMio =
                d.incluido && d.participantes.some((p) => p.userId === session.user.id);
              if (!d.incluido) {
                return (
                  <li key={d.id} className="flex items-center gap-4 px-5 py-3 opacity-50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-400">
                      {d.dominio.orden}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-500">{d.dominio.nombre}</p>
                      <p className="mt-0.5 text-xs text-slate-400">No aplica en este diagnóstico</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                      Excluido
                    </span>
                  </li>
                );
              }
              // El responsable de dominio no entra a los dominios de otros.
              const bloqueado = esResponsableRol && !esMio && !revisa;
              const contenido = (
                <>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand">
                    {d.dominio.orden}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {d.dominio.nombre}
                      {esMio && (
                        <span className="ml-2 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                          Te corresponde
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-600"
                          style={{ width: `${res?.avance ?? 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{res?.avance ?? 0}%</span>
                    </div>
                    {d.participantes.length > 0 && (
                      <p className="mt-1 truncate text-xs text-slate-400">
                        Participantes: {d.participantes.map((p) => p.user.nombre).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-700">{fmt(res?.promedio ?? null)}</span>
                    <NivelBadge nivel={res?.nivel ?? null} />
                  </div>
                </>
              );
              return (
                <li key={d.id} className={esMio ? "bg-brand-50/60" : undefined}>
                  {bloqueado ? (
                    <div
                      className="flex cursor-not-allowed items-center gap-4 px-5 py-3 opacity-60"
                      title={
                        d.participantes.length > 0
                          ? `Dominio a cargo de ${d.participantes.map((p) => p.user.nombre).join(", ")}`
                          : "Dominio sin participantes asignados"
                      }
                    >
                      {contenido}
                    </div>
                  ) : (
                    <Link
                      href={`/diagnosticos/${id}/dominios/${d.dominio.orden}`}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50"
                    >
                      {contenido}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
