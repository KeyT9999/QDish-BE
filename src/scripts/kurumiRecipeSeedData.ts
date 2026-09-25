import type { Types } from "mongoose";
import { parseKurumiSeedOptions, type KurumiMenuItem, type KurumiSeedOptions } from "./kurumiMenuSeedData.js";

export type RecipeUnit = "g" | "ml";
export type RecipeBasis = "menu-description" | "menu-name-inference";

export interface KurumiRecipeIngredient {
  name: string;
  category: "protein" | "tinh_bot" | "chat_beo" | "rau_cu" | "gia_vi" | "sua" | "do_uong";
  defaultUnit: RecipeUnit;
  gramsPerUnit: number;
  quantity: number;
  unit: RecipeUnit;
  gramsResolved: number;
}

export interface KurumiRecipeSuggestion {
  name: string;
  category: string;
  price: number;
  basis: RecipeBasis;
  ingredients: KurumiRecipeIngredient[];
  servingCount: 1;
  servingSizeGrams: number;
  cookingMethod: "raw" | "boil" | "steam" | "stir_fry" | "deep_fry" | "grill" | "bake" | "braise";
}

export interface KurumiRecipeIngredientDefinition {
  name: string;
  category: KurumiRecipeIngredient["category"];
  defaultUnit: RecipeUnit;
  gramsPerUnit: number;
  isVerified: false;
  source: "kurumi-demo-estimate";
}

export interface KurumiRecipePlan {
  recipes: KurumiRecipeSuggestion[];
  ingredients: KurumiRecipeIngredientDefinition[];
}

export interface KurumiRecipeSeedOptions extends KurumiSeedOptions {
  refreshDemo: boolean;
}

export interface KurumiDemoIngredientOrigin {
  restaurantId: string | null;
  isVerified: boolean;
  source: string;
  hasNutritionFacts: boolean;
}

interface VocabularyEntry {
  name: string;
  aliases: readonly string[];
  category: KurumiRecipeIngredient["category"];
  unit: RecipeUnit;
  quantity: number;
}

const v = (
  name: string,
  aliases: string[],
  category: VocabularyEntry["category"],
  quantity: number,
  unit: RecipeUnit = "g"
): VocabularyEntry => ({ name, aliases, category, unit, quantity });

// Menu words map to plant-based ingredients only. Amounts are demo estimates, not
// KURUMI's proprietary portions; all nutrient fields are intentionally omitted.
const VOCABULARY: readonly VocabularyEntry[] = [
  v("Bánh mì nguyên cám", ["bánh mì nguyên cám", "bánh mì wholemeal", "wholemeal bread", "whole-wheat bread", "whole wheat bread", "sourdough baguette", "bánh mì men chua", "bánh mì sourdough", "bánh mì", "whole wheat bun", "wholemeal bun", "bun"], "tinh_bot", 70),
  v("Bánh tortilla nguyên cám", ["bánh tortilla nguyên cám", "whole wheat tortillas", "whole-wheat tortilla", "whole wheat tortilla", "tortilla"], "tinh_bot", 55),
  v("Bánh mì nướng gia vị", ["garlic croutons", "croutons", "bánh mì nướng gia vị"], "tinh_bot", 25),
  v("Mì quinoa không gluten", ["gluten-free quinoa penne", "quinoa penne", "mì ống hạt diêm mạch"], "tinh_bot", 75),
  v("Mì dẹt", ["linguine noodle", "linguine pasta", "linguine", "mì dẹt"], "tinh_bot", 85),
  v("Mì spaghetti", ["spaghetti"], "tinh_bot", 85),
  v("Mì pasta", ["pasta", "mì ống", "mì ý", "noodle"], "tinh_bot", 85),
  v("Bún gạo lứt", ["brown rice noodle", "bún gạo lứt"], "tinh_bot", 85),
  v("Gạo lứt", ["brown rice", "gạo lứt", "cơm gạo lứt"], "tinh_bot", 160),
  v("Kiều mạch", ["buckwheat", "kiều mạch"], "tinh_bot", 150),
  v("Hạt diêm mạch", ["quinoa", "hạt diêm mạch"], "tinh_bot", 120),
  v("Yến mạch", ["oatmeal", "rolled oats", "oat", "yến mạch"], "tinh_bot", 45),
  v("Bột đậu gà", ["chickpea flour", "bột đậu gà"], "tinh_bot", 55),
  v("Bột mì nguyên cám", ["whole wheat flour", "whole-wheat flour", "bột mì nguyên cám", "bột mỳ nguyên cám"], "tinh_bot", 45),
  v("Bột mì", ["wheat flour", "white flour", "bột mì", "bột mỳ"], "tinh_bot", 45),
  v("Bột năng", ["tapioca starch", "bột năng"], "tinh_bot", 8),
  v("Bột bắp", ["corn starch", "cornstarch", "bột bắp"], "tinh_bot", 8),
  v("Bột gạo lứt", ["brown rice flour", "bột gạo lứt"], "tinh_bot", 45),
  v("Khoai lang", ["sweet potato", "khoai lang"], "rau_cu", 75),
  v("Khoai tây", ["potato", "khoai tây"], "rau_cu", 75),
  v("Đậu đỏ", ["adzuki beans", "adzuki bean", "red bean", "đậu đỏ"], "protein", 60),
  v("Đậu nành Nhật", ["edamame", "đậu nành nhật"], "protein", 45),
  v("Tempeh đậu nành", ["soy tempeh", "soya tempeh", "tempeh đậu nành", "tempeh"], "protein", 65),
  v("Tempeh đậu gà", ["chickpea tempeh", "tempeh đậu gà"], "protein", 65),
  v("Đạm đậu nành thực vật", ["vegan soya protein", "soy protein", "đạm đậu nành", "bột protein đậu nành"], "protein", 20),
  v("Đạm đậu Hà Lan thực vật", ["vegan pea protein", "pea protein", "đạm đậu hà lan"], "protein", 15),
  v("Thịt thực vật Let's Plant", ["let's plant meat patty", "let''s plant meat patty", "plant meat patty", "bánh patties thịt thực vật", "thịt thực vật"], "protein", 100),
  v("Đậu hũ", ["fried tofu", "firm tofu", "extra firm tofu", "tofu", "đậu hũ", "đậu hủ"], "protein", 75),
  v("Da đậu hũ", ["tofu skin", "da đậu hũ", "tàu hủ ky", "váng đậu"], "protein", 35),
  v("Nấm đùi gà", ["king oyster mushrooms", "king oyster mushroom", "oyster mushrooms", "nấm đùi gà"], "rau_cu", 65),
  v("Nấm đông cô", ["shiitake", "nấm đông cô"], "rau_cu", 40),
  v("Nấm rơm", ["straw mushrooms", "mushrooms", "nấm rơm", "nấm"], "rau_cu", 55),
  v("Rong biển wakame", ["wakame", "seaweed", "rong biển"], "rau_cu", 4),
  v("Rong sụn", ["sea moss", "rong sụn"], "rau_cu", 15),
  v("Rong biển nori", ["nori", "rong biển nori"], "rau_cu", 3),
  v("Bông cải xanh", ["broccoli", "bông cải xanh"], "rau_cu", 45),
  v("Rau chân vịt", ["spinach", "rau chân vịt", "rau bina"], "rau_cu", 35),
  v("Xà lách", ["lettuce", "salad greens", "rau salad", "xà lách", "rau trộn"], "rau_cu", 45),
  v("Cải mầm", ["microgreens", "micro green", "cải mầm", "cải con", "rau mầm"], "rau_cu", 8),
  v("Bắp cải tím", ["red cabbage", "bắp cải tím"], "rau_cu", 35),
  v("Bắp cải lên men", ["sauerkraut", "fermented cabbage", "bắp cải lên men", "bắp cải muối", "dưa bắp cải"], "rau_cu", 35),
  v("Hoa chuối", ["banana flowers", "banana blossom", "hoa chuối"], "rau_cu", 30),
  v("Cải xanh", ["green mustard", "mustard greens", "cải xanh"], "rau_cu", 25),
  v("Giá đỗ", ["soya sprouts", "bean sprouts", "giá đỗ"], "rau_cu", 25),
  v("Củ dền", ["beetroot", "beet", "củ dền"], "rau_cu", 35),
  v("Cà chua phơi nắng", ["sun-dried tomato", "sun dried tomato", "cà chua phơi nắng", "cà chua khô"], "rau_cu", 15),
  v("Cà chua bi", ["cherry tomato", "cherry tomatoes", "cà chua bi"], "rau_cu", 45),
  v("Cà chua", ["tomatoes", "tomato", "cà chua"], "rau_cu", 45),
  v("Ớt chuông đỏ", ["red bell pepper", "bell pepper", "ớt chuông đỏ", "ớt chuông"], "rau_cu", 35),
  v("Dưa leo", ["cucumber", "dưa leo", "dưa chuột"], "rau_cu", 40),
  v("Cà rốt xông khói", ["smoked carrot", "cà rốt xông khói"], "rau_cu", 45),
  v("Cà rốt ngâm", ["pickled carrot", "cà rốt ngâm"], "rau_cu", 30),
  v("Cà rốt", ["carrot", "cà rốt"], "rau_cu", 40),
  v("Bí ngòi", ["zucchini", "bí ngòi"], "rau_cu", 45),
  v("Cà tím", ["eggplant", "aubergine", "cà tím"], "rau_cu", 45),
  v("Bí đỏ", ["pumpkin", "bí đỏ"], "rau_cu", 65),
  v("Hành tím", ["purple onion", "red onion", "shallot", "hành tím"], "rau_cu", 18),
  v("Hành tây", ["onion", "hành tây"], "rau_cu", 25),
  v("Tỏi", ["garlic", "tỏi"], "rau_cu", 4),
  v("Gừng", ["ginger", "gừng"], "rau_cu", 5),
  v("Cần tây", ["celery", "cần tây"], "rau_cu", 30),
  v("Nấm men dinh dưỡng", ["nutritional yeast", "nut parmesan", "nutmezan", "vụn đậu dinh dưỡng"], "gia_vi", 8),
  v("Atisô ngâm", ["marinated artichokes", "artichoke", "atisô", "atiso"], "rau_cu", 25),
  v("Ô liu", ["green olive", "black olives", "olives", "hạt oliu", "hạt ô liu", "quả oliu", "quả ô liu"], "rau_cu", 18),
  v("Bơ quả", ["mashed avocado", "avocado", "bơ nghiền", "bơ dầm", "bơ"], "rau_cu", 45),
  v("Chuối", ["banana", "chuối"], "rau_cu", 60),
  v("Xoài", ["mango", "xoài"], "rau_cu", 50),
  v("Thơm", ["pineapple", "thơm"], "rau_cu", 45),
  v("Đu đủ", ["papaya", "đu đủ"], "rau_cu", 60),
  v("Dâu tây", ["strawberry", "strawberries", "dâu tây"], "rau_cu", 35),
  v("Việt quất", ["blueberry", "blackberry", "việt quất", "mâm xôi đen"], "rau_cu", 30),
  v("Thanh long đỏ", ["red dragon fruit", "dragon fruit", "thanh long đỏ", "thanh long"], "rau_cu", 45),
  v("Chanh dây", ["passion fruit", "passion fruits", "chanh dây", "chanh leo"], "rau_cu", 25),
  v("Quả anh đào", ["cherry", "cherries", "anh đào"], "rau_cu", 25),
  v("Nam việt quất", ["cranberries", "cranberry", "nam việt quất"], "rau_cu", 12),
  v("Chà là", ["dates", "date", "chà là"], "rau_cu", 22),
  v("Táo", ["green apple", "apple", "táo"], "rau_cu", 60),
  v("Cam", ["orange juice", "orange", "cam"], "rau_cu", 60),
  v("Chanh xanh", ["lime juice", "lime", "chanh xanh"], "rau_cu", 15),
  v("Chanh vàng", ["lemon juice", "lemon", "chanh vàng"], "rau_cu", 12),
  v("Nho khô", ["raisin", "raisins", "nho khô"], "rau_cu", 12),
  v("Nho tươi", ["grape", "grapes", "nho tươi"], "rau_cu", 80),
  v("Hạt điều", ["cashew", "cashews", "hạt điều"], "chat_beo", 16),
  v("Hạnh nhân", ["almond", "almonds", "hạnh nhân"], "chat_beo", 12),
  v("Đậu phộng", ["peanut", "peanuts", "đậu phụng", "đậu phộng"], "chat_beo", 12),
  v("Hạt óc chó", ["walnut", "walnuts", "hạt óc chó"], "chat_beo", 10),
  v("Hạt hỗn hợp", ["mix nuts", "mixed nuts", "hạt các loại", "hạt hỗn hợp"], "chat_beo", 12),
  v("Hạt hỗn hợp", ["mix seeds", "mixed seeds", "hạt các loại"], "chat_beo", 8),
  v("Hạt chia", ["chia seeds", "chia", "hạt chia"], "chat_beo", 6),
  v("Hạt lanh", ["flaxseed", "flax seeds", "hạt lanh"], "chat_beo", 6),
  v("Hạt mè", ["black sesame", "sesame", "mè đen", "mè", "vừng"], "chat_beo", 4),
  v("Dừa sợi khô", ["coconut flakes", "dried coconut", "dried coconut flakes", "dừa bào khô", "dừa sợi khô", "dừa khô"], "chat_beo", 8),
  v("Dừa tươi", ["fresh coconut", "fresh coconut meat", "dừa tươi"], "rau_cu", 45),
  v("Bơ đậu phộng", ["peanut butter", "bơ đậu phụng", "bơ đậu phộng"], "chat_beo", 15),
  v("Bơ hạt điều", ["cashew butter", "bơ hạt điều"], "chat_beo", 12),
  v("Sữa dừa", ["coconut milk", "sữa dừa", "nước cốt dừa", "dừa"], "sua", 120, "ml"),
  v("Kem dừa", ["coconut cream", "kem dừa"], "sua", 30),
  v("Sữa yến mạch", ["oat milk", "oatmilk", "sữa yến mạch", "sữa oats"], "sua", 150, "ml"),
  v("Sữa hạt điều", ["cashew milk", "sữa hạt điều"], "sua", 160, "ml"),
  v("Nước dừa", ["coconut water", "nước dừa"], "do_uong", 160, "ml"),
  v("Phô mai hạt điều thuần chay", ["cashew cream cheese", "cashew cheese", "fermented cashew cheese", "phô mai hạt điều", "kem hạt điều lên men", "kem hạt điều", "sốt hạt điều", "cashew sauce", "cashew dill sauce", "kem phô mai hạt điều"], "sua", 25),
  v("Phô mai Brie thuần chay", ["homemade brie cheese", "aged brie cheese", "vegan brie", "phô mai brie", "phomai vegan brie", "phomai brie"], "sua", 25),
  v("Sốt mayonnaise thuần chay", ["spicy mayo", "homemade mayo", "mayo", "mayonnaise", "sốt mayo", "sốt mayonnaise"], "gia_vi", 18),
  v("Sốt hollandaise thuần chay", ["vegan hollandaise", "hollandaise sauce", "sốt kiểu hà lan"], "gia_vi", 20),
  v("Sốt pesto húng quế", ["homemade vegan pesto", "pesto sauce", "pesto", "sốt pesto", "sốt húng quế"], "gia_vi", 18),
  v("Salsa cà chua", ["salsa", "salsa tomato", "salsa cà chua", "rau trộn"], "gia_vi", 25),
  v("Sốt cà chua", ["tomato sauce", "tomato paste", "sốt cà chua"], "gia_vi", 25),
  v("Sốt BBQ thuần chay", ["bbq sauce", "barbecue sauce", "sốt bbq"], "gia_vi", 18),
  v("Mù tạt", ["dijon mustard", "mustard", "mù tạt"], "gia_vi", 8),
  v("Nước tương", ["soya sauce", "soy sauce", "nước tương", "xì dầu"], "gia_vi", 12),
  v("Sốt tương ớt Sriracha", ["sriracha", "sốt sriracha"], "gia_vi", 8),
  v("Tương miso", ["miso paste", "miso", "sốt miso", "miso nhật"], "gia_vi", 15),
  v("Sốt cà ri vàng thuần chay", ["yellow curry", "yellow curry paste", "sốt cà ri vàng", "cà ri vàng"], "gia_vi", 20),
  v("Dầu ô liu", ["olive oil", "dầu ô liu", "dầu oliu"], "chat_beo", 6, "ml"),
  v("Dầu mè", ["sesame oil", "dầu mè"], "chat_beo", 5, "ml"),
  v("Dầu dừa", ["coconut virgin oil", "coconut oil", "virgin coconut oil", "dầu dừa"], "chat_beo", 5, "ml"),
  v("Dầu ăn thực vật", ["vegetable oil", "dầu ăn"], "chat_beo", 5, "ml"),
  v("Mứt hạt chia", ["chia jam", "mứt hạt chia"], "gia_vi", 18),
  v("Mứt dâu", ["strawberry homemade jam", "strawberry jam", "mứt dâu", "mứt dâu tây"], "gia_vi", 18),
  v("Siro thốt nốt", ["palm sugar syrup", "palm syrup", "siro thốt nốt", "xi-rô thốt nốt"], "gia_vi", 12),
  v("Đường thốt nốt", ["palm sugar", "jaggery", "đường thốt nốt", "đường cọ"], "gia_vi", 10),
  v("Đường dừa", ["coconut blossom sugar", "coconut sugar", "đường dừa", "đường hoa dừa"], "gia_vi", 10),
  v("Đường mía", ["brown cane sugar", "cane sugar", "sugar", "đường mía", "đường nâu"], "gia_vi", 10),
  v("Bột cacao", ["cacao powder", "cocoa powder", "cacao", "cocoa", "bột ca cao", "bột cacao", "khối cacao"], "gia_vi", 8),
  v("Bơ cacao", ["cacao butter", "cocoa butter", "bơ cacao"], "chat_beo", 6),
  v("Sô-cô-la đen thuần chay", ["dark chocolate", "homemade chocolate", "chocolate", "sô cô la đen", "socola đen", "sô cô la", "socola"], "sua", 12),
  v("Tinh chất vani", ["vanilla extract", "vanilla", "tinh chất vani", "vani"], "gia_vi", 1),
  v("Quế", ["cinnamon", "quế"], "gia_vi", 1),
  v("Tinh bột tảo xoắn", ["spirulina powder", "spirulina", "bột tảo xanh", "tảo xoắn"], "gia_vi", 2),
  v("Bột matcha", ["matcha"], "gia_vi", 4),
  v("Bột nghệ", ["turmeric powder", "turmeric root", "turmeric", "nghệ"], "gia_vi", 4),
  v("Lá trà chùm ngây", ["moringa tea", "moringa", "chùm ngây"], "do_uong", 4),
  v("Trà Earl Grey", ["earl grey tea", "earl grey"], "do_uong", 4),
  v("Trà hoa cúc", ["chamomile", "hoa cúc"], "do_uong", 3),
  v("Trà atisô", ["artichoke tea", "atisô tea", "trà atisô", "trà atiso"], "do_uong", 4),
  v("Trà xanh", ["green tea", "trà xanh"], "do_uong", 4),
  v("Cà phê espresso", ["espresso", "coffee", "cà phê", "cafe"], "do_uong", 30, "ml"),
  v("Nước nóng", ["hot water", "nước nóng"], "do_uong", 350, "ml"),
  v("Nước lọc", ["water", "nước lọc"], "do_uong", 180, "ml"),
  v("Nước cam ép", ["orange juice", "nước cam"], "do_uong", 120, "ml"),
  v("Nước soda", ["soda water", "soda", "nước soda"], "do_uong", 200, "ml"),
  v("Nước tonic", ["tonic water", "nước tonic"], "do_uong", 250, "ml"),
  v("Nước gừng có ga", ["ginger ale", "ginger beer", "nước gừng có ga"], "do_uong", 250, "ml"),
  v("Trà kombucha", ["kombucha", "trà kombucha"], "do_uong", 250, "ml"),
  v("Muối hồng Himalaya", ["himalayan salt", "pink salt", "muối hồng himalaya", "muối"], "gia_vi", 1),
  v("Tiêu đen", ["black pepper", "pepper", "tiêu"], "gia_vi", 1),
  v("Ớt", ["chili flakes", "chili", "chilli", "ớt bột", "ớt"], "gia_vi", 2),
  v("Thì là", ["dill", "thì là"], "rau_cu", 3),
  v("Húng quế", ["basil", "húng quế"], "rau_cu", 4),
  v("Ngò rí", ["cilantro", "coriander", "green cilantro", "ngò rí", "rau mùi"], "rau_cu", 4),
  v("Bạc hà", ["mint", "bạc hà"], "rau_cu", 3),
  v("Kinh giới", ["oregano", "kinh giới", "kinh giới khô"], "gia_vi", 1),
  v("Rau mùi tây", ["parsley", "ngò tây"], "rau_cu", 3),
  v("Đậu Hà Lan", ["green peas", "đậu hà lan"], "protein", 25),
  v("Dưa muối", ["pickled cucumbers", "pickled cucumber", "dưa chuột ngâm", "dưa leo ngâm"], "rau_cu", 20),
  v("Hành ngâm", ["pickled onion", "pickled red onion", "hành tím ngâm", "hành ngâm"], "rau_cu", 15),
  v("Bột tỏi", ["garlic powder", "bột tỏi"], "gia_vi", 1),
  v("Bột nở", ["baking soda", "baking powder", "muối nở"], "gia_vi", 2),
  v("Hương dừa", ["coconut flavor", "hương dừa"], "gia_vi", 1),
  v("Kẹo quả cầu thuần chay", ["chocolate bliss ball", "peanut bliss ball", "choco bliss ball", "bánh quả cầu vị socola", "bánh quả cầu đậu phụng"], "sua", 25),
  v("Pudding hạt chia", ["chia pudding", "pudding hạt chia"], "sua", 45),
  v("Hummus đậu gà", ["hummus", "hummus chickpea"], "protein", 25),
  v("Rượu vang đỏ", ["red wine", "wine"], "do_uong", 150, "ml"),
  v("Bia thuần chay đóng chai", ["beer", "bia"], "do_uong", 330, "ml"),
  v("Nước ép trái cây tổng hợp", ["fresh juice", "nước ép trái cây"], "do_uong", 280, "ml"),
  v("Sữa chua thực vật", ["vegan yogurt", "sữa chua thực vật"], "sua", 30),
  v("Kem vani thực vật", ["vegan vanilla ice cream", "kem vani thực vật"], "sua", 45),
  v("Nhân bánh thuần chay", ["vegan filling", "nhân bánh thuần chay"], "sua", 35),
];

function normalizeWords(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseKurumiRecipeSeedOptions(args: readonly string[]): KurumiRecipeSeedOptions {
  const refreshFlags = args.filter((arg) => arg === "--refresh-demo").length;
  if (refreshFlags > 1) throw new Error("Duplicate option: --refresh-demo");
  const refreshDemo = refreshFlags === 1;
  const baseOptions = parseKurumiSeedOptions(args.filter((arg) => arg !== "--refresh-demo"));
  if (refreshDemo && baseOptions.help) throw new Error("--refresh-demo cannot be combined with --help");
  return { ...baseOptions, refreshDemo };
}

export function isRefreshableKurumiRecipe(
  rows: readonly { ingredientId: string | Types.ObjectId }[],
  ingredientsById: ReadonlyMap<string, KurumiDemoIngredientOrigin>,
  restaurantId: string
): boolean {
  return rows.length > 0 && rows.every((row) => {
    const ingredient = ingredientsById.get(String(row.ingredientId));
    return Boolean(
      ingredient &&
      ingredient.restaurantId === restaurantId &&
      !ingredient.isVerified &&
      ingredient.source === "kurumi-demo-estimate" &&
      !ingredient.hasNutritionFacts
    );
  });
}

const MATCHERS = VOCABULARY.flatMap((entry) =>
  entry.aliases.map((alias) => ({ entry, alias: normalizeMatchText(alias) }))
).sort((a, b) => b.alias.length - a.alias.length);

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function makeDefinition(entry: Pick<VocabularyEntry, "name" | "category" | "unit">): KurumiRecipeIngredientDefinition {
  return {
    name: entry.name,
    category: entry.category,
    defaultUnit: entry.unit,
    gramsPerUnit: 1,
    isVerified: false,
    source: "kurumi-demo-estimate"
  };
}

function recipeCategory(item: KurumiMenuItem): string {
  return normalizeWords(item.category);
}

function matchIngredients(item: KurumiMenuItem): { entries: VocabularyEntry[]; matchedDescription: boolean } {
  const name = normalizeMatchText(item.name);
  const description = normalizeMatchText(item.description);
  const matched: Array<{ entry: VocabularyEntry; start: number; end: number; source: "name" | "description" }> = [];
  const usedNames = new Set<string>();

  for (const matcher of MATCHERS) {
    if (!matcher.alias || usedNames.has(matcher.entry.name) || !hasPhrase(description, matcher.alias)) continue;
    const start = description.indexOf(matcher.alias);
    const end = start + matcher.alias.length;
    if (matched.some((span) => span.source === "description" && start < span.end && end > span.start)) continue;
    usedNames.add(matcher.entry.name);
    matched.push({ entry: matcher.entry, start, end, source: "description" });
  }

  const allowShortTitleMatches = normalizeWords(item.category) === "goi them";
  for (const matcher of MATCHERS) {
    if (
      !matcher.alias ||
      usedNames.has(matcher.entry.name) ||
      (!allowShortTitleMatches && matcher.alias.replace(/\s/g, "").length < 4) ||
      !hasPhrase(name, matcher.alias)
    ) continue;
    const start = name.indexOf(matcher.alias);
    const end = start + matcher.alias.length;
    if (matched.some((span) => span.source === "name" && start < span.end && end > span.start)) continue;
    usedNames.add(matcher.entry.name);
    matched.push({ entry: matcher.entry, start, end, source: "name" });
  }

  return {
    entries: matched.map((match) => match.entry),
    matchedDescription: matched.some((match) => match.source === "description")
  };
}

function addByName(entries: VocabularyEntry[], name: string): void {
  const normalizedName = normalizeWords(name);
  const entry = VOCABULARY.find((candidate) => normalizeWords(candidate.name) === normalizedName);
  if (entry && !entries.some((candidate) => candidate.name === entry.name)) entries.push(entry);
}

function customProduct(name: string, category: VocabularyEntry["category"], quantity: number): VocabularyEntry {
  return { name, aliases: [], category, unit: "ml", quantity };
}

function inferCategoryIngredients(item: KurumiMenuItem, entries: VocabularyEntry[]): void {
  const category = recipeCategory(item);
  const name = normalizeWords(item.name);
  const accentedName = normalizeMatchText(item.name);
  const has = (ingredientName: string) => entries.some((entry) => entry.name === ingredientName);

  if (category === "ca phe") {
    if (!has("Cà phê espresso") && !/matcha|nghe|so co la|chocolate|1 phan|1 serving/.test(name)) {
      addByName(entries, "Cà phê espresso");
    }
    if (/latte|cappuccino/.test(name) && !entries.some((entry) => entry.category === "sua")) {
      addByName(entries, /yen mach|oat/.test(name) ? "Sữa yến mạch" : "Sữa dừa");
    }
    if (/matcha/.test(name) && !has("Bột matcha")) addByName(entries, "Bột matcha");
    if (/nghe/.test(name) && !has("Bột nghệ")) addByName(entries, "Bột nghệ");
    if (/latte|cappuccino/.test(name) && !has("Sữa dừa") && !has("Sữa yến mạch") && !has("Sữa hạt điều")) {
      addByName(entries, "Sữa dừa");
    }
  }

  if (category === "tra") {
    if (!entries.some((entry) => entry.category === "do_uong" && entry.name !== "Nước nóng")) {
      const teaName = item.name.replace(/^Trà\s*/i, "Trà ");
      entries.push({ name: teaName, aliases: [], category: "do_uong", unit: "g", quantity: 4 });
    }
    if (!has("Nước nóng")) addByName(entries, "Nước nóng");
  }

  if (/^sup /.test(category) || category === "mon an slav" && /solyanka|soup|sup/.test(name)) {
    entries.push({ name: "Nước dùng rau củ", aliases: [], category: "gia_vi", unit: "ml", quantity: 240 });
  }

  if (category === "nuoc giai khat" || category === "do uong") {
    if (/matcha may|cloudy matcha/.test(name)) {
      addByName(entries, "Nước dừa");
      addByName(entries, "Sữa dừa");
      addByName(entries, "Bột matcha");
    } else if (/sinh to.*tao xoan|spirulina smoothie/.test(name)) {
      addByName(entries, "Chuối");
      addByName(entries, "Nước cam ép");
      addByName(entries, "Chanh xanh");
      addByName(entries, "Gừng");
      addByName(entries, "Tinh bột tảo xoắn");
    } else if (/shot nghe|turmeric shot|nuoc nghe/.test(name)) {
      addByName(entries, "Bột nghệ");
      addByName(entries, "Gừng");
      addByName(entries, "Chanh xanh");
      addByName(entries, "Nước lọc");
    } else if (/sua lac protein|peanut butter protein shake/.test(name)) {
      addByName(entries, "Chuối");
      addByName(entries, "Đạm đậu nành thực vật");
      addByName(entries, "Bơ đậu phộng");
      addByName(entries, "Hạt chia");
      addByName(entries, "Chà là");
      addByName(entries, "Quế");
    } else if (/eggnog|trung|christmas drink/.test(name)) {
      addByName(entries, "Sữa hạt điều");
      addByName(entries, "Kem dừa");
      addByName(entries, "Chà là");
      addByName(entries, "Quế");
      addByName(entries, "Tinh chất vani");
    } else if (/matcha dau tay|strawberry matcha/.test(name)) {
      addByName(entries, "Mứt dâu");
      addByName(entries, "Sữa yến mạch");
      addByName(entries, "Bột matcha");
    } else if (/sinh to du du|papaya smoothie/.test(name)) {
      addByName(entries, "Đu đủ");
      addByName(entries, "Nước dừa");
      addByName(entries, "Sữa dừa");
    } else if (/nuoc gung|ginger ale/.test(name)) {
      addByName(entries, "Nước gừng có ga");
    } else if (/nuoc soda|soda water/.test(name)) {
      addByName(entries, "Nước soda");
    } else if (/nuoc tonic|tonic water/.test(name)) {
      addByName(entries, "Nước tonic");
    } else if (/coke zero/.test(name)) {
      entries.push(customProduct("Coke Zero (thành phẩm)", "do_uong", 330));
    } else if (/mineral water|nuoc khoang/.test(name)) {
      entries.push(customProduct("Nước khoáng đóng chai", "do_uong", 330));
    } else if (/kombucha/.test(name)) {
      addByName(entries, "Trà kombucha");
    } else if (/fizz soda/.test(name)) {
      addByName(entries, "Nước soda");
      addByName(entries, "Chanh xanh");
      addByName(entries, "Siro thốt nốt");
    } else if (/so co la dua da|iced coconut chocolate/.test(name)) {
      addByName(entries, "Sữa dừa");
      addByName(entries, "Bột cacao");
      addByName(entries, "Siro thốt nốt");
    }
    if (/protein shake|sua lac protein/.test(name) && !entries.some((entry) => entry.unit === "ml")) {
      addByName(entries, "Sữa hạt điều");
    }
  }

  if (/sinh to|smoothie/.test(category) && !entries.some((entry) => entry.unit === "ml")) {
    addByName(entries, "Nước dừa");
  }

  if (category === "nuoc ep tuoi") {
    if (/like a wine|tua ruou vang/.test(name)) {
      addByName(entries, "Nho tươi");
      addByName(entries, "Táo");
      addByName(entries, "Củ dền");
    } else if (/energy of sun|nang luong mat troi/.test(name)) {
      addByName(entries, "Cà rốt");
      addByName(entries, "Cam");
      addByName(entries, "Thơm");
    } else if (/passion juice|chanh day/.test(name)) {
      addByName(entries, "Chanh dây");
      addByName(entries, "Nước lọc");
      addByName(entries, "Đường mía");
    } else if (/lime juice|nuoc chanh/.test(name)) {
      addByName(entries, "Chanh xanh");
      addByName(entries, "Nước lọc");
      addByName(entries, "Đường mía");
    } else if (/fresh coconut|dua tuoi/.test(name)) {
      addByName(entries, "Nước dừa");
    } else if (/orange juice|nuoc cam/.test(name)) {
      addByName(entries, "Nước cam ép");
    }
  }

  if (category === "ca phe") {
    if (/ca phe dua|coconut coffee/.test(name)) addByName(entries, "Sữa dừa");
    if (/americano/.test(name)) addByName(entries, "Nước nóng");
  }

  if (category === "goi them" && /sua dua.*sua yen mach|sua yen mach.*sua dua/.test(name)) {
    entries.splice(0, entries.length, {
      name: "Sữa thực vật (chọn dừa hoặc yến mạch)",
      aliases: [],
      category: "sua",
      unit: "ml",
      quantity: 60
    });
  }

  if (category === "ruou vang" && entries.length === 0) {
    addByName(entries, "Rượu vang đỏ");
    addByName(entries, "Cam");
    addByName(entries, "Quế");
    addByName(entries, "Đường thốt nốt");
  }

  if (category === "bia" && entries.length === 0) {
    entries.push(customProduct(`Bia thành phẩm: ${item.name}`, "do_uong", 330));
  }

  if (category === "banh pho mai hat dieu tuoi nguyen chiec" && entries.length === 0) {
    addByName(entries, "Phô mai hạt điều thuần chay");
    addByName(entries, "Hạnh nhân");
    addByName(entries, "Chà là");
    addByName(entries, "Dầu dừa");
    entries.push({ name: "Nhân vị cheesecake theo lựa chọn", aliases: [], category: "sua", unit: "g", quantity: 30 });
  }

  if (category === "kem" && !item.description.trim()) {
    if (!entries.some((entry) => entry.name === "Kem dừa thực vật")) {
      entries.push({ name: "Kem dừa thực vật", aliases: [], category: "sua", unit: "g", quantity: 90 });
    }
    if (accentedName.includes("dứa") || name.includes("pineapple")) addByName(entries, "Thơm");
    if (/ca phe|coffee/.test(name) && !entries.some((entry) => entry.name === "Cà phê espresso")) {
      entries.push({ name: "Cà phê espresso", aliases: [], category: "do_uong", unit: "ml", quantity: 8 });
    }
    addByName(entries, "Đường mía");
  }

  if (category === "mon trang mieng" && /so co la sua|milk chocolate/.test(name)) {
    entries.push({ name: "Sô-cô-la thuần chay", aliases: [], category: "sua", unit: "g", quantity: 22 });
    addByName(entries, "Bơ cacao");
    addByName(entries, "Sữa dừa");
    addByName(entries, "Đường dừa");
  }

  if (category === "banh nuong" && /napoleon/.test(name)) {
    entries.splice(0, entries.length,
      { name: "Vỏ bánh ngàn lớp thuần chay", aliases: [], category: "tinh_bot", unit: "g", quantity: 70 },
      { name: "Kem dừa vani", aliases: [], category: "sua", unit: "g", quantity: 55 },
      { name: "Mứt quả mọng", aliases: [], category: "gia_vi", unit: "g", quantity: 15 }
    );
  }
}

function defaultCookingMethod(item: KurumiMenuItem): KurumiRecipeSuggestion["cookingMethod"] {
  const category = recipeCategory(item);
  const name = normalizeWords(item.name);
  if (/^sup /.test(category) || category === "warming soups with protein" || category === "mon an slav" && /soup|sup/.test(name)) return "boil";
  if (/chao|porridge/.test(name)) return "boil";
  if (/ruou vang nong|mulled wine/.test(name)) return "boil";
  if (/momo|dumpling/.test(name)) return "steam";
  if (/vareniky|banh bot nh|bánh bột nhồi/.test(name)) return "boil";
  if (/pasta|mi y|mì ý/.test(normalizeWords(item.category))) return "boil";
  if (/^banh nuong/.test(category) || /brownie|banana bread|carrot cake|napoleon|banh chuoi/.test(name)) return "bake";
  if (category === "tra") return "boil";
  if (category === "bia" || category === "ca phe" || /do uong|nuoc giai khat|nuoc ep tuoi|ruou vang|smoothie|sinh to|salad|ice cream|cheesecake|mon trang mieng|raw/.test(`${category} ${name}`)) {
    return "raw";
  }
  if (/chien|deep fry/.test(`${category} ${name}`)) return "deep_fry";
  if (/nuong|bake/.test(`${category} ${name}`)) return "bake";
  if (/xao|stir fry/.test(`${category} ${name}`)) return "stir_fry";
  if (/bread|toast|banh mi|bun|burger|sandwich|tortilla|baguette/.test(`${category} ${name}`)) return "grill";
  if (category === "goi them") return "raw";
  if (/soup|sup|curry|stroganoff|sauce|sot/.test(`${category} ${name}`)) return "braise";
  if (/boil|luoc/.test(normalizeWords(item.description))) return "boil";
  if (/steam|hap/.test(normalizeWords(item.description))) return "steam";
  if (/bake|nuong/.test(normalizeWords(item.name))) return "bake";
  return "stir_fry";
}

function estimateQuantity(entry: VocabularyEntry, item: KurumiMenuItem): number {
  const category = recipeCategory(item);
  let amount = entry.quantity;
  if (category === "goi them") amount = Math.max(10, Math.round(amount * 0.65));
  if (/mon trang mieng|kem|banh pho mai|banh nuong/.test(category)) {
    if (entry.category === "rau_cu" || entry.category === "protein") amount = Math.max(5, Math.round(amount * 0.65));
    if (entry.category === "do_uong") amount = Math.max(2, Math.round(amount * 0.5));
  }
  if (/sinh to|smoothie|sua hat dieu|cashew milk shake/.test(category)) {
    if (entry.category === "rau_cu" && entry.unit === "g") amount = Math.max(amount, 60);
  }
  if (entry.name === "Nước nóng") amount = category === "tra" ? 350 : 180;
  if (entry.name === "Cà phê espresso" && category === "ca phe") amount = 30;
  return amount;
}

function buildRecipe(item: KurumiMenuItem): KurumiRecipeSuggestion {
  const matches = matchIngredients(item);
  const entries = [...matches.entries];
  inferCategoryIngredients(item, entries);
  if (entries.length === 0) {
    const drinkCategory = /do uong|nuoc giai khat|nuoc ep|ruou|bia|ca phe|tra|sua hat dieu/.test(recipeCategory(item));
    entries.push({
      name: drinkCategory ? `Thành phần pha chế ước tính: ${item.name}` : `Thành phẩm thuần chay ước tính: ${item.name}`,
      aliases: [],
      category: drinkCategory ? "do_uong" : "sua",
      unit: drinkCategory ? "ml" : "g",
      quantity: drinkCategory ? 250 : 100
    });
  }

  const uniqueEntries = entries.filter((entry, index) => entries.findIndex((candidate) => candidate.name === entry.name) === index);
  const ingredients = uniqueEntries.map((entry) => {
    const definition = makeDefinition(entry);
    const quantity = estimateQuantity(entry, item);
    return {
      ...definition,
      quantity,
      unit: definition.defaultUnit,
      gramsResolved: Math.round(quantity * definition.gramsPerUnit)
    };
  });
  const matchedDescription = matches.matchedDescription;

  return {
    name: item.name,
    category: item.category,
    price: item.price,
    basis: matchedDescription ? "menu-description" : "menu-name-inference",
    ingredients,
    servingCount: 1,
    servingSizeGrams: ingredients.reduce((total, ingredient) => total + ingredient.gramsResolved, 0),
    cookingMethod: defaultCookingMethod(item)
  };
}

export function buildKurumiRecipePlan(items: readonly KurumiMenuItem[]): KurumiRecipePlan {
  const recipes = items.map(buildRecipe);
  const definitions = new Map<string, KurumiRecipeIngredientDefinition>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const definition = makeDefinition(ingredient);
      const existing = definitions.get(definition.name);
      if (existing && (existing.category !== definition.category || existing.defaultUnit !== definition.defaultUnit)) {
        throw new Error(`Conflicting demo ingredient definitions for ${definition.name}`);
      }
      definitions.set(definition.name, definition);
    }
  }
  return { recipes, ingredients: Array.from(definitions.values()).sort((a, b) => a.name.localeCompare(b.name, "vi")) };
}

export function kurumiDemoIngredientSlug(restaurantId: string, ingredientName: string): string {
  const suffix = ingredientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const tenant = restaurantId.toLocaleLowerCase("en-US").replace(/[^a-f0-9]/g, "").slice(-12);
  if (!tenant || !suffix) throw new Error("Cannot create a deterministic KURUMI demo ingredient key");
  return `kurumi-demo-${tenant}-${suffix}`;
}

export function buildKurumiRecipePatch(
  recipe: KurumiRecipeSuggestion,
  ingredientIdsByName: ReadonlyMap<string, string | Types.ObjectId>
) {
  const ingredients = recipe.ingredients.map((ingredient) => {
    const ingredientId = ingredientIdsByName.get(ingredient.name);
    if (!ingredientId) throw new Error(`Missing KURUMI demo ingredient mapping: ${ingredient.name}`);
    return {
      ingredientId,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      gramsResolved: ingredient.gramsResolved
    };
  });
  return {
    ingredients,
    servingCount: recipe.servingCount,
    servingSizeGrams: recipe.servingSizeGrams,
    cookingMethod: recipe.cookingMethod
  };
}
