// setMaster.js
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";

// Load the service account key
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));

initializeApp({
  credential: cert(serviceAccount),
});

const MASTER_UID = "Jx1ldxqYbedWJPOxx2N1itLfRuH2"; // your UID

(async () => {
  try {
    await getAuth().setCustomUserClaims(MASTER_UID, { master: true });
    console.log("✅ Master claim set for:", MASTER_UID);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error setting claim:", err);
    process.exit(1);
  }
})();
