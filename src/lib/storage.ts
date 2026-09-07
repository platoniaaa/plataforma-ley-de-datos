import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente de Supabase Storage para evidencias. Usa la service_role key (solo servidor).
// Bucket privado: los archivos se sirven mediante URLs firmadas temporales.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const BUCKET_EVIDENCIAS = "evidencias";

/** ¿Están las variables de Storage configuradas? Permite degradar la UI si aún no. */
export function storageConfigurado(): boolean {
  return Boolean(URL && KEY);
}

function client() {
  if (!URL || !KEY) {
    throw new Error(
      "Supabase Storage no configurado: falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

/** Sube un archivo al bucket de evidencias. Devuelve el path almacenado. */
export async function subirEvidencia(
  path: string,
  data: ArrayBuffer | Buffer | Uint8Array,
  contentType?: string
): Promise<string> {
  const supabase = client();
  const body = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const { error } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .upload(path, body, { contentType: contentType || "application/octet-stream", upsert: true });
  if (error) throw error;
  return path;
}

/** URL firmada para que el navegador suba el archivo directo a Storage.
 *  Evita que el archivo pase por el servidor, que rechaza cuerpos sobre ~4,5 MB. */
export async function crearUrlSubidaEvidencia(
  path: string
): Promise<{ signedUrl: string; path: string }> {
  const supabase = client();
  const { data, error } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path: data.path };
}

/** URL firmada temporal para descargar/visualizar una evidencia. */
export async function urlFirmadaEvidencia(path: string, expiresIn = 60 * 60): Promise<string> {
  const supabase = client();
  const { data, error } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/** Elimina el archivo físico de una evidencia (silencioso si Storage no está configurado). */
export async function eliminarArchivoEvidencia(path: string): Promise<void> {
  if (!storageConfigurado()) return;
  const supabase = client();
  await supabase.storage.from(BUCKET_EVIDENCIAS).remove([path]);
}
