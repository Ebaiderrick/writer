import { test, expect } from '@playwright/test';

test('phase 5 repair layer fixes orphan dialogue, orphan parentheticals, duplicate scenes, and fragmented action', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const outcome = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (_url, options = {}) => {
      const payload = JSON.parse(String(options.body || '{}'));
      if (payload.stage === 'normalize') {
        return new Response(JSON.stringify({
          text: 'INT. KITCHEN - NIGHT\n\nMARA\nI made it.\n\nThe hallway stretches\ninto shadow.',
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (payload.stage === 'structure') {
        return new Response(JSON.stringify({
          lines: [
            { type: 'scene', text: 'INT. KITCHEN - NIGHT' },
            { type: 'scene', text: 'INT. KITCHEN - NIGHT' },
            { type: 'dialogue', text: 'This should not be orphan dialogue.' },
            { type: 'parenthetical', text: '(quietly)' },
            { type: 'character', text: 'MARA' },
            { type: 'dialogue', text: 'I made it.' },
            { type: 'action', text: 'The hallway stretches' },
            { type: 'action', text: 'into shadow.' }
          ],
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return originalFetch(_url, options);
    };

    try {
      const result = await conversion.convertScriptTextToLines('INT. KITCHEN - NIGHT\n\nMARA\nI made it.', {
        fileName: 'repair-check.txt',
        projectId: 'proj_repair_check'
      });
      return result.lines;
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(outcome[0]).toEqual({ type: 'scene', text: 'INT. KITCHEN - NIGHT' });
  expect(outcome[1]).toEqual({ type: 'action', text: 'This should not be orphan dialogue. (quietly)' });
  expect(outcome[2]).toEqual({ type: 'character', text: 'MARA' });
  expect(outcome[3]).toEqual({ type: 'dialogue', text: 'I made it.' });
  expect(outcome[4]).toEqual({ type: 'action', text: 'The hallway stretches into shadow.' });
  expect(outcome).toHaveLength(5);
});
