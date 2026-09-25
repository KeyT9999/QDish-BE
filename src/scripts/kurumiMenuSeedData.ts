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

export interface KurumiSeedOptions {
  help: boolean;
  username?: string;
  apply: boolean;
  confirmDb?: string;
  confirmHost?: string;
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

export function menuCategoryKey(category: string): string {
  return normalizeLabel(category);
}

export function indexExistingMenuMatches<T extends { category: string; name: string; price: number }>(
  existingItems: readonly T[],
  incomingItems: readonly KurumiMenuItem[]
): Map<string, T> {
  const requestedKeys = new Set(incomingItems.map(menuItemKey));
  const matches = new Map<string, T>();
  for (const item of existingItems) {
    const key = menuItemKey(item);
    if (!requestedKeys.has(key)) continue;
    if (matches.has(key)) {
      throw new Error("Ambiguous existing menu item matches an official menu entry");
    }
    matches.set(key, item);
  }
  return matches;
}

export function parseKurumiSeedOptions(args: readonly string[]): KurumiSeedOptions {
  const values = new Map<string, string>();
  let apply = false;
  let help = false;
  const valueFlags = new Set(["--username", "--confirm-db", "--confirm-host"]);
  const knownFlags = new Set([...valueFlags, "--apply", "--help"]);

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!knownFlags.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (values.has(flag) || (flag === "--apply" && apply) || (flag === "--help" && help)) {
      throw new Error(`Duplicate option: ${flag}`);
    }

    if (flag === "--apply") {
      apply = true;
      continue;
    }
    if (flag === "--help") {
      help = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }

  if (help) {
    if (args.length !== 1) throw new Error("--help cannot be combined with other options");
    return { help: true, apply: false };
  }

  const rawUsername = values.get("--username");
  if (!rawUsername || !/^[a-zA-Z0-9._-]{1,64}$/.test(rawUsername)) {
    throw new Error("A valid --username is required");
  }

  const confirmDb = values.get("--confirm-db");
  const confirmHost = values.get("--confirm-host");
  if (!apply && (confirmDb || confirmHost)) {
    throw new Error("Confirmation options require --apply");
  }
  if (apply) {
    if (confirmDb !== "QDish") throw new Error("--apply requires --confirm-db QDish");
    if (!confirmHost || !/^[a-z0-9.-]+$/i.test(confirmHost)) {
      throw new Error("--apply requires a valid --confirm-host");
    }
  }

  return {
    help: false,
    username: rawUsername.toLocaleLowerCase("en-US"),
    apply,
    confirmDb,
    confirmHost: confirmHost?.toLocaleLowerCase("en-US")
  };
}

export function assertKurumiSeedTarget(uri: string, options: KurumiSeedOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("Configured MongoDB target is invalid");
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== "mongodb+srv:" || !parsed.hostname.endsWith(".mongodb.net")) {
    throw new Error("KURUMI seed target must be the approved MongoDB Atlas cluster");
  }
  if (databaseName !== "QDish") throw new Error("Configured MongoDB database is not QDish");

  if (options.apply) {
    if (options.confirmDb !== databaseName) throw new Error("Database confirmation does not match");
    if (options.confirmHost !== parsed.hostname.toLocaleLowerCase("en-US")) {
      throw new Error("Host confirmation does not match the configured MongoDB target");
    }
  }

  return parsed;
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
