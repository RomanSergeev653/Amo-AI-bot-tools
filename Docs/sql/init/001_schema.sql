CREATE TABLE IF NOT EXISTS leads (
    id BIGINT PRIMARY KEY,
    name TEXT,
    status_id BIGINT,
    pipeline_id BIGINT,
    company_id BIGINT,
    main_contact_id BIGINT,
    price NUMERIC(18, 2),
    responsible_user_id BIGINT,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pipelines (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS contacts (
    id BIGINT PRIMARY KEY,
    name TEXT,
    linked_company_id BIGINT,
    company_id BIGINT,
    responsible_user_id BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS companies (
    id BIGINT PRIMARY KEY,
    name TEXT,
    responsible_user_id BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS amo_users (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    department_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT PRIMARY KEY,
    entity_type TEXT,
    entity_id BIGINT,
    task_type TEXT,
    text TEXT,
    status TEXT,
    result_text TEXT,
    complete_till TIMESTAMPTZ,
    responsible_user_id BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    action TEXT NOT NULL,
    event_time TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
    id BIGINT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    note_type TEXT,
    text TEXT,
    created_by BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id BIGINT NOT NULL,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    field_type TEXT,
    enums JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (id, entity_type)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    custom_field_id BIGINT NOT NULL,
    value_text TEXT,
    value_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (entity_type, entity_id, custom_field_id, value_text)
);

CREATE TABLE IF NOT EXISTS stages (
    pipeline_id BIGINT NOT NULL,
    status_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    sort INTEGER,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (pipeline_id, status_id)
);

CREATE TABLE IF NOT EXISTS lead_contacts (
    lead_id BIGINT NOT NULL,
    contact_id BIGINT NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (lead_id, contact_id)
);

CREATE TABLE IF NOT EXISTS raw_webhooks (
    id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_type TEXT,
    payload_form JSONB,
    payload_raw TEXT,
    payload_hash TEXT,
    processed_at TIMESTAMPTZ,
    process_status TEXT NOT NULL DEFAULT 'new',
    error_text TEXT,
    processing_started_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sync_state (
    entity_type TEXT PRIMARY KEY,
    last_success_ts TIMESTAMPTZ,
    last_cursor TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads (updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads (company_id);
CREATE INDEX IF NOT EXISTS idx_leads_main_contact_id ON leads (main_contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_closed_at ON leads (closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts (updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_companies_updated_at ON companies (updated_at);
CREATE INDEX IF NOT EXISTS idx_amo_users_department_name ON amo_users (department_name);
CREATE INDEX IF NOT EXISTS idx_amo_users_updated_at ON amo_users (updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_event_time ON events (event_time);
CREATE INDEX IF NOT EXISTS idx_raw_webhooks_status ON raw_webhooks (process_status, received_at);
CREATE INDEX IF NOT EXISTS idx_raw_webhooks_processing_stale
    ON raw_webhooks (processing_started_at)
    WHERE process_status = 'processing';
