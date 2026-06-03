import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  // 1. Migrate Users
  const users = await User.find({});
  console.log(`Found ${users.length} users to check.`);
  let userUpdatesCount = 0;

  for (const user of users) {
    let updated = false;
    const targetUsername = user.username ? user.username.trim().toLowerCase() : "";
    const targetEmail = user.email ? user.email.trim().toLowerCase() : undefined;

    if (user.username !== targetUsername) {
      user.username = targetUsername;
      updated = true;
    }

    if (user.email && user.email !== targetEmail) {
      user.email = targetEmail;
      updated = true;
    }

    if (updated) {
      try {
        await user.save();
        console.log(`Updated user ID ${user._id} -> username: ${user.username}, email: ${user.email}`);
        userUpdatesCount++;
      } catch (err: any) {
        if (err.code === 11000) {
          console.warn(`[WARNING] Duplicate key error on user ID ${user._id} while trying to convert to lowercase username: ${user.username}. Appending duplicate suffix.`);
          user.username = `${user.username}-dup-${Math.floor(1000 + Math.random() * 9000)}`;
          if (user.email) {
            user.email = `${user.email}-dup-${Math.floor(1000 + Math.random() * 9000)}`;
          }
          await user.save();
          console.log(`[RESOLVED] Saved user ID ${user._id} as username: ${user.username}`);
          userUpdatesCount++;
        } else {
          console.error(`[ERROR] Failed to save user ID ${user._id}:`, err.message);
        }
      }
    }
  }
  console.log(`✅ Successfully updated ${userUpdatesCount} users to lowercase.`);

  // 2. Migrate Restaurants
  const restaurants = await Restaurant.find({});
  console.log(`Found ${restaurants.length} restaurants to check.`);
  let restaurantUpdatesCount = 0;

  for (const rest of restaurants) {
    let updated = false;
    const targetUsername = rest.username ? rest.username.trim().toLowerCase() : "";
    const targetEmail = rest.email ? rest.email.trim().toLowerCase() : "";

    if (rest.username !== targetUsername) {
      rest.username = targetUsername;
      updated = true;
    }

    if (rest.email !== targetEmail) {
      rest.email = targetEmail;
      updated = true;
    }

    if (updated) {
      try {
        await rest.save();
        console.log(`Updated restaurant ID ${rest._id} -> username: ${rest.username}, email: ${rest.email}`);
        restaurantUpdatesCount++;
      } catch (err: any) {
        if (err.code === 11000) {
          console.warn(`[WARNING] Duplicate key error on restaurant ID ${rest._id} while trying to convert to lowercase. Appending duplicate suffix.`);
          rest.username = `${rest.username}-dup-${Math.floor(1000 + Math.random() * 9000)}`;
          if (rest.email) {
            rest.email = `${rest.email}-dup-${Math.floor(1000 + Math.random() * 9000)}`;
          }
          await rest.save();
          console.log(`[RESOLVED] Saved restaurant ID ${rest._id} as username: ${rest.username}`);
          restaurantUpdatesCount++;
        } else {
          console.error(`[ERROR] Failed to save restaurant ID ${rest._id}:`, err.message);
        }
      }
    }
  }
  console.log(`✅ Successfully updated ${restaurantUpdatesCount} restaurants to lowercase.`);

  await mongoose.disconnect();
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
