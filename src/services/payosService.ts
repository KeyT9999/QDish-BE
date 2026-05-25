import { PayOS } from "@payos/node";

const clientId = process.env.PAYOS_CLIENT_ID;
const apiKey = process.env.PAYOS_API_KEY;
const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

export const isPayOSConfigured = Boolean(clientId && apiKey && checksumKey);

if (!clientId || !apiKey || !checksumKey) {
  console.warn("⚠️ Warning: PayOS environment variables are not fully configured!");
}

// Initialize PayOS instance
const payOS = new PayOS({
  clientId: clientId || "mock-client-id",
  apiKey: apiKey || "mock-api-key",
  checksumKey: checksumKey || "mock-checksum-key"
});

export default payOS;
