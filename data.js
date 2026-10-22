// GET /api/data → dataset compacto del tablero, leído en vivo del Google Sheet.
import zlib from "node:zlib";
import { readColumns } from "../lib/sheets.js";
import { buildPayload, MEDIDAS_COLS, ALERTAS_COLS } from "../lib/transform.js";

const SHEET_ID = process.env.SHEET_ID || "1I7FhXLHmQee1XauhgiMp8eQxRnLcZRDd8OsjHQo92_U";
const HOJA_MEDIDAS = process.env.SHEET_MEDIDAS || "importación 2";
const HOJA_ALERTAS = process.env.SHEET_ALERTAS || "Alertas";
// Cada cuánto se vuelve a leer la planilla (segundos). Entre medio se sirve del cache.
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 300);

export default async function handler(req, res) {
  try {
    const [medidas, alertas] = await Promise.all([
      readColumns(SHEET_ID, HOJA_MEDIDAS, MEDIDAS_COLS.map((c) => c.header)),
      readColumns(SHEET_ID, HOJA_ALERTAS, ALERTAS_COLS.map((c) => c.header)),
    ]);
    const payload = buildPayload(medidas, alertas);
    const body = zlib.gzipSync(JSON.stringify(payload));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Cache-Control", `max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 3}`);
    res.status(200).end(body);
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: err.message });
  }
}
