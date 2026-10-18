// Content script for the message pane: adds a block above the message with
// the client's address, the model's analysis of the whole thread and, for
// debugging, the thread text. Rendering comes from render.js, injected
// before this script.
(() => {
  const { STYLE, badge, render } = globalThis.AnalysisView;

  const BLOCK_STYLE = `
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
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #262a31;
        --fg: #e6edf3;
        --muted: #9198a1;
        --border: #3d444d;
        --error: #ff7b72;
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
    button { font: inherit; }
    .clients {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      padding: 6px 10px;
      border-top: 1px solid var(--border);
    }
    .clients:empty { display: none; }
    .email { font-family: monospace; font-size: 13px; user-select: all; }
    .analysis { padding: 0 10px 8px; }
    .analysis:empty { display: none; }
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
    <style>${STYLE}${BLOCK_STYLE}</style>
    <details class="card" open>
      <summary>
        <span class="badge-slot"></span>
        <span class="title">Собираю цепочку…</span>
        <button type="button" class="analyze" hidden>Анализировать</button>
      </summary>
      <div class="clients"></div>
      <div class="analysis"></div>
      <details class="raw" hidden>
        <summary><span class="title">Текст цепочки (отладка)</span><button type="button" class="copy">Копировать</button></summary>
        <pre></pre>
      </details>
    </details>
  `;
  const badgeSlot = root.querySelector(".badge-slot");
  const title = root.querySelector(".title");
  const analyzeButton = root.querySelector(".analyze");
  const clients = root.querySelector(".clients");
  const analysisBox = root.querySelector(".analysis");
  const raw = root.querySelector(".raw");
  const copy = root.querySelector(".copy");
  const output = root.querySelector("pre");

  let threadText = "";
  let threadSummary = "";

  // Copies text; if the clipboard is unavailable here, selects the node so
  // Ctrl+C works.
  async function copyText(button, text, node) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Скопировано";
    } catch {
      getSelection().selectAllChildren(node);
      button.textContent = "Выделено, нажмите Ctrl+C";
    }
  }

  function showClients(emails) {
    clients.replaceChildren();
    for (const email of emails) {
      const address = document.createElement("span");
      address.className = "email";
      address.textContent = email;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Копировать";
      button.addEventListener("click", () => copyText(button, email, address));
      const item = document.createElement("span");
      item.append("Клиент: ", address, " ", button);
      clients.append(item);
    }
  }

  function setTitle(text, isError = false) {
    title.textContent = text;
    title.classList.toggle("error", isError);
  }

  function showAnalysis(analysis) {
    badgeSlot.replaceChildren(badge(analysis.state));
    setTitle(threadSummary);
    analysisBox.replaceChildren(render(analysis));
    analyzeButton.textContent = "Обновить";
    analyzeButton.hidden = false;
  }

  async function analyze(force) {
    analyzeButton.hidden = true;
    setTitle(`${threadSummary} — анализирую…`);
    try {
      showAnalysis(await browser.runtime.sendMessage({ type: "analyzeThread", text: threadText, force }));
    } catch (e) {
      setTitle(`${threadSummary} — ошибка анализа: ${e.message}`, true);
      analyzeButton.textContent = "Повторить";
      analyzeButton.hidden = false;
    }
  }

  // Collects the thread (force: search folders again instead of using the
  // remembered thread) and analyzes it if asked to.
  async function load(force, analyzeAfter) {
    setTitle("Собираю цепочку…");
    analyzeButton.hidden = true;
    try {
      const thread = await browser.runtime.sendMessage({ type: "getThread", force });
      threadText = thread.text;
      threadSummary = `Цепочка: писем ${thread.count}`;
      output.textContent = thread.text;
      raw.hidden = false;
      showClients(thread.clientEmails);
      setTitle(threadSummary);
      if (analyzeAfter ?? thread.autoAnalyze) {
        await analyze(force);
      } else {
        analyzeButton.hidden = false;
      }
    } catch (e) {
      setTitle(`Цепочка: ошибка — ${e.message}`, true);
    }
  }

  analyzeButton.addEventListener("click", (event) => {
    event.preventDefault(); // keep <details> from toggling
    const refresh = analysisBox.childElementCount > 0;
    if (refresh) {
      load(true, true);
    } else {
      analyze(false);
    }
  });

  copy.addEventListener("click", (event) => {
    event.preventDefault();
    raw.open = true;
    copyText(copy, output.textContent, output);
  });

  document.body.prepend(host);
  load(false);
})();
