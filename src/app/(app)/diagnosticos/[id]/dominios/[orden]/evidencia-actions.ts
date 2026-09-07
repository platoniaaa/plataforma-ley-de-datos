"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, sinAccesoAEmpresa, puedeRevisarDominios } from "@/lib/session";
import { esParticipanteDominio } from "@/lib/data/diagnosticos";
import {
  crearUrlSubidaEvidencia,
  eliminarArchivoEvidencia,
  urlFirmadaEvidencia,
  storageConfigurado,
} from "@/lib/storage";
import { ESTADO_EVIDENCIA, ROLES, MAX_EVIDENCIA_BYTES, MAX_EVIDENCIA_MB } from "@/lib/constants";

export type EvidenciaResult = { ok: boolean; error?: string };

function sanitizar(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/** Comprueba que quien pide subir puede hacerlo en esa respuesta. */
async function autorizarRespuesta(respuestaId: string) {
  const session = await requireSession();
  const respuesta = await prisma.respuesta.findUnique({
    where: { id: respuestaId },
    select: {
      id: true,
      diagnosticoDominio: {
        select: {
          id: true,
          diagnostico: { select: { id: true, empresaId: true } },
          dominio: { select: { orden: true } },
        },
      },
    },
  });
  if (!respuesta) return { error: "Respuesta no encontrada." as const };
  const diag = respuesta.diagnosticoDominio.diagnostico;
  if (sinAccesoAEmpresa(session, diag.empresaId)) {
    return { error: "Sin acceso." as const };
  }
  if (
    session.user.role === ROLES.RESPONSABLE_DOMINIO &&
    !(await esParticipanteDominio(respuesta.diagnosticoDominio.id, session.user.id))
  ) {
    return { error: "Este dominio no está asignado a ti." as const };
  }
  return { session, respuesta, diag };
}

/** Paso 1 de la subida: entrega una URL firmada para que el navegador envíe el
 *  archivo directamente a Storage, sin pasar por el servidor. */
export async function prepararSubidaEvidenciaAction(
  respuestaId: string,
  nombreArchivo: string,
  tamano: number
): Promise<{ ok: boolean; signedUrl?: string; path?: string; error?: string }> {
  const aut = await autorizarRespuesta(respuestaId);
  if ("error" in aut) return { ok: false, error: aut.error };
  if (!storageConfigurado()) {
    return { ok: false, error: "Storage no configurado: falta SUPABASE_SERVICE_ROLE_KEY." };
  }
  if (tamano > MAX_EVIDENCIA_BYTES) {
    return { ok: false, error: `El archivo supera ${MAX_EVIDENCIA_MB} MB.` };
  }
  const path = `${aut.diag.id}/${respuestaId}/${randomUUID()}-${sanitizar(nombreArchivo)}`;
  try {
    const { signedUrl } = await crearUrlSubidaEvidencia(path);
    return { ok: true, signedUrl, path };
  } catch (e) {
    return { ok: false, error: `No se pudo preparar la subida: ${(e as Error).message}` };
  }
}

/** Paso 2 de la subida: registra la evidencia una vez que el archivo ya está en Storage. */
export async function registrarEvidenciaAction(datos: {
  respuestaId: string;
  nombre: string;
  tipoDocumental?: string | null;
  vigencia?: string | null;
  archivoPath?: string | null;
  mimeType?: string | null;
  tamano?: number | null;
}): Promise<EvidenciaResult> {
  const aut = await autorizarRespuesta(datos.respuestaId);
  if ("error" in aut) return { ok: false, error: aut.error };
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: "El nombre del documento es obligatorio." };

  await prisma.evidencia.create({
    data: {
      respuestaId: datos.respuestaId,
      diagnosticoDominioId: aut.respuesta.diagnosticoDominio.id,
      nombre,
      tipoDocumental: datos.tipoDocumental?.trim() || null,
      archivoPath: datos.archivoPath ?? null,
      mimeType: datos.mimeType ?? null,
      tamano: datos.tamano ?? null,
      vigencia: datos.vigencia ? new Date(datos.vigencia) : null,
      subidoPorId: aut.session.user.id,
      estado: "PENDIENTE",
    },
  });

  revalidatePath(
    `/diagnosticos/${aut.diag.id}/dominios/${aut.respuesta.diagnosticoDominio.dominio.orden}`
  );
  return { ok: true };
}

/**
 * Valida, observa o rechaza una evidencia.
 *
 * Comprueba la empresa además del permiso. Antes solo miraba el rol, y con el staff daba
 * igual porque ve a todos sus clientes; desde que esto lo puede hacer alguien del cliente,
 * el id de la evidencia venía del navegador y nada impedía revisar la de otra empresa.
 */
export async function validarEvidenciaAction(
  evidenciaId: string,
  estado: keyof typeof ESTADO_EVIDENCIA,
  observaciones?: string
): Promise<EvidenciaResult> {
  await requireSession();
  if (!(estado in ESTADO_EVIDENCIA)) return { ok: false, error: "Estado inválido." };

  const ev = await prisma.evidencia.findUnique({
    where: { id: evidenciaId },
    select: {
      id: true,
      respuesta: {
        select: {
          diagnosticoDominio: {
            select: {
              diagnostico: { select: { id: true, empresaId: true } },
              dominio: { select: { orden: true } },
            },
          },
        },
      },
    },
  });
  if (!ev) return { ok: false, error: "Evidencia no encontrada." };
  if (!(await puedeRevisarDominios(ev.respuesta?.diagnosticoDominio.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar esta evidencia." };
  }

  await prisma.evidencia.update({
    where: { id: evidenciaId },
    data: { estado, observaciones: observaciones?.trim() || null },
  });

  const diagId = ev.respuesta?.diagnosticoDominio.diagnostico.id;
  if (diagId) {
    revalidatePath(`/diagnosticos/${diagId}/evidencias`);
    revalidatePath(`/diagnosticos/${diagId}/dominios/${ev.respuesta?.diagnosticoDominio.dominio.orden}`);
  }
  return { ok: true };
}

/** Devuelve una URL firmada temporal para descargar la evidencia. */
export async function descargarEvidenciaAction(
  evidenciaId: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const session = await requireSession();
  const ev = await prisma.evidencia.findUnique({
    where: { id: evidenciaId },
    select: {
      archivoPath: true,
      respuesta: { select: { diagnosticoDominio: { select: { diagnostico: { select: { empresaId: true } } } } } },
    },
  });
  if (!ev?.archivoPath) return { ok: false, error: "La evidencia no tiene archivo." };
  const empresaId = ev.respuesta?.diagnosticoDominio.diagnostico.empresaId;
  if (sinAccesoAEmpresa(session, empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }
  try {
    return { ok: true, url: await urlFirmadaEvidencia(ev.archivoPath) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Elimina una evidencia (registro + archivo en Storage). */
export async function eliminarEvidenciaAction(evidenciaId: string): Promise<EvidenciaResult> {
  const session = await requireSession();

  const ev = await prisma.evidencia.findUnique({
    where: { id: evidenciaId },
    select: {
      id: true,
      archivoPath: true,
      subidoPorId: true,
      respuesta: {
        select: {
          diagnosticoDominio: {
            select: { id: true, diagnostico: { select: { id: true, empresaId: true } }, dominio: { select: { orden: true } } },
          },
        },
      },
    },
  });
  if (!ev) return { ok: false, error: "Evidencia no encontrada." };
  const diag = ev.respuesta?.diagnosticoDominio.diagnostico;
  if (sinAccesoAEmpresa(session, diag?.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }
  // El Responsable de Dominio solo gestiona evidencias de los dominios en que participa.
  const ddId = ev.respuesta?.diagnosticoDominio.id;
  if (
    session.user.role === ROLES.RESPONSABLE_DOMINIO &&
    !(ddId && (await esParticipanteDominio(ddId, session.user.id)))
  ) {
    return { ok: false, error: "Este dominio no está asignado a ti." };
  }

  if (ev.archivoPath) await eliminarArchivoEvidencia(ev.archivoPath);
  await prisma.evidencia.delete({ where: { id: evidenciaId } });

  if (diag) {
    revalidatePath(`/diagnosticos/${diag.id}/dominios/${ev.respuesta?.diagnosticoDominio.dominio.orden}`);
    revalidatePath(`/diagnosticos/${diag.id}/evidencias`);
  }
  return { ok: true };
}
