import fetch from "node-fetch";

async function runTest() {
  const baseUrl = "http://localhost:5000/api/auth";
  const mockToken = `mock-google-token-johndoe_${Math.floor(1000 + Math.random() * 9000)}`;
  const email = mockToken.replace("mock-google-token-", "") + "@gmail.com";
  const username = mockToken.replace("mock-google-token-", "") + "_owner";
  
  console.log(`\n🚀 Starting Google OAuth flow validation...`);
  console.log(`Generated Mock Token: ${mockToken}`);
  console.log(`Associated Email: ${email}`);
  console.log(`Associated Username: ${username}`);

  // Test 1: Check Email for Non-Existing User
  console.log(`\n1. Checking if email exists for new Google token...`);
  const checkRes = await fetch(`${baseUrl}/google-check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ googleToken: mockToken })
  });
  
  if (!checkRes.ok) {
    const errBody = await checkRes.json().catch(() => null);
    throw new Error(`google-check-email failed: ${checkRes.statusText}. Response: ${JSON.stringify(errBody)}`);
  }
  
  const checkData = await checkRes.json();
  console.log("Response:", checkData);
  if (checkData.exists !== false || checkData.email !== email) {
    throw new Error("Invalid check-email response for non-existing user");
  }
  console.log("✅ Check email for new user works correctly.");

  // Test 2: Register User with Google Token
  console.log(`\n2. Registering new owner using Google token...`);
  const registerRes = await fetch(`${baseUrl}/google-register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      googleToken: mockToken,
      fullName: "John Doe Test",
      email: email,
      phone: "0912345678",
      username: username,
      password: "password123",
      confirmPassword: "password123"
    })
  });

  const registerData = await registerRes.json();
  console.log("Status Code:", registerRes.status);
  console.log("Response:", registerData);
  
  if (registerRes.status !== 201) {
    throw new Error(`google-register failed with status ${registerRes.status}: ${registerData.message}`);
  }
  console.log("✅ Register owner via Google works correctly.");

  // Test 3: Check Email for Existing User
  console.log(`\n3. Re-checking email for now existing Google user...`);
  const checkRes2 = await fetch(`${baseUrl}/google-check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ googleToken: mockToken })
  });
  
  const checkData2 = await checkRes2.json();
  console.log("Response:", checkData2);
  if (checkData2.exists !== true || checkData2.user.email !== email) {
    throw new Error("Invalid check-email response for existing user");
  }
  console.log("✅ Check email detects existing user correctly.");

  // Test 4: Login with Google Token
  console.log(`\n4. Logging in with Google token...`);
  const loginRes = await fetch(`${baseUrl}/google-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ googleToken: mockToken })
  });

  const loginData = await loginRes.json();
  console.log("Status Code:", loginRes.status);
  console.log("Response:", loginData);

  if (!loginRes.ok) {
    throw new Error(`google-login failed: ${loginData.message}`);
  }
  if (!loginData.token) {
    throw new Error("Login did not return JWT token");
  }
  console.log("✅ Login with Google works correctly.");

  console.log(`\n✨ All Google OAuth authentication tests passed successfully! ✨\n`);
}

runTest().catch(err => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
