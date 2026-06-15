import { formatLineText, normalizeLineText, slugify } from './utils.js';

const DEFAULT_OPTIONS = {
  includeNotes: false,
  includeComments: false,
  includeSceneNumbers: false,
  includeMetadata: true,
  includeTitlePage: true,
  includeSurroundingAction: false,
  includeSceneDescriptions: true,
  includeRevisions: false,
  includePageNumbers: true,
  watermarkText: '',
  watermarkPreset: '',
  watermarkPosition: 'diagonal',
  watermarkOpacity: 0.12
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeMetadata(project = {}) {
  const coverPage = project.coverPage && typeof project.coverPage === 'object' ? project.coverPage : {};
  return {
    title: String(coverPage.title || project.title || 'Untitled Script').trim() || 'Untitled Script',
    subtitle: String(coverPage.subtitle || '').trim(),
    author: String(coverPage.author || project.author || '').trim(),
    coWriters: String(coverPage.coWriters || '').trim(),
    genre: String(project.genre || '').trim(),
    version: Number.isFinite(Number(coverPage.version ?? project.version)) ? Number(coverPage.version ?? project.version) : 0,
    contact: String(coverPage.contact || project.contact || '').trim(),
    company: String(coverPage.company || project.company || '').trim(),
    details: String(coverPage.details || project.details || '').trim(),
    copyrightNotice: String(coverPage.copyrightNotice || '').trim(),
    draftDate: String(coverPage.draftDate || '').trim(),
    logline: String(project.logline || '').trim(),
    projectId: String(project.id || '').trim(),
    scriptId: String(project.scriptId || '').trim(),
    createdAt: String(project.createdAt || '').trim(),
    updatedAt: String(project.updatedAt || '').trim()
  };
}

function parseSceneHeadingParts(heading) {
  const value = String(heading || '').trim();
  const match = value.match(/^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|EST\.)\s*(.*?)(?:\s*-\s*([A-Z0-9'\/ .-]+))?$/i);
  if (!match) {
    return {
      location: value,
      timeOfDay: ''
    };
  }

  return {
    location: String(match[2] || '').trim(),
    timeOfDay: String(match[3] || '').trim()
  };
}

function formatSceneHeading(text, sceneNumber, options) {
  const heading = formatLineText(text, 'scene');
  return options.includeSceneNumbers ? `${sceneNumber}. ${heading}` : heading;
}

function buildPreparedLines(project, options) {
  const prepared = [];
  let sceneNumber = 0;

  toArray(project.lines).forEach((line, index) => {
    const type = String(line?.type || 'action');
    const rawText = String(line?.text || '');
    const normalized = formatLineText(rawText, type);
    if (!normalized) {
      return;
    }

    if (type === 'scene') {
      sceneNumber += 1;
    }

    if (type === 'note' && !options.includeNotes) {
      return;
    }

    prepared.push({
      id: String(line?.id || `line_${index}`),
      type,
      text: normalizeLineText(rawText, type),
      displayText: type === 'scene'
        ? formatSceneHeading(rawText, sceneNumber, options)
        : formatLineText(rawText, type),
      secondary: typeof line?.secondary === 'string' ? formatLineText(line.secondary, type) : '',
      sceneNumber,
      index
    });
  });

  return prepared;
}

function extractCharactersFromLines(lines) {
  const characters = new Map();

  lines.forEach((line) => {
    if (line.type !== 'character' && line.type !== 'dual') {
      return;
    }
    const name = String(line.displayText || '').replace(/\s*\(CONT'D\)\s*$/i, '').trim();
    if (!name) {
      return;
    }
    characters.set(name.toUpperCase(), {
      name,
      normalizedName: name.toUpperCase()
    });
  });

  return [...characters.values()];
}

function buildScenes(lines) {
  const scenes = [];
  let currentScene = null;

  function ensureOpenScene() {
    if (currentScene) {
      return currentScene;
    }
    currentScene = {
      id: 'scene_0',
      number: 0,
      heading: 'OPENING',
      location: '',
      timeOfDay: '',
      description: [],
      dialogue: [],
      characters: [],
      notes: [],
      comments: [],
      transitions: [],
      lines: [],
      startLineIndex: 0,
      endLineIndex: 0
    };
    scenes.push(currentScene);
    return currentScene;
  }

  let activeDialogueBlock = null;

  lines.forEach((line) => {
    if (line.type === 'scene') {
      const parts = parseSceneHeadingParts(line.text || line.displayText);
      currentScene = {
        id: line.id,
        number: Number(line.sceneNumber || scenes.length + 1),
        heading: line.displayText,
        location: parts.location,
        timeOfDay: parts.timeOfDay,
        description: [],
        dialogue: [],
        characters: [],
        notes: [],
        comments: [],
        transitions: [],
        lines: [line],
        startLineIndex: line.index,
        endLineIndex: line.index
      };
      scenes.push(currentScene);
      activeDialogueBlock = null;
      return;
    }

    const scene = ensureOpenScene();
    scene.lines.push(line);
    scene.endLineIndex = line.index;

    if (line.type === 'action' || line.type === 'shot' || line.type === 'text' || line.type === 'image') {
      scene.description.push(line.displayText);
      activeDialogueBlock = null;
      return;
    }

    if (line.type === 'transition') {
      scene.transitions.push(line.displayText);
      activeDialogueBlock = null;
      return;
    }

    if (line.type === 'note') {
      scene.notes.push(line.displayText);
      activeDialogueBlock = null;
      return;
    }

    if (line.type === 'character' || line.type === 'dual') {
      const characterName = String(line.displayText || '').replace(/\s*\(CONT'D\)\s*$/i, '').trim();
      activeDialogueBlock = {
        character: characterName,
        parentheticals: [],
        dialogue: []
      };
      scene.dialogue.push(activeDialogueBlock);
      if (characterName && !scene.characters.includes(characterName)) {
        scene.characters.push(characterName);
      }
      return;
    }

    if (line.type === 'parenthetical') {
      if (activeDialogueBlock) {
        activeDialogueBlock.parentheticals.push(line.displayText);
      }
      return;
    }

    if (line.type === 'dialogue') {
      if (activeDialogueBlock) {
        activeDialogueBlock.dialogue.push(line.displayText);
      }
    }
  });

  return scenes;
}

function normalizeComments(project) {
  return toArray(project.comments).map((comment, index) => ({
    id: String(comment?.id || `comment_${index}`),
    lineId: String(comment?.lineId || ''),
    sceneId: String(comment?.sceneId || ''),
    author: String(comment?.author || comment?.userName || '').trim(),
    text: String(comment?.text || comment?.body || '').trim(),
    createdAt: String(comment?.createdAt || '').trim()
  })).filter((comment) => comment.text);
}

function normalizeAssignments(project) {
  return toArray(project.assignments || project.workspace?.tasks).map((assignment, index) => ({
    id: String(assignment?.id || `assignment_${index}`),
    title: String(assignment?.title || '').trim(),
    description: String(assignment?.description || '').trim(),
    assignee: String(assignment?.assignee || assignment?.assignedTo || '').trim(),
    status: String(assignment?.status || '').trim(),
    sceneId: String(assignment?.sceneId || '').trim(),
    lineId: String(assignment?.lineId || '').trim()
  })).filter((assignment) => assignment.title || assignment.description);
}

function normalizeTags(project) {
  return toArray(project.tags).map((tag) => String(tag || '').trim()).filter(Boolean);
}

function cloneLine(line) {
  return {
    ...line,
    secondary: line.secondary || ''
  };
}

function appendCommentsAsNotes(lines, comments) {
  if (!comments.length) {
    return lines;
  }

  const commentLines = [
    { id: 'export-comments-scene', type: 'scene', text: 'COMMENTS', displayText: 'COMMENTS', secondary: '', sceneNumber: 0, index: Number.MAX_SAFE_INTEGER - 1 }
  ];

  comments.forEach((comment, index) => {
    const authorPrefix = comment.author ? `${comment.author}: ` : '';
    commentLines.push({
      id: comment.id || `export-comment-${index}`,
      type: 'note',
      text: `${authorPrefix}${comment.text}`,
      displayText: `[${authorPrefix}${comment.text}]`,
      secondary: '',
      sceneNumber: 0,
      index: Number.MAX_SAFE_INTEGER + index
    });
  });

  return [...lines.map(cloneLine), ...commentLines];
}

function sceneMatchesSelection(scene, selectedSceneIds, selectedSceneNumbers, range) {
  if (selectedSceneIds.size && selectedSceneIds.has(scene.id)) {
    return true;
  }
  if (selectedSceneNumbers.size && selectedSceneNumbers.has(scene.number)) {
    return true;
  }
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end)) {
    return scene.number >= range.start && scene.number <= range.end;
  }
  return !selectedSceneIds.size && !selectedSceneNumbers.size && !range;
}

function sceneMatchesProductionFilters(scene, filters = {}) {
  const selectedLocations = new Set(toArray(filters.locations).map(normalizeToken).filter(Boolean));
  const selectedTimes = new Set(toArray(filters.timeOfDay).map(normalizeToken).filter(Boolean));
  const selectedCharacters = new Set(toArray(filters.characters).map(normalizeToken).filter(Boolean));
  const range = filters.sceneRange && Number.isFinite(Number(filters.sceneRange.start)) && Number.isFinite(Number(filters.sceneRange.end))
    ? {
      start: Math.min(Number(filters.sceneRange.start), Number(filters.sceneRange.end)),
      end: Math.max(Number(filters.sceneRange.start), Number(filters.sceneRange.end))
    }
    : null;

  if (selectedLocations.size && !selectedLocations.has(normalizeToken(scene.location))) {
    return false;
  }
  if (selectedTimes.size && !selectedTimes.has(normalizeToken(scene.timeOfDay))) {
    return false;
  }
  if (selectedCharacters.size) {
    const sceneCharacters = new Set(toArray(scene.characters).map(normalizeToken).filter(Boolean));
    const hasCharacterMatch = [...selectedCharacters].some((character) => sceneCharacters.has(character));
    if (!hasCharacterMatch) {
      return false;
    }
  }
  if (range && (scene.number < range.start || scene.number > range.end)) {
    return false;
  }

  return true;
}

function buildSceneLineIndexSet(scenes) {
  const indexes = new Set();
  toArray(scenes).forEach((scene) => {
    const start = Number(scene?.startLineIndex);
    const end = Number(scene?.endLineIndex);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    for (let index = start; index <= end; index += 1) {
      indexes.add(index);
    }
  });
  return indexes;
}

function buildSceneSelectionDocument(baseDocument, request) {
  const selectedSceneIds = new Set(toArray(request.sceneIds).map((value) => String(value || '')));
  const selectedSceneNumbers = new Set(toArray(request.sceneNumbers).map((value) => Number(value)).filter(Number.isFinite));
  const range = request.sceneRange && Number.isFinite(Number(request.sceneRange.start)) && Number.isFinite(Number(request.sceneRange.end))
    ? { start: Number(request.sceneRange.start), end: Number(request.sceneRange.end) }
    : null;

  const selectedScenes = baseDocument.scenes.filter((scene) => sceneMatchesSelection(scene, selectedSceneIds, selectedSceneNumbers, range));
  const selectedSceneIdSet = new Set(selectedScenes.map((scene) => scene.id));
  const selectedLineIndexes = buildSceneLineIndexSet(selectedScenes);
  let lines = baseDocument.lines.filter((line) => selectedSceneIdSet.has(line.id) || selectedLineIndexes.has(line.index));

  if (baseDocument.options.includeComments) {
    const comments = baseDocument.comments.filter((comment) => !comment.sceneId || selectedSceneIdSet.has(comment.sceneId));
    lines = appendCommentsAsNotes(lines, comments);
  }

  return {
    ...baseDocument,
    exportType: 'scene',
    selection: {
      sceneIds: [...selectedSceneIds],
      sceneNumbers: [...selectedSceneNumbers],
      sceneRange: range
    },
    scenes: selectedScenes,
    lines,
    characters: extractCharactersFromLines(lines)
  };
}

function findSpeechBlockBounds(sceneLines, startIndex) {
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < sceneLines.length; index += 1) {
    const candidate = sceneLines[index];
    if (!candidate || ['scene', 'character', 'dual', 'transition'].includes(candidate.type)) {
      break;
    }
    if (!['parenthetical', 'dialogue', 'action', 'shot', 'text', 'image'].includes(candidate.type)) {
      break;
    }
    endIndex = index;
    if (candidate.type === 'action' || candidate.type === 'shot' || candidate.type === 'text' || candidate.type === 'image') {
      break;
    }
  }
  return endIndex;
}

function buildCharacterSelectionDocument(baseDocument, request) {
  const selectedNames = new Set(toArray(request.characters).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean));
  const includeSurroundingAction = Boolean(baseDocument.options.includeSurroundingAction);
  const includeSceneDescriptions = Boolean(baseDocument.options.includeSceneDescriptions);

  const selectedScenes = [];
  const selectedLines = [];
  const seenLineIds = new Set();

  baseDocument.scenes.forEach((scene) => {
    const sceneLines = baseDocument.lines.filter((line) => line.index >= scene.startLineIndex && line.index <= scene.endLineIndex);
    const matchedLineIndexes = [];

    sceneLines.forEach((line, index) => {
      if (!['character', 'dual'].includes(line.type)) {
        return;
      }
      const normalizedName = String(line.displayText || '').replace(/\s*\(CONT'D\)\s*$/i, '').trim().toUpperCase();
      if (selectedNames.has(normalizedName)) {
        matchedLineIndexes.push(index);
      }
    });

    if (!matchedLineIndexes.length) {
      return;
    }

    selectedScenes.push(scene);

    const addLine = (line) => {
      if (!line || seenLineIds.has(line.id)) {
        return;
      }
      seenLineIds.add(line.id);
      selectedLines.push(cloneLine(line));
    };

    addLine(sceneLines[0]);

    if (includeSceneDescriptions) {
      sceneLines
        .filter((line) => ['action', 'shot', 'text', 'image'].includes(line.type))
        .forEach(addLine);
    }

    matchedLineIndexes.forEach((matchIndex) => {
      if (includeSurroundingAction) {
        const previous = sceneLines[matchIndex - 1];
        if (previous && ['action', 'shot', 'text', 'image'].includes(previous.type)) {
          addLine(previous);
        }
      }

      const endIndex = findSpeechBlockBounds(sceneLines, matchIndex);
      for (let index = matchIndex; index <= endIndex; index += 1) {
        addLine(sceneLines[index]);
      }

      if (includeSurroundingAction) {
        const following = sceneLines[endIndex + 1];
        if (following && ['action', 'shot', 'text', 'image'].includes(following.type)) {
          addLine(following);
        }
      }
    });
  });

  let lines = selectedLines.sort((left, right) => left.index - right.index);
  if (baseDocument.options.includeComments) {
    const sceneIds = new Set(selectedScenes.map((scene) => scene.id));
    lines = appendCommentsAsNotes(lines, baseDocument.comments.filter((comment) => !comment.sceneId || sceneIds.has(comment.sceneId)));
  }

  return {
    ...baseDocument,
    exportType: 'character',
    selection: {
      characters: [...selectedNames]
    },
    scenes: selectedScenes,
    lines,
    characters: extractCharactersFromLines(lines)
  };
}

function buildCharacterPacketSelectionDocument(baseDocument, request) {
  const selectedNames = [...new Set(toArray(request.characters).map((value) => String(value || '').trim()).filter(Boolean))];
  const selectedNormalizedNames = new Set(selectedNames.map((value) => value.toUpperCase()));
  const characterDocument = buildCharacterSelectionDocument(baseDocument, {
    ...request,
    characters: selectedNames
  });

  const stats = selectedNames.map((name) => {
    const normalizedName = name.toUpperCase();
    const matchedScenes = characterDocument.scenes.filter((scene) => toArray(scene.characters).some((character) => String(character || '').trim().toUpperCase() === normalizedName));
    const lineCount = characterDocument.lines.filter((line) => ['character', 'dual'].includes(line.type)
      && String(line.displayText || '').replace(/\s*\(CONT'D\)\s*$/i, '').trim().toUpperCase() === normalizedName).length;
    return {
      name,
      sceneCount: matchedScenes.length,
      lineCount,
      firstAppearance: matchedScenes[0]?.heading || '',
      lastAppearance: matchedScenes[matchedScenes.length - 1]?.heading || ''
    };
  });

  const introLines = [
    {
      id: 'character-packet-heading',
      type: 'scene',
      text: 'CHARACTER PACKET',
      displayText: 'CHARACTER PACKET',
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER
    }
  ];

  stats.forEach((entry, index) => {
    introLines.push({
      id: `character-packet-stat-${index}-name`,
      type: 'action',
      text: `${entry.name}`,
      displayText: `${entry.name}`,
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER + index + 1
    });
    introLines.push({
      id: `character-packet-stat-${index}-details`,
      type: 'note',
      text: `Scenes: ${entry.sceneCount} | Lines: ${entry.lineCount} | First appearance: ${entry.firstAppearance || 'Not found'} | Last appearance: ${entry.lastAppearance || 'Not found'}`,
      displayText: `[Scenes: ${entry.sceneCount} | Lines: ${entry.lineCount} | First appearance: ${entry.firstAppearance || 'Not found'} | Last appearance: ${entry.lastAppearance || 'Not found'}]`,
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER + index + 101
    });
  });

  return {
    ...characterDocument,
    exportType: 'character-packet',
    selection: {
      characters: [...selectedNormalizedNames]
    },
    lines: [...introLines, ...characterDocument.lines.map(cloneLine)],
    characterPacketSummary: stats
  };
}

function buildProductionSelectionDocument(baseDocument, request) {
  const selectedScenes = baseDocument.scenes.filter((scene) => sceneMatchesProductionFilters(scene, request));
  const selectedSceneIdSet = new Set(selectedScenes.map((scene) => scene.id));
  const selectedLineIndexes = buildSceneLineIndexSet(selectedScenes);
  let lines = baseDocument.lines.filter((line) => selectedSceneIdSet.has(line.id)
    || selectedLineIndexes.has(line.index));

  if (baseDocument.options.includeComments) {
    const comments = baseDocument.comments.filter((comment) => !comment.sceneId || selectedSceneIdSet.has(comment.sceneId));
    lines = appendCommentsAsNotes(lines, comments);
  }

  const selectedLocations = [...new Set(selectedScenes.map((scene) => scene.location).filter(Boolean))];
  const selectedTimes = [...new Set(selectedScenes.map((scene) => scene.timeOfDay).filter(Boolean))];
  const selectedCharacters = [...new Set(selectedScenes.flatMap((scene) => toArray(scene.characters)).filter(Boolean))];
  const range = request.sceneRange && Number.isFinite(Number(request.sceneRange.start)) && Number.isFinite(Number(request.sceneRange.end))
    ? {
      start: Math.min(Number(request.sceneRange.start), Number(request.sceneRange.end)),
      end: Math.max(Number(request.sceneRange.start), Number(request.sceneRange.end))
    }
    : null;

  return {
    ...baseDocument,
    exportType: 'production',
    selection: {
      locations: toArray(request.locations).filter(Boolean),
      timeOfDay: toArray(request.timeOfDay).filter(Boolean),
      characters: toArray(request.characters).filter(Boolean),
      sceneRange: range
    },
    scenes: selectedScenes,
    lines,
    characters: extractCharactersFromLines(lines),
    productionSummary: {
      sceneCount: selectedScenes.length,
      locations: selectedLocations,
      timeOfDay: selectedTimes,
      characters: selectedCharacters
    }
  };
}

function buildLocationSelectionDocument(baseDocument, request) {
  const selectedLocation = String(request.location || toArray(request.locations)[0] || '').trim();
  const normalizedLocation = normalizeToken(selectedLocation);
  const selectedScenes = normalizedLocation
    ? baseDocument.scenes.filter((scene) => normalizeToken(scene.location) === normalizedLocation)
    : [];
  const selectedSceneIdSet = new Set(selectedScenes.map((scene) => scene.id));
  const selectedLineIndexes = buildSceneLineIndexSet(selectedScenes);
  let lines = baseDocument.lines.filter((line) => selectedSceneIdSet.has(line.id)
    || selectedLineIndexes.has(line.index));

  if (baseDocument.options.includeComments) {
    const comments = baseDocument.comments.filter((comment) => !comment.sceneId || selectedSceneIdSet.has(comment.sceneId));
    lines = appendCommentsAsNotes(lines, comments);
  }

  const selectedCharacters = [...new Set(selectedScenes.flatMap((scene) => toArray(scene.characters)).filter(Boolean))];
  const selectedTimes = [...new Set(selectedScenes.map((scene) => scene.timeOfDay).filter(Boolean))];

  return {
    ...baseDocument,
    exportType: 'location',
    selection: {
      location: selectedLocation
    },
    scenes: selectedScenes,
    lines,
    characters: extractCharactersFromLines(lines),
    locationSummary: {
      location: selectedLocation,
      sceneCount: selectedScenes.length,
      characters: selectedCharacters,
      timeOfDay: selectedTimes
    }
  };
}

function buildPreparedLinesFromSnapshot(lines, options) {
  return buildPreparedLines({ lines: toArray(lines) }, options);
}

function buildRevisionSnapshot(lines, options) {
  const preparedLines = buildPreparedLinesFromSnapshot(lines, options);
  return {
    lines: preparedLines,
    scenes: buildScenes(preparedLines)
  };
}

function buildRevisionEntryIndex(preparedLines) {
  return preparedLines
    .filter((line) => ['dialogue', 'action', 'shot', 'text'].includes(line.type))
    .map((line) => ({
      type: line.type,
      text: line.displayText,
      sceneNumber: line.sceneNumber
    }));
}

function buildRevisionReportDocument(baseDocument, request) {
  const versionA = request.versionA || {};
  const versionB = request.versionB || {};
  const snapshotA = buildRevisionSnapshot(versionA.lines || [], baseDocument.options);
  const snapshotB = buildRevisionSnapshot(versionB.lines || [], baseDocument.options);

  const sceneMapA = new Map(snapshotA.scenes.map((scene) => [normalizeToken(scene.heading), scene]));
  const sceneMapB = new Map(snapshotB.scenes.map((scene) => [normalizeToken(scene.heading), scene]));

  const addedScenes = snapshotB.scenes.filter((scene) => !sceneMapA.has(normalizeToken(scene.heading)));
  const removedScenes = snapshotA.scenes.filter((scene) => !sceneMapB.has(normalizeToken(scene.heading)));

  const entriesA = buildRevisionEntryIndex(snapshotA.lines);
  const entriesB = buildRevisionEntryIndex(snapshotB.lines);
  const modifiedDialogue = [];
  const modifiedDescriptions = [];
  const maxLength = Math.max(entriesA.length, entriesB.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = entriesA[index];
    const right = entriesB[index];
    if (!left || !right || left.type !== right.type || left.text === right.text) {
      continue;
    }
    if (left.type === 'dialogue') {
      modifiedDialogue.push({
        before: left.text,
        after: right.text,
        sceneNumber: right.sceneNumber || left.sceneNumber || 0
      });
    }
    if (['action', 'shot', 'text'].includes(left.type)) {
      modifiedDescriptions.push({
        before: left.text,
        after: right.text,
        sceneNumber: right.sceneNumber || left.sceneNumber || 0
      });
    }
  }

  const reportLines = [
    {
      id: 'revision-report-heading',
      type: 'scene',
      text: 'REVISION REPORT',
      displayText: 'REVISION REPORT',
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER
    },
    {
      id: 'revision-report-summary',
      type: 'note',
      text: `Comparing ${versionA.label || 'Version A'} against ${versionB.label || 'Version B'}.`,
      displayText: `[Comparing ${versionA.label || 'Version A'} against ${versionB.label || 'Version B'}.]`,
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER + 1
    }
  ];

  const pushSection = (heading, rows) => {
    reportLines.push({
      id: `revision-section-${heading}`,
      type: 'action',
      text: heading,
      displayText: heading,
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
    });
    if (!rows.length) {
      reportLines.push({
        id: `revision-empty-${heading}`,
        type: 'note',
        text: 'No changes found.',
        displayText: '[No changes found.]',
        secondary: '',
        sceneNumber: 0,
        index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
      });
      return;
    }
    rows.forEach((row) => {
      reportLines.push({
        id: uidLineId(`revision-row-${heading}`),
        type: 'note',
        text: row,
        displayText: `[${row}]`,
        secondary: '',
        sceneNumber: 0,
        index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
      });
    });
  };

  pushSection('Added Scenes', addedScenes.map((scene) => scene.heading));
  pushSection('Removed Scenes', removedScenes.map((scene) => scene.heading));
  pushSection('Modified Dialogue', modifiedDialogue.map((entry) => `Scene ${entry.sceneNumber || '?' }: ${entry.before} -> ${entry.after}`));
  pushSection('Modified Descriptions', modifiedDescriptions.map((entry) => `Scene ${entry.sceneNumber || '?' }: ${entry.before} -> ${entry.after}`));

  return {
    ...baseDocument,
    exportType: 'revision',
    selection: {
      versionA: versionA.label || 'Version A',
      versionB: versionB.label || 'Version B'
    },
    lines: reportLines,
    scenes: [],
    characters: [],
    revisionSummary: {
      addedScenes: addedScenes.length,
      removedScenes: removedScenes.length,
      modifiedDialogue: modifiedDialogue.length,
      modifiedDescriptions: modifiedDescriptions.length
    }
  };
}

function buildShootingScriptDocument(baseDocument) {
  const revisionDateSource = baseDocument.metadata.updatedAt || baseDocument.metadata.createdAt || '';
  const parsedRevisionDate = revisionDateSource ? new Date(revisionDateSource) : null;
  const revisionDate = parsedRevisionDate && !Number.isNaN(parsedRevisionDate.getTime())
    ? parsedRevisionDate.toISOString().slice(0, 10)
    : '';

  return {
    ...baseDocument,
    exportType: 'shooting',
    options: {
      ...baseDocument.options,
      includeSceneNumbers: true
    },
    selection: {
      ...baseDocument.selection,
      lockedSceneNumbers: true
    },
    shootingSummary: {
      sceneCount: baseDocument.scenes.length,
      revisionDate,
      includesRevisions: Boolean(baseDocument.options.includeRevisions),
      includesNotes: Boolean(baseDocument.options.includeNotes),
      includesComments: Boolean(baseDocument.options.includeComments),
      includesPageNumbers: Boolean(baseDocument.options.includePageNumbers)
    }
  };
}

function buildBreakdownDocument(baseDocument, request = {}) {
  const generatedSections = Array.isArray(request.generatedSections) ? request.generatedSections.filter((item) => String(item?.text || "").trim()) : [];
  if (generatedSections.length) {
    const reportLines = [{
      id: 'breakdown-report-heading',
      type: 'scene',
      text: 'AI REPORT',
      displayText: 'AI REPORT',
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER
    }];
    generatedSections.forEach((section) => {
      reportLines.push({
        id: uidLineId(`breakdown-section-${section.key || 'custom'}`),
        type: 'action',
        text: section.label || 'Report Section',
        displayText: section.label || 'Report Section',
        secondary: '',
        sceneNumber: 0,
        index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
      });
      String(section.text || '').split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean).forEach((paragraph) => {
        reportLines.push({
          id: uidLineId(`breakdown-paragraph-${section.key || 'custom'}`),
          type: 'action',
          text: paragraph,
          displayText: paragraph,
          secondary: '',
          sceneNumber: 0,
          index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
        });
      });
    });
    return {
      ...baseDocument,
      exportType: 'breakdown',
      lines: reportLines,
      scenes: [],
      characters: [],
      selection: {
        includeCharacters: Boolean(request.includeCharacters),
        includeLocations: Boolean(request.includeLocations),
        includeScenes: Boolean(request.includeScenes),
        customPrompt: String(request.customPrompt || '').trim()
      },
      breakdownSummary: {
        sectionCount: generatedSections.length,
        characterCount: generatedSections.some((item) => item.key === 'characters') ? baseDocument.characters.length : 0,
        locationCount: generatedSections.some((item) => item.key === 'locations') ? new Set(baseDocument.scenes.map((scene) => scene.location).filter(Boolean)).size : 0,
        sceneCount: generatedSections.some((item) => item.key === 'scenes') ? baseDocument.scenes.length : 0
      }
    };
  }
  const includeCharacters = request.includeCharacters !== false;
  const includeLocations = request.includeLocations !== false;
  const includeScenes = request.includeScenes !== false;
  const reportLines = [{
    id: 'breakdown-report-heading',
    type: 'scene',
    text: 'SCRIPT BREAKDOWN REPORT',
    displayText: 'SCRIPT BREAKDOWN REPORT',
    secondary: '',
    sceneNumber: 0,
    index: Number.MIN_SAFE_INTEGER
  }];

  const pushLine = (type, text) => {
    reportLines.push({
      id: uidLineId(`breakdown-${type}`),
      type,
      text,
      displayText: type === 'note' ? `[${text}]` : text,
      secondary: '',
      sceneNumber: 0,
      index: Number.MIN_SAFE_INTEGER + reportLines.length + 1
    });
  };

  if (includeCharacters) {
    pushLine('action', 'Character Breakdown');
    if (!baseDocument.characters.length) {
      pushLine('note', 'No characters found.');
    } else {
      baseDocument.characters.forEach((character) => {
        const normalizedName = normalizeToken(character.name);
        const relatedScenes = baseDocument.scenes.filter((scene) => toArray(scene.characters).some((entry) => normalizeToken(entry) === normalizedName));
        const dialogueCount = relatedScenes.reduce((total, scene) => total + scene.dialogue
          .filter((block) => normalizeToken(block.character) === normalizedName)
          .reduce((sum, block) => sum + block.dialogue.length, 0), 0);
        pushLine('action', character.name);
        pushLine('note', `Scenes: ${relatedScenes.length} | Dialogue lines: ${dialogueCount} | First appearance: ${relatedScenes[0]?.heading || 'Not found'} | Last appearance: ${relatedScenes[relatedScenes.length - 1]?.heading || 'Not found'}`);
      });
    }
  }

  if (includeLocations) {
    pushLine('action', 'Location Breakdown');
    const locations = [...new Set(baseDocument.scenes.map((scene) => scene.location).filter(Boolean))];
    if (!locations.length) {
      pushLine('note', 'No locations found.');
    } else {
      locations.forEach((location) => {
        const relatedScenes = baseDocument.scenes.filter((scene) => scene.location === location);
        const characters = [...new Set(relatedScenes.flatMap((scene) => toArray(scene.characters)).filter(Boolean))];
        const times = [...new Set(relatedScenes.map((scene) => scene.timeOfDay).filter(Boolean))];
        pushLine('action', location);
        pushLine('note', `Scenes: ${relatedScenes.length} | Time of day: ${times.join(', ') || 'Unspecified'} | Characters involved: ${characters.length}`);
      });
    }
  }

  if (includeScenes) {
    pushLine('action', 'Scene Breakdown');
    if (!baseDocument.scenes.length) {
      pushLine('note', 'No scenes found.');
    } else {
      baseDocument.scenes.forEach((scene) => {
        const importance = scene.dialogue.length >= 3 || scene.description.length >= 3
          ? 'High'
          : scene.dialogue.length >= 1 || scene.description.length >= 1
            ? 'Medium'
            : 'Low';
        pushLine('action', `${scene.number || '?'} ${scene.heading}`);
        pushLine('note', `Characters: ${toArray(scene.characters).join(', ') || 'None'} | Estimated length: ${Math.max(1, Math.ceil(scene.lines.length / 4))} beats | Importance: ${importance}`);
      });
    }
  }

  return {
    ...baseDocument,
    exportType: 'breakdown',
    lines: reportLines,
    scenes: [],
    characters: [],
    selection: {
      includeCharacters,
      includeLocations,
      includeScenes
    },
    breakdownSummary: {
      characterCount: includeCharacters ? baseDocument.characters.length : 0,
      locationCount: includeLocations ? new Set(baseDocument.scenes.map((scene) => scene.location).filter(Boolean)).size : 0,
      sceneCount: includeScenes ? baseDocument.scenes.length : 0
    }
  };
}

export function applyWatermarkToExportDocument(baseDocument) {
  const preset = String(baseDocument.options.watermarkPreset || '').trim();
  const customText = String(baseDocument.options.watermarkText || '').trim();
  const watermarkText = customText || preset || 'CONFIDENTIAL';
  const opacity = Number(baseDocument.options.watermarkOpacity);
  const normalizedOpacity = Number.isFinite(opacity)
    ? Math.min(0.3, Math.max(0.04, opacity))
    : 0.12;
  const position = ['diagonal', 'header', 'footer'].includes(String(baseDocument.options.watermarkPosition || '').trim().toLowerCase())
    ? String(baseDocument.options.watermarkPosition || '').trim().toLowerCase()
    : 'diagonal';

  return {
    ...baseDocument,
    options: {
      ...baseDocument.options,
      enableWatermarkSettings: true,
      watermarkText,
      watermarkOpacity: normalizedOpacity,
      watermarkPosition: position
    },
    watermarkSummary: {
      text: watermarkText,
      opacity: normalizedOpacity,
      position
    }
  };
}

function uidLineId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildBaseExportDocument(project, overrides = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...overrides
  };
  const metadata = normalizeMetadata({
    ...project,
    coverPage: options.coverPage || {}
  });
  const lines = buildPreparedLines(project, options);
  const comments = normalizeComments(project);
  const assignments = normalizeAssignments(project);
  const tags = normalizeTags(project);
  const baseLines = options.includeComments ? appendCommentsAsNotes(lines, comments) : lines.map(cloneLine);

  return {
    exportType: 'full',
    metadata,
    title: metadata.title,
    filenameBase: slugify(metadata.title),
    options,
    lines: baseLines,
    scenes: buildScenes(lines),
    characters: extractCharactersFromLines(lines),
    comments,
    assignments,
    tags,
    selection: {}
  };
}

export function buildFullScriptExportDocument(project, overrides = {}) {
  return buildBaseExportDocument(project, overrides);
}

export function buildCharacterExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildCharacterSelectionDocument(baseDocument, request);
}

export function buildSceneExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildSceneSelectionDocument(baseDocument, request);
}

export function buildProductionExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildProductionSelectionDocument(baseDocument, request);
}

export function buildShootingScriptExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, {
    ...(request.options || request),
    includeSceneNumbers: true
  });
  return buildShootingScriptDocument(baseDocument);
}

export function buildWatermarkedScriptExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return {
    ...applyWatermarkToExportDocument(baseDocument),
    exportType: 'watermarked'
  };
}

export function buildCharacterPacketExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildCharacterPacketSelectionDocument(baseDocument, request);
}

export function buildLocationExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildLocationSelectionDocument(baseDocument, request);
}

export function buildRevisionExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildRevisionReportDocument(baseDocument, request);
}

export function buildBreakdownExportDocument(project, request = {}) {
  const baseDocument = buildBaseExportDocument(project, request.options || request);
  return buildBreakdownDocument(baseDocument, request);
}

export function buildExportFilename(exportDocument, extension) {
  const suffix = exportDocument.exportType === 'character'
    ? '-character-export'
    : exportDocument.exportType === 'character-packet'
      ? '-character-packet-export'
    : exportDocument.exportType === 'scene'
      ? '-scene-export'
      : exportDocument.exportType === 'location'
        ? '-location-export'
      : exportDocument.exportType === 'revision'
        ? '-revision-export'
      : exportDocument.exportType === 'production'
        ? '-production-export'
        : exportDocument.exportType === 'shooting'
          ? '-shooting-script'
          : exportDocument.exportType === 'breakdown'
            ? '-ai-breakdown'
          : exportDocument.exportType === 'watermarked'
            ? '-watermarked-script'
        : '-full-script';
  return `${exportDocument.filenameBase}${suffix}.${extension}`;
}

export function getDefaultExportOptions() {
  return { ...DEFAULT_OPTIONS };
}
