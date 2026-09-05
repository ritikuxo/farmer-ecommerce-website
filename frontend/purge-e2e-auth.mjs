// ============================================================
//  E2E TEST-USER AUTH CLEANUP
//  Deletes the Firebase Authentication accounts of the E2E
//  test users (emails starting with "e2e.") that were created
//  by the old e2e-order-flow test script.
//
//  A web client can only delete the account it is signed in
//  as, so this runs in Node: it signs in as each E2E account
//  and deletes it. The profile documents are deleted from the
//  Admin Dashboard ("Purge E2E test users" button).
//
//  Usage (from the frontend folder):
//    1. Put e2e-emails.txt (one email per line — downloaded by
//       the Admin Dashboard purge) next to this script, or pass
//       emails as arguments:
//         node purge-e2e-auth.mjs e2e.consumer.123@efarmtest.com ...
//    2. node purge-e2e-auth.mjs
// ============================================================

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
} from "firebase/auth";

// The E2E test scripts used fixed passwords — try each one.
const KNOWN_PASSWORDS = ["test123", "diag123"];

const app = initializeApp({
  apiKey: "AIzaSyDeIZxypW3lvmIAVRfehuQNh9Gq68yx-uY",
  authDomain: "e-farm-83698.firebaseapp.com",
  projectId: "e-farm-83698",
  storageBucket: "e-farm-83698.firebasestorage.app",
  messagingSenderId: "1049244418178",
  appId: "1:1049244418178:web:cada219be9a114c0a3f49b",
});
const auth = getAuth(app);

let emails = process.argv.slice(2);

if (emails.length === 0) {
  const listFile = fileURLToPath(new URL("./e2e-emails.txt", import.meta.url));
  if (existsSync(listFile)) {
    emails = readFileSync(listFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.toLowerCase().startsWith("e2e."));
  }
}

if (emails.length === 0) {
  console.log(
    "No E2E emails found.\n" +
      "Download e2e-emails.txt via the Admin Dashboard purge button,\n" +
      "place it next to this script, or pass emails as arguments."
  );
  process.exit(0);
}

console.log(`Purging ${emails.length} E2E auth account(s)...\n`);

let deleted = 0;
let unknown = 0;
let failed = 0;

for (const email of emails) {
  try {
    let user = null;

    for (const password of KNOWN_PASSWORDS) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        user = cred.user;
        break;
      } catch (err) {
        if (err.code === "auth/too-many-requests") {
          throw err;
        }
        // Wrong password or unknown user — try the next password.
      }
    }

    if (!user) {
      unknown += 1;
      console.log(
        `  ⚠️  ${email} — could not sign in (already deleted, or unknown password). ` +
          `If it still exists, delete it in Firebase Console → Authentication.`
      );
      continue;
    }

    await deleteUser(user);
    deleted += 1;
    console.log(`  🗑️  deleted auth account ${email}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌ ${email} — ${err.code || err.message}`);
  } finally {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  }
}

console.log(
  `\nDone. Deleted: ${deleted}, not signed in (gone/unknown password): ${unknown}, failed: ${failed}`
);
process.exit(0);
