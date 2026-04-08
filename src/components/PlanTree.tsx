import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import type { Product, RangePlan } from '../types';
import './PlanTree.css';

function getPlanCategory(plan: RangePlan, catalogue: Product[]): string {
  const categoryCounts = new Map<string, number>();
  const allItems = [...plan.currentShelf.items, ...plan.futureShelf.items];
  for (const item of allItems) {
    if (item.isPlaceholder || !item.productId) continue;
    const product = catalogue.find((p) => p.id === item.productId);
    if (!product?.category) continue;
    categoryCounts.set(product.category, (categoryCounts.get(product.category) || 0) + 1);
  }
  if (categoryCounts.size === 0) return 'Uncategorised';
  let maxCat = '';
  let maxCount = 0;
  for (const [cat, count] of categoryCounts) {
    if (count > maxCount) { maxCat = cat; maxCount = count; }
  }
  return maxCat;
}

export function PlanTree() {
  const {
    project, addPlan, removePlan, setActivePlan, setShowPlanTree,
    activeVariantId, setActiveVariant, addVariant, removeVariant,
  } = useProjectStore();
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    if (!project) return [];
    const groups = new Map<string, RangePlan[]>();
    for (const plan of project.plans) {
      const cat = getPlanCategory(plan, project.catalogue);
      const arr = groups.get(cat) || [];
      arr.push(plan);
      groups.set(cat, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [project]);

  if (!project) return null;

  const handleNew = () => {
    const name = prompt('New range plan name:');
    if (!name) return;
    addPlan(name);
  };

  const handleNewVariant = (planId: string) => {
    const name = prompt('Variant name (e.g. "US", "RoW", "EU"):');
    if (!name) return;
    addVariant(planId, name);
  };

  const toggleExpand = (planId: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId); else next.add(planId);
      return next;
    });
  };

  return (
    <div className="plan-tree-panel">
      <div className="plan-tree-header">
        <h3>Range Plans</h3>
        <div className="plan-tree-header-actions">
          <button className="plan-tree-new" onClick={handleNew}>+ New</button>
          <button className="plan-tree-close" onClick={() => setShowPlanTree(false)}><CloseIcon size={10} color="#999" /></button>
        </div>
      </div>

      <div className="plan-tree-list">
        {grouped.map(([category, plans]) => (
          <div key={category} className="plan-tree-group">
            <div className="plan-tree-category">{category}</div>
            {plans.map((plan) => {
              const isActive = plan.id === project.activePlanId;
              const isExpanded = expandedPlans.has(plan.id);
              const hasVariants = plan.variants.length > 0;
              const itemCount = plan.currentShelf.items.length + plan.futureShelf.items.length;

              return (
                <div key={plan.id}>
                  {/* Plan row */}
                  <div className={`plan-tree-item ${isActive && !activeVariantId ? 'active' : ''}`}>
                    {/* Expand arrow */}
                    <button className="plan-tree-expand" onClick={() => toggleExpand(plan.id)}>
                      {hasVariants ? (isExpanded ? '▾' : '▸') : ' '}
                    </button>
                    <div className="plan-tree-item-body"
                      onClick={() => { setActivePlan(plan.id); setActiveVariant(null); }}>
                      <div className="plan-tree-item-icon">▦</div>
                      <div className="plan-tree-item-info">
                        <div className="plan-tree-item-name">{plan.name}</div>
                        <div className="plan-tree-item-meta">{itemCount} products · Master</div>
                      </div>
                    </div>
                    <div className="plan-tree-item-actions">
                      <button className="plan-tree-add-variant" onClick={() => handleNewVariant(plan.id)} title="Add variant">+V</button>
                      {!isActive && project.plans.length > 1 && (
                        <button className="plan-tree-item-delete" onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${plan.name}"?`)) removePlan(plan.id);
                        }}><CloseIcon size={8} color="#fff" /></button>
                      )}
                    </div>
                  </div>

                  {/* Variants */}
                  {isExpanded && plan.variants.map((variant) => {
                    const isVarActive = isActive && activeVariantId === variant.id;
                    const varCount = variant.includedCurrentItemIds.length + variant.includedFutureItemIds.length;
                    return (
                      <div key={variant.id}
                        className={`plan-tree-item variant ${isVarActive ? 'active' : ''}`}
                        onClick={() => { setActivePlan(plan.id); setActiveVariant(variant.id); }}>
                        <div className="plan-tree-variant-indent" />
                        <div className="plan-tree-item-icon variant-icon">○</div>
                        <div className="plan-tree-item-info">
                          <div className="plan-tree-item-name">{variant.name}</div>
                          <div className="plan-tree-item-meta">{varCount} included</div>
                        </div>
                        <button className="plan-tree-item-delete" onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete variant "${variant.name}"?`)) removeVariant(plan.id, variant.id);
                        }}><CloseIcon size={7} color="#fff" /></button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
