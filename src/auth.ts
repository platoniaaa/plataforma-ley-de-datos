import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/constants";

const credentialsSchema = z.object({
  // El correo se normaliza: los usuarios lo escriben como lo ven en su firma o en la
  // libreta de direcciones, con mayúsculas, y en la práctica es la misma casilla.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.activo) return null;

        const ok = bcrypt.compareSync(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.nombre,
          email: user.email,
          role: user.role as Role,
          empresaId: user.empresaId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.empresaId = user.empresaId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.role = token.role as Role;
      session.user.empresaId = (token.empresaId as string | null) ?? null;
      return session;
    },
  },
});
