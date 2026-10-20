(function () {
  "use strict";

  // ------------------------------------------------------------ data helpers
  const D = DATA;
  const S1 = D.stage1, S2 = D.stage2, S3 = D.stage3, S4 = D.stage4;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));
  const pct = (x, d = 1) => (x == null || isNaN(x) ? "n/a" : Number(x).toFixed(d) + "%");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const NAME = { "1": "Illicit", "2": "Licit", "unknown": "Unlabeled" };
  const KEY = { "1": "illicit", "2": "licit", "unknown": "unknown" };
  const labelName = (v) => NAME[String(v)] || String(v);
  const labelKey = (v) => KEY[String(v)] || "unknown";
  const colorOf = (key) => css("--" + key);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const setList = (id, items) => {
    const ul = $(id);
    ul.replaceChildren(...items.map((t) => el("li", null, t)));
  };

  // class counts
  const dist = {};
  (S1.class_distribution || []).forEach((r) => { dist[String(r.class)] = r.total; });
  const illicitN = dist["1"] || 0;
  const licitN = dist["2"] || 0;
  const unknownN = dist["unknown"] || 0;
  const totalN = S1.total_rows || illicitN + licitN + unknownN;
  const labeledN = illicitN + licitN;
  const illicitShare = totalN ? (illicitN / totalN) * 100 : null;
  const unknownShare = totalN ? (unknownN / totalN) * 100 : null;

  // graph numbers
  const degreeOf = {};
  const countOf = {};
  (S3.avg_degree || []).forEach((r) => { degreeOf[String(r.label)] = r.avg_degree; countOf[String(r.label)] = r.n; });
  const illicitInGraph = countOf["1"] || 0;

  const topIllicit = (S3.illicit_clusters || []).slice().sort((a, b) => b.illicit - a.illicit);
  const top3 = topIllicit.slice(0, 3);
  const top3Illicit = top3.reduce((s, r) => s + r.illicit, 0);
  const top3Size = top3.reduce((s, r) => s + r.size, 0);
  const top3IllicitShare = illicitInGraph ? (top3Illicit / illicitInGraph) * 100 : null;
  const top3NodeShare = S3.vertices ? (top3Size / S3.vertices) * 100 : null;

  // combined verdict from the lift value
  const lift = S4.lift;
  let verdict = { kind: "near", title: "The graph does not confirm the model's flags", text: "Flagged transactions are no more likely to sit in a risky cluster than any other unlabeled transaction.", short: "cluster membership does not confirm the model's flags" };
  if (lift != null && lift >= 1.1) {
    verdict = { kind: "high", title: "The graph supports the model's flags", text: "Flagged transactions sit in risky clusters more often than other unlabeled ones.", short: "flagged transactions sit in risky clusters more often than other unlabeled ones" };
  } else if (lift != null && lift <= 0.9) {
    verdict = { kind: "low", title: "Flagged transactions avoid the risky clusters", text: "Flagged transactions sit in risky clusters less often than other unlabeled ones.", short: "flagged transactions sit in risky clusters less often than other unlabeled ones" };
  }

  // ------------------------------------------------------------ chart setup
  function setupChartDefaults() {
    Chart.defaults.font.family = '"IBM Plex Sans", "Segoe UI", sans-serif';
    Chart.defaults.font.size = 14;
    Chart.defaults.color = css("--muted");
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
  }

  // writes the value at the end of each bar
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.format) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 14px "IBM Plex Sans", "Segoe UI", sans-serif';
      ctx.fillStyle = css("--ink");
      const horizontal = chart.options.indexAxis === "y";
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const text = opts.format(chart.data.datasets[0].data[i], i);
        if (horizontal) {
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(text, bar.x + 8, bar.y);
        } else {
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(text, bar.x, bar.y - 5);
        }
      });
      ctx.restore();
    },
  };

  const gridColor = () => css("--line");

  // ------------------------------------------------------------ slide 0: overview
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawNetwork() {
    const svg = $("net");
    const NS = "http://www.w3.org/2000/svg";
    const W = 640, H = 460, cols = 10, rows = 7;
    const rnd = mulberry32(11);
    const nodes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({ x: ((c + 0.5) * W) / cols + (rnd() - 0.5) * 30, y: ((r + 0.5) * H) / rows + (rnd() - 0.5) * 30, kind: "unknown" });
      }
    }
    const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const nearest = (i, k) =>
      nodes.map((n, j) => ({ j, d: j === i ? Infinity : dist2(nodes[i], n) }))
        .sort((a, b) => a.d - b.d).slice(0, k).map((o) => o.j);

    const edges = new Set();
    nodes.forEach((_, i) => nearest(i, 2).forEach((j) => edges.add(i < j ? i + "-" + j : j + "-" + i)));

    [[16, 4], [52, 3]].forEach(([seed, k]) => {
      nodes[seed].kind = "illicit";
      nearest(seed, k).forEach((j) => { nodes[j].kind = "illicit"; });
    });
    nodes.forEach((n) => { if (n.kind === "unknown" && rnd() < 0.25) n.kind = "licit"; });

    edges.forEach((key) => {
      const [i, j] = key.split("-").map(Number);
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", nodes[i].x.toFixed(1));
      ln.setAttribute("y1", nodes[i].y.toFixed(1));
      ln.setAttribute("x2", nodes[j].x.toFixed(1));
      ln.setAttribute("y2", nodes[j].y.toFixed(1));
      svg.appendChild(ln);
    });
    nodes.forEach((n) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", n.x.toFixed(1));
      c.setAttribute("cy", n.y.toFixed(1));
      c.setAttribute("r", n.kind === "illicit" ? 8.5 : 6.5);
      c.setAttribute("class", n.kind);
      svg.appendChild(c);
    });
  }

  function renderOverview() {
    $("ov-lead").textContent =
      "We used three Spark modules on the Elliptic Bitcoin dataset: Spark SQL to explore it, " +
      "MLlib to classify transactions, and GraphX to study how they are linked.";
    const facts = [
      [fmt(totalN), "transactions in the dataset"],
      [pct(illicitShare), `are known illicit (${fmt(illicitN)} in all)`],
      [pct(unknownShare), "have no label at all"],
      [fmt(S3.vertices), `transactions and ${fmt(S3.edges)} links in the graph we studied`],
    ];
    $("ov-facts").replaceChildren(
      ...facts.map(([k, v]) => {
        const row = el("div");
        row.append(el("dt", null, k), el("dd", null, v));
        return row;
      })
    );
    drawNetwork();
  }

  // ------------------------------------------------------------ slide 1: Spark SQL
  function renderSql() {
    $("t1").textContent = `Only ${pct(illicitShare)} of ${fmt(totalN)} transactions are known to be illicit`;

    const parts = [
      ["1", illicitN],
      ["2", licitN],
      ["unknown", unknownN],
    ];
    new Chart($("c-donut"), {
      type: "doughnut",
      data: {
        labels: parts.map(([k]) => labelName(k)),
        datasets: [{ data: parts.map(([, v]) => v), backgroundColor: parts.map(([k]) => colorOf(labelKey(k))), borderColor: "#fff", borderWidth: 2 }],
      },
      options: { cutout: "62%" },
    });
    $("donut-legend").replaceChildren(
      ...parts.map(([k, v]) => {
        const li = el("li");
        const dot = el("i", "dot " + labelKey(k));
        li.append(dot, el("span", null, labelName(k)), el("b", null, `${fmt(v)} (${pct((v / totalN) * 100)})`));
        return li;
      })
    );

    const steps = S1.per_step || [];
    const maxRow = steps.reduce((m, r) => (r.illicit > (m ? m.illicit : -1) ? r : m), null);
    const minRow = steps.reduce((m, r) => (r.illicit < (m ? m.illicit : Infinity) ? r : m), null);
    new Chart($("c-steps"), {
      type: "bar",
      data: {
        labels: steps.map((r) => r.timeStep),
        datasets: [{ data: steps.map((r) => r.illicit), backgroundColor: steps.map((r) => (maxRow && r.timeStep === maxRow.timeStep ? "#8c2132" : colorOf("illicit"))), borderRadius: 2 }],
      },
      options: {
        scales: {
          x: { title: { display: true, text: "Time step" }, grid: { display: false }, ticks: { maxTicksLimit: 25 } },
          y: { title: { display: true, text: "Illicit transactions" }, beginAtZero: true, grid: { color: gridColor() } },
        },
      },
    });
    if (maxRow && minRow) {
      $("steps-caption").textContent =
        `Time step ${maxRow.timeStep} has the most known illicit transactions (${fmt(maxRow.illicit)}); step ${minRow.timeStep} has the fewest (${fmt(minRow.illicit)}).`;
    }
    $("sql-why").textContent =
      `Spark SQL joined the features with their labels and counted classes with GROUP BY queries. ` +
      `Only the ${fmt(labeledN)} labeled transactions can be used to train a model.`;
  }

  // ------------------------------------------------------------ slide 2: MLlib
  function renderMl() {
    $("t2").textContent = `The model catches ${pct(S2.recall * 100, 0)} of illicit transactions`;

    const metrics = [
      ["AUC", S2.auc == null ? "n/a" : S2.auc.toFixed(3), "How well illicit transactions are ranked above licit ones. 1.0 is perfect."],
      ["Accuracy", pct(S2.accuracy * 100), "Share of all test transactions classified correctly."],
      ["Precision", pct(S2.precision * 100), "Of the transactions flagged illicit, how many really are."],
      ["Recall", pct(S2.recall * 100), "Of all illicit transactions, how many the model caught."],
      ["F1 score", pct(S2.f1 * 100), "A single number that balances precision and recall."],
    ];
    $("metrics").replaceChildren(
      ...metrics.map(([n, v, d]) => {
        const m = el("div", "metric");
        m.append(el("div", "v", v), el("div", "n", n), el("div", "d", d));
        return m;
      })
    );

    const cm = $("cm");
    const cell = (cls, count, text) => {
      const c = el("div", "c " + cls);
      c.append(el("b", null, fmt(count)), el("span", null, text));
      return c;
    };
    cm.replaceChildren(
      el("div", "h"),
      el("div", "h", "Predicted licit"),
      el("div", "h", "Predicted illicit"),
      el("div", "h row", "Actually licit"),
      cell("good", S2.tn, "correct"),
      cell("bad", S2.fp, "false alarm"),
      el("div", "h row", "Actually illicit"),
      cell("bad", S2.fn, "missed"),
      cell("good", S2.tp, "caught")
    );

    const testTotal = (S2.tp || 0) + (S2.fp || 0) + (S2.fn || 0) + (S2.tn || 0);
    const licitShare = testTotal ? (((S2.tn || 0) + (S2.fp || 0)) / testTotal) * 100 : null;
    $("ml-baseline").textContent =
      `Guessing "licit" for every transaction would already be ${pct(licitShare)} accurate, ` +
      `because that share of the test data is licit. It would catch none of the ${fmt((S2.tp || 0) + (S2.fn || 0))} illicit ones. ` +
      `So we judge the model by precision and recall, not by accuracy.`;
    $("ml-setup").textContent =
      `Logistic Regression from Spark MLlib, trained on ${fmt(S2.train_rows)} labeled transactions ` +
      `and tested on ${fmt(S2.test_rows)} others (random 80/20 split, 165 features).`;
  }

  // ------------------------------------------------------------ slide 3: GraphX
  function renderGraph() {
    $("t3").textContent = "Illicit transactions have fewer links and gather in a few clusters";
    $("gx-size").textContent =
      `Graph studied: ${fmt(S3.vertices)} transactions joined by ${fmt(S3.edges)} payment links (time steps 1 to ${S3.max_step}). ` +
      `Connected components found ${fmt(S3.total_clusters)} clusters, and ${fmt(S3.clusters_with_illicit)} of them contain at least one known illicit transaction.`;

    // average degree by label
    const order = ["1", "2", "unknown"].filter((k) => degreeOf[k] != null);
    new Chart($("c-degree"), {
      type: "bar",
      data: {
        labels: order.map(labelName),
        datasets: [{ data: order.map((k) => Math.round(degreeOf[k] * 100) / 100), backgroundColor: order.map((k) => colorOf(labelKey(k))), borderRadius: 3, barPercentage: 0.7 }],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, grace: "18%", grid: { color: gridColor() }, title: { display: true, text: "Links per transaction" } },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
        plugins: { valueLabels: { format: (v) => v.toFixed(2) } },
      },
      plugins: [valueLabels],
    });
    if (degreeOf["1"] != null && degreeOf["2"] != null) {
      $("degree-caption").textContent =
        `Illicit transactions average ${degreeOf["1"].toFixed(2)} links and licit ones ${degreeOf["2"].toFixed(2)}, which suggests short chains rather than busy hubs.`;
    }

    // clusters with most illicit
    const shown = topIllicit.slice(0, 8);
    new Chart($("c-clusters"), {
      type: "bar",
      data: {
        labels: shown.map((r) => "#" + r.component),
        datasets: [{ data: shown.map((r) => r.illicit), backgroundColor: colorOf("illicit"), borderRadius: 3 }],
      },
      options: {
        scales: {
          x: { grid: { display: false }, title: { display: true, text: "Cluster ID" } },
          y: { beginAtZero: true, grace: "20%", grid: { color: gridColor() } },
        },
        plugins: {
          valueLabels: { format: (v) => String(v) },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = shown[ctx.dataIndex];
                return `${r.illicit} illicit of ${fmt(r.size)} transactions (${pct((r.illicit / r.size) * 100)})`;
              },
            },
          },
        },
      },
      plugins: [valueLabels],
    });
    if (top3IllicitShare != null && top3NodeShare != null) {
      $("cluster-caption").textContent =
        `The top 3 clusters hold ${pct(top3IllicitShare, 0)} of the known illicit transactions but only ${pct(top3NodeShare)} of all transactions in the graph.`;
    }

    // pagerank table
    const pr = S3.pagerank || [];
    const table = $("pr-table");
    const thead = el("thead");
    const hr = el("tr");
    [["Rank", ""], ["Transaction ID", ""], ["PageRank score", "num"], ["Label", ""]].forEach(([t, c]) => hr.append(Object.assign(el("th", c, t))));
    thead.append(hr);
    const tbody = el("tbody");
    pr.slice(0, 5).forEach((r, i) => {
      const tr = el("tr");
      const tag = el("span", "tag " + labelKey(r.label), labelName(r.label));
      const last = el("td");
      last.append(tag);
      tr.append(el("td", null, String(i + 1)), el("td", null, String(r.txId)), el("td", "num", Number(r.pagerank).toFixed(1)), last);
      tbody.append(tr);
    });
    table.replaceChildren(thead, tbody);
    const illicitInTop = pr.filter((r) => labelKey(r.label) === "illicit").length;
    $("pr-caption").textContent =
      pr.length === 0 ? "" :
      illicitInTop === 0
        ? `None of the top ${pr.length} transactions is a known illicit one, so we see no sign of illicit activity at the most central points.`
        : `${illicitInTop} of the top ${pr.length} transactions is a known illicit one.`;
  }

  // ------------------------------------------------------------ slide 4: combined
  function renderCombined() {
    $("t4").textContent = verdict.title;
    $("comb-chart-title").textContent = "Unlabeled transactions that share a cluster with a known illicit one";
    const bars = [
      ["Flagged illicit by the model", S4.pct_flagged, colorOf("illicit")],
      ["Not flagged", S4.pct_not_flagged, colorOf("licit")],
      ["All unlabeled (baseline)", S4.pct_baseline, colorOf("unknown")],
    ];
    new Chart($("c-comb"), {
      type: "bar",
      data: {
        labels: bars.map((b) => b[0]),
        datasets: [{ data: bars.map((b) => b[1]), backgroundColor: bars.map((b) => b[2]), borderRadius: 3 }],
      },
      options: {
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, max: 100, grid: { color: gridColor() }, ticks: { callback: (v) => v + "%" } },
        },
        plugins: { valueLabels: { format: (v) => pct(v) } },
      },
      plugins: [valueLabels],
    });

    $("lift-num").textContent = lift == null ? "n/a" : lift.toFixed(2);
    $("verdict-text").textContent = verdict.text;
    $("verdict-detail").textContent =
      `Clusters are large, so about ${pct(S4.pct_baseline, 0)} of all ${fmt(S4.unknown_total)} unlabeled transactions already share one with a known illicit transaction. ` +
      `The model flagged ${fmt(S4.flagged)} of them. Their clusters are ${pct(S4.density_flagged, 2)} illicit on average, against ${pct(S4.density_not_flagged, 2)} for the rest. ` +
      `The model and the graph seem to capture different information.`;
  }

  // ------------------------------------------------------------ slide 5: takeaways
  function renderTakeaways() {
    const closing = {
      near: "The classifier performs well, but the graph does not confirm it",
      high: "The classifier performs well and the graph supports it",
      low: "The classifier performs well, but the graph points the other way",
    };
    $("t5").textContent = closing[verdict.kind];
    setList("found", [
      `Spark SQL: only ${pct(illicitShare)} of transactions are known illicit and ${pct(unknownShare)} are unlabeled.`,
      `MLlib: Logistic Regression reaches an AUC of ${S2.auc == null ? "n/a" : S2.auc.toFixed(3)}, with ${pct(S2.precision * 100)} precision and ${pct(S2.recall * 100)} recall.`,
      `GraphX: illicit transactions average ${degreeOf["1"] == null ? "n/a" : degreeOf["1"].toFixed(2)} links against ${degreeOf["2"] == null ? "n/a" : degreeOf["2"].toFixed(2)} for licit ones, and 3 clusters hold ${pct(top3IllicitShare, 0)} of them.`,
      `Combined: with a lift of ${lift == null ? "n/a" : lift.toFixed(2)}, ${verdict.short}.`,
    ]);
    setList("limits", [
      "The train and test split is random, not by time, so results on future data may be lower.",
      `Only ${fmt(illicitInGraph)} known illicit transactions fall in time steps 1 to ${S3.max_step}, which is a small sample.`,
      "Connected components ran for 10 iterations only, so the clusters are approximate.",
      "Sharing a cluster with an illicit transaction is a coarse test, because clusters are large.",
    ]);
    setList("next", [
      "Split by time step: train on early steps and test on later ones.",
      "Add degree, PageRank and cluster size as features for the model.",
      "Try Random Forest and handle the class imbalance.",
      "Run GraphX on all 49 time steps on a larger machine or a cluster.",
    ]);
  }

  // ------------------------------------------------------------ navigation
  const renderers = [renderOverview, renderSql, renderMl, renderGraph, renderCombined, renderTakeaways];
  const slides = Array.from(document.querySelectorAll(".slide"));
  const navButtons = Array.from(document.querySelectorAll("#chain button"));
  const rendered = new Set();
  let current = 0;

  function show(i) {
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => { s.hidden = k !== current; });
    navButtons.forEach((b, k) => {
      if (k === current) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
      b.classList.toggle("done", k < current);
    });
    if (!rendered.has(current)) {
      renderers[current]();
      rendered.add(current);
    }
    $("counter").textContent = `Slide ${current + 1} of ${slides.length}`;
    $("stage").scrollTop = 0;
    history.replaceState(null, "", "#" + (current + 1));
  }

  navButtons.forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.go))));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": e.preventDefault(); show(current + 1); break;
      case "ArrowLeft": case "PageUp": e.preventDefault(); show(current - 1); break;
      case "Home": show(0); break;
      case "End": show(slides.length - 1); break;
      case "f": case "F":
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        break;
      default:
        if (/^[1-6]$/.test(e.key)) show(Number(e.key) - 1);
    }
  });

  // ------------------------------------------------------------ start
  function start() {
    setupChartDefaults();
    if (D.missing && D.missing.length) {
      const b = $("banner");
      b.hidden = false;
      b.textContent = "These values were not found in the results file, so some slides may be incomplete: " + D.missing.join(", ");
    }
    const parts = String(D.source || "").split(/[\\/]/).filter(Boolean);
    $("source").textContent = "Results read from " + parts.slice(-2).join("/");
    const fromHash = parseInt((location.hash || "").replace("#", ""), 10);
    show(isNaN(fromHash) ? 0 : fromHash - 1);
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  else start();
})();
