
// Qué exige el Registro de Actividades de Tratamiento, y cómo se llama cada cosa.
//
// Vive aparte de las consultas a la base porque lo usan cuatro piezas que tienen que decir
// exactamente lo mismo: la pantalla de requisitos que le explica al cliente qué reunir, el
// editor donde lo completa —que corre en el navegador—, el análisis que propone campos y
// la matriz que se descarga. Si divergen, el cliente completa una cosa y entrega otra.
//
// El orden y los nombres siguen la matriz que Procesos360 ya usa con el cliente. No es
// capricho: el RAT que sale de la plataforma tiene que poder pegarse al lado del que se
// llevó al workshop sin que nadie tenga que reordenar columnas para compararlos.

/**
 * Solo los campos de texto que el usuario llena. Deja fuera lo derivado (`areaNombre`) y
 * lo que tiene su propio control —área, estado, y las dos casillas de sí/no—, que no se
 * dibujan como cuadro de texto.
 */
export type CampoClave =
  | "nombre"
  | "procesos"
  | "areaPropuesta"
  | "duenoProceso"
  | "finalidad"
  | "categoriasTitulares"
  | "categoriasDatos"
  | "idsInventario"
  | "datosInvolucrados"
  | "clasificacionDato"
  | "origen"
  | "baseLegal"
  | "sistemas"
  | "encargados"
  | "destinatarios"
  | "paisesDestino"
  | "garantiasTransferencia"
  | "plazoConservacion"
  | "criterioEliminacion"
  | "decisionesAutomatizadas"
  | "medidasSeguridad"
  | "evaluarEipd"
  | "riesgoPreliminar"
  | "evidenciasSolicitar"
  | "fuenteDiseno"
  | "observaciones";

export type CampoRat = {
  clave: CampoClave;
  etiqueta: string;
  /** Qué se espera ahí, en el lenguaje de quien lo tiene que llenar. */
  ayuda: string;
  ejemplo: string;
  /** Sin esto, la actividad no está documentada: la ley lo exige por cada tratamiento. */
  obligatorio: boolean;
  ancho: "corto" | "largo";
  /**
   * Valores sugeridos. Se ofrecen sin cerrar el campo: una actividad puede apoyarse en
   * dos bases de licitud a la vez, y un desplegable estricto obligaría a elegir una y
   * perder la otra.
   */
  opciones?: readonly string[];
  /** Qué hay que confirmar con el cliente antes de dar la celda por buena. */
  validar?: string;
  /** Qué documento acredita lo que dice la celda. Alimenta las evidencias a solicitar. */
  evidencia?: string;
  /**
   * Campos que no se le piden al análisis porque no salen del material: son juicio del
   * consultor (el riesgo, si corresponde una EIPD) o metadatos de la propia fila.
   */
  soloPersona?: boolean;
};

/**
 * Las bases de licitud de la Ley 21.719, en su redacción vigente.
 *
 * Están enumeradas y no son texto libre porque la base de licitud es lo primero que mira
 * quien fiscaliza: si cada área escribe la suya con sus palabras, el registro deja de ser
 * comparable consigo mismo y no hay forma de contar cuántos tratamientos se apoyan en
 * consentimiento. Aun así el campo admite escribir: hay actividades que se sostienen en
 * dos bases y forzar una sola sería perder la otra.
 */
export const BASES_LICITUD = [
  "Consentimiento del titular",
  "Obligación legal / dispuesto por ley",
  "Celebración o ejecución de un contrato / medidas precontractuales",
  "Interés legítimo del responsable o de un tercero",
  "Obligaciones económicas, financieras, bancarias o comerciales",
  "Formulación, ejercicio o defensa de derechos",
  "Reglas especiales para datos sensibles, de salud o biometría",
] as const;

export const NIVELES_RIESGO = ["Bajo", "Bajo/Medio", "Medio", "Medio/Alto", "Alto", "Crítico"] as const;

export const OPCIONES_EIPD = [
  "No preliminar",
  "Por evaluar",
  "Sí, evaluar alcance",
  "Sí",
  "Sí, por monitoreo sistemático",
] as const;

export const CLASIFICACIONES_DATO = [
  "Personal",
  "Personal asociado",
  "Sensible",
  "Potencialmente sensible",
] as const;

export type TratamientoPlano = {
  id: string;
  codigo: string | null;
  nombre: string;
  areaId: string | null;
  areaNombre: string | null;
  procesos: string | null;
  areaPropuesta: string | null;
  duenoProceso: string | null;
  finalidad: string | null;
  categoriasTitulares: string | null;
  categoriasDatos: string | null;
  idsInventario: string | null;
  datosInvolucrados: string | null;
  clasificacionDato: string | null;
  datosSensibles: boolean;
  origen: string | null;
  baseLegal: string | null;
  sistemas: string | null;
  encargados: string | null;
  destinatarios: string | null;
  transferenciaInternacional: boolean;
  paisesDestino: string | null;
  garantiasTransferencia: string | null;
  plazoConservacion: string | null;
  criterioEliminacion: string | null;
  decisionesAutomatizadas: string | null;
  medidasSeguridad: string | null;
  evaluarEipd: string | null;
  riesgoPreliminar: string | null;
  evidenciasSolicitar: string | null;
  fuenteDiseno: string | null;
  observaciones: string | null;
  estado: string;
};

/**
 * Lo que hay que documentar por cada actividad de tratamiento.
 *
 * `obligatorio` marca lo que sin excepción tiene que estar, porque la Ley 21.719 lo exige
 * por cada tratamiento. El resto es lo que la práctica de Procesos360 agrega para que el
 * registro sirva de verdad —trazabilidad al inventario, dueño que valida, evidencia que
 * lo acredita— y lo que depende del caso: los países de destino solo aplican si hay
 * transferencia internacional, y por eso no cuentan como faltantes.
 */
export const CAMPOS_RAT: CampoRat[] = [
  {
    clave: "nombre",
    etiqueta: "Actividad de tratamiento",
    ayuda: "Qué se hace con los datos, en verbo + objeto. No es un sistema ni un área.",
    ejemplo: "Gestionar postulaciones laborales",
    obligatorio: true,
    ancho: "corto",
     validar:
      "Confirmar que la actividad existe de verdad, su alcance y cuándo empieza y termina.",
    evidencia: "Procedimiento, flujo, ficha de proceso, entrevista al área.",
  },
  {
    clave: "procesos",
    etiqueta: "Procesos relacionados",
    ayuda: "Los procesos del mapa de la empresa donde se ejecuta. Puede ser más de uno.",
    ejemplo: "S-4.2 Incorporación de Personas",
    obligatorio: false,
    ancho: "largo",
  },
  {
    clave: "areaPropuesta",
    etiqueta: "Área responsable propuesta",
    ayuda: "Quién responde por la actividad. Sujeta a validación con el cliente.",
    ejemplo: "RRHH",
    obligatorio: false,
    ancho: "corto",
     validar:
      "Identificar al responsable operativo, no al que aparece en el organigrama.",
    evidencia: "Organigrama, matriz RACI, descripción de cargo.",
  },
  {
    clave: "duenoProceso",
    etiqueta: "Dueño / Key User",
    ayuda: "La persona que conoce el proceso y puede validar la fila. Sin dueño, nadie la valida.",
    ejemplo: "Magdalena Rojas — Jefa de Personas",
    obligatorio: false,
    ancho: "corto",
    soloPersona: true,
     validar:
      "Identificar a los usuarios clave que conocen la operación.",
    evidencia: "Organigrama, matriz RACI, descripción de cargo.",
  },
  {
    clave: "finalidad",
    etiqueta: "Finalidad",
    ayuda: "Para qué se usan esos datos. Evita finalidades genéricas; si hay varias, van todas.",
    ejemplo: "Gestionar el pago de remuneraciones y las obligaciones previsionales.",
    obligatorio: true,
    ancho: "largo",
     validar:
      "Que sea específica, explícita y legítima. Una finalidad genérica no permite medir si el dato sobra.",
    evidencia: "Aviso de privacidad, formulario, contrato, procedimiento.",
  },
  {
    clave: "categoriasTitulares",
    etiqueta: "Categorías de titulares",
    ayuda: "De quiénes son los datos.",
    ejemplo: "Clientes, trabajadores, postulantes, contactos de proveedores",
    obligatorio: true,
    ancho: "corto",
     validar:
      "Confirmar el universo real de titulares, incluidos los que nadie nombra.",
    evidencia: "Pantallas, formularios, extractos de sistemas, bases.",
  },
  {
    clave: "categoriasDatos",
    etiqueta: "Categorías de datos",
    ayuda: "Los tipos de dato, agrupados.",
    ejemplo: "Identificación, contacto, laborales, financieros",
    obligatorio: true,
    ancho: "largo",
     validar:
      "Confirmar los datos mínimos necesarios y cuáles son sensibles.",
    evidencia: "Pantallas, formularios, extractos de sistemas, bases.",
  },
  {
    clave: "idsInventario",
    etiqueta: "IDs del inventario de datos",
    ayuda:
      "Los códigos del inventario de datos personales. Es lo que mantiene la trazabilidad entre el registro y el inventario.",
    ejemplo: "DP-016, DP-020, DP-021",
    obligatorio: false,
    ancho: "corto",
  },
  {
    clave: "datosInvolucrados",
    etiqueta: "Datos personales involucrados",
    ayuda: "El detalle concreto, no la categoría.",
    ejemplo: "Nombre; RUT; remuneración; datos bancarios; información previsional",
    obligatorio: false,
    ancho: "largo",
  },
  {
    clave: "clasificacionDato",
    etiqueta: "Clasificación del dato",
    ayuda: "Según su naturaleza y el nivel de protección que exige.",
    ejemplo: "Personal; sensible",
    obligatorio: false,
    ancho: "corto",
    opciones: CLASIFICACIONES_DATO,
  },
  {
    clave: "origen",
    etiqueta: "Origen de los datos",
    ayuda: "De dónde salieron: del propio titular, de un tercero, de una fuente pública.",
    ejemplo: "Entregados por el trabajador al momento de la contratación",
    obligatorio: false,
    ancho: "corto",
  },
  {
    clave: "baseLegal",
    etiqueta: "Base de licitud",
    ayuda:
      "Qué permite tratarlos: consentimiento, ejecución de un contrato, obligación legal o interés legítimo. Se revisa jurídicamente.",
    ejemplo: "Ejecución del contrato de trabajo y obligación legal previsional",
    obligatorio: true,
    ancho: "corto",
    opciones: BASES_LICITUD,
    validar:
      "Validar el fundamento de cada finalidad por separado: una actividad con dos finalidades puede necesitar dos bases.",
    evidencia: "Consentimiento, contrato, norma que obliga, análisis de interés legítimo.",
  },
  {
    clave: "sistemas",
    etiqueta: "Sistemas / repositorios",
    ayuda: "Dónde viven los datos. Vale también la planilla en un computador.",
    ejemplo: "BUK, SAP, carpetas de red de RRHH",
    obligatorio: false,
    ancho: "corto",
     validar:
      "Dónde se crea, se usa, se almacena y se elimina el dato. Los cuatro momentos, no solo el primero.",
    evidencia: "Inventario de TI, arquitectura, carpetas de red, SaaS, ERP/CRM.",
  },
  {
    clave: "encargados",
    etiqueta: "Encargados / proveedores",
    ayuda: "Terceros que tratan los datos por cuenta de la empresa.",
    ejemplo: "Deloitte (procesamiento de remuneraciones), BUK (plataforma de RRHH)",
    obligatorio: false,
    ancho: "corto",
     validar:
      "Identificar a los proveedores que tratan datos por cuenta de la empresa, aunque el contrato no lo diga.",
    evidencia: "Contratos, anexos de tratamiento de datos, listado de proveedores.",
  },
  {
    clave: "destinatarios",
    etiqueta: "Destinatarios / cesiones",
    ayuda: "A quién se comunican los datos, dentro y fuera de la empresa.",
    ejemplo: "AFP, Fonasa/Isapre, Dirección del Trabajo, entidades bancarias",
    obligatorio: true,
    ancho: "largo",
     validar:
      "Distinguir al encargado del tercero que recibe los datos como responsable independiente.",
    evidencia: "Convenios, contratos, interfaces, reportes.",
  },
  {
    clave: "paisesDestino",
    etiqueta: "País / destino",
    ayuda: "Solo si hay transferencia internacional. Cuenta también el servicio en la nube.",
    ejemplo: "Brasil (casa matriz regional), Estados Unidos (servidores del CRM)",
    obligatorio: false,
    ancho: "corto",
     validar:
      "Confirmar los flujos fuera de Chile, incluidos los que ocurren solo porque el servicio está en la nube.",
    evidencia: "Arquitectura cloud, contratos, subencargados, residencia de datos.",
  },
  {
    clave: "garantiasTransferencia",
    etiqueta: "Garantías de la transferencia",
    ayuda:
      "Qué protege esos datos al salir del país. La ley no se conforma con saber a dónde van: exige saber con qué resguardo.",
    ejemplo: "Cláusulas contractuales tipo con la casa matriz",
    obligatorio: false,
    ancho: "largo",
     validar:
      "Qué mecanismo ampara la salida de los datos del país.",
    evidencia: "Cláusulas contractuales, contrato con la casa matriz, certificaciones.",
  },
  {
    clave: "plazoConservacion",
    etiqueta: "Plazo de conservación",
    ayuda: 'Cuánto tiempo se guardan. "Indefinido" no es un plazo.',
    ejemplo: "5 años desde el término del contrato",
    obligatorio: true,
    ancho: "corto",
     validar:
      "Definir un período o un criterio objetivo, y qué pasa al cumplirse.",
    evidencia: "Tabla de retención, norma legal, política, rutina de borrado.",
  },
  {
    clave: "criterioEliminacion",
    etiqueta: "Criterio de eliminación / anonimización",
    ayuda: "Qué gatilla la eliminación y cómo se ejecuta. El plazo dice cuándo; esto, cómo.",
    ejemplo: "Al cumplirse el plazo legal se eliminan; para estadísticas se anonimizan.",
    obligatorio: false,
    ancho: "largo",
     validar:
      "Que la eliminación se ejecute de verdad y no solo esté escrita.",
    evidencia: "Rutina de borrado, registro de eliminación, política.",
  },
  {
    clave: "decisionesAutomatizadas",
    etiqueta: "Decisiones automatizadas / perfilamiento",
    ayuda:
      "Si los datos se usan para decidir o perfilar sin intervención humana. La ley le da al titular derecho a oponerse.",
    ejemplo: "No. / Sí: scoring automático de prospectos según preferencias declaradas.",
    obligatorio: false,
    ancho: "largo",
     validar:
      "Si existe perfilamiento o decisiones sin intervención humana, y con qué lógica.",
    evidencia: "Documentación del modelo, reglas del sistema, capturas.",
  },
  {
    clave: "medidasSeguridad",
    etiqueta: "Medidas de seguridad",
    ayuda: "Qué los protege: control de acceso, cifrado, respaldos, confidencialidad.",
    ejemplo: "Acceso por perfil, cifrado en reposo, respaldo diario, cláusula de confidencialidad",
    obligatorio: true,
    ancho: "largo",
     validar:
      "Levantar los controles reales, no los del manual.",
    evidencia: "Control de accesos, cifrado, respaldos, logs, segregación, monitoreo.",
  },
  {
    clave: "evaluarEipd",
    etiqueta: "¿Evaluar EIPD?",
    ayuda:
      "Si el tratamiento debería someterse a Evaluación de Impacto, por volumen, sensibilidad, tecnología o perfilamiento.",
    ejemplo: "Sí, evaluar alcance",
    obligatorio: false,
    ancho: "corto",
    soloPersona: true,
    opciones: OPCIONES_EIPD,
    validar:
      "Si hay alto riesgo por escala, perfilamiento, monitoreo sistemático o datos sensibles.",
    evidencia: "Evaluación de riesgo, volumen tratado, decisiones automatizadas, CCTV o biometría.",
  },
  {
    clave: "riesgoPreliminar",
    etiqueta: "Riesgo preliminar",
    ayuda: "El riesgo para los derechos de los titulares: bajo, medio, alto o crítico.",
    ejemplo: "Alto",
    obligatorio: false,
    ancho: "corto",
    soloPersona: true,
    opciones: NIVELES_RIESGO,
  },
  {
    clave: "evidenciasSolicitar",
    etiqueta: "Evidencias a solicitar",
    ayuda: "Qué documentos hay que pedir para acreditar esta fila. Es la lista de tareas del cliente.",
    ejemplo: "Contrato con el proveedor de remuneraciones; política de conservación; anexo de confidencialidad",
    obligatorio: false,
    ancho: "largo",
     validar:
      "Que cada fila cierre con la aprobación del dueño y su evidencia adjunta.",
    evidencia: "Acta o aprobación registrada.",
  },
  {
    clave: "fuenteDiseno",
    etiqueta: "Fuente de diseño",
    ayuda: "De dónde salió esta fila: qué ficha, qué respuesta, qué documento la sustenta.",
    ejemplo: "Ficha de proceso RRHH; dominio 9, respuesta de Magdalena Rojas",
    obligatorio: false,
    ancho: "largo",
    soloPersona: true,
  },
  {
    clave: "observaciones",
    etiqueta: "Observaciones",
    ayuda: "Supuestos, dudas, brechas y todo lo que quede pendiente de validar.",
    ejemplo: "Validar con Legal si la base de licitud alcanza para la comunicación al banco.",
    obligatorio: false,
    ancho: "largo",
    soloPersona: true,
  },
];

/** Los campos que el análisis puede proponer: los que salen del material del cliente. */
export const CAMPOS_ANALIZABLES = CAMPOS_RAT.filter((c) => !c.soloPersona && c.clave !== "nombre");

/**
 * La forma comparable de un nombre de actividad.
 *
 * Sirve para no registrar dos veces lo mismo. Sin tildes, sin mayúsculas y sin puntuación,
 * porque "Gestión de Leads" y "gestion de leads." son la misma actividad y el registro no
 * puede tener las dos: quien lo audite vería dos tratamientos donde hay uno.
 */
export function claveNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const OBLIGATORIOS = CAMPOS_RAT.filter((c) => c.obligatorio);

/** Campos obligatorios que esta actividad todavía no tiene. */
export function faltantesDe(t: TratamientoPlano): CampoRat[] {
  return OBLIGATORIOS.filter((c) => {
    const v = t[c.clave];
    return typeof v === "string" ? v.trim() === "" : v == null;
  });
}

/**
 * Estados de validación de una fila del registro.
 *
 * Los códigos guardados no cambian —hay filas escritas con ellos— pero las etiquetas
 * siguen el vocabulario de la matriz que el cliente ya conoce.
 */
export const ESTADOS_RAT = [
  { valor: "BORRADOR", etiqueta: "Borrador", color: "slate" },
  { valor: "EN_LEVANTAMIENTO", etiqueta: "En levantamiento", color: "blue" },
  { valor: "EN_REVISION", etiqueta: "Pendiente de validación", color: "yellow" },
  { valor: "REQUIERE_AJUSTE", etiqueta: "Requiere ajuste", color: "orange" },
  { valor: "VIGENTE", etiqueta: "Validado", color: "green" },
] as const;

export type EstadoRat = (typeof ESTADOS_RAT)[number]["valor"];

export const CODIGOS_ESTADO_RAT = ESTADOS_RAT.map((e) => e.valor) as unknown as [
  EstadoRat,
  ...EstadoRat[],
];

export function etiquetaEstado(valor: string): string {
  return ESTADOS_RAT.find((e) => e.valor === valor)?.etiqueta ?? "Borrador";
}

/**
 * Lo que va en una celda vacía de la matriz descargada.
 *
 * La plataforma guarda el hueco como vacío y no como texto, a propósito: si "Por validar"
 * se guardara, la fila contaría como completa y el registro diría estar terminado cuando
 * no lo está. El texto se escribe solo al momento de exportar, que es donde sirve —le dice
 * al que recibe la matriz qué falta— sin engañar a quien mide el avance.
 */
export const POR_VALIDAR = "Por validar";
