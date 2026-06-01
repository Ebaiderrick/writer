import { test, expect } from '@playwright/test';

test('phase 3 cover-page separation keeps title-page data out of screenplay normalization', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');
    const sample = [
      'THE LONG NIGHT',
      'Written by',
      'Ayo Writer',
      'ayo@example.com',
      'Open Frame Pictures',
      '',
      'INT. KITCHEN - NIGHT',
      '',
      'MARA',
      'I made it.'
    ].join('\n');

    const separated = conversion.separateCoverPageFromScript(sample);
    const observedStages = [];
    let normalizePayload = '';

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (_url, options = {}) => {
      const payload = JSON.parse(String(options.body || '{}'));
      observedStages.push(payload.stage);
      if (payload.stage === 'cover') {
        return new Response(JSON.stringify({
          coverPage: {
            title: 'THE LONG NIGHT',
            author: 'Ayo Writer',
            contact: 'ayo@example.com',
            company: 'Open Frame Pictures',
            details: '',
            logline: ''
          },
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (payload.stage === 'normalize') {
        normalizePayload = String(payload.text || '');
        return new Response(JSON.stringify({
          text: 'INT. KITCHEN - NIGHT\n\nMARA\nI made it.',
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
            { type: 'character', text: 'MARA' },
            { type: 'dialogue', text: 'I made it.' }
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
      const converted = await conversion.convertScriptTextToLines(sample, {
        fileName: 'cover-check.txt',
        projectId: 'proj_cover_check'
      });
      return {
        separated,
        observedStages,
        normalizePayload,
        coverPage: converted.coverPage,
        firstLine: converted.lines[0]?.text || ''
      };
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(result.separated.coverText).toContain('THE LONG NIGHT');
  expect(result.separated.bodyText).toContain('INT. KITCHEN - NIGHT');
  expect(result.separated.bodyText).not.toContain('Open Frame Pictures');
  expect(result.observedStages[0]).toBe('cover');
  expect(result.normalizePayload).toContain('INT. KITCHEN - NIGHT');
  expect(result.normalizePayload).not.toContain('THE LONG NIGHT');
  expect(result.normalizePayload).not.toContain('Open Frame Pictures');
  expect(result.coverPage.title).toBe('THE LONG NIGHT');
  expect(result.coverPage.author).toBe('Ayo Writer');
  expect(result.firstLine).toBe('INT. KITCHEN - NIGHT');
});
