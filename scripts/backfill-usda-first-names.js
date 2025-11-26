#!/usr/bin/env node
/*
 Backfill script: populate clientFirstName/clientLastName on usda_first docs.

 Usage:
 1) Install deps: run in project root
    npm install firebase-admin

 2) Provide credentials via service account JSON or ADC:
    - Set env var (PowerShell):
      $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\to\serviceAccount.json'
    - Or modify the script to pass the path to the JSON.

 3) Run dry-run (no writes):
    node ./scripts/backfill-usda-first-names.js --dry-run

 4) Run to apply updates:
    node ./scripts/backfill-usda-first-names.js

 Notes:
 - The script is idempotent: it only writes markers missing the name fields.
 - It prefers the authoritative client document, then falls back to a visit snapshot for the same month.
 - Batches writes in chunks of 300 to avoid Firestore limits.
*/

const admin = require('firebase-admin');
const path = require('path');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run') || argv.includes('-n');

// Initialize admin SDK (use ADC if GOOGLE_APPLICATION_CREDENTIALS is set)
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    // try to load a local service account file at ./serviceAccountKey.json
    const guess = path.join(process.cwd(), 'serviceAccountKey.json');
    try {
      const cred = require(guess);
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    } catch (e) {
      console.error('\nERROR: No Google credentials found.');
      console.error('Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in project root.');
      process.exit(1);
    }
  }
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e);
  process.exit(1);
}

const db = admin.firestore();

async function run() {
  console.log('Starting backfill for usda_first name fields');
  console.log(dryRun ? 'Running in DRY-RUN mode (no writes)' : 'Applying updates');

  const snap = await db.collection('usda_first').get();
  console.log(`Found ${snap.size} usda_first documents`);

  const toUpdate = [];
  let checked = 0;
  for (const docSnap of snap.docs) {
    checked++;
    const data = docSnap.data() || {};
    const id = docSnap.id;
    if (typeof data.clientFirstName === 'string' && typeof data.clientLastName === 'string') {
      continue; // already has both fields (could be empty strings but present)
    }

    const clientId = data.clientId;
    const monthKey = data.monthKey;
    if (!clientId) {
      console.warn(`Skipping ${id}: missing clientId`);
      continue;
    }

    // Try authoritative client doc first
    let first = '';
    let last = '';
    try {
      const clientSnap = await db.collection('clients').doc(clientId).get();
      if (clientSnap.exists) {
        const c = clientSnap.data() || {};
        first = c.firstName || '';
        last = c.lastName || '';
      }
    } catch (e) {
      console.warn(`Failed to read client ${clientId} for marker ${id}:`, e.message || e);
    }

    // If missing from client, try to find a visit snapshot in same month
    if ((!first || !last) && monthKey) {
      try {
        const q = db.collection('visits')
          .where('clientId', '==', clientId)
          .where('monthKey', '==', monthKey)
          .orderBy('createdAt', 'desc')
          .limit(1);
        const vs = await q.get();
        if (!vs.empty) {
          const v = vs.docs[0].data() || {};
          first = first || v.clientFirstName || '';
          last = last || v.clientLastName || '';
        }
      } catch (e) {
        console.warn(`Failed to query visits for ${clientId} ${monthKey}:`, e.message || e);
      }
    }

    // If we have at least one name value, schedule update (write both, even if empty strings)
    if (first || last) {
      toUpdate.push({ ref: docSnap.ref, first, last });
    } else {
      // if still nothing, we can optionally write empty strings to normalize, but skip for now
      console.log(`No name found for marker ${id} (client ${clientId}); skipping`);
    }
  }

  console.log(`Checked ${checked} markers; ${toUpdate.length} need updates`);

  if (toUpdate.length === 0) {
    console.log('Nothing to do. Exiting.');
    return;
  }

  if (dryRun) {
    console.log('DRY-RUN: listing planned updates:');
    toUpdate.forEach((u) => console.log(` - ${u.ref.path} -> ${u.first} ${u.last}`));
    console.log('DRY-RUN complete. No writes performed.');
    return;
  }

  // Apply in batches of 300
  const BATCH = 300;
  let applied = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const chunk = toUpdate.slice(i, i + BATCH);
    const batch = db.batch();
    for (const u of chunk) {
      batch.update(u.ref, {
        clientFirstName: u.first || '',
        clientLastName: u.last || '',
      });
    }
    try {
      await batch.commit();
      applied += chunk.length;
      console.log(`Committed batch: ${applied}/${toUpdate.length}`);
    } catch (e) {
      console.error('Batch commit failed:', e);
      throw e;
    }
  }

  console.log(`Backfill complete. Applied ${applied} updates.`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
