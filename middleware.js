// Protege TODO el sitio (tablero y /api/data) con usuario y contraseña.
// Se configuran en Vercel: DASHBOARD_USER y DASHBOARD_PASSWORD.
export const config = { matcher: "/:path*" };

export default function middleware(request) {
  const user = process.env.DASHBOARD_USER || "medidas";
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) {
    return new Response("Falta configurar DASHBOARD_PASSWORD en Vercel.", { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(auth.slice(6)).split(":");
      if (u === user && rest.join(":") === pass) return; // sigue al sitio
    } catch {}
  }
  return new Response("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Seguimiento de Medidas", charset="UTF-8"' },
  });
}
