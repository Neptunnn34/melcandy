export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const segments = pattern.split('/').filter(Boolean);
    routes.push({ method, segments, handler });
  }

  function matchSegments(pattern, actual) {
    if (pattern.length !== actual.length) return null;
    const params = {};
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(actual[i]);
      else if (p !== actual[i]) return null;
    }
    return params;
  }

  async function handle(ctx) {
    const actual = ctx.url.pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== ctx.req.method) continue;
      const params = matchSegments(route.segments, actual);
      if (!params) continue;
      ctx.params = params;
      return route.handler(ctx);
    }
    return undefined;
  }

  return {
    add,
    handle,
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
  };
}
