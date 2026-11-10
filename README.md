# Fermi

**An evolutionary simulator for the Fermi paradox.** Technological species arise across a
scaled-down sample of the universe, from the Big Bang on. They look at their sky, then die,
stay home or expand, and climb a tech ladder up to Dyson swarms and galactic engineering. The
ones that expand carry a mutating genome of strategy traits, so selection acts on how
civilisations behave.

Every run answers one question: **how many civilisations look up and see nobody, and which
assumptions make that common?**

![A 12-billion-light-year box mid-run: empires spreading into empty space, with panels for the largest lineages and the chronicle](docs/overview.png)

## What you can do with it

- **Watch a universe unfold live.** Pick which kinds of civilisation can arise and what nature
  is like, press Run, and the simulation streams to the screen as it runs.
- **Zoom from the whole box down to single galaxy groups.** Detail fills in as you go: territory
  shapes far out, then tiles filling with waste heat, then individual groups ringed by owner.
- **Click any species** to see where it arose, what it could actually see when it first looked
  up, how far its first radio light has travelled, and how its traits drifted.
- **Test Fermi explanations as experiments.** Sweep runs from the command line and score which
  settings best explain an observer like us.

![Zoomed in: each galaxy group is a disc sized by mass, ringed in its owner's colour and filled by its waste heat, with strikes in flight](docs/closeup.png)

## Quick start

```bash
npm install
npm run dev        # viewer at http://localhost:5173
```

```bash
npm run build      # static site in dist/, ready to upload anywhere
```

The whole simulation runs in the browser, so `dist/` needs nothing but a static host, at a
domain root or in a subfolder.

## The viewer

- **Run and play:** Run starts a universe, and playback begins at once, following the
  simulation. The timeline greys out what hasn't been simulated yet. The button then becomes
  Play/Pause, and turns back into Run when you change a setting. New seed runs a fresh universe
  with the same settings.
- **Universe menu:** a preset, plus tick lists of the kinds of civilisation that can arise and
  the conditions of nature.
- **Map:** one copy of the box, filling the screen. Drag to pan, scroll to zoom, hover for detail.
  Depth and Thickness pick a slab of the 3D box to show.
- **Selecting:** click a territory, a ✶ (a species becoming technological: white saw an empty
  sky, orange saw someone) or a ○ (a species that stayed home). Lineages and chronicle entries
  are clickable too.
- **Timeline:** settled share in grey, first light as ticks along the top, strikes in red,
  and a marker for today. Click or drag to scrub.
- **Panels:** the selected species, the largest lineages, territory by kind, run statistics,
  mean traits over time, and a chronicle of firsts. Tab hides them.
- **Layers and Parameters:** turn map layers on and off or change the tile size; edit any setting.
- **Keys:** Space play/pause · ←/→ step · +/− zoom · 0 fit · Tab panels · F full screen · Esc deselect

![The Universe menu: kinds of civilisation on the left, conditions of nature on the right](docs/universe-menu.png)

## How it works

The model keeps only what matters for who sees whom, and when:

| Level | Modelled | Pruned |
| --- | --- | --- |
| Cosmology | Flat ΛCDM expansion, light travel time, the cosmic event horizon, the history of star formation | Radiation era, local dynamics |
| Universe | A periodic comoving box of galaxy groups with clustering and mass | Individual galaxies; each group stands for thousands |
| Biology | Carter's "hard steps" against the habitable windows of G, K and M stars, plus metallicity | Every planet that never produces a technological species: counted analytically, never instantiated |
| Civilisations | Filters, expansion by probes at a fraction of light speed, conflict weighted by empire size, collapse | Everything inside a group: crossing a galaxy is noise next to crossing between groups |
| Technology | A four-rung ladder (interstellar probes → Dyson swarms → relativistic kinetic weapons → galactic engineering) raising speed, sensor range, strength and waste heat | Specific inventions |
| Detection | Waste heat on the past light cone, dimmed by redshift; exact within half the box, estimated beyond it from the box's own census | Radio leakage, far too faint to cross between galaxies |
| Time | Event-driven, jumping from one happening to the next | The empty billions of years in between |

Each expanding lineage carries eight traits: **expansionism, speed, aggression, stealth,
caution, inwardness, restraint and unity**. Each has a cost as well as a benefit (see
[src/core/genome.ts](src/core/genome.ts)), and they mutate as colonies spread, so whichever
strategies outcompete the rest take over.

### Explanations enter as experiments, never as switches

A switch such as "everyone stops expanding" just returns whatever was put in. So each Fermi
explanation enters in one of two ways:

- **As an unknown fact of nature, swept as a parameter:** how rare life is, how far waste
  heat can be seen, how dangerous each new technology is.
- **As an option with costs and benefits, which selection can adopt or reject:** stealth,
  strikes, restraint, turning inward. An option can also be removed entirely, to ask whether it
  exists in nature.

An explanation that only produces silence when everyone is forced to follow it counts as
evidence against it. This is Brin's non-exclusivity argument.

| Explanation | Enters as | In the model |
| --- | --- | --- |
| Rare life, Rare Earth | Nature | hard-step rates, habitable planets per solar mass, star classes |
| Radiation hazards | Nature | true sterilization (rare) and complex-life wipes that microbes survive |
| Great filter ahead | Nature | risk at each new tech tier |
| Interstellar travel is hard | Nature | maximum probe speed, launch delay |
| Growth is unsustainable | Nature | collapse that rises with expansion speed |
| Dark forest | Option + nature | stealth and strikes as options; blast reach and the limits of stealth as nature |
| Berserkers | Kind | some species release self-replicating killer probes that can outlive them |
| Transcension | Option | inwardness: turn inward instead of expanding |
| Zoo, galactic club | Option | restraint: leave young civilisations alone |
| Unification | Option | unity: communal lineages ally rather than fight |
| Technology plateaus | Kind | some species never get past interstellar probes |
| FTL contact, cloaking | Nature | a rare instant channel at the top of the ladder, optionally able to carry away waste heat |
| Percolation (Landis) | Emerges | from expansion mutating and colonies collapsing |

**Kinds of civilisation** set a new species' starting temperament: mixed, grabby expanders,
homebodies, peaceful, communal uniters, zookeepers, hiders, dark-forest hunters, berserker
builders, transcenders and tech plateau. Traits still mutate, and selection decides which
kinds end up with the territory.

**Left out on purpose:** aestivation, whose payoff lies beyond the simulated span, so here it
looks the same as turning inward; the simulation and planetarium hypotheses, which are
unfalsifiable by design; and "they communicate in ways we don't recognise", which is about
alien psychology rather than dynamics.

## Findings so far

These hold within this model and its assumptions. They are not claims about the real universe.

- **Rare life is required.** Under both anthropic assumptions (below), under 10% of the weight
  falls on hard steps faster than about 10⁻⁵·⁴ per Gyr. In the whole observable universe that
  means fewer than about 4 million technological origins over 40 billion years.
- **No behavioural explanation replaces rarity.** A sweep of 210 universes across seven
  scenarios (dark forest, berserkers, zoo, transcension, sustainability, filter ahead) moved
  the fit by no more than noise.
- **The dark forest doesn't silence the sky.** Partial stealth doesn't protect anyone from
  nearby advanced sensors, so evolution has no gradual slope toward hiding. Strikes are
  attrition that expansion replaces. And the lineages that come to dominate arose before anyone
  was visible, so they never had a reason to hide. Hiding does spread under selection, to a
  stealth of about 0.9, but silence doesn't follow.
- **Fast expansion explains our earliness.** Under self-sampling, fast colonisers preempt most
  later observers, which makes an early observer like us typical. This is Hanson's "grabby
  aliens" argument.
- **The zoo and transcension fail the "everyone must" test.** Restraint and inwardness drift
  rather than rise. Even with an instant FTL channel that lets restrained lineages punish
  attackers, restraint ends no higher. Natives that are left alone see their hosts, so silent
  skies get rarer.
- **"Already here, hidden" almost never happens.** At normal spacing, no silent observer had
  someone in its own galaxy group. With civilisations 2–4 billion light-years apart, about 2% of
  silent observers in dark-forest runs did.
- **At great distances, distance alone silences the sky:** 97–99% silence in every scenario,
  including one with no optional strategies at all.
- **The far future fragments into islands.** Settlement peaks around 30–45 Gyr and then falls.
  Around 100 Gyr, dark energy shrinks the reachable distance below the gap between neighbouring
  groups. After that every group is an island and nothing can be resettled. Nothing in the model
  forces this; it comes from the cosmic event horizon.
- **Our Sun is a ~1% coincidence.** Under the default biology about 94% of present-day
  technological species orbit K dwarfs, because hard steps favour long habitable windows.

## Experiments from the command line

```bash
npm run check        # cosmology and hard-step maths against known values
npm run run          # one universe: chronicle and summary
npm run run -- --json --seed 3 --preemption 0.5
npm run sweep -- --vary hardStepLog10=-5.4,-5.6,-5.8 --vary speedMax=0.1,0.5,0.9 --seeds 8
npm run sweep -- --vary scenario=baseline,berserkers,darkForest --seeds 6
npm run score -- out/sweep-<timestamp>.csv   # which settings best explain an observer like us
```

Any setting in [src/core/params.ts](src/core/params.ts) can be overridden as `--name value`,
and kinds and conditions with `--archetypes a,b` and `--conditions a,b`. Sweeps use all cores
but one (`--jobs N` to change that) and write CSVs to `out/`.

### Scoring against our own sky

`npm run score` rates each setting by how probable an observer exactly like us is under it:
arising within 1 Gyr of 13.8 Gyr, around a G star, with nobody arrived and nothing visible. Two
likelihoods are reported, because anthropic reasoning hasn't settled which applies:

- **SSA (self-sampling):** we are a typical observer; the score is the fraction of observers like us.
- **SIA (self-indication):** we are a typical *possible* observer, so universes with more
  observers like us also score higher.

### Robustness

Present-day silence was checked against things the answer shouldn't depend on. Resolution
(15k–60k groups) and the far-field estimate change it by no more than noise. Box size does
matter: below about 4.5 billion light-years, one empire can fill the box and wrap onto itself,
overstating silence. Scripts default to 6 Gly with 30k groups. The viewer's Large setting uses
12 Gly with 120k groups, which matches the converged answer.

## Known limits

- Beyond half the box, what observers see is a statistical estimate that treats the box as a
  fair sample of the universe, not a simulation of real neighbours.
- The links between a species' origin and its traits are hypotheses with tunable strength, not findings.
- Strikes and stealth act per galaxy group. Wiping out a lineage's home or whole cluster at
  once isn't modelled, so strikes wear empires down but can't decapitate them.

## Project layout

| Path | What's there |
| --- | --- |
| `src/core/` | the model: cosmology, universe, biology, genome, tech ladder, kinds, scenarios, the event loop (`sim.ts`) and run summaries |
| `src/cli/` | `run`, `sweep` (parallel), `score` and `check` |
| `src/viewer/` | the browser viewer: map, timeline, panels, and the worker that streams the simulation |
| `scripts/screenshots.ts` | regenerates the images in `docs/` (`npm run screenshots` with the dev server running) |
