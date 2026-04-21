import { showHome } from './ui.js';

const USERS_STORAGE_KEY = 'eyawriter_users';
const SESSION_STORAGE_KEY = 'eyawriter_session';

export const Auth = (() => {
  /* Panel switch */
  let switchCtn, switchC1, switchC2, switchCircle, switchBtns, aContainer, bContainer;

  /* OTP */
  let otpOverlay, otpBoxes, otpSubmit, otpResend, otpError, otpDisplay;

  let signupForm, signinForm, signupNameInput, signupEmailInput, signupPassInput, signupPass2Input, signinEmailInput, signinPassInput;

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

    switchBtns.forEach((btn) => btn.addEventListener('click', changeForm));

    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        box.classList.toggle('filled', box.value !== '');
        if (box.value && i < otpBoxes.length - 1) {
          otpBoxes[i + 1].focus();
        }
      });

      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          otpBoxes[i - 1].focus();
        }
      });

      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData)
          .getData('text')
          .replace(/\D/g, '')
          .slice(0, otpBoxes.length);

        otpBoxes.forEach((otpBox, index) => {
          otpBox.value = pasted[index] || '';
          otpBox.classList.toggle('filled', Boolean(otpBox.value));
        });

        const nextIndex = Math.min(pasted.length, otpBoxes.length - 1);
        otpBoxes[nextIndex].focus();
      });
    });

    otpSubmit.addEventListener('click', verifyOTP);
    otpResend.addEventListener('click', resendOTP);

    signupForm.addEventListener('submit', handleSignUp);
    signinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSignIn(e);
    });

    document.getElementById('google-signup').addEventListener('click', () => alert('Google flow is not connected yet. Please sign up with email for now.'));
    document.getElementById('google-signin').addEventListener('click', () => alert('Google flow is not connected yet. Please sign in with email for now.'));
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

  function handleSignUp(e) {
    e.preventDefault();

    const name = signupNameInput.value.trim();
    const email = normalizeEmail(signupEmailInput.value);
    const password = signupPassInput.value;
    const passwordRepeat = signupPass2Input.value;

    if (!name) return alert('Please enter your name.');
    if (!isValidEmail(email)) return alert('Please enter a valid email.');
    if (password.length < 6) return alert('Password must be at least 6 characters.');
    if (password !== passwordRepeat) return alert('Passwords do not match.');
    if (findUserByEmail(email)) return alert('An account with this email already exists. Please sign in instead.');

    pendingSignup = {
      id: createId('user'),
      name,
      email,
      password,
      createdAt: new Date().toISOString()
    };

    showOTP(email);
  }

  function handleSignIn(e) {
    if (e && e.preventDefault) e.preventDefault();

    const email = normalizeEmail(signinEmailInput.value);
    const password = signinPassInput.value;

    if (!isValidEmail(email)) return alert('Please enter a valid email.');
    if (!password) return alert('Please enter your password.');

    const user = findUserByEmail(email);
    if (!user) return alert('No account was found for this email. Please sign up first.');
    if (user.password !== password) return alert('Incorrect password. Please try again.');

    loginSuccess(user);
  }

  function showOTP(email) {
    generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    otpDisplay.textContent = email;
    otpBoxes.forEach((box) => {
      box.value = '';
      box.classList.remove('filled');
    });
    otpError.textContent = '';
    otpOverlay.classList.add('active');
    otpBoxes[0].focus();
    console.log('OTP (demo):', generatedOTP);
  }

  function verifyOTP() {
    if (!pendingSignup) {
      otpError.textContent = 'Your signup session expired. Please try again.';
      otpOverlay.classList.remove('active');
      return;
    }

    const entered = [...otpBoxes].map((box) => box.value).join('');
    if (entered.length < otpBoxes.length) {
      otpError.textContent = 'Please enter all 6 digits.';
      return;
    }

    if (entered !== generatedOTP) {
      otpError.textContent = 'Incorrect code. Try again.';
      otpBoxes.forEach((box) => {
        box.value = '';
        box.classList.remove('filled');
      });
      otpBoxes[0].focus();
      return;
    }

    const users = getUsers();
    const existingUser = users.find((user) => user.email === pendingSignup.email);
    if (existingUser) {
      otpOverlay.classList.remove('active');
      pendingSignup = null;
      otpError.textContent = '';
      alert('An account with this email already exists. Please sign in instead.');
      focusSignIn(existingUser.email);
      return;
    }

    const user = {
      ...pendingSignup,
      verifiedAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);
    pendingSignup = null;
    otpOverlay.classList.remove('active');
    otpError.textContent = '';
    signupForm.reset();
    loginSuccess(user);
  }

  function resendOTP() {
    if (!pendingSignup) {
      otpError.textContent = 'Start signup again to request a new code.';
      return;
    }

    generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    otpBoxes.forEach((box) => {
      box.value = '';
      box.classList.remove('filled');
    });
    otpError.textContent = 'New code sent!';
    console.log('New OTP (demo):', generatedOTP);
    otpBoxes[0].focus();
    setTimeout(() => {
      otpError.textContent = '';
    }, 2500);
  }

  function loginSuccess(user) {
    const session = {
      userId: user.id,
      email: user.email,
      name: user.name,
      loggedIn: true,
      loggedInAt: new Date().toISOString()
    };

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    signinForm.reset();
    if (otpOverlay) otpOverlay.classList.remove('active');
    showHome();
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;

      const session = JSON.parse(raw);
      const email = normalizeEmail(session?.email);
      const user = findUserByEmail(email);
      if (!user) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }

      return {
        ...session,
        email: user.email,
        name: user.name,
        userId: user.id,
        loggedIn: true
      };
    } catch (error) {
      console.error('Unable to restore session', error);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  function getUsers() {
    try {
      const raw = localStorage.getItem(USERS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed
            .filter((user) => user && typeof user.email === 'string')
            .map((user) => ({
              ...user,
              email: normalizeEmail(user.email),
              name: String(user.name || '').trim()
            }))
        : [];
    } catch (error) {
      console.error('Unable to load saved users', error);
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  }

  function findUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    return getUsers().find((user) => user.email === normalizedEmail) || null;
  }

  function focusSignIn(email = '') {
    const isSignUpVisible = !switchC1.classList.contains('is-hidden');
    if (isSignUpVisible) {
      changeForm();
    }
    signinEmailInput.value = email;
    signinPassInput.value = '';
    signinEmailInput.focus();
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function createId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  return { init, getSession };
})();
