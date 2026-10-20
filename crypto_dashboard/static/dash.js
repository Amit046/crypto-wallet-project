(function () {
  "use strict";

  // ------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));
  const pct = (x, d = 0) => (x == null || isNaN(x) ? "n/a" : (Number(x) * 100).toFixed(d) + "%");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const lkey = (l) => ({ "1": "illicit", "2": "licit" }[String(l)] || "unlabeled");
  const lname = (l) => ({ "1": "Known illicit", "2": "Known licit" }[String(l)] || "Unlabeled");
  const known = (l) => String(l) === "1" || String(l) === "2";

  async function api(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " -> " + r.status);
    return r.json();
  }

  // ------------------------------------------------------------ no data yet
  if (!BOOT.has_data) {
    $("empty").hidden = false;
    $("empty-path").textContent = BOOT.out_dir;
    document.querySelector(".tabs").hidden = true;
    return;
  }
  $("app").hidden = false;

  const state = {
    view: "tx", page: 1, pages: 1, selTx: null, depth: 2,
    cPage: 1, cPages: 1, selCl: null, clLoaded: false,
    summary: null, modelDrawn: false, nets: {},
  };

  // ------------------------------------------------------------ tags and small widgets
  function verdictOf(row) {
    const flagged = row.pred === 1;
    if (flagged) {
      if (row.label === "1") return { text: "Caught", cls: "licit" };
      if (row.label === "2") return { text: "False alarm", cls: "flag" };
      return { text: "Flagged", cls: "flag" };
    }
    if (row.label === "1") return { text: "Missed", cls: "flag" };
    if (row.label === "2") return { text: "Correct", cls: "licit" };
    return { text: "Not flagged", cls: "ok" };
  }
  const tag = (text, cls) => el("span", "tag " + cls, text);

  function riskBar(risk) {
    const w = el("div", "riskbar");
    const track = el("div", "track");
    const fill = el("div", "fill" + (risk >= 0.5 ? " hot" : ""));
    fill.style.width = Math.max(1, Math.round(risk * 100)) + "%";
    track.append(fill);
    w.append(track, el("b", null, pct(risk)));
    return w;
  }

  function compoBar(c, wide) {
    const w = el("div", "compo" + (wide ? " wide" : ""));
    [["illicit", c.illicit], ["licit", c.licit], ["unlabeled", c.unlabeled]].forEach(([k, v]) => {
      const i = el("i", "c-" + k);
      i.style.width = (c.size ? (v / c.size) * 100 : 0) + "%";
      i.title = `${k}: ${fmt(v)}`;
      w.append(i);
    });
    return w;
  }

  // ------------------------------------------------------------ key numbers and pipeline strip
  function renderKpis(s) {
    const items = [
      [fmt(s.transactions), "Transactions analysed", `time steps ${s.min_step} to ${s.max_step}`],
      [fmt(s.known_illicit), "Known illicit", `${fmt(s.known_licit)} known licit`],
      [fmt(s.flagged_unlabeled), "Unlabeled, flagged by the model", `out of ${fmt(s.unlabeled)} unlabeled`],
      [fmt(s.clusters), "Clusters found by GraphX", `${fmt(s.clusters_with_illicit)} contain a known illicit one`],
      [fmt(s.links), "Payment links", `${s.avg_degree.toFixed(1)} links per transaction on average`],
    ];
    $("kpis").replaceChildren(...items.map(([v, n, d]) => {
      const k = el("div", "kpi");
      k.append(el("div", "v", v), el("div", "n", n), el("div", "d", d));
      return k;
    }));
  }

  function renderPipeline(s) {
    const P = BOOT.pipeline || {};
    const steps = [
      ["Spark SQL (CO5)", P.rows ? `${fmt(P.rows)} transactions loaded and joined with their labels` : "Loads the data and joins it with the labels"],
      ["MLlib (CO4)", P.recall != null ? `Logistic Regression: ${pct(P.recall)} recall, ${pct(P.precision)} precision on held-out data` : "Trains a classifier on the labeled transactions"],
      ["GraphX (CO6)", `${fmt(s.transactions)} transactions, ${fmt(s.links)} links, ${fmt(s.clusters)} clusters`],
      ["Combined", "Every transaction gets a risk score, its links and its cluster. Explore them below."],
    ];
    const nodes = [];
    steps.forEach(([t, d], i) => {
      if (i) nodes.push(el("div", "link"));
      const st = el("div", "step");
      st.append(el("b", null, t), el("span", null, d));
      nodes.push(st);
    });
    $("pipeline").replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ views and routing
  function setView(v) {
    state.view = v;
    document.querySelectorAll(".tabs button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.view === v)));
    ["tx", "clusters", "model"].forEach((k) => { $("view-" + k).hidden = k !== v; });
    if (v === "clusters" && !state.clLoaded) loadClusters();
    if (v === "model" && !state.modelDrawn) drawModel();
  }

  function setHash(h) { history.replaceState(null, "", h); }

  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    const v = parts[0] === "clusters" ? "clusters" : parts[0] === "model" ? "model" : "tx";
    setView(v);
    if (v === "tx" && parts[1]) selectTx(parts[1]);
    if (v === "clusters" && parts[1]) selectCluster(parts[1]);
  }

  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      setView(b.dataset.view);
      setHash("#/" + b.dataset.view + (b.dataset.view === "tx" && state.selTx ? "/" + state.selTx : ""));
    }));
  window.addEventListener("hashchange", route);

  // ------------------------------------------------------------ transactions list
  async function loadList() {
    const p = new URLSearchParams({
      q: $("q").value.trim(), label: $("f-label").value, flag: $("f-flag").value,
      sort: $("f-sort").value, order: "desc", page: state.page, size: 25,
    });
    const d = await api("/api/transactions?" + p);
    state.page = d.page;
    state.pages = d.pages;
    const body = $("tx-table").tBodies[0];
    if (!d.rows.length) {
      const tr = el("tr", "empty-row");
      const td = el("td", null, "No transactions match these filters.");
      td.colSpan = 6;
      tr.append(td);
      body.replaceChildren(tr);
    } else {
      body.replaceChildren(...d.rows.map((r) => {
        const tr = el("tr");
        tr.dataset.id = r.id;
        if (r.id === state.selTx) tr.className = "sel";
        const v = verdictOf(r);
        const cells = [el("td", "id", r.id), el("td", "num", String(r.step)), el("td"), el("td"), el("td"), el("td", "num", String(r.deg))];
        cells[2].append(tag(lname(r.label), lkey(r.label)));
        cells[3].append(riskBar(r.risk));
        cells[4].append(tag(v.text, v.cls));
        tr.append(...cells);
        tr.addEventListener("click", () => selectTx(r.id));
        return tr;
      }));
    }
    $("page-info").textContent = `Page ${d.page} of ${d.pages}, ${fmt(d.total)} transactions`;
    $("prev").disabled = d.page <= 1;
    $("next").disabled = d.page >= d.pages;
    return d;
  }

  let typing;
  $("q").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => { state.page = 1; loadList(); }, 250); });
  ["f-label", "f-flag", "f-sort"].forEach((id) => $(id).addEventListener("change", () => { state.page = 1; loadList(); }));
  $("prev").addEventListener("click", () => { state.page -= 1; loadList(); });
  $("next").addEventListener("click", () => { state.page += 1; loadList(); });

  async function quickPick(label, flag, sort) {
    $("q").value = "";
    $("f-label").value = label;
    $("f-flag").value = flag;
    $("f-sort").value = sort;
    state.page = 1;
    const d = await loadList();
    if (d.rows.length) selectTx(d.rows[0].id);
  }
  $("qp-flagged").addEventListener("click", () => quickPick("unknown", "1", "risk"));
  $("qp-illicit").addEventListener("click", () => quickPick("1", "all", "deg"));
  $("qp-missed").addEventListener("click", () => quickPick("1", "0", "risk"));
  $("qp-hub").addEventListener("click", () => quickPick("all", "all", "deg"));

  // ------------------------------------------------------------ the network picture
  function drawGraph(containerId, graph, onSelect, tall) {
    const box = $(containerId);
    if (state.nets[containerId]) { state.nets[containerId].destroy(); delete state.nets[containerId]; }
    if (!window.vis) { box.textContent = "Graph library not loaded."; return; }
    const ink = css("--ink");

    const nodes = graph.nodes.map((n) => {
      const fill = css("--" + lkey(n.label));
      const flagged = n.pred === 1;
      return {
        id: n.id,
        label: n.center ? String(n.id) : undefined,
        shape: flagged ? "diamond" : "dot",
        size: n.center ? 24 : Math.min(9 + Math.sqrt(n.deg) * 1.6, 20) + (flagged ? 2 : 0),
        borderWidth: n.center ? 4 : 1,
        color: {
          background: fill, border: n.center ? ink : fill,
          highlight: { background: fill, border: ink }, hover: { background: fill, border: ink },
        },
        font: { size: 14, color: ink, face: "IBM Plex Sans", strokeWidth: 4, strokeColor: "#ffffff" },
        title: `Transaction ${n.id}\n${lname(n.label)}\nModel risk ${pct(n.risk)}${flagged ? " (flagged)" : ""}\n${n.deg} links`,
      };
    });
    const edges = graph.edges.map((e, i) => ({ id: i, from: e.from, to: e.to }));
    const net = new vis.Network(box, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, {
      nodes: { shape: "dot" },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.45 } },
        color: { color: css("--line-strong"), highlight: ink },
        width: 1.2, smooth: false,
      },
      physics: {
        solver: "barnesHut",
        barnesHut: { gravitationalConstant: -3200, springLength: 80, springConstant: 0.04, avoidOverlap: 0.2 },
        stabilization: { iterations: 180 },
      },
      interaction: { hover: true, tooltipDelay: 120 },
    });
    net.once("stabilizationIterationsDone", () => {
      net.setOptions({ physics: false });
      net.fit({ animation: false });
    });
    net.on("click", (p) => { if (p.nodes.length) onSelect(String(p.nodes[0])); });
    state.nets[containerId] = net;
  }

  function legend(withCenter) {
    const l = el("div", "legend");
    [["illicit", "Known illicit"], ["licit", "Known licit"], ["unlabeled", "Unlabeled"]].forEach(([k, t]) => {
      const key = el("span", "key");
      key.append(el("i", "dot " + k), document.createTextNode(t));
      l.append(key);
    });
    const ring = el("span", "key");
    ring.append(el("i", "dot diamond"), document.createTextNode("Diamond: the model flags it as illicit"));
    l.append(ring);
    if (withCenter) {
      const c = el("span", "key");
      c.append(el("i", "dot center"), document.createTextNode("Outlined: the one you opened"));
      l.append(c);
    }
    return l;
  }

  // ------------------------------------------------------------ transaction detail
  async function selectTx(id) {
    state.selTx = id;
    setHash("#/tx/" + id);
    document.querySelectorAll("#tx-table tbody tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.id === id));
    let d;
    try {
      d = await api(`/api/tx/${encodeURIComponent(id)}?depth=${state.depth}`);
    } catch (e) {
      $("tx-detail").replaceChildren(el("div", "placeholder"));
      $("tx-detail").firstChild.append(el("h2", null, "Transaction not found"), el("p", null, `No transaction with ID ${id} in this data.`));
      return;
    }
    renderDetail(d);
  }

  function renderDetail(d) {
    const t = d.tx, c = d.cluster || {};
    const box = $("tx-detail");
    const v = verdictOf(t);

    const head = el("div", "d-head");
    const tags = el("div", "tags");
    tags.append(tag(lname(t.label), lkey(t.label)), tag(v.text, v.cls));
    head.append(el("h2", null, "Transaction " + t.id), tags);

    // risk gauge
    const gauge = el("div", "gauge");
    gauge.append(el("div", "big", pct(t.risk)), el("div", "cap", "Model risk: probability that this transaction is illicit"));
    const track = el("div", "track");
    const fill = el("div", "fill" + (t.risk >= 0.5 ? " hot" : ""));
    fill.style.width = Math.max(1, Math.round(t.risk * 100)) + "%";
    track.append(fill, el("i", "thresh"));
    const scale = el("div", "scale");
    scale.append(el("span", null, "0%"), el("span", null, "50% threshold"), el("span", null, "100%"));
    gauge.append(track, scale);

    // facts
    const splitText = { train: "Training data (model has seen it)", test: "Held-out test data", unlabeled: "Unlabeled (never used for training)" }[t.split] || t.split;
    const facts = el("dl", "facts");
    [
      ["Time step", String(t.step)],
      ["Data split", splitText],
      ["Links", `${t.deg} (${t.in_links} in, ${t.out_links} out)`],
      ["PageRank", Number(t.pr).toFixed(2)],
      ["Cluster", `#${t.comp}, ${fmt(t.csize)} transactions`],
      ["Illicit in cluster", `${fmt(c.illicit)} (${pct(c.density, 1)})`],
    ].forEach(([k, val]) => { facts.append(el("dt", null, k), el("dd", null, val)); });

    // plain-language reading
    const why = [];
    if (known(t.label)) {
      const outcome = t.pred === 1
        ? (t.label === "1" ? "The model caught it." : "The model raised a false alarm.")
        : (t.label === "1" ? "The model missed it." : "The model correctly left it alone.");
      why.push(`Known label: ${t.label === "1" ? "illicit" : "licit"}. ${outcome}`);
      why.push(t.split === "train"
        ? "It was part of the training data, so the model had already seen it and this score is not a fair test."
        : "It was held out for testing, so the model had not seen it before.");
    } else {
      why.push(t.pred === 1
        ? "It has no label. The model scores it as likely illicit, so it is a candidate for review."
        : "It has no label. The model does not see signs of illicit activity.");
    }
    why.push(`It belongs to a cluster of ${fmt(c.size)} transactions, ${fmt(c.illicit)} of them known illicit (${pct(c.density, 1)}).`);
    why.push(t.deg === 0
      ? "It has no links to other transactions in this data."
      : `It has ${t.deg} link${t.deg === 1 ? "" : "s"}; the average transaction has ${d.avg_degree.toFixed(1)}.`);
    const ul = el("ul", "why");
    why.forEach((w) => ul.append(el("li", null, w)));

    // graph
    const gh = el("div", "graph-head");
    gh.append(el("h3", null, "Transactions around this one"));
    const seg = el("div", "seg");
    [[1, "1 hop"], [2, "2 hops"]].forEach(([n, label]) => {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.depth === n));
      b.addEventListener("click", () => { state.depth = n; selectTx(t.id); });
      seg.append(b);
    });
    gh.append(seg);
    const net = el("div", "net");
    net.id = "net-tx";
    const nShown = d.graph.nodes.length;
    const note = el("p", "cap-note",
      d.truncated
        ? `Showing the ${nShown - 1} highest-risk of ${t.deg} linked transactions. Click any dot to open it.`
        : `Showing ${nShown} transaction${nShown === 1 ? "" : "s"}. Arrows follow the money. Click any dot to open it.`);

    const left = el("div", "d-left");
    left.append(gauge, facts, ul);
    const right = el("div", "d-right");
    right.append(gh, net, legend(true), note);
    const cols = el("div", "d-cols");
    cols.append(left, right);
    box.replaceChildren(head, cols);
    drawGraph("net-tx", d.graph, (id) => selectTx(id));
  }

  // ------------------------------------------------------------ clusters
  async function loadClusters() {
    state.clLoaded = true;
    const p = new URLSearchParams({ sort: $("c-sort").value, page: state.cPage });
    const d = await api("/api/clusters?" + p);
    state.cPage = d.page;
    state.cPages = d.pages;
    $("c-count").textContent = `${fmt(d.total)} clusters with 2 or more transactions`;
    $("cl-table").tBodies[0].replaceChildren(...d.rows.map((c) => {
      const tr = el("tr");
      tr.dataset.id = c.comp;
      if (c.comp === state.selCl) tr.className = "sel";
      const mk = el("td");
      mk.append(compoBar(c, false));
      tr.append(el("td", "id", "#" + c.comp), el("td", "num", fmt(c.size)), mk,
                el("td", "num", `${fmt(c.illicit)} (${pct(c.density, 1)})`), el("td", "num", fmt(c.flagged)));
      tr.addEventListener("click", () => selectCluster(c.comp));
      return tr;
    }));
    $("c-page-info").textContent = `Page ${d.page} of ${d.pages}`;
    $("c-prev").disabled = d.page <= 1;
    $("c-next").disabled = d.page >= d.pages;
  }
  $("c-sort").addEventListener("change", () => { state.cPage = 1; loadClusters(); });
  $("c-prev").addEventListener("click", () => { state.cPage -= 1; loadClusters(); });
  $("c-next").addEventListener("click", () => { state.cPage += 1; loadClusters(); });

  function openTx(id) {
    setView("tx");
    selectTx(id);
  }

  async function selectCluster(comp) {
    state.selCl = comp;
    setHash("#/clusters/" + comp);
    document.querySelectorAll("#cl-table tbody tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.id === comp));
    let d;
    try { d = await api("/api/cluster/" + encodeURIComponent(comp)); } catch (e) { return; }
    const c = d.cluster;
    const box = $("cl-detail");

    const head = el("div", "d-head");
    head.append(el("h2", null, "Cluster #" + c.comp));

    const stats = el("div", "stats");
    [
      [fmt(c.size), "transactions"],
      [fmt(c.illicit), "known illicit"],
      [pct(c.density, 1), "illicit share"],
      [fmt(c.flagged), "flagged by the model"],
    ].forEach(([v, n]) => {
      const s = el("div", "stat");
      s.append(el("div", "v", v), el("div", "n", n));
      stats.append(s);
    });

    const mix = el("div", "mini");
    mix.append(el("h3", null, "Make-up of the cluster"), compoBar(c, true));
    const lg = el("div", "legend");
    [["illicit", `Known illicit ${fmt(c.illicit)}`], ["licit", `Known licit ${fmt(c.licit)}`], ["unlabeled", `Unlabeled ${fmt(c.unlabeled)}`]].forEach(([k, t]) => {
      const key = el("span", "key");
      key.append(el("i", "dot " + k), document.createTextNode(t));
      lg.append(key);
    });
    mix.append(lg);

    const topBox = el("div", "mini");
    topBox.append(el("h3", null, "Highest-risk transactions"));
    const list = el("div", "toplist");
    d.top.slice(0, 5).forEach((r) => {
      const row = el("button", "toprow");
      row.type = "button";
      row.append(el("i", "dot " + lkey(r.label)), el("span", "id", r.id), el("span", "rk", pct(r.risk)));
      row.addEventListener("click", () => openTx(r.id));
      list.append(row);
    });
    topBox.append(list);

    const gh = el("div", "graph-head");
    gh.append(el("h3", null, "A sample of the cluster"));
    const net = el("div", "net");
    net.id = "net-cl";
    const note = el("p", "cap-note", `Showing ${fmt(d.shown)} of ${fmt(c.size)} transactions: known illicit and flagged ones first, then the best connected. Click a dot to open it.`);

    const left = el("div", "d-left");
    left.append(stats, mix, topBox);
    const right = el("div", "d-right");
    right.append(gh, net, legend(), note);
    const cols = el("div", "d-cols");
    cols.append(left, right);
    box.replaceChildren(head, cols);
    drawGraph("net-cl", d.graph, openTx);
  }

  // ------------------------------------------------------------ model scores
  async function drawModel() {
    state.modelDrawn = true;
    const s = state.summary;
    const h = s.histogram;
    const total = (k) => h[k].reduce((a, b) => a + b, 0) || 1;
    const share = (k) => h[k].map((v) => (v / total(k)) * 100);
    const labels = h.illicit.map((_, i) => `${i * 10}-${(i + 1) * 10}%`);

    new Chart($("c-hist"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Known illicit", data: share("illicit"), backgroundColor: css("--illicit"), borderRadius: 2 },
          { label: "Known licit", data: share("licit"), backgroundColor: css("--licit"), borderRadius: 2 },
          { label: "Unlabeled", data: share("unlabeled"), backgroundColor: css("--unknown"), borderRadius: 2 },
        ],
      },
      options: {
        animation: false, maintainAspectRatio: false,
        font: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', size: 13 },
        plugins: {
          legend: { display: true, position: "top", labels: { boxWidth: 12, boxHeight: 12, font: { size: 13 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const key = ["illicit", "licit", "unlabeled"][ctx.datasetIndex];
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${fmt(h[key][ctx.dataIndex])} transactions)`;
              },
            },
          },
        },
        scales: {
          x: { title: { display: true, text: "Model risk score" }, grid: { display: false } },
          y: { title: { display: true, text: "Share of that group" }, beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" }, grid: { color: css("--line") } },
        },
      },
    });

    const P = BOOT.pipeline || {};
    const notes = $("model-notes");
    const readings = el("div");
    readings.append(el("h3", null, "What the chart says"));
    const ul = el("ul");
    const top = (k) => h[k][9] / total(k);
    const low = (k) => (h[k][0]) / total(k);
    [
      `${pct(top("illicit"))} of known illicit transactions score 90% or more.`,
      `${pct(low("licit"))} of known licit transactions score under 10%.`,
      `${fmt(s.flagged_unlabeled)} of ${fmt(s.unlabeled)} unlabeled transactions score above 50% and are flagged for review.`,
    ].forEach((t) => ul.append(el("li", null, t)));
    readings.append(ul);
    notes.replaceChildren(readings);

    if (P.tp != null) {
      const cmBox = el("div");
      cmBox.append(el("h3", null, "Held-out test results"));
      const cm = el("div", "cm");
      const cell = (cls, n, t) => { const c = el("div", "c " + cls); c.append(el("b", null, fmt(n)), el("span", null, t)); return c; };
      cm.append(el("div", "h"), el("div", "h", "Predicted licit"), el("div", "h", "Predicted illicit"),
        el("div", "h row", "Actually licit"), cell("good", P.tn, "correct"), cell("bad", P.fp, "false alarm"),
        el("div", "h row", "Actually illicit"), cell("bad", P.fn, "missed"), cell("good", P.tp, "caught"));
      cmBox.append(cm);
      cmBox.append(el("p", "muted small", `AUC ${P.auc == null ? "n/a" : P.auc.toFixed(3)}, precision ${pct(P.precision, 1)}, recall ${pct(P.recall, 1)}, F1 ${pct(P.f1, 1)}. Tested on ${fmt(P.test_rows)} transactions the model never trained on.`));
      notes.append(cmBox);
    }

    const caution = el("div");
    caution.append(el("h3", null, "Read the scores with care"));
    const cu = el("ul");
    [
      "Scores for transactions in the training data are optimistic, because the model has already seen them.",
      "The score is a probability from a simple Logistic Regression, not proof that a transaction is illicit.",
    ].forEach((t) => cu.append(el("li", null, t)));
    caution.append(cu);
    notes.append(caution);
  }

  // ------------------------------------------------------------ start
  async function start() {
    Chart.defaults.font.family = '"IBM Plex Sans", "Segoe UI", sans-serif';
    state.summary = await api("/api/summary");
    renderKpis(state.summary);
    renderPipeline(state.summary);
    await loadList();
    route();
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  else start();
})();
