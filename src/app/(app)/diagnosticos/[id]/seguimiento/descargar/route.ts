import { prisma } from "@/lib/db";
import { requireSession, puedeVerSeguimiento } from "@/lib/session";
import { respuestaCompleta } from "@/lib/constants";

// Descarga del seguimiento como CSV.
//
// Una fila por persona y dominio, no una por persona. Es la granularidad con la que se
// puede dinamizar en Excel: sumar por dominio, por persona o por estado sin rehacer la
// consulta. Agregado de antemano, el archivo solo sirve para lo que uno ya pensó.
//
// Punto y coma y BOM: es lo que Excel en español abre de un doble clic.

const CERRADOS = ["EN_VALIDACION", "COMPLETADO"];

function celda(v: string | number | boolean | null | undefined): string {
  if (v === true) return "Sí";
  if (v === false) return "No";
  if (v === null || v === undefined) return '""';
  if (typeof v === "number") return String(v);
  return `"${v.replace(/"/g, '""')}"`;
}

function fecha(f: Date | null): string {
  return f ? new Date(f).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();

  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    select: { nombre: true, empresaId: true, empresa: { select: { razonSocial: true } } },
  });
  if (!diag) return new Response("No encontrado", { status: 404 });
  if (!(await puedeVerSeguimiento(diag.empresaId))) {
    return new Response("Sin acceso", { status: 403 });
  }

  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId: id, incluido: true },
    orderBy: { dominio: { orden: "asc" } },
    select: {
      estado: true,
      dominio: { select: { orden: true, nombre: true } },
      participantes: {
        orderBy: { user: { nombre: "asc" } },
        select: {
          responsableEvidencia: true,
          user: {
            select: {
              id: true,
              nombre: true,
              cargo: true,
              email: true,
              consentimientoFecha: true,
              ultimoRecordatorio: true,
            },
          },
        },
      },
      respuestas: {
        select: {
          valor: true,
          comentario: true,
          pregunta: { select: { evidenciaObligatoria: true } },
          evidencias: { select: { archivoPath: true, subidoPorId: true } },
          aportes: { select: { userId: true, valor: true, updatedAt: true } },
        },
      },
    },
  });

  const encabezado = [
    "Empresa",
    "Diagnóstico",
    "Participante",
    "Cargo",
    "Correo",
    "Ha ingresado a la plataforma",
    "Dominio N°",
    "Dominio",
    "Estado del dominio",
    "Preguntas del dominio",
    "Respondidas por esta persona",
    "Pendientes para esta persona",
    "¿Respondió algo?",
    "¿Terminó el dominio?",
    "Responsable de evidencia",
    "Documentos que subió",
    "Evidencia pendiente en el dominio",
    "Estado de esta persona",
    "Preguntas completas del dominio",
    "Última respuesta suya en el dominio",
    "Último recordatorio enviado",
  ];

  const filas: string[] = [];
  for (const dd of dds) {
    const total = dd.respuestas.length;
    // Respuestas que afirman que el control existe y no tienen el documento que lo
    // respalda: es lo que impide cerrar el dominio.
    const evidenciaPendiente = dd.respuestas.filter(
      (r) =>
        r.pregunta.evidenciaObligatoria &&
        ["3", "4", "5"].includes(r.valor ?? "") &&
        !r.evidencias.some((e) => e.archivoPath)
    ).length;
    // Si hay responsables de evidencia designados, la carga es de ellos; si no, de todos
    // los participantes del dominio. Mismo criterio que el panel, para que no discrepen.
    const hayDesignados = dd.participantes.some((x) => x.responsableEvidencia);

    const completasDominio = dd.respuestas.filter((r) =>
      respuestaCompleta({
        valor: r.valor,
        comentario: r.comentario,
        evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
        tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
      })
    ).length;

    for (const p of dd.participantes) {
      const mios = dd.respuestas
        .map((r) => r.aportes.find((a) => a.userId === p.user.id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.valor != null);
      const respondidas = mios.length;
      const subidos = dd.respuestas.reduce(
        (acc, r) =>
          acc + r.evidencias.filter((e) => e.archivoPath && e.subidoPorId === p.user.id).length,
        0
      );
      const leTocaEvidencia = !hayDesignados || p.responsableEvidencia;
      const suEvidenciaPendiente = leTocaEvidencia ? evidenciaPendiente : 0;

      // Una sola columna que responde "¿está pendiente, y por qué?" sin tener que cruzar
      // las otras a ojo. Es la que se filtra en la tabla dinámica.
      const cerrado = CERRADOS.includes(dd.estado);
      const termino = total > 0 && respondidas === total;
      const estadoPersona = cerrado && !termino
        ? "Cerrado sin su aporte"
        : respondidas === 0
          ? "Sin iniciar"
          : !termino
            ? "En curso"
            : suEvidenciaPendiente > 0
              ? "Respondió, falta evidencia"
              : "Al día";
      const ultima = mios.reduce<Date | null>(
        (max, a) => (!max || a.updatedAt > max ? a.updatedAt : max),
        null
      );

      filas.push(
        [
          celda(diag.empresa.razonSocial),
          celda(diag.nombre),
          celda(p.user.nombre),
          celda(p.user.cargo),
          celda(p.user.email),
          // Ingresar es aceptar el consentimiento: sin eso no ve ningún dominio.
          celda(Boolean(p.user.consentimientoFecha)),
          celda(dd.dominio.orden),
          celda(dd.dominio.nombre),
          celda(CERRADOS.includes(dd.estado) ? "Cerrado" : dd.estado === "PENDIENTE" ? "Sin iniciar" : "En ejecución"),
          celda(total),
          celda(respondidas),
          celda(total - respondidas),
          celda(respondidas > 0),
          celda(total > 0 && respondidas === total),
          celda(p.responsableEvidencia),
          celda(subidos),
          celda(suEvidenciaPendiente),
          celda(estadoPersona),
          // Del dominio, no de la persona: una pregunta queda completa con el aporte de
          // cualquiera, y su respaldo es compartido.
          celda(completasDominio),
          celda(fecha(ultima)),
          celda(fecha(p.user.ultimoRecordatorio)),
        ].join(";")
      );
    }
  }

  const csv = [
    `"${diag.empresa.razonSocial} — Seguimiento de participantes"`,
    `"${diag.nombre} · generado el ${new Date().toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}"`,
    `"Una fila por participante y dominio asignado."`,
    "",
    encabezado.map((h) => celda(h)).join(";"),
    ...filas,
  ].join("\r\n");

  const nombre = `Seguimiento-${diag.empresa.razonSocial.replace(/[^a-zA-Z0-9]+/g, "-")}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
