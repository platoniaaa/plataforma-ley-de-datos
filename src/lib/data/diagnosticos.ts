import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { empresaScope, puedeRevisarDominios, sinAccesoAEmpresa } from "@/lib/session";
import { calcularMadurez, type DominioInput } from "@/lib/engines/madurez";
import { respuestaCompleta, type Role } from "@/lib/constants";

type SessionLike = { user: { id: string; role: Role; empresaId: string | null } };

/** Verifica acceso a un diagnóstico; devuelve {id, empresaId} o null si no hay acceso. */
export async function assertAccesoDiagnostico(diagnosticoId: string, session: SessionLike) {
  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { id: true, empresaId: true, estado: true, fechaInicio: true },
  });
  if (!diag) return null;
  if (sinAccesoAEmpresa(session, diag.empresaId)) return null;
  return diag;
}

/**
 * True si el usuario participa del dominio. Todos los participantes de un dominio son
 * responsables por igual de responderlo: no hay responsable principal.
 */
export async function esParticipanteDominio(diagnosticoDominioId: string, userId: string) {
  const p = await prisma.participanteDominio.findUnique({
    where: { diagnosticoDominioId_userId: { diagnosticoDominioId, userId } },
    select: { id: true },
  });
  return p !== null;
}

/** Lista de diagnósticos visibles para la sesión (P360 ve todo; resto su empresa). */
export async function listarDiagnosticos(session: SessionLike) {
  return prisma.diagnostico.findMany({
    where: empresaScope(session),
    include: {
      empresa: { select: { razonSocial: true } },
      consultor: { select: { nombre: true } },
      _count: { select: { brechas: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Diagnóstico completo con dominios, preguntas y respuestas. Aplica control de acceso. */
export async function getDiagnosticoFull(id: string, session: SessionLike) {
  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    include: {
      empresa: true,
      consultor: { select: { id: true, nombre: true } },
      equipo: {
        include: { user: { select: { id: true, nombre: true, cargo: true } } },
        orderBy: { user: { nombre: "asc" } },
      },
      dominios: {
        orderBy: { dominio: { orden: "asc" } },
        include: {
          dominio: { include: { _count: { select: { preguntas: true } } } },
          participantes: {
            include: { user: { select: { id: true, nombre: true, cargo: true } } },
            orderBy: { user: { nombre: "asc" } },
          },
          area: { select: { id: true, nombre: true } },
          respuestas: {
            select: {
              id: true,
              valor: true,
              estado: true,
              comentario: true,
              evidencias: { select: { archivoPath: true } },
              pregunta: { select: { evidenciaObligatoria: true } },
            },
          },
        },
      },
    },
  });

  if (!diag) notFound();
  if (sinAccesoAEmpresa(session, diag.empresaId)) notFound();
  return diag;
}

/** Mapa dominioId → área asignada en el diagnóstico (para madurez por área). */
export function areaDeDominioMap(
  diag: Awaited<ReturnType<typeof getDiagnosticoFull>>
): Record<string, { id: string | null; nombre: string }> {
  const map: Record<string, { id: string | null; nombre: string }> = {};
  for (const d of diag.dominios) {
    if (!d.incluido) continue;
    map[d.dominioId] = d.area
      ? { id: d.area.id, nombre: d.area.nombre }
      : { id: null, nombre: "Sin área asignada" };
  }
  return map;
}

/** Madurez del diagnóstico anterior (mismo empresa, creado antes). Null si no hay. */
export async function madurezDiagnosticoAnterior(
  diag: Awaited<ReturnType<typeof getDiagnosticoFull>>,
  session: SessionLike
) {
  const previo = await prisma.diagnostico.findFirst({
    where: { empresaId: diag.empresaId, createdAt: { lt: diag.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!previo) return null;
  const full = await getDiagnosticoFull(previo.id, session);
  return madurezDeDiagnostico(full);
}

/** Riesgos del diagnóstico. */
export async function getRiesgos(diagnosticoId: string) {
  return prisma.riesgo.findMany({
    where: { diagnosticoId },
    include: { brecha: { select: { codigo: true } } },
    orderBy: { id: "asc" },
  });
}

/** Acciones de tratamiento del diagnóstico. */
export async function getAcciones(diagnosticoId: string) {
  return prisma.accionTratamiento.findMany({
    where: { diagnosticoId },
    include: { brecha: { select: { codigo: true, criticidad: true } } },
    orderBy: [{ prioridad: "asc" }, { plazo: "asc" }],
  });
}

/** Evidencias de un diagnóstico (a través de sus respuestas/dominios/brechas/acciones). */
export async function getEvidenciasDiagnostico(diagnosticoId: string) {
  return prisma.evidencia.findMany({
    where: {
      OR: [
        { respuesta: { diagnosticoDominio: { diagnosticoId } } },
        { diagnosticoDominio: { diagnosticoId } },
        { brecha: { diagnosticoId } },
        { accion: { diagnosticoId } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Respuestas completas por dominio (para el reporte técnico). */
export async function getRespuestasPorDominio(diagnosticoId: string) {
  return prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    orderBy: { dominio: { orden: "asc" } },
    include: {
      dominio: { select: { orden: true, nombre: true } },
      participantes: { include: { user: { select: { nombre: true } } } },
      area: { select: { nombre: true } },
      respuestas: {
        orderBy: { pregunta: { orden: "asc" } },
        include: {
          pregunta: { select: { orden: true, texto: true } },
          evidencias: { select: { id: true, nombre: true, estado: true } },
        },
      },
    },
  });
}

/** Matriz de trazabilidad: brecha → pregunta → riesgo → acciones → evidencias. */
export async function getTrazabilidad(diagnosticoId: string) {
  return prisma.brecha.findMany({
    where: { diagnosticoId },
    orderBy: { codigo: "asc" },
    include: {
      respuesta: {
        select: {
          pregunta: { select: { orden: true, texto: true } },
          diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } },
          evidencias: { select: { id: true, estado: true } },
        },
      },
      riesgo: { select: { nivel: true } },
      acciones: { select: { id: true, estado: true, avance: true, prioridad: true } },
    },
  });
}

/** Insumos para el Índice de Preparación para Certificación. */
export async function getPreparacionInput(
  diagnosticoId: string,
  diag: Awaited<ReturnType<typeof getDiagnosticoFull>>,
  madurezGlobal: number | null
) {
  const [brechasCriticasAbiertas, riesgosCriticosAbiertos, planTotal, planCerradas, evidenciasValidadas] =
    await Promise.all([
      prisma.brecha.count({ where: { diagnosticoId, criticidad: "CRITICA", estado: { not: "CERRADA" } } }),
      prisma.riesgo.count({ where: { diagnosticoId, nivel: "CRITICO" } }),
      prisma.accionTratamiento.count({ where: { diagnosticoId } }),
      prisma.accionTratamiento.count({ where: { diagnosticoId, estado: "CERRADA" } }),
      prisma.evidencia.count({
        where: { estado: "VALIDADA", respuesta: { diagnosticoDominio: { diagnosticoId } } },
      }),
    ]);

  // Preguntas con evidencia obligatoria en los dominios incluidos = evidencias requeridas.
  const evidenciasRequeridas = await prisma.pregunta.count({
    where: {
      evidenciaObligatoria: true,
      dominio: { diagnosticoDominios: { some: { diagnosticoId, incluido: true } } },
    },
  });

  const dominiosIncluidos = diag.dominios.filter((d) => d.incluido);
  const preguntasEnAlcance = dominiosIncluidos.reduce((a, d) => a + d.dominio._count.preguntas, 0);
  const preguntasRespondidas = dominiosIncluidos.reduce(
    (a, d) => a + d.respuestas.filter((r) => r.valor != null).length,
    0
  );

  return {
    madurezGlobal,
    brechasCriticasAbiertas,
    riesgosCriticosAbiertos,
    evidenciasValidadas,
    evidenciasRequeridas,
    planTotal,
    planCerradas,
    preguntasRespondidas,
    preguntasEnAlcance,
  };
}

/** Un dominio de un diagnóstico con sus preguntas y respuestas (para el cuestionario). */
export async function getDiagnosticoDominio(
  diagnosticoId: string,
  dominioOrden: number,
  session: SessionLike
) {
  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { id: true, nombre: true, empresaId: true, estado: true },
  });
  if (!diag) notFound();
  if (sinAccesoAEmpresa(session, diag.empresaId)) notFound();

  // Quién revisa decide qué se carga, no el rol. La contraparte del cliente que revisa el
  // levantamiento necesita ver los aportes de todos para poder consolidar: sin eso ve los
  // botones de validar pero no lo que tendría que estar validando.
  const revisa = await puedeRevisarDominios(diag.empresaId);

  const dd = await prisma.diagnosticoDominio.findFirst({
    where: { diagnosticoId, dominio: { orden: dominioOrden } },
    include: {
      dominio: true,
      participantes: {
        include: { user: { select: { id: true, nombre: true, cargo: true } } },
        orderBy: { user: { nombre: "asc" } },
      },
      respuestas: {
        include: {
          pregunta: true,
          evidencias: true,
          // Aportes individuales: el participante solo recibe el suyo (responde a
          // ciegas); quien revisa los recibe todos para poder consolidar.
          aportes: revisa
            ? {
                include: { user: { select: { id: true, nombre: true, cargo: true } } },
                orderBy: { user: { nombre: "asc" } },
              }
            : {
                where: { userId: session.user.id },
                include: { user: { select: { id: true, nombre: true, cargo: true } } },
              },
        },
        orderBy: { pregunta: { orden: "asc" } },
      },
    },
  });
  if (!dd) notFound();
  return { diag, dd };
}

/** Construye el input del motor de madurez a partir del diagnóstico completo. */
export function madurezDeDiagnostico(
  diag: Awaited<ReturnType<typeof getDiagnosticoFull>>
) {
  const dominios: DominioInput[] = diag.dominios
    .filter((d) => d.incluido)
    .map((d) => ({
      dominioId: d.dominioId,
      orden: d.dominio.orden,
      nombre: d.dominio.nombre,
      totalPreguntas: d.dominio._count.preguntas,
      respuestas: d.respuestas.map((r) => ({
        preguntaId: r.id,
        valor: r.valor,
        completo: respuestaCompleta({
          valor: r.valor,
          comentario: r.comentario,
          evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
          tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
        }),
      })),
    }));
  return calcularMadurez(dominios);
}
