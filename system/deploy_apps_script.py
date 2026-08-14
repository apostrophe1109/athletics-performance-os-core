#!/usr/bin/env python3
import json, os, sys, urllib.request, urllib.parse, urllib.error

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCRIPT_API = "https://script.googleapis.com/v1"

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
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code} {url}: {detail[:2000]}") from exc

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
        detail = exc.read().decode("utf-8","replace")
        raise RuntimeError(f"OAuth token exchange failed: HTTP {exc.code}: {detail[:1000]}") from exc
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
    token = oauth_access_token()

    content = http_json(f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/content", token=token)
    files = content.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("Apps Script getContent returned no files")

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

    version = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/versions",
        method="POST",
        body={"description": f"APOS automated approved deployment {os.environ.get('GITHUB_SHA','')[:12]}"},
        token=token,
    )
    version_number = version.get("versionNumber")
    if not isinstance(version_number, int):
        raise RuntimeError("Version create response did not contain versionNumber")

    current_deployment = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
        token=token,
    )
    cfg = current_deployment.get("deploymentConfig") or {}
    manifest_name = cfg.get("manifestFileName") or "appsscript"

    deployment_body = {
        "deploymentConfig": {
            "scriptId": script_id,
            "versionNumber": version_number,
            "manifestFileName": manifest_name,
            "description": f"APOS approved deployment v{version_number}",
        }
    }
    updated = http_json(
        f"{SCRIPT_API}/projects/{urllib.parse.quote(script_id)}/deployments/{urllib.parse.quote(deployment_id)}",
        method="PUT",
        body=deployment_body,
        token=token,
    )
    print(json.dumps({
        "success": True,
        "scriptId": script_id,
        "deploymentId": deployment_id,
        "versionNumber": version_number,
        "updatedDeploymentId": updated.get("deploymentId"),
    }, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"success":False,"error":str(exc)},ensure_ascii=False), file=sys.stderr)
        raise
