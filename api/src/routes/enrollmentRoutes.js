import express from "express";
import { createEnrollment, checkPaymentStatus } from "../controllers/enrollmentController.js";

const router = express.Router();

router.post("/register", createEnrollment);

router.get("/status/:id", checkPaymentStatus)

export default router;