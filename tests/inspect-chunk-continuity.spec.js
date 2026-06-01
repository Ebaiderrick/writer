import { test, expect } from '@playwright/test';

test('phase 4 chunk continuity forwards scene and speaker memory across conversion chunks', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');
    const observed = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (_url, options = {}) => {
      const payload = JSON.parse(String(options.body || '{}'));
      observed.push({
        stage: payload.stage,
        chunkIndex: payload.chunkIndex,
        continuity: payload.continuity || null
      });

      if (payload.stage === 'normalize') {
        const text = payload.chunkIndex === 0
          ? 'INT. KITCHEN - NIGHT\n\nMARA\nI am still here.'
          : 'I am still speaking into the next chunk.';
        return new Response(JSON.stringify({
          text,
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (payload.stage === 'structure') {
        const lines = payload.chunkIndex === 0
          ? [
              { type: 'scene', text: 'INT. KITCHEN - NIGHT' },
              { type: 'character', text: 'MARA' },
              { type: 'dialogue', text: 'I am still here.' }
            ]
          : [
              { type: 'dialogue', text: 'I am still speaking into the next chunk.' }
            ];
        return new Response(JSON.stringify({ lines, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return originalFetch(_url, options);
    };

    try {
      const longDialogue = 'I am still here '.repeat(900);
      const longFollowup = 'I am still speaking into the next chunk '.repeat(900);
      await conversion.convertScriptTextToLines(
        `INT. KITCHEN - NIGHT\n\nMARA\n${longDialogue}\n\nMARA\n${longFollowup}`,
        {
          fileName: 'continuity-check.txt',
          projectId: 'proj_continuity_check'
        }
      );
      return observed;
    } finally {
      window.fetch = originalFetch;
    }
  });

  const normalizeCalls = result.filter((entry) => entry.stage === 'normalize');
  const structureCalls = result.filter((entry) => entry.stage === 'structure');

  expect(normalizeCalls.length).toBeGreaterThan(1);
  expect(structureCalls.length).toBeGreaterThan(0);
  expect(normalizeCalls[1].continuity?.lastScene).toBe('INT. KITCHEN - NIGHT');
  expect(normalizeCalls[1].continuity?.recentSpeakers).toContain('MARA');
  expect(structureCalls[0].continuity?.lastScene || '').toBe('');
});
