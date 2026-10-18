// Rendering a thread analysis (see normalizeAnalysis in lib/analyze.js).
// A classic script, not a module: it is shared by the message pane content
// script (where modules can't be imported) and the viewer page, and exposes
// globalThis.AnalysisView.
(() => {
  // Same as STATES in lib/analyze.js.
  const STATES = {
    no_reply: "Ещё не ответили",
    waiting_us: "Ход за нами",
    waiting_client: "Ждём клиента",
    resolved: "Решено",
  };

  const STYLE = `
    .av,
    .av-badge {
      --av-fg: #1f2328;
      --av-muted: #59636e;
      --av-border: #d1d9e0;
      --av-link: #0969da;
      --av-open: #cf222e;
      --av-done: #1a7f37;
      --no_reply: #cf222e;
      --waiting_us: #bc4c00;
      --waiting_client: #0969da;
      --resolved: #1a7f37;
    }
    .av { color: var(--av-fg); }
    @media (prefers-color-scheme: dark) {
      .av,
      .av-badge {
        --av-fg: #e6edf3;
        --av-muted: #9198a1;
        --av-border: #3d444d;
        --av-link: #4493f8;
        --av-open: #ff7b72;
        --av-done: #3fb950;
        --no_reply: #ff7b72;
        --waiting_us: #f0883e;
        --waiting_client: #4493f8;
        --resolved: #3fb950;
      }
    }
    .av-badge {
      padding: 1px 8px;
      border-radius: 10px;
      color: #fff;
      font-weight: 600;
      white-space: nowrap;
    }
    .av h4 {
      margin: 10px 0 2px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--av-muted);
    }
    .av p { margin: 0; white-space: pre-wrap; }
    .av .av-next { font-weight: 600; }
    .av ul { margin: 0; padding-left: 18px; }
    .av a { color: var(--av-link); word-break: break-all; }
    .av-issue {
      margin-top: 6px;
      padding-left: 8px;
      border-left: 3px solid var(--av-open);
    }
    .av-issue.done { border-left-color: var(--av-done); }
    .av-issue-title { font-weight: 600; }
    .av-issue .av-label { color: var(--av-muted); }
    .av-meta { margin-top: 10px; color: var(--av-muted); font-size: 11px; }
  `;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  // Fact value as a link if it is a web address. Model output is untrusted:
  // everything goes in as text, and only http(s) becomes a link.
  function factValue(value) {
    if (!/^https?:\/\/\S+$/i.test(value)) return el("span", value);
    const link = el("a", value);
    link.href = value;
    return link;
  }

  function badge(state) {
    const node = el("span", STATES[state] ?? state, "av-badge");
    node.style.background = `var(--${state})`;
    return node;
  }

  function line(label, value) {
    const p = el("p");
    p.append(el("span", `${label}: `, "av-label"), value);
    return p;
  }

  function issueBlock(issue) {
    const block = el("div", undefined, issue.resolved ? "av-issue done" : "av-issue");
    block.append(el("div", `${issue.resolved ? "✓ Решён" : "● Открыт"} — ${issue.title}`, "av-issue-title"));
    if (issue.clientRequest) block.append(line("Клиент", issue.clientRequest));
    block.append(line("Мы", issue.ourReply || "ещё не отвечали"));
    if (!issue.resolved && issue.nextAction) block.append(line("Сделать", issue.nextAction));
    return block;
  }

  // Analysis body without the badge, as a container element.
  function render(a) {
    const root = el("div", undefined, "av");
    if (a.nextAction) root.append(el("h4", "Что сделать сейчас"), el("p", a.nextAction, "av-next"));
    if (a.summary) root.append(el("h4", "Суть"), el("p", a.summary));
    if (a.issues.length) {
      const open = a.issues.filter((i) => !i.resolved).length;
      root.append(el("h4", `Вопросы: открытых ${open} из ${a.issues.length}`), ...a.issues.map(issueBlock));
    }
    if (a.facts.length) {
      const list = el("ul");
      for (const f of a.facts) {
        const item = el("li");
        item.append(f.name ? `${f.name}: ` : "", factValue(f.value));
        list.append(item);
      }
      root.append(el("h4", "Факты"), list);
    }
    const meta = [a.clientLanguage && `Язык клиента: ${a.clientLanguage}`, a.fromCache && "из памяти"];
    root.append(el("div", meta.filter(Boolean).join(" · "), "av-meta"));
    return root;
  }

  globalThis.AnalysisView = { STATES, STYLE, badge, render };
})();
