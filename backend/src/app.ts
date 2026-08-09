// Configured Express app, no listener started -- imported by server.ts (real process
// entrypoint) and directly importable by route tests later (Sub-phases 5b+) without
// binding a real port.
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.ts";
import { authRouter } from "./auth/routes.ts";
import { adminRouter } from "./routes/admin/index.ts";
import { explainRouter } from "./routes/explain.ts";
import { drainRouter } from "./routes/drain.ts";

export const app = express();

// Render (and most Node hosts) terminate TLS at a proxy -- without this every request
// would report the load balancer's address, same reasoning cv-tailor's own index.js
// documents for why it sets this before anything else.
app.set("trust proxy", 1);

// credentials: true is required because auth uses an httpOnly cookie, not a bearer
// header -- and the Fetch spec forbids a wildcard origin once credentials:true is set,
// hence an explicit allowlist rather than cv-tailor's simpler single-origin `cors()` call
// (which doesn't need credentials since it uses a bearer-token-style Clerk session).
app.use(
  cors({
    // frontend/vite.config.ts pins the dev server to port 3000 (not Vite's own 5173
    // default) -- confirmed by reading that file directly, not assumed, after this
    // mismatch would have silently broken the admin console's cookie-based auth in local
    // dev (a CORS rejection at the browser level, before SameSite/Secure ever matter).
    origin: [env.FRONTEND_URL, "http://localhost:3000"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/api", explainRouter);
app.use("/internal", drainRouter);

// Sub-phase 5e adds prompt versioning + job/cost admin views.
