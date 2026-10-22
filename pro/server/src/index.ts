import { config, ensureDataDirs } from "./config.js";
import { closeDb, initDb } from "./db/index.js";
import { ensureOwnerAccount } from "./lib/auth.js";
import { createApp } from "./app.js";

function main(): void {
  ensureDataDirs();
  initDb();
  ensureOwnerAccount((message) => console.log(message));

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`[cutroom] listening on http://${config.host}:${config.port}`);
    console.log(`[cutroom] data directory: ${config.dataDir}`);
    console.log(
      `[cutroom] model provider: ${config.openCodeApiKey ? "configured" : "not configured (agent uses rule-based commands)"}`,
    );
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
