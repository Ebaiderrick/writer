import { auth, db } from './firebase.js';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';
import { logActivity } from './activity.js';
import { getCurrentProject, sanitizeProject, upsertProject, persistProjects, deleteProjectFromCloud } from './project.js';
import { uid as makeId } from './utils.js';
import { customAlert, customConfirm, showHome, renderHome, renderWorkspaceView } from './ui.js';

// Comment filter state
let commentFilter = { user: 'all', sort: 'line', status: 'all' };
let allComments = [];

const MAX_COLLABORATORS = 5;
const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PROFILE_INVITE_HISTORY = 6;
const PRESENCE_STALE_MS = 20 * 1000;
export const WORKSPACE_ROLES = {
  owner: 'owner',
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer'
};
export const WORKSPACE_MEMBER_STATUSES = {
  pending: 'pending',
  active: 'active',
  removed: 'removed',
  suspended: 'suspended'
};
export const INVITATION_STATUSES = {
  pending: 'pending',
  accepted: 'accepted',
  expired: 'expired',
  revoked: 'revoked'
};
const ADMIN_ASSIGNABLE_ROLES = new Set([
  WORKSPACE_ROLES.editor,
  WORKSPACE_ROLES.viewer
]);
const OWNER_ASSIGNABLE_ROLES = new Set([
  WORKSPACE_ROLES.admin,
  WORKSPACE_ROLES.editor,
  WORKSPACE_ROLES.viewer
]);
export const AI_ASSIST_UID = 'ai_assist';
const AI_ASSIST_PROFILE = {
  uid: AI_ASSIST_UID,
  name: 'Eya',
  username: '@AIassist',
  email: '',
  photoURL: '',
  role: WORKSPACE_ROLES.editor,
  type: 'system',
  bio: 'Eya is Wraita\'s quiet AI studio partner, here to help refine scenes, unblock drafts, and keep the writing moving.'
};
const EMAILJS_SERVICE = 'service_j18y8zo';
const EMAILJS_TEMPLATE = 'template_6qr97mn';
const EMAILJS_PUBLIC_KEY = 'VI5qc4g4cH9d0vpvr';

let unsubInvites = null;
let unsubSentInvites = null;
let unsubComments = null;
let unsubSharedProject = null;
let unsubPresence = null;
let sharedProjectWatchers = new Map();
let presenceHeartbeatTimer = 0;
let typingPresenceTimer = 0;
let activePresenceProjectId = '';
const realtimePresenceByProject = new Map();

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

function presenceDocRef(projectId, userId = auth.currentUser?.uid) {
  if (!projectId || !userId) return null;
  return doc(db, 'sharedProjects', projectId, 'presence', userId);
}

function presenceCollectionRef(projectId) {
  return collection(db, 'sharedProjects', projectId, 'presence');
}

function versionsCollectionRef(projectId) {
  return collection(db, 'sharedProjects', projectId, 'versions');
}

function getWorkspaceId(project) {
  return project?.workspace?.id || project?.id || '';
}

function workspaceMemberDocId(workspaceId, userId) {
  return `${workspaceId}__${userId}`;
}

function workspaceMemberRef(workspaceId, userId) {
  return doc(db, 'workspace_members', workspaceMemberDocId(workspaceId, userId));
}

function buildWorkspaceMemberRecord({
  userId,
  workspaceId,
  role,
  invitedBy = '',
  joinedAt = '',
  status = WORKSPACE_MEMBER_STATUSES.active,
  name = '',
  email = '',
  photoURL = ''
}) {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    role: normalizeWorkspaceRole(role),
    invited_by: invitedBy || '',
    joined_at: joinedAt || '',
    status,
    name: name || '',
    email: email || '',
    photoURL: photoURL || '',
    updated_at: new Date().toISOString()
  };
}

async function upsertWorkspaceMemberRecord(record) {
  if (!record?.workspace_id || !record?.user_id) return;
  await setDoc(
    workspaceMemberRef(record.workspace_id, record.user_id),
    buildWorkspaceMemberRecord(record),
    { merge: true }
  );
}

async function appendInviteHistoryEntry(userId, entry) {
  if (!userId || !entry) return;
  const profileRef = doc(db, 'users', userId, 'profile', 'data');
  const profileSnap = await getDoc(profileRef);
  const existing = profileSnap.exists() && Array.isArray(profileSnap.data().recentInvitations)
    ? profileSnap.data().recentInvitations
    : [];
  const next = [
    {
      email: entry.email || '',
      workspaceId: entry.workspaceId || '',
      projectTitle: entry.projectTitle || '',
      role: normalizeWorkspaceRole(entry.role),
      status: entry.status || INVITATION_STATUSES.pending,
      timestamp: entry.timestamp || new Date().toISOString()
    },
    ...existing
  ].slice(0, MAX_PROFILE_INVITE_HISTORY);
  await setDoc(profileRef, { recentInvitations: next }, { merge: true });
}

function getInviteExpiryTimestamp(createdAt = new Date().toISOString()) {
  return new Date(new Date(createdAt).getTime() + INVITE_EXPIRATION_MS).toISOString();
}

function isInvitationExpired(invite) {
  if (!invite) return false;
  if (invite.status !== INVITATION_STATUSES.pending) return false;
  const expiresAt = invite.expiresAt || getInviteExpiryTimestamp(invite.createdAt);
  return new Date(expiresAt).getTime() <= Date.now();
}

async function expireInvitationIfNeeded(invite) {
  if (!invite?.id || !isInvitationExpired(invite)) return invite;
  const expiredAt = new Date().toISOString();
  await updateDoc(doc(db, 'invitations', invite.id), {
    status: INVITATION_STATUSES.expired,
    expiredAt,
    updatedAt: expiredAt
  });
  return {
    ...invite,
    status: INVITATION_STATUSES.expired,
    expiredAt,
    updatedAt: expiredAt
  };
}

function getInvitationStatusLabel(invite) {
  if (invite.status === INVITATION_STATUSES.accepted) return 'Accepted';
  if (invite.status === INVITATION_STATUSES.expired) return 'Expired';
  if (invite.status === INVITATION_STATUSES.revoked) {
    return invite.revokedReason === 'declined' ? 'Declined' : 'Canceled';
  }
  return 'Pending';
}

function isPresenceFresh(presence) {
  if (!presence?.lastSeenAt) return false;
  return (Date.now() - new Date(presence.lastSeenAt).getTime()) <= PRESENCE_STALE_MS;
}

function clearPresenceHeartbeat() {
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = 0;
  }
}

export function getRealtimePresence(projectId = getCurrentProject()?.id) {
  return realtimePresenceByProject.get(projectId) || {};
}

function getRealtimeLineLabel(project, lineId) {
  if (!project || !lineId) return '';
  const line = project.lines?.find((entry) => entry.id === lineId);
  if (!line?.text?.trim()) return '';
  const trimmed = line.text.trim();
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

async function persistRealtimePresence(projectId, patch = {}) {
  const user = auth.currentUser;
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!user || !project?.isShared) return;
  const ref = presenceDocRef(projectId, user.uid);
  if (!ref) return;
  activePresenceProjectId = projectId;
  await setDoc(ref, {
    uid: user.uid,
    name: user.displayName || user.email || 'Workspace member',
    email: user.email || '',
    photoURL: user.photoURL || '',
    role: getUserProjectRole(project, user),
    lineId: patch.lineId || '',
    lineLabel: patch.lineId ? getRealtimeLineLabel(project, patch.lineId) : (patch.lineLabel || ''),
    isTyping: Boolean(patch.isTyping),
    status: patch.status || (patch.isTyping ? 'typing' : 'viewing'),
    lastSeenAt: new Date().toISOString()
  }, { merge: true });
}

export function noteRealtimeActivity(lineId = '', { isTyping = false } = {}) {
  const project = getCurrentProject();
  if (!project?.isShared) return;
  persistRealtimePresence(project.id, { lineId, isTyping }).catch(() => {});
  clearPresenceHeartbeat();
  presenceHeartbeatTimer = window.setInterval(() => {
    persistRealtimePresence(project.id, {
      lineId: lineId || state.activeBlockId || '',
      isTyping: false,
      status: 'viewing'
    }).catch(() => {});
  }, Math.max(5000, Math.floor(PRESENCE_STALE_MS / 2)));
  if (typingPresenceTimer) clearTimeout(typingPresenceTimer);
  if (isTyping) {
    typingPresenceTimer = window.setTimeout(() => {
      persistRealtimePresence(project.id, {
        lineId: lineId || state.activeBlockId || '',
        isTyping: false,
        status: 'viewing'
      }).catch(() => {});
    }, 1600);
  }
}

async function clearRealtimePresence(projectId = activePresenceProjectId) {
  if (typingPresenceTimer) {
    clearTimeout(typingPresenceTimer);
    typingPresenceTimer = 0;
  }
  clearPresenceHeartbeat();
  const ref = presenceDocRef(projectId);
  activePresenceProjectId = '';
  if (!ref) return;
  try {
    await deleteDoc(ref);
  } catch (error) {
    console.warn('Unable to clear presence state', error);
  }
}

function subscribeToPresence(projectId) {
  if (unsubPresence) {
    unsubPresence();
    unsubPresence = null;
  }
  if (!projectId) return;
  unsubPresence = onSnapshot(presenceCollectionRef(projectId), (snapshot) => {
    const entries = {};
    snapshot.docs.forEach((docSnap) => {
      const value = docSnap.data();
      if (!isPresenceFresh(value)) return;
      entries[docSnap.id] = value;
    });
    realtimePresenceByProject.set(projectId, entries);
    if (state.currentProjectId === projectId) {
      renderCollaboratorList();
    }
  }, (error) => console.error('[presence]', error));
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
    invitations.forEach(invite => { expireInvitationIfNeeded(invite).catch(() => {}); });
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
    invitations.forEach(invite => { expireInvitationIfNeeded(invite).catch(() => {}); });
    renderSentInvites(invitations);
  });

  syncSharedProjectWatchers();
}

export function cleanupCollaboration() {
  [unsubInvites, unsubSentInvites, unsubComments, unsubSharedProject, unsubPresence].forEach(fn => fn?.());
  unsubInvites = unsubSentInvites = unsubComments = unsubSharedProject = unsubPresence = null;
  sharedProjectWatchers.forEach(fn => fn?.());
  sharedProjectWatchers.clear();
  realtimePresenceByProject.clear();
  clearRealtimePresence().catch(() => {});
}

export function onStudioEnter(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  renderCollaboratorList();
  if (project.isShared) {
    subscribeToSharedProject(projectId);
    subscribeToPresence(projectId);
    noteRealtimeActivity(state.activeBlockId || '', { isTyping: false });
  } else {
    if (unsubSharedProject) { unsubSharedProject(); unsubSharedProject = null; }
    if (unsubPresence) { unsubPresence(); unsubPresence = null; }
    realtimePresenceByProject.delete(projectId);
    clearRealtimePresence().catch(() => {});
  }
  syncSharedProjectWatchers();
  subscribeToComments(project);
}

export function getUserProjectRole(project = getCurrentProject(), user = auth.currentUser) {
  if (!project || !user) {
    return WORKSPACE_ROLES.owner;
  }

  if (!project.ownerId || project.ownerId === user.uid) {
    return WORKSPACE_ROLES.owner;
  }

  return normalizeWorkspaceRole(project.collaborators?.[user.uid]?.role);
}

export function normalizeWorkspaceRole(role, fallback = WORKSPACE_ROLES.editor) {
  if (role === WORKSPACE_ROLES.owner) return WORKSPACE_ROLES.owner;
  if (role === WORKSPACE_ROLES.admin) return WORKSPACE_ROLES.admin;
  if (role === WORKSPACE_ROLES.viewer) return WORKSPACE_ROLES.viewer;
  return fallback;
}

export function getWorkspacePermissions(project = getCurrentProject(), user = auth.currentUser) {
  const role = getUserProjectRole(project, user);
  const isOwner = role === WORKSPACE_ROLES.owner;
  const isAdmin = role === WORKSPACE_ROLES.admin;
  const isEditor = role === WORKSPACE_ROLES.editor;
  const isViewer = role === WORKSPACE_ROLES.viewer;
  const viewerCommentsEnabled = Boolean(project?.workspace?.commentingEnabled);

  return {
    role,
    isOwner,
    isAdmin,
    isEditor,
    isViewer,
    canEditContent: !isViewer,
    canComment: !isViewer || viewerCommentsEnabled,
    canCreateDrafts: isOwner || isAdmin || isEditor,
    canInviteUsers: isOwner || isAdmin,
    canRemoveCollaborators: isOwner || isAdmin,
    canManageProjects: isOwner || isAdmin,
    canEditWorkspaceSettings: isOwner || isAdmin,
    canTransferOwnership: isOwner,
    canDeleteWorkspace: isOwner,
    canManageBilling: isOwner,
    canChangeVisibility: isOwner
  };
}

export function getAssignableWorkspaceRoles(project = getCurrentProject(), user = auth.currentUser, collaboratorUid = null) {
  const permissions = getWorkspacePermissions(project, user);
  if (permissions.isOwner) {
    return [WORKSPACE_ROLES.admin, WORKSPACE_ROLES.editor, WORKSPACE_ROLES.viewer];
  }
  if (!permissions.isAdmin) {
    return [];
  }

  const targetRole = collaboratorUid
    ? normalizeWorkspaceRole(project?.collaborators?.[collaboratorUid]?.role)
    : null;

  return targetRole === WORKSPACE_ROLES.admin
    ? []
    : [WORKSPACE_ROLES.editor, WORKSPACE_ROLES.viewer];
}

export function canUpdateCollaboratorRole(project = getCurrentProject(), user = auth.currentUser, collaboratorUid, role) {
  const collaborator = project?.collaborators?.[collaboratorUid];
  if (!collaborator) return false;

  const permissions = getWorkspacePermissions(project, user);
  const nextRole = normalizeWorkspaceRole(role);
  const targetRole = normalizeWorkspaceRole(collaborator.role);

  if (permissions.isOwner) {
    return OWNER_ASSIGNABLE_ROLES.has(nextRole);
  }

  if (!permissions.isAdmin) {
    return false;
  }

  return targetRole !== WORKSPACE_ROLES.admin && ADMIN_ASSIGNABLE_ROLES.has(nextRole);
}

export function canRemoveCollaborator(project = getCurrentProject(), user = auth.currentUser, collaboratorUid) {
  const collaborator = project?.collaborators?.[collaboratorUid];
  if (!collaborator) return false;

  const permissions = getWorkspacePermissions(project, user);
  if (permissions.isOwner) {
    return true;
  }
  if (!permissions.isAdmin) {
    return false;
  }

  return normalizeWorkspaceRole(collaborator.role) !== WORKSPACE_ROLES.admin;
}

export function canInviteToWorkspace(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canInviteUsers;
}

export function canManageWorkspaceProjects(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canManageProjects;
}

export function canEditWorkspaceSettings(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canEditWorkspaceSettings;
}

export function canCommentOnProject(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canComment;
}

export function canDeleteWorkspace(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canDeleteWorkspace;
}

export function canEditProject(project = getCurrentProject(), user = auth.currentUser) {
  return getWorkspacePermissions(project, user).canEditContent;
}

export function canManageWorkspace(project = getCurrentProject(), user = auth.currentUser) {
  return getUserProjectRole(project, user) === WORKSPACE_ROLES.owner;
}

function updateCollabBadge(count) {
  document.querySelectorAll('.collab-badge').forEach(b => {
    b.textContent = count || '';
    b.hidden = !count;
  });
}

// ── Invite ────────────────────────────────────────────────────

export async function inviteCollaborator(email, role = WORKSPACE_ROLES.editor) {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, reason: 'Not signed in.' };

    const project = getCurrentProject();
    if (!project) return { ok: false, reason: 'No project open. Open a project first.' };
    if (!canInviteToWorkspace(project, user)) {
      return { ok: false, reason: 'Only workspace owners and admins can invite teammates.' };
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
    const requestedRole = normalizeWorkspaceRole(role);
    const allowedRoles = getAssignableWorkspaceRoles(project, user);
    const inviteRole = allowedRoles.includes(requestedRole)
      ? requestedRole
      : WORKSPACE_ROLES.editor;

    const inviteData = {
      id: inviteId,
      fromUid: user.uid,
      fromName: user.displayName || user.email,
      fromEmail: user.email,
      invitedBy: user.uid,
      workspaceId: getWorkspaceId(project),
      toEmail: normalizedEmail,
      toUid: userSnap.data().uid || '',
      toName: userSnap.data().name || normalizedEmail,
      role: inviteRole,
      projectId: project.id,
      projectTitle: project.title,
      status: INVITATION_STATUSES.pending,
      createdAt: new Date().toISOString(),
      lastSentAt: new Date().toISOString(),
      expiresAt: getInviteExpiryTimestamp()
    };

    await setDoc(doc(db, 'invitations', inviteId), inviteData);
    await upsertWorkspaceMemberRecord({
      userId: inviteData.toUid,
      workspaceId: inviteData.workspaceId,
      role: inviteRole,
      invitedBy: user.uid,
      joinedAt: '',
      status: WORKSPACE_MEMBER_STATUSES.pending,
      name: inviteData.toName,
      email: normalizedEmail
    });
    await appendInviteHistoryEntry(user.uid, {
      email: normalizedEmail,
      workspaceId: inviteData.workspaceId,
      projectTitle: inviteData.projectTitle,
      role: inviteRole,
      status: INVITATION_STATUSES.pending,
      timestamp: inviteData.createdAt
    });
    await logActivity(project.id, `Invited ${normalizedEmail} as ${inviteData.role}.`, {
      action: 'invite.sent',
      target: normalizedEmail,
      workspaceId: getWorkspaceId(project)
    });

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

    return { ok: true };
  } catch (err) {
    console.error('inviteCollaborator error:', err);
    return { ok: false, reason: err.message || 'An error occurred. Please try again.' };
  }
}

async function ensureSharedProject(project, user) {
  // Skip Firestore read when local state already marks the project as shared.
  if (project.isShared) return;

  const ref = doc(db, 'sharedProjects', project.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ...project,
      ownerId: user.uid,
      ownerName: user.displayName || user.email,
      ownerEmail: user.email,
      ownerPhotoURL: user.photoURL || '',
      workspace: project.workspace || {
        id: project.id,
        name: project.title || 'Team Assembly',
        inviteCode: project.scriptId || '',
        reminders: [],
        commentingEnabled: false
      },
      collaborators: {},
      isShared: true,
      updatedBy: user.uid,
      syncedAt: new Date().toISOString()
    });
  }
  project.isShared = true;
  project.ownerId = user.uid;
  project.ownerName = user.displayName || user.email;
  project.ownerEmail = user.email;
  project.ownerPhotoURL = user.photoURL || "";
  project.collaborators = project.collaborators || {};
  await upsertWorkspaceMemberRecord({
    userId: user.uid,
    workspaceId: getWorkspaceId(project),
    role: WORKSPACE_ROLES.owner,
    invitedBy: user.uid,
    joinedAt: project.createdAt || new Date().toISOString(),
    status: WORKSPACE_MEMBER_STATUSES.active,
    name: user.displayName || user.email,
    email: user.email,
    photoURL: user.photoURL || ''
  });
  persistProjects(false);
  syncSharedProjectWatchers();
}

// ── Accept / Decline ──────────────────────────────────────────

export async function acceptInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return;

  const invSnap = await getDoc(doc(db, 'invitations', inviteId));
  if (!invSnap.exists()) return;
  const inv = invSnap.data();
  if (isInvitationExpired(inv)) {
    await expireInvitationIfNeeded({ id: inviteId, ...inv });
    await customAlert('This invitation has expired. Ask the workspace owner or admin to resend it.', 'Invitation Expired');
    return;
  }
  if (inv.status !== INVITATION_STATUSES.pending) {
    await customAlert('This invitation is no longer active.', 'Invitation');
    return;
  }

  const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
  const profileData = profileSnap.exists() ? profileSnap.data() : {};

  const sharedRef = doc(db, 'sharedProjects', inv.projectId);

  // Step 1: Add self to collaborators using dot-notation.
  // Set updatedBy to the collaborator's uid so the owner's onSnapshot listener
  // does NOT skip this update (it skips when updatedBy === own uid).
  await updateDoc(sharedRef, {
    [`collaborators.${user.uid}`]: {
      name: user.displayName || user.email,
      email: user.email,
      photoURL: profileData.photoURL || user.photoURL || '',
      addedAt: new Date().toISOString(),
      role: normalizeWorkspaceRole(inv.role)
    },
    updatedBy: user.uid
  });

  // Step 2: Mark invitation accepted (recipient can always update their own invite).
  const acceptedAt = new Date().toISOString();
  await updateDoc(doc(db, 'invitations', inviteId), {
    status: INVITATION_STATUSES.accepted,
    respondedAt: acceptedAt,
    updatedAt: acceptedAt
  });
  await upsertWorkspaceMemberRecord({
    userId: user.uid,
    workspaceId: inv.workspaceId || inv.projectId,
    role: normalizeWorkspaceRole(inv.role),
    invitedBy: inv.invitedBy || inv.fromUid,
    joinedAt: acceptedAt,
    status: WORKSPACE_MEMBER_STATUSES.active,
    name: user.displayName || user.email,
    email: user.email,
    photoURL: profileData.photoURL || user.photoURL || ''
  });

  await logActivity(inv.projectId, `Joined project as ${normalizeWorkspaceRole(inv.role).replace(/^./, (char) => char.toUpperCase())}.`, {
    action: 'invite.accepted',
    workspaceId: inv.workspaceId || inv.projectId
  });

  // Step 3: Now read the shared project — user is a collaborator so read is allowed.
  const projSnap = await getDoc(sharedRef);
  if (!projSnap.exists()) return;
  const sharedProject = projSnap.data();

  // Step 4: Copy project into the recipient's personal projects.
  const projectForUser = sanitizeProject(sharedProject);
  await setDoc(doc(db, 'users', user.uid, 'projects', inv.projectId), {
    ...projectForUser,
    syncedAt: new Date().toISOString()
  });

  upsertProject(projectForUser);
  persistProjects(false);
  renderHome();
  syncSharedProjectWatchers();
  subscribeToSharedProject(inv.projectId);
}

export async function declineInvitation(inviteId) {
  const inviteRef = doc(db, 'invitations', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return;
  const invite = inviteSnap.data();
  const revokedAt = new Date().toISOString();
  await updateDoc(inviteRef, {
    status: INVITATION_STATUSES.revoked,
    revokedReason: 'declined',
    revokedAt,
    respondedAt: revokedAt,
    updatedAt: revokedAt
  });
  if (invite.toUid) {
    await upsertWorkspaceMemberRecord({
      userId: invite.toUid,
      workspaceId: invite.workspaceId || invite.projectId,
      role: normalizeWorkspaceRole(invite.role),
      invitedBy: invite.invitedBy || invite.fromUid,
      joinedAt: '',
      status: WORKSPACE_MEMBER_STATUSES.removed,
      name: invite.toName || invite.toEmail || '',
      email: invite.toEmail || ''
    });
  }
}

// ── Kick ──────────────────────────────────────────────────────

export async function kickCollaborator(projectId, collaboratorUid) {
  const user = auth.currentUser;
  if (!user) return;

  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!project) return;

  if (!canRemoveCollaborator(project, user, collaboratorUid)) {
    await customAlert('Only owners can remove admins, and admins can only remove editors or viewers.', 'Not Authorized');
    return;
  }

  const newCollaborators = { ...(project.collaborators || {}) };
  const removedCollaborator = newCollaborators[collaboratorUid];
  delete newCollaborators[collaboratorUid];

  // updatedBy set to owner so the kicked user's listener fires and shows the change.
  await updateDoc(doc(db, 'sharedProjects', projectId), {
    collaborators: newCollaborators,
    updatedBy: user.uid,
    lastEditorName: user.displayName || user.email
  });

  project.collaborators = newCollaborators;
  await upsertWorkspaceMemberRecord({
    userId: collaboratorUid,
    workspaceId: getWorkspaceId(project),
    role: normalizeWorkspaceRole(removedCollaborator?.role),
    invitedBy: user.uid,
    joinedAt: removedCollaborator?.addedAt || '',
    status: WORKSPACE_MEMBER_STATUSES.removed,
    name: removedCollaborator?.name || removedCollaborator?.email || '',
    email: removedCollaborator?.email || '',
    photoURL: removedCollaborator?.photoURL || ''
  });
  await logActivity(projectId, 'Removed a collaborator from the workspace.', {
    action: 'member.removed',
    workspaceId: getWorkspaceId(project)
  });
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
  const collaborator = project.collaborators?.[collaboratorUid];
  if (!collaborator) {
    return { ok: false, reason: 'Collaborator not found.' };
  }

  if (!canUpdateCollaboratorRole(project, user, collaboratorUid, role)) {
    return { ok: false, reason: 'Only owners can assign admins. Admins can change editors and viewers only.' };
  }

  const nextRole = normalizeWorkspaceRole(role);
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
  await upsertWorkspaceMemberRecord({
    userId: collaboratorUid,
    workspaceId: getWorkspaceId(project),
    role: nextRole,
    invitedBy: user.uid,
    joinedAt: collaborator.addedAt || '',
    status: WORKSPACE_MEMBER_STATUSES.active,
    name: collaborator.name || collaborator.email || '',
    email: collaborator.email || '',
    photoURL: collaborator.photoURL || ''
  });
  await logActivity(projectId, `Changed ${collaborator.name || collaborator.email} to ${nextRole}.`, {
    action: 'role.changed',
    target: collaborator.name || collaborator.email || collaboratorUid,
    workspaceId: getWorkspaceId(project)
  });
  persistProjects(false);
  renderCollaboratorList();
  renderHome();
  return { ok: true };
}

export async function renameWorkspace(projectId, name) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No workspace found.' };
  if (!canEditWorkspaceSettings(project, user)) {
    return { ok: false, reason: 'Only workspace owners and admins can update workspace settings.' };
  }

  const nextName = String(name || '').trim();
  if (!nextName) {
    return { ok: false, reason: 'Workspace name cannot be empty.' };
  }

  project.workspace = {
    ...(project.workspace || {}),
    id: project.workspace?.id || project.id,
    inviteCode: project.workspace?.inviteCode || project.scriptId || '',
    reminders: Array.isArray(project.workspace?.reminders) ? project.workspace.reminders : [],
    name: nextName
  };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    workspace: project.workspace,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Renamed the workspace to ${nextName}.`, {
    action: 'workspace.renamed',
    workspaceId: getWorkspaceId(project)
  });
  persistProjects(false);
  renderHome();
  return { ok: true };
}

export async function resendInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Not signed in.' };
  const inviteRef = doc(db, 'invitations', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return { ok: false, reason: 'Invitation not found.' };
  const invite = inviteSnap.data();
  const project = state.projects.find((item) => item.id === invite.projectId) || getCurrentProject();
  if (!project) return { ok: false, reason: 'Workspace not found.' };
  if (!canInviteToWorkspace(project, user)) {
    return { ok: false, reason: 'Only workspace owners and admins can resend invites.' };
  }

  const resentAt = new Date().toISOString();
  await updateDoc(inviteRef, {
    status: INVITATION_STATUSES.pending,
    role: normalizeWorkspaceRole(invite.role),
    invitedBy: user.uid,
    fromUid: user.uid,
    fromName: user.displayName || user.email,
    fromEmail: user.email,
    lastSentAt: resentAt,
    expiresAt: getInviteExpiryTimestamp(resentAt),
    revokedReason: null,
    revokedAt: null,
    updatedAt: resentAt
  });
  await appendInviteHistoryEntry(user.uid, {
    email: invite.toEmail,
    workspaceId: invite.workspaceId || invite.projectId,
    projectTitle: invite.projectTitle,
    role: invite.role,
    status: INVITATION_STATUSES.pending,
    timestamp: resentAt
  });
  return { ok: true };
}

export async function cancelInvitation(inviteId) {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Not signed in.' };
  const inviteRef = doc(db, 'invitations', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return { ok: false, reason: 'Invitation not found.' };
  const invite = inviteSnap.data();
  const project = state.projects.find((item) => item.id === invite.projectId) || getCurrentProject();
  if (!project) return { ok: false, reason: 'Workspace not found.' };
  if (!canInviteToWorkspace(project, user)) {
    return { ok: false, reason: 'Only workspace owners and admins can cancel invites.' };
  }

  const revokedAt = new Date().toISOString();
  await updateDoc(inviteRef, {
    status: INVITATION_STATUSES.revoked,
    revokedReason: 'canceled',
    revokedAt,
    updatedAt: revokedAt
  });
  if (invite.toUid) {
    await upsertWorkspaceMemberRecord({
      userId: invite.toUid,
      workspaceId: invite.workspaceId || invite.projectId,
      role: normalizeWorkspaceRole(invite.role),
      invitedBy: invite.invitedBy || invite.fromUid,
      joinedAt: '',
      status: WORKSPACE_MEMBER_STATUSES.removed,
      name: invite.toName || invite.toEmail || '',
      email: invite.toEmail || ''
    });
  }
  await appendInviteHistoryEntry(user.uid, {
    email: invite.toEmail,
    workspaceId: invite.workspaceId || invite.projectId,
    projectTitle: invite.projectTitle,
    role: invite.role,
    status: INVITATION_STATUSES.revoked,
    timestamp: revokedAt
  });
  return { ok: true };
}

export async function addWorkspaceReminder(projectId, reminder) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No workspace found.' };
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

  const workspace = project.workspace || { id: project.id, name: project.title || 'Team Assembly', inviteCode: project.scriptId || '', reminders: [] };
  const reminders = [...(workspace.reminders || []), nextReminder];
  project.workspace = { ...workspace, reminders };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    workspace: project.workspace,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Added reminder: ${text}.`);
  persistProjects(false);
  return { ok: true };
}

export async function toggleWorkspaceReminder(projectId, reminderId) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No workspace found.' };
  if (!canEditProject(project, user)) {
    return { ok: false, reason: 'Viewers cannot edit reminders.' };
  }

  const workspace = project.workspace || { id: project.id, name: project.title || 'Team Assembly', inviteCode: project.scriptId || '', reminders: [] };
  const reminders = (workspace.reminders || []).map((item) => item.id === reminderId
    ? { ...item, completed: !item.completed, updatedAt: new Date().toISOString() }
    : item
  );
  const changed = reminders.find((item) => item.id === reminderId);
  if (!changed) {
    return { ok: false, reason: 'Reminder not found.' };
  }

  project.workspace = { ...workspace, reminders };
  await updateDoc(doc(db, 'sharedProjects', projectId), {
    workspace: project.workspace,
    updatedBy: user.uid
  });
  await logActivity(projectId, `${changed.completed ? 'Completed' : 'Reopened'} reminder: ${changed.text}.`);
  persistProjects(false);
  return { ok: true };
}

export async function deleteWorkspaceReminder(projectId, reminderId) {
  const user = auth.currentUser;
  const project = state.projects.find(p => p.id === projectId) || getCurrentProject();
  if (!user || !project) return { ok: false, reason: 'No workspace found.' };
  if (!canEditProject(project, user)) {
    return { ok: false, reason: 'Viewers cannot edit reminders.' };
  }

  const workspace = project.workspace || { id: project.id, name: project.title || 'Team Assembly', inviteCode: project.scriptId || '', reminders: [] };
  const existing = (workspace.reminders || []).find((item) => item.id === reminderId);
  if (!existing) {
    return { ok: false, reason: 'Reminder not found.' };
  }

  project.workspace = {
    ...workspace,
    reminders: (workspace.reminders || []).filter((item) => item.id !== reminderId)
  };

  await updateDoc(doc(db, 'sharedProjects', projectId), {
    workspace: project.workspace,
    updatedBy: user.uid
  });
  await logActivity(projectId, `Removed reminder: ${existing.text}.`);
  persistProjects(false);
  return { ok: true };
}

export async function syncWorkspaceState(workspaceId = state.currentWorkspaceId) {
  const user = auth.currentUser;
  if (!user || !workspaceId) return { ok: false, reason: 'No workspace selected.' };

  const snapshot = await getDocs(query(
    collection(db, 'sharedProjects'),
    where('workspace.id', '==', workspaceId)
  ));

  const remoteProjects = snapshot.docs.map((docSnap) => sanitizeProject(docSnap.data()));
  const remoteIds = new Set(remoteProjects.map((project) => project.id));
  if (!remoteProjects.length) {
    return { ok: false, reason: 'Workspace data is not available.' };
  }

  state.projects = state.projects.filter((project) => (
    !(project.isShared && project.workspace?.id === workspaceId) || remoteIds.has(project.id)
  ));
  remoteProjects.forEach((project) => upsertProject(project));

  const workspaceLead = remoteProjects.find((project) => project.isWorkspaceRoot)
    || remoteProjects[0];
  state.currentWorkspaceId = workspaceId;
  if (!state.projects.some((project) => project.id === state.currentProjectId && project.workspace?.id === workspaceId)) {
    state.currentProjectId = workspaceLead.id;
  }
  persistProjects(false, { syncInputs: false });
  syncSharedProjectWatchers();
  if (state.currentWorkspaceId === workspaceId) {
    renderHome();
    renderWorkspaceView();
  }
  return { ok: true, count: remoteProjects.length };
}

export async function leaveWorkspace(workspaceId = state.currentWorkspaceId) {
  const user = auth.currentUser;
  if (!user || !workspaceId) return { ok: false, reason: 'No workspace selected.' };
  const workspaceProjects = state.projects.filter((project) => project.isShared && project.workspace?.id === workspaceId);
  const workspaceLead = getWorkspaceRootProject(workspaceId) || workspaceProjects[0] || null;
  if (!workspaceLead) return { ok: false, reason: 'Workspace not found.' };
  if (workspaceLead.ownerId === user.uid) {
    return { ok: false, reason: 'Transfer ownership or delete the workspace before leaving it.' };
  }
  if (!workspaceLead.collaborators?.[user.uid]) {
    return { ok: false, reason: 'You are not an active collaborator in this workspace.' };
  }

  await logActivity(workspaceLead.id, `${user.displayName || user.email || 'A collaborator'} left the workspace.`, {
    action: 'workspace.leave',
    workspaceId
  });

  for (const project of workspaceProjects) {
    if (!project.collaborators?.[user.uid]) continue;
    const nextCollaborators = { ...(project.collaborators || {}) };
    delete nextCollaborators[user.uid];
    await updateDoc(doc(db, 'sharedProjects', project.id), {
      collaborators: nextCollaborators,
      updatedBy: user.uid,
      lastEditorName: user.displayName || user.email || 'Workspace member'
    });
    await deleteProjectFromCloud(project.id);
    if (state.currentProjectId === project.id) {
      await clearRealtimePresence(project.id);
    }
  }

  await upsertWorkspaceMemberRecord({
    userId: user.uid,
    workspaceId,
    role: WORKSPACE_ROLES.viewer,
    invitedBy: workspaceLead.ownerId || '',
    joinedAt: workspaceLead.collaborators?.[user.uid]?.addedAt || '',
    status: WORKSPACE_MEMBER_STATUSES.removed,
    name: user.displayName || user.email || '',
    email: user.email || '',
    photoURL: user.photoURL || ''
  });

  state.projects = state.projects.filter((project) => !(project.isShared && project.workspace?.id === workspaceId));
  if (!state.projects.length) {
    state.projects = [sanitizeProject({ title: 'Untitled Script' })];
  }
  state.currentWorkspaceId = null;
  state.currentProjectId = state.projects[0]?.id || null;
  persistProjects(false, { syncInputs: false });
  renderHome();
  showHome();
  syncSharedProjectWatchers();
  return { ok: true };
}

export async function deleteWorkspaceData(workspaceId) {
  const user = auth.currentUser;
  if (!user || !workspaceId) return { ok: false, reason: 'No workspace selected.' };
  const workspaceLead = getWorkspaceRootProject(workspaceId) || state.projects.find((project) => project.workspace?.id === workspaceId) || null;
  if (!workspaceLead) return { ok: false, reason: 'Workspace not found.' };
  if (!canDeleteWorkspace(workspaceLead, user)) {
    return { ok: false, reason: 'Only the workspace owner can delete this workspace.' };
  }

  const sharedSnapshot = await getDocs(query(
    collection(db, 'sharedProjects'),
    where('workspace.id', '==', workspaceId)
  ));
  for (const projectDoc of sharedSnapshot.docs) {
    const projectId = projectDoc.id;
    const commentsSnapshot = await getDocs(collection(db, 'sharedProjects', projectId, 'comments'));
    for (const commentDoc of commentsSnapshot.docs) {
      await deleteDoc(commentDoc.ref);
    }
    const presenceSnapshot = await getDocs(collection(db, 'sharedProjects', projectId, 'presence'));
    for (const presenceDoc of presenceSnapshot.docs) {
      await deleteDoc(presenceDoc.ref);
    }
    const versionsSnapshot = await getDocs(collection(db, 'sharedProjects', projectId, 'versions'));
    for (const versionDoc of versionsSnapshot.docs) {
      await deleteDoc(versionDoc.ref);
    }
    await deleteDoc(projectDoc.ref);
  }

  const invitationSnapshot = await getDocs(query(
    collection(db, 'invitations'),
    where('workspaceId', '==', workspaceId)
  ));
  for (const inviteDoc of invitationSnapshot.docs) {
    await deleteDoc(inviteDoc.ref);
  }

  const membersSnapshot = await getDocs(query(
    collection(db, 'workspace_members'),
    where('workspace_id', '==', workspaceId)
  ));
  for (const memberDoc of membersSnapshot.docs) {
    await deleteDoc(memberDoc.ref);
  }

  await clearRealtimePresence(activePresenceProjectId);
  return { ok: true };
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
      if (state.currentWorkspaceId === updated.workspace?.id) {
        renderWorkspaceView();
      }
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

  const sharedIds = new Set(
    state.projects
      .filter(project => project.isShared && project.ownerId !== user.uid)
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

        const sharedProject = sanitizeProject(snap.data());
        if (!sharedProject.collaborators?.[user.uid]) {
          handleSharedProjectRemoved(projectId);
          return;
        }

        if (snap.data().updatedBy === user.uid) return;
        upsertProject(sharedProject);
        persistProjects(false);
        renderHome();
        if (state.currentWorkspaceId === sharedProject.workspace?.id) {
          renderWorkspaceView();
        }
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
  if (!canCommentOnProject(project, user)) {
    await customAlert('Viewer access is read-only here. Ask an admin or the owner to enable viewer comments or promote you.', 'Read-only Workspace');
    return;
  }
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
  if (!canEditProject(project, user)) {
    await customAlert('Viewer access is read-only.', 'Read-only Workspace');
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

  const user = auth.currentUser;
  const collaboratorEntries = Object.entries(project.collaborators || {});

  const countEl = document.getElementById('collabCount');
  if (countEl) {
    const total = collaboratorEntries.length;
    countEl.textContent = total ? `(${total}/${MAX_COLLABORATORS})` : '';
  }

  const ownerDisplay = project.ownerName || project.ownerEmail || 'Owner';
  const ownerPresence = getPresenceCopy(project, project.ownerId, ownerDisplay);
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
          ${ownerPresence ? `<span class="collaborator-role-copy">${esc(ownerPresence)}</span>` : ''}
        </div>
      </div>`
    : '';

  if (!collaboratorEntries.length) {
    list.innerHTML = ownerRow || '<p class="collab-empty">No collaborators yet.</p>';
    if (ownerRow) attachCollabProfileTriggers(list);
    return;
  }

  list.innerHTML = ownerRow + collaboratorEntries.map(([uid, c]) => {
    const presenceCopy = getPresenceCopy(project, uid, c.name || c.email || 'Collaborator');
    return `
    <div class="collaborator-item">
      ${buildCollaboratorAvatarMarkup({ uid, name: c.name || c.email, email: c.email || '', photoURL: c.photoURL || '' })}
      <div class="collaborator-info">
        <span class="collaborator-name">${esc(c.name || c.email)} <span class="role-badge">${esc((c.role || WORKSPACE_ROLES.editor).replace(/^./, (char) => char.toUpperCase()))}</span></span>
        <button class="collaborator-email collab-profile-trigger collaborator-link-trigger" type="button" data-uid="${esc(uid)}" data-name="${esc(c.name || '')}" data-email="${esc(c.email || '')}" data-photourl="${esc(c.photoURL || '')}">${esc(c.name || c.email || 'Collaborator')}</button>
        ${presenceCopy ? `<span class="collaborator-role-copy">${esc(presenceCopy)}</span>` : ''}
        ${canUpdateCollaboratorRole(project, user, uid, c.role) ? `<label class="collab-role-field"><span>Role</span><select class="collab-role-select" data-uid="${esc(uid)}">
          ${getAssignableWorkspaceRoles(project, user, uid).map((option) => `<option value="${esc(option)}" ${normalizeWorkspaceRole(c.role) === option ? 'selected' : ''}>${esc(option.replace(/^./, (char) => char.toUpperCase()))}</option>`).join('')}
        </select></label>` : `<span class="collaborator-role-copy">${esc(normalizeWorkspaceRole(c.role).replace(/^./, (char) => char.toUpperCase()))} access</span>`}
      </div>
      ${canRemoveCollaborator(project, user, uid) ? `<button class="kick-btn" data-uid="${uid}" title="Remove collaborator">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>` : ''}
    </div>
  `;
  }).join('');

  list.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await customConfirm(
        `Remove this collaborator from "${project.title}"?`,
        'Remove Collaborator'
      );
      if (confirmed) kickCollaborator(project.id, btn.dataset.uid);
    });
  });

  list.querySelectorAll('.collab-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      select.disabled = true;
      const result = await updateCollaboratorRole(project.id, select.dataset.uid, select.value);
      select.disabled = false;
      if (!result?.ok) {
        await customAlert(result?.reason || 'Unable to update role right now.', 'Workspace Role');
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
  const raw = String(value || '').trim();
  return raw || 'User';
}

function getPresenceCopy(project, uid, fallbackName = 'Workspace member') {
  const presence = getRealtimePresence(project?.id)?.[uid];
  if (!isPresenceFresh(presence)) return '';
  if (presence.isTyping) {
    return `${fallbackName} is typing...`;
  }
  if (presence.lineLabel) {
    return `Working in "${presence.lineLabel}"`;
  }
  return 'Live now';
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
        const fullName = data.name || name || email || 'User';
        nameEl.textContent = formatCollaboratorHandle(fullName);
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
        const effectiveInvite = isInvitationExpired(inv)
          ? { ...inv, status: INVITATION_STATUSES.expired }
          : inv;
        const statusLabel = getInvitationStatusLabel(effectiveInvite);
        const canResend = effectiveInvite.status !== INVITATION_STATUSES.accepted;
        const canCancel = effectiveInvite.status === INVITATION_STATUSES.pending;
        const expiresCopy = effectiveInvite.expiresAt
          ? `Expires ${fmtTime(effectiveInvite.expiresAt)}`
          : '';
        return `
          <div class="collab-request-item">
            <div class="collab-request-info">
              <span class="collab-request-from">${esc(inv.toEmail)}</span>
              <span class="collab-request-project">${esc(inv.projectTitle)}${expiresCopy ? ` - ${esc(expiresCopy)}` : ''}</span>
              <span class="collab-request-project">${esc((inv.role || WORKSPACE_ROLES.editor).replace(/^./, (char) => char.toUpperCase()))} access</span>
            </div>
            <div class="collab-request-actions">
              <span class="status-pill ${effectiveInvite.status}">${statusLabel}</span>
              ${canResend ? `<button class="ghost-button collab-resend-btn" data-invite-id="${inv.id}">Resend</button>` : ''}
              ${canCancel ? `<button class="ghost-button danger-text collab-cancel-btn" data-invite-id="${inv.id}">Cancel</button>` : ''}
            </div>
          </div>
        `;
      }).join('');

  containers.forEach(list => {
    list.innerHTML = html;
    list.querySelectorAll('.collab-resend-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const result = await resendInvitation(button.dataset.inviteId);
        if (!result?.ok) {
          await customAlert(result?.reason || 'Unable to resend the invitation right now.', 'Invitation');
        }
      });
    });
    list.querySelectorAll('.collab-cancel-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = await customConfirm('Cancel this invitation?', 'Cancel Invite');
        if (!confirmed) return;
        const result = await cancelInvitation(button.dataset.inviteId);
        if (!result?.ok) {
          await customAlert(result?.reason || 'Unable to cancel the invitation right now.', 'Invitation');
        }
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
          <span class="collab-request-project">Expires ${esc(fmtTime(inv.expiresAt || getInviteExpiryTimestamp(inv.createdAt)))}</span>
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

function renderActivityLog(project) {
  const container = document.getElementById('studioActivityLog');
  if (!container) return;
  const log = project.activityLog || [];
  if (!log.length) {
    container.innerHTML = '<p class="collab-empty">No activity recorded yet.</p>';
    return;
  }
  container.innerHTML = [...log].reverse().map(e => `
    <div class="activity-log-item">
      <div class="activity-log-meta">
        <span>${esc(e.user)}</span>
        <span>${fmtTime(e.timestamp)}</span>
      </div>
      <div class="activity-log-copy">${esc(e.message)}</div>
    </div>
  `).join('');
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
