const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../web/magic_text.js"), "utf8");

function section(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, "editor section exists: " + startMarker);
    return source.slice(start, end);
}

function createEditor() {
    const helpers = section("const DISABLE_PREFIX =", "/** 将指定下标的 tag 片段");
    const segment = section("function magicIsPromptSegmentDelimiter", "/**\n * 计算 textarea 内光标");
    const reconcile = section("    const reconcileEditorTags =", "    // 节点 text 可能在弹窗外被修改");
    const update = section("        function updateStatAndChips", "        function rebuildTagChips");
    const sync = section("        const syncEditorFromTextarea =", "        textarea.addEventListener(\"compositionstart\"");
    const choice = section("    const applyChoice = (it) => {", "    const renderList =");
    const setup = [
        "let editorTags = [], editorText = '', activeTab = 'edit';",
        "const textarea = { _value: '', selectionStart: 0, selectionEnd: 0, _magicComposing: false, get value() { return this._value; }, set value(value) { this._value = value; this.selectionStart = this.selectionEnd = value.length; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }, focus() {} };",
        "const shell = { _magicTagModel: [], _magicLastEditorText: '', _magicLastRawEditorText: '', _magicModelDirty: false };",
        "const node = { properties: {}, setDirtyCanvas() {} }, textWidget = { value: '' };",
        "const tagStrip = { style: {} }, stat = { textContent: '' };",
        "const magicT = x => x, clearChipSelection = () => {}, cancelHideTagFloatBar = () => {}, hideTagFloatBar = () => {}, rebuildTagChips = () => {};",
        "const syncMagicPromptTextWidget = (n, w, v) => { w.value = v; };",
        "const serializeMagicEnabledTags = tags => serializeMagicPromptTags((Array.isArray(tags) ? tags : []).filter(t => t.isNewline || !t.disabled));",
        "const getEditorTags = () => shell._magicTagModel;",
    ].join("\n");
    const controls = [
        "const seed = (raw, tags = parseMagicPromptTags(raw)) => {",
        "  textarea.value = raw;",
        "  textarea.selectionStart = textarea.selectionEnd = raw.length;",
        "  shell._magicTagModel = tags;",
        "  shell._magicLastEditorText = magicEnsureTrailingCommaPerLine(raw);",
        "  shell._magicLastRawEditorText = raw;",
        "};",
        "const key = keyName => {",
        "  let value = textarea.value, caret = textarea.selectionStart, end = textarea.selectionEnd, inputType, data;",
        "  if (keyName === 'Backspace') {",
        "    if (end > caret) value = value.slice(0, caret) + value.slice(end);",
        "    else if (caret > 0) { value = value.slice(0, caret - 1) + value.slice(caret); caret--; }",
        "    inputType = 'deleteContentBackward'; data = null;",
        "  } else {",
        "    data = keyName === 'Enter' ? '\\n' : keyName;",
        "    inputType = keyName === 'Enter' ? 'insertLineBreak' : 'insertText';",
        "    value = value.slice(0, caret) + data + value.slice(end);",
        "    caret += data.length;",
        "  }",
        "  textarea.value = value; textarea.selectionStart = textarea.selectionEnd = caret;",
        "  const event = { inputType, data };",
        "  syncEditorFromTextarea(event);",
        "  syncEditorFromTextarea(event);",
        "  return { value: textarea.value, caret: textarea.selectionStart, tags: shell._magicTagModel };",
        "};",
        "const compose = text => {",
        "  textarea._magicComposing = true;",
        "  const caret = textarea.selectionStart;",
        "  textarea.value = textarea.value.slice(0, caret) + text + textarea.value.slice(caret);",
        "  textarea.selectionStart = textarea.selectionEnd = caret + text.length;",
        "  syncEditorFromTextarea({ inputType: 'insertCompositionText', data: text });",
        "  textarea._magicComposing = false;",
        "  syncEditorFromTextarea({ inputType: 'insertCompositionText', data: text });",
        "};",
        "return { seed, key, compose, applyChoice, textarea, shell, textWidget, getSegmentAtCaret, magicRemoveTrailingCommaFromLastNonEmptyLine };",
    ].join("\n");
    return new Function(
        helpers + "\n" + segment + "\n" + setup + "\n" + reconcile + "\n" +
        update + "\n" + sync + "\n" +
        "const onInput = syncEditorFromTextarea, hide = () => {};\n" +
        choice + "\n" + controls,
    )();
}

test("typing after comma keeps spaces, Chinese text and caret", () => {
    const editor = createEditor();
    editor.seed("");
    for (const character of "tagX, 男孩") {
        const state = editor.key(character);
        assert.equal(state.caret, state.value.length);
    }
    assert.equal(editor.textarea.value, "tagX, 男孩");
    assert.deepEqual(editor.shell._magicTagModel.map(tag => tag.text), ["tagX", "男孩"]);
});

test("a space inside a tag stays editable", () => {
    const editor = createEditor();
    editor.seed("");
    for (const character of "boy girl") editor.key(character);
    assert.equal(editor.textarea.value, "boy girl");
    assert.deepEqual(editor.shell._magicTagModel.map(tag => tag.text), ["boy girl"]);
});

test("composed Chinese text leaves the caret after the final character", () => {
    const editor = createEditor();
    editor.seed("tagX, ");
    editor.compose("男孩");
    assert.equal(editor.textarea.value, "tagX, 男孩");
    assert.equal(editor.textarea.selectionStart, editor.textarea.value.length);
    assert.deepEqual(editor.shell._magicTagModel.map(tag => tag.text), ["tagX", "男孩"]);
});

test("autocomplete reads the Chinese tag after a spaced comma or newline", () => {
    const editor = createEditor();
    for (const value of ["tagX, 男孩", "tagX,\n男孩"]) {
        assert.equal(editor.getSegmentAtCaret(value, value.length).query, "男孩");
    }
});

test("autocomplete in the middle line keeps the caret in that line", () => {
    const editor = createEditor();
    editor.seed("first,\ntagX, 男孩,\nlast,");
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "first,\ntagX, 男孩".length;
    editor.applyChoice({ en: "boy" });
    assert.equal(editor.textarea.value, "first,\ntagX, boy,\nlast,");
    assert.equal(editor.textarea.selectionStart, "first,\ntagX, boy".length);
    assert.equal(editor.textarea.selectionEnd, editor.textarea.selectionStart);
});

test("autocomplete in the middle line retains disabled tags", () => {
    const editor = createEditor();
    editor.seed("first,\ntagX, 男孩,\nlast,", [
        { isNewline: false, text: "first", disabled: false },
        { isNewline: true },
        { isNewline: false, text: "tagX", disabled: false },
        { isNewline: false, text: "hidden", disabled: true },
        { isNewline: false, text: "男孩", disabled: false },
        { isNewline: true },
        { isNewline: false, text: "last", disabled: false },
    ]);
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "first,\ntagX, 男孩".length;
    editor.applyChoice({ en: "boy" });
    assert.equal(editor.textarea.value, "first,\ntagX, boy,\nlast,");
    assert.equal(editor.textarea.selectionStart, "first,\ntagX, boy".length);
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => tag.disabled).map(tag => tag.text),
        ["hidden"],
    );
});

test("multi-tag autocomplete in the middle line keeps its caret", () => {
    const editor = createEditor();
    editor.seed("first,\ntagX, 男孩,\nlast,");
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "first,\ntagX, 男孩".length;
    editor.applyChoice({ en: "boy, smiling" });
    assert.equal(editor.textarea.value, "first,\ntagX, boy, smiling,\nlast,");
    assert.equal(editor.textarea.selectionStart, "first,\ntagX, boy, smiling".length);
});

test("multi-tag autocomplete retains neighboring disabled tags", () => {
    const editor = createEditor();
    editor.seed("first,\ntagX, 男孩,\nlast,", [
        { isNewline: false, text: "first", disabled: false },
        { isNewline: true },
        { isNewline: false, text: "tagX", disabled: false },
        { isNewline: false, text: "hidden", disabled: true },
        { isNewline: false, text: "男孩", disabled: false },
        { isNewline: true },
        { isNewline: false, text: "last", disabled: false },
    ]);
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "first,\ntagX, 男孩".length;
    editor.applyChoice({ en: "boy, smiling" });
    assert.equal(editor.textarea.value, "first,\ntagX, boy, smiling,\nlast,");
    assert.equal(editor.textarea.selectionStart, "first,\ntagX, boy, smiling".length);
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => tag.disabled).map(tag => tag.text),
        ["hidden"],
    );
});

test("Enter creates one newline and Backspace removes every character", () => {
    const editor = createEditor();
    editor.seed("");
    for (const character of "tagX,") editor.key(character);
    editor.key("Enter");
    for (const character of "男孩") editor.key(character);
    assert.equal(editor.textarea.value, "tagX,\n男孩");
    assert.equal(editor.textarea.selectionStart, editor.textarea.value.length);
    while (editor.textarea.value.length) {
        const previousLength = editor.textarea.value.length;
        editor.key("Backspace");
        assert.equal(editor.textarea.value.length, previousLength - 1);
    }
    assert.equal(editor.textarea.value, "");
    assert.equal(editor.shell._magicTagModel.length, 0);
});

test("deleting a tag before its comma does not resurrect the tag", () => {
    const editor = createEditor();
    editor.seed("boy,");
    editor.textarea.selectionStart = editor.textarea.selectionEnd = 3;
    for (let i = 0; i < 3; i++) editor.key("Backspace");
    assert.equal(editor.textarea.value, ",");
    assert.equal(editor.shell._magicTagModel.length, 0);
});

test("replacing a selected tag with a delimiter removes the old chip", () => {
    const editor = createEditor();
    editor.seed("boy");
    editor.textarea.selectionStart = 0;
    editor.textarea.selectionEnd = 3;
    editor.key(",");
    assert.equal(editor.textarea.value, ",");
    assert.equal(editor.shell._magicTagModel.length, 0);
});

test("editing a visible tag retains disabled tags", () => {
    const editor = createEditor();
    editor.seed("alpha, gamma,", [
        { isNewline: false, text: "alpha", disabled: false },
        { isNewline: false, text: "beta", disabled: true },
        { isNewline: false, text: "gamma", disabled: false },
    ]);
    editor.key("x");
    editor.key("Backspace");
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => tag.disabled).map(tag => tag.text),
        ["beta"],
    );
});

test("deleting a newline retains disabled tags and does not add another newline", () => {
    const editor = createEditor();
    editor.seed("alpha,\ngamma,", [
        { isNewline: false, text: "alpha", disabled: false },
        { isNewline: false, text: "beta", disabled: true },
        { isNewline: true },
        { isNewline: false, text: "gamma", disabled: false },
    ]);
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "alpha,\n".length;
    editor.key("Backspace");
    assert.equal(editor.textarea.value, "alpha,gamma,");
    assert.equal(editor.shell._magicTagModel.filter(tag => tag.isNewline).length, 0);
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => tag.disabled).map(tag => tag.text),
        ["beta"],
    );
});

test("inserting a newline retains disabled tags", () => {
    const editor = createEditor();
    editor.seed("alpha, gamma,", [
        { isNewline: false, text: "alpha", disabled: false },
        { isNewline: false, text: "beta", disabled: true },
        { isNewline: false, text: "gamma", disabled: false },
    ]);
    editor.textarea.selectionStart = editor.textarea.selectionEnd = "alpha, ".length;
    editor.key("Enter");
    assert.equal(editor.textarea.value, "alpha, \ngamma,");
    assert.equal(editor.shell._magicTagModel.filter(tag => tag.isNewline).length, 1);
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => tag.disabled).map(tag => tag.text),
        ["beta"],
    );
});

test("replacing all visible text with an unrelated tag drops old disabled tags", () => {
    const editor = createEditor();
    editor.seed("alpha, gamma,", [
        { isNewline: false, text: "alpha", disabled: false },
        { isNewline: false, text: "beta", disabled: true },
        { isNewline: false, text: "gamma", disabled: false },
    ]);
    editor.textarea.selectionStart = 0;
    editor.textarea.selectionEnd = editor.textarea.value.length;
    editor.key("z");
    assert.equal(editor.textarea.value, "z");
    assert.deepEqual(
        editor.shell._magicTagModel.filter(tag => !tag.isNewline).map(tag => tag.text),
        ["z"],
    );
});

test("closing removes only the last nonempty line comma", () => {
    const editor = createEditor();
    assert.equal(
        editor.magicRemoveTrailingCommaFromLastNonEmptyLine("first,\nsecond,\n"),
        "first,\nsecond\n",
    );
    assert.equal(
        editor.magicRemoveTrailingCommaFromLastNonEmptyLine("first,\nsecond，"),
        "first,\nsecond，",
    );
    assert.equal(
        editor.magicRemoveTrailingCommaFromLastNonEmptyLine("first,\nsecond,  \n  "),
        "first,\nsecond  \n  ",
    );
});
