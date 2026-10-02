import { loadConfig } from "./config.ts";
import { buildServer } from "./server.ts";
import { MemoryStore } from "./store/memory.ts";
import { PostgresStore } from "./store/postgres.ts";
import { buildSinks } from "./telemetry/sinks.ts";

const cfg = loadConfig();
const store = process.env.DATABASE_URL ? new PostgresStore(process.env.DATABASE_URL) : new MemoryStore();
const { app } = await buildServer({ cfg, store, sinks: buildSinks(process.env) });
await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
