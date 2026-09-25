export interface KurumiNutritionEstimate {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  sugarPer100g: number;
  sodiumPer100g: number;
  provenance: string;
}

type NutrientVector = readonly [number, number, number, number, number, number, number];

const fromUsda = (fdcId: string, values: NutrientVector): KurumiNutritionEstimate => ({
  caloriesPer100g: values[0],
  proteinPer100g: values[1],
  carbPer100g: values[2],
  fatPer100g: values[3],
  fiberPer100g: values[4],
  sugarPer100g: values[5],
  sodiumPer100g: values[6],
  provenance: `USDA FoodData Central SR Legacy 2018, FDC ${fdcId}`
});

const comparableEstimate = (description: string, values: NutrientVector): KurumiNutritionEstimate => ({
  caloriesPer100g: values[0],
  proteinPer100g: values[1],
  carbPer100g: values[2],
  fatPer100g: values[3],
  fiberPer100g: values[4],
  sugarPer100g: values[5],
  sodiumPer100g: values[6],
  provenance: `Demo estimate based on ${description}`
});

const USDA = {
  wholemealBread: fromUsda("172688", [252, 12.45, 42.71, 3.5, 6, 4.34, 455]),
  flourTortilla: fromUsda("167535", [297, 8.01, 49.27, 7.58, 2.4, 2.66, 742]),
  cookedPasta: fromUsda("169737", [158, 5.8, 30.86, 0.93, 1.8, 0.56, 1]),
  cookedRiceNoodles: fromUsda("168914", [108, 1.79, 24.01, 0.2, 1, 0.03, 19]),
  cookedBrownRice: fromUsda("169704", [123, 2.74, 25.58, 0.97, 1.6, 0.24, 4]),
  cookedQuinoa: fromUsda("168917", [120, 4.4, 21.3, 1.92, 2.8, 0.87, 7]),
  cookedBuckwheat: comparableEstimate("cooked buckwheat; USDA dry groats FDC 170685", [92, 3.4, 19.9, 0.6, 2.7, 0.9, 4]),
  dryOats: fromUsda("173904", [379, 13.15, 67.7, 6.52, 10.1, 0.99, 6]),
  chickpeaFlour: fromUsda("174288", [387, 22.39, 57.82, 6.69, 10.8, 10.85, 64]),
  wholeWheatFlour: fromUsda("168893", [340, 13.21, 71.97, 2.5, 10.7, 0.41, 2]),
  whiteFlour: fromUsda("168894", [364, 10.33, 76.31, 0.98, 2.7, 0.27, 2]),
  tapiocaStarch: fromUsda("169717", [358, 0.19, 88.69, 0.02, 0.9, 3.35, 1]),
  cornstarch: fromUsda("169698", [381, 0.26, 91.27, 0.05, 0.9, 0, 9]),
  toast: fromUsda("172751", [407, 11.9, 73.5, 6.6, 5.1, 1.5, 698]),
  puffPastry: comparableEstimate("vegan puff pastry; USDA wheat flour FDC 168894 and vegetable shortening composition", [410, 6, 47, 23, 2, 3, 550]),
  sweetPotato: fromUsda("168482", [86, 1.57, 20.12, 0.05, 3, 4.18, 55]),
  potato: fromUsda("170026", [77, 2.05, 17.49, 0.09, 2.1, 0.82, 6]),
  adzukiBeans: fromUsda("173728", [128, 7.52, 24.77, 0.1, 7.3, 0.5, 8]),
  edamame: fromUsda("168411", [121, 11.91, 8.91, 5.2, 5.2, 2.18, 6]),
  tempeh: fromUsda("172467", [195, 19.91, 7.62, 11.38, 5.4, 0.5, 14]),
  chickpeaTempeh: comparableEstimate("chickpea tempeh; cooked chickpea and tempeh reference foods", [166, 12, 20, 5, 6, 3, 20]),
  soyProtein: fromUsda("174276", [335, 88.32, 0, 3.39, 0, 0, 1005]),
  peaProtein: comparableEstimate("unflavored pea protein isolate", [365, 80, 6, 5, 2, 1, 450]),
  plantMeat: comparableEstimate("plant-based burger patty (representative demo estimate; brand recipe varies)", [220, 18, 8, 12, 4, 1, 500]),
  firmTofu: fromUsda("172475", [144, 17.27, 2.78, 8.72, 2.3, 0.3, 14]),
  tofuSkin: comparableEstimate("dried tofu skin / yuba", [447, 53, 18, 23, 2, 6, 30]),
  almonds: comparableEstimate("plain almonds; USDA SR Legacy honey-roasted almond profile FDC 168592 adjusted for added honey/oil", [579, 21.2, 21.6, 49.9, 12.5, 4.4, 1]),
  peanut: fromUsda("172430", [567, 25.8, 16.13, 49.24, 8.5, 4.72, 18]),
  cashew: fromUsda("170162", [553, 18.22, 30.19, 43.85, 3.3, 5.91, 12]),
  mixedNuts: comparableEstimate("unsalted mixed nuts and seeds; USDA peanut, cashew, sesame and walnut references", [570, 19, 23, 48, 9, 5, 20]),
  chia: fromUsda("170554", [486, 16.54, 42.12, 30.74, 34.4, 0, 16]),
  flax: comparableEstimate("whole flaxseed composition", [534, 18.3, 28.9, 42.2, 27.3, 1.6, 30]),
  sesame: fromUsda("170150", [573, 17.73, 23.45, 49.67, 11.8, 0.3, 11]),
  walnut: fromUsda("170187", [654, 15.23, 13.71, 65.21, 6.7, 2.61, 2]),
  oliveOil: fromUsda("171413", [884, 0, 0, 100, 0, 0, 2]),
  sesameOil: fromUsda("171016", [884, 0, 0, 100, 0, 0, 0]),
  coconutOil: comparableEstimate("pure coconut oil", [892, 0, 0, 100, 0, 0, 0]),
  avocado: fromUsda("171705", [160, 2, 8.53, 14.66, 6.7, 0.66, 7]),
  shiitake: fromUsda("169242", [34, 2.24, 6.79, 0.49, 2.5, 2.38, 9]),
  oysterMushroom: fromUsda("168580", [33, 3.31, 6.09, 0.41, 2.3, 1.11, 18]),
  strawMushroom: fromUsda("168582", [32, 3.83, 4.64, 0.68, 2.5, 1.2, 384]),
  wakame: fromUsda("170496", [45, 3.03, 9.14, 0.64, 0.5, 0.65, 872]),
  broccoli: fromUsda("170379", [34, 2.82, 6.64, 0.37, 2.6, 1.7, 33]),
  spinach: fromUsda("168462", [23, 2.86, 3.63, 0.39, 2.2, 0.42, 79]),
  lettuce: fromUsda("169249", [15, 1.36, 2.87, 0.15, 1.3, 0.78, 28]),
  redCabbage: fromUsda("169977", [31, 1.43, 7.37, 0.16, 2.1, 3.83, 27]),
  sauerkraut: fromUsda("169279", [19, 0.91, 4.28, 0.14, 2.9, 1.78, 661]),
  pumpkin: fromUsda("168448", [26, 1, 6.5, 0.1, 0.5, 2.76, 1]),
  zucchini: fromUsda("169291", [17, 1.21, 3.11, 0.32, 1, 2.5, 8]),
  tomato: fromUsda("170457", [18, 0.88, 3.89, 0.2, 1.2, 2.63, 5]),
  sunDriedTomato: fromUsda("168567", [258, 14.11, 55.76, 2.97, 12.3, 37.59, 107]),
  carrot: fromUsda("170393", [41, 0.93, 9.58, 0.24, 2.8, 4.74, 69]),
  eggplant: fromUsda("169228", [25, 0.98, 5.88, 0.18, 3, 3.53, 2]),
  orange: fromUsda("169097", [47, 0.94, 11.75, 0.12, 2.4, 9.35, 0]),
  celery: fromUsda("169988", [14, 0.69, 2.97, 0.17, 1.6, 1.34, 80]),
  date: fromUsda("168191", [277, 1.81, 74.97, 0.15, 6.7, 66.47, 1]),
  lemon: fromUsda("167747", [22, 0.35, 6.9, 0.24, 0.3, 2.52, 1]),
  lime: fromUsda("168155", [30, 0.7, 10.54, 0.2, 2.8, 1.69, 2]),
  banana: fromUsda("173944", [89, 1.09, 22.84, 0.33, 2.6, 12.23, 1]),
  coconut: fromUsda("170169", [354, 3.33, 15.23, 33.49, 9, 6.23, 20]),
  driedCoconut: comparableEstimate("unsweetened dried coconut; USDA fresh coconut FDC 170169 concentrated after water removal", [660, 6.9, 23.7, 64.5, 16.3, 7.4, 37]),
  strawberry: fromUsda("167762", [32, 0.67, 7.68, 0.3, 2, 4.89, 1]),
  cucumber: fromUsda("168409", [15, 0.65, 3.63, 0.11, 0.5, 1.67, 2]),
  papaya: fromUsda("169926", [43, 0.47, 10.82, 0.26, 1.7, 7.82, 8]),
  beet: comparableEstimate("raw beetroot, based on USDA raw root vegetable composition", [43, 1.6, 9.6, 0.2, 2.8, 6.8, 78]),
  bellPepper: fromUsda("170108", [26, 0.99, 6.03, 0.3, 2.1, 4.2, 4]),
  ginger: fromUsda("169231", [80, 1.82, 17.77, 0.75, 2, 1.7, 13]),
  onion: fromUsda("170000", [40, 1.1, 9.34, 0.1, 1.7, 4.24, 4]),
  shallot: fromUsda("170499", [72, 2.5, 16.8, 0.1, 3.2, 7.87, 12]),
  mint: fromUsda("173474", [70, 3.75, 14.89, 0.94, 8, 0, 31]),
  basil: fromUsda("172232", [23, 3.15, 2.65, 0.64, 1.6, 0.3, 4]),
  parsley: fromUsda("170416", [36, 2.97, 6.33, 0.79, 3.3, 0.85, 56]),
  raisin: fromUsda("168165", [299, 3.3, 79.32, 0.25, 4.5, 65.18, 26]),
  mango: fromUsda("169910", [60, 0.82, 14.98, 0.38, 1.6, 13.66, 1]),
  pineapple: fromUsda("168193", [45, 0.55, 11.82, 0.13, 1.4, 8.29, 1]),
  blueberry: fromUsda("171711", [57, 0.74, 14.49, 0.33, 2.4, 9.96, 1]),
  apple: fromUsda("171688", [52, 0.26, 13.81, 0.17, 2.4, 10.39, 1]),
  grape: comparableEstimate("raw table grapes", [69, 0.72, 18.1, 0.16, 0.9, 15.5, 2]),
  cherry: comparableEstimate("raw sweet cherries", [63, 1.06, 16, 0.2, 2.1, 12.8, 0]),
  cranberry: fromUsda("171722", [46, 0.46, 11.97, 0.13, 3.6, 4.27, 2]),
  driedCranberry: fromUsda("171723", [308, 0.17, 82.8, 1.09, 5.3, 72.56, 5]),
  dragonFruit: comparableEstimate("red dragon fruit (pitaya)", [60, 1.2, 13, 0.4, 3, 8, 1]),
  passionFruit: comparableEstimate("raw passion fruit pulp", [97, 2.2, 23.4, 0.7, 10.4, 11.2, 28]),
  brownSugar: fromUsda("168833", [380, 0.12, 98.09, 0, 0, 97.02, 28]),
  caneSugar: fromUsda("169655", [387, 0, 99.98, 0, 0, 99.8, 1]),
  palmSugar: comparableEstimate("palm/coconut sugar, used as a brown-sugar analogue", [380, 0.5, 95, 0.1, 0, 90, 40]),
  cocoa: fromUsda("168774", [410, 20, 60, 10, 20, 0, 0]),
  darkChocolate: fromUsda("170271", [546, 4.88, 61.17, 31.28, 7, 47.9, 24]),
  matcha: comparableEstimate("unsweetened powdered green tea leaves", [324, 30, 38, 5, 9, 0, 37]),
  turmeric: comparableEstimate("ground turmeric spice", [312, 9.7, 67.1, 3.3, 22.7, 3.2, 27]),
  bakingPowder: fromUsda("172803", [53, 0, 27.7, 0, 0.2, 0, 10600]),
  cocoaButter: comparableEstimate("pure cocoa butter", [884, 0, 0, 100, 0, 0, 0]),
  peanutButter: comparableEstimate("smooth peanut butter, unsweetened", [588, 25, 20, 50, 6, 9, 400]),
  cashewButter: comparableEstimate("cashew butter, unsweetened", [587, 18, 27, 49, 3, 6, 300]),
  coconutCream: fromUsda("170173", [197, 2.02, 2.81, 21.33, 0, 2, 13]),
  coconutMilkDrink: fromUsda("174116", [31, 0.21, 2.92, 2.08, 0, 2.5, 19]),
  cashewMilk: comparableEstimate("unsweetened cashew milk", [25, 0.8, 1.2, 2, 0.2, 0.5, 45]),
  oatMilk: comparableEstimate("unsweetened oat beverage; USDA rolled oats FDC 173904 as cereal reference", [45, 1, 6.7, 1.5, 0.8, 4, 40]),
  chiaPudding: comparableEstimate("chia pudding made with chia seeds and unsweetened plant milk", [145, 5, 15, 8, 7, 5, 45]),
  veganCheese: comparableEstimate("plant-based cashew cheese; ingredients and brand recipes vary", [300, 8, 14, 23, 2, 3, 650]),
  veganBrie: comparableEstimate("plant-based Brie-style cashew cheese; ingredients and brand recipes vary", [320, 7, 12, 27, 1, 2, 700]),
  veganCandy: comparableEstimate("small vegan fruit confectionery", [360, 1, 88, 1, 2, 65, 80]),
  berryJam: comparableEstimate("sweetened berry jam, based on USDA berry and sugar composition", [250, 0.5, 63, 0.1, 2, 55, 20]),
  chiaJam: comparableEstimate("chia-seed fruit spread, based on chia seeds and sweetened berries", [185, 3, 32, 5, 12, 18, 15]),
  coconutFlavor: comparableEstimate("unsweetened coconut extract/flavouring used in a small recipe amount", [250, 0, 20, 0, 0, 15, 10]),
  olives: fromUsda("169094", [116, 0.84, 6.04, 10.9, 1.6, 0, 735]),
  miso: fromUsda("172442", [198, 12.79, 25.37, 6.01, 5.4, 6.2, 3728]),
  soySauce: fromUsda("172473", [57, 9.05, 5.59, 0.3, 0.7, 0.5, 3598]),
  mustard: fromUsda("172234", [60, 3.74, 5.83, 3.34, 4, 0.92, 1104]),
  ketchup: fromUsda("169074", [24, 1.2, 5.31, 0.3, 1.5, 3.56, 474]),
  salsa: fromUsda("174524", [29, 1.52, 6.64, 0.17, 1.9, 4.01, 711]),
  broth: fromUsda("171583", [5, 0.24, 0.93, 0.07, 0, 0.55, 296]),
  bbqSauce: comparableEstimate("vegan barbecue sauce", [150, 1.5, 35, 0.5, 1, 28, 1400]),
  currySauce: comparableEstimate("plant-based curry sauce", [120, 2.5, 12, 6, 2, 4, 650]),
  hollandaise: comparableEstimate("vegan hollandaise-style sauce", [340, 2, 5, 35, 0.5, 1, 700]),
  veganMayo: comparableEstimate("vegan mayonnaise", [680, 0.5, 2, 75, 0, 1, 650]),
  pesto: comparableEstimate("vegan basil pesto (cashew/nutritional-yeast version; USDA non-vegan pesto FDC 171185 is not reused)", [390, 5, 8, 37, 2, 2, 500]),
  sriracha: comparableEstimate("vegan sriracha-style chilli sauce", [90, 1.5, 18, 1, 1, 12, 1900]),
  coconutWater: comparableEstimate("unsweetened coconut water", [19, 0.7, 3.7, 0.2, 1, 2.6, 105]),
  gingerAle: fromUsda("174846", [34, 0, 8.76, 0, 0, 8.9, 7]),
  mineralWater: fromUsda("174158", [0, 0, 0, 0, 0, 0, 2]),
  tapWater: fromUsda("173647", [0, 0, 0, 0, 0, 0, 4]),
  sodaWater: fromUsda("174842", [0, 0, 0, 0, 0, 0, 21]),
  tonic: fromUsda("171869", [34, 0, 8.8, 0, 0, 8.8, 12]),
  cokeZero: fromUsda("171876", [0, 0, 0.1, 0, 0, 0, 16]),
  orangeJuice: fromUsda("169098", [45, 0.7, 10.4, 0.2, 0.2, 8.4, 1]),
  espresso: fromUsda("171881", [2, 0.3, 0.17, 0, 0, 0, 1]),
  blackTea: fromUsda("173227", [1, 0, 0.3, 0, 0, 0, 3]),
  greenTea: fromUsda("171910", [0, 0, 0, 0, 0, 0, 0]),
  herbalTea: comparableEstimate("unsweetened brewed herbal tea", [1, 0, 0.2, 0, 0, 0, 2]),
  moringaTea: comparableEstimate("unsweetened brewed moringa-leaf infusion; dried leaves are not used as the beverage serving", [2, 0.1, 0.4, 0, 0.1, 0, 2]),
  kombucha: comparableEstimate("plain kombucha; fermentation and residual sugar vary by brand", [18, 0, 4.5, 0, 0, 4, 5]),
  beer: fromUsda("168746", [43, 0.46, 3.55, 0, 0, 0, 4]),
  lowAlcoholBeer: comparableEstimate("low-alcohol beer, 0.5% ABV label-style estimate", [20, 0.3, 4, 0, 0, 1, 5]),
  nonAlcoholicBeer: comparableEstimate("non-alcoholic beer", [17, 0.3, 3.5, 0, 0, 1, 5]),
  redWine: fromUsda("171872", [78, 0.07, 2.38, 0, 0, 0.6, 4]),
  salt: fromUsda("173468", [0, 0, 0, 0, 0, 0, 38758]),
  cinnamon: fromUsda("171320", [247, 3.99, 80.59, 1.24, 53.1, 2.17, 10]),
  blackPepper: fromUsda("170931", [251, 10.39, 63.95, 3.26, 25.3, 0.64, 20]),
  vanilla: fromUsda("172235", [237, 0.05, 2.41, 0, 0, 0.1, 4]),
  nutritionalYeast: comparableEstimate("fortified nutritional yeast flakes; sodium depends on brand", [340, 50, 35, 5, 20, 0, 2000]),
  genericHerbs: comparableEstimate("fresh culinary herbs; parsley/basil USDA SR Legacy references", [35, 3, 6, 0.8, 3, 1, 30]),
  genericSeaweed: comparableEstimate("rehydrated edible seaweed; species and soaking alter sodium", [49, 1.5, 12, 0.2, 0.5, 0, 50]),
  beanSprouts: comparableEstimate("fresh mung-bean sprouts", [30, 3, 6, 0.2, 1.8, 4, 6]),
  pickledVegetable: comparableEstimate("lightly pickled vegetables; sodium depends on brine", [35, 1, 8, 0.2, 2, 4, 850]),
  artichoke: comparableEstimate("drained marinated artichoke hearts", [70, 3, 8, 3, 5, 1, 500]),
  beetGreen: comparableEstimate("cooked beetroot", [44, 1.7, 10, 0.2, 2.8, 7, 78]),
  herbInfusion: comparableEstimate("unsweetened herbal infusion", [1, 0, 0.2, 0, 0, 0, 2]),
  spirulina: comparableEstimate("unsweetened spirulina powder", [290, 57, 24, 8, 3.6, 3.1, 1048]),
  unknownPlantDrink: comparableEstimate("lightly sweetened plant-based drink", [35, 0.5, 4.5, 1.5, 0.2, 3, 35])
} satisfies Record<string, KurumiNutritionEstimate>;

const estimates = new Map<string, KurumiNutritionEstimate>();

function assign(profile: KurumiNutritionEstimate, ...ingredientNames: string[]): void {
  for (const name of ingredientNames) estimates.set(name, profile);
}

assign(USDA.artichoke, "Atisô ngâm");
assign(USDA.mint, "Bạc hà");
assign(USDA.wholemealBread, "Bánh mì nguyên cám");
assign(USDA.toast, "Bánh mì nướng gia vị");
assign(USDA.flourTortilla, "Bánh tortilla nguyên cám");
assign(USDA.sauerkraut, "Bắp cải lên men");
assign(USDA.redCabbage, "Bắp cải tím");
assign(USDA.pumpkin, "Bí đỏ");
assign(USDA.zucchini, "Bí ngòi");
assign(USDA.lowAlcoholBeer, "Bia thành phẩm: Bia 5 Element 0,5%");
assign(USDA.nonAlcoholicBeer, "Bia thành phẩm: Bia Bavaria 0%");
assign(USDA.beer,
  "Bia thành phẩm: Bia 5E Chú Tễu Vàng",
  "Bia thành phẩm: Bia California Sun",
  "Bia thành phẩm: Bia Ngũ Hành - Kim",
  "Bia thành phẩm: Bia Ngũ Hành - Thuỷ",
  "Bia thành phẩm: Bia Partea",
  "Bia thành phẩm: Bia Partea Red");
assign(USDA.plantMeat, "Thịt thực vật Let's Plant");
assign(USDA.cornstarch, "Bột bắp");
assign(USDA.cocoa, "Bột cacao");
assign(USDA.chickpeaFlour, "Bột đậu gà");
assign(comparableEstimate("brown-rice flour; USDA brown-rice profile FDC 169703", [360, 7.5, 76, 3, 4, 1, 5]), "Bột gạo lứt");
assign(USDA.matcha, "Bột matcha");
assign(USDA.whiteFlour, "Bột mì");
assign(USDA.wholeWheatFlour, "Bột mì nguyên cám");
assign(USDA.tapiocaStarch, "Bột năng");
assign(USDA.turmeric, "Bột nghệ");
assign(USDA.bakingPowder, "Bột nở");
assign(USDA.cocoaButter, "Bơ cacao");
assign(USDA.peanutButter, "Bơ đậu phộng");
assign(USDA.cashewButter, "Bơ hạt điều");
assign(USDA.avocado, "Bơ quả");
assign(USDA.cookedRiceNoodles, "Bún gạo lứt");
assign(USDA.tomato, "Cà chua", "Cà chua bi");
assign(USDA.sunDriedTomato, "Cà chua phơi nắng");
assign(USDA.espresso, "Cà phê espresso");
assign(USDA.carrot, "Cà rốt");
assign(comparableEstimate("raw carrots with a salt brine", [35, 0.8, 8, 0.2, 2.5, 3.5, 850]), "Cà rốt ngâm");
assign(USDA.eggplant, "Cà tím");
assign(USDA.spinach, "Cải mầm", "Cải xanh", "Rau chân vịt");
assign(USDA.orange, "Cam");
assign(USDA.celery, "Cần tây");
assign(USDA.date, "Chà là");
assign(USDA.passionFruit, "Chanh dây");
assign(USDA.lemon, "Chanh vàng");
assign(USDA.lime, "Chanh xanh");
assign(USDA.banana, "Chuối");
assign(USDA.cokeZero, "Coke Zero (thành phẩm)");
assign(USDA.beet, "Củ dền");
assign(USDA.tofuSkin, "Da đậu hũ");
assign(USDA.coconutOil, "Dầu dừa");
assign(USDA.sesameOil, "Dầu mè");
assign(USDA.oliveOil, "Dầu ô liu");
assign(USDA.strawberry, "Dâu tây");
assign(USDA.cucumber, "Dưa leo");
assign(USDA.pickledVegetable, "Dưa muối", "Hành ngâm", "Cà rốt ngâm");
assign(USDA.driedCoconut, "Dừa sợi khô");
assign(USDA.coconut, "Dừa tươi");
assign(USDA.peaProtein, "Đạm đậu Hà Lan thực vật");
assign(USDA.soyProtein, "Đạm đậu nành thực vật");
assign(USDA.adzukiBeans, "Đậu đỏ");
assign(USDA.firmTofu, "Đậu hũ");
assign(USDA.edamame, "Đậu nành Nhật");
assign(USDA.peanut, "Đậu phộng");
assign(USDA.papaya, "Đu đủ");
assign(USDA.palmSugar, "Đường dừa", "Đường thốt nốt");
assign(USDA.caneSugar, "Đường mía");
assign(USDA.cookedBrownRice, "Gạo lứt");
assign(USDA.beanSprouts, "Giá đỗ");
assign(USDA.ginger, "Gừng");
assign(USDA.almonds, "Hạnh nhân");
assign(USDA.onion, "Hành tây");
assign(USDA.shallot, "Hành tím");
assign(USDA.chia, "Hạt chia");
assign(USDA.cookedQuinoa, "Hạt diêm mạch");
assign(USDA.cashew, "Hạt điều");
assign(USDA.mixedNuts, "Hạt hỗn hợp");
assign(USDA.flax, "Hạt lanh");
assign(USDA.sesame, "Hạt mè");
assign(USDA.walnut, "Hạt óc chó");
assign(comparableEstimate("banana blossom / banana flower", [51, 1.6, 9, 0.6, 5, 1.5, 10]), "Hoa chuối");
assign(USDA.basil, "Húng quế");
assign(USDA.coconutFlavor, "Hương dừa");
assign(USDA.coconutCream, "Kem dừa", "Kem dừa vani");
assign(USDA.veganCandy, "Kẹo quả cầu thuần chay");
assign(USDA.sweetPotato, "Khoai lang");
assign(USDA.potato, "Khoai tây");
assign(USDA.cookedBuckwheat, "Kiều mạch");
assign(USDA.genericHerbs, "Kinh giới", "Ngò rí", "Thì là", "Ớt");
assign(USDA.moringaTea, "Lá trà chùm ngây");
assign(USDA.cookedPasta, "Mì dẹt", "Mì pasta", "Mì quinoa không gluten");
assign(USDA.mustard, "Mù tạt");
assign(USDA.salt, "Muối hồng Himalaya");
assign(USDA.berryJam, "Mứt dâu", "Mứt quả mọng");
assign(USDA.chiaJam, "Mứt hạt chia");
assign(USDA.cranberry, "Nam việt quất");
assign(USDA.shiitake, "Nấm đông cô");
assign(USDA.oysterMushroom, "Nấm đùi gà");
assign(USDA.nutritionalYeast, "Nấm men dinh dưỡng");
assign(USDA.strawMushroom, "Nấm rơm");
assign(USDA.raisin, "Nho khô");
assign(USDA.grape, "Nho tươi");
assign(USDA.orangeJuice, "Nước cam ép");
assign(USDA.broth, "Nước dùng rau củ");
assign(USDA.coconutWater, "Nước dừa");
assign(USDA.gingerAle, "Nước gừng có ga");
assign(USDA.mineralWater, "Nước khoáng đóng chai");
assign(USDA.tapWater, "Nước lọc", "Nước nóng");
assign(USDA.sodaWater, "Nước soda");
assign(USDA.tonic, "Nước tonic");
assign(USDA.soySauce, "Nước tương");
assign(USDA.olives, "Ô liu");
assign(USDA.bellPepper, "Ớt chuông đỏ");
assign(USDA.veganBrie, "Phô mai Brie thuần chay");
assign(USDA.veganCheese, "Phô mai hạt điều thuần chay");
assign(USDA.chiaPudding, "Pudding hạt chia");
assign(USDA.cherry, "Quả anh đào");
assign(USDA.cinnamon, "Quế");
assign(USDA.wakame, "Rong biển wakame");
assign(USDA.genericSeaweed, "Rong sụn");
assign(USDA.redWine, "Rượu vang đỏ");
assign(USDA.salsa, "Salsa cà chua");
assign(USDA.palmSugar, "Siro thốt nốt");
assign(USDA.darkChocolate, "Sô-cô-la đen thuần chay");
assign(USDA.darkChocolate, "Sô-cô-la thuần chay");
assign(USDA.bbqSauce, "Sốt BBQ thuần chay");
assign(USDA.ketchup, "Sốt cà chua");
assign(USDA.currySauce, "Sốt cà ri vàng thuần chay");
assign(USDA.hollandaise, "Sốt hollandaise thuần chay");
assign(USDA.veganMayo, "Sốt mayonnaise thuần chay");
assign(USDA.pesto, "Sốt pesto húng quế");
assign(USDA.sriracha, "Sốt tương ớt Sriracha");
assign(USDA.coconutMilkDrink, "Sữa dừa");
assign(USDA.cashewMilk, "Sữa hạt điều");
assign(USDA.unknownPlantDrink, "Sữa thực vật (chọn dừa hoặc yến mạch)");
assign(USDA.oatMilk, "Sữa yến mạch");
assign(USDA.apple, "Táo");
assign(USDA.chickpeaTempeh, "Tempeh đậu gà");
assign(USDA.tempeh, "Tempeh đậu nành");
assign(USDA.dragonFruit, "Thanh long đỏ");
assign(USDA.pineapple, "Thơm");
assign(USDA.blackPepper, "Tiêu đen");
assign(USDA.spirulina, "Tinh bột tảo xoắn");
assign(USDA.vanilla, "Tinh chất vani");
assign(USDA.genericHerbs, "Tỏi");
assign(USDA.herbInfusion, "Trà atisô", "Trà Earl Grey", "Trà hoa cúc", "Trà xanh");
assign(USDA.kombucha, "Trà kombucha");
assign(USDA.miso, "Tương miso");
assign(USDA.blueberry, "Việt quất");
assign(USDA.puffPastry, "Vỏ bánh ngàn lớp thuần chay");
assign(USDA.lettuce, "Xà lách");
assign(USDA.mango, "Xoài");
assign(USDA.dryOats, "Yến mạch");

export function getKurumiNutritionEstimate(ingredientName: string): KurumiNutritionEstimate | undefined {
  return estimates.get(ingredientName);
}

export function getKurumiNutritionEstimateCount(): number {
  return estimates.size;
}
