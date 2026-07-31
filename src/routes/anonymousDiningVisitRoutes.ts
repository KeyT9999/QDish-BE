import { Request, Response, Router } from "express";

import {
  AnonymousDiningVisitServiceError,
  recordAnonymousDiningVisit
} from "../services/anonymousDiningVisitService.js";

type RecordDiningVisit = typeof recordAnonymousDiningVisit;

export const createAnonymousDiningVisitHandler = (
  recordVisit: RecordDiningVisit = recordAnonymousDiningVisit
) => async (req: Request, res: Response) => {
  try {
    const result = await recordVisit({
      restaurantId: req.params.restaurantId,
      tableSessionId: req.body?.tableSessionId,
      visitToken: req.body?.visitToken,
      goals: req.body?.goals,
      dietaryPreferences: req.body?.dietaryPreferences
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof AnonymousDiningVisitServiceError) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    console.error("Failed to record anonymous dining visit", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Không thể ghi nhận lượt khảo sát"
      }
    });
  }
};

const router = Router();

router.post("/:restaurantId/dining-visits", createAnonymousDiningVisitHandler());

export default router;
