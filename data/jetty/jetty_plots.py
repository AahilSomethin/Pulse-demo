"""
Step 4: interactive jetty charts, opened in your web browser.

Hover over any dot or bar for the island's name and numbers, drag to zoom, double-click to reset,
and click legend entries to show or hide groups.

Reads   data/processed/jetty_need.csv, data/processed/jetty_need_model.json
Writes  data/processed/jetty_charts.html (the page the browser opens; works offline)

Runs automatically from python main.py in a terminal, or on its own: python jetty/jetty_plots.py
"""

from __future__ import annotations

import html
import json
import math
import re
import sys
import webbrowser
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
PAGE = PROCESSED / "jetty_charts.html"

SURFACE, INK, INK_2, GRID, OTHER, BLUE = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e0", "#c3c2b7", "#2a78d6"
GROUPS = {  # three highlighted verdicts, fixed colours; everything else recessive grey
    "Strong case": "#2a78d6",
    "Strong case, local fleet": "#eb6834",
    "Strong case, wider role": "#1baf7a",
}
ORDER = ["Strong case", "Strong case, local fleet", "Strong case, wider role", "Moderate",
         "Moderate, growing role", "Check access", "Weak case", "No data"]


def log(*parts) -> None:
    print(*parts, file=sys.stderr, flush=True)


def facility_rank(level) -> int:
    """0 unknown, 1-4 health centre grades, 5-7 hospital grades, 8 tertiary (older 'atoll'/'regional' too)."""
    text = str(level).lower()
    grade = re.search(r"grade\s*(\d)", text)
    if "tertiary" in text:
        return 8
    if "regional" in text:
        return 7
    if "atoll" in text:
        return 6
    if "hospital" in text:
        return 4 + int(grade.group(1)) if grade else 5
    return int(grade.group(1)) if grade else 0


LOG_TICKS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]


def _log_axis(axis: str, fig: go.Figure, title: str) -> None:
    """Log scale with clean 1-2-5 labels instead of Plotly's crowded defaults."""
    labels = [f"{v:g}" if v < 1000 else f"{v:,.0f}" for v in LOG_TICKS]
    update = fig.update_xaxes if axis == "x" else fig.update_yaxes
    update(type="log", title=title, tickvals=LOG_TICKS, ticktext=labels)


def _layout(fig: go.Figure, title: str, height: int = 520) -> go.Figure:
    fig.update_layout(
        title=dict(text=f"<b>{title}</b>", x=0, xanchor="left", font=dict(size=17, color=INK)),
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE, height=height,
        font=dict(family="Inter, Segoe UI, Arial, sans-serif", size=13, color=INK_2),
        margin=dict(l=10, r=20, t=60, b=10),
        hoverlabel=dict(bgcolor="white", font_size=13, font_color=INK),
        legend=dict(bgcolor="rgba(0,0,0,0)"),
    )
    fig.update_xaxes(gridcolor=GRID, zeroline=False, linecolor=GRID, automargin=True)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, linecolor=GRID, automargin=True)
    return fig


def _hover(frame: pd.DataFrame, has_fleet: bool) -> tuple[np.ndarray, str]:
    fields = ["island", "atoll", "population", "avg_arrivals_per_day", "unique_vessels_month",
              "traffic_vs_population", "jetty_case", "hospital_level"] + (["home_fleet"] if has_fleet else [])
    template = ("<b>%{customdata[0]} (%{customdata[1]})</b><br>"
                "Population: %{customdata[2]:,.0f}<br>"
                "Arrivals per day: %{customdata[3]:.1f}<br>"
                "Different vessels in the month: %{customdata[4]:,.0f}<br>"
                "Traffic vs population: %{customdata[5]:.1f}×<br>"
                "Health facility: %{customdata[7]}<br>"
                + ("Home fleet: %{customdata[8]:,.0f} boats<br>" if has_fleet else "")
                + "Verdict: %{customdata[6]}<extra></extra>")
    return frame[fields].to_numpy(), template


def _scatter(frame: pd.DataFrame, x: str, has_fleet: bool) -> list[go.Scatter]:
    traces = []
    for case, colour, size in [(None, OTHER, 8), *[(c, col, 11) for c, col in GROUPS.items()]]:
        part = frame[~frame["jetty_case"].isin(GROUPS)] if case is None else frame[frame["jetty_case"] == case]
        data, template = _hover(part, has_fleet)
        traces.append(go.Scatter(
            x=part[x], y=part["avg_arrivals_per_day"], mode="markers",
            name=f"{case or 'Other verdicts'} ({len(part)})",
            marker=dict(size=size, color=colour, line=dict(width=1.5, color=SURFACE)),
            customdata=data, hovertemplate=template))
    return traces


# ---------------------------------------------------------------- charts

def chart_explained(model: dict, has_fleet: bool) -> tuple[go.Figure, str]:
    names = {"population_only": "Population only",
             "population_and_services": "+ airport, capital,<br>health facility, near Malé",
             "population_services_and_fleet": "+ home fleet<br>(boats based there)"}
    labels = [names.get(k, k) for k in model["models"]]
    values = [v["r2"] * 100 for v in model["models"].values()]
    fig = go.Figure(go.Bar(x=values, y=labels, orientation="h", marker_color=BLUE,
                           text=[f"{v:.0f}%" for v in values], textposition="outside",
                           hovertemplate="%{y}: explains %{x:.0f}% of the differences<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(range=[0, 100], title="Differences in traffic between islands explained (%)")
    title = ("The island's own boats explain traffic far better than population" if has_fleet
             else "Population and services explain only part of the traffic")
    summary = ", ".join(f"{re.sub('<br>', ' ', label).strip('+ ')} {value:.0f}%" for label, value in zip(labels, values))
    caption = f"""Each bar shows how much of the difference in boat traffic between islands can be explained by a set
        of factors, from 0% (no help at all) to 100% (predicts traffic perfectly). The first bar uses only how many
        people live on the island. The second adds whether it has an airport, is the atoll capital, its health
        facility level and whether it is near Malé. The last adds its home fleet: the boats that spend most nights
        there. The longer the bar, the better those factors explain how busy an island's jetty is.
        Here: {summary}."""
    return _layout(fig, title, 120 + 95 * len(values)), caption


def chart_effects(model: dict) -> tuple[go.Figure, str] | None:
    full = list(model["models"].values())[-1]["coefficients"]
    rows = [("log_population", "Twice the population", 2), ("log_home_fleet", "Twice the home fleet", 2),
            ("hospital_level", "One step up in health facility", None), ("airport", "Has an airport", None),
            ("atoll_capital", "Is the atoll capital", None), ("in_kaafu", "In Kaafu, near Malé", None)]
    labels, mid, low, high, colours, notes = [], [], [], [], [], []
    for name, label, double in rows:
        if name not in full:
            continue
        b, se, p = full[name]["estimate"], full[name]["std_error"], full[name]["p_value"]
        change = (lambda v: 2 ** v - 1) if double else (lambda v: math.exp(v) - 1)
        clear = p is not None and p < 0.05
        labels.append(label)
        mid.append(change(b) * 100)
        low.append(change(b - 1.96 * se) * 100)
        high.append(change(b + 1.96 * se) * 100)
        colours.append(BLUE if clear else OTHER)
        notes.append("statistically clear" if clear else "not statistically clear")
    if not labels:
        return None
    mid, low, high = np.array(mid), np.array(low), np.array(high)
    fig = go.Figure(go.Bar(
        x=mid, y=labels, orientation="h", marker_color=colours,
        error_x=dict(type="data", symmetric=False, array=high - mid, arrayminus=mid - low,
                     color=INK_2, thickness=1.5, width=6),
        customdata=[[float(a), float(b), n] for a, b, n in zip(low, high, notes)],
        hovertemplate=("<b>%{y}</b><br>Traffic change: %{x:+.0f}%<br>"
                       "Likely range: %{customdata[0]:+.0f}% to %{customdata[1]:+.0f}%<br>"
                       "%{customdata[2]}<extra></extra>")))
    fig.add_vline(x=0, line_color=INK_2, line_width=1.5)
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(title="Change in vessel arrivals, with everything else held equal (%)", ticksuffix="%")
    caption = """Each bar is the separate effect of one factor on an island's vessel traffic, after accounting for all
        the others at once. This matters because hospitals, airports and capitals tend to be on the biggest islands:
        comparing them directly would mix up the effect of the hospital with the effect of having more people. Blue
        bars are statistically clear; grey bars could be chance. The thin line on each bar is the likely range: if it
        crosses 0%, the data cannot rule out no effect at all. Hover over a bar for the exact numbers."""
    return _layout(fig, "What raises traffic, with everything else held equal", 120 + 70 * len(labels)), caption


FACTORS = [("capital", "Atoll capital"), ("hospital", "Has a hospital"),
           ("airport", "Has an airport"), ("kaafu", "In Kaafu, near Malé")]


def _factors(islands: pd.DataFrame) -> pd.DataFrame:
    frame = islands.copy()
    frame["facility_rank"] = frame["hospital_level"].map(facility_rank)
    frame["hospital"] = frame["facility_rank"] >= 5          # hospital grade 1 or above
    frame["kaafu"] = frame["atoll"].eq("K")
    for column in ("capital", "airport"):
        frame[column] = frame[column].astype(str).str.lower().eq("true")
    return frame


def chart_with_without(islands: pd.DataFrame) -> tuple[go.Figure, str]:
    frame = _factors(islands)
    similar = frame[frame["population"].between(1500, 5000)]
    views = [("All islands: arrivals per day", frame, "avg_arrivals_per_day", "Typical vessel arrivals per day"),
             ("Similar-size islands (1,500–5,000 people)", similar, "avg_arrivals_per_day",
              "Typical vessel arrivals per day"),
             ("All islands: arrivals per 1,000 residents", frame, "arrivals_per_1000_residents",
              "Typical arrivals per 1,000 residents (whole month)")]
    fig = go.Figure()
    for index, (view, data, column, _) in enumerate(views):
        for has, name, colour in [(True, "With", BLUE), (False, "Without", OTHER)]:
            medians, notes = [], []
            for factor, label in FACTORS:
                group = data[data[factor] == has]
                medians.append(float(group[column].median()) if len(group) else None)
                notes.append([len(group), float(group["population"].median()) if len(group) else 0])
            fig.add_trace(go.Bar(
                x=[label for _, label in FACTORS], y=medians, name=name, marker_color=colour,
                visible=index == 0, showlegend=index == 0, legendgroup=name, customdata=notes,
                text=[f"{m:.1f}" if m is not None else "" for m in medians], textposition="outside",
                hovertemplate=(f"<b>%{{x}}: {name.lower()}</b><br>Typical value: %{{y:.1f}}<br>"
                               "Islands: %{customdata[0]}<br>Typical population: %{customdata[1]:,.0f}"
                               "<extra></extra>")))
    buttons = []
    for index, (view, _, _, title) in enumerate(views):
        visible = [i // 2 == index for i in range(len(views) * 2)]
        buttons.append(dict(label=view, method="update",
                            args=[{"visible": visible, "showlegend": visible}, {"yaxis.title.text": title}]))
    fig.update_layout(barmode="group", bargap=0.35, bargroupgap=0.08,
                      updatemenus=[dict(type="dropdown", x=1, xanchor="right", y=1.04, yanchor="bottom",
                                        bgcolor="white", bordercolor=GRID, buttons=buttons)])
    fig.update_yaxes(title=views[0][3], rangemode="tozero")
    caption = """For each factor, the blue bar is the typical (median) island that has it and the grey bar the typical
        island that does not. On all islands, capitals, hospital islands, airport islands and Kaafu islands are all
        far busier, but they are also much bigger, so part of the gap is just population. Use the dropdown above the
        chart to compare only islands of similar size (1,500 to 5,000 people), or to compare traffic per 1,000
        residents. A gap that survives those views is a real pull of that factor; a gap that disappears was mostly
        island size. Hover over a bar for how many islands are in each group and their typical population."""
    fig = _layout(fig, "Do capitals, hospitals and airports get more traffic?", 560)
    fig.update_layout(margin=dict(t=115), legend=dict(orientation="h", x=0, y=1.04, yanchor="bottom"),
                      title=dict(y=0.97, yanchor="top"))
    return fig, caption


def chart_correlations(islands: pd.DataFrame, has_fleet: bool) -> tuple[go.Figure, str]:
    frame = _factors(islands)
    rows = [("population", "Population"), ("facility_rank", "Health facility level"),
            ("capital", "Atoll capital"), ("airport", "Airport"), ("kaafu", "In Kaafu, near Malé")]
    if has_fleet:
        rows.append(("home_fleet", "Home fleet"))
    measures = [("avg_arrivals_per_day", "Arrivals<br>per day"), ("unique_vessels_month", "Different<br>vessels"),
                ("avg_vessels_present_per_day", "Boats present<br>per day"),
                ("arrivals_per_1000_residents", "Arrivals per<br>1,000 residents")]
    z = [[float(frame[r].astype(float).rank().corr(frame[m].rank())) for m, _ in measures] for r, _ in rows]
    fig = go.Figure(go.Heatmap(
        z=z, x=[label for _, label in measures], y=[label for _, label in rows], zmin=-1, zmax=1,
        colorscale=[[0, "#c23b3a"], [0.25, "#f0a3a2"], [0.5, "#f0efec"], [0.75, "#8fb8ea"], [1, "#2a78d6"]],
        text=[[f"{v:+.2f}" for v in row] for row in z], texttemplate="%{text}", textfont=dict(size=14, color=INK),
        xgap=3, ygap=3, colorbar=dict(title="Correlation", tickvals=[-1, -0.5, 0, 0.5, 1], len=0.8),
        hovertemplate="<b>%{y}</b> vs %{x}<br>Rank correlation: %{z:+.2f}<extra></extra>"))
    fig.update_yaxes(autorange="reversed", showgrid=False)
    fig.update_xaxes(side="top", showgrid=False)
    caption = """How strongly each island feature moves together with each measure of traffic, from -1 (always opposite)
        through 0 (no link) to +1 (always together). Blue cells are positive links, red cells negative, pale cells
        none. Population and health facility level have the strongest links with how many boats arrive, how many
        different vessels come and how many are present, but these two also go together (big islands have the
        hospitals), so read them alongside the "everything else held equal" chart. The last column, traffic per
        1,000 residents, is close to zero for most features: per person, capitals and hospital islands are not much
        busier, their extra traffic largely comes with their larger size and the visitors their services draw."""
    fig = _layout(fig, "How traffic correlates with island features", 190 + 62 * len(rows))
    fig.update_layout(margin=dict(t=120), title=dict(y=0.98, yanchor="top"))
    return fig, caption


def chart_population(islands: pd.DataFrame, model: dict, has_fleet: bool) -> tuple[go.Figure, str]:
    fig = go.Figure(_scatter(islands, "population", has_fleet))
    coef = model["models"]["population_only"]["coefficients"]
    xs = np.geomspace(islands["population"].min(), islands["population"].max(), 60)
    days = (islands["total_arrivals"] / islands["avg_arrivals_per_day"]).median()
    fig.add_trace(go.Scatter(
        x=xs, y=np.exp(coef["intercept"]["estimate"]) * xs ** coef["log_population"]["estimate"] / days,
        mode="lines", name="Predicted from population", line=dict(color=INK_2, width=2, dash="dash"),
        hovertemplate="Population %{x:,.0f}: about %{y:.1f} arrivals a day expected<extra></extra>"))
    _log_axis("x", fig, "Resident population (Census 2022)")
    _log_axis("y", fig, "Vessel arrivals per day")
    rho = model["spearman_population_vs_arrivals"]
    caption = f"""Each dot is one inhabited island. Further right means more residents (Census 2022); higher means more
        vessel arrivals per day (August 2025). Both axes are on a log scale, so each step is ten times the one before.
        The dashed line is the traffic an island would get from its population alone. Dots above the line are busier
        than their population suggests (tourism, services or a large local fleet); dots below are quieter than
        expected. Coloured dots are islands with a strong case for a bigger jetty. The rank correlation of {rho:.2f}
        (0 = no link, 1 = perfect) shows population matters, but is far from the whole story."""
    return _layout(fig, f"Bigger islands get more boats, but loosely (rank correlation {rho:.2f})", 600), caption


def chart_facilities(islands: pd.DataFrame, has_fleet: bool) -> tuple[go.Figure, str]:
    frame = islands.copy()
    frame["rank"] = frame["hospital_level"].map(facility_rank)
    frame["facility"] = frame["hospital_level"].fillna("unknown").str.title().str.replace("Health Centre$", "Health Centre (grade unknown)", regex=True)
    frame["per_1000"] = frame["arrivals_per_1000_residents"]
    order = frame.sort_values("rank").drop_duplicates("facility")["facility"].tolist()
    data, template = _hover(frame, has_fleet)
    fig = go.Figure()
    for column, label, visible in [("avg_arrivals_per_day", "Vessel arrivals per day", True),
                                   ("per_1000", "Arrivals per 1,000 residents (whole month)", False)]:
        fig.add_trace(go.Box(
            x=frame["facility"], y=frame[column], name=label, visible=visible,
            boxpoints="all", jitter=0.45, pointpos=0, fillcolor="rgba(42,120,214,0.12)",
            line=dict(color=BLUE, width=1.5), marker=dict(color=BLUE, size=7, opacity=0.75,
                                                          line=dict(width=1, color=SURFACE)),
            customdata=data, hovertemplate=template, showlegend=False))
    counts = frame["facility"].value_counts()
    fig.update_xaxes(categoryorder="array", categoryarray=order, title="Highest health facility on the island",
                     tickvals=order, tickangle=0,
                     ticktext=[name.replace(" Grade", "<br>Grade").replace(" (grade", "<br>(grade")
                               .replace(" Hospital", "<br>Hospital") + f"<br>({counts[name]} island{'s' if counts[name] != 1 else ''})"
                               for name in order])
    _log_axis("y", fig, "Vessel arrivals per day")
    fig.update_layout(updatemenus=[dict(
        type="dropdown", x=0.72, xanchor="right", y=1.03, yanchor="bottom", bgcolor="white", bordercolor=GRID,
        buttons=[dict(label="Arrivals per day", method="update",
                      args=[{"visible": [True, False]}, {"yaxis.title.text": "Vessel arrivals per day"}]),
                 dict(label="Arrivals per 1,000 residents", method="update",
                      args=[{"visible": [False, True]},
                            {"yaxis.title.text": "Arrivals per 1,000 residents (whole month)"}])])])
    caption = """Each dot is one island, grouped by the highest health facility it has, from the smallest health centre
        on the left to the tertiary hospital on the right. The box shows where the middle half of those islands sit
        and the line inside it is the typical island. Boxes that climb from left to right mean better-equipped islands
        get more boats: people from neighbouring islands travel there for treatment and services. Use the dropdown
        above the chart to switch to arrivals per 1,000 residents, which removes the effect of island size. Islands with
        hospitals are also the biggest, so see the "everything else held equal" chart for the hospital effect on its
        own. Hover over a dot for the island."""
    return _layout(fig, "Traffic by health facility level", 600), caption


def chart_fleet(islands: pd.DataFrame) -> tuple[go.Figure, str] | None:
    fleet = islands[islands["home_fleet"] > 0]
    if fleet.empty:
        return None
    fig = go.Figure(_scatter(fleet, "home_fleet", True))
    _log_axis("x", fig, "Home fleet (vessels based on the island)")
    _log_axis("y", fig, "Vessel arrivals per day")
    caption = """Each dot is one island, placed by its home fleet (vessels that spend most nights there: fishing, ferry,
        guesthouse and work boats) against its vessel arrivals per day. Both axes are on a log scale. The dots rise
        together much more tightly than in the population chart: islands with more boats of their own generate more
        jetty traffic. That demand comes from residents' livelihoods, which is the strongest argument that citizens
        themselves justify a bigger jetty."""
    return _layout(fig, "Islands with more of their own boats see much more traffic", 600), caption


def chart_verdicts(need: pd.DataFrame) -> tuple[go.Figure, str]:
    rows = need[need["role"] == "island"]
    counts = rows["jetty_case"].value_counts().reindex(ORDER).dropna()
    examples = {case: ", ".join(rows[rows["jetty_case"] == case]
                               .sort_values("pressure_score", ascending=False)["island"].head(6))
                for case in counts.index}
    fig = go.Figure(go.Bar(
        x=counts.values, y=counts.index, orientation="h",
        marker_color=[GROUPS.get(c, OTHER) for c in counts.index],
        text=[f"{int(v)}" for v in counts.values], textposition="outside",
        customdata=[examples[c] for c in counts.index],
        hovertemplate="<b>%{y}</b>: %{x} islands<br>e.g. %{customdata}<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(title="Number of islands")
    caption = """How many inhabited islands fall into each verdict; hover over a bar for example islands. Strong case: very
        busy, in line with its population. Strong case, local fleet: very busy because of the boats based on the
        island. Strong case, wider role: busier than population and fleet explain, likely tourism or transit, so the
        case is economic. Moderate: fairly busy, a medium priority. Check access: much less traffic than its population
        predicts, worth a site visit. Weak case: low traffic for its size. No data: the island was not found on the
        map."""
    return _layout(fig, "Jetty verdicts across inhabited islands", 440), caption


def chart_strong(islands: pd.DataFrame, has_fleet: bool) -> tuple[go.Figure, str] | None:
    strong = islands[islands["jetty_case"].isin(GROUPS)].sort_values("traffic_vs_population")
    if strong.empty:
        return None
    fig = go.Figure()
    for case, colour in GROUPS.items():
        part = strong[strong["jetty_case"] == case]
        data, template = _hover(part, has_fleet)
        fig.add_trace(go.Bar(x=part["traffic_vs_population"], y=part["island"] + " (" + part["atoll"] + ")",
                             orientation="h", name=case, marker_color=colour,
                             customdata=data, hovertemplate=template))
    fig.add_vline(x=1, line_color=INK_2, line_width=1.5, line_dash="dash",
                  annotation_text="1× = as busy as its population predicts", annotation_position="top right")
    fig.update_yaxes(categoryorder="array", categoryarray=(strong["island"] + " (" + strong["atoll"] + ")").tolist(),
                     tickfont=dict(size=11))
    fig.update_xaxes(title="Traffic ÷ what population predicts", ticksuffix="×")
    caption = """Every island with a strong case for a bigger jetty, ranked by its actual traffic divided by the traffic
        its population alone would predict. The dashed line at 1× means exactly as busy as its population suggests;
        3× means three times busier. Short blue bars are justified by residents alone. Orange bars go beyond population
        but are explained by the island's own fleet and services. Long green bars are driven by something else, mostly
        tourism, transfers or transit. Click a colour in the legend to show or hide that group."""
    return _layout(fig, "Strong cases: how far traffic goes beyond the resident population",
                   max(420, 150 + 20 * len(strong))), caption


# ---------------------------------------------------------------- page

def build_page(charts: list[tuple[go.Figure, str]], findings: list[str]) -> str:
    sections = []
    for number, (fig, caption) in enumerate(charts):
        plot = fig.to_html(full_html=False, include_plotlyjs=(number == 0),
                           config={"displaylogo": False, "responsive": True})
        sections.append(f'<section><div class="chart">{plot}</div>'
                        f'<p>{html.escape(" ".join(caption.split()))}</p></section>')
    findings_html = "".join(f"<li>{html.escape(line)}</li>" for line in findings)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jetty need</title>
<style>
  body {{ margin: 0; background: {SURFACE}; color: {INK}; font-family: Inter, "Segoe UI", Arial, sans-serif; }}
  main {{ max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }}
  h1 {{ font-size: 26px; margin: 0 0 6px; }}
  .lede {{ color: {INK_2}; margin: 0 0 20px; line-height: 1.55; }}
  ul {{ color: {INK_2}; line-height: 1.6; padding-left: 20px; margin: 0 0 28px; }}
  section {{ border-top: 1px solid {GRID}; padding: 26px 0 8px; }}
  section p {{ color: {INK_2}; line-height: 1.6; font-size: 15px; max-width: 860px; margin: 6px 0 0; }}
</style></head>
<body><main>
<h1>Does each island need a bigger jetty?</h1>
<p class="lede">Vessel traffic (FollowMe trackers, August 2025) compared with population (Census 2022), airports,
atoll capitals, health facilities and each island's home fleet. Hover over any dot or bar for details, drag to zoom,
double-click to reset.</p>
<ul>{findings_html}</ul>
{''.join(sections)}
</main></body></html>"""


def main() -> int:
    need_csv, model_json = PROCESSED / "jetty_need.csv", PROCESSED / "jetty_need_model.json"
    if not need_csv.exists() or not model_json.exists():
        sys.exit("No jetty results yet. Run python main.py first.")
    need = pd.read_csv(need_csv)
    model = json.loads(model_json.read_text(encoding="utf-8"))
    if "hospital_level" not in need.columns:
        need["hospital_level"] = "unknown"
    islands = need[(need["role"] == "island") & need["population"].gt(0) & need["avg_arrivals_per_day"].gt(0)]
    has_fleet = "home_fleet" in need.columns and need["home_fleet"].gt(0).any()

    charts = [chart_explained(model, has_fleet), chart_with_without(islands),
              chart_correlations(islands, has_fleet), chart_effects(model),
              chart_population(islands, model, has_fleet), chart_facilities(islands, has_fleet),
              chart_fleet(islands) if has_fleet else None, chart_verdicts(need),
              chart_strong(islands, has_fleet)]
    charts = [chart for chart in charts if chart is not None]

    PAGE.write_text(build_page(charts, model.get("findings", [])), encoding="utf-8")
    log(f"Opening {len(charts)} interactive charts in your browser ({PAGE.relative_to(ROOT)})")
    webbrowser.open(PAGE.resolve().as_uri())
    return len(charts)


if __name__ == "__main__":
    main()