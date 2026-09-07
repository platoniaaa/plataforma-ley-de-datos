import "server-only";
import { prisma } from "@/lib/db";

// Cobertura documental del diagnóstico: qué documentación se pidió, qué llegó y qué falta.
//
// Conviven tres listas distintas y es importante no confundirlas, porque responden a
// preguntas diferentes:
//
//   1. Evidencia obligatoria por pregunta — la exigencia dura. Si alguien afirma que un
//      control existe (3/4/5) y la pregunta pide respaldo, sin el documento el dominio no
//      se puede cerrar. Es lo único que bloquea.
//   2. Checklist del levantamiento — los documentos que se pidieron nominalmente al
//      cliente al parametrizar el diagnóstico. Ojo: subir un archivo NO tacha uno de
//      estos ítems, porque cada carga crea su propia fila colgada de una pregunta. Es
//      una lista de referencia de lo que se pidió, no un marcador de avance, y la
//      pantalla la presenta así en vez de dejar 49 pendientes eternos.
//   3. Evidencias mínimas del catálogo — lo que el estándar espera para ese dominio.
//      Es la vara de referencia, no una obligación por pregunta.
//
// Un documento se asocia a la lista 3 cuando alguien declara qué cubre (`cubreEvidencia`).
// Mientras nadie lo declare, el documento está cargado pero no cubre nada: eso es un dato,
// no un error, y la pantalla lo dice así en vez de inventar un calce.

const CERRADOS = ["EN_VALIDACION", "COMPLETADO"];

export type DocumentoCargado = {
  id: string;
  nombre: string;
  tipoDocumental: string | null;
  mimeType: string | null;
  tamano: number | null;
  estado: string;
  createdAt: Date;
  preguntaOrden: number | null;
  subidoPor: string | null;
  cubreEvidencia: string | null;
  /** Otro documento del diagnóstico con el mismo nombre y peso: casi seguro el mismo archivo. */
  repetido: boolean;
};

export type FaltanteObligatoria = {
  preguntaOrden: number;
  preguntaTexto: string;
  valor: string;
};

export type ItemChecklist = {
  id: string;
  nombre: string;
  tipoDocumental: string | null;
  tieneArchivo: boolean;
};

export type CoberturaDominio = {
  orden: number;
  nombre: string;
  cerrado: boolean;
  esperadas: string[];
  cubiertas: string[];
  documentos: DocumentoCargado[];
  checklist: ItemChecklist[];
  faltantesObligatorias: FaltanteObligatoria[];
  participantes: { nombre: string; responsableEvidencia: boolean }[];
};

export type CoberturaDiagnostico = {
  dominios: CoberturaDominio[];
  totalDocumentos: number;
  totalRepetidos: number;
  totalSinClasificar: number;
  dominiosSinDocumentos: number;
  totalObligatoriasFaltantes: number;
  totalEsperadas: number;
  totalCubiertas: number;
  checklistTotal: number;
  checklistConArchivo: number;
};

/** Clave de "es el mismo archivo": mismo nombre y mismo peso exacto. */
function huella(nombre: string, tamano: number | null): string {
  return `${nombre.trim().toLowerCase()}·${tamano ?? 0}`;
}

export async function coberturaDelDiagnostico(
  diagnosticoId: string
): Promise<CoberturaDiagnostico | null> {
  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    orderBy: { dominio: { orden: "asc" } },
    select: {
      id: true,
      estado: true,
      dominio: { select: { orden: true, nombre: true, evidenciasMinimas: true } },
      participantes: {
        select: { responsableEvidencia: true, user: { select: { nombre: true } } },
        orderBy: { user: { nombre: "asc" } },
      },
      // Documentos pedidos al parametrizar el levantamiento. Se filtra por respuestaId
      // nulo porque un archivo cargado queda colgando del dominio Y de su pregunta: sin
      // el filtro, lo subido se mezclaría con lo solicitado y se contaría dos veces.
      evidencias: {
        where: { respuestaId: null },
        select: { id: true, nombre: true, tipoDocumental: true, archivoPath: true },
        orderBy: { nombre: "asc" },
      },
      respuestas: {
        orderBy: { pregunta: { orden: "asc" } },
        select: {
          valor: true,
          pregunta: { select: { orden: true, texto: true, evidenciaObligatoria: true } },
          evidencias: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              nombre: true,
              tipoDocumental: true,
              mimeType: true,
              tamano: true,
              estado: true,
              archivoPath: true,
              createdAt: true,
              cubreEvidencia: true,
            },
          },
        },
      },
    },
  });
  if (dds.length === 0) return null;

  // Los repetidos se detectan sobre el diagnóstico completo y no dominio por dominio:
  // el mismo documento suele respaldar preguntas de dominios distintos, y verlo repartido
  // es justamente lo que hay que notar.
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const dd of dds) {
    for (const r of dd.respuestas) {
      for (const e of r.evidencias) {
        if (!e.archivoPath) continue;
        const h = huella(e.nombre, e.tamano);
        if (vistos.has(h)) repetidos.add(e.id);
        else vistos.add(h);
      }
    }
  }

  // Quién subió cada documento, en una sola consulta en vez de una por documento.
  const ids = dds.flatMap((dd) =>
    dd.respuestas.flatMap((r) => r.evidencias.filter((e) => e.archivoPath).map((e) => e.id))
  );
  const autores = new Map<string, string>();
  if (ids.length > 0) {
    const filas = await prisma.evidencia.findMany({
      where: { id: { in: ids }, subidoPorId: { not: null } },
      select: { id: true, subidoPorId: true },
    });
    const userIds = [...new Set(filas.map((f) => f.subidoPorId!))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(users.map((u) => [u.id, u.nombre]));
    for (const f of filas) autores.set(f.id, nombrePorId.get(f.subidoPorId!) ?? "—");
  }

  const dominios: CoberturaDominio[] = dds.map((dd) => {
    const esperadas: string[] = JSON.parse(dd.dominio.evidenciasMinimas || "[]");

    const documentos: DocumentoCargado[] = [];
    const faltantesObligatorias: FaltanteObligatoria[] = [];

    for (const r of dd.respuestas) {
      const conArchivo = r.evidencias.filter((e) => e.archivoPath);
      for (const e of conArchivo) {
        documentos.push({
          id: e.id,
          nombre: e.nombre,
          tipoDocumental: e.tipoDocumental,
          mimeType: e.mimeType,
          tamano: e.tamano,
          estado: e.estado,
          createdAt: e.createdAt,
          preguntaOrden: r.pregunta.orden,
          subidoPor: autores.get(e.id) ?? null,
          cubreEvidencia: e.cubreEvidencia,
          repetido: repetidos.has(e.id),
        });
      }
      // Solo se exige respaldo donde la respuesta afirma que el control existe.
      if (
        r.pregunta.evidenciaObligatoria &&
        ["3", "4", "5"].includes(r.valor ?? "") &&
        conArchivo.length === 0
      ) {
        faltantesObligatorias.push({
          preguntaOrden: r.pregunta.orden,
          preguntaTexto: r.pregunta.texto,
          valor: r.valor!,
        });
      }
    }

    const cubiertas = [
      ...new Set(documentos.map((d) => d.cubreEvidencia).filter((c): c is string => Boolean(c))),
    ];

    return {
      orden: dd.dominio.orden,
      nombre: dd.dominio.nombre,
      cerrado: CERRADOS.includes(dd.estado),
      esperadas,
      cubiertas,
      documentos: documentos.sort((a, b) => (a.preguntaOrden ?? 0) - (b.preguntaOrden ?? 0)),
      checklist: dd.evidencias.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        tipoDocumental: e.tipoDocumental,
        tieneArchivo: Boolean(e.archivoPath),
      })),
      faltantesObligatorias,
      participantes: dd.participantes.map((p) => ({
        nombre: p.user.nombre,
        responsableEvidencia: p.responsableEvidencia,
      })),
    };
  });

  const todos = dominios.flatMap((d) => d.documentos);
  return {
    dominios,
    totalDocumentos: todos.length,
    totalRepetidos: todos.filter((d) => d.repetido).length,
    totalSinClasificar: todos.filter((d) => !d.cubreEvidencia).length,
    dominiosSinDocumentos: dominios.filter((d) => d.documentos.length === 0).length,
    totalObligatoriasFaltantes: dominios.reduce((n, d) => n + d.faltantesObligatorias.length, 0),
    totalEsperadas: dominios.reduce((n, d) => n + d.esperadas.length, 0),
    totalCubiertas: dominios.reduce((n, d) => n + d.cubiertas.length, 0),
    checklistTotal: dominios.reduce((n, d) => n + d.checklist.length, 0),
    checklistConArchivo: dominios.reduce(
      (n, d) => n + d.checklist.filter((c) => c.tieneArchivo).length,
      0
    ),
  };
}
