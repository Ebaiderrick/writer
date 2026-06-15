import { test, expect } from '@playwright/test';

test('screenplay export modal shell is present in the app document', async ({ request }) => {
  const response = await request.get('http://localhost:4173/');
  expect(response.ok()).toBeTruthy();

  const html = await response.text();
  expect(html).toContain('id="exportDialog"');
  expect(html).toContain('Screenplay Export');
  expect(html).toContain('id="exportTypeChoices"');
  expect(html).toContain('Full Script');
  expect(html).toContain('Character Export');
  expect(html).toContain('Character Packet Export');
  expect(html).toContain('Scene Export');
  expect(html).toContain('Location Export');
  expect(html).toContain('Revision Export');
  expect(html).toContain('Production Export');
  expect(html).toContain('Shooting Script');
  expect(html).toContain('Watermarked Script');
  expect(html).toContain('id="exportFormatChoices"');
  expect(html).toContain('Fountain');
  expect(html).toContain('Final Draft (.fdx)');
  expect(html).toContain('Include Page Numbers');
  expect(html).toContain('Include Revisions');
  expect(html).toContain('Watermark Settings');
  expect(html).toContain('Optional custom watermark text');
  expect(html).toContain('Generate Export');
  expect(html).toContain('id="exportProgressCard"');
  expect(html).toContain('id="exportProgressLabel"');
  expect(html).toContain('id="exportProgressFill"');
  expect(html).toContain('id="exportProgressDetail"');
  expect(html).toContain('Export History');
  expect(html).toContain('id="exportHistoryList"');
  expect(html).toContain('id="exportHistoryEmpty"');
});
