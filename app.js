/**

- ============================================================================
- VBT (VELOCITY BASED TRAINING) APPLICATION - 3D VERSION WITH GESTURE & VOICE
- ============================================================================
- 
- FEATURES:
- - 3D pose tracking with MediaPipe PoseLandmarker
- - T-pose gesture detection for hands-free calibration
- - Voice commands for hands-free control
- - Mobile full-screen camera with front-camera mirroring
- - Audio feedback for all actions
- - Application state machine for flow control
- 
- ============================================================================
- SECTIONS:
- 1. Imports & 3D Vector Math Utilities
- 1. One Euro Filter (Adaptive Smoothing)
- 1. Audio Feedback System
- 1. Application State Machine
- 1. Gesture Detector (T-Pose)
- 1. Voice Command System
- 1. VelocityFatigueTracker Class
- 1. SetTimingTracker Class
- 1. CalibrationSystem Class (3D Enhanced)
- 1. VBTStateMachine Class (3D Enhanced)
- 1. App Initialization & Main Loop
- 1. UI Update Functions
- 1. Helper Functions
- ============================================================================
  */

import { PoseLandmarker, FilesetResolver } from “https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs”;

// ============================================================================
// SECTION 1: 3D VECTOR MATH UTILITIES
// ============================================================================

const Vector3D = {
fromLandmark(landmark) {
return {
x: landmark.x || 0,
y: landmark.y || 0,
z: landmark.z || 0
};
},

subtract(a, b) {
return {
x: a.x - b.x,
y: a.y - b.y,
z: (a.z || 0) - (b.z || 0)
};
},

add(a, b) {
return {
x: a.x + b.x,
y: a.y + b.y,
z: (a.z || 0) + (b.z || 0)
};
},

dot(a, b) {
return a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
},

cross(a, b) {
return {
x: a.y * (b.z || 0) - (a.z || 0) * b.y,
y: (a.z || 0) * b.x - a.x * (b.z || 0),
z: a.x * b.y - a.y * b.x
};
},

magnitude(v) {
return Math.sqrt(v.x * v.x + v.y * v.y + (v.z || 0) * (v.z || 0));
},

normalize(v) {
const mag = Vector3D.magnitude(v);
if (mag === 0) return { x: 0, y: 0, z: 0 };
return {
x: v.x / mag,
y: v.y / mag,
z: (v.z || 0) / mag
};
},

distance(a, b) {
return Vector3D.magnitude(Vector3D.subtract(a, b));
},

angleBetween(a, b) {
const magA = Vector3D.magnitude(a);
const magB = Vector3D.magnitude(b);

```
if (magA === 0 || magB === 0) return 0;

const cosAngle = Vector3D.dot(a, b) / (magA * magB);
const clampedCos = Math.max(-1, Math.min(1, cosAngle));

return Math.acos(clampedCos) * (180 / Math.PI);
```

},

scale(v, scalar) {
return {
x: v.x * scalar,
y: v.y * scalar,
z: (v.z || 0) * scalar
};
},

lerp(a, b, t) {
return {
x: a.x + (b.x - a.x) * t,
y: a.y + (b.y - a.y) * t,
z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t
};
},

midpoint(a, b) {
return Vector3D.lerp(a, b, 0.5);
}
};

// ============================================================================
// SECTION 2: ONE EURO FILTER (ADAPTIVE SMOOTHING)
// ============================================================================

class LowPassFilter {
constructor(alpha) {
this.alpha = alpha;
this.y = null;
}

filter(value, alpha) {
if (alpha !== undefined) this.alpha = alpha;

```
if (this.y === null) {
  this.y = value;
} else {
  this.y = this.alpha * value + (1 - this.alpha) * this.y;
}
return this.y;
```

}

reset() {
this.y = null;
}
}

class OneEuroFilter {
constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
this.minCutoff = minCutoff;
this.beta = beta;
this.dCutoff = dCutoff;

```
this.x = new LowPassFilter(this.getAlpha(minCutoff, 30));
this.dx = new LowPassFilter(this.getAlpha(dCutoff, 30));

this.lastTime = null;
```

}

getAlpha(cutoff, freq) {
const tau = 1.0 / (2 * Math.PI * cutoff);
const te = 1.0 / freq;
return 1.0 / (1.0 + tau / te);
}

filter(value, timestamp) {
const freq = this.lastTime ? 1000 / (timestamp - this.lastTime) : 30;
this.lastTime = timestamp;

```
const dValue = this.x.y === null ? 0 : (value - this.x.y) * freq;
const edValue = this.dx.filter(dValue, this.getAlpha(this.dCutoff, freq));

const cutoff = this.minCutoff + this.beta * Math.abs(edValue);

return this.x.filter(value, this.getAlpha(cutoff, freq));
```

}

reset() {
this.x.reset();
this.dx.reset();
this.lastTime = null;
}
}

// ============================================================================
// SECTION 3: AUDIO FEEDBACK SYSTEM
// ============================================================================

const audioFeedback = {
context: null,
isUnlocked: false,

getContext() {
if (!this.context) {
this.context = new (window.AudioContext || window.webkitAudioContext)();
}
return this.context;
},

playTone(frequency, duration, type = ‘sine’, volume = 0.3) {
if (!this.isUnlocked) return;

```
const ctx = this.getContext();
const oscillator = ctx.createOscillator();
const gainNode = ctx.createGain();

oscillator.connect(gainNode);
gainNode.connect(ctx.destination);

oscillator.type = type;
oscillator.frequency.value = frequency;
gainNode.gain.value = volume;

gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

oscillator.start(ctx.currentTime);
oscillator.stop(ctx.currentTime + duration);
```

},

playSequence(notes) {
if (!this.isUnlocked) return;

```
const ctx = this.getContext();
let time = ctx.currentTime;

for (const [freq, duration, gap = 0] of notes) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.frequency.value = freq;
  gain.gain.value = 0.3;
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  
  osc.start(time);
  osc.stop(time + duration);
  
  time += duration + gap;
}
```

},

calibrationStart() {
this.playSequence([
[440, 0.1, 0.05],
[554, 0.1, 0.05],
[659, 0.15]
]);
},

calibrationComplete() {
this.playSequence([
[523, 0.1, 0.05],
[659, 0.1, 0.05],
[784, 0.2]
]);
},

setStart() {
this.playTone(880, 0.15);
},

setEnd() {
this.playSequence([
[660, 0.1, 0.1],
[660, 0.1]
]);
},

rep() {
this.playTone(1000, 0.05, ‘sine’, 0.2);
},

command() {
this.playTone(1200, 0.08);
},

error() {
this.playTone(220, 0.3, ‘sawtooth’, 0.2);
},

unlock() {
const ctx = this.getContext();
if (ctx.state === ‘suspended’) {
ctx.resume();
}
this.isUnlocked = true;
// Play silent tone to fully unlock on iOS
this.playTone(0, 0.001, ‘sine’, 0);
console.log(“🔊 [Audio] Unlocked”);
}
};

// ============================================================================
// SECTION 4: APPLICATION STATE MACHINE
// ============================================================================

const AppStates = {
NEEDS_HEIGHT_INPUT: ‘NEEDS_HEIGHT_INPUT’,
AWAITING_CALIBRATION: ‘AWAITING_CALIBRATION’,
CALIBRATING: ‘CALIBRATING’,
READY_FOR_SET: ‘READY_FOR_SET’,
TRACKING: ‘TRACKING’,
BETWEEN_SETS: ‘BETWEEN_SETS’
};

class AppStateMachine {
constructor() {
this.state = {
current: AppStates.NEEDS_HEIGHT_INPUT,
userHeightInches: null,
calibrationProgress: 0,
lockedSide: null,
lastTransitionTime: Date.now(),
prompt: ‘Enter your height to begin’
};

```
this.listeners = [];

// Check localStorage for stored height
const storedHeight = localStorage.getItem('vbt_user_height');
if (storedHeight) {
  this.state.userHeightInches = parseFloat(storedHeight);
  this.state.current = AppStates.AWAITING_CALIBRATION;
  this.state.prompt = 'Stand in T-pose when ready, or say "I\'m ready"';
}
```

}

subscribe(listener) {
this.listeners.push(listener);
listener(this.state);
return () => {
this.listeners = this.listeners.filter(l => l !== listener);
};
}

notify() {
this.listeners.forEach(l => l(this.state));
}

setHeight(inches) {
this.state.userHeightInches = inches;
localStorage.setItem(‘vbt_user_height’, inches.toString());
this.state.current = AppStates.AWAITING_CALIBRATION;
this.state.prompt = ‘Stand in T-pose when ready, or say “I'm ready”’;
this.state.lastTransitionTime = Date.now();
this.notify();
console.log(`📏 [AppState] Height set: ${inches}"`);
}

startCalibration() {
this.state.current = AppStates.CALIBRATING;
this.state.calibrationProgress = 0;
this.state.prompt = ‘Hold still… calibrating’;
this.state.lastTransitionTime = Date.now();
this.notify();
console.log(“🎯 [AppState] Starting calibration”);
}

updateCalibrationProgress(progress) {
this.state.calibrationProgress = progress;
this.notify();
}

calibrationComplete() {
this.state.current = AppStates.READY_FOR_SET;
this.state.calibrationProgress = 1;
this.state.lockedSide = null;
this.state.prompt = ‘Pick up the kettlebell - tracking begins when you move’;
this.state.lastTransitionTime = Date.now();
this.notify();
console.log(“✅ [AppState] Calibration complete, ready for set”);
}

lockSide(side) {
this.state.current = AppStates.TRACKING;
this.state.lockedSide = side;
this.state.prompt = `Tracking ${side} side`;
this.state.lastTransitionTime = Date.now();
this.notify();
console.log(`🏋️ [AppState] Side locked: ${side}`);
}

endSet() {
this.state.current = AppStates.BETWEEN_SETS;
this.state.lockedSide = null;
this.state.prompt = ‘Set complete. T-pose when ready for next set’;
this.state.lastTransitionTime = Date.now();
this.notify();
console.log(“⏹️ [AppState] Set ended”);
}

canAcceptCalibrationTrigger() {
return this.state.current === AppStates.AWAITING_CALIBRATION ||
this.state.current === AppStates.BETWEEN_SETS;
}

canAcceptResetCommand() {
return this.state.current === AppStates.TRACKING;
}

reset() {
this.state = {
current: AppStates.NEEDS_HEIGHT_INPUT,
userHeightInches: null,
calibrationProgress: 0,
lockedSide: null,
lastTransitionTime: Date.now(),
prompt: ‘Enter your height to begin’
};
localStorage.removeItem(‘vbt_user_height’);
this.notify();
}
}

// ============================================================================
// SECTION 5: GESTURE DETECTOR (T-POSE)
// ============================================================================

class GestureDetector {
constructor(config = {}) {
this.config = {
HOLD_FRAMES: config.holdFrames || 45,           // ~1.5s at 30fps
WRIST_HEIGHT_TOLERANCE: config.wristHeightTolerance || 0.15,
MIN_ARM_EXTENSION: config.minArmExtension || 0.15,
MIN_ELBOW_ANGLE: config.minElbowAngle || 160,   // Geometric angle for straight arm
COOLDOWN_MS: config.cooldownMs || 3000,
…config
};

```
this.state = {
  tPoseFrames: 0,
  lastTriggerTime: 0,
  currentGesture: null
};
```

}

calculateElbowAngle3D(shoulder, elbow, wrist) {
const toShoulder = Vector3D.subtract(shoulder, elbow);
const toWrist = Vector3D.subtract(wrist, elbow);
const geometricAngle = Vector3D.angleBetween(toShoulder, toWrist);
return geometricAngle; // Return geometric angle (180 = straight)
}

isTPose(pose) {
if (!pose.LEFT || !pose.RIGHT) return false;

```
const leftWrist = pose.LEFT.WRIST;
const rightWrist = pose.RIGHT.WRIST;
const leftShoulder = pose.LEFT.SHOULDER;
const rightShoulder = pose.RIGHT.SHOULDER;
const leftElbow = pose.LEFT.ELBOW;
const rightElbow = pose.RIGHT.ELBOW;
const leftHip = pose.LEFT.HIP;
const rightHip = pose.RIGHT.HIP;

// Calculate torso length for relative thresholds
const torsoLength = Math.abs(
  ((leftShoulder.y + rightShoulder.y) / 2) - 
  ((leftHip.y + rightHip.y) / 2)
);

// Check 1: Wrists at shoulder height (within tolerance)
const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
const leftWristHeightOk = Math.abs(leftWrist.y - avgShoulderY) < torsoLength * this.config.WRIST_HEIGHT_TOLERANCE;
const rightWristHeightOk = Math.abs(rightWrist.y - avgShoulderY) < torsoLength * this.config.WRIST_HEIGHT_TOLERANCE;

if (!leftWristHeightOk || !rightWristHeightOk) return false;

// Check 2: Wrists extended outward from shoulders
const leftExtended = leftWrist.x < leftShoulder.x - this.config.MIN_ARM_EXTENSION;
const rightExtended = rightWrist.x > rightShoulder.x + this.config.MIN_ARM_EXTENSION;

if (!leftExtended || !rightExtended) return false;

// Check 3: Elbows relatively straight (high geometric angle = straight arm)
const leftElbowAngle = this.calculateElbowAngle3D(leftShoulder, leftElbow, leftWrist);
const rightElbowAngle = this.calculateElbowAngle3D(rightShoulder, rightElbow, rightWrist);

const leftStraight = leftElbowAngle > this.config.MIN_ELBOW_ANGLE;
const rightStraight = rightElbowAngle > this.config.MIN_ELBOW_ANGLE;

if (!leftStraight || !rightStraight) return false;

return true;
```

}

update(pose, timestamp) {
// Check cooldown
if (timestamp - this.state.lastTriggerTime < this.config.COOLDOWN_MS) {
return null;
}

```
if (this.isTPose(pose)) {
  this.state.tPoseFrames++;
  
  const progress = this.state.tPoseFrames / this.config.HOLD_FRAMES;

  if (this.state.tPoseFrames >= this.config.HOLD_FRAMES) {
    this.state.lastTriggerTime = timestamp;
    this.state.tPoseFrames = 0;
    
    return {
      gesture: 'T_POSE',
      confidence: 1.0,
      timestamp
    };
  }

  return {
    gesture: 'T_POSE_HOLDING',
    progress,
    framesRemaining: this.config.HOLD_FRAMES - this.state.tPoseFrames
  };
} else {
  // Reset if pose broken
  this.state.tPoseFrames = 0;
  return null;
}
```

}

reset() {
this.state = {
tPoseFrames: 0,
lastTriggerTime: 0,
currentGesture: null
};
}
}

// ============================================================================
// SECTION 6: VOICE COMMAND SYSTEM
// ============================================================================

class VoiceCommandSystem {
constructor(config = {}) {
this.config = {
onCommand: config.onCommand || (() => {}),
onError: config.onError || console.warn,
onListeningChange: config.onListeningChange || (() => {}),
onTranscript: config.onTranscript || (() => {}),
language: config.language || ‘en-US’,
continuous: config.continuous !== false,
interimResults: config.interimResults !== false
};

```
this.recognition = null;
this.isListening = false;
this.shouldBeListening = false;
this.isSupported = this.checkSupport();

// Intent definitions with keyword matching
this.intents = {
  CALIBRATE: {
    keywords: ['ready', 'calibrate', 'calibration', 'start'],
    phrases: ["i'm ready", "i am ready", "ready", "calibrate", "start calibration"]
  },
  RESET_SIDE: {
    keywords: ['reset', 'switch', 'other', 'side', 'arm'],
    requiredCombos: [
      ['reset', 'side'],
      ['reset'],
      ['switch', 'arm'],
      ['switch'],
      ['other', 'side']
    ]
  }
};

if (this.isSupported) {
  this.initRecognition();
}
```

}

checkSupport() {
return ‘SpeechRecognition’ in window || ‘webkitSpeechRecognition’ in window;
}

initRecognition() {
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
this.recognition = new SpeechRecognition();

```
this.recognition.continuous = this.config.continuous;
this.recognition.interimResults = this.config.interimResults;
this.recognition.lang = this.config.language;

this.recognition.onstart = () => {
  this.isListening = true;
  this.config.onListeningChange(true);
  console.log("🎤 [Voice] Listening started");
};

this.recognition.onend = () => {
  this.isListening = false;
  this.config.onListeningChange(false);
  
  // Auto-restart if should be continuous
  if (this.shouldBeListening && this.config.continuous) {
    setTimeout(() => this.start(), 100);
  }
};

this.recognition.onerror = (event) => {
  // Ignore 'no-speech' and 'aborted' errors in continuous mode
  if (event.error === 'no-speech' || event.error === 'aborted') return;
  
  console.warn("🎤 [Voice] Error:", event.error);
  this.config.onError(event.error);
};

this.recognition.onresult = (event) => {
  const results = event.results;
  
  for (let i = event.resultIndex; i < results.length; i++) {
    const transcript = results[i][0].transcript.toLowerCase().trim();
    const isFinal = results[i].isFinal;
    
    this.config.onTranscript(transcript, isFinal);
    
    if (isFinal) {
      console.log(`🎤 [Voice] Heard: "${transcript}"`);
      const intent = this.matchIntent(transcript);
      if (intent) {
        console.log(`🎤 [Voice] Matched intent: ${intent}`);
        this.config.onCommand(intent, transcript);
      }
    }
  }
};
```

}

matchIntent(transcript) {
const words = transcript.toLowerCase().split(/\s+/);

```
// Check RESET_SIDE first (more specific)
const resetIntent = this.intents.RESET_SIDE;
for (const combo of resetIntent.requiredCombos) {
  if (combo.every(keyword => words.some(word => word.includes(keyword)))) {
    return 'RESET_SIDE';
  }
}

// Check CALIBRATE
const calibrateIntent = this.intents.CALIBRATE;
for (const phrase of calibrateIntent.phrases) {
  if (transcript.includes(phrase)) {
    return 'CALIBRATE';
  }
}

// Fallback: check if "ready" appears standalone
if (words.includes('ready')) {
  return 'CALIBRATE';
}

return null;
```

}

start() {
if (!this.isSupported) {
console.warn(“🎤 [Voice] Speech recognition not supported”);
this.config.onError(‘Speech recognition not supported in this browser’);
return false;
}

```
this.shouldBeListening = true;

try {
  this.recognition.start();
  return true;
} catch (e) {
  // Already started
  return false;
}
```

}

stop() {
this.shouldBeListening = false;

```
if (this.recognition) {
  this.recognition.stop();
}
```

}

isAvailable() {
return this.isSupported;
}
}

// ============================================================================
// SECTION 7: VELOCITY FATIGUE TRACKER
// ============================================================================

class VelocityFatigueTracker {
constructor(config = {}) {
this.config = {
baselineReps: config.baselineReps || 3,
alertThresholds: config.alertThresholds || [10, 20, 30],
movementsToTrack: config.movementsToTrack || [‘PRESS’, ‘CLEAN’, ‘SNATCH’, ‘SWING’],
…config
};
this.reset();
}

reset() {
this.data = {};
for (const movement of this.config.movementsToTrack) {
this.data[movement] = {
velocities: [],
baselineVelocity: null,
currentVelocity: null,
peakVelocity: null,
dropFromBaseline: 0,
dropFromPeak: 0,
thresholdsCrossed: [],
repCount: 0,
fatigueZone: ‘FRESH’
};
}
}

resetSet() {
for (const movement of this.config.movementsToTrack) {
this.data[movement].velocities = [];
this.data[movement].baselineVelocity = null;
this.data[movement].currentVelocity = null;
this.data[movement].dropFromBaseline = 0;
this.data[movement].dropFromPeak = 0;
this.data[movement].thresholdsCrossed = [];
this.data[movement].repCount = 0;
this.data[movement].fatigueZone = ‘FRESH’;
}
}

addRep(movementType, velocity) {
if (!this.data[movementType]) {
console.warn(`[FatigueTracker] Unknown movement type: ${movementType}`);
return null;
}

```
const data = this.data[movementType];
data.velocities.push(velocity);
data.currentVelocity = velocity;
data.repCount++;

if (!data.peakVelocity || velocity > data.peakVelocity) {
  data.peakVelocity = velocity;
}

if (data.repCount === this.config.baselineReps) {
  data.baselineVelocity = this.calculateAverage(data.velocities);
  console.log(`📊 [FatigueTracker] ${movementType} baseline: ${data.baselineVelocity.toFixed(2)} m/s`);
}

if (data.baselineVelocity) {
  data.dropFromBaseline = this.calculatePercentDrop(data.baselineVelocity, velocity);
  data.dropFromPeak = this.calculatePercentDrop(data.peakVelocity, velocity);
  this.checkThresholds(movementType, data);
  data.fatigueZone = this.determineFatigueZone(data.dropFromBaseline);
}

return this.getStatus(movementType);
```

}

calculatePercentDrop(reference, current) {
if (!reference || reference === 0) return 0;
const drop = ((reference - current) / reference) * 100;
return Math.max(0, drop);
}

calculateAverage(arr) {
if (arr.length === 0) return 0;
return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

checkThresholds(movementType, data) {
for (const threshold of this.config.alertThresholds) {
if (data.dropFromBaseline >= threshold && !data.thresholdsCrossed.includes(threshold)) {
data.thresholdsCrossed.push(threshold);
this.onThresholdCrossed(movementType, threshold, data);
}
}
}

onThresholdCrossed(movementType, threshold, data) {
const messages = {
10: ‘⚠️ MILD FATIGUE - 10% velocity drop’,
20: ‘🟠 MODERATE FATIGUE - 20% drop (anaerobic threshold zone)’,
30: ‘🔴 HIGH FATIGUE - 30% drop (lactate threshold exceeded)’
};
console.log(`${messages[threshold] || threshold + '% drop'} | ${movementType} | Rep ${data.repCount}`);
}

determineFatigueZone(dropPercent) {
if (dropPercent < 5) return ‘FRESH’;
if (dropPercent < 10) return ‘MILD’;
if (dropPercent < 20) return ‘MODERATE’;
if (dropPercent < 30) return ‘HIGH’;
return ‘CRITICAL’;
}

getStatus(movementType) {
const data = this.data[movementType];
if (!data) return null;
return {
movementType,
repCount: data.repCount,
currentVelocity: data.currentVelocity,
baselineVelocity: data.baselineVelocity,
peakVelocity: data.peakVelocity,
dropFromBaseline: data.dropFromBaseline,
dropFromPeak: data.dropFromPeak,
fatigueZone: data.fatigueZone,
thresholdsCrossed: data.thresholdsCrossed,
hasBaseline: data.baselineVelocity !== null,
velocityHistory: […data.velocities]
};
}

predictRepsToThreshold(movementType, targetDropPercent = 20) {
const data = this.data[movementType];
if (!data || !data.baselineVelocity || data.velocities.length < 3) return null;

```
const n = data.velocities.length;
const xMean = (n + 1) / 2;
const yMean = this.calculateAverage(data.velocities);

let numerator = 0, denominator = 0;
for (let i = 0; i < n; i++) {
  numerator += (i + 1 - xMean) * (data.velocities[i] - yMean);
  denominator += (i + 1 - xMean) ** 2;
}

if (denominator === 0) return null;
const slope = numerator / denominator;
if (slope >= 0) return null;

const targetVelocity = data.baselineVelocity * (1 - targetDropPercent / 100);
const intercept = yMean - slope * xMean;
const predictedRep = (targetVelocity - intercept) / slope;

return {
  repsRemaining: Math.max(0, Math.ceil(predictedRep - n)),
  predictedRepNumber: Math.ceil(predictedRep),
  currentRep: n
};
```

}
}

// ============================================================================
// SECTION 8: SET TIMING TRACKER
// ============================================================================

class SetTimingTracker {
constructor() {
this.reset();
}

reset() {
this.currentSet = {
number: 0,
startTime: null,
endTime: null,
repCount: 0,
isActive: false
};

```
this.restTimer = {
  startTime: null,
  isRunning: false,
  elapsed: 0
};

this.history = [];

this.session = {
  totalWorkTime: 0,
  totalRestTime: 0,
  avgWorkTime: 0,
  avgRestTime: 0,
  avgWorkRestRatio: 0,
  setCount: 0
};
```

}

onRep() {
if (this.restTimer.isRunning) {
this.stopRestTimer();
this.startNewSet();
}

```
if (!this.currentSet.isActive) {
  this.startNewSet();
}

this.currentSet.repCount++;
return this.getStatus();
```

}

startNewSet() {
this.currentSet = {
number: this.session.setCount + 1,
startTime: Date.now(),
endTime: null,
repCount: 0,
isActive: true
};
console.log(`🏋️ [TimingTracker] Set ${this.currentSet.number} started`);
}

onSetEnd() {
if (!this.currentSet.isActive || this.currentSet.repCount === 0) {
return null;
}

```
const now = Date.now();
this.currentSet.endTime = now;
this.currentSet.isActive = false;

const setDuration = this.currentSet.endTime - this.currentSet.startTime;

let restBeforeSet = 0;
if (this.history.length > 0) {
  const lastSet = this.history[this.history.length - 1];
  restBeforeSet = this.currentSet.startTime - lastSet.endTime;
}

const completedSet = {
  number: this.currentSet.number,
  duration: setDuration,
  repCount: this.currentSet.repCount,
  restBefore: restBeforeSet,
  workRestRatio: restBeforeSet > 0 ? setDuration / restBeforeSet : 0,
  startTime: this.currentSet.startTime,
  endTime: this.currentSet.endTime
};

this.history.push(completedSet);

this.session.setCount++;
this.session.totalWorkTime += setDuration;
if (restBeforeSet > 0) {
  this.session.totalRestTime += restBeforeSet;
}

this.updateSessionAverages();

console.log(`✅ [TimingTracker] Set ${completedSet.number}: ${(setDuration/1000).toFixed(1)}s, ${completedSet.repCount} reps`);

this.startRestTimer();

return completedSet;
```

}

startRestTimer() {
this.restTimer = {
startTime: Date.now(),
isRunning: true,
elapsed: 0
};
console.log(‘⏱️ [TimingTracker] Rest timer started’);
}

stopRestTimer() {
if (!this.restTimer.isRunning) return;
this.restTimer.elapsed = Date.now() - this.restTimer.startTime;
this.restTimer.isRunning = false;
console.log(`⏱️ [TimingTracker] Rest complete: ${(this.restTimer.elapsed/1000).toFixed(1)}s`);
}

getRestTimerElapsed() {
if (!this.restTimer.isRunning) return this.restTimer.elapsed;
return Date.now() - this.restTimer.startTime;
}

getCurrentSetDuration() {
if (!this.currentSet.isActive || !this.currentSet.startTime) return 0;
return Date.now() - this.currentSet.startTime;
}

updateSessionAverages() {
if (this.session.setCount === 0) return;
this.session.avgWorkTime = this.session.totalWorkTime / this.session.setCount;

```
const setsWithRest = this.history.filter(s => s.restBefore > 0);
if (setsWithRest.length > 0) {
  this.session.avgRestTime = setsWithRest.reduce((sum, s) => sum + s.restBefore, 0) / setsWithRest.length;
  this.session.avgWorkRestRatio = this.session.avgWorkTime / this.session.avgRestTime;
}
```

}

formatTime(ms) {
const totalSeconds = Math.floor(ms / 1000);
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

formatTimeShort(ms) {
return `${(ms / 1000).toFixed(1)}s`;
}

getStatus() {
const restElapsed = this.getRestTimerElapsed();
const setDuration = this.getCurrentSetDuration();

```
return {
  isSetActive: this.currentSet.isActive,
  isResting: this.restTimer.isRunning,
  currentSetNumber: this.currentSet.number || 1,
  currentSetDuration: setDuration,
  currentSetDurationFormatted: this.formatTime(setDuration),
  currentSetReps: this.currentSet.repCount,
  restElapsed: restElapsed,
  restElapsedFormatted: this.formatTime(restElapsed),
  lastSet: this.history.length > 0 ? this.history[this.history.length - 1] : null,
  totalSets: this.session.setCount,
  avgWorkTime: this.session.avgWorkTime,
  avgWorkTimeFormatted: this.formatTimeShort(this.session.avgWorkTime),
  avgRestTime: this.session.avgRestTime,
  avgRestTimeFormatted: this.formatTimeShort(this.session.avgRestTime),
  avgWorkRestRatio: this.session.avgWorkRestRatio,
  avgWorkRestRatioFormatted: this.session.avgWorkRestRatio > 0 
    ? `1:${(1/this.session.avgWorkRestRatio).toFixed(1)}` 
    : '---',
  setHistory: [...this.history]
};
```

}
}

// ============================================================================
// SECTION 9: CALIBRATION SYSTEM (3D ENHANCED)
// ============================================================================

class CalibrationSystem {
constructor() {
this.CALIBRATION_FRAMES = 60;
this.NOSE_TO_HEAD_OFFSET_CM = 11;
this.Z_SCALE = 0.2;

```
this.state = {
  phase: "WAITING_FOR_HEIGHT",
  userHeightInches: null,
  userHeightCm: null,
  ankleToNoseCm: null,
  framesCaptured: 0,
  ankleToNosePixelSamples: [],
  pixelToCmRatio: null,
  bodySegments: {
    torso: null,
    thigh: null,
    shin: null,
    upperArm: null,
    forearm: null,
    ankleToNose: null
  },
  calibrationDepth: null
};
```

}

setUserHeight(inches) {
this.state.userHeightInches = inches;
this.state.userHeightCm = inches * 2.54;
this.state.ankleToNoseCm = this.state.userHeightCm - this.NOSE_TO_HEAD_OFFSET_CM;
this.state.phase = “CAPTURING”;
this.state.framesCaptured = 0;
this.state.ankleToNosePixelSamples = [];

```
console.log(`📏 [Calibration-3D] User Height: ${inches}" = ${this.state.userHeightCm.toFixed(1)}cm`);
console.log(`📏 [Calibration-3D] Ankle-to-Nose (estimated): ${this.state.ankleToNoseCm.toFixed(1)}cm`);

return {
  heightCm: this.state.userHeightCm,
  ankleToNoseCm: this.state.ankleToNoseCm
};
```

}

captureFrame(pose, canvasHeight) {
if (this.state.phase !== “CAPTURING”) return null;
if (!pose.LEFT || !pose.RIGHT) return null;

```
const leftAnkle = pose.LEFT.ANKLE;
const rightAnkle = pose.RIGHT.ANKLE;
const nose = pose.LEFT.NOSE;

if (!leftAnkle || !rightAnkle || !nose) return null;

const avgAnkle = Vector3D.midpoint(leftAnkle, rightAnkle);

const ankleScaled = {
  x: avgAnkle.x * canvasHeight,
  y: avgAnkle.y * canvasHeight,
  z: (avgAnkle.z || 0) * canvasHeight * this.Z_SCALE
};

const noseScaled = {
  x: nose.x * canvasHeight,
  y: nose.y * canvasHeight,
  z: (nose.z || 0) * canvasHeight * this.Z_SCALE
};

const ankleToNosePixels3D = Vector3D.distance(ankleScaled, noseScaled);

const ankleToNose2D = Math.abs(avgAnkle.y - nose.y) * canvasHeight;
if (ankleToNose2D < canvasHeight * 0.3) {
  return { status: "INVALID_POSE", message: "Stand upright facing camera" };
}

this.state.ankleToNosePixelSamples.push(ankleToNosePixels3D);
this.state.framesCaptured++;

const progress = this.state.framesCaptured / this.CALIBRATION_FRAMES;

if (this.state.framesCaptured >= this.CALIBRATION_FRAMES) {
  return this.finalizeCalibration(pose, canvasHeight);
}

return {
  status: "CAPTURING",
  progress: progress,
  framesRemaining: this.CALIBRATION_FRAMES - this.state.framesCaptured
};
```

}

finalizeCalibration(pose, canvasHeight) {
const sortedSamples = […this.state.ankleToNosePixelSamples].sort((a, b) => a - b);
const medianAnkleToNosePixels = sortedSamples[Math.floor(sortedSamples.length / 2)];

```
this.state.pixelToCmRatio = this.state.ankleToNoseCm / medianAnkleToNosePixels;

this.measureBodySegments3D(pose, canvasHeight);

const avgHipZ = (pose.LEFT.HIP.z + pose.RIGHT.HIP.z) / 2;
this.state.calibrationDepth = avgHipZ;

this.state.phase = "COMPLETE";

console.log("✅ [Calibration-3D] Complete!");
console.log(`📏 [Calibration-3D] Ankle-to-Nose (3D): ${medianAnkleToNosePixels.toFixed(1)}px = ${this.state.ankleToNoseCm.toFixed(1)}cm`);
console.log(`📐 [Calibration-3D] Pixel-to-CM Ratio: ${this.state.pixelToCmRatio.toFixed(4)} cm/px`);
console.log("📊 [Calibration-3D] Body Segments:", this.state.bodySegments);

return {
  status: "COMPLETE",
  pixelToCmRatio: this.state.pixelToCmRatio,
  bodySegments: this.state.bodySegments
};
```

}

measureBodySegments3D(pose, canvasHeight) {
const ratio = this.state.pixelToCmRatio;
const zScale = this.Z_SCALE;

```
const distance3DPixels = (a, b) => {
  const aScaled = {
    x: a.x * canvasHeight,
    y: a.y * canvasHeight,
    z: (a.z || 0) * canvasHeight * zScale
  };
  const bScaled = {
    x: b.x * canvasHeight,
    y: b.y * canvasHeight,
    z: (b.z || 0) * canvasHeight * zScale
  };
  return Vector3D.distance(aScaled, bScaled);
};

const avgSegment = (leftA, leftB, rightA, rightB) => {
  const leftDist = distance3DPixels(leftA, leftB);
  const rightDist = distance3DPixels(rightA, rightB);
  return ((leftDist + rightDist) / 2) * ratio;
};

this.state.bodySegments = {
  torso: avgSegment(
    pose.LEFT.SHOULDER, pose.LEFT.HIP,
    pose.RIGHT.SHOULDER, pose.RIGHT.HIP
  ),
  thigh: avgSegment(
    pose.LEFT.HIP, pose.LEFT.KNEE,
    pose.RIGHT.HIP, pose.RIGHT.KNEE
  ),
  shin: avgSegment(
    pose.LEFT.KNEE, pose.LEFT.ANKLE,
    pose.RIGHT.KNEE, pose.RIGHT.ANKLE
  ),
  upperArm: avgSegment(
    pose.LEFT.SHOULDER, pose.LEFT.ELBOW,
    pose.RIGHT.SHOULDER, pose.RIGHT.ELBOW
  ),
  forearm: avgSegment(
    pose.LEFT.ELBOW, pose.LEFT.WRIST,
    pose.RIGHT.ELBOW, pose.RIGHT.WRIST
  ),
  ankleToNose: this.state.ankleToNoseCm
};

return this.state.bodySegments;
```

}

pixelsToCm(pixels) {
if (!this.state.pixelToCmRatio) {
console.warn(”[Calibration-3D] Not complete!”);
return null;
}
return pixels * this.state.pixelToCmRatio;
}

getPixelsPerMeter() {
if (!this.state.pixelToCmRatio) return null;
return 100 / this.state.pixelToCmRatio;
}

getArmLengthCm() {
if (!this.state.bodySegments.upperArm || !this.state.bodySegments.forearm) {
return null;
}
return this.state.bodySegments.upperArm + this.state.bodySegments.forearm;
}

getArmLengthPixels() {
const armCm = this.getArmLengthCm();
if (!armCm || !this.state.pixelToCmRatio) return null;
return armCm / this.state.pixelToCmRatio;
}

getCalibrationDepth() {
return this.state.calibrationDepth;
}

isComplete() {
return this.state.phase === “COMPLETE”;
}

reset() {
this.state = {
phase: “WAITING_FOR_HEIGHT”,
userHeightInches: null,
userHeightCm: null,
ankleToNoseCm: null,
framesCaptured: 0,
ankleToNosePixelSamples: [],
pixelToCmRatio: null,
bodySegments: {
torso: null,
thigh: null,
shin: null,
upperArm: null,
forearm: null,
ankleToNose: null
},
calibrationDepth: null
};
}
}

// ============================================================================
// SECTION 10: VBT STATE MACHINE (3D ENHANCED)
// ============================================================================

class VBTStateMachine {
constructor(canvasHeight = 720, calibrationSystem = null, canvasWidth = null) {
this.canvasHeight = canvasHeight;
this.canvasWidth = canvasWidth || Math.round(canvasHeight * (16/9));
this.calibrationSystem = calibrationSystem;

```
this.filters = {};
this.Z_SCALE = 0.025;

this.THRESHOLDS = {
  RACK_ELBOW_MIN: 130,
  LOCKOUT_ELBOW_MAX: 40,
  RACK_HOLD_FRAMES: 30,
  LOCKOUT_HOLD_FRAMES: 0,
  OVERHEAD_HOLD_FRAMES: 3,
  WRIST_NEAR_SHOULDER: 0.08,
  WRIST_OVERHEAD: 0.10,
  TUCKED_MAX: 0.1,
  ALIGN_MAX: 0.20,
  SNATCH_ARM_EXTENSION_RATIO: 0.80,
  VELOCITY_ALPHA: 0.15,
  ONE_EURO_MIN_CUTOFF: 0.05,
  ONE_EURO_BETA: 0.25,
  MAX_REALISTIC_VELOCITY: 8.0,
  ZERO_BAND: 0.1,
  MIN_DT: 0.016,
  MAX_DT: 0.1,
  RESET_DURATION_FRAMES: 30,
  SNATCH_SETTLING_FRAMES: 1
};

this.calibrationData = {
  isCalibrated: false,
  framesCaptured: 0,
  neutralWristOffset: 0,
  maxTorsoLength: 0
};

this.reset();
```

}

reset() {
this.filters = {};

```
this.state = {
  lockedSide: "unknown",
  phase: "IDLE",
  startedFromRack: false,
  startedBelowHip: false,
  startedFromOverhead: false,
  settlingFrames: 0,
  reachedRack: false,
  reachedOverhead: false,
  reachedLockout: false,
  reachedElbowExtension: false,
  reachedSwingHeight: false,
  wentBelowHip: false,
  elbowStayedExtended: true,
  rackHoldFrames: 15,
  lockoutHoldFrames: 0,
  currentRepPeak: 0,
  smoothedVy: 0,
  smoothedVelocity3D: { vx: 0, vy: 0, vz: 0, speed: 0 },
  lastTimestamp: 0,
  lastWristPos: null,
  calibration: null,
  resetProgress: 0,
  pendingMovement: null,
  smoothedLandmarks: {
    LEFT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null },
    RIGHT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null }
  }
};
```

}

calculateElbowAngle3D(shoulder, elbow, wrist) {
const scalePoint = (p) => ({
x: p.x * this.canvasWidth,
y: p.y * this.canvasHeight,
z: (p.z || 0) * this.canvasWidth * this.Z_SCALE
});

```
const shoulderScaled = scalePoint(shoulder);
const elbowScaled = scalePoint(elbow);
const wristScaled = scalePoint(wrist);

const toShoulder = Vector3D.subtract(shoulderScaled, elbowScaled);
const toWrist = Vector3D.subtract(wristScaled, elbowScaled);

const geometricAngle = Vector3D.angleBetween(toShoulder, toWrist);
const flexionAngle = 180 - geometricAngle;

return flexionAngle;
```

}

calculateElbowAngle(shoulder, elbow, wrist) {
const toShoulder = {
x: (shoulder.x - elbow.x) * this.canvasWidth,
y: (shoulder.y - elbow.y) * this.canvasHeight
};
const toWrist = {
x: (wrist.x - elbow.x) * this.canvasWidth,
y: (wrist.y - elbow.y) * this.canvasHeight
};
const dot = toShoulder.x * toWrist.x + toShoulder.y * toWrist.y;
const magShoulder = Math.hypot(toShoulder.x, toShoulder.y);
const magWrist = Math.hypot(toWrist.x, toWrist.y);

```
if (magShoulder === 0 || magWrist === 0) return 0;

const cosAngle = dot / (magShoulder * magWrist);
const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
const geometricAngle = angleRad * (180 / Math.PI);

return 180 - geometricAngle;
```

}

isWristOverhead3D(wrist, shoulder, nose) {
if (this.calibrationSystem && this.calibrationSystem.isComplete()) {
const armLengthPixels = this.calibrationSystem.getArmLengthPixels();

```
  if (armLengthPixels) {
    const shoulderScaled = {
      x: shoulder.x * this.canvasWidth,
      y: shoulder.y * this.canvasHeight,
      z: (shoulder.z || 0) * this.canvasWidth * this.Z_SCALE
    };
    const wristScaled = {
      x: wrist.x * this.canvasWidth,
      y: wrist.y * this.canvasHeight,
      z: (wrist.z || 0) * this.canvasWidth * this.Z_SCALE
    };
    
    const armExtension3D = Vector3D.distance(shoulderScaled, wristScaled);
    const wristAboveShoulder = wrist.y < shoulder.y;
    const threshold = armLengthPixels * this.THRESHOLDS.SNATCH_ARM_EXTENSION_RATIO;
    const isOverhead3D = armExtension3D > threshold && wristAboveShoulder;
    
    if (isOverhead3D) {
      return true;
    }
  }
}

return wrist.y < (nose.y - this.THRESHOLDS.WRIST_OVERHEAD);
```

}

isSwingHeight(wrist, hip, shoulder, nose) {
const torsoLength = Math.abs(hip.y - shoulder.y);
const navelHeight = hip.y - (torsoLength * 0.30);
const wristAboveNavel = wrist.y < navelHeight;
return wristAboveNavel;
}

smoothLandmarks3D(rawPose, timestamp) {
const smoothed = { LEFT: {}, RIGHT: {} };
const joints = [‘WRIST’, ‘SHOULDER’, ‘HIP’, ‘KNEE’, ‘NOSE’, ‘ANKLE’, ‘ELBOW’];

```
for (const side of ['LEFT', 'RIGHT']) {
  if (!rawPose[side]) continue;
  
  for (const joint of joints) {
    const raw = rawPose[side][joint];
    if (!raw) continue;
    
    const key = `${side}_${joint}`;
    
    if (!this.filters[key]) {
      this.filters[key] = {
        x: new OneEuroFilter(
          this.THRESHOLDS.ONE_EURO_MIN_CUTOFF,
          this.THRESHOLDS.ONE_EURO_BETA
        ),
        y: new OneEuroFilter(
          this.THRESHOLDS.ONE_EURO_MIN_CUTOFF,
          this.THRESHOLDS.ONE_EURO_BETA
        ),
        z: new OneEuroFilter(
          this.THRESHOLDS.ONE_EURO_MIN_CUTOFF,
          this.THRESHOLDS.ONE_EURO_BETA
        )
      };
    }
    
    smoothed[side][joint] = {
      x: this.filters[key].x.filter(raw.x, timestamp),
      y: this.filters[key].y.filter(raw.y, timestamp),
      z: this.filters[key].z.filter(raw.z || 0, timestamp)
    };
  }
}

this.state.smoothedLandmarks = smoothed;
return smoothed;
```

}

calculateVelocity3D(wrist, timestamp) {
if (!this.state.lastWristPos || !this.state.calibration) {
this.state.lastWristPos = {
x: wrist.x,
y: wrist.y,
z: wrist.z || 0,
t: timestamp
};
return { vx: 0, vy: 0, vz: 0, speed: 0 };
}

```
const dt = (timestamp - this.state.lastWristPos.t) / 1000;

if (dt < this.THRESHOLDS.MIN_DT || dt > this.THRESHOLDS.MAX_DT) {
  this.state.lastWristPos = { 
    x: wrist.x, 
    y: wrist.y, 
    z: wrist.z || 0, 
    t: timestamp 
  };
  return { vx: 0, vy: 0, vz: 0, speed: 0 };
}

const dxPx = (wrist.x - this.state.lastWristPos.x) * this.canvasWidth;
const dyPx = (wrist.y - this.state.lastWristPos.y) * this.canvasHeight;
const dzPx = ((wrist.z || 0) - (this.state.lastWristPos.z || 0)) * this.canvasWidth * this.Z_SCALE;

let vx = (dxPx / this.state.calibration) / dt;
let vy = (dyPx / this.state.calibration) / dt;
let vz = (dzPx / this.state.calibration) / dt;

let speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

if (speed < this.THRESHOLDS.ZERO_BAND) {
  speed = 0;
  vx = 0;
  vy = 0;
  vz = 0;
}

speed = Math.min(speed, this.THRESHOLDS.MAX_REALISTIC_VELOCITY);
vy = Math.max(-this.THRESHOLDS.MAX_REALISTIC_VELOCITY, 
     Math.min(this.THRESHOLDS.MAX_REALISTIC_VELOCITY, vy));
vz = Math.max(-this.THRESHOLDS.MAX_REALISTIC_VELOCITY, 
     Math.min(this.THRESHOLDS.MAX_REALISTIC_VELOCITY, vz));

this.state.lastWristPos = { 
  x: wrist.x, 
  y: wrist.y, 
  z: wrist.z || 0, 
  t: timestamp 
};

return { vx, vy, vz, speed };
```

}

getResetProgress() {
return this.state.resetProgress / this.THRESHOLDS.RESET_DURATION_FRAMES;
}

isStandingResetDetected() {
return this.state.resetProgress > this.THRESHOLDS.RESET_DURATION_FRAMES;
}

update(pose, timestamp, ctx, canvas) {
if (!pose.LEFT || !pose.RIGHT) return null;

```
const smoothedPose = this.smoothLandmarks3D(pose, timestamp);

const currentTorso = Math.abs(smoothedPose.LEFT.SHOULDER.y - smoothedPose.LEFT.HIP.y);
const leftWristOffset = smoothedPose.LEFT.WRIST.y - smoothedPose.LEFT.HIP.y;
const rightWristOffset = smoothedPose.RIGHT.WRIST.y - smoothedPose.RIGHT.HIP.y;

if (!this.calibrationData.isCalibrated) {
  this.calibrationData.framesCaptured++;
  this.calibrationData.neutralWristOffset += (leftWristOffset + rightWristOffset) / 2;
  this.calibrationData.maxTorsoLength = Math.max(this.calibrationData.maxTorsoLength, currentTorso);

  if (this.calibrationData.framesCaptured >= 30) {
    this.calibrationData.neutralWristOffset /= 30;
    this.calibrationData.isCalibrated = true;
    console.log("✅ [StateMachine-3D] Pose Calibration Complete");
  }
  return null;
}

// Reset detection - now returns an event instead of calling onStandingReset
const leftAtHome = Math.abs(leftWristOffset - this.calibrationData.neutralWristOffset) < 0.10;
const rightAtHome = Math.abs(rightWristOffset - this.calibrationData.neutralWristOffset) < 0.10;
const isTall = currentTorso > (this.calibrationData.maxTorsoLength * 0.85);

if (leftAtHome && rightAtHome && isTall) {
  this.state.resetProgress++;

  if (this.state.resetProgress > this.THRESHOLDS.RESET_DURATION_FRAMES) {
    // Return standing reset event instead of calling callback
    return { type: 'STANDING_RESET', isReset: true };
  }
} else {
  this.state.resetProgress = 0;
}

// Side lock
if (this.state.lockedSide === "unknown") {
  if (Math.abs(smoothedPose.LEFT.WRIST.y - smoothedPose.RIGHT.WRIST.y) > 0.1) {
    this.state.lockedSide = smoothedPose.LEFT.WRIST.y > smoothedPose.RIGHT.WRIST.y ? "LEFT" : "RIGHT";
    return { type: 'SIDE_LOCKED', side: this.state.lockedSide };
  } else {
    return null;
  }
}

const side = this.state.lockedSide;
const wrist = smoothedPose[side].WRIST;
const elbow = smoothedPose[side].ELBOW;
const shoulder = smoothedPose[side].SHOULDER;
const hip = smoothedPose[side].HIP;
const nose = smoothedPose[side].NOSE;

if (!this.state.calibration) {
  if (this.calibrationSystem && this.calibrationSystem.isComplete()) {
    this.state.calibration = this.calibrationSystem.getPixelsPerMeter();
    console.log(`📐 [StateMachine-3D] Using calibrated px/m: ${this.state.calibration.toFixed(2)}`);
  } else if (shoulder && hip) {
    const TORSO_METERS = 0.45;
    this.state.calibration = (Math.abs(shoulder.y - hip.y) * this.canvasHeight) / TORSO_METERS;
    console.log(`📐 [StateMachine-3D] Using estimated px/m: ${this.state.calibration.toFixed(2)} (legacy)`);
  }
}

const elbowAngle = this.calculateElbowAngle3D(shoulder, elbow, wrist);
const wristBelowHip = wrist.y > hip.y;
const wristNearShoulder = Math.abs(wrist.y - shoulder.y) < this.THRESHOLDS.WRIST_NEAR_SHOULDER;
const wristOverhead = this.isWristOverhead3D(wrist, shoulder, nose);

const inRackPosition = elbowAngle > this.THRESHOLDS.RACK_ELBOW_MIN && 
                      wristNearShoulder && 
                      Math.abs(elbow.x - hip.x) < this.THRESHOLDS.TUCKED_MAX;

const inLockout = elbowAngle < this.THRESHOLDS.LOCKOUT_ELBOW_MAX && 
                  wristOverhead && 
                  Math.abs(shoulder.x - wrist.x) < this.THRESHOLDS.ALIGN_MAX;

const velocity3D = this.calculateVelocity3D(wrist, timestamp);

const alpha = this.THRESHOLDS.VELOCITY_ALPHA;
this.state.smoothedVelocity3D = {
  vx: alpha * velocity3D.vx + (1 - alpha) * this.state.smoothedVelocity3D.vx,
  vy: alpha * velocity3D.vy + (1 - alpha) * this.state.smoothedVelocity3D.vy,
  vz: alpha * velocity3D.vz + (1 - alpha) * this.state.smoothedVelocity3D.vz,
  speed: alpha * velocity3D.speed + (1 - alpha) * this.state.smoothedVelocity3D.speed
};

this.state.smoothedVy = this.state.smoothedVelocity3D.vy;
this.state.lastTimestamp = timestamp;

let result = null;

// State machine logic (unchanged from original)
if (this.state.phase === "IDLE") {
  if (inLockout) {
    this.state.lockoutHoldFrames++;
    if (this.state.lockoutHoldFrames >= this.THRESHOLDS.OVERHEAD_HOLD_FRAMES) {
      this.state.startedFromOverhead = true;
      this.state.startedFromRack = false;
      this.state.startedBelowHip = false;
    }
  } else if (inRackPosition) {
    this.state.rackHoldFrames++;
    this.state.lockoutHoldFrames = 0;
    if (this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
      this.state.startedFromRack = true;
      this.state.startedFromOverhead = false;
      this.state.startedBelowHip = false;
    }
  } else if (wristBelowHip) {
    this.state.rackHoldFrames = 0;
    this.state.lockoutHoldFrames = 0;
    this.state.startedFromRack = false;
    this.state.startedFromOverhead = false;
    this.state.startedBelowHip = true;
  }
  
  if (this.state.startedFromOverhead && !inLockout) {
    this.state.phase = "MOVING";
    this.state.reachedRack = false;
    this.state.reachedOverhead = false;
    this.state.reachedLockout = false;
    this.state.reachedSwingHeight = false;
    this.state.wentBelowHip = false;
    this.state.elbowStayedExtended = true;
    this.state.currentRepPeak = 0;
    this.state.lockoutHoldFrames = 0;
    this.state.rackHoldFrames = 0;
  } else if (this.state.startedFromRack && !inRackPosition) {
    this.state.phase = "MOVING";
    this.state.reachedRack = false;
    this.state.reachedOverhead = false;
    this.state.reachedLockout = false;
    this.state.reachedSwingHeight = false;
    this.state.wentBelowHip = false;
    this.state.elbowStayedExtended = true;
    this.state.currentRepPeak = 0;
    this.state.lockoutHoldFrames = 0;
  } else if (this.state.startedBelowHip && !wristBelowHip) {
    this.state.phase = "MOVING";
    this.state.reachedRack = false;
    this.state.reachedOverhead = false;
    this.state.reachedLockout = false;
    this.state.reachedSwingHeight = false;
    this.state.wentBelowHip = false;
    this.state.elbowStayedExtended = true;
    this.state.currentRepPeak = 0;
    this.state.lockoutHoldFrames = 0;
    this.state.rackHoldFrames = 0;
  }
}

else if (this.state.phase === "MOVING") {
  this.state.currentRepPeak = Math.max(
    this.state.currentRepPeak, 
    this.state.smoothedVelocity3D.speed
  );
  
  if (elbowAngle > this.THRESHOLDS.RACK_ELBOW_MIN) {
    this.state.elbowStayedExtended = false;
  }
  
  if (elbowAngle < this.THRESHOLDS.LOCKOUT_ELBOW_MAX) {
    this.state.reachedElbowExtension = true;
  }
  
  if (wristBelowHip) {
    this.state.wentBelowHip = true;
  }
  
  if (wristOverhead) {
    this.state.reachedOverhead = true;
  }
  
  if (this.isSwingHeight(wrist, hip, shoulder, nose)) {
    this.state.reachedSwingHeight = true;
  }
  
  if (inLockout) {
    this.state.reachedLockout = true;
    this.state.lockoutHoldFrames++;
  } else {
    this.state.lockoutHoldFrames = 0;
  }
  
  if (inRackPosition) {
    this.state.reachedRack = true;
    this.state.rackHoldFrames++;
  } else {
    this.state.rackHoldFrames = 0;
  }
  
  if (this.state.startedFromRack && 
      this.state.reachedLockout && 
      this.state.lockoutHoldFrames >= this.THRESHOLDS.LOCKOUT_HOLD_FRAMES &&
      !this.state.wentBelowHip) {
    this.state.phase = "RETURNING";
    this.state.pendingMovement = "PRESS";
  }
  
  else if ((this.state.startedBelowHip || this.state.startedFromRack || this.state.startedFromOverhead) && 
           this.state.wentBelowHip && 
           this.state.reachedOverhead &&
           this.state.reachedLockout && 
           wristBelowHip) {
    this.state.phase = "RETURNING";
    this.state.pendingMovement = "SNATCH";
  }
  
  else if (this.state.startedBelowHip && 
           !this.state.elbowStayedExtended &&
           this.state.reachedRack && 
           this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
    result = { type: "CLEAN", velocity: this.state.currentRepPeak };
    this.resetForNextRep(true);
  }
  
  else if (this.state.startedFromRack && 
           this.state.wentBelowHip && 
           this.state.reachedRack && 
           this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
    result = { type: "CLEAN", velocity: this.state.currentRepPeak };
    this.resetForNextRep(true);
  }
  
  else if (this.state.startedBelowHip && 
           this.state.reachedSwingHeight &&
           wristBelowHip) {
    result = { type: "SWING", velocity: this.state.currentRepPeak };
    this.resetForNextRep(false);
  }
}

else if (this.state.phase === "RETURNING") {
  this.state.currentRepPeak = Math.max(
    this.state.currentRepPeak, 
    this.state.smoothedVelocity3D.speed
  );
  
  if (this.state.pendingMovement === "PRESS" && inRackPosition) {
    this.state.rackHoldFrames++;
    if (this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
      result = { type: "PRESS", velocity: this.state.currentRepPeak };
      this.resetForNextRep(true);
    }
  }
  
  else if (this.state.pendingMovement === "SNATCH" && wristBelowHip) {
    result = { type: "SNATCH", velocity: this.state.currentRepPeak };
    this.resetForSnatch();
  }
}

else if (this.state.phase === "SETTLING") {
  this.state.settlingFrames++;
  
  if (this.state.settlingFrames >= this.THRESHOLDS.SNATCH_SETTLING_FRAMES) {
    this.state.phase = "IDLE";
    
    if (inLockout) {
      this.state.startedFromOverhead = true;
    } else if (wristBelowHip) {
      this.state.startedBelowHip = true;
    }
  }
}

return result;
```

}

resetForSnatch() {
this.state.phase = “SETTLING”;
this.state.settlingFrames = 0;
this.state.startedFromRack = false;
this.state.startedBelowHip = false;
this.state.startedFromOverhead = false;
this.state.reachedRack = false;
this.state.reachedOverhead = false;
this.state.reachedLockout = false;
this.state.reachedElbowExtension = false;
this.state.reachedSwingHeight = false;
this.state.wentBelowHip = false;
this.state.elbowStayedExtended = true;
this.state.rackHoldFrames = 0;
this.state.lockoutHoldFrames = 0;
this.state.currentRepPeak = 0;
this.state.pendingMovement = null;
}

resetForNextRep(inRack) {
this.state.phase = “IDLE”;
this.state.startedFromRack = inRack;
this.state.startedBelowHip = !inRack;
this.state.startedFromOverhead = false;
this.state.reachedRack = inRack;
this.state.reachedOverhead = false;
this.state.reachedLockout = false;
this.state.reachedElbowExtension = false;
this.state.reachedSwingHeight = false;
this.state.wentBelowHip = false;
this.state.elbowStayedExtended = true;
this.state.rackHoldFrames = inRack ? this.THRESHOLDS.RACK_HOLD_FRAMES : 0;
this.state.lockoutHoldFrames = 0;
this.state.currentRepPeak = 0;
this.state.pendingMovement = null;
}
}

// ============================================================================
// SECTION 11: APP INITIALIZATION
// ============================================================================

const app = {
video: null,
canvas: null,
ctx: null,

landmarker: null,
isModelLoaded: false,

isTestRunning: false,
totalReps: 0,
lastMove: “READY”,
history: { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] },

stateMachine: null,
calibrationSystem: null,
appStateMachine: null,
gestureDetector: null,
voiceSystem: null,

fatigueTracker: null,
timingTracker: null,

// Mobile and camera settings
isMobile: false,
isFrontCamera: true,

// UI state
tPoseProgress: 0,
isVoiceListening: false,
lastTranscript: ‘’
};

/**

- Flip X coordinate for front camera mirroring
- Use when drawing to canvas, not for calculations
  */
  function flipX(x) {
  return app.isFrontCamera ? 1 - x : x;
  }

/**

- Initialize application
  */
  async function initializeApp() {
  // Detect mobile
  app.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

app.video = document.getElementById(“video”);
app.canvas = document.getElementById(“canvas”);
app.ctx = app.canvas.getContext(“2d”);

// Initialize systems
app.calibrationSystem = new CalibrationSystem();
app.fatigueTracker = new VelocityFatigueTracker();
app.timingTracker = new SetTimingTracker();
app.gestureDetector = new GestureDetector();
app.appStateMachine = new AppStateMachine();

// Initialize voice commands
app.voiceSystem = new VoiceCommandSystem({
onCommand: handleVoiceCommand,
onError: (err) => console.warn(‘Voice error:’, err),
onListeningChange: (listening) => {
app.isVoiceListening = listening;
updateVoiceIndicator();
},
onTranscript: (transcript, isFinal) => {
if (isFinal) {
app.lastTranscript = transcript;
updateVoiceIndicator();
}
}
});

// Subscribe to app state changes
app.appStateMachine.subscribe(updateUIForState);

// UI handlers
document.getElementById(“btn-camera”).onclick = startCamera;
document.getElementById(“btn-start-test”).onclick = toggleTest;
document.getElementById(“btn-reset”).onclick = resetSession;

// Height input handler
const heightInput = document.getElementById(“height-input”);
const submitHeightBtn = document.getElementById(“btn-submit-height”);

if (submitHeightBtn) {
submitHeightBtn.onclick = () => {
const heightInches = parseFloat(heightInput.value);
if (heightInches && heightInches > 48 && heightInches < 96) {
audioFeedback.unlock(); // Unlock audio on user interaction
app.appStateMachine.setHeight(heightInches);
} else {
alert(“Please enter a valid height (48-96 inches)”);
}
};
}

// Check if height already stored
if (app.appStateMachine.state.current === AppStates.AWAITING_CALIBRATION) {
document.getElementById(“height-input-container”).style.display = “none”;
}

// Initialize MediaPipe PoseLandmarker
const vision = await FilesetResolver.forVisionTasks(
“https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm”
);

app.landmarker = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath: “https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task”,
delegate: “GPU”
},
runningMode: “VIDEO”
});

app.isModelLoaded = true;
console.log(“✅ [App] MediaPipe PoseLandmarker loaded”);

requestAnimationFrame(masterLoop);
}

// ============================================================================
// SECTION 12: UI UPDATE FUNCTIONS
// ============================================================================

function updateUIForState(state) {
// Update prompt text
const promptEl = document.getElementById(“state-prompt”);
if (promptEl) {
promptEl.textContent = state.prompt;
}

// Show/hide height input
const heightContainer = document.getElementById(“height-input-container”);
if (heightContainer) {
heightContainer.style.display =
state.current === AppStates.NEEDS_HEIGHT_INPUT ? “flex” : “none”;
}

// Update detected movement display
const movementEl = document.getElementById(“detected-movement”);
if (movementEl) {
if (state.current === AppStates.TRACKING) {
movementEl.textContent = app.lastMove;
} else {
movementEl.textContent = state.current.replace(/_/g, ’ ’);
}
}
}

function updateVoiceIndicator() {
const indicator = document.getElementById(“voice-indicator”);
if (!indicator) return;

if (app.isVoiceListening) {
indicator.style.display = “flex”;
indicator.querySelector(”.voice-status”).textContent = “🎤 Listening…”;
if (app.lastTranscript) {
indicator.querySelector(”.voice-transcript”).textContent = `"${app.lastTranscript}"`;
}
} else {
indicator.style.display = “none”;
}
}

function updateCalibrationUI() {
const statusEl = document.getElementById(“calibration-status”);
if (!statusEl) return;

const cal = app.calibrationSystem.state;

if (cal.phase === “WAITING_FOR_HEIGHT”) {
statusEl.innerHTML = “Enter your height to begin calibration”;
} else if (cal.phase === “CAPTURING”) {
statusEl.innerHTML = `Calibrating... Hold T-pose`;
} else if (cal.phase === “COMPLETE”) {
const segments = cal.bodySegments;
const armLength = segments.upperArm + segments.forearm;
statusEl.innerHTML = ` <div style="color: #22c55e; font-weight: bold;">✅ Calibration Complete!</div> <div style="font-size: 12px; margin-top: 8px;"> <div>Arm Length: ${armLength.toFixed(1)}cm</div> </div>`;
}
}

function updateFatigueUI(status, movementType) {
if (!status) return;

const zoneEl = document.getElementById(‘fatigue-zone’);
const dropEl = document.getElementById(‘fatigue-drop’);
const baselineEl = document.getElementById(‘fatigue-baseline’);
const currentEl = document.getElementById(‘fatigue-current’);

if (zoneEl) {
zoneEl.textContent = status.fatigueZone;
zoneEl.className = ’fatigue-zone ’ + status.fatigueZone.toLowerCase();
}

if (dropEl) {
dropEl.textContent = status.hasBaseline
? `${status.dropFromBaseline.toFixed(1)}%`
: ‘Calibrating…’;
}

if (baselineEl) {
baselineEl.textContent = status.baselineVelocity
? `${status.baselineVelocity.toFixed(2)} m/s`
: ‘—’;
}

if (currentEl) {
currentEl.textContent = `${status.currentVelocity.toFixed(2)} m/s`;
}
}

function updateTimingUI() {
if (!app.timingTracker) return;

const status = app.timingTracker.getStatus();

const setNumEl = document.getElementById(‘timing-set-number’);
const setRepsEl = document.getElementById(‘timing-set-reps’);

if (setNumEl) setNumEl.textContent = status.currentSetNumber;
if (setRepsEl) setRepsEl.textContent = status.currentSetReps;

const totalSetsEl = document.getElementById(‘timing-total-sets’);
if (totalSetsEl) totalSetsEl.textContent = status.totalSets;
}

function updateTimerDisplay() {
if (!app.timingTracker) return;

const status = app.timingTracker.getStatus();

const restTimerEl = document.getElementById(‘rest-timer’);
const restLabelEl = document.getElementById(‘rest-timer-label’);

if (restTimerEl) {
if (status.isResting) {
restTimerEl.textContent = status.restElapsedFormatted;
restTimerEl.className = ‘rest-timer resting’;
if (restLabelEl) restLabelEl.textContent = ‘REST’;
} else if (status.isSetActive) {
restTimerEl.textContent = status.currentSetDurationFormatted;
restTimerEl.className = ‘rest-timer working’;
if (restLabelEl) restLabelEl.textContent = ‘WORKING’;
} else {
restTimerEl.textContent = ‘0:00’;
restTimerEl.className = ‘rest-timer’;
if (restLabelEl) restLabelEl.textContent = ‘READY’;
}
}
}

// ============================================================================
// SECTION 13: HELPER FUNCTIONS
// ============================================================================

function handleVoiceCommand(intent, transcript) {
console.log(`🎤 Voice command: ${intent} ("${transcript}")`);

audioFeedback.command();

if (intent === ‘CALIBRATE’ && app.appStateMachine.canAcceptCalibrationTrigger()) {
triggerCalibration();
} else if (intent === ‘RESET_SIDE’ && app.appStateMachine.canAcceptResetCommand()) {
triggerResetSide();
}
}

function triggerCalibration() {
console.log(‘🎯 Triggering calibration’);
audioFeedback.calibrationStart();

// Reset calibration system for fresh capture
app.calibrationSystem.reset();
app.calibrationSystem.setUserHeight(app.appStateMachine.state.userHeightInches);

// Reset gesture detector
app.gestureDetector.reset();

app.appStateMachine.startCalibration();
}

function triggerResetSide() {
console.log(‘🔄 Triggering reset side’);
audioFeedback.setEnd();

// End the current set
if (app.timingTracker) {
app.timingTracker.onSetEnd();
}

// Reset state machine
if (app.stateMachine) {
app.stateMachine.reset();
}

app.appStateMachine.endSet();
updateTimingUI();
}

async function startCamera() {
try {
// Unlock audio on user interaction
audioFeedback.unlock();

```
const constraints = {
  video: {
    facingMode: app.isFrontCamera ? 'user' : 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: false
};

const stream = await navigator.mediaDevices.getUserMedia(constraints);

app.video.onloadedmetadata = () => {
  console.log("✅ [App] Camera loaded:", app.video.videoWidth, "x", app.video.videoHeight);
  app.canvas.width = app.video.videoWidth;
  app.canvas.height = app.video.videoHeight;
  
  // Initialize state machine with canvas dimensions
  app.stateMachine = new VBTStateMachine(app.canvas.height, app.calibrationSystem, app.canvas.width);
  
  document.getElementById("btn-start-test").disabled = false;
  
  // Start voice recognition
  if (app.voiceSystem && app.voiceSystem.isAvailable()) {
    app.voiceSystem.start();
  }
};

app.video.srcObject = stream;
await app.video.play();

console.log("📹 [App] Camera started");
```

} catch (err) {
console.error(”[App] Camera error:”, err);
alert(“Could not access camera: “ + err.message);
}
}

function toggleTest() {
app.isTestRunning = !app.isTestRunning;
document.getElementById(“btn-start-test”).innerText = app.isTestRunning ? “PAUSE” : “START”;
if (app.isTestRunning) {
app.video.play();
} else {
app.video.pause();
}
}

/**

- Main loop - processes video frames and runs pose detection
  */
  async function masterLoop(ts) {
  requestAnimationFrame(masterLoop);

if (app.timingTracker) updateTimerDisplay();

if (!app.isModelLoaded || !app.video.readyState) return;
if (!app.isTestRunning) return;

// Draw video frame (flipped for front camera)
app.ctx.save();
if (app.isFrontCamera) {
app.ctx.scale(-1, 1);
app.ctx.drawImage(app.video, -app.canvas.width, 0, app.canvas.width, app.canvas.height);
} else {
app.ctx.drawImage(app.video, 0, 0, app.canvas.width, app.canvas.height);
}
app.ctx.restore();

const results = app.landmarker.detectForVideo(app.video, ts);

if (results?.landmarks?.length > 0) {
const raw = results.landmarks[0];

```
// Convert to our format
const pose = {
  LEFT: {
    WRIST: { x: raw[15].x, y: raw[15].y, z: raw[15].z || 0 },
    SHOULDER: { x: raw[11].x, y: raw[11].y, z: raw[11].z || 0 },
    HIP: { x: raw[23].x, y: raw[23].y, z: raw[23].z || 0 },
    KNEE: { x: raw[25].x, y: raw[25].y, z: raw[25].z || 0 },
    ANKLE: { x: raw[27].x, y: raw[27].y, z: raw[27].z || 0 },
    NOSE: { x: raw[0].x, y: raw[0].y, z: raw[0].z || 0 },
    ELBOW: { x: raw[13].x, y: raw[13].y, z: raw[13].z || 0 }
  },
  RIGHT: {
    WRIST: { x: raw[16].x, y: raw[16].y, z: raw[16].z || 0 },
    SHOULDER: { x: raw[12].x, y: raw[12].y, z: raw[12].z || 0 },
    HIP: { x: raw[24].x, y: raw[24].y, z: raw[24].z || 0 },
    KNEE: { x: raw[26].x, y: raw[26].y, z: raw[26].z || 0 },
    ANKLE: { x: raw[28].x, y: raw[28].y, z: raw[28].z || 0 },
    NOSE: { x: raw[0].x, y: raw[0].y, z: raw[0].z || 0 },
    ELBOW: { x: raw[14].x, y: raw[14].y, z: raw[14].z || 0 }
  }
};

// Process based on current app state
const currentState = app.appStateMachine.state.current;

if (currentState === AppStates.AWAITING_CALIBRATION || 
    currentState === AppStates.BETWEEN_SETS) {
  // Check for T-pose gesture
  const gestureResult = app.gestureDetector.update(pose, ts);
  
  if (gestureResult?.gesture === 'T_POSE') {
    app.tPoseProgress = 0;
    triggerCalibration();
  } else if (gestureResult?.gesture === 'T_POSE_HOLDING') {
    app.tPoseProgress = gestureResult.progress;
    drawTPoseProgress(pose, gestureResult.progress);
  } else {
    app.tPoseProgress = 0;
  }
  
  drawSkeleton(pose);
}

else if (currentState === AppStates.CALIBRATING) {
  const calResult = app.calibrationSystem.captureFrame(pose, app.canvas.height);
  
  if (calResult) {
    if (calResult.status === 'COMPLETE') {
      audioFeedback.calibrationComplete();
      app.appStateMachine.calibrationComplete();
      updateCalibrationUI();
    } else if (calResult.status === 'CAPTURING') {
      app.appStateMachine.updateCalibrationProgress(calResult.progress);
      drawCalibrationOverlay(pose, calResult.progress);
    }
  }
  
  drawSkeleton(pose);
}

else if (currentState === AppStates.READY_FOR_SET) {
  // Watch for side lock (asymmetric movement)
  if (app.stateMachine) {
    const moveResult = app.stateMachine.update(pose, ts, app.ctx, app.canvas);
    
    if (moveResult?.type === 'SIDE_LOCKED') {
      audioFeedback.setStart();
      app.appStateMachine.lockSide(moveResult.side);
    }
  }
  
  drawSkeleton(pose);
}

else if (currentState === AppStates.TRACKING) {
  if (app.stateMachine) {
    const moveResult = app.stateMachine.update(pose, ts, app.ctx, app.canvas);
    
    if (moveResult) {
      if (moveResult.type === 'STANDING_RESET') {
        // Handle standing reset
        audioFeedback.setEnd();
        if (app.timingTracker) {
          app.timingTracker.onSetEnd();
        }
        app.stateMachine.reset();
        app.appStateMachine.endSet();
        updateTimingUI();
      } else if (moveResult.type === 'SIDE_LOCKED') {
        // Side re-locked after reset
      } else {
        // Rep completed
        record(moveResult);
      }
    }
    
    // Draw reset progress if applicable
    if (app.stateMachine.getResetProgress() > 0) {
      drawResetProgress(pose);
    }
  }
  
  drawSkeleton(pose);
  drawDebugInfo();
}
```

}
}

function record(m) {
app.totalReps++;
app.lastMove = m.type;
app.history[m.type].push(m.velocity);

audioFeedback.rep();

if (app.fatigueTracker) {
const fatigueStatus = app.fatigueTracker.addRep(m.type, m.velocity);
updateFatigueUI(fatigueStatus, m.type);
}

if (app.timingTracker) {
app.timingTracker.onRep();
updateTimingUI();
}

let plural = m.type.toLowerCase() + “s”;
if (m.type === “PRESS”) plural = “presses”;
if (m.type === “SNATCH”) plural = “snatches”;

const countEl = document.getElementById(`val-${plural}`);
const velEl = document.getElementById(`val-${m.type.toLowerCase()}-velocity`);

if (countEl) countEl.innerText = app.history[m.type].length;
if (velEl) velEl.innerText = m.velocity.toFixed(2);

document.getElementById(“val-total-reps”).innerText = app.totalReps;
document.getElementById(“detected-movement”).innerText = m.type;
document.getElementById(“val-velocity”).innerText = m.velocity.toFixed(2);
}

function resetSession() {
app.totalReps = 0;
app.lastMove = “READY”;
app.history = { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] };

if (app.stateMachine) app.stateMachine.reset();
if (app.fatigueTracker) app.fatigueTracker.reset();
if (app.timingTracker) app.timingTracker.reset();
if (app.gestureDetector) app.gestureDetector.reset();

[‘val-cleans’, ‘val-presses’, ‘val-snatches’, ‘val-swings’, ‘val-total-reps’].forEach(id => {
const el = document.getElementById(id);
if (el) el.textContent = ‘0’;
});

[‘val-clean-velocity’, ‘val-press-velocity’, ‘val-snatch-velocity’, ‘val-swing-velocity’, ‘val-velocity’].forEach(id => {
const el = document.getElementById(id);
if (el) el.textContent = ‘0.00’;
});

document.getElementById(“detected-movement”).innerText = “READY”;

const zoneEl = document.getElementById(‘fatigue-zone’);
if (zoneEl) {
zoneEl.textContent = ‘FRESH’;
zoneEl.className = ‘fatigue-zone fresh’;
}

console.log(“🔄 [App] Session reset”);
}

// Drawing functions

function drawSkeleton(pose) {
const ctx = app.ctx;
const canvas = app.canvas;
const flip = flipX;

const workingSide = app.stateMachine?.state?.lockedSide || “unknown”;

for (const side of [‘LEFT’, ‘RIGHT’]) {
const isWorkingArm = side === workingSide;
const color = side === ‘LEFT’ ? ‘#00ff00’ : ‘#ff0000’;
const wrist = pose[side].WRIST;
const elbow = pose[side].ELBOW;
const shoulder = pose[side].SHOULDER;
const hip = pose[side].HIP;
const knee = pose[side].KNEE;
const ankle = pose[side].ANKLE;

```
ctx.strokeStyle = color;
ctx.lineWidth = isWorkingArm ? 8 : 3;
ctx.beginPath();
ctx.moveTo(flip(wrist.x) * canvas.width, wrist.y * canvas.height);
ctx.lineTo(flip(elbow.x) * canvas.width, elbow.y * canvas.height);
ctx.lineTo(flip(shoulder.x) * canvas.width, shoulder.y * canvas.height);
ctx.lineTo(flip(hip.x) * canvas.width, hip.y * canvas.height);
ctx.lineTo(flip(knee.x) * canvas.width, knee.y * canvas.height);
ctx.lineTo(flip(ankle.x) * canvas.width, ankle.y * canvas.height);
ctx.stroke();

// Draw joints
const joints = [wrist, elbow, shoulder, hip, knee, ankle];
for (const joint of joints) {
  const baseRadius = isWorkingArm ? 12 : 8;
  ctx.beginPath();
  ctx.arc(flip(joint.x) * canvas.width, joint.y * canvas.height, baseRadius, 0, Math.PI * 2);
  ctx.stroke();
}
```

}

// Face emoji
const nose = pose.LEFT.NOSE;
const leftShoulder = pose.LEFT.SHOULDER;
const rightShoulder = pose.RIGHT.SHOULDER;
const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) * canvas.width;
const headSize = shoulderWidth * 1.25;

ctx.font = `${headSize}px Arial`;
ctx.textAlign = ‘center’;
ctx.textBaseline = ‘middle’;
ctx.fillText(‘🙂’, flip(nose.x) * canvas.width, nose.y * canvas.height);
}

function drawTPoseProgress(pose, progress) {
const ctx = app.ctx;
const canvas = app.canvas;
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

// Background circle
ctx.beginPath();
ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
ctx.strokeStyle = ‘rgba(255,255,255,0.3)’;
ctx.lineWidth = 12;
ctx.stroke();

// Progress arc
ctx.beginPath();
ctx.arc(centerX, centerY, 80, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
ctx.strokeStyle = ‘#22c55e’;
ctx.stroke();

// Text
ctx.fillStyle = ‘#fff’;
ctx.strokeStyle = ‘#000’;
ctx.lineWidth = 4;
ctx.font = ‘bold 24px sans-serif’;
ctx.textAlign = ‘center’;
ctx.strokeText(‘HOLD T-POSE’, centerX, centerY - 10);
ctx.fillText(‘HOLD T-POSE’, centerX, centerY - 10);
ctx.font = ‘20px sans-serif’;
ctx.strokeText(`${Math.round(progress * 100)}%`, centerX, centerY + 20);
ctx.fillText(`${Math.round(progress * 100)}%`, centerX, centerY + 20);
}

function drawCalibrationOverlay(pose, progress) {
const ctx = app.ctx;
const canvas = app.canvas;
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

// Background circle
ctx.beginPath();
ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
ctx.strokeStyle = ‘rgba(255,255,255,0.2)’;
ctx.lineWidth = 10;
ctx.stroke();

// Progress arc
ctx.beginPath();
ctx.arc(centerX, centerY, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
ctx.strokeStyle = ‘#22c55e’;
ctx.stroke();

// Text
ctx.fillStyle = ‘#fff’;
ctx.strokeStyle = ‘#000’;
ctx.lineWidth = 3;
ctx.font = ‘bold 20px sans-serif’;
ctx.textAlign = ‘center’;
ctx.strokeText(‘CALIBRATING’, centerX, centerY - 5);
ctx.fillText(‘CALIBRATING’, centerX, centerY - 5);
ctx.font = ‘16px sans-serif’;
ctx.strokeText(`${Math.round(progress * 100)}%`, centerX, centerY + 15);
ctx.fillText(`${Math.round(progress * 100)}%`, centerX, centerY + 15);

// Draw calibration line from ankle to nose
const nose = pose.LEFT.NOSE;
const leftAnkle = pose.LEFT.ANKLE;
const rightAnkle = pose.RIGHT.ANKLE;
const avgAnkleX = (leftAnkle.x + rightAnkle.x) / 2;
const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;

ctx.strokeStyle = ‘#22c55e’;
ctx.lineWidth = 3;
ctx.setLineDash([10, 5]);
ctx.beginPath();
ctx.moveTo(flipX(avgAnkleX) * canvas.width, avgAnkleY * canvas.height);
ctx.lineTo(flipX(nose.x) * canvas.width, nose.y * canvas.height);
ctx.stroke();
ctx.setLineDash([]);
}

function drawResetProgress(pose) {
if (!app.stateMachine) return;

const ctx = app.ctx;
const canvas = app.canvas;
const progress = app.stateMachine.getResetProgress();

if (progress <= 0) return;

const centerX = (flipX(pose.LEFT.SHOULDER.x) + flipX(pose.RIGHT.SHOULDER.x)) / 2 * canvas.width;
const centerY = (pose.LEFT.SHOULDER.y + pose.LEFT.HIP.y) / 2 * canvas.height;

// Background circle
ctx.beginPath();
ctx.arc(centerX, centerY, 40, 0, Math.PI * 2);
ctx.strokeStyle = ‘rgba(255,255,255,0.2)’;
ctx.lineWidth = 8;
ctx.stroke();

// Progress arc
ctx.beginPath();
ctx.arc(centerX, centerY, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(progress, 1));
ctx.strokeStyle = ‘#3b82f6’;
ctx.stroke();

// Text
ctx.fillStyle = ‘#fff’;
ctx.font = ‘bold 14px sans-serif’;
ctx.textAlign = ‘center’;
ctx.fillText(‘RESET’, centerX, centerY + 5);
}

function drawDebugInfo() {
if (!app.stateMachine || !app.stateMachine.state) return;

const ctx = app.ctx;
const s = app.stateMachine.state;

ctx.fillStyle = ‘#fff’;
ctx.strokeStyle = ‘#000’;
ctx.lineWidth = 3;
ctx.font = ‘bold 16px sans-serif’;
ctx.textAlign = ‘left’;

const debugLines = [
`Side: ${s.lockedSide}`,
`Phase: ${s.phase}`,
`Speed: ${s.smoothedVelocity3D?.speed?.toFixed(2) || 0} m/s`
];

debugLines.forEach((line, i) => {
ctx.strokeText(line, 10, 30 + i * 22);
ctx.fillText(line, 10, 30 + i * 22);
});
}

// ============================================================================
// START THE APP
// ============================================================================
initializeApp();