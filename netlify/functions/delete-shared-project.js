import { adminAuth, adminDb } from './_admin.js';

// Owner-only cascade delete of a shared project.
// POST /api/delete-shared-project
// Headers: Authorization: Bearer <firebase-id-token>
// Body: { projectId }
// Returns: { ok }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!adminAuth || !adminDb) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Service not configured', fallback: true })
    };
  }

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
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { projectId } = body || {};
  if (!projectId || typeof projectId !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'projectId required' }) };
  }

  try {
    const projectRef = adminDb.doc(`sharedProjects/${projectId}`);
    const projectSnap = await projectRef.get();

    if (!projectSnap.exists) {
      // Already deleted — idempotent success.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, alreadyDeleted: true })
      };
    }

    const project = projectSnap.data();
    if (project.ownerId !== callerUid) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Only the project owner can delete a shared project' })
      };
    }

    // Atomically: mark pending invitations as orphaned + delete the shared project doc.
    const pendingInvites = await adminDb
      .collection('invitations')
      .where('projectId', '==', projectId)
      .where('status', '==', 'pending')
      .get();

    const batch = adminDb.batch();
    const now = new Date().toISOString();
    pendingInvites.docs.forEach(invDoc => {
      batch.update(invDoc.ref, { status: 'orphaned', orphanedAt: now });
    });
    batch.delete(projectRef);
    await batch.commit();

    console.log('[delete-shared-project]', projectId, `(${pendingInvites.size} invites orphaned)`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('[delete-shared-project]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to delete shared project' })
    };
  }
};
