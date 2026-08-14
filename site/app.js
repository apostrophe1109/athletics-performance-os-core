const config = Object.freeze({
  gatewayUrl: "",
  sportProfileId: "SPORT_TJ",
  timezone: "Asia/Tokyo",
  locale: "ja-JP",
  requestTimeoutMs: 25000,
  ...(window.APOS_SITE_CONFIG || {})
});

const state = {
  layout: null,
  today: todayInTimezone(),
  context: null,
  sessions: [],
  exercises: [],
  executions: [],
  measurements: [],
  profile: null,
  fetchedAt: null,
  webSessionToken: sessionStorage.getItem("aposWebSession") || ""
};

const dashboard = document.querySelector("#dashboard");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");

boot().catch(error => {
  if (error?.code === "WEB_AUTH_REQUIRED") showLogin("セッションの有効期限が切れました。もう一度認証してください。");
  else showFatalError(error);
});

async function boot() {
  showLoading();
  state.layout = await loadLayout();
  applyTheme(state.layout.theme || {});
  document.title = state.layout.siteTitle || "Athletics Performance OS";
  document.querySelector("#site-title").textContent = state.layout.siteTitle || "Athletics Performance OS";
  assertConfigured();

  setConnection("idle", "認証確認中");
  if (!state.webSessionToken || !await verifyWebSession()) {
    state.webSessionToken = "";
    sessionStorage.removeItem("aposWebSession");
    showLogin();
    return;
  }

  await loadDashboardData();
}

async function loadDashboardData() {
  showLoading();

  const month = monthRange(state.today);
  const [context, sessions, exercises, executions, measurements, profiles] = await Promise.all([
    api("getTrainingContext", { date: state.today, sportProfileId: config.sportProfileId, historyDays: 14 }),
    records("sessions", { sessionDate: { $gte: month.start, $lte: month.end }, sportProfileId: config.sportProfileId }, "sessionDate", "ASC", 500),
    records("exercises", { sportProfileId: config.sportProfileId, status: { $ne: "ARCHIVED" } }, "yukiName", "ASC", 500),
    records("executions", { sportProfileId: config.sportProfileId }, "executionDate", "DESC", 50),
    records("measurements", { sportProfileId: config.sportProfileId }, "date", "DESC", 50),
    records("sportProfiles", { sportProfileId: config.sportProfileId }, "sportProfileId", "ASC", 1)
  ]);

  state.context = context;
  state.sessions = sessions.records || [];
  state.exercises = exercises.records || [];
  state.executions = executions.records || [];
  state.measurements = measurements.records || [];
  state.profile = profiles.records?.[0] || null;
  state.fetchedAt = new Date();
  renderDashboard();
  setConnection("ready", "最新データ");
}

async function verifyWebSession() {
  try {
    const result = await authRequest("/auth/verify", {});
    return result.success === true;
  } catch {
    return false;
  }
}

function showLogin(message = "") {
  dashboard.replaceChildren();
  dashboard.setAttribute("aria-busy", "false");
  setConnection("idle", "本人認証が必要");
  const panel = element("section", "panel panel--wide login-panel");
  const form = element("form", "login-form");
  const title = element("h2", "", "本人認証");
  const copy = element("p", "login-copy", "Athletics Performance OSのデータを表示するには、専用パスフレーズを入力してください。");
  const label = element("label", "login-label", "パスフレーズ");
  label.htmlFor = "web-password";
  const input = element("input", "login-input");
  input.id = "web-password";
  input.name = "password";
  input.type = "password";
  input.autocomplete = "current-password";
  input.required = true;
  const button = element("button", "login-button", "認証して表示");
  button.type = "submit";
  const status = element("p", "login-status", message);
  status.setAttribute("aria-live", "polite");
  form.append(title, copy, label, input, button, status);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = "認証中…";
    status.textContent = "";
    try {
      const result = await authRequest("/auth/login", { password: input.value });
      if (!result.success || !result.token) throw new Error(result.error || "認証に失敗しました。");
      state.webSessionToken = result.token;
      sessionStorage.setItem("aposWebSession", result.token);
      input.value = "";
      await loadDashboardData();
    } catch (error) {
      if (error?.code === "WEB_AUTH_REQUIRED") {
        showLogin("セッションを確認できませんでした。もう一度認証してください。");
        return;
      }
      status.textContent = error.message || "認証に失敗しました。";
      input.select();
    } finally {
      button.disabled = false;
      button.textContent = "認証して表示";
    }
  });
  panel.append(form);
  dashboard.append(panel);
  input.focus();
}

async function authRequest(path, payload) {
  const base = String(config.gatewayUrl).replace(/\/$/, "");
  const headers = { "content-type": "application/json", "x-apos-actor": "site-read-view" };
  if (state.webSessionToken) headers.authorization = `WebSession ${state.webSessionToken}`;
  const controller = new AbortController();
  const authTimeoutMs = Math.min(Number(config.requestTimeoutMs) || 25000, 8000);
  const timeout = setTimeout(() => controller.abort(), authTimeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error || `認証通信に失敗しました (${response.status})。`);
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("認証サーバーへの接続がタイムアウトしました。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertConfigured() {
  const url = String(config.gatewayUrl || "").trim();
  if (!/^https:\/\//.test(url) || url.includes("YOUR_WORKER_DOMAIN")) {
    throw new Error("site/config.js の gatewayUrl に公開済みCloudflare Worker URLを設定してください。");
  }
}

async function loadLayout() {
  const response = await fetch("./ui-layout.json", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("サイト表示構成を読み込めませんでした。");
  const layout = await response.json();
  if (!layout || !Array.isArray(layout.sections)) throw new Error("ui-layout.jsonの形式が正しくありません。");
  return layout;
}

async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const base = String(config.gatewayUrl).replace(/\/$/, "");
    const response = await fetch(`${base}/api/${encodeURIComponent(action)}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-apos-actor": "site-read-view",
        "authorization": `WebSession ${state.webSessionToken}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (response.status === 401) {
      state.webSessionToken = "";
      sessionStorage.removeItem("aposWebSession");
      throw Object.assign(new Error("認証が必要です。"), { code: "WEB_AUTH_REQUIRED" });
    }
    if (!response.ok || !result || result.success === false) {
      throw new Error(result?.error || `API ${action} が失敗しました (${response.status})。`);
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`API ${action} がタイムアウトしました。`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function records(entity, filters, sortBy, sortDirection, limit) {
  return api("getRecords", { entity, filters, sortBy, sortDirection, offset: 0, limit });
}

function renderDashboard() {
  dashboard.replaceChildren();
  const renderers = {
    hero: renderHero,
    today: renderToday,
    week: renderWeek,
    month: renderMonth,
    exerciseLibrary: renderExercises,
    history: renderHistory,
    measurements: renderMeasurements,
    customText: renderCustomText
  };

  state.layout.sections.filter(section => section.visible !== false).forEach(section => {
    const renderer = renderers[section.type];
    if (renderer) dashboard.append(renderer(section));
  });
  dashboard.setAttribute("aria-busy", "false");
}

function renderHero(section) {
  const panel = createPanel(section, "panel--wide panel--hero");
  const kicker = element("div", "hero-kicker", state.profile?.sportName || "TRIPLE JUMP");
  const title = element("div", "hero-title", section.title || "18m30への現在地");
  const copy = element("p", "hero-copy", state.layout.subtitle || "Google Sheetsの正式データを、毎日の判断につながる形で表示します。");
  panel.append(kicker, title, copy);
  const metrics = element("div", "metric-grid");
  const goal = numberOrText(state.profile?.targetValue, "18.30");
  const current = numberOrText(state.profile?.personalBest, "—");
  metrics.append(
    metric(`${goal}m`, "最終目標"),
    metric(current === "—" ? current : `${current}m`, "自己記録"),
    metric(String(state.context?.trainingRules?.length || 0), "有効な設計ルール"),
    metric(formatDateTime(state.fetchedAt), "最終同期")
  );
  panel.append(metrics);
  return panel;
}

function renderToday(section) {
  const panel = createPanel(section, "panel--wide");
  panel.append(sectionHeader(section.title || "今日のトレーニング", formatJapaneseDate(state.today)));
  const list = element("div", "card-list");
  const sessions = state.context?.sessions || [];
  const menu = state.context?.menuItems || [];
  if (!sessions.length) list.append(empty("今日の登録済みセッションはありません。"));
  sessions.forEach(session => {
    const card = element("article", "record-card");
    const top = element("div", "record-card__top");
    top.append(element("h3", "", session.title || session.role || "セッション"), pill(session.role || session.intensity || "PLAN"));
    card.append(top);
    if (section.options?.showPurpose !== false && session.purpose) card.append(element("p", "", session.purpose));
    const items = menu.filter(item => String(item.sessionId) === String(session.sessionId));
    items.forEach(item => {
      const dose = [item.sets && `${item.sets}set`, item.reps && `${item.reps}rep`, item.distanceM && `${item.distanceM}m`, item.durationSec && `${item.durationSec}s`, item.weightKg && `${item.weightKg}kg`].filter(Boolean).join(" / ");
      const description = [item.exerciseNameSnapshot, section.options?.showDose !== false ? dose : "", item.cue].filter(Boolean).join(" — ");
      card.append(element("p", "", description));
    });
    if (section.options?.showStopCondition !== false && session.stopCondition) card.append(element("p", "", `終了基準: ${session.stopCondition}`));
    list.append(card);
  });
  panel.append(list);
  return panel;
}

function renderWeek(section) {
  const panel = createPanel(section, "panel--wide");
  const start = startOfWeek(state.today);
  const days = Array.from({ length: Number(section.options?.days || 7) }, (_, index) => addDays(start, index));
  panel.append(sectionHeader(section.title || "今週の見通し", `${formatJapaneseDate(days[0])} – ${formatJapaneseDate(days.at(-1))}`));
  const grid = element("div", "week-grid");
  days.forEach(date => {
    const day = element("div", "day");
    day.dataset.today = String(date === state.today);
    day.append(element("span", "day__date", date.slice(5).replace("-", "/")), element("span", "day__name", weekdayName(date)));
    const items = state.sessions.filter(session => dateOnly(session.sessionDate) === date && session.planStatus !== "ARCHIVED");
    if (!items.length) day.append(element("span", "day__item", "—"));
    items.forEach(item => day.append(element("span", "day__item", item.title || item.role || "予定")));
    grid.append(day);
  });
  panel.append(grid);
  return panel;
}

function renderMonth(section) {
  const panel = createPanel(section, "panel--wide");
  const [year, month] = state.today.split("-").map(Number);
  panel.append(sectionHeader(section.title || "月間計画", `${year}年${month}月`));
  const grid = element("div", "month-grid");
  ["月", "火", "水", "木", "金", "土", "日"].forEach(label => grid.append(element("div", "month-label", label)));
  const first = `${year}-${pad(month)}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.append(element("div", "month-day"));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const cell = element("div", "month-day", String(day));
    const matches = state.sessions.filter(session => dateOnly(session.sessionDate) === date && session.planStatus !== "ARCHIVED");
    if (matches.length) {
      cell.dataset.active = "true";
      cell.title = matches.map(item => item.title || item.role || "予定").join(" / ");
      cell.append(element("span", "month-day__dot"));
    }
    grid.append(cell);
  }
  panel.append(grid);
  return panel;
}

function renderExercises(section) {
  const panel = createPanel(section, "panel--wide");
  const head = sectionHeader(section.title || "種目ライブラリ", `${state.exercises.length}種目`);
  let query = "";
  if (section.options?.showSearch !== false) {
    const input = element("input", "search");
    input.type = "search";
    input.placeholder = "種目名・目的・能力で検索";
    input.setAttribute("aria-label", "種目ライブラリを検索");
    head.append(input);
    input.addEventListener("input", () => { query = input.value.trim().toLowerCase(); update(); });
  }
  panel.append(head);
  const list = element("div", "card-list");
  panel.append(list);
  const update = () => {
    list.replaceChildren();
    const limit = Number(section.options?.limit || 12);
    const filtered = state.exercises.filter(item => [item.yukiName, item.generalName, item.aliases, item.mainPurpose, item.targetAbility].join(" ").toLowerCase().includes(query)).slice(0, limit);
    if (!filtered.length) list.append(empty("一致する種目がありません。"));
    filtered.forEach(item => list.append(recordCard(item.yukiName || item.generalName || item.exerciseId, item.category || "EXERCISE", [item.mainPurpose, item.initialPrescription, item.cue].filter(Boolean).join(" / "))));
  };
  update();
  return panel;
}

function renderHistory(section) {
  const panel = createPanel(section);
  panel.append(sectionHeader(section.title || "最近の実施記録", "保存済みの構造化記録"));
  const list = element("div", "card-list");
  const items = state.executions.slice(0, Number(section.options?.limit || 10));
  if (!items.length) list.append(empty("実施記録はまだありません。"));
  items.forEach(item => list.append(recordCard(item.exerciseName || item.exerciseId || "実施記録", formatJapaneseDate(dateOnly(item.executionDate)), [item.successes, item.improvements, item.voiceTranscriptNormalized].filter(Boolean).join(" / "))));
  panel.append(list);
  return panel;
}

function renderMeasurements(section) {
  const panel = createPanel(section);
  panel.append(sectionHeader(section.title || "計測記録", "候補ではなく実測値のみ"));
  const list = element("div", "card-list");
  const items = state.measurements.slice(0, Number(section.options?.limit || 8));
  if (!items.length) list.append(empty("計測記録はまだありません。"));
  items.forEach(item => {
    const value = [item.measurementValue, item.unit].filter(value => value !== null && value !== undefined && value !== "").join(" ");
    list.append(recordCard(item.measurementType || item.exerciseName || "計測", formatJapaneseDate(dateOnly(item.date)), [value, item.evaluation].filter(Boolean).join(" / ")));
  });
  panel.append(list);
  return panel;
}

function renderCustomText(section) {
  const panel = createPanel(section, "panel--wide");
  panel.append(sectionHeader(section.title || "お知らせ", ""), element("p", "hero-copy", String(section.options?.text || "")));
  return panel;
}

function createPanel(section, extraClass = "") {
  const panel = element("section", `panel ${extraClass}`.trim());
  panel.dataset.sectionId = String(section.id || "");
  return panel;
}

function sectionHeader(title, note) {
  const head = element("div", "section-head");
  head.append(element("h2", "", title));
  if (note) head.append(element("span", "section-note", note));
  return head;
}

function recordCard(title, badge, body) {
  const card = element("article", "record-card");
  const top = element("div", "record-card__top");
  top.append(element("h3", "", String(title || "—")), pill(String(badge || ""), true));
  card.append(top);
  if (body) card.append(element("p", "", String(body)));
  return card;
}

function pill(text, muted = false) { return element("span", `pill${muted ? " pill--muted" : ""}`, text); }
function metric(value, label) { const card = element("div", "metric"); card.append(element("span", "metric__value", value), element("span", "metric__label", label)); return card; }
function empty(message) { return element("div", "empty", message); }

function element(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function showLoading() {
  dashboard.replaceChildren();
  const template = document.querySelector("#loading-template");
  for (let i = 0; i < 4; i++) dashboard.append(template.content.cloneNode(true));
}

function showFatalError(error) {
  console.error(error);
  dashboard.replaceChildren();
  const panel = element("section", "panel panel--wide");
  panel.append(element("h2", "", "表示できませんでした"), element("p", "error", error?.message || "不明なエラーが発生しました。"));
  dashboard.append(panel);
  dashboard.setAttribute("aria-busy", "false");
  setConnection("error", "接続エラー");
}

function setConnection(stateName, label) { connectionDot.dataset.state = stateName; connectionLabel.textContent = label; }

function applyTheme(theme) {
  const variables = { accent: "--accent", accentSecondary: "--accent-2", surface: "--surface", background: "--background", text: "--text", muted: "--muted" };
  Object.entries(variables).forEach(([key, variable]) => {
    const value = String(theme[key] || "");
    if (/^#[0-9a-f]{6}$/i.test(value)) document.documentElement.style.setProperty(variable, value);
  });
}

function todayInTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function startOfWeek(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function monthRange(date) {
  const [year, month] = date.split("-").map(Number);
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}` };
}

function weekdayName(date) { return new Intl.DateTimeFormat(config.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function formatJapaneseDate(date) { if (!date) return "—"; return new Intl.DateTimeFormat(config.locale, { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function formatDateTime(date) { return date ? new Intl.DateTimeFormat(config.locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: config.timezone }).format(date) : "—"; }
function numberOrText(value, fallback) { return value === null || value === undefined || value === "" ? fallback : String(value); }
function pad(value) { return String(value).padStart(2, "0"); }
