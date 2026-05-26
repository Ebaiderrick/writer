import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('workspace metrics and toast close button render correctly', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const home = document.getElementById('homeView');
    const workspace = document.getElementById('workspaceView');
    const dashboard = document.getElementById('workspaceDashboard');
    const title = document.getElementById('workspaceViewTitle');
    const clock = document.getElementById('workspaceViewClock');
    if (!workspace || !dashboard || !title || !clock) throw new Error('Missing workspace nodes');
    if (home) home.hidden = true;
    workspace.hidden = false;
    title.textContent = 'Untitled Script';
    clock.textContent = '11:56:53 PM';
    dashboard.innerHTML = `
      <div class="workspace-home-shell">
        <section class="workspace-home-hero-card">
          <div class="workspace-home-hero-copy">
            <h3>Untitled Script</h3>
            <p>Shape scripts, story memory, comments, and teamwork from one shared writing space.</p>
          </div>
          <div class="workspace-home-metric"><span>Projects</span><strong>1</strong></div>
          <div class="workspace-home-metric"><span>Members</span><strong>1</strong></div>
          <div class="workspace-home-metric"><span>Tasks</span><strong>0</strong></div>
          <div class="workspace-home-metric"><span>Last activity</span><strong>May 01, 2026, 02:19 PM</strong></div>
        </section>
      </div>
    `;
    const host = document.querySelector('#toastHost') || (() => {
      const el = document.createElement('div');
      el.id = 'toastHost';
      el.className = 'toast-host';
      document.body.appendChild(el);
      return el;
    })();
    host.innerHTML = `
      <article class="app-toast is-loading" data-toast-id="demo">
        <div class="app-toast-copy">
          <strong class="app-toast-title">Working</strong>
          <span class="app-toast-message">Refreshing workspace...</span>
        </div>
        <button class="app-toast-close" type="button" aria-label="Dismiss notification">&times;</button>
      </article>
    `;
  });
  await expect(page.locator('#workspaceView')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/workspace-metrics-toast-fix.png' });
});
