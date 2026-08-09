import { app } from "./app.ts";
import { env } from "./env.ts";

app.listen(env.PORT, () => {
  console.log(`[server] CFDI Risk Auditor backend listening on port ${env.PORT}`);
});
