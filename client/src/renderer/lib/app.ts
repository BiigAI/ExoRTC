// Main application controller

// State
let currentUser: any = null;
let currentServer: any = null;
let currentRoom: any = null;
let servers: any[] = [];
let rooms: any[] = [];
let roomMembers: any[] = [];
let canShout: boolean = false;
let isPttActive: boolean = false;
let isShoutActive: boolean = false;

// DOM Elements
const authPage = document.getElementById('auth-page')!;
const appPage = document.getElementById('app-page')!;
const statusBar = document.getElementById('status-bar')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const registerForm = document.getElementById('register-form') as HTMLFormElement;
const errorMessage = document.getElementById('error-message')!;

// Initialize app
async function init() {
    // Check for existing token
    const token = (window as any).api.getToken();
    if (token) {
        const result = await (window as any).api.getMe();
        if (result.data) {
            currentUser = result.data.user;
            await connectAndShowApp();
            return;
        }
    }
    showAuth();
}

function showAuth() {
    authPage.classList.remove('hidden');
    appPage.classList.add('hidden');
    statusBar.classList.add('hidden');
}

async function connectAndShowApp() {
    // Initialize audio engine
    await (window as any).audioEngine.initialize();

    // Connect to socket
    const token = (window as any).api.getToken();
    const connected = await (window as any).socketManager.connect(token);

    if (!connected) {
        showError('Failed to connect to server');
        return;
    }

    // Set up socket event handlers
    setupSocketHandlers();

    // Set up hotkey handlers
    setupHotkeyHandlers();

    // Load servers
    await loadServers();

    // Update UI
    document.getElementById('user-name')!.textContent = currentUser.username;
    document.getElementById('user-avatar')!.textContent = currentUser.username[0].toUpperCase();

    // Show app
    authPage.classList.add('hidden');
    appPage.classList.remove('hidden');
    appPage.style.display = 'flex';
    statusBar.classList.remove('hidden');
}

function setupSocketHandlers() {
    const sm = (window as any).socketManager;

    // Room events
    sm.on('room-joined', async (data: any) => {
        console.log('Joined room:', data);
        roomMembers = data.members;
        updateRoomMembersUI();

        // Create peer connections to existing members
        for (const member of data.members) {
            await (window as any).audioEngine.createPeerConnection(member.user_id, member.username, true);
        }
    });

    sm.on('user-joined', async (data: any) => {
        console.log('User joined:', data);
        roomMembers.push({ user_id: data.userId, username: data.username });
        updateRoomMembersUI();
    });

    sm.on('user-left', (data: any) => {
        console.log('User left:', data);
        roomMembers = roomMembers.filter(m => m.user_id !== data.userId);
        (window as any).audioEngine.closePeerConnection(data.userId);
        updateRoomMembersUI();
    });

    sm.on('room-left', () => {
        currentRoom = null;
        roomMembers = [];
        (window as any).audioEngine.closeAllConnections();
        showNoRoomView();
    });

    // WebRTC signaling
    sm.on('offer', async (data: any) => {
        await (window as any).audioEngine.handleOffer(data.fromUserId, data.fromUsername, data.signal);
    });

    sm.on('answer', async (data: any) => {
        await (window as any).audioEngine.handleAnswer(data.fromUserId, data.signal);
    });

    sm.on('ice-candidate', async (data: any) => {
        await (window as any).audioEngine.handleIceCandidate(data.fromUserId, data.signal);
    });

    // Voice activity
    sm.on('user-speaking', (data: any) => {
        const memberCard = document.querySelector(`[data-user-id="${data.userId}"]`);
        if (memberCard) {
            if (data.isSpeaking) {
                memberCard.classList.add('speaking');
            } else {
                memberCard.classList.remove('speaking');
            }
        }
    });

    // Shout
    sm.on('shout-incoming', async (data: any) => {
        console.log('Shout from:', data.fromUsername);
        // Create temporary connection for shout
        await (window as any).audioEngine.createPeerConnection(data.fromUserId, data.fromUsername, false);
    });

    sm.on('shout-ended', (data: any) => {
        (window as any).audioEngine.closePeerConnection(data.fromUserId);
    });

    sm.on('shout-targets', async (data: any) => {
        // Connect to all shout targets
        for (const target of data.targets) {
            await (window as any).audioEngine.createPeerConnection(target.userId, target.username, true);
        }
    });

    sm.on('error', (data: any) => {
        console.error('Socket error:', data.message);
    });
}

function setupHotkeyHandlers() {
    // Listen for hotkeys from main process
    if ((window as any).electronAPI) {
        (window as any).electronAPI.onHotkey((data: { key: string; pressed: boolean }) => {
            if (data.key === 'ptt') {
                handlePtt(data.pressed);
            } else if (data.key === 'shout') {
                handleShout(data.pressed);
            }
        });
    }

    // Also handle keyboard events when focused
    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyV' && !e.repeat) handlePtt(true);
        if (e.code === 'KeyB' && !e.repeat) handleShout(true);
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyV') handlePtt(false);
        if (e.code === 'KeyB') handleShout(false);
    });

    // Mouse events on buttons
    const pttBtn = document.getElementById('ptt-btn')!;
    const shoutBtn = document.getElementById('shout-btn')!;

    pttBtn.addEventListener('mousedown', () => handlePtt(true));
    pttBtn.addEventListener('mouseup', () => handlePtt(false));
    pttBtn.addEventListener('mouseleave', () => { if (isPttActive) handlePtt(false); });

    shoutBtn.addEventListener('mousedown', () => handleShout(true));
    shoutBtn.addEventListener('mouseup', () => handleShout(false));
    shoutBtn.addEventListener('mouseleave', () => { if (isShoutActive) handleShout(false); });
}

function handlePtt(pressed: boolean) {
    if (!currentRoom) return;

    isPttActive = pressed;
    const pttBtn = document.getElementById('ptt-btn')!;
    const myCard = document.querySelector(`[data-user-id="${currentUser.id}"]`);

    if (pressed) {
        pttBtn.classList.add('active');
        if (myCard) myCard.classList.add('speaking');
        (window as any).audioEngine.setMuted(false);
        (window as any).socketManager.setSpeaking(true);
    } else {
        pttBtn.classList.remove('active');
        if (myCard) myCard.classList.remove('speaking');
        (window as any).audioEngine.setMuted(true);
        (window as any).socketManager.setSpeaking(false);
    }
}

function handleShout(pressed: boolean) {
    if (!currentRoom || !canShout) return;

    isShoutActive = pressed;
    const shoutBtn = document.getElementById('shout-btn')!;
    const myCard = document.querySelector(`[data-user-id="${currentUser.id}"]`);

    if (pressed) {
        shoutBtn.classList.add('active');
        if (myCard) myCard.classList.add('shouting');
        (window as any).audioEngine.setMuted(false);
        (window as any).socketManager.startShout(currentServer.id);
    } else {
        shoutBtn.classList.remove('active');
        if (myCard) myCard.classList.remove('shouting');
        (window as any).audioEngine.setMuted(true);
        (window as any).socketManager.endShout(currentServer.id);
    }
}

async function loadServers() {
    const result = await (window as any).api.getServers();
    if (result.data) {
        servers = result.data.servers;
        updateServerListUI();
    }
}

async function loadRooms(serverId: string) {
    const result = await (window as any).api.getRooms(serverId);
    if (result.data) {
        rooms = result.data.rooms;
        updateRoomListUI();
    }
}

async function selectServer(server: any) {
    // Leave current room if any
    if (currentRoom) {
        (window as any).socketManager.leaveRoom();
    }

    currentServer = server;

    // Check shout permission
    const serverDetails = await (window as any).api.getServer(server.id);
    if (serverDetails.data) {
        canShout = serverDetails.data.shoutUsers.some((u: any) => u.user_id === currentUser.id);
        updateShoutButton();
    }

    await loadRooms(server.id);

    document.getElementById('room-section')!.style.display = 'block';
    updateServerListUI();
}

async function joinRoom(room: any) {
    if (currentRoom?.id === room.id) return;

    currentRoom = room;
    (window as any).socketManager.joinRoom(room.id);

    document.getElementById('current-room-name')!.textContent = room.name;
    showRoomView();
    updateRoomListUI();
}

function leaveCurrentRoom() {
    if (currentRoom) {
        (window as any).socketManager.leaveRoom();
        currentRoom = null;
        roomMembers = [];
        showNoRoomView();
        updateRoomListUI();
    }
}

// UI Updates
function updateServerListUI() {
    const serverList = document.getElementById('server-list')!;
    serverList.innerHTML = servers.map(s => `
        <div class="server-item ${currentServer?.id === s.id ? 'active' : ''}" onclick="selectServer(${JSON.stringify(s).replace(/"/g, '&quot;')})">
            <div class="server-item-name">${s.name}</div>
            <div class="server-item-code">Code: ${s.invite_code}</div>
        </div>
    `).join('');
}

function updateRoomListUI() {
    const roomList = document.getElementById('room-list')!;
    roomList.innerHTML = rooms.map(r => `
        <div class="room-item ${currentRoom?.id === r.id ? 'active' : ''}" onclick="joinRoom(${JSON.stringify(r).replace(/"/g, '&quot;')})">
            <div class="room-item-icon">🔊</div>
            <span>${r.name}</span>
            <span class="room-item-count">${r.member_count || 0}</span>
        </div>
    `).join('');
}

function updateRoomMembersUI() {
    const roomMembersEl = document.getElementById('room-members')!;

    // Add current user first
    const allMembers = [{ user_id: currentUser.id, username: currentUser.username }, ...roomMembers];

    roomMembersEl.innerHTML = allMembers.map(m => `
        <div class="member-card" data-user-id="${m.user_id}">
            <div class="member-avatar">${m.username[0].toUpperCase()}</div>
            <div class="member-name">${m.username}${m.user_id === currentUser.id ? ' (You)' : ''}</div>
            <div class="member-status">In channel</div>
        </div>
    `).join('');
}

function updateShoutButton() {
    const shoutBtn = document.getElementById('shout-btn')!;
    if (canShout) {
        shoutBtn.classList.remove('disabled');
        shoutBtn.title = 'Broadcast to all squad leaders';
    } else {
        shoutBtn.classList.add('disabled');
        shoutBtn.title = 'Shout permission required';
    }
}

function showRoomView() {
    document.getElementById('no-room-view')!.classList.add('hidden');
    const roomView = document.getElementById('room-view')!;
    roomView.classList.remove('hidden');
    roomView.style.display = 'flex';
}

function showNoRoomView() {
    document.getElementById('room-view')!.classList.add('hidden');
    document.getElementById('no-room-view')!.classList.remove('hidden');
}

function showError(message: string) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
    setTimeout(() => errorMessage.classList.remove('show'), 5000);
}

// Modal helpers
function openModal(id: string) {
    document.getElementById(id)!.classList.add('show');
}

function closeModal(id: string) {
    document.getElementById(id)!.classList.remove('show');
}

// Make functions available globally
(window as any).selectServer = selectServer;
(window as any).joinRoom = joinRoom;
(window as any).openModal = openModal;
(window as any).closeModal = closeModal;

// Event listeners
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (document.getElementById('login-username') as HTMLInputElement).value;
    const password = (document.getElementById('login-password') as HTMLInputElement).value;

    const result = await (window as any).api.login(username, password);
    if (result.error) {
        showError(result.error);
        return;
    }

    currentUser = result.data.user;
    await connectAndShowApp();
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (document.getElementById('register-username') as HTMLInputElement).value;
    const email = (document.getElementById('register-email') as HTMLInputElement).value;
    const password = (document.getElementById('register-password') as HTMLInputElement).value;

    const result = await (window as any).api.register(username, email, password);
    if (result.error) {
        showError(result.error);
        return;
    }

    currentUser = result.data.user;
    await connectAndShowApp();
});

document.getElementById('show-register')!.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    document.getElementById('login-switch')!.classList.add('hidden');
    document.getElementById('register-switch')!.classList.remove('hidden');
});

document.getElementById('show-login')!.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('register-switch')!.classList.add('hidden');
    document.getElementById('login-switch')!.classList.remove('hidden');
});

document.getElementById('create-server-btn')!.addEventListener('click', () => openModal('create-server-modal'));
document.getElementById('join-server-btn')!.addEventListener('click', () => openModal('join-server-modal'));

document.getElementById('create-server-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('server-name') as HTMLInputElement).value;
    const result = await (window as any).api.createServer(name);
    if (result.data) {
        closeModal('create-server-modal');
        (document.getElementById('server-name') as HTMLInputElement).value = '';
        await loadServers();
    }
});

document.getElementById('join-server-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = (document.getElementById('invite-code') as HTMLInputElement).value;
    const result = await (window as any).api.joinServer(code);
    if (result.error) {
        showError(result.error);
        return;
    }
    closeModal('join-server-modal');
    (document.getElementById('invite-code') as HTMLInputElement).value = '';
    await loadServers();
});

document.getElementById('leave-room-btn')!.addEventListener('click', leaveCurrentRoom);

document.getElementById('logout-btn')!.addEventListener('click', () => {
    (window as any).api.logout();
    (window as any).socketManager.disconnect();
    (window as any).audioEngine.cleanup();
    currentUser = null;
    currentServer = null;
    currentRoom = null;
    showAuth();
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });
});

// Start app
init();
