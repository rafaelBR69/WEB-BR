# Modulo de Agencias

## Objetivo

Construir un modulo de agencias separado de `leads` y `clientes`, pero conectado con ambos, para evitar mezclar:

- la persona que contacta,
- la oportunidad comercial que entra,
- la entidad legal/facturable,
- y el rol de colaborador externo.

## Modelo correcto

### 1. Contacto

`crm.contacts`

Representa a la persona: agente comercial, responsable de captacion, abogado, asistente u owner.

### 2. Lead

`crm.leads`

Representa la entrada comercial.

Casos importantes:

- comprador referido por agencia existente:
  - `lead_kind = buyer`
  - `origin_type = agency`
  - `agency_id = <agencia existente>`
- agencia nueva que entra por primera vez:
  - `lead_kind = agency`
  - `origin_type = website | phone | email | portal | other`
  - sin `agency_id` inicial

Regla: `origin_type = agency` solo debe usarse cuando ya existe una agencia registrada y el lead entra referido por ella.

### 3. Cliente

`crm.clients`

Representa la entidad base CRM y legal/facturable.

### 4. Agencia

`crm.agencies`

Es un rol especializado de `crm.clients`.

Regla estructural:

- toda agencia debe tener `client_id`
- una agencia puede tener uno o varios `agency_contacts`

### 5. Contactos de agencia

`crm.agency_contacts`

Relaciona personas reales con una agencia:

- agente
- owner
- assistant
- lawyer
- other

## Flujo recomendado

### Flujo A: agencia nueva

1. Entra un lead con `lead_kind = agency`.
2. Se cualifica comercialmente.
3. Se convierte a agencia.
4. El sistema crea o reutiliza:
   - `crm.clients`
   - `crm.agencies`
5. A partir de ese momento ya puede referir compradores con `agency_id`.

### Flujo B: agencia existente refiere un comprador

1. La agencia ya existe en `crm.agencies`.
2. Entra un lead comprador.
3. El lead se crea con `origin_type = agency` y `agency_id`.
4. El seguimiento comercial del comprador queda atribuido a la agencia correcta.

## Lo que no debe hacerse

- No usar `origin_type = agency` para una agencia nueva que todavia no existe en CRM.
- No usar `crm.contacts` como si fuera la agencia legal.
- No usar `crm.clients` sin activar `crm.agencies` cuando la entidad es colaboradora externa real.
- No convertir un lead de agencia como si fuera un cliente comprador normal.

## MVP implementado en esta base

- endpoint `GET /api/v1/crm/agencies`
- vista CRM `/crm/agencies/`
- alta manual de lead con selector de agencia cuando `origin_type = agency`
- conversion de lead:
  - lead normal -> cliente
  - lead de tipo agencia -> agencia

## Siguiente iteracion recomendada

1. ficha propia de agencia (`/crm/agencies/{id}`) con timeline, contactos y leads atribuidos.
2. CRUD de `agency_contacts`.
3. selector de agencia tambien en ficha/edicion de lead.
4. panel KPI de agencias:
   - agencias activas
   - agencias con leads abiertos
   - conversion lead -> agencia
   - volumen de leads por agencia
