import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { showHome, showAuth, renderHome, setTheme, customAlert, customConfirm } from './ui.js';
import { state } from './config.js';
import { refs } from './dom.js';
import {
  fetchCloudProjects,
  importLocalProjectsToCloud,
  setProjectsFromCloud
} from './project.js';
import { initCollaboration, cleanupCollaboration } from './collaborate.js';

const SESSION_KEY = 'eyawriter_session';
const EMAILJS_SERVICE = 'service_j18y8zo';
const EMAILJS_TEMPLATE = 'template_6qr97mn';
const EMAILJS_PUBLIC_KEY = 'VI5qc4g4cH9d0vpvr';

const googleProvider = new GoogleAuthProvider();

export const Auth = (() => {
  let tabBtns, forms, themeBtns, html;
  let otpOverlay, otpBoxes, otpSubmit, otpResend, otpError, otpDisplay, otpCancel;
  let forgotOverlay, forgotForm, forgotEmailInput, forgotCancel, forgotLink;
  let signupForm, loginForm;
  let signupNameInput, signupEmailInput, signupPassInput, signupPass2Input;
  let loginEmailInput, loginPassInput;

  // Profile Popup Elements
  let profilePopup, profileClose, profileTriggerBtns;
  let profileImg, profileName, profileEmail, profileBio, profileWordCount;
  let profileEditBtn, profileSignOutBtn;
  let profileUpload, profileUploadBtn;
  let originalBio = '';
  let pendingImageBase64 = null;
  let isEditMode = false;
  let isModified = false;

  let generatedOTP = '';
  let pendingSignup = null;

  function init() {
    tabBtns = document.querySelectorAll('.tab-btn');
    forms = document.querySelectorAll('.auth-form');
    themeBtns = document.querySelectorAll('.theme-btn');
    html = document.documentElement;

    otpOverlay = document.getElementById('otp-modal-overlay');
    otpBoxes = document.querySelectorAll('.otp-field');
    otpSubmit = document.getElementById('otp-submit-btn');
    otpResend = document.getElementById('otp-resend-btn');
    otpError = document.getElementById('otp-error');
    otpDisplay = document.getElementById('otp-email-display');
    otpCancel = document.getElementById('otp-cancel-btn');

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

    // Init EmailJS with public key
    if (window.emailjs) window.emailjs.init(EMAILJS_PUBLIC_KEY);

    // Handle Google redirect result
    getRedirectResult(auth).catch(err => {
      console.error('Google redirect result error:', err.code, err);
      if (err.code && err.code !== 'auth/cancelled-popup-request') {
        customAlert(friendlyError(err));
      }
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

    // OTP box focus management
    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
      });
      box.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData)
          .getData('text').replace(/\D/g, '').slice(0, otpBoxes.length);
        otpBoxes.forEach((b, idx) => {
          b.value = pasted[idx] || '';
        });
        otpBoxes[Math.min(pasted.length, otpBoxes.length - 1)].focus();
      });
    });

    otpSubmit.addEventListener('click', verifyOTP);
    otpResend.addEventListener('click', resendOTP);
    otpCancel.addEventListener('click', () => otpOverlay.classList.remove('active'));

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
    document.getElementById('demo-login-btn')?.addEventListener('click', handleDemoLogin);

    // Profile Listeners
    profileTriggerBtns.forEach(btn => btn.addEventListener('click', openProfilePopup));
    profileClose?.addEventListener('click', closeProfilePopup);
    profilePopup?.addEventListener('click', e => { if (e.target === profilePopup) closeProfilePopup(); });
    profileEditBtn?.addEventListener('click', handleEditToggle);
    profileSignOutBtn?.addEventListener('click', handleSignOut);
    profileUploadBtn?.addEventListener('click', () => profileUpload.click());
    profileUpload?.addEventListener('change', handleImageUpload);
    profileBio?.addEventListener('input', () => {
      updateBioWordCount();
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
        cacheSession(firebaseUser);
        await ensureUsersByEmail(firebaseUser);
        await syncProjectsOnLogin(firebaseUser.uid);
        await loadUserProfile(firebaseUser);
        if (refs.authView && !refs.authView.hidden) showHome();
        renderHome();
        updateTriggerUI(firebaseUser);
        initCollaboration();
      } else {
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
        }
      }
    });
  }

  async function ensureUsersByEmail(firebaseUser) {
    const emailKey = firebaseUser.email.toLowerCase();
    const ref = doc(db, 'usersByEmail', emailKey);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email
      });
    }
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
    if (password !== password2) return customAlert('Passwords do not match.');

    pendingSignup = { name, email, password };
    await sendOTP(email, name);
    showOTPOverlay(email);
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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google sign-in error:', err.code, err);
      if (err.code === 'auth/popup-blocked') {
        // Popup blocked — fall back to redirect
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr) {
          console.error('Google redirect error:', redirectErr.code, redirectErr);
          customAlert(friendlyError(redirectErr));
        }
      } else if (err.code !== 'auth/popup-closed-by-user') {
        customAlert(friendlyError(err));
      }
    }
  }

  function handleDemoLogin() {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: 'user_demo123',
      email: 'demo@eyawriter.com',
      name: 'Demo Writer',
      loggedIn: true,
      isDemoSession: true,
      loggedInAt: new Date().toISOString()
    }));
    showHome();
    renderHome();
  }

  async function handleSignOut() {
    const confirmed = await customConfirm('Sign out of your account?', 'Sign Out');
    if (!confirmed) return;
    closeProfilePopup();
    clearSession();
    try { await firebaseSignOut(auth); } catch { /* ignore */ }
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
    const text = profileBio.textContent || '';
    const words = countWords(text);
    profileWordCount.textContent = words;
    if (words > 100) {
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
      originalBio = profileBio.textContent;
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
    profileBio.textContent = originalBio;
    setEditBtnMode('edit');
    updateBioWordCount();
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
    if (!user) return;

    const text = profileBio.textContent || '';
    if (countWords(text) > 100) {
      customAlert('Bio cannot exceed 100 words.');
      return;
    }

    profileBio.contentEditable = 'false';
    profileEditBtn.disabled = true;
    profileEditBtn.querySelector('span').textContent = 'Saving…';

    try {
      const bio = profileBio.textContent;
      const data = { bio };

      if (pendingImageBase64) {
        data.photoURL = pendingImageBase64;
        await updateProfile(user, { photoURL: pendingImageBase64 });
      }

      await setDoc(doc(db, 'users', user.uid, 'profile'), data, { merge: true });

      pendingImageBase64 = null;
      originalBio = bio;
      isEditMode = false;
      isModified = false;
      profileEditBtn.disabled = false;
      setEditBtnMode('edit');
      profileBio.textContent = bio || 'Tell us about yourself...';
      if (data.photoURL) profileImg.src = data.photoURL;

      updateBioWordCount();
      updateTriggerUI(user);
    } catch (err) {
      console.error('Bio save failed', err);
      profileEditBtn.disabled = false;
      setEditBtnMode('save');
      profileBio.contentEditable = 'true';
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
    const user = auth.currentUser || firebaseUser;
    const displayName = user.displayName || 'User';
    profileName.textContent = displayName;
    profileEmail.textContent = user.email;

    const fallbackAvatar = generateInitialsAvatar(displayName);

    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'profile'));
      const profileData = snap.exists() ? snap.data() : {};

      const photo = profileData.photoURL || user.photoURL;
      if (photo) {
        profileImg.src = photo;
        profileImg.onerror = () => { profileImg.src = fallbackAvatar; profileImg.onerror = null; };
      } else {
        profileImg.src = fallbackAvatar;
      }

      profileBio.textContent = profileData.bio || 'Tell us about yourself...';
      updateBioWordCount();
    } catch (err) {
      console.error('Profile load failed', err);
      profileImg.src = fallbackAvatar;
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
    if (homeName) homeName.textContent = name;
  }

  async function sendOTP(email, name) {
    generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    if (window.emailjs) {
      try {
        await window.emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
          to_email: email,
          to_name: name,
          otp: generatedOTP
        });
      } catch (err) {
        console.error('EmailJS send failed', err);
        console.warn('OTP (fallback):', generatedOTP);
      }
    } else {
      console.warn('EmailJS not loaded — OTP:', generatedOTP);
    }
  }

  function showOTPOverlay(email) {
    otpDisplay.textContent = email;
    otpBoxes.forEach(b => { b.value = ''; });
    otpError.textContent = '';
    otpOverlay.classList.add('active');
    otpBoxes[0].focus();
  }

  async function verifyOTP() {
    if (!pendingSignup) {
      otpError.textContent = 'Session expired. Please try again.';
      otpOverlay.classList.remove('active');
      return;
    }

    const entered = [...otpBoxes].map(b => b.value).join('');
    if (entered.length < otpBoxes.length) {
      otpError.textContent = 'Please enter all 6 digits.';
      return;
    }
    if (entered !== generatedOTP) {
      otpError.textContent = 'Incorrect code. Try again.';
      otpBoxes.forEach(b => { b.value = ''; });
      otpBoxes[0].focus();
      return;
    }

    const { name, email, password } = pendingSignup;
    pendingSignup = null;
    otpOverlay.classList.remove('active');
    otpError.textContent = '';

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      await setDoc(doc(db, 'users', credential.user.uid, 'profile'), {
        uid: credential.user.uid,
        name,
        email,
        createdAt: new Date().toISOString()
      });
      await setDoc(doc(db, 'usersByEmail', email.toLowerCase()), {
        uid: credential.user.uid,
        name
      });
      signupForm.reset();
    } catch (err) {
      console.error('Sign-up error:', err.code, err);
      customAlert(friendlyError(err));
    }
  }

  async function resendOTP() {
    if (!pendingSignup) {
      otpError.textContent = 'Start signup again to request a new code.';
      return;
    }
    await sendOTP(pendingSignup.email, pendingSignup.name);
    otpBoxes.forEach(b => { b.value = ''; });
    otpError.textContent = 'New code sent!';
    otpBoxes[0].focus();
    setTimeout(() => { otpError.textContent = ''; }, 2500);
  }

  function cacheSession(firebaseUser) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      name: firebaseUser.displayName || firebaseUser.email,
      loggedIn: true,
      loggedInAt: new Date().toISOString()
    }));
  }

  function getCachedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const session = raw ? JSON.parse(raw) : null;
      return session?.loggedIn ? session : null;
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
      'auth/email-already-in-use': 'An account with this email already exists. Please sign in instead.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/user-not-found': 'No account found for this email. Please sign up first.',
      'auth/invalid-credential': 'Incorrect email or password. Please try again.',
      'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/network-request-failed': 'Network error. Please check your connection.',
      'auth/popup-blocked': 'Pop-up was blocked. Please allow pop-ups and try again.'
    };
    return map[err.code] || 'Something went wrong. Please try again.';
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  return { init, getSession, signOut: handleSignOut };
})();
