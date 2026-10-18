// Content script for the message pane: adds a block above the message with
// the model's analysis of the whole thread and, for debugging, its raw text.
(() => {
  // Same as STATES in lib/analyze.js; content scripts can't import modules.
  const STATES = {
    no_reply: "Ещё не ответили",
    waiting_us: "Ход за нами",
    waiting_client: "Ждём клиента",
    resolved: "Решено",
  };

  const STYLE = `
    :host {
      all: initial;
      display: block;
      margin: 8px;
      font: message-box;
      font-size: 13px;
      --bg: #f6f8fa;
      --fg: #1f2328;
      --muted: #59636e;
      --border: #d1d9e0;
      --error: #cf222e;
      --link: #0969da;
      --no_reply: #cf222e;
      --waiting_us: #bc4c00;
      --waiting_client: #0969da;
      --resolved: #1a7f37;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #262a31;
        --fg: #e6edf3;
        --muted: #9198a1;
        --border: #3d444d;
        --error: #ff7b72;
        --link: #4493f8;
        --no_reply: #ff7b72;
        --waiting_us: #f0883e;
        --waiting_client: #4493f8;
        --resolved: #3fb950;
      }
    }
    .card {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      user-select: none;
    }
    .title { flex: 1; }
    .error { color: var(--error); }
    .badge {
      padding: 1px 8px;
      border-radius: 10px;
      color: #fff;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge[hidden] { display: none; }
    button { font: inherit; }
    .analysis {
      padding: 4px 10px 8px;
      border-top: 1px solid var(--border);
    }
    .analysis:empty { display: none; }
    h4 {
      margin: 10px 0 2px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--muted);
    }
    p { margin: 0; white-space: pre-wrap; }
    .next { font-weight: 600; }
    ul { margin: 0; padding-left: 18px; }
    a { color: var(--link); word-break: break-all; }
    .meta { margin-top: 10px; color: var(--muted); font-size: 11px; }
    .raw { border-top: 1px solid var(--border); }
    .raw summary { color: var(--muted); }
    pre {
      margin: 0;
      padding: 8px 10px;
      border-top: 1px solid var(--border);
      max-height: 50vh;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: monospace;
      font-size: 12px;
    }
  `;

  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>${STYLE}</style>
    <details class="card" open>
      <summary>
        <span class="badge" hidden></span>
        <span class="title">Собираю цепочку…</span>
        <button type="button" class="analyze" hidden>Анализировать</button>
      </summary>
      <div class="analysis"></div>
      <details class="raw" hidden>
        <summary><span class="title">Текст цепочки (отладка)</span><button type="button" class="copy">Копировать</button></summary>
        <pre></pre>
      </details>
    </details>
  `;
  const badge = root.querySelector(".badge");
  const title = root.querySelector(".title");
  const analyzeButton = root.querySelector(".analyze");
  const analysisBox = root.querySelector(".analysis");
  const raw = root.querySelector(".raw");
  const copy = root.querySelector(".copy");
  const output = root.querySelector("pre");

  let threadText = "";
  let threadSummary = "";

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  // Fact value as a link if it is a web address; model output is untrusted,
  // so only http(s) becomes a link and everything goes in as text.
  function factValue(value) {
    if (!/^https?:\/\/\S+$/i.test(value)) return el("span", value);
    const link = el("a", value);
    link.href = value;
    return link;
  }

  function section(heading, ...content) {
    return [el("h4", heading), ...content];
  }

  function showAnalysis(a) {
    badge.textContent = STATES[a.state];
    badge.style.background = `var(--${a.state})`;
    badge.hidden = false;
    title.textContent = threadSummary;
    title.classList.remove("error");
    analyzeButton.textContent = "Обновить анализ";
    analyzeButton.hidden = false;

    const facts = el("ul");
    for (const f of a.facts) {
      const item = el("li");
      item.append(f.name ? `${f.name}: ` : "", factValue(f.value));
      facts.append(item);
    }
    analysisBox.replaceChildren(
      ...section("Вопрос решён", el("p", a.resolved ? "Да" : "Нет")),
      ...section("Что хочет клиент", el("p", a.clientRequest || "—")),
      ...(a.facts.length ? section("Факты", facts) : []),
      ...section("Что мы ответили", el("p", a.ourReplies || "Ещё не отвечали")),
      ...section("Что сделать сейчас", el("p", a.nextAction || "—", "next")),
      el(
        "div",
        [a.clientLanguage && `Язык клиента: ${a.clientLanguage}`, a.fromCache && "из памяти"].filter(Boolean).join(" · "),
        "meta",
      ),
    );
  }

  function showError(text) {
    title.textContent = text;
    title.classList.add("error");
  }

  async function analyze(force) {
    analyzeButton.hidden = true;
    title.textContent = `${threadSummary} — анализирую…`;
    title.classList.remove("error");
    try {
      showAnalysis(await browser.runtime.sendMessage({ type: "analyzeThread", text: threadText, force }));
    } catch (e) {
      showError(`${threadSummary} — ошибка анализа: ${e.message}`);
      analyzeButton.textContent = "Повторить";
      analyzeButton.hidden = false;
    }
  }

  analyzeButton.addEventListener("click", (event) => {
    event.preventDefault(); // keep <details> from toggling
    analyze(analysisBox.childElementCount > 0);
  });

  copy.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(output.textContent);
      copy.textContent = "Скопировано";
    } catch {
      // Clipboard may be unavailable here; select the text for Ctrl+C.
      raw.open = true;
      getSelection().selectAllChildren(output);
      copy.textContent = "Выделено, нажмите Ctrl+C";
    }
  });

  document.body.prepend(host);

  browser.runtime.sendMessage({ type: "getThreadText" }).then(
    ({ count, text, autoAnalyze }) => {
      threadText = text;
      threadSummary = `Цепочка: писем ${count}`;
      output.textContent = text;
      raw.hidden = false;
      title.textContent = threadSummary;
      if (autoAnalyze) {
        analyze(false);
      } else {
        analyzeButton.hidden = false;
      }
    },
    (e) => showError(`Цепочка: ошибка — ${e.message}`),
  );
})();
