import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";
const applyChanges = process.argv.includes("--apply");
const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
const scanLimit = limitArg ? Number(limitArg.split("=")[1]) : 1000;

const repairableMojibakePattern = /\u00c3|\u00c4|\u00c6|\u00e1\u00ba|\u00e1\u00bb|\u00e2\u20ac|\ufffd|\u00c2(?=\s|[^\p{L}]|$)/u;
const markerPattern = /\u00c3|\u00c4|\u00c6|\u00e1\u00ba|\u00e1\u00bb|\u00e2\u20ac|\ufffd|\u00c2(?=\s|[^\p{L}]|$)/gu;

const countMarkers = (value: string) => {
  return (value.match(markerPattern) || []).length;
};

const repairText = (value: unknown) => {
  if (typeof value !== "string" || !repairableMojibakePattern.test(value)) {
    return null;
  }

  const repaired = Buffer.from(value, "latin1").toString("utf8");
  if (!repaired || repaired === value || repaired.includes("\uFFFD")) {
    return null;
  }

  if (countMarkers(repaired) >= countMarkers(value)) {
    return null;
  }

  return repaired;
};

const main = async () => {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const notifications = await db.collection("notifications")
    .find({}, { projection: { title: 1, message: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(Number.isFinite(scanLimit) && scanLimit > 0 ? scanLimit : 1000)
    .toArray();

  const candidates = notifications.flatMap((notification) => {
    const updates: Record<string, string> = {};
    const repairedTitle = repairText(notification.title);
    const repairedMessage = repairText(notification.message);

    if (repairedTitle) updates.title = repairedTitle;
    if (repairedMessage) updates.message = repairedMessage;

    return Object.keys(updates).length > 0
      ? [{
          id: notification._id,
          before: {
            title: notification.title,
            message: notification.message
          },
          after: updates
        }]
      : [];
  });

  if (applyChanges && candidates.length > 0) {
    const backupDir = path.resolve(process.cwd(), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `notification-encoding-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    fs.writeFileSync(backupPath, JSON.stringify(candidates, null, 2), "utf8");

    for (const candidate of candidates) {
      await db.collection("notifications").updateOne(
        { _id: candidate.id },
        { $set: candidate.after }
      );
    }

    console.log(JSON.stringify({
      mode: "apply",
      scanned: notifications.length,
      updated: candidates.length,
      backupPath
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      mode: "dry-run",
      scanned: notifications.length,
      repairableCount: candidates.length,
      samples: candidates.slice(0, 10).map(candidate => ({
        id: candidate.id.toString(),
        before: candidate.before,
        after: candidate.after
      })),
      hint: "Run with --apply to update repairable notifications after reviewing the dry-run output."
    }, null, 2));
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to check notification encoding:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
