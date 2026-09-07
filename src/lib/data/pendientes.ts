// Sin "server-only": este modulo lo comparten la aplicacion y los scripts de
// linea de comandos, y ese marcador solo resuelve dentro de Next. Igual queda del
// lado del servidor por construccion, porque importa el cliente de base de datos.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { respuestaCompleta } from "@/lib/constants";

// Qué le falta a cada participante. Vive aquí y no en la página ni en el script de
// correos porque ambos deben decir exactamente lo mismo: si el panel dice que a
// alguien le faltan 12 preguntas, el recordatorio que le llega tiene que decir 12.

const BLOQUEADOS = ["EN_VALIDACION", "COMPLETADO"];

export type PendienteDominio = {
  orden: number;
  nombre: string;
  total: number;
  sinResponder: number; // nadie las ha respondido todavía
  sinTuMirada: number; // otro las respondió, esta persona aún no
  sinEvidencia: number; // respondidas, pero falta subir el documento que las respalda
  listoSinEnviar: boolean; // completo, solo falta mandarlo a validación
};

/**
 * Dominio ya cerrado en el que esta persona no alcanzó a registrar nada.
 *
 * Se lleva aparte de los pendientes porque no es una tarea suya: el dominio está en solo
 * lectura y no puede hacer nada al respecto. Pero tampoco puede desaparecer, que es lo
 * que pasaba: al cerrarse un dominio, lo que le faltaba a quien quedó fuera se borraba
 * del panel y nadie volvía a enterarse. Es una decisión del consultor —reabrir el dominio
 * o darlo por cerrado con lo que hay—, y para tomarla primero tiene que verlo.
 */
export type DominioCerradoSinAporte = { orden: number; nombre: string; faltan: number };

export type PendientesUsuario = {
  userId: string;
  nombre: string;
  email: string;
  cargo: string | null;
  dominios: PendienteDominio[];
  cerradosSinAporte: DominioCerradoSinAporte[];
  totalPreguntas: number; // sinResponder + sinTuMirada, sumado
  evidenciasPendientes: number; // preguntas ya respondidas a las que les falta el respaldo
  aportes: number; // cuánto ha respondido en total
  ultimaActividad: Date | null;
  ultimoRecordatorio: Date | null;
  alDia: boolean; // sin nada pendiente
};

/** Estado de todos los participantes de un diagnóstico. */
export async function pendientesDelDiagnostico(diagnosticoId: string): Promise<PendientesUsuario[]> {
  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    select: {
      estado: true,
      dominio: { select: { orden: true, nombre: true } },
      participantes: {
        select: {
          responsableEvidencia: true,
          user: {
            select: {
              id: true, nombre: true, email: true, cargo: true, ultimoRecordatorio: true,
            },
          },
        },
      },
      respuestas: {
        select: {
          valor: true,
          comentario: true,
          pregunta: { select: { evidenciaObligatoria: true } },
          evidencias: { select: { archivoPath: true } },
          aportes: { select: { userId: true, updatedAt: true } },
        },
      },
    },
    orderBy: { dominio: { orden: "asc" } },
  });

  const porUsuario = new Map<string, PendientesUsuario>();

  for (const dd of dds) {
    const total = dd.respuestas.length;
    const bloqueado = BLOQUEADOS.includes(dd.estado);
    const completas = dd.respuestas.filter((r) =>
      respuestaCompleta({
        valor: r.valor,
        comentario: r.comentario,
        evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
        tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
      })
    ).length;

    // Una respuesta 3/4/5 afirma que el control existe: mientras no esté cargado el
    // documento que lo respalda, el dominio no se puede enviar aunque el cuestionario
    // se vea contestado. Esa espera no la contaba nadie, y la persona aparecía "al día".
    const faltaEvidencia = dd.respuestas.filter(
      (r) =>
        r.pregunta.evidenciaObligatoria &&
        ["3", "4", "5"].includes(r.valor ?? "") &&
        !r.evidencias.some((e) => e.archivoPath)
    ).length;
    // Si el dominio tiene responsables de evidencia designados, la carga es de ellos.
    // Si no se designó a nadie, es de todos los que participan del dominio.
    const hayDesignados = dd.participantes.some((p) => p.responsableEvidencia);

    for (const p of dd.participantes) {
      const u = p.user;
      let acc = porUsuario.get(u.id);
      if (!acc) {
        acc = {
          userId: u.id, nombre: u.nombre, email: u.email, cargo: u.cargo,
          dominios: [], cerradosSinAporte: [], totalPreguntas: 0, evidenciasPendientes: 0, aportes: 0,
          ultimaActividad: null, ultimoRecordatorio: u.ultimoRecordatorio, alDia: true,
        };
        porUsuario.set(u.id, acc);
      }

      // Actividad y volumen de aporte se cuentan siempre, incluso en dominios cerrados.
      for (const r of dd.respuestas) {
        for (const a of r.aportes) {
          if (a.userId !== u.id) continue;
          acc.aportes++;
          if (!acc.ultimaActividad || a.updatedAt > acc.ultimaActividad) acc.ultimaActividad = a.updatedAt;
        }
      }

      if (bloqueado) {
        // Ya enviado: no hay nada que pedirle, pero si quedó fuera hay que decirlo.
        const faltan = dd.respuestas.filter(
          (r) => !r.aportes.some((a) => a.userId === u.id)
        ).length;
        if (faltan > 0) {
          acc.cerradosSinAporte.push({
            orden: dd.dominio.orden,
            nombre: dd.dominio.nombre,
            faltan,
          });
        }
        continue;
      }

      const sinResponder = dd.respuestas.filter((r) => r.valor == null).length;
      const sinTuMirada = dd.respuestas.filter(
        (r) => r.valor != null && !r.aportes.some((a) => a.userId === u.id)
      ).length;
      const sinEvidencia = !hayDesignados || p.responsableEvidencia ? faltaEvidencia : 0;
      const listoSinEnviar = total > 0 && completas === total;
      if (sinResponder === 0 && sinTuMirada === 0 && sinEvidencia === 0 && !listoSinEnviar) continue;

      acc.dominios.push({
        orden: dd.dominio.orden, nombre: dd.dominio.nombre, total,
        sinResponder, sinTuMirada, sinEvidencia, listoSinEnviar,
      });
      // La evidencia no suma al contador de preguntas: son dos deudas distintas, y
      // mezclarlas infla el número que se le muestra a la persona en el recordatorio.
      acc.totalPreguntas += sinResponder + sinTuMirada;
      acc.evidenciasPendientes += sinEvidencia;
      acc.alDia = false;
    }
  }

  return [...porUsuario.values()].sort((a, b) => {
    // Primero quien más debe, y entre iguales quien nunca ha entrado.
    if (b.totalPreguntas !== a.totalPreguntas) return b.totalPreguntas - a.totalPreguntas;
    if (!a.ultimaActividad && b.ultimaActividad) return -1;
    if (a.ultimaActividad && !b.ultimaActividad) return 1;
    return a.nombre.localeCompare(b.nombre);
  });
}

export type PendientesGlobal = PendientesUsuario & {
  diagnosticoId: string;
  diagnosticoNombre: string;
  empresa: string;
};

/**
 * Pendientes de todos los diagnósticos abiertos, en una sola lista.
 *
 * El consultor lleva varias empresas a la vez: lo que necesita al abrir la plataforma
 * no es el detalle de un cliente, sino a quién hay que perseguir hoy, sea de quien sea.
 * Los diagnósticos cerrados quedan fuera porque ya no hay nada que pedir.
 *
 * `scopeEmpresa` es obligatorio y viene de `empresaScope(session)`: sin él se colaban
 * los participantes ficticios del entorno de demostración, y la portada contaba gente
 * que no existe. Se pide por parámetro y no se resuelve aquí porque este módulo también
 * lo usan los scripts de línea de comandos, donde no hay sesión.
 */
export async function pendientesGlobales(
  scopeEmpresa: Prisma.DiagnosticoWhereInput
): Promise<PendientesGlobal[]> {
  const diagnosticos = await prisma.diagnostico.findMany({
    where: { ...scopeEmpresa, estado: { not: "CERRADO" } },
    select: { id: true, nombre: true, empresa: { select: { razonSocial: true } } },
    orderBy: { createdAt: "desc" },
  });

  const todos: PendientesGlobal[] = [];
  for (const d of diagnosticos) {
    const participantes = await pendientesDelDiagnostico(d.id);
    for (const u of participantes) {
      if (u.alDia) continue;
      todos.push({
        ...u,
        diagnosticoId: d.id,
        diagnosticoNombre: d.nombre,
        empresa: d.empresa.razonSocial,
      });
    }
  }

  return todos.sort((a, b) => {
    if (b.totalPreguntas !== a.totalPreguntas) return b.totalPreguntas - a.totalPreguntas;
    if (!a.ultimaActividad && b.ultimaActividad) return -1;
    if (a.ultimaActividad && !b.ultimaActividad) return 1;
    return a.nombre.localeCompare(b.nombre);
  });
}

/** Lo mismo, para una sola persona. */
export async function pendientesDeUsuario(
  diagnosticoId: string,
  userId: string
): Promise<PendientesUsuario | null> {
  const todos = await pendientesDelDiagnostico(diagnosticoId);
  return todos.find((u) => u.userId === userId) ?? null;
}

/** Frase corta de lo que falta en un dominio. La comparten el panel y el correo. */
export function queFalta(d: PendienteDominio): string {
  const partes: string[] = [];
  if (d.sinResponder > 0) partes.push(`${d.sinResponder} por responder`);
  if (d.sinTuMirada > 0) partes.push(`${d.sinTuMirada} sin tu mirada`);
  if (d.sinEvidencia > 0)
    partes.push(
      d.sinEvidencia === 1 ? "falta subir 1 evidencia" : `faltan ${d.sinEvidencia} evidencias`
    );
  if (d.listoSinEnviar) partes.push("falta enviarlo");
  return partes.join(" · ");
}
