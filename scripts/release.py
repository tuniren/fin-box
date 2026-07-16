#!/usr/bin/env python3
"""Build and publish a FinBox GitHub release.

The script intentionally reads the GitHub token only from GITHUB_TOKEN or
GH_TOKEN. Do not put tokens in this file or pass them as command arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RELEASE_DIR = ROOT / "release"
PACKAGE_JSON = ROOT / "package.json"
DEFAULT_OWNER = "tuniren"
DEFAULT_REPO = "fin-box"
HTTP_TIMEOUT_SECONDS = 600
RETRYABLE_STATUS_CODES = {502, 503, 504}


class ReleaseError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[release] {message}", flush=True)


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    log("$ " + " ".join(command))
    return subprocess.run(
        command,
        cwd=ROOT,
        check=check,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def output(command: list[str], *, check: bool = True) -> str:
    completed = subprocess.run(
        command,
        cwd=ROOT,
        check=check,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


def read_package() -> dict[str, Any]:
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))


def ensure_clean_worktree(allow_dirty: bool) -> None:
    status = output(["git", "status", "--porcelain"])
    if status and not allow_dirty:
        raise ReleaseError(
            "Working tree is not clean. Commit/stash changes or rerun with --allow-dirty."
        )


def sync_git(enabled: bool) -> None:
    if not enabled:
        return
    run(["git", "pull", "--rebase"])
    run(["git", "push"])


def clean_release_dir() -> None:
    if RELEASE_DIR.exists():
        log(f"Removing old local artifacts from {RELEASE_DIR.relative_to(ROOT)}")
        shutil.rmtree(RELEASE_DIR)
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)


def build_artifacts(build_command: str) -> None:
    log("$ " + build_command)
    subprocess.run(
        build_command,
        cwd=ROOT,
        check=True,
        shell=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def parse_latest_yml_version(latest_yml: Path) -> str | None:
    match = re.search(r"(?m)^version:\s*['\"]?([^'\"\s]+)", latest_yml.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def local_artifacts(version: str) -> list[Path]:
    latest_yml = RELEASE_DIR / "latest.yml"
    if not latest_yml.exists():
        raise ReleaseError("release/latest.yml was not generated. Refusing to publish.")

    latest_version = parse_latest_yml_version(latest_yml)
    if latest_version != version:
        raise ReleaseError(
            f"release/latest.yml version is {latest_version!r}, expected {version!r}."
        )

    artifacts = [
        path
        for path in RELEASE_DIR.iterdir()
        if path.is_file() and (version in path.name or path.name == "latest.yml")
    ]
    artifacts.sort(key=lambda path: (path.name != "latest.yml", path.name.lower()))

    required_patterns = [
        rf"^FinBox-Setup-{re.escape(version)}-win-.+\.exe$",
        rf"^FinBox-Setup-{re.escape(version)}-win-.+\.exe\.blockmap$",
        rf"^FinBox-Portable-{re.escape(version)}-win-.+\.exe$",
        r"^latest\.yml$",
    ]
    names = {path.name for path in artifacts}
    missing = [
        pattern
        for pattern in required_patterns
        if not any(re.match(pattern, name) for name in names)
    ]
    if missing:
        raise ReleaseError("Missing expected Windows artifacts: " + ", ".join(missing))

    for artifact in artifacts:
        if artifact.stat().st_size <= 0:
            raise ReleaseError(f"Artifact is empty: {artifact.relative_to(ROOT)}")

    log("Local artifacts ready:")
    for artifact in artifacts:
        log(f"  - {artifact.name} ({artifact.stat().st_size} bytes)")
    return artifacts


class GitHub:
    def __init__(self, owner: str, repo: str, token: str, dry_run: bool) -> None:
        self.owner = owner
        self.repo = repo
        self.token = token
        self.dry_run = dry_run
        self.api = f"https://api.github.com/repos/{owner}/{repo}"

    def request(
        self,
        method: str,
        url: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        ok: tuple[int, ...] = (200, 201, 202, 204),
        attempts: int = 3,
    ) -> Any:
        merged_headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "fin-box-release-script",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if headers:
            merged_headers.update(headers)

        for attempt in range(1, attempts + 1):
            request = urllib.request.Request(url, data=data, method=method, headers=merged_headers)
            try:
                with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                    body = response.read()
                    if response.status not in ok:
                        raise ReleaseError(f"GitHub API returned HTTP {response.status}: {body!r}")
                    if not body:
                        return None
                    return json.loads(body.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code == 404 and 404 in ok:
                    return None
                if exc.code in RETRYABLE_STATUS_CODES and attempt < attempts:
                    wait_for_retry(attempt)
                    continue
                raise ReleaseError(f"GitHub API {method} {url} failed with HTTP {exc.code}: {body}")
            except urllib.error.URLError as exc:
                if attempt < attempts:
                    wait_for_retry(attempt)
                    continue
                raise ReleaseError(f"GitHub API {method} {url} failed: {exc}")

        raise ReleaseError(f"GitHub API {method} {url} failed after {attempts} attempts.")

    def get_release(self, tag: str) -> dict[str, Any] | None:
        encoded = urllib.parse.quote(tag, safe="")
        return self.request("GET", f"{self.api}/releases/tags/{encoded}", ok=(200, 404))

    def create_release(self, tag: str, name: str, body: str) -> dict[str, Any]:
        if self.dry_run:
            log(f"DRY RUN create release {tag}")
            return {"id": 0, "tag_name": tag, "assets": [], "upload_url": f"{self.api}/releases/0/assets{{?name,label}}"}
        payload = {
            "tag_name": tag,
            "name": name,
            "body": body,
            "draft": False,
            "prerelease": False,
            "make_latest": "true",
        }
        return self.request(
            "POST",
            f"{self.api}/releases",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

    def delete_release(self, release_id: int) -> None:
        if self.dry_run:
            log(f"DRY RUN delete release id={release_id}")
            return
        self.request("DELETE", f"{self.api}/releases/{release_id}", ok=(204,))

    def delete_tag_ref(self, tag: str) -> None:
        encoded = urllib.parse.quote(f"tags/{tag}", safe="")
        if self.dry_run:
            log(f"DRY RUN delete git ref {tag}")
            return
        self.request("DELETE", f"{self.api}/git/refs/{encoded}", ok=(204, 404))

    def delete_asset(self, asset_id: int, name: str) -> None:
        if self.dry_run:
            log(f"DRY RUN delete asset {name}")
            return
        self.request("DELETE", f"{self.api}/releases/assets/{asset_id}", ok=(204,))

    def upload_asset(self, release: dict[str, Any], artifact: Path) -> None:
        upload_url = release["upload_url"].split("{", 1)[0]
        url = upload_url + "?" + urllib.parse.urlencode({"name": artifact.name})
        if self.dry_run:
            log(f"DRY RUN upload {artifact.name}")
            return
        self.request(
            "POST",
            url,
            data=artifact.read_bytes(),
            headers={
                "Content-Type": content_type(artifact),
                "Content-Length": str(artifact.stat().st_size),
            },
        )


def content_type(path: Path) -> str:
    if path.suffix == ".yml":
        return "application/x-yaml"
    if path.suffix == ".exe":
        return "application/vnd.microsoft.portable-executable"
    if path.suffix == ".blockmap":
        return "application/octet-stream"
    return "application/octet-stream"


def wait_for_retry(attempt: int) -> None:
    seconds = min(2**attempt, 10)
    log(f"Temporary GitHub API failure, retrying in {seconds}s")
    time.sleep(seconds)


def local_tag_exists(tag: str) -> bool:
    return bool(output(["git", "tag", "--list", tag]))


def remote_tag_exists(tag: str) -> bool:
    return bool(output(["git", "ls-remote", "--tags", "origin", tag]))


def ensure_git_tag(tag: str, recreate: bool, dry_run: bool) -> None:
    if recreate:
        if dry_run:
            log(f"DRY RUN recreate git tag {tag}")
            return
        if local_tag_exists(tag):
            run(["git", "tag", "-d", tag])
        run(["git", "tag", tag])
        run(["git", "push", "--force", "origin", tag])
        return

    if not local_tag_exists(tag):
        if dry_run:
            log(f"DRY RUN create local git tag {tag}")
        else:
            run(["git", "tag", tag])
    if not remote_tag_exists(tag):
        if dry_run:
            log(f"DRY RUN push git tag {tag}")
        else:
            run(["git", "push", "origin", tag])


def publish(args: argparse.Namespace) -> None:
    package = read_package()
    version = args.version or package["version"]
    tag = args.tag or f"v{version}"

    if package["version"] != version:
        raise ReleaseError(
            f"package.json version is {package['version']!r}, expected {version!r}."
        )

    ensure_clean_worktree(args.allow_dirty)
    sync_git(args.sync)

    if not args.skip_build:
        clean_release_dir()
        build_artifacts(args.build_command)

    artifacts = local_artifacts(version)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token and not args.dry_run:
        raise ReleaseError("Set GITHUB_TOKEN or GH_TOKEN before publishing.")

    if args.dry_run:
        ensure_git_tag(tag, args.recreate, args.dry_run)
        log(f"DRY RUN would publish {len(artifacts)} artifacts to {args.owner}/{args.repo} {tag}")
        for artifact in artifacts:
            log(f"DRY RUN asset {artifact.name} ({artifact.stat().st_size} bytes)")
        return

    github = GitHub(args.owner, args.repo, token, args.dry_run)

    if args.recreate:
        existing = github.get_release(tag)
        if existing:
            log(f"Deleting existing GitHub release {tag}")
            github.delete_release(existing["id"])
        log(f"Deleting remote tag ref {tag}")
        github.delete_tag_ref(tag)

    ensure_git_tag(tag, args.recreate, args.dry_run)

    release = github.get_release(tag)
    if not release:
        log(f"Creating GitHub release {tag}")
        release = github.create_release(tag, f"FinBox {version}", f"FinBox {version}")
    else:
        log(f"Using existing GitHub release {tag}")

    wanted = {artifact.name: artifact for artifact in artifacts}
    remote_assets = {asset["name"]: asset for asset in release.get("assets", [])}

    for name, asset in remote_assets.items():
        if name in wanted:
            log(f"Replacing remote asset {name}")
            github.delete_asset(asset["id"], name)
            time.sleep(0.5)

    for artifact in artifacts:
        log(f"Uploading {artifact.name}")
        github.upload_asset(release, artifact)

    verify_remote_assets(github, tag, artifacts)
    log(f"Release {tag} is complete.")


def verify_remote_assets(github: GitHub, tag: str, artifacts: list[Path]) -> None:
    release = github.get_release(tag)
    if not release:
        raise ReleaseError(f"GitHub release {tag} disappeared after upload.")

    remote_assets = {asset["name"]: asset for asset in release.get("assets", [])}
    missing: list[str] = []
    wrong_size: list[str] = []
    for artifact in artifacts:
        asset = remote_assets.get(artifact.name)
        if not asset:
            missing.append(artifact.name)
            continue
        if int(asset.get("size", -1)) != artifact.stat().st_size:
            wrong_size.append(
                f"{artifact.name}: local {artifact.stat().st_size}, remote {asset.get('size')}"
            )

    if missing or wrong_size:
        details = []
        if missing:
            details.append("missing assets: " + ", ".join(missing))
        if wrong_size:
            details.append("wrong size: " + ", ".join(wrong_size))
        raise ReleaseError("Remote release verification failed; " + "; ".join(details))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build and publish a FinBox release.")
    parser.add_argument("--version", help="Release version. Defaults to package.json version.")
    parser.add_argument("--tag", help="Release tag. Defaults to v<version>.")
    parser.add_argument("--owner", default=DEFAULT_OWNER, help="GitHub owner.")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repository.")
    parser.add_argument("--build-command", default="npm run dist:win", help="Build command.")
    parser.add_argument("--skip-build", action="store_true", help="Publish existing release artifacts.")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow uncommitted local changes.")
    parser.add_argument("--sync", action="store_true", help="Run git pull --rebase and git push first.")
    parser.add_argument("--recreate", action="store_true", help="Delete the existing release and tag before publishing.")
    parser.add_argument("--dry-run", action="store_true", help="Check locally and print GitHub actions without changing GitHub.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        publish(args)
        return 0
    except (ReleaseError, subprocess.CalledProcessError) as exc:
        print(f"[release] ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
