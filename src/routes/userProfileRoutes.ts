import { Router } from "express";
import { UserDiningProfile } from "../models/UserDiningProfile.js";

const router = Router();

/**
 * @deprecated Anonymous dining profiles are local-first. Kept temporarily for old clients;
 * Recommendation must not use this route/model as a fallback.
 */
// GET /api/users/profile/:userId - get or create dining profile (guest-safe)
router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "Thiếu userId" });
    }

    let profile = await UserDiningProfile.findOne({ userId });
    if (!profile) {
      profile = await UserDiningProfile.create({
        userId,
        isGuest: true,
        goals: [],
        allergies: [],
        dietaryPreferences: [],
        favoriteAttributes: new Map()
      });
    }

    return res.json(profile);
  } catch (error: any) {
    console.error("Error getting user profile:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải hồ sơ ẩm thực." });
  }
});

/**
 * @deprecated Anonymous dining profiles are local-first. Kept temporarily for old clients;
 * Recommendation must not use this route/model as a fallback.
 */
// PUT /api/users/profile/:userId - update user dining profile preferences
router.put("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { goals, allergies, dietaryPreferences, dailyCalorieTarget } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Thiếu userId" });
    }

    // Compute profile completeness
    let filledFields = 0;
    if (goals && goals.length > 0) filledFields++;
    if (allergies && allergies.length > 0) filledFields++;
    if (dietaryPreferences && dietaryPreferences.length > 0) filledFields++;
    if (dailyCalorieTarget) filledFields++;
    const profileCompleteness = Number((filledFields / 4).toFixed(2));

    const profile = await UserDiningProfile.findOneAndUpdate(
      { userId },
      {
        goals: goals || [],
        allergies: allergies || [],
        dietaryPreferences: dietaryPreferences || [],
        dailyCalorieTarget,
        profileCompleteness
      },
      { new: true, upsert: true }
    );

    return res.json(profile);
  } catch (error: any) {
    console.error("Error updating user profile:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi cập nhật hồ sơ ẩm thực." });
  }
});

/**
 * @deprecated Anonymous dining profiles are local-first. Kept temporarily for old clients;
 * Recommendation must not use this route/model as a fallback.
 */
// POST /api/users/profile/:userId/onboarding - 3-question quick onboarding setup
router.post("/profile/:userId/onboarding", async (req, res) => {
  try {
    const { userId } = req.params;
    const { goals, allergies, dietaryPreferences } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Thiếu userId" });
    }

    // Determine a fun dining personality based on their answers
    let diningPersonality = "Exploring Foodie 🍽️";
    if (goals?.includes("MUSCLE_GAIN")) {
      diningPersonality = "Protein Hunter 💪";
    } else if (dietaryPreferences?.includes("VEGAN") || dietaryPreferences?.includes("VEGETARIAN")) {
      diningPersonality = "Green Plant Eater 🌱";
    } else if (goals?.includes("LIGHT_MEAL")) {
      diningPersonality = "Mindful Eater 🧘";
    } else if (goals?.includes("ENERGY_BOOST")) {
      diningPersonality = "Power Charger ⚡";
    } else if (goals?.includes("COMFORT")) {
      diningPersonality = "Comfort Diner 🫶";
    }

    const profileCompleteness = 0.75; // completed onboarding questions

    const profile = await UserDiningProfile.findOneAndUpdate(
      { userId },
      {
        goals: goals || [],
        allergies: allergies || [],
        dietaryPreferences: dietaryPreferences || [],
        diningPersonality,
        profileCompleteness,
        isGuest: true
      },
      { new: true, upsert: true }
    );

    return res.json(profile);
  } catch (error: any) {
    console.error("Error completing onboarding:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi hoàn tất onboarding." });
  }
});

export default router;
