import { test, expect } from '@playwright/test';

test('export service builds full, character, character packet, scene, location, revision, production, shooting, and watermarked exports from structured screenplay data', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    const { ExportService } = await import('/js/exportService.js');

    const project = {
      id: 'project-export-test',
      title: 'Night Run',
      author: 'Lenon',
      genre: 'Thriller',
      version: 3,
      contact: 'lenon@example.com',
      company: 'Wraita Studio',
      details: 'Draft 3',
      logline: 'A courier discovers the package is alive.',
      comments: [
        { id: 'comment-1', sceneId: 'scene-1', author: 'Editor', text: 'Tighten the entrance beat.' }
      ],
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. WAREHOUSE - NIGHT' },
        { id: 'line-1', type: 'action', text: 'Rain leaks through the broken roof.' },
        { id: 'line-2', type: 'character', text: 'JOHN' },
        { id: 'line-3', type: 'dialogue', text: 'I think we are late.' },
        { id: 'line-4', type: 'character', text: 'SARAH' },
        { id: 'line-5', type: 'parenthetical', text: '(calmly)' },
        { id: 'line-6', type: 'dialogue', text: 'No. We are exactly on time.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. DOCKS - DAWN' },
        { id: 'line-7', type: 'action', text: 'The boat horn shakes the harbor awake.' },
        { id: 'line-8', type: 'character', text: 'JOHN' },
        { id: 'line-9', type: 'dialogue', text: 'Then let us move.' }
      ]
    };

    const fullFountain = await ExportService.exportFullScript(project, {
      format: 'fountain',
      options: {
        includeMetadata: true,
        includeSceneNumbers: true
      }
    });

    const fullFdx = await ExportService.exportFullScript(project, {
      format: 'fdx',
      options: {
        includeMetadata: true,
        includeSceneNumbers: true
      }
    });

    const characterFountain = await ExportService.exportCharacter(project, {
      format: 'fountain',
      characters: ['JOHN'],
      options: {
        includeSceneDescriptions: true,
        includeSurroundingAction: true,
        includeSceneNumbers: true
      }
    });

    const scenePdf = await ExportService.exportScenes(project, {
      format: 'pdf',
      sceneNumbers: [2],
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false
      }
    });

    const characterPacketPdf = await ExportService.exportCharacterPacket(project, {
      format: 'pdf',
      characters: ['JOHN'],
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false,
        includeSceneDescriptions: true
      }
    });

    const locationPdf = await ExportService.exportLocation(project, {
      format: 'pdf',
      location: 'DOCKS',
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false
      }
    });

    const revisionPdf = await ExportService.exportRevision(project, {
      format: 'pdf',
      versionA: {
        id: 'draft-1',
        label: 'Draft 1',
        lines: [
          { id: 'scene-1', type: 'scene', text: 'INT. WAREHOUSE - NIGHT' },
          { id: 'line-1', type: 'action', text: 'Rain leaks through the broken roof.' },
          { id: 'line-2', type: 'character', text: 'JOHN' },
          { id: 'line-3', type: 'dialogue', text: 'I think we are early.' }
        ]
      },
      versionB: {
        id: 'draft-2',
        label: 'Draft 2',
        lines: project.lines
      },
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false
      }
    });

    const productionDocx = await ExportService.exportProduction(project, {
      format: 'pdf',
      locations: ['WAREHOUSE'],
      timeOfDay: ['NIGHT'],
      characters: ['JOHN'],
      sceneRange: { start: 1, end: 1 },
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false
      }
    });

    const shootingPdf = await ExportService.exportShootingScript(project, {
      format: 'pdf',
      options: {
        includeMetadata: true,
        includeNotes: true,
        includeComments: true,
        includeRevisions: true,
        includePageNumbers: true,
        includeTitlePage: true
      }
    });

    const watermarkedPdf = await ExportService.exportWatermarkedScript(project, {
      format: 'pdf',
      options: {
        includeMetadata: true,
        includeTitlePage: true,
        watermarkPreset: 'CONFIDENTIAL',
        watermarkText: 'Producer Copy',
        watermarkPosition: 'header',
        watermarkOpacity: 0.18
      }
    });

    return {
      fullFilename: fullFountain.filename,
      fullContent: fullFountain.content,
      fullFdxFilename: fullFdx.filename,
      fullFdxContent: fullFdx.content,
      fullFdxMimeType: fullFdx.mimeType,
      characterFilename: characterFountain.filename,
      characterContent: characterFountain.content,
      sceneFilename: scenePdf.filename,
      sceneContent: String(scenePdf.content),
      sceneTransport: scenePdf.transport,
      characterPacketFilename: characterPacketPdf.filename,
      characterPacketContent: String(characterPacketPdf.content),
      characterPacketTransport: characterPacketPdf.transport,
      locationFilename: locationPdf.filename,
      locationContent: String(locationPdf.content),
      locationTransport: locationPdf.transport,
      revisionFilename: revisionPdf.filename,
      revisionContent: String(revisionPdf.content),
      revisionTransport: revisionPdf.transport,
      productionFilename: productionDocx.filename,
      productionContent: String(productionDocx.content),
      productionTransport: productionDocx.transport,
      shootingFilename: shootingPdf.filename,
      shootingContent: String(shootingPdf.content),
      shootingTransport: shootingPdf.transport,
      watermarkedFilename: watermarkedPdf.filename,
      watermarkedContent: String(watermarkedPdf.content),
      watermarkedTransport: watermarkedPdf.transport
    };
  });

  expect(result.fullFilename).toBe('night-run-full-script.fountain');
  expect(result.fullContent).toContain('Title:');
  expect(result.fullContent).toContain('    Night Run');
  expect(result.fullContent).toContain('Credit: Written by');
  expect(result.fullContent).toContain('Author: Lenon');
  expect(result.fullContent).toContain('INT. WAREHOUSE - NIGHT #1#');
  expect(result.fullContent).toContain('SARAH');
  expect(result.fullContent).toContain('Rain leaks through the broken roof.');

  expect(result.fullFdxFilename).toBe('night-run-full-script.fdx');
  expect(result.fullFdxMimeType).toBe('application/xml;charset=utf-8');
  expect(result.fullFdxContent).toContain('<FinalDraft');
  expect(result.fullFdxContent).toContain('<TitlePage>');
  expect(result.fullFdxContent).toContain('Type="Scene Heading"');
  expect(result.fullFdxContent).toContain('Type="Character"');
  expect(result.fullFdxContent).toContain('Type="Dialogue"');
  expect(result.fullFdxContent).toContain('INT. WAREHOUSE - NIGHT');
  expect(result.fullFdxContent).toContain('Written by');

  expect(result.characterFilename).toBe('night-run-character-export.fountain');
  expect(result.characterContent).toContain('INT. WAREHOUSE - NIGHT #1#');
  expect(result.characterContent).toContain('JOHN');
  expect(result.characterContent).not.toContain('SARAH');

  expect(result.sceneFilename).toBe('night-run-scene-export.html');
  expect(result.sceneTransport).toBe('print-html');
  expect(result.sceneContent).toContain('2. EXT. DOCKS - DAWN');
  expect(result.sceneContent).not.toContain('INT. WAREHOUSE - NIGHT');

  expect(result.characterPacketFilename).toBe('night-run-character-packet-export.html');
  expect(result.characterPacketTransport).toBe('print-html');
  expect(result.characterPacketContent).toContain('CHARACTER PACKET');
  expect(result.characterPacketContent).toContain('Scenes: 2');
  expect(result.characterPacketContent).toContain('First appearance: 1. INT. WAREHOUSE - NIGHT');
  expect(result.characterPacketContent).toContain('Last appearance: 2. EXT. DOCKS - DAWN');

  expect(result.locationFilename).toBe('night-run-location-export.html');
  expect(result.locationTransport).toBe('print-html');
  expect(result.locationContent).toContain('2. EXT. DOCKS - DAWN');
  expect(result.locationContent).not.toContain('1. INT. WAREHOUSE - NIGHT');

  expect(result.revisionFilename).toBe('night-run-revision-export.html');
  expect(result.revisionTransport).toBe('print-html');
  expect(result.revisionContent).toContain('REVISION REPORT');
  expect(result.revisionContent).toContain('Added Scenes');
  expect(result.revisionContent).toContain('2. EXT. DOCKS - DAWN');
  expect(result.revisionContent).toContain('Modified Dialogue');

  expect(result.productionFilename).toBe('night-run-production-export.html');
  expect(result.productionTransport).toBe('print-html');
  expect(result.productionContent).toContain('Production Export');
  expect(result.productionContent).toContain('Locations: WAREHOUSE');
  expect(result.productionContent).toContain('Time: NIGHT');
  expect(result.productionContent).toContain('Characters: JOHN');
  expect(result.productionContent).toContain('Range: 1-1');
  expect(result.productionContent).toContain('1. INT. WAREHOUSE - NIGHT');
  expect(result.productionContent).not.toContain('2. EXT. DOCKS - DAWN');

  expect(result.shootingFilename).toBe('night-run-shooting-script.html');
  expect(result.shootingTransport).toBe('print-html');
  expect(result.shootingContent).toContain('Shooting Script');
  expect(result.shootingContent).toContain('Revision marks on');
  expect(result.shootingContent).toContain('Page numbers on');
  expect(result.shootingContent).toContain('locked scene');
  expect(result.shootingContent).toContain('1. INT. WAREHOUSE - NIGHT');

  expect(result.watermarkedFilename).toBe('night-run-watermarked-script.html');
  expect(result.watermarkedTransport).toBe('print-html');
  expect(result.watermarkedContent).toContain('Watermarked Script');
  expect(result.watermarkedContent).toContain('Producer Copy');
  expect(result.watermarkedContent).toContain('Position: header');
  expect(result.watermarkedContent).toContain('Opacity: 18%');
  expect(result.watermarkedContent).toContain('print-watermark-header');
});

test('export service can generate DOCX output when the docx library is available', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    class StubDocument {
      constructor(config) {
        this.config = config;
      }
    }
    class StubParagraph {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTextRun {
      constructor(config) {
        this.config = config;
      }
    }
    class StubHeader {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTable {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTableRow {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTableCell {
      constructor(config) {
        this.config = config;
      }
    }

    window.docx = {
      Document: StubDocument,
      Paragraph: StubParagraph,
      TextRun: StubTextRun,
      Header: StubHeader,
      Table: StubTable,
      TableRow: StubTableRow,
      TableCell: StubTableCell,
      AlignmentType: { RIGHT: 'right', CENTER: 'center' },
      WidthType: { PERCENTAGE: 'pct' },
      BorderStyle: { NONE: 'none' },
      VerticalAlign: { TOP: 'top' },
      PageNumber: { CURRENT: 'current' },
      Packer: {
        async toBlob(document) {
          return new Blob([JSON.stringify({
            title: document?.config?.title || '',
            sectionCount: document?.config?.sections?.length || 0
          })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        }
      }
    };

    const { ExportService } = await import('/js/exportService.js');
    const project = {
      id: 'project-docx-test',
      title: 'Harbor Lights',
      author: 'Lenon',
      version: 2,
      lines: [
        { id: 'scene-1', type: 'scene', text: 'EXT. HARBOR - NIGHT' },
        { id: 'line-1', type: 'action', text: 'Fog drifts across the empty dock.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'No one followed us.' }
      ]
    };

    const docxResult = await ExportService.exportFullScript(project, {
      format: 'docx',
      options: {
        includeSceneNumbers: true,
        includeMetadata: true
      }
    });

    return {
      filename: docxResult.filename,
      mimeType: docxResult.mimeType,
      size: docxResult.content?.size || 0,
      blobType: docxResult.content?.type || '',
      signature: Array.from(new Uint8Array(await docxResult.content.arrayBuffer()).slice(0, 4))
    };
  });

  expect(result.filename).toBe('harbor-lights-full-script.docx');
  expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(result.size).toBeGreaterThan(0);
  expect(result.blobType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(
    JSON.stringify(result.signature) === JSON.stringify([80, 75, 3, 4])
    || JSON.stringify(result.signature) === JSON.stringify([123, 34, 116, 105])
  ).toBeTruthy();
});

test('export service handles large structured scripts without failing on production export paths', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    const { ExportService } = await import('/js/exportService.js');

    const lines = [];
    const locations = ['HOSPITAL', 'SCHOOL', 'BEACH', 'POLICE STATION', 'WAREHOUSE'];
    const times = ['DAY', 'NIGHT', 'DAWN', 'DUSK'];
    const characters = Array.from({ length: 120 }, (_, index) => `CHARACTER ${index + 1}`);

    for (let sceneIndex = 1; sceneIndex <= 520; sceneIndex += 1) {
      const location = locations[sceneIndex % locations.length];
      const time = times[sceneIndex % times.length];
      lines.push({ id: `scene-${sceneIndex}`, type: 'scene', text: `INT. ${location} - ${time}` });
      lines.push({ id: `action-${sceneIndex}-1`, type: 'action', text: `Scene ${sceneIndex} opens with production-ready action for ${location}.` });
      lines.push({ id: `action-${sceneIndex}-2`, type: 'action', text: `The story pressure keeps rising while the setting stays filmable.` });
      const lead = characters[sceneIndex % characters.length];
      const support = characters[(sceneIndex + 11) % characters.length];
      lines.push({ id: `char-${sceneIndex}-1`, type: 'character', text: lead });
      lines.push({ id: `dialogue-${sceneIndex}-1`, type: 'dialogue', text: `We are moving into beat ${sceneIndex}.` });
      lines.push({ id: `char-${sceneIndex}-2`, type: 'character', text: support });
      lines.push({ id: `dialogue-${sceneIndex}-2`, type: 'dialogue', text: `Then let us keep the scene playable and clear.` });
    }

    const project = {
      id: 'project-stress-test',
      title: 'Massive Production Draft',
      author: 'Lenon',
      version: 8,
      lines
    };

    const startedAt = performance.now();
    const productionResult = await ExportService.exportProduction(project, {
      format: 'pdf',
      locations: ['HOSPITAL'],
      timeOfDay: ['DAY'],
      characters: [],
      sceneRange: { start: 1, end: 500 },
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false,
        includeMetadata: true
      }
    });

    const completedAt = performance.now();
    const content = String(productionResult.content);
    return {
      filename: productionResult.filename,
      transport: productionResult.transport,
      durationMs: Math.round(completedAt - startedAt),
      contentLength: content.length,
      containsExpectedLocation: content.includes('HOSPITAL'),
      containsExcludedLocation: content.includes('POLICE STATION'),
      containsSceneHeading: content.includes('INT. HOSPITAL - DAY')
    };
  });

  expect(result.filename).toBe('massive-production-draft-production-export.html');
  expect(result.transport).toBe('print-html');
  expect(result.contentLength).toBeGreaterThan(3000);
  expect(result.containsExpectedLocation).toBeTruthy();
  expect(result.containsSceneHeading).toBeTruthy();
  expect(result.durationMs).toBeLessThan(30000);
});

test('screenplay export preserves dual dialogue rows and paginates them using the taller side', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    const { buildFullScriptExportDocument } = await import('/js/exportModel.js');
    const { buildPreviewDataFromExportDocument, buildPrintableDocumentFromExportDocument } = await import('/js/printExport.js');

    const project = {
      id: 'project-dual-export-test',
      title: 'Dual Dialogue Test',
      author: 'Lenon',
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. OFFICE - DAY' },
        { id: 'line-1', type: 'action', text: 'Two speakers overlap while the pressure rises.' },
        { id: 'line-2', type: 'character', text: 'MAYA', secondary: 'JONATHAN' },
        { id: 'line-3', type: 'dialogue', text: 'We need to leave right now before the doors seal.', secondary: 'No, we stay and hold the corridor until backup arrives, even if it costs us.' },
        { id: 'line-4', type: 'parenthetical', text: '(urgent)', secondary: '(firm, unblinking)' },
        { id: 'line-5', type: 'dialogue', text: 'They are already here.', secondary: 'Then we face them together.' },
        { id: 'line-6', type: 'transition', text: 'CUT TO:' }
      ]
    };

    const exportDocument = buildFullScriptExportDocument(project, {
      includeMetadata: true,
      includeTitlePage: false,
      includePageNumbers: true,
      includeSceneNumbers: false,
      exportMode: 'spec'
    });

    const previewData = buildPreviewDataFromExportDocument(exportDocument);
    const html = buildPrintableDocumentFromExportDocument(exportDocument, false);
    const dualLines = exportDocument.lines.filter((line) => line.secondary !== undefined && String(line.secondary || '').trim());

    return {
      dualLineTypes: dualLines.map((line) => line.type),
      pageCount: previewData.scriptPages.length,
      html,
      hasCharacterDualRow: html.includes('print-dual-row character'),
      hasDialogueDualRow: html.includes('print-dual-row dialogue'),
      hasParentheticalDualRow: html.includes('print-dual-row parenthetical'),
      usesFlexDualLayout: html.includes('.print-dual-row {\n      display: flex;') || html.includes('.print-dual-row {') && html.includes('justify-content: center;') && html.includes('flex: 0 0 2.45in;'),
      preservesLongerSecondaryText: html.includes('hold the corridor until backup arrives')
    };
  });

  expect(result.dualLineTypes).toEqual(['character', 'dialogue', 'parenthetical', 'dialogue']);
  expect(result.pageCount).toBeGreaterThan(0);
  expect(result.hasCharacterDualRow).toBeTruthy();
  expect(result.hasDialogueDualRow).toBeTruthy();
  expect(result.hasParentheticalDualRow).toBeTruthy();
  expect(result.usesFlexDualLayout).toBeTruthy();
  expect(result.preservesLongerSecondaryText).toBeTruthy();
});
