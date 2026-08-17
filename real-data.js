/* ===================================================================
   Shared access layer for the lab's real results.

   data/real.js carries the manifest: architecture, per-run and
   per-circuit evaluation metrics, precomputed cosine matrices and the
   audit statistics. Checkpoint tensors and training curves are large,
   so they live one file per (PDK, stage) under data/weights/ and are
   pulled in on demand.

   Loading is done by injecting a <script> tag rather than fetch(), so
   every page keeps working when opened straight off the filesystem.
   =================================================================== */
window.EDA_REAL = Object.assign(window.EDA_REAL || {}, {

  /* the one task, model and config the lab has actually published */
  REAL_TASK: "total_area",
  REAL_MODEL: "fixed_mlp",

  wcache: {},        // "<pdk>_<stage>" -> {circuit: {layers, curves, ckpt}}
  _waiting: {},      // key -> [callback]

  runKey(pdk, stage) { return pdk + "_" + stage; },

  /* manifest lookups ------------------------------------------------ */
  hasRun(pdk, stage) {
    return !!(this.runs && this.runs[this.runKey(pdk, stage)]);
  },
  run(pdk, stage) {
    return this.runs ? this.runs[this.runKey(pdk, stage)] : null;
  },
  /* [MAE, MAPE fraction, R2] as reported by the lab's eval pass */
  agg(pdk, stage, which) {
    const r = this.run(pdk, stage);
    return r ? r.agg[which || "m"] : null;
  },
  circuitEval(pdk, stage, circuit) {
    const r = this.run(pdk, stage);
    return r && r.circuits ? r.circuits[circuit] : null;
  },
  /* final test scalars, in the z-scored space the model trained in */
  circuitTest(pdk, stage, circuit) {
    const r = this.run(pdk, stage);
    return r && r.test ? r.test[circuit] : null;
  },

  /* is this leaderboard row the lab's real submission? */
  isReal(task, model) {
    return task === this.REAL_TASK && model === this.REAL_MODEL;
  },

  /* cosine matrices ------------------------------------------------- */
  /* Stored as upper triangles; expand to a full symmetric matrix. */
  _expand(tri, n) {
    const m = Array.from({ length: n }, () => new Array(n).fill(1));
    let k = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) { m[i][j] = m[j][i] = tri[k++]; }
    return m;
  },
  cosAcrossCircuits(pdk, stage) {
    const tri = this.cos && this.cos.byRun[this.runKey(pdk, stage)];
    return tri ? this._expand(tri, this.circuits.length) : null;
  },
  cosAcrossConfigs(circuit) {
    const tri = this.cos && this.cos.byCircuit[circuit];
    return tri ? this._expand(tri, this.cos.order.length) : null;
  },

  /* weights --------------------------------------------------------- */
  putRun(key, payload) {                       // called by data/weights/*.js
    this.wcache[key] = payload;
    (this._waiting[key] || []).forEach(fn => fn(payload));
    delete this._waiting[key];
  },
  loadRun(pdk, stage, cb) {
    const key = this.runKey(pdk, stage);
    if (this.wcache[key]) { cb(this.wcache[key]); return; }
    if (this._waiting[key]) { this._waiting[key].push(cb); return; }
    this._waiting[key] = [cb];
    const s = document.createElement("script");
    s.src = (this.base || "data/") + "weights/" + key + ".js";
    s.onerror = () => {                        // missing file: fall back quietly
      const pending = this._waiting[key] || [];
      delete this._waiting[key];
      pending.forEach(fn => fn(null));
    };
    document.head.appendChild(s);
  },

  /* base64 float32 -> Float32Array */
  decode(b64) {
    const bin = atob(b64), n = bin.length;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  },

  /* One circuit's checkpoint in the shape the explorer draws:
     [{kind,fi,fo,W,B,bound,shape,label}]                              */
  layersFor(pdk, stage, circuit) {
    const run = this.wcache[this.runKey(pdk, stage)];
    const rec = run && run[circuit];
    if (!rec) return null;
    return rec.layers.map((l, i) => ({
      kind: "linear", fi: l.fi, fo: l.fo,
      W: this.decode(l.w), B: this.decode(l.b),
      bound: 1 / Math.sqrt(l.fi), shape: [l.fo, l.fi],
      label: "linear", real: true, idx: i,
    }));
  },
  curvesFor(pdk, stage, circuit) {
    const run = this.wcache[this.runKey(pdk, stage)];
    const rec = run && run[circuit];
    return rec ? rec.curves : null;
  },
  ckptName(pdk, stage, circuit) {
    const run = this.wcache[this.runKey(pdk, stage)];
    const rec = run && run[circuit];
    return rec ? rec.ckpt : null;
  },
});
