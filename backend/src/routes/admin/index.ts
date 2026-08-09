// Every /admin/* route requires a valid session AND role: ADMIN -- mounted here, once,
// so no individual route file can forget the guard. adminAuthz.test.ts is table-driven
// over everything mounted through this router.
import express from "express";
import { requireAuth, requireAdmin } from "../../auth/middleware.ts";
import { adminModelsRouter } from "./models.ts";
import { adminHealthRouter } from "./health.ts";
import { adminSettingsRouter } from "./settings.ts";
import { adminPromptsRouter } from "./prompts.ts";
import { adminJobsRouter } from "./jobs.ts";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);
adminRouter.use(adminModelsRouter);
adminRouter.use(adminHealthRouter);
adminRouter.use(adminSettingsRouter);
adminRouter.use(adminPromptsRouter);
adminRouter.use(adminJobsRouter);
// Sub-phase 5e backend is now complete. ModelCatalog admin panel is frontend-only
// (adminModelsRouter's GET /models + POST /models/refresh already back it) -- remaining
// 5e work is all frontend: the panel itself, plus Job/LlmCall list view UI for the routes
// mounted here.
