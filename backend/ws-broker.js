// backend/ws-broker.js
import { WebSocketServer } from "ws";
import { parse } from "url";

export function attachWsBroker({ server, path = "/ws/flash" }) {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Map(); // id -> { browser?: ws, python?: ws }

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url, true);
    if (!pathname?.startsWith(path + "/")) return;
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    );
  });

  wss.on("connection", (ws, req) => {
    const { query, pathname } = parse(req.url, true);
    const id = pathname.split("/").pop();
    const role = query.role === "python" ? "python" : "browser";
    if (!id) return ws.close(1008, "missing id");

    const s = sessions.get(id) || {};
    s[role] = ws;
    sessions.set(id, s);

    const peerRole = role === "browser" ? "python" : "browser";

    ws.on("message", (data) => {
      const p = sessions.get(id);
      const peer = p?.[peerRole];
      if (peer && peer.readyState === 1) peer.send(data);
    });

    ws.on("close", () => {
      const p = sessions.get(id);
      if (!p) return;
      p[role] = undefined;
      if (!p.browser && !p.python) sessions.delete(id);
    });
  });

  return wss;
}
