// Content script for the message pane: adds a collapsible block above the
// message with the collected text of its whole thread.
(() => {
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
    details {
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
    .title.error { color: var(--error); }
    button { font: inherit; }
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
    <details>
      <summary><span class="title">Цепочка: собираю…</span><button type="button" hidden>Копировать</button></summary>
      <pre></pre>
    </details>
  `;
  const title = root.querySelector(".title");
  const copy = root.querySelector("button");
  const output = root.querySelector("pre");

  copy.addEventListener("click", async (event) => {
    event.preventDefault(); // keep <details> from toggling
    try {
      await navigator.clipboard.writeText(output.textContent);
      copy.textContent = "Скопировано";
    } catch {
      // Clipboard may be unavailable here; select the text for Ctrl+C.
      root.querySelector("details").open = true;
      getSelection().selectAllChildren(output);
      copy.textContent = "Выделено, нажмите Ctrl+C";
    }
  });

  document.body.prepend(host);

  browser.runtime.sendMessage({ type: "getThreadText" }).then(
    ({ count, text }) => {
      title.textContent = `Цепочка: писем ${count}, символов ${text.length}`;
      output.textContent = text;
      copy.hidden = false;
    },
    (e) => {
      title.textContent = `Цепочка: ошибка — ${e.message}`;
      title.classList.add("error");
    },
  );
})();
