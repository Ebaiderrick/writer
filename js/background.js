// Shuffle utility
const shuffle = (arr) => {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// Assign random blob colors
const assignBlobColors = (arr) => {
  [0, 1, 2, 3].forEach((i) => {
    const node = document.getElementById(`color-${i}`);
    if (node) {
      node.style.backgroundColor = arr[i];
    }
  });
};

// Define random colors array
// Using the colors provided by the user
const colors = ["#d1fae5", "#42b6c6", "#5eead4", "#d8b4fe", "#f3e8ff"];

export const initBackground = () => {
  const can = document.getElementById("color-base");
  const body = document.body;

  // Cache button rect to avoid frequent getBoundingClientRect calls
  let btnRect = null;
  const btn = document.getElementById('newProjectBtn');

  const updateBtnRect = () => {
    if (btn) btnRect = btn.getBoundingClientRect();
  };

  if (btn) {
    updateBtnRect();
    window.addEventListener('resize', updateBtnRect);
    window.addEventListener('scroll', updateBtnRect, true);
  }

  // Mouse tracking for reactive landing page background
  document.addEventListener("mousemove", (e) => {
    // Global mouse tracking
    body.style.setProperty('--mouse-x', e.clientX + 'px');
    body.style.setProperty('--mouse-y', e.clientY + 'px');

    // Button-relative mouse tracking for reactive aura
    if (btn && btnRect) {
      const btnX = e.clientX - btnRect.left;
      const btnY = e.clientY - btnRect.top;
      btn.style.setProperty('--btn-mouse-x', btnX + 'px');
      btn.style.setProperty('--btn-mouse-y', btnY + 'px');
    }
  });

  if (!can) return;

  const updateBackground = () => {
    // Skip if dark theme is active
    if (document.documentElement.getAttribute("data-theme") === "dark") {
      return;
    }

    // select a base color
    const baseColor = colors[Math.floor(Math.random() * colors.length)];

    // remove the base color from the array
    const blobColors = shuffle(colors.filter((color) => color !== baseColor));

    // set base color
    can.style.background = baseColor;

    // set blob colors
    assignBlobColors(blobColors);
  };

  // first run
  updateBackground();

  // keep on animating
  setInterval(updateBackground, 3000);
};
