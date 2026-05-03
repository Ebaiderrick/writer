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
  { key: "grammar-check", label: "Grammar Check" },
  { key: "smart-proofread", label: "Smart Proofreading" },
  { key: "work-tracking", label: "Work Tracking" },
  { key: "proofread", label: "Simple Proofread" },
  { key: "tools", label: "Project Tools" }
];
const DEFAULT_VISIBLE_BLOCK_KEYS = new Set(['current', 'scenes', 'characters', 'comments', 'metrics', 'tools']);
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

export const state = {
  projects: [],
  currentProjectId: null,
  activeBlockId: null,
  activeType: "action",
  visibleSuggestions: [],
  suggestionContext: null,
  saveTimer: null,
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
  backupPrompted: false,
  history: [],
  historyIndex: -1
};
