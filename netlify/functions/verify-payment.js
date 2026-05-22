import Stripe from 'stripe';
import { adminDb } from './_admin.js';

const JSON_CT = { 'Content-Type': 'application/json' };

function _planFromMetadata(metadata) {
  const tier = metadata?.tier;
  if (tier === 'premium_plus') return 'premium_plus';
  return 'pro';
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { sessionId } = body;
  if (!sessionId) return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'sessionId required' }) };
  if (!process.env.STRIPE_SECRET_KEY) return { statusCode: 503, headers: JSON_CT, body: JSON.stringify({ error: 'Billing not configured' }) };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    if (session.payment_status !== 'paid') {
      return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'Payment not completed' }) };
    }

    const uid = session.metadata?.uid;
    if (!uid) return { statusCode: 400, headers: JSON_CT, body: JSON.stringify({ error: 'No uid in session metadata' }) };

    const plan = _planFromMetadata(session.metadata);
    const sub = session.subscription;
    const billingData = {
      plan,
      stripeCustomerId: session.customer,
      subscriptionId: typeof sub === 'string' ? sub : sub?.id,
      status: typeof sub === 'object' ? (sub?.status || 'active') : 'active',
      currentPeriodEnd: typeof sub === 'object' && sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      canceledAt: null,
      updatedAt: new Date().toISOString()
    };

    if (adminDb) {
      await adminDb.collection('users').doc(uid).collection('billing').doc('data')
        .set(billingData, { merge: true });
      await adminDb.collection('users').doc(uid).collection('quota').doc('current')
        .set({ plan }, { merge: true });
    }

    return {
      statusCode: 200,
      headers: JSON_CT,
      body: JSON.stringify({ success: true, plan })
    };
  } catch (err) {
    console.error('[verify-payment]', err.message);
    return {
      statusCode: 500,
      headers: JSON_CT,
      body: JSON.stringify({ error: err.message })
    };
  }
};
