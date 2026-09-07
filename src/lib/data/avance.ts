// Avance del levantamiento, en la forma exacta que necesita mostrarlo: un porcentaje
// global y el detalle por dominio.
//
// Vive aparte del motor de madurez a propósito: madurez responde "qué tan bien está la
// empresa" y esto responde "cuánto del trabajo se ha hecho". Son dos preguntas
// distintas y se muestran en momentos distintos.
//
// Lo consumen el panel y —más adelante— el correo de reporte, así que devuelve datos
// planos, sin nada atado a la interfaz.

import { prisma } from "@/lib/db";
import { respuestaCompleta, valorNumerico, clasificarMadurez, type NivelMadurez } from "@/lib/constants";

const CERRADOS = ["EN_VALIDACION", "COMPLETADO"];

/** Una persona asignada al dominio y si ya dejó su mirada registrada. */
export type PersonaDominio = {
  nombre: string;
  cargo: string | null;
  respondio: boolean;
  registradas: number;
};

export type AvanceDominio = {
  orden: number;
  nombre: string;
  total: number;
  completas: number;
  porcentaje: number;
  estado: string;
  cerrado: boolean; // ya enviado a validación
  // Nota de madurez del dominio. Solo tiene sentido leerla donde ya se respondió:
  // en un dominio sin iniciar no es "0", es que todavía no se sabe.
  promedio: number | null;
  nivel: NivelMadurez | null;
  // Cuánta gente respondió, aparte de cuánto se respondió. Un dominio puede verse
  // completo porque una sola persona lo contestó entero, y esa lectura engaña: el
  // levantamiento pierde justamente las miradas que no quedaron registradas.
  participantes: number;
  participantesActivos: number;
  personas: PersonaDominio[];
};

export type AvanceDiagnostico = {
  id: string;
  nombre: string;
  empresa: string;
  total: number;
  completas: number;
  porcentaje: number;
  dominios: AvanceDominio[];
  dominiosCerrados: number;
  evidencias: number;
  participantes: number;
  participantesActivos: number;
};

function pct(parte: number, total: number): number {
  return total === 0 ? 0 : Math.round((parte / total) * 100);
}

export async function avanceDelDiagnostico(diagnosticoId: string): Promise<AvanceDiagnostico | null> {
  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: {
      id: true,
      nombre: true,
      empresa: { select: { razonSocial: true } },
      dominios: {
        where: { incluido: true },
        orderBy: { dominio: { orden: "asc" } },
        select: {
          estado: true,
          dominio: { select: { orden: true, nombre: true } },
          participantes: {
            select: { userId: true, user: { select: { nombre: true, cargo: true } } },
            orderBy: { user: { nombre: "asc" } },
          },
          respuestas: {
            select: {
              valor: true,
              comentario: true,
              pregunta: { select: { evidenciaObligatoria: true } },
              evidencias: { select: { archivoPath: true } },
              aportes: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
  if (!diag) return null;

  const dominios: AvanceDominio[] = [];
  let total = 0;
  let completas = 0;
  let evidencias = 0;
  const personas = new Set<string>();
  const activas = new Set<string>();

  for (const dd of diag.dominios) {
    const t = dd.respuestas.length;
    const c = dd.respuestas.filter((r) =>
      respuestaCompleta({
        valor: r.valor,
        comentario: r.comentario,
        evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
        tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
      })
    ).length;

    total += t;
    completas += c;
    for (const r of dd.respuestas) {
      evidencias += r.evidencias.filter((e) => e.archivoPath).length;
      for (const a of r.aportes) activas.add(a.userId);
    }
    for (const p of dd.participantes) personas.add(p.userId);

    // N/A y OTRO no puntúan: no dicen nada sobre qué tan madura está la práctica.
    const puntuables = dd.respuestas
      .map((r) => valorNumerico(r.valor))
      .filter((n): n is number => n != null);
    const promedio =
      puntuables.length === 0
        ? null
        : Math.round((puntuables.reduce((a, b) => a + b, 0) / puntuables.length) * 100) / 100;

    // Cuántas respuestas registró cada persona EN ESTE dominio.
    const registradasPor = new Map<string, number>();
    for (const r of dd.respuestas) {
      for (const a of r.aportes) {
        registradasPor.set(a.userId, (registradasPor.get(a.userId) ?? 0) + 1);
      }
    }
    const personasDominio: PersonaDominio[] = dd.participantes.map((x) => ({
      nombre: x.user.nombre,
      cargo: x.user.cargo,
      respondio: (registradasPor.get(x.userId) ?? 0) > 0,
      registradas: registradasPor.get(x.userId) ?? 0,
    }));

    dominios.push({
      orden: dd.dominio.orden,
      nombre: dd.dominio.nombre,
      total: t,
      completas: c,
      participantes: personasDominio.length,
      // Solo cuenta quien figura como participante: el consultor también puede escribir
      // la respuesta oficial, y eso no es la mirada de un área del cliente.
      participantesActivos: personasDominio.filter((x) => x.respondio).length,
      personas: personasDominio,
      porcentaje: pct(c, t),
      estado: dd.estado,
      cerrado: CERRADOS.includes(dd.estado),
      promedio,
      nivel: clasificarMadurez(promedio),
    });
  }

  return {
    id: diag.id,
    nombre: diag.nombre,
    empresa: diag.empresa.razonSocial,
    total,
    completas,
    porcentaje: pct(completas, total),
    dominios,
    dominiosCerrados: dominios.filter((d) => d.cerrado).length,
    evidencias,
    participantes: personas.size,
    participantesActivos: activas.size,
  };
}
