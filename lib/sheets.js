// Lectura de Google Sheets con la cuenta de servicio, sin dependencias externas.
import crypto from "node:crypto";
import { normHeader } from "./transform.js";

function credentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const j = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return { email: j.client_email, key: j.private_key };
  }
  return {
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60e3) return cachedToken.value;
  const { email, key } = credentials();
  if (!email || !key) throw new Error("Faltan las credenciales de la cuenta de servicio (variables de entorno).");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Error autenticando con Google: ${data.error_description || data.error}`);
  cachedToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function batchGet(sheetId, ranges, majorDimension) {
  const token = await getAccessToken();
  const qs = new URLSearchParams({
    majorDimension,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const r of ranges) qs.append("ranges", r);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || res.statusText;
    if (res.status === 403) throw new Error(`Sin permiso para leer la planilla. ¿La compartiste con la cuenta de servicio? (${msg})`);
    throw new Error(`Error leyendo la planilla: ${msg}`);
  }
  return data.valueRanges || [];
}

const colLetter = (i) => {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const quote = (name) => `'${name.replace(/'/g, "''")}'`;

// Lee solo las columnas pedidas (por nombre de encabezado) de una hoja.
// Devuelve { [encabezadoNormalizado]: valores desde la fila 2 }.
export async function readColumns(sheetId, sheetName, headers) {
  const [head] = await batchGet(sheetId, [`${quote(sheetName)}!1:1`], "ROWS");
  const row = head?.values?.[0] || [];
  const pos = new Map();
  row.forEach((h, i) => {
    const k = normHeader(h);
    if (k && !pos.has(k)) pos.set(k, i);
  });
  const wanted = [...new Set(headers.map(normHeader))].filter((k) => pos.has(k));
  const ranges = wanted.map((k) => {
    const L = colLetter(pos.get(k));
    return `${quote(sheetName)}!${L}2:${L}`;
  });
  const out = {};
  if (!ranges.length) return out;
  const vr = await batchGet(sheetId, ranges, "COLUMNS");
  wanted.forEach((k, i) => { out[k] = vr[i]?.values?.[0] || []; });
  return out;
}
