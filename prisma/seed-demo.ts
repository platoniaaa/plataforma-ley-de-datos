// Seed de DEMO — SOLO desarrollo local. Crea datos ficticios (Empresa Demo, 5 usuarios
// con contraseña Demo1234, un diagnóstico de ejemplo) y RESETEA todas las tablas antes.
// Bloqueado en producción: estos datos jamás deben llegar a un entorno real.
//
// Uso:  npm run db:seed:demo

import { readFileSync } from "fs";
import { join } from "path";

try {
  for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* sin .env local */
}

// ── GUARD: nunca en producción ──
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error(
    "✋ seed-demo BLOQUEADO: crea datos ficticios (Empresa Demo, usuarios Demo1234) que no " +
      "deben existir en producción. Para producción usa 'npm run db:seed' (catálogo) y " +
      "'npm run crear-admin'."
  );
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sembrarCatalogo } from "./catalogo";

const prisma = new PrismaClient();

async function main() {
  console.log("Limpiando datos (reset local)...");
  await prisma.accionTratamiento.deleteMany();
  await prisma.riesgo.deleteMany();
  await prisma.brecha.deleteMany();
  await prisma.evidencia.deleteMany();
  await prisma.respuesta.deleteMany();
  await prisma.diagnosticoDominio.deleteMany();
  await prisma.diagnostico.deleteMany();
  await prisma.pregunta.deleteMany();
  await prisma.dominio.deleteMany();
  await prisma.area.deleteMany();
  await prisma.user.deleteMany();
  await prisma.empresa.deleteMany();

  console.log("Sembrando catálogo...");
  const { dominios: nDom, preguntas: nPreg } = await sembrarCatalogo(prisma);
  console.log(`  ${nDom} dominios, ${nPreg} preguntas.`);

  const dominios = await prisma.dominio.findMany({
    orderBy: { orden: "asc" },
    include: { preguntas: { orderBy: { orden: "asc" } } },
  });

  // ── Empresa demo ──
  console.log("Creando empresa demo...");
  const empresa = await prisma.empresa.create({
    data: {
      razonSocial: "Empresa Demo S.A.",
      rut: "76.123.456-7",
      nombreComercial: "Demo",
      industria: "Servicios",
      tamano: "MEDIANA",
      pais: "Chile",
      region: "Metropolitana",
      numColaboradores: 250,
      sitioWeb: "https://demo.cl",
      responsablePrincipal: "María Pérez",
      correoResponsable: "maria.perez@empresademo.cl",
      telefono: "+56 2 2345 6789",
      areas: {
        create: [
          { nombre: "Legal", responsable: "Juan Soto", cargo: "Gerente Legal", participaDiagnostico: true, trataDatos: true, trataDatosSensibles: true, usaSistemas: true },
          { nombre: "TI", responsable: "Ana Díaz", cargo: "Jefa de TI", participaDiagnostico: true, trataDatos: true, trataDatosSensibles: false, usaSistemas: true },
          { nombre: "Recursos Humanos", responsable: "Pedro Rojas", cargo: "Jefe RR.HH.", participaDiagnostico: true, trataDatos: true, trataDatosSensibles: true, usaSistemas: true },
          { nombre: "Comercial", responsable: "Laura Vega", cargo: "Gerente Comercial", participaDiagnostico: true, trataDatos: true, trataDatosSensibles: false, usaSistemas: true },
          { nombre: "Compliance", responsable: "Carla Núñez", cargo: "Oficial de Cumplimiento", participaDiagnostico: true, trataDatos: false, trataDatosSensibles: false, usaSistemas: false },
        ],
      },
    },
  });

  // ── Usuarios (uno por rol) ──
  console.log("Creando usuarios demo...");
  const passwordHash = bcrypt.hashSync("Demo1234", 10);
  const mk = (nombre: string, email: string, role: string, empresaId: string | null, cargo?: string) =>
    prisma.user.create({ data: { nombre, email, passwordHash, role, empresaId, cargo } });

  await mk("Admin Procesos360", "admin@procesos360.cl", "ADMIN_P360", null, "Administrador");
  const consultor = await mk("Consultor Procesos360", "consultor@procesos360.cl", "CONSULTOR", null, "Consultor LPDP");
  await mk("Admin Empresa Demo", "admin@empresademo.cl", "ADMIN_EMPRESA", empresa.id, "Gerente de Operaciones");
  const responsable = await mk("Responsable Dominio", "responsable@empresademo.cl", "RESPONSABLE_DOMINIO", empresa.id, "Analista de Cumplimiento");
  await mk("Alta Dirección", "direccion@empresademo.cl", "ALTA_DIRECCION", empresa.id, "Gerente General");

  // ── Diagnóstico demo (los 10 dominios) ──
  console.log("Creando diagnóstico demo...");
  const diagnostico = await prisma.diagnostico.create({
    data: {
      empresaId: empresa.id,
      nombre: "Diagnóstico LPDP 2026",
      tipo: "COMPLETO",
      estado: "EN_EJECUCION",
      fechaInicio: new Date("2026-01-15"),
      fechaCierre: new Date("2026-03-31"),
      consultorId: consultor.id,
    },
  });

  const areas = await prisma.area.findMany({ where: { empresaId: empresa.id }, orderBy: { nombre: "asc" } });

  for (const d of dominios) {
    const dd = await prisma.diagnosticoDominio.create({
      data: {
        diagnosticoId: diagnostico.id,
        dominioId: d.id,
        areaId: areas.length ? areas[(d.orden - 1) % areas.length].id : null,
        estado: "PENDIENTE",
        participantes: { create: [{ userId: responsable.id }] },
      },
    });
    await prisma.respuesta.createMany({
      data: d.preguntas.map((p) => ({
        diagnosticoDominioId: dd.id,
        preguntaId: p.id,
        estado: "PENDIENTE",
      })),
    });
  }

  // ── Respuestas de ejemplo en Dominio 1 (para mostrar los motores en acción) ──
  console.log("Sembrando respuestas de ejemplo en Dominio 1...");
  const dd1 = await prisma.diagnosticoDominio.findFirstOrThrow({
    where: { diagnosticoId: diagnostico.id, dominio: { orden: 1 } },
  });
  const valoresEjemplo = ["0", "1", "2", "3", "4", "2", "1", "0", "3", "2", "1", "0", "2", "3", "1", "2"];
  const respuestas1 = await prisma.respuesta.findMany({
    where: { diagnosticoDominioId: dd1.id },
    include: { pregunta: true },
    orderBy: { pregunta: { orden: "asc" } },
  });
  for (let i = 0; i < respuestas1.length; i++) {
    const valor = valoresEjemplo[i] ?? "2";
    await prisma.respuesta.update({
      where: { id: respuestas1[i].id },
      data: {
        valor,
        estado: "RESPONDIDA",
        comentario: ["0", "1", "2"].includes(valor) ? "Control no formalizado; en implementación." : null,
        respondidoPorId: responsable.id,
      },
    });
  }
  await prisma.diagnosticoDominio.update({ where: { id: dd1.id }, data: { estado: "EN_EJECUCION" } });

  console.log("\n✅ Seed demo completado (SOLO local). Usuarios (contraseña: Demo1234):");
  console.log("  admin@procesos360.cl · consultor@procesos360.cl · admin@empresademo.cl");
  console.log("  responsable@empresademo.cl · direccion@empresademo.cl");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
