// Default cost code catalog offered when a project has no budget yet
// ("Usar catálogo por default" vs. "Personalizar" — founder decision).
// A code is a leaf (gets an actual BudgetLine) unless some other entry
// in this list names it as a parent — that's how "02 Soft Costs" and
// "03 Hard Costs" end up as pure grouping rows with real sub-partidas
// underneath, instead of every code being a flat, single-level list.
export interface CatalogEntry {
  code: string;
  description: string;
  parentCode: string | null;
}

export const RESIDENTIAL_FOR_SALE_CATALOG: CatalogEntry[] = [
  { code: "01", description: "Land", parentCode: null },
  { code: "01.01", description: "Adquisición del terreno", parentCode: "01" },
  { code: "01.02", description: "Impuestos y derechos de traslado de dominio", parentCode: "01" },
  { code: "01.03", description: "Honorarios de cierre", parentCode: "01" },

  { code: "02", description: "Soft Costs", parentCode: null },
  { code: "02.01", description: "Diseño y proyecto ejecutivo", parentCode: "02" },
  { code: "02.02", description: "Permisos y licencias", parentCode: "02" },
  { code: "02.03", description: "Supervisión y gerencia de obra", parentCode: "02" },
  { code: "02.04", description: "Honorarios legales y notariales", parentCode: "02" },

  { code: "03", description: "Hard Costs", parentCode: null },
  { code: "03.01", description: "Preliminares y cimentación", parentCode: "03" },
  { code: "03.02", description: "Estructura", parentCode: "03" },
  { code: "03.03", description: "Albañilería e instalaciones", parentCode: "03" },
  { code: "03.04", description: "Acabados", parentCode: "03" },
  { code: "03.05", description: "Urbanización y áreas exteriores", parentCode: "03" },

  { code: "04", description: "FF&E", parentCode: null },
  { code: "04.01", description: "Mobiliario de unidad muestra", parentCode: "04" },
  { code: "04.02", description: "Equipamiento de áreas comunes", parentCode: "04" },

  { code: "05", description: "Marketing y ventas", parentCode: null },
  { code: "05.01", description: "Publicidad y promoción", parentCode: "05" },
  { code: "05.02", description: "Sala de ventas y unidad muestra", parentCode: "05" },
  { code: "05.03", description: "Comisiones de venta", parentCode: "05" },

  { code: "06", description: "Contingencia", parentCode: null },
  { code: "06.01", description: "Contingencia de obra", parentCode: "06" },
  { code: "06.02", description: "Contingencia de costos blandos", parentCode: "06" },
];

export function isLeaf(catalog: CatalogEntry[], code: string): boolean {
  return !catalog.some((entry) => entry.parentCode === code);
}
