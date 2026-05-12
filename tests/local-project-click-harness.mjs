import fs from "node:fs";
import path from "node:path";

const eventsPath = path.resolve("js/events.js");
const source = fs.readFileSync(eventsPath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) {
    throw new Error(`Unable to find function ${name}`);
  }
  let depth = 0;
  let bodyStart = source.indexOf("{", start);
  let index = bodyStart;
  while (index < source.length) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
    index += 1;
  }
  throw new Error(`Unable to extract function ${name}`);
}

const getEventElementTargetSrc = extractFunction("getEventElementTarget");
const handleProjectGridClickSrc = extractFunction("handleProjectGridClick");

const harness = new Function(`
  let openedProjectId = null;
  let defaultPrevented = false;

  const Node = { TEXT_NODE: 3 };
  const state = {
    projects: [{ id: "project-123", isTrashed: false }],
    homeProjectFilter: "all",
    homeProjectFormat: "all",
    homeSelectedProjectId: null
  };

  function renderHome() {}
  function customAlert() {}
  function openWorkspaceDashboard() {}
  function removeProject() {}
  function renameProjectById() {}
  function duplicateProjectById() {}
  function restoreProjectById() {}
  function shouldSuppressHomeProjectInteraction() { return false; }
  function openProject(projectId) { openedProjectId = projectId; }

  ${getEventElementTargetSrc}

  function handleHomeProjectOpenIntent(projectId) {
    if (!projectId || shouldSuppressHomeProjectInteraction()) {
      return;
    }
    const project = state.projects.find((item) => item.id === projectId);
    if (project?.isTrashed) {
      customAlert("Restore this project before opening it again.", "Project in Trash");
      return;
    }
    state.homeSelectedProjectId = projectId;
    openProject(projectId);
  }

  ${handleProjectGridClickSrc}

  function makeElement(name, map = {}, dataset = {}) {
    return {
      name,
      dataset,
      closest(selector) {
        return map[selector] ?? null;
      }
    };
  }

  const grid = makeElement("grid");
  const card = makeElement("card", { "#projectGrid, #workspaceProjectGrid": grid }, { projectId: "project-123" });
  const body = makeElement("body", { ".project-card": card, "#projectGrid, #workspaceProjectGrid": grid });
  const textNode = { nodeType: Node.TEXT_NODE, parentElement: body };

  handleProjectGridClick({
    target: textNode,
    preventDefault() {
      defaultPrevented = true;
    }
  });

  return {
    openedProjectId,
    defaultPrevented,
    selectedProjectId: state.homeSelectedProjectId
  };
`);

const result = harness();
console.log(JSON.stringify(result, null, 2));
