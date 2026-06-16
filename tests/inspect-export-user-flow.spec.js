import { test, expect } from '@playwright/test';
import { login } from './helper.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('user-style export flow queues, downloads, and records export history', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.THREE = window.THREE || {};'
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.emailjs = window.emailjs || { init() {}, send() { return Promise.resolve(); } };'
    });
  });
  await page.route('**/unpkg.com/docx@8.5.0/build/index.umd.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.docx = window.docx || {};'
    });
  });

  await login(page);

  await page.evaluate(() => {
    const storageKey = 'eyawriter-projects-v5';
    const project = {
      id: 'project-export-journey',
      scriptId: 'AB12CD',
      title: 'Export Journey Script',
      author: 'Lenon',
      logline: 'A writer tests the export engine from end to end.',
      createdAt: '2026-06-11T08:00:00.000Z',
      updatedAt: '2026-06-11T08:00:00.000Z',
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. OFFICE - DAY' },
        { id: 'line-1', type: 'action', text: 'Sunlight cuts across a cluttered desk.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'Let us see if this export really holds up.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. STREET - NIGHT' },
        { id: 'line-4', type: 'action', text: 'Traffic hisses through the rain.' },
        { id: 'line-5', type: 'character', text: 'RUIZ' },
        { id: 'line-6', type: 'dialogue', text: 'History should remember every export.' }
      ],
      activityLog: [],
      exportHistory: []
    };

    localStorage.setItem(storageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      currentProjectId: project.id,
      currentWorkspaceId: null,
      projects: [project],
      aiAssist: false,
      toolStripCollapsed: false,
      autoNumberScenes: true,
      backgroundAnimation: false,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      grammarCheck: false,
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      tourShown: true
    }));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 20000 });

  const studioHidden = await page.locator('#studioView').getAttribute('hidden').catch(() => '');
  if (studioHidden !== null) {
    const projectCard = page.locator('.project-card').filter({ hasText: 'Export Journey Script' }).first();
    await expect(projectCard).toBeVisible({ timeout: 15000 });
    await projectCard.locator('.project-card-open').click();
  }

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#exportScreenplayBtn')).toHaveCount(1, { timeout: 15000 });
  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#exportHistoryEmpty')).toContainText('No exports recorded');

  await page.selectOption('#exportFormatSelect', 'fountain');

  const firstDownload = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('#exportDialogGenerateBtn').click();
  const firstFile = await firstDownload;

  expect(firstFile.suggestedFilename()).toBe('export-journey-script-full-script.fountain');
  await expect(page.locator('.app-toast').last()).toContainText(/queued export finished downloading|export complete|queued screenplay export/i, { timeout: 20000 });

  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  const historyItems = page.locator('.export-history-item');
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
  await expect(historyItems.first()).toContainText('Full Script');
  await expect(historyItems.first()).toContainText('FOUNTAIN');

  await historyItems.first().locator('[data-export-history-action="view"]').click();
  await expect(page.locator('#customModal[open]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#customModal')).toContainText('Type: Full Script');
  await expect(page.locator('#customModal')).toContainText('Format: FOUNTAIN');
  await page.evaluate(() => document.getElementById('customModal')?.close());

  const secondDownload = page.waitForEvent('download', { timeout: 60000 });
  await historyItems.first().locator('[data-export-history-action="download"]').click();
  const secondFile = await secondDownload;
  expect(secondFile.suggestedFilename()).toBe('export-journey-script-full-script.fountain');

  await expect(historyItems).toHaveCount(2, { timeout: 15000 });
  await historyItems.first().locator('[data-export-history-action="delete"]').click();
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
});

test('user-style Final Draft export flow downloads a valid fdx file and records export history', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.THREE = window.THREE || {};'
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.emailjs = window.emailjs || { init() {}, send() { return Promise.resolve(); } };'
    });
  });
  await page.route('**/unpkg.com/docx@8.5.0/build/index.umd.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.docx = window.docx || {};'
    });
  });

  await login(page);

  await page.evaluate(() => {
    const storageKey = 'eyawriter-projects-v5';
    const project = {
      id: 'project-export-fdx-journey',
      scriptId: 'FDX123',
      title: 'Final Draft Journey',
      author: 'Lenon',
      genre: 'Drama',
      version: 4,
      contact: 'lenon@example.com',
      company: 'Wraita Studio',
      details: 'Phase 3',
      logline: 'A writer verifies the Final Draft export pipeline.',
      createdAt: '2026-06-11T09:00:00.000Z',
      updatedAt: '2026-06-11T09:00:00.000Z',
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. STUDIO - DAY' },
        { id: 'line-1', type: 'action', text: 'A clean export dialog glows on screen.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'If this opens in Final Draft, we are in good shape.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. COURTYARD - SUNSET' },
        { id: 'line-4', type: 'action', text: 'The team watches the download finish.' },
        { id: 'line-5', type: 'character', text: 'RUIZ' },
        { id: 'line-6', type: 'dialogue', text: 'History should remember the FDX too.' }
      ],
      activityLog: [],
      exportHistory: []
    };

    localStorage.setItem(storageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      currentProjectId: project.id,
      currentWorkspaceId: null,
      projects: [project],
      aiAssist: false,
      toolStripCollapsed: false,
      autoNumberScenes: true,
      backgroundAnimation: false,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      grammarCheck: false,
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      tourShown: true
    }));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 20000 });

  const studioHidden = await page.locator('#studioView').getAttribute('hidden').catch(() => '');
  if (studioHidden !== null) {
    const projectCard = page.locator('.project-card').filter({ hasText: 'Final Draft Journey' }).first();
    await expect(projectCard).toBeVisible({ timeout: 15000 });
    await projectCard.locator('.project-card-open').click();
  }

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });

  await page.selectOption('#exportFormatSelect', 'fdx');
  await expect(page.locator('#exportFormatDescription')).toContainText(/Final Draft/i);
  await expect(page.locator('#exportDialogGenerateBtn')).toContainText('Download FDX');

  const fdxDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('#exportDialogGenerateBtn').click();
  const fdxDownload = await fdxDownloadPromise;

  expect(fdxDownload.suggestedFilename()).toBe('final-draft-journey-full-script.fdx');

  const tempPath = path.join(os.tmpdir(), `wraita-fdx-${Date.now()}.fdx`);
  await fdxDownload.saveAs(tempPath);
  const fdxContent = await fs.readFile(tempPath, 'utf8');

  expect(fdxContent).toContain('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  expect(fdxContent).toContain('<FinalDraft DocumentType="Script"');
  expect(fdxContent).toContain('<TitlePage>');
  expect(fdxContent).toContain('Final Draft Journey');
  expect(fdxContent).toContain('Written by');
  expect(fdxContent).toContain('Type="Scene Heading"');
  expect(fdxContent).toContain('Type="Dialogue"');
  expect(fdxContent).toContain('INT. STUDIO - DAY');

  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  const historyItems = page.locator('.export-history-item');
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
  await expect(historyItems.first()).toContainText('Full Script');
  await expect(historyItems.first()).toContainText('FDX');

  await historyItems.first().locator('[data-export-history-action="view"]').click();
  await expect(page.locator('#customModal[open]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#customModal')).toContainText('Type: Full Script');
  await expect(page.locator('#customModal')).toContainText('Format: FDX');
  await page.evaluate(() => document.getElementById('customModal')?.close());
});

test('user-style Shooting Script PDF flow opens the print export and records export history', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.THREE = window.THREE || {};'
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.emailjs = window.emailjs || { init() {}, send() { return Promise.resolve(); } };'
    });
  });
  await page.route('**/unpkg.com/docx@8.5.0/build/index.umd.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.docx = window.docx || {};'
    });
  });

  await login(page);

  await page.evaluate(() => {
    const storageKey = 'eyawriter-projects-v5';
    const project = {
      id: 'project-export-shooting-journey',
      scriptId: 'SHOT01',
      title: 'Shooting Draft Journey',
      author: 'Lenon',
      genre: 'Thriller',
      version: 5,
      contact: 'lenon@example.com',
      company: 'Wraita Studio',
      details: 'Locked pages review',
      logline: 'A production team tests the shooting script export from the live app.',
      createdAt: '2026-06-12T09:30:00.000Z',
      updatedAt: '2026-06-12T10:30:00.000Z',
      comments: [
        { id: 'comment-1', sceneId: 'scene-1', author: 'Editor', text: 'Flag the opening beat for revision review.' }
      ],
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. CONTROL ROOM - NIGHT' },
        { id: 'line-1', type: 'action', text: 'Monitors flicker while the crew studies the timeline.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'Lock the pages before the morning call sheet goes out.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. BACKLOT - DAWN' },
        { id: 'line-4', type: 'action', text: 'Rain hangs in the air above the set walls.' },
        { id: 'line-5', type: 'character', text: 'RUIZ' },
        { id: 'line-6', type: 'dialogue', text: 'The shooting script needs clean numbers and revision labels.' }
      ],
      activityLog: [],
      exportHistory: []
    };

    localStorage.setItem(storageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      currentProjectId: project.id,
      currentWorkspaceId: null,
      projects: [project],
      aiAssist: false,
      toolStripCollapsed: false,
      autoNumberScenes: true,
      backgroundAnimation: false,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      grammarCheck: false,
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      tourShown: true
    }));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 20000 });

  const studioHidden = await page.locator('#studioView').getAttribute('hidden').catch(() => '');
  if (studioHidden !== null) {
    const projectCard = page.locator('.project-card').filter({ hasText: 'Shooting Draft Journey' }).first();
    await expect(projectCard).toBeVisible({ timeout: 15000 });
    await projectCard.locator('.project-card-open').click();
  }

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });

  await page.selectOption('#exportTypeSelect', 'shooting');
  await expect(page.locator('#exportTypeDescription')).toContainText(/locked-scene|shooting script/i);
  await expect(page.locator('#exportFormatSelect')).toHaveValue('pdf');
  await expect(page.locator('#exportDialogGenerateBtn')).toContainText('Open Shooting Script PDF');

  await expect(page.locator('#exportIncludePageNumbers')).toBeChecked();
  await page.locator('#exportIncludeRevisions').check();
  await expect(page.locator('#exportSummaryChips')).toContainText('Shooting Script');
  await expect(page.locator('#exportSummaryChips')).toContainText('Locked scene numbers');
  await expect(page.locator('#exportSummaryChips')).toContainText('Revisions on');

  await page.locator('#exportDialogGenerateBtn').click();
  await page.waitForSelector('#printExportFrame', { timeout: 60000, state: 'attached' });
  const printHtml = await page.locator('#printExportFrame').evaluate((frame) => frame.getAttribute('srcdoc') || '');
  expect(printHtml).toContain('Shooting Script');
  expect(printHtml).toContain('Revision marks on');
  expect(printHtml).toContain('Page numbers on');
  expect(printHtml).toContain('1. INT. CONTROL ROOM - NIGHT');
  expect(printHtml).toContain('Lock the pages before the morning call sheet goes out.');

  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  const historyItems = page.locator('.export-history-item');
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
  await expect(historyItems.first()).toContainText('Shooting Script');
  await expect(historyItems.first()).toContainText('PDF');

  await historyItems.first().locator('[data-export-history-action="view"]').click();
  await expect(page.locator('#customModal[open]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#customModal')).toContainText('Type: Shooting Script');
  await expect(page.locator('#customModal')).toContainText('Format: PDF');
  await page.evaluate(() => document.getElementById('customModal')?.close());
});

test('user-style Watermarked Script PDF flow stamps the print export and records export history', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.THREE = window.THREE || {};'
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.emailjs = window.emailjs || { init() {}, send() { return Promise.resolve(); } };'
    });
  });
  await page.route('**/unpkg.com/docx@8.5.0/build/index.umd.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.docx = window.docx || {};'
    });
  });

  await login(page);

  await page.evaluate(() => {
    const storageKey = 'eyawriter-projects-v5';
    const project = {
      id: 'project-export-watermark-journey',
      scriptId: 'MARK01',
      title: 'Watermark Journey',
      author: 'Lenon',
      genre: 'Drama',
      version: 2,
      contact: 'lenon@example.com',
      company: 'Wraita Studio',
      details: 'Sharing review copy',
      logline: 'A protected draft is prepared for controlled review.',
      createdAt: '2026-06-14T11:00:00.000Z',
      updatedAt: '2026-06-14T11:20:00.000Z',
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. WRITERS ROOM - DAY' },
        { id: 'line-1', type: 'action', text: 'Printed pages lie beneath a review stamp.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'Make sure this copy carries the review watermark.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. COURTYARD - EVENING' },
        { id: 'line-4', type: 'action', text: 'A courier locks the packet into a leather case.' },
        { id: 'line-5', type: 'character', text: 'RUIZ' },
        { id: 'line-6', type: 'dialogue', text: 'No unmarked draft should leave the building.' }
      ],
      activityLog: [],
      exportHistory: []
    };

    localStorage.setItem(storageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      currentProjectId: project.id,
      currentWorkspaceId: null,
      projects: [project],
      aiAssist: false,
      toolStripCollapsed: false,
      autoNumberScenes: true,
      backgroundAnimation: false,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      grammarCheck: false,
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      tourShown: true
    }));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 20000 });

  const studioHidden = await page.locator('#studioView').getAttribute('hidden').catch(() => '');
  if (studioHidden !== null) {
    const projectCard = page.locator('.project-card').filter({ hasText: 'Watermark Journey' }).first();
    await expect(projectCard).toBeVisible({ timeout: 15000 });
    await projectCard.locator('.project-card-open').click();
  }

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });

  await page.selectOption('#exportTypeSelect', 'watermarked');
  await expect(page.locator('#exportTypeDescription')).toContainText(/protected screenplay pages/i);
  await expect(page.locator('#exportFormatSelect')).toHaveValue('pdf');
  await expect(page.locator('#exportDialogGenerateBtn')).toContainText('Open PDF Export');

  await page.selectOption('#exportWatermarkPreset', 'CONFIDENTIAL');
  await page.fill('#exportWatermarkText', 'Festival Review Copy');
  await page.selectOption('#exportWatermarkPosition', 'footer');
  await page.selectOption('#exportWatermarkOpacity', '0.24');

  await expect(page.locator('#exportSummaryChips')).toContainText('Watermarked Script');
  await expect(page.locator('#exportSummaryChips')).toContainText('Festival Review Copy');
  await expect(page.locator('#exportSummaryChips')).toContainText('footer');
  await expect(page.locator('#exportSummaryChips')).toContainText('24% opacity');

  await page.locator('#exportDialogGenerateBtn').click();
  await page.waitForSelector('#printExportFrame', { timeout: 60000, state: 'attached' });
  const printHtml = await page.locator('#printExportFrame').evaluate((frame) => frame.getAttribute('srcdoc') || '');
  expect(printHtml).toContain('Watermarked Script');
  expect(printHtml).toContain('Festival Review Copy');
  expect(printHtml).toContain('Position: footer');
  expect(printHtml).toContain('Opacity: 24%');
  expect(printHtml).toContain('print-watermark-footer');
  expect(printHtml).toContain('--print-watermark-opacity:0.24');

  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  const historyItems = page.locator('.export-history-item');
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
  await expect(historyItems.first()).toContainText('Watermarked Script');
  await expect(historyItems.first()).toContainText('PDF');

  await historyItems.first().locator('[data-export-history-action="view"]').click();
  await expect(page.locator('#customModal[open]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#customModal')).toContainText('Type: Watermarked Script');
  await expect(page.locator('#customModal')).toContainText('Format: PDF');
  await page.evaluate(() => document.getElementById('customModal')?.close());
});

test('user-style Collaborative Export flow filters workspace-linked scenes and records export history', async ({ page }) => {
  test.setTimeout(180000);

  await page.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.THREE = window.THREE || {};'
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.emailjs = window.emailjs || { init() {}, send() { return Promise.resolve(); } };'
    });
  });
  await page.route('**/unpkg.com/docx@8.5.0/build/index.umd.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.docx = window.docx || {};'
    });
  });

  await login(page);

  await page.evaluate(() => {
    const storageKey = 'eyawriter-projects-v5';
    const project = {
      id: 'project-export-collaborative-journey',
      scriptId: 'COLLAB1',
      title: 'Collaborative Journey',
      author: 'Lenon',
      logline: 'A team tests scene export from real workspace activity.',
      createdAt: '2026-06-16T09:00:00.000Z',
      updatedAt: '2026-06-16T09:00:00.000Z',
      comments: [
        { id: 'comment-1', sceneId: 'scene-1', author: 'Ruth Reviewer', text: 'Approved once the opening beat lands.' }
      ],
      workspace: {
        tasks: [
          {
            id: 'task-1',
            title: 'Polish opening',
            description: 'Tighten the first scene.',
            status: 'done',
            assignedTo: 'writer-lenon',
            assignedLabel: 'Lenon',
            assigneeType: 'human',
            sceneId: 'scene-1',
            lineId: 'line-1',
            createdByName: 'Ebai',
            comments: [
              { id: 'task-comment-1', author: 'Ruth Reviewer', text: 'Looks approved now.' }
            ]
          },
          {
            id: 'task-2',
            title: 'Reshape ending beat',
            description: 'Keep the second scene in motion.',
            status: 'in-progress',
            assignedTo: 'writer-maya',
            assignedLabel: 'Maya',
            assigneeType: 'human',
            sceneId: 'scene-2',
            lineId: 'line-4',
            createdByName: 'Ebai',
            comments: []
          }
        ]
      },
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. WRITERS ROOM - DAY' },
        { id: 'line-1', type: 'action', text: 'Pinned pages show the first approved beat.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'This scene is ready for the shared export.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. CITY EDGE - NIGHT' },
        { id: 'line-4', type: 'action', text: 'The unfinished rewrite still waits on the curb.' },
        { id: 'line-5', type: 'character', text: 'RUIZ' },
        { id: 'line-6', type: 'dialogue', text: 'Do not export me yet.' }
      ],
      activityLog: [],
      exportHistory: []
    };

    localStorage.setItem(storageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      currentProjectId: project.id,
      currentWorkspaceId: null,
      projects: [project],
      aiAssist: false,
      toolStripCollapsed: false,
      autoNumberScenes: true,
      backgroundAnimation: false,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      grammarCheck: false,
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      tourShown: true
    }));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 20000 });

  const studioHidden = await page.locator('#studioView').getAttribute('hidden').catch(() => '');
  if (studioHidden !== null) {
    const projectCard = page.locator('.project-card').filter({ hasText: 'Collaborative Journey' }).first();
    await expect(projectCard).toBeVisible({ timeout: 15000 });
    await projectCard.locator('.project-card-open').click();
  }

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });

  await page.selectOption('#exportTypeSelect', 'collaborative');
  await expect(page.locator('#exportTypeDescription')).toContainText(/assigned writer|reviewer|editor|workflow status/i);
  await page.selectOption('#exportCollaborativeWriterSelect', { label: 'Lenon' });
  await page.selectOption('#exportCollaborativeReviewerSelect', { label: 'Ruth Reviewer' });
  await page.selectOption('#exportCollaborativeStatusSelect', 'approved');
  await expect(page.locator('#exportSummaryChips')).toContainText('Collaborative Export');
  await expect(page.locator('#exportSummaryChips')).toContainText('Lenon');
  await expect(page.locator('#exportSummaryChips')).toContainText('Reviewer: Ruth Reviewer');
  await expect(page.locator('#exportSummaryChips')).toContainText('approved');

  await page.locator('#exportDialogGenerateBtn').click();
  await page.waitForSelector('#printExportFrame', { timeout: 60000, state: 'attached' });
  const printHtml = await page.locator('#printExportFrame').evaluate((frame) => frame.getAttribute('srcdoc') || '');
  expect(printHtml).toContain('COLLABORATIVE EXPORT');
  expect(printHtml).toContain('Writer: Lenon');
  expect(printHtml).toContain('INT. WRITERS ROOM - DAY');
  expect(printHtml).toContain('This scene is ready for the shared export.');
  expect(printHtml).not.toContain('Do not export me yet.');

  await page.evaluate(() => document.getElementById('exportScreenplayBtn')?.click());
  await expect(page.locator('#exportDialog[open]')).toBeVisible({ timeout: 15000 });
  const historyItems = page.locator('.export-history-item');
  await expect(historyItems).toHaveCount(1, { timeout: 15000 });
  await expect(historyItems.first()).toContainText('Collaborative Export');
  await expect(historyItems.first()).toContainText('PDF');
  await expect(historyItems.first()).toContainText('Lenon');
});
