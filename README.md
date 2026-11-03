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
| Radiation hazards | Nature | `sterilizeRate` (kills everything), `resetRate` (wipes complex life; microbes survive) |
| Great filter ahead | Nature | `tierHazard` |
| Interstellar travel is hard | Nature | `speedMax`, `launchDelay` |
| Growth is unsustainable | Nature | `growthCollapse` |
| Dark forest | Options plus nature | stealth and strikes as options; `strikeRadius` and `stealthFloor` as nature |
| Berserkers | Kind | berserker builders release swarms; other kinds never do |
| Transcension | Option | inwardness trait (`inwardnessCap` 0 removes it) |
| Zoo, galactic club | Option | restraint trait (`restraintCap` 0 removes it) |
| Unification | Option | unity trait: communal lineages that meet ally, never fight, and fight as one |
| Technology plateaus | Kind | some species never get past interstellar probes |
| Percolation (Landis) | Emerges | from expansion mutating and colonies collapsing |

**Kinds of civilisation** (`src/core/archetypes.ts`, `--archetypes a,b,...`) set a new species'
starting temperament. The kinds are mixed, grabby expanders, homebodies, peaceful, communal
uniters, zookeepers, hiders, dark-forest hunters, berserker builders, transcenders and tech
plateau. When several are enabled, each species picks one at random. Traits still mutate, and
selection decides which kinds end up holding the universe.

**Universe conditions** (`src/core/scenarios.ts`, `--conditions a,b,...`) are facts of nature:
sterilizing radiation, complex-life wipes, dangerous technology, unsustainable growth, decisive
weapons, a faster-than-light channel, and a channel that can carry heat. Named presets bundle
kinds and conditions for sweeps (`--vary scenario=...`) and for the viewer's Universe menu.

**Deliberately left out:**
- **Aestivation**, waiting for the cold far future to compute. Its payoff lies beyond the
  simulated 40 Gyr, so here it is indistinguishable from inwardness.
- **The simulation and planetarium hypotheses, and "they're already here, hidden."** These
  are unfalsifiable by design.
- **"They communicate in ways we don't recognise."** This is about alien psychology, not dynamics.

## Running

```bash
npm install
npm run dev          # viewer at http://localhost:5173
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

The map fills the screen: a top-down tile view of a depth slice through the box, with
lineage names on the larger territories. Panels float over it and can be hidden.

- **Navigating:** drag to pan, scroll to zoom, and hover for detail.
- **Selecting:** click a species marker (✶ first light, o stayed home) or a territory. The map then
  shows how far the light of their first radio has travelled, their sensor range, and in orange
  every holding they could actually see when they first looked up. Chronicle entries and the
  lineage list are clickable too.
- **Timeline:** the strip along the bottom shows the whole run. The grey area is the settled share,
  ticks along the top mark first light (white for an empty sky, orange for seeing someone), red
  bars mark strikes, and a marker shows today. Click or drag it to scrub.
- **Layers:** turn territory, unsettled groups, species, strikes, labels and selection overlays on
  or off, and set the tile size. The box wraps, so by default the map repeats it to fill the
  screen, with dashed outlines between copies.
- **Universe menu:** a preset, plus tick lists of kinds of civilisation and universe conditions.
  The left panel shows which kinds hold the universe at the current moment.
- **Progress:** a bar shows simulated time and a rough time remaining while a universe runs.
- **Run and play:** the main button simulates once, then becomes Play/Pause for that universe.
  It switches back to Run only after you change a setting. New seed simulates a fresh universe
  with the same settings.
- **Parameters:** start from a scenario, then edit anything. The `everything` scenario switches
  on every hazard and mechanism at once.
- **Keys:** Space plays or pauses, ←/→ steps, +/− and 0 zoom and fit, Tab hides the panels,
  F goes full screen, and Esc clears the selection.

## Layout

- `src/core/cosmology.ts`: expansion, distances, star formation
- `src/core/universe.ts`: nodes, clustering, neighbours
- `src/core/biology.ts`: hard steps, sampling technological origins
- `src/core/genome.ts`: traits and their trade-offs
- `src/core/tech.ts`: the tech ladder and waste-heat luminosity
- `src/core/sim.ts`: the event loop, i.e. emergence, filters, expansion, war, strikes and observation
- `src/core/summary.ts`: what a run measured
- `src/cli/`: run, sweep (parallel), score, check
- `src/viewer/`: the in-browser replay (`map2d.ts`, `timeline.ts`, `panels.ts`, `state.ts`)

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
- **Bigger boxes need proportionally more groups.** At 12 Gly, 120k groups match the converged
  answer (45% ±1 present-day silence), while 60k groups read 4 points high. The viewer's Large
  setting uses 12 Gly with 120k groups. Scripts default to 6 Gly with 30k groups, which converges
  and is about 10× faster.

### Performance

Sight checks dominate big boxes. Several changes keep them cheap without changing what is seen:

- **Groups too faint to see are skipped before any light-travel arithmetic.** A group's brightness
  can never exceed its mass, so this is exact.
- **The scale factor at emission comes from a table.**
- **Searches go ring by ring outward over a grid,** stopping once the nearest visible targets are certain.
- **Only the heaviest 1% of groups are checked beyond typical sight range.**

Typical single runs: 6 Gly takes about 3 s, 12 Gly with 120k groups about 26 s, 24 Gly with 120k
groups about 28 s, and 150 Gyr at 6 Gly 40–120 s. Memory stays under 500 MB.

## Findings so far

These hold within this model and its assumptions, and are not claims about the real universe.

- **Common life is ruled out.** Both likelihoods put under 10% of the weight on hard steps faster
  than about 10⁻⁵·⁴/Gyr. In the observable universe that means fewer than about 4 million
  technological origins over 40 Gyr, and the best-fitting settings give about 10⁵–10⁶.
- **The two anthropic assumptions disagree about expansion speed:**
  - SSA prefers rare life plus fast expansion. Fast colonisers preempt most later observers,
    which makes an early observer like us typical. That is Hanson's explanation of our earliness.
  - SIA prefers moderately rare life plus slow expansion, which gives more observers like us in total.
- **The hypothesis sweep** pitted seven scenarios against each other, each with five rarity
  levels and 210 universes in total, scored together:
  - Rare life is needed in every scenario.
  - No behavioural explanation moved the fit by more than noise. That covers dark forest v2,
    berserkers, the zoo/club, transcension, sustainability and the filter ahead.
  - Cosmic sterilization at the literature rate (about 1/Gyr) scores best (SSA 37%, SIA 69%),
    mostly because it makes a G-star observer about 40× more typical.
  - Under selection, stealth rose to about 0.9 once lineages learned from attacks, while
    restraint and inwardness drifted down. The zoo and transcension fail the "everyone must"
    test, and hiding spreads without making the sky silent.
- **An FTL channel doesn't rescue the zoo.** Even with an instant channel that lets restrained
  lineages punish anyone who attacks them, restraint ends no higher than without it
  (about 0.4–0.55). The zoo also backfires on the evidence: leaving natives alone doubles the
  number of observers, but they see their restrained hosts, so silent skies get rarer.
- **"Already here, hidden" didn't happen.** In 64 universes, none of about 1,500 silent observers
  had someone else in its own galaxy group. Hosts are never dark enough to stay unseen.
- **At long distances, distance alone silences the sky.** The test gave life a common rate per
  habitable planet (10⁻⁵/Gyr) but made habitable planets 1,000–10,000× rarer, so
  civilisations sit 2–4 Gly apart in a 24 Gly box. Present-day silence was 97–99% in every
  scenario, including the one with no optional strategies.
  - The dark forest holds and adds a little: stealth evolves to 0.91, and overall silence rises
    from 67% to 76% against the baseline. But that's no more than the control.
  - The first "already here, hidden" cases appear: 2% of silent observers in the dark-forest
    runs. At this coarse resolution, though, "own group" means within roughly 0.4 Gly.
- **Cloaking via the FTL channel didn't create hidden zookeepers.** At normal spacing, no silent
  observer had a host, with or without cloaking. A hidden zookeeper needs near-total stealth,
  restraint and the channel all in one host, and selection never assembled that combination.
  Restraint stays around 0.4–0.55, which is drift rather than selection.
- **The far future fragments into islands.** In 150 Gyr runs, settlement peaks around 30–45 Gyr and
  then falls steadily (from 94% to 24% at baseline), and strikes stop by about 105 Gyr. Nothing
  forces this; it comes from the cosmic event horizon. Dark energy shrinks the distance anything can
  still reach until, around 100 Gyr, it is smaller than the gap between neighbouring galaxy groups.
  After that every group is an island: collapsed holdings can never be resettled, and nobody can
  reach anybody.
- **Early runs of kinds (one seed each, rarity −5.6):**
  - A universe of only tech-plateau species is silent: all 25 present-day observers saw nothing.
  - A universe of peaceful, communal, zookeeper and homebody species is louder than the default.
    Unopposed expansion is easy to see, and only 4 of 24 observers saw nothing.
  - These are single runs, not sweeps.
- **Sterilization at 1/Gyr is probably too strong.** That rate comes from "lethal" gamma-ray
  bursts (Piran & Jimenez 2014), meaning ozone-stripping mass extinctions, not the end of all
  life. Earth has had several and kept going. The model treats a hit as ending a planet's chance,
  which matches true sterilization, and that is far rarer: perhaps 0.01–0.1/Gyr. At 0.1/Gyr the
  G-star share at present rises only from 0.8% to 5%, and at rate 1 almost nobody arises near today.
  A setback model, where a hit resets complex life but microbes survive, would be more faithful.
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
