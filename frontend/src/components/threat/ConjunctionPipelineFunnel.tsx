import { useState } from 'react';
import { theme } from '../../styles/theme';
import { GlossaryTooltip } from './ThreatGlossary';

export interface PipelineStage {
  id: string;
  name: string;
  badge: string;
  inputCount: string;
  outputCount: string;
  reduction: string;
  complexity: string;
  summary: string;
  mathFormula: string;
  algorithmDetail: string;
  statusTone: 'accent' | 'primary' | 'warning' | 'critical';
}

const STAGES: PipelineStage[] = [
  {
    id: 'broad-phase',
    name: 'Stage 1: Broad Phase Shell & Band Pruning',
    badge: 'Spatial Indexing',
    inputCount: '27,191 Objects (~369M Pairs)',
    outputCount: '142 Candidate Pairs',
    reduction: '99.96% Pruned',
    complexity: 'O(N log N)',
    summary: 'Screens orbital perigee and apogee shells. If a satellite\'s lowest altitude is higher than a debris\'s highest altitude (or vice-versa), they can NEVER intersect.',
    mathFormula: 'r_{min, sat} > r_{max, deb} \\quad \\lor \\quad r_{max, sat} < r_{min, deb} \\implies \\text{PRUNED}',
    algorithmDetail: 'Objects are sorted into concentric altitude bands and bounding radial shells. This eliminates hundreds of millions of impossible collision pairs in under 1.8 milliseconds without any trigonometry.',
    statusTone: 'primary',
  },
  {
    id: 'plane-screen',
    name: 'Stage 2: Orbital Plane Intersection & Phase Screening',
    badge: 'Geometry',
    inputCount: '142 Candidate Pairs',
    outputCount: '18 Crossing Candidates',
    reduction: '87.3% Pruned',
    complexity: 'O(K)',
    summary: 'Calculates the line of nodes formed by the intersection of the two orbital planes.',
    mathFormula: '\\vec{n}_1 = \\vec{r}_1 \\times \\vec{v}_1, \\quad \\vec{n}_2 = \\vec{r}_2 \\times \\vec{v}_2, \\quad \\vec{L}_{int} = \\vec{n}_1 \\times \\vec{n}_2',
    algorithmDetail: 'Two non-coplanar orbits only intersect along their mutual nodal line vector. The engine checks if the orbital radii at this intersection line overlap within a 25 km safety cylinder.',
    statusTone: 'accent',
  },
  {
    id: 'moid',
    name: 'Stage 3: MOID (Minimum Orbital Intersection Distance)',
    badge: 'Analytic MOID',
    inputCount: '18 Crossing Candidates',
    outputCount: '4 High-Risk Encounters',
    reduction: '77.7% Pruned',
    complexity: 'O(1) per pair',
    summary: 'Computes the absolute minimum geometric distance between the two Keplerian ellipses in 3D space.',
    mathFormula: '\\text{MOID} = \\min_{\\theta_1, \\theta_2} \\|\\vec{r}_1(\\theta_1) - \\vec{r}_2(\\theta_2)\\| < 5.0\\text{ km}',
    algorithmDetail: 'Independent of current object positions. If geometric MOID exceeds 5 km, true collision is physically impossible over the entire 24-hour horizon. Only true crossing geometries pass through.',
    statusTone: 'warning',
  },
  {
    id: 'rk4',
    name: 'Stage 4: Adaptive RK4 Numerical Integration',
    badge: 'J2 Physics ODE',
    inputCount: '4 High-Risk Encounters',
    outputCount: '1 Critical Conjunction (< 100m)',
    reduction: 'Final Precision Refinement',
    complexity: 'O(T / dt)',
    summary: 'High-precision 4th-order Runge-Kutta numerical integration with Earth J2 oblateness perturbation near the TCA encounter epoch.',
    mathFormula: '\\vec{r}_{n+1} = \\vec{r}_n + \\frac{\\Delta t}{6}(k_1 + 2k_2 + 2k_3 + k_4) \\quad \\text{with } J_2 \\text{ field}',
    algorithmDetail: 'Resolves non-linear gravitational perturbations with adaptive sub-stepping (dt down to 1s near TCA). Pinpoints exact miss distance to sub-meter accuracy: Miss = 0.008 km (8 meters) — CRITICAL COLLISION HAZARD.',
    statusTone: 'critical',
  },
  {
    id: 'maneuver',
    name: 'Stage 5: Autonomous RTN Maneuver & Recovery',
    badge: 'COLA Action',
    inputCount: '1 Critical Threat',
    outputCount: 'Zero Collision / Slot Restored',
    reduction: '100% Collision Averted',
    complexity: 'Real-time CW Solver',
    summary: 'Autonomous thruster burn calculated in RTN frame (max 15 m/s, 600s cooldown, ground station LOS verified) followed by Clohessy-Wiltshire recovery back into mission slot.',
    mathFormula: '\\Delta \\vec{v} = [+0.42\\text{ m/s } \\hat{T}], \\quad \\text{CW Recovery: } \\Delta \\vec{v}_{rec} = -\\Delta \\vec{v}_{evade}',
    algorithmDetail: 'The satellite executes a +0.42 m/s tangential burn. Miss distance increases from 8 meters to 5.4 kilometers at TCA epoch. Zero collisions, full mission uptime preserved.',
    statusTone: 'accent',
  },
];

export function ConjunctionPipelineFunnel({
  selectedStageId,
  onSelectStage,
}: {
  selectedStageId?: string;
  onSelectStage?: (stageId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string>(selectedStageId ?? 'broad-phase');

  const currentStage = STAGES.find(s => s.id === activeId) ?? STAGES[0];

  const handleSelect = (id: string) => {
    setActiveId(id);
    onSelectStage?.(id);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: 'linear-gradient(180deg, rgba(12, 15, 22, 0.95), rgba(7, 9, 13, 0.98))',
        border: `1px solid ${theme.colors.border}`,
        clipPath: theme.chamfer.clipPath,
        padding: '14px 16px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <span style={{ color: theme.colors.primary, fontSize: '9px', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            Algorithmic Architecture
          </span>
          <h4 style={{ color: theme.colors.text, margin: '2px 0 0 0', fontSize: '15px', fontWeight: 700 }}>
            Multi-Stage Conjunction Screening Funnel
          </h4>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span
            style={{
              fontSize: '10px',
              color: theme.colors.accent,
              background: 'rgba(34, 197, 94, 0.12)',
              border: `1px solid ${theme.colors.accent}44`,
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            Zero False Negatives Policy
          </span>
          <span
            style={{
              fontSize: '10px',
              color: theme.colors.primary,
              background: 'rgba(88, 184, 255, 0.12)',
              border: `1px solid ${theme.colors.primary}44`,
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            O(N log N) Scalability
          </span>
        </div>
      </div>

      <p style={{ color: theme.colors.textDim, fontSize: '11px', margin: 0, lineHeight: 1.45 }}>
        Checking 27,000+ objects against each other is an <code style={{ color: theme.colors.warning }}>O(N²)</code> bottleneck (369 million pairs). CASCADE uses a 5-stage progressive filter (<GlossaryTooltip term="TCA">TCA</GlossaryTooltip> & <GlossaryTooltip term="MOID">MOID</GlossaryTooltip>) to prune 99.96% of pairs without expensive calculus. Click each stage to inspect its math:
      </p>

      {/* Funnel Progress Steps */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '6px' }}>
        {STAGES.map((stage, idx) => {
          const isSelected = stage.id === activeId;
          const toneColor =
            stage.statusTone === 'critical' ? theme.colors.critical :
            stage.statusTone === 'warning' ? theme.colors.warning :
            stage.statusTone === 'accent' ? theme.colors.accent :
            theme.colors.primary;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => handleSelect(stage.id)}
              style={{
                background: isSelected
                  ? `linear-gradient(180deg, ${toneColor}22, rgba(10, 12, 16, 0.95))`
                  : 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${isSelected ? toneColor : theme.colors.border}`,
                boxShadow: isSelected ? `0 0 12px ${toneColor}33` : 'none',
                borderRadius: '4px',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '9px', color: isSelected ? toneColor : theme.colors.textMuted, fontWeight: 700 }}>
                  STEP {idx + 1}
                </span>
                <span
                  style={{
                    fontSize: '8px',
                    color: toneColor,
                    background: `${toneColor}18`,
                    padding: '1px 4px',
                    borderRadius: '2px',
                  }}
                >
                  {stage.reduction}
                </span>
              </div>
              <span style={{ fontSize: '11px', color: theme.colors.text, fontWeight: 600, lineHeight: 1.2 }}>
                {stage.badge}
              </span>
              <span style={{ fontSize: '9px', color: theme.colors.textDim }}>
                {stage.outputCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Stage Detail Panel */}
      <div
        style={{
          background: 'rgba(5, 7, 10, 0.9)',
          border: `1px solid ${theme.colors.border}`,
          borderRadius: '4px',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: theme.colors.primary, fontSize: '13px', fontWeight: 700 }}>
              {currentStage.name}
            </span>
            <span style={{ fontSize: '9px', color: theme.colors.accent, background: 'rgba(34, 197, 94, 0.1)', padding: '2px 5px', borderRadius: '3px' }}>
              Complexity: {currentStage.complexity}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: theme.colors.textMuted }}>
            Surviving Candidates: <strong style={{ color: theme.colors.text }}>{currentStage.outputCount}</strong>
          </span>
        </div>

        <p style={{ color: theme.colors.text, fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
          {currentStage.summary}
        </p>

        {/* Formula block */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.5)',
            borderLeft: `3px solid ${theme.colors.primary}`,
            padding: '8px 12px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: theme.colors.primary,
            borderRadius: '0 4px 4px 0',
          }}
        >
          {currentStage.mathFormula}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: theme.colors.textDim }}>
          <strong style={{ color: theme.colors.textMuted }}>Under the hood:</strong>
          <span>{currentStage.algorithmDetail}</span>
        </div>
      </div>
    </div>
  );
}
