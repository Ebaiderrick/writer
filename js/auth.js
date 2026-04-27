import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { showHome, showAuth, renderHome, customAlert, customConfirm } from './ui.js';
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
  let switchCtn, switchC1, switchC2, switchCircle, switchBtns, aContainer, bContainer;
  let otpOverlay, otpBoxes, otpSubmit, otpResend, otpError, otpDisplay;
  let signupForm, signinForm;
  let signupNameInput, signupEmailInput, signupPassInput, signupPass2Input;
  let signinEmailInput, signinPassInput;

  let generatedOTP = '';
  let pendingSignup = null;

  function init() {
    switchCtn = document.querySelector('#switch-cnt');
    switchC1 = document.querySelector('#switch-c1');
    switchC2 = document.querySelector('#switch-c2');
    switchCircle = document.querySelectorAll('.switch__circle');
    switchBtns = document.querySelectorAll('.switch-btn');
    aContainer = document.querySelector('#a-container');
    bContainer = document.querySelector('#b-container');

    otpOverlay = document.getElementById('otp-overlay');
    otpBoxes = document.querySelectorAll('.otp-box');
    otpSubmit = document.getElementById('otp-submit');
    otpResend = document.getElementById('otp-resend');
    otpError = document.getElementById('otp-error');
    otpDisplay = document.getElementById('otp-email-display');

    signupForm = document.getElementById('signup-form');
    signinForm = document.getElementById('signin-form');
    signupNameInput = document.getElementById('signup-name');
    signupEmailInput = document.getElementById('signup-email');
    signupPassInput = document.getElementById('signup-pass');
    signupPass2Input = document.getElementById('signup-pass2');
    signinEmailInput = document.getElementById('signin-email');
    signinPassInput = document.getElementById('signin-pass');

    if (!signupForm || !signinForm) return;

    // Init EmailJS with public key
    if (window.emailjs) window.emailjs.init(EMAILJS_PUBLIC_KEY);

    // Handle Google redirect result (fires after returning from Google OAuth)
    getRedirectResult(auth).then(result => {
      // onAuthStateChanged handles the session when result.user exists
    }).catch(err => {
      console.error('Google redirect result error:', err.code, err);
      if (err.code && err.code !== 'auth/cancelled-popup-request') {
        customAlert(friendlyError(err));
      }
    });

    switchBtns.forEach(btn => btn.addEventListener('click', changeForm));

    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        box.classList.toggle('filled', box.value !== '');
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
          b.classList.toggle('filled', Boolean(b.value));
        });
        otpBoxes[Math.min(pasted.length, otpBoxes.length - 1)].focus();
      });
    });

    otpSubmit.addEventListener('click', verifyOTP);
    otpResend.addEventListener('click', resendOTP);
    signupForm.addEventListener('submit', handleSignUp);
    signinForm.addEventListener('submit', handleSignIn);

    document.getElementById('google-signup')?.addEventListener('click', handleGoogleSignIn);
    document.getElementById('google-signin')?.addEventListener('click', handleGoogleSignIn);
    document.getElementById('demo-login-btn')?.addEventListener('click', handleDemoLogin);
    document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);
    document.getElementById('homeSignOutBtn')?.addEventListener('click', handleSignOut);

    onAuthStateChanged(auth, async firebaseUser => {
      if (firebaseUser) {
        cacheSession(firebaseUser);
        await ensureUsersByEmail(firebaseUser);
        await syncProjectsOnLogin(firebaseUser.uid);
        if (refs.authView && !refs.authView.hidden) showHome();
        renderHome();
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

  function changeForm() {
    switchCtn.classList.add('is-gx');
    setTimeout(() => switchCtn.classList.remove('is-gx'), 1500);
    switchCtn.classList.toggle('is-txr');
    switchCircle[0].classList.toggle('is-txr');
    switchCircle[1].classList.toggle('is-txr');
    switchC1.classList.toggle('is-hidden');
    switchC2.classList.toggle('is-hidden');
    aContainer.classList.toggle('is-txl');
    bContainer.classList.toggle('is-txl');
    bContainer.classList.toggle('is-z200');
    aContainer.classList.toggle('is-hidden-form');
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
    const email = normalizeEmail(signinEmailInput.value);
    const password = signinPassInput.value;

    if (!isValidEmail(email)) return customAlert('Please enter a valid email.');
    if (!password) return customAlert('Please enter your password.');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      signinForm.reset();
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
    clearSession();
    try { await firebaseSignOut(auth); } catch { /* ignore */ }
    showAuth();
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
    otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
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
      otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
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
    otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
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
