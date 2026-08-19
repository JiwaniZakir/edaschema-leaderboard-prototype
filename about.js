/* Contextual About page — the same cell write-up the leaderboard About tab
   renders for a (task, PDK, stage). Arena and the leaderboard both call
   EDA_ABOUT.render(host, ctx) so the copy and illustrations stay in one place. */
(function (global) {
  const PDKINFO = {
    ng45: { label: "NG45", node: "45 nm", metals: 10, util: "40%",
      note: "Academic PDK bridging modern process challenges with accessible flows." },
    sky130: { label: "SKY130", node: "130 nm", metals: 5, util: "30%",
      note: "Mature node, widely used in academic and open-source EDA. Only five metal layers, so routing is the binding constraint." },
    ihp130: { label: "IHP130", node: "130 nm", metals: 7, util: "30%",
      note: "SiGe BiCMOS, supporting RF, analog and mixed-signal research." },
    asap7: { label: "ASAP7", node: "7 nm", metals: 9, util: "40%",
      note: "Predictive node for exploring advanced scaling. Everything is small, so absolute errors look tiny while relative errors do not." }
  };

  const STAGEINFO = {
    floorplan: {
      title: "Floorplanning",
      what: "The die outline, core area and I/O pin positions are fixed. Standard-cell rows are defined but nothing is placed in them yet.",
      known: "Cell counts, net counts, target utilisation, die dimensions.",
      unknown: "Where anything sits. No wirelength exists because no cell has a location.",
      why: "This is the cheapest place to change course and the hardest place to predict from — the estimate is built almost entirely from counts."
    },
    global_place: {
      title: "Global placement",
      what: "Cells are given approximate positions that minimise a wirelength proxy. They overlap and sit off-row.",
      known: "Approximate coordinates, so half-perimeter wirelength becomes computable for the first time.",
      unknown: "Legal positions, buffering, clock network, actual routes.",
      why: "HPWL appears here, which is why wirelength tasks activate at this stage and are void before it."
    },
    detailed_place: {
      title: "Detailed placement",
      what: "Cells are legalised into rows with no overlaps. Local swaps and shifts improve timing and density.",
      known: "Exact legal cell coordinates, refined HPWL, updated cell areas.",
      unknown: "Clock buffers, routing detours, parasitic RC.",
      why: "Area is nearly settled here. Timing is not — the clock network has not been built."
    },
    cts: {
      title: "Clock tree synthesis",
      what: "The clock network is built: buffers inserted, sinks balanced, skew controlled. This adds real cells and real area.",
      known: "Clock buffer count, sink count, clock routing, post-CTS timing.",
      unknown: "Signal routing detours and extracted parasitics.",
      why: "The last stage where area and power move meaningfully. After CTS the estimates converge fast."
    },
    global_route: {
      title: "Global routing",
      what: "Nets are assigned to coarse routing regions and metal layers. Congestion is resolved but exact geometry is not fixed.",
      known: "Layer assignment, congestion maps, close-to-final wirelength.",
      unknown: "Exact via placement and detailed geometry.",
      why: "For ten of the twelve tasks the estimate here already equals the final value. Those cells are saturated and cannot be won."
    }
  };

  const TASKINFO = {
    total_area: {
      predicts: "the total silicon area the design occupies after detailed routing",
      unit: "\u00b5m\u00b2",
      matters: "Area is the direct cost driver. A 10% area miss at floorplan means the die is sized wrong and the mistake is discovered after routing, when fixing it means restarting.",
      physics: "Area grows through the flow as the tool inserts buffers, upsizes gates for timing, and adds filler and tap cells. Most of that growth happens at CTS.",
      hard: "Early estimates only know cell counts, not what optimisation will add."
    },
    total_power: {
      predicts: "total power draw after detailed routing",
      unit: "\u00b5W",
      matters: "Power budget determines packaging, cooling and battery life. Getting it wrong late is expensive.",
      physics: "Switching power depends on capacitance, which depends on wirelength, which does not exist until placement. Clock buffers added at CTS often dominate.",
      hard: "The largest single contributor \u2014 the clock network \u2014 does not exist until CTS."
    },
    total_wirelength: {
      predicts: "total routed wirelength after detailed routing",
      unit: "\u00b5m",
      matters: "Wirelength drives delay, power and congestion simultaneously. It is the single best proxy for whether a floorplan is viable.",
      physics: "Before placement there is no geometry at all. After placement, HPWL underestimates routed length because real routes detour around blockages.",
      hard: "Not estimable at floorplan. Even at global place, HPWL is systematically 20\u201330% below the routed value."
    },
    interconnect_length: {
      predicts: "the routed length of each individual net",
      unit: "\u00b5m",
      matters: "A handful of very long nets set the critical path. Predicting the mean well while missing the tail is not useful.",
      physics: "Net length is long-tailed: most nets are short and local, a few span the die.",
      hard: "This is why the task carries P95 and TOP5 metrics alongside the mean."
    },
    worst_arrival_time: {
      predicts: "the latest signal arrival time in the design",
      unit: "ns",
      matters: "Arrival time determines whether the clock period is achievable.",
      physics: "Arrival accumulates cell delays and wire delays along a path. Wire delay is unknown before routing.",
      hard: "Early estimates lack parasitic RC entirely."
    },
    worst_slack: {
      predicts: "the worst timing slack across all endpoints",
      unit: "ns",
      matters: "Negative worst slack means the design fails timing. This is the go/no-go number.",
      physics: "Slack is required time minus arrival time \u2014 a difference of two large numbers, so it is numerically delicate and clusters near zero.",
      hard: "Because slack clusters near zero, percentage error explodes. MAPE is not reported for this task; directional metrics are used instead."
    },
    total_negative_slack: {
      predicts: "the sum of negative slack over all violating endpoints",
      unit: "ns",
      matters: "Worst slack tells you the deepest violation; TNS tells you how widespread the problem is.",
      physics: "TNS is zero for a clean design and grows sharply once violations appear, so its distribution is heavily skewed.",
      hard: "A single number spans zero to thousands, so absolute error is dominated by the worst designs."
    },
    timing_path_arrival_time: {
      predicts: "arrival time for each individual timing path",
      unit: "ns",
      matters: "Path-level prediction lets a designer see which paths are at risk, not just that some path is.",
      physics: "Paths are matched between stages by startpoint, endpoint and check type. Paths that are added or restructured are excluded.",
      hard: "Long-tailed: the slowest 5% of paths are what matter, hence the TOP5 metrics."
    },
    timing_path_slack: {
      predicts: "slack for each individual timing path",
      unit: "ns",
      matters: "Identifies which specific paths will violate, early enough to fix them cheaply.",
      physics: "Same difference-of-large-numbers problem as worst slack, now per path.",
      hard: "Directional error matters: over-estimating slack hides a violation."
    },
    net_arc_delay: {
      predicts: "delay across each net timing arc",
      unit: "ns",
      matters: "Net delay is where interconnect parasitics enter the timing picture.",
      physics: "Determined by the RC of the routed wire, which does not exist before routing.",
      hard: "Values are near zero at early stages, so R\u00b2 goes sharply negative and MAPE exceeds 10000%."
    },
    cell_arc_delay: {
      predicts: "delay through each cell timing arc",
      unit: "ns",
      matters: "Cell delay is the other half of path delay, driven by load and input slew.",
      physics: "Depends on output load capacitance, which depends on the routed net.",
      hard: "Values are around 0.001 ns and reported to four decimals, so precision limits how finely models can be ranked."
    },
    cell_arc_slew: {
      predicts: "output transition time for each cell arc",
      unit: "ns",
      matters: "Slew propagates: a slow transition degrades the next stage's delay.",
      physics: "Set by drive strength against load capacitance.",
      hard: "Like the other arc metrics, near-zero early values destabilise relative error measures."
    }
  };

  const METRICDESC = {
    "MAE": "Mean absolute error in the metric's own units. The primary ranking number for most tasks.",
    "MAPE": "Mean absolute percentage error. Unstable when the target approaches zero, which is why several tasks omit it.",
    "R\u00b2": "Fraction of variance explained. Goes sharply negative when the target has little variance across the evaluation set.",
    "MAE-P95": "Absolute error at the 95th percentile. Measures the tail rather than the average.",
    "MAPE-P95": "Percentage error at the 95th percentile.",
    "MAE-TOP5": "Absolute error on the largest 5% of instances \u2014 the ones that actually constrain the design.",
    "MAPE-TOP5": "Percentage error on the largest 5%.",
    "MPE": "Mean over-estimate. For timing, over-estimating delay is the safe direction.",
    "MNE": "Mean under-estimate. Under-estimating delay hides a violation, so this is the dangerous direction.",
    "TPR": "True positive rate \u2014 how often a genuinely violating endpoint is correctly flagged.",
    "TNR": "True negative rate \u2014 how often a clean endpoint is correctly cleared."
  };

  const SL = ["floorplan", "global place", "detailed place", "cts", "global route"];
  const STAGES = ["floorplan", "global_place", "detailed_place", "cts", "global_route"];
  const FVEC = [["netlist", 9, "#5b7fc4"], ["cell &amp; area metrics", 19, "#c47f5b"],
                ["power metrics", 7, "#5bc48f"], ["timing metrics", 6, "#a05bc4"]];

  function lrng(s) {
    let a = 0;
    for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619);
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function drawLayout(cv, stage, pdk, W, H) {
    const ctx = cv.getContext("2d"), r = lrng(stage + pdk);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    cv.width = W; cv.height = H;
    ctx.fillStyle = dark ? "#001d36" : "#ffffff"; ctx.fillRect(0, 0, W, H);
    const M = 14, cw = W - 2 * M, chh = H - 2 * M;
    const ink = dark ? "#8a8781" : "#6c757d", cell = dark ? "#6da3d8" : "#3b6fb0";

    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(M, M, cw, chh);
    ctx.strokeStyle = dark ? "#3a3a3c" : "#e0ded9";
    ctx.strokeRect(M + 7, M + 7, cw - 14, chh - 14);

    const nRows = Math.floor(chh / 7);
    const stageIdx = STAGES.indexOf(stage);

    if (stageIdx >= 0) {
      ctx.strokeStyle = dark ? "#2b2b2c" : "#f2f0ec"; ctx.lineWidth = 1;
      for (let i = 1; i < nRows; i++) {
        ctx.beginPath(); ctx.moveTo(M + 7, M + 7 + i * 7); ctx.lineTo(W - M - 7, M + 7 + i * 7); ctx.stroke();
      }
    }

    ctx.fillStyle = dark ? "#dd9558" : "#c06a2e";
    for (let i = 0; i < 26; i++) {
      const side = Math.floor(r() * 4), t = 0.08 + r() * 0.84;
      let x, y;
      if (side === 0) { x = M + t * cw; y = M; }
      else if (side === 1) { x = W - M; y = M + t * chh; }
      else if (side === 2) { x = M + t * cw; y = H - M; }
      else { x = M; y = M + t * chh; }
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    if (stageIdx >= 1) {
      ctx.fillStyle = cell;
      for (let i = 0; i < 520; i++) {
        let x = M + 9 + r() * (cw - 18), y;
        if (stageIdx === 1) {
          y = M + 9 + r() * (chh - 18);
          ctx.globalAlpha = .55; ctx.fillRect(x, y, 2.6, 3.4);
        } else {
          const row = Math.floor(r() * (nRows - 1));
          y = M + 7 + row * 7 + 1.2;
          ctx.globalAlpha = .8; ctx.fillRect(x, y, 2.4, 4.4);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (stageIdx >= 3) {
      ctx.strokeStyle = dark ? "#8ed69a" : "#2a6b34"; ctx.lineWidth = 1.1; ctx.globalAlpha = .85;
      const cx = W / 2, cy = H / 2;
      const branch = (x, y, len, depth, ang) => {
        if (depth === 0) return;
        for (const d of [-1, 1]) {
          const nx = x + Math.cos(ang + d * Math.PI / 2) * len;
          const ny = y + Math.sin(ang + d * Math.PI / 2) * len;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, y); ctx.lineTo(nx, ny); ctx.stroke();
          ctx.fillStyle = dark ? "#8ed69a" : "#2a6b34"; ctx.fillRect(nx - 1.6, ny - 1.6, 3.2, 3.2);
          branch(nx, ny, len * 0.55, depth - 1, ang + Math.PI / 2);
        }
      };
      branch(cx, cy, chh * 0.26, 3, 0);
      ctx.globalAlpha = 1;
    }

    if (stageIdx >= 4) {
      const layers = PDKINFO[pdk].metals;
      for (let L = 0; L < Math.min(layers, 6); L++) {
        const hue = [210, 28, 150, 275, 45, 190][L];
        ctx.strokeStyle = `hsla(${hue},55%,${dark ? 60 : 42}%,.42)`;
        ctx.lineWidth = L % 2 ? 1.4 : 1;
        const vert = L % 2 === 0;
        for (let i = 0; i < 34; i++) {
          ctx.beginPath();
          if (vert) {
            const x = M + 9 + r() * (cw - 18);
            ctx.moveTo(x, M + 9 + r() * chh * .3);
            ctx.lineTo(x, H - M - 9 - r() * chh * .3);
          } else {
            const y = M + 9 + r() * (chh - 18);
            ctx.moveTo(M + 9 + r() * cw * .3, y);
            ctx.lineTo(W - M - 9 - r() * cw * .3, y);
          }
          ctx.stroke();
        }
      }
    }
  }

  function drawCongestion(cv, stage, pdk, W, H) {
    const ctx = cv.getContext("2d"), r = lrng(stage + pdk + "rudy");
    cv.width = W; cv.height = H;
    const G = 26, cw = W / G, chh = H / G;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const hot = [[0.32, 0.38, 0.20], [0.68, 0.62, 0.16], [0.5, 0.2, 0.11]];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const u = i / G, v = j / G;
      let d = 0.12 + r() * 0.16;
      for (const [hx, hy, hr] of hot) {
        const dist = Math.hypot(u - hx, v - hy);
        d += Math.exp(-(dist * dist) / (2 * hr * hr)) * 0.85;
      }
      d = Math.min(1, d);
      const hue = 225 - d * 225;
      ctx.fillStyle = `hsla(${hue},70%,${dark ? (18 + d * 38) : (94 - d * 46)}%,1)`;
      ctx.fillRect(i * cw, j * chh, cw + .6, chh + .6);
    }
  }

  function drawFeatureVector(root) {
    const el = root.querySelector("#ivec");
    if (!el) return;
    const tot = FVEC.reduce((a, g) => a + g[1], 0);
    el.innerHTML =
      `<div class="ivbar">` + FVEC.map(([n, c, col]) =>
        `<span class="ivseg" style="width:${c / tot * 100}%;background:${col}" ` +
        `title="${n} \u2014 ${c} attributes"><b>${c}</b></span>`).join("") + `</div>` +
      `<div class="ivkey">` + FVEC.map(([n, c, col]) =>
        `<span><i style="background:${col}"></i>${n}</span>`).join("") + `</div>` +
      `<div class="ivcells">` + Array.from({ length: tot }, (_, i) => {
        let acc = 0, col = "#999";
        for (const [, c, cc] of FVEC) { if (i < acc + c) { col = cc; break; } acc += c; }
        return `<i style="background:${col}"></i>`;
      }).join("") + `</div>` +
      `<div class="ivnote"><b>${tot}</b> scalars in, one value out &mdash; ` +
        `the whole design compressed to a ${tot}-dimensional vector before the network sees it.</div>`;
  }

  function render(host, ctx) {
    const task = ctx.task, pdk = ctx.pdk, stage = ctx.stage;
    const T = TASKINFO[task], P = PDKINFO[pdk], S = STAGEINFO[stage];
    if (!host || !T || !P || !S) return;
    const si = STAGES.indexOf(stage);
    const sn = SL[si];
    const label = ctx.taskLabel;
    const ms = ctx.metrics;
    const cellState = ctx.cellState;
    const baseVal = ctx.baseVal;
    const fmt = ctx.fmt;
    const hi = ctx.hi;

    const sat = ms.every(m => {
      const st = cellState(task, m, pdk, si);
      return st === "sat" || st === "undef";
    });
    const vd = ms.every(m => baseVal(task, m, pdk, si) === null);
    const beat = vd ? "the tool" : fmt(baseVal(task, ms[0], pdk, si), ms[0]);

    host.innerHTML = `
<div class="ab">
  <div class="abhead">
    <div>
      <div class="abkick">the problem behind this ranking</div>
      <h2 class="abtitle">${label} at ${P.label}, predicted from ${sn}</h2>
      <p class="ablead">${T.predicts.charAt(0).toUpperCase() + T.predicts.slice(1)},
      predicted using only what the tool knows after <b>${sn}</b> &mdash; several stages before
      the answer exists.</p>
    </div>
  </div>

  <div class="abgrid">
    <div class="abstat"><div class="t">what is predicted</div><div class="v">${label}</div>
      <div class="s">${T.unit}</div></div>
    <div class="abstat"><div class="t">from</div><div class="v">${sn}</div>
      <div class="s">to detailed route</div></div>
    <div class="abstat"><div class="t">technology</div><div class="v">${P.label}</div>
      <div class="s">${P.node} &middot; ${P.metals} metal layers</div></div>
    <div class="abstat"><div class="t">baseline to beat</div>
      <div class="v mono">${vd ? "n/a" : fmt(baseVal(task, ms[0], pdk, si), ms[0])}</div>
      <div class="s">OpenROAD ${ms[0]}</div></div>
  </div>

  <h2>Why this is hard</h2>
  <p>${T.matters}</p>
  <p><b>The physics.</b> ${T.physics}</p>
  <div class="abcall"><p>${T.hard}</p></div>

  <h2>What the tool knows at ${sn}</h2>
  <p>${S.what}</p>
  <div class="abfigs">
    <figure><canvas id="fig-stage"></canvas>
      <figcaption><b>${S.title}</b> &mdash; ${P.label} die. Cell rows, I/O pins on the boundary,
      ${si >= 1 ? "placed standard cells" : "no cells placed yet"}${si >= 3 ? ", clock tree in green" : ""}${si >= 4 ? `, routing across ${Math.min(P.metals, 6)} metal layers` : ""}.</figcaption></figure>
    <figure><canvas id="fig-cong"></canvas>
      <figcaption><b>Routing demand</b> &mdash; RUDY-style congestion map. Hot regions are where
      routing is likely to fail, and where early estimates are least reliable.</figcaption></figure>
  </div>
  <p class="abnote">Illustrative renderings of the structures the dataset stores as binary spatial
  maps and scalar heatmaps (EDA-Schema-V2 &sect;3.2, &sect;3.6). Real per-design images ship with the
  dataset as NumPy arrays.</p>

  <table class="abtab">
    <tr><th style="width:22%">Available here</th><td>${S.known}</td></tr>
    <tr><th>Still unknown</th><td>${S.unknown}</td></tr>
    <tr><th>Why it matters</th><td>${S.why}</td></tr>
  </table>

  <h2>Why ${P.label} behaves the way it does</h2>
  <p>${P.note}</p>
  <p>With <b>${P.metals} metal layers</b> and a core utilisation target of ${P.util}, routing
  resources ${P.metals <= 5 ? "are scarce, so congestion appears early and wirelength estimates degrade" :
    P.metals >= 9 ? "are plentiful, so routing rarely dominates and errors come mostly from cell-level effects" :
    "are moderate, sitting between the extremes of SKY130 and NG45"}.
  Absolute errors across PDKs are not comparable &mdash; ${P.label} designs
  ${pdk === "asap7" ? "are physically tiny, so a small absolute error can still be a large relative one" :
    pdk === "ihp130" ? "are physically large, which inflates absolute error even when relative accuracy is good" :
    "sit in the middle of the range"}. Compare within a column, not across.</p>

  <h2>What the model actually sees</h2>
  <p>A submission does not read the design. It reads a <b>feature vector</b> assembled
  from the schema attributes that exist at ${sn}. The lab's configuration uses 41 scalars
  drawn from four entities; the schema defines more, but they do not exist yet at this stage.</p>

  <div class="ivec" id="ivec"></div>

  <table class="abtab">
    <tr><th style="width:24%">netlist</th><td>9 attributes &mdash; input/output/cell/net/pin counts,
      utilisation, die width and height, total HPWL. Structural size, known from floorplan.</td></tr>
    <tr><th>cell &amp; area metrics</th><td>19 attributes &mdash; combinational, sequential, buffer,
      inverter, filler, tap and diode counts, and the area each occupies.</td></tr>
    <tr><th>power metrics</th><td>7 attributes &mdash; combinational, sequential, macro, internal,
      switching and leakage power, and their total.</td></tr>
    <tr><th>timing metrics</th><td>6 attributes &mdash; total negative slack, worst slack, worst
      arrival and required time, endpoint counts.</td></tr>
  </table>

  <div class="abcall"><p>Every one of the 41 is available from floorplan onward, which is why the
  same configuration runs at all five stages. The cost is that the model gains nothing from
  reaching a later stage: at CTS the tool knows the clock-buffer count, at global route it knows
  wirelength and congestion, and this feature set sees none of it.</p></div>

  <h2>The baseline</h2>
  <p>Every number in the ranking is measured against the OpenROAD estimate at ${sn}, taken from
  Table 8 of the EDA-Schema-V2 paper rather than re-derived. It is not a model &mdash; it is what
  the tool already reports for free, and it is the thing a machine-learning method has to be worth
  replacing.</p>
  ${sat ? `<div class="abcall warn"><p><b>This cell is saturated.</b> At ${sn} the tool estimate
    already equals the final value, so the error is exactly zero and no model can improve on it.
    Ten of the twelve tasks are saturated at global route. These cells stay browsable but are never
    ranked.</p></div>` : ""}
  ${vd ? `<div class="abcall warn"><p><b>This cell is not estimable.</b> ${label} has no meaning before
    cells are placed, so there is no floorplan-stage estimate to compare against.</p></div>` : ""}

  <h2>Metrics used here, and why these</h2>
  <table class="abtab">
    ${ms.map(m => `<tr><th style="width:22%">${m}</th><td>${METRICDESC[m] || ""}
      <span class="abdir">${hi(m) ? "higher is better" : "lower is better"}</span></td></tr>`).join("")}
  </table>
  <p>Each metric is ranked independently. There is no aggregate score, because averaging an error in
  micrometres against a true-positive rate needs weights nobody can defend, and it would let a model
  with a catastrophic R&sup2; hide behind a good MAE.</p>

  <h2>The models on this leaderboard</h2>
  <p>Submissions come from five families, each bringing a different assumption about what predicts
  final quality-of-results.</p>
  <table class="abtab">
    <tr><th style="width:22%">MLP</th><td>Fixed multilayer perceptron over the 41 scalar features.
      The simplest baseline: no topology, no spatial information, just aggregate counts and areas.</td></tr>
    <tr><th>GNN</th><td>Graph neural networks over the netlist graph, where nodes are gates, pins,
      nets and ports. Captures connectivity that scalar features flatten away.</td></tr>
    <tr><th>CNN</th><td>Convolutional networks over the spatial layout maps &mdash; cell placement,
      pin density, RUDY congestion. Captures where things are, which matters for routing.</td></tr>
    <tr><th>AutoML</th><td>Automated tree ensembles over the scalar features. Often a strong
      baseline on tabular problems and a useful check on whether deep learning is earning its keep.</td></tr>
    <tr><th>Hybrid</th><td>Combined graph and image branches with a fusion head, for tasks where
      both topology and geometry matter.</td></tr>
  </table>
  <p>Every submission declares which of the schema's attributes it reads. Because EDA-Schema-V2
  records the stage at which each attribute becomes available, a model claiming to predict from
  ${sn} while reading a post-route attribute is rejected automatically.</p>

  <div class="abcta">
    <div>
      <div class="abctat">Think you can do better?</div>
      <div class="abctas">Build a network, train it here on real design data, and see if you can
      beat ${beat}.</div>
    </div>
    <a class="btn primary" id="ab-beat" href="${ctx.playgroundHref || "playground.html"}">Beat OpenROAD &rarr;</a>
  </div>
</div>`;

    drawFeatureVector(host);
    const figStage = host.querySelector("#fig-stage");
    const figCong = host.querySelector("#fig-cong");
    if (figStage) drawLayout(figStage, stage, pdk, 520, 340);
    if (figCong) drawCongestion(figCong, stage, pdk, 340, 340);
  }

  global.EDA_ABOUT = { render, PDKINFO, STAGEINFO, TASKINFO };
})(window);
