// server/repairs-router.js — Router de Express para el modo "api" del Panel Admin.
//
// Montaje en tu app:
//   import express from "express";
//   import { repairsRouter } from "./server/repairs-router.js";
//   app.use("/api/tools", express.json(), repairsRouter);
//
// Variable de entorno obligatoria: ADMIN_TOKEN (cualquier texto largo y secreto).
//
// IMPORTANTE: este ejemplo guarda en data/tools.json. Sirve en tu PC o en un
// servidor propio (VPS). En Vercel el sistema de archivos NO es persistente:
// ahí tenés que cambiar readTools/writeTools por tu base de datos
// (Supabase, PostgreSQL, Firebase...).

import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";

const DB_FILE = path.resolve("data", "tools.json");

// --- Persistencia (reemplazá estas dos funciones por tu base de datos) ---
async function readTools() {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return []; // todavía no hay archivo
    throw err;
  }
}

let writeQueue = Promise.resolve(); // evita escrituras simultáneas que pisen el archivo
function writeTools(tools) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(tools, null, 2));
  });
  return writeQueue;
}

// --- Autenticación mínima por token ---
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(500).json({ error: "Falta ADMIN_TOKEN en el servidor." });

  const received = String(req.get("x-admin-token") ?? "");
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

export const repairsRouter = Router();
repairsRouter.use(requireAdmin);

// GET /api/tools → inventario con historial de reparaciones
repairsRouter.get("/", async (_req, res) => {
  try {
    res.json(await readTools());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo leer el inventario." });
  }
});

// POST /api/tools/:id/repairs → registra una reparación
repairsRouter.post("/:id/repairs", async (req, res) => {
  const { date, reason, technician = "", notes = "", markAvailable = true } = req.body ?? {};

  const cleanReason = String(reason ?? "").trim();
  if (!cleanReason || cleanReason.length > 300) {
    return res.status(400).json({ error: "Motivo inválido (obligatorio, hasta 300 caracteres)." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(date))) {
    return res.status(400).json({ error: "Fecha inválida." });
  }

  try {
    const tools = await readTools();
    const tool = tools.find((t) => t.id === req.params.id);
    if (!tool) return res.status(404).json({ error: "La herramienta no existe." });

    tool.repairs = tool.repairs ?? [];
    tool.repairs.push({
      id: randomUUID(),
      date,
      reason: cleanReason,
      technician: String(technician).trim().slice(0, 80),
      notes: String(notes).trim().slice(0, 500),
      createdAt: Date.now(),
    });
    if (markAvailable && tool.status === "maintenance") tool.status = "available";

    await writeTools(tools);
    res.status(201).json(tool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar la reparación." });
  }
});
