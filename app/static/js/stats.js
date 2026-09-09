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
        ["Admins", s.total_admins],
        ["Groups", s.total_groups],
        ["Users without a group", s.users_without_group],
        ["Searches (all time)", s.total_searches],
        ["Searches (last 7 days)", s.searches_last_7_days],
        ["Visits logged", s.total_visits],
        ["Confirmed the suggestion", s.visits_confirmed_suggested],
        ["Logged somewhere else", s.visits_logged_elsewhere],
        ["Ratings given", s.total_ratings],
        ["Average rating", s.average_rating != null ? `${s.average_rating.toFixed(1)} ★` : "—"],
        ["Restaurants cached", s.total_restaurants_cached],
        ["Blacklist entries", s.total_blacklist_entries],
    ];
    el.innerHTML = "";
    for (const [label, value] of tiles) el.appendChild(statTile(label, value));
}

document.getElementById("open-stats-modal").addEventListener("click", () => {
    loadStats();
    document.getElementById("stats-modal").showModal();
});
document.getElementById("stats-close").addEventListener("click", () => {
    document.getElementById("stats-modal").close();
});
