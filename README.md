<div align="center">

# 🛰️ C . A . S . C . A . D . E

### **Collision Avoidance System for Constellation Automation, Detection & Evasion**

[![Hackathon: Hack Celestia](https://img.shields.io/badge/Hackathon-Hack%20Celestia-7928CA.svg?style=flat&logo=target)](https://github.com/2007PRIYAL/CASCADE)
[![Author: Priyal Gupta](https://img.shields.io/badge/Author-Priyal%20Gupta-0070F3.svg?style=flat&logo=github)](https://github.com/2007PRIYAL)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-brightgreen.svg?logo=python)](backend_server.py)
[![C++20](https://img.shields.io/badge/C%2B%2B-20-blue.svg?logo=cplusplus)](CMakeLists.txt)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?logo=react)](frontend/package.json)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-black.svg?logo=three.js)](frontend/src/components/EarthGlobe.tsx)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg?logo=docker)](Dockerfile)

<p align="center">
  <b>Autonomous, Physics-Aware Constellation Management & Orbital Debris Avoidance in Crowded LEO</b><br>
  <i>Built from scratch for <b>Hack Celestia</b> by <b>Priyal Gupta</b></i>
</p>

[**Architecture Deep Dive**](ARCHITECTURE.md) · [**Quick Start Guide**](#-quick-start-guide) · [**Live Console Views**](#️-mission-console-modules) · [**REST API Reference**](#-rest-api-reference)

</div>

---

## 🌌 Overview

**CASCADE** is an autonomous mission operations and constellation management system built for crowded Low Earth Orbit (LEO), engineered from the ground up by **Priyal Gupta** for **Hack Celestia**. Operating in real time, CASCADE:

1. **High-Capacity Ingestion:** Ingests high-frequency ECI orbital state vectors for **10 operator satellites** and a field of **1,250+ to 27,000+ debris objects**.
2. **Conservative Multi-Stage Conjunction Screening:** Executes conservative multi-stage filtering with $O(N \log N)$ complexity, eliminating $99.96\%$ of non-threatening object pairs without brute-force bottlenecks.
3. **Automated Risk Classification:** Formulates Conjunction Data Messages (CDMs) and detects breaches of the critical **100-meter hard-body safety core**.
4. **Autonomous Maneuver Planning:** Plans optimal evasion burns in the **Radial-Tangential-Normal (RTN)** reference frame.
5. **Contact Window Verification:** Validates line-of-sight across a global ground tracking station network (`ISTRAC Bengaluru`, `Svalbard`, `Goldstone`, `Punta Arenas`, `McMurdo`) before uploading commands.
6. **Station-Keeping Slot Recovery:** Plans **Clohessy-Wiltshire (HCW)** recovery burns to return satellites to their designated mission slots, preserving orbital box uptime and fuel posture.
7. **Counterfactual Scientific Validation:** Evaluates parallel **counterfactual trajectories** (With-Burn vs. Without-Burn) to prove that scheduled burns successfully averted collisions.

---

## 🎯 Key Capabilities & Architectural Innovations

### 1. 3D Orbital Command Deck (Three.js WebGL)
* **Full Constellation Visibility:** Displays all 10 constellation satellites (`SAT-67060` through `SAT-67069`) orbiting in realistic Walker Delta LEO planes (~550 km altitude, $53^\circ$ inclination).
* **Constellation Orbital Highways:** Glowing orbital plane rings encircle Earth, visualizing constellation geometry.
* **Billboard Badges & Status Halos:** Every spacecraft features a floating text callout badge and color-coded status halo (Green = Nominal, Yellow = Maneuvering, Red = Critical Threat).
* **Target Debris Reticle:** Animated pulsing bracket reticle locks onto incoming debris on collision trajectories.
* **Collision Vector & Keep-Out Envelope:** Dashed warning vectors connect satellites to oncoming threats, inside a wireframe safety bubble that flashes critical red on breach.
* **Tactical Encounter HUD:** Live overlay displaying Closing Speed (km/s), Miss Distance in exact meters, and real-time Time of Closest Approach (TCA) countdown, with a smooth 1-click **`[🎯 Focus Close-up]`** cinematic camera lerp.
* **1-Click Fleet Switcher:** Quick-select any satellite or jump back to **`[🌐 Fleet View (All 10)]`**.

### 2. Conjunction Radar & Multi-Stage Screening Funnel
* **Radar Bullseye:** Polar encounter radar with a prominent `<100m CORE>` hazard circle and approach velocity directional vectors.
* **5-Stage Screening Funnel:** Interactive mathematical visualization showing how CASCADE prunes 27,000+ objects down to active warnings without $O(N^2)$ brute-force slowdowns:
  - *Stage 1 (Broad Phase):* Radial distance & altitude shell filtering ($|\Delta r| < 50\text{ km}$).
  - *Stage 2 (Plane Screening):* Relative inclination and nodal geometry pruning.
  - *Stage 3 (MOID Filter):* Minimum Orbit Intersection Distance ($d_{\text{min}} < 5\text{ km}$).
  - *Stage 4 (Narrow Phase):* Numerical Runge-Kutta 4th-Order (RK4) integration with $J_2$ geopotential perturbations.
  - *Stage 5 (Autonomous Action):* Autonomous RTN burn scheduling & ground station upload window validation.
* **Aerospace Glossary:** Searchable interactive modal explaining aerospace terms and formulas: TCA, MOID, RTN, CW/HCW, CDM, $\Delta v$, B-Plane, and $J_2$ oblateness.

### 3. Precision Physics & Maneuver Mechanics
* **Adaptive Integrator:** Fast Keplerian + $J_2$ secular precession analytical propagation ($\dot{\Omega}$, $\dot{\omega}$, $\dot{M}$), with high-precision RK4 integration near close encounters.
* **Tsiolkovsky Propellant Accounting:** Exact mass loss calculations on every burn:
  $$\Delta m = m_0 \left(1 - e^{-\frac{\Delta v}{I_{\text{sp}} g_0}}\right)$$
* **Slot Recovery & Graveyard Deorbit:** Automatic two-impulse recovery returns spacecraft to station-keeping slots; satellites reaching the 5% fuel reserve threshold are safely transitioned to graveyard orbits.
* **Auditable Counterfactual Branches:** Evaluates and plots parallel timeline branches (With-Burn vs. Without-Burn) proving clearance gain (e.g., clearance expanded from 8m to 2.14 km).

---

## ⚡ System Pipeline

```text
 ┌───────────────────────┐         ┌─────────────────────────┐
 │  POST /api/telemetry  │         │  POST /api/simulate/step│
 └──────────┬────────────┘         └────────────┬────────────┘
            │                                   │
            ▼                                   ▼
 ┌───────────────────────────────────────────────────────────┐
 │               In-Process Spaceflight State Store          │
 └──────────────────────────┬────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────┐
 │   Adaptive Orbital Propagation (Kepler + J2 Secular, RK4) │
 └──────────────────────────┬────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────┐
 │   Multi-Stage Conjunction Screening ($O(N \log N)$ Funnel)│
 │   - Shell Overlap -> Plane/Phase Screen -> MOID Filter   │
 └──────────────────────────┬────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────┐
 │   CDM Warning Generator & Risk Classification (RGB Tiers) │
 └──────────────────────────┬────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────┐
 │   Autonomous Maneuver Planner                             │
 │   - RTN Evasion Delta-V Vector Formulation                │
 │   - Ground Station Line-of-Sight Window Verification      │
 │   - Thruster Cooldown (600s) & 15 m/s Impulse Constraints │
 │   - Two-Impulse HCW Station-Keeping Slot Recovery         │
 └──────────────────────────┬────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────┐
 │   REST API Endpoints & Real-Time Three.js Mission Console │
 └───────────────────────────────────────────────────────────┘
```

---

## 📊 Performance Benchmarks

Measured using the high-performance benchmark suite (`tools/phase3_tick_benchmark`):

| Constellation Scale | Debris Field Size | Mean Tick Latency | Algorithm Complexity |
|---|---|---|---|
| **50 Satellites** | 10,000 Debris | **13.3 ms** | $O(N \log N)$ Broad Phase |
| **100 Satellites** | 20,000 Debris | **72.6 ms** | Multi-threaded OpenMP |
| **Full Constellation** | **27,191 Real Space-Track Objects** | **2.1 s** | Full Screening & Propagations |

* **Zero Missed Conjunctions:** Validated against brute-force $O(N^2)$ RK4 numerical integration across all test families.
* **OpenMP Acceleration:** Achieves **31.5% speedup** in the narrow-phase collision filter under 2x scale workloads.

---

## 🚀 Quick Start Guide

CASCADE supports two simple execution paths: **Native Standalone (Zero Dependencies)** or **Containerized (Docker)**.

### Option A: Standalone Quickstart (Mac / Linux / Windows)

No Docker or CMake required! Runs directly using Python 3 and Node.js.

1. **Start the Spaceflight Backend Server (Port 8000):**
   ```bash
   python3 backend_server.py 8000
   ```
   *The backend starts listening on `http://localhost:8000` with the complete spaceflight REST API.*

2. **Start the Frontend Mission Console:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *Open **`http://localhost:5173`** in your browser.*

---

### Option B: Dockerized Deployment

Production-ready multi-stage Docker build:

```bash
# Build the production image
docker build -t cascade:local .

# Run the container
docker run --rm -p 8000:8000 cascade:local
```

Access the unified API and bundled frontend at **`http://localhost:8000`**.

---

## 🧪 Verification & Demo Testing

Run the automated verification suite against the live backend:

```bash
# 1. Verify system readiness and confirmed collision avoidance
python3 scripts/check_demo_readiness.py --api-base http://localhost:8000
```

**Expected Result:**
```json
[demo-readiness]
{
  "verdict": "ready",
  "readiness_score": 82,
  "objects": 1260,
  "predictive_critical_count": 1,
  "executed_burns": 2,
  "fleet_collisions_avoided": 2,
  "fuel_consumed_kg": 0.36
}
[confirmed-avoids]
{"satellite_id": "SAT-67060", "trigger_debris_id": "DEB-SYNTH-97001", "mitigation_miss_distance_km": 2.14, "delta_v_norm_km_s": 0.000428}
{"satellite_id": "SAT-67061", "trigger_debris_id": "DEB-SYNTH-97101", "mitigation_miss_distance_km": 2.14, "delta_v_norm_km_s": 0.00038}
```

```bash
# 2. Advance simulation time by 1 hour (3600 seconds) via REST API
curl -s -X POST http://localhost:8000/api/simulate/step \
  -H "Content-Type: application/json" \
  -d '{"step_seconds": 3600}' | python3 -m json.tool
```

---

## 📡 REST API Reference

All core endpoints conform to standard spaceflight operations specifications on port `8000`:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/telemetry` | Ingests ECI orbital state vectors for satellites and debris cloud |
| `POST` | `/api/simulate/step` | Advances simulation clock by `step_seconds`, propagating orbits and executing burns |
| `POST` | `/api/maneuver/schedule` | Validates, conflict-checks, and queues custom thruster burn sequences |
| `GET`  | `/api/visualization/snapshot` | Returns sub-satellite lat/lon/alt, ECI positions, fuel, and status |
| `GET`  | `/api/visualization/trajectory` | Returns 90-minute historical trail and 90-minute forward predicted trajectory |
| `GET`  | `/api/status?details=1` | Returns engine health, uptime, tick count, latency statistics, and queue depth |
| `GET`  | `/api/debug/conjunctions` | Returns all active and predicted CDMs with miss distances and closing velocities |
| `GET`  | `/api/debug/burns` | Returns logs of executed and pending burns, fuel consumption, and avoidances |
| `GET`  | `/api/debug/burn-counterfactual` | Evaluates parallel counterfactual branches (With-Burn vs. Without-Burn) |

---

## 🖥️ Mission Console Modules

| Route | View | Description |
|---|---|---|
| `#/command` | **Command Deck** | 3D Earth Globe with constellation orbital rings, target debris reticles, 10-satellite selector bar, and live Tactical Encounter HUD. |
| `#/track` | **Ground Track** | Mercator world map showing 90-minute historical trails, forward forecast arcs, ground station footprints, and solar terminator line. |
| `#/threat` | **Threat Deck** | Polar Conjunction Bullseye radar, `<100m CORE>` boundary, approach velocity vectors, 5-stage Screening Funnel, and Aerospace Glossary. |
| `#/burn-ops` | **Burn Operations** | Maneuver Gantt timeline, ground station upload windows, thruster cooldown status, and counterfactual before/after clearance graphs. |
| `#/evasion` | **Evasion Efficiency** | Fleet-wide fuel expenditure vs. collisions averted analytics and Pareto efficiency frontiers. |
| `#/fleet-status` | **Fleet Status** | Real-time telemetry health, propellant heatmap across all 10 spacecraft, and engine latency diagnostics. |

---

## 📁 Repository Structure

```text
├── backend_server.py      # Standalone high-fidelity spaceflight REST API server (port 8000)
├── main.cpp               # C++20 HTTP server entry point
├── src/                   # C++ engine: state store, propagator, screening, maneuver planner
├── frontend/              # React 19 + TypeScript + Three.js mission operations dashboard
│   ├── src/components/    # EarthGlobe, ConjunctionBullseye, ManeuverGantt, FuelHeatmap
│   └── src/pages/         # CommandPage, TrackPage, ThreatPage, BurnOpsPage, FleetStatusPage
├── 3le_data.txt           # Real Space-Track orbital catalog (27,000+ objects)
├── docs/                  # Ground stations network catalog
├── scripts/               # Test gates, readiness checkers, and catalog replay utilities
├── tools/                 # C++ performance benchmarks and validation gates
├── Dockerfile             # Multi-stage production container build (Ubuntu 22.04)
├── docker-compose.yml     # Container orchestration
└── ARCHITECTURE.md        # Technical architecture design documentation
```

---

## 👤 Author

Designed, developed, and engineered by **Priyal Gupta**:
* **GitHub:** [@2007PRIYAL](https://github.com/2007PRIYAL)
* **Project Repository:** [CASCADE](https://github.com/2007PRIYAL/CASCADE)
* **Competition:** Hack Celestia

---

## 📜 Rights & Attribution

Copyright © 2026 **Priyal Gupta**. All rights reserved.  
Engineered exclusively for **Hack Celestia**.
