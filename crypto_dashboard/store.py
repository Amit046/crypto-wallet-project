"""
Reads the two files written by the Scala program (Stage 5):

  output/transactions.csv   one row per transaction: model risk, links, PageRank, cluster, train/test
  output/edges.csv          one row per payment link: src,dst

and answers the questions the dashboard asks (search, filters, neighbours, clusters).
Plain Python only, no pandas needed.
"""
import csv
from collections import defaultdict
from pathlib import Path


def _int(x, default=0):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return default


def _float(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def label_key(label):
    return {"1": "illicit", "2": "licit"}.get(str(label), "unlabeled")


class Store:
    def __init__(self, out_dir):
        self.dir = Path(out_dir)
        self.tx_path = self.dir / "transactions.csv"
        self.edge_path = self.dir / "edges.csv"
        self.stamp = None
        self.ok = False
        self.load()

    # ------------------------------------------------------------ loading
    def _stamp(self):
        try:
            return (self.tx_path.stat().st_mtime, self.edge_path.stat().st_mtime)
        except OSError:
            return None

    def refresh(self):
        """Reload when the files changed (for example after running sbt again)."""
        if self._stamp() != self.stamp:
            self.load()

    def load(self):
        self.stamp = self._stamp()
        self.ok = False
        self.rows, self.by_id = [], {}
        self.out, self.inn = defaultdict(list), defaultdict(list)
        self.edge_count = 0
        self.clusters, self.members = {}, defaultdict(list)
        self.summary = {}
        if self.stamp is None:
            return

        with open(self.tx_path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                row = {
                    "id": r["txId"],
                    "step": _int(r.get("timeStep")),
                    "label": r.get("class", "unknown"),
                    "risk": _float(r.get("risk")),
                    "pred": _int(r.get("predicted")),
                    "deg": _int(r.get("degree")),
                    "pr": _float(r.get("pagerank")),
                    "comp": r.get("component", ""),
                    "csize": _int(r.get("cluster_size")),
                    "cill": _int(r.get("cluster_illicit")),
                    "split": r.get("split", "unlabeled"),
                }
                self.rows.append(row)
                self.by_id[row["id"]] = row

        with open(self.edge_path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                a, b = r["src"], r["dst"]
                if a in self.by_id and b in self.by_id:
                    self.out[a].append(b)
                    self.inn[b].append(a)
                    self.edge_count += 1

        for r in self.rows:
            self.members[r["comp"]].append(r["id"])
        for comp, ids in self.members.items():
            rows = [self.by_id[i] for i in ids]
            n = len(rows)
            ill = sum(1 for r in rows if r["label"] == "1")
            self.clusters[comp] = {
                "comp": comp,
                "size": n,
                "illicit": ill,
                "licit": sum(1 for r in rows if r["label"] == "2"),
                "unlabeled": sum(1 for r in rows if r["label"] not in ("1", "2")),
                "flagged": sum(1 for r in rows if r["pred"] == 1),
                "density": ill / n if n else 0.0,
            }
        self._build_summary()
        self.ok = True

    def _build_summary(self):
        rows = self.rows
        n = len(rows)
        unl = [r for r in rows if r["label"] not in ("1", "2")]
        bins = {k: [0] * 10 for k in ("illicit", "licit", "unlabeled")}
        for r in rows:
            bins[label_key(r["label"])][min(int(r["risk"] * 10), 9)] += 1
        self.summary = {
            "transactions": n,
            "min_step": min((r["step"] for r in rows), default=0),
            "max_step": max((r["step"] for r in rows), default=0),
            "links": self.edge_count,
            "known_illicit": sum(1 for r in rows if r["label"] == "1"),
            "known_licit": sum(1 for r in rows if r["label"] == "2"),
            "unlabeled": len(unl),
            "flagged_total": sum(1 for r in rows if r["pred"] == 1),
            "flagged_unlabeled": sum(1 for r in unl if r["pred"] == 1),
            "clusters": len(self.clusters),
            "clusters_with_illicit": sum(1 for c in self.clusters.values() if c["illicit"] > 0),
            "avg_degree": (sum(r["deg"] for r in rows) / n) if n else 0.0,
            "histogram": bins,
        }

    # ------------------------------------------------------------ compact row for lists
    @staticmethod
    def _compact(r):
        return {
            "id": r["id"], "step": r["step"], "label": r["label"], "risk": r["risk"],
            "pred": r["pred"], "deg": r["deg"], "comp": r["comp"], "csize": r["csize"],
            "cill": r["cill"], "split": r["split"],
        }

    # ------------------------------------------------------------ transaction list
    def query(self, q="", label="all", flag="all", step=None, min_risk=0.0,
              sort="risk", order="desc", page=1, size=25):
        rows = self.rows
        q = (q or "").strip()
        if q:
            rows = [r for r in rows if q in r["id"]]
        if label in ("1", "2"):
            rows = [r for r in rows if r["label"] == label]
        elif label == "unknown":
            rows = [r for r in rows if r["label"] not in ("1", "2")]
        if flag in ("0", "1"):
            rows = [r for r in rows if r["pred"] == int(flag)]
        if step:
            rows = [r for r in rows if r["step"] == step]
        if min_risk > 0:
            rows = [r for r in rows if r["risk"] >= min_risk]

        keys = {
            "risk": lambda r: r["risk"], "deg": lambda r: r["deg"], "pr": lambda r: r["pr"],
            "csize": lambda r: r["csize"], "step": lambda r: r["step"],
            "id": lambda r: int(r["id"]) if r["id"].isdigit() else 0,
        }
        key = keys.get(sort, keys["risk"])
        rows = sorted(rows, key=lambda r: (key(r), r["id"]), reverse=(order != "asc"))
        total = len(rows)
        size = max(1, min(size, 100))
        pages = max(1, -(-total // size))
        page = max(1, min(page, pages))
        chunk = rows[(page - 1) * size: page * size]
        return {"total": total, "page": page, "pages": pages, "rows": [self._compact(r) for r in chunk]}

    # ------------------------------------------------------------ one transaction + its neighbourhood
    def neighbourhood(self, tx_id, depth=2, cap=70):
        """Breadth-first walk around tx_id. Risky neighbours come first when we have to cut."""
        seen = {tx_id: 0}
        frontier = [tx_id]
        for d in range(1, depth + 1):
            nxt = []
            for u in frontier:
                near = list(dict.fromkeys(self.out[u] + self.inn[u]))
                near.sort(key=lambda v: (-self.by_id[v]["risk"], v))
                for v in near:
                    if v not in seen and len(seen) < cap:
                        seen[v] = d
                        nxt.append(v)
            frontier = nxt
        return self._subgraph(seen, center=tx_id)

    def _subgraph(self, seen, center=None):
        nodes = []
        for i, hop in seen.items():
            r = self.by_id[i]
            nodes.append({"id": i, "label": r["label"], "risk": r["risk"], "pred": r["pred"],
                          "deg": r["deg"], "hop": hop, "center": i == center})
        edges = [{"from": a, "to": b} for a in seen for b in self.out[a] if b in seen]
        return {"nodes": nodes, "edges": edges}

    def detail(self, tx_id, depth=2):
        r = self.by_id.get(tx_id)
        if not r:
            return None
        graph = self.neighbourhood(tx_id, depth=depth)
        c = self.clusters.get(r["comp"], {})
        return {
            "tx": {**self._compact(r), "pr": r["pr"],
                   "in_links": len(self.inn[tx_id]), "out_links": len(self.out[tx_id])},
            "cluster": c,
            "graph": graph,
            "truncated": r["deg"] + 1 > len(graph["nodes"]) and depth == 1,
            "avg_degree": self.summary.get("avg_degree", 0),
        }

    # ------------------------------------------------------------ clusters
    def cluster_list(self, sort="illicit", min_size=2, page=1, size=20):
        cl = [c for c in self.clusters.values() if c["size"] >= min_size]
        keymap = {
            "size": lambda c: c["size"], "illicit": lambda c: c["illicit"],
            "flagged": lambda c: c["flagged"], "density": lambda c: c["density"],
        }
        cl.sort(key=lambda c: (keymap.get(sort, keymap["illicit"])(c), c["size"]), reverse=True)
        total = len(cl)
        pages = max(1, -(-total // size))
        page = max(1, min(page, pages))
        return {"total": total, "page": page, "pages": pages,
                "rows": cl[(page - 1) * size: page * size]}

    def cluster_detail(self, comp, cap=110):
        c = self.clusters.get(comp)
        if not c:
            return None
        ids = self.members[comp]
        rows = [self.by_id[i] for i in ids]
        top = sorted(rows, key=lambda r: (-r["risk"], r["id"]))[:12]

        # pick the nodes worth drawing: known illicit, then flagged, then the best connected
        def priority(r):
            return (0 if r["label"] == "1" else 1 if r["pred"] == 1 else 2, -r["deg"], r["id"])
        chosen = {r["id"]: 0 for r in sorted(rows, key=priority)[:cap]}
        return {
            "cluster": c,
            "top": [self._compact(r) for r in top],
            "graph": self._subgraph(chosen),
            "shown": len(chosen),
        }
