import { formatLineText, normalizeLineText, slugify } from './utils.js';

const DEFAULT_OPTIONS = {
  includeNotes: false,
  includeComments: false,
  includeSceneNumbers: false,
  includeMetadata: true,
  includeTitlePage: true,
  includeSurroundingAction: false,
  includeSceneDescriptions: true
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMetadata(project = {}) {
  return {
    title: String(project.title || 'Untitled Script').trim() || 'Untitled Script',
    author: String(project.author || '').trim(),
    genre: String(project.genre || '').trim(),
    version: Number.isFinite(Number(project.version)) ? Number(project.version) : 0,
    contact: String(project.contact || '').trim(),
    company: String(project.company || '').trim(),
    details: String(project.details || '').trim(),
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
      const parts = parseSceneHeadingParts(line.displayText);
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

function buildSceneSelectionDocument(baseDocument, request) {
  const selectedSceneIds = new Set(toArray(request.sceneIds).map((value) => String(value || '')));
  const selectedSceneNumbers = new Set(toArray(request.sceneNumbers).map((value) => Number(value)).filter(Number.isFinite));
  const range = request.sceneRange && Number.isFinite(Number(request.sceneRange.start)) && Number.isFinite(Number(request.sceneRange.end))
    ? { start: Number(request.sceneRange.start), end: Number(request.sceneRange.end) }
    : null;

  const selectedScenes = baseDocument.scenes.filter((scene) => sceneMatchesSelection(scene, selectedSceneIds, selectedSceneNumbers, range));
  const selectedSceneIdSet = new Set(selectedScenes.map((scene) => scene.id));
  let lines = baseDocument.lines.filter((line) => selectedSceneIdSet.has(line.id) || selectedScenes.some((scene) => line.index >= scene.startLineIndex && line.index <= scene.endLineIndex));

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

function buildBaseExportDocument(project, overrides = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...overrides
  };
  const metadata = normalizeMetadata(project);
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

export function buildExportFilename(exportDocument, extension) {
  const suffix = exportDocument.exportType === 'character'
    ? '-character-export'
    : exportDocument.exportType === 'scene'
      ? '-scene-export'
      : '-full-script';
  return `${exportDocument.filenameBase}${suffix}.${extension}`;
}

export function getDefaultExportOptions() {
  return { ...DEFAULT_OPTIONS };
}
