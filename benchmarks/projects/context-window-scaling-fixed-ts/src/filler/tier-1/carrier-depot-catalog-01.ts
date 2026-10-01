// Scale-only filler (tier-1). Ordinary catalog data for a carrier depot listing.
// It is unrelated to every task under src/tasks and exists only to add repository context.

export interface CarrierDepotRecord01 {
  id: string;
  label: string;
  capacity: number;
  priority: number;
  active: boolean;
  notes: string;
}

export const carrierDepotRecords01: readonly CarrierDepotRecord01[] = [
  {
    id: "car-01-001",
    label: "central annex 1",
    capacity: 84,
    priority: 3,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-002",
    label: "granite annex 2",
    capacity: 62,
    priority: 3,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-003",
    label: "northern annex 3",
    capacity: 64,
    priority: 2,
    active: false,
    notes: "eastern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-004",
    label: "northern hall 4",
    capacity: 12,
    priority: 5,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-005",
    label: "granite hall 5",
    capacity: 64,
    priority: 1,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-006",
    label: "central hall 6",
    capacity: 16,
    priority: 2,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-007",
    label: "central annex 7",
    capacity: 58,
    priority: 5,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-008",
    label: "northern row 8",
    capacity: 50,
    priority: 4,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-009",
    label: "northern hall 9",
    capacity: 14,
    priority: 3,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-010",
    label: "northern hall 10",
    capacity: 48,
    priority: 3,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-011",
    label: "central hall 11",
    capacity: 26,
    priority: 3,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-012",
    label: "granite row 12",
    capacity: 66,
    priority: 4,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-013",
    label: "riverside row 13",
    capacity: 24,
    priority: 5,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-014",
    label: "granite hall 14",
    capacity: 88,
    priority: 2,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-015",
    label: "northern hall 15",
    capacity: 28,
    priority: 3,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-016",
    label: "granite row 16",
    capacity: 96,
    priority: 1,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-017",
    label: "northern row 17",
    capacity: 68,
    priority: 1,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-018",
    label: "northern annex 18",
    capacity: 98,
    priority: 3,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-019",
    label: "granite hall 19",
    capacity: 52,
    priority: 1,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-020",
    label: "northern hall 20",
    capacity: 70,
    priority: 5,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-021",
    label: "northern row 21",
    capacity: 30,
    priority: 5,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-022",
    label: "central hall 22",
    capacity: 34,
    priority: 1,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-023",
    label: "central annex 23",
    capacity: 68,
    priority: 1,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-024",
    label: "northern hall 24",
    capacity: 46,
    priority: 4,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-025",
    label: "northern row 25",
    capacity: 90,
    priority: 1,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-026",
    label: "northern row 26",
    capacity: 66,
    priority: 5,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-027",
    label: "central annex 27",
    capacity: 98,
    priority: 4,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-028",
    label: "granite hall 28",
    capacity: 14,
    priority: 5,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-029",
    label: "central row 29",
    capacity: 92,
    priority: 4,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-030",
    label: "northern row 30",
    capacity: 30,
    priority: 1,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-031",
    label: "central row 31",
    capacity: 18,
    priority: 4,
    active: false,
    notes: "central carrier depot entry reviewed in cycle 5"
  },
  {
    id: "car-01-032",
    label: "granite hall 32",
    capacity: 80,
    priority: 5,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 9"
  },
  {
    id: "car-01-033",
    label: "northern annex 33",
    capacity: 36,
    priority: 2,
    active: false,
    notes: "granite carrier depot entry reviewed in cycle 1"
  },
  {
    id: "car-01-034",
    label: "granite row 34",
    capacity: 68,
    priority: 3,
    active: false,
    notes: "northern carrier depot entry reviewed in cycle 1"
  }
];

export function findCarrierDepotRecord01(id: string): CarrierDepotRecord01 | undefined {
  return carrierDepotRecords01.find((record) => record.id === id);
}

export function listCarrierDepotActiveRecords01(): CarrierDepotRecord01[] {
  return carrierDepotRecords01.filter((record) => record.active);
}

export function totalCarrierDepotCapacity01(): number {
  return carrierDepotRecords01.reduce((sum, record) => sum + record.capacity, 0);
}

export function countCarrierDepotByPriority01(priority: number): number {
  return carrierDepotRecords01.filter((record) => record.priority === priority).length;
}
