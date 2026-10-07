const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../web/magic_power_lora.js"), "utf8");
function section(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

function harness(fetchApi, settings, configuration = {}) {
    const listeners = new Map();
    const graph = { _nodes: [] };
    const confirmPrompts = [];
    const makeEvent = (values, target) => ({
        bubbles: true,
        defaultPrevented: false,
        cancelBubble: false,
        ...values,
        target: values.target || target,
        stopPropagation() { this.cancelBubble = true; },
        preventDefault() { this.defaultPrevented = true; },
    });
    const addListener = (map, type, listener) => {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type).add(listener);
    };
    const removeListener = (map, type, listener) => {
        map.get(type)?.delete(listener);
        if (!map.get(type)?.size) map.delete(type);
    };
    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.style = {};
            this.attrs = {};
            this.disabled = false;
            this._value = null;
            this._text = "";
            this.listeners = new Map();
            this.offsetWidth = 820;
            this.offsetHeight = 600;
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
        set textContent(value) { this.replaceChildren(); this._text = String(value); }
        get value() { return this._value ?? (this.tagName === "SELECT" ? this.children[0]?.value || "" : ""); }
        set value(value) { this._value = value; }
        get options() { return this.children; }
        get isConnected() { return this === document.body || !!this.parentElement?.isConnected; }
        appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
        replaceChildren(...children) {
            this._text = "";
            this.children.forEach(child => { child.parentElement = null; });
            this.children = [];
            children.forEach(child => this.appendChild(child));
        }
        setAttribute(key, value) { this.attrs[key] = value; }
        getAttribute(key) { return this.attrs[key] ?? null; }
        addEventListener(type, listener) { addListener(this.listeners, type, listener); }
        removeEventListener(type, listener) { removeListener(this.listeners, type, listener); }
        contains(element) { return element === this || this.children.some(child => child.contains(element)); }
        closest(selector) {
            const tags = selector.split(",").map(tag => tag.trim().toUpperCase());
            for (let element = this; element; element = element.parentElement) {
                if (tags.includes(element.tagName)) return element;
            }
            return null;
        }
        getBoundingClientRect() {
            const coordinate = name => {
                const text = this.style[name] || this.style.cssText?.match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`))?.[1];
                return Number.parseFloat(text) || 0;
            };
            return { left: coordinate("left"), top: coordinate("top"), width: this.offsetWidth, height: this.offsetHeight };
        }
        _dispatch(event, includeProperty = true) {
            event.currentTarget = this;
            for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
            if (includeProperty) this[`on${event.type}`]?.(event);
            if (event.bubbles && !event.cancelBubble) {
                if (this.parentElement) this.parentElement._dispatch(event);
                else if (this === document.body || this === document.head) document._dispatch(event);
            }
            return event;
        }
        dispatchEvent(values) { return this._dispatch(makeEvent(values, this)); }
        focus() { document.focused = this; }
        remove() {
            if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
        click() {
            if (this.disabled) return;
            const event = makeEvent({ type: "click" }, this);
            const result = this.onclick?.(event);
            this._dispatch(event, false);
            return result;
        }
    }
    const document = {
        body: new Element("body"),
        head: new Element("head"),
        createElement: tag => new Element(tag),
        get activeElement() { return this.focused || this.body; },
        getElementById(id) {
            const find = root => root.id === id ? root : root.children.map(find).find(Boolean);
            return find(this.head) || find(this.body) || null;
        },
        addEventListener: (name, listener) => addListener(listeners, name, listener),
        removeEventListener: (name, listener) => removeListener(listeners, name, listener),
        _dispatch(event) {
            event.currentTarget = this;
            for (const listener of [...(listeners.get(event.type) || [])]) listener(event);
            return event;
        },
        dispatchEvent(values) { return this._dispatch(makeEvent(values, this)); },
    };
    const window = { innerWidth: 1200, innerHeight: 900 };
    const storage = new Map();
    if (settings) storage.set("magic_power_lora_fetch_settings", JSON.stringify(settings));
    const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    class Node {
        constructor(loraData) {
            this.loraData = loraData || { loras: [], folders: [] };
            this.refreshedNames = [];
            this.renderCount = 0;
            this.updateCount = 0;
            this.type = "MagicPowerLoraLoader";
            graph._nodes.push(this);
        }
        renderEmbeddedList() { this.renderCount++; }
        updateWidget() { this.updateCount++; }
        refreshLoraImageCache(name) { this.refreshedNames.push(name); }
    }
    const helpers = section("const MPL_METADATA_SETTINGS_KEY", "/** 与「添加 Lora」弹窗");
    const draggable = section("            nodeType.prototype.makeDialogDraggable", "            // --- Klein 模式提示 Banner ---");
    const modal = section("            nodeType.prototype.showBatchMetadataModal", "            nodeType.prototype.showFetchModal");
    const api = { fetchApi: async (url, request) => {
        if (url.startsWith("/ma/lora/list") && !configuration.inventoryFromFetch) {
            const files = [...new Set(graph._nodes.flatMap(node => [
                ...(node.loraData.loras || []).map(item => item.name),
                ...(node.loraData.folders || []).flatMap(folder => (folder.loras || []).map(item => item.name)),
            ]))];
            return response(configuration.inventory || { files, metadata: {} });
        }
        return fetchApi ? fetchApi(url, request) : response({ status: "skipped", message: "Already present", saved: [] });
    } };
    const functions = new Function("api", "localStorage", "document", "mplT", "loadLoraImageList", "mplSetLoraNameList", "nodeType", "app", "NODE_NAME", "confirm", "window",
        helpers + "\n" + draggable + "\n" + modal + "\nreturn { mplLoadMetadataSettings, mplCollectMetadataNames, mplApplyMetadataData, mplRunMetadataQueue, mplMetadataTypes, mplMetadataRequestedTypes, mplMetadataNeeds, mplFilterMetadataNames, mplMetadataPreflight, mplMetadataHasSharedSelection };",
    )(api, localStorage, document, text => text, async () => {}, () => {}, Node, { graph }, "MagicPowerLoraLoader", prompt => {
        confirmPrompts.push(prompt);
        return configuration.confirm ? configuration.confirm(prompt) : true;
    }, window);
    const elements = (root = document.body) => [root, ...root.children.flatMap(child => elements(child))];
    const button = text => elements().find(element => element.tagName === "BUTTON" && element.textContent === text);
    const control = label => elements().find(element => element.attrs["aria-label"] === label);
    return { ...functions, document, window, Node, storage, elements, button, control, listeners, graph, confirmPrompts };
}

function response(result, ok = true, status = ok ? 200 : 500) {
    return { ok, status, json: async () => result };
}

test("node scope includes disabled and virtual folder items, deduplicating separators without losing Linux case identity", () => {
    const env = harness();
    const node = new env.Node({
        loras: [{ name: "./styles\\Foo.safetensors", enabled: false }, { name: "styles/Foo.safetensors" }],
        folders: [{ name: "Styles", loras: [{ name: "styles/foo.safetensors", enabled: false }, { name: "other.safetensors" }] }],
    });
    assert.deepEqual(env.mplCollectMetadataNames(node), ["./styles\\Foo.safetensors", "styles/foo.safetensors", "other.safetensors"]);
    assert.deepEqual(env.mplCollectMetadataNames(node, "folder:0"), ["styles/foo.safetensors", "other.safetensors"]);
    assert.deepEqual(env.mplCollectMetadataNames(node, "all", ["a\\b.pt", "a/b.pt", "A/b.pt"]), ["a\\b.pt", "A/b.pt"]);
});

test("batch settings reuse the single-download storage and recover its defaults", () => {
    const env = harness(undefined, { download_txt: false, download_image: false, save_path: "subfolder" });
    assert.deepEqual(env.mplLoadMetadataSettings(), {
        download_txt: false, download_json: true, download_image: false, download_log: true, save_path: "subfolder",
    });
    env.storage.set("magic_power_lora_fetch_settings", "invalid JSON");
    assert.deepEqual(env.mplLoadMetadataSettings(), {
        download_txt: true, download_json: true, download_image: true, download_log: true, save_path: "same_dir",
    });
});

test("fetched metadata updates duplicate node references without changing custom tags, weights or enabled state", () => {
    const env = harness();
    const first = { name: "a\\model.pt", weight: 0.7, enabled: false, tags: "my custom words", note: "keep", jsonInfo: "old" };
    const second = { name: "./a/model.pt", weight: 1.4, tags: "second words" };
    const distinct = { name: "a/Model.pt", triggerWords: "case distinct" };
    const node = new env.Node({ loras: [first, distinct], folders: [{ loras: [second] }] });
    env.mplApplyMetadataData(node, "a/model.pt", { triggerWords: "downloaded", logInfo: "new log" });
    assert.deepEqual(first, {
        name: "a\\model.pt", weight: 0.7, enabled: false, tags: "my custom words", note: "keep", jsonInfo: "old",
        triggerWords: "downloaded", logInfo: "new log",
    });
    assert.equal(second.triggerWords, "downloaded");
    assert.equal(second.weight, 1.4);
    assert.equal(second.tags, "second words");
    assert.equal(distinct.triggerWords, "case distinct");
});

test("queue is sequential, sends missing-only payloads and continues after a request fails", async () => {
    let active = 0;
    let maxActive = 0;
    const calls = [];
    const env = harness(async (url, request) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const payload = JSON.parse(request.body);
        calls.push({ url, payload });
        await Promise.resolve();
        active--;
        if (payload.lora_name === "broken.pt") throw new Error("Network failed");
        return response({ status: "success", message: "Saved", saved: ["txt"], data: { triggerWords: "new" } });
    });
    const state = { cancelRequested: false };
    const options = { download_txt: true, download_json: false, download_image: false, download_log: false, save_path: "subfolder" };
    const progress = [];
    const results = await env.mplRunMetadataQueue(["first.pt", "broken.pt", "last.pt"], options, state, update => progress.push(update));
    assert.equal(maxActive, 1);
    assert.equal(state.running, false);
    assert.deepEqual(results.map(result => result.status), ["success", "error", "success"]);
    assert.deepEqual(calls[0], {
        url: "/ma/lora/fetch_metadata",
        payload: { lora_name: "first.pt", options: { download_txt: true, download_json: false, download_image: false, download_log: false }, save_path_mode: "subfolder", overwrite: false },
    });
    assert.deepEqual(progress.filter(update => update.result).map(update => update.completed), [1, 2, 3]);
});

test("stop completes the active request and never launches the remaining files", async () => {
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body).lora_name);
        return response({ status: "skipped", message: "Existing", saved: [] });
    });
    const state = { cancelRequested: false };
    const result = await env.mplRunMetadataQueue(["active.pt", "later.pt"], env.mplLoadMetadataSettings(), state, update => {
        if (!update.result) state.cancelRequested = true;
    });
    assert.deepEqual(calls, ["active.pt"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "skipped");
    assert.equal(state.running, false);
});

test("HTTP and invalid response failures count as errors instead of successful downloads", async () => {
    const replies = [response({ status: "success", message: "HTTP failure" }, false), response({ message: "Invalid result" }), { ok: true, json: async () => { throw new Error("Invalid JSON"); } }];
    const env = harness(async () => replies.shift());
    const result = await env.mplRunMetadataQueue(["a.pt", "b.pt", "c.pt"], env.mplLoadMetadataSettings(), { cancelRequested: false }, () => {});
    assert.deepEqual(result.map(entry => entry.status), ["error", "error", "error"]);
    assert.deepEqual(result.map(entry => entry.message), ["HTTP failure", "Invalid result", "Invalid JSON"]);
});

test("node footer has the direct entry and only one independent library dialog can open across nodes", async () => {
    assert.match(section("                footer.append(", "                this.embeddedDiv.appendChild(footer)"), /createBtn\("📥 一键下载信息", "mpl-btn-metadata", \(\) => this\.showBatchMetadataModal\(\)\)/);
    const env = harness();
    await new env.Node({ loras: [{ name: "disabled.pt", enabled: false }], folders: [] }).showBatchMetadataModal();
    assert.equal(env.button("开始下载").disabled, false);
    new env.Node().showBatchMetadataModal();
    assert.equal(env.document.body.children.length, 1);
    assert.equal(env.document.focused.attrs["aria-label"], "LoRA 信息管理");
    assert.equal(env.control("下载范围").value, "all");
    env.button("关闭").click();
    assert.equal(env.document.body.children.length, 0);
    assert.equal(env.listeners.has("keydown"), false);
});

test("modal retries only failed and partial items, preserves node choices and refreshes changed information", async () => {
    const calls = [];
    const attempts = new Map();
    const firstStatuses = { "partial.pt": "partial", "error.pt": "error", "missing.pt": "not_found", "existing.pt": "skipped", "ok.pt": "success" };
    const env = harness(async (url, request) => {
        const payload = JSON.parse(request.body);
        calls.push(payload);
        const count = (attempts.get(payload.lora_name) || 0) + 1;
        attempts.set(payload.lora_name, count);
        const status = count > 1 ? "success" : firstStatuses[payload.lora_name];
        return response({ status, message: status, saved: ["partial", "success"].includes(status) ? ["txt"] : [], data: ["partial", "success"].includes(status) ? { triggerWords: "downloaded words" } : {} });
    });
    const loras = Object.keys(firstStatuses).map(name => ({ name, weight: 0.5, tags: "custom words", enabled: false }));
    const node = new env.Node({ loras, folders: [] });
    await node.showBatchMetadataModal();
    await env.button("开始下载").click();
    assert.equal(calls.length, 5);
    assert.equal(env.button("重试当前范围失败项").disabled, false);
    await env.button("重试当前范围失败项").click();
    assert.deepEqual(calls.slice(5).map(payload => payload.lora_name), ["partial.pt", "error.pt"]);
    assert.ok(calls.every(payload => payload.overwrite === false));
    assert.equal(env.button("重试当前范围失败项").disabled, true);
    assert.match(env.document.body.textContent, /成功3已跳过1未找到1部分完成0失败0/);
    assert.ok(loras.every(lora => lora.weight === 0.5 && lora.tags === "custom words" && lora.enabled === false));
    assert.equal(loras[0].triggerWords, "downloaded words");
    assert.equal(node.renderCount, 2);
    assert.deepEqual(node.refreshedNames, ["partial.pt", "ok.pt", "partial.pt", "error.pt"]);
});

test("focused running window stops through Escape without closing or starting a duplicate queue", async () => {
    let release;
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body).lora_name);
        await new Promise(resolve => { release = resolve; });
        return response({ status: "skipped", message: "Existing", saved: [] });
    });
    const node = new env.Node({ loras: [{ name: "active.pt" }, { name: "later.pt" }], folders: [] });
    await node.showBatchMetadataModal();
    const run = env.button("开始下载").click();
    assert.equal(env.button("关闭").disabled, true);
    assert.equal(env.button("开始下载").disabled, true);
    const search = env.control("搜索文件名或路径…");
    search.focus();
    search.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(env.document.body.children.length, 1);
    assert.equal(env.button("停止后续下载").disabled, true);
    release();
    await run;
    assert.deepEqual(calls, ["active.pt"]);
    assert.match(env.document.body.textContent, /已停止，当前文件已处理完成。/);
    assert.equal(env.button("开始下载").disabled, false);
    env.button("关闭").click();
    assert.equal(env.document.body.children.length, 0);
});

test("all-local scope loads the real file list and no download types disables start", async () => {
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push({ url, request });
        return response({ files: ["local/A.pt", "local/a.pt"] });
    }, undefined, { inventoryFromFetch: true });
    await new env.Node().showBatchMetadataModal();
    assert.equal(calls[0].url, "/ma/lora/list?include_metadata=true");
    assert.equal(env.button("开始下载").disabled, false);
    env.elements().filter(element => element.attrs["data-download-type"]).forEach(checkbox => { checkbox.checked = false; checkbox.onchange(); });
    assert.equal(env.button("开始下载").disabled, true);
    const settings = JSON.parse(env.storage.get("magic_power_lora_fetch_settings"));
    assert.equal(settings.download_txt, false);
    assert.equal(settings.download_log, false);
});

test("written metadata reaches the workflow before preview refresh fails", async () => {
    const env = harness(async () => response({ status: "success", message: "Saved", saved: ["txt"], data: { triggerWords: "new information" } }));
    const lora = { name: "model.pt", tags: "custom", weight: 0.8 };
    const node = new env.Node({ loras: [lora], folders: [] });
    node.renderEmbeddedList = () => { throw new Error("Preview refresh failed"); };
    await node.showBatchMetadataModal();
    await env.button("开始下载").click();
    assert.equal(node.updateCount, 1);
    assert.equal(lora.triggerWords, "new information");
    assert.equal(lora.tags, "custom");
    assert.equal(lora.weight, 0.8);
    assert.equal(env.button("开始下载").disabled, false);
    assert.equal(env.button("重试当前范围失败项").disabled, true);
});

test("physical directory filtering respects recursion, root files and folder boundaries", () => {
    const env = harness();
    const files = ["root.pt", "art/a.pt", "art/deep/b.pt", "artist/c.pt", "Art/d.pt"];
    const settings = { download_txt: true };
    const metadata = { "art/a.pt": { txt: true } };
    const filter = options => env.mplFilterMetadataNames(files, options, settings, metadata);
    assert.deepEqual(filter({ directory: "art", recursive: false }), ["art/a.pt"]);
    assert.deepEqual(filter({ directory: "art", recursive: true }), ["art/a.pt", "art/deep/b.pt"]);
    assert.deepEqual(filter({ directory: ".", recursive: false }), ["root.pt"]);
    assert.deepEqual(filter({ directory: "", recursive: true, search: "DEEP/B" }), ["art/deep/b.pt"]);
    assert.deepEqual(filter({ directory: "art", recursive: true, onlyMissing: true }), ["art/deep/b.pt"]);
});

test("preflight counts only currently visible selected files and selected information types", () => {
    const env = harness();
    const selected = new Set(["a.pt", "hidden/b.pt"]);
    const metadata = { "a.pt": { txt: true, json: false } };
    assert.deepEqual(env.mplMetadataPreflight(["a.pt"], selected, { download_txt: true }, metadata), {
        scoped: 1, selected: 1, need: 0, complete: 1, names: ["a.pt"],
    });
    assert.equal(env.mplMetadataNeeds("a.pt", { download_json: true }, metadata), true);
    assert.equal(env.mplMetadataNeeds("a.pt", { download_txt: false }, metadata), false);
});

test("default library renders complete entries but automatically selects only files needing information", async () => {
    const inventory = { files: ["complete.pt", "missing.pt"], metadata: {
        "complete.pt": { txt: true, json: true, image: true, log: true }, "missing.pt": { txt: false, json: true, image: true, log: true },
    } };
    const env = harness(undefined, undefined, { inventory });
    await new env.Node().showBatchMetadataModal();
    assert.equal(env.control("complete.pt").checked, false);
    assert.equal(env.control("missing.pt").checked, true);
    assert.match(env.document.body.textContent, /当前范围2已勾选1需补全1信息完整0/);
    assert.equal(env.control("本地目录").value, "");
    assert.equal(env.control("处理方式").value, "missing");
    assert.match(env.document.body.textContent, /complete.pt/);
    const onlyMissing = env.control("仅显示缺少所选信息的 LoRA");
    onlyMissing.checked = true;
    onlyMissing.onchange();
    assert.equal(env.control("complete.pt"), undefined);
    assert.equal(env.control("missing.pt").checked, true);
});

test("hidden selections never download and empty visible selection disables start", async () => {
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body).lora_name);
        return response({ status: "skipped", message: "No source", saved: [], unavailable: ["txt"] });
    }, undefined, { inventory: { files: ["folder/visible.pt", "else/hidden.pt"], metadata: {} } });
    await new env.Node().showBatchMetadataModal();
    env.button("选择当前可见项").click();
    const search = env.control("搜索文件名或路径…");
    search.value = "visible.pt";
    search.oninput();
    await env.button("开始下载").click();
    assert.deepEqual(calls, ["folder/visible.pt"]);
    assert.match(env.document.body.textContent, /来源未提供: txt/);
    search.value = "does not exist";
    search.oninput();
    assert.equal(env.button("开始下载").disabled, true);
    assert.equal(env.button("重试当前范围失败项").disabled, true);
});

test("download names freeze when the queue starts", async () => {
    let release;
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body).lora_name);
        if (calls.length === 1) await new Promise(resolve => { release = resolve; });
        return response({ status: "skipped", message: "Existing", saved: [] });
    }, undefined, { inventory: { files: ["first.pt", "second.pt"], metadata: {} } });
    await new env.Node().showBatchMetadataModal();
    const run = env.button("开始下载").click();
    assert.equal(env.button("清空选择").disabled, true);
    env.button("清空选择").onclick();
    release();
    await run;
    assert.deepEqual(calls, ["first.pt", "second.pt"]);
});

test("updating complete information requires confirmation and sends the explicit update contract", async () => {
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body));
        return response({ status: "success", message: "Updated", saved: ["txt"], data: { triggerWords: "downloaded" } });
    }, undefined, { inventory: { files: ["complete.pt"], metadata: { "complete.pt": { txt: true, json: true, image: true, log: true } } } });
    const node = new env.Node({ loras: [{ name: "complete.pt", tags: "custom", weight: 0.8 }], folders: [] });
    await node.showBatchMetadataModal();
    assert.equal(env.button("开始下载").disabled, true);
    const mode = env.control("处理方式");
    mode.value = "update";
    mode.onchange();
    env.button("选择当前可见项").click();
    await env.button("开始下载").click();
    assert.equal(env.confirmPrompts.length, 1);
    assert.match(env.confirmPrompts[0], /所选 LoRA：1/);
    assert.match(env.confirmPrompts[0], /将更新已有信息的 LoRA：1/);
    assert.match(env.confirmPrompts[0], /将更新的已有信息项：4/);
    assert.equal(calls[0].overwrite, true);
    assert.equal(calls[0].update_existing, true);
    assert.equal(node.loraData.loras[0].tags, "custom");
    assert.equal(node.loraData.loras[0].weight, 0.8);
    assert.equal(JSON.parse(env.storage.get("magic_power_lora_fetch_settings")).overwrite, undefined);
});

test("declining the update confirmation makes no download requests", async () => {
    const calls = [];
    const env = harness(async (url, request) => { calls.push(url); return response({ status: "success" }); }, undefined, {
        confirm: () => false, inventory: { files: ["a.pt"], metadata: {} },
    });
    await new env.Node().showBatchMetadataModal();
    env.control("处理方式").value = "update";
    env.control("处理方式").onchange();
    await env.button("开始下载").click();
    assert.deepEqual(calls, []);
    assert.equal(env.confirmPrompts.length, 1);
    assert.equal(env.button("开始下载").disabled, false);
});

test("update retries request only failed types and confirmation reflects that narrower coverage", async () => {
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body));
        return response(calls.length === 1
            ? { status: "partial", message: "Image failed", saved: ["txt"], failed: ["image"], data: { triggerWords: "new" } }
            : { status: "success", message: "Image saved", saved: ["image"], failed: [], data: {} });
    }, { download_txt: true, download_json: false, download_image: true, download_log: false }, {
        inventory: { files: ["a.pt"], metadata: { "a.pt": { txt: true, image: true } } },
    });
    await new env.Node().showBatchMetadataModal();
    const mode = env.control("处理方式");
    mode.value = "update";
    mode.onchange();
    env.button("选择当前可见项").click();
    await env.button("开始下载").click();
    await env.button("重试当前范围失败项").click();
    assert.deepEqual(calls[1].options, { download_txt: false, download_json: false, download_image: true, download_log: false });
    assert.equal(calls[1].overwrite, true);
    assert.equal(calls[1].update_existing, true);
    assert.match(env.confirmPrompts[1], /将更新的已有信息项：1/);
    assert.match(env.confirmPrompts[1], /信息类型：预览图像/);
});

test("library downloads synchronize only metadata fields on every referencing graph node", async () => {
    const env = harness(async () => response({ status: "success", message: "Saved", saved: ["txt"], data: { triggerWords: "new info" } }), undefined, {
        inventory: { files: ["shared.pt"], metadata: {} },
    });
    const owner = new env.Node();
    const first = new env.Node({ loras: [{ name: "shared.pt", tags: "first custom", weight: 0.7, enabled: false }], folders: [] });
    const second = new env.Node({ loras: [], folders: [{ loras: [{ name: "./shared.pt", tags: "second custom", weight: 1.2, enabled: true }] }] });
    const other = new env.Node({ loras: [{ name: "shared.pt", triggerWords: "unchanged" }], folders: [] });
    other.type = "OtherNode";
    await owner.showBatchMetadataModal();
    await env.button("开始下载").click();
    assert.equal(first.loraData.loras[0].triggerWords, "new info");
    assert.equal(second.loraData.folders[0].loras[0].triggerWords, "new info");
    assert.equal(first.loraData.loras[0].tags, "first custom");
    assert.equal(first.loraData.loras[0].weight, 0.7);
    assert.equal(first.loraData.loras[0].enabled, false);
    assert.equal(second.loraData.folders[0].loras[0].tags, "second custom");
    assert.equal(other.loraData.loras[0].triggerWords, "unchanged");
    assert.equal(first.updateCount, 1);
    assert.equal(second.updateCount, 1);
});

test("batch completion refreshes inventory badges and filters without clearing results", async () => {
    const inventory = { files: ["a.pt"], metadata: { "a.pt": { txt: false } } };
    let inventoryReads = 0;
    const env = harness(async (url, request) => {
        if (url.startsWith("/ma/lora/list")) { inventoryReads++; return response(inventory); }
        inventory.metadata["a.pt"].txt = true;
        return response({ status: "success", message: "Saved", saved: ["txt"], data: {} });
    }, { download_txt: true, download_json: false, download_image: false, download_log: false }, { inventoryFromFetch: true });
    await new env.Node().showBatchMetadataModal();
    const missing = env.control("仅显示缺少所选信息的 LoRA");
    missing.checked = true;
    missing.onchange();
    await env.button("开始下载").click();
    assert.equal(inventoryReads, 2);
    assert.equal(env.control("a.pt"), undefined);
    assert.equal(env.button("开始下载").disabled, true);
    assert.match(env.document.body.textContent, /成功1/);
    assert.match(env.document.body.textContent, /Saved/);
    inventory.files.push("new.pt");
    await env.button("刷新列表").click();
    assert.equal(inventoryReads, 3);
    assert.equal(env.control("new.pt").checked, false);
    assert.match(env.document.body.textContent, /Saved/);
});

test("inventory global and per-file errors remain visible", async () => {
    const failed = harness(undefined, undefined, { inventory: { files: [], error: "Local scan failed" } });
    await new failed.Node().showBatchMetadataModal();
    assert.match(failed.document.body.textContent, /Local scan failed/);
    assert.equal(failed.button("开始下载").disabled, true);
    const partial = harness(undefined, undefined, { inventory: { files: ["a.pt"], metadata: {}, errors: [{ path: "a.pt", error: "No permission" }] } });
    await new partial.Node().showBatchMetadataModal();
    assert.match(partial.document.body.textContent, /清单读取异常/);
    assert.match(partial.document.body.textContent, /a.pt: No permission/);
});

test("shared sidecar groups block multi-model updates but allow missing-only and single-member updates", async () => {
    const names = ["same/model.pt", "same/model.safetensors"];
    const shared = Object.fromEntries(names.map(name => [name, names]));
    const calls = [];
    const env = harness(async (url, request) => { calls.push(JSON.parse(request.body)); return response({ status: "skipped", saved: [], message: "No source" }); }, undefined, {
        inventory: { files: names, metadata: {}, shared_info: shared },
    });
    assert.equal(env.mplMetadataHasSharedSelection(names, shared), true);
    assert.equal(env.mplMetadataHasSharedSelection([names[0]], shared), false);
    await new env.Node().showBatchMetadataModal();
    assert.equal(env.button("开始下载").disabled, false);
    const mode = env.control("处理方式");
    mode.value = "update";
    mode.onchange();
    assert.equal(env.button("开始下载").disabled, true);
    assert.match(env.document.body.textContent, /选中项包含共享信息文件的同名模型，请每组只选择一个。/);
    const second = env.control(names[1]);
    second.checked = false;
    second.onchange();
    assert.equal(env.button("开始下载").disabled, false);
    await env.button("开始下载").click();
    assert.deepEqual(calls.map(call => call.lora_name), [names[0]]);
});

test("info manager is a direct modeless window with no full-screen input-consuming overlay", async () => {
    const env = harness();
    await new env.Node().showBatchMetadataModal();
    const dialog = env.elements().find(element => element.attrs.role === "dialog");
    assert.equal(dialog.parentElement, env.document.body);
    assert.equal(dialog.attrs["aria-modal"], "false");
    assert.equal(env.elements().some(element => element.className === "mpl-metadata-overlay"), false);
    assert.equal(env.listeners.has("keydown"), false);
    assert.equal(env.listeners.has("keyup"), false);
    let outsideClicks = 0;
    const outside = env.document.createElement("button");
    outside.onclick = () => { outsideClicks++; };
    env.document.body.appendChild(outside);
    outside.click();
    assert.equal(outsideClicks, 1);
    assert.equal(dialog.isConnected, true);
});

test("Escape belongs to the focused info window and leaves other canvas keyboard handlers alone", async () => {
    const env = harness();
    let graphEscapes = 0;
    const graphKey = event => { if (event.key === "Escape") graphEscapes++; };
    env.document.addEventListener("keydown", graphKey);
    await new env.Node().showBatchMetadataModal();
    const dialog = env.elements().find(element => element.attrs.role === "dialog");
    const canvas = env.document.createElement("div");
    env.document.body.appendChild(canvas);
    canvas.focus();
    const outsideEvent = canvas.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(graphEscapes, 1);
    assert.equal(outsideEvent.defaultPrevented, false);
    assert.equal(dialog.isConnected, true);
    const search = env.control("搜索文件名或路径…");
    search.focus();
    const insideEvent = search.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(insideEvent.defaultPrevented, true);
    assert.equal(insideEvent.cancelBubble, true);
    assert.equal(graphEscapes, 1);
    assert.equal(dialog.isConnected, false);
    assert.equal(env.listeners.get("keydown").has(graphKey), true);
});

test("keyboard shortcuts inside the window never reach the graph but retain native input behavior", async () => {
    const env = harness();
    let graphKeys = 0;
    env.document.addEventListener("keydown", () => { graphKeys++; });
    env.document.addEventListener("keyup", () => { graphKeys++; });
    await new env.Node().showBatchMetadataModal();
    const search = env.control("搜索文件名或路径…");
    search.focus();
    for (const values of [
        { type: "keydown", key: "a", ctrlKey: true },
        { type: "keyup", key: "a", ctrlKey: true },
        { type: "keydown", key: "Delete" },
        { type: "keyup", key: "Delete" },
    ]) {
        const event = search.dispatchEvent(values);
        assert.equal(event.cancelBubble, true);
        assert.equal(event.defaultPrevented, false);
    }
    assert.equal(graphKeys, 0);
    const canvas = env.document.createElement("div");
    env.document.body.appendChild(canvas);
    canvas.focus();
    canvas.dispatchEvent({ type: "keydown", key: "Delete" });
    assert.equal(graphKeys, 1);
});

test("active downloads keep canvas controls usable and outside Escape does not stop the queue", async () => {
    let release;
    const calls = [];
    const env = harness(async (url, request) => {
        calls.push(JSON.parse(request.body).lora_name);
        if (calls.length === 1) await new Promise(resolve => { release = resolve; });
        return response({ status: "skipped", message: "Existing", saved: [] });
    }, undefined, { inventory: { files: ["first.pt", "second.pt"], metadata: {} } });
    await new env.Node().showBatchMetadataModal();
    const run = env.button("开始下载").click();
    let outsideClicks = 0;
    const outside = env.document.createElement("button");
    outside.onclick = () => { outsideClicks++; };
    env.document.body.appendChild(outside);
    outside.focus();
    outside.click();
    outside.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(outsideClicks, 1);
    assert.equal(env.button("停止后续下载").disabled, false);
    assert.equal(env.button("关闭").disabled, true);
    release();
    await run;
    assert.deepEqual(calls, ["first.pt", "second.pt"]);
    assert.equal(env.document.activeElement, outside);
});

test("header close buttons do not start drag and closing removes only this window's drag listeners", async () => {
    const env = harness();
    let outsideMoves = 0;
    const graphMove = () => { outsideMoves++; };
    env.document.addEventListener("mousemove", graphMove);
    await new env.Node().showBatchMetadataModal();
    const dialog = env.elements().find(element => element.attrs.role === "dialog");
    const header = dialog.children[0];
    const headerClose = env.elements(header).find(element => element.tagName === "BUTTON");
    assert.ok(headerClose, "the modeless window has a header close button");
    const originalTransform = dialog.style.transform;
    const down = headerClose.dispatchEvent({ type: "mousedown", clientX: 100, clientY: 100 });
    env.document.dispatchEvent({ type: "mousemove", clientX: 220, clientY: 240 });
    assert.equal(down.defaultPrevented, false);
    assert.equal(dialog.style.transform, originalTransform);
    headerClose.click();
    assert.equal(dialog.isConnected, false);
    assert.equal(env.listeners.get("mousemove").has(graphMove), true);
    assert.equal(env.listeners.get("mousemove").size, 1);
    assert.equal(env.listeners.has("mouseup"), false);
    assert.equal(env.listeners.has("touchmove"), false);
    assert.equal(env.listeners.has("touchend"), false);
    env.document.dispatchEvent({ type: "mousemove", clientX: 330, clientY: 350 });
    assert.equal(outsideMoves, 2);
});

test("modeless dragging uses an explicit viewport origin and removes drag title handlers when closed", async () => {
    const env = harness();
    await new env.Node().showBatchMetadataModal();
    const dialog = env.elements().find(element => element.attrs.role === "dialog");
    const header = dialog.children[0];
    const dragStart = [...header.listeners.get("mousedown")].at(-1);
    const initial = dialog.getBoundingClientRect();
    const start = header.dispatchEvent({ type: "mousedown", clientX: initial.left + 20, clientY: initial.top + 15 });
    assert.equal(start.defaultPrevented, true);
    env.document.dispatchEvent({ type: "mousemove", clientX: initial.left + 120, clientY: initial.top + 75 });
    const expectedX = Math.max(0, Math.min(initial.left + 100, env.window.innerWidth - dialog.offsetWidth));
    const expectedY = Math.max(0, Math.min(initial.top + 60, env.window.innerHeight - dialog.offsetHeight));
    assert.equal(dialog.style.top, "0px");
    assert.equal(dialog.style.left, "0px");
    assert.equal(dialog.style.transform, `translate(${expectedX}px, ${expectedY}px)`);
    env.document.dispatchEvent({ type: "mouseup" });
    env.button("关闭").click();
    assert.equal(header.listeners.get("mousedown")?.has(dragStart) || false, false);
    assert.equal(header.listeners.has("touchstart"), false);
    assert.equal(env.listeners.has("mousemove"), false);
});

test("dragging a direct body child never rewrites the host page's flex layout", async () => {
    const env = harness();
    Object.assign(env.document.body.style, { display: "flex", position: "relative", width: "100vw", height: "100vh", top: "0px", left: "0px" });
    const hostStyle = { ...env.document.body.style };
    await new env.Node().showBatchMetadataModal();
    const dialog = env.elements().find(element => element.attrs.role === "dialog");
    const header = dialog.children[0];
    const initial = dialog.getBoundingClientRect();
    header.dispatchEvent({ type: "mousedown", clientX: initial.left + 10, clientY: initial.top + 10 });
    env.document.dispatchEvent({ type: "mousemove", clientX: initial.left + 50, clientY: initial.top + 50 });
    assert.deepEqual(env.document.body.style, hostStyle);
    env.document.dispatchEvent({ type: "mouseup" });
    env.button("关闭").click();
});
