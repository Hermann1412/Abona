export function formatCurrency(priceCents) {
  return (Math.round(priceCents) / 100).toFixed(2);
}

export function formatTHB(priceCents) {
  return '฿' + (Math.round(priceCents) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

export default formatCurrency;