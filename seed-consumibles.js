// Consumibles típicos de un área de mantenimiento que se siembran la primera
// vez que el panel abre Compras sin datos. Nada de esto es inventario: son los
// repuestos que se terminan (tarugos, tornillos, discos de corte, guantes) y
// que el chat anota como "faltan". Con cantidades al azar y unos pocos
// marcados como pendientes, el panel arranca con vida y se entiende qué
// significa "para comprar".
//
// Vive aparte de purchases-store.js y del servidor para que los dos lados
// siembren la MISMA lista: el navegador cuando degrada a localStorage y el
// servidor local cuando todavía no existe data/purchases.json. No importa
// nada de location ni document, así puede cargarlo Node.
export const CONSUMIBLES = [
  { name: 'Tarugos de expansión 8mm',      category: 'Fijación',      qty: [30, 60] },
  { name: 'Tornillos autorroscantes 6x50', category: 'Fijación',      qty: [100, 200] },
  { name: 'Discos de corte 7 1/4"',        category: 'Abrasivos',     qty: [8, 15] },
  { name: 'Brocas SDS-Plus 12mm',          category: 'Mecánica',      qty: [3, 6] },
  { name: 'Lija al agua N°150',            category: 'Abrasivos',     qty: [10, 25] },
  { name: 'Mechas para metal 5mm',         category: 'Mecánica',      qty: [4, 8] },
  { name: 'Guantes de nitrilo',            category: 'Protección',    qty: [40, 60] },
  { name: 'Trapo industrial (1 kg)',       category: 'Limpieza',      qty: [8, 12] },
  { name: 'Cinta aisladora',               category: 'Eléctrico',     qty: [6, 10] },
  { name: 'Desengrasante 5 L',             category: 'Limpieza',      qty: [3, 5] },
  { name: 'Silicona negra',                category: 'Sellado',       qty: [8, 12] },
];

/**
 * Genera la semilla con cantidades al azar dentro de un rango realista.
 * Los primeros quedan "pending" (que es lo que el banner marca como falta),
 * un par en "ordered" (ya en camino) y el resto "received" (llegaron y el
 * panel muestra la sección Recibidos).
 */
export function semillaConsumibles(ahora = Date.now()) {
  return CONSUMIBLES.map((item, i) => {
    const [min, max] = item.qty;
    const quantity = min + Math.floor(Math.random() * (max - min + 1));
    return {
      id: `LOTUS-P${String(ahora + i).slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      name: item.name,
      category: item.category,
      quantity,
      note: '',
      status: i < 4 ? 'pending' : i < 6 ? 'ordered' : 'received',
      createdAt: ahora + i,
      updatedAt: ahora + i,
    };
  });
}