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

  // Mouse tracking for reactive landing page background
  document.addEventListener("mousemove", (e) => {
    // Global mouse tracking
    body.style.setProperty('--mouse-x', e.clientX + 'px');
    body.style.setProperty('--mouse-y', e.clientY + 'px');

    // Button-relative mouse tracking for reactive aura
    const btn = document.getElementById('newProjectBtn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const btnX = e.clientX - rect.left;
      const btnY = e.clientY - rect.top;
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
