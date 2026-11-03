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
| Civilisations | Filter survival, expansion, probes at a fraction of c, conflict, collapse, detection by waste heat on the light cone | Everything inside a node: crossing a galaxy is noise next to crossing between groups |
| Time | Event-driven, jumping from one thing happening to the next | The empty Gyr in between |

The genome has five traits: expansionism, speed, aggression, stealth and caution. Each
has a cost as well as a benefit; [src/core/genome.ts](src/core/genome.ts) lists them.

## Running

```bash
npm install
npm run dev          # viewer at http://localhost:5173
npm run check        # cosmology and hard-step math against known values
npm run run          # one run: chronicle + summary
npm run run -- --json --seed 3 --preemption 0.5
npm run sweep -- --vary hardStepLog10=-4.8,-5,-5.2 --vary speedMax=0.1,0.5,0.9 --seeds 5
```

Any scalar in [src/core/params.ts](src/core/params.ts) can be overridden as `--name value`.
Sweeps write a CSV to `out/`.

## Layout

- `src/core/cosmology.ts`: expansion, distances, star formation
- `src/core/universe.ts`: nodes, clustering, neighbours
- `src/core/biology.ts`: hard steps, sampling technological origins
- `src/core/genome.ts`: traits and their trade-offs
- `src/core/sim.ts`: the event loop, i.e. emergence, filters, expansion, war and observation
- `src/core/summary.ts`: what a run measured
- `src/cli/`: run, sweep, check
- `src/viewer/`: the in-browser replay

## Known limits

- The box is periodic, so nothing can be seen further than half its side. A 3 Gly box
  sees out to about 1.5–2.6 Gly, which is far short of the 46 Gly observable radius.
- Genomes are random at each origin. Nothing yet links a species' biology to its traits.
- Conflict is resolved node by node, with no notion of a lineage's total strength.
