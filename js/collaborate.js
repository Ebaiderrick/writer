import { auth, db } from './firebase.js';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';
import { getCurrentProject, sanitizeProject, upsertProject, persistProjects } from './project.js';
import { uid as makeId } from './utils.js';
import { customAlert, customConfirm } from './ui.js';

const MAX_COLLABORATORS = 5;
let unsubInvites = null;
let unsubComments = null;
let unsubSharedProject = null;

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
    subscribeToComments(projectId);
  } else {
    if (unsubSharedProject) { unsubSharedProject(); unsubSharedProject = null; }
    if (unsubComments) { unsubComments(); unsubComments = null; }
    const list = document.getElementById('studioCommentList');
    if (list) list.innerHTML = '<p class="collab-empty">Comments are available on shared projects.</p>';
  }
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

export function subscribeToComments(projectId) {
  if (unsubComments) unsubComments();
  const q = query(
    collection(db, 'sharedProjects', projectId, 'comments'),
    orderBy('createdAt', 'desc')
  );
  unsubComments = onSnapshot(q, snap => {
    renderCommentList(snap.docs.map(d => ({ id: d.id, ...d.data() })), projectId);
  });
}

export async function addComment(projectId, text) {
  const user = auth.currentUser;
  if (!user || !text.trim()) return;
  const commentId = makeId('cmt');
  await setDoc(doc(db, 'sharedProjects', projectId, 'comments', commentId), {
    id: commentId,
    uid: user.uid,
    userName: user.displayName || user.email,
    text: text.trim(),
    resolved: false,
    createdAt: new Date().toISOString()
  });
}

export async function resolveComment(projectId, commentId, resolved) {
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, 'sharedProjects', projectId, 'comments', commentId), {
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
