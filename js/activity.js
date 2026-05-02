import { auth, db } from './firebase.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './config.js';

export async function logActivity(projectId, message) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  const user = auth.currentUser;
  const userName = user?.displayName || user?.email || 'Unknown User';

  const entry = {
    timestamp: new Date().toISOString(),
    user: userName,
    message: message
  };

  project.activityLog = project.activityLog || [];
  project.activityLog.push(entry);

  // Keep last 50
  if (project.activityLog.length > 50) {
    project.activityLog.shift();
  }

  if (project.isShared) {
    try {
      const ref = doc(db, 'sharedProjects', projectId);
      await updateDoc(ref, {
        activityLog: project.activityLog,
        updatedBy: user?.uid || 'system',
        lastEditorName: userName
      });
    } catch (err) {
      console.error('Failed to sync activity log', err);
    }
  }
}
