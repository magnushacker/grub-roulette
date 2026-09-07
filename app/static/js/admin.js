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
        const rename = document.createElement("button");
        rename.type = "button";
        rename.textContent = "✎";
        rename.title = "Rename location";
        rename.addEventListener("click", async () => {
            const newName = prompt(`New name for "${g.name}":`, g.name);
            if (!newName || newName === g.name) return;
            const res = await fetch(`/api/admin/groups/${g.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName }),
            });
            if (res.ok) {
                await loadGroups();
                await loadUsers();
            } else {
                const body = await res.json().catch(() => ({}));
                alert(body.detail || "Failed to rename location.");
            }
        });
        label.appendChild(rename);
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
