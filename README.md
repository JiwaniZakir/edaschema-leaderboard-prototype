# EDA-Schema Leaderboard

Interaction prototype for the [EDA-Schema-V2](https://arxiv.org/abs/2605.06952)
benchmark, styled to match the [ICE Lab site](https://drexel-ice.github.io/).

Three linked pages. No build step, no dependencies, no backend.

| Page | What it does |
|---|---|
| `index.html` | Matrix of 46 metric rows × 5 stages × 4 PDKs. Click a cell for rankings, a rank matrix, a contextual problem breakdown, and five chart views. |
| `explorer.html` | One submission at a time: 3D unit view, vertical op graph, weight matrices, training curves, and the evidence that these checkpoints never trained. |
| `playground.html` | Pick a problem, choose which schema attributes feed in, shape a network, train it in-browser, try to beat OpenROAD — and the lab's own run. |

## The flow

```
matrix → cell ─┬─ About (the problem, this stage, this PDK)
               ├─ Rank matrix (every model, every metric)
               └─ a model → explorer → playground
                              ↑___________|
```

Task, PDK, stage, metric, model and circuit travel in the URL in both
directions, so every view is deep-linkable and every page can hand you back to
the cell you came from. `index.html` restores its cell from the address and
pushes history, so the browser's back button works across the whole flow.

## The real submission

`total_area` / `fixed_mlp` is not a mock. It is the lab's own sweep, read
straight out of the run tree:

```
total_area_prediction/fixed_mlp/default_config_<PDK>_<stage>/<circuit>/version_0/
    checkpoints/epoch=24-step=50.ckpt      41-64-32-16-1, 5,313 parameters
    events.out.tfevents.*                  25 epochs of loss / MAE / MAPE / R²
    hparams.yaml                           SGD, lr 0.01, batch 1024, MSELoss
eval.log                                   per-circuit MAE / MAPE / R² vs OpenROAD
aggregated_eval_metrics.csv                the 20 configuration aggregates
run.log                                    wall clock, peak GPU, dataset path
```

4 PDKs × 5 stages × 18 circuits = **360 checkpoints**. All of them are on the
site. The leaderboard row, the matrix cell, the weight matrices, the null
overlay, the column norms, the cosine matrices, the training curves and the
playground's second target line are all that data and nothing else.

What it shows, honestly: at 50 gradient steps the weights are still at
initialization — median final training R² **0.0203**, observed weight spread
**0.999×** the untrained `U(±1/√fan_in)` null, cosine **0.9999** for one circuit
across all 20 configurations and **0.002** across circuits within one. The model
still beats the OpenROAD floorplan estimate on MAE, because predicting near the
mean beats an estimate that is biased low. The explorer says so on the page.

## Regenerating the data

```bash
python3 tools/extract.py /path/to/total_area_prediction/fixed_mlp
```

Standard library only — no torch, no numpy. `tools/ckpt.py` reads PyTorch
Lightning checkpoints by unpacking the zip and resolving the pickle's storage
references itself; `tools/tfevents.py` walks the TFRecord frames and the Event
protobuf far enough to reach the scalar summaries. Output:

| File | Size | Contents |
|---|---|---|
| `data/real.js` | 127 kB | manifest: architecture, per-run and per-circuit metrics, run provenance, cosine matrices, audit statistics |
| `data/weights/<pdk>_<stage>.js` | 532 kB × 20 | checkpoint tensors (base64 float32) and training curves for that configuration's 18 circuits |

`real-data.js` is the shared access layer. Weight bundles load on demand, by
injecting a `<script>` tag rather than `fetch()`, so the pages still work when
opened straight off the filesystem.

## Real vs synthetic

| | Status |
|---|---|
| OpenROAD baselines — 46 metrics × 4 PDKs × 5 stages | **Real**, from the [published Table 8](https://drexel-ice.github.io/eda-schema/) |
| `fixed_mlp` under Total area — weights, curves, per-circuit scores, run cost | **Real**, from the run tree above |
| Void (40), saturated (132), no-± (24) cells | **Real** |
| Circuit characteristics, clock periods, parameter sweep, QoR ranges | **Real** — Tables 2, 4, 5, 6 |
| Parameter–metric correlations | **Reproduced**, mean error 0.020 across 80 published coefficients |
| The other 18 model names, scores, ranks and weights | **Synthetic**, seeded and deterministic |
| Per-instance feature values | **Modelled** — the checkpoints are published, the dataset Parquet is not |
| Design-stage illustrations | **Illustrative renderings**, not dataset images |

Every page carries a banner saying which of these it is showing, and the one
real row is tagged `REAL` wherever it appears.

## Running locally

```bash
python3 -m http.server 8000
```

## Deploying

Push to `main`. The included workflow provisions GitHub Pages and deploys.
If it fails on a fresh repo, set **Settings → Pages → Source → GitHub Actions**.

## Verified

```
metric rows        46        cells      920
void               40        live       880
saturated         132        no ± error  24
live combos       232        openable cells opened  232 / 232
About renders     240 / 240 with zero failures
baselines match Table 8 across all 80 non-void, non-saturated cells
real checkpoints  360 / 360 parsed, 20 / 20 configurations loadable
leaderboard, explorer and playground walked end to end with zero console errors
```
