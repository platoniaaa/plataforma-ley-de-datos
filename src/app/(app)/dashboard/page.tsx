import Link from "next/link";
import {
  requireSession,
  getCurrentUser,
  esStaffP360,
  empresaScope,
  coordinaSeguimiento,
} from "@/lib/session";
import {
  ROLE_LABELS,
  NIVEL_MADUREZ,
  ROLES,
  ESTADO_DIAGNOSTICO_DESC,
  respuestaCompleta,
  type Role,
} from "@/lib/constants";
import { fmt } from "@/lib/utils";
import { prisma } from "@/lib/db";
import {
  listarDiagnosticos,
  getDiagnosticoFull,
  madurezDeDiagnostico,
  getPreparacionInput,
} from "@/lib/data/diagnosticos";
import { calcularPreparacion } from "@/lib/engines/certificacion";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { NivelBadge, EstadoDiagnosticoBadge, PreparacionBadge } from "@/components/badges";
import { BotonRecordatorio } from "@/components/BotonRecordatorio";
import { pendientesGlobales } from "@/lib/data/pendientes";

type SessionLike = { user: { id: string; role: Role; empresaId: string | null } };

export default async function DashboardPage() {
  const session = await requireSession();
  const user = await getCurrentUser();

  return (
    <>
      <PageHeader
        title={`Hola, ${user?.nombre?.split(" ")[0] ?? ""}`}
        subtitle={`${ROLE_LABELS[session.user.role]}${user?.empresa ? ` · ${user.empresa.razonSocial}` : ""}`}
      />
      {esStaffP360(session.user.role) ? (
        <DashboardP360 session={session} />
      ) : session.user.role === ROLES.ALTA_DIRECCION ? (
        <DashboardDireccion empresaId={session.user.empresaId} />
      ) : (
        <DashboardEmpresa session={session} />
      )}
    </>
  );
}

// ───────────── Consultor / Admin P360 (doc §16.2) ─────────────

async function DashboardP360({ session }: { session: SessionLike }) {
  const [diagnosticos, empresas, respuestasPendientes, evidenciasPorValidar, accionesVencidas] = await Promise.all([
    listarDiagnosticos(session),
    prisma.empresa.count(),
    prisma.respuesta.count({ where: { valor: null } }),
    prisma.evidencia.count({ where: { estado: { in: ["PENDIENTE", "EN_REVISION"] } } }),
    prisma.accionTratamiento.count({ where: { plazo: { lt: new Date() }, estado: { not: "CERRADA" } } }),
  ]);
  const totalBrechas = diagnosticos.reduce((a, d) => a + d._count.brechas, 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Empresas" valor={empresas} />
        <Kpi label="Diagnósticos" valor={diagnosticos.length} />
        <Kpi label="Brechas" valor={totalBrechas} />
        <Kpi label="Respuestas pend." valor={respuestasPendientes} />
        <Kpi label="Evid. por validar" valor={evidenciasPorValidar} color={evidenciasPorValidar ? "#f97316" : undefined} />
        <Kpi label="Acciones vencidas" valor={accionesVencidas} color={accionesVencidas ? "#dc2626" : undefined} />
      </div>

      <SeguimientoResumen session={session} />

      <Card>
        <CardHeader>
          <CardTitle>Diagnósticos recientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {diagnosticos.slice(0, 8).map((d) => (
              <li key={d.id}>
                <Link href={`/diagnosticos/${d.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.nombre}</p>
                    <p className="text-xs text-slate-400">{d.empresa.razonSocial}</p>
                  </div>
                  <EstadoDiagnosticoBadge estado={d.estado} />
                </Link>
              </li>
            ))}
            {diagnosticos.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-slate-400">Sin diagnósticos.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Quién tiene respuestas pendientes, en todas las empresas a la vez. Va en la portada
 * porque es lo primero que el consultor necesita decidir cada mañana: a quién apurar.
 * El detalle por empresa vive en la pestaña Seguimiento de cada diagnóstico.
 */
async function SeguimientoResumen({ session }: { session: SessionLike }) {
  // Mismo alcance que el resto de la portada: quien está acotado a una empresa (por
  // ejemplo la cuenta de demostración) ve solo la suya, y el staff no ve la demo.
  const pendientes = await pendientesGlobales(empresaScope(session));
  if (pendientes.length === 0) return null;

  // Mide que no registran ni una respuesta, no que no hayan ingresado: para eso está
  // Accesos, que mira el consentimiento. Decirle "nunca ha entrado" a alguien que sí
  // entró y no contestó hacía que las dos pantallas se contradijeran.
  const sinActividad = pendientes.filter((u) => !u.ultimaActividad).length;
  // Un diagnóstico por empresa es lo habitual: si todos son del mismo, sobra repetirlo.
  const variosDiagnosticos = new Set(pendientes.map((d) => d.diagnosticoId)).size > 1;
  const visibles = pendientes.slice(0, 6);

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Participantes con pendientes</CardTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            {pendientes.length} {pendientes.length === 1 ? "persona" : "personas"}
            {sinActividad > 0 &&
              ` · ${sinActividad} sin responder nada`}
          </p>
        </div>
        <Link
          href={`/diagnosticos/${pendientes[0].diagnosticoId}/seguimiento`}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          Ver seguimiento completo →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-slate-100">
          {visibles.map((u) => (
            <li
              key={`${u.diagnosticoId}-${u.userId}`}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{u.nombre}</span>
                  {u.cargo && <span className="text-xs text-slate-400">{u.cargo}</span>}
                  {!u.ultimaActividad && <Badge color="orange">Sin responder nada</Badge>}
                  {u.totalPreguntas === 0 && u.evidenciasPendientes > 0 && (
                    <Badge color="yellow">Falta evidencia</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {variosDiagnosticos && `${u.empresa} · `}
                  {u.dominios.map((d) => `${d.orden}. ${d.nombre}`).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {u.totalPreguntas > 0 ? (
                  <span className="text-sm font-semibold tabular-nums text-slate-700">
                    {u.totalPreguntas}
                    <span className="ml-1 text-xs font-normal text-slate-400">preg.</span>
                  </span>
                ) : u.evidenciasPendientes > 0 ? (
                  <span className="text-sm font-semibold tabular-nums text-slate-700">
                    {u.evidenciasPendientes}
                    <span className="ml-1 text-xs font-normal text-slate-400">evid.</span>
                  </span>
                ) : null}
                <BotonRecordatorio diagnosticoId={u.diagnosticoId} userId={u.userId} />
              </div>
            </li>
          ))}
        </ul>
        {pendientes.length > visibles.length && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
            y {pendientes.length - visibles.length} más
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── Alta Dirección (doc §16.1) ─────────────

async function DashboardDireccion({ empresaId }: { empresaId: string | null }) {
  const diag = await diagnosticoVigente(empresaId);
  if (!diag) return <Vacio />;

  const full = await getDiagnosticoFull(diag.id, { user: { id: "", role: ROLES.ALTA_DIRECCION, empresaId } });
  const madurez = madurezDeDiagnostico(full);
  const prep = calcularPreparacion(await getPreparacionInput(diag.id, full, madurez.global));

  const [brechasCriticas, riesgosCriticos, accionesTotal, accionesCerradas, accionesVencidas, evidenciasPend] =
    await Promise.all([
      prisma.brecha.count({ where: { diagnosticoId: diag.id, criticidad: "CRITICA", estado: { not: "CERRADA" } } }),
      prisma.riesgo.count({ where: { diagnosticoId: diag.id, nivel: "CRITICO" } }),
      prisma.accionTratamiento.count({ where: { diagnosticoId: diag.id } }),
      prisma.accionTratamiento.count({ where: { diagnosticoId: diag.id, estado: "CERRADA" } }),
      prisma.accionTratamiento.count({ where: { diagnosticoId: diag.id, plazo: { lt: new Date() }, estado: { not: "CERRADA" } } }),
      prisma.evidencia.count({ where: { estado: { in: ["PENDIENTE", "EN_REVISION"] }, respuesta: { diagnosticoDominio: { diagnosticoId: diag.id } } } }),
    ]);
  const avancePlan = accionesTotal ? Math.round((accionesCerradas / accionesTotal) * 100) : 0;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Madurez global" valor={fmt(madurez.global)} color={madurez.nivelGlobal ? NIVEL_MADUREZ[madurez.nivelGlobal].color : undefined} extra={<NivelBadge nivel={madurez.nivelGlobal} />} />
        <Kpi label="Preparación cert." valor={prep.indice} extra={<PreparacionBadge estado={prep.estado} />} />
        <Kpi label="Brechas críticas" valor={brechasCriticas} color={brechasCriticas ? "#dc2626" : undefined} />
        <Kpi label="Riesgos críticos" valor={riesgosCriticos} color={riesgosCriticos ? "#dc2626" : undefined} />
        <Kpi label="Avance del plan" valor={`${avancePlan}%`} />
        <Kpi label="Acciones vencidas" valor={accionesVencidas} color={accionesVencidas ? "#f97316" : undefined} />
        <Kpi label="Evidencias pend." valor={evidenciasPend} />
        <Kpi label="Estado" valor="" extra={<EstadoDiagnosticoBadge estado={full.estado} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dominios críticos</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {madurez.criticos.slice(0, 6).map((d) => (
                <li key={d.dominioId} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-slate-700">D{d.orden} · {d.nombre}</span>
                  <span className="flex items-center gap-2"><span className="text-sm font-semibold">{fmt(d.promedio)}</span><NivelBadge nivel={d.nivel} /></span>
                </li>
              ))}
              {madurez.criticos.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-400">Sin dominios críticos.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Accesos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Acceso href={`/diagnosticos/${diag.id}/certificacion`} label="Índice de preparación" />
            <Acceso href={`/diagnosticos/${diag.id}/reporte`} label="Reporte ejecutivo" />
            <Acceso href={`/diagnosticos/${diag.id}/roadmap`} label="Roadmap de cumplimiento" />
            <Acceso href={`/diagnosticos/${diag.id}/expediente`} label="Expediente digital" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ───────────── Vista Empresa (doc §16.3) ─────────────
//
// Una sola vista para el lado cliente (Admin Empresa y Responsable de Dominio), como
// define el §16.3. Muestra: tareas asignadas, preguntas pendientes, evidencias
// solicitadas, observaciones del consultor, acciones correctivas y estado del proceso.
// Madurez global y brechas NO van aquí: el documento las sitúa en el §16.1 (Alta Dirección).
//
// Los indicadores de tarea se calculan sobre lo ASIGNADO a quien mira ("tareas asignadas"
// del §16.3): el Responsable de Dominio ve lo suyo; el Admin de Empresa, que no participa
// de dominios puntuales, ve el diagnóstico completo.

async function DashboardEmpresa({ session }: { session: SessionLike }) {
  const { empresaId, id: userId, role } = session.user;
  const diag = await diagnosticoVigente(empresaId);
  if (!diag) return <Vacio />;

  // La contraparte que lleva el control interno ve, además de su propia tarea, en qué
  // van sus colegas. Es el mismo panel del consultor, acotado a su empresa.
  const coordina = await coordinaSeguimiento();

  // Dominios en los que este usuario participa (guía directa de su tarea).
  const misDominios = await prisma.diagnosticoDominio.findMany({
    where: {
      diagnosticoId: diag.id,
      incluido: true,
      participantes: { some: { userId } },
    },
    include: {
      dominio: { select: { orden: true, nombre: true, _count: { select: { preguntas: true } } } },
      respuestas: {
        select: {
          valor: true,
          comentario: true,
          evidencias: { select: { archivoPath: true } },
          pregunta: { select: { evidenciaObligatoria: true } },
          // Solo el aporte de quien mira: su avance es el suyo, no el del dominio.
          aportes: { where: { userId }, select: { valor: true, comentario: true } },
        },
      },
    },
    orderBy: { dominio: { orden: "asc" } },
  });

  const full = await getDiagnosticoFull(diag.id, { user: { id: "", role: ROLES.ADMIN_EMPRESA, empresaId } });
  const incluidos = full.dominios.filter((d) => d.incluido);

  // Alcance: el Responsable de Dominio responde por los dominios que tiene asignados;
  // el resto del lado empresa (Admin Empresa) responde por el diagnóstico completo.
  const esResponsable = role === ROLES.RESPONSABLE_DOMINIO;
  const alcanceIds = esResponsable
    ? misDominios.map((d) => d.id)
    : incluidos.map((d) => d.id);
  const enAlcance = { id: { in: alcanceIds } };

  const totalAlcance = esResponsable
    ? misDominios.reduce((a, d) => a + d.dominio._count.preguntas, 0)
    : incluidos.reduce((a, d) => a + d.dominio._count.preguntas, 0);
  const esCompleta = (r: {
    valor: string | null;
    comentario: string | null;
    evidencias: { archivoPath: string | null }[];
    pregunta: { evidenciaObligatoria: boolean };
  }) =>
    respuestaCompleta({
      valor: r.valor,
      comentario: r.comentario,
      evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
      tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
    });

  // El Responsable de Dominio ve SU avance. Mostrarle el del dominio le hace creer que
  // ya respondio cuando en realidad respondio un colega —y como trabaja a ciegas, ni
  // siquiera puede ver ese trabajo para darse cuenta del malentendido.
  const miCompleta = (r: {
    evidencias: { archivoPath: string | null }[];
    pregunta: { evidenciaObligatoria: boolean };
    aportes: { valor: string | null; comentario: string | null }[];
  }) => {
    const a = r.aportes[0];
    if (!a) return false;
    return respuestaCompleta({
      valor: a.valor,
      comentario: a.comentario,
      evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
      // La evidencia es del dominio: si un colega ya la subio, cuenta para todos.
      tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
    });
  };

  const completasAlcance = esResponsable
    ? misDominios.reduce((a, d) => a + d.respuestas.filter(miCompleta).length, 0)
    : incluidos.reduce((a, d) => a + d.respuestas.filter(esCompleta).length, 0);
  const avance = totalAlcance ? Math.round((completasAlcance / totalAlcance) * 100) : 0;

  const [evidenciasSolicitadas, evidenciasObservadas, respuestasObservadas, accionesAbiertas] =
    await Promise.all([
      // Evidencias del checklist aún sin archivo cargado.
      prisma.evidencia.count({
        where: { estado: "PENDIENTE", archivoPath: null, diagnosticoDominio: enAlcance },
      }),
      prisma.evidencia.count({
        where: { estado: "OBSERVADA", respuesta: { diagnosticoDominio: enAlcance } },
      }),
      prisma.respuesta.count({ where: { estado: "OBSERVADA", diagnosticoDominio: enAlcance } }),
      prisma.accionTratamiento.count({
        where: { diagnosticoId: diag.id, estado: { not: "CERRADA" } },
      }),
    ]);
  const observaciones = respuestasObservadas + evidenciasObservadas;
  const tareasAsignadas = esResponsable ? misDominios.length : incluidos.length;

  return (
    <>
      {misDominios.length > 0 && (
        <Card className="mb-6 border-brand-200 bg-brand-50">
          <CardHeader>
            <CardTitle>Tu tarea: {misDominios.length === 1 ? "el dominio que te corresponde responder" : "los dominios que te corresponde responder"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {misDominios.map((d) => {
              const tot = d.dominio._count.preguntas;
              const resp = d.respuestas.filter((r) => r.aportes[0]?.valor != null).length;
              return (
                <Link
                  key={d.id}
                  href={`/diagnosticos/${diag.id}/dominios/${d.dominio.orden}`}
                  className="inline-flex items-center gap-3 rounded-lg border border-brand-300 bg-white px-4 py-3 text-sm font-medium text-brand-700 hover:bg-brand-100"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
                    {d.dominio.orden}
                  </span>
                  <span>
                    {d.dominio.nombre}
                    <span className="block text-xs font-normal text-slate-500">
                      {resp} de {tot} preguntas respondidas
                    </span>
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label={esResponsable ? "Mis dominios" : "Tareas asignadas"} valor={tareasAsignadas} />
        <Kpi label="Preguntas pend." valor={totalAlcance - completasAlcance} />
        <Kpi label="Avance" valor={`${avance}%`} />
        <Kpi label="Evid. solicitadas" valor={evidenciasSolicitadas} />
        <Kpi
          label="Observaciones"
          valor={observaciones}
          color={observaciones ? "#f97316" : undefined}
        />
        <Kpi label="Acciones correctivas" valor={accionesAbiertas} />
      </div>

      {coordina && <SeguimientoResumen session={session} />}

      {/* "Estado del proceso" es seguimiento del diagnóstico completo (§16.3): le sirve al
          Admin de Empresa, no al Responsable de Dominio, que solo responde lo suyo (§3.4). */}
      {!esResponsable && (
        <div className="mb-6">
          <Card>
            <CardContent className="py-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Estado del proceso
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoDiagnosticoBadge estado={diag.estado} />
                <span className="text-sm text-slate-600">
                  {ESTADO_DIAGNOSTICO_DESC[diag.estado as keyof typeof ESTADO_DIAGNOSTICO_DESC]}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Diagnóstico: {diag.nombre}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Accesos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Acceso href={`/diagnosticos/${diag.id}`} label="Continuar diagnóstico →" />
          {/* El Responsable de Dominio se limita a responder su cuestionario (§3.4). */}
          {!esResponsable && (
            <>
              <Acceso href={`/diagnosticos/${diag.id}/plan`} label="Ver plan de tratamiento →" />
              <Acceso href={`/diagnosticos/${diag.id}/brechas`} label="Ver brechas →" />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ───────────── Helpers ─────────────

async function diagnosticoVigente(empresaId: string | null) {
  if (!empresaId) return null;
  return prisma.diagnostico.findFirst({
    where: { empresaId },
    orderBy: { createdAt: "desc" },
    select: { id: true, nombre: true, estado: true },
  });
}

function Vacio() {
  return <Card className="p-8 text-sm text-slate-500">Aún no hay diagnósticos para tu empresa.</Card>;
}

function Acceso({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-brand-600 hover:bg-slate-50">
      {label}
    </Link>
  );
}

function Kpi({ label, valor, color, extra }: { label: string; valor: React.ReactNode; color?: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold" style={{ color: color ?? "#0f172a" }}>{valor}</span>
        {extra}
      </div>
    </div>
  );
}
