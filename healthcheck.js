// Docker HEALTHCHECK probe — not imported by the app (see Dockerfile note).
//
// Deliberately probes a RENDERED page, not /api/health. /api/health is dependency-free
// by design, so it answers 200 while every marketing page 500s on an i18n or
// message-catalog regression — and since nothing declares `depends_on: service_healthy`
// for this service, the only consumer of this probe is the STATUS column a human reads.
// A cheaper probe that proves less is a bad trade there. /en proves the App Router
// served HTML with messages resolved; the 5s timeout was never what a render failed.
const http = require("http");

const req = http.get(
  { host: "127.0.0.1", port: process.env.PORT || 3000, path: "/en", timeout: 4000 },
  (res) => {
    process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1);
  }
);

req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
