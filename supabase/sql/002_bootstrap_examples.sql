-- Bootstrap examples (run after 001_crm_core.sql)
-- Replace placeholder values before executing.

-- 1) Organization
insert into crm.organizations (name, legal_name, tax_id)
values ('BlancaReal', 'BlancaReal SL', 'B00000000')
returning id;

-- 2) Find your auth user id (created in Supabase Auth)
-- select id, email from auth.users order by created_at desc;

-- 3) Membership (replace org_id and user_id)
insert into crm.memberships (organization_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000001', -- org_id
  '00000000-0000-0000-0000-000000000010', -- auth.users.id
  'owner'
);

-- 4) Contact + client for a provider company
insert into crm.contacts (
  organization_id,
  contact_type,
  full_name,
  email,
  phone,
  notes
)
values (
  '00000000-0000-0000-0000-000000000001',
  'vendor',
  'Promotora Costa Example',
  'info@promotoracosta.com',
  '+34 600 000 000',
  'Contacto principal del proveedor'
)
returning id;

insert into crm.clients (
  organization_id,
  contact_id,
  client_code,
  client_type,
  client_status,
  billing_name,
  tax_id
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000020', -- contact_id
  'CLI-PROV-001',
  'company',
  'active',
  'Promotora Costa Example SL',
  'B11111111'
)
returning id;

insert into crm.providers (
  organization_id,
  client_id,
  provider_code,
  provider_type,
  provider_status,
  is_billable
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000030', -- client_id
  'PROV-001',
  'promoter',
  'active',
  true
)
returning id;

-- 4b) Contact + client for an agency and its lawyer
insert into crm.contacts (
  organization_id,
  contact_type,
  full_name,
  email,
  phone
)
values (
  '00000000-0000-0000-0000-000000000001',
  'agency',
  'Agencia Blue Coast',
  'operations@bluecoast.agency',
  '+34 600 000 111'
)
returning id;

insert into crm.clients (
  organization_id,
  contact_id,
  client_code,
  client_type,
  client_status,
  billing_name,
  tax_id
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000060', -- agency contact_id
  'CLI-AG-001',
  'company',
  'active',
  'Blue Coast Agency SL',
  'B22222222'
)
returning id;

insert into crm.agencies (
  organization_id,
  client_id,
  agency_code,
  agency_status,
  agency_scope
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000070', -- agency client_id
  'AG-001',
  'active',
  'mixed'
)
returning id;

insert into crm.contacts (
  organization_id,
  contact_type,
  full_name,
  email,
  phone
)
values (
  '00000000-0000-0000-0000-000000000001',
  'lawyer',
  'Laura Gomez',
  'laura.gomez@legaloffice.es',
  '+34 600 000 222'
)
returning id;

insert into crm.agency_contacts (
  organization_id,
  agency_id,
  contact_id,
  role,
  relation_status,
  is_primary
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000080', -- agency_id
  '00000000-0000-0000-0000-000000000090', -- lawyer contact_id
  'lawyer',
  'active',
  true
);

-- 5) Create a project property (record_type=project)
insert into crm.properties (
  organization_id,
  legacy_code,
  record_type,
  operation_type,
  listing_type,
  status,
  price_sale,
  price_currency,
  location,
  property_data
)
values (
  '00000000-0000-0000-0000-000000000001',
  'PM9000',
  'project',
  'sale',
  'promotion',
  'available',
  350000,
  'EUR',
  '{"country":"ES","province":"Malaga","city":"Mijas","area":"Riviera"}',
  '{"type":"apartment","year_built":2027}'
)
returning id;

-- 6) Attach provider to project
insert into crm.project_providers (
  organization_id,
  project_property_id,
  provider_id,
  responsibility_role,
  is_primary
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000040', -- project_property_id
  '00000000-0000-0000-0000-000000000050', -- provider_id
  'promoter',
  true
);

-- 7) Lead referred by agency (status in_process)
insert into crm.leads (
  organization_id,
  website_id,
  property_id,
  contact_id,
  agency_id,
  referred_contact_id,
  lead_kind,
  origin_type,
  source,
  status,
  operation_interest,
  budget_min,
  budget_max
)
values (
  '00000000-0000-0000-0000-000000000001',
  null,
  '00000000-0000-0000-0000-000000000040', -- project_property_id
  '00000000-0000-0000-0000-000000000020', -- lead/client contact_id
  '00000000-0000-0000-0000-000000000080', -- agency_id
  '00000000-0000-0000-0000-000000000090', -- lawyer or agent contact_id
  'buyer',
  'agency',
  'agency_referral',
  'in_process',
  'sale',
  280000,
  420000
);

-- 8) Convert lead to agency (optional)
-- select crm.convert_lead_to_agency('00000000-0000-0000-0000-0000000000AA');
