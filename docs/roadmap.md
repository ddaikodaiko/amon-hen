# Roadmap and landscape

Where Vigía stands, what is left to do, and how it compares with the tools that already watch ships. Written on 2026-10-20, after the first day on live data; the task-level detail is in [`specs/001-vigia-v1/tasks.md`](../specs/001-vigia-v1/tasks.md).

## Where it stands

**Working, on real data:** the recorder on Digitraffic's AIS feed, the gap detector with its discards (own outages, berths, leaving the region), receiver coverage per cell and hour, the agent investigating each case with a free local model (`qwen3:8b` on a home GPU), the daily brief, the panel (3D map, alerts, case reports, blind labelling) and the demo build.

**First real numbers (2026-10-20):** 115 investigations, about 14 s and $0 each, no failures left after three fixes. 113 came out as *out of receiver range* and one as *likely dark*, which a second run of the same case then reversed.

**What that says:** the pipeline holds up; whether the verdicts are right is still unknown. Most cases sit at the Russian end of the gulf, which the Finnish receivers barely hear, and many were moored ships in ports the berth file missed. Since 2026-10-21 (T005) it covers 209 of 224 moored ships, so 35 of the 55 open cases that began moored would no longer become cases.

## What is left

### To close v1

| Task | What | Needs |
|---|---|---|
| T057 | Label cases blind until the stopping rule: 100 cases with at least 15 *likely dark*, or 300 | Days of recording, a person |
| T058 | The eval: precision and recall against the 60-minute rule, with 95 % intervals | T057, the home PC |
| T033 | Compare `qwen3:8b`, `llama3.1:8b` and `granite3.3:8b` on the same 10 cases | The home PC |
| T073 | Review 10 dossiers at random: is each verdict backed by its evidence? Four passes done with `qwen3:8b`: not yet (3 to 6 of 10), and six tool bugs fixed on the way | A decision on the local model's temperature, T033 |
| T074 | The paid comparison (Haiku and Sonnet, €10 cap) on the same sample | A budget decision |
| T032 | Global Fishing Watch events (gaps, encounters, loitering) as an agent tool | A GFW token |
| T001, T002, T064, T065, T071 | Move the recorder, server and brief timer to the Raspberry Pi, running 24/7 | The Pi |
| T075, T077, T049 | The eval set as a download, the final demo database, a clean-clone test | T058 |
| T072, T078 | README figures and screenshot; the public demo on a VPS | T058, a VPS |

### Beyond v1: from a working pipeline to a trustworthy one

In order: the first two make the output trustworthy, the third makes it useful against what actually happens in this gulf, and the fourth makes it safe to run unattended.

**1. Know whether it is right, and whether it is right every time**

- Accuracy against human labels (T057, T058).
- **Consistency:** run each case several times and report how often the model agrees with itself. The one *likely dark* of the first day flipped on a second run.
- **Calibration:** check that *high* confidence is right more often than *medium*.
- **Model context:** Ollama defaults to a 4,096-token context and cuts longer conversations without saying so. One investigation already repeated its whole sequence of tool calls after losing the start. Raise it on the PC (`OLLAMA_CONTEXT_LENGTH=16384`, with flash attention and a q8_0 KV cache to fit in 8 GB), and keep a guard in the agent that never lets a conversation outgrow the model.

**2. See more of the gulf**

- **A second AIS feed:** community receivers through aisstream.io (tried in T001), merged with Digitraffic. The Russian end, where most cases are, is exactly where one feed hears least.
- **Satellite radar:** Global Fishing Watch publishes vessel detections from Sentinel-1 SAR through its API. A radar detection where a silent ship should be is the strongest evidence of a vessel running dark; none where it should be supports *out of range*.

**3. Detect more than silences**

- **Cables and pipelines:** a ship moving slowly along an undersea cable route, the anchor-dragging pattern of the Estlink 2 cut on 25 December 2024, in this same gulf.
- **Meetings at sea:** two ships stopped together away from port, above all during a silence (ship-to-ship transfers).
- **Spoofing:** impossible jumps (partly in `get_track` already), one MMSI in two places, changes of name, flag or IMO.
- **Sanctions:** match the IMO against the public shadow-fleet sanction lists (EU, UK, US).

**4. Run it unattended**

- Alerts to a phone when the recorder stops or a case comes out suspicious.
- Daily backups of the database off the machine.
- Authentication and HTTPS for anything exposed; the live panel stays behind Tailscale.

## How it compares

| | Who it is for | Data | What it flags | Explains each flag | Cost and openness |
|---|---|---|---|---|---|
| **Windward** | Compliance, insurers, defence | Many feeds, behavioural AI | Dark activity, ship-to-ship meetings, spoofing, risk scores | Risk factors | Commercial, closed |
| **Kpler / MarineTraffic** | Trading, compliance | Claims the largest AIS network (350,000+ ships a day), sanctions and ownership data | AIS gaps, dark ship-to-ship transfers, illicit port calls | Risk screening | Commercial, closed |
| **Skylight** (Ai2) | Governments and NGOs, mainly fisheries | AIS plus Sentinel-1 radar, Sentinel-2, night lights, commercial imagery | Vessels going dark, rendezvous, fishing, entry into protected areas | Events; an AI agent ("Shippy") for a few partners | Free for those users; vision models open-sourced |
| **Global Fishing Watch** | Public, research, fisheries | AIS and Sentinel-1 radar detections | Intentional AIS disabling (separated from poor reception), encounters, loitering | Dataset-level method | Free; public data and API |
| **Nordic Warden, VIGIMARE** | Navies (JEF), EU research | AIS with satellite data and, in VIGIMARE, fibre-optic sensing on the cables | Shadow-fleet threats to undersea infrastructure | — | Government; pilots from 2026 |
| **Open-source and research** (DarkVesselNet, Sea-cret Agents) | Research | Radar and optical imagery with AIS; agent-based trajectory search | Dark vessels, likely routes during a gap | Varies | Code and papers; validated in software rather than on real cases |
| **Vigía v1** | Anyone curious, OSINT learners | One public AIS feed (Digitraffic), one region | Gaps, sorted into *likely dark*, *out of range* and *unclear* | **Every verdict, step by step, with the evidence it cites** | Free, open source, runs on a home GPU |

**Where v1 sits:** it applies Global Fishing Watch's central idea, telling a switched-off transponder from a receiver that could not hear it, to one region in near real time. Each case gets a written, auditable investigation that cites its evidence. It cannot match the commercial tools on data: one shore-based feed against satellite AIS, radio-frequency geolocation and imagery. Its accuracy is not yet measured.

**Where the roadmap would take it:** with tiers 1 to 3, it would cover for one region a working subset of what Skylight and Windward offer: going dark, meetings at sea, infrastructure threats, radar cross-checks and sanctions matching. It would add two things none of them publishes: a reasoning trace per verdict and a measured accuracy on a public, labelled sample. The research did not find an open-source tool that combines these with an LLM agent, although maintained projects may exist that it missed.

## Sources

- Skylight: [what it is](https://support.skylight.global/what-is-skylight), [Shippy, its AI agent (GeekWire, 2026)](https://www.geekwire.com/2026/ai2s-skylight-project-launches-shippy-an-ai-agent-that-dives-into-ocean-data/)
- Global Fishing Watch: [disabled signals research](https://globalfishingwatch.org/research-project-disabled-signals), [Welch et al. 2022, *Hot spots of unseen fishing vessels*](https://www.seafdec.or.th/iuu-events/estimate-iuu-fishing-losses-2026/download/references/Welch%20et%20al%202022%20Hot%20spots%20of%20unseen%20fishing%20vessels.pdf), [Sentinel-1 vessel detections dataset](https://globalfishingwatch.org/platform-update/2024-may-data-download-portal-new-dataset-released-featuring-vessel-detections-from-sentinel-1-sar/), [ESA on the Paolo et al. 2024 study](https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1/Sentinel-1_and_AI_reveal_75_of_fishing_vessels_not_tracked)
- Windward: [what dark activity is and why it surged in 2026](https://windward.ai/blog/what-is-dark-activity-and-why-is-it-surging-in-2026/)
- Kpler: [ship tracking and risk screening](https://www.kpler.com/fr/product/maritime/ship-tracking), [shadow-fleet risk tree (2026)](https://www.kpler.com/fr/blog/how-to-build-a-risk-tree-to-assess-shadow-fleet-exposure-in-your-network)
- Undersea infrastructure: [VIGIMARE (Horizon Magazine)](https://projects.research-and-innovation.ec.europa.eu/en/horizon-magazine/guarding-europes-hidden-lifelines-how-ai-could-protect-subsea-infrastructure), [Nordic Warden (Business Insider)](https://businessinsider.nl/countries-are-tracking-russias-shadow-fleet-using-ai-after-suspected-attacks-on-undersea-cables)
- Research: [Sea-cret Agents (arXiv 2502.01503)](https://arxiv.org/pdf/2502.01503)

Vendor figures are as the vendors report them.
