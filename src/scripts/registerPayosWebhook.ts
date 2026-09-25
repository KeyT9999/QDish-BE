import "dotenv/config";
import payOS, { isPayOSConfigured } from "../services/payosService.js";

const webhookUrl = process.env.PAYOS_WEBHOOK_URL?.trim();

const fail = (message: string) => {
  console.error(message);
  process.exitCode = 1;
};

if (!isPayOSConfigured) {
  fail("PayOS chưa được cấu hình đầy đủ. Hãy kiểm tra các biến PAYOS_* trong .env của BE.");
} else if (!webhookUrl) {
  fail("Thiếu PAYOS_WEBHOOK_URL. Hãy đặt URL HTTPS public trỏ tới /api/payments/payos-webhook.");
} else {
  try {
    const parsedUrl = new URL(webhookUrl);
    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLocalHost = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "127.0.0.1"
      || hostname === "0.0.0.0"
      || hostname === "::1";

    if (
      parsedUrl.protocol !== "https:" ||
      isLocalHost ||
      pathname !== "/api/payments/payos-webhook" ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      fail("PAYOS_WEBHOOK_URL phải là HTTPS public, không có query/hash và có path /api/payments/payos-webhook.");
    } else {
      try {
        await payOS.webhooks.confirm(webhookUrl);
        console.log(`Đã đăng ký webhook PayOS: ${parsedUrl.origin}${pathname}`);
      } catch {
        fail("Không đăng ký được webhook với PayOS. Hãy kiểm tra URL có truy cập công khai và BE đang nhận callback.");
      }
    }
  } catch {
    fail("PAYOS_WEBHOOK_URL không phải URL hợp lệ.");
  }
}
