// Constantes y reglas de negocio de la plataforma LPDP.
// Centraliza los valores "enum-like" (almacenados como String en SQLite) y la lógica
// derivada del Documento Funcional Base.

// ───────────────────────── Roles ─────────────────────────

export const ROLES = {
  ADMIN_P360: "ADMIN_P360",
  CONSULTOR: "CONSULTOR",
  ADMIN_EMPRESA: "ADMIN_EMPRESA",
  RESPONSABLE_DOMINIO: "RESPONSABLE_DOMINIO",
  ALTA_DIRECCION: "ALTA_DIRECCION",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN_P360: "Administrador Procesos360",
  CONSULTOR: "Consultor Procesos360",
  ADMIN_EMPRESA: "Administrador Empresa",
  RESPONSABLE_DOMINIO: "Responsable de Dominio",
  ALTA_DIRECCION: "Alta Dirección",
};

/** Roles internos de Procesos360 (sin empresa asociada). */
export const ROLES_P360: Role[] = [ROLES.ADMIN_P360, ROLES.CONSULTOR];

// ───────────────────────── Escala de evaluación ─────────────────────────

export const VALORES = ["0", "1", "2", "3", "4", "5", "N_A", "OTRO"] as const;
export type Valor = (typeof VALORES)[number];

export const ESCALA: Record<Valor, { estado: string; descripcion: string }> = {
  "0": { estado: "No Existe", descripcion: "No existe práctica, control ni evidencia." },
  "1": { estado: "Inicial", descripcion: "Existe informalmente y depende de personas." },
  "2": { estado: "Parcial", descripcion: "Existe parcialmente o sólo en algunas áreas." },
  "3": { estado: "Implementado", descripcion: "Existe formalmente y documentado." },
  "4": { estado: "Gestionado", descripcion: "Se monitorea mediante indicadores." },
  "5": { estado: "Optimizado", descripcion: "Automatizado y sujeto a mejora continua." },
  N_A: { estado: "No Aplica", descripcion: "No aplica al área evaluada." },
  OTRO: { estado: "Otro", descripcion: "Situación distinta, debe describirse." },
};

/** Valor numérico para el cálculo de madurez (N/A y OTRO no puntúan). */
export function valorNumerico(valor: string | null | undefined): number | null {
  if (valor == null) return null;
  if (["0", "1", "2", "3", "4", "5"].includes(valor)) return Number(valor);
  return null; // N_A, OTRO
}

/** Comentario obligatorio si la respuesta es 0, 1, 2, N/A u Otro. */
export function requiereComentario(valor: string | null | undefined): boolean {
  return valor != null && ["0", "1", "2", "N_A", "OTRO"].includes(valor);
}

/**
 * ¿La respuesta está COMPLETA (lista para enviar el dominio)? Espejo de la validación de
 * enviarDominio: requiere valor + comentario cuando aplica (0/1/2/N-A/Otro) + evidencia cuando
 * es obligatoria y el control existe (3/4/5). Tener solo un valor NO cuenta como completa.
 */
export function respuestaCompleta(r: {
  valor: string | null;
  comentario: string | null;
  evidenciaObligatoria: boolean;
  tieneEvidencia: boolean;
}): boolean {
  if (r.valor == null) return false;
  if (requiereComentario(r.valor) && !r.comentario?.trim()) return false;
  if (r.evidenciaObligatoria && ["3", "4", "5"].includes(r.valor) && !r.tieneEvidencia) return false;
  return true;
}

/** Las respuestas 0, 1 y 2 generan brecha preliminar. */
export function generaBrechaPreliminar(valor: string | null | undefined): boolean {
  return valor != null && ["0", "1", "2"].includes(valor);
}

// ───────────────────────── Niveles de madurez ─────────────────────────

export type NivelMadurez = "CRITICO" | "BAJO" | "MEDIO" | "ALTO" | "AVANZADO";

export const NIVEL_MADUREZ: Record<
  NivelMadurez,
  { label: string; estado: string; color: string; min: number; max: number }
> = {
  CRITICO: { label: "Crítico", estado: "No cumple", color: "#dc2626", min: 0.0, max: 1.4 },
  BAJO: { label: "Bajo", estado: "Cumplimiento parcial débil", color: "#f97316", min: 1.5, max: 2.4 },
  MEDIO: { label: "Medio", estado: "Cumplimiento documentado parcial", color: "#eab308", min: 2.5, max: 3.4 },
  ALTO: { label: "Alto", estado: "Cumplimiento gestionado", color: "#22c55e", min: 3.5, max: 4.4 },
  AVANZADO: { label: "Avanzado", estado: "Cumplimiento optimizado", color: "#16a34a", min: 4.5, max: 5.0 },
};

/** Clasifica un promedio (0-5) en su nivel de madurez. */
export function clasificarMadurez(promedio: number | null): NivelMadurez | null {
  if (promedio == null) return null;
  if (promedio <= 1.4) return "CRITICO";
  if (promedio <= 2.4) return "BAJO";
  if (promedio <= 3.4) return "MEDIO";
  if (promedio <= 4.4) return "ALTO";
  return "AVANZADO";
}

// ───────────────────────── Diagnóstico ─────────────────────────

export const TIPO_DIAGNOSTICO = {
  INICIAL: "Diagnóstico Inicial",
  COMPLETO: "Diagnóstico Completo",
  PARCIAL: "Diagnóstico Parcial",
  REEVALUACION: "Reevaluación",
  CERTIFICACION: "Preparación Certificación",
  SEGUIMIENTO: "Seguimiento",
} as const;

export const ESTADO_DIAGNOSTICO = {
  BORRADOR: "Borrador",
  CONFIGURADO: "Configurado",
  EN_EJECUCION: "En ejecución",
  EN_VALIDACION: "En validación",
  CON_BRECHAS: "Con brechas generadas",
  CON_PLAN: "Con plan generado",
  EN_SEGUIMIENTO: "En seguimiento",
  PREPARADO_CERT: "Preparado para certificación",
  CERRADO: "Cerrado",
} as const;

/** Qué significa cada estado (doc §6.6). Se muestra junto a la etiqueta para que no
 *  haya que adivinar en qué punto del proceso va el diagnóstico. */
export const ESTADO_DIAGNOSTICO_DESC: Record<keyof typeof ESTADO_DIAGNOSTICO, string> = {
  BORRADOR: "Diagnóstico creado, pero no iniciado",
  CONFIGURADO: "Tiene dominios y participantes asignados; falta responder",
  EN_EJECUCION: "Los responsables están respondiendo los cuestionarios",
  EN_VALIDACION: "El consultor está revisando las respuestas",
  CON_BRECHAS: "Se ejecutó el motor de brechas",
  CON_PLAN: "Se generó el plan de tratamiento",
  EN_SEGUIMIENTO: "La empresa está ejecutando las acciones",
  PREPARADO_CERT: "Cumple el umbral definido para certificar",
  CERRADO: "Diagnóstico finalizado",
};

// ───────────────────────── Brechas, riesgos, evidencias ─────────────────────────

export const CRITICIDAD = ["BAJA", "MEDIA", "ALTA", "CRITICA"] as const;
export const TIPO_BRECHA = ["REGULATORIA", "DOCUMENTAL", "TECNOLOGICA", "OPERACIONAL"] as const;
export const PROBABILIDAD = ["BAJA", "MEDIA", "ALTA"] as const;
export const IMPACTO = ["BAJO", "MEDIO", "ALTO", "CRITICO"] as const;

export const ESTADO_RESPUESTA = {
  PENDIENTE: "Pendiente",
  RESPONDIDA: "Respondida",
  VALIDADA: "Validada",
  OBSERVADA: "Observada",
} as const;

/** Tamaño máximo de una evidencia. El archivo viaja del navegador directo a Storage
 *  mediante una URL firmada, así que no lo limita el servidor sino el bucket. */
/**
 * Cuántas fichas de proceso se aceptan en una tanda.
 *
 * El levantamiento de un área son cinco o seis fichas, y el de una empresa entera
 * cuarenta. Veinte deja pasar una jornada completa sin que una equivocación al elegir la
 * carpeta mande el disco duro a Storage.
 */
export const MAX_FICHAS_LOTE = 20;

export const MAX_EVIDENCIA_MB = 50;
export const MAX_EVIDENCIA_BYTES = MAX_EVIDENCIA_MB * 1024 * 1024;

export const ESTADO_EVIDENCIA = {
  PENDIENTE: "Pendiente",
  EN_REVISION: "En revisión",
  VALIDADA: "Validada",
  OBSERVADA: "Observada",
  RECHAZADA: "Rechazada",
  VENCIDA: "Vencida",
} as const;

/** Mapea el valor (0/1/2) a la criticidad por defecto de la brecha. */
export function criticidadPorValor(valor: string): (typeof CRITICIDAD)[number] {
  if (valor === "0") return "CRITICA";
  if (valor === "1") return "ALTA";
  return "MEDIA"; // "2"
}

/** Nivel de riesgo a partir de probabilidad × impacto. */
export function nivelRiesgo(
  probabilidad: (typeof PROBABILIDAD)[number],
  impacto: (typeof IMPACTO)[number]
): (typeof IMPACTO)[number] {
  const p = { BAJA: 1, MEDIA: 2, ALTA: 3 }[probabilidad];
  const i = { BAJO: 1, MEDIO: 2, ALTO: 3, CRITICO: 4 }[impacto];
  const score = p * i;
  if (score >= 9) return "CRITICO";
  if (score >= 6) return "ALTO";
  if (score >= 3) return "MEDIO";
  return "BAJO";
}

export type Criticidad = (typeof CRITICIDAD)[number];

// ───────────────────────── Plan de tratamiento (acciones) ─────────────────────────

export const PRIORIDAD = ["ALTA", "MEDIA", "BAJA"] as const;
export const ESFUERZO = ["BAJO", "MEDIO", "ALTO"] as const;

export const ESTADO_ACCION = {
  PENDIENTE: "Pendiente",
  EN_CURSO: "En curso",
  CERRADA: "Cerrada",
} as const;

export const ESTADO_BRECHA = {
  ABIERTA: "Abierta",
  EN_TRATAMIENTO: "En tratamiento",
  CERRADA: "Cerrada",
} as const;

export const ESTADO_RIESGO = {
  ABIERTO: "Abierto",
  EN_TRATAMIENTO: "En tratamiento",
  MITIGADO: "Mitigado",
} as const;

/** Prioridad de la acción según la criticidad de la brecha que la origina. */
export function prioridadPorCriticidad(criticidad: string): (typeof PRIORIDAD)[number] {
  if (criticidad === "CRITICA" || criticidad === "ALTA") return "ALTA";
  if (criticidad === "MEDIA") return "MEDIA";
  return "BAJA";
}

/** Esfuerzo estimado según criticidad. */
export function esfuerzoPorCriticidad(criticidad: string): (typeof ESFUERZO)[number] {
  if (criticidad === "CRITICA") return "ALTO";
  if (criticidad === "ALTA") return "MEDIO";
  return "BAJO";
}

// ───────────────────────── Roadmap (horizontes, doc §13.2) ─────────────────────────

export type HorizonteKey = "H30" | "H60" | "H90" | "H120" | "H180";

export const HORIZONTES: { key: HorizonteKey; label: string; objetivo: string; dias: number }[] = [
  { key: "H30", label: "0–30 días", objetivo: "Resolver brechas críticas", dias: 30 },
  { key: "H60", label: "31–60 días", objetivo: "Formalizar políticas, responsables y controles", dias: 60 },
  { key: "H90", label: "61–90 días", objetivo: "Implementar procedimientos y evidencias", dias: 90 },
  { key: "H120", label: "91–120 días", objetivo: "Monitorear KPI, riesgos y controles", dias: 120 },
  { key: "H180", label: "121–180 días", objetivo: "Preparar expediente de certificación", dias: 180 },
];

/** Días-plazo por defecto desde la fecha base, según criticidad de la brecha. */
export function diasPlazoPorCriticidad(criticidad: string): number {
  if (criticidad === "CRITICA") return 30;
  if (criticidad === "ALTA") return 60;
  if (criticidad === "MEDIA") return 90;
  return 120;
}

/** Ubica una cantidad de días en su horizonte de roadmap. */
export function horizontePorDias(dias: number): HorizonteKey {
  if (dias <= 30) return "H30";
  if (dias <= 60) return "H60";
  if (dias <= 90) return "H90";
  if (dias <= 120) return "H120";
  return "H180";
}

// ───────────────────────── Preparación para certificación (doc §14) ─────────────────────────

export type EstadoPreparacion = "DATOS_INSUFICIENTES" | "NO_PREPARADO" | "INICIAL" | "EN_PROCESO" | "CASI" | "LISTO";

export const ESTADO_PREPARACION: Record<
  EstadoPreparacion,
  { label: string; descripcion: string; color: string; min: number }
> = {
  DATOS_INSUFICIENTES: { label: "Datos insuficientes", descripcion: "Falta completar el levantamiento para evaluar la preparación", color: "#94a3b8", min: 0 },
  NO_PREPARADO: { label: "No preparado", descripcion: "Existen brechas críticas abiertas", color: "#dc2626", min: 0 },
  INICIAL: { label: "Inicial", descripcion: "Existen controles parciales", color: "#f97316", min: 30 },
  EN_PROCESO: { label: "En proceso", descripcion: "Plan de tratamiento en ejecución", color: "#eab308", min: 50 },
  CASI: { label: "Casi preparado", descripcion: "Brechas menores pendientes", color: "#22c55e", min: 75 },
  LISTO: { label: "Listo para certificación", descripcion: "Cumple umbral definido", color: "#16a34a", min: 90 },
};

/** Clasifica el índice de preparación (0-100) en su estado. */
export function clasificarPreparacion(indice: number): EstadoPreparacion {
  if (indice >= 90) return "LISTO";
  if (indice >= 75) return "CASI";
  if (indice >= 50) return "EN_PROCESO";
  if (indice >= 30) return "INICIAL";
  return "NO_PREPARADO";
}

// ───────────────────────── Evidencias (doc §8.3) ─────────────────────────

export const TIPO_DOCUMENTAL = [
  "Política",
  "Procedimiento",
  "Contrato",
  "Cláusula",
  "Registro",
  "Inventario",
  "Acta",
  "Informe",
  "Matriz",
  "Otro",
] as const;
