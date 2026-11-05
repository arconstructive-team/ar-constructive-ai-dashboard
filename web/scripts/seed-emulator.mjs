// Creates the local test user on the Firebase Auth emulator (run `pnpm emulators` first).
// The emulator is local only (project demo-arconstructive), so this account never exists on the live site.
// firestore.rules only lets the two team emails in, so the test user signs in with a team email.
//
//   TEST_USER_EMAIL=...  TEST_USER_PASSWORD=...  pnpm seed:emulator
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const email = process.env.TEST_USER_EMAIL ?? "rdghoorchian@gmail.com";
const password = process.env.TEST_USER_PASSWORD ?? "emulator-only-password";
const base = `http://${host}/identitytoolkit.googleapis.com/v1/accounts`;

const res = await fetch(`${base}:signUp?key=demo-key`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, displayName: "Test user", returnSecureToken: true }),
}).catch((error) => {
  console.error(`Cannot reach the Auth emulator at ${host}. Start it with \`pnpm emulators\`.`);
  throw error;
});
const body = await res.json();

if (res.ok) {
  console.log(`Created test user ${email} (password: ${password}) on the Auth emulator.`);
} else if (body?.error?.message === "EMAIL_EXISTS") {
  console.log(`Test user ${email} already exists on the Auth emulator.`);
} else {
  console.error("Could not create the test user:", body?.error?.message ?? res.status);
  process.exit(1);
}
