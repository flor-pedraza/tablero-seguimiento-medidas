// Convierte las columnas crudas del Sheet en un dataset compacto para el tablero.
// Las categorías se codifican como diccionario + códigos (enteros) y las fechas
// como "días desde 1970-01-01" (-1 = vacío). Así viaja liviano al navegador.

// key: nombre corto en el tablero · header: encabezado de la columna en el Sheet
// type: "cat" (categoría con texto), "id" (solo identidad, no se envía el texto), "date"
export const MEDIDAS_COLS = [
  { key: "asm", header: "Nro ASM", type: "id" },
  { key: "fc", header: "Fecha de carga", type: "date" },
  { key: "agente", header: "Agente", type: "cat" },
  { key: "g1", header: "Acc. Gest. 1", type: "cat" },
  { key: "g2", header: "Acc. Gest. 2", type: "cat" },
  { key: "g3", header: "Acc. Gest. 3", type: "cat" },
  { key: "medida", header: "Medida", type: "cat" },
  { key: "estado", header: "Estado", type: "cat" },
  { key: "depCarga", header: "Dependencia de carga", type: "cat" },
  { key: "tipo", header: "Tipo de Medida de Protección", type: "cat" },
  { key: "notif", header: "¿Se notificó?", type: "cat", norm: "notif" },
  { key: "legajo", header: "Legajo Relacionado", type: "cat" },
  { key: "depResp", header: "Dependencia Responsable", type: "cat" },
  { key: "interv", header: "Intervencion ofavyt/edid/annavi/aavpcc", type: "cat" },
  { key: "dest", header: "Nombre destinatario", type: "cat" },
  { key: "doc", header: "Documento del destinatario", type: "id" },
  { key: "caracter", header: "En Carácter De", type: "cat" },
  { key: "genero", header: "Genero", type: "cat", norm: "genero" },
  { key: "estudio", header: "Estudio", type: "cat" },
  { key: "inicio", header: "Inicio de medida", type: "date" },
  { key: "freg", header: "Fecha registro ASM", type: "date" },
  { key: "fiscal", header: "Fiscal / Auxiliar ordenante", type: "cat" },
  { key: "fiscalia", header: "Fiscalía Ordenante", type: "cat" },
  { key: "origen", header: "Origen", type: "cat" },
  { key: "comuna", header: "Comuna", type: "cat", norm: "comuna" },
  { key: "unidad", header: "Unidad Fiscal", type: "cat" },
  { key: "denun", header: "Nombre Denunciado/imputado", type: "cat" },
];

export const ALERTAS_COLS = [
  { key: "asm", header: "ASM", type: "id" },
  { key: "fecha", header: "Fecha", type: "date" },
  { key: "tmedida", header: "Tipo Medida", type: "cat" },
  { key: "talerta", header: "Tipo Alerta", type: "cat" },
  { key: "gestion", header: "Gestión", type: "cat" },
  { key: "agente", header: "Agente", type: "cat" },
  { key: "estadoSM", header: "Estado S/M", type: "cat" },
  { key: "efect", header: "Efectivizada en tablas?", type: "cat" },
];

export const normHeader = (h) =>
  String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Texto limpio; los errores de fórmula de Sheets (#N/A, #REF!, …) cuentan como vacío.
// Se respeta el texto tal cual está en la planilla (igual que COUNTUNIQUE / Looker).
const str = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const t = s.trim();
  if (!t || /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!|NULL!)/i.test(t)) return "";
  return s;
};

const NORMALIZERS = {
  notif(v) {
    const s = str(v).trim().toUpperCase();
    if (!s) return "";
    if (s === "SI" || s === "SÍ") return "SI";
    if (s === "NO") return "NO";
    if (s.startsWith("NOTIF")) return "PENDIENTE";
    if (s === "S/D" || s === "SIN DATOS") return "SIN DATOS";
    return s;
  },
  genero(v) {
    const s = str(v).trim().toUpperCase();
    if (s === "FEMENINO" || s === "MASCULINO") return s;
    return "Otros";
  },
  comuna(v) {
    const s = str(v).trim();
    const m = s.match(/(\d{1,2})/);
    return m && Number(m[1]) >= 1 && Number(m[1]) <= 15 ? `Comuna ${Number(m[1])}` : s;
  },
};

// Sheets (UNFORMATTED_VALUE + SERIAL_NUMBER) devuelve fechas como número serial
// (días desde 1899-12-30). También aceptamos texto dd/mm/aaaa o aaaa-mm-dd.
const SERIAL_EPOCH = 25569;
// Valor para "sin fecha". Las fechas mal cargadas (p. ej. año 205) se conservan
// tal cual, como hace la planilla: el tablero las cuenta pero no las grafica.
export const NA_DATE = -999999;
export function toEpochDay(v) {
  if (v === null || v === undefined || v === "") return NA_DATE;
  let d = NA_DATE;
  if (typeof v === "number") d = Math.floor(v) - SERIAL_EPOCH;
  else if (v instanceof Date) d = Math.floor(v.getTime() / 864e5);
  else {
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) d = Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5);
    else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)))
      d = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
    else if (/^\d+(\.\d+)?$/.test(s)) d = Math.floor(Number(s)) - SERIAL_EPOCH;
  }
  return Number.isFinite(d) && d > NA_DATE ? d : NA_DATE;
}

function encodeColumn(values, spec, n) {
  if (spec.type === "date") {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = toEpochDay(values[i]);
    return out;
  }
  const norm = spec.norm ? NORMALIZERS[spec.norm] : str;
  const index = new Map();
  const dict = [];
  const codes = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = norm(values[i]);
    if (!s) { codes[i] = -1; continue; }
    let c = index.get(s);
    if (c === undefined) { c = dict.length; index.set(s, c); dict.push(s); }
    codes[i] = c;
  }
  // Para columnas "id" no se manda el texto (p. ej. DNI): solo los códigos.
  return spec.type === "id" ? { c: codes } : { d: dict, c: codes };
}

// columns: { [headerNormalizado]: array de valores (fila 2 en adelante) }
// keepRow: función (fila cruda) → bool para descartar filas vacías.
export function encodeTable(columns, specs, requiredKey) {
  const raw = {};
  const missing = [];
  let n = 0;
  for (const spec of specs) {
    const arr = columns[normHeader(spec.header)];
    if (!arr) { missing.push(spec.header); raw[spec.key] = []; continue; }
    raw[spec.key] = arr;
    n = Math.max(n, arr.length);
  }
  // Descartar filas sin el campo obligatorio (p. ej. sin Nro ASM).
  const keep = [];
  // requiredKey null → se conserva toda fila que tenga algún dato.
  for (let i = 0; i < n; i++) {
    if (requiredKey ? str(raw[requiredKey][i]) : specs.some((sp) => str(raw[sp.key][i]))) keep.push(i);
  }
  const out = { n: keep.length, cols: {} };
  for (const spec of specs) {
    const src = raw[spec.key];
    const vals = keep.map((i) => src[i]);
    out.cols[spec.key] = encodeColumn(vals, spec, keep.length);
  }
  return { table: out, missing };
}

export function buildPayload(medidasColumns, alertasColumns, now = new Date()) {
  const m = encodeTable(medidasColumns, MEDIDAS_COLS, null);
  const a = encodeTable(alertasColumns, ALERTAS_COLS, null);
  // "Hoy" en hora de Buenos Aires (UTC-3, sin horario de verano).
  const today = Math.floor((now.getTime() - 3 * 3600e3) / 864e5);
  return {
    naDate: NA_DATE,
    generatedAt: now.toISOString(),
    today,
    medidas: m.table,
    alertas: a.table,
    missing: { medidas: m.missing, alertas: a.missing },
  };
}
