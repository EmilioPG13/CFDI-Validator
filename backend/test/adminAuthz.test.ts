// Table-driven over every route mounted under /admin (routes/admin/index.ts). No live DB
// needed: requireAuth/requireAdmin (auth/middleware.ts) reject before either route
// handler ever touches Prisma, so a 401/403 assertion doesn't depend on DATABASE_URL
// pointing at a real database -- only the deeper route logic would.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { app } from "../src/app.ts";
import { signAuthToken } from "../src/auth/jwt.ts";
import { COOKIE_NAME } from "../src/auth/middleware.ts";

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

const ADMIN_ROUTES: { method: "GET" | "POST" | "PUT" | "DELETE"; path: string }[] = [
  { method: "GET", path: "/admin/models" },
  { method: "POST", path: "/admin/models/refresh" },
  { method: "POST", path: "/admin/health-check" },
  { method: "GET", path: "/admin/settings/model.explainer" },
  { method: "PUT", path: "/admin/settings/model.explainer" },
  { method: "DELETE", path: "/admin/settings/model.explainer" },
  { method: "GET", path: "/admin/prompts" },
  { method: "GET", path: "/admin/prompts/explainer.system" },
  { method: "POST", path: "/admin/prompts/explainer.system" },
  { method: "POST", path: "/admin/prompts/nonexistent-id/activate" },
  { method: "DELETE", path: "/admin/prompts/nonexistent-id" },
  { method: "GET", path: "/admin/jobs" },
  { method: "GET", path: "/admin/jobs/nonexistent-id" },
  { method: "GET", path: "/admin/llm-calls" },
  { method: "GET", path: "/admin/llm-calls/totals" },
];

function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}`;
}

for (const route of ADMIN_ROUTES) {
  test(`${route.method} ${route.path}: unauthenticated -> 401`, async () => {
    const res = await fetch(`${baseUrl}${route.path}`, { method: route.method });
    assert.equal(res.status, 401);
  });

  test(`${route.method} ${route.path}: authenticated as USER -> 403`, async () => {
    const token = signAuthToken({ userId: "user-1", role: "USER" });
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { cookie: cookieHeader(token) },
    });
    assert.equal(res.status, 403);
  });

  test(`${route.method} ${route.path}: authenticated as ADMIN -> passes authz (not 401/403)`, async () => {
    const token = signAuthToken({ userId: "admin-1", role: "ADMIN" });
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { cookie: cookieHeader(token) },
    });
    // Deliberately not asserting 200 here -- without a real DATABASE_URL the route
    // handler itself may still fail (500). What this test guards is the AUTHZ gate
    // specifically: an ADMIN must never be rejected by requireAuth/requireAdmin.
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });
}

test("a garbage cookie value is treated as unauthenticated, not a 500", async () => {
  const res = await fetch(`${baseUrl}/admin/models`, {
    headers: { cookie: `${COOKIE_NAME}=not-a-real-jwt` },
  });
  assert.equal(res.status, 401);
});
