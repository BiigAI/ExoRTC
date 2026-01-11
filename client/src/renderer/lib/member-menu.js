
// Context menu state
let contextMenuMemberId = null;

function showMemberContextMenu(x, y, userId, username) {
    const menu = document.getElementById('member-context-menu');
    const body = menu.querySelector('.member-context-body');
    contextMenuMemberId = userId;

    // Reset UI for volume
    const vol = memberVolumeSettings.getVolume(userId);
    document.getElementById('member-volume-slider').value = vol;
    document.getElementById('member-volume-value').textContent = `${vol}%`;
    const percentage = (vol / 200) * 100;
    document.getElementById('member-volume-slider').style.background = `linear-gradient(to right, var(--accent) ${percentage}%, #333 ${percentage}%)`;

    // Remove dynamic items
    body.querySelectorAll('.dynamic-item').forEach(e => e.remove());

    // Admin Options
    if (canManageMembers(currentUserRole)) {
        const member = roomMembers.find(m => m.user_id === userId);
        if (member) {
            const div = document.createElement('div');
            div.className = 'context-menu-divider dynamic-item';
            body.appendChild(div);

            // Mute Server
            const muteItem = document.createElement('div');
            muteItem.className = 'context-menu-item dynamic-item';
            muteItem.innerHTML = `<span>${member.isServerMuted ? 'Unmute (Server)' : 'Mute (Server)'}</span>`;
            muteItem.onclick = () => {
                const event = member.isServerMuted ? 'unmute-user' : 'mute-user';
                socketManager.emit(event, { serverId: currentServer.id, userId });
                hideMemberContextMenu();
            };
            body.appendChild(muteItem);

            // Kick
            const kickItem = document.createElement('div');
            kickItem.className = 'context-menu-item dynamic-item';
            kickItem.innerHTML = `<span style="color:var(--danger)">Kick (Temp)</span>`;
            kickItem.onclick = () => {
                const duration = prompt('Kick duration (minutes):', '15');
                if (duration) {
                    socketManager.emit('kick-user', { serverId: currentServer.id, userId, duration: parseInt(duration) || 15 });
                }
                hideMemberContextMenu();
            };
            body.appendChild(kickItem);
        }
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
}

function hideMemberContextMenu() {
    document.getElementById('member-context-menu').classList.add('hidden');
    contextMenuMemberId = null;
}
