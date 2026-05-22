import Stripe from 'stripe';
import { adminDb } from './_admin.js';

const JSON_CT = { 'Content-Type': 'application/json' };

function _planFromMetadata(metadata) {
  const tier = metadata?.tier;
  if (tier === 'premium_plus') return 'premium_plus';
  return 'pro';
}

async function _updateBilling(uid, data) {
  if (!adminDb) return;
  const plan = data.plan || 'free';
  await adminDb.collection('users').doc(uid).collection('billing').doc('data')
    .set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
  // Keep quota plan in sync
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

  // Idempotency: skip already-processed events
  if (adminDb) {
    try {
      const eventRef = adminDb.doc(`webhookEvents/${stripeEvent.id}`);
      const existing = await eventRef.get();
      if (existing.exists) {
        console.log(`[stripe-webhook] Duplicate event skipped: ${stripeEvent.id}`);
        return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
      }
      // Mark as in-progress before handling (prevents race on retries)
      await eventRef.set({ type: stripeEvent.type, processedAt: new Date().toISOString() });
    } catch { /* non-fatal — continue processing */ }
  }

  const obj = stripeEvent.data.object;
  const uid = obj.metadata?.uid || stripeEvent.data.object?.subscription_details?.metadata?.uid;

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        if (obj.payment_status === 'paid' && uid) {
          const plan = _planFromMetadata(obj.metadata);
          await _updateBilling(uid, {
            plan,
            stripeCustomerId: obj.customer,
            subscriptionId: obj.subscription,
            status: 'active',
            canceledAt: null
          });
          console.log(`[stripe-webhook] checkout.session.completed uid=${uid} plan=${plan}`);
        }
        break;

      case 'customer.subscription.updated': {
        if (uid) {
          const plan = obj.status === 'active' || obj.status === 'trialing'
            ? _planFromMetadata(obj.metadata)
            : 'free';
          const billingUpdate = {
            plan,
            status: obj.status,
            subscriptionId: obj.id,
            stripeCustomerId: obj.customer,
            currentPeriodEnd: obj.current_period_end
              ? new Date(obj.current_period_end * 1000).toISOString()
              : null,
            canceledAt: obj.cancel_at
              ? new Date(obj.cancel_at * 1000).toISOString()
              : null
          };
          await _updateBilling(uid, billingUpdate);
          console.log(`[stripe-webhook] subscription.updated uid=${uid} plan=${plan} status=${obj.status}`);
        }
        break;
      }

      case 'customer.subscription.deleted':
        if (uid) {
          await _updateBilling(uid, {
            plan: 'free',
            status: 'canceled',
            subscriptionId: obj.id,
            canceledAt: new Date().toISOString()
          });
          console.log(`[stripe-webhook] subscription.deleted uid=${uid}`);
        }
        break;

      case 'invoice.payment_failed':
        if (uid) {
          await _updateBilling(uid, { status: 'past_due' });
          console.log(`[stripe-webhook] payment_failed uid=${uid}`);
        }
        break;

      default:
        // Unhandled event type — silently acknowledge
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] Handler error for ${stripeEvent.type}:`, err.message);
    // Still return 200 so Stripe doesn't retry indefinitely for transient errors
  }

  return { statusCode: 200, headers: JSON_CT, body: JSON.stringify({ received: true }) };
};
