# Iron Eye VBT - Precision Snatch Tracker

A professional velocity-based training (VBT) application built in SvelteKit for tracking kettlebell snatches with precision pose detection, physics calculations, and real-time metrics.

## Core Features

- **Precision Snatch State Machine** - 8-phase detection (FOUNDATIONAL_START, HIKE_PASS, ACCELERATION, PUNCH_THROUGH, LOCKOUT, DROP, BACKSWING, REDIRECT)
- **Multiple Tracking Variants** - Switch between tracking modes:
  - `holistic-finger` - MediaPipe Holistic with finger tracking (recommended)
  - `pose-heavy` - MediaPipe Pose with heavy Kalman filtering
  - `finger-with-kb` - Finger + KB detection backup (planned)
  - `kb-only` - Object detection only (planned)
  - `yolo-kb` - YOLO pose + KB hybrid (planned)
- **Kalman Filtering** - Smooth velocity and position tracking
- **Physics Engine** - Real-time power (watts) and work (joules) calculations
- **Auto Set Detection** - Automatic set start/end based on velocity and position
- **Calibration System** - One-time height calibration for accurate measurements
- **Data Logging** - Silent Notion POST + CSV fallback
- **Minimal Dark UI** - Black base with copper accents (#b87333)
- **Debug Overlay** - Toggle skeleton, angles, and condition checks

## Tech Stack

- **SvelteKit** - Framework
- **TypeScript** - Type safety
- **TailwindCSS** - Styling
- **MediaPipe** - Pose & Holistic tracking
- **ONNX Runtime** - For RT-DETR models (future)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- Webcam access

### Installation

```bash
cd svelte-app
npm install
```

### Development

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build

```bash
npm run build
npm run preview
```

## Usage

1. **Initial Calibration**
   - Click "Start Calibration"
   - Stand tall, arms at sides
   - Hold still for 2 seconds
   - System measures your height from ankle to nose

2. **Start Training**
   - After calibration, start moving
   - System auto-detects when you begin a set
   - Lift performs snatch movement
   - Metrics update in real-time

3. **View Metrics**
   - **Velocity** - Current velocity in m/s (copper)
   - **Peak** - Peak velocity for session
   - **Reps** - Rep counter
   - **Phase** - Current snatch phase
   - **Power** - Instantaneous power in watts
   - **Work** - Total work in joules

4. **Debug Mode**
   - Click "Show Debug" (top-right)
   - See condition checks (green = met, red = not met)
   - View angles for elbow and hip
   - Monitor gating conditions

5. **Recalibrate**
   - Between sets, click "Recalibrate"
   - Only available when static (not mid-set)

## Architecture

### Core Invariants

The `SnatchStateMachine` logic is **unchanged per spec**. All phase transitions, gating conditions, and auto start/end logic remain identical.

### Project Structure

```
svelte-app/
├── src/
│   ├── lib/
│   │   ├── core/
│   │   │   ├── SnatchStateMachine.ts  # 8-phase state machine
│   │   │   ├── KalmanFilter.ts        # Velocity smoothing
│   │   │   ├── Physics.ts             # Power/work calculations
│   │   │   └── Calibration.ts         # Height calibration
│   │   ├── tracking/
│   │   │   ├── TrackingSystem.ts      # Modular tracker
│   │   │   ├── HolisticFingerTracker.ts
│   │   │   └── PoseHeavyTracker.ts
│   │   ├── data/
│   │   │   └── DataLogger.ts          # Notion + CSV logging
│   │   ├── components/
│   │   │   ├── MetricsDisplay.svelte
│   │   │   ├── DebugOverlay.svelte
│   │   │   └── TrailVisualization.svelte
│   │   └── types.ts                   # TypeScript types
│   ├── routes/
│   │   ├── +layout.svelte
│   │   └── +page.svelte               # Main app
│   ├── app.html
│   └── app.css                        # Global styles
├── package.json
├── svelte.config.js
├── tailwind.config.js
└── tsconfig.json
```

### Extending with New Tracking Variants

To add a new tracking variant:

1. **Create Tracker Class**

```typescript
// src/lib/tracking/MyCustomTracker.ts
import { TrackerVariant } from './TrackingSystem';

export class MyCustomTracker extends TrackerVariant {
  async initialize(): Promise<void> {
    // Initialize your model/library
  }

  async track(videoElement, timestamp): Promise<TrackingResult | null> {
    // 1. Run inference
    // 2. Extract pose + tracked point
    // 3. Calculate velocity with this.kalmanFilter
    // 4. Return result
  }

  cleanup(): void {
    // Clean up resources
  }
}
```

2. **Register in TrackingSystem**

```typescript
// src/lib/tracking/TrackingSystem.ts
private async createVariant(mode: TrackingMode): Promise<TrackerVariant> {
  switch (mode) {
    case 'my-custom-mode':
      const { MyCustomTracker } = await import('./MyCustomTracker');
      return new MyCustomTracker();
    // ...
  }
}
```

3. **Update Types**

```typescript
// src/lib/types.ts
export type TrackingMode =
  | 'holistic-finger'
  | 'my-custom-mode'
  | ...;
```

### Physics Calculations

**Power (Concentric):**
```
Power = Force × Velocity = (mass × g) × velocity
```

**Work (Displacement):**
```
Work = Force × Displacement = (mass × g) × Δheight
```

### State Machine Phases

1. **FOUNDATIONAL_START** - Starting position, near floor
2. **HIKE_PASS** - Initial pull, hips hinged, moving up
3. **ACCELERATION** - Peak velocity phase
4. **PUNCH_THROUGH** - Transitioning to lockout
5. **LOCKOUT** - Arm straight, overhead position
6. **DROP** - Controlled descent
7. **BACKSWING** - Kettlebell between legs
8. **REDIRECT** - Transition back to start

### Gating Conditions

- **Near Floor** - Wrist Y > 75% of canvas height
- **Elbow Straight** - Elbow angle > 160°
- **Hips Hinged** - Hip angle < 130°
- **Moving Up** - Velocity > 0.3 m/s
- **Lockout Hold** - Static in lockout for 15+ frames

## Data Logging

### Notion Integration

Set environment variables:

```bash
NOTION_API_KEY=your_api_key
NOTION_DATABASE_ID=your_database_id
```

### CSV Fallback

Session data automatically downloads as CSV on session end:

```csv
Rep,Peak Velocity (m/s),Avg Velocity (m/s),Power (W),Work (J),Phase,Timestamp
1,2.45,1.82,392,156,LOCKOUT,2026-01-04T...
```

## Configuration

### Kettlebell Weight

Edit `kettlebellWeight` in `+page.svelte`:

```typescript
let kettlebellWeight = $state(24); // kg (default: 16)
```

### Tracking Mode

Switch modes:

```typescript
let trackingMode: TrackingMode = $state('pose-heavy');
```

### Calibration

Adjust user height before calibration:

```typescript
let userHeight = $state(180); // cm (default: 170)
```

## Performance Optimization

- **Low-res stream** - Use 1280x720 max resolution
- **Throttle inference** - MediaPipe runs at video frame rate
- **WebGL/WASM** - MediaPipe uses GPU acceleration
- **Minimal re-renders** - Svelte runes for fine-grained reactivity

## UI Design

- **Black base** (`bg-black`)
- **Dark gray panels** (`bg-gray-900/90`)
- **Light gray text** (`text-gray-200`)
- **Copper accents** (`#b87333`) for:
  - Velocity numbers
  - Buttons borders/hover
  - Trail visualization
  - Debug highlights

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari (limited MediaPipe support)

## Future Enhancements

- [ ] RT-DETR ONNX for kettlebell detection
- [ ] YOLOv11 pose integration
- [ ] Advanced analytics dashboard
- [ ] Session comparison
- [ ] Export to training apps
- [ ] Mobile app (React Native)

## License

MIT

## Author

Built for real lifting. Accurate. Minimal. Excellent.
