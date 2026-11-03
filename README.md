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
| Dark forest | Strike-capable lineages scan their sky, fire at what they see, and can be traced and answered | Any notion of deterrence or diplomacy |
| Time | Event-driven, jumping from one thing happening to the next | The empty Gyr in between |

The genome has five traits: expansionism, speed, aggression, stealth and caution. Each
has a cost as well as a benefit; [src/core/genome.ts](src/core/genome.ts) lists them.
Starting traits are random, then nudged by two hypothesis knobs: a species that sees
others at first light leans toward stealth and caution (`skyResponse`), and a rich home
leans toward expansion (`homeRichness`).

## Running

```bash
npm install
npm run dev          # viewer at http://localhost:5173 (lo-fi map + 3D tab)
npm run check        # cosmology and hard-step math against known values
npm run run          # one run: chronicle + summary
npm run run -- --json --seed 3 --preemption 0.5
npm run sweep -- --vary hardStepLog10=-4.8,-5,-5.2 --vary speedMax=0.1,0.5,0.9 --seeds 5
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
- `src/cli/`: run, sweep (parallel), check
- `src/viewer/`: the in-browser replay (`map2d.ts`, `view3d.ts`, `panels.ts`)

## Findings so far

These hold within this model and its assumptions, and are not claims about the real universe.

- Under realistic-ish detection (about 1.5 Gly for a fully converted group), a mostly silent
  present-day sky needs rare life: hard steps at about 10⁻⁵·⁶/Gyr or slower, which means at
  most about 10⁶ technological origins in the observable universe over 40 Gyr.
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
