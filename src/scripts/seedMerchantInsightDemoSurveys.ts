import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AnonymousDiningVisit } from "../models/AnonymousDiningVisit.js";
import { Bill } from "../models/Bill.js";
import { MerchantInsightDemoSurvey } from "../models/MerchantInsightDemoSurvey.js";
import { Order, OrderStatus } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { assertKurumiSeedTarget } from "./kurumiMenuSeedData.js";
import {
  assertDemoSurveySeedTarget,
  buildDemoSurveySeedPlan,
  DEMO_SURVEY_ACCOUNT,
  DEMO_SURVEY_BATCH_ID,
  DEMO_SURVEY_RESTAURANT,
  DEMO_SURVEY_TARGET_COUNT,
  getDemoSurveySeedConnectionOptions,
  parseDemoSurveySeedOptions,
  type DemoSurveySeedOptions
} from "./merchantInsightDemoSeedData.js";

let activeStage = "argument validation";

function fail(message: string): never {
  throw new Error(message);
}

function printHelp(): void {
  console.log([
    "Seed isolated, clearly labeled QDish Intelligence demo surveys for one approved account.",
    "No orders, bills, payments, customer identities, or table sessions are created.",
    "",
    "Usage:",
    "  npm run seed:merchant-insight-demo -- --username anvatcuti2",
    "  npm run seed:merchant-insight-demo -- --username anvatcuti2 --apply --confirm-db QDish --confirm-host <configured-host>",
    "  npm run seed:merchant-insight-demo -- --username anvatcuti2 --apply --cleanup --confirm-db QDish --confirm-host <configured-host>",
    "",
    "Dry-run is the default. Apply and cleanup require the exact account, database, and host confirmation."
  ].join("\n"));
}

async function findTargetRestaurant(username: string) {
  const users = await User.find({ username })
    .select("_id username role restaurantId isActive")
    .lean();
  if (users.length !== 1) fail("Expected exactly one account matching --username");

  const user = users[0];
  if (user.username !== DEMO_SURVEY_ACCOUNT || !user.restaurantId) {
    fail("The approved account is not linked to a restaurant");
  }
  if (![UserRole.RESTAURANT_ADMIN, UserRole.RESTAURANT_OWNER].includes(user.role as UserRole)) {
    fail("The approved account is not a restaurant owner/admin");
  }
  if (user.isActive === false) fail("The approved account is inactive");

  const restaurants = await Restaurant.find({
    _id: user.restaurantId,
    username,
    name: DEMO_SURVEY_RESTAURANT
  }).select("_id username name status active archivedAt").lean();
  if (restaurants.length !== 1) {
    fail("The account must link to exactly one restaurant matching the approved restaurant name");
  }

  const restaurant = restaurants[0];
  assertDemoSurveySeedTarget(user.username, restaurant.name);
  if (restaurant.status !== "ACTIVE" || restaurant.active === false || restaurant.archivedAt) {
    fail("The approved restaurant is not active");
  }

  return { user, restaurant };
}

async function readSeedState(restaurantId: Types.ObjectId) {
  const [
    realSurveyCount,
    totalDemoSurveyCount,
    batchRows,
    totalOrderCount,
    completedOrderCount,
    billCount
  ] = await Promise.all([
    AnonymousDiningVisit.countDocuments({ restaurantId }),
    MerchantInsightDemoSurvey.countDocuments({ restaurantId }),
    MerchantInsightDemoSurvey.find({ restaurantId, batchId: DEMO_SURVEY_BATCH_ID })
      .select("responseKey")
      .lean(),
    Order.countDocuments({ restaurantId }),
    Order.countDocuments({
      restaurantId,
      status: { $in: [OrderStatus.SERVED, OrderStatus.COMPLETED] }
    }),
    Bill.countDocuments({ restaurantId })
  ]);

  return {
    realSurveyCount,
    totalDemoSurveyCount,
    existingResponseKeys: batchRows.map((row) => row.responseKey),
    totalOrderCount,
    completedOrderCount,
    billCount
  };
}

function printDryRun(
  account: string,
  restaurant: string,
  database: string,
  host: string,
  state: Awaited<ReturnType<typeof readSeedState>>,
  toInsertCount: number,
  totalAfterApply: number
): void {
  console.log("QDish Intelligence demo survey seed — DRY RUN (no database writes)");
  console.log(`Account verified: ${account}`);
  console.log(`Restaurant verified: ${restaurant}`);
  console.log(`Database/host verified: ${database} @ ${host}`);
  console.log(`Real survey responses: ${state.realSurveyCount}`);
  console.log(`Existing demo survey responses: ${state.totalDemoSurveyCount}`);
  console.log(`Orders already served/completed (dashboard threshold): ${state.completedOrderCount}`);
  console.log(`All restaurant order documents preserved: ${state.totalOrderCount}`);
  console.log(`Restaurant bills preserved: ${state.billCount}`);
  console.log(`Demo batch: ${DEMO_SURVEY_BATCH_ID}`);
  console.log(`Demo survey responses to insert: ${toInsertCount}`);
  console.log(`Combined responses after apply: ${totalAfterApply}/${DEMO_SURVEY_TARGET_COUNT}`);
  console.log("Operational orders, bills, payment records, menu items, and customer identities to create: 0");
  console.log(`To apply, rerun with --apply --confirm-db QDish --confirm-host ${host}.`);
}

async function revalidateTarget(username: string, userId: Types.ObjectId, restaurantId: Types.ObjectId): Promise<void> {
  const { user, restaurant } = await findTargetRestaurant(username);
  if (!user._id.equals(userId) || !restaurant._id.equals(restaurantId)) {
    fail("Approved account-to-restaurant link changed after preflight; stopped");
  }
}

async function applySeed(
  restaurantId: Types.ObjectId,
  state: Awaited<ReturnType<typeof readSeedState>>,
  options: DemoSurveySeedOptions
): Promise<void> {
  if (options.cleanup) {
    const removed = await MerchantInsightDemoSurvey.deleteMany({
      restaurantId,
      batchId: DEMO_SURVEY_BATCH_ID,
      source: "DEMO_SEED"
    });
    console.log(`Removed ${removed.deletedCount} demo survey records from batch ${DEMO_SURVEY_BATCH_ID}.`);
    return;
  }

  const plan = buildDemoSurveySeedPlan(
    state.realSurveyCount,
    state.totalDemoSurveyCount,
    state.existingResponseKeys
  );

  if (plan.toInsert.length === 0) {
    console.log("No demo survey responses need to be inserted; no indexes or records were changed.");
    return;
  }

  activeStage = "creating indexes for the approved demo survey collection";
  await MerchantInsightDemoSurvey.createIndexes();

  for (const profile of plan.toInsert) {
    await MerchantInsightDemoSurvey.updateOne(
      {
        restaurantId,
        batchId: profile.batchId,
        responseKey: profile.responseKey
      },
      {
        $setOnInsert: {
          restaurantId,
          ...profile
        }
      },
      { upsert: true, runValidators: true }
    );
  }

  const after = await readSeedState(restaurantId);
  if (after.totalOrderCount !== state.totalOrderCount || after.billCount !== state.billCount) {
    fail("Order or bill counts changed during seed; review concurrent restaurant activity");
  }
  if (after.realSurveyCount !== state.realSurveyCount) {
    fail("Real survey count changed during seed; review concurrent survey activity");
  }
  if (after.realSurveyCount + after.totalDemoSurveyCount < DEMO_SURVEY_TARGET_COUNT) {
    fail("Post-seed survey count is below the approved dashboard threshold");
  }

  console.log("QDish Intelligence demo survey seed applied and verified.");
  console.log(`Real survey responses preserved: ${after.realSurveyCount}`);
  console.log(`Demo survey responses now available: ${after.totalDemoSurveyCount}`);
  console.log(`Combined responses: ${after.realSurveyCount + after.totalDemoSurveyCount}`);
  console.log(`Orders already served/completed: ${after.completedOrderCount}`);
  console.log(`All restaurant order documents preserved: ${after.totalOrderCount}`);
  console.log(`Restaurant bills preserved: ${after.billCount}`);
  console.log(`Batch: ${DEMO_SURVEY_BATCH_ID}; inserted at most ${plan.toInsert.length} stable response keys.`);
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  activeStage = "argument validation";
  const options = parseDemoSurveySeedOptions(args);
  if (options.help) {
    printHelp();
    return;
  }

  activeStage = "approved MongoDB target validation";
  const uri = process.env.MONGODB_URI;
  if (!uri) fail("MONGODB_URI must point to the approved QDish Atlas database");
  const target = assertKurumiSeedTarget(uri, options);

  try {
    activeStage = "MongoDB connection";
    await mongoose.connect(uri, getDemoSurveySeedConnectionOptions());
    activeStage = "connected database verification";
    if (mongoose.connection.name !== "QDish") {
      fail("Connected database does not match the approved QDish target");
    }

    activeStage = "account and restaurant matching";
    const username = DEMO_SURVEY_ACCOUNT;
    const { user, restaurant } = await findTargetRestaurant(username);
    activeStage = "read-only preflight";
    const state = await readSeedState(restaurant._id);
    const plan = buildDemoSurveySeedPlan(
      state.realSurveyCount,
      state.totalDemoSurveyCount,
      state.existingResponseKeys
    );

    if (!options.apply) {
      printDryRun(
        username,
        restaurant.name,
        mongoose.connection.name,
        target.hostname,
        state,
        plan.toInsert.length,
        plan.totalAfterApply
      );
      return;
    }

    activeStage = options.cleanup ? "revalidating approved cleanup target" : "revalidating approved seed target";
    if (target.hostname !== options.confirmHost) fail("MongoDB host confirmation changed; stopped");
    await revalidateTarget(username, user._id, restaurant._id);

    activeStage = options.cleanup ? "deleting confirmed demo batch" : "inserting confirmed demo survey batch";
    await applySeed(restaurant._id, state, options);
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    console.error(`QDish Intelligence demo seed stopped during ${activeStage}. Database details were suppressed; verify the target and rerun its dry-run.`);
    process.exitCode = 1;
  });
}
