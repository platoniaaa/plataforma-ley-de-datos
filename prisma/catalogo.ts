// Catálogo LPDP (10 dominios, 83 preguntas) — fuente: src/data/dominios.json.
// Función idempotente compartida por el seed de catálogo (producción) y el de demo (local).
// Solo hace upsert: NUNCA borra dominios ni preguntas, así es seguro re-ejecutarla en
// producción aunque ya existan diagnósticos que referencien el catálogo.

import type { PrismaClient } from "@prisma/client";
import dominiosData from "../src/data/dominios.json";

export type DominioJson = {
  orden: number;
  nombre: string;
  objetivo: string;
  evidenciasMinimas: string[];
  riesgos: string[];
  preguntas: { orden: number; texto: string; descripcion: string }[];
};

const dominios = dominiosData as DominioJson[];

// Heurística: la pregunta exige evidencia documental si menciona un artefacto verificable.
const KEYWORDS_EVIDENCIA = [
  "política", "politica", "procedimiento", "contrato", "registro", "inventario",
  "documenta", "cláusula", "clausula", "acta", "informe", "matriz", "roadmap",
];

export function exigeEvidencia(texto: string): boolean {
  const t = texto.toLowerCase();
  return KEYWORDS_EVIDENCIA.some((k) => t.includes(k));
}

/** Crea o actualiza el catálogo completo. Idempotente. Devuelve el conteo final. */
export async function sembrarCatalogo(prisma: PrismaClient): Promise<{ dominios: number; preguntas: number }> {
  for (const d of dominios) {
    const dom = await prisma.dominio.upsert({
      where: { orden: d.orden },
      create: {
        orden: d.orden,
        nombre: d.nombre,
        objetivo: d.objetivo,
        evidenciasMinimas: JSON.stringify(d.evidenciasMinimas),
        riesgos: JSON.stringify(d.riesgos),
      },
      update: {
        nombre: d.nombre,
        objetivo: d.objetivo,
        evidenciasMinimas: JSON.stringify(d.evidenciasMinimas),
        riesgos: JSON.stringify(d.riesgos),
      },
    });

    for (const p of d.preguntas) {
      await prisma.pregunta.upsert({
        where: { dominioId_orden: { dominioId: dom.id, orden: p.orden } },
        create: {
          dominioId: dom.id,
          orden: p.orden,
          texto: p.texto,
          descripcion: p.descripcion,
          evidenciaObligatoria: exigeEvidencia(p.texto),
        },
        update: {
          texto: p.texto,
          descripcion: p.descripcion,
          evidenciaObligatoria: exigeEvidencia(p.texto),
        },
      });
    }
  }

  const [nDominios, nPreguntas] = await Promise.all([prisma.dominio.count(), prisma.pregunta.count()]);
  return { dominios: nDominios, preguntas: nPreguntas };
}
