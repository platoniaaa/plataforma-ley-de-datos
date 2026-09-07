// Motor de Preparación para Certificación — Índice de Preparación (Documento Funcional Base §14).
// Combina madurez, brechas/riesgos críticos abiertos, evidencias validadas y % de plan ejecutado.

import { clasificarPreparacion, type EstadoPreparacion } from "@/lib/constants";

export type PreparacionInput = {
  madurezGlobal: number | null; // 0-5
  brechasCriticasAbiertas: number;
  riesgosCriticosAbiertos: number;
  evidenciasValidadas: number;
  evidenciasRequeridas: number; // preguntas con evidencia obligatoria
  planTotal: number;
  planCerradas: number;
  preguntasRespondidas: number;
  preguntasEnAlcance: number;
};

export type FactorPreparacion = {
  label: string;
  valor: number; // 0-100
  peso: number; // 0-1
};

export type Preparacion = {
  indice: number; // 0-100
  estado: EstadoPreparacion;
  factores: FactorPreparacion[];
  cobertura: number; // 0-100 (% del levantamiento respondido)
  confiable: boolean; // cobertura suficiente para que el índice sea representativo
};

// % del levantamiento que debe estar respondido para que el índice de preparación
// sea representativo. Por debajo, brechas/riesgos/plan aún no se evaluaron.
const UMBRAL_COBERTURA = 80;

function pct(n: number, d: number): number {
  if (d <= 0) return 100; // sin requisitos → no penaliza
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

export function calcularPreparacion(i: PreparacionInput): Preparacion {
  const cobertura =
    i.preguntasEnAlcance > 0 ? Math.round((i.preguntasRespondidas / i.preguntasEnAlcance) * 100) : 0;
  const confiable = cobertura >= UMBRAL_COBERTURA;

  const madurez = i.madurezGlobal != null ? Math.round((i.madurezGlobal / 5) * 100) : 0;
  // Brechas/riesgos/plan solo son representativos con el levantamiento avanzado. Sin cobertura
  // suficiente todavía no se han evaluado, así que NO se dan por cumplidos (evita el "100% de 0"
  // que inflaba el índice de un diagnóstico recién iniciado).
  const brechas = confiable ? Math.max(0, 100 - i.brechasCriticasAbiertas * 20) : 0;
  const riesgos = confiable ? Math.max(0, 100 - i.riesgosCriticosAbiertos * 20) : 0;
  const plan = confiable ? pct(i.planCerradas, i.planTotal) : 0;
  const evidencias = pct(i.evidenciasValidadas, i.evidenciasRequeridas);

  const factores: FactorPreparacion[] = [
    { label: "Madurez global", valor: madurez, peso: 0.3 },
    { label: "Brechas críticas cerradas", valor: brechas, peso: 0.25 },
    { label: "Riesgos críticos mitigados", valor: riesgos, peso: 0.15 },
    { label: "Evidencias validadas", valor: evidencias, peso: 0.15 },
    { label: "Plan de tratamiento ejecutado", valor: plan, peso: 0.15 },
  ];

  const indice = Math.round(factores.reduce((a, f) => a + f.valor * f.peso, 0));

  const estado: EstadoPreparacion = !confiable
    ? "DATOS_INSUFICIENTES"
    : // Regla del doc §14.3: con brechas críticas abiertas, el estado es "No preparado".
      i.brechasCriticasAbiertas > 0
      ? "NO_PREPARADO"
      : clasificarPreparacion(indice);

  return { indice, estado, factores, cobertura, confiable };
}
