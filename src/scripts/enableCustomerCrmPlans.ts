import "dotenv/config";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";

async function run() {
  await connectDB();

  const [freeResult, paidResult] = await Promise.all([
    Plan.updateMany(
      { code: "FREE" },
      { $set: { customerCrmEnabled: false } }
    ),
    Plan.updateMany(
      { code: { $in: ["PLUS", "PRO"] } },
      { $set: { customerCrmEnabled: true } }
    )
  ]);

  console.log(
    `Customer CRM entitlement updated: FREE=${freeResult.modifiedCount}, PLUS/PRO=${paidResult.modifiedCount}`
  );
  process.exit(0);
}

run().catch((error) => {
  console.error("Customer CRM entitlement migration failed", error);
  process.exit(1);
});
