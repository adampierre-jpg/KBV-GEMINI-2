/**

- VBT Kettlebell Tracker - Simplified & Debugged Version
  */

import { PoseLandmarker, FilesetResolver } from “https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs”;

// ============================================================================
// VECTOR 3D UTILITIES
// ============================================================================

const Vector3D = {
subtract(a, b) {
return { x: a.x - b.x, y: a.y - b.y, z: (a.z||0) - (b.z||0) };
},

dot(a, b) {
return a.x * b.x + a.y * b.y + (a.z||0) * (b.z||0);
},

magnitude(v) {
return Math.sqrt(v.x * v.x + v.y * v.y + (v.z||0) * (v.z||0));
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
return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z||0) + (b.z||0)) / 2 };
}
};

// ============================================================================
// ONE EURO FILTER
// ============================================================================

class OneEuroFilter {
constructor(minCutoff = 0.05, beta = 0.25) {
this.minCutoff = minCutoff;
this.beta = beta;
this.x = null;
this.dx = 0;
this.lastTime = null;
}

filter(value, timestamp) {
if (this.x === null) {
this.x = value;
this.lastTime = timestamp;
return value;
}

```
const dt = (timestamp - this.lastTime) / 1000;
if (dt <= 0) return this.x;

const freq = 1 / dt;
const dx = (value - this.x) * freq;
const edx = this.dx + this.alpha(1, freq) * (dx - this.dx);
this.dx = edx;

const cutoff = this.minCutoff + this.beta * Math.abs(edx);
const a = this.alpha(cutoff, freq);
this.x = this.x + a * (value - this.x);
this.lastTime = timestamp;

return this.x;
```

}

alpha(cutoff, freq) {
const tau = 1 / (2 * Math.PI * cutoff);
return 1 / (1 + tau * freq);
}

reset() {
this.x = null;
this.dx = 0;
this.lastTime = null;
}
}

// ============================================================================
// AUDIO FEEDBACK
// ============================================================================

const audio = {
ctx: null,
unlocked: false,

unlock() {
if (!this.ctx) {
this.ctx = new (window.AudioContext || window.webkitAudioContext)();
}
if (this.ctx.state === ‘suspended’) this.ctx.resume();
this.unlocked = true;
console.log(‘🔊 Audio unlocked’);
},

beep(freq = 800, duration = 0.1) {
if (!this.unlocked || !this.ctx) return;
const osc = this.ctx.createOscillator();
const gain = this.ctx.createGain();
osc.connect(gain);
gain.connect(this.ctx.destination);
osc.frequency.value = freq;
gain.gain.value = 0.2;
gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
osc.start();
osc.stop(this.ctx.currentTime + duration);
},

rep() { this.beep(1000, 0.08); },
calibrationStart() { this.beep(440, 0.15); setTimeout(() => this.beep(660, 0.15), 150); },
calibrationComplete() { this.beep(523, 0.1); setTimeout(() => this.beep(784, 0.2), 100); },
setEnd() { this.beep(500, 0.1); setTimeout(() => this.beep(500, 0.1), 150); }
};

// ============================================================================
// GESTURE DETECTOR (T-POSE)
// ============================================================================

class GestureDetector {
constructor() {
this.HOLD_FRAMES = 45; // ~1.5s at 30fps
this.tPoseFrames = 0;
this.lastTrigger = 0;
this.COOLDOWN = 3000;
}

isTPose(pose) {
if (!pose.LEFT || !pose.RIGHT) return false;

```
const lw = pose.LEFT.WRIST;
const rw = pose.RIGHT.WRIST;
const ls = pose.LEFT.SHOULDER;
const rs = pose.RIGHT.SHOULDER;
const le = pose.LEFT.ELBOW;
const re = pose.RIGHT.ELBOW;

// Shoulders Y for reference
const shoulderY = (ls.y + rs.y) / 2;

// Wrists near shoulder height
const lwOk = Math.abs(lw.y - shoulderY) < 0.12;
const rwOk = Math.abs(rw.y - shoulderY) < 0.12;
if (!lwOk || !rwOk) return false;

// Wrists extended outward
const lwOut = lw.x < ls.x - 0.15;
const rwOut = rw.x > rs.x + 0.15;
if (!lwOut || !rwOut) return false;

// Elbows relatively straight (angle close to 180)
const lAngle = this.elbowAngle(ls, le, lw);
const rAngle = this.elbowAngle(rs, re, rw);
if (lAngle < 150 || rAngle < 150) return false;

return true;
```

}

elbowAngle(shoulder, elbow, wrist) {
const toS = Vector3D.subtract(shoulder, elbow);
const toW = Vector3D.subtract(wrist, elbow);
return Vector3D.angleBetween(toS, toW);
}

update(pose, timestamp) {
if (timestamp - this.lastTrigger < this.COOLDOWN) return null;

```
if (this.isTPose(pose)) {
  this.tPoseFrames++;
  if (this.tPoseFrames >= this.HOLD_FRAMES) {
    this.lastTrigger = timestamp;
    this.tPoseFrames = 0;
    return { type: 'T_POSE_COMPLETE' };
  }
  return { type: 'T_POSE_PROGRESS', progress: this.tPoseFrames / this.HOLD_FRAMES };
} else {
  this.tPoseFrames = 0;
  return null;
}
```

}

reset() {
this.tPoseFrames = 0;
}
}

// ============================================================================
// VOICE COMMANDS
// ============================================================================

class VoiceCommands {
constructor(onCommand) {
this.onCommand = onCommand;
this.recognition = null;
this.isListening = false;

```
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  this.recognition = new SR();
  this.recognition.continuous = true;
  this.recognition.interimResults = false;
  this.recognition.lang = 'en-US';
  
  this.recognition.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
    console.log('🎤 Heard:', text);
    if (text.includes('ready') || text.includes('calibrate')) {
      this.onCommand('CALIBRATE');
    } else if (text.includes('reset') || text.includes('switch')) {
      this.onCommand('RESET');
    }
  };
  
  this.recognition.onend = () => {
    if (this.isListening) {
      setTimeout(() => this.recognition.start(), 100);
    }
  };
  
  this.recognition.onerror = () => {}; // Ignore errors
}
```

}

start() {
if (this.recognition && !this.isListening) {
this.isListening = true;
try { this.recognition.start(); } catch(e) {}
console.log(‘🎤 Voice listening started’);
}
}

stop() {
this.isListening = false;
if (this.recognition) this.recognition.stop();
}
}

// ============================================================================
// CALIBRATION SYSTEM
// ============================================================================

class CalibrationSystem {
constructor() {
this.FRAMES_NEEDED = 60;
this.reset();
}

reset() {
this.phase = ‘WAITING’; // WAITING -> CAPTURING -> COMPLETE
this.heightInches = null;
this.heightCm = null;
this.framesCaptured = 0;
this.samples = [];
this.pixelToCm = null;
this.armLengthPx = null;
}

setHeight(inches) {
this.heightInches = inches;
this.heightCm = inches * 2.54;
this.phase = ‘CAPTURING’;
this.framesCaptured = 0;
this.samples = [];
console.log(`📏 Height set: ${inches}" = ${this.heightCm.toFixed(1)}cm`);
}

captureFrame(pose, canvasHeight) {
if (this.phase !== ‘CAPTURING’) return null;
if (!pose.LEFT || !pose.RIGHT) return null;

```
const nose = pose.LEFT.NOSE;
const lAnkle = pose.LEFT.ANKLE;
const rAnkle = pose.RIGHT.ANKLE;

if (!nose || !lAnkle || !rAnkle) return null;

const ankleY = (lAnkle.y + rAnkle.y) / 2;
const heightPx = Math.abs(ankleY - nose.y) * canvasHeight;

// Must be standing upright
if (heightPx < canvasHeight * 0.3) {
  return { status: 'INVALID', message: 'Stand upright' };
}

this.samples.push(heightPx);
this.framesCaptured++;

const progress = this.framesCaptured / this.FRAMES_NEEDED;

if (this.framesCaptured >= this.FRAMES_NEEDED) {
  this.finalize(pose, canvasHeight);
  return { status: 'COMPLETE', progress: 1 };
}

return { status: 'CAPTURING', progress };
```

}

finalize(pose, canvasHeight) {
// Use median
const sorted = […this.samples].sort((a, b) => a - b);
const medianPx = sorted[Math.floor(sorted.length / 2)];

```
// Nose to ankle in cm (subtract ~11cm for nose to top of head)
const ankleToNoseCm = this.heightCm - 11;
this.pixelToCm = ankleToNoseCm / medianPx;

// Measure arm length
const lArm = this.measureArm(pose.LEFT, canvasHeight);
const rArm = this.measureArm(pose.RIGHT, canvasHeight);
this.armLengthPx = (lArm + rArm) / 2;

this.phase = 'COMPLETE';
console.log(`✅ Calibration complete. Pixel-to-cm: ${this.pixelToCm.toFixed(4)}`);
```

}

measureArm(side, canvasHeight) {
const upperArm = Vector3D.distance(
{ x: side.SHOULDER.x * canvasHeight, y: side.SHOULDER.y * canvasHeight, z: 0 },
{ x: side.ELBOW.x * canvasHeight, y: side.ELBOW.y * canvasHeight, z: 0 }
);
const forearm = Vector3D.distance(
{ x: side.ELBOW.x * canvasHeight, y: side.ELBOW.y * canvasHeight, z: 0 },
{ x: side.WRIST.x * canvasHeight, y: side.WRIST.y * canvasHeight, z: 0 }
);
return upperArm + forearm;
}

getPixelsPerMeter() {
return this.pixelToCm ? 100 / this.pixelToCm : null;
}

isComplete() {
return this.phase === ‘COMPLETE’;
}
}

// ============================================================================
// MOVEMENT STATE MACHINE
// ============================================================================

class MovementStateMachine {
constructor(canvasHeight, canvasWidth, calibration) {
this.canvasHeight = canvasHeight;
this.canvasWidth = canvasWidth;
this.calibration = calibration;
this.filters = {};
this.reset();
}

reset() {
this.filters = {};
this.state = {
side: null, // ‘LEFT’ or ‘RIGHT’
phase: ‘IDLE’,
startedFrom: null, // ‘RACK’, ‘BELOW_HIP’, ‘OVERHEAD’
reachedRack: false,
reachedOverhead: false,
reachedLockout: false,
wentBelowHip: false,
elbowStayedExtended: true,
rackFrames: 0,
lockoutFrames: 0,
peakSpeed: 0,
lastWrist: null,
lastTime: null,
smoothedSpeed: 0,
resetProgress: 0
};
}

smoothPose(rawPose, timestamp) {
const smoothed = { LEFT: {}, RIGHT: {} };
const joints = [‘WRIST’, ‘SHOULDER’, ‘HIP’, ‘ELBOW’, ‘KNEE’, ‘ANKLE’, ‘NOSE’];

```
for (const side of ['LEFT', 'RIGHT']) {
  for (const joint of joints) {
    const raw = rawPose[side]?.[joint];
    if (!raw) continue;
    
    const key = `${side}_${joint}`;
    if (!this.filters[key]) {
      this.filters[key] = { x: new OneEuroFilter(), y: new OneEuroFilter(), z: new OneEuroFilter() };
    }
    
    smoothed[side][joint] = {
      x: this.filters[key].x.filter(raw.x, timestamp),
      y: this.filters[key].y.filter(raw.y, timestamp),
      z: this.filters[key].z.filter(raw.z || 0, timestamp)
    };
  }
}

return smoothed;
```

}

calculateElbowFlexion(shoulder, elbow, wrist) {
const toS = {
x: (shoulder.x - elbow.x) * this.canvasWidth,
y: (shoulder.y - elbow.y) * this.canvasHeight
};
const toW = {
x: (wrist.x - elbow.x) * this.canvasWidth,
y: (wrist.y - elbow.y) * this.canvasHeight
};
const dot = toS.x * toW.x + toS.y * toW.y;
const magS = Math.hypot(toS.x, toS.y);
const magW = Math.hypot(toW.x, toW.y);
if (magS === 0 || magW === 0) return 0;
const cos = dot / (magS * magW);
const geometric = Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
return 180 - geometric; // Flexion: 0 = straight, 150 = bent
}

calculateSpeed(wrist, timestamp) {
const ppm = this.calibration.getPixelsPerMeter();
if (!ppm || !this.state.lastWrist || !this.state.lastTime) {
this.state.lastWrist = { x: wrist.x, y: wrist.y, t: timestamp };
this.state.lastTime = timestamp;
return 0;
}

```
const dt = (timestamp - this.state.lastTime) / 1000;
if (dt < 0.016 || dt > 0.1) {
  this.state.lastWrist = { x: wrist.x, y: wrist.y, t: timestamp };
  this.state.lastTime = timestamp;
  return 0;
}

const dx = (wrist.x - this.state.lastWrist.x) * this.canvasWidth;
const dy = (wrist.y - this.state.lastWrist.y) * this.canvasHeight;
const distPx = Math.hypot(dx, dy);
const speed = (distPx / ppm) / dt;

this.state.lastWrist = { x: wrist.x, y: wrist.y, t: timestamp };
this.state.lastTime = timestamp;

return Math.min(speed, 8);
```

}

update(rawPose, timestamp) {
const pose = this.smoothPose(rawPose, timestamp);
if (!pose.LEFT?.WRIST || !pose.RIGHT?.WRIST) return null;

```
// Side detection
if (!this.state.side) {
  const diff = Math.abs(pose.LEFT.WRIST.y - pose.RIGHT.WRIST.y);
  if (diff > 0.1) {
    this.state.side = pose.LEFT.WRIST.y < pose.RIGHT.WRIST.y ? 'LEFT' : 'RIGHT';
    console.log(`🏋️ Side locked: ${this.state.side}`);
    return { type: 'SIDE_LOCKED', side: this.state.side };
  }
  return null;
}

const s = this.state.side;
const wrist = pose[s].WRIST;
const elbow = pose[s].ELBOW;
const shoulder = pose[s].SHOULDER;
const hip = pose[s].HIP;
const nose = pose[s].NOSE;

// Position checks
const flexion = this.calculateElbowFlexion(shoulder, elbow, wrist);
const wristBelowHip = wrist.y > hip.y;
const wristNearShoulder = Math.abs(wrist.y - shoulder.y) < 0.08;
const wristOverhead = wrist.y < nose.y - 0.1;

const inRack = flexion > 130 && wristNearShoulder;
const inLockout = flexion < 40 && wristOverhead;

// Speed
const speed = this.calculateSpeed(wrist, timestamp);
this.state.smoothedSpeed = 0.15 * speed + 0.85 * this.state.smoothedSpeed;

let result = null;

// State machine
if (this.state.phase === 'IDLE') {
  // Detect starting position
  if (inLockout) {
    this.state.lockoutFrames++;
    if (this.state.lockoutFrames > 3) this.state.startedFrom = 'OVERHEAD';
  } else if (inRack) {
    this.state.rackFrames++;
    this.state.lockoutFrames = 0;
    if (this.state.rackFrames > 20) this.state.startedFrom = 'RACK';
  } else if (wristBelowHip) {
    this.state.rackFrames = 0;
    this.state.lockoutFrames = 0;
    this.state.startedFrom = 'BELOW_HIP';
  }
  
  // Start movement
  if (this.state.startedFrom === 'RACK' && !inRack) {
    this.state.phase = 'MOVING';
    this.state.peakSpeed = 0;
    this.resetFlags();
  } else if (this.state.startedFrom === 'BELOW_HIP' && !wristBelowHip) {
    this.state.phase = 'MOVING';
    this.state.peakSpeed = 0;
    this.resetFlags();
  } else if (this.state.startedFrom === 'OVERHEAD' && !inLockout) {
    this.state.phase = 'MOVING';
    this.state.peakSpeed = 0;
    this.resetFlags();
  }
}

else if (this.state.phase === 'MOVING') {
  this.state.peakSpeed = Math.max(this.state.peakSpeed, this.state.smoothedSpeed);
  
  if (flexion > 130) this.state.elbowStayedExtended = false;
  if (wristBelowHip) this.state.wentBelowHip = true;
  if (wristOverhead) this.state.reachedOverhead = true;
  if (inLockout) { this.state.reachedLockout = true; this.state.lockoutFrames++; }
  else this.state.lockoutFrames = 0;
  if (inRack) { this.state.reachedRack = true; this.state.rackFrames++; }
  else this.state.rackFrames = 0;
  
  // PRESS: rack -> lockout -> rack
  if (this.state.startedFrom === 'RACK' && this.state.reachedLockout && 
      this.state.lockoutFrames > 0 && !this.state.wentBelowHip) {
    this.state.phase = 'RETURNING';
    this.state.pendingMove = 'PRESS';
  }
  
  // SNATCH: below/rack -> lockout + below hip
  else if (this.state.wentBelowHip && this.state.reachedLockout && wristBelowHip) {
    result = { type: 'SNATCH', velocity: this.state.peakSpeed };
    this.resetForNext(false);
  }
  
  // CLEAN: below hip -> rack (elbow folded)
  else if (this.state.startedFrom === 'BELOW_HIP' && 
           !this.state.elbowStayedExtended && 
           this.state.reachedRack && this.state.rackFrames > 20) {
    result = { type: 'CLEAN', velocity: this.state.peakSpeed };
    this.resetForNext(true);
  }
  
  // SWING: below hip -> swing height -> below hip
  else if (this.state.startedFrom === 'BELOW_HIP' && 
           this.state.reachedOverhead === false &&
           wrist.y < hip.y - 0.1 && // Above navel area
           this.state.wentBelowHip === false) {
    // Started going up
  } else if (this.state.startedFrom === 'BELOW_HIP' &&
             this.state.elbowStayedExtended &&
             wristBelowHip &&
             this.state.peakSpeed > 0.5) {
    result = { type: 'SWING', velocity: this.state.peakSpeed };
    this.resetForNext(false);
  }
}

else if (this.state.phase === 'RETURNING') {
  this.state.peakSpeed = Math.max(this.state.peakSpeed, this.state.smoothedSpeed);
  
  if (inRack) this.state.rackFrames++;
  else this.state.rackFrames = 0;
  
  if (this.state.pendingMove === 'PRESS' && this.state.rackFrames > 20) {
    result = { type: 'PRESS', velocity: this.state.peakSpeed };
    this.resetForNext(true);
  }
}

return result;
```

}

resetFlags() {
this.state.reachedRack = false;
this.state.reachedOverhead = false;
this.state.reachedLockout = false;
this.state.wentBelowHip = false;
this.state.elbowStayedExtended = true;
this.state.rackFrames = 0;
this.state.lockoutFrames = 0;
}

resetForNext(inRack) {
this.state.phase = ‘IDLE’;
this.state.startedFrom = inRack ? ‘RACK’ : ‘BELOW_HIP’;
this.state.rackFrames = inRack ? 20 : 0;
this.resetFlags();
if (inRack) this.state.reachedRack = true;
this.state.peakSpeed = 0;
this.state.pendingMove = null;
}

getLockedSide() {
return this.state.side;
}

getCurrentSpeed() {
return this.state.smoothedSpeed;
}
}

// ============================================================================
// MAIN APP
// ============================================================================

const app = {
video: null,
canvas: null,
ctx: null,
landmarker: null,

calibration: null,
gesture: null,
voice: null,
movement: null,

// State
appState: ‘INIT’, // INIT -> HEIGHT -> CALIBRATING -> READY -> TRACKING
isRunning: false,
isFrontCamera: true,

// Stats
totalReps: 0,
history: { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] },

// Timing
setStartTime: null,
restStartTime: null,
currentSetReps: 0,
setNumber: 1
};

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
console.log(‘🚀 Initializing VBT app…’);

// Get elements
app.video = document.getElementById(‘video’);
app.canvas = document.getElementById(‘canvas’);
app.ctx = app.canvas.getContext(‘2d’);

// Initialize systems
app.calibration = new CalibrationSystem();
app.gesture = new GestureDetector();

// Voice commands
app.voice = new VoiceCommands((cmd) => {
if (cmd === ‘CALIBRATE’ && (app.appState === ‘READY_FOR_CAL’ || app.appState === ‘BETWEEN_SETS’)) {
startCalibration();
} else if (cmd === ‘RESET’ && app.appState === ‘TRACKING’) {
endSet();
}
});

// Check for stored height
const storedHeight = localStorage.getItem(‘vbt_height’);
if (storedHeight) {
app.appState = ‘READY_FOR_CAL’;
app.calibration.heightInches = parseFloat(storedHeight);
document.getElementById(‘height-modal’).classList.add(‘hidden’);
updatePrompt(‘Start camera, then T-pose to calibrate’);
} else {
app.appState = ‘HEIGHT’;
updatePrompt(‘Enter your height to begin’);
}

// Button handlers
document.getElementById(‘btn-height-submit’).onclick = submitHeight;
document.getElementById(‘btn-camera’).onclick = startCamera;
document.getElementById(‘btn-start’).onclick = toggleRunning;
document.getElementById(‘btn-reset’).onclick = resetSession;

// Load MediaPipe
console.log(‘Loading MediaPipe…’);
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

console.log(‘✅ MediaPipe loaded’);

// Start render loop
requestAnimationFrame(loop);
}

function submitHeight() {
const input = document.getElementById(‘height-input’);
const inches = parseFloat(input.value);

if (!inches || inches < 48 || inches > 96) {
alert(‘Please enter a valid height (48-96 inches)’);
return;
}

audio.unlock();
localStorage.setItem(‘vbt_height’, inches.toString());
app.calibration.heightInches = inches;
app.appState = ‘READY_FOR_CAL’;

document.getElementById(‘height-modal’).classList.add(‘hidden’);
updatePrompt(‘Start camera, then T-pose to calibrate’);
console.log(`📏 Height saved: ${inches}"`);
}

async function startCamera() {
audio.unlock();

try {
const stream = await navigator.mediaDevices.getUserMedia({
video: { facingMode: ‘user’, width: { ideal: 1280 }, height: { ideal: 720 } }
});

```
app.video.srcObject = stream;
await app.video.play();

app.canvas.width = app.video.videoWidth;
app.canvas.height = app.video.videoHeight;

document.getElementById('btn-start').disabled = false;
document.getElementById('btn-camera').disabled = true;

// Start voice
app.voice.start();

console.log(`📹 Camera started: ${app.canvas.width}x${app.canvas.height}`);
updatePrompt('Press START, then T-pose to calibrate');
```

} catch (err) {
console.error(‘Camera error:’, err);
alert(’Could not access camera: ’ + err.message);
}
}

function toggleRunning() {
app.isRunning = !app.isRunning;
document.getElementById(‘btn-start’).textContent = app.isRunning ? ‘PAUSE’ : ‘START’;

if (app.isRunning) {
app.video.play();
if (app.appState === ‘READY_FOR_CAL’) {
updatePrompt(‘T-pose to calibrate, or say “ready”’);
}
} else {
app.video.pause();
}
}

function startCalibration() {
if (!app.calibration.heightInches) return;

app.appState = ‘CALIBRATING’;
app.calibration.setHeight(app.calibration.heightInches);
app.gesture.reset();

audio.calibrationStart();
showCalibrationOverlay(true);
updatePrompt(‘Hold still…’);
console.log(‘🎯 Starting calibration’);
}

function finishCalibration() {
app.appState = ‘READY’;

// Initialize movement tracker
app.movement = new MovementStateMachine(
app.canvas.height,
app.canvas.width,
app.calibration
);

audio.calibrationComplete();
showCalibrationOverlay(false);
updatePrompt(‘Pick up kettlebell - tracking starts when you move’);
console.log(‘✅ Calibration complete, ready to track’);
}

function endSet() {
app.appState = ‘BETWEEN_SETS’;

if (app.movement) {
app.movement.reset();
}

app.restStartTime = Date.now();
app.setNumber++;
app.currentSetReps = 0;

audio.setEnd();
updatePrompt(‘Set complete. T-pose to start next set’);
console.log(‘⏹️ Set ended’);
}

function recordRep(move) {
app.totalReps++;
app.currentSetReps++;
app.history[move.type].push(move.velocity);

if (!app.setStartTime) {
app.setStartTime = Date.now();
}

audio.rep();

// Update UI
document.getElementById(‘val-total-reps’).textContent = app.totalReps;
document.getElementById(‘detected-movement’).textContent = move.type;
document.getElementById(‘val-velocity’).textContent = move.velocity.toFixed(2);

const typeKey = move.type.toLowerCase() + ‘s’;
const countEl = document.getElementById(`val-${typeKey === 'presss' ? 'presses' : typeKey === 'snatchs' ? 'snatches' : typeKey}`);
if (countEl) countEl.textContent = app.history[move.type].length;

console.log(`✅ ${move.type}: ${move.velocity.toFixed(2)} m/s`);
}

function resetSession() {
app.totalReps = 0;
app.history = { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] };
app.setNumber = 1;
app.currentSetReps = 0;
app.setStartTime = null;
app.restStartTime = null;

if (app.movement) app.movement.reset();
if (app.gesture) app.gesture.reset();

app.appState = ‘READY_FOR_CAL’;
app.calibration.reset();
app.calibration.heightInches = parseFloat(localStorage.getItem(‘vbt_height’));

// Reset UI
document.getElementById(‘val-total-reps’).textContent = ‘0’;
document.getElementById(‘val-cleans’).textContent = ‘0’;
document.getElementById(‘val-presses’).textContent = ‘0’;
document.getElementById(‘val-snatches’).textContent = ‘0’;
document.getElementById(‘val-swings’).textContent = ‘0’;
document.getElementById(‘val-velocity’).textContent = ‘0.00’;
document.getElementById(‘detected-movement’).textContent = ‘READY’;
document.getElementById(‘timing-set-number’).textContent = ‘1’;
document.getElementById(‘timing-set-reps’).textContent = ‘0’;

showCalibrationOverlay(false);
updatePrompt(‘T-pose to calibrate’);
console.log(‘🔄 Session reset’);
}

// ============================================================================
// MAIN LOOP
// ============================================================================

function loop(timestamp) {
requestAnimationFrame(loop);

// Update timer
updateTimer();

if (!app.isRunning || !app.landmarker || app.video.readyState < 2) return;

// Draw video (mirrored)
app.ctx.save();
if (app.isFrontCamera) {
app.ctx.scale(-1, 1);
app.ctx.drawImage(app.video, -app.canvas.width, 0);
} else {
app.ctx.drawImage(app.video, 0, 0);
}
app.ctx.restore();

// Run pose detection
const results = app.landmarker.detectForVideo(app.video, timestamp);

if (!results?.landmarks?.length) return;

const raw = results.landmarks[0];
const pose = convertPose(raw);

// Draw skeleton
drawSkeleton(pose);

// Process based on state
if (app.appState === ‘READY_FOR_CAL’ || app.appState === ‘BETWEEN_SETS’) {
// Check for T-pose
const gestureResult = app.gesture.update(pose, timestamp);

```
if (gestureResult?.type === 'T_POSE_COMPLETE') {
  startCalibration();
} else if (gestureResult?.type === 'T_POSE_PROGRESS') {
  drawTPoseProgress(gestureResult.progress);
}
```

}

else if (app.appState === ‘CALIBRATING’) {
const calResult = app.calibration.captureFrame(pose, app.canvas.height);

```
if (calResult?.status === 'COMPLETE') {
  finishCalibration();
} else if (calResult?.status === 'CAPTURING') {
  updateCalibrationProgress(calResult.progress);
}
```

}

else if (app.appState === ‘READY’) {
// Watch for side lock
if (app.movement) {
const moveResult = app.movement.update(pose, timestamp);

```
  if (moveResult?.type === 'SIDE_LOCKED') {
    app.appState = 'TRACKING';
    app.setStartTime = Date.now();
    updatePrompt(`Tracking ${moveResult.side} arm`);
  }
}
```

}

else if (app.appState === ‘TRACKING’) {
if (app.movement) {
const moveResult = app.movement.update(pose, timestamp);

```
  if (moveResult && moveResult.type !== 'SIDE_LOCKED') {
    recordRep(moveResult);
  }
  
  // Update speed display
  document.getElementById('val-velocity').textContent = app.movement.getCurrentSpeed().toFixed(2);
  
  // Update set reps
  document.getElementById('timing-set-reps').textContent = app.currentSetReps;
  document.getElementById('timing-set-number').textContent = app.setNumber;
}
```

}
}

// ============================================================================
// HELPERS
// ============================================================================

function convertPose(raw) {
return {
LEFT: {
WRIST: { x: raw[15].x, y: raw[15].y, z: raw[15].z || 0 },
ELBOW: { x: raw[13].x, y: raw[13].y, z: raw[13].z || 0 },
SHOULDER: { x: raw[11].x, y: raw[11].y, z: raw[11].z || 0 },
HIP: { x: raw[23].x, y: raw[23].y, z: raw[23].z || 0 },
KNEE: { x: raw[25].x, y: raw[25].y, z: raw[25].z || 0 },
ANKLE: { x: raw[27].x, y: raw[27].y, z: raw[27].z || 0 },
NOSE: { x: raw[0].x, y: raw[0].y, z: raw[0].z || 0 }
},
RIGHT: {
WRIST: { x: raw[16].x, y: raw[16].y, z: raw[16].z || 0 },
ELBOW: { x: raw[14].x, y: raw[14].y, z: raw[14].z || 0 },
SHOULDER: { x: raw[12].x, y: raw[12].y, z: raw[12].z || 0 },
HIP: { x: raw[24].x, y: raw[24].y, z: raw[24].z || 0 },
KNEE: { x: raw[26].x, y: raw[26].y, z: raw[26].z || 0 },
ANKLE: { x: raw[28].x, y: raw[28].y, z: raw[28].z || 0 },
NOSE: { x: raw[0].x, y: raw[0].y, z: raw[0].z || 0 }
}
};
}

function flipX(x) {
return app.isFrontCamera ? 1 - x : x;
}

function drawSkeleton(pose) {
const ctx = app.ctx;
const w = app.canvas.width;
const h = app.canvas.height;

const lockedSide = app.movement?.getLockedSide();

for (const side of [‘LEFT’, ‘RIGHT’]) {
const p = pose[side];
const isActive = side === lockedSide;
const color = side === ‘LEFT’ ? ‘#00ff00’ : ‘#ff0000’;

```
ctx.strokeStyle = color;
ctx.lineWidth = isActive ? 6 : 3;

// Draw arm
ctx.beginPath();
ctx.moveTo(flipX(p.WRIST.x) * w, p.WRIST.y * h);
ctx.lineTo(flipX(p.ELBOW.x) * w, p.ELBOW.y * h);
ctx.lineTo(flipX(p.SHOULDER.x) * w, p.SHOULDER.y * h);
ctx.lineTo(flipX(p.HIP.x) * w, p.HIP.y * h);
ctx.lineTo(flipX(p.KNEE.x) * w, p.KNEE.y * h);
ctx.lineTo(flipX(p.ANKLE.x) * w, p.ANKLE.y * h);
ctx.stroke();

// Draw joints
const joints = [p.WRIST, p.ELBOW, p.SHOULDER, p.HIP, p.KNEE, p.ANKLE];
for (const j of joints) {
  ctx.beginPath();
  ctx.arc(flipX(j.x) * w, j.y * h, isActive ? 8 : 5, 0, Math.PI * 2);
  ctx.stroke();
}
```

}

// Face
const nose = pose.LEFT.NOSE;
ctx.font = ‘40px Arial’;
ctx.textAlign = ‘center’;
ctx.fillText(‘🙂’, flipX(nose.x) * w, nose.y * h);
}

function drawTPoseProgress(progress) {
const ctx = app.ctx;
const cx = app.canvas.width / 2;
const cy = app.canvas.height / 2;

// Background ring
ctx.beginPath();
ctx.arc(cx, cy, 60, 0, Math.PI * 2);
ctx.strokeStyle = ‘rgba(255,255,255,0.3)’;
ctx.lineWidth = 10;
ctx.stroke();

// Progress ring
ctx.beginPath();
ctx.arc(cx, cy, 60, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * progress);
ctx.strokeStyle = ‘#22c55e’;
ctx.stroke();

// Text
ctx.fillStyle = ‘#fff’;
ctx.font = ‘bold 20px sans-serif’;
ctx.textAlign = ‘center’;
ctx.fillText(‘T-POSE’, cx, cy - 5);
ctx.font = ‘16px sans-serif’;
ctx.fillText(`${Math.round(progress * 100)}%`, cx, cy + 18);
}

function updatePrompt(text) {
document.getElementById(‘state-prompt’).textContent = text;
}

function showCalibrationOverlay(show) {
const el = document.getElementById(‘calibration-overlay’);
if (show) {
el.classList.remove(‘hidden’);
} else {
el.classList.add(‘hidden’);
}
}

function updateCalibrationProgress(progress) {
const circle = document.getElementById(‘cal-progress’);
const text = document.getElementById(‘cal-text’);

// SVG circle stroke-dashoffset: 283 = full, 0 = complete
const offset = 283 * (1 - progress);
circle.style.strokeDashoffset = offset;
text.textContent = `${Math.round(progress * 100)}%`;
}

function updateTimer() {
const label = document.getElementById(‘timer-label’);
const value = document.getElementById(‘timer-value’);

if (app.appState === ‘TRACKING’ && app.setStartTime) {
const elapsed = Date.now() - app.setStartTime;
value.textContent = formatTime(elapsed);
value.style.color = ‘#f59e0b’;
label.textContent = ‘Working’;
} else if (app.restStartTime) {
const elapsed = Date.now() - app.restStartTime;
value.textContent = formatTime(elapsed);
value.style.color = ‘#22c55e’;
label.textContent = ‘Rest’;
} else {
value.textContent = ‘0:00’;
value.style.color = ‘#888’;
label.textContent = ‘Timer’;
}
}

function formatTime(ms) {
const sec = Math.floor(ms / 1000);
const min = Math.floor(sec / 60);
const s = sec % 60;
return `${min}:${s.toString().padStart(2, '0')}`;
}

// Start
init();