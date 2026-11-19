// bcw-site: serves the static build (dist/) from Workers Static Assets and
// forwards data routes to the bcw-data Worker over a service binding, so the
// page and its data share one origin (no CORS) and the data Worker needs no
// public route of its own.

const DATA_ROUTES = /^\/(snapshot|forecast|admin)(\/|$)/;

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (DATA_ROUTES.test(pathname)) return env.DATA.fetch(req);
    return env.ASSETS.fetch(req);
  },
};
