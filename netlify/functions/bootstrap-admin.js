import { adminAuth, adminDb } from './_admin.js';

// One-time admin bootstrap. Grants admin role to a user by email.
// POST /api/bootstrap-admin
// Body: { email, secret }
// The secret must match the ADMIN_BOOTSTRAP_SECRET environment variable.
// Call once to seed the first admin account, then keep the secret safe.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!bootstrapSecret) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ADMIN_BOOTSTRAP_SECRET is not configured' })
    };
  }

  if (!adminAuth || !adminDb) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Firebase Admin SDK not configured (FIREBASE_SERVICE_ACCOUNT missing)' })
    };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, secret } = body || {};

  if (!secret || secret !== bootstrapSecret) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid bootstrap secret' })
    };
  }

  if (!email || typeof email !== 'string') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'email required' })
    };
  }

  try {
    // Look up the user by email via Firebase Auth
    const userRecord = await adminAuth.getUserByEmail(email.trim().toLowerCase());
    const uid = userRecord.uid;

    // Write to admins/{uid} — this is what _checkAdmin() reads
    await adminDb.doc(`admins/${uid}`).set({
      uid,
      email: userRecord.email,
      displayName: userRecord.displayName || '',
      grantedAt: new Date().toISOString(),
      grantedBy: 'bootstrap'
    });

    console.log('[bootstrap-admin] Granted admin to', email, uid);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, uid, email: userRecord.email })
    };
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `No Firebase Auth user found for ${email}. Make sure you have signed up first.` })
      };
    }
    console.error('[bootstrap-admin]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Bootstrap failed' })
    };
  }
};
