import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _fetchedAt = 0;
let _pending = null;

async function _fetch() {
  if (_pending) return _pending;
  _pending = getDoc(doc(db, 'config', 'featureFlags'))
    .then(snap => {
      _cache = snap.exists() ? snap.data() : {};
      _fetchedAt = Date.now();
      _pending = null;
      return _cache;
    })
    .catch(() => {
      _pending = null;
      return _cache || {};
    });
  return _pending;
}

export const FeatureFlags = {
  async isEnabled(flag, defaultValue = false) {
    if (!_cache || Date.now() - _fetchedAt > TTL_MS) {
      await _fetch();
    }
    const val = _cache?.[flag];
    return val === undefined ? defaultValue : Boolean(val);
  },

  // Force a fresh fetch — useful after admin writes a new flag value
  async refresh() {
    _cache = null;
    return _fetch();
  }
};
