const accountModal = document.getElementById("account-modal");
const accountGroupSelect = document.getElementById("account-group-select");
const accountNewGroup = document.getElementById("account-new-group");
const accountNewGroupName = document.getElementById("account-new-group-name");

// Populated fresh each time the modal opens, and reused when saving cuisine
// picks so that PATCH -- which replaces every preference field at once --
// doesn't clobber default_companion_ids/default_lat/lng/radius with defaults.
let accountMe = null;

async function populateAccountGroupSelect() {
    const [groupsRes, meRes] = await Promise.all([fetch("/api/groups"), fetch("/api/users/me")]);
    const groups = await groupsRes.json();
    accountMe = await meRes.json();

    accountGroupSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "No group";
    accountGroupSelect.appendChild(noneOpt);
    for (const g of groups) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        if (accountMe.group_id === g.id) opt.selected = true;
        accountGroupSelect.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ Add a new group...";
    accountGroupSelect.appendChild(newOpt);

    accountNewGroup.hidden = true;
    accountNewGroupName.value = "";
}

async function saveAccountGroup(groupId) {
    await fetch("/api/users/me/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId }),
    });
}

// --- Cuisine preferences: every cuisine ever seen while searching, not just
// what happens to be in the dashboard's current-session in-memory list.
let accountCuisineStates = new Map(); // lowercase cuisine -> one of CUISINE_STATES
let accountCuisineUniverse = new Map(); // lowercase cuisine -> display-cased value

function accountCuisineState(cuisine) {
    return accountCuisineStates.get(cuisine.toLowerCase()) || "neutral";
}

function accountCuisinesInState(state) {
    return Array.from(accountCuisineStates.entries())
        .filter(([, s]) => s === state)
        .map(([key]) => accountCuisineUniverse.get(key) || key);
}

async function saveAccountCuisines() {
    await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            preferred_cuisines: accountCuisinesInState("prefer"),
            disliked_cuisines: accountCuisinesInState("avoid"),
            default_companion_ids: accountMe.default_companion_ids,
            default_lat: accountMe.default_lat,
            default_lng: accountMe.default_lng,
            default_radius_m: accountMe.default_radius_m,
        }),
    });
}

function loadAccountCuisines() {
    const el = document.getElementById("account-cuisine-prefs");
    accountCuisineUniverse = new Map();
    accountCuisineStates = new Map();
    for (const c of accountMe.seen_cuisines || []) accountCuisineUniverse.set(c.toLowerCase(), c);
    // A pick can predate seen_cuisines existing, or the algorithm having ever
    // resurfaced it since -- keep it listed either way.
    for (const c of accountMe.preferred_cuisines || []) {
        accountCuisineUniverse.set(c.toLowerCase(), c);
        accountCuisineStates.set(c.toLowerCase(), "prefer");
    }
    for (const c of accountMe.disliked_cuisines || []) {
        accountCuisineUniverse.set(c.toLowerCase(), c);
        accountCuisineStates.set(c.toLowerCase(), "avoid");
    }

    el.textContent = "";
    const cuisines = Array.from(accountCuisineUniverse.values()).sort((a, b) => a.localeCompare(b));
    if (cuisines.length === 0) {
        el.textContent = "None yet — cuisines you come across while searching for lunch will show up here.";
        return;
    }
    for (const c of cuisines) {
        el.appendChild(
            makeCuisineChip(c, {
                getState: accountCuisineState,
                displayState: accountCuisineState,
                setState: (cuisine, state) => {
                    accountCuisineStates.set(cuisine.toLowerCase(), state);
                    saveAccountCuisines();
                },
            })
        );
    }
}

accountGroupSelect.addEventListener("change", () => {
    const value = accountGroupSelect.value;
    accountNewGroup.hidden = value !== "__new__";
    // "__new__" isn't a real group yet -- nothing to save until it's created
    // (see account-create-group below), which is also when it gets selected.
    if (value !== "__new__") saveAccountGroup(value ? parseInt(value, 10) : null);
});

document.getElementById("account-create-group").addEventListener("click", async () => {
    const name = accountNewGroupName.value.trim();
    if (!name) return;
    const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    const group = await res.json();
    const opt = document.createElement("option");
    opt.value = group.id;
    opt.textContent = group.name;
    opt.selected = true;
    accountGroupSelect.insertBefore(opt, accountGroupSelect.querySelector('option[value="__new__"]'));
    accountNewGroup.hidden = true;
    // Selecting the option above programmatically doesn't fire "change".
    await saveAccountGroup(group.id);
});

document.getElementById("account-cancel").addEventListener("click", () => {
    accountModal.close();
});

async function loadAccountBlacklist() {
    const el = document.getElementById("account-blacklist");
    const res = await fetch("/api/users/me/blacklist");
    const entries = await res.json();
    el.innerHTML = "";
    if (entries.length === 0) {
        el.textContent = "Nothing blacklisted.";
        return;
    }
    for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `<span><span class="list-row-name">${entry.name}</span> <span class="list-row-address">${entry.address}</span></span>`;
        const actions = document.createElement("div");
        actions.className = "list-row-actions";
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "secondary";
        undoBtn.textContent = "Un-blacklist";
        undoBtn.addEventListener("click", async () => {
            await fetch(`/api/restaurants/${entry.restaurant_id}/blacklist`, { method: "DELETE" });
            row.remove();
        });
        actions.appendChild(undoBtn);
        row.appendChild(actions);
        el.appendChild(row);
    }
}

async function loadAccountRatings() {
    const el = document.getElementById("account-ratings");
    const res = await fetch("/api/users/me/ratings");
    const entries = await res.json();
    el.innerHTML = "";
    if (entries.length === 0) {
        el.textContent = "Nothing rated yet.";
        return;
    }
    for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `<span><span class="list-row-name">${entry.name}</span> <span class="list-row-address">${entry.address}</span></span>`;
        const actions = document.createElement("div");
        actions.className = "list-row-actions";

        // Clicking a star changes the rating in place (same upsert endpoint
        // the dashboard's own star picker uses) instead of only being able
        // to remove it and re-rate from scratch elsewhere.
        const starPicker = document.createElement("div");
        starPicker.className = "star-picker";
        for (let n = 1; n <= 5; n++) {
            const star = document.createElement("span");
            star.dataset.star = n;
            star.textContent = "★";
            starPicker.appendChild(star);
        }
        const stars = starPicker.querySelectorAll("span");
        const highlight = (n) => stars.forEach((s, i) => s.classList.toggle("filled", i < n));
        highlight(entry.stars);
        stars.forEach((s) => {
            s.addEventListener("click", async () => {
                const n = parseInt(s.dataset.star, 10);
                highlight(n);
                await fetch(`/api/restaurants/${entry.restaurant_id}/rate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ stars: n }),
                });
            });
        });
        actions.appendChild(starPicker);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "secondary";
        removeBtn.textContent = "Remove rating";
        removeBtn.addEventListener("click", async () => {
            await fetch(`/api/restaurants/${entry.restaurant_id}/rate`, { method: "DELETE" });
            row.remove();
        });
        actions.appendChild(removeBtn);
        row.appendChild(actions);
        el.appendChild(row);
    }
}

function starPickerFor(initialStars, onPick) {
    const picker = document.createElement("div");
    picker.className = "star-picker";
    for (let n = 1; n <= 5; n++) {
        const star = document.createElement("span");
        star.dataset.star = n;
        star.textContent = "★";
        picker.appendChild(star);
    }
    const stars = picker.querySelectorAll("span");
    const highlight = (n) => stars.forEach((s, i) => s.classList.toggle("filled", i < n));
    highlight(initialStars || 0);
    stars.forEach((s) => {
        s.addEventListener("click", () => {
            const n = parseInt(s.dataset.star, 10);
            highlight(n);
            onPick(n);
        });
    });
    return picker;
}

let accountShowAllVisits = false;

async function loadAccountVisits() {
    const el = document.getElementById("account-visits");
    const toggle = document.getElementById("account-visits-toggle");
    toggle.textContent = accountShowAllVisits ? "Show last 7 days" : "Show full history";
    const res = await fetch(`/api/users/me/visits?all=${accountShowAllVisits}`);
    const entries = await res.json();
    el.innerHTML = "";
    if (entries.length === 0) {
        el.textContent = accountShowAllVisits ? "No visits logged yet." : "No visits in the last 7 days.";
        return;
    }
    for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `<span><span class="list-row-name">${entry.name}</span> <span class="list-row-address">${entry.address}</span></span>`;
        const actions = document.createElement("div");
        actions.className = "list-row-actions";

        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.value = entry.visit_date;
        dateInput.addEventListener("change", async () => {
            if (!dateInput.value) return;
            await fetch(`/api/visits/${entry.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visit_date: dateInput.value }),
            });
        });
        actions.appendChild(dateInput);

        actions.appendChild(
            starPickerFor(entry.stars, async (n) => {
                await fetch(`/api/restaurants/${entry.restaurant_id}/rate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ stars: n }),
                });
                loadAccountRatings();
            })
        );

        row.appendChild(actions);
        el.appendChild(row);
    }
}

document.getElementById("account-visits-toggle").addEventListener("click", () => {
    accountShowAllVisits = !accountShowAllVisits;
    loadAccountVisits();
});

// --- Search-and-log flow: find a restaurant that wasn't reached via "Find
// lunch" and log a visit for it with a chosen date and (optionally) a rating.
let accountVisitSearchTimer = null;

async function runAccountVisitSearch(q) {
    const resultsEl = document.getElementById("account-visit-search-results");
    if (!q.trim()) {
        resultsEl.hidden = true;
        resultsEl.innerHTML = "";
        return;
    }
    const res = await fetch(`/api/restaurants/search?q=${encodeURIComponent(q)}`);
    const results = await res.json();
    resultsEl.innerHTML = "";
    resultsEl.hidden = false;
    if (results.length === 0) {
        resultsEl.textContent = "No matches.";
        return;
    }
    for (const r of results) {
        const row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML = `<span><span class="list-row-name">${r.name}</span> <span class="list-row-address">${r.address}</span></span>`;
        const actions = document.createElement("div");
        actions.className = "list-row-actions";

        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.valueAsDate = new Date();
        actions.appendChild(dateInput);

        let chosenStars = 0;
        actions.appendChild(starPickerFor(0, (n) => { chosenStars = n; }));

        const logBtn = document.createElement("button");
        logBtn.type = "button";
        logBtn.className = "secondary";
        logBtn.textContent = "Log visit";
        logBtn.addEventListener("click", async () => {
            await fetch("/api/visits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    restaurant_id: r.id,
                    was_suggested: false,
                    visit_date: dateInput.value || null,
                }),
            });
            if (chosenStars > 0) {
                await fetch(`/api/restaurants/${r.id}/rate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ stars: chosenStars }),
                });
            }
            document.getElementById("account-visit-search").value = "";
            resultsEl.hidden = true;
            resultsEl.innerHTML = "";
            loadAccountVisits();
            if (chosenStars > 0) loadAccountRatings();
        });
        actions.appendChild(logBtn);

        row.appendChild(actions);
        resultsEl.appendChild(row);
    }
}

document.getElementById("account-visit-search").addEventListener("input", (e) => {
    clearTimeout(accountVisitSearchTimer);
    const q = e.target.value;
    accountVisitSearchTimer = setTimeout(() => runAccountVisitSearch(q), 300);
});

document.getElementById("open-account-modal").addEventListener("click", async () => {
    await populateAccountGroupSelect();
    loadAccountCuisines();
    loadAccountBlacklist();
    loadAccountRatings();
    accountShowAllVisits = false;
    loadAccountVisits();
    document.getElementById("account-visit-search").value = "";
    document.getElementById("account-visit-search-results").hidden = true;
    accountModal.showModal();
});
