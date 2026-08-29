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
  { code: "05", description: "Marketing y ventas", parentCode: null },
  { code: "06", description: "Contingencia", parentCode: null },
];

export function isLeaf(catalog: CatalogEntry[], code: string): boolean {
  return !catalog.some((entry) => entry.parentCode === code);
}
