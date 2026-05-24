import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  sendEmailVerification,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { showHome, showAuth, renderHome, setTheme, customAlert, customConfirm } from './ui.js';
import { displayAppToast } from './toast.js';
import { Onboarding } from './onboarding.js';
import { state } from './config.js';
import { refs } from './dom.js';
import {
  fetchCloudProjects,
  importLocalProjectsToCloud,
  setProjectsFromCloud
} from './project.js';
import { initCollaboration, cleanupCollaboration } from './collaborate.js';
import { Telemetry } from './telemetry.js';
import { Logger } from './logger.js';
import { Funnel } from './funnel.js';
import { Referral } from './referral.js';
import { Billing } from './billing.js';

const SESSION_KEY = 'eyawriter_session';

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

let _googleAuthInProgress = false;

const PROFILE_BIO_PLACEHOLDER = 'About me';
const USERNAME_CHANGE_MS = 90 * 24 * 60 * 60 * 1000;

export const Auth = (() => {
  let tabBtns, forms, themeBtns, html;
  let forgotOverlay, forgotForm, forgotEmailInput, forgotCancel, forgotLink;
  let signupForm, loginForm;
  let signupNameInput, signupEmailInput, signupPassInput, signupPass2Input;
  let loginEmailInput, loginPassInput;

  // Profile Popup Elements
  let profilePopup, profileClose, profileTriggerBtns;
  let profileImg, profileName, profileEmail, profileBio, profileWordCount;
  let profileEditBtn, profileSignOutBtn;
  let profileUpload, profileUploadBtn;
  let profileUsernameInput, profileUsernameHint;
  let originalBio = '';
  let originalUsername = '';
  let pendingImageBase64 = null;
  let isEditMode = false;
  let isModified = false;
  let isSavingProfile = false;
  let cachedProfileMeta = {};

  function init() {
    tabBtns = document.querySelectorAll('.tab-btn');
    forms = document.querySelectorAll('.auth-form');
    themeBtns = document.querySelectorAll('.theme-btn');
    html = document.documentElement;

    forgotOverlay = document.getElementById('forgot-password-overlay');
    forgotForm = document.getElementById('forgot-password-form');
    forgotEmailInput = document.getElementById('forgot-email');
    forgotCancel = document.getElementById('forgot-cancel-btn');
    forgotLink = document.getElementById('forgot-password-link');

    signupForm = document.getElementById('signup-form');
    loginForm = document.getElementById('login-form');
    signupNameInput = document.getElementById('signup-name');
    signupEmailInput = document.getElementById('signup-email');
    signupPassInput = document.getElementById('signup-pass');
    signupPass2Input = document.getElementById('signup-pass2');
    loginEmailInput = document.getElementById('login-email');
    loginPassInput = document.getElementById('login-pass');

    // Profile Elements
    profilePopup = document.getElementById('profile-popup');
    profileClose = document.getElementById('close-profile');
    profileTriggerBtns = document.querySelectorAll('.open-profile-btn');
    profileImg = document.getElementById('profile-img');
    profileName = document.getElementById('profile-name');
    profileEmail = document.getElementById('profile-email');
    profileUsernameInput = document.getElementById('profile-username');
    profileUsernameHint = document.getElementById('profile-username-hint');
    profileBio = document.getElementById('profile-bio');
    profileWordCount = document.getElementById('word-count');
    profileEditBtn = document.getElementById('edit-profile');
    profileSignOutBtn = document.getElementById('profile-signout-btn');
    profileUpload = document.getElementById('profile-upload');
    profileUploadBtn = document.getElementById('change-photo-btn');

    if (!signupForm || !loginForm) return;

    // Password match validation
    signupPass2Input?.addEventListener('input', () => {
      if (signupPassInput.value && signupPass2Input.value && signupPassInput.value !== signupPass2Input.value) {
        signupPass2Input.setCustomValidity("Passwords don't match");
      } else {
        signupPass2Input.setCustomValidity('');
      }
    });

    // Handle return from signInWithRedirect — show loading state if we triggered one
    const _isRedirectReturn = sessionStorage.getItem('eyawriter_google_redirect') === '1';
    if (_isRedirectReturn) {
      sessionStorage.removeItem('eyawriter_google_redirect');
      _googleAuthInProgress = true;
      _setGoogleBtnsLoading('Signing in…');
    }
    getRedirectResult(auth).then(result => {
      if (result?.user) {
        // Redirect succeeded; onAuthStateChanged handles the transition
        // Leave buttons in loading state — auth view will be hidden when home renders
      }
    }).catch(err => {
      if (_isRedirectReturn) {
        _resetGoogleBtns();
      }
      const msg = friendlyError(err);
      if (msg) customAlert(msg);
    });

    // Tab switching logic
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        forms.forEach(form => {
          form.classList.remove('active');
          if (form.id === `${tab}-form`) form.classList.add('active');
        });
      });
    });

    // Theme switching logic
    themeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setTheme(theme);
        // Reflect theme on authView for scoped CSS
        const av = document.getElementById('authView');
        if (av) av.setAttribute('data-theme', theme);
      });
    });

    // Load and reflect saved theme in Auth UI
    const savedTheme = localStorage.getItem('eyawriter-theme') || state.theme;
    const initialTheme = savedTheme === 'cedar' ? 'rose' : savedTheme;
    document.querySelector(`.theme-btn[data-theme="${initialTheme}"]`)?.classList.add('active');
    const av = document.getElementById('authView');
    if (av) av.setAttribute('data-theme', initialTheme);

    forgotLink.addEventListener('click', e => {
      e.preventDefault();
      forgotOverlay.classList.add('active');
    });
    forgotCancel.addEventListener('click', () => forgotOverlay.classList.remove('active'));
    forgotForm.addEventListener('submit', handleForgotPassword);

    signupForm.addEventListener('submit', handleSignUp);
    loginForm.addEventListener('submit', handleSignIn);

    document.getElementById('google-signup')?.addEventListener('click', handleGoogleSignIn);
    document.getElementById('google-signin')?.addEventListener('click', handleGoogleSignIn);
    // Profile Listeners
    profileTriggerBtns.forEach(btn => btn.addEventListener('click', openProfilePopup));
    profileClose?.addEventListener('click', closeProfilePopup);
    profilePopup?.addEventListener('click', e => { if (e.target === profilePopup) closeProfilePopup(); });
    profileEditBtn?.addEventListener('click', handleEditToggle);
    profileSignOutBtn?.addEventListener('click', handleSignOut);
    document.getElementById('open-settings-btn')?.addEventListener('click', () => {
      closeProfilePopup();
      import('./settings.js').then(({ Settings }) => Settings.show());
    });
    profileUploadBtn?.addEventListener('click', () => profileUpload.click());
    profileUpload?.addEventListener('change', handleImageUpload);
    profileBio?.addEventListener('input', () => {
      updateBioWordCount();
      if (isEditMode && !isModified) {
        isModified = true;
        setEditBtnMode('save');
      }
    });
    profileUsernameInput?.addEventListener('input', () => {
      if (isEditMode && !isModified) {
        isModified = true;
        setEditBtnMode('save');
      }
    });
    profileBio?.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && profilePopup?.classList.contains('active')) closeProfilePopup();
    });

    onAuthStateChanged(auth, async firebaseUser => {
      if (firebaseUser) {
        // Google accounts are always verified; only block unverified email/password accounts
        const isGoogleUser = firebaseUser.providerData?.some(p => p.providerId === 'google.com');
        if (!firebaseUser.emailVerified && !isGoogleUser) {
          _resetGoogleBtns();
          await firebaseSignOut(auth);
          displayAppToast('Please verify your email before signing in.', 'warning', 5000);
          return;
        }
        _googleAuthInProgress = false;
        cacheSession(firebaseUser);

        try {
          Telemetry.track('login', { method: firebaseUser.providerData?.[0]?.providerId || 'email' });
          await ensureUsersByEmail(firebaseUser).catch(err => Logger.capture('ensureUsersByEmail', err));
          await trackRetention(firebaseUser).catch(() => {});
          Funnel.milestone('first_login');
          // Update admin active-user record (best-effort)
          setDoc(doc(db, 'adminActiveUsers', firebaseUser.uid), {
            uid: firebaseUser.uid,
            lastActiveAt: new Date().toISOString()
          }, { merge: true }).catch(() => {});
          await syncProjectsOnLogin(firebaseUser.uid);
          await loadUserProfile(firebaseUser);
        } catch (err) {
          Logger.capture('onAuthStateChanged/init', err);
          console.error('Initialization background tasks failed', err);
        }

        if (refs.authView && !refs.authView.hidden) showHome();
        renderHome();
        updateTriggerUI(firebaseUser);
        initCollaboration();
        Billing.init().catch(() => {});
        setTimeout(() => Onboarding.maybeShow(), 800);
      } else {
        _resetGoogleBtns();
        cleanupCollaboration();
        const session = getCachedSession();
        if (!session?.isDemoSession) {
          clearSession();
          if (
            (refs.homeView && !refs.homeView.hidden) ||
            (refs.studioView && !refs.studioView.hidden)
          ) {
            showAuth();
          }
        } else {
          await loadUserProfile();
          updateTriggerUI({ photoURL: session.photoURL, displayName: session.name });
          if (refs.authView && !refs.authView.hidden) showHome();
          renderHome();
        }
      }
    });
  }

  async function ensureUsersByEmail(firebaseUser) {
    const emailKey = firebaseUser.email.toLowerCase();
    const ref = doc(db, 'usersByEmail', emailKey);
    await setDoc(ref, {
      uid: firebaseUser.uid,
      name: firebaseUser.displayName || firebaseUser.email,
      username: sanitizeUsername(firebaseUser.displayName || firebaseUser.email)
    }, { merge: true });
  }

  async function syncProjectsOnLogin(uid) {
    try {
      const cloudProjects = await fetchCloudProjects(uid);
      const localProjects = state.projects.filter(
        p => p.id !== 'sample-project' && p.lines.some(l => l.text.trim())
      );
      const cloudIds = new Set(cloudProjects.map(p => p.id));
      const localOnly = localProjects.filter(p => !cloudIds.has(p.id));

      if (localOnly.length > 0 && cloudProjects.length > 0) {
        const shouldImport = await customConfirm(
          `You have ${localOnly.length} local project(s) not yet in your account. Import them?`,
          'Import local projects?'
        );
        if (shouldImport) {
          await importLocalProjectsToCloud(uid, localOnly);
          setProjectsFromCloud([...cloudProjects, ...localOnly]);
        } else {
          setProjectsFromCloud(cloudProjects);
        }
      } else if (localOnly.length > 0 && cloudProjects.length === 0) {
        await importLocalProjectsToCloud(uid, localOnly);
        setProjectsFromCloud(localOnly);
      } else {
        setProjectsFromCloud(cloudProjects);
      }
    } catch (err) {
      console.error('Cloud project sync failed', err);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const email = normalizeEmail(forgotEmailInput.value);
    if (!isValidEmail(email)) return customAlert('Please enter a valid email.');

    try {
      await sendPasswordResetEmail(auth, email);
      customAlert(`Password reset link sent to ${email}. Check your inbox!`, 'Reset Password');
      forgotOverlay.classList.remove('active');
      forgotForm.reset();
    } catch (err) {
      console.error('Forgot password error:', err.code, err);
      customAlert(friendlyError(err));
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    const name = signupNameInput.value.trim();
    const email = normalizeEmail(signupEmailInput.value);
    const password = signupPassInput.value;
    const password2 = signupPass2Input.value;

    if (!name) return customAlert('Please enter your name.');
    if (!isValidEmail(email)) return customAlert('Please enter a valid email.');
    if (password.length < 6) return customAlert('Password must be at least 6 characters.');
    if (!/[A-Z]/.test(password)) return customAlert('Password must contain at least one uppercase letter.');
    if (!/[a-z]/.test(password)) return customAlert('Password must contain at least one lowercase letter.');
    if (!/[0-9]/.test(password)) return customAlert('Password must contain at least one number.');
    if (password !== password2) return customAlert('Passwords do not match.');

    // Step 1: create the Auth account — fatal if this fails.
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      Logger.capture('handleSignUp', err);
      customAlert(friendlyError(err));
      return;
    }

    // Step 2: profile setup in Firestore — best-effort; a rules misconfiguration
    // must not prevent the user from receiving their verification email.
    const username = generateRandomUsername(name);
    const createdAt = new Date().toISOString();
    try {
      await updateProfile(credential.user, { displayName: username });
      await setDoc(doc(db, 'users', credential.user.uid, 'profile', 'data'), {
        uid: credential.user.uid,
        name,
        username,
        email,
        createdAt,
        usernameCreatedAt: createdAt,
        usernameUpdatedAt: createdAt
      });
      await setDoc(doc(db, 'usersByEmail', email.toLowerCase()), {
        uid: credential.user.uid,
        name: username,
        username
      });
    } catch (err) {
      Logger.capture('handleSignUp/profile', err);
      // profile writes failed — will be retried on first login via ensureUsersByEmail
    }
    enqueueWelcomeEmail(credential.user);
    Referral.processSignup(credential.user.uid);
    Funnel.milestone('signed_up', credential.user.uid);
    setDoc(doc(db, 'adminSignups', credential.user.uid), {
      uid: credential.user.uid,
      email,
      createdAt,
      referredBy: localStorage.getItem('eyawriter_ref') || null
    }).catch(() => {});
    try { await sendEmailVerification(credential.user); } catch { /* best-effort */ }
    Telemetry.track('signup', { method: 'email' });
    await firebaseSignOut(auth).catch(() => {});
    signupForm.reset();
    localStorage.removeItem('eyawriter_onboarded_v1');
    customAlert(`Account created! Check ${email} for a verification link, then sign in.`, 'Verify Your Email');
  }

  async function handleSignIn(e) {
    if (e?.preventDefault) e.preventDefault();
    const email = normalizeEmail(loginEmailInput.value);
    const password = loginPassInput.value;

    if (!isValidEmail(email)) return customAlert('Please enter a valid email.');
    if (!password) return customAlert('Please enter your password.');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
    } catch (err) {
      console.error('Sign-in error:', err.code, err);
      customAlert(friendlyError(err));
    }
  }

  async function handleGoogleSignIn() {
    if (_googleAuthInProgress) return;
    _googleAuthInProgress = true;
    _setGoogleBtnsLoading('Connecting…');

    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged fires next and transitions the view
      // Leave buttons loading — they will be hidden when auth view disappears
    } catch (err) {
      if (err.code === 'auth/popup-blocked') {
        try {
          sessionStorage.setItem('eyawriter_google_redirect', '1');
          await signInWithRedirect(auth, googleProvider);
          // Page navigates away — no reset needed
        } catch (redirectErr) {
          sessionStorage.removeItem('eyawriter_google_redirect');
          _resetGoogleBtns();
          const msg = friendlyError(redirectErr);
          if (msg) customAlert(msg);
        }
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        _resetGoogleBtns();
        // Silent — user dismissed the popup
      } else {
        _resetGoogleBtns();
        const msg = friendlyError(err);
        if (msg) customAlert(msg);
      }
    }
  }

  function _setGoogleBtnsLoading(label) {
    _getGoogleBtns().forEach(b => {
      b.disabled = true;
      const span = b.querySelector('.btn-google-label');
      if (span) span.textContent = label;
    });
  }

  function _resetGoogleBtns() {
    _googleAuthInProgress = false;
    _getGoogleBtns().forEach(b => {
      b.disabled = false;
      const span = b.querySelector('.btn-google-label');
      if (span) span.textContent = 'Continue with Google';
    });
  }

  function _getGoogleBtns() {
    return [
      document.getElementById('google-signup'),
      document.getElementById('google-signin')
    ].filter(Boolean);
  }

  async function handleSignOut() {
    const confirmed = await customConfirm('Sign out of your account?', 'Sign Out');
    if (!confirmed) return;
    closeProfilePopup();
    Telemetry.track('logout');
    clearSession();
    try { await firebaseSignOut(auth); } catch { /* ignore */ }
    displayAppToast('Signed out', 'info');
    showAuth();
  }

  function openProfilePopup(e) {
    const trigger = e.currentTarget;
    const rect = trigger.getBoundingClientRect();
    const card = profilePopup.querySelector('.popup-card');

    profilePopup.classList.add('active');

    // Position card under trigger
    const cardWidth = 336;
    let left = rect.right - cardWidth;
    if (left < 10) left = 10;

    card.style.top = `${rect.bottom + 8}px`;
    card.style.left = `${left}px`;
  }

  function closeProfilePopup() {
    profilePopup?.classList.remove('active');
    document.body.style.overflow = '';
    if (isEditMode) cancelBioEdit();
  }

  function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  function updateBioWordCount() {
    const text = profileBio.classList.contains('is-placeholder') ? '' : (profileBio.textContent || '');
    const words = countWords(text);
    profileWordCount.textContent = words;
    if (words > 35) {
      profileWordCount.classList.add('profile-word-limit');
    } else {
      profileWordCount.classList.remove('profile-word-limit');
    }
  }

  function setEditBtnMode(mode) {
    if (!profileEditBtn) return;
    if (mode === 'save') {
      profileEditBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Save</span>`;
      profileEditBtn.classList.add('profile-action-save');
    } else {
      profileEditBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>`;
      profileEditBtn.classList.remove('profile-action-save');
    }
  }

  function handleEditToggle() {
    if (!isEditMode) {
      isEditMode = true;
      isModified = false;
      originalBio = profileBio.classList.contains('is-placeholder') ? '' : profileBio.textContent;
      originalUsername = sanitizeUsername(profileUsernameInput?.value || originalUsername);
      if (profileBio.classList.contains('is-placeholder')) {
        profileBio.textContent = '';
        profileBio.classList.remove('is-placeholder');
      }
      if (profileUsernameInput) profileUsernameInput.disabled = false;
      profileBio.contentEditable = 'true';
      profileBio.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(profileBio);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (isModified) {
      handleBioSave();
    } else {
      cancelBioEdit();
    }
  }

  function cancelBioEdit() {
    isEditMode = false;
    isModified = false;
    pendingImageBase64 = null;
    profileBio.contentEditable = 'false';
    if (profileUsernameInput) {
      profileUsernameInput.disabled = true;
      profileUsernameInput.value = originalUsername;
    }
    setProfileBioValue(originalBio);
    setEditBtnMode('edit');
    updateBioWordCount();
    updateUsernameHint();
  }

  async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimensions 400x400
        if (width > height) {
          if (width > 400) { height *= 400 / width; width = 400; }
        } else {
          if (height > 400) { width *= 400 / height; height = 400; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG and check size
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Target < 154KB
        while (dataUrl.length > 154 * 1024 * 1.33 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        pendingImageBase64 = dataUrl;
        profileImg.src = dataUrl;
        if (!isEditMode) {
          isEditMode = true;
          originalBio = profileBio.textContent;
        }
        isModified = true;
        setEditBtnMode('save');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function handleBioSave() {
    const user = auth.currentUser;
    const session = getCachedSession();
    const isDemo = session?.isDemoSession;

    if (!user && !isDemo) return;

    const text = profileBio.classList.contains('is-placeholder') ? '' : (profileBio.textContent || '');
    const requestedUsername = sanitizeUsername(profileUsernameInput?.value || '');
    if (countWords(text) > 35) {
      customAlert('Bio cannot exceed 35 words.');
      return;
    }
    if (requestedUsername.length < 4) {
      customAlert('Username must be at least 4 characters.', 'Username');
      return;
    }
    if (requestedUsername !== originalUsername) {
      const nextAllowed = getNextUsernameChangeDate(cachedProfileMeta.usernameUpdatedAt || cachedProfileMeta.usernameCreatedAt || '');
      if (nextAllowed && nextAllowed.getTime() > Date.now()) {
        customAlert(`You can change your username again after ${nextAllowed.toLocaleDateString()}.`, 'Username Locked');
        return;
      }
    }

    profileBio.contentEditable = 'false';
    profileEditBtn.disabled = true;
    isSavingProfile = true;
    const btnSpan = profileEditBtn.querySelector('span');
    const originalBtnText = btnSpan ? btnSpan.textContent : 'Save';
    if (btnSpan) btnSpan.textContent = 'Saving…';

    try {
      const bio = text.trim();
      const nextPhotoURL = pendingImageBase64 || user?.photoURL || session?.photoURL || '';
      const data = {
        bio,
        photoURL: nextPhotoURL,
        name: cachedProfileMeta.name || session?.fullName || user?.displayName || session?.name || '',
        username: requestedUsername,
        usernameCreatedAt: cachedProfileMeta.usernameCreatedAt || new Date().toISOString(),
        usernameUpdatedAt: requestedUsername !== originalUsername
          ? new Date().toISOString()
          : (cachedProfileMeta.usernameUpdatedAt || cachedProfileMeta.usernameCreatedAt || new Date().toISOString()),
        email: user?.email || session?.email || '',
        updatedAt: new Date().toISOString()
      };

      if (isDemo) {
        // Handle Demo session locally
        session.bio = bio;
        session.photoURL = nextPhotoURL;
        session.name = requestedUsername;
        session.username = requestedUsername;
        session.usernameCreatedAt = data.usernameCreatedAt;
        session.usernameUpdatedAt = data.usernameUpdatedAt;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        // Mock a short delay for realism
        await new Promise(r => setTimeout(r, 500));
      } else {
        await setDoc(doc(db, 'users', user.uid, 'profile', 'data'), data, { merge: true });
        await updateProfile(user, { photoURL: nextPhotoURL, displayName: requestedUsername });
        await setDoc(doc(db, 'usersByEmail', user.email.toLowerCase()), {
          uid: user.uid,
          name: requestedUsername,
          username: requestedUsername
        }, { merge: true });
        cacheSession({
          uid: user.uid,
          email: user.email,
          displayName: requestedUsername,
          photoURL: nextPhotoURL
        });
      }

      pendingImageBase64 = null;
      originalBio = bio;
      originalUsername = requestedUsername;
      cachedProfileMeta = { ...cachedProfileMeta, ...data };
      isEditMode = false;
      isModified = false;
      isSavingProfile = false;
      profileEditBtn.disabled = false;
      setEditBtnMode('edit');
      setProfileBioValue(bio);
      if (profileUsernameInput) {
        profileUsernameInput.disabled = true;
        profileUsernameInput.value = requestedUsername;
      }
      if (nextPhotoURL) profileImg.src = nextPhotoURL;

      updateBioWordCount();
      updateUsernameHint();
      profileName.textContent = formatUsernameForDisplay(requestedUsername);
      if (user) updateTriggerUI({ photoURL: nextPhotoURL, displayName: requestedUsername });
      else if (isDemo) updateTriggerUI({ photoURL: session.photoURL, displayName: requestedUsername });
      displayAppToast('Profile updated');

    } catch (err) {
      console.error('Bio save failed', err);
      isSavingProfile = false;
      profileEditBtn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalBtnText;
      setEditBtnMode('save');
      profileBio.contentEditable = 'true';
      customAlert('We could not save your profile right now. Please try again.');
    }
  }

  function generateInitialsAvatar(name) {
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

  async function loadUserProfile(firebaseUser) {
    if (isSavingProfile) return;
    const session = getCachedSession();
    const isDemo = session?.isDemoSession;
    const user = auth.currentUser || firebaseUser;

    if (!user && !isDemo) return;

    const displayName = isDemo ? (session.username || session.name) : (user.displayName || 'User');
    profileEmail.hidden = true;

    const fallbackAvatar = generateInitialsAvatar(displayName);

    try {
      let profileData = {};
      if (isDemo) {
        profileData = {
          bio: session.bio,
          photoURL: session.photoURL,
          username: session.username || session.name,
          name: session.fullName || session.name,
          usernameCreatedAt: session.usernameCreatedAt || session.loggedInAt,
          usernameUpdatedAt: session.usernameUpdatedAt || session.loggedInAt
        };
      } else {
        const snap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        profileData = snap.exists() ? snap.data() : {};
      }
      const username = profileData.username || sanitizeUsername(displayName) || generateRandomUsername();
      const fullName = profileData.name || (isDemo ? (session.fullName || session.name) : (user.displayName || username));
      cachedProfileMeta = {
        ...profileData,
        username,
        name: fullName,
        usernameCreatedAt: profileData.usernameCreatedAt || profileData.createdAt || new Date().toISOString(),
        usernameUpdatedAt: profileData.usernameUpdatedAt || profileData.createdAt || new Date().toISOString()
      };
      originalUsername = username;
      profileName.textContent = formatUsernameForDisplay(username);
      if (profileUsernameInput) {
        profileUsernameInput.value = username;
        profileUsernameInput.disabled = true;
      }
      updateUsernameHint();

      const photo = profileData.photoURL || (!isDemo ? user.photoURL : null);
      if (photo) {
        profileImg.src = photo;
        profileImg.onerror = () => { profileImg.src = fallbackAvatar; profileImg.onerror = null; };
      } else {
        profileImg.src = fallbackAvatar;
      }

      setProfileBioValue(profileData.bio || '');
      updateBioWordCount();
      if (!profileData.username) {
        if (isDemo) {
          session.username = username;
          session.name = username;
          session.fullName = fullName;
          session.usernameCreatedAt = cachedProfileMeta.usernameCreatedAt;
          session.usernameUpdatedAt = cachedProfileMeta.usernameUpdatedAt;
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } else {
          await setDoc(doc(db, 'users', user.uid, 'profile', 'data'), cachedProfileMeta, { merge: true });
          await updateProfile(user, { displayName: username });
          await setDoc(doc(db, 'usersByEmail', user.email.toLowerCase()), {
            uid: user.uid,
            name: username,
            username
          }, { merge: true });
          cacheSession({
            uid: user.uid,
            email: user.email,
            displayName: username,
            photoURL: photo || user.photoURL || ''
          });

          // Trigger first-time setup sequence (matches handleSignUp logic)
          enqueueWelcomeEmail(user);
          Referral.processSignup(user.uid);
          Funnel.milestone('signed_up', user.uid);
          setDoc(doc(db, 'adminSignups', user.uid), {
            uid: user.uid,
            email: user.email,
            createdAt: cachedProfileMeta.usernameCreatedAt,
            referredBy: localStorage.getItem('eyawriter_ref') || null
          }).catch(() => {});
          Telemetry.track('signup', { method: 'google' });
          localStorage.removeItem('eyawriter_onboarded_v1');
        }
      }
    } catch (err) {
      console.error('Profile load failed', err);
      profileImg.src = fallbackAvatar;
      setProfileBioValue('');
    }
  }

  function updateTriggerUI(firebaseUser) {
    const photo = firebaseUser.photoURL;
    const name = firebaseUser.displayName || 'User';
    const fallback = generateInitialsAvatar(name);

    document.querySelectorAll('.user-avatar-img').forEach(img => {
      img.src = photo || fallback;
      img.hidden = false;
      if (photo) {
        img.onerror = () => { img.src = fallback; img.onerror = null; };
      }
    });

    const homeName = document.getElementById('homeUserNameDisplay');
    if (homeName) homeName.textContent = formatUsernameForDisplay(name);
  }

  function cacheSession(firebaseUser) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      name: firebaseUser.displayName || firebaseUser.email,
      username: firebaseUser.displayName || firebaseUser.email,
      photoURL: firebaseUser.photoURL || '',
      loggedIn: true,
      loggedInAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    }));
  }

  function sanitizeUsername(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  }

  function formatUsernameForDisplay(value) {
    const username = sanitizeUsername(value) || 'user';
    return `@${username}`;
  }

  function generateRandomUsername(seed = '') {
    const base = sanitizeUsername(seed).slice(0, 10) || 'writer';
    return `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function getNextUsernameChangeDate(value) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getTime() + USERNAME_CHANGE_MS);
  }

  function updateUsernameHint() {
    if (!profileUsernameHint) return;
    const nextAllowed = getNextUsernameChangeDate(cachedProfileMeta.usernameUpdatedAt || cachedProfileMeta.usernameCreatedAt || '');
    if (nextAllowed && nextAllowed.getTime() > Date.now()) {
      profileUsernameHint.textContent = `At least 4 characters. Username changes unlock again on ${nextAllowed.toLocaleDateString()}.`;
      return;
    }
    profileUsernameHint.textContent = 'At least 4 characters. You can change it once every 3 months.';
  }

  function setProfileBioValue(value) {
    const text = String(value || '').trim();
    profileBio.textContent = text || PROFILE_BIO_PLACEHOLDER;
    profileBio.classList.toggle('is-placeholder', !text);
  }

  function getCachedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const session = raw ? JSON.parse(raw) : null;
      if (!session?.loggedIn) return null;
      if (session.expiresAt && Date.now() > session.expiresAt) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getSession() {
    return getCachedSession();
  }

  function friendlyError(err) {
    const map = {
      // Email / password
      'auth/email-already-in-use': 'An account with this email already exists. Please sign in instead.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/wrong-password': 'Incorrect email or password. Please try again.',
      'auth/user-not-found': 'Incorrect email or password. Please try again.',
      'auth/invalid-credential': 'Incorrect email or password. Please try again.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      // Rate limiting / access
      'auth/too-many-requests': 'Too many sign-in attempts. Please wait a few minutes and try again.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      // Google / OAuth
      'auth/popup-blocked': 'Google sign-in popup was blocked. Please allow pop-ups for this site and try again.',
      'auth/popup-closed-by-user': null,
      'auth/cancelled-popup-request': null,
      'auth/account-exists-with-different-credential': 'An account already exists with this email. Please sign in with the method you used originally.',
      'auth/credential-already-in-use': 'This Google account is already linked to a different user.',
      'auth/unauthorized-domain': 'Google sign-in is not authorized for this domain. Please contact support.',
      'auth/operation-not-allowed': 'Google sign-in is not enabled for this app. Please contact support.',
      // Configuration
      'auth/invalid-api-key': 'Firebase configuration error. Please contact support.',
      'auth/app-not-authorized': 'This app is not authorized to use Firebase Authentication. Please contact support.',
      'auth/web-storage-unsupported': 'Your browser has cookies or storage disabled. Please enable them and try again.',
      // Network / general
      'auth/network-request-failed': 'Network error. Please check your connection and try again.',
      'auth/timeout': 'Sign-in timed out. Please try again.',
      'auth/internal-error': 'An authentication error occurred. Please try again.',
      'auth/requires-recent-login': 'Please sign out and sign back in before making this change.'
    };
    const msg = map[err.code];
    if (msg === null) return null;
    return msg || `Sign-in failed (${err.code || 'unknown error'}). Please try again.`;
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Queue a welcome email sequence in Firestore for backend/webhook consumption
  async function enqueueWelcomeEmail(user) {
    try {
      await setDoc(doc(db, 'users', user.uid, 'emailQueue', 'welcome'), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || '',
        sequence: 'welcome',
        status: 'pending',
        createdAt: new Date().toISOString(),
        steps: [
          { step: 'welcome',    sendAfterHours: 0,   sent: false },
          { step: 'tips',       sendAfterHours: 72,  sent: false },
          { step: 'engagement', sendAfterHours: 168, sent: false },
        ],
      });
    } catch { /* best-effort — never block signup */ }
  }

  // Update login/retention stats in user profile on each sign-in
  async function trackRetention(firebaseUser) {
    try {
      const ref = doc(db, 'users', firebaseUser.uid, 'profile', 'data');
      const snap = await getDoc(ref);
      const profile = snap.exists() ? snap.data() : {};

      const now = new Date();
      const signupDate = profile.createdAt ? new Date(profile.createdAt) : now;
      const daysSinceSignup = Math.floor((now - signupDate) / 86_400_000);

      const updates = {
        lastActiveAt: now.toISOString(),
        loginCount: (profile.loginCount || 0) + 1,
      };

      if (daysSinceSignup >= 1 && !profile.retention_d1) {
        updates.retention_d1 = now.toISOString();
        Telemetry.track('retention_d1', { daysSinceSignup });
      }
      if (daysSinceSignup >= 7 && !profile.retention_d7) {
        updates.retention_d7 = now.toISOString();
        Telemetry.track('retention_d7', { daysSinceSignup });
      }
      if (daysSinceSignup >= 30 && !profile.retention_d30) {
        updates.retention_d30 = now.toISOString();
        Telemetry.track('retention_d30', { daysSinceSignup });
      }

      await setDoc(ref, updates, { merge: true });
    } catch { /* silently ignore — tracking is non-blocking */ }
  }

  return { init, getSession, signOut: handleSignOut };
})();
