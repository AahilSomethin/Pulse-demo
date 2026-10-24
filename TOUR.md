# Team Guide

The Team Guide is a manual Driver.js walkthrough for Laari & Logic teammates. It explains the maritime connectivity problem, the August 2025 FollowMe evidence, Explore and Network, and the limits of what SeaPulse can claim. It is not a judge demo and it does not start by itself.

## How to start and leave

Choose **Team Guide** in the header. The control is an icon below the `sm` breakpoint and keeps the accessible name "Team Guide".

The popover has Next, Previous, Close, and Finish on the last step, plus a "current of total" label. Escape, the close control, or the browser Back button ends the guide. Finish is the only completion. Nothing is written to `localStorage`. Starting the guide again always begins at the first step.

Playback is paused when the guide starts. Closing or finishing returns the sidebar mode, the Explore and Network tabs, and the section URL from before the guide. Browser Back ends the guide and leaves the history navigation in place. The guide does not remount the map.

## Steps

1. **Why SeaPulse?** The connectivity information problem. No highlight.
2. **Our data.** Opens Explore, Data. Describes FollowMe, OpenStreetMap, and Census 2022 using whatever is actually loaded.
3. **Explore.** The map. Markers are historical GPS reports. Activity cells are not ports.
4. **Playback.** The bar under the map, after a day is loaded. Speed moves the timeline.
5. **Search.** The header field. Islands, atolls, harbour reference points, inferred areas, and a masked vessel from the loaded day.
6. **Network.** The observation-window control. Connections, counts, and evidence. The map keeps every match in the list and draws a thin, zoom-aware subset.
7. **Connectivity profile.** Opens the first connection in the current window when one exists. An island chosen from search opens the same profile.
8. **Vessel frequency.** The Frequency tab. Observed passages, not a ferry timetable.
9. **Find opportunities.** Flags are investigation candidates. A journey far longer than usual can be opened, read, and replayed. The map shows the selected candidate.
10. **Route Lab.** The Route Lab tab. The map shows that connection. A typed duration is a scenario, not a saving.
11. **Connectivity report.** CSV and print from the frequency view, including unusual-journey counts and a tracking-quality note for the loaded day. No coordinates or device identifiers.
12. **Limitations and impact.** The Experimental menu. Coverage bias, inferred places, Census 2022 as context only, and Emergency Simulation as a supporting experiment.

Counts in steps 2, 5, 6, and 7 come from the dataset, the current Network window, and the census join at the moment the guide starts. They are not hardcoded findings. A synthetic file is named as test data.

## Cross-section behaviour

Before a step is shown, the guide expands the sidebar, switches the Explore or Network tab, and navigates with the Next.js router when the step lives on another section. It then waits until the `data-tour` element is in the document and has a box, up to four seconds. The wait uses a `MutationObserver`, not a fixed delay. Map interaction is disabled only while the map itself is the highlighted step.

## When data is missing

| Missing piece | What the guide does |
| --- | --- |
| No FollowMe day | Playback stays a centred explanation. The map step still describes what markers mean. |
| No connections in the current window | The profile step does not open a details card or invent an example. |
| No August summary | The data step does not claim the month file is loaded. |
| Census file absent | The data step says population is not shown. |
| A target that never appears | The step becomes a centred fallback. It is not skipped and it does not point at an empty highlight. |

## Implementation

- `src/tour/steps.ts` builds the nine steps from a snapshot.
- `src/tour/wait.ts` resolves when a selector is visible.
- `src/tour/driver.ts` owns the Driver.js instance, the abort signal, and cleanup.
- `src/components/tour/TourLauncher.tsx` is the header button.
- Targets use `data-tour`. Popover colours use the semantic tokens in `src/app/globals.css` (`.seapulse-tour`), so light and dark follow the theme. Reduced motion turns the Driver.js animation off.
