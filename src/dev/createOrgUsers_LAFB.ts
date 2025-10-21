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
const ORG_ID = "LAFB";
const ORG = {
  name: "LA Food Bank",
  slug: "la-food-bank",
  active: true,
};

const LOC_BF_ID = "LAFB_BF";
const LOC_BF = {
  orgId: ORG_ID,
  name: "St George Church",
  address: "Bellflower, CA",
  active: true,
};

const LOC_SA_ID = "LAFB_SA";
const LOC_SA = {
  orgId: ORG_ID,
  name: "Archangel Michael Church",
  address: "Santa Ana, CA",
  active: true,
};

const LOC_WM_ID = "LAFB_WM";
const LOC_WM = {
  orgId: ORG_ID,
  name: "Pope Kerollos Church",
  address: "Westminster, CA",
  active: true,
};


// AUTH UIDs you showed in screenshots:
const UID_ADMIN = "ZkYdZCOV8zQgYaYpBmEfFann93X2";
const UID_VOL1 = "5c9FAEw2XxOX8sgJp882yfUNRtj2";
const UID_VOL2 = "xJD9hJmrwLO36u1zSNS5R6EqOrz2";
const UID_MASTER = "Jx1ldxqYbedWJPOxx2N1itLfRuH2"; // master admin (csbrianaiad@gmail.com)

const ADMIN_EMAIL = "lafb.admin@gmail.com";
const VOL1_EMAIL = "lafb.vol1@gmail.com";
const VOL2_EMAIL = "lafb.vol2@gmail.com";
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
  await setDoc(doc(db, "locations", LOC_BF_ID), tsify(LOC_BF), { merge: true });
  await setDoc(doc(db, "locations", LOC_SA_ID), tsify(LOC_SA), { merge: true });
  await setDoc(doc(db, "locations", LOC_WM_ID), tsify(LOC_WM), { merge: true });
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
  const email = import.meta.env.VITE_SEED_EMAIL as string;
  const password = import.meta.env.VITE_SEED_PASSWORD as string;
  const auth = getAuth();
  await signInWithEmailAndPassword(auth, email, password);

  await upsertOrg();
  await upsertLocations();

  await upsertUser(UID_MASTER, MASTER_EMAIL, LOC_BF_ID);
  await upsertUser(UID_ADMIN, ADMIN_EMAIL, LOC_BF_ID);
  await upsertUser(UID_VOL1, VOL1_EMAIL, LOC_SA_ID);
  await upsertUser(UID_VOL2, VOL2_EMAIL, LOC_WM_ID);

  await upsertOrgUser(UID_MASTER, MASTER_EMAIL, "admin", [LOC_BF_ID, LOC_SA_ID, LOC_WM_ID]);
  await upsertOrgUser(UID_ADMIN, ADMIN_EMAIL, "admin", [LOC_BF_ID, LOC_SA_ID, LOC_WM_ID]);
  await upsertOrgUser(UID_VOL1, VOL1_EMAIL, "volunteer", [LOC_SA_ID]);
  await upsertOrgUser(UID_VOL2, VOL2_EMAIL, "volunteer", [LOC_WM_ID]);

  console.log("✅ Seed complete: LA Food Bank org + 3 locations + users");
}

seed().catch((e) => {
  console.error("❌ Seed failed:", e);
});
