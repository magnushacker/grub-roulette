let map, marker;
let origin = null; // {lat, lng}
let selectedCompanionIds = [];
let me = null;
let restaurantMarkers = new Map(); // restaurant id -> google.maps.Marker
let infoWindow = null;
let highlightedCard = null;
let cuisineUniverse = new Map(); // lowercase cuisine -> display-cased value

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

const pickableCompanions = new Map(); // id -> user, for colleagues from other locations not yet added

function addCompanionCheckbox(u, checked) {
    const el = document.getElementById("companions");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = u.id;
    checkbox.checked = checked;
    checkbox.addEventListener("change", () => {
        selectedCompanionIds = Array.from(el.querySelectorAll("input:checked")).map((c) => parseInt(c.value, 10));
        saveState();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(u.display_name));
    el.appendChild(label);
}

async function loadCompanions() {
    const el = document.getElementById("companions");
    const picker = document.getElementById("companion-picker");
    const [usersRes, groupsRes] = await Promise.all([fetch("/api/users"), fetch("/api/groups")]);
    const users = await usersRes.json();
    const groups = await groupsRes.json();
    if (users.length === 0) {
        el.textContent = "No colleagues registered yet.";
        picker.hidden = true;
        return;
    }
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const defaults = new Set(me ? me.default_companion_ids : []);
    const myGroupId = me ? me.group_id : null;

    // Show colleagues in the same location by default. Anyone already picked
    // as a default companion stays visible too, even from another location,
    // so a saved cross-location pick doesn't silently disappear.
    const sameLocation = users.filter((u) => u.group_id === myGroupId);
    const otherLocation = users.filter((u) => u.group_id !== myGroupId);
    const visible = [...sameLocation, ...otherLocation.filter((u) => defaults.has(u.id))];

    el.innerHTML = "";
    if (visible.length === 0) {
        el.textContent = "No colleagues in your location yet — add one from another location below.";
    } else {
        for (const u of visible) addCompanionCheckbox(u, defaults.has(u.id));
    }
    selectedCompanionIds = Array.from(el.querySelectorAll("input:checked")).map((c) => parseInt(c.value, 10));

    pickableCompanions.clear();
    picker.innerHTML = '<option value="">Add a colleague from another location...</option>';
    for (const u of otherLocation.filter((u) => !defaults.has(u.id))) {
        pickableCompanions.set(u.id, u);
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.display_name} (${groupName.get(u.group_id) || "no location"})`;
        picker.appendChild(opt);
    }
    picker.hidden = pickableCompanions.size === 0;
}

document.getElementById("companion-picker").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    const u = pickableCompanions.get(id);
    if (!u) return;
    if (document.getElementById("companions").textContent === "No colleagues in your location yet — add one from another location below.") {
        document.getElementById("companions").innerHTML = "";
    }
    addCompanionCheckbox(u, true);
    pickableCompanions.delete(id);
    e.target.querySelector(`option[value="${id}"]`).remove();
    e.target.value = "";
    e.target.hidden = pickableCompanions.size === 0;
    selectedCompanionIds = Array.from(document.querySelectorAll("#companions input:checked")).map((c) => parseInt(c.value, 10));
    saveState();
});

// One chip per cuisine, cycling through three mutually exclusive states, so a
// cuisine can't be preferred and disliked at once (the algorithm filters
// disliked before it ever applies the preferred bonus, so "both" did nothing).
const CUISINE_STATES = ["neutral", "prefer", "avoid"];
const STATE_MARK = { neutral: "", prefer: "✓", avoid: "✗" };
const STATE_DESCRIPTION = { neutral: "no preference", prefer: "preferred", avoid: "don't suggest" };
let cuisineStates = new Map(); // lowercase cuisine -> one of CUISINE_STATES

function cuisineState(cuisine) {
    return cuisineStates.get(cuisine.toLowerCase()) || "neutral";
}

function paintCuisineChip(btn, cuisine) {
    const state = cuisineState(cuisine);
    const label = cuisine.replace(/_/g, " ");
    btn.dataset.state = state;
    btn.textContent = "";
    if (STATE_MARK[state]) {
        const mark = document.createElement("span");
        mark.className = "chip-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = STATE_MARK[state];
        btn.appendChild(mark);
    }
    btn.appendChild(document.createTextNode(label));
    btn.setAttribute("aria-label", `${label}: ${STATE_DESCRIPTION[state]}`);
}

function cuisineChip(cuisine) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.addEventListener("click", (e) => {
        const step = e.shiftKey ? -1 : 1;
        const next = (CUISINE_STATES.indexOf(cuisineState(cuisine)) + step + CUISINE_STATES.length) % CUISINE_STATES.length;
        cuisineStates.set(cuisine.toLowerCase(), CUISINE_STATES[next]);
        paintCuisineChip(btn, cuisine);
        saveState();
    });
    paintCuisineChip(btn, cuisine);
    return btn;
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
    for (const c of cuisines) el.appendChild(cuisineChip(c));
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
    if (r.personal_rating) highlight(Math.round(r.personal_rating));
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
        elsewhereBox.hidden = true;
    };

    card.querySelector(".btn-went-here").addEventListener("click", async () => {
        await fetch("/api/visits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restaurant_id: r.id, was_suggested: true, companion_ids: selectedCompanionIds }),
        });
        markConfirmed(r.name);
    });

    const elsewhereBox = card.querySelector(".elsewhere-search");
    const elsewhereInput = card.querySelector(".elsewhere-input");
    const elsewhereResults = card.querySelector(".elsewhere-results");

    card.querySelector(".btn-went-elsewhere").addEventListener("click", () => {
        elsewhereBox.hidden = false;
        elsewhereInput.focus();
    });

    let searchTimer = null;
    elsewhereInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const q = elsewhereInput.value.trim();
        if (q.length < 2) {
            elsewhereResults.innerHTML = "";
            return;
        }
        searchTimer = setTimeout(async () => {
            const params = new URLSearchParams({ q });
            if (origin) {
                params.set("lat", origin.lat);
                params.set("lng", origin.lng);
                params.set("radius_m", document.getElementById("radius").value);
            }
            const res = await fetch(`/api/restaurants/search?${params}`);
            const found = await res.json();
            elsewhereResults.innerHTML = "";
            for (const f of found) {
                const btn = document.createElement("button");
                btn.textContent = `${f.name} — ${f.address}`;
                btn.addEventListener("click", async () => {
                    await fetch("/api/visits", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            restaurant_id: f.id,
                            was_suggested: false,
                            companion_ids: selectedCompanionIds,
                        }),
                    });
                    markConfirmed(f.name);
                });
                elsewhereResults.appendChild(btn);
            }
        }, 350);
    });

    container.appendChild(card);
}

async function findLunch() {
    const resultEl = document.getElementById("result");
    const altEl = document.getElementById("alternatives");

    if (!origin) {
        resultEl.innerHTML = '<p class="error">Pick a starting location on the map first.</p>';
        return;
    }

    resultEl.innerHTML = "<p>Looking for a good spot...</p>";
    altEl.innerHTML = "";
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
