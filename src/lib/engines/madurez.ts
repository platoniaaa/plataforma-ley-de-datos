// Motor de Madurez — calcula el nivel de cumplimiento (0-5) por pregunta, dominio y global.
// Las respuestas N/A y OTRO no puntúan (se excluyen del promedio).

import { clasificarMadurez, valorNumerico, type NivelMadurez } from "@/lib/constants";

export type RespuestaInput = {
  preguntaId: string;
  valor: string | null;
  completo?: boolean; // cumple las reglas para enviar (valor + comentario + evidencia si aplica)
};

export type DominioInput = {
  dominioId: string;
  orden: number;
  nombre: string;
  respuestas: RespuestaInput[];
  totalPreguntas: number;
};

export type ResultadoDominio = {
  dominioId: string;
  orden: number;
  nombre: string;
  promedio: number | null;
  nivel: NivelMadurez | null;
  respondidas: number; // con valor elegido
  completas: number; // listas para enviar (valor + comentario + evidencia si aplica)
  puntuables: number;
  totalPreguntas: number;
  avance: number; // % COMPLETAS sobre total (no solo "con valor")
};

export type ResultadoMadurez = {
  global: number | null;
  nivelGlobal: NivelMadurez | null;
  dominios: ResultadoDominio[];
  criticos: ResultadoDominio[]; // dominios peor evaluados (nivel CRITICO o BAJO)
  mejores: ResultadoDominio[];
};

function promedio(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export function calcularMadurez(dominios: DominioInput[]): ResultadoMadurez {
  const resultados: ResultadoDominio[] = dominios.map((d) => {
    const puntuables = d.respuestas
      .map((r) => valorNumerico(r.valor))
      .filter((n): n is number => n != null);
    const respondidas = d.respuestas.filter((r) => r.valor != null).length;
    const completas = d.respuestas.filter((r) => r.completo).length;
    const prom = promedio(puntuables);
    return {
      dominioId: d.dominioId,
      orden: d.orden,
      nombre: d.nombre,
      promedio: prom,
      nivel: clasificarMadurez(prom),
      respondidas,
      completas,
      puntuables: puntuables.length,
      totalPreguntas: d.totalPreguntas,
      // Avance = % de preguntas COMPLETAS (listas para enviar), no solo con valor elegido.
      avance: d.totalPreguntas > 0 ? Math.round((completas / d.totalPreguntas) * 100) : 0,
    };
  });

  // Global: promedio ponderado por número de preguntas puntuables.
  const todasPuntuables = dominios.flatMap((d) =>
    d.respuestas.map((r) => valorNumerico(r.valor)).filter((n): n is number => n != null)
  );
  const global = promedio(todasPuntuables);

  const conPromedio = resultados.filter((r) => r.promedio != null);
  const criticos = [...conPromedio]
    .filter((r) => r.nivel === "CRITICO" || r.nivel === "BAJO")
    .sort((a, b) => (a.promedio ?? 0) - (b.promedio ?? 0));
  const mejores = [...conPromedio].sort((a, b) => (b.promedio ?? 0) - (a.promedio ?? 0)).slice(0, 3);

  return {
    global,
    nivelGlobal: clasificarMadurez(global),
    dominios: resultados,
    criticos,
    mejores,
  };
}

// ───────────────────────── Madurez por área (doc §9.4) ─────────────────────────

export type ResultadoArea = {
  areaId: string | null;
  nombre: string;
  promedio: number | null;
  nivel: NivelMadurez | null;
  dominios: number;
};

/**
 * Agrupa la madurez por área. `areaDeDominio` mapea dominioId → { id, nombre } del área
 * asignada a ese dominio en el diagnóstico. Los dominios sin área se agrupan en "Sin área".
 */
export function madurezPorArea(
  resultado: ResultadoMadurez,
  areaDeDominio: Record<string, { id: string | null; nombre: string }>
): ResultadoArea[] {
  const grupos = new Map<string, { nombre: string; areaId: string | null; suma: number; peso: number; dominios: number }>();

  for (const d of resultado.dominios) {
    const area = areaDeDominio[d.dominioId] ?? { id: null, nombre: "Sin área asignada" };
    const clave = area.id ?? "__sin__";
    const g = grupos.get(clave) ?? { nombre: area.nombre, areaId: area.id, suma: 0, peso: 0, dominios: 0 };
    g.dominios += 1;
    if (d.promedio != null && d.puntuables > 0) {
      g.suma += d.promedio * d.puntuables;
      g.peso += d.puntuables;
    }
    grupos.set(clave, g);
  }

  return [...grupos.values()]
    .map((g) => {
      const promedio = g.peso > 0 ? Math.round((g.suma / g.peso) * 100) / 100 : null;
      return { areaId: g.areaId, nombre: g.nombre, promedio, nivel: clasificarMadurez(promedio), dominios: g.dominios };
    })
    .sort((a, b) => (a.promedio ?? 99) - (b.promedio ?? 99));
}

// ───────────────────────── Comparación con diagnóstico anterior (doc §9.4) ─────────────────────────

export type ComparacionMadurez = {
  globalActual: number | null;
  globalPrevia: number | null;
  delta: number | null;
  dominios: { orden: number; nombre: string; actual: number | null; previa: number | null; delta: number | null }[];
};

function delta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100) / 100;
}

export function compararMadurez(
  actual: ResultadoMadurez,
  previa: ResultadoMadurez | null
): ComparacionMadurez {
  const dominios = actual.dominios.map((d) => {
    const p = previa?.dominios.find((x) => x.orden === d.orden) ?? null;
    return {
      orden: d.orden,
      nombre: d.nombre,
      actual: d.promedio,
      previa: p?.promedio ?? null,
      delta: delta(d.promedio, p?.promedio ?? null),
    };
  });
  return {
    globalActual: actual.global,
    globalPrevia: previa?.global ?? null,
    delta: delta(actual.global, previa?.global ?? null),
    dominios,
  };
}
