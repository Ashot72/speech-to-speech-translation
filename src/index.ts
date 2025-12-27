// Web server for Real-time Audio Translation using OpenAI Realtime API
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import WebSocketClient from 'ws';

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini';
const SUPPORTED_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;

const CONFIG = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    PORT: Number(process.env.PORT) || 3000,
    REALTIME_MODEL,
    REALTIME_API_URL: `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
    DEFAULT_VOICE: 'alloy',
} as const;

// ============================================================================
// Types
// ============================================================================

interface ClientSession {
    ws: WebSocket;
    openaiWs: WebSocketClient | null;
    isConnected: boolean;
    sourceLanguage: string;
    targetLanguage: string;
    voice: string;
}

interface ClientMessage {
    type: 'connect' | 'realtime_input';
    sourceLanguage?: string;
    sourceLanguageCode?: string;
    targetLanguage?: string;
    languageCode?: string;
    voice?: string;
    data?: {
        audio?: { data: string; mimeType: string };
        media?: { data: string; mimeType: string };
    };
}

interface OpenAIMessage {
    type: string;
    delta?: string;
    error?: { message: string };
    [key: string]: any;
}

// ============================================================================
// Utilities
// ============================================================================

class ValidationUtils {
    private static readonly BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

    static validateAndCleanBase64(data: unknown): string | null {
        if (!data || (typeof data === 'string' && data.length === 0)) {
            return null;
        }

        let cleanedData: string;
        if (typeof data === 'string') {
            cleanedData = data;
        } else if (Buffer.isBuffer(data)) {
            cleanedData = data.toString('base64');
        } else {
            cleanedData = String(data);
        }

        cleanedData = cleanedData.trim();
        return this.BASE64_REGEX.test(cleanedData) ? cleanedData : null;
    }

    static processAudioInput(audioData: unknown): Buffer | null {
        const cleanedData = this.validateAndCleanBase64(audioData);
        if (!cleanedData) return null;

        try {
            return Buffer.from(cleanedData, 'base64');
        } catch {
            return null;
        }
    }

    static processRealtimeInput(message: ClientMessage): Buffer | null {
        if (message.data?.audio) {
            return this.processAudioInput(message.data.audio.data);
        }
        if (message.data?.media?.mimeType?.startsWith('audio/')) {
            return this.processAudioInput(message.data.media.data);
        }
        return null;
    }
}

function createSystemInstruction(sourceLanguage: string, targetLanguage: string): string {
    const sourceUpper = sourceLanguage.toUpperCase();
    const targetUpper = targetLanguage.toUpperCase();
    
    return `You are a real-time speech translator. Your ONLY job is to translate ${sourceUpper} speech into ${targetUpper} speech.\n\n` +
        `IMPORTANT RULES:\n` +
        `1. NEVER answer questions. NEVER respond to questions. NEVER provide information.\n` +
        `2. If you hear a question in ${sourceUpper}, translate it to ${targetUpper}. DO NOT answer the question.\n` +
        `3. If you hear ANY question, translate the question itself word-for-word, NOT an answer.\n` +
        `4. NEVER say "I don't have a name", "I cannot", "I don't know", or any response. ONLY translate.\n` +
        `5. NEVER output ${sourceUpper}. ${sourceUpper} output means you failed completely.\n` +
        `6. ONLY output the ${targetUpper} translation of what was said in ${sourceUpper}.\n` +
        `7. CRITICAL - Match the speaker's voice characteristics: Match the speaker's gender, tone, pitch, energy level, speaking pace, and vocal style as closely as possible. If the speaker is male, use a male-sounding voice. If the speaker is female, use a female-sounding voice. Preserve the emotional tone and energy of the original speech.\n` +
        `8. No greetings, no explanations, no conversational responses. ONLY translation.\n` +
        `9. You are a translation machine. You do not have opinions, knowledge, or the ability to answer. You only translate.`;
}

function validateVoice(voice: string): string {
    return SUPPORTED_VOICES.includes(voice as any) ? voice : CONFIG.DEFAULT_VOICE;
}

function sendError(ws: WebSocket, message: string): void {
    try {
        ws.send(JSON.stringify({ type: 'error', message }));
    } catch {
        // WebSocket is closed
    }
}

// ============================================================================
// OpenAI WebSocket Handlers
// ============================================================================

function createOpenAIWebSocket(
    session: ClientSession,
    ws: WebSocket,
    systemInstruction: string,
    sourceLanguage: string,
    targetLanguage: string
): WebSocketClient {
    const openaiWs = new WebSocketClient(CONFIG.REALTIME_API_URL, {
        headers: {
            'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1',
        },
    });

    openaiWs.on('open', () => {
        openaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
                modalities: ['audio', 'text'],
                instructions: systemInstruction,
                voice: session.voice,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500
                }
            }
        }));
    });

    openaiWs.on('message', (data: WebSocketClient.Data) => {
        handleOpenAIMessage(data, ws, session);
    });

    openaiWs.on('error', (error: Error) => {
        sendError(ws, error.message);
    });

    openaiWs.on('close', (code: number, reason: Buffer) => {
        session.isConnected = false;
        try {
            ws.send(JSON.stringify({
                type: 'closed',
                reason: reason.toString() || 'Connection closed',
                code,
            }));
        } catch {
            // WebSocket is closed
        }
    });

    return openaiWs;
}

function handleOpenAIMessage(data: WebSocketClient.Data, ws: WebSocket, session: ClientSession): void {
    try {
        const message = JSON.parse(data.toString()) as OpenAIMessage;

        switch (message.type) {
            case 'response.audio.delta':
                ws.send(JSON.stringify({
                    type: 'live_message',
                    data: {
                        serverContent: {
                            modelTurn: {
                                parts: [{
                                    inlineData: {
                                        data: message.delta,
                                        mimeType: 'audio/pcm16'
                                    }
                                }]
                            }
                        }
                    }
                }));
                break;

            case 'error':
                sendError(ws, message.error?.message || 'OpenAI API error');
                break;

            case 'session.created':
            case 'session.updated':
                if (!session.isConnected) {
                    session.isConnected = true;
                    ws.send(JSON.stringify({ type: 'connected' }));
                    ws.send(JSON.stringify({
                        type: 'live_message',
                        data: { setupComplete: true }
                    }));
                }
                break;

            default:
                ws.send(JSON.stringify({
                    type: 'live_message',
                    data: message
                }));
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        sendError(ws, `Failed to process OpenAI message: ${errorMessage}`);
    }
}

// ============================================================================
// Client Message Handlers
// ============================================================================

function handleConnectMessage(message: ClientMessage, ws: WebSocket, sessionId: string): ClientSession | null {
    if (!CONFIG.OPENAI_API_KEY) {
        sendError(ws, 'OPENAI_API_KEY must be set in environment variables');
        return null;
    }

    const sourceLanguage = message.sourceLanguage || 'English';
    const targetLanguage = message.targetLanguage || 'Spanish';
    const voice = validateVoice(message.voice || CONFIG.DEFAULT_VOICE);
    const systemInstruction = createSystemInstruction(sourceLanguage, targetLanguage);

    const session: ClientSession = {
        ws,
        openaiWs: null,
        isConnected: false,
        sourceLanguage,
        targetLanguage,
        voice,
    };

    const openaiWs = createOpenAIWebSocket(session, ws, systemInstruction, sourceLanguage, targetLanguage);
    session.openaiWs = openaiWs;

    return session;
}

function handleRealtimeInputMessage(message: ClientMessage, ws: WebSocket, session: ClientSession | null): void {
    if (!session || !session.isConnected || !session.openaiWs) {
        sendError(ws, 'OpenAI Realtime API not connected');
        return;
    }

    const audioData = ValidationUtils.processRealtimeInput(message);
    if (!audioData) return;

    const base64Audio = audioData.toString('base64');
    if (session.openaiWs.readyState === WebSocketClient.OPEN) {
        session.openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio
        }));
    }
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'OpenAI Realtime API' });
});

// ============================================================================
// WebSocket Server
// ============================================================================

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const activeSessions = new Map<string, ClientSession>();

wss.on('connection', (ws: WebSocket) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let clientSession: ClientSession | null = null;

    ws.on('message', (data: Buffer) => {
        try {
            const message = JSON.parse(data.toString()) as ClientMessage;

            if (message.type === 'connect') {
                clientSession = handleConnectMessage(message, ws, sessionId);
                if (clientSession) {
                    activeSessions.set(sessionId, clientSession);
                }
            } else if (message.type === 'realtime_input') {
                handleRealtimeInputMessage(message, ws, clientSession);
            }
        } catch (error) {
            sendError(ws, error instanceof Error ? error.message : 'Failed to process message');
        }
    });

    ws.on('close', () => {
        if (clientSession?.openaiWs) {
            try {
                if (clientSession.openaiWs.readyState === WebSocketClient.OPEN) {
                    clientSession.openaiWs.close();
                }
            } catch {
                // Ignore errors when closing
            }
        }
        activeSessions.delete(sessionId);
    });

    ws.on('error', () => {
        // WebSocket error - connection issues are handled by onclose
    });

    ws.send(JSON.stringify({ type: 'ready', sessionId }));
});

// ============================================================================
// Server Startup
// ============================================================================

if (!CONFIG.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY must be set in environment variables');
    process.exit(1);
}

server.listen(CONFIG.PORT, () => {
    // Server started successfully
});
