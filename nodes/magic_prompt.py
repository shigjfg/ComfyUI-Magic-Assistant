import json
import os
import sys
import time
import uuid
from urllib.parse import urlsplit

import requests

# --- 关键修复：正确引用上级目录的 utils ---
# 获取当前文件所在目录 (custom_nodes/magic_assistant/nodes)
current_dir = os.path.dirname(os.path.abspath(__file__))
# 获取父级目录 (custom_nodes/magic_assistant)
parent_dir = os.path.dirname(current_dir)

# 将父级目录临时加入系统路径，以便可以 import utils
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from utils import MagicUtils
except ImportError:
    # 如果还是失败，尝试相对导入 (虽然在动态加载中不稳定，但作为备选)
    from ..utils import MagicUtils


class MagicPromptReplace:
    DEFAULT_CONNECT_TIMEOUT = 15
    DEFAULT_READ_TIMEOUT = 180
    DEFAULT_MAX_RETRIES = 1
    MAX_ERROR_BODY = 1200

    @classmethod
    def INPUT_TYPES(s):
        rules_data = MagicUtils.get_rules_config()
        llm_data = MagicUtils.get_llm_config()

        rules_list = [r.get("name") for r in rules_data.values()] or ["Loading..."]
        llm_list = list(llm_data.keys()) or ["Loading..."]

        return {
            "required": {
                "original_prompt": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "原始提示词 (Original)"}),
                "replace_tag": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "新内容 (New Content)"}),
                "llm_profile": (llm_list,),
                "rule_name": (rules_list,),
            },
            "optional": {
                # 外接 STRING：有连线时使用连线内容；未连线时为 None，回退到上面的 original_prompt 编辑框
                "original_prompt_in": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "prompt_config_json": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("modified_prompt",)
    FUNCTION = "process_llm"
    CATEGORY = "✨ Magic Assistant"

    @classmethod
    def VALIDATE_INPUTS(s, rule_name, llm_profile, **kwargs):
        return True

    def log(self, msg, type="info", request_id=None):
        reset = "\033[0m"
        colors = {
            "start": "\033[33m",
            "success": "\033[32m",
            "warning": "\033[33m",
            "error": "\033[31m",
            "info": "\033[36m",
        }
        labels = {
            "start": "🟡 准备",
            "success": "✅ 完成",
            "warning": "⚠️ 警告",
            "error": "❌ 失败",
            "info": "🔵 信息",
        }
        rid = f" | ID:{request_id}" if request_id else ""
        color = colors.get(type, colors["info"])
        label = labels.get(type, labels["info"])
        # flush=True 很重要：长请求或多节点并发时，确保日志立即出现在 ComfyUI 后台。
        print(f"{color}✨ {label} | 节点-提示词替换{rid} | {msg}{reset}", flush=True)

    @staticmethod
    def _effective_original_prompt(widget_prompt, linked_prompt):
        """有外接 original_prompt_in 时用连线；否则用编辑框。"""
        if linked_prompt is not None:
            if isinstance(linked_prompt, str):
                return linked_prompt
            return str(linked_prompt)
        return widget_prompt

    @staticmethod
    def _safe_int(profile, key, default, minimum, maximum):
        try:
            value = int(profile.get(key, default))
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(value, maximum))

    @staticmethod
    def _request_id(prompt_config_json):
        """优先复用前端/工作流传来的 ID，否则生成短 ID，方便并发日志串联。"""
        if prompt_config_json:
            try:
                config = json.loads(prompt_config_json)
                if isinstance(config, dict):
                    supplied = config.get("request_id") or config.get("id") or config.get("node_id")
                    if supplied:
                        return str(supplied)[:64]
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
        return f"mpr_{uuid.uuid4().hex[:8]}"

    @staticmethod
    def _endpoint(base_url):
        endpoint = (base_url or "").strip().rstrip("/")
        if "/chat/completions" not in endpoint:
            if "openai.com" in endpoint and "/v1" not in endpoint:
                endpoint = endpoint.replace("api.openai.com", "api.openai.com/v1")
            endpoint = f"{endpoint}/chat/completions"
        return endpoint

    @staticmethod
    def _safe_endpoint_for_log(endpoint):
        """日志保留服务地址和路径，但绝不输出查询参数或凭据。"""
        try:
            parts = urlsplit(endpoint)
            return f"{parts.scheme}://{parts.netloc}{parts.path}"
        except Exception:
            return "<invalid endpoint>"

    @staticmethod
    def _response_request_id(response):
        for key in ("x-request-id", "request-id", "cf-ray", "x-trace-id", "trace-id"):
            value = response.headers.get(key)
            if value:
                return f"{key}={value}"
        return "无"

    @staticmethod
    def _extract_content(result):
        """兼容常见 OpenAI 兼容响应，包括 content 分片数组和旧式 choices[].text。"""
        if not isinstance(result, dict):
            return "", "响应 JSON 顶层不是对象"
        choices = result.get("choices")
        if not isinstance(choices, list) or not choices:
            return "", "缺少 choices 或 choices 为空"
        first = choices[0]
        if not isinstance(first, dict):
            return "", "choices[0] 不是对象"

        message = first.get("message") or {}
        content = message.get("content") if isinstance(message, dict) else None
        if content is None:
            content = first.get("text")

        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text = item.get("text") or item.get("content")
                    if isinstance(text, str):
                        parts.append(text)
            content = "".join(parts)

        if content is None:
            return "", "choices[0] 中没有 message.content/text"
        if not isinstance(content, str):
            content = str(content)
        content = content.strip()
        return content, "" if content else "message.content 最终为空字符串"

    @staticmethod
    def _response_summary(result):
        """仅输出结构摘要，不把完整提示词或服务端敏感内容写进后台。"""
        if not isinstance(result, dict):
            return f"json_type={type(result).__name__}"
        choices = result.get("choices")
        choice_count = len(choices) if isinstance(choices, list) else 0
        finish_reason = None
        if choice_count and isinstance(choices[0], dict):
            finish_reason = choices[0].get("finish_reason")
        usage = result.get("usage") or {}
        return (
            f"choices={choice_count}, finish_reason={finish_reason!r}, "
            f"prompt_tokens={usage.get('prompt_tokens')}, "
            f"completion_tokens={usage.get('completion_tokens')}, "
            f"total_tokens={usage.get('total_tokens')}"
        )

    @staticmethod
    def _backoff_seconds(retry_number):
        return min(1.5 * (2 ** max(0, retry_number - 1)), 6.0)

    def process_llm(self, original_prompt, replace_tag, rule_name, llm_profile, original_prompt_in=None, prompt_config_json=None):
        start_time = time.monotonic()
        request_id = self._request_id(prompt_config_json)
        original_prompt = self._effective_original_prompt(original_prompt, original_prompt_in)

        llm_data = MagicUtils.get_llm_config()
        rules_data = MagicUtils.get_rules_config()

        active_llm = llm_data.get(llm_profile)
        if not active_llm:
            if llm_data:
                missing_profile = llm_profile
                llm_profile, active_llm = next(iter(llm_data.items()))
                self.log(f"配置不存在，已使用首个配置 | 原配置:{missing_profile} | 当前配置:{llm_profile}", "warning", request_id)
            else:
                self.log("没有可用的 LLM 配置", "error", request_id)
                return (f"Error [{request_id}]: No LLM profiles.",)

        active_rule = None
        for rule in rules_data.values():
            if rule.get("name") == rule_name:
                active_rule = rule
                break
        if not active_rule:
            if rules_data:
                active_rule = next(iter(rules_data.values()))
                self.log(f"规则不存在，已使用首个规则 | 原规则:{rule_name}", "warning", request_id)
            else:
                self.log("没有可用的替换规则", "error", request_id)
                return (f"Error [{request_id}]: No rules found.",)

        base_url = active_llm.get("base_url", "").rstrip("/")
        api_key = active_llm.get("api_key", "")
        model = active_llm.get("model", "")
        system_prompt = active_rule.get("system", "")
        target_features = active_rule.get("guide", "")

        if not base_url or not api_key:
            self.log(f"配置缺少 Base URL 或 API Key | 服务:{llm_profile}", "error", request_id)
            return (f"Error [{request_id}]: Key/URL missing in '{llm_profile}'.",)
        if not model:
            self.log(f"配置缺少模型名称 | 服务:{llm_profile}", "error", request_id)
            return (f"Error [{request_id}]: Model missing in '{llm_profile}'.",)

        connect_timeout = self._safe_int(active_llm, "connect_timeout", self.DEFAULT_CONNECT_TIMEOUT, 3, 120)
        read_timeout = self._safe_int(active_llm, "read_timeout", self.DEFAULT_READ_TIMEOUT, 30, 600)
        max_retries = self._safe_int(active_llm, "max_retries", self.DEFAULT_MAX_RETRIES, 0, 3)
        endpoint = self._endpoint(base_url)
        safe_endpoint = self._safe_endpoint_for_log(endpoint)

        user_message = f"""
请根据以下指令修改提示词：
[原始提示词]: {original_prompt}
[新替换提示词]: {replace_tag}
[替换的指南]: {target_features}

任务要求：
1. 根据“替换的指南”，将“新替换提示词”自然融入到“原始提示词”中。
2. 根据“替换的指南”和当前扮演的角色，删除或替换“原始提示词”中不再适用或冲突的tag。
3. 直接输出修改后的最终tag字符串，用英文逗号分隔。不要输出任何解释性文字。
"""
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        base_payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.7,
        }

        self.log(
            f"服务:{llm_profile} | 模型:{model} | 规则:{rule_name} | "
            f"原文:{len(original_prompt or '')}字符 | 替换:{len(replace_tag or '')}字符 | "
            f"连接/读取超时:{connect_timeout}/{read_timeout}s | 最多重试:{max_retries}次",
            "start",
            request_id,
        )
        self.log(f"请求地址:{safe_endpoint}", "info", request_id)

        last_error = "未知错误"
        fallback_level = 0
        total_attempts = max_retries + 1

        for attempt_index in range(total_attempts):
            attempt = attempt_index + 1
            payload = dict(base_payload)
            removed_params = []
            if fallback_level >= 1:
                payload.pop("temperature", None)
                removed_params.append("temperature")

            self.log(
                f"发起请求 {attempt}/{total_attempts} | 降级:Level-{fallback_level} | "
                f"移除参数:{'[' + ', '.join(removed_params) + ']' if removed_params else '[无]'}",
                "info",
                request_id,
            )
            attempt_started = time.monotonic()

            try:
                response = requests.post(
                    endpoint,
                    headers=headers,
                    json=payload,
                    timeout=(connect_timeout, read_timeout),
                )
                request_elapsed = time.monotonic() - attempt_started
                body_size = len(response.content or b"")
                upstream_id = self._response_request_id(response)
                self.log(
                    f"收到响应 {attempt}/{total_attempts} | HTTP:{response.status_code} | "
                    f"耗时:{request_elapsed:.1f}s | 大小:{body_size}B | 上游请求ID:{upstream_id}",
                    "info",
                    request_id,
                )

                if response.status_code != 200:
                    body_preview = (response.text or "<空响应体>").replace("\r", " ").replace("\n", " ")[:self.MAX_ERROR_BODY]
                    last_error = f"HTTP {response.status_code}: {body_preview}"
                    self.log(f"上游错误正文:{body_preview}", "error", request_id)

                    if response.status_code == 400:
                        if fallback_level == 0 and attempt < total_attempts:
                            fallback_level = 1
                            self.log(
                                "HTTP 400，触发兼容降级重试 | Level-1 将移除:[temperature]",
                                "warning",
                                request_id,
                            )
                        else:
                            self.log(
                                "HTTP 400 且已无新的可移除参数，停止无意义重试",
                                "error",
                                request_id,
                            )
                            break
                    elif response.status_code in {408, 409, 425, 429, 500, 502, 503, 504} and attempt < total_attempts:
                        self.log(f"HTTP {response.status_code} 属于临时错误，将重试", "warning", request_id)
                    else:
                        break

                else:
                    try:
                        result = response.json()
                    except ValueError as exc:
                        body_preview = (response.text or "<空响应体>")[:self.MAX_ERROR_BODY]
                        last_error = f"响应不是合法 JSON: {exc}"
                        self.log(f"JSON解析失败:{exc} | 响应预览:{body_preview}", "error", request_id)
                        if attempt >= total_attempts:
                            break
                    else:
                        content, empty_reason = self._extract_content(result)
                        summary = self._response_summary(result)
                        if content:
                            usage = result.get("usage") or {}
                            duration = time.monotonic() - start_time
                            self.log(
                                f"服务:{llm_profile} | 模型:{model} | 输出:{len(content)}字符 | "
                                f"Tokens:{usage.get('total_tokens')} | 总耗时:{duration:.1f}s | 尝试:{attempt}次",
                                "success",
                                request_id,
                            )
                            return (content,)

                        last_error = f"响应内容为空（{empty_reason}）"
                        self.log(
                            f"[API响应调试] 状态:HTTP 200 | {summary} | 空内容原因:{empty_reason}",
                            "warning",
                            request_id,
                        )
                        if attempt >= total_attempts:
                            break
                        if fallback_level == 0:
                            fallback_level = 1
                            self.log(
                                "成功响应但最终内容为空，触发兼容降级重试 | Level-1 将移除:[temperature]",
                                "warning",
                                request_id,
                            )
                        else:
                            self.log("成功响应但最终内容为空，将继续重试", "warning", request_id)

            except requests.exceptions.ConnectTimeout:
                elapsed = time.monotonic() - attempt_started
                last_error = f"连接上游超时（{connect_timeout}s）"
                self.log(
                    f"网络连接超时 | 阶段:建立连接 | 限制:{connect_timeout}s | 实际:{elapsed:.1f}s | 服务:{safe_endpoint}",
                    "error",
                    request_id,
                )
                if attempt >= total_attempts:
                    break
            except requests.exceptions.ReadTimeout:
                elapsed = time.monotonic() - attempt_started
                last_error = f"等待上游响应超时（{read_timeout}s）"
                self.log(
                    f"读取超时 | 阶段:等待模型返回 | 限制:{read_timeout}s | 实际:{elapsed:.1f}s | "
                    "说明:请求可能已到达服务商，但服务商在时限内未返回数据",
                    "error",
                    request_id,
                )
                if attempt >= total_attempts:
                    break
            except requests.exceptions.ConnectionError as exc:
                elapsed = time.monotonic() - attempt_started
                last_error = f"网络连接失败: {exc}"
                self.log(
                    f"连接失败 | 耗时:{elapsed:.1f}s | 异常:{type(exc).__name__} | 详情:{exc}",
                    "error",
                    request_id,
                )
                if attempt >= total_attempts:
                    break
            except requests.exceptions.RequestException as exc:
                elapsed = time.monotonic() - attempt_started
                last_error = f"HTTP请求异常: {exc}"
                self.log(
                    f"请求异常 | 耗时:{elapsed:.1f}s | 异常:{type(exc).__name__} | 详情:{exc}",
                    "error",
                    request_id,
                )
                if attempt >= total_attempts:
                    break
            except Exception as exc:
                elapsed = time.monotonic() - attempt_started
                last_error = f"未预期异常: {exc}"
                self.log(
                    f"未预期异常 | 耗时:{elapsed:.1f}s | 异常:{type(exc).__name__} | 详情:{exc}",
                    "error",
                    request_id,
                )
                break

            if attempt < total_attempts:
                delay = self._backoff_seconds(attempt)
                self.log(f"将在 {delay:.1f}s 后重试", "warning", request_id)
                time.sleep(delay)

        duration = time.monotonic() - start_time
        self.log(
            f"服务:{llm_profile} | 模型:{model} | 总耗时:{duration:.1f}s | 最终错误:{last_error}",
            "error",
            request_id,
        )
        return (f"Error [{request_id}]: {last_error}",)
