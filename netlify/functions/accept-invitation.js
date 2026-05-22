import { adminAuth, adminDb } from './_admin.js';

// Server-side invitation acceptance — atomically adds collaborator + marks invite accepted.
// POST /api/accept-invitation
// Headers: Authorization: Bearer <firebase-id-token>
// Body: { inviteId }
// Returns: { ok, project, projectId, role }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // When Admin SDK is not configured, signal client to use its own fallback path.
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

  const { inviteId } = body || {};
  if (!inviteId || typeof inviteId !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'inviteId required' }) };
  }

  try {
    // Read and validate the invitation
    const invRef = adminDb.doc(`invitations/${inviteId}`);
    const invSnap = await invRef.get();
    if (!invSnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Invitation not found' }) };
    }
    const inv = invSnap.data();

    if (inv.status !== 'pending') {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invitation is no longer pending', status: inv.status })
      };
    }
    if (!callerEmail || inv.toEmail.toLowerCase() !== callerEmail.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Invitation does not belong to this account' }) };
    }

    // Verify the project exists
    const projectRef = adminDb.doc(`sharedProjects/${inv.projectId}`);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      // Project is gone — auto-decline the invitation
      await invRef.update({ status: 'declined', declinedAt: new Date().toISOString() });
      return { statusCode: 410, body: JSON.stringify({ error: 'The shared project no longer exists' }) };
    }

    // Fetch caller's profile for display data (best-effort)
    const profileSnap = await adminDb.doc(`users/${callerUid}/profile/data`).get().catch(() => null);
    const profile = profileSnap?.exists ? profileSnap.data() : {};

    const role = inv.role === 'viewer' ? 'viewer' : 'editor';
    const collaboratorEntry = {
      name: profile.username || profile.name || callerEmail.split('@')[0],
      email: callerEmail,
      photoURL: profile.photoURL || '',
      addedAt: new Date().toISOString(),
      role
    };

    // Atomic batch: add collaborator + mark invitation accepted
    const batch = adminDb.batch();
    batch.update(projectRef, {
      [`collaborators.${callerUid}`]: collaboratorEntry,
      updatedBy: callerUid
    });
    batch.update(invRef, {
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    });
    await batch.commit();

    // Re-read after commit for fresh project data to return to client
    const updatedSnap = await projectRef.get();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        projectId: inv.projectId,
        role,
        project: updatedSnap.data()
      })
    };
  } catch (err) {
    console.error('[accept-invitation]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to accept invitation' })
    };
  }
};
