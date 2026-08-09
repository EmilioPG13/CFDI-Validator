import express from "express";
import { getModelCatalog } from "../../llm/modelCatalog.ts";

export const adminModelsRouter = express.Router();

adminModelsRouter.get("/models", async (_req, res) => {
  const { models, fetchedAt } = await getModelCatalog();
  res.json({ models, fetchedAt });
});

// Force-refresh, wired to the admin console's own "force refresh" button -- the only
// path (besides a cold process start with nothing cached yet) that makes a live NIM call
// for the catalog, per the Phase 5 plan's "never fetch on every page load" requirement.
adminModelsRouter.post("/models/refresh", async (_req, res) => {
  const { models, fetchedAt } = await getModelCatalog(true);
  res.json({ models, fetchedAt });
});
