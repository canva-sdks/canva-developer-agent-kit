import { Router, type IRouter } from "express";
import healthRouter from "./health";
import canvaRouter from "./canva";

const router: IRouter = Router();

router.use(healthRouter);
router.use(canvaRouter);

export default router;
