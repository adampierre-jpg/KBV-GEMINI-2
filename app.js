// app.js - Kettlebell Velocity-Based Training App
// MediaPipe Pose + Gemini AI for real-time velocity monitoring

const apiKey = AIzaSyA2FYwIrWaslnxcMao5bW6ReUqhU7s55mM; // Inject your Google Gemini API key here

// --- CONFIGURATION & STATE ---
const CONFIG = {
    shoulderWidthMeters: 0.40,
    velocitySmoothing: 3,
    repStartThreshold: 0.5,
    repEndThreshold: 0.2,
    baselineReps: 3,
    thresholdWarning: 15,
    thresholdCritical: 20,
    thresholdStop: 25
};

const STATE = {
    isModelLoaded: false,
    isStreaming: false,
    lastVideoTime: -1,
    reps: 0,
    baseline: 0,
    repPeaks: [],
    currentRepPeak: 0,
    isRepActive: false,
    maxDropOff: 0,
    velocityHistory: [],
    wristHistory: [],
    lastTimestamp: 0,
    testComplete: false,
    lastAnalysisText: ""
};

// --- DOM Elements ---
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const uploadInput = document.getElementById("videoUpload");
const analyzeBtn = document.getElementById("analyzeBtn");
const speakBtn = document.getElementById("speakBtn");
const aiContentArea = document.getElementById("ai-content-area");
const aiTextOutput = document.getElementById("ai-text-output");

const ui = {
    status: document.getElementById("connectionStatus"),
    peakVel: document.getElementById("peakVel"),
    currentVel: document.getElementById("currentVel"),
    reps: document.getElementById("repCount"),
    baseline: document.getElementById("baselineVel"),
    dropOff: document.getElementById("dropOff"),
    zoneText: document.getElementById("zoneText"),
    recText: document.getElementById("recommendationText"),
    card: document.getElementById("statusCard"),
    history: document.getElementById("resultsBody")
};

let poseLandmarker = undefined;
let animationId = null;

// --- MEDIAPIPE INITIALIZATION ---
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision-bundle.js";

async function initializePoseLandmarker() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        STATE.isModelLoaded = true;
        ui.status.innerHTML = `<span class="status-dot status-green"></span> AI Ready`;
        ui.status.className = "flex items-center text-xs font-mono bg-slate-800 px-3 py-1 rounded-full text-green-400";
        startBtn.disabled = false;
        console.log("Pose Landmarker loaded");
    } catch (error) {
        console.error("Model load error:", error);
        ui.status.innerHTML = "Error Loading AI";
        ui.status.classList.add("text-red-500");
        alert("Failed to load AI model. Check console.");
    }
}

initializePoseLandmarker();

// --- VIDEO HANDLING ---
startBtn.addEventListener("click", enableCam);

function enableCam() {
    if (!poseLandmarker) {
        alert("Wait for AI model to load.");
        return;
    }

    STATE.isStreaming = true;
    video.classList.remove("no-mirror");

    navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
    }).then(stream => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
        startBtn.innerText = "Camera Active";
        startBtn.classList.add("bg-green-600");
        resetTest();
    }).catch(err => {
        console.error(err);
        alert("Camera access denied.");
    });
}

uploadInput.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = url;
    video.classList.add("no-mirror");
    resetTest();

    video.onloadeddata = () => {
        video.play().catch(console.error);
        predictWebcam();
    };
});

// --- CORE LOOP ---
async function predictWebcam() {
    if (!poseLandmarker || video.videoWidth === 0) {
        animationId = requestAnimationFrame(predictWebcam);
        return;
    }

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    if (STATE.lastVideoTime !== video.currentTime) {
        STATE.lastVideoTime = video.currentTime;

        const timestampMs = STATE.isStreaming ? performance.now() : video.currentTime * 1000;
        const result = await poseLandmarker.detectForVideo(video, timestampMs);
        processResult(result, timestampMs);
    }

    if (STATE.isStreaming || !video.paused) {
        animationId = requestAnimationFrame(predictWebcam);
    }
}

// --- PROCESSING ---
function calculateDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function processResult(result, timestamp) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (result.landmarks.length === 0) {
        canvasCtx.restore();
        return;
    }

    const landmarks = result.landmarks[0];
    const drawingUtils = new DrawingUtils(canvasCtx);
    drawingUtils.drawLandmarks(landmarks, { radius: 3, color: "rgba(255,255,255,0.6)" });
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "rgba(255,255,255,0.3)", lineWidth: 2 });

    // Calibration
    const shoulderDistPx = calculateDistance(landmarks[11], landmarks[12]);
    if (shoulderDistPx < 0.01) {
        canvasCtx.restore();
        return;
    }
    const metersPerPixel = CONFIG.shoulderWidthMeters / shoulderDistPx;

    // Wrist position (right wrist)
    const wristNorm = landmarks[16];
    const wrist = {
        x: wristNorm.x * canvasElement.width,
        y: wristNorm.y * canvasElement.height
    };

    // Velocity
    const deltaTime = (timestamp - STATE.lastTimestamp) / 1000;
    STATE.lastTimestamp = timestamp;

    if (deltaTime > 0 && deltaTime < 1.0 && STATE.wristHistory.length > 0) {
        const prev = STATE.wristHistory[STATE.wristHistory.length - 1];
        const distPx = calculateDistance(prev, wrist);
        const rawVelocity = (distPx * metersPerPixel) / deltaTime;

        STATE.velocityHistory.push(rawVelocity);
        if (STATE.velocityHistory.length > CONFIG.velocitySmoothing) STATE.velocityHistory.shift();

        const velocity = STATE.velocityHistory.reduce((a, b) => a + b, 0) / STATE.velocityHistory.length;
        updateLogic(velocity, wrist);

        canvasCtx.fillStyle = "#22c55e";
        canvasCtx.font = "bold 20px monospace";
        canvasCtx.fillText(`${velocity.toFixed(1)} m/s`, wrist.x + 20, wrist.y);
    }

    STATE.wristHistory.push(wrist);
    if (STATE.wristHistory.length > 5) STATE.wristHistory.shift();

    canvasCtx.restore();
}

// --- REP LOGIC ---
function updateLogic(velocity, wristPos) {
    ui.currentVel.innerText = velocity.toFixed(2);

    if (!STATE.isRepActive && velocity > CONFIG.repStartThreshold) {
        STATE.isRepActive = true;
        STATE.currentRepPeak = velocity;
    }

    if (STATE.isRepActive) {
        if (velocity > STATE.currentRepPeak) STATE.currentRepPeak = velocity;
        if (velocity < CONFIG.repEndThreshold) finishRep();
    }
}

function finishRep() {
    if (STATE.currentRepPeak < 0.8) {
        STATE.isRepActive = false;
        STATE.currentRepPeak = 0;
        return;
    }

    STATE.reps++;
    ui.reps.innerText = STATE.reps;
    ui.peakVel.innerText = STATE.currentRepPeak.toFixed(2);

    if (STATE.reps <= CONFIG.baselineReps) {
        STATE.repPeaks.push(STATE.currentRepPeak);
        if (STATE.reps === CONFIG.baselineReps) {
            STATE.baseline = STATE.repPeaks.reduce((a, b) => a + b, 0) / STATE.repPeaks.length;
            ui.baseline.innerText = STATE.baseline.toFixed(2);
            ui.zoneText.innerText = "BASELINE SET";
            ui.zoneText.className = "text-xl font-bold text-green-400";
            ui.recText.innerText = "Maintain power!";
        }
    } else {
        analyzeDropOff(STATE.currentRepPeak);
    }

    STATE.isRepActive = false;
    STATE.currentRepPeak = 0;
}

function analyzeDropOff(currentPeak) {
    const drop = ((STATE.baseline - currentPeak) / STATE.baseline) * 100;
    const dropFixed = Math.max(0, drop).toFixed(1);
    if (drop > STATE.maxDropOff) STATE.maxDropOff = drop;

    ui.dropOff.innerText = `${dropFixed}%`;

    ui.card.className = "metric-card border-l-4 transition-colors duration-300";
    ui.zoneText.className = "text-xl font-bold";
    document.body.classList.remove("alert-mode");

    if (drop < CONFIG.thresholdWarning) {
        ui.card.classList.add("border-l-green-500");
        ui.zoneText.innerText = "OPTIMAL";
        ui.zoneText.classList.add("text-green-400");
        ui.recText.innerText = "Keep pushing";
    } else if (drop < CONFIG.thresholdCritical) {
        ui.card.classList.add("border-l-yellow-500");
        ui.zoneText.innerText = "FATIGUE ONSET";
        ui.zoneText.classList.add("text-yellow-400");
        ui.recText.innerText = "Power dropping detected";
    } else {
        ui.card.classList.add("border-l-red-500", "bg-red-900/20");
        ui.zoneText.innerText = "THRESHOLD HIT";
        ui.zoneText.classList.add("text-red-500");
        ui.recText.innerText = "STOP TEST - Anaerobic Threshold Reached";
        document.body.classList.add("alert-mode");

        if (!STATE.testComplete) {
            saveResults();
            STATE.testComplete = true;
        }
    }
}

// --- PERSISTENCE ---
function saveResults() {
    const result = {
        date: new Date().toLocaleString(),
        reps: STATE.reps,
        baseline: STATE.baseline.toFixed(2),
        maxDrop: STATE.maxDropOff.toFixed(1),
        status: STATE.maxDropOff >= CONFIG.thresholdCritical ? "Threshold Hit" : "Completed"
    };

    let history = JSON.parse(localStorage.getItem('kb_velocity_history') || '[]');
    history.unshift(result);
    if (history.length > 10) history.pop();
    localStorage.setItem('kb_velocity_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('kb_velocity_history') || '[]');
    if (history.length === 0) {
        ui.history.innerHTML = `<tr><td colspan="5" class="px-3 py-4 text-center text-slate-500">No tests recorded yet</td></tr>`;
        return;
    }

    ui.history.innerHTML = history.map(row => `
        <tr class="border-b border-slate-700 hover:bg-slate-700/50">
            <td class="px-3 py-2 text-xs">${row.date}</td>
            <td class="px-3 py-2 font-mono">${row.reps}</td>
            <td class="px-3 py-2 font-mono">${row.baseline}</td>
            <td class="px-3 py-2 font-mono text-${parseFloat(row.maxDrop) >= 20 ? 'red' : 'green'}-400">${row.maxDrop}%</td>
            <td class="px-3 py-2 text-xs">${row.status}</td>
        </tr>
    `).join('');
}

document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
    if (confirm("Clear all history?")) {
        localStorage.removeItem('kb_velocity_history');
        renderHistory();
    }
});

// --- UTILITIES ---
function resetTest() {
    Object.assign(STATE, {
        reps: 0, baseline: 0, repPeaks: [], currentRepPeak: 0,
        isRepActive: false, maxDropOff: 0, velocityHistory: [],
        testComplete: false, lastAnalysisText: ""
    });

    ui.reps.innerText = "0";
    ui.peakVel.innerText = "0.00";
    ui.baseline.innerText = "--";
    ui.dropOff.innerText = "0%";
    ui.zoneText.innerText = "READY";
    ui.zoneText.className = "text-xl font-bold text-slate-300";
    ui.recText.innerText = "Start 2-3 explosive reps";
    ui.card.className = "metric-card border-l-4 border-l-slate-500";
    document.body.classList.remove("alert-mode");
    aiContentArea.classList.add("hidden");
    aiTextOutput.innerText = "";
}

resetBtn.addEventListener("click", resetTest);

// --- GEMINI AI ---
async function fetchWithBackoff(url, options, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
}

analyzeBtn.addEventListener("click", async () => {
    if (STATE.reps < CONFIG.baselineReps || STATE.baseline === 0) {
        aiContentArea.classList.remove("hidden");
        aiTextOutput.innerText = "⚠️ Complete at least 3 reps to set baseline.";
        return;
    }

    const original = analyzeBtn.innerHTML;
    analyzeBtn.innerHTML = `<span class="loader mr-2"></span> Analyzing...`;
    analyzeBtn.disabled = true;
    aiContentArea.classList.add("hidden");

    try {
        const exercise = document.querySelector('input[name="exercise"]:checked')?.value || "Kettlebell Exercise";

        const prompt = `You are an expert kettlebell and VBT coach.
I just did ${exercise}.
Reps: ${STATE.reps}
Baseline velocity: ${STATE.baseline.toFixed(2)} m/s (first 3 reps avg)
Max drop-off: ${STATE.maxDropOff.toFixed(1)}%

Give a short, encouraging 3-sentence analysis:
1. Power consistency
2. Did I stop at the right time? (target ~20% drop)
3. One recovery tip for next 10 min`;

        const res = await fetchWithBackoff(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            }
        );

        const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
            STATE.lastAnalysisText = text;
            aiTextOutput.innerText = text;
            aiContentArea.classList.remove("hidden");
        }
    } catch (err) {
        console.error(err);
        aiTextOutput.innerText = "AI Coach unavailable.";
        aiContentArea.classList.remove("hidden");
    } finally {
        analyzeBtn.innerHTML = original;
        analyzeBtn.disabled = false;
    }
});

speakBtn.addEventListener("click", async () => {
    if (!STATE.lastAnalysisText) return;

    const original = speakBtn.innerHTML;
    speakBtn.innerHTML = "Generating Audio...";
    speakBtn.disabled = true;

    try {
        const res = await fetchWithBackoff(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: STATE.lastAnalysisText }] }],
                    generationConfig: { responseMimeType: "audio/wav" }
                })
            }
        );

        const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64) {
            const audio = new Audio(`data:audio/wav;base64,${base64}`);
            audio.play();
        }
    } catch (err) {
        console.error(err);
        alert("Speech generation failed.");
    } finally {
        speakBtn.innerHTML = original;
        speakBtn.disabled = false;
    }
});

// Initial render
renderHistory();
// Uses MediaPipe Pose + Gemini AI for real-time power monitoring




