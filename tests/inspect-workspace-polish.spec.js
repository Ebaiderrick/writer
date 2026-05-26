import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('workspace dashboard renders with softer unified cards', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const home = document.getElementById('homeView');
    const workspace = document.getElementById('workspaceView');
    const dashboard = document.getElementById('workspaceDashboard');
    const projectGrid = document.getElementById('workspaceProjectGrid');
    const title = document.getElementById('workspaceViewTitle');
    const clock = document.getElementById('workspaceViewClock');
    if (!workspace || !dashboard || !projectGrid || !title || !clock) throw new Error('Missing workspace nodes');
    if (home) home.hidden = true;
    workspace.hidden = false;
    title.textContent = 'The Hill at First Light';
    clock.textContent = '11:24 PM';
    dashboard.innerHTML = `
      <div class="workspace-home-shell">
        <section class="workspace-home-hero-card">
          <div class="workspace-home-hero-copy">
            <h3>The Hill at First Light</h3>
            <p>Shape scripts, story memory, comments, and teamwork from one shared writing space.</p>
          </div>
          <div class="workspace-home-metric"><span>Projects</span><strong>1</strong></div>
          <div class="workspace-home-metric"><span>Members</span><strong>3</strong></div>
          <div class="workspace-home-metric"><span>Tasks</span><strong>7</strong></div>
          <div class="workspace-home-metric"><span>Last activity</span><strong>May 26, 2026</strong></div>
        </section>
        <div class="workspace-home-grid">
          <section class="workspace-home-panel">
            <div class="workspace-home-panel-head"><h4>Members</h4><span class="workspace-home-panel-meta">3 active</span></div>
            <div class="workspace-home-members">
              <a class="workspace-home-member-pill">LE</a>
              <a class="workspace-home-member-pill">WO</a>
              <a class="workspace-home-member-pill">AI</a>
            </div>
          </section>
          <section class="workspace-home-panel">
            <div class="workspace-home-panel-head"><h4>Recent activity</h4><span class="workspace-home-panel-meta">Latest</span></div>
            <div class="workspace-home-activity">
              <div class="workspace-home-activity-item"><strong>Lenon</strong><span>Updated the opening scene.</span><small>5 mins ago</small></div>
              <div class="workspace-home-activity-item"><strong>AI Assist</strong><span>Queued a review note for Act 1.</span><small>14 mins ago</small></div>
            </div>
          </section>
          <section class="workspace-home-panel">
            <div class="workspace-home-panel-head"><h4>Team progress</h4><span class="workspace-home-panel-meta">4 open</span></div>
            <div class="workspace-summary-list">
              <div class="workspace-summary-item"><strong>Mara reveal pass</strong><span class="workspace-home-empty">Due tomorrow</span></div>
              <div class="workspace-summary-item"><strong>Act two rhythm check</strong><span class="workspace-home-empty">In progress</span></div>
            </div>
          </section>
          <section class="workspace-home-panel">
            <div class="workspace-home-panel-head"><h4>My inbox</h4><span class="workspace-home-panel-meta">2 waiting</span></div>
            <div class="workspace-home-activity">
              <div class="workspace-home-activity-item"><strong>Review ready</strong><span>AI notes on the midpoint sequence.</span><small>Now</small></div>
              <div class="workspace-home-activity-item"><strong>Mentioned</strong><span>“Can you trim the corridor beat?”</span><small>21 mins ago</small></div>
            </div>
          </section>
        </div>
        <section class="workspace-home-panel workspace-home-panel-wide">
          <div class="workspace-home-panel-head"><h4>Tasks & Delegation</h4><span class="workspace-home-panel-meta">7 total</span></div>
          <div class="workspace-task-list">
            <article class="workspace-task-card">
              <div class="workspace-task-head"><strong>Tighten opening montage</strong><span>In progress</span></div>
              <p class="workspace-task-copy">Rework the first page visual beats so the reveal lands earlier.</p>
              <div class="workspace-task-chip-row">
                <span class="workspace-task-tag workspace-task-tag-focus">Opening pages</span>
                <span class="workspace-task-tag workspace-task-tag-today">Due today</span>
              </div>
            </article>
            <article class="workspace-task-card is-owned-by-you">
              <div class="workspace-task-head"><strong>Check newsroom dialogue</strong><span>Todo</span></div>
              <p class="workspace-task-copy">Verify the dialogue handoff between Mara and Wren after normalization.</p>
              <div class="workspace-task-chip-row">
                <span class="workspace-task-tag workspace-task-tag-ai">AI review</span>
                <span class="workspace-task-tag workspace-task-tag-priority-high">High priority</span>
              </div>
            </article>
          </div>
        </section>
      </div>
    `;
    projectGrid.innerHTML = `
      <article class="project-card"><div class="project-card-copy"><h3>Episode 1</h3><p>Shared workspace screenplay</p></div></article>
    `;
  });
  await expect(page.locator('#workspaceView')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/workspace-polish.png' });
});
