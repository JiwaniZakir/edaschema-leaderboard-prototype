#!/usr/bin/env python3
"""Turn the lab's total_area_prediction/fixed_mlp run tree into site payloads.

Writes, under site-2/data/:
  real.js                     manifest: architecture, hyperparameters, features,
                              provenance, aggregated + per-circuit eval metrics
  weights/<pdk>_<stage>.js    per-circuit checkpoint tensors (base64 float32)
                              and per-circuit training curves

Both are plain <script> payloads rather than JSON, so the pages keep working
from file:// as well as over HTTP.
"""
import base64, csv, glob, json, os, re, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ckpt, tfevents

HERE = os.path.dirname(os.path.abspath(__file__))
# Point SRC at <run tree>/total_area_prediction/fixed_mlp, or pass it as argv[1].
SRC = os.environ.get("EDA_RUNS", os.path.join(
    os.path.dirname(HERE), "..", "eda-ml-models", "total_area_prediction", "fixed_mlp"))
OUT = os.path.join(HERE, "..", "data")

PDKS = ["ng45", "sky130", "ihp130", "asap7"]
STAGES = ["floorplan", "global_place", "detailed_place", "cts", "global_route"]
DIRPDK = {"ng45": "NG45", "sky130": "SKY130", "ihp130": "IHP130", "asap7": "ASAP7"}
LAYERS = ["scalar_encoder.net.0", "scalar_encoder.net.2",
          "scalar_encoder.net.4", "scalar_encoder.net.6"]


def b64f32(vals):
    return base64.b64encode(struct.pack("<%df" % len(vals), *vals)).decode("ascii")


def r(v, n=6):
    return round(v, n)


# ---------------------------------------------------------------- run metadata
def parse_runlog(path):
    out = {}
    if not os.path.exists(path):
        return out
    txt = open(path, errors="replace").read()
    m = re.search(r"dataset at: (\S+)", txt)
    if m:
        out["dataset"] = m.group(1)
    m = re.search(r'Command being timed: "(.+?)"', txt, re.S)
    if m:
        out["command"] = " ".join(m.group(1).split())
    m = re.search(r"Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([\d:.]+)", txt)
    if m:
        out["wall"] = m.group(1)
    m = re.search(r"User time \(seconds\): ([\d.]+)", txt)
    if m:
        out["userSec"] = float(m.group(1))
    m = re.search(r"System time \(seconds\): ([\d.]+)", txt)
    if m:
        out["sysSec"] = float(m.group(1))
    m = re.search(r"Percent of CPU this job got: (\d+)%", txt)
    if m:
        out["cpuPct"] = int(m.group(1))
    m = re.search(r"Maximum resident set size \(kbytes\): (\d+)", txt)
    if m:
        out["maxRssKb"] = int(m.group(1))
    m = re.search(r"PEAK GPU MEM \(MB\): (\d+)", txt)
    if m:
        out["gpuMemMb"] = int(m.group(1))
    m = re.search(r"PEAK GPU UTIL \(%\): (\d+)", txt)
    if m:
        out["gpuUtilPct"] = int(m.group(1))
    return out


EVAL_LINE = re.compile(
    r"^(\w+): model mae=([\d.eE+-]+), mape=([\d.eE+-]+), r2=([-\d.eE+]+) \| "
    r"baseline mae=([\d.eE+-]+), mape=([\d.eE+-]+), r2=([-\d.eE+]+)")


def parse_evallog(path):
    per, meta = {}, {}
    if not os.path.exists(path):
        return per, meta
    for line in open(path, errors="replace"):
        line = line.strip()
        m = EVAL_LINE.match(line)
        if m:
            c = m.group(1)
            per[c] = {"m": [float(m.group(2)), float(m.group(3)), float(m.group(4))],
                      "b": [float(m.group(5)), float(m.group(6)), float(m.group(7))]}
            continue
        m = re.match(r"Evaluation run: (\S+)", line)
        if m:
            meta["evaluated"] = m.group(1)
        m = re.match(r"log_root: (\S+)", line)
        if m:
            meta["logRoot"] = m.group(1)
    return per, meta


# ------------------------------------------------------------------- curves
def curves_for(vdir):
    """Per-epoch training/validation series plus the final test scalars."""
    series, test = {}, {}
    for f in sorted(glob.glob(os.path.join(vdir, "events*"))):
        for tag, step, wall, val in tfevents.scalars(f):
            if "/" not in tag:
                continue
            name, split = tag.split("/", 1)
            if split == "test":
                test[name] = r(val)
            elif split in ("training", "validation"):
                series.setdefault(name, {}).setdefault(split, []).append((step, val))
    out = {}
    for name, splits in series.items():
        if name not in ("loss", "mae", "mape", "r2"):
            continue
        out[name] = {("tr" if s == "training" else "va"):
                     [r(v, 5) for _, v in sorted(pts)] for s, pts in splits.items()}
    return out, test


# ------------------------------------------------------------------- weights
def weights_for(ckpt_path):
    sd = ckpt.state_dict(ckpt_path)
    layers, raw = [], []
    for base in LAYERS:
        w = sd[base + ".weight"]
        b = sd[base + ".bias"]
        fo, fi = w.size
        layers.append({"fo": fo, "fi": fi, "w": b64f32(w.values), "b": b64f32(b.values)})
        raw.append(w.values)
    return layers, raw


def cosine(a, b):
    d = na = nb = 0.0
    for x, y in zip(a, b):
        d += x * y
        na += x * x
        nb += y * y
    return d / ((na ** 0.5) * (nb ** 0.5))


def triu(mat):
    """Upper triangle, row-major, excluding the unit diagonal."""
    n = len(mat)
    return [r(mat[i][j], 5) for i in range(n) for j in range(i + 1, n)]


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def main():
    os.makedirs(os.path.join(OUT, "weights"), exist_ok=True)

    # aggregated_eval_metrics.csv -----------------------------------------
    agg = {}
    with open(os.path.join(SRC, "aggregated_eval_metrics.csv")) as fh:
        for row in csv.DictReader(fh):
            agg[(row["pdk"], row["stage"])] = {
                "b": [float(row["baseline_mae"]), float(row["baseline_mape"]),
                      float(row["baseline_r2"])],
                "m": [float(row["model_mae"]), float(row["model_mape"]),
                      float(row["model_r2"])],
                "run": row["run"],
            }

    circuits = sorted(os.path.basename(p.rstrip("/")) for p in
                      glob.glob(os.path.join(SRC, f"default_config_{DIRPDK['ng45']}_cts", "*/"))
                      if os.path.isdir(p))

    runs, arch = {}, None
    first = {}       # (run, circuit) -> first-layer weight vector
    finalR2 = {"tr": [], "va": []}
    ratios = []      # observed std / untrained-null std, per layer
    beyond = []      # fraction of weights outside the init bound
    for pdk in PDKS:
        for stage in STAGES:
            rdir = os.path.join(SRC, f"default_config_{DIRPDK[pdk]}_{stage}")
            key = f"{pdk}_{stage}"
            per, emeta = parse_evallog(os.path.join(rdir, "eval.log"))
            rec = {
                "pdk": pdk, "stage": stage,
                "dir": os.path.basename(rdir),
                "agg": agg[(pdk, stage)],
                "circuits": {c: per[c] for c in per},
                "run": parse_runlog(os.path.join(rdir, "run.log")),
            }
            rec["run"].update(emeta)

            wpayload, tests = {}, {}
            for c in circuits:
                vdir = os.path.join(rdir, c, "version_0")
                cks = glob.glob(os.path.join(vdir, "checkpoints", "*.ckpt"))
                if not cks:
                    continue
                cur, test = curves_for(vdir)
                layers, raw = weights_for(cks[0])
                if arch is None:
                    arch = [{"fo": l["fo"], "fi": l["fi"]} for l in layers]
                wpayload[c] = {"layers": layers, "curves": cur,
                               "ckpt": os.path.basename(cks[0])}
                tests[c] = test
                first[(key, c)] = raw[0]
                for vals, spec in zip(raw, layers):
                    bound = spec["fi"] ** -0.5
                    n = len(vals)
                    mean = sum(vals) / n
                    var = sum(v * v for v in vals) / n - mean * mean
                    ratios.append((max(0.0, var) ** 0.5) / (bound / 3 ** 0.5))
                    beyond.append(sum(1 for v in vals if abs(v) > bound) / n)
                for split in ("tr", "va"):
                    seq = cur.get("r2", {}).get(split)
                    if seq:
                        finalR2[split].append(seq[-1])
            rec["test"] = tests

            path = os.path.join(OUT, "weights", key + ".js")
            with open(path, "w") as fh:
                fh.write("/* real checkpoint tensors and training curves\n"
                         "   source: %s\n"
                         "   41-64-32-16-1 MLP, float32 little-endian, base64 */\n"
                         % rec["dir"])
                fh.write("EDA_REAL.putRun(%s,%s);\n" % (
                    json.dumps(key), json.dumps(wpayload, separators=(",", ":"))))
            rec["bytes"] = os.path.getsize(path)
            runs[key] = rec
            print("%-26s %2d circuits  %6.0f kB" % (key, len(wpayload), rec["bytes"] / 1024))

    # Cosine similarity of first-layer weights, precomputed so the explorer can
    # draw both panels without pulling all twenty weight files.
    runkeys = [f"{p}_{s}" for p in PDKS for s in STAGES]
    byRun, byCircuit = {}, {}
    for k in runkeys:
        Ws = [first[(k, c)] for c in circuits]
        byRun[k] = triu([[cosine(a, b) for b in Ws] for a in Ws])
    for c in circuits:
        Ws = [first[(k, c)] for k in runkeys]
        byCircuit[c] = triu([[cosine(a, b) for b in Ws] for a in Ws])

    flat_run = [v for k in byRun for v in byRun[k]]
    flat_cir = [v for c in byCircuit for v in byCircuit[c]]

    stats = {
        "checkpoints": len(first),
        "gradientSteps": 50,
        "epochs": 25,
        "medianFinalTrainR2": r(median(finalR2["tr"]), 4),
        "medianFinalValR2": r(median(finalR2["va"]), 4),
        "medianStdRatio": r(median(ratios), 4),
        "medianBeyondBound": r(median(beyond), 6),
        "cosAcrossCircuits": {"median": r(median(flat_run), 4),
                              "min": r(min(flat_run), 4), "max": r(max(flat_run), 4)},
        "cosAcrossConfigs": {"median": r(median(flat_cir), 4),
                             "min": r(min(flat_cir), 4), "max": r(max(flat_cir), 4)},
    }
    print("audit:", json.dumps(stats["cosAcrossCircuits"]), json.dumps(stats["cosAcrossConfigs"]),
          "medR2tr", stats["medianFinalTrainR2"], "stdRatio", stats["medianStdRatio"])

    manifest = {
        "cos": {"order": runkeys, "byRun": byRun, "byCircuit": byCircuit},
        "stats": stats,
        "task": "total_area",
        "taskDir": "total_area_prediction",
        "model": "fixed_mlp",
        "config": "default_config",
        "arch": arch,
        "circuits": circuits,
        "pdks": PDKS,
        "stages": STAGES,
        "runs": runs,
    }
    js = os.path.join(OUT, "real.js")
    with open(js, "w") as fh:
        fh.write("/* Real results from the ICE Lab total_area_prediction / fixed_mlp sweep.\n"
                 "   Generated from the run tree; see README. Do not hand-edit. */\n")
        fh.write("window.EDA_REAL=Object.assign(window.EDA_REAL||{},")
        fh.write(json.dumps(manifest, separators=(",", ":")))
        fh.write(");\n")
    print("manifest %.0f kB" % (os.path.getsize(js) / 1024))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        SRC = sys.argv[1]
    if len(sys.argv) > 2:
        OUT = sys.argv[2]
    if not os.path.isdir(SRC):
        sys.exit("run tree not found: %s\n"
                 "usage: python3 tools/extract.py <.../total_area_prediction/fixed_mlp> [outdir]"
                 % SRC)
    main()
