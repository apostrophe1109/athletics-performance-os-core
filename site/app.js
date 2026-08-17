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
  webSessionToken: sessionStorage.getItem("aposWebSession") || ""
};
state.selectedDate = state.today;

const dashboard = document.querySelector("#dashboard");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");
const refreshButton = document.querySelector("#refresh-button");
refreshButton?.addEventListener("click", () => refreshVisibleData().catch(showFatalError));

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
  const [executions, measurements, exercises] = await Promise.all([
    records("executions", { sportProfileId: config.sportProfileId }, "executionDate", "DESC", 6),
    records("measurements", { sportProfileId: config.sportProfileId }, "date", "DESC", 6),
    records("exercises", { sportProfileId: config.sportProfileId, status: { $ne: "ARCHIVED" } }, "yukiName", "ASC", 6)
  ]);
  state.executions = executions.records || [];
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
    row.title = `強度 ${score}/10`;

    const copy = element("div", "day-menu-row__copy");
    const titleLine = element("div", "day-menu-row__title");
    titleLine.append(
      element("span", "day-menu-row__index", String(index + 1)),
      element("strong", "", item.title)
    );
    copy.append(titleLine);
    if (item.detail) copy.append(element("span", "", item.detail));

    const meta = element("div", "day-menu-row__meta");
    if (score !== null) {
      meta.append(element("span", "day-menu-row__intensity", `${score}/10`));
    }
    if (item.dose) meta.append(element("span", "day-menu-row__dose", item.dose));
    row.append(copy, meta);
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
        exerciseId: item.exerciseId || item.sourceExerciseId || null
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
        exerciseId: null
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
    exerciseId: null
  }));
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

  const transcript = element("textarea", "record-textarea");
  transcript.rows = 9;
  transcript.placeholder = mode === "voice"
    ? "ここに文字起こしが入ります。必要なら手で修正できます。"
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

  const organize = element("button", "organize-button", "内容を整理する");
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
    const draft = summarizeLocally(value);
    preview.replaceChildren(
      element("span", "eyebrow", "SAVE PREVIEW"),
      element("h4", "", "保存前の確認"),
      draftList("実施内容", draft.actions),
      draftList("良かった点・気づき", draft.notes)
    );
    preview.hidden = false;
    systemNote.textContent = "この画面ではまだ保存されません。内容を確認・修正してください。";
    save.disabled = false;
  });

  save.addEventListener("click", () => {
    systemNote.textContent = "現在のAPOS Viewは閲覧専用です。実データ保存はAPOS Coreの書込機能を追加し、Preview→承認→Apply→Verifyを通す実装後に有効化します。";
  });

  form.append(top, meta);
  if (mode === "voice") form.append(voiceTools);
  form.append(transcript, organize, preview, save, systemNote);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    try { recognition?.stop(); } catch {}
    dialog.remove();
  });
  dialog.showModal();
}

function summarizeLocally(text) {
  const chunks = text
    .split(/[。！？\n]+/)
    .map(value => value.trim())
    .filter(Boolean);
  const noteWords = /良|痛|重|軽|疲|違和感|感覚|調子|でき|難|安定|課題|気づ/;
  const actions = chunks.filter(value => !noteWords.test(value)).slice(0, 8);
  const notes = chunks.filter(value => noteWords.test(value)).slice(0, 6);
  return {
    actions: actions.length ? actions : chunks.slice(0, 8),
    notes: notes.length ? notes : ["必要に応じて追記してください。"]
  };
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
      element("span", "week-day__date", `${date.slice(8)} ${weekdayName(date)}`),
      element("span", "week-day__role", compactTrainingLabel(primary)),
      intensityMini(score)
    );
    card.append(top);

    const title = primary?.title || primary?.role || "予定なし";
    card.append(element("strong", "week-day__body", title));

    const highlights = sessionHighlights(primary, 3);
    if (highlights.length) {
      const details = element("ul", "week-day__details");
      highlights.forEach(item => details.append(element("li", "", item)));
      card.append(details);
    }

    if (primary?.purpose) {
      const intent = element("p", "week-day__intent");
      intent.append(element("span", "", "意図"), document.createTextNode(` ${primary.purpose}`));
      card.append(intent);
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
  return compactBridgeItems(raw).slice(0, 7);
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
    ["measurements", "計測・コンディション"]
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
  panel.append(sectionHeader("最近の実施記録", "保存済み"));
  const list = element("div", "card-list");
  const items = state.executions.slice(0, 6);
  if (!state.secondaryLoaded) list.append(empty("バックグラウンドで読み込み中…"));
  else if (!items.length) list.append(empty("実施記録はまだありません。"));
  items.forEach(item => {
    list.append(recordCard(
      item.exerciseName || item.exerciseId || "実施記録",
      formatJapaneseDate(dateOnly(item.executionDate)),
      [item.successes, item.improvements, item.voiceTranscriptNormalized].filter(Boolean).join(" / ")
    ));
  });
  panel.append(list);
  return panel;
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
  panel.append(sectionHeader("計測・コンディション", state.measurementTrendsLoaded ? "最大30件から推移表示" : "実測値"));
  const list = element("div", "metric-grid");
  if (state.measurementLoading) {
    list.append(empty("計測データの推移を読み込み中…"));
    panel.append(list);
    return panel;
  }
  const groups = groupMeasurements(state.measurements);
  if (!groups.length) list.append(empty("計測記録はまだありません。"));
  groups.slice(0, 8).forEach(([type, items]) => list.append(measurementMetricCard(type, items)));
  panel.append(list);
  return panel;
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
