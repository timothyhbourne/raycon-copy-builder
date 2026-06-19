export const PRODUCT_CATEGORIES: { label: string; products: { id: string; name: string }[] }[] = [
  {
    label: "Everyday Earbuds",
    products: [
      { id: "E25",     name: "Everyday Earbuds" },
      { id: "E25-LE",  name: "Everyday Earbuds (Limited)" },
      { id: "E25-MLB", name: "Everyday Earbuds (MLB)" },
      { id: "E26",     name: "Everyday Earbuds Plus" },
      { id: "E95",     name: "Everyday Earbuds Pro" },
    ],
  },
  {
    label: "Fitness & Sport",
    products: [
      { id: "E45", name: "Fitness Earbuds" },
      { id: "H41", name: "Fitness Headphones" },
    ],
  },
  {
    label: "Sleep & Impact",
    products: [
      { id: "E60", name: "Everyday Sleep Earbuds" },
      { id: "E75", name: "The Impact Earbuds" },
    ],
  },
  {
    label: "Open Earbuds",
    products: [
      { id: "O15", name: "Essential Open" },
      { id: "O25", name: "Open Earbuds Plus" },
      { id: "O55", name: "Everyday Clip Earbuds" },
      { id: "O41", name: "Open Headphones" },
    ],
  },
  {
    label: "Headphones",
    products: [
      { id: "H10", name: "Essential Headphones" },
      { id: "H20", name: "Everyday Headphones Plus" },
      { id: "H90", name: "Everyday Headphones Pro" },
      { id: "B42", name: "Bone Conduction Headphones" },
    ],
  },
  {
    label: "Accessories",
    products: [
      { id: "RACSPN3",  name: "Spin Cables (3 ft)" },
      { id: "RACSPN6",  name: "Spin Cables (6 ft)" },
      { id: "RACSPN10", name: "Spin Cables (10 ft)" },
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
