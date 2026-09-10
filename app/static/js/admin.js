let teams = [];

async function loadTeams() {
    const res = await fetch("/api/admin/teams");
    teams = await res.json();
    renderTeamsList();
}

function renderTeamsList() {
    const tbody = document.getElementById("teams-tbody");
    tbody.innerHTML = "";
    if (teams.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No teams yet.</td></tr>';
        return;
    }
    for (const t of teams) {
        const tr = document.createElement("tr");

        const nameTd = document.createElement("td");
        nameTd.textContent = t.name;
        tr.appendChild(nameTd);

        const webhookTd = document.createElement("td");
        const webhookInput = document.createElement("input");
        webhookInput.type = "text";
        webhookInput.placeholder = "https://...";
        webhookInput.value = t.teams_webhook_url || "";
        webhookInput.addEventListener("change", async () => {
            await fetch(`/api/admin/teams/${t.id}/webhook`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ teams_webhook_url: webhookInput.value.trim() || null }),
            });
        });
        webhookTd.appendChild(webhookInput);
        tr.appendChild(webhookTd);

        const actionsTd = document.createElement("td");
        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "secondary";
        rename.textContent = "Rename";
        rename.addEventListener("click", async () => {
            const newName = prompt(`New name for "${t.name}":`, t.name);
            if (!newName || newName === t.name) return;
            const res = await fetch(`/api/admin/teams/${t.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName }),
            });
            if (res.ok) {
                await loadTeams();
                await loadUsers();
            } else {
                const body = await res.json().catch(() => ({}));
                alert(body.detail || "Failed to rename team.");
            }
        });
        actionsTd.appendChild(rename);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
            if (!confirm(`Delete team "${t.name}"? Members will be left without a team.`)) return;
            await fetch(`/api/admin/teams/${t.id}`, { method: "DELETE" });
            await loadTeams();
            await loadUsers();
        });
        actionsTd.appendChild(del);

        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    }
}

function teamSelectFor(user) {
    const select = document.createElement("select");
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "No team";
    select.appendChild(noneOpt);
    for (const t of teams) {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        if (user.team_id === t.id) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
        await fetch(`/api/admin/users/${user.id}/team`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team_id: select.value ? parseInt(select.value, 10) : null }),
        });
    });
    return select;
}

function notifyTeamsCheckboxFor(user) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = user.can_notify_teams;
    checkbox.addEventListener("change", async () => {
        await fetch(`/api/admin/users/${user.id}/notify-teams`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ can_notify_teams: checkbox.checked }),
        });
    });
    return checkbox;
}

let currentUsers = [];
// Matches the backend's own default order (list_users sorts by display_name).
let userSort = { key: "display_name", dir: "asc" };

function teamNameFor(u) {
    const t = teams.find((t) => t.id === u.team_id);
    return t ? t.name : "No team";
}

function compareUsers(a, b, key) {
    if (key === "is_admin") return (a.is_admin === b.is_admin) ? 0 : a.is_admin ? 1 : -1;
    if (key === "can_notify_teams") return (a.can_notify_teams === b.can_notify_teams) ? 0 : a.can_notify_teams ? 1 : -1;
    if (key === "created_at") return new Date(a.created_at) - new Date(b.created_at);
    if (key === "team") return teamNameFor(a).localeCompare(teamNameFor(b));
    // display_name/email -- email can be null on legacy accounts.
    return (a[key] || "").localeCompare(b[key] || "");
}

function updateSortIndicators() {
    for (const th of document.querySelectorAll("#users-table th.sortable")) {
        const indicator = th.querySelector(".sort-indicator");
        indicator.textContent = th.dataset.sort === userSort.key ? (userSort.dir === "asc" ? "▲" : "▼") : "";
    }
}

async function loadUsers() {
    const res = await fetch("/api/admin/users");
    currentUsers = await res.json();
    renderUsersTable();
}

function renderUsersTable() {
    const sorted = [...currentUsers].sort((a, b) => {
        const result = compareUsers(a, b, userSort.key);
        return userSort.dir === "asc" ? result : -result;
    });
    updateSortIndicators();

    const tbody = document.getElementById("users-tbody");
    tbody.innerHTML = "";
    for (const u of sorted) {
        const tr = document.createElement("tr");

        const nameTd = document.createElement("td");
        nameTd.textContent = u.display_name;
        tr.appendChild(nameTd);

        const emailTd = document.createElement("td");
        emailTd.textContent = u.email ? `${u.email} ${u.email_verified ? "" : "(unverified)"}`.trim() : "—";
        tr.appendChild(emailTd);

        const teamTd = document.createElement("td");
        teamTd.appendChild(teamSelectFor(u));
        tr.appendChild(teamTd);

        const adminTd = document.createElement("td");
        adminTd.textContent = u.is_admin ? "Yes" : "";
        tr.appendChild(adminTd);

        const notifyTeamsTd = document.createElement("td");
        notifyTeamsTd.appendChild(notifyTeamsCheckboxFor(u));
        tr.appendChild(notifyTeamsTd);

        const joinedTd = document.createElement("td");
        // created_at is UTC but serialized without a timezone suffix, so tell
        // the Date constructor explicitly -- otherwise it's parsed as local
        // time and displays wrong by the browser's UTC offset.
        joinedTd.textContent = new Date(u.created_at + "Z").toLocaleString();
        tr.appendChild(joinedTd);

        const actionsTd = document.createElement("td");

        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "secondary";
        renameBtn.textContent = "Rename";
        renameBtn.addEventListener("click", async () => {
            const newName = prompt(`New name for ${u.display_name}:`, u.display_name);
            if (!newName || newName === u.display_name) return;
            const res = await fetch(`/api/admin/users/${u.id}/name`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ display_name: newName }),
            });
            if (res.ok) {
                await loadUsers();
            } else {
                const body = await res.json().catch(() => ({}));
                alert(body.detail || "Failed to rename user.");
            }
        });
        actionsTd.appendChild(renameBtn);

        const emailBtn = document.createElement("button");
        emailBtn.type = "button";
        emailBtn.className = "secondary";
        emailBtn.textContent = "Change email";
        emailBtn.addEventListener("click", async () => {
            const newEmail = prompt(`New email for ${u.display_name}:`, u.email || "");
            if (!newEmail || newEmail === u.email) return;
            const res = await fetch(`/api/admin/users/${u.id}/email`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newEmail }),
            });
            if (res.ok) {
                await loadUsers();
            } else {
                const body = await res.json().catch(() => ({}));
                alert(body.detail || "Failed to update email.");
            }
        });
        actionsTd.appendChild(emailBtn);

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "secondary";
        resetBtn.textContent = "Reset password";
        resetBtn.addEventListener("click", async () => {
            const newPassword = prompt(`New password for ${u.display_name} (min 8 characters):`);
            if (!newPassword) return;
            if (newPassword.length < 8) {
                alert("Password must be at least 8 characters.");
                return;
            }
            const res = await fetch(`/api/admin/users/${u.id}/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_password: newPassword }),
            });
            alert(res.ok ? "Password updated." : "Failed to update password.");
        });
        actionsTd.appendChild(resetBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "secondary";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", async () => {
            if (!confirm(`Delete ${u.display_name}? This removes their ratings, blacklist, and visit history too.`)) return;
            const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
            if (res.ok) {
                tr.remove();
            } else {
                const body = await res.json().catch(() => ({}));
                alert(body.detail || "Failed to delete user.");
            }
        });
        actionsTd.appendChild(deleteBtn);

        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    }
}

for (const th of document.querySelectorAll("#users-table th.sortable")) {
    th.addEventListener("click", () => {
        const key = th.dataset.sort;
        userSort = key === userSort.key ? { key, dir: userSort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
        renderUsersTable();
    });
}

document.getElementById("add-team").addEventListener("click", async () => {
    const input = document.getElementById("new-team-name");
    const name = input.value.trim();
    if (!name) return;
    await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    input.value = "";
    await loadTeams();
    await loadUsers();
});

(async function init() {
    await loadTeams();
    await loadUsers();
})();
