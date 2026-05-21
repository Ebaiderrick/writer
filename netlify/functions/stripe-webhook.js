import Stripe from 'stripe';
import { adminDb } from './_admin.js';

async function _updateBilling(uid, data) {
  if (!adminDb) return;
  const plan = data.plan || 'free';
  await adminDb.collection('users').doc(uid).collection('billing').doc('data')
    .set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
  await adminDb.collection('users').doc(uid).collection('quota').doc('current')
    .set({ plan }, { merge: true });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return { statusCode: 503, body: 'Webhook not configured' };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const obj = stripeEvent.data.object;
  const uid = obj.metadata?.uid;

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        if (obj.payment_status === 'paid' && uid) {
          await _updateBilling(uid, {
            plan: 'pro',
            stripeCustomerId: obj.customer,
            subscriptionId: obj.subscription,
            status: 'active'
          });
        }
        break;

      case 'customer.subscription.updated':
        if (uid) {
          const plan = obj.status === 'active' ? 'pro' : 'free';
          await _updateBilling(uid, {
            plan,
            status: obj.status,
            subscriptionId: obj.id,
            stripeCustomerId: obj.customer,
            currentPeriodEnd: obj.current_period_end
              ? new Date(obj.current_period_end * 1000).toISOString()
              : null
          });
        }
        break;

      case 'customer.subscription.deleted':
        if (uid) {
          await _updateBilling(uid, { plan: 'free', status: 'canceled', subscriptionId: obj.id });
        }
        break;

      case 'invoice.payment_failed':
        if (uid) {
          await _updateBilling(uid, { status: 'past_due' });
        }
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
