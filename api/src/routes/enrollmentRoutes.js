import express from "express";
import { createEnrollment, checkPaymentStatus, getExistingEnrollment, verifyLogin } from "../controllers/enrollmentController.js";

import prisma from "../db.js";

const router = express.Router();

//CADASTRO
router.post("/register", createEnrollment);

router.get("/existing", getExistingEnrollment);
router.get("/status/:id", checkPaymentStatus)


//LOGIN
router.post("/login", verifyLogin);


export default router; 