function statTile(label, value) {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const labelEl = document.createElement("span");
    labelEl.className = "stat-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "stat-value";
    valueEl.textContent = value;
    tile.appendChild(labelEl);
    tile.appendChild(valueEl);
    return tile;
}

async function loadStats() {
    const el = document.getElementById("stats-grid");
    const res = await fetch("/api/stats");
    const s = await res.json();
    const tiles = [
        ["Users", s.total_users],
        ["Groups", s.total_groups],
        ["Searches (all time)", s.total_searches],
        ["Searches (last 7 days)", s.searches_last_7_days],
        ["Visits logged", s.total_visits],
        ["Ratings given", s.total_ratings],
        ["Average rating", s.average_rating != null ? `${s.average_rating.toFixed(1)} ★` : "—"],
        ["Restaurants cached", s.total_restaurants_cached],
        ["Blacklist entries", s.total_blacklist_entries],
    ];
    el.innerHTML = "";
    for (const [label, value] of tiles) el.appendChild(statTile(label, value));

    renderSearchesChart(s.searches_by_day);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_ACCENT = "#d97706";

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

// Path for a bar with rounded top corners and a square baseline (per the
// house bar-chart spec), rather than a plain <rect> rounded on all corners.
function roundedTopBarPath(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, height / 2, width / 2));
    return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
        `L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} ` +
        `L${x + width},${y + height} Z`;
}

function parseIsoDate(iso) {
    return new Date(`${iso}T00:00:00`);
}

function shortDate(iso) {
    const d = parseIsoDate(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderSearchesChart(days) {
    const container = document.getElementById("stats-chart");
    container.innerHTML = "";

    const width = 420;
    const chartHeight = 90;
    const axisHeight = 18;
    const gap = 4;
    const barWidth = Math.min(24, width / days.length - gap);
    const maxCount = Math.max(1, ...days.map((d) => d.count));

    const svg = svgEl("svg", {
        viewBox: `0 0 ${width} ${chartHeight + axisHeight}`,
        width: "100%",
        height: chartHeight + axisHeight,
        role: "img",
        "aria-label": "Searches per day for the last 14 days",
    });

    // Baseline.
    svg.appendChild(
        svgEl("line", { x1: 0, y1: chartHeight, x2: width, y2: chartHeight, stroke: "var(--border)", "stroke-width": 1 })
    );

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;

    days.forEach((day, i) => {
        const x = i * (barWidth + gap);
        const barHeight = Math.max(1, (day.count / maxCount) * (chartHeight - 4));
        const bar = svgEl("path", {
            d: roundedTopBarPath(x, chartHeight - barHeight, barWidth, barHeight, 3),
            fill: CHART_ACCENT,
        });
        svg.appendChild(bar);

        // A taller, transparent hit target -- the painted bar for a 0-count
        // day is a 1px sliver, far too small to reliably hover on its own.
        const hit = svgEl("rect", {
            x,
            y: 0,
            width: barWidth + gap,
            height: chartHeight,
            fill: "transparent",
        });
        hit.addEventListener("pointerenter", () => showTooltip(tooltip, container, hit, day));
        hit.addEventListener("pointermove", () => showTooltip(tooltip, container, hit, day));
        hit.addEventListener("pointerleave", () => { tooltip.hidden = true; });
        svg.appendChild(hit);

        if (i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2)) {
            const label = svgEl("text", {
                x: x + barWidth / 2,
                y: chartHeight + axisHeight - 4,
                "text-anchor": "middle",
                class: "chart-axis-label",
            });
            label.textContent = shortDate(day.date);
            svg.appendChild(label);
        }
    });

    container.appendChild(svg);
    container.appendChild(tooltip);
}

function showTooltip(tooltip, container, hit, day) {
    const containerBox = container.getBoundingClientRect();
    const hitBox = hit.getBoundingClientRect();
    tooltip.textContent = `${shortDate(day.date)}: ${day.count} search${day.count === 1 ? "" : "es"}`;
    tooltip.style.left = `${hitBox.left - containerBox.left + hitBox.width / 2}px`;
    tooltip.style.top = `${hitBox.top - containerBox.top}px`;
    tooltip.hidden = false;
}

document.getElementById("open-stats-modal").addEventListener("click", () => {
    loadStats();
    document.getElementById("stats-modal").showModal();
});
document.getElementById("stats-close").addEventListener("click", () => {
    document.getElementById("stats-modal").close();
});
