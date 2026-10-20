"""
Dashboard for the Spark crypto-transaction project (INT315 Cluster Computing).

  /          the monitor: search a transaction and see what the Spark pipeline did with it
  /results   the results as presentation slides

Both read what the Scala program writes into the output folder:
  transactions.csv and edges.csv  (monitor)      results.txt  (slides)

The output folder is, in this order:
  1. the OUTPUT_DIR environment variable
  2. ../output   (when this folder sits inside crypto-wallet-project)
  3. ./output    (next to this file)
"""
import os
import re
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request

from store import Store

BASE = Path(__file__).resolve().parent
app = Flask(__name__)


def pick_output_dir() -> Path:
    env = os.environ.get("OUTPUT_DIR")
    if env:
        return Path(env)
    sibling = BASE.parent / "output"
    if sibling.exists():
        return sibling
    return BASE / "output"


def pick_results_path() -> Path:
    env = os.environ.get("RESULTS_PATH")
    if env and Path(env).exists():
        return Path(env)
    for candidate in (pick_output_dir() / "results.txt", BASE / "results.txt"):
        if candidate.exists():
            return candidate
    return BASE / "results.txt"


_store = None


def get_store() -> Store:
    """One Store for the whole app; it reloads itself when the CSV files change."""
    global _store
    out = pick_output_dir()
    if _store is None or _store.dir != out:
        _store = Store(out)
    else:
        _store.refresh()
    return _store


# ---------------------------------------------------------------- parsing
def _clean_lines(text: str):
    # also accepts text copied from the terminal ("[info] ..." prefix)
    return [re.sub(r"^\[(?:info|error|warn)\]\s?", "", ln.rstrip()) for ln in text.splitlines()]


def _convert(value: str):
    value = value.strip()
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def parse_table(lines, heading_part):
    """Find a '=== heading ===' line containing heading_part and read the
    'a | b | c' table that follows it."""
    for i, ln in enumerate(lines):
        if ln.startswith("===") and heading_part.lower() in ln.lower():
            j = i + 1
            while j < len(lines) and " | " not in lines[j]:
                j += 1
            if j >= len(lines):
                return []
            header = [h.strip() for h in lines[j].split(" | ")]
            rows = []
            j += 1
            while j < len(lines) and " | " in lines[j]:
                cells = [c.strip() for c in lines[j].split(" | ")]
                if len(cells) == len(header):
                    rows.append({h: _convert(c) for h, c in zip(header, cells)})
                j += 1
            return rows
    return []


def parse_results(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = _clean_lines(text)
    body = "\n".join(lines)

    def num(pattern, cast=float):
        m = re.search(pattern, body)
        return cast(m.group(1)) if m else None

    data = {
        "source": str(path),
        "stage1": {
            "total_rows": num(r"Total rows after join:\s*(\d+)", int),
            "class_distribution": parse_table(lines, "Class distribution"),
            "per_step": parse_table(lines, "per time step"),
        },
        "stage2": {
            "train_rows": num(r"Train rows:\s*(\d+)", int),
            "test_rows": num(r"Test rows:\s*(\d+)", int),
            "tp": num(r"TP[^:\n]*:\s*(\d+)", int),
            "fp": num(r"FP[^:\n]*:\s*(\d+)", int),
            "fn": num(r"FN[^:\n]*:\s*(\d+)", int),
            "tn": num(r"TN[^:\n]*:\s*(\d+)", int),
            "auc": num(r"AUC\s*:\s*([\d.]+)"),
            "accuracy": num(r"Accuracy\s*:\s*([\d.]+)"),
            "precision": num(r"Precision\s*:\s*([\d.]+)"),
            "recall": num(r"Recall\s*:\s*([\d.]+)"),
            "f1": num(r"F1-score\s*:\s*([\d.]+)"),
        },
        "stage3": {
            "max_step": num(r"STAGE 3: GRAPHX \(time steps 1-(\d+)\)", int),
            "vertices": num(r"Vertices:\s*(\d+),\s*Edges:\s*\d+", int),
            "edges": num(r"Vertices:\s*\d+,\s*Edges:\s*(\d+)", int),
            "avg_degree": parse_table(lines, "Average connections"),
            "top_connected": parse_table(lines, "most connected"),
            "biggest_clusters": parse_table(lines, "sabse bade"),
            "illicit_clusters": parse_table(lines, "zyada illicit"),
            "clusters_with_illicit": num(r"Clusters with at least 1 illicit:\s*(\d+)", int),
            "total_clusters": num(r"Total clusters:\s*(\d+)", int),
            "pagerank": parse_table(lines, "PageRank"),
        },
        "stage4": {
            "unknown_total": num(r"Unknown transactions \(time step 1-\d+\):\s*(\d+)", int),
            "flagged": num(r"illicit flag kiye\s*:\s*(\d+)", int),
            "not_flagged": num(r"Model ne licit bola\s*:\s*(\d+)", int),
            "pct_flagged": num(r"Flagged \(model: illicit\)\s*:\s*([\d.]+)"),
            "pct_not_flagged": num(r"Not flagged \(model: licit\)\s*:\s*([\d.]+)"),
            "pct_baseline": num(r"Baseline[^:\n]*:\s*([\d.]+)"),
            "lift": num(r"Lift[^:\n]*:\s*([\d.]+)"),
            "density_flagged": num(r"Flagged\s+:\s*([\d.]+)"),
            "density_not_flagged": num(r"Not flagged\s+:\s*([\d.]+)"),
        },
    }

    # tell the page what could not be read, so it never shows silent zeros
    missing = []
    for stage, block in data.items():
        if not isinstance(block, dict) or stage == "source":
            continue
        for key, val in block.items():
            if val is None or val == []:
                missing.append(f"{stage}.{key}")
    data["missing"] = missing
    return data


# ---------------------------------------------------------------- routes
@app.route("/")
def monitor():
    store = get_store()
    results = parse_results(pick_results_path())
    # only the few numbers the pipeline strip needs
    pipeline = {
        "rows": results["stage1"]["total_rows"],
        "recall": results["stage2"]["recall"],
        "precision": results["stage2"]["precision"],
        "auc": results["stage2"]["auc"],
        "f1": results["stage2"]["f1"],
        "tp": results["stage2"]["tp"],
        "fp": results["stage2"]["fp"],
        "fn": results["stage2"]["fn"],
        "tn": results["stage2"]["tn"],
        "test_rows": results["stage2"]["test_rows"],
        "vertices": results["stage3"]["vertices"],
        "edges": results["stage3"]["edges"],
        "clusters": results["stage3"]["total_clusters"],
        "max_step": results["stage3"]["max_step"],
        "lift": results["stage4"]["lift"],
    }
    boot = {"has_data": store.ok, "out_dir": str(store.dir), "pipeline": pipeline}
    return render_template("dashboard.html", boot=boot)


@app.route("/results")
def results_slides():
    path = pick_results_path()
    return render_template("results.html", data=parse_results(path))


@app.route("/api/results")
def api_results():
    return jsonify(parse_results(pick_results_path()))


def _need_data() -> Store:
    store = get_store()
    if not store.ok:
        abort(404, description="transactions.csv and edges.csv not found")
    return store


@app.route("/api/summary")
def api_summary():
    return jsonify(_need_data().summary)


@app.route("/api/transactions")
def api_transactions():
    store = _need_data()
    a = request.args
    return jsonify(store.query(
        q=a.get("q", ""),
        label=a.get("label", "all"),
        flag=a.get("flag", "all"),
        step=int(a["step"]) if a.get("step", "").isdigit() else None,
        min_risk=float(a.get("min_risk", 0) or 0),
        sort=a.get("sort", "risk"),
        order=a.get("order", "desc"),
        page=int(a.get("page", 1) or 1),
        size=int(a.get("size", 25) or 25),
    ))


@app.route("/api/tx/<tx_id>")
def api_tx(tx_id):
    depth = 1 if request.args.get("depth") == "1" else 2
    d = _need_data().detail(tx_id, depth=depth)
    if d is None:
        abort(404, description="unknown transaction")
    return jsonify(d)


@app.route("/api/clusters")
def api_clusters():
    a = request.args
    return jsonify(_need_data().cluster_list(
        sort=a.get("sort", "illicit"),
        min_size=int(a.get("min_size", 2) or 2),
        page=int(a.get("page", 1) or 1),
    ))


@app.route("/api/cluster/<comp>")
def api_cluster(comp):
    d = _need_data().cluster_detail(comp)
    if d is None:
        abort(404, description="unknown cluster")
    return jsonify(d)


@app.errorhandler(404)
def not_found(err):
    if request.path.startswith("/api/"):
        return jsonify({"error": getattr(err, "description", "not found")}), 404
    return err


if __name__ == "__main__":
    print("Output folder:", pick_output_dir())
    print("Open http://127.0.0.1:5000 in your browser (press F in the slides for full screen)")
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
