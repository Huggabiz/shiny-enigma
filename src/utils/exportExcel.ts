import * as XLSX from 'xlsx';
import type { Project, Product } from '../types';

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

export function exportToExcel(project: Project): void {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Transformation Map
  const transformRows = project.sankeyLinks.map((link) => {
    const sourceItem = project.currentShelf.items.find((i) => i.id === link.sourceItemId);
    const targetItem = project.futureShelf.items.find((i) => i.id === link.targetItemId);
    const sourceProduct = sourceItem ? getProduct(project.catalogue, sourceItem.productId) : null;
    const targetProduct = targetItem ? getProduct(project.catalogue, targetItem.productId) : null;

    return {
      'Source SKU': sourceProduct?.sku || (sourceItem?.isPlaceholder ? 'PLACEHOLDER' : ''),
      'Source Name': sourceItem?.isPlaceholder
        ? sourceItem.placeholderName
        : sourceProduct?.name || '',
      'Source Volume': sourceProduct?.volume || 0,
      'Source Revenue': sourceProduct?.revenue || 0,
      'Target SKU': targetProduct?.sku || (targetItem?.isPlaceholder ? 'NEW' : ''),
      'Target Name': targetItem?.isPlaceholder
        ? targetItem.placeholderName
        : targetProduct?.name || '',
      'Transfer Volume': link.volume,
      'Transfer Type': link.type,
    };
  });

  if (transformRows.length > 0) {
    const transformSheet = XLSX.utils.json_to_sheet(transformRows);
    XLSX.utils.book_append_sheet(workbook, transformSheet, 'Transformation Map');
  }

  // Sheet 2: Current Range
  const currentRows = project.currentShelf.items.map((item, index) => {
    const product = getProduct(project.catalogue, item.productId);
    const label = project.currentShelf.labels.find(
      (l) => index >= l.startPosition && index <= l.endPosition
    );
    return {
      Position: index + 1,
      Segment: label?.text || '',
      SKU: product?.sku || (item.isPlaceholder ? 'PLACEHOLDER' : ''),
      Name: item.isPlaceholder ? item.placeholderName : product?.name || '',
      Category: product?.category || '',
      'Sub-Category': product?.subCategory || '',
      'Product Family': product?.productFamily || '',
      Volume: product?.volume || 0,
      RRP: product?.rrp || 0,
      Revenue: product?.revenue || 0,
    };
  });

  const currentSheet = XLSX.utils.json_to_sheet(currentRows);
  XLSX.utils.book_append_sheet(workbook, currentSheet, 'Current Range');

  // Sheet 3: Future Range
  const futureRows = project.futureShelf.items.map((item, index) => {
    const product = getProduct(project.catalogue, item.productId);
    const label = project.futureShelf.labels.find(
      (l) => index >= l.startPosition && index <= l.endPosition
    );

    // Calculate total incoming volume from sankey links
    const incomingLinks = project.sankeyLinks.filter((l) => l.targetItemId === item.id);
    const totalIncomingVolume = incomingLinks.reduce((sum, l) => sum + l.volume, 0);

    return {
      Position: index + 1,
      Segment: label?.text || '',
      SKU: product?.sku || (item.isPlaceholder ? 'NEW' : ''),
      Name: item.isPlaceholder ? item.placeholderName : product?.name || '',
      Category: product?.category || '',
      'Sub-Category': product?.subCategory || '',
      'Product Family': product?.productFamily || '',
      'Original Volume': product?.volume || 0,
      'Projected Volume': totalIncomingVolume || product?.volume || 0,
      RRP: product?.rrp || 0,
      'Original Revenue': product?.revenue || 0,
    };
  });

  const futureSheet = XLSX.utils.json_to_sheet(futureRows);
  XLSX.utils.book_append_sheet(workbook, futureSheet, 'Future Range');

  // Sheet 4: Volume Summary
  const currentTotal = project.currentShelf.items.reduce((sum, item) => {
    const product = getProduct(project.catalogue, item.productId);
    return sum + (product?.volume || 0);
  }, 0);

  const transferredVolume = project.sankeyLinks
    .filter((l) => l.type === 'transfer')
    .reduce((sum, l) => sum + l.volume, 0);
  const growthVolume = project.sankeyLinks
    .filter((l) => l.type === 'growth')
    .reduce((sum, l) => sum + l.volume, 0);
  const lostVolume = project.sankeyLinks
    .filter((l) => l.type === 'loss')
    .reduce((sum, l) => sum + l.volume, 0);

  const summaryRows = [
    { Metric: 'Current Range SKU Count', Value: project.currentShelf.items.length },
    { Metric: 'Future Range SKU Count', Value: project.futureShelf.items.length },
    {
      Metric: 'SKU Reduction',
      Value: project.currentShelf.items.length - project.futureShelf.items.length,
    },
    { Metric: 'Current Total Volume', Value: currentTotal },
    { Metric: 'Transferred Volume', Value: transferredVolume },
    { Metric: 'Growth Volume', Value: growthVolume },
    { Metric: 'Lost Volume', Value: lostVolume },
    { Metric: 'Net Volume Change', Value: growthVolume - lostVolume },
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Volume Summary');

  XLSX.writeFile(workbook, `${project.name.replace(/\s+/g, '_')}_transformation.xlsx`);
}
