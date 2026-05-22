import { auth, db } from './firebase.js';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';
import { logActivity, logCommentActivity, ACTIVITY_CATEGORIES } from './activity.js';
import { Telemetry } from './telemetry.js';
import { Logger } from './logger.js';
import { getCurrentProject, sanitizeProject, upsertProject, persistProjects, deleteProjectFromCloud } from './project.js';
import { uid as makeId } from './utils.js';
import { customAlert, customConfirm, showHome, renderHome } from './ui.js';

// Comment filter state
let commentFilter = { user: 'all', sort: 'line', status: 'all' };
let allComments = [];

const MAX_COLLABORATORS = 5;
export const EDITOR_ROLES = {
  owner: 'owner',
  editor: 'editor',
  viewer: 'viewer'
};
const EMAILJS_SERVICE = 'service_j18y8zo';
const EMAILJS_TEMPLATE = 'template_6qr97mn';
const EMAILJS_PUBLIC_KEY = 'VI5qc4g4cH9d0vpvr';

let unsubInvites = null;
let unsubSentInvites = null;
let unsubComments = null;
let unsubSharedProject = null;
let sharedProjectWatchers = new Map();

let _presenceInterval = null;
let _unsubPresence = null;
let _activePresence = [];

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

  if (window.emailjs) window.emailjs.init(EMAILJS_PUBLIC_KEY);

  // Received Invites
  const qRec = query(
    collection(db, 'invitations'),
    where('toEmail', '==', user.email.toLowerCase()),
    where('status', '==', 'pending')
  );

  unsubInvites = onSnapshot(qRec, snap => {
    const invitations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateCollabBadge(invitations.length);
    renderCollabRequests(invitations);
  });

  // Sent Invites
  const qSent = query(
    collection(db, 'invitations'),
    where('fromUid', '==', user.uid)
  );

  unsubSentInvites = onSnapshot(qSent, snap => {
    const invitations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSentInvites(invitations);
  });

  syncSharedProjectWatchers();
}

export function cleanupCollaboration() {
  stopPresenceHeartbeat();
  [unsubInvites, unsubSentInvites, unsubComments, unsubSharedProject].forEach(fn => fn?.());
  unsubInvites = unsubSentInvites = unsubComments = unsubSharedProject = null;
  sharedProjectWatchers.forEach(fn => fn?.());
  sharedProjectWatchers.clear();
}

export function onStudioEnter(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  renderCollaboratorList();
  if (project.isShared) {
    subscribeToSharedProject(projectId);
    startPresenceHeartbeat(projectId);
  } else {
    stopPresenceHeartbeat();
    if (unsubSharedProject) { unsubSharedProject(); unsubSharedProject = null; }
  }
  syncSharedProjectWatchers();
  subscribeToComments(project);
  _initMentionAutocomplete();
}

export function startPresenceHeartbeat(projectId) {
  stopPresenceHeartbeat();
  const user = auth.currentUser;
  if (!user) return;
  const presRef = doc(db, 'sharedProjects', projectId, 'presence', user.uid);
  const write = () => setDoc(presRef, {
    uid: user.uid,
    name: user.displayName || user.email || 'Someone',
    seenAt: new Date().toISOString()
  }, { merge: true }).catch(() => {});
  write();
  _presenceInterval = setInterval(write, 60000);
  const presCol = collection(db, 'sharedProjects', projectId, 'presence');
  _unsubPresence = onSnapshot(presCol, snap => {
    const now = Date.now();
    const STALE = 3 * 60 * 1000;
    _activePresence = snap.docs.map(d => d.data())
      .filter(p => p.seenAt && (now - new Date(p.seenAt).getTime()) < STALE)
      .filter(p => p.uid !== user.uid);
    const proj = state.projects.find(p => p.id === projectId);
    if (proj) renderWorkspaceAwareness(proj);
  }, () => {});
}

export function stopPresenceHeartbeat() {
  if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
  if (_unsubPresence) { _unsubPresence(); _unsubPresence = null; }
  _activePresence = [];
}

export function getUserProjectRole(project = getCurrentProject(), user = auth.currentUser) {
  if (!project || !user) {
    return WORKSPACE_ROLES.viewer;
  }

  if (!project.ownerId || project.ownerId === user.uid) {
    return EDITOR_ROLES.owner;
  }

  return project.collaborators?.[user.uid]?.role || WORKSPACE_ROLES.viewer;
}

export function canEditProject(project = getCurrentProject(), user = auth.currentUser) {
  return getUserProjectRole(project, user) !== EDITOR_ROLES.viewer;
}

export function canManageEditor(project = getCurrentProject(), user = auth.currentUser) {
  return getUserProjectRole(project, user) === EDITOR_ROLES.owner;
}

// ── Centralized permission utility ────────────────────────────
// Single authoritative source for all workspace permission checks.

export const Permissions = {
  getRole: getUserProjectRole,
  canEdit: canEditProject,
  canManage: canManageWorkspace,

  /** True if user is the project owner or any listed collaborator. */
  isMember(project = getCurrentProject(), user = auth.currentUser) {
    if (!project || !user) return false;
    if (!project.ownerId || project.ownerId === user.uid) return true;
    return Boolean(project.collaborators?.[user.uid]);
  },

  /** Comment author or project owner can delete a comment. */
  canDeleteComment(comment, project = getCurrentProject(), user = auth.currentUser) {
    if (!comment || !project || !user) return false;
    return comment.uid === user.uid || canManageWorkspace(project, user);
  },

  /** Non-viewer members can resolve/unresolve comments. */
  canResolveComment(_comment, project = getCurrentProject(), user = auth.currentUser) {
    return canEditProject(project, user);
  }
};

function updateCollabBadge(count) {
  document.querySelectorAll('.collab-badge').forEach(b => {
    b.textContent = count || '';
    b.hidden = !count;
  });
}

// ── Invite ────────────────────────────────────────────────────

export async function inviteCollaborator(email, role = EDITOR_ROLES.editor) {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, reason: 'Not signed in.' };

    const project = getCurrentProject();
    if (!project) return { ok: false, reason: 'No project open. Open a project first.' };
    if (!canManageEditor(project, user)) {
      return { ok: false, reason: 'Only the Editor owner can invite teammates.' };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return { ok: false, reason: 'Please enter an email address.' };

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
      return { ok: false, reason: 'No account found for this email. The user must sign up first.' };
    }

    // Check for existing pending invite (simple single-field query to avoid composite index issues)
    const existingQ = query(
      collection(db, 'invitations'),
      where('fromUid', '==', user.uid),
      where('toEmail', '==', normalizedEmail),
      where('projectId', '==', project.id)
    );
    let existing;
    try {
      existing = await getDocs(existingQ);
    } catch {
      existing = { empty: true };
    }
    if (!existing.empty) {
      const hasPending = existing.docs.some(d => d.data().status === 'pending');
      if (hasPending) return { ok: false, reason: 'Invitation already pending for this person.' };
    }

    await ensureSharedProject(project, user);

    const inviteId = makeId('inv');
    const inviteData = {
      id: inviteId,
      fromUid: user.uid,
      fromName: user.displayName || user.email,
      fromEmail: user.email,
      toEmail: normalizedEmail,
      role: role === EDITOR_ROLES.viewer ? EDITOR_ROLES.viewer : EDITOR_ROLES.editor,
      projectId: project.id,
      projectTitle: project.title,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'invitations', inviteId), inviteData);
    await logActivity(project.id, `Invited ${normalizedEmail} as ${inviteData.role}.`, { category: ACTIVITY_CATEGORIES.invite });

    // Send email notification (best-effort)
    if (window.emailjs) {
      try {
        await window.emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
          to_email: normalizedEmail,
          from_name: inviteData.fromName,
          project_title: inviteData.projectTitle,
          to_name: userSnap.data().name || normalizedEmail,
          type: 'invite'
        });
      } catch (err) {
        console.warn('Invite email notification failed (invite was saved):', err);
      }
    }

    Telemetry.track('collab_invite_sent', { role });
    return { ok: true };
  } catch (err) {
    Logger.capture('inviteCollaborator', err);
    return { ok: false, reason: err.message || 'An error occurred. Please try again.' };
  }
}

async function ensureSharedProject(project, user) {
  // Skip Firestore read when local state already marks the project as shared.
  if (project.isShared) return;

  const ref = doc(db, 'sharedProjects', project.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const shareEntry = {
      timestamp: new Date().toISOString(),
      user: user.displayName || user.email || 'Unknown User',
      uid: user.uid,
      category: ACTIVITY_CATEGORIES.workspace,
      message: `Shared "${project.title}" with the team.`
    };
    const activityLog = [...(project.activityLog || []), shareEntry];
    await setDoc(ref, {
      ...project,
      ownerId: user.uid,
      ownerName: user.displayName || user.email,
      ownerEmail: user.email,
      ownerPhotoURL: user.photoURL || '',
      editor: project.editor || {
        id: project.id,
        name: project.title || 'Team Editor',
        inviteCode: project.scriptId || '',
        reminders: []
      },
      collaborators: {},
      isShared: true,
      activityLog,
      lastActivityAt: shareEntry.timestamp,
      lastEditorName: shareEntry.user,
      updatedBy: user.uid,
      syncedAt: new Date().toISOString()
    });
    project.activityLog = activityLog;
    project.lastActivityAt = shareEntry.timestamp;
  }
  project.isShared = true;
  project.ownerId = user.uid;
  project.ownerName = user.displayName || user.email;
  project.ownerEmail = user.email;
  project.ownerPhotoURL = user.photoURL || "";
  project.collaborators = project.collaborators || {};
  persistProjects(false);
  syncSharedProjectWatchers();
}

// ── Accept / Decline ──────────────────────────────────────────

export async function acceptInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Primary path: server-side acceptance via Admin SDK (atomic + validated).
    let token = '';
    try { token = await user.getIdToken(); } catch { /* continue without token */ }

    const res = await fetch('/api/accept-invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ inviteId })
    });

    const data = await res.json().catch(() => ({}));

    // Fallback path: Admin SDK not configured in this environment.
    if (res.status === 503 && data.fallback) {
      return _acceptInvitationClientSide(inviteId);
    }

    if (!res.ok) {
      Logger.capture('acceptInvitation', new Error(data.error || `HTTP ${res.status}`), { inviteId });
      return;
    }

    const { projectId, role, project: sharedProject } = data;
    if (!sharedProject || !projectId) return;

    // Copy project into recipient's personal projects (client write to own subcollection).
    const projectForUser = sanitizeProject(sharedProject);
    await setDoc(doc(db, 'users', user.uid, 'projects', projectId), {
      ...projectForUser,
      syncedAt: new Date().toISOString()
    });

    await logActivity(projectId, `Joined project as ${role === WORKSPACE_ROLES.viewer ? 'Viewer' : 'Editor'}.`, { category: ACTIVITY_CATEGORIES.member });
    Telemetry.track('collab_invite_accepted', { projectId });
    upsertProject(projectForUser);
    persistProjects(false);
    renderHome();
    syncSharedProjectWatchers();
    subscribeToSharedProject(projectId);
  } catch (err) {
    Logger.capture('acceptInvitation', err);
    console.error('Failed to accept invitation:', err);
  }
}

// Client-side fallback for local dev when FIREBASE_SERVICE_ACCOUNT is not configured.
async function _acceptInvitationClientSide(inviteId) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const invSnap = await getDoc(doc(db, 'invitations', inviteId));
    if (!invSnap.exists()) return;
    const inv = invSnap.data();

    if (inv.status !== 'pending') return;
    if (inv.toEmail.toLowerCase() !== user.email.toLowerCase()) return;

    const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
    const profileData = profileSnap.exists() ? profileSnap.data() : {};

    const sharedRef = doc(db, 'sharedProjects', inv.projectId);
    const projectExistsSnap = await getDoc(sharedRef);
    if (!projectExistsSnap.exists()) {
      await updateDoc(doc(db, 'invitations', inviteId), { status: 'declined' });
      return;
    }

    // Uses the Firestore self-add rule (allowed in dev environments).
    await updateDoc(sharedRef, {
      [`collaborators.${user.uid}`]: {
        name: user.displayName || user.email,
        email: user.email,
        photoURL: profileData.photoURL || user.photoURL || '',
        addedAt: new Date().toISOString(),
        role: inv.role === WORKSPACE_ROLES.viewer ? WORKSPACE_ROLES.viewer : WORKSPACE_ROLES.editor
      },
      updatedBy: user.uid
    });

    await updateDoc(doc(db, 'invitations', inviteId), { status: 'accepted' });
    await logActivity(inv.projectId, `Joined project as ${inv.role === WORKSPACE_ROLES.viewer ? 'Viewer' : 'Editor'}.`, { category: ACTIVITY_CATEGORIES.member });

    const projSnap = await getDoc(sharedRef);
    if (!projSnap.exists()) return;
    const projectForUser = sanitizeProject(projSnap.data());
    await setDoc(doc(db, 'users', user.uid, 'projects', inv.projectId), {
      ...projectForUser,
      syncedAt: new Date().toISOString()
    });

    Telemetry.track('collab_invite_accepted', { projectId: inv.projectId });
    upsertProject(projectForUser);
    persistProjects(false);
    renderHome();
    syncSharedProjectWatchers();
    subscribeToSharedProject(inv.projectId);
  } catch (err) {
    Logger.capture('_acceptInvitationClientSide', err);
    console.error('Client-side fallback acceptance failed:', err);
  }
}

export async function declineInvitation(inviteId) {
  await updateDoc(doc(db, 'invitations', inviteId), { status: 'declined' });
}

// ── Kick ──────────────────────────────────────────────────────

export async function kickCollaborator(projectId, collaboratorUid) {
  const user = auth.currentUser;
  if (!user) return;

  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!project) return;

  if (!canManageEditor(project, user)) {
    await customAlert('Only the project owner can remove collaborators.', 'Not Authorized');
    return;
  }

  if (collaboratorUid === user.uid) {
    await customAlert('You cannot remove yourself. Use "Leave workspace" instead.', 'Not Allowed');
    return;
  }

  const newCollaborators = { ...(project.collaborators || {}) };
  delete newCollaborators[collaboratorUid];

  // updatedBy set to owner so the kicked user's listener fires and shows the change.
  await updateDoc(doc(db, 'sharedProjects', projectId), {
    collaborators: newCollaborators,
    updatedBy: user.uid,
    lastEditorName: user.displayName || user.email
  });

  project.collaborators = newCollaborators;
  await logActivity(projectId, 'Removed a collaborator from the workspace.', { category: ACTIVITY_CATEGORIES.member });
  persistProjects(false);
  renderCollaboratorList();
  renderHome();
  syncSharedProjectWatchers();
}

export async function updateCollaboratorRole(projectId, collaboratorUid, role) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Not signed in.' };

  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!project) return { ok: false, reason: 'No project found.' };
  if (!canManageEditor(project, user)) {
    return { ok: false, reason: 'Only the Editor owner can change roles.' };
  }

  const collaborator = project.collaborators?.[collaboratorUid];
  if (!collaborator) {
    return { ok: false, reason: 'Collaborator not found.' };
  }

  if (role === WORKSPACE_ROLES.owner) {
    return { ok: false, reason: 'Use the "Transfer Ownership" option to change ownership.' };
  }

  const nextRole = role === WORKSPACE_ROLES.viewer ? WORKSPACE_ROLES.viewer : WORKSPACE_ROLES.editor;
  if (collaborator.role === nextRole) {
    return { ok: true };
  }

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    [`collaborators.${collaboratorUid}.role`]: nextRole,
    updatedBy: user.uid
  });

  project.collaborators[collaboratorUid] = {
    ...collaborator,
    role: nextRole
  };
  await logActivity(projectId, `Changed ${collaborator.name || collaborator.email} to ${nextRole}.`, { category: ACTIVITY_CATEGORIES.role });
  persistProjects(false);
  renderCollaboratorList();
  renderHome();
  return { ok: true };
}

export async function renameEditor(projectId, name) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No Editor found.' };
  if (!canManageEditor(project, user)) {
    return { ok: false, reason: 'Only the Editor owner can rename the Editor.' };
  }

  const nextName = String(name || '').trim();
  if (!nextName) {
    return { ok: false, reason: 'Editor name cannot be empty.' };
  }

  project.editor = {
    ...(project.editor || {}),
    id: project.editor?.id || project.id,
    inviteCode: project.editor?.inviteCode || project.scriptId || '',
    reminders: Array.isArray(project.editor?.reminders) ? project.editor.reminders : [],
    name: nextName
  };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    editor: project.editor,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Renamed the workspace to ${nextName}.`, { category: ACTIVITY_CATEGORIES.workspace });
  persistProjects(false);
  renderHome();
  return { ok: true };
}

export async function addEditorReminder(projectId, reminder) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No Editor found.' };
  if (!canEditProject(project, user)) {
    return { ok: false, reason: 'Viewers cannot edit reminders.' };
  }

  const text = String(reminder?.text || '').trim();
  if (!text) {
    return { ok: false, reason: 'Reminder text cannot be empty.' };
  }

  const nextReminder = {
    id: makeId('rem'),
    text,
    dueAt: reminder?.dueAt || '',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByName: user.displayName || user.email || 'Unknown'
  };

  const editor = project.editor || { id: project.id, name: project.title || 'Team Editor', inviteCode: project.scriptId || '', reminders: [] };
  const reminders = [...(editor.reminders || []), nextReminder];
  project.editor = { ...editor, reminders };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    editor: project.editor,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Added reminder: ${text}.`, { category: ACTIVITY_CATEGORIES.workspace });
  persistProjects(false);
  return { ok: true };
}

export async function toggleEditorReminder(projectId, reminderId) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No Editor found.' };
  if (!canEditProject(project, user)) {
    return { ok: false, reason: 'Viewers cannot edit reminders.' };
  }

  const editor = project.editor || { id: project.id, name: project.title || 'Team Editor', inviteCode: project.scriptId || '', reminders: [] };
  const reminders = (editor.reminders || []).map((item) => item.id === reminderId
    ? { ...item, completed: !item.completed, updatedAt: new Date().toISOString() }
    : item
  );
  const changed = reminders.find((item) => item.id === reminderId);
  if (!changed) {
    return { ok: false, reason: 'Reminder not found.' };
  }

  project.editor = { ...editor, reminders };
  await updateDoc(doc(db, 'sharedProjects', projectId), {
    editor: project.editor,
    updatedBy: user.uid
  });
  await logActivity(projectId, `${changed.completed ? 'Completed' : 'Reopened'} reminder: ${changed.text}.`, { category: ACTIVITY_CATEGORIES.workspace });
  persistProjects(false);
  return { ok: true };
}

export async function deleteEditorReminder(projectId, reminderId) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No Editor found.' };
  if (!canEditProject(project, user)) {
    return { ok: false, reason: 'Viewers cannot edit reminders.' };
  }

  const editor = project.editor || { id: project.id, name: project.title || 'Team Editor', inviteCode: project.scriptId || '', reminders: [] };
  const existing = (editor.reminders || []).find((item) => item.id === reminderId);
  if (!existing) {
    return { ok: false, reason: 'Reminder not found.' };
  }

  project.editor = {
    ...editor,
    reminders: (editor.reminders || []).filter((item) => item.id !== reminderId)
  };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    editor: project.editor,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Removed reminder: ${existing.text}.`, { category: ACTIVITY_CATEGORIES.workspace });
  persistProjects(false);
  return { ok: true };
}

export async function transferOwnership(projectId, newOwnerUid) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Not signed in.' };

  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!project) return { ok: false, reason: 'No project found.' };
  if (!canManageWorkspace(project, user)) {
    return { ok: false, reason: 'Only the current owner can transfer ownership.' };
  }
  if (newOwnerUid === user.uid) {
    return { ok: false, reason: 'You are already the owner.' };
  }
  if (!project.collaborators?.[newOwnerUid]) {
    return { ok: false, reason: 'The new owner must be a current collaborator.' };
  }

  try {
    let token = '';
    try { token = await user.getIdToken(); } catch { /* continue */ }

    const res = await fetch('/api/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ projectId, newOwnerUid })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, reason: data.error || `Server error (${res.status})` };
    }

    // Update local state from server response.
    if (data.project) {
      const updated = sanitizeProject(data.project);
      upsertProject(updated);
    } else {
      // Fallback local update if server didn't return the full project.
      const collab = project.collaborators[newOwnerUid];
      const oldOwnerEntry = {
        name: project.ownerName || '',
        email: project.ownerEmail || '',
        photoURL: project.ownerPhotoURL || '',
        addedAt: new Date().toISOString(),
        role: WORKSPACE_ROLES.editor
      };
      const newCollaborators = { ...project.collaborators };
      delete newCollaborators[newOwnerUid];
      newCollaborators[user.uid] = oldOwnerEntry;

      project.ownerId = newOwnerUid;
      project.ownerName = collab.name || collab.email || '';
      project.ownerEmail = collab.email || '';
      project.ownerPhotoURL = collab.photoURL || '';
      project.collaborators = newCollaborators;
    }

    Telemetry.track('collab_ownership_transferred', { projectId });
    persistProjects(false);
    renderCollaboratorList();
    renderHome();
    return { ok: true };
  } catch (err) {
    Logger.capture('transferOwnership', err);
    return { ok: false, reason: err.message || 'Failed to transfer ownership.' };
  }
}

export async function revokeInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await deleteDoc(doc(db, 'invitations', inviteId));
    Telemetry.track('collab_invite_revoked');
  } catch (err) {
    Logger.capture('revokeInvitation', err);
    console.error('Failed to revoke invitation:', err);
  }
}

// ── Real-time listeners ───────────────────────────────────────

export function subscribeToSharedProject(projectId) {
  if (unsubSharedProject) unsubSharedProject();
  unsubSharedProject = onSnapshot(
    doc(db, 'sharedProjects', projectId),
    snap => {
      if (!snap.exists()) return;
      if (snap.data().updatedBy === auth.currentUser?.uid) return;
      const updated = sanitizeProject(snap.data());
      upsertProject(updated);
      persistProjects(false);
      renderCollaboratorList();
      renderHome();
      syncSharedProjectWatchers();
      if (state.currentProjectId === projectId) {
        window.dispatchEvent(new CustomEvent('sharedProjectUpdated', { detail: { projectId } }));
      }
    },
    err => {
      if (err.code === 'permission-denied') {
        handleSharedProjectRemoved(projectId);
      }
    }
  );
}

function syncSharedProjectWatchers() {
  const user = auth.currentUser;
  if (!user) return;

  // Watch ALL shared projects — both owned (catches collaborator edits while not in studio)
  // and collaborated (catches owner edits and removal).
  const sharedIds = new Set(
    state.projects
      .filter(project => project.isShared)
      .map(project => project.id)
  );

  sharedProjectWatchers.forEach((unsubscribe, projectId) => {
    if (!sharedIds.has(projectId)) {
      unsubscribe?.();
      sharedProjectWatchers.delete(projectId);
    }
  });

  sharedIds.forEach(projectId => {
    if (sharedProjectWatchers.has(projectId)) return;
    const unsubscribe = onSnapshot(
      doc(db, 'sharedProjects', projectId),
      snap => {
        if (!snap.exists()) {
          handleSharedProjectRemoved(projectId);
          return;
        }

        const snapData = snap.data();
        const isOwner = !snapData.ownerId || snapData.ownerId === user.uid;

        // Collaborator was removed — clean up their local copy.
        if (!isOwner && !snapData.collaborators?.[user.uid]) {
          handleSharedProjectRemoved(projectId);
          return;
        }

        if (snapData.updatedBy === user.uid) return;
        const updated = sanitizeProject(snapData);
        upsertProject(updated);
        persistProjects(false);
        renderHome();
        if (state.currentProjectId === projectId) {
          renderCollaboratorList();
          window.dispatchEvent(new CustomEvent('sharedProjectUpdated', { detail: { projectId } }));
        }
      },
      err => {
        if (err.code === 'permission-denied') handleSharedProjectRemoved(projectId);
      }
    );
    sharedProjectWatchers.set(projectId, unsubscribe);
  });
}

function handleSharedProjectRemoved(projectId) {
  const watcher = sharedProjectWatchers.get(projectId);
  watcher?.();
  sharedProjectWatchers.delete(projectId);
  if (unsubSharedProject) {
    unsubSharedProject();
    unsubSharedProject = null;
  }

  state.projects = state.projects.filter(project => project.id !== projectId);
  if (state.currentProjectId === projectId) {
    state.currentProjectId = state.projects[0]?.id || null;
    showHome();
  }
  persistProjects(false, { syncInputs: false });
  deleteProjectFromCloud(projectId);
  renderHome();
  syncSharedProjectWatchers();
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
    _updateUnresolvedBadge(allComments);
  }, err => console.error('[comments]', err));
}

export function setCommentFilter(key, value) {
  commentFilter[key] = value;
}

export async function addComment(projectId, text, { lineId = null, parentId = null } = {}) {
  const user = auth.currentUser;
  if (!user) {
    await customAlert('You must be signed in with a full account to add comments.', 'Authentication Required');
    return;
  }
  if (!text.trim()) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  if (!canEditProject(project, user)) {
    await customAlert('Viewer access is read-only. Ask the owner for Editor access to comment.', 'Read-only Editor');
    return;
  }
  const ref = commentDocRef(project, makeId('cmt'));
  if (!ref) return;
  const commentId = ref.id;
  const trimmedText = text.trim();
  const mentions = parseMentions(trimmedText, project);
  await setDoc(ref, {
    id: commentId,
    uid: user.uid,
    userName: user.displayName || user.email,
    text: trimmedText,
    lineId: lineId || null,
    parentId: parentId || null,
    mentions,
    resolved: false,
    createdAt: new Date().toISOString()
  });
  logCommentActivity(projectId, parentId ? 'replied' : 'added', { text: trimmedText });
}

export async function deleteComment(projectId, commentId) {
  const user = auth.currentUser;
  if (!user) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  const comment = allComments.find(c => c.id === commentId);
  if (comment && !Permissions.canDeleteComment(comment, project, user)) {
    await customAlert('You can only delete your own comments. Ask the workspace owner to remove others.', 'Not Authorized');
    return;
  }

  const ref = commentDocRef(project, commentId);
  if (!ref) return;
  try {
    await deleteDoc(ref);
    logCommentActivity(projectId, 'deleted');
  } catch (err) {
    Logger.capture('deleteComment', err);
  }
}

export async function resolveComment(projectId, commentId, resolved) {
  const user = auth.currentUser;
  if (!user) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  if (!canEditProject(project, user)) {
    await customAlert('Viewer access is read-only.', 'Read-only Editor');
    return;
  }
  const ref = commentDocRef(project, commentId);
  if (!ref) return;
  const patch = {
    resolved: Boolean(resolved),
    resolvedBy: resolved ? (user.displayName || user.email) : null,
    resolvedAt: resolved ? new Date().toISOString() : null
  };
  await updateDoc(ref, patch);
  logCommentActivity(projectId, resolved ? 'resolved' : 'unresolved');
  allComments = allComments.map((comment) => comment.id === commentId ? { ...comment, ...patch } : comment);
  renderCommentList(allComments, projectId);
  renderLeftPaneComments();
  updateCommentIcons(allComments);
  const detailDialog = document.getElementById('commentDetailDialog');
  if (detailDialog?.open) {
    showCommentDetail(commentId);
  }
}

// ── UI renderers ──────────────────────────────────────────────

export function renderCollaboratorList() {
  const project = getCurrentProject();
  const list = document.getElementById('studioCollaboratorList');
  if (!list || !project) return;

  renderActivityLog(project);
  renderWorkspaceAwareness(project);

  const user = auth.currentUser;
  const isOwner = canManageEditor(project, user);
  const collaboratorEntries = Object.entries(project.collaborators || {});

  const countEl = document.getElementById('collabCount');
  if (countEl) {
    const total = collaboratorEntries.length;
    countEl.textContent = total ? `(${total}/${MAX_COLLABORATORS})` : '';
  }

  const ownerDisplay = project.ownerName || project.ownerEmail || 'Owner';
  const ownerRow = project.ownerId || project.ownerName || project.ownerEmail
    ? `<div class="collaborator-item">
        ${buildCollaboratorAvatarMarkup({
          uid: project.ownerId || '',
          name: ownerDisplay,
          email: project.ownerEmail || '',
          photoURL: project.ownerPhotoURL || '',
          isOwner: true
        })}
        <div class="collaborator-info">
          <span class="collaborator-name">${esc(ownerDisplay)} <span class="owner-badge">Owner</span></span>
          <button class="collaborator-email collab-profile-trigger collaborator-link-trigger" type="button" data-uid="${esc(project.ownerId || '')}" data-name="${esc(project.ownerName || '')}" data-email="${esc(project.ownerEmail || '')}" data-photourl="${esc(project.ownerPhotoURL || '')}">${esc(project.ownerName || project.ownerEmail || 'Owner')}</button>
        </div>
      </div>`
    : '';

  if (!collaboratorEntries.length) {
    list.innerHTML = ownerRow || '<p class="collab-empty">No collaborators yet.</p>';
    if (ownerRow) attachCollabProfileTriggers(list);
    return;
  }

  list.innerHTML = ownerRow + collaboratorEntries.map(([uid, c]) => `
    <div class="collaborator-item">
      ${buildCollaboratorAvatarMarkup({ uid, name: c.name || c.email, email: c.email || '', photoURL: c.photoURL || '' })}
      <div class="collaborator-info">
        <span class="collaborator-name">${esc(c.name || c.email)} <span class="role-badge">${esc((c.role || EDITOR_ROLES.editor).replace(/^./, (char) => char.toUpperCase()))}</span></span>
        <button class="collaborator-email collab-profile-trigger collaborator-link-trigger" type="button" data-uid="${esc(uid)}" data-name="${esc(c.name || '')}" data-email="${esc(c.email || '')}" data-photourl="${esc(c.photoURL || '')}">${esc(c.name || c.email || 'Collaborator')}</button>
        ${isOwner ? `<label class="collab-role-field"><span>Role</span><select class="collab-role-select" data-uid="${esc(uid)}">
          <option value="editor" ${(c.role || WORKSPACE_ROLES.editor) === WORKSPACE_ROLES.editor ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${(c.role || WORKSPACE_ROLES.editor) === WORKSPACE_ROLES.viewer ? 'selected' : ''}>Viewer</option>
        </select></label>
        <button class="transfer-ownership-btn" data-uid="${esc(uid)}" data-name="${esc(c.name || c.email || '')}" title="Transfer ownership to this collaborator">Transfer Ownership</button>` : `<span class="collaborator-role-copy">${esc((c.role || WORKSPACE_ROLES.editor).replace(/^./, (char) => char.toUpperCase()))} access</span>`}
      </div>
      ${isOwner ? `<button class="kick-btn" data-uid="${uid}" title="Remove collaborator">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>` : ''}
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

  list.querySelectorAll('.transfer-ownership-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name || 'this collaborator';
      const confirmed = await customConfirm(
        `Transfer ownership of "${project.title}" to ${name}?\n\nYou will become an Editor. This cannot be undone from the client.`,
        'Transfer Ownership'
      );
      if (!confirmed) return;
      btn.disabled = true;
      const result = await transferOwnership(project.id, btn.dataset.uid);
      btn.disabled = false;
      if (!result.ok) {
        await customAlert(result.reason || 'Ownership transfer failed.', 'Transfer Ownership');
      }
    });
  });

  list.querySelectorAll('.collab-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      select.disabled = true;
      const result = await updateCollaboratorRole(project.id, select.dataset.uid, select.value);
      select.disabled = false;
      if (!result?.ok) {
        await customAlert(result?.reason || 'Unable to update role right now.', 'Editor Role');
        renderCollaboratorList();
      }
    });
  });

  attachCollabProfileTriggers(list);
}

function attachCollabProfileTriggers(list) {
  list.querySelectorAll('.collab-profile-trigger').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const { uid, name, email, photourl } = el.dataset;
      showCollabProfile({ uid, name, email, photoURL: photourl });
    });
  });
}

function formatCollaboratorHandle(value) {
  const raw = String(value || '').trim().replace(/^@/, '');
  return `@${raw || 'user'}`;
}

export async function showCollabProfile({ uid, name, email, photoURL }) {
  const popup = document.getElementById('collab-profile-popup');
  const imgEl = document.getElementById('collab-profile-img');
  const nameEl = document.getElementById('collab-profile-name');
  const emailEl = document.getElementById('collab-profile-email');
  const bioEl = document.getElementById('collab-profile-bio');
  const closeBtn = document.getElementById('close-collab-profile');
  if (!popup) return;

  const displayName = name || email || 'User';
  nameEl.textContent = formatCollaboratorHandle(displayName);
  if (emailEl) {
    emailEl.textContent = '';
    emailEl.hidden = true;
  }
  bioEl.textContent = '—';
  imgEl.src = photoURL || generateCollabAvatar(displayName);

  if (uid === 'ai_assist') {
    nameEl.textContent = 'Eya';
    const handle = document.createElement('div');
    handle.style.fontSize = '0.85rem';
    handle.style.color = 'var(--muted)';
    handle.textContent = '@AIassist';
    nameEl.appendChild(handle);
    bioEl.textContent = 'Eya is your creative AI companion, helping you bridge gaps in your story and refine your cinematic voice.';
    imgEl.src = generateCollabAvatar('Eya');
  }

  popup.classList.add('active');

  const closePopup = () => {
    popup.classList.remove('active');
    popup.removeEventListener('click', onOverlayClick);
    closeBtn.removeEventListener('click', closePopup);
    document.removeEventListener('keydown', onEsc);
  };
  const onOverlayClick = (e) => { if (e.target === popup) closePopup(); };
  const onEsc = (e) => { if (e.key === 'Escape') closePopup(); };
  closeBtn.addEventListener('click', closePopup);
  popup.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onEsc);

  if (uid) {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
      if (snap.exists()) {
        const data = snap.data();
        const username = data.username || name || email || 'user';
        nameEl.textContent = formatCollaboratorHandle(username);
        if (data.bio) bioEl.textContent = data.bio;
        if (data.photoURL) {
          imgEl.src = data.photoURL;
          imgEl.onerror = () => { imgEl.src = generateCollabAvatar(displayName); imgEl.onerror = null; };
        }
      }
    } catch (err) {
      console.error('Failed to load collaborator profile', err);
    }
  }
}

function generateCollabAvatar(name) {
  const parts = (name || 'U').trim().split(/\s+/);
  const initials = (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || 'U').slice(0, 2)
  ).toUpperCase();
  const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6'];
  const color = palette[(name || '').charCodeAt(0) % palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="48" fill="${color}"/><text x="48" y="56" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="white">${initials}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function buildCollaboratorAvatarMarkup({ uid, name, email, photoURL, isOwner = false }) {
  const label = name || email || (isOwner ? 'Owner' : 'Collaborator');
  const attrs = `data-uid="${esc(uid || '')}" data-name="${esc(name || '')}" data-email="${esc(email || '')}" data-photourl="${esc(photoURL || '')}"`;
  if (photoURL) {
    return `<button class="collaborator-avatar collaborator-avatar-button collab-profile-trigger" type="button" aria-label="Open ${esc(label)} profile" ${attrs}><img src="${esc(photoURL)}" alt="${esc(label)}"></button>`;
  }
  return `<button class="collaborator-avatar collaborator-avatar-button collab-profile-trigger" type="button" aria-label="Open ${esc(label)} profile" ${attrs}>${esc(label)[0].toUpperCase()}</button>`;
}

function renderSentInvites(invitations) {
  const containers = ['studioSentInvites', 'studioSentInvitesList']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!containers.length) return;

  const sorted = [...invitations].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const html = !sorted.length
    ? '<p class="collab-empty">No invites sent.</p>'
    : sorted.map(inv => {
        const statusLabel = inv.status === 'accepted' ? 'Validated' : inv.status === 'declined' ? 'Declined' : 'Pending';
        const canRevoke = inv.status === 'pending';
        return `
          <div class="collab-request-item" data-invite-id="${esc(inv.id)}">
            <div class="collab-request-info">
              <span class="collab-request-from">${esc(inv.toEmail)}</span>
              <span class="collab-request-project">${esc(inv.projectTitle)}</span>
            </div>
            <div class="sent-invite-actions">
              <span class="status-pill ${inv.status}">${statusLabel}</span>
              ${canRevoke ? `<button class="revoke-invite-btn ghost-button" data-invite-id="${esc(inv.id)}" title="Revoke this invitation">Revoke</button>` : ''}
            </div>
          </div>
        `;
      }).join('');

  containers.forEach(list => {
    list.innerHTML = html;
    list.querySelectorAll('.revoke-invite-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await revokeInvitation(btn.dataset.inviteId);
      });
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
        <span class="comment-time">${relativeTime(c.createdAt)}</span>
        ${c.resolved ? `<span class="comment-resolved-label">Resolved by ${esc(c.resolvedBy || '')}</span>` : ''}
      </div>
      <p class="comment-text">${displayWithMentions(c.text)}</p>
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
  const lineId = composePendingLineId || state.activeBlockId;
  if (!lineId) {
    hideCommentCompose();
    await customAlert('Click on a line first — comments must be attached to a specific line.', 'No line selected');
    return;
  }
  hideCommentCompose();
  try {
    await addComment(project.id, text, { lineId });
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
  _updateUnresolvedBadge(allComments);
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
    const line = c.lineId ? project.lines.find(l => l.id === c.lineId) : null;
    const scene = c.lineId ? getSceneForLine(c.lineId, project) : null;
    const sceneNum = scene ? getSceneNumber(scene.id, project) : 0;
    const sceneText = scene
      ? `Scene ${sceneNum}: ${(scene.text || '').trim() || '(untitled)'}`
      : (line ? 'Before first scene' : 'Line removed');
    const lineRaw = (line?.text || '').trim();
    const lineDisplay = line
      ? (lineRaw ? (lineRaw.length > 60 ? lineRaw.slice(0, 60) + '…' : lineRaw) : '(empty line)')
      : '(this line was deleted)';
    const lineType = line?.type ? line.type.toUpperCase() : '';
    const threadReplies = repliesByParent[c.id] || [];
    const isOwner = !project.ownerId || project.ownerId === user?.uid;
    const isAuthor = c.uid === user?.uid;
    const canNavigate = !!line;

    const item = document.createElement('div');
    item.className = 'cld-item' + (c.resolved ? ' is-resolved' : '');
    item.dataset.commentId = c.id;
    item.innerHTML = `
      <div class="cld-location">
        <span class="cld-scene">${esc(sceneText)}</span>
        ${canNavigate
          ? `<button class="cld-line-btn" data-line-id="${esc(c.lineId)}" title="Go to this line">
               ${lineType ? `<span class="cld-line-type">${esc(lineType)}</span>` : ''}
               <span class="cld-line-arrow">↳</span>
               <span class="cld-line-text">${esc(lineDisplay)}</span>
             </button>`
          : `<span class="cld-no-line">${esc(lineDisplay)}</span>`}
      </div>
      <div class="cld-meta">
        <span class="cld-author">${esc(c.userName)}</span>
        <span class="cld-time">${fmtTime(c.createdAt)}</span>
        ${c.resolved ? `<span class="comment-resolved-pill">Resolved by ${esc(c.resolvedBy || '')}</span>` : ''}
      </div>
      <p class="cld-text">${displayWithMentions(c.text)}</p>
      ${threadReplies.length ? `<div class="cld-replies">${threadReplies.map(r => `
        <div class="cld-reply"><span class="cld-reply-author">${esc(r.userName)}</span> <span class="cld-reply-time">${relativeTime(r.createdAt)}</span>
        <p class="cld-reply-text">${displayWithMentions(r.text)}</p></div>`).join('')}
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
  dialog.querySelector('#cdTime').textContent = relativeTime(comment.createdAt);
  dialog.querySelector('#cdText').innerHTML = displayWithMentions(comment.text);

  const resolvedPill = dialog.querySelector('#cdResolvedPill');
  resolvedPill.hidden = !comment.resolved;
  resolvedPill.textContent = comment.resolved ? `Resolved by ${comment.resolvedBy || ''}` : '';

  const repliesEl = dialog.querySelector('#cdReplies');
  repliesEl.innerHTML = replies.length ? replies.map(r => `
    <div class="cd-reply">
      <span class="cd-reply-author">${esc(r.userName)}</span>
      <span class="cd-reply-time">${relativeTime(r.createdAt)}</span>
      <p class="cd-reply-text">${displayWithMentions(r.text)}</p>
    </div>
  `).join('') : '';

  const replyCompose = dialog.querySelector('#cdReplyCompose');
  if (replyCompose) { replyCompose.hidden = true; }
  const replyText = dialog.querySelector('#cdReplyText');
  if (replyText) replyText.value = '';

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

  // Reply toggle
  dialog.querySelector('#cdReplyBtn')?.addEventListener('click', () => {
    const compose = dialog.querySelector('#cdReplyCompose');
    if (!compose) return;
    compose.hidden = !compose.hidden;
    if (!compose.hidden) dialog.querySelector('#cdReplyText')?.focus();
  });

  // Send reply
  const sendReply = async () => {
    const project = getCurrentProject();
    if (!project) return;
    const text = dialog.querySelector('#cdReplyText')?.value?.trim();
    if (!text) return;
    const commentId = dialog.querySelector('#cdResolveBtn')?.dataset.commentId;
    const parent = allComments.find(c => c.id === commentId);
    await addComment(project.id, text, { lineId: parent?.lineId || null, parentId: commentId });
    dialog.querySelector('#cdReplyText').value = '';
    dialog.querySelector('#cdReplyCompose').hidden = true;
    if (commentId) showCommentDetail(commentId);
  };
  dialog.querySelector('#cdReplySend')?.addEventListener('click', sendReply);
  dialog.querySelector('#cdReplyText')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
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

const ACTIVITY_ICONS = {
  comment: '💬',
  invite: '✉️',
  member: '👤',
  role: '🔑',
  workspace: '🏷️',
  governance: '🏛️',
  system: '⚙️'
};

function renderActivityLog(project) {
  const container = document.getElementById('studioActivityLog');
  if (!container) return;
  const log = project.activityLog || [];
  if (!log.length) {
    container.innerHTML = '<p class="collab-empty">No activity recorded yet.</p>';
    return;
  }
  container.innerHTML = [...log].reverse().slice(0, 20).map(e => {
    const icon = ACTIVITY_ICONS[e.category] || ACTIVITY_ICONS.system;
    return `
      <div class="activity-log-item">
        <span class="activity-log-icon" aria-hidden="true">${icon}</span>
        <div class="activity-log-body">
          <div class="activity-log-meta">
            <span class="activity-log-user">${esc(e.user)}</span>
            <span class="activity-log-time">${relativeTime(e.timestamp)}</span>
          </div>
          <div class="activity-log-copy">${esc(e.message)}</div>
        </div>
      </div>
    `;
  }).join('');
}

export function renderWorkspaceAwareness(project) {
  const el = document.getElementById('workspaceAwareness');
  if (!el) return;
  if (!project?.isShared) { el.hidden = true; return; }

  const lastEditor = project.lastEditorName;
  const lastAt = project.lastActivityAt;
  const openCount = allComments.filter(c => !c.resolved && !c.parentId).length;

  // Collect up to 3 distinct recent editors from the activity log.
  const recentEditors = [];
  const seenNames = new Set();
  const log = project.activityLog || [];
  for (let i = log.length - 1; i >= 0 && recentEditors.length < 3; i--) {
    const { user, timestamp } = log[i];
    if (user && !seenNames.has(user)) {
      recentEditors.push({ name: user, timestamp });
      seenNames.add(user);
    }
  }

  el.hidden = false;
  el.innerHTML = [
    _activePresence.length
      ? `<div class="awareness-row awareness-online">
           <span class="awareness-pulse" aria-hidden="true"></span>
           <span>${_activePresence.map(p => esc(p.name.split(' ')[0])).join(', ')} ${_activePresence.length === 1 ? 'is' : 'are'} here now</span>
         </div>`
      : '',
    lastEditor && lastAt
      ? `<div class="awareness-row">
           <span class="awareness-icon" aria-hidden="true">✏️</span>
           <span>${esc(lastEditor)} <span class="awareness-time">${relativeTime(lastAt)}</span></span>
         </div>`
      : '',
    recentEditors.length > 1
      ? `<div class="awareness-row">
           <span class="awareness-icon" aria-hidden="true">👥</span>
           <span class="awareness-recent">${
             recentEditors.map(e =>
               `<span class="awareness-collaborator" title="${esc(relativeTime(e.timestamp))}">${esc(e.name.split(' ')[0])}</span>`
             ).join(' · ')
           }</span>
         </div>`
      : '',
    `<div class="awareness-row">
       <span class="awareness-icon" aria-hidden="true">💬</span>
       <span>${openCount} open comment${openCount !== 1 ? 's' : ''}</span>
     </div>`
  ].filter(Boolean).join('');

  // Mini activity feed (last 4 entries)
  _renderMiniActivityFeed(log);
}

function _renderMiniActivityFeed(log) {
  const feed = document.getElementById('miniActivityFeed');
  if (!feed) return;
  const entries = [...(log || [])].reverse().slice(0, 4);
  if (!entries.length) { feed.hidden = true; return; }
  const ICONS = { comment: '💬', invite: '✉️', member: '👤', role: '🔑', workspace: '🏷️', edit: '✏️', create: '🎬', restore: '↩️', system: '⚙️' };
  feed.hidden = false;
  feed.innerHTML = `<div class="mini-feed-label">Recent Activity</div>` +
    entries.map(e => `
      <div class="mini-feed-item">
        <span class="mini-feed-icon">${ICONS[e.category] || '⚙️'}</span>
        <div class="mini-feed-body">
          <span class="mini-feed-user">${esc(e.user)}</span>
          <span class="mini-feed-msg">${esc(e.message)}</span>
          <span class="mini-feed-time">${relativeTime(e.timestamp)}</span>
        </div>
      </div>`
    ).join('');
}

function _updateUnresolvedBadge(comments) {
  const count = (comments || allComments).filter(c => !c.parentId && !c.resolved).length;
  const badge = document.getElementById('studioCollabBadge');
  if (!badge) return;
  badge.textContent = count || '';
  badge.hidden = !count;
}

function _getMentionCandidates(project, query) {
  if (!project) return [];
  const q = (query || '').toLowerCase();
  const results = [];
  const seen = new Set();
  const add = (name, email) => {
    const display = name || email || '';
    const handle = display.split('@')[0].replace(/\s+/g, '');
    if (!handle || seen.has(handle)) return;
    if (!q || handle.toLowerCase().includes(q) || display.toLowerCase().includes(q)) {
      results.push({ handle, display });
      seen.add(handle);
    }
  };
  add(project.ownerName, project.ownerEmail);
  Object.values(project.collaborators || {}).forEach(c => add(c.name, c.email));
  return results.slice(0, 5);
}

function _initMentionAutocomplete() {
  const textarea = document.getElementById('commentComposeText');
  const dropdown = document.getElementById('mentionDropdown');
  if (!textarea || !dropdown || textarea.dataset.mentionBound) return;
  textarea.dataset.mentionBound = '1';

  textarea.addEventListener('input', () => {
    const text = textarea.value;
    const pos = textarea.selectionStart;
    const before = text.slice(0, pos);
    const m = before.match(/@([\w.]*)$/);
    if (!m) { dropdown.hidden = true; return; }
    const project = getCurrentProject();
    const candidates = _getMentionCandidates(project, m[1]);
    if (!candidates.length) { dropdown.hidden = true; return; }
    dropdown.innerHTML = candidates.map(c =>
      `<button class="mention-option" type="button" data-handle="${esc(c.handle)}" data-query-len="${m[0].length}">
         <span class="mention-name">${esc(c.display)}</span>
         <span class="mention-handle">@${esc(c.handle)}</span>
       </button>`
    ).join('');
    dropdown.hidden = false;
    dropdown.querySelectorAll('.mention-option').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const qLen = parseInt(btn.dataset.queryLen, 10);
        const pos2 = textarea.selectionStart;
        const newText = textarea.value.slice(0, pos2 - qLen) + `@${btn.dataset.handle} ` + textarea.value.slice(pos2);
        textarea.value = newText;
        textarea.focus();
        dropdown.hidden = true;
      });
    });
  });

  textarea.addEventListener('blur', () => setTimeout(() => { dropdown.hidden = true; }, 150));
  textarea.addEventListener('keydown', e => {
    if (dropdown.hidden) return;
    if (e.key === 'Escape') { dropdown.hidden = true; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dropdown.querySelector('.mention-option')?.focus();
    }
  });
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escape text then wrap @handle patterns in a styled span (safe — regex only matches word chars).
function displayWithMentions(text) {
  return esc(text).replace(/@([\w][\w.-]*)/g, '<span class="mention-tag">@$1</span>');
}

// Extract collaborator mentions from comment text, matched against project membership.
function parseMentions(text, project) {
  const mentions = [];
  const seen = new Set();
  const pattern = /@([\w][\w.-]*)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1].toLowerCase();
    const ownerName = (project.ownerName || project.ownerEmail || '').split('@')[0].replace(/\s+/g, '').toLowerCase();
    if (ownerName && ownerName.includes(handle) && !seen.has(project.ownerId)) {
      mentions.push({ uid: project.ownerId || null, name: project.ownerName || project.ownerEmail || 'Owner' });
      if (project.ownerId) seen.add(project.ownerId);
    }
    Object.entries(project.collaborators || {}).forEach(([uid, c]) => {
      if (seen.has(uid)) return;
      const name = (c.name || c.email || '').split('@')[0].replace(/\s+/g, '').toLowerCase();
      if (name && name.includes(handle)) {
        mentions.push({ uid, name: c.name || c.email || uid });
        seen.add(uid);
      }
    });
  }
  return mentions;
}

function relativeTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return fmtTime(iso);
  } catch { return ''; }
}
