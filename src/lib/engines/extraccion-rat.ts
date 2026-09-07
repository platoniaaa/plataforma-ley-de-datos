import "server-only";
import { prisma } from "@/lib/db";
import { urlFirmadaEvidencia } from "@/lib/storage";
import { CAMPOS_ANALIZABLES, type CampoClave } from "@/lib/rat";
import { analisisLoLee, esOfficeLegible } from "@/lib/documentos";
import { extraerTexto } from "@/lib/engines/texto-documento";

// Propuesta de actividades de tratamiento a partir de lo que el cliente ya entregó.
//
// Dos reglas gobiernan este motor, y las dos son de oficio antes que técnicas:
//
//   1. **Propone, no decide.** Lo que sale de aquí son sugerencias con su cita de
//      respaldo. Nada se escribe en el RAT sin que una persona lo confirme. Un RAT es
//      un registro legal: que un modelo escriba "base legal: consentimiento" y nadie lo
//      verifique es exactamente lo que no puede pasar.
//   2. **No inventa.** Si algo no está dicho en la fuente, el campo vuelve vacío. Es
//      preferible un registro con huecos —que se ven y se llenan— que uno completo con
//      supuestos, porque el segundo se firma sin que nadie note el invento.
//
// Lee TODO el levantamiento, no solo el dominio del RAT. Cuatro dominios aportan campos
// que ese no puede dar por sí solo —bases legales el 3, medidas de seguridad el 5,
// encargados y destinatarios el 7, plazos de conservación el 9— y el material completo
// son unos 1.500 tokens: leerlo entero cuesta menos que perder esos campos.
//
// Funciona de dos maneras. En modo "nuevas" propone actividades que todavía no están en
// el registro. En modo "completar" recorre las filas que ya existen y solo busca en el
// material lo que a cada una le falta: es lo que convierte una matriz llena de "Por
// validar en workshop" en una con celdas llenas y citadas.

const MODELO = "gemini-2.5-flash";
// Dos cupos distintos, porque los dos tipos de archivo no cuestan lo mismo.
//
// Un PDF o una imagen viajan enteros en base64: pesan, y cuatro es lo que cabe sin
// arriesgar que la petición se caiga por tiempo. Un Word o un Excel viajan como el texto
// que se les extrajo en el servidor, que es una fracción de eso; su techo real es el
// presupuesto de caracteres, no la cantidad.
//
// Tenerlos bajo un mismo tope de cuatro dejaba fuera fichas de proceso sin ninguna razón,
// y justamente las fichas llegan casi siempre en Excel.
const MAX_BINARIOS = 4;
const MAX_OFICINA = 12;
const MAX_CANDIDATOS = 40;
const MAX_MB_POR_DOCUMENTO = 8;
// Presupuesto de texto extraído, repartido entre los documentos que entren. Antes cada
// uno podía aportar 40.000 caracteres por su cuenta: con cuatro fichas la consulta se
// hacía lenta y cara sin que la extracción mejorara.
const PRESUPUESTO_TEXTO = 60_000;

export type ModoAnalisis = "nuevas" | "completar";

export type CampoPropuesto = { valor: string; cita: string };

export type ActividadPropuesta = Omit<
  Partial<Record<CampoClave, CampoPropuesto>>,
  "nombre"
> & {
  nombre: string;
  area: string | null;
  /** En modo "completar", la fila del registro a la que corresponde la propuesta. */
  codigo?: string | null;
  datosSensibles: boolean;
  transferenciaInternacional: boolean;
};

export type ResultadoExtraccion = {
  ok: boolean;
  error?: string;
  actividades: ActividadPropuesta[];
  /** El modelo se quedó sin espacio: lo que viene es parte de la respuesta, no toda. */
  parcial?: boolean;
  /**
   * Archivos que se eligieron para analizar y no aportaron nada.
   *
   * Antes se descartaban en silencio: el archivo se contaba como leído y nadie sabía que
   * no había entrado. Un Excel corrupto, uno con contraseña o uno al que le cambiaron la
   * extensión a mano se ven idénticos a uno bueno hasta que se intenta abrirlo.
   */
  problemas: { nombre: string; motivo: string }[];
  fuentes: {
    documentos: number;
    comentarios: number;
    fichas: number;
    inventario: number;
    /** Archivos legibles que no alcanzaron a entrar en esta pasada. */
    sinCupo: number;
  };
};

/** Lo que se le manda al modelo, con su procedencia, para poder citarlo después. */
type Fuente = { etiqueta: string; texto: string };

async function comentariosDelDiagnostico(diagnosticoId: string): Promise<Fuente[]> {
  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    orderBy: { dominio: { orden: "asc" } },
    select: {
      dominio: { select: { orden: true, nombre: true } },
      respuestas: {
        orderBy: { pregunta: { orden: "asc" } },
        select: {
          pregunta: { select: { orden: true, texto: true } },
          aportes: {
            select: { comentario: true, user: { select: { nombre: true, cargo: true } } },
          },
        },
      },
    },
  });

  const fuentes: Fuente[] = [];
  for (const dd of dds) {
    for (const r of dd.respuestas) {
      for (const a of r.aportes) {
        if (!a.comentario?.trim()) continue;
        fuentes.push({
          // El dominio va en la etiqueta porque le dice al modelo qué está leyendo: lo
          // dicho en "Gestión de Terceros" habla de encargados, y lo de "Retención", de
          // plazos. Sin eso, todo se lee como si fuera del mismo tema.
          etiqueta: `Dominio ${dd.dominio.orden} (${dd.dominio.nombre}) · ${a.user.nombre}${a.user.cargo ? ` — ${a.user.cargo}` : ""}`,
          texto: `Pregunta: ${r.pregunta.texto}\nRespondió: ${a.comentario.trim()}`,
        });
      }
    }
  }
  return fuentes;
}

/**
 * Fichas de proceso levantadas por el equipo consultor.
 *
 * Son la mejor fuente de las tres. Una evidencia prueba un control y un comentario cuenta
 * una impresión, pero una ficha describe el proceso: qué se hace, con qué datos, quién
 * los toca y a dónde van. Es literalmente la materia prima de una actividad de
 * tratamiento, y por eso entra primero.
 */
async function fichasDeLaEmpresa(empresaId: string) {
  return prisma.fichaProceso.findMany({
    where: { empresaId, archivoPath: { not: null } },
    select: {
      nombre: true,
      descripcion: true,
      archivoPath: true,
      mimeType: true,
      tamano: true,
      area: { select: { nombre: true } },
    },
    orderBy: { tamano: "asc" },
    take: MAX_CANDIDATOS,
  });
}

async function documentosDelDiagnostico(diagnosticoId: string) {
  return prisma.evidencia.findMany({
    where: {
      archivoPath: { not: null },
      respuesta: { diagnosticoDominio: { diagnosticoId } },
    },
    select: { nombre: true, archivoPath: true, mimeType: true, tamano: true },
    // Los más livianos primero: caben más antes de topar el límite, y un PDF corto suele
    // ser una política concreta y no un manual entero.
    orderBy: { tamano: "asc" },
    take: MAX_CANDIDATOS,
  });
}

/**
 * El vocabulario propio de la empresa: su inventario de datos y su mapa de procesos.
 *
 * Sin esto el modelo escribe "datos de contacto del cliente" y "proceso comercial", que
 * no se cruzan con nada. Con esto escribe "DP-007, DP-008" y "N-5.5 Gestión de Leads", y
 * el RAT queda pegado al inventario que el cliente ya mantiene. Es la diferencia entre un
 * registro que se lee y uno que se puede auditar.
 */
async function vocabularioDeLaEmpresa(empresaId: string) {
  const [inventario, procesos] = await Promise.all([
    prisma.datoInventario.findMany({
      where: { empresaId },
      select: { codigo: true, nombre: true, categoria: true, clasificacion: true },
      orderBy: { codigo: "asc" },
      take: 400,
    }),
    prisma.procesoNegocio.findMany({
      where: { empresaId },
      select: { codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
      take: 400,
    }),
  ]);
  return { inventario, procesos };
}

/**
 * Lo que ya está en el registro, para no volver a proponerlo.
 *
 * Sin esta lista, cada pasada vuelve a leer TODAS las fichas —también las cinco que ya se
 * analizaron la semana pasada— y propone de nuevo las mismas actividades. Quien sube dos
 * fichas nuevas y aprieta analizar termina con el registro duplicado, y las copias no son
 * idénticas: el modelo llama "Cuentas por Pagar" a lo que antes llamó "Recepción y
 * validación de documentos de cobro", así que ni siquiera se ven como repetidas.
 *
 * Va la finalidad además del nombre porque es lo que permite reconocer la misma actividad
 * bajo otro título.
 */
async function yaRegistradas(empresaId: string) {
  return prisma.tratamientoDato.findMany({
    where: { empresaId },
    select: { codigo: true, nombre: true, finalidad: true },
    orderBy: [{ codigo: "asc" }, { nombre: "asc" }],
    take: 200,
  });
}

/** Las filas del registro que todavía tienen huecos, con el detalle de cuáles. */
async function filasPorCompletar(empresaId: string) {
  const filas = await prisma.tratamientoDato.findMany({
    where: { empresaId },
    select: {
      codigo: true,
      nombre: true,
      areaPropuesta: true,
      finalidad: true,
      area: { select: { nombre: true } },
      ...(Object.fromEntries(CAMPOS_ANALIZABLES.map((c) => [c.clave, true])) as Record<
        string,
        true
      >),
    },
    orderBy: [{ codigo: "asc" }, { nombre: "asc" }],
    take: 60,
  });

  return filas
    .map((f) => {
      const registro = f as unknown as Record<string, unknown>;
      const faltan = CAMPOS_ANALIZABLES.filter((c) => {
        const v = registro[c.clave];
        return !(typeof v === "string" && v.trim());
      });
      return { ...f, faltan };
    })
    .filter((f) => f.faltan.length > 0);
}

/** El glosario que le dice al modelo qué se espera en cada campo. */
const GLOSARIO = CAMPOS_ANALIZABLES.map((c) => `- ${c.clave} (${c.etiqueta}): ${c.ayuda}`).join("\n");

/** La forma exacta del JSON, generada de la lista de campos para que no se desincronicen. */
const FORMA_JSON = `{"actividades":[{"nombre":"...","area":"... o null","datosSensibles":false,"transferenciaInternacional":false,${CAMPOS_ANALIZABLES.map(
  (c) => `"${c.clave}":{"valor":"...","cita":"..."}`
).join(",")}}]}`;

const REGLAS = `REGLAS QUE NO PUEDES ROMPER:

1. NO INVENTES. Solo puedes afirmar lo que el material dice. Si la finalidad, la base de licitud o el plazo de conservación no aparecen, OMITE ese campo. Un campo omitido es correcto; un campo inventado hace que un registro legal diga algo falso.
2. CITA SIEMPRE. Cada campo que propongas debe venir con la frase textual del material de donde lo sacaste, en "cita". Si no puedes citar, no lo propongas.
3. NO DEDUZCAS LA BASE DE LICITUD. Solo se propone si el material la menciona explícitamente (un contrato, un consentimiento firmado, una obligación legal). Deducirla del contexto es una opinión jurídica y no te corresponde.
4. USA EL VOCABULARIO DE LA EMPRESA. En "idsInventario" solo pueden ir códigos del inventario entregado, y en "procesos" solo procesos de su mapa. Si un dato o un proceso no está en esas listas, no lo cites: escríbelo en "datosInvolucrados" con su nombre común.
5. Si el material dice que algo NO existe o NO está controlado, eso NO es una actividad de tratamiento: es una brecha. No la registres como actividad.

Campos que puedes proponer:
${GLOSARIO}

Devuelve SOLO un JSON válido con esta forma, sin texto alrededor ni markdown:

${FORMA_JSON}

Omite por completo las claves de los campos que no puedas sustentar. "datosSensibles" y "transferenciaInternacional" son obligatorias: ponlas en false salvo que el material diga lo contrario.`;

const COMUN = `Eres un consultor experto en la Ley 21.719 de protección de datos de Chile, ayudando a construir el Registro de Actividades de Tratamiento (RAT) de una empresa.

Una actividad de tratamiento es una operación concreta con datos personales: "reclutamiento y selección", "ficha de cliente en el CRM", "pago de remuneraciones". No es un sistema ni un área.

El material viene de un cuestionario de 10 dominios y cada respuesta trae anotado de cuál. Úsalo: el dominio 2 habla del inventario de tratamientos, el 3 de bases legales y consentimiento, el 5 de medidas de seguridad, el 7 de encargados y terceros, el 9 de plazos de conservación. Cruza lo dicho en dominios distintos cuando se refiera a la misma actividad —la finalidad puede venir del dominio 2 y su plazo de conservación del 9— y cita siempre la frase del dominio de donde sacaste cada campo.

Cuando haya fichas de proceso levantadas por el equipo consultor, son la fuente más fiable: describen cómo opera el proceso de verdad. Un comentario del cuestionario es una impresión de una persona; una ficha es trabajo de campo. Si se contradicen, quédate con la ficha y dilo en la cita.`;

function instrucciones(modo: ModoAnalisis): string {
  if (modo === "completar") {
    return `${COMUN}

Tu tarea AHORA NO es proponer actividades nuevas. El registro ya existe: se te entrega la lista de sus filas con los campos que a cada una le faltan.

Para cada fila, busca en el material SOLO los campos marcados como faltantes y propónlos. Devuelve el "codigo" de la fila tal cual viene y su "nombre" tal cual viene: es lo que permite escribir la propuesta en la fila correcta.

Si de una fila no encuentras nada sustentable, no la incluyas en la respuesta. Es un resultado válido y esperable: significa que ese campo todavía no está declarado en ninguna parte, y por eso hay que preguntarlo.

${REGLAS}`;
  }

  return `${COMUN}

Tu tarea: leer el material entregado por la empresa y proponer las ACTIVIDADES DE TRATAMIENTO que se desprenden de él.

Si se te entrega una lista de actividades ya registradas, NO propongas ninguna que ya esté ahí, ni con otro nombre ni partida en dos. El material se relee entero cada vez —incluidas las fichas de siempre— y repetir lo que ya existe llena el registro de copias que despues hay que borrar a mano. Ante la duda de si una actividad es la misma, omitela.

${REGLAS}`;
}

function limpiarJson(texto: string): string {
  // El modelo a veces envuelve el JSON en un bloque de código pese a pedírselo.
  const sinCerca = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const ini = sinCerca.indexOf("{");
  const fin = sinCerca.lastIndexOf("}");
  return ini >= 0 && fin > ini ? sinCerca.slice(ini, fin + 1) : sinCerca;
}

/**
 * Saca del texto todos los objetos completos del arreglo de actividades.
 *
 * Recorre carácter a carácter llevando la cuenta de llaves y sabiendo cuándo está dentro
 * de una cadena, y devuelve cada objeto que alcanzó a cerrar. Sirve igual con la
 * respuesta entera y con una cortada a la mitad.
 *
 * El rescate anterior buscaba el texto "},{" para cortar por ahí. Eso solo existe en un
 * JSON minificado, y el modelo responde indentado: la separación real es "},
    {". El
 * resultado era que el rescate NUNCA funcionaba, y una respuesta cortada —que pasa apenas
 * hay tres o cuatro fichas cargadas— se perdía entera y aparecía en pantalla como
 * "respuesta que no se pudo leer".
 */
function objetosDelArreglo(json: string): unknown[] {
  const clave = json.indexOf('"actividades"');
  const inicio = json.indexOf("[", clave >= 0 ? clave : 0);
  if (inicio < 0) return [];

  const objetos: unknown[] = [];
  let profundidad = 0;
  let desde = -1;
  let enCadena = false;
  let escapado = false;

  for (let i = inicio + 1; i < json.length; i++) {
    const c = json[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === "\\") escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === "{") {
      if (profundidad === 0) desde = i;
      profundidad++;
    } else if (c === "}") {
      profundidad--;
      if (profundidad === 0 && desde >= 0) {
        try {
          objetos.push(JSON.parse(json.slice(desde, i + 1)));
        } catch {
          // Un objeto suelto que no parsea se descarta; los demás siguen sirviendo.
        }
        desde = -1;
      }
    } else if (c === "]" && profundidad === 0) break;
  }
  return objetos;
}

/**
 * Interpreta la respuesta aunque venga imperfecta.
 *
 * `completa` distingue dos cosas que antes se confundían: que el modelo respondiera bien
 * y no encontrara nada —resultado legítimo, y frecuente cuando el material describe
 * carencias en vez de tratamientos— de que la respuesta llegara rota. La primera merece
 * un "no encontró actividades"; la segunda, un aviso de que algo falló.
 */
function interpretar(texto: string): { actividades: ActividadPropuesta[]; completa: boolean } {
  const limpio = limpiarJson(texto);
  try {
    const datos = JSON.parse(limpio) as { actividades?: ActividadPropuesta[] };
    return { actividades: datos.actividades ?? [], completa: true };
  } catch {
    return {
      actividades: objetosDelArreglo(limpio) as ActividadPropuesta[],
      completa: false,
    };
  }
}

/**
 * Analiza el material del cliente y propone campos del RAT.
 *
 * Sale información de la empresa hacia el proveedor del modelo. La decisión de habilitarlo
 * es contractual y la toma Procesos360 con su cliente; aquí solo se ejecuta.
 */
export async function proponerActividades(
  diagnosticoId: string,
  modo: ModoAnalisis = "nuevas"
): Promise<ResultadoExtraccion> {
  const vacio = {
    actividades: [],
    problemas: [],
    fuentes: { documentos: 0, comentarios: 0, fichas: 0, inventario: 0, sinCupo: 0 },
  };
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, error: "El análisis no está configurado en el servidor.", ...vacio };
  }

  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { empresaId: true },
  });
  if (!diag) return { ok: false, error: "Diagnóstico no encontrado.", ...vacio };

  const [comentarios, documentos, fichas, vocabulario, porCompletar, registradas] =
    await Promise.all([
      comentariosDelDiagnostico(diagnosticoId),
      documentosDelDiagnostico(diagnosticoId),
      fichasDeLaEmpresa(diag.empresaId),
      vocabularioDeLaEmpresa(diag.empresaId),
      modo === "completar" ? filasPorCompletar(diag.empresaId) : Promise.resolve([]),
      modo === "nuevas" ? yaRegistradas(diag.empresaId) : Promise.resolve([]),
    ]);

  if (modo === "completar" && porCompletar.length === 0) {
    return {
      ok: false,
      error: "No hay filas con campos pendientes: el registro ya tiene todo lo que el análisis podría completar.",
      ...vacio,
    };
  }

  // PDF e imágenes viajan tal cual; Word y Excel se convierten a texto antes de salir.
  const seLee = (m: string | null, tam: number | null) =>
    analisisLoLee(m) && (tam ?? 0) <= MAX_MB_POR_DOCUMENTO * 1024 * 1024;

  /**
   * Convierte un archivo en las partes que entiende el modelo.
   *
   * Un Office se manda como texto extraído en el servidor; un PDF o una imagen, como
   * archivo, porque ahí el modelo lee mejor que cualquier extractor —incluidos los
   * escaneados, que no tienen texto que sacar—.
   */
  let presupuesto = PRESUPUESTO_TEXTO;
  const problemas: { nombre: string; motivo: string }[] = [];

  async function comoPartes(
    nombre: string,
    encabezado: string,
    ruta: string,
    mimeType: string | null
  ): Promise<Record<string, unknown>[]> {
    const url = await urlFirmadaEvidencia(ruta, 300);
    const res = await fetch(url);
    if (!res.ok) {
      problemas.push({ nombre, motivo: "no se pudo descargar el archivo" });
      return [];
    }
    const buf = Buffer.from(await res.arrayBuffer());

    if (esOfficeLegible(mimeType)) {
      // Lo que consume un documento se lo quita al siguiente: así cuatro fichas grandes
      // no hacen una consulta desmedida, y la primera no se lleva todo el presupuesto.
      const ex = await extraerTexto(buf, mimeType, Math.max(4_000, presupuesto));
      if (!ex.ok) {
        problemas.push({ nombre, motivo: ex.motivo });
        return [];
      }
      presupuesto = Math.max(0, presupuesto - ex.texto.length);
      return [
        {
          text:
            `${encabezado}\n${ex.texto}` +
            (ex.truncado ? "\n[…documento recortado por extensión]" : ""),
        },
      ];
    }
    return [
      { text: encabezado },
      { inlineData: { mimeType: mimeType ?? "application/pdf", data: buf.toString("base64") } },
    ];
  }

  /**
   * Reparte los cupos recorriendo la lista en orden de prioridad.
   *
   * Las fichas van antes que las evidencias porque describen el proceso, que es lo que se
   * está buscando; una evidencia prueba un control. Lo que no alcanza a entrar se cuenta,
   * para poder decirlo: quedarse callado hace que quien subió seis fichas y ve cuatro
   * leídas piense que la plataforma perdió dos.
   */
  function repartirCupo<T extends { mimeType: string | null; tamano: number | null }>(
    candidatos: T[],
    cupos: { oficina: number; binarios: number }
  ): T[] {
    const elegidos: T[] = [];
    for (const c of candidatos) {
      if (!seLee(c.mimeType, c.tamano)) continue;
      const clave = esOfficeLegible(c.mimeType) ? "oficina" : "binarios";
      if (cupos[clave] <= 0) continue;
      cupos[clave]--;
      elegidos.push(c);
    }
    return elegidos;
  }

  const cupos = { oficina: MAX_OFICINA, binarios: MAX_BINARIOS };
  const fichasLegibles = repartirCupo(fichas, cupos);
  const legibles = repartirCupo(documentos, cupos);
  const sinCupo =
    [...fichas, ...documentos].filter((x) => seLee(x.mimeType, x.tamano)).length -
    fichasLegibles.length -
    legibles.length;

  if (comentarios.length === 0 && legibles.length === 0 && fichasLegibles.length === 0) {
    return {
      ok: false,
      error:
        "No hay material que analizar: ni documentos legibles (PDF, imagen, Word o Excel) ni comentarios en las respuestas del levantamiento.",
      ...vacio,
    };
  }

  const partes: Record<string, unknown>[] = [];

  if (vocabulario.inventario.length > 0 || vocabulario.procesos.length > 0) {
    const bloques: string[] = [];
    if (vocabulario.inventario.length > 0) {
      bloques.push(
        "Inventario de datos personales de la empresa (código | dato | categoría | clasificación):\n" +
          vocabulario.inventario
            .map((d) => `${d.codigo} | ${d.nombre} | ${d.categoria ?? ""} | ${d.clasificacion ?? ""}`)
            .join("\n")
      );
    }
    if (vocabulario.procesos.length > 0) {
      bloques.push(
        "Mapa de procesos de la empresa (código | proceso):\n" +
          vocabulario.procesos.map((p) => `${p.codigo} | ${p.nombre}`).join("\n")
      );
    }
    partes.push({
      text:
        "MATERIAL 0 — VOCABULARIO DE LA EMPRESA. Estos códigos ya existen y son los únicos que puedes citar en \"idsInventario\" y \"procesos\".\n\n" +
        bloques.join("\n\n"),
    });
  }

  if (modo === "nuevas" && registradas.length > 0) {
    partes.push({
      text:
        "MATERIAL 0B — ACTIVIDADES QUE YA ESTÁN EN EL REGISTRO. NO las vuelvas a proponer, " +
        "ni con otro nombre. Si el material que leas se refiere a una de estas, omítela: " +
        "completar sus campos es otra tarea.\n\n" +
        registradas
          .map(
            (r) =>
              `[${r.codigo ?? "sin código"}] ${r.nombre}` +
              (r.finalidad ? `\n  Finalidad: ${r.finalidad.slice(0, 200)}` : "")
          )
          .join("\n"),
    });
  }

  if (modo === "completar") {
    partes.push({
      text:
        "MATERIAL 0B — FILAS DEL REGISTRO QUE HAY QUE COMPLETAR. Para cada una, busca en el material solo los campos listados como faltantes.\n\n" +
        porCompletar
          .map((f) => {
            const area = f.areaPropuesta ?? f.area?.nombre ?? "sin área";
            const contexto = f.finalidad ? `\n  Finalidad ya registrada: ${f.finalidad}` : "";
            return `[${f.codigo ?? "sin código"}] ${f.nombre} — área: ${area}${contexto}\n  Le faltan: ${f.faltan
              .map((c) => c.clave)
              .join(", ")}`;
          })
          .join("\n\n"),
    });
  }

  if (comentarios.length > 0) {
    partes.push({
      text:
        "MATERIAL 1 — Lo que los participantes escribieron al responder el cuestionario de los 10 dominios:\n\n" +
        comentarios.map((f) => `[${f.etiqueta}]\n${f.texto}`).join("\n\n"),
    });
  }

  for (const f of fichasLegibles) {
    try {
      const encabezado =
        `MATERIAL 2 — Ficha de proceso levantada por el equipo consultor: "${f.nombre}"` +
        (f.area ? ` · área ${f.area.nombre}` : "") +
        (f.descripcion ? `\n${f.descripcion}` : "");
      partes.push(...(await comoPartes(f.nombre, encabezado, f.archivoPath!, f.mimeType)));
    } catch (e) {
      // Una ficha ilegible no detiene el análisis del resto, pero sí se dice cuál fue.
      problemas.push({ nombre: f.nombre, motivo: (e as Error).message.slice(0, 90) });
    }
  }

  for (const d of legibles) {
    try {
      partes.push(
        ...(await comoPartes(
          d.nombre,
          `MATERIAL 3 — Documento entregado por la empresa: "${d.nombre}"`,
          d.archivoPath!,
          d.mimeType
        ))
      );
    } catch (e) {
      // Un documento que no se puede leer no detiene el análisis del resto.
      problemas.push({ nombre: d.nombre, motivo: (e as Error).message.slice(0, 90) });
    }
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instrucciones(modo) }] },
          contents: [{ role: "user", parts: partes }],
          generationConfig: {
            // Temperatura baja: aquí no se quiere creatividad, se quiere fidelidad.
            temperature: 0.1,
            // El razonamiento interno del modelo se descuenta de este mismo presupuesto:
            // con el material de los diez dominios se lo comía entero y el JSON llegaba
            // cortado a la mitad. Se apaga y se sube el techo.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 32768,
            responseMimeType: "application/json",
          },
        }),
      }
    );
  } catch {
    return { ok: false, error: "No se pudo contactar el servicio de análisis.", ...vacio };
  }

  if (!respuesta.ok) {
    const detalle = respuesta.status === 429 ? "demasiadas consultas seguidas" : `error ${respuesta.status}`;
    return { ok: false, error: `El análisis no respondió (${detalle}).`, ...vacio };
  }

  const cuerpo = await respuesta.json().catch(() => null);
  const candidato = cuerpo?.candidates?.[0];
  const motivoCorte: string = candidato?.finishReason ?? "";
  const texto: string =
    candidato?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

  if (!texto.trim()) {
    // El proveedor puede devolver una respuesta vacía por filtro de contenido. Decirlo
    // importa: no es lo mismo que el material no dé para nada.
    const bloqueado =
      motivoCorte === "SAFETY" ||
      motivoCorte === "PROHIBITED_CONTENT" ||
      Boolean(cuerpo?.promptFeedback?.blockReason);
    console.error(`[rat] respuesta vacía · finishReason=${motivoCorte || "sin dato"}`);
    return {
      ok: false,
      error: bloqueado
        ? "El servicio de análisis rechazó el material por sus filtros de contenido."
        : "El análisis no devolvió resultados.",
      ...vacio,
    };
  }

  const seQuedoSinEspacio = motivoCorte === "MAX_TOKENS";
  const { actividades: crudas, completa } = interpretar(texto);

  if (crudas.length === 0) {
    if (completa) {
      // Respondió bien y no encontró nada. Es un resultado válido, no una falla: quien
      // llama lo explica con sus palabras.
      return { ok: true, actividades: [], problemas, fuentes: fuentesLeidas() };
    }
    console.error(
      `[rat] no se pudo interpretar · finishReason=${motivoCorte} · ${texto.length} caracteres · inicio: ${texto.slice(0, 200)}`
    );
    return {
      ok: false,
      error: seQuedoSinEspacio
        ? "El análisis se quedó sin espacio antes de terminar de responder y no alcanzó a completar ni una actividad. Suele pasar con muchas fichas cargadas a la vez: prueba dejando menos."
        : "El análisis devolvió una respuesta que no se pudo leer.",
      ...vacio,
    };
  }

  if (seQuedoSinEspacio) {
    console.error(`[rat] respuesta cortada · se rescataron ${crudas.length} actividades`);
  }

  const codigosValidos = new Set(vocabulario.inventario.map((d) => d.codigo));
  const actividades = crudas
    // Sin nombre no es una actividad, y sin cita no es verificable: ambas se descartan.
    .filter((a) => a?.nombre?.trim())
    .map((a) => ({
      ...a,
      nombre: a.nombre.trim(),
      datosSensibles: Boolean(a.datosSensibles),
      transferenciaInternacional: Boolean(a.transferenciaInternacional),
      ...(a.idsInventario ? { idsInventario: depurarCodigos(a.idsInventario, codigosValidos) } : {}),
    }))
    // Un idsInventario que quedó sin ningún código válido se elimina, en vez de escribir
    // una celda vacía que igual pisaría el hueco.
    .map((a) => (a.idsInventario && !a.idsInventario.valor ? { ...a, idsInventario: undefined } : a));

  if (problemas.length > 0) {
    console.error(`[rat] no aportaron: ${problemas.map((p) => `${p.nombre} (${p.motivo})`).join(" · ")}`);
  }

  return {
    ok: true,
    actividades,
    parcial: seQuedoSinEspacio,
    problemas,
    fuentes: fuentesLeidas(),
  };

  function fuentesLeidas() {
    return {
      documentos: legibles.length,
      comentarios: comentarios.length,
      fichas: fichasLegibles.length,
      inventario: vocabulario.inventario.length,
      sinCupo,
    };
  }
}

/**
 * Deja solo los códigos del inventario que existen de verdad.
 *
 * La instrucción de no inventar códigos no basta: un modelo que ve DP-007 y DP-008 propone
 * DP-009 con toda naturalidad. Un código inventado es peor que ninguno, porque parece
 * trazabilidad y apunta a nada.
 */
function depurarCodigos(campo: CampoPropuesto, validos: Set<string>): CampoPropuesto {
  const codigos = (campo.valor.match(/[A-Z]{2,4}-\d+/gi) ?? [])
    .map((c) => c.toUpperCase())
    .filter((c) => validos.has(c));
  return { ...campo, valor: [...new Set(codigos)].join(", ") };
}
