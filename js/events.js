import { state, TYPE_SEQUENCE, TYPE_LABELS, WORKSPACE_TASK_TEMPLATES } from './config.js';
import { refs } from './dom.js';
import { ContextMenu } from './contextMenu.js';
import {
  getCurrentProject, getLine, getLineIndex, persistProjects, queueSave,
  createProject, createProjectWithOptions, upsertProject, sanitizeProject, cloneProject,
  hasProjectNameConflict,
  getWorkspaceProjects, getWorkspaceRootProject, updateWorkspaceAcrossProjects,
  syncProjectFromInputs,
  getDefaultText, pushHistory, undo, redo, getSuggestedNextSpeaker,
  deleteProjectFromCloud, getDeletedProjects, archiveDeletedProjects,
  recoverDeletedProject, permanentlyDeleteRecoveredProject
} from './project.js';
import {
  renderEditor, setActiveBlock, focusBlock, focusSecondaryBlock, getActiveEditableBlock,
  getOwningSceneId, getCharacterAutocomplete, updateSuggestions,
  showSpellingSuggestions, clearSuggestionContext, refreshEditableBlockDisplay, hideSuggestionTray,
  getSceneIdForIndex
} from './editor.js';
import { renderPreview, renderCoverPreview, buildPrintableDocument } from './preview.js';
import { DOCX_MIME_TYPE } from './docxExport.js';
import { ExportService } from './exportService.js?v=20260622d';
import {
  buildCharacterExportDocument,
  buildCharacterPacketExportDocument,
  buildCollaborativeExportDocument,
  buildFullScriptExportDocument,
  buildLocationExportDocument,
  buildProductionExportDocument,
  buildRevisionExportDocument,
  buildSceneExportDocument,
  buildShootingScriptExportDocument,
  buildWatermarkedScriptExportDocument,
  getDefaultExportOptions
} from './exportModel.js';
import { paginateScriptLines } from './pagination.js';
import { buildPrintableDocumentFromExportDocument } from './printExport.js';
import { auth } from './firebase.js';
import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { logActivity } from './activity.js';
import {
  renderHome, renderRecentProjectMenus, syncInputsFromProject,
  showStudio, showHome, showWorkspaceView, applyViewState, setTheme, toggleMenu,
  closeMenus, applyToolbarState, renderMetrics, renderSceneList,
  renderCharacterList, showCharacterScenes, showProofreadReport, showWorkTracking, revealMetricsPanel,
  updateMenuStateButtons, customAlert, customConfirm, customPrompt,
  showModal, showToast, updateToast,
  renderLeftPaneLayout, toggleLeftPaneSection, setLeftPaneBlockVisibility, moveLeftPaneBlock,
  renderCurrentScriptId, renderStoryMemory, openStoryMemory, showEditStoryElementModal,
  renderAnalytics, openAnalytics, showStoryMemoryPicker, showCustomizeActiveBlocksModal, renderWorkspaceView, renderStudioProjectContext,
  showStoryMemoryPopup, showWorkspacePopup, showCharactersInterface, showStoryMemoryBuilder, showNewCreationFlow, showFilmProjectSetupFlow, renderWorkspaceInboxPopup
} from './ui.js?v=20260622d';
import { AI } from './ai.js';
import {
  normalizeLineText, stripWrapperChars, buildContinuedSceneSuggestions,
  slugify, downloadFile, selectElementText, parseTextToLines, uid,
  placeCaretAtEnd, getCaretOffset, setCaretOffset, clamp, inferTypeFromText,
  formatDateTime,
  formatLineText, escapeHtml
} from './utils.js';
import {
  extractScriptTextFromFile,
  convertScriptTextToLines,
  buildLocalStructuredPreview,
  appendConversionJobVersion,
  beginConversionUpload,
  attachSourceFileToConversionJob,
  markConversionExtractionStarted,
  attachRawTextToConversionJob,
  markConversionImporting,
  finalizeConversionImport,
  failConversionJob,
  waitForConversionJobRecord
} from './scriptConversion.js';
import { applyTranslations, getTypeLabel, setLanguage, t } from './i18n.js';
import {
  applyWordCase, clearSpellingHighlights, ensureLanguageDictionary, getSpellingContextAtOffset,
  hasLanguageDictionary, highlightSpellingIssue, getSpellingSuggestions
} from './spelling.js';
import {
  isLocalSaveSupported, chooseLocalSaveFile, restoreLocalSaveFile, clearLocalSaveFile,
  startLocalSaveTimer, stopLocalSaveTimer, writeLocalSaveFile
} from './localSave.js';
import {
  inviteCollaborator, addComment, renderCollaboratorList, onStudioEnter,
  hideCommentCompose, submitCommentCompose, setCommentFilter, updateCommentIcons, showCommentPanel,
  canEditProject, canManageWorkspaceProjects, canDeleteWorkspace, getWorkspacePermissions,
  updateCollaboratorRole, addWorkspaceReminder, kickCollaborator,
  toggleWorkspaceReminder, deleteWorkspaceReminder, renameWorkspace,
  showCollabProfile, noteRealtimeActivity, syncWorkspaceState,
  leaveWorkspace, deleteWorkspaceData
} from './collaborate.js';
import { getConversionJobRecord, listConversionJobRecords, patchConversionJobRecord } from './conversionJobStore.js';

let studioSidebarRefreshFrame = 0;
let previewRefreshTimer = 0;
let focusModeTimer = 0;
let hasShownReadOnlyNotice = false;
let workspaceClockTimer = 0;
let pendingConvertImportProjectId = "";
let activeConversionLiveJobId = "";
let activeConversionLiveProjectId = "";
const conversionWorkspaceOverrides = new Map();
const aiTaskTimers = new Map();
let exportDialogPrefill = { format: "pdf", exportType: "full" };
let exportDialogContext = { scenes: [], characters: [], revisions: [], collaborative: { scenes: [], assignedWriters: [], reviewers: [], editors: [] } };
let exportDialogMode = "export";
let exportPreviewRefreshTimer = 0;
let exportPreviewOpenUrl = "";
let exportCoverPageBuilderCollapsed = true;
let exportHistoryCollapsed = true;
let exportDialogProjectId = "";
let reportDraftRequest = null;
let reportGenerationController = null;
let selectedReportDraftLoadId = "";
let selectedReportDraftMergeId = "";
let selectedReportDraftRevisionId = "";
let activeReportDraftId = "";
let reportAutosaveTimer = 0;
let reportAutosaveMuted = false;
const exportReportLayoutState = {
  titleToggleParent: null,
  titleToggleNext: null,
  breakdownBuilderParent: null,
  breakdownBuilderNext: null,
  breakdownPromptParent: null,
  breakdownPromptNext: null,
  reportGenerateRowParent: null,
  reportGenerateRowNext: null
};

const EXPORT_TYPE_DETAILS = {
  full: "Title page, metadata, scenes, dialogue, transitions, and optional notes/comments.",
  character: "Actor-friendly pages with chosen character dialogue plus scene heading context.",
  "character-packet": "Actor packets with dialogue, parentheticals, scene headings, and character statistics.",
  scene: "Single scenes, multi-scene selections, or a scene-number range.",
  location: "Location packets collect every scene set at one selected location, with characters and time of day preserved.",
  revision: "Revision reports compare two available versions and track added scenes, removed scenes, and changed text.",
  production: "Production-ready packets filtered by location, time of day, scene range, and character presence.",
  collaborative: "Workspace-linked scenes filtered by assigned writer, reviewer, editor, and workflow status.",
  shooting: "Locked-scene screenplay pages with revision labeling, page numbers, and production-ready shooting script layout.",
  breakdown: "AI reads the script and writes focused report sections for characters, locations, and scene-level insight.",
  watermarked: "Protected screenplay pages with configurable watermark text, placement, and opacity for controlled sharing."
};

const EXPORT_FORMAT_DETAILS = {
  pdf: "PDF opens a print-ready screenplay document for saving as PDF.",
  docx: "DOCX downloads a Word-compatible screenplay document built from the same export service.",
  fountain: "Fountain downloads a plain-text screenplay file with title-page fields, scene-number syntax, and screenplay-safe formatting.",
  fdx: "Final Draft downloads an .fdx screenplay file for professional screenwriting software."
};
const PROJECT_CARD_TOUCH_SCROLL_THRESHOLD = 12;
const PROJECT_CARD_CLICK_SUPPRESSION_MS = 750;
let projectCardTouchState = null;
let suppressedProjectCardClick = null;
const INLINE_SELECTION_TOOLS = [
  { label: "Improve", action: "Improve", requiresAi: true },
  { label: "Rewrite", action: "Rephrase", requiresAi: true },
  { label: "Fix Grammar", action: "Grammar", requiresGrammar: true }
];

function normalizeExportFilterToken(value) {
  return String(value || "").trim().toUpperCase();
}

function parseOptionalRange(startValue, endValue) {
  const start = Number(startValue || 0);
  const end = Number(endValue || 0);
  if (start > 0 && end > 0) {
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }
  return null;
}

function sceneMatchesProductionFilters(scene, filters = {}) {
  const location = normalizeExportFilterToken(filters.location);
  const timeOfDay = normalizeExportFilterToken(filters.timeOfDay);
  const characters = Array.isArray(filters.characters) ? filters.characters.map(normalizeExportFilterToken).filter(Boolean) : [];
  const range = filters.sceneRange || null;

  if (location && normalizeExportFilterToken(scene.location) !== location) {
    return false;
  }
  if (timeOfDay && normalizeExportFilterToken(scene.timeOfDay) !== timeOfDay) {
    return false;
  }
  if (characters.length) {
    const sceneCharacters = new Set((scene.characters || []).map(normalizeExportFilterToken).filter(Boolean));
    if (!characters.some((character) => sceneCharacters.has(character))) {
      return false;
    }
  }
  if (range && (scene.number < range.start || scene.number > range.end)) {
    return false;
  }

  return true;
}

function estimateExportPages(lineCount) {
  return Math.max(1, Math.ceil(Number(lineCount || 0) / 45));
}

function estimateExportFileSize(lineCount, format, sceneCount, characterCount) {
  const safeLineCount = Number(lineCount || 0);
  const safeSceneCount = Number(sceneCount || 0);
  const safeCharacterCount = Number(characterCount || 0);
  const bytes = format === "docx"
    ? 12000 + (safeLineCount * 42) + (safeSceneCount * 160) + (safeCharacterCount * 90)
    : format === "fountain"
      ? 1200 + (safeLineCount * 26)
      : format === "fdx"
        ? 2400 + (safeLineCount * 34) + (safeSceneCount * 90) + (safeCharacterCount * 48)
      : 9000 + (safeLineCount * 38) + (safeSceneCount * 140) + (safeCharacterCount * 80);
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getBreakdownLiveNodes() {
  return {
    card: document.getElementById("exportBreakdownLiveCard"),
    title: document.getElementById("exportBreakdownLiveTitle"),
    meta: document.getElementById("exportBreakdownLiveMeta"),
    output: document.getElementById("exportReportEditor")
  };
}

function ensureReportEditor() {
  const editor = document.getElementById("exportReportEditor");
  if (!editor || typeof window.$ !== "function") return null;
  const $editor = window.$(editor);
  if (!$editor.data("summernote")) {
    $editor.summernote({
      placeholder: "AI will write here. You can refine, format, and save the report before building it.",
      tabsize: 2,
      height: 320,
      dialogsInBody: true,
      toolbar: [
        ['style', ['style']],
        ['font', ['bold', 'italic', 'underline', 'clear']],
        ['fontname', ['fontname']],
        ['color', ['color']],
        ['para', ['ul', 'ol', 'paragraph']],
        ['insert', ['link', 'table']],
        ['view', ['fullscreen', 'codeview', 'help']]
      ]
    });
    const editable = $editor.next(".note-editor").find(".note-editable")[0];
    if (editable && !editable.dataset.reportAutosaveBound) {
      editable.dataset.reportAutosaveBound = "true";
      editable.addEventListener("input", () => {
        queueReportAutosave();
      });
    }
  }
  return $editor;
}

function getReportEditorHtml() {
  const editor = ensureReportEditor();
  return editor ? String(editor.summernote("code") || "") : "";
}

function setReportEditorHtml(html = "") {
  const editor = ensureReportEditor();
  if (!editor) return;
  editor.summernote("code", String(html || ""));
}

function getPlainReportTextPreview(html = "", maxLength = 140) {
  const doc = new DOMParser().parseFromString(`<div>${String(html || "")}</div>`, "text/html");
  const text = String(doc.body.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return "No report text saved yet.";
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
}

function hasReportEditorContent() {
  return Boolean(getPlainReportTextPreview(getReportEditorHtml(), 8) !== "No report text saved yet.");
}

function getReportDraftRevisionSnapshots(existingEntry = null, draft = null, updatedAt = new Date().toISOString()) {
  const revisions = Array.isArray(existingEntry?.revisions) ? [...existingEntry.revisions] : [];
  const html = String(draft?.html || "").trim();
  if (!html) return revisions.slice(0, 20);
  const lastRevision = revisions[0] || null;
  if (lastRevision && String(lastRevision.html || "").trim() === html) {
    revisions[0] = {
      ...lastRevision,
      updatedAt
    };
    return revisions.slice(0, 20);
  }
  revisions.unshift({
    id: uid("reportRevision"),
    updatedAt,
    html,
    generatedSections: Array.isArray(draft?.generatedSections) ? draft.generatedSections : [],
    request: draft?.request ? { ...draft.request } : null
  });
  return revisions.slice(0, 20);
}

function queueReportAutosave() {
  if (reportAutosaveMuted || exportDialogMode !== "report") return;
  if (reportAutosaveTimer) window.clearTimeout(reportAutosaveTimer);
  reportAutosaveTimer = window.setTimeout(() => {
    reportAutosaveTimer = 0;
    if (!hasReportEditorContent()) return;
    saveReportDraftFromLiveOutput({ autosave: true });
    const liveMeta = document.getElementById("exportBreakdownLiveMeta");
    if (liveMeta) liveMeta.textContent = `Autosaved ${formatDateTime(new Date().toISOString())}.`;
    updateExportDialogState();
  }, 900);
}

function setReportEditorEditing(enabled) {
  const editor = ensureReportEditor();
  if (!editor) return;
  editor.summernote(enabled ? "enable" : "disable");
}

function getReportEditorEditableElement() {
  const editor = ensureReportEditor();
  if (!editor) return null;
  return editor.next(".note-editor").find(".note-editable")[0] || null;
}

function appendReportSectionShell(selection) {
  const editorEl = getReportEditorEditableElement();
  if (!editorEl) return null;
  const section = document.createElement("section");
  section.className = "export-report-section";
  section.dataset.sectionKey = selection.key;
  section.innerHTML = `
    <h4 data-report-section-key="${escapeHtml(selection.key)}">${escapeHtml(selection.label)}</h4>
    <div class="export-report-section-body" data-report-section-body="${escapeHtml(selection.key)}"><p></p></div>
  `;
  editorEl.appendChild(section);
  return section.querySelector(".export-report-section-body p");
}

function readReportSectionsFromEditorHtml() {
  const html = getReportEditorHtml();
  if (!html.trim()) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return [...doc.querySelectorAll("[data-report-section-key]")]
    .map((heading) => {
      const key = String(heading.getAttribute("data-report-section-key") || "").trim();
      const label = String(heading.textContent || "").trim();
      let cursor = heading.nextElementSibling;
      const fragments = [];
      while (cursor && !cursor.matches("[data-report-section-key]")) {
        fragments.push(cursor.outerHTML);
        cursor = cursor.nextElementSibling;
      }
      const htmlBody = fragments.join("").trim();
      const text = htmlBody
        ? new DOMParser().parseFromString(`<div>${htmlBody}</div>`, "text/html").body.textContent || ""
        : "";
      return {
        key,
        label,
        html: htmlBody,
        text: String(text || "").trim()
      };
    })
    .filter((section) => section.label && (section.text || section.html));
}

function resetBreakdownLivePanel() {
  const { card, title, meta, output } = getBreakdownLiveNodes();
  if (card) card.hidden = exportDialogMode !== "report";
  if (title) title.textContent = "Result";
  if (meta) {
    meta.textContent = exportDialogMode === "report"
      ? "Start typing here, load a saved report, or generate AI content."
      : "Waiting to begin...";
  }
  if (output) setReportEditorHtml("");
}

function openReportDialog(prefill = {}) {
  exportDialogMode = "report";
  openExportDialog({
    ...prefill,
    format: "pdf",
    exportType: "breakdown"
  });
}

export function triggerReportDialog(prefill = {}) {
  openReportDialog(prefill);
}

function rememberReportLayoutNode(key, node) {
  if (!node || exportReportLayoutState[`${key}Parent`]) return;
  exportReportLayoutState[`${key}Parent`] = node.parentElement || null;
  exportReportLayoutState[`${key}Next`] = node.nextElementSibling || null;
}

function moveNodeToMount(node, mount) {
  if (node && mount && node.parentElement !== mount) {
    mount.appendChild(node);
  }
}

function restoreNodeFromMount(key, node) {
  const parent = exportReportLayoutState[`${key}Parent`];
  const next = exportReportLayoutState[`${key}Next`];
  if (!node || !parent) return;
  if (next && next.parentElement === parent) {
    parent.insertBefore(node, next);
  } else {
    parent.appendChild(node);
  }
}

function readReportSectionsFromLiveOutput() {
  return readReportSectionsFromEditorHtml();
}

function buildProjectScriptContext(project) {
  return (project?.lines || [])
    .map((line) => `[${String(line.type || "action").toUpperCase()}] ${String(line.text || "").trim()}`)
    .filter(Boolean)
    .join("\n");
}

function getBreakdownSelections() {
  return [
    {
      key: "characters",
      label: "Character Report",
      checked: Boolean(document.getElementById("exportBreakdownCharacters")?.checked),
      minWords: Number(document.getElementById("exportBreakdownCharactersMin")?.value || 120),
      maxWords: Number(document.getElementById("exportBreakdownCharactersMax")?.value || 220)
    },
    {
      key: "locations",
      label: "Location Report",
      checked: Boolean(document.getElementById("exportBreakdownLocations")?.checked),
      minWords: Number(document.getElementById("exportBreakdownLocationsMin")?.value || 120),
      maxWords: Number(document.getElementById("exportBreakdownLocationsMax")?.value || 220)
    },
    {
      key: "scenes",
      label: "Scene Report",
      checked: Boolean(document.getElementById("exportBreakdownScenes")?.checked),
      minWords: Number(document.getElementById("exportBreakdownScenesMin")?.value || 160),
      maxWords: Number(document.getElementById("exportBreakdownScenesMax")?.value || 280)
    },
    {
      key: "theme",
      label: "Storyline & Theme",
      checked: Boolean(document.getElementById("exportBreakdownTheme")?.checked),
      minWords: Number(document.getElementById("exportBreakdownThemeMin")?.value || 140),
      maxWords: Number(document.getElementById("exportBreakdownThemeMax")?.value || 260)
    },
    {
      key: "style",
      label: "Writing Style",
      checked: Boolean(document.getElementById("exportBreakdownStyle")?.checked),
      minWords: Number(document.getElementById("exportBreakdownStyleMin")?.value || 120),
      maxWords: Number(document.getElementById("exportBreakdownStyleMax")?.value || 220)
    },
    {
      key: "scenery",
      label: "Scenery Development",
      checked: Boolean(document.getElementById("exportBreakdownScenery")?.checked),
      minWords: Number(document.getElementById("exportBreakdownSceneryMin")?.value || 120),
      maxWords: Number(document.getElementById("exportBreakdownSceneryMax")?.value || 220)
    },
    {
      key: "props",
      label: "Props & Objects",
      checked: Boolean(document.getElementById("exportBreakdownProps")?.checked),
      minWords: Number(document.getElementById("exportBreakdownPropsMin")?.value || 100),
      maxWords: Number(document.getElementById("exportBreakdownPropsMax")?.value || 180)
    }
  ].filter((item) => item.checked);
}

function buildBreakdownPrompt(project, selection, customPrompt = "") {
  const title = project?.title || "Untitled Script";
  const extra = String(customPrompt || "").trim();
  return {
    action: "Improve",
    instruction: [
      "You are writing a screenplay analysis report for the writer.",
      `Write a ${selection.label} as polished prose, not bullet-point raw notes.`,
      `Keep the response between ${selection.minWords} and ${selection.maxWords} words.`,
      "Base the report only on the provided script content.",
      "Be specific, insightful, and practical.",
      "Do not use markdown fences.",
      extra ? `Extra user guidance: ${extra}` : ""
    ].filter(Boolean).join(" "),
    input: `SCRIPT TITLE: ${title}\nREPORT TYPE: ${selection.label}\n\nSCREENPLAY:\n${buildProjectScriptContext(project)}`
  };
}

function isAiConfigurationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("api key")
    || message.includes("openrouter")
    || message.includes("insufficient credits")
    || message.includes("access forbidden")
    || message.includes("rate limit")
    || message.includes("failed to fetch");
}

function buildLocalBreakdownFallback(project, selection, customPrompt = "") {
  const lines = Array.isArray(project?.lines) ? project.lines : [];
  const title = project?.title || "Untitled Script";
  const wordCount = (lines.map((line) => `${line?.text || ""} ${line?.secondary || ""}`).join(" ").match(/\b[\w'-]+\b/g) || []).length;
  const sceneLines = lines.filter((line) => line?.type === "scene" && String(line.text || "").trim());
  const dialogueLines = lines.filter((line) => line?.type === "dialogue" && String(line.text || "").trim());
  const actionLines = lines.filter((line) => line?.type === "action" && String(line.text || "").trim());
  const characterNames = [...new Set(lines.filter((line) => line?.type === "character").map((line) => String(line.text || "").trim()).filter(Boolean))];
  const locationNames = [...new Set(sceneLines.map((line) => String(line.text || "").split(" - ")[0].trim()).filter(Boolean))];
  const firstScene = sceneLines[0]?.text || "No clear opening scene yet.";
  const lastScene = sceneLines[sceneLines.length - 1]?.text || "No clear closing scene yet.";
  const promptNote = String(customPrompt || "").trim();

  const templates = {
    characters: `${title} currently surfaces ${characterNames.length} distinct speaking character${characterNames.length === 1 ? "" : "s"}, with ${dialogueLines.length} dialogue block${dialogueLines.length === 1 ? "" : "s"} carrying most of the interpersonal weight. The most visible names so far are ${characterNames.slice(0, 6).join(", ") || "not yet clearly established"}, which suggests the cast focus is still forming around the voices already on the page. As you refine the draft, check whether each recurring speaker has a distinct emotional function, a visual identity in action lines, and enough contrast in rhythm or vocabulary to remain memorable. ${promptNote ? `Keep in mind this extra guidance: ${promptNote}` : ""}`.trim(),
    locations: `${title} moves through ${locationNames.length} identifiable location cue${locationNames.length === 1 ? "" : "s"}, anchored by scene headings such as ${locationNames.slice(0, 5).join(", ") || "the current draft’s early settings"}. This gives the script a spatial framework, but the strongest pages will be the ones where each place feels dramatically specific rather than only functional. Review whether the repeated spaces evolve in mood, pressure, or symbolic meaning as scenes progress, and whether transitions between settings feel intentional. ${promptNote ? `Additional request noted: ${promptNote}` : ""}`.trim(),
    scenes: `${title} currently contains ${sceneLines.length} scene heading${sceneLines.length === 1 ? "" : "s"} across roughly ${wordCount.toLocaleString()} word${wordCount === 1 ? "" : "s"}. The draft opens around ${firstScene} and currently lands on ${lastScene}, which gives a visible beginning-to-current-end pathway even before fine structure is polished. As a next pass, check whether each scene changes the dramatic temperature, whether scene turns arrive soon enough, and whether action blocks are earning their place between dialogue beats. ${promptNote ? `The requested lens for this reading is: ${promptNote}` : ""}`.trim(),
    "storyline-theme": `${title} reads like a draft that is already building a defined dramatic spine through ${sceneLines.length} scene${sceneLines.length === 1 ? "" : "s"}, ${dialogueLines.length} dialogue block${dialogueLines.length === 1 ? "" : "s"}, and a steady interplay between spoken conflict and action description. The opening movement at ${firstScene} sets the story in motion, while the latest material at ${lastScene} suggests where the emotional or thematic pressure is currently landing. On the next rewrite, focus on whether the central idea is visible not just in what characters say, but in the repeated choices, reversals, settings, and consequences that keep returning on the page.`.trim(),
    style: `${title} is currently written with ${actionLines.length} action block${actionLines.length === 1 ? "" : "s"} and ${dialogueLines.length} dialogue block${dialogueLines.length === 1 ? "" : "s"}, which makes it possible to assess its style from both narrative texture and spoken rhythm. The writing will feel stronger when action remains visual and economical, dialogue sounds character-specific rather than interchangeable, and the scene headings guide pace without becoming repetitive. A useful polish pass here is to trim any generic phrasing, sharpen verbs inside action lines, and make sure emotional subtext is carried by behavior as much as by spoken explanation.`.trim(),
    scenery: `${title} already establishes a visible scenic frame through headings like ${sceneLines.slice(0, 4).map((line) => line.text).join(", ") || "the current scene structure"}, but the next level of polish is making each environment feel dramatically alive. Strong scenery development does more than tell us where we are; it shapes tension, rhythm, and emotional temperature. Revisit whether the environment is interacting with the characters, whether repeated spaces change across the story, and whether key images from the world of the script are strong enough to stay in the reader’s memory.`.trim(),
    props: `${title} is far enough along to begin noticing concrete repeated objects, gestures, and situational anchors even without a full AI pass. In screenplay terms, the strongest props are not just visual clutter; they become memory hooks, emotional triggers, or plot devices. As you revise, look for objects that recur in action and dialogue, make sure they are introduced clearly when they matter, and check whether any useful symbolic or practical props can be emphasized more consistently across scenes. ${promptNote ? `Extra focus requested: ${promptNote}` : ""}`.trim()
  };

  return templates[selection.key] || `${title} currently contains ${sceneLines.length} scene${sceneLines.length === 1 ? "" : "s"}, ${characterNames.length} speaking character${characterNames.length === 1 ? "" : "s"}, and about ${wordCount.toLocaleString()} word${wordCount === 1 ? "" : "s"}. This fallback report was generated locally because the AI service is not currently available, but it still gives you a grounded overview of the present draft and where the next rewrite pass can focus.`.trim();
}

async function typeBreakdownText(node, text) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let buffer = "";
  for (let index = 0; index < words.length; index += 1) {
    buffer += `${index ? " " : ""}${words[index]}`;
    node.textContent = buffer;
    if (index % 6 === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 18));
    }
  }
}

async function generateBreakdownSections(project, request) {
  const selections = getBreakdownSelections();
  const customPrompt = request.breakdownPrompt || document.getElementById("exportBreakdownPrompt")?.value || "";
  const { card, title, meta, output } = getBreakdownLiveNodes();
  const progressCard = document.getElementById("exportProgressCard");
  const progressLabel = document.getElementById("exportProgressLabel");
  const progressPercent = document.getElementById("exportProgressPercent");
  const progressDetail = document.getElementById("exportProgressDetail");
  const progressFill = document.getElementById("exportProgressFill");
  if (!selections.length) {
    throw new Error("Select at least one AI report section before generating the report.");
  }
  reportGenerationController?.abort();
  reportGenerationController = new AbortController();
  if (card) card.hidden = false;
  if (title) title.textContent = "Result";
  if (meta) meta.textContent = "Reading the screenplay...";
  if (output) {
    setReportEditorHtml("");
    setReportEditorEditing(true);
  }
  if (progressCard) progressCard.hidden = false;
  if (progressLabel) progressLabel.textContent = "Reading screenplay...";
  if (progressPercent) progressPercent.textContent = "0%";
  if (progressDetail) progressDetail.textContent = "Preparing the AI report workspace.";
  if (progressFill) progressFill.style.width = "0%";

  const generatedSections = [];
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const percent = Math.round((index / selections.length) * 100);
    if (meta) meta.textContent = `Writing ${selection.label} ${index + 1}/${selections.length}...`;
    if (progressLabel) progressLabel.textContent = `Writing ${selection.label}...`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressDetail) progressDetail.textContent = `Building section ${index + 1} of ${selections.length}.`;
    if (progressFill) progressFill.style.width = `${percent}%`;
    const bodyEl = appendReportSectionShell(selection);
    let text = "";
    try {
      text = await AI.generateText({
        ...buildBreakdownPrompt(project, selection, customPrompt),
        signal: reportGenerationController.signal
      });
    } catch (error) {
      if (!isAiConfigurationError(error)) {
        throw error;
      }
      text = buildLocalBreakdownFallback(project, selection, customPrompt);
      if (progressDetail) {
        progressDetail.textContent = "AI service is unavailable, so Wraita is building a local fallback report from the script.";
      }
    }
    if (bodyEl) {
      await typeBreakdownText(bodyEl, text);
    }
    generatedSections.push({
      key: selection.key,
      label: selection.label,
      minWords: selection.minWords,
      maxWords: selection.maxWords,
      html: bodyEl?.parentElement?.innerHTML || `<p>${escapeHtml(String(text || "").trim())}</p>`,
      text: String(text || "").trim()
    });
  }
  if (meta) meta.textContent = "Report ready for export.";
  if (progressLabel) progressLabel.textContent = "Report ready.";
  if (progressPercent) progressPercent.textContent = "100%";
  if (progressDetail) progressDetail.textContent = "You can edit, save, and build the report now.";
  if (progressFill) progressFill.style.width = "100%";
  request.generatedSections = generatedSections;
  request.reportHtml = getReportEditorHtml();
  request.includeCharacters = generatedSections.some((item) => item.key === "characters");
  request.includeLocations = generatedSections.some((item) => item.key === "locations");
  request.includeScenes = generatedSections.some((item) => item.key === "scenes");
  request.customPrompt = customPrompt;
  reportGenerationController = null;
  return request;
}

function getExportTypeLabel(exportType) {
  return exportType === "full" ? "Full Script"
    : exportType === "character" ? "Character Export"
    : exportType === "character-packet" ? "Character Packet Export"
    : exportType === "scene" ? "Scene Export"
    : exportType === "location" ? "Location Export"
    : exportType === "revision" ? "Revision Export"
    : exportType === "production" ? "Production Export"
    : exportType === "collaborative" ? "Collaborative Export"
    : exportType === "shooting" ? "Shooting Script"
    : exportType === "breakdown" ? "AI Report"
    : "Export";
}

function getExportActorName() {
  return auth.currentUser?.displayName || auth.currentUser?.email || "Current user";
}

function sanitizeExportPresetEntry(entry) {
  return {
    id: entry.id || uid("exportPreset"),
    name: String(entry.name || "Untitled Preset").trim() || "Untitled Preset",
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exportType: entry.exportType || "full",
    format: entry.format || "pdf",
    request: entry.request ? JSON.parse(JSON.stringify(entry.request)) : {}
  };
}

function getStoredExportPresets(project) {
  return Array.isArray(project?.exportPresets) ? project.exportPresets : [];
}

function renderExportPresetOptions(project = getCurrentProject()) {
  const select = document.getElementById("exportPresetSelect");
  const applyBtn = document.getElementById("exportPresetApplyBtn");
  const deleteBtn = document.getElementById("exportPresetDeleteBtn");
  if (!select) return;
  const presets = getStoredExportPresets(project);
  const currentValue = select.value;
  select.innerHTML = ['<option value="">Choose preset</option>', ...presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)].join("");
  if (presets.some((preset) => preset.id === currentValue)) {
    select.value = currentValue;
  }
  if (applyBtn) applyBtn.disabled = !select.value;
  if (deleteBtn) deleteBtn.disabled = !select.value;
}

function buildExportHistorySummary(request) {
  if (request.exportType === "character" || request.exportType === "character-packet") {
    return `${request.characters?.length || 0} character${request.characters?.length === 1 ? "" : "s"} selected`;
  }
  if (request.exportType === "scene") {
    if (request.sceneRange) return `Range ${request.sceneRange.start}-${request.sceneRange.end}`;
    return `${request.sceneIds?.length || 0} scene${request.sceneIds?.length === 1 ? "" : "s"} selected`;
  }
  if (request.exportType === "location") {
    return request.location || "Location packet";
  }
  if (request.exportType === "revision") {
    return `${request.versionA?.label || "Version A"} vs ${request.versionB?.label || "Version B"}`;
  }
  if (request.exportType === "production") {
    const bits = [];
    if (request.locations?.[0]) bits.push(request.locations[0]);
    if (request.timeOfDay?.[0]) bits.push(request.timeOfDay[0]);
    if (request.sceneRange) bits.push(`Range ${request.sceneRange.start}-${request.sceneRange.end}`);
    if (request.characters?.length) bits.push(`${request.characters.length} character${request.characters.length === 1 ? "" : "s"}`);
    return bits.join(" Â· ") || "Filtered production packet";
  }
  if (request.exportType === "collaborative") {
    const bits = [];
    if (request.assignedWriter) bits.push(request.assignedWriter);
    if (request.reviewer) bits.push(`Reviewer: ${request.reviewer}`);
    if (request.editor) bits.push(`Editor: ${request.editor}`);
    if (request.status) bits.push(request.status);
    return bits.join(" Â· ") || "Collaborative scene packet";
  }
  if (request.exportType === "breakdown") {
    const bits = [];
    if (request.includeCharacters) bits.push("Characters");
    if (request.includeLocations) bits.push("Locations");
    if (request.includeScenes) bits.push("Scenes");
    return bits.join(" | ") || "AI report";
  }
  return "Whole screenplay";
}

function normalizeCollaborativeStatusLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "done") return "approved";
  if (normalized === "review") return "awaiting-review";
  if (["scheduled", "ready", "running"].includes(normalized)) return "awaiting-ai";
  if (normalized === "failed") return "failed";
  if (normalized === "in-progress") return "in-progress";
  if (normalized === "todo") return "todo";
  return normalized;
}

function buildCollaborativeExportContext(project, exportDocument) {
  const tasks = Array.isArray(project?.workspace?.tasks) ? project.workspace.tasks : Array.isArray(project?.assignments) ? project.assignments : [];
  const comments = Array.isArray(project?.comments) ? project.comments : [];
  const getSceneIdForLineId = (lineId) => {
    if (!lineId) return "";
    const lineIndex = (project?.lines || []).findIndex((line) => line.id === lineId);
    if (lineIndex < 0) return "";
    for (let index = lineIndex; index >= 0; index -= 1) {
      if (project.lines[index]?.type === "scene") {
        return project.lines[index].id;
      }
    }
    return "";
  };
  const scenes = exportDocument.scenes.map((scene) => {
    const sceneTasks = tasks.filter((task) => task.sceneId === scene.id || (task.lineId && getSceneIdForLineId(task.lineId) === scene.id));
    const sceneComments = comments.filter((comment) => comment.sceneId === scene.id || (comment.lineId && getSceneIdForLineId(comment.lineId) === scene.id));
    return {
      id: scene.id,
      assignedWriters: [...new Set(sceneTasks.filter((task) => task.assigneeType !== "system").map((task) => task.assignedLabel || task.assignedTo).filter(Boolean))],
      reviewers: [...new Set([
        ...sceneComments.map((comment) => comment.author || comment.userName).filter(Boolean),
        ...sceneTasks.flatMap((task) => (task.comments || []).map((comment) => comment.author)).filter(Boolean)
      ])],
      editors: [...new Set(sceneTasks.map((task) => task.createdByName).filter(Boolean))],
      statuses: [...new Set(sceneTasks.flatMap((task) => [
        normalizeCollaborativeStatusLabel(task.status),
        normalizeCollaborativeStatusLabel(task.aiState)
      ]).filter(Boolean))]
    };
  });
  return {
    scenes,
    assignedWriters: [...new Set(scenes.flatMap((scene) => scene.assignedWriters))].sort((a, b) => a.localeCompare(b)),
    reviewers: [...new Set(scenes.flatMap((scene) => scene.reviewers))].sort((a, b) => a.localeCompare(b)),
    editors: [...new Set(scenes.flatMap((scene) => scene.editors))].sort((a, b) => a.localeCompare(b))
  };
}

function sanitizeExportHistoryEntry(entry) {
  return {
    id: entry.id || uid("export"),
    createdAt: entry.createdAt || new Date().toISOString(),
    exportType: entry.exportType || "full",
    format: entry.format || "pdf",
    user: entry.user || getExportActorName(),
    projectId: entry.projectId || "",
    projectTitle: entry.projectTitle || "Untitled Script",
    summary: entry.summary || "",
    options: entry.options ? { ...entry.options } : {},
    request: entry.request ? JSON.parse(JSON.stringify(entry.request)) : {}
  };
}

function updateExportProgressUI({ active = false, label = "Preparing export...", detail = "Reviewing your export settings.", percent = 0 } = {}) {
  const card = document.getElementById("exportProgressCard");
  const labelNode = document.getElementById("exportProgressLabel");
  const detailNode = document.getElementById("exportProgressDetail");
  const percentNode = document.getElementById("exportProgressPercent");
  const fillNode = document.getElementById("exportProgressFill");
  if (!card || !labelNode || !detailNode || !percentNode || !fillNode) return;
  card.hidden = !active;
  labelNode.textContent = label;
  detailNode.textContent = detail;
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  percentNode.textContent = `${safePercent}%`;
  fillNode.style.width = `${safePercent}%`;
}

function clearExportProgressUI() {
  updateExportProgressUI({ active: false, label: "Preparing export...", detail: "Reviewing your export settings.", percent: 0 });
}

function getStoredScreenplayExportHistory(project = getCurrentProject()) {
  const entries = Array.isArray(project?.exportHistory) ? project.exportHistory : [];
  return entries.filter((entry) => String(entry?.exportType || "full") !== "breakdown");
}

function getStoredReportExportHistory(project = getCurrentProject()) {
  const entries = Array.isArray(project?.reportExportHistory) ? project.reportExportHistory : [];
  return entries.filter((entry) => String(entry?.exportType || "") === "breakdown");
}

async function advanceExportProgress(step) {
  updateExportProgressUI(step);
  await new Promise((resolve) => window.setTimeout(resolve, 40));
}

function renderExportHistory(project = getCurrentProject()) {
  const list = document.getElementById("exportHistoryList");
  const empty = document.getElementById("exportHistoryEmpty");
  if (!list || !empty) return;

  const items = [...getStoredScreenplayExportHistory(project)].reverse();
  empty.hidden = items.length > 0;
  list.hidden = items.length === 0;
  if (!items.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = items.map((entry) => {
    const createdAt = entry.createdAt
      ? new Date(entry.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "Unknown";
    return `
      <article class="export-history-item" data-export-history-id="${escapeHtml(entry.id)}">
        <div class="export-history-copy">
          <h5 class="export-history-title">${escapeHtml(getExportTypeLabel(entry.exportType))} Â· ${escapeHtml(String(entry.format || "").toUpperCase())}</h5>
          <p class="export-history-meta">${escapeHtml(createdAt)} Â· ${escapeHtml(entry.user || "Current user")} Â· ${escapeHtml(entry.projectTitle || "Untitled Script")}</p>
          <p class="export-history-meta">${escapeHtml(entry.summary || "Saved export settings ready for re-download.")}</p>
        </div>
        <div class="export-history-actions">
          <button class="ghost-button btn-sm" type="button" data-export-history-action="download">Re-download</button>
          <button class="ghost-button btn-sm" type="button" data-export-history-action="view">View Settings</button>
          <button class="ghost-button btn-sm" type="button" data-export-history-action="delete">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderExportQueueList(project = getCurrentProject()) {
  const list = document.getElementById("exportQueueList");
  const empty = document.getElementById("exportQueueEmpty");
  if (!list || !empty) return;
  const projectId = project?.id || "";
  const items = state.exportJobs
    .filter((entry) => entry.projectId === projectId && String(entry?.request?.exportType || "full") !== "breakdown")
    .slice()
    .reverse()
    .slice(0, 8);
  empty.hidden = items.length > 0;
  list.hidden = items.length === 0;
  if (!items.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = items.map((entry) => {
    const createdAt = entry.createdAt
      ? new Date(entry.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "Unknown";
    return `
      <article class="export-queue-item">
        <div class="export-history-copy">
          <h5 class="export-history-title">${escapeHtml(getExportTypeLabel(entry.request?.exportType || "full"))} Â· ${escapeHtml(String(entry.request?.format || "pdf").toUpperCase())}</h5>
          <p class="export-history-meta">${escapeHtml(createdAt)} Â· ${escapeHtml((entry.status || "queued").replace(/^./, (value) => value.toUpperCase()))} Â· ${escapeHtml(`${Math.round(Number(entry.progress) || 0)}%`)}</p>
          <p class="export-history-meta">${escapeHtml(entry.detail || entry.label || "Preparing screenplay export.")}</p>
        </div>
      </article>
    `;
  }).join("");
}

function renderExportCenterMetrics(project = getCurrentProject()) {
  const container = document.getElementById("exportCenterMetrics");
  if (!container) return;
  const history = getStoredScreenplayExportHistory(project);
  const presets = getStoredExportPresets(project);
  const formatCounts = history.reduce((acc, entry) => {
    const key = String(entry?.format || "pdf").toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const mostUsedFormat = Object.entries(formatCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || "None yet";
  const lastExport = history.length ? new Date(history[history.length - 1].createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "No exports yet";
  const activeJobs = state.exportJobs.filter((entry) =>
    entry.projectId === project?.id &&
    String(entry?.request?.exportType || "full") !== "breakdown" &&
    (entry.status === "queued" || entry.status === "running")
  ).length;
  container.innerHTML = [
    { label: "Total exports", value: String(history.length) },
    { label: "Saved presets", value: String(presets.length) },
    { label: "Most used format", value: mostUsedFormat },
    { label: "Active jobs", value: String(activeJobs) },
    { label: "Last export", value: lastExport }
  ].map((item) => `
    <div class="export-preview-item">
      <span class="export-preview-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join("");
}

function renderExportCenter(project = getCurrentProject()) {
  renderExportCenterMetrics(project);
  renderExportHistory(project);
  renderExportQueueList(project);
}

function recordExportHistory(project, request) {
  if (!project) return;
  const entry = sanitizeExportHistoryEntry({
    exportType: request.exportType,
    format: request.format,
    user: getExportActorName(),
    projectId: project.id,
    projectTitle: project.title,
    summary: buildExportHistorySummary(request),
    options: request.options,
    request,
    createdAt: new Date().toISOString()
  });
  if (String(request?.exportType || "full") === "breakdown") {
    project.reportExportHistory = Array.isArray(project.reportExportHistory) ? project.reportExportHistory : [];
    project.reportExportHistory.push(entry);
    if (project.reportExportHistory.length > 24) {
      project.reportExportHistory = project.reportExportHistory.slice(-24);
    }
  } else {
    project.exportHistory = Array.isArray(project.exportHistory) ? project.exportHistory : [];
    project.exportHistory.push(entry);
    if (project.exportHistory.length > 24) {
      project.exportHistory = project.exportHistory.slice(-24);
    }
  }
  persistProjects(false, { syncInputs: false });
  renderExportCenter(project);
}

function getStoredExportHistoryEntry(project, entryId) {
  if (!project || !entryId) return null;
  return getStoredScreenplayExportHistory(project).find((entry) => entry.id === entryId) || null;
}

function getStoredExportPreset(project, presetId) {
  if (!project || !presetId) return null;
  return getStoredExportPresets(project).find((entry) => entry.id === presetId) || null;
}

function setCheckedExportValues(selector, values = []) {
  const normalizedValues = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
  document.querySelectorAll(selector).forEach((input) => {
    input.checked = normalizedValues.has(String(input.value));
  });
}

function applyExportRequestToDialog(request = {}) {
  const exportType = String(request.exportType || "full");
  const format = String(request.format || "pdf");
  const options = request.options || {};

  const exportTypeSelect = document.getElementById("exportTypeSelect");
  const exportFormatSelect = document.getElementById("exportFormatSelect");
  if (exportTypeSelect) exportTypeSelect.value = exportType;
  if (exportFormatSelect) exportFormatSelect.value = format;

  const setChecked = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.checked = Boolean(value);
  };
  const exportModeSelect = document.getElementById("exportModeSelect");
  if (exportModeSelect) exportModeSelect.value = String(options.exportMode || "spec");
  const setValue = (id, value, fallback = "") => {
    const element = document.getElementById(id);
    if (element) element.value = value ?? fallback;
  };

  setChecked("exportIncludeNotes", options.includeNotes);
  setChecked("exportIncludeComments", options.includeComments);
  setChecked("exportIncludeSceneNumbers", options.includeSceneNumbers);
  setChecked("exportIncludeMetadata", options.includeMetadata !== false);
  setChecked("exportIncludeTitlePage", options.includeTitlePage !== false);
  setChecked("exportIncludePageNumbers", options.includePageNumbers);
  setChecked("exportEnableWatermarkSettings", options.enableWatermarkSettings);
  setChecked("exportIncludeRevisions", options.includeRevisions);
  setChecked("exportIncludeSceneDescriptions", options.includeSceneDescriptions);
  setChecked("exportBreakdownCharacters", request.includeCharacters !== false);
  setChecked("exportBreakdownLocations", request.includeLocations !== false);
  setChecked("exportBreakdownScenes", request.includeScenes !== false);
  setValue("exportBreakdownPrompt", request.breakdownPrompt || "", "");
  setValue("exportBreakdownCharactersMin", request.breakdownWords?.characters?.min || 120, 120);
  setValue("exportBreakdownCharactersMax", request.breakdownWords?.characters?.max || 220, 220);
  setValue("exportBreakdownLocationsMin", request.breakdownWords?.locations?.min || 120, 120);
  setValue("exportBreakdownLocationsMax", request.breakdownWords?.locations?.max || 220, 220);
  setValue("exportBreakdownScenesMin", request.breakdownWords?.scenes?.min || 160, 160);
  setValue("exportBreakdownScenesMax", request.breakdownWords?.scenes?.max || 280, 280);

  setValue("exportWatermarkPreset", options.watermarkPreset || "", "");
  setValue("exportWatermarkPosition", options.watermarkPosition || "diagonal", "diagonal");
  setValue("exportWatermarkOpacity", String(options.watermarkOpacity ?? 0.12), "0.12");
  setValue("exportWatermarkText", options.watermarkText || "", "");
  setValue("exportCoverTitle", options.coverPage?.title || "", "");
  setValue("exportCoverSubtitle", options.coverPage?.subtitle || "", "");
  setValue("exportCoverAuthor", options.coverPage?.author || "", "");
  setValue("exportCoverCoWriters", options.coverPage?.coWriters || "", "");
  setValue("exportCoverContact", options.coverPage?.contact || "", "");
  setValue("exportCoverCompany", options.coverPage?.company || "", "");
  setValue("exportCoverVersion", options.coverPage?.version || "", "");
  setValue("exportCoverDraftDate", options.coverPage?.draftDate || "", "");
  setValue("exportCoverDetails", options.coverPage?.details || "", "");
  setValue("exportCoverCopyright", options.coverPage?.copyrightNotice || "", "");

  setCheckedExportValues("input[name='exportCharacterName']", request.characters || []);
  setCheckedExportValues("input[name='exportProductionCharacterName']", request.characters || []);
  setCheckedExportValues("input[name='exportSceneId']", request.sceneIds || []);

  const sceneRange = request.sceneRange || null;
  setValue("exportSceneRangeStart", sceneRange?.start || "", "");
  setValue("exportSceneRangeEnd", sceneRange?.end || "", "");
  setValue("exportProductionRangeStart", sceneRange?.start || "", "");
  setValue("exportProductionRangeEnd", sceneRange?.end || "", "");

  setValue("exportLocationSelect", request.location || "", "");
  setValue("exportProductionLocationSelect", request.locations?.[0] || "", "");
  setValue("exportProductionTimeSelect", request.timeOfDay?.[0] || "", "");
  setValue("exportRevisionVersionA", request.versionA?.id || "", "");
  setValue("exportRevisionVersionB", request.versionB?.id || "", "");

  updateExportDialogState();
}

async function saveCurrentExportPreset() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const name = await customPrompt("Name this preset so you can reuse the same export setup later.", "Save Export Preset", "Producer Package");
  if (name == null) return;
  const trimmedName = String(name).trim();
  if (!trimmedName) {
    await customAlert("Preset name cannot be empty.", "Save Export Preset");
    return;
  }
  const request = buildExportRequestFromDialog(project);
  const nextPreset = sanitizeExportPresetEntry({
    name: trimmedName,
    exportType: request.exportType,
    format: request.format,
    request
  });
  project.exportPresets = getStoredExportPresets(project).filter((entry) => entry.name.toLowerCase() !== trimmedName.toLowerCase());
  project.exportPresets.push(nextPreset);
  project.exportPresets = project.exportPresets.slice(-12);
  persistProjects(false, { syncInputs: false });
  renderExportPresetOptions(project);
  renderExportCenterMetrics(project);
  const select = document.getElementById("exportPresetSelect");
  if (select) select.value = nextPreset.id;
  showToast(`Saved preset "${trimmedName}".`, "success", { duration: 2200 });
}

async function applySelectedExportPreset() {
  const project = getCurrentProject();
  const presetId = document.getElementById("exportPresetSelect")?.value || "";
  const preset = getStoredExportPreset(project, presetId);
  if (!preset) return;
  applyExportRequestToDialog(preset.request || {});
  showToast(`Applied preset "${preset.name}".`, "success", { duration: 1800 });
}

async function deleteSelectedExportPreset() {
  const project = getCurrentProject();
  if (!project) return;
  const select = document.getElementById("exportPresetSelect");
  const preset = getStoredExportPreset(project, select?.value || "");
  if (!preset) return;
  const confirmed = await customConfirm(`Delete the preset "${preset.name}"?`, "Delete Export Preset");
  if (!confirmed) return;
  project.exportPresets = getStoredExportPresets(project).filter((entry) => entry.id !== preset.id);
  persistProjects(false, { syncInputs: false });
  if (select) select.value = "";
  renderExportPresetOptions(project);
  renderExportCenterMetrics(project);
  showToast(`Deleted preset "${preset.name}".`, "success", { duration: 1800 });
}

function updateExportJobRecord(jobId, patch = {}) {
  const job = state.exportJobs.find((entry) => entry.id === jobId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function syncExportJobUI(job) {
  if (!job) return;
  if (job.projectId === state.currentProjectId || job.projectId === getCurrentProject()?.id) {
    updateExportProgressUI({
      active: job.status === "running",
      label: job.label || "Preparing export...",
      detail: job.detail || "Preparing screenplay export...",
      percent: job.progress || 0
    });
    renderExportQueueList(getCurrentProject());
    renderExportCenterMetrics(getCurrentProject());
  }
  if (job.toastId) {
    updateToast(job.toastId, job.detail || job.label || "Preparing screenplay export...", job.status === "failed" ? "error" : job.status === "completed" ? "success" : "loading", {
      duration: job.status === "running" ? 0 : job.status === "failed" ? 4200 : 2600
    });
  }
}

async function processQueuedExportJobs() {
  if (state.currentExportJobId) return;
  const nextJob = state.exportJobs.find((entry) => entry.status === "queued");
  if (!nextJob) return;

  state.currentExportJobId = nextJob.id;
  updateExportJobRecord(nextJob.id, {
    status: "running",
    progress: 12,
    label: "Preparing export...",
    detail: "Reviewing the queued export settings."
  });
  syncExportJobUI(nextJob);

  const project = state.projects.find((entry) => entry.id === nextJob.projectId) || getCurrentProject();
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    const outcome = await executeExportRequest(project, nextJob.request || {});
    if (!outcome) {
      updateExportJobRecord(nextJob.id, {
        status: "failed",
        progress: 100,
        label: "Export could not start.",
        detail: "The queued export is missing required selections."
      });
      syncExportJobUI(nextJob);
      return;
    }

    updateExportJobRecord(nextJob.id, {
      progress: 68,
      label: "Rendering export output...",
      detail: "Building the queued screenplay package for download or print."
    });
    syncExportJobUI(nextJob);
    await new Promise((resolve) => window.setTimeout(resolve, 40));

    await runExportResult(outcome.result, project, outcome.message);
    logActivity(project.id, outcome.message, { action: outcome.action, workspaceId: project.workspace?.id || project.id }).catch(() => {});
    recordExportHistory(project, nextJob.request || {});
    updateExportJobRecord(nextJob.id, {
      status: "completed",
      progress: 100,
      label: "Export ready.",
      detail: nextJob.request?.format === "pdf" ? "The queued export opened the print flow." : "The queued export finished downloading.",
      completedAt: new Date().toISOString()
    });
    syncExportJobUI(nextJob);
  } catch (error) {
    console.error("Queued export failed", error);
    updateExportJobRecord(nextJob.id, {
      status: "failed",
      progress: 100,
      label: "Export failed.",
      detail: "The queued export could not be generated."
    });
    syncExportJobUI(nextJob);
  } finally {
    window.setTimeout(() => clearExportProgressUI(), 900);
    state.currentExportJobId = "";
    window.setTimeout(() => {
      state.exportJobs = state.exportJobs.filter((entry) => entry.status === "queued" || entry.status === "running");
      void processQueuedExportJobs();
    }, 0);
  }
}

function enqueueExportJob(project, request) {
  const queuedAhead = state.exportJobs.filter((entry) => entry.status === "queued" || entry.status === "running").length;
  const id = uid("exportJob");
  const toastId = showToast(
    queuedAhead ? `Queued export ${queuedAhead + 1}. Waiting for earlier export jobs to finish.` : "Queued screenplay export.",
    "loading",
    { duration: 0 }
  );
  state.exportJobs.push({
    id,
    projectId: project.id,
    request,
    status: "queued",
    progress: 0,
    label: "Queued export",
    detail: queuedAhead ? `Waiting behind ${queuedAhead} export job${queuedAhead === 1 ? "" : "s"}.` : "This export will start in a moment.",
    createdAt: new Date().toISOString(),
    toastId
  });
  void processQueuedExportJobs();
}

function buildExportRequestFromDialog(project) {
  const exportType = document.getElementById("exportTypeSelect")?.value || "full";
  const format = document.getElementById("exportFormatSelect")?.value || "pdf";
  const coverVersionRaw = document.getElementById("exportCoverVersion")?.value || "";
  const options = {
    exportMode: document.getElementById("exportModeSelect")?.value || "spec",
    includeNotes: Boolean(document.getElementById("exportIncludeNotes")?.checked),
    includeComments: Boolean(document.getElementById("exportIncludeComments")?.checked),
    includeSceneNumbers: Boolean(document.getElementById("exportIncludeSceneNumbers")?.checked),
    includeMetadata: Boolean(document.getElementById("exportIncludeMetadata")?.checked),
    includeTitlePage: Boolean(document.getElementById("exportIncludeTitlePage")?.checked),
    includePageNumbers: Boolean(document.getElementById("exportIncludePageNumbers")?.checked),
    coverPage: {
      title: document.getElementById("exportCoverTitle")?.value || "",
      subtitle: document.getElementById("exportCoverSubtitle")?.value || "",
      author: document.getElementById("exportCoverAuthor")?.value || "",
      coWriters: document.getElementById("exportCoverCoWriters")?.value || "",
      contact: document.getElementById("exportCoverContact")?.value || "",
      company: document.getElementById("exportCoverCompany")?.value || "",
      version: coverVersionRaw,
      draftDate: document.getElementById("exportCoverDraftDate")?.value || "",
      details: document.getElementById("exportCoverDetails")?.value || "",
      copyrightNotice: document.getElementById("exportCoverCopyright")?.value || ""
    }
  };
  if (document.getElementById("exportEnableWatermarkSettings")?.checked) {
    options.enableWatermarkSettings = true;
    options.watermarkPreset = document.getElementById("exportWatermarkPreset")?.value || "";
    options.watermarkText = document.getElementById("exportWatermarkText")?.value || "";
    options.watermarkPosition = document.getElementById("exportWatermarkPosition")?.value || "diagonal";
    options.watermarkOpacity = Number(document.getElementById("exportWatermarkOpacity")?.value || 0.12);
  }
  const request = {
    exportType,
    format,
    options,
    projectId: project?.id || "",
    projectTitle: project?.title || "Untitled Script"
  };

  if (exportType === "character" || exportType === "character-packet") {
    request.characters = [...document.querySelectorAll("input[name='exportCharacterName']:checked")].map((input) => input.value);
    if (exportType === "character-packet") {
      request.options.includeSceneDescriptions = Boolean(document.getElementById("exportIncludeSceneDescriptions")?.checked);
    }
  } else if (exportType === "scene") {
    request.sceneIds = [...document.querySelectorAll("input[name='exportSceneId']:checked")].map((input) => input.value);
    request.sceneRange = parseOptionalRange(document.getElementById("exportSceneRangeStart")?.value, document.getElementById("exportSceneRangeEnd")?.value);
  } else if (exportType === "location") {
    request.location = document.getElementById("exportLocationSelect")?.value || "";
  } else if (exportType === "revision") {
    const versionAId = document.getElementById("exportRevisionVersionA")?.value || "";
    const versionBId = document.getElementById("exportRevisionVersionB")?.value || "";
    request.versionA = exportDialogContext.revisions.find((entry) => entry.id === versionAId) || null;
    request.versionB = exportDialogContext.revisions.find((entry) => entry.id === versionBId) || null;
  } else if (exportType === "production") {
    const location = document.getElementById("exportProductionLocationSelect")?.value || "";
    const timeOfDay = document.getElementById("exportProductionTimeSelect")?.value || "";
    request.locations = location ? [location] : [];
    request.timeOfDay = timeOfDay ? [timeOfDay] : [];
    request.characters = [...document.querySelectorAll("input[name='exportProductionCharacterName']:checked")].map((input) => input.value);
    request.sceneRange = parseOptionalRange(document.getElementById("exportProductionRangeStart")?.value, document.getElementById("exportProductionRangeEnd")?.value);
  } else if (exportType === "collaborative") {
    request.assignedWriter = document.getElementById("exportCollaborativeWriterSelect")?.value || "";
    request.reviewer = document.getElementById("exportCollaborativeReviewerSelect")?.value || "";
    request.editor = document.getElementById("exportCollaborativeEditorSelect")?.value || "";
    request.status = document.getElementById("exportCollaborativeStatusSelect")?.value || "";
  } else if (exportType === "shooting") {
    request.options.includeSceneNumbers = true;
    request.options.includeRevisions = Boolean(document.getElementById("exportIncludeRevisions")?.checked);
  } else if (exportType === "breakdown") {
    request.includeCharacters = Boolean(document.getElementById("exportBreakdownCharacters")?.checked);
    request.includeLocations = Boolean(document.getElementById("exportBreakdownLocations")?.checked);
    request.includeScenes = Boolean(document.getElementById("exportBreakdownScenes")?.checked);
    request.breakdownPrompt = document.getElementById("exportBreakdownPrompt")?.value || "";
    request.breakdownWords = {
      characters: {
        min: Number(document.getElementById("exportBreakdownCharactersMin")?.value || 120),
        max: Number(document.getElementById("exportBreakdownCharactersMax")?.value || 220)
      },
      locations: {
        min: Number(document.getElementById("exportBreakdownLocationsMin")?.value || 120),
        max: Number(document.getElementById("exportBreakdownLocationsMax")?.value || 220)
      },
      scenes: {
        min: Number(document.getElementById("exportBreakdownScenesMin")?.value || 160),
        max: Number(document.getElementById("exportBreakdownScenesMax")?.value || 280)
      }
    };
  }

  return request;
}

function getExportDialogProject() {
  const lockedProject = exportDialogProjectId
    ? state.projects.find((entry) => entry.id === exportDialogProjectId)
    : null;
  return lockedProject || getCurrentProject();
}

async function buildExportPreviewResult(project, request) {
  const previewRequest = {
    ...request,
    format: "pdf"
  };
  let exportDocument = null;
  switch (previewRequest.exportType) {
    case "character":
      if (!previewRequest.characters?.length) return null;
      exportDocument = buildCharacterExportDocument(project, previewRequest);
      break;
    case "character-packet":
      if (!previewRequest.characters?.length) return null;
      exportDocument = buildCharacterPacketExportDocument(project, previewRequest);
      break;
    case "scene":
      if (!previewRequest.sceneIds?.length && !previewRequest.sceneRange) return null;
      exportDocument = buildSceneExportDocument(project, previewRequest);
      break;
    case "location":
      if (!previewRequest.location) return null;
      exportDocument = buildLocationExportDocument(project, previewRequest);
      break;
    case "revision":
      if (!previewRequest.versionA || !previewRequest.versionB || previewRequest.versionA.id === previewRequest.versionB.id) return null;
      exportDocument = buildRevisionExportDocument(project, previewRequest);
      break;
    case "production":
      exportDocument = buildProductionExportDocument(project, previewRequest);
      break;
    case "collaborative":
      exportDocument = buildCollaborativeExportDocument(project, previewRequest);
      break;
    case "shooting":
      exportDocument = buildShootingScriptExportDocument(project, previewRequest);
      break;
    case "watermarked":
      exportDocument = buildWatermarkedScriptExportDocument(project, previewRequest);
      break;
    case "breakdown":
      return null;
    case "full":
    default:
      exportDocument = buildFullScriptExportDocument(project, previewRequest.options || previewRequest);
      break;
  }
  if (!exportDocument) return null;
  return {
    content: buildPrintableDocumentFromExportDocument(exportDocument, false),
    mimeType: "text/html;charset=utf-8"
  };
}

function setExportPreviewState({ html = "", message = "", showFrame = false } = {}) {
  const frame = document.getElementById("exportPreviewFrame");
  const empty = document.getElementById("exportPreviewEmpty");
  const openBtn = document.getElementById("exportPreviewOpenBtn");
  const refreshBtn = document.getElementById("exportPreviewRefreshBtn");
  const meta = document.getElementById("exportPreviewMeta");
  const format = document.getElementById("exportFormatSelect")?.value || "pdf";
  const validationNote = document.getElementById("exportValidationNote");
  const hasValidationError = Boolean(validationNote && !validationNote.hidden && String(validationNote.textContent || "").trim());
  if (frame) {
    frame.hidden = !showFrame;
    if (showFrame) {
      frame.srcdoc = decorateExportPreviewHtml(html);
    } else {
      frame.removeAttribute("srcdoc");
    }
  }
  if (empty) {
    empty.hidden = showFrame;
    empty.textContent = showFrame ? "" : "";
  }
  if (meta) {
    meta.textContent = showFrame
      ? "This is the live export layout from the current settings."
      : (message || "Preview the current screenplay export layout inside Wraita.");
  }
  if (openBtn) {
    openBtn.disabled = hasValidationError;
    openBtn.textContent = "Download";
  }
  if (refreshBtn) refreshBtn.disabled = false;
}

async function downloadExportFromPreview() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const downloadBtn = document.getElementById("exportPreviewOpenBtn");
  try {
    if (downloadBtn) downloadBtn.disabled = true;
    const request = buildExportRequestFromDialog(project);
    const outcome = await executeExportRequest(project, request);
    const result = outcome?.result;
    if (!result) return;
    downloadFile(result.filename, result.content, result.mimeType || DOCX_MIME_TYPE);
    showToast("Export downloaded.", "success", { duration: 2200 });
  } catch (error) {
    console.error("Preview download failed", error);
    customAlert(
      error instanceof Error ? error.message : "The export could not be downloaded from preview.",
      "Screenplay Export"
    );
  } finally {
    updateExportDialogState();
  }
}

function decorateExportPreviewHtml(html = "") {
  const previewCss = `
  <style id="wraita-export-preview-tune">
    html, body {
      background: #d8dbe2 !important;
      margin: 0 !important;
      padding: 0 !important;
      min-height: 100% !important;
    }
    body {
      overflow-y: auto !important;
    }
    .print-shell {
      display: grid !important;
      align-content: start !important;
      gap: 18px !important;
      padding: 14px 0 24px !important;
    }
    .print-page {
      margin: 0 auto !important;
      box-shadow: 0 10px 28px rgba(30, 36, 48, 0.16) !important;
      overflow: visible !important;
    }
    .print-page:not(:last-child)::after {
      content: "Page Break";
      position: absolute;
      left: 50%;
      bottom: -18px;
      transform: translateX(-50%);
      font: italic 11px/1.1 Georgia, serif;
      color: rgba(93, 99, 112, 0.9);
      letter-spacing: 0.02em;
      background: #d8dbe2;
      padding: 0 8px;
    }
    .cover-page,
    .production-cover-page {
      justify-content: center !important;
      padding-top: 1.5cm !important;
      padding-bottom: 1.5cm !important;
    }
    @media print {
      html, body {
        background: #fff !important;
      }
      .print-page {
        box-shadow: none !important;
      }
      .print-page:not(:last-child)::after {
        content: none !important;
      }
    }
  </style>`;
  if (!html) return html;
  return html.includes("</head>")
    ? html.replace("</head>", `${previewCss}</head>`)
    : `${previewCss}${html}`;
}

async function refreshExportPreview(force = false) {
  const dialog = document.getElementById("exportDialog");
  if (!dialog?.open || exportDialogMode === "report") return;
  const project = getExportDialogProject();
  if (!project) return;
  if (project.id === state.currentProjectId) {
    syncProjectFromInputs();
  }
  const request = buildExportRequestFromDialog(project);
  const refreshBtn = document.getElementById("exportPreviewRefreshBtn");
  if (refreshBtn) refreshBtn.disabled = true;
  if (force) {
    setExportPreviewState({ message: "Refreshing preview..." });
  }
  try {
    const result = await buildExportPreviewResult(project, request);
    if (!result?.content) {
      exportPreviewOpenUrl = "";
      setExportPreviewState({ message: "Choose the required export selections to preview this layout." });
      return;
    }
    const blob = new Blob([result.content], { type: result.mimeType || "text/html;charset=utf-8" });
    if (exportPreviewOpenUrl) {
      URL.revokeObjectURL(exportPreviewOpenUrl);
    }
    exportPreviewOpenUrl = URL.createObjectURL(blob);
    setExportPreviewState({ html: result.content, showFrame: true });
  } catch (error) {
    console.error("Export preview failed", error);
    exportPreviewOpenUrl = "";
    setExportPreviewState({ message: "Preview could not be built from the current export settings." });
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function scheduleExportPreviewRefresh(force = false) {
  if (exportDialogMode === "report") return;
  if (exportPreviewRefreshTimer) {
    window.clearTimeout(exportPreviewRefreshTimer);
  }
  exportPreviewRefreshTimer = window.setTimeout(() => {
    exportPreviewRefreshTimer = 0;
    void refreshExportPreview(force);
  }, force ? 40 : 180);
}

async function executeExportRequest(project, request) {
  const { exportType, format } = request;
  if (exportType === "character") {
    if (!request.characters?.length) {
      await customAlert("Select one or more characters before generating a character export.", "Character Export");
      return null;
    }
    return {
      result: await ExportService.exportCharacter(project, { format, characters: request.characters, options: request.options }),
      action: `export.character.${format}`,
      message: `Exported character pages as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "character-packet") {
    if (!request.characters?.length) {
      await customAlert("Select one or more characters before generating a character packet.", "Character Packet Export");
      return null;
    }
    return {
      result: await ExportService.exportCharacterPacket(project, { format, characters: request.characters, options: request.options }),
      action: `export.characterPacket.${format}`,
      message: `Exported the character packet as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "scene") {
    if (!request.sceneIds?.length && !request.sceneRange) {
      await customAlert("Select at least one scene or enter a valid scene range before generating a scene export.", "Scene Export");
      return null;
    }
    return {
      result: await ExportService.exportScenes(project, { format, sceneIds: request.sceneIds || [], sceneRange: request.sceneRange || null, options: request.options }),
      action: `export.scene.${format}`,
      message: `Exported selected scenes as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "location") {
    if (!request.location) {
      await customAlert("Select a location before generating a location export.", "Location Export");
      return null;
    }
    return {
      result: await ExportService.exportLocation(project, { format, location: request.location, options: request.options }),
      action: `export.location.${format}`,
      message: `Exported the location packet as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "revision") {
    if (!request.versionA || !request.versionB) {
      await customAlert("Select two versions before generating a revision export.", "Revision Export");
      return null;
    }
    if (request.versionA.id === request.versionB.id) {
      await customAlert("Choose two different versions before generating a revision export.", "Revision Export");
      return null;
    }
    return {
      result: await ExportService.exportRevision(project, { format, versionA: request.versionA, versionB: request.versionB, options: request.options }),
      action: `export.revision.${format}`,
      message: `Exported the revision report as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "production") {
    return {
      result: await ExportService.exportProduction(project, {
        format,
        locations: request.locations || [],
        timeOfDay: request.timeOfDay || [],
        characters: request.characters || [],
        sceneRange: request.sceneRange || null,
        options: request.options
      }),
      action: `export.production.${format}`,
      message: `Exported the production packet as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "collaborative") {
    return {
      result: await ExportService.exportCollaborative(project, {
        format,
        assignedWriter: request.assignedWriter || "",
        reviewer: request.reviewer || "",
        editor: request.editor || "",
        status: request.status || "",
        options: request.options
      }),
      action: `export.collaborative.${format}`,
      message: `Exported the collaborative packet as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "shooting") {
    return {
      result: await ExportService.exportShootingScript(project, {
        format,
        options: request.options
      }),
      action: `export.shooting.${format}`,
      message: `Exported the shooting script as ${format.toUpperCase()}.`
    };
  }
  if (exportType === "breakdown") {
    return {
      result: await ExportService.exportBreakdown(project, {
        format,
        includeCharacters: request.includeCharacters,
        includeLocations: request.includeLocations,
        includeScenes: request.includeScenes,
        generatedSections: request.generatedSections || [],
        customPrompt: request.customPrompt || "",
        options: request.options
      }),
      action: `export.breakdown.${format}`,
      message: `Exported the AI report as ${format.toUpperCase()}.`
    };
  }
  return {
    result: await ExportService.exportFullScript(project, { format, options: request.options }),
    action: `export.full.${format}`,
    message: `Exported the full screenplay as ${format.toUpperCase()}.`
  };
}

async function rerunStoredExportHistory(entry) {
  const project = getCurrentProject();
  if (!project) return;
  enqueueExportJob(project, entry.request || {});
}

function buildRevisionVersionOptions(project) {
  const currentLines = (project?.lines || []).map((line) => ({ ...line }));
  const options = [{
    id: "current",
    label: `Current Draft${project?.version ? ` v${project.version}` : ""}`,
    lines: currentLines
  }];

  const historySnapshots = Array.isArray(state.history) ? state.history : [];
  historySnapshots.forEach((snapshot, index) => {
    if (!Array.isArray(snapshot) || !snapshot.length) return;
    const id = `history_${index}`;
    const label = `Local History ${index + 1}`;
    if (!options.some((entry) => JSON.stringify(entry.lines) === JSON.stringify(snapshot))) {
      options.push({
        id,
        label,
        lines: snapshot.map((line) => ({ ...line }))
      });
    }
  });

  return options;
}

function renderRecoveryList() {
  const dialog = document.getElementById("fileRecoveryDialog");
  const list = document.getElementById("fileRecoveryList");
  const empty = document.getElementById("fileRecoveryEmpty");
  const stateTitle = document.getElementById("fileRecoveryStateTitle");
  const stateBody = document.getElementById("fileRecoveryStateBody");
  if (!dialog || !list || !empty) return;

  const deletedProjects = getDeletedProjects();
  empty.hidden = deletedProjects.length > 0;
  list.hidden = deletedProjects.length === 0;

  if (stateTitle && stateBody) {
    if (deletedProjects.length) {
      stateTitle.textContent = `${deletedProjects.length} recoverable file${deletedProjects.length === 1 ? "" : "s"} ready.`;
      stateBody.textContent = "Restore sends a script back to Home immediately. Delete removes it from recovery forever, so use it only when you are sure.";
    } else {
      stateTitle.textContent = "Recovery keeps your recent deletions close.";
      stateBody.textContent = "Restore returns a script to your library. Delete removes it from recovery permanently, so recheck the title before you confirm.";
    }
  }

  if (!deletedProjects.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = deletedProjects.map((entry) => {
    const deletedAt = entry.deletedAt
      ? new Date(entry.deletedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "Unknown";
    const lineCount = Array.isArray(entry.project?.lines)
      ? entry.project.lines.filter((line) => String(line?.text || "").trim() || String(line?.secondary || "").trim()).length
      : 0;
    return `
      <article class="recovery-item" data-recovery-id="${entry.id}">
        <div class="recovery-item-copy">
          <h3 class="recovery-item-title">${entry.project?.title || "Untitled Script"}</h3>
          <p class="recovery-item-meta">Deleted ${deletedAt}</p>
          <p class="recovery-item-meta">${lineCount} line${lineCount === 1 ? "" : "s"}</p>
        </div>
          <div class="recovery-item-actions">
            <button class="ghost-button btn-sm" type="button" data-recovery-action="recover">Recover</button>
            <button class="ghost-button btn-sm recovery-delete-button" type="button" data-recovery-action="permanent-delete">Delete</button>
          </div>
        </article>
      `;
  }).join("");
}

function openFileRecoveryDialog() {
  const dialog = document.getElementById("fileRecoveryDialog");
  if (!dialog) return;
  renderRecoveryList();
  dialog.showModal();
}

function closeFileRecoveryDialog() {
  document.getElementById("fileRecoveryDialog")?.close();
}

function openWorkspaceInboxPopup(trigger) {
  const popup = document.getElementById("workspace-inbox-popup");
  const card = popup?.querySelector(".popup-card");
  if (!popup || !card || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  popup.classList.add("active");
  const cardWidth = 360;
  const viewportPadding = 12;
  let left = rect.right - cardWidth;
  if (left < viewportPadding) left = viewportPadding;
  if (left + cardWidth > window.innerWidth - viewportPadding) {
    left = Math.max(viewportPadding, window.innerWidth - cardWidth - viewportPadding);
  }
  const preferredTop = rect.bottom + 8;
  const cardHeight = card.offsetHeight || 0;
  const maxTop = Math.max(viewportPadding, window.innerHeight - cardHeight - viewportPadding);
  const top = Math.min(preferredTop, maxTop);
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function closeWorkspaceInboxPopup() {
  document.getElementById("workspace-inbox-popup")?.classList.remove("active");
}

async function renderConversionJobsList() {
  const dialog = document.getElementById("conversionJobsDialog");
  const list = document.getElementById("conversionJobsList");
  const empty = document.getElementById("conversionJobsEmpty");
  if (!dialog || !list || !empty) return;

  const jobs = await listConversionJobRecords();
  empty.hidden = jobs.length > 0;
  list.hidden = jobs.length === 0;

  if (!jobs.length) {
    list.innerHTML = "";
    return;
  }

    list.innerHTML = jobs.map((job) => {
      const updatedAt = job.updatedAt || job.createdAt;
      const timestamp = updatedAt
        ? new Date(updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
        : "Unknown";
      const lineCount = Number(job.structuredLineCount || job.structuredLines?.length || 0);
      const warningCount = Array.isArray(job.warnings) ? job.warnings.filter(Boolean).length : 0;
      const statusLabel = escapeHtml(String(job.status || "queued"));
      return `
        <button class="conversion-job-item" type="button" data-conversion-job-id="${job.id}" data-conversion-job-status="${escapeHtml(String(job.status || "queued"))}">
          <div class="conversion-job-item-main">
            <div class="conversion-job-item-top">
              <div>
                <h4 class="conversion-job-item-title">${escapeHtml(job.fileName || "Untitled upload")}</h4>
                <p class="conversion-job-item-meta">Updated ${escapeHtml(timestamp)}</p>
              </div>
              <span class="conversion-job-item-status">${statusLabel}</span>
            </div>
            <p class="conversion-job-item-stage">${escapeHtml(job.stageLabel || "No stage available")}</p>
            <div class="conversion-job-item-grid">
              <div>
                <span>Project</span>
                <strong>${escapeHtml(job.projectId || "Not linked")}</strong>
              </div>
              <div>
                <span>Structured lines</span>
                <strong>${lineCount}</strong>
              </div>
              <div>
                <span>Warnings</span>
                <strong>${warningCount}</strong>
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("");
  }

async function openConversionJobsDialog() {
  const dialog = document.getElementById("conversionJobsDialog");
  if (!dialog) return;
  await renderConversionJobsList();
  dialog.showModal();
}

async function openCurrentProjectConversionInterface() {
  const project = getCurrentProject();
  if (!project?.conversionJobId) {
    await customAlert("This script does not have a saved conversion workspace yet.", "Conversion Interface");
    return;
  }
  const record = await getConversionJobRecord(project.conversionJobId);
  if (!record) {
    await customAlert("The saved conversion workspace for this script is not available on this device right now.", "Conversion Interface");
    return;
  }
  await openConversionLiveDialog(project.conversionJobId, project.id, record);
}

function closeConversionJobsDialog() {
  document.getElementById("conversionJobsDialog")?.close();
}

function getCurrentProjectConversionRecord() {
  const project = getCurrentProject();
  if (!project?.conversionJobId) return Promise.resolve(null);
  return getConversionJobRecord(project.conversionJobId);
}

const CONVERSION_LIVE_STEPS = [
  { key: "uploading", label: "Upload" },
  { key: "extracting", label: "Extract" },
  { key: "cover", label: "Cover" },
  { key: "normalizing", label: "Normalize" },
  { key: "structuring", label: "Structure" },
  { key: "importing", label: "Import" }
];

function getConversionLiveStepState(record, stepKey) {
  const status = String(record?.status || "").toLowerCase();
  if (status === "failed") return "error";
  const order = CONVERSION_LIVE_STEPS.map((step) => step.key);
  const activeIndex = Math.max(order.indexOf(status), order.indexOf(status.replace(/^completed.*|^imported.*$/i, "importing")));
  const stepIndex = order.indexOf(stepKey);
  if (status === "completed" || status === "completed-with-fallback" || status === "imported" || status === "imported-with-fallback") {
    return "done";
  }
  if (activeIndex > stepIndex) return "done";
  if (activeIndex === stepIndex) return "active";
  if (status === "queued" && stepKey === "uploading") return "active";
  return "idle";
}

function renderConversionStructuredPreview(container, record, emptyMessage) {
  const structuredLines = Array.isArray(record?.structuredLines) ? record.structuredLines : [];
  if (!container) return;
  container.innerHTML = structuredLines.length
    ? structuredLines.slice(0, 120).map((line) => `
      <div class="conversion-review-line">
        <span class="conversion-review-line-type">${escapeHtml(String(line?.type || "action"))}</span>
        <div class="conversion-review-line-text">${escapeHtml(String(line?.text || "")).replace(/\n/g, "<br>")}</div>
      </div>
    `).join("")
    : `<p class="conversion-live-structured-empty">${escapeHtml(emptyMessage)}</p>`;
}

function getConversionWorkspaceOverride(jobId) {
  if (!jobId) return null;
  return conversionWorkspaceOverrides.get(jobId) || null;
}

async function refreshActiveConversionLiveDialog(jobId, recordOverride = null) {
  const dialog = document.getElementById("conversionLiveDialog");
  if (!dialog || !jobId || activeConversionLiveJobId !== jobId) return;

  const baseRecord = recordOverride || await getConversionJobRecord(jobId);
  const record = {
    ...(baseRecord || {}),
    ...(getConversionWorkspaceOverride(jobId) || {})
  };
  if (!record) return;
  if (record.projectId) {
    activeConversionLiveProjectId = record.projectId;
  }

  document.getElementById("conversionLiveTitle").textContent = record.fileName ? `Watching "${record.fileName}"` : "Current Conversion Job";
  document.getElementById("conversionLiveStatus").textContent = String(record.status || "queued");
  document.getElementById("conversionLiveStage").textContent = String(record.stageLabel || "Queued");
  document.getElementById("conversionLiveFile").textContent = record.sourceFile?.name || record.fileName || "Unknown";
  document.getElementById("conversionLiveWarningsCount").textContent = String(Array.isArray(record.warnings) ? record.warnings.filter(Boolean).length : 0);
  const rawInput = document.getElementById("conversionLiveRaw");
  const normalizedInput = document.getElementById("conversionLiveNormalized");
  if (rawInput && document.activeElement !== rawInput) {
    rawInput.value = String(record.rawText || "");
  }
  if (normalizedInput && document.activeElement !== normalizedInput) {
    normalizedInput.value = String(record.normalizedText || "");
  }
  const coverPage = record.coverPageCandidate || {};
  const coverInputs = {
    title: document.getElementById("conversionLiveCoverTitle"),
    author: document.getElementById("conversionLiveCoverAuthor"),
    contact: document.getElementById("conversionLiveCoverContact"),
    company: document.getElementById("conversionLiveCoverCompany"),
    details: document.getElementById("conversionLiveCoverDetails"),
    logline: document.getElementById("conversionLiveCoverLogline")
  };
  Object.entries(coverInputs).forEach(([key, input]) => {
    if (input && document.activeElement !== input) {
      input.value = String(coverPage?.[key] || "");
    }
  });
  const guidanceInput = document.getElementById("conversionLiveGuidance");
  if (guidanceInput && document.activeElement !== guidanceInput) {
    guidanceInput.value = String(record.operatorGuidance || "");
  }
  const warningsBox = document.getElementById("conversionLiveWarnings");
  if (warningsBox) {
    const warningText = Array.isArray(record.warnings) ? record.warnings.filter(Boolean).join("\n\n") : "";
    warningsBox.hidden = !warningText;
    warningsBox.textContent = warningText;
  }
  const timeline = document.getElementById("conversionLiveTimeline");
  if (timeline) {
    timeline.innerHTML = CONVERSION_LIVE_STEPS.map((step) => `
      <div class="conversion-live-step" data-step-state="${getConversionLiveStepState(record, step.key)}">
        <span>${escapeHtml(step.key)}</span>
        <strong>${escapeHtml(step.label)}</strong>
      </div>
    `).join("");
  }
  renderConversionStructuredPreview(
    document.getElementById("conversionLiveStructured"),
    record,
    "Structured screenplay blocks will appear here as soon as the current job reaches that stage."
  );

  const openReviewBtn = document.getElementById("conversionLiveOpenReviewBtn");
  if (openReviewBtn) {
    openReviewBtn.disabled = !["failed", "completed", "completed-with-fallback", "imported", "imported-with-fallback"].includes(String(record.status || "").toLowerCase());
  }
}

async function openConversionLiveDialog(jobId, projectId = "", recordOverride = null) {
  const dialog = document.getElementById("conversionLiveDialog");
  if (!dialog || !jobId) return;
  activeConversionLiveJobId = jobId;
  activeConversionLiveProjectId = projectId || "";
  await refreshActiveConversionLiveDialog(jobId, recordOverride);
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeConversionLiveDialog() {
  activeConversionLiveJobId = "";
  activeConversionLiveProjectId = "";
  document.getElementById("conversionLiveDialog")?.close();
}

function captureActiveConversionWorkspacePatch(jobId) {
  if (!jobId || activeConversionLiveJobId !== jobId) return null;
  const rawText = String(document.getElementById("conversionLiveRaw")?.value || "");
  const normalizedText = String(document.getElementById("conversionLiveNormalized")?.value || "");
  const coverPageCandidate = {
    title: String(document.getElementById("conversionLiveCoverTitle")?.value || "").trim(),
    author: String(document.getElementById("conversionLiveCoverAuthor")?.value || "").trim(),
    contact: String(document.getElementById("conversionLiveCoverContact")?.value || "").trim(),
    company: String(document.getElementById("conversionLiveCoverCompany")?.value || "").trim(),
    details: String(document.getElementById("conversionLiveCoverDetails")?.value || "").trim(),
    logline: String(document.getElementById("conversionLiveCoverLogline")?.value || "").trim()
  };
  const previewSource = normalizedText.trim() || rawText.trim();
  const structuredLines = buildLocalStructuredPreview(previewSource);
  const patch = {
    rawText,
    normalizedText,
    structuredLines,
    structuredLineCount: structuredLines.length
  };
  if (rawText.trim()) {
    patch.rawTextEditedAt = new Date().toISOString();
  }
  if (normalizedText.trim()) {
    patch.normalizedTextEditedAt = new Date().toISOString();
  }
  if (Object.values(coverPageCandidate).some(Boolean)) {
    patch.coverPageCandidate = coverPageCandidate;
  }
  return patch;
}

function buildConversionVersionOptions(record) {
  const versions = Array.isArray(record?.versions) ? record.versions.slice() : [];
  versions.sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime());
  return [
    {
      id: "current",
      label: "Current workspace",
      data: record
    },
    ...versions.map((version, index) => {
      const stamp = version?.createdAt
        ? new Date(version.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
        : `Saved pass ${versions.length - index}`;
      const count = Number(version?.structuredLineCount || version?.structuredLines?.length || 0);
      const label = `${version?.label || `Saved pass ${versions.length - index}`} Â· ${count} lines Â· ${stamp}`;
      return {
        id: String(version?.id || `version_${index}`),
        label,
        data: {
          ...record,
          ...version,
          structuredLines: Array.isArray(version?.structuredLines) ? version.structuredLines : [],
          structuredLineCount: count
        }
      };
    })
  ];
}

function resolveSelectedConversionVersion(record, versionId) {
  const options = buildConversionVersionOptions(record);
  return options.find((entry) => entry.id === versionId) || options[0] || { id: "current", label: "Current workspace", data: record };
}

async function applyConversionRecordToProject(record, projectId = "", successMessage = "Reviewed screenplay applied to this script.") {
  const targetProject = state.projects.find((entry) => entry.id === projectId)
    || state.projects.find((entry) => entry.conversionJobId === record?.id)
    || getCurrentProject();
  const structuredLines = Array.isArray(record?.structuredLines) ? record.structuredLines : [];
  if (!targetProject) {
    await customAlert("The target script for this conversion is not available right now.", "Conversion Review");
    return false;
  }
  if (!structuredLines.length) {
    await customAlert("There is no structured screenplay preview to apply yet.", "Conversion Review");
    return false;
  }
  const nextProject = sanitizeProject({
    ...targetProject,
    lines: structuredLines,
    conversionJobId: record.id || targetProject.conversionJobId || "",
    conversionSourceFileName: record?.sourceFile?.name || record?.fileName || targetProject.conversionSourceFileName || ""
  });
  applyCoverPageCandidateToProject(nextProject, record?.coverPageCandidate || null);
  upsertProject(nextProject);
  openProject(nextProject.id, { silentLoadToast: true });
  persistProjects(true);
  showToast(successMessage, "success", { duration: 3200 });
  return true;
}

function applyCoverPageCandidateToProject(project, coverPage) {
  if (!project || !coverPage) return;
  const normalized = {
    title: String(coverPage.title || "").trim(),
    author: String(coverPage.author || "").trim(),
    contact: String(coverPage.contact || "").trim(),
    company: String(coverPage.company || "").trim(),
    details: String(coverPage.details || "").trim(),
    logline: String(coverPage.logline || "").trim()
  };
  if (normalized.title) project.title = normalized.title;
  if (normalized.author) project.author = normalized.author;
  if (normalized.contact) project.contact = normalized.contact;
  if (normalized.company) project.company = normalized.company;
  if (normalized.details) project.details = normalized.details;
  if (normalized.logline) project.logline = normalized.logline;
}

function ensureSelectionToolbar() {
  let toolbar = document.getElementById("selectionAiToolbar");
  if (toolbar) return toolbar;
  toolbar = document.createElement("div");
  toolbar.id = "selectionAiToolbar";
  toolbar.className = "selection-ai-toolbar";
  toolbar.hidden = true;
  toolbar.innerHTML = `
    <div class="selection-ai-toolbar-actions">
      ${INLINE_SELECTION_TOOLS.map((tool) => `<button class="selection-ai-toolbar-btn" type="button" data-selection-ai-action="${tool.action}" data-requires-ai="${tool.requiresAi ? "true" : "false"}" data-requires-grammar="${tool.requiresGrammar ? "true" : "false"}">${tool.label}</button>`).join("")}
    </div>
  `;
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-ai-action]");
    if (!button) return;
    hideSelectionToolbar();
    AI.triggerSelectionAction(button.dataset.selectionAiAction);
  });
  document.body.appendChild(toolbar);
  return toolbar;
}

function hideSelectionToolbar() {
  const toolbar = document.getElementById("selectionAiToolbar");
  if (!toolbar) return;
  toolbar.hidden = true;
  toolbar.classList.remove("is-visible");
}

function resetProjectCardTouchState() {
  projectCardTouchState = null;
}

function suppressProjectCardClick(projectId) {
  suppressedProjectCardClick = {
    projectId,
    until: Date.now() + PROJECT_CARD_CLICK_SUPPRESSION_MS
  };
}

function shouldIgnoreProjectCardClick(projectId) {
  if (!suppressedProjectCardClick) return false;
  if (suppressedProjectCardClick.until <= Date.now()) {
    suppressedProjectCardClick = null;
    return false;
  }
  if (suppressedProjectCardClick.projectId !== projectId) {
    return false;
  }
  suppressedProjectCardClick = null;
  return true;
}

function openWorkspaceDashboardOrNotify(workspaceId) {
  if (!workspaceId) {
    showToast("This workspace link is missing. Refresh the project list and try again.", "error", { duration: 4200 });
    return;
  }
  openWorkspaceDashboard(workspaceId);
}

function openProjectOrNotify(projectId, options = {}) {
  if (!projectId) {
    showToast("This project link is missing. Refresh the project list and try again.", "error", { duration: 4200 });
    return false;
  }
  const opened = openProject(projectId, options);
  if (!opened) {
    showToast("That project could not be found. Refresh the workspace or recover it from deleted projects.", "error", { duration: 5200 });
    return false;
  }
  return true;
}

function getLatestWorkspaceScript(workspaceId = state.currentWorkspaceId) {
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
}

function continueWorkspaceWriting() {
  const project = getLatestWorkspaceScript();
  if (project) {
    openProjectOrNotify(project.id);
    return;
  }
  createProjectInsideCurrentWorkspace();
}

function ensureExportProjectContext() {
  if (!refs.studioView?.hidden && getCurrentProject() && !getCurrentProject()?.isWorkspaceRoot) {
    return true;
  }
  const workspaceProject = getLatestWorkspaceScript(state.currentWorkspaceId)
    || state.projects.find((project) => !project.isWorkspaceRoot)
    || null;
  if (!workspaceProject) {
    showToast("Open or create a screenplay project first before exporting.", "error", { duration: 3600 });
    return false;
  }
  return openProjectOrNotify(workspaceProject.id, { silentLoadToast: true });
}

async function openWorkspaceExportFlow(prefill = { format: "pdf", exportType: "full" }) {
  if (!ensureExportProjectContext()) return false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    if (!refs.studioView?.hidden && getCurrentProject() && !getCurrentProject()?.isWorkspaceRoot) {
      openExportDialog(prefill);
      return true;
    }
  }
  showToast("The screenplay editor is still loading. Try export again in a moment.", "error", { duration: 2800 });
  return false;
}

function focusWorkspaceTaskForm() {
  const taskInput = refs.workspaceDashboard?.querySelector("[data-workspace-task-title]")
    || refs.homeWorkspaceDashboard?.querySelector("[data-workspace-task-title]");
  if (!taskInput) {
    showToast("Open a workspace first, then create a task.", "error", { duration: 3600 });
    return;
  }
  const composer = taskInput.closest(".workspace-task-composer, .workspace-home-panel");
  if (composer) {
    composer.classList.remove("is-focusing");
    void composer.offsetWidth;
    composer.classList.add("is-focusing");
    window.setTimeout(() => composer.classList.remove("is-focusing"), 1400);
  }
  taskInput.scrollIntoView({ behavior: "smooth", block: "center" });
  taskInput.focus();
  showToast("Add a task title, assign it, then track it here.", "success", { duration: 2400 });
}

function handleProjectCardGridClick(e, { allowManagement = true } = {}) {
  const workspaceTrigger = e.target.closest("[data-open-workspace-id]");
  if (workspaceTrigger) {
    openWorkspaceDashboardOrNotify(workspaceTrigger.dataset.openWorkspaceId);
    return true;
  }

  const card = e.target.closest(".project-card");
  if (!card) return false;

  const projectId = card.dataset.projectId || e.target.closest("[data-project-id]")?.dataset.projectId || "";
  if (shouldIgnoreProjectCardClick(projectId)) return true;

  if (allowManagement && e.target.closest(".project-delete")) {
    removeProject(projectId);
    return true;
  }
  if (allowManagement && e.target.closest('[data-project-action="rename"]')) {
    renameProjectById(projectId);
    return true;
  }
  if (allowManagement && e.target.closest('[data-project-action="duplicate"]')) {
    duplicateProjectById(projectId);
    return true;
  }

  openProjectOrNotify(projectId);
  return true;
}

function updateSelectionToolbar() {
  const toolbar = ensureSelectionToolbar();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideSelectionToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const block = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement?.closest(".script-block")
    : range.commonAncestorContainer?.closest?.(".script-block");
  if (!block || !refs.screenplayEditor?.contains(block)) {
    hideSelectionToolbar();
    return;
  }

  const buttons = [...toolbar.querySelectorAll("[data-selection-ai-action]")];
  let visibleCount = 0;
  buttons.forEach((button) => {
    const needsAi = button.dataset.requiresAi === "true";
    const needsGrammar = button.dataset.requiresGrammar === "true";
    const shouldShow = (!needsAi || state.aiAssist) && (!needsGrammar || state.grammarCheck);
    button.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });
  if (!visibleCount) {
    hideSelectionToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    hideSelectionToolbar();
    return;
  }

  toolbar.style.top = `${Math.max(window.scrollY + 12, window.scrollY + rect.top - 52)}px`;
  toolbar.style.left = `${window.scrollX + rect.left + (rect.width / 2)}px`;
  toolbar.hidden = false;
  toolbar.classList.add("is-visible");
}

function setTypingFocusModeActive() {
  if (!state.viewOptions.focusMode) return;
  document.body.classList.add("focus-mode-active");
  clearTimeout(focusModeTimer);
  focusModeTimer = window.setTimeout(() => {
    document.body.classList.remove("focus-mode-active");
  }, 1500);
}

function schedulePreviewRefresh({ includeCover = false } = {}) {
  clearTimeout(previewRefreshTimer);
  previewRefreshTimer = window.setTimeout(() => {
    if (includeCover) {
      renderCoverPreview();
    }
    renderPreview();
  }, 90);
}

function getWorkspaceTaskTemplate(templateKey) {
  return WORKSPACE_TASK_TEMPLATES.find((template) => template.key === templateKey) || WORKSPACE_TASK_TEMPLATES[0];
}

function updateWorkspaceTaskTypeFields(container, templateKey) {
  if (!container) return;
  const sceneLabel = container.querySelector("[data-workspace-task-scene-label]");
  const sceneSelect = container.querySelector("[data-workspace-task-scene]");
  const lineField = container.querySelector("[data-workspace-task-line-field]");
  const lineSelect = container.querySelector("[data-workspace-task-line]");
  if (!sceneSelect) return;
  if (!sceneSelect.dataset.defaultOptions) {
    sceneSelect.dataset.defaultOptions = sceneSelect.innerHTML;
  }
  if (templateKey === "story-memory") {
    const memoryChoices = getWorkspaceStoryMemoryChoices();
    if (sceneLabel) sceneLabel.textContent = "Story memory";
    sceneSelect.innerHTML = `
      <option value="">Choose story memory</option>
      ${memoryChoices.map((item) => `<option value="${escapeHtml(item.id)}" data-memory-project-id="${escapeHtml(item.projectId)}" data-memory-type="${escapeHtml(item.type)}" data-memory-name="${escapeHtml(item.name)}">${escapeHtml(item.label)}</option>`).join("")}
    `;
    if (lineField) lineField.hidden = true;
    if (lineSelect) lineSelect.value = "";
    return;
  }
  if (sceneLabel) sceneLabel.textContent = "Scene";
  sceneSelect.innerHTML = sceneSelect.dataset.defaultOptions;
  if (lineField) lineField.hidden = false;
}

function applyWorkspaceTaskTemplateToForm(container, templateKey, { force = false } = {}) {
  if (!container) return;
  const template = getWorkspaceTaskTemplate(templateKey);
  const titleInput = container.querySelector('[data-workspace-task-title], #taskEditTitle');
  const descriptionInput = container.querySelector('[data-workspace-task-description], #taskEditDescription');
  const templateInput = container.querySelector('[data-workspace-task-template], #taskEditTemplate');
  const hint = container.querySelector('[data-workspace-task-template-hint], #taskEditTemplateHint');
  const previousKey = container.dataset.workspaceTemplateApplied || "custom";
  const previousTemplate = getWorkspaceTaskTemplate(previousKey);

  if (templateInput) {
    templateInput.value = template.key;
  }
  if (titleInput) {
    const currentTitle = titleInput.value.trim();
    if (force || !currentTitle || currentTitle === previousTemplate.title) {
      titleInput.value = template.title;
    }
  }
  if (descriptionInput) {
    const currentDescription = descriptionInput.value.trim();
    if (force || !currentDescription || currentDescription === previousTemplate.description) {
      descriptionInput.value = template.description;
    }
  }
  if (hint) {
    hint.textContent = template.aiInstruction;
  }
  updateWorkspaceTaskTypeFields(container, template.key);
  container.dataset.workspaceTemplateApplied = template.key;
  syncWorkspaceTaskDraftFromContainer(container);
}

function ensureDefaultWorkspaceRoot() {
  const currentWorkspaceRoot = state.currentWorkspaceId
    ? getWorkspaceRootProject(state.currentWorkspaceId)
    : null;
  if (currentWorkspaceRoot) return currentWorkspaceRoot;

  const existingWorkspaceRoot = state.projects.find((project) => project.isWorkspaceRoot);
  if (existingWorkspaceRoot) return existingWorkspaceRoot;

  return createProjectWithOptions({
    creationKind: "workspace",
    workType: "film-script",
    isWorkspaceRoot: true,
    title: "My Workspace",
    workspaceName: "My Workspace"
  });
}

async function launchNewCreationFlow() {
  const selection = await showNewCreationFlow();
  if (!selection || selection.workType !== "film-script") {
    return;
  }

  const setup = await showFilmProjectSetupFlow();
  if (!setup?.projectName || !setup.action) {
    return;
  }
  const workspaceRoot = ensureDefaultWorkspaceRoot();
  let project;
  try {
    project = createProjectWithOptions({
      creationKind: "project",
      workType: selection.workType,
      title: setup.projectName.trim(),
      workspace: {
        id: workspaceRoot.workspace?.id || workspaceRoot.id,
        name: workspaceRoot.workspace?.name || workspaceRoot.title,
        inviteCode: workspaceRoot.workspace?.inviteCode,
        reminders: workspaceRoot.workspace?.reminders || [],
        targets: workspaceRoot.workspace?.targets || {},
        tasks: workspaceRoot.workspace?.tasks || []
      }
    });
  } catch (error) {
    await customAlert(error?.message || "This project name is already in use in your account.", "Project Not Created");
    return;
  }

  if (setup.action === "convert-import") {
    pendingConvertImportProjectId = project.id;
    persistProjects(true, { syncInputs: false });
    showToast("Choose a screenplay file to convert into this project.", "success");
    refs.convertImportInput?.click();
    return;
  }

  openProject(project.id, { silentLoadToast: true });

  if (setup.action === "import") {
    showToast("Choose a file to import into this script.", "success");
    refs.fileInput?.click();
    return;
  }

  showToast("Project created.", "success");
}

function syncWorkspaceHeaderActions() {
  const refreshBtn = document.getElementById("workspaceRefreshBtn");
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId)
    || state.projects.find((project) => project.workspace?.id === state.currentWorkspaceId)
    || null;

  if (refreshBtn) {
    refreshBtn.hidden = !workspaceProject;
  }
}

function updateWorkspaceClock() {
  const clock = document.getElementById("workspaceViewClock");
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function ensureWorkspaceClock() {
  updateWorkspaceClock();
  if (workspaceClockTimer) return;
  workspaceClockTimer = window.setInterval(updateWorkspaceClock, 1000);
}

async function openWorkspaceDashboard(workspaceId) {
  if (!workspaceId) return false;
  const loadToast = showToast("Refreshing workspace...", "loading", { duration: 0 });
  state.activeBlockId = null;
  state.activeType = "action";
  const workspaceRoot = getWorkspaceRootProject(workspaceId) || getWorkspaceProjects(workspaceId)[0] || null;
  if (!workspaceRoot) {
    updateToast(loadToast, "Workspace could not be found. Refresh the project list and try again.", "error", { duration: 5200 });
    return false;
  }
  state.currentWorkspaceId = workspaceId;
  state.currentProjectId = workspaceRoot.id;
  await syncWorkspaceState(workspaceId).catch(() => {});
  persistProjects(false, { syncInputs: false });
  showWorkspaceView();
  renderWorkspaceView();
  ensureWorkspaceClock();
  syncWorkspaceHeaderActions();
  updateToast(loadToast, "Workspace ready.", "success", { duration: 1200 });
  return true;
}

async function createProjectInsideCurrentWorkspace() {
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId) || state.projects.find((project) => project.workspace?.id === state.currentWorkspaceId);
  if (!workspaceProject) {
    launchNewCreationFlow();
    return;
  }
  if (!canManageWorkspaceProjects(workspaceProject)) {
    await customAlert("Only workspace owners and admins can create new projects in this workspace.", "Workspace Access");
    return;
  }
  const projectName = await customPrompt("Name this project before creating it.", "", "New Project");
  if (!projectName || !projectName.trim()) {
    await customAlert("A project name is required before creation.", "Project Not Created");
    return;
  }
  let project;
  try {
    project = createProjectWithOptions({
      creationKind: "project",
      workType: "film-script",
      title: projectName.trim(),
      isShared: workspaceProject.isShared,
      ownerId: workspaceProject.ownerId,
      ownerName: workspaceProject.ownerName,
      ownerEmail: workspaceProject.ownerEmail,
      ownerPhotoURL: workspaceProject.ownerPhotoURL,
      collaborators: workspaceProject.collaborators,
      activityLog: workspaceProject.activityLog,
      lastEditorName: workspaceProject.lastEditorName,
      lastActivityAt: workspaceProject.lastActivityAt,
      workspace: {
        id: workspaceProject.workspace?.id,
        name: workspaceProject.workspace?.name || workspaceProject.title,
        inviteCode: workspaceProject.workspace?.inviteCode,
        reminders: workspaceProject.workspace?.reminders || [],
        commentingEnabled: Boolean(workspaceProject.workspace?.commentingEnabled),
        targets: workspaceProject.workspace?.targets || {},
        tasks: workspaceProject.workspace?.tasks || []
      }
    });
  } catch (error) {
    await customAlert(error?.message || "This project name is already in use in your account.", "Project Not Created");
    return;
  }
  openProject(project.id, { silentLoadToast: true });
  showToast("Project created.", "success");
}

function isDisposableUntitledDraft(project = getCurrentProject()) {
  if (!project || project.isWorkspaceRoot) return false;
  const defaultLikeTitle = /^(Untitled Script|Film Script \d+)$/i.test(String(project.title || "").trim());
  const hasMeta = [project.author, project.contact, project.company, project.details, project.logline].some((value) => String(value || "").trim());
  const hasContent = (project.lines || []).some((line) => String(line?.text || "").trim() || String(line?.secondary || "").trim());
  return defaultLikeTitle && !hasMeta && !hasContent;
}

async function discardUntitledDraftIfNeeded() {
  if (refs.studioView?.hidden) return false;
  const project = getCurrentProject();
  if (!isDisposableUntitledDraft(project)) return false;
  const workspaceId = project.workspace?.id || project.id;
  state.projects = state.projects.filter((item) => item.id !== project.id);
  if (!state.projects.length) {
    const fallback = createProjectWithOptions();
    state.projects = [fallback];
  }
  if (state.currentWorkspaceId === workspaceId && project.workspace?.id !== project.id) {
    state.currentWorkspaceId = workspaceId;
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true, { syncInputs: false });
  await customAlert("This project was not created because no project name or content was added.", "Project Not Created");
  return true;
}

function getWorkspaceTaskAssignees(workspaceProject) {
  const ownerUid = workspaceProject.ownerId || "workspace_owner";
  const currentName = String(auth.currentUser?.displayName || "").trim();
  const currentEmail = String(auth.currentUser?.email || "").trim();
  const ownerLabel = workspaceProject.ownerName
    || workspaceProject.ownerEmail
    || ((auth.currentUser && (!workspaceProject.ownerId || workspaceProject.ownerId === auth.currentUser.uid))
      ? (currentName || currentEmail || workspaceProject.author || "Workspace Owner")
      : (workspaceProject.author || "Workspace Owner"));
  const collaboratorEntries = Object.entries(workspaceProject.collaborators || {}).map(([uid, person]) => ({
    id: uid,
    label: person.name || person.email || "Collaborator",
    assigneeType: "human"
  }));
  return [
    { id: ownerUid, label: ownerLabel, assigneeType: "human" },
    ...collaboratorEntries,
    { id: "ai_assist", label: "@AIassist", assigneeType: "system" }
  ];
}

function getWorkspaceTaskSceneChoices(workspaceId = state.currentWorkspaceId) {
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => (project.lines || [])
      .filter((line) => line.type === "scene" && line.text.trim())
      .map((line) => ({
        projectId: project.id,
        sceneId: line.id,
        lineId: line.id,
        label: `${project.title} - ${line.text.trim()}`
      })));
}

function getWorkspaceTaskLineChoices(workspaceId = state.currentWorkspaceId) {
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => (project.lines || [])
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.type !== "scene" && line.text.trim())
      .map(({ line, index }) => {
        const sceneId = getSceneIdForIndex(index, project);
        const sceneLine = sceneId ? project.lines.find((entry) => entry.id === sceneId) : null;
        return {
          projectId: project.id,
          lineId: line.id,
          sceneId: sceneId || "",
          sceneLabel: sceneLine?.text?.trim() || "",
          lineLabel: formatLineText(line.text, line.type).slice(0, 80),
          label: `${project.title} - ${(sceneLine?.text?.trim() || "General")} - ${formatLineText(line.text, line.type).slice(0, 56)}`
        };
      }));
}

function getWorkspaceStoryMemoryChoices(workspaceId = state.currentWorkspaceId) {
  const bucketLabels = {
    characters: "Character",
    locations: "Location",
    scenes: "Scene",
    themes: "Theme"
  };
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => Object.entries(project.storyMemory || {})
      .filter(([bucket]) => bucketLabels[bucket])
      .flatMap(([bucket, items]) => (Array.isArray(items) ? items : []).map((item) => ({
        projectId: project.id,
        type: bucket,
        id: item.id,
        name: item.name || bucketLabels[bucket],
        label: `${project.title} Â· ${bucketLabels[bucket]} Â· ${item.name || "Untitled"}`
      }))));
}

function getWorkspaceLeadProject(workspaceId = state.currentWorkspaceId) {
  if (!workspaceId) return null;
  return getWorkspaceRootProject(workspaceId)
    || getWorkspaceProjects(workspaceId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]
    || null;
}

function getWorkspaceTaskDraft(workspaceId = state.currentWorkspaceId) {
  if (!workspaceId) return null;
  const draft = state.workspaceTaskDraft;
  if (!draft || draft.workspaceId !== workspaceId) return null;
  return draft;
}

function syncWorkspaceTaskDraftFromContainer(container, workspaceId = state.currentWorkspaceId) {
  if (!container || !workspaceId) return;
  const titleInput = container.querySelector('[data-workspace-task-title]');
  const descriptionInput = container.querySelector('[data-workspace-task-description]');
  const projectSelect = container.querySelector('[data-workspace-task-project]');
  const sceneSelect = container.querySelector('[data-workspace-task-scene]');
  const lineSelect = container.querySelector('[data-workspace-task-line]');
  const assigneeSelect = container.querySelector('[data-workspace-task-assignee]');
  const templateSelect = container.querySelector('[data-workspace-task-template]');
  const aiStartSelect = container.querySelector('[data-workspace-task-ai-start]');
  state.workspaceTaskDraft = {
    workspaceId,
    title: titleInput?.value || "",
    description: descriptionInput?.value || "",
    projectId: projectSelect?.value || "",
    sceneId: sceneSelect?.value || "",
    lineId: lineSelect?.value || "",
    assignedTo: assigneeSelect?.value || "",
    templateKey: templateSelect?.value || "custom",
    aiStart: aiStartSelect?.value || "now"
  };
}

function clearWorkspaceTaskDraft(workspaceId = state.currentWorkspaceId) {
  if (!workspaceId) {
    state.workspaceTaskDraft = null;
    return;
  }
  if (state.workspaceTaskDraft?.workspaceId === workspaceId) {
    state.workspaceTaskDraft = null;
  }
}

function flushPendingWorkspaceRefresh() {
  if (!state.workspaceRefreshPending || !state.currentWorkspaceId) return;
  const activeElement = document.activeElement;
  const activeForm = activeElement?.closest?.(".workspace-task-form");
  if (activeForm && refs.workspaceDashboard?.contains(activeForm)) return;
  state.workspaceRefreshPending = false;
  renderWorkspaceView();
}

function getWorkspaceTaskById(taskId) {
  return getWorkspaceLeadProject()?.workspace?.tasks?.find((task) => task.id === taskId) || null;
}

function showWorkspaceReviewCenter() {
  const workspaceProject = getWorkspaceLeadProject();
  if (!workspaceProject) {
    customAlert("Open a workspace first to generate reports.", "Review Center");
    return;
  }
  const workspaceId = state.currentWorkspaceId || workspaceProject.workspace?.id || "";
  const projects = getWorkspaceProjects(workspaceId).filter((project) => !project.isWorkspaceRoot);
  const tasks = workspaceProject.workspace?.tasks || [];
  const notifications = workspaceProject.workspace?.notifications || [];
  const storyMemoryItems = getWorkspaceStoryMemoryChoices(workspaceId);
  const comments = projects.flatMap((project) => project.comments || []);
  const unresolvedComments = comments.filter((comment) => !comment.resolved);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const completedTasks = tasks.filter((task) => task.status === "done");
  const aiTasks = tasks.filter((task) => task.assigneeType === "system");
  const aiReviewTasks = aiTasks.filter((task) => task.aiState === "review");
  const aiFailedTasks = aiTasks.filter((task) => task.aiState === "failed");
  const lines = projects.flatMap((project) => project.lines || []);
  const sceneCount = lines.filter((line) => line.type === "scene" && line.text?.trim()).length;
  const characterCount = new Set(lines.filter((line) => line.type === "character" && line.text?.trim()).map((line) => normalizeLineText(line.text, line.type))).size;
  const wordCount = lines.reduce((count, line) => count + String(line.text || "").trim().split(/\s+/).filter(Boolean).length, 0);
  const readinessChecks = [
    { label: "Workspace has a script", done: projects.length > 0 },
    { label: "Tasks are being tracked", done: tasks.length > 0 },
    { label: "No failed AI tasks", done: aiFailedTasks.length === 0 },
    { label: "Comments are resolved", done: unresolvedComments.length === 0 },
    { label: "Story memory is started", done: storyMemoryItems.length > 0 }
  ];
  const readinessScore = Math.round((readinessChecks.filter((item) => item.done).length / readinessChecks.length) * 100);
  const readinessTone = readinessScore >= 80 ? "strong" : readinessScore >= 55 ? "steady" : "warning";
  const readinessLabel = readinessScore >= 80 ? "Strong" : readinessScore >= 55 ? "Steady" : "Needs attention";
  const nextFocus = aiFailedTasks.length
    ? "Resolve failed AI tasks first so the workspace can trust its delegated work."
    : unresolvedComments.length
      ? "Resolve the outstanding comments so collaborators have a cleaner review trail."
      : !tasks.length
        ? "Start assigning tasks so the workspace becomes trackable, not just writable."
        : !storyMemoryItems.length
          ? "Add story memory links to strengthen continuity and team context."
          : "The workspace is in a healthy place. Focus on moving the next open task forward.";
  const readinessMarkup = readinessChecks.map((item) => `
    <div class="workspace-review-check" data-check-state="${item.done ? "done" : "todo"}">
      <span class="workspace-review-check-dot" aria-hidden="true"></span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${item.done ? "Ready" : "Pending"}</small>
    </div>
  `).join("");
  const sceneHeadings = lines
    .filter((line) => line.type === "scene" && line.text?.trim())
    .map((line) => line.text.trim());
  const dialogueLines = lines.filter((line) => line.type === "dialogue" && line.text?.trim());
  const actionLines = lines.filter((line) => line.type === "action" && line.text?.trim());
  const dialogueWordCount = dialogueLines.reduce((count, line) => count + String(line.text || "").trim().split(/\s+/).filter(Boolean).length, 0);
  const actionWordCount = actionLines.reduce((count, line) => count + String(line.text || "").trim().split(/\s+/).filter(Boolean).length, 0);
  const averageDialogueLength = dialogueLines.length ? Math.round(dialogueWordCount / dialogueLines.length) : 0;
  const averageActionLength = actionLines.length ? Math.round(actionWordCount / actionLines.length) : 0;
  const characterFrequency = Array.from(
    lines
      .filter((line) => line.type === "character" && line.text?.trim())
      .reduce((map, line) => {
        const key = normalizeLineText(line.text, line.type);
        map.set(key, (map.get(key) || 0) + 1);
        return map;
      }, new Map())
      .entries()
  )
    .sort((a, b) => b[1] - a[1]);
  const characterSet = new Set(characterFrequency.map(([name]) => name.toLowerCase()));
  const stopWords = new Set(["the", "and", "with", "from", "into", "that", "this", "there", "their", "about", "after", "before", "while", "where", "when", "have", "has", "were", "been", "will", "would", "could", "should", "then", "them", "they", "your", "ours", "through", "across", "scene", "interior", "exterior"]);
  const recurringTerms = Array.from(
    lines
      .filter((line) => ["action", "dialogue", "note", "text"].includes(line.type) && line.text?.trim())
      .flatMap((line) => String(line.text || "").match(/[A-Za-z][A-Za-z'-]{3,}/g) || [])
      .reduce((map, word) => {
        const normalized = word.toLowerCase();
        if (stopWords.has(normalized) || characterSet.has(normalized)) return map;
        map.set(normalized, (map.get(normalized) || 0) + 1);
        return map;
      }, new Map())
      .entries()
  )
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term.replace(/^./, (value) => value.toUpperCase()));
  const reviewInsightOptions = [
    {
      key: "scripts",
      label: "Scripts",
      value: String(projects.length),
      meta: `${sceneCount} scenes Â· ${characterCount} characters`,
      note: "How much writing structure is already active inside this workspace."
    },
    {
      key: "tasks",
      label: "Task load",
      value: String(openTasks.length),
      meta: `${completedTasks.length} completed Â· ${aiTasks.length} AI tasks`,
      note: "The active load the team is carrying right now."
    },
    {
      key: "queue",
      label: "Review queue",
      value: String(unresolvedComments.length + aiReviewTasks.length),
      meta: `${unresolvedComments.length} comments Â· ${aiReviewTasks.length} AI reviews`,
      note: "What still needs review before the workspace feels clear."
    },
    {
      key: "checks",
      label: "Readiness checks",
      value: `${readinessChecks.filter((item) => item.done).length}/${readinessChecks.length}`,
      meta: `${readinessLabel} at ${readinessScore}%`,
      note: "A condensed view of the workspace trust checks.",
      body: `<div class="workspace-review-check-list">${readinessMarkup}</div>`
    }
  ];
  const reviewInsightDefault = reviewInsightOptions[0];
  const reportOptions = [
    { key: "", label: "Choose one" },
    { key: "storyline-theme", label: "Storyline & Theme" },
    { key: "writing-style", label: "Writing Style" },
    { key: "scenery-development", label: "Scenery Development" },
    { key: "character-list", label: "Character List" },
    { key: "props-details", label: "Props & Details" },
    { key: "continuity-focus", label: "Continuity Focus" }
  ];
  const reportDefault = reportOptions[0];
  function buildReport(type, customPrompt = "") {
    const leadCharacters = characterFrequency.slice(0, 5);
    const firstScene = sceneHeadings[0] || "No opening scene detected yet.";
    const middleScene = sceneHeadings[Math.floor(sceneHeadings.length / 2)] || firstScene;
    const lastScene = sceneHeadings[sceneHeadings.length - 1] || middleScene;
    const motifCopy = recurringTerms.length ? recurringTerms.join(", ") : "No strong recurring motifs detected yet";
    const continuityWarnings = [
      !sceneHeadings.length ? "Add scene headings so place and time are easier to track." : "",
      !characterFrequency.length ? "Character cues are still too light to build a cast report." : "",
      !storyMemoryItems.length ? "Story memory has not been built yet, so continuity support is still shallow." : "",
      aiFailedTasks.length ? `${aiFailedTasks.length} failed AI task${aiFailedTasks.length === 1 ? "" : "s"} could leave review gaps.` : ""
    ].filter(Boolean);
    const reportMap = {
      "storyline-theme": {
        eyebrow: "AI report",
        title: "Storyline & Theme Report",
        description: "A script-led reading of the story path, key motifs, and the emotional direction that is showing up on the page.",
        body: `
          <div class="workspace-review-report-stack">
            <p>The script currently opens in <strong>${escapeHtml(firstScene)}</strong>, moves through <strong>${escapeHtml(middleScene)}</strong>, and most recently lands on <strong>${escapeHtml(lastScene)}</strong>.</p>
            <p>The recurring thematic signals showing up most often are <strong>${escapeHtml(motifCopy)}</strong>. This suggests the draft is leaning on those images, ideas, or objects to hold the story together.</p>
            <ul class="workspace-review-bullet-list">
              <li>${sceneCount ? `${sceneCount} scene${sceneCount === 1 ? "" : "s"} already give the story a visible progression path.` : "Scene structure is still too light to read a full storyline arc."}</li>
              <li>${dialogueLines.length ? `Dialogue is present in ${dialogueLines.length} line${dialogueLines.length === 1 ? "" : "s"}, which means voice is already carrying part of the theme.` : "Dialogue is still sparse, so the thematic voice is mainly coming from description."}</li>
              <li>${nextFocus}</li>
            </ul>
          </div>
        `
      },
      "writing-style": {
        eyebrow: "AI report",
        title: "Writing Style Report",
        description: "A style reading based on how the draft balances action, dialogue, pace, and visual density.",
        body: `
          <div class="workspace-review-report-stack">
            <p>The script currently carries <strong>${dialogueLines.length}</strong> dialogue line${dialogueLines.length === 1 ? "" : "s"} and <strong>${actionLines.length}</strong> action line${actionLines.length === 1 ? "" : "s"}, which points to a ${dialogueLines.length > actionLines.length ? "voice-forward" : "visually-forward"} writing style.</p>
            <p>Average dialogue length is about <strong>${averageDialogueLength || 0}</strong> words per line, while action averages around <strong>${averageActionLength || 0}</strong> words. That gives a sense of whether scenes feel clipped, spacious, or dense.</p>
            <ul class="workspace-review-bullet-list">
              <li>${averageDialogueLength > 18 ? "Dialogue reads relatively full, which may give the script a more literary or conversational rhythm." : "Dialogue reads relatively lean, which helps the script move quickly."}</li>
              <li>${averageActionLength > 22 ? "Action paragraphs are carrying a lot of image detail right now." : "Action writing is staying fairly tight and screen-oriented."}</li>
              <li>${recurringTerms.length ? `Repeated language like ${escapeHtml(recurringTerms.slice(0, 4).join(", "))} is shaping the page voice.` : "The draft does not yet show many repeated stylistic anchors."}</li>
            </ul>
          </div>
        `
      },
      "scenery-development": {
        eyebrow: "AI report",
        title: "Scenery Development Report",
        description: "A look at how place, setting, and visual geography are being built across the draft.",
        body: `
          <div class="workspace-review-report-stack">
            <p>The draft currently has <strong>${sceneCount}</strong> scene heading${sceneCount === 1 ? "" : "s"} anchoring place and time. The first visible location is <strong>${escapeHtml(firstScene)}</strong>.</p>
            <p>${sceneHeadings.length > 2 ? `The scenery appears to move from ${escapeHtml(firstScene)} through ${escapeHtml(middleScene)} and toward ${escapeHtml(lastScene)}.` : "There are still too few scene anchors to judge how the world expands over time."}</p>
            <ul class="workspace-review-bullet-list">
              <li>${actionLines.length ? "Action lines are present, so the script already has visual material to deepen place and atmosphere." : "Action description is still too light to build a strong scenic read."}</li>
              <li>${sceneHeadings.filter((heading) => /^EXT\./i.test(heading)).length ? `${sceneHeadings.filter((heading) => /^EXT\./i.test(heading)).length} exterior scene${sceneHeadings.filter((heading) => /^EXT\./i.test(heading)).length === 1 ? "" : "s"} help open the world visually.` : "Most current scenes appear to stay indoors or without explicit exterior anchors."}</li>
              <li>${recurringTerms.length ? `Repeated details such as ${escapeHtml(recurringTerms.slice(0, 3).join(", "))} may be helping location identity.` : "Location-specific detail is still light, so scenery identity may need more concrete objects or textures."}</li>
            </ul>
          </div>
        `
      },
      "character-list": {
        eyebrow: "AI report",
        title: "Character List Report",
        description: "A cast-focused read showing who is most active on the page and how strongly they are surfacing.",
        body: `
          <div class="workspace-review-report-stack">
            <p>The script currently exposes <strong>${characterCount}</strong> character${characterCount === 1 ? "" : "s"} through character cues.</p>
            ${leadCharacters.length ? `
              <div class="workspace-review-stat-grid">
                ${leadCharacters.map(([name, count]) => `<div><span>${escapeHtml(name)}</span><strong>${count}</strong></div>`).join("")}
              </div>
            ` : `<p>No strong cast list can be built yet because the draft has not surfaced clear character cues.</p>`}
            <ul class="workspace-review-bullet-list">
              <li>${leadCharacters[0] ? `${escapeHtml(leadCharacters[0][0])} is currently the strongest visible presence on the page.` : "No clear lead character presence is visible yet."}</li>
              <li>${leadCharacters.length > 3 ? "The script already has a multi-character footprint, which helps team reviews think about role balance." : "The current cast footprint is still small, so role expansion may still be ahead."}</li>
              <li>${dialogueLines.length ? "Dialogue is available to help judge who owns the emotional space of scenes." : "Without dialogue, character identity is still being carried mostly by description."}</li>
            </ul>
          </div>
        `
      },
      "props-details": {
        eyebrow: "AI report",
        title: "Props & Details Report",
        description: "A heuristic pass over the draft to surface recurring objects, details, and practical story anchors.",
        body: `
          <div class="workspace-review-report-stack">
            <p>${recurringTerms.length ? `The draft is currently repeating details such as <strong>${escapeHtml(recurringTerms.join(", "))}</strong>. These may be props, motifs, or repeated environmental anchors.` : "The draft does not yet surface enough repeated concrete terms to build a strong prop report."}</p>
            <p>${actionLines.length ? "Most of the prop and detail signal is coming from action writing, where physical world-building tends to appear first." : "Because action writing is light, the script is not yet surfacing many physical anchors."}</p>
            <ul class="workspace-review-bullet-list">
              <li>${recurringTerms.length ? "These repeated terms are the best candidates for deliberate prop tracking or continuity checks." : "Try strengthening physical details in action lines if prop tracking matters for this draft."}</li>
              <li>${storyMemoryItems.length ? "Story memory is available, so important props can be linked back into continuity once chosen." : "Story memory is not active yet, so recurring props are not being formally tracked."}</li>
            </ul>
          </div>
        `
      },
      "continuity-focus": {
        eyebrow: "AI report",
        title: "Continuity Focus Report",
        description: "A trust-oriented pass over the draft, aimed at what could break continuity or make collaboration harder.",
        body: `
          <div class="workspace-review-report-stack">
            <p>The workspace is sitting at <strong>${readinessScore}%</strong> readiness, with the next focus being: <strong>${escapeHtml(nextFocus)}</strong></p>
            <ul class="workspace-review-bullet-list">
              ${continuityWarnings.length ? continuityWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") : "<li>No major continuity warnings are visible in the current draft structure.</li>"}
            </ul>
            <p>${unresolvedComments.length ? `${unresolvedComments.length} unresolved comment${unresolvedComments.length === 1 ? "" : "s"} may still be carrying decisions that are not yet reflected in the script.` : "Comment decisions look clear right now."}</p>
          </div>
        `
      }
    };
    const promptLower = customPrompt.trim().toLowerCase();
    const keywordMatches = [
      ["theme", "storyline-theme"],
      ["story", "storyline-theme"],
      ["style", "writing-style"],
      ["voice", "writing-style"],
      ["scene", "scenery-development"],
      ["scenery", "scenery-development"],
      ["setting", "scenery-development"],
      ["character", "character-list"],
      ["cast", "character-list"],
      ["prop", "props-details"],
      ["detail", "props-details"],
      ["continuity", "continuity-focus"]
    ];
    const matchedKey = keywordMatches.find(([keyword]) => promptLower.includes(keyword))?.[1];
    if (customPrompt.trim() && !type && matchedKey && reportMap[matchedKey]) {
      const matched = reportMap[matchedKey];
      return {
        ...matched,
        eyebrow: "Custom report",
        description: `Prompt: ${customPrompt.trim()}`
      };
    }
    if (customPrompt.trim() && !type) {
      return {
        eyebrow: "Custom report",
        title: "Prompt-guided Report",
        description: `Prompt: ${customPrompt.trim()}`,
        body: `
          <div class="workspace-review-report-stack">
            <p>This report is grounded in the current script content: <strong>${wordCount.toLocaleString()}</strong> words, <strong>${sceneCount}</strong> scene${sceneCount === 1 ? "" : "s"}, and <strong>${characterCount}</strong> detected character${characterCount === 1 ? "" : "s"}.</p>
            <p>The strongest currently visible anchors are <strong>${escapeHtml(motifCopy)}</strong>, with the draft opening in <strong>${escapeHtml(firstScene)}</strong> and currently leading toward <strong>${escapeHtml(lastScene)}</strong>.</p>
            <ul class="workspace-review-bullet-list">
              <li>${nextFocus}</li>
              <li>${dialogueLines.length ? `Dialogue-heavy material is available for a deeper prompt follow-up.` : "Dialogue signal is still light, so interpretation will lean more on description and structure."}</li>
              <li>${storyMemoryItems.length ? "Story memory exists and can support a more focused continuity or theme pass." : "Story memory is not yet populated, so deeper relationship tracking is still limited."}</li>
            </ul>
          </div>
        `
      };
    }
    if (!type) {
      return {
        eyebrow: "Report guide",
        title: "Choose a report or write a prompt",
        description: "Pick a report type, write your own prompt, or combine both to shape the report from the current script.",
        body: `
          <div class="workspace-review-report-stack">
            <p>This report center reads the writer's current draft, including scenes, dialogue, characters, and recurring details already on the page.</p>
            <ul class="workspace-review-bullet-list">
              <li>Choose a report type for a guided reading.</li>
              <li>Leave the selector on <strong>Choose one</strong> if you want the prompt alone to drive the report.</li>
              <li>Add a custom prompt after selecting a report type if you want a more specific angle on that report.</li>
            </ul>
          </div>
        `
      };
    }
    const selected = reportMap[type] || reportMap["storyline-theme"];
    if (customPrompt.trim()) {
      return {
        ...selected,
        description: `${selected.description} Focus prompt: ${customPrompt.trim()}`
      };
    }
    return selected;
  }
  const container = document.createElement("div");
  container.className = "workspace-review-center";
  container.innerHTML = `
    <div class="workspace-review-center-head">
      <div class="workspace-review-center-head-copy">
        <strong>${escapeHtml(workspaceProject.workspace?.name || workspaceProject.title || "Workspace")}</strong>
        <span>Review the health of the workspace, see what is blocked, and keep the team pointed at the next useful move.</span>
      </div>
      <div class="workspace-review-center-head-actions">
      </div>
    </div>
    <section class="workspace-review-overview">
      <div class="workspace-review-hero" data-review-tone="${readinessTone}">
        <span class="workspace-review-hero-label">Readiness</span>
        <strong>${readinessScore}%</strong>
        <p>${readinessLabel} workspace momentum across scripts, tasks, and collaboration checks.</p>
      </div>
      <section class="workspace-review-insight-panel">
        <div class="workspace-review-insight-head">
          <span>Workspace insight</span>
          <select class="comment-filter-select workspace-review-insight-select" data-review-insight-select aria-label="Choose workspace insight">
            ${reviewInsightOptions.map((item) => `<option value="${escapeHtml(item.key)}"${item.key === reviewInsightDefault.key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </div>
        <article class="workspace-review-insight-display" data-review-insight-display>
          <span>${escapeHtml(reviewInsightDefault.label)}</span>
          <strong>${escapeHtml(reviewInsightDefault.value)}</strong>
          <small>${escapeHtml(reviewInsightDefault.meta)}</small>
          <p>${escapeHtml(reviewInsightDefault.note)}</p>
        </article>
      </section>
    </section>
    <section class="workspace-review-report-builder">
      <div class="workspace-review-report-controls">
        <label class="workspace-review-report-control">
          <span>Report type</span>
          <select class="comment-filter-select workspace-review-report-select" data-review-report-select aria-label="Choose report type">
            ${reportOptions.map((item) => `<option value="${escapeHtml(item.key)}"${item.key === reportDefault.key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="workspace-review-report-prompt">
          <span>Custom report prompt</span>
          <textarea class="collab-textarea workspace-review-report-prompt-input" data-review-report-prompt placeholder="Optional: ask for a more specific angle, like emotional arc, scenery clarity, or dialogue sharpness."></textarea>
        </label>
        <button class="primary-button btn-sm workspace-review-run-report" type="button" data-review-run-report>Report</button>
      </div>
      <p>Reports are built from what the writer has already written in the current script, not from generic templates.</p>
    </section>
    <section class="workspace-review-report-shell">
      <div class="workspace-review-report-head" data-review-report-head>
        <span>Report guide</span>
        <strong>Choose a report or write a prompt</strong>
        <p>Pick a report type, write your own prompt, or combine both to shape the report from the current script.</p>
      </div>
      <article class="workspace-review-report-output" data-review-report-output>
        ${buildReport(reportDefault.key).body}
      </article>
    </section>
  `;
  const reviewInsightSelect = container.querySelector("[data-review-insight-select]");
  const reviewInsightDisplay = container.querySelector("[data-review-insight-display]");
  const renderReviewInsight = (key) => {
    const insight = reviewInsightOptions.find((item) => item.key === key) || reviewInsightDefault;
    if (!reviewInsightDisplay) return;
    reviewInsightDisplay.innerHTML = `
      <span>${escapeHtml(insight.label)}</span>
      <strong>${escapeHtml(insight.value)}</strong>
      <small>${escapeHtml(insight.meta)}</small>
      <p>${escapeHtml(insight.note)}</p>
      ${insight.body || ""}
    `;
  };
  reviewInsightSelect?.addEventListener("change", () => renderReviewInsight(reviewInsightSelect.value));
  const reportSelect = container.querySelector("[data-review-report-select]");
  const reportPrompt = container.querySelector("[data-review-report-prompt]");
  const reportHead = container.querySelector("[data-review-report-head]");
  const reportOutput = container.querySelector("[data-review-report-output]");
  const renderWorkspaceReport = () => {
    const report = buildReport(reportSelect?.value || reportDefault.key, reportPrompt?.value || "");
    if (reportHead) {
      reportHead.innerHTML = `
        <span>${escapeHtml(report.eyebrow)}</span>
        <strong>${escapeHtml(report.title)}</strong>
        <p>${escapeHtml(report.description)}</p>
      `;
    }
    if (reportOutput) {
      reportOutput.innerHTML = report.body;
    }
  };
  container.querySelector("[data-review-run-report]")?.addEventListener("click", renderWorkspaceReport);
  showModal({
    title: "Review Center",
    message: container,
    showConfirm: false,
    cancelLabel: "Close",
    contentClass: "modal-content-review-center"
  });
}

function getWorkspaceNotifications(workspaceId = state.currentWorkspaceId) {
  return [...(getWorkspaceLeadProject(workspaceId)?.workspace?.notifications || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createWorkspaceNotification({ workspaceId = state.currentWorkspaceId, task = null, category = "update", title = "", message = "", actor = "" } = {}) {
  if (!workspaceId || !title) return;
  updateWorkspaceAcrossProjects(workspaceId, (workspace) => ({
    ...workspace,
    notifications: [
      {
        id: uid("notif"),
        taskId: task?.id || "",
        projectId: task?.projectId || "",
        category,
        title,
        message,
        actor,
        createdAt: new Date().toISOString(),
        read: false
      },
      ...(workspace.notifications || [])
    ].slice(0, 40)
  }));
}

function markWorkspaceNotificationRead(notificationId, read = true) {
  if (!state.currentWorkspaceId || !notificationId) return;
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    notifications: (workspace.notifications || []).map((notification) => notification.id === notificationId
      ? { ...notification, read }
      : notification)
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
}

function markAllWorkspaceNotificationsRead() {
  if (!state.currentWorkspaceId) return;
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    notifications: (workspace.notifications || []).map((notification) => ({ ...notification, read: true }))
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
}

function clearWorkspaceInboxItems() {
  const workspaceId = state.currentWorkspaceId || getCurrentProject()?.workspace?.id || getCurrentProject()?.id || "";
  if (!workspaceId && !(state.pendingInvitations || []).length) return;
  state.workspaceInboxClearedAt = {
    ...(state.workspaceInboxClearedAt || {}),
    ...(workspaceId ? { [workspaceId]: new Date().toISOString() } : {})
  };
  state.pendingInvitations = [];
  if (workspaceId) {
    markAllWorkspaceNotificationsRead();
  }
  renderWorkspaceInboxPopup();
}

function dismissWorkspaceInboxItem(itemId) {
  const workspaceId = state.currentWorkspaceId || getCurrentProject()?.workspace?.id || getCurrentProject()?.id || "";
  if (!workspaceId || !itemId) return;
  const existing = new Set(state.workspaceInboxDismissedIds?.[workspaceId] || []);
  existing.add(itemId);
  state.workspaceInboxDismissedIds = {
    ...(state.workspaceInboxDismissedIds || {}),
    [workspaceId]: [...existing]
  };
  renderWorkspaceInboxPopup();
}

function resolveAiTaskStart(choice, manualValue = "") {
  const now = Date.now();
  if (choice === "in-3m") return new Date(now + (3 * 60 * 1000)).toISOString();
  if (choice === "in-10m") return new Date(now + (10 * 60 * 1000)).toISOString();
  if (choice === "manual" && manualValue) {
    const parsed = new Date(manualValue);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  return "";
}

function getAiTaskDisplayState(task) {
  if (task.assigneeType !== "system") return "";
  if (task.aiState === "scheduled" && task.aiStartAt) {
    return new Date(task.aiStartAt).getTime() <= Date.now() ? "ready" : "scheduled";
  }
  return task.aiState || "idle";
}

function clearAiTaskTimer(taskId) {
  const timer = aiTaskTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    aiTaskTimers.delete(taskId);
  }
}

function scheduleAiTaskRun(task) {
  clearAiTaskTimer(task.id);
  if (!task || task.assigneeType !== "system" || !["scheduled", "ready"].includes(task.aiState)) {
    return;
  }
  const startAtMs = task.aiStartAt ? new Date(task.aiStartAt).getTime() : Date.now();
  const delay = Math.max(0, startAtMs - Date.now());
  const timer = setTimeout(() => {
    aiTaskTimers.delete(task.id);
    runAiTask(task.id);
  }, delay);
  aiTaskTimers.set(task.id, timer);
}

function syncAiTaskSchedules(workspaceId = state.currentWorkspaceId) {
  const root = getWorkspaceRootProject(workspaceId);
  const tasks = root?.workspace?.tasks || [];
  const validIds = new Set(tasks.map((task) => task.id));
  [...aiTaskTimers.keys()].forEach((taskId) => {
    if (!validIds.has(taskId)) clearAiTaskTimer(taskId);
  });
  tasks.forEach((task) => scheduleAiTaskRun(task));
}

function insertAiTaskResultIntoProject(task, resultText) {
  return insertAiTaskResultIntoProjectWithMode(task, resultText, task.lastApplyMode || "insert-below");
}

function getProjectSceneRange(project, task) {
  if (!project || !Array.isArray(project.lines) || !project.lines.length) {
    return null;
  }
  const explicitSceneIndex = task.sceneId
    ? project.lines.findIndex((line) => line.id === task.sceneId)
    : -1;
  let startIndex = explicitSceneIndex;
  if (startIndex < 0 && task.lineId) {
    const lineIndex = project.lines.findIndex((line) => line.id === task.lineId);
    if (lineIndex >= 0) {
      for (let index = lineIndex; index >= 0; index -= 1) {
        if (project.lines[index]?.type === "scene") {
          startIndex = index;
          break;
        }
      }
    }
  }
  if (startIndex < 0) return null;
  let endIndex = project.lines.length - 1;
  for (let index = startIndex + 1; index < project.lines.length; index += 1) {
    if (project.lines[index]?.type === "scene") {
      endIndex = index - 1;
      break;
    }
  }
  return { startIndex, endIndex };
}

function getAiTaskTargetContext(task) {
  const project = state.projects.find((item) => item.id === task.projectId);
  if (!project?.lines?.length) {
    return {
      projectTitle: "Linked Project",
      targetLabel: task.sceneLabel || task.reference || "Project context",
      originalText: "No linked script context was found for this task."
    };
  }
  const sceneRange = getProjectSceneRange(project, task);
  const lineIndex = task.lineId
    ? project.lines.findIndex((line) => line.id === task.lineId)
    : -1;
  const sourceLines = [];
  let targetLabel = task.sceneLabel || task.reference || project.title;
  if (lineIndex >= 0) {
    const start = Math.max(0, lineIndex - 1);
    const end = Math.min(project.lines.length - 1, lineIndex + 2);
    for (let index = start; index <= end; index += 1) {
      sourceLines.push(project.lines[index]);
    }
    targetLabel = task.reference || task.sceneLabel || "Linked line";
  } else if (sceneRange) {
    const limit = Math.min(sceneRange.endIndex, sceneRange.startIndex + 7);
    for (let index = sceneRange.startIndex; index <= limit; index += 1) {
      sourceLines.push(project.lines[index]);
    }
    targetLabel = task.sceneLabel || "Linked scene";
  } else {
    sourceLines.push(...project.lines.slice(Math.max(0, project.lines.length - 6)));
  }
  const originalText = sourceLines.map((line) => formatLineText(line)).join("\n").trim() || "No source context available.";
  return {
    projectTitle: project.title,
    targetLabel,
    originalText
  };
}

function insertAiTaskResultIntoProjectWithMode(task, resultText, mode = "insert-below") {
  const project = state.projects.find((item) => item.id === task.projectId);
  if (!project) return false;
  const generatedLines = parseTextToLines(resultText);
  if (!generatedLines.length) return false;
  const lineIndex = task.lineId ? project.lines.findIndex((line) => line.id === task.lineId) : -1;
  const sceneRange = getProjectSceneRange(project, task);

  if (mode === "replace-target") {
    if (lineIndex >= 0) {
      project.lines.splice(lineIndex, 1, ...generatedLines);
    } else if (sceneRange) {
      project.lines.splice(sceneRange.startIndex, (sceneRange.endIndex - sceneRange.startIndex) + 1, ...generatedLines);
    } else {
      project.lines.splice(project.lines.length, 0, ...generatedLines);
    }
  } else if (mode === "append-scene") {
    const insertIndex = sceneRange ? sceneRange.endIndex + 1 : project.lines.length;
    project.lines.splice(insertIndex, 0, ...generatedLines);
  } else {
    const anchorId = task.lineId || task.sceneId || "";
    let insertIndex = anchorId ? project.lines.findIndex((line) => line.id === anchorId) + 1 : project.lines.length;
    if (insertIndex <= 0) insertIndex = project.lines.length;
    project.lines.splice(insertIndex, 0, ...generatedLines);
  }

  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  return true;
}

function getWorkspaceTaskFormContainer(trigger = null) {
  return trigger?.closest?.("#workspaceDashboard, #homeWorkspaceDashboard")
    || (!refs.workspaceView?.hidden ? refs.workspaceDashboard : refs.homeWorkspaceDashboard)
    || refs.workspaceDashboard;
}

function addWorkspaceTaskFromDashboard(trigger = null) {
  const workspaceProject = getWorkspaceLeadProject();
  const formContainer = getWorkspaceTaskFormContainer(trigger);
  if (!workspaceProject || !formContainer) return;
  const templateSelect = formContainer.querySelector('[data-workspace-task-template]');
  const titleInput = formContainer.querySelector('[data-workspace-task-title]');
  const descriptionInput = formContainer.querySelector('[data-workspace-task-description]');
  const projectSelect = formContainer.querySelector('[data-workspace-task-project]');
  const sceneSelect = formContainer.querySelector('[data-workspace-task-scene]');
  const lineSelect = formContainer.querySelector('[data-workspace-task-line]');
  const assigneeSelect = formContainer.querySelector('[data-workspace-task-assignee]');
  const referenceInput = formContainer.querySelector('[data-workspace-task-reference]');
  const statusSelect = formContainer.querySelector('[data-workspace-task-status-new]');
  const prioritySelect = formContainer.querySelector('[data-workspace-task-priority]');
  const dueInput = formContainer.querySelector('[data-workspace-task-due]');
  const handoffInput = formContainer.querySelector('[data-workspace-task-handoff]');
  const memorySelect = formContainer.querySelector('[data-workspace-task-memory]');
  const aiStartSelect = formContainer.querySelector('[data-workspace-task-ai-start]');
  const aiStartManual = formContainer.querySelector('[data-workspace-task-ai-start-manual]');
  const templateKey = templateSelect?.value || "custom";
  const isStoryMemoryTask = templateKey === "story-memory";
  const title = titleInput?.value?.trim();
  if (!title) {
    customAlert("Enter a task title first.", "Workspace Tasks");
    return;
  }
  const projectId = projectSelect?.value || "";
  const sceneId = isStoryMemoryTask ? "" : (sceneSelect?.value || "");
  const lineId = isStoryMemoryTask ? "" : (lineSelect?.value || "");
  const sceneChoice = isStoryMemoryTask ? null : (getWorkspaceTaskSceneChoices().find((scene) => scene.sceneId === sceneId) || null);
  const lineChoice = isStoryMemoryTask ? null : (getWorkspaceTaskLineChoices().find((line) => line.lineId === lineId) || null);
  const assignedTo = assigneeSelect?.value || "";
  const assignee = getWorkspaceTaskAssignees(workspaceProject).find((entry) => entry.id === assignedTo);
  const selectedMemoryId = isStoryMemoryTask ? (sceneSelect?.value || "") : (memorySelect?.value || "");
  const memoryChoice = getWorkspaceStoryMemoryChoices().find((entry) => entry.id === selectedMemoryId) || null;
  const aiStartChoice = aiStartSelect?.value || "now";
  const aiStartAt = assignee?.assigneeType === "system" ? resolveAiTaskStart(aiStartChoice, aiStartManual?.value || "") : "";
  const initialAiState = assignee?.assigneeType === "system"
    ? (aiStartAt ? "scheduled" : "ready")
    : "idle";
  const nextTask = {
    id: uid("task"),
    templateKey,
    priority: prioritySelect?.value || "normal",
    title,
    description: descriptionInput?.value?.trim() || "",
    status: statusSelect?.value || "todo",
    dueAt: dueInput?.value ? new Date(dueInput.value).toISOString() : "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: handoffInput?.value?.trim() || "",
    projectId: memoryChoice?.projectId || lineChoice?.projectId || sceneChoice?.projectId || projectId,
    reference: referenceInput?.value?.trim() || "",
    sceneId: lineChoice?.sceneId || sceneChoice?.sceneId || "",
    sceneLabel: lineChoice?.sceneLabel || sceneChoice?.label || "",
    lineId: lineChoice?.lineId || sceneChoice?.lineId || "",
    lineLabel: lineChoice?.lineLabel || "",
    memoryLinkType: memoryChoice?.type || "",
    memoryLinkId: memoryChoice?.id || "",
    memoryLinkName: memoryChoice?.name || "",
    memoryProjectId: memoryChoice?.projectId || "",
    comments: [],
    aiState: initialAiState,
    aiStartAt,
    aiLastRunAt: "",
    aiResultText: "",
    aiResultSummary: "",
    aiError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  };

  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: [...(workspace.tasks || []), nextTask]
  }));
  createWorkspaceNotification({
    task: nextTask,
    category: assignee?.assigneeType === "system" ? "ai" : "task",
    title: assignee?.assigneeType === "system" ? "AI task queued" : "New task created",
    message: `${nextTask.title} ${assignee?.assigneeType === "system" ? `was assigned to ${nextTask.assignedLabel}.` : `was assigned to ${nextTask.assignedLabel || "the workspace"}.`}`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  clearWorkspaceTaskDraft();
  state.workspaceRefreshPending = false;
  state.lastCreatedWorkspaceTaskId = nextTask.id;
  persistProjects(true, { syncInputs: false });
  scheduleAiTaskRun(nextTask);
  if (!refs.workspaceView?.hidden) {
    renderWorkspaceView();
  } else {
    renderHome();
  }
  window.requestAnimationFrame(() => {
    const card = document.querySelector(`[data-workspace-task-card-id="${CSS.escape(nextTask.id)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  showToast(
    assignee?.assigneeType === "system"
      ? `AI task queued for ${nextTask.assignedLabel}.`
      : `${nextTask.title} assigned to ${nextTask.assignedLabel || "the workspace"}.`,
    "success"
  );
}

export async function createWorkspaceTaskFromEditorLine(targetBlock = null) {
  const project = getCurrentProject();
  const block = targetBlock?.closest?.(".script-block") || getActiveEditableBlock();
  const lineId = block?.dataset?.id || state.activeBlockId || "";
  const line = lineId ? getLine(lineId) : null;
  const workspaceId = project?.workspace?.id || "";
  const workspaceProject = getWorkspaceLeadProject(workspaceId);
  if (!project || !line || !workspaceId || !workspaceProject) {
    await customAlert("Open a workspace script first, then right-click a line to create a task.", "Workspace Tasks");
    return;
  }

  const sceneId = line.type === "scene" ? line.id : getOwningSceneId(line.id);
  const sceneLine = sceneId ? project.lines.find((entry) => entry.id === sceneId) : null;
  const assignees = getWorkspaceTaskAssignees(workspaceProject);
  const container = document.createElement("div");
  container.className = "line-task-form";
  container.innerHTML = `
    <label class="workspace-task-field line-task-title-field">
      <span>Task</span>
      <input id="lineTaskTitle" class="modal-input" type="text" value="Review this line">
    </label>
    <div class="line-task-grid">
      <label class="workspace-task-field">
        <span>Assign to</span>
        <select id="lineTaskAssignee" class="comment-filter-select">
          ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}">${escapeHtml(assignee.label)}</option>`).join("")}
        </select>
      </label>
      <label class="workspace-task-field">
        <span>Priority</span>
        <select id="lineTaskPriority" class="comment-filter-select">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label class="workspace-task-field">
        <span>Template</span>
        <select id="lineTaskTemplate" class="comment-filter-select">
          ${WORKSPACE_TASK_TEMPLATES.map((template) => `<option value="${escapeHtml(template.key)}">${escapeHtml(template.label)}</option>`).join("")}
        </select>
      </label>
    </div>
    <textarea id="lineTaskDescription" class="collab-textarea line-task-description" placeholder="What should happen on this line?">${escapeHtml(formatLineText(line.text, line.type).slice(0, 180))}</textarea>
  `;

  const confirmed = await showModal({
    title: "Create Task From Line",
    message: container,
    confirmLabel: "Create Task",
    cancelLabel: "Cancel",
    contentClass: "modal-content-line-task"
  });
  if (!confirmed) return;

  const title = container.querySelector("#lineTaskTitle")?.value?.trim();
  if (!title) {
    await customAlert("Enter a task title first.", "Workspace Tasks");
    return;
  }
  const assignedTo = container.querySelector("#lineTaskAssignee")?.value || "";
  const assignee = assignees.find((entry) => entry.id === assignedTo) || assignees[0];
  const templateKey = container.querySelector("#lineTaskTemplate")?.value || "custom";
  const priority = container.querySelector("#lineTaskPriority")?.value || "normal";
  const aiStartAt = assignee?.assigneeType === "system" ? resolveAiTaskStart("now", "") : "";
  const nextTask = {
    id: uid("task"),
    templateKey,
    priority,
    title,
    description: container.querySelector("#lineTaskDescription")?.value?.trim() || "",
    status: "todo",
    dueAt: "",
    assignedTo: assignee?.id || "",
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: "",
    projectId: project.id,
    reference: `${project.title} - ${formatLineText(line.text, line.type).slice(0, 56)}`,
    sceneId: sceneId || "",
    sceneLabel: sceneLine?.text?.trim() || "",
    lineId: line.id,
    lineLabel: formatLineText(line.text, line.type).slice(0, 80),
    memoryLinkType: "",
    memoryLinkId: "",
    memoryLinkName: "",
    memoryProjectId: "",
    comments: [],
    aiState: assignee?.assigneeType === "system" ? (aiStartAt ? "scheduled" : "ready") : "idle",
    aiStartAt,
    aiLastRunAt: "",
    aiResultText: "",
    aiResultSummary: "",
    aiError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  };

  updateWorkspaceAcrossProjects(workspaceId, (workspace) => ({
    ...workspace,
    tasks: [...(workspace.tasks || []), nextTask]
  }));
  createWorkspaceNotification({
    workspaceId,
    task: nextTask,
    category: assignee?.assigneeType === "system" ? "ai" : "task",
    title: assignee?.assigneeType === "system" ? "AI task queued" : "New task created",
    message: `${nextTask.title} was assigned to ${nextTask.assignedLabel || "the workspace"}.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  state.lastCreatedWorkspaceTaskId = nextTask.id;
  persistProjects(true, { syncInputs: false });
  scheduleAiTaskRun(nextTask);
  renderStudio();
  focusBlock(line.id);
  showToast(`${nextTask.title} linked to this line.`, "success");
}

function updateWorkspaceTask(taskId, patch) {
  if (!state.currentWorkspaceId || !taskId) return;
  const previousTask = getWorkspaceTaskById(taskId);
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: (workspace.tasks || []).map((task) => task.id === taskId
      ? { ...task, ...patch, updatedAt: new Date().toISOString() }
      : task)
  }));
  persistProjects(true, { syncInputs: false });
  const task = getWorkspaceTaskById(taskId);
  if (task && previousTask) {
    if (patch.status && patch.status !== previousTask.status) {
      showToast(`${task.title} moved to ${patch.status === "in-progress" ? "In Progress" : patch.status === "done" ? "Done" : "To Do"}.`, "success");
      createWorkspaceNotification({
        task,
        category: patch.status === "done" ? "completed" : "task",
        title: patch.status === "done" ? "Task completed" : "Task status updated",
        message: `${task.title} is now ${patch.status === "in-progress" ? "in progress" : patch.status.replace("-", " ")}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
    if (patch.assignedTo && patch.assignedTo !== previousTask.assignedTo) {
      showToast(`${task.title} is now assigned to ${task.assignedLabel || "a teammate"}.`, "success");
      createWorkspaceNotification({
        task,
        category: task.assigneeType === "system" ? "ai" : "task",
        title: "Task reassigned",
        message: `${task.title} is now assigned to ${task.assignedLabel || "a teammate"}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
    if (patch.dueAt && patch.dueAt !== previousTask.dueAt) {
      showToast(`${task.title} due date updated.`, "success");
      createWorkspaceNotification({
        task,
        category: "task",
        title: "Task due date updated",
        message: `${task.title} is due ${new Date(task.dueAt).toLocaleString()}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
  }
  if (task) scheduleAiTaskRun(task);
  renderWorkspaceView();
}

async function runAiTask(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task || task.assigneeType !== "system" || task.aiState === "running") return;
  const taskToastId = `ai-task-${taskId}`;
  const project = state.projects.find((item) => item.id === task.projectId) || getCurrentProject();
  if (!project) {
    updateWorkspaceTask(taskId, { aiState: "failed", aiError: "The linked project could not be found." });
    updateToast(taskToastId, "AI task could not find its linked project.", "error", { duration: 4200 });
    createWorkspaceNotification({
      task,
      category: "ai",
      title: "AI task needs relinking",
      message: `${task.title} could not run because its linked project is missing.`,
      actor: "@AIassist"
    });
    return;
  }
  updateWorkspaceTask(taskId, {
    aiState: "running",
    aiError: "",
    status: task.status === "done" ? "done" : "in-progress",
    aiLastRunAt: new Date().toISOString()
  });
  updateToast(taskToastId, `${task.title} is processing...`, "loading", { duration: 0 });
  try {
    const resultText = String(await AI.runWorkspaceTaskAssistant(task, project) || "").trim();
    if (!resultText) {
      throw new Error("AI returned no usable result.");
    }
    updateWorkspaceTask(taskId, {
      aiState: "review",
      aiResultText: resultText,
      aiResultSummary: task.title,
      aiError: ""
    });
    updateToast(taskToastId, "AI task finished.", "success");
    createWorkspaceNotification({
      task: { ...task, aiResultText: resultText },
      category: "review",
      title: "AI result ready for review",
      message: `${task.title} has a suggested result ready to review.`,
      actor: "@AIassist"
    });
  } catch (error) {
    updateWorkspaceTask(taskId, {
      aiState: "failed",
      aiError: error instanceof Error ? error.message : "AI task failed."
    });
    updateToast(taskToastId, "AI task failed.", "error", { duration: 4200 });
    createWorkspaceNotification({
      task,
      category: "ai",
      title: "AI task failed",
      message: `${task.title} needs attention before it can run successfully again. ${String(error instanceof Error ? error.message : "AI task failed.").trim()}`,
      actor: "@AIassist"
    });
  }
}

async function reviewAiTaskResult(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task?.aiResultText) return;
  const context = getAiTaskTargetContext(task);
  const container = document.createElement("div");
  container.className = "workspace-ai-review";
  container.innerHTML = `
    <div class="workspace-ai-review-head">
      <span class="workspace-task-tag">AI Suggestion</span>
      <span class="workspace-task-tag">${escapeHtml(task.assignedLabel || "@AIassist")}</span>
      <span class="workspace-task-tag workspace-task-tag-priority workspace-task-tag-priority-${escapeHtml(task.priority || "normal")}">${escapeHtml((task.priority || "normal").replace(/^./, (value) => value.toUpperCase()))} Priority</span>
    </div>
    <div class="workspace-ai-review-summary">
      <p class="modal-copy">${escapeHtml(task.title)}</p>
      <p class="workspace-ai-review-caption">${escapeHtml(context.projectTitle)} Â· ${escapeHtml(context.targetLabel)}</p>
    </div>
    <div class="workspace-ai-review-grid">
      <div class="workspace-ai-review-panel">
        <span class="workspace-ai-review-label">Current Script Context</span>
        <div class="workspace-ai-review-body">${escapeHtml(context.originalText).replace(/\n/g, "<br>")}</div>
      </div>
      <div class="workspace-ai-review-panel">
        <span class="workspace-ai-review-label">AI Suggestion</span>
        <div class="workspace-ai-review-body">${escapeHtml(task.aiResultText).replace(/\n/g, "<br>")}</div>
      </div>
    </div>
    <label class="workspace-ai-apply-row">
      <span class="workspace-ai-review-label">Apply Result As</span>
      <select class="comment-filter-select" id="workspaceAiApplyMode">
        <option value="insert-below" ${(task.lastApplyMode || "insert-below") === "insert-below" ? "selected" : ""}>Insert below target</option>
        <option value="replace-target" ${task.lastApplyMode === "replace-target" ? "selected" : ""}>Replace target</option>
        <option value="append-scene" ${task.lastApplyMode === "append-scene" ? "selected" : ""}>Append to scene</option>
      </select>
    </label>
  `;
  const shouldApply = await showModal({
    title: "AI Task Result",
    message: container,
    confirmLabel: "Apply",
    cancelLabel: "Close",
    contentClass: "workspace-ai-review-modal"
  });
  if (!shouldApply) return;
  const applyMode = container.querySelector("#workspaceAiApplyMode")?.value || task.lastApplyMode || "insert-below";
  await applyAiTaskResult(taskId, applyMode);
}

async function applyAiTaskResult(taskId, applyMode = null) {
  const task = getWorkspaceTaskById(taskId);
  if (!task?.aiResultText) return;
  const finalMode = applyMode || task.lastApplyMode || "insert-below";
  const applied = insertAiTaskResultIntoProjectWithMode(task, task.aiResultText, finalMode);
  if (!applied) {
    await customAlert("The AI result could not be inserted into the project.", "AI Task");
    return;
  }
  updateWorkspaceTask(taskId, { aiState: "applied", status: "done", lastApplyMode: finalMode });
  createWorkspaceNotification({
    task,
    category: "completed",
    title: "AI result applied",
    message: `${task.title} was applied to the script with ${finalMode.replace("-", " ")} mode.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  openProject(task.projectId, { focusLineId: task.lineId || task.sceneId || "" });
  showToast("AI result applied to the script.", "success");
}

function dismissAiTaskResult(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task) return;
  updateWorkspaceTask(taskId, { aiState: "dismissed" });
  createWorkspaceNotification({
    task,
    category: "review",
    title: "AI result dismissed",
    message: `${task.title} was reviewed and dismissed.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  showToast("AI result dismissed.", "success");
}

async function editWorkspaceTask(taskId) {
  const workspaceProject = getWorkspaceLeadProject();
  const task = getWorkspaceTaskById(taskId);
  if (!workspaceProject || !task) return;
  const assignees = getWorkspaceTaskAssignees(workspaceProject);
  const scenes = getWorkspaceTaskSceneChoices();
  const lines = getWorkspaceTaskLineChoices();
  const memoryChoices = getWorkspaceStoryMemoryChoices();
  const selectedTemplate = getWorkspaceTaskTemplate(task.templateKey);
  const container = document.createElement("div");
  container.className = "workspace-task-form workspace-task-form-modal";
  container.innerHTML = `
    <select id="taskEditTemplate" class="comment-filter-select">
      ${WORKSPACE_TASK_TEMPLATES.map((template) => `<option value="${escapeHtml(template.key)}" ${template.key === (task.templateKey || "custom") ? "selected" : ""}>${escapeHtml(template.label)}</option>`).join("")}
    </select>
    <input id="taskEditTitle" class="modal-input" type="text" value="${task.title}">
    <select id="taskEditProject" class="comment-filter-select">
      ${getWorkspaceProjects(state.currentWorkspaceId).filter((project) => !project.isWorkspaceRoot).map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === task.projectId ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}
    </select>
    <select id="taskEditScene" class="comment-filter-select">
      <option value="">General task</option>
      ${scenes.map((scene) => `<option value="${escapeHtml(scene.sceneId)}" ${scene.sceneId === task.sceneId ? "selected" : ""}>${escapeHtml(scene.label)}</option>`).join("")}
    </select>
    <select id="taskEditLine" class="comment-filter-select">
      <option value="">Scene level</option>
      ${lines.map((line) => `<option value="${escapeHtml(line.lineId)}" ${line.lineId === task.lineId ? "selected" : ""}>${escapeHtml(line.label)}</option>`).join("")}
    </select>
    <select id="taskEditAssignee" class="comment-filter-select">
      ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}" ${assignee.id === task.assignedTo ? "selected" : ""}>${escapeHtml(assignee.label)}</option>`).join("")}
    </select>
    <select id="taskEditStatus" class="comment-filter-select">
      <option value="todo" ${task.status === "todo" ? "selected" : ""}>To Do</option>
      <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>In Progress</option>
      <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
    </select>
    <select id="taskEditPriority" class="comment-filter-select">
      <option value="normal" ${(task.priority || "normal") === "normal" ? "selected" : ""}>Priority: Normal</option>
      <option value="high" ${(task.priority || "normal") === "high" ? "selected" : ""}>Priority: High</option>
      <option value="low" ${(task.priority || "normal") === "low" ? "selected" : ""}>Priority: Low</option>
    </select>
    <input id="taskEditDueAt" class="modal-input" type="datetime-local" value="${task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : ""}">
    <select id="taskEditAiStart" class="comment-filter-select">
      <option value="now" ${!task.aiStartAt ? "selected" : ""}>Run now</option>
      <option value="in-3m">In 3 mins</option>
      <option value="in-10m">In 10 mins</option>
      <option value="manual" ${task.aiStartAt ? "selected" : ""}>Custom time</option>
    </select>
    <input id="taskEditAiStartManual" class="modal-input" type="datetime-local" value="${task.aiStartAt ? new Date(task.aiStartAt).toISOString().slice(0, 16) : ""}">
    <input id="taskEditReference" class="modal-input" type="text" value="${escapeHtml(task.reference || "")}" placeholder="Scene / block reference (optional)">
    <select id="taskEditMemory" class="comment-filter-select">
      <option value="">Story memory link (optional)</option>
      ${memoryChoices.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === task.memoryLinkId ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
    </select>
    <input id="taskEditHandoff" class="modal-input" type="text" value="${escapeHtml(task.handoffNote || "")}" placeholder="Handoff cue or mention (optional)">
    <textarea id="taskEditDescription" class="collab-textarea workspace-task-description" placeholder="Describe what needs to happen...">${escapeHtml(task.description || "")}</textarea>
    <p id="taskEditTemplateHint" class="modal-copy">${escapeHtml(selectedTemplate.aiInstruction)}</p>
  `;
  container.dataset.workspaceTemplateApplied = task.templateKey || "custom";
  container.querySelector("#taskEditTemplate")?.addEventListener("change", (event) => {
    applyWorkspaceTaskTemplateToForm(container, event.target.value);
  });
  const saved = await showModal({
    title: "Edit Task",
    message: container,
    confirmLabel: "Save"
  });
  if (!saved) return;
  const sceneId = container.querySelector("#taskEditScene")?.value || "";
  const lineId = container.querySelector("#taskEditLine")?.value || "";
  const sceneChoice = scenes.find((scene) => scene.sceneId === sceneId) || null;
  const lineChoice = lines.find((line) => line.lineId === lineId) || null;
  const assignedTo = container.querySelector("#taskEditAssignee")?.value || "";
  const assignee = assignees.find((entry) => entry.id === assignedTo);
  const memoryId = container.querySelector("#taskEditMemory")?.value || "";
  const memoryChoice = memoryChoices.find((entry) => entry.id === memoryId) || null;
  const aiStartAt = assignee?.assigneeType === "system"
    ? resolveAiTaskStart(
        container.querySelector("#taskEditAiStart")?.value || "now",
        container.querySelector("#taskEditAiStartManual")?.value || ""
      )
    : "";
  updateWorkspaceTask(taskId, {
    templateKey: container.querySelector("#taskEditTemplate")?.value || "custom",
    priority: container.querySelector("#taskEditPriority")?.value || task.priority || "normal",
    title: container.querySelector("#taskEditTitle")?.value?.trim() || task.title,
    description: container.querySelector("#taskEditDescription")?.value?.trim() || "",
    dueAt: container.querySelector("#taskEditDueAt")?.value ? new Date(container.querySelector("#taskEditDueAt").value).toISOString() : "",
    projectId: lineChoice?.projectId || sceneChoice?.projectId || container.querySelector("#taskEditProject")?.value || task.projectId,
    sceneId: lineChoice?.sceneId || sceneChoice?.sceneId || "",
    sceneLabel: lineChoice?.sceneLabel || sceneChoice?.label || "",
    lineId: lineChoice?.lineId || sceneChoice?.lineId || "",
    lineLabel: lineChoice?.lineLabel || "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: container.querySelector("#taskEditHandoff")?.value?.trim() || "",
    memoryLinkType: memoryChoice?.type || "",
    memoryLinkId: memoryChoice?.id || "",
    memoryLinkName: memoryChoice?.name || "",
    memoryProjectId: memoryChoice?.projectId || "",
    aiStartAt,
    aiState: assignee?.assigneeType === "system"
      ? (task.aiState === "review" || task.aiState === "applied" || task.aiState === "dismissed"
          ? task.aiState
          : (aiStartAt ? "scheduled" : "ready"))
      : "idle",
    status: container.querySelector("#taskEditStatus")?.value || task.status,
    reference: container.querySelector("#taskEditReference")?.value?.trim() || ""
  });
}

function buildWorkspaceTaskSummary(task) {
  const statusLabel = task.status === "in-progress" ? "In Progress" : task.status === "done" ? "Done" : "To Do";
  const priorityLabel = (task.priority || "normal").replace(/^./, (value) => value.toUpperCase());
  const targetLabel = task.lineLabel || task.sceneLabel || task.reference || "General workspace task";
  const dueLabel = task.dueAt ? new Date(task.dueAt).toLocaleString() : "No due date";
  const updatedLabel = task.updatedAt ? new Date(task.updatedAt).toLocaleString() : "Just now";
  const description = task.description || targetLabel;
  const container = document.createElement("div");
  container.className = "workspace-task-quick-summary";
  container.innerHTML = `
    <div class="workspace-task-quick-head">
      <span class="workspace-task-tag">${escapeHtml(statusLabel)}</span>
      <span class="workspace-task-tag workspace-task-tag-priority workspace-task-tag-priority-${escapeHtml(task.priority || "normal")}">${escapeHtml(priorityLabel)} Priority</span>
    </div>
    <strong>${escapeHtml(task.title || "Workspace task")}</strong>
    <p>${escapeHtml(description)}</p>
    <dl>
      <div>
        <dt>Assigned to</dt>
        <dd>${escapeHtml(task.assignedLabel || "Unassigned")}</dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd>${escapeHtml(targetLabel)}</dd>
      </div>
      <div>
        <dt>Due</dt>
        <dd>${escapeHtml(dueLabel)}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>${escapeHtml(updatedLabel)}</dd>
      </div>
    </dl>
  `;
  return container;
}

async function editWorkspaceTaskFromLine(taskId) {
  const workspaceProject = getWorkspaceLeadProject();
  const task = getWorkspaceTaskById(taskId);
  if (!workspaceProject || !task) return;
  const assignees = getWorkspaceTaskAssignees(workspaceProject);
  const container = document.createElement("div");
  container.className = "line-task-form";
  container.innerHTML = `
    <label class="workspace-task-field line-task-title-field">
      <span>Task</span>
      <input id="lineTaskTitle" class="modal-input" type="text" value="${escapeHtml(task.title || "Review this line")}">
    </label>
    <div class="line-task-grid">
      <label class="workspace-task-field">
        <span>Assign to</span>
        <select id="lineTaskAssignee" class="comment-filter-select">
          ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}" ${assignee.id === task.assignedTo ? "selected" : ""}>${escapeHtml(assignee.label)}</option>`).join("")}
        </select>
      </label>
      <label class="workspace-task-field">
        <span>Priority</span>
        <select id="lineTaskPriority" class="comment-filter-select">
          <option value="normal" ${(task.priority || "normal") === "normal" ? "selected" : ""}>Normal</option>
          <option value="high" ${(task.priority || "normal") === "high" ? "selected" : ""}>High</option>
          <option value="low" ${(task.priority || "normal") === "low" ? "selected" : ""}>Low</option>
        </select>
      </label>
      <label class="workspace-task-field">
        <span>Template</span>
        <select id="lineTaskTemplate" class="comment-filter-select">
          ${WORKSPACE_TASK_TEMPLATES.map((template) => `<option value="${escapeHtml(template.key)}" ${template.key === (task.templateKey || "custom") ? "selected" : ""}>${escapeHtml(template.label)}</option>`).join("")}
        </select>
      </label>
    </div>
    <textarea id="lineTaskDescription" class="collab-textarea line-task-description" placeholder="What should happen on this line?">${escapeHtml(task.description || task.lineLabel || task.sceneLabel || "")}</textarea>
  `;
  const confirmed = await showModal({
    title: "Edit Task From Line",
    message: container,
    confirmLabel: "Save",
    cancelLabel: "Cancel",
    contentClass: "modal-content-line-task"
  });
  if (!confirmed) return;
  const title = container.querySelector("#lineTaskTitle")?.value?.trim();
  if (!title) {
    await customAlert("Enter a task title first.", "Workspace Tasks");
    return;
  }
  const assignedTo = container.querySelector("#lineTaskAssignee")?.value || "";
  const assignee = assignees.find((entry) => entry.id === assignedTo) || assignees[0];
  const aiStartAt = assignee?.assigneeType === "system" ? resolveAiTaskStart("now", "") : "";
  updateWorkspaceTask(taskId, {
    title,
    templateKey: container.querySelector("#lineTaskTemplate")?.value || "custom",
    priority: container.querySelector("#lineTaskPriority")?.value || task.priority || "normal",
    description: container.querySelector("#lineTaskDescription")?.value?.trim() || "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    aiStartAt,
    aiState: assignee?.assigneeType === "system" ? (aiStartAt ? "scheduled" : "ready") : "idle"
  });
  renderStudio();
  if (task.lineId) focusBlock(task.lineId);
}

async function showWorkspaceTaskFlagSummary(taskId) {
  const workspaceProject = getWorkspaceLeadProject();
  const task = getWorkspaceTaskById(taskId);
  if (!workspaceProject || !task) return;
  const currentUser = auth.currentUser || {};
  const isAssignee = Boolean(
    task.assignedTo
    && (
      task.assignedTo === currentUser.uid
      || task.assignedTo === currentUser.email
      || task.assignedTo === currentUser.displayName
    )
  );
  const summary = buildWorkspaceTaskSummary(task);

  if (isAssignee) {
    const shouldComplete = await showModal({
      title: "Task Summary",
      message: summary,
      confirmLabel: "Completed",
      cancelLabel: "Cancel",
      contentClass: "modal-content-task-summary"
    });
    if (!shouldComplete) return;
    updateWorkspaceTask(taskId, { status: "done" });
    renderStudio();
    return;
  }

  let nextAction = "edit";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "ghost-button btn-sm workspace-task-summary-delete";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    nextAction = "delete";
    document.getElementById("modalConfirmBtn")?.click();
  });
  summary.appendChild(deleteButton);
  const confirmed = await showModal({
    title: "Task Summary",
    message: summary,
    confirmLabel: "Edit",
    cancelLabel: "Cancel",
    contentClass: "modal-content-task-summary"
  });
  if (!confirmed) return;
  if (nextAction === "delete") {
    await deleteWorkspaceTask(taskId);
    renderStudio();
    return;
  }
  await editWorkspaceTaskFromLine(taskId);
}

async function deleteWorkspaceTask(taskId) {
  const confirmed = await customConfirm("Delete this task and its comments?", "Delete Task");
  if (!confirmed) return;
  clearAiTaskTimer(taskId);
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: (workspace.tasks || []).filter((task) => task.id !== taskId)
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
  showToast("Task deleted.", "success");
}

async function commentOnWorkspaceTask(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task) return;
  const workspaceProject = getWorkspaceLeadProject();
  const assignees = workspaceProject ? getWorkspaceTaskAssignees(workspaceProject).filter((entry) => entry.assigneeType === "human") : [];
  const container = document.createElement("div");
  container.className = "workspace-task-comments";
  container.innerHTML = `
    <div class="workspace-task-comment-list">
      ${task.comments?.length ? [...task.comments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map((comment) => `
        <article class="workspace-task-comment">
          <div class="workspace-task-comment-head">
            <strong>${escapeHtml(comment.author || "Workspace member")}</strong>
            <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
          </div>
          ${comment.mentionLabel ? `<span class="workspace-task-comment-mention">Mentioned ${escapeHtml(comment.mentionLabel)}</span>` : ""}
          <p>${escapeHtml(comment.text)}</p>
        </article>
      `).join("") : '<p class="workspace-home-empty">No task comments yet.</p>'}
    </div>
    <select id="workspaceTaskCommentMention" class="comment-filter-select">
      <option value="">Mention teammate (optional)</option>
      ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}">${escapeHtml(assignee.label)}</option>`).join("")}
    </select>
    <textarea id="workspaceTaskCommentText" class="collab-textarea" placeholder="Add a comment..."></textarea>
  `;
  const shouldAdd = await showModal({
    title: task.title,
    message: container,
    confirmLabel: "Add Comment"
  });
  if (!shouldAdd) return;
  const text = container.querySelector("#workspaceTaskCommentText")?.value?.trim();
  if (!text) return;
  const mentionId = container.querySelector("#workspaceTaskCommentMention")?.value || "";
  const mention = assignees.find((entry) => entry.id === mentionId);
  updateWorkspaceTask(taskId, {
    comments: [
      ...(task.comments || []),
      {
        id: uid("task-comment"),
        text,
        author: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member",
        mentionId,
        mentionLabel: mention?.label || "",
        createdAt: new Date().toISOString()
      }
    ]
  });
  createWorkspaceNotification({
    task,
    category: "comment",
    title: "New task comment",
    message: `${task.title} has a new comment.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  if (mention) {
    createWorkspaceNotification({
      task,
      category: "comment",
      title: "Task mention",
      message: `${task.title} mentioned ${mention.label}.`,
      actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
    });
  }
  showToast("Comment added to task.", "success");
}

export function bindEvents() {
  ensureWorkspaceClock();
  syncAiTaskSchedules();
  applyWorkspaceTaskTemplateToForm(refs.workspaceDashboard, "custom", { force: true });
  // Navigation
  refs.newProjectBtn.addEventListener("click", () => {
    launchNewCreationFlow();
  });

  refs.workspaceNewProjectBtn?.addEventListener("click", () => {
    createProjectInsideCurrentWorkspace();
  });

  refs.workspaceCloseBtn?.addEventListener("click", () => {
    state.currentWorkspaceId = null;
    persistProjects(false, { syncInputs: false });
    showHome();
    renderHome();
  });

  document.getElementById("workspaceRefreshBtn")?.addEventListener("click", async () => {
    if (!state.currentWorkspaceId) return;
    await openWorkspaceDashboard(state.currentWorkspaceId);
  });

  document.getElementById("workspaceLeaveBtn")?.addEventListener("click", async () => {
    const workspaceId = state.currentWorkspaceId;
    if (!workspaceId) return;
    const workspaceProject = getWorkspaceRootProject(workspaceId)
      || state.projects.find((project) => project.workspace?.id === workspaceId)
      || null;
    if (!workspaceProject) return;
    const confirmed = await customConfirm(
      `Leave "${workspaceProject.workspace?.name || workspaceProject.title}"? You will lose access to its projects until someone invites you back.`,
      "Leave Workspace"
    );
    if (!confirmed) return;
    const result = await leaveWorkspace(workspaceId);
    if (!result.ok) {
      await customAlert(result.reason || "Unable to leave the workspace right now.", "Leave Workspace");
      return;
    }
    showToast("You left the workspace.", "success");
    syncWorkspaceHeaderActions();
  });

  document.getElementById("workspaceDeleteBtn")?.addEventListener("click", async () => {
    const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId)
      || state.projects.find((project) => project.workspace?.id === state.currentWorkspaceId && project.isWorkspaceRoot)
      || null;
    if (!workspaceProject) return;
    await removeProject(workspaceProject.id);
    syncWorkspaceHeaderActions();
  });

  refs.workspaceView?.addEventListener("change", (event) => {
    const workspaceSwitch = event.target.closest("[data-workspace-switch]");
    if (!workspaceSwitch) return;
    openWorkspaceDashboard(workspaceSwitch.value);
  });

  window.addEventListener("sharedProjectUpdated", () => {
    if (!state.currentWorkspaceId) return;
    syncWorkspaceHeaderActions();
  });

  refs.homeWorkspaceDashboard?.addEventListener("click", (event) => {
    const filterTrigger = event.target.closest("[data-home-project-filter]");
    if (filterTrigger) {
      state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
      renderHome();
      return;
    }
    const action = event.target.closest("[data-workspace-home-action]")?.dataset.workspaceHomeAction;
    if (action === "new-project") {
      createProjectInsideCurrentWorkspace();
      return;
    }
    if (action === "continue-writing") {
      continueWorkspaceWriting();
      return;
    }
    if (action === "open-export") {
      void openWorkspaceExportFlow({ format: "pdf", exportType: "full" });
      return;
    }
    if (action === "focus-task-form") {
      focusWorkspaceTaskForm();
      return;
    }
    if (action === "add-task") {
      event.preventDefault();
      event.stopPropagation();
      addWorkspaceTaskFromDashboard(event.target);
      return;
    }
  });

  refs.homeWorkspaceDashboard?.addEventListener("change", (event) => {
    const formatSelect = event.target.closest("[data-home-project-format]");
    if (formatSelect) {
      state.homeProjectFormat = formatSelect.value || "all";
      renderHome();
      return;
    }
    const workspaceSelect = event.target.closest("[data-home-workspace-filter]");
    if (workspaceSelect) {
      state.homeWorkspaceFilter = workspaceSelect.value || "all";
      renderHome();
      return;
    }
    const sortSelect = event.target.closest("[data-home-project-sort]");
    if (!sortSelect) return;
    state.homeProjectSort = sortSelect.value || "latest";
    renderHome();
  });

  refs.homeProjectsSubtitle?.addEventListener("click", (event) => {
    const filterTrigger = event.target.closest("[data-home-project-filter]");
    if (!filterTrigger) return;
    state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
    renderHome();
  });

  refs.homeProjectsSubtitle?.addEventListener("change", (event) => {
    const formatSelect = event.target.closest("[data-home-project-format]");
    if (formatSelect) {
      state.homeProjectFormat = formatSelect.value || "all";
      renderHome();
      return;
    }
    const workspaceSelect = event.target.closest("[data-home-workspace-filter]");
    if (workspaceSelect) {
      state.homeWorkspaceFilter = workspaceSelect.value || "all";
      renderHome();
      return;
    }
    const sortSelect = event.target.closest("[data-home-project-sort]");
    if (!sortSelect) return;
    state.homeProjectSort = sortSelect.value || "latest";
    renderHome();
  });

  refs.workspaceDashboard?.addEventListener("click", (event) => {
    const profileTrigger = event.target.closest("[data-profile-uid]");
    if (profileTrigger) {
      showCollabProfile({
        uid: profileTrigger.dataset.profileUid || "",
        name: profileTrigger.dataset.profileName || "",
        photoURL: profileTrigger.dataset.profilePhotourl || ""
      });
      return;
    }
    const action = event.target.closest("[data-workspace-home-action]")?.dataset.workspaceHomeAction;
    if (!action) return;
    if (action === "new-project") {
      createProjectInsideCurrentWorkspace();
      return;
    }
    if (action === "continue-writing") {
      continueWorkspaceWriting();
      return;
    }
    if (action === "open-export") {
      void openWorkspaceExportFlow({ format: "pdf", exportType: "full" });
      return;
    }
    if (action === "focus-task-form") {
      focusWorkspaceTaskForm();
      return;
    }
    if (action === "open-popup") {
      showWorkspacePopup();
      return;
    }
    if (action === "open-notepad") {
      openNotepad();
      return;
    }
    if (action === "open-story-memory") {
      showStoryMemoryPopup();
      return;
    }
    if (action === "open-review-center") {
      showWorkspaceReviewCenter();
      return;
    }
    if (action === "add-task") {
      event.preventDefault();
      event.stopPropagation();
      addWorkspaceTaskFromDashboard(event.target);
      return;
    }
    if (action === "mark-notification-read") {
      const notificationId = event.target.closest("[data-notification-id]")?.dataset.notificationId;
      if (notificationId) markWorkspaceNotificationRead(notificationId, true);
      return;
    }
    if (action === "set-task-filter") {
      state.workspaceTaskFilter = event.target.closest("[data-task-filter]")?.dataset.taskFilter || "all";
      renderWorkspaceView();
      return;
    }
    if (action === "edit-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) editWorkspaceTask(taskId);
      return;
    }
    if (action === "delete-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) deleteWorkspaceTask(taskId);
      return;
    }
    if (action === "comment-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) commentOnWorkspaceTask(taskId);
      return;
    }
    if (action === "open-task-project") {
      const trigger = event.target.closest("[data-task-project-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const taskId = trigger?.dataset.taskId;
      const task = taskId ? getWorkspaceTaskById(taskId) : null;
      openProjectOrNotify(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      return;
    }
    if (action === "open-task-memory") {
      const trigger = event.target.closest("[data-memory-project-id]");
      const projectId = trigger?.dataset.memoryProjectId;
      const opened = openProjectOrNotify(projectId);
      if (!opened) return;
      setTimeout(() => {
        showStoryMemoryPopup();
      }, 60);
      return;
    }
    if (action === "open-notification") {
      const trigger = event.target.closest("[data-notification-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const notificationId = trigger?.dataset.notificationId;
      if (notificationId && !notificationId.startsWith("due-")) markWorkspaceNotificationRead(notificationId, true);
      if (projectId) {
        const notification = getWorkspaceNotifications().find((item) => item.id === notificationId);
        const task = notification?.taskId
          ? getWorkspaceTaskById(notification.taskId)
          : (trigger?.dataset.taskId ? getWorkspaceTaskById(trigger.dataset.taskId) : null);
        openProjectOrNotify(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      } else {
        showToast("This notification is no longer linked to a project.", "error", { duration: 4200 });
      }
      return;
    }
    if (action === "run-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) runAiTask(taskId);
      return;
    }
    if (action === "review-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) reviewAiTaskResult(taskId);
      return;
    }
    if (action === "apply-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) applyAiTaskResult(taskId);
      return;
    }
    if (action === "dismiss-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) dismissAiTaskResult(taskId);
      return;
    }
  });

  document.getElementById("studioInboxBellBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    const popup = document.getElementById("workspace-inbox-popup");
    if (popup?.classList.contains("active")) {
      closeWorkspaceInboxPopup();
      return;
    }
    openWorkspaceInboxPopup(event.currentTarget);
  });

  document.getElementById("homeInboxBellBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    const popup = document.getElementById("workspace-inbox-popup");
    if (popup?.classList.contains("active")) {
      closeWorkspaceInboxPopup();
      return;
    }
    openWorkspaceInboxPopup(event.currentTarget);
  });

  document.getElementById("close-workspace-inbox")?.addEventListener("click", () => {
    closeWorkspaceInboxPopup();
  });

  document.getElementById("clear-workspace-inbox")?.addEventListener("click", () => {
    clearWorkspaceInboxItems();
  });

  document.getElementById("workspace-inbox-popup")?.addEventListener("click", (event) => {
    const inboxAction = event.target.closest("[data-workspace-inbox-action]")?.dataset.workspaceInboxAction;
    if (!inboxAction) return;
    if (inboxAction === "dismiss-item") {
      event.preventDefault();
      event.stopPropagation();
      const itemId = event.target.closest("[data-workspace-inbox-item-id]")?.dataset.workspaceInboxItemId;
      dismissWorkspaceInboxItem(itemId);
      return;
    }
    if (inboxAction === "open-invites") {
      closeWorkspaceInboxPopup();
      showHome();
      renderHome();
      closeMenus();
      const trigger = document.querySelector('[data-menu-trigger="homeCollabMenu"]');
      const menu = document.getElementById("homeCollabMenu");
      trigger?.classList.add("is-open");
      if (menu) menu.hidden = false;
      return;
    }
    if (inboxAction === "open-comment") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) {
        closeWorkspaceInboxPopup();
        const trigger = event.target.closest("[data-task-project-id]");
        const projectId = trigger?.dataset.taskProjectId;
        const task = taskId ? getWorkspaceTaskById(taskId) : null;
        const opened = openProjectOrNotify(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
        if (opened) {
          setTimeout(() => {
            commentOnWorkspaceTask(taskId);
          }, 90);
        }
      }
      return;
    }
    if (inboxAction === "open-task") {
      const trigger = event.target.closest("[data-task-project-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const taskId = trigger?.dataset.taskId;
      const task = taskId ? getWorkspaceTaskById(taskId) : null;
      closeWorkspaceInboxPopup();
      openProjectOrNotify(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      return;
    }
  });

  document.addEventListener("click", (event) => {
    const popup = document.getElementById("workspace-inbox-popup");
    if (!popup?.classList.contains("active")) return;
    const clickedBell = event.target.closest("#homeInboxBellBtn");
    const clickedPopup = event.target.closest(".workspace-inbox-popup-card");
    if (clickedBell || clickedPopup) return;
    closeWorkspaceInboxPopup();
  });

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-workspace-home-action='add-task']");
    if (!trigger) return;
    event.preventDefault();
    addWorkspaceTaskFromDashboard(trigger);
  });

  refs.workspaceDashboard?.addEventListener("change", (event) => {
    const taskFormField = event.target.closest("[data-workspace-task-project], [data-workspace-task-scene], [data-workspace-task-line], [data-workspace-task-assignee], [data-workspace-task-template], [data-workspace-task-ai-start]");
    if (taskFormField) {
      const taskForm = taskFormField.closest(".workspace-task-form");
      if (taskForm) {
        syncWorkspaceTaskDraftFromContainer(taskForm);
      }
    }
    const inboxFilterSelect = event.target.closest("[data-workspace-home-action='set-inbox-filter']");
    if (inboxFilterSelect) {
      state.workspaceInboxFilter = inboxFilterSelect.value || "all";
      renderWorkspaceView();
      return;
    }
    const notificationFilterSelect = event.target.closest("[data-workspace-home-action='set-notification-filter']");
    if (notificationFilterSelect) {
      state.workspaceNotificationFilter = notificationFilterSelect.value || "all";
      renderWorkspaceView();
      return;
    }
    const storyMemoryFilterSelect = event.target.closest("[data-workspace-home-action='set-story-memory-filter']");
    if (storyMemoryFilterSelect) {
      state.workspaceStoryMemoryFilter = storyMemoryFilterSelect.value || "all";
      renderWorkspaceView();
      return;
    }
    const completedFilterSelect = event.target.closest("[data-workspace-home-action='set-completed-filter']");
    if (completedFilterSelect) {
      state.workspaceCompletedFilter = completedFilterSelect.value || "all";
      renderWorkspaceView();
      return;
    }
    const templateSelect = event.target.closest("[data-workspace-task-template]");
    if (templateSelect) {
      applyWorkspaceTaskTemplateToForm(templateSelect.closest(".workspace-task-composer, .workspace-home-panel, .workspace-task-form") || refs.workspaceDashboard, templateSelect.value);
      return;
    }
    const taskSortSelect = event.target.closest("[data-workspace-home-action='set-task-sort']");
    if (taskSortSelect) {
      state.workspaceTaskSort = taskSortSelect.value || "latest";
      renderWorkspaceView();
      return;
    }
    const statusSelect = event.target.closest("[data-workspace-task-status]");
    if (statusSelect) {
      updateWorkspaceTask(statusSelect.dataset.workspaceTaskStatus, { status: statusSelect.value });
    }
  });

  refs.workspaceDashboard?.addEventListener("input", (event) => {
    const taskFormField = event.target.closest("[data-workspace-task-title], [data-workspace-task-description], [data-workspace-task-project], [data-workspace-task-scene], [data-workspace-task-line], [data-workspace-task-assignee], [data-workspace-task-template], [data-workspace-task-ai-start]");
    if (!taskFormField) return;
    const taskForm = taskFormField.closest(".workspace-task-form");
    if (!taskForm) return;
    syncWorkspaceTaskDraftFromContainer(taskForm);
  });

  refs.workspaceDashboard?.addEventListener("focusout", () => {
    window.setTimeout(() => {
      flushPendingWorkspaceRefresh();
    }, 0);
  });

  refs.goHomeBtn.addEventListener("click", () => {
    saveAndGoHome();
  });

  document.getElementById("addStoryElementBtn")?.addEventListener("click", () => {
    showStoryMemoryBuilder();
  });

  document.getElementById("smartProofreadBtn")?.addEventListener("click", () => {
    AI.triggerSmartProofread();
  });
  refs.screenplayEditor?.addEventListener("focusin", (event) => {
    const block = event.target.closest?.(".script-block");
    if (!block?.dataset?.id) return;
    noteRealtimeActivity(block.dataset.id, { isTyping: false });
  });
  document.addEventListener("selectionchange", () => {
    window.requestAnimationFrame(updateSelectionToolbar);
  });
  window.addEventListener("resize", hideSelectionToolbar);
  refs.screenplayEditor?.addEventListener("scroll", hideSelectionToolbar);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWorkspaceInboxPopup();
    }
  });

  // Meta Inputs
  [refs.titleInput, refs.subtitleInput, refs.authorInput, refs.coWritersInput, refs.contactInput, refs.companyInput, refs.coverVersionInput, refs.draftDateInput, refs.detailsInput, refs.copyrightInput, refs.loglineInput]
    .forEach((input) => input.addEventListener("input", handleMetaInput));

  // Tool Selection
  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => handleToolSelection(button.dataset.insert));
  });

  // Menus and Themes
  refs.menuTriggers.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu(button.dataset.menuTrigger);
    });
    button.addEventListener("mouseenter", () => {
      if (window.innerWidth > 900) {
        toggleMenu(button.dataset.menuTrigger, true);
      }
    });
  });

  document.querySelectorAll(".nav-menu").forEach((menu) => {
    menu.addEventListener("mouseleave", () => {
      if (window.innerWidth > 900) {
        closeMenus();
      }
    });
    menu.addEventListener("mouseenter", (e) => {
      if (window.innerWidth <= 900 || !menu.classList.contains("nav-menu-flyout")) return;
      const summary = e.target.closest(".menu-group-summary");
      const details = summary?.closest("details.menu-group");
      if (!details) return;
      menu.querySelectorAll("details.menu-group[open]").forEach((group) => {
        if (group !== details) group.removeAttribute("open");
      });
      details.setAttribute("open", "");
    }, true);
    // Accordion behavior for menu groups
    menu.addEventListener("click", (e) => {
      const summary = e.target.closest(".menu-group-summary");
      if (summary) {
        const details = summary.closest("details.menu-group");
        if (!details) return;
        if (!details.open) {
          menu.querySelectorAll(".menu-group[open]").forEach((group) => {
            if (group !== details) group.removeAttribute("open");
          });
        }
      }
    });
  });

  refs.themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeValue));
  });

  refs.languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLanguage(button.dataset.languageValue);
      renderHome();
      if (!refs.studioView.hidden) {
        renderStudio();
      }
      persistProjects(false);
      closeMenus();
    });
  });

  refs.writingLanguageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setWritingLanguage(button.dataset.writingLanguageValue);
      primeSpellingDictionary();
      persistProjects(false);
      closeMenus();
    });
  });

  refs.localBackupToggle?.addEventListener("change", () => {
    toggleLocalBackup(refs.localBackupToggle.checked);
  });
  refs.localSaveInterval?.addEventListener("change", () => {
    const value = parseInt(refs.localSaveInterval.value, 10);
    state.localSaveIntervalMinutes = [5, 10, 60].includes(value) ? value : 5;
    persistProjects(false);
    if (state.localBackupEnabled && state.localSaveFileHandle) {
      startLocalSaveTimer();
    }
  });
  refs.chooseLocalSaveFileBtn?.addEventListener("click", async () => {
    const result = await chooseLocalSaveFile();
    if (result.ok) {
      startLocalSaveTimer();
    } else if (result.reason === "unsupported") {
      customAlert("Local save requires a Chromium-based browser (Chrome, Edge, Opera).");
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleMenuAction(button.dataset.menuAction);
  }, true);

  document.getElementById("fileRecoveryCloseBtn")?.addEventListener("click", closeFileRecoveryDialog);
  document.getElementById("fileRecoveryDialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "fileRecoveryDialog") {
      closeFileRecoveryDialog();
    }
  });
  document.getElementById("conversionJobsCloseBtn")?.addEventListener("click", closeConversionJobsDialog);
  document.getElementById("conversionJobsDialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "conversionJobsDialog") {
      closeConversionJobsDialog();
    }
  });
  document.getElementById("conversionJobsList")?.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-conversion-job-id]");
    if (!item) return;
    const jobId = item.dataset.conversionJobId;
    if (!jobId) return;
    closeConversionJobsDialog();
    const record = await getConversionJobRecord(jobId);
    await openConversionReviewDialog(jobId, record?.projectId || "");
  });
  document.getElementById("conversionLiveCloseBtn")?.addEventListener("click", closeConversionLiveDialog);
  document.getElementById("conversionLiveDialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "conversionLiveDialog") {
      closeConversionLiveDialog();
    }
  });
  document.getElementById("conversionLiveSaveGuidanceBtn")?.addEventListener("click", async () => {
    if (!activeConversionLiveJobId) return;
    const input = document.getElementById("conversionLiveGuidance");
    const status = document.getElementById("conversionLiveGuidanceStatus");
    const guidance = String(input?.value || "").trim();
    await patchConversionJobRecord(activeConversionLiveJobId, {
      operatorGuidance: guidance,
      updatedAt: new Date().toISOString()
    });
    if (status) {
      status.textContent = guidance
        ? "Guidance saved. The next retry will send it into the AI conversion pass."
        : "Guidance cleared for this job.";
    }
  });
  document.getElementById("conversionLiveSaveTextBtn")?.addEventListener("click", async () => {
    if (!activeConversionLiveJobId) return;
    const rawInput = document.getElementById("conversionLiveRaw");
    const normalizedInput = document.getElementById("conversionLiveNormalized");
    const status = document.getElementById("conversionLiveTextStatus");
    const coverPageCandidate = {
      title: String(document.getElementById("conversionLiveCoverTitle")?.value || "").trim(),
      author: String(document.getElementById("conversionLiveCoverAuthor")?.value || "").trim(),
      contact: String(document.getElementById("conversionLiveCoverContact")?.value || "").trim(),
      company: String(document.getElementById("conversionLiveCoverCompany")?.value || "").trim(),
      details: String(document.getElementById("conversionLiveCoverDetails")?.value || "").trim(),
      logline: String(document.getElementById("conversionLiveCoverLogline")?.value || "").trim()
    };
    const patch = {
      rawText: String(rawInput?.value || ""),
      normalizedText: String(normalizedInput?.value || ""),
      coverPageCandidate: Object.values(coverPageCandidate).some(Boolean) ? coverPageCandidate : null
    };
    if (patch.rawText.trim()) {
      patch.rawTextEditedAt = new Date().toISOString();
    }
    if (patch.normalizedText.trim()) {
      patch.normalizedTextEditedAt = new Date().toISOString();
    }
    const previewSource = patch.normalizedText.trim() || patch.rawText.trim();
    patch.structuredLines = buildLocalStructuredPreview(previewSource);
    patch.structuredLineCount = patch.structuredLines.length;
    if (!patch.stageLabel || /queued|normalizing|structuring/i.test(String(patch.stageLabel))) {
      patch.stageLabel = patch.structuredLines.length
        ? "Preview refreshed from your edits"
        : "Text edits saved";
    }
    conversionWorkspaceOverrides.set(activeConversionLiveJobId, patch);
    await patchConversionJobRecord(activeConversionLiveJobId, patch);
    await refreshActiveConversionLiveDialog(activeConversionLiveJobId, {
      ...(await getConversionJobRecord(activeConversionLiveJobId)),
      ...patch
    });
    if (status) {
      status.textContent = patch.structuredLines.length
        ? "Text edits saved. The structured preview updated immediately from your corrected text."
        : "Text edits saved. Add more text or retry this conversion to rebuild the preview.";
    }
  });
  document.getElementById("conversionLiveApplyBtn")?.addEventListener("click", async () => {
    if (!activeConversionLiveJobId) return;
    const record = await getConversionJobRecord(activeConversionLiveJobId);
    if (!record) return;
    await applyConversionRecordToProject(record, activeConversionLiveProjectId, "Reviewed preview applied to this script.");
  });
  document.getElementById("conversionLiveOpenReviewBtn")?.addEventListener("click", async () => {
    if (!activeConversionLiveJobId) return;
    const jobId = activeConversionLiveJobId;
    const projectId = activeConversionLiveProjectId;
    closeConversionLiveDialog();
    await openConversionReviewDialog(jobId, projectId);
  });
  window.addEventListener("eyawriter:conversion-job-updated", async (event) => {
    const jobId = event?.detail?.jobId;
    const record = event?.detail?.record || null;
    if (!jobId || jobId !== activeConversionLiveJobId) return;
    await refreshActiveConversionLiveDialog(jobId, record);
  });
  document.getElementById("fileRecoveryList")?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-recovery-action]");
    const item = event.target.closest("[data-recovery-id]");
    if (!actionButton || !item) return;

    const recoveryId = item.dataset.recoveryId;
    if (actionButton.dataset.recoveryAction === "recover") {
      const restoredProject = await recoverDeletedProject(recoveryId);
      if (restoredProject) {
        renderRecoveryList();
        renderHome();
        if (!refs.studioView.hidden) {
          renderStudio();
        }
        showToast(`Recovered "${restoredProject.title}".`, "success");
      }
      return;
    }

    if (actionButton.dataset.recoveryAction === "permanent-delete") {
      const confirmed = await customConfirm(
        "Permanently delete this file from recovery? This cannot be undone.",
        "Permanent Delete"
      );
      if (!confirmed) return;
      if (permanentlyDeleteRecoveredProject(recoveryId)) {
        renderRecoveryList();
        showToast("File permanently deleted.", "success");
      }
    }
  });

  document.querySelectorAll("[data-format-type]").forEach((button) => {
    button.addEventListener("click", () => {
      handleToolSelection(button.dataset.formatType);
      closeMenus();
    });
  });

  // View Options
  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
        const optionKey = button.dataset.viewToggle;
        state.viewOptions[optionKey] = !state.viewOptions[optionKey];
        applyViewState();
        renderPreview();
        queueSave();
    });
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.addEventListener("click", () => {
        state.viewOptions.textSize = parseInt(button.dataset.textSize);
        applyViewState();
        queueSave();
        closeMenus();
    });
  });

  // Project Actions
  refs.saveBtn.addEventListener("click", () => persistProjects(true));
  refs.exportScreenplayBtn.addEventListener("click", () => {
    if (!ensureExportProjectContext()) return;
    openExportDialog({ format: "pdf", exportType: "full" });
  });
  document.getElementById("openReportBtn")?.addEventListener("click", () => {
    if (!ensureExportProjectContext()) return;
    openReportDialog();
  });
  refs.exportTxtBtn.addEventListener("click", exportTxt);
  refs.exportJsonBtn.addEventListener("click", exportJson);
  refs.fileInput.addEventListener("change", importFile);
  refs.convertImportInput?.addEventListener("change", convertImportFile);
  document.getElementById("exportDialogCloseBtn")?.addEventListener("click", closeExportDialog);
  document.getElementById("exportDialogGenerateBtn")?.addEventListener("click", () => {
    void generateExportFromDialog();
  });
  document.getElementById("exportDialogGenerateInlineBtn")?.addEventListener("click", () => {
    void generateExportFromDialog();
  });
  document.getElementById("exportReportStopBtn")?.addEventListener("click", () => {
    stopReportGeneration();
    updateExportDialogState();
  });
  document.getElementById("exportDialogExportBtn")?.addEventListener("click", () => {
    void exportReportFromDialog();
  });
  document.getElementById("exportReportEditBtn")?.addEventListener("click", () => {
    setReportEditing(true);
    showToast("Report editing enabled.", "success", { duration: 1800 });
  });
  document.getElementById("exportReportLoadBtn")?.addEventListener("click", () => {
    openReportDraftLoadDialog();
  });
  document.getElementById("exportReportMergeBtn")?.addEventListener("click", () => {
    openReportDraftMergeDialog();
  });
  document.getElementById("exportReportSaveBtn")?.addEventListener("click", () => {
    saveReportDraftFromLiveOutput();
    setReportEditing(false);
    updateExportDialogState();
    showToast("Report draft saved.", "success", { duration: 1800 });
  });
  document.getElementById("exportPreviewRefreshBtn")?.addEventListener("click", () => {
    void refreshExportPreview(true);
  });
  document.getElementById("exportPreviewOpenBtn")?.addEventListener("click", () => {
    void downloadExportFromPreview();
  });
  document.getElementById("reportDraftLoadCloseBtn")?.addEventListener("click", () => {
    closeReportDraftLoadDialog();
  });
  document.getElementById("reportDraftLoadApplyBtn")?.addEventListener("click", () => {
    loadSelectedReportDraft();
  });
  document.getElementById("reportDraftMergeCloseBtn")?.addEventListener("click", () => {
    closeReportDraftMergeDialog();
  });
  document.getElementById("reportDraftMergeApplyBtn")?.addEventListener("click", () => {
    mergeSelectedReportDraft();
  });
  document.getElementById("exportPresetSaveBtn")?.addEventListener("click", () => {
    void saveCurrentExportPreset();
  });
  document.getElementById("exportPresetApplyBtn")?.addEventListener("click", () => {
    void applySelectedExportPreset();
  });
  document.getElementById("exportPresetDeleteBtn")?.addEventListener("click", () => {
    void deleteSelectedExportPreset();
  });
  document.getElementById("exportPresetSelect")?.addEventListener("change", () => {
    renderExportPresetOptions(getCurrentProject());
  });
  document.getElementById("exportDialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "exportDialog") {
      closeExportDialog();
      return;
    }
    const actionButton = event.target?.closest?.("[data-export-history-action]");
    if (!actionButton) return;
    const item = actionButton.closest("[data-export-history-id]");
    const project = getCurrentProject();
    const entry = getStoredExportHistoryEntry(project, item?.dataset?.exportHistoryId || "");
    if (!entry || !project) return;
    const action = actionButton.dataset.exportHistoryAction;
    if (action === "delete") {
      project.exportHistory = (project.exportHistory || []).filter((candidate) => candidate.id !== entry.id);
      persistProjects(false, { syncInputs: false });
      renderExportCenter(project);
      return;
    }
    if (action === "view") {
      const detail = [
        `Type: ${getExportTypeLabel(entry.exportType)}`,
        `Format: ${String(entry.format || "").toUpperCase()}`,
        `Saved: ${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Unknown"}`,
        `User: ${entry.user || "Current user"}`,
        `Summary: ${entry.summary || "Saved export settings"}`
      ].join("\n");
      customAlert(detail, "Export Settings");
      return;
    }
    if (action === "download") {
      void rerunStoredExportHistory(entry);
    }
  });
  document.getElementById("exportDialog")?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("#exportTypeSelect, #exportFormatSelect, #exportModeSelect, #exportLocationSelect, #exportRevisionVersionA, #exportRevisionVersionB, #exportProductionLocationSelect, #exportProductionTimeSelect, #exportCollaborativeWriterSelect, #exportCollaborativeReviewerSelect, #exportCollaborativeEditorSelect, #exportCollaborativeStatusSelect, #exportWatermarkPreset, #exportWatermarkPosition, #exportWatermarkOpacity, #exportEnableWatermarkSettings, input[name='exportCharacterName'], input[name='exportSceneId'], input[name='exportProductionCharacterName'], #exportIncludeNotes, #exportIncludeComments, #exportIncludeSceneNumbers, #exportIncludeMetadata, #exportIncludeTitlePage, #exportIncludeSceneDescriptions, #exportIncludePageNumbers, #exportIncludeRevisions, #exportBreakdownCharacters, #exportBreakdownLocations, #exportBreakdownScenes")) {
      updateExportDialogState();
    }
  });
  document.getElementById("exportDialog")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("#exportCoverTitle, #exportCoverSubtitle, #exportCoverAuthor, #exportCoverCoWriters, #exportCoverContact, #exportCoverCompany, #exportCoverVersion, #exportCoverDraftDate, #exportCoverDetails, #exportCoverCopyright")) {
      syncProjectCoverFromExportInputs();
    }
    if (target.matches("#exportTypeSelect, #exportFormatSelect, #exportModeSelect, #exportLocationSelect, #exportRevisionVersionA, #exportRevisionVersionB, #exportProductionLocationSelect, #exportProductionTimeSelect, #exportCollaborativeWriterSelect, #exportCollaborativeReviewerSelect, #exportCollaborativeEditorSelect, #exportCollaborativeStatusSelect, #exportWatermarkPreset, #exportWatermarkPosition, #exportWatermarkOpacity, #exportEnableWatermarkSettings, #exportSceneRangeStart, #exportSceneRangeEnd, #exportProductionRangeStart, #exportProductionRangeEnd, #exportWatermarkText, #exportCoverTitle, #exportCoverSubtitle, #exportCoverAuthor, #exportCoverCoWriters, #exportCoverContact, #exportCoverCompany, #exportCoverVersion, #exportCoverDraftDate, #exportCoverDetails, #exportCoverCopyright, #exportBreakdownPrompt, #exportBreakdownCharactersMin, #exportBreakdownCharactersMax, #exportBreakdownLocationsMin, #exportBreakdownLocationsMax, #exportBreakdownScenesMin, #exportBreakdownScenesMax")) {
      updateExportDialogState();
    }
  });
  document.getElementById("exportDialog")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("#exportEnableWatermarkSettings")) {
      requestAnimationFrame(() => updateExportDialogState());
      return;
    }
    if (target.closest("#exportCoverPageCollapseBtn")) {
      exportCoverPageBuilderCollapsed = !exportCoverPageBuilderCollapsed;
      updateExportDialogState();
      return;
    }
    if (target.closest("#exportHistoryCollapseBtn")) {
      exportHistoryCollapsed = !exportHistoryCollapsed;
      updateExportDialogState();
    }
  });
  document.querySelectorAll("#exportTypeSelect, #exportFormatSelect, #exportModeSelect, #exportLocationSelect, #exportRevisionVersionA, #exportRevisionVersionB, #exportProductionLocationSelect, #exportProductionTimeSelect, #exportCollaborativeWriterSelect, #exportCollaborativeReviewerSelect, #exportCollaborativeEditorSelect, #exportCollaborativeStatusSelect, input[name='exportCharacterName'], input[name='exportSceneId'], input[name='exportProductionCharacterName'], #exportSceneRangeStart, #exportSceneRangeEnd, #exportProductionRangeStart, #exportProductionRangeEnd, #exportIncludeNotes, #exportIncludeComments, #exportIncludeSceneNumbers, #exportIncludeMetadata, #exportIncludeTitlePage, #exportIncludeSceneDescriptions, #exportEnableWatermarkSettings, #exportWatermarkPreset, #exportWatermarkPosition, #exportWatermarkOpacity, #exportCoverTitle, #exportCoverSubtitle, #exportCoverAuthor, #exportCoverCoWriters, #exportCoverContact, #exportCoverCompany, #exportCoverVersion, #exportCoverDraftDate, #exportCoverDetails, #exportCoverCopyright, #exportBreakdownCharacters, #exportBreakdownLocations, #exportBreakdownScenes, #exportBreakdownPrompt, #exportBreakdownCharactersMin, #exportBreakdownCharactersMax, #exportBreakdownLocationsMin, #exportBreakdownLocationsMax, #exportBreakdownScenesMin, #exportBreakdownScenesMax").forEach((element) => {
    element.addEventListener("change", updateExportDialogState);
    if (element instanceof HTMLInputElement && element.type === "number") {
      element.addEventListener("input", updateExportDialogState);
    }
  });

  refs.autoNumberToggle.addEventListener("change", () => {
    state.autoNumberScenes = refs.autoNumberToggle.checked;
    renderStudio();
    queueSave();
  });

  const syncBgAnim = (enabled) => {
    state.backgroundAnimation = enabled;
    if (refs.bgAnimationToggle) refs.bgAnimationToggle.checked = enabled;
    if (refs.bgAnimationLandingToggle) refs.bgAnimationLandingToggle.checked = enabled;
    applyToolbarState();
    persistProjects(false);
  };

  refs.bgAnimationToggle?.addEventListener("change", () => {
    syncBgAnim(refs.bgAnimationToggle.checked);
  });

  refs.bgAnimationLandingToggle?.addEventListener("change", () => {
    syncBgAnim(refs.bgAnimationLandingToggle.checked);
  });

  refs.aiAssistToggle.addEventListener("change", () => {
    state.aiAssist = refs.aiAssistToggle.checked;
    refs.aiPanel.hidden = !state.aiAssist;
    applyToolbarState();
    queueSave();
    updateSelectionToolbar();
  });

  refs.grammarCheckToggle.addEventListener("change", () => {
    setGrammarCheck(refs.grammarCheckToggle.checked);
    queueSave();
    updateSelectionToolbar();
  });

  refs.aiSuggestBtn.addEventListener("click", insertAiAssistNote);

  // Layout Toggles
  refs.leftRailToggle?.addEventListener("click", () => {
    togglePane("left");
    setButtonGlyph(refs.leftRailToggle, refs.leftPane.classList.contains("is-hidden") ? "&#9654;" : "&#9664;");
  });
  refs.rightRailToggle?.addEventListener("click", () => {
    togglePane("right");
    setButtonGlyph(refs.rightRailToggle, refs.rightPane.classList.contains("is-hidden") ? "&#9664;" : "&#9654;");
  });
  refs.toolStripToggle.addEventListener("click", () => {
        state.toolStripCollapsed = !state.toolStripCollapsed;
        applyToolbarState();
        setButtonGlyph(refs.toolStripToggle, state.toolStripCollapsed ? "&#9660;" : "&#9650;");
        persistProjects(false);
    });

  refs.quickDisplayBg?.addEventListener("change", () => {
    state.backgroundAnimation = refs.quickDisplayBg.checked;
    applyToolbarState();
    persistProjects(false);
  });
  refs.quickDisplayActiveBlock?.addEventListener("change", () => {
    const shouldShow = refs.quickDisplayActiveBlock.checked;
    refs.leftPane.classList.toggle("is-hidden", !shouldShow);
    refs.leftResize?.classList.toggle("is-hidden", !shouldShow);
    refs.studioLayout.classList.toggle("left-pane-hidden", !shouldShow);
    applyViewState();
    persistProjects(false);
  });
  refs.quickDisplayPreview?.addEventListener("change", () => {
    const shouldShow = refs.quickDisplayPreview.checked;
    refs.rightPane.classList.toggle("is-hidden", !shouldShow);
    refs.rightResize?.classList.toggle("is-hidden", !shouldShow);
    refs.studioLayout.classList.toggle("right-pane-hidden", !shouldShow);
    applyViewState();
    persistProjects(false);
  });
  document.querySelectorAll("[data-mobile-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      setMobileStudioPane(button.dataset.mobilePane);
    });
  });
  refs.quickDisplayFocusMode?.addEventListener("change", () => {
    state.viewOptions.focusMode = refs.quickDisplayFocusMode.checked;
    if (!state.viewOptions.focusMode) {
      clearTimeout(focusModeTimer);
      document.body.classList.remove("focus-mode-active");
    }
    applyViewState();
    persistProjects(false);
  });
  refs.quickDisplayFullscreen?.addEventListener("change", () => {
    if (refs.quickDisplayFullscreen.checked) {
      document.documentElement.requestFullscreen?.();
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    applyViewState();
  });

  refs.leftPaneSectionToggle.addEventListener("click", () => {
    togglePaneSection(refs.leftPaneBody, refs.leftPaneSectionToggle);
    setButtonGlyph(refs.leftPaneSectionToggle, refs.leftPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  });
  refs.rightPaneSectionToggle.addEventListener("click", () => {
    togglePaneSection(refs.rightPaneBody, refs.rightPaneSectionToggle);
    setButtonGlyph(refs.rightPaneSectionToggle, refs.rightPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  });

  refs.leftPaneBody.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-left-pane-section-toggle]");
    if (toggle) {
      toggleLeftPaneSection(toggle.dataset.leftPaneSectionToggle);
    }
  });

  refs.leftPaneBlockControls?.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-left-pane-move]");
    if (moveBtn) {
      moveLeftPaneBlock(moveBtn.dataset.leftPaneKey, moveBtn.dataset.leftPaneMove);
    }
  });

  refs.leftPaneBlockControls?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-left-pane-visibility]");
    if (checkbox) {
      setLeftPaneBlockVisibility(checkbox.dataset.leftPaneVisibility, checkbox.checked);
    }
  });

  window.addEventListener("workspaceInviteRequested", async (event) => {
    const projectId = event.detail?.projectId || "";
    const email = event.detail?.email;
    const role = event.detail?.role || "editor";
    if (!email) {
      return;
    }
    const result = await inviteCollaborator(email, role, projectId);
    window.dispatchEvent(new CustomEvent("workspaceInviteResult", { detail: result }));
    if (result?.ok) {
      showToast("Workspace invite sent.", "success");
    } else if (result?.reason) {
      showToast(result.reason, "error");
    }
  });

  window.addEventListener("workspaceRenameRequested", async (event) => {
    const result = await renameWorkspace(event.detail?.projectId, event.detail?.name);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Workspace name saved." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceRoleChangeRequested", async (event) => {
    const result = await updateCollaboratorRole(event.detail?.projectId, event.detail?.collaboratorUid, event.detail?.role);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Member role updated." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceMemberRemoveRequested", async (event) => {
    const project = state.projects.find((item) => item.id === event.detail?.projectId);
    const collaborator = project?.collaborators?.[event.detail?.collaboratorUid];
    if (!project || !collaborator) {
      return;
    }
    const confirmed = await customConfirm(
      `Remove ${collaborator.name || collaborator.email || "this collaborator"} from "${project.title}"?`,
      "Remove Collaborator"
    );
    if (!confirmed) {
      return;
    }
    await kickCollaborator(event.detail?.projectId, event.detail?.collaboratorUid);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ok: true, message: "Collaborator removed." }
    }));
    showToast("Collaborator removed.", "success");
    renderStudio();
  });

  window.addEventListener("workspaceReminderRequested", async (event) => {
    const result = await addWorkspaceReminder(event.detail?.projectId, {
      text: event.detail?.text,
      dueAt: event.detail?.dueAt
    });
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder added." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceReminderToggleRequested", async (event) => {
    const result = await toggleWorkspaceReminder(event.detail?.projectId, event.detail?.reminderId);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder updated." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceReminderDeleteRequested", async (event) => {
    const result = await deleteWorkspaceReminder(event.detail?.projectId, event.detail?.reminderId);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder deleted." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceMemberProfileRequested", (event) => {
    showCollabProfile({
      uid: event.detail?.uid || "",
      name: event.detail?.name || "",
      email: event.detail?.email || "",
      photoURL: event.detail?.photoURL || ""
    });
  });

  refs.duplicateProjectBtn.addEventListener("click", duplicateProject);
  refs.deleteProjectBtn.addEventListener("click", deleteProject);

  initResizeHandle(refs.leftResize, "left");
  initResizeHandle(refs.rightResize, "right");

  refs.helpBtn.addEventListener("click", () => refs.helpDialog.showModal());
  document.querySelectorAll('[data-home-nav="shortcuts"]').forEach(btn => {
      btn.addEventListener("click", () => refs.helpDialog.showModal());
  });

  // Global Keys & Clicks
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-stack")) {
        closeMenus();
      }
      if (!event.target.closest("#suggestionTray") && !event.target.closest(".script-block")) {
        hideSuggestionTray(true);
        clearSuggestionContext();
      }
  });

  // Delegated Editor Events
  refs.screenplayEditor.addEventListener("focusin", (e) => {
      if (e.target.classList.contains("script-block")) {
          setActiveBlock(e.target.dataset.id);
      }
  });

  refs.screenplayEditor.addEventListener("click", async (e) => {
    const taskMarker = e.target.closest("[data-script-task-target]");
    if (taskMarker) {
      const [firstTaskId] = String(taskMarker.dataset.taskIds || "").split(",").filter(Boolean);
      if (firstTaskId) {
        const project = getCurrentProject();
        if (project?.workspace?.id) {
          state.currentWorkspaceId = project.workspace.id;
        }
        await showWorkspaceTaskFlagSummary(firstTaskId);
      }
      return;
    }
    const block = e.target.closest(".script-block");
    if (block) {
        setActiveBlock(block.dataset.id);
        await maybeShowSpellingSuggestions(block, e.target, e.clientX, e.clientY);
    }
    if (e.target.closest(".scene-toggle")) {
        const row = e.target.closest(".script-block-row");
        toggleSceneCollapse(row.dataset.id);
    }
  });

  refs.screenplayEditor.addEventListener("input", (e) => {
      if (e.target.classList.contains("script-block")) {
          handleBlockInput(e.target.dataset.id, e.target);
      }
  });

  refs.screenplayEditor.addEventListener("keydown", (e) => {
      if (e.target.classList.contains("script-block")) {
          handleBlockKeydown(e, e.target.dataset.id);
      }
  });

  refs.screenplayEditor.addEventListener("contextmenu", (e) => {
    const target = e.target.nodeType === Node.TEXT_NODE ? e.target.parentElement : e.target;
    const block = target?.closest?.(".script-block");
    if (block?.dataset?.id) {
      setActiveBlock(block.dataset.id);
    }
    e.preventDefault();
    e.stopPropagation();
    ContextMenu.show(e.clientX, e.clientY, block || getActiveEditableBlock());
  });

  refs.screenplayEditor.addEventListener("copy", (e) => {
      const selection = window.getSelection();
      if (selection.isCollapsed) return;

      const project = getCurrentProject();
      if (!project) return;

      const selectedLines = [];
      const range = selection.getRangeAt(0);
      const blocks = refs.screenplayEditor.querySelectorAll(".script-block");

      blocks.forEach(block => {
          if (selection.containsNode(block, true)) {
              const line = getLine(block.dataset.id);
              if (line) selectedLines.push(line.text);
          }
      });

      if (selectedLines.length > 0) {
          e.clipboardData.setData("text/plain", selectedLines.join("\n"));
          e.preventDefault();
      }
  });

  refs.screenplayEditor.addEventListener("paste", (e) => {
      if (!e.target.classList.contains("script-block")) return;

      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const pastedLines = text.split(/\r?\n/);
      const project = getCurrentProject();
      const activeId = state.activeBlockId;
      if (!project || !activeId) return;

      const index = getLineIndex(activeId);
      const currentLine = project.lines[index];
      const offset = getCaretOffset(e.target);

      const textBefore = currentLine.text.substring(0, offset);
      const textAfter = currentLine.text.substring(offset);

      if (pastedLines.length === 1) {
          // Simple single line paste
          currentLine.text = textBefore + pastedLines[0] + textAfter;
          renderStudio();
          focusBlock(activeId);
          setCaretOffset(refs.screenplayEditor.querySelector(`.script-block[data-id="${activeId}"]`), offset + pastedLines[0].length);
      } else {
          // Multi-line natural paste
          // 1. Update current block with text before cursor + first pasted line
          currentLine.text = textBefore + pastedLines[0];

          // 2. Create new blocks for middle lines
          const middleLines = pastedLines.slice(1, -1);
          const newBlocks = middleLines.map(content => ({
              id: uid(),
              type: inferTypeFromText(content, "", ""),
              text: content
          }));

          // 3. Create final block with last pasted line + text after cursor
          const lastContent = pastedLines[pastedLines.length - 1];
          const finalBlock = {
              id: uid(),
              type: inferTypeFromText(lastContent, "", ""),
              text: lastContent + textAfter
          };

          project.lines.splice(index + 1, 0, ...newBlocks, finalBlock);

          project.updatedAt = new Date().toISOString();
          renderStudio();
          focusBlock(finalBlock.id);
          setCaretOffset(refs.screenplayEditor.querySelector(`.script-block[data-id="${finalBlock.id}"]`), lastContent.length);
      }

      queueSave();
  });

  // Project Grid (Delegated)
  refs.projectGrid.addEventListener("click", (e) => {
      const filterTrigger = e.target.closest("[data-home-project-filter]");
      if (filterTrigger) {
          state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
          renderHome();
          return;
      }
      const formatSelect = e.target.closest("[data-home-project-format]");
      if (formatSelect) {
          state.homeProjectFormat = formatSelect.value || "all";
          renderHome();
          return;
      }
      handleProjectCardGridClick(e);
  });

  refs.workspaceProjectGrid?.addEventListener("click", (e) => {
      handleProjectCardGridClick(e, { allowManagement: false });
  });

  refs.projectGrid.addEventListener("touchstart", (e) => {
      const card = e.target.closest(".project-card");
      const touch = e.changedTouches?.[0];
      if (!card || !touch) {
          resetProjectCardTouchState();
          return;
      }
      projectCardTouchState = {
          identifier: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          moved: false
      };
  }, { passive: true });

  refs.projectGrid.addEventListener("touchmove", (e) => {
      if (!projectCardTouchState) return;
      const touch = [...(e.changedTouches || [])]
        .find((entry) => entry.identifier === projectCardTouchState.identifier);
      if (!touch) return;
      const deltaX = Math.abs(touch.clientX - projectCardTouchState.startX);
      const deltaY = Math.abs(touch.clientY - projectCardTouchState.startY);
      if (deltaX > PROJECT_CARD_TOUCH_SCROLL_THRESHOLD || deltaY > PROJECT_CARD_TOUCH_SCROLL_THRESHOLD) {
          projectCardTouchState.moved = true;
      }
  }, { passive: true });

  refs.projectGrid.addEventListener("touchend", (e) => {
      if (!projectCardTouchState) return;
      const touch = [...(e.changedTouches || [])]
        .find((entry) => entry.identifier === projectCardTouchState.identifier);
      const card = e.target.closest(".project-card");
      const shouldSuppressClick = projectCardTouchState.moved || !touch;
      if (shouldSuppressClick && card?.dataset.projectId) {
          suppressProjectCardClick(card.dataset.projectId);
      }
      resetProjectCardTouchState();
  }, { passive: true });

  refs.projectGrid.addEventListener("touchcancel", resetProjectCardTouchState, { passive: true });

  // Recent Projects (Delegated)
  [refs.homeRecentProjects, refs.studioRecentProjects].forEach(container => {
      if (!container) return;
      container.addEventListener("click", (e) => {
        const btn = e.target.closest(".recent-project-button");
        if (btn) {
            openProjectOrNotify(btn.dataset.projectId);
            closeMenus();
        }
      });
  });

  // Suggestion Tray (Delegated)
  refs.suggestionList.addEventListener("click", (e) => {
      const btn = e.target.closest(".suggestion-pill");
      if (btn) {
          e.preventDefault();
          e.stopPropagation();
          applySuggestion(btn.dataset.suggestionValue);
      }
  });

  // Scene/Character List (Delegated)
  refs.sceneList.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (item) focusBlock(item.dataset.lineId);
  });

  refs.characterList?.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (!item) return;

      if (e.target.closest(".list-item-meta")) {
          e.preventDefault();
          e.stopPropagation();
          showCharacterScenes(item.dataset.characterName, (id) => focusBlock(id));
      } else {
          focusBlock(item.dataset.lineId);
      }
  });

  // Collaboration events
  const collabInviteBtn = document.getElementById('collabInviteBtn');
  const collabInviteEmail = document.getElementById('collabInviteEmail');
  const collabInviteStatus = document.getElementById('collabInviteStatus');
  if (collabInviteBtn && collabInviteEmail) {
    collabInviteBtn.addEventListener('click', async () => {
      const email = collabInviteEmail.value.trim();
      if (!email) return;
      collabInviteBtn.disabled = true;
      let result;
      try {
        result = await inviteCollaborator(email);
      } catch (err) {
        result = { ok: false, reason: err.message || 'An error occurred.' };
      }
      collabInviteBtn.disabled = false;
      if (collabInviteStatus) {
        collabInviteStatus.textContent = result.ok ? 'Invitation sent!' : result.reason;
        collabInviteStatus.className = `collab-status-msg${result.ok ? ' collab-status-ok' : ' collab-status-err'}`;
        setTimeout(() => { collabInviteStatus.textContent = ''; collabInviteStatus.className = 'collab-status-msg'; }, 5000);
      }
      if (result.ok) { collabInviteEmail.value = ''; renderCollaboratorList(); }
    });
    collabInviteEmail.addEventListener('keydown', e => {
      if (e.key === 'Enter') collabInviteBtn.click();
    });
  }

  const collabAddCommentBtn = document.getElementById('collabAddCommentBtn');
  const collabCommentText = document.getElementById('collabCommentText');
  if (collabAddCommentBtn && collabCommentText) {
    collabAddCommentBtn.addEventListener('click', async () => {
      const project = getCurrentProject();
      if (!project) return;
      const text = collabCommentText.value?.trim();
      if (!text) return;
      const lineId = state.activeBlockId;
      if (!lineId) {
        await customAlert('Click on a line in the script first â€” comments must be attached to a specific line.', 'No line selected');
        return;
      }
      await addComment(project.id, text, { lineId });
      collabCommentText.value = '';
    });
  }

  // Re-render studio when a remote collaborator updates the shared project
  window.addEventListener('sharedProjectUpdated', () => {
    if (!refs.studioView?.hidden) renderStudio();
  });

  // Comment compose overlay
  document.getElementById('commentComposeSubmit')?.addEventListener('click', submitCommentCompose);
  document.getElementById('commentComposeCancel')?.addEventListener('click', hideCommentCompose);
  document.getElementById('commentComposeText')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitCommentCompose();
    if (e.key === 'Escape') hideCommentCompose();
  });

  // Left pane comment filters
  document.getElementById('commentFilterUser')?.addEventListener('change', e => setCommentFilter('user', e.target.value));
  document.getElementById('commentFilterStatus')?.addEventListener('change', e => setCommentFilter('status', e.target.value));
  document.getElementById('commentFilterSort')?.addEventListener('change', e => setCommentFilter('sort', e.target.value));
  document.getElementById('viewCommentsBtn')?.addEventListener('click', showCommentPanel);

  // Focus a line from a comment click
  window.addEventListener('focusScriptLine', ({ detail }) => {
    if (detail?.lineId) focusBlock(detail.lineId);
  });

  window.addEventListener('proofreadCleanupApplied', () => {
    renderStudio();
  });
}

// Action Handlers
export function openProject(projectId, options = {}) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return false;
    if (project.isWorkspaceRoot) {
      openWorkspaceDashboard(project.workspace?.id || project.id);
      return true;
    }
    const projectLoadToast = options.silentLoadToast ? null : showToast("Opening project...", "loading", { duration: 0 });
    state.currentProjectId = project.id;
  state.currentWorkspaceId = project.workspace?.id !== project.id ? project.workspace?.id || null : null;
  hasShownReadOnlyNotice = false;

  // Reset history for the new project
  state.history = [];
  state.historyIndex = -1;
  pushHistory();

  state.activeBlockId = project.lines[0]?.id || null;
  state.activeType = project.lines[0]?.type || "action";

  refs.aiAssistToggle.checked = state.aiAssist;
  refs.grammarCheckToggle.checked = state.grammarCheck;
  document.body.classList.toggle("spelling-mode-active", state.grammarCheck);
  document.body.classList.toggle("grammar-mode-active", state.grammarCheck);
  refs.autoNumberToggle.checked = state.autoNumberScenes;
  if (refs.bgAnimationToggle) {
    refs.bgAnimationToggle.checked = state.backgroundAnimation;
  }
  refs.aiPanel.hidden = !state.aiAssist;

  syncInputsFromProject(project);
  showStudio();
  renderStudio();
  onStudioEnter(projectId);
    primeSpellingDictionary();
    if (options.focusLineId) {
      focusBlock(options.focusLineId);
    } else if (state.activeBlockId) {
      focusBlock(state.activeBlockId);
    }

    checkFirstWorkBackup();
    if (projectLoadToast) {
      updateToast(projectLoadToast, "Project opened.", "success", { duration: 1200 });
    }
    return true;
}

export function renderStudio() {
  const project = getCurrentProject();
  if (!project) return;
  syncInputsFromProject(project);
  renderStudioProjectContext();
  renderEditor();
  renderCoverPreview();
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderStoryMemory();
  renderMetrics();
  renderCurrentScriptId();
  renderRecentProjectMenus();
  renderLeftPaneLayout();
  applyViewState();
  applyToolbarState();
  if (refs.leftRailToggle) {
    setButtonGlyph(refs.leftRailToggle, refs.leftPane.classList.contains("is-hidden") ? "&#9654;" : "&#9664;");
  }
  if (refs.rightRailToggle) {
    setButtonGlyph(refs.rightRailToggle, refs.rightPane.classList.contains("is-hidden") ? "&#9664;" : "&#9654;");
  }
  setButtonGlyph(refs.leftPaneSectionToggle, refs.leftPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  setButtonGlyph(refs.rightPaneSectionToggle, refs.rightPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  applyTranslations();
  updateSuggestions();
  updateCommentIcons();
}

export function duplicateActiveBlock() {
  if (!canEditCurrentProjectWithNotice()) return;
  const project = getCurrentProject();
  const index = getLineIndex(state.activeBlockId);
  if (!project || index < 0) {
    return;
  }

  const line = project.lines[index];
  const newId = addBlock(line.type, line.text, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

function handleMetaInput() {
  syncProjectFromInputs();
  syncExportCoverInputsFromProject();
  schedulePreviewRefresh({ includeCover: true });
  scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: false });
  queueSave();
}

function syncExportCoverInputsFromProject(project = getCurrentProject()) {
  if (!project) return;
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element && document.activeElement !== element) {
      element.value = value || "";
    }
  };
  setValue("exportCoverTitle", project.title || "");
  setValue("exportCoverSubtitle", project.subtitle || "");
  setValue("exportCoverAuthor", project.author || "");
  setValue("exportCoverCoWriters", project.coWriters || "");
  setValue("exportCoverContact", project.contact || "");
  setValue("exportCoverCompany", project.company || "");
  setValue("exportCoverVersion", project.coverVersion || (project.version ? String(project.version) : ""));
  setValue("exportCoverDraftDate", project.draftDate || "");
  setValue("exportCoverDetails", project.details || "");
  setValue("exportCoverCopyright", project.copyrightNotice || "");
}

function syncProjectCoverFromExportInputs() {
  const project = getCurrentProject();
  if (!project) return;
  const readValue = (id) => String(document.getElementById(id)?.value || "").trim();
  project.title = readValue("exportCoverTitle") || "Untitled Script";
  project.subtitle = readValue("exportCoverSubtitle");
  project.author = readValue("exportCoverAuthor");
  project.coWriters = readValue("exportCoverCoWriters");
  project.contact = readValue("exportCoverContact");
  project.company = readValue("exportCoverCompany");
  project.coverVersion = readValue("exportCoverVersion");
  project.draftDate = readValue("exportCoverDraftDate");
  project.details = readValue("exportCoverDetails");
  project.copyrightNotice = readValue("exportCoverCopyright");
  project.updatedAt = new Date().toISOString();
  syncInputsFromProject(project);
  schedulePreviewRefresh({ includeCover: true });
  scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: false });
  queueSave();
}

function togglePaneSection(body, button) {
  body.classList.toggle("is-collapsed");
  button.innerHTML = body.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;";
}

function readEditableText(element) {
  if (!element) {
    return "";
  }

  const raw = typeof element.innerText === "string" && element.innerText.length
    ? element.innerText
    : (element.textContent || "");

  return raw
    .replace(/\r/g, "")
    .replace(/\n$/, "");
}

function canEditCurrentProjectWithNotice() {
  const project = getCurrentProject();
  if (canEditProject(project)) {
    hasShownReadOnlyNotice = false;
    return true;
  }

  if (!hasShownReadOnlyNotice) {
    hasShownReadOnlyNotice = true;
    const permissions = getWorkspacePermissions(project);
    const message = permissions.isViewer
      ? "Viewer access is read-only. Ask a workspace admin or the owner if you need editing access."
      : "You do not have permission to edit this workspace item.";
    customAlert(message, "Read-only Workspace");
  }

  return false;
}

function scheduleStudioSidebarRefresh({ includeHome = false, includeAnalytics = true } = {}) {
  if (studioSidebarRefreshFrame) {
    return;
  }

  studioSidebarRefreshFrame = window.requestAnimationFrame(() => {
    studioSidebarRefreshFrame = 0;
    renderSceneList();
    renderCharacterList();
    renderMetrics();
    if (includeHome) {
      renderHome();
    }
    if (includeAnalytics && document.querySelector('[data-left-pane-block="analytics"] .panel-section-body:not([hidden])')) {
      renderAnalytics();
    }
  });
}

function handleBlockInput(id, element) {
  if (!canEditCurrentProjectWithNotice()) {
    renderStudio();
    return;
  }

  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) return;

  // Secondary (right) field of a dual row: update line.secondary only
  if (element.dataset.secondary === "true") {
    const normalized = normalizeLineText(readEditableText(element), "dual", true);
    line.secondary = normalized;
    project.updatedAt = new Date().toISOString();
    setActiveBlock(id);
    schedulePreviewRefresh();
    scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: true });
    updateSuggestions();
    setTypingFocusModeActive();
    queueSave();
    return;
  }

  const offset = getCaretOffset(element);
  const beforeText = readEditableText(element);
  let normalized = normalizeLineText(beforeText, line.type, true);
  let autoCompleted = false;

  if (line.type === "character") {
    const completion = getCharacterAutocomplete(normalized, id);
    if (completion && completion !== normalized) {
      const completionSuffix = completion.substring(normalized.length);
      normalized = completion;
      element.textContent = completion;
      selectTextSuffix(element, beforeText.length, completion.length);
      autoCompleted = true;
    }
  }

  if (!autoCompleted && normalized !== beforeText) {
    let newOffset = offset;
    // If we added a '(' at the beginning, shift offset
    if (line.type === "parenthetical" && !beforeText.startsWith("(") && normalized.startsWith("(")) {
        newOffset++;
    }
    if (line.type === "note" && !beforeText.startsWith("[") && normalized.startsWith("[")) {
        newOffset++;
    }

    const activeLine = getLine(state.activeBlockId);
    if (activeLine && (activeLine.type === "parenthetical" || activeLine.type === "note") && (normalized === "" || normalized === "()" || normalized === "[]")) {
        // Don't force set if it breaks typing feel for empty wrappers
    } else {
        element.textContent = normalized;
        setCaretOffset(element, newOffset);
    }
  }

  line.text = normalized;
  project.updatedAt = new Date().toISOString();
  clearSuggestionContext();

  const shouldRefreshSpelling = state.grammarCheck
    && hasLanguageDictionary(state.writingLanguage)
    && Boolean(window.getSelection()?.isCollapsed);
  const caretOffset = shouldRefreshSpelling ? getCaretOffset(element) : 0;
  if (shouldRefreshSpelling) {
    refreshEditableBlockDisplay(element, line, project);
    setCaretOffset(element, Math.min(caretOffset, element.textContent.length));
  }

  setActiveBlock(id);
  schedulePreviewRefresh();
  scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: true });
  if (line.type === "scene") {
    hideSuggestionTray(true);
  } else {
    updateSuggestions();
  }
  setTypingFocusModeActive();
  queueSave();
  noteRealtimeActivity(id, { isTyping: true });
}

let lastKeyDownCode = "";
let _enterPrevBlockId = null;  // tracks block left behind when Enter creates a new one

function insertSoftLineBreak(id, element) {
  if (!element) {
    return;
  }

  element.focus();
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const br = document.createElement("br");
  const trailingTextNode = document.createTextNode("");

  range.insertNode(trailingTextNode);
  range.insertNode(br);

  const nextRange = document.createRange();
  nextRange.setStart(trailingTextNode, 0);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);

  handleBlockInput(id, element);
}

export function intelligentSplit(element) {
  const id = element.dataset.id;
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) return;

  const offset = getCaretOffset(element);
  const textBefore = line.text.substring(0, offset);
  const textAfter = line.text.substring(offset);

  line.text = textBefore;
  // Get the next type in sequence
  const currentTypeIdx = TYPE_SEQUENCE.indexOf(line.type);
  const nextType = TYPE_SEQUENCE[(currentTypeIdx + 1) % TYPE_SEQUENCE.length];
  const newId = addBlock(nextType, textAfter, index + 1);

  renderStudio();
  focusBlock(newId, !textAfter);
  queueSave();
}

function handleBlockKeydown(event, id) {
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) return;

  const code = event.code;
  const isSecondary = event.target.dataset.secondary === "true";

  // --- Dual secondary field: Enter / Tab advance to next dual row ---
  if (isSecondary && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    event.preventDefault();
    line.secondary = normalizeLineText(event.target.textContent || "", line.type);
    project.updatedAt = new Date().toISOString();
    if (line.type === "character") {
      const newId = addBlock("dialogue", "", index + 1);
      const newLine = getLine(newId);
      if (newLine) newLine.secondary = "";
      renderStudio();
      focusBlock(newId);
    } else {
      const newId = addBlock("action", "", index + 1);
      renderStudio();
      focusBlock(newId);
    }
    queueSave();
    return;
  }

  // Handle Break function (Backtick + Enter)
  if (event.key === "Enter" && lastKeyDownCode === "Backquote") {
    event.preventDefault();
    intelligentSplit(event.target);
    return;
  }

  lastKeyDownCode = code;

  if (event.key === "Delete") {
    const isEmpty = !activeEl.textContent.trim();
    if (!isEmpty) {
      // Let the browser delete one character forward â€” do not touch the line
      return;
    }
    event.preventDefault();
    project.updatedAt = new Date().toISOString();
    if (project.lines.length === 1) {
      line.text = "";
      renderStudio();
      focusBlock(line.id, true);
    } else {
      const fallbackIndex = Math.min(index, project.lines.length - 2);
      const targetId = project.lines[fallbackIndex >= index ? fallbackIndex + 1 : fallbackIndex]?.id || project.lines[Math.max(0, index - 1)].id;
      project.lines.splice(index, 1);
      state.activeBlockId = targetId;
      renderStudio();
      focusBlock(targetId);
    }
    queueSave();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    // Primary field of a dual row: move focus to secondary
    if (line.secondary !== undefined && !isSecondary) {
      focusSecondaryBlock(id);
      return;
    }
    if (!line.text.trim()) {
      focusBlock(id, true);
      return;
    }
    const offset = getCaretOffset(event.target);
    const originalText = line.text;
    const textBefore = originalText.substring(0, offset);
    const textAfter = originalText.substring(offset);
    const nextType = inferNextType(index);
    const createFreshLine = offset === 0 && Boolean(originalText.trim());

    line.text = createFreshLine ? originalText : textBefore;
    _enterPrevBlockId = id;  // protect this block from focusout deletion during render
    const newId = addBlock(
      nextType,
      createFreshLine ? getDefaultText(nextType, index + 1) : (textAfter || getDefaultText(nextType, index + 1)),
      index + 1
    );

    renderStudio();
    _enterPrevBlockId = null;
    focusBlock(newId, createFreshLine || !textAfter);
    queueSave();
    return;
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    insertSoftLineBreak(id, event.target);
    return;
  }

  if (event.key === "Backspace") {
    const offset = getCaretOffset(event.target);
    if (offset === 0 && index > 0) {
      event.preventDefault();
      const prevLine = project.lines[index - 1];
      const prevTextLength = prevLine.text.length;
      prevLine.text += line.text;
      project.lines.splice(index, 1);
      state.activeBlockId = prevLine.id;
      project.updatedAt = new Date().toISOString();
      renderStudio();
      const prevElement = refs.screenplayEditor.querySelector(`.script-block[data-id="${prevLine.id}"]:not([data-secondary])`);
      focusBlock(prevLine.id);
      setCaretOffset(prevElement, prevTextLength);
      queueSave();
      return;
    }

    if (!line.text.trim() && project.lines.length > 1) {
      event.preventDefault();
      const targetId = project.lines[Math.max(index - 1, 0)].id;
      project.lines.splice(index, 1);
      state.activeBlockId = targetId;
      project.updatedAt = new Date().toISOString();
      renderStudio();
      focusBlock(targetId);
      placeCaretAtEnd(refs.screenplayEditor.querySelector(`.script-block[data-id="${targetId}"]:not([data-secondary])`));
      queueSave();
      return;
    }
  }

  if (event.key === "Tab") {
    event.preventDefault();
    // Primary field of a dual row: move focus to secondary
    if (line.secondary !== undefined && !isSecondary) {
      focusSecondaryBlock(id);
      return;
    }
    cycleBlockType(id);
    return;
  }

  // Smart Navigation
  if (event.key === "ArrowUp") {
    const offset = getCaretOffset(event.target);
    if (offset === 0 || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Jump to previous scene
        for (let i = index - 1; i >= 0; i--) {
          if (project.lines[i].type === "scene") {
            focusBlock(project.lines[i].id);
            return;
          }
        }
        focusBlock(project.lines[0].id);
      } else {
        const prev = project.lines[index - 1];
        if (prev) focusBlock(prev.id);
      }
    }
  }

  if (event.key === "ArrowDown") {
    const offset = getCaretOffset(event.target);
    const length = line.text.length;
    if (offset === length || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Jump to next scene
        for (let i = index + 1; i < project.lines.length; i++) {
          if (project.lines[i].type === "scene") {
            focusBlock(project.lines[i].id);
            return;
          }
        }
        focusBlock(project.lines[project.lines.length - 1].id);
      } else {
        const next = project.lines[index + 1];
        if (next) focusBlock(next.id);
      }
    }
  }
}

function inferNextType(index) {
  const current = getCurrentProject()?.lines[index]?.type || "action";
  if (current === "scene") return "action";
  if (current === "action") return "action";
  if (current === "character") return "dialogue";
  if (current === "parenthetical") return "dialogue";
  if (current === "dialogue") return "character";
  if (current === "transition") return "scene";
  if (current === "dual") return "dialogue";
  if (current === "text") return "text";
  if (current === "note") return "note";
  return "action";
}

export function addBlock(type, text = "", index) {
  if (!canEditCurrentProjectWithNotice()) {
    return state.activeBlockId;
  }
  const project = getCurrentProject();
  const insertAt = Number.isInteger(index) ? index : project.lines.length;
  const line = { id: uid(), type, text: normalizeLineText(text, type) };
  project.lines.splice(insertAt, 0, line);
  project.updatedAt = new Date().toISOString();
  state.activeBlockId = line.id;
  state.activeType = type;
  return line.id;
}

function cycleBlockType(id) {
  const line = getLine(id);
  if (!line) return;
  const index = TYPE_SEQUENCE.indexOf(line.type);
  changeBlockType(id, TYPE_SEQUENCE[(index + 1) % TYPE_SEQUENCE.length]);
}

function changeBlockType(id, nextType) {
  if (!canEditCurrentProjectWithNotice()) return;
  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) return;

  const contextIndex = getLineIndex(id);
  const previousText = line.text;
  line.type = nextType;
  line.text = normalizeConvertedText(previousText, nextType, contextIndex);
  project.updatedAt = new Date().toISOString();
  state.activeBlockId = id;
  state.activeType = nextType;
  renderStudio();
  focusBlock(id, !stripWrapperChars(String(previousText || "").trim()) && Boolean(line.text));
  queueSave();
}

function normalizeConvertedText(text, type, contextIndex = getLineIndex(state.activeBlockId)) {
  const stripped = stripWrapperChars(String(text || "").trim());
  if (!stripped && type === "character") {
      return getSuggestedNextSpeaker(contextIndex);
  }
  return normalizeLineText(stripped, type);
}

function toggleSceneCollapse(sceneId) {
  const project = getCurrentProject();
  if (!project) return;
  const collapsed = new Set(project.collapsedSceneIds);
  if (collapsed.has(sceneId)) {
    collapsed.delete(sceneId);
  } else {
    collapsed.add(sceneId);
    if (state.activeBlockId !== sceneId && getOwningSceneId(state.activeBlockId) === sceneId) {
      state.activeBlockId = sceneId;
      state.activeType = "scene";
    }
  }
  project.collapsedSceneIds = [...collapsed];
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(sceneId);
  queueSave();
}

function applySuggestion(value) {
  const line = getLine(state.activeBlockId);
  const project = getCurrentProject();
  if (!line || !project) return;

  if (state.suggestionContext?.mode === "spelling" && state.suggestionContext.lineId === line.id) {
    const { start, end, word } = state.suggestionContext;
    const replacement = applyWordCase(value, word);
    line.text = normalizeLineText(`${line.text.slice(0, start)}${replacement}${line.text.slice(end)}`, line.type);
    clearSuggestionContext();
    project.updatedAt = new Date().toISOString();
    renderStudio();
    focusBlock(line.id);
    const activeBlock = refs.screenplayEditor.querySelector(`.script-block[data-id="${line.id}"]`);
    if (activeBlock) {
      setCaretOffset(activeBlock, Math.min(start + replacement.length, activeBlock.textContent.length));
    }
    queueSave();
    return;
  }

  clearSuggestionContext();
  line.text = normalizeLineText(value, line.type);
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(line.id);
  queueSave();
}

function handleToolSelection(type) {
  if (type === "dual") {
    const active = getLine(state.activeBlockId);
    if (active?.type === "character" && active.secondary === undefined) {
      active.secondary = "";
      const project = getCurrentProject();
      if (project) project.updatedAt = new Date().toISOString();
      renderStudio();
      focusSecondaryBlock(active.id);
      queueSave();
      return;
    }
  }

  const active = getLine(state.activeBlockId);
  if (!active) {
    const newId = addBlock(type, "");
    renderStudio();
    focusBlock(newId, true);
    queueSave();
    return;
  }
  changeBlockType(active.id, type);
}

function togglePane(side) {
  const isLeft = side === "left";
  const pane = isLeft ? refs.leftPane : refs.rightPane;
  const handle = isLeft ? refs.leftResize : refs.rightResize;
  const button = isLeft ? refs.leftRailToggle : refs.rightRailToggle;
  const collapsed = pane.classList.toggle("is-hidden");
  if (handle) handle.classList.toggle("is-hidden", collapsed);
  refs.studioLayout.classList.toggle(isLeft ? "left-pane-hidden" : "right-pane-hidden", collapsed);
  button.innerHTML = collapsed ? (isLeft ? "&#9654;" : "&#9664;") : (isLeft ? "&#9664;" : "&#9654;");
}

function setMobileStudioPane(pane) {
  const layout = refs.studioLayout;
  if (!layout) return;
  const normalizedPane = ["details", "editor", "preview"].includes(pane) ? pane : "editor";
  layout.classList.remove("mobile-pane-details", "mobile-pane-editor", "mobile-pane-preview");
  layout.classList.add(`mobile-pane-${normalizedPane}`);
  document.querySelectorAll("[data-mobile-pane]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mobilePane === normalizedPane);
  });
}

function initResizeHandle(handle, side) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === "left"
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10)
      : parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10);

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = side === "left"
        ? clamp(startWidth + delta, 220, 460)
        : clamp(startWidth - delta, 260, 520);
      document.documentElement.style.setProperty(side === "left" ? "--left-pane-width" : "--right-pane-width", `${nextWidth}px`);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      persistProjects(false);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

function handleMenuAction(action) {
  switch (action) {
    case "new-project":
      launchNewCreationFlow();
      break;
    case "open-projects":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "open-file-recovery":
      openFileRecoveryDialog();
      break;
    case "open-conversion-jobs":
      openConversionJobsDialog();
      break;
    case "open-conversion-interface":
      openCurrentProjectConversionInterface();
      break;
    case "save-project":
      persistProjects(true);
      break;
    case "save-home":
      saveAndGoHome();
      break;
    case "rename-project":
      renameCurrentProject();
      break;
    case "duplicate-project":
      duplicateProject();
      break;
    case "delete-project":
      deleteProject();
      break;
    case "import-file":
      refs.fileInput.click();
      break;
    case "export-txt":
      exportTxt();
      break;
    case "export-screenplay":
      if (!ensureExportProjectContext()) break;
      openExportDialog({ format: "pdf", exportType: "full" });
      break;
    case "open-report":
      if (!ensureExportProjectContext()) break;
      openReportDialog();
      break;
    case "export-json":
      exportJson();
      break;
    case "preview-new-tab":
      openPreviewWindow(false);
      break;
    case "print-project":
      printWithHiddenFrame();
      break;
    case "exit-studio":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "undo":
      undo();
      renderStudio();
      break;
    case "redo":
      redo();
      renderStudio();
      break;
    case "insert-page-break":
      insertMenuBlock("text", "--- PAGE BREAK ---");
      break;
    case "insert-hyperlink":
      insertHyperlink();
      break;
    case "insert-image":
      handleToolSelection("image");
      break;
    case "select-all": {
        const target = getActiveEditableBlock();
        if (target) { target.focus(); selectElementText(target); }
        break;
    }
    case "text-copy":
      ContextMenu.performAction("copy", getActiveEditableBlock());
      break;
    case "text-cut":
      ContextMenu.performAction("cut", getActiveEditableBlock());
      queueSave();
      break;
    case "text-paste":
      ContextMenu.performAction("paste", getActiveEditableBlock());
      queueSave();
      break;
    case "text-duplicate":
      ContextMenu.performAction("duplicate", getActiveEditableBlock());
      break;
    case "text-caps-all":
      ContextMenu.performAction("caps-all", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-sentence":
      ContextMenu.performAction("caps-sentence", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-each":
      ContextMenu.performAction("caps-each", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-low":
      ContextMenu.performAction("caps-low", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-random":
      ContextMenu.performAction("caps-random", getActiveEditableBlock());
      queueSave();
      break;
    case "find":
      findInScript();
      break;
    case "filter":
      setScriptFilter();
      break;
    case "clear-filter":
      clearScriptFilter();
      break;
    case "fullscreen":
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        document.documentElement.requestFullscreen?.();
      }
      break;
    case "proofread":
      showProofreadReport();
      break;
    case "toggle-ai-assistant":
      state.aiAssist = true;
      refs.aiAssistToggle.checked = state.aiAssist;
      refs.aiPanel.hidden = !state.aiAssist;
      applyToolbarState();
      updateMenuStateButtons();
      showModal({
        title: "AI Assistant",
        message: "AI Assistant is ready. Use the assistant on the active block for rewrites, next beats, or dialogue help.",
        confirmLabel: "Launch Assistant",
        cancelLabel: "Close"
      }).then((confirmed) => {
        if (confirmed) {
          AI.triggerAssistant();
        }
      });
      queueSave();
      break;
    case "toggle-grammar-check":
      showModal({
        title: "Grammar Check",
        message: state.grammarCheck
          ? "Grammar check is active for the editor. You can turn it off or keep reviewing the current script."
          : "Turn on grammar check to review spelling and language issues across the current script.",
        confirmLabel: state.grammarCheck ? "Turn Off" : "Turn On",
        cancelLabel: "Close"
      }).then((confirmed) => {
        if (confirmed) {
          setGrammarCheck(!state.grammarCheck);
        }
      });
      break;
    case "toggle-auto-number":
      refs.autoNumberToggle.checked = !refs.autoNumberToggle.checked;
      state.autoNumberScenes = refs.autoNumberToggle.checked;
      renderStudio();
      queueSave();
      break;
    case "show-work-tracking":
      showWorkTracking();
      break;
    case "show-metrics": {
      const container = document.createElement("div");
      container.className = "metric-grid";
      const project = getCurrentProject();
      const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
      const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => line.text.trim().toUpperCase()));
      const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;

      container.innerHTML = `
        <div><span>Words</span><strong>${words.length.toLocaleString()}</strong></div>
        <div><span>Pages est.</span><strong>${Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1)}</strong></div>
        <div><span>Characters</span><strong>${characters.size}</strong></div>
        <div><span>Scenes</span><strong>${scenes}</strong></div>
      `;
      showModal({ title: "Metrics", message: container, showConfirm: false, cancelLabel: "Close" });
      break;
    }
    case "open-notepad":
      openNotepad();
      break;
    case "open-story-memory":
      showStoryMemoryPopup();
      break;
    case "add-story-element":
      showStoryMemoryBuilder();
      break;
    case "open-scenes": {
      const container = document.createElement("div");
      container.className = "modal-list";
      container.appendChild(refs.sceneList.cloneNode(true));
      showModal({ title: "Scenes", message: container, showConfirm: false, cancelLabel: "Close" });
      break;
    }
    case "open-characters":
      showCharactersInterface(false, (id) => focusBlock(id));
      break;
    case "add-character":
      showCharactersInterface(true, (id) => focusBlock(id));
      break;
    case "pick-story-memory":
      showStoryMemoryPicker();
      break;
    case "open-workspace":
      showWorkspacePopup();
      break;
    case "open-analytics": {
      const container = document.createElement("div");
      container.id = "analyticsDashboardContent";
      showModal({ title: "Writing Analytics", message: container, showConfirm: false, cancelLabel: "Close" });
      renderAnalytics();
      break;
    }
    case "smart-proofread":
      AI.triggerSmartProofread();
      break;
    case "customize-active-blocks":
      showCustomizeActiveBlocksModal();
      break;
  }
  closeMenus();
  if (action === "toggle-grammar-check") {
    queueSave();
  }
}

function execEditorCommand(command) {
  const target = getActiveEditableBlock();
  if (!target) {
    return;
  }
  target.focus();
  if (typeof document.execCommand === "function") {
    document.execCommand(command);
  }
}

async function saveAndGoHome() {
  try {
    if (isDisposableUntitledDraft()) {
      await discardUntitledDraftIfNeeded();
    } else {
      persistProjects(true);
    }
  } catch (error) {
    console.error("Save & Home failed during save", error);
  } finally {
    state.currentWorkspaceId = null;
    state.homeWorkspaceFilter = "all";
    state.homeProjectFilter = "all";
    state.homeProjectFormat = "all";
    state.homeProjectSort = "latest";
    closeMenus();
    if (window.location.pathname !== "/") {
      window.history.replaceState({}, "", "/");
    }
    showHome();
    renderHome();
  }
}

function setGrammarCheck(enabled) {
  state.grammarCheck = enabled;
  refs.grammarCheckToggle.checked = enabled;
  document.body.classList.toggle("spelling-mode-active", enabled);
  document.body.classList.toggle("grammar-mode-active", enabled);
  clearSuggestionContext();
  clearSpellingHighlights(refs.screenplayEditor);
  renderStudio();
  primeSpellingDictionary();
}

function setWritingLanguage(language) {
  state.writingLanguage = ["en", "fr", "de"].includes(language) ? language : "en";
  applyWritingLanguageButtons();
  if (state.grammarCheck && !refs.studioView.hidden) {
    renderStudio();
  }
}

function applyWritingLanguageButtons() {
  refs.writingLanguageButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.writingLanguageValue === state.writingLanguage);
  });
}

async function toggleLocalBackup(enable) {
  if (enable) {
    if (!isLocalSaveSupported()) {
      customAlert("Local backup requires a Chromium-based browser (Chrome, Edge, Opera).");
      if (refs.localBackupToggle) refs.localBackupToggle.checked = false;
      return;
    }
    state.localBackupEnabled = true;
    applyLocalBackupUI();
    persistProjects(false);
    if (!state.localSaveFileHandle) {
      const result = await chooseLocalSaveFile();
      if (!result.ok) {
        state.localBackupEnabled = false;
        applyLocalBackupUI();
        persistProjects(false);
        return;
      }
    }
    startLocalSaveTimer();
  } else {
    state.localBackupEnabled = false;
    applyLocalBackupUI();
    persistProjects(false);
    stopLocalSaveTimer();
  }
}

export function applySaveModeButtons() {
  applyLocalBackupUI();
}

function applyLocalBackupUI() {
  if (refs.localBackupToggle) {
    refs.localBackupToggle.checked = state.localBackupEnabled;
  }
  if (refs.localSaveControls) {
    refs.localSaveControls.hidden = !state.localBackupEnabled;
  }
  if (refs.localSaveInterval) {
    refs.localSaveInterval.value = String(state.localSaveIntervalMinutes);
  }
  if (refs.localSaveFileLabel) {
    refs.localSaveFileLabel.textContent = state.localSaveFileHandle
      ? `Backup file: ${state.localSaveFileHandle.name}`
      : "No file selected";
  }
}

function primeSpellingDictionary() {
  if (!state.grammarCheck) {
    return;
  }

  ensureLanguageDictionary(state.writingLanguage)
    .then(() => {
      if (state.grammarCheck && !refs.studioView.hidden) {
        renderStudio();
      }
    })
    .catch((error) => {
      console.error("Unable to load spelling dictionary:", error);
    });
}

async function maybeShowSpellingSuggestions(block, target = null, clientX = null, clientY = null) {
  if (!state.grammarCheck) {
    return;
  }

  const line = getLine(block.dataset.id);
  const project = getCurrentProject();
  if (!line || !project) {
    return;
  }

  if (!hasLanguageDictionary(state.writingLanguage)) {
    try {
      await ensureLanguageDictionary(state.writingLanguage);
    } catch (error) {
      console.error("Unable to load spelling suggestions:", error);
      return;
    }
  }

  const clickedContext = resolveClickedSpellingContext(block, line, project, target, clientX, clientY);
  if (clickedContext) {
    showSpellingSuggestions(clickedContext, { x: clientX, y: clientY });
    highlightSpellingIssue(block, clickedContext);
    return;
  }

  const offset = getCaretOffset(block);
  const context = getSpellingContextAtOffset(line.text, offset, {
    language: state.writingLanguage,
    project,
    lineId: line.id
  });

  if (!context) {
    clearSpellingHighlights(refs.screenplayEditor);
    updateSuggestions();
    return;
  }

  showSpellingSuggestions(context, { rect: block.getBoundingClientRect() });
  highlightSpellingIssue(block, context);
}

function resolveClickedSpellingContext(block, line, project, target, clientX, clientY) {
  const directIssue = target?.closest?.(".spelling-error");
  const pointIssue = getSpellingIssueFromPoint(block, clientX, clientY);
  const issue = directIssue || pointIssue;

  if (issue) {
    const start = Number(issue.dataset.spellingStart);
    const end = Number(issue.dataset.spellingEnd);
    const word = issue.dataset.spellingWord || line.text.slice(start, end);

    if (issue.dataset.grammarSuggestions) {
      const suggestions = JSON.parse(issue.dataset.grammarSuggestions);
      if (suggestions.length) {
        return { mode: "spelling", lineId: line.id, start, end, word, suggestions };
      }
    }

    const suggestions = getSpellingSuggestions(word, {
      language: state.writingLanguage,
      project
    });

    if (suggestions.length) {
      return {
        mode: "spelling",
        lineId: line.id,
        start,
        end,
        word,
        suggestions
      };
    }
  }

  const offsetFromPoint = getCaretOffsetFromPoint(block, clientX, clientY);
  if (offsetFromPoint >= 0) {
    return getSpellingContextAtOffset(line.text, offsetFromPoint, {
      language: state.writingLanguage,
      project,
      lineId: line.id
    });
  }

  return null;
}

function getSpellingIssueFromPoint(block, clientX, clientY) {
  return getPointContext(block, clientX, clientY)?.element?.closest?.(".spelling-error") || null;
}

function getCaretOffsetFromPoint(block, clientX, clientY) {
  return getPointContext(block, clientX, clientY)?.offset ?? -1;
}

function getPointContext(block, clientX, clientY) {
  if (!block || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  let container = null;
  let offset = 0;

  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(clientX, clientY);
    container = position?.offsetNode || null;
    offset = position?.offset || 0;
  } else if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(clientX, clientY);
    container = range?.startContainer || null;
    offset = range?.startOffset || 0;
  }

  if (!container) {
    return null;
  }

  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  if (!element || !block.contains(element)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(container, offset);

  return {
    element,
    offset: range.toString().length
  };
}

function setButtonGlyph(button, entity) {
  if (button) {
    button.innerHTML = entity;
  }
}

async function renameCurrentProject() {
  const project = getCurrentProject();
  if (!project) return;
  const nextTitle = await customPrompt("Rename this project:", project.title, "Rename Project");
  if (nextTitle === null) return;
  const trimmedTitle = nextTitle.trim() || "Untitled Script";
  if (hasProjectNameConflict(trimmedTitle, { excludeProjectId: project.id, isShared: Boolean(project.isShared) })) {
    await customAlert(`You already have a project named "${trimmedTitle}". Choose a different name.`, "Rename Project");
    return;
  }
  project.title = trimmedTitle;
  project.updatedAt = new Date().toISOString();
  syncInputsFromProject(project);
  renderStudio();
  queueSave();
}

function duplicateProject() {
  const current = getCurrentProject();
  const nextTitle = `${current.title} Copy`;
  if (hasProjectNameConflict(nextTitle, { isShared: Boolean(current?.isShared) })) {
    customAlert(`You already have a project named "${nextTitle}". Rename the existing one first or choose another name.`, "Duplicate Project");
    return;
  }
  const copy = cloneProject({ ...current, title: nextTitle }, true);
  upsertProject(copy);
  openProject(copy.id);
  persistProjects(true);
}

async function renameProjectById(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const nextTitle = await customPrompt("Rename this project:", project.title, "Rename Project");
  if (!nextTitle || !nextTitle.trim()) return;
  const trimmedTitle = nextTitle.trim();
  if (hasProjectNameConflict(trimmedTitle, { excludeProjectId: project.id, isShared: Boolean(project.isShared) })) {
    await customAlert(`You already have a project named "${trimmedTitle}". Choose a different name.`, "Rename Project");
    return;
  }
  project.title = trimmedTitle;
  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  persistProjects(true, { syncInputs: false });
  renderHome();
  if (state.currentProjectId === project.id) {
    renderStudio();
  }
}

function duplicateProjectById(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const nextTitle = `${project.title} Copy`;
  if (hasProjectNameConflict(nextTitle, { isShared: Boolean(project.isShared) })) {
    customAlert(`You already have a project named "${nextTitle}". Rename the existing one first or choose another name.`, "Duplicate Project");
    return;
  }
  const copy = cloneProject({ ...project, title: nextTitle }, true);
  upsertProject(copy);
  persistProjects(true, { syncInputs: false });
  renderHome();
}

function deleteProject() {
  const current = getCurrentProject();
  if (current) removeProject(current.id);
}

async function confirmWorkspaceDeletion(workspaceProject) {
  const finalWarningAccepted = await customConfirm(
    `This will permanently delete the workspace "${workspaceProject.title}" for everyone, including its shared projects, invites, and collaboration records.`,
    "Final Workspace Warning"
  );
  if (!finalWarningAccepted) {
    return { ok: false, cancelled: true };
  }

  const nameConfirmation = await customPrompt(
    `Type the workspace name exactly to continue deleting "${workspaceProject.title}".`,
    "",
    "Confirm Workspace Name"
  );
  if (nameConfirmation !== workspaceProject.title) {
    if (nameConfirmation !== null) {
      await customAlert("Workspace deletion cancelled. The workspace name did not match.", "Cancelled");
    }
    return { ok: false, cancelled: true };
  }

  const user = auth.currentUser;
  if (!user?.email) {
    return { ok: false, reason: "A signed-in email account is required to delete a workspace." };
  }
  const hasPasswordProvider = user.providerData?.some((provider) => provider?.providerId === "password");
  if (!hasPasswordProvider) {
    return { ok: false, reason: "Workspace deletion currently requires an email/password account so the password can be confirmed." };
  }

  const password = await customPrompt(
    `Enter the password for ${user.email} to finish deleting this workspace.`,
    "",
    "Password Confirmation"
  );
  if (password === null) {
    return { ok: false, cancelled: true };
  }
  if (!password) {
    return { ok: false, reason: "Password confirmation is required." };
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    return { ok: true };
  } catch (error) {
    console.error("Workspace deletion reauthentication failed", error);
    return { ok: false, reason: "Password confirmation failed. Please try again." };
  }
}

async function removeProject(id) {
  const target = state.projects.find((item) => item.id === id);
  if (!target) return;

  const workspaceId = target.workspace?.id || target.id;
  const removedProjects = state.projects.filter((item) => {
    if (target.isWorkspaceRoot) {
      return item.workspace?.id === workspaceId;
    }
    return item.id === id;
  });
  const workspaceProject = getWorkspaceRootProject(workspaceId)
    || state.projects.find((item) => item.id === workspaceId)
    || target;

  if (target.isWorkspaceRoot) {
    if (!canDeleteWorkspace(workspaceProject)) {
      await customAlert("Only the workspace owner can delete this workspace.", "Workspace Access");
      return;
    }
  } else if (target.isShared && !canManageWorkspaceProjects(workspaceProject)) {
    await customAlert("Only workspace owners and admins can delete projects inside this workspace.", "Workspace Access");
    return;
  }

  if (target.isWorkspaceRoot) {
    const workspaceDeletion = await confirmWorkspaceDeletion(target);
    if (!workspaceDeletion.ok) {
      if (workspaceDeletion.reason) {
        await customAlert(workspaceDeletion.reason, "Workspace Deletion");
      }
      return;
    }
    const deleteResult = await deleteWorkspaceData(workspaceId);
    if (!deleteResult.ok) {
        await customAlert(deleteResult.reason || "Unable to delete the workspace right now.", "Workspace Deletion");
        return;
      }
  } else {
    const confirmation = await customPrompt(`This will permanently delete the project "${target.title}".\n\nTo confirm, please retype the project name below:`, "", "Confirm Deletion");
    if (confirmation !== target.title) {
      if (confirmation !== null) {
        await customAlert("Deletion cancelled. The name you typed did not match.", "Cancelled");
      }
      return;
    }
    await logActivity(target.id, 'Deleted the project.', {
      action: 'project.delete',
      workspaceId
    });
  }

  archiveDeletedProjects(removedProjects);
  state.projects = state.projects.filter((item) => {
    if (target.isWorkspaceRoot) {
      return item.workspace?.id !== workspaceId;
    }
    return item.id !== id;
  });
  if (!state.projects.length) {
    const fallback = createProjectWithOptions();
    state.projects = [fallback];
  }
  if (target.isWorkspaceRoot || state.currentWorkspaceId === workspaceId) {
    state.currentWorkspaceId = null;
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true, { syncInputs: false });
  await Promise.all(removedProjects.map((project) => deleteProjectFromCloud(project.id)));
  showHome();
  renderHome();
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const code = event.code;

  if (event.key === "F1") {
    event.preventDefault();
    refs.helpDialog?.showModal();
    return;
  }

  // Ctrl/Cmd + S to Save
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    if (event.shiftKey) {
      saveAndGoHome();
      return;
    }
    persistProjects(true);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && key === "f") {
    event.preventDefault();
    findInScript();
    return;
  }

  // Undo / Redo
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
        redo();
    } else {
        undo();
    }
    renderStudio();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redo();
    renderStudio();
    return;
  }

  // Duplicate Block
  if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    duplicateActiveBlock();
    return;
  }

  // Number keys for suggestions
  if (state.visibleSuggestions.length && /^[1-9]$/.test(event.key)) {
    const choice = state.visibleSuggestions[Number(event.key) - 1];
    if (choice) {
      event.preventDefault();
      applySuggestion(choice.value);
      return;
    }
  }

  // Alt + Key for block types
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const charCode = code?.startsWith('Key') ? code.substring(3).toLowerCase() : key;
    const map = {
      s: "shot",
      a: "action",
      c: "character",
      d: "dialogue",
      t: "transition",
      p: "parenthetical",
      o: "shot",
      x: "text",
      n: "note",
      u: "dual",
      i: "image",
      e: "scene"
    };

    const blockType = map[charCode] || map[key];

    if (blockType) {
      event.preventDefault();
      handleToolSelection(blockType);
    }

    if (charCode === 'h' || key === 'h') {
      event.preventDefault();
      saveAndGoHome();
      return;
    }

    if (charCode === 'f' || key === 'f') {
      event.preventDefault();
      findInScript();
      return;
    }

    if (charCode === 'j' || key === 'j') {
      event.preventDefault();
      openConversionJobsDialog();
      return;
    }

    if (charCode === 'r' || key === 'r') {
      event.preventDefault();
      openFileRecoveryDialog();
      return;
    }

    if (charCode === 'v' || key === 'v') {
      event.preventDefault();
      openCurrentProjectConversionInterface();
      return;
    }

    // Alt + G for AI Grammar
    if ((charCode === 'g' || key === 'g') && state.aiAssist) {
      event.preventDefault();
      const activeEl = getActiveEditableBlock();
      if (activeEl) {
        const row = activeEl.closest('.script-block-row');
        if (row) AI.triggerAction(row, "Grammar");
      }
    }
  }

  // Escape to close menus
  if (event.key === "Escape") {
    closeMenus();
  }
}

function insertAiAssistNote() {
  if (!canEditCurrentProjectWithNotice()) return;
  const project = getCurrentProject();
  if (!project) return;
  const index = getLineIndex(state.activeBlockId);
  const prompt = "AI ASSIST: Suggest the next beat, sharpen the scene objective, and keep the current voice.";
  const newId = addBlock("note", prompt, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

function insertMenuBlock(type, text) {
  if (!canEditCurrentProjectWithNotice()) return;
  const index = Math.max(getLineIndex(state.activeBlockId), -1);
  const newId = addBlock(type, text, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

async function insertHyperlink() {
  const url = await customPrompt("Enter the hyperlink URL:", "https://", "Insert Hyperlink");
  if (url === null || !url.trim()) return;
  const label = await customPrompt("Optional display text:", "", "Link Label");
  const cleanedUrl = url.trim();
  const cleanedLabel = label === null ? "" : label.trim();
  const text = cleanedLabel ? `${cleanedLabel} <${cleanedUrl}>` : cleanedUrl;
  insertMenuBlock("text", text);
}

export async function findInScript() {
  const project = getCurrentProject();
  if (!project) return;
  const query = await customPrompt("Find text in this script:", state.filterQuery, "Find");
  if (query === null) return;
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    clearScriptFilter();
    return;
  }
  const match = project.lines.find((line) => `${TYPE_LABELS[line.type]} ${getTypeLabel(line.type)} ${line.text}`.toLowerCase().includes(cleaned));
  if (!match) {
    await customAlert(t("editor.noMatches", { query }), "No Matches");
    return;
  }
  state.filterQuery = "";
  renderStudio();
  focusBlock(match.id, true);
}

async function setScriptFilter() {
  const project = getCurrentProject();
  if (!project) return;
  const nextFilter = await customPrompt("Filter visible lines by text or line function:", state.filterQuery, "Filter Script");
  if (nextFilter === null) return;
  state.filterQuery = nextFilter.trim();
  renderStudio();
}

function clearScriptFilter() {
  if (!state.filterQuery) return;
  state.filterQuery = "";
  renderStudio();
}

function exportTxt() {
    const project = syncProjectFromInputs() || getCurrentProject();
    if (!project) return;

  const preparedLines = buildPreparedExportLines(project);

  const coverParts = [
    project.title || "Untitled Script",
    project.author ? `by ${project.author}` : "",
    [project.contact, project.company, project.details].filter(Boolean).join("\n"),
    project.logline || ""
  ].filter(Boolean);
  const cover = coverParts.join("\n\n");

  const pageBreak = "\n\n" + "-".repeat(60) + "\n\n";
    const scriptBody = preparedLines.map((line) => line.displayText).join("\n\n");

    const content = [cover, scriptBody].filter(Boolean).join(pageBreak) + "\n";
    downloadFile(`${slugify(project.title)}.txt`, content, "text/plain;charset=utf-8");
    logActivity(project.id, "Exported the project as plain text.", { action: "export.txt", workspaceId: project.workspace?.id || project.id }).catch(() => {});
    showToast("Export complete.", "success");
}

function exportJson() {
    const project = syncProjectFromInputs() || getCurrentProject();
    downloadFile(`${slugify(project.title)}.json`, JSON.stringify(project, null, 2), "application/json");
    logActivity(project.id, "Exported the project as JSON.", { action: "export.json", workspaceId: project.workspace?.id || project.id }).catch(() => {});
    showToast("Export complete.", "success");
}

function openExportDialog(prefill = {}) {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;

  const dialog = document.getElementById("exportDialog");
  if (!dialog) return;
  exportDialogMode = prefill.exportType === "breakdown" ? "report" : "export";
  dialog.classList.toggle("report-mode", exportDialogMode === "report");
  reportDraftRequest = null;

  exportDialogPrefill = {
    format: String(prefill.format || exportDialogPrefill.format || "pdf"),
    exportType: String(prefill.exportType || exportDialogPrefill.exportType || "full")
  };
  exportDialogProjectId = project.id;

  const projectMeta = document.getElementById("exportDialogProjectMeta");
  const dialogTitle = dialog.querySelector(".export-head h3");
  const presetsBar = document.getElementById("exportPresetsBar");
  const typePanel = document.getElementById("exportTypeChoices")?.closest(".export-panel");
  const historyPanel = document.getElementById("exportHistoryList")?.closest(".export-panel");
  const optionsPanel = document.getElementById("exportOptionsPanel");
  const generatePanel = document.getElementById("exportGeneratePanel");
  const presetsCopy = dialog.querySelector(".export-presets-copy strong");
  const presetsBody = dialog.querySelector(".export-presets-copy p");
  const historyTitle = historyPanel?.querySelector(".export-panel-head h4");
  const historyEmpty = document.getElementById("exportHistoryEmpty");
  const formatHeading = document.getElementById("exportFormatChoices")?.closest(".export-panel")?.querySelector(".export-panel-head h4");
  const optionsHeading = document.getElementById("exportIncludeNotes")?.closest(".export-panel")?.querySelector(".export-panel-head h4");
  const step1Heading = document.getElementById("exportStep1Heading");
  const step2Heading = document.getElementById("exportStep2Heading");
  const generateHeading = document.getElementById("exportGenerateHeading");
  const generateBadge = document.getElementById("exportGenerateBadge");
  const reportStep1Mount = document.getElementById("exportReportStep1Mount");
  const reportStep2Mount = document.getElementById("exportReportStep2Mount");
  const reportStep3Mount = document.getElementById("exportReportStep3Mount");
  const titlePageToggle = document.getElementById("exportIncludeTitlePageToggle");
  const breakdownBuilder = document.getElementById("exportBreakdownBuilder");
  const breakdownPromptField = document.getElementById("exportBreakdownPromptField");
  const reportGenerateRow = document.getElementById("exportReportGenerateRow");

  rememberReportLayoutNode("titleToggle", titlePageToggle);
  rememberReportLayoutNode("breakdownBuilder", breakdownBuilder);
  rememberReportLayoutNode("breakdownPrompt", breakdownPromptField);
  rememberReportLayoutNode("reportGenerateRow", reportGenerateRow);
  if (projectMeta) {
    const sceneCount = (project.lines || []).filter((line) => line.type === "scene" && String(line.text || "").trim()).length;
    projectMeta.textContent = exportDialogMode === "report"
      ? `${project.title || "Untitled Script"} · ${sceneCount} scene${sceneCount === 1 ? "" : "s"}`
      : `${project.title || "Untitled Script"} · ${sceneCount} scene${sceneCount === 1 ? "" : "s"}`;
  }
  if (dialogTitle) {
    dialogTitle.textContent = exportDialogMode === "report" ? "Report" : "Screenplay Export";
  }
  if (presetsBar) {
    presetsBar.hidden = exportDialogMode === "report";
    presetsBar.style.display = exportDialogMode === "report" ? "none" : "";
  }
  if (typePanel) {
    typePanel.hidden = false;
    typePanel.style.display = "grid";
  }
  if (historyPanel) {
    historyPanel.hidden = exportDialogMode === "report";
    historyPanel.style.display = exportDialogMode === "report" ? "none" : "grid";
  }
  if (optionsPanel) {
    optionsPanel.hidden = exportDialogMode === "report";
    optionsPanel.style.display = exportDialogMode === "report" ? "none" : "grid";
  }
  if (generatePanel) {
    generatePanel.classList.toggle("export-panel-span-2", exportDialogMode !== "report");
  }
  if (presetsCopy) {
    presetsCopy.textContent = exportDialogMode === "report" ? "Report Presets" : "Export Presets";
  }
  if (presetsBody) {
    presetsBody.textContent = exportDialogMode === "report"
      ? "Save reusable AI report setups for different reading goals and delivery styles."
      : "Save a reusable export setup for producer, actor, director, or custom delivery flows.";
  }
  if (historyTitle) {
    historyTitle.textContent = exportDialogMode === "report" ? "Report History" : "Export History";
  }
  if (historyEmpty) {
    historyEmpty.textContent = exportDialogMode === "report"
      ? "No saved AI reports for this script yet."
      : "No exports recorded for this script yet.";
  }
  if (formatHeading) {
    formatHeading.textContent = exportDialogMode === "report" ? "Choose Output Format" : "Choose Format";
  }
  if (optionsHeading) {
    optionsHeading.textContent = exportDialogMode === "report" ? "Report Setup" : "Configure Options";
  }
  if (step1Heading) {
    step1Heading.textContent = exportDialogMode === "report" ? "Report Sections" : "Choose Export Type";
  }
  if (step2Heading) {
    step2Heading.textContent = exportDialogMode === "report" ? "Format" : "Choose Format";
  }
  if (generateHeading) {
    generateHeading.textContent = exportDialogMode === "report" ? "Generation" : "Generate Export";
  }
  if (generateBadge) {
    generateBadge.textContent = exportDialogMode === "report" ? "Step 3" : "Step 4";
  }
  if (exportDialogMode === "report") {
    moveNodeToMount(breakdownBuilder, reportStep1Mount);
    moveNodeToMount(titlePageToggle, reportStep2Mount);
    moveNodeToMount(breakdownPromptField, reportStep3Mount);
    moveNodeToMount(reportGenerateRow, reportStep3Mount);
  } else {
    restoreNodeFromMount("titleToggle", titlePageToggle);
    restoreNodeFromMount("breakdownBuilder", breakdownBuilder);
    restoreNodeFromMount("breakdownPrompt", breakdownPromptField);
    restoreNodeFromMount("reportGenerateRow", reportGenerateRow);
    resetBreakdownLivePanel();
  }

  const defaults = getDefaultExportOptions();
  const exportDocument = buildFullScriptExportDocument(project, {
    includeNotes: true,
    includeComments: true,
    includeSceneNumbers: state.autoNumberScenes,
    includeMetadata: true,
    includeTitlePage: true
  });

  exportDialogContext = {
    scenes: exportDocument.scenes.map((scene) => ({
      id: scene.id,
      number: scene.number,
      heading: scene.heading,
      location: scene.location,
      timeOfDay: scene.timeOfDay,
      characters: [...(scene.characters || [])]
    })),
    characters: exportDocument.characters.map((character) => character.name),
    revisions: buildRevisionVersionOptions(project),
    collaborative: buildCollaborativeExportContext(project, exportDocument)
  };

  const characterList = document.getElementById("exportCharacterList");
  const sceneList = document.getElementById("exportSceneList");
  const productionCharacterList = document.getElementById("exportProductionCharacterList");
  const characterMeta = document.getElementById("exportCharacterMeta");
  const sceneMeta = document.getElementById("exportSceneMeta");
  const locationMeta = document.getElementById("exportLocationMeta");
  const locationSelect = document.getElementById("exportLocationSelect");
  const revisionMeta = document.getElementById("exportRevisionMeta");
  const revisionVersionA = document.getElementById("exportRevisionVersionA");
  const revisionVersionB = document.getElementById("exportRevisionVersionB");
  const productionMeta = document.getElementById("exportProductionMeta");
  const productionCharacterMeta = document.getElementById("exportProductionCharacterMeta");
  const productionLocationSelect = document.getElementById("exportProductionLocationSelect");
  const productionTimeSelect = document.getElementById("exportProductionTimeSelect");
  const collaborativeMeta = document.getElementById("exportCollaborativeMeta");
  const collaborativeWriterSelect = document.getElementById("exportCollaborativeWriterSelect");
  const collaborativeReviewerSelect = document.getElementById("exportCollaborativeReviewerSelect");
  const collaborativeEditorSelect = document.getElementById("exportCollaborativeEditorSelect");
  const sceneCount = exportDocument.scenes.length;
  if (characterList) {
    characterList.innerHTML = exportDocument.characters.length
      ? exportDocument.characters.map((character) => `
        <label class="export-chip-item">
          <input type="checkbox" name="exportCharacterName" value="${escapeHtml(character.name)}">
          <span>${escapeHtml(character.name)}</span>
        </label>
      `).join("")
      : `<div class="export-inline-description">No characters found yet.</div>`;
  }
  if (characterMeta) {
    characterMeta.textContent = exportDocument.characters.length
      ? `${exportDocument.characters.length} character${exportDocument.characters.length === 1 ? "" : "s"} available for actor-friendly export.`
      : "No character cues were found yet. Add character names and dialogue first.";
  }

  if (sceneList) {
    sceneList.innerHTML = exportDocument.scenes.length
      ? exportDocument.scenes.map((scene) => `
        <label class="export-chip-item">
          <input type="checkbox" name="exportSceneId" value="${escapeHtml(scene.id)}">
          <span>${escapeHtml(`${scene.number}. ${scene.heading}`)}</span>
        </label>
      `).join("")
      : `<div class="export-inline-description">No scenes found yet.</div>`;
  }
  if (sceneMeta) {
    sceneMeta.textContent = exportDocument.scenes.length
      ? `${exportDocument.scenes.length} scene${exportDocument.scenes.length === 1 ? "" : "s"} ready for selective export.`
      : "No scene headings were found yet. Add scenes before using scene export.";
  }

  if (locationSelect) {
    const locations = [...new Set(exportDocument.scenes.map((scene) => scene.location).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    locationSelect.innerHTML = ['<option value="">Choose location</option>', ...locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`)].join("");
  }
  if (locationMeta) {
    const locationCount = new Set(exportDocument.scenes.map((scene) => scene.location).filter(Boolean)).size;
    locationMeta.textContent = locationCount
      ? `${locationCount} location${locationCount === 1 ? "" : "s"} available for location export.`
      : "No location headings were found yet. Add scenes before using location export.";
  }
  if (revisionVersionA && revisionVersionB) {
    const options = exportDialogContext.revisions;
    const markup = ['<option value="">Choose version</option>', ...options.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`)].join("");
    revisionVersionA.innerHTML = markup;
    revisionVersionB.innerHTML = markup;
    if (options[0]) revisionVersionA.value = options[0].id;
    if (options[1]) revisionVersionB.value = options[1].id;
  }
  if (revisionMeta) {
    revisionMeta.textContent = exportDialogContext.revisions.length >= 2
      ? `${exportDialogContext.revisions.length} version snapshots available for revision comparison.`
      : "At least two snapshots are needed before a revision report can be generated.";
  }

  if (productionLocationSelect) {
    const locations = [...new Set(exportDocument.scenes.map((scene) => scene.location).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    productionLocationSelect.innerHTML = ['<option value="">All locations</option>', ...locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`)].join("");
  }
  if (productionTimeSelect) {
    const times = [...new Set(exportDocument.scenes.map((scene) => scene.timeOfDay).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    productionTimeSelect.innerHTML = ['<option value="">All times of day</option>', ...times.map((time) => `<option value="${escapeHtml(time)}">${escapeHtml(time)}</option>`)].join("");
  }
  if (productionCharacterList) {
    productionCharacterList.innerHTML = exportDocument.characters.length
      ? exportDocument.characters.map((character) => `
        <label class="export-chip-item">
          <input type="checkbox" name="exportProductionCharacterName" value="${escapeHtml(character.name)}">
          <span>${escapeHtml(character.name)}</span>
        </label>
      `).join("")
      : `<div class="export-inline-description">No characters found yet.</div>`;
  }
  if (productionMeta) {
    productionMeta.textContent = exportDocument.scenes.length
      ? `${exportDocument.scenes.length} scene${exportDocument.scenes.length === 1 ? "" : "s"} available for production filtering.`
      : "No scene headings were found yet. Add scenes before building a production packet.";
  }
  if (productionCharacterMeta) {
    productionCharacterMeta.textContent = exportDocument.characters.length
      ? `${exportDocument.characters.length} character${exportDocument.characters.length === 1 ? "" : "s"} available for presence filtering.`
      : "No characters are available yet for character-presence filtering.";
  }
  if (collaborativeWriterSelect) {
    collaborativeWriterSelect.innerHTML = ['<option value="">All assigned writers</option>', ...exportDialogContext.collaborative.assignedWriters.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  }
  if (collaborativeReviewerSelect) {
    collaborativeReviewerSelect.innerHTML = ['<option value="">All reviewers</option>', ...exportDialogContext.collaborative.reviewers.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  }
  if (collaborativeEditorSelect) {
    collaborativeEditorSelect.innerHTML = ['<option value="">All editors</option>', ...exportDialogContext.collaborative.editors.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  }
  if (collaborativeMeta) {
    collaborativeMeta.textContent = exportDialogContext.collaborative.scenes.length
      ? `${exportDialogContext.collaborative.scenes.length} scene${exportDialogContext.collaborative.scenes.length === 1 ? "" : "s"} can be filtered by workspace collaboration activity.`
      : "No workspace-linked collaboration activity is available yet for scene filtering.";
  }

  const exportTypeSelect = document.getElementById("exportTypeSelect");
  const exportFormatSelect = document.getElementById("exportFormatSelect");
  if (exportTypeSelect) exportTypeSelect.value = exportDialogPrefill.exportType;
  if (exportFormatSelect) exportFormatSelect.value = exportDialogPrefill.format;

  const includeNotes = document.getElementById("exportIncludeNotes");
  const includeComments = document.getElementById("exportIncludeComments");
  const includeMetadata = document.getElementById("exportIncludeMetadata");
  const includeTitlePage = document.getElementById("exportIncludeTitlePage");
  const includePageNumbers = document.getElementById("exportIncludePageNumbers");
  const includeRevisions = document.getElementById("exportIncludeRevisions");
  const breakdownCharacters = document.getElementById("exportBreakdownCharacters");
  const breakdownLocations = document.getElementById("exportBreakdownLocations");
  const breakdownScenes = document.getElementById("exportBreakdownScenes");
  const enableWatermarkSettings = document.getElementById("exportEnableWatermarkSettings");
  const watermarkPreset = document.getElementById("exportWatermarkPreset");
  const watermarkPosition = document.getElementById("exportWatermarkPosition");
  const watermarkOpacity = document.getElementById("exportWatermarkOpacity");
  const watermarkText = document.getElementById("exportWatermarkText");
  const coverTitle = document.getElementById("exportCoverTitle");
  const coverSubtitle = document.getElementById("exportCoverSubtitle");
  const coverAuthor = document.getElementById("exportCoverAuthor");
  const coverCoWriters = document.getElementById("exportCoverCoWriters");
  const coverContact = document.getElementById("exportCoverContact");
  const coverCompany = document.getElementById("exportCoverCompany");
  const coverVersion = document.getElementById("exportCoverVersion");
  const coverDraftDate = document.getElementById("exportCoverDraftDate");
  const coverDetails = document.getElementById("exportCoverDetails");
  const coverCopyright = document.getElementById("exportCoverCopyright");
  const locationField = document.getElementById("exportLocationSelect");
  const rangeStart = document.getElementById("exportSceneRangeStart");
  const rangeEnd = document.getElementById("exportSceneRangeEnd");
  const productionRangeStart = document.getElementById("exportProductionRangeStart");
  const productionRangeEnd = document.getElementById("exportProductionRangeEnd");

  if (includeNotes) includeNotes.checked = defaults.includeNotes;
  if (includeComments) includeComments.checked = defaults.includeComments;
  if (includeMetadata) includeMetadata.checked = defaults.includeMetadata;
  if (includeTitlePage) includeTitlePage.checked = defaults.includeTitlePage !== false;
  if (includePageNumbers) includePageNumbers.checked = state.viewOptions.pageNumbers;
  if (includeRevisions) includeRevisions.checked = false;
  if (breakdownCharacters) breakdownCharacters.checked = true;
  if (breakdownLocations) breakdownLocations.checked = true;
  if (breakdownScenes) breakdownScenes.checked = true;
  if (breakdownCharacters) breakdownCharacters.checked = true;
  if (breakdownLocations) breakdownLocations.checked = true;
  if (breakdownScenes) breakdownScenes.checked = true;
  if (enableWatermarkSettings) enableWatermarkSettings.checked = false;
  if (enableWatermarkSettings && !enableWatermarkSettings.dataset.exportBound) {
    enableWatermarkSettings.addEventListener("change", () => updateExportDialogState());
    enableWatermarkSettings.addEventListener("click", () => {
      requestAnimationFrame(() => updateExportDialogState());
    });
    enableWatermarkSettings.dataset.exportBound = "true";
  }
  if (watermarkPreset) watermarkPreset.value = "";
  if (watermarkPosition) watermarkPosition.value = "diagonal";
  if (watermarkOpacity) watermarkOpacity.value = "0.12";
  if (watermarkText) watermarkText.value = "";
  if (coverTitle) coverTitle.value = project?.title || "";
  if (coverSubtitle) coverSubtitle.value = project?.subtitle || "";
  if (coverAuthor) coverAuthor.value = project?.author || "";
  if (coverCoWriters) coverCoWriters.value = project?.coWriters || "";
  if (coverContact) coverContact.value = project?.contact || "";
  if (coverCompany) coverCompany.value = project?.company || "";
  if (coverVersion) coverVersion.value = project?.coverVersion || (project?.version ? String(project.version) : "");
  if (coverDraftDate) coverDraftDate.value = project?.draftDate || "";
  if (coverDetails) coverDetails.value = project?.details || "";
  if (coverCopyright) coverCopyright.value = project?.copyrightNotice || "";
  if (rangeStart) {
    rangeStart.value = "";
    rangeStart.min = sceneCount ? "1" : "0";
    rangeStart.max = String(sceneCount);
  }
  if (rangeEnd) {
    rangeEnd.value = "";
    rangeEnd.min = sceneCount ? "1" : "0";
    rangeEnd.max = String(sceneCount);
  }
  if (productionRangeStart) {
    productionRangeStart.value = "";
    productionRangeStart.min = sceneCount ? "1" : "0";
    productionRangeStart.max = String(sceneCount);
  }
  if (productionRangeEnd) {
    productionRangeEnd.value = "";
    productionRangeEnd.min = sceneCount ? "1" : "0";
    productionRangeEnd.max = String(sceneCount);
  }
  if (locationField) locationField.value = "";
  if (productionLocationSelect) productionLocationSelect.value = "";
  if (productionTimeSelect) productionTimeSelect.value = "";
  const breakdownPrompt = document.getElementById("exportBreakdownPrompt");
  const breakdownCharactersMin = document.getElementById("exportBreakdownCharactersMin");
  const breakdownCharactersMax = document.getElementById("exportBreakdownCharactersMax");
  const breakdownLocationsMin = document.getElementById("exportBreakdownLocationsMin");
  const breakdownLocationsMax = document.getElementById("exportBreakdownLocationsMax");
  const breakdownScenesMin = document.getElementById("exportBreakdownScenesMin");
  const breakdownScenesMax = document.getElementById("exportBreakdownScenesMax");
  const breakdownThemeMin = document.getElementById("exportBreakdownThemeMin");
  const breakdownThemeMax = document.getElementById("exportBreakdownThemeMax");
  const breakdownStyleMin = document.getElementById("exportBreakdownStyleMin");
  const breakdownStyleMax = document.getElementById("exportBreakdownStyleMax");
  const breakdownSceneryMin = document.getElementById("exportBreakdownSceneryMin");
  const breakdownSceneryMax = document.getElementById("exportBreakdownSceneryMax");
  const breakdownPropsMin = document.getElementById("exportBreakdownPropsMin");
  const breakdownPropsMax = document.getElementById("exportBreakdownPropsMax");
  const exportModeSelect = document.getElementById("exportModeSelect");
  const exportIncludeSceneNumbers = document.getElementById("exportIncludeSceneNumbers");
  if (breakdownPrompt) breakdownPrompt.value = "";
  if (breakdownCharactersMin) breakdownCharactersMin.value = "120";
  if (breakdownCharactersMax) breakdownCharactersMax.value = "220";
  if (breakdownLocationsMin) breakdownLocationsMin.value = "120";
  if (breakdownLocationsMax) breakdownLocationsMax.value = "220";
  if (breakdownScenesMin) breakdownScenesMin.value = "160";
  if (breakdownScenesMax) breakdownScenesMax.value = "280";
  if (breakdownThemeMin) breakdownThemeMin.value = "140";
  if (breakdownThemeMax) breakdownThemeMax.value = "260";
  if (breakdownStyleMin) breakdownStyleMin.value = "120";
  if (breakdownStyleMax) breakdownStyleMax.value = "220";
  if (breakdownSceneryMin) breakdownSceneryMin.value = "120";
  if (breakdownSceneryMax) breakdownSceneryMax.value = "220";
  if (breakdownPropsMin) breakdownPropsMin.value = "100";
  if (breakdownPropsMax) breakdownPropsMax.value = "180";
  if (exportModeSelect && !exportModeSelect.value) exportModeSelect.value = "spec";
  if (exportIncludeSceneNumbers) exportIncludeSceneNumbers.checked = Boolean(state.autoNumberScenes);
  resetBreakdownLivePanel();
  const exportBtn = document.getElementById("exportDialogExportBtn");
  if (exportBtn) exportBtn.hidden = true;
  updateExportDialogState();
  renderExportCenter(project);
  renderExportPresetOptions(project);

  if (dialog.open) {
    dialog.close();
  }
  dialog.showModal();
  if (exportDialogMode === "report") {
    ensureReportEditor();
    if (!restoreSavedReportDraft(project)) {
      const { card, title, meta } = getBreakdownLiveNodes();
      if (card) card.hidden = false;
      if (title) title.textContent = "Result";
      if (meta) meta.textContent = "Start typing here, load a saved report, or generate AI content.";
      setReportEditorEditing(true);
    }
    updateExportDialogState();
  } else {
    scheduleExportPreviewRefresh(true);
  }
}

function closeExportDialog() {
  reportDraftRequest = null;
  if (exportPreviewRefreshTimer) {
    window.clearTimeout(exportPreviewRefreshTimer);
    exportPreviewRefreshTimer = 0;
  }
  if (exportPreviewOpenUrl) {
    URL.revokeObjectURL(exportPreviewOpenUrl);
    exportPreviewOpenUrl = "";
  }
  exportDialogProjectId = "";
  setExportPreviewState({ message: "Preview will appear here for the current export selection." });
  document.getElementById("exportDialog")?.close();
}

function setReportEditing(enabled) {
  setReportEditorEditing(enabled);
}

function buildSavedReportName(generatedSections = [], updatedAt = new Date().toISOString()) {
  const labels = generatedSections
    .map((section) => String(section?.label || "").trim())
    .filter(Boolean);
  if (!labels.length) {
    return `Saved Report - ${formatDateTime(updatedAt)}`;
  }
  const lead = labels[0];
  const extraCount = labels.length - 1;
  const summary = extraCount > 0 ? `${lead} + ${extraCount} more` : lead;
  return `${summary} - ${formatDateTime(updatedAt)}`;
}

function saveReportDraftFromLiveOutput({ autosave = false } = {}) {
  const project = getCurrentProject();
  if (!project) return;
  const generatedSections = readReportSectionsFromLiveOutput();
  const updatedAt = new Date().toISOString();
  const draftName = buildSavedReportName(generatedSections, updatedAt);
  const draft = {
    html: getReportEditorHtml(),
    generatedSections,
    request: reportDraftRequest ? { ...reportDraftRequest, generatedSections } : null,
    updatedAt
  };
  project.reportDraft = draft;
  project.reportDrafts = Array.isArray(project.reportDrafts) ? project.reportDrafts : [];
  const targetDraftId = activeReportDraftId || selectedReportDraftLoadId || uid("reportDraft");
  const existingIndex = project.reportDrafts.findIndex((entry) => entry.id === targetDraftId);
  const existingEntry = existingIndex >= 0 ? project.reportDrafts[existingIndex] : null;
  const savedEntry = {
    id: targetDraftId,
    name: draftName,
    html: draft.html,
    generatedSections,
    request: draft.request,
    updatedAt,
    revisions: getReportDraftRevisionSnapshots(existingEntry, draft, updatedAt)
  };
  if (existingIndex >= 0) {
    project.reportDrafts.splice(existingIndex, 1);
  }
  project.reportDrafts.unshift(savedEntry);
  project.reportDrafts = project.reportDrafts.slice(0, 12);
  activeReportDraftId = targetDraftId;
  selectedReportDraftLoadId = targetDraftId;
  project.updatedAt = draft.updatedAt;
  upsertProject(project);
  persistProjects(true);
  if (draft.request) {
    draft.request.reportHtml = draft.html;
  }
  reportDraftRequest = draft.request || reportDraftRequest;
  if (!autosave) {
    const liveMeta = document.getElementById("exportBreakdownLiveMeta");
    if (liveMeta) {
      const revisionCount = savedEntry.revisions?.length || 1;
      liveMeta.textContent = `Saved ${formatDateTime(updatedAt)}. ${revisionCount} revision${revisionCount === 1 ? "" : "s"} stored.`;
    }
  }
}

function restoreSavedReportDraft(project = getCurrentProject()) {
  const draft = project?.reportDraft;
  if (!draft?.html) return false;
  const { card, title, meta } = getBreakdownLiveNodes();
  if (card) card.hidden = false;
  if (title) title.textContent = "Result";
  if (meta) meta.textContent = `Restored last saved draft from ${formatDateTime(draft.updatedAt)}.`;
  setReportEditorHtml(draft.html);
  setReportEditing(false);
  const generatedSections = Array.isArray(draft.generatedSections) ? draft.generatedSections : readReportSectionsFromLiveOutput();
  reportDraftRequest = draft.request
    ? { ...draft.request, generatedSections, reportHtml: draft.html }
    : {
        ...buildExportRequestFromDialog(project),
        generatedSections,
        reportHtml: draft.html
      };
  activeReportDraftId = "";
  return true;
}

function applyLoadedReportDraft(entry, project = getCurrentProject()) {
  if (!entry || !project) return false;
  const { card, title, meta } = getBreakdownLiveNodes();
  if (card) card.hidden = false;
  if (title) title.textContent = "Result";
  if (meta) meta.textContent = `Loaded saved report from ${formatDateTime(entry.updatedAt)}.`;
  setReportEditorHtml(entry.html || "");
  setReportEditing(false);
  const generatedSections = Array.isArray(entry.generatedSections) ? entry.generatedSections : [];
  reportDraftRequest = entry.request
    ? { ...entry.request, generatedSections, reportHtml: entry.html || "" }
    : {
        ...buildExportRequestFromDialog(project),
        generatedSections,
        reportHtml: entry.html || ""
      };
  activeReportDraftId = entry.id || "";
  selectedReportDraftLoadId = entry.id || "";
  const revisionCount = Array.isArray(entry.revisions) ? entry.revisions.length : 0;
  if (meta) meta.textContent = `Loaded saved report from ${formatDateTime(entry.updatedAt)}.${revisionCount ? ` ${revisionCount} revision${revisionCount === 1 ? "" : "s"} available.` : ""}`;
  updateExportDialogState();
  return true;
}

function applyLoadedReportRevision(entry, revision, project = getCurrentProject()) {
  if (!entry || !revision || !project) return false;
  const revisionHtml = String(revision.html || entry.html || "");
  const generatedSections = Array.isArray(revision.generatedSections)
    ? revision.generatedSections
    : Array.isArray(entry.generatedSections)
      ? entry.generatedSections
      : [];
  const requestBase = revision.request || entry.request || null;
  const { card, title, meta } = getBreakdownLiveNodes();
  if (card) card.hidden = false;
  if (title) title.textContent = "Result";
  setReportEditorHtml(revisionHtml);
  setReportEditing(false);
  reportDraftRequest = requestBase
    ? { ...requestBase, generatedSections, reportHtml: revisionHtml }
    : {
        ...buildExportRequestFromDialog(project),
        generatedSections,
        reportHtml: revisionHtml
      };
  activeReportDraftId = entry.id || "";
  selectedReportDraftLoadId = entry.id || "";
  selectedReportDraftRevisionId = revision.id || "";
  if (meta) {
    meta.textContent = `Loaded revision from ${formatDateTime(revision.updatedAt || entry.updatedAt)} for ${entry.name || "Saved Report"}.`;
  }
  updateExportDialogState();
  return true;
}

function renderReportDraftRevisionOptions(entry) {
  const revisionList = document.getElementById("reportDraftRevisionList");
  const revisionEmpty = document.getElementById("reportDraftRevisionEmpty");
  const applyBtn = document.getElementById("reportDraftLoadApplyBtn");
  if (!revisionList || !revisionEmpty || !applyBtn) return;
  if (!entry) {
    revisionList.hidden = true;
    revisionList.innerHTML = "";
    revisionEmpty.hidden = false;
    revisionEmpty.textContent = "Select a saved report to view its revisions.";
    selectedReportDraftRevisionId = "";
    applyBtn.disabled = !selectedReportDraftLoadId;
    return;
  }
  const revisions = Array.isArray(entry.revisions) && entry.revisions.length
    ? entry.revisions
    : [{
        id: `${entry.id || "report"}-latest`,
        updatedAt: entry.updatedAt,
        html: entry.html || "",
        generatedSections: entry.generatedSections || [],
        request: entry.request || null
      }];
  if (!revisions.some((revision) => revision.id === selectedReportDraftRevisionId)) {
    selectedReportDraftRevisionId = revisions[0].id;
  }
  revisionEmpty.hidden = true;
  revisionList.hidden = false;
  revisionList.innerHTML = revisions.map((revision, index) => `
    <label class="report-draft-load-item">
      <input type="radio" name="reportDraftRevisionChoice" value="${escapeHtml(revision.id)}"${revision.id === selectedReportDraftRevisionId ? " checked" : ""}>
      <span class="report-draft-load-copy">
        <strong>${escapeHtml(index === 0 ? "Latest revision" : `Revision ${revisions.length - index}`)}</strong>
        <em>${escapeHtml(formatDateTime(revision.updatedAt || entry.updatedAt))}</em>
        <small>${escapeHtml(getPlainReportTextPreview(revision.html || "", 120))}</small>
      </span>
    </label>
  `).join("");
  revisionList.querySelectorAll("input[name='reportDraftRevisionChoice']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedReportDraftRevisionId = input.value;
      applyBtn.disabled = !selectedReportDraftLoadId;
    });
  });
  applyBtn.disabled = !selectedReportDraftLoadId;
}

function renderReportDraftLoadDialog(project = getCurrentProject()) {
  const list = document.getElementById("reportDraftLoadList");
  const empty = document.getElementById("reportDraftLoadEmpty");
  const applyBtn = document.getElementById("reportDraftLoadApplyBtn");
  if (!list || !empty || !applyBtn) return;
  const drafts = Array.isArray(project?.reportDrafts) ? project.reportDrafts : [];
  if (!drafts.length) {
    list.hidden = true;
    list.innerHTML = "";
    empty.hidden = false;
    renderReportDraftRevisionOptions(null);
    applyBtn.disabled = true;
    return;
  }
  if (!drafts.some((entry) => entry.id === selectedReportDraftLoadId)) {
    selectedReportDraftLoadId = drafts[0].id;
  }
  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = drafts.map((entry) => `
    <label class="report-draft-load-item">
      <input type="radio" name="reportDraftLoadChoice" value="${escapeHtml(entry.id)}"${entry.id === selectedReportDraftLoadId ? " checked" : ""}>
      <span class="report-draft-load-copy">
        <strong>${escapeHtml(entry.name || "Saved Report")}</strong>
        <em>${escapeHtml(formatDateTime(entry.updatedAt))}</em>
        <small>${escapeHtml(`${Array.isArray(entry.revisions) ? entry.revisions.length : 1} revision${(Array.isArray(entry.revisions) ? entry.revisions.length : 1) === 1 ? "" : "s"}`)}</small>
      </span>
    </label>
  `).join("");
  list.querySelectorAll("input[name='reportDraftLoadChoice']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedReportDraftLoadId = input.value;
      selectedReportDraftRevisionId = "";
      const targetEntry = drafts.find((entry) => entry.id === selectedReportDraftLoadId) || null;
      renderReportDraftRevisionOptions(targetEntry);
      applyBtn.disabled = !selectedReportDraftLoadId;
    });
  });
  renderReportDraftRevisionOptions(drafts.find((entry) => entry.id === selectedReportDraftLoadId) || drafts[0] || null);
  applyBtn.disabled = !selectedReportDraftLoadId;
}

function openReportDraftLoadDialog() {
  const project = getCurrentProject();
  const dialog = document.getElementById("reportDraftLoadDialog");
  if (!project || !dialog) return;
  renderReportDraftLoadDialog(project);
  dialog.showModal();
}

function closeReportDraftLoadDialog() {
  document.getElementById("reportDraftLoadDialog")?.close();
}

function loadSelectedReportDraft() {
  const project = getCurrentProject();
  const drafts = Array.isArray(project?.reportDrafts) ? project.reportDrafts : [];
  const entry = drafts.find((item) => item.id === selectedReportDraftLoadId);
  if (!entry) return;
  const revisions = Array.isArray(entry.revisions) ? entry.revisions : [];
  const selectedRevision = revisions.find((revision) => revision.id === selectedReportDraftRevisionId) || null;
  if (selectedRevision) {
    applyLoadedReportRevision(entry, selectedRevision, project);
  } else {
    applyLoadedReportDraft(entry, project);
  }
  closeReportDraftLoadDialog();
  showToast("Saved report loaded.", "success", { duration: 1800 });
}

function renderReportDraftMergeDialog(project = getCurrentProject()) {
  const current = document.getElementById("reportDraftMergeCurrent");
  const list = document.getElementById("reportDraftMergeList");
  const empty = document.getElementById("reportDraftMergeEmpty");
  const applyBtn = document.getElementById("reportDraftMergeApplyBtn");
  if (!current || !list || !empty || !applyBtn) return;
  const drafts = Array.isArray(project?.reportDrafts) ? project.reportDrafts : [];
  const currentHtml = String(getReportEditorHtml() || "").trim();
  const mergeableDrafts = drafts.filter((entry) => {
    if (entry.id === activeReportDraftId) return false;
    const entryHtml = String(entry?.html || "").trim();
    if (currentHtml && entryHtml && entryHtml === currentHtml) return false;
    return true;
  });
  current.innerHTML = `
    <strong>Current report</strong>
    <span>${escapeHtml(getPlainReportTextPreview(currentHtml, 180))}</span>
  `;
  if (!mergeableDrafts.length) {
    list.hidden = true;
    list.innerHTML = "";
    empty.hidden = false;
    applyBtn.disabled = true;
    return;
  }
  if (!mergeableDrafts.some((entry) => entry.id === selectedReportDraftMergeId)) {
    selectedReportDraftMergeId = mergeableDrafts[0].id;
  }
  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = mergeableDrafts.map((entry) => `
    <label class="report-draft-load-item">
      <input type="radio" name="reportDraftMergeChoice" value="${escapeHtml(entry.id)}"${entry.id === selectedReportDraftMergeId ? " checked" : ""}>
      <span class="report-draft-load-copy">
        <strong>${escapeHtml(entry.name || "Saved Report")}</strong>
        <em>${escapeHtml(formatDateTime(entry.updatedAt))}</em>
        <small>${escapeHtml(getPlainReportTextPreview(entry.html || "", 120))}</small>
      </span>
    </label>
  `).join("");
  list.querySelectorAll("input[name='reportDraftMergeChoice']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedReportDraftMergeId = input.value;
      applyBtn.disabled = !selectedReportDraftMergeId;
    });
  });
  applyBtn.disabled = !selectedReportDraftMergeId;
}

function openReportDraftMergeDialog() {
  const project = getCurrentProject();
  const dialog = document.getElementById("reportDraftMergeDialog");
  if (!project || !dialog) return;
  renderReportDraftMergeDialog(project);
  dialog.showModal();
}

function closeReportDraftMergeDialog() {
  document.getElementById("reportDraftMergeDialog")?.close();
}

function mergeSelectedReportDraft() {
  const project = getCurrentProject();
  const drafts = Array.isArray(project?.reportDrafts) ? project.reportDrafts : [];
  const entry = drafts.find((item) => item.id === selectedReportDraftMergeId);
  if (!entry) return;
  const currentHtml = getReportEditorHtml().trim();
  const mergeHeading = entry.name || "Merged Report";
  const mergedHtml = [
    currentHtml,
    `<section class="export-report-section export-report-section-merged"><h4 data-report-section-key="${escapeHtml(entry.id || uid("mergedReport"))}">${escapeHtml(mergeHeading)}</h4><div class="export-report-section-body">${entry.html || "<p></p>"}</div></section>`
  ].filter(Boolean).join("");
  const { card, title, meta } = getBreakdownLiveNodes();
  if (card) card.hidden = false;
  if (title) title.textContent = "Result";
  if (meta) meta.textContent = `Merged saved report from ${formatDateTime(entry.updatedAt)} into the current draft.`;
  setReportEditorHtml(mergedHtml);
  setReportEditing(true);
  const generatedSections = readReportSectionsFromLiveOutput();
  reportDraftRequest = reportDraftRequest
    ? { ...reportDraftRequest, generatedSections, reportHtml: mergedHtml }
    : {
        ...buildExportRequestFromDialog(project),
        generatedSections,
        reportHtml: mergedHtml
      };
  closeReportDraftMergeDialog();
  updateExportDialogState();
  showToast("Saved report merged into the current draft.", "success", { duration: 2200 });
}

function stopReportGeneration() {
  if (!reportGenerationController) return;
  reportGenerationController.abort();
  reportGenerationController = null;
  const progressLabel = document.getElementById("exportProgressLabel");
  const progressDetail = document.getElementById("exportProgressDetail");
  const liveMeta = document.getElementById("exportBreakdownLiveMeta");
  if (progressLabel) progressLabel.textContent = "Generation stopped.";
  if (progressDetail) progressDetail.textContent = "You can edit what was generated so far or run Generate again.";
  if (liveMeta) liveMeta.textContent = "Generation stopped by user.";
}

function updateExportDialogState() {
  const exportTypeSelect = document.getElementById("exportTypeSelect");
  const exportFormatSelect = document.getElementById("exportFormatSelect");
  const exportType = exportTypeSelect?.value || "full";
  const fountainOption = exportFormatSelect?.querySelector("option[value='fountain']");
  const fdxOption = exportFormatSelect?.querySelector("option[value='fdx']");
  const screenplayOnlyFormat = exportType === "production" || exportType === "collaborative" || exportType === "character-packet" || exportType === "location" || exportType === "revision" || exportType === "shooting" || exportType === "breakdown";
  if (fountainOption) {
    fountainOption.disabled = screenplayOnlyFormat;
  }
  if (fdxOption) {
    fdxOption.disabled = screenplayOnlyFormat;
  }
  if (screenplayOnlyFormat && (exportFormatSelect?.value === "fountain" || exportFormatSelect?.value === "fdx")) {
    exportFormatSelect.value = "pdf";
  }
  const format = exportFormatSelect?.value || "pdf";
  const generateBtn = document.getElementById("exportDialogGenerateBtn");
  const exportBtn = document.getElementById("exportDialogExportBtn");
  const inlineGenerateBtn = document.getElementById("exportDialogGenerateInlineBtn");
  const stopBtn = document.getElementById("exportReportStopBtn");
  const editBtn = document.getElementById("exportReportEditBtn");
  const loadBtn = document.getElementById("exportReportLoadBtn");
  const mergeBtn = document.getElementById("exportReportMergeBtn");
  const saveBtn = document.getElementById("exportReportSaveBtn");
  const validationNote = document.getElementById("exportValidationNote");
  const breakdownLiveCard = document.getElementById("exportBreakdownLiveCard");
  const characterPanel = document.getElementById("exportCharacterPanel");
  const characterPacketOptions = document.getElementById("exportCharacterPacketOptions");
  const includeRevisionsToggle = document.getElementById("exportIncludeRevisionsToggle");
  const watermarkPanel = document.getElementById("exportWatermarkPanel");
  const coverPagePanel = document.getElementById("exportCoverPagePanel");
  const coverPageContent = document.getElementById("exportCoverPageContent");
  const coverPageCollapseBtn = document.getElementById("exportCoverPageCollapseBtn");
  const historyContent = document.getElementById("exportHistoryContent");
  const historyCollapseBtn = document.getElementById("exportHistoryCollapseBtn");
  const breakdownPanel = document.getElementById("exportBreakdownPanel");
  const exportTypeDescription = document.getElementById("exportTypeDescription");
  const exportTypeChoices = document.getElementById("exportTypeChoices");
  const exportFormatDescription = document.getElementById("exportFormatDescription");
  const scenePanel = document.getElementById("exportScenePanel");
  const locationPanel = document.getElementById("exportLocationPanel");
  const revisionPanel = document.getElementById("exportRevisionPanel");
  const productionPanel = document.getElementById("exportProductionPanel");
  const collaborativePanel = document.getElementById("exportCollaborativePanel");
  const previewCard = document.getElementById("exportPreviewCard");

  if (characterPanel) {
    const showCharacterPanel = exportType === "character" || exportType === "character-packet";
    characterPanel.hidden = !showCharacterPanel;
    characterPanel.style.display = showCharacterPanel ? "grid" : "none";
  }
  if (characterPacketOptions) {
    const showCharacterPacketOptions = exportType === "character-packet";
    characterPacketOptions.hidden = !showCharacterPacketOptions;
    characterPacketOptions.style.display = showCharacterPacketOptions ? "flex" : "none";
  }
  if (includeRevisionsToggle) {
    const showRevisionsToggle = exportType === "shooting";
    includeRevisionsToggle.hidden = !showRevisionsToggle;
    includeRevisionsToggle.style.display = showRevisionsToggle ? "inline-flex" : "none";
  }
  if (watermarkPanel) {
    const watermarkEnabled = document.getElementById("exportEnableWatermarkSettings")?.checked;
    const showWatermarkPanel = watermarkEnabled;
    watermarkPanel.hidden = !showWatermarkPanel;
    watermarkPanel.style.display = showWatermarkPanel ? "grid" : "none";
  }
  if (coverPagePanel) {
    const coverPageEnabled = document.getElementById("exportIncludeTitlePage")?.checked !== false;
    coverPagePanel.hidden = !coverPageEnabled;
    coverPagePanel.style.display = coverPageEnabled ? "grid" : "none";
  }
  if (coverPageContent && coverPageCollapseBtn) {
    const coverPageEnabled = document.getElementById("exportIncludeTitlePage")?.checked !== false;
    const showCoverPageContent = coverPageEnabled && !exportCoverPageBuilderCollapsed;
    coverPageContent.hidden = !showCoverPageContent;
    coverPageCollapseBtn.hidden = !coverPageEnabled;
    coverPageCollapseBtn.textContent = showCoverPageContent ? "Hide" : "Show";
    coverPageCollapseBtn.setAttribute("aria-expanded", showCoverPageContent ? "true" : "false");
  }
  if (historyContent && historyCollapseBtn) {
    const showHistoryContent = exportDialogMode !== "report" && !exportHistoryCollapsed;
    historyContent.hidden = !showHistoryContent;
    historyCollapseBtn.hidden = exportDialogMode === "report";
    historyCollapseBtn.textContent = showHistoryContent ? "Hide" : "Expand";
    historyCollapseBtn.setAttribute("aria-expanded", showHistoryContent ? "true" : "false");
  }
  if (scenePanel) {
    const showScenePanel = exportType === "scene";
    scenePanel.hidden = !showScenePanel;
    scenePanel.style.display = showScenePanel ? "grid" : "none";
  }
  if (locationPanel) {
    const showLocationPanel = exportType === "location";
    locationPanel.hidden = !showLocationPanel;
    locationPanel.style.display = showLocationPanel ? "grid" : "none";
  }
  if (revisionPanel) {
    const showRevisionPanel = exportType === "revision";
    revisionPanel.hidden = !showRevisionPanel;
    revisionPanel.style.display = showRevisionPanel ? "grid" : "none";
  }
  if (productionPanel) {
    const showProductionPanel = exportType === "production";
    productionPanel.hidden = !showProductionPanel;
    productionPanel.style.display = showProductionPanel ? "grid" : "none";
  }
  if (collaborativePanel) {
    const showCollaborativePanel = exportType === "collaborative";
    collaborativePanel.hidden = !showCollaborativePanel;
    collaborativePanel.style.display = showCollaborativePanel ? "grid" : "none";
  }
  if (breakdownPanel) {
    const showBreakdownPanel = exportType === "breakdown";
    breakdownPanel.hidden = !showBreakdownPanel;
    breakdownPanel.style.display = showBreakdownPanel ? "grid" : "none";
  }
  if (breakdownLiveCard) {
    const showBreakdownLiveCard = exportDialogMode === "report";
    breakdownLiveCard.hidden = !showBreakdownLiveCard;
    breakdownLiveCard.style.display = showBreakdownLiveCard ? "grid" : "none";
  }
  if (previewCard) {
    const showPreviewCard = exportDialogMode !== "report";
    previewCard.hidden = !showPreviewCard;
    previewCard.style.display = showPreviewCard ? "grid" : "none";
  }
  if (exportTypeDescription) {
    exportTypeDescription.textContent = EXPORT_TYPE_DETAILS[exportType] || EXPORT_TYPE_DETAILS.full;
    exportTypeDescription.hidden = exportDialogMode === "report";
    exportTypeDescription.style.display = exportDialogMode === "report" ? "none" : "";
  }
  if (exportTypeChoices) {
    exportTypeChoices.hidden = exportDialogMode === "report";
    exportTypeChoices.style.display = exportDialogMode === "report" ? "none" : "";
  }
  if (exportFormatDescription) {
    exportFormatDescription.textContent = EXPORT_FORMAT_DETAILS[format] || EXPORT_FORMAT_DETAILS.pdf;
    exportFormatDescription.hidden = exportDialogMode === "report";
    exportFormatDescription.style.display = exportDialogMode === "report" ? "none" : "";
  }

  const selectedCharacters = document.querySelectorAll("input[name='exportCharacterName']:checked").length;
  const selectedScenes = document.querySelectorAll("input[name='exportSceneId']:checked").length;
  const selectedProductionCharacters = [...document.querySelectorAll("input[name='exportProductionCharacterName']:checked")].map((input) => input.value);
  const includeMetadata = document.getElementById("exportIncludeMetadata")?.checked;
  const includeTitlePage = document.getElementById("exportIncludeTitlePage")?.checked;
  const location = document.getElementById("exportLocationSelect")?.value || "";
  const rangeStart = Number(document.getElementById("exportSceneRangeStart")?.value || 0);
  const rangeEnd = Number(document.getElementById("exportSceneRangeEnd")?.value || 0);
  const maxSceneCount = Number(document.getElementById("exportSceneRangeEnd")?.max || document.getElementById("exportSceneRangeStart")?.max || 0);
  const hasSceneRange = rangeStart > 0 && rangeEnd > 0;
  const productionLocation = document.getElementById("exportProductionLocationSelect")?.value || "";
  const productionTime = document.getElementById("exportProductionTimeSelect")?.value || "";
  const collaborativeWriter = document.getElementById("exportCollaborativeWriterSelect")?.value || "";
  const collaborativeReviewer = document.getElementById("exportCollaborativeReviewerSelect")?.value || "";
  const collaborativeEditor = document.getElementById("exportCollaborativeEditorSelect")?.value || "";
  const collaborativeStatus = document.getElementById("exportCollaborativeStatusSelect")?.value || "";
  const exportMode = document.getElementById("exportModeSelect")?.value || "spec";
  const productionRangeStart = Number(document.getElementById("exportProductionRangeStart")?.value || 0);
  const productionRangeEnd = Number(document.getElementById("exportProductionRangeEnd")?.value || 0);
  const productionMaxSceneCount = Number(document.getElementById("exportProductionRangeEnd")?.max || document.getElementById("exportProductionRangeStart")?.max || 0);
  const productionRange = parseOptionalRange(productionRangeStart, productionRangeEnd);
  const hasPartialProductionRange = (productionRangeStart > 0 && productionRangeEnd === 0) || (productionRangeStart === 0 && productionRangeEnd > 0);
  const matchedProductionScenes = exportDialogContext.scenes.filter((scene) => sceneMatchesProductionFilters(scene, {
    location: productionLocation,
    timeOfDay: productionTime,
    characters: selectedProductionCharacters,
    sceneRange: productionRange
  }));
  const matchedLocationScenes = exportDialogContext.scenes.filter((scene) => normalizeExportFilterToken(scene.location) === normalizeExportFilterToken(location));
  const matchedCollaborativeScenes = exportDialogContext.collaborative.scenes.filter((scene) => {
    if (collaborativeWriter && !scene.assignedWriters.some((value) => normalizeExportFilterToken(value) === normalizeExportFilterToken(collaborativeWriter))) {
      return false;
    }
    if (collaborativeReviewer && !scene.reviewers.some((value) => normalizeExportFilterToken(value) === normalizeExportFilterToken(collaborativeReviewer))) {
      return false;
    }
    if (collaborativeEditor && !scene.editors.some((value) => normalizeExportFilterToken(value) === normalizeExportFilterToken(collaborativeEditor))) {
      return false;
    }
    if (collaborativeStatus && !scene.statuses.includes(collaborativeStatus)) {
      return false;
    }
    return true;
  });
  const revisionVersionAId = document.getElementById("exportRevisionVersionA")?.value || "";
  const revisionVersionBId = document.getElementById("exportRevisionVersionB")?.value || "";
  const revisionVersionA = exportDialogContext.revisions.find((entry) => entry.id === revisionVersionAId) || null;
  const revisionVersionB = exportDialogContext.revisions.find((entry) => entry.id === revisionVersionBId) || null;
  let validationMessage = "";

  if ((exportType === "character" || exportType === "character-packet") && selectedCharacters === 0) {
    validationMessage = exportType === "character-packet"
      ? "Select at least one character before generating a character packet."
      : "Select at least one character before generating a character export.";
  }
  if (exportType === "scene" && selectedScenes === 0 && !hasSceneRange) {
    validationMessage = "Select scenes or enter a scene range before generating a scene export.";
  }
  if (exportType === "scene" && ((rangeStart > 0 && rangeEnd === 0) || (rangeStart === 0 && rangeEnd > 0))) {
    validationMessage = "Enter both range values if you want to export a scene range.";
  }
  if (exportType === "scene" && hasSceneRange && maxSceneCount && (rangeStart > maxSceneCount || rangeEnd > maxSceneCount)) {
    validationMessage = `Scene range must stay within 1 and ${maxSceneCount}.`;
  }
  if (exportType === "location" && !location) {
    validationMessage = "Choose a location before generating a location export.";
  }
  if (exportType === "location" && location && matchedLocationScenes.length === 0) {
    validationMessage = "No scenes match the selected location.";
  }
  if (exportType === "revision" && (!revisionVersionA || !revisionVersionB)) {
    validationMessage = "Choose two versions before generating a revision export.";
  }
  if (exportType === "revision" && revisionVersionA && revisionVersionB && revisionVersionA.id === revisionVersionB.id) {
    validationMessage = "Choose two different versions before generating a revision export.";
  }
  if (exportType === "production" && hasPartialProductionRange) {
    validationMessage = "Enter both production range values if you want to filter a scene range.";
  }
  if (exportType === "production" && productionRange && productionMaxSceneCount && (productionRange.start > productionMaxSceneCount || productionRange.end > productionMaxSceneCount)) {
    validationMessage = `Production range must stay within 1 and ${productionMaxSceneCount}.`;
  }
  if (exportType === "production" && !hasPartialProductionRange && matchedProductionScenes.length === 0) {
    validationMessage = "No scenes match the current production filters.";
  }
  if (exportType === "collaborative" && matchedCollaborativeScenes.length === 0) {
    validationMessage = "No scenes match the current collaborative filters.";
  }
  if (exportType === "breakdown" && getBreakdownSelections().length === 0) {
    validationMessage = "Select at least one AI report section before generating the report.";
  }

  const typeLabel = exportType === "character"
    ? `${selectedCharacters || 0} character${selectedCharacters === 1 ? "" : "s"}`
    : exportType === "character-packet"
      ? `${selectedCharacters || 0} packet character${selectedCharacters === 1 ? "" : "s"}`
    : exportType === "scene"
      ? (selectedScenes ? `${selectedScenes} selected scene${selectedScenes === 1 ? "" : "s"}` : (hasSceneRange ? `scene range ${Math.min(rangeStart, rangeEnd)}-${Math.max(rangeStart, rangeEnd)}` : "selected scenes"))
      : exportType === "location"
        ? `${matchedLocationScenes.length} location scene${matchedLocationScenes.length === 1 ? "" : "s"}`
      : exportType === "revision"
        ? "revision report"
      : exportType === "production"
        ? `${matchedProductionScenes.length} production scene${matchedProductionScenes.length === 1 ? "" : "s"}`
      : exportType === "collaborative"
        ? `${matchedCollaborativeScenes.length} collaborative scene${matchedCollaborativeScenes.length === 1 ? "" : "s"}`
      : exportType === "shooting"
        ? "shooting script package"
      : exportType === "breakdown"
        ? "AI report"
        : "full screenplay";
  const formatLabel = format.toUpperCase();
  const metadataLabel = includeMetadata ? "with metadata" : "without metadata";

  const summaryText = document.getElementById("exportSummaryText");
  const summaryTitle = document.getElementById("exportSummaryTitle");
  const summaryChips = document.getElementById("exportSummaryChips");
  const summaryHint = document.getElementById("exportSummaryHint");
  const previewGrid = document.getElementById("exportPreviewGrid");
  const previewScenes = document.getElementById("exportPreviewScenes");
  const previewCharacters = document.getElementById("exportPreviewCharacters");
  const previewPages = document.getElementById("exportPreviewPages");
  const previewSize = document.getElementById("exportPreviewSize");
  if (summaryText) {
    summaryText.textContent = `Export ${typeLabel} as ${formatLabel}, ${metadataLabel}.`;
    summaryText.hidden = exportDialogMode === "report";
    summaryText.style.display = exportDialogMode === "report" ? "none" : "";
  }
  if (summaryTitle) {
    summaryTitle.textContent = exportDialogMode === "report"
      ? "AI report workspace"
      : exportType === "full"
      ? "Ready to export the whole screenplay:"
      : exportType === "character"
        ? "Ready to export character pages:"
      : exportType === "character-packet"
        ? "Ready to export the character packet:"
        : exportType === "scene"
          ? "Ready to export selected scenes:"
          : exportType === "location"
            ? "Ready to export the location packet:"
          : exportType === "revision"
            ? "Ready to export the revision report:"
          : exportType === "production"
            ? "Ready to export the production packet:"
            : exportType === "collaborative"
              ? "Ready to export the collaborative packet:"
            : exportType === "breakdown"
              ? "Ready to build the AI report:"
            : "Ready to export the shooting script:";
  }
  if (summaryChips) {
    const chips = [
      exportType === "full" ? "Full Script" : exportType === "character" ? "Character Export" : exportType === "character-packet" ? "Character Packet" : exportType === "scene" ? "Scene Export" : exportType === "location" ? "Location Export" : exportType === "revision" ? "Revision Export" : exportType === "production" ? "Production Export" : exportType === "collaborative" ? "Collaborative Export" : exportType === "breakdown" ? "AI Report" : "Shooting Script",
      format.toUpperCase(),
      includeMetadata ? "Metadata on" : "Metadata off"
    ];
    chips.push(exportMode === "production" ? "Production Script" : exportMode === "character" ? "Character Script" : "Spec Script");
    chips.push(includeTitlePage ? "Title page on" : "No title page");
    if (exportType === "character" || exportType === "character-packet") {
      chips.push(`${selectedCharacters || 0} selected`);
    }
    if (exportType === "character-packet" && document.getElementById("exportIncludeSceneDescriptions")?.checked) {
      chips.push("Scene descriptions");
    }
    if (exportType === "scene") {
      chips.push(selectedScenes ? `${selectedScenes} selected` : hasSceneRange ? `Range ${Math.min(rangeStart, rangeEnd)}-${Math.max(rangeStart, rangeEnd)}` : "Selection needed");
    }
    if (exportType === "location") {
      chips.push(location || "Choose location");
      if (location) chips.push(`${matchedLocationScenes.length} scenes`);
    }
    if (exportType === "revision") {
      chips.push(revisionVersionA?.label || "Choose version A");
      chips.push(revisionVersionB?.label || "Choose version B");
    }
    if (exportType === "production") {
      chips.push(`${matchedProductionScenes.length} scenes`);
      if (productionLocation) chips.push(productionLocation);
      if (productionTime) chips.push(productionTime);
      if (productionRange) chips.push(`Range ${productionRange.start}-${productionRange.end}`);
      if (selectedProductionCharacters.length) chips.push(`${selectedProductionCharacters.length} character${selectedProductionCharacters.length === 1 ? "" : "s"}`);
    }
    if (exportType === "collaborative") {
      chips.push(`${matchedCollaborativeScenes.length} scenes`);
      if (collaborativeWriter) chips.push(collaborativeWriter);
      if (collaborativeReviewer) chips.push(`Reviewer: ${collaborativeReviewer}`);
      if (collaborativeEditor) chips.push(`Editor: ${collaborativeEditor}`);
      if (collaborativeStatus) chips.push(collaborativeStatus);
    }
    if (exportType === "shooting") {
      chips.push("Locked scene numbers");
      if (document.getElementById("exportIncludeRevisions")?.checked) chips.push("Revisions on");
      if (document.getElementById("exportIncludePageNumbers")?.checked) chips.push("Page numbers on");
    }
    if (exportType === "breakdown") {
      chips.push(`${getBreakdownSelections().length} selected`);
    }
    if (document.getElementById("exportEnableWatermarkSettings")?.checked) {
      const watermarkPreset = document.getElementById("exportWatermarkPreset")?.value || "";
      const watermarkText = document.getElementById("exportWatermarkText")?.value || "";
      const watermarkPosition = document.getElementById("exportWatermarkPosition")?.value || "diagonal";
      const watermarkOpacity = document.getElementById("exportWatermarkOpacity")?.value || "0.12";
      chips.push(watermarkText || watermarkPreset || "CONFIDENTIAL");
      chips.push(watermarkPosition);
      chips.push(`${Math.round(Number(watermarkOpacity) * 100)}% opacity`);
    }
    summaryChips.innerHTML = chips.map((chip) => `<span class="export-summary-chip">${escapeHtml(chip)}</span>`).join("");
    summaryChips.hidden = exportDialogMode === "report";
    summaryChips.style.display = exportDialogMode === "report" ? "none" : "";
  }
  if (summaryHint) {
    summaryHint.textContent = exportDialogMode === "report"
      ? "Generate the report, refine the live text if needed, then export it."
      : exportType === "character"
      ? "Character exports keep scene-heading context from the structured screenplay."
      : exportType === "character-packet"
        ? "Character packets add scene counts, line counts, and first/last appearance stats for each selected character."
      : exportType === "scene"
        ? "Scene exports can be built from checked scenes or a scene-number range."
        : exportType === "location"
          ? "Location exports collect every scene, character, and time-of-day detail for the selected location."
        : exportType === "revision"
          ? "Revision exports compare two saved versions and report added scenes, removed scenes, and changed screenplay text."
        : exportType === "production"
          ? "Production exports collect filtered scenes with descriptions, dialogue, and characters present."
        : exportType === "collaborative"
          ? "Collaborative exports gather scenes that match workspace assignments, review activity, and status filters."
        : exportType === "breakdown"
          ? "AI report reads the screenplay and writes focused character, location, and scene insight for the selected sections."
        : exportType === "shooting"
          ? "Shooting scripts keep scene numbers locked and carry revision-aware page formatting for production use."
          : document.getElementById("exportEnableWatermarkSettings")?.checked
            ? "This export will include a configurable watermark on the generated pages."
            : "Full script exports include the whole screenplay package in the chosen format.";
    summaryHint.hidden = false;
  }
  if (previewGrid) {
    previewGrid.hidden = exportDialogMode === "report";
    previewGrid.style.display = exportDialogMode === "report" ? "none" : "";
  }

  let previewSceneCount = exportDialogContext.scenes.length;
  let previewCharacterCount = exportDialogContext.characters.length;
  let previewLineCount = exportDialogContext.scenes.reduce((total, scene) => total + 1 + (scene.characters?.length || 0), 0);

  if (exportType === "character" || exportType === "character-packet") {
    previewSceneCount = exportDialogContext.scenes.filter((scene) => scene.characters?.some((character) => [...document.querySelectorAll("input[name='exportCharacterName']:checked")].map((input) => normalizeExportFilterToken(input.value)).includes(normalizeExportFilterToken(character)))).length;
    previewCharacterCount = selectedCharacters;
    previewLineCount = Math.max(previewSceneCount * 6, selectedCharacters * 5);
  } else if (exportType === "scene") {
    previewSceneCount = selectedScenes || (hasSceneRange ? (Math.max(rangeStart, rangeEnd) - Math.min(rangeStart, rangeEnd) + 1) : 0);
    previewCharacterCount = Math.max(1, Math.min(exportDialogContext.characters.length, previewSceneCount * 2));
    previewLineCount = Math.max(previewSceneCount * 8, previewCharacterCount * 3);
  } else if (exportType === "location") {
    previewSceneCount = matchedLocationScenes.length;
    previewCharacterCount = new Set(matchedLocationScenes.flatMap((scene) => scene.characters || []).map((character) => normalizeExportFilterToken(character))).size;
    previewLineCount = Math.max(previewSceneCount * 8, previewCharacterCount * 3);
  } else if (exportType === "revision") {
    previewSceneCount = revisionVersionA && revisionVersionB ? 2 : 0;
    previewCharacterCount = 0;
    previewLineCount = revisionVersionA && revisionVersionB ? 18 : 0;
  } else if (exportType === "production") {
    previewSceneCount = matchedProductionScenes.length;
    previewCharacterCount = new Set(matchedProductionScenes.flatMap((scene) => scene.characters || []).map((character) => normalizeExportFilterToken(character))).size;
    previewLineCount = Math.max(previewSceneCount * 8, previewCharacterCount * 3);
  } else if (exportType === "collaborative") {
    previewSceneCount = matchedCollaborativeScenes.length;
    previewCharacterCount = new Set(exportDialogContext.scenes.filter((scene) => matchedCollaborativeScenes.some((entry) => entry.id === scene.id)).flatMap((scene) => scene.characters || []).map((character) => normalizeExportFilterToken(character))).size;
    previewLineCount = Math.max(previewSceneCount * 8, previewCharacterCount * 3);
  } else if (exportType === "shooting") {
    previewSceneCount = exportDialogContext.scenes.length;
    previewCharacterCount = exportDialogContext.characters.length;
    previewLineCount = Math.max(exportDialogContext.scenes.length * 8, exportDialogContext.characters.length * 3);
  } else if (exportType === "breakdown") {
    previewSceneCount = exportDialogContext.scenes.length;
    previewCharacterCount = exportDialogContext.characters.length;
    previewLineCount = Math.max(exportDialogContext.scenes.length * 4, exportDialogContext.characters.length * 4);
  }

  if (previewScenes) previewScenes.textContent = String(previewSceneCount);
  if (previewCharacters) previewCharacters.textContent = String(previewCharacterCount);
  if (previewPages) previewPages.textContent = String(estimateExportPages(previewLineCount));
  if (previewSize) previewSize.textContent = estimateExportFileSize(previewLineCount, format, previewSceneCount, previewCharacterCount);

  if (generateBtn) {
    generateBtn.textContent = exportDialogMode === "report"
      ? "Build AI Report"
      : exportType === "production"
      ? (format === "pdf" ? "Download Production PDF" : "Download Production DOCX")
      : exportType === "collaborative"
      ? (format === "pdf" ? "Download Collaborative PDF" : "Download Collaborative DOCX")
      : exportType === "location"
        ? (format === "pdf" ? "Download Location PDF" : "Download Location DOCX")
      : exportType === "revision"
        ? (format === "pdf" ? "Download Revision PDF" : "Download Revision DOCX")
      : exportType === "character-packet"
        ? (format === "pdf" ? "Download Character Packet PDF" : "Download Character Packet DOCX")
      : exportType === "breakdown"
        ? (format === "pdf" ? "Download Report PDF" : "Download Report DOCX")
      : exportType === "shooting"
        ? (format === "pdf" ? "Download Shooting Script PDF" : "Download Shooting Script DOCX")
      : format === "pdf"
        ? "Download"
        : format === "docx"
          ? "Download DOCX"
          : format === "fdx"
            ? "Download FDX"
            : "Download Fountain";
    generateBtn.disabled = Boolean(validationMessage);
    generateBtn.hidden = exportDialogMode === "report";
  }
  if (inlineGenerateBtn) {
    inlineGenerateBtn.hidden = exportDialogMode !== "report";
    inlineGenerateBtn.disabled = Boolean(validationMessage) || Boolean(reportGenerationController);
  }
  if (stopBtn) {
    stopBtn.hidden = false;
    stopBtn.style.display = exportDialogMode === "report" ? "" : "none";
    stopBtn.disabled = !reportGenerationController;
  }
  if (exportBtn) {
    exportBtn.hidden = false;
    exportBtn.style.display = exportDialogMode === "report" ? "" : "none";
    exportBtn.disabled = !reportDraftRequest?.generatedSections?.length;
    exportBtn.textContent = format === "docx" ? "Build Report DOCX" : "Build Report PDF";
  }
  if (editBtn) {
    editBtn.hidden = false;
    editBtn.style.display = exportDialogMode === "report" ? "" : "none";
    editBtn.disabled = !reportDraftRequest?.generatedSections?.length;
  }
  if (loadBtn) {
    loadBtn.hidden = false;
    loadBtn.style.display = exportDialogMode === "report" ? "" : "none";
    loadBtn.disabled = !(getCurrentProject()?.reportDrafts?.length);
  }
  if (mergeBtn) {
    mergeBtn.hidden = false;
    mergeBtn.style.display = exportDialogMode === "report" ? "" : "none";
    mergeBtn.disabled = !(getCurrentProject()?.reportDrafts?.length);
  }
  if (saveBtn) {
    saveBtn.hidden = false;
    saveBtn.style.display = exportDialogMode === "report" ? "" : "none";
    saveBtn.disabled = !hasReportEditorContent();
  }
  if (breakdownLiveCard && exportDialogMode !== "report") {
    breakdownLiveCard.hidden = true;
  }
  if (validationNote) {
    validationNote.hidden = !validationMessage;
    validationNote.textContent = validationMessage;
  }
  const liveTitle = document.getElementById("exportBreakdownLiveTitle");
  if (liveTitle && exportDialogMode === "report" && liveTitle.textContent !== "Result") {
    liveTitle.textContent = "Result";
  }
  if (exportDialogMode !== "report") {
    scheduleExportPreviewRefresh();
  }
}

async function runExportResult(result, project, actionLabel) {
  if (result.transport === "print-html") {
    await openPrintExportHtml(result.content, project, actionLabel);
    return;
  }
  downloadFile(result.filename, result.content, result.mimeType || DOCX_MIME_TYPE);
}

async function generateExportFromDialog() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;

  const generateBtn = document.getElementById("exportDialogGenerateBtn");
  let request = buildExportRequestFromDialog(project);
  try {
    if (generateBtn) generateBtn.disabled = true;
    if (request.exportType === "breakdown") {
      request = await generateBreakdownSections(project, request);
      request.generatedSections = readReportSectionsFromLiveOutput();
      reportDraftRequest = request;
      setReportEditing(false);
      updateExportDialogState();
      return;
    }
    enqueueExportJob(project, request);
    if (request.exportType !== "breakdown") {
      closeExportDialog();
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    console.error("Screenplay export failed", error);
    await customAlert(
      error instanceof Error ? error.message : "The report could not be generated. Please try again after the export engine finishes loading.",
      request.exportType === "breakdown" ? "Report" : "Screenplay Export"
    );
  } finally {
    if (request.exportType !== "breakdown") {
      resetBreakdownLivePanel();
    }
    updateExportDialogState();
  }
}

async function exportReportFromDialog() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project || !reportDraftRequest) return;
  const request = {
    ...reportDraftRequest,
    generatedSections: readReportSectionsFromLiveOutput(),
    reportHtml: getReportEditorHtml()
  };
  if (!request.generatedSections.length) {
    await customAlert("Build the AI report first before exporting it.", "Report");
    return;
  }
  reportDraftRequest = request;
  enqueueExportJob(project, request);
}

function openPreviewWindow(autoPrint) {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const previewWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    customAlert("Allow pop-ups for this site so EyaWriter can open the print window for PDF export.", "PDF Export");
    return;
  }
  previewWindow.document.open();
  previewWindow.document.write(buildPrintableDocument(project, autoPrint));
  previewWindow.document.close();
  previewWindow.focus();
}

async function openPrintExportHtml(html, project, activityMessage = "Opened the project print flow for PDF export.") {
  const existingFrame = document.querySelector("#printExportFrame");
  if (existingFrame) {
    existingFrame.remove();
  }

  const frame = document.createElement("iframe");
  frame.id = "printExportFrame";
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
  frame.onload = () => {
    const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        cleanup();
        customAlert("PDF export could not open the print dialog. Try again or use Print from the output menu.", "PDF Export");
        return;
      }

    frameWindow.focus();
      window.setTimeout(() => {
        try {
          frameWindow.print();
          logActivity(project.id, activityMessage, { action: "export.pdf", workspaceId: project.workspace?.id || project.id }).catch(() => {});
        } catch (error) {
          console.error("Unable to start PDF print flow", error);
          customAlert("PDF export could not open the print dialog. Try again or use Print from the output menu.", "PDF Export");
        } finally {
          cleanup();
      }
    }, 350);
  };
  frame.srcdoc = decorateExportPreviewHtml(String(html || buildPrintableDocument(project, false)));
}

async function printWithHiddenFrame() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const exportToast = showToast("Preparing PDF export...", "loading", { duration: 0 });
  try {
    const result = await ExportService.exportFullScript(project, {
      format: "pdf",
      options: {
        includeNotes: false,
        includeComments: false,
        includeSceneNumbers: state.autoNumberScenes,
        includeMetadata: true,
        includeTitlePage: true,
        includePageNumbers: state.viewOptions.pageNumbers
      }
    });
    await openPrintExportHtml(result.content, project);
    updateToast(exportToast, "Print dialog opened.", "success", { duration: 2400 });
  } catch (error) {
    console.error("Unable to build PDF export", error);
    updateToast(exportToast, "PDF export failed.", "error", { duration: 4200 });
    customAlert("PDF export could not be prepared. Try again after the export engine finishes loading.", "PDF Export");
  }
}

function buildPreparedExportLines(project) {
  let sceneNumber = 0;

  return project.lines.reduce((accumulator, line) => {
    const normalized = formatLineText(line.text, line.type);
    if (!normalized) {
      return accumulator;
    }

    if (line.type === "scene") {
      sceneNumber += 1;
    }

    accumulator.push({
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized
    });

    return accumulator;
  }, []);
}

function importFile(event) {
  const [file] = event.target.files || [];
  const project = getCurrentProject();
  if (!file || !project) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    let nextProject;

    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        nextProject = sanitizeProject(JSON.parse(text));
      } catch (error) {
        console.error("Invalid JSON import", error);
        return;
      }
    } else {
      const hasCustomProjectTitle = String(project.title || "").trim()
        && !/^(Untitled Script|Film Script \d+)$/i.test(String(project.title || "").trim());
      nextProject = sanitizeProject({
        ...project,
        title: hasCustomProjectTitle ? project.title : file.name.replace(/\.[^.]+$/, ""),
        lines: parseTextToLines(text)
      });
    }

    nextProject.id = uid();
    nextProject.createdAt = new Date().toISOString();
    upsertProject(nextProject);
    openProject(nextProject.id);
    persistProjects(true);
  };

  reader.readAsText(file);
  refs.fileInput.value = "";
}

async function convertImportFile(event) {
  const [file] = event.target.files || [];
  const project = state.projects.find((entry) => entry.id === pendingConvertImportProjectId)
    || getCurrentProject();

  refs.convertImportInput.value = "";
  pendingConvertImportProjectId = "";

  if (!file || !project) return;

  await runConvertImportPipeline(file, project);
}

async function runConvertImportPipeline(file, project, options = {}) {
  if (!file || !project) return;

  const seedRecord = options.seedRecord || null;
  const jobId = options.existingJobId || await beginConversionUpload({
    fileName: file.name,
    projectId: project.id
  });
  await attachSourceFileToConversionJob(jobId, file);
  await openConversionLiveDialog(jobId, project.id);
  const loadingToast = showToast("Uploading your script to the conversion workspace...", "loading", { duration: 0 });

  try {
    updateToast(loadingToast, "Uploading your script to the conversion workspace...", "loading", { duration: 0 });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const savedRawText = String(seedRecord?.rawText || "");
    const savedNormalizedText = String(seedRecord?.normalizedText || "");
    const hasEditedRawText = Boolean(seedRecord?.rawTextEditedAt && savedRawText.trim());
    const hasEditedNormalizedText = Boolean(seedRecord?.normalizedTextEditedAt && savedNormalizedText.trim());

    let rawText = savedRawText;
    if (hasEditedRawText) {
      updateToast(loadingToast, "Using your saved extracted text edits...", "loading", { duration: 0 });
      await attachRawTextToConversionJob(jobId, rawText);
    } else {
      await markConversionExtractionStarted(jobId);
      updateToast(loadingToast, "Extracting readable text from your file...", "loading", { duration: 0 });
      rawText = await extractScriptTextFromFile(file, {
        onProgress: (message) => updateToast(loadingToast, message, "loading", { duration: 0 })
      });
      await attachRawTextToConversionJob(jobId, rawText);
    }

    updateToast(loadingToast, "Normalizing the screenplay text before conversion...", "loading", { duration: 0 });

    const result = await convertScriptTextToLines(rawText, {
      fileName: file.name,
      jobId,
      projectId: project.id,
      preparedNormalizedText: hasEditedNormalizedText ? savedNormalizedText : "",
      preparedCoverPage: seedRecord?.coverPageCandidate || null,
      onProgress: (message) => updateToast(loadingToast, message, "loading", { duration: 0 })
    });

  const liveWorkspacePatch = captureActiveConversionWorkspacePatch(result.jobId || jobId);
  const finalLines = Array.isArray(liveWorkspacePatch?.structuredLines) && liveWorkspacePatch.structuredLines.length
    ? liveWorkspacePatch.structuredLines
    : result.lines;
  const finalCoverPage = liveWorkspacePatch?.coverPageCandidate || result.coverPage;
  if (liveWorkspacePatch) {
    conversionWorkspaceOverrides.set(result.jobId || jobId, liveWorkspacePatch);
  }

    await markConversionImporting(result.jobId || jobId, finalLines.length);
    updateToast(loadingToast, "Importing converted screenplay into your project...", "loading", { duration: 0 });

    const nextProject = sanitizeProject({
      ...project,
      lines: finalLines,
      conversionJobId: result.jobId || jobId,
      conversionSourceFileName: file.name
    });
    applyCoverPageCandidateToProject(nextProject, finalCoverPage);
    upsertProject(nextProject);
    openProject(nextProject.id, { silentLoadToast: true });
    persistProjects(true);
    await finalizeConversionImport(result.jobId || jobId, {
      usedFallback: result.usedFallback,
      warnings: result.warnings,
      lineCount: finalLines.length
    });
    if (liveWorkspacePatch) {
      await patchConversionJobRecord(result.jobId || jobId, {
        ...liveWorkspacePatch,
        coverPageCandidate: finalCoverPage
      });
    }

    if (result.usedFallback) {
      updateToast(loadingToast, "Imported with a plain-text fallback. Review the structure.", "error", { duration: 5200 });
    } else {
      updateToast(loadingToast, "Converted script imported.", "success", { duration: 3200 });
    }

    if (result.warnings.length) {
      showToast("Conversion finished with notes. Review them in Conversion Review.", "error", { duration: 5200 });
    }
    const persistedRecord = await waitForConversionJobRecord(result.jobId || jobId, { requireStructuredData: true });
    const versionedRecord = await appendConversionJobVersion(result.jobId || jobId, {
      ...(persistedRecord || {}),
      id: result.jobId || jobId,
      fileName: file.name,
      projectId: nextProject.id,
      status: result.usedFallback ? 'imported-with-fallback' : 'imported',
      stageLabel: result.usedFallback ? 'Imported with fallback review needed' : 'Imported into project',
      rawText,
      normalizedText: liveWorkspacePatch?.normalizedText || persistedRecord?.normalizedText || '',
      coverPageCandidate: finalCoverPage || persistedRecord?.coverPageCandidate || null,
      structuredLines: finalLines,
      structuredLineCount: finalLines.length,
      warnings: result.warnings || [],
      sourceFile: persistedRecord?.sourceFile || { name: file.name, type: file.type || '', size: Number(file.size) || 0 }
    }, {
      label: result.usedFallback ? 'Fallback import pass' : 'Imported screenplay pass',
      reason: 'Automatic conversion result'
    });
    const reviewRecord = {
      ...(versionedRecord || persistedRecord || {}),
      id: result.jobId || jobId,
      fileName: file.name,
      projectId: nextProject.id,
      status: result.usedFallback ? 'imported-with-fallback' : 'imported',
      stageLabel: result.usedFallback ? 'Imported with fallback review needed' : 'Imported into project',
      rawText,
      normalizedText: liveWorkspacePatch?.normalizedText || persistedRecord?.normalizedText || '',
      coverPageCandidate: finalCoverPage || persistedRecord?.coverPageCandidate || null,
      structuredLines: finalLines,
      structuredLineCount: finalLines.length,
      warnings: result.warnings || [],
      sourceFile: persistedRecord?.sourceFile || { name: file.name, type: file.type || '', size: Number(file.size) || 0 }
    };
    closeConversionLiveDialog();
    await openConversionReviewDialog(result.jobId || jobId, nextProject.id, reviewRecord);
  } catch (error) {
    console.error("Convert & import failed", error);
    await failConversionJob(jobId, error.message || "Conversion failed.");
    updateToast(loadingToast, error.message || "Conversion failed.", "error", { duration: 5200 });
    const failedRecord = await waitForConversionJobRecord(jobId, { timeoutMs: 2000 });
    const versionedFailure = await appendConversionJobVersion(jobId, {
      ...(failedRecord || {}),
      id: jobId,
      fileName: file.name,
      projectId: project.id,
      status: 'failed',
      stageLabel: failedRecord?.stageLabel || 'Conversion failed',
      warnings: failedRecord?.warnings?.length ? failedRecord.warnings : [error.message || "Conversion failed."],
      sourceFile: failedRecord?.sourceFile || { name: file.name, type: file.type || '', size: Number(file.size) || 0 }
    }, {
      label: 'Failed conversion pass',
      reason: error.message || 'Conversion failed'
    });
    const reviewRecord = {
      ...(versionedFailure || failedRecord || {}),
      id: jobId,
      fileName: file.name,
      projectId: project.id,
      status: 'failed',
      stageLabel: failedRecord?.stageLabel || 'Conversion failed',
      warnings: failedRecord?.warnings?.length ? failedRecord.warnings : [error.message || "Conversion failed."],
      sourceFile: failedRecord?.sourceFile || { name: file.name, type: file.type || '', size: Number(file.size) || 0 }
    };
    showToast("Conversion Review has the failure details and retry option.", "error", { duration: 5200 });
    closeConversionLiveDialog();
    await openConversionReviewDialog(jobId, project.id, reviewRecord);
  }
}

function getConversionReviewEmptyMessage(record) {
  const status = String(record?.status || '').toLowerCase();
  if (status === 'failed') {
    return 'Conversion stopped before screenplay blocks were created. Review the warning details above, then retry from this job when you are ready.';
  }
  if (status === 'queued' || status === 'uploading' || status === 'extracting' || status === 'preparing' || status === 'normalizing' || status === 'structuring' || status === 'importing') {
    return 'This conversion job is still in progress. Keep this review open or reopen it from Conversion Jobs to watch the next stage appear.';
  }
  if (status === 'completed-with-fallback' || status === 'imported-with-fallback') {
    return 'This job finished with a fallback path, so no fully structured screenplay preview was stored. Review the warnings and retry if you want a cleaner AI pass.';
  }
  return 'No structured screenplay lines are stored for this job yet. Retry the conversion if you want the app to rebuild the screenplay preview.';
}

function getConversionReviewState(record) {
  const status = String(record?.status || '').toLowerCase();
  if (status === 'failed') {
    return {
      tone: 'error',
      title: 'This conversion stopped before the screenplay was built.',
      body: 'Read the warning details, inspect the extracted text, and retry when you are ready. If the source file is a scan or badly wrapped export, a cleaner PDF or DOCX will usually help.'
    };
  }
  if (status === 'queued' || status === 'uploading' || status === 'extracting' || status === 'preparing' || status === 'normalizing' || status === 'structuring' || status === 'importing') {
    return {
      tone: 'loading',
      title: 'This conversion is still moving through the pipeline.',
      body: 'Keep this review open if you want to watch the current stage, or reopen it later from Conversion Jobs. The extracted text and screenplay preview will fill in as the job advances.'
    };
  }
  if (status === 'completed-with-fallback' || status === 'imported-with-fallback') {
    return {
      tone: 'warning',
      title: 'The script imported with a fallback path.',
      body: 'You can keep working from this result, but the warnings suggest the AI pass did not complete cleanly. Retry the conversion if you want a stronger structured pass.'
    };
  }
  return {
    tone: 'success',
    title: 'This conversion workspace is ready to review.',
    body: 'Use the extracted text, normalized pass, and structured preview together to confirm the screenplay before you keep writing.'
  };
}

async function openConversionReviewDialog(jobId, projectId = "", recordOverride = null) {
  const dialog = document.getElementById("conversionReviewDialog");
  if (!dialog || !jobId) return;

  const record = {
    ...((recordOverride || await getConversionJobRecord(jobId)) || {}),
    ...(getConversionWorkspaceOverride(jobId) || {})
  };
  if (!record) return;

  const title = document.getElementById("conversionReviewTitle");
  const meta = document.getElementById("conversionReviewMeta");
  const status = document.getElementById("conversionReviewStatus");
  const stage = document.getElementById("conversionReviewStage");
  const file = document.getElementById("conversionReviewFile");
  const lineCount = document.getElementById("conversionReviewLineCount");
  const warnings = document.getElementById("conversionReviewWarnings");
  const typeGrid = document.getElementById("conversionReviewTypeGrid");
  const raw = document.getElementById("conversionReviewRaw");
  const normalized = document.getElementById("conversionReviewNormalized");
  const structured = document.getElementById("conversionReviewStructured");
  const stateCard = document.getElementById("conversionReviewStateCard");
  const stateTitle = document.getElementById("conversionReviewStateTitle");
  const stateBody = document.getElementById("conversionReviewStateBody");
  const closeBtn = document.getElementById("conversionReviewCloseBtn");
  const retryBtn = document.getElementById("conversionReviewRetryBtn");
  const applyBtn = document.getElementById("conversionReviewApplyBtn");
  const restoreBtn = document.getElementById("conversionReviewRestoreBtn");
  const versionSelect = document.getElementById("conversionReviewVersionSelect");
  let baseRecord = record;
  let selectedVersionId = "current";

  const renderReviewState = (viewRecord) => {
    if (title) title.textContent = viewRecord.fileName ? `Review "${viewRecord.fileName}"` : "Review Converted Script";
    if (meta) meta.textContent = "Follow the script from extracted source text through normalization and into the final EyaWriter screenplay structure.";
    if (status) status.textContent = String(viewRecord.status || "unknown");
    if (stage) stage.textContent = String(viewRecord.stageLabel || "Unknown stage");
    if (file) file.textContent = viewRecord.sourceFile?.name || viewRecord.fileName || "Unknown";
    if (lineCount) lineCount.textContent = String(viewRecord.structuredLineCount || viewRecord.structuredLines?.length || 0);
    if (raw) raw.value = String(viewRecord.rawText || "");
    if (normalized) normalized.value = String(viewRecord.normalizedText || "");
    if (warnings) {
      const warningText = Array.isArray(viewRecord.warnings) ? viewRecord.warnings.filter(Boolean).join("\n\n") : "";
      warnings.hidden = !warningText;
      warnings.textContent = warningText;
    }
    const reviewState = getConversionReviewState(viewRecord);
    if (stateCard) stateCard.dataset.stateTone = reviewState.tone;
    if (stateTitle) stateTitle.textContent = reviewState.title;
    if (stateBody) stateBody.textContent = reviewState.body;
    const structuredLines = Array.isArray(viewRecord.structuredLines) ? viewRecord.structuredLines : [];
    if (typeGrid) {
      const counts = structuredLines.reduce((accumulator, line) => {
        const type = String(line?.type || "action");
        accumulator[type] = (accumulator[type] || 0) + 1;
        return accumulator;
      }, {});
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      typeGrid.hidden = !entries.length;
      typeGrid.innerHTML = entries.map(([type, count]) => `
        <div class="conversion-review-type-pill">
          <span>${escapeHtml(type)}</span>
          <strong>${count}</strong>
        </div>
      `).join("");
    }
    if (structured) {
      structured.innerHTML = structuredLines.length
        ? structuredLines.slice(0, 160).map((line) => `
          <div class="conversion-review-line">
            <span class="conversion-review-line-type">${escapeHtml(String(line?.type || "action"))}</span>
            <div class="conversion-review-line-text">${escapeHtml(String(line?.text || "")).replace(/\n/g, "<br>")}</div>
          </div>
        `).join("")
        : `<p class="conversion-review-structured-empty">${escapeHtml(getConversionReviewEmptyMessage(viewRecord))}</p>`;
    }
    if (retryBtn) {
      retryBtn.textContent = "Retry conversion";
      retryBtn.disabled = !baseRecord.sourceFile?.blob;
    }
    if (applyBtn) {
      applyBtn.disabled = !structuredLines.length;
    }
    if (restoreBtn) {
      restoreBtn.disabled = selectedVersionId === "current";
    }
  };

  const renderVersionOptions = () => {
    if (!versionSelect) return;
    const versions = buildConversionVersionOptions(baseRecord);
    versionSelect.innerHTML = versions.map((entry) => `
      <option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>
    `).join("");
    versionSelect.value = selectedVersionId;
  };

  renderVersionOptions();
  renderReviewState(baseRecord);

  await new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      closeBtn?.removeEventListener("click", onClose);
      retryBtn?.removeEventListener("click", onRetry);
      applyBtn?.removeEventListener("click", onApply);
      restoreBtn?.removeEventListener("click", onRestore);
      versionSelect?.removeEventListener("change", onSelectVersion);
      dialog.removeEventListener("cancel", onClose);
      dialog.removeEventListener("close", onClose);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onClose = () => {
      if (dialog.open) dialog.close();
      finish();
    };
    const onSelectVersion = () => {
      selectedVersionId = versionSelect?.value || "current";
      const selected = resolveSelectedConversionVersion(baseRecord, selectedVersionId);
      renderReviewState(selected.data);
    };
    const onApply = async () => {
      const selected = resolveSelectedConversionVersion(baseRecord, selectedVersionId);
      await applyConversionRecordToProject(selected.data, projectId, "Selected conversion pass applied to this script.");
    };
    const onRestore = async () => {
      if (selectedVersionId === "current") return;
      const selected = resolveSelectedConversionVersion(baseRecord, selectedVersionId);
      const restoredPatch = {
        rawText: String(selected.data.rawText || ""),
        normalizedText: String(selected.data.normalizedText || ""),
        structuredLines: Array.isArray(selected.data.structuredLines) ? selected.data.structuredLines : [],
        structuredLineCount: Number(selected.data.structuredLineCount || selected.data.structuredLines?.length || 0),
        warnings: Array.isArray(selected.data.warnings) ? selected.data.warnings : [],
        coverPageCandidate: selected.data.coverPageCandidate || null,
        operatorGuidance: String(selected.data.operatorGuidance || baseRecord.operatorGuidance || ""),
        status: String(selected.data.status || baseRecord.status || "imported"),
        stageLabel: `Restored ${selected.data.label || "saved pass"}`,
        activeVersionId: selectedVersionId
      };
      await patchConversionJobRecord(jobId, restoredPatch);
      baseRecord = {
        ...(await getConversionJobRecord(jobId) || baseRecord),
        ...restoredPatch
      };
      selectedVersionId = "current";
      renderVersionOptions();
      renderReviewState(baseRecord);
      showToast("Saved pass restored to the current conversion workspace.", "success", { duration: 3200 });
    };
    const onRetry = async () => {
      const blob = baseRecord.sourceFile?.blob;
      const nextProject = state.projects.find((entry) => entry.id === projectId) || getCurrentProject();
      if (!blob || !nextProject) {
        await customAlert("The original uploaded file is not available for retry.", "Conversion Review");
        return;
      }
      const retryFile = blob instanceof File
        ? blob
        : new File([blob], baseRecord.sourceFile?.name || baseRecord.fileName || "retry-script", {
          type: baseRecord.sourceFile?.type || "application/octet-stream",
          lastModified: baseRecord.sourceFile?.lastModified || Date.now()
        });
      dialog.close();
      cleanup();
      settled = true;
      resolve();
      const latestRecord = await getConversionJobRecord(jobId) || baseRecord;
      await runConvertImportPipeline(retryFile, nextProject, {
        existingJobId: jobId,
        seedRecord: latestRecord
      });
    };

    closeBtn?.addEventListener("click", onClose);
    retryBtn?.addEventListener("click", onRetry);
    applyBtn?.addEventListener("click", onApply);
    restoreBtn?.addEventListener("click", onRestore);
    versionSelect?.addEventListener("change", onSelectVersion);
    dialog.addEventListener("cancel", onClose, { once: true });
    dialog.addEventListener("close", onClose, { once: true });
    if (!dialog.open) {
      dialog.showModal();
    }
  });
}

function openNotepad() {
  const dialog = document.getElementById("notepadDialog");
  const closeBtn = document.getElementById("closeNotepad");

  if (!dialog) return;

  // Initialize Summernote if not already done
  if (!$( '#summernote' ).data('summernote')) {
    $( '#summernote' ).summernote({
      placeholder: 'Type your notes here...',
      tabsize: 2,
      height: 400,
      toolbar: [
        ['style', ['style']],
        ['font', ['bold', 'italic', 'underline', 'clear']],
        ['fontname', ['fontname']],
        ['color', ['color']],
        ['para', ['ul', 'ol', 'paragraph']],
        ['table', ['table']],
        ['insert', ['link']],
        ['view', ['fullscreen', 'codeview', 'help']]
      ]
    });
  }

  dialog.showModal();

  closeBtn.onclick = () => {
    dialog.close();
  };
}

async function checkFirstWorkBackup() {
  if (state.localBackupEnabled || state.backupPrompted) return;

  state.backupPrompted = true;
  persistProjects(false);

  const confirmed = await customConfirm(
    "Would you like to enable Local Backup? This automatically saves a copy of your work to a folder on your computer for extra safety.",
    "Enable Local Backup?"
  );

  if (confirmed) {
    const result = await chooseLocalSaveFile();
    if (result.ok) {
      state.localBackupEnabled = true;
      applySaveModeButtons();
      persistProjects(false);
    }
  }
}


