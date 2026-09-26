import { emitTableSessionClosed, emitTableStatusUpdated } from "../realtime/socket.js";
import { expireIdleTableSessions } from "./tableSessionExpiryService.js";

const CLEANUP_INTERVAL_MS = 60 * 1000;

let workerRunning = false;

export function initTableSessionExpiryWorker() {
  const runOnce = async () => {
    if (workerRunning) return;
    workerRunning = true;

    try {
      const result = await expireIdleTableSessions({}, ({ session, table }) => {
        const restaurantId = String(session.restaurantId);
        emitTableSessionClosed(restaurantId, session.toJSON ? session.toJSON() : session);

        if (table) {
          emitTableStatusUpdated(restaurantId, {
            tableId: table._id,
            code: table.code,
            status: table.status,
            activeSessionId: table.activeSessionId,
            currentSessionCode: table.currentSessionCode
          });
        }
      });

      if (result.expiredCount > 0) {
        console.info(`[TableSessionExpiry] Released ${result.expiredCount} scan-only session(s)`);
      }
    } catch (error) {
      console.error("[TableSessionExpiry] Cleanup failed", error);
    } finally {
      workerRunning = false;
    }
  };

  const interval = setInterval(() => { void runOnce(); }, CLEANUP_INTERVAL_MS);
  interval.unref();

  const startupCheck = setTimeout(() => { void runOnce(); }, 10_000);
  startupCheck.unref();

  console.log("[TableSessionExpiry] Worker initialized — runs every minute");
  return () => {
    clearInterval(interval);
    clearTimeout(startupCheck);
  };
}
