// backend/app.js (excerpt)
import http from "http";
import express from "express";
import flashRoutes from "./routes/flash.js";
import { attachWsBroker } from "./ws-broker.js";

const app = express();
app.use(express.json());
app.use("/api", flashRoutes);

const server = http.createServer(app);
attachWsBroker({ server, path: "/ws/flash" });

server.listen(process.env.PORT || 8080, () => console.log("Server ready"));
