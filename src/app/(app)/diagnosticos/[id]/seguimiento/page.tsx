import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession, puedeVerSeguimiento } from "@/lib/session";
import { pendientesDelDiagnostico, queFalta } from "@/lib/data/pendientes";
import { panelEjecutivo } from "@/lib/data/panel";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";
import { BotonRecordatorio } from "@/components/BotonRecordatorio";
import { PanelEjecutivo } from "@/components/PanelEjecutivo";
import { AvanceDiagnostico } from "@/components/AvanceDiagnostico";
import { PersonasPorDominio } from "@/components/PersonasPorDominio";
import { CoberturaDocumental } from "@/components/CoberturaDocumental";

export const metadata = { title: "Seguimiento · Procesos360" };

/** "hace 3 días", "hoy" — más legible que una fecha suelta en una tabla. */
function haceCuanto(f: Date | null): string {
  if (!f) return "nunca";
  const dias = Math.floor((Date.now() - f.getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

export default async function SeguimientoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();

  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    select: { id: true, nombre: true, empresaId: true },
  });
  if (!diag) notFound();
  if (!(await puedeVerSeguimiento(diag.empresaId))) notFound();

  // Una sola consulta compone la vista de gerencia y devuelve de paso el avance y la
  // cobertura, que el detalle operativo de más abajo reutiliza sin volver a pedirlos.
  const panel = await panelEjecutivo(id);
  const participantes = await pendientesDelDiagnostico(id);
  const pendientes = participantes.filter((u) => !u.alDia);
  const alDia = participantes.filter((u) => u.alDia);
  const sinActividad = participantes.filter((u) => !u.ultimaActividad);

  // Dos medidas distintas, y confundirlas hacía que el panel se contradijera solo:
  // decía "74% del levantamiento" y justo debajo "75 preguntas por responder" sobre un
  // total de 70. Una cuenta preguntas; la otra, respuestas individuales.
  //
  //   · sinResponder  — preguntas que NADIE ha contestado. Es la misma unidad que el
  //                     avance del levantamiento, así que los dos números conversan.
  //   · porRegistrar  — respuestas individuales que faltan. Una pregunta que tres
  //                     personas deben mirar cuenta tres veces, porque son tres tareas.
  const porRegistrar = pendientes.reduce((n, u) => n + u.totalPreguntas, 0);
  // `sinResponder` se calcula por dominio, no por persona: es idéntico para todos los
  // participantes del mismo dominio, así que tomar el de cualquiera no lo duplica.
  const sinResponderPorDominio = new Map<number, number>();
  for (const u of pendientes) {
    for (const d of u.dominios) sinResponderPorDominio.set(d.orden, d.sinResponder);
  }
  const sinResponder = [...sinResponderPorDominio.values()].reduce((a, b) => a + b, 0);
  // Se recorre a TODOS, no solo a los que tienen pendientes: alguien puede estar al día
  // en lo abierto y aun así haber quedado fuera de un dominio que se cerró antes.
  const quedaronFuera = participantes.filter((u) => u.cerradosSinAporte.length > 0);
  // Las evidencias se cuentan por dominio, no por persona: si dos participantes comparten
  // un dominio, el documento que falta es el mismo y sumarlo dos veces engaña.
  const evidenciasPorSubir = new Map<number, number>();
  for (const u of pendientes) {
    for (const d of u.dominios) {
      if (d.sinEvidencia > 0) evidenciasPorSubir.set(d.orden, d.sinEvidencia);
    }
  }
  const totalEvidencias = [...evidenciasPorSubir.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Seguimiento de participantes"
          subtitle={`Qué le falta a cada uno en ${diag.nombre}`}
        />
        {/* Una fila por persona y dominio: la granularidad que permite dinamizar en Excel
            sin volver a pedir los datos. */}
        <a
          href={`/diagnosticos/${id}/seguimiento/descargar`}
          className="mt-1 shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-600 hover:text-brand-600"
        >
          Descargar en Excel
        </a>
      </div>
      <DiagnosticoNav id={id} active="seguimiento" />

      {panel && (
        <div className="mb-8">
          <PanelEjecutivo datos={panel} />
        </div>
      )}

      {/* De aquí para abajo es la vista del consultor: el detalle con el que se trabaja,
          no el que se le presenta a una gerencia. */}
      <div className="mb-4 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-semibold text-slate-700">Detalle operativo</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Quién respondió qué, cuánto se avanzó y qué documentación llegó.
        </p>
      </div>

      {panel && (
        <div className="mb-6 space-y-6">
          <PersonasPorDominio datos={panel.avance} />
          <AvanceDiagnostico datos={panel.avance} />
          {panel.cobertura && <CoberturaDocumental datos={panel.cobertura} />}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Con pendientes" valor={pendientes.length} total={participantes.length} />
        <Kpi
          label="Preguntas sin responder"
          valor={sinResponder}
          nota="nadie las ha contestado"
          alerta={sinResponder > 0}
        />
        <Kpi
          label="Respuestas por registrar"
          valor={porRegistrar}
          nota={`entre ${pendientes.length} ${pendientes.length === 1 ? "persona" : "personas"}`}
        />
        <Kpi label="Evidencias por subir" valor={totalEvidencias} alerta={totalEvidencias > 0} />
        <Kpi
          label="Sin responder nada"
          valor={sinActividad.length}
          nota="no registran ni una"
          alerta={sinActividad.length > 0}
        />
        <Kpi label="Al día" valor={alDia.length} bueno={alDia.length > 0} />
      </div>

      {quedaronFuera.length > 0 && (
        <Card className="mb-6 border-orange-200">
          <CardHeader>
            <CardTitle>Cerrados sin el aporte de todos</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">
              Estos dominios se enviaron a validación mientras estas personas no habían
              registrado su respuesta. No pueden hacer nada: el dominio está en solo lectura.
              Decide si lo reabres para recoger su mirada o lo das por cerrado así.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {quedaronFuera.map((u) => (
                <li key={u.userId} className="px-5 py-3">
                  <span className="text-sm font-medium text-slate-800">{u.nombre}</span>
                  {u.cargo && <span className="ml-2 text-xs text-slate-400">{u.cargo}</span>}
                  <ul className="mt-1 space-y-0.5">
                    {u.cerradosSinAporte.map((d) => (
                      <li key={d.orden} className="text-sm text-orange-700">
                        {d.orden}. {d.nombre} —{" "}
                        {d.faltan === 1
                          ? "quedó 1 pregunta sin su respuesta"
                          : `quedaron ${d.faltan} preguntas sin su respuesta`}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Participantes con pendientes</CardTitle>
          {pendientes.length > 0 && (
            <BotonRecordatorio diagnosticoId={id} cuantos={pendientes.length} variante="principal" />
          )}
        </CardHeader>
        <CardContent className="p-0">
          {pendientes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Nadie tiene pendientes. Todos los dominios abiertos están cubiertos.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendientes.map((u) => (
                <li key={u.userId} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{u.nombre}</span>
                        {u.cargo && <span className="text-xs text-slate-400">{u.cargo}</span>}
                        {!u.ultimaActividad && (
                          <Badge color="orange">Sin responder nada</Badge>
                        )}
                        {u.totalPreguntas === 0 && u.evidenciasPendientes > 0 && (
                          <Badge color="yellow">Falta evidencia</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {u.email} · {u.aportes} respuestas registradas · última actividad:{" "}
                        {haceCuanto(u.ultimaActividad)}
                        {u.ultimoRecordatorio && ` · recordado ${haceCuanto(u.ultimoRecordatorio)}`}
                      </p>

                      {/* A quien no ha registrado nada, el desglose le miente: decir
                          "7 sin tu mirada" da a entender que un colega respondió y esta
                          persona no lo revisó, cuando ni siquiera abrió la plataforma. Lo
                          único accionable es que entre, así que se listan sus dominios. */}
                      {u.ultimaActividad ? (
                        <ul className="mt-2 space-y-1">
                          {u.dominios.map((d) => (
                            <li key={d.orden} className="text-sm text-slate-600">
                              <span className="font-medium text-slate-700">
                                {d.orden}. {d.nombre}
                              </span>{" "}
                              <span className="text-slate-400">— {queFalta(d)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-slate-600">
                          <span className="text-slate-400">Sin empezar. A su cargo: </span>
                          <span className="font-medium text-slate-700">
                            {u.dominios.map((d) => `${d.orden}. ${d.nombre}`).join(" · ")}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {u.totalPreguntas > 0 ? (
                        <p className="mb-1 text-2xl font-bold tabular-nums text-slate-900">
                          {u.totalPreguntas}
                          <span className="ml-1 text-xs font-normal text-slate-400">preg.</span>
                        </p>
                      ) : u.evidenciasPendientes > 0 ? (
                        <p className="mb-1 text-2xl font-bold tabular-nums text-slate-900">
                          {u.evidenciasPendientes}
                          <span className="ml-1 text-xs font-normal text-slate-400">evid.</span>
                        </p>
                      ) : null}
                      <BotonRecordatorio diagnosticoId={id} userId={u.userId} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {alDia.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Al día ({alDia.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {alDia.map((u) => (
                <li key={u.userId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{u.nombre}</span>
                    {u.cargo && <span className="ml-2 text-xs text-slate-400">{u.cargo}</span>}
                  </div>
                  <span className="text-xs text-slate-400">
                    {u.aportes} respuestas · última actividad: {haceCuanto(u.ultimaActividad)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Kpi({
  label,
  valor,
  total,
  nota,
  alerta,
  bueno,
}: {
  label: string;
  valor: number;
  total?: number;
  /** Aclara la unidad cuando el número solo se entiende sabiendo qué cuenta. */
  nota?: string;
  alerta?: boolean;
  bueno?: boolean;
}) {
  const color = alerta ? "text-orange-600" : bueno ? "text-green-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {valor}
        {total != null && <span className="text-base font-normal text-slate-400"> / {total}</span>}
      </p>
      {nota && <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{nota}</p>}
    </div>
  );
}
