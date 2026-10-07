import assert from "node:assert/strict";
import {
  filterApprovedTranslations,
  markCategoryTranslationsStale,
  markMenuTranslationsStale
} from "../services/menuTranslationPolicy.js";

const generatedAt = new Date("2026-10-07T09:00:00.000Z");

const itemTranslations = {
  en: {
    approved: {
      value: { name: "Grilled pork rice", description: "Served with rice." },
      status: "APPROVED" as const
    },
    draft: {
      value: { name: "Charcoal grilled pork rice", description: "Served with steamed rice." },
      generatedAt
    }
  },
  zhCN: {
    approved: {
      value: { name: "烤猪肉饭", description: "配米饭。" },
      status: "STALE" as const
    },
    draft: {
      value: { name: "炭烤猪肉饭", description: "配米饭。" },
      generatedAt
    }
  }
};

assert.deepEqual(filterApprovedTranslations(itemTranslations), {
  en: { name: "Grilled pork rice", description: "Served with rice." }
}, "public output contains only approved text and strips management state");

const menuAfterSourceEdit = markMenuTranslationsStale(itemTranslations);
assert.deepEqual(menuAfterSourceEdit, {
  en: {
    approved: {
      value: { name: "Grilled pork rice", description: "Served with rice." },
      status: "STALE"
    }
  },
  zhCN: {
    approved: {
      value: { name: "烤猪肉饭", description: "配米饭。" },
      status: "STALE"
    }
  }
}, "source edits mark existing translations stale and clear pending drafts");
assert.equal(itemTranslations.en.approved.status, "APPROVED", "policy helpers do not mutate stored values");

const categoryAfterSourceEdit = markCategoryTranslationsStale({
  en: {
    approved: { value: { name: "Main dishes" }, status: "APPROVED" },
    draft: { value: { name: "Main courses" }, generatedAt }
  },
  zhCN: { draft: { value: { name: "主菜" }, generatedAt } }
});
assert.deepEqual(categoryAfterSourceEdit, {
  en: { approved: { value: { name: "Main dishes" }, status: "STALE" } }
}, "category edits stale published labels and remove draft-only entries");

console.log("menu translation policy tests passed");
