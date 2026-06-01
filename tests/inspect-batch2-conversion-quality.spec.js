import { test, expect } from '@playwright/test';

test('batch 2 quality pass improves cover-page inference and wrap handling', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');

    const cover = conversion.detectCoverPageCandidate([
      'THE HILL AT FIRST LIGHT',
      'First Draft 04/2026',
      'Ebaid Derrick',
      'Open Frame Pictures',
      'ebaid@example.com',
      '',
      'INT. VILLAGE STREET - MORNING'
    ].join('\n'));

    const prepared = conversion.preparePreStructureText([
      'MARA',
      'I never meant to leave,',
      'but the road was already gone.',
      '',
      'The camera glides over the stream,',
      'and settles on the broken bridge.'
    ].join('\n'));

    const preview = conversion.buildLocalStructuredPreview(prepared);

    return {
      cover,
      prepared,
      preview
    };
  });

  expect(result.cover.title).toBe('THE HILL AT FIRST LIGHT');
  expect(result.cover.author).toBe('Ebaid Derrick');
  expect(result.cover.contact).toBe('ebaid@example.com');
  expect(result.cover.company).toBe('Open Frame Pictures');
  expect(result.cover.details).not.toContain('First Draft 04/2026');

  expect(result.prepared).toContain('MARA\nI never meant to leave, but the road was already gone.');
  expect(result.prepared).toContain('The camera glides over the stream, and settles on the broken bridge.');

  expect(result.preview[0]).toEqual({ type: 'character', text: 'MARA' });
  expect(result.preview[1]).toEqual({ type: 'dialogue', text: 'I never meant to leave, but the road was already gone.' });
  expect(result.preview[2]).toEqual({ type: 'action', text: 'The camera glides over the stream, and settles on the broken bridge.' });
});
