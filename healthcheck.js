// Docker HEALTHCHECK probe — not imported by the app (see Dockerfile note).
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
