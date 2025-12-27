// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    WS_URL: `ws://${window.location.host}/ws`,
    AUDIO_THROTTLE_MS: 100,
    INPUT_SAMPLE_RATE: 16000,
    OUTPUT_SAMPLE_RATE: 24000,
    AUDIO_BUFFER_SIZE: 4096,
    BASE64_CHUNK_SIZE: 8192,
};

const LANGUAGE_CODE_MAP = {
    'Arabic': 'ar-SA',
    'Armenian': 'hy-AM',
    'Bengali': 'bn-BD',
    'Bulgarian': 'bg-BG',
    'Catalan': 'ca-ES',
    'Chinese': 'zh-CN',
    'Croatian': 'hr-HR',
    'Czech': 'cs-CZ',
    'Danish': 'da-DK',
    'Dutch': 'nl-NL',
    'English': 'en-US',
    'Finnish': 'fi-FI',
    'French': 'fr-FR',
    'German': 'de-DE',
    'Greek': 'el-GR',
    'Hebrew': 'he-IL',
    'Hindi': 'hi-IN',
    'Hungarian': 'hu-HU',
    'Indonesian': 'id-ID',
    'Italian': 'it-IT',
    'Japanese': 'ja-JP',
    'Korean': 'ko-KR',
    'Malay': 'ms-MY',
    'Marathi': 'mr-IN',
    'Norwegian': 'nb-NO',
    'Persian': 'fa-IR',
    'Polish': 'pl-PL',
    'Portuguese': 'pt-PT',
    'Romanian': 'ro-RO',
    'Russian': 'ru-RU',
    'Serbian': 'sr-RS',
    'Slovak': 'sk-SK',
    'Slovenian': 'sl-SI',
    'Spanish': 'es-ES',
    'Swahili': 'sw-KE',
    'Swedish': 'sv-SE',
    'Tagalog': 'tl-PH',
    'Tamil': 'ta-IN',
    'Thai': 'th-TH',
    'Turkish': 'tr-TR',
    'Ukrainian': 'uk-UA',
    'Urdu': 'ur-PK',
    'Vietnamese': 'vi-VN'
};

// Get sorted list of languages
const LANGUAGES = Object.keys(LANGUAGE_CODE_MAP).sort();

// Supported voices with descriptions
const VOICES = [
    { value: 'alloy', label: 'Alloy - Default, neutral' },
    { value: 'ash', label: 'Ash' },
    { value: 'ballad', label: 'Ballad' },
    { value: 'coral', label: 'Coral' },
    { value: 'echo', label: 'Echo' },
    { value: 'sage', label: 'Sage' },
    { value: 'shimmer', label: 'Shimmer' },
    { value: 'verse', label: 'Verse' },
    { value: 'marin', label: 'Marin' },
    { value: 'cedar', label: 'Cedar' }
];

// ============================================================================
// Dropdown Population Functions
// ============================================================================

function populateLanguageDropdown(selectElement, defaultLanguage = null) {
    if (!selectElement) return;
    
    // Clear existing options
    selectElement.innerHTML = '';
    
    // Add all languages
    LANGUAGES.forEach(language => {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = language;
        if (defaultLanguage && language === defaultLanguage) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

function populateVoiceDropdown(selectElement, defaultVoice = 'alloy') {
    if (!selectElement) return;
    
    // Clear existing options
    selectElement.innerHTML = '';
    
    // Add all voices
    VOICES.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.value;
        option.textContent = voice.label;
        if (voice.value === defaultVoice) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

// ============================================================================
// State Management
// ============================================================================

const state = {
    ws: null,
    audioStream: null,
    isConnected: false,
    audioContext: null,
    audioQueue: [],
    isPlayingAudio: false,
    currentAudioSource: null,
    audioProcessor: null,
    frameCaptureInterval: null,
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    error: document.getElementById('error'),
    conversation: document.getElementById('conversation'),
    sourceLanguage: document.getElementById('sourceLanguage'),
    targetLanguage: document.getElementById('targetLanguage'),
    voiceSelect: document.getElementById('voiceSelect'),
};

// ============================================================================
// Utilities
// ============================================================================

const utils = {
    showError(message) {
        elements.error.textContent = message;
        elements.error.classList.remove('hidden');
    },

    hideError() {
        elements.error.classList.add('hidden');
    },

    addMessage(text, type = 'assistant') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = text;
        elements.conversation.appendChild(messageDiv);
        elements.conversation.scrollTop = elements.conversation.scrollHeight;
    },

    updateStatus(text, className) {
        elements.statusText.textContent = text;
        elements.status.className = `status ${className}`;
        const indicator = elements.status.querySelector('.connection-indicator');
        if (indicator) {
            indicator.className = `connection-indicator ${className}`;
        }
    },

    getMicrophoneError(error) {
        const messages = {
            'NotAllowedError': 'Permission was denied. Please allow microphone access in your browser settings and refresh the page.',
            'PermissionDeniedError': 'Permission was denied. Please allow microphone access in your browser settings and refresh the page.',
            'NotFoundError': 'No microphone found. Please connect a device.',
            'DevicesNotFoundError': 'No microphone found. Please connect a device.',
            'NotReadableError': 'Microphone is being used by another application.',
            'TrackStartError': 'Microphone is being used by another application.',
        };
        return 'Failed to access microphone. ' + (messages[error.name] || 'Please ensure you have granted permissions.');
    },

    toggleControls(disabled) {
        elements.connectBtn.disabled = disabled;
        elements.disconnectBtn.disabled = !disabled;
        if (elements.sourceLanguage) elements.sourceLanguage.disabled = disabled;
        if (elements.targetLanguage) elements.targetLanguage.disabled = disabled;
        if (elements.voiceSelect) elements.voiceSelect.disabled = disabled;
    },

    resetDropdowns() {
        if (elements.sourceLanguage) {
            elements.sourceLanguage.value = 'English';
        }
        if (elements.targetLanguage) {
            elements.targetLanguage.value = 'Spanish';
        }
        if (elements.voiceSelect) {
            elements.voiceSelect.value = 'alloy';
        }
    },
};

// ============================================================================
// Audio Capture
// ============================================================================

const audioCapture = {
    async startMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: CONFIG.INPUT_SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });

            state.audioStream = stream;
            this.startAudioProcessing(stream);
            utils.hideError();
            return true;
        } catch (error) {
            utils.showError(utils.getMicrophoneError(error));
            return false;
        }
    },

    startAudioProcessing(stream) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: CONFIG.INPUT_SAMPLE_RATE,
            });

            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(
                CONFIG.AUDIO_BUFFER_SIZE, 1, 1
            );

            let lastAudioSendTime = 0;

            processor.onaudioprocess = (e) => {
                if (!state.isConnected || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const now = Date.now();
                if (now - lastAudioSendTime < CONFIG.AUDIO_THROTTLE_MS) {
                    return;
                }

                const inputData = e.inputBuffer.getChannelData(0);
                const base64Audio = this.convertToBase64(inputData);

                if (!this.validateBase64(base64Audio)) {
                    return;
                }

                try {
                    lastAudioSendTime = now;
                    state.ws.send(JSON.stringify({
                        type: 'realtime_input',
                        data: {
                            audio: {
                                data: base64Audio,
                                mimeType: 'audio/pcm;rate=16000',
                            },
                        },
                    }));
                } catch (error) {
                    // Error sending audio chunk
                }
            };

            source.connect(processor);
            processor.connect(audioContext.createMediaStreamDestination());
            state.audioProcessor = processor;
            state.audioContext = audioContext;
        } catch (error) {
            // Error starting audio capture
        }
    },

    convertToBase64(inputData) {
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = Math.round(s * 32767);
        }

        const uint8Data = new Uint8Array(int16Data.buffer);
        let binaryString = '';

        for (let i = 0; i < uint8Data.length; i += CONFIG.BASE64_CHUNK_SIZE) {
            const chunk = uint8Data.slice(i, i + CONFIG.BASE64_CHUNK_SIZE);
            const chunkArray = Array.from(chunk);
            binaryString += String.fromCharCode.apply(null, chunkArray);
        }

        return btoa(binaryString);
    },

    validateBase64(base64String) {
        return /^[A-Za-z0-9+/]*={0,2}$/.test(base64String);
    },

    stop() {
        if (state.audioStream) {
            state.audioStream.getTracks().forEach(track => track.stop());
            state.audioStream = null;
        }
        if (state.audioProcessor) {
            state.audioProcessor.disconnect();
            state.audioProcessor = null;
        }
    },
};

// ============================================================================
// Audio Playback
// ============================================================================

const audioPlayer = {
    async init() {
        if (!state.audioContext) {
            try {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: CONFIG.OUTPUT_SAMPLE_RATE,
                });
            } catch (error) {
                // Error initializing audio context
            }
        }
    },

    async playAudioChunk(base64Data) {
        await this.init();
        state.audioQueue.push(base64Data);
        if (!state.isPlayingAudio) {
            this.playNextChunk();
        }
    },

    async playNextChunk() {
        if (state.audioQueue.length === 0 || state.isPlayingAudio) {
            state.isPlayingAudio = false;
            return;
        }

        state.isPlayingAudio = true;
        const base64Data = state.audioQueue.shift();

        try {
            const floatSamples = this.decodeAudioData(base64Data);
            const audioBuffer = this.createAudioBuffer(floatSamples);
            this.playBuffer(audioBuffer);
        } catch (error) {
            state.isPlayingAudio = false;
            this.playNextChunk();
        }
    },

    decodeAudioData(base64Data) {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const samples = new Int16Array(bytes.buffer);
        const floatSamples = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            floatSamples[i] = samples[i] / 32768.0;
        }

        return floatSamples;
    },

    createAudioBuffer(floatSamples) {
        const audioBuffer = state.audioContext.createBuffer(
            1,
            floatSamples.length,
            CONFIG.OUTPUT_SAMPLE_RATE
        );
        audioBuffer.getChannelData(0).set(floatSamples);
        return audioBuffer;
    },

    playBuffer(audioBuffer) {
        const source = state.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(state.audioContext.destination);
        state.currentAudioSource = source;

        source.onended = () => {
            state.isPlayingAudio = false;
            state.currentAudioSource = null;
            this.playNextChunk();
        };

        source.start();
    },

    clearAudioQueue() {
        if (state.currentAudioSource) {
            try {
                state.currentAudioSource.stop();
            } catch {
                // Source may have already finished
            }
            state.currentAudioSource = null;
        }
        state.audioQueue = [];
        state.isPlayingAudio = false;
    },
};

// ============================================================================
// WebSocket Connection
// ============================================================================

const wsConnection = {
    connect() {
        utils.updateStatus('Connecting...', 'connecting');
        utils.hideError();

        const ws = new WebSocket(CONFIG.WS_URL);
        state.ws = ws;

        ws.onopen = () => this.handleOpen(ws);
        ws.onmessage = (event) => this.handleMessage(event);
        ws.onerror = () => {
            utils.showError('WebSocket connection error');
            utils.updateStatus('Connection Error', 'disconnected');
        };
        ws.onclose = () => this.handleClose();
    },

    handleOpen(ws) {
        utils.updateStatus('Connecting to Live API...', 'connecting');
        utils.toggleControls(true);

        const sourceLanguage = elements.sourceLanguage?.value || 'English';
        const targetLanguage = elements.targetLanguage?.value || 'Spanish';
        const selectedVoice = elements.voiceSelect?.value || 'alloy';
        const sourceLanguageCode = LANGUAGE_CODE_MAP[sourceLanguage] || 'en-US';
        const languageCode = LANGUAGE_CODE_MAP[targetLanguage] || 'es-ES';

        ws.send(JSON.stringify({
            type: 'connect',
            sourceLanguage,
            sourceLanguageCode,
            targetLanguage,
            languageCode,
            voice: selectedVoice,
        }));

        audioCapture.startMicrophone();
    },

    handleMessage(event) {
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'connected':
                    utils.addMessage('Live API connection established.', 'system');
                    break;
                case 'live_message':
                    this.handleLiveMessage(message.data);
                    break;
                case 'error':
                    utils.showError(message.message);
                    utils.addMessage(`Error: ${message.message}`, 'system');
                    break;
                case 'closed':
                    utils.addMessage('Connection closed.', 'system');
                    this.disconnect();
                    break;
            }
        } catch (error) {
            // Error parsing WebSocket message
        }
    },

    handleLiveMessage(liveMessage) {
        if (liveMessage.data) {
            audioPlayer.playAudioChunk(liveMessage.data);
        }

        if (liveMessage.serverContent?.modelTurn) {
            const parts = liveMessage.serverContent.modelTurn.parts || [];
            const sortedParts = [...parts].sort((a, b) => (b.inlineData ? 1 : -1));

            sortedParts.forEach(part => {
                try {
                    if (part.inlineData?.data) {
                        audioPlayer.playAudioChunk(part.inlineData.data);
                    }
                    if (part.text) {
                        utils.addMessage(part.text, 'assistant');
                    }
                } catch (error) {
                    // Error processing part
                }
            });
        }

        if (liveMessage.serverContent?.interrupted) {
            utils.addMessage('(Interrupted)', 'system');
            audioPlayer.clearAudioQueue();
        }

        if (liveMessage.goAway) {
            utils.addMessage(
                `⚠️ Session will close in ${liveMessage.goAway.time_left} seconds. Consider reconnecting.`,
                'system'
            );
        }

        if (liveMessage.outputTranscription?.text) {
            utils.addMessage(liveMessage.outputTranscription.text, 'assistant');
        }

        if (liveMessage.setupComplete) {
            state.isConnected = true;
            utils.updateStatus('Connected', 'connected');
            utils.addMessage('AI is ready! Start speaking.', 'system');
        }
    },

    handleClose() {
        utils.updateStatus('Disconnected', 'disconnected');
        utils.toggleControls(false);
        state.isConnected = false;
        this.stopFrameCapture();
    },

    stopFrameCapture() {
        if (state.frameCaptureInterval) {
            clearInterval(state.frameCaptureInterval);
            state.frameCaptureInterval = null;
        }
    },

    disconnect() {
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        this.stopFrameCapture();
        audioPlayer.clearAudioQueue();
        audioCapture.stop();
        state.isConnected = false;
        utils.toggleControls(false);
        utils.resetDropdowns();
    },
};

// ============================================================================
// Event Handlers
// ============================================================================

elements.connectBtn.addEventListener('click', async () => {
    try {
        await audioPlayer.init();
        if (state.audioContext?.state === 'suspended') {
            await state.audioContext.resume();
        }
        wsConnection.connect();
    } catch (error) {
        utils.showError('Failed to initialize audio. Please check your browser permissions.');
    }
});

elements.disconnectBtn.addEventListener('click', () => {
    wsConnection.disconnect();
    audioCapture.stop();
});

window.addEventListener('beforeunload', () => {
    audioCapture.stop();
    wsConnection.disconnect();
});

// Initialize dropdowns on page load
document.addEventListener('DOMContentLoaded', () => {
    populateLanguageDropdown(elements.sourceLanguage, 'English');
    populateLanguageDropdown(elements.targetLanguage, 'Spanish');
    populateVoiceDropdown(elements.voiceSelect, 'alloy');
});
