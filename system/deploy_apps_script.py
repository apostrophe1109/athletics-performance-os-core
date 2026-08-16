#!/usr/bin/env python3
import hashlib
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCRIPT_API = "https://script.googleapis.com/v1"

def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

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
