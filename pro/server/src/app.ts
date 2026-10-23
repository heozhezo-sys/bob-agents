import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import { config } from "./config.js";
import { one } from "./db/index.js";
import { AppError } from "./lib/errors.js";
import { authRouter } from "./routes/auth.js";
import { agentRouter } from "./routes/agent.js";
import { projectsRouter } from "./routes/projects.js";
import { clipsRouter } from "./routes/clips.js";
import { rendersRouter } from "./routes/renders.js";
import { mediaRouter } from "./routes/media.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path === "/api/health") return;
      const elapsed = Date.now() - started;
      console.log(
        `[http] ${req.method} ${req.path} ${res.statusCode} ${elapsed}ms`,
      );
    });
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "cutroom",
      version: "0.1.0",
      time: new Date().toISOString(),
      ffmpeg: true,
      provider: {
        name: config.agentProvider,
        model: config.openCodeModel,
        configured:
          config.agentProvider === "mock" || Boolean(config.openCodeApiKey),
      },
    });
  });

  app.get("/api/ready", (_req, res) => {
    const row = one<{ ok: number }>("SELECT 1 AS ok");
    res.json({ ok: row?.ok === 1 });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/agent", agentRouter);
  app.use("/api/projects", clipsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/assets", mediaRouter);
  app.use("/api", rendersRouter);

  const clientDist = path.join(config.projectRoot, "client", "dist");
  const indexHtml = path.join(clientDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "API route not found" } });
  });

  app.use((req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: { code: "payload_too_large", message: "The file exceeds the upload limit" },
        });
        return;
      }
      res.status(400).json({ error: { code: "upload_error", message: error.message } });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    console.error(`[error] ${req.method} ${req.path}`, error);
    res.status(500).json({
      error: { code: "internal_error", message: "Something went wrong on the server" },
    });
  });

  return app;
}
