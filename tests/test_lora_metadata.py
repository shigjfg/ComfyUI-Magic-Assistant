"""Offline regression tests for LoRA metadata downloads; fixtures stay in output/test."""
import ast
import asyncio
import functools
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse
import urllib.request
import uuid

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
FUNCTIONS = {
    "_run_blocking", "clean_html", "calculate_sha256", "fetch_civitai_data_by_hash",
    "_atomic_write_lora_text", "download_file", "extract_lora_weight_from_civitai_data",
    "_fetch_lora_metadata", "fetch_metadata",
    "_get_lora_metadata_paths", "_get_lora_metadata_inventory", "get_lora_list", "get_lora_images",
}


def load_download_functions():
    """Execute the real functions without importing torch or starting a ComfyUI server."""
    source_path = PROJECT / "nodes" / "magic_power_lora.py"
    source = ast.parse(source_path.read_text(encoding="utf-8"))
    selected = []
    for node in source.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
            node.decorator_list = []
            selected.append(node)
        elif isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "_LORA_PREVIEW_SUFFIXES" for target in node.targets):
            selected.append(node)
    assert {node.name for node in selected if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))} == FUNCTIONS
    namespace = {
        "asyncio": asyncio, "functools": functools, "hashlib": hashlib, "json": json,
        "os": os, "re": re, "shutil": shutil, "tempfile": tempfile, "time": time,
        "urllib": urllib, "Image": Image, "CV2_AVAILABLE": False,
        "web": SimpleNamespace(json_response=lambda data, status=200: SimpleNamespace(data=data, status=status)),
    }
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), "exec"), namespace)
    return namespace


class Response(io.BytesIO):
    status = 200

    def __init__(self, payload, content_type="application/json"):
        super().__init__(payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8"))
        self.content_type = content_type

    def getheader(self, name, default=None):
        return self.content_type if name.lower() == "content-type" else default


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.directory = PROJECT / "output" / "test" / "lora_metadata" / uuid.uuid4().hex
        self.directory.mkdir(parents=True)
        self.lora_name = "子目录/test.safetensors"
        self.lora_path = self.directory / self.lora_name
        self.lora_path.parent.mkdir()
        self.lora_path.write_bytes(b"test LoRA bytes")
        self.ns = load_download_functions()
        self.ns["folder_paths"] = SimpleNamespace(
            get_full_path=lambda category, name: str(self.directory / name.replace("\\", "/")) if category == "loras" else None,
            get_filename_list=lambda category: [self.lora_name] if category == "loras" else [],
        )
        self.data = {
            "id": 20, "modelId": 10, "baseModel": "SDXL 1.0",
            "trainedWords": ["word one", "触发词"], "description": "<p>Version</p>",
            "model": {"name": "Test LoRA", "description": "<p>Model</p>"},
            "images": [{"url": "https://example.invalid/preview.jpg", "type": "image", "meta": {
                "resources": [{"name": "test", "weight": 0.7}],
            }}],
        }

    def options(self, *enabled):
        return {"download_" + kind: kind in enabled for kind in ("txt", "json", "image", "log")}

    def sidecar(self, suffix, content="user content", subfolder=False):
        directory = self.lora_path.parent / "magicloradate" if subfolder else self.lora_path.parent
        directory.mkdir(exist_ok=True)
        path = directory / ("test" + suffix)
        path.write_text(content, encoding="utf-8")
        return path

    def download(self, options=None, overwrite=False, mode="same_dir"):
        with patch.dict(self.ns, {"fetch_civitai_data_by_hash": Mock(return_value=self.data)}):
            return self.ns["_fetch_lora_metadata"](self.lora_name, options or self.options("txt", "json", "log"), mode, overwrite)

    def test_complete_metadata_skips_hash_and_network_across_both_directories(self):
        paths = [self.sidecar(".txt"), self.sidecar(".json", subfolder=True),
                 self.sidecar(".log"), self.sidecar(".cover.png", subfolder=True)]
        with patch.dict(self.ns, {
            "calculate_sha256": Mock(side_effect=AssertionError("must not hash")),
            "fetch_civitai_data_by_hash": Mock(side_effect=AssertionError("must not request")),
        }):
            result = self.ns["_fetch_lora_metadata"](self.lora_name, {}, "same_dir", False)
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["unchanged"], ["txt", "json", "image", "log"])
        self.assertEqual(result["data"], {})
        self.assertTrue(all(path.read_text(encoding="utf-8") == "user content" for path in paths))

    def test_only_missing_types_are_written_and_legacy_formats_remain_readable(self):
        original = self.sidecar(".txt", "my custom words", subfolder=True)
        result = self.download(mode="subfolder")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["unchanged"], ["txt"])
        self.assertEqual(result["saved"], ["json", "log"])
        self.assertEqual(set(result["data"]), {"jsonInfo", "logInfo"})
        self.assertEqual(original.read_text(encoding="utf-8"), "my custom words")
        info = (original.parent / "test.json").read_text(encoding="utf-8")
        self.assertIn("基础模型: SDXL 1.0", info)
        self.assertIn("https://civitai.com/models/10?modelVersionId=20", info)
        self.assertEqual(json.loads((original.parent / "test.log").read_text())["preferred weight"], 0.7)

    def test_legacy_omitted_overwrite_replaces_selected_target_only(self):
        same = self.sidecar(".txt", "old same")
        magic = self.sidecar(".txt", "old magic", subfolder=True)
        with patch.dict(self.ns, {"fetch_civitai_data_by_hash": Mock(return_value=self.data)}):
            result = self.ns["_fetch_lora_metadata"](self.lora_name, self.options("txt"), "same_dir")
        self.assertEqual(result["status"], "success")
        self.assertEqual(same.read_text(encoding="utf-8"), "word one, 触发词")
        self.assertEqual(magic.read_text(encoding="utf-8"), "old magic")

    def test_update_existing_refreshes_readers_preferred_files_and_saves_new_types_in_selected_dir(self):
        same_words = self.sidecar(".txt", "old same words")
        magic_words = self.sidecar(".txt", "old magic words", subfolder=True)
        same_weight = self.sidecar(".log", "old same weight")
        with patch.dict(self.ns, {"fetch_civitai_data_by_hash": Mock(return_value=self.data)}):
            result = self.ns["_fetch_lora_metadata"](
                self.lora_name, self.options("txt", "json", "log"), "subfolder", True, True,
            )
        self.assertEqual(result["status"], "success")
        self.assertEqual(magic_words.read_text(encoding="utf-8"), "word one, 触发词")
        self.assertEqual(same_words.read_text(encoding="utf-8"), "old same words")
        self.assertEqual(json.loads(same_weight.read_text())["preferred weight"], 0.7)
        self.assertTrue((magic_words.parent / "test.json").is_file())
        self.assertFalse((magic_words.parent / "test.log").exists())

    def test_update_existing_preview_uses_preferred_subfolder_suffix(self):
        self.sidecar(".jpg", "same preview")
        preferred = self.sidecar(".cover.png", "magic preview", subfolder=True)
        downloader = Mock(return_value=True)
        with patch.dict(self.ns, {"fetch_civitai_data_by_hash": Mock(return_value=self.data), "download_file": downloader}):
            result = self.ns["_fetch_lora_metadata"](self.lora_name, self.options("image"), "same_dir", True, True)
        self.assertEqual(result["saved"], ["image"])
        self.assertEqual(downloader.call_args.args[1], str(preferred))

    def test_image_index_includes_preview_and_cover_suffixes_with_subfolder_priority(self):
        self.sidecar(".preview.jpg", "same preview")
        result = asyncio.run(self.ns["get_lora_images"](None))
        self.assertEqual(result.data, {self.lora_name: "子目录/test.preview.jpg"})
        self.sidecar(".cover.png", "magic preview", subfolder=True)
        result = asyncio.run(self.ns["get_lora_images"](None))
        self.assertEqual(result.data, {self.lora_name: "子目录/test.cover.png"})

    def test_no_selected_types_skips_network(self):
        with patch.dict(self.ns, {"calculate_sha256": Mock(side_effect=AssertionError("must not hash"))}):
            result = self.ns["_fetch_lora_metadata"](self.lora_name, self.options(), "same_dir", False)
        self.assertEqual(result["status"], "skipped")

    def test_unavailable_metadata_is_reported_without_empty_files(self):
        self.data.update(trainedWords=[], images=[])
        result = self.download(self.options("txt", "image", "log"))
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["unavailable"], ["txt", "image", "log"])
        self.assertEqual(result["failed"], [])
        self.assertEqual(result["data"], {})
        self.assertFalse((self.lora_path.parent / "test.txt").exists())

    def test_absent_optional_information_does_not_count_as_download_failure(self):
        self.data.update(trainedWords=[], images=[])
        result = self.download(self.options("txt", "json", "image", "log"))
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["saved"], ["json"])
        self.assertEqual(result["unavailable"], ["txt", "image", "log"])
        self.assertEqual(result["failed"], [])

    def test_sidecar_created_during_remote_lookup_is_not_overwritten(self):
        def remote(*args, **kwargs):
            self.sidecar(".txt", "written while waiting", subfolder=True)
            return self.data

        with patch.dict(self.ns, {"fetch_civitai_data_by_hash": remote}):
            result = self.ns["_fetch_lora_metadata"](self.lora_name, self.options("txt"), "same_dir", False)
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["unchanged"], ["txt"])
        self.assertFalse((self.lora_path.parent / "test.txt").exists())

    def test_atomic_replace_failure_preserves_existing_and_other_types_continue(self):
        old = self.sidecar(".txt", "keep my words")
        original_replace = os.replace

        def replace(source, destination):
            if str(destination).endswith(".txt"):
                raise PermissionError("test destination locked")
            return original_replace(source, destination)

        with patch.object(os, "replace", side_effect=replace):
            result = self.download(self.options("txt", "json"), overwrite=True)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["failed"], ["txt"])
        self.assertEqual(result["saved"], ["json"])
        self.assertNotIn("triggerWords", result["data"])
        self.assertEqual(old.read_text(encoding="utf-8"), "keep my words")
        self.assertEqual(list(old.parent.glob(".magic-lora-*")), [])

    def test_not_found_and_network_failure_have_different_statuses(self):
        for value, expected in ((None, "not_found"), (RuntimeError("HTTP 429"), "error")):
            with self.subTest(status=expected), patch.dict(self.ns, {"fetch_civitai_data_by_hash":
                    Mock(side_effect=value) if isinstance(value, Exception) else Mock(return_value=value)}):
                result = self.ns["_fetch_lora_metadata"](self.lora_name, self.options("txt"), "same_dir", False)
            self.assertEqual(result["status"], expected)
            self.assertIsInstance(result["message"], str)
            self.assertEqual(result["data"], {})

    def test_preview_without_opencv_uses_image_after_video(self):
        self.data["images"].insert(0, {"url": "https://example.invalid/video.mp4?x=1", "type": "video"})
        downloader = Mock(return_value=True)
        with patch.dict(self.ns, {"download_file": downloader}):
            result = self.download(self.options("image"))
        self.assertEqual(result["status"], "success")
        self.assertEqual(downloader.call_args.args[0], "https://example.invalid/preview.jpg")

    def test_preview_download_is_atomic_and_uses_existing_target_filename(self):
        image_bytes = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(image_bytes, format="JPEG")
        original = self.sidecar(".preview.png", "old preview")
        with patch.object(urllib.request, "urlopen", return_value=Response(image_bytes.getvalue(), "image/jpeg")):
            result = self.download(self.options("image"), overwrite=True)
        self.assertEqual(result["saved"], ["image"])
        with Image.open(original) as preview:
            self.assertEqual(preview.format, "PNG")
        self.assertFalse((original.parent / "test.jpg").exists())

    def test_invalid_preview_and_video_preserve_old_image(self):
        original = self.sidecar(".jpg", "old preview")
        for payload, content_type in ((b"<html>error</html>", "text/html"), (b"video", "video/mp4")):
            with self.subTest(content_type=content_type), patch.object(urllib.request, "urlopen", return_value=Response(payload, content_type)):
                self.assertFalse(self.ns["download_file"]("https://example.invalid/media", str(original)))
            self.assertEqual(original.read_text(encoding="utf-8"), "old preview")
            self.assertEqual(list(original.parent.glob(".magic-lora-*")), [])

    def test_hash_lookup_http_failures_retries_and_legacy_none_contract(self):
        for code, calls in ((401, 1), (403, 1), (429, 3), (503, 3)):
            error = urllib.error.HTTPError("https://example.invalid", code, "test", {}, None)
            with self.subTest(code=code), patch.object(urllib.request, "urlopen", side_effect=error) as fetch, patch.object(time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, str(code)):
                    self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True)
                self.assertEqual(fetch.call_count, calls)
                self.assertIsNone(self.ns["fetch_civitai_data_by_hash"]("abcd"))
        for code in (404,):
            error = urllib.error.HTTPError("https://example.invalid", code, "test", {}, None)
            with patch.object(urllib.request, "urlopen", side_effect=error) as fetch, patch.object(time, "sleep"):
                self.assertIsNone(self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True))
                self.assertEqual(fetch.call_count, 1)
        with patch.object(urllib.request, "urlopen", side_effect=TimeoutError("timed out")), patch.object(time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True)

    def test_hash_lookup_recovers_from_rate_limit_and_detail_404_is_not_missing_version(self):
        limited = urllib.error.HTTPError("https://example.invalid", 429, "test", {}, None)
        responses = [limited, Response({"modelId": 10, "id": 20}), Response({"name": "model"})]
        with patch.object(urllib.request, "urlopen", side_effect=responses) as fetch, patch.object(time, "sleep"):
            result = self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True)
        self.assertEqual(result["model"]["name"], "model")
        self.assertIn("ABCD", fetch.call_args_list[0].args[0].full_url)
        missing_detail = urllib.error.HTTPError("https://example.invalid", 404, "test", {}, None)
        with patch.object(urllib.request, "urlopen", side_effect=[Response({"modelId": 10}), missing_detail]), patch.object(time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "模型介绍.*404"):
                self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True)

    def test_invalid_model_description_response_is_a_retryable_error(self):
        # Each attempt needs fresh response objects because context managers close them.
        responses = [response for _ in range(3) for response in (Response({"modelId": 10}), Response(b"bad json"))]
        with patch.object(urllib.request, "urlopen", side_effect=responses), patch.object(time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "模型介绍"):
                self.ns["fetch_civitai_data_by_hash"]("abcd", strict=True)

    def test_inventory_checks_same_and_subfolder_information_without_hash_or_network(self):
        self.sidecar(".txt")
        self.sidecar(".json", subfolder=True)
        self.sidecar(".preview.jpg", subfolder=True)
        with patch.dict(self.ns, {
            "calculate_sha256": Mock(side_effect=AssertionError("inventory must not hash")),
            "fetch_civitai_data_by_hash": Mock(side_effect=AssertionError("inventory must not request")),
        }), patch.object(urllib.request, "urlopen", side_effect=AssertionError("inventory must stay offline")):
            result = self.ns["_get_lora_metadata_inventory"]()
        self.assertEqual(result["files"], [self.lora_name])
        self.assertEqual(result["metadata"][self.lora_name], {"txt": True, "json": True, "image": True, "log": False})
        self.assertEqual(result["errors"], [])

    def test_inventory_keeps_missing_and_inaccessible_names_with_visible_errors(self):
        names = [self.lora_name, "missing.safetensors", "inaccessible.safetensors"]
        resolver = self.ns["folder_paths"].get_full_path

        def get_full_path(category, name):
            if name == "inaccessible.safetensors":
                raise PermissionError("test directory inaccessible")
            return resolver(category, name)

        self.ns["folder_paths"].get_full_path = get_full_path
        self.ns["folder_paths"].get_filename_list = lambda category: names
        result = self.ns["_get_lora_metadata_inventory"]()
        self.assertEqual(result["files"], names)
        for name in names[1:]:
            self.assertEqual(result["metadata"][name], {"txt": False, "json": False, "image": False, "log": False})
        self.assertEqual([entry["path"] for entry in result["errors"]], names[1:])

    def test_inventory_groups_shared_information_by_physical_basename_not_relative_alias(self):
        other_extension = self.lora_path.with_suffix(".pt")
        other_extension.write_bytes(b"another model")
        separate = self.directory / "another-root" / "test.safetensors"
        separate.parent.mkdir()
        separate.write_bytes(b"separate model")
        paths = {
            "first-alias.safetensors": self.lora_path,
            "different-alias.pt": other_extension,
            "another-root/test.safetensors": separate,
        }
        self.ns["folder_paths"].get_filename_list = lambda category: list(paths)
        self.ns["folder_paths"].get_full_path = lambda category, name: str(paths[name])
        result = self.ns["_get_lora_metadata_inventory"]()
        group = ["first-alias.safetensors", "different-alias.pt"]
        self.assertEqual(result["shared_info"], {name: group for name in group})
        self.assertEqual(result["files"], list(paths))
        self.assertNotIn("another-root/test.safetensors", result["shared_info"])

    def test_inventory_route_opt_in_keeps_legacy_list_response_unchanged(self):
        async def run(query):
            return await self.ns["get_lora_list"](SimpleNamespace(query=query))

        for query in ({}, {"include_metadata": "false"}):
            with self.subTest(query=query):
                self.assertEqual(asyncio.run(run(query)).data, {"files": [self.lora_name]})
        self.sidecar(".log")
        response = asyncio.run(run({"include_metadata": "true"}))
        self.assertEqual(response.data["files"], [self.lora_name])
        self.assertTrue(response.data["metadata"][self.lora_name]["log"])
        self.assertEqual(response.data["errors"], [])

    def test_inventory_route_scans_off_event_loop(self):
        event_loop_thread = threading.get_ident()
        worker_threads = []

        def inventory():
            worker_threads.append(threading.get_ident())
            return {"files": [], "metadata": {}, "errors": []}

        async def run():
            return await self.ns["get_lora_list"](SimpleNamespace(query={"include_metadata": "true"}))

        with patch.dict(self.ns, {"_get_lora_metadata_inventory": inventory}):
            self.assertEqual(asyncio.run(run()).data["metadata"], {})
        self.assertNotEqual(worker_threads, [event_loop_thread])

    def test_route_validates_inputs_and_preserves_default_overwrite(self):
        async def run(payload):
            request = SimpleNamespace(json=lambda: asyncio.sleep(0, result=payload))
            return await self.ns["fetch_metadata"](request)

        for payload in ({}, {"lora_name": "x", "overwrite": "false"}, {"lora_name": "x", "update_existing": "true"}, {"lora_name": "x", "options": []},
                        {"lora_name": "x", "save_path_mode": "../other"}):
            with self.subTest(payload=payload):
                self.assertEqual(asyncio.run(run(payload)).status, 400)
        self.assertEqual(asyncio.run(run({"lora_name": "missing.safetensors"})).status, 404)
        worker = Mock(return_value={"status": "success", "message": "ok", "data": {}})
        with patch.dict(self.ns, {"_fetch_lora_metadata": worker}):
            self.assertEqual(asyncio.run(run({"lora_name": self.lora_name})).status, 200)
        self.assertTrue(worker.call_args.args[3])
        self.assertFalse(worker.call_args.args[4])
        with patch.dict(self.ns, {"_fetch_lora_metadata": worker}):
            asyncio.run(run({"lora_name": self.lora_name, "overwrite": True, "update_existing": True}))
        self.assertTrue(worker.call_args.args[4])

    def test_route_keeps_event_loop_responsive_during_blocking_worker(self):
        started = threading.Event()
        release = threading.Event()
        worker_thread = []

        def worker(*args):
            worker_thread.append(threading.get_ident())
            started.set()
            if not release.wait(2):
                raise AssertionError("event loop did not release worker")
            return {"status": "skipped", "message": "existing", "data": {}}

        async def run():
            event_loop_thread = threading.get_ident()
            request = SimpleNamespace(json=lambda: asyncio.sleep(0, result={"lora_name": self.lora_name, "overwrite": False}))
            task = asyncio.create_task(self.ns["fetch_metadata"](request))
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(0.01)
                self.assertTrue(started.is_set())
                self.assertFalse(task.done())
                self.assertNotEqual(worker_thread[0], event_loop_thread)
            finally:
                release.set()
            self.assertEqual((await task).status, 200)

        with patch.dict(self.ns, {"_fetch_lora_metadata": worker}):
            asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
