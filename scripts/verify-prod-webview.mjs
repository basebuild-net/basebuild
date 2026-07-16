#!/usr/bin/env node
// Runtime release guard.
//
// Boots the built app and fails if its webview reaches for the dev server
// (127.0.0.1:1420). A production `tauri build` embeds the frontend and serves
// it over Tauri's custom protocol; only a `tauri dev` build navigates to
// devUrl. Launched without the Vite dev server, such a dev-mode binary shows
// `127.0.0.1 refused to connect` (ERR_CONNECTION_REFUSED) — the exact failure
// users hit from a mis-shipped release. This step catches that artifact before
// it is published.
//
// Detection is one-directional: a connection to :1420 is a hard failure (a dev
// build). No connection is a pass. Nothing in a production build legitimately
// touches :1420 (the provider-login loopback binds an ephemeral 127.0.0.1:0),
// so the signal is clean and this never flakes a good release.
//
// Usage: node scripts/verify-prod-webview.mjs <path-to-exe>
import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: node scripts/verify-prod-webview.mjs <path-to-exe>");
  process.exit(2);
}

const HOST = "127.0.0.1";
const PORT = 1420;
const WINDOW_MS = Number(process.env.PROBE_WINDOW_MS ?? 25000);

let connected = false;
let firstLine = "";

const server = net.createServer((sock) => {
  connected = true;
  let buf = "";
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    if (!firstLine && buf.includes("\r\n")) firstLine = buf.split("\r\n")[0];
    sock.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
  });
  sock.on("error", () => {});
});

function killTree(pid) {
  if (pid == null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

server.on("error", (e) => {
  console.error(`Probe listener failed to bind ${HOST}:${PORT}: ${e.message}`);
  process.exit(2);
});

server.listen(PORT, HOST, () => {
  console.log(`Probe listening on ${HOST}:${PORT}; launching app...`);
  const child = spawn(exe, [], { stdio: "ignore", detached: false });

  const finish = (code) => {
    killTree(child.pid);
    server.close();
    setTimeout(() => process.exit(code), 750);
  };

  child.on("error", (e) => {
    console.error(`Failed to launch app: ${e.message}`);
    finish(2);
  });

  setTimeout(() => {
    if (connected) {
      console.error(
        `FAIL: the app connected to the dev server at ${HOST}:${PORT} ` +
          `(request line: "${firstLine}").\n` +
          "This is a dev-mode (tauri dev) binary — a released build MUST embed " +
          "the frontend. Do NOT ship this artifact; rebuild with `tauri build`.",
      );
      finish(1);
    } else {
      console.log(
        `PASS: no dev-server connection within ${WINDOW_MS}ms — the app serves ` +
          "its embedded frontend over the custom protocol.",
      );
      finish(0);
    }
  }, WINDOW_MS);
});
