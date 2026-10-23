import { config, ensureDataDirs } from "./config.js";
import { closeDb, initDb } from "./db/index.js";
import { ensureOwnerAccount } from "./lib/auth.js";
import { createApp } from "./app.js";
import { recoverRenderJobs } from "./services/renderService.js";

function main(): void {
  ensureDataDirs();
  initDb();
  ensureOwnerAccount((message) => console.log(message));
  recoverRenderJobs();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`[cutroom] listening on http://${config.host}:${config.port}`);
    console.log(`[cutroom] data directory: ${config.dataDir}`);
    console.log(
      `[cutroom] model provider: ${config.openCodeApiKey ? "configured" : "not configured (agent chat returns 503)"}`,
    );
    console.log(`[cutroom] agent provider: ${config.agentProvider}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[cutroom] ${signal} received, shutting down`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
