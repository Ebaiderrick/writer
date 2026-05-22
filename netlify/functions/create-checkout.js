import Stripe from 'stripe';
import { adminAuth } from './_admin.js';

const SITE_URL = process.env.URL || 'https://eyawriter.com';
const JSON_CT = { 'Content-Type': 'application/json' };

function reqId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10).toUpperCase();
}

const TIER_PRICE_MAP = {
  pro: process.env.STRIPE_PRO_PRICE_ID,
  premium_plus: process.env.STRIPE_PREMIUM_PLUS_PRICE_ID
};

export const handler = async (event) => {
  const rid = reqId();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...JSON_CT, 'X-Request-Id': rid }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, headers: { ...JSON_CT, 'X-Request-Id': rid }, body: JSON.stringify({ error: 'Billing not configured' }) };
  }

  // Parse body early to read tier (needed even for auth path)
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const tier = body?.tier === 'premium_plus' ? 'premium_plus' : 'pro';
  const priceId = TIER_PRICE_MAP[tier];
  if (!priceId) {
    return { statusCode: 503, headers: JSON_CT, body: JSON.stringify({ error: `${tier} price not configured` }) };
  }

  let uid, email;

  if (adminAuth) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, headers: JSON_CT, body: JSON.stringify({ error: 'Authorization required' }) };
    }
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email;
    } catch {
      return { statusCode: 401, headers: JSON_CT, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }
  } else {
    uid = body?.uid;
    email = body?.email;
    console.warn('[create-checkout] Admin SDK not configured — using unverified body uid/email');
  }

  if (!uid || !email) {
    return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'User identity could not be determined' }) };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/app?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/pricing`,
      metadata: { uid, tier },
      subscription_data: { metadata: { uid, tier } },
      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      headers: JSON_CT,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('[create-checkout]', err.message);
    return {
      statusCode: 500,
      headers: JSON_CT,
      body: JSON.stringify({ error: err.message })
    };
  }
};
