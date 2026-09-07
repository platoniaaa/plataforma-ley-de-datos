"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, sinAccesoAEmpresa } from "@/lib/session";
import { ROLES } from "@/lib/constants";
import { CAMPOS_ANALIZABLES, CODIGOS_ESTADO_RAT, claveNombre, type CampoClave } from "@/lib/rat";
import {
  proponerActividades,
  type ActividadPropuesta,
  type ModoAnalisis,
} from "@/lib/engines/extraccion-rat";

export type RatResult = { ok: boolean; error?: string; creados?: number; omitidos?: number };

/**
 * El RAT lo llena la empresa; el consultor lo revisa. El Responsable de Dominio queda
 * fuera: su trabajo es el cuestionario de sus dominios, no el registro completo.
 */
async function permiso(empresaId: string) {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { error: "Tu rol responde el cuestionario; el RAT lo mantiene la empresa." };
  }
  if (sinAccesoAEmpresa(session, empresaId)) return { error: "Sin acceso." };
  return { session };
}

/**
 * Arma el borrador: una actividad por cada área que declaró tratar datos y todavía no
 * tiene ninguna.
 *
 * Deja los campos vacíos a propósito. La plataforma sabe QUÉ áreas tratan datos —lo
 * declararon en el levantamiento— pero no sabe para qué, con qué base legal ni por
 * cuánto tiempo. Rellenar eso con supuestos convertiría un registro legal en una
 * conjetura, y el RAT es justamente el documento con el que la empresa responde.
 */
export async function generarBorradorRat(empresaId: string): Promise<RatResult> {
  const { error } = await permiso(empresaId);
  if (error) return { ok: false, error };

  const areas = await prisma.area.findMany({
    where: { empresaId, trataDatos: true },
    select: { id: true, nombre: true, trataDatosSensibles: true, usaSistemas: true },
    orderBy: { nombre: "asc" },
  });
  const yaTienen = new Set(
    (
      await prisma.tratamientoDato.findMany({
        where: { empresaId },
        select: { areaId: true },
      })
    )
      .map((t) => t.areaId)
      .filter(Boolean)
  );

  const nuevas = areas.filter((a) => !yaTienen.has(a.id));
  if (nuevas.length === 0) {
    return { ok: false, error: "Todas las áreas que tratan datos ya tienen al menos una actividad." };
  }

  const desde = await siguienteCorrelativo(empresaId);
  await prisma.tratamientoDato.createMany({
    data: nuevas.map((a, i) => ({
      empresaId,
      areaId: a.id,
      codigo: correlativo(desde + i),
      nombre: `Tratamiento de datos — ${a.nombre}`,
      areaPropuesta: a.nombre,
      // Lo único que se prellena es lo que el área ya declaró en el levantamiento.
      datosSensibles: a.trataDatosSensibles,
      estado: "BORRADOR",
    })),
  });

  revalidatePath("/diagnosticos", "layout");
  return { ok: true, creados: nuevas.length };
}

// ───────────────────────────── Códigos de fila ─────────────────────────────

const correlativo = (n: number) => `RAT-${String(n).padStart(3, "0")}`;

/**
 * El siguiente número libre del registro.
 *
 * Los códigos son lo que permite que la matriz se descargue, se edite fuera y vuelva a
 * cruzarse con la fila correcta. Se calcula sobre el máximo existente y no sobre la
 * cantidad de filas: si alguien borra RAT-014, el 14 no se reutiliza —reutilizarlo haría
 * que dos versiones del archivo llamen igual a actividades distintas—.
 */
async function siguienteCorrelativo(empresaId: string): Promise<number> {
  const usados = await prisma.tratamientoDato.findMany({
    where: { empresaId, codigo: { not: null } },
    select: { codigo: true },
  });
  const max = usados.reduce((m, t) => {
    const n = Number(t.codigo?.match(/(\d+)\s*$/)?.[1] ?? 0);
    return n > m ? n : m;
  }, 0);
  return max + 1;
}

// ───────────────────────────── Edición manual ─────────────────────────────

const texto = (max: number) => z.string().max(max).optional();

const guardarSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().trim().min(3, "Ponle un nombre a la actividad.").max(200),
  codigo: texto(40),
  areaId: z.string().optional(),
  procesos: texto(1000),
  areaPropuesta: texto(300),
  duenoProceso: texto(300),
  finalidad: texto(2000),
  categoriasTitulares: texto(1000),
  categoriasDatos: texto(2000),
  idsInventario: texto(1000),
  datosInvolucrados: texto(2000),
  clasificacionDato: texto(300),
  datosSensibles: z.boolean(),
  origen: texto(500),
  baseLegal: texto(1000),
  sistemas: texto(1000),
  encargados: texto(1000),
  destinatarios: texto(2000),
  transferenciaInternacional: z.boolean(),
  paisesDestino: texto(500),
  garantiasTransferencia: texto(1000),
  plazoConservacion: texto(500),
  criterioEliminacion: texto(1000),
  decisionesAutomatizadas: texto(1000),
  medidasSeguridad: texto(2000),
  evaluarEipd: texto(200),
  riesgoPreliminar: texto(200),
  evidenciasSolicitar: texto(2000),
  fuenteDiseno: texto(1000),
  observaciones: texto(2000),
  estado: z.enum(CODIGOS_ESTADO_RAT),
});

export async function guardarTratamiento(
  input: z.input<typeof guardarSchema>
): Promise<RatResult> {
  const parsed = guardarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { id, areaId, nombre, datosSensibles, transferenciaInternacional, estado, ...resto } =
    parsed.data;

  const actual = await prisma.tratamientoDato.findUnique({
    where: { id },
    select: { empresaId: true },
  });
  if (!actual) return { ok: false, error: "Actividad no encontrada." };
  const { error } = await permiso(actual.empresaId);
  if (error) return { ok: false, error };

  // Un área de otra empresa no puede colarse por el formulario.
  if (areaId) {
    const ok = await prisma.area.count({ where: { id: areaId, empresaId: actual.empresaId } });
    if (ok === 0) return { ok: false, error: "Esa área no pertenece a esta empresa." };
  }

  const vacioANull = (s: string | undefined) => (s?.trim() ? s.trim() : null);
  const textos = Object.fromEntries(
    Object.entries(resto).map(([k, v]) => [k, vacioANull(v as string | undefined)])
  );

  try {
    await prisma.tratamientoDato.update({
      where: { id },
      data: { ...textos, nombre, areaId: areaId || null, datosSensibles, transferenciaInternacional, estado },
    });
  } catch {
    // El código es único por empresa: dos filas con el mismo RAT-014 romperían el cruce
    // con la matriz descargada, que es justamente para lo que sirve el código.
    return { ok: false, error: "Ese código ya lo tiene otra actividad de esta empresa." };
  }

  revalidatePath("/diagnosticos", "layout");
  return { ok: true };
}

export async function crearTratamiento(empresaId: string): Promise<RatResult> {
  const { error } = await permiso(empresaId);
  if (error) return { ok: false, error };

  // El código va en el nombre: dos filas llamadas "Nueva actividad de tratamiento" son
  // indistinguibles en la lista, y quien agregó dos por error no sabe cuál abrir.
  const codigo = correlativo(await siguienteCorrelativo(empresaId));
  await prisma.tratamientoDato.create({
    data: { empresaId, codigo, nombre: `Nueva actividad ${codigo}`, estado: "BORRADOR" },
  });
  revalidatePath("/diagnosticos", "layout");
  return { ok: true, creados: 1 };
}

export async function eliminarTratamiento(id: string): Promise<RatResult> {
  const actual = await prisma.tratamientoDato.findUnique({
    where: { id },
    select: { empresaId: true, estado: true },
  });
  if (!actual) return { ok: false, error: "Actividad no encontrada." };
  const { error } = await permiso(actual.empresaId);
  if (error) return { ok: false, error };
  // Una actividad validada es parte del registro legal: se saca de vigencia antes.
  if (actual.estado === "VIGENTE") {
    return { ok: false, error: "Está validada. Cámbiala a borrador antes de eliminarla." };
  }

  await prisma.tratamientoDato.delete({ where: { id } });
  revalidatePath("/diagnosticos", "layout");
  return { ok: true };
}

// ───────────────── Propuesta a partir del material del cliente ─────────────────

export type PropuestaResult = {
  ok: boolean;
  error?: string;
  modo?: ModoAnalisis;
  actividades?: ActividadPropuesta[];
  /** El análisis se quedó sin espacio: lo que llega es parte de la respuesta. */
  parcial?: boolean;
  /** Archivos que se intentaron leer y no aportaron nada, con el motivo. */
  problemas?: { nombre: string; motivo: string }[];
  fuentes?: {
    documentos: number;
    comentarios: number;
    fichas: number;
    inventario: number;
    sinCupo: number;
  };
};

/**
 * Lee lo que la empresa entregó y propone actividades, o completa las que ya están.
 *
 * No escribe nada: devuelve sugerencias con su cita para que el consultor las revise. El
 * paso de aceptar es deliberadamente aparte, porque un RAT es un registro legal y quien
 * responde por él es una persona, no el análisis.
 */
export async function proponerDesdeElLevantamiento(
  diagnosticoId: string,
  modo: ModoAnalisis = "nuevas"
): Promise<PropuestaResult> {
  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { empresaId: true },
  });
  if (!diag) return { ok: false, error: "Diagnóstico no encontrado." };
  const { error } = await permiso(diag.empresaId);
  if (error) return { ok: false, error };

  const r = await proponerActividades(diagnosticoId, modo);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.actividades.length === 0) {
    return {
      ok: false,
      problemas: r.problemas,
      error:
        modo === "completar"
          ? "El análisis no encontró en el material nada que sustente los campos que faltan. Es el resultado esperado cuando lo que falta —plazos, encargados, medidas— todavía no está declarado en ninguna parte."
          : "El análisis no encontró actividades de tratamiento sustentables en el material. Suele pasar cuando lo entregado describe carencias en vez de tratamientos.",
    };
  }
  return {
    ok: true,
    modo,
    actividades: r.actividades,
    parcial: r.parcial,
    problemas: r.problemas,
    fuentes: r.fuentes,
  };
}

// El análisis manda claves libres: se validan por forma y después se filtran contra la
// lista de campos conocidos, que es la que decide qué se escribe.
const propuestaSchema = z
  .object({
    nombre: z.string().trim().min(3).max(200),
    codigo: z.string().max(40).nullish(),
    area: z.string().nullish(),
    datosSensibles: z.boolean(),
    transferenciaInternacional: z.boolean(),
  })
  .catchall(z.unknown());

const aceptarSchema = z.object({
  empresaId: z.string().min(1),
  actividades: z.array(propuestaSchema).min(1).max(60),
});

type Propuesta = z.infer<typeof propuestaSchema>;

/** El valor propuesto para un campo, si vino con la forma esperada. */
function valorDe(a: Propuesta, clave: CampoClave): string | null {
  const c = a[clave];
  if (!c || typeof c !== "object") return null;
  const valor = (c as { valor?: unknown }).valor;
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Los campos analizables de una propuesta, listos para escribir. */
function camposDe(a: Propuesta): Record<string, string | null> {
  const datos: Record<string, string | null> = {};
  for (const c of CAMPOS_ANALIZABLES) {
    const v = valorDe(a, c.clave);
    if (v) datos[c.clave] = v;
  }
  return datos;
}

/**
 * Deja anotado de dónde salió cada campo.
 *
 * Es la columna que convierte la propuesta en algo auditable: sin ella, dentro de un mes
 * nadie puede decir si "encargado: Deloitte" lo dijo el cliente o lo supuso el análisis.
 */
function fuenteDe(a: Propuesta): string | null {
  const citas = CAMPOS_ANALIZABLES.map((c) => {
    const campo = a[c.clave];
    const cita = campo && typeof campo === "object" ? (campo as { cita?: unknown }).cita : null;
    return typeof cita === "string" && cita.trim() ? `${c.etiqueta}: “${cita.trim()}”` : null;
  }).filter(Boolean);
  return citas.length > 0 ? `Propuesto por el análisis del material — ${citas.join(" · ")}`.slice(0, 4000) : null;
}

/** Crea en el registro las actividades que el consultor aceptó. Siempre como BORRADOR. */
export async function aceptarPropuesta(
  input: z.input<typeof aceptarSchema>
): Promise<RatResult> {
  const parsed = aceptarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { empresaId, actividades } = parsed.data;
  const { error } = await permiso(empresaId);
  if (error) return { ok: false, error };

  const areas = await prisma.area.findMany({
    where: { empresaId },
    select: { id: true, nombre: true },
  });
  const porNombre = new Map(areas.map((a) => [a.nombre.toLowerCase(), a.id]));

  // Red de seguridad contra las repeticiones. Al análisis ya se le dice qué hay en el
  // registro, pero la instrucción es una petición y esto es una garantía: el registro es
  // un documento legal, y dos filas para el mismo tratamiento se leen como dos
  // tratamientos. Vale también dentro de la misma tanda, donde el modelo a veces parte
  // una actividad en dos con nombres parecidos.
  const yaExisten = new Set(
    (
      await prisma.tratamientoDato.findMany({ where: { empresaId }, select: { nombre: true } })
    ).map((t) => claveNombre(t.nombre))
  );

  const nuevas = actividades.filter((a) => {
    const clave = claveNombre(a.nombre);
    if (yaExisten.has(clave)) return false;
    yaExisten.add(clave);
    return true;
  });
  const omitidos = actividades.length - nuevas.length;

  if (nuevas.length === 0) {
    return { ok: false, error: "Todas esas actividades ya están en el registro.", omitidos };
  }

  const desde = await siguienteCorrelativo(empresaId);
  await prisma.tratamientoDato.createMany({
    data: nuevas.map((a, i) => ({
      empresaId,
      codigo: correlativo(desde + i),
      areaId: a.area ? (porNombre.get(a.area.toLowerCase()) ?? null) : null,
      areaPropuesta: a.area ?? null,
      nombre: a.nombre,
      ...camposDe(a),
      fuenteDiseno: fuenteDe(a),
      datosSensibles: a.datosSensibles,
      transferenciaInternacional: a.transferenciaInternacional,
      // Nunca entra validado: lo propuso un análisis y todavía nadie lo verificó contra
      // la operación real de la empresa.
      estado: "BORRADOR",
    })),
  });

  revalidatePath("/diagnosticos", "layout");
  return { ok: true, creados: nuevas.length, omitidos };
}

/**
 * Escribe en filas que ya existen lo que el análisis pudo sustentar.
 *
 * Solo llena huecos: un campo que ya tiene contenido no se toca, porque puede haberlo
 * escrito el dueño del proceso y el análisis no está por sobre él. Y no cambia el estado
 * de validación: una fila validada que recibe un campo nuevo pasaría a decir algo que
 * nadie validó, así que se marca para que la vuelvan a mirar.
 */
export async function aceptarComplementos(
  input: z.input<typeof aceptarSchema>
): Promise<RatResult> {
  const parsed = aceptarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { empresaId, actividades } = parsed.data;
  const { error } = await permiso(empresaId);
  if (error) return { ok: false, error };

  const existentes = await prisma.tratamientoDato.findMany({
    where: { empresaId },
    select: { id: true, codigo: true, nombre: true, estado: true },
  });
  const porCodigo = new Map(existentes.filter((t) => t.codigo).map((t) => [t.codigo!, t]));
  const porNombre = new Map(existentes.map((t) => [t.nombre.toLowerCase(), t]));

  let tocadas = 0;
  for (const a of actividades) {
    const fila = (a.codigo ? porCodigo.get(a.codigo) : null) ?? porNombre.get(a.nombre.toLowerCase());
    if (!fila) continue;

    // Se releen los valores actuales para no pisar lo que alguien escribió a mano.
    const actual = await prisma.tratamientoDato.findUnique({
      where: { id: fila.id },
      select: Object.fromEntries(CAMPOS_ANALIZABLES.map((c) => [c.clave, true])) as Record<
        string,
        true
      >,
    });
    if (!actual) continue;

    const datos: Record<string, string | null> = {};
    for (const [clave, valor] of Object.entries(camposDe(a))) {
      const previo = (actual as Record<string, unknown>)[clave];
      if (typeof previo === "string" && previo.trim()) continue;
      datos[clave] = valor;
    }
    if (Object.keys(datos).length === 0) continue;

    const fuente = fuenteDe(a);
    await prisma.tratamientoDato.update({
      where: { id: fila.id },
      data: {
        ...datos,
        ...(fuente ? { fuenteDiseno: fuente } : {}),
        ...(fila.estado === "VIGENTE" ? { estado: "REQUIERE_AJUSTE" } : {}),
      },
    });
    tocadas++;
  }

  if (tocadas === 0) {
    return { ok: false, error: "Nada que completar: esos campos ya estaban llenos." };
  }
  revalidatePath("/diagnosticos", "layout");
  return { ok: true, creados: tocadas };
}
