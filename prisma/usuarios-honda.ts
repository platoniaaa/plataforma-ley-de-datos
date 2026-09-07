// Usuarios de Honda a partir de la columna "Roles participantes en Honda" del Excel
// "Levantamiento por los 10 dominios de la LPDP - Honda.xlsx": crea un usuario por rol
// (email cargo@honda.cl, rol RESPONSABLE_DOMINIO, pass inicial Demo1234).
//
// La asignación rol↔dominio la hace prisma/participantes-honda.ts: cada dominio tiene
// TODOS los roles que el Excel lista en su fila, sin responsable principal.
//
// Uso: npx tsx prisma/usuarios-honda.ts   (usa DATABASE_URL de .env → producción)

import { readFileSync } from "fs";
import { join } from "path";

// Carga .env sin depender de dotenv (tsx no lo carga solo)
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RUT_HONDA = "96.870.620-9";
const PASSWORD = "Demo1234";

// Roles únicos de la columna del Excel (cargo tal cual aparece → email cargo@honda.cl).
const CARGOS: { cargo: string; email: string }[] = [
  { cargo: "Gerente General", email: "gerentegeneral@honda.cl" },
  { cargo: "Gerente de RR. HH.", email: "gerenterrhh@honda.cl" },
  { cargo: "Gerente de TI", email: "gerenteti@honda.cl" },
  { cargo: "Gerente Legal", email: "gerentelegal@honda.cl" },
  { cargo: "Cumplimiento", email: "cumplimiento@honda.cl" },
  { cargo: "Auditoría Interna", email: "auditoriainterna@honda.cl" },
  { cargo: "Comercial", email: "comercial@honda.cl" },
  { cargo: "Marketing", email: "marketing@honda.cl" },
  { cargo: "Postventa", email: "postventa@honda.cl" },
  { cargo: "RR. HH.", email: "rrhh@honda.cl" },
  { cargo: "Finanzas", email: "finanzas@honda.cl" },
  { cargo: "TI", email: "ti@honda.cl" },
  { cargo: "Atención de Clientes", email: "atencionclientes@honda.cl" },
  { cargo: "Servicio al Cliente", email: "servicioalcliente@honda.cl" },
  { cargo: "Legal", email: "legal@honda.cl" },
  { cargo: "Ciberseguridad", email: "ciberseguridad@honda.cl" },
  { cargo: "Infraestructura", email: "infraestructura@honda.cl" },
  { cargo: "Riesgo Operacional", email: "riesgooperacional@honda.cl" },
  { cargo: "Riesgos", email: "riesgos@honda.cl" },
  { cargo: "Compras", email: "compras@honda.cl" },
  { cargo: "Auditoría", email: "auditoria@honda.cl" },
  { cargo: "Comunicaciones Internas", email: "comunicacionesinternas@honda.cl" },
];

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { rut: RUT_HONDA } });
  if (!empresa) {
    console.error("No existe la empresa Honda. Corre primero prisma/parametrizar-honda.ts.");
    process.exit(1);
  }

  console.log(`Creando ${CARGOS.length} usuarios de Honda...`);
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const idPorEmail = new Map<string, string>();
  let creados = 0;

  for (const { cargo, email } of CARGOS) {
    const existente = await prisma.user.findUnique({ where: { email } });
    if (existente) {
      console.log(`  ya existía: ${email}`);
      idPorEmail.set(email, existente.id);
      continue;
    }
    const user = await prisma.user.create({
      data: {
        nombre: cargo,
        email,
        passwordHash,
        role: "RESPONSABLE_DOMINIO",
        empresaId: empresa.id,
        cargo,
      },
    });
    idPorEmail.set(email, user.id);
    creados++;
    console.log(`  creado: ${email} (${cargo})`);
  }

  console.log(
    `\nListo: ${creados} usuarios nuevos (${CARGOS.length - creados} ya existían). Pass inicial: ${PASSWORD}`
  );
  console.log("Asigna los participantes por dominio con prisma/participantes-honda.ts.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
