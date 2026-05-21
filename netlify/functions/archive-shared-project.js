import { adminAuth, adminDb } from './_admin.js';

// Owner-only soft-delete of a shared project (marks isArchived; does NOT delete the doc).
// POST /api/archive-shared-project
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

  let callerUid, callerEmail;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    callerUid = decoded.uid;
    callerEmail = decoded.email;
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
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, alreadyGone: true })
      };
    }

    const project = projectSnap.data();
    if (project.ownerId !== callerUid) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Only the project owner can archive a shared project' })
      };
    }

    const now = new Date().toISOString();
    await projectRef.update({
      isArchived: true,
      archivedAt: now,
      archivedBy: callerUid,
      archivedByName: callerEmail || callerUid,
      restoredAt: null,
      restoredBy: null,
      updatedBy: callerUid
    });

    console.log('[archive-shared-project]', projectId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('[archive-shared-project]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to archive shared project' })
    };
  }
};
