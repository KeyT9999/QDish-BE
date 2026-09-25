import type { Types } from "mongoose";

export interface KurumiSourceMenuItem {
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  available: boolean;
}

export interface KurumiSourceMenuSection {
  name: string;
  items: readonly KurumiSourceMenuItem[];
}

export interface KurumiMenuSnapshot {
  sourceUrl: string;
  branchSourceUrl: string;
  fetchedAt: string;
  sections: readonly KurumiSourceMenuSection[];
}

export interface KurumiMenuItem extends KurumiSourceMenuItem {
  category: string;
}

export interface MenuItemListingPatch {
  name: string;
  description: string;
  price: number;
  category: string;
  categoryId: Types.ObjectId;
  imageUrl: string;
  available: boolean;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

function normalizeImageUrl(value: string): string {
  const imageUrl = value.trim();
  if (!imageUrl) return "";

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error(`Invalid menu image URL: ${imageUrl}`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "kurumi.vn" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.startsWith("/menu-images/")
  ) {
    throw new Error(`Menu image must be hosted at https://kurumi.vn/menu-images/: ${imageUrl}`);
  }

  return parsed.toString();
}

export function menuItemKey(item: Pick<KurumiMenuItem, "category" | "name" | "price">): string {
  return `${normalizeLabel(item.category)}\u0000${normalizeLabel(item.name)}\u0000${item.price}`;
}

export function normalizeKurumiMenuSections(
  sections: readonly KurumiSourceMenuSection[]
): { categories: string[]; items: KurumiMenuItem[] } {
  const categories: string[] = [];
  const categoryKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const exactRows = new Set<string>();
  const items: KurumiMenuItem[] = [];

  for (const section of sections) {
    const sourceCategory = section.name.trim();
    if (!sourceCategory || !Array.isArray(section.items)) {
      throw new Error("Menu section must have a name and an items array");
    }

    const category = sourceCategory.startsWith("Gọi thêm -") ? "Gọi thêm" : sourceCategory;
    const categoryKey = normalizeLabel(category);
    if (!categoryKeys.has(categoryKey)) {
      categoryKeys.add(categoryKey);
      categories.push(category);
    }

    for (const sourceItem of section.items) {
      const name = sourceItem.name.trim();
      const description = sourceItem.description.trim();
      if (!name) throw new Error(`Menu item in ${category} is missing a name`);
      if (!Number.isSafeInteger(sourceItem.price) || sourceItem.price <= 0) {
        throw new Error(`Invalid menu item price for ${name}`);
      }
      if (typeof sourceItem.available !== "boolean") {
        throw new Error(`Invalid menu item availability for ${name}`);
      }

      const normalizedItem: KurumiMenuItem = {
        category,
        name,
        description,
        price: sourceItem.price,
        imageUrl: normalizeImageUrl(sourceItem.imageUrl),
        available: sourceItem.available
      };
      const key = menuItemKey(normalizedItem);
      const exactKey = JSON.stringify([
        categoryKey,
        normalizeLabel(name),
        normalizedItem.description,
        normalizedItem.price,
        normalizedItem.imageUrl,
        normalizedItem.available
      ]);

      if (exactRows.has(exactKey)) continue;
      if (itemKeys.has(key)) {
        throw new Error(`Conflicting menu rows share a category/name/price key: ${name}`);
      }

      exactRows.add(exactKey);
      itemKeys.add(key);
      items.push(normalizedItem);
    }
  }

  return { categories, items };
}

export function buildMenuItemListingPatch(
  item: KurumiMenuItem,
  categoryId: Types.ObjectId
): MenuItemListingPatch {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    category: item.category,
    categoryId,
    imageUrl: item.imageUrl,
    available: item.available
  };
}
