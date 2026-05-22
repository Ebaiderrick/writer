const JSON_CT = { 'Content-Type': 'application/json' };

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_CT, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const env = {
    hasFirebase:  !!process.env.FIREBASE_SERVICE_ACCOUNT,
    hasStripe:    !!process.env.STRIPE_SECRET_KEY,
    hasOpenAI:    !!process.env.OPENAI_API_KEY,
    hasProPrice:  !!process.env.STRIPE_PRO_PRICE_ID,
    hasPlusPrice: !!process.env.STRIPE_PREMIUM_PLUS_PRICE_ID,
  };

  const missingCritical = !env.hasFirebase || !env.hasStripe || !env.hasOpenAI;

  return {
    statusCode: missingCritical ? 503 : 200,
    headers: JSON_CT,
    body: JSON.stringify({
      status: missingCritical ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      env,
    })
  };
};
