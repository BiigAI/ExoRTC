import { Rnnoise } from './rnnoise.js';

class RnnoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.FRAME_SIZE = 480;
        this.inputsBuffer = [];
        this.outputsBuffer = [];
        this.rnnoise = null;
        this.initialized = false;
        this.enabled = true; // Enabled by default

        // Listen for messages from the main thread
        this.port.onmessage = (event) => {
            if (event.data.type === 'toggle') {
                this.enabled = event.data.enabled;
            }
        };

        this.init();
    }

    async init() {
        try {
            // Load the WASM library
            const library = await Rnnoise.load();
            this.rnnoise = library.create();
            this.initialized = true;
            console.log('RNNoise initialized in AudioWorklet');
        } catch (e) {
            console.error('Failed to initialize RNNoise:', e);
        }
    }

    process(inputs, outputs, parameters) {
        // Handle input extraction
        const input = inputs[0];
        const output = outputs[0];

        // Retrieve the first channel (mono processing)
        const inputChannel = input && input.length > 0 ? input[0] : null;
        const outputChannel = output && output.length > 0 ? output[0] : null;

        // If no valid input/output, just keep alive
        if (!inputChannel || !outputChannel) return true;

        // If not processed or disabled, simple pass-through
        if (!this.initialized || !this.enabled) {
            outputChannel.set(inputChannel);
            return true;
        }

        // 1. Enqueue Input
        for (let i = 0; i < inputChannel.length; i++) {
            this.inputsBuffer.push(inputChannel[i]);
        }

        // 2. Process Buffered Frames (480 samples chunks)
        while (this.inputsBuffer.length >= this.FRAME_SIZE) {
            // Extract a frame
            const frame = new Float32Array(this.inputsBuffer.slice(0, this.FRAME_SIZE));
            this.inputsBuffer.splice(0, this.FRAME_SIZE);

            // Process via RNNoise (Assuming library supports direct Float32Array passing)
            // The shiguredo library's create() returns an object with a process() method
            // that takes a Float32Array and returns a Float32Array.
            const processedFrame = this.rnnoise.process(frame);

            // Enqueue Output
            for (let i = 0; i < processedFrame.length; i++) {
                this.outputsBuffer.push(processedFrame[i]);
            }
        }

        // 3. Dequeue Output (128 samples chunks to match Web Audio)
        if (this.outputsBuffer.length >= outputChannel.length) {
            for (let i = 0; i < outputChannel.length; i++) {
                outputChannel[i] = this.outputsBuffer[i];
            }
            this.outputsBuffer.splice(0, outputChannel.length);
        } else {
            // Underrun: output silence (this happens during initial buffering)
            outputChannel.fill(0);
        }

        return true;
    }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);
