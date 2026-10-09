"""Persistent source facts and separate user review policies; reads never create a DB."""

import os
import sqlite3
import stat
import threading
import weakref
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("txt", "json", "image", "log")
CONFIRMED_STATES = frozenset(("present", "unavailable", "not_found", "unsupported", "unresolved"))
SKIP_STATES = frozenset(("unavailable", "not_found", "unsupported", "unresolved"))
_locks_guard = threading.Lock()
_locks = weakref.WeakValueDictionary()


def file_identity(path):
    """A stat-only signature. A changed file must never inherit the old hash."""
    real_path = os.path.normcase(os.path.realpath(os.path.abspath(path)))
    file_stat = os.stat(real_path)
    if not stat.S_ISREG(file_stat.st_mode):
        raise OSError("LoRA 路径不是文件")
    return {"path": real_path, "size": file_stat.st_size, "mtime_ns": file_stat.st_mtime_ns}


def identity_matches(before, after):
    return bool(before and after and all(before.get(k) == after.get(k) for k in ("path", "size", "mtime_ns")))


def model_lock(path):
    """Serialize requests for one actual file without holding a database transaction."""
    key = os.path.normcase(os.path.realpath(os.path.abspath(path)))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _locks[key] = lock
        return lock


def field_state(state="missing", checked_at=None, reason="", **extra):
    return {"state": state, "needs_fetch": state in ("missing", "error"),
            "checked_at": checked_at, "reason": reason, **extra}


class LoraMetadataState:
    def __init__(self, user_dir):
        self.path = os.path.join(user_dir, "lora_metadata_state.sqlite3")

    def _read_connection(self):
        try:
            file_stat = os.stat(self.path)
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(file_stat.st_mode):
            raise OSError("检查记录路径不是数据库文件")
        return sqlite3.connect(Path(self.path).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)

    def read_inventory(self, identities):
        """One read-only snapshot, including only facts for unchanged local files."""
        if not identities:
            return {}
        connection = self._read_connection()
        if connection is None:
            return {}
        try:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            cache = {}
            reviews = {}
            paths = list(dict.fromkeys(identity["path"] for identity in identities))
            for offset in range(0, len(paths), 400):
                batch = paths[offset:offset + 400]
                placeholders = ",".join("?" for _ in batch)
                if "files" in tables:
                    cache.update({row[0]: row[1:] for row in connection.execute(
                        f"SELECT path, size, mtime_ns, sha256 FROM files WHERE path IN ({placeholders})", batch)})
                if "local_reviews" in tables:
                    for row in connection.execute(
                            f"SELECT path, kind, size, mtime_ns, reviewed_at FROM local_reviews WHERE path IN ({placeholders})", batch):
                        reviews.setdefault(row[0], {})[row[1]] = {
                            "size": row[2], "mtime_ns": row[3], "reviewed_at": row[4],
                        }
            by_hash = {}
            hashes = list(dict.fromkeys(row[2] for row in cache.values()))
            for offset in range(0, len(hashes) if "source_fields" in tables else 0, 400):
                batch = hashes[offset:offset + 400]
                placeholders = ",".join("?" for _ in batch)
                for row in connection.execute(
                        "SELECT sha256, kind, state, checked_at, reason, model_id, version_id, last_error, error_at "
                        f"FROM source_fields WHERE sha256 IN ({placeholders})", batch):
                    by_hash.setdefault(row[0], {})[row[1]] = {
                        "state": row[2], "checked_at": row[3], "reason": row[4],
                        "model_id": row[5], "version_id": row[6], "last_error": row[7], "error_at": row[8],
                    }
            result = {}
            for identity in identities:
                cached = cache.get(identity["path"])
                local_reviews = {kind: {"reviewed_at": review["reviewed_at"]}
                                 for kind, review in reviews.get(identity["path"], {}).items()
                                 if review["size"] == identity["size"] and review["mtime_ns"] == identity["mtime_ns"]}
                if cached and cached[:2] == (identity["size"], identity["mtime_ns"]):
                    result[identity["path"]] = {"sha256": cached[2], "fields": by_hash.get(cached[2], {}),
                                                "local_reviews": local_reviews}
                elif local_reviews:
                    result[identity["path"]] = {"sha256": None, "fields": {}, "local_reviews": local_reviews}
            return result
        finally:
            connection.close()

    def read_hash(self, sha256):
        connection = self._read_connection()
        if connection is None:
            return {}
        try:
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_fields'").fetchone() is None:
                return {}
            return {row[0]: {"state": row[1], "checked_at": row[2], "reason": row[3],
                             "model_id": row[4], "version_id": row[5], "last_error": row[6], "error_at": row[7]}
                    for row in connection.execute(
                        "SELECT kind, state, checked_at, reason, model_id, version_id, last_error, error_at "
                        "FROM source_fields WHERE sha256 = ?", (sha256,))}
        finally:
            connection.close()

    def review_local(self, identities, types, reviewed=True):
        """A user's offline policy, without reading weights or inventing source facts."""
        if not identities or not types:
            return None
        if any(kind not in KINDS for kind in types) or not isinstance(reviewed, bool):
            raise ValueError("人工整理选项无效")
        if not reviewed:
            try:
                os.stat(self.path)
            except FileNotFoundError:
                return None
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            with connection:
                if reviewed:
                    connection.execute("CREATE TABLE IF NOT EXISTS local_reviews (path TEXT NOT NULL, kind TEXT NOT NULL, "
                                       "size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, reviewed_at TEXT NOT NULL, "
                                       "PRIMARY KEY (path, kind))")
                elif connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_reviews'").fetchone() is None:
                    return None
                now = datetime.now(timezone.utc).isoformat(timespec="seconds")
                for identity in identities:
                    for kind in types:
                        if reviewed:
                            connection.execute(
                                "INSERT INTO local_reviews(path, kind, size, mtime_ns, reviewed_at) VALUES (?, ?, ?, ?, ?) "
                                "ON CONFLICT(path, kind) DO UPDATE SET size=excluded.size, mtime_ns=excluded.mtime_ns, "
                                "reviewed_at=excluded.reviewed_at",
                                (identity["path"], kind, identity["size"], identity["mtime_ns"], now))
                        else:
                            connection.execute("DELETE FROM local_reviews WHERE path=? AND kind=?", (identity["path"], kind))
                return now
        finally:
            connection.close()

    def record(self, identity, sha256, outcomes, model_id=None, version_id=None):
        """Merge only checked fields. A failed recheck preserves the last confirmation."""
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            with connection:
                connection.execute("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, "
                                   "mtime_ns INTEGER NOT NULL, sha256 TEXT NOT NULL)")
                connection.execute("CREATE TABLE IF NOT EXISTS source_fields (sha256 TEXT NOT NULL, kind TEXT NOT NULL, "
                                   "state TEXT NOT NULL, checked_at TEXT, reason TEXT NOT NULL DEFAULT '', "
                                   "model_id TEXT, version_id TEXT, last_error TEXT, error_at TEXT, PRIMARY KEY (sha256, kind))")
                connection.execute("INSERT INTO files(path, size, mtime_ns, sha256) VALUES (?, ?, ?, ?) "
                                   "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime_ns=excluded.mtime_ns, sha256=excluded.sha256",
                                   (identity["path"], identity["size"], identity["mtime_ns"], sha256))
                now = datetime.now(timezone.utc).isoformat(timespec="seconds")
                has_local_reviews = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_reviews'").fetchone() is not None
                for kind, outcome in outcomes.items():
                    if kind not in KINDS:
                        continue
                    state, reason = outcome["state"], outcome.get("reason", "")
                    previous = connection.execute("SELECT state FROM source_fields WHERE sha256=? AND kind=?", (sha256, kind)).fetchone()
                    if state == "error" and previous and previous[0] in CONFIRMED_STATES:
                        connection.execute("UPDATE source_fields SET last_error=?, error_at=? WHERE sha256=? AND kind=?",
                                           (reason, now, sha256, kind))
                        continue
                    if state not in CONFIRMED_STATES and state != "error":
                        continue
                    connection.execute(
                        "INSERT INTO source_fields(sha256, kind, state, checked_at, reason, model_id, version_id, last_error, error_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sha256, kind) DO UPDATE SET "
                        "state=excluded.state, checked_at=excluded.checked_at, reason=excluded.reason, model_id=excluded.model_id, "
                        "version_id=excluded.version_id, last_error=excluded.last_error, error_at=excluded.error_at",
                        (sha256, kind, state, now if state != "error" else None, reason,
                         str(model_id) if model_id is not None else None, str(version_id) if version_id is not None else None,
                         reason if state == "error" else None, now if state == "error" else None))
                    if has_local_reviews and state in CONFIRMED_STATES:
                        connection.execute("DELETE FROM local_reviews WHERE path=? AND kind=? AND size=? AND mtime_ns=?",
                                           (identity["path"], kind, identity["size"], identity["mtime_ns"]))
        finally:
            connection.close()
