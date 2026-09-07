// Carga en la plataforma una matriz RAT hecha fuera: el registro, el inventario de datos
// personales y el mapa de procesos.
//
// Existe porque el trabajo no empieza en cero. Un cliente que ya levantó su inventario de
// datos y cruzó sus procesos tiene la mitad del RAT hecha en una planilla; pedirle que la
// vuelva a escribir en la plataforma sería, además de absurdo, la forma más segura de que
// la plataforma nunca se use.
//
// Dos decisiones que gobiernan la carga:
//
//   1. **Los "Por validar en workshop" NO se guardan.** Una matriz recién armada trae esa
//      frase en veinte de sus treinta columnas. Guardarla como texto haría que la fila
//      contara como completa y el registro dijera estar terminado cuando está en blanco.
//      El hueco entra como hueco; la frase se vuelve a escribir sola al exportar.
//   2. **Por defecto solo rellena.** Reimportar una matriz corregida no debe pisar lo que
//      se trabajó dentro de la plataforma. Para eso está --sobrescribir, explícito.
//
// Uso:
//   npx tsx prisma/importar-matriz-rat.ts --empresa 76.123.456-7 --archivo "Matriz.xlsx"
//   ...--aplicar          escribe (sin esto solo muestra lo que haría)
//   ...--sobrescribir     además pisa los campos que ya tienen contenido
//   ...--uat              contra la base de pruebas

import { readFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const opcion = (nombre: string): string | undefined => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const bandera = (nombre: string) => args.includes(`--${nombre}`);

const usarUat = bandera("uat");
for (const line of readFileSync(join(__dirname, "..", usarUat ? ".env.uat" : ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

import { PrismaClient, type Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();

// ───────────────────────────── Lectura de celdas ─────────────────────────────

/** El texto de una celda, sea texto plano, fórmula o texto con formato. */
function texto(celda: ExcelJS.Cell | undefined): string {
  const v = celda?.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join("");
    }
    if (typeof o.text === "string") return o.text;
    if ("result" in o) return String(o.result ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}

/** Sin tildes, en minúsculas y con los espacios colapsados: para comparar encabezados. */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Frases que ocupan una celda sin decir nada.
 *
 * Son el relleno con que se arma una matriz antes del workshop. Entran como vacío: el
 * valor de la plataforma está justamente en distinguir lo que se sabe de lo que falta, y
 * guardar el relleno borra esa distinción.
 */
const RELLENO = [
  /^por validar/i,
  /^por definir/i,
  /^por confirmar/i,
  /^pendiente$/i,
  /^n\/?a$/i,
  /^aplicar medidas tecnicas y organizativas segun riesgo/i,
];

function valor(celda: ExcelJS.Cell | undefined): string | null {
  const t = texto(celda).trim();
  if (!t) return null;
  const plano = normalizar(t);
  return RELLENO.some((r) => r.test(plano)) ? null : t;
}

const esSi = (s: string | null) => Boolean(s && /^s[ií]/i.test(normalizar(s)));

// ───────────────────────── Mapeo de columnas por encabezado ─────────────────────────

/**
 * Se busca por nombre de columna y no por posición: la matriz la editan personas, y una
 * columna insertada a mano no puede hacer que el RUT se cargue en el campo del plazo de
 * conservación.
 *
 * El orden importa: gana la primera regla que calce, así que las más específicas van
 * antes —"categorías de datos" tiene que perder contra "datos personales involucrados"—.
 */
const REGLAS: [RegExp, string][] = [
  [/ids? inventario|id.* inventario/, "idsInventario"],
  [/datos personales involucrados/, "datosInvolucrados"],
  [/clasificacion del dato/, "clasificacionDato"],
  [/incluye datos sensibles|datos sensibles/, "datosSensibles"],
  [/categorias de titulares|titulares/, "categoriasTitulares"],
  [/categorias de datos/, "categoriasDatos"],
  [/actividad de tratamiento/, "nombre"],
  [/proceso/, "procesos"],
  [/area responsable/, "areaPropuesta"],
  [/dueno|key user|\bku\b/, "duenoProceso"],
  [/finalidad/, "finalidad"],
  [/origen|fuente de los datos/, "origen"],
  [/base de licitud|base legal/, "baseLegal"],
  [/sistemas|repositorios/, "sistemas"],
  [/encargados|proveedores/, "encargados"],
  [/destinatarios|cesiones/, "destinatarios"],
  [/transferencia internacional/, "transferenciaInternacional"],
  [/garantia/, "garantiasTransferencia"],
  [/pais|destino/, "paisesDestino"],
  [/plazo de conservacion/, "plazoConservacion"],
  [/criterio de eliminacion|anonimizacion/, "criterioEliminacion"],
  [/decisiones automatizadas|perfilamiento/, "decisionesAutomatizadas"],
  [/medidas de seguridad|controles/, "medidasSeguridad"],
  [/evaluar eipd|eipd/, "evaluarEipd"],
  [/riesgo preliminar|riesgo/, "riesgoPreliminar"],
  [/evidencias a solicitar|evidencias/, "evidenciasSolicitar"],
  [/estado de validacion|estado/, "estado"],
  [/fuente de diseno/, "fuenteDiseno"],
  [/observaciones/, "observaciones"],
];

function mapearColumnas(fila: ExcelJS.Row, total: number): Map<string, number> {
  const mapa = new Map<string, number>();
  for (let c = 1; c <= total; c++) {
    const encabezado = normalizar(texto(fila.getCell(c)));
    if (!encabezado) continue;
    const regla = REGLAS.find(([r]) => r.test(encabezado));
    if (regla && !mapa.has(regla[1])) mapa.set(regla[1], c);
  }
  return mapa;
}

/** El estado que trae la matriz, traducido al vocabulario del registro. */
function estadoDe(bruto: string | null): string {
  const s = normalizar(bruto ?? "");
  if (/ajuste/.test(s)) return "REQUIERE_AJUSTE";
  if (/levantamiento/.test(s)) return "EN_LEVANTAMIENTO";
  if (/pendiente|por validar/.test(s)) return "EN_REVISION";
  if (/validad/.test(s)) return "VIGENTE";
  return "BORRADOR";
}

/**
 * Saca los procesos de una celda como "N-5.5 Gestión de Leads / S-4.4 Soporte".
 *
 * Se corta solo donde empieza otro código, y no en cada barra: hay procesos que la llevan
 * en el nombre, y partirlos ahí produciría un mapa con procesos que no existen.
 */
function procesosDe(texto: string | null): { codigo: string; nombre: string }[] {
  if (!texto) return [];
  return texto
    .split(/\s*\/\s*(?=[A-Za-z]{1,2}-\d)/)
    .map((p) => p.trim().match(/^([A-Za-z]{1,2}-\d+(?:\.\d+)*)\s+(.+)$/))
    .filter(Boolean)
    .map((m) => ({ codigo: m![1].toUpperCase(), nombre: m![2].trim() }));
}

// ───────────────────────────────── Carga ─────────────────────────────────

async function main() {
  const rutEmpresa = opcion("empresa");
  const archivo = opcion("archivo");
  const aplicar = bandera("aplicar");
  const sobrescribir = bandera("sobrescribir");

  if (!rutEmpresa || !archivo) {
    console.error("Faltan argumentos: --empresa <rut o razón social> --archivo <ruta.xlsx>");
    process.exit(1);
  }

  const empresa = await prisma.empresa.findFirst({
    where: {
      OR: [
        { rut: rutEmpresa },
        { razonSocial: { contains: rutEmpresa, mode: "insensitive" } },
      ],
    },
    select: { id: true, razonSocial: true, rut: true },
  });
  if (!empresa) {
    console.error(`No se encontró la empresa "${rutEmpresa}".`);
    process.exit(1);
  }

  console.log(`Base:    ${usarUat ? "UAT (.env.uat)" : "PRODUCCIÓN (.env)"}`);
  console.log(`Empresa: ${empresa.razonSocial} (${empresa.rut})`);
  console.log(`Archivo: ${archivo}\n`);

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(archivo);
  console.log(`Hojas: ${libro.worksheets.map((h) => h.name).join(", ")}\n`);

  const hojaRat = libro.worksheets.find((h) => /^rat/i.test(normalizar(h.name)));
  const hojaInv = libro.worksheets.find((h) => /inventario/i.test(normalizar(h.name)));

  const areas = await prisma.area.findMany({
    where: { empresaId: empresa.id },
    select: { id: true, nombre: true },
  });
  const areaPorNombre = new Map(areas.map((a) => [normalizar(a.nombre), a.id]));

  const procesos = new Map<string, string>();

  // ── El inventario de datos personales ──
  const datos: {
    codigo: string;
    categoria: string | null;
    nombre: string;
    titularPrincipal: string | null;
    areas: string | null;
    clasificacion: string | null;
    procesos: string | null;
  }[] = [];

  if (hojaInv) {
    for (let r = 2; r <= hojaInv.rowCount; r++) {
      const fila = hojaInv.getRow(r);
      const codigo = texto(fila.getCell(1)).trim().toUpperCase();
      const nombre = texto(fila.getCell(3)).trim();
      if (!codigo || !nombre) continue;
      const procesosTexto = valor(fila.getCell(7));
      for (const p of procesosDe(procesosTexto)) procesos.set(p.codigo, p.nombre);
      datos.push({
        codigo,
        categoria: valor(fila.getCell(2)),
        nombre,
        titularPrincipal: valor(fila.getCell(4)),
        areas: valor(fila.getCell(5)),
        clasificacion: valor(fila.getCell(6)),
        procesos: procesosTexto,
      });
    }
    console.log(`Inventario: ${datos.length} datos personales`);
  } else {
    console.log("Inventario: no hay hoja de inventario en el archivo");
  }

  // ── El registro ──
  const filas: {
    codigo: string;
    datos: Record<string, string | boolean | null>;
    areaId: string | null;
  }[] = [];

  if (hojaRat) {
    const col = mapearColumnas(hojaRat.getRow(1), hojaRat.columnCount);
    const noReconocidas = REGLAS.map(([, campo]) => campo).filter((c) => !col.has(c));
    console.log(`Registro:   ${col.size} columnas reconocidas`);
    if (noReconocidas.length > 0) {
      console.log(`            sin columna en el archivo: ${noReconocidas.join(", ")}`);
    }

    const cel = (fila: ExcelJS.Row, campo: string) => {
      const c = col.get(campo);
      return c ? valor(fila.getCell(c)) : null;
    };

    for (let r = 2; r <= hojaRat.rowCount; r++) {
      const fila = hojaRat.getRow(r);
      const codigo = texto(fila.getCell(1)).trim().toUpperCase();
      const nombre = cel(fila, "nombre");
      if (!codigo || !nombre) continue;

      const procesosTexto = cel(fila, "procesos");
      for (const p of procesosDe(procesosTexto)) procesos.set(p.codigo, p.nombre);

      const areaTexto = cel(fila, "areaPropuesta");
      // El área propuesta suele venir como "Comercial / Marketing": se intenta enganchar
      // con la primera, que es la que responde, y si no calza queda solo el texto.
      const primeraArea = areaTexto ? normalizar(areaTexto.split("/")[0]) : "";

      filas.push({
        codigo,
        areaId: areaPorNombre.get(primeraArea) ?? null,
        datos: {
          nombre,
          procesos: procesosTexto,
          areaPropuesta: areaTexto,
          duenoProceso: cel(fila, "duenoProceso"),
          finalidad: cel(fila, "finalidad"),
          categoriasTitulares: cel(fila, "categoriasTitulares"),
          categoriasDatos: cel(fila, "categoriasDatos"),
          idsInventario: cel(fila, "idsInventario"),
          datosInvolucrados: cel(fila, "datosInvolucrados"),
          clasificacionDato: cel(fila, "clasificacionDato"),
          datosSensibles: esSi(cel(fila, "datosSensibles")),
          origen: cel(fila, "origen"),
          baseLegal: cel(fila, "baseLegal"),
          sistemas: cel(fila, "sistemas"),
          encargados: cel(fila, "encargados"),
          destinatarios: cel(fila, "destinatarios"),
          transferenciaInternacional: esSi(cel(fila, "transferenciaInternacional")),
          paisesDestino: cel(fila, "paisesDestino"),
          garantiasTransferencia: cel(fila, "garantiasTransferencia"),
          plazoConservacion: cel(fila, "plazoConservacion"),
          criterioEliminacion: cel(fila, "criterioEliminacion"),
          decisionesAutomatizadas: cel(fila, "decisionesAutomatizadas"),
          medidasSeguridad: cel(fila, "medidasSeguridad"),
          evaluarEipd: cel(fila, "evaluarEipd"),
          riesgoPreliminar: cel(fila, "riesgoPreliminar"),
          evidenciasSolicitar: cel(fila, "evidenciasSolicitar"),
          fuenteDiseno: cel(fila, "fuenteDiseno"),
          observaciones: cel(fila, "observaciones"),
          estado: estadoDe(cel(fila, "estado")),
        },
      });
    }

    const llenas = filas.reduce(
      (n, f) => n + Object.values(f.datos).filter((v) => typeof v === "string" && v).length,
      0
    );
    const totalCeldas = filas.length * 26;
    console.log(
      `            ${filas.length} actividades · ${llenas} de ${totalCeldas} celdas con contenido ` +
        `(${totalCeldas ? Math.round((llenas / totalCeldas) * 100) : 0}%)`
    );
    console.log(
      `            ${filas.filter((f) => f.areaId).length} enganchadas con un área del levantamiento`
    );
  } else {
    console.log("Registro:   no hay hoja de RAT en el archivo");
  }

  console.log(`Procesos:   ${procesos.size} códigos distintos\n`);

  if (!aplicar) {
    console.log("(solo revisión — agrega --aplicar para cargar)");
    if (filas.length > 0) {
      console.log("\nPrimeras filas que se cargarían:");
      for (const f of filas.slice(0, 3)) {
        const vacios = Object.entries(f.datos)
          .filter(([, v]) => v === null)
          .map(([k]) => k);
        console.log(`  ${f.codigo} · ${f.datos.nombre}`);
        console.log(`     quedan vacíos: ${vacios.join(", ") || "ninguno"}`);
      }
    }
    return;
  }

  // ── Escritura ──
  for (const d of datos) {
    const { codigo, ...resto } = d;
    await prisma.datoInventario.upsert({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo } },
      create: { empresaId: empresa.id, codigo, ...resto },
      update: resto,
    });
  }

  for (const [codigo, nombre] of procesos) {
    await prisma.procesoNegocio.upsert({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo } },
      create: { empresaId: empresa.id, codigo, nombre },
      update: { nombre },
    });
  }

  let creadas = 0;
  let actualizadas = 0;
  for (const f of filas) {
    const existente = await prisma.tratamientoDato.findUnique({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo: f.codigo } },
    });

    if (!existente) {
      await prisma.tratamientoDato.create({
        data: {
          empresaId: empresa.id,
          codigo: f.codigo,
          areaId: f.areaId,
          ...f.datos,
        } as unknown as Prisma.TratamientoDatoUncheckedCreateInput,
      });
      creadas++;
      continue;
    }

    // Sin --sobrescribir solo se rellenan huecos: lo que se trabajó dentro de la
    // plataforma vale más que lo que trae el archivo, que puede ser una copia vieja.
    const cambios: Record<string, unknown> = {};
    for (const [clave, nuevo] of Object.entries(f.datos)) {
      if (nuevo === null || nuevo === undefined) continue;
      const previo = (existente as unknown as Record<string, unknown>)[clave];
      const tieneContenido = typeof previo === "string" ? previo.trim() !== "" : previo != null;
      if (tieneContenido && !sobrescribir) continue;
      cambios[clave] = nuevo;
    }
    if (Object.keys(cambios).length > 0) {
      await prisma.tratamientoDato.update({ where: { id: existente.id }, data: cambios });
      actualizadas++;
    }
  }

  console.log(
    `Cargado: ${datos.length} datos de inventario · ${procesos.size} procesos · ` +
      `${creadas} actividades nuevas y ${actualizadas} actualizadas.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
