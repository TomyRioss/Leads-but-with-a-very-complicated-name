// Compila cada ruta en `next dev` una vez, en serie, antes de la suite. En frío y en paralelo,
// la compilación más las llamadas al PocketBase por el túnel superan los timeouts.
const ROUTES = ["/", "/en", "/pricing", "/blog", "/blog/warmup", "/terminos", "/privacidad", "/login", "/register", "/verificar", "/restablecer", "/negocios", "/campanas", "/propuestas", "/leadtita", "/integraciones", "/oauth/authorize", "/no-existe"];

export default async function warmup() {
  for (const route of ROUTES) {
    await fetch(`http://localhost:3100${route}`, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
  }
}
