let groups = [];

async function loadGroups() {
    const res = await fetch("/api/groups");
    groups = await res.json();
    renderGroupsList();
}

function renderGroupsList() {
    const el = document.getElementById("groups-list");
    el.innerHTML = "";
    if (groups.length === 0) {
        el.textContent = "No locations yet.";
        return;
    }
    for (const g of groups) {
        const label = document.createElement("label");
        label.textContent = g.name + " ";
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "×";
        del.title = "Delete location";
        del.addEventListener("click", async () => {
            if (!confirm(`Delete location "${g.name}"? Members will be left without a location.`)) return;
            await fetch(`/api/admin/groups/${g.id}`, { method: "DELETE" });
            await loadGroups();
            await loadUsers();
        });
        label.appendChild(del);
        el.appendChild(label);
    }
}

function groupSelectFor(user) {
    const select = document.createElement("select");
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "No location";
    select.appendChild(noneOpt);
    for (const g of groups) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        if (user.group_id === g.id) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
        await fetch(`/api/admin/users/${user.id}/group`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ group_id: select.value ? parseInt(select.value, 10) : null }),
        });
    });
    return select;
}

async function loadUsers() {
    const res = await fetch("/api/admin/users");
    const users = await res.json();
    const tbody = document.getElementById("users-tbody");
    tbody.innerHTML = "";
    for (const u of users) {
        const tr = document.createElement("tr");

        const nameTd = document.createElement("td");
        nameTd.textContent = u.display_name;
        tr.appendChild(nameTd);

        const emailTd = document.createElement("td");
        emailTd.textContent = u.email ? `${u.email} ${u.email_verified ? "" : "(unverified)"}`.trim() : "—";
        tr.appendChild(emailTd);

        const groupTd = document.createElement("td");
        groupTd.appendChild(groupSelectFor(u));
        tr.appendChild(groupTd);

        const adminTd = document.createElement("td");
        adminTd.textContent = u.is_admin ? "Yes" : "";
        tr.appendChild(adminTd);

        const joinedTd = document.createElement("td");
        joinedTd.textContent = new Date(u.created_at).toLocaleDateString();
        tr.appendChild(joinedTd);

        const actionsTd = document.createElement("td");

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

document.getElementById("add-group").addEventListener("click", async () => {
    const input = document.getElementById("new-group-name");
    const name = input.value.trim();
    if (!name) return;
    await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    input.value = "";
    await loadGroups();
    await loadUsers();
});

(async function init() {
    await loadGroups();
    await loadUsers();
})();
