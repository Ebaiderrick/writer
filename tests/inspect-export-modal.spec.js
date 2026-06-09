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
  expect(html).toContain('Scene Export');
  expect(html).toContain('id="exportFormatChoices"');
  expect(html).toContain('Fountain');
  expect(html).toContain('Generate Export');
});
