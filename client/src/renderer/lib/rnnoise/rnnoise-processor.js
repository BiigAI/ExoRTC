import { Rnnoise } from './rnnoise.js';

class RnnoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.FRAME_SIZE = 480;
        this.inputsBuffer = [];
        this.outputsBuffer = [];
        this.rnnoise = null;
        this.initialized = false;
        this.enabled = true;
        this.aggressiveness = 50; // 0-100

        // HPF State (120Hz cutoff)
        this.hpfAlpha = 0.98;
        this.hpfLastIn = 0;
        this.hpfLastOut = 0;

        // Expander State
        this.expanderGain = 1.0;

        this.port.onmessage = (event) => {
            if (event.data.type === 'toggle') {
                this.enabled = event.data.enabled;
            } else if (event.data.type === 'setAggressiveness') {
                this.aggressiveness = event.data.value;
            }
        };

        this.init();
    }

    async init() {
        try {
            const library = await Rnnoise.load();
            this.rnnoise = library.createDenoiseState();
            this.initialized = true;
        } catch (e) {
            console.error('Failed to initialize RNNoise:', e);
        }
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        const inputChannel = input && input.length > 0 ? input[0] : null;
        const outputChannel = output && output.length > 0 ? output[0] : null;

        if (!inputChannel || !outputChannel) return true;

        if (!this.initialized || !this.enabled) {
            outputChannel.set(inputChannel);
            // Reset filters to avoid clicks on re-enable
            this.hpfLastIn = 0;
            this.hpfLastOut = 0;
            this.expanderGain = 1.0;
            return true;
        }

        // 1. Enqueue Input with High Pass Filter
        for (let i = 0; i < inputChannel.length; i++) {
            const sample = inputChannel[i];

            // Simple 1-pole HPF to remove low rumble (<100Hz)
            const filtered = this.hpfAlpha * (this.hpfLastOut + sample - this.hpfLastIn);
            this.hpfLastOut = filtered;
            this.hpfLastIn = sample;

            this.inputsBuffer.push(filtered);
        }

        // 2. Process Buffered Frames
        while (this.inputsBuffer.length >= this.FRAME_SIZE) {
            const frame = new Float32Array(this.inputsBuffer.slice(0, this.FRAME_SIZE));
            this.inputsBuffer.splice(0, this.FRAME_SIZE);

            // Run AI Denoise
            this.rnnoise.processFrame(frame);
            const processedFrame = frame;

            // Post-Processing Expander (Noise Suppression)
            // Calculate RMS of the denoised frame
            let sum = 0;
            for (let i = 0; i < processedFrame.length; i++) {
                sum += processedFrame[i] * processedFrame[i];
            }
            const rms = Math.sqrt(sum / processedFrame.length);
            const db = 20 * Math.log10(rms + 1e-6); // Avoid -infinity

            // Dynamic Threshold based on Aggressiveness
            // Ag=0 -> -60dB (Allow lots)
            // Ag=50 -> -45dB
            // Ag=100 -> -30dB (Strict)
            const threshold = -60 + (this.aggressiveness / 100) * 30;

            let targetGain = 1.0;
            if (db < threshold) {
                // Apply expansion: Attenuate signals below threshold relative to how far they are
                const ratio = 2.0 + (this.aggressiveness / 50); // Ratio 2.0 - 4.0
                const attenuationDB = (db - threshold) * (ratio - 1);
                targetGain = Math.pow(10, attenuationDB / 20);
                if (targetGain < 0.001) targetGain = 0; // Cutoff
            }

            // Apply gain with smoothing to avoid clicks (Attack/Release)
            const attack = 0.5; // Fast attack
            const release = 0.05; // Slow release

            for (let i = 0; i < processedFrame.length; i++) {
                // Smooth gain
                const coeff = targetGain < this.expanderGain ? attack : release;
                this.expanderGain += coeff * (targetGain - this.expanderGain);

                // Apply gain
                this.outputsBuffer.push(processedFrame[i] * this.expanderGain);
            }
        }

        // 3. Dequeue Output
        if (this.outputsBuffer.length >= outputChannel.length) {
            for (let i = 0; i < outputChannel.length; i++) {
                outputChannel[i] = this.outputsBuffer[i];
            }
            this.outputsBuffer.splice(0, outputChannel.length);
        } else {
            outputChannel.fill(0);
        }

        return true;
    }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);
