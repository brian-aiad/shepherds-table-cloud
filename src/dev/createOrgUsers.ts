import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

/**
 * Seed "WEHELP" org with two locations and three users:
 * - Master admin: csbrianaiad@gmail.com (UID: Jx1ldxqYbedWJPOxx2N1itLfRuH2)
 * - Org admin: UID 87z7lO7T2cR48WyK6pYTv5Z95fl1
 * - Org volunteer: UID gSn9wCifHiY6WPimnnNWks5gdfz2
 *
 * IMPORTANT:
 *   Put your seeding credentials in .env (no quotes):
 *     VITE_SEED_EMAIL=csbrianaiad@gmail.com
 *     VITE_SEED_PASSWORD=password123
 *   Then temporarily import this file in src/main.tsx:
 *     import "./dev/createOrgUsers";
 *   After it logs success, remove the import.
 */

const ORG_ID = "WEHELP";
const ORG = {
  name: "WeHelp",
  slug: "wehelp",
  active: true,
};

const LOC_LB_ID = "WEHELP_LB";
const LOC_LB = {
  orgId: ORG_ID,
  name: "Christ the Good Shepherd",
  address: "Long Beach, CA",
  active: true,
};

const LOC_SR_ID = "WEHELP_SR";
const LOC_SR = {
  orgId: ORG_ID,
  name: "Mariners Church",
  address: "Skid Row, Los Angeles, CA",
  active: true,
};

// AUTH UIDs you showed in screenshots:
const UID_ADMIN = "87z7lO7T2cR48WyK6pYTv5Z95fl1";
const UID_VOL = "gSn9wCifHiY6WPimnnNWks5gdfz2";
const UID_MASTER = "Jx1ldxqYbedWJPOxx2N1itLfRuH2"; // csbrianaiad@gmail.com

const ADMIN_EMAIL = "org1loc1admin@gmail.com";
const VOL_EMAIL = "org1loc1volunteer@gmail.com";
const MASTER_EMAIL = "csbrianaiad@gmail.com";

const now = () => Date.now();

function tsify<T extends object>(obj: T): T & { createdAt: number; updatedAt: number } {
  const t = now();
  return { ...obj, createdAt: t, updatedAt: t };
}

async function upsertOrg() {
  await setDoc(doc(db, "organizations", ORG_ID), tsify(ORG), { merge: true });
}

async function upsertLocations() {
  await setDoc(doc(db, "locations", LOC_LB_ID), tsify(LOC_LB), { merge: true });
  await setDoc(doc(db, "locations", LOC_SR_ID), tsify(LOC_SR), { merge: true });
}

async function upsertUser(uid: string, email: string, activeLocationId: string) {
  await setDoc(
    doc(db, "users", uid),
    tsify({
      email,
      activeOrgId: ORG_ID,
      activeLocationId,
    }),
    { merge: true }
  );
}

async function upsertOrgUser(uid: string, email: string, role: "admin" | "volunteer", locationIds: string[]) {
  await setDoc(
    doc(db, "orgUsers", `${uid}_${ORG_ID}`),
    {
      orgId: ORG_ID,
      userId: uid,
      email,
      role,
      locationIds,
      createdAt: now(),
    },
    { merge: true }
  );
}

async function seed() {
  // 1) sign in using env vars (so rules with request.auth pass)
  const email = import.meta.env.VITE_SEED_EMAIL as string;
  const password = import.meta.env.VITE_SEED_PASSWORD as string;
  if (!email || !password) {
    throw new Error("Missing VITE_SEED_EMAIL or VITE_SEED_PASSWORD in .env");
  }
  const auth = getAuth();
  console.log("Signing in seeder as:", email);
  await signInWithEmailAndPassword(auth, email, password);
  console.log("✅ Authenticated for seeding.");

  // 2) org + locations
  await upsertOrg();
  await upsertLocations();

  // 3) users (profile docs) – set a reasonable default active location
  await upsertUser(UID_MASTER, MASTER_EMAIL, LOC_LB_ID);
  await upsertUser(UID_ADMIN, ADMIN_EMAIL, LOC_LB_ID);
  await upsertUser(UID_VOL, VOL_EMAIL, LOC_LB_ID);

  // 4) memberships/roles in this org
  await upsertOrgUser(UID_MASTER, MASTER_EMAIL, "admin", [LOC_LB_ID, LOC_SR_ID]); // master admin for all org locations
  await upsertOrgUser(UID_ADMIN, ADMIN_EMAIL, "admin", [LOC_LB_ID, LOC_SR_ID]);   // org admin across both locations
  await upsertOrgUser(UID_VOL, VOL_EMAIL, "volunteer", [LOC_LB_ID]);              // volunteer at Long Beach only

  console.log("✅ Seed complete: org, locations, users, orgUsers");
}

seed().catch((e) => {
  console.error("❌ Seed failed:", e);
});
