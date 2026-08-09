// Single PrismaClient instance for the whole process. Built eagerly (not lazily like
// llm/nimProvider.ts's OpenAI client) because DATABASE_URL is already guaranteed present
// by the time this module evaluates -- env.ts's `required()` throws at import time, and
// every entrypoint (server.ts, prisma/seed.ts) imports env before this file.
import { PrismaClient } from "@prisma/client";
import "./env.ts";

export const prisma = new PrismaClient();
