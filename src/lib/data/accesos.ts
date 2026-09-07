import "server-only";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/constants";

// Quién tiene acceso a la plataforma y en qué estado está.
//
// La pregunta que resuelve esta pantalla es siempre la misma: "esta persona no está
// trabajando, ¿es que no quiere o es que no puede entrar?". Por eso lo que importa no
// es el usuario en sí sino tres cosas: si ya entró alguna vez, si tiene un enlace de
// activación vivo, y cuándo fue la última vez que alguien del equipo le escribió.

export type EstadoAcceso = "SIN_ENTRAR" | "ENLACE_VIGENTE" | "ACTIVO";

export type UsuarioAcceso = {
  id: string;
  nombre: string;
  email: string;
  cargo: string | null;
  role: Role;
  activo: boolean;
  estado: EstadoAcceso;
  primerIngreso: Date | null;
  enlaceVence: Date | null;
  ultimoAccesoEnviado: Date | null;
  dominios: number[];
};

export type EmpresaAccesos = {
  id: string;
  razonSocial: string;
  esDemo: boolean;
  usuarios: UsuarioAcceso[];
};

export async function accesosPorEmpresa(): Promise<EmpresaAccesos[]> {
  const ahora = new Date();

  const empresas = await prisma.empresa.findMany({
    orderBy: [{ esDemo: "asc" }, { razonSocial: "asc" }],
    select: {
      id: true,
      razonSocial: true,
      esDemo: true,
      usuarios: {
        orderBy: [{ activo: "desc" }, { nombre: "asc" }],
        select: {
          id: true,
          nombre: true,
          email: true,
          cargo: true,
          role: true,
          activo: true,
          consentimientoFecha: true,
          tokenActivacion: true,
          tokenExpira: true,
          ultimoAccesoEnviado: true,
          participaciones: {
            select: {
              diagnosticoDominio: { select: { dominio: { select: { orden: true } } } },
            },
          },
        },
      },
    },
  });

  return empresas.map((e) => ({
    id: e.id,
    razonSocial: e.razonSocial,
    esDemo: e.esDemo,
    usuarios: e.usuarios.map((u) => {
      const enlaceVivo = Boolean(u.tokenActivacion && u.tokenExpira && u.tokenExpira > ahora);
      // Haber entrado manda sobre tener un enlace: si ya está adentro, el enlace sobra.
      const estado: EstadoAcceso = u.consentimientoFecha
        ? "ACTIVO"
        : enlaceVivo
          ? "ENLACE_VIGENTE"
          : "SIN_ENTRAR";
      return {
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        cargo: u.cargo,
        role: u.role as Role,
        activo: u.activo,
        estado,
        primerIngreso: u.consentimientoFecha,
        enlaceVence: enlaceVivo ? u.tokenExpira : null,
        ultimoAccesoEnviado: u.ultimoAccesoEnviado,
        dominios: u.participaciones
          .map((p) => p.diagnosticoDominio.dominio.orden)
          .sort((a, b) => a - b),
      };
    }),
  }));
}
