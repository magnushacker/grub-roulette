const accountModal = document.getElementById("account-modal");
const accountGroupSelect = document.getElementById("account-group-select");
const accountNewGroup = document.getElementById("account-new-group");
const accountNewGroupName = document.getElementById("account-new-group-name");
const accountStatus = document.getElementById("account-modal-status");

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
    noneOpt.textContent = "No location";
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
    newOpt.textContent = "+ Add a new location...";
    accountGroupSelect.appendChild(newOpt);

    accountNewGroup.hidden = true;
    accountNewGroupName.value = "";
    accountStatus.textContent = "";
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
    accountNewGroup.hidden = accountGroupSelect.value !== "__new__";
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
});

document.getElementById("account-save").addEventListener("click", async () => {
    const value = accountGroupSelect.value;
    if (value === "__new__") {
        accountStatus.textContent = "Create the new location first, or pick an existing one.";
        return;
    }
    await fetch("/api/users/me/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: value ? parseInt(value, 10) : null }),
    });
    accountModal.close();
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
        row.innerHTML = `<span><span class="list-row-name">${entry.name}</span> <span class="list-row-address">${"★".repeat(entry.stars)}</span></span>`;
        const actions = document.createElement("div");
        actions.className = "list-row-actions";
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

const accountRestaurantSearch = document.getElementById("account-restaurant-search");
const accountRestaurantResults = document.getElementById("account-restaurant-results");
let accountSearchTimer = null;

accountRestaurantSearch.addEventListener("input", () => {
    clearTimeout(accountSearchTimer);
    const q = accountRestaurantSearch.value.trim();
    if (q.length < 2) {
        accountRestaurantResults.innerHTML = "";
        return;
    }
    accountSearchTimer = setTimeout(async () => {
        const res = await fetch(`/api/restaurants/search?${new URLSearchParams({ q })}`);
        const found = await res.json();
        accountRestaurantResults.innerHTML = "";
        if (found.length === 0) {
            accountRestaurantResults.textContent = "No matches.";
            return;
        }
        for (const r of found) {
            const row = document.createElement("div");
            row.className = "list-row";
            row.innerHTML = `<span><span class="list-row-name">${r.name}</span> <span class="list-row-address">${r.address}</span></span>`;
            const actions = document.createElement("div");
            actions.className = "list-row-actions";

            const blacklistBtn = document.createElement("button");
            blacklistBtn.type = "button";
            blacklistBtn.className = "secondary";
            blacklistBtn.textContent = "Blacklist";
            blacklistBtn.addEventListener("click", async () => {
                await fetch(`/api/restaurants/${r.id}/blacklist`, { method: "POST" });
                blacklistBtn.textContent = "Blacklisted";
                blacklistBtn.disabled = true;
                loadAccountBlacklist();
            });

            const visitBtn = document.createElement("button");
            visitBtn.type = "button";
            visitBtn.className = "secondary";
            visitBtn.textContent = "Log visit today";
            visitBtn.addEventListener("click", async () => {
                await fetch("/api/visits", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ restaurant_id: r.id, was_suggested: false, companion_ids: [] }),
                });
                visitBtn.textContent = "Logged";
                visitBtn.disabled = true;
            });

            actions.appendChild(blacklistBtn);
            actions.appendChild(visitBtn);
            row.appendChild(actions);
            accountRestaurantResults.appendChild(row);
        }
    }, 350);
});

document.getElementById("open-account-modal").addEventListener("click", async () => {
    await populateAccountGroupSelect();
    loadAccountCuisines();
    accountRestaurantSearch.value = "";
    accountRestaurantResults.innerHTML = "";
    loadAccountBlacklist();
    loadAccountRatings();
    accountModal.showModal();
});
