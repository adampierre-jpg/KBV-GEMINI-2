/**
 * ============================================================================
 * VBT (VELOCITY BASED TRAINING) APPLICATION - VANILLA JS 3D VERSION
 * Combined implementation of VBT Logic, State Machine, Gesture & Voice Control
 * ============================================================================
 */

import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// ============================================================================
// 1. UTILITIES & MATH (From app-3d.js)
// ============================================================================

const Vector3D = {
  fromLandmark(landmark) {
    return { x: landmark.x || 0, y: landmark.y || 0, z: landmark.z || 0 };
  },
  subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  },
  add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: (a.z || 0) + (b.z || 0) };
  },
  dot(a, b) {
    return a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
  },
  magnitude(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + (v.z || 0) * (v.z || 0));
  },
  distance(a, b) {
    return Vector3D.magnitude(Vector3D.subtract(a, b));
  },
  angleBetween(a, b) {
    const magA = Vector3D.magnitude(a);
    const magB = Vector3D.magnitude(b);
    if (magA === 0 || magB === 0) return 0;
    const cosAngle = Vector3D.dot(a, b) / (magA * magB);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
  },
  midpoint(a, b) {
    return {
      x: a.x + (b.x - a.x) * 0.5,
      y: a.y + (b.y - a.y) * 0.5,
      z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * 0.5
    };
  }
};

class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = { y: null, filter: (v, a) => (this.x.y = (this.x.y === null ? v : a * v + (1 - a) * this.x.y)) };
    this.dx = { y: null, filter: (v, a) => (this.dx.y = (this.dx.y === null ? v : a * v + (1 - a) * this.dx.y)) };
    this.lastTime = null;
  }
  
  getAlpha(cutoff, freq) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / freq;
    return 1.0 / (1.0 + tau / te);
  }
  
  filter(value, timestamp) {
    if (this.lastTime && timestamp === this.lastTime) return value;
    const freq = this.lastTime ? 1000 / (timestamp - this.lastTime) : 30;
    this.lastTime = timestamp;
    const dValue = this.x.y === null ? 0 : (value - this.x.y) * freq;
    const edValue = this.dx.filter(dValue, this.getAlpha(this.dCutoff, freq));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, this.getAlpha(cutoff, freq));
  }
}

// ============================================================================
// 2. NEW FEATURES (From PDF Instructions)
// ============================================================================

// --- Audio Feedback System ---
class AudioFeedback {
    constructor() {
        this.ctx = null;
        this.isUnlocked = false;
    }

    init() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
    }

    unlock() {
        if (this.isUnlocked) return;
        this.init();
        if (this.ctx) {
            const buffer = this.ctx.createBuffer(1, 1, 22050);
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(0);
            this.isUnlocked = true;
            console.log('🔊 Audio Unlocked');
        }
    }

    playTone(freq, type, duration, startTime = 0) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + startTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + startTime);
        osc.stop(this.ctx.currentTime + startTime + duration);
    }

    calibrationStart() { 
        this.playTone(440, 'sine', 0.1, 0); 
        this.playTone(554, 'sine', 0.1, 0.1); 
        this.playTone(659, 'sine', 0.1, 0.2); 
    }
    calibrationComplete() { 
        this.playTone(880, 'sine', 0.1, 0); 
        this.playTone(1108, 'sine', 0.4, 0.1); 
    }
    setStart() { this.playTone(600, 'square', 0.1); }
    setEnd() { 
        this.playTone(300, 'sawtooth', 0.15, 0); 
        this.playTone(300, 'sawtooth', 0.15, 0.2); 
    }
    rep() { this.playTone(800, 'sine', 0.05); }
    command() { this.playTone(1000, 'sine', 0.1); }
}

const audioFeedback = new AudioFeedback();

// --- Gesture Detector (T-Pose) ---
class GestureDetector {
    constructor() {
        this.framesHeld = 0;
        this.requiredFrames = 45; // ~1.5s
        this.cooldownFrames = 0;
        this.COOLDOWN_DURATION = 90; // 3s
    }

    update(pose) {
        if (this.cooldownFrames > 0) {
            this.cooldownFrames--;
            return null;
        }

        if (!pose || !pose.LEFT || !pose.RIGHT) return null;

        const leftWrist = pose.LEFT.WRIST;
        const rightWrist = pose.RIGHT.WRIST;
        const leftElbow = pose.LEFT.ELBOW;
        const rightElbow = pose.RIGHT.ELBOW;
        const leftShoulder = pose.LEFT.SHOULDER;
        const rightShoulder = pose.RIGHT.SHOULDER;
        const leftHip = pose.LEFT.HIP;

        // 1. Vertical Check: Wrists at shoulder height (+/- 15% torso length)
        const torsoLength = Math.abs(leftShoulder.y - leftHip.y);
        const yTolerance = torsoLength * 0.15;
        const leftYValid = Math.abs(leftWrist.y - leftShoulder.y) < yTolerance;
        const rightYValid = Math.abs(rightWrist.y - rightShoulder.y) < yTolerance;

        // 2. Horizontal Check: Wrists extended outward
        const armSpan = Math.abs(leftWrist.x - rightWrist.x);
        const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
        const extendedValid = armSpan > (shoulderWidth * 2.5);

        // 3. Elbow Angle Check (>160 degrees)
        const leftAngle = Vector3D.angleBetween(
            Vector3D.subtract(leftShoulder, leftElbow),
            Vector3D.subtract(leftWrist, leftElbow)
        );
        const rightAngle = Vector3D.angleBetween(
            Vector3D.subtract(rightShoulder, rightElbow),
            Vector3D.subtract(rightWrist, rightElbow)
        );
        const elbowsStraight = leftAngle > 150 && rightAngle > 150; 

        if (leftYValid && rightYValid && extendedValid && elbowsStraight) {
            this.framesHeld++;
            const progress = Math.min(1, this.framesHeld / this.requiredFrames);
            
            if (this.framesHeld >= this.requiredFrames) {
                this.framesHeld = 0;
                this.cooldownFrames = this.COOLDOWN_DURATION;
                return { gesture: 'T_POSE', confidence: 1.0 };
            }
            return { gesture: 'T_POSE_HOLDING', progress };
        } else {
            this.framesHeld = 0;
            return null;
        }
    }
}

// --- Voice Command System ---
class VoiceCommandSystem {
    constructor(callbacks) {
        this.recognition = null;
        this.callbacks = callbacks || {}; 
        
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            this.setupListeners();
        } else {
            console.warn('Speech Recognition API not supported');
        }
    }

    setupListeners() {
        this.recognition.onstart = () => {
            if (this.callbacks.onListeningChange) this.callbacks.onListeningChange(true);
        };
        this.recognition.onend = () => {
            if (this.callbacks.onListeningChange) this.callbacks.onListeningChange(false);
            try { this.recognition.start(); } catch (e) {} // Auto-restart
        };
        this.recognition.onerror = (event) => {
            if (event.error !== 'no-speech') console.warn('Voice error:', event.error);
        };
        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                    this.processCommand(finalTranscript.toLowerCase());
                } else if (this.callbacks.onTranscript) {
                    this.callbacks.onTranscript(event.results[i][0].transcript);
                }
            }
            if (finalTranscript && this.callbacks.onTranscript) {
                this.callbacks.onTranscript(finalTranscript);
            }
        };
    }

    processCommand(text) {
        const intents = [
            { id: 'CALIBRATE', phrases: ["ready", "calibrate", "start calibration"] },
            { id: 'RESET_SIDE', phrases: ["reset", "switch arms", "switch", "other side"] }
        ];
        for (const intent of intents) {
            if (intent.phrases.some(phrase => text.includes(phrase))) {
                if (this.callbacks.onCommand) this.callbacks.onCommand(intent.id, text);
                return;
            }
        }
    }

    start() { try { this.recognition?.start(); } catch(e) {} }
}

// --- Application State Store ---
const APP_STATES = {
    NEEDS_HEIGHT_INPUT: 'NEEDS_HEIGHT_INPUT',
    AWAITING_CALIBRATION: 'AWAITING_CALIBRATION',
    CALIBRATING: 'CALIBRATING',
    READY_FOR_SET: 'READY_FOR_SET',
    TRACKING: 'TRACKING',
    BETWEEN_SETS: 'BETWEEN_SETS'
};

class AppState {
    constructor() {
        this.currentState = APP_STATES.NEEDS_HEIGHT_INPUT;
        this.userHeight = null;
        this.calibrationProgress = 0;
        this.lockedSide = null;
        this.listeners = [];
        
        const stored = localStorage.getItem('vbt_user_height');
        if (stored) {
            this.userHeight = parseFloat(stored);
            this.currentState = APP_STATES.AWAITING_CALIBRATION;
        }
    }

    subscribe(listener) {
        this.listeners.push(listener);
        listener(this);
        return () => this.listeners = this.listeners.filter(l => l !== listener);
    }
    notify() { this.listeners.forEach(l => l(this)); }

    setHeight(inches) {
        this.userHeight = inches;
        localStorage.setItem('vbt_user_height', inches);
        this.currentState = APP_STATES.AWAITING_CALIBRATION;
        this.notify();
    }

    startCalibration() {
        if (this.canAcceptCalibrationTrigger) {
            this.currentState = APP_STATES.CALIBRATING;
            this.calibrationProgress = 0;
            this.notify();
        }
    }

    updateCalibrationProgress(progress) {
        this.calibrationProgress = progress;
        this.notify();
    }

    calibrationComplete() {
        this.currentState = APP_STATES.READY_FOR_SET;
        this.lockedSide = null;
        this.notify();
    }

    lockSide(side) {
        this.lockedSide = side;
        this.currentState = APP_STATES.TRACKING;
        this.notify();
    }

    endSet() {
        this.currentState = APP_STATES.BETWEEN_SETS;
        this.notify();
    }

    get canAcceptCalibrationTrigger() {
        return this.currentState === APP_STATES.AWAITING_CALIBRATION || 
               this.currentState === APP_STATES.BETWEEN_SETS;
    }

    get canAcceptResetCommand() {
        return this.currentState === APP_STATES.TRACKING;
    }

    get promptText() {
        switch (this.currentState) {
            case APP_STATES.NEEDS_HEIGHT_INPUT: return "Please enter your height";
            case APP_STATES.AWAITING_CALIBRATION: return "Hold T-Pose or say 'Ready'";
            case APP_STATES.CALIBRATING: return "Calibrating... Hold still";
            case APP_STATES.READY_FOR_SET: return "Start Moving (Auto-lock side)";
            case APP_STATES.TRACKING: return `Tracking ${this.lockedSide || ''} Side`;
            case APP_STATES.BETWEEN_SETS: return "Set Complete. T-Pose to reset.";
            default: return "";
        }
    }
}
const appState = new AppState();


// ============================================================================
// 3. CORE VBT LOGIC (From app-3d.js, adapted for new State Machine)
// ============================================================================

class CalibrationSystem {
    constructor() {
        this.frames = [];
        this.pixelToCmRatio = 1.0;
        this.Z_SCALE = 1.0;
    }

    reset() { this.frames = []; }

    captureFrame(pose, canvasHeight) {
        if (!pose.LEFT || !pose.RIGHT) return 0;
        const leftAnkle = pose.LEFT.ANKLE;
        const rightAnkle = pose.RIGHT.ANKLE;
        const nose = pose.LEFT.NOSE;
        if (!leftAnkle || !rightAnkle || !nose) return 0;

        const avgAnkle = Vector3D.midpoint(leftAnkle, rightAnkle);
        // Using simple Y-distance for standing calibration as it's robust
        const pixelHeight = Math.abs(avgAnkle.y - nose.y) * canvasHeight;
        
        this.frames.push(pixelHeight);
        return this.frames.length / 60;
    }

    finalize(userHeightInches) {
        if (this.frames.length === 0) return;
        const avgPixels = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        const userHeightCm = userHeightInches * 2.54;
        // Approx 88% of height is ankle-to-nose
        const effectiveHeightCm = userHeightCm * 0.88;
        this.pixelToCmRatio = avgPixels / effectiveHeightCm;
        console.log(`Calibrated: ${(this.pixelToCmRatio).toFixed(2)} px/cm`);
    }
    
    getPixelsPerMeter() { return this.pixelToCmRatio * 100; }
}

class VelocityFatigueTracker {
    constructor() {
        this.data = {
            velocities: [],
            baselineVelocity: null,
            peakVelocity: null,
            dropFromBaseline: 0,
            repCount: 0,
            fatigueZone: 'FRESH'
        };
    }
    reset() {
        this.data = { velocities: [], baselineVelocity: null, peakVelocity: null, dropFromBaseline: 0, repCount: 0, fatigueZone: 'FRESH' };
    }
    addRep(velocity) {
        const d = this.data;
        d.velocities.push(velocity);
        d.repCount++;
        if (!d.peakVelocity || velocity > d.peakVelocity) d.peakVelocity = velocity;
        
        // Use first 3 reps as baseline
        if (d.repCount === 3) {
            d.baselineVelocity = d.velocities.reduce((a,b)=>a+b,0) / 3;
        }
        
        if (d.baselineVelocity) {
            d.dropFromBaseline = Math.max(0, ((d.baselineVelocity - velocity) / d.baselineVelocity) * 100);
            if (d.dropFromBaseline < 5) d.fatigueZone = 'FRESH';
            else if (d.dropFromBaseline < 10) d.fatigueZone = 'MILD';
            else if (d.dropFromBaseline < 20) d.fatigueZone = 'MODERATE';
            else if (d.dropFromBaseline < 30) d.fatigueZone = 'HIGH';
            else d.fatigueZone = 'CRITICAL';
        }
        return d;
    }
}

class VBTStateMachine {
    constructor() {
        this.reset();
        this.filters = {}; 
        this.THRESHOLDS = {
            RESET_DURATION_FRAMES: 45,
            RACK_HOLD_FRAMES: 15,
            VELOCITY_THRESHOLD: 0.5 
        };
        this.lastWristY = 0;
        this.currentRepPeak = 0;
        this.state = {
            phase: 'IDLE', // IDLE, ECCENTRIC, CONCENTRIC
            repStartY: 0,
            resetProgress: 0
        };
    }

    reset() {
        this.state = { phase: 'IDLE', repStartY: 0, resetProgress: 0 };
        this.currentRepPeak = 0;
        this.filters = {};
    }

    update(pose, timestamp, lockedSide, pixelsPerMeter) {
        if (!lockedSide) return null;

        // 1. Check Standing Reset (Hands Down)
        if (this.checkStandingPose(pose)) {
            this.state.resetProgress++;
            if (this.state.resetProgress > this.THRESHOLDS.RESET_DURATION_FRAMES) {
                return { type: 'STANDING_RESET' };
            }
        } else {
            this.state.resetProgress = 0;
        }

        // 2. Velocity Tracking
        const wrist = pose[lockedSide].WRIST;
        
        // Smooth Z
        if (!this.filters.z) this.filters.z = new OneEuroFilter();
        const smoothZ = this.filters.z.filter(wrist.z || 0, timestamp);
        
        // Calculate vertical velocity (simplified for VBT core)
        // In a real scenario, use full 3D derivative
        if (!this.lastTime) this.lastTime = timestamp;
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        if (dt <= 0) return null;

        // Convert Y change to meters
        // Note: Y increases downwards in canvas, so negative delta is Up
        const dyPixels = (this.lastWristY - wrist.y); // Positive = Up
        const dyMeters = dyPixels / pixelsPerMeter; // Canvas coords are normalized 0-1? 
        // Wait, pose coordinates from my converter below are 0-1.
        // pixelsPerMeter is calculated based on screen height pixels.
        // So we need to multiply wrist.y by canvasHeight before using pixelsPerMeter?
        // Let's assume input 'pose' is normalized. 
        
        // NOTE: The main loop passes normalized pose. 
        // We need canvas height to get meters.
        // Let's rely on the caller passing absolute pixels or handling the ratio.
        // Actually, let's fix the interface: VBTStateMachine should assume normalized inputs 
        // and a conversion factor that converts NORMALIZED units to METERS.
        
        // Let's assume pixelsPerMeter = (Pixels / Meter).
        // Normalized Y * CanvasHeight = Pixels.
        // Meters = (NormY * Height) / (Pixels/Meter).
        // Meters = NormY * (Height / (Pixels/Meter)). 
        // Let's just track normalized velocity and scale it at the end.
        
        const vy = (this.lastWristY - wrist.y) / dt; // Normalized units per second
        this.lastWristY = wrist.y;

        // Peak detection logic (Concentric phase)
        if (vy > 0.05) { // Moving up
             if (this.state.phase !== 'CONCENTRIC') {
                 this.state.phase = 'CONCENTRIC';
                 this.currentRepPeak = 0;
             }
             if (vy > this.currentRepPeak) this.currentRepPeak = vy;
        } else if (vy < -0.05) { // Moving down
            if (this.state.phase === 'CONCENTRIC') {
                // End of rep detected (transition from up to down)
                this.state.phase = 'ECCENTRIC';
                // Return rep event
                // We need to scale velocity to meters/sec here.
                // Caller must provide conversion factor: metersPerNormalizedUnit
                return { 
                    type: 'REP', 
                    velocityRaw: this.currentRepPeak 
                };
            }
        }

        return null;
    }

    checkStandingPose(pose) {
        // Hands below hips
        const lWrist = pose.LEFT.WRIST;
        const lHip = pose.LEFT.HIP;
        const rWrist = pose.RIGHT.WRIST;
        const rHip = pose.RIGHT.HIP;
        return (lWrist.y > lHip.y && rWrist.y > rHip.y);
    }
}

// ============================================================================
// 4. MAIN APPLICATION
// ============================================================================

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const uiPrompt = document.getElementById('prompt-text');
const voiceIndicator = document.getElementById('voice-indicator');
const voiceTranscript = document.getElementById('voice-transcript');
const progressRing = document.querySelector('.progress-ring__circle');
const overlayCenter = document.getElementById('overlay-center');
const overlayText = document.getElementById('overlay-text');

let landmarker;
let lastVideoTime = -1;
let gestureDetector = new GestureDetector();
let calibrationSystem = new CalibrationSystem();
let vbtMachine = new VBTStateMachine();
let fatigueTracker = new VelocityFatigueTracker();

// Init
async function init() {
    // 1. App State Listener
    appState.subscribe(state => {
        uiPrompt.textContent = state.promptText;
        
        // UI Visibility
        if (state.currentState === APP_STATES.NEEDS_HEIGHT_INPUT) {
            document.getElementById('height-input-modal').classList.remove('hidden');
        } else {
            document.getElementById('height-input-modal').classList.add('hidden');
        }

        // Triggers
        if (state.currentState === APP_STATES.CALIBRATING && state.calibrationProgress === 0) {
            audioFeedback.calibrationStart();
            calibrationSystem.reset();
        }
        
        if (state.currentState === APP_STATES.BETWEEN_SETS) {
            document.getElementById('set-info').textContent = "Resting...";
        }
    });

    // 2. Voice
    const voice = new VoiceCommandSystem({
        onCommand: (intent, text) => {
            audioFeedback.command();
            voiceTranscript.textContent = `"${text}"`;
            
            if (intent === 'CALIBRATE' && appState.canAcceptCalibrationTrigger) {
                appState.startCalibration();
            } else if (intent === 'RESET_SIDE' && appState.canAcceptResetCommand) {
                appState.endSet();
                vbtMachine.reset();
                fatigueTracker.reset(); // New set
                audioFeedback.setEnd();
            }
        },
        onListeningChange: (isListening) => {
            if (isListening) voiceIndicator.classList.remove('hidden');
            else voiceIndicator.classList.add('hidden');
        },
        onTranscript: (text) => {
            voiceTranscript.textContent = text;
        }
    });
    voice.start();

    // 3. Camera
    const constraints = { 
        video: { 
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
        } 
    };
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
    } catch(e) {
        console.error("Camera error", e);
        uiPrompt.textContent = "Camera Error: " + e.message;
    }
    
    // 4. MediaPipe
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO"
    });

    // 5. DOM Events
    document.getElementById('btn-save-height').onclick = () => {
        const val = document.getElementById('height-input').value;
        if (val) {
            appState.setHeight(val);
            audioFeedback.unlock();
            voice.start();
        }
    };
    
    document.getElementById('btn-unlock-audio').onclick = () => {
        audioFeedback.unlock();
        document.getElementById('btn-unlock-audio').classList.add('hidden');
    };

    requestAnimationFrame(loop);
}

// Main Loop
function loop(timestamp) {
    requestAnimationFrame(loop);

    // Canvas Resize
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        
        const results = landmarker.detectForVideo(video, timestamp);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw video (Mirrored via CSS, so we draw normal)
        ctx.save();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (results.landmarks && results.landmarks.length > 0) {
            const raw = results.landmarks[0];
            const pose = {
                LEFT: { WRIST: raw[15], ELBOW: raw[13], SHOULDER: raw[11], HIP: raw[23], KNEE: raw[25], ANKLE: raw[27], NOSE: raw[0] },
                RIGHT: { WRIST: raw[16], ELBOW: raw[14], SHOULDER: raw[12], HIP: raw[24], KNEE: raw[26], ANKLE: raw[28] }
            };

            // Draw Skeleton
            drawSkeleton(ctx, pose);

            const state = appState.currentState;

            // --- GESTURE DETECTION (Awaiting & Between Sets) ---
            if (state === APP_STATES.AWAITING_CALIBRATION || state === APP_STATES.BETWEEN_SETS) {
                const gesture = gestureDetector.update(pose);
                if (gesture?.gesture === 'T_POSE') {
                    appState.startCalibration();
                } else if (gesture?.gesture === 'T_POSE_HOLDING') {
                    updateRing(gesture.progress, "HOLD T-POSE");
                } else {
                    hideRing();
                }
            }

            // --- CALIBRATION ---
            if (state === APP_STATES.CALIBRATING) {
                const progress = calibrationSystem.captureFrame(pose, canvas.height);
                appState.updateCalibrationProgress(progress);
                updateRing(progress, "CALIBRATING");
                
                if (progress >= 1.0) {
                    calibrationSystem.finalize(appState.userHeight);
                    appState.calibrationComplete();
                    audioFeedback.calibrationComplete();
                    hideRing();
                }
            }

            // --- READY (Side Lock) ---
            if (state === APP_STATES.READY_FOR_SET) {
                // Detect side
                if (Math.abs(pose.LEFT.WRIST.y - pose.RIGHT.WRIST.y) > 0.15) {
                    const locked = pose.LEFT.WRIST.y < pose.RIGHT.WRIST.y ? 'LEFT' : 'RIGHT'; // Y is inverted visually? No, 0 is top. Smaller Y is higher.
                    appState.lockSide(locked);
                    audioFeedback.setStart();
                    vbtMachine.reset();
                }
            }

            // --- TRACKING ---
            if (state === APP_STATES.TRACKING) {
                const pxPerMeter = calibrationSystem.getPixelsPerMeter();
                // We pass a conversion factor: meters per normalized unit = CanvasHeight / pxPerMeter
                // Actually: Normalized * Height = Pixels. Pixels / (Pixels/Meter) = Meters.
                // So Conversion Factor = Height / (Pixels/Meter).
                const metersPerNorm = canvas.height / pxPerMeter;

                const event = vbtMachine.update(pose, timestamp, appState.lockedSide, pxPerMeter);
                
                // 1. Check Standing Reset
                if (event && event.type === 'STANDING_RESET') {
                    appState.endSet();
                    vbtMachine.reset();
                    audioFeedback.setEnd();
                }
                
                // 2. Handle Rep
                if (event && event.type === 'REP') {
                    const velocityMeters = event.velocityRaw * metersPerNorm; 
                    const stats = fatigueTracker.addRep(velocityMeters);
                    
                    audioFeedback.rep();
                    
                    // Update DOM
                    document.getElementById('rep-count').textContent = stats.repCount;
                    document.getElementById('last-velocity').textContent = velocityMeters.toFixed(2);
                    document.getElementById('fatigue-zone').textContent = stats.fatigueZone;
                    const zoneColors = { FRESH: '#22c55e', MILD: '#eab308', MODERATE: '#f97316', HIGH: '#ef4444', CRITICAL: '#991b1b' };
                    document.getElementById('fatigue-zone').style.color = zoneColors[stats.fatigueZone];
                }
            }
        }
    }
}

// Helpers
function updateRing(progress, text) {
    overlayCenter.classList.remove('hidden');
    overlayText.innerHTML = text.replace('\n', '<br>');
    const circumference = 326;
    const offset = circumference - (progress * circumference);
    progressRing.style.strokeDashoffset = offset;
}

function hideRing() {
    overlayCenter.classList.add('hidden');
}

function drawSkeleton(ctx, pose) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 3;
    const joints = [
        [pose.LEFT.SHOULDER, pose.RIGHT.SHOULDER],
        [pose.LEFT.SHOULDER, pose.LEFT.ELBOW], [pose.LEFT.ELBOW, pose.LEFT.WRIST],
        [pose.RIGHT.SHOULDER, pose.RIGHT.ELBOW], [pose.RIGHT.ELBOW, pose.RIGHT.WRIST],
        [pose.LEFT.SHOULDER, pose.LEFT.HIP], [pose.RIGHT.SHOULDER, pose.RIGHT.HIP],
        [pose.LEFT.HIP, pose.RIGHT.HIP] // Hip connector
    ];
    joints.forEach(([a, b]) => {
        if(a && b) {
            ctx.beginPath();
            ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
            ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
            ctx.stroke();
        }
    });
}

// Start
init();
