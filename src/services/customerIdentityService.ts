import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes
} from "node:crypto";
import { Types } from "mongoose";

import { RestaurantCustomer } from "../models/RestaurantCustomer.js";

export class CustomerIdentityError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VIETNAMESE_MOBILE = /^(3[2-9]|5[25689]|7[06-9]|8[1-689]|9[0-46-9])\d{7}$/;

export function normalizeVietnamesePhone(value?: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const compact = value.replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  const nationalNumber = digits.startsWith("84")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : digits;

  if (!/^\d+$/.test(digits) || !VIETNAMESE_MOBILE.test(nationalNumber)) {
    throw new CustomerIdentityError(400, "Số điện thoại không hợp lệ");
  }

  return `+84${nationalNumber}`;
}

const deriveKey = (secret: string, purpose: string) => {
  if (secret.trim().length < 32) {
    throw new CustomerIdentityError(503, "Chưa cấu hình bảo vệ dữ liệu khách hàng");
  }
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
};

export function protectPhone(normalizedPhone: string, secret: string) {
  const encryptionKey = deriveKey(secret, "customer-phone-encryption");
  const lookupKey = deriveKey(secret, "customer-phone-lookup");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedPhone, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    phoneCiphertext: ["v1", iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join("."),
    phoneLookupHash: createHmac("sha256", lookupKey).update(normalizedPhone).digest("hex"),
    phoneLast4: normalizedPhone.slice(-4)
  };
}

export function revealPhone(ciphertext: string, secret: string): string {
  const [version, ivBase64, authTagBase64, encryptedBase64] = ciphertext.split(".");
  if (version !== "v1" || !ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new CustomerIdentityError(500, "Dữ liệu số điện thoại không hợp lệ");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret, "customer-phone-encryption"),
      Buffer.from(ivBase64, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new CustomerIdentityError(500, "Không thể đọc dữ liệu số điện thoại");
  }
}

export function maskPhone(phone: string): string {
  return `******${phone.slice(-4)}`;
}

interface CustomerIdentityDependencies {
  findCustomerById: (id: unknown) => Promise<any | null>;
  upsertCustomer: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<any | null>;
}

const defaultCustomerIdentityDependencies: CustomerIdentityDependencies = {
  findCustomerById: async (id) => RestaurantCustomer.findById(id).select("+phoneLookupHash"),
  upsertCustomer: async (filter, update) => RestaurantCustomer.findOneAndUpdate(
    filter,
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
};

interface ResolveCustomerForOrderInput {
  restaurantId: string | Types.ObjectId;
  session: any;
  customerName?: string;
  customerPhone?: string;
  marketingConsent?: boolean;
  consentVersion?: string;
  secret?: string;
}

export async function resolveCustomerForOrder(
  input: ResolveCustomerForOrderInput,
  dependencies: CustomerIdentityDependencies = defaultCustomerIdentityDependencies
) {
  const displayName = input.customerName?.trim();
  const normalizedPhone = normalizeVietnamesePhone(input.customerPhone);

  if (!normalizedPhone) {
    if (displayName && input.session.customerName !== displayName) {
      input.session.customerName = displayName;
      await input.session.save();
    }
    const linkedCustomer = input.session.customerId
      ? await dependencies.findCustomerById(input.session.customerId)
      : null;
    return { customer: linkedCustomer, sessionWasLinked: false };
  }

  const protectedPhone = protectPhone(
    normalizedPhone,
    input.secret ?? process.env.CUSTOMER_PII_KEY ?? ""
  );

  if (input.session.customerId) {
    const sessionCustomer = await dependencies.findCustomerById(input.session.customerId);
    if (!sessionCustomer || sessionCustomer.phoneLookupHash !== protectedPhone.phoneLookupHash) {
      throw new CustomerIdentityError(409, "Phiên bàn đã được liên kết với khách hàng khác");
    }
  }

  const now = new Date();
  const consentFields = input.marketingConsent === true
    ? {
        marketingConsent: true,
        consentAt: now,
        consentSource: "QR_CHECKOUT",
        consentVersion: input.consentVersion?.trim() || "crm-v1"
      }
    : {};
  const customer = await dependencies.upsertCustomer(
    {
      restaurantId: input.restaurantId,
      phoneLookupHash: protectedPhone.phoneLookupHash
    },
    {
      $set: {
        phoneCiphertext: protectedPhone.phoneCiphertext,
        phoneLast4: protectedPhone.phoneLast4,
        lastSeenAt: now,
        ...(displayName ? { displayName } : {}),
        ...consentFields
      },
      $setOnInsert: {
        restaurantId: input.restaurantId,
        phoneLookupHash: protectedPhone.phoneLookupHash,
        ...(displayName ? {} : { displayName: `Khách ${protectedPhone.phoneLast4}` }),
        ...(input.marketingConsent === true ? {} : { marketingConsent: false }),
        firstSeenAt: now,
        visitCount: 0,
        orderCount: 0,
        totalSpend: 0
      }
    }
  );

  if (!customer) {
    throw new CustomerIdentityError(500, "Không thể lưu thông tin khách hàng");
  }

  const sessionWasLinked = !input.session.customerId;
  input.session.customerId = customer._id;
  input.session.customerName = displayName || customer.displayName;
  input.session.customerPhone = maskPhone(normalizedPhone);
  await input.session.save();

  return { customer, sessionWasLinked };
}

export async function recordCustomerOrder(
  customerId: unknown,
  totalAmount: number,
  sessionWasLinked: boolean
) {
  await RestaurantCustomer.updateOne(
    { _id: customerId },
    {
      $inc: {
        orderCount: 1,
        totalSpend: Math.max(0, totalAmount),
        visitCount: sessionWasLinked ? 1 : 0
      },
      $set: { lastSeenAt: new Date() }
    }
  );
}
