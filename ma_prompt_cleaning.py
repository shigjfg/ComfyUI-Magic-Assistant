# -*- coding: utf-8 -*-
"""
提示词清洗 / 格式化逻辑：自 prompt_cleaning_maid 迁移，依赖本地 PromptFormatter。
不含「修复分区语法」(fix_region_syntax)。
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

LORA_PATTERN = re.compile(r"<lora:[^>]+>")

SYNTAX_KEYWORDS = [
    "COUPLE",
    "MASK",
    "FEATHER",
    "FILL",
    "AND",
    "BREAK",
    "IMASK",
    "AREA",
    "MASK_SIZE",
    "MASKW",
]

SYNTAX_PATTERNS = [
    re.compile(r"\bCOUPLE\s+MASK\s*\(", re.IGNORECASE),
    re.compile(r"\bCOUPLE\s*\(", re.IGNORECASE),
    re.compile(r"\bMASK\s*\(", re.IGNORECASE),
    re.compile(r"\bFEATHER\s*\(", re.IGNORECASE),
    re.compile(r"\bFILL\s*\(", re.IGNORECASE),
    re.compile(r"\bIMASK\s*\(", re.IGNORECASE),
    re.compile(r"\bAREA\s*\(", re.IGNORECASE),
    re.compile(r"\bMASK_SIZE\s*\(", re.IGNORECASE),
    re.compile(r"\bMASKW\s*\(", re.IGNORECASE),
]

REGION_SYNTAX_FUNCTIONS = [
    "COUPLE",
    "MASK",
    "FEATHER",
    "FILL",
    "IMASK",
    "AREA",
    "MASK_SIZE",
    "MASKW",
]

_AND_SEPARATOR_PATTERN = re.compile(r"\s+AND\s+", re.IGNORECASE)
_MASK_OR_AREA_PATTERN = re.compile(r"\b(MASK|AREA|IMASK)\s*\(", re.IGNORECASE)

_REGION_FUNC_PATTERNS = {
    func: re.compile(rf"\b{func}\s*\(", re.IGNORECASE)
    for func in REGION_SYNTAX_FUNCTIONS
}


class PromptFormatter:
    """与 danbooru maid 管线兼容的最小实现：智能逗号切分 + 权重正则。"""

    # tag:1.2 / tag: / tag:.5 等（整段为单个「标签」时）
    WEIGHT_PATTERN = re.compile(r"^\s*(.+?)\s*:\s*(\d*(?:\.\d+)?)?\s*$")

    @staticmethod
    def _smart_comma_split(text: str) -> List[str]:
        if text is None:
            return []
        s = str(text)
        if not s:
            return []
        parts: List[str] = []
        buf: List[str] = []
        depth = 0
        open_b = "([{"
        close_b = ")]}"
        i = 0
        while i < len(s):
            c = s[i]
            if c in ",，" and depth == 0:
                parts.append("".join(buf))
                buf = []
                i += 1
                continue
            if c in open_b:
                depth += 1
            elif c in close_b:
                depth = max(0, depth - 1)
            buf.append(c)
            i += 1
        parts.append("".join(buf))
        return parts

    @staticmethod
    def _paren_wrapped_balanced(s: str) -> bool:
        t = s.strip()
        if len(t) < 2 or t[0] != "(" or t[-1] != ")":
            return False
        depth = 0
        for ch in t:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    return False
        return depth == 0


class PromptCleaningMaid:
    """逻辑同原版节点，已去掉修复分区语法阶段。"""

    @staticmethod
    def _remove_unmatched(s: str, open_ch: str, close_ch: str) -> str:
        stack: List[int] = []
        remove_idx = set()

        for i, ch in enumerate(s):
            if ch == open_ch:
                stack.append(i)
            elif ch == close_ch:
                if stack:
                    stack.pop()
                else:
                    remove_idx.add(i)

        remove_idx.update(stack)
        return "".join(ch for i, ch in enumerate(s) if i not in remove_idx)

    @staticmethod
    def process(string: Any, **kwargs: Any):
        if string is None:
            return ("",)
        if not isinstance(string, str):
            string = str(string)

        cleanup_commas = kwargs.get("cleanup_commas", True)
        cleanup_whitespace = kwargs.get("cleanup_whitespace", True)
        remove_lora_tags = kwargs.get("remove_lora_tags", False)
        cleanup_newlines = kwargs.get("cleanup_newlines", "false")
        fix_brackets = kwargs.get("fix_brackets", "([both])")

        underscore_to_space = kwargs.get("underscore_to_space", True)
        complete_weight_syntax = kwargs.get("complete_weight_syntax", True)
        smart_bracket_escaping = kwargs.get("smart_bracket_escaping", True)
        standardize_commas = kwargs.get("standardize_commas", True)

        cleanup_newlines_map = {
            "false": "false",
            "space": "space",
            "comma": "comma",
        }
        fix_brackets_map = {
            "false": "false",
            "(parenthesis)": "(parenthesis)",
            "[brackets]": "[brackets]",
            "([both])": "([both])",
        }

        cleanup_newlines = cleanup_newlines_map.get(cleanup_newlines, cleanup_newlines)
        fix_brackets = fix_brackets_map.get(fix_brackets, fix_brackets)

        if remove_lora_tags:
            string = re.sub(LORA_PATTERN, "", string)

        has_multi_region_syntax = PromptCleaningMaid._contains_multi_region_syntax(string)

        if cleanup_newlines != "false":
            if has_multi_region_syntax:
                if cleanup_newlines in ("space", "comma"):
                    string = string.replace("\n", " ")
            else:
                if cleanup_newlines == "space":
                    string = string.replace("\n", " ")
                elif cleanup_newlines == "comma":
                    string = string.replace("\n", ", ")

        if any([underscore_to_space, complete_weight_syntax, smart_bracket_escaping, standardize_commas]):
            string = PromptCleaningMaid._apply_custom_formatting(
                string,
                underscore_to_space,
                complete_weight_syntax,
                smart_bracket_escaping,
                standardize_commas,
            )

        if cleanup_commas:
            while re.match(r"^[ \t]*,[ \t]*", string):
                string = re.sub(r"^[ \t]*,[ \t]*", "", string)
            while re.search(r"[ \t]*,[ \t]*$", string):
                string = re.sub(r"[ \t]*,[ \t]*$", "", string)
            while re.search(r",[ \t]*,", string):
                string = re.sub(r",[ \t]*,", ",", string)

        if fix_brackets != "false":
            if fix_brackets in ("(parenthesis)", "([both])"):
                string = PromptCleaningMaid._remove_unmatched(string, "(", ")")
            if fix_brackets in ("[brackets]", "([both])"):
                string = PromptCleaningMaid._remove_unmatched(string, "[", "]")

        if cleanup_whitespace:
            string = string.strip(" \t")
            string = re.sub(r"[ \t]{2,}", " ", string)
            string = re.sub(r"[ \t]*,[ \t]*", ", ", string)

        return (string,)

    @staticmethod
    def _apply_custom_formatting(
        prompt: str,
        underscore_to_space: bool,
        complete_weight_syntax: bool,
        smart_bracket_escaping: bool,
        standardize_commas: bool,
    ) -> str:
        if not prompt or not prompt.strip():
            return prompt

        # 多区域语法：只执行下划线，其余跳过
        if PromptCleaningMaid._contains_multi_region_syntax(prompt):
            if underscore_to_space:
                protected_keywords = ["MASK_SIZE", "mask_size"]
                result = prompt
                for keyword in protected_keywords:
                    placeholder = f"__PROTECTED_{keyword}__"
                    result = result.replace(keyword, placeholder)
                result = result.replace("_", " ")
                for keyword in protected_keywords:
                    placeholder = f"__PROTECTED_{keyword}__"
                    result = result.replace(placeholder.replace("_", " "), keyword)
                return result
            return prompt

        # 任何高级选项都没开，直接返回（不做 smart 逗号切分）
        if not any([underscore_to_space, complete_weight_syntax, smart_bracket_escaping]):
            return prompt

        raw_tags = PromptFormatter._smart_comma_split(prompt)
        tags: List[str] = []
        for tag in raw_tags:
            tag = tag.strip()
            if not tag:
                continue
            processed_tag = PromptCleaningMaid._process_single_tag_custom(
                tag,
                underscore_to_space,
                complete_weight_syntax,
                smart_bracket_escaping,
            )
            tags.append(processed_tag)

        if standardize_commas:
            return ", ".join(tags)
        # 未开启标准化逗号时，用原始连接方式（smart split 后再拼回去）
        # 智能切分已去掉多余的逗号/换行，直接空格连接即可
        joined = " ".join(tags)
        return re.sub(r"\s{2,}", " ", joined)

    @staticmethod
    def _contains_special_syntax(tag: str) -> bool:
        for pattern in SYNTAX_PATTERNS:
            if pattern.search(tag):
                return True
        tag_upper = tag.upper()
        for keyword in SYNTAX_KEYWORDS:
            if keyword in tag_upper:
                return True
        return False

    @staticmethod
    def _contains_multi_region_syntax(prompt: str) -> bool:
        prompt_upper = prompt.upper()
        if "COUPLE" in prompt_upper:
            return True
        for func in REGION_SYNTAX_FUNCTIONS:
            pattern = _REGION_FUNC_PATTERNS.get(func)
            if pattern and pattern.search(prompt):
                return True
        if _AND_SEPARATOR_PATTERN.search(prompt) and _MASK_OR_AREA_PATTERN.search(prompt):
            return True
        return False

    @staticmethod
    def _process_single_tag_custom(
        tag: str,
        underscore_to_space: bool,
        complete_weight_syntax: bool,
        smart_bracket_escaping: bool,
    ) -> str:
        if underscore_to_space:
            if not PromptCleaningMaid._contains_special_syntax(tag):
                tag = tag.replace("_", " ")
            else:
                protected_keywords = ["MASK_SIZE", "mask_size"]
                for keyword in protected_keywords:
                    if keyword in tag:
                        placeholder = f"__PROTECTED_{keyword.replace('_', '')}__"
                        tag = tag.replace(keyword, placeholder)
                tag = tag.replace("_", " ")
                for keyword in protected_keywords:
                    placeholder = f"__PROTECTED_{keyword.replace('_', '')}__"
                    tag = tag.replace(placeholder.replace("_", " "), keyword)

        if complete_weight_syntax and not PromptCleaningMaid._contains_special_syntax(tag):
            tag = PromptCleaningMaid._normalize_weight_syntax_custom(tag)

        if smart_bracket_escaping and not PromptCleaningMaid._contains_special_syntax(tag):
            tag = PromptCleaningMaid._escape_brackets_in_tag_custom(tag)

        return tag

    @staticmethod
    def _normalize_weight_syntax_custom(tag: str) -> str:
        t = tag.strip()
        if PromptFormatter._paren_wrapped_balanced(t):
            return tag
        match = PromptFormatter.WEIGHT_PATTERN.match(t)
        if not match:
            return tag
        content = match.group(1).strip()
        w = match.group(2)
        if w is None or w == "":
            return f"({content}:)"
        return f"({content}:{w})"

    @staticmethod
    def _escape_brackets_in_tag_custom(tag: str) -> str:
        result: List[str] = []
        i = 0

        while i < len(tag):
            if tag[i] == "(":
                bracket_depth = 1
                j = i + 1
                content_start = i + 1

                while j < len(tag) and bracket_depth > 0:
                    if tag[j] == "(":
                        bracket_depth += 1
                    elif tag[j] == ")":
                        bracket_depth -= 1
                    elif tag[j] == "\\":
                        j += 1
                    j += 1

                if bracket_depth == 0:
                    bracket_content = tag[content_start : j - 1]

                    has_word_before = False
                    if i > 0:
                        for k in range(i - 1, -1, -1):
                            if tag[k] not in [" ", "\t", "\n"]:
                                has_word_before = True
                                break

                    if has_word_before:
                        if ":" in bracket_content or "," in bracket_content:
                            result.append(", ")
                            result.append(f"({bracket_content})")
                        else:
                            if tag[i - 1] not in [" ", "\t", "\n"]:
                                result.append(" ")
                            result.append(f"\\({bracket_content}\\)")
                        i = j
                    else:
                        if ":" in bracket_content:
                            result.append(f"({bracket_content})")
                            i = j
                        else:
                            result.append(bracket_content)
                            i = j
                else:
                    result.append(tag[i])
                    i += 1
            else:
                result.append(tag[i])
                i += 1

        return "".join(result)


_DEFAULT_FORMAT_OPTIONS: Dict[str, Any] = {
    "cleanup_commas": True,
    "cleanup_whitespace": True,
    "remove_lora_tags": False,
    "cleanup_newlines": "false",
    "fix_brackets": "both",
    "underscore_to_space": True,
    "complete_weight_syntax": True,
    "smart_bracket_escaping": True,
    "standardize_commas": True,
}


def ma_merge_format_options(partial: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(_DEFAULT_FORMAT_OPTIONS)
    if partial and isinstance(partial, dict):
        for k, v in partial.items():
            if k in out:
                out[k] = v
    return out


def ma_clean_prompt(text: str, options: Optional[Dict[str, Any]] = None) -> str:
    """对整段提示词执行清洗，返回字符串。"""
    opts = ma_merge_format_options(options)
    fb = opts.get("fix_brackets", "both")
    if fb == "parenthesis":
        fb = "(parenthesis)"
    elif fb == "brackets":
        fb = "[brackets]"
    elif fb == "both":
        fb = "([both])"
    elif fb is True:
        fb = "([both])"
    elif fb is False:
        fb = "false"
    opts = {**opts, "fix_brackets": fb}

    result = PromptCleaningMaid.process(text or "", **opts)
    return result[0] if result else ""
