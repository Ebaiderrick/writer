import Stripe from 'stripe';
import { adminAuth, adminDb } from './_admin.js';

const SITE_URL = process.env.URL || 'https://eyawriter.com';

const JSON_CT = { 'Content-Type': 'application/json' };

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, headers: JSON_CT, body: JSON.stringify({ error: 'Billing not configured' }) };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  if (adminAuth && adminDb) {
    // Primary path: verify caller's identity via Firebase ID token, look up customerId from Firestore
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, headers: JSON_CT, body: JSON.stringify({ error: 'Authorization required' }) };
    }

    let uid;
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return { statusCode: 401, headers: JSON_CT, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }

    let customerId;
    try {
      const snap = await adminDb.doc(`users/${uid}/billing/data`).get();
      customerId = snap.exists ? snap.data().stripeCustomerId : null;
    } catch (err) {
      console.error('[billing-portal] Firestore lookup failed:', err.message);
      return { statusCode: 500, headers: JSON_CT, body: JSON.stringify({ error: 'Failed to retrieve billing account' }) };
    }

    if (!customerId) {
      return { statusCode: 404, headers: JSON_CT, body: JSON.stringify({ error: 'No billing account found' }) };
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${SITE_URL}/app`
      });
      return { statusCode: 200, headers: JSON_CT, body: JSON.stringify({ url: session.url }) };
    } catch (err) {
      console.error('[billing-portal]', err.message);
      return { statusCode: 500, headers: JSON_CT, body: JSON.stringify({ error: err.message }) };
    }
  }

  // Fallback: Admin SDK not configured — trust client-provided customerId (dev/staging)
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { customerId } = body;
  if (!customerId) return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'customerId required' }) };
  console.warn('[billing-portal] Admin SDK not configured — using unverified body customerId');

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/app`
    });
    return { statusCode: 200, headers: JSON_CT, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('[billing-portal]', err.message);
    return { statusCode: 500, headers: JSON_CT, body: JSON.stringify({ error: err.message }) };
  }
};
