import { test, expect } from '@playwright/test';

test('phase 2 cleanup strips repeated headers and repairs wrapped screenplay lines', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const output = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');

    const pageOne = [
      'MY MOVIE',
      'DRAFT 04/2026',
      '12',
      '',
      'INT. KITCHEN - DAY',
      '',
      'MARA',
      'I never',
      'wanted this.'
    ].join('\n');

    const pageTwo = [
      'MY MOVIE',
      'DRAFT 04/2026',
      '13',
      '',
      'It was a long corridor that stretched',
      'past the doors and into shadow.',
      '',
      'JON',
      '(quietly)',
      'I know.'
    ].join('\n');

    return conversion.preparePreStructureText(`${pageOne}\n\n${pageTwo}`, {
      pageSegments: [pageOne, pageTwo]
    });
  });

  expect(output).not.toContain('DRAFT 04/2026');
  expect(output).not.toContain('\n12\n');
  expect(output).not.toContain('\n13\n');
  expect(output).toContain('INT. KITCHEN - DAY');
  expect(output).toContain('MARA\nI never wanted this.');
  expect(output).toContain('It was a long corridor that stretched past the doors and into shadow.');
  expect(output).toContain('JON\n(quietly)\nI know.');
});
