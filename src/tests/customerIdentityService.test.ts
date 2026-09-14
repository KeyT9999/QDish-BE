import assert from "node:assert/strict";

import {
  CustomerIdentityError,
  maskPhone,
  normalizeVietnamesePhone,
  protectPhone,
  revealPhone
} from "../services/customerIdentityService.js";

const testKey = "unit-test-customer-pii-key-that-is-long-enough";

function testNormalizesEquivalentVietnameseNumbers() {
  const expected = "+84912345678";

  assert.equal(normalizeVietnamesePhone("0912 345 678"), expected);
  assert.equal(normalizeVietnamesePhone("+84 912-345-678"), expected);
  assert.equal(normalizeVietnamesePhone("84912345678"), expected);
  assert.equal(normalizeVietnamesePhone("   "), undefined);
  assert.equal(normalizeVietnamesePhone(undefined), undefined);
}

function testRejectsInvalidPhoneNumbers() {
  assert.throws(
    () => normalizeVietnamesePhone("12345"),
    (error: unknown) => error instanceof CustomerIdentityError && error.statusCode === 400
  );
}

function testProtectsAndRevealsPhoneWithoutPlaintextStorage() {
  const normalized = normalizeVietnamesePhone("0912345678")!;
  const protectedPhone = protectPhone(normalized, testKey);

  assert.equal(protectedPhone.phoneLookupHash.length, 64);
  assert.equal(protectedPhone.phoneLast4, "5678");
  assert.equal(protectedPhone.phoneCiphertext.includes(normalized), false);
  assert.equal(revealPhone(protectedPhone.phoneCiphertext, testKey), normalized);
  assert.equal(maskPhone(normalized), "******5678");
}

function testRejectsWeakPiiKey() {
  assert.throws(
    () => protectPhone("+84912345678", "too-short"),
    (error: unknown) => error instanceof CustomerIdentityError && error.statusCode === 503
  );
}

function run() {
  testNormalizesEquivalentVietnameseNumbers();
  testRejectsInvalidPhoneNumbers();
  testProtectsAndRevealsPhoneWithoutPlaintextStorage();
  testRejectsWeakPiiKey();
  console.log("customer identity service tests passed");
}

run();
