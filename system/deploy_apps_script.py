#!/usr/bin/env python3
import hashlib
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCRIPT_API = "https://script.googleapis.com/v1"

def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def apply_approved_start_time_fix(source):
    if (" * Version: 1.2.4" in source or " * Version: 1.2.5" in source) and "APOS_isCompactSessionStartTimeLocked_" in source:
        return source
    if " * Version: 1.2.3" in source and "changedCells: changedCells" in source:
        replacements_v124 = [
            (" * Version: 1.2.3", " * Version: 1.2.4"),
            ("  API_VERSION: '1.2.3',", "  API_VERSION: '1.2.4',"),
            (
                "  if (proposal && after && after.sportProfileId && String(after.sportProfileId) !== String(proposal.sportProfileId)) {\n    APOS_throw_('PROPOSAL_SPORT_PROFILE_MISMATCH', '提案のsportProfileIdと変更対象が一致しません。');\n  }\n  var now = new Date();",
                "  if (proposal && after && after.sportProfileId && String(after.sportProfileId) !== String(proposal.sportProfileId)) {\n    APOS_throw_('PROPOSAL_SPORT_PROFILE_MISMATCH', '提案のsportProfileIdと変更対象が一致しません。');\n  }\n  var compactStartTimeOnly = entity === 'sessions' && actualOperation === 'UPDATE';\n  if (compactStartTimeOnly) {\n    var suppliedChangeKeys = Object.keys(suppliedChanges).filter(function(field) { return field !== config.key; });\n    compactStartTimeOnly = suppliedChangeKeys.length === 1 && suppliedChangeKeys[0] === 'startTime';\n  }\n  if (compactStartTimeOnly) {\n    var compactFields = [config.key, 'sportProfileId', 'sessionDate', 'startTime', 'updatedAt'];\n    var compactBefore = {};\n    var compactAfter = {};\n    compactFields.forEach(function(field) {\n      if (before && Object.prototype.hasOwnProperty.call(before, field)) compactBefore[field] = before[field];\n      if (after && Object.prototype.hasOwnProperty.call(after, field)) compactAfter[field] = after[field];\n    });\n    before = compactBefore;\n    after = compactAfter;\n    if (proposal) {\n      proposal.beforeJson = APOS_clone_(compactBefore);\n      proposal.proposedJson = APOS_clone_(compactAfter);\n    }\n  }\n  var now = new Date();",
            ),
            (
                "    beforePayload: locked.before ? APOS_stableStringify_(locked.before) : null,",
                "    beforePayload: rowChange.beforeRecord ? APOS_stableStringify_(rowChange.beforeRecord) : (locked.before ? APOS_stableStringify_(locked.before) : null),",
            ),
            (
                "function APOS_executeRowMutation_(locked, approval) {",
                "function APOS_isCompactSessionStartTimeLocked_(locked) {\n  if (!locked || locked.entity !== 'sessions' || locked.actualOperation !== 'UPDATE' || !locked.before || !locked.after) return false;\n  var allowed = { sessionId: true, sportProfileId: true, sessionDate: true, startTime: true, updatedAt: true };\n  var beforeKeys = Object.keys(locked.before);\n  var afterKeys = Object.keys(locked.after);\n  if (!Object.prototype.hasOwnProperty.call(locked.after, 'startTime')) return false;\n  return beforeKeys.length <= 5 && afterKeys.length <= 5 &&\n    beforeKeys.every(function(key) { return allowed[key] === true; }) &&\n    afterKeys.every(function(key) { return allowed[key] === true; });\n}\n\nfunction APOS_executeRowMutation_(locked, approval) {",
            ),
            (
                "  var found = APOS_findByKey_(entity, locked.key);\n  var afterRecord = locked.after ? APOS_clone_(locked.after) : null;",
                "  var found = APOS_findByKey_(entity, locked.key);\n  var compactStartTimeUpdate = APOS_isCompactSessionStartTimeLocked_(locked);\n  var currentBeforeRecord = found ? APOS_clone_(found.record) : null;\n  var afterRecord = locked.after ? (compactStartTimeUpdate ? APOS_merge_(currentBeforeRecord, locked.after) : APOS_clone_(locked.after)) : null;",
            ),
            (
                "    APOS_validateRecord_(entity, afterRecord, { operation: locked.actualOperation, before: locked.before });",
                "    APOS_validateRecord_(entity, afterRecord, { operation: locked.actualOperation, before: compactStartTimeUpdate ? currentBeforeRecord : locked.before });",
            ),
            (
                "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var beforeExpectedRow = APOS_recordToRow_(entity, locked.before, headers);\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  var changedCells = [];",
                "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var comparisonBeforeRecord = compactStartTimeUpdate ? currentBeforeRecord : locked.before;\n  var beforeExpectedRow = APOS_recordToRow_(entity, comparisonBeforeRecord, headers);\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  var changedCells = [];",
            ),
            (
                "    var beforeValue = locked.before ? locked.before[field] : null;",
                "    var beforeValue = comparisonBeforeRecord ? comparisonBeforeRecord[field] : null;",
            ),
            (
                "  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow, changedCells: changedCells, afterRecord: afterRecord };",
                "  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow, changedCells: changedCells, beforeRecord: currentBeforeRecord, afterRecord: afterRecord };",
            ),
        ]
        for find, replace in replacements_v124:
            count = source.count(find)
            if count != 1:
                raise RuntimeError(f"Approved compact startTime preview fix precondition mismatch: expected 1, actual {count}")
            source = source.replace(find, replace, 1)
        return source
    if " * Version: 1.2.2" in source and "function APOS_prepareStorageFormats_(" in source:
        replacements_v123 = [
            (" * Version: 1.2.2", " * Version: 1.2.3"),
            ("  API_VERSION: '1.2.2',", "  API_VERSION: '1.2.3',"),
            (
                "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  APOS_prepareStorageFormats_(sheet, found.rowNumber, headers, entity);\n  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([afterRow]);\n  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow, afterRecord: afterRecord };",
                "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var beforeExpectedRow = APOS_recordToRow_(entity, locked.before, headers);\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  var changedCells = [];\n  APOS_prepareStorageFormats_(sheet, found.rowNumber, headers, entity);\n  for (var col = 0; col < headers.length; col++) {\n    var field = headers[col];\n    var beforeValue = locked.before ? locked.before[field] : null;\n    var afterValue = afterRecord ? afterRecord[field] : null;\n    if (APOS_stableStringify_(beforeValue) === APOS_stableStringify_(afterValue)) continue;\n    changedCells.push({ column: col + 1, beforeValue: beforeExpectedRow[col], afterValue: afterRow[col] });\n  }\n  try {\n    changedCells.forEach(function(cellChange) {\n      sheet.getRange(found.rowNumber, cellChange.column).setValue(cellChange.afterValue);\n    });\n  } catch (error) {\n    for (var restoreIndex = changedCells.length - 1; restoreIndex >= 0; restoreIndex--) {\n      try {\n        var restoreCell = changedCells[restoreIndex];\n        sheet.getRange(found.rowNumber, restoreCell.column).setValue(restoreCell.beforeValue);\n      } catch (ignore) {}\n    }\n    throw error;\n  }\n  return { kind: 'UPDATE', sheetName: config.sheet, rowNumber: found.rowNumber, beforeRow: beforeRow, afterRow: afterRow, changedCells: changedCells, afterRecord: afterRecord };",
            ),
            (
                "  if (change.kind === 'UPDATE') {\n    sheet.getRange(change.rowNumber, 1, 1, change.beforeRow.length).setValues([change.beforeRow]);\n    return;\n  }",
                "  if (change.kind === 'UPDATE') {\n    if (Array.isArray(change.changedCells) && change.changedCells.length) {\n      for (var updateIndex = change.changedCells.length - 1; updateIndex >= 0; updateIndex--) {\n        var changedCell = change.changedCells[updateIndex];\n        sheet.getRange(change.rowNumber, changedCell.column).setValue(changedCell.beforeValue);\n      }\n    } else {\n      sheet.getRange(change.rowNumber, 1, 1, change.beforeRow.length).setValues([change.beforeRow]);\n    }\n    return;\n  }",
            ),
        ]
        for find, replace in replacements_v123:
            count = source.count(find)
            if count != 1:
                raise RuntimeError(f"Approved partial UPDATE fix precondition mismatch: expected 1, actual {count}")
            source = source.replace(find, replace, 1)
        return source
    replacements = [
        (" * Version: 1.2.1", " * Version: 1.2.2"),
        ("  API_VERSION: '1.2.1',", "  API_VERSION: '1.2.2',"),
        (
            "    var insertValues = APOS_recordToRow_(entity, afterRecord, headers);\n    var newRow = Math.max(sheet.getLastRow() + 1, 2);\n    sheet.getRange(newRow, 1, 1, headers.length).setValues([insertValues]);",
            "    var insertValues = APOS_recordToRow_(entity, afterRecord, headers);\n    var newRow = Math.max(sheet.getLastRow() + 1, 2);\n    APOS_prepareStorageFormats_(sheet, newRow, headers, entity);\n    sheet.getRange(newRow, 1, 1, headers.length).setValues([insertValues]);",
        ),
        (
            "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([afterRow]);",
            "  var beforeRow = sheet.getRange(found.rowNumber, 1, 1, headers.length).getValues()[0];\n  var afterRow = APOS_recordToRow_(entity, afterRecord, headers);\n  APOS_prepareStorageFormats_(sheet, found.rowNumber, headers, entity);\n  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([afterRow]);",
        ),
        (
            "function APOS_verifyMutationResult_(locked, expectedAfter) {",
            "function APOS_prepareStorageFormats_(sheet, rowNumber, headers, entity) {\n  // sessions.startTime is canonical text (HH:MM). Google Sheets can otherwise\n  // auto-coerce values such as \\\"14:30\\\" into a time serial, which breaks exact\n  // read-back verification and the canonical text contract.\n  if (entity !== 'sessions') return;\n  var startTimeCol = headers.indexOf('startTime');\n  if (startTimeCol < 0) return;\n  sheet.getRange(rowNumber, startTimeCol + 1).setNumberFormat('@');\n}\n\nfunction APOS_verifyMutationResult_(locked, expectedAfter) {",
        ),
    ]
    for find, replace in replacements:
        count = source.count(find)
        if count != 1:
            raise RuntimeError(f"Approved startTime fix precondition mismatch: expected 1, actual {count}")
        source = source.replace(find, replace, 1)
    return source

def apply_approved_id_reuse_fix(source):
    if " * Version: 1.2.5" in source and "legacyReuseAllowed = status === 'RESERVED_LEGACY'" in source:
        return source
    if " * Version: 1.2.4" not in source or "APOS_isCompactSessionStartTimeLocked_" not in source:
        raise RuntimeError("Approved RESERVED_LEGACY reuse baseline 1.2.4 was not found; refusing deployment")
    replacements = [
        (" * Version: 1.2.4", " * Version: 1.2.5"),
        ("  API_VERSION: '1.2.4',", "  API_VERSION: '1.2.5',"),
        (
            "function APOS_assertIdAvailableForInsert_(entity, key, options) {\n  var config = APOS_ENTITIES[entity];\n  if (!config.idType) return;\n  var ledger = APOS_findByKey_('idLedger', key);\n  if (!ledger) return;\n  var status = String(ledger.record.entityStatus || '').toUpperCase();\n  var restoreAllowed = options && options.allowReservedIdRestore === true && Boolean(options.rollbackOfChangeId) && status === 'RESERVED_DELETED';\n  if (!restoreAllowed) {\n    APOS_throw_('ID_REUSE_FORBIDDEN', 'ID台帳に存在するIDは再利用できません。', { entity: entity, key: key, ledgerStatus: status });\n  }\n}",
            "function APOS_assertIdAvailableForInsert_(entity, key, options) {\n  var config = APOS_ENTITIES[entity];\n  if (!config.idType) return;\n  var ledger = APOS_findByKey_('idLedger', key);\n  if (!ledger) return;\n  var status = String(ledger.record.entityStatus || '').toUpperCase();\n  var legacyReuseAllowed = status === 'RESERVED_LEGACY';\n  var restoreAllowed = options && options.allowReservedIdRestore === true && Boolean(options.rollbackOfChangeId) && status === 'RESERVED_DELETED';\n  if (!legacyReuseAllowed && !restoreAllowed) {\n    APOS_throw_('ID_REUSE_FORBIDDEN', 'このIDは再利用できません。RESERVED_LEGACYのみ通常の新規登録で再利用できます。', { entity: entity, key: key, ledgerStatus: status });\n  }\n}",
        ),
        (
            "  var found = APOS_findByKey_('idLedger', locked.key);\n  var now = APOS_today_();\n  var record = found ? APOS_clone_(found.record) : {",
            "  var found = APOS_findByKey_('idLedger', locked.key);\n  var previousLedgerStatus = found ? String(found.record.entityStatus || '').toUpperCase() : '';\n  var now = APOS_today_();\n  var record = found ? APOS_clone_(found.record) : {",
        ),
        (
            "  if (locked.actualOperation === 'INSERT') { record.entityStatus = 'ACTIVE'; record.reservationReason = locked.reservedIdRestoreAuthorized ? '承認済みRollbackにより復元' : 'APOS APIで新規作成'; }",
            "  if (locked.actualOperation === 'INSERT') { record.entityStatus = 'ACTIVE'; record.reservationReason = locked.reservedIdRestoreAuthorized ? '承認済みRollbackにより復元' : (previousLedgerStatus === 'RESERVED_LEGACY' ? '旧RESERVED_LEGACY番号を正式IDとして再利用' : 'APOS APIで新規作成'); }",
        ),
    ]
    for find, replace in replacements:
        count = source.count(find)
        if count != 1:
            raise RuntimeError(f"Approved RESERVED_LEGACY reuse precondition mismatch: expected 1, actual {count}")
        source = source.replace(find, replace, 1)
    return source

def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value

def http_json(url, method="GET", body=None, token=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Google API request failed: HTTP {exc.code} {exc.reason}") from exc

def oauth_access_token():
    form = urllib.parse.urlencode({
        "client_id": required("APOS_GOOGLE_OAUTH_CLIENT_ID"),
        "client_secret": required("APOS_GOOGLE_OAUTH_CLIENT_SECRET"),
        "refresh_token": required("APOS_GOOGLE_OAUTH_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=form, headers={"Content-Type":"application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"OAuth token exchange failed: HTTP {exc.code} {exc.reason}") from exc
    token = data.get("access_token")
    if not token:
        raise RuntimeError("OAuth response did not contain access_token")
    return token

def main():
    script_id = required("APOS_APPS_SCRIPT_PROJECT_ID")
    deployment_id = required("APOS_APPS_SCRIPT_DEPLOYMENT_ID")
    code_file_name = os.environ.get("APOS_APPS_SCRIPT_CODE_FILE_NAME","Code").strip() or "Code"
    source_path = os.environ.get("APOS_APPS_SCRIPT_SOURCE_PATH","system/apps-script/Code.gs")
    source = open(source_path, "r", encoding="utf-8").read()
    source = apply_approved_start_time_fix(source)
    source = apply_approved_id_reuse_fix(source)
    expected_source_sha256 = sha256_text(source)
    token = oauth_access_token()

    content = http_json(f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/content", token=token)
    files = content.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("Apps Script getContent returned no files")

    original_file_keys = {(f.get("name"), f.get("type")) for f in files}
    manifest_key = ("appsscript", "JSON")
    if manifest_key not in original_file_keys:
        raise RuntimeError("Required appsscript/JSON manifest was not found; refusing to update project")

    original_source = source
    probe_marker = "function doGet(e) {\n  var action = e && e.parameter && e.parameter.action ? String(e.parameter.action) : 'health';"
    probe_replacement = """function doGet(e) {
  var action = e && e.parameter && e.parameter.action ? String(e.parameter.action) : 'health';
  if (action === '__backendProbe') {
    var mode = e && e.parameter && e.parameter.mode ? String(e.parameter.mode) : '';
    var started = Date.now();
    try {
      if (mode === 'drive') {
        var file = DriveApp.getFileById(APOS_CONFIG.SPREADSHEET_ID);
        file.getName();
      } else if (mode === 'makecopy') {
        var originalFile = DriveApp.getFileById(APOS_CONFIG.SPREADSHEET_ID);
        var copyFile = originalFile.makeCopy('APOS Backend Recovery Candidate ' + new Date().toISOString());
        return APOS_json_({ success: true, status: 'COPY_CREATED', copyId: copyFile.getId() });
      } else if (mode === 'opencopy') {
        var copyId = e && e.parameter && e.parameter.copyId ? String(e.parameter.copyId) : '';
        if (!copyId) throw new Error('COPY_ID_REQUIRED');
        var copySs = SpreadsheetApp.openById(copyId);
        var copySheetCount = copySs.getSheets().length;
        PropertiesService.getScriptProperties().setProperty('APOS_SPREADSHEET_ID_RECOVERY_CANDIDATE', copyId);
        return APOS_json_({ success: true, status: 'COPY_OPEN_OK', sheetCount: copySheetCount });
      } else if (mode === 'openfile') {
        var file2 = DriveApp.getFileById(APOS_CONFIG.SPREADSHEET_ID);
        var ss2 = SpreadsheetApp.open(file2);
        if (ss2.getId() !== APOS_CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID_MISMATCH');
        ss2.getSheets().length;
      } else if (mode === 'openurl') {
        var ss3 = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/' + APOS_CONFIG.SPREADSHEET_ID + '/edit');
        if (ss3.getId() !== APOS_CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID_MISMATCH');
        ss3.getSheets().length;
      } else if (mode === 'advanced') {
        if (typeof Sheets === 'undefined') throw new Error('ADVANCED_SHEETS_UNAVAILABLE');
        var meta = Sheets.Spreadsheets.get(APOS_CONFIG.SPREADSHEET_ID, { fields: 'spreadsheetId' });
        if (!meta || meta.spreadsheetId !== APOS_CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID_MISMATCH');
      } else if (mode === 'advancedvalues') {
        if (typeof Sheets === 'undefined') throw new Error('ADVANCED_SHEETS_UNAVAILABLE');
        var sample = Sheets.Spreadsheets.Values.get(APOS_CONFIG.SPREADSHEET_ID, "'08_セッション'!A1:B3", {
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING'
        });
        if (!sample || !sample.values || !sample.values.length) throw new Error('VALUES_EMPTY');
      } else if (mode === 'advancedgrid') {
        if (typeof Sheets === 'undefined') throw new Error('ADVANCED_SHEETS_UNAVAILABLE');
        var grid = Sheets.Spreadsheets.get(APOS_CONFIG.SPREADSHEET_ID, {
          ranges: ["'08_セッション'!A1:B3"],
          includeGridData: true,
          fields: 'sheets(data(rowData(values(effectiveValue,formattedValue))))'
        });
        var rows = grid && grid.sheets && grid.sheets[0] && grid.sheets[0].data && grid.sheets[0].data[0] && grid.sheets[0].data[0].rowData;
        if (!rows || !rows.length) throw new Error('GRID_DATA_EMPTY');
      } else if (mode === 'rest') {
        var token = ScriptApp.getOAuthToken();
        var response = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + APOS_CONFIG.SPREADSHEET_ID + '?fields=spreadsheetId', {
          method: 'get',
          headers: { Authorization: 'Bearer ' + token },
          muteHttpExceptions: true
        });
        if (response.getResponseCode() !== 200) throw new Error('SHEETS_REST_HTTP_' + response.getResponseCode());
        var restMeta = JSON.parse(response.getContentText() || '{}');
        if (restMeta.spreadsheetId !== APOS_CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID_MISMATCH');
      } else if (mode === 'restvalues') {
        var token2 = ScriptApp.getOAuthToken();
        var rangeText = encodeURIComponent("'08_セッション'!A1:B3");
        var response2 = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + APOS_CONFIG.SPREADSHEET_ID + '/values/' + rangeText + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING', {
          method: 'get',
          headers: { Authorization: 'Bearer ' + token2 },
          muteHttpExceptions: true
        });
        if (response2.getResponseCode() !== 200) throw new Error('SHEETS_REST_VALUES_HTTP_' + response2.getResponseCode());
        var restValues = JSON.parse(response2.getContentText() || '{}');
        if (!restValues.values || !restValues.values.length) throw new Error('VALUES_EMPTY');
      } else {
        return APOS_json_({ success: false, status: 'PROBE_MODE_INVALID', mode: mode });
      }
      return APOS_json_({ success: true, status: 'PROBE_OK', mode: mode, elapsedMs: Date.now() - started });
    } catch (error) {
      return APOS_json_({ success: false, status: 'PROBE_ERROR', mode: mode, errorType: String(error && error.name || 'Error'), elapsedMs: Date.now() - started });
    }
  }"""
    if probe_replacement in source:
        source = source.replace(probe_replacement, probe_marker, 1)
        original_source = source
        expected_source_sha256 = sha256_text(source)
    if probe_marker not in original_source:
        raise RuntimeError("Temporary backend probe marker was not found; refusing diagnostic deployment")
    probe_source = original_source.replace(probe_marker, probe_replacement, 1)

    def deploy_source(source_text, description, enable_advanced_sheets=False):
        local_files = json.loads(json.dumps(files))
        local_target = None
        local_manifest = None
        for item in local_files:
            if item.get("name") == code_file_name and item.get("type") == "SERVER_JS":
                local_target = item
            if item.get("name") == "appsscript" and item.get("type") == "JSON":
                local_manifest = item
        if local_target is None:
            raise RuntimeError("Diagnostic deploy target SERVER_JS was not found")
        if local_manifest is None:
            raise RuntimeError("Diagnostic deploy appsscript manifest was not found")
        if enable_advanced_sheets:
            manifest_obj = json.loads(local_manifest.get("source") or "{}")
            dependencies = manifest_obj.get("dependencies") or {}
            services = dependencies.get("enabledAdvancedServices") or []
            services = [service for service in services if service.get("userSymbol") != "Sheets"]
            services.append({"userSymbol": "Sheets", "version": "v4", "serviceId": "sheets"})
            dependencies["enabledAdvancedServices"] = services
            manifest_obj["dependencies"] = dependencies
            local_manifest["source"] = json.dumps(manifest_obj, ensure_ascii=False, separators=(",", ":"))
        local_target["source"] = source_text
        http_json(
            f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/content",
            method="PUT",
            body={"files": local_files},
            token=token,
        )
        new_version = http_json(
            f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/versions",
            method="POST",
            body={"description": description},
            token=token,
        )
        new_version_number = new_version.get("versionNumber")
        if not isinstance(new_version_number, int):
            raise RuntimeError("Diagnostic version create did not return versionNumber")
        current = http_json(
            f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
            token=token,
        )
        cfg_diag = current.get("deploymentConfig") or {}
        manifest_name_diag = cfg_diag.get("manifestFileName")
        if not manifest_name_diag:
            raise RuntimeError("Diagnostic deployment manifestFileName missing")
        http_json(
            f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
            method="PUT",
            body={"deploymentConfig": {
                "scriptId": script_id,
                "versionNumber": new_version_number,
                "manifestFileName": manifest_name_diag,
                "description": description,
            }},
            token=token,
        )
        for _ in range(10):
            rb = http_json(
                f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
                token=token,
            )
            observed = (rb.get("deploymentConfig") or {}).get("versionNumber")
            try:
                if int(observed) == int(new_version_number):
                    return new_version_number
            except (TypeError, ValueError):
                pass
            time.sleep(2)
        raise RuntimeError("Diagnostic deployment version read-back did not converge")

    # Fresh diagnostic deployments are intentionally excluded from the normal
    # approved deployment path. They create extra versions/deployments and can
    # fail independently of the production update. Keep production deployment
    # deterministic: update content -> create version -> update existing deploy -> verify.
    if os.environ.get("APOS_RUN_FRESH_DEPLOY_DIAG", "").strip() == "1":
        raise RuntimeError("APOS_FRESH_DEPLOY_DIAG must be run outside the production deployment path")

    target = None
    for f in files:
        if f.get("name") == code_file_name and f.get("type") == "SERVER_JS":
            target = f
            break
    if target is None:
        raise RuntimeError(f"SERVER_JS file '{code_file_name}' was not found; refusing to overwrite project")

    target["source"] = source

    # projects.updateContent replaces the whole project, so preserve every current file.
    http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/content",
        method="PUT",
        body={"files": files},
        token=token,
    )

    readback_content = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/content",
        token=token,
    )
    readback_files = readback_content.get("files")
    if not isinstance(readback_files, list) or not readback_files:
        raise RuntimeError("CONTENT_READBACK_VERIFIED failed: Apps Script getContent returned no files")

    readback_target = None
    for f in readback_files:
        if f.get("name") == code_file_name and f.get("type") == "SERVER_JS":
            readback_target = f
            break
    if readback_target is None:
        raise RuntimeError("CONTENT_READBACK_VERIFIED failed: target SERVER_JS is missing after update")

    actual_source = readback_target.get("source")
    if not isinstance(actual_source, str):
        raise RuntimeError("SOURCE_HASH_VERIFIED failed: target SERVER_JS source is missing after update")
    actual_source_sha256 = sha256_text(actual_source)
    if actual_source_sha256 != expected_source_sha256:
        raise RuntimeError("SOURCE_HASH_VERIFIED failed: SERVER_JS SHA-256 mismatch")

    readback_file_keys = {(f.get("name"), f.get("type")) for f in readback_files}
    missing_file_keys = original_file_keys - readback_file_keys
    if missing_file_keys:
        raise RuntimeError(f"PROJECT_FILES_PRESERVED failed: {len(missing_file_keys)} pre-existing project file(s) are missing")
    if manifest_key not in readback_file_keys:
        raise RuntimeError("MANIFEST_PRESERVED failed: appsscript/JSON manifest is missing after update")

    version = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/versions",
        method="POST",
        body={"description": f"APOS automated approved deployment {os.environ.get('GITHUB_SHA','')[:12]}"},
        token=token,
    )
    version_number = version.get("versionNumber")
    if not isinstance(version_number, int):
        raise RuntimeError("Version create response did not contain versionNumber")

    version_readback = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/versions/{urllib.parse.quote(str(version_number))}",
        token=token,
    )
    if version_readback.get("scriptId") != script_id:
        raise RuntimeError("VERSION_READBACK_VERIFIED failed: scriptId mismatch")
    if version_readback.get("versionNumber") != version_number:
        raise RuntimeError("VERSION_READBACK_VERIFIED failed: versionNumber mismatch")

    current_deployment = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
        token=token,
    )
    if current_deployment.get("deploymentId") != deployment_id:
        raise RuntimeError("Existing deployment read-back returned an unexpected deploymentId; refusing to update")
    cfg = current_deployment.get("deploymentConfig") or {}
    manifest_name = cfg.get("manifestFileName")
    if not isinstance(manifest_name, str) or not manifest_name:
        raise RuntimeError("Existing deployment did not contain manifestFileName; refusing to update")

    deployment_body = {
        "deploymentConfig": {
            "scriptId": script_id,
            "versionNumber": version_number,
            "manifestFileName": manifest_name,
            "description": f"APOS approved deployment v{version_number}",
        }
    }
    http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
        method="PUT",
        body=deployment_body,
        token=token,
    )

    deployment_readback = None
    verified_cfg = {}
    observed_version = None
    observed_version_number = None
    for readback_attempt in range(10):
        deployment_readback = http_json(
            f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
            token=token,
        )
        if deployment_readback.get("deploymentId") != deployment_id:
            raise RuntimeError("DEPLOYMENT_ID_VERIFIED failed: deploymentId mismatch")
        verified_cfg = deployment_readback.get("deploymentConfig") or {}
        observed_version = verified_cfg.get("versionNumber")
        try:
            observed_version_number = int(observed_version)
        except (TypeError, ValueError):
            observed_version_number = None
        if observed_version_number == int(version_number):
            break
        if readback_attempt < 9:
            time.sleep(2)

    if verified_cfg.get("scriptId") != script_id:
        raise RuntimeError("DEPLOYMENT_ID_VERIFIED failed: deploymentConfig.scriptId mismatch")
    if observed_version_number != int(version_number):
        raise RuntimeError(
            f"DEPLOYMENT_VERSION_VERIFIED failed: expected={version_number}, observed={observed_version}"
        )
    if verified_cfg.get("manifestFileName") != manifest_name:
        raise RuntimeError("DEPLOYMENT_MANIFEST_VERIFIED failed: deploymentConfig.manifestFileName mismatch")

    print(json.dumps({
        "success": True,
        "status": "VERIFIED",
        "scriptId": script_id,
        "deploymentId": deployment_id,
        "versionNumber": version_number,
        "codeFileName": code_file_name,
        "expectedSourceSha256": expected_source_sha256,
        "actualSourceSha256": actual_source_sha256,
        "projectFilesPreserved": True,
        "manifestPreserved": True,
        "deploymentVerified": True,
        "CONTENT_READBACK_VERIFIED": True,
        "SOURCE_HASH_VERIFIED": True,
        "PROJECT_FILES_PRESERVED": True,
        "MANIFEST_PRESERVED": True,
        "VERSION_READBACK_VERIFIED": True,
        "DEPLOYMENT_ID_VERIFIED": True,
        "DEPLOYMENT_VERSION_VERIFIED": True,
        "DEPLOYMENT_MANIFEST_VERIFIED": True,
    }, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"success":False,"error":str(exc)},ensure_ascii=False), file=sys.stderr)
        raise
