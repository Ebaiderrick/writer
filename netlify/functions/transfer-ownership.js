import { adminAuth, adminDb } from './_admin.js';

// Owner-only transfer of shared project ownership to a current collaborator.
// POST /api/transfer-ownership
// Headers: Authorization: Bearer <firebase-id-token>
// Body: { projectId, newOwnerUid }
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

  const { projectId, newOwnerUid } = body || {};
  if (!projectId || typeof projectId !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'projectId required' }) };
  }
  if (!newOwnerUid || typeof newOwnerUid !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'newOwnerUid required' }) };
  }
  if (newOwnerUid === callerUid) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cannot transfer ownership to yourself' }) };
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
        body: JSON.stringify({ error: 'Only the current project owner can transfer ownership' })
      };
    }

    const collaborators = project.collaborators || {};
    if (!collaborators[newOwnerUid]) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'New owner must be a current collaborator' })
      };
    }

    // Look up the new owner's auth profile for accurate display info.
    let newOwnerName = collaborators[newOwnerUid].name || collaborators[newOwnerUid].email || '';
    let newOwnerEmail = collaborators[newOwnerUid].email || '';
    let newOwnerPhotoURL = collaborators[newOwnerUid].photoURL || '';
    try {
      const newOwnerRecord = await adminAuth.getUser(newOwnerUid);
      newOwnerName = newOwnerRecord.displayName || newOwnerName;
      newOwnerEmail = newOwnerRecord.email || newOwnerEmail;
      newOwnerPhotoURL = newOwnerRecord.photoURL || newOwnerPhotoURL;
    } catch {
      // Fall back to collaborator map data
    }

    // Build updated collaborators: remove new owner, add old owner as editor.
    const updatedCollaborators = { ...collaborators };
    delete updatedCollaborators[newOwnerUid];
    updatedCollaborators[callerUid] = {
      name: project.ownerName || '',
      email: project.ownerEmail || '',
      photoURL: project.ownerPhotoURL || '',
      addedAt: new Date().toISOString(),
      role: 'editor'
    };

    const now = new Date().toISOString();
    const governanceEntry = {
      timestamp: now,
      user: newOwnerName || newOwnerEmail || 'New owner',
      uid: newOwnerUid,
      category: 'governance',
      message: `Ownership transferred to ${newOwnerName || newOwnerEmail}.`
    };

    const activityLog = [...(project.activityLog || []), governanceEntry];
    if (activityLog.length > 50) activityLog.shift();

    await projectRef.update({
      ownerId: newOwnerUid,
      ownerName: newOwnerName,
      ownerEmail: newOwnerEmail,
      ownerPhotoURL: newOwnerPhotoURL,
      collaborators: updatedCollaborators,
      activityLog,
      lastActivityAt: now,
      lastEditorName: newOwnerName || newOwnerEmail,
      updatedBy: callerUid
    });

    const updatedSnap = await projectRef.get();
    console.log('[transfer-ownership]', projectId, `${callerUid} → ${newOwnerUid}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, project: updatedSnap.data() })
    };
  } catch (err) {
    console.error('[transfer-ownership]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to transfer ownership' })
    };
  }
};
