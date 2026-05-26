import { auth, db, storage } from './firebase.js';
import {
  collection,
  doc,
  getDocs,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getDownloadURL,
  ref,
  uploadBytes
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const DB_NAME = 'eyawriter-conversion-jobs';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';
const CLOUD_TEXT_LIMIT = 120000;

let openDbPromise = null;

function getIndexedDb() {
  return window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.msIndexedDB;
}

function openDb() {
  if (openDbPromise) return openDbPromise;
  const indexedDb = getIndexedDb();
  if (!indexedDb) {
    openDbPromise = Promise.resolve(null);
    return openDbPromise;
  }

  openDbPromise = new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);

  return openDbPromise;
}

function runTransaction(mode, handler) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = handler(store);
      if (!request) {
        resolve(null);
        return;
      }
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }).catch(() => null);
  });
}

export function persistConversionJobRecord(job) {
  if (!job?.id) return Promise.resolve(null);
  const payload = {
    ...job,
    persistedAt: new Date().toISOString()
  };
  mirrorJobToCloud(payload);
  return runTransaction('readwrite', (store) => store.put(payload));
}

export function patchConversionJobRecord(jobId, patch) {
  if (!jobId) return Promise.resolve(null);
  return runTransaction('readwrite', (store) => {
    const request = store.get(jobId);
    request.onsuccess = () => {
      const current = request.result || { id: jobId };
      const payload = {
        ...current,
        ...patch,
        id: jobId,
        persistedAt: new Date().toISOString()
      };
      mirrorJobToCloud(payload);
      store.put(payload);
    };
    return request;
  });
}

export function attachConversionJobFile(jobId, file) {
  if (!jobId || !file) return Promise.resolve(null);
  mirrorSourceFileToCloud(jobId, file);
  return runTransaction('readwrite', (store) => {
    const request = store.get(jobId);
    request.onsuccess = () => {
      const current = request.result || { id: jobId };
      store.put({
        ...current,
        id: jobId,
        sourceFile: {
          name: file.name,
          type: file.type || '',
          size: Number(file.size) || 0,
          lastModified: file.lastModified || 0,
          blob: file
        },
        persistedAt: new Date().toISOString()
      });
    };
    return request;
  });
}

export function getConversionJobRecord(jobId) {
  if (!jobId) return Promise.resolve(null);
  return runTransaction('readonly', (store) => store.get(jobId));
}

export function listConversionJobRecords() {
  return openDb().then(async (db) => {
    if (!db) return [];
    const localRows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        rows.sort((a, b) => {
          const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
          const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
          return bTime - aTime;
        });
        resolve(rows);
      };
      request.onerror = () => reject(request.error);
    }).catch(() => []);
    const cloudRows = await listCloudConversionJobRecords();
    return mergeJobLists(localRows, cloudRows);
  });
}

async function listCloudConversionJobRecords() {
  const user = auth.currentUser;
  if (!user?.uid) return [];
  try {
    const snapshot = await getDocs(collection(db, 'users', user.uid, 'conversionJobs'));
    return snapshot.docs.map((entry) => entry.data());
  } catch {
    return [];
  }
}

function mergeJobLists(localRows, cloudRows) {
  const merged = new Map();
  [...(cloudRows || []), ...(localRows || [])].forEach((job) => {
    if (!job?.id) return;
    const existing = merged.get(job.id) || {};
    merged.set(job.id, {
      ...existing,
      ...job,
      sourceFile: job.sourceFile?.blob ? job.sourceFile : (existing.sourceFile || job.sourceFile)
    });
  });
  return [...merged.values()].sort((a, b) => {
    const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
    const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

async function mirrorJobToCloud(job) {
  const user = auth.currentUser;
  if (!user?.uid || !job?.id) return;
  const payload = buildCloudJobPayload(job);
  try {
    await setDoc(doc(db, 'users', user.uid, 'conversionJobs', job.id), payload, { merge: true });
  } catch {
    // Cloud mirroring is best-effort; local persistence remains primary.
  }
}

async function mirrorSourceFileToCloud(jobId, file) {
  const user = auth.currentUser;
  if (!user?.uid || !jobId || !file) return;
  try {
    const safeName = String(file.name || 'script').replace(/[^\w.\-]+/g, '_');
    const storageRef = ref(storage, `conversion-jobs/${user.uid}/${jobId}/${safeName}`);
    const upload = await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream'
    });
    const url = await getDownloadURL(upload.ref);
    await setDoc(doc(db, 'users', user.uid, 'conversionJobs', jobId), {
      id: jobId,
      sourceFile: {
        name: file.name,
        type: file.type || '',
        size: Number(file.size) || 0,
        lastModified: file.lastModified || 0,
        storagePath: upload.ref.fullPath,
        downloadURL: url
      },
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch {
    // Ignore cloud upload failures so local retry still works.
  }
}

function buildCloudJobPayload(job) {
  const rawText = String(job.rawText || '');
  const normalizedText = String(job.normalizedText || '');
  const structuredLines = Array.isArray(job.structuredLines) ? job.structuredLines : [];
  return {
    id: job.id,
    fileName: job.fileName || '',
    projectId: job.projectId || '',
    status: job.status || 'queued',
    stageLabel: job.stageLabel || '',
    createdAt: job.createdAt || new Date().toISOString(),
    updatedAt: job.updatedAt || new Date().toISOString(),
    persistedAt: new Date().toISOString(),
    warnings: Array.isArray(job.warnings) ? job.warnings.slice(0, 20) : [],
    structuredLineCount: Number(job.structuredLineCount || structuredLines.length || 0),
    rawText: rawText.slice(0, CLOUD_TEXT_LIMIT),
    rawTextTruncated: rawText.length > CLOUD_TEXT_LIMIT,
    normalizedText: normalizedText.slice(0, CLOUD_TEXT_LIMIT),
    normalizedTextTruncated: normalizedText.length > CLOUD_TEXT_LIMIT,
    structuredLines: structuredLines.slice(0, 200).map((line) => ({
      type: String(line?.type || 'action'),
      text: String(line?.text || '').slice(0, 4000)
    })),
    sourceFile: {
      ...(job.sourceFile || {}),
      blob: undefined
    }
  };
}
