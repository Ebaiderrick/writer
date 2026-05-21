import { adminAuth, adminDb } from './_admin.js';

// Owner-only restore of an archived shared project.
// POST /api/restore-shared-project
// Headers: Authorization: Bearer <firebase-id-token>
// Body: { projectId }
// Returns: { ok, project }

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
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Project not found' })
      };
    }

    const project = projectSnap.data();
    if (project.ownerId !== callerUid) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Only the project owner can restore a shared project' })
      };
    }

    const now = new Date().toISOString();
    await projectRef.update({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      archivedByName: '',
      restoredAt: now,
      restoredBy: callerUid,
      updatedBy: callerUid
    });

    const updatedSnap = await projectRef.get();
    console.log('[restore-shared-project]', projectId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, project: updatedSnap.data() })
    };
  } catch (err) {
    console.error('[restore-shared-project]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to restore shared project' })
    };
  }
};
