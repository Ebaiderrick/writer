import { auth, db } from './firebase.js';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';
import { getCurrentProject, sanitizeProject, upsertProject, persistProjects } from './project.js';
import { uid as makeId } from './utils.js';
import { customAlert, customConfirm } from './ui.js';

// Comment filter state
let commentFilter = { user: 'all', sort: 'line', status: 'all' };
let allComments = [];

const MAX_COLLABORATORS = 5;
let unsubInvites = null;
let unsubComments = null;
let unsubSharedProject = null;

// ── Comments collection path ──────────────────────────────────
// Personal projects → users/{uid}/projects/{id}/comments
// Shared projects   → sharedProjects/{id}/comments

function commentsCol(project) {
  const user = auth.currentUser;
  if (project.isShared) return collection(db, 'sharedProjects', project.id, 'comments');
  if (!user) return null;
  return collection(db, 'users', user.uid, 'projects', project.id, 'comments');
}

function commentDocRef(project, commentId) {
  const user = auth.currentUser;
  if (project.isShared) return doc(db, 'sharedProjects', project.id, 'comments', commentId);
  if (!user) return null;
  return doc(db, 'users', user.uid, 'projects', project.id, 'comments', commentId);
}

// ── Lifecycle ─────────────────────────────────────────────────

export function initCollaboration() {
  const user = auth.currentUser;
  if (!user) return;

  const q = query(
    collection(db, 'invitations'),
    where('toEmail', '==', user.email.toLowerCase()),
    where('status', '==', 'pending')
  );

  unsubInvites = onSnapshot(q, snap => {
    const invitations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateCollabBadge(invitations.length);
    renderCollabRequests(invitations);
  });
}

export function cleanupCollaboration() {
  [unsubInvites, unsubComments, unsubSharedProject].forEach(fn => fn?.());
  unsubInvites = unsubComments = unsubSharedProject = null;
}

export function onStudioEnter(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  renderCollaboratorList();
  if (project.isShared) {
    subscribeToSharedProject(projectId);
  } else {
    if (unsubSharedProject) { unsubSharedProject(); unsubSharedProject = null; }
  }
  subscribeToComments(project);
}

function updateCollabBadge(count) {
  document.querySelectorAll('.collab-badge').forEach(b => {
    b.textContent = count || '';
    b.hidden = !count;
  });
}

// ── Invite ────────────────────────────────────────────────────

export async function inviteCollaborator(email) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Not signed in.' };

  const project = getCurrentProject();
  if (!project) return { ok: false, reason: 'No project open.' };

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === user.email.toLowerCase()) {
    return { ok: false, reason: 'You cannot invite yourself.' };
  }

  const collaborators = project.collaborators || {};
  if (Object.keys(collaborators).length >= MAX_COLLABORATORS) {
    return { ok: false, reason: `Maximum ${MAX_COLLABORATORS} collaborators reached.` };
  }

  const alreadyIn = Object.values(collaborators).some(
    c => c.email.toLowerCase() === normalizedEmail
  );
  if (alreadyIn) return { ok: false, reason: 'This person is already a collaborator.' };

  const userSnap = await getDoc(doc(db, 'usersByEmail', normalizedEmail));
  if (!userSnap.exists()) {
    return { ok: false, reason: 'No EyaWriter account found for this email. They need to sign up first.' };
  }

  const existingQ = query(
    collection(db, 'invitations'),
    where('fromUid', '==', user.uid),
    where('toEmail', '==', normalizedEmail),
    where('projectId', '==', project.id),
    where('status', '==', 'pending')
  );
  const existing = await getDocs(existingQ);
  if (!existing.empty) return { ok: false, reason: 'Invitation already pending for this person.' };

  await ensureSharedProject(project, user);

  const inviteId = makeId('inv');
  await setDoc(doc(db, 'invitations', inviteId), {
    id: inviteId,
    fromUid: user.uid,
    fromName: user.displayName || user.email,
    fromEmail: user.email,
    toEmail: normalizedEmail,
    projectId: project.id,
    projectTitle: project.title,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  return { ok: true };
}

async function ensureSharedProject(project, user) {
  const ref = doc(db, 'sharedProjects', project.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ...project,
      ownerId: user.uid,
      ownerName: user.displayName || user.email,
      ownerEmail: user.email,
      collaborators: {},
      isShared: true,
      updatedBy: user.uid,
      syncedAt: new Date().toISOString()
    });
    project.isShared = true;
    project.ownerId = user.uid;
    project.collaborators = {};
    persistProjects(false);
  }
}

// ── Accept / Decline ──────────────────────────────────────────

export async function acceptInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return;

  const invSnap = await getDoc(doc(db, 'invitations', inviteId));
  if (!invSnap.exists()) return;
  const inv = invSnap.data();

  const projSnap = await getDoc(doc(db, 'sharedProjects', inv.projectId));
  if (!projSnap.exists()) {
    await customAlert('This project no longer exists.', 'Invitation Error');
    return;
  }

  const sharedProject = projSnap.data();
  const collabCount = Object.keys(sharedProject.collaborators || {}).length;
  if (collabCount >= MAX_COLLABORATORS) {
    await customAlert(`This project already has ${MAX_COLLABORATORS} collaborators.`, 'No Room');
    return;
  }

  const newCollaborators = {
    ...sharedProject.collaborators,
    [user.uid]: {
      name: user.displayName || user.email,
      email: user.email,
      addedAt: new Date().toISOString()
    }
  };

  await updateDoc(doc(db, 'sharedProjects', inv.projectId), { collaborators: newCollaborators });
  await updateDoc(doc(db, 'invitations', inviteId), { status: 'accepted' });

  const projectForUser = sanitizeProject({ ...sharedProject, collaborators: newCollaborators });
  await setDoc(doc(db, 'users', user.uid, 'projects', inv.projectId), {
    ...projectForUser,
    syncedAt: new Date().toISOString()
  });

  upsertProject(projectForUser);
  persistProjects(false);
  subscribeToSharedProject(inv.projectId);
}

export async function declineInvitation(inviteId) {
  await updateDoc(doc(db, 'invitations', inviteId), { status: 'declined' });
}

// ── Kick ──────────────────────────────────────────────────────

export async function kickCollaborator(projectId, collaboratorUid) {
  const user = auth.currentUser;
  if (!user) return;

  const projSnap = await getDoc(doc(db, 'sharedProjects', projectId));
  if (!projSnap.exists()) return;
  const proj = projSnap.data();

  if (proj.ownerId !== user.uid) {
    await customAlert('Only the project owner can remove collaborators.', 'Not Authorized');
    return;
  }

  const newCollaborators = { ...proj.collaborators };
  delete newCollaborators[collaboratorUid];

  await updateDoc(doc(db, 'sharedProjects', projectId), { collaborators: newCollaborators });

  const project = getCurrentProject();
  if (project?.id === projectId) {
    project.collaborators = newCollaborators;
    persistProjects(false);
  }

  renderCollaboratorList();
}

// ── Real-time listeners ───────────────────────────────────────

export function subscribeToSharedProject(projectId) {
  if (unsubSharedProject) unsubSharedProject();
  unsubSharedProject = onSnapshot(doc(db, 'sharedProjects', projectId), snap => {
    if (!snap.exists()) return;
    if (snap.data().updatedBy === auth.currentUser?.uid) return;
    const updated = sanitizeProject(snap.data());
    upsertProject(updated);
    persistProjects(false);
    renderCollaboratorList();
    if (state.currentProjectId === projectId) {
      window.dispatchEvent(new CustomEvent('sharedProjectUpdated', { detail: { projectId } }));
    }
  });
}

export function subscribeToComments(projectOrId) {
  if (unsubComments) unsubComments();
  const project = typeof projectOrId === 'string'
    ? state.projects.find(p => p.id === projectOrId)
    : projectOrId;
  if (!project) return;
  const col = commentsCol(project);
  if (!col) return;
  const q = query(col, orderBy('createdAt', 'asc'));
  unsubComments = onSnapshot(q, snap => {
    allComments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCommentList(allComments, project.id);
    renderLeftPaneComments();
    updateCommentIcons(allComments);
  }, err => console.error('[comments]', err));
}

export function setCommentFilter(key, value) {
  commentFilter[key] = value;
}

export async function addComment(projectId, text, { lineId = null, parentId = null } = {}) {
  const user = auth.currentUser;
  if (!user || !text.trim()) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const ref = commentDocRef(project, makeId('cmt'));
  if (!ref) return;
  const commentId = ref.id;
  await setDoc(ref, {
    id: commentId,
    uid: user.uid,
    userName: user.displayName || user.email,
    text: text.trim(),
    lineId: lineId || null,
    parentId: parentId || null,
    resolved: false,
    createdAt: new Date().toISOString()
  });
}

export async function deleteComment(projectId, commentId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const ref = commentDocRef(project, commentId);
  if (!ref) return;
  await deleteDoc(ref);
}

export async function resolveComment(projectId, commentId, resolved) {
  const user = auth.currentUser;
  if (!user) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const ref = commentDocRef(project, commentId);
  if (!ref) return;
  await updateDoc(ref, {
    resolved,
    resolvedBy: resolved ? (user.displayName || user.email) : null,
    resolvedAt: resolved ? new Date().toISOString() : null
  });
}

// ── UI renderers ──────────────────────────────────────────────

export function renderCollaboratorList() {
  const project = getCurrentProject();
  const list = document.getElementById('studioCollaboratorList');
  if (!list || !project) return;

  const user = auth.currentUser;
  const isOwner = !project.ownerId || project.ownerId === user?.uid;
  const entries = Object.entries(project.collaborators || {});

  const countEl = document.getElementById('collabCount');
  if (countEl) {
    countEl.textContent = entries.length ? `(${entries.length}/${MAX_COLLABORATORS})` : '';
  }

  if (!entries.length) {
    list.innerHTML = '<p class="collab-empty">No collaborators yet.</p>';
    return;
  }

  list.innerHTML = entries.map(([uid, c]) => `
    <div class="collaborator-item">
      <div class="collaborator-avatar">${esc(c.name || c.email)[0].toUpperCase()}</div>
      <div class="collaborator-info">
        <span class="collaborator-name">${esc(c.name || c.email)}</span>
        <span class="collaborator-email">${esc(c.email)}</span>
      </div>
      ${isOwner ? `<button class="kick-btn" data-uid="${uid}" title="Remove collaborator">✕</button>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await customConfirm(
        `Remove this collaborator from "${project.title}"?`,
        'Remove Collaborator'
      );
      if (confirmed) kickCollaborator(project.id, btn.dataset.uid);
    });
  });
}

function renderCollabRequests(invitations) {
  ['homeCollabRequests', 'studioCollabRequests'].forEach(id => {
    const list = document.getElementById(id);
    if (!list) return;

    if (!invitations.length) {
      list.innerHTML = '<p class="collab-empty">No pending requests.</p>';
      return;
    }

    list.innerHTML = invitations.map(inv => `
      <div class="collab-request-item">
        <div class="collab-request-info">
          <span class="collab-request-from">${esc(inv.fromName)}</span>
          <span class="collab-request-project">Invited you to: <strong>${esc(inv.projectTitle)}</strong></span>
        </div>
        <div class="collab-request-actions">
          <button class="ghost-button collab-accept-btn" data-invite-id="${inv.id}">Accept</button>
          <button class="ghost-button collab-decline-btn" data-invite-id="${inv.id}">Decline</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.collab-accept-btn').forEach(btn => {
      btn.addEventListener('click', () => acceptInvitation(btn.dataset.inviteId));
    });
    list.querySelectorAll('.collab-decline-btn').forEach(btn => {
      btn.addEventListener('click', () => declineInvitation(btn.dataset.inviteId));
    });
  });
}

function renderCommentList(comments, projectId) {
  const list = document.getElementById('studioCommentList');
  if (!list) return;

  if (!comments.length) {
    list.innerHTML = '<p class="collab-empty">No comments yet.</p>';
    return;
  }

  list.innerHTML = comments.map(c => `
    <div class="comment-item${c.resolved ? ' comment-resolved' : ''}">
      <div class="comment-meta">
        <span class="comment-author">${esc(c.userName)}</span>
        <span class="comment-time">${fmtTime(c.createdAt)}</span>
        ${c.resolved ? `<span class="comment-resolved-label">Resolved by ${esc(c.resolvedBy || '')}</span>` : ''}
      </div>
      <p class="comment-text">${esc(c.text)}</p>
      <button class="ghost-button comment-resolve-btn" data-comment-id="${c.id}" data-resolved="${c.resolved}">
        ${c.resolved ? 'Unresolve' : 'Resolve'}
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.comment-resolve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      resolveComment(projectId, btn.dataset.commentId, btn.dataset.resolved !== 'true');
    });
  });
}

// ── Comment compose overlay ───────────────────────────────────

let composePendingLineId = null;

export function showCommentCompose(lineId, anchorRect = null) {
  composePendingLineId = lineId || null;
  const overlay = document.getElementById('commentComposeOverlay');
  const textarea = document.getElementById('commentComposeText');
  if (!overlay) return;
  overlay.hidden = false;
  if (anchorRect) {
    const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 160);
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320));
    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.position = 'fixed';
  }
  textarea?.focus();
}

export function hideCommentCompose() {
  const overlay = document.getElementById('commentComposeOverlay');
  if (overlay) overlay.hidden = true;
  const textarea = document.getElementById('commentComposeText');
  if (textarea) textarea.value = '';
  composePendingLineId = null;
}

export async function submitCommentCompose() {
  const project = getCurrentProject();
  if (!project) return;
  const textarea = document.getElementById('commentComposeText');
  const text = textarea?.value?.trim();
  if (!text) return;
  hideCommentCompose();
  try {
    await addComment(project.id, text, { lineId: composePendingLineId });
  } catch (err) {
    console.error('[comment submit]', err);
  }
}

// ── Left pane comments renderer ───────────────────────────────

function getSceneForLine(lineId, project) {
  const lineIdx = project.lines.findIndex(l => l.id === lineId);
  if (lineIdx < 0) return null;
  for (let i = lineIdx; i >= 0; i--) {
    if (project.lines[i].type === 'scene') return project.lines[i];
  }
  return null;
}

function getSceneNumber(sceneId, project) {
  let num = 0;
  for (const line of project.lines) {
    if (line.type === 'scene') num++;
    if (line.id === sceneId) return num;
  }
  return num;
}

export function renderLeftPaneComments() {
  const countEl = document.getElementById('commentCount');
  const topLevel = allComments.filter(c => !c.parentId);
  if (countEl) countEl.textContent = `${topLevel.length} comment${topLevel.length !== 1 ? 's' : ''}`;
  // If the list dialog is open, refresh it in place
  const dialog = document.getElementById('commentListDialog');
  if (dialog?.open) populateCommentListDialog();
}

function populateCommentListDialog() {
  const list = document.getElementById('cldList');
  const titleEl = document.getElementById('cldTitle');
  if (!list) return;

  const user = auth.currentUser;
  const project = getCurrentProject();
  if (!project) { list.innerHTML = '<p class="collab-empty">No project open.</p>'; return; }

  const lineOrder = project.lines.map(l => l.id);
  const topLevel = allComments.filter(c => !c.parentId);
  const repliesByParent = allComments.filter(c => c.parentId).reduce((acc, r) => {
    (acc[r.parentId] = acc[r.parentId] || []).push(r);
    return acc;
  }, {});

  let filtered = [...topLevel];
  if (commentFilter.user === 'mine' && user) filtered = filtered.filter(c => c.uid === user.uid);
  if (commentFilter.status === 'resolved')   filtered = filtered.filter(c => c.resolved);
  if (commentFilter.status === 'unresolved') filtered = filtered.filter(c => !c.resolved);

  if (commentFilter.sort === 'line') {
    filtered.sort((a, b) => {
      const ai = lineOrder.indexOf(a.lineId), bi = lineOrder.indexOf(b.lineId);
      const av = ai === -1 ? Infinity : ai, bv = bi === -1 ? Infinity : bi;
      return av !== bv ? av - bv : new Date(a.createdAt) - new Date(b.createdAt);
    });
  } else {
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  if (titleEl) titleEl.textContent = `Comments (${filtered.length})`;

  if (!filtered.length) {
    list.innerHTML = '<p class="collab-empty">No comments match the current filters.</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(c => {
    const scene = c.lineId ? getSceneForLine(c.lineId, project) : null;
    const sceneNum = scene ? getSceneNumber(scene.id, project) : 0;
    const sceneText = scene ? `Scene ${sceneNum}: ${(scene.text || '').trim()}` : '';
    const linePreview = c.lineId ? getLinePreview(c.lineId) : '';
    const threadReplies = repliesByParent[c.id] || [];
    const isOwner = !project.ownerId || project.ownerId === user?.uid;
    const isAuthor = c.uid === user?.uid;

    const item = document.createElement('div');
    item.className = 'cld-item' + (c.resolved ? ' is-resolved' : '');
    item.dataset.commentId = c.id;
    item.innerHTML = `
      ${sceneText ? `<div class="cld-scene">${esc(sceneText)}</div>` : ''}
      ${linePreview ? `<button class="cld-line-btn" data-line-id="${esc(c.lineId)}">"${esc(linePreview)}"</button>` : ''}
      <div class="cld-meta">
        <span class="cld-author">${esc(c.userName)}</span>
        <span class="cld-time">${fmtTime(c.createdAt)}</span>
        ${c.resolved ? `<span class="comment-resolved-pill">Resolved by ${esc(c.resolvedBy || '')}</span>` : ''}
      </div>
      <p class="cld-text">${esc(c.text)}</p>
      ${threadReplies.length ? `<div class="cld-replies">${threadReplies.map(r => `
        <div class="cld-reply"><span class="cld-reply-author">${esc(r.userName)}</span> <span class="cld-reply-time">${fmtTime(r.createdAt)}</span>
        <p class="cld-reply-text">${esc(r.text)}</p></div>`).join('')}
      </div>` : ''}
      <div class="cld-reply-compose" hidden>
        <textarea class="cld-reply-input" rows="2" placeholder="Write a reply…"></textarea>
        <button class="cld-reply-send ghost-button">Send</button>
      </div>
      <div class="cld-actions">
        <button class="cld-btn-reply ghost-button">Reply</button>
        <button class="cld-btn-resolve ghost-button">${c.resolved ? 'Unresolve' : 'Resolve'}</button>
        ${(isAuthor || isOwner) ? `<button class="cld-btn-delete ghost-button">Delete</button>` : ''}
      </div>
    `;

    // Navigate to line
    item.querySelector('.cld-line-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const lineId = e.currentTarget.dataset.lineId;
      if (lineId) window.dispatchEvent(new CustomEvent('focusScriptLine', { detail: { lineId } }));
      document.getElementById('commentListDialog')?.close();
    });

    // Toggle reply compose
    item.querySelector('.cld-btn-reply')?.addEventListener('click', () => {
      const rc = item.querySelector('.cld-reply-compose');
      rc.hidden = !rc.hidden;
      if (!rc.hidden) rc.querySelector('.cld-reply-input')?.focus();
    });

    // Send reply
    const sendReply = async () => {
      const input = item.querySelector('.cld-reply-input');
      const text = input?.value?.trim();
      if (!text) return;
      await addComment(project.id, text, { lineId: c.lineId, parentId: c.id });
      populateCommentListDialog();
    };
    item.querySelector('.cld-reply-send')?.addEventListener('click', sendReply);
    item.querySelector('.cld-reply-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    // Resolve
    item.querySelector('.cld-btn-resolve')?.addEventListener('click', async () => {
      await resolveComment(project.id, c.id, !c.resolved);
      populateCommentListDialog();
    });

    // Delete
    item.querySelector('.cld-btn-delete')?.addEventListener('click', async () => {
      const confirmed = await customConfirm('Delete this comment?', 'Delete Comment');
      if (!confirmed) return;
      await deleteComment(project.id, c.id);
      populateCommentListDialog();
    });

    list.appendChild(item);
  });
}

export function showCommentPanel() {
  populateCommentListDialog();
  const dialog = document.getElementById('commentListDialog');
  if (dialog && !dialog.open) dialog.showModal();
}


// ── Comment icons on script lines ────────────────────────────

export function updateCommentIcons(comments) {
  // Remove existing indicators
  document.querySelectorAll('.comment-indicator').forEach(el => el.remove());

  const topLevel = (comments || allComments).filter(c => !c.parentId);
  const byLine = topLevel.reduce((acc, c) => {
    if (c.lineId) (acc[c.lineId] = acc[c.lineId] || []).push(c);
    return acc;
  }, {});

  Object.entries(byLine).forEach(([lineId, lineComments]) => {
    const row = document.querySelector(`.script-block-row[data-id="${lineId}"]`);
    if (!row) return;
    const allResolved = lineComments.every(c => c.resolved);
    const btn = document.createElement('button');
    btn.className = 'comment-indicator' + (allResolved ? ' is-resolved' : ' is-unresolved');
    btn.title = allResolved ? 'All comments resolved' : `${lineComments.length} comment${lineComments.length > 1 ? 's' : ''}`;
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showCommentDetail(lineComments[0].id);
    });
    row.appendChild(btn);
  });
}

// ── Comment detail popup ──────────────────────────────────────

let detailCommentId = null;

export function showCommentDetail(commentId) {
  const comment = allComments.find(c => c.id === commentId);
  if (!comment) return;
  detailCommentId = commentId;

  const project = getCurrentProject();
  const user = auth.currentUser;
  const isOwner = !project?.ownerId || project?.ownerId === user?.uid;
  const isAuthor = comment.uid === user?.uid;

  const replies = allComments.filter(c => c.parentId === commentId);

  const dialog = document.getElementById('commentDetailDialog');
  if (!dialog) return;

  dialog.querySelector('#cdAuthor').textContent = comment.userName;
  dialog.querySelector('#cdTime').textContent = fmtTime(comment.createdAt);
  dialog.querySelector('#cdText').textContent = comment.text;

  const resolvedPill = dialog.querySelector('#cdResolvedPill');
  resolvedPill.hidden = !comment.resolved;
  resolvedPill.textContent = comment.resolved ? `Resolved by ${comment.resolvedBy || ''}` : '';

  const repliesEl = dialog.querySelector('#cdReplies');
  repliesEl.innerHTML = replies.length ? replies.map(r => `
    <div class="cd-reply">
      <span class="cd-reply-author">${esc(r.userName)}</span>
      <span class="cd-reply-time">${fmtTime(r.createdAt)}</span>
      <p class="cd-reply-text">${esc(r.text)}</p>
    </div>
  `).join('') : '';

  const resolveBtn = dialog.querySelector('#cdResolveBtn');
  resolveBtn.textContent = comment.resolved ? 'Unresolve' : 'Mark as Solved';
  resolveBtn.dataset.commentId = commentId;
  resolveBtn.dataset.resolved = String(comment.resolved);

  const deleteBtn = dialog.querySelector('#cdDeleteBtn');
  deleteBtn.hidden = !(isAuthor || isOwner);
  deleteBtn.dataset.commentId = commentId;

  dialog.showModal();
}

function initCommentDetailDialog() {
  const dialog = document.getElementById('commentDetailDialog');
  if (!dialog) return;

  dialog.querySelector('#cdResolveBtn').addEventListener('click', async () => {
    const project = getCurrentProject();
    if (!project) return;
    const btn = dialog.querySelector('#cdResolveBtn');
    await resolveComment(project.id, btn.dataset.commentId, btn.dataset.resolved !== 'true');
    dialog.close();
  });

  dialog.querySelector('#cdDeleteBtn').addEventListener('click', async () => {
    const project = getCurrentProject();
    if (!project) return;
    const confirmed = await customConfirm('Delete this comment?', 'Delete Comment');
    if (!confirmed) return;
    const btn = dialog.querySelector('#cdDeleteBtn');
    await deleteComment(project.id, btn.dataset.commentId);
    dialog.close();
  });

  dialog.querySelector('#cdCloseBtn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

function initCommentListDialog() {
  const dialog = document.getElementById('commentListDialog');
  if (!dialog) return;
  document.getElementById('cldCloseBtn')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

// Init dialogs on first module load
document.addEventListener('DOMContentLoaded', () => {
  initCommentDetailDialog();
  initCommentListDialog();
});

function getLinePreview(lineId) {
  const project = getCurrentProject();
  const line = project?.lines?.find(l => l.id === lineId);
  if (!line?.text) return '';
  const t = line.text.trim();
  return t.length > 50 ? t.slice(0, 50) + '…' : t;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return ''; }
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
