import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

/**
 * Client-side backfill for usda_first.name fields.
 * Options:
 *  - dryRun: boolean (do not perform writes)
 *  - onProgress: function({checked, toUpdate, applied}) called periodically
 * Returns: { checked, toUpdate, applied }
 */
export async function backfillUsdaFirstNames({ dryRun = false, onProgress } = {}) {
  const snap = await getDocs(collection(db, "usda_first"));
  const docs = snap.docs;

  let checked = 0;
  const updates = [];

  for (const d of docs) {
    checked++;
    const data = d.data() || {};
    if (typeof data.clientFirstName === "string" && typeof data.clientLastName === "string") {
      continue;
    }

    const clientId = data.clientId;
    const monthKey = data.monthKey;
    if (!clientId) continue;

    let first = "";
    let last = "";

    // Try to read a visit snapshot for this client+month
    if (monthKey) {
      try {
        const vq = query(
          collection(db, "visits"),
          where("clientId", "==", clientId),
          where("monthKey", "==", monthKey),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const vs = await getDocs(vq);
        if (!vs.empty) {
          const v = vs.docs[0].data() || {};
          first = v.clientFirstName || "";
          last = v.clientLastName || "";
        }
      } catch (e) {
        // ignore
      }
    }

    // As a last resort, try to derive from data.clientName fields if present
    if ((!first || !last) && data.clientName) {
      const parts = String(data.clientName).split(" ").filter(Boolean);
      first = first || parts[0] || "";
      last = last || parts.slice(1).join(" ") || "";
    }

    // Try client doc by direct read
    if ((!first || !last)) {
      try {
        const cRef = doc(db, "clients", clientId);
        const cSnap = await cRef.get?.() ?? null;
        if (cSnap && cSnap.exists && cSnap.data) {
          const c = cSnap.data();
          first = first || c.firstName || "";
          last = last || c.lastName || "";
        }
      } catch (e) {
        // ignore
      }
    }

    if (first || last) {
      updates.push({ ref: d.ref, first: first || "", last: last || "" });
    }

    if (onProgress && checked % 50 === 0) {
      onProgress({ checked, toUpdate: updates.length, applied: 0 });
    }
  }

  if (updates.length === 0) {
    if (onProgress) onProgress({ checked, toUpdate: 0, applied: 0 });
    return { checked, toUpdate: 0, applied: 0 };
  }

  if (dryRun) {
    if (onProgress) onProgress({ checked, toUpdate: updates.length, applied: 0 });
    return { checked, toUpdate: updates.length, applied: 0 };
  }

  // Apply updates in batches
  const BATCH = 400;
  let applied = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const u of chunk) {
      batch.update(u.ref, {
        clientFirstName: u.first,
        clientLastName: u.last,
      });
    }
    await batch.commit();
    applied += chunk.length;
    if (onProgress) onProgress({ checked, toUpdate: updates.length, applied });
  }

  return { checked, toUpdate: updates.length, applied };
}

export default backfillUsdaFirstNames;
