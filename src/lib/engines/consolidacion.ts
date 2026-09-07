// Consolidación de aportes → respuesta oficial.
//
// Cuando un dominio tiene varios participantes, cada uno responde en su propio
// AporteRespuesta y de ahí sale la Respuesta oficial, que es la que consumen los
// motores de madurez y brechas.
//
// Regla: CONSERVADORA. Si dos personas evalúan distinto la misma práctica, la oficial
// se queda con la nota más baja. En cumplimiento normativo sobreestimar la madurez es
// el error caro: es preferible revisar de más una práctica que darla por buena sin
// serlo. El consultor puede fijar la oficial a mano (Respuesta.consolidadaManual).

import { valorNumerico } from "@/lib/constants";

export type Aporte = {
  valor: string | null;
  comentario: string | null;
  riesgoIdentificado: string | null;
  autor: string; // nombre para atribuir el comentario
};

export type Consolidado = {
  valor: string | null;
  comentario: string | null;
  riesgoIdentificado: string | null;
};

/** Une textos de varios autores atribuyendo cada uno. Con un solo aporte, va limpio. */
function unirTextos(partes: { autor: string; texto: string }[]): string | null {
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0].texto;
  return partes.map((p) => `${p.autor}: ${p.texto}`).join("\n\n");
}

/**
 * Calcula la respuesta oficial a partir de los aportes.
 *
 * - Si alguien puso una nota numérica (0–5), la oficial es la MENOR de ellas: las
 *   respuestas "No aplica" u "Otro" no bajan ni suben la nota, solo se consideran
 *   cuando nadie puso número.
 * - Si nadie puso número, gana "No aplica" solo si todos coincidieron; si hubo mezcla,
 *   queda "Otro" para que el consultor lo resuelva.
 * - Comentarios y riesgos se acumulan atribuidos a su autor, para no perder ninguno.
 */
export function consolidarAportes(aportes: Aporte[]): Consolidado {
  const conValor = aportes.filter((a) => a.valor != null && a.valor !== "");

  let valor: string | null = null;
  if (conValor.length > 0) {
    const numericos = conValor.filter((a) => valorNumerico(a.valor) != null);
    if (numericos.length > 0) {
      valor = numericos.reduce((min, a) =>
        (valorNumerico(a.valor) as number) < (valorNumerico(min.valor) as number) ? a : min
      ).valor;
    } else {
      const todosNA = conValor.every((a) => a.valor === "N_A");
      valor = todosNA ? "N_A" : "OTRO";
    }
  }

  const comentario = unirTextos(
    aportes
      .filter((a) => a.comentario?.trim())
      .map((a) => ({ autor: a.autor, texto: a.comentario!.trim() }))
  );
  const riesgoIdentificado = unirTextos(
    aportes
      .filter((a) => a.riesgoIdentificado?.trim())
      .map((a) => ({ autor: a.autor, texto: a.riesgoIdentificado!.trim() }))
  );

  return { valor, comentario, riesgoIdentificado };
}

/** ¿Los aportes con nota discrepan entre sí? Señal útil para el consultor. */
export function hayDiscrepancia(aportes: Aporte[]): boolean {
  const notas = aportes.map((a) => a.valor).filter((v): v is string => v != null && v !== "");
  return new Set(notas).size > 1;
}
