import "dotenv/config";
import bcrypt from "bcryptjs";

import { connectDB } from "../config/db.js";
import { User, UserRole } from "../models/User.js";

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error("Usage: npm run seed:super-admin -- <username> <password>");
  process.exit(1);
}

const run = async () => {
  await connectDB();

  const existing = await User.findOne({ username });
  if (existing) {
    console.log("User already exists");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await User.create({
    username,
    passwordHash,
    role: UserRole.SUPER_ADMIN
  });

  console.log(`Created super admin ${username}`);
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

