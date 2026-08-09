// The ONLY way an ADMIN account is ever created in this system -- run out-of-band
// (`npm run prisma:seed`), never reachable via any API route. No public signup path
// exists that can produce role: ADMIN; see the User model in schema.prisma and
// auth/routes.ts's own header comment for why.
import { prisma } from "../src/prismaClient.ts";
import { hashPassword } from "../src/auth/password.ts";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (see backend/.env.example). " +
        "Not read from the shared `env` module deliberately -- these are a one-time " +
        "bootstrap input, not something the running server needs on every boot.",
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] User ${email} already exists (role: ${existing.role}) -- no changes made.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: "ADMIN" },
  });
  console.log(`[seed] Created ADMIN user ${user.email} (id: ${user.id}).`);
}

main()
  .catch((err) => {
    console.error("[seed] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
