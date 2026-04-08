import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
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
  const { project, addPlan, removePlan, setActivePlan, setShowPlanTree } = useProjectStore();

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

  return (
    <div className="plan-tree-panel">
      <div className="plan-tree-header">
        <h3>Range Plans</h3>
        <div className="plan-tree-header-actions">
          <button className="plan-tree-new" onClick={handleNew}>+ New</button>
          <button className="plan-tree-close" onClick={() => setShowPlanTree(false)}>×</button>
        </div>
      </div>

      <div className="plan-tree-list">
        {grouped.map(([category, plans]) => (
          <div key={category} className="plan-tree-group">
            <div className="plan-tree-category">{category}</div>
            {plans.map((plan) => {
              const isActive = plan.id === project.activePlanId;
              const itemCount = plan.currentShelf.items.length + plan.futureShelf.items.length;
              return (
                <div
                  key={plan.id}
                  className={`plan-tree-item ${isActive ? 'active' : ''}`}
                  onClick={() => { setActivePlan(plan.id); }}
                >
                  <div className="plan-tree-item-icon">▦</div>
                  <div className="plan-tree-item-info">
                    <div className="plan-tree-item-name">{plan.name}</div>
                    <div className="plan-tree-item-meta">{itemCount} products</div>
                  </div>
                  {!isActive && project.plans.length > 1 && (
                    <button
                      className="plan-tree-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${plan.name}"?`)) removePlan(plan.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
