// Le devuelve la entrada a la plataforma a alguien que se quedó afuera.
//
// Lo normal es hacerlo desde la sección Accesos de la plataforma, que además deja
// registrado quién lo autorizó. Esto es para cuando hay que resolverlo desde afuera —un
// correo que llega el domingo, un problema con el enlace— y usa exactamente el mismo
// código que la pantalla (`src/lib/accesos.ts`), no una copia.
//
// Dos caminos:
//   --enlace     manda un enlace y la persona define su propia contraseña. Es el mejor:
//                no viaja ninguna credencial por correo.
//   --password   genera una contraseña nueva y la manda escrita. Es un REEMPLAZO: la
//                anterior deja de servir. Se usa cuando el enlace ya falló o venció.
//
// Uso:
//   npx tsx prisma/reenviar-acceso.ts alguien@empresa.cl                 (revisa, no envía)
//   npx tsx prisma/reenviar-acceso.ts alguien@empresa.cl --password --enviar
//   npx tsx prisma/reenviar-acceso.ts alguien@empresa.cl --enlace --enviar

import { readFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const correos = args.filter((a) => !a.startsWith("--"));
const bandera = (n: string) => args.includes(`--${n}`);

for (const l of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { prisma } from "../src/lib/db";
import { correoConfigurado } from "../src/lib/email";
import {
  destinatariosActivos,
  dominiosDe,
  enviarEnlaceDeActivacion,
  enviarPasswordDeReemplazo,
} from "../src/lib/accesos";

async function main() {
  if (correos.length === 0) {
    console.error("Indica al menos un correo. Ver el encabezado del archivo.");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: { email: { in: correos.map((c) => c.toLowerCase()) } },
    select: {
      id: true,
      nombre: true,
      email: true,
      cargo: true,
      activo: true,
      tokenActivacion: true,
      tokenExpira: true,
      ultimoAccesoEnviado: true,
      consentimientoFecha: true,
      empresa: { select: { razonSocial: true } },
      _count: { select: { aportes: true } },
    },
  });

  const noEncontrados = correos.filter(
    (c) => !users.some((u) => u.email.toLowerCase() === c.toLowerCase())
  );
  for (const c of noEncontrados) console.log(`⚠  No existe ninguna cuenta con ${c}`);

  const ahora = new Date();
  for (const u of users) {
    const vencido = u.tokenExpira ? u.tokenExpira < ahora : null;
    console.log(`\n${u.nombre} <${u.email}>`);
    console.log(`  ${u.cargo ?? "sin cargo"} · ${u.empresa?.razonSocial ?? "sin empresa"}`);
    console.log(`  cuenta activa:     ${u.activo ? "sí" : "NO — no recibirá nada"}`);
    console.log(
      `  enlace pendiente:  ${
        u.tokenActivacion
          ? `sí, ${vencido ? "VENCIDO" : "vigente"} el ${u.tokenExpira?.toLocaleDateString("es-CL")}`
          : "no"
      }`
    );
    console.log(
      `  ya entró alguna vez: ${u.consentimientoFecha ? `sí, el ${u.consentimientoFecha.toLocaleDateString("es-CL")}` : "nunca"}`
    );
    console.log(`  respuestas escritas: ${u._count.aportes}`);
    console.log(`  último acceso enviado: ${u.ultimoAccesoEnviado?.toLocaleDateString("es-CL") ?? "nunca"}`);
    console.log(`  dominios: ${(await dominiosDe(u.id)).join(" | ") || "ninguno"}`);
  }

  const enlace = bandera("enlace");
  const password = bandera("password");
  if (enlace === password) {
    console.log("\nElige un camino: --enlace (recomendado) o --password (reemplaza la actual).");
    return;
  }

  if (!bandera("enviar")) {
    console.log(`\n(solo revisión — agrega --enviar para mandar ${enlace ? "el enlace" : "la contraseña nueva"})`);
    return;
  }

  if (!correoConfigurado()) {
    console.error("\nFalta RESEND_API_KEY o EMAIL_FROM: no se puede enviar.");
    process.exit(1);
  }
  // La guardia de src/lib/email desvía el correo si no estamos en producción. Se avisa
  // antes de intentarlo, porque el error que devuelve suena a falla y no a protección.
  if (process.env.LPDP_CORREO_REAL !== "true") {
    console.error(
      "\nEste equipo no entrega correo real. Para mandarlo de verdad hay que ejecutarlo con" +
        " LPDP_CORREO_REAL=true, o hacerlo desde la sección Accesos de la plataforma."
    );
    process.exit(1);
  }

  const activos = await destinatariosActivos(users.map((u) => u.id));
  const { enviados, fallidos } = enlace
    ? await enviarEnlaceDeActivacion(activos)
    : await enviarPasswordDeReemplazo(activos);

  console.log(`\nEnviados: ${enviados}`);
  for (const f of fallidos) console.log(`  falló ${f.nombre}: ${f.motivo}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
