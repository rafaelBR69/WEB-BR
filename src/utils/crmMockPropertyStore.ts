type MockPropertyRecordType = "project" | "unit" | "single";
type MockOperationType = "sale" | "rent" | "both";
type MockProjectBusinessType =
  | "owned_and_commercialized"
  | "provider_and_commercialized_by_us"
  | "external_listing";
type MockPropertyStatus = "draft" | "available" | "reserved" | "sold" | "rented" | "private" | "archived";

type MockPropertyRow = {
  id: string;
  organization_id: string;
  website_id: string | null;
  legacy_code: string;
  record_type: MockPropertyRecordType;
  project_business_type: MockProjectBusinessType;
  commercialization_notes: string | null;
  parent_property_id: string | null;
  operation_type: MockOperationType;
  status: MockPropertyStatus;
  is_featured: boolean;
  is_public: boolean;
  price_sale: number | null;
  price_rent_monthly: number | null;
  price_currency: string;
  property_data: Record<string, unknown>;
  location: Record<string, unknown>;
  media: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type GlobalStore = typeof globalThis & {
  __crmMockPropertiesStore?: MockPropertyRow[];
};

const nowIso = () => new Date().toISOString();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createSeed = (): MockPropertyRow[] => {
  const now = nowIso();
  return [
    {
      id: "pr_9001",
      organization_id: "org_mock",
      website_id: null,
      legacy_code: "PM0084",
      record_type: "project",
      project_business_type: "provider_and_commercialized_by_us",
      commercialization_notes: "Promocion de proveedor comercializada por nosotros.",
      parent_property_id: null,
      operation_type: "sale",
      status: "available",
      is_featured: true,
      is_public: true,
      price_sale: 430000,
      price_rent_monthly: null,
      price_currency: "EUR",
      property_data: {
        area_m2: 152,
        bedrooms: 3,
        bathrooms: 2,
        rent_price_on_request: false,
      },
      location: {},
      media: { cover: null, gallery: {} },
      created_at: now,
      updated_at: now,
    },
    {
      id: "pr_9002",
      organization_id: "org_mock",
      website_id: null,
      legacy_code: "PM0084-B2",
      record_type: "unit",
      project_business_type: "provider_and_commercialized_by_us",
      commercialization_notes: null,
      parent_property_id: "pr_9001",
      operation_type: "sale",
      status: "reserved",
      is_featured: false,
      is_public: true,
      price_sale: 459000,
      price_rent_monthly: null,
      price_currency: "EUR",
      property_data: {
        area_m2: 121,
        bedrooms: 2,
        bathrooms: 2,
        rent_price_on_request: false,
      },
      location: {},
      media: { cover: null, gallery: {} },
      created_at: now,
      updated_at: now,
    },
  ];
};

const getStore = (): MockPropertyRow[] => {
  const scope = globalThis as GlobalStore;
  if (!scope.__crmMockPropertiesStore) {
    scope.__crmMockPropertiesStore = createSeed();
  }
  return scope.__crmMockPropertiesStore;
};

export const listMockPropertyRows = (): MockPropertyRow[] => clone(getStore());

export const getMockPropertyRowById = (id: string): MockPropertyRow | null => {
  const row = getStore().find((item) => item.id === id);
  return row ? clone(row) : null;
};

export const findMockPropertyByLegacyCode = (
  organizationId: string,
  legacyCode: string
): MockPropertyRow | null => {
  const row = getStore().find(
    (item) => item.organization_id === organizationId && item.legacy_code === legacyCode
  );
  return row ? clone(row) : null;
};

export const insertMockPropertyRow = (
  input: Omit<MockPropertyRow, "id" | "created_at" | "updated_at">
): MockPropertyRow => {
  const store = getStore();
  const now = nowIso();
  const row: MockPropertyRow = {
    ...clone(input),
    id: `pr_${crypto.randomUUID()}`,
    created_at: now,
    updated_at: now,
  };
  store.unshift(row);
  return clone(row);
};

export const patchMockPropertyRow = (
  id: string,
  patch: Record<string, unknown>
): MockPropertyRow | null => {
  const store = getStore();
  const index = store.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const current = store[index];
  const next: MockPropertyRow = {
    ...current,
    ...(clone(patch) as Partial<MockPropertyRow>),
    updated_at: nowIso(),
  };
  store[index] = next;
  return clone(next);
};
