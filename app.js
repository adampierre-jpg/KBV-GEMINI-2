/**
 * ============================================================================
 * VBT (VELOCITY BASED TRAINING) APPLICATION
 * ============================================================================
 * * This application uses MediaPipe Pose Landmarker to detect kettlebell exercises
 * and measure movement velocity for velocity-based training.
 * * FEATURES:
 * - Real-time pose detection using MediaPipe
 * - Movement classification (Clean, Press, Snatch, Swing)
 * - Velocity tracking with peak velocity per rep
 * - Height-based calibration for accurate measurements
 * - Fatigue monitoring via velocity drop-off analysis
 * - Set timing with work:rest ratio tracking
 * * SECTIONS:
 * 1. Imports & Constants
 * 2. VelocityFatigueTracker Class - Monitors velocity degradation
 * 3. SetTimingTracker Class - Tracks work/rest periods
 * 4. CalibrationSystem Class - Height-based pixel-to-cm conversion
 * 5. VBTStateMachine Class - Movement detection state machine
 * 6. App Initialization & Main Loop
 * 7. UI Update Functions
 * 8. Helper Functions
 * * ============================================================================
 */

import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";


// ============================================================================
// SECTION 1: CONSTANTS
// ============================================================================

/**
 * MediaPipe landmark indices for reference:
 * 0 = Nose, 11 = Left Shoulder, 12 = Right Shoulder
 * 13 = Left Elbow, 14 = Right Elbow, 15 = Left Wrist, 16 = Right Wrist
 * 23 = Left Hip, 24 = Right Hip, 25 = Left Knee, 26 = Right Knee
 * 27 = Left Ankle, 28 = Right Ankle
 */


// ============================================================================
// SECTION 2: VELOCITY FATIGUE TRACKER CLASS
// ============================================================================
/**
 * PURPOSE: Track velocity degradation over the course of a workout to
 * identify anaerobic threshold and lactate threshold indicators.
 * * HOW IT WORKS:
 * 1. First N reps (default 3) establish a "baseline" velocity
 * 2. Each subsequent rep is compared to baseline
 * 3. Calculates percentage drop from baseline
 * 4. Alerts when drop crosses thresholds (10%, 20%, 30%)
 * 5. Predicts reps remaining until target threshold
 * * FATIGUE ZONES:
 * - FRESH: <5% drop
 * - MILD: 5-10% drop
 * - MODERATE: 10-20% drop (approaching anaerobic threshold)
 * - HIGH: 20-30% drop (likely at lactate threshold)
 * - CRITICAL: >30% drop (significant fatigue, consider rest)
 */
class VelocityFatigueTracker {
  constructor(config = {}) {
    // --- Configuration ---
    this.config = {
      baselineReps: config.baselineReps || 3,           // Number of reps to establish baseline
      alertThresholds: config.alertThresholds || [10, 20, 30],  // Percentage drop thresholds
      movementsToTrack: config.movementsToTrack || ['PRESS', 'CLEAN', 'SNATCH', 'SWING'],
      ...config
    };
    
    this.reset();
  }

  /**
   * Reset all tracking data - called on session reset
   * DEBUG: Check this if fatigue data persists incorrectly between sessions
   */
  reset() {
    this.data = {};
    for (const movement of this.config.movementsToTrack) {
      this.data[movement] = {
        velocities: [],              // Array of all velocities for this movement
        baselineVelocity: null,      // Average of first N reps
        currentVelocity: null,       // Most recent velocity
        peakVelocity: null,          // Highest velocity achieved
        dropFromBaseline: 0,         // Current % drop from baseline
        dropFromPeak: 0,             // Current % drop from peak
        thresholdsCrossed: [],       // Which alert thresholds have been triggered
        repCount: 0,                 // Total reps of this movement
        fatigueZone: 'FRESH'         // Current fatigue classification
      };
    }
  }

  /**
   * Reset just the current set data (velocities, baseline)
   * Called between sets if you want per-set fatigue tracking
   * DEBUG: Uncomment the call in onStandingReset() to enable per-set tracking
   */
  resetSet() {
    for (const movement of this.config.movementsToTrack) {
      this.data[movement].velocities = [];
      this.data[movement].baselineVelocity = null;
      this.data[movement].currentVelocity = null;
      this.data[movement].dropFromBaseline = 0;
      this.data[movement].dropFromPeak = 0;
      this.data[movement].thresholdsCrossed = [];
      this.data[movement].repCount = 0;
      this.data[movement].fatigueZone = 'FRESH';
      // Note: peakVelocity is NOT reset - tracks session peak
    }
  }

  /**
   * Add a new rep's velocity data
   * @param {string} movementType - 'PRESS', 'CLEAN', 'SNATCH', or 'SWING'
   * @param {number} velocity - Peak velocity in m/s
   * @returns {Object} Status object with fatigue metrics
   * * DEBUG: If velocities seem wrong, check:
   * - Is the correct movementType being passed?
   * - Is velocity in m/s (should be 1-4 typically)?
   */
  addRep(movementType, velocity) {
    if (!this.data[movementType]) {
      console.warn(`[FatigueTracker] Unknown movement type: ${movementType}`);
      return null;
    }

    const data = this.data[movementType];
    
    // Store velocity and update counters
    data.velocities.push(velocity);
    data.currentVelocity = velocity;
    data.repCount++;
    
    // Track peak velocity (highest ever for this movement)
    if (!data.peakVelocity || velocity > data.peakVelocity) {
      data.peakVelocity = velocity;
    }
    
    // Calculate baseline after collecting enough reps
    // DEBUG: If baseline seems off, check baselineReps config value
    if (data.repCount === this.config.baselineReps) {
      data.baselineVelocity = this.calculateAverage(data.velocities);
      console.log(`📊 [FatigueTracker] ${movementType} baseline: ${data.baselineVelocity.toFixed(2)} m/s`);
    }
    
    // Calculate drops once we have a baseline
    if (data.baselineVelocity) {
      data.dropFromBaseline = this.calculatePercentDrop(data.baselineVelocity, velocity);
      data.dropFromPeak = this.calculatePercentDrop(data.peakVelocity, velocity);
      
      // Check for threshold crossings
      this.checkThresholds(movementType, data);
      
      // Classify fatigue zone
      data.fatigueZone = this.determineFatigueZone(data.dropFromBaseline);
    }
    
    return this.getStatus(movementType);
  }

  /**
   * Calculate percentage drop from reference to current
   * @returns {number} Percentage drop (0-100+), never negative
   */
  calculatePercentDrop(reference, current) {
    if (!reference || reference === 0) return 0;
    const drop = ((reference - current) / reference) * 100;
    return Math.max(0, drop);  // Never show negative (improvement shows as 0)
  }

  /**
   * Calculate average of an array of numbers
   */
  calculateAverage(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  /**
   * Check if velocity drop has crossed any alert thresholds
   * DEBUG: If alerts trigger repeatedly, check thresholdsCrossed array
   */
  checkThresholds(movementType, data) {
    for (const threshold of this.config.alertThresholds) {
      if (data.dropFromBaseline >= threshold && !data.thresholdsCrossed.includes(threshold)) {
        data.thresholdsCrossed.push(threshold);
        this.onThresholdCrossed(movementType, threshold, data);
      }
    }
  }

  /**
   * Called when a fatigue threshold is crossed
   * Override this method for custom alerts (audio, visual, etc.)
   */
  onThresholdCrossed(movementType, threshold, data) {
    const messages = {
      10: '⚠️ MILD FATIGUE - 10% velocity drop',
      20: '🟠 MODERATE FATIGUE - 20% drop (anaerobic threshold zone)',
      30: '🔴 HIGH FATIGUE - 30% drop (lactate threshold exceeded)'
    };
    console.log(`${messages[threshold] || threshold + '% drop'} | ${movementType} | Rep ${data.repCount}`);
  }

  /**
   * Classify current fatigue level based on velocity drop percentage
   * @returns {string} Fatigue zone name
   * * FATIGUE ZONES EXPLAINED:
   * - FRESH: Working at near-baseline capacity
   * - MILD: Early fatigue, still efficient
   * - MODERATE: Approaching anaerobic threshold (AT)
   * - HIGH: At or near lactate threshold (LT)
   * - CRITICAL: Significant power loss, recovery needed
   */
  determineFatigueZone(dropPercent) {
    if (dropPercent < 5) return 'FRESH';
    if (dropPercent < 10) return 'MILD';
    if (dropPercent < 20) return 'MODERATE';
    if (dropPercent < 30) return 'HIGH';
    return 'CRITICAL';
  }

  /**
   * Get current status for a movement type
   * @returns {Object} Complete status object for UI display
   */
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
      velocityHistory: [...data.velocities]
    };
  }

  /**
   * Predict how many reps until a target drop threshold is reached
   * Uses linear regression on velocity data
   * * @param {string} movementType - Movement to predict for
   * @param {number} targetDropPercent - Target percentage drop (default 20%)
   * @returns {Object|null} Prediction object or null if insufficient data
   * * DEBUG: Returns null if:
   * - Less than 3 reps recorded
   * - No baseline established
   * - Velocity is increasing (positive slope)
   */
  predictRepsToThreshold(movementType, targetDropPercent = 20) {
    const data = this.data[movementType];
    if (!data || !data.baselineVelocity || data.velocities.length < 3) return null;
    
    // Linear regression to find velocity trend
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
    
    // If velocity isn't decreasing, can't predict threshold
    if (slope >= 0) return null;
    
    // Calculate target velocity at threshold
    const targetVelocity = data.baselineVelocity * (1 - targetDropPercent / 100);
    const intercept = yMean - slope * xMean;
    const predictedRep = (targetVelocity - intercept) / slope;
    
    return {
      repsRemaining: Math.max(0, Math.ceil(predictedRep - n)),
      predictedRepNumber: Math.ceil(predictedRep),
      currentRep: n
    };
  }
}


// ============================================================================
// SECTION 3: SET TIMING TRACKER CLASS
// ============================================================================
/**
 * PURPOSE: Track work and rest periods during training for:
 * - Work:rest ratio analysis
 * - Set duration tracking
 * - Rest period timing
 * - Session statistics
 * * HOW IT WORKS:
 * 1. First rep of a set starts the work timer
 * 2. Standing reset (hands at sides) ends the set
 * 3. Rest timer automatically starts after set ends
 * 4. Next rep stops rest timer and starts new set
 * * TRIGGER EVENTS:
 * - onRep(): Called when any rep is detected
 * - onSetEnd(): Called when standing reset is detected
 */
class SetTimingTracker {
  constructor() {
    this.reset();
  }

  /**
   * Reset all timing data - called on session reset
   */
  reset() {
    // Current set tracking
    this.currentSet = {
      number: 0,            // Set number (1-indexed)
      startTime: null,      // Timestamp when set started
      endTime: null,        // Timestamp when set ended
      repCount: 0,          // Reps in current set
      isActive: false       // Is a set currently in progress?
    };
    
    // Rest timer between sets
    this.restTimer = {
      startTime: null,      // When rest started
      isRunning: false,     // Is rest timer active?
      elapsed: 0            // Last recorded rest duration
    };
    
    // History of completed sets
    this.history = [];
    
    // Session-wide statistics
    this.session = {
      totalWorkTime: 0,     // Total milliseconds of work
      totalRestTime: 0,     // Total milliseconds of rest
      avgWorkTime: 0,       // Average set duration
      avgRestTime: 0,       // Average rest duration
      avgWorkRestRatio: 0,  // Average work:rest ratio
      setCount: 0           // Number of completed sets
    };
  }

  /**
   * Called when any rep is detected
   * - Stops rest timer if running
   * - Starts new set if needed
   * - Increments rep count
   * * @returns {Object} Current status
   * * DEBUG: If reps aren't counting, verify this is called in record()
   */
  onRep() {
    const now = Date.now();
    
    // If we were resting, stop rest and start new set
    if (this.restTimer.isRunning) {
      this.stopRestTimer();
      this.startNewSet();
    }
    
    // If no set is active, start one
    if (!this.currentSet.isActive) {
      this.startNewSet();
    }
    
    // Increment rep count
    this.currentSet.repCount++;
    
    return this.getStatus();
  }

  /**
   * Start a new set
   * DEBUG: Called automatically - check if isActive isn't being set properly
   */
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

  /**
   * Called when set ends (standing reset detected)
   * - Records set duration
   * - Updates session statistics
   * - Starts rest timer
   * * @returns {Object|null} Completed set data or null if no valid set
   * * DEBUG: If sets aren't being recorded:
   * - Check if onSetEnd() is being called from onStandingReset()
   * - Verify currentSet.repCount > 0
   */
  onSetEnd() {
    // Don't record empty sets
    if (!this.currentSet.isActive || this.currentSet.repCount === 0) {
      return null;
    }
    
    const now = Date.now();
    this.currentSet.endTime = now;
    this.currentSet.isActive = false;
    
    // Calculate set duration
    const setDuration = this.currentSet.endTime - this.currentSet.startTime;
    
    // Calculate rest before this set (if not first set)
    let restBeforeSet = 0;
    if (this.history.length > 0) {
      const lastSet = this.history[this.history.length - 1];
      restBeforeSet = this.currentSet.startTime - lastSet.endTime;
    }
    
    // Create completed set record
    const completedSet = {
      number: this.currentSet.number,
      duration: setDuration,
      repCount: this.currentSet.repCount,
      restBefore: restBeforeSet,
      workRestRatio: restBeforeSet > 0 ? setDuration / restBeforeSet : 0,
      startTime: this.currentSet.startTime,
      endTime: this.currentSet.endTime
    };
    
    // Add to history
    this.history.push(completedSet);
    
    // Update session stats
    this.session.setCount++;
    this.session.totalWorkTime += setDuration;
    if (restBeforeSet > 0) {
      this.session.totalRestTime += restBeforeSet;
    }
    
    this.updateSessionAverages();
    
    console.log(`✅ [TimingTracker] Set ${completedSet.number}: ${(setDuration/1000).toFixed(1)}s, ${completedSet.repCount} reps`);
    
    // Start rest timer
    this.startRestTimer();
    
    return completedSet;
  }

  /**
   * Start the rest timer (called automatically after set ends)
   */
  startRestTimer() {
    this.restTimer = {
      startTime: Date.now(),
      isRunning: true,
      elapsed: 0
    };
    console.log('⏱️ [TimingTracker] Rest timer started');
  }

  /**
   * Stop the rest timer (called when new rep detected)
   */
  stopRestTimer() {
    if (!this.restTimer.isRunning) return;
    this.restTimer.elapsed = Date.now() - this.restTimer.startTime;
    this.restTimer.isRunning = false;
    console.log(`⏱️ [TimingTracker] Rest complete: ${(this.restTimer.elapsed/1000).toFixed(1)}s`);
  }

  /**
   * Get current rest timer elapsed time (live)
   * @returns {number} Elapsed milliseconds
   */
  getRestTimerElapsed() {
    if (!this.restTimer.isRunning) return this.restTimer.elapsed;
    return Date.now() - this.restTimer.startTime;
  }

  /**
   * Get current set duration (live)
   * @returns {number} Elapsed milliseconds
   */
  getCurrentSetDuration() {
    if (!this.currentSet.isActive || !this.currentSet.startTime) return 0;
    return Date.now() - this.currentSet.startTime;
  }

  /**
   * Update session-wide averages
   */
  updateSessionAverages() {
    if (this.session.setCount === 0) return;
    
    this.session.avgWorkTime = this.session.totalWorkTime / this.session.setCount;
    
    // Calculate average rest (only for sets that had rest before them)
    const setsWithRest = this.history.filter(s => s.restBefore > 0);
    if (setsWithRest.length > 0) {
      this.session.avgRestTime = setsWithRest.reduce((sum, s) => sum + s.restBefore, 0) / setsWithRest.length;
      this.session.avgWorkRestRatio = this.session.avgWorkTime / this.session.avgRestTime;
    }
  }

  /**
   * Format milliseconds as MM:SS
   */
  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format milliseconds as short form (e.g., "45.2s")
   */
  formatTimeShort(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * Get comprehensive status for UI display
   * @returns {Object} All timing data
   * * DEBUG: Use this to verify tracker state in console
   */
  getStatus() {
    const restElapsed = this.getRestTimerElapsed();
    const setDuration = this.getCurrentSetDuration();
    
    return {
      // Current state
      isSetActive: this.currentSet.isActive,
      isResting: this.restTimer.isRunning,
      
      // Current set info
      currentSetNumber: this.currentSet.number || 1,
      currentSetDuration: setDuration,
      currentSetDurationFormatted: this.formatTime(setDuration),
      currentSetReps: this.currentSet.repCount,
      
      // Rest timer
      restElapsed: restElapsed,
      restElapsedFormatted: this.formatTime(restElapsed),
      
      // Last completed set
      lastSet: this.history.length > 0 ? this.history[this.history.length - 1] : null,
      
      // Session stats
      totalSets: this.session.setCount,
      avgWorkTime: this.session.avgWorkTime,
      avgWorkTimeFormatted: this.formatTimeShort(this.session.avgWorkTime),
      avgRestTime: this.session.avgRestTime,
      avgRestTimeFormatted: this.formatTimeShort(this.session.avgRestTime),
      avgWorkRestRatio: this.session.avgWorkRestRatio,
      avgWorkRestRatioFormatted: this.session.avgWorkRestRatio > 0 
        ? `1:${(1/this.session.avgWorkRestRatio).toFixed(1)}` 
        : '---',
      
      // Full history
      setHistory: [...this.history]
    };
  }
}


// ============================================================================
// SECTION 4: CALIBRATION SYSTEM CLASS
// ============================================================================
/**
 * PURPOSE: Convert pixel measurements to real-world centimeters using
 * the user's known height as a reference.
 * * THE "RULER" CONCEPT:
 * - User enters their actual height in inches
 * - During calibration, we measure ankle-to-nose distance in pixels
 * - Since height is to top of head (not nose), we subtract nose-to-head offset
 * - This gives us a pixel-to-cm ratio that applies to the entire body
 * * CALIBRATION FORMULA:
 * Ankle-to-Nose (cm) = User Height (cm) - Nose-to-Head Offset (cm)
 * Pixel-to-CM Ratio = Ankle-to-Nose (cm) / Ankle-to-Nose (pixels)
 * * WHY THIS MATTERS:
 * - Velocity calculations require real-world distance
 * - Camera distance affects pixel measurements
 * - Different body proportions need individual calibration
 */
class CalibrationSystem {
  constructor() {
    // Configuration constants
    this.CALIBRATION_FRAMES = 60;       // Capture 60 frames (~2 seconds at 30fps)
    this.NOSE_TO_HEAD_OFFSET_CM = 11;   // Average distance from nose to top of head

    // State machine for calibration process
    this.state = {
      phase: "WAITING_FOR_HEIGHT",  // WAITING_FOR_HEIGHT -> CAPTURING -> COMPLETE
      
      // User input
      userHeightInches: null,
      userHeightCm: null,
      ankleToNoseCm: null,           // Calculated from height minus nose-to-head
      
      // Capture buffers
      framesCaptured: 0,
      ankleToNosePixelSamples: [],   // Array of measurements for median calculation
      
      // Final results
      pixelToCmRatio: null,          // The magic conversion factor
      
      // Body segment measurements (populated during calibration)
      bodySegments: {
        torso: null,         // shoulder-to-hip distance
        thigh: null,         // hip-to-knee distance
        shin: null,          // knee-to-ankle distance
        upperArm: null,      // shoulder-to-elbow distance
        forearm: null,       // elbow-to-wrist distance
        ankleToNose: null    // the calibration ruler distance
      }
    };
  }

  /**
   * Step 1: User enters their height in inches
   * @param {number} inches - User's height in inches
   * @returns {Object} Height in cm and estimated ankle-to-nose distance
   * * DEBUG: Height validation is in the UI handler, not here
   */
  setUserHeight(inches) {
    this.state.userHeightInches = inches;
    this.state.userHeightCm = inches * 2.54;
    this.state.ankleToNoseCm = this.state.userHeightCm - this.NOSE_TO_HEAD_OFFSET_CM;
    this.state.phase = "CAPTURING";

    console.log(`📏 [Calibration] User Height: ${inches}" = ${this.state.userHeightCm.toFixed(1)}cm`);
    console.log(`📏 [Calibration] Ankle-to-Nose (estimated): ${this.state.ankleToNoseCm.toFixed(1)}cm`);

    return {
      heightCm: this.state.userHeightCm,
      ankleToNoseCm: this.state.ankleToNoseCm
    };
  }

  /**
   * Step 2: Capture calibration frames
   * User should stand upright, facing camera, arms at sides
   * * @param {Object} pose - Pose data with LEFT/RIGHT landmarks
   * @param {number} canvasHeight - Canvas height in pixels
   * @returns {Object|null} Capture status or null if not in capturing phase
   * * DEBUG: If calibration stalls:
   * - Check phase is "CAPTURING"
   * - Verify pose has valid LEFT/RIGHT data
   * - Ensure ankles and nose landmarks are detected
   */
  captureFrame(pose, canvasHeight) {
    if (this.state.phase !== "CAPTURING") return null;

    // Need both sides for accurate measurement
    if (!pose.LEFT || !pose.RIGHT) return null;

    // Get ankle and nose positions
    const leftAnkle = pose.LEFT.ANKLE;
    const rightAnkle = pose.RIGHT.ANKLE;
    const nose = pose.LEFT.NOSE;  // Nose is same landmark for both sides

    if (!leftAnkle || !rightAnkle || !nose) return null;

    // Average ankle Y position (normalized 0-1)
    const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;

    // Calculate ankle-to-nose distance in pixels
    // Note: In normalized coordinates, y increases downward
    // So ankle.y > nose.y when standing upright
    const ankleToNoseNormalized = avgAnkleY - nose.y;
    const ankleToNosePixels = ankleToNoseNormalized * canvasHeight;

    // Validate pose - person must be reasonably upright
    // (ankle should be below nose by at least 30% of canvas height)
    if (ankleToNosePixels < canvasHeight * 0.3) {
      return { status: "INVALID_POSE", message: "Stand upright facing camera" };
    }

    // Add to samples
    this.state.ankleToNosePixelSamples.push(ankleToNosePixels);
    this.state.framesCaptured++;

    const progress = this.state.framesCaptured / this.CALIBRATION_FRAMES;

    // Check if we have enough samples
    if (this.state.framesCaptured >= this.CALIBRATION_FRAMES) {
      return this.finalizeCalibration(pose, canvasHeight);
    }

    return {
      status: "CAPTURING",
      progress: progress,
      framesRemaining: this.CALIBRATION_FRAMES - this.state.framesCaptured
    };
  }

  /**
   * Step 3: Calculate final calibration ratio
   * Uses median of samples for robustness against outliers
   * * DEBUG: If ratio seems wrong, check:
   * - ankleToNosePixelSamples should have ~60 samples
   * - medianAnkleToNosePixels should be reasonable (300-600 typically)
   */
  finalizeCalibration(pose, canvasHeight) {
    // Use median for robustness against outliers
    const sortedSamples = [...this.state.ankleToNosePixelSamples].sort((a, b) => a - b);
    const medianAnkleToNosePixels = sortedSamples[Math.floor(sortedSamples.length / 2)];

    // Calculate the magic ratio: cm per pixel
    this.state.pixelToCmRatio = this.state.ankleToNoseCm / medianAnkleToNosePixels;

    // Measure all body segments using final pose
    this.measureBodySegments(pose, canvasHeight);

    this.state.phase = "COMPLETE";

    console.log("✅ [Calibration] Complete!");
    console.log(`📏 [Calibration] Ankle-to-Nose: ${medianAnkleToNosePixels.toFixed(1)}px = ${this.state.ankleToNoseCm.toFixed(1)}cm`);
    console.log(`📐 [Calibration] Pixel-to-CM Ratio: ${this.state.pixelToCmRatio.toFixed(4)} cm/px`);
    console.log("📊 [Calibration] Body Segments:", this.state.bodySegments);

    return {
      status: "COMPLETE",
      pixelToCmRatio: this.state.pixelToCmRatio,
      bodySegments: this.state.bodySegments
    };
  }

  /**
   * Measure all body segments using the calibration ratio
   * Called once at end of calibration to record body proportions
   */
  measureBodySegments(pose, canvasHeight) {
    const ratio = this.state.pixelToCmRatio;

    // Helper: calculate distance in pixels between two landmarks
    const distancePixels = (a, b) => {
      const dx = (a.x - b.x) * canvasHeight;  // Using height for both axes
      const dy = (a.y - b.y) * canvasHeight;
      return Math.hypot(dx, dy);
    };

    // Helper: average distance from both sides for accuracy
    const avgSegment = (leftA, leftB, rightA, rightB) => {
      const leftDist = distancePixels(leftA, leftB);
      const rightDist = distancePixels(rightA, rightB);
      return ((leftDist + rightDist) / 2) * ratio;
    };

    // Measure each body segment
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
  }

  /**
   * Convert any pixel measurement to centimeters
   * @param {number} pixels - Distance in pixels
   * @returns {number|null} Distance in centimeters or null if not calibrated
   */
  pixelsToCm(pixels) {
    if (!this.state.pixelToCmRatio) {
      console.warn("[Calibration] Not complete - cannot convert pixels");
      return null;
    }
    return pixels * this.state.pixelToCmRatio;
  }

  /**
   * Get pixels-per-meter for velocity calculations
   * This is what VBTStateMachine needs for velocity
   * * @returns {number|null} Pixels per meter or null if not calibrated
   */
  getPixelsPerMeter() {
    if (!this.state.pixelToCmRatio) return null;
    // Invert and scale: cm/px → px/m
    return 100 / this.state.pixelToCmRatio;
  }

  /**
   * Get full arm length in cm (upper arm + forearm)
   * Used for snatch overhead detection threshold
   */
  getArmLengthCm() {
    if (!this.state.bodySegments.upperArm || !this.state.bodySegments.forearm) {
      return null;
    }
    return this.state.bodySegments.upperArm + this.state.bodySegments.forearm;
  }

  /**
   * Get full arm length in pixels
   * Inverse of arm length in cm
   */
  getArmLengthPixels() {
    const armCm = this.getArmLengthCm();
    if (!armCm || !this.state.pixelToCmRatio) return null;
    return armCm / this.state.pixelToCmRatio;
  }

  /**
   * Check if calibration is complete
   */
  isComplete() {
    return this.state.phase === "COMPLETE";
  }

  /**
   * Reset calibration - user must recalibrate
   */
  reset() {
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
      }
    };
  }
}


// ============================================================================
// SECTION 5: VBT STATE MACHINE CLASS
// ============================================================================
/**
 * PURPOSE: Detect and classify kettlebell movements (Clean, Press, Snatch, Swing)
 * and track velocity for each repetition.
 * * STATE MACHINE PHASES:
 * - IDLE: Waiting for movement to start, detecting starting position
 * - MOVING: Tracking active movement, waiting for completion criteria
 * - RETURNING: Movement peaked, waiting for return to start position
 * - SETTLING: Brief pause after snatch to stabilize before next rep
 * * MOVEMENT CLASSIFICATION LOGIC:
 * * CLEAN: Below hip → elbow folds → wrist reaches rack → hold at rack
 * PRESS: Rack position → overhead lockout → return to rack
 * SNATCH: Below hip → stays extended → overhead lockout → return below hip
 * SWING: Below hip → swing height (above hip, below nose) → return below hip
 * * KEY THRESHOLDS:
 * - Elbow angle < 20° = Rack position (arm bent)
 * - Elbow angle > 160° = Lockout (arm straight)
 * - Wrist above shoulder by 30%+ arm length = Overhead
 * * DEBUG: Most issues come from threshold tuning. Check THRESHOLDS object.
 */
class VBTStateMachine {
  constructor(canvasHeight = 720, calibrationSystem = null) {
    this.canvasHeight = canvasHeight;
    this.calibrationSystem = calibrationSystem;

    // -------------------------------------------------------------------------
    // THRESHOLDS - Tune these for different users/setups
    // -------------------------------------------------------------------------
    this.THRESHOLDS = {
      // --- Elbow Angle Thresholds (degrees) ---
      RACK_ELBOW_MAX: 20,           // Elbow under 20° = rack position (arm very bent)
      LOCKOUT_ELBOW_MIN: 160,       // Elbow over 160° = locked out (arm straight)
      
      // --- Hold Duration Thresholds (frames at 30fps) ---
      RACK_HOLD_FRAMES: 30,         // ~1.5 sec to confirm rack position
      LOCKOUT_HOLD_FRAMES: 0,       // ~0 sec for overhead lockout (immediate)
      OVERHEAD_HOLD_FRAMES: 3,      // ~0.1 sec to confirm overhead for re-snatch
      
      // --- Position Thresholds (normalized 0-1) ---
      WRIST_NEAR_SHOULDER: 0.08,    // Wrist within 8% of shoulder height for rack
      WRIST_OVERHEAD: 0.0,          // Wrist above nose by 0% (exactly above nose)
      TUCKED_MAX: 0.1,              // Max elbow-to-hip x-distance for rack
      ALIGN_MAX: 0.1,               // Max shoulder-wrist x-distance for lockout
      
      // --- Snatch Detection ---
      // Wrist must be this % of arm length above shoulder for snatch lockout
      // Lower threshold (30%) catches re-snatches which don't go quite as high
      SNATCH_ARM_EXTENSION_RATIO: 0.30,
      
      // --- Velocity Calculation ---
      VELOCITY_ALPHA: 0.15,         // Smoothing factor for velocity
      POSITION_ALPHA: 0.3,          // Smoothing factor for position
      MAX_REALISTIC_VELOCITY: 8.0,  // Max velocity in m/s (clamp outliers)
      ZERO_BAND: 0.1,               // Below this velocity = stationary
      MIN_DT: 0.016,                // Min time delta (60fps)
      MAX_DT: 0.1,                  // Max time delta (10fps)
      
      // --- Reset Detection ---
      RESET_DURATION_FRAMES: 30,    // ~1 sec standing still to reset
      
      // --- Post-Snatch Settling ---
      SNATCH_SETTLING_FRAMES: 2     // ~0.07 sec pause after snatch
    };

    // Calibration data for pose detection (separate from height calibration)
    this.calibrationData = {
      isCalibrated: false,
      framesCaptured: 0,
      neutralWristOffset: 0,
      maxTorsoLength: 0
    };

    this.reset();
  }

  /**
   * Reset state machine to initial state
   * Called on session reset or after reset pose detected
   */
  reset() {
    this.state = {
      // --- Side Lock ---
      lockedSide: "unknown",        // Which arm is working (LEFT/RIGHT)
      
      // --- Phase ---
      phase: "IDLE",                // IDLE, MOVING, RETURNING, SETTLING
      
      // --- Starting Position Flags ---
      startedFromRack: false,       // Movement started from rack position
      startedBelowHip: false,       // Movement started below hip
      startedFromOverhead: false,   // Movement started from overhead (re-snatch)
      
      // --- Settling Counter ---
      settlingFrames: 0,            // Frames since snatch completed
      
      // --- Movement Tracking Flags ---
      reachedRack: false,           // Wrist reached rack position
      reachedOverhead: false,       // Wrist went overhead
      reachedLockout: false,        // Elbow locked out AND overhead
      reachedElbowExtension: false, // Elbow extended >160° at any point
      reachedSwingHeight: false,    // Wrist above hip but below nose
      wentBelowHip: false,          // Wrist went below hip during movement
      elbowStayedExtended: true,    // Elbow never folded under 120°
      
      // --- Hold Counters ---
      rackHoldFrames: 15,           // Frames held at rack
      lockoutHoldFrames: 0,         // Frames held at lockout
      
      // --- Velocity Tracking ---
      currentRepPeak: 0,            // Peak velocity this rep
      smoothedVy: 0,                // Smoothed vertical velocity
      
      // --- Timing ---
      lastTimestamp: 0,
      lastWristPos: null,
      
      // --- Calibration Reference ---
      calibration: null,            // Pixels per meter
      resetProgress: 0,             // Progress toward reset pose
      
      // --- Pending Movement ---
      pendingMovement: null,        // Movement type waiting for completion
      
      // --- Smoothed Landmarks ---
      smoothedLandmarks: {
        LEFT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null },
        RIGHT: { WRIST: null, SHOULDER: null, HIP: null, KNEE: null, NOSE: null, ANKLE: null, ELBOW: null }
      }
    };
  }

  /**
   * Calculate elbow angle in degrees
   * @param {Object} shoulder - Shoulder landmark
   * @param {Object} elbow - Elbow landmark
   * @param {Object} wrist - Wrist landmark
   * @returns {number} Angle in degrees (0° = fully flexed, 180° = fully extended)
   * * DEBUG: If angles seem wrong, verify landmark order: shoulder, elbow, wrist
   */
  calculateElbowAngle(shoulder, elbow, wrist) {
    // Vector from elbow to shoulder
    const toShoulder = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
    // Vector from elbow to wrist
    const toWrist = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
    
    // Dot product
    const dot = toShoulder.x * toWrist.x + toShoulder.y * toWrist.y;
    // Magnitudes
    const magShoulder = Math.hypot(toShoulder.x, toShoulder.y);
    const magWrist = Math.hypot(toWrist.x, toWrist.y);
    
    // Angle calculation with clamping to avoid NaN
    const cosAngle = dot / (magShoulder * magWrist);
    const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const angleDeg = angleRad * (180 / Math.PI);
    
    return angleDeg;
  }

  /**
   * Check if wrist is in overhead/snatch lockout position
   * Uses OR logic: returns true if EITHER calibrated check OR fallback check passes
   * * @param {Object} wrist - Wrist landmark
   * @param {Object} shoulder - Shoulder landmark
   * @param {Object} nose - Nose landmark
   * @returns {boolean} True if wrist is overhead
   * * DEBUG: If snatches aren't detecting:
   * - Check calibrationSystem.isComplete()
   * - Verify arm length is calculated correctly
   * - Try lowering SNATCH_ARM_EXTENSION_RATIO
   */
  isWristOverhead(wrist, shoulder, nose) {
    // Try calibration-based check first (more accurate)
    if (this.calibrationSystem && this.calibrationSystem.isComplete()) {
      const armLengthPixels = this.calibrationSystem.getArmLengthPixels();
      if (armLengthPixels) {
        // Calculate vertical distance from shoulder to wrist (in pixels)
        // shoulder.y > wrist.y when wrist is above shoulder (y increases downward)
        const wristAboveShoulderPixels = (shoulder.y - wrist.y) * this.canvasHeight;
        
        // Wrist must be at least 30% of arm length above shoulder
        const threshold = armLengthPixels * this.THRESHOLDS.SNATCH_ARM_EXTENSION_RATIO;
        const isOverheadCalibrated = wristAboveShoulderPixels > threshold;
        
        // If calibrated check passes, return true immediately
        if (isOverheadCalibrated) {
          return true;
        }
        // Fall through to fallback check (OR logic)
      }
    }
    
    // Fallback: wrist above nose (works without calibration)
    const wristOverheadFallback = wrist.y < (nose.y - this.THRESHOLDS.WRIST_OVERHEAD);
    return wristOverheadFallback;
  }
}
