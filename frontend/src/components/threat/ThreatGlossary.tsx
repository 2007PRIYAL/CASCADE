import { useState, type ReactNode } from 'react';
import { theme } from '../../styles/theme';

export interface GlossaryEntry {
  term: string;
  name: string;
  category: 'Screening' | 'Maneuver' | 'Coordinates' | 'Astrodynamics';
  summary: string;
  detail: string;
  formula?: string;
  whyItMatters: string;
}

export const AEROSPACE_GLOSSARY: Record<string, GlossaryEntry> = {
  TCA: {
    term: 'TCA',
    name: 'Time of Closest Approach',
    category: 'Screening',
    summary: 'The exact timestamp when the distance between satellite and debris reaches its absolute minimum.',
    detail: 'Calculated by projecting 3D velocity vectors forward. When relative distance dot-product with relative velocity becomes zero d(r)/dt = 0, the closest approach is reached. If miss distance at TCA is < 100 meters, collision risk is critical.',
    formula: 't_{TCA} = t_0 - \\frac{\\vec{r}_{rel} \\cdot \\vec{v}_{rel}}{|\\vec{v}_{rel}|^2}',
    whyItMatters: 'Determines the deadline by which an evasion thruster burn must be executed.',
  },
  MOID: {
    term: 'MOID',
    name: 'Minimum Orbital Intersection Distance',
    category: 'Screening',
    summary: 'The minimum physical distance between the geometric ellipses of two orbits.',
    detail: 'Independent of where the two spacecraft are in their orbits right now. If MOID is greater than 5 km, the two objects can NEVER collide, even over weeks, completely pruning them from expensive numerical integration.',
    formula: 'MOID = \\min_{\\theta_1, \\theta_2} \\|\\vec{r}_1(\\theta_1) - \\vec{r}_2(\\theta_2)\\|',
    whyItMatters: 'Enables CASCADE to eliminate 95% of candidates before running expensive Runge-Kutta numerical steps.',
  },
  RTN: {
    term: 'RTN Frame',
    name: 'Radial, Tangential, Normal Coordinate Frame',
    category: 'Coordinates',
    summary: 'Spacecraft-centered local coordinate frame used to calculate thruster burns.',
    detail: 'R (Radial) points directly away from Earth center. T (Tangential) points along the satellite orbital velocity vector. N (Normal) points perpendicular to the orbital plane (angular momentum direction).',
    formula: '\\hat{R} = \\frac{\\vec{r}}{|\\vec{r}|}, \\quad \\hat{N} = \\frac{\\vec{r} \\times \\vec{v}}{|\\vec{r} \\times \\vec{v}|}, \\quad \\hat{T} = \\hat{N} \\times \\hat{R}',
    whyItMatters: 'A tangential (+T) burn efficiently raises orbital altitude to clear incoming debris with minimal fuel.',
  },
  CW: {
    term: 'CW Frame & Solver',
    name: 'Clohessy-Wiltshire (Hill) Relative Motion',
    category: 'Maneuver',
    summary: 'Linear differential equations governing relative motion between spacecraft in nearby orbits.',
    detail: 'After an evasion burn pushes a satellite out of its slot, the CW solver computes the optimal 2-impulse recovery burn to smoothly return the satellite back into its original constellation box without drift.',
    formula: '\\ddot{x} - 2n\\dot{y} - 3n^2x = 0, \\quad \\ddot{y} + 2n\\dot{x} = 0, \\quad \\ddot{z} + n^2z = 0',
    whyItMatters: 'Keeps constellation payloads in their designated operational slots to maintain 99.9% uptime.',
  },
  CDM: {
    term: 'CDM',
    name: 'Conjunction Data Message',
    category: 'Screening',
    summary: 'Standardized orbital alert detailing high-risk encounter geometry and covariance.',
    detail: 'Contains object IDs, TCA epoch, miss distance, relative approach speed, covariance matrix, and probability of collision (Pc). CASCADE generates and processes synthetic CDMs up to 24 hours in advance.',
    whyItMatters: 'Acts as the official trigger for autonomous collision avoidance algorithms.',
  },
  DELTAV: {
    term: 'Delta-V (Δv)',
    name: 'Velocity Change Vector',
    category: 'Maneuver',
    summary: 'The instantaneous velocity impulse provided by onboard thrusters in m/s.',
    detail: 'Governed by Tsiolkovsky rocket equation. Each burn depletes fuel: Δm = m * (1 - exp(-Δv / (Isp * g0))). CASCADE enforces a strict 15 m/s cap per burn and 600s thermal cooldown.',
    formula: '\\Delta v = I_{sp} \\cdot g_0 \\cdot \\ln\\left(\\frac{m_0}{m_f}\\right)',
    whyItMatters: 'Fuel is finite; optimizing Δv ensures satellites don\'t exhaust fuel prematurely.',
  },
  BPLANE: {
    term: 'B-Plane',
    name: 'Encounter Target Plane',
    category: 'Astrodynamics',
    summary: 'A 2D plane passing through the target satellite perpendicular to relative velocity.',
    detail: 'Used to project the incoming debris approach coordinates (B·R and B·T). Allows visual bullseye tracking of whether the debris passes inside the 100-meter danger disc.',
    whyItMatters: 'Powers the Conjunction Bullseye Radar display on the Mission Console.',
  },
  J2: {
    term: 'J2 Perturbation',
    name: 'Earth Oblateness Gravitational Harmonic',
    category: 'Astrodynamics',
    summary: 'Gravitational effect caused by Earth bulging at the equator (non-spherical mass).',
    detail: 'Causes satellite orbital planes to precess (nodal precession Ω̇ and argument of perigee drift ω̇). Neglecting J2 causes orbit predictions to drift by kilometers within hours.',
    formula: 'U = -\\frac{\\mu}{r} \\left[ 1 - J_2 \\left(\\frac{R_E}{r}\\right)^2 \\frac{3\\sin^2\\phi - 1}{2} \\right]',
    whyItMatters: 'CASCADE combines J2 secular propagation for speed with adaptive RK4 for close encounters.',
  },
  GRAVEYARD: {
    term: 'Graveyard Orbit',
    name: 'End-of-Life Disposal Orbit',
    category: 'Maneuver',
    summary: 'A safe disposal orbit where depleted satellites are retired out of active traffic.',
    detail: 'When fuel drops below the 5% safety margin, CASCADE preemptively schedules a final burn to raise or de-orbit the spacecraft so it never becomes uncontrolled space debris.',
    whyItMatters: 'Prevents dead satellites from triggering Kessler syndrome cascades.',
  },
};

export function GlossaryTooltip({
  term,
  children,
  showIcon = false,
}: {
  term: keyof typeof AEROSPACE_GLOSSARY | string;
  children?: ReactNode;
  showIcon?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const entry = AEROSPACE_GLOSSARY[term.toUpperCase()] ?? null;

  if (!entry) {
    return <span>{children ?? term}</span>;
  }

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          borderBottom: `1px dotted ${theme.colors.primary}`,
          color: 'inherit',
          transition: 'color 0.2s ease',
        }}
      >
        {children ?? entry.term}
      </span>
      {showIcon && (
        <span
          style={{
            marginLeft: '4px',
            fontSize: '9px',
            color: theme.colors.primary,
            background: 'rgba(88, 184, 255, 0.12)',
            borderRadius: '50%',
            width: '13px',
            height: '13px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}
        >
          ?
        </span>
      )}

      {hovered && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%) translateY(-6px)',
            width: '280px',
            background: 'rgba(9, 12, 18, 0.96)',
            border: `1px solid ${theme.colors.primary}66`,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8), 0 0 16px rgba(88, 184, 255, 0.2)',
            borderRadius: '4px',
            padding: '10px 12px',
            zIndex: 9999,
            pointerEvents: 'none',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            clipPath: theme.chamfer.clipPath,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: theme.colors.primary, fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em' }}>
              {entry.term} — {entry.name}
            </span>
            <span
              style={{
                fontSize: '8px',
                color: theme.colors.accent,
                background: 'rgba(34, 197, 94, 0.14)',
                padding: '2px 5px',
                borderRadius: '3px',
                textTransform: 'uppercase',
              }}
            >
              {entry.category}
            </span>
          </div>
          <p style={{ color: theme.colors.text, fontSize: '11px', margin: 0, lineHeight: 1.4 }}>
            {entry.summary}
          </p>
          <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '5px' }}>
            <span style={{ color: theme.colors.textDim, fontSize: '9px', lineHeight: 1.35, display: 'block' }}>
              <strong style={{ color: theme.colors.textMuted }}>Why it matters:</strong> {entry.whyItMatters}
            </span>
          </div>
        </div>
      )}
    </span>
  );
}

export function ThreatGlossaryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const entries = Object.values(AEROSPACE_GLOSSARY).filter(e => {
    const matchCat = activeCategory === 'All' || e.category === activeCategory;
    const matchQuery = search === '' ||
      e.term.toLowerCase().includes(search.toLowerCase()) ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.summary.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchQuery;
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(4, 6, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '85vh',
          background: 'linear-gradient(180deg, rgba(14, 17, 24, 0.98), rgba(8, 10, 15, 0.99))',
          border: `1px solid ${theme.colors.primary}66`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.9), 0 0 32px rgba(88, 184, 255, 0.15)',
          clipPath: theme.chamfer.clipPath,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${theme.colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ color: theme.colors.primary, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              CASCADE Mission Knowledge Base
            </span>
            <h2 style={{ color: theme.colors.text, margin: 0, fontSize: '20px', fontWeight: 700 }}>
              Aerospace Astrodynamics Glossary
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textMuted,
              padding: '6px 12px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Filter bar */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search concepts (e.g. TCA, MOID, RTN, Fuel)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${theme.colors.border}`,
              padding: '8px 12px',
              color: theme.colors.text,
              fontSize: '13px',
              borderRadius: '4px',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            {['All', 'Screening', 'Maneuver', 'Coordinates', 'Astrodynamics'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                style={{
                  background: activeCategory === cat ? 'rgba(88, 184, 255, 0.2)' : 'transparent',
                  border: `1px solid ${activeCategory === cat ? theme.colors.primary : theme.colors.border}`,
                  color: activeCategory === cat ? theme.colors.primary : theme.colors.textDim,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* List of concepts */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {entries.map(e => (
            <div
              key={e.term}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${theme.colors.border}`,
                padding: '12px 14px',
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ color: theme.colors.primary, fontSize: '15px', fontWeight: 700 }}>
                    {e.term}
                  </span>
                  <span style={{ color: theme.colors.text, fontSize: '13px', fontWeight: 600 }}>
                    {e.name}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '9px',
                    color: theme.colors.accent,
                    background: 'rgba(34, 197, 94, 0.12)',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    textTransform: 'uppercase',
                  }}
                >
                  {e.category}
                </span>
              </div>
              <p style={{ color: theme.colors.textDim, fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                {e.detail}
              </p>
              {e.formula && (
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    padding: '6px 10px',
                    borderRadius: '3px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: theme.colors.primary,
                    borderLeft: `2px solid ${theme.colors.primary}`,
                  }}
                >
                  {e.formula}
                </div>
              )}
              <div style={{ fontSize: '11px', color: theme.colors.warning }}>
                <strong>Why it matters:</strong> {e.whyItMatters}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
