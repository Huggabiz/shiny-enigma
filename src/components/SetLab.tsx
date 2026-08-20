import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, pointerWithin, rectIntersection, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useProjectStore } from '../store/useProjectStore';
import { Catalogue } from './Catalogue';
import { EditableTitle } from './EditableTitle';
import { SlideCanvasControls } from './SlideCanvasControls';
import { CloseIcon } from './Icons';
import { BASE_GAP, computeMatrixLayout, computeMatrixAutoTier, MAX_CARD_WIDTH } from '../utils/matrixLayout';
import { anonDisplay } from '../utils/anonymise';
import type { Product, SetBoard, SetBoardItem, SetItemKind, MatrixLayout } from '../types';
import './SetLab.css';

// Same chrome constants as RangeDesign so the matrix reads identically.
const ROW_HEADER_WIDTH = 60;
const ADD_BTN_WIDTH = 28;
const HEADER_ROW_HEIGHT = 28;
const ADD_ROW_HEIGHT = 28;

/** Pointer-based collision detection: a drop only targets a set
 * container when the pointer is actually inside it — otherwise the
 * cell under the pointer wins. closestCenter was routing cell drops
 * into nearby containers because a small container's centre can be
 * the closest centre even when the pointer is over empty cell space. */
const setLabCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) {
    const containerHit = within.filter((c) => String(c.id).startsWith('slab-card-'));
    if (containerHit.length > 0) return containerHit;
    const cellHit = within.filter((c) => String(c.id).startsWith('matrix-cell-'));
    if (cellHit.length > 0) return cellHit;
    return within;
  }
  return rectIntersection(args);
};

/** Modal name input — replaces window.prompt for creating/renaming
 * boards, sets, bundles, and axis labels. */
interface NameDialogState {
  title: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

function NameDialog({ state, onClose }: { state: NameDialogState; onClose: () => void }) {
  const [value, setValue] = useState(state.initial ?? '');
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    state.onSubmit(v);
    onClose();
  };
  return (
    <div className="slab-dialog-overlay" onClick={onClose}>
      <div className="slab-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{state.title}</h3>
        <input
          className="slab-dialog-input"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Name"
        />
        <div className="slab-dialog-actions">
          <button className="slab-dialog-btn cancel" onClick={onClose}>Cancel</button>
          <button className="slab-dialog-btn primary" onClick={submit} disabled={!value.trim()}>{state.submitLabel ?? 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export function SetLab() {
  const {
    project, addSetBoard, removeSetBoard, renameSetBoard, setActiveSetBoard,
    addSetBoardItem, removeSetBoardItem, updateSetBoardItem,
    updateSetBoardMatrix, setSetBoardMatrixAssignment,
    slideBaseScale, slideBaseScaleMode, setSlideBaseScale, cardFormat,
  } = useProjectStore();

  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const boards = project?.setBoards ?? [];
  const activeBoard = boards.find((b) => b.id === project?.activeSetBoardId) ?? boards[0] ?? null;
  const catalogue = project?.catalogue ?? [];

  const layout: MatrixLayout = useMemo(() =>
    activeBoard?.matrixLayout || { title: activeBoard?.name || '', xLabels: [], yLabels: [], assignments: [] },
    [activeBoard?.matrixLayout, activeBoard?.name],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWrapperSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeBoard?.id]);

  const uiScale = slideBaseScale;
  const scaledRowHeaderW = Math.round(ROW_HEADER_WIDTH * uiScale);
  const scaledAddBtnW = Math.round(ADD_BTN_WIDTH * uiScale);
  const scaledHeaderRowH = Math.round(HEADER_ROW_HEIGHT * uiScale);
  const scaledAddRowH = Math.round(ADD_ROW_HEIGHT * uiScale);

  // Per-cell card counts drive the same layout solver as RangeDesign.
  // A set container counts as its number of distinct component cards
  // (min 1 so an empty container still reserves a slot).
  const cellCounts = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || !activeBoard) return [] as number[][];
    const counts: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      counts.push([]);
      for (let col = 0; col < numCols; col++) {
        let n = 0;
        for (const a of layout.assignments) {
          if (a.row !== row || a.col !== col) continue;
          const item = activeBoard.items.find((i) => i.id === a.itemId);
          // +1 virtual card per container reserves space for its chrome
          // (header, footer, padding) so the auto-tier resizes before
          // content ever clips against the cell edge — the same
          // reserve-then-fit approach the range view relies on.
          n += (item?.components.length ?? 0) + 1;
        }
        counts[row].push(n);
      }
    }
    return counts;
  }, [layout, activeBoard]);

  // Available drawing area — same chrome subtraction as RangeDesign so
  // the layout solver and the auto-tier see identical numbers.
  const availArea = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || wrapperSize.w === 0 || wrapperSize.h === 0) {
      return { availW: 0, availH: 0, numCols, numRows };
    }
    const scaledGap = Math.ceil(BASE_GAP * uiScale);
    const availW = wrapperSize.w - scaledRowHeaderW - scaledAddBtnW - (numCols + 1) * scaledGap;
    const availH = wrapperSize.h - scaledHeaderRowH - scaledAddRowH - (numRows + 1) * scaledGap;
    return { availW, availH, numCols, numRows };
  }, [layout.xLabels, layout.yLabels, wrapperSize, uiScale, scaledRowHeaderW, scaledAddBtnW, scaledHeaderRowH, scaledAddRowH]);

  const { columnWidths, rowHeights, cardWidth, cardHeight } = useMemo(() => {
    const { availW, availH, numCols, numRows } = availArea;
    if (numCols === 0 || numRows === 0 || availW <= 0 || availH <= 0) {
      return { columnWidths: [], rowHeights: [], cardWidth: MAX_CARD_WIDTH, cardHeight: MAX_CARD_WIDTH * 1.4 };
    }
    const result = computeMatrixLayout(cellCounts, cardFormat, availW, availH, uiScale);
    return { columnWidths: result.colWidths, rowHeights: result.rowHeights, cardWidth: result.cardW, cardHeight: result.cardH };
  }, [cellCounts, availArea, cardFormat, uiScale]);

  // Fit-driven auto-tier — same stable-baseline loop as RangeDesign
  // (see the long comment there). The cached baseline stops the
  // measure/re-measure feedback ping-pong on borderline layouts.
  const baseAvailRef = useRef<{ baseW: number; baseH: number; numCols: number; numRows: number } | null>(null);
  useEffect(() => {
    if (slideBaseScaleMode !== 'auto') return;
    const { availW, availH, numCols, numRows } = availArea;
    if (numCols === 0 || numRows === 0 || availW <= 0 || availH <= 0) return;
    const totalCards = cellCounts.flat().reduce((s, n) => s + n, 0);
    if (totalCards === 0) return;
    if (baseAvailRef.current &&
        (baseAvailRef.current.numCols !== numCols || baseAvailRef.current.numRows !== numRows)) {
      baseAvailRef.current = null;
    }
    if (!baseAvailRef.current) {
      baseAvailRef.current = { baseW: availW / uiScale, baseH: availH / uiScale, numCols, numRows };
    }
    const { baseW, baseH } = baseAvailRef.current;
    const recommended = computeMatrixAutoTier(cellCounts, cardFormat, baseW, baseH, uiScale);
    if (recommended !== uiScale) setSlideBaseScale(recommended);
  }, [cellCounts, availArea, cardFormat, uiScale, slideBaseScaleMode, setSlideBaseScale]);

  const gridCols = `${scaledRowHeaderW}px ${columnWidths.map((w) => `${w}px`).join(' ')} ${scaledAddBtnW}px`;

  const cellMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of layout.assignments) {
      const key = `${a.row}-${a.col}`;
      const arr = map.get(key) || [];
      arr.push(a.itemId);
      map.set(key, arr);
    }
    return map;
  }, [layout.assignments]);

  const unassigned = useMemo(() => {
    if (!activeBoard) return [];
    const assigned = new Set(layout.assignments.map((a) => a.itemId));
    return activeBoard.items.filter((i) => !assigned.has(i.id));
  }, [activeBoard, layout.assignments]);

  const handleNewBoard = () => {
    setNameDialog({
      title: 'New board',
      submitLabel: 'Create',
      onSubmit: (name) => addSetBoard(name),
    });
  };

  // Cell-hover creation — mirrors the placeholder-add mechanic in the
  // range view: the + appears on cell hover and creates the container
  // directly in that cell.
  const handleNewItem = useCallback((kind: SetItemKind, row: number, col: number) => {
    if (!activeBoard) return;
    const boardId = activeBoard.id;
    const position = activeBoard.items.length;
    setNameDialog({
      title: `New ${kind}`,
      submitLabel: 'Create',
      onSubmit: (name) => {
        const id = `sbi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addSetBoardItem(boardId, { id, name, kind, components: [], position });
        setTimeout(() => setSetBoardMatrixAssignment(boardId, id, row, col), 0);
      },
    });
  }, [activeBoard, addSetBoardItem, setSetBoardMatrixAssignment]);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith('catalogue-')) {
      const data = event.active.data.current as { product: Product };
      if (data?.product) setActiveProduct(data.product);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProduct(null);
    if (!activeBoard) return;
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Catalogue SKU → set container: add as component (repeat drop = qty+1)
    if (activeId.startsWith('catalogue-') && overId.startsWith('slab-card-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      const targetItemId = overId.replace('slab-card-', '');
      const item = activeBoard.items.find((i) => i.id === targetItemId);
      if (!item) return;
      const existing = item.components.find((c) => c.productId === data.product.id);
      updateSetBoardItem(activeBoard.id, targetItemId, {
        components: existing
          ? item.components.map((c) => c.productId === data.product.id ? { ...c, quantity: c.quantity + 1 } : c)
          : [...item.components, { productId: data.product.id, quantity: 1 }],
      });
      return;
    }

    const cellMatch = overId.match(/^matrix-cell-(\d+)-(\d+)$/);
    if (!cellMatch) return;
    const row = parseInt(cellMatch[1]);
    const col = parseInt(cellMatch[2]);

    // Catalogue SKU → empty cell area: create a new set seeded with the SKU
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      const id = `sbi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      addSetBoardItem(activeBoard.id, {
        id, name: data.product.name, kind: 'set',
        components: [{ productId: data.product.id, quantity: 1 }],
        position: activeBoard.items.length,
      });
      setTimeout(() => setSetBoardMatrixAssignment(activeBoard.id, id, row, col), 0);
      return;
    }

    // Set container moved between cells
    if (activeId.startsWith('slab-item-')) {
      const itemId = activeId.replace('slab-item-', '');
      setSetBoardMatrixAssignment(activeBoard.id, itemId, row, col);
    }
  };

  const addLabel = useCallback((axis: 'x' | 'y') => {
    if (!activeBoard) return;
    const boardId = activeBoard.id;
    setNameDialog({
      title: `New ${axis === 'x' ? 'column' : 'row'}`,
      submitLabel: 'Add',
      onSubmit: (text) => {
        if (axis === 'x') updateSetBoardMatrix(boardId, { xLabels: [...layout.xLabels, text] });
        else updateSetBoardMatrix(boardId, { yLabels: [...layout.yLabels, text] });
      },
    });
  }, [activeBoard, layout, updateSetBoardMatrix]);

  const removeLabel = useCallback((axis: 'x' | 'y', index: number) => {
    if (!activeBoard) return;
    if (axis === 'x') {
      updateSetBoardMatrix(activeBoard.id, {
        xLabels: layout.xLabels.filter((_, i) => i !== index),
        assignments: layout.assignments.filter((a) => a.col !== index).map((a) => a.col > index ? { ...a, col: a.col - 1 } : a),
      });
    } else {
      updateSetBoardMatrix(activeBoard.id, {
        yLabels: layout.yLabels.filter((_, i) => i !== index),
        assignments: layout.assignments.filter((a) => a.row !== index).map((a) => a.row > index ? { ...a, row: a.row - 1 } : a),
      });
    }
  }, [activeBoard, layout, updateSetBoardMatrix]);

  const updateLabel = useCallback((axis: 'x' | 'y', index: number, text: string) => {
    if (!activeBoard) return;
    if (axis === 'x') updateSetBoardMatrix(activeBoard.id, { xLabels: layout.xLabels.map((l, i) => i === index ? text : l) });
    else updateSetBoardMatrix(activeBoard.id, { yLabels: layout.yLabels.map((l, i) => i === index ? text : l) });
    setEditingAxis(null);
  }, [activeBoard, layout, updateSetBoardMatrix]);

  if (!project) return null;

  return (
    <div className="range-design set-lab">
      <DndContext sensors={sensors} collisionDetection={setLabCollision}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

        {/* Board sidebar — plan-tree-style management, separate from range plans */}
        <div className="slab-sidebar">
          <div className="slab-sidebar-header">
            <h3>Set Boards</h3>
            <button className="slab-add-btn" onClick={handleNewBoard}>+</button>
          </div>
          <div className="slab-board-list">
            {boards.map((b) => (
              <div key={b.id}
                className={`slab-board-item ${b.id === activeBoard?.id ? 'active' : ''}`}
                onClick={() => setActiveSetBoard(b.id)}
                onDoubleClick={() => {
                  setNameDialog({
                    title: 'Rename board',
                    initial: b.name,
                    onSubmit: (name) => renameSetBoard(b.id, name),
                  });
                }}>
                <span className="slab-board-name">{b.name}</span>
                <span className="slab-board-count">{b.items.length}</span>
                <button className="slab-board-delete" onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${b.name}"?`)) removeSetBoard(b.id);
                }}>×</button>
              </div>
            ))}
            {boards.length === 0 && <div className="slab-empty-hint">Create a board to begin</div>}
          </div>
        </div>

        <div className="range-design-canvas">
          <div className="range-design-title-bar">
            <div className="range-design-canvas-controls" style={{ marginLeft: 'auto' }}>
              <SlideCanvasControls scrollAreaSelector=".range-view-scroll" />
            </div>
          </div>

          {activeBoard ? (
            <div className="slide-scroll-area range-view-scroll">
              <div className="slide-scroll-spacer">
                <div className="slide-canvas-wrapper">
                  <div className="matrix-16-9">
                    <div className="slide-title">
                      <EditableTitle
                        className="range-design-title"
                        value={activeBoard.name}
                        onSave={(next) => { if (next.trim()) renameSetBoard(activeBoard.id, next.trim()); }}
                        trailing={<span className="stage-badge">Set Board</span>}
                      />
                    </div>
                    <div className="matrix-wrapper" ref={wrapperRef}>
                      <div className="matrix-header-row" style={{ gridTemplateColumns: gridCols }}>
                        <div />
                        {layout.xLabels.map((label, i) => (
                          <div key={i} className="matrix-col-header" onDoubleClick={() => setEditingAxis({ axis: 'x', index: i })}>
                            {editingAxis?.axis === 'x' && editingAxis.index === i ? (
                              <input className="matrix-label-input" defaultValue={label} autoFocus
                                onBlur={(e) => updateLabel('x', i, e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && updateLabel('x', i, (e.target as HTMLInputElement).value)} />
                            ) : <span>{label}</span>}
                            <button className="matrix-label-remove" onClick={() => removeLabel('x', i)}><CloseIcon size={7} color="#fff" /></button>
                          </div>
                        ))}
                        <button className="matrix-add-btn" onClick={() => addLabel('x')}>+</button>
                      </div>

                      {layout.yLabels.map((yLabel, row) => (
                        <div key={row} className="matrix-row"
                          style={{ gridTemplateColumns: gridCols, height: `${rowHeights[row] || 80}px` }}>
                          <div className="matrix-row-header" onDoubleClick={() => setEditingAxis({ axis: 'y', index: row })}>
                            {editingAxis?.axis === 'y' && editingAxis.index === row ? (
                              <input className="matrix-label-input" defaultValue={yLabel} autoFocus
                                onBlur={(e) => updateLabel('y', row, e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && updateLabel('y', row, (e.target as HTMLInputElement).value)} />
                            ) : <span>{yLabel}</span>}
                            <button className="matrix-label-remove" onClick={() => removeLabel('y', row)}><CloseIcon size={7} color="#fff" /></button>
                          </div>
                          {layout.xLabels.map((_, col) => (
                            <SetLabCell key={`${row}-${col}`} row={row} col={col}
                              itemIds={cellMap.get(`${row}-${col}`) || []}
                              board={activeBoard} catalogue={catalogue}
                              cardWidth={cardWidth} cardHeight={cardHeight}
                              cellHeight={rowHeights[row] || 80}
                              onAddItem={handleNewItem}
                              onRenameItem={(item) => setNameDialog({
                                title: `Rename ${item.kind}`,
                                initial: item.name,
                                onSubmit: (name) => updateSetBoardItem(activeBoard.id, item.id, { name }),
                              })}
                              onRemoveItem={(id) => removeSetBoardItem(activeBoard.id, id)}
                              onUpdateItem={(id, patch) => updateSetBoardItem(activeBoard.id, id, patch)}
                              onRemoveComponent={(itemId, prodId) => {
                                const item = activeBoard.items.find((i) => i.id === itemId);
                                if (!item) return;
                                const comp = item.components.find((c) => c.productId === prodId);
                                if (!comp) return;
                                updateSetBoardItem(activeBoard.id, itemId, {
                                  components: comp.quantity > 1
                                    ? item.components.map((c) => c.productId === prodId ? { ...c, quantity: c.quantity - 1 } : c)
                                    : item.components.filter((c) => c.productId !== prodId),
                                });
                              }} />
                          ))}
                          <div />
                        </div>
                      ))}

                      <div className="matrix-add-row">
                        <button className="matrix-add-btn wide" onClick={() => addLabel('y')}>+ Row</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="slab-empty-canvas">Create a board from the sidebar to start experimenting with sets and bundles.</div>
          )}

          {activeBoard && unassigned.length > 0 && (
            <div className="unassigned-tray">
              <span className="unassigned-label">On board but not placed in matrix ({unassigned.length}):</span>
              <div className="unassigned-items">
                {unassigned.map((item) => (
                  <UnassignedSetDraggable key={item.id} item={item}
                    onRemove={() => removeSetBoardItem(activeBoard.id, item.id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="right-column">
          <Catalogue products={catalogue} onImport={() => {}}
            currentProductIds={new Set()} futureProductIds={new Set()}
            dropZoneId="slab-catalogue-drop" />
        </div>

        <DragOverlay>
          {activeProduct && (
            <div className="matrix-drag-preview">{anonDisplay(activeProduct, catalogue).name}</div>
          )}
        </DragOverlay>
      </DndContext>
      {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} />}
    </div>
  );
}

// ---------- Matrix cell (droppable, same visual as RangeDesign) ----------

function SetLabCell({ row, col, itemIds, board, catalogue, cardWidth, cardHeight, cellHeight, onAddItem, onRemoveItem, onUpdateItem, onRenameItem, onRemoveComponent }: {
  row: number; col: number; itemIds: string[];
  board: SetBoard; catalogue: Product[];
  cardWidth: number; cardHeight: number; cellHeight: number;
  onAddItem: (kind: SetItemKind, row: number, col: number) => void;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<SetBoardItem>) => void;
  onRenameItem: (item: SetBoardItem) => void;
  onRemoveComponent: (itemId: string, productId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `matrix-cell-${row}-${col}` });
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const items = itemIds.map((id) => board.items.find((i) => i.id === id)).filter((i): i is SetBoardItem => !!i);

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}
      style={{
        '--matrix-card-width': `${Math.floor(cardWidth)}px`,
        '--matrix-card-height': `${Math.floor(cardHeight)}px`,
        height: `${cellHeight}px`,
      } as React.CSSProperties}
      onMouseLeave={() => setAddMenuOpen(false)}>
      {items.map((item) => (
        <SetContainer key={item.id} item={item} catalogue={catalogue}
          onRemove={() => onRemoveItem(item.id)}
          onRename={() => onRenameItem(item)}
          onToggleKind={() => onUpdateItem(item.id, { kind: item.kind === 'set' ? 'bundle' : 'set' })}
          onRemoveComponent={(prodId) => onRemoveComponent(item.id, prodId)} />
      ))}
      {addMenuOpen ? (
        <div className="slab-add-menu">
          <button className="slab-add-menu-btn set" onClick={() => { setAddMenuOpen(false); onAddItem('set', row, col); }}>+ Set</button>
          <button className="slab-add-menu-btn bundle" onClick={() => { setAddMenuOpen(false); onAddItem('bundle', row, col); }}>+ Bundle</button>
        </div>
      ) : (
        <button className="matrix-cell-add-ph" onClick={() => setAddMenuOpen(true)} title="Add a set or bundle">+</button>
      )}
    </div>
  );
}

// ---------- Set/Bundle container — draggable + droppable, holds matrix-cards ----------

function SetContainer({ item, catalogue, onRemove, onRename, onToggleKind, onRemoveComponent }: {
  item: SetBoardItem; catalogue: Product[];
  onRemove: () => void; onRename: () => void; onToggleKind: () => void;
  onRemoveComponent: (productId: string) => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `slab-card-${item.id}` });
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `slab-item-${item.id}`, data: { itemId: item.id },
  });

  const totalRrp = item.components.reduce((sum, c) => {
    const prod = catalogue.find((p) => p.id === c.productId);
    return sum + (prod?.rrp ?? 0) * c.quantity;
  }, 0);
  const totalQty = item.components.reduce((s, c) => s + c.quantity, 0);

  return (
    <div ref={setDropRef}
      className={`slab-set kind-${item.kind} ${isOver ? 'drop-over' : ''} ${isDragging ? 'dragging' : ''}`}>
      <button className="matrix-card-remove slab-set-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Delete container">
        <CloseIcon size={8} color="#fff" />
      </button>
      <div className="slab-set-header" ref={setDragRef} {...attributes} {...listeners}>
        <span className="slab-set-name" onDoubleClick={(e) => { e.stopPropagation(); onRename(); }} title={item.name}>{item.name}</span>
        <span className={`slab-set-kind ${item.kind}`}
          onClick={(e) => { e.stopPropagation(); onToggleKind(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Click to toggle Set / Bundle">{item.kind}</span>
      </div>
      <div className="slab-set-body">
        {item.components.length === 0 && <div className="slab-set-drop-hint">drag SKUs in</div>}
        {item.components.map((c) => {
          const product = catalogue.find((p) => p.id === c.productId);
          if (!product) return null;
          return (
            <SetComponentCard key={c.productId} product={product} quantity={c.quantity}
              catalogue={catalogue} onRemove={() => onRemoveComponent(c.productId)} />
          );
        })}
      </div>
      {totalQty > 0 && (
        <div className="slab-set-footer">{totalQty} item{totalQty !== 1 ? 's' : ''} · £{totalRrp.toFixed(2)}</div>
      )}
    </div>
  );
}

// ---------- Component card — exact matrix-card markup from RangeDesign ----------

function SetComponentCard({ product, quantity, catalogue, onRemove }: {
  product: Product; quantity: number; catalogue: Product[]; onRemove: () => void;
}) {
  const cardFormat = useProjectStore((s) => s.cardFormat);
  const anon = anonDisplay(product, catalogue);
  const displayName = anon.name;
  const isDev = product.source === 'dev';

  // Stack visual: quantity > 1 renders offset "shadow" layers behind the card.
  const stackLayers = Math.min(quantity - 1, 2);

  return (
    <div className="slab-stack" style={{ marginRight: stackLayers * 4, marginBottom: stackLayers * 3 }}>
      {Array.from({ length: stackLayers }).map((_, i) => (
        <div key={i} className="slab-stack-layer" style={{ top: (i + 1) * 3, left: (i + 1) * 4 }} />
      ))}
      <div className={`matrix-card ${isDev ? 'dev-product' : ''}`}>
        <button className="matrix-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={quantity > 1 ? 'Remove one' : 'Remove'}>
          <CloseIcon size={8} color="#fff" />
        </button>
        {isDev && <div className="matrix-card-dev-badge">DEV</div>}
        {quantity > 1 && <div className="slab-stack-qty">×{quantity}</div>}
        <div className="matrix-card-content">
          {cardFormat.showImage && (
            <div className="matrix-card-image">
              {anon.imageUrl ? (
                <img src={anon.imageUrl} alt={displayName} />
              ) : (
                <div className="matrix-card-image-ph">{displayName.charAt(0)}</div>
              )}
            </div>
          )}
          {cardFormat.showName && <div className="matrix-card-name" title={displayName}>{displayName}</div>}
          {cardFormat.showSku && <div className="matrix-card-sku">{product.sku || '—'}</div>}
          {cardFormat.showRrp && <div className="matrix-card-rrp">{product.rrp ? `£${product.rrp}` : '—'}</div>}
          {cardFormat.showUsRrp && product.usRrp !== undefined && <div className="matrix-card-rrp matrix-card-us">${product.usRrp}</div>}
          {cardFormat.showEuRrp && product.euRrp !== undefined && <div className="matrix-card-rrp matrix-card-eu">€{product.euRrp}</div>}
          {cardFormat.showAusRrp && product.ausRrp !== undefined && <div className="matrix-card-rrp matrix-card-aus">A${product.ausRrp}</div>}
          {cardFormat.showVolume && <div className="matrix-card-vol">Vol: {product.volume ? product.volume.toLocaleString() : '—'}</div>}
          {cardFormat.showRevenue && product.revenue !== undefined && product.revenue > 0 && (
            <div className="matrix-card-rev">Rev: {product.revenue.toLocaleString()}</div>
          )}
          {cardFormat.showCategory && product.category && <div className="matrix-card-category">{product.category}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- Unassigned tray chip ----------

function UnassignedSetDraggable({ item, onRemove }: { item: SetBoardItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `slab-item-${item.id}`, data: { itemId: item.id },
  });
  return (
    <span ref={setNodeRef} className={`unassigned-item draggable ${isDragging ? 'dragging' : ''}`}
      {...attributes} {...listeners}>
      {item.name} <em style={{ opacity: 0.6, fontStyle: 'normal', fontSize: 9 }}>({item.kind})</em>
      <button className="unassigned-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Delete">×</button>
    </span>
  );
}
