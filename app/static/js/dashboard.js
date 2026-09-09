let map, marker;
let origin = null; // {lat, lng}
let selectedCompanionIds = [];
let me = null;
let restaurantMarkers = new Map(); // restaurant id -> google.maps.Marker
let infoWindow = null;
let highlightedCard = null;
let cuisineUniverse = new Map(); // lowercase cuisine -> display-cased value
let usersById = new Map(); // id -> user, for reading companions' own cuisine picks

function initMap() {
    const hasDefault = me && me.default_lat != null;
    const startingCenter = hasDefault
        ? { lat: me.default_lat, lng: me.default_lng }
        : { lat: 40.7128, lng: -74.006 };

    map = new google.maps.Map(document.getElementById("map"), {
        center: startingCenter,
        zoom: hasDefault ? 15 : 13,
    });

    map.addListener("click", (e) => setOrigin(e.latLng.lat(), e.latLng.lng(), true));

    if (hasDefault) {
        setOrigin(me.default_lat, me.default_lng, false);
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                map.setZoom(15);
                setOrigin(pos.coords.latitude, pos.coords.longitude, true);
            },
            () => {} // ignore denial, user can click the map instead
        );
    }
}

function setOrigin(lat, lng, save) {
    origin = { lat, lng };
    if (marker) {
        marker.setPosition({ lat, lng });
    } else {
        marker = new google.maps.Marker({ position: { lat, lng }, map });
    }
    if (save) saveState();
}

function clearRestaurantMarkers() {
    for (const m of restaurantMarkers.values()) m.setMap(null);
    restaurantMarkers.clear();
    if (infoWindow) infoWindow.close();
}

function plotRestaurantMarkers(pick, alternatives) {
    clearRestaurantMarkers();
    const bounds = new google.maps.LatLngBounds();
    if (origin) bounds.extend(origin);

    const entries = [];
    if (pick) entries.push([pick, true]);
    for (const alt of alternatives) entries.push([alt, false]);

    for (const [r, isPick] of entries) {
        const position = { lat: r.lat, lng: r.lng };
        const m = new google.maps.Marker({
            position,
            map,
            title: r.name,
            icon: `http://maps.google.com/mapfiles/ms/icons/${isPick ? "green" : "blue"}-dot.png`,
        });
        m.addListener("click", () => focusRestaurant(r.id));
        restaurantMarkers.set(r.id, m);
        bounds.extend(position);
    }
    if (entries.length > 0) map.fitBounds(bounds);
}

function focusRestaurant(id) {
    const m = restaurantMarkers.get(id);
    if (m) {
        map.panTo(m.getPosition());
        if (infoWindow) infoWindow.close();
        infoWindow = new google.maps.InfoWindow({ content: m.getTitle() });
        infoWindow.open(map, m);
        m.setAnimation(google.maps.Animation.BOUNCE);
        setTimeout(() => m.setAnimation(null), 1400);
    }

    const card = document.querySelector(`[data-restaurant-id="${id}"]`);
    if (card) {
        if (highlightedCard) highlightedCard.classList.remove("highlighted");
        card.classList.add("highlighted");
        highlightedCard = card;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

const pickableCompanions = new Map(); // id -> user, for companions from other groups not yet added
let groupNameById = new Map(); // group id -> group name, for the group-picker's option labels

function addCompanionCheckbox(u, checked) {
    const el = document.getElementById("companions");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = u.id;
    checkbox.checked = checked;
    checkbox.addEventListener("change", () => {
        selectedCompanionIds = Array.from(el.querySelectorAll("input:checked")).map((c) => parseInt(c.value, 10));
        refreshCuisineChips();
        saveState();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(u.display_name));
    el.appendChild(label);
}

// Key used to bucket pickableCompanions by group in the cascading picker
// below -- group ids are numbers, so "" (rather than "null"/"0") is the one
// value a real group id can never collide with.
function groupKeyFor(u) {
    return u.group_id == null ? "" : String(u.group_id);
}

// Two-step "add a companion": pick a group, then a name from within it.
// Rebuilt from the current pickableCompanions after every add so a group
// that's been fully picked from disappears from the first dropdown too.
function refreshCompanionPickers() {
    const groupPicker = document.getElementById("companion-group-picker");
    const namePicker = document.getElementById("companion-name-picker");

    const groupKeys = new Set(Array.from(pickableCompanions.values()).map(groupKeyFor));
    const sortedKeys = Array.from(groupKeys).sort((a, b) =>
        (a === "" ? "No group" : groupNameById.get(parseInt(a, 10)) || "No group").localeCompare(
            b === "" ? "No group" : groupNameById.get(parseInt(b, 10)) || "No group"
        )
    );

    groupPicker.innerHTML = '<option value="">Add a companion from a group...</option>';
    for (const key of sortedKeys) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = key === "" ? "No group" : groupNameById.get(parseInt(key, 10)) || "No group";
        groupPicker.appendChild(opt);
    }
    groupPicker.hidden = sortedKeys.length === 0;

    namePicker.hidden = true;
    namePicker.innerHTML = '<option value="">Choose a name...</option>';
}

async function loadCompanions() {
    const el = document.getElementById("companions");
    const groupPicker = document.getElementById("companion-group-picker");
    const namePicker = document.getElementById("companion-name-picker");
    const [usersRes, groupsRes] = await Promise.all([fetch("/api/users"), fetch("/api/groups")]);
    const users = await usersRes.json();
    const groups = await groupsRes.json();
    usersById = new Map(users.map((u) => [u.id, u]));
    if (users.length === 0) {
        el.textContent = "No companions registered yet.";
        groupPicker.hidden = true;
        namePicker.hidden = true;
        return;
    }
    groupNameById = new Map(groups.map((g) => [g.id, g.name]));
    const defaults = new Set(me ? me.default_companion_ids : []);
    const myGroupId = me ? me.group_id : null;

    // Show companions in the same group by default. Anyone already picked
    // as a default companion stays visible too, even from another group,
    // so a saved cross-group pick doesn't silently disappear.
    const sameGroup = users.filter((u) => u.group_id === myGroupId);
    const otherGroup = users.filter((u) => u.group_id !== myGroupId);
    const visible = [...sameGroup, ...otherGroup.filter((u) => defaults.has(u.id))];

    el.innerHTML = "";
    if (visible.length === 0) {
        el.textContent = "No companions in your group yet — add one from another group below.";
    } else {
        for (const u of visible) addCompanionCheckbox(u, defaults.has(u.id));
    }
    selectedCompanionIds = Array.from(el.querySelectorAll("input:checked")).map((c) => parseInt(c.value, 10));

    pickableCompanions.clear();
    for (const u of otherGroup.filter((u) => !defaults.has(u.id))) {
        pickableCompanions.set(u.id, u);
    }
    refreshCompanionPickers();
    refreshCuisineChips();
}

document.getElementById("companion-group-picker").addEventListener("change", (e) => {
    const namePicker = document.getElementById("companion-name-picker");
    const key = e.target.value;
    namePicker.innerHTML = '<option value="">Choose a name...</option>';
    if (key === "") {
        namePicker.hidden = true;
        return;
    }
    const names = Array.from(pickableCompanions.values())
        .filter((u) => groupKeyFor(u) === key)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
    for (const u of names) {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.display_name;
        namePicker.appendChild(opt);
    }
    namePicker.hidden = false;
});

document.getElementById("companion-name-picker").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    const u = pickableCompanions.get(id);
    if (!u) return;
    if (document.getElementById("companions").textContent === "No companions in your group yet — add one from another group below.") {
        document.getElementById("companions").innerHTML = "";
    }
    addCompanionCheckbox(u, true);
    pickableCompanions.delete(id);
    document.getElementById("companion-group-picker").value = "";
    refreshCompanionPickers();
    selectedCompanionIds = Array.from(document.querySelectorAll("#companions input:checked")).map((c) => parseInt(c.value, 10));
    refreshCuisineChips();
    saveState();
});

// Cuisine chips cycle through three mutually exclusive states (see
// cuisine-chips.js), so a cuisine can't be preferred and disliked at once
// (the algorithm filters disliked before it ever applies the preferred
// bonus, so "both" did nothing).
let cuisineStates = new Map(); // lowercase cuisine -> one of CUISINE_STATES, mine only

function cuisineState(cuisine) {
    return cuisineStates.get(cuisine.toLowerCase()) || "neutral";
}

// What the currently selected companions think of a cuisine, from their own
// saved preferences (read-only -- this page never writes to a companion's
// account). A dislike from any companion wins over a preference from
// another, matching how the suggestion algorithm treats dislikes as a hard
// filter that overrides anyone's preference bonus. This only ever supplies
// the *default* shown for a cuisine you haven't picked yourself -- once you
// click a chip it's purely yours from then on, cycling the same three
// states as before regardless of that default.
function companionState(cuisine) {
    const key = cuisine.toLowerCase();
    let prefer = false;
    for (const id of selectedCompanionIds) {
        const u = usersById.get(id);
        if (!u) continue;
        if ((u.disliked_cuisines || []).some((c) => c.toLowerCase() === key)) return "avoid";
        if ((u.preferred_cuisines || []).some((c) => c.toLowerCase() === key)) prefer = true;
    }
    return prefer ? "prefer" : "neutral";
}

// Once you've clicked a chip -- even cycling it back to neutral -- it must
// keep showing *your* actual pick, not the companion default. Using
// cuisineState() !== "neutral" here instead of this "have I ever touched
// it" check breaks the cycle visually: cycling prefer -> avoid -> neutral
// lands back on "neutral", which reads as unset and falls through to a
// companion's "prefer" again -- so a cuisine a companion likes can never be
// *shown* as neutral, and clicking it looks stuck alternating between green
// and red instead of a clean three-way cycle.
function effectiveCuisineState(cuisine) {
    const key = cuisine.toLowerCase();
    return cuisineStates.has(key) ? cuisineStates.get(key) : companionState(cuisine);
}

// Grows as search results come in, rather than listing every cuisine ever cached.
function addToCuisineUniverse(cuisines) {
    let changed = false;
    for (const c of cuisines || []) {
        const key = c.toLowerCase();
        if (!cuisineUniverse.has(key)) {
            cuisineUniverse.set(key, c);
            changed = true;
        }
    }
    return changed;
}

// Chip state lives in `cuisineStates`, not the DOM, so re-rendering after a
// search widens the universe keeps every existing pick.
function refreshCuisineChips() {
    const el = document.getElementById("cuisine-prefs");
    el.textContent = "";
    const cuisines = Array.from(cuisineUniverse.values()).sort((a, b) => a.localeCompare(b));
    if (cuisines.length === 0) {
        el.textContent = "None yet — run a search to see cuisine options here.";
        return;
    }
    for (const c of cuisines) {
        el.appendChild(
            makeCuisineChip(c, {
                // Cycle from what's actually *shown*, not your invisible own
                // state -- otherwise the first click on a chip whose default
                // came from a companion just recomputes the same color
                // (neutral -> prefer, same green already on screen) and
                // looks like it did nothing. Once you've touched a chip,
                // effectiveCuisineState() is your own state anyway, so this
                // only changes behavior for that first click.
                getState: effectiveCuisineState,
                displayState: effectiveCuisineState,
                setState: (cuisine, state) => {
                    cuisineStates.set(cuisine.toLowerCase(), state);
                    saveState();
                },
            })
        );
    }
}

function cuisinesInState(state) {
    return Array.from(cuisineStates.entries())
        .filter(([, s]) => s === state)
        .map(([key]) => cuisineUniverse.get(key) || key);
}

async function loadPreferences() {
    const meRes = await fetch("/api/users/me");
    me = await meRes.json();
    addToCuisineUniverse(me.preferred_cuisines);
    addToCuisineUniverse(me.disliked_cuisines);
    cuisineStates = new Map();
    // Avoid last, so a legacy account with a cuisine saved in both lists lands
    // on the state the algorithm actually honours.
    for (const c of me.preferred_cuisines) cuisineStates.set(c.toLowerCase(), "prefer");
    for (const c of me.disliked_cuisines) cuisineStates.set(c.toLowerCase(), "avoid");
    refreshCuisineChips();
}

async function saveState() {
    await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            preferred_cuisines: cuisinesInState("prefer"),
            disliked_cuisines: cuisinesInState("avoid"),
            default_companion_ids: selectedCompanionIds,
            default_lat: origin ? origin.lat : null,
            default_lng: origin ? origin.lng : null,
            default_radius_m: parseInt(document.getElementById("radius").value, 10),
        }),
    });
}

function ratingLine(r) {
    const parts = [];
    if (r.combined_rating != null) parts.push(`${r.combined_rating.toFixed(1)} ★`);
    if (r.google_rating != null) parts.push(`Google ${r.google_rating} (${r.google_rating_count ?? 0})`);
    if (r.yelp_rating != null) parts.push(`Yelp ${r.yelp_rating} (${r.yelp_rating_count ?? 0})`);
    if (r.distance_m != null) parts.push(`${Math.round(r.distance_m)} m away`);
    if (r.price_level != null) parts.push("$".repeat(r.price_level));
    return parts.join(" · ");
}

function renderRestaurantCard(r, container) {
    const template = document.getElementById("restaurant-card-template");
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".restaurant-card");
    card.dataset.restaurantId = r.id;
    card.addEventListener("click", (e) => {
        if (e.target.closest("button, a, input")) return;
        focusRestaurant(r.id);
    });

    card.querySelector(".r-name").textContent = r.name;
    card.querySelector(".r-address").textContent = r.address;
    card.querySelector(".r-meta").textContent = ratingLine(r);

    const cuisinesEl = card.querySelector(".r-cuisines");
    for (const c of r.cuisines.slice(0, 5)) {
        const span = document.createElement("span");
        span.textContent = c.replace(/_/g, " ");
        cuisinesEl.appendChild(span);
    }

    const mapsLink = card.querySelector(".r-maps-link");
    if (r.maps_url) {
        mapsLink.href = r.maps_url;
    } else {
        mapsLink.remove();
    }

    const starPicker = card.querySelector(".star-picker");
    const stars = starPicker.querySelectorAll("span");
    const highlight = (n) => stars.forEach((s, i) => s.classList.toggle("filled", i < n));
    if (r.personal_rating) highlight(r.personal_rating);

    const companionNote = card.querySelector(".companion-rating-note");
    if (r.companion_rating != null && r.companion_rating_count > 0) {
        const n = r.companion_rating_count;
        companionNote.textContent = `Companions: ${r.companion_rating.toFixed(1)} ★ (${n})`;
        companionNote.hidden = false;
    }

    stars.forEach((s) => {
        s.addEventListener("click", async () => {
            const n = parseInt(s.dataset.star, 10);
            highlight(n);
            await fetch(`/api/restaurants/${r.id}/rate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stars: n }),
            });
        });
    });

    card.querySelector(".btn-blacklist").addEventListener("click", async () => {
        await fetch(`/api/restaurants/${r.id}/blacklist`, { method: "POST" });
        const m = restaurantMarkers.get(r.id);
        if (m) {
            m.setMap(null);
            restaurantMarkers.delete(r.id);
        }
        card.remove();
    });

    const visitActionEl = card.querySelector(".r-visit-action");
    const markConfirmed = (name) => {
        visitActionEl.innerHTML = `<span class="confirmed">Logged: ${name}</span>`;
    };

    card.querySelector(".btn-went-here").addEventListener("click", async () => {
        await fetch("/api/visits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restaurant_id: r.id, was_suggested: true, companion_ids: selectedCompanionIds }),
        });
        markConfirmed(r.name);
    });

    container.appendChild(card);
}

async function findLunch() {
    const resultEl = document.getElementById("result");
    const altEl = document.getElementById("alternatives");
    const altHeading = document.getElementById("alternatives-heading");

    if (!origin) {
        resultEl.innerHTML = '<p class="error">Pick a starting location on the map first.</p>';
        return;
    }

    resultEl.innerHTML = "<p>Looking for a good spot...</p>";
    altEl.innerHTML = "";
    altHeading.hidden = true;
    clearRestaurantMarkers();

    const radius_m = parseInt(document.getElementById("radius").value, 10);
    const res = await fetch("/api/restaurants/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: origin.lat, lng: origin.lng, radius_m, companion_ids: selectedCompanionIds }),
    });

    if (!res.ok) {
        resultEl.innerHTML = '<p class="error">Something went wrong fetching restaurants.</p>';
        return;
    }

    const data = await res.json();
    resultEl.innerHTML = "";
    if (!data.pick) {
        resultEl.innerHTML = "<p>No restaurants found nearby that fit everyone's preferences. Try widening the radius.</p>";
        return;
    }
    renderRestaurantCard(data.pick, resultEl);

    altEl.innerHTML = "";
    altHeading.hidden = false;
    if (data.alternatives.length === 0) {
        altEl.innerHTML = '<p class="hint">No other nearby options.</p>';
    }
    for (const alt of data.alternatives) {
        renderRestaurantCard(alt, altEl);
    }

    plotRestaurantMarkers(data.pick, data.alternatives);

    const foundCuisines = [...(data.pick ? data.pick.cuisines : []), ...data.alternatives.flatMap((a) => a.cuisines)];
    if (addToCuisineUniverse(foundCuisines)) {
        refreshCuisineChips();
    }
}

document.getElementById("radius").addEventListener("input", (e) => {
    document.getElementById("radius-value").textContent = e.target.value;
});
document.getElementById("radius").addEventListener("change", saveState);
document.getElementById("find-lunch").addEventListener("click", findLunch);

loadPreferences().then(() => {
    initMap();
    loadCompanions();
});
