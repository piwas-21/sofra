// Docker HEALTHCHECK probe — not imported by the app (see Dockerfile note).
const http = require("http");

// /api/health, not a rendered page: it is dependency-free and does no message loading, so
// a container is judged unhealthy for being genuinely unable to serve rather than for a
// slow marketing render. It also answers before locale routing exists.
const req = http.get(
  { host: "127.0.0.1", port: process.env.PORT || 3000, path: "/api/health", timeout: 4000 },
  (res) => {
    process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1);
  }
);

req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
