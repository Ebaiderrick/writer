import { DEFAULT_VIEW_OPTIONS } from './constants.js';

export const state = {
  projects: [],
  currentProjectId: null,
  activeBlockId: null,
  activeType: "action",
  visibleSuggestions: [],
  saveTimer: null,
  aiAssist: false,
  toolStripCollapsed: false,
  autoNumberScenes: false,
  theme: "rose",
  viewOptions: { ...DEFAULT_VIEW_OPTIONS },
  filterQuery: ""
};
