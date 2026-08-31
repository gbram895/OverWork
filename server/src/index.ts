import express from "express";
import cors from "cors";
import { overtimeRouter } from "./routes/overtime.js";
import "./db.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());

app.use("/api/overtime", overtimeRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`OverWork server listening on http://localhost:${PORT}`);
});
