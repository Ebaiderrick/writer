export const STORAGE_KEY = "eyawriter-projects-v5";
export const TYPE_SEQUENCE = ["scene", "action", "character", "dialogue", "transition", "parenthetical", "shot", "text", "note", "dual", "image"];
export const TYPE_LABELS = {
  scene: "Scene",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  transition: "Transition",
  parenthetical: "Parenthetical",
  shot: "Shot",
  text: "Text",
  note: "Note",
  dual: "Dual",
  image: "Image"
};
export const AUTO_UPPERCASE_TYPES = new Set(["scene", "character", "shot", "transition", "dual"]);
export const SCENE_TIMES = ["DAY", "NIGHT", "LATER", "DAWN", "DUSK", "MORNING", "EVENING", "CONT'D"];
export const DEFAULT_SUGGESTIONS = {
  scene: ["INT. - DAY", "EXT. - DAY", "INT. - NIGHT", "EXT. - NIGHT", "INT./EXT. - DAY", "INT./EXT. - NIGHT"],
  transition: ["CUT TO:", "DISSOLVE TO:", "SMASH CUT TO:", "MATCH CUT TO:", "FADE OUT."],
  shot: ["CLOSE ON", "WIDE SHOT", "INSERT", "POV", "OVERHEAD SHOT"],
  parenthetical: ["beat", "quietly", "whispering", "under breath", "into phone"],
  note: ["NOTE: "],
  image: ["[IMAGE: Rainy street at night]", "[IMAGE: Old photograph on a desk]"]
};
export const DEFAULT_VIEW_OPTIONS = {
  ruler: false,
  pageNumbers: true,
  pageCount: false,
  showOutline: true,
  textSize: 12
};
export const LEFT_PANE_BLOCK_DEFS = [
  { key: "current", label: "Current Script" },
  { key: "workspace", label: "Team Workspace" },
  { key: "characters", label: "Characters" },
  { key: "scenes", label: "Scenes" },
  { key: "comments", label: "Comments" },
  { key: "metrics", label: "Metrics" },
  { key: "analytics", label: "Writing Analytics" },
  { key: "story-memory", label: "Story Memory" },
  { key: "notepad", label: "Notepad" },
  { key: "ai-assistant", label: "AI Assistant" },
  { key: "smart-proofread", label: "Smart Proofreading" },
  { key: "work-tracking", label: "Work Tracking" },
  { key: "proofread", label: "Style Proofread" },
  { key: "tools", label: "Project Tools" }
];
const DEFAULT_VISIBLE_BLOCK_KEYS = new Set(['current', 'scenes', 'characters', 'comments', 'metrics', 'story-memory', 'tools']);
export const DEFAULT_LEFT_PANE_BLOCKS = LEFT_PANE_BLOCK_DEFS.map(({ key }) => ({
  key,
  visible: DEFAULT_VISIBLE_BLOCK_KEYS.has(key),
  collapsed: false
}));
export const PAGE_UNIT_CAPACITY = 54;

export const DEFAULT_STORY_MEMORY = {
  characters: [],
  locations: [],
  scenes: [],
  themes: [],
  plotPoints: []
};

export const WORKSPACE_TASK_TEMPLATES = [
  {
    key: "custom",
    label: "Custom Task",
    title: "",
    description: "",
    aiInstruction: "Complete the assigned writing task using the user's exact title and description."
  },
  {
    key: "rewrite-dialogue",
    label: "Rewrite Dialogue",
    title: "Rewrite dialogue",
    description: "Rewrite the dialogue so it feels sharper, more natural, and emotionally precise while preserving the scene intention.",
    aiInstruction: "Focus on dialogue lines. Strengthen voice, subtext, and rhythm without changing the scene objective."
  },
  {
    key: "expand-scene",
    label: "Expand Scene",
    title: "Expand scene",
    description: "Expand the linked scene with stronger beats, richer turns, and more cinematic development while keeping screenplay formatting tight.",
    aiInstruction: "Expand the scene with additional screenplay-ready beats, action, and dialogue where helpful."
  },
  {
    key: "improve-clarity",
    label: "Improve Clarity",
    title: "Improve clarity",
    description: "Clarify confusing writing, smooth awkward phrasing, and make the scene easier to read without flattening the voice.",
    aiInstruction: "Improve readability, precision, and clarity while preserving intent and tone."
  },
  {
    key: "character-voice",
    label: "Strengthen Character Voice",
    title: "Strengthen character voice",
    description: "Refine the character voice so the lines feel more distinct, specific, and true to the character on the page.",
    aiInstruction: "Sharpen character-specific language, cadence, and attitude so the speaker feels more distinct."
  },
  {
    key: "tighten-action",
    label: "Tighten Action",
    title: "Tighten action",
    description: "Trim and sharpen action lines so the writing feels leaner, more visual, and more cinematic.",
    aiInstruction: "Condense action writing, remove drag, and keep the page visually readable and cinematic."
  },
  {
    key: "add-description",
    label: "Add Description",
    title: "Add description",
    description: "Add concise visual description that helps the scene feel grounded, specific, and filmable.",
    aiInstruction: "Add economical but vivid description that supports the scene visually without over-writing."
  },
  {
    key: "check-continuity",
    label: "Check Continuity",
    title: "Check continuity",
    description: "Review the linked material for continuity issues, then provide corrected screenplay-ready text if changes are needed.",
    aiInstruction: "Look for continuity inconsistencies in action, dialogue, and story flow, then propose corrected script text."
  }
];

export const state = {
  projects: [],
  currentProjectId: null,
  currentWorkspaceId: null,
  activeBlockId: null,
  activeType: "action",
  visibleSuggestions: [],
  suggestionContext: null,
  saveTimer: null,
  lastSavedAt: "",
  lastSaveSource: "remote",
  pendingRecoveryNotice: false,
  aiAssist: false,
  grammarCheck: false,
  toolStripCollapsed: false,
  autoNumberScenes: false,
  backgroundAnimation: true,
  theme: "cedar",
  language: "en",
  writingLanguage: "en",
  localBackupEnabled: false,
  localSaveIntervalMinutes: 5,
  localSaveTimer: null,
  localSaveFileHandle: null,
  viewOptions: { ...DEFAULT_VIEW_OPTIONS },
  leftPaneBlocks: DEFAULT_LEFT_PANE_BLOCKS.map((block) => ({ ...block })),
  filterQuery: "",
  homeProjectFilter: "all",
  homeProjectSort: "latest",
  homeProjectFormat: "all",
  workspaceTaskFilter: "all",
  workspaceTaskSort: "latest",
  backupPrompted: false,
  history: [],
  historyIndex: -1
};
