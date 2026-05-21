import { auth, db } from './firebase.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';

export const ACTIVITY_CATEGORIES = {
  comment: 'comment',
  invite: 'invite',
  member: 'member',
  role: 'role',
  workspace: 'workspace',
  system: 'system'
};

export async function logActivity(projectId, message, { category = ACTIVITY_CATEGORIES.system } = {}) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  const user = auth.currentUser;
  const userName = user?.displayName || user?.email || 'Unknown User';

  const entry = {
    timestamp: new Date().toISOString(),
    user: userName,
    uid: user?.uid || null,
    category,
    message
  };

  project.activityLog = project.activityLog || [];
  project.activityLog.push(entry);
  project.lastActivityAt = entry.timestamp;

  if (project.activityLog.length > 50) {
    project.activityLog.shift();
  }

  if (project.isShared) {
    try {
      const ref = doc(db, 'sharedProjects', projectId);
      await updateDoc(ref, {
        activityLog: project.activityLog,
        updatedBy: user?.uid || 'system',
        lastEditorName: userName,
        lastActivityAt: entry.timestamp
      });
    } catch (err) {
      console.error('Failed to sync activity log', err);
    }
  }
}

export async function logCommentActivity(projectId, action, { text = '' } = {}) {
  const truncated = text.length > 60 ? text.slice(0, 60) + '…' : text;
  const messages = {
    added: truncated ? `Commented: "${truncated}"` : 'Added a comment',
    resolved: 'Resolved a comment',
    unresolved: 'Reopened a comment',
    deleted: 'Deleted a comment',
    replied: truncated ? `Replied: "${truncated}"` : 'Replied to a comment'
  };
  return logActivity(projectId, messages[action] || 'Updated a comment', {
    category: ACTIVITY_CATEGORIES.comment
  });
}
