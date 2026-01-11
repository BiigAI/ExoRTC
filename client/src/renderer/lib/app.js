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
    aiAggressiveness: 50,
    soundEffectsEnabled: true,
    masterVolume: 100
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

// Member Volume Settings (per-user volume control, stored in localStorage)
const memberVolumeSettings = {
    settings: {},
    storageKey: 'exortc_member_volumes',

    load() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                this.settings = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load member volume settings');
            this.settings = {};
        }
    },

    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Failed to save member volume settings');
        }
    },

    getSettings(userId) {
        if (!this.settings[userId]) {
            this.settings[userId] = { volume: 100, muted: false };
        }
        return this.settings[userId];
    },

    getVolume(userId) {
        return this.getSettings(userId).volume;
    },

    setVolume(userId, volume) {
        const settings = this.getSettings(userId);
        settings.volume = Math.max(0, Math.min(200, volume));
        this.save();
        this.applyVolume(userId);
    },

    isMuted(userId) {
        return this.getSettings(userId).muted;
    },

    setMuted(userId, muted) {
        const settings = this.getSettings(userId);
        settings.muted = muted;
        this.save();
        this.applyVolume(userId);
    },

    toggleMute(userId) {
        const settings = this.getSettings(userId);
        settings.muted = !settings.muted;
        this.save();
        this.applyVolume(userId);
        return settings.muted;
    },

    getEffectiveVolume(userId) {
        const settings = this.getSettings(userId);
        if (settings.muted) return 0;
        return settings.volume / 100; // Convert to 0-2 range for audio element
    },

    applyVolume(userId) {
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            const baseVolume = this.getEffectiveVolume(userId);
            // Apply ducking if active
            const duckingMultiplier = audioEngine.isDucking ? 0.5 : 1.0;
            const masterMultiplier = settings.masterVolume / 100;
            const deafenMultiplier = isDeafened ? 0 : 1;

            // Server Mute check
            const member = roomMembers.find(m => m.user_id === userId);
            const serverMuteMultiplier = (member && member.isServerMuted) ? 0 : 1;

            audio.volume = Math.min(1, baseVolume * duckingMultiplier * masterMultiplier * deafenMultiplier * serverMuteMultiplier);
            // Note: HTML5 audio maxes at 1.0
        }
    },

    applyAllVolumes() {
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            const userId = audio.id.replace('audio-', '');
            this.applyVolume(userId);
        });
    }
};

// Load member volume settings on startup
memberVolumeSettings.load();

// Audio analysis for noise gate
let audioAnalyser = null;
let audioDataArray = null;
let micLevelInterval = null;

// Sound Effects
const audioCache = {};
function playSound(filename) {
    if (!settings.soundEffectsEnabled) return;
    const path = `./assets/sounds/${filename}`;
    if (!audioCache[filename]) {
        audioCache[filename] = new Audio(path);
    } else {
        audioCache[filename].currentTime = 0;
    }
    audioCache[filename].volume = 0.05; // Global volume for sound effects
    audioCache[filename].play().catch(e => console.warn('Audio play failed:', e));
}

function generateAvatarSVG(username, color, showInitial = true) {
    // Repeat username to fill the circle roughly
    const textRequest = username + " • ";
    const repeated = textRequest.repeat(3); // Adjust based on length? 
    // Simply repeating a few times is usually safe for this effect

    // Unique ID for text path
    const id = 'curve-' + Math.random().toString(36).substr(2, 9);

    return `
    <svg viewBox="0 0 100 100" class="avatar-svg" style="background: ${color}; border-radius: 50%;">
        <defs>
            <path id="${id}" d="M 50, 50 m -35, 0 a 35,35 0 1,1 70,0 a 35,35 0 1,1 -70,0" />
        </defs>
        <text class="avatar-text" font-size="12">
            <textPath href="#${id}" startOffset="0%">
                ${repeated}
            </textPath>
        </text>
        ${showInitial ? `<text x="50" y="58" text-anchor="middle" fill="white" font-size="24" font-weight="bold" style="text-shadow: 0 2px 4px rgba(0,0,0,0.5)">${username[0].toUpperCase()}</text>` : ''}
    </svg>
    `;
}

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

    async updateProfileColor(color) {
        return this.request('PUT', '/auth/profile/color', { color });
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
    currentPing: null,
    pingHistory: [],
    maxPingHistory: 5,

    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    isReconnecting: false,
    reconnectTimer: null,

    connect() {
        if (this.socket && this.socket.connected) return; // Already connected

        // Use configured URL or default
        console.log('Connecting to:', SERVER_URL);

        const token = api.getToken(); // Get stored token

        // IMPORTANT: In a real app, you would valide the token or refresh it
        // For this demo, we assume the token is valid if present

        this.socket = io(SERVER_URL, {
            auth: { token },
            transports: ['websocket', 'polling'], // Allow polling fallback
            reconnection: false // We handle reconnection manually for UI control
        });

        this.socket.on('connect', () => {
            console.log('Connected to server, ID:', this.socket.id);
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            document.getElementById('reconnect-overlay').classList.add('hidden');

            // Re-subscribe to current server if any
            if (currentServer) {
                this.socket.emit('subscribe-server', currentServer.id);
            }

            // Re-join room if we were in one
            if (currentRoom && currentRoom.id) {
                this.joinRoom(currentRoom.id);
            }

            updateConnectionStatus(true);
            document.getElementById('connection-status').classList.remove('disconnected');
            document.getElementById('connection-text').textContent = 'Connected';

            this.setupSocketListeners();
            this.startPingInterval();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected:', reason);
            updateConnectionStatus(false);
            document.getElementById('connection-status').classList.add('disconnected');
            document.getElementById('connection-text').textContent = 'Disconnected';
            this.stopPingInterval();

            // Attempt to reconnect if not manually disconnected
            if (reason !== 'io client disconnect') {
                this.handleDisconnect();
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            // If authentication error, redirect to login
            if (error.message.includes('Authentication') || error.message.includes('token')) {
                // This should ideally be handled by the server sending a specific error code
                // For now, assume if token is invalid, it's an auth issue.
                // This might be too aggressive, consider a more robust auth flow.
                api.setToken(null); // Clear invalid token
                showAuth(); // Go back to auth page
            } else {
                // For other errors (network), triggering reconnect logic via disconnect listener usually
                // But connect_error might fire without connect/disconnect cycle
                if (!this.isReconnecting) {
                    this.handleDisconnect();
                }
            }
        });
    },

    handleDisconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            const overlay = document.getElementById('reconnect-overlay');
            overlay.classList.remove('hidden');
            overlay.querySelector('.reconnect-text').textContent = "Connection Lost";
            overlay.querySelector('.reconnect-attempts').innerHTML = `
                Unable to reconnect.<br>
                <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top:10px;">Reload App</button>
            `;
            overlay.querySelector('.reconnect-spinner').style.display = 'none';
            return;
        }

        this.isReconnecting = true;
        document.getElementById('reconnect-overlay').classList.remove('hidden');

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            document.querySelector('.reconnect-attempts').textContent = `Attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts}`;

            console.log(`Attempting reconnect ${this.reconnectAttempts}...`);
            this.socket.connect(); // Attempt to reconnect
        }, delay);
    },

    setupSocketListeners() {
        // Clear existing listeners to prevent duplicates on reconnect
        this.eventHandlers.forEach((callback, event) => {
            this.socket.off(event, callback);
        });
        this.eventHandlers.clear();

        // Re-add all application-specific handlers
        setupSocketHandlers(); // This function needs to be modified to use socketManager.on
    },

    startPingInterval() {
        this.stopPingInterval(); // Clear any existing interval
        this.socket.on('pong', (timestamp) => {
            const latency = Date.now() - timestamp;
            this.currentPing = latency;

            // Keep last N pings for averaging
            this.pingHistory.push(latency);
            if (this.pingHistory.length > this.maxPingHistory) {
                this.pingHistory.shift();
            }

            // Update UI
            this.updatePingDisplay();
        });

        this.pingInterval = setInterval(() => {
            this.sendPing();
        }, 2000); // Ping every 2 seconds
    },

    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.socket.off('pong'); // Remove pong listener
    },

    sendPing() {
        if (this.socket && this.socket.connected) {
            this.socket.emit('ping', Date.now());
        }
    },

    getAveragePing() {
        if (this.pingHistory.length === 0) return null;
        const sum = this.pingHistory.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.pingHistory.length);
    },

    updatePingDisplay() {
        const pingDisplay = document.getElementById('ping-display');
        if (pingDisplay) {
            const avgPing = this.getAveragePing();
            if (avgPing !== null) {
                pingDisplay.textContent = `Ping: ${avgPing}ms`;

                // Color code based on ping
                if (avgPing < 50) {
                    pingDisplay.style.color = 'var(--success)';
                } else if (avgPing < 100) {
                    pingDisplay.style.color = 'var(--text)';
                } else if (avgPing < 200) {
                    pingDisplay.style.color = '#f59e0b'; // warning yellow
                } else {
                    pingDisplay.style.color = 'var(--danger)';
                }
            } else {
                pingDisplay.textContent = 'Ping: --ms';
                pingDisplay.style.color = 'var(--text-muted)';
            }
        }
    },

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.stopPingInterval();
            this.eventHandlers.clear();
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.isReconnecting = false;
            document.getElementById('reconnect-overlay').classList.add('hidden');
        }
    },

    on(event, callback) {
        if (this.socket) {
            this.socket.on(event, callback);
            this.eventHandlers.set(event, callback); // Store for re-registration
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
// Deafen State
// Deafen State
let isDeafened = false;

function toggleDeafen() {
    isDeafened = !isDeafened;

    // Update UI
    const btn = document.getElementById('deafen-btn');
    if (btn) {
        btn.classList.toggle('active', isDeafened);
        btn.title = isDeafened ? 'Undeafen' : 'Deafen (mute all incoming audio)';
        playSound(isDeafened ? 'leave.ogg' : 'join.ogg');
    }

    // Apply mute to everyone
    memberVolumeSettings.applyAllVolumes();
}

// Global Audio Visualizer Loop
let currentGlow = 0;
function updateAudioVisualizer() {
    // Determine target glow based on speaking activity
    // (Proxy for remote audio levels)
    const speakingCount = document.querySelectorAll('.member-card.speaking').length;
    let targetGlow = speakingCount > 0 ? 0.3 + (Math.min(speakingCount, 5) * 0.1) : 0;

    // Also include local mic if speaking
    if (audioEngine.isSpeaking) {
        targetGlow = Math.max(targetGlow, 0.5);
    }

    // Smooth transition
    currentGlow += (targetGlow - currentGlow) * 0.1;

    const membersContainer = document.querySelector('.room-members');
    if (membersContainer) {
        membersContainer.style.setProperty('--audio-glow', currentGlow.toFixed(3));
    }

    requestAnimationFrame(updateAudioVisualizer);
}
requestAnimationFrame(updateAudioVisualizer);

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

            this.audioContext = new AudioContext({ sampleRate: 48000 });
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

    async createPeerConnection(userId, username, initiator, connectionType = 'room') {
        this.closePeerConnection(userId);

        const connection = new RTCPeerConnection(this.rtcConfig);
        const peer = { userId, username, connection, type: connectionType };
        this.peers.set(userId, peer);

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                const sender = connection.addTrack(track, this.localStream);
                peer.sender = sender; // Store sender for later muting
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

    // Mute/unmute outgoing audio to room connections (used during shout)
    // Uses replaceTrack(null) to stop sending audio without affecting other connections
    setRoomAudioMuted(muted) {
        this.peers.forEach(peer => {
            if (peer.type === 'room' && peer.connection) {
                const senders = peer.connection.getSenders();
                senders.forEach(sender => {
                    if (sender.track?.kind === 'audio' || peer.originalTrack) {
                        if (muted) {
                            // Store original track and replace with null
                            peer.originalTrack = sender.track;
                            sender.replaceTrack(null);
                        } else if (peer.originalTrack) {
                            // Restore original track
                            sender.replaceTrack(peer.originalTrack);
                            peer.originalTrack = null;
                        }
                    }
                });
            }
        });
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
        // Apply stored volume settings (respects mute and custom volume)
        memberVolumeSettings.applyVolume(userId);
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
    },

    // Audio ducking for shout - reduce remote audio volume to 50%
    isDucking: false,

    setDucking(enabled) {
        this.isDucking = enabled;
        // Apply ducking to all remote audio elements, respecting per-user volumes
        memberVolumeSettings.applyAllVolumes();
    }
};

// App State
let currentUser = null;
let currentServer = null;
let currentRoom = null;
let currentUserRole = null; // User's role in current server
let servers = [];
let rooms = [];
let roomMembers = [];
let canShout = false;
let isPttActive = false;
let isShoutActive = false;
let activeShoutCount = 0; // Track active shouts for audio ducking

// Role-based permission helpers (same logic as server)
function canManageMembers(role) {
    return role === 'owner' || role === 'admin';
}

function canCreateChannels(role) {
    return role === 'owner' || role === 'admin' || role === 'pmc_member';
}

function canShoutRole(role) {
    return role === 'owner' || role === 'admin' || role === 'pmc_member' || role === 'squad_leader';
}

function updateRoleBasedUI() {
    // Show/hide manage members button
    const manageBtn = document.getElementById('manage-members-btn');
    if (manageBtn) {
        manageBtn.style.display = canManageMembers(currentUserRole) ? '' : 'none';
    }

    // Show/hide create room button
    const createRoomBtn = document.getElementById('create-room-btn');
    if (createRoomBtn) {
        createRoomBtn.style.display = canCreateChannels(currentUserRole) ? '' : 'none';
    }

    // Update shout based on role
    canShout = canShoutRole(currentUserRole);
    updateShoutButton();
}

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

    socketManager.connect(); // Use the new connect method
    // The rest of the logic moves into socketManager.on('connect')

    setupHotkeyHandlers();
    await loadServers();

    updateUserDisplay();
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');
    document.getElementById('app-page').style.display = 'flex';
    document.getElementById('status-bar').classList.remove('hidden');

    // Start ping measurement is now handled by socketManager.startPingInterval()
}

function updateConnectionStatus(isConnected) {
    const statusEl = document.getElementById('connection-status');
    if (isConnected) {
        statusEl.classList.remove('disconnected');
        statusEl.classList.add('connected');
        statusEl.title = 'Connected';
    } else {
        statusEl.classList.remove('connected');
        statusEl.classList.add('disconnected');
        statusEl.title = 'Disconnected';
    }
}

function setupSocketHandlers() {
    socketManager.on('room-joined', async (data) => {
        roomMembers = data.members; // includes ping and isServerMuted
        updateRoomMembersUI();
        playSound('join.ogg');
        for (const member of data.members) {
            if (member.user_id !== currentUser.id) {
                await audioEngine.createPeerConnection(member.user_id, member.username, true);
                // Enforce server mute immediately
                memberVolumeSettings.applyVolume(member.user_id);
            }
        }
    });

    socketManager.on('user-joined', async (data) => {
        roomMembers.push({
            user_id: data.userId,
            username: data.username,
            ping: data.ping,
            isServerMuted: data.isServerMuted
        });
        updateRoomMembersUI();
        playSound('join.ogg');
    });

    socketManager.on('user-ping', (data) => {
        const member = roomMembers.find(m => m.user_id === data.userId);
        if (member) {
            member.ping = data.ping;
            updateMemberPing(data.userId, data.ping);
        }
    });

    socketManager.on('user-left', (data) => {
        roomMembers = roomMembers.filter(m => m.user_id !== data.userId);
        audioEngine.closePeerConnection(data.userId);
        updateRoomMembersUI();
        playSound('leave.ogg');
    });

    socketManager.on('room-left', () => {
        currentRoom = null;
        roomMembers = [];
        audioEngine.closeAllConnections();
        showNoRoomView();
        playSound('leave.ogg');
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

    // Track active shouts for ducking (using global activeShoutCount)

    socketManager.on('shout-incoming', async (data) => {
        // Play incoming sound for listeners
        playSound('incoming.ogg');

        // Start audio ducking (only if not already ducking)
        if (activeShoutCount === 0) {
            audioEngine.setDucking(true);
        }
        activeShoutCount++;

        await audioEngine.createPeerConnection(data.fromUserId, data.fromUsername, false, 'shout');
    });

    socketManager.on('shout-ended', (data) => {
        audioEngine.closePeerConnection(data.fromUserId);

        // Play end shout sound
        playSound('endcomm.ogg');

        // End audio ducking (only when all shouts have ended)
        activeShoutCount = Math.max(0, activeShoutCount - 1);
        if (activeShoutCount === 0) {
            audioEngine.setDucking(false);
        }
    });

    socketManager.on('shout-targets', async (data) => {
        // Shouter also plays the incoming sound
        playSound('incoming.ogg');

        // Shouter also ducks their channel audio
        if (activeShoutCount === 0) {
            audioEngine.setDucking(true);
        }
        activeShoutCount++;

        for (const target of data.targets) {
            await audioEngine.createPeerConnection(target.userId, target.username, true, 'shout');
        }
    });

    // Moderation Handlers
    socketManager.on('user-muted', (data) => {
        const member = roomMembers.find(m => m.user_id === data.userId);
        if (member) {
            member.isServerMuted = true;
            updateRoomMembersUI();
            memberVolumeSettings.applyVolume(data.userId);
        }
    });

    socketManager.on('user-unmuted', (data) => {
        const member = roomMembers.find(m => m.user_id === data.userId);
        if (member) {
            member.isServerMuted = false;
            updateRoomMembersUI();
            memberVolumeSettings.applyVolume(data.userId);
        }
    });

    socketManager.on('you-are-muted', () => {
        // Mute local microphone
        if (audioEngine.localStream) {
            audioEngine.localStream.getAudioTracks().forEach(track => track.enabled = false);
        }
        audioEngine.isMuted = true; // Force local mute state
        updateMuteButton();
        alert('You have been muted by a server administrator.');
    });

    socketManager.on('you-are-unmuted', () => {
        // Unmute local microphone (optional, maybe leave it to user to unmute?)
        // Let's just notify
        alert('You have been unmuted by a server administrator.');
    });

    socketManager.on('you-are-kicked', (data) => {
        // Immediately leave the room to stop audio and update UI
        leaveCurrentRoom();

        // Show notification after a brief delay to ensure UI has updated
        setTimeout(() => {
            alert(`You have been kicked from the server.\nReason: ${data.reason || 'None'}\nDuration: ${data.duration} minutes`);
        }, 100);
    });

    socketManager.on('error', (data) => {
        showError(data.message || 'An error occurred');
    });

    // Listen for room updates (new rooms, member count changes)
    socketManager.on('rooms-updated', async () => {
        if (currentServer) {
            await loadRooms(currentServer.id);
        }
    });

    // Handle room deletion - kick user if in deleted room
    socketManager.on('room-deleted', (data) => {
        if (currentRoom && currentRoom.id === data.roomId) {
            currentRoom = null;
            roomMembers = [];
            audioEngine.closeAllConnections();
            showNoRoomView();
            playSound('leave.ogg');
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
        // Mute audio to room peers so they don't hear the shout
        audioEngine.setRoomAudioMuted(true);
        audioEngine.setMuted(false);
        socketManager.startShout(currentServer.id);
    } else {
        shoutBtn.classList.remove('active');
        if (myCard) myCard.classList.remove('shouting');
        audioEngine.setMuted(true);
        // Unmute audio to room peers
        audioEngine.setRoomAudioMuted(false);
        socketManager.endShout(currentServer.id);

        // Play end shout sound
        playSound('endcomm.ogg');

        // End shouter's own ducking
        activeShoutCount = Math.max(0, activeShoutCount - 1);
        if (activeShoutCount === 0) {
            audioEngine.setDucking(false);
        }
    }
}

async function loadServers() {
    const result = await api.getServers();
    if (result.data) {
        servers = result.data.servers;

        // Check if we are currently viewing a server we've been kicked from
        if (currentServer) {
            const serverData = servers.find(s => s.id === currentServer.id);
            if (serverData && serverData.kick_expires_at) {
                const expires = new Date(serverData.kick_expires_at);
                if (expires > new Date()) {
                    // We are currently in a kicked server, boot us out
                    leaveCurrentRoom(); // Leave voice channel
                    currentServer = null;
                    document.getElementById('room-list').innerHTML = ''; // Clear channels
                    document.querySelector('.sidebar-header h2').textContent = 'Select Server'; // Reset header

                    // Show global error explainer
                    const remainingMinutes = Math.ceil((expires - new Date()) / 60000);
                    showError(`You have been kicked from this server. Access restored in ${remainingMinutes} minutes.`);
                }
            }
        }

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
        // Get user's role in this server
        const member = serverDetails.data.members.find(m => m.user_id === currentUser.id);
        currentUserRole = member?.role || 'member';
        updateRoleBasedUI();
    }

    await loadRooms(server.id);
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
        audioEngine.closeAllConnections();
        showNoRoomView();
        updateRoomListUI();
    }
}

function updateServerListUI() {
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = servers.map(s => {
        let statusHtml = '';
        let isKicked = false;

        if (s.kick_expires_at) {
            const expires = new Date(s.kick_expires_at);
            if (expires > new Date()) {
                isKicked = true;
                const remainingMinutes = Math.ceil((expires - new Date()) / 60000);
                statusHtml = `<div style="font-size: 10px; color: var(--danger);">Kicked: ${remainingMinutes}m left</div>`;
            }
        }

        return `
        <div class="server-item ${currentServer?.id === s.id ? 'active' : ''} ${isKicked ? 'kicked' : ''}" 
             data-server-id="${s.id}" 
             data-kicked="${isKicked}"
             style="${isKicked ? 'opacity: 0.7; cursor: not-allowed;' : ''}">
            <div style="flex: 1; min-width: 0;">
                <div class="server-item-name" style="${isKicked ? 'color: var(--danger);' : ''}">${s.name}</div>
                ${isKicked ? statusHtml : `<div class="server-item-code">Code: ${s.invite_code}</div>`}
            </div>
            ${!isKicked ? `
            <button class="copy-code-btn" data-code="${s.invite_code}" title="Copy invite code" onclick="event.stopPropagation(); copyServerCode('${s.invite_code}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>` : ''}
        </div>
    `}).join('');

    serverList.querySelectorAll('.server-item').forEach(el => {
        el.addEventListener('click', () => {
            if (el.dataset.kicked === 'true') {
                // Optional: Show a toast or shake animation
                return;
            }
            const server = servers.find(s => s.id === el.dataset.serverId);
            if (server) selectServer(server);
        });
    });
}

function copyServerCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        // Find the code element for this server and show feedback
        const serverItems = document.querySelectorAll('.server-item');
        serverItems.forEach(item => {
            const codeEl = item.querySelector('.server-item-code');
            if (codeEl && codeEl.textContent.includes(code)) {
                const originalText = codeEl.textContent;
                codeEl.style.transition = 'opacity 0.2s';
                codeEl.style.opacity = '0';
                setTimeout(() => {
                    codeEl.textContent = 'Copied!';
                    codeEl.style.color = 'white';
                    codeEl.style.opacity = '1';
                }, 200);
                setTimeout(() => {
                    codeEl.style.opacity = '0';
                }, 1200);
                setTimeout(() => {
                    codeEl.textContent = originalText;
                    codeEl.style.color = '';
                    codeEl.style.opacity = '1';
                }, 1400);
            }
        });
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

window.copyServerCode = copyServerCode;

function updateRoomListUI() {
    const roomList = document.getElementById('room-list');
    roomList.innerHTML = rooms.map(r => {
        const modeLabel = r.voice_mode === 'open' ? 'Open Mic' : 'PTT';
        return `
            <div class="room-item ${currentRoom?.id === r.id ? 'active' : ''}" data-room-id="${r.id}" title="${modeLabel}">
                <div class="room-item-icon"></div>
                <span>${r.name}</span>
                <span class="room-item-count">${r.member_count || 0}</span>
            </div>
        `;
    }).join('');

    const tooltip = document.getElementById('room-tooltip');
    const tooltipTitle = tooltip.querySelector('.room-tooltip-title');
    const tooltipMembers = tooltip.querySelector('.room-tooltip-members');

    roomList.querySelectorAll('.room-item').forEach(el => {
        const roomId = el.dataset.roomId;
        const room = rooms.find(r => r.id === roomId);

        // Click to join
        el.addEventListener('click', () => {
            if (room) joinRoom(room);
        });

        // Hover to show members
        el.addEventListener('mouseenter', (e) => {
            if (!room) return;

            tooltipTitle.textContent = `Members in ${room.name}`;

            if (room.members && room.members.length > 0) {
                tooltipMembers.innerHTML = room.members.map(member => `
                    <div class="room-tooltip-member">
                        <div class="room-tooltip-member-avatar" style="background: ${member.profile_color || 'var(--accent)'}"></div>
                        <span>${member.username}</span>
                    </div>
                `).join('');
            } else {
                tooltipMembers.innerHTML = '<div class="room-tooltip-empty">No members connected</div>';
            }

            // Position tooltip
            const rect = el.getBoundingClientRect();
            tooltip.style.left = `${rect.right + 12}px`;
            tooltip.style.top = `${rect.top}px`;
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });

        // Right-click for context menu (only if user can create/delete channels)
        if (canCreateChannels(currentUserRole)) {
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showRoomContextMenu(e.clientX, e.clientY, roomId);
            });
        }
    });
}

// Context menu state
let contextMenuRoomId = null;

function showRoomContextMenu(x, y, roomId) {
    const menu = document.getElementById('room-context-menu');
    contextMenuRoomId = roomId;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
}

function hideRoomContextMenu() {
    const menu = document.getElementById('room-context-menu');
    menu.classList.add('hidden');
    contextMenuRoomId = null;
}

async function deleteSelectedRoom() {
    if (!contextMenuRoomId || !currentServer) {
        hideRoomContextMenu();
        return;
    }

    const room = rooms.find(r => r.id === contextMenuRoomId);
    if (!room) {
        hideRoomContextMenu();
        return;
    }

    if (!confirm(`Delete channel "${room.name}"? Users in this channel will be disconnected.`)) {
        hideRoomContextMenu();
        return;
    }

    const result = await api.request('DELETE', `/rooms/${contextMenuRoomId}`);
    hideRoomContextMenu();

    if (result.error) {
        console.error('Failed to delete room:', result.error);
    }
}

// Make deleteSelectedRoom available globally for onclick
window.deleteSelectedRoom = deleteSelectedRoom;

// Hide context menu on click elsewhere
document.addEventListener('click', hideRoomContextMenu);

// Member context menu state handled below (duplicate removed)

function updateMemberMuteButton(isMuted) {
    const muteBtn = document.getElementById('member-mute-toggle');
    const muteText = muteBtn.querySelector('span');
    const muteIcon = muteBtn.querySelector('svg');

    if (isMuted) {
        muteText.textContent = 'Unmute';
        muteBtn.classList.add('muted');
        muteIcon.innerHTML = `
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
        `;
    } else {
        muteText.textContent = 'Mute';
        muteBtn.classList.remove('muted');
        muteIcon.innerHTML = `
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
        `;
    }
}

function handleMemberVolumeChange(e) {
    if (!contextMenuMemberId) return;
    const volume = parseInt(e.target.value, 10);
    const slider = e.target;
    const percentage = (volume / 200) * 100;

    document.getElementById('member-volume-value').textContent = `${volume}%`;
    slider.style.background = `linear-gradient(to right, var(--accent) ${percentage}%, #333 ${percentage}%)`;
    memberVolumeSettings.setVolume(contextMenuMemberId, volume);
}

function handleMemberMuteToggle() {
    if (!contextMenuMemberId) return;
    const isMuted = memberVolumeSettings.toggleMute(contextMenuMemberId);
    updateMemberMuteButton(isMuted);
    updateRoomMembersUI(); // Refresh to show/hide muted icon
}

// Make member context menu functions available globally
window.handleMemberVolumeChange = handleMemberVolumeChange;
window.handleMemberMuteToggle = handleMemberMuteToggle;

// Hide member context menu on click elsewhere (but not on the menu itself)
document.addEventListener('click', (e) => {
    const menu = document.getElementById('member-context-menu');
    if (menu && !menu.contains(e.target)) {
        hideMemberContextMenu();
    }
});

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

    // Update Name and Mute Button
    const nameEl = document.getElementById('member-context-name');
    if (nameEl) nameEl.textContent = username;

    const isMuted = memberVolumeSettings.isMuted(userId);
    if (typeof updateMemberMuteButton === 'function') {
        updateMemberMuteButton(isMuted);
    }

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
                openKickModal(userId, member.username);
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

function updateRoomMembersUI() {
    const roomMembersEl = document.getElementById('room-members');
    const allMembers = [{ user_id: currentUser.id, username: currentUser.username }, ...roomMembers];

    roomMembersEl.innerHTML = allMembers.map(m => {
        const color = m.user_id === currentUser.id ? (currentUser.profile_color || 'var(--accent)') : (m.profile_color || 'var(--accent)');
        const avatarSvg = generateAvatarSVG(m.username, color);

        const isLocalMuted = m.user_id !== currentUser.id && memberVolumeSettings.isMuted(m.user_id);
        const isServerMuted = m.isServerMuted;

        const isMuted = isLocalMuted || isServerMuted;
        const mutedClass = isMuted ? ' muted' : '';

        // Use different color/icon for server mute if desired, for now just red
        const muteFill = isServerMuted ? '#ef4444' : 'rgba(239, 68, 68, 0.9)';

        const mutedIcon = isMuted ? `
            <div class="member-muted-icon" title="${isServerMuted ? 'Server Muted' : 'Muted'}" style="background: ${muteFill}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
            </div>
        ` : '';

        // Ping display
        let pingDisplay = '-- ms';
        let pingValue = 0;

        if (m.user_id === currentUser.id) {
            pingValue = socketManager.currentPing || 0;
        } else {
            pingValue = m.ping || 0;
        }

        // Don't show ping if 0 or undefined
        if (pingValue) {
            pingDisplay = `${Math.round(pingValue)} ms`;
        }

        const pingClass = getPingClass(pingValue);

        return `
        <div class="member-card${mutedClass}" data-user-id="${m.user_id}">
            <div class="member-avatar" style="background: none; overflow: hidden; padding: 0;">${avatarSvg}</div>
            ${mutedIcon}
            <div class="member-name">${m.username}${m.user_id === currentUser.id ? ' (You)' : ''}</div>
            <div class="member-status ${pingClass}">${pingDisplay}</div>
        </div>
        `;
    }).join('');

    // Add right-click handlers to other users' cards for volume control
    roomMembersEl.querySelectorAll('.member-card').forEach(card => {
        const userId = card.dataset.userId;
        if (userId !== currentUser.id.toString()) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const member = allMembers.find(m => m.user_id.toString() === userId);
                if (member) {
                    showMemberContextMenu(e.clientX, e.clientY, userId, member.username);
                }
            });
        }
    });
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
window.closeModal = closeModal;

// Settings management
let capturingKey = null;

function openSettings() {
    // Load current settings into inputs
    document.getElementById('ptt-key-input').textContent = settings.pttKeyDisplay;
    document.getElementById('shout-key-input').textContent = settings.shoutKeyDisplay;
    document.getElementById('noise-gate-slider').value = settings.noiseGateThreshold;
    document.getElementById('noise-threshold-value').textContent = settings.noiseGateThreshold;
    document.getElementById('ai-noise-cancel-check').checked = settings.aiNoiseCancel;
    document.getElementById('sound-effects-check').checked = settings.soundEffectsEnabled;

    // Master Volume
    const masterSlider = document.getElementById('master-volume-slider');
    masterSlider.value = settings.masterVolume;
    document.getElementById('master-volume-value').textContent = `${settings.masterVolume}%`;
    const percentage = (settings.masterVolume / 200) * 100;
    masterSlider.style.background = `linear-gradient(to right, var(--accent) ${percentage}%, #333 ${percentage}%)`;

    // AI Tuning UI
    const aiSlider = document.getElementById('ai-aggressiveness-slider');
    const aiValue = document.getElementById('ai-aggressiveness-value');
    const aiContainer = document.getElementById('ai-aggressiveness-container');
    const aiCheck = document.getElementById('ai-noise-cancel-check');

    aiSlider.value = settings.aiAggressiveness || 50;
    aiValue.textContent = (settings.aiAggressiveness || 50) + '%';
    aiContainer.style.display = settings.aiNoiseCancel ? 'block' : 'none';

    // Profile Color
    document.getElementById('profile-color-input').value = currentUser.profile_color || '#CC2244';

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
    document.getElementById(inputId).textContent = 'Press a key...';
    document.getElementById(inputId).style.borderColor = 'var(--accent)';
}

function handleKeyCapture(e) {
    if (!capturingKey) return;

    e.preventDefault();
    const keyDisplay = e.key.length === 1 ? e.key.toUpperCase() : e.code.replace('Key', '');
    const inputId = capturingKey === 'ptt' ? 'ptt-key-input' : 'shout-key-input';

    document.getElementById(inputId).textContent = keyDisplay;
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
    settings.soundEffectsEnabled = document.getElementById('sound-effects-check').checked;
    settings.masterVolume = parseInt(document.getElementById('master-volume-slider').value);

    // Save settings
    localStorage.setItem('exortc_settings', JSON.stringify(settings));

    // Apply settings
    memberVolumeSettings.applyAllVolumes(); // Apply new master volume

    // Update audio engine
    if (audioEngine.rnnoiseNode) {
        audioEngine.rnnoiseNode.port.postMessage({ type: 'toggle', enabled: settings.aiNoiseCancel });
        audioEngine.rnnoiseNode.port.postMessage({ type: 'setAggressiveness', value: settings.aiAggressiveness });
    }

    // Save profile color
    const newColor = document.getElementById('profile-color-input').value;
    if (newColor !== currentUser.profile_color) {
        api.updateProfileColor(newColor).then(result => {
            if (!result.error) {
                currentUser.profile_color = result.data.user.profile_color;
                updateUserDisplay();
            }
        });
    }

    closeModal('settings-modal');

    // Update button displays
    updateKeybindDisplay();
}

function updateUserDisplay() {
    const userNameElement = document.getElementById('user-name');
    const userAvatarElement = document.getElementById('user-avatar');
    if (userNameElement && userAvatarElement && currentUser) {
        userNameElement.textContent = currentUser.username;
        userAvatarElement.textContent = currentUser.username[0].toUpperCase();
        userAvatarElement.style.background = currentUser.profile_color || 'var(--accent)';
    }

    // Show/hide create server button based on admin status
    const createServerBtn = document.getElementById('create-server-btn');
    console.log('DEBUG: currentUser =', currentUser);
    console.log('DEBUG: is_app_admin =', currentUser?.is_app_admin);
    if (createServerBtn) {
        createServerBtn.style.display = currentUser?.is_app_admin ? '' : 'none';
    }
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
        const isOwner = m.role === 'owner';
        const isSelf = m.user_id === currentUser.id;
        const canEdit = canManageMembers(currentUserRole) && !isOwner && !isSelf;

        return `
            <div class="setting-row" style="cursor: default; padding: 10px 16px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: ${m.profile_color || 'var(--accent)'}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;">${m.username[0].toUpperCase()}</div>
                    <div>
                        <div style="font-weight: 600; font-size: 14px;">${m.username}</div>
                        <div style="font-size: 11px; color: var(--text-muted); font-weight: 500;">
                            ${m.role.toUpperCase().replace('_', ' ')}
                        </div>
                    </div>
                </div>
                ${canEdit ? `
                    <select onchange="changeRole('${m.user_id}', this.value)" 
                        style="background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                        <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                        <option value="pmc_member" ${m.role === 'pmc_member' ? 'selected' : ''}>PMC Member</option>
                        <option value="squad_leader" ${m.role === 'squad_leader' ? 'selected' : ''}>Squad Leader</option>
                        <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
                    </select>
                ` : ''}
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

async function changeRole(userId, newRole) {
    if (!currentServer) return;

    console.log('DEBUG: changeRole called with', { userId, newRole, serverId: currentServer.id });

    const result = await api.request('POST', `/servers/${currentServer.id}/role`, {
        user_id: userId,
        role: newRole
    });

    console.log('DEBUG: changeRole result', result);

    if (result.error) {
        console.error('Failed to change role:', result.error);
        return;
    }

    // Refresh the members list
    await showMembers();
}

// Make changeRole available globally for inline onclick
window.changeRole = changeRole;

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

// Kick Modal Logic
function openKickModal(userId, username) {
    document.getElementById('kick-user-id').value = userId;
    document.getElementById('kick-user-name').value = username;
    document.getElementById('kick-duration').value = 15;
    document.getElementById('kick-reason').value = '';
    openModal('kick-modal');
}
window.openKickModal = openKickModal;

document.getElementById('kick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentServer) return;

    const userId = document.getElementById('kick-user-id').value;
    const duration = parseInt(document.getElementById('kick-duration').value, 10);
    const reason = document.getElementById('kick-reason').value;

    if (userId && duration) {
        socketManager.emit('kick-user', {
            serverId: currentServer.id,
            userId,
            duration,
            reason: reason || undefined
        });
        closeModal('kick-modal');
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
// Helper for range slider backgrounds
function updateRangeBackground(input) {
    const value = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${value}%, #333 ${value}%, #333 100%)`;
}

// Logic for settings modal interactions
function toggleAiCardStyle() {
    const check = document.getElementById('ai-noise-cancel-check');
    const card = document.getElementById('ai-feature-card');
    const container = document.getElementById('ai-aggressiveness-container');

    if (check.checked) {
        card.classList.add('active');
        container.style.display = 'block';
    } else {
        card.classList.remove('active');
        container.style.display = 'none';
    }
}

// Ping Helpers
function getPingClass(ping) {
    if (!ping) return '';
    if (ping < 80) return 'ping-green';
    if (ping < 150) return 'ping-yellow';
    return 'ping-red';
}

function updateMemberPing(userId, ping) {
    const card = document.querySelector(`.member-card[data-user-id="${userId}"]`);
    if (card) {
        const statusEl = card.querySelector('.member-status');
        if (statusEl) {
            statusEl.textContent = `${Math.round(ping)} ms`;
            statusEl.className = `member-status ${getPingClass(ping)}`;
        }
    }
}

// Update current user ping UI
socketManager.updatePingDisplay = function () {
    // Also update current user card in room
    if (currentUser) {
        updateMemberPing(currentUser.id, this.currentPing);
    }

    // Update status bar
    const pingEl = document.getElementById('ping-display');
    if (pingEl) {
        pingEl.textContent = `Ping: ${Math.round(this.currentPing)}ms`;
    }
};

// Update listeners when modal opens (or globally)
document.addEventListener('DOMContentLoaded', () => {
    const sliders = document.querySelectorAll('.custom-range');
    sliders.forEach(slider => {
        slider.addEventListener('input', () => updateRangeBackground(slider));
    });

    const aiCheck = document.getElementById('ai-noise-cancel-check');
    if (aiCheck) {
        aiCheck.addEventListener('change', toggleAiCardStyle);
    }

    const deafenBtn = document.getElementById('deafen-btn');
    if (deafenBtn) {
        deafenBtn.addEventListener('click', toggleDeafen);
    }

    // Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('main-sidebar');

    if (mobileMenuBtn && sidebar) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            // Create or toggle overlay
            let overlay = document.getElementById('sidebar-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'sidebar-overlay';
                overlay.style.cssText = `
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5); z-index: 90;
                    opacity: 0; transition: opacity 0.3s; pointer-events: none;
                `;
                document.body.appendChild(overlay);
                overlay.addEventListener('click', () => {
                    sidebar.classList.remove('open');
                    overlay.style.opacity = '0';
                    overlay.style.pointerEvents = 'none';
                });
            }

            if (sidebar.classList.contains('open')) {
                overlay.style.opacity = '1';
                overlay.style.pointerEvents = 'auto';
            } else {
                overlay.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
            }
        });
    }
});
