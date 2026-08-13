export interface InventoryForecast {
  code: string; stock: number; dailyDemand: number; horizonDays: number; projectedDemand: number; shortage: number;
  history: Array<{ period: string; consumption: number }>;
  explanation: string;
}
export function deterministicInventoryForecast(code: string, availableQuantity: number, horizonDays = 90): InventoryForecast {
  const stock = Math.max(0, Math.round(availableQuantity));
  const seed = stableHash(code);
  const baseline = 1 + (seed % 9);
  const factors = [80 + (seed % 11), 92 + ((seed >> 3) % 13), 104 + ((seed >> 5) % 15)];
  const history = factors.map((factor, index) => ({ period: `М-${3 - index}`, consumption: Math.round(baseline * 30 * factor / 100) }));
  const dailyDemand = Math.max(1, Math.round(history.reduce((sum, item) => sum + item.consumption, 0) / history.length / 30));
  const projectedDemand = dailyDemand * horizonDays;
  const shortage = Math.max(0, projectedDemand - stock);
  return { code, stock, dailyDemand, horizonDays, projectedDemand, shortage, history, explanation: `Детерминированный demo-прогноз: среднее синтетическое потребление за 3 месяца (${dailyDemand} ед./день) × ${horizonDays} дней − текущий остаток ${stock} + ожидаемое поступление 0 ед. (поступления и lead time в прототипе не моделируются).` };
}
function stableHash(value: string): number { let hash = 2166136261; for (const character of value) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); } return hash >>> 0; }
