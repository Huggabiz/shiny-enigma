import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import { WAREHOUSE_KEYS, WAREHOUSE_LABELS } from '../types';
import { CloseIcon } from './Icons';
import './DashboardDialog.css';

interface DashboardDialogProps {
  onClose: () => void;
}

export function DashboardDialog({ onClose }: DashboardDialogProps) {
  const { project } = useProjectStore();
  if (!project) return null;

  const catalogue = project.catalogue;
  const plans = project.plans;
  const stages = useMemo(() => {
    const plan = getActivePlan(project);
    return plan ? getStages(plan, project) : [];
  }, [project]);

  // Catalogue usage
  const usedProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const plan of plans) {
      const planStages = getStages(plan, project);
      for (const stage of planStages) {
        for (const item of stage.shelf.items) {
          if (item.productId) ids.add(item.productId);
        }
      }
    }
    return ids;
  }, [plans, project]);

  const totalSkus = catalogue.length;
  const usedSkus = usedProductIds.size;
  const unusedSkus = totalSkus - usedSkus;
  const usagePct = totalSkus > 0 ? Math.round((usedSkus / totalSkus) * 100) : 0;
  const devSkus = catalogue.filter((p) => p.source === 'dev').length;
  const liveSkus = catalogue.filter((p) => p.source !== 'dev').length;

  // Per-stage SKU counts (across all plans, deduplicated)
  const stageStats = useMemo(() => {
    return stages.map((stage) => {
      const skusAcrossPlans = new Set<string>();
      for (const plan of plans) {
        const planStages = getStages(plan, project);
        const ps = planStages.find((s) => s.key === stage.key);
        if (ps) {
          for (const item of ps.shelf.items) {
            if (item.productId) skusAcrossPlans.add(item.productId);
          }
        }
      }
      // Count dev vs live in this stage
      let devCount = 0;
      let liveCount = 0;
      for (const pid of skusAcrossPlans) {
        const prod = catalogue.find((p) => p.id === pid);
        if (prod?.source === 'dev') devCount++;
        else liveCount++;
      }
      return { name: stage.name, key: stage.key, total: skusAcrossPlans.size, dev: devCount, live: liveCount };
    });
  }, [stages, plans, project, catalogue]);

  // Per-plan summary
  const planStats = useMemo(() => {
    return plans.map((plan) => {
      const planStages = getStages(plan, project);
      const allItems = new Set<string>();
      for (const stage of planStages) {
        for (const item of stage.shelf.items) {
          if (item.productId) allItems.add(item.productId);
        }
      }
      return { name: plan.name, totalSkus: allItems.size, stages: planStages.length, variants: plan.variants.length };
    });
  }, [plans, project]);

  // Lens stats
  const lensStats = useMemo(() => {
    return (project.lenses ?? []).filter((l) => !l.builtInKind).map((lens) => {
      let memberCount = 0;
      if (lens.scope === 'per-stage' && lens.stageProductIds) {
        const unique = new Set<string>();
        for (const ids of Object.values(lens.stageProductIds)) {
          for (const id of ids) unique.add(id);
        }
        memberCount = unique.size;
      } else {
        memberCount = lens.productIds.length;
      }
      return { name: lens.name, scope: lens.scope ?? 'global', members: memberCount };
    });
  }, [project.lenses]);

  // Warehouse volume totals
  const warehouseTotals = useMemo(() => {
    const totals: Record<string, number> = { uk: 0, eu: 0, aus: 0, us: 0, cn: 0 };
    let grandTotal = 0;
    for (const p of catalogue) {
      grandTotal += p.volume ?? 0;
      if (p.warehouseVolumes) {
        for (const k of WAREHOUSE_KEYS) {
          totals[k] += p.warehouseVolumes[k] ?? 0;
        }
      }
    }
    return { totals, total: grandTotal };
  }, [catalogue]);

  // Forecast coverage
  const forecastCount = Object.keys(project.forecastPipelines ?? {}).length;

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="dashboard-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dashboard-header">
          <h2>Dashboard</h2>
          <button className="dashboard-close" onClick={onClose}><CloseIcon size={10} color="#999" /></button>
        </div>

        <div className="dashboard-body">
          {/* Catalogue usage */}
          <div className="dashboard-section">
            <div className="dashboard-section-title">Catalogue Usage</div>
            <div className="dashboard-stat-grid">
              <div className="dashboard-stat">
                <span className="dashboard-stat-value">{totalSkus}</span>
                <span className="dashboard-stat-label">Total SKUs</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-value highlight">{usedSkus}</span>
                <span className="dashboard-stat-label">Used ({usagePct}%)</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-value muted">{unusedSkus}</span>
                <span className="dashboard-stat-label">Unused</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-value dev">{devSkus}</span>
                <span className="dashboard-stat-label">Dev</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-value">{liveSkus}</span>
                <span className="dashboard-stat-label">Live</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-value">{forecastCount}</span>
                <span className="dashboard-stat-label">Forecasted</span>
              </div>
            </div>
            {/* Usage bar */}
            <div className="dashboard-usage-bar">
              <div className="dashboard-usage-fill" style={{ width: `${usagePct}%` }} />
            </div>
          </div>

          {/* SKU count per stage */}
          <div className="dashboard-section">
            <div className="dashboard-section-title">SKUs per Stage</div>
            <div className="dashboard-table">
              <div className="dashboard-table-header">
                <span>Stage</span><span>Total</span><span>Live</span><span>Dev</span>
              </div>
              {stageStats.map((s) => (
                <div key={s.key} className="dashboard-table-row">
                  <span className="dashboard-table-name">{s.name}</span>
                  <span>{s.total}</span>
                  <span>{s.live}</span>
                  <span className="dev">{s.dev}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-plan summary */}
          <div className="dashboard-section">
            <div className="dashboard-section-title">Plans</div>
            <div className="dashboard-table">
              <div className="dashboard-table-header">
                <span>Plan</span><span>SKUs</span><span>Stages</span><span>Variants</span>
              </div>
              {planStats.map((p) => (
                <div key={p.name} className="dashboard-table-row">
                  <span className="dashboard-table-name">{p.name}</span>
                  <span>{p.totalSkus}</span>
                  <span>{p.stages}</span>
                  <span>{p.variants}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Warehouse volumes */}
          <div className="dashboard-section">
            <div className="dashboard-section-title">Catalogue Volume by Warehouse</div>
            <div className="dashboard-table">
              <div className="dashboard-table-header">
                <span>Warehouse</span><span>Volume</span>
              </div>
              {WAREHOUSE_KEYS.map((k) => warehouseTotals.totals[k] > 0 && (
                <div key={k} className="dashboard-table-row">
                  <span className="dashboard-table-name">{WAREHOUSE_LABELS[k]}</span>
                  <span>{warehouseTotals.totals[k].toLocaleString()}</span>
                </div>
              ))}
              <div className="dashboard-table-row total">
                <span className="dashboard-table-name">Total</span>
                <span>{warehouseTotals.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Lenses */}
          {lensStats.length > 0 && (
            <div className="dashboard-section">
              <div className="dashboard-section-title">Lenses</div>
              <div className="dashboard-table">
                <div className="dashboard-table-header">
                  <span>Lens</span><span>Scope</span><span>Members</span>
                </div>
                {lensStats.map((l) => (
                  <div key={l.name} className="dashboard-table-row">
                    <span className="dashboard-table-name">{l.name}</span>
                    <span className="dashboard-scope-tag">{l.scope}</span>
                    <span>{l.members}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
