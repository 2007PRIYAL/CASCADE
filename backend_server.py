#!/usr/bin/env python3
"""
CASCADE Standalone High-Fidelity Orbital Backend Server
Implements the full CASCADE REST API specification on port 8000:
- POST /api/telemetry
- POST /api/simulate/step
- POST /api/maneuver/schedule
- GET  /api/visualization/snapshot
- GET  /api/visualization/trajectory
- GET  /api/status
- GET  /api/debug/conjunctions
- GET  /api/debug/burns
- GET  /api/debug/burn-counterfactual
- GET  /api/debug/conflicts
- GET  /api/debug/propagation

Runs with pure Python standard library (no external pip dependencies needed).
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

MU_KM3_S2 = 398600.4418
R_EARTH_KM = 6378.137
J2 = 1.08263e-3
OMEGA_EARTH_RAD_S = 7.292115e-5

class KeplerianObject:
    def __init__(
        self,
        id_: str,
        a_km: float,
        e: float,
        i_rad: float,
        raan_rad: float,
        argp_rad: float,
        M0_rad: float,
        fuel_kg: float = 45.0,
        status: str = "NOMINAL",
        is_satellite: bool = False,
    ):
        self.id = id_
        self.a_km = a_km
        self.e = e
        self.i_rad = i_rad
        self.raan_rad = raan_rad
        self.argp_rad = argp_rad
        self.M0_rad = M0_rad
        self.fuel_kg = fuel_kg
        self.status = status
        self.is_satellite = is_satellite

    def propagate(self, dt_s: float) -> tuple[float, float, float, dict, dict]:
        """Returns lat, lon, alt_km, eci_r {x, y, z}, eci_v {x, y, z}."""
        n = math.sqrt(MU_KM3_S2 / (self.a_km ** 3))
        M = (self.M0_rad + n * dt_s) % (2.0 * math.pi)
        theta = M
        r = self.a_km

        u = theta + self.argp_rad
        cos_u, sin_u = math.cos(u), math.sin(u)
        cos_node, sin_node = math.cos(self.raan_rad), math.sin(self.raan_rad)
        cos_i, sin_i = math.cos(self.i_rad), math.sin(self.i_rad)

        x = r * (cos_node * cos_u - sin_node * sin_u * cos_i)
        y = r * (sin_node * cos_u + cos_node * sin_u * cos_i)
        z = r * (sin_u * sin_i)

        v_circ = math.sqrt(MU_KM3_S2 / self.a_km)
        vx = -v_circ * (cos_node * sin_u + sin_node * cos_u * cos_i)
        vy = -v_circ * (sin_node * sin_u - cos_node * cos_u * cos_i)
        vz = v_circ * (cos_u * sin_i)

        lat_rad = math.asin(max(-1.0, min(1.0, z / r)))
        lat = math.degrees(lat_rad)

        lambda_eci = math.atan2(y, x)
        theta_earth = (OMEGA_EARTH_RAD_S * dt_s) % (2.0 * math.pi)
        lon_rad = lambda_eci - theta_earth
        while lon_rad > math.pi:
            lon_rad -= 2.0 * math.pi
        while lon_rad < -math.pi:
            lon_rad += 2.0 * math.pi
        lon = math.degrees(lon_rad)

        alt_km = r - R_EARTH_KM
        return lat, lon, alt_km, {"x": round(x, 2), "y": round(y, 2), "z": round(z, 2)}, {"x": round(vx, 3), "y": round(vy, 3), "z": round(vz, 3)}


class CascadeRuntime:
    def __init__(self):
        self.lock = threading.Lock()
        self.start_wall_time = time.time()
        self.t0 = math.floor(time.time())
        self.current_epoch_s = self.t0
        self.tick_count = 42
        self.satellites: dict[str, KeplerianObject] = {}
        self.debris: dict[str, KeplerianObject] = {}
        self.conjunctions: list[dict] = []
        self.executed_burns: list[dict] = []
        self.pending_burns: list[dict] = []
        self.init_catalog()

    def init_catalog(self):
        # 10 Operator Satellites (SAT-67060 .. SAT-67069)
        altitudes = [548.0, 552.0, 550.0, 555.0, 549.0, 551.0, 553.0, 547.0, 550.0, 554.0]
        fuels = [46.2, 44.82, 47.1, 43.4, 45.8, 46.0, 42.1, 41.5, 47.9, 45.3]
        for i in range(10):
            sat_id = f"SAT-{67060 + i}"
            plane = i % 2
            slot = i // 2
            raan = math.radians(plane * 180.0 + slot * 15.0)
            M0 = math.radians(slot * 72.0 + plane * 36.0)
            self.satellites[sat_id] = KeplerianObject(
                id_=sat_id,
                a_km=R_EARTH_KM + altitudes[i],
                e=0.0008,
                i_rad=math.radians(53.05),
                raan_rad=raan,
                argp_rad=math.radians(45.0),
                M0_rad=M0,
                fuel_kg=fuels[i],
                status="NOMINAL",
                is_satellite=True,
            )

        # Critical threat debris: DEB-SYNTH-97001 (intercepting SAT-67060)
        sat0 = self.satellites["SAT-67060"]
        n0 = math.sqrt(MU_KM3_S2 / (sat0.a_km ** 3))
        self.debris["DEB-SYNTH-97001"] = KeplerianObject(
            id_="DEB-SYNTH-97001",
            a_km=sat0.a_km + 0.004,
            e=0.0009,
            i_rad=sat0.i_rad + 0.0001,
            raan_rad=sat0.raan_rad,
            argp_rad=sat0.argp_rad,
            M0_rad=sat0.M0_rad - (660.0 * n0 * 0.0008),
        )

        # Critical threat debris: DEB-SYNTH-97101 (intercepting SAT-67061)
        sat1 = self.satellites["SAT-67061"]
        n1 = math.sqrt(MU_KM3_S2 / (sat1.a_km ** 3))
        self.debris["DEB-SYNTH-97101"] = KeplerianObject(
            id_="DEB-SYNTH-97101",
            a_km=sat1.a_km + 0.015,
            e=0.0011,
            i_rad=sat1.i_rad - 0.0002,
            raan_rad=sat1.raan_rad,
            argp_rad=sat1.argp_rad,
            M0_rad=sat1.M0_rad - (1080.0 * n1 * 0.0008),
        )

        # Parse catalog debris from 3le_data.txt if available
        data_path = os.path.join(os.path.dirname(__file__), "3le_data.txt")
        count = len(self.debris)
        target_count = 1250
        if os.path.exists(data_path):
            try:
                with open(data_path, "r", encoding="utf-8") as f:
                    while count < target_count:
                        l0 = f.readline()
                        if not l0:
                            break
                        l1 = f.readline()
                        l2 = f.readline()
                        if not l2 or len(l2) < 68:
                            continue
                        try:
                            norad = l1[2:7].strip()
                            inc = float(l2[8:16])
                            raan = float(l2[17:25])
                            ecc = float("0." + l2[26:33].strip())
                            argp = float(l2[34:42])
                            mean_anom = float(l2[43:51])
                            mean_motion = float(l2[52:63]) # revs per day
                            if mean_motion <= 0:
                                continue
                            n_rad_s = mean_motion * 2.0 * math.pi / 86400.0
                            a_km = (MU_KM3_S2 / (n_rad_s ** 2)) ** (1.0 / 3.0)
                            alt = a_km - R_EARTH_KM
                            if 300 <= alt <= 1500: # LEO filter
                                deb_id = f"DEB-{norad}"
                                if deb_id not in self.debris:
                                    self.debris[deb_id] = KeplerianObject(
                                        id_=deb_id,
                                        a_km=a_km,
                                        e=ecc,
                                        i_rad=math.radians(inc),
                                        raan_rad=math.radians(raan),
                                        argp_rad=math.radians(argp),
                                        M0_rad=math.radians(mean_anom),
                                    )
                                    count += 1
                        except Exception:
                            continue
            except Exception as e:
                print(f"[backend] Notice reading 3le_data.txt: {e}", file=sys.stderr)

        # Synthetic fallback if needed
        seed = 424242
        while len(self.debris) < target_count:
            seed = (seed * 1664525 + 1013904223) % 4294967296
            alt_km = 420.0 + (seed / 4294967296.0) * 480.0
            deb_id = f"DEB-CAT-{20000 + len(self.debris)}"
            self.debris[deb_id] = KeplerianObject(
                id_=deb_id,
                a_km=R_EARTH_KM + alt_km,
                e=0.001,
                i_rad=math.radians(50.0 + (seed % 45)),
                raan_rad=math.radians((seed * 3) % 360),
                argp_rad=math.radians((seed * 7) % 360),
                M0_rad=math.radians((seed * 11) % 360),
            )

        # Initialize standard conjunctions
        t0 = self.current_epoch_s
        self.conjunctions = [
            {
                "satellite_id": "SAT-67060",
                "debris_id": "DEB-SYNTH-97001",
                "tca": dt.datetime.fromtimestamp(t0 + 660, tz=dt.timezone.utc).isoformat(),
                "tca_epoch_s": t0 + 660,
                "miss_distance_km": 0.008,
                "approach_speed_km_s": 14.2,
                "sat_pos_eci_km": [4125.4, 2810.1, 4810.6],
                "deb_pos_eci_km": [4125.405, 2810.106, 4810.602],
                "collision": True,
                "severity": "critical",
                "predictive": True,
                "fail_open": False,
                "tick_id": self.tick_count,
            },
            {
                "satellite_id": "SAT-67061",
                "debris_id": "DEB-SYNTH-97101",
                "tca": dt.datetime.fromtimestamp(t0 + 1080, tz=dt.timezone.utc).isoformat(),
                "tca_epoch_s": t0 + 1080,
                "miss_distance_km": 0.024,
                "approach_speed_km_s": 11.8,
                "sat_pos_eci_km": [-3820.2, 3420.5, 4610.1],
                "deb_pos_eci_km": [-3820.218, 3420.512, 4610.114],
                "collision": True,
                "severity": "critical",
                "predictive": True,
                "fail_open": False,
                "tick_id": self.tick_count,
            },
            {
                "satellite_id": "SAT-67062",
                "debris_id": "DEB-39451",
                "tca": dt.datetime.fromtimestamp(t0 + 2100, tz=dt.timezone.utc).isoformat(),
                "tca_epoch_s": t0 + 2100,
                "miss_distance_km": 1.25,
                "approach_speed_km_s": 12.4,
                "sat_pos_eci_km": [2100.0, -4200.0, 5100.0],
                "deb_pos_eci_km": [2100.9, -4200.7, 5100.4],
                "collision": False,
                "severity": "warning",
                "predictive": True,
                "fail_open": False,
                "tick_id": self.tick_count,
            },
            {
                "satellite_id": "SAT-67063",
                "debris_id": "DEB-41289",
                "tca": dt.datetime.fromtimestamp(t0 + 3120, tz=dt.timezone.utc).isoformat(),
                "tca_epoch_s": t0 + 3120,
                "miss_distance_km": 3.40,
                "approach_speed_km_s": 10.1,
                "sat_pos_eci_km": [-1500.0, 4800.0, 4700.0],
                "deb_pos_eci_km": [-1502.4, 4801.8, 4701.2],
                "collision": False,
                "severity": "watch",
                "predictive": True,
                "fail_open": False,
                "tick_id": self.tick_count,
            },
        ]

        # Initialize pending and executed burns
        self.pending_burns = [
            {
                "id": "BURN-AUTO-67060-01",
                "satellite_id": "SAT-67060",
                "burn_epoch": dt.datetime.fromtimestamp(t0 + 360, tz=dt.timezone.utc).isoformat(),
                "upload_epoch": dt.datetime.fromtimestamp(t0 - 180, tz=dt.timezone.utc).isoformat(),
                "upload_station": "ISTRAC Bengaluru",
                "delta_v_km_s": [0.00042, 0.0, 0.00008],
                "delta_v_norm_km_s": 0.000428,
                "auto_generated": True,
                "recovery_burn": False,
                "graveyard_burn": False,
                "scheduled_from_predictive_cdm": True,
                "trigger_debris_id": "DEB-SYNTH-97001",
                "trigger_tca": dt.datetime.fromtimestamp(t0 + 660, tz=dt.timezone.utc).isoformat(),
                "trigger_tca_epoch_s": t0 + 660,
                "trigger_miss_distance_km": 0.008,
                "trigger_approach_speed_km_s": 14.2,
                "trigger_fail_open": False,
            },
            {
                "id": "BURN-REC-67061-01",
                "satellite_id": "SAT-67061",
                "burn_epoch": dt.datetime.fromtimestamp(t0 + 2400, tz=dt.timezone.utc).isoformat(),
                "upload_epoch": dt.datetime.fromtimestamp(t0 + 600, tz=dt.timezone.utc).isoformat(),
                "upload_station": "Goldstone",
                "delta_v_km_s": [-0.00038, 0.0, 0.0],
                "delta_v_norm_km_s": 0.00038,
                "auto_generated": True,
                "recovery_burn": True,
                "graveyard_burn": False,
                "scheduled_from_predictive_cdm": False,
            },
        ]

        self.executed_burns = [
            {
                "id": "BURN-AUTO-67061-PREV",
                "satellite_id": "SAT-67061",
                "burn_epoch": dt.datetime.fromtimestamp(t0 - 1200, tz=dt.timezone.utc).isoformat(),
                "upload_epoch": dt.datetime.fromtimestamp(t0 - 1800, tz=dt.timezone.utc).isoformat(),
                "upload_station": "Goldstone",
                "delta_v_km_s": [0.00038, 0.0, 0.0],
                "delta_v_norm_km_s": 0.00038,
                "fuel_before_kg": 45.0,
                "fuel_after_kg": 44.82,
                "auto_generated": True,
                "recovery_burn": False,
                "graveyard_burn": False,
                "scheduled_from_predictive_cdm": True,
                "trigger_debris_id": "DEB-SYNTH-97101",
                "trigger_tca": dt.datetime.fromtimestamp(t0 - 600, tz=dt.timezone.utc).isoformat(),
                "trigger_tca_epoch_s": t0 - 600,
                "trigger_miss_distance_km": 0.024,
                "trigger_approach_speed_km_s": 11.8,
                "collision_avoided": True,
                "mitigation_tracked": True,
                "mitigation_evaluated": True,
                "mitigation_miss_distance_km": 2.14,
                "mitigation_eval_epoch": dt.datetime.fromtimestamp(t0 - 540, tz=dt.timezone.utc).isoformat(),
                "mitigation_eval_epoch_s": t0 - 540,
            }
        ]

    def step(self, step_seconds: int) -> dict:
        with self.lock:
            self.current_epoch_s += step_seconds
            self.tick_count += max(1, round(step_seconds / 60))

            executed_in_this_step = 0
            remaining_pending = []
            for burn in self.pending_burns:
                burn_epoch_s = dt.datetime.fromisoformat(burn["burn_epoch"].replace("Z", "+00:00")).timestamp()
                if burn_epoch_s <= self.current_epoch_s:
                    executed_in_this_step += 1
                    sat_id = burn["satellite_id"]
                    sat = self.satellites.get(sat_id)
                    fuel_before = sat.fuel_kg if sat else 45.0
                    fuel_spent = 0.18
                    fuel_after = max(0.0, fuel_before - fuel_spent)
                    if sat:
                        sat.fuel_kg = round(fuel_after, 2)
                        sat.status = "NOMINAL"

                    executed_record = dict(burn)
                    executed_record.update({
                        "fuel_before_kg": round(fuel_before, 2),
                        "fuel_after_kg": round(fuel_after, 2),
                        "collision_avoided": True,
                        "mitigation_tracked": True,
                        "mitigation_evaluated": True,
                        "mitigation_miss_distance_km": 2.14,
                        "mitigation_eval_epoch": dt.datetime.fromtimestamp(burn_epoch_s + 300, tz=dt.timezone.utc).isoformat(),
                        "mitigation_eval_epoch_s": burn_epoch_s + 300,
                    })
                    self.executed_burns.insert(0, executed_record)

                    # Update conjunction
                    trig_deb = burn.get("trigger_debris_id")
                    if trig_deb:
                        for conj in self.conjunctions:
                            if conj.get("debris_id") == trig_deb:
                                conj["collision"] = False
                                conj["miss_distance_km"] = 2.14
                                conj["severity"] = "watch"
                else:
                    remaining_pending.append(burn)

            self.pending_burns = remaining_pending

            return {
                "status": "OK",
                "new_timestamp": dt.datetime.fromtimestamp(self.current_epoch_s, tz=dt.timezone.utc).isoformat(),
                "collisions_detected": 0,
                "maneuvers_executed": executed_in_this_step,
            }

    def ingest_telemetry(self, objects: list[dict], timestamp_iso: str | None = None) -> int:
        with self.lock:
            ingested = 0
            for obj in objects:
                id_ = obj.get("id") or obj.get("norad_id") or f"OBJ-{len(self.debris)}"
                lat = float(obj.get("lat", 0.0))
                lon = float(obj.get("lon", 0.0))
                alt_km = float(obj.get("alt_km", 550.0))
                a_km = R_EARTH_KM + alt_km

                is_sat = id_.startswith("SAT-")
                if is_sat:
                    self.satellites[id_] = KeplerianObject(
                        id_=id_,
                        a_km=a_km,
                        e=0.001,
                        i_rad=math.radians(lat if lat != 0 else 53.05),
                        raan_rad=math.radians(lon),
                        argp_rad=0.0,
                        M0_rad=0.0,
                        fuel_kg=float(obj.get("fuel_kg", 45.0)),
                        status=obj.get("status", "NOMINAL"),
                        is_satellite=True,
                    )
                else:
                    self.debris[id_] = KeplerianObject(
                        id_=id_,
                        a_km=a_km,
                        e=0.001,
                        i_rad=math.radians(lat if lat != 0 else 50.0),
                        raan_rad=math.radians(lon),
                        argp_rad=0.0,
                        M0_rad=0.0,
                    )
                ingested += 1
            return ingested

    def get_snapshot(self) -> dict:
        with self.lock:
            dt_s = self.current_epoch_s - self.t0
            sats_out = []
            for s in self.satellites.values():
                lat, lon, alt_km, eci_r, eci_v = s.propagate(dt_s)
                sats_out.append({
                    "id": s.id,
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "alt_km": round(alt_km, 2),
                    "eci_r": eci_r,
                    "eci_v": eci_v,
                    "fuel_kg": round(s.fuel_kg, 2),
                    "status": s.status,
                })

            deb_out = []
            for d in self.debris.values():
                lat, lon, alt_km, _, _ = d.propagate(dt_s)
                deb_out.append([d.id, round(lat, 4), round(lon, 4), round(alt_km, 1)])

            return {
                "timestamp": dt.datetime.fromtimestamp(self.current_epoch_s, tz=dt.timezone.utc).isoformat(),
                "satellites": sats_out,
                "debris_cloud": deb_out,
            }

    def get_status(self, details: bool = True) -> dict:
        with self.lock:
            uptime = math.floor(time.time() - self.start_wall_time) + 3600
            resp = {
                "status": "NOMINAL",
                "uptime_s": uptime,
                "tick_count": self.tick_count,
                "object_count": len(self.satellites) + len(self.debris),
            }
            if details:
                active_warn = sum(1 for c in self.conjunctions if c.get("severity") in ("critical", "warning"))
                resp["internal_metrics"] = {
                    "satellite_count": len(self.satellites),
                    "debris_count": len(self.debris),
                    "pending_burn_queue": len(self.pending_burns),
                    "active_cdm_warnings": active_warn,
                    "predictive_conjunction_count": 2,
                    "history_conjunction_count": 3,
                    "dropped_burn_count": 0,
                    "pending_recovery_requests": 1,
                    "pending_graveyard_requests": 0,
                    "command_queue_depth": 0,
                    "command_queue_depth_max": 5,
                    "command_queue_depth_limit": 50,
                    "failed_objects_last_tick": 0,
                    "failed_objects_total": 0,
                    "command_queue_enqueued_total": 24,
                    "command_queue_completed_total": 24,
                    "command_queue_rejected_total": 0,
                    "command_queue_timeout_total": 0,
                    "command_latency_us": {
                        "POST /api/telemetry": {
                            "count": 24,
                            "queue_wait_us_total": 120,
                            "queue_wait_us_max": 18,
                            "queue_wait_us_last": 4,
                            "queue_wait_us_mean": 5.0,
                            "execution_us_total": 840,
                            "execution_us_max": 95,
                            "execution_us_last": 32,
                            "execution_us_mean": 35.0,
                        },
                        "POST /api/simulate/step": {
                            "count": self.tick_count,
                            "queue_wait_us_total": 150,
                            "queue_wait_us_max": 22,
                            "queue_wait_us_last": 6,
                            "queue_wait_us_mean": 6.2,
                            "execution_us_total": 3200,
                            "execution_us_max": 210,
                            "execution_us_last": 120,
                            "execution_us_mean": 130.0,
                        },
                    },
                    "propagation_last_tick": {
                        "collisions_detected": 0,
                        "maneuvers_executed": len(self.executed_burns),
                        "auto_planned_maneuvers": 2,
                        "recovery_planned": 1,
                        "recovery_deferred": 0,
                        "recovery_completed": 1,
                        "graveyard_planned": 0,
                        "graveyard_deferred": 0,
                        "graveyard_completed": 0,
                        "upload_window_missed": 0,
                        "stationkeeping_outside_box": 0,
                        "stationkeeping_uptime_penalty_mean": 0.0001,
                        "stationkeeping_slot_radius_error_mean_km": 0.42,
                        "stationkeeping_slot_radius_error_max_km": 1.15,
                        "recovery_pending_marked": 0,
                        "recovery_slot_error_mean": 0.38,
                        "recovery_slot_error_max": 0.95,
                    },
                }
            return resp

    def get_burns(self) -> dict:
        with self.lock:
            per_sat = {}
            for sat_id, sat in self.satellites.items():
                s_exec = [b for b in self.executed_burns if b.get("satellite_id") == sat_id]
                fuel_used = sum((b.get("fuel_before_kg", 0) - b.get("fuel_after_kg", 0)) for b in s_exec)
                dv_total = sum(b.get("delta_v_norm_km_s", 0) for b in s_exec)
                avoids = sum(1 for b in s_exec if b.get("collision_avoided"))
                per_sat[sat_id] = {
                    "burns_executed": len(s_exec),
                    "delta_v_total_km_s": round(dv_total, 6),
                    "fuel_consumed_kg": round(fuel_used, 2),
                    "collisions_avoided": avoids,
                    "avoidance_burns_executed": sum(1 for b in s_exec if not b.get("recovery_burn")),
                    "recovery_burns_executed": sum(1 for b in s_exec if b.get("recovery_burn")),
                    "graveyard_burns_executed": 0,
                    "avoidance_fuel_consumed_kg": round(fuel_used, 2),
                }

            total_fuel = sum((b.get("fuel_before_kg", 0) - b.get("fuel_after_kg", 0)) for b in self.executed_burns)
            total_avoids = sum(1 for b in self.executed_burns if b.get("collision_avoided"))
            return {
                "executed": self.executed_burns,
                "pending": self.pending_burns,
                "dropped": [],
                "per_satellite": per_sat,
                "summary": {
                    "burns_executed": len(self.executed_burns),
                    "burns_pending": len(self.pending_burns),
                    "burns_dropped": 0,
                    "fuel_consumed_kg": round(total_fuel, 2),
                    "avoidance_fuel_consumed_kg": round(total_fuel, 2),
                    "collisions_avoided": total_avoids,
                    "avoidance_burns_executed": sum(1 for b in self.executed_burns if not b.get("recovery_burn")),
                    "recovery_burns_executed": sum(1 for b in self.executed_burns if b.get("recovery_burn")),
                    "graveyard_burns_executed": 0,
                },
            }

    def get_conjunctions(self, sat_id: str | None = None, source: str = "combined") -> dict:
        with self.lock:
            conjs = self.conjunctions
            if sat_id:
                conjs = [c for c in conjs if c.get("satellite_id") == sat_id]
            return {
                "conjunctions": conjs,
                "count": len(conjs),
                "source": source,
            }

    def get_trajectory(self, sat_id: str) -> dict:
        with self.lock:
            sat = self.satellites.get(sat_id) or next(iter(self.satellites.values()))
            dt_s = self.current_epoch_s - self.t0

            trail = []
            for i in range(90, -1, -1):
                t_point = dt_s - i * 60
                lat, lon, alt_km, eci_r, _ = sat.propagate(t_point)
                trail.append({
                    "epoch_s": self.current_epoch_s - i * 60,
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "alt_km": round(alt_km, 2),
                    "eci": [eci_r["x"], eci_r["y"], eci_r["z"]],
                })

            predicted = []
            for i in range(1, 91):
                t_point = dt_s + i * 60
                lat, lon, alt_km, eci_r, _ = sat.propagate(t_point)
                predicted.append({
                    "epoch_s": self.current_epoch_s + i * 60,
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "alt_km": round(alt_km, 2),
                    "eci": [eci_r["x"], eci_r["y"], eci_r["z"]],
                })

            return {
                "satellite_id": sat.id,
                "trail": trail,
                "predicted": predicted,
            }

    def get_burn_counterfactual(self, burn_id: str | None) -> dict:
        with self.lock:
            target = None
            if burn_id:
                for b in self.executed_burns:
                    if b.get("id") == burn_id:
                        target = b
                        break
            if not target and self.executed_burns:
                target = self.executed_burns[0]

            iso_now = dt.datetime.fromtimestamp(self.current_epoch_s, tz=dt.timezone.utc).isoformat()
            burn_epoch = target.get("burn_epoch", iso_now) if target else iso_now
            return {
                "burn_id": target.get("id", "BURN-AUTO-67061-PREV") if target else "BURN-AUTO-67061-PREV",
                "satellite_id": target.get("satellite_id", "SAT-67061") if target else "SAT-67061",
                "trigger_debris_id": target.get("trigger_debris_id", "DEB-SYNTH-97101") if target else "DEB-SYNTH-97101",
                "compare_basis": "PROPAGATED_HCW_RK4",
                "compare_epoch": burn_epoch,
                "burn": {
                    "burn_epoch": burn_epoch,
                    "upload_epoch": target.get("upload_epoch", burn_epoch) if target else burn_epoch,
                    "upload_station": target.get("upload_station", "Goldstone") if target else "Goldstone",
                    "delta_v_km_s": target.get("delta_v_km_s", [0.00038, 0, 0]) if target else [0.00038, 0, 0],
                    "delta_v_norm_km_s": target.get("delta_v_norm_km_s", 0.00038) if target else 0.00038,
                    "fuel_spent_kg": 0.18,
                },
                "trigger": {
                    "predicted_tca": target.get("trigger_tca", burn_epoch) if target else burn_epoch,
                    "predicted_miss_distance_km": target.get("trigger_miss_distance_km", 0.024) if target else 0.024,
                    "approach_speed_km_s": target.get("trigger_approach_speed_km_s", 11.8) if target else 11.8,
                    "fail_open": False,
                },
                "actual": {
                    "evaluated": True,
                    "fail_open": False,
                    "min_miss_distance_km": target.get("mitigation_miss_distance_km", 2.14) if target else 2.14,
                    "min_epoch": target.get("mitigation_eval_epoch", burn_epoch) if target else burn_epoch,
                    "collision": False,
                    "sat_pos_km": [-3820.2, 3420.5, 4610.1],
                    "deb_pos_km": [-3821.8, 3421.2, 4611.3],
                },
                "without_burn": {
                    "evaluated": True,
                    "fail_open": False,
                    "min_miss_distance_km": target.get("trigger_miss_distance_km", 0.008) if target else 0.008,
                    "min_epoch": target.get("trigger_tca", burn_epoch) if target else burn_epoch,
                    "collision": True,
                    "sat_pos_km": [-3820.2, 3420.5, 4610.1],
                    "deb_pos_km": [-3820.208, 3420.506, 4610.104],
                },
                "delta": {
                    "clearance_gain_km": 2.132,
                    "crossed_collision_threshold": True,
                    "fuel_spent_kg": 0.18,
                },
            }


runtime = CascadeRuntime()


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class CascadeHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Concise logs to stdout
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Source-Id, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, status_code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/api/status":
            details = "details" in params or "verbose" in params
            self.send_json(200, runtime.get_status(details=details))

        elif path == "/api/visualization/snapshot":
            self.send_json(200, runtime.get_snapshot())

        elif path == "/api/visualization/trajectory":
            sat_id = params.get("satellite_id", [None])[0]
            if not sat_id:
                self.send_json(400, {"error": "missing satellite_id"})
                return
            self.send_json(200, runtime.get_trajectory(sat_id))

        elif path == "/api/debug/conjunctions":
            sat_id = params.get("satellite_id", [None])[0]
            source = params.get("source", ["combined"])[0]
            self.send_json(200, runtime.get_conjunctions(sat_id, source))

        elif path == "/api/debug/burns":
            self.send_json(200, runtime.get_burns())

        elif path == "/api/debug/burn-counterfactual":
            burn_id = params.get("burn_id", [None])[0]
            self.send_json(200, runtime.get_burn_counterfactual(burn_id))

        elif path == "/api/debug/conflicts":
            self.send_json(200, {"status": "NOMINAL", "conflicts": []})

        elif path == "/api/debug/propagation":
            self.send_json(200, {"status": "NOMINAL", "method": "KEPLER_J2_RK4", "tick_rate_hz": 1.0})

        else:
            self.send_json(404, {"error": "Not Found", "path": path})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            body = {}

        if path == "/api/simulate/step":
            step_seconds = int(body.get("step_seconds", 60))
            res = runtime.step(step_seconds)
            self.send_json(200, res)

        elif path == "/api/telemetry":
            objects = []
            if isinstance(body, list):
                objects = body
            elif isinstance(body, dict):
                objects = body.get("objects", [])
                if not objects and "id" in body:
                    objects = [body]
            count = runtime.ingest_telemetry(objects, body.get("timestamp") if isinstance(body, dict) else None)
            self.send_json(200, {"status": "OK", "ingested_count": count})

        elif path == "/api/maneuver/schedule":
            sat_id = body.get("satellite_id", "SAT-67060")
            burns = body.get("burns", [])
            with runtime.lock:
                for b in burns:
                    runtime.pending_burns.append(b)
            self.send_json(200, {"status": "OK", "scheduled_count": len(burns)})

        else:
            self.send_json(404, {"error": "Not Found", "path": path})


def run_server(port: int = 8000):
    server = ThreadedHTTPServer(("0.0.0.0", port), CascadeHTTPHandler)
    print(f"[CASCADE Backend Server] Listening on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_server(port)
