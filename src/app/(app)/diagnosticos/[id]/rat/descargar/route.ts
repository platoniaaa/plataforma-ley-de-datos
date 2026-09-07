import { prisma } from "@/lib/db";
import { requireSession, sinAccesoAEmpresa } from "@/lib/session";
import { ratDeEmpresa, inventarioDeEmpresa } from "@/lib/data/rat";
import {
  CAMPOS_RAT,
  faltantesDe,
  etiquetaEstado,
  POR_VALIDAR,
  type TratamientoPlano,
} from "@/lib/rat";

// Descarga del RAT como planilla de Excel, en el formato de la matriz que Procesos360 ya
// usa con el cliente: el registro, el diccionario de campos, la guía de validación y el
// inventario de datos personales, cada uno en su hoja.
//
// Es un .xlsx de verdad y no un CSV. La matriz tiene treinta columnas de texto largo, y
// en CSV eso llega sin anchos, sin ajuste de línea y sin filtros: el cliente lo abre, ve
// una pared y concluye que el archivo está malo. Además el CSV no tiene hojas, y el
// diccionario es justamente lo que hace que la matriz se pueda llenar sin nosotros al lado.

// Leer el registro completo y armar las cuatro hojas pasa de los quince segundos por
// defecto cuando el inventario trae varios cientos de filas.
export const maxDuration = 60;

/** Anchos por columna. Sin esto todo sale en 8 caracteres y la matriz es ilegible. */
const ANCHO: Record<string, number> = { corto: 26, largo: 46 };

type Columna = {
  titulo: string;
  ancho: number;
  valor: (t: TratamientoPlano) => string;
};

/**
 * Qué se escribe en una celda que la plataforma tiene vacía.
 *
 * El hueco se guarda vacío y el texto se pone solo al exportar. Si "Por validar" viviera
 * en la base, la fila contaría como completa y el registro diría estar terminado sin
 * estarlo; escrito acá cumple su función —decirle al que recibe la matriz qué falta— sin
 * ensuciar la medición del avance.
 */
const texto = (v: string | null) => (v?.trim() ? v.trim() : POR_VALIDAR);

function columnas(): Columna[] {
  const campo = (clave: string) => CAMPOS_RAT.find((c) => c.clave === clave)!;
  const de = (clave: string, titulo?: string): Columna => {
    const c = campo(clave);
    return {
      titulo: titulo ?? c.etiqueta,
      ancho: ANCHO[c.ancho],
      valor: (t) => texto(t[c.clave] as string | null),
    };
  };

  // El orden es el de la matriz del cliente, para que las dos se puedan poner lado a lado.
  return [
    { titulo: "ID", ancho: 10, valor: (t) => t.codigo ?? "" },
    de("nombre", "Actividad de tratamiento"),
    de("procesos", "Proceso(s) relacionado(s)"),
    {
      titulo: "Área responsable propuesta",
      ancho: 26,
      // El área del levantamiento sirve de respaldo: si nadie escribió la propuesta, al
      // menos se sabe qué área declaró el tratamiento.
      valor: (t) => texto(t.areaPropuesta ?? t.areaNombre),
    },
    de("duenoProceso", "Dueño / Key User"),
    de("finalidad", "Finalidad del tratamiento"),
    de("categoriasTitulares", "Categorías de titulares"),
    de("categoriasDatos", "Categorías de datos"),
    de("idsInventario", "IDs Inventario DP"),
    de("datosInvolucrados", "Datos personales involucrados"),
    de("clasificacionDato", "Clasificación del dato"),
    {
      titulo: "¿Incluye datos sensibles?",
      ancho: 16,
      valor: (t) => (t.datosSensibles ? "Sí" : "No"),
    },
    de("origen", "Origen / Fuente de los datos"),
    de("baseLegal", "Base de licitud propuesta"),
    de("sistemas", "Sistemas / Repositorios"),
    de("encargados", "Encargados / Proveedores"),
    de("destinatarios", "Destinatarios / Cesiones"),
    {
      titulo: "¿Transferencia internacional?",
      ancho: 16,
      valor: (t) => (t.transferenciaInternacional ? "Sí" : "No"),
    },
    // Cuando no hay transferencia, "Por validar" invitaría a llenar algo que no existe.
    {
      titulo: "País / Destino",
      ancho: 26,
      valor: (t) => (t.transferenciaInternacional ? texto(t.paisesDestino) : "No aplica"),
    },
    {
      titulo: "Garantías de la transferencia",
      ancho: 46,
      valor: (t) =>
        t.transferenciaInternacional ? texto(t.garantiasTransferencia) : "No aplica",
    },
    de("plazoConservacion", "Plazo de conservación"),
    de("criterioEliminacion", "Criterio de eliminación / anonimización"),
    de("decisionesAutomatizadas", "Decisiones automatizadas / perfilamiento"),
    de("medidasSeguridad", "Medidas de seguridad / controles"),
    de("evaluarEipd", "¿Evaluar EIPD?"),
    de("riesgoPreliminar", "Riesgo preliminar"),
    de("evidenciasSolicitar", "Evidencias a solicitar"),
    { titulo: "Estado de validación", ancho: 22, valor: (t) => etiquetaEstado(t.estado) },
    de("fuenteDiseno", "Fuente de diseño"),
    de("observaciones", "Observaciones"),
    {
      titulo: "Campos obligatorios pendientes",
      ancho: 40,
      valor: (t) => faltantesDe(t).map((c) => c.etiqueta).join(", "),
    },
  ];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession();

  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    select: { empresaId: true },
  });
  if (!diag) return new Response("No encontrado", { status: 404 });
  if (sinAccesoAEmpresa(session, diag.empresaId)) {
    return new Response("Sin acceso", { status: 403 });
  }

  const [rat, inventario] = await Promise.all([
    ratDeEmpresa(diag.empresaId),
    inventarioDeEmpresa(diag.empresaId),
  ]);
  if (!rat) return new Response("No encontrado", { status: 404 });

  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = "Procesos360";
  libro.created = new Date();

  const preliminar = rat.tratamientos.some(
    (t) => t.estado !== "VIGENTE" || faltantesDe(t).length > 0
  );
  const fecha = new Date().toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Hoja 1: el registro ──
  const cols = columnas();
  const hoja = libro.addWorksheet("RAT", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 3 }],
  });

  // Las dos primeras líneas viajan con el archivo: si alguien lo reenvía suelto, sigue
  // diciendo de quién es, cuándo se sacó y si estaba terminado.
  hoja.mergeCells(1, 1, 1, cols.length);
  const titulo = hoja.getCell(1, 1);
  titulo.value = `${rat.empresa} — Registro de Actividades de Tratamiento (Ley 21.719)`;
  titulo.font = { bold: true, size: 13 };

  hoja.mergeCells(2, 1, 2, cols.length);
  const sub = hoja.getCell(2, 1);
  sub.value =
    `Generado el ${fecha}` +
    (preliminar
      ? " — PRELIMINAR: hay actividades en borrador o con campos sin llenar. Las celdas que dicen “Por validar” son las que faltan."
      : "");
  sub.font = { size: 10, color: { argb: "FF64748B" } };

  const cabecera = hoja.getRow(3);
  cabecera.values = cols.map((c) => c.titulo);
  cabecera.height = 32;
  cabecera.eachCell((celda) => {
    celda.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    celda.alignment = { vertical: "middle", wrapText: true };
  });

  cols.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho;
  });

  for (const t of rat.tratamientos) {
    const fila = hoja.addRow(cols.map((c) => c.valor(t)));
    fila.alignment = { vertical: "top", wrapText: true };
    fila.eachCell((celda) => {
      // Lo que falta se ve de un vistazo: es la razón por la que el cliente abre el archivo.
      if (celda.value === POR_VALIDAR) {
        celda.font = { italic: true, color: { argb: "FFB45309" } };
      }
    });
  }

  if (rat.tratamientos.length > 0) {
    hoja.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3 + rat.tratamientos.length, column: cols.length },
    };
  }

  // ── Hoja 2: el diccionario ──
  // Va dentro del mismo archivo a propósito: la matriz la termina de llenar gente que no
  // estuvo en la reunión donde se explicó cada columna.
  const dicc = libro.addWorksheet("Diccionario", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  dicc.columns = [
    { header: "Campo", key: "campo", width: 34 },
    { header: "Definición — qué debe registrar", key: "def", width: 70 },
    { header: "Criterio de llenado", key: "criterio", width: 62 },
    { header: "¿Obligatorio?", key: "obl", width: 14 },
  ];
  dicc.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  dicc.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  for (const c of CAMPOS_RAT) {
    const fila = dicc.addRow({
      campo: c.etiqueta,
      def: c.ayuda,
      criterio: `Ej.: ${c.ejemplo}`,
      obl: c.obligatorio ? "Sí" : "No",
    });
    fila.alignment = { vertical: "top", wrapText: true };
  }
  dicc.addRow({});
  dicc.addRow({
    campo: "Estado de validación",
    def: "Nivel de avance de la revisión con las áreas y responsables.",
    criterio: "Borrador · En levantamiento · Pendiente de validación · Requiere ajuste · Validado",
    obl: "Sí",
  }).alignment = { vertical: "top", wrapText: true };

  // ── Hoja 3: la guía de validación ──
  // Qué hay que confirmar con el cliente y con qué documento se acredita. Viaja con la
  // matriz porque la validación la hace, en terreno, gente que no escribió el registro:
  // sin esta hoja cada consultor decide por su cuenta qué evidencia es suficiente.
  const guia = libro.addWorksheet("Guía de validación", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  guia.columns = [
    { header: "Campo crítico", key: "campo", width: 34 },
    { header: "Qué validar con el cliente", key: "validar", width: 74 },
    { header: "Evidencia esperada", key: "evidencia", width: 62 },
  ];
  guia.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  guia.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  for (const c of CAMPOS_RAT) {
    if (!c.validar && !c.evidencia) continue;
    guia.addRow({
      campo: c.etiqueta,
      validar: c.validar ?? "",
      evidencia: c.evidencia ?? "",
    }).alignment = { vertical: "top", wrapText: true };
  }
  guia.addRow({
    campo: "Estado de validación",
    validar: "Cerrar cada fila con la aprobación del dueño del proceso.",
    evidencia: "Acta o aprobación registrada.",
  }).alignment = { vertical: "top", wrapText: true };

  // ── Hoja 4: el inventario de datos ──
  // Solo si existe. Una hoja vacía haría creer que el inventario está y no tiene nada.
  if (inventario.length > 0) {
    const inv = libro.addWorksheet("Inventario DP", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    inv.columns = [
      { header: "ID", key: "codigo", width: 10 },
      { header: "Categoría", key: "categoria", width: 18 },
      { header: "Dato personal", key: "nombre", width: 34 },
      { header: "Titular principal", key: "titular", width: 30 },
      { header: "Área", key: "areas", width: 26 },
      { header: "Clasificación", key: "clasificacion", width: 20 },
      { header: "Proceso(s) en que interviene", key: "procesos", width: 60 },
    ];
    inv.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    inv.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    for (const d of inventario) {
      const fila = inv.addRow({
        codigo: d.codigo,
        categoria: d.categoria ?? "",
        nombre: d.nombre,
        titular: d.titularPrincipal ?? "",
        areas: d.areas ?? "",
        clasificacion: d.clasificacion ?? "",
        procesos: d.procesos ?? "",
      });
      fila.alignment = { vertical: "top", wrapText: true };
    }
    inv.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  }

  const buffer = await libro.xlsx.writeBuffer();
  const nombre = `RAT-${rat.empresa.replace(/[^a-zA-Z0-9]+/g, "-")}-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
