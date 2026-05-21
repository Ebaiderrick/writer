import { adminAuth, adminDb } from './_admin.js';

// Admin-only cleanup function for orphaned workspace/invitation data.
// POST /api/admin-cleanup-workspace
// Body: { uid } — must be an admin UID
// Returns: { cleaned: { orphanedInvitations, expiredInvitations } }

const INVITATION_STALE_DAYS = 90;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!adminAuth || !adminDb) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Admin SDK not configured' }) };
  }

  // Verify Firebase auth token
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Authorization required' }) };
  }

  let callerUid;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  // Verify caller is an admin
  const adminSnap = await adminDb.doc(`admins/${callerUid}`).get().catch(() => null);
  if (!adminSnap?.exists) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  const results = {
    orphanedInvitations: 0,
    expiredInvitations: 0,
    errors: []
  };

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INVITATION_STALE_DAYS);
    const cutoffISO = cutoff.toISOString();

    // Fetch all pending invitations
    const pendingSnap = await adminDb
      .collection('invitations')
      .where('status', '==', 'pending')
      .get();

    const batch = adminDb.batch();
    let batchCount = 0;

    for (const invDoc of pendingSnap.docs) {
      const inv = invDoc.data();

      // Check 1: Expire invitations older than INVITATION_STALE_DAYS
      if (inv.createdAt && inv.createdAt < cutoffISO) {
        batch.update(invDoc.ref, { status: 'expired', expiredAt: new Date().toISOString() });
        results.expiredInvitations++;
        batchCount++;
      } else {
        // Check 2: Mark orphaned if the shared project no longer exists
        try {
          const projectSnap = await adminDb.doc(`sharedProjects/${inv.projectId}`).get();
          if (!projectSnap.exists) {
            batch.update(invDoc.ref, { status: 'orphaned', orphanedAt: new Date().toISOString() });
            results.orphanedInvitations++;
            batchCount++;
          }
        } catch (err) {
          results.errors.push(`inv/${invDoc.id}: ${err.message}`);
        }
      }

      // Commit in batches of 400 to stay within Firestore batch limit
      if (batchCount >= 400) {
        await batch.commit();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error('[admin-cleanup-workspace]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, partial: results })
    };
  }

  console.log('[admin-cleanup-workspace] completed', results);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, cleaned: results })
  };
};
