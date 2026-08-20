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
  selectedDate: null,
  viewMode: "day",
  context: null,
  dayContext: null,
  sessions: [],
  executions: [],
  historySessions: [],
  measurements: [],
  exercises: [],
  events: [],
  profile: null,
  fetchedAt: null,
  dayCache: new Map(),
  loadedSessionRanges: new Set(),
  competitionLoaded: false,
  secondaryLoaded: false,
  backgroundLoading: false,
  secondaryView: "history",
  exerciseSearchQuery: "",
  exerciseSearchResults: null,
  exerciseSearchLoading: false,
  exerciseSearchError: "",
  measurementTrendsLoaded: false,
  measurementLoading: false,
  exerciseDetailCache: new Map(),
  exerciseDetailLoadingId: "",
  openDayMenuDetails: new Set(),
  sprintBaselineMeasurements: null,
  sprintBaselineLoading: null,
  webSessionToken: sessionStorage.getItem("aposWebSession") || ""
};
state.selectedDate = state.today;

const dashboard = document.querySelector("#dashboard");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");
const refreshButton = document.querySelector("#refresh-button");
refreshButton?.addEventListener("click", () => refreshVisibleData().catch(showFatalError));
installTapFeedback();

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

  if (!state.webSessionToken) {
    showLogin();
    return;
  }
  setConnection("idle", "今日の練習を取得中");
  await loadDashboardData();
}

async function loadDashboardData() {
  showLoading();
  state.selectedDate = state.today;
  state.viewMode = "day";
  await loadDayData(state.today, { force: true, render: false });
  state.fetchedAt = new Date();
  renderDashboard();
  setConnection("ready", "今日を表示");
  void loadBackgroundData();
}

async function loadDayData(date, { force = false, render = true } = {}) {
  state.selectedDate = date;
  const cached = state.dayCache.get(date);
  if (!force && cached) {
    state.dayContext = cached;
    if (render) renderDashboard();
    return cached;
  }

  const result = await records(
    "sessions",
    { sessionDate: date, sportProfileId: config.sportProfileId },
    "sessionDate",
    "ASC",
    20
  );
  const sessions = result.records || [];
  replaceSessionsForRange(date, date, sessions);
  const context = { sessions, menuItems: [], menuItemsLoaded: false };
  state.dayCache.set(date, context);
  state.loadedSessionRanges.add(`${date}|${date}`);
  state.dayContext = context;
  if (render) renderDashboard();
  void hydrateDayMenuItems(date, sessions);
  return context;
}

async function hydrateDayMenuItems(date, sessions) {
  const context = state.dayCache.get(date);
  if (!context || context.menuItemsLoaded) return;
  const sessionIds = sessions.map(item => item.sessionId).filter(Boolean).slice(0, 5);
  context.menuItemsLoaded = true;
  if (!sessionIds.length) return;
  try {
    const results = await Promise.all(sessionIds.map(sessionId =>
      records("menuItems", { sessionId }, "orderNo", "ASC", 50)
    ));
    context.menuItems = results
      .flatMap(result => result.records || [])
      .sort((a, b) => Number(a.orderNo || 0) - Number(b.orderNo || 0));
    state.dayCache.set(date, context);
    if (state.viewMode === "day" && state.selectedDate === date) {
      state.dayContext = context;
      renderDashboard();
    }
  } catch (error) {
    context.menuItemsLoaded = false;
    console.warn("menu item intensity load failed", error);
  }
}

async function loadCompetitionData() {
  const [profiles, events] = await Promise.all([
    records("sportProfiles", { sportProfileId: config.sportProfileId }, "sportProfileId", "ASC", 1),
    records("events", { sportProfileId: config.sportProfileId, startDate: { $gte: state.today }, status: { $ne: "ARCHIVED" } }, "startDate", "ASC", 10)
  ]);
  state.profile = profiles.records?.[0] || null;
  state.events = events.records || [];
  state.competitionLoaded = true;
  renderDashboard();
}

async function loadSecondaryData() {
  const historyStart = addDays(state.today, -14);
  const historyEnd = addDays(state.today, -1);
  const [executions, historySessions, measurements, exercises] = await Promise.all([
    records("executions", { sportProfileId: config.sportProfileId, executionDate: { $gte: historyStart, $lte: state.today } }, "executionDate", "DESC", 50),
    records("sessions", { sportProfileId: config.sportProfileId, sessionDate: { $gte: historyStart, $lte: historyEnd }, planStatus: { $ne: "ARCHIVED" } }, "sessionDate", "DESC", 30),
    records("measurements", { sportProfileId: config.sportProfileId }, "date", "DESC", 6),
    records("exercises", { sportProfileId: config.sportProfileId, status: { $ne: "ARCHIVED" } }, "yukiName", "ASC", 6)
  ]);
  state.executions = executions.records || [];
  state.historySessions = historySessions.records || [];
  state.measurements = measurements.records || [];
  state.exercises = exercises.records || [];
  state.secondaryLoaded = true;
  state.fetchedAt = new Date();
  renderDashboard();
}

async function loadBackgroundData({ force = false } = {}) {
  if (state.backgroundLoading) return;
  if (!force && state.competitionLoaded && state.secondaryLoaded) return;
  state.backgroundLoading = true;
  try {
    if (force || !state.competitionLoaded) await loadCompetitionData();
    if (force || !state.secondaryLoaded) await loadSecondaryData();
    setConnection("ready", "最新データ");
  } catch (error) {
    if (error?.code === "WEB_AUTH_REQUIRED") {
      showLogin("セッションの有効期限が切れました。もう一度認証してください。");
      return;
    }
    console.warn("background load failed", error);
    setConnection("ready", "主要データ表示中");
  } finally {
    state.backgroundLoading = false;
  }
}

async function loadDayContext(date, { force = false } = {}) {
  state.selectedDate = date;
  state.viewMode = "day";
  if (!force && state.dayCache.has(date)) {
    state.dayContext = state.dayCache.get(date);
    renderDashboard();
    setConnection("ready", "キャッシュ表示");
    return;
  }
  setConnection("idle", "日別データ取得中");
  try {
    await loadDayData(date, { force, render: true });
    setConnection("ready", "最新データ");
  } catch (error) {
    setConnection("error", "取得エラー");
    throw error;
  }
}

function renderDashboard() {
  dashboard.replaceChildren();
  dashboard.append(renderTrainingWorkspace(), renderSecondaryWorkspace());
  dashboard.setAttribute("aria-busy", "false");
}

function renderTrainingWorkspace() {
  const shell = element("section", "training-shell panel--wide");
  shell.append(renderCompetitionStrip(), renderViewTabs());

  const content = element("div", "view-content");
  if (state.viewMode === "week") content.append(renderWeekView());
  else if (state.viewMode === "month") content.append(renderMonthView());
  else content.append(renderDayView());
  shell.append(content);
  return shell;
}

function renderCompetitionStrip() {
  const strip = element("div", "competition-strip");
  const event = nextCompetition();
  const brand = element("div", "competition-strip__brand");
  brand.append(
    element("span", "eyebrow", state.profile?.sportName || "TRIPLE JUMP"),
    element("strong", "", "今日のトレーニング")
  );

  const target = element("div", "competition-strip__target");
  if (!state.competitionLoaded) {
    target.append(element("span", "competition-strip__date", "次戦 読み込み中…"));
  } else if (event) {
    const days = daysBetween(state.today, dateOnly(event.startDate));
    target.append(
      element("span", "competition-strip__date", `次戦 ${formatShortDate(event.startDate)} ${event.startTime || ""}`.trim()),
      element("span", "competition-strip__count", days >= 0 ? `あと ${days}日` : "終了")
    );
  } else {
    target.append(element("span", "competition-strip__date", "次戦 未登録"));
  }
  strip.append(brand, target);
  return strip;
}

function renderViewTabs() {
  const nav = element("nav", "view-tabs");
  nav.setAttribute("aria-label", "表示単位");
  [
    ["day", "日"],
    ["week", "週"],
    ["month", "月"]
  ].forEach(([mode, label]) => {
    const button = element("button", "view-tab", label);
    button.type = "button";
    button.dataset.active = String(state.viewMode === mode);
    button.setAttribute("aria-pressed", String(state.viewMode === mode));
    button.addEventListener("click", () => switchViewMode(mode).catch(showFatalError));
    nav.append(button);
  });
  return nav;
}

async function switchViewMode(mode) {
  state.viewMode = mode;
  const date = state.selectedDate || state.today;
  if (mode === "day") {
    await loadDayContext(date);
    return;
  }
  if (mode === "week") {
    const start = startOfWeek(date);
    await ensureSessionsForRange(start, addDays(start, 6));
  } else if (mode === "month") {
    const range = monthRange(date);
    await ensureSessionsForRange(range.start, range.end);
  }
  renderDashboard();
}

function renderDayView() {
  const wrap = element("div", "day-view");
  wrap.append(renderPeriodNavigator("day"));
  const context = state.dayContext || state.context || {};
  const sessions = context.sessions || [];
  const primary = sessions[0] || null;
  const intensity = sessionIntensity(primary);

  if (primary) {
    const concept = element("section", "concept-card concept-card--primary");
    concept.append(
      element("span", "concept-card__label", "今日の練習コンセプト"),
      element("strong", "", primary.purpose || primary.mainAdaptation || primary.role || "計画どおりに実施")
    );
    if (primary.cue) concept.append(element("p", "concept-card__cue", primary.cue));
    wrap.append(concept);
  }

  const head = element("div", "day-head day-head--compact");
  const copy = element("div");
  copy.append(
    element("span", "eyebrow eyebrow--cyan", `DAY / ${formatJapaneseDate(state.selectedDate)}`),
    element("h2", "day-title", primary?.title || primary?.role || "登録済みセッションなし")
  );
  const strength = intensityCard(intensity);
  head.append(copy, strength);
  wrap.append(head);

  wrap.append(renderDayMenuSections(context, sessions));

  const stop = sessions.map(item => item.stopCondition).filter(Boolean).join(" / ");
  if (stop) {
    const note = element("div", "stop-note");
    note.append(element("strong", "", "終了基準"), element("span", "", stop));
    wrap.append(note);
  }

  wrap.append(renderRecordEntry());
  return wrap;
}

function renderDayMenuSections(context, sessions) {
  const panel = element("section", "day-menu");
  const heading = element("div", "day-menu__heading");
  heading.append(
    element("span", "eyebrow", "TODAY'S MENU"),
    element("h3", "", "その日の練習内容")
  );
  panel.append(heading);

  const entries = dayMenuEntries(context, sessions);
  if (!entries.length) {
    panel.append(empty("この日の詳細メニューは正本に登録されていません。"));
    return panel;
  }

  const block = element("section", "day-menu-section");
  const blockHead = element("div", "day-menu-section__head");
  blockHead.append(
    element("strong", "", "実行する順番"),
    element("span", "day-menu-section__count", `${entries.length}項目`)
  );

  const list = element("ul", "day-menu-section__list");
  entries.forEach((item, index) => {
    const score = Number.isFinite(item.intensityScore) ? item.intensityScore : null;
    const row = element("li", "day-menu-row");
    row.dataset.intensityBand = intensityBand(score);

    const detailKey = dayMenuDetailKey(item, index);
    const expanded = state.openDayMenuDetails.has(detailKey);
    const toggle = element("button", "day-menu-row__toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.title = `強度 ${score}/10・タップで詳細表示`;

    const copy = element("div", "day-menu-row__copy");
    const titleLine = element("div", "day-menu-row__title");
    titleLine.append(
      element("span", "day-menu-row__index", String(index + 1)),
      element("strong", "", item.title)
    );
    copy.append(titleLine);
    if (item.detail) copy.append(element("span", "", item.detail));

    const meta = element("div", "day-menu-row__meta");
    if (score !== null) meta.append(element("span", "day-menu-row__intensity", `${score}/10`));
    if (item.dose) meta.append(element("span", "day-menu-row__dose", item.dose));
    meta.append(element("span", "day-menu-row__chevron", "⌄"));
    toggle.append(copy, meta);

    const detail = element("div", "day-menu-row__detail");
    detail.dataset.open = String(expanded);
    const detailInner = element("div", "day-menu-row__detail-inner");
    renderDayMenuDetail(detailInner, item, score, state.exerciseDetailCache.get(item.exerciseId) || null);
    detail.append(detailInner);

    toggle.addEventListener("click", () => {
      toggleDayMenuDetail(detailKey, item, score, toggle, detail, detailInner).catch(showFatalError);
    });
    row.append(toggle, detail);
    list.append(row);
  });
  block.append(blockHead, list);
  panel.append(block);
  return panel;
}

function compactBridgeItems(raw) {
  const parts = String(raw || "")
    .split(/→|\n+/)
    .map(value => value.trim())
    .filter(Boolean);
  const output = [];

  const runPart = value => {
    const match = String(value || "").match(/^(\d{2,3})m\b/i);
    if (!match) return null;
    return {
      distance: `${match[1]}m`,
      closesSet: /[=＝]\s*1セット(?:目)?\s*$/.test(value)
    };
  };
  const shortRest = value => /^\d+(?:〜\d+)?秒(?:休息)?$/.test(String(value || "").trim());

  for (let i = 0; i < parts.length;) {
    const first = runPart(parts[i]);
    if (!first) {
      output.push(parts[i]);
      i += 1;
      continue;
    }

    const distances = [first.distance];
    let j = i + 1;
    let closed = first.closesSet;
    while (!closed && j + 1 < parts.length && shortRest(parts[j])) {
      const nextRun = runPart(parts[j + 1]);
      if (!nextRun) break;
      distances.push(nextRun.distance);
      closed = nextRun.closesSet;
      j += 2;
    }

    if (!closed || distances.length < 2) {
      output.push(parts[i]);
      i += 1;
      continue;
    }

    let setCount = 1;
    let betweenSetRest = "";
    const restMatch = String(parts[j] || "").match(/^(\d+(?:〜\d+)?)分休息$/);
    if (restMatch) {
      betweenSetRest = restMatch[1];
      j += 1;
    }
    const repeatMatch = String(parts[j] || "").match(/^同内容(\d+)セット目$/);
    if (repeatMatch) {
      setCount = Number(repeatMatch[1]);
      j += 1;
    }

    output.push(`(${distances.join("+")})×${setCount}set${betweenSetRest ? ` rest${betweenSetRest}min` : ""}`);
    i = j;
  }

  return output;
}

function dayMenuEntries(context, sessions) {
  const menu = context.menuItems || [];
  if (menu.length) {
    return menu.map((item, index) => {
      const title = item.exerciseNameSnapshot || item.exerciseName || item.menuName || `メニュー ${index + 1}`;
      const detail = item.cue || item.purpose || "";
      const searchable = [title, detail, item.category, item.block, item.section].filter(Boolean).join(" ");
      return {
        title,
        detail,
        dose: doseText(item),
        section: inferDayMenuSection(searchable),
        intensityScore: resolvedTrainingIntensity(
          searchable,
          sessions.find(session => session.sessionId === item.sessionId) || sessions[0] || null,
          item.intensity
        ),
        intensityEstimated: false,
        exerciseId: item.exerciseId || item.sourceExerciseId || null,
        session: sessions.find(session => session.sessionId === item.sessionId) || sessions[0] || null
      };
    });
  }

  const bridgeEntries = sessions.flatMap(session => compactBridgeItems(session.bridge)
    .map(value => {
      const estimated = bridgeIntensityEstimate(value, session);
      return {
        title: value,
        detail: "",
        dose: "",
        section: inferDayMenuSection(value),
        intensityScore: estimated,
        intensityEstimated: false,
        exerciseId: null,
        session
      };
    }));
  if (bridgeEntries.length) return bridgeEntries;

  return sessions.map(session => ({
    title: session.title || session.role || "セッション",
    detail: session.purpose || "",
    dose: sessionDoseText(session),
    section: inferDayMenuSection([session.role, session.title, session.purpose].filter(Boolean).join(" ")),
    intensityScore: sessionIntensity(session),
    intensityEstimated: false,
    exerciseId: null,
    session
  }));
}

function dayMenuDetailKey(item, index) {
  return `${state.selectedDate}|${index}|${item.exerciseId || item.title}`;
}

async function toggleDayMenuDetail(key, item, score, toggle, detail, detailInner) {
  const opening = !state.openDayMenuDetails.has(key);
  if (!opening) {
    state.openDayMenuDetails.delete(key);
    toggle.setAttribute("aria-expanded", "false");
    detail.dataset.open = "false";
    return;
  }

  state.openDayMenuDetails.add(key);
  toggle.setAttribute("aria-expanded", "true");
  detail.dataset.open = "true";
  let exercise = state.exerciseDetailCache.get(item.exerciseId) || null;
  let sprintBaselines = state.sprintBaselineMeasurements;
  renderDayMenuDetail(detailInner, item, score, exercise, sprintBaselines);

  const tasks = [];
  if (item.exerciseId && !exercise) {
    tasks.push(
      api("getRecord", { entity: "exercises", key: item.exerciseId })
        .then(result => {
          exercise = result.record || null;
          if (exercise) state.exerciseDetailCache.set(item.exerciseId, exercise);
        })
        .catch(error => console.warn("day menu exercise detail load failed", error))
    );
  }
  if (isTimedSprintItem(item)) {
    tasks.push(
      ensureSprintBaselines()
        .then(records => { sprintBaselines = records; })
        .catch(error => console.warn("sprint baseline load failed", error))
    );
  }

  if (!tasks.length) return;
  await Promise.all(tasks);
  if (state.openDayMenuDetails.has(key)) {
    renderDayMenuDetail(detailInner, item, score, exercise, sprintBaselines);
  }
}

function renderDayMenuDetail(container, item, score, exercise, sprintBaselines = null) {
  container.replaceChildren();
  const facts = element("div", "day-menu-detail__facts");
  facts.append(
    dayMenuFact("強度", `${score}/10`),
    dayMenuFact("設定", item.dose || exercise?.initialPrescription || sprintSettingSummary(item, score)),
    dayMenuFact("休息", exercise?.rest || dayMenuRestFromTitle(item.title) || "メニュー表記どおり")
  );
  container.append(facts);

  if (isTimedSprintItem(item)) container.append(renderSprintTiming(item, score, sprintBaselines));

  const steps = buildDayMenuSteps(item, exercise, score);
  if (steps.length) appendDayMenuSteps(container, steps);

  appendDayMenuGuide(container, "狙い", exercise?.mainPurpose || dayMenuSectionPurpose(item.section));
  appendDayMenuGuide(container, "意識するポイント", exercise?.cue || item.detail || dayMenuSectionCue(item.section));
  appendDayMenuGuide(container, "成功の感覚", exercise?.successFeeling);
  appendDayMenuGuide(container, "避けること", exercise?.avoid);
  appendDayMenuGuide(container, "終了基準", exercise?.stopCondition || item.session?.stopCondition);
  appendDayMenuGuide(container, "三段跳への接続", exercise?.bridge);
}

function dayMenuFact(label, value) {
  const fact = element("div", "day-menu-detail__fact");
  fact.append(element("span", "", label), element("strong", "", value || "—"));
  return fact;
}

function appendDayMenuGuide(parent, label, value) {
  if (!String(value || "").trim()) return;
  const section = element("section", "day-menu-detail__section");
  section.append(element("h4", "", label), element("p", "", value));
  parent.append(section);
}

function appendDayMenuSteps(parent, steps) {
  const section = element("section", "day-menu-detail__section day-menu-detail__section--steps");
  section.append(element("h4", "", "練習の手順"));
  const list = element("ol", "day-menu-detail__steps");
  steps.forEach(step => list.append(element("li", "", step)));
  section.append(list);
  parent.append(section);
}

function buildDayMenuSteps(item, exercise, score) {
  const splitSteps = splitSprintProcedure(item, score);
  if (splitSteps.length) return splitSteps;

  const instructions = String(exercise?.instructions || "")
    .split(/→|\n+|。+/)
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (instructions.length >= 2) return instructions;

  const steps = [];
  if (isTimedSprintItem(item)) {
    const target = sprintSettingSummary(item, score);
    steps.push("開始前に走路・スタート位置・計時方法を確認し、当日の基準をそろえる。");
    steps.push(`${item.title}を${target}で実施する。最初の1本は力みより姿勢と接地の質を優先する。`);
    steps.push("本数間は次の反復で同じ走姿勢を再現できるまで回復し、タイムだけを追って休息を削らない。");
  } else {
    steps.push(dayMenuFallbackInstructions(item));
    if (exercise?.cue || item.detail) steps.push(`主キューは「${exercise?.cue || item.detail}」。1反復で意識するポイントを増やし過ぎない。`);
  }
  return steps.filter(Boolean).slice(0, 8);
}

function splitSprintProcedure(item, score) {
  const title = String(item.title || "");
  if (!/^\(\s*\d{2,3}m(?:\s*\+\s*\d{2,3}m)+\s*\)×\d+set/i.test(title)) return [];
  const bridgeParts = String(item.session?.bridge || "")
    .split(/→|\n+/)
    .map(value => value.trim())
    .filter(Boolean);
  const distances = sprintDistances(title);
  if (!distances.length) return [];
  const startIndex = bridgeParts.findIndex(part => new RegExp(`^${distances[0]}m\\b`, "i").test(part));
  if (startIndex < 0) return [dayMenuFallbackInstructions(item)];

  const steps = [];
  for (let i = startIndex; i < bridgeParts.length && steps.length < 8; i++) {
    const part = bridgeParts[i];
    const run = part.match(/^(\d{2,3})m\s*(\d{2,3})?(?:\s*[〜~\-]\s*(\d{2,3}))?\s*[%％]?/i);
    if (run) {
      const distance = Number(run[1]);
      const band = targetPercentForDistance(item, score, distance);
      steps.push(`${distance}m：MAX ${formatPercentBand(band)}を目安に走る。姿勢・接地・リズムを崩さず、区間終盤まで速度を運ぶ。`);
      continue;
    }
    if (/^\d+(?:〜\d+)?秒(?:休息)?$/.test(part)) {
      steps.push(`${part.replace(/休息$/, "")}休息。完全に落ち着き過ぎず、次の区間で速さを再構築できる状態に整える。`);
      continue;
    }
    if (/^\d+(?:〜\d+)?分休息$/.test(part)) {
      steps.push(`ここまでを1セットとして${part}。呼吸・脚の張り・接地感を整えてから次セットへ進む。`);
      continue;
    }
    const repeat = part.match(/^同内容(\d+)セット目$/);
    if (repeat) {
      steps.push(`同じ内容を${repeat[1]}セット目まで実施する。1セット目より2〜3％以上低下したら追加しない。`);
      break;
    }
    if (steps.length && !/^\d/.test(part)) break;
  }
  return steps;
}

async function ensureSprintBaselines() {
  if (Array.isArray(state.sprintBaselineMeasurements)) return state.sprintBaselineMeasurements;
  if (state.sprintBaselineLoading) return state.sprintBaselineLoading;
  state.sprintBaselineLoading = records(
    "measurements",
    { sportProfileId: config.sportProfileId, measurementType: "SPRINT_TIME" },
    "date",
    "DESC",
    100
  )
    .then(result => {
      state.sprintBaselineMeasurements = result.records || [];
      return state.sprintBaselineMeasurements;
    })
    .finally(() => { state.sprintBaselineLoading = null; });
  return state.sprintBaselineLoading;
}

function isTimedSprintItem(item) {
  const title = String(item?.title || "");
  return item?.section === "sprint"
    || /^\(\s*\d{2,3}m(?:\s*\+\s*\d{2,3}m)+/.test(title)
    || /\d{2,3}m.*(?:ダッシュ|スプリント|全力走|流し|テンポ|ビルドアップ)/i.test(title);
}

function sprintDistances(title) {
  return [...String(title || "").matchAll(/(\d{2,3})m\b/gi)].map(match => Number(match[1]));
}

function targetPercentForDistance(item, score, distance) {
  const bridge = String(item.session?.bridge || "");
  const match = bridge.match(new RegExp(`${distance}m\\s*(\\d{2,3})(?:\\s*[〜~\\-]\\s*(\\d{2,3}))?\\s*[%％]`, "i"));
  if (match) return [Number(match[1]), Number(match[2] || match[1])];

  const title = String(item.title || "");
  if (/神経プライマー/.test(title) && /ダッシュ/.test(title)) return [95, 100];
  if (/ビルドアップ/.test(title)) return [80, 90];
  if (/テンポ/.test(title)) return [70, 80];
  if (/流し/.test(title)) return [80, 90];
  if (/全力|max-v/i.test(title)) return [98, 100];
  if (score >= 10) return [98, 100];
  if (score === 9) return [95, 98];
  if (score === 8) return [90, 94];
  if (score === 7) return [85, 89];
  if (score === 6) return [80, 84];
  return [70, 79];
}

function sprintSettingSummary(item, score) {
  if (!isTimedSprintItem(item)) return item.dose || "当日の指定どおり";
  const distances = sprintDistances(item.title);
  if (!distances.length) return `MAX ${formatPercentBand(targetPercentForDistance(item, score, null))}`;
  return distances.map(distance => `${distance}m ${formatPercentBand(targetPercentForDistance(item, score, distance))}`).join(" / ");
}

function formatPercentBand(band) {
  const [low, high] = band || [];
  if (!Number.isFinite(low)) return "指定％";
  return low === high ? `${low}%` : `${low}〜${high}%`;
}

function renderSprintTiming(item, score, measurements) {
  const section = element("section", "day-menu-timing");
  const head = element("div", "day-menu-timing__head");
  head.append(element("h4", "", "設定タイム"), element("span", "", "距離別MAX × 指定速度％"));
  section.append(head);

  if (!Array.isArray(measurements)) {
    section.append(element("p", "day-menu-timing__loading", "登録済みのスプリント基準記録を確認中…"));
    return section;
  }

  const distances = sprintDistances(item.title);
  if (!distances.length) {
    section.append(element("p", "day-menu-timing__loading", `目標速度：MAX ${formatPercentBand(targetPercentForDistance(item, score, null))}`));
    return section;
  }

  const grid = element("div", "day-menu-timing__grid");
  distances.forEach(distance => {
    const band = targetPercentForDistance(item, score, distance);
    const baseline = bestSprintBaseline(distance, measurements);
    const card = element("div", "day-menu-timing__card");
    card.append(element("strong", "day-menu-timing__distance", `${distance}m`), element("span", "day-menu-timing__percent", `MAX ${formatPercentBand(band)}`));
    if (baseline) {
      card.append(
        element("b", "day-menu-timing__target", sprintTargetTimeText(baseline.timeSec, band, distance)),
        element("small", "", `参考MAX ${Number(baseline.timeSec).toFixed(2)}秒 / ${formatShortDate(baseline.date)}${baseline.dataQuality === "LIMITED" || baseline.measurementMethod === "UNREPORTED" ? " / 条件未統一" : ""}`)
      );
    } else {
      card.append(
        element("b", "day-menu-timing__target day-menu-timing__target--missing", "基準記録未登録"),
        element("small", "", "距離別MAXを登録すると設定タイムを自動算出します。")
      );
    }
    grid.append(card);
  });
  section.append(grid);
  section.append(element("p", "day-menu-timing__note", "設定タイムは距離別MAXの平均速度比から算出する参考値です。比較時は計時方式・スタート・走路・シューズ等の条件をそろえてください。"));
  return section;
}

function bestSprintBaseline(distance, measurements) {
  return measurements
    .filter(item => Number(item.distanceM) === Number(distance) && Number(item.timeSec || item.measurementValue) > 0)
    .map(item => ({ ...item, timeSec: Number(item.timeSec || item.measurementValue) }))
    .sort((a, b) => a.timeSec - b.timeSec)[0] || null;
}

function sprintTargetTimeText(maxTimeSec, band, distance) {
  const [low, high] = band;
  const fastest = maxTimeSec / (high / 100);
  const slowest = maxTimeSec / (low / 100);
  const digits = distance <= 60 ? 2 : 1;
  return `${fastest.toFixed(digits)}〜${slowest.toFixed(digits)}秒`;
}

function dayMenuSectionPurpose(section) {
  const map = {
    warmup: "体温と可動域を上げ、次の高速動作へ安全につなげる。",
    primer: "神経系を起こし、接地とリズムを鋭くしてメイン練習の質を高める。",
    sprint: "高い走速度と姿勢を保ち、助走速度・スピード持久力へつなげる。",
    main: "助走から踏切・跳躍局面の質を高め、三段跳の実戦動作へつなげる。",
    supplemental: "メイン動作を支える筋力・体幹・出力を補強する。",
    cooldown: "緊張を下げ、回復へ移行する。",
    other: "当日のセッション目的に沿って必要な適応を積み上げる。"
  };
  return map[section] || map.other;
}

function dayMenuSectionCue(section) {
  const map = {
    warmup: "動きを急がず、痛みのない範囲で徐々に可動域と速度を上げる。",
    primer: "力み過ぎず、短い接地とリズムを優先する。",
    sprint: "本数より質を優先し、姿勢・接地・速度が崩れたら休息を延ばす。",
    main: "助走リズムと踏切姿勢を優先し、無理に距離だけを追わない。",
    supplemental: "反動でごまかさず、狙った部位と姿勢を保つ。",
    cooldown: "呼吸を整え、身体の緊張を落とす。",
    other: "当日の目的と指定された量・強度を優先する。"
  };
  return map[section] || map.other;
}

function dayMenuFallbackInstructions(item) {
  const title = String(item.title || "");
  const split = title.match(/^\(([^)]+)\)×(\d+)set(?:\s+rest([0-9〜]+)min)?/i);
  if (split) {
    return `${split[1]}を1セットとして${split[2]}セット実施する。セット内は表記順に走り、${split[3] ? `セット間は${split[3]}分休息する。` : "セット間は十分に回復してから次へ進む。"}`;
  }
  return item.dose ? `${item.title}を「${item.dose}」の設定で実施する。` : `${item.title}を当日のメニュー表記どおり実施する。`;
}

function dayMenuRestFromTitle(title) {
  const match = String(title || "").match(/rest([0-9〜]+)min/i);
  return match ? `${match[1]}分` : "";
}

function intensityBand(score) {
  if (!Number.isFinite(score)) return "medium";
  if (score <= 3) return "low";
  if (score <= 7) return "medium";
  return "high";
}

function resolvedTrainingIntensity(text, session, explicitValue = "") {
  const explicit = itemIntensityScore(explicitValue);
  if (explicit !== null) return explicit;
  return judgeTrainingIntensity(text, session);
}

function itemIntensityScore(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/[・〜~_\s]/g, "-");
  if (!raw) return null;
  const tenScale = raw.match(/(?:^|[^0-9])(10|[1-9])\s*\/\s*10(?:$|[^0-9])/);
  if (tenScale) return Math.max(1, Math.min(10, Number(tenScale[1])));
  if (raw.includes("REST") || raw.includes("RECOVERY")) return 1;
  if (raw.includes("MAX") || raw.includes("COMPETITION")) return 10;
  if (raw.includes("VERY-HIGH")) return 9;
  if (raw.includes("HIGH") && (raw.includes("MEDIUM") || raw.includes("MIDDLE"))) return 8;
  if (raw.includes("HIGH")) return 8;
  if (raw.includes("LOW") && (raw.includes("MEDIUM") || raw.includes("MIDDLE"))) return 4;
  if (raw.includes("MEDIUM") || raw.includes("MIDDLE")) return 6;
  if (raw.includes("LOW")) return 3;
  return null;
}

function bridgeIntensityEstimate(value, session) {
  return judgeTrainingIntensity(value, session);
}

function judgeTrainingIntensity(value, session) {
  const text = String(value || "");
  const normalized = text.toLowerCase();
  const percentages = [...text.matchAll(/(\d{2,3})(?:\s*[〜~\-]\s*(\d{2,3}))?\s*%/g)]
    .flatMap(match => [Number(match[1]), Number(match[2] || match[1])])
    .filter(Number.isFinite);
  if (percentages.length) {
    const peak = Math.max(...percentages);
    if (peak >= 100) return 10;
    if (peak >= 95) return 9;
    if (peak >= 90) return 8;
    if (peak >= 80) return 7;
    if (peak >= 70) return 6;
    if (peak >= 60) return 5;
    return 3;
  }

  const compoundRun = /^\(\s*\d{2,3}m(?:\s*\+\s*\d{2,3}m)+\s*\)×\d+set/i.test(text.trim());
  if (compoundRun) return Math.max(8, sessionIntensity(session) || 8);
  if (/アクティブレスト|active[\s_-]*rest/i.test(text)) return 2;
  if (/^\d+(?:〜\d+)?秒(?:休息)?$/.test(text.trim())) return 1;
  if (/^\d+(?:〜\d+)?分休息$/.test(text.trim())) return 1;
  if (/休息|rest|完全休養|完全休息/.test(normalized)) return 1;
  if (/クール|整理運動|静的ストレッチ|呼吸/.test(normalized)) return 1;
  if (/ウォーム|動的モビリティ|モビリティ|可動域|aマーチ|マーチ/.test(normalized)) return 2;
  if (/aスキップ|スキップ|低振幅ポゴ|ポゴ|ロープフロー|ドリル/.test(normalized)) return 3;
  if (/デッドバグ|ヒラメ筋|soleus|アイソ|プランク|ヒップリフト|補強|体幹/.test(normalized)) return 4;
  if (/メディシン|medicine|\bmb\b|直上投げ|後方投げ/.test(normalized)) return 5;
  if (/ビルドアップ|流し|神経プライマー|primer/.test(normalized)) return 6;
  if (/ランスルー|助走通過|踏切通過|助走チェック/.test(normalized)) return 7;
  if (/全助走.*(?:tj|トリプル|三段跳)|(?:tj|トリプル|三段跳).*全助走|competition|本番/.test(normalized)) return 10;
  if (/バウンディング|ホップ|ステップ|ジャンプ|跳躍|踏切/.test(normalized)) return 8;
  if (/ダッシュ|全力走|max-v|スプリント|tempo|テンポ|\(\s*\d{2,3}m\s*\+|\d{2,3}m/.test(normalized)) {
    return Math.max(8, sessionIntensity(session) || 8);
  }
  if (/スクワット|deadlift|デッドリフト|rdl|split squat|スプリットスクワット|ハイクリーン|クリーン|ベンチ|プレス|筋力|strength/.test(normalized)) {
    return Math.max(6, Math.min(8, sessionIntensity(session) || 6));
  }

  return sessionIntensity(session) || 5;
}

function inferDayMenuSection(value) {
  const text = String(value || "").toLowerCase();
  if (/クール|整理運動|静的ストレッチ/.test(text)) return "cooldown";
  if (/ウォーム|ストレッチ|可動域|モビリティ|腹圧/.test(text)) return "warmup";
  if (/リバースブリッジ|スキップ|ポゴ|ドリル|ロープフロー|プライオ|神経プライマー/.test(text)) return "primer";
  if (/ダッシュ|全力走|max-v|スプリント|流し|テンポ/.test(text)) return "sprint";
  if (/跳躍|助走|踏切|トリプル|バウンディング|ホップ|ステップ|ジャンプ/.test(text)) return "main";
  if (/メディシン|mb|プランク|ヒップリフト|スクワット|補強|体幹|投げ/.test(text)) return "supplemental";
  return "other";
}

function sessionDoseText(session) {
  return [
    session.plannedDistanceM && `${session.plannedDistanceM}m`,
    session.plannedReps && `${session.plannedReps}回`,
    session.plannedSets && `${session.plannedSets}セット`,
    session.plannedWeightKg && `${session.plannedWeightKg}kg`,
    session.plannedRestSec && `休息${session.plannedRestSec}秒`
  ].filter(Boolean).join(" / ");
}

function renderRecordEntry() {
  const box = element("section", "record-entry");
  const heading = element("div", "record-entry__head");
  heading.append(
    element("div", "", ""),
    element("span", "eyebrow", "EXECUTION LOG")
  );
  heading.firstChild.append(
    element("h3", "", "今日の実施記録"),
    element("p", "", "音声でも手入力でもOK。保存前に内容を確認します。")
  );

  const actions = element("div", "record-actions");
  const voice = element("button", "record-button record-button--voice", "●  音声で記録");
  const manual = element("button", "record-button record-button--manual", "✎  手入力で記録");
  voice.type = manual.type = "button";
  voice.addEventListener("click", () => openRecordDialog("voice"));
  manual.addEventListener("click", () => openRecordDialog("manual"));
  actions.append(voice, manual);
  box.append(heading, actions);

  const privacy = element("p", "record-entry__note", "入力内容は承認するまでGoogle Sheetsへ保存しません。音声そのものは保存対象にしません。");
  box.append(privacy);
  return box;
}

function openRecordDialog(mode) {
  const dialog = element("dialog", "record-dialog");
  const form = element("form", "record-dialog__card");
  form.method = "dialog";

  const top = element("div", "record-dialog__top");
  const title = element("div");
  title.append(
    element("span", "eyebrow eyebrow--cyan", mode === "voice" ? "VOICE INPUT" : "MANUAL INPUT"),
    element("h3", "", mode === "voice" ? "音声で実施記録" : "手入力で実施記録")
  );
  const close = element("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => dialog.close());
  top.append(title, close);

  const meta = element("div", "record-meta");
  const primary = (state.dayContext?.sessions || [])[0];
  meta.append(
    metaItem("日付", formatJapaneseDate(state.selectedDate)),
    metaItem("セッション", primary?.role || primary?.title || "—"),
    metaItem("強度", intensityText(sessionIntensity(primary)))
  );

  let plannedMenu = null;
  if (mode === "voice") {
    plannedMenu = element("section", "record-planned-menu");
    plannedMenu.setAttribute("aria-label", "本日の練習内容");

    const plannedHead = element("div", "record-planned-menu__head");
    plannedHead.append(
      element("strong", "", "本日の練習内容"),
      element("span", "", "見ながらそのまま音声入力できます")
    );

    const plannedList = element("ul", "record-planned-menu__list");
    const context = state.dayContext || {};
    const sessions = context.sessions || [];
    const entries = dayMenuEntries(context, sessions);
    if (entries.length) {
      entries.forEach(item => plannedList.append(element("li", "", item.title)));
    } else {
      plannedList.append(element("li", "record-planned-menu__empty", "この日の詳細メニューは登録されていません。"));
    }
    plannedMenu.append(plannedHead, plannedList);
  }

  const transcript = element("textarea", "record-textarea");
  transcript.rows = 9;
  transcript.placeholder = mode === "voice"
    ? "話し言葉のままでOK。種目、本数・距離・タイム・重量、良かった点、課題、痛み・張りなどを話すと、練習記録として整理します。"
    : "例：ウォームアップはジョグ20分。バウンディング20mを2本。助走は良かったが、後半は少し脚が重かった。";
  transcript.setAttribute("aria-label", "実施内容");

  const voiceTools = element("div", "voice-tools");
  let recognition = null;
  let listening = false;
  const voiceStatus = element("p", "voice-status", mode === "voice" ? "マイク開始ボタンを押してください。" : "");
  if (mode === "voice") {
    const mic = element("button", "mic-button", "●");
    mic.type = "button";
    const micLabel = element("span", "mic-label", "音声入力を開始");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      mic.disabled = true;
      micLabel.textContent = "このブラウザでは音声認識を利用できません。手入力をご利用ください。";
    } else {
      mic.addEventListener("click", () => {
        if (listening) {
          recognition?.stop();
          return;
        }
        recognition = new Recognition();
        recognition.lang = "ja-JP";
        recognition.continuous = true;
        recognition.interimResults = true;
        let finalText = transcript.value;
        recognition.onstart = () => {
          listening = true;
          mic.dataset.listening = "true";
          micLabel.textContent = "録音中…タップで停止";
          voiceStatus.textContent = "話した内容をリアルタイムで文字にしています。";
        };
        recognition.onresult = event => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const value = event.results[i][0]?.transcript || "";
            if (event.results[i].isFinal) finalText += `${value}。`;
            else interim += value;
          }
          transcript.value = `${finalText}${interim}`;
        };
        recognition.onerror = event => {
          voiceStatus.textContent = `音声認識を終了しました: ${event.error || "不明なエラー"}`;
        };
        recognition.onend = () => {
          listening = false;
          mic.dataset.listening = "false";
          micLabel.textContent = "音声入力を再開";
        };
        recognition.start();
      });
    }
    voiceTools.append(mic, micLabel, voiceStatus);
  }

  const organize = element("button", "organize-button", "練習記録に整理する");
  organize.type = "button";
  const preview = element("div", "draft-preview");
  preview.hidden = true;
  const save = element("button", "approve-button", "承認して保存");
  save.type = "button";
  save.disabled = true;
  const systemNote = element("p", "draft-system-note", "");

  organize.addEventListener("click", () => {
    const value = transcript.value.trim();
    if (!value) {
      systemNote.textContent = "実施内容を入力してください。";
      return;
    }
    const draft = summarizeTrainingRecord(value);
    const sections = [
      ["実施内容", draft.actions],
      ["数値・結果", draft.records],
      ["良かった点", draft.positives],
      ["課題・改善点", draft.issues],
      ["身体反応・コンディション", draft.condition]
    ].filter(([, items]) => items.length);
    preview.replaceChildren(
      element("span", "eyebrow", "SAVE PREVIEW"),
      element("h4", "", "練習記録として整理した内容"),
      ...sections.map(([title, items]) => draftList(title, items))
    );
    preview.hidden = false;
    systemNote.textContent = "話し言葉から事実だけを整理しています。原文にない内容は補いません。保存前に必ず確認してください。";
    save.disabled = false;
  });

  save.addEventListener("click", () => {
    systemNote.textContent = "現在のAPOS Viewは閲覧専用です。実データ保存はAPOS Coreの書込機能を追加し、Preview→承認→Apply→Verifyを通す実装後に有効化します。";
  });

  form.append(top, meta);
  if (mode === "voice") form.append(plannedMenu, voiceTools);
  form.append(transcript, organize, preview, save, systemNote);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    try { recognition?.stop(); } catch {}
    dialog.remove();
  });
  dialog.showModal();
}

function summarizeTrainingRecord(text) {
  const chunks = segmentTrainingSpeech(text);
  const actions = [];
  const records = [];
  const positives = [];
  const issues = [];
  const condition = [];

  const positiveWords = /良かった|良い|よかった|できた|成功|安定|スムーズ|軽かった|速かった|余裕|狙いどおり|狙い通り|感覚が良/;
  const issueWords = /課題|難しかった|できなかった|失敗|崩れ|崩れた|悪かった|合わなかった|遅かった|ばらつ|バラつ|詰まった|不足|改善|気になった/;
  const conditionWords = /痛|張り|違和感|疲労|疲れ|重かった|重い|だる|硬い|攣|つり|腫れ|脚|足首|膝|腰|ハム|ふくらはぎ|アキレス|体調/;
  const actionWords = /実施|やった|行った|走った|跳んだ|投げた|上げた|挙げた|ウォーム|ジョグ|流し|スプリント|ダッシュ|助走|踏切|跳躍|バウンディング|ポゴ|ドリル|スクワット|クリーン|デッドリフト|プレス|補強|ストレッチ|モビリティ|セット|本|回|kg|キロ|秒|分|cm|mm|m\b|％|%/i;

  chunks.forEach(chunk => {
    const value = normalizeSpokenTrainingText(chunk);
    if (!value) return;

    const isCondition = conditionWords.test(value);
    const isPositive = positiveWords.test(value);
    const isIssue = issueWords.test(value);
    const isAction = actionWords.test(value) || hasTrainingMetric(value);
    const record = extractTrainingRecord(value);

    if (isAction) pushUnique(actions, value, 10);
    if (record) pushUnique(records, record, 10);
    if (isPositive) pushUnique(positives, value, 6);
    if (isIssue) pushUnique(issues, value, 6);
    if (isCondition) pushUnique(condition, value, 6);

    if (!isAction && !isPositive && !isIssue && !isCondition) {
      pushUnique(issues, value, 6);
    }
  });

  if (!actions.length && chunks.length) {
    chunks.slice(0, 8).forEach(chunk => pushUnique(actions, normalizeSpokenTrainingText(chunk), 8));
  }

  return { actions, records, positives, issues, condition };
}

function segmentTrainingSpeech(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[！？!?]+/g, "。")
    .replace(/\n+/g, "。")
    .replace(/(?:^|。)\s*(?:それで|そのあと|あと|次に|最後に)[、,\s]*/g, "。")
    .split(/。+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function normalizeSpokenTrainingText(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:えーと|えっと|あの|その|なんか|まあ|えー|うーん)[、,\s]*/g, "")
    .replace(/^(?:で|それで|あと|次に|最後に)[、,\s]+/g, "")
    .replace(/[、,]\s*(?:えーと|えっと|あの|なんか|まあ)[、,\s]*/g, "、")
    .replace(/(?:っていう感じ|という感じ|みたいな感じ)(?:です|でした)?$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[、,\s]+|[、,\s]+$/g, "")
    .trim();
}

function hasTrainingMetric(value) {
  return /\d+(?:\.\d+)?\s*(?:kg|キロ|km|m|cm|mm|秒|分|時間|本|回|セット|set|sets|rep|reps|％|%)/i.test(String(value || ""));
}

function extractTrainingRecord(value) {
  const source = String(value || "");
  const metricPattern = /\d+(?:\.\d+)?(?:\s*[〜~\-]\s*\d+(?:\.\d+)?)?\s*(?:kg|キロ|km|m|cm|mm|秒|分|時間|本|回|セット|set|sets|rep|reps|％|%)/gi;
  const matches = [...source.matchAll(metricPattern)];
  if (!matches.length) {
    return /タイム|記録|ベスト|成功|失敗|クリア|RPE/i.test(source) ? source : "";
  }
  const metrics = [...new Set(matches.map(match => match[0].replace(/\s+/g, "")))];
  const first = matches[0];
  const prefix = source
    .slice(0, first.index)
    .replace(/[はをでがの：:\s、,]+$/g, "")
    .trim();
  const label = prefix && prefix.length <= 28 ? prefix : "";
  return `${label ? `${label}：` : ""}${metrics.join(" / ")}`;
}

function pushUnique(list, value, limit) {
  const normalized = String(value || "").trim();
  if (!normalized || list.includes(normalized) || list.length >= limit) return;
  list.push(normalized);
}

function draftList(title, items) {
  const group = element("div", "draft-group");
  group.append(element("strong", "", title));
  const list = element("ul");
  items.forEach(item => list.append(element("li", "", item)));
  group.append(list);
  return group;
}

function renderWeekView() {
  const wrap = element("div", "week-view");
  wrap.append(renderPeriodNavigator("week"));
  const start = startOfWeek(state.selectedDate || state.today);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const header = sectionHeader("今週のトレーニング", `${formatJapaneseDate(dates[0])} – ${formatJapaneseDate(dates[6])}`);
  const scores = dates.map(date => daySessions(date).map(sessionIntensity).filter(value => value !== null)).flat();
  const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—";
  header.append(pill(`週平均 ${average}/10`, true));
  wrap.append(header);

  const list = element("div", "week-list");
  dates.forEach(date => {
    const sessions = daySessions(date);
    const primary = sessions[0] || null;
    const score = sessionIntensity(primary);
    const card = element("button", "week-day");
    card.type = "button";
    card.dataset.today = String(date === state.today);

    const top = element("div", "week-day__top");
    top.append(
      element("span", "week-day__date", `${weekdayName(date)} ${date.slice(5).replace("-", "/")}`),
      element("span", "week-day__role", compactTrainingLabel(primary)),
      intensityMini(score)
    );
    card.append(top);

    const title = primary?.title || primary?.role || "予定なし";
    card.append(element("strong", "week-day__body", title));

    const details = sessionOutline(primary);
    if (details.length) {
      const detailList = element("ul", "week-day__details");
      details.forEach(item => detailList.append(element("li", "", item)));
      card.append(detailList);
    }

    if (primary?.purpose) {
      const intent = element("p", "week-day__intent");
      intent.append(element("span", "", "目的"), document.createTextNode(` ${primary.purpose}`));
      card.append(intent);
    }
    if (primary?.cue) {
      const cue = element("p", "week-day__cue");
      cue.append(element("span", "", "キュー"), document.createTextNode(` ${primary.cue}`));
      card.append(cue);
    }
    if (primary?.requirements) {
      const requirements = element("p", "week-day__requirements");
      requirements.append(element("span", "", "条件"), document.createTextNode(` ${primary.requirements}`));
      card.append(requirements);
    }
    if (primary?.stopCondition) {
      const stop = element("p", "week-day__stop");
      stop.append(element("span", "", "終了基準"), document.createTextNode(` ${primary.stopCondition}`));
      card.append(stop);
    }

    card.addEventListener("click", () => loadDayContext(date).catch(showFatalError));
    list.append(card);
  });
  wrap.append(list);
  return wrap;
}

function renderMonthView() {
  const wrap = element("div", "month-view");
  wrap.append(renderPeriodNavigator("month"));
  const [year, month] = (state.selectedDate || state.today).split("-").map(Number);
  wrap.append(sectionHeader("月間トレーニング", `${year}年${month}月`));

  const grid = element("div", "month-grid");
  ["月", "火", "水", "木", "金", "土", "日"].forEach(label => grid.append(element("div", "month-label", label)));

  const first = `${year}-${pad(month)}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.append(element("div", "month-day month-day--empty"));

  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const sessions = daySessions(date);
    const primary = sessions[0] || null;
    const score = sessionIntensity(primary);
    const cell = element("button", "month-day");
    cell.type = "button";
    cell.dataset.today = String(date === state.today);
    cell.append(element("span", "month-day__number", String(day)));
    if (score !== null) cell.append(intensityMini(score));
    if (primary) {
      cell.append(
        element("span", "month-day__role", compactTrainingLabel(primary)),
        element("span", "month-day__main", monthMainText(primary))
      );
    }
    cell.addEventListener("click", () => loadDayContext(date).catch(showFatalError));
    grid.append(cell);
  }
  wrap.append(grid);
  return wrap;
}

function renderPeriodNavigator(mode) {
  const labels = {
    day: ["← 前日", "翌日 →"],
    week: ["← 前週", "翌週 →"],
    month: ["← 前月", "翌月 →"]
  };
  const nav = element("div", "period-nav");
  const previous = element("button", "period-nav__button", labels[mode][0]);
  const today = element("button", "period-nav__today", "今日へ");
  const next = element("button", "period-nav__button", labels[mode][1]);
  previous.type = today.type = next.type = "button";
  previous.addEventListener("click", () => navigatePeriod(mode, -1).catch(showFatalError));
  next.addEventListener("click", () => navigatePeriod(mode, 1).catch(showFatalError));
  today.addEventListener("click", () => navigateToToday(mode).catch(showFatalError));
  nav.append(previous, today, next);
  return nav;
}

async function navigatePeriod(mode, direction) {
  const current = state.selectedDate || state.today;
  setConnection("idle", "期間データ取得中");
  if (mode === "day") {
    await loadDayContext(addDays(current, direction));
    return;
  }
  if (mode === "week") {
    state.selectedDate = addDays(current, direction * 7);
    const start = startOfWeek(state.selectedDate);
    await ensureSessionsForRange(start, addDays(start, 6));
  } else {
    state.selectedDate = addMonths(current, direction);
    const range = monthRange(state.selectedDate);
    await ensureSessionsForRange(range.start, range.end);
  }
  renderDashboard();
  setConnection("ready", "最新データ");
}

async function navigateToToday(mode) {
  state.selectedDate = state.today;
  if (mode === "day") {
    await loadDayContext(state.today);
    return;
  }
  if (mode === "week") {
    const start = startOfWeek(state.today);
    await ensureSessionsForRange(start, addDays(start, 6));
  } else {
    const range = monthRange(state.today);
    await ensureSessionsForRange(range.start, range.end);
  }
  state.viewMode = mode;
  renderDashboard();
  setConnection("ready", "最新データ");
}

async function ensureSessionsForRange(start, end, { force = false } = {}) {
  const rangeKey = `${start}|${end}`;
  if (!force && state.loadedSessionRanges.has(rangeKey)) return;
  setConnection("idle", "期間データ取得中");
  const result = await records(
    "sessions",
    { sessionDate: { $gte: start, $lte: end }, sportProfileId: config.sportProfileId },
    "sessionDate",
    "ASC",
    100
  );
  replaceSessionsForRange(start, end, result.records || []);
  state.loadedSessionRanges.add(rangeKey);
  setConnection("ready", "最新データ");
}

function replaceSessionsForRange(start, end, incoming) {
  const outside = state.sessions.filter(item => {
    const date = dateOnly(item.sessionDate);
    return !date || date < start || date > end;
  });
  const merged = new Map(outside.map(item => [item.sessionId, item]));
  incoming.forEach(item => merged.set(item.sessionId, item));
  state.sessions = [...merged.values()].sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)));
}

function sessionOutline(session) {
  if (!session) return [];
  const raw = String(session.bridge || "").trim();
  if (!raw) return session.purpose ? [session.purpose] : [];
  return compactBridgeItems(raw);
}

function sessionHighlights(session, maxItems = 3) {
  if (!session) return [];
  const outline = sessionOutline(session);
  if (!outline.length) return [];
  const mainPattern = /全助走|短助走|トリプル|跳躍|踏切|ダッシュ|全力走|スプリント|max-v|ハングクリーン|クリーン|スクワット|bsq|バウンディング|テンポ|ポゴ|メディシン|mb|投げ/i;
  const warmupPattern = /ウォーム|ストレッチ|モビリティ|可動域|腹圧|深部体幹/i;
  const prioritized = [
    ...outline.filter(item => mainPattern.test(item) && !warmupPattern.test(item)),
    ...outline.filter(item => !mainPattern.test(item) && !warmupPattern.test(item)),
    ...outline.filter(item => warmupPattern.test(item))
  ];
  return [...new Set(prioritized)].slice(0, maxItems);
}

function compactTrainingLabel(session) {
  if (!session) return "—";
  const raw = [session.role, session.title, session.intensity].filter(Boolean).join(" ").toUpperCase();
  if (/REST/.test(raw) && !/ACTIVE/.test(raw)) return "REST";
  if (/RECOVERY|ACTIVE_REST|CONDITION/.test(raw)) return "REC";
  if (/COMPETITION|MEET|SPECIFIC|SIMULATION/.test(raw)) return "SPEC";
  if (/WEIGHT|POWER|STRENGTH|CLEAN|SQUAT/.test(raw)) return "POW";
  if (/TRIPLE|JUMP|跳躍/.test(raw)) return "JUMP";
  if (/RUN-UP|CONTROL|APPROACH|助走/.test(raw)) return "RUN";
  if (/PLYOMETRIC|ELASTIC|BOUND|POGO/.test(raw)) return "ELASTIC";
  if (/SPEED|SPRINT|MAX-V|ENDURANCE/.test(raw)) return "SPEED";
  return shortLabel(session.role || session.title || "PLAN").slice(0, 8);
}

function monthMainText(session) {
  const highlights = sessionHighlights(session, 2);
  if (highlights.length) return highlights.join(" / ");
  return session.title || session.purpose || session.role || "";
}

function renderSecondaryWorkspace() {
  const shell = element("section", "secondary-workspace panel--wide");
  const nav = element("nav", "secondary-tabs");
  nav.setAttribute("aria-label", "データセクション");
  [
    ["history", "実施記録"],
    ["exercises", "種目ライブラリ"],
    ["measurements", "計測基準・記録"]
  ].forEach(([view, label]) => {
    const button = element("button", "secondary-tab", label);
    button.type = "button";
    button.dataset.active = String(state.secondaryView === view);
    button.setAttribute("aria-pressed", String(state.secondaryView === view));
    button.addEventListener("click", () => switchSecondaryView(view).catch(showFatalError));
    nav.append(button);
  });

  const content = element("div", "secondary-content");
  if (state.secondaryView === "exercises") content.append(renderExercises());
  else if (state.secondaryView === "measurements") content.append(renderMeasurements());
  else content.append(renderHistory());
  shell.append(nav, content);
  return shell;
}

async function switchSecondaryView(view) {
  state.secondaryView = view;
  if (view !== "measurements" || state.measurementTrendsLoaded || state.measurementLoading) {
    renderDashboard();
    return;
  }
  state.measurementLoading = true;
  renderDashboard();
  try {
    const result = await records("measurements", { sportProfileId: config.sportProfileId }, "date", "DESC", 30);
    state.measurements = result.records || [];
    state.measurementTrendsLoaded = true;
  } finally {
    state.measurementLoading = false;
    renderDashboard();
  }
}

async function searchExerciseLibrary(query) {
  const normalized = String(query || "").trim();
  state.exerciseSearchQuery = normalized;
  state.exerciseSearchError = "";
  if (!normalized) {
    state.exerciseSearchResults = null;
    renderDashboard();
    return;
  }
  state.exerciseSearchLoading = true;
  renderDashboard();
  try {
    const result = await api("searchExercises", { query: normalized, includeArchived: false, limit: 20 });
    state.exerciseSearchResults = result.results || [];
  } catch (error) {
    state.exerciseSearchResults = [];
    state.exerciseSearchError = error?.message || "検索できませんでした。";
  } finally {
    state.exerciseSearchLoading = false;
    renderDashboard();
  }
}

function renderHistory() {
  const panel = element("section", "secondary-panel");
  panel.append(sectionHeader("最近の実施記録", "保存済み＋REST自動判定"));
  const list = element("div", "card-list");
  const items = combinedHistoryItems().slice(0, 8);
  if (!state.secondaryLoaded) list.append(empty("バックグラウンドで読み込み中…"));
  else if (!items.length) list.append(empty("実施記録はまだありません。"));
  items.forEach(item => {
    if (item.kind === "rest") {
      list.append(recordCard(
        "REST完遂（自動判定）",
        formatJapaneseDate(item.date),
        `${item.session.title || "完全休養"} / 当日の実施記録が0件のため完遂扱い`
      ));
      return;
    }
    const execution = item.execution;
    list.append(recordCard(
      execution.exerciseName || execution.exerciseId || "実施記録",
      formatJapaneseDate(dateOnly(execution.executionDate)),
      [execution.successes, execution.improvements, execution.voiceTranscriptNormalized].filter(Boolean).join(" / ")
    ));
  });
  panel.append(list);
  return panel;
}

function combinedHistoryItems() {
  const executionDates = new Set(state.executions.map(item => dateOnly(item.executionDate)).filter(Boolean));
  const executionItems = state.executions.map(execution => ({
    kind: "execution",
    date: dateOnly(execution.executionDate),
    sortKey: `${dateOnly(execution.executionDate)}T${execution.recordedAt || "23:59:59"}`,
    execution
  }));
  const restItems = state.historySessions
    .filter(session => isExplicitCompletedRest(session, executionDates))
    .map(session => ({
      kind: "rest",
      date: dateOnly(session.sessionDate),
      sortKey: `${dateOnly(session.sessionDate)}T23:59:58`,
      session
    }));
  return [...executionItems, ...restItems].sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
}

function isExplicitCompletedRest(session, executionDates) {
  const date = dateOnly(session?.sessionDate);
  if (!date || date >= state.today || executionDates.has(date)) return false;
  const role = String(session.role || "").toUpperCase();
  const title = String(session.title || "");
  const intensity = String(session.intensity || "").toUpperCase();
  const requirements = String(session.requirements || "");
  if (/ACTIVE[\s_-]*REST/.test(role) || /アクティブレスト/.test(title)) return false;
  return role === "REST"
    || role === "COMPLETE REST"
    || intensity === "REST"
    || /noTraining\s*=\s*true/i.test(requirements)
    || /完全(?:レスト|休養)/.test(`${title} ${session.bridge || ""}`);
}

function renderExercises() {
  const panel = element("section", "secondary-panel");
  const count = state.exerciseSearchResults === null ? state.exercises.length : state.exerciseSearchResults.length;
  panel.append(sectionHeader("種目ライブラリ", state.exerciseSearchLoading ? "検索中" : `${count}件表示`));

  const form = element("form", "exercise-search");
  const input = element("input", "exercise-search__input");
  input.type = "search";
  input.value = state.exerciseSearchQuery;
  input.placeholder = "種目名・別名・目的で検索";
  input.setAttribute("aria-label", "種目ライブラリを検索");
  const submit = element("button", "exercise-search__button", state.exerciseSearchLoading ? "検索中…" : "検索");
  submit.type = "submit";
  submit.disabled = state.exerciseSearchLoading;
  form.append(input, submit);
  if (state.exerciseSearchQuery) {
    const clear = element("button", "exercise-search__clear", "クリア");
    clear.type = "button";
    clear.addEventListener("click", () => searchExerciseLibrary("").catch(showFatalError));
    form.append(clear);
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    searchExerciseLibrary(input.value).catch(showFatalError);
  });
  panel.append(form);

  const list = element("div", "card-list exercise-results");
  if (state.exerciseSearchLoading) {
    list.append(empty("正本の種目マスターを検索しています…"));
  } else if (state.exerciseSearchError) {
    list.append(element("div", "error", state.exerciseSearchError));
  } else {
    const entries = state.exerciseSearchResults === null
      ? state.exercises.slice(0, 6).map(exercise => ({ exercise, matchedFields: [] }))
      : state.exerciseSearchResults;
    if (!entries.length) list.append(empty("該当する種目はありません。別のキーワードを試してください。"));
    entries.forEach(entry => {
      const exercise = entry.exercise || entry;
      list.append(exerciseLibraryCard(exercise, entry.matchedFields || []));
    });
  }
  panel.append(list);
  return panel;
}

function exerciseLibraryCard(exercise, matchedFields = []) {
  const card = element("button", "record-card exercise-card");
  card.type = "button";
  const top = element("div", "record-card__top");
  top.append(
    element("h3", "", exercise.yukiName || exercise.generalName || exercise.exerciseId || "種目"),
    pill(exercise.category || "EXERCISE", true)
  );
  card.append(top);
  const body = [
    exercise.mainPurpose,
    exercise.initialPrescription,
    exercise.rest ? `休息 ${exercise.rest}` : ""
  ].filter(Boolean).join(" / ");
  if (body) card.append(element("p", "", body));
  if (matchedFields.length) card.append(element("p", "exercise-match", `一致: ${matchedFields.join("・")}`));
  card.append(element("span", "exercise-card__open", "詳細を見る →"));
  card.addEventListener("click", () => openExerciseDetail(exercise.exerciseId).catch(showFatalError));
  return card;
}

async function openExerciseDetail(exerciseId) {
  if (!exerciseId) return;
  let exercise = state.exerciseDetailCache.get(exerciseId);
  if (!exercise) {
    state.exerciseDetailLoadingId = exerciseId;
    setConnection("idle", "種目詳細取得中");
    try {
      const result = await api("getRecord", { entity: "exercises", key: exerciseId });
      exercise = result.record || null;
      if (!exercise) throw new Error("種目マスターの詳細を取得できませんでした。");
      state.exerciseDetailCache.set(exerciseId, exercise);
    } finally {
      state.exerciseDetailLoadingId = "";
      setConnection("ready", "最新データ");
    }
  }
  showExerciseDetailDialog(exercise);
}

function showExerciseDetailDialog(exercise) {
  const dialog = element("dialog", "exercise-dialog");
  const card = element("div", "exercise-dialog__card");
  const top = element("div", "exercise-dialog__top");
  const heading = element("div");
  heading.append(
    element("span", "eyebrow eyebrow--cyan", exercise.category || "EXERCISE MASTER"),
    element("h2", "", exercise.yukiName || exercise.generalName || exercise.exerciseId || "種目詳細")
  );
  const close = element("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => dialog.close());
  top.append(heading, close);

  const summary = element("div", "exercise-detail-summary");
  summary.append(
    metaItem("強度", exercise.intensity || "未登録"),
    metaItem("標準設定", exercise.initialPrescription || "未登録"),
    metaItem("休息", exercise.rest || "未登録")
  );
  card.append(top, summary);
  appendExerciseDetail(card, "目的", exercise.mainPurpose);
  appendExerciseDetail(card, "やり方・手順", exercise.instructions);
  appendExerciseDetail(card, "意識するポイント", exercise.cue);
  appendExerciseDetail(card, "成功の感覚", exercise.successFeeling);
  appendExerciseDetail(card, "対象能力", exercise.targetAbility);
  appendExerciseDetail(card, "避けること", exercise.avoid);
  appendExerciseDetail(card, "終了基準", exercise.stopCondition);
  appendExerciseDetail(card, "三段跳への接続", exercise.bridge);
  appendExerciseDetail(card, "器具", exercise.equipment);

  dialog.append(card);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

function appendExerciseDetail(parent, label, value) {
  if (!String(value || "").trim()) return;
  const section = element("section", "exercise-detail-section");
  section.append(element("h3", "", label), element("p", "", value));
  parent.append(section);
}

function renderMeasurements() {
  const panel = element("section", "secondary-panel");
  panel.append(sectionHeader("計測基準・記録", state.measurementTrendsLoaded ? "値の出所・計測条件を明示" : "参考値の根拠を表示"));
  if (state.measurementLoading) {
    const loading = element("div", "metric-grid");
    loading.append(empty("計測データを読み込み中…"));
    panel.append(loading);
    return panel;
  }

  const sprintItems = state.measurements.filter(item => item.measurementType === "SPRINT_TIME");
  const conditionItems = state.measurements.filter(item => item.measurementType !== "SPRINT_TIME");

  const sprintBlock = element("section", "measurement-block");
  const sprintHead = element("div", "measurement-block__head");
  sprintHead.append(
    element("h3", "", "スプリント基準記録"),
    element("p", "", "設定タイム算出に使う距離別の参考MAX。実測・申告の別と計測条件をそのまま表示します。")
  );
  sprintBlock.append(sprintHead);
  const sprintGrid = element("div", "metric-grid metric-grid--sprint");
  const sprintGroups = sprintMeasurementGroups(sprintItems);
  if (!sprintGroups.length) sprintGrid.append(empty("スプリント基準記録はまだありません。"));
  sprintGroups.forEach(([distance, items]) => sprintGrid.append(sprintBaselineMetricCard(distance, items)));
  sprintBlock.append(sprintGrid);
  panel.append(sprintBlock);

  const conditionBlock = element("section", "measurement-block");
  const conditionHead = element("div", "measurement-block__head");
  conditionHead.append(
    element("h3", "", "コンディション実測"),
    element("p", "", "睡眠・安静時心拍・HRVなど、正本に実測記録がある項目だけを表示します。推定値は作りません。")
  );
  conditionBlock.append(conditionHead);
  const conditionGrid = element("div", "metric-grid");
  const groups = groupMeasurements(conditionItems);
  if (!groups.length) {
    conditionGrid.append(empty("現在、日々のコンディション実測値は正本に登録されていません。登録されるまで推定表示は行いません。"));
  } else {
    groups.slice(0, 8).forEach(([type, items]) => conditionGrid.append(measurementMetricCard(type, items)));
  }
  conditionBlock.append(conditionGrid);
  panel.append(conditionBlock);
  return panel;
}

function sprintMeasurementGroups(items) {
  const groups = new Map();
  items.forEach(item => {
    const distance = Number(item.distanceM);
    if (!Number.isFinite(distance) || distance <= 0) return;
    if (!groups.has(distance)) groups.set(distance, []);
    groups.get(distance).push(item);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function sprintBaselineMetricCard(distance, items) {
  const baseline = bestSprintBaseline(distance, items) || items.at(-1) || {};
  const card = element("article", "metric-card metric-card--baseline");
  const top = element("div", "metric-card__top");
  top.append(
    element("span", "metric-card__label", `${distance}m 基準MAX`),
    element("span", "metric-card__date", sprintMeasurementDateLabel(baseline))
  );
  const value = element("div", "metric-card__value");
  value.append(
    element("strong", "", Number.isFinite(Number(baseline.timeSec || baseline.measurementValue)) ? `${Number(baseline.timeSec || baseline.measurementValue).toFixed(2)}` : "—"),
    element("span", "", baseline.unit || "s")
  );
  card.append(top, value);

  const source = element("div", "metric-card__source");
  source.append(
    element("span", "", measurementQualityLabel(baseline)),
    element("span", "", measurementMethodLabel(baseline.measurementMethod))
  );
  card.append(source);
  if (baseline.measurementConditions) card.append(element("p", "metric-card__conditions", baseline.measurementConditions));
  if (baseline.notes) card.append(element("p", "metric-card__note", baseline.notes));
  return card;
}

function sprintMeasurementDateLabel(item) {
  const text = `${item?.measurementConditions || ""} ${item?.notes || ""}`;
  if (/実計測日不明/.test(text)) return `実計測日 不明 / 登録 ${formatShortDate(item?.date)}`;
  return `計測 ${formatShortDate(item?.date)}`;
}

function measurementMethodLabel(method) {
  const labels = {
    MANUAL: "手動計時",
    ELECTRONIC: "電子計時",
    VIDEO: "動画計時",
    UNREPORTED: "計時方式未報告"
  };
  return labels[String(method || "").toUpperCase()] || "計時方式未登録";
}

function measurementQualityLabel(item) {
  if (String(item?.dataQuality || "").toUpperCase() === "LIMITED") return "参考値・条件限定";
  if (String(item?.evaluation || "").toUpperCase() === "REFERENCE_ONLY") return "参考値";
  return "実測記録";
}

function groupMeasurements(items) {
  const groups = new Map();
  items.forEach(item => {
    const type = item.measurementType || item.exerciseName || "MEASUREMENT";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(item);
  });
  return [...groups.entries()]
    .map(([type, values]) => [type, values.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))])
    .sort((a, b) => String(b[1].at(-1)?.date || "").localeCompare(String(a[1].at(-1)?.date || "")));
}

function measurementMetricCard(type, items) {
  const latest = items.at(-1) || {};
  const card = element("article", "metric-card");
  const top = element("div", "metric-card__top");
  top.append(
    element("span", "metric-card__label", measurementLabel(type)),
    element("span", "metric-card__date", formatJapaneseDate(dateOnly(latest.date)))
  );
  const value = element("div", "metric-card__value");
  value.append(
    element("strong", "", latest.measurementValue ?? "—"),
    element("span", "", latest.unit || "")
  );
  card.append(top, value);

  const numeric = items
    .map(item => Number(item.measurementValue))
    .filter(number => Number.isFinite(number));
  if (numeric.length >= 2) card.append(measurementSparkline(numeric));
  else card.append(element("p", "metric-card__note", "推移グラフは同じ項目が2点以上になると表示されます。"));
  return card;
}

function measurementSparkline(values) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 240 56");
  svg.setAttribute("class", "metric-sparkline");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "計測値の推移");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 120 : 6 + (index / (values.length - 1)) * 228;
    const y = 48 - ((value - min) / range) * 40;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points);
  line.setAttribute("class", "metric-sparkline__line");
  svg.append(line);
  return svg;
}

function measurementLabel(type) {
  const labels = {
    RESTING_HR: "安静時心拍数",
    HRV: "HRV",
    SLEEP_DURATION: "睡眠時間",
    SLEEP_SCORE: "睡眠スコア",
    ACTIVE_KCAL: "消費カロリー",
    SPO2: "血中酸素",
    BODY_TEMPERATURE: "体表温度",
    TJ_JUMP_DISTANCE: "三段跳 跳躍距離",
    TJ_RUNUP_STEP: "助走歩数",
    CALF_CIRC: "ふくらはぎ周径",
    FOREARM_CIRC: "前腕周径"
  };
  return labels[type] || String(type || "計測").replaceAll("_", " ");
}

function intensityCard(score) {
  const box = element("div", "intensity-card");
  box.dataset.intensityBand = intensityBand(score);
  box.append(
    element("span", "intensity-card__label", "練習強度"),
    element("strong", "", score === null ? "— / 10" : `${score} / 10`)
  );
  const track = element("span", "intensity-track");
  const fill = element("span", "intensity-track__fill");
  fill.style.width = `${score === null ? 0 : score * 10}%`;
  track.append(fill);
  box.append(track);
  return box;
}

function intensityMini(score) {
  const mini = element("span", "intensity-mini", score === null ? "—/10" : `${score}/10`);
  if (score !== null) mini.dataset.intensityBand = intensityBand(score);
  return mini;
}

function sessionIntensity(session) {
  if (!session) return null;
  const raw = String(session.intensity || session.role || "").toUpperCase().replace(/[・〜~_\s]/g, "-");
  if (!raw) return null;
  if (raw.includes("MAX") || raw.includes("PERFORMANCE") || raw.includes("COMPETITION")) return 10;
  if (raw.includes("HIGH") && raw.includes("MEDIUM")) return 8;
  if (raw.includes("HIGH")) return 9;
  if (raw.includes("LOW") && raw.includes("MEDIUM")) return 5;
  if (raw.includes("SHARP")) return 6;
  if (raw.includes("MEDIUM")) return 6;
  if (raw.includes("LOW")) return 3;
  if (raw.includes("REST") || raw.includes("RECOVERY")) return 1;
  return 5;
}

function intensityText(score) {
  return score === null ? "— / 10" : `${score} / 10`;
}

function doseText(item) {
  return [
    item.durationSec && `${item.durationSec}秒`,
    item.distanceM && `${item.distanceM}m`,
    item.reps && `${item.reps}回`,
    item.sets && `${item.sets}セット`,
    item.weightKg && `${item.weightKg}kg`
  ].filter(Boolean).join(" × ") || "—";
}

function menuItem(index, title, subtitle, dose) {
  const row = element("article", "menu-item");
  row.append(element("span", "menu-item__index", pad(index)));
  const copy = element("div", "menu-item__copy");
  copy.append(element("strong", "", title));
  if (subtitle) copy.append(element("span", "", subtitle));
  row.append(copy, element("span", "menu-item__dose", dose || "—"));
  return row;
}

function metaItem(label, value) {
  const item = element("div", "meta-item");
  item.append(element("span", "", label), element("strong", "", value || "—"));
  return item;
}

function daySessions(date) {
  return state.sessions.filter(session => dateOnly(session.sessionDate) === date && session.planStatus !== "ARCHIVED");
}

function nextCompetition() {
  return state.events
    .filter(event => event.eventType === "COMPETITION" && dateOnly(event.startDate) >= state.today && event.status !== "ARCHIVED")
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null;
}

function sectionHeader(title, note) {
  const head = element("div", "section-head");
  const copy = element("div");
  copy.append(element("h2", "", title));
  if (note) copy.append(element("span", "section-note", note));
  head.append(copy);
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

function pill(text, muted = false) {
  return element("span", `pill${muted ? " pill--muted" : ""}`, text);
}

function empty(message) {
  return element("div", "empty", message);
}

function element(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
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
  const copy = element("p", "login-copy", "専用パスフレーズを入力してください。Face IDや自動入力で値が入ると、約0.1秒後に自動認証します。");
  const label = element("label", "login-label", "パスフレーズ");
  label.htmlFor = "web-password";
  const input = element("input", "login-input");
  input.id = "web-password";
  input.name = "password";
  input.type = "password";
  input.autocomplete = "current-password";
  input.required = true;
  const button = element("button", "login-button", "手動で認証");
  button.type = "submit";
  const status = element("p", "login-status", message);
  status.setAttribute("aria-live", "polite");

  let autoTimer = null;
  let authInFlight = false;
  let queuedAuto = false;
  let lastAttemptedPassword = "";
  let observedValue = "";
  let watchTimer = null;

  const pulseAutoButton = () => {
    button.classList.remove("login-button--auto-press");
    void button.offsetWidth;
    button.classList.add("login-button--auto-press");
    setTimeout(() => button.classList.remove("login-button--auto-press"), 240);
  };

  const scheduleAutoLogin = () => {
    clearTimeout(autoTimer);
    const value = input.value;
    if (!value) {
      lastAttemptedPassword = "";
      status.textContent = "";
      return;
    }
    status.textContent = "";
    autoTimer = setTimeout(() => authenticate({ automatic: true }), 100);
  };

  const authenticate = async ({ automatic = false } = {}) => {
    const password = input.value;
    if (!password) return;
    if (authInFlight) {
      if (automatic) queuedAuto = true;
      return;
    }
    if (automatic && password === lastAttemptedPassword) return;

    const submittedPassword = password;
    lastAttemptedPassword = password;
    authInFlight = true;
    queuedAuto = false;
    button.disabled = true;
    button.textContent = automatic ? "自動認証中…" : "認証中…";
    if (automatic) pulseAutoButton();
    else status.textContent = "";

    try {
      const result = await authRequest("/auth/login", { password: submittedPassword });
      if (input.value !== submittedPassword) return;
      if (!result.success || !result.token) throw new Error(result.error || "認証に失敗しました。");
      clearInterval(watchTimer);
      state.webSessionToken = result.token;
      sessionStorage.setItem("aposWebSession", result.token);
      input.value = "";
      setConnection("idle", "認証済み・読み込み中");
      await loadDashboardData();
    } catch (error) {
      if (input.value !== submittedPassword) return;
      if (error?.code === "WEB_AUTH_REQUIRED") {
        showLogin("セッションを確認できませんでした。もう一度認証してください。");
        return;
      }
      if (!automatic) {
        status.textContent = error.message || "認証に失敗しました。";
        input.select();
      }
    } finally {
      authInFlight = false;
      if (document.body.contains(button)) {
        button.disabled = false;
        button.textContent = "手動で認証";
      }
      if (queuedAuto && input.value && input.value !== lastAttemptedPassword) scheduleAutoLogin();
    }
  };

  const detectPasswordValue = () => {
    const current = input.value;
    if (current === observedValue) return;
    observedValue = current;
    scheduleAutoLogin();
  };

  input.addEventListener("input", detectPasswordValue);
  input.addEventListener("change", detectPasswordValue);
  form.append(title, copy, label, input, button, status);
  form.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(autoTimer);
    authenticate({ automatic: false }).catch(showFatalError);
  });
  panel.append(form);
  dashboard.append(panel);
  observedValue = input.value;
  watchTimer = setInterval(() => {
    if (!document.body.contains(input)) {
      clearInterval(watchTimer);
      return;
    }
    detectPasswordValue();
  }, 50);
  input.focus();
}

function installTapFeedback() {
  const selector = "button, [role='button']";
  const release = () => {
    document.querySelectorAll(".is-pressed").forEach(node => {
      setTimeout(() => node.classList.remove("is-pressed"), 110);
    });
  };
  document.addEventListener("pointerdown", event => {
    const target = event.target.closest(selector);
    if (!target || target.disabled) return;
    target.classList.add("is-pressed");
  }, { passive: true });
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest(selector);
    if (!target || target.disabled) return;
    target.classList.add("is-pressed");
  });
  document.addEventListener("keyup", release);
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
  return response.json();
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

async function refreshVisibleData() {
  if (!state.webSessionToken) {
    showLogin();
    return;
  }
  refreshButton.disabled = true;
  setConnection("idle", "更新中");
  const date = state.selectedDate || state.today;
  try {
    if (state.viewMode === "day") {
      state.dayCache.delete(date);
      await loadDayContext(date, { force: true });
    } else if (state.viewMode === "week") {
      const start = startOfWeek(date);
      await ensureSessionsForRange(start, addDays(start, 6), { force: true });
      renderDashboard();
    } else {
      const range = monthRange(date);
      await ensureSessionsForRange(range.start, range.end, { force: true });
      renderDashboard();
    }
    state.competitionLoaded = false;
    state.secondaryLoaded = false;
    state.measurementTrendsLoaded = false;
    await loadBackgroundData({ force: true });
    if (state.secondaryView === "measurements") await switchSecondaryView("measurements");
    state.fetchedAt = new Date();
    setConnection("ready", "最新データ");
  } catch (error) {
    if (error?.code === "WEB_AUTH_REQUIRED") {
      showLogin("セッションの有効期限が切れました。もう一度認証してください。");
      return;
    }
    setConnection("error", "更新エラー");
    throw error;
  } finally {
    refreshButton.disabled = false;
  }
}

function showLoading() {
  dashboard.replaceChildren();
  const template = document.querySelector("#loading-template");
  for (let i = 0; i < 3; i++) dashboard.append(template.content.cloneNode(true));
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

function setConnection(stateName, label) {
  connectionDot.dataset.state = stateName;
  connectionLabel.textContent = label;
}

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

function addMonths(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function monthRange(date) {
  const [year, month] = date.split("-").map(Number);
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
  };
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function weekdayName(date) {
  return new Intl.DateTimeFormat(config.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function formatJapaneseDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(config.locale, { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${dateOnly(date)}T00:00:00Z`));
}

function formatShortDate(date) {
  const value = dateOnly(date);
  if (!value) return "—";
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function shortLabel(value) {
  const text = String(value || "");
  return text.length > 7 ? `${text.slice(0, 7)}…` : text;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
