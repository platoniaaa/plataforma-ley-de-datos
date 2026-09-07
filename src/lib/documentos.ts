// Qué formatos puede leer el análisis, y por qué no lee los otros.
//
// Vive aparte de `texto-documento.ts` —que sí extrae el texto y por eso es solo de
// servidor— porque esta pregunta también hay que responderla en el navegador, cuando
// alguien elige un archivo para subir. Tenerlo escrito dos veces significaba que la
// pantalla decía "no lo lee" de un archivo que el servidor sí leía, o al revés.

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ¿Es un formato de Office del que sabemos sacar texto? */
export function esOfficeLegible(mimeType: string | null | undefined): boolean {
  return mimeType === DOCX || mimeType === XLSX;
}

/**
 * ¿El análisis puede leer este archivo?
 *
 * PDF e imágenes van tal cual al modelo —incluidos los escaneados, que no tienen texto
 * que extraer—; de Word y Excel se saca el texto en el servidor.
 */
export function analisisLoLee(mimeType: string | null | undefined): boolean {
  return (
    mimeType === "application/pdf" ||
    Boolean(mimeType?.startsWith("image/")) ||
    esOfficeLegible(mimeType)
  );
}

/**
 * Por qué no se puede leer, dicho de forma accionable.
 *
 * "Es un .xls antiguo, guárdalo como .xlsx" se puede resolver; "el análisis no lo lee"
 * deja a la persona sin saber qué hacer con el archivo que acaba de subir.
 */
export function motivoNoLegible(mimeType: string | null | undefined): string | null {
  if (analisisLoLee(mimeType)) return null;
  if (!mimeType) return "no se reconoció el tipo de archivo";
  if (mimeType === "application/msword") return "es un .doc antiguo: guárdalo como .docx o PDF";
  if (mimeType === "application/vnd.ms-excel") return "es un .xls antiguo: guárdalo como .xlsx o PDF";
  if (mimeType.includes("presentationml") || mimeType.includes("ms-powerpoint")) {
    return "es una presentación: expórtala a PDF";
  }
  if (mimeType.includes("zip") || mimeType.includes("compressed")) {
    return "es un comprimido: sube los archivos por separado";
  }
  return "el formato no se puede leer: expórtalo a PDF";
}
