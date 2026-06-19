export const PRODUCT_CATEGORIES: { label: string; products: { id: string; name: string }[] }[] = [
  {
    label: "Open Audio",
    products: [
      { id: "O15", name: "Essential Open Earbuds" },
      { id: "O25", name: "Fitness Open Earbuds" },
      { id: "O55", name: "Everyday Clip Earbuds" },
      { id: "B42", name: "Bone Conduction Headphones" },
    ],
  },
  {
    label: "Earbuds",
    products: [
      { id: "E25", name: "Everyday Earbuds" },
      { id: "E45", name: "Fitness Earbuds" },
      { id: "E60", name: "Sleep Earbuds" },
      { id: "E75", name: "Impact Earbuds" },
      { id: "E95", name: "Pro Earbuds" },
    ],
  },
  {
    label: "Headphones",
    products: [
      { id: "H10", name: "Essential Headphones" },
      { id: "H20", name: "Everyday Headphones" },
      { id: "H41", name: "Fitness Headphones" },
    ],
  },
  {
    label: "AI Notetaker",
    products: [
      { id: "NOTETAKER", name: "AI Notetaker" },
    ],
  },
  {
    label: "Fast Charging",
    products: [
      { id: "RACSPN3",  name: "Magic Spin Cable (3 ft)" },
      { id: "RACSPN6",  name: "Magic Spin Cable (6 ft)" },
      { id: "RACSPN10", name: "Magic Spin Cable (10 ft)" },
      { id: "ADAPTER45", name: "Magic Travel Adapter (45W)" },
    ],
  },
];

export const PRODUCT_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.flatMap((cat) => cat.products.map((p) => [p.id, p.name]))
);

export const VALID_PRODUCT_IDS = new Set(Object.keys(PRODUCT_NAME_BY_ID));

export function getProductName(id: string): string {
  return PRODUCT_NAME_BY_ID[id] ?? id;
}
