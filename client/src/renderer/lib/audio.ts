// WebRTC Audio Engine for P2P voice communication

interface PeerConnection {
    userId: string;
    username: string;
    connection: RTCPeerConnection;
    stream?: MediaStream;
}

class AudioEngine {
    private localStream: MediaStream | null = null;
    private peers: Map<string, PeerConnection> = new Map();
    private isMuted: boolean = true;
    private onSpeakingChange: ((userId: string, speaking: boolean) => void) | null = null;

    private readonly rtcConfig: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    async initialize(): Promise<boolean> {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Mute by default (PTT mode)
            this.setMuted(true);

            console.log('Audio engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to get audio stream:', error);
            return false;
        }
    }

    setMuted(muted: boolean): void {
        this.isMuted = muted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !muted;
            });
        }
    }

    isMicMuted(): boolean {
        return this.isMuted;
    }

    setSpeakingCallback(callback: (userId: string, speaking: boolean) => void): void {
        this.onSpeakingChange = callback;
    }

    async createPeerConnection(userId: string, username: string, initiator: boolean): Promise<RTCPeerConnection> {
        // Close existing connection if any
        this.closePeerConnection(userId);

        const connection = new RTCPeerConnection(this.rtcConfig);

        const peer: PeerConnection = {
            userId,
            username,
            connection
        };
        this.peers.set(userId, peer);

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                connection.addTrack(track, this.localStream!);
            });
        }

        // Handle incoming tracks
        connection.ontrack = (event) => {
            console.log('Received remote track from', username);
            peer.stream = event.streams[0];
            this.playRemoteAudio(userId, event.streams[0]);
        };

        // Handle ICE candidates
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                (window as any).socketManager.sendIceCandidate(userId, event.candidate);
            }
        };

        // Handle connection state
        connection.onconnectionstatechange = () => {
            console.log(`Connection to ${username}: ${connection.connectionState}`);
            if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
                this.closePeerConnection(userId);
            }
        };

        // Create offer if initiator
        if (initiator) {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            (window as any).socketManager.sendOffer(userId, offer);
        }

        return connection;
    }

    async handleOffer(fromUserId: string, fromUsername: string, offer: RTCSessionDescriptionInit): Promise<void> {
        const connection = await this.createPeerConnection(fromUserId, fromUsername, false);
        await connection.setRemoteDescription(offer);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        (window as any).socketManager.sendAnswer(fromUserId, answer);
    }

    async handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit): Promise<void> {
        const peer = this.peers.get(fromUserId);
        if (peer) {
            await peer.connection.setRemoteDescription(answer);
        }
    }

    async handleIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
        const peer = this.peers.get(fromUserId);
        if (peer) {
            try {
                await peer.connection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Failed to add ICE candidate:', error);
            }
        }
    }

    private playRemoteAudio(userId: string, stream: MediaStream): void {
        // Create audio element for this peer
        let audio = document.getElementById(`audio-${userId}`) as HTMLAudioElement;
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${userId}`;
            audio.autoplay = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;
    }

    closePeerConnection(userId: string): void {
        const peer = this.peers.get(userId);
        if (peer) {
            peer.connection.close();
            this.peers.delete(userId);

            // Remove audio element
            const audio = document.getElementById(`audio-${userId}`);
            if (audio) {
                audio.remove();
            }
        }
    }

    closeAllConnections(): void {
        this.peers.forEach((_, userId) => {
            this.closePeerConnection(userId);
        });
    }

    cleanup(): void {
        this.closeAllConnections();
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }

    getPeerCount(): number {
        return this.peers.size;
    }
}

// Export singleton
const audioEngine = new AudioEngine();
(window as any).audioEngine = audioEngine;
