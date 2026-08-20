import { useState, useMemo } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useProjectStore } from '../store/useProjectStore';
import { Catalogue } from './Catalogue';
import type { Product, SetBoard, SetBoardItem, SetItemKind } from '../types';
import './SetLab.css';

export function SetLab() {
  const {
    project, addSetBoard, removeSetBoard, renameSetBoard, setActiveSetBoard,
    addSetBoardItem, removeSetBoardItem, updateSetBoardItem,
    updateSetBoardMatrix, setSetBoardMatrixAssignment,
  } = useProjectStore();

  const [dragOverlay, setDragOverlay] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const boards = project?.setBoards ?? [];
  const activeBoard = boards.find((b) => b.id === project?.activeSetBoardId) ?? null;
  const catalogue = project?.catalogue ?? [];

  const ml = activeBoard?.matrixLayout ?? { title: '', xLabels: ['Column 1'], yLabels: ['Row 1'], assignments: [] };

  const cellMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of ml.assignments) {
      const key = `${a.row}-${a.col}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a.itemId);
    }
    return map;
  }, [ml.assignments]);

  const unassigned = useMemo(() => {
    if (!activeBoard) return [];
    const assigned = new Set(ml.assignments.map((a) => a.itemId));
    return activeBoard.items.filter((i) => !assigned.has(i.id));
  }, [activeBoard, ml.assignments]);

  const handleNewBoard = () => {
    const name = prompt('Board name:');
    if (name?.trim()) addSetBoard(name.trim());
  };

  const handleNewItem = (kind: SetItemKind) => {
    if (!activeBoard) return;
    const name = prompt(`${kind === 'set' ? 'Set' : 'Bundle'} name:`);
    if (!name?.trim()) return;
    const id = `sbi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addSetBoardItem(activeBoard.id, { id, name: name.trim(), kind, components: [], position: activeBoard.items.length });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith('catalogue-')) {
      const data = event.active.data.current as { product: Product };
      setDragOverlay(data.product.name);
    } else if (id.startsWith('slab-item-')) {
      const itemId = id.replace('slab-item-', '');
      const item = activeBoard?.items.find((i) => i.id === itemId);
      setDragOverlay(item?.name ?? 'Item');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragOverlay(null);
    if (!activeBoard) return;
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Catalogue product dropped onto a set card → add as component
    if (activeId.startsWith('catalogue-') && overId.startsWith('slab-card-')) {
      const data = active.data.current as { product: Product };
      const targetItemId = overId.replace('slab-card-', '');
      const item = activeBoard.items.find((i) => i.id === targetItemId);
      if (!item) return;
      const existing = item.components.find((c) => c.productId === data.product.id);
      if (existing) {
        updateSetBoardItem(activeBoard.id, targetItemId, {
          components: item.components.map((c) => c.productId === data.product.id ? { ...c, quantity: c.quantity + 1 } : c),
        });
      } else {
        updateSetBoardItem(activeBoard.id, targetItemId, {
          components: [...item.components, { productId: data.product.id, quantity: 1 }],
        });
      }
      return;
    }

    // Catalogue product dropped onto a matrix cell → create new set with this product
    if (activeId.startsWith('catalogue-') && overId.startsWith('slab-cell-')) {
      const data = active.data.current as { product: Product };
      const [, , rowStr, colStr] = overId.split('-');
      const row = Number(rowStr), col = Number(colStr);
      const id = `sbi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newItem: SetBoardItem = {
        id, name: data.product.name, kind: 'set',
        components: [{ productId: data.product.id, quantity: 1 }],
        position: activeBoard.items.length,
      };
      addSetBoardItem(activeBoard.id, newItem);
      setSetBoardMatrixAssignment(activeBoard.id, id, row, col);
      return;
    }

    // Set item dragged to a matrix cell
    if (activeId.startsWith('slab-item-') && overId.startsWith('slab-cell-')) {
      const itemId = activeId.replace('slab-item-', '');
      const [, , rowStr, colStr] = overId.split('-');
      setSetBoardMatrixAssignment(activeBoard.id, itemId, Number(rowStr), Number(colStr));
      return;
    }
  };

  const handleAddRow = () => {
    if (!activeBoard) return;
    const label = prompt('Row label:') || `Row ${ml.yLabels.length + 1}`;
    updateSetBoardMatrix(activeBoard.id, { yLabels: [...ml.yLabels, label] });
  };

  const handleAddCol = () => {
    if (!activeBoard) return;
    const label = prompt('Column label:') || `Column ${ml.xLabels.length + 1}`;
    updateSetBoardMatrix(activeBoard.id, { xLabels: [...ml.xLabels, label] });
  };

  if (!project) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="set-lab">
        {/* Board sidebar */}
        <div className="slab-sidebar">
          <div className="slab-sidebar-header">
            <h3>Boards</h3>
            <button className="slab-add-btn" onClick={handleNewBoard}>+ Board</button>
          </div>
          <div className="slab-board-list">
            {boards.map((b) => (
              <div
                key={b.id}
                className={`slab-board-item ${b.id === activeBoard?.id ? 'active' : ''}`}
                onClick={() => setActiveSetBoard(b.id)}
                onDoubleClick={() => {
                  const name = prompt('Rename board:', b.name);
                  if (name?.trim()) renameSetBoard(b.id, name.trim());
                }}
              >
                <span className="slab-board-name">{b.name}</span>
                <span className="slab-board-count">{b.items.length}</span>
                <button className="slab-board-delete" onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${b.name}"?`)) removeSetBoard(b.id);
                }}>×</button>
              </div>
            ))}
            {boards.length === 0 && <div className="slab-drop-hint">No boards yet</div>}
          </div>
        </div>

        {/* Main area */}
        <div className="slab-main">
          {activeBoard ? (
            <>
              <div className="slab-toolbar">
                <h2>{activeBoard.name}</h2>
                <div className="slab-toolbar-actions">
                  <button className="slab-add-btn" onClick={() => handleNewItem('set')}>+ Set</button>
                  <button className="slab-add-btn" style={{ background: '#f57c00' }} onClick={() => handleNewItem('bundle')}>+ Bundle</button>
                  <button className="slab-add-btn" style={{ background: '#666' }} onClick={handleAddCol}>+ Column</button>
                  <button className="slab-add-btn" style={{ background: '#666' }} onClick={handleAddRow}>+ Row</button>
                </div>
              </div>
              <div className="slab-canvas">
                <div className="slab-matrix-area">
                  <div className="slab-matrix">
                    {/* Column headers */}
                    <div className="slab-matrix-header-row">
                      {ml.xLabels.map((label, ci) => (
                        <div
                          key={ci}
                          className="slab-matrix-col-label"
                          onDoubleClick={() => {
                            const n = prompt('Column label:', label);
                            if (n != null) {
                              const labels = [...ml.xLabels];
                              labels[ci] = n;
                              updateSetBoardMatrix(activeBoard.id, { xLabels: labels });
                            }
                          }}
                        >
                          {label}
                        </div>
                      ))}
                    </div>

                    {/* Rows */}
                    {ml.yLabels.map((rowLabel, ri) => (
                      <div key={ri} className="slab-matrix-row">
                        <div
                          className="slab-matrix-row-label"
                          onDoubleClick={() => {
                            const n = prompt('Row label:', rowLabel);
                            if (n != null) {
                              const labels = [...ml.yLabels];
                              labels[ri] = n;
                              updateSetBoardMatrix(activeBoard.id, { yLabels: labels });
                            }
                          }}
                        >
                          {rowLabel}
                        </div>
                        {ml.xLabels.map((_, ci) => (
                          <SetLabCell
                            key={`${ri}-${ci}`}
                            row={ri}
                            col={ci}
                            itemIds={cellMap.get(`${ri}-${ci}`) ?? []}
                            board={activeBoard}
                            catalogue={catalogue}
                            selectedItemId={selectedItemId}
                            onSelect={setSelectedItemId}
                            onRemoveItem={(id) => removeSetBoardItem(activeBoard.id, id)}
                            onUpdateItem={(id, patch) => updateSetBoardItem(activeBoard.id, id, patch)}
                            onRemoveComponent={(itemId, prodId) => {
                              const item = activeBoard.items.find((i) => i.id === itemId);
                              if (!item) return;
                              updateSetBoardItem(activeBoard.id, itemId, {
                                components: item.components.filter((c) => c.productId !== prodId),
                              });
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Unassigned items */}
                  {unassigned.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 6 }}>Unassigned</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {unassigned.map((item) => (
                          <UnassignedItem key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Catalogue panel */}
                <div className="slab-catalogue">
                  <Catalogue
                    products={catalogue}
                    onImport={() => {}}
                    currentProductIds={new Set()}
                    futureProductIds={new Set()}
                    dropZoneId="slab-catalogue-drop"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="slab-empty">
              <div>
                <p style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>Set & Bundle Lab</p>
                <p>Create a board from the sidebar to start experimenting with product sets and bundles.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <DragOverlay>
        {dragOverlay && (
          <div style={{ padding: '6px 12px', background: '#1976d2', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
            {dragOverlay}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------- Matrix Cell ----------

function SetLabCell({ row, col, itemIds, board, catalogue, selectedItemId, onSelect, onRemoveItem, onUpdateItem, onRemoveComponent }: {
  row: number; col: number;
  itemIds: string[];
  board: SetBoard;
  catalogue: Product[];
  selectedItemId: string | null;
  onSelect: (id: string | null) => void;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<SetBoardItem>) => void;
  onRemoveComponent: (itemId: string, productId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slab-cell-${row}-${col}` });

  const items = itemIds.map((id) => board.items.find((i) => i.id === id)).filter((i): i is SetBoardItem => !!i);

  return (
    <div ref={setNodeRef} className={`slab-cell ${isOver ? 'drop-over' : ''}`}>
      {items.map((item) => (
        <SetCard
          key={item.id}
          item={item}
          catalogue={catalogue}
          selected={selectedItemId === item.id}
          onSelect={() => onSelect(item.id === selectedItemId ? null : item.id)}
          onRemove={() => onRemoveItem(item.id)}
          onRename={() => {
            const name = prompt('Rename:', item.name);
            if (name?.trim()) onUpdateItem(item.id, { name: name.trim() });
          }}
          onToggleKind={() => onUpdateItem(item.id, { kind: item.kind === 'set' ? 'bundle' : 'set' })}
          onRemoveComponent={(prodId) => onRemoveComponent(item.id, prodId)}
        />
      ))}
      {items.length === 0 && <div className="slab-drop-hint">Drop SKU or set here</div>}
    </div>
  );
}

// ---------- Set Card (droppable for components) ----------

function SetCard({ item, catalogue, selected, onSelect, onRemove, onRename, onToggleKind, onRemoveComponent }: {
  item: SetBoardItem;
  catalogue: Product[];
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: () => void;
  onToggleKind: () => void;
  onRemoveComponent: (productId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slab-card-${item.id}` });

  const totalRrp = item.components.reduce((sum, c) => {
    const prod = catalogue.find((p) => p.id === c.productId);
    return sum + (prod?.rrp ?? 0) * c.quantity;
  }, 0);

  return (
    <div
      ref={setNodeRef}
      className={`slab-set-card kind-${item.kind} ${isOver ? 'drop-over' : ''}`}
      style={{ outline: selected ? '2px solid #1976d2' : undefined }}
      onClick={onSelect}
    >
      <div className="slab-set-card-header">
        <span className="slab-set-card-name" onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}>{item.name}</span>
        <span className={`slab-set-card-kind ${item.kind}`} onClick={(e) => { e.stopPropagation(); onToggleKind(); }} style={{ cursor: 'pointer' }} title="Click to toggle Set/Bundle">{item.kind}</span>
        <button className="slab-set-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      </div>
      {item.components.length > 0 ? (
        <div className="slab-components">
          {item.components.map((c) => {
            const prod = catalogue.find((p) => p.id === c.productId);
            return (
              <div key={c.productId} className="slab-component">
                <span className="slab-component-name">{prod?.sku ?? '?'} — {prod?.name ?? 'Unknown'}</span>
                {c.quantity > 1 && <span className="slab-component-qty">×{c.quantity}</span>}
                <button className="slab-component-remove" onClick={(e) => { e.stopPropagation(); onRemoveComponent(c.productId); }}>×</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="slab-drop-hint">Drag SKUs here</div>
      )}
      {item.components.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 9, color: '#888', textAlign: 'right' }}>
          {item.components.reduce((s, c) => s + c.quantity, 0)} items · RRP £{totalRrp.toFixed(2)}
        </div>
      )}
    </div>
  );
}

// ---------- Unassigned item (draggable chip) ----------

function UnassignedItem({ item }: { item: SetBoardItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `slab-item-${item.id}`,
    data: { type: 'set-item', item },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        padding: '4px 10px',
        background: item.kind === 'set' ? '#e3f2fd' : '#fff3e0',
        border: `1px solid ${item.kind === 'set' ? '#bbdefb' : '#ffe0b2'}`,
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: item.kind === 'set' ? '#1976d2' : '#f57c00',
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {item.name}
    </div>
  );
}
