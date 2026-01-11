// API client for communicating with ExoRTC server

// Server URL - configurable for remote connections
// Change this to your public IP or use the settings prompt
let SERVER_URL = (localStorage.getItem('exortc_server_url') || 'http://localhost:3000').replace(/\/+$/, '');
const API_BASE = SERVER_URL + '/api';

// User settings (stored in localStorage)
const defaultSettings = {
    pttKey: 'KeyV',
    pttKeyDisplay: 'V',
    shoutKey: 'KeyB',
    shoutKeyDisplay: 'B',
    noiseGateThreshold: 30,
    aiNoiseCancel: true,
    aiAggressiveness: 50
};

let settings = { ...defaultSettings };
try {
    const saved = localStorage.getItem('exortc_settings');
    if (saved) {
        settings = { ...defaultSettings, ...JSON.parse(saved) };
    }
} catch (e) {
    console.warn('Failed to load settings');
}

// Audio analysis for noise gate
let audioAnalyser = null;
let audioDataArray = null;
let micLevelInterval = null;

const api = {
    token: null,

    setToken(token) {
        this.token = token;
        if (token) {
            localStorage.setItem('exortc_token', token);
        } else {
            localStorage.removeItem('exortc_token');
        }
    },

    getToken() {
        if (!this.token) {
            this.token = localStorage.getItem('exortc_token');
        }
        return this.token;
    },

    async request(method, endpoint, body) {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            const data = await response.json();

            if (!response.ok) {
                return { error: data.error || 'Request failed' };
            }

            return { data };
        } catch (error) {
            return { error: 'Network error. Is the server running?' };
        }
    },

    // Auth
    async register(username, email, password) {
        const result = await this.request('POST', '/auth/register', { username, email, password });
        if (result.data) {
            this.setToken(result.data.token);
        }
        return result;
    },

    async login(username, password) {
        const result = await this.request('POST', '/auth/login', { username, password });
        if (result.data) {
            this.setToken(result.data.token);
        }
        return result;
    },

    async getMe() {
        return this.request('GET', '/auth/me');
    },

    // Servers
    async getServers() {
        return this.request('GET', '/servers');
    },

    async createServer(name) {
        return this.request('POST', '/servers', { name });
    },

    async joinServer(inviteCode) {
        return this.request('POST', '/servers/join', { invite_code: inviteCode });
    },

    async getServer(serverId) {
        return this.request('GET', `/servers/${serverId}`);
    },

    // Rooms
    async getRooms(serverId) {
        return this.request('GET', `/servers/${serverId}/rooms`);
    },

    async createRoom(serverId, name, voiceMode = 'ptt') {
        return this.request('POST', `/servers/${serverId}/rooms`, { name, voice_mode: voiceMode });
    },

    // Shout permissions
    async grantShout(serverId, userId) {
        return this.request('POST', `/servers/${serverId}/shout-permission`, { user_id: userId });
    },

    async revokeShout(serverId, userId) {
        return this.request('DELETE', `/servers/${serverId}/shout-permission`, { user_id: userId });
    },

    logout() {
        this.setToken(null);
    }
};

// Socket Manager
const socketManager = {
    socket: null,
    eventHandlers: new Map(),

    async connect(token) {
        return new Promise((resolve) => {
            if (typeof io === 'undefined') {
                console.error('Socket.IO not loaded');
                resolve(false);
                return;
            }

            this.socket = io(SERVER_URL, {
                auth: { token },
                transports: ['websocket']
            });

            this.socket.on('connect', () => {
                console.log('Socket connected');
                resolve(true);
            });

            this.socket.on('connect_error', (error) => {
                console.error('Socket connection error:', error.message);
                resolve(false);
            });
        });
    },

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    },

    on(event, callback) {
        if (this.socket) {
            this.socket.on(event, callback);
        }
    },

    emit(event, ...args) {
        if (this.socket) {
            this.socket.emit(event, ...args);
        }
    },

    joinRoom(roomId) {
        this.emit('join-room', roomId);
    },

    leaveRoom() {
        this.emit('leave-room');
    },

    sendOffer(targetUserId, signal) {
        this.emit('offer', { targetUserId, signal });
    },

    sendAnswer(targetUserId, signal) {
        this.emit('answer', { targetUserId, signal });
    },

    sendIceCandidate(targetUserId, signal) {
        this.emit('ice-candidate', { targetUserId, signal });
    },

    setSpeaking(isSpeaking) {
        this.emit('speaking', isSpeaking);
    },

    startShout(serverId) {
        this.emit('shout-start', serverId);
    },

    endShout(serverId) {
        this.emit('shout-end', serverId);
    }
};

// Audio Engine
const audioEngine = {
    localStream: null,
    peers: new Map(),
    isMuted: true,
    audioContext: null,

    rtcConfig: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    },

    async initialize() {
        try {
            const rawStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(rawStream);
            const destination = this.audioContext.createMediaStreamDestination();

            // AI Noise Cancellation (RNNoise)
            try {
                // Determine path relative to the renderer process
                await this.audioContext.audioWorklet.addModule('./lib/rnnoise/rnnoise-processor.js');
                this.rnnoiseNode = new AudioWorkletNode(this.audioContext, 'rnnoise-processor');
                this.rnnoiseNode.port.postMessage({ type: 'toggle', enabled: settings.aiNoiseCancel });
                this.rnnoiseNode.port.postMessage({ type: 'setAggressiveness', value: settings.aiAggressiveness });

                // Graph: Source -> RNNoise -> Destination
                source.connect(this.rnnoiseNode);
                this.rnnoiseNode.connect(destination);

                // Visualization connects from RNNoise output (denoised)
                audioAnalyser = this.audioContext.createAnalyser();
                this.rnnoiseNode.connect(audioAnalyser);
                console.log('RNNoise loaded and connected');
            } catch (e) {
                console.error('Failed to load RNNoise, bypassing:', e);
                // Fallback: Source -> Destination
                source.connect(destination);
                audioAnalyser = this.audioContext.createAnalyser();
                source.connect(audioAnalyser);
            }

            audioAnalyser.fftSize = 256;
            audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

            this.localStream = destination.stream;
            this.rawTracks = rawStream.getTracks(); // Keep reference to stop mic later

            this.setMuted(true);
            console.log('Audio engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to get audio stream:', error);
            return false;
        }
    },

    getMicLevel() {
        if (!audioAnalyser || !audioDataArray) return 0;
        audioAnalyser.getByteFrequencyData(audioDataArray);
        const average = audioDataArray.reduce((a, b) => a + b, 0) / audioDataArray.length;
        return Math.min(100, Math.round(average / 1.28)); // Normalize to 0-100
    },

    setMuted(muted) {
        this.isMuted = muted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !muted;
            });
        }
    },

    async createPeerConnection(userId, username, initiator) {
        this.closePeerConnection(userId);

        const connection = new RTCPeerConnection(this.rtcConfig);
        const peer = { userId, username, connection };
        this.peers.set(userId, peer);

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                connection.addTrack(track, this.localStream);
            });
        }

        connection.ontrack = (event) => {
            console.log('Received remote track from', username);
            peer.stream = event.streams[0];
            this.playRemoteAudio(userId, event.streams[0]);
        };

        connection.onicecandidate = (event) => {
            if (event.candidate) {
                socketManager.sendIceCandidate(userId, event.candidate);
            }
        };

        connection.onconnectionstatechange = () => {
            console.log(`Connection to ${username}: ${connection.connectionState}`);
            if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
                this.closePeerConnection(userId);
            }
        };

        if (initiator) {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            socketManager.sendOffer(userId, offer);
        }

        return connection;
    },

    async handleOffer(fromUserId, fromUsername, offer) {
        const connection = await this.createPeerConnection(fromUserId, fromUsername, false);
        await connection.setRemoteDescription(offer);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socketManager.sendAnswer(fromUserId, answer);
    },

    async handleAnswer(fromUserId, answer) {
        const peer = this.peers.get(fromUserId);
        if (peer) {
            await peer.connection.setRemoteDescription(answer);
        }
    },

    async handleIceCandidate(fromUserId, candidate) {
        const peer = this.peers.get(fromUserId);
        if (peer) {
            try {
                await peer.connection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Failed to add ICE candidate:', error);
            }
        }
    },

    playRemoteAudio(userId, stream) {
        let audio = document.getElementById(`audio-${userId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${userId}`;
            audio.autoplay = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;
    },

    closePeerConnection(userId) {
        const peer = this.peers.get(userId);
        if (peer) {
            peer.connection.close();
            this.peers.delete(userId);
            const audio = document.getElementById(`audio-${userId}`);
            if (audio) audio.remove();
        }
    },

    closeAllConnections() {
        this.peers.forEach((_, userId) => this.closePeerConnection(userId));
    },

    cleanup() {
        this.closeAllConnections();
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.rawTracks) {
            this.rawTracks.forEach(track => track.stop());
            this.rawTracks = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
};

// App State
let currentUser = null;
let currentServer = null;
let currentRoom = null;
let servers = [];
let rooms = [];
let roomMembers = [];
let canShout = false;
let isPttActive = false;
let isShoutActive = false;

// Initialize app
async function init() {
    const token = api.getToken();
    if (token) {
        const result = await api.getMe();
        if (result.data) {
            currentUser = result.data.user;
            await connectAndShowApp();
            return;
        }
    }
    showAuth();
}

function showAuth() {
    document.getElementById('auth-page').classList.remove('hidden');
    document.getElementById('app-page').classList.add('hidden');
    document.getElementById('status-bar').classList.add('hidden');

    // Update server display
    try {
        const url = new URL(SERVER_URL);
        document.getElementById('current-server-display').textContent = url.hostname;
    } catch {
        document.getElementById('current-server-display').textContent = SERVER_URL;
    }
}

function changeServer() {
    document.getElementById('server-url-input').value = SERVER_URL;
    openModal('server-settings-modal');
}

async function connectAndShowApp() {
    await audioEngine.initialize();

    const token = api.getToken();
    const connected = await socketManager.connect(token);

    if (!connected) {
        showError('Failed to connect to server');
        return;
    }

    setupSocketHandlers();
    setupHotkeyHandlers();
    await loadServers();

    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('user-avatar').textContent = currentUser.username[0].toUpperCase();

    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');
    document.getElementById('app-page').style.display = 'flex';
    document.getElementById('status-bar').classList.remove('hidden');
}

function setupSocketHandlers() {
    socketManager.on('room-joined', async (data) => {
        roomMembers = data.members;
        updateRoomMembersUI();
        for (const member of data.members) {
            await audioEngine.createPeerConnection(member.user_id, member.username, true);
        }
    });

    socketManager.on('user-joined', async (data) => {
        roomMembers.push({ user_id: data.userId, username: data.username });
        updateRoomMembersUI();
    });

    socketManager.on('user-left', (data) => {
        roomMembers = roomMembers.filter(m => m.user_id !== data.userId);
        audioEngine.closePeerConnection(data.userId);
        updateRoomMembersUI();
    });

    socketManager.on('room-left', () => {
        currentRoom = null;
        roomMembers = [];
        audioEngine.closeAllConnections();
        showNoRoomView();
    });

    socketManager.on('offer', async (data) => {
        await audioEngine.handleOffer(data.fromUserId, data.fromUsername, data.signal);
    });

    socketManager.on('answer', async (data) => {
        await audioEngine.handleAnswer(data.fromUserId, data.signal);
    });

    socketManager.on('ice-candidate', async (data) => {
        await audioEngine.handleIceCandidate(data.fromUserId, data.signal);
    });

    socketManager.on('user-speaking', (data) => {
        const memberCard = document.querySelector(`[data-user-id="${data.userId}"]`);
        if (memberCard) {
            memberCard.classList.toggle('speaking', data.isSpeaking);
        }
    });

    socketManager.on('shout-incoming', async (data) => {
        await audioEngine.createPeerConnection(data.fromUserId, data.fromUsername, false);
    });

    socketManager.on('shout-ended', (data) => {
        audioEngine.closePeerConnection(data.fromUserId);
    });

    socketManager.on('shout-targets', async (data) => {
        for (const target of data.targets) {
            await audioEngine.createPeerConnection(target.userId, target.username, true);
        }
    });

    // Listen for room updates (new rooms, member count changes)
    socketManager.on('rooms-updated', async () => {
        if (currentServer) {
            await loadRooms(currentServer.id);
        }
    });
}

function setupHotkeyHandlers() {
    if (window.electronAPI) {
        window.electronAPI.onHotkey((data) => {
            if (data.key === 'ptt') handlePtt(data.pressed);
            else if (data.key === 'shout') handleShout(data.pressed);
        });
    }

    document.addEventListener('keydown', (e) => {
        // Handle keybind capture
        if (capturingKey) {
            handleKeyCapture(e);
            return;
        }

        if (e.code === settings.pttKey && !e.repeat) handlePtt(true);
        if (e.code === settings.shoutKey && !e.repeat) handleShout(true);
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === settings.pttKey) handlePtt(false);
        if (e.code === settings.shoutKey) handleShout(false);
    });

    const pttBtn = document.getElementById('ptt-btn');
    const shoutBtn = document.getElementById('shout-btn');

    pttBtn.addEventListener('mousedown', () => handlePtt(true));
    pttBtn.addEventListener('mouseup', () => handlePtt(false));
    pttBtn.addEventListener('mouseleave', () => { if (isPttActive) handlePtt(false); });

    shoutBtn.addEventListener('mousedown', () => handleShout(true));
    shoutBtn.addEventListener('mouseup', () => handleShout(false));
    shoutBtn.addEventListener('mouseleave', () => { if (isShoutActive) handleShout(false); });
}

function handlePtt(pressed) {
    if (!currentRoom) return;

    isPttActive = pressed;
    const pttBtn = document.getElementById('ptt-btn');
    const myCard = document.querySelector(`[data-user-id="${currentUser.id}"]`);

    if (pressed) {
        pttBtn.classList.add('active');
        if (myCard) myCard.classList.add('speaking');
        audioEngine.setMuted(false);
        socketManager.setSpeaking(true);
    } else {
        pttBtn.classList.remove('active');
        if (myCard) myCard.classList.remove('speaking');
        audioEngine.setMuted(true);
        socketManager.setSpeaking(false);
    }
}

function handleShout(pressed) {
    if (!currentRoom || !canShout) return;

    isShoutActive = pressed;
    const shoutBtn = document.getElementById('shout-btn');
    const myCard = document.querySelector(`[data-user-id="${currentUser.id}"]`);

    if (pressed) {
        shoutBtn.classList.add('active');
        if (myCard) myCard.classList.add('shouting');
        audioEngine.setMuted(false);
        socketManager.startShout(currentServer.id);
    } else {
        shoutBtn.classList.remove('active');
        if (myCard) myCard.classList.remove('shouting');
        audioEngine.setMuted(true);
        socketManager.endShout(currentServer.id);
    }
}

async function loadServers() {
    const result = await api.getServers();
    if (result.data) {
        servers = result.data.servers;
        updateServerListUI();
    }
}

async function loadRooms(serverId) {
    const result = await api.getRooms(serverId);
    if (result.data) {
        rooms = result.data.rooms;
        updateRoomListUI();
    }
}

async function selectServer(server) {
    if (currentRoom) {
        socketManager.leaveRoom();
    }

    // Unsubscribe from previous server
    if (currentServer) {
        socketManager.emit('unsubscribe-server', currentServer.id);
    }

    currentServer = server;

    // Subscribe to new server for real-time updates
    socketManager.emit('subscribe-server', server.id);

    const serverDetails = await api.getServer(server.id);
    if (serverDetails.data) {
        canShout = serverDetails.data.shoutUsers.some(u => u.user_id === currentUser.id);
        updateShoutButton();
    }

    await loadRooms(server.id);
    document.getElementById('room-section').style.display = 'block';
    updateServerListUI();
}

async function joinRoom(room) {
    if (currentRoom?.id === room.id) return;

    currentRoom = room;
    socketManager.joinRoom(room.id);

    document.getElementById('current-room-name').textContent = room.name;
    showRoomView();
    updateRoomListUI();

    // Handle open mic rooms with voice activity detection
    if (room.voice_mode === 'open') {
        startVoiceActivityDetection();
    }
}

// Voice activity detection for open mic rooms
let vadInterval = null;
let isVadSpeaking = false;

function startVoiceActivityDetection() {
    if (vadInterval) return;

    vadInterval = setInterval(() => {
        if (!currentRoom || currentRoom.voice_mode !== 'open') {
            stopVoiceActivityDetection();
            return;
        }

        const level = audioEngine.getMicLevel();
        const threshold = settings.noiseGateThreshold;
        const nowSpeaking = level >= threshold;

        if (nowSpeaking !== isVadSpeaking) {
            isVadSpeaking = nowSpeaking;
            audioEngine.setMuted(!nowSpeaking);
            socketManager.setSpeaking(nowSpeaking);

            // Update UI
            const myCard = document.querySelector(`[data-user-id="${currentUser.id}"]`);
            if (myCard) {
                myCard.classList.toggle('speaking', nowSpeaking);
            }
        }
    }, 50);
}

function stopVoiceActivityDetection() {
    if (vadInterval) {
        clearInterval(vadInterval);
        vadInterval = null;
    }
    isVadSpeaking = false;
    audioEngine.setMuted(true);
}

function leaveCurrentRoom() {
    if (currentRoom) {
        stopVoiceActivityDetection();
        socketManager.leaveRoom();
        currentRoom = null;
        roomMembers = [];
        showNoRoomView();
        updateRoomListUI();
    }
}

function updateServerListUI() {
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = servers.map(s => `
        <div class="server-item ${currentServer?.id === s.id ? 'active' : ''}" data-server-id="${s.id}">
            <div class="server-item-name">${s.name}</div>
            <div class="server-item-code">Code: ${s.invite_code}</div>
        </div>
    `).join('');

    serverList.querySelectorAll('.server-item').forEach(el => {
        el.addEventListener('click', () => {
            const server = servers.find(s => s.id === el.dataset.serverId);
            if (server) selectServer(server);
        });
    });
}

function updateRoomListUI() {
    const roomList = document.getElementById('room-list');
    roomList.innerHTML = rooms.map(r => {
        const icon = r.voice_mode === 'open' ? '🎤' : '🔊';
        const modeLabel = r.voice_mode === 'open' ? 'Open Mic' : 'PTT';
        return `
            <div class="room-item ${currentRoom?.id === r.id ? 'active' : ''}" data-room-id="${r.id}" title="${modeLabel}">
                <div class="room-item-icon">${icon}</div>
                <span>${r.name}</span>
                <span class="room-item-count">${r.member_count || 0}</span>
            </div>
        `;
    }).join('');

    roomList.querySelectorAll('.room-item').forEach(el => {
        el.addEventListener('click', () => {
            const room = rooms.find(r => r.id === el.dataset.roomId);
            if (room) joinRoom(room);
        });
    });
}

function updateRoomMembersUI() {
    const roomMembersEl = document.getElementById('room-members');
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
    const shoutBtn = document.getElementById('shout-btn');
    if (canShout) {
        shoutBtn.classList.remove('disabled');
        shoutBtn.title = 'Broadcast to all squad leaders';
    } else {
        shoutBtn.classList.add('disabled');
        shoutBtn.title = 'Shout permission required';
    }
}

function showRoomView() {
    document.getElementById('no-room-view').classList.add('hidden');
    const roomView = document.getElementById('room-view');
    roomView.classList.remove('hidden');
    roomView.style.display = 'flex';
}

function showNoRoomView() {
    document.getElementById('room-view').classList.add('hidden');
    document.getElementById('no-room-view').classList.remove('hidden');
}

function showError(message) {
    const errorEl = document.getElementById('error-message');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    setTimeout(() => errorEl.classList.remove('show'), 5000);
}

function openModal(id) {
    document.getElementById(id).classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
    // Stop mic level monitoring when closing settings
    if (id === 'settings-modal' && micLevelInterval) {
        clearInterval(micLevelInterval);
        micLevelInterval = null;
    }
}

// Settings management
let capturingKey = null;

function openSettings() {
    // Load current settings into inputs
    document.getElementById('ptt-key-input').value = settings.pttKeyDisplay;
    document.getElementById('shout-key-input').value = settings.shoutKeyDisplay;
    document.getElementById('noise-gate-slider').value = settings.noiseGateThreshold;
    document.getElementById('noise-threshold-value').textContent = settings.noiseGateThreshold;
    document.getElementById('ai-noise-cancel-check').checked = settings.aiNoiseCancel;

    // AI Tuning UI
    const aiSlider = document.getElementById('ai-aggressiveness-slider');
    const aiValue = document.getElementById('ai-aggressiveness-value');
    const aiContainer = document.getElementById('ai-aggressiveness-container');
    const aiCheck = document.getElementById('ai-noise-cancel-check');

    aiSlider.value = settings.aiAggressiveness || 50;
    aiValue.textContent = (settings.aiAggressiveness || 50) + '%';
    aiContainer.style.display = settings.aiNoiseCancel ? 'block' : 'none';

    // Dynamic UI updates
    aiCheck.onchange = (e) => {
        aiContainer.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) {
            // Re-sync slider if needed or just leave as is
        }
    };
    aiSlider.oninput = (e) => {
        aiValue.textContent = e.target.value + '%';
    };

    openModal('settings-modal');

    // Start mic level monitoring
    micLevelInterval = setInterval(() => {
        const level = audioEngine.getMicLevel();
        const levelBar = document.getElementById('mic-level-bar');
        if (levelBar) {
            levelBar.style.width = level + '%';
            // Color based on whether it exceeds threshold
            const threshold = parseInt(document.getElementById('noise-gate-slider').value);
            levelBar.style.background = level >= threshold ? 'var(--success)' : 'var(--danger)';
        }
    }, 50);
}

function startKeyCapture(type) {
    capturingKey = type;
    const inputId = type === 'ptt' ? 'ptt-key-input' : 'shout-key-input';
    document.getElementById(inputId).value = 'Press a key...';
    document.getElementById(inputId).style.borderColor = 'var(--accent)';
}

function handleKeyCapture(e) {
    if (!capturingKey) return;

    e.preventDefault();
    const keyDisplay = e.key.length === 1 ? e.key.toUpperCase() : e.code.replace('Key', '');
    const inputId = capturingKey === 'ptt' ? 'ptt-key-input' : 'shout-key-input';

    document.getElementById(inputId).value = keyDisplay;
    document.getElementById(inputId).style.borderColor = '';

    // Temporarily store until save
    if (capturingKey === 'ptt') {
        settings.pttKey = e.code;
        settings.pttKeyDisplay = keyDisplay;
    } else {
        settings.shoutKey = e.code;
        settings.shoutKeyDisplay = keyDisplay;
    }

    capturingKey = null;
}

function saveSettings() {
    settings.noiseGateThreshold = parseInt(document.getElementById('noise-gate-slider').value);
    settings.aiNoiseCancel = document.getElementById('ai-noise-cancel-check').checked;
    settings.aiAggressiveness = parseInt(document.getElementById('ai-aggressiveness-slider').value);

    localStorage.setItem('exortc_settings', JSON.stringify(settings));

    // Update audio engine
    if (audioEngine.rnnoiseNode) {
        audioEngine.rnnoiseNode.port.postMessage({ type: 'toggle', enabled: settings.aiNoiseCancel });
        audioEngine.rnnoiseNode.port.postMessage({ type: 'setAggressiveness', value: settings.aiAggressiveness });
    }

    closeModal('settings-modal');

    // Update button displays
    updateKeybindDisplay();
}

function updateKeybindDisplay() {
    const pttBtn = document.getElementById('ptt-btn');
    const shoutBtn = document.getElementById('shout-btn');
    if (pttBtn) {
        pttBtn.querySelector('kbd').textContent = settings.pttKeyDisplay;
    }
    if (shoutBtn) {
        shoutBtn.querySelector('kbd').textContent = settings.shoutKeyDisplay;
    }
}

// Keep track of server details for member management
let serverMembers = [];
let shoutUsers = [];

async function showMembers() {
    if (!currentServer) return;

    const result = await api.getServer(currentServer.id);
    if (!result.data) return;

    serverMembers = result.data.members || [];
    shoutUsers = result.data.shoutUsers || [];

    const membersList = document.getElementById('members-list');
    membersList.innerHTML = serverMembers.map(m => {
        const hasShout = shoutUsers.some(s => s.user_id === m.user_id);
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 600;">${m.username[0].toUpperCase()}</div>
                    <div>
                        <div style="font-weight: 500;">${m.username}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">${m.role}${hasShout ? ' • 📢 Shout' : ''}</div>
                    </div>
                </div>
                <button class="btn ${hasShout ? 'btn-secondary' : 'btn-primary'}" 
                    style="font-size: 12px; padding: 6px 12px;"
                    onclick="toggleShout('${m.user_id}', ${hasShout})">
                    ${hasShout ? 'Revoke Shout' : 'Grant Shout'}
                </button>
            </div>
        `;
    }).join('');

    openModal('members-modal');
}

async function toggleShout(userId, hasShout) {
    if (!currentServer) return;

    if (hasShout) {
        await api.revokeShout(currentServer.id, userId);
    } else {
        await api.grantShout(currentServer.id, userId);
    }

    // Refresh the members list
    await showMembers();

    // Also update canShout for current user if it changed
    if (userId === currentUser.id) {
        canShout = !hasShout;
        updateShoutButton();
    }
}

// Event listeners
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const result = await api.login(username, password);
    if (result.error) {
        showError(result.error);
        return;
    }

    currentUser = result.data.user;
    await connectAndShowApp();
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    const result = await api.register(username, email, password);
    if (result.error) {
        showError(result.error);
        return;
    }

    currentUser = result.data.user;
    await connectAndShowApp();
});

document.getElementById('show-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-switch').classList.add('hidden');
    document.getElementById('register-switch').classList.remove('hidden');
});

document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-switch').classList.add('hidden');
    document.getElementById('login-switch').classList.remove('hidden');
});

document.getElementById('change-server-btn').addEventListener('click', (e) => {
    e.preventDefault();
    changeServer();
});

document.getElementById('create-server-btn').addEventListener('click', () => openModal('create-server-modal'));
document.getElementById('join-server-btn').addEventListener('click', () => openModal('join-server-modal'));
document.getElementById('create-room-btn').addEventListener('click', () => {
    if (currentServer) {
        openModal('create-room-modal');
    }
});
document.getElementById('manage-members-btn').addEventListener('click', () => {
    if (currentServer) {
        showMembers();
    }
});
document.getElementById('settings-btn').addEventListener('click', openSettings);

document.getElementById('create-server-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('server-name').value;
    const result = await api.createServer(name);
    if (result.data) {
        closeModal('create-server-modal');
        document.getElementById('server-name').value = '';
        await loadServers();
    }
});

document.getElementById('join-server-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('invite-code').value;
    const result = await api.joinServer(code);
    if (result.error) {
        showError(result.error);
        return;
    }
    closeModal('join-server-modal');
    document.getElementById('invite-code').value = '';
    await loadServers();
});

document.getElementById('server-settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newUrl = document.getElementById('server-url-input').value.trim();
    if (newUrl) {
        localStorage.setItem('exortc_server_url', newUrl);
        location.reload();
    }
});

document.getElementById('create-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentServer) return;
    const name = document.getElementById('room-name').value;
    const isOpenMic = document.getElementById('room-open-mic').checked;
    const voiceMode = isOpenMic ? 'open' : 'ptt';
    const result = await api.createRoom(currentServer.id, name, voiceMode);
    if (result.data) {
        closeModal('create-room-modal');
        document.getElementById('room-name').value = '';
        document.getElementById('room-open-mic').checked = false;
        await loadRooms(currentServer.id);
    } else if (result.error) {
        showError(result.error);
    }
});

document.getElementById('leave-room-btn').addEventListener('click', leaveCurrentRoom);

document.getElementById('logout-btn').addEventListener('click', () => {
    api.logout();
    socketManager.disconnect();
    audioEngine.cleanup();
    currentUser = null;
    currentServer = null;
    currentRoom = null;
    showAuth();
});

document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal(modal.id);
        }
    });
});

// Noise gate slider handler
document.getElementById('noise-gate-slider').addEventListener('input', (e) => {
    document.getElementById('noise-threshold-value').textContent = e.target.value;
});

// Initialize keybind display
updateKeybindDisplay();

// Start app
init();
