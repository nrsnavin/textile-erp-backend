// src/modules/mrp/mrp-engine.ts
//
// Pure MRP calculation algorithm — no database dependencies.
// Input: orders + BOMs + stock balances → Output: net requirements + purchase requisitions.
//
// ┌─────────────────┐
// │  CONFIRMED &     │   Step 1: Collect demand from orders
// │  IN_PRODUCTION   │          (orderLine.qty × BOM qtyPer × (1 + wastePct))
// │  Orders          │
// └────────┬────────┘
//          ▼
// ┌─────────────────┐
// │  BOM Explosion   │   Step 2: Multi-level BOM explosion
// │  (recursive)     │          Parent → Children → Grandchildren
// └────────┬────────┘
//          ▼
// ┌─────────────────┐
// │  Gross           │   Step 3: Aggregate by item
// │  Requirements    │
// └────────┬────────┘
//          ▼
// ┌─────────────────┐
// │  Stock Netting   │   Step 4: net = max(0, gross - onHand - onOrder + allocated)
// │  + Open POs      │
// └────────┬────────┘
//          ▼
// ┌─────────────────┐
// │  Lead Time       │   Step 5: orderByDate = requiredByDate - leadTimeDays
// │  Offsetting      │
// └────────┬────────┘
//          ▼
// ┌─────────────────┐
// │  Purchase        │   Step 6: Generate PRs for net > 0
// │  Requisitions    │
// └─────────────────┘

export interface BomLineInput {
  childItemId:  string;
  childItemCode: string;
  childItemName: string;
  qtyPer:       number;   // quantity per 1 unit of parent
  unit:         string;
  wastePct:     number;   // e.g. 3.0 = 3%
  leadTimeDays: number;
}

export interface BomInput {
  parentItemId: string;
  lines:        BomLineInput[];
}

export interface OrderDemand {
  orderId:      string;
  itemId:       string;   // finished good
  qty:          number;   // order quantity
  deliveryDate: Date;
}

export interface StockInput {
  itemId:    string;
  onHand:    number;
  onOrder:   number;
  allocated: number;
  unit:      string;
}

// ── Internal aggregation structures ──────────────────────────────────────────

interface GrossRequirement {
  itemId:        string;
  itemCode:      string;
  itemName:      string;
  unit:          string;
  grossQty:      number;
  earliestNeed:  Date;     // earliest delivery date requiring this material
  leadTimeDays:  number;   // max lead time across all BOM references
}

export interface MrpLineResult {
  itemId:           string;
  itemCode:         string;
  itemName:         string;
  unit:             string;
  grossRequirement: number;
  onHand:           number;
  onOrder:          number;
  allocated:        number;
  netRequirement:   number;
  requiredByDate:   Date;
  orderByDate:      Date;
}

export interface MrpRunResult {
  orderCount:   number;
  lineCount:    number;
  lines:        MrpLineResult[];
  requisitions: MrpLineResult[];  // subset where netRequirement > 0
  durationMs:   number;
}

// ── MRP Engine ───────────────────────────────────────────────────────────────

export class MrpEngine {

  /**
   * Run full MRP calculation.
   *
   * @param demands    - Order demand lines (from CONFIRMED / IN_PRODUCTION orders)
   * @param bomMap     - Map of parentItemId → BOM lines
   * @param stockMap   - Map of itemId → stock balance
   * @param maxDepth   - Max BOM recursion depth (prevents infinite loops)
   */
  calculate(
    demands:   OrderDemand[],
    bomMap:    Map<string, BomInput>,
    stockMap:  Map<string, StockInput>,
    maxDepth:  number = 10,
  ): MrpRunResult {
    const startTime = Date.now();

    // Step 1+2: BOM explosion — aggregate gross requirements per item
    const grossMap = new Map<string, GrossRequirement>();

    for (const demand of demands) {
      this.explodeBom(
        demand.itemId,
        demand.qty,
        demand.deliveryDate,
        bomMap,
        grossMap,
        0,
        maxDepth,
      );
    }

    // Step 3+4: Stock netting
    const lines: MrpLineResult[] = [];

    for (const [itemId, gross] of grossMap) {
      const stock = stockMap.get(itemId) ?? {
        itemId, onHand: 0, onOrder: 0, allocated: 0, unit: gross.unit,
      };

      const available = stock.onHand + stock.onOrder - stock.allocated;
      const netRequirement = Math.max(0, this.round2(gross.grossQty - available));

      // Step 5: Lead time offsetting
      const requiredByDate = gross.earliestNeed;
      const orderByDate = new Date(
        requiredByDate.getTime() - gross.leadTimeDays * 86400000,
      );

      lines.push({
        itemId,
        itemCode:         gross.itemCode,
        itemName:         gross.itemName,
        unit:             gross.unit,
        grossRequirement: this.round2(gross.grossQty),
        onHand:           stock.onHand,
        onOrder:          stock.onOrder,
        allocated:        stock.allocated,
        netRequirement,
        requiredByDate,
        orderByDate,
      });
    }

    // Sort by orderByDate (most urgent first)
    lines.sort((a, b) => a.orderByDate.getTime() - b.orderByDate.getTime());

    // Step 6: Requisitions = lines with net > 0
    const requisitions = lines.filter(l => l.netRequirement > 0);

    return {
      orderCount:   demands.length,
      lineCount:    lines.length,
      lines,
      requisitions,
      durationMs:   Date.now() - startTime,
    };
  }

  /**
   * Recursive BOM explosion.
   * For each component in the BOM, compute gross requirement = parentQty × qtyPer × (1 + wastePct/100).
   * If the child has its own BOM (sub-assembly), recurse.
   */
  private explodeBom(
    parentItemId: string,
    parentQty:    number,
    deliveryDate: Date,
    bomMap:       Map<string, BomInput>,
    grossMap:     Map<string, GrossRequirement>,
    depth:        number,
    maxDepth:     number,
  ): void {
    if (depth >= maxDepth) return;

    const bom = bomMap.get(parentItemId);
    if (!bom) return; // No BOM = raw material or unknown item — skip

    for (const line of bom.lines) {
      // Apply wastage factor
      const effectiveQty = parentQty * line.qtyPer * (1 + line.wastePct / 100);

      // Check if child has its own BOM (sub-assembly)
      const childBom = bomMap.get(line.childItemId);

      if (childBom) {
        // Recurse — this is a sub-assembly that needs further explosion
        this.explodeBom(
          line.childItemId,
          effectiveQty,
          deliveryDate,
          bomMap,
          grossMap,
          depth + 1,
          maxDepth,
        );
      } else {
        // Leaf node — raw material, accumulate gross requirement
        const existing = grossMap.get(line.childItemId);
        if (existing) {
          existing.grossQty += effectiveQty;
          // Keep the earliest need date
          if (deliveryDate < existing.earliestNeed) {
            existing.earliestNeed = deliveryDate;
          }
          // Keep the longest lead time
          if (line.leadTimeDays > existing.leadTimeDays) {
            existing.leadTimeDays = line.leadTimeDays;
          }
        } else {
          grossMap.set(line.childItemId, {
            itemId:       line.childItemId,
            itemCode:     line.childItemCode,
            itemName:     line.childItemName,
            unit:         line.unit,
            grossQty:     effectiveQty,
            earliestNeed: deliveryDate,
            leadTimeDays: line.leadTimeDays,
          });
        }
      }
    }
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
