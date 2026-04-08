import * as XLSX from 'xlsx';
import type { Project, Product, RangePlan } from '../types';

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

function addPlanSheets(workbook: XLSX.WorkBook, plan: RangePlan, catalogue: Product[], prefix: string) {
  // Transformation Map
  const transformRows = plan.sankeyLinks.map((link) => {
    const sourceItem = plan.currentShelf.items.find((i) => i.id === link.sourceItemId);
    const targetItem = plan.futureShelf.items.find((i) => i.id === link.targetItemId);
    const sourceProduct = sourceItem ? getProduct(catalogue, sourceItem.productId) : null;
    const targetProduct = targetItem ? getProduct(catalogue, targetItem.productId) : null;
    return {
      'Source SKU': sourceProduct?.sku || (sourceItem?.isPlaceholder ? 'PLACEHOLDER' : ''),
      'Source Name': sourceItem?.isPlaceholder ? sourceItem.placeholderName : sourceProduct?.name || '',
      'Source Volume': sourceProduct?.volume || 0,
      'Transfer %': link.percent ?? 100,
      'Transfer Volume': link.volume,
      'Target SKU': targetProduct?.sku || (targetItem?.isPlaceholder ? 'NEW' : ''),
      'Target Name': targetItem?.isPlaceholder ? targetItem.placeholderName : targetProduct?.name || '',
      'Transfer Type': link.type,
    };
  });
  if (transformRows.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(transformRows), `${prefix}Transform`.slice(0, 31));
  }

  // Current Range
  const currentRows = plan.currentShelf.items.map((item, index) => {
    const product = getProduct(catalogue, item.productId);
    return {
      Position: index + 1,
      SKU: product?.sku || (item.isPlaceholder ? 'PLACEHOLDER' : ''),
      Name: item.isPlaceholder ? item.placeholderName : product?.name || '',
      Category: product?.category || '',
      Volume: product?.volume || 0,
      RRP: product?.rrp || 0,
      Revenue: product?.revenue || 0,
    };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(currentRows), `${prefix}Current`.slice(0, 31));

  // Future Range
  const futureRows = plan.futureShelf.items.map((item, index) => {
    const product = getProduct(catalogue, item.productId);
    const incomingLinks = plan.sankeyLinks.filter((l) => l.targetItemId === item.id);
    const totalIncoming = incomingLinks.reduce((sum, l) => sum + l.volume, 0);
    return {
      Position: index + 1,
      SKU: product?.sku || (item.isPlaceholder ? 'NEW' : ''),
      Name: item.isPlaceholder ? item.placeholderName : product?.name || '',
      Category: product?.category || '',
      'Original Volume': product?.volume || 0,
      'Projected Volume': totalIncoming || product?.volume || 0,
      RRP: product?.rrp || 0,
    };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(futureRows), `${prefix}Future`.slice(0, 31));
}

export function exportToExcel(project: Project): void {
  const workbook = XLSX.utils.book_new();

  for (const plan of project.plans) {
    const prefix = project.plans.length > 1 ? `${plan.name.slice(0, 15)} - ` : '';
    addPlanSheets(workbook, plan, project.catalogue, prefix);
  }

  // Summary
  const summaryRows = project.plans.map((plan) => {
    const currentVol = plan.currentShelf.items.reduce((sum, item) => {
      const p = getProduct(project.catalogue, item.productId);
      return sum + (p?.volume || 0);
    }, 0);
    const transferred = plan.sankeyLinks.filter((l) => l.type === 'transfer').reduce((s, l) => s + l.volume, 0);
    return {
      'Plan Name': plan.name,
      'Current SKUs': plan.currentShelf.items.length,
      'Future SKUs': plan.futureShelf.items.length,
      'SKU Change': plan.futureShelf.items.length - plan.currentShelf.items.length,
      'Current Volume': currentVol,
      'Transferred Volume': transferred,
    };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  XLSX.writeFile(workbook, `${project.name.replace(/\s+/g, '_')}_transformation.xlsx`);
}
