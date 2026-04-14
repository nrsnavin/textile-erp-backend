// src/modules/mrp/mrp-engine.spec.ts
import {
  MrpEngine,
  BomInput,
  OrderDemand,
  StockInput,
} from './mrp-engine';

describe('MrpEngine', () => {
  let engine: MrpEngine;

  beforeEach(() => {
    engine = new MrpEngine();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  const date = (daysFromNow: number) =>
    new Date(Date.now() + daysFromNow * 86400000);

  const makeBomMap = (entries: BomInput[]): Map<string, BomInput> =>
    new Map(entries.map(b => [b.parentItemId, b]));

  const makeStockMap = (entries: StockInput[]): Map<string, StockInput> =>
    new Map(entries.map(s => [s.itemId, s]));

  // ── Basic BOM explosion ──────────────────────────────────────────────────

  describe('single-level BOM explosion', () => {
    it('should compute gross requirements for a single order', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 2.5, unit: 'KG', wastePct: 0, leadTimeDays: 7 },
          { childItemId: 'RM-2', childItemCode: 'DYE-200', childItemName: 'Blue Dye',
            qtyPer: 0.1, unit: 'LTR', wastePct: 0, leadTimeDays: 3 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);

      expect(result.orderCount).toBe(1);
      expect(result.lineCount).toBe(2);
      expect(result.lines).toHaveLength(2);

      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;
      expect(yarn.grossRequirement).toBe(250);       // 100 × 2.5
      expect(yarn.netRequirement).toBe(250);          // no stock

      const dye = result.lines.find(l => l.itemId === 'RM-2')!;
      expect(dye.grossRequirement).toBe(10);          // 100 × 0.1
      expect(dye.netRequirement).toBe(10);
    });

    it('should aggregate demands from multiple orders', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 2, unit: 'KG', wastePct: 0, leadTimeDays: 5 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
        { orderId: 'ORD-2', itemId: 'FG-1', qty: 50,  deliveryDate: date(20) },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);

      expect(result.orderCount).toBe(2);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;
      expect(yarn.grossRequirement).toBe(300);        // (100 + 50) × 2
    });
  });

  // ── Wastage factor ──────────────────────────────────────────────────────

  describe('wastage calculation', () => {
    it('should apply wastage percentage to gross requirements', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 2, unit: 'KG', wastePct: 5, leadTimeDays: 7 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;

      // 100 × 2 × (1 + 5/100) = 210
      expect(yarn.grossRequirement).toBe(210);
    });
  });

  // ── Stock netting ──────────────────────────────────────────────────────

  describe('stock netting', () => {
    it('should reduce net requirement by available stock', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 5 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
      ];

      const stockMap = makeStockMap([
        { itemId: 'RM-1', onHand: 60, onOrder: 20, allocated: 10, unit: 'KG' },
      ]);

      const result = engine.calculate(demands, bomMap, stockMap, 10);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;

      // available = 60 + 20 - 10 = 70
      // net = max(0, 100 - 70) = 30
      expect(yarn.onHand).toBe(60);
      expect(yarn.onOrder).toBe(20);
      expect(yarn.allocated).toBe(10);
      expect(yarn.netRequirement).toBe(30);
    });

    it('should return 0 net requirement when stock is sufficient', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 5 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 50, deliveryDate: date(30) },
      ];

      const stockMap = makeStockMap([
        { itemId: 'RM-1', onHand: 100, onOrder: 0, allocated: 0, unit: 'KG' },
      ]);

      const result = engine.calculate(demands, bomMap, stockMap, 10);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;

      expect(yarn.netRequirement).toBe(0);
      expect(result.requisitions).toHaveLength(0);
    });
  });

  // ── Lead time offsetting ────────────────────────────────────────────────

  describe('lead time offsetting', () => {
    it('should compute orderByDate = requiredByDate - leadTimeDays', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 10 },
        ],
      }]);

      const deliveryDate = date(30);
      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;

      const expectedOrderBy = new Date(deliveryDate.getTime() - 10 * 86400000);
      expect(yarn.orderByDate.getTime()).toBe(expectedOrderBy.getTime());
    });

    it('should use earliest delivery date across multiple orders', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 5 },
        ],
      }]);

      const earlyDate = date(10);
      const lateDate  = date(30);
      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: lateDate },
        { orderId: 'ORD-2', itemId: 'FG-1', qty: 50,  deliveryDate: earlyDate },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;

      expect(yarn.requiredByDate.getTime()).toBe(earlyDate.getTime());
    });
  });

  // ── Multi-level BOM ─────────────────────────────────────────────────────

  describe('multi-level BOM explosion', () => {
    it('should recurse through sub-assemblies to raw materials', () => {
      // FG-1 → SA-1 (sub-assembly, qty 2) → RM-1 (raw material, qty 3)
      // FG-1 → RM-2 (raw material, qty 1)
      const bomMap = makeBomMap([
        {
          parentItemId: 'FG-1',
          lines: [
            { childItemId: 'SA-1', childItemCode: 'SUB-100', childItemName: 'Sub Assembly',
              qtyPer: 2, unit: 'PCS', wastePct: 0, leadTimeDays: 3 },
            { childItemId: 'RM-2', childItemCode: 'BTN-200', childItemName: 'Button',
              qtyPer: 1, unit: 'PCS', wastePct: 0, leadTimeDays: 2 },
          ],
        },
        {
          parentItemId: 'SA-1',
          lines: [
            { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
              qtyPer: 3, unit: 'KG', wastePct: 0, leadTimeDays: 7 },
          ],
        },
      ]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 10, deliveryDate: date(30) },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);

      // RM-1: 10 (FG) × 2 (SA-1 qtyPer) × 3 (RM-1 qtyPer) = 60
      const yarn = result.lines.find(l => l.itemId === 'RM-1')!;
      expect(yarn.grossRequirement).toBe(60);

      // RM-2: 10 × 1 = 10
      const btn = result.lines.find(l => l.itemId === 'RM-2')!;
      expect(btn.grossRequirement).toBe(10);

      // Sub-assembly SA-1 should NOT appear (it's exploded further)
      expect(result.lines.find(l => l.itemId === 'SA-1')).toBeUndefined();
    });

    it('should respect maxDepth and stop recursion', () => {
      // Create a 3-level deep BOM, but limit to depth 1
      const bomMap = makeBomMap([
        {
          parentItemId: 'FG-1',
          lines: [
            { childItemId: 'SA-1', childItemCode: 'SUB-1', childItemName: 'Sub 1',
              qtyPer: 1, unit: 'PCS', wastePct: 0, leadTimeDays: 3 },
          ],
        },
        {
          parentItemId: 'SA-1',
          lines: [
            { childItemId: 'SA-2', childItemCode: 'SUB-2', childItemName: 'Sub 2',
              qtyPer: 1, unit: 'PCS', wastePct: 0, leadTimeDays: 3 },
          ],
        },
        {
          parentItemId: 'SA-2',
          lines: [
            { childItemId: 'RM-1', childItemCode: 'YARN-1', childItemName: 'Yarn',
              qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 7 },
          ],
        },
      ]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 10, deliveryDate: date(30) },
      ];

      // maxDepth=2: FG-1→SA-1 (depth 0→1), SA-1→SA-2 (depth 1→2 stops).
      // SA-2 has a BOM, so the engine enters the `if (childBom)` branch and
      // tries to recurse, but depth(2) >= maxDepth(2) exits immediately.
      // SA-2 is never added as a leaf (only raw materials with no BOM are).
      // Therefore neither SA-2 nor RM-1 appear.
      const result = engine.calculate(demands, bomMap, new Map(), 2);

      expect(result.lines.find(l => l.itemId === 'SA-2')).toBeUndefined();
      expect(result.lines.find(l => l.itemId === 'RM-1')).toBeUndefined();
      expect(result.lineCount).toBe(0);
    });
  });

  // ── Purchase requisitions ───────────────────────────────────────────────

  describe('purchase requisition generation', () => {
    it('should generate PRs only for items with net > 0', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN-100', childItemName: 'Cotton Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 5 },
          { childItemId: 'RM-2', childItemCode: 'DYE-200', childItemName: 'Blue Dye',
            qtyPer: 0.5, unit: 'LTR', wastePct: 0, leadTimeDays: 3 },
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
      ];

      const stockMap = makeStockMap([
        { itemId: 'RM-1', onHand: 200, onOrder: 0, allocated: 0, unit: 'KG' }, // fully covered
        { itemId: 'RM-2', onHand: 10, onOrder: 0, allocated: 0, unit: 'LTR' }, // need 40 more
      ]);

      const result = engine.calculate(demands, bomMap, stockMap, 10);

      expect(result.requisitions).toHaveLength(1);
      expect(result.requisitions[0].itemId).toBe('RM-2');
      expect(result.requisitions[0].netRequirement).toBe(40); // 50 - 10
    });

    it('should sort results by orderByDate (most urgent first)', () => {
      const bomMap = makeBomMap([{
        parentItemId: 'FG-1',
        lines: [
          { childItemId: 'RM-1', childItemCode: 'YARN', childItemName: 'Yarn',
            qtyPer: 1, unit: 'KG', wastePct: 0, leadTimeDays: 20 },  // urgent: orderBy = delivery - 20
          { childItemId: 'RM-2', childItemCode: 'DYE', childItemName: 'Dye',
            qtyPer: 1, unit: 'LTR', wastePct: 0, leadTimeDays: 3 },  // less urgent
        ],
      }]);

      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-1', qty: 100, deliveryDate: date(30) },
      ];

      const result = engine.calculate(demands, bomMap, new Map(), 10);

      // RM-1 has 20-day lead time → orderBy is earlier
      expect(result.lines[0].itemId).toBe('RM-1');
      expect(result.lines[1].itemId).toBe('RM-2');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should return empty results for empty demands', () => {
      const result = engine.calculate([], new Map(), new Map(), 10);
      expect(result.orderCount).toBe(0);
      expect(result.lineCount).toBe(0);
      expect(result.lines).toHaveLength(0);
      expect(result.requisitions).toHaveLength(0);
    });

    it('should handle items with no BOM (skipped gracefully)', () => {
      const demands: OrderDemand[] = [
        { orderId: 'ORD-1', itemId: 'FG-UNKNOWN', qty: 100, deliveryDate: date(30) },
      ];
      const result = engine.calculate(demands, new Map(), new Map(), 10);

      expect(result.orderCount).toBe(1);
      expect(result.lineCount).toBe(0); // no BOM → no materials
    });

    it('should track durationMs', () => {
      const result = engine.calculate([], new Map(), new Map(), 10);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── STRESS TEST: 500 orders × 15 BOM lines ─────────────────────────────

  describe('stress test — 500 orders × 15 BOM lines', () => {
    it('should process 500 orders with 15-line BOMs and produce purchase requisitions', () => {
      // Create 10 different finished goods, each with 15 BOM lines
      // 50 unique raw materials spread across the BOMs
      const bomEntries: BomInput[] = [];
      const FINISHED_GOODS = 10;
      const BOM_LINES_PER_FG = 15;
      const RAW_MATERIALS = 50;

      for (let fg = 0; fg < FINISHED_GOODS; fg++) {
        const lines = [];
        for (let line = 0; line < BOM_LINES_PER_FG; line++) {
          const rmIndex = (fg * 3 + line) % RAW_MATERIALS; // overlap materials across FGs
          lines.push({
            childItemId:   `RM-${rmIndex}`,
            childItemCode: `MAT-${String(rmIndex).padStart(3, '0')}`,
            childItemName: `Raw Material ${rmIndex}`,
            qtyPer:        1 + (line % 5) * 0.5,       // varies: 1.0, 1.5, 2.0, 2.5, 3.0
            unit:          line % 3 === 0 ? 'KG' : line % 3 === 1 ? 'MTR' : 'PCS',
            wastePct:      line % 4 === 0 ? 3 : 0,     // 3% waste every 4th line
            leadTimeDays:  5 + (line % 10),             // 5-14 days
          });
        }
        bomEntries.push({ parentItemId: `FG-${fg}`, lines });
      }

      const bomMap = makeBomMap(bomEntries);

      // Create 500 orders, distributed across the 10 finished goods
      const demands: OrderDemand[] = [];
      for (let i = 0; i < 500; i++) {
        demands.push({
          orderId:      `ORD-${String(i).padStart(4, '0')}`,
          itemId:       `FG-${i % FINISHED_GOODS}`,
          qty:          10 + (i % 50),                // 10 to 59 units
          deliveryDate: date(14 + (i % 60)),          // 14-73 days out
        });
      }

      // Stock: give partial stock for some raw materials
      const stockEntries: StockInput[] = [];
      for (let rm = 0; rm < RAW_MATERIALS; rm++) {
        if (rm % 3 === 0) {
          stockEntries.push({
            itemId:    `RM-${rm}`,
            onHand:    100,
            onOrder:   50,
            allocated: 20,
            unit:      'KG',
          });
        }
        // Other materials have zero stock
      }
      const stockMap = makeStockMap(stockEntries);

      // ── Execute ──
      const result = engine.calculate(demands, bomMap, stockMap, 10);

      // ── Assertions ──
      expect(result.orderCount).toBe(500);

      // The overlap formula (fg*3 + line) % 50 with fg=0..9, line=0..14
      // produces indices 0..41 → 42 unique raw materials
      const UNIQUE_MATERIALS = 42;
      expect(result.lineCount).toBe(UNIQUE_MATERIALS);
      expect(result.lines).toHaveLength(UNIQUE_MATERIALS);

      // Should produce purchase requisitions
      expect(result.requisitions.length).toBeGreaterThan(0);
      // Materials with stock may have lower net requirements, but most should need PRs
      expect(result.requisitions.length).toBeGreaterThan(UNIQUE_MATERIALS * 0.5);

      // All lines should have valid data
      for (const line of result.lines) {
        expect(line.grossRequirement).toBeGreaterThan(0);
        expect(line.netRequirement).toBeGreaterThanOrEqual(0);
        expect(line.orderByDate).toBeInstanceOf(Date);
        expect(line.requiredByDate).toBeInstanceOf(Date);
        expect(line.orderByDate.getTime()).toBeLessThanOrEqual(line.requiredByDate.getTime());
      }

      // Requisitions should be a subset of lines
      for (const pr of result.requisitions) {
        expect(pr.netRequirement).toBeGreaterThan(0);
      }

      // Performance: should complete in under 1 second for 500 orders × 15 lines
      expect(result.durationMs).toBeLessThan(1000);

      // Verify aggregation: check one specific material's gross requirement
      // FG-0 has RM-0 at qtyPer=1.0, wastePct=3% (line 0)
      // FG-0 gets orders 0, 10, 20, ..., 490 (50 orders)
      // Each order qty: 10, 20, 30, ..., 10+49*1 — actually qty = 10 + (i%50)
      // Orders for FG-0: i=0,10,20,...,490 → qty = 10+0, 10+10, 10+20, 10+30, 10+40, 10+0, ...
      // Total qty for FG-0 = sum of (10 + (i%50)) for i in [0,10,20,...,490]
      const fg0Orders = demands.filter(d => d.itemId === 'FG-0');
      const totalFg0Qty = fg0Orders.reduce((s, d) => s + d.qty, 0);

      // RM-0 from FG-0: qtyPer=1.0, wastePct=3%
      // But RM-0 is also used by other FGs due to overlap formula: (fg*3 + line) % 50
      // FG-0 line 0 → RM-0, FG-16 line 2 → RM-0 (16*3+2=50%50=0), etc.
      // Just verify the gross requirement is substantial and positive
      const rm0 = result.lines.find(l => l.itemId === 'RM-0');
      expect(rm0).toBeDefined();
      expect(rm0!.grossRequirement).toBeGreaterThan(totalFg0Qty); // at least one FG contributes

      console.log(`Stress test results:`);
      console.log(`  Orders processed:    ${result.orderCount}`);
      console.log(`  MRP lines:           ${result.lineCount}`);
      console.log(`  Purchase requisitions: ${result.requisitions.length}`);
      console.log(`  Duration:            ${result.durationMs}ms`);
    });
  });
});
