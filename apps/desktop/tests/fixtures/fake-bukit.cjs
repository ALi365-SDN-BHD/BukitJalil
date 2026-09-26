#!/usr/bin/env node
// Deterministic failure/cancellation fixture. Real-engine coverage is separate.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const modePath = path.join(__dirname, "engine-mode");
const mode = fs.existsSync(modePath) ? fs.readFileSync(modePath, "utf8") : "";
if (args[0] === "version") {
  console.log("bukit 2.0.0-test");
} else if (args[0] === "build") {
  if (mode === "fail") {
    console.error("synthetic build failure");
    process.exit(7);
  }
  if (mode === "slow") {
    console.log("waiting for cancellation");
    fs.writeFileSync(path.join(__dirname, "build.pid"), String(process.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else {
    const config = fs.readFileSync(option("--config"), "utf8");
    const headline = JSON.parse(/^  title: (.+)$/m.exec(config)[1]);
    const html = headline.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
    fs.mkdirSync(option("--output"), { recursive: true });
    fs.writeFileSync(
      path.join(option("--output"), "index.html"),
      `<html><body><h1>${html}</h1></body></html>`,
    );
    console.log("Fixture build complete");
  }
} else if (args[0] === "preview") {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fs.readFileSync(path.join(option("--dir"), "index.html")));
  });
  server.listen(0, "127.0.0.1", () =>
    console.log(`Preview: http://127.0.0.1:${server.address().port}/`),
  );
} else process.exit(2);
