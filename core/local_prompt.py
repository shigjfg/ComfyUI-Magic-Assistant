"""Local prompt-rewrite backends.

The module intentionally keeps model imports lazy.  A normal LLM-only install
therefore does not pay the startup cost of importing ComfyUI's text encoder
stack or llama.cpp helpers.
"""

from __future__ import annotations

import atexit
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import requests


_CLIP_CACHE: dict[tuple[Any, ...], Any] = {}
_CLIP_LOCK = threading.RLock()


def _check_interrupt() -> None:
    try:
        import comfy.model_management as model_management

        model_management.throw_exception_if_processing_interrupted()
    except ImportError:
        return


def _file_signature(path: Path) -> tuple[Any, ...]:
    stat = path.stat()
    return (str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


def local_text_encoder_names() -> list[str]:
    try:
        import folder_paths

        return list(folder_paths.get_filename_list("text_encoders"))
    except Exception:
        return []


def _resolve_text_encoder(model_name: str) -> Path:
    import folder_paths

    return Path(folder_paths.get_full_path_or_raise("text_encoders", model_name))


def _bundled_llama_server() -> Path | None:
    """Optional backend is self-contained and removable without touching the plugin core."""
    backend_root = Path(__file__).resolve().parents[1] / "backends" / "llama_cpp"
    candidates = (
        backend_root / "llama-server.exe",
        backend_root / "bin" / "llama-server.exe",
        backend_root / "llama-server",
        backend_root / "bin" / "llama-server",
    )
    return next((path for path in candidates if path.is_file()), None)


def llama_cpp_backend_available(profile: dict[str, Any] | None = None) -> bool:
    profile = profile or {}
    configured = str(profile.get("server_path") or "").strip()
    if configured:
        path = Path(os.path.expandvars(os.path.expanduser(configured)))
        candidates = [path] if path.is_absolute() else [Path.cwd() / path, Path(__file__).resolve().parents[1] / path]
        if any(candidate.is_file() for candidate in candidates):
            return True
    return _bundled_llama_server() is not None


def _clip_type(name: str):
    import comfy.sd

    value = str(name or "stable_diffusion").strip().upper()
    return getattr(comfy.sd.CLIPType, value, comfy.sd.CLIPType.STABLE_DIFFUSION)


def _load_comfy_clip(profile: dict[str, Any]):
    import comfy.sd
    import folder_paths

    model_name = str(profile.get("model_name") or "").strip()
    if not model_name:
        raise ValueError("本地 ComfyUI 文本编码器配置缺少 model_name")
    model_path = _resolve_text_encoder(model_name)
    clip_type_name = str(profile.get("clip_type") or "stable_diffusion")
    key = (str(model_path.resolve()), _file_signature(model_path), clip_type_name)
    with _CLIP_LOCK:
        clip = _CLIP_CACHE.get(key)
        if clip is None:
            clip = comfy.sd.load_clip(
                ckpt_paths=[str(model_path)],
                embedding_directory=folder_paths.get_folder_paths("embeddings"),
                clip_type=_clip_type(clip_type_name),
            )
            _CLIP_CACHE.clear()
            _CLIP_CACHE[key] = clip
        return clip


def _clean_generated_text(text: Any) -> str:
    value = str(text or "").strip()
    if "</think>" in value:
        value = value.split("</think>", 1)[1].strip()
    if value.startswith("```") and value.endswith("```"):
        value = value[3:-3].strip()
        if value.lower().startswith("text"):
            value = value[4:].lstrip()
    return value.strip()


def _generation_settings(profile: dict[str, Any]) -> dict[str, Any]:
    """Small deterministic presets keep prompt rewriting latency predictable."""
    mode = str(profile.get("generation_mode") or "fast").strip().lower()
    presets = {
        "fast": {"max_length": 160, "temperature": 0.1, "top_k": 20, "top_p": 0.85,
                 "min_p": 0.0, "repetition_penalty": 1.0, "presence_penalty": 0.0,
                 "thinking": False, "do_sample": False},
        "balanced": {"max_length": 256, "temperature": 0.2, "top_k": 40, "top_p": 0.9,
                     "min_p": 0.05, "repetition_penalty": 1.05, "presence_penalty": 0.0,
                     "thinking": False, "do_sample": True},
        "quality": {"max_length": 512, "temperature": 0.3, "top_k": 64, "top_p": 0.95,
                    "min_p": 0.05, "repetition_penalty": 1.05, "presence_penalty": 0.0,
                    "thinking": True, "do_sample": True},
    }
    selected = dict(presets.get(mode, presets["fast"]))
    for key in selected:
        if key in profile and profile[key] is not None:
            selected[key] = profile[key]
    selected["max_length"] = max(1, min(int(selected["max_length"]), 32768))
    selected["temperature"] = max(0.01, min(float(selected["temperature"]), 2.0))
    selected["top_k"] = max(0, min(int(selected["top_k"]), 1000))
    selected["top_p"] = max(0.0, min(float(selected["top_p"]), 1.0))
    selected["min_p"] = max(0.0, min(float(selected["min_p"]), 1.0))
    selected["repetition_penalty"] = max(0.0, min(float(selected["repetition_penalty"]), 5.0))
    selected["presence_penalty"] = max(0.0, min(float(selected["presence_penalty"]), 5.0))
    selected["thinking"] = bool(selected["thinking"])
    selected["do_sample"] = bool(selected["do_sample"])
    return selected


def generate_with_comfy_clip(
    profile: dict[str, Any],
    prompt: str,
    system_prompt: str,
    image=None,
) -> str:
    """Use a ComfyUI text encoder that implements TextGenerate's API."""
    clip = _load_comfy_clip(profile)
    settings = _generation_settings(profile)
    max_length = settings["max_length"]
    temperature = settings["temperature"]
    top_k = settings["top_k"]
    top_p = settings["top_p"]
    min_p = settings["min_p"]
    repetition_penalty = settings["repetition_penalty"]
    seed = max(0, int(profile.get("seed", 0)))
    thinking = settings["thinking"]
    sampling_mode = str(profile.get("sampling_mode") or "").lower()
    if sampling_mode == "off":
        do_sample = False
    elif sampling_mode == "on":
        do_sample = True
    else:
        do_sample = settings["do_sample"]
    use_default_template = bool(profile.get("use_default_template", True))
    mtp = profile.get("mtp", "auto")
    mtp = False if str(mtp).lower() == "off" else (True if str(mtp).lower() == "auto" else int(mtp))

    if use_default_template:
        tokenize_prompt = prompt
        tokenize_kwargs = {
            "min_length": 1,
            "thinking": thinking,
            "skip_template": False,
            "system_prompt": system_prompt or "",
        }
    else:
        # The checkbox disables the model's chat wrapper only.  Preserve the
        # user's Rule Editor system text by presenting it as plain prompt text.
        tokenize_prompt = f"{system_prompt}\n\n{prompt}".strip() if system_prompt else prompt
        tokenize_kwargs = {
            "min_length": 1,
            "thinking": False,
            "skip_template": True,
        }
    if image is not None:
        tokenize_kwargs["image"] = image
    try:
        tokens = clip.tokenize(tokenize_prompt, **tokenize_kwargs)
    except TypeError:
        # Older ComfyUI text encoders do not expose the newer chat arguments.
        tokens = clip.tokenize(tokenize_prompt)

    generated_ids = clip.generate(
        tokens,
        do_sample=do_sample,
        max_length=max_length,
        temperature=temperature,
        top_k=top_k,
        top_p=top_p,
        min_p=min_p,
        repetition_penalty=repetition_penalty,
        seed=seed,
        presence_penalty=settings["presence_penalty"],
        mtp=mtp,
    )
    return _clean_generated_text(clip.decode(generated_ids))


class _LlamaCppServer:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.process: subprocess.Popen | None = None
        self.signature: tuple[Any, ...] | None = None
        self.port: int | None = None
        self.log_handle = None

    @staticmethod
    def _resolve_path(value: str, model_root: Path) -> Path:
        path = Path(os.path.expandvars(os.path.expanduser(value)))
        if path.is_absolute():
            return path
        candidates = [model_root / path]
        try:
            import folder_paths

            candidates.append(Path(folder_paths.models_dir) / "llm" / path)
        except Exception:
            pass
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return candidates[0]

    @staticmethod
    def _model_root() -> Path:
        try:
            import folder_paths

            return Path(folder_paths.models_dir) / "llm"
        except Exception:
            return Path.cwd() / "models" / "llm"

    def stop(self) -> None:
        with self.lock:
            process = self.process
            self.process = None
            self.signature = None
            self.port = None
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if self.log_handle is not None:
                self.log_handle.close()
                self.log_handle = None

    def _healthy(self) -> bool:
        if self.process is None or self.process.poll() is not None or self.port is None:
            return False
        try:
            response = requests.get(f"http://127.0.0.1:{self.port}/health", timeout=2)
            return response.status_code == 200
        except requests.RequestException:
            return False

    def start(self, profile: dict[str, Any]) -> None:
        model_root = self._model_root()
        model = self._resolve_path(str(profile.get("model_path") or ""), model_root)
        if not model.is_file():
            raise FileNotFoundError(f"llama.cpp 模型不存在: {model}")
        mmproj_value = str(profile.get("mmproj_path") or "").strip()
        mmproj = self._resolve_path(mmproj_value, model_root) if mmproj_value else None
        if mmproj is not None and not mmproj.is_file():
            raise FileNotFoundError(f"llama.cpp mmproj 不存在: {mmproj}")
        server_value = str(profile.get("server_path") or "").strip()
        server = self._resolve_path(server_value, Path.cwd()) if server_value else _bundled_llama_server()
        if server is None or not server.is_file():
            raise FileNotFoundError("llama.cpp 配置缺少有效的 server_path（llama-server.exe）")
        context = max(1024, min(int(profile.get("context", 8192)), 131072))
        gpu_layers = int(profile.get("gpu_layers", 99))
        signature = (
            _file_signature(model),
            _file_signature(mmproj) if mmproj else None,
            _file_signature(server),
            context,
            gpu_layers,
        )
        with self.lock:
            if self.signature == signature and self._healthy():
                return
            self.stop()
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            command = [
                str(server),
                "-m",
                str(model),
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "-c",
                str(context),
                "-ngl",
                str(gpu_layers),
                "--jinja",
                "--reasoning-format",
                "none",
                "--parallel",
                "1",
                "--alias",
                "magic-local",
            ]
            if mmproj:
                command.extend(["--mmproj", str(mmproj)])
            log_path = Path(__file__).resolve().parent / "local_llama_server.log"
            self.log_handle = log_path.open("ab")
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            self.process = subprocess.Popen(
                command,
                stdout=self.log_handle,
                stderr=subprocess.STDOUT,
                creationflags=flags,
            )
            self.signature = signature
            self.port = port
            deadline = time.monotonic() + max(10, min(int(profile.get("startup_timeout", 180)), 600))
            while time.monotonic() < deadline:
                _check_interrupt()
                if self.process.poll() is not None:
                    raise RuntimeError(f"llama-server 已退出，代码 {self.process.returncode}")
                if self._healthy():
                    return
                time.sleep(0.5)
            self.stop()
            raise TimeoutError("llama-server 在启动超时内未通过健康检查")

    def complete(self, profile: dict[str, Any], prompt: str, system_prompt: str) -> str:
        if self.port is None:
            raise RuntimeError("llama.cpp 服务尚未启动")
        settings = _generation_settings(profile)
        sampling_mode = str(profile.get("sampling_mode") or "").lower()
        payload = {
            "model": "magic-local",
            "messages": [
                {"role": "system", "content": system_prompt or ""},
                {"role": "user", "content": prompt},
            ],
            "temperature": settings["temperature"],
            "top_p": settings["top_p"],
            "top_k": settings["top_k"],
            "min_p": settings["min_p"],
            "repetition_penalty": settings["repetition_penalty"],
            "presence_penalty": settings["presence_penalty"],
            "seed": max(0, int(profile.get("seed", 0))),
            "max_tokens": settings["max_length"],
            "stream": False,
        }
        if sampling_mode == "off":
            payload["temperature"] = 0.0
            payload["top_p"] = 1.0
        payload["chat_template_kwargs"] = {
            "enable_thinking": bool(settings["thinking"]) and bool(profile.get("use_default_template", True))
        }
        timeout = max(30, min(int(profile.get("read_timeout", 600)), 1800))
        result: dict[str, Any] = {}
        done = threading.Event()

        def worker() -> None:
            try:
                response = requests.post(
                    f"http://127.0.0.1:{self.port}/v1/chat/completions",
                    json=payload,
                    timeout=timeout,
                )
                response.raise_for_status()
                result["json"] = response.json()
            except BaseException as exc:
                result["error"] = exc
            finally:
                done.set()

        threading.Thread(target=worker, name="magic-local-llama", daemon=True).start()
        while not done.wait(0.1):
            _check_interrupt()
        _check_interrupt()
        if "error" in result:
            raise result["error"]
        data = result.get("json") or {}
        choices = data.get("choices") or []
        if not choices:
            raise ValueError("llama.cpp 响应缺少 choices")
        message = choices[0].get("message") or {}
        content = message.get("content") or choices[0].get("text") or ""
        return _clean_generated_text(content)


_LLAMA_SERVER = _LlamaCppServer()
atexit.register(_LLAMA_SERVER.stop)


def unload_local_prompt_models() -> None:
    with _CLIP_LOCK:
        _CLIP_CACHE.clear()
    _LLAMA_SERVER.stop()


def generate_with_llama_cpp(profile: dict[str, Any], prompt: str, system_prompt: str, image=None) -> str:
    if image is not None:
        raise ValueError("llama.cpp 本地后端暂不接受 IMAGE；请改用支持视觉 mmproj 的 ComfyUI 文本编码器配置")
    _LLAMA_SERVER.start(profile)
    return _LLAMA_SERVER.complete(profile, prompt, system_prompt)


def generate_local_prompt(
    profile: dict[str, Any],
    prompt: str,
    system_prompt: str,
    image=None,
) -> str:
    backend = str(profile.get("backend") or "comfy_clip").strip().lower()
    if backend == "llama_cpp":
        if llama_cpp_backend_available(profile):
            result = generate_with_llama_cpp(profile, prompt, system_prompt, image=image)
        else:
            # Optional llama.cpp is intentionally non-blocking: deleting the
            # backends/llama_cpp folder falls back to the official ComfyUI TE.
            fallback = dict(profile)
            fallback["backend"] = "comfy_clip"
            if not str(fallback.get("model_name") or "").strip():
                available = local_text_encoder_names()
                if available:
                    fallback["model_name"] = available[0]
            result = generate_with_comfy_clip(fallback, prompt, system_prompt, image=image)
    else:
        result = generate_with_comfy_clip(profile, prompt, system_prompt, image=image)
    if not result:
        raise ValueError("本地模型返回空提示词")
    return result
