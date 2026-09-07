import "server-only";
import { prisma } from "@/lib/db";
import { avanceDelDiagnostico, type AvanceDiagnostico } from "@/lib/data/avance";
import { coberturaDelDiagnostico, type CoberturaDiagnostico } from "@/lib/data/cobertura";
import type { NivelMadurez } from "@/lib/constants";

// Vista ejecutiva del levantamiento: la que mira una gerencia, no la que opera un
// consultor.
//
// La regla que la ordena es una sola: **el panel declara su propia confiabilidad.**
// Mientras falte gente por opinar, la pregunta que corresponde no es "¿cuán expuestos
// estamos?" sino "¿va a estar listo, y podré confiar en él?". Por eso la madurez de un
// dominio se publica recién cuando todos sus responsables respondieron: antes es un
// número que se va a mover, y alarmar a una gerencia con algo que en dos semanas dice
// otra cosa cuesta la credibilidad de todo el informe.
//
// Es el mismo criterio con el que las brechas se niegan a generarse antes de tiempo.

export type EstadoDominio =
  | "SIN_INICIAR" // nadie ha registrado nada
  | "EN_CURSO" // hay avance, falta gente o preguntas
  | "CERRADO_INCOMPLETO" // cerrado, pero sin todas las miradas: alcance acotado
  | "COMPLETO"; // todos respondieron todo, con su respaldo

export type FilaPanel = {
  orden: number;
  nombre: string;
  /** Cuántas personas tienen el dominio asignado. */
  personas: number;
  personasConRespuesta: number;
  /** Empezaron y todavía no terminan. Es lo que faltaba: la tabla mostraba solo cuántos
   *  habían terminado, y el estado miraba si alguien había empezado. Con un solo número
   *  para dos preguntas distintas, un dominio se veía "0/1 · En curso" y no cerraba. */
  personasRespondiendo: number;
  /** Personas que respondieron TODAS las preguntas del dominio. */
  personasCompletas: number;
  preguntas: number;
  preguntasCompletas: number;
  documentos: number;
  evidenciaFaltante: number;
  cerrado: boolean;
  estado: EstadoDominio;
  /** Solo se publica en dominios completos. Ver la nota de arriba. */
  madurez: number | null;
  nivel: NivelMadurez | null;
};

export type Peticion = {
  severidad: "alta" | "media";
  titulo: string;
  detalle: string;
};

export type PanelEjecutivo = {
  empresa: string;
  diagnostico: string;
  fechaInicio: Date | null;
  fechaCierre: Date | null;
  filas: FilaPanel[];
  dominiosCompletos: number;
  dominiosTotal: number;
  personasTotal: number;
  personasSinIngresar: number;
  documentos: number;
  documentosSinRevisar: number;
  evidenciaFaltante: number;
  peticiones: Peticion[];
  // Se devuelven para que la página no vuelva a consultarlos por su cuenta.
  avance: AvanceDiagnostico;
  cobertura: CoberturaDiagnostico | null;
};

function listar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export async function panelEjecutivo(diagnosticoId: string): Promise<PanelEjecutivo | null> {
  const [diag, avance, cobertura] = await Promise.all([
    prisma.diagnostico.findUnique({
      where: { id: diagnosticoId },
      select: {
        nombre: true,
        fechaInicio: true,
        fechaCierre: true,
        empresa: { select: { razonSocial: true } },
      },
    }),
    avanceDelDiagnostico(diagnosticoId),
    coberturaDelDiagnostico(diagnosticoId),
  ]);
  if (!diag || !avance) return null;

  const porOrden = new Map(cobertura?.dominios.map((d) => [d.orden, d]) ?? []);

  const filas: FilaPanel[] = avance.dominios.map((d) => {
    const cob = porOrden.get(d.orden);
    const evidenciaFaltante = cob?.faltantesObligatorias.length ?? 0;
    // Sin preguntas no hay nada que responder, y sin este resguardo `registradas >= 0`
    // daba por finalizados a todos: el panel mostró "2 finalizaron · -2 respondiendo" en
    // dos dominios que estaban vacíos. Un dominio vacío no está completo, está mal armado.
    const personasCompletas =
      d.total > 0 ? d.personas.filter((p) => p.registradas >= d.total).length : 0;
    const todasLasMiradas =
      d.total > 0 && d.personas.length > 0 && personasCompletas === d.personas.length;

    let estado: EstadoDominio;
    if (d.participantesActivos === 0 && d.completas === 0) estado = "SIN_INICIAR";
    else if (d.cerrado && !todasLasMiradas) estado = "CERRADO_INCOMPLETO";
    else if (todasLasMiradas && d.completas === d.total && evidenciaFaltante === 0)
      estado = "COMPLETO";
    else estado = "EN_CURSO";

    const publicable = estado === "COMPLETO";
    return {
      orden: d.orden,
      nombre: d.nombre,
      personas: d.personas.length,
      personasConRespuesta: d.participantesActivos,
      personasRespondiendo: Math.max(0, d.participantesActivos - personasCompletas),
      personasCompletas,
      preguntas: d.total,
      preguntasCompletas: d.completas,
      documentos: cob?.documentos.length ?? 0,
      evidenciaFaltante,
      cerrado: d.cerrado,
      estado,
      madurez: publicable ? d.promedio : null,
      nivel: publicable ? d.nivel : null,
    };
  });

  // ── Lo que necesita una decisión de la gerencia ──
  const peticiones: Peticion[] = [];

  // Quien no ha entrado nunca no es un atraso: es un bloqueo que solo la jefatura destraba.
  const sinIngresar = await prisma.user.findMany({
    where: {
      activo: true,
      consentimientoFecha: null,
      participaciones: { some: { diagnosticoDominio: { diagnosticoId } } },
    },
    select: {
      nombre: true,
      cargo: true,
      participaciones: {
        select: { diagnosticoDominio: { select: { dominio: { select: { orden: true } } } } },
      },
    },
    orderBy: { nombre: "asc" },
  });
  for (const u of sinIngresar) {
    const doms = u.participaciones
      .map((p) => p.diagnosticoDominio.dominio.orden)
      .sort((a, b) => a - b);
    peticiones.push({
      severidad: "alta",
      titulo: `${u.nombre}${u.cargo ? ` · ${u.cargo}` : ""} no ha ingresado a la plataforma`,
      detalle:
        doms.length === 1
          ? `Tiene el dominio ${doms[0]} a su cargo y nadie más puede responder por él.`
          : `Tiene a su cargo los dominios ${doms.join(", ")} y nadie más puede responder por ellos.`,
    });
  }

  // Un dominio cerrado al que le faltan miradas no está cerrado: es una decisión pendiente.
  for (const f of filas.filter((x) => x.estado === "CERRADO_INCOMPLETO")) {
    const dom = avance.dominios.find((d) => d.orden === f.orden)!;
    const faltantes = dom.personas.filter((p) => p.registradas < dom.total).map((p) => p.nombre);
    peticiones.push({
      severidad: "media",
      titulo: `El dominio ${f.orden} se cerró sin la opinión de ${listar(faltantes)}`,
      detalle:
        "Hay que decidir si se reabre para recoger su mirada o se da por cerrado con lo que hay.",
    });
  }

  // La evidencia obligatoria no es papeleo: sin ella el dominio no se puede dar por cerrado.
  for (const f of filas.filter((x) => x.evidenciaFaltante > 0)) {
    peticiones.push({
      severidad: "alta",
      titulo: `Faltan ${f.evidenciaFaltante} ${
        f.evidenciaFaltante === 1 ? "documento" : "documentos"
      } en el dominio ${f.orden} · ${f.nombre}`,
      detalle:
        "Se afirmó que el control existe, pero no está el documento que lo respalda. Sin él, el dominio no puede cerrarse.",
    });
  }

  peticiones.sort((a, b) => (a.severidad === b.severidad ? 0 : a.severidad === "alta" ? -1 : 1));

  return {
    empresa: diag.empresa.razonSocial,
    diagnostico: diag.nombre,
    fechaInicio: diag.fechaInicio,
    fechaCierre: diag.fechaCierre,
    filas,
    dominiosCompletos: filas.filter((f) => f.estado === "COMPLETO").length,
    dominiosTotal: filas.length,
    personasTotal: avance.participantes,
    personasSinIngresar: sinIngresar.length,
    documentos: cobertura?.totalDocumentos ?? 0,
    documentosSinRevisar: cobertura?.totalSinClasificar ?? 0,
    evidenciaFaltante: cobertura?.totalObligatoriasFaltantes ?? 0,
    peticiones,
    avance,
    cobertura,
  };
}
