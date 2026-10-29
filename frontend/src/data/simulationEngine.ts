import type {
  VisualizationSnapshot,
  SatelliteSnapshot,
  DebrisTuple,
  StatusResponse,
  BurnsResponse,
  BurnCounterfactualResponse,
  ConjunctionsResponse,
  ConjunctionEvent,
  TrajectoryResponse,
  TrajectoryPoint,
  PendingBurn,
  ExecutedBurn,
  PerSatBurnStats,
  BurnSummary,
} from '../types/api';

const MU_KM3_S2 = 398600.4418;
const R_EARTH_KM = 6378.137;
const OMEGA_EARTH_RAD_S = 7.292115e-5; // 360 deg / 86164s

interface KeplerianSat {
  id: string;
  a_km: number;
  e: number;
  i_rad: number;
  raan_rad: number;
  argp_rad: number;
  M0_rad: number;
  fuel_kg: number;
  status: string;
}

interface KeplerianDebris {
  id: string;
  a_km: number;
  e: number;
  i_rad: number;
  raan_rad: number;
  argp_rad: number;
  M0_rad: number;
}

class SimulationEngine {
  private initialEpochS: number;
  private currentSimEpochS: number;
  private tickCount: number = 42;
  private startTimeMs: number;
  private satellites: KeplerianSat[] = [];
  private debrisCloud: KeplerianDebris[] = [];
  private executedBurns: ExecutedBurn[] = [];
  private pendingBurns: PendingBurn[] = [];
  private conjunctions: ConjunctionEvent[] = [];
  public isFallbackActive: boolean = true;

  constructor() {
    this.startTimeMs = Date.now();
    this.initialEpochS = Math.floor(Date.now() / 1000);
    this.currentSimEpochS = this.initialEpochS;
    this.initConstellation();
    this.initDebrisCloud();
    this.initBurnsAndConjunctions();
  }

  private initConstellation() {
    // 10 Constellation Satellites SAT-67060 .. SAT-67069 in Walker Delta constellation at ~550km
    const altitudes = [548, 552, 550, 555, 549, 551, 553, 547, 550, 554];
    const initialFuels = [46.2, 44.82, 47.1, 43.4, 45.8, 46.0, 42.1, 41.5, 47.9, 45.3];
    const numSats = 10;

    for (let i = 0; i < numSats; i++) {
      const id = `SAT-${67060 + i}`;
      const a_km = R_EARTH_KM + altitudes[i];
      const e = 0.0008;
      const i_rad = (53.05 * Math.PI) / 180;
      // 2 planes of 5 sats each
      const plane = i % 2;
      const slotInPlane = Math.floor(i / 2);
      const raan_rad = ((plane * 180 + slotInPlane * 15) * Math.PI) / 180;
      const M0_rad = ((slotInPlane * 72 + plane * 36) * Math.PI) / 180;

      this.satellites.push({
        id,
        a_km,
        e,
        i_rad,
        raan_rad,
        argp_rad: (45 * Math.PI) / 180,
        M0_rad,
        fuel_kg: initialFuels[i],
        status: i === 1 ? 'NOMINAL' : 'NOMINAL',
      });
    }
  }

  private initDebrisCloud() {
    // Generate 1250 debris items across LEO shells
    // Deterministic pseudo-random sequence
    let seed = 1234567;
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    // Special Threat Debris: DEB-SYNTH-97001 (targeting SAT-67060)
    // Co-orbital intercept tuned for 0.008 km miss distance at TCA T+660s
    this.debrisCloud.push({
      id: 'DEB-SYNTH-97001',
      a_km: this.satellites[0].a_km + 0.004,
      e: 0.0009,
      i_rad: this.satellites[0].i_rad + 0.0001,
      raan_rad: this.satellites[0].raan_rad,
      argp_rad: this.satellites[0].argp_rad,
      // Mean anomaly phased so it meets SAT-67060 at t0 + 660s
      M0_rad: this.satellites[0].M0_rad - (660 * Math.sqrt(MU_KM3_S2 / Math.pow(this.satellites[0].a_km, 3)) * 0.0008),
    });

    // Special Threat Debris: DEB-SYNTH-97101 (targeting SAT-67061)
    this.debrisCloud.push({
      id: 'DEB-SYNTH-97101',
      a_km: this.satellites[1].a_km + 0.015,
      e: 0.0011,
      i_rad: this.satellites[1].i_rad - 0.0002,
      raan_rad: this.satellites[1].raan_rad,
      argp_rad: this.satellites[1].argp_rad,
      M0_rad: this.satellites[1].M0_rad - (1080 * Math.sqrt(MU_KM3_S2 / Math.pow(this.satellites[1].a_km, 3)) * 0.0008),
    });

    // Additional watch / warning catalog debris
    const namedDebris = [
      { id: 'DEB-39451', alt: 560, inc: 53.2 },
      { id: 'DEB-41289', alt: 545, inc: 52.8 },
      { id: 'DEB-51004', alt: 558, inc: 53.5 },
      { id: 'DEB-60192', alt: 552, inc: 53.0 },
      { id: 'DEB-18820', alt: 565, inc: 51.5 },
      { id: 'DEB-28901', alt: 542, inc: 54.0 },
      { id: 'DEB-33104', alt: 549, inc: 53.1 },
      { id: 'DEB-47209', alt: 555, inc: 52.5 },
    ];

    for (const d of namedDebris) {
      this.debrisCloud.push({
        id: d.id,
        a_km: R_EARTH_KM + d.alt,
        e: 0.001 + lcg() * 0.005,
        i_rad: (d.inc * Math.PI) / 180,
        raan_rad: lcg() * 2 * Math.PI,
        argp_rad: lcg() * 2 * Math.PI,
        M0_rad: lcg() * 2 * Math.PI,
      });
    }

    // Remaining background debris up to 1250 items
    for (let i = this.debrisCloud.length; i < 1250; i++) {
      const alt_km = 400 + lcg() * 500; // 400 - 900 km LEO shell
      const inc_deg = 45 + lcg() * 53; // 45 to 98 deg inclination
      this.debrisCloud.push({
        id: `DEB-CAT-${20000 + i}`,
        a_km: R_EARTH_KM + alt_km,
        e: 0.0005 + lcg() * 0.012,
        i_rad: (inc_deg * Math.PI) / 180,
        raan_rad: lcg() * 2 * Math.PI,
        argp_rad: lcg() * 2 * Math.PI,
        M0_rad: lcg() * 2 * Math.PI,
      });
    }
  }

  private initBurnsAndConjunctions() {
    const t0 = this.initialEpochS;

    // Conjunctions matching hackathon scenario
    this.conjunctions = [
      {
        satellite_id: 'SAT-67060',
        debris_id: 'DEB-SYNTH-97001',
        tca: new Date((t0 + 660) * 1000).toISOString(),
        tca_epoch_s: t0 + 660,
        miss_distance_km: 0.008, // 8 meters critical!
        approach_speed_km_s: 14.2,
        sat_pos_eci_km: [4125.4, 2810.1, 4810.6],
        deb_pos_eci_km: [4125.405, 2810.106, 4810.602],
        collision: true,
        severity: 'critical',
        predictive: true,
        fail_open: false,
        tick_id: this.tickCount,
      },
      {
        satellite_id: 'SAT-67061',
        debris_id: 'DEB-SYNTH-97101',
        tca: new Date((t0 + 1080) * 1000).toISOString(),
        tca_epoch_s: t0 + 1080,
        miss_distance_km: 0.024, // 24 meters critical!
        approach_speed_km_s: 11.8,
        sat_pos_eci_km: [-3820.2, 3420.5, 4610.1],
        deb_pos_eci_km: [-3820.218, 3420.512, 4610.114],
        collision: true,
        severity: 'critical',
        predictive: true,
        fail_open: false,
        tick_id: this.tickCount,
      },
      {
        satellite_id: 'SAT-67062',
        debris_id: 'DEB-39451',
        tca: new Date((t0 + 2100) * 1000).toISOString(),
        tca_epoch_s: t0 + 2100,
        miss_distance_km: 1.25,
        approach_speed_km_s: 12.4,
        sat_pos_eci_km: [2100.0, -4200.0, 5100.0],
        deb_pos_eci_km: [2100.9, -4200.7, 5100.4],
        collision: false,
        severity: 'warning',
        predictive: true,
        fail_open: false,
        tick_id: this.tickCount,
      },
      {
        satellite_id: 'SAT-67063',
        debris_id: 'DEB-41289',
        tca: new Date((t0 + 3120) * 1000).toISOString(),
        tca_epoch_s: t0 + 3120,
        miss_distance_km: 3.40,
        approach_speed_km_s: 10.1,
        sat_pos_eci_km: [-1500.0, 4800.0, 4700.0],
        deb_pos_eci_km: [-1502.4, 4801.8, 4701.2],
        collision: false,
        severity: 'watch',
        predictive: true,
        fail_open: false,
        tick_id: this.tickCount,
      },
      {
        satellite_id: 'SAT-67064',
        debris_id: 'DEB-51004',
        tca: new Date((t0 + 4440) * 1000).toISOString(),
        tca_epoch_s: t0 + 4440,
        miss_distance_km: 4.15,
        approach_speed_km_s: 13.5,
        sat_pos_eci_km: [3500.0, 3100.0, -4900.0],
        deb_pos_eci_km: [3503.2, 3101.5, -4897.8],
        collision: false,
        severity: 'watch',
        predictive: true,
        fail_open: false,
        tick_id: this.tickCount,
      },
    ];

    // Pending Auto-COLA Burn to evade DEB-SYNTH-97001
    this.pendingBurns = [
      {
        id: 'BURN-AUTO-67060-01',
        satellite_id: 'SAT-67060',
        burn_epoch: new Date((t0 + 360) * 1000).toISOString(),
        upload_epoch: new Date((t0 - 180) * 1000).toISOString(),
        upload_station: 'ISTRAC Bengaluru',
        delta_v_km_s: [0.00042, 0.0, 0.00008],
        delta_v_norm_km_s: 0.000428,
        auto_generated: true,
        recovery_burn: false,
        graveyard_burn: false,
        scheduled_from_predictive_cdm: true,
        trigger_debris_id: 'DEB-SYNTH-97001',
        trigger_tca: new Date((t0 + 660) * 1000).toISOString(),
        trigger_tca_epoch_s: t0 + 660,
        trigger_miss_distance_km: 0.008,
        trigger_approach_speed_km_s: 14.2,
        trigger_fail_open: false,
      },
      {
        id: 'BURN-REC-67061-01',
        satellite_id: 'SAT-67061',
        burn_epoch: new Date((t0 + 2400) * 1000).toISOString(),
        upload_epoch: new Date((t0 + 600) * 1000).toISOString(),
        upload_station: 'Goldstone',
        delta_v_km_s: [-0.00038, 0.0, 0.0],
        delta_v_norm_km_s: 0.00038,
        auto_generated: true,
        recovery_burn: true,
        graveyard_burn: false,
        scheduled_from_predictive_cdm: false,
      },
    ];

    // Executed burn already on record (SAT-67061 past avoidance maneuver)
    this.executedBurns = [
      {
        id: 'BURN-AUTO-67061-PREV',
        satellite_id: 'SAT-67061',
        burn_epoch: new Date((t0 - 1200) * 1000).toISOString(),
        upload_epoch: new Date((t0 - 1800) * 1000).toISOString(),
        upload_station: 'Goldstone',
        delta_v_km_s: [0.00038, 0.0, 0.0],
        delta_v_norm_km_s: 0.00038,
        fuel_before_kg: 45.0,
        fuel_after_kg: 44.82,
        auto_generated: true,
        recovery_burn: false,
        graveyard_burn: false,
        scheduled_from_predictive_cdm: true,
        trigger_debris_id: 'DEB-SYNTH-97101',
        trigger_tca: new Date((t0 - 600) * 1000).toISOString(),
        trigger_tca_epoch_s: t0 - 600,
        trigger_miss_distance_km: 0.024,
        trigger_approach_speed_km_s: 11.8,
        collision_avoided: true,
        mitigation_tracked: true,
        mitigation_evaluated: true,
        mitigation_miss_distance_km: 2.14,
        mitigation_eval_epoch: new Date((t0 - 540) * 1000).toISOString(),
        mitigation_eval_epoch_s: t0 - 540,
      },
    ];
  }

  // Keplerian propagation to Lat/Lon/Alt and ECI coordinates
  private propagateKeplerian(
    a_km: number,
    _e: number,
    i_rad: number,
    raan_rad: number,
    argp_rad: number,
    M0_rad: number,
    dt_s: number,
  ): {
    lat: number;
    lon: number;
    alt_km: number;
    eci_r: { x: number; y: number; z: number };
    eci_v: { x: number; y: number; z: number };
  } {
    const n = Math.sqrt(MU_KM3_S2 / Math.pow(a_km, 3));
    const M = (M0_rad + n * dt_s) % (2 * Math.PI);
    const theta = M; // Small eccentricity approximation e < 0.001
    const r = a_km;

    const u = theta + argp_rad;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    const cosNode = Math.cos(raan_rad);
    const sinNode = Math.sin(raan_rad);
    const cosI = Math.cos(i_rad);
    const sinI = Math.sin(i_rad);

    // ECI position (km)
    const x = r * (cosNode * cosU - sinNode * sinU * cosI);
    const y = r * (sinNode * cosU + cosNode * sinU * cosI);
    const z = r * (sinU * sinI);

    // ECI velocity (km/s)
    const v_circ = Math.sqrt(MU_KM3_S2 / a_km);
    const vx = -v_circ * (cosNode * sinU + sinNode * cosU * cosI);
    const vy = -v_circ * (sinNode * sinU - cosNode * cosU * cosI);
    const vz = v_circ * (cosU * sinI);

    // Geodetic latitude / longitude
    const lat_rad = Math.asin(Math.max(-1, Math.min(1, z / r)));
    const lat = (lat_rad * 180) / Math.PI;

    const lambda_eci = Math.atan2(y, x);
    const theta_earth = (OMEGA_EARTH_RAD_S * dt_s) % (2 * Math.PI);
    let lon_rad = lambda_eci - theta_earth;
    while (lon_rad > Math.PI) lon_rad -= 2 * Math.PI;
    while (lon_rad < -Math.PI) lon_rad += 2 * Math.PI;
    const lon = (lon_rad * 180) / Math.PI;

    const alt_km = r - R_EARTH_KM;

    return {
      lat,
      lon,
      alt_km,
      eci_r: { x, y, z },
      eci_v: { x: vx, y: vy, z: vz },
    };
  }

  public getSnapshot(): VisualizationSnapshot {
    const dt_s = this.currentSimEpochS - this.initialEpochS;

    const sats: SatelliteSnapshot[] = this.satellites.map((s) => {
      const state = this.propagateKeplerian(
        s.a_km,
        s.e,
        s.i_rad,
        s.raan_rad,
        s.argp_rad,
        s.M0_rad,
        dt_s,
      );
      return {
        id: s.id,
        lat: Number(state.lat.toFixed(4)),
        lon: Number(state.lon.toFixed(4)),
        alt_km: Number(state.alt_km.toFixed(2)),
        eci_r: state.eci_r,
        eci_v: state.eci_v,
        fuel_kg: Number(s.fuel_kg.toFixed(2)),
        status: s.status,
      };
    });

    const debrisCloud: DebrisTuple[] = this.debrisCloud.map((d) => {
      const state = this.propagateKeplerian(
        d.a_km,
        d.e,
        d.i_rad,
        d.raan_rad,
        d.argp_rad,
        d.M0_rad,
        dt_s,
      );
      return [
        d.id,
        Number(state.lat.toFixed(4)),
        Number(state.lon.toFixed(4)),
        Number(state.alt_km.toFixed(1)),
      ];
    });

    return {
      timestamp: new Date(this.currentSimEpochS * 1000).toISOString(),
      satellites: sats,
      debris_cloud: debrisCloud,
    };
  }

  public getStatus(): StatusResponse {
    const elapsedRealS = Math.floor((Date.now() - this.startTimeMs) / 1000);

    return {
      status: 'NOMINAL',
      uptime_s: 3600 + elapsedRealS,
      tick_count: this.tickCount,
      object_count: this.satellites.length + this.debrisCloud.length,
      internal_metrics: {
        satellite_count: this.satellites.length,
        debris_count: this.debrisCloud.length,
        pending_burn_queue: this.pendingBurns.length,
        active_cdm_warnings: this.conjunctions.filter(c => c.severity === 'critical' || c.severity === 'warning').length,
        predictive_conjunction_count: 2,
        history_conjunction_count: 3,
        dropped_burn_count: 0,
        pending_recovery_requests: 1,
        pending_graveyard_requests: 0,
        command_queue_depth: 0,
        command_queue_depth_max: 5,
        command_queue_depth_limit: 50,
        failed_objects_last_tick: 0,
        failed_objects_total: 0,
        command_queue_enqueued_total: 18,
        command_queue_completed_total: 18,
        command_queue_rejected_total: 0,
        command_queue_timeout_total: 0,
        command_latency_us: {
          'POST /api/telemetry': {
            count: 24,
            queue_wait_us_total: 120,
            queue_wait_us_max: 18,
            queue_wait_us_last: 4,
            queue_wait_us_mean: 5.0,
            execution_us_total: 840,
            execution_us_max: 95,
            execution_us_last: 32,
            execution_us_mean: 35.0,
          },
          'POST /api/simulate/step': {
            count: this.tickCount,
            queue_wait_us_total: 150,
            queue_wait_us_max: 22,
            queue_wait_us_last: 6,
            queue_wait_us_mean: 6.2,
            execution_us_total: 3200,
            execution_us_max: 210,
            execution_us_last: 120,
            execution_us_mean: 130.0,
          },
        },
        propagation_last_tick: {
          collisions_detected: 0,
          maneuvers_executed: this.executedBurns.length,
          auto_planned_maneuvers: 2,
          recovery_planned: 1,
          recovery_deferred: 0,
          recovery_completed: 1,
          graveyard_planned: 0,
          graveyard_deferred: 0,
          graveyard_completed: 0,
          upload_window_missed: 0,
          stationkeeping_outside_box: 0,
          stationkeeping_uptime_penalty_mean: 0.0001,
          stationkeeping_slot_radius_error_mean_km: 0.42,
          stationkeeping_slot_radius_error_max_km: 1.15,
          recovery_pending_marked: 0,
          recovery_slot_error_mean: 0.38,
          recovery_slot_error_max: 0.95,
        },
      },
    };
  }

  public getBurns(): BurnsResponse {
    const per_satellite: Record<string, PerSatBurnStats> = {};
    for (const sat of this.satellites) {
      const satExecuted = this.executedBurns.filter(b => b.satellite_id === sat.id);
      const satFuel = satExecuted.reduce((acc, b) => acc + (b.fuel_before_kg - b.fuel_after_kg), 0);
      const satDv = satExecuted.reduce((acc, b) => acc + b.delta_v_norm_km_s, 0);
      per_satellite[sat.id] = {
        burns_executed: satExecuted.length,
        delta_v_total_km_s: satDv,
        fuel_consumed_kg: satFuel,
        collisions_avoided: satExecuted.filter(b => b.collision_avoided).length,
        avoidance_burns_executed: satExecuted.filter(b => !b.recovery_burn).length,
        recovery_burns_executed: satExecuted.filter(b => b.recovery_burn).length,
        graveyard_burns_executed: 0,
        avoidance_fuel_consumed_kg: satFuel,
      };
    }

    const totalFuelConsumed = this.executedBurns.reduce(
      (acc, b) => acc + (b.fuel_before_kg - b.fuel_after_kg),
      0,
    );
    const collisionsAvoided = this.executedBurns.filter(b => b.collision_avoided).length;

    const summary: BurnSummary = {
      burns_executed: this.executedBurns.length,
      burns_pending: this.pendingBurns.length,
      burns_dropped: 0,
      fuel_consumed_kg: Number(totalFuelConsumed.toFixed(2)),
      avoidance_fuel_consumed_kg: Number(totalFuelConsumed.toFixed(2)),
      collisions_avoided: collisionsAvoided,
      avoidance_burns_executed: this.executedBurns.filter(b => !b.recovery_burn).length,
      recovery_burns_executed: this.executedBurns.filter(b => b.recovery_burn).length,
      graveyard_burns_executed: 0,
    };

    return {
      executed: this.executedBurns,
      pending: this.pendingBurns,
      dropped: [],
      per_satellite,
      summary,
    };
  }

  public getConjunctions(satelliteId?: string, source?: string): ConjunctionsResponse {
    let list = this.conjunctions;
    if (satelliteId) {
      list = list.filter(c => c.satellite_id === satelliteId);
    }
    return {
      conjunctions: list,
      count: list.length,
      source: source ?? 'combined',
    };
  }

  public getTrajectory(satelliteId: string): TrajectoryResponse {
    const sat = this.satellites.find(s => s.id === satelliteId) || this.satellites[0];
    const currentDt = this.currentSimEpochS - this.initialEpochS;

    const trail: TrajectoryPoint[] = [];
    // 90 minutes past trail: 90 points (step 60s)
    for (let i = 90; i >= 0; i--) {
      const dt = currentDt - i * 60;
      const state = this.propagateKeplerian(sat.a_km, sat.e, sat.i_rad, sat.raan_rad, sat.argp_rad, sat.M0_rad, dt);
      trail.push({
        epoch_s: this.currentSimEpochS - i * 60,
        lat: Number(state.lat.toFixed(4)),
        lon: Number(state.lon.toFixed(4)),
        alt_km: Number(state.alt_km.toFixed(2)),
        eci: [state.eci_r.x, state.eci_r.y, state.eci_r.z],
      });
    }

    const predicted: TrajectoryPoint[] = [];
    // 90 minutes future prediction: 90 points (step 60s)
    for (let i = 1; i <= 90; i++) {
      const dt = currentDt + i * 60;
      const state = this.propagateKeplerian(sat.a_km, sat.e, sat.i_rad, sat.raan_rad, sat.argp_rad, sat.M0_rad, dt);
      predicted.push({
        epoch_s: this.currentSimEpochS + i * 60,
        lat: Number(state.lat.toFixed(4)),
        lon: Number(state.lon.toFixed(4)),
        alt_km: Number(state.alt_km.toFixed(2)),
        eci: [state.eci_r.x, state.eci_r.y, state.eci_r.z],
      });
    }

    return {
      satellite_id: sat.id,
      trail,
      predicted,
    };
  }

  public getBurnCounterfactual(burnId: string | null): BurnCounterfactualResponse {
    const targetBurn = this.executedBurns.find(b => b.id === burnId) || this.executedBurns[0];
    const burnEpoch = targetBurn?.burn_epoch ?? new Date(this.currentSimEpochS * 1000).toISOString();

    return {
      burn_id: targetBurn?.id ?? 'BURN-AUTO-67061-PREV',
      satellite_id: targetBurn?.satellite_id ?? 'SAT-67061',
      trigger_debris_id: targetBurn?.trigger_debris_id ?? 'DEB-SYNTH-97101',
      compare_basis: 'PROPAGATED_HCW_RK4',
      compare_epoch: burnEpoch,
      burn: {
        burn_epoch: burnEpoch,
        upload_epoch: targetBurn?.upload_epoch ?? burnEpoch,
        upload_station: targetBurn?.upload_station ?? 'Goldstone',
        delta_v_km_s: targetBurn?.delta_v_km_s ?? [0.00038, 0, 0],
        delta_v_norm_km_s: targetBurn?.delta_v_norm_km_s ?? 0.00038,
        fuel_spent_kg: Number(((targetBurn?.fuel_before_kg ?? 45.0) - (targetBurn?.fuel_after_kg ?? 44.82)).toFixed(2)),
      },
      trigger: {
        predicted_tca: targetBurn?.trigger_tca ?? burnEpoch,
        predicted_miss_distance_km: targetBurn?.trigger_miss_distance_km ?? 0.024,
        approach_speed_km_s: targetBurn?.trigger_approach_speed_km_s ?? 11.8,
        fail_open: false,
      },
      actual: {
        evaluated: true,
        fail_open: false,
        min_miss_distance_km: targetBurn?.mitigation_miss_distance_km ?? 2.14,
        min_epoch: targetBurn?.mitigation_eval_epoch ?? burnEpoch,
        collision: false,
        sat_pos_km: [-3820.2, 3420.5, 4610.1],
        deb_pos_km: [-3821.8, 3421.2, 4611.3],
      },
      without_burn: {
        evaluated: true,
        fail_open: false,
        min_miss_distance_km: targetBurn?.trigger_miss_distance_km ?? 0.008,
        min_epoch: targetBurn?.trigger_tca ?? burnEpoch,
        collision: true,
        sat_pos_km: [-3820.2, 3420.5, 4610.1],
        deb_pos_km: [-3820.208, 3420.506, 4610.104],
      },
      delta: {
        clearance_gain_km: 2.132,
        crossed_collision_threshold: true,
        fuel_spent_kg: 0.18,
      },
    };
  }

  public step(stepSeconds: number): {
    status: string;
    new_timestamp: string;
    collisions_detected: number;
    maneuvers_executed: number;
  } {
    this.currentSimEpochS += stepSeconds;
    this.tickCount += Math.max(1, Math.round(stepSeconds / 60));

    let executedInThisStep = 0;

    // Check pending burns that should fire during this stepped interval
    const stillPending: PendingBurn[] = [];
    for (const burn of this.pendingBurns) {
      const burnEpochS = Math.floor(new Date(burn.burn_epoch).getTime() / 1000);
      if (burnEpochS <= this.currentSimEpochS) {
        // Execute the burn!
        executedInThisStep++;
        const sat = this.satellites.find(s => s.id === burn.satellite_id);
        const fuelBefore = sat ? sat.fuel_kg : 45.0;
        const fuelSpent = 0.18; // ~180 grams propellant for ~0.4 m/s in LEO
        const fuelAfter = Math.max(0, fuelBefore - fuelSpent);
        if (sat) {
          sat.fuel_kg = fuelAfter;
          sat.status = 'NOMINAL';
        }

        const executedBurn: ExecutedBurn = {
          id: burn.id,
          satellite_id: burn.satellite_id,
          burn_epoch: burn.burn_epoch,
          upload_epoch: burn.upload_epoch,
          upload_station: burn.upload_station,
          delta_v_km_s: burn.delta_v_km_s,
          delta_v_norm_km_s: burn.delta_v_norm_km_s,
          fuel_before_kg: Number(fuelBefore.toFixed(2)),
          fuel_after_kg: Number(fuelAfter.toFixed(2)),
          auto_generated: burn.auto_generated,
          recovery_burn: burn.recovery_burn,
          graveyard_burn: burn.graveyard_burn,
          scheduled_from_predictive_cdm: burn.scheduled_from_predictive_cdm,
          trigger_debris_id: burn.trigger_debris_id,
          trigger_tca: burn.trigger_tca,
          trigger_tca_epoch_s: burn.trigger_tca_epoch_s,
          trigger_miss_distance_km: burn.trigger_miss_distance_km,
          trigger_approach_speed_km_s: burn.trigger_approach_speed_km_s,
          collision_avoided: true,
          mitigation_tracked: true,
          mitigation_evaluated: true,
          mitigation_miss_distance_km: 2.14,
          mitigation_eval_epoch: new Date((burnEpochS + 300) * 1000).toISOString(),
          mitigation_eval_epoch_s: burnEpochS + 300,
        };

        this.executedBurns.unshift(executedBurn);

        // Mark the conjunction as avoided / mitigated
        if (burn.trigger_debris_id) {
          const conj = this.conjunctions.find(c => c.debris_id === burn.trigger_debris_id);
          if (conj) {
            conj.collision = false;
            conj.miss_distance_km = 2.14;
            conj.severity = 'watch';
          }
        }
      } else {
        stillPending.push(burn);
      }
    }

    this.pendingBurns = stillPending;

    return {
      status: 'OK',
      new_timestamp: new Date(this.currentSimEpochS * 1000).toISOString(),
      collisions_detected: 0,
      maneuvers_executed: executedInThisStep,
    };
  }
}

export const simulationEngine = new SimulationEngine();
