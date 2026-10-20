# Vigía

**An AI agent that watches AIS gaps in the Gulf of Finland and says, with evidence, whether each one was a coverage gap or a vessel that likely went dark.**

Ships broadcast their position over AIS. When one goes silent, the usual reason is mundane: the shore receivers could not hear it. Sometimes the transponder was switched off. Vigía records the public AIS feed of the Gulf of Finland, detects the silences, and has an LLM agent investigate each one with tools over the recorded data. Every verdict comes with the evidence it rests on and the full trace of how the agent got there. The agent is then measured against a naive rule on cases labelled by hand.

> Educational project, no warranty. Vigía looks at vessels, never at people: it uses only what the vessels broadcast and the open sources below.

## Try the demo

```bash
bun install
bun run demo          # → http://localhost:4250
```

No keys and no network: the demo replays a recorded day from `demo/vigia-demo.sqlite`, read-only, with the agent's dossiers already in it. On the map, vessels move and gaps appear when the detector would have flagged them. Open a case to read its dossier, click a cited piece of evidence to jump to the step of the trace that produced it, and see the daily brief and the eval.

## How it works

```
Digitraffic (MQTT) → ingest → SQLite → detector → queue → agent → dossier → panel
                       │                  │                  │
               health per minute    gaps ≥ 30 min (A)   tool loop, ≤ 10 calls
               own outages          or ≥ 60 min (B)     verdict + evidence + trace
```

1. **Ingest.** Positions from [Digitraffic](https://www.digitraffic.fi/en/marine-traffic/) (Fintraffic), at most one every 30 s per vessel. Every minute the ingest records its own health: if it heard nothing, or lost the connection, that is *our* outage, and no gap that overlaps it becomes a case.
2. **Detector.** A gap is a silence of 30 min or more for class A transponders, 60 min for class B. It is thrown out if it started at a berth, if the vessel was heading out of the region near its edge, or if it overlaps our own outage. The rest are investigated when the vessel reappears, or after 6 hours of silence. If the vessel reappears later, the case is investigated again and both versions are kept.
3. **Agent.** A plain tool-use loop on the Messages API: the model calls tools, reads their results, and ends with `submit_verdict`. Its tools read the recorded data:
   - `get_track`: the vessel's positions around the gap, its speed and course, and jumps that would need more than 50 knots (spoofing or GNSS interference);
   - `get_nearby`: the vessels around it, and whether they kept reporting while it was silent;
   - `get_coverage`: how well the receivers hear that spot at that hour, over the last 7 days, in vessel-minutes;
   - `get_ingest_health`: whether our own ingest was up;
   - `get_vessel`: what the vessel says about itself (name, type, flag, length).

   The prompt starts from "most gaps are coverage gaps" and asks for both good coverage *and* neighbours that kept reporting before concluding `likely_dark`. Each piece of evidence cites the step of the trace it comes from, and a verdict that cites a step that does not exist is sent back. Every step is stored: the tool, its input, a summary of its output, the model, tokens, cost and time.
4. **Models.** By default `qwen3:8b` on a home GPU through Ollama, which costs nothing. Optionally Claude Haiku or Sonnet, on their own or as an escalation for inconclusive cases, under a monthly spending cap that is checked against the worst case before every call. If the home PC is off, cases wait in order and are investigated when it comes back.
5. **Panel.** A live map, the cases and their dossiers, blind labelling, the eval, a daily brief and the ingest's health.

## Does it work?

The agent is measured on cases labelled by hand, blind: the labelling view shows the next case in chronological order, without anything the agent said, and reveals the verdict only once the label is saved. The baseline is a naive rule: every gap longer than 60 minutes is a likely dark vessel. The report gives precision and recall for *likely dark* against the rest, each with a 95 % Wilson interval, the confusion matrices, and the cost per case.

**No figures yet.** The sample is still being labelled. It is published only once it reaches 100 cases with at least 15 likely dark, or 300 cases. This section will carry the numbers of the latest eval report and nothing else.

## Limits

- One region, the Gulf of Finland, through Finnish shore receivers: reception falls off with distance, especially towards the Russian end, so a gap there says less.
- AIS is self-reported. A vessel can lie about who it is or where it is; the agent can only notice what the data shows.
- A verdict is an analyst's note from the data, not a finding. *Likely dark* means the evidence points to a transponder switched off, not why.

## Roadmap

What is left for v1, what would make Vigía trustworthy beyond it, and how it compares with Windward, Kpler, Skylight and Global Fishing Watch: [`docs/roadmap.md`](docs/roadmap.md).

## Running it live

A Raspberry Pi 5 records and serves; a home PC with a GPU runs the model over Tailscale. See [`specs/001-vigia-v1/quickstart.md`](specs/001-vigia-v1/quickstart.md) and the systemd units in [`deploy/`](deploy/). Configuration goes in `.env` (see [`.env.example`](.env.example)).

```bash
bun run ingest      # record the AIS feed
bun run server      # panel, detector and the agent's queue (live, on 127.0.0.1:4250)
bun run eval        # the eval report over the labelled cases
bun run brief       # today's brief
bun run check       # types and tests: no network, no keys, no GPU (scripted models)
```

## Data and attribution

- **AIS:** Fintraffic / [digitraffic.fi](https://www.digitraffic.fi/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Map, ports and berths:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- **Global Fishing Watch** (planned tool, non-commercial use): [globalfishingwatch.org](https://globalfishingwatch.org/).

What each data file is, and its licence, is in [`data/README.md`](data/README.md).

## Licence

The code is MIT.
