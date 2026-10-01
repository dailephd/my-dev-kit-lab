export interface Parcel {
  weightGrams: number;
  destinationZone: "domestic" | "regional" | "international";
}

export interface WeightBand {
  maxGrams: number;
  baseCents: number;
}

export const weightBands: readonly WeightBand[] = [
  { maxGrams: 500, baseCents: 450 },
  { maxGrams: 2000, baseCents: 900 },
  { maxGrams: 10000, baseCents: 1800 }
];

const zoneSurchargeCents = { domestic: 0, regional: 250, international: 1200 } as const;

export function selectWeightBand(weightGrams: number): WeightBand {
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
    throw new Error("Parcel weight must be a positive number of grams.");
  }
  const band = weightBands.find((candidate) => weightGrams <= candidate.maxGrams);
  if (!band) {
    throw new Error("Parcel exceeds the maximum supported weight.");
  }
  return band;
}

export function calculateShippingQuote(parcel: Parcel): number {
  return selectWeightBand(parcel.weightGrams).baseCents + zoneSurchargeCents[parcel.destinationZone];
}
