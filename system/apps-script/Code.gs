/**
 * Athletics Performance OS - Google Apps Script API
 * Version: 1.2.4
 * Target spreadsheet:
 *   1enh_Qt2rDr-r87PM06gvFCX_K1J4-i_eEuxl9fggFGw
 *
 * New 22-sheet database API rebuilt from the useful safety contracts of
 * the previous OS v4.0.0. It does not contain API keys or tokens.
 * All POST requests must arrive in an HMAC-SHA256 signed Cloudflare envelope.
 *
 * Write governance:
 *   proposal -> preview -> explicit approval by 山下祐樹 -> apply -> audit
 * Physical deletion is disabled unless APOS_ALLOW_PHYSICAL_DELETE=true.
 */

var APOS_CONFIG = Object.freeze({
  API_VERSION: '1.2.4',
  SCHEMA_VERSION: '1.1.0',
  SYSTEM_NAME: 'Athletics Performance OS',
  SPREADSHEET_ID: '1enh_Qt2rDr-r87PM06gvFCX_K1J4-i_eEuxl9fggFGw',
  FINAL_APPROVER: '山下祐樹',
  TIMEZONE: 'Asia/Tokyo',
  PREVIEW_TTL_SECONDS: 900,
  GATEWAY_CLOCK_SKEW_SECONDS: 300,
  NONCE_TTL_SECONDS: 21600,
  MAX_READ_ROWS: 500,
  MAX_BATCH_ITEMS: 25,
  MAX_REQUEST_CHARS: 700000,
  MAX_LOCKED_PREVIEW_CHARS: 75000,
  CONTEXT_PAYLOAD_BUDGET_BYTES: 60000,
  CONTEXT_RULE_TEXT_MAX_CHARS: 900,
  CONTEXT_HISTORY_MAX_ITEMS: 20,
  CACHE_PREFIX: 'APOS_V121_',
  HMAC_SECRET_PROPERTY: 'APOS_GATEWAY_HMAC_SECRET',
  BACKUP_FOLDER_PROPERTY: 'APOS_BACKUP_FOLDER_ID',
  DELETE_PROPERTY: 'APOS_ALLOW_PHYSICAL_DELETE'
});

var APOS_GATEWAY_PROTOCOL = 'APOS-HMAC-SHA256-V1';

var APOS_ENTITIES = Object.freeze({
  overview:       { sheet: '00_概要',               key: null,             writable: false, systemOnly: false, prefix: null,   idType: null },
  settings:       { sheet: '01_設定',               key: 'systemKey',      writable: true,  systemOnly: false, prefix: 'SET',  idType: 'SETTING' },
  sportProfiles:  { sheet: '02_競技プロフィール',   key: 'sportProfileId', writable: true,  systemOnly: false, prefix: 'SPORT',idType: 'SPORT_PROFILE' },
  governanceRules:{ sheet: '03_OSルール',           key: 'ruleId',         writable: true,  systemOnly: false, prefix: 'GOV',  idType: 'GOVERNANCE_RULE' },
  trainingRules:  { sheet: '04_練習設計ルール',     key: 'ruleId',         writable: true,  systemOnly: false, prefix: 'TDR',  idType: 'TRAINING_RULE' },
  exercises:      { sheet: '05_種目マスター',       key: 'exerciseId',     writable: true,  systemOnly: false, prefix: 'EX',   idType: 'EXERCISE' },
  cycles:         { sheet: '06_サイクル',           key: 'cycleId',        writable: true,  systemOnly: false, prefix: 'CYC',  idType: 'CYCLE' },
  events:         { sheet: '07_イベント',           key: 'eventId',        writable: true,  systemOnly: false, prefix: 'EVT',  idType: 'EVENT' },
  sessions:       { sheet: '08_セッション',         key: 'sessionId',      writable: true,  systemOnly: false, prefix: 'SES',  idType: 'SESSION' },
  menuItems:      { sheet: '09_メニュー明細',       key: 'menuItemId',     writable: true,  systemOnly: false, prefix: 'MENU', idType: 'MENU_ITEM' },
  executions:     { sheet: '10_実施記録',           key: 'executionId',    writable: true,  systemOnly: false, prefix: 'EXEC', idType: 'EXECUTION' },
  reviews:        { sheet: '11_日次レビュー',       key: 'reviewId',       writable: true,  systemOnly: false, prefix: 'REV',  idType: 'DAILY_REVIEW' },
  measurements:   { sheet: '12_計測記録',           key: 'measurementId',  writable: true,  systemOnly: false, prefix: 'MEAS', idType: 'MEASUREMENT' },
  media:          { sheet: '13_メディア',           key: 'mediaId',        writable: true,  systemOnly: false, prefix: 'MED',  idType: 'MEDIA' },
  proposals:      { sheet: '14_提案承認',           key: 'proposalId',     writable: true,  systemOnly: false, prefix: 'PROP', idType: 'PROPOSAL' },
  changes:        { sheet: '15_変更履歴',           key: 'changeId',       writable: false, systemOnly: true,  prefix: 'CHG',  idType: 'CHANGE' },
  batches:        { sheet: '16_バッチ履歴',         key: 'batchId',        writable: false, systemOnly: true,  prefix: 'BATCH',idType: 'BATCH' },
  idLedger:       { sheet: '17_ID台帳',             key: 'idValue',        writable: false, systemOnly: true,  prefix: null,   idType: 'ID' },
  recurrenceRules:{ sheet: '18_繰り返しルール',     key: 'recurrenceRuleId',writable: true,  systemOnly: false, prefix: 'REC',  idType: 'RECURRENCE_RULE' },
  migrationAudit: { sheet: '90_移行監査',           key: 'auditId',        writable: true,  systemOnly: false, prefix: 'AUD',  idType: 'MIGRATION_AUDIT' },
  dictionary:     { sheet: '98_データ辞書',         key: null,             writable: false, systemOnly: false, prefix: null,   idType: null },
  options:        { sheet: '99_選択肢',             key: null,             writable: false, systemOnly: false, prefix: null,   idType: null }
});

var APOS_DEPRECATED_ENTITY_ALIASES = Object.freeze({
  kpis: 'measurements',
  '12_KPI': 'measurements',
  '07_KPI': 'measurements',
  '01_練習設計ルール': 'trainingRules',
  '02_種目マスター': 'exercises',
  '03_サイクル': 'cycles',
  '04_日別メニュー': 'sessions',
  '05_種目実施記録': 'executions',
  '06_日次レビュー': 'reviews',
  '08_メディア': 'media',
  '10_変更履歴': 'changes',
  '11_バッチ履歴': 'batches'
});

var APOS_SORT_ALIASES = Object.freeze({
  sessions: Object.freeze({ date: 'sessionDate' }),
  executions: Object.freeze({ date: 'executionDate' })
});

var APOS_CONTROLLED_ENTITIES = Object.freeze({
  governanceRules: true,
  trainingRules: true,
  exercises: true,
  cycles: true,
  events: true,
  sessions: true,
  menuItems: true,
  recurrenceRules: true,
  media: true
});

var APOS_ARCHIVE_FIELDS = Object.freeze({
  settings: { field: 'status', value: 'ARCHIVED' },
  sportProfiles: { field: 'status', value: 'ARCHIVED' },
  governanceRules: { field: 'status', value: 'ARCHIVED' },
  trainingRules: { field: 'status', value: 'ARCHIVED' },
  exercises: { field: 'status', value: 'ARCHIVED' },
  cycles: { field: 'status', value: 'ARCHIVED' },
  events: { field: 'status', value: 'CANCELLED' },
  sessions: { field: 'planStatus', value: 'ARCHIVED' },
  menuItems: { field: 'itemStatus', value: 'ARCHIVED' },
  executions: { field: 'executionStatus', value: 'ARCHIVED' },
  recurrenceRules: { field: 'status', value: 'ARCHIVED' },
  media: { field: 'approvalStatus', value: 'REJECTED' },
  proposals: { field: 'status', value: 'REJECTED' },
  migrationAudit: { field: 'status', value: 'CLOSED' }
});

var APOS_SECRET_KEY_PATTERN = /(token|secret|password|private.?key|api.?key|oauth|credential)/i;

function doGet(e) {
  var action = e && e.parameter && e.parameter.action ? String(e.parameter.action) : 'health';
  if (action !== 'health') {
    return APOS_json_({ success: false, code: 'POST_REQUIRED', error: 'health以外はPOSTを使用してください。', version: APOS_CONFIG.API_VERSION });
  }
  return APOS_json_({ success: true, status: 'WEBAPP_REACHABLE', version: APOS_CONFIG.API_VERSION, detailsRequireSignedPost: true });
}

function doPost(e) {
  var requestId = APOS_requestId_();
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    if (raw.length > APOS_CONFIG.MAX_REQUEST_CHARS) APOS_throw_('REQUEST_TOO_LARGE', 'リクエストが上限を超えています。');
    var envelope;
    try { envelope = JSON.parse(raw); }
    catch (parseError) { APOS_throw_('INVALID_JSON', 'JSONを解析できません。'); }
    var verified = APOS_verifyGatewayEnvelope_(envelope);
    var action = verified.action;
    var request = verified.body;
    var actor = APOS_cleanActor_(verified.actor && verified.actor.id, request.requestedBy);
    request._requestId = verified.requestId || requestId;
    request._actorResolved = actor;
    request._gatewayNonce = verified.nonce;

    var result = APOS_route_(action, request);
    result.success = result.success !== false;
    result.action = action;
    result.requestId = request._requestId;
    result.version = APOS_CONFIG.API_VERSION;
    result.generatedAt = APOS_nowIso_();
    return APOS_json_(result);
  } catch (error) {
    console.error(JSON.stringify({ requestId: requestId, code: error.aposCode || 'INTERNAL_ERROR', message: String(error.message || error) }));
    return APOS_json_(APOS_errorResponse_(error, requestId));
  }
}

function APOS_route_(action, request) {
  switch (action) {
    case 'health': return APOS_health_();
    case 'inventory': return APOS_inventory_();
    case 'validateSchema': return APOS_validateSchema_();
    case 'getProposalRequirements': return APOS_getProposalRequirements_();
    case 'getRecords': return APOS_getRecords_(request);
    case 'getRecord': return APOS_getRecord_(request);
    case 'searchExercises': return APOS_searchExercises_(request);
    case 'getTrainingContext': return APOS_getTrainingContext_(request);
    case 'getTodaySession': return APOS_getTrainingContext_(request);
    case 'getExerciseGuide':
      request.entity = 'exercises';
      request.key = request.key || request.exerciseId;
      return APOS_getRecord_(request);
    case 'previewMutation': return APOS_previewMutation_(request);
    case 'applyMutation': return APOS_applyMutation_(request);
    case 'previewBatch': return APOS_previewBatch_(request);
    case 'applyBatch': return APOS_applyBatch_(request);
    case 'previewRollback': return APOS_previewRollback_(request);
    case 'applyRollback': return APOS_applyRollback_(request);
    case 'previewBackup': return APOS_previewBackup_(request);
    case 'createBackup': return APOS_createBackup_(request);
    default: APOS_throw_('UNKNOWN_ACTION', '未対応のactionです。', { action: action });
  }
}

function APOS_health_() {
  var configured = !!PropertiesService.getScriptProperties().getProperty(APOS_CONFIG.HMAC_SECRET_PROPERTY);
  var response = {
    success: true,
    status: 'READY',
    apiVersion: APOS_CONFIG.API_VERSION,
    schemaVersion: APOS_CONFIG.SCHEMA_VERSION,
    gatewayHmacConfigured: configured,
    targetSpreadsheetId: APOS_CONFIG.SPREADSHEET_ID,
    spreadsheetConnected: false,
    requiredSheetCount: Object.keys(APOS_ENTITIES).length,
    missingSheets: []
  };
  try {
    var ss = APOS_open_();
    var names = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    response.missingSheets = Object.keys(APOS_ENTITIES).map(function(key) { return APOS_ENTITIES[key].sheet; })
      .filter(function(name) { return names.indexOf(name) === -1; });
    response.spreadsheetConnected = ss.getId() === APOS_CONFIG.SPREADSHEET_ID;
    response.spreadsheetIdMatched = response.spreadsheetConnected;
    response.status = response.missingSheets.length ? 'SCHEMA_INCOMPLETE' : (configured ? 'READY' : 'GATEWAY_CONFIG_INCOMPLETE');
  } catch (error) {
    response.success = false;
    response.status = 'SPREADSHEET_UNREACHABLE';
    response.error = 'Spreadsheetへ接続できません。';
  }
  return response;
}

function APOS_inventory_() {
  var ss = APOS_open_();
  var items = [];
  Object.keys(APOS_ENTITIES).forEach(function(entity) {
    var config = APOS_ENTITIES[entity];
    var sheet = ss.getSheetByName(config.sheet);
    items.push({
      entity: entity,
      sheetName: config.sheet,
      exists: !!sheet,
      primaryKey: config.key,
      writable: config.writable && !config.systemOnly,
      rowCount: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
      columnCount: sheet ? sheet.getLastColumn() : 0,
      schemaHash: sheet ? APOS_hash_(APOS_headers_(sheet)) : null
    });
  });
  return { success: true, spreadsheetId: APOS_CONFIG.SPREADSHEET_ID, sheets: items };
}

function APOS_validateSchema_() {
  var ss = APOS_open_();
  var dictionary = APOS_readEntityRecords_('dictionary', false);
  var expected = {};
  dictionary.forEach(function(row) {
    if (!row.sheetName || !row.fieldName) return;
    if (!expected[row.sheetName]) expected[row.sheetName] = [];
    expected[row.sheetName].push(String(row.fieldName));
  });
  var checks = [];
  Object.keys(APOS_ENTITIES).forEach(function(entity) {
    var config = APOS_ENTITIES[entity];
    var sheet = ss.getSheetByName(config.sheet);
    if (!sheet) {
      checks.push({ entity: entity, sheetName: config.sheet, success: false, code: 'SHEET_MISSING' });
      return;
    }
    if (entity === 'overview') {
      checks.push({ entity: entity, sheetName: config.sheet, success: true, nonTabular: true, actualHeaderHash: APOS_hash_(APOS_headers_(sheet)) });
      return;
    }
    var actual = APOS_headers_(sheet);
    var expectedHeaders = expected[config.sheet] || actual;
    var missing = expectedHeaders.filter(function(field) { return actual.indexOf(field) === -1; });
    var unexpected = actual.filter(function(field) { return field && expectedHeaders.indexOf(field) === -1; });
    var duplicate = actual.filter(function(field, index) { return field && actual.indexOf(field) !== index; });
    var blank = actual.map(function(field, index) { return field ? null : index + 1; }).filter(Boolean);
    var primaryKeyMissing = Boolean(config.key && actual.indexOf(config.key) === -1);
    var orderMatches = expectedHeaders.length === actual.length && expectedHeaders.every(function(field, index) { return actual[index] === field; });
    checks.push({
      entity: entity,
      sheetName: config.sheet,
      success: missing.length === 0 && unexpected.length === 0 && duplicate.length === 0 && blank.length === 0 && !primaryKeyMissing && orderMatches,
      actualHeaderHash: APOS_hash_(actual),
      expectedHeaderHash: APOS_hash_(expectedHeaders),
      missingHeaders: missing,
      unexpectedHeaders: unexpected,
      duplicateHeaders: duplicate,
      blankHeaderColumns: blank,
      orderMatches: orderMatches,
      primaryKeyMissing: primaryKeyMissing
    });
  });
  var failed = checks.filter(function(check) { return !check.success; });
  return {
    success: true,
    valid: failed.length === 0,
    status: failed.length ? 'SCHEMA_MISMATCH' : 'VALID',
    spreadsheetId: ss.getId(),
    checks: checks,
    failedCount: failed.length,
    writePerformed: false
  };
}

function APOS_getProposalRequirements_() {
  return {
    success: true,
    appliesToEntities: Object.keys(APOS_CONTROLLED_ENTITIES),
    requiredFields: [
      'proposalType', 'sportProfileId', 'title', 'intent', 'dose', 'intensity',
      'existingOptionsChecked', 'reasonExistingInsufficient', 'goalConnection',
      'risk', 'stopCondition', 'rollbackPlan'
    ],
    process: [
      '既存データとACTIVEルールを確認',
      '意図・量・強度・休息・不足根拠・18m30への接続・リスク・停止条件を提案',
      '変更前後と競合をPreview',
      '山下祐樹が明示承認',
      '反映・検証・監査記録'
    ],
    supportedOperations: ['INSERT', 'UPDATE', 'UPSERT', 'ARCHIVE', 'DELETE'],
    dateSelection: {
      userVisibleDayLimit: null,
      selectors: ['EXPLICIT_DATES', 'DATE_RANGE', 'WEEKDAYS', 'OPEN_ENDED_WEEKLY_RECURRENCE'],
      examples: ['2026-08-17〜2026-09-30', '毎週月曜と木曜'],
      internalChunkSize: APOS_CONFIG.MAX_BATCH_ITEMS,
      orchestration: '全体Previewを提示し、承認対象を一つにまとめたうえで内部chunkごとに処理する。'
    },
    voicePolicy: {
      rawTranscriptStored: false,
      structuredPreviewRequired: true
    },
    finalApprover: APOS_CONFIG.FINAL_APPROVER,
    writePerformed: false
  };
}

function APOS_getRecords_(request) {
  var entity = APOS_resolveEntity_(request.entity);
  if (entity === 'overview') APOS_throw_('ENTITY_NOT_TABULAR', '00_概要は表形式データではありません。inventoryを使用してください。');
  var limit = APOS_boundedInteger_(request.limit, 100, 1, APOS_CONFIG.MAX_READ_ROWS, 'LIMIT_INVALID');
  var offset = APOS_boundedInteger_(request.offset, 0, 0, 10000000, 'OFFSET_INVALID');
  var records = APOS_readEntityRecords_(entity, !!request.includeRowNumber);
  var filters = request.filters || {};
  if (!APOS_isPlainObject_(filters)) APOS_throw_('FILTERS_INVALID', 'filtersはobjectで指定してください。');
  records = records.filter(function(record) { return APOS_matchesFilters_(record, filters); });
  var canonicalSortBy = null;
  if (request.sortBy) {
    var requestedSortBy = String(request.sortBy);
    var aliases = APOS_SORT_ALIASES[entity] || {};
    canonicalSortBy = aliases[requestedSortBy] || requestedSortBy;
    var sheetHeaders = APOS_headers_(APOS_sheet_(APOS_ENTITIES[entity].sheet));
    if (sheetHeaders.indexOf(canonicalSortBy) === -1) {
      APOS_throw_('SORT_FIELD_INVALID', 'sortByはCanonical headerを指定してください。', {
        entity: entity,
        requestedSortBy: requestedSortBy,
        canonicalSortBy: canonicalSortBy,
        allowedFields: sheetHeaders
      });
    }
    var descending = String(request.sortDirection || 'ASC').toUpperCase() === 'DESC';
    records.sort(function(a, b) {
      var av = a[canonicalSortBy]; var bv = b[canonicalSortBy];
      if (av === bv) return 0;
      if (av === null || av === undefined) return descending ? 1 : -1;
      if (bv === null || bv === undefined) return descending ? -1 : 1;
      return (av < bv ? -1 : 1) * (descending ? -1 : 1);
    });
  }
  var total = records.length;
  var page = records.slice(offset, offset + limit).map(function(record) { return APOS_redactRecord_(entity, record); });
  return { success: true, entity: entity, total: total, offset: offset, limit: limit, sortBy: canonicalSortBy, records: page, writePerformed: false };
}

function APOS_getRecord_(request) {
  var entity = APOS_resolveEntity_(request.entity);
  var config = APOS_ENTITIES[entity];
  if (!config.key) APOS_throw_('ENTITY_HAS_NO_PRIMARY_KEY', 'このデータには単一主キーがありません。');
  var key = request.key;
  if (key === null || key === undefined || key === '') APOS_throw_('KEY_REQUIRED', 'keyが必要です。');
  var found = APOS_findByKey_(entity, key);
  return { success: true, entity: entity, found: !!found, record: found ? APOS_redactRecord_(entity, found.record) : null };
}

function APOS_searchExercises_(request) {
  var query = APOS_normalizeSearchText_(request.query);
  if (!query) APOS_throw_('QUERY_REQUIRED', 'queryが必要です。');
  var includeArchived = request.includeArchived === true;
  var limit = APOS_boundedInteger_(request.limit, 20, 1, 100, 'LIMIT_INVALID');
  var rows = APOS_readEntityRecords_('exercises', false);
  var fields = ['exerciseId', 'yukiName', 'generalName', 'aliases', 'category', 'mainPurpose', 'targetAbility', 'sportPhase', 'instructions', 'successFeeling', 'cue', 'bridge', 'notes'];
  var results = rows.map(function(row) {
    if (!includeArchived && String(row.status || '').toUpperCase() === 'ARCHIVED') return null;
    var score = 0; var matchedFields = [];
    fields.forEach(function(field) {
      var value = APOS_normalizeSearchText_(row[field]);
      if (!value) return;
      if (value === query) { score += 100; matchedFields.push(field + ':exact'); }
      else if (value.indexOf(query) !== -1) { score += field === 'yukiName' || field === 'generalName' ? 40 : 15; matchedFields.push(field); }
    });
    return score ? { score: score, matchedFields: matchedFields, exercise: row } : null;
  }).filter(function(item) { return item !== null; });
  results.sort(function(a, b) { return b.score - a.score || String(a.exercise.exerciseId).localeCompare(String(b.exercise.exerciseId)); });
  return { success: true, query: request.query, total: results.length, results: results.slice(0, limit), writePerformed: false };
}

function APOS_getTrainingContext_(request) {
  var date = APOS_normalizeDateString_(request.date || APOS_today_());
  var sportProfileId = String(request.sportProfileId || 'SPORT_TJ');
  var historyDays = APOS_boundedInteger_(request.historyDays, 14, 1, 28, 'HISTORY_DAYS_INVALID');
  var historyStartDate = APOS_addDays_(date, -(historyDays - 1));

  var sportProfileAll = APOS_readEntityRecords_('sportProfiles', false).filter(function(row) {
    return (!row.sportProfileId || String(row.sportProfileId) === sportProfileId) && String(row.status || '') !== 'ARCHIVED';
  });
  var sportProfile = sportProfileAll.length ? APOS_pickContextFields_(sportProfileAll[0], [
    'sportProfileId','athleteId','athleteName','sportCode','sportName','disciplineGroup','status','primaryGoal','targetValue','targetUnit',
    'personalBest','previousSeasonBest','takeoffLeg','dominantLeg','referenceBodyMassKg','timezone','effectiveFrom','version'
  ], 500) : null;

  var governanceFull = APOS_readEntityRecords_('governanceRules', false).filter(function(row) {
    if (String(row.status || '') !== 'ACTIVE') return false;
    var from = row.effectiveFrom ? APOS_normalizeDateString_(row.effectiveFrom) : '0000-01-01';
    var to = row.effectiveTo ? APOS_normalizeDateString_(row.effectiveTo) : '9999-12-31';
    return from <= date && date <= to;
  }).map(APOS_annotateRuleApplicability_);
  var governance = governanceFull.slice(0, 12).map(function(row) {
    var compact = APOS_pickContextFields_(row, ['ruleId','scope','category','ruleName','ruleText','priorityLevel','executionOrder','status','effectiveFrom','effectiveTo','condition','exception','version'], APOS_CONFIG.CONTEXT_RULE_TEXT_MAX_CHARS);
    if (row.applicability) compact.applicability = APOS_pickContextFields_(row.applicability, ['status','reason'], 220);
    return compact;
  });

  var rulesFull = APOS_readEntityRecords_('trainingRules', false).filter(function(row) {
    if (String(row.status || '') !== 'ACTIVE') return false;
    if (row.sportProfileId && String(row.sportProfileId) !== sportProfileId) return false;
    var from = row.effectiveFrom ? APOS_normalizeDateString_(row.effectiveFrom) : '0000-01-01';
    var to = row.effectiveTo ? APOS_normalizeDateString_(row.effectiveTo) : '9999-12-31';
    return from <= date && date <= to;
  }).sort(function(a, b) { return Number(a.priority || 9999) - Number(b.priority || 9999); }).map(APOS_annotateRuleApplicability_);
  var rules = rulesFull.slice(0, 16).map(function(row) {
    var compact = APOS_pickContextFields_(row, ['ruleId','sportProfileId','ruleName','category','ruleType','ruleValue','priority','status','effectiveFrom','effectiveTo','condition','exception','parentRuleId','purpose','risk','version'], APOS_CONFIG.CONTEXT_RULE_TEXT_MAX_CHARS);
    if (row.applicability) compact.applicability = APOS_pickContextFields_(row.applicability, ['status','reason'], 220);
    return compact;
  });

  var allSessions = APOS_readEntityRecords_('sessions', false);
  var sessionsFull = allSessions.filter(function(row) {
    return APOS_normalizeDateString_(row.sessionDate) === date && String(row.planStatus || '') !== 'ARCHIVED' && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  });
  var sessions = sessionsFull.slice(0, 8).map(function(row) {
    return APOS_pickContextFields_(row, ['sessionId','sportProfileId','cycleId','eventId','sessionDate','startTime','timezone','weekNo','dayNo','role','title','mainAdaptation','secondaryAdaptations','purpose','intensity','plannedSets','plannedReps','plannedDistanceM','plannedDurationMin','plannedWeightKg','plannedRestSec','cue','stopCondition','bridge','requirements','planStatus','executionStatus','approvalStatus','appliedRuleIds','reviewFlags','notes'], 700);
  });
  var sessionIds = sessionsFull.map(function(row) { return row.sessionId; });

  var menuFull = APOS_readEntityRecords_('menuItems', false).filter(function(row) {
    return sessionIds.indexOf(row.sessionId) !== -1 && String(row.itemStatus || '') !== 'ARCHIVED';
  });
  var menuItems = menuFull.slice(0, 60).map(function(row) {
    return APOS_pickContextFields_(row, ['menuItemId','sessionId','sportProfileId','orderNo','exerciseId','sourceExerciseId','exerciseNameSnapshot','purpose','sets','reps','distanceM','durationSec','weightKg','intensity','restSec','cue','stopCondition','bridge','requirement','itemStatus','approvalStatus','notes'], 550);
  });
  var exerciseIds = menuFull.map(function(row) { return row.exerciseId; }).filter(Boolean);
  var exercisesFull = APOS_readEntityRecords_('exercises', false).filter(function(row) { return exerciseIds.indexOf(row.exerciseId) !== -1; });
  var exercises = exercisesFull.slice(0, 30).map(function(row) {
    return APOS_pickContextFields_(row, ['exerciseId','yukiName','generalName','category','mainPurpose','targetAbility','sportPhase','volume','intensity','rest','successFeeling','cue','avoid','stopCondition','bridge','equipment','status'], 600);
  });

  var allEvents = APOS_readEntityRecords_('events', false).filter(function(row) {
    return String(row.status || '') !== 'CANCELLED' && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  });
  var eventsFull = allEvents.filter(function(row) {
    var start = APOS_normalizeDateString_(row.startDate);
    var end = row.endDate ? APOS_normalizeDateString_(row.endDate) : start;
    return start <= date && date <= end;
  });
  var events = eventsFull.slice(0, 3).map(function(row) {
    return APOS_pickContextFields_(row, ['eventId','sportProfileId','eventType','eventName','startDate','startTime','endDate','endTime','venue','priority','status','approvalStatus','notes'], 450);
  });
  var upcomingEventsFull = allEvents.filter(function(row) { return APOS_normalizeDateString_(row.startDate) >= date; })
    .sort(function(a,b){ return String(a.startDate).localeCompare(String(b.startDate)); });
  var upcomingEvents = upcomingEventsFull.slice(0, 3).map(function(row) {
    return APOS_pickContextFields_(row, ['eventId','eventType','eventName','startDate','startTime','venue','priority','status'], 350);
  });

  var reviewsFull = APOS_readEntityRecords_('reviews', false).filter(function(row) {
    return APOS_normalizeDateString_(row.date) === date && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  });
  var reviews = reviewsFull.slice(0, 4).map(function(row) {
    return APOS_pickContextFields_(row, ['reviewId','date','sportProfileId','cycleId','sessionId','readiness','gate','sleepHours','sleepQuality','durationMin','mainQuality','goalAchievement','maxVelocityFeel','horizontalVelocityFeel','contactStiffnessFeel','phaseConnectionFeel','reproducibility','success','problem','nextAdjustment','athleteComment','apostropheAnalysis','risk'], 450);
  });

  var recentReviewsFull = APOS_readEntityRecords_('reviews', false).filter(function(row) {
    var value = APOS_normalizeDateString_(row.date);
    return value >= historyStartDate && value <= date && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var recentReviews = recentReviewsFull.slice(0, APOS_CONFIG.CONTEXT_HISTORY_MAX_ITEMS).map(function(row) {
    return APOS_pickContextFields_(row, ['reviewId','date','sessionId','readiness','gate','sleepHours','sleepQuality','mainQuality','goalAchievement','maxVelocityFeel','horizontalVelocityFeel','contactStiffnessFeel','phaseConnectionFeel','reproducibility','success','problem','nextAdjustment','risk'], 350);
  });
  var recentExecutionsFull = APOS_readEntityRecords_('executions', false).filter(function(row) {
    var value = APOS_normalizeDateString_(row.executionDate);
    return value >= historyStartDate && value <= date && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  }).sort(function(a,b){ return String(b.executionDate).localeCompare(String(a.executionDate)); });
  var recentExecutions = recentExecutionsFull.slice(0, APOS_CONFIG.CONTEXT_HISTORY_MAX_ITEMS).map(function(row) {
    return APOS_pickContextFields_(row, ['executionId','sessionId','menuItemId','sportProfileId','executionDate','exerciseId','exerciseName','actualSets','actualReps','actualDistanceM','actualDurationSec','actualWeightKg','bestTimeSec','averageTimeSec','sessionRPE','technicalQuality','successRating','notes'], 350);
  });
  var recentMeasurementsFull = APOS_readEntityRecords_('measurements', false).filter(function(row) {
    var value = APOS_normalizeDateString_(row.date);
    return value >= historyStartDate && value <= date && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId);
  }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var recentMeasurements = recentMeasurementsFull.slice(0, APOS_CONFIG.CONTEXT_HISTORY_MAX_ITEMS).map(function(row) {
    return APOS_pickContextFields_(row, ['measurementId','date','sportProfileId','cycleId','sessionId','measurementType','exerciseId','exerciseName','trialNo','measurementValue','unit','distanceM','timeSec','calculatedSpeedMps','boardErrorCm','jumpDistanceM','hopDistanceM','stepDistanceM','jumpPhaseDistanceM','windMps','evaluation','dataQuality','notes'], 350);
  });

  var cyclesFull = APOS_readEntityRecords_('cycles', false).filter(function(row) {
    if (String(row.status || '') === 'ARCHIVED') return false;
    if (row.sportProfileId && String(row.sportProfileId) !== sportProfileId) return false;
    return APOS_periodsOverlap_(row.plannedStartDate, row.plannedEndDate, date, date);
  });
  var cycles = cyclesFull.slice(0, 4).map(function(row) {
    return APOS_pickContextFields_(row, ['cycleId','sportProfileId','cycleType','cycleName','plannedStartDate','plannedEndDate','observedFirstSessionDate','observedLastSessionDate','cycleRuleId','phaseStructureJson','status','approvalStatus','reviewFlags','notes'], 550);
  });

  var pendingFull = APOS_readEntityRecords_('proposals', false).filter(function(row) {
    return row.status === 'AWAITING_APPROVAL' && (!row.sportProfileId || String(row.sportProfileId) === sportProfileId) && (!row.targetDate || APOS_normalizeDateString_(row.targetDate) === date);
  });
  var pending = pendingFull.slice(0, 4).map(function(row) {
    return APOS_pickContextFields_(row, ['proposalId','proposalType','sportProfileId','targetDate','title','intent','goalConnection','risk','stopCondition','status','requestedBy','requestedAt'], 450);
  });

  var recurrenceFull = APOS_readEntityRecords_('recurrenceRules', false).filter(function(row) { return APOS_recurrenceMatchesDate_(row, date, sportProfileId); });
  var recurrenceRules = recurrenceFull.slice(0, 8).map(function(row) {
    return APOS_pickContextFields_(row, ['recurrenceRuleId','sportProfileId','title','targetEntity','operation','startDate','endDate','weekdaysJson','intervalWeeks','status','approvalStatus','proposalId','version','notes'], 450);
  });

  var ruleConflicts = APOS_detectRuleConflicts_(rulesFull);
  var operationalConflicts = APOS_detectOperationalConflicts_({
    date: date, rules: rulesFull, sessions: sessionsFull, allSessions: allSessions, menuItems: menuFull,
    exercises: exercisesFull, events: eventsFull, allEvents: allEvents, reviews: reviewsFull, recentReviews: recentReviewsFull
  });

  var response = {
    success: true,
    date: date,
    sportProfileId: sportProfileId,
    sportProfile: sportProfile,
    historyDays: historyDays,
    dataFreshness: { fetchedAt: APOS_nowIso_(), activeRulesOnly: true },
    formalStatus: !rulesFull.length ? 'RULES_UNAVAILABLE' : (rulesFull.some(function(rule) { return rule.applicability && rule.applicability.status === 'REQUIRES_CONTEXT_EVALUATION'; }) ? 'RULES_REQUIRE_CONTEXT_EVALUATION' : 'RULES_AVAILABLE'),
    governanceRules: governance,
    trainingRules: rules,
    ruleConflicts: ruleConflicts,
    operationalConflicts: operationalConflicts,
    hasConflicts: ruleConflicts.length > 0 || operationalConflicts.length > 0,
    cycles: cycles,
    sessions: sessions,
    menuItems: menuItems,
    exerciseGuides: exercises,
    events: events,
    upcomingEvents: upcomingEvents,
    recurrenceRules: recurrenceRules,
    dailyReviews: reviews,
    recentHistory: { from: historyStartDate, to: date, executions: recentExecutions, reviews: recentReviews, measurements: recentMeasurements },
    pendingProposals: pending,
    counts: {
      governanceRules: governanceFull.length, trainingRules: rulesFull.length, cycles: cyclesFull.length,
      sessions: sessionsFull.length, menuItems: menuFull.length, exerciseGuides: exercisesFull.length,
      events: eventsFull.length, upcomingEvents: upcomingEventsFull.length, recurrenceRules: recurrenceFull.length,
      dailyReviews: reviewsFull.length, recentExecutions: recentExecutionsFull.length,
      recentReviews: recentReviewsFull.length, recentMeasurements: recentMeasurementsFull.length,
      pendingProposals: pendingFull.length
    },
    truncated: false,
    omittedSections: [],
    payloadBudgetBytes: APOS_CONFIG.CONTEXT_PAYLOAD_BUDGET_BYTES,
    writePerformed: false
  };
  return APOS_enforceContextBudget_(response);
}

function APOS_detectRuleConflicts_(rules) {
  var conflicts = [];
  for (var i = 0; i < rules.length; i++) {
    for (var j = i + 1; j < rules.length; j++) {
      var a = rules[i]; var b = rules[j];
      var sameRuleId = String(a.ruleId || '') === String(b.ruleId || '');
      var sameSlot = String(a.category || '') === String(b.category || '') && String(a.ruleType || '') === String(b.ruleType || '') && Number(a.priority) === Number(b.priority);
      if (!sameRuleId && !sameSlot) continue;
      if (!APOS_periodsOverlap_(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) continue;
      conflicts.push({
        type: sameRuleId ? 'DUPLICATE_ACTIVE_RULE_ID' : 'SAME_PRIORITY_RULE_SLOT',
        ruleIdA: a.ruleId,
        ruleIdB: b.ruleId,
        priority: a.priority,
        category: a.category,
        ruleType: a.ruleType,
        autoCorrected: false,
        requiresYukiReview: true
      });
    }
  }
  return conflicts;
}

function APOS_annotateRuleApplicability_(rule) {
  var output = APOS_clone_(rule);
  var hasCondition = Boolean(String(output.condition || '').trim() || String(output.conditionJson || '').trim());
  var hasException = Boolean(String(output.exception || '').trim() || String(output.exceptionJson || '').trim());
  output.applicability = {
    status: hasCondition || hasException ? 'REQUIRES_CONTEXT_EVALUATION' : 'DATE_ACTIVE_UNCONDITIONAL',
    dateActive: true,
    conditionEvaluationRequired: hasCondition,
    exceptionEvaluationRequired: hasException,
    automaticallyApplied: false
  };
  return output;
}

function APOS_detectOperationalConflicts_(context) {
  var conflicts = [];
  var date = context.date;
  var weekday = APOS_weekdayCode_(date);
  var restWeekdays = [];
  context.rules.forEach(function(rule) {
    if (String(rule.ruleType || '').toUpperCase() !== 'FIXED_DAY') return;
    var value = APOS_parseJsonSafe_(rule.valueJson) || {};
    (value.restWeekdays || []).forEach(function(day) { if (restWeekdays.indexOf(String(day).toUpperCase()) === -1) restWeekdays.push(String(day).toUpperCase()); });
  });
  var hasScheduleException = context.events.some(function(event) {
    return ['COMPETITION', 'CAMP', 'TRAVEL', 'SPECIAL_SCHEDULE'].indexOf(String(event.eventType || '').toUpperCase()) !== -1;
  });
  var nonRestSessions = context.sessions.filter(function(session) {
    var role = String(session.role || '').toUpperCase();
    return ['REST', 'COMPLETE_REST', 'ACTIVE_REST'].indexOf(role) === -1 && session.planStatus !== 'ARCHIVED';
  });
  if (restWeekdays.indexOf(weekday) !== -1 && nonRestSessions.length && !hasScheduleException) {
    conflicts.push(APOS_conflict_('REST_DAY_WITH_TRAINING', date, '固定REST曜日に通常トレーニングが登録されています。', ['TDR002'], nonRestSessions.map(function(row) { return row.sessionId; })));
  }

  var competitionEvents = context.events.filter(function(event) { return String(event.eventType || '').toUpperCase() === 'COMPETITION'; });
  if (competitionEvents.length) {
    var nonCompetition = context.sessions.filter(function(session) {
      var text = (String(session.role || '') + ' ' + String(session.title || '')).toUpperCase();
      return text.indexOf('COMPETITION') === -1 && text.indexOf('試合') === -1 && session.planStatus !== 'ARCHIVED';
    });
    if (nonCompetition.length) conflicts.push(APOS_conflict_('COMPETITION_DAY_WITH_NORMAL_TRAINING', date, '試合日に通常練習が混在しています。', ['TDR005', 'TDR006'], nonCompetition.map(function(row) { return row.sessionId; })));
  }

  var highIntensity = context.sessions.filter(APOS_isHighIntensitySession_);

  var previousDate = APOS_addDays_(date, -1);
  var previousHigh = context.allSessions.filter(function(session) {
    return APOS_normalizeDateString_(session.sessionDate) === previousDate && session.planStatus !== 'ARCHIVED' && APOS_isHighIntensitySession_(session);
  });
  if (highIntensity.length && previousHigh.length) {
    conflicts.push(APOS_conflict_('CONSECUTIVE_HIGH_INTENSITY_DAYS', date, '前日から高強度日が連続しています。負荷配置の確認が必要です。', ['TDR008', 'TDR017'], previousHigh.concat(highIntensity).map(function(row) { return row.sessionId; })));
  }

  var fullApproachRule = context.rules.filter(function(rule) { return String(rule.ruleType || '').toUpperCase() === 'LIMIT' && String(rule.ruleId || '') === 'TDR009'; })[0];
  if (fullApproachRule) {
    var fullApproachIds = context.exercises.filter(function(exercise) {
      var text = [exercise.yukiName, exercise.generalName, exercise.aliases].join(' ');
      return text.indexOf('全助走トリプル') !== -1 || text.toUpperCase().indexOf('FULL APPROACH TRIPLE') !== -1;
    }).map(function(exercise) { return String(exercise.exerciseId); });
    var plannedCount = context.menuItems.reduce(function(total, item) {
      if (fullApproachIds.indexOf(String(item.exerciseId || '')) === -1 && String(item.exerciseNameSnapshot || '').indexOf('全助走トリプル') === -1) return total;
      var sets = item.sets === null || item.sets === undefined || item.sets === '' ? 1 : Number(item.sets);
      var reps = item.reps === null || item.reps === undefined || item.reps === '' ? 1 : Number(item.reps);
      return total + (isFinite(sets) && isFinite(reps) ? sets * reps : 0);
    }, 0);
    var limitConfig = APOS_parseJsonSafe_(fullApproachRule.valueJson) || {};
    var normalMax = Number(limitConfig.normalMax || 4);
    if (plannedCount > normalMax) conflicts.push(APOS_conflict_('FULL_APPROACH_VOLUME_EXCEEDS_LIMIT', date, '全助走トリプルの予定本数が上限候補を超えています。', [fullApproachRule.ruleId], context.menuItems.map(function(row) { return row.menuItemId; }), { plannedCount: plannedCount, normalMax: normalMax }));
  }

  APOS_detectTaperConflict_(context, conflicts);
  return conflicts;
}

function APOS_detectTaperConflict_(context, conflicts) {
  var taperRule = context.rules.filter(function(rule) { return String(rule.ruleType || '') === 'COMPETITION_TAPER_FIXED_D_MINUS_5'; })[0];
  if (!taperRule) return;
  var upcoming = context.allEvents.filter(function(event) {
    if (String(event.eventType || '').toUpperCase() !== 'COMPETITION') return false;
    var days = APOS_daysBetween_(context.date, APOS_normalizeDateString_(event.startDate));
    return days >= 0 && days <= 5;
  }).sort(function(a, b) { return APOS_normalizeDateString_(a.startDate) < APOS_normalizeDateString_(b.startDate) ? -1 : 1; });
  if (!upcoming.length || !context.sessions.length) return;
  var days = APOS_daysBetween_(context.date, APOS_normalizeDateString_(upcoming[0].startDate));
  var key = days === 0 ? 'COMPETITION_DAY' : 'D_MINUS_' + days;
  var config = APOS_parseJsonSafe_(taperRule.valueJson) || {};
  var expected = config.competitionTaper && config.competitionTaper[key];
  if (!expected) return;
  var actual = context.sessions.map(function(session) { return String(session.role || '') + ' ' + String(session.title || ''); }).join(' ').toUpperCase();
  var tokens = {
    ACTIVE_REST: ['ACTIVE_REST', 'ACTIVE REST', 'アクティブレスト', 'RECOVERY'],
    JUMP_PLYOMETRIC_STIMULUS: ['JUMP', 'PLYOMETRIC', 'プライオ', '跳躍'],
    WEIGHT_STIMULUS_FAST_STRONG_SHARP: ['WEIGHT', 'STRENGTH', 'POWER', 'ウェイト', '筋力'],
    COMPLETE_REST: ['COMPLETE_REST', 'COMPLETE REST', 'REST', '完全休養'],
    PRE_COMPETITION_SIMULATION_AND_ACTIVATION: ['PRE_COMPETITION', 'PRIMER', 'SIMULATION', '前日刺激', 'シミュレーション'],
    COMPETITION: ['COMPETITION', '試合']
  };
  var matched = (tokens[expected] || [expected]).some(function(token) { return actual.indexOf(String(token).toUpperCase()) !== -1; });
  if (!matched) conflicts.push(APOS_conflict_('TAPER_FLOW_MISMATCH', context.date, '固定テーパーの役割候補と登録セッションが一致しません。', [taperRule.ruleId], context.sessions.map(function(row) { return row.sessionId; }), { competitionDate: APOS_normalizeDateString_(upcoming[0].startDate), taperDay: key, expectedRole: expected }));
}

function APOS_conflict_(type, date, problem, ruleIds, entityIds, extra) {
  return APOS_merge_({
    type: type, date: date, problem: problem, ruleIds: ruleIds || [], relatedEntityIds: entityIds || [],
    priorityCandidate: ruleIds && ruleIds.length ? ruleIds[0] : null,
    recommendedAction: '山下祐樹へ確認し、必要なら新しいPreviewを作成する。',
    autoCorrected: false, requiresYukiReview: true
  }, extra || {});
}

function APOS_isHighIntensitySession_(session) {
  var text = (String(session.intensity || '') + ' ' + String(session.role || '') + ' ' + String(session.title || '')).toUpperCase();
  return ['VERY HIGH', 'VERY_HIGH', 'MAX-V', 'MAX_V', 'SPEED ENDURANCE', 'FULL APPROACH', '全助走', '高強度'].some(function(token) { return text.indexOf(token) !== -1; });
}

function APOS_weekdayCode_(dateString) {
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][APOS_parseDate_(dateString).getDay()];
}

function APOS_recurrenceMatchesDate_(rule, date, sportProfileId) {
  if (String(rule.status || '').toUpperCase() !== 'ACTIVE') return false;
  if (rule.sportProfileId && String(rule.sportProfileId) !== String(sportProfileId)) return false;
  var start = APOS_normalizeDateString_(rule.startDate);
  if (!start || date < start) return false;
  if (rule.endDate && date > APOS_normalizeDateString_(rule.endDate)) return false;
  var weekdays = APOS_parseJsonSafe_(rule.weekdaysJson);
  if (!Array.isArray(weekdays) || !weekdays.length) return false;
  weekdays = weekdays.map(function(day) { return String(day).toUpperCase(); });
  if (weekdays.indexOf(APOS_weekdayCode_(date)) === -1) return false;
  var intervalWeeks = Number(rule.intervalWeeks || 1);
  if (!isFinite(intervalWeeks) || intervalWeeks < 1 || Math.floor(intervalWeeks) !== intervalWeeks) return false;
  var elapsedWeeks = Math.floor(APOS_daysBetween_(start, date) / 7);
  return elapsedWeeks % intervalWeeks === 0;
}

function APOS_daysBetween_(fromDate, toDate) {
  var from = APOS_parseDate_(fromDate); var to = APOS_parseDate_(toDate);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function APOS_periodsOverlap_(aFrom, aTo, bFrom, bTo) {
  var af = APOS_normalizeDateString_(aFrom) || '0000-01-01';
  var at = APOS_normalizeDateString_(aTo) || '9999-12-31';
  var bf = APOS_normalizeDateString_(bFrom) || '0000-01-01';
  var bt = APOS_normalizeDateString_(bTo) || '9999-12-31';
  return af <= bt && bf <= at;
}

function APOS_previewMutation_(request) {
  var locked = APOS_prepareLockedMutation_(request.mutation || request, request._actorResolved || 'apostrophe');
  APOS_validateLockedRelationships_([locked]);
  var approvalHash = APOS_hash_(locked);
  APOS_cachePreview_(locked.previewId, approvalHash, locked.expiresAt, 'MUTATION');
  return {
    success: true,
    status: 'AWAITING_EXPLICIT_APPROVAL',
    lockedPreview: locked,
    approvalHash: approvalHash,
    expiresAt: locked.expiresAt,
    approvalRequired: true,
    finalApprover: APOS_CONFIG.FINAL_APPROVER,
    writePerformed: false
  };
}

function APOS_applyMutation_(request) {
  var locked = request.lockedPreview;
  var approval = request.approval || {};
  APOS_validateLockedPreview_(locked, approval, 'MUTATION');
  var scriptLock = LockService.getScriptLock();
  scriptLock.waitLock(30000);
  var reversals = [];
  try {
    APOS_validateNonceUnused_(approval.nonce);
    APOS_claimPreview_(locked, 'MUTATION');
    APOS_verifySheetHashes_([locked]);
    APOS_validateLockedRelationships_([locked]);
    APOS_assertDeleteAllowed_([locked], approval);
    var result = APOS_applyOneLockedMutation_(locked, approval, request._actorResolved || 'apostrophe', reversals);
    APOS_verifyMutationResult_(locked, result.afterRecord);
    APOS_markNonceUsed_(approval.nonce);
    return {
      success: true,
      status: 'APPLIED',
      entity: locked.entity,
      operation: locked.actualOperation,
      entityId: locked.key,
      changeId: result.changeId,
      proposalId: result.proposalId,
      rollbackAvailable: locked.actualOperation !== 'INSERT' || Boolean(APOS_ARCHIVE_FIELDS[locked.entity]),
      writePerformed: true
    };
  } catch (error) {
    APOS_revertAll_(reversals);
    throw error;
  } finally {
    scriptLock.releaseLock();
  }
}

function APOS_previewBatch_(request) {
  var mutations = request.mutations || [];
  if (!Array.isArray(mutations) || !mutations.length) APOS_throw_('MUTATIONS_REQUIRED', 'mutations配列が必要です。');
  if (mutations.length > APOS_CONFIG.MAX_BATCH_ITEMS) APOS_throw_('BATCH_TOO_LARGE', '1回の上限は' + APOS_CONFIG.MAX_BATCH_ITEMS + '件です。');
  var seen = {};
  var seenProposalIds = {};
  var items = mutations.map(function(mutation) {
    var item = APOS_prepareLockedMutation_(mutation, request._actorResolved || 'apostrophe');
    var signature = item.entity + '::' + item.key;
    if (seen[signature]) APOS_throw_('DUPLICATE_BATCH_TARGET', '同じ対象がバッチ内に複数あります。', { target: signature });
    seen[signature] = true;
    if (item.proposal) {
      if (seenProposalIds[item.proposal.proposalId]) APOS_throw_('DUPLICATE_BATCH_PROPOSAL_ID', '同じproposalIdがバッチ内に複数あります。', { proposalId: item.proposal.proposalId });
      seenProposalIds[item.proposal.proposalId] = true;
    }
    return item;
  });
  APOS_validateLockedRelationships_(items);
  var now = new Date();
  var locked = {
    previewType: 'BATCH',
    previewId: APOS_generateId_('BATCHPREVIEW'),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APOS_CONFIG.PREVIEW_TTL_SECONDS * 1000).toISOString(),
    itemCount: items.length,
    items: items,
    seriesId: request.seriesId || null,
    chunkNo: request.chunkNo || 1,
    chunkCount: request.chunkCount || 1,
    aggregateDescription: request.aggregateDescription || null,
    requestedBy: request._actorResolved || 'apostrophe',
    apiVersion: APOS_CONFIG.API_VERSION
  };
  APOS_assertLockedSize_(locked);
  var hash = APOS_hash_(locked);
  APOS_cachePreview_(locked.previewId, hash, locked.expiresAt, 'BATCH');
  return { success: true, status: 'AWAITING_EXPLICIT_APPROVAL', lockedPreview: locked, approvalHash: hash, expiresAt: locked.expiresAt, finalApprover: APOS_CONFIG.FINAL_APPROVER, writePerformed: false };
}

function APOS_applyBatch_(request) {
  var locked = request.lockedPreview;
  var approval = request.approval || {};
  APOS_validateLockedPreview_(locked, approval, 'BATCH');
  var scriptLock = LockService.getScriptLock();
  scriptLock.waitLock(30000);
  var reversals = [];
  try {
    APOS_validateNonceUnused_(approval.nonce);
    APOS_claimPreview_(locked, 'BATCH');
    APOS_verifySheetHashes_(locked.items);
    APOS_validateLockedRelationships_(locked.items);
    APOS_assertDeleteAllowed_(locked.items, approval);
    var batchId = APOS_generateId_('BATCH');
    var results = [];
    locked.items.forEach(function(item) {
      var itemResult = APOS_applyOneLockedMutation_(item, approval, request._actorResolved || 'apostrophe', reversals, batchId);
      APOS_verifyMutationResult_(item, itemResult.afterRecord);
      results.push(itemResult);
    });
    var counts = { insert: 0, update: 0, delete: 0, archive: 0 };
    locked.items.forEach(function(item) {
      var key = String(item.actualOperation || '').toLowerCase();
      if (counts[key] !== undefined) counts[key]++;
    });
    var batchRecord = {
      batchId: batchId,
      executedAt: APOS_nowIso_(),
      operation: 'APPROVED_BATCH',
      targetSheet: Array.from ? Array.from(new Set(locked.items.map(function(item) { return item.sheetName; }))).join(',') : 'MULTIPLE',
      itemCount: locked.items.length,
      insertCount: counts.insert,
      updateCount: counts.update + counts.archive,
      skipCount: 0,
      changeReason: approval.changeReason,
      executor: request._actorResolved || 'apostrophe',
      changePayload: APOS_stableStringify_(locked.items.map(function(item) { return { entity: item.entity, operation: item.actualOperation, key: item.key }; })),
      status: 'COMPLETED',
      chunkNo: locked.chunkNo || 1,
      chunkCount: locked.chunkCount || 1,
      apiVersion: APOS_CONFIG.API_VERSION,
      sourceRow: 0,
      migrationNote: 'New APOS approved batch',
      source: 'APOS_API'
    };
    reversals.push(APOS_appendSystemRecord_('batches', batchRecord));
    APOS_markNonceUsed_(approval.nonce);
    return { success: true, status: 'APPLIED', batchId: batchId, seriesId: locked.seriesId || null, chunkNo: locked.chunkNo || 1, chunkCount: locked.chunkCount || 1, itemCount: results.length, results: results, rollbackAvailable: true, writePerformed: true };
  } catch (error) {
    APOS_revertAll_(reversals);
    throw error;
  } finally {
    scriptLock.releaseLock();
  }
}

function APOS_previewRollback_(request) {
  if (!request.changeId) APOS_throw_('CHANGE_ID_REQUIRED', 'changeIdが必要です。');
  var change = APOS_findByKey_('changes', request.changeId);
  if (!change) APOS_throw_('CHANGE_NOT_FOUND', '変更履歴が見つかりません。');
  var row = change.record;
  var legacyEntityType = String(row.entityType || '').trim();
  var entity;
  try { entity = APOS_resolveEntity_(legacyEntityType); }
  catch (error) {
    if (error && error.aposCode === 'UNKNOWN_ENTITY') {
      APOS_throw_('ROLLBACK_NOT_AVAILABLE_LEGACY', '移行済み旧履歴ですが、復元対象entityを安全に解決できません。', { changeId: request.changeId, legacyEntityType: legacyEntityType });
    }
    throw error;
  }
  var before = APOS_parseJsonOrNull_(row.beforePayload);
  var after = APOS_parseJsonOrNull_(row.afterPayload);
  var op = String(row.operation || '').toUpperCase();
  if (!before && op !== 'INSERT') {
    APOS_throw_('ROLLBACK_NOT_AVAILABLE_LEGACY', '移行済み旧履歴には復元に必要なbeforePayloadがありません。監査履歴として参照のみ可能です。', { changeId: request.changeId, entity: entity, operation: op, legacyEntityType: legacyEntityType });
  }
  var rollbackMutation;
  if (op === 'INSERT') rollbackMutation = {
    entity: entity,
    operation: APOS_ARCHIVE_FIELDS[entity] ? 'ARCHIVE' : 'DELETE',
    key: row.entityId,
    proposal: request.proposal
  };
  else if (op === 'DELETE') rollbackMutation = { entity: entity, operation: 'INSERT', record: before, proposal: request.proposal };
  else rollbackMutation = { entity: entity, operation: 'UPDATE', key: row.entityId, changes: before, proposal: request.proposal };
  var locked = APOS_prepareLockedMutation_(rollbackMutation, request._actorResolved || 'apostrophe', {
    allowReservedIdRestore: op === 'DELETE',
    rollbackOfChangeId: request.changeId,
    allowSystemFieldRestore: true
  });
  locked.rollbackOfChangeId = request.changeId;
  locked.rollbackSourceAfter = after;
  APOS_validateLockedRelationships_([locked]);
  var hash = APOS_hash_(locked);
  APOS_cachePreview_(locked.previewId, hash, locked.expiresAt, 'MUTATION');
  return { success: true, status: 'AWAITING_EXPLICIT_APPROVAL', lockedPreview: locked, approvalHash: hash, expiresAt: locked.expiresAt, writePerformed: false };
}

function APOS_applyRollback_(request) {
  if (!request.lockedPreview || !request.lockedPreview.rollbackOfChangeId) {
    APOS_throw_('ROLLBACK_PREVIEW_REQUIRED', 'previewRollbackで生成したlockedPreviewが必要です。');
  }
  var result = APOS_applyMutation_(request);
  var auditWarning = null;
  try {
    var original = APOS_findByKey_('changes', request.lockedPreview.rollbackOfChangeId);
    if (original) {
      var record = APOS_clone_(original.record);
      record.rolledBackAt = APOS_nowIso_();
      record.result = 'ROLLED_BACK';
      record.notes = APOS_joinNotes_(record.notes, 'rollbackChangeId=' + result.changeId);
      APOS_updateSystemRecord_('changes', request.lockedPreview.rollbackOfChangeId, record);
    }
  } catch (error) {
    auditWarning = '元変更履歴のROLLED_BACK更新に失敗しました。新しい変更履歴は保存済みです。';
    console.error('ROLLBACK_AUDIT_WARNING ' + String(error.message || error));
  }
  result.status = 'ROLLED_BACK';
  result.rollbackOfChangeId = request.lockedPreview.rollbackOfChangeId;
  result.auditWarning = auditWarning;
  return result;
}

function APOS_previewBackup_(request) {
  var stateHash = APOS_workbookStateHash_();
  var now = new Date();
  var name = 'APOS_BACKUP_' + Utilities.formatDate(now, APOS_CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  var locked = {
    previewType: 'BACKUP',
    previewId: APOS_generateId_('BACKUPPREVIEW'),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APOS_CONFIG.PREVIEW_TTL_SECONDS * 1000).toISOString(),
    backupName: name,
    workbookStateHash: stateHash,
    requestedBy: request._actorResolved || 'apostrophe',
    apiVersion: APOS_CONFIG.API_VERSION
  };
  var hash = APOS_hash_(locked);
  APOS_cachePreview_(locked.previewId, hash, locked.expiresAt, 'BACKUP');
  return { success: true, status: 'AWAITING_EXPLICIT_APPROVAL', lockedPreview: locked, approvalHash: hash, expiresAt: locked.expiresAt, writePerformed: false };
}

function APOS_createBackup_(request) {
  var locked = request.lockedPreview;
  var approval = request.approval || {};
  APOS_validateLockedPreview_(locked, approval, 'BACKUP');
  var scriptLock = LockService.getScriptLock();
  scriptLock.waitLock(30000);
  var changeId = APOS_generateId_('CHG');
  var auditInserted = false;
  try {
    APOS_validateNonceUnused_(approval.nonce);
    APOS_claimPreview_(locked, 'BACKUP');
    if (APOS_workbookStateHash_() !== locked.workbookStateHash) APOS_throw_('WORKBOOK_STATE_CHANGED', 'Preview後にデータが変更されています。再Previewしてください。');
    var folderId = PropertiesService.getScriptProperties().getProperty(APOS_CONFIG.BACKUP_FOLDER_PROPERTY);
    if (!folderId) APOS_throw_('BACKUP_FOLDER_NOT_CONFIGURED', 'Script PropertiesにAPOS_BACKUP_FOLDER_IDを設定してください。');
    APOS_appendSystemRecord_('changes', {
      changeId: changeId, changedAt: APOS_nowIso_(), entityType: 'SYSTEM_BACKUP', entityId: locked.backupName,
      operation: 'BACKUP', beforePayload: null, afterPayload: APOS_stableStringify_({ name: locked.backupName, stateHash: locked.workbookStateHash }),
      changeReason: approval.changeReason, proposedBy: locked.requestedBy, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt,
      result: 'PENDING', method: 'APOS_API', executor: request._actorResolved || 'apostrophe', sourceRow: 0,
      payloadEncoding: 'PLAIN', migrationStatus: 'MIGRATED', notes: 'approvalNonceHash=' + APOS_hash_(String(approval.nonce)),
      source: 'APOS_API'
    });
    auditInserted = true;
    var copy = DriveApp.getFileById(APOS_CONFIG.SPREADSHEET_ID).makeCopy(locked.backupName, DriveApp.getFolderById(folderId));
    var completedAudit = APOS_findByKey_('changes', changeId).record;
    completedAudit.entityId = copy.getId();
    completedAudit.afterPayload = APOS_stableStringify_({ fileId: copy.getId(), name: copy.getName(), stateHash: locked.workbookStateHash });
    completedAudit.result = 'COMPLETED';
    APOS_updateSystemRecord_('changes', changeId, completedAudit);
    APOS_markNonceUsed_(approval.nonce);
    return { success: true, status: 'COMPLETED', backupName: copy.getName(), backupFileId: copy.getId(), changeId: changeId, writePerformed: true };
  } catch (error) {
    if (auditInserted) {
      try {
        var failedAudit = APOS_findByKey_('changes', changeId);
        if (failedAudit) {
          var failedRecord = failedAudit.record;
          failedRecord.result = 'FAILED';
          failedRecord.notes = APOS_joinNotes_(failedRecord.notes, 'backupError=' + String(error.aposCode || 'BACKUP_FAILED'));
          APOS_updateSystemRecord_('changes', changeId, failedRecord);
        }
        APOS_markNonceUsed_(approval.nonce);
      } catch (auditError) {
        console.error('BACKUP_AUDIT_FAILURE ' + String(auditError.message || auditError));
      }
    }
    throw error;
  } finally {
    scriptLock.releaseLock();
  }
}

function APOS_prepareLockedMutation_(mutation, actor, options) {
  options = options || {};
  if (!APOS_isPlainObject_(mutation)) APOS_throw_('MUTATION_INVALID', 'mutationはobjectで指定してください。');
  var entity = APOS_resolveEntity_(mutation.entity);
  var config = APOS_ENTITIES[entity];
  if (!config.writable || config.systemOnly) APOS_throw_('ENTITY_READ_ONLY', 'このデータは外部操作から変更できません。', { entity: entity });
  if (!config.key) APOS_throw_('ENTITY_HAS_NO_PRIMARY_KEY', '変更対象に単一主キーがありません。');
  var operation = String(mutation.operation || 'UPSERT').toUpperCase();
  if (['INSERT', 'UPDATE', 'UPSERT', 'ARCHIVE', 'DELETE'].indexOf(operation) === -1) APOS_throw_('INVALID_OPERATION', 'operationが不正です。');

  var suppliedRecord = mutation.record === undefined ? null : mutation.record;
  var suppliedChanges = mutation.changes === undefined ? null : mutation.changes;
  if (suppliedRecord !== null && !APOS_isPlainObject_(suppliedRecord)) APOS_throw_('RECORD_INVALID', 'recordはobjectで指定してください。');
  if (suppliedChanges !== null && !APOS_isPlainObject_(suppliedChanges)) APOS_throw_('CHANGES_INVALID', 'changesはobjectで指定してください。');
  suppliedRecord = APOS_clone_(suppliedRecord || {});
  suppliedChanges = APOS_clone_(suppliedChanges || {});

  var key = mutation.key || suppliedRecord[config.key] || suppliedChanges[config.key];
  if (!key && (operation === 'INSERT' || operation === 'UPSERT')) key = APOS_generateEntityId_(entity);
  if (!key) APOS_throw_('KEY_REQUIRED', config.key + 'が必要です。');
  if (suppliedRecord[config.key] && String(suppliedRecord[config.key]) !== String(key)) APOS_throw_('PRIMARY_KEY_MISMATCH', 'record内の主キーとkeyが一致しません。');
  if (suppliedChanges[config.key] && String(suppliedChanges[config.key]) !== String(key)) APOS_throw_('PRIMARY_KEY_MISMATCH', 'changes内の主キーとkeyが一致しません。');

  var found = APOS_findByKey_(entity, key);
  var actualOperation = operation;
  if (operation === 'UPSERT') actualOperation = found ? 'UPDATE' : 'INSERT';
  if (actualOperation === 'INSERT' && found) APOS_throw_('DUPLICATE_KEY', '同じIDが既に存在します。', { key: key });
  if (['UPDATE', 'ARCHIVE', 'DELETE'].indexOf(actualOperation) !== -1 && !found) APOS_throw_('RECORD_NOT_FOUND', '変更対象が見つかりません。', { key: key });
  if (actualOperation === 'INSERT') APOS_assertIdAvailableForInsert_(entity, key, options);

  var payload = {};
  if (actualOperation === 'INSERT') {
    if (!Object.keys(suppliedRecord).length) APOS_throw_('MUTATION_RECORD_REQUIRED', 'INSERTにはrecord objectが必要です。');
    payload = suppliedRecord;
  } else if (actualOperation === 'UPDATE') {
    if (!Object.keys(suppliedChanges).length) APOS_throw_('MUTATION_CHANGES_REQUIRED', 'UPDATEにはchanges objectが必要です。');
    payload = suppliedChanges;
  } else if (actualOperation === 'ARCHIVE') {
    payload = suppliedChanges;
  } else if (actualOperation === 'DELETE') {
    payload = {};
  }
  payload[config.key] = key;
  APOS_assertMutationPayloadEditable_(entity, payload, actualOperation, options);

  var before = found ? APOS_clone_(found.record) : null;
  var after = null;
  if (actualOperation === 'INSERT') after = payload;
  if (actualOperation === 'UPDATE') after = APOS_merge_(before, payload);
  if (actualOperation === 'ARCHIVE') {
    after = APOS_merge_(before, payload);
    var archive = APOS_ARCHIVE_FIELDS[entity];
    if (!archive || !Object.prototype.hasOwnProperty.call(after, archive.field)) {
      APOS_throw_('ARCHIVE_FIELD_MISSING', 'このentityには安全なARCHIVE列が定義されていません。', { entity: entity });
    }
    after[archive.field] = archive.value;
  }
  if (after) {
    after = APOS_applyRecordDefaults_(entity, after, actualOperation, actor);
    var validationWarnings = APOS_validateRecord_(entity, after, { operation: actualOperation, before: before });
    after = APOS_normalizeRecordForStorage_(entity, after, APOS_headers_(APOS_sheet_(config.sheet)));
  }
  var proposal = APOS_CONTROLLED_ENTITIES[entity] ? APOS_prepareProposal_(mutation.proposal, entity, actualOperation, key, before, after, actor) : null;
  if (proposal && after && after.sportProfileId && String(after.sportProfileId) !== String(proposal.sportProfileId)) {
    APOS_throw_('PROPOSAL_SPORT_PROFILE_MISMATCH', '提案のsportProfileIdと変更対象が一致しません。');
  }
  var compactStartTimeOnly = entity === 'sessions' && actualOperation === 'UPDATE';
  if (compactStartTimeOnly) {
    var suppliedChangeKeys = Object.keys(suppliedChanges).filter(function(field) { return field !== config.key; });
    compactStartTimeOnly = suppliedChangeKeys.length === 1 && suppliedChangeKeys[0] === 'startTime';
  }
  if (compactStartTimeOnly) {
    var compactFields = [config.key, 'sportProfileId', 'sessionDate', 'startTime', 'updatedAt'];
    var compactBefore = {};
    var compactAfter = {};
    compactFields.forEach(function(field) {
      if (before && Object.prototype.hasOwnProperty.call(before, field)) compactBefore[field] = before[field];
      if (after && Object.prototype.hasOwnProperty.call(after, field)) compactAfter[field] = after[field];
    });
    before = compactBefore;
    after = compactAfter;
    if (proposal) {
      proposal.beforeJson = APOS_clone_(compactBefore);
      proposal.proposedJson = APOS_clone_(compactAfter);
    }
  }
  var now = new Date();
  var locked = {
    previewType: 'MUTATION', previewId: APOS_generateId_('PREVIEW'), requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APOS_CONFIG.PREVIEW_TTL_SECONDS * 1000).toISOString(),
    entity: entity, sheetName: config.sheet, primaryKey: config.key, requestedOperation: operation,
    actualOperation: actualOperation, key: String(key), before: before, after: after,
    sheetStateHash: APOS_sheetStateHash_(entity), proposal: proposal,
    idLedgerStateHash: APOS_sheetStateHash_('idLedger'),
    validationWarnings: validationWarnings || [],
    requestedBy: actor, destructive: actualOperation === 'DELETE',
    reservedIdRestoreAuthorized: options.allowReservedIdRestore === true && Boolean(options.rollbackOfChangeId),
    apiVersion: APOS_CONFIG.API_VERSION
  };
  APOS_assertLockedSize_(locked);
  return locked;
}

function APOS_prepareProposal_(proposal, entity, operation, key, before, after, actor) {
  if (!proposal || typeof proposal !== 'object') APOS_throw_('PROPOSAL_REQUIRED', 'この変更には事前提案の内容が必要です。');
  var required = ['proposalType', 'sportProfileId', 'title', 'intent', 'dose', 'intensity', 'existingOptionsChecked', 'reasonExistingInsufficient', 'goalConnection', 'risk', 'stopCondition', 'rollbackPlan'];
  required.forEach(function(field) {
    if (proposal[field] === null || proposal[field] === undefined || String(proposal[field]).trim() === '') APOS_throw_('PROPOSAL_FIELD_REQUIRED', '提案項目が不足しています: ' + field);
  });
  var proposalId = proposal.proposalId || APOS_generateId_('PROP');
  if (APOS_findByKey_('proposals', proposalId)) APOS_throw_('DUPLICATE_PROPOSAL_ID', '同じproposalIdが既に存在します。', { proposalId: proposalId });
  var prepared = {
    proposalId: proposalId, proposalType: proposal.proposalType,
    sportProfileId: proposal.sportProfileId, targetDate: proposal.targetDate || APOS_effectiveDateFromRecord_(after || before),
    targetEntityType: entity, targetEntityId: key, title: proposal.title,
    beforeJson: before, proposedJson: after, intent: proposal.intent, dose: proposal.dose,
    intensity: proposal.intensity, rest: proposal.rest || null, existingOptionsChecked: proposal.existingOptionsChecked,
    reasonExistingInsufficient: proposal.reasonExistingInsufficient, goalConnection: proposal.goalConnection,
    risk: proposal.risk, stopCondition: proposal.stopCondition, conflicts: APOS_textOrJson_(proposal.conflicts),
    affectedEntities: APOS_textOrJson_(proposal.affectedEntities) || entity + ':' + key, rollbackPlan: proposal.rollbackPlan,
    requestedBy: proposal.requestedBy || actor, notes: proposal.notes || null
  };
  var previewRecord = APOS_merge_(prepared, {
    createdAt: APOS_nowIso_(), proposedJson: after === null ? 'null' : after, status: 'AWAITING_APPROVAL'
  });
  APOS_validateRecord_('proposals', previewRecord, { operation: 'INSERT', before: null });
  return prepared;
}

function APOS_applyOneLockedMutation_(locked, approval, actor, reversals, batchId) {
  if (locked.proposal && APOS_findByKey_('proposals', locked.proposal.proposalId)) {
    APOS_throw_('CONCURRENT_DUPLICATE_PROPOSAL_ID', 'Preview後に同じproposalIdが登録されました。', { proposalId: locked.proposal.proposalId });
  }
  var rowChange = APOS_executeRowMutation_(locked, approval);
  reversals.push(rowChange);
  var ledgerChange = APOS_syncIdLedger_(locked, actor);
  if (ledgerChange) reversals.push(ledgerChange);
  var proposalId = null;
  if (locked.proposal) {
    var proposalRecord = APOS_clone_(locked.proposal);
    proposalRecord.createdAt = locked.requestedAt;
    proposalRecord.beforeJson = APOS_stableStringify_(proposalRecord.beforeJson);
    proposalRecord.proposedJson = APOS_stableStringify_(rowChange.afterRecord || proposalRecord.proposedJson);
    proposalRecord.status = 'APPLIED'; proposalRecord.approvedBy = approval.approvedBy;
    proposalRecord.approvedAt = approval.approvedAt; proposalRecord.appliedAt = APOS_nowIso_();
    proposalRecord.applicationResult = 'APPLIED';
    reversals.push(APOS_appendSystemRecord_('proposals', proposalRecord));
    proposalId = proposalRecord.proposalId;
  }
  var changeId = APOS_generateId_('CHG');
  var audit = {
    changeId: changeId, changedAt: APOS_nowIso_(), entityType: locked.entity, entityId: locked.key,
    effectiveDate: APOS_effectiveDateFromRecord_(locked.after || locked.before), operation: locked.actualOperation,
    beforePayload: rowChange.beforeRecord ? APOS_stableStringify_(rowChange.beforeRecord) : (locked.before ? APOS_stableStringify_(locked.before) : null),
    afterPayload: rowChange.afterRecord ? APOS_stableStringify_(rowChange.afterRecord) : null,
    changeReason: approval.changeReason, proposedBy: locked.requestedBy, approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt, relatedProposalId: proposalId, result: 'APPLIED', method: 'APOS_API', executor: actor,
    sourceRow: 0, payloadEncoding: 'PLAIN', migrationStatus: 'MIGRATED',
    notes: APOS_joinNotes_(batchId ? 'batchId=' + batchId : null, 'approvalNonceHash=' + APOS_hash_(String(approval.nonce))),
    source: 'APOS_API'
  };
  reversals.push(APOS_appendSystemRecord_('changes', audit));
  return { changeId: changeId, proposalId: proposalId, entity: locked.entity, entityId: locked.key, operation: locked.actualOperation, afterRecord: rowChange.afterRecord || null };
}

function APOS_isCompactSessionStartTimeLocked_(locked) {
  if (!locked || locked.entity !== 'sessions' || locked.actualOperation !== 'UPDATE' || !locked.before || !locked.after) return false;
  var allowed = { sessionId: true, sportProfileId: true, sessionDate: true, startTime: true, updatedAt: true };
  var beforeKeys = Object.keys(locked.before);
  var afterKeys = Object.keys(locked.after);
  if (!Object.prototype.hasOwnProperty.call(locked.after, 'startTime')) return false;
  return beforeKeys.length <= 5 && afterKeys.length <= 5 &&
    beforeKeys.every(function(key) { return allowed[key] === true; }) &&
    afterKeys.every(function(key) { return allowed[key] === true; });
}

function APOS_executeRowMutation_(locked, approval) {
  var entity = locked.entity;
  var config = APOS_ENTITIES[entity];
  var sheet = APOS_sheet_(config.sheet);
  var headers = APOS_headers_(sheet);
  var found = APOS_findByKey_(entity, locked.key);
  var compactStartTimeUpdate = APOS_isCompactSessionStartTimeLocked_(locked);
  var currentBeforeRecord = found ? APOS_clone_(found.record) : null;
  var afterRecord = locked.after ? (compactStartTimeUpdate ? APOS_merge_(currentBeforeRecord, locked.after) : APOS_clone_(locked.after)) : null;
  if (afterRecord) {
    if (headers.indexOf('approvalStatus') !== -1) afterRecord.approvalStatus = 'APPROVED';
    if (headers.indexOf('approvedBy') !== -1) afterRecord.approvedBy = approval.approvedBy;
    if (headers.indexOf('approvedAt') !== -1) afterRecord.approvedAt = approval.approvedAt;
    if (headers.indexOf('proposalId') !== -1 && locked.proposal) afterRecord.proposalId = locked.proposal.proposalId;
    if (headers.indexOf('previewStatus') !== -1) afterRecord.previewStatus = 'CONFIRMED';
    if (headers.indexOf('recordedAt') !== -1 && !afterRecord.recordedAt) afterRecord.recordedAt = APOS_nowIso_();
    APOS_validateRecord_(entity, afterRecord, { operation: locked.actualOperation, before: compactStartTimeUpdate ? currentBeforeRecord : locked.before });
    afterRecord = APOS_normalizeRecordForStorage_(entity, afterRecord, headers);
  }
  if (locked.actualOperation === 'INSERT') {
    if (found) APOS_throw_('CONCURRENT_DUPLICATE_KEY', 'Preview後に同じIDが追加されました。');
    var insertValues = APOS_recordToRow_(entity, afterRecord, headers);
    var newRow = Math.max(sheet.getLastRow() + 1, 2);
    APOS_prepareStorageFormats_(sheet, newRow, headers, entity);
    sheet.getRange(newRow, 1, 1, headers.length).setValues([insertValues]);
    return { kind: 'INSERT', sheetName: config.sheet, rowNumber: newRow, beforeRow: null, afterRow: insertValues, afterRecord: afterRecord };
  }
  if (!found) APOS_throw_('CONCURRENT_RECORD_MISSING', 'Preview後に対象がなくなりました。');
  if (locked.actualOperation === 'DELETE') {
    var oldRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];
    sheet.deleteRow(found.rowNumber);
    return { kind: 'DELETE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: oldRow, afterRow: null, afterRecord: null };
  }
  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];
  var comparisonBeforeRecord = compactStartTimeUpdate ? currentBeforeRecord : locked.before;
  var beforeExpectedRow = APOS_recordToRow_(entity, comparisonBeforeRecord, headers);
  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);
  var changedCells = [];
  APOS_prepareStorageFormats_(sheet, found.rowNumber, headers, entity);
  for (var col = 0; col < headers.length; col++) {
    var field = headers[col];
    var beforeValue = comparisonBeforeRecord ? comparisonBeforeRecord[field] : null;
    var afterValue = afterRecord ? afterRecord[field] : null;
    if (APOS_stableStringify_(beforeValue) === APOS_stableStringify_(afterValue)) continue;
    changedCells.push({ column: col + 1, beforeValue: beforeExpectedRow[col], afterValue: afterRow[col] });
  }
  try {
    changedCells.forEach(function(cellChange) {
      sheet.getRange(found.rowNumber, cellChange.column).setValue(cellChange.afterValue);
    });
  } catch (error) {
    for (var restoreIndex = changedCells.length - 1; restoreIndex >= 0; restoreIndex--) {
      try {
        var restoreCell = changedCells[restoreIndex];
        sheet.getRange(found.rowNumber, restoreCell.column).setValue(restoreCell.beforeValue);
      } catch (ignore) {}
    }
    throw error;
  }
  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow, changedCells: changedCells, beforeRecord: currentBeforeRecord, afterRecord: afterRecord };
}

function APOS_prepareStorageFormats_(sheet, rowNumber, headers, entity) {
  // sessions.startTime is canonical text (HH:MM). Google Sheets can otherwise
  // auto-coerce values such as \"14:30\" into a time serial, which breaks exact
  // read-back verification and the canonical text contract.
  if (entity !== 'sessions') return;
  var startTimeCol = headers.indexOf('startTime');
  if (startTimeCol < 0) return;
  sheet.getRange(rowNumber, startTimeCol + 1).setNumberFormat('@');
}

function APOS_verifyMutationResult_(locked, expectedAfter) {
  SpreadsheetApp.flush();
  var found = APOS_findByKey_(locked.entity, locked.key);
  if (locked.actualOperation === 'DELETE') {
    if (found) APOS_throw_('WRITE_VERIFICATION_FAILED', '削除後の検証に失敗しました。', { entity: locked.entity, key: locked.key });
    return true;
  }
  if (!found) APOS_throw_('WRITE_VERIFICATION_FAILED', '保存後のレコードを読み戻せません。', { entity: locked.entity, key: locked.key });
  if (APOS_hash_(found.record) !== APOS_hash_(expectedAfter)) {
    APOS_throw_('WRITE_VERIFICATION_FAILED', '保存後の値がPreviewと一致しません。', { entity: locked.entity, key: locked.key });
  }
  return true;
}

function APOS_syncIdLedger_(locked, actor) {
  var config = APOS_ENTITIES[locked.entity];
  if (!config.idType || !config.key) return null;
  if (['INSERT', 'ARCHIVE', 'DELETE'].indexOf(locked.actualOperation) === -1) return null;
  var found = APOS_findByKey_('idLedger', locked.key);
  var now = APOS_today_();
  var record = found ? APOS_clone_(found.record) : {
    idType: config.idType, idValue: locked.key, canonicalId: locked.key, entitySheet: config.sheet,
    entityStatus: 'ACTIVE', legacyStatus: null, reservationReason: 'APOS APIで新規作成', firstSeenAt: now,
    lastSeenAt: now, source: 'APOS_API', migrationNote: null
  };
  record.canonicalId = locked.key; record.entitySheet = config.sheet; record.lastSeenAt = now;
  if (locked.actualOperation === 'INSERT') { record.entityStatus = 'ACTIVE'; record.reservationReason = locked.reservedIdRestoreAuthorized ? '承認済みRollbackにより復元' : 'APOS APIで新規作成'; }
  if (locked.actualOperation === 'ARCHIVE') { record.entityStatus = 'ARCHIVED'; record.reservationReason = '履歴保持・ID再利用禁止'; }
  if (locked.actualOperation === 'DELETE') { record.entityStatus = 'RESERVED_DELETED'; record.reservationReason = '削除後もID再利用禁止'; }
  if (found) return APOS_updateSystemRecord_('idLedger', locked.key, record);
  return APOS_appendSystemRecord_('idLedger', record);
}

function APOS_appendSystemRecord_(entity, record) {
  var config = APOS_ENTITIES[entity];
  var sheet = APOS_sheet_(config.sheet);
  var headers = APOS_headers_(sheet);
  var normalized = APOS_applyRecordDefaults_(entity, APOS_clone_(record), 'INSERT', 'APOS_SYSTEM');
  APOS_validateRecord_(entity, normalized, { operation: 'INSERT', before: null });
  normalized = APOS_normalizeRecordForStorage_(entity, normalized, headers);
  var row = APOS_recordToRow_(entity, normalized, headers);
  var rowNumber = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  return { kind: 'INSERT', sheetName: config.sheet, rowNumber: rowNumber, beforeRow: null, afterRow: row };
}

function APOS_updateSystemRecord_(entity, key, record) {
  var config = APOS_ENTITIES[entity];
  var found = APOS_findByKey_(entity, key);
  if (!found) APOS_throw_('SYSTEM_RECORD_NOT_FOUND', '内部管理レコードが見つかりません。');
  var sheet = APOS_sheet_(config.sheet); var headers = APOS_headers_(sheet);
  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];
  var normalized = APOS_clone_(record);
  APOS_validateRecord_(entity, normalized, { operation: 'UPDATE', before: found.record });
  normalized = APOS_normalizeRecordForStorage_(entity, normalized, headers);
  var afterRow = APOS_recordToRow_(entity, normalized, headers);
  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([afterRow]);
  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow };
}

function APOS_revertAll_(reversals) {
  for (var i = reversals.length - 1; i >= 0; i--) {
    try { APOS_revertRowChange_(reversals[i]); }
    catch (error) { console.error('ROLLBACK_FAILED ' + String(error.message || error)); }
  }
}

function APOS_revertRowChange_(change) {
  if (!change) return;
  var sheet = APOS_sheet_(change.sheetName);
  if (change.kind === 'INSERT') {
    if (change.rowNumber <= sheet.getLastRow()) sheet.deleteRow(change.rowNumber);
    return;
  }
  if (change.kind === 'UPDATE') {
    if (Array.isArray(change.changedCells) && change.changedCells.length) {
      for (var updateIndex = change.changedCells.length - 1; updateIndex >= 0; updateIndex--) {
        var changedCell = change.changedCells[updateIndex];
        sheet.getRange(change.rowNumber, changedCell.column).setValue(changedCell.beforeValue);
      }
    } else {
      sheet.getRange(change.rowNumber, 1, 1, change.beforeRow.length).setValues([change.beforeRow]);
    }
    return;
  }
  if (change.kind === 'DELETE') {
    sheet.insertRowsBefore(change.rowNumber, 1);
    sheet.getRange(change.rowNumber, 1, 1, change.beforeRow.length).setValues([change.beforeRow]);
  }
}

function APOS_validateLockedPreview_(locked, approval, expectedType) {
  if (!locked || typeof locked !== 'object') APOS_throw_('LOCKED_PREVIEW_REQUIRED', 'lockedPreviewが必要です。');
  if (locked.previewType !== expectedType) APOS_throw_('PREVIEW_TYPE_MISMATCH', 'Preview種別が一致しません。');
  if (!locked.previewId || !locked.requestedAt || !locked.expiresAt) APOS_throw_('LOCKED_PREVIEW_INVALID', 'Preview識別情報が不足しています。');
  if (new Date(locked.expiresAt).getTime() < Date.now()) APOS_throw_('PREVIEW_EXPIRED', 'Previewの有効期限が切れています。');
  var cachedText = CacheService.getScriptCache().get(APOS_previewCacheKey_(locked.previewId));
  if (!cachedText) APOS_throw_('PREVIEW_NOT_AVAILABLE', 'Previewが存在しないか、使用済みです。再Previewしてください。');
  var cached = JSON.parse(cachedText);
  var calculated = APOS_hash_(locked);
  if (cached.type !== expectedType || cached.expiresAt !== locked.expiresAt) APOS_throw_('PREVIEW_CACHE_MISMATCH', '保存済みPreview契約が一致しません。');
  if (!APOS_constantTimeEquals_(calculated, cached.approvalHash) || !APOS_constantTimeEquals_(calculated, String(approval.approvalHash || ''))) {
    APOS_throw_('APPROVAL_HASH_MISMATCH', 'PreviewとapprovalHashが一致しません。');
  }
  if (approval.approved !== true) APOS_throw_('EXPLICIT_APPROVAL_REQUIRED', 'approved=trueが必要です。');
  if (String(approval.approvedBy || '') !== APOS_CONFIG.FINAL_APPROVER) APOS_throw_('APPROVER_MISMATCH', '最終承認者は山下祐樹です。');
  if (!approval.changeReason || String(approval.changeReason).trim().length < 3) APOS_throw_('CHANGE_REASON_REQUIRED', '具体的なchangeReasonが必要です。');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(approval.nonce || ''))) APOS_throw_('NONCE_INVALID', 'nonceは16〜128文字の英数字・_・-で指定してください。');
  var approvedAt = new Date(approval.approvedAt);
  if (isNaN(approvedAt.getTime())) APOS_throw_('APPROVED_AT_INVALID', 'approvedAtはISO日時で指定してください。');
  if (Math.abs(Date.now() - approvedAt.getTime()) > APOS_CONFIG.PREVIEW_TTL_SECONDS * 1000) APOS_throw_('APPROVAL_EXPIRED', '承認日時がPreview有効時間外です。');
  var requestedAt = new Date(locked.requestedAt).getTime();
  var expiresAt = new Date(locked.expiresAt).getTime();
  if (!isFinite(requestedAt) || !isFinite(expiresAt) || approvedAt.getTime() < requestedAt - 5000 || approvedAt.getTime() > expiresAt) {
    APOS_throw_('APPROVAL_TIME_OUTSIDE_PREVIEW', 'approvedAtはPreview作成後かつ有効期限内である必要があります。');
  }
}

function APOS_claimPreview_(locked, expectedType) {
  var key = APOS_previewCacheKey_(locked.previewId);
  var cachedText = CacheService.getScriptCache().get(key);
  if (!cachedText) APOS_throw_('PREVIEW_NOT_AVAILABLE', 'Previewが存在しないか、使用済みです。再Previewしてください。');
  var cached = JSON.parse(cachedText);
  if (cached.type !== expectedType || cached.expiresAt !== locked.expiresAt || !APOS_constantTimeEquals_(cached.approvalHash, APOS_hash_(locked))) {
    APOS_throw_('PREVIEW_CACHE_MISMATCH', '保存済みPreview契約が一致しません。');
  }
  CacheService.getScriptCache().remove(key);
}

function APOS_verifySheetHashes_(items) {
  var checked = {};
  items.forEach(function(item) {
    if (checked[item.entity]) return;
    var current = APOS_sheetStateHash_(item.entity);
    if (current !== item.sheetStateHash) APOS_throw_('CURRENT_STATE_HASH_MISMATCH', 'Preview後に対象シートが変更されています。', { entity: item.entity });
    checked[item.entity] = true;
  });
  var expectedLedgerHash = items.length ? items[0].idLedgerStateHash : null;
  if (expectedLedgerHash && APOS_sheetStateHash_('idLedger') !== expectedLedgerHash) {
    APOS_throw_('CURRENT_LEDGER_HASH_MISMATCH', 'Preview後にID台帳が変更されています。再Previewしてください。');
  }
}

function APOS_assertDeleteAllowed_(items, approval) {
  var hasDelete = items.some(function(item) { return item.actualOperation === 'DELETE'; });
  if (!hasDelete) return;
  var enabled = String(PropertiesService.getScriptProperties().getProperty(APOS_CONFIG.DELETE_PROPERTY) || '').toLowerCase() === 'true';
  if (!enabled) APOS_throw_('PHYSICAL_DELETE_DISABLED', '物理削除は無効です。ARCHIVEを使用してください。');
  if (approval.destructiveApproval !== 'DELETE_APPROVED') APOS_throw_('DESTRUCTIVE_APPROVAL_REQUIRED', '物理削除にはdestructiveApproval=DELETE_APPROVEDが必要です。');
}

function APOS_assertIdAvailableForInsert_(entity, key, options) {
  var config = APOS_ENTITIES[entity];
  if (!config.idType) return;
  var ledger = APOS_findByKey_('idLedger', key);
  if (!ledger) return;
  var status = String(ledger.record.entityStatus || '').toUpperCase();
  var restoreAllowed = options && options.allowReservedIdRestore === true && Boolean(options.rollbackOfChangeId) && status === 'RESERVED_DELETED';
  if (!restoreAllowed) {
    APOS_throw_('ID_REUSE_FORBIDDEN', 'ID台帳に存在するIDは再利用できません。', { entity: entity, key: key, ledgerStatus: status });
  }
}

function APOS_validateLockedRelationships_(items) {
  var pendingProposalIds = {};
  var projected = {};
  items.forEach(function(item) {
    projected[item.entity + '::' + item.key] = item.actualOperation === 'DELETE' ? null : item.after;
    if (item.proposal) pendingProposalIds[String(item.proposal.proposalId)] = true;
  });

  function projectedRecord(entity, key) {
    var signature = entity + '::' + String(key);
    if (Object.prototype.hasOwnProperty.call(projected, signature)) return projected[signature];
    var found = APOS_findByKey_(entity, key);
    return found ? found.record : null;
  }

  items.forEach(function(item) {
    if (!item.after) return;
    var defs = APOS_fieldDefs_(item.sheetName);
    Object.keys(defs).forEach(function(field) {
      var relationship = defs[field].relationship;
      if (!relationship || item.after[field] === null || item.after[field] === undefined || item.after[field] === '') return;
      var target = APOS_parseRelationship_(relationship);
      if (!target) return;
      var targetEntity = APOS_entityBySheet_(target.sheetName);
      if (!targetEntity) APOS_throw_('RELATIONSHIP_SCHEMA_INVALID', '参照先シートがentity定義にありません。', { relationship: relationship });
      APOS_relationshipValues_(item.after[field], field).forEach(function(referenceId) {
        if (targetEntity === 'proposals' && pendingProposalIds[String(referenceId)]) return;
        if (targetEntity === item.entity && String(referenceId) === String(item.key)) APOS_throw_('SELF_REFERENCE_FORBIDDEN', '自己参照は許可されません。', { entity: item.entity, field: field, key: item.key });
        var targetRecord = projectedRecord(targetEntity, referenceId);
        if (!targetRecord || String(targetRecord[target.fieldName]) !== String(referenceId)) {
          APOS_throw_('FOREIGN_KEY_NOT_FOUND', '参照先IDが見つかりません。', { entity: item.entity, field: field, value: referenceId, relationship: relationship });
        }
      });
    });
  });

  var deleted = items.filter(function(item) { return item.actualOperation === 'DELETE'; });
  deleted.forEach(function(deletedItem) {
    Object.keys(APOS_ENTITIES).forEach(function(sourceEntity) {
      var sourceConfig = APOS_ENTITIES[sourceEntity];
      if (!sourceConfig.key || sourceEntity === 'overview') return;
      var defs = APOS_fieldDefs_(sourceConfig.sheet);
      var relationshipFields = Object.keys(defs).filter(function(field) {
        var target = APOS_parseRelationship_(defs[field].relationship);
        return target && target.sheetName === deletedItem.sheetName && target.fieldName === deletedItem.primaryKey;
      });
      if (!relationshipFields.length) return;
      var rows = APOS_readEntityRecords_(sourceEntity, false);
      var keysSeen = {};
      rows.forEach(function(row) { keysSeen[String(row[sourceConfig.key])] = true; });
      items.filter(function(item) { return item.entity === sourceEntity; }).forEach(function(item) { keysSeen[String(item.key)] = true; });
      Object.keys(keysSeen).forEach(function(sourceKey) {
        var row = projectedRecord(sourceEntity, sourceKey);
        if (!row) return;
        relationshipFields.forEach(function(field) {
          if (APOS_relationshipValues_(row[field], field).map(String).indexOf(String(deletedItem.key)) !== -1) {
            APOS_throw_('REFERENTIAL_INTEGRITY_VIOLATION', '参照中のレコードは物理削除できません。ARCHIVEまたは参照更新を使用してください。', {
              targetEntity: deletedItem.entity, targetKey: deletedItem.key, sourceEntity: sourceEntity, sourceKey: sourceKey, field: field
            });
          }
        });
      });
    });
  });
}

function APOS_parseRelationship_(value) {
  var text = String(value || '').trim();
  if (!text) return null;
  var split = text.lastIndexOf('.');
  if (split <= 0 || split >= text.length - 1) return null;
  return { sheetName: text.slice(0, split), fieldName: text.slice(split + 1) };
}

function APOS_entityBySheet_(sheetName) {
  var keys = Object.keys(APOS_ENTITIES);
  for (var i = 0; i < keys.length; i++) if (APOS_ENTITIES[keys[i]].sheet === sheetName) return keys[i];
  return null;
}

function APOS_relationshipValues_(value, field) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return Object.keys(value).map(function(key) { return value[key]; }).filter(Boolean);
  var text = String(value).trim();
  if (!text) return [];
  if (text.charAt(0) === '[') {
    try { var parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed.filter(Boolean); }
    catch (ignore) {}
  }
  if (/Ids$/.test(field) || /^related/.test(field) || /^applied/.test(field)) return text.split(/[,;\n]/).map(function(item) { return item.trim(); }).filter(Boolean);
  return [value];
}

function APOS_cachePreview_(previewId, approvalHash, expiresAt, type) {
  var ttl = Math.max(1, Math.min(APOS_CONFIG.PREVIEW_TTL_SECONDS, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  CacheService.getScriptCache().put(APOS_previewCacheKey_(previewId), JSON.stringify({ approvalHash: approvalHash, expiresAt: expiresAt, type: type }), ttl);
}

function APOS_previewCacheKey_(previewId) { return APOS_CONFIG.CACHE_PREFIX + 'PREVIEW_' + previewId; }
function APOS_nonceCacheKey_(nonce) { return APOS_CONFIG.CACHE_PREFIX + 'NONCE_' + APOS_hash_(String(nonce)).slice(0, 32); }
function APOS_validateNonceUnused_(nonce) {
  if (CacheService.getScriptCache().get(APOS_nonceCacheKey_(nonce))) APOS_throw_('NONCE_REPLAY', '同じnonceは再利用できません。');
  var needle = 'approvalNonceHash=' + APOS_hash_(String(nonce));
  var used = APOS_readEntityRecords_('changes', false).some(function(row) { return String(row.notes || '').indexOf(needle) !== -1; });
  if (used) APOS_throw_('NONCE_REPLAY', '同じnonceは過去の承認で使用済みです。');
}
function APOS_markNonceUsed_(nonce) { CacheService.getScriptCache().put(APOS_nonceCacheKey_(nonce), 'USED', APOS_CONFIG.NONCE_TTL_SECONDS); }

function APOS_readEntityRecords_(entity, includeRowNumber) {
  var config = APOS_ENTITIES[entity];
  var sheet = APOS_sheet_(config.sheet);
  var headers = APOS_headers_(sheet);
  if (sheet.getLastRow() < 2) return [];
  var defs = APOS_fieldDefs_(config.sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var records = [];
  values.forEach(function(row, index) {
    var hasValue = row.some(function(value) { return value !== '' && value !== null; });
    if (!hasValue) return;
    var record = {};
    headers.forEach(function(header, col) { record[header] = APOS_serializeCell_(row[col], defs[header]); });
    if (includeRowNumber) record._rowNumber = index + 2;
    records.push(record);
  });
  return records;
}

function APOS_findByKey_(entity, key) {
  var config = APOS_ENTITIES[entity];
  if (!config || !config.key) return null;
  var sheet = APOS_sheet_(config.sheet); var headers = APOS_headers_(sheet);
  var keyCol = headers.indexOf(config.key);
  if (keyCol < 0) APOS_throw_('PRIMARY_KEY_COLUMN_MISSING', '主キー列がありません。', { sheet: config.sheet, key: config.key });
  if (sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var defs = APOS_fieldDefs_(config.sheet);
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][keyCol]) === String(key)) {
      var record = {};
      headers.forEach(function(header, col) { record[header] = APOS_serializeCell_(values[i][col], defs[header]); });
      return { rowNumber: i + 2, record: record };
    }
  }
  return null;
}

function APOS_recordToRow_(entity, record, headers) {
  var config = APOS_ENTITIES[entity]; var defs = APOS_fieldDefs_(config.sheet);
  return headers.map(function(header) { return APOS_deserializeCell_(record[header], defs[header]); });
}

function APOS_normalizeRecordForStorage_(entity, record, headers) {
  var config = APOS_ENTITIES[entity];
  var defs = APOS_fieldDefs_(config.sheet);
  var row = APOS_recordToRow_(entity, record, headers);
  var normalized = {};
  headers.forEach(function(header, index) {
    normalized[header] = APOS_serializeCell_(row[index], defs[header]);
  });
  return normalized;
}

function APOS_applyRecordDefaults_(entity, record, operation, actor) {
  var config = APOS_ENTITIES[entity]; var sheet = APOS_sheet_(config.sheet); var headers = APOS_headers_(sheet);
  var now = APOS_nowIso_();
  if (headers.indexOf('source') !== -1 && !record.source) record.source = 'APOS_API';
  if (headers.indexOf('migrationStatus') !== -1 && !record.migrationStatus) record.migrationStatus = operation === 'INSERT' ? 'NATIVE' : record.migrationStatus;
  if (headers.indexOf('version') !== -1 && !record.version) record.version = APOS_CONFIG.SCHEMA_VERSION;
  if (headers.indexOf('createdAt') !== -1 && operation === 'INSERT' && !record.createdAt) record.createdAt = now;
  if (headers.indexOf('createdBy') !== -1 && operation === 'INSERT' && !record.createdBy) record.createdBy = actor;
  if (headers.indexOf('updatedAt') !== -1) record.updatedAt = now;
  if (headers.indexOf('updatedBy') !== -1) record.updatedBy = actor;
  if (headers.indexOf('approvalStatus') !== -1 && !record.approvalStatus) record.approvalStatus = 'APPROVED';
  if (headers.indexOf('previewStatus') !== -1 && !record.previewStatus) record.previewStatus = 'PREVIEWED';
  if (headers.indexOf('requestedBy') !== -1 && !record.requestedBy) record.requestedBy = actor;
  return record;
}

function APOS_validateRecord_(entity, record, options) {
  options = options || {};
  var config = APOS_ENTITIES[entity]; var sheet = APOS_sheet_(config.sheet); var headers = APOS_headers_(sheet);
  var warnings = [];
  Object.keys(record).forEach(function(field) {
    if (headers.indexOf(field) === -1) APOS_throw_('UNKNOWN_FIELD', '未定義のフィールドです。', { entity: entity, field: field });
  });
  var defs = APOS_fieldDefs_(config.sheet);
  Object.keys(defs).forEach(function(field) {
    var value = record[field];
    var beforeValue = options.before ? options.before[field] : undefined;
    var legacyUnchanged = options.operation !== 'INSERT' && options.before && APOS_valuesEquivalent_(value, beforeValue);
    if (defs[field].required && (value === null || value === undefined || value === '')) {
      if (legacyUnchanged) warnings.push({ code: 'LEGACY_REQUIRED_FIELD_MISSING', entity: entity, field: field });
      else APOS_throw_('REQUIRED_FIELD_MISSING', '必須項目が不足しています。', { entity: entity, field: field });
    }
    if (value !== null && value !== undefined && value !== '' && defs[field].allowedValues && defs[field].allowedValues.length) {
      var allowed = defs[field].allowedValues.some(function(candidate) { return String(candidate) === String(value); });
      if (!allowed) {
        if (legacyUnchanged) warnings.push({ code: 'LEGACY_VALUE_NOT_ALLOWED', entity: entity, field: field, value: value });
        else APOS_throw_('VALUE_NOT_ALLOWED', '許可されていない値です。', { entity: entity, field: field, value: value, allowedValues: defs[field].allowedValues });
      }
    }
    if (value !== null && value !== undefined && value !== '') {
      try { APOS_deserializeCell_(value, defs[field]); }
      catch (error) {
        if (legacyUnchanged) warnings.push({ code: 'LEGACY_TYPE_INVALID', entity: entity, field: field, value: value });
        else throw error;
      }
    }
  });
  APOS_validateSemanticRecord_(entity, record, options, warnings);
  return warnings;
}

function APOS_validateSemanticRecord_(entity, record, options, warnings) {
  var ranges = {
    readiness: [1, 5], sleepQuality: [1, 5], technicalQuality: [1, 5], successRating: [1, 5],
    mainQuality: [1, 5], goalAchievement: [1, 5], maxVelocityFeel: [1, 5], horizontalVelocityFeel: [1, 5],
    contactStiffnessFeel: [1, 5], phaseConnectionFeel: [1, 5], reproducibility: [1, 5], sessionRPE: [1, 10],
    sleepHours: [0, 24], fileSizeMb: [0, 100000], orderNo: [1, 100000], priority: [1, 100000], intervalWeeks: [1, 5200]
  };
  var nonNegative = ['targetValue', 'personalBest', 'previousSeasonBest', 'referenceBodyMassKg', 'weekNo', 'dayNo', 'plannedSets', 'plannedReps', 'plannedDistanceM', 'plannedDurationMin', 'plannedWeightKg', 'plannedRestSec', 'sets', 'reps', 'distanceM', 'durationSec', 'weightKg', 'restSec', 'actualSets', 'actualReps', 'actualDistanceM', 'actualDurationSec', 'actualWeightKg', 'bestTimeSec', 'averageTimeSec', 'sessionLoad', 'durationMin', 'trialNo', 'timeSec', 'calculatedSpeedMps', 'jumpDistanceM', 'hopDistanceM', 'stepDistanceM', 'jumpPhaseDistanceM'];
  Object.keys(ranges).forEach(function(field) {
    if (record[field] === null || record[field] === undefined || record[field] === '') return;
    APOS_validateRangeOrLegacy_(entity, field, record[field], ranges[field][0], ranges[field][1], options, warnings);
  });
  nonNegative.forEach(function(field) {
    if (record[field] === null || record[field] === undefined || record[field] === '') return;
    APOS_validateRangeOrLegacy_(entity, field, record[field], 0, Infinity, options, warnings);
  });
  var periods = {
    governanceRules: [['effectiveFrom', 'effectiveTo']],
    trainingRules: [['effectiveFrom', 'effectiveTo']],
    cycles: [['plannedStartDate', 'plannedEndDate'], ['observedFirstSessionDate', 'observedLastSessionDate']],
    events: [['startDate', 'endDate']],
    recurrenceRules: [['startDate', 'endDate']]
  };
  (periods[entity] || []).forEach(function(pair) {
    if (!record[pair[0]] || !record[pair[1]]) return;
    if (APOS_normalizeDateString_(record[pair[0]]) > APOS_normalizeDateString_(record[pair[1]])) {
      APOS_throw_('INVALID_DATE_RANGE', pair[0] + 'は' + pair[1] + '以前である必要があります。', { entity: entity, fromField: pair[0], toField: pair[1] });
    }
  });
  if (entity === 'recurrenceRules') {
    var weekdays = APOS_parseJsonSafe_(record.weekdaysJson);
    var allowedWeekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some(function(day) { return allowedWeekdays.indexOf(String(day).toUpperCase()) === -1; })) {
      APOS_throw_('RECURRENCE_WEEKDAYS_INVALID', 'weekdaysJsonには曜日コードの配列が必要です。', { allowedWeekdays: allowedWeekdays });
    }
    if (!APOS_isPlainObject_(APOS_parseJsonSafe_(record.templateJson))) {
      APOS_throw_('RECURRENCE_TEMPLATE_INVALID', 'templateJsonにはobject形式の変更テンプレートが必要です。');
    }
  }
}

function APOS_validateRangeOrLegacy_(entity, field, value, min, max, options, warnings) {
  var number = Number(value);
  var invalid = !isFinite(number) || number < min || number > max;
  if (!invalid) return;
  var beforeValue = options.before ? options.before[field] : undefined;
  if (options.operation !== 'INSERT' && options.before && APOS_valuesEquivalent_(value, beforeValue)) {
    warnings.push({ code: 'LEGACY_VALUE_OUT_OF_RANGE', entity: entity, field: field, value: value, min: min, max: max });
    return;
  }
  APOS_throw_('VALUE_OUT_OF_RANGE', '数値が許容範囲外です。', { entity: entity, field: field, value: value, min: min, max: max });
}

function APOS_fieldDefs_(sheetName) {
  if (sheetName === '98_データ辞書') return {};
  var cache = CacheService.getScriptCache(); var cacheKey = APOS_CONFIG.CACHE_PREFIX + 'DICTIONARY';
  var cached = cache.get(cacheKey); var all;
  if (cached) all = JSON.parse(cached);
  else {
    all = {};
    var sheet = APOS_sheet_('98_データ辞書'); var headers = APOS_headers_(sheet);
    if (sheet.getLastRow() >= 2) {
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
      var index = {}; headers.forEach(function(header, i) { index[header] = i; });
      values.forEach(function(row) {
        var target = String(row[index.sheetName] || ''); var field = String(row[index.fieldName] || '');
        if (!target || !field) return;
        if (!all[target]) all[target] = {};
        var allowedValues = null;
        var validationText = index.validation === undefined ? '' : String(row[index.validation] || '');
        if (validationText) {
          try { var parsedValidation = JSON.parse(validationText); if (Array.isArray(parsedValidation)) allowedValues = parsedValidation; }
          catch (ignore) { allowedValues = null; }
        }
        all[target][field] = {
          dataType: String(row[index.dataType] || 'text').toLowerCase(),
          required: row[index.required] === true || row[index.required] === 1 || String(row[index.required]).toLowerCase() === 'true',
          allowedValues: allowedValues,
          relationship: index.relationship === undefined ? null : String(row[index.relationship] || '').trim() || null,
          editableBy: index.editableBy === undefined ? '' : String(row[index.editableBy] || '').toUpperCase()
        };
      });
    }
    var encoded = JSON.stringify(all);
    if (encoded.length < 90000) cache.put(cacheKey, encoded, 600);
  }
  return all[sheetName] || {};
}

function APOS_serializeCell_(value, def) {
  if (value === '' || value === null || value === undefined) return null;
  var type = def && def.dataType ? def.dataType : 'text';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (type === 'date') return Utilities.formatDate(value, APOS_CONFIG.TIMEZONE, 'yyyy-MM-dd');
    return value.toISOString();
  }
  if (type === 'boolean') return value === true || String(value).toLowerCase() === 'true';
  if (type === 'number' || type === 'integer') return Number(value);
  return value;
}

function APOS_deserializeCell_(value, def) {
  if (value === null || value === undefined || value === '') return '';
  var type = def && def.dataType ? def.dataType : 'text';
  if (type === 'date') return APOS_parseDate_(value);
  if (type === 'datetime') { var dt = new Date(value); if (isNaN(dt.getTime())) APOS_throw_('INVALID_DATETIME', '日時形式が不正です。', { value: value }); return dt; }
  if (type === 'number') { var n = Number(value); if (!isFinite(n)) APOS_throw_('INVALID_NUMBER', '数値形式が不正です。', { value: value }); return n; }
  if (type === 'integer') { var i = Number(value); if (!Number.isInteger(i)) APOS_throw_('INVALID_INTEGER', '整数形式が不正です。', { value: value }); return i; }
  if (type === 'boolean') {
    var boolText = String(value).toLowerCase();
    if (value !== true && value !== false && ['true', 'false', '1', '0'].indexOf(boolText) === -1) APOS_throw_('INVALID_BOOLEAN', 'boolean形式が不正です。', { value: value });
    return value === true || boolText === 'true' || boolText === '1';
  }
  if (type === 'json') {
    if (typeof value === 'object') return APOS_stableStringify_(value);
    try { JSON.parse(String(value)); }
    catch (error) { APOS_throw_('INVALID_JSON_FIELD', 'JSON列の形式が不正です。', { value: value }); }
    return String(value);
  }
  if (typeof value === 'object') APOS_throw_('INVALID_TEXT_TYPE', 'text列へobject/arrayは保存できません。');
  return value;
}

function APOS_sheetStateHash_(entity) {
  var config = APOS_ENTITIES[entity]; var sheet = APOS_sheet_(config.sheet);
  var data = sheet.getDataRange().getValues().map(function(row) {
    return row.map(function(value) { return Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value; });
  });
  return APOS_hash_({ sheet: config.sheet, lastRow: sheet.getLastRow(), lastColumn: sheet.getLastColumn(), data: data });
}

function APOS_workbookStateHash_() {
  var ss = APOS_open_();
  var state = ss.getSheets().map(function(sheet) {
    var data = sheet.getDataRange().getValues().map(function(row) {
      return row.map(function(value) { return Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value; });
    });
    return { name: sheet.getName(), data: data };
  });
  return APOS_hash_(state);
}

function APOS_verifyGatewayEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) APOS_throw_('GATEWAY_ENVELOPE_REQUIRED', '署名済みGateway Envelopeが必要です。');
  var protocolVersion = String(envelope.protocolVersion || '');
  if (protocolVersion !== APOS_GATEWAY_PROTOCOL) APOS_throw_('GATEWAY_PROTOCOL_INVALID', 'Gateway protocolVersionが一致しません。');
  var timestamp = String(envelope.timestamp || '');
  var timestampMs = Date.parse(timestamp);
  if (!isFinite(timestampMs)) APOS_throw_('GATEWAY_TIMESTAMP_INVALID', 'Gateway timestampが不正です。');
  if (Math.abs(Date.now() - timestampMs) > APOS_CONFIG.GATEWAY_CLOCK_SKEW_SECONDS * 1000) APOS_throw_('GATEWAY_TIMESTAMP_EXPIRED', 'Gateway timestampが許容時間外です。');
  var nonce = String(envelope.nonce || '');
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(nonce)) APOS_throw_('GATEWAY_NONCE_INVALID', 'Gateway nonceが不正です。');
  var action = String(envelope.action || '').trim();
  if (!action) APOS_throw_('ACTION_REQUIRED', 'actionが必要です。');
  var requestId = String(envelope.requestId || '').trim();
  if (!requestId) APOS_throw_('REQUEST_ID_REQUIRED', 'requestIdが必要です。');
  var body = envelope.body && typeof envelope.body === 'object' && !Array.isArray(envelope.body) ? envelope.body : {};
  var actor = envelope.actor && typeof envelope.actor === 'object' && !Array.isArray(envelope.actor) ? envelope.actor : { id: 'apostrophe', source: 'UNKNOWN' };
  var bodyHash = String(envelope.bodyHash || '');
  var calculatedBodyHash = APOS_hash_(body);
  if (!APOS_constantTimeEquals_(bodyHash, calculatedBodyHash)) APOS_throw_('GATEWAY_BODY_HASH_MISMATCH', 'Gateway bodyHashが一致しません。');
  var secret = String(PropertiesService.getScriptProperties().getProperty(APOS_CONFIG.HMAC_SECRET_PROPERTY) || '');
  if (secret.length < 32) APOS_throw_('GATEWAY_HMAC_NOT_CONFIGURED', 'Script Propertiesに32文字以上のAPOS_GATEWAY_HMAC_SECRETを設定してください。');
  var signatureDocument = {
    protocolVersion: protocolVersion,
    timestamp: timestamp,
    nonce: nonce,
    action: action,
    requestId: requestId,
    bodyHash: bodyHash,
    actor: actor
  };
  var expectedSignature = APOS_hmacSha256_(APOS_stableStringify_(signatureDocument), secret);
  if (!APOS_constantTimeEquals_(String(envelope.signature || ''), expectedSignature)) APOS_throw_('GATEWAY_SIGNATURE_MISMATCH', 'Gateway署名を検証できません。');
  var gatewayNonceKey = APOS_CONFIG.CACHE_PREFIX + 'GW_' + APOS_hash_(nonce).slice(0, 32);
  var cache = CacheService.getScriptCache();
  if (cache.get(gatewayNonceKey)) APOS_throw_('GATEWAY_NONCE_REPLAY', 'Gateway nonceは使用済みです。');
  cache.put(gatewayNonceKey, 'USED', APOS_CONFIG.GATEWAY_CLOCK_SKEW_SECONDS * 2);
  return { action: action, requestId: requestId, nonce: nonce, actor: actor, body: body };
}

function APOS_hmacSha256_(value, secret) {
  var bytes = Utilities.computeHmacSha256Signature(String(value), String(secret), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) { var v = byte < 0 ? byte + 256 : byte; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function APOS_constantTimeEquals_(a, b) {
  var ah = APOS_hash_(String(a)); var bh = APOS_hash_(String(b)); var diff = 0;
  for (var i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  return diff === 0;
}

function APOS_hash_(value) {
  var text = typeof value === 'string' ? value : APOS_stableStringify_(value);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(byte) { var v = byte < 0 ? byte + 256 : byte; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function APOS_stableStringify_(value) {
  if (value === null || value === undefined) return 'null';
  if (Object.prototype.toString.call(value) === '[object Date]') return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(APOS_stableStringify_).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ':' + APOS_stableStringify_(value[key]); }).join(',') + '}';
  return JSON.stringify(value);
}

function APOS_matchesFilters_(record, filters) {
  return Object.keys(filters).every(function(field) {
    var condition = filters[field]; var value = record[field];
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      var allowedOperators = ['$in', '$gte', '$lte', '$contains', '$ne'];
      Object.keys(condition).forEach(function(operator) { if (allowedOperators.indexOf(operator) === -1) APOS_throw_('FILTER_OPERATOR_INVALID', '未対応のfilter演算子です。', { field: field, operator: operator }); });
      if (condition.$in !== undefined && !Array.isArray(condition.$in)) APOS_throw_('FILTER_IN_INVALID', '$inは配列で指定してください。', { field: field });
      if (condition.$in && condition.$in.map(String).indexOf(String(value)) === -1) return false;
      if (condition.$gte !== undefined && value < condition.$gte) return false;
      if (condition.$lte !== undefined && value > condition.$lte) return false;
      if (condition.$contains !== undefined && String(value || '').indexOf(String(condition.$contains)) === -1) return false;
      if (condition.$ne !== undefined && String(value) === String(condition.$ne)) return false;
      return true;
    }
    return String(value) === String(condition);
  });
}

function APOS_assertMutationPayloadEditable_(entity, payload, operation, options) {
  options = options || {};
  if (!payload || !APOS_isPlainObject_(payload)) return;
  var config = APOS_ENTITIES[entity];
  var headers = APOS_headers_(APOS_sheet_(config.sheet));
  var defs = APOS_fieldDefs_(config.sheet);
  Object.keys(payload).forEach(function(field) {
    if (headers.indexOf(field) === -1) APOS_throw_('UNKNOWN_FIELD', '未定義のフィールドです。', { entity: entity, field: field });
    if (field === config.key) return;
    var editableBy = defs[field] && defs[field].editableBy ? String(defs[field].editableBy).toUpperCase() : '';
    if (editableBy === 'SYSTEM' && options.allowSystemFieldRestore !== true) {
      APOS_throw_('READ_ONLY_FIELD', 'SYSTEM管理フィールドは外部Mutationから変更できません。', { entity: entity, field: field, editableBy: editableBy, operation: operation });
    }
  });
}

function APOS_pickContextFields_(record, fields, maxTextChars) {
  var out = {};
  var maxChars = Number(maxTextChars || 0);
  (fields || []).forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(record || {}, field)) return;
    var value = record[field];
    if (maxChars > 0 && typeof value === 'string' && value.length > maxChars) value = value.slice(0, maxChars) + '…';
    out[field] = value;
  });
  return out;
}

function APOS_jsonBytes_(value) {
  return Utilities.newBlob(JSON.stringify(value || {}), 'application/json').getBytes().length;
}

function APOS_trimStringsDeep_(value, maxChars) {
  if (Array.isArray(value)) return value.map(function(item) { return APOS_trimStringsDeep_(item, maxChars); });
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function(key) { out[key] = APOS_trimStringsDeep_(value[key], maxChars); });
    return out;
  }
  if (typeof value === 'string' && value.length > maxChars) return value.slice(0, maxChars) + '…';
  return value;
}

function APOS_contextTarget_(response, path) {
  var parts = path.split('.'); var obj = response;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!obj) return { obj: null, key: parts[parts.length - 1] };
    obj = obj[parts[i]];
  }
  return { obj: obj, key: parts[parts.length - 1] };
}

function APOS_limitContextArray_(response, path, limit, reason) {
  var t = APOS_contextTarget_(response, path);
  var arr = t.obj && t.obj[t.key];
  if (Array.isArray(arr) && arr.length > limit) {
    t.obj[t.key] = arr.slice(0, limit);
    response.truncated = true;
    if (response.omittedSections.indexOf(reason || (path + ':truncated')) === -1) response.omittedSections.push(reason || (path + ':truncated'));
  }
}

function APOS_enforceContextBudget_(response) {
  var budget = APOS_CONFIG.CONTEXT_PAYLOAD_BUDGET_BYTES;
  function bytes() { return APOS_jsonBytes_(response); }
  function applyLimits(plan, label) {
    plan.forEach(function(item) { APOS_limitContextArray_(response, item[0], item[1], item[0] + ':' + label); });
  }
  if (bytes() > budget) applyLimits([
    ['pendingProposals', 2], ['exerciseGuides', 16], ['menuItems', 40], ['governanceRules', 8], ['trainingRules', 10], ['cycles', 3], ['sessions', 6],
    ['recentHistory.reviews', 4], ['recentHistory.executions', 12], ['recentHistory.measurements', 12], ['events', 2], ['upcomingEvents', 2], ['recurrenceRules', 5]
  ], 'stage1');
  if (bytes() > budget) {
    var trimmed = APOS_trimStringsDeep_(response, 350);
    Object.keys(response).forEach(function(key) { delete response[key]; });
    Object.keys(trimmed).forEach(function(key) { response[key] = trimmed[key]; });
    response.truncated = true; response.omittedSections = response.omittedSections || []; response.omittedSections.push('textFields:max350');
  }
  if (bytes() > budget) {
    applyLimits([
      ['pendingProposals', 1], ['exerciseGuides', 10], ['menuItems', 24], ['governanceRules', 6], ['trainingRules', 8], ['cycles', 2], ['sessions', 4],
      ['recentHistory.reviews', 3], ['recentHistory.executions', 8], ['recentHistory.measurements', 8], ['events', 1], ['upcomingEvents', 1], ['recurrenceRules', 3]
    ], 'stage2');
    var trimmed2 = APOS_trimStringsDeep_(response, 220);
    Object.keys(response).forEach(function(key) { delete response[key]; });
    Object.keys(trimmed2).forEach(function(key) { response[key] = trimmed2[key]; });
    response.truncated = true; response.omittedSections = response.omittedSections || []; response.omittedSections.push('textFields:max220');
  }
  if (bytes() > budget) {
    applyLimits([
      ['pendingProposals', 0], ['exerciseGuides', 8], ['menuItems', 16], ['governanceRules', 5], ['trainingRules', 6], ['cycles', 2], ['sessions', 4],
      ['recentHistory.reviews', 2], ['recentHistory.executions', 5], ['recentHistory.measurements', 6], ['events', 1], ['upcomingEvents', 1], ['recurrenceRules', 2]
    ], 'stage3');
    response.governanceRules = (response.governanceRules || []).map(function(r){ return APOS_pickContextFields_(r, ['ruleId','ruleName','priorityLevel','executionOrder','effectiveFrom','effectiveTo'], 140); });
    response.trainingRules = (response.trainingRules || []).map(function(r){ return APOS_pickContextFields_(r, ['ruleId','ruleName','category','ruleType','priority','effectiveFrom','effectiveTo','purpose','risk'], 140); });
    response.sessions = (response.sessions || []).map(function(r){ return APOS_pickContextFields_(r, ['sessionId','sessionDate','cycleId','eventId','role','title','mainAdaptation','purpose','intensity','planStatus','approvalStatus'], 160); });
    response.menuItems = (response.menuItems || []).map(function(r){ return APOS_pickContextFields_(r, ['menuItemId','sessionId','orderNo','exerciseId','exerciseNameSnapshot','purpose','sets','reps','distanceM','durationSec','weightKg','intensity','restSec','cue','itemStatus'], 140); });
    response.exerciseGuides = (response.exerciseGuides || []).map(function(r){ return APOS_pickContextFields_(r, ['exerciseId','yukiName','generalName','category','mainPurpose','targetAbility','cue','stopCondition','status'], 140); });
    response.truncated = true; response.omittedSections.push('coreFields:stage3');
  }
  if (bytes() > budget) {
    response.pendingProposals = [];
    response.exerciseGuides = [];
    response.recurrenceRules = [];
    response.recentHistory = response.recentHistory || {};
    response.recentHistory.reviews = [];
    response.recentHistory.executions = (response.recentHistory.executions || []).slice(0, 3).map(function(r){ return APOS_pickContextFields_(r, ['executionId','executionDate','sessionId','exerciseId','exerciseName','bestTimeSec','averageTimeSec','technicalQuality','successRating'], 90); });
    response.recentHistory.measurements = (response.recentHistory.measurements || []).slice(0, 4).map(function(r){ return APOS_pickContextFields_(r, ['measurementId','date','sessionId','measurementType','exerciseId','exerciseName','measurementValue','unit','distanceM','timeSec','jumpDistanceM','dataQuality'], 90); });
    response.truncated = true; response.omittedSections.push('nonessentialSections:omitted');
  }
  if (bytes() > budget) {
    response.ruleConflicts = (response.ruleConflicts || []).slice(0, 4);
    response.operationalConflicts = (response.operationalConflicts || []).slice(0, 4);
    response.dailyReviews = (response.dailyReviews || []).slice(0, 1);
    response.events = (response.events || []).slice(0, 1);
    response.upcomingEvents = (response.upcomingEvents || []).slice(0, 1);
    response.truncated = true; response.omittedSections.push('conflictsAndReviews:reduced');
    var trimmed3 = APOS_trimStringsDeep_(response, 120);
    Object.keys(response).forEach(function(key) { delete response[key]; });
    Object.keys(trimmed3).forEach(function(key) { response[key] = trimmed3[key]; });
  }
  response.payloadBytes = APOS_jsonBytes_(response);
  if (response.payloadBytes > budget) APOS_throw_('CONTEXT_PAYLOAD_BUDGET_EXCEEDED', 'Context read-modelを安全予算内へ縮小できませんでした。', { payloadBytes: response.payloadBytes, payloadBudgetBytes: budget });
  return response;
}

function APOS_redactRecord_(entity, record) {
  var output = APOS_clone_(record);
  if (entity === 'settings' && APOS_SECRET_KEY_PATTERN.test(String(output.systemKey || ''))) output.systemValue = 'REDACTED';
  return output;
}

function APOS_resolveEntity_(input) {
  var value = String(input || '').trim();
  if (APOS_ENTITIES[value]) return value;
  if (APOS_DEPRECATED_ENTITY_ALIASES[value]) return APOS_DEPRECATED_ENTITY_ALIASES[value];
  var keys = Object.keys(APOS_ENTITIES);
  for (var i = 0; i < keys.length; i++) if (APOS_ENTITIES[keys[i]].sheet === value) return keys[i];
  APOS_throw_('UNKNOWN_ENTITY', '未定義のentityです。', { entity: value });
}

function APOS_open_() { return SpreadsheetApp.openById(APOS_CONFIG.SPREADSHEET_ID); }
function APOS_sheet_(name) { var sheet = APOS_open_().getSheetByName(name); if (!sheet) APOS_throw_('SHEET_NOT_FOUND', 'シートがありません。', { sheet: name }); return sheet; }
function APOS_headers_(sheet) { if (sheet.getLastColumn() < 1) return []; return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function(v) { return String(v).trim(); }); }

function APOS_generateEntityId_(entity) {
  var prefix = APOS_ENTITIES[entity].prefix || 'ID';
  for (var attempt = 0; attempt < 10; attempt++) {
    var candidate = APOS_generateId_(prefix);
    if (!APOS_findByKey_(entity, candidate) && !APOS_findByKey_('idLedger', candidate)) return candidate;
  }
  APOS_throw_('ID_GENERATION_FAILED', '未使用IDを生成できませんでした。');
}
function APOS_generateId_(prefix) { return String(prefix) + '_' + Utilities.formatDate(new Date(), APOS_CONFIG.TIMEZONE, 'yyyyMMddHHmmssSSS') + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }
function APOS_requestId_() { return 'REQ_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20); }
function APOS_nowIso_() { return new Date().toISOString(); }
function APOS_today_() { return Utilities.formatDate(new Date(), APOS_CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function APOS_cleanActor_() { for (var i = 0; i < arguments.length; i++) if (arguments[i] && String(arguments[i]).trim()) return String(arguments[i]).trim().slice(0, 120); return 'apostrophe'; }
function APOS_clone_(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function APOS_merge_(base, patch) { var out = APOS_clone_(base || {}); Object.keys(patch || {}).forEach(function(key) { out[key] = patch[key]; }); return out; }
function APOS_parseJsonOrNull_(value) { if (!value) return null; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch (error) { APOS_throw_('INVALID_STORED_JSON', '保存済み変更履歴JSONを復元できません。'); } }

function APOS_parseDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) APOS_throw_('INVALID_DATE', '日付はYYYY-MM-DD形式で指定してください。', { value: value });
  var year = Number(match[1]); var month = Number(match[2]); var day = Number(match[3]);
  var parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) APOS_throw_('INVALID_DATE', '存在しない日付です。', { value: value });
  return parsed;
}

function APOS_normalizeDateString_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return Utilities.formatDate(value, APOS_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var parsed = APOS_parseDate_(value);
  return Utilities.formatDate(parsed, APOS_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function APOS_addDays_(dateString, days) {
  var date = APOS_parseDate_(dateString);
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, APOS_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function APOS_effectiveDateFromRecord_(record) {
  if (!record) return null;
  var fields = ['sessionDate', 'executionDate', 'date', 'targetDate', 'startDate', 'effectiveFrom', 'changedAt'];
  for (var i = 0; i < fields.length; i++) if (record[fields[i]]) return APOS_normalizeDateString_(record[fields[i]]);
  return null;
}

function APOS_normalizeSearchText_(value) {
  var text = String(value === null || value === undefined ? '' : value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[\-_/・,，.。()（）\[\]【】]/g, '');
}

function APOS_joinNotes_() {
  var values = [];
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i] !== null && arguments[i] !== undefined && String(arguments[i]).trim()) values.push(String(arguments[i]).trim());
  }
  return values.join('; ');
}

function APOS_boundedInteger_(value, defaultValue, min, max, code) {
  var resolved = value === null || value === undefined || value === '' ? defaultValue : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) APOS_throw_(code || 'INTEGER_OUT_OF_RANGE', '整数パラメータが許容範囲外です。', { value: value, min: min, max: max });
  return resolved;
}

function APOS_isPlainObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function APOS_valuesEquivalent_(a, b) { return APOS_stableStringify_(a) === APOS_stableStringify_(b); }
function APOS_parseJsonSafe_(value) { if (!value) return null; if (typeof value === 'object') return value; try { return JSON.parse(String(value)); } catch (ignore) { return null; } }
function APOS_textOrJson_(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'object' ? APOS_stableStringify_(value) : String(value);
}

function APOS_assertLockedSize_(locked) { if (APOS_stableStringify_(locked).length > APOS_CONFIG.MAX_LOCKED_PREVIEW_CHARS) APOS_throw_('PREVIEW_TOO_LARGE', 'Previewが大きすぎます。バッチを分割してください。'); }
function APOS_throw_(code, message, details) { var error = new Error(message); error.aposCode = code; error.aposDetails = details || null; throw error; }
function APOS_errorResponse_(error, requestId) { return { success: false, code: error.aposCode || 'INTERNAL_ERROR', error: error.aposCode ? String(error.message || error) : '内部エラーが発生しました。', details: error.aposDetails || null, requestId: requestId, version: APOS_CONFIG.API_VERSION, generatedAt: APOS_nowIso_() }; }
function APOS_json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

/** Run manually in the Apps Script editor after setting Script Properties. */
function APOS_localSetupCheck() {
  var result = APOS_health_();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
