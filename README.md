# Fermi

An experimental simulator for the Fermi paradox. Technological species arise across a
scaled-down sample of the universe, look at their sky, and either die, stay home or
expand. The ones that expand carry a mutating genome of strategy traits, so selection
acts on how civilisations behave. The question every run answers: **how many
civilisations look up and see nobody, and which assumptions make that common?**

## What is modelled, and what is pruned

| Level | Modelled | Pruned |
| --- | --- | --- |
| Cosmology | Flat ΛCDM expansion, light travel, the event horizon, cosmic star formation history | Radiation era, local dynamics |
| Universe | A periodic comoving box of galaxy groups ("nodes") with clustering and mass | Individual galaxies; each node stands for hundreds |
| Biology | Carter's hard steps against habitable windows of G, K and M stars, plus metallicity | Every planet that doesn't produce a technological species. These are counted analytically, never instantiated |
| Civilisations | Filter survival, expansion, probes at a fraction of c, conflict weighted by empire size, collapse | Everything inside a node: crossing a galaxy is noise next to crossing between groups |
| Technology | A four-rung ladder (interstellar probes → Dyson swarms → relativistic kinetic weapons → galactic engineering) that raises speed, sensor range, strength and waste heat | Specific inventions; a rung is a capability level, not a device |
| Detection | Waste heat on the past light cone, dimmed by redshift. Exact inside half the box; beyond it, estimated from the box's own luminosity census | Radio leakage, which is too faint to cross between galaxies |
| Dark forest | Strike-capable lineages scan their sky, fire at what they see (optionally destroying nearby holdings too), and can be traced and answered. Victims learn to hide. Berserker swarms can outlive their makers | Any notion of deterrence or diplomacy |
| Hazards | Cosmic sterilization tracking star formation, risk at each new tech tier, collapse that can grow with expansion speed | Specific catastrophes |
| Time | Event-driven, jumping from one thing happening to the next | The empty Gyr in between |

The genome has seven traits: expansionism, speed, aggression, stealth, caution, inwardness
and restraint. Each has a cost as well as a benefit; [src/core/genome.ts](src/core/genome.ts) lists them.

### How Fermi explanations enter the model

Explanations are never switches that force an outcome, such as "everyone stops expanding",
because those return whatever was put in. Each one enters in one of two ways:

- **As an unknown fact of nature, swept as a parameter.** Examples: how rare life is, how far
  waste heat can be seen, and how dangerous each new technology is (`tierHazard`, the great filter ahead).
- **As an option with costs and benefits, which selection adopts or rejects.** Examples: stealth,
  strikes, and inwardness (transcension). An option can be removed entirely to ask whether it
  exists in nature (`inwardnessCap = 0`).

An explanation that only produces silence when everyone is forced to follow it counts as
evidence against that explanation. This is Brin's non-exclusivity argument.
Starting traits are random, then nudged by three learning knobs: a species that sees
others at first light leans toward stealth and caution (`skyResponse`), a lineage that
loses holdings to attacks makes its new colonies hide (`threatResponse`), and a rich home
leans toward expansion (`homeRichness`).

| Explanation | Kind | In the model |
| --- | --- | --- |
| Rare life, Rare Earth | Nature | `hardSteps`, `habitablePerMsun`, star-class weights |
| Cosmic sterilization | Nature | `sterilizeRate` |
| Great filter ahead | Nature | `tierHazard` |
| Interstellar travel is hard | Nature | `speedMax`, `launchDelay` |
| Growth is unsustainable | Nature | `growthCollapse` |
| Dark forest | Options plus nature | stealth and strikes as options; `strikeRadius` and `stealthFloor` as nature |
| Berserkers | Nature | `berserkerChance`, whether the technology exists at all |
| Transcension | Option | inwardness trait (`inwardnessCap` 0 removes it) |
| Zoo, galactic club | Option | restraint trait (`restraintCap` 0 removes it) |
| Percolation (Landis) | Emerges | from expansion mutating and colonies collapsing |

`src/core/scenarios.ts` bundles these into named presets for sweeps (`--vary scenario=...`)
and for the viewer's scenario picker.

**Deliberately left out:**
- **Aestivation**, waiting for the cold far future to compute. Its payoff lies beyond the
  simulated 40 Gyr, so here it is indistinguishable from inwardness.
- **The simulation and planetarium hypotheses, and "they're already here, hidden."** These
  are unfalsifiable by design.
- **"They communicate in ways we don't recognise."** This is about alien psychology, not dynamics.

## Running

```bash
npm install
npm run dev          # viewer at http://localhost:5173 (lo-fi map + 3D tab)
npm run check        # cosmology and hard-step math against known values
npm run run          # one run: chronicle + summary
npm run run -- --json --seed 3 --preemption 0.5
npm run sweep -- --vary hardStepLog10=-5.4,-5.6,-5.8 --vary speedMax=0.1,0.5,0.9 --seeds 8
npm run sweep -- --vary scenario=baseline,berserkers,darkForest --vary hardStepLog10=-5.4,-5.8 --seeds 6
npm run score -- out/sweep-<timestamp>.csv   # which settings best explain an observer like us
```

Any scalar in [src/core/params.ts](src/core/params.ts) can be overridden as `--name value`,
plus the shorthand `--hardStepLog10`. Sweeps run on all cores but one (`--jobs N` to
change that) and write a CSV to `out/`.

## Viewer

The **Map** tab is the main view: a top-down tile map of a depth slice through the box.
Drag to pan, scroll to zoom, hover for detail, and click a territory to select its lineage.
A selected lineage shows how far the light of its first radio has travelled and its
current sensor range. The **3D** tab is a point cloud of the same moment for the overall
shape of things; drag to orbit. Chronicle entries and the lineage list are clickable.
Space plays or pauses, and Esc clears the selection.

## Layout

- `src/core/cosmology.ts`: expansion, distances, star formation
- `src/core/universe.ts`: nodes, clustering, neighbours
- `src/core/biology.ts`: hard steps, sampling technological origins
- `src/core/genome.ts`: traits and their trade-offs
- `src/core/tech.ts`: the tech ladder and waste-heat luminosity
- `src/core/sim.ts`: the event loop, i.e. emergence, filters, expansion, war, strikes and observation
- `src/core/summary.ts`: what a run measured
- `src/cli/`: run, sweep (parallel), score, check
- `src/viewer/`: the in-browser replay (`map2d.ts`, `view3d.ts`, `panels.ts`)

## Scoring against our own sky

`npm run score` rates each setting in a sweep by how probable an observer exactly like us is
under it: arising within 1 Gyr of 13.8 Gyr, around a G star, with nobody arrived and nothing
visible. Star class doesn't affect what a species sees, so the G-star share is computed
exactly from the biology, and only the sky part is counted from runs. Two likelihoods are
reported because anthropic reasoning hasn't settled which applies:

- **SSA (self-sampling):** we are a typical observer, so the score is the fraction of observers like us.
- **SIA (self-indication):** we are a typical possible observer, so universes with more observers
  like us in total also score higher.

## Robustness

Present-day silence was checked against things the answer shouldn't depend on:

- **Resolution:** 15k, 30k and 60k groups agree within noise.
- **Far-field estimate:** it changes almost nothing at the default detection range.
- **Box size:** this one mattered. A 3 Gly box overstated silence by about 15 points, because one
  empire could fill it and wrap onto itself. Results agree at 4.5, 6 and 9 Gly, so the default is now 6.

## Findings so far

These hold within this model and its assumptions, and are not claims about the real universe.

- **Common life is ruled out.** Both likelihoods put under 10% of the weight on hard steps faster
  than about 10⁻⁵·⁴/Gyr. In the observable universe that means fewer than about 4 million
  technological origins over 40 Gyr, and the best-fitting settings give about 10⁵–10⁶.
- **The two anthropic assumptions disagree about expansion speed:**
  - SSA prefers rare life plus fast expansion. Fast colonisers preempt most later observers,
    which makes an early observer like us typical. That is Hanson's explanation of our earliness.
  - SIA prefers moderately rare life plus slow expansion, which gives more observers like us in total.
- **G stars are a 1% coincidence.** Under the default biology, only about 0.9% of present-day
  technological species orbit G stars, and about 94% orbit K dwarfs, because several hard steps
  favour long habitable windows. Our Sun is therefore a ~1% coincidence unless K-dwarf planets
  are much less habitable than assumed, or there are fewer hard steps.
- Fast expansion makes silence more common, not less, because the colonisers preempt would-be
  observers and arrive close behind their own light (Hanson's "grabby aliens").
- The dark forest doesn't produce silence here. That held with stealth free, hiding nearly perfect,
  200 strikes per scan, and even with species going fully dark the moment they see someone.
  There are three reasons:
  1. Partial stealth doesn't protect anything from nearby advanced sensors, so evolution has no
     gradual slope toward hiding.
  2. Strikes are attrition, and expansion replaces the losses.
  3. The lineages that come to own the box arose before anyone was visible, so they never had a
     reason to hide.

## Known limits

- Beyond half the box, what observers see is a statistical estimate that assumes the box
  is a fair sample of the universe. It is not a simulation of real neighbours.
- The links between origin and traits are hypotheses with tunable strength, not findings.
- Strikes and stealth act per node. Wiping out a lineage's home or its whole cluster at once
  isn't modelled, so in this version strikes wear empires down but can't decapitate them.
