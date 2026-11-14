import { Router } from "express";
import { publicModelCatalog } from "../lib/models.js";

export const modelsRouter = Router();

modelsRouter.get("/", (_req, res) => {
  res.json({ catalog: publicModelCatalog() });
});
