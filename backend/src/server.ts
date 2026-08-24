import { app } from "./app.ts";
import { env } from "./env.ts";
// Fire-and-forget on purpose: a slow or failed NIM catalog fetch must never block or
// crash the server boot -- it can only ever produce a log line, not affect request
// handling. See llm/defaultModelSelfCheck.ts for why this exists (two live incidents).
import { runDefaultModelSelfCheck } from "./llm/defaultModelSelfCheck.ts";

app.listen(env.PORT, () => {
  console.log(`[server] CFDI Risk Auditor backend listening on port ${env.PORT}`);
  void runDefaultModelSelfCheck().catch((err) => {
    console.warn(`[self-check] could not verify model defaults (${err instanceof Error ? err.message : err})`);
  });
});
