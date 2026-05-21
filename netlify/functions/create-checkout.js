import Stripe from 'stripe';

const SITE_URL = process.env.URL || 'https://eyawriter.com';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Billing not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { uid, email } = body;
  if (!uid || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'uid and email required' }) };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Pro price not configured' }) };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/app?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/pricing`,
      metadata: { uid },
      subscription_data: { metadata: { uid } },
      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('[create-checkout]', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
