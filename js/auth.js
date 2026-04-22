import { showHome } from './ui.js';

export const Auth = (() => {
  /* Panel switch */
  const switchCtn = document.querySelector("#switch-cnt");
  const switchC1 = document.querySelector("#switch-c1");
  const switchC2 = document.querySelector("#switch-c2");
  const switchCircle = document.querySelectorAll(".switch__circle");
  const switchBtns = document.querySelectorAll(".switch-btn");
  const aContainer = document.querySelector("#a-container");
  const bContainer = document.querySelector("#b-container");

  /* OTP */
  const otpOverlay = document.getElementById("otp-overlay");
  const otpBoxes = document.querySelectorAll(".otp-box");
  const otpSubmit = document.getElementById("otp-submit");
  const otpResend = document.getElementById("otp-resend");
  const otpError = document.getElementById("otp-error");
  const otpDisplay = document.getElementById("otp-email-display");

  let generatedOTP = "";
  let otpEmail = "";

  function init() {
    switchBtns.forEach(btn => btn.addEventListener("click", changeForm));

    // OTP input navigation
    otpBoxes.forEach((box, i) => {
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(-1);
        box.classList.toggle("filled", box.value !== "");
        if (box.value && i < otpBoxes.length - 1) {
          otpBoxes[i + 1].focus();
        }
      });

      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !box.value && i > 0) {
          otpBoxes[i - 1].focus();
        }
      });

      box.addEventListener("paste", (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
        [...pasted].slice(0, 6).forEach((char, j) => {
          if (otpBoxes[j]) {
            otpBoxes[j].value = char;
            otpBoxes[j].classList.add("filled");
          }
        });
        const next = Math.min(pasted.length, 5);
        otpBoxes[next].focus();
      });
    });

    otpSubmit.addEventListener("click", verifyOTP);
    otpResend.addEventListener("click", resendOTP);

    // Forms
    document.getElementById("signup-form").addEventListener("submit", handleSignUp);
    document.getElementById("signin-form").addEventListener("submit", handleSignIn);

    // Google buttons
    document.getElementById("google-signup").addEventListener("click", () => alert("Google flow simulated."));
    document.getElementById("google-signin").addEventListener("click", () => alert("Google flow simulated."));
  }

  function changeForm() {
    switchCtn.classList.add("is-gx");
    setTimeout(() => switchCtn.classList.remove("is-gx"), 600);

    switchCtn.classList.toggle("is-txr");
    switchCircle[0].classList.toggle("is-txr");
    switchCircle[1].classList.toggle("is-txr");
    switchC1.classList.toggle("is-hidden");
    switchC2.classList.toggle("is-hidden");
    aContainer.classList.toggle("is-txl");
    bContainer.classList.toggle("is-txl");
    bContainer.classList.toggle("is-z200");
    aContainer.classList.toggle("is-hidden-form");
  }

  function handleSignUp(e) {
    e.preventDefault();
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const pass = document.getElementById("signup-pass").value;
    const pass2 = document.getElementById("signup-pass2").value;

    if (!name) return alert("Please enter your name.");
    if (!isValidEmail(email)) return alert("Please enter a valid email.");
    if (pass.length < 6) return alert("Password must be at least 6 characters.");
    if (pass !== pass2) return alert("Passwords do not match.");

    showOTP(email);
  }

  function handleSignIn(e) {
    e.preventDefault();
    const email = document.getElementById("signin-email").value.trim();
    const pass = document.getElementById("signin-pass").value;

    if (!isValidEmail(email)) return alert("Please enter a valid email.");
    if (!pass) return alert("Please enter your password.");

    // Demo login
    loginSuccess(email);
  }

  function showOTP(email) {
    otpEmail = email;
    generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    otpDisplay.textContent = email;
    otpBoxes.forEach(b => { b.value = ""; b.classList.remove("filled"); });
    otpError.textContent = "";
    otpOverlay.classList.add("active");
    otpBoxes[0].focus();
    console.log("OTP (demo):", generatedOTP);
  }

  function verifyOTP() {
    const entered = [...otpBoxes].map(b => b.value).join("");
    if (entered.length < 6) {
      otpError.textContent = "Please enter all 6 digits.";
      return;
    }
    if (entered === generatedOTP) {
      otpError.textContent = "";
      otpOverlay.classList.remove("active");
      loginSuccess(otpEmail);
    } else {
      otpError.textContent = "Incorrect code. Try again.";
      otpBoxes.forEach(b => { b.value = ""; b.classList.remove("filled"); });
      otpBoxes[0].focus();
    }
  }

  function resendOTP() {
    generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    otpBoxes.forEach(b => { b.value = ""; b.classList.remove("filled"); });
    otpError.textContent = "New code sent!";
    console.log("New OTP (demo):", generatedOTP);
    otpBoxes[0].focus();
    setTimeout(() => { otpError.textContent = ""; }, 2500);
  }

  function loginSuccess(email) {
    localStorage.setItem("eyawriter_session", JSON.stringify({ email, loggedIn: true }));
    document.getElementById("authView").hidden = true;
    showHome();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  return { init };
})();
