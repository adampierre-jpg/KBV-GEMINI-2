import { PoseLandmarker, FilesetResolver } from “https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs”;

/**

- Calibration System for VBT
- 
- The “Ruler” Concept:
- - User enters their actual height in inches
- - During calibration, we measure ankle-to-nose distance in pixels
- - Since height is to top of head (not nose), we subtract nose-to-head offset (~10-12cm)
- - This gives us a pixel-to-cm ratio that applies to the entire body
    */
    class CalibrationSystem {
    constructor() {
    this.CALIBRATION_FRAMES = 60;
    this.NOSE_TO_HEAD_OFFSET_CM = 11;
  
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
  }
  };
  }

setUserHeight(inches) {
this.state.userHeightInches = inches;
this.state.userHeightCm = inches * 2.54;
this.state.ankleToNoseCm = this.state.userHeightCm - this.NOSE_TO_HEAD_OFFSET_CM;
this.state.phase = “CAPTURING”;

```
console.log(`📏 User Height: ${inches}" = ${this.state.userHeightCm.toFixed(1)}cm`);
console.log(`📏 Ankle-to-Nose (estimated): ${this.state.ankleToNoseCm.toFixed(1)}cm`);

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

const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
const ankleToNoseNormalized = avgAnkleY - nose.y;
const ankleToNosePixels = ankleToNoseNormalized * canvasHeight;

if (ankleToNosePixels < canvasHeight * 0.3) {
  return { status: "INVALID_POSE", message: "Stand upright facing camera" };
}

this.state.ankleToNosePixelSamples.push(ankleToNosePixels);
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
this.measureBodySegments(pose, canvasHeight);
this.state.phase = "COMPLETE";

console.log("✅ Calibration Complete!");
console.log(`📏 Ankle-to-Nose: ${medianAnkleToNosePixels.toFixed(1)}px = ${this.state.ankleToNoseCm.toFixed(1)}cm`);
console.log(`📐 Pixel-to-CM Ratio: ${this.state.pixelToCmRatio.toFixed(4)} cm/px`);
console.log("📊 Body Segments:", this.state.bodySegments);

return {
  status: "COMPLETE",
  pixelToCmRatio: this.state.pixelToCmRatio,
  bodySegments: this.state.bodySegments
};
```

}

measureBodySegments(pose, canvasHeight) {
const ratio = this.state.pixelToCmRatio;

```
const distancePixels = (a, b) => {
  const dx = (a.x - b.x) * canvasHeight;
  const dy = (a.y - b.y) * canvasHeight;
  return Math.hypot(dx, dy);
};

const avgSegment = (leftA, leftB, rightA, rightB) => {
  const leftDist = distancePixels(leftA, leftB);
  const rightDist = distancePixels(rightA, rightB);
  return ((leftDist + rightDist) / 2) * ratio;
};

this.state.bodySegments = {
  torso: avgSegment(pose.LEFT.SHOULDER, pose.LEFT.HIP, pose.RIGHT.SHOULDER, pose.RIGHT.HIP),
  thigh: avgSegment(pose.LEFT.HIP, pose.LEFT.KNEE, pose.RIGHT.HIP, pose.RIGHT.KNEE),
  shin: avgSegment(pose.LEFT.KNEE, pose.LEFT.ANKLE, pose.RIGHT.KNEE, pose.RIGHT.ANKLE),
  upperArm: avgSegment(pose.LEFT.SHOULDER, pose.LEFT.ELBOW, pose.RIGHT.SHOULDER, pose.RIGHT.ELBOW),
  forearm: avgSegment(pose.LEFT.ELBOW, pose.LEFT.WRIST, pose.RIGHT.ELBOW, pose.RIGHT.WRIST),
  ankleToNose: this.state.ankleToNoseCm
};

return this.state.bodySegments;
```

}

pixelsToCm(pixels) {
if (!this.state.pixelToCmRatio) return null;
return pixels * this.state.pixelToCmRatio;
}

getPixelsPerMeter() {
if (!this.state.pixelToCmRatio) return null;
return 100 / this.state.pixelToCmRatio;
}

getArmLengthCm() {
if (!this.state.bodySegments.upperArm || !this.state.bodySegments.forearm) return null;
return this.state.bodySegments.upperArm + this.state.bodySegments.forearm;
}

getArmLengthPixels() {
const armCm = this.getArmLengthCm();
if (!armCm || !this.state.pixelToCmRatio) return null;
return armCm / this.state.pixelToCmRatio;
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
}
};
}
}

/**

- VBT State Machine - Rep Counting Criteria
- 
- Based on precise biomechanical criteria for:
- - Swing: Below hip → swing height (above hip, at/below nose) → below hip (NEVER overhead)
- - Clean: Below hip → elbow folds <20° → rack position (held 30 frames)
- - ReClean: Rack → below hip → rack (held 30 frames)
- - Snatch: Below hip → overhead (40% arm length) + lockout (>160°) → below hip
- - ReSnatch: Overhead (held 3 frames) → below hip → overhead + lockout → below hip
- - Press: Rack (held 30 frames) → overhead lockout → rack (NEVER below hip)
    */
    class VBTStateMachine {
    constructor(canvasHeight = 720, calibrationSystem = null) {
    this.canvasHeight = canvasHeight;
    this.calibrationSystem = calibrationSystem;
  
  // Thresholds from spec document
  this.THRESHOLDS = {
  // Elbow angles
  RACK_ELBOW_MAX: 20,           // Elbow <20° = rack position
  LOCKOUT_ELBOW_MIN: 160,       // Elbow >160° = locked out
  
  // Hold durations (frames at 30fps)
  RACK_HOLD_FRAMES: 30,         // ~1 sec to confirm rack
  LOCKOUT_HOLD_FRAMES: 0,       // Immediate lockout confirmation
  OVERHEAD_HOLD_FRAMES: 3,      // ~0.1 sec to confirm overhead start for resnatch
  
  // Position thresholds
  WRIST_NEAR_SHOULDER: 0.08,    // 8% of canvas for rack detection
  WRIST_OVERHEAD: 0.05,         // Fallback: 5% above nose
  SNATCH_ARM_EXTENSION_RATIO: 0.40,  // 40% of arm length above shoulder
  
  // Settling
  SNATCH_SETTLING_FRAMES: 2,    // ~0.07 sec after snatch
  
  // Velocity
  VELOCITY_ALPHA: 0.15,
  POSITION_ALPHA: 0.3,
  MAX_REALISTIC_VELOCITY: 8.0,
  ZERO_BAND: 0.1,
  MIN_DT: 0.016,
  MAX_DT: 0.1,
  
  // Reset
  RESET_DURATION_FRAMES: 30
  };
  
  this.calibrationData = {
  isCalibrated: false,
  framesCaptured: 0,
  neutralWristOffset: 0,
  maxTorsoLength: 0
  };
  
  this.reset();
  }

reset() {
this.state = {
lockedSide: “unknown”,
phase: “IDLE”,  // IDLE, MOVING, RETURNING, SETTLING

```
  // Starting position flags
  startedFromRack: false,
  startedBelowHip: false,
  startedFromOverhead: false,
  
  // Movement tracking flags (per spec)
  reachedRack: false,           // Wrist entered rack position
  reachedOverhead: false,       // Wrist 40% arm length above shoulder
  reachedLockout: false,        // Elbow >160° while overhead
  reachedSwingHeight: false,    // Wrist above hip but at/below nose
  elbowFoldedBeforeRack: false, // Elbow dropped <20° BEFORE reaching rack (for clean)
  wentBelowHip: false,          // Wrist descended below hip during rep
  everWentOverhead: false,      // Wrist entered overhead zone at ANY point (prevents swing/snatch confusion)
  
  // Hold counters
  rackHoldFrames: 0,
  lockoutHoldFrames: 0,
  overheadHoldFrames: 0,
  settlingFrames: 0,
  
  // Peak velocity
  currentRepPeak: 0,
  smoothedVy: 0,
  
  // Timing
  lastTimestamp: 0,
  lastWristPos: null,
  
  // Velocity calibration
  calibration: null,
  
  // Reset progress
  resetProgress: 0,
  
  // Pending movement for RETURNING phase
  pendingMovement: null,
  
  // Smoothed landmarks
  smoothedLandmarks: {
    LEFT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null },
    RIGHT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null }
  }
};
```

}

/**

- Calculate elbow angle in degrees (0° = fully flexed, 180° = fully extended)
  */
  calculateElbowAngle(shoulder, elbow, wrist) {
  const toShoulder = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
  const toWrist = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };

```
const dot = toShoulder.x * toWrist.x + toShoulder.y * toWrist.y;
const magShoulder = Math.hypot(toShoulder.x, toShoulder.y);
const magWrist = Math.hypot(toWrist.x, toWrist.y);

const cosAngle = dot / (magShoulder * magWrist);
const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
return angleRad * (180 / Math.PI);
```

}

/**

- Check if wrist is overhead (40% arm length above shoulder OR above nose as fallback)
  */
  isWristOverhead(wrist, shoulder, nose) {
  // Calibrated check
  if (this.calibrationSystem && this.calibrationSystem.isComplete()) {
  const armLengthPixels = this.calibrationSystem.getArmLengthPixels();
  if (armLengthPixels) {
  const wristAboveShoulderPixels = (shoulder.y - wrist.y) * this.canvasHeight;
  const threshold = armLengthPixels * this.THRESHOLDS.SNATCH_ARM_EXTENSION_RATIO;
  if (wristAboveShoulderPixels > threshold) {
  return true;
  }
  // Fall through to fallback if calibrated check fails (OR logic)
  }
  }

```
// Fallback: wrist above nose
return wrist.y < (nose.y - this.THRESHOLDS.WRIST_OVERHEAD);
```

}

/**

- Check if wrist is at swing height (above hip, at/below nose - NOT overhead)
  */
  isAtSwingHeight(wrist, hip, shoulder, nose) {
  const aboveHip = wrist.y < hip.y;
  const atOrBelowNose = wrist.y >= nose.y;  // Swing finish is at or below nose
  const notOverhead = !this.isWristOverhead(wrist, shoulder, nose);
  return aboveHip && notOverhead;  // Above hip but not in overhead zone
  }

smoothLandmarks(rawPose) {
const alpha = this.THRESHOLDS.POSITION_ALPHA;
const smoothed = { LEFT: {}, RIGHT: {} };

```
for (const side of ['LEFT', 'RIGHT']) {
  for (const landmark of ['WRIST', 'SHOULDER', 'HIP', 'KNEE', 'NOSE', 'ANKLE', 'ELBOW']) {
    if (!rawPose[side] || !rawPose[side][landmark]) continue;

    const raw = rawPose[side][landmark];
    const prev = this.state.smoothedLandmarks[side][landmark];

    if (!prev) {
      smoothed[side][landmark] = { x: raw.x, y: raw.y, z: raw.z || 0 };
    } else {
      smoothed[side][landmark] = {
        x: alpha * raw.x + (1 - alpha) * prev.x,
        y: alpha * raw.y + (1 - alpha) * prev.y,
        z: alpha * (raw.z || 0) + (1 - alpha) * (prev.z || 0)
      };
    }
  }
}

this.state.smoothedLandmarks = smoothed;
return smoothed;
```

}

calculateVelocity(wrist, timestamp) {
if (!this.state.lastWristPos || !this.state.calibration) {
this.state.lastWristPos = { x: wrist.x, y: wrist.y, t: timestamp };
return { vx: 0, vy: 0, speed: 0 };
}

```
const dt = (timestamp - this.state.lastWristPos.t) / 1000;

if (dt < this.THRESHOLDS.MIN_DT || dt > this.THRESHOLDS.MAX_DT) {
  this.state.lastWristPos = { x: wrist.x, y: wrist.y, t: timestamp };
  return { vx: 0, vy: 0, speed: 0 };
}

const dxPx = (wrist.x - this.state.lastWristPos.x) * this.canvasHeight;
const dyPx = (wrist.y - this.state.lastWristPos.y) * this.canvasHeight;

let vx = (dxPx / this.state.calibration) / dt;
let vy = (dyPx / this.state.calibration) / dt;
let speed = Math.hypot(vx, vy);

if (speed < this.THRESHOLDS.ZERO_BAND) {
  speed = 0; vx = 0; vy = 0;
}

speed = Math.min(speed, this.THRESHOLDS.MAX_REALISTIC_VELOCITY);
vy = Math.min(Math.max(vy, -this.THRESHOLDS.MAX_REALISTIC_VELOCITY), this.THRESHOLDS.MAX_REALISTIC_VELOCITY);

this.state.lastWristPos = { x: wrist.x, y: wrist.y, t: timestamp };
return { vx, vy, speed };
```

}

update(pose, timestamp, ctx, canvas) {
if (!pose.LEFT || !pose.RIGHT) return null;

```
const smoothedPose = this.smoothLandmarks(pose);

// --- Initial Calibration (30 frames) ---
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
    console.log("✅ Pose Calibration Complete");
  }
  return null;
}

// --- Reset Detection ---
const leftAtHome = Math.abs(leftWristOffset - this.calibrationData.neutralWristOffset) < 0.10;
const rightAtHome = Math.abs(rightWristOffset - this.calibrationData.neutralWristOffset) < 0.10;
const isTall = currentTorso > (this.calibrationData.maxTorsoLength * 0.85);

if (leftAtHome && rightAtHome && isTall) {
  this.state.resetProgress++;
  this.drawResetUI(ctx, canvas, smoothedPose);
  if (this.state.resetProgress > this.THRESHOLDS.RESET_DURATION_FRAMES) {
    this.reset();
    return null;
  }
} else {
  this.state.resetProgress = 0;
}

// --- Lock to one side ---
if (this.state.lockedSide === "unknown") {
  if (Math.abs(smoothedPose.LEFT.WRIST.y - smoothedPose.RIGHT.WRIST.y) > 0.1) {
    this.state.lockedSide = smoothedPose.LEFT.WRIST.y < smoothedPose.RIGHT.WRIST.y ? "LEFT" : "RIGHT";
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

// --- Setup velocity calibration ---
if (!this.state.calibration) {
  if (this.calibrationSystem && this.calibrationSystem.isComplete()) {
    this.state.calibration = this.calibrationSystem.getPixelsPerMeter();
    console.log(`📐 Using calibrated px/m: ${this.state.calibration.toFixed(2)}`);
  } else if (shoulder && hip) {
    const TORSO_METERS = 0.45;
    this.state.calibration = (Math.abs(shoulder.y - hip.y) * this.canvasHeight) / TORSO_METERS;
    console.log(`📐 Using estimated px/m: ${this.state.calibration.toFixed(2)} (legacy)`);
  }
}

// --- Calculate current positions ---
const elbowAngle = this.calculateElbowAngle(shoulder, elbow, wrist);
const wristBelowHip = wrist.y > hip.y;
const wristNearShoulder = Math.abs(wrist.y - shoulder.y) < this.THRESHOLDS.WRIST_NEAR_SHOULDER;
const wristOverhead = this.isWristOverhead(wrist, shoulder, nose);
const atSwingHeight = this.isAtSwingHeight(wrist, hip, shoulder, nose);

const inRackPosition = elbowAngle < this.THRESHOLDS.RACK_ELBOW_MAX && wristNearShoulder;
const inLockout = elbowAngle > this.THRESHOLDS.LOCKOUT_ELBOW_MIN && wristOverhead;

// --- Calculate velocity ---
const velocity = this.calculateVelocity(wrist, timestamp);
this.state.smoothedVy = (this.THRESHOLDS.VELOCITY_ALPHA * velocity.vy) +
  ((1 - this.THRESHOLDS.VELOCITY_ALPHA) * this.state.smoothedVy);
this.state.lastTimestamp = timestamp;

let result = null;

// ========================================
// PHASE: SETTLING (after snatch)
// ========================================
if (this.state.phase === "SETTLING") {
  this.state.settlingFrames++;
  
  if (this.state.settlingFrames >= this.THRESHOLDS.SNATCH_SETTLING_FRAMES) {
    this.state.phase = "IDLE";
    
    // Detect current position after settling
    if (inLockout) {
      this.state.startedFromOverhead = true;
      this.state.overheadHoldFrames = this.THRESHOLDS.OVERHEAD_HOLD_FRAMES;
      console.log("📍 After settling: OVERHEAD position");
    } else if (wristBelowHip) {
      this.state.startedBelowHip = true;
      console.log("📍 After settling: BELOW HIP position");
    }
  }
  return result;
}

// ========================================
// PHASE: IDLE - Detect starting position
// ========================================
if (this.state.phase === "IDLE") {
  
  // Priority 1: Overhead lockout (for re-snatch)
  if (inLockout) {
    this.state.overheadHoldFrames++;
    if (this.state.overheadHoldFrames >= this.THRESHOLDS.OVERHEAD_HOLD_FRAMES) {
      this.state.startedFromOverhead = true;
      this.state.startedFromRack = false;
      this.state.startedBelowHip = false;
    }
  } 
  // Priority 2: Rack position (for press or re-clean)
  else if (inRackPosition) {
    this.state.rackHoldFrames++;
    this.state.overheadHoldFrames = 0;
    if (this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
      this.state.startedFromRack = true;
      this.state.startedFromOverhead = false;
      this.state.startedBelowHip = false;
    }
  } 
  // Priority 3: Below hip (for clean/swing/snatch)
  else if (wristBelowHip) {
    this.state.rackHoldFrames = 0;
    this.state.overheadHoldFrames = 0;
    this.state.startedFromRack = false;
    this.state.startedFromOverhead = false;
    this.state.startedBelowHip = true;
  }
  
  // --- Transition to MOVING ---
  
  // From overhead (re-snatch)
  if (this.state.startedFromOverhead && !inLockout) {
    this.state.phase = "MOVING";
    this.clearMovementFlags();
    console.log("🏋️ Movement started from OVERHEAD (re-snatch)");
  }
  // From rack (press or re-clean)
  else if (this.state.startedFromRack && !inRackPosition) {
    this.state.phase = "MOVING";
    this.clearMovementFlags();
    console.log("🏋️ Movement started from RACK");
  }
  // From below hip (clean/swing/snatch)
  else if (this.state.startedBelowHip && !wristBelowHip) {
    this.state.phase = "MOVING";
    this.clearMovementFlags();
    console.log("🏋️ Movement started from BELOW HIP");
  }
}

// ========================================
// PHASE: MOVING - Track positions reached
// ========================================
else if (this.state.phase === "MOVING") {
  // Track peak velocity
  this.state.currentRepPeak = Math.max(this.state.currentRepPeak, Math.abs(this.state.smoothedVy));
  
  // --- Track all position flags ---
  
  // Track if elbow folded (for clean detection)
  if (elbowAngle < this.THRESHOLDS.RACK_ELBOW_MAX && !this.state.reachedRack) {
    this.state.elbowFoldedBeforeRack = true;
  }
  
  // Track if wrist went below hip
  if (wristBelowHip) {
    this.state.wentBelowHip = true;
  }
  
  // Track if wrist reached overhead (STICKY - once true, stays true for entire rep)
  if (wristOverhead) {
    this.state.reachedOverhead = true;
    this.state.everWentOverhead = true;  // Critical for swing/snatch distinction
  }
  
  // Track swing height (above hip, at/below nose)
  if (atSwingHeight && !this.state.everWentOverhead) {
    this.state.reachedSwingHeight = true;
  }
  
  // Track lockout (elbow >160° while overhead)
  if (inLockout) {
    this.state.reachedLockout = true;
    this.state.lockoutHoldFrames++;
  } else {
    this.state.lockoutHoldFrames = 0;
  }
  
  // Track rack position
  if (inRackPosition) {
    this.state.reachedRack = true;
    this.state.rackHoldFrames++;
  } else {
    this.state.rackHoldFrames = 0;
  }
  
  // ========================================
  // MOVEMENT COMPLETION CHECKS (in priority order)
  // ========================================
  
  // --- SNATCH: Below hip → overhead + lockout ---
  if (this.state.startedBelowHip && 
      this.state.reachedOverhead &&
      this.state.reachedLockout) {
    this.state.phase = "RETURNING";
    this.state.pendingMovement = "SNATCH";
    console.log("⏳ SNATCH lockout confirmed, waiting for return below hip");
  }
  
  // --- RESNATCH: Overhead → below hip → back to lockout ---
  else if (this.state.startedFromOverhead && 
           this.state.wentBelowHip && 
           this.state.reachedLockout) {
    this.state.phase = "RETURNING";
    this.state.pendingMovement = "SNATCH";
    console.log("⏳ RESNATCH lockout confirmed, waiting for return below hip");
  }
  
  // --- PRESS: Rack → overhead lockout (never below hip) ---
  else if (this.state.startedFromRack && 
           this.state.reachedLockout && 
           !this.state.wentBelowHip) {
    this.state.phase = "RETURNING";
    this.state.pendingMovement = "PRESS";
    console.log("⏳ PRESS lockout confirmed, waiting for return to rack");
  }
  
  // --- CLEAN: Below hip → elbow folded → rack held ---
  else if (this.state.startedBelowHip && 
           this.state.elbowFoldedBeforeRack &&
           this.state.reachedRack && 
           this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
    result = { type: "CLEAN", velocity: this.state.currentRepPeak };
    console.log("✅ CLEAN complete");
    this.resetForNextRep(true);
  }
  
  // --- RECLEAN: Rack → below hip → rack held ---
  else if (this.state.startedFromRack && 
           this.state.wentBelowHip && 
           this.state.reachedRack && 
           this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
    result = { type: "CLEAN", velocity: this.state.currentRepPeak };
    console.log("✅ RECLEAN complete");
    this.resetForNextRep(true);
  }
  
  // --- BAD SNATCH: Overhead but missed lockout ---
  else if (this.state.startedBelowHip && 
           this.state.reachedOverhead &&
           !this.state.reachedLockout &&
           wristBelowHip) {
    result = { type: "SNATCH", velocity: this.state.currentRepPeak, quality: "BAD_FORM" };
    console.log("⚠️ BAD SNATCH counted (missed lockout)");
    this.resetForSnatch();
  }
  
  // --- BAD RESNATCH: Overhead but missed lockout ---
  else if (this.state.startedFromOverhead && 
           this.state.wentBelowHip &&
           this.state.reachedOverhead &&
           !this.state.reachedLockout &&
           wristBelowHip) {
    result = { type: "SNATCH", velocity: this.state.currentRepPeak, quality: "BAD_FORM" };
    console.log("⚠️ BAD RESNATCH counted (missed lockout)");
    this.resetForSnatch();
  }
  
  // --- SWING: Below hip → swing height → NEVER overhead → back below hip ---
  else if (this.state.startedBelowHip && 
           this.state.reachedSwingHeight &&
           !this.state.everWentOverhead &&  // CRITICAL: never went overhead
           wristBelowHip) {
    result = { type: "SWING", velocity: this.state.currentRepPeak };
    console.log("✅ SWING complete");
    this.resetForNextRep(false);
  }
}

// ========================================
// PHASE: RETURNING - Wait for return position
// ========================================
else if (this.state.phase === "RETURNING") {
  this.state.currentRepPeak = Math.max(this.state.currentRepPeak, Math.abs(this.state.smoothedVy));
  
  // PRESS: Wait for return to rack
  if (this.state.pendingMovement === "PRESS" && inRackPosition) {
    this.state.rackHoldFrames++;
    if (this.state.rackHoldFrames >= this.THRESHOLDS.RACK_HOLD_FRAMES) {
      result = { type: "PRESS", velocity: this.state.currentRepPeak };
      console.log("✅ PRESS complete");
      this.resetForNextRep(true);
    }
  }
  
  // SNATCH: Wait for return below hip
  else if (this.state.pendingMovement === "SNATCH" && wristBelowHip) {
    result = { type: "SNATCH", velocity: this.state.currentRepPeak };
    console.log("✅ SNATCH complete");
    this.resetForSnatch();
  }
}

return result;
```

}

/**

- Clear movement tracking flags when starting a new rep
  */
  clearMovementFlags() {
  this.state.reachedRack = false;
  this.state.reachedOverhead = false;
  this.state.reachedLockout = false;
  this.state.reachedSwingHeight = false;
  this.state.elbowFoldedBeforeRack = false;
  this.state.wentBelowHip = false;
  this.state.everWentOverhead = false;
  this.state.rackHoldFrames = 0;
  this.state.lockoutHoldFrames = 0;
  this.state.currentRepPeak = 0;
  this.state.pendingMovement = null;
  }

/**

- Reset after snatch - enters settling phase
  */
  resetForSnatch() {
  this.state.phase = “SETTLING”;
  this.state.settlingFrames = 0;
  this.state.startedFromRack = false;
  this.state.startedBelowHip = false;
  this.state.startedFromOverhead = false;
  this.clearMovementFlags();
  }

/**

- Reset for next rep (clean/press/swing)
  */
  resetForNextRep(inRack) {
  this.state.phase = “IDLE”;
  this.state.startedFromRack = inRack;
  this.state.startedBelowHip = !inRack;
  this.state.startedFromOverhead = false;
  this.state.rackHoldFrames = inRack ? this.THRESHOLDS.RACK_HOLD_FRAMES : 0;
  this.state.overheadHoldFrames = 0;
  this.clearMovementFlags();
  }

drawResetUI(ctx, canvas, pose) {
const centerX = (pose.LEFT.SHOULDER.x + pose.RIGHT.SHOULDER.x) / 2 * canvas.width;
const centerY = (pose.LEFT.SHOULDER.y + pose.LEFT.HIP.y) / 2 * canvas.height;
const pct = this.state.resetProgress / this.THRESHOLDS.RESET_DURATION_FRAMES;
ctx.beginPath();
ctx.arc(centerX, centerY, 40, 0, Math.PI * 2);
ctx.strokeStyle = “rgba(255,255,255,0.2)”;
ctx.lineWidth = 8;
ctx.stroke();
ctx.beginPath();
ctx.arc(centerX, centerY, 40, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * pct));
ctx.strokeStyle = “#3b82f6”;
ctx.stroke();
}
}

// ============================================================================
// APP INITIALIZATION
// ============================================================================

const app = {
video: null,
canvas: null,
ctx: null,
landmarker: null,
stateMachine: null,
calibrationSystem: null,
isModelLoaded: false,
isTestRunning: false,
totalReps: 0,
lastMove: “READY”,
history: { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] }
};

async function initializeApp() {
app.video = document.getElementById(“video”);
app.canvas = document.getElementById(“canvas”);
app.ctx = app.canvas.getContext(“2d”);

app.calibrationSystem = new CalibrationSystem();

document.getElementById(“btn-camera”).onclick = startCamera;
document.getElementById(“file-input”).onchange = handleUpload;
document.getElementById(“btn-start-test”).onclick = toggleTest;
document.getElementById(“btn-reset”).onclick = resetSession;

const heightInput = document.getElementById(“height-input”);
const calibrateBtn = document.getElementById(“btn-calibrate”);

if (calibrateBtn) {
calibrateBtn.onclick = () => {
const heightInches = parseFloat(heightInput.value);
if (heightInches && heightInches > 48 && heightInches < 96) {
app.calibrationSystem.setUserHeight(heightInches);
updateCalibrationUI();
} else {
alert(“Please enter a valid height (48-96 inches)”);
}
};
}

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
requestAnimationFrame(masterLoop);
}

function updateCalibrationUI() {
const statusEl = document.getElementById(“calibration-status”);
if (!statusEl) return;

const cal = app.calibrationSystem.state;

if (cal.phase === “WAITING_FOR_HEIGHT”) {
statusEl.innerHTML = “Enter your height to begin calibration”;
} else if (cal.phase === “CAPTURING”) {
statusEl.innerHTML = `Calibrating... Stand upright, arms at sides`;
} else if (cal.phase === “COMPLETE”) {
const segments = cal.bodySegments;
const armLength = segments.upperArm + segments.forearm;
statusEl.innerHTML = `<div style="color: #22c55e; font-weight: bold;">✅ Calibration Complete!</div> <div style="font-size: 12px; margin-top: 8px;"> <div>Torso: ${segments.torso.toFixed(1)}cm</div> <div>Upper Arm: ${segments.upperArm.toFixed(1)}cm</div> <div>Forearm: ${segments.forearm.toFixed(1)}cm</div> <div style="color: #3b82f6; margin-top: 4px;"><strong>Full Arm: ${armLength.toFixed(1)}cm</strong></div> <div style="color: #f59e0b;">Overhead threshold: ${(armLength * 0.4).toFixed(1)}cm above shoulder</div> </div>`;
}
}

function handleUpload(e) {
const file = e.target.files?.[0];
if (!file) return;

if (app.video.srcObject) {
app.video.srcObject = null;
}

app.video.onloadedmetadata = () => {
console.log(“✅ Video metadata loaded:”, app.video.videoWidth, “x”, app.video.videoHeight);
app.canvas.width = app.video.videoWidth;
app.canvas.height = app.video.videoHeight;
app.stateMachine = new VBTStateMachine(app.canvas.height, app.calibrationSystem);
document.getElementById(“btn-start-test”).disabled = false;
};

app.video.src = URL.createObjectURL(file);
app.video.load();

console.log(“📁 Video file selected:”, file.name);
}

async function startCamera() {
try {
const s = await navigator.mediaDevices.getUserMedia({ video: true });

```
app.video.onloadedmetadata = () => {
  console.log("✅ Camera metadata loaded:", app.video.videoWidth, "x", app.video.videoHeight);
  app.canvas.width = app.video.videoWidth;
  app.canvas.height = app.video.videoHeight;
  app.stateMachine = new VBTStateMachine(app.canvas.height, app.calibrationSystem);
  document.getElementById("btn-start-test").disabled = false;
};

app.video.srcObject = s;
console.log("📹 Camera started");
```

} catch (err) {
console.error(“Camera error:”, err);
alert(“Could not access camera: “ + err.message);
}
}

function toggleTest() {
app.isTestRunning = !app.isTestRunning;
document.getElementById(“btn-start-test”).innerText = app.isTestRunning ? “PAUSE” : “START”;
if (app.isTestRunning) app.video.play();
else app.video.pause();
}

async function masterLoop(ts) {
requestAnimationFrame(masterLoop);
if (!app.isModelLoaded || !app.video.readyState) return;

app.ctx.drawImage(app.video, 0, 0, app.canvas.width, app.canvas.height);
const results = app.landmarker.detectForVideo(app.video, ts);

if (results?.landmarks?.length > 0) {
const raw = results.landmarks[0];
const pose = {
LEFT: {
WRIST: raw[15],
SHOULDER: raw[11],
HIP: raw[23],
KNEE: raw[25],
ANKLE: raw[27],
NOSE: raw[0],
ELBOW: raw[13]
},
RIGHT: {
WRIST: raw[16],
SHOULDER: raw[12],
HIP: raw[24],
KNEE: raw[26],
ANKLE: raw[28],
NOSE: raw[0],
ELBOW: raw[14]
}
};

```
if (app.calibrationSystem && app.calibrationSystem.state.phase === "CAPTURING") {
  const calResult = app.calibrationSystem.captureFrame(pose, app.canvas.height);
  if (calResult) {
    updateCalibrationUI();
    drawCalibrationOverlay(pose, calResult);
  }
}

if (app.isTestRunning && app.stateMachine) {
  const move = app.stateMachine.update(pose, ts, app.ctx, app.canvas);
  if (move) record(move);
  drawUI(app.stateMachine.state, pose);
  drawDebugSkeleton(pose);
}
```

}
}

function drawCalibrationOverlay(pose, calResult) {
const ctx = app.ctx;
const canvas = app.canvas;

if (calResult.status === “CAPTURING”) {
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

```
ctx.beginPath();
ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
ctx.strokeStyle = "rgba(255,255,255,0.2)";
ctx.lineWidth = 10;
ctx.stroke();

ctx.beginPath();
ctx.arc(centerX, centerY, 60, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * calResult.progress));
ctx.strokeStyle = "#22c55e";
ctx.stroke();

ctx.fillStyle = "#fff";
ctx.font = "bold 24px sans-serif";
ctx.textAlign = "center";
ctx.fillText("CALIBRATING", centerX, centerY - 10);
ctx.font = "16px sans-serif";
ctx.fillText(`${Math.round(calResult.progress * 100)}%`, centerX, centerY + 15);

const nose = pose.LEFT.NOSE;
const leftAnkle = pose.LEFT.ANKLE;
const rightAnkle = pose.RIGHT.ANKLE;
const avgAnkleX = (leftAnkle.x + rightAnkle.x) / 2;
const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;

ctx.strokeStyle = "#22c55e";
ctx.lineWidth = 3;
ctx.setLineDash([10, 5]);
ctx.beginPath();
ctx.moveTo(avgAnkleX * canvas.width, avgAnkleY * canvas.height);
ctx.lineTo(nose.x * canvas.width, nose.y * canvas.height);
ctx.stroke();
ctx.setLineDash([]);
```

} else if (calResult.status === “INVALID_POSE”) {
ctx.fillStyle = “#ef4444”;
ctx.font = “bold 20px sans-serif”;
ctx.textAlign = “center”;
ctx.fillText(calResult.message, canvas.width / 2, 50);
}
}

function drawDebugSkeleton(pose) {
const ctx = app.ctx;
const canvas = app.canvas;

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
ctx.lineWidth = isWorkingArm ? 10 : 4;
ctx.beginPath();
ctx.moveTo(wrist.x * canvas.width, wrist.y * canvas.height);
ctx.lineTo(elbow.x * canvas.width, elbow.y * canvas.height);
ctx.lineTo(shoulder.x * canvas.width, shoulder.y * canvas.height);
ctx.lineTo(hip.x * canvas.width, hip.y * canvas.height);
ctx.lineTo(knee.x * canvas.width, knee.y * canvas.height);
ctx.lineTo(ankle.x * canvas.width, ankle.y * canvas.height);
ctx.stroke();

const joints = [wrist, elbow, shoulder, hip, knee, ankle];
ctx.strokeStyle = color;
ctx.lineWidth = isWorkingArm ? 6 : 3;

for (const joint of joints) {
  ctx.beginPath();
  ctx.arc(joint.x * canvas.width, joint.y * canvas.height, isWorkingArm ? 16 : 10, 0, Math.PI * 2);
  ctx.stroke();
}

if (isWorkingArm) {
  ctx.fillStyle = "#ffff00";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 4;
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.strokeText("⚡ WORKING", wrist.x * canvas.width, wrist.y * canvas.height + 50);
  ctx.fillText("⚡ WORKING", wrist.x * canvas.width, wrist.y * canvas.height + 50);
}

if (app.stateMachine) {
  const elbowAngle = app.stateMachine.calculateElbowAngle(shoulder, elbow, wrist);
  ctx.fillStyle = isWorkingArm ? "#ffff00" : "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 4;
  ctx.font = isWorkingArm ? "bold 42px sans-serif" : "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.strokeText(`${elbowAngle.toFixed(0)}°`, elbow.x * canvas.width, elbow.y * canvas.height - 30);
  ctx.fillText(`${elbowAngle.toFixed(0)}°`, elbow.x * canvas.width, elbow.y * canvas.height - 30);
}
```

}

const nose = pose.LEFT.NOSE;
const leftShoulder = pose.LEFT.SHOULDER;
const rightShoulder = pose.RIGHT.SHOULDER;

const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) * canvas.width;
const headSize = shoulderWidth * 1.25;

ctx.font = `${headSize}px Arial`;
ctx.textAlign = ‘center’;
ctx.textBaseline = ‘middle’;
ctx.fillText(‘🙂’, nose.x * canvas.width, nose.y * canvas.height);

// Debug display - all tracking flags
if (app.stateMachine && app.stateMachine.state) {
const s = app.stateMachine.state;
ctx.fillStyle = “#fff”;
ctx.strokeStyle = “#000”;
ctx.lineWidth = 4;
ctx.font = “bold 28px sans-serif”;
ctx.textAlign = “left”;

```
const phaseDisplay = s.phase === 'SETTLING' 
  ? `SETTLING (${s.settlingFrames}/${app.stateMachine.THRESHOLDS.SNATCH_SETTLING_FRAMES})`
  : s.phase;

const debugLines = [
  `Arm: ${s.lockedSide} | Phase: ${phaseDisplay}`,
  `─── START POSITION ───`,
  `fromRack: ${s.startedFromRack} | fromHip: ${s.startedBelowHip} | fromOH: ${s.startedFromOverhead}`,
  `─── MOVEMENT FLAGS ───`,
  `reachedRack: ${s.reachedRack} (hold: ${s.rackHoldFrames})`,
  `reachedOverhead: ${s.reachedOverhead} | everWentOH: ${s.everWentOverhead}`,
  `reachedLockout: ${s.reachedLockout} (hold: ${s.lockoutHoldFrames})`,
  `reachedSwingHeight: ${s.reachedSwingHeight}`,
  `elbowFolded: ${s.elbowFoldedBeforeRack} | wentBelowHip: ${s.wentBelowHip}`,
  `─── VELOCITY ───`,
  `peak: ${s.currentRepPeak.toFixed(2)} m/s`
];

debugLines.forEach((line, i) => {
  const y = 30 + i * 32;
  ctx.strokeText(line, 10, y);
  ctx.fillText(line, 10, y);
});
```

}
}

function record(m) {
app.totalReps++;
app.lastMove = m.type;
app.history[m.type].push(m.velocity);

let plural = m.type.toLowerCase() + “s”;
if (m.type === “PRESS”) plural = “presses”;
if (m.type === “SNATCH”) plural = “snatches”;

const countEl = document.getElementById(`val-${plural}`);
const velEl = document.getElementById(`val-${m.type.toLowerCase()}-velocity`);

if (countEl) countEl.innerText = app.history[m.type].length;
if (velEl) velEl.innerText = m.velocity.toFixed(2);

document.getElementById(“val-total-reps”).innerText = app.totalReps;

// Show quality indicator if bad form
const moveDisplay = m.quality === “BAD_FORM” ? `${m.type} ⚠️` : m.type;
document.getElementById(“detected-movement”).innerText = moveDisplay;

// Log with quality
if (m.quality) {
console.log(`📊 ${m.type} (${m.quality}): ${m.velocity.toFixed(2)} m/s`);
} else {
console.log(`📊 ${m.type}: ${m.velocity.toFixed(2)} m/s`);
}
}

function resetSession() {
app.totalReps = 0;
app.lastMove = “READY”;
app.history = { CLEAN: [], PRESS: [], SNATCH: [], SWING: [] };
if (app.stateMachine) app.stateMachine.reset();
[‘val-cleans’, ‘val-presses’, ‘val-snatches’, ‘val-swings’, ‘val-total-reps’].forEach(id => {
const el = document.getElementById(id);
if (el) el.textContent = ‘0’;
});
[‘val-clean-velocity’, ‘val-press-velocity’, ‘val-snatch-velocity’, ‘val-swing-velocity’, ‘val-velocity’].forEach(id => {
const el = document.getElementById(id);
if (el) el.textContent = ‘0.00’;
});
document.getElementById(“detected-movement”).innerText = “READY”;
}

function drawUI(s, p) {
document.getElementById(“val-velocity”).innerText = Math.abs(s.smoothedVy).toFixed(2);
}

initializeApp();