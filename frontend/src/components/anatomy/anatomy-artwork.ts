import type { MuscleSlug, BodySide } from "./muscle-types";

export type MusclePathDefinition = {
  id: string;
  slug: MuscleSlug;
  side: BodySide;
  path: string;
  fiberPath: string;
  labelX: number;
  labelY: number;
};

export const ANATOMY_VIEWBOX = "0 0 360 760";

export const FRONT_REGION_IDS = [
  "chest-left",
  "chest-right",
  "shoulders-left",
  "shoulders-right",
  "biceps-left",
  "biceps-right",
  "forearms-left",
  "forearms-right",
  "abs-upper-left",
  "abs-upper-right",
  "abs-mid-left",
  "abs-mid-right",
  "abs-lower-left",
  "abs-lower-right",
  "obliques-left",
  "obliques-right",
  "quads-left",
  "quads-right",
] as const;

export const BACK_REGION_IDS = [
  "back-upper-left",
  "back-upper-right",
  "lats-left",
  "lats-right",
  "shoulders-rear-left",
  "shoulders-rear-right",
  "triceps-left",
  "triceps-right",
  "forearms-back-left",
  "forearms-back-right",
  "lower-back-left",
  "lower-back-right",
  "glutes-left",
  "glutes-right",
  "hamstrings-left",
  "hamstrings-right",
  "calves-left",
  "calves-right",
] as const;

// Neutral body silhouette paths (non-muscle structural elements)
export const BODY_SILHOUETTE = {
  head: "M180 30 C200 30 215 50 215 75 C215 100 200 120 180 120 C160 120 145 100 145 75 C145 50 160 30 180 30 Z",
  neck: "M165 120 L165 145 L195 145 L195 120 Z",
  torso: "M120 145 C115 145 110 150 108 160 L100 280 C98 300 100 320 105 340 L110 380 C112 395 120 405 135 410 L145 412 L180 415 L215 412 L225 410 C240 405 248 395 250 380 L255 340 C260 320 262 300 260 280 L252 160 C250 150 245 145 240 145 Z",
  pelvis: "M130 410 C120 415 115 425 115 440 L115 470 C115 485 125 495 145 500 L180 505 L215 500 C235 495 245 485 245 470 L245 440 C245 425 240 415 230 410 Z",
  armLeft: "M100 160 C85 165 75 180 70 200 L55 280 C50 300 48 320 50 340 L52 380 C53 395 55 405 58 410 L60 420",
  armRight: "M260 160 C275 165 285 180 290 200 L305 280 C310 300 312 320 310 340 L308 380 C307 395 305 405 302 410 L300 420",
  legLeft: "M145 500 C135 510 130 530 130 560 L130 650 C130 680 135 710 145 740 L150 755",
  legRight: "M215 500 C225 510 230 530 230 560 L230 650 C230 680 225 710 215 740 L210 755",
};

// Bone/tendon landmark paths for anatomical accuracy
export const LANDMARKS = {
  clavicleLeft: "M180 152 Q160 148 130 155",
  clavicleRight: "M180 152 Q200 148 230 155",
  shoulderJointLeft: "M108 165 A8 8 0 1 1 108 167",
  shoulderJointRight: "M252 165 A8 8 0 1 1 252 167",
  elbowLeft: "M58 295 A5 5 0 1 1 58 297",
  elbowRight: "M302 295 A5 5 0 1 1 302 297",
  wristLeft: "M52 395 L68 395",
  wristRight: "M292 395 L308 395",
  kneeLeft: "M140 610 A6 6 0 1 1 140 612",
  kneeRight: "M220 610 A6 6 0 1 1 220 612",
  ankleLeft: "M145 735 A4 4 0 1 1 145 737",
  ankleRight: "M215 735 A4 4 0 1 1 215 737",
  spine: "M180 155 L180 405",
};

// Original anatomical muscle path definitions
// Each path represents realistic muscle contours within 360x760 viewBox
// Fiber paths follow actual muscle fiber direction for visual accuracy

export const FRONT_MUSCLES: MusclePathDefinition[] = [
  // Chest (Pectoralis Major) - fan-shaped fibers converging to armpit
  {
    id: "chest-left",
    slug: "chest",
    side: "front",
    path: "M178 165 C175 168 168 172 155 180 C140 190 125 195 115 200 C108 205 105 215 108 230 C112 250 120 260 135 265 C150 268 165 265 178 255 L178 165 Z",
    fiberPath: "M175 170 L125 210 M175 185 L120 230 M175 200 L125 245 M175 215 L130 255 M175 230 L140 260",
    labelX: 145,
    labelY: 215,
  },
  {
    id: "chest-right",
    slug: "chest",
    side: "front",
    path: "M182 165 C185 168 192 172 205 180 C220 190 235 195 245 200 C252 205 255 215 252 230 C248 250 240 260 225 265 C210 268 195 265 182 255 L182 165 Z",
    fiberPath: "M185 170 L235 210 M185 185 L240 230 M185 200 L235 245 M185 215 L230 255 M185 230 L220 260",
    labelX: 215,
    labelY: 215,
  },

  // Shoulders (Anterior Deltoid) - converging downward to insertion
  {
    id: "shoulders-left",
    slug: "shoulders",
    side: "front",
    path: "M115 155 C100 158 90 170 88 185 C86 200 90 215 100 225 C108 232 115 230 118 220 C122 205 120 180 115 165 L115 155 Z",
    fiberPath: "M105 165 L108 210 M98 175 L105 215 M92 185 L100 220",
    labelX: 102,
    labelY: 190,
  },
  {
    id: "shoulders-right",
    slug: "shoulders",
    side: "front",
    path: "M245 155 C260 158 270 170 272 185 C274 200 270 215 260 225 C252 232 245 230 242 220 C238 205 240 180 245 165 L245 155 Z",
    fiberPath: "M255 165 L252 210 M262 175 L255 215 M268 185 L260 220",
    labelX: 258,
    labelY: 190,
  },

  // Biceps - two-headed muscle belly
  {
    id: "biceps-left",
    slug: "biceps",
    side: "front",
    path: "M88 230 C82 240 78 260 76 285 C74 305 76 320 82 330 C88 338 95 335 100 325 C106 310 108 285 105 260 C102 245 96 235 88 230 Z",
    fiberPath: "M85 240 L88 320 M92 245 L94 315 M98 250 L100 310",
    labelX: 90,
    labelY: 280,
  },
  {
    id: "biceps-right",
    slug: "biceps",
    side: "front",
    path: "M272 230 C278 240 282 260 284 285 C286 305 284 320 278 330 C272 338 265 335 260 325 C254 310 252 285 255 260 C258 245 264 235 272 230 Z",
    fiberPath: "M275 240 L272 320 M268 245 L266 315 M262 250 L260 310",
    labelX: 270,
    labelY: 280,
  },

  // Forearms (Brachioradialis/Flexors) - long parallel fibers
  {
    id: "forearms-left",
    slug: "forearms",
    side: "front",
    path: "M76 335 C70 350 65 375 62 395 C60 410 58 420 60 425 C64 430 72 428 78 420 C85 408 88 385 88 360 C88 345 84 338 76 335 Z",
    fiberPath: "M74 345 L65 410 M80 350 L72 415 M85 355 L78 420",
    labelX: 72,
    labelY: 380,
  },
  {
    id: "forearms-right",
    slug: "forearms",
    side: "front",
    path: "M284 335 C290 350 295 375 298 395 C300 410 302 420 300 425 C296 430 288 428 282 420 C275 408 272 385 272 360 C272 345 276 338 284 335 Z",
    fiberPath: "M286 345 L295 410 M280 350 L288 415 M275 355 L282 420",
    labelX: 288,
    labelY: 380,
  },

  // Abs (Rectus Abdominis) - horizontal fiber bands
  {
    id: "abs-upper-left",
    slug: "abs",
    side: "front",
    path: "M178 270 L178 300 C175 302 168 305 160 305 C155 305 152 302 152 298 L152 275 C152 272 155 270 160 270 L178 270 Z",
    fiberPath: "M175 275 L155 275 M175 285 L155 285 M175 295 L155 295",
    labelX: 165,
    labelY: 285,
  },
  {
    id: "abs-upper-right",
    slug: "abs",
    side: "front",
    path: "M182 270 L182 300 C185 302 192 305 200 305 C205 305 208 302 208 298 L208 275 C208 272 205 270 200 270 L182 270 Z",
    fiberPath: "M185 275 L205 275 M185 285 L205 285 M185 295 L205 295",
    labelX: 195,
    labelY: 285,
  },
  {
    id: "abs-mid-left",
    slug: "abs",
    side: "front",
    path: "M178 308 L178 345 C175 347 168 350 158 350 C153 350 150 347 150 343 L150 313 C150 310 153 308 158 308 L178 308 Z",
    fiberPath: "M175 315 L153 315 M175 328 L153 328 M175 340 L153 340",
    labelX: 164,
    labelY: 328,
  },
  {
    id: "abs-mid-right",
    slug: "abs",
    side: "front",
    path: "M182 308 L182 345 C185 347 192 350 202 350 C207 350 210 347 210 343 L210 313 C210 310 207 308 202 308 L182 308 Z",
    fiberPath: "M185 315 L207 315 M185 328 L207 328 M185 340 L207 340",
    labelX: 196,
    labelY: 328,
  },
  {
    id: "abs-lower-left",
    slug: "abs",
    side: "front",
    path: "M178 355 L178 395 C175 398 168 402 156 402 C150 402 147 398 147 392 L147 360 C147 356 150 355 156 355 L178 355 Z",
    fiberPath: "M175 362 L150 362 M175 375 L150 375 M175 388 L150 388",
    labelX: 162,
    labelY: 375,
  },
  {
    id: "abs-lower-right",
    slug: "abs",
    side: "front",
    path: "M182 355 L182 395 C185 398 192 402 204 402 C210 402 213 398 213 392 L213 360 C213 356 210 355 204 355 L182 355 Z",
    fiberPath: "M185 362 L210 362 M185 375 L210 375 M185 388 L210 388",
    labelX: 198,
    labelY: 375,
  },

  // Obliques - diagonal fibers
  {
    id: "obliques-left",
    slug: "obliques",
    side: "front",
    path: "M148 275 C138 280 130 295 125 320 C122 340 120 360 122 380 C124 395 130 405 140 408 C145 410 148 405 148 398 L148 275 Z",
    fiberPath: "M145 285 L128 310 M145 310 L125 340 M145 340 L125 375 M145 375 L130 400",
    labelX: 135,
    labelY: 340,
  },
  {
    id: "obliques-right",
    slug: "obliques",
    side: "front",
    path: "M212 275 C222 280 230 295 235 320 C238 340 240 360 238 380 C236 395 230 405 220 408 C215 410 212 405 212 398 L212 275 Z",
    fiberPath: "M215 285 L232 310 M215 310 L235 340 M215 340 L235 375 M215 375 L230 400",
    labelX: 225,
    labelY: 340,
  },

  // Quads (Rectus Femoris/Vastus) - long vertical fibers
  {
    id: "quads-left",
    slug: "quads",
    side: "front",
    path: "M145 505 C130 515 125 540 125 575 C125 605 130 635 140 660 C148 680 155 690 162 695 C168 698 172 695 174 688 C178 670 178 640 175 605 C172 570 168 540 162 520 C158 508 152 502 145 505 Z",
    fiberPath: "M150 520 L155 680 M160 515 L165 685 M140 530 L148 670 M170 525 L172 675",
    labelX: 152,
    labelY: 590,
  },
  {
    id: "quads-right",
    slug: "quads",
    side: "front",
    path: "M215 505 C230 515 235 540 235 575 C235 605 230 635 220 660 C212 680 205 690 198 695 C192 698 188 695 186 688 C182 670 182 640 185 605 C188 570 192 540 198 520 C202 508 208 502 215 505 Z",
    fiberPath: "M210 520 L205 680 M200 515 L195 685 M220 530 L212 670 M190 525 L188 675",
    labelX: 208,
    labelY: 590,
  },
];

export const BACK_MUSCLES: MusclePathDefinition[] = [
  // Upper Back (Rhomboids/Mid Traps)
  {
    id: "back-upper-left",
    slug: "back",
    side: "back",
    path: "M178 160 C170 165 160 175 150 188 C142 200 138 215 140 230 C142 242 150 248 162 248 C172 248 178 242 178 230 L178 160 Z",
    fiberPath: "M175 170 L150 195 M175 190 L148 220 M175 210 L155 238",
    labelX: 158,
    labelY: 205,
  },
  {
    id: "back-upper-right",
    slug: "back",
    side: "back",
    path: "M182 160 C190 165 200 175 210 188 C218 200 222 215 220 230 C218 242 210 248 198 248 C188 248 182 242 182 230 L182 160 Z",
    fiberPath: "M185 170 L210 195 M185 190 L212 220 M185 210 L205 238",
    labelX: 202,
    labelY: 205,
  },

  // Lats (Latissimus Dorsi) - large fan from armpit to lower back
  {
    id: "lats-left",
    slug: "lats",
    side: "back",
    path: "M110 220 C105 235 108 260 115 290 C122 320 135 350 150 375 C162 395 172 405 178 408 C178 350 178 280 178 255 C165 255 140 245 120 235 L110 220 Z",
    fiberPath: "M115 240 L175 400 M120 260 L172 395 M130 280 L170 390 M145 300 L168 385",
    labelX: 145,
    labelY: 320,
  },
  {
    id: "lats-right",
    slug: "lats",
    side: "back",
    path: "M250 220 C255 235 252 260 245 290 C238 320 225 350 210 375 C198 395 188 405 182 408 C182 350 182 280 182 255 C195 255 220 245 240 235 L250 220 Z",
    fiberPath: "M245 240 L185 400 M240 260 L188 395 M230 280 L190 390 M215 300 L192 385",
    labelX: 215,
    labelY: 320,
  },

  // Rear Deltoids
  {
    id: "shoulders-rear-left",
    slug: "shoulders",
    side: "back",
    path: "M110 160 C95 165 85 180 82 200 C80 218 85 232 98 238 C108 242 115 235 118 222 C122 205 120 178 115 165 L110 160 Z",
    fiberPath: "M100 175 L105 225 M92 188 L100 230 M86 200 L95 235",
    labelX: 98,
    labelY: 200,
  },
  {
    id: "shoulders-rear-right",
    slug: "shoulders",
    side: "back",
    path: "M250 160 C265 165 275 180 278 200 C280 218 275 232 262 238 C252 242 245 235 242 222 C238 205 240 178 245 165 L250 160 Z",
    fiberPath: "M260 175 L255 225 M268 188 L260 230 M274 200 L265 235",
    labelX: 262,
    labelY: 200,
  },

  // Triceps - three heads visible from back
  {
    id: "triceps-left",
    slug: "triceps",
    side: "back",
    path: "M88 235 C80 250 75 275 74 300 C73 320 75 335 82 345 C88 352 95 348 100 338 C106 322 108 295 105 268 C102 250 96 240 88 235 Z",
    fiberPath: "M85 250 L88 335 M92 255 L94 330 M98 260 L98 325",
    labelX: 90,
    labelY: 290,
  },
  {
    id: "triceps-right",
    slug: "triceps",
    side: "back",
    path: "M272 235 C280 250 285 275 286 300 C287 320 285 335 278 345 C272 352 265 348 260 338 C254 322 252 295 255 268 C258 250 264 240 272 235 Z",
    fiberPath: "M275 250 L272 335 M268 255 L266 330 M262 260 L262 325",
    labelX: 270,
    labelY: 290,
  },

  // Back Forearms (Extensors)
  {
    id: "forearms-back-left",
    slug: "forearms",
    side: "back",
    path: "M78 350 C72 365 68 385 65 405 C63 418 62 428 64 432 C68 436 75 434 80 426 C86 415 88 395 88 375 C88 362 84 354 78 350 Z",
    fiberPath: "M76 360 L68 420 M82 365 L75 425 M86 370 L80 428",
    labelX: 75,
    labelY: 390,
  },
  {
    id: "forearms-back-right",
    slug: "forearms",
    side: "back",
    path: "M282 350 C288 365 292 385 295 405 C297 418 298 428 296 432 C292 436 285 434 280 426 C274 415 272 395 272 375 C272 362 276 354 282 350 Z",
    fiberPath: "M284 360 L292 420 M278 365 L285 425 M274 370 L280 428",
    labelX: 285,
    labelY: 390,
  },

  // Lower Back (Erector Spinae)
  {
    id: "lower-back-left",
    slug: "lower_back",
    side: "back",
    path: "M178 350 C172 355 165 365 158 380 C152 395 148 412 148 425 C148 438 152 448 160 452 C168 455 175 450 178 440 L178 350 Z",
    fiberPath: "M175 360 L155 430 M172 380 L152 445 M168 400 L155 450",
    labelX: 162,
    labelY: 400,
  },
  {
    id: "lower-back-right",
    slug: "lower_back",
    side: "back",
    path: "M182 350 C188 355 195 365 202 380 C208 395 212 412 212 425 C212 438 208 448 200 452 C192 455 185 450 182 440 L182 350 Z",
    fiberPath: "M185 360 L205 430 M188 380 L208 445 M192 400 L205 450",
    labelX: 198,
    labelY: 400,
  },

  // Glutes
  {
    id: "glutes-left",
    slug: "glutes",
    side: "back",
    path: "M178 455 C165 458 150 468 140 485 C132 500 128 518 130 532 C132 545 140 552 155 555 C168 557 178 552 178 540 L178 455 Z",
    fiberPath: "M175 465 L145 520 M170 485 L140 535 M165 505 L145 545",
    labelX: 155,
    labelY: 505,
  },
  {
    id: "glutes-right",
    slug: "glutes",
    side: "back",
    path: "M182 455 C195 458 210 468 220 485 C228 500 232 518 230 532 C228 545 220 552 205 555 C192 557 182 552 182 540 L182 455 Z",
    fiberPath: "M185 465 L215 520 M190 485 L220 535 M195 505 L215 545",
    labelX: 205,
    labelY: 505,
  },

  // Hamstrings
  {
    id: "hamstrings-left",
    slug: "hamstrings",
    side: "back",
    path: "M145 555 C135 565 130 590 130 625 C130 655 135 685 145 710 C152 728 160 738 168 740 C174 742 178 738 178 730 L178 560 C170 558 158 555 145 555 Z",
    fiberPath: "M150 570 L158 720 M160 575 L168 725 M142 585 L152 715 M170 580 L175 720",
    labelX: 155,
    labelY: 640,
  },
  {
    id: "hamstrings-right",
    slug: "hamstrings",
    side: "back",
    path: "M215 555 C225 565 230 590 230 625 C230 655 225 685 215 710 C208 728 200 738 192 740 C186 742 182 738 182 730 L182 560 C190 558 202 555 215 555 Z",
    fiberPath: "M210 570 L202 720 M200 575 L192 725 M218 585 L208 715 M190 580 L185 720",
    labelX: 205,
    labelY: 640,
  },

  // Calves (Gastrocnemius)
  {
    id: "calves-left",
    slug: "calves",
    side: "back",
    path: "M140 695 C132 705 128 725 128 745 C128 760 132 772 140 778 C148 783 158 780 165 772 C172 762 175 745 175 725 C175 708 170 698 162 695 L140 695 Z",
    fiberPath: "M145 705 L148 765 M155 708 L158 768 M165 710 L165 765",
    labelX: 152,
    labelY: 735,
  },
  {
    id: "calves-right",
    slug: "calves",
    side: "back",
    path: "M220 695 C228 705 232 725 232 745 C232 760 228 772 220 778 C212 783 202 780 195 772 C188 762 185 745 185 725 C185 708 190 698 198 695 L220 695 Z",
    fiberPath: "M215 705 L212 765 M205 708 L202 768 M195 710 L195 765",
    labelX: 208,
    labelY: 735,
  },
];

// Combine for easy lookup
export const ALL_MUSCLES: MusclePathDefinition[] = [
  ...FRONT_MUSCLES,
  ...BACK_MUSCLES,
];

export function getMusclesBySlug(slug: MuscleSlug): MusclePathDefinition[] {
  return ALL_MUSCLES.filter((m) => m.slug === slug);
}

export function getMusclesBySide(side: BodySide): MusclePathDefinition[] {
  return ALL_MUSCLES.filter((m) => m.side === side);
}

// Muscle display names for accessibility
export const MUSCLE_NAMES: Record<MuscleSlug, string> = {
  chest: "Chest",
  back: "Upper Back",
  lats: "Latissimus Dorsi",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  abs: "Abdominals",
  obliques: "Obliques",
  lower_back: "Lower Back",
};
