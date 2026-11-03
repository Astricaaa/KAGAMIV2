const STORAGE_KEYS = {
  user: "kagami-user",
  account: "kagami-account-v1",
  accounts: "kagami-accounts-v1",
  profile: "kagami-profile",
  onboardingDraft: "kagami-onboarding-draft-v1",
  tracking: "kagami-tracking-v1",
  bodyModel: "kagami-body-model-v1",
  layout: "kagami-layout-v2",
  theme: "kagami-theme",
  hiddenPanels: "kagami-hidden-panels-v2",
  minimizedPanels: "kagami-minimized-panels",
  sidebarHidden: "kagami-sidebar-hidden",
  mathHeaderHidden: "kagami-math-header-hidden",
  settings: "kagami-settings-v1",
};
const USER_SCOPED_STORAGE_KEYS = new Set([
  STORAGE_KEYS.profile,
  STORAGE_KEYS.onboardingDraft,
  STORAGE_KEYS.tracking,
  STORAGE_KEYS.bodyModel,
  STORAGE_KEYS.layout,
  STORAGE_KEYS.theme,
  STORAGE_KEYS.hiddenPanels,
  STORAGE_KEYS.minimizedPanels,
  STORAGE_KEYS.sidebarHidden,
  STORAGE_KEYS.mathHeaderHidden,
  STORAGE_KEYS.settings,
]);

const PANEL_IDS = ["health", "study", "finance", "fun"];
const WINDOW_RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const screens = {
  intro: document.querySelector("#intro"),
  auth: document.querySelector("#auth"),
  onboarding: document.querySelector("#onboarding"),
  dashboard: document.querySelector("#dashboard"),
};

const onboardingSteps = [
  {
    key: "areas",
    label: "Tu vida",
    title: "Configura tu espacio",
    subtitle: "Elige las áreas que quieres tener presentes. Puedes seleccionar varias.",
    options: [
      ["health", "Salud", "Hábitos, bienestar físico y mental, sueño y más.", "heart"],
      ["finance", "Economía", "Gastos, ingresos, ahorro y metas financieras.", "wallet"],
      ["study", "Estudio", "Clases, tareas, exámenes y tiempo de aprendizaje.", "book"],
      ["fun", "Entretenimiento", "Tiempo libre, pasatiempos y momentos para disfrutar.", "sparkles"],
    ],
    multiple: true,
  },
  {
    key: "rhythm",
    label: "Tu ritmo",
    title: "Encuentra tu ritmo",
    subtitle: "Elige cómo quieres organizar tus preguntas y objetivos.",
    options: [
      ["gentle", "Suave: pasos pequeños y sin prisa"],
      ["balanced", "Equilibrado: estructura con espacio para adaptarte"],
      ["focused", "Enfocado: bloques para avanzar con intención"],
    ],
  },
  {
    key: "habit",
    label: "Tus objetivos",
    title: "Construye tu hábito",
    subtitle: "¿Qué hábito te gustaría desarrollar? Escribe un objetivo personal para empezar.",
  },
];

let questionIndex = 0;
let answers = {};
let editingProfile = false;
let authMode = "login";
let toastTimer;
let windowZIndex = 10;
let canvasContext;
let mathStrokes = [];
let undoneMathStrokes = [];
let activeMathStroke = null;
let mathAnswerText = "";
let mathAnswerProgress = 0;
let mathGraphScale = 1;
let mathGraphOffset = { x: 0, y: 0 };
let mathGraphPointer = null;
let mathRecognitionTimer;
let lastMathStrokeEndedAt = 0;
let activeMathSymbolId = "";

function getStored(key, fallback = null) {
  try {
    const scopedKey = getScopedStorageKey(key);
    const value = localStorage.getItem(scopedKey);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`No se pudo leer el dato local "${key}".`, error);
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    const scopedKey = getScopedStorageKey(key);
    localStorage.setItem(scopedKey, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`No se pudo guardar el dato local "${key}".`, error);
    showToast("No se pudieron guardar los cambios en este dispositivo.");
    return false;
  }
}

function removeStored(key) {
  try {
    const scopedKey = getScopedStorageKey(key);
    localStorage.removeItem(scopedKey);
    return true;
  } catch (error) {
    console.error(`No se pudo borrar el dato local "${key}".`, error);
    showToast("No se pudo borrar el progreso guardado en este dispositivo.");
    return false;
  }
}

function getScopedStorageKey(key) {
  if (!USER_SCOPED_STORAGE_KEYS.has(key)) return key;
  const session = getStored(STORAGE_KEYS.user);
  return session?.id ? `${key}:${encodeURIComponent(session.id)}` : key;
}

function createLocalAccountId() {
  return globalThis.crypto?.randomUUID?.() || `kagami-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function migrateLegacyUserData(account) {
  // Solo los datos antiguos con el mismo usuario se trasladan a su espacio aislado.
  const legacyAccount = getStored(STORAGE_KEYS.account);
  if (!legacyAccount || legacyAccount.name.trim().toLocaleLowerCase() !== account.name.trim().toLocaleLowerCase()) return true;
  try {
    USER_SCOPED_STORAGE_KEYS.forEach((key) => {
      const scopedKey = `${key}:${encodeURIComponent(account.id)}`;
      const legacyValue = localStorage.getItem(key);
      if (legacyValue !== null && localStorage.getItem(scopedKey) === null) {
        localStorage.setItem(scopedKey, legacyValue);
        localStorage.removeItem(key);
      }
    });
    return true;
  } catch (error) {
    console.error("No se pudieron transferir los datos del usuario local.", error);
    showToast("No se pudieron migrar los datos guardados de esta cuenta.");
    return false;
  }
}

function getLocalAccounts() {
  const accounts = getStored(STORAGE_KEYS.accounts);
  if (Array.isArray(accounts)) return accounts.filter((account) => account && typeof account.name === "string");
  const legacyAccount = getStored(STORAGE_KEYS.account);
  return legacyAccount && typeof legacyAccount.name === "string" ? [legacyAccount] : [];
}

function findLocalAccount(accounts, username) {
  const normalizedName = username.trim().toLocaleLowerCase();
  return accounts.find((account) => account.name.trim().toLocaleLowerCase() === normalizedName);
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("hidden", key !== name);
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function createPasswordCredential(password) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable.");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;
  return {
    algorithm: "PBKDF2-SHA-256",
    iterations,
    salt: btoa(String.fromCharCode(...salt)),
    hash: await derivePasswordHash(password, salt, iterations),
  };
}

async function verifyPassword(password, credential) {
  if (
    !globalThis.crypto?.subtle ||
    credential?.algorithm !== "PBKDF2-SHA-256" ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < 100000 ||
    credential.iterations > 1000000 ||
    typeof credential.salt !== "string" ||
    typeof credential.hash !== "string"
  ) return false;
  const salt = Uint8Array.from(atob(credential.salt), (character) => character.charCodeAt(0));
  const actual = await derivePasswordHash(password, salt, credential.iterations);
  if (actual.length !== credential.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ credential.hash.charCodeAt(index);
  }
  return difference === 0;
}

function startAuth() {
  showScreen("auth");
  document.querySelector("#username").focus();
}

document.querySelector("#start-button").addEventListener("click", () => {
  const button = document.querySelector("#start-button");
  button.classList.add("launching");
  window.setTimeout(startAuth, 700);
});

function configureAuthMode(mode) {
  authMode = mode;
  const form = document.querySelector("#auth-form");
  const title = document.querySelector("#auth-title");
  const subtitle = document.querySelector("#auth-subtitle");
  const submit = document.querySelector("#auth-submit");
  const create = document.querySelector("#create-account");
  const password = document.querySelector("#password");
  document.querySelector("#auth-error").textContent = "";
  password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  password.minLength = mode === "signup" ? 8 : 4;
  if (mode === "signup") {
    title.textContent = "Empecemos por ti.";
    subtitle.textContent = "Crea tu acceso a Kagami.";
    submit.innerHTML = "Crear mi cuenta <span>→</span>";
    create.textContent = "Ya tengo una cuenta";
  } else {
    title.textContent = "Qué gusto tenerte aquí.";
    subtitle.textContent = "Ingresa a tu espacio personal.";
    submit.innerHTML = "Entrar a mi espacio <span>→</span>";
    create.textContent = "Crear una cuenta";
  }
  form.dataset.mode = mode;
}

configureAuthMode("login");

document.querySelector("#create-account").addEventListener("click", () => {
  configureAuthMode(authMode === "signup" ? "login" : "signup");
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  const error = document.querySelector("#auth-error");
  if (!username || !password) {
    error.textContent = "Revisa tu usuario y contraseña para continuar.";
    return;
  }
  if (!password || (authMode === "signup" && password.length < 8)) {
    error.textContent = "La contraseña debe tener al menos 8 caracteres.";
    return;
  }
  const accounts = getLocalAccounts();
  let account = findLocalAccount(accounts, username);
  if (authMode === "signup" && account?.credential) {
    error.textContent = "Ya existe una cuenta con ese usuario. Inicia sesión.";
    return;
  }
  if (authMode === "login" && !account) {
    configureAuthMode("signup");
    error.textContent = "No existe una cuenta con ese usuario. Crea una cuenta para continuar.";
    return;
  }
  if (authMode === "login" && !account.credential) {
    error.textContent = "Esta cuenta necesita registrarse para configurar una contraseña.";
    return;
  }
  try {
    if (authMode === "signup") {
      const previousAccount = account;
      account = {
        ...(previousAccount || {}),
        name: username,
        created: previousAccount?.created || Date.now(),
        credential: await createPasswordCredential(password),
      };
      const existingIndex = previousAccount ? accounts.indexOf(previousAccount) : -1;
      if (existingIndex >= 0) accounts[existingIndex] = account;
      else accounts.push(account);
    } else if (!await verifyPassword(password, account.credential)) {
      error.textContent = "La contraseña no es correcta.";
      return;
    }
  } catch (credentialError) {
    console.error("No se pudo verificar o proteger la contraseña local.", credentialError);
    error.textContent = "No se pudo proteger la contraseña en este dispositivo. Inténtalo de nuevo.";
    return;
  }
  account.id = account.id || createLocalAccountId();
  const accountIndex = accounts.findIndex((entry) => entry === account || entry.name.trim().toLocaleLowerCase() === account.name.trim().toLocaleLowerCase());
  if (accountIndex >= 0) accounts[accountIndex] = account;
  if (!saveStored(STORAGE_KEYS.accounts, accounts)) {
    error.textContent = "No se pudo guardar la cuenta en este dispositivo.";
    return;
  }
  if (!migrateLegacyUserData(account)) return;
  if (!saveStored(STORAGE_KEYS.account, account)) {
    error.textContent = "No se pudo guardar la cuenta en este dispositivo.";
    return;
  }
  const sessionUser = { id: account.id, name: account.name, created: account.created };
  if (!saveStored(STORAGE_KEYS.user, sessionUser)) {
    error.textContent = "No se pudo iniciar la sesión en este dispositivo.";
    return;
  }
  const profile = getStored(STORAGE_KEYS.profile);
  if (profile && profile.onboardingVersion === 1 && profile.storageConsent) enterDashboard(account, profile);
  else {
    showScreen("onboarding");
    startOnboarding();
  }
});

function startOnboarding(profile = null) {
  const savedDraft = getStored(STORAGE_KEYS.onboardingDraft);
  const source = profile || (savedDraft && savedDraft.version === 1 && savedDraft.answers && savedDraft.answers.storageConsent ? savedDraft.answers : null);
  answers = source
    ? { ...source, areas: [...(source.areas || [])] }
    : { areas: [], rhythm: "balanced", habit: "", storageConsent: false };
  editingProfile = Boolean(profile);
  questionIndex = 0;
  renderQuestion();
}

function saveOnboardingDraft() {
  if (!answers.storageConsent) return false;
  return saveStored(STORAGE_KEYS.onboardingDraft, {
    version: 1,
    answers,
    updatedAt: new Date().toISOString(),
  });
}

function updateConsentVisibility() {
  const label = document.querySelector("#onboarding-consent-label");
  label.classList.toggle("hidden", questionIndex !== 0);
  document.querySelector("#onboarding-consent").checked = Boolean(answers.storageConsent);
}

function renderQuestion() {
  const question = onboardingSteps[questionIndex];
  const content = document.querySelector("#question-content");
  document.querySelector("#question-progress").textContent = `${questionIndex + 1} DE ${onboardingSteps.length}`;
  document.querySelectorAll(".onboarding-step").forEach((step, index) => {
    step.classList.toggle("active", index === questionIndex);
  });
  document.querySelector("#question-back").style.visibility = questionIndex === 0 ? "hidden" : "visible";
  document.querySelector("#question-next").innerHTML = questionIndex === onboardingSteps.length - 1 ? "Crear mi espacio <span>→</span>" : "Continuar <span>→</span>";
  document.querySelector("#question-error").textContent = "";
  content.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = question.title;
  const subtitle = document.createElement("p");
  subtitle.className = "question-subtitle";
  subtitle.textContent = question.subtitle;
  content.append(title, subtitle);

  if (question.options) {
    const options = document.createElement("div");
    options.className = "question-options";
    question.options.forEach(([value, label, description, iconName]) => {
      const selected = question.multiple ? (answers[question.key] || []).includes(value) : answers[question.key] === value;
      const option = document.createElement("button");
      option.type = "button";
      option.className = `question-option${selected ? " selected" : ""}`;
      option.dataset.answer = value;
      option.setAttribute("aria-pressed", String(selected));
      const icon = document.createElement("span");
      icon.className = `area-icon area-icon-${iconName || "default"}`;
      icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.6");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const iconPaths = {
        heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"],
        wallet: ["M3.5 6.5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h13", "M3.5 8h17v5h-5a2.5 2.5 0 0 0 0 5h5", "M15.5 15.5h.01"],
        book: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22.5z", "M4 5.5v17", "M8 7h8", "M8 11h7"],
        sparkles: ["m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z", "m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z", "M5 2v3", "M3.5 3.5h3"],
      };
      (iconPaths[iconName] || iconPaths.sparkles).forEach((pathData) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
      });
      icon.append(svg);
      const copy = document.createElement("span");
      copy.className = "area-copy";
      const heading = document.createElement("span");
      heading.className = "area-title";
      heading.textContent = label;
      const detail = document.createElement("span");
      detail.className = "area-description";
      detail.textContent = description || "";
      copy.append(heading, detail);
      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = selected ? "✓" : "";
      option.append(icon, copy, mark);
      option.addEventListener("click", () => {
        if (question.multiple) {
          const selectedValues = new Set(answers[question.key] || []);
          if (selectedValues.has(value)) selectedValues.delete(value);
          else selectedValues.add(value);
          answers[question.key] = [...selectedValues];
        } else {
          answers[question.key] = value;
        }
        saveOnboardingDraft();
        renderQuestion();
      });
      options.append(option);
    });
    content.append(options);
  } else {
    const label = document.createElement("label");
    label.className = "question-habit-label";
    label.htmlFor = "habit-input";
    label.textContent = "Mi primer hábito";
    const input = document.createElement("input");
    input.id = "habit-input";
    input.className = "question-input";
    input.type = "text";
    input.maxLength = 140;
    input.placeholder = "Por ejemplo: leer diez minutos cada día";
    input.value = answers.habit || "";
    input.required = true;
    input.addEventListener("input", () => {
      answers.habit = input.value;
      saveOnboardingDraft();
    });
    content.append(label, input);
  }
  updateConsentVisibility();
}

document.querySelector("#question-back").addEventListener("click", () => {
  if (questionIndex > 0) {
    questionIndex -= 1;
    renderQuestion();
  }
});

document.querySelector("#onboarding-consent").addEventListener("change", (event) => {
  answers.storageConsent = event.target.checked;
  if (answers.storageConsent) saveOnboardingDraft();
  else removeStored(STORAGE_KEYS.onboardingDraft);
  document.querySelector("#question-error").textContent = "";
});

document.querySelector("#question-next").addEventListener("click", () => {
  const question = onboardingSteps[questionIndex];
  const answer = answers[question.key];
  if (questionIndex === 0 && !answers.storageConsent) {
    document.querySelector("#question-error").textContent = "Acepta guardar el progreso en este dispositivo para continuar.";
    return;
  }
  if (!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === "string" && !answer.trim())) {
    document.querySelector("#question-error").textContent = questionIndex === 0
      ? "Selecciona al menos un espacio para continuar."
      : questionIndex === 1
        ? "Elige el ritmo que mejor se adapte a ti."
        : "Escribe el hábito que quieres desarrollar.";
    return;
  }
  if (questionIndex < onboardingSteps.length - 1) {
    saveOnboardingDraft();
    questionIndex += 1;
    renderQuestion();
    return;
  }
  const user = getStored(STORAGE_KEYS.account) || getStored(STORAGE_KEYS.user) || { name: "U1" };
  const profile = {
    ...answers,
    habit: answers.habit.trim(),
    onboardingVersion: 1,
    completedAt: new Date().toISOString(),
  };
  let tracking = getStored(STORAGE_KEYS.tracking);
  if (!tracking || !Array.isArray(tracking.questions) || !Array.isArray(tracking.records) || !Array.isArray(tracking.goals)) {
    if (editingProfile && tracking) {
      console.error("No se pudo actualizar el perfil porque los datos de seguimiento no tienen un formato válido.");
      showToast("No se pudo guardar el perfil porque el seguimiento local no es válido.");
      return;
    }
    tracking = createTrackingState();
  }
  tracking.preferences = {
    ...createTrackingState().preferences,
    ...(tracking.preferences || {}),
  };
  const existingGoal = editingProfile && profile.goalId
    ? tracking.goals.find((goal) => goal.id === profile.goalId)
    : null;
  const matchingInitialGoal = tracking.goals.find((goal) =>
    goal.type === "habit" && goal.title === profile.habit && !goal.questionId && !goal.target
  );
  const goal = existingGoal || matchingInitialGoal || createHabitGoal(profile.habit);
  goal.title = profile.habit;
  if (!tracking.goals.includes(goal)) tracking.goals.push(goal);
  tracking.preferences.areas = [...profile.areas];
  tracking.preferences.organizationMode = profile.rhythm;
  profile.goalId = goal.id;
  if (!saveStored(STORAGE_KEYS.tracking, tracking) || !saveStored(STORAGE_KEYS.profile, profile)) return;
  removeStored(STORAGE_KEYS.onboardingDraft);
  editingProfile = false;
  enterDashboard(user, profile);
});

function enterDashboard(user, profile) {
  showScreen("dashboard");
  renderProfileButton(user);
  setMathHeaderHidden(getStored(STORAGE_KEYS.mathHeaderHidden, false));
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  personalizeDashboard(profile);
  applyTheme(getStored(STORAGE_KEYS.theme, "dark"));
  applyLayout();
  const savedPanelVisibility = getStored(STORAGE_KEYS.hiddenPanels, null);
  applyHiddenPanels();
  if (savedPanelVisibility === null) openWindow("health");
  syncHealthModel();
  setSidebarHidden(getStored(STORAGE_KEYS.sidebarHidden, false));
  requestAnimationFrame(resizeInkCanvas);
}

function syncHealthModel() {
  const frame = document.querySelector("#health-model-frame");
  if (!frame.contentWindow) return;
  frame.contentWindow.postMessage({
    modelo3d: getStored(STORAGE_KEYS.bodyModel, {
      sex: "female",
      altura: 163,
      peso: 62,
      pulso: 70,
      color: "#c9a27e",
    }),
  }, "*");
}

function renderProfileButton(user) {
  const button = document.querySelector("#profile-button");
  document.querySelector("#workspace-user-name").textContent = user.name || "usuario";
  button.replaceChildren();
  button.setAttribute("aria-label", `Abrir perfil de ${user.name || "usuario"}`);
  if (typeof user.profileImage === "string" && user.profileImage.startsWith("data:image/")) {
    const image = document.createElement("img");
    image.src = user.profileImage;
    image.alt = "";
    button.append(image);
  } else {
    button.textContent = (user.name || "U").slice(0, 1).toUpperCase();
  }
}

function personalizeDashboard(profile) {
  const focus = profile.areas || profile.focus || [];
  const priority = focus[0];
  const healthMessages = {
    health: ["Una pausa también es progreso", "¿Ya tomaste un poco de agua hoy?"],
    balance: ["Regálate un momento de calma", "Respira. No todo tiene que ser ahora."],
    full: ["Tómate un respiro", "Un minuto para ti puede cambiar tu día."],
  };
  const health = healthMessages[priority] || ["Un momento para respirar", "Pausar también es avanzar."];
  document.querySelector("#health-reminder").textContent = health[0];
  document.querySelector("#health-detail").textContent = health[1];
  const studyNames = { language: "Practica un idioma", digital: "Explora algo digital", creative: "Deja fluir tu creatividad", personal: "Una habilidad para tu día" };
  document.querySelector("#study-goal").textContent = studyNames[profile.learning] || "Cada día, un poco más";
  document.querySelector("#study-detail").textContent = profile.pace === "gentle" ? "Con calma, un paso a la vez." : "Aprender a tu manera también cuenta.";
  document.querySelector("#finance-goal").textContent = focus.includes("finance") ? "Una meta a tu medida" : "Un futuro con intención";
  document.querySelector("#finance-detail").textContent = profile.routine === "full" ? "Empieza con un solo hábito que te dé claridad." : "Conocer tus hábitos es el primer paso para elegir.";
  const funCopy = {
    fun: ["Un rato para ti", "¿Qué te gustaría disfrutar hoy?"],
    balance: ["Un descanso que sí cuenta", "Haz espacio para algo que te haga bien."],
  };
  const fun = funCopy[priority] || ["Un rato para ti", "¿Qué te gustaría disfrutar hoy?"];
  document.querySelector("#fun-goal").textContent = fun[0];
  document.querySelector("#fun-detail").textContent = fun[1];
}

function applyTheme(theme) {
  const dashboard = screens.dashboard;
  dashboard.classList.remove("theme-dark", "theme-lavender");
  if (theme === "dark") dashboard.classList.add("theme-dark");
  if (theme === "lavender") dashboard.classList.add("theme-lavender");
  document.querySelector("#theme-select").value = theme;
  saveStored(STORAGE_KEYS.theme, theme);
}

function windowsAreaWidth(area) {
  const areaLeft = area.getBoundingClientRect().left;
  const rightInset = window.matchMedia("(max-width: 620px)").matches
    ? 8
    : window.innerWidth <= 850
      ? 17
      : Math.max(19, Math.min(47, window.innerWidth * 0.033));
  return Math.max(0, Math.min(area.clientWidth, window.innerWidth - areaLeft - rightInset));
}

function applyLayout() {
  const area = document.querySelector("#windows-area");
  const maxWidth = windowsAreaWidth(area);
  const maxHeight = area.clientHeight;
  const layout = getStored(STORAGE_KEYS.layout, {});
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    const position = layout[windowEl.dataset.window];
    if (!position) return;
    if (position.left != null) {
      const width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), position.width));
      const height = Math.min(maxHeight, Math.max(Math.min(190, maxHeight), position.height));
      windowEl.style.position = "absolute";
      windowEl.style.left = `${Math.max(0, Math.min(maxWidth - width, position.left))}px`;
      windowEl.style.top = `${Math.max(0, Math.min(maxHeight - height, position.top))}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    }
  });
}

function applyHiddenPanels() {
  const hiddenPanels = getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS);
  const minimizedPanels = getStored(STORAGE_KEYS.minimizedPanels, []);
  const taskbar = document.querySelector("#window-taskbar");
  taskbar.replaceChildren();
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    const panelId = windowEl.dataset.window;
    const isClosed = hiddenPanels.includes(panelId);
    const isMinimized = minimizedPanels.includes(panelId) && !isClosed;
    windowEl.hidden = isClosed || isMinimized;
    if (isMinimized) {
      const restoreButton = document.createElement("button");
      restoreButton.className = "taskbar-window";
      restoreButton.type = "button";
      restoreButton.dataset.restore = panelId;
      restoreButton.textContent = windowEl.querySelector("h2").textContent;
      restoreButton.setAttribute("aria-label", `Restaurar ${restoreButton.textContent}`);
      taskbar.append(restoreButton);
    }
    const nav = document.querySelector(`.nav-item[data-panel="${windowEl.dataset.window}"]`);
    nav?.classList.toggle("selected", !isClosed && !isMinimized);
  });
  document.querySelector("#show-all").checked = hiddenPanels.length === 0;
  taskbar.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", () => restoreWindow(button.dataset.restore));
  });
}

function focusWindow(windowEl) {
  document.querySelectorAll(".widget-window").forEach((item) => item.classList.remove("focused"));
  windowEl.classList.add("focused");
  windowEl.style.zIndex = `${++windowZIndex}`;
}

function positionWindow(windowEl, slot) {
  const area = document.querySelector("#windows-area");
  const width = windowsAreaWidth(area);
  const height = area.clientHeight;
  if (!width || !height) return;

  if (window.matchMedia("(max-width: 620px)").matches) {
    const windowWidth = Math.max(0, width - 12);
    const windowHeight = windowEl.dataset.window === "health"
      ? Math.max(220, height - 16)
      : Math.min(height - 16, Math.max(220, Math.min(430, height * 0.72)));
    windowEl.style.left = `${6 + slot * 7}px`;
    windowEl.style.top = `${8 + slot * 24}px`;
    windowEl.style.width = `${windowWidth}px`;
    windowEl.style.height = `${windowHeight}px`;
    return;
  }

  const gap = 12;
  const columns = width >= 600 ? 2 : 1;
  const rows = 2;
  const windowWidth = Math.min(windowEl.dataset.window === "health" ? 620 : 640, (width - gap * (columns - 1)) / columns);
  const windowHeight = windowEl.dataset.window === "health"
    ? Math.max(280, height - 16)
    : Math.min(350, (height - gap * (rows - 1)) / rows);
  const slotInPage = slot % (columns * rows);
  windowEl.style.left = `${(slotInPage % columns) * (windowWidth + gap)}px`;
  windowEl.style.top = `${Math.floor(slotInPage / columns) * (windowHeight + gap)}px`;
  windowEl.style.width = `${windowWidth}px`;
  windowEl.style.height = `${windowHeight}px`;
}

function openWindow(panelId) {
  const windowEl = document.querySelector(`#window-${panelId}`);
  document.querySelectorAll(".widget-window.maximized").forEach((otherWindow) => {
    if (otherWindow !== windowEl) setWindowMaximized(otherWindow, false);
  });
  const hiddenPanels = new Set(getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS));
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  hiddenPanels.delete(panelId);
  minimizedPanels.delete(panelId);
  if (!windowEl.style.width) {
    const slot = [...document.querySelectorAll(".widget-window")].filter((otherWindow) => otherWindow !== windowEl && !otherWindow.hidden).length;
    positionWindow(windowEl, slot);
  }
  saveStored(STORAGE_KEYS.hiddenPanels, [...hiddenPanels]);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  windowEl.hidden = false;
  applyHiddenPanels();
  focusWindow(windowEl);
}

function closeWindow(panelId) {
  const windowEl = document.querySelector(`#window-${panelId}`);
  if (windowEl.classList.contains("maximized")) setWindowMaximized(windowEl, false);
  const hiddenPanels = new Set(getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS));
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  hiddenPanels.add(panelId);
  minimizedPanels.delete(panelId);
  saveStored(STORAGE_KEYS.hiddenPanels, [...hiddenPanels]);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  applyHiddenPanels();
}

function minimizeWindow(panelId) {
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  minimizedPanels.add(panelId);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  applyHiddenPanels();
}

function restoreWindow(panelId) {
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  minimizedPanels.delete(panelId);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  openWindow(panelId);
}

function toggleMaximize(windowEl) {
  const willMaximize = !windowEl.classList.contains("maximized");
  if (willMaximize) {
    document.querySelectorAll(".widget-window.maximized").forEach((otherWindow) => {
      if (otherWindow !== windowEl) setWindowMaximized(otherWindow, false);
    });
  }
  setWindowMaximized(windowEl, willMaximize);
  focusWindow(windowEl);
}

function setWindowMaximized(windowEl, maximized) {
  windowEl.classList.toggle("maximized", maximized);
  const button = windowEl.querySelector("[data-maximize]");
  button.textContent = maximized ? "❐" : "□";
  button.title = maximized ? "Restaurar tamaño" : "Maximizar";
  button.setAttribute("aria-label", `${maximized ? "Restaurar" : "Maximizar"} ${windowEl.querySelector("h2").textContent}`);
}

function setSidebarHidden(hidden) {
  screens.dashboard.classList.toggle("sidebar-hidden", hidden);
  document.querySelector("#sidebar-toggle").setAttribute("aria-expanded", String(!hidden));
  document.querySelector("#sidebar-toggle").setAttribute("aria-label", hidden ? "Mostrar barra lateral" : "Ocultar barra lateral");
  document.querySelector(".sidebar").setAttribute("aria-hidden", String(hidden));
  saveStored(STORAGE_KEYS.sidebarHidden, hidden);
  requestAnimationFrame(fitWindowsToArea);
}

function fitWindowsToArea() {
  const area = document.querySelector("#windows-area");
  const areaWidth = windowsAreaWidth(area);
  if (!areaWidth || !area.clientHeight) return;
  const visibleWindows = [...document.querySelectorAll(".widget-window")].filter((windowEl) => !windowEl.hidden && !windowEl.classList.contains("maximized"));
  const mobile = window.matchMedia("(max-width: 620px)").matches;
  const savedLayouts = getStored(STORAGE_KEYS.layout, {});
  visibleWindows.forEach((windowEl, index) => {
    if (mobile) {
      const saved = savedLayouts[windowEl.dataset.window];
      if (windowEl.dataset.window === "health" && saved) {
        const width = Math.min(areaWidth, Math.max(Math.min(220, areaWidth), saved.width));
        const height = Math.max(220, area.clientHeight - 16);
        windowEl.style.left = `${Math.max(0, Math.min(areaWidth - width, saved.left))}px`;
        windowEl.style.top = "8px";
        windowEl.style.width = `${width}px`;
        windowEl.style.height = `${height}px`;
        return;
      }
      positionWindow(windowEl, index);
      return;
    }

    const saved = savedLayouts[windowEl.dataset.window];
    if (saved) {
      const width = Math.min(areaWidth, Math.max(Math.min(280, areaWidth), saved.width));
      const height = Math.min(area.clientHeight, Math.max(Math.min(190, area.clientHeight), saved.height));
      windowEl.style.left = `${Math.max(0, Math.min(areaWidth - width, saved.left))}px`;
      windowEl.style.top = `${Math.max(0, Math.min(area.clientHeight - height, saved.top))}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    } else {
      positionWindow(windowEl, index);
    }
  });
}

function resizeInkCanvas() {
  const canvas = document.querySelector("#canvas-ink");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  canvasContext = canvas.getContext("2d");
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  renderMathCanvas();
}

function clearInkCanvas() {
  mathStrokes = [];
  undoneMathStrokes = [];
  activeMathStroke = null;
  mathAnswerText = "";
  document.querySelector("#math-answer").textContent = "";
  document.querySelector("#math-status").textContent = "Pizarra limpia. Escribe una nueva operación.";
  renderMathCanvas();
  updateMathHistoryControls();
}

function updateMathHistoryControls() {
  document.querySelector("#math-undo").disabled = mathStrokes.length === 0;
  document.querySelector("#math-redo").disabled = undoneMathStrokes.length === 0;
}

function drawMathStroke(context, stroke) {
  if (!stroke.points.length) return;
  context.save();
  context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    context.globalAlpha = Math.max(0.15, first.pressure || 0.5);
    context.beginPath();
    context.arc(first.x, first.y, stroke.width * Math.max(0.35, first.pressure || 0.5) / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const current = stroke.points[index];
    const midpointX = (previous.x + current.x) / 2;
    const midpointY = (previous.y + current.y) / 2;
    context.beginPath();
    context.moveTo(index === 1 ? previous.x : (stroke.points[index - 2].x + previous.x) / 2, index === 1 ? previous.y : (stroke.points[index - 2].y + previous.y) / 2);
    context.quadraticCurveTo(previous.x, previous.y, midpointX, midpointY);
    context.lineWidth = stroke.width * Math.max(0.35, (previous.pressure + current.pressure) / 2);
    context.stroke();
  }
  const last = stroke.points[stroke.points.length - 1];
  context.beginPath();
  context.arc(last.x, last.y, stroke.width * Math.max(0.35, last.pressure) / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function renderMathCanvas() {
  const canvas = document.querySelector("#canvas-ink");
  if (!canvasContext || !canvas.width || !canvas.height) return;
  const ratio = canvas.width / Math.max(1, canvas.clientWidth);
  canvasContext.save();
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  canvasContext.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  mathStrokes.forEach((stroke) => drawMathStroke(canvasContext, stroke));
  if (activeMathStroke) drawMathStroke(canvasContext, activeMathStroke);
  if (mathAnswerText && mathAnswerProgress > 0) {
    const answer = `= ${mathAnswerText}`;
    const visibleAnswer = answer.slice(0, Math.ceil(answer.length * mathAnswerProgress));
    canvasContext.save();
    canvasContext.globalCompositeOperation = "source-over";
    canvasContext.fillStyle = document.body.classList.contains("math-light") ? "#20202b" : "#c5a0ff";
    canvasContext.font = '32px "Caveat", cursive';
    canvasContext.fillText(visibleAnswer, 28, Math.max(52, canvas.clientHeight - 28));
    canvasContext.restore();
  }
  canvasContext.restore();
}

function storeWindowLayout(windowEl) {
  if (windowEl.classList.contains("maximized")) return;
  const area = document.querySelector("#windows-area");
  const layout = getStored(STORAGE_KEYS.layout, {});
  const windowRect = windowEl.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  layout[windowEl.dataset.window] = {
    left: Math.round(windowRect.left - areaRect.left),
    top: Math.round(windowRect.top - areaRect.top),
    width: Math.round(windowRect.width),
    height: Math.round(windowRect.height),
  };
  saveStored(STORAGE_KEYS.layout, layout);
}

function resetLayout() {
  saveStored(STORAGE_KEYS.layout, {});
  saveStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS);
  saveStored(STORAGE_KEYS.minimizedPanels, []);
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    windowEl.removeAttribute("style");
    windowEl.classList.remove("maximized", "focused");
  });
  applyHiddenPanels();
  showToast("Lienzo y ventanas restablecidos.");
}

document.querySelectorAll(".widget-window").forEach((windowEl) => {
  WINDOW_RESIZE_DIRECTIONS.forEach((direction) => {
    const handle = document.createElement("span");
    handle.className = `window-resize-handle resize-${direction}`;
    handle.dataset.resize = direction;
    handle.setAttribute("aria-hidden", "true");
    windowEl.append(handle);
  });
});

document.querySelectorAll("[data-resize]").forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const windowEl = handle.closest(".widget-window");
    if (windowEl.classList.contains("maximized")) return;
    focusWindow(windowEl);

    const area = document.querySelector("#windows-area");
    const areaRect = area.getBoundingClientRect();
    const rect = windowEl.getBoundingClientRect();
    const initial = {
      left: rect.left - areaRect.left,
      top: rect.top - areaRect.top,
      width: rect.width,
      height: rect.height,
    };
    const direction = handle.dataset.resize;
    const areaWidth = windowsAreaWidth(area);
    const minWidth = Math.min(windowEl.dataset.window === "health" ? 220 : 280, areaWidth);
    const minHeight = Math.min(190, area.clientHeight);
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - event.clientX;
      const deltaY = moveEvent.clientY - event.clientY;
      let left = initial.left;
      let top = initial.top;
      let width = initial.width;
      let height = initial.height;

      if (direction.includes("e")) width = Math.max(minWidth, Math.min(areaWidth - left, initial.width + deltaX));
      if (direction.includes("s")) height = Math.max(minHeight, Math.min(area.clientHeight - top, initial.height + deltaY));
      if (direction.includes("w")) {
        width = Math.max(minWidth, Math.min(initial.left + initial.width, initial.width - deltaX));
        left = initial.left + initial.width - width;
      }
      if (direction.includes("n")) {
        height = Math.max(minHeight, Math.min(initial.top + initial.height, initial.height - deltaY));
        top = initial.top + initial.height - height;
      }

      windowEl.style.left = `${left}px`;
      windowEl.style.top = `${top}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      storeWindowLayout(windowEl);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
});

document.querySelectorAll("[data-drag-handle]").forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.matchMedia("(max-width: 620px)").matches) return;
    const windowEl = handle.closest(".widget-window");
    if (event.target.closest("button")) return;
    if (windowEl.classList.contains("maximized")) return;
    focusWindow(windowEl);
    const area = document.querySelector("#windows-area");
    const areaRect = area.getBoundingClientRect();
    const rect = windowEl.getBoundingClientRect();
    if (getComputedStyle(windowEl).position !== "absolute") {
      windowEl.style.position = "absolute";
      windowEl.style.left = `${rect.left - areaRect.left}px`;
      windowEl.style.top = `${rect.top - areaRect.top}px`;
      windowEl.style.width = `${rect.width}px`;
      windowEl.style.height = `${rect.height}px`;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const initialLeft = parseFloat(windowEl.style.left);
    const initialTop = parseFloat(windowEl.style.top);
    const areaWidth = windowsAreaWidth(area);
    windowEl.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      const left = Math.max(0, Math.min(areaWidth - windowEl.offsetWidth, initialLeft + moveEvent.clientX - startX));
      const top = Math.max(0, Math.min(area.clientHeight - 55, initialTop + moveEvent.clientY - startY));
      windowEl.style.left = `${left}px`;
      windowEl.style.top = `${top}px`;
    };
    const end = () => {
      windowEl.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      storeWindowLayout(windowEl);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    toggleMaximize(handle.closest(".widget-window"));
  });
});

document.querySelectorAll(".widget-window").forEach((windowEl) => {
  windowEl.addEventListener("pointerdown", () => focusWindow(windowEl));
});

const healthModelFrame = document.querySelector("#health-model-frame");
healthModelFrame.addEventListener("load", syncHealthModel);
window.addEventListener("message", (event) => {
  if (event.source !== healthModelFrame.contentWindow || !event.data || event.data.type !== "kagami:model-change") return;
  const model = event.data.modelo3d;
  const minimumWeight = model && Number.isFinite(model.altura) ? Math.ceil(15 * (model.altura / 100) ** 2) : NaN;
  const maximumWeight = model && Number.isFinite(model.altura) ? Math.floor(42 * (model.altura / 100) ** 2) : NaN;
  if (
    !model ||
    !["female", "male"].includes(model.sex) ||
    !Number.isFinite(model.altura) || model.altura < 140 || model.altura > 200 ||
    !Number.isFinite(model.peso) || model.peso < minimumWeight || model.peso > maximumWeight ||
    !Number.isFinite(model.pulso) || model.pulso < 40 || model.pulso > 180 ||
    typeof model.color !== "string" || !/^#[\da-f]{6}$/i.test(model.color)
  ) return;
  saveStored(STORAGE_KEYS.bodyModel, model);
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    closeWindow(button.dataset.close);
  });
});

document.querySelectorAll("[data-minimize]").forEach((button) => {
  button.addEventListener("click", () => minimizeWindow(button.dataset.minimize));
});

document.querySelectorAll("[data-maximize]").forEach((button) => {
  button.addEventListener("click", () => toggleMaximize(button.closest(".widget-window")));
});

document.querySelectorAll(".nav-item[data-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    openWindow(button.dataset.panel);
  });
});

document.querySelector("#customize-button").addEventListener("click", () => {
  document.querySelector("#customize-popover").classList.toggle("hidden");
});
document.querySelector("#close-customize").addEventListener("click", () => document.querySelector("#customize-popover").classList.add("hidden"));
document.querySelector("#theme-select").addEventListener("change", (event) => applyTheme(event.target.value));
document.querySelector("#show-all").addEventListener("change", (event) => {
  const windows = [...document.querySelectorAll(".widget-window")];
  if (event.target.checked) {
    windows.forEach((windowEl, index) => {
      if (!windowEl.style.width) positionWindow(windowEl, index);
    });
  }
  saveStored(STORAGE_KEYS.hiddenPanels, event.target.checked ? [] : PANEL_IDS);
  saveStored(STORAGE_KEYS.minimizedPanels, []);
  applyHiddenPanels();
});
document.querySelector("#reset-layout").addEventListener("click", resetLayout);

document.querySelector("#sidebar-toggle").addEventListener("click", () => {
  setSidebarHidden(!screens.dashboard.classList.contains("sidebar-hidden"));
});
document.querySelector("#logout-button").addEventListener("click", () => {
  if (!removeStored(STORAGE_KEYS.user)) return;
  document.querySelector("#password").value = "";
  document.querySelector("#auth-error").textContent = "";
  document.querySelector("#start-button").classList.remove("launching");
  configureAuthMode("login");
  showScreen("intro");
});
document.querySelector("#clear-canvas").addEventListener("click", clearInkCanvas);

function getMathPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pressure > 0 ? event.pressure : 0.5,
    time: Date.now(),
  };
}

function finalizeMathStroke() {
  if (!activeMathStroke) return;
  activeMathStroke.pointerId = null;
  mathStrokes.push(activeMathStroke);
  lastMathStrokeEndedAt = Date.now();
  activeMathStroke = null;
  undoneMathStrokes = [];
  renderMathCanvas();
  updateMathHistoryControls();
  window.clearTimeout(mathRecognitionTimer);
  mathRecognitionTimer = window.setTimeout(() => {
    document.querySelector("#math-status").textContent =
      "No hay un servicio seguro de reconocimiento de escritura configurado. Escribe la expresión arriba para resolverla.";
  }, 1000);
}

function stopMathPointer(event) {
  if (!activeMathStroke || activeMathStroke.pointerId !== event.pointerId) return;
  activeMathStroke.pointerId = null;
  finalizeMathStroke();
}

document.querySelector("#canvas-ink").addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  const canvas = event.currentTarget;
  const point = getMathPoint(event, canvas);
  if (point.time - lastMathStrokeEndedAt > 1000) activeMathSymbolId = createLocalAccountId();
  activeMathStroke = {
    points: [point],
    color: document.querySelector("#math-eraser").getAttribute("aria-pressed") === "true"
      ? "#000"
      : document.querySelector("#math-pen-color").value,
    width: Number(document.querySelector("#brush-size").value),
    erase: document.querySelector("#math-eraser").getAttribute("aria-pressed") === "true",
    pointerId: event.pointerId,
    timestamp: point.time,
    symbolId: activeMathSymbolId,
  };
  canvas.setPointerCapture(event.pointerId);
  renderMathCanvas();
});
document.querySelector("#canvas-ink").addEventListener("pointermove", (event) => {
  if (!activeMathStroke || activeMathStroke.pointerId !== event.pointerId) return;
  event.preventDefault();
  activeMathStroke.points.push(getMathPoint(event, event.currentTarget));
  renderMathCanvas();
});
document.querySelector("#canvas-ink").addEventListener("pointerup", stopMathPointer);
document.querySelector("#canvas-ink").addEventListener("pointercancel", stopMathPointer);
document.querySelector("#canvas-ink").addEventListener("lostpointercapture", stopMathPointer);
document.querySelector("#math-eraser").addEventListener("click", (event) => {
  const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
  event.currentTarget.classList.toggle("tool-active", enabled);
});
document.querySelector("#math-undo").addEventListener("click", () => {
  if (!mathStrokes.length) return;
  undoneMathStrokes.push(mathStrokes.pop());
  renderMathCanvas();
  updateMathHistoryControls();
});
document.querySelector("#math-redo").addEventListener("click", () => {
  if (!undoneMathStrokes.length) return;
  mathStrokes.push(undoneMathStrokes.pop());
  renderMathCanvas();
  updateMathHistoryControls();
});
document.querySelector("#math-theme-toggle").addEventListener("click", (event) => {
  const light = document.body.classList.toggle("math-light");
  event.currentTarget.textContent = light ? "Modo oscuro" : "Modo claro";
  event.currentTarget.setAttribute("aria-pressed", String(light));
  const penColor = document.querySelector("#math-pen-color");
  if (penColor.value.toLowerCase() === (light ? "#e7ddf6" : "#342541")) {
    penColor.value = light ? "#342541" : "#e7ddf6";
  }
  if (!document.querySelector("#math-graph-panel").hidden) {
    drawMathGraph(document.querySelector("#math-expression").value.trim());
  }
});

function setMathHeaderHidden(hidden) {
  const header = document.querySelector("#math-header");
  const controls = document.querySelector("#math-controls");
  const toggle = document.querySelector("#math-header-toggle");
  header.hidden = hidden;
  controls.hidden = hidden;
  toggle.setAttribute("aria-expanded", String(!hidden));
  toggle.textContent = hidden ? "Mostrar título y herramientas" : "Ocultar título y herramientas";
  toggle.title = hidden ? "Mostrar el título y las herramientas de Canvas Math" : "Ocultar el título y las herramientas de Canvas Math";
}

document.querySelector("#math-header-toggle").addEventListener("click", (event) => {
  const hidden = event.currentTarget.getAttribute("aria-expanded") === "true";
  setMathHeaderHidden(hidden);
  saveStored(STORAGE_KEYS.mathHeaderHidden, hidden);
});

function tokenizeMathExpression(expression) {
  const source = expression
    .replace(/[×·]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/,/g, ".")
    .replace(/(\d)(x)/gi, "$1*$2")
    .replace(/(x)(\d)/gi, "$1*$2")
    .replace(/(\))(\d|x|\()/gi, "$1*$2")
    .replace(/(\d|x)(\()/gi, "$1*$2")
    .replace(/y\s*=/i, "");
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|x|[()+\-*/^=]/gi);
  if (!tokens || tokens.join("").replace(/\s/g, "") !== source.replace(/\s/g, "")) {
    throw new Error("No reconocí esa expresión. Revisa números y operadores.");
  }
  return tokens.map((token) => token.toLowerCase());
}

function parseMathExpression(expression, xValue = 0) {
  const tokens = tokenizeMathExpression(expression);
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];
  function primary() {
    const token = consume();
    if (token === "(") {
      const value = addSubtract();
      if (consume() !== ")") throw new Error("Falta cerrar un paréntesis.");
      return value;
    }
    if (token === "x") return xValue;
    if (token && /^(\d+\.?\d*|\.\d+)$/.test(token)) return Number(token);
    throw new Error("La expresión está incompleta o contiene un símbolo no permitido.");
  }
  function power() {
    const base = primary();
    if (peek() === "^") {
      consume();
      return base ** unary();
    }
    return base;
  }
  function unary() {
    if (peek() === "+") {
      consume();
      return unary();
    }
    if (peek() === "-") {
      consume();
      return -unary();
    }
    return power();
  }
  function multiplyDivide() {
    let value = unary();
    while (peek() === "*" || peek() === "/") {
      const operator = consume();
      const right = unary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function addSubtract() {
    let value = multiplyDivide();
    while (peek() === "+" || peek() === "-") {
      const operator = consume();
      const right = multiplyDivide();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = addSubtract();
  if (position !== tokens.length) throw new Error("No pude interpretar toda la expresión.");
  if (!Number.isFinite(result)) throw new Error("La operación no tiene un resultado finito.");
  return result;
}

function getMathFunction(expression) {
  const normalized = expression.replace(/y\s*=/i, "").trim();
  const equation = normalized.split("=");
  if (equation.length > 2) throw new Error("Escribe solo un signo igual.");
  return (x) => {
    if (equation.length === 2) return parseMathExpression(equation[0], x) - parseMathExpression(equation[1], x);
    return parseMathExpression(normalized, x);
  };
}

function findMathRoots(expression) {
  const fn = getMathFunction(expression);
  const roots = [];
  const start = -100;
  const end = 100;
  const step = 0.25;
  let previousX = start;
  let previousY = fn(previousX);
  for (let x = start + step; x <= end; x += step) {
    const y = fn(x);
    if (!Number.isFinite(y)) {
      previousX = x;
      previousY = y;
      continue;
    }
    if (Math.abs(y) < 1e-8) roots.push(x);
    else if (Number.isFinite(previousY) && previousY * y < 0) {
      let low = previousX;
      let high = x;
      let lowY = previousY;
      for (let iteration = 0; iteration < 40; iteration += 1) {
        const middle = (low + high) / 2;
        const middleY = fn(middle);
        if (Math.abs(middleY) < 1e-10) {
          low = middle;
          high = middle;
          break;
        }
        if (lowY * middleY <= 0) high = middle;
        else {
          low = middle;
          lowY = middleY;
        }
      }
      roots.push((low + high) / 2);
    }
    previousX = x;
    previousY = y;
  }
  return roots.filter((root, index) => roots.findIndex((other) => Math.abs(root - other) < 0.02) === index);
}

function resolveMathExpression() {
  const expression = document.querySelector("#math-expression").value.trim();
  const status = document.querySelector("#math-status");
  const answer = document.querySelector("#math-answer");
  if (!expression) {
    status.textContent = "Escribe la operación o ecuación en el campo Expresión.";
    document.querySelector("#math-expression").focus();
    return;
  }
  try {
    const hasVariable = /x/i.test(expression);
    const hasEquals = expression.includes("=");
    const isFunction = /^\s*y\s*=/i.test(expression);
    let resultText;
    if (isFunction) {
      resultText = expression.replace(/^\s*y\s*=\s*/i, "y = ");
      status.textContent = "Función lista para graficar. Abre el panel Gráfico para explorarla.";
    } else if (hasEquals && hasVariable) {
      const roots = findMathRoots(expression);
      if (!roots.length) throw new Error("No encontré soluciones reales entre -100 y 100.");
      resultText = roots.map((root) => `x ≈ ${Number(root.toFixed(4))}`).join(", ");
      status.textContent = `Ecuación resuelta numéricamente. Revisé valores entre -100 y 100. Soluciones: ${resultText}`;
    } else if (hasEquals) {
      const [left, right] = expression.split("=");
      if (parseMathExpression(left) !== parseMathExpression(right)) {
        status.textContent = `La igualdad es falsa: ${parseMathExpression(left)} ≠ ${parseMathExpression(right)}.`;
        resultText = "falso";
      } else {
        status.textContent = `La igualdad es verdadera: ambos lados valen ${parseMathExpression(left)}.`;
        resultText = String(parseMathExpression(left));
      }
    } else if (hasVariable) {
      resultText = `y = ${expression.replace(/^y\s*=\s*/i, "")}`;
      status.textContent = "Función lista para graficar. Abre el panel Gráfico para explorarla.";
    } else {
      resultText = String(Number(parseMathExpression(expression).toPrecision(10)));
      status.textContent = "Operación resuelta.";
    }
    answer.textContent = resultText;
    mathAnswerText = resultText;
    mathAnswerProgress = 0;
    renderMathCanvas();
    animateMathAnswer();
    if (hasVariable) {
      document.querySelector("#math-graph-panel").hidden = false;
      document.querySelector("#math-graph-toggle").setAttribute("aria-expanded", "true");
      drawMathGraph(expression);
    } else {
      document.querySelector("#math-graph-panel").hidden = true;
      document.querySelector("#math-graph-toggle").setAttribute("aria-expanded", "false");
    }
  } catch (error) {
    answer.textContent = "";
    mathAnswerText = "";
    status.textContent = error.message || "No pude resolver la expresión. Puedes corregirla e intentarlo de nuevo.";
    renderMathCanvas();
  }
}

function animateMathAnswer() {
  const started = performance.now();
  const duration = Math.max(280, mathAnswerText.length * 55);
  function frame(now) {
    mathAnswerProgress = Math.min(1, (now - started) / duration);
    renderMathCanvas();
    if (mathAnswerProgress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

document.querySelector("#math-solve").addEventListener("click", resolveMathExpression);
document.querySelector("#math-expression").addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolveMathExpression();
});
document.querySelector("#math-graph-toggle").addEventListener("click", (event) => {
  const panel = document.querySelector("#math-graph-panel");
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden && document.querySelector("#math-expression").value.trim()) {
    drawMathGraph(document.querySelector("#math-expression").value.trim());
  }
});

function drawMathGraph(expression) {
  const canvas = document.querySelector("#math-graph");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const scale = 34 * mathGraphScale;
  const originX = width / 2 + mathGraphOffset.x;
  const originY = height / 2 + mathGraphOffset.y;
  const light = document.body.classList.contains("math-light");
  context.clearRect(0, 0, width, height);
  context.fillStyle = light ? "#fff" : "#12101a";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = light ? "#e8e4ef" : "#2b2435";
  context.lineWidth = 1;
  for (let x = originX % scale; x < width; x += scale) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = originY % scale; y < height; y += scale) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.strokeStyle = light ? "#777180" : "#9b8ba9";
  context.beginPath(); context.moveTo(0, originY); context.lineTo(width, originY); context.stroke();
  context.beginPath(); context.moveTo(originX, 0); context.lineTo(originX, height); context.stroke();
  try {
    const fn = getMathFunction(expression);
    context.beginPath();
    context.strokeStyle = "#ad80f5";
    context.lineWidth = 2.5;
    let connected = false;
    for (let pixelX = 0; pixelX <= width; pixelX += 1) {
      const x = (pixelX - originX) / scale;
      const yValue = fn(x);
      const pixelY = originY - yValue * scale;
      if (!Number.isFinite(pixelY) || Math.abs(pixelY) > height * 8) {
        connected = false;
        continue;
      }
      if (connected) context.lineTo(pixelX, pixelY);
      else { context.moveTo(pixelX, pixelY); connected = true; }
    }
    context.stroke();
    findMathRoots(expression).forEach((root) => {
      const x = originX + root * scale;
      if (x < 0 || x > width) return;
      context.beginPath();
      context.arc(x, originY, 4, 0, Math.PI * 2);
      context.fillStyle = "#ffd166";
      context.fill();
    });
    document.querySelector("#math-graph-coordinates").textContent = expression.includes("=") && !/^\s*y\s*=/i.test(expression)
      ? "Se muestran los cruces de la ecuación con el eje x."
      : "Función graficada. Acerca con la rueda y arrastra para desplazarte.";
  } catch (error) {
    document.querySelector("#math-graph-coordinates").textContent = error.message;
  }
}

document.querySelector("#math-graph").addEventListener("pointerdown", (event) => {
  const canvas = event.currentTarget;
  mathGraphPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
document.querySelector("#math-graph").addEventListener("pointermove", (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (mathGraphPointer && mathGraphPointer.id === event.pointerId) {
    mathGraphOffset.x += event.clientX - mathGraphPointer.x;
    mathGraphOffset.y += event.clientY - mathGraphPointer.y;
    mathGraphPointer.x = event.clientX;
    mathGraphPointer.y = event.clientY;
    drawMathGraph(document.querySelector("#math-expression").value.trim());
    return;
  }
  const scale = 34 * mathGraphScale;
  const x = (event.clientX - rect.left - rect.width / 2 - mathGraphOffset.x) / scale;
  const y = (rect.height / 2 + mathGraphOffset.y - (event.clientY - rect.top)) / scale;
  document.querySelector("#math-graph-coordinates").textContent = `x = ${x.toFixed(2)}, y = ${y.toFixed(2)}`;
});
document.querySelector("#math-graph").addEventListener("pointerup", () => { mathGraphPointer = null; });
document.querySelector("#math-graph").addEventListener("pointercancel", () => { mathGraphPointer = null; });
document.querySelector("#math-graph").addEventListener("wheel", (event) => {
  event.preventDefault();
  mathGraphScale = Math.min(5, Math.max(0.35, mathGraphScale * (event.deltaY < 0 ? 1.12 : 0.89)));
  drawMathGraph(document.querySelector("#math-expression").value.trim());
}, { passive: false });

new ResizeObserver(resizeInkCanvas).observe(document.querySelector("#canvas-sheet"));
new ResizeObserver(() => {
  const expression = document.querySelector("#math-expression").value.trim();
  if (!document.querySelector("#math-graph-panel").hidden && expression) drawMathGraph(expression);
}).observe(document.querySelector("#math-graph"));
window.addEventListener("resize", () => requestAnimationFrame(() => requestAnimationFrame(fitWindowsToArea)));
new ResizeObserver(fitWindowsToArea).observe(document.querySelector("#windows-area"));

document.querySelectorAll("[data-mood]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mood]").forEach((option) => option.classList.toggle("chosen", option === button));
    document.querySelector("#health-detail").textContent = `${button.dataset.mood}. Gracias por hacer una pausa.`;
    showToast("Tu check-in quedó guardado en tu espacio.");
  });
});

document.querySelector("#study-action").addEventListener("click", () => showToast("Tu sesión de estudio está lista. ¡25 minutos para ti!"));
document.querySelector("#finance-action").addEventListener("click", () => showToast("Tu avance quedó anotado. Cada paso cuenta."));
document.querySelector("#fun-action").addEventListener("click", () => {
  const ideas = ["Escucha una canción que te encante.", "Tómate un descanso lejos de la pantalla.", "Retoma algo creativo que disfrutes.", "Sal a dar un paseo breve."];
  document.querySelector("#fun-detail").textContent = ideas[Math.floor(Math.random() * ideas.length)];
});

function openProfile() {
  const profile = getStored(STORAGE_KEYS.profile);
  showScreen("onboarding");
  startOnboarding(profile && profile.onboardingVersion === 1 ? profile : null);
}

let settingsDraft = {};
let settingsOpener;
let settingsImageProcessing = 0;
let settingsSaving = false;
let settingsGeneration = 0;

function updateSettingsSaveState() {
  document.querySelector("#save-settings").disabled = settingsSaving || settingsImageProcessing > 0;
}

function openSettings() {
  const user = getStored(STORAGE_KEYS.account) || getStored(STORAGE_KEYS.user);
  if (!user) {
    showToast("Inicia sesión para modificar tus ajustes.");
    return;
  }
  settingsGeneration += 1;
  settingsOpener = document.activeElement;
  settingsSaving = false;
  settingsDraft = {
    profileImage: user.profileImage || null,
  };
  document.querySelector("#settings-name").value = user.name || "";
  document.querySelector("#settings-email").value = user.email || "";
  document.querySelector("#settings-current-password").value = "";
  document.querySelector("#settings-new-password").value = "";
  document.querySelector("#settings-confirm-password").value = "";
  document.querySelector("#settings-avatar-file").value = "";
  document.querySelector("#settings-error").textContent = "";
  renderSettingsAvatar(settingsDraft.profileImage, user.name);
  document.querySelector("#settings-dialog").classList.remove("hidden");
  document.querySelector("#settings-name").focus();
}

function closeSettings() {
  if (settingsSaving) return;
  settingsGeneration += 1;
  document.querySelector("#settings-dialog").classList.add("hidden");
  if (settingsOpener instanceof HTMLElement) settingsOpener.focus();
}

function renderSettingsAvatar(image, name = "K") {
  const preview = document.querySelector("#settings-avatar-preview");
  const fallback = document.querySelector("#settings-avatar-fallback");
  if (image) {
    preview.src = image;
    preview.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    fallback.textContent = (name || "K").slice(0, 1).toUpperCase();
    fallback.classList.remove("hidden");
  }
}

async function compressImage(file, maxWidth, maxHeight) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen válido.");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no pudo procesar la imagen.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/webp", 0.82);
    if (image.length > 3_500_000) throw new Error("La imagen sigue siendo demasiado pesada. Elige otra más pequeña.");
    return image;
  } finally {
    bitmap.close();
  }
}

function showSettingsError(message) {
  document.querySelector("#settings-error").textContent = message;
}

document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#cancel-settings").addEventListener("click", closeSettings);
document.querySelector("#settings-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("#settings-dialog").classList.contains("hidden")) {
    closeSettings();
  }
});
document.querySelector("#settings-avatar-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const generation = settingsGeneration;
  settingsImageProcessing += 1;
  updateSettingsSaveState();
  try {
    const image = await compressImage(file, 640, 640);
    if (generation === settingsGeneration) {
      settingsDraft.profileImage = image;
      renderSettingsAvatar(image, document.querySelector("#settings-name").value);
      showSettingsError("");
    }
  } catch (error) {
    if (generation === settingsGeneration) showSettingsError(error.message || "No se pudo procesar la foto de perfil.");
  } finally {
    settingsImageProcessing -= 1;
    updateSettingsSaveState();
  }
});
document.querySelector("#settings-name").addEventListener("input", (event) => {
  if (!settingsDraft.profileImage) renderSettingsAvatar(null, event.target.value);
});
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = getStored(STORAGE_KEYS.user);
  const account = getStored(STORAGE_KEYS.account) || user;
  const error = document.querySelector("#settings-error");
  const name = document.querySelector("#settings-name").value.trim();
  const emailInput = document.querySelector("#settings-email");
  const currentPassword = document.querySelector("#settings-current-password").value;
  const newPassword = document.querySelector("#settings-new-password").value;
  const confirmation = document.querySelector("#settings-confirm-password").value;
  if (!user || !account) {
    showSettingsError("La sesión ha terminado. Vuelve a iniciar sesión.");
    return;
  }
  if (!name) {
    showSettingsError("Escribe tu nombre para continuar.");
    document.querySelector("#settings-name").focus();
    return;
  }
  if (!emailInput.checkValidity()) {
    showSettingsError("Escribe un correo electrónico válido.");
    emailInput.focus();
    return;
  }
  if (newPassword || currentPassword || confirmation) {
    if (!newPassword || !currentPassword || !confirmation) {
      showSettingsError("Completa la contraseña actual, la nueva y su confirmación.");
      return;
    }
    if (!account.credential) {
      showSettingsError("Cierra sesión y vuelve a entrar una vez para activar el cambio seguro de contraseña.");
      return;
    }
    if (newPassword.length < 8) {
      showSettingsError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmation) {
      showSettingsError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    try {
      if (!await verifyPassword(currentPassword, account.credential)) {
        showSettingsError("La contraseña actual no es correcta.");
        return;
      }
    } catch (credentialError) {
      console.error("No se pudo verificar la contraseña actual.", credentialError);
      showSettingsError("No se pudo verificar la contraseña en este dispositivo.");
      return;
    }
  }

  if (settingsImageProcessing > 0) {
    showSettingsError("Espera a que termine el procesamiento de las imágenes.");
    return;
  }
  settingsSaving = true;
  updateSettingsSaveState();
  document.querySelectorAll(".settings-file-input").forEach((input) => {
    input.disabled = true;
  });
  try {
    const previousAccount = account;
    const previousSession = user;
    const previousAccounts = getLocalAccounts();
    const existingName = account.name.trim().toLocaleLowerCase();
    const conflictingAccount = findLocalAccount(previousAccounts, name);
    if (conflictingAccount && conflictingAccount.name.trim().toLocaleLowerCase() !== existingName) {
      showSettingsError("Ese nombre de usuario ya está registrado en este dispositivo.");
      return;
    }
    const updatedUser = {
      ...account,
      name,
      email: emailInput.value.trim(),
    };
    if (settingsDraft.profileImage) updatedUser.profileImage = settingsDraft.profileImage;
    else delete updatedUser.profileImage;
    if (newPassword) updatedUser.credential = await createPasswordCredential(newPassword);
    const updatedAccounts = previousAccounts.map((entry) =>
      entry.name.trim().toLocaleLowerCase() === existingName ? updatedUser : entry
    );
    if (!saveStored(STORAGE_KEYS.accounts, updatedAccounts)) {
      showSettingsError("No se pudieron guardar los datos de cuenta en este dispositivo.");
      return;
    }
    if (!saveStored(STORAGE_KEYS.account, updatedUser)) {
      saveStored(STORAGE_KEYS.accounts, previousAccounts);
      showSettingsError("No se pudieron guardar los datos de cuenta en este dispositivo.");
      return;
    }
    const updatedSession = { id: updatedUser.id, name: updatedUser.name, created: updatedUser.created };
    if (!saveStored(STORAGE_KEYS.user, updatedSession)) {
      try {
        localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(previousAccounts));
        localStorage.setItem(STORAGE_KEYS.account, JSON.stringify(previousAccount));
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(previousSession));
      } catch (rollbackError) {
        console.error("No se pudo revertir la cuenta después de un error al guardar la sesión.", rollbackError);
      }
      showSettingsError("No se pudieron guardar los datos de sesión en este dispositivo.");
      return;
    }
    renderProfileButton(updatedUser);
    closeSettings();
    showToast("Tus ajustes se guardaron en este dispositivo.");
  } catch (saveError) {
    console.error("No se pudieron guardar los ajustes locales.", saveError);
    showSettingsError("No se pudieron guardar los ajustes. Inténtalo de nuevo.");
  } finally {
    settingsSaving = false;
    document.querySelectorAll(".settings-file-input").forEach((input) => {
      input.disabled = false;
    });
    updateSettingsSaveState();
  }
});

document.querySelector("#edit-profile").addEventListener("click", openProfile);
document.querySelector("#profile-button").addEventListener("click", openProfile);

const existingUser = getStored(STORAGE_KEYS.user);
if (existingUser) {
  const account = getStored(STORAGE_KEYS.account) || existingUser;
  const accounts = getLocalAccounts();
  const registeredAccount = findLocalAccount(accounts, existingUser.name);
  const activeAccount = registeredAccount || account;
  if (activeAccount.credential && activeAccount.name.trim().toLocaleLowerCase() === existingUser.name.trim().toLocaleLowerCase()) {
    activeAccount.id = activeAccount.id || existingUser.id || createLocalAccountId();
    const activeIndex = accounts.findIndex((entry) => entry.name.trim().toLocaleLowerCase() === activeAccount.name.trim().toLocaleLowerCase());
    if (activeIndex >= 0) accounts[activeIndex] = activeAccount;
    else accounts.push(activeAccount);
    const activeSession = { ...existingUser, id: activeAccount.id };
    if (!saveStored(STORAGE_KEYS.accounts, accounts)) {
      removeStored(STORAGE_KEYS.user);
    } else if (!migrateLegacyUserData(activeAccount)) {
      removeStored(STORAGE_KEYS.user);
    } else {
      if (!saveStored(STORAGE_KEYS.account, activeAccount) ||
        !saveStored(STORAGE_KEYS.user, activeSession)) {
        removeStored(STORAGE_KEYS.user);
      } else {
        const profile = getStored(STORAGE_KEYS.profile);
        if (profile) enterDashboard(activeAccount, profile);
      }
    }
  } else {
    removeStored(STORAGE_KEYS.user);
  }
}
