import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  createCheckoutHandler,
  createPaymentStatusHandler,
  createSandboxConfirmHandler,
  createCancelCheckoutHandler,
  createCheckoutDetailsHandler
} from "../routes/subscriptionRoutes.js";
import { PaymentStatus } from "../models/PaymentTransaction.js";
import { SubscriptionStatus, BillingCycle } from "../models/Subscription.js";

const ownerId = "507f1f77bcf86cd799439011";
const freePlanId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439021");
const plusPlanId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439022");
const proPlanId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439023");

function makeResponse() {
  const state: { statusCode: number; body?: any } = { statusCode: 200 };
  return {
    state,
    response: {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(body: unknown) {
        state.body = body;
        return this;
      }
    }
  };
}

async function runTests() {
  console.log("🧪 Starting Subscription Checkout Unit Tests...");

  // Test 1: PayOS errors fail closed instead of creating a fake Sandbox transaction
  {
    const mockPlan = {
      _id: plusPlanId,
      code: "PLUS",
      name: "Gói Plus",
      priceMonthly: 199000,
      priceYearly: 1990000,
      isActive: true
    };

    let createdSub: any = null;
    let createdTx: any = null;

    const handler = createCheckoutHandler({
      Plan: {
        findById: async (id: any) => (id.toString() === plusPlanId.toString() ? mockPlan : null)
      },
      Subscription: {
        create: async (data: any) => {
          createdSub = { _id: new mongoose.Types.ObjectId(), ...data };
          return createdSub;
        }
      },
      PaymentTransaction: {
        create: async (data: any) => {
          createdTx = { _id: new mongoose.Types.ObjectId(), ...data };
          return createdTx;
        }
      },
      getOwnerSubscription: async () => ({ planCode: "FREE" }),
      isUpgrade: () => true,
      createUniqueOrderCode: async () => 123456789,
      // Simulate PayOS throwing error 215
      payOSCreatePayment: async () => {
        const err: any = new Error("Không có gói nào đang hoạt động, vui lòng mua thêm gói hoặc kiểm tra lại.");
        err.code = "215";
        throw err;
      },
      isPayOSConfigured: true,
      appBaseUrl: "http://localhost:5173"
    } as any);

    const res = makeResponse();
    await handler(
      {
        auth: { sub: ownerId },
        body: { planId: plusPlanId.toString(), billingCycle: BillingCycle.MONTHLY }
      } as any,
      res.response as any
    );

    assert.equal(res.state.statusCode, 502, "PayOS checkout errors should return a gateway error");
    assert.equal(res.state.body.code, "PAYOS_CHECKOUT_FAILED");
    assert.equal(createdSub, null, "A pending subscription must not be created without a real PayOS link");
    assert.equal(createdTx, null, "A fake pending payment must not be persisted when PayOS rejects checkout");
    console.log("  ✅ Test 1: PayOS quota error (code 215) fails closed without creating a Sandbox transaction");
  }

  // Test 2: Sandbox payment confirmation activates the subscription
  {
    let activated = false;
    const mockTx = {
      _id: new mongoose.Types.ObjectId(),
      orderCode: 123456789,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      planId: plusPlanId,
      status: PaymentStatus.PENDING,
      amount: 199000,
      paymentLinkId: "sandbox_123456789"
    };

    const confirmHandler = createSandboxConfirmHandler({
      PaymentTransaction: {
        findOne: async ({ orderCode, ownerId: oId }: any) => {
          if (orderCode === 123456789 && oId.toString() === ownerId) return mockTx;
          return null;
        }
      },
      activatePaidSubscription: async (tx: any) => {
        activated = true;
        tx.status = PaymentStatus.PAID;
        return { planCode: "PLUS", status: SubscriptionStatus.ACTIVE };
      }
    } as any);

    const res = makeResponse();
    await confirmHandler(
      {
        auth: { sub: ownerId },
        body: { orderCode: 123456789 }
      } as any,
      res.response as any
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.success, true);
    assert.equal(res.state.body.status, "PAID");
    assert.equal(activated, true, "Subscription should be activated");
    console.log("  ✅ Test 2: Sandbox confirmation activates subscription cleanly");
  }

  // Test 3: Sandbox payment cancellation
  {
    let cancelled = false;
    const mockTx = {
      _id: new mongoose.Types.ObjectId(),
      orderCode: 987654321,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      status: PaymentStatus.PENDING,
      paymentLinkId: "sandbox_987654321"
    };

    const cancelHandler = createCancelCheckoutHandler({
      PaymentTransaction: {
        findOne: async () => mockTx
      },
      cancelPendingPayment: async (tx: any) => {
        cancelled = true;
        tx.status = PaymentStatus.CANCELLED;
      }
    } as any);

    const res = makeResponse();
    await cancelHandler(
      {
        auth: { sub: ownerId },
        body: { orderCode: 987654321 }
      } as any,
      res.response as any
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.success, true);
    assert.equal(cancelled, true, "Transaction should be cancelled");
    console.log("  ✅ Test 3: Sandbox cancellation works cleanly");
  }

  // Test 4: Payment status check for Sandbox transaction returns PENDING/PAID without calling external PayOS
  {
    let payOSCalled = false;
    const mockTx = {
      orderCode: 123456789,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      status: PaymentStatus.PENDING,
      paymentLinkId: "sandbox_123456789",
      payosRawResponse: { mode: "SANDBOX_FALLBACK" }
    };

    const statusHandler = createPaymentStatusHandler({
      PaymentTransaction: {
        findOne: async () => mockTx
      },
      payOSGetPayment: async () => {
        payOSCalled = true;
        return { status: "PAID" };
      },
      activatePaidSubscription: async () => {},
      cancelPendingPayment: async () => {}
    } as any);

    const res = makeResponse();
    await statusHandler(
      {
        auth: { sub: ownerId },
        query: { orderCode: "123456789" }
      } as any,
      res.response as any
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.isSandbox, true);
    assert.equal(payOSCalled, false, "PayOS API should NOT be called for Sandbox transactions");
    console.log("  ✅ Test 4: Payment status check handles Sandbox transactions without external API errors");
  }

  console.log("🎉 All Subscription Checkout Tests Passed!");
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
